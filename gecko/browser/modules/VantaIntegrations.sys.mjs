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
