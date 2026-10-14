/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Vanta Blackout, the built-in ad and tracker blocker.
 *
 * Blocking runs natively in Firefox's content classifier
 * (toolkit/components/content-classifier), which checks every request
 * against the "blackout" engine on the URL classifier thread. This module
 * only does the slow, rare work around it:
 *
 *  - downloads the public filter lists named in vanta.blackout.lists into
 *    <profile>/blackout/lists/ and refreshes them once a day, then asks the
 *    classifier to rebuild its engine (on a background thread, cached to
 *    <profile>/blackout/engine.dat so later starts skip the parsing);
 *  - registers the Blackout window actors, which hide the page elements the
 *    lists name.
 */

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "log", () =>
  console.createInstance({
    prefix: "Blackout",
    maxLogLevelPref: "vanta.blackout.loglevel",
  })
);

const PREF_ENABLED = "privacy.trackingprotection.content.protection.enabled";
const PREF_LISTS = "vanta.blackout.lists";
const PREF_INTERVAL = "vanta.blackout.update_interval";
const TIMER_ID = "vanta-blackout-lists";
const FEATURE = "blackout";

// No real filter list comes near this; anything bigger is not one.
const MAX_LIST_LENGTH = 32 * 1024 * 1024;

function blackoutDir() {
  return PathUtils.join(PathUtils.profileDir, "blackout");
}

function listsDir() {
  return PathUtils.join(blackoutDir(), "lists");
}

function statePath() {
  return PathUtils.join(blackoutDir(), "lists.json");
}

/**
 * vanta.blackout.lists holds whitespace-separated "id=url" entries. Each list
 * is stored as <id>.txt, so ids are kept to a safe file name.
 */
function configuredLists() {
  const lists = [];
  for (const entry of Services.prefs
    .getStringPref(PREF_LISTS, "")
    .split(/\s+/)) {
    const split = entry.indexOf("=");
    const id = entry.slice(0, split);
    const url = entry.slice(split + 1);
    if (split > 0 && /^[a-z0-9-]+$/.test(id) && url.startsWith("https://")) {
      lists.push({ id, url });
    }
  }
  return lists;
}

function classifier() {
  try {
    return Cc["@mozilla.org/content-classifier-service;1"].getService(
      Ci.nsIContentClassifierService
    );
  } catch (e) {
    // The service is unavailable while the content classifier is switched off.
    return null;
  }
}

// A captive portal or an error page answers with HTML instead of a list.
function looksLikeFilterList(text) {
  const start = text.trimStart().slice(0, 256).toLowerCase();
  return (
    start.length && !start.startsWith("<!doctype") && !start.startsWith("<html")
  );
}

export const Blackout = {
  _updating: null,

  /**
   * browser-before-ui-startup: before any page loads.
   */
  init() {
    ChromeUtils.registerWindowActor("Blackout", {
      parent: { esModuleURI: "resource:///actors/BlackoutParent.sys.mjs" },
      child: {
        esModuleURI: "resource:///actors/BlackoutChild.sys.mjs",
        events: {
          DOMDocElementInserted: { capture: true },
          DOMContentLoaded: {},
        },
      },
      matches: ["http://*/*", "https://*/*"],
      allFrames: true,
      enablePreference: "vanta.blackout.cosmetic.enabled",
    });

    Services.prefs.addObserver(PREF_LISTS, () => this.update());
    Services.prefs.addObserver(PREF_ENABLED, () => {
      if (Services.prefs.getBoolPref(PREF_ENABLED, false)) {
        this.update();
      }
    });

    if (!Services.prefs.getBoolPref(PREF_ENABLED, false)) {
      return;
    }
    // Getting the service starts it, and it loads the cached engine on a
    // background thread, so the pages restored at startup are covered.
    classifier();
    // The first run has no lists yet: fetch them now rather than at idle.
    IOUtils.exists(listsDir()).then(exists => {
      if (!exists) {
        this.update();
      }
    });
  },

  /**
   * browser-idle-startup: refresh the lists on a timer that survives
   * restarts and sleep, once a day by default.
   */
  startUpdates() {
    Cc["@mozilla.org/updates/timer-manager;1"]
      .getService(Ci.nsIUpdateTimerManager)
      .registerTimer(
        TIMER_ID,
        { notify: () => this.update() },
        Services.prefs.getIntPref(PREF_INTERVAL, 86400),
        /* skipFirst */ true
      );
  },

  /**
   * Downloads the configured lists that changed, drops the ones no longer
   * configured, and rebuilds the engine if anything changed. Concurrent
   * calls share one run.
   */
  update() {
    if (!this._updating) {
      this._updating = this._update()
        .catch(e => lazy.log.error("List update failed", e))
        .finally(() => {
          this._updating = null;
        });
    }
    return this._updating;
  },

  async _update() {
    if (!Services.prefs.getBoolPref(PREF_ENABLED, false)) {
      return;
    }
    const dir = listsDir();
    await IOUtils.makeDirectory(dir, { createAncestors: true });

    let state = {};
    try {
      state = await IOUtils.readJSON(statePath());
    } catch (e) {
      // First run, or the state was lost: everything gets fetched in full.
    }

    const lists = configuredLists();
    let changed = false;
    for (const { id, url } of lists) {
      const file = PathUtils.join(dir, `${id}.txt`);
      const previous =
        state[id]?.url == url && (await IOUtils.exists(file))
          ? state[id]
          : null;
      const headers = {};
      if (previous?.etag) {
        headers["If-None-Match"] = previous.etag;
      }
      if (previous?.lastModified) {
        headers["If-Modified-Since"] = previous.lastModified;
      }

      let response;
      try {
        response = await fetch(url, { headers, credentials: "omit" });
      } catch (e) {
        lazy.log.warn(`Could not fetch ${id}`, e);
        continue;
      }
      if (response.status == 304) {
        continue;
      }
      if (!response.ok) {
        lazy.log.warn(`Could not fetch ${id}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (text.length > MAX_LIST_LENGTH || !looksLikeFilterList(text)) {
        lazy.log.warn(
          `${id} does not look like a filter list; keeping the old copy`
        );
        continue;
      }

      await IOUtils.writeUTF8(file, text, { tmpPath: `${file}.tmp` });
      state[id] = {
        url,
        etag: response.headers.get("ETag"),
        lastModified: response.headers.get("Last-Modified"),
      };
      changed = true;
      lazy.log.debug(`Updated ${id}`);
    }

    const wanted = new Set(lists.map(({ id }) => `${id}.txt`));
    for (const path of await IOUtils.getChildren(dir)) {
      const name = PathUtils.filename(path);
      if (name.endsWith(".txt") && !wanted.has(name)) {
        await IOUtils.remove(path);
        delete state[name.slice(0, -".txt".length)];
        changed = true;
      }
    }

    await IOUtils.writeJSON(statePath(), state);
    if (changed) {
      classifier()?.onListsChanged([FEATURE], []);
    }
  },
};
