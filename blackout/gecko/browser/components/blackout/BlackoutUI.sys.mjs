/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Blackout's toolbar button and panel.
 *
 * The button shows how many requests Blackout (and ETP) blocked on the
 * current page. Its panel switches Blackout off and on for the site, which
 * is the same per-site switch as the shield's (ContentBlockingAllowList),
 * and leads to about:blackout for the lists.
 *
 * Counting reads the page's content blocking log, which the network code
 * already keeps for the shield. It is read only for the selected tab, at
 * most a few times a second while a page is blocking things, and never in
 * a content process.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ContentBlockingAllowList:
    "resource://gre/modules/ContentBlockingAllowList.sys.mjs",
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
});

const WIDGET_ID = "vanta-blackout-button";
const PANEL_ID = "vanta-blackout-panel";
const STYLE_URL = "chrome://browser/content/blackout/blackout-panel.css";
const PREF_ENABLED = "privacy.trackingprotection.content.protection.enabled";
const PREF_PLACED = "vanta.blackout.button.placed";

// Wait this long after a blocking event before re-counting, so a page that
// blocks dozens of requests while it loads is counted a few times, not
// dozens.
const COUNT_DELAY_MS = 250;

// The kinds of blocking the shield reports that a request was cancelled
// for. Blackout's own blocks arrive as tracking content.
const BLOCKED_STATES =
  Ci.nsIWebProgressListener.STATE_BLOCKED_TRACKING_CONTENT |
  Ci.nsIWebProgressListener.STATE_BLOCKED_FINGERPRINTING_CONTENT |
  Ci.nsIWebProgressListener.STATE_BLOCKED_CRYPTOMINING_CONTENT |
  Ci.nsIWebProgressListener.STATE_BLOCKED_SOCIALTRACKING_CONTENT |
  Ci.nsIWebProgressListener.STATE_BLOCKED_EMAILTRACKING_CONTENT;

/**
 * Requests blocked on the page in `browser`, from its content blocking log
 * ({origin: [[state, blocked, count, ...], ...]}).
 */
async function blockedCount(browser) {
  let json;
  try {
    json = await browser.getContentBlockingLog();
  } catch (e) {
    return 0;
  }
  let count = 0;
  for (const entries of Object.values(JSON.parse(json || "{}"))) {
    for (const [state, blocked, repeats] of entries) {
      if (blocked && state & BLOCKED_STATES) {
        count += repeats || 1;
      }
    }
  }
  return count;
}

function formatCount(count) {
  return new Intl.NumberFormat(undefined).format(count);
}

// The badge has room for three characters.
function badgeText(count) {
  if (!count) {
    return "";
  }
  return count > 999 ? "999+" : String(count);
}

function isBlackoutOn() {
  return Services.prefs.getBoolPref(PREF_ENABLED, false);
}

function pageHost(browser) {
  try {
    const uri = browser.currentURI;
    return uri.schemeIs("http") || uri.schemeIs("https") ? uri.host : "";
  } catch (e) {
    return "";
  }
}

/**
 * One window's button, panel and counter.
 */
class WindowUI {
  constructor(window, button) {
    this.window = window;
    this.button = button;
    this.timer = null;
    this.count = 0;

    const { gBrowser } = window;
    this.progressListener = {
      onContentBlockingEvent: browser => {
        if (browser == gBrowser.selectedBrowser) {
          this.scheduleCount();
        }
      },
      onLocationChange: (browser, webProgress) => {
        if (browser == gBrowser.selectedBrowser && webProgress.isTopLevel) {
          this.scheduleCount(0);
        }
      },
    };
    gBrowser.addTabsProgressListener(this.progressListener);
    this.onTabSelect = () => this.scheduleCount(0);
    gBrowser.tabContainer.addEventListener("TabSelect", this.onTabSelect);
    window.addEventListener("unload", () => this.destroy(), { once: true });
    this.scheduleCount(0);
  }

  destroy() {
    this.window.clearTimeout(this.timer);
    this.window.gBrowser?.removeTabsProgressListener(this.progressListener);
    this.window.gBrowser?.tabContainer.removeEventListener(
      "TabSelect",
      this.onTabSelect
    );
  }

  scheduleCount(delay = COUNT_DELAY_MS) {
    if (this.timer && delay) {
      return;
    }
    this.window.clearTimeout(this.timer);
    this.timer = this.window.setTimeout(() => {
      this.timer = null;
      this.updateCount();
    }, delay);
  }

  get browser() {
    return this.window.gBrowser.selectedBrowser;
  }

  isOffForSite() {
    return (
      !isBlackoutOn() ||
      !pageHost(this.browser) ||
      lazy.ContentBlockingAllowList.includes(this.browser)
    );
  }

  async updateCount() {
    const browser = this.browser;
    const count = await blockedCount(browser);
    if (browser != this.browser) {
      return;
    }
    this.count = count;
    const off = this.isOffForSite();
    this.button.toggleAttribute("blackout-off", off);
    this.button.setAttribute("badge", off ? "" : badgeText(count));
    const host = pageHost(browser);
    this.button.setAttribute(
      "tooltiptext",
      off
        ? `Blackout is off${host ? " for " + host : ""}`
        : `Blackout: ${formatCount(count)} blocked on this page`
    );
    if (this.panel?.state == "open") {
      this.renderPanel();
    }
  }

  // --- Panel ---------------------------------------------------------

  get panel() {
    return this.window.document.getElementById(PANEL_ID);
  }

  buildPanel() {
    const doc = this.window.document;
    const panel = doc.createXULElement("panel");
    panel.id = PANEL_ID;
    panel.setAttribute("type", "arrow");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "vanta-blackout-title");
    panel.setAttribute("position", "bottomright topright");
    panel.setAttribute("noautofocus", "true");

    const html = (tag, props = {}, ...children) => {
      const el = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      Object.assign(el, props);
      el.append(...children);
      return el;
    };

    this.eclipse = html("div", { className: "vb-eclipse" });
    this.eclipse.setAttribute("aria-hidden", "true");
    this.status = html("p", { className: "vb-status" });
    this.countLabel = html("p", { className: "vb-count" });
    this.countCaption = html("p", { className: "vb-caption" });
    this.toggle = html("button", { className: "vb-switch" });
    this.toggle.setAttribute("role", "switch");
    this.toggle.addEventListener("click", () => this.toggleSite());
    this.toggleLabel = html("span", { textContent: "Block on this site" });
    this.total = html("p", { className: "vb-total" });
    const settings = html("button", {
      className: "vb-settings",
      textContent: "Lists and settings",
    });
    settings.addEventListener("click", () => {
      panel.hidePopup();
      this.window.switchToTabHavingURI("about:blackout", true, {
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
    });

    const body = html(
      "div",
      { className: "vb-body" },
      html(
        "header",
        { className: "vb-header" },
        this.eclipse,
        html(
          "div",
          {},
          html("h2", { id: "vanta-blackout-title", textContent: "Blackout" }),
          this.status
        )
      ),
      html(
        "div",
        { className: "vb-tally" },
        this.countLabel,
        this.countCaption
      ),
      html("label", { className: "vb-row" }, this.toggleLabel, this.toggle),
      this.total,
      settings
    );
    panel.append(body);
    doc.getElementById("mainPopupSet").append(panel);
    return panel;
  }

  renderPanel() {
    const host = pageHost(this.browser);
    const off = this.isOffForSite();
    const canToggle = isBlackoutOn() && !!host;
    this.eclipse.toggleAttribute("off", off);
    this.status.textContent = !isBlackoutOn()
      ? "Off everywhere"
      : !host
        ? "Nothing to block on this page"
        : off
          ? `Off for ${host}`
          : `Blocking on ${host}`;
    this.countLabel.textContent = formatCount(off ? 0 : this.count);
    this.countCaption.textContent = "blocked on this page";
    this.toggle.setAttribute("aria-checked", String(!off));
    this.toggle.disabled = !canToggle;
    this.toggle.setAttribute("aria-label", "Block on this site");
  }

  async open() {
    const panel = this.panel ?? this.buildPanel();
    this.renderPanel();
    this.total.textContent = "";
    panel.openPopup(this.button, { position: "bottomright topright" });
    try {
      const total = await Cc["@mozilla.org/tracking-db-service;1"]
        .getService(Ci.nsITrackingDBService)
        .sumAllEvents();
      this.total.textContent = `${formatCount(total)} blocked in total`;
    } catch (e) {
      // No history yet.
    }
  }

  /**
   * Switches Blackout off or on for the site, the way the shield does, and
   * reloads the page so it loads under the new setting.
   */
  toggleSite() {
    const { window } = this;
    const browser = this.browser;
    const turnOff = !lazy.ContentBlockingAllowList.includes(browser);
    if (window.gProtectionsHandler) {
      if (turnOff) {
        window.gProtectionsHandler.disableForCurrentPage(false);
      } else {
        window.gProtectionsHandler.enableForCurrentPage(false);
      }
    } else if (turnOff) {
      lazy.ContentBlockingAllowList.add(browser);
    } else {
      lazy.ContentBlockingAllowList.remove(browser);
    }
    this.renderPanel();
    // Let the moon move before the page goes away.
    window.setTimeout(() => {
      this.panel?.hidePopup();
      window.gBrowser.reloadTab(window.gBrowser.getTabForBrowser(browser));
    }, 400);
  }
}

const windows = new WeakMap();

export const BlackoutUI = {
  init() {
    lazy.CustomizableUI.createWidget({
      id: WIDGET_ID,
      type: "custom",
      defaultArea: lazy.CustomizableUI.AREA_NAVBAR,
      onBuild(doc) {
        const button = doc.createXULElement("toolbarbutton");
        button.id = WIDGET_ID;
        button.className =
          "toolbarbutton-1 chromeclass-toolbar-additional vanta-blackout-button";
        button.setAttribute("badged", "true");
        button.setAttribute("label", "Blackout");
        button.setAttribute("tooltiptext", "Blackout");
        button.setAttribute("removable", "true");
        button.setAttribute("overflows", "true");
        const window = doc.defaultView;
        // Custom widgets get no onCreated call; set the window up once its
        // tabs exist.
        const setUp = () => {
          if (windows.has(window) || window.closed) {
            return;
          }
          window.windowUtils.loadSheetUsingURIString(
            STYLE_URL,
            Ci.nsIDOMWindowUtils.AUTHOR_SHEET
          );
          windows.set(window, new WindowUI(window, button));
        };
        if (window.gBrowserInit?.delayedStartupFinished) {
          setUp();
        } else {
          window.delayedStartupPromise?.then(setUp);
        }
        button.addEventListener("command", () => windows.get(window)?.open());
        return button;
      },
    });

    // First run: put the button next to the address bar rather than at the
    // end of the toolbar, where a new widget lands by default.
    if (!Services.prefs.getBoolPref(PREF_PLACED, false)) {
      Services.prefs.setBoolPref(PREF_PLACED, true);
      const urlbar =
        lazy.CustomizableUI.getPlacementOfWidget("urlbar-container");
      if (urlbar?.area == lazy.CustomizableUI.AREA_NAVBAR) {
        lazy.CustomizableUI.addWidgetToArea(
          WIDGET_ID,
          lazy.CustomizableUI.AREA_NAVBAR,
          urlbar.position + 1
        );
      }
    }

    // Switching Blackout off everywhere (or on) changes every window's
    // button.
    Services.prefs.addObserver(PREF_ENABLED, () => {
      for (const window of Services.wm.getEnumerator("navigator:browser")) {
        windows.get(window)?.scheduleCount(0);
      }
    });
  },
};
