# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Test pages for run.py: /a exercises the scriptlets, /r inline-script
removal, /v site matching. A /csp prefix adds a strict CSP."""
import http.server, sys
HEAD = b"<!doctype html><html><head><meta charset=utf-8>"
PAGES = {
"/a": r"""
<script>
const R = {};
window.R = R;
const t = (k, f) => { try { R[k] = f(); } catch (e) { R[k] = "threw " + e.name; } };
t("set1", () => window.adsEnabled);
window.adsEnabled = true;
t("set1b", () => window.adsEnabled);
window.ads = { config: { on: false } };
t("set2", () => ads.config.on);
t("aopr", () => blockAdBlock);
t("json", () => JSON.stringify(JSON.parse('{"ads":1,"ok":2}')));
t("trusted", () => JSON.stringify(window.trustedVal));
t("evalAd", () => eval("1+1 // adsbox"));
t("evalOk", () => eval("2+2"));
t("ls", () => localStorage.getItem("vanta_k"));
t("woif", () => { const w = window.open("about:blank"); return w === null ? "null" : typeof w; });
t("aopw", () => { window.popAd = 1; return "assigned"; });
document.cookie = "adcookie=1"; document.cookie = "keep=1";
R.timeoutAd = "pending"; R.timeoutOk = "pending";
setTimeout(function () { /* adblock */ R.timeoutAd = "ran"; }, 10);
setTimeout(function () { R.timeoutOk = "ran"; }, 10);
const s0 = performance.now();
setTimeout(function countdown() { R.stb = Math.round(performance.now() - s0); }, 1000);
R.aeldAd = "no"; R.aeldOk = "no";
addEventListener("load", function () { /* adcheck */ R.aeldAd = "yes"; });
addEventListener("load", function () { R.aeldOk = "yes"; });
fetch("/ads.js").then(r => r.text()).then(x => (R.fetchAd = x), e => (R.fetchAd = "rejected " + e));
fetch("/ok.js").then(r => r.text()).then(x => (R.fetchOk = x));
fetch("/data.json").then(r => r.json()).then(x => (R.fetchJson = JSON.stringify(x)));
const x = new XMLHttpRequest(); x.open("GET", "/ads.js"); x.onload = () => (R.xhrAd = x.status + ":" + x.responseText); x.onerror = () => (R.xhrAd = "error"); x.send();
</script>
<script>document.write("<p id=w1>adsbygoogle</p>");</script>
<script>document.write("<p id=w2>fine</p>");</script>
<script>window.R_rmnt = "adblockDetected";</script>
</head><body>
<div id=x onclick="1">x</div><div class="box ad-banner keep">b</div>
<a class=out href="https://track.example/go?url=https%3A%2F%2Fdest.example%2F">l</a>
<script>
R.acs1 = !!document.getElementById("w1"); R.acs2 = !!document.getElementById("w2");
R.rmnt = String(window.R_rmnt);
setTimeout(() => {
  R.ra = document.getElementById("x").hasAttribute("onclick");
  R.rc = document.querySelector(".box").className;
  R.href = document.querySelector("a.out").getAttribute("href");
  R.cookie = document.cookie; R.rmnt2 = String(window.R_rmnt);
}, 300);
</script></body></html>""",
"/r": r"""<script>window.R = {log: []};</script>
<script>R.log.push("one KILLME");</script>
<script>R.log.push("two");</script>
</head><body><script>R.log.push("three KILLME");</script></body></html>""",
"/v": r"""<script>window.R = {entity: window.entity, sub: window.sub, exc: window.exc, kept: window.kept, x: window.x,
foo: (() => { try { return window.foo; } catch (e) { return "threw"; } })()};</script></head><body></body></html>""",
}
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        csp = path.startswith("/csp")
        if csp: path = path[4:]
        if path in PAGES:
            body = HEAD + PAGES[path].encode(); ctype = "text/html"
        elif path == "/data.json":
            body = b'{"ads":[1],"data":3}'; ctype = "application/json"
        else:
            body = b"REAL"; ctype = "text/javascript"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if csp:
            self.send_header("Content-Security-Policy", "script-src 'nonce-x' 'strict-dynamic'; object-src 'none'")
            body = body.replace(b"<script>", b'<script nonce="x">')
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
