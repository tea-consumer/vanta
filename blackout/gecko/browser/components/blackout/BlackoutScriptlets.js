/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Vanta Blackout's scriptlets: small page-side tweaks that filter lists ask
 * for with `example.com##+js(name, arg1, ...)` rules, to switch off
 * anti-adblock code, ad setups and tracking that request blocking cannot
 * reach. They are Vanta's own implementations of the behaviour the lists
 * expect under these names; the names and arguments are the lists' format.
 *
 * BlackoutChild.sys.mjs runs this file in a page before any of the page's
 * own scripts, normally in the page's own realm. Its value is a function that
 * takes the calls for the page, minus the ones the lists make exceptions for,
 * and runs them. On the first page of a content process it can instead run
 * in a sandbox that sees the page's window, so everything the page can see is
 * taken from `window` explicitly rather than from this script's globals.
 */

(() => {
  "use strict";

  const win = window;
  const {
    Array,
    Error,
    JSON,
    Object,
    Promise,
    Proxy,
    Reflect,
    RegExp,
    String,
  } = win;
  const doc = win.document;
  const toStr = value => {
    try {
      return typeof value == "function"
        ? win.Function.prototype.toString.call(value)
        : String(value);
    } catch (e) {
      return "";
    }
  };
  const log = () => {};

  // --- Shared helpers ------------------------------------------------------

  /**
   * Turns a list's text pattern into a test function. "/re/flags" is a
   * regular expression, anything else a plain substring; a leading "!"
   * inverts it; an empty pattern matches everything.
   */
  function matcher(pattern = "") {
    pattern = String(pattern);
    let invert = false;
    if (pattern.startsWith("!")) {
      invert = true;
      pattern = pattern.slice(1);
    }
    let test;
    if (pattern == "") {
      test = () => true;
    } else {
      const re = toRegExp(pattern);
      test = text => re.test(String(text));
    }
    return invert ? text => !test(text) : test;
  }

  function toRegExp(pattern, extraFlags = "") {
    const literal = /^\/(.+)\/([dgimsuvy]*)$/.exec(pattern);
    if (literal) {
      try {
        return new RegExp(
          literal[1],
          [...new Set(literal[2] + extraFlags)].join("")
        );
      } catch (e) {
        // An invalid expression matches nothing.
        return /(?!)/;
      }
    }
    return new RegExp(
      pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      extraFlags
    );
  }

  // Extra arguments after the fixed ones come as "name, value" pairs.
  function options(extras) {
    const out = new Map();
    for (let i = 0; i + 1 < extras.length; i += 2) {
      out.set(extras[i], extras[i + 1]);
    }
    return out;
  }

  const noopFunc = function () {};
  const constants = {
    undefined: () => undefined,
    false: () => false,
    true: () => true,
    null: () => null,
    noopFunc: () => noopFunc,
    noopCallbackFunc: () => () => noopFunc,
    trueFunc: () => () => true,
    falseFunc: () => () => false,
    throwFunc: () => () => {
      throw new win.Error("");
    },
    emptyArr: () => new Array(),
    emptyObj: () => new Object(),
    emptyStr: () => "",
    "''": () => "",
    "": () => "",
    yes: () => "yes",
    no: () => "no",
    noopThis: () =>
      function () {
        return this;
      },
    NaN: () => NaN,
    Infinity: () => Infinity,
  };

  /**
   * The value a list names: one of the constants above, or a small number.
   * With `trusted` any JSON value is allowed too. Returns [ok, value].
   */
  function constantValue(raw, trusted = false) {
    if (Object.prototype.hasOwnProperty.call(constants, raw)) {
      return [true, constants[raw]()];
    }
    if (/^-?\d{1,5}$/.test(raw)) {
      const n = Number(raw);
      if (Math.abs(n) <= 32767) {
        return [true, n];
      }
    }
    if (trusted) {
      try {
        return [true, JSON.parse(raw)];
      } catch (e) {
        return [true, raw];
      }
    }
    return [false, undefined];
  }

  const isObject = v =>
    v !== null && (typeof v == "object" || typeof v == "function");

  /**
   * Calls `onTarget(owner, property)` for the last link of a property chain
   * such as "a.b.c" on `window`, now or as soon as the page creates the
   * missing links.
   */
  function onChain(owner, chain, onTarget) {
    const dot = chain.indexOf(".");
    if (dot == -1) {
      onTarget(owner, chain);
      return;
    }
    const property = chain.slice(0, dot);
    const rest = chain.slice(dot + 1);
    let value;
    try {
      value = owner[property];
    } catch (e) {
      return;
    }
    if (isObject(value)) {
      onChain(value, rest, onTarget);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(owner, property);
    if (descriptor && !descriptor.configurable) {
      return;
    }
    // Wait for the page to create this link.
    let current = value;
    Object.defineProperty(owner, property, {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(next) {
        current = next;
        if (isObject(next)) {
          onChain(next, rest, onTarget);
        }
      },
    });
  }

  /** Replaces a method (by chain) with a proxy using `apply`. */
  function proxyMethod(chain, apply) {
    onChain(win, chain, (owner, property) => {
      let original;
      try {
        original = owner[property];
      } catch (e) {
        return;
      }
      if (typeof original != "function") {
        return;
      }
      try {
        owner[property] = new Proxy(original, {
          apply: (target, thisArg, args) => apply(target, thisArg, args),
        });
      } catch (e) {
        log(e);
      }
    });
  }

  function scriptText(script) {
    if (!script) {
      return "";
    }
    return script.src ? script.src : script.textContent;
  }

  // Runs `callback` once the DOM is there (now, or at DOMContentLoaded).
  // Scriptlets start before the document has even begun to load, while its
  // readyState can still read "uninitialized".
  function whenReady(callback) {
    if (doc.readyState != "interactive" && doc.readyState != "complete") {
      doc.addEventListener("DOMContentLoaded", () => callback(), {
        once: true,
      });
    } else {
      callback();
    }
  }

  // Runs `callback` now and after DOM changes, at most once per frame.
  function onDomChanges(callback, observeAttributes = false) {
    let pending = false;
    const run = () => {
      pending = false;
      try {
        callback();
      } catch (e) {
        log(e);
      }
    };
    whenReady(() => {
      run();
      const observer = new win.MutationObserver(() => {
        if (!pending) {
          pending = true;
          win.requestAnimationFrame(run);
        }
      });
      observer.observe(doc, {
        childList: true,
        subtree: true,
        attributes: observeAttributes,
      });
    });
  }

  /**
   * Request properties to match, written as space-separated "key:value"
   * items (a bare value means "url:value"). Returns a test over an object
   * of request details, or null when nothing was given.
   */
  function requestMatcher(props = "") {
    const tests = [];
    for (const item of String(props).split(/\s+/).filter(Boolean)) {
      const colon = item.indexOf(":");
      let key = "url";
      let value = item;
      if (colon > 0 && /^[a-zA-Z]+$/.test(item.slice(0, colon))) {
        key = item.slice(0, colon);
        value = item.slice(colon + 1);
      }
      const test = matcher(value);
      tests.push(details => test(details[key] ?? ""));
    }
    if (!tests.length) {
      return null;
    }
    return details => tests.every(t => t(details));
  }

  function fetchDetails(args) {
    const details = { url: "", method: "GET" };
    const [resource, init] = args;
    try {
      if (typeof resource == "string" || resource instanceof win.URL) {
        details.url = String(resource);
      } else if (isObject(resource)) {
        for (const key of [
          "url",
          "method",
          "mode",
          "credentials",
          "cache",
          "redirect",
          "referrer",
        ]) {
          if (resource[key] !== undefined) {
            details[key] = String(resource[key]);
          }
        }
      }
      if (isObject(init)) {
        for (const key of [
          "method",
          "body",
          "mode",
          "credentials",
          "cache",
          "redirect",
          "referrer",
        ]) {
          if (init[key] !== undefined) {
            details[key] = String(init[key]);
          }
        }
      }
    } catch (e) {
      log(e);
    }
    return details;
  }

  // A trusted list may also give the body itself.
  function fakeBody(raw, trusted = false) {
    switch (raw) {
      case "emptyObj":
        return "{}";
      case "emptyArr":
        return "[]";
      default:
        return trusted ? String(raw) : "";
    }
  }

  function preventFetch(props, responseBody, trusted) {
    const test = requestMatcher(props) ?? (() => true);
    proxyMethod("fetch", (target, thisArg, args) => {
      const details = fetchDetails(args);
      if (!test(details)) {
        return Reflect.apply(target, thisArg, args);
      }
      return Promise.resolve(
        fakeResponse(fakeBody(responseBody, trusted), details.url)
      );
    });
  }

  function preventXhr(props, responseBody, trusted) {
    const test = requestMatcher(props) ?? (() => true);
    trackXhr();
    proxyMethod("XMLHttpRequest.prototype.send", (target, thisArg, args) => {
      const details = xhrDetails.get(thisArg);
      if (!details || !test(details)) {
        return Reflect.apply(target, thisArg, args);
      }
      const body = fakeBody(responseBody, trusted);
      const fields = {
        readyState: 4,
        status: 200,
        statusText: "OK",
        response: body,
        responseText: body,
        responseURL: details.url,
      };
      for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(thisArg, key, { value, configurable: true });
      }
      win.setTimeout(() => {
        for (const type of ["readystatechange", "load", "loadend"]) {
          thisArg.dispatchEvent(new win.Event(type));
        }
      }, 1);
      return undefined;
    });
  }

  function fakeResponse(body, url) {
    const response = new win.Response(body, {
      status: 200,
      statusText: "OK",
    });
    try {
      Object.defineProperty(response, "url", { value: url });
      Object.defineProperty(response, "type", { value: "basic" });
    } catch (e) {
      log(e);
    }
    return response;
  }

  // XMLHttpRequest calls the lists target: the details `open` was given.
  const xhrDetails = new win.WeakMap();
  let xhrOpenPatched = false;
  function trackXhr() {
    if (xhrOpenPatched) {
      return;
    }
    xhrOpenPatched = true;
    proxyMethod("XMLHttpRequest.prototype.open", (target, thisArg, args) => {
      xhrDetails.set(thisArg, {
        method: String(args[0] ?? "GET"),
        url: String(args[1] ?? ""),
      });
      return Reflect.apply(target, thisArg, args);
    });
  }

  // --- JSON pruning ----------------------------------------------------

  function splitPath(path) {
    return path.split(".").filter(Boolean);
  }

  // Whether `path` exists in `value` ("[]" and "*" match any key).
  function hasPath(value, parts) {
    if (!parts.length) {
      return true;
    }
    if (!isObject(value)) {
      return false;
    }
    const [head, ...rest] = parts;
    if (head == "[]" || head == "*") {
      return Object.keys(value).some(k => hasPath(value[k], rest));
    }
    return (
      Object.prototype.hasOwnProperty.call(value, head) &&
      hasPath(value[head], rest)
    );
  }

  // Removes `path` from `value`. "[-]" removes the array items (or object
  // entries) that contain the rest of the path. Returns whether it did.
  function prunePath(value, parts) {
    if (!isObject(value) || !parts.length) {
      return false;
    }
    const [head, ...rest] = parts;
    if (head == "[-]") {
      let pruned = false;
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          if (hasPath(value[i], rest)) {
            value.splice(i, 1);
            pruned = true;
          }
        }
      } else {
        for (const key of Object.keys(value)) {
          if (hasPath(value[key], rest)) {
            delete value[key];
            pruned = true;
          }
        }
      }
      return pruned;
    }
    if (head == "[]" || head == "*") {
      let pruned = false;
      for (const key of Object.keys(value)) {
        if (rest.length ? prunePath(value[key], rest) : delete value[key]) {
          pruned = true;
        }
      }
      return pruned;
    }
    if (!Object.prototype.hasOwnProperty.call(value, head)) {
      return false;
    }
    if (!rest.length) {
      return delete value[head];
    }
    return prunePath(value[head], rest);
  }

  /** A function that prunes an object as json-prune and friends describe. */
  function pruner(rawPrunePaths = "", rawNeedlePaths = "") {
    const prunePaths = String(rawPrunePaths)
      .split(/\s+/)
      .filter(Boolean)
      .map(splitPath);
    const needlePaths = String(rawNeedlePaths)
      .split(/\s+/)
      .filter(Boolean)
      .map(splitPath);
    return object => {
      if (!isObject(object)) {
        return false;
      }
      if (needlePaths.length && !needlePaths.every(p => hasPath(object, p))) {
        return false;
      }
      let pruned = false;
      for (const path of prunePaths) {
        if (prunePath(object, path)) {
          pruned = true;
        }
      }
      return pruned;
    };
  }

  // --- The scriptlets ------------------------------------------------------

  const scriptlets = {
    "set-constant"(chain, rawValue, ...extras) {
      setConstant(chain, rawValue, extras, false);
    },

    "trusted-set-constant"(chain, rawValue, ...extras) {
      setConstant(chain, rawValue, extras, true);
    },

    "abort-on-property-read"(chain) {
      onChain(win, chain, (owner, property) => {
        const descriptor = Object.getOwnPropertyDescriptor(owner, property);
        if (descriptor && !descriptor.configurable) {
          return;
        }
        Object.defineProperty(owner, property, {
          configurable: true,
          get() {
            throw new win.ReferenceError(chain);
          },
          set() {},
        });
      });
    },

    "abort-on-property-write"(chain) {
      onChain(win, chain, (owner, property) => {
        const descriptor = Object.getOwnPropertyDescriptor(owner, property);
        if (descriptor && !descriptor.configurable) {
          return;
        }
        const value = (descriptor ?? findDescriptor(owner, property))?.value;
        Object.defineProperty(owner, property, {
          configurable: true,
          get() {
            return value;
          },
          set() {
            throw new win.ReferenceError(chain);
          },
        });
      });
    },

    "abort-current-script"(chain, needle = "") {
      const test = matcher(needle);
      const thisScript = doc.currentScript;
      abortWhen(chain, () => {
        const script = doc.currentScript;
        return script && script != thisScript && test(scriptText(script));
      });
    },

    "abort-on-stack-trace"(chain, needle = "") {
      const test = matcher(needle);
      abortWhen(chain, () => test(new win.Error().stack ?? ""));
    },

    "no-window-open-if"(needle = "") {
      const test = matcher(needle);
      proxyMethod("open", (target, thisArg, args) => {
        if (test(String(args[0] ?? ""))) {
          return null;
        }
        return Reflect.apply(target, thisArg, args);
      });
    },

    "no-setTimeout-if"(needle = "", delay = "") {
      deferIf("setTimeout", needle, delay);
    },

    "no-setInterval-if"(needle = "", delay = "") {
      deferIf("setInterval", needle, delay);
    },

    "nano-setTimeout-booster"(needle = "", delay = "1000", boost = "0.05") {
      boostTimer("setTimeout", needle, delay, boost);
    },

    "nano-setInterval-booster"(needle = "", delay = "1000", boost = "0.05") {
      boostTimer("setInterval", needle, delay, boost);
    },

    "addEventListener-defuser"(type = "", needle = "") {
      const testType = matcher(type);
      const testHandler = matcher(needle);
      proxyMethod(
        "EventTarget.prototype.addEventListener",
        (target, thisArg, args) => {
          if (testType(String(args[0])) && testHandler(toStr(args[1]))) {
            return undefined;
          }
          return Reflect.apply(target, thisArg, args);
        }
      );
    },

    noeval() {
      proxyMethod("eval", () => undefined);
    },

    "noeval-if"(needle = "") {
      const test = matcher(needle);
      proxyMethod("eval", (target, thisArg, args) => {
        if (test(String(args[0]))) {
          return undefined;
        }
        return Reflect.apply(target, thisArg, args);
      });
    },

    "no-fetch-if"(props = "", responseBody = "") {
      preventFetch(props, responseBody, false);
    },

    "trusted-prevent-fetch"(props = "", responseBody = "") {
      preventFetch(props, responseBody, true);
    },

    "no-xhr-if"(props = "", responseBody = "") {
      preventXhr(props, responseBody, false);
    },

    "trusted-prevent-xhr"(props = "", responseBody = "") {
      preventXhr(props, responseBody, true);
    },

    "json-prune"(prunePaths = "", needlePaths = "") {
      const prune = pruner(prunePaths, needlePaths);
      proxyMethod("JSON.parse", (target, thisArg, args) => {
        const result = Reflect.apply(target, thisArg, args);
        prune(result);
        return result;
      });
      proxyMethod("Response.prototype.json", (target, thisArg, args) =>
        Reflect.apply(target, thisArg, args).then(result => {
          prune(result);
          return result;
        })
      );
    },

    "json-prune-fetch-response"(prunePaths = "", needlePaths = "", ...extras) {
      const prune = pruner(prunePaths, needlePaths);
      editFetchResponse(extras, text => {
        let object;
        try {
          object = JSON.parse(text);
        } catch (e) {
          return text;
        }
        return prune(object) ? JSON.stringify(object) : text;
      });
    },

    "json-prune-xhr-response"(prunePaths = "", needlePaths = "", ...extras) {
      const prune = pruner(prunePaths, needlePaths);
      editXhrResponse(extras, value => {
        if (typeof value == "string") {
          let object;
          try {
            object = JSON.parse(value);
          } catch (e) {
            return value;
          }
          return prune(object) ? JSON.stringify(object) : value;
        }
        prune(value);
        return value;
      });
    },

    "trusted-replace-fetch-response"(
      pattern = "",
      replacement = "",
      props = ""
    ) {
      if (!pattern) {
        return;
      }
      const re = toRegExp(pattern, "g");
      editFetchResponse(["propsToMatch", props], text =>
        text.replace(re, replacement)
      );
    },

    "trusted-replace-xhr-response"(pattern = "", replacement = "", props = "") {
      if (!pattern) {
        return;
      }
      const re = toRegExp(pattern, "g");
      editXhrResponse(["propsToMatch", props], value =>
        typeof value == "string" ? value.replace(re, replacement) : value
      );
    },

    "remove-node-text"(nodeName = "", needle = "", ...extras) {
      const test = matcher(needle);
      editNodes(nodeName, extras, node => {
        if (test(node.textContent)) {
          // A parser-inserted script that is already in the document still
          // runs when removed, but not when emptied first.
          if (node.nodeName == "SCRIPT") {
            node.textContent = "";
          }
          node.remove();
        }
      });
    },

    "replace-node-text"(
      nodeName = "",
      pattern = "",
      replacement = "",
      ...extras
    ) {
      if (!pattern) {
        return;
      }
      const re = toRegExp(pattern, "g");
      const condition = options(extras).get("condition");
      const testCondition = condition ? matcher(condition) : () => true;
      editNodes(nodeName, extras, node => {
        const before = node.textContent;
        if (!testCondition(before)) {
          return;
        }
        const after = before.replace(re, replacement);
        if (after != before) {
          node.textContent = after;
        }
      });
    },

    "remove-attr"(attributes = "", selector = "") {
      const names = String(attributes)
        .split(/\s*\|\s*/)
        .filter(Boolean);
      if (!names.length) {
        return;
      }
      const query = selector || names.map(n => `[${CSS.escape(n)}]`).join(",");
      onDomChanges(() => {
        for (const element of doc.querySelectorAll(query)) {
          for (const name of names) {
            element.removeAttribute(name);
          }
        }
      }, true);
    },

    "remove-class"(classes = "", selector = "") {
      const names = String(classes)
        .split(/\s*\|\s*/)
        .filter(Boolean);
      if (!names.length) {
        return;
      }
      const query = selector || names.map(n => `.${CSS.escape(n)}`).join(",");
      onDomChanges(() => {
        for (const element of doc.querySelectorAll(query)) {
          element.classList.remove(...names);
        }
      }, true);
    },

    "href-sanitizer"(selector = "", source = "text") {
      if (!selector) {
        return;
      }
      onDomChanges(() => {
        for (const link of doc.querySelectorAll(selector)) {
          const href = sanitizedHref(link, source);
          if (href && link.getAttribute("href") != href) {
            link.setAttribute("href", href);
          }
        }
      });
    },

    "set-local-storage-item"(key, value) {
      setStorageItem("localStorage", key, value, false);
    },

    "set-session-storage-item"(key, value) {
      setStorageItem("sessionStorage", key, value, false);
    },

    "trusted-set-local-storage-item"(key, value) {
      setStorageItem("localStorage", key, value, true);
    },

    "remove-cookie"(needle = "") {
      const test = matcher(needle);
      const remove = () => {
        for (const pair of doc.cookie.split(";")) {
          const name = pair.split("=")[0].trim();
          if (name && test(name)) {
            expireCookie(name);
          }
        }
      };
      remove();
      win.addEventListener("beforeunload", remove);
    },

    "set-cookie"(name = "", value = "", path = "", ...extras) {
      const allowed =
        /^(?:true|false|yes|no|y|n|ok|on|off|accept|accepted|reject|rejected|allow|allowed|deny|denied|necessary|required|hide|hidden|essential|nonessential|checked|unchecked|forbidden|forever|-?\d{1,5}|)$/i;
      if (!allowed.test(value)) {
        return;
      }
      setCookie(name, value, path, extras);
    },

    "trusted-set-cookie"(
      name = "",
      value = "",
      offset = "",
      path = "",
      ...extras
    ) {
      if (value == "$now$") {
        value = String(Date.now());
      } else if (value == "$currentDate$") {
        value = new win.Date().toUTCString();
      }
      setCookie(name, value, path, extras);
    },

    nowebrtc() {
      const fake = function () {
        const noop = () => {};
        const resolved = () => Promise.resolve();
        return {
          close: noop,
          createDataChannel: () => ({ close: noop }),
          createOffer: resolved,
          createAnswer: resolved,
          setLocalDescription: resolved,
          setRemoteDescription: resolved,
          addIceCandidate: resolved,
          addEventListener: noop,
          removeEventListener: noop,
          getStats: resolved,
        };
      };
      for (const name of [
        "RTCPeerConnection",
        "webkitRTCPeerConnection",
        "mozRTCPeerConnection",
      ]) {
        if (typeof win[name] == "function") {
          try {
            win[name] = fake;
          } catch (e) {
            log(e);
          }
        }
      }
    },

    "fuckadblock-defuser"() {
      class Detector {
        onDetected() {
          return this;
        }
        onNotDetected(callback) {
          if (typeof callback == "function") {
            win.setTimeout(callback, 1);
          }
          return this;
        }
        on(detected, callback) {
          return detected ? this : this.onNotDetected(callback);
        }
        check() {
          return false;
        }
        emitEvent() {
          return this;
        }
        clearEvent() {}
        setOption() {
          return this;
        }
      }
      for (const name of ["FuckAdBlock", "BlockAdBlock", "SniffAdBlock"]) {
        try {
          Object.defineProperty(win, name, {
            value: Detector,
            configurable: true,
          });
          const instance = name[0].toLowerCase() + name.slice(1);
          Object.defineProperty(win, instance, {
            value: new Detector(),
            configurable: true,
          });
        } catch (e) {
          log(e);
        }
      }
    },

    "trusted-replace-argument"(
      chain,
      position = "0",
      rawValue = "",
      ...extras
    ) {
      const index = Number.parseInt(position, 10);
      if (!chain || Number.isNaN(index)) {
        return;
      }
      let value;
      if (rawValue.startsWith("json:")) {
        try {
          value = JSON.parse(rawValue.slice(5));
        } catch (e) {
          return;
        }
      } else {
        const [ok, constant] = constantValue(rawValue, true);
        if (!ok) {
          return;
        }
        value = constant;
      }
      const condition = options(extras).get("condition");
      const test = condition ? matcher(condition) : () => true;
      proxyMethod(chain, (target, thisArg, args) => {
        const at = index < 0 ? args.length + index : index;
        if (
          at >= 0 &&
          at < Math.max(args.length, at + 1) &&
          test(toStr(args[at]))
        ) {
          args = [...args];
          args[at] = value;
        }
        return Reflect.apply(target, thisArg, args);
      });
    },

    "trusted-prevent-dom-bypass"(methodChain = "", targetChain = "") {
      if (!methodChain) {
        return;
      }
      proxyMethod(methodChain, (target, thisArg, args) => {
        const result = Reflect.apply(target, thisArg, args);
        for (const node of args) {
          for (const frame of framesIn(node)) {
            try {
              const frameWindow = frame.contentWindow;
              if (!frameWindow) {
                continue;
              }
              if (targetChain) {
                copyChain(targetChain, win, frameWindow);
              } else {
                // Without a target, the frame's window is this one's.
                Object.defineProperty(frame, "contentWindow", { value: win });
              }
            } catch (e) {
              log(e);
            }
          }
        }
        return result;
      });
    },
  };

  const aliases = {
    set: "set-constant",
    "trusted-set": "trusted-set-constant",
    aopr: "abort-on-property-read",
    aopw: "abort-on-property-write",
    acs: "abort-current-script",
    acis: "abort-current-script",
    "abort-current-inline-script": "abort-current-script",
    aost: "abort-on-stack-trace",
    nowoif: "no-window-open-if",
    "prevent-window-open": "no-window-open-if",
    "window.open-defuser": "no-window-open-if",
    nostif: "no-setTimeout-if",
    "prevent-setTimeout": "no-setTimeout-if",
    "setTimeout-defuser": "no-setTimeout-if",
    nosiif: "no-setInterval-if",
    "prevent-setInterval": "no-setInterval-if",
    "setInterval-defuser": "no-setInterval-if",
    "nano-stb": "nano-setTimeout-booster",
    "nano-sib": "nano-setInterval-booster",
    aeld: "addEventListener-defuser",
    "prevent-addEventListener": "addEventListener-defuser",
    "prevent-eval-if": "noeval-if",
    "prevent-fetch": "no-fetch-if",
    "prevent-xhr": "no-xhr-if",
    rmnt: "remove-node-text",
    rpnt: "replace-node-text",
    "trusted-replace-node-text": "replace-node-text",
    "trusted-rpnt": "replace-node-text",
    ra: "remove-attr",
    rc: "remove-class",
    "cookie-remover": "remove-cookie",
    nofab: "fuckadblock-defuser",
    "trusted-rpfr": "trusted-replace-fetch-response",
  };

  function canonicalName(name) {
    name = String(name).trim().replace(/\.js$/, "");
    return aliases[name] ?? name;
  }

  // --- Scriptlet internals -------------------------------------------------

  function setConstant(chain, rawValue, extras, trusted) {
    if (!chain) {
      return;
    }
    const [ok, value] = constantValue(rawValue, trusted);
    if (!ok) {
      return;
    }
    onChain(win, chain, (owner, property) => {
      const descriptor = Object.getOwnPropertyDescriptor(owner, property);
      if (descriptor && !descriptor.configurable) {
        return;
      }
      Object.defineProperty(owner, property, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          return value;
        },
        set() {},
      });
    });
  }

  // Makes reading or writing the property at `chain` throw when `abort()`
  // says so, and behave as before otherwise.
  // The descriptor `owner[property]` resolves to, own or inherited (such as
  // a method on the prototype).
  function findDescriptor(owner, property) {
    for (let o = owner; o; o = Object.getPrototypeOf(o)) {
      const descriptor = Object.getOwnPropertyDescriptor(o, property);
      if (descriptor) {
        return descriptor;
      }
    }
    return undefined;
  }

  function abortWhen(chain, abort) {
    onChain(win, chain, (owner, property) => {
      const own = Object.getOwnPropertyDescriptor(owner, property);
      if (own && !own.configurable) {
        return;
      }
      const descriptor = own ?? findDescriptor(owner, property);
      let value = descriptor?.value;
      const getter = descriptor?.get;
      const setter = descriptor?.set;
      Object.defineProperty(owner, property, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          if (abort()) {
            throw new win.ReferenceError(chain);
          }
          return getter ? getter.call(this) : value;
        },
        set(next) {
          if (abort()) {
            throw new win.ReferenceError(chain);
          }
          if (setter) {
            setter.call(this, next);
          } else {
            value = next;
          }
        },
      });
    });
  }

  function delayMatcher(delay) {
    delay = String(delay ?? "");
    if (delay == "") {
      return () => true;
    }
    const invert = delay.startsWith("!");
    const wanted = Number(invert ? delay.slice(1) : delay);
    return actual => (Number(actual) == wanted) != invert;
  }

  function deferIf(timer, needle, delay) {
    const test = matcher(needle);
    const testDelay = delayMatcher(delay);
    proxyMethod(timer, (target, thisArg, args) => {
      if (test(toStr(args[0])) && testDelay(args[1] ?? 0)) {
        // Keep the page's bookkeeping working with a harmless timer.
        return Reflect.apply(target, thisArg, [noopFunc, args[1]]);
      }
      return Reflect.apply(target, thisArg, args);
    });
  }

  function boostTimer(timer, needle, delay, boost) {
    const test = matcher(needle);
    const wanted = delay == "*" ? null : Number(delay || 1000);
    let factor = Number(boost);
    if (!Number.isFinite(factor)) {
      factor = 0.05;
    }
    factor = Math.min(Math.max(factor, 0.001), 50);
    proxyMethod(timer, (target, thisArg, args) => {
      if (
        test(toStr(args[0])) &&
        (wanted === null || Number(args[1]) == wanted)
      ) {
        args = [...args];
        args[1] = Number(args[1] ?? 0) * factor;
      }
      return Reflect.apply(target, thisArg, args);
    });
  }

  // Edits the text of fetch responses whose request matches "propsToMatch"
  // (in the extra options); all fetch responses without it.
  function editFetchResponse(extras, edit) {
    const test =
      requestMatcher(options(extras).get("propsToMatch")) ?? (() => true);
    proxyMethod("fetch", (target, thisArg, args) => {
      const details = fetchDetails(args);
      const pending = Reflect.apply(target, thisArg, args);
      if (!test(details)) {
        return pending;
      }
      return pending.then(response =>
        response
          .clone()
          .text()
          .then(text => {
            const edited = edit(text);
            if (edited === text) {
              return response;
            }
            const replaced = new win.Response(edited, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
            for (const key of ["url", "type", "redirected"]) {
              Object.defineProperty(replaced, key, { value: response[key] });
            }
            return replaced;
          })
          .catch(() => response)
      );
    });
  }

  function editXhrResponse(extras, edit) {
    const test =
      requestMatcher(options(extras).get("propsToMatch")) ?? (() => true);
    trackXhr();
    const edited = new win.WeakMap();
    const read = (xhr, original) => {
      if (xhr.readyState != 4 || !test(xhrDetails.get(xhr) ?? {})) {
        return original;
      }
      if (!edited.has(xhr)) {
        edited.set(xhr, edit(original));
      }
      return edited.get(xhr);
    };
    for (const property of ["response", "responseText"]) {
      const descriptor = Object.getOwnPropertyDescriptor(
        win.XMLHttpRequest.prototype,
        property
      );
      if (!descriptor?.get) {
        continue;
      }
      Object.defineProperty(win.XMLHttpRequest.prototype, property, {
        ...descriptor,
        get: new Proxy(descriptor.get, {
          apply: (target, thisArg, args) => {
            const original = Reflect.apply(target, thisArg, args);
            try {
              return read(thisArg, original);
            } catch (e) {
              return original;
            }
          },
        }),
      });
    }
  }

  // Watches for elements named `nodeName` ("script", "#text", ...) as the
  // parser adds them, early enough to change scripts before they run.
  function editNodes(nodeName, extras, edit) {
    const name = String(nodeName).toUpperCase();
    const opts = options(extras);
    const quitAfter = Number(opts.get("quitAfter") ?? 0);
    const test = name.startsWith("/")
      ? matcher(nodeName)
      : n => n.toUpperCase() == name;
    const visit = node => {
      if (test(node.nodeName)) {
        try {
          edit(node);
        } catch (e) {
          log(e);
        }
      }
    };
    const walker = root => {
      if (root.nodeType == 1 && name != "#TEXT") {
        visit(root);
        for (const element of root.querySelectorAll("*")) {
          visit(element);
        }
      } else {
        visit(root);
      }
    };
    walker(doc.documentElement ?? doc);
    const observer = new win.MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          // Text the parser adds to an element already in the document.
          if (node.nodeType == 3 && name != "#TEXT" && node.parentNode) {
            visit(node.parentNode);
          } else {
            visit(node);
          }
        }
      }
    });
    observer.observe(doc, { childList: true, subtree: true });
    if (quitAfter > 0) {
      win.setTimeout(() => observer.disconnect(), quitAfter);
    } else {
      whenReady(() => win.setTimeout(() => observer.disconnect(), 0));
    }
  }

  function sanitizedHref(link, source) {
    if (source == "text") {
      const text = link.textContent.trim();
      return /^https?:\/\//.test(text) ? text : "";
    }
    if (source.startsWith("?")) {
      try {
        const value = new win.URL(link.href).searchParams.get(source.slice(1));
        return value && /^https?:\/\//.test(value) ? value : "";
      } catch (e) {
        return "";
      }
    }
    if (source.startsWith("[") && source.endsWith("]")) {
      const value = link.getAttribute(source.slice(1, -1)) ?? "";
      return /^https?:\/\//.test(value) ? value : "";
    }
    return "";
  }

  function setStorageItem(storageName, key, rawValue, trusted) {
    if (!key) {
      return;
    }
    let storage;
    try {
      storage = win[storageName];
    } catch (e) {
      return;
    }
    if (rawValue == "$remove$") {
      storage.removeItem(key);
      return;
    }
    let value;
    if (trusted) {
      value = rawValue == "$now$" ? String(Date.now()) : rawValue;
    } else {
      const allowed =
        /^(?:undefined|false|true|null|emptyArr|emptyObj|yes|no|on|off|accept|reject|-?\d{1,5}|)$/;
      if (!allowed.test(rawValue)) {
        return;
      }
      value = { emptyArr: "[]", emptyObj: "{}" }[rawValue] ?? rawValue;
    }
    try {
      storage.setItem(key, value);
    } catch (e) {
      log(e);
    }
  }

  function expireCookie(name) {
    const expired = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    const host = win.location.hostname;
    const domains = ["", host, "." + host];
    const parts = host.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
      domains.push("." + parts.slice(i).join("."));
    }
    for (const domain of domains) {
      for (const path of ["", "; path=/"]) {
        doc.cookie = expired + (domain ? `; domain=${domain}` : "") + path;
      }
    }
  }

  function setCookie(name, value, path, extras) {
    if (!name || /[;=\s]/.test(name) || /[;\s]/.test(value)) {
      return;
    }
    const exists = doc.cookie
      .split(";")
      .some(pair => pair.split("=")[0].trim() == name);
    if (exists) {
      return;
    }
    let cookie = `${name}=${encodeURIComponent(value)}`;
    if (path == "/" || path == "none" || path == "") {
      cookie += path == "none" ? "" : "; path=/";
    }
    doc.cookie = cookie;
    if (options(extras).has("reload") && doc.cookie.includes(`${name}=`)) {
      win.location.reload();
    }
  }

  function* framesIn(node) {
    if (!isObject(node) || node.nodeType != 1) {
      return;
    }
    if (node.nodeName == "IFRAME" || node.nodeName == "FRAME") {
      yield node;
    }
    if (node.querySelectorAll) {
      yield* node.querySelectorAll("iframe,frame");
    }
  }

  // Copies the value at `chain` from one window to another, so a fresh frame
  // cannot hand the page an untouched copy.
  function copyChain(chain, from, to) {
    const parts = chain.split(".");
    const last = parts.pop();
    let source = from;
    let target = to;
    for (const part of parts) {
      source = source?.[part];
      target = target?.[part];
    }
    if (isObject(source) && isObject(target)) {
      target[last] = source[last];
    }
  }

  // --- Entry point -----------------------------------------------------

  const key = call => [canonicalName(call[0]), ...call.slice(1)].join("\u0000");

  /**
   * Runs `calls` ([name, ...args] arrays) except those in `exceptions`.
   * Unknown scriptlets are skipped, and one failing does not stop the rest.
   */
  function run(calls, exceptions) {
    const skip = new Set(Array.from(exceptions ?? [], key));
    const seen = new Set();
    for (const call of calls) {
      const id = key(call);
      if (skip.has(id) || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const name = canonicalName(call[0]);
      const scriptlet = Object.hasOwn(scriptlets, name) && scriptlets[name];
      if (!scriptlet) {
        continue;
      }
      try {
        scriptlet(...Array.from(call.slice(1), String));
      } catch (e) {
        log(e);
      }
    }
  }

  // Whether `name` is a scriptlet this library has, so the parent can leave
  // the others out of the table it shares.
  run.supports = name => Object.hasOwn(scriptlets, canonicalName(name));

  return run;
})();
