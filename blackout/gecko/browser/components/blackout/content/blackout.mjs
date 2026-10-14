/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// about:blackout: Blackout's lists and settings. Runs in the parent process
// with chrome privileges, like about:preferences.

const { Blackout } = ChromeUtils.importESModule(
  "moz-src:///browser/components/blackout/Blackout.sys.mjs"
);

const PREF_ENABLED = "privacy.trackingprotection.content.protection.enabled";
const PREF_LISTS = "vanta.blackout.lists";
const LISTS_UPDATED = "vanta-blackout-lists-updated";
const GROUPS = ["Ads", "Privacy", "Security", "Annoyances", "Fixes", "Custom"];

const CLEANUP = [
  {
    pref: "vanta.blackout.cosmetic.enabled",
    name: "Hide ad spaces",
    description: "Removes the empty boxes blocked ads leave behind",
  },
  {
    pref: "vanta.blackout.cosmetic.generic",
    name: "Hide common ad spaces everywhere",
    description:
      "Rules meant for every site, matched to each page's own markup",
    needs: "vanta.blackout.cosmetic.enabled",
  },
  {
    pref: "vanta.blackout.scriptlets.enabled",
    name: "Defuse anti-adblock scripts",
    description:
      "Small fixes the lists run in pages before the page's own scripts",
    needs: "vanta.blackout.cosmetic.enabled",
  },
  {
    pref: "vanta.blackout.cosmetic.generic_complex",
    name: "Thorough hiding",
    description:
      "About 550 more rules on every page. Catches a little more, costs a little speed",
    needs: "vanta.blackout.cosmetic.enabled",
  },
];

const $ = id => document.getElementById(id);
const numbers = new Intl.NumberFormat(undefined);
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(time) {
  const seconds = (time - Date.now()) / 1000;
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

function size(bytes) {
  return bytes >= 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("aria-") || key == "role") {
      node.setAttribute(key, value);
    } else {
      node[key] = value;
    }
  }
  node.append(...children.filter(child => child != null));
  return node;
}

function switchButton(checked, label, onToggle, disabled = false) {
  const button = el("button", {
    className: "switch",
    role: "switch",
    "aria-checked": String(checked),
    "aria-label": label,
    disabled,
  });
  button.addEventListener("click", () => onToggle(!checked));
  return button;
}

// --- Header -------------------------------------------------------------

async function renderHeader(rows) {
  const on = Services.prefs.getBoolPref(PREF_ENABLED, false);
  $("eclipse").toggleAttribute("off", !on);
  const enabled = $("enabled");
  enabled.setAttribute("aria-checked", String(on));
  enabled.onclick = () => Services.prefs.setBoolPref(PREF_ENABLED, !on);

  const active = rows.filter(row => row.enabled);
  const checked = Math.max(0, ...active.map(row => row.checked ?? 0));
  let text = on
    ? `Blocking with ${active.length} ${active.length == 1 ? "list" : "lists"}`
    : "Off everywhere";
  if (on && Blackout.updating) {
    text += ", updating now";
  } else if (on && checked) {
    text += `, checked ${ago(checked)}`;
  }
  $("summary").textContent = text;
  try {
    const total = await Cc["@mozilla.org/tracking-db-service;1"]
      .getService(Ci.nsITrackingDBService)
      .sumAllEvents();
    if (total) {
      $("summary").textContent =
        `${text}. ${numbers.format(total)} blocked in total.`;
    }
  } catch (e) {
    // No history yet.
  }
}

// --- Lists --------------------------------------------------------------

function listRow(row) {
  let meta;
  if (!row.enabled) {
    meta = row.custom ? row.url : null;
  } else if (row.error) {
    meta = el("span", {
      className: "error",
      textContent: `Last check failed: ${row.error}`,
    });
  } else if (row.size != null) {
    meta = `${size(row.size)}${row.updated ? `, changed ${ago(row.updated)}` : ""}`;
  } else {
    meta = "Waiting to download";
  }
  const text = el(
    "div",
    { className: "row-text" },
    el("span", { className: "row-name", textContent: row.name }),
    row.description
      ? el("span", { className: "muted", textContent: row.description })
      : null,
    meta ? el("span", { className: "row-meta" }, meta) : null
  );
  const controls = el("div", { className: "row-controls" });
  if (row.custom) {
    const remove = el("button", { className: "quiet", textContent: "Remove" });
    remove.addEventListener("click", () => Blackout.removeList(row.id));
    controls.append(remove);
  } else {
    controls.append(
      switchButton(row.enabled, row.name, on =>
        Blackout.setListEnabled(row.id, on)
      )
    );
  }
  return el("div", { className: "row" }, text, controls);
}

function renderLists(rows) {
  const container = $("lists");
  container.replaceChildren();
  for (const group of GROUPS) {
    const inGroup = rows.filter(row => row.group == group);
    if (!inGroup.length) {
      continue;
    }
    container.append(
      el("h3", { textContent: group }),
      el("div", { className: "card" }, ...inGroup.map(listRow))
    );
  }
  const button = $("update-now");
  button.disabled =
    Blackout.updating || !Services.prefs.getBoolPref(PREF_ENABLED, false);
  button.textContent = Blackout.updating ? "Updating…" : "Update now";
}

$("update-now").addEventListener("click", () => {
  Blackout.update();
  render();
});

$("add-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("add-url");
  const error = $("add-error");
  try {
    Blackout.addCustomList(input.value);
    input.value = "";
    error.hidden = true;
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
});

// --- On the page ----------------------------------------------------------

function renderCleanup() {
  const container = $("cleanup");
  container.replaceChildren();
  for (const item of CLEANUP) {
    const checked = Services.prefs.getBoolPref(item.pref, false);
    const disabled =
      item.needs && !Services.prefs.getBoolPref(item.needs, false);
    container.append(
      el(
        "div",
        { className: disabled ? "row disabled" : "row" },
        el(
          "div",
          { className: "row-text" },
          el("span", { className: "row-name", textContent: item.name }),
          el("span", { className: "muted", textContent: item.description })
        ),
        el(
          "div",
          { className: "row-controls" },
          switchButton(
            checked,
            item.name,
            on => Services.prefs.setBoolPref(item.pref, on),
            disabled
          )
        )
      )
    );
  }
}

// --- Sites ----------------------------------------------------------------

function renderSites() {
  const container = $("sites");
  container.replaceChildren();
  const sites = Services.perms
    .getAllByTypes(["trackingprotection"])
    .filter(permission => permission.capability == Services.perms.ALLOW_ACTION);
  if (!sites.length) {
    container.append(
      el("p", {
        className: "muted empty",
        textContent: "None. Blackout is on everywhere.",
      })
    );
    return;
  }
  for (const permission of sites) {
    const turnOn = el("button", {
      className: "quiet",
      textContent: "Turn back on",
    });
    turnOn.addEventListener("click", () => {
      Services.perms.removePermission(permission);
      renderSites();
    });
    container.append(
      el(
        "div",
        { className: "row" },
        el(
          "div",
          { className: "row-text" },
          el("span", {
            className: "row-name",
            textContent:
              permission.principal.host || permission.principal.origin,
          })
        ),
        el("div", { className: "row-controls" }, turnOn)
      )
    );
  }
}

// --- Keeping it current -----------------------------------------------------

// One render at a time; a change during one renders again after it.
let rendering = null;
let renderAgain = false;
function render() {
  if (rendering) {
    renderAgain = true;
    return;
  }
  rendering = (async () => {
    const rows = await Blackout.listStatus();
    renderLists(rows);
    renderCleanup();
    renderSites();
    await renderHeader(rows);
  })()
    .catch(console.error)
    .finally(() => {
      rendering = null;
      if (renderAgain) {
        renderAgain = false;
        render();
      }
    });
}

const prefObserver = { observe: () => render() };
const updateObserver = { observe: () => render() };
for (const pref of [
  PREF_ENABLED,
  PREF_LISTS,
  ...CLEANUP.map(item => item.pref),
]) {
  Services.prefs.addObserver(pref, prefObserver);
}
Services.obs.addObserver(updateObserver, LISTS_UPDATED);
window.addEventListener("unload", () => {
  for (const pref of [
    PREF_ENABLED,
    PREF_LISTS,
    ...CLEANUP.map(item => item.pref),
  ]) {
    Services.prefs.removeObserver(pref, prefObserver);
  }
  Services.obs.removeObserver(updateObserver, LISTS_UPDATED);
});

render();
