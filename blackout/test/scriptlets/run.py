# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Runs Blackout's scriptlets in a real Firefox (157 or later) and checks
what the test pages saw.

    python3 run.py /path/to/firefox

Uses an unmodified Firefox: the Blackout modules are loaded from this
checkout under a resource:// alias, the scriptlet table is built from
lists/ with blackout/bench, and the test hosts point at a local server.
"""

import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SRC = os.path.join(REPO, "blackout/gecko/browser/components/blackout")
sys.path.insert(0, HERE)
from marionette import Marionette  # noqa: E402

PORT = 8765
HOSTS = "a.test,g.test,www.example.co.uk,sub.b.test,c.test,d.test,e.test,f.test"


def build(work):
    """The scriptlet table, as an engine build writes it next to the cache."""
    tmp = os.path.join(work, "tmp")
    os.makedirs(tmp)
    subprocess.run(
        ["cargo", "run", "--release", "-q", "--manifest-path",
         os.path.join(REPO, "blackout/bench/Cargo.toml"), "--",
         os.path.join(HERE, "lists")],
        env=dict(os.environ, TMPDIR=tmp), check=True, stdout=subprocess.DEVNULL)
    return os.path.join(tmp, "scriptlets.json")


def install(work):
    """The Blackout modules, pointed at the resource://vtest alias."""
    actors = os.path.join(work, "actors")
    os.makedirs(actors)
    for name in os.listdir(SRC):
        if name.endswith((".mjs", ".js")):
            with open(os.path.join(SRC, name)) as f:
                text = f.read().replace("resource:///actors/", "resource://vtest/actors/")
            with open(os.path.join(actors, name), "w") as f:
                f.write(text)


SETUP = """
const done = arguments[arguments.length - 1];
(async () => {
  const [work, table] = arguments;
  const res = Services.io.getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(work);
  res.setSubstitution("vtest", Services.io.newFileURI(dir));
  const profileDir = PathUtils.join(PathUtils.profileDir, "blackout");
  await IOUtils.makeDirectory(profileDir);
  await IOUtils.copy(table, PathUtils.join(profileDir, "scriptlets.json"));
  const { Blackout } = ChromeUtils.importESModule(
    "resource://vtest/actors/Blackout.sys.mjs");
  Blackout.init();
  await Blackout.publishScriptlets();
  return "ok";
})().then(done, e => done(String(e)));
"""

ALLOW = """
const p = Services.scriptSecurityManager.createContentPrincipalFromOrigin(
  "http://a.test:%d");
Services.perms.addFromPrincipal(p, "trackingprotection", Services.perms.ALLOW_ACTION);
""" % PORT

# What /a should see with Blackout's rules for a.test.
BLOCKED = {
    "set1": False, "set1b": False, "set2": True,
    "aopr": "threw ReferenceError", "aopw": "threw ReferenceError",
    "json": '{"ok":2}', "trusted": '{"value":"hello"}', "ls": "true",
    "woif": "null", "timeoutAd": "pending", "timeoutOk": "ran",
    "aeldAd": "no", "aeldOk": "yes", "acs1": False, "acs2": True,
    "rmnt": "undefined", "rmnt2": "undefined", "xhrAd": "200:", "fetchAd": "",
    "fetchOk": "REAL", "fetchJson": '{"data":3}', "ra": False, "rc": "box keep",
    "href": "https://dest.example/",
}
# And without any.
UNTOUCHED = {
    "set1b": True, "set2": False, "json": '{"ads":1,"ok":2}', "aopw": "assigned",
    "timeoutAd": "ran", "aeldAd": "yes", "acs1": True, "rmnt": "adblockDetected",
    "xhrAd": "200:REAL", "fetchAd": "REAL", "ra": True, "rc": "box ad-banner keep",
}
SITES = {
    "www.example.co.uk": {"entity": 1},
    "sub.b.test": {"sub": 1},
    "c.test": {"kept": 1},
    "d.test": {},
    "e.test": {},
    "f.test": {},
}

failures = []


def check(label, got, want):
    for key, value in want.items():
        if got.get(key) != value:
            failures.append(f"{label}: {key} = {got.get(key)!r}, want {value!r}")


def main():
    firefox = sys.argv[1]
    work = tempfile.mkdtemp(prefix="blackout-scriptlets-")
    table = build(work)
    install(work)
    server = subprocess.Popen([sys.executable, "-I", os.path.join(HERE, "page.py"), str(PORT)])
    m = Marionette(firefox, prefs={
        "network.dns.localDomains": HOSTS,
        "privacy.trackingprotection.content.protection.enabled": True,
        "vanta.blackout.lists": "",
        "vanta.blackout.cosmetic.enabled": True,
        "dom.disable_open_during_load": False,
    })

    def load(url, wait):
        m.navigate(url)
        time.sleep(wait)
        return json.loads(m.content(
            "return JSON.stringify((window.wrappedJSObject || window).R)") or "{}")

    try:
        result = m.chrome(SETUP, [work, table], asyncscript=True)
        if result != "ok":
            raise RuntimeError(result)
        # The first page of a process takes the sandbox path, later ones the
        # precompiled script; the second round covers both.
        for round_ in (1, 2):
            for path in ("/a", "/csp/a"):
                got = load(f"http://a.test:{PORT}{path}", 1.6)
                want = dict(BLOCKED)
                if path.startswith("/csp"):
                    want["evalOk"] = "threw EvalError"
                else:
                    want["evalOk"] = 4
                    want["evalAd"] = None
                check(f"round {round_} {path}", got, want)
                if not got.get("stb", 1000) < 200:
                    failures.append(f"round {round_} {path}: stb = {got.get('stb')}")
        check("inline scripts", load(f"http://g.test:{PORT}/r", 0.3), {"log": ["two"]})
        for host, want in SITES.items():
            got = load(f"http://{host}:{PORT}/v", 0.3)
            if got != want:
                failures.append(f"{host}: {got}, want {want}")
        check("unlisted site", load(f"http://f.test:{PORT}/a", 1.6), UNTOUCHED)
        m.chrome(ALLOW)
        check("allow-listed site", load(f"http://a.test:{PORT}/a", 1.6), UNTOUCHED)
    finally:
        m.quit()
        server.kill()

    for failure in failures:
        print("FAIL", failure)
    print("all passed" if not failures else f"{len(failures)} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
