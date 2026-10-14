"""Turns the request set adblock-rust benchmarks with (data/requests.json in
github.com/brave/adblock-rust, one JSON object per line) into the
url<TAB>page-url<TAB>type lines both benchmarks read. Top-level documents and
requests from non-web pages are left out: neither blocker acts on them the
same way, and Gecko does not classify them."""

import json
import sys

TYPES = {
    "xhr": "xmlhttprequest",
    "fetch": "xmlhttprequest",
    "texttrack": "other",
    "manifest": "other",
    "eventsource": "other",
}

with open(sys.argv[1]) as src, open(sys.argv[2], "w") as out:
    for line in src:
        r = json.loads(line)
        url, page, kind = r["url"], r["frameUrl"], r["cpt"]
        if kind == "document" or not page.startswith("http"):
            continue
        if any(c in url + page for c in "\t\n"):
            continue
        out.write(f"{url}\t{page}\t{TYPES.get(kind, kind)}\n")
