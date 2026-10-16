/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

// Vanta: small fixes that let desktop apps talk to their browser extensions.

export const VantaIntegrations = {
  // Vanta reads native messaging manifests from the same folder as Firefox
  // (~/Library/Application Support/Mozilla/NativeMessagingHosts on macOS,
  // ~/.mozilla/native-messaging-hosts on Linux). Desktop apps such as
  // Bitwarden only write their manifest there when the parent folder already
  // exists, which it doesn't on a Mac that never had Firefox installed, so
  // the extension's "unlock with biometrics" can't reach the desktop app.
  // Creating the empty folder is enough for the app to find Vanta.
  async ensureNativeMessagingDir() {
    let root;
    try {
      root = Services.dirsvc.get("XREUserNativeManifests", Ci.nsIFile).path;
    } catch (e) {
      return; // Not defined on this platform (Windows uses the registry).
    }
    const leaf =
      AppConstants.platform == "macosx"
        ? "NativeMessagingHosts"
        : "native-messaging-hosts";
    try {
      await IOUtils.makeDirectory(PathUtils.join(root, leaf), {
        createAncestors: true,
        ignoreExisting: true,
      });
    } catch (e) {
      console.warn("Vanta: could not create the native messaging folder", e);
    }
  },
};

// Vanta's results page is DuckDuckGo's script-free HTML page, restyled by
// VantaSearchSkin in the browser window. This actor adds what that page
// lacks: the views (All, Images, Videos, News, Maps, which open DuckDuckGo's
// full page for that view) and a quick answer above the results, from
// DuckDuckGo's instant answer API, or worked out here for arithmetic.
export class VantaSearchChild extends JSWindowActorChild {
  handleEvent(event) {
    let doc = this.document;
    if (event.type == "click") {
      this.backToAll(event);
      return;
    }
    if (event.type != "DOMContentLoaded") {
      return;
    }
    if (doc.location.host == "duckduckgo.com") {
      // DuckDuckGo's own views (images, news) link "All" to its own results
      // page; it goes back to Vanta's instead.
      this.contentWindow.addEventListener("click", this, true);
      return;
    }
    if (!doc.location.pathname.startsWith("/html")) {
      return;
    }
    let query = new URLSearchParams(doc.location.search).get("q")?.trim();
    let header = doc.getElementById("header");
    if (!query || !header || doc.querySelector(".vanta-views")) {
      return;
    }
    this.addViews(doc, header, query);
    this.addAnswer(doc, query);
  }

  backToAll(event) {
    let link = event.target.closest?.('#react-duckbar a[href*="ia=web"]');
    let query = new URLSearchParams(this.document.location.search).get("q");
    if (!link || !query || event.button != 0 || event.metaKey || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.document.location.href =
      "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  }

  addViews(doc, header, query) {
    let q = encodeURIComponent(query);
    let views = [
      ["All", null],
      ["Images", `https://duckduckgo.com/?q=${q}&ia=images&iax=images`],
      ["Videos", `https://duckduckgo.com/?q=${q}&ia=videos&iax=videos`],
      ["News", `https://duckduckgo.com/?q=${q}&ia=news&iar=news`],
      ["Maps", `https://duckduckgo.com/?q=${q}&ia=maps&iaxm=maps`],
    ];
    let nav = doc.createElement("nav");
    nav.className = "vanta-views";
    for (let [label, href] of views) {
      let a = doc.createElement("a");
      a.textContent = label;
      if (href) {
        a.href = href;
      } else {
        a.setAttribute("aria-current", "page");
      }
      nav.append(a);
    }
    header.append(nav);
  }

  async addAnswer(doc, query) {
    let answer = VantaSearchChild.calculate(query);
    if (!answer) {
      try {
        let url = "https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&t=vanta&q=" +
          encodeURIComponent(query);
        let data = await (await fetch(url, { credentials: "omit" })).json();
        answer = VantaSearchChild.fromInstantAnswer(data);
      } catch (e) {
        return;
      }
    }
    let results = doc.querySelector(".serp__results");
    if (!answer || !results || this.document != doc) {
      return;
    }
    let el = (tag, cls, text) => {
      let e = doc.createElement(tag);
      e.className = cls;
      if (text) {
        e.textContent = text;
      }
      return e;
    };
    let box = el("section", "vanta-answer");
    if (answer.source) {
      let src = el("a", "vanta-answer-source", answer.source);
      if (answer.url) {
        src.href = answer.url;
      }
      box.append(src);
    }
    box.append(el("h2", "vanta-answer-title", answer.title));
    if (answer.text) {
      box.append(el("p", "vanta-answer-text", answer.text));
    }
    if (answer.facts?.length) {
      let dl = el("dl", "vanta-answer-facts");
      for (let [label, value] of answer.facts) {
        let row = el("div", "");
        row.append(el("dt", "", label), el("dd", "", value));
        dl.append(row);
      }
      box.append(dl);
    }
    results.prepend(box);
  }

  // Plain arithmetic ("12*7", "(3+4)/2", "2^10") is answered without asking
  // anyone. Anything else returns null.
  static calculate(query) {
    let expr = query.replace(/\s+/g, "").replace(/,/g, ".").replace(/[×x]/g, "*").replace(/÷/g, "/");
    if (!/^[\d.+\-*/^()%]+$/.test(expr) || !/\d[+\-*/^%]/.test(expr)) {
      return null;
    }
    let tokens = expr.match(/\d*\.?\d+|[+\-*/^%()]/g);
    if (!tokens || tokens.join("") != expr) {
      return null;
    }
    let i = 0;
    let peek = () => tokens[i];
    let next = () => tokens[i++];
    let primary = () => {
      let t = next();
      if (t == "(") {
        let v = sum();
        if (next() != ")") {
          throw new Error();
        }
        return v;
      }
      if (t == "-") {
        return -power();
      }
      if (t == "+") {
        return power();
      }
      let v = parseFloat(t);
      if (isNaN(v)) {
        throw new Error();
      }
      return v;
    };
    let power = () => {
      let v = primary();
      if (peek() == "%") {
        next();
        v /= 100;
      }
      if (peek() == "^") {
        next();
        v = Math.pow(v, power());
      }
      return v;
    };
    let product = () => {
      let v = power();
      while (peek() == "*" || peek() == "/") {
        v = next() == "*" ? v * power() : v / power();
      }
      return v;
    };
    let sum = () => {
      let v = product();
      while (peek() == "+" || peek() == "-") {
        v = next() == "+" ? v + product() : v - product();
      }
      return v;
    };
    try {
      let value = sum();
      if (i != tokens.length || !isFinite(value)) {
        return null;
      }
      let shown = Number.isInteger(value) ? value.toLocaleString("en-US").replace(/,/g, " ") :
        String(+value.toPrecision(12));
      let pretty = query.trim().replace(/\*/g, " × ").replace(/\//g, " ÷ ").replace(/\s+/g, " ");
      return { source: "Calculator", title: `${pretty} = ${shown}` };
    } catch (e) {
      return null;
    }
  }

  // The instant answer: a direct answer if there is one, otherwise the
  // first sentences of the topic's summary and a few of its facts.
  static fromInstantAnswer(data) {
    if (data.Answer && typeof data.Answer == "string") {
      return { source: data.AnswerType || "Answer", title: data.Answer };
    }
    if (data.Definition) {
      return { source: data.DefinitionSource, url: data.DefinitionURL, title: data.Heading, text: data.Definition };
    }
    if (!data.AbstractText || !data.Heading) {
      return null;
    }
    let text = "";
    for (let sentence of data.AbstractText.match(/[^.!?]+[.!?]+(\s|$)/g) || [data.AbstractText]) {
      if (text && (text + sentence).length > 340) {
        break;
      }
      text += sentence;
    }
    let facts = (data.Infobox?.content || [])
      .filter(f => f.data_type == "string" && f.label && f.value && String(f.value).length < 60)
      .slice(0, 4)
      .map(f => [f.label, String(f.value)]);
    return {
      source: data.AbstractSource,
      url: data.AbstractURL,
      title: data.Heading,
      text: text.trim(),
      facts,
    };
  }
}
