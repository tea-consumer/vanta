/****************************************************************************
 * Vanta browser: default prefs  (draft 0.3, 2026-10-12)
 * Goal: fast + RAM-efficient, built from Firefox source, without breaking
 *       normal sites.
 * Appended to browser/app/profile/firefox.js by scripts/apply-vanta.sh.
 ****************************************************************************/

/** ===== MEMORY ================================================ **/
// Fewer shared content processes: each costs ~30-80 MB. default=8
pref("dom.ipc.processCount", 4);
// Keep only one spare process warm instead of three. default=3
pref("dom.ipc.processPrelaunch.fission.number", 1);
// Don't preload a hidden New Tab page in the background.
pref("browser.newtab.preload", false);
// Unload idle tabs when memory runs low, and sooner than default.
pref("browser.tabs.unloadOnLowMemory", true);
pref("browser.tabs.min_inactive_duration_before_unload", 300000); // 5 min; default=10 min
// Back/forward cache: keep at most 2 full pages in RAM. default=-1 (auto, up to 8)
pref("browser.sessionhistory.max_total_viewers", 2);
// Fewer closed tabs/windows held for "undo close". defaults 25 / 3
pref("browser.sessionstore.max_tabs_undo", 10);
pref("browser.sessionstore.max_windows_undo", 1);
// Write session state every 60s instead of 15s (less disk + CPU churn).
pref("browser.sessionstore.interval", 60000);
// NOTE: disk cache stays ON on purpose, so caching doesn't move into RAM.

/** ===== RENDERING / SPEED ========================= **/
pref("gfx.content.skia-font-cache-size", 20);
pref("content.notify.interval", 100000);
pref("gfx.canvas.accelerated.cache-size", 512);
pref("image.mem.decode_bytes_at_a_time", 32768);
pref("media.cache_readahead_limit", 3600);
pref("media.cache_resume_threshold", 1800);

/** ===== NETWORK =================================== **/
pref("network.buffer.cache.size", 65535);
pref("network.buffer.cache.count", 48);
pref("network.http.max-connections", 1800);
pref("network.http.max-persistent-connections-per-server", 10);
pref("network.http.max-urgent-start-excessive-connections-per-host", 5);
pref("network.http.request.max-start-delay", 5);
pref("network.dnsCacheExpiration", 3600);
// OCSP checks add a network round trip on every new TLS site; CRLite covers revocation.
pref("security.OCSP.enabled", 0);
// Speculative pre-connects/prefetch burn RAM and bandwidth on pages you never open.
pref("network.http.speculative-parallel-limit", 0);
pref("network.dns.disablePrefetch", true);
pref("network.dns.disablePrefetchFromHTTPS", true);
pref("browser.urlbar.speculativeConnect.enabled", false);
pref("browser.places.speculativeConnect.enabled", false);
pref("network.prefetch-next", false);

/** ===== CONTENT BLOCKING (fewer trackers = less to load) ============== **/
pref("browser.contentblocking.category", "strict");
pref("privacy.globalprivacycontrol.enabled", true);
pref("dom.security.https_only_mode", true);
pref("dom.security.https_only_mode_error_page_user_suggestions", true);
pref("security.csp.reporting.enabled", false);
pref("pdfjs.enableScripting", false);

/** ===== TELEMETRY / STUDIES / CRASH REPORTS OFF ======================= **/
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.usage.uploadEnabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.server", "data:,");
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.updatePing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.telemetry.coverage.opt-out", true);
pref("toolkit.coverage.opt-out", true);
pref("toolkit.coverage.endpoint.base", "");
pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
pref("browser.newtabpage.activity-stream.telemetry", false);
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
pref("nimbus.rollouts.enabled", false);
pref("breakpad.reportURL", "");
pref("browser.tabs.crashReporting.sendReport", false);
pref("browser.crashReports.unsubmittedCheck.enabled", false);

/** ===== AI / ML FEATURES OFF (models are large in RAM) ================ **/
pref("browser.ai.control.default", "blocked");
pref("browser.ml.enable", false);
pref("browser.ml.chat.enabled", false);
pref("browser.ml.chat.menu", false);
pref("browser.ml.linkPreview.enabled", false);
pref("browser.tabs.groups.smart.enabled", false);

/** ===== LIGHTER NEW TAB / URL BAR ===================================== **/
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.showSponsoredCheckboxes", false);
pref("browser.newtabpage.activity-stream.default.sites", "");
pref("browser.urlbar.quicksuggest.enabled", false);
pref("browser.urlbar.trending.featureGate", false);
pref("browser.search.suggest.enabled", false);
pref("extensions.getAddons.showPane", false);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("browser.discovery.enabled", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
pref("browser.preferences.moreFromMozilla", false);
pref("browser.uitour.enabled", false);

/** ===== QUIETER STARTUP =============================================== **/
pref("browser.shell.checkDefaultBrowser", false);
pref("browser.aboutwelcome.enabled", false);
pref("browser.startup.homepage_override.mstone", "ignore");
pref("browser.aboutConfig.showWarning", false);
pref("browser.compactmode.show", true);
pref("full-screen-api.transition-duration.enter", "0 0");
pref("full-screen-api.transition-duration.leave", "0 0");

/** ===== INTERFACE (see chrome/vanta.css) =============================== **/
// Vanta is dark: the browser and websites that support it use their dark
// appearance whatever the OS is set to. Set to 0 in about:config for light.
pref("ui.systemUsesDarkTheme", 1);
// Vertical tabs in a compact sidebar that expands while hovered, with the
// address bar in one slim row on top.
pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", true);
pref("sidebar.visibility", "expand-on-hover");
// Sidebar tools: history and bookmarks only (no synced tabs, no AI chat).
pref("sidebar.main.tools", "history,bookmarks");
// Compact toolbar spacing. Sticky so it matches Firefox's own declaration.
sticky_pref("browser.uidensity", 1);
// Bookmarks stay in the sidebar and menu, not a toolbar row on new tabs.
pref("browser.toolbars.bookmarks.visibility", "never");
// Fade tabs that were unloaded to free memory.
pref("browser.tabs.fadeOutUnloadedTabs", true);
pref("browser.tabs.fadeOutExplicitlyUnloadedTabs", true);
// Tab hover cards without page thumbnails (thumbnails cost memory and CPU).
pref("browser.tabs.hoverPreview.showThumbnails", false);
// No Firefox account or sync in the UI.
pref("identity.fxaccounts.enabled", false);
// Firefox's built-in Resource Monitor, in the sidebar: per-tab memory and CPU.
pref("browser.resourceMonitor.enabled", true);
// New tab: search and shortcuts only. Vanta's build has no Firefox logo, and
// no weather or recent-activity sections.
pref("browser.newtabpage.activity-stream.hideLogo", true);
pref("browser.newtabpage.activity-stream.logowordmark.alwaysVisible", false);
pref("browser.newtabpage.activity-stream.showWeather", false);
pref("browser.newtabpage.activity-stream.feeds.section.highlights", false);
