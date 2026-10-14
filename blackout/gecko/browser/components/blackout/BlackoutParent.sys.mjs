/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ContentBlockingAllowList:
    "resource://gre/modules/ContentBlockingAllowList.sys.mjs",
});

// A page reports at most this many new classes and ids at a time.
const MAX_NAMES = 5000;

/**
 * Answers a page's requests for its Blackout element-hiding style sheets.
 */
export class BlackoutParent extends JSWindowActorParent {
  async receiveMessage(message) {
    const url = this.#pageUrl();
    if (!url) {
      return null;
    }
    let service;
    try {
      service = Cc["@mozilla.org/content-classifier-service;1"].getService(
        Ci.nsIContentClassifierService
      );
    } catch (e) {
      return null;
    }

    switch (message.name) {
      case "Blackout:GetStyle":
        return service.getCosmeticStyle(
          "blackout",
          url,
          Services.prefs.getBoolPref(
            "vanta.blackout.cosmetic.generic_complex",
            false
          )
        );
      case "Blackout:GetClassIdStyle": {
        if (
          !Services.prefs.getBoolPref("vanta.blackout.cosmetic.generic", true)
        ) {
          return null;
        }
        const classes = names(message.data?.classes);
        const ids = names(message.data?.ids);
        if (!classes && !ids) {
          return null;
        }
        return service.getClassIdStyle("blackout", url, classes, ids);
      }
    }
    return null;
  }

  // The page to look up rules for, or null when Blackout leaves it alone.
  #pageUrl() {
    if (
      !Services.prefs.getBoolPref(
        "privacy.trackingprotection.content.protection.enabled",
        false
      )
    ) {
      return null;
    }
    // Pages where the user turned protections off in the shield panel keep
    // their elements, as they keep their requests.
    const browser = this.browsingContext.top.embedderElement;
    if (!browser || lazy.ContentBlockingAllowList.includes(browser)) {
      return null;
    }
    // Ask about the document the parent knows this actor belongs to, not a
    // URL the content process names.
    const url = this.manager.documentURI;
    if (!url?.schemeIs("http") && !url?.schemeIs("https")) {
      return null;
    }
    return url.spec;
  }
}

// The newline-separated list the service takes, from what a content process
// sent: only strings that are valid class or id names.
function names(list) {
  if (!Array.isArray(list)) {
    return "";
  }
  return list
    .slice(0, MAX_NAMES)
    .filter(n => typeof n == "string" && n && n.length < 256 && !/\s/.test(n))
    .join("\n");
}
