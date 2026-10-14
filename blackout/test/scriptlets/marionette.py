# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""A tiny Marionette client: enough to run chrome-privileged JavaScript in a
headless Firefox and load pages."""
import json, socket, subprocess, time, os, tempfile, shutil

class Marionette:
    def __init__(self, firefox, prefs=None, port=2828):
        self.profile = tempfile.mkdtemp(prefix="mn-profile-")
        p = {"marionette.port": port, "browser.shell.checkDefaultBrowser": False,
             "datareporting.policy.dataSubmissionEnabled": False,
             "browser.startup.homepage_override.mstone": "ignore",
             "app.update.disabledForTesting": True, "browser.aboutwelcome.enabled": False,
             "security.sandbox.content.level": 0}
        p.update(prefs or {})
        with open(os.path.join(self.profile, "user.js"), "w") as f:
            for k, v in p.items():
                f.write(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n")
        env = dict(os.environ, MOZ_HEADLESS="1")
        self.proc = subprocess.Popen([firefox, "--marionette", "-remote-allow-system-access", "--headless", "-no-remote", "-profile", self.profile],
                                     env=env, stdout=subprocess.DEVNULL, stderr=open(os.path.join(self.profile, "stderr.log"), "w"))
        for _ in range(200):
            try:
                self.sock = socket.create_connection(("127.0.0.1", port)); break
            except OSError:
                time.sleep(0.2)
        self.buf = b""; self.id = 0
        self._read()
        self.cmd("WebDriver:NewSession", {"capabilities": {}})

    def _read(self):
        while b":" not in self.buf:
            self.buf += self.sock.recv(65536)
        n, rest = self.buf.split(b":", 1); n = int(n)
        while len(rest) < n:
            rest += self.sock.recv(65536)
        self.buf = rest[n:]
        return json.loads(rest[:n])

    def cmd(self, name, params=None):
        self.id += 1
        data = json.dumps([0, self.id, name, params or {}]).encode()
        self.sock.sendall(str(len(data)).encode() + b":" + data)
        while True:
            msg = self._read()
            if msg[0] == 1 and msg[1] == self.id:
                if msg[2]:
                    raise RuntimeError(json.dumps(msg[2])[:3000])
                return msg[3]

    def chrome(self, script, args=None, asyncscript=False):
        self.cmd("Marionette:SetContext", {"value": "chrome"})
        name = "WebDriver:ExecuteAsyncScript" if asyncscript else "WebDriver:ExecuteScript"
        return self.cmd(name, {"script": script, "args": args or [], "scriptTimeout": 30000}).get("value")

    def content(self, script, args=None):
        self.cmd("Marionette:SetContext", {"value": "content"})
        return self.cmd("WebDriver:ExecuteScript", {"script": script, "args": args or []}).get("value")

    def navigate(self, url):
        self.cmd("Marionette:SetContext", {"value": "content"})
        self.cmd("WebDriver:Navigate", {"url": url})

    def quit(self):
        try:
            self.cmd("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
        self.proc.wait(timeout=30)
        shutil.rmtree(self.profile, ignore_errors=True)
