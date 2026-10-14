#!/usr/bin/env python3
"""Sweep an icon's parameters, check every variant, and rank them on one sheet.

Write a builder script with a `build(**params)` function that returns SVG
text (use iconkit), then:

    python3 .claude/skills/vanta-icons/scripts/explore.py builder.py \\
        --param rim=40,56,72 --param angle=35,45 [--glyph] [--smallest 16] \\
        [--keep DIR] [--out sweep.png] [--top 12] [--browser]

Every combination is built, checked like icon_check does, scored and ranked.
The sheet shows the best first: 128px, 32px and 16px on dark, 16px at 8x,
32px on light, the key numbers and the worst finding. Read it, pick, then
copy the winner from --keep (the ranking prints each variant's parameters).

Builder parameters arrive as numbers when they parse as numbers, else text.
"""
import argparse
import importlib.util
import itertools
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vcheck import check_icon, find_chrome  # noqa: E402
from vsheet import variant_grid  # noqa: E402


def parse_value(v):
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v


def load_builder(path):
    spec = importlib.util.spec_from_file_location("icon_builder", path)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, os.path.dirname(os.path.abspath(path)))
    spec.loader.exec_module(mod)
    if not hasattr(mod, "build"):
        sys.exit(f"{path} has no build(**params) function")
    return mod.build


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("builder")
    ap.add_argument("--param", action="append", default=[], metavar="NAME=V1,V2,...")
    ap.add_argument("--glyph", action="store_true")
    ap.add_argument("--smallest", type=int, default=16)
    ap.add_argument("--keep", help="directory to write the variant SVGs to (default: a temp dir)")
    ap.add_argument("--out", default="sweep.png")
    ap.add_argument("--top", type=int, default=12, help="how many variants the sheet shows")
    ap.add_argument("--browser", action="store_true", help="also run the browser-vs-cairosvg check (slower)")
    args = ap.parse_args()

    build = load_builder(args.builder)
    names, values = [], []
    for p in args.param:
        name, _, vals = p.partition("=")
        names.append(name)
        values.append([parse_value(v) for v in vals.split(",")])
    combos = [dict(zip(names, c)) for c in itertools.product(*values)] or [{}]
    if len(combos) > 200:
        sys.exit(f"{len(combos)} variants is too many to judge; narrow the sweep")

    out_dir = args.keep or tempfile.mkdtemp(prefix="vanta-sweep-")
    os.makedirs(out_dir, exist_ok=True)
    chrome = find_chrome() if args.browser else None
    results = []
    for i, params in enumerate(combos):
        label = " ".join(f"{k}={v}" for k, v in params.items()) or "default"
        path = os.path.join(out_dir, f"v{i:03d}.svg")
        with open(path, "w") as fh:
            fh.write(build(**params))
        report, _ = check_icon(path, args.glyph, args.smallest, chrome)
        results.append((label, report))
    results.sort(key=lambda x: x[1].rank_key)

    print(f"{len(results)} variants in {out_dir}, best first:")
    for rank, (label, r) in enumerate(results, 1):
        problems = [m for lvl, _, m in r.findings if lvl != "ok"]
        flag = " FAIL" if r.failed else ""
        print(f"  #{rank:<3} {r.score:3}{flag:5} {os.path.basename(r.path)}  {label}"
              + (f"   ({problems[0]})" if problems else ""))
    variant_grid(results[: args.top], args.out, args.glyph)
    print(f"\nsweep sheet: {args.out}  (Read it; scores rank, your eyes decide)")


if __name__ == "__main__":
    main()
