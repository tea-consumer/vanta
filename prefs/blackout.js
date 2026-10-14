// Blackout: Vanta's built-in ad and tracker blocker (docs/blackout.md).
// It runs on Firefox's own content classifier, a native filter list engine
// that checks every request off the main thread.
pref("privacy.trackingprotection.content.protection.enabled", true);
pref("privacy.trackingprotection.content.protection.engines", "blackout");
pref("privacy.trackingprotection.content.protection.engines.pbmode", "blackout");

// Public filter lists, as whitespace-separated "id=url" entries, downloaded
// from their maintainers into the profile and refreshed daily (in seconds).
pref("vanta.blackout.lists", "easylist=https://easylist.to/easylist/easylist.txt easyprivacy=https://easylist.to/easylist/easyprivacy.txt peter-lowe=https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext adguard-base=https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt");
pref("vanta.blackout.update_interval", 86400);

// Element hiding: site-specific rules only. Generic rules (the ones every
// site gets) add a few hundred selectors to every page's style matching,
// so they stay off unless asked for.
pref("vanta.blackout.cosmetic.enabled", true);
pref("vanta.blackout.cosmetic.generic", false);

pref("vanta.blackout.loglevel", "Warn");
