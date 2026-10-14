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
 *    lists name and run the lists' scriptlets in pages;
 *  - shares the scriptlet table the engine build writes
 *    (<profile>/blackout/scriptlets.json) with the content processes.
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
const PREF_SCRIPTLETS = "vanta.blackout.scriptlets.enabled";
const TIMER_ID = "vanta-blackout-lists";
const FEATURE = "blackout";
const ENGINES_UPDATED = "content-classifier-engines-updated";
const SCRIPTLETS_URL = "resource:///actors/BlackoutScriptlets.js";

// Keys in Services.ppmm.sharedData; BlackoutChild reads them. The host
// index is split by the hosts' first character, SHARED_HOSTS + "a" and so on.
const SHARED_HOSTS = "Blackout:ScriptletHosts:";
const SHARED_CALLS = "Blackout:ScriptletCalls";
const SHARED_SOURCE = "Blackout:ScriptletSource";

// Hosts on uBlock Origin's own sites. Lists from there may use the
// scriptlets that are only safe from a trusted source (trusted-*), as in
// uBlock Origin. The engine glue tells them apart by the .trusted.txt name.
const TRUSTED_LIST_HOSTS = ["ublockorigin.github.io", "ublockorigin.pages.dev"];

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

function scriptletsPath() {
  return PathUtils.join(blackoutDir(), "scriptlets.json");
}

function listFileName({ id, url }) {
  const host = URL.parse(url)?.hostname;
  return TRUSTED_LIST_HOSTS.includes(host) ? `${id}.trusted.txt` : `${id}.txt`;
}

function listId(fileName) {
  return fileName.replace(/(\.trusted)?\.txt$/, "");
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
  _publishedKey: null,
  _scriptletSource: null,

  /**
   * browser-before-ui-startup: before any page loads.
   */
  init() {
    ChromeUtils.registerWindowActor("Blackout", {
      parent: { esModuleURI: "resource:///actors/BlackoutParent.sys.mjs" },
      child: {
        esModuleURI: "resource:///actors/BlackoutChild.sys.mjs",
        events: {
          DOMWindowCreated: {},
          DOMDocElementInserted: { capture: true },
          DOMContentLoaded: {},
        },
      },
      matches: ["http://*/*", "https://*/*"],
      allFrames: true,
      // Pages are what it is for, and Firefox 157 keeps actors out of web
      // content processes unless they say they are safe there.
      safeForUntrustedWebProcess: true,
      enablePreference: "vanta.blackout.cosmetic.enabled",
    });

    // Each finished engine build (the cached one at startup too) rewrote the
    // scriptlet table, so share the new one.
    Services.obs.addObserver(() => this.publishScriptlets(), ENGINES_UPDATED);
    Services.prefs.addObserver(PREF_SCRIPTLETS, () => this.publishScriptlets());

    Services.prefs.addObserver(PREF_LISTS, () => this.update());
    Services.prefs.addObserver(PREF_ENABLED, () => {
      this.publishScriptlets();
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
    // The table from the last run is good until that load says otherwise.
    this.publishScriptlets();
    // The first run has no lists yet: fetch them now rather than at idle.
    IOUtils.exists(listsDir()).then(exists => {
      if (!exists) {
        this.update();
      }
    });
  },

  /**
   * Shares the scriptlet table with every content process, or withdraws it
   * when Blackout or its scriptlets are switched off. The table is split so
   * a page only unpacks the host index, and the calls only when its site has
   * any. The library source is there for the first page of a process, which
   * comes before the process has compiled its own copy.
   */
  async publishScriptlets() {
    const shared = Services.ppmm.sharedData;
    let table = null;
    if (
      Services.prefs.getBoolPref(PREF_ENABLED, false) &&
      Services.prefs.getBoolPref(PREF_SCRIPTLETS, true)
    ) {
      try {
        table = await IOUtils.readJSON(scriptletsPath());
      } catch (e) {
        // No engine build has written one yet.
      }
    }
    if (table?.key && table.key == this._publishedKey) {
      return;
    }
    this._publishedKey = table?.key;
    for (const key of shared.keys()) {
      if (key.startsWith(SHARED_HOSTS)) {
        shared.delete(key);
      }
    }
    if (!table) {
      shared.delete(SHARED_CALLS);
      shared.delete(SHARED_SOURCE);
      shared.flush();
      return;
    }

    this._scriptletSource ??= Cu.readUTF8URI(
      Services.io.newURI(SCRIPTLETS_URL)
    );
    const supported = this._supportedScriptlets(table.scripts);

    // One line per host, "\n<host>\t<calls>\t<exceptions>", with
    // comma-separated indexes into the calls; an exception of -1 switches
    // every scriptlet off for that host. A page finds its lines with a few
    // string searches in small strings, which is far cheaper than unpacking
    // a Map of tens of thousands of hosts in every content process.
    const lines = new Map();
    for (const [host, all] of Object.entries(table.hosts)) {
      const calls = all.filter(i => supported[i]);
      if (calls.length) {
        lines.set(host, [calls, []]);
      }
    }
    for (const [host, calls] of Object.entries(table.exceptions)) {
      lines.set(host, [lines.get(host)?.[0] ?? [], calls]);
    }
    const buckets = new Map();
    for (const [host, [calls, exceptions]] of lines) {
      if (!/\s/.test(host)) {
        const bucket = host[0];
        buckets.set(
          bucket,
          (buckets.get(bucket) ?? "") +
            `\n${host}\t${calls.join(",")}\t${exceptions.join(",")}`
        );
      }
    }
    // The calls, one JSON array per line, read only for sites that have any.
    const calls = table.scripts
      .map((call, i) => (supported[i] ? JSON.stringify(call) : ""))
      .join("\n");
    for (const [bucket, hosts] of buckets) {
      shared.set(SHARED_HOSTS + bucket, hosts + "\n");
    }
    shared.set(SHARED_CALLS, calls);
    shared.set(SHARED_SOURCE, this._scriptletSource);
    shared.flush();
  },

  /**
   * Which of `calls` ([name, ...args]) the scriptlet library has, so that
   * sites whose rules only name others get no scriptlet work at all.
   */
  _supportedScriptlets(calls) {
    const sandbox = Cu.Sandbox(null, { freshCompartment: true });
    try {
      // The library only needs a window's standard globals to load.
      Cu.evalInSandbox("var window = this;", sandbox);
      const run = Cu.waiveXrays(
        Cu.evalInSandbox(this._scriptletSource, sandbox)
      );
      return calls.map(([name]) => run.supports(String(name)));
    } finally {
      Cu.nukeSandbox(sandbox);
    }
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
    for (const list of lists) {
      const { id, url } = list;
      const file = PathUtils.join(dir, listFileName(list));
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

    const wanted = new Set(lists.map(listFileName));
    for (const path of await IOUtils.getChildren(dir)) {
      const name = PathUtils.filename(path);
      if (name.endsWith(".txt") && !wanted.has(name)) {
        await IOUtils.remove(path);
        // Only forget a list's state if the list itself went away, not when
        // its file was renamed (moved to or from a trusted host).
        if (!lists.some(list => list.id == listId(name))) {
          delete state[listId(name)];
        }
        changed = true;
      }
    }

    await IOUtils.writeJSON(statePath(), state);
    if (changed) {
      classifier()?.onListsChanged([FEATURE], []);
    }
  },
};
