#!/usr/bin/env python3
"""Look at icons the way people will see them, and measure what eyes judge.

    python3 .claude/skills/vanta-icons/scripts/icon_check.py ICON.svg [MORE.svg ...]
        [--glyph] [--smallest N] [--variants] [--against REF.svg]
        [--out review.png] [--json] [--no-browser] [--quiet]

Checks: lint (masks, filters, text, palette, decimals, file weight),
bounds (grid fit, glyph padding), legibility per size, visual balance,
crispness (half-tone share, and the half-pixel nudge that would sharpen a
glyph), contrast (mark vs tile, glyph on dark and light toolbars), stroke
weight, browser-vs-cairosvg, and for several icons, set distinctness and
shared stroke weight. Each icon gets a 0-100 score.

Writes one review sheet PNG to Read. Exit status 1 when any check fails.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vcheck import FAIL, OK, check_icon, check_set, display_name, find_chrome  # noqa: E402
from vsheet import review_sheet  # noqa: E402


def print_report(r, quiet):
    print(f"\n{display_name(r.path)}   score {r.score}")
    for level, check, msg in r.findings:
        if quiet and level == OK:
            continue
        print(f"  {level:4} {check:10} {msg}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("icons", nargs="+")
    ap.add_argument("--glyph", action="store_true", help="16-unit toolbar glyphs (context-fill)")
    ap.add_argument("--smallest", type=int, default=16,
                    help="smallest size this art ships at (48 for art the build swaps out below that)")
    ap.add_argument("--variants", action="store_true",
                    help="the icons are alternatives for one slot: rank them, skip the set checks")
    ap.add_argument("--against", help="reference SVG to compare the first icon with")
    ap.add_argument("--out", default="icon-review.png")
    ap.add_argument("--json", action="store_true", help="print results as JSON instead of text")
    ap.add_argument("--no-browser", action="store_true", help="skip the browser-vs-cairosvg check")
    ap.add_argument("--quiet", action="store_true", help="print only problems")
    args = ap.parse_args()

    chrome = None if args.no_browser else find_chrome()
    reports, browser_rows = [], []
    for p in args.icons:
        r, rows = check_icon(p, args.glyph, args.smallest, chrome)
        reports.append(r)
        browser_rows.append((os.path.basename(p), rows))
    set_findings = check_set(reports) if len(reports) > 1 and not args.variants else []
    if args.variants:
        reports.sort(key=lambda r: r.rank_key)
    review_sheet(reports, args.out, args.against, browser_rows)

    failed = any(r.failed for r in reports) or any(l == FAIL for l, _, _ in set_findings)
    if args.json:
        print(json.dumps({"reports": [r.as_dict() for r in reports],
                          "set": [{"level": l, "check": c, "message": m} for l, c, m in set_findings],
                          "sheet": args.out, "failed": failed}, indent=2))
    else:
        for r in reports:
            print_report(r, args.quiet)
        if set_findings:
            print("\nset")
            for level, check, msg in set_findings:
                if not (args.quiet and level == OK):
                    print(f"  {level:4} {check:10} {msg}")
        if args.variants:
            print("\nranking: " + ", ".join(f"{display_name(r.path)} ({r.score})" for r in reports))
        if not chrome and not args.no_browser and not args.glyph:
            print("\n  warn no Chromium found; browser-vs-build check skipped (set VANTA_CHROME)")
        print(f"\nreview sheet: {args.out}  (Read it before calling the icon done)")
        if failed:
            print("some checks failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
