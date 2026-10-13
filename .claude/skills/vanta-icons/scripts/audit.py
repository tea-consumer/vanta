#!/usr/bin/env python3
"""Check every icon Vanta ships in one go (the pre-commit and CI check).

    python3 .claude/skills/vanta-icons/scripts/audit.py [--since REF] [--out audit.png]
        [--no-browser] [--no-build-check]

Reads .claude/skills/vanta-icons/icons.json for each source's kind and the
smallest size it ships at, picks up every glyph in branding/glyphs/, and:
- runs the icon checks with the right settings for each,
- checks each family (app art, glyphs) is told apart and shares a weight,
- flags SVGs under branding/ that nothing lists (so nothing ships unchecked),
- runs scripts/make-branding.py --check (rendered icons match their sources),
- writes one sheet of everything.
--since REF limits icon checks to sources changed since a git ref (faster
while iterating; CI runs everything). Exit status 1 on any failure.
"""
import argparse
import glob
import json
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from vcheck import FAIL, OK, WARN, check_icon, check_set, display_name, find_chrome  # noqa: E402
from vsheet import review_sheet  # noqa: E402

root = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
manifest_path = os.path.join(here, "..", "icons.json")


def changed_since(ref):
    out = subprocess.run(["git", "diff", "--name-only", ref, "--"], cwd=root, capture_output=True, text=True)
    if out.returncode:
        sys.exit(f"git diff against {ref} failed: {out.stderr.strip()}")
    return set(out.stdout.split())


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--since", help="only check icon sources changed since this git ref")
    ap.add_argument("--out", default="icon-audit.png")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--no-build-check", action="store_true", help="skip make-branding.py --check")
    args = ap.parse_args()

    manifest = json.load(open(manifest_path))
    entries = list(manifest["icons"])
    for g in sorted(glob.glob(os.path.join(root, manifest.get("glyph_dir", "branding/glyphs"), "*.svg"))):
        entries.append({"src": os.path.relpath(g, root), "kind": "glyph", "smallest": 16, "family": "glyphs"})

    problems = 0
    listed = {e["src"] for e in entries} | set(manifest.get("skip", []))
    for svg in sorted(glob.glob(os.path.join(root, "branding", "**", "*.svg"), recursive=True)):
        rel = os.path.relpath(svg, root)
        if rel.startswith("branding/vanta/"):
            continue                       # rendered output, checked by make-branding --check
        if rel not in listed:
            print(f"warn {rel} is not in icons.json, so nothing checks it; add it (or to skip)")

    if args.since:
        changed = changed_since(args.since)
        entries = [e for e in entries if e["src"] in changed]
        print(f"{len(entries)} icon source(s) changed since {args.since}")

    chrome = None if args.no_browser else find_chrome()
    reports, families = [], {}
    for e in entries:
        path = os.path.join(root, e["src"])
        if not os.path.exists(path):
            print(f"FAIL {e['src']} is listed in icons.json but missing")
            problems += 1
            continue
        r, _ = check_icon(path, e["kind"] == "glyph", e.get("smallest", 16), chrome)
        reports.append(r)
        families.setdefault(e.get("family", e["src"]), []).append(r)
        bad = [(l, c, m) for l, c, m in r.findings if l != OK]
        mark = "FAIL" if r.failed else "warn" if bad else "ok  "
        print(f"{mark} {r.score:3}  {e['src']}  (from {e.get('smallest', 16)}px)")
        for l, c, m in bad:
            print(f"       {l:4} {c:10} {m}")
        problems += r.failed

    for fam, rs in families.items():
        if len(rs) < 2:
            continue
        for l, c, m in check_set(rs):
            if l != OK:
                print(f"{l:4} [{fam}] {m}")
            problems += l == FAIL

    if not args.no_build_check:
        builder = os.path.join(root, "scripts", "make-branding.py")
        if os.path.exists(builder):
            res = subprocess.run([sys.executable, builder, "--check"], cwd=root, capture_output=True, text=True)
            if res.returncode:
                print("FAIL rendered icons are stale: " + (res.stderr or res.stdout).strip())
                problems += 1
            else:
                print("ok   branding/vanta matches its sources")

    if reports:
        review_sheet(reports, args.out)
        print(f"\naudit sheet: {args.out}")
    if not chrome and not args.no_browser:
        print("warn no Chromium found; browser-vs-build check skipped (set VANTA_CHROME)")
    print(f"\n{'FAILED' if problems else 'passed'}: {len(reports)} icon(s) checked")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
