/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Hides the page elements Blackout's filter lists name, with one user style
 * sheet per document. Pages with nothing to hide get no sheet at all.
 */
export class BlackoutChild extends JSWindowActorChild {
  async handleEvent(event) {
    const document = this.document;
    if (event.target != document) {
      return;
    }

    let css;
    try {
      css = await this.sendQuery("Blackout:GetStyle");
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
