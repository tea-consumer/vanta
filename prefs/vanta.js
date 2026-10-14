/****************************************************************************
 * Vanta browser: default prefs  (draft 0.4, 2026-10-12)
 * Goal: fast + RAM-efficient, built from Firefox source, without breaking
 *       normal sites.
 * Appended to browser/app/profile/firefox.js by scripts/apply-vanta.sh.
 ****************************************************************************/

/** ===== MEMORY ================================================ **/
// Fewer shared content processes: each costs ~30-80 MB. default=8
pref("dom.ipc.processCount", 4);
// Keep one spare content process warm instead of three (~20 MB each).
// default=3 on desktop
pref("dom.ipc.processPrelaunch.fission.number", 1);
// With site isolation most pages run in per-site processes, and Firefox
// allows up to 4 per site. One per site (what Firefox uses on Android) saves
// a process for every extra tab of the same site. default=4
pref("dom.ipc.processCount.webIsolated", 1);
// Site isolation for "high-value" sites only: ones you are logged in to, have
// a saved password for, or that ask for isolation (COOP header), each for 30
// days. Other sites share processes. This is Firefox's default on Android.
// default=1 (isolate every site)
pref("fission.webContentIsolationStrategy", 2);
// Desktop Firefox only watches for logins when told to; without this,
// sites you log in to wouldn't count as high-value. default=false
pref("fission.highValue.login.monitor", true);
// Don't preload a hidden New Tab page in the background.
pref("browser.newtab.preload", false);
// Unload idle tabs when memory runs low, and sooner than default.
pref("browser.tabs.unloadOnLowMemory", true);
pref("browser.tabs.min_inactive_duration_before_unload", 300000); // 5 min; default=10 min
// Back/forward cache: keep at most 2 full pages in RAM. default=-1 (auto, up to 8)
pref("browser.sessionhistory.max_total_viewers", 2);
// Fewer closed tabs/windows held for "undo close". defaults 25 / 5
pref("browser.sessionstore.max_tabs_undo", 10);
pref("browser.sessionstore.max_windows_undo", 1);
// Write session state every 60s instead of 15s (less disk + CPU churn).
pref("browser.sessionstore.interval", 60000);
// Decoded-image cache: up to 1/4 of RAM (2 GB on an 8 GB Mac) per process by
// default. 512 MB is plenty; images past that are decoded again. default=2 GB
pref("image.mem.surfacecache.max_size_kb", 524288);
// PHC (sampled memory-bug detection for crash reports) is compiled out of
// Vanta; this keeps it off in any build that still has it. default=true
pref("memory.phc.enabled", false);
// Don't record per-page interaction data (view time, typing) into history.
pref("browser.places.interactions.enabled", false);
// NOTE: disk cache stays ON on purpose, so caching doesn't move into RAM.

/** ===== RENDERING / SPEED ========================= **/
// Paint as soon as there is something to show. default=5 ms
pref("nglayout.initialpaint.delay", 0);
pref("nglayout.initialpaint.delay_in_oopif", 0);
// Smooth scrolling with the spring-based "MSD" physics Firefox Nightly
// already uses: momentum that eases out instead of stopping abruptly, closer
// to Safari for mouse wheel and keyboard scrolling. default=false on release
pref("general.smoothScroll.msdPhysics.enabled", true);
pref("content.notify.interval", 100000);
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
// Don't hold back requests to spread them out; send them as soon as possible.
pref("network.http.pacing.requests.enabled", false);
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

/** ===== COOKIE BANNERS: REJECT AUTOMATICALLY (patches/cookiebanners-*) ===== **/
// 1 = click "reject all" or inject the opt-out cookie; never accept.
pref("cookiebanners.service.mode", 1);
pref("cookiebanners.service.mode.privateBrowsing", 1);
// Consent-platform rules (OneTrust, Cookiebot, Didomi...) on any site, but only
// in the top page: running them in every iframe costs more than it catches.
pref("cookiebanners.service.enableGlobalRules", true);
pref("cookiebanners.service.enableGlobalRules.subFrames", false);

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
// Accent color: "mono" (default), "ice", "sage" or "ember".
pref("vanta.accent", "mono");
// Toolbar as see-through black glass over the page, like Safari.
pref("vanta.toolbar.seeThrough", false);
// Frame (toolbar, rail, border) black with a faint tint of the page colour.
pref("vanta.toolbar.pageTint", true);
// The new tab: black, with one plain search field drawn as a line of light
// in the colour of the sky outside. Drawn by the window on a blank page, so a new tab
// costs no extra process.
pref("vanta.newtab.home", true);
// The address bar answers as you type (maths, units, time in a city),
// searches a site by name ("yr oslo"), and opens a result in split view
// with Shift+Enter.
pref("vanta.search.answers", true);
pref("browser.urlbar.suggest.calculator", true);
pref("browser.urlbar.unitConversion.enabled", true);
// No "Press tab to search with" row under the bar.
pref("browser.urlbar.suggest.engines", false);
// Vertical tabs in a compact sidebar that expands while hovered, with the
// address bar in one slim row on top.
pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", true);
pref("sidebar.visibility", "expand-on-hover");
// Sidebar tools: history and bookmarks only (no synced tabs, no AI chat).
pref("sidebar.main.tools", "history,bookmarks");
// Starting toolbar layout. Firefox builds the toolbar wrong when a new
// profile starts with vertical tabs already on: the buttons end up reversed
// (forward before back, after the address bar) and reload goes missing. So
// new profiles start from this layout instead. currentVersion is Firefox
// 157's toolbar layout version; newer Firefox migrates it forward.
pref("browser.uiCustomization.state", "{\"placements\":{\"widget-overflow-fixed-list\":[],\"unified-extensions-area\":[],\"nav-bar\":[\"back-button\",\"forward-button\",\"stop-reload-button\",\"vertical-spacer\",\"urlbar-container\",\"downloads-button\",\"unified-extensions-button\"],\"toolbar-menubar\":[\"menubar-items\"],\"TabsToolbar\":[],\"vertical-tabs\":[\"tabbrowser-tabs\"],\"PersonalToolbar\":[\"personal-bookmarks\"]},\"seen\":[],\"dirtyAreaCache\":[],\"currentVersion\":26,\"newElementCount\":0}");
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
