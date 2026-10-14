/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ContentBlockingAllowList:
    "resource://gre/modules/ContentBlockingAllowList.sys.mjs",
});

/**
 * Answers a page's request for its Blackout element-hiding style sheet.
 */
export class BlackoutParent extends JSWindowActorParent {
  async receiveMessage(message) {
    if (message.name != "Blackout:GetStyle") {
      return null;
    }
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

    let service;
    try {
      service = Cc["@mozilla.org/content-classifier-service;1"].getService(
        Ci.nsIContentClassifierService
      );
    } catch (e) {
      return null;
    }
    return service.getCosmeticStyle(
      "blackout",
      url.spec,
      Services.prefs.getBoolPref("vanta.blackout.cosmetic.generic", false)
    );
  }
}
