/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// After the page has loaded, look once more for late content this long after.
const LATE_SURVEY_MS = 5000;

const PREF_ENABLED = "privacy.trackingprotection.content.protection.enabled";
const PREF_SCRIPTLETS = "vanta.blackout.scriptlets.enabled";
const SCRIPTLETS_URL = "resource:///actors/BlackoutScriptlets.js";

// Shared by Blackout.sys.mjs in the parent process. The host index is split
// by the hosts' first character.
const SHARED_HOSTS = "Blackout:ScriptletHosts:";
const SHARED_CALLS = "Blackout:ScriptletCalls";
const SHARED_SOURCE = "Blackout:ScriptletSource";

// The scriptlet library, compiled once per process. Until it is ready (the
// first page of a process) the source from sharedData runs in a sandbox.
let compiledScriptlets = null;
ChromeUtils.compileScript(SCRIPTLETS_URL, { hasReturnValue: true }).then(
  script => (compiledScriptlets = script),
  console.error
);

// This process's copy of the parts of the shared scriptlet table it used,
// dropped when the parent shares a new table.
let sharedTable = null;
Services.cpmm.sharedData.addEventListener("change", event => {
  if (event.changedKeys.includes(SHARED_CALLS)) {
    sharedTable = null;
  }
});

function scriptletTable() {
  sharedTable ??= {
    published: Services.cpmm.sharedData.has(SHARED_CALLS),
    hosts: new Map(),
    calls: null,
  };
  return sharedTable;
}

// The calls listed for `name` in the table: [calls, exceptions].
function lookUp(table, name) {
  let hosts = table.hosts.get(name[0]);
  if (hosts === undefined) {
    hosts = Services.cpmm.sharedData.get(SHARED_HOSTS + name[0]) ?? "";
    table.hosts.set(name[0], hosts);
  }
  const start = hosts.indexOf(`\n${name}\t`);
  if (start < 0) {
    return null;
  }
  const end = hosts.indexOf("\n", start + 1);
  const [, calls, exceptions] = hosts.slice(start + 1, end).split("\t");
  const numbers = list => (list ? list.split(",").map(Number) : []);
  return [numbers(calls), numbers(exceptions)];
}

/**
 * The names a page's scriptlets can be listed under, most specific first:
 * its host and each parent domain, the same with "*" for the public suffix
 * (example.* covers example.com and example.co.uk), then "*" for all sites.
 */
function siteNames(host) {
  let suffix = "";
  try {
    suffix = Services.eTLD.getPublicSuffixFromHost(host);
  } catch (e) {
    // An IP address or a single-label host has none.
  }
  const names = [];
  for (let name = host; name; ) {
    names.push(name);
    if (
      suffix &&
      name.length > suffix.length + 1 &&
      name.endsWith("." + suffix)
    ) {
      names.push(name.slice(0, -suffix.length) + "*");
    }
    const dot = name.indexOf(".");
    name = dot < 0 ? "" : name.slice(dot + 1);
  }
  names.push("*");
  return names;
}

/**
 * Hides the page elements Blackout's filter lists name, with user style
 * sheets. A page gets its site-specific sheet as soon as it starts. The lists'
 * generic rules are too many to give every page, so the page's CSS classes
 * and ids are surveyed when the browser is idle (after DOMContentLoaded,
 * after load and once more a little later) and only the rules that target
 * them come back. Pages with nothing to hide get no sheet at all.
 *
 * It also runs the lists' scriptlets for the page's site, in the page itself,
 * when its window is created and before any of the page's own scripts.
 */
export class BlackoutChild extends JSWindowActorChild {
  #seenClasses = new Set();
  #seenIds = new Set();
  #surveyPending = false;

  handleEvent(event) {
    if (event.target != this.document) {
      return;
    }
    switch (event.type) {
      case "DOMWindowCreated":
        this.#runScriptlets();
        break;
      case "DOMDocElementInserted":
        this.#query("Blackout:GetStyle");
        break;
      case "DOMContentLoaded":
        this.#scheduleSurvey();
        this.contentWindow.addEventListener(
          "load",
          () => {
            this.#scheduleSurvey();
            try {
              this.contentWindow.setTimeout(
                () => this.#scheduleSurvey(),
                LATE_SURVEY_MS
              );
            } catch (e) {
              // The page went away.
            }
          },
          { once: true }
        );
        break;
    }
  }

  #runScriptlets() {
    const shared = Services.cpmm.sharedData;
    const table = scriptletTable();
    if (
      !table.published ||
      !Services.prefs.getBoolPref(PREF_ENABLED, false) ||
      !Services.prefs.getBoolPref(PREF_SCRIPTLETS, true)
    ) {
      return;
    }
    const document = this.document;
    // The shield's per-site toggle turns Blackout off for the site.
    if (this.#isOnAllowList()) {
      return;
    }
    let host;
    try {
      host = document.documentURIObject.host.toLowerCase();
    } catch (e) {
      return;
    }

    const include = new Set();
    const exclude = new Set();
    for (const name of siteNames(host)) {
      const [calls, exceptions] = lookUp(table, name) ?? [[], []];
      for (const i of calls) {
        include.add(i);
      }
      for (const i of exceptions) {
        exclude.add(i);
      }
    }
    if (!include.size || exclude.has(-1)) {
      return;
    }
    table.calls ??= shared.get(SHARED_CALLS).split("\n");
    const call = i => JSON.parse(table.calls[i]);
    const calls = [];
    for (const i of include) {
      if (!exclude.has(i)) {
        calls.push(call(i));
      }
    }
    // Exceptions also match calls listed under another name (aopr and
    // abort-on-property-read), so the library gets them as calls too.
    const exceptions = Array.from(exclude, call);
    if (!calls.length) {
      return;
    }

    const win = this.contentWindow;
    try {
      let run;
      let scope = win;
      if (compiledScriptlets) {
        run = compiledScriptlets.executeInGlobal(win);
      } else {
        scope = Cu.Sandbox(win, {
          sandboxPrototype: win,
          wantXrays: false,
          sameZoneAs: win,
        });
        run = Cu.evalInSandbox(
          shared.get(SHARED_SOURCE),
          scope,
          null,
          SCRIPTLETS_URL,
          1
        );
      }
      run(Cu.cloneInto(calls, scope), Cu.cloneInto(exceptions, scope));
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Whether the page's site is on the shield's allow list, read the way
   * ContentBlockingAllowList.sys.mjs writes it: a permission on the top
   * page's principal. A frame whose top page lives in another process cannot
   * see that principal here and is treated as not on the list.
   */
  #isOnAllowList() {
    try {
      const top = this.browsingContext.top;
      const principal =
        this.document.contentBlockingAllowListPrincipal ??
        top.window?.document.nodePrincipal;
      if (!principal?.isContentPrincipal) {
        return false;
      }
      const type = this.browsingContext.usePrivateBrowsing
        ? "trackingprotection-pb"
        : "trackingprotection";
      return (
        Services.perms.testExactPermissionFromPrincipal(principal, type) ==
        Services.perms.ALLOW_ACTION
      );
    } catch (e) {
      return false;
    }
  }

  #scheduleSurvey() {
    if (this.#surveyPending) {
      return;
    }
    try {
      this.contentWindow.requestIdleCallback(() => {
        this.#surveyPending = false;
        this.#survey();
      });
      this.#surveyPending = true;
    } catch (e) {
      // The page went away.
    }
  }

  // Reports the classes and ids that appeared since the last survey.
  #survey() {
    const classes = [];
    const ids = [];
    let elements;
    try {
      elements = this.document.querySelectorAll("[class],[id]");
    } catch (e) {
      // The page went away.
      return;
    }
    for (const element of elements) {
      for (const name of element.classList) {
        if (!this.#seenClasses.has(name)) {
          this.#seenClasses.add(name);
          classes.push(name);
        }
      }
      const id = element.id;
      if (id && !this.#seenIds.has(id)) {
        this.#seenIds.add(id);
        ids.push(id);
      }
    }
    if (classes.length || ids.length) {
      this.#query("Blackout:GetClassIdStyle", { classes, ids });
    }
  }

  async #query(name, data) {
    const document = this.document;
    let css;
    try {
      css = await this.sendQuery(name, data);
    } catch (e) {
      // The page went away before the answer came back.
      return;
    }
    if (!css) {
      return;
    }

    try {
      if (this.document != document) {
        return;
      }
      // A user sheet with !important wins over the page's own styles,
      // !important included.
      this.contentWindow.windowUtils.loadSheetUsingURIString(
        "data:text/css;charset=utf-8," + encodeURIComponent(css),
        Ci.nsIDOMWindowUtils.USER_SHEET
      );
    } catch (e) {
      // The window closed in the meantime.
    }
  }
}
