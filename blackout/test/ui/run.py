# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Checks Blackout's toolbar button, panel and about:blackout page in a real
Firefox (157 or later), and saves a screenshot of the settings page.

    python3 run.py /path/to/firefox [screenshot.png]

Uses an unmodified Firefox: the Blackout modules are loaded from this
checkout under resource://vtest/, its chrome files are mapped over
chrome://browser/content/blackout/, and the page's blocked requests come
from ETP's test tracker list (Blackout's own blocks arrive the same way).
The settings page is opened by its chrome:// address, since about:blackout
itself needs the patched AboutRedirector.
"""

import base64
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SRC = os.path.join(REPO, "blackout/gecko/browser/components/blackout")
sys.path.insert(0, os.path.join(HERE, "../scriptlets"))
from marionette import Marionette  # noqa: E402

PORT = 8770


def install(work):
    os.makedirs(os.path.join(work, "content"))

    def copy(rel):
        with open(os.path.join(SRC, rel)) as f:
            text = f.read()
        text = text.replace("moz-src:///browser/components/blackout/", "resource://vtest/")
        text = text.replace("resource:///actors/", "resource://vtest/")
        with open(os.path.join(work, rel), "w") as f:
            f.write(text)

    for name in os.listdir(SRC):
        if name.endswith((".mjs", ".js")):
            copy(name)
    with open(os.path.join(work, "chrome.manifest"), "w") as manifest:
        for name in os.listdir(os.path.join(SRC, "content")):
            copy(os.path.join("content", name))
            manifest.write(
                f"override chrome://browser/content/blackout/{name} "
                f"file://{work}/content/{name}\n")


SETUP = """
const done = arguments[arguments.length - 1];
(async () => {
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(arguments[0]);
  Services.io.getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler)
    .setSubstitution("vtest", Services.io.newFileURI(dir));
  const manifest = dir.clone();
  manifest.append("chrome.manifest");
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(manifest);
  const { Blackout } = ChromeUtils.importESModule("resource://vtest/Blackout.sys.mjs");
  Blackout.init();
  await new Promise(resolve => setTimeout(resolve, 1000));
  const placements = [...document.getElementById("nav-bar-customization-target").children]
    .map(node => node.id);
  return placements.indexOf("vanta-blackout-button") - placements.indexOf("urlbar-container");
})().then(done, e => done(String(e)));
"""

BUTTON = """
const button = document.getElementById("vanta-blackout-button");
return [button.getAttribute("badge"), button.hasAttribute("blackout-off")];
"""

OPEN = """
const done = arguments[arguments.length - 1];
document.getElementById("vanta-blackout-button").doCommand();
setTimeout(() => {
  const panel = document.getElementById("vanta-blackout-panel");
  done([panel.state, panel.querySelector(".vb-status").textContent,
        panel.querySelector(".vb-count").textContent,
        panel.querySelector(".vb-switch").getAttribute("aria-checked")]);
}, 800);
"""

TOGGLE = """
const done = arguments[arguments.length - 1];
document.querySelector("#vanta-blackout-panel .vb-switch").click();
setTimeout(() => {
  const button = document.getElementById("vanta-blackout-button");
  done([button.getAttribute("badge") || "", button.hasAttribute("blackout-off"),
        document.getElementById("vanta-blackout-panel").state]);
}, 2500);
"""

failures = []


def expect(label, got, want):
    if got != want:
        failures.append(f"{label}: {got!r}, want {want!r}")


def main():
    firefox = sys.argv[1]
    screenshot = sys.argv[2] if len(sys.argv) > 2 else None
    work = tempfile.mkdtemp(prefix="blackout-ui-")
    install(work)
    server = subprocess.Popen([sys.executable, "-I", os.path.join(HERE, "page.py")])
    m = Marionette(firefox, prefs={
        "network.dns.localDomains": "a.test,tracker.test",
        "privacy.trackingprotection.enabled": True,
        "urlclassifier.trackingTable.testEntries": "tracker.test",
        "privacy.trackingprotection.content.protection.enabled": True,
        "vanta.blackout.lists": "easylist=https://easylist.to/easylist/easylist.txt",
        "vanta.blackout.cosmetic.enabled": True,
        "ui.systemUsesDarkTheme": 1,
    })
    try:
        expect("button right of the address bar", m.chrome(SETUP, [work], asyncscript=True), 1)
        m.navigate(f"http://a.test:{PORT}/page")
        time.sleep(1.5)
        badge, off = m.chrome(BUTTON)
        expect("badge shows a count", bool(badge) and badge.isdigit() and int(badge) > 0, True)
        expect("button on", off, False)
        state, status, count, checked = m.chrome(OPEN, asyncscript=True)
        expect("panel", (state, status, checked), ("open", "Blocking on a.test", "true"))
        expect("panel count", count, badge)
        expect("after switching off", m.chrome(TOGGLE, asyncscript=True), ["", True, "closed"])

        m.navigate("chrome://browser/content/blackout/blackout.html")
        time.sleep(2)
        rows, sites = m.content(
            "return [document.querySelectorAll('#lists .row').length,"
            " document.getElementById('sites').textContent]")
        expect("known lists shown", rows, 13)
        expect("site listed as off", "a.test" in sites, True)
        if screenshot:
            m.cmd("Marionette:SetContext", {"value": "content"})
            data = m.cmd("WebDriver:TakeScreenshot", {"full": True})["value"]
            with open(screenshot, "wb") as f:
                f.write(base64.b64decode(data))
    finally:
        m.quit()
        server.kill()
        shutil.rmtree(work, ignore_errors=True)

    for failure in failures:
        print("FAIL", failure)
    print("all passed" if not failures else f"{len(failures)} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
