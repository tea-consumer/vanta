/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// After the page has loaded, look once more for late content this long after.
const LATE_SURVEY_MS = 5000;

/**
 * Hides the page elements Blackout's filter lists name, with user style
 * sheets. A page gets its site-specific sheet as soon as it starts. The lists'
 * generic rules are too many to give every page, so the page's CSS classes
 * and ids are surveyed when the browser is idle (after DOMContentLoaded,
 * after load and once more a little later) and only the rules that target
 * them come back. Pages with nothing to hide get no sheet at all.
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
