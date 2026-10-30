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
// full page for that view) and a quick answer above the results (the summary
// DuckDuckGo put on the page, its instant answer API, or worked out here for
// arithmetic). It also keeps the page honest about where it is and where it
// goes: a search from the heading opens the same address as one from the
// address bar, and results link straight to their sites.
export class VantaSearchChild extends JSWindowActorChild {
  handleEvent(event) {
    switch (event.type) {
      case "click":
        this.backToAll(event);
        break;
      case "submit":
        this.search(event);
        break;
      case "DOMContentLoaded":
        this.onLoad();
        break;
    }
  }

  onLoad() {
    let doc = this.document;
    if (doc.location.host == "duckduckgo.com") {
      // DuckDuckGo's own views (images, news) link "All" to its own results
      // page; it goes back to Vanta's instead.
      this.contentWindow.addEventListener("click", this, true);
      return;
    }
    if (!doc.location.pathname.startsWith("/html") || doc.querySelector(".vanta-views")) {
      return;
    }
    let header = doc.getElementById("header");
    let check = doc.getElementById("challenge-form");
    // A page from a form post may have no query in its address; the heading
    // (or the bot check's form) still has it.
    let query = (
      VantaSearchChild.queryOf(doc.location.href) ??
      header?.querySelector(".search__input")?.value ??
      (check && VantaSearchChild.queryOf(new URL(check.getAttribute("action"), doc.location.href).href))
    )?.trim();
    if (!query || (!header && !check)) {
      return;
    }
    // DuckDuckGo's bot check, sent instead of results, gets the results
    // page's heading, so it reads as this search's page.
    header ??= this.addHeading(doc, query);
    // The tab is named by the search, like the heading, not "… at DuckDuckGo".
    doc.title = query;
    doc.documentElement.setAttribute("vanta-size", VantaSearchChild.headingSize(query));
    header.querySelector("form")?.addEventListener("submit", this);
    // Next and Previous still post DuckDuckGo's form, which is how it pages,
    // but to the search's own address: the address bar keeps showing the
    // words, and the next page knows its query.
    for (let form of doc.querySelectorAll(".nav-link form")) {
      form.action = VantaSearchChild.address(query);
    }
    this.addViews(doc, header, query);
    if (check) {
      return;
    }
    this.directLinks(doc);
    // A later page (it has a Previous button) is more of the same results.
    if (!doc.querySelector('.nav-link input[type="submit"][value^="prev" i]')) {
      this.addAnswer(doc, query);
    }
  }

  static queryOf(url) {
    return URL.parse(url)?.searchParams.get("q")?.trim() || null;
  }

  // The results page for a search, as the address bar's engine opens it.
  static address(query) {
    return "/html/?" + new URLSearchParams({ q: query });
  }

  // Long searches are set smaller in the heading, so more of them shows
  // (the rest ends in an ellipsis). VantaSearchSkin.headingSize in
  // browser-init.js glides the new tab's words to the same size; keep the
  // two in step.
  static headingSize(query) {
    let n = query.length;
    return n <= 26 ? 56 : n <= 33 ? 46 : n <= 41 ? 38 : 32;
  }

  // A search from the heading goes to the address a search from the address
  // bar opens. DuckDuckGo's form posts instead, which leaves the words out
  // of the address (so the address bar, views and answer lose them) and
  // makes Back ask to send the form again.
  search(event) {
    let query = event.target.querySelector(".search__input")?.value.trim();
    event.preventDefault();
    if (query) {
      this.contentWindow.location.assign(VantaSearchChild.address(query));
    }
  }

  backToAll(event) {
    let link = event.target.closest?.('#react-duckbar a[href*="ia=web"]');
    let query = new URLSearchParams(this.document.location.search).get("q");
    if (!link || !query || event.button != 0 || event.metaKey || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // The same address as the search's own page, so history has it once.
    this.document.location.href = "https://html.duckduckgo.com" + VantaSearchChild.address(query);
  }

  // The bot check page has no heading of its own: the same one as the
  // results page, so you can also search again from it.
  addHeading(doc, query) {
    let column = doc.createElement("div");
    let header = doc.createElement("div");
    header.id = "header";
    header.className = "header";
    let form = doc.createElement("form");
    form.className = "header__form";
    let input = doc.createElement("input");
    input.className = "search__input";
    input.name = "q";
    input.autocomplete = "off";
    input.value = query;
    form.append(input);
    header.append(form);
    column.append(header);
    doc.body.prepend(column);
    return header;
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

  // Results link through DuckDuckGo's redirect page (duckduckgo.com/l/?uddg=).
  // Linking straight to the site saves loading that page on every click,
  // shows the real address on hover and when copied, and lets visited
  // results dim. noreferrer tells the site nothing, as the redirect did.
  directLinks(doc) {
    for (let a of doc.querySelectorAll('#links a[href*="duckduckgo.com/l/"]')) {
      let target = URL.parse(a.href)?.searchParams.get("uddg");
      if (target && /^https?:\/\//i.test(target)) {
        a.href = target;
        a.rel = "nofollow noreferrer";
      }
    }
    // One Tab stop per result, its title: the icon, address and snippet go
    // to the same place.
    for (let a of doc.querySelectorAll("#links :is(.result__icon a, .result__url, .result__snippet)")) {
      a.tabIndex = -1;
    }
  }

  async addAnswer(doc, query) {
    let results = doc.querySelector(".serp__results");
    if (!results) {
      return;
    }
    // Maths, or the summary DuckDuckGo put on the page, are there at once,
    // before the page is drawn, so nothing moves.
    let answer = VantaSearchChild.calculate(query) ?? VantaSearchChild.fromZeroClick(doc);
    let box = answer && this.answerBox(doc, answer);
    if (box) {
      results.prepend(box);
    }
    if (answer?.source == "Calculator") {
      return;
    }
    // The instant answer API may know more: an answer where the page had
    // none, or facts about the topic it summed up.
    let more;
    try {
      let url = "https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&t=vanta&q=" +
        encodeURIComponent(query);
      more = VantaSearchChild.fromInstantAnswer(await (await fetch(url, { credentials: "omit" })).json());
    } catch (e) {
      return;
    }
    try {
      if (!more || !doc.contains(results)) {
        return;
      }
      if (!box) {
        this.makeRoom(doc, () => results.prepend(this.answerBox(doc, more)));
      } else if (
        more.facts?.length &&
        more.title.toLowerCase() == answer.title.toLowerCase() &&
        !box.querySelector(".vanta-answer-facts")
      ) {
        this.makeRoom(doc, () => box.append(this.factsList(doc, more.facts)));
      }
    } catch (e) {
      // The page went away while the answer was on its way.
    }
  }

  // Puts in, or grows, the answer above the results without them jumping:
  // they glide down to make room. (Scrolled down, Firefox keeps what you
  // are reading in place.)
  makeRoom(doc, change) {
    let win = doc.defaultView;
    let links = doc.getElementById("links");
    let top = links?.getBoundingClientRect().top;
    change();
    if (!links || win.scrollY > 0 || win.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let shift = top - links.getBoundingClientRect().top;
    if (shift) {
      links.animate(
        Cu.cloneInto([{ transform: `translateY(${shift}px)` }, { transform: "none" }], win),
        Cu.cloneInto({ duration: 520, easing: "cubic-bezier(.2, .9, .3, 1)" }, win)
      );
    }
  }

  answerBox(doc, answer) {
    let box = VantaSearchChild.el(doc, "section", "vanta-answer");
    if (answer.source) {
      let src = VantaSearchChild.el(doc, "a", "vanta-answer-source", answer.source);
      if (answer.url) {
        src.href = answer.url;
      }
      box.append(src);
    }
    box.append(VantaSearchChild.el(doc, "h2", "vanta-answer-title", answer.title));
    if (answer.text) {
      box.append(VantaSearchChild.el(doc, "p", "vanta-answer-text", answer.text));
    }
    if (answer.facts?.length) {
      box.append(this.factsList(doc, answer.facts));
    }
    return box;
  }

  factsList(doc, facts) {
    let dl = VantaSearchChild.el(doc, "dl", "vanta-answer-facts");
    for (let [label, value] of facts) {
      let row = VantaSearchChild.el(doc, "div", "");
      row.append(VantaSearchChild.el(doc, "dt", "", label), VantaSearchChild.el(doc, "dd", "", value));
      dl.append(row);
    }
    return dl;
  }

  static el(doc, tag, cls, text) {
    let e = doc.createElement(tag);
    e.className = cls;
    if (text) {
      e.textContent = text;
    }
    return e;
  }

  // DuckDuckGo's summary box (a topic's first lines, "More at Wikipedia"),
  // which the page carries and Vanta's style hides, as an answer.
  static fromZeroClick(doc) {
    let abstract = doc.getElementById("zero_click_abstract");
    let heading = doc.querySelector(".zci__heading");
    let title = heading?.textContent.replace(/\s+/g, " ").trim();
    if (!abstract || !title) {
      return null;
    }
    let more = [...abstract.querySelectorAll("a")].find(a => /^more at /i.test(a.textContent.trim()));
    let words = abstract.cloneNode(true);
    for (let a of words.querySelectorAll("a")) {
      a.remove();
    }
    let text = VantaSearchChild.lead(words.textContent.replace(/\s+/g, " ").trim());
    return {
      source: more?.textContent.trim().replace(/^more at\s+/i, "") || "",
      url: more?.href || heading.querySelector("a")?.href,
      title,
      text,
    };
  }

  // A summary's first sentences, about two lines' worth.
  static lead(text) {
    let lead = "";
    for (let sentence of text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text]) {
      if (lead && (lead + sentence).length > 340) {
        break;
      }
      lead += sentence;
    }
    return lead.trim();
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
    let facts = (data.Infobox?.content || [])
      .filter(f => f.data_type == "string" && f.label && f.value && String(f.value).length < 60)
      .slice(0, 4)
      .map(f => [f.label, String(f.value)]);
    return {
      source: data.AbstractSource,
      url: data.AbstractURL,
      title: data.Heading,
      text: VantaSearchChild.lead(data.AbstractText),
      facts,
    };
  }
}
