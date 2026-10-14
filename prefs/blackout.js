// Blackout: Vanta's built-in ad and tracker blocker (docs/blackout.md).
// It runs on Firefox's own content classifier, a native filter list engine
// that checks every request off the main thread.
pref("privacy.trackingprotection.content.protection.enabled", true);
pref("privacy.trackingprotection.content.protection.engines", "blackout");
pref("privacy.trackingprotection.content.protection.engines.pbmode", "blackout");

// Public filter lists, as whitespace-separated "id=url" entries, downloaded
// from their maintainers into the profile and refreshed daily (in seconds).
// The default set is uBlock Origin's own default set, so the two block the
// same things (docs/blackout.md has the comparison).
pref("vanta.blackout.lists", "ublock-filters=https://ublockorigin.github.io/uAssets/filters/filters.min.txt ublock-badware=https://ublockorigin.github.io/uAssets/filters/badware.min.txt ublock-privacy=https://ublockorigin.github.io/uAssets/filters/privacy.min.txt ublock-quick-fixes=https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt ublock-unbreak=https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt easylist=https://easylist.to/easylist/easylist.txt easyprivacy=https://easylist.to/easylist/easyprivacy.txt peter-lowe=https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext urlhaus=https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-ag-online.txt");
pref("vanta.blackout.update_interval", 86400);

// Element hiding. Site-specific rules always apply. Generic rules (the ones
// every site gets) mostly target CSS classes and ids, so pages report the
// ones they use and get only the rules that match them. The few hundred
// other generic rules would add to every page's style matching, so they
// stay off unless asked for.
pref("vanta.blackout.cosmetic.enabled", true);
pref("vanta.blackout.cosmetic.generic", true);
pref("vanta.blackout.cosmetic.generic_complex", false);
// Scriptlets: the small page-side scripts lists ask for (##+js rules),
// run in pages before their own scripts.
pref("vanta.blackout.scriptlets.enabled", true);

pref("vanta.blackout.loglevel", "Warn");
