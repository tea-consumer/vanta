# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Test page for run.py: a page on a.test that loads six resources from
tracker.test, which the test marks as a tracker."""
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/page"):
            body = b"<!doctype html><title>t</title><h1>News</h1>" + b"".join(b'<script src="http://tracker.test:8770/t%d.js"></script>' % i for i in range(5)) + b'<img src="http://tracker.test:8770/p.gif">'
            ct = "text/html"
        else:
            body = b"//"; ct = "text/javascript"
        self.send_response(200); self.send_header("Content-Type", ct); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8770), H).serve_forever()
