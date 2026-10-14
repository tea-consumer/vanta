---
name: vanta-icons
description: Design, change or review any Vanta icon (app icon, private-browsing or document icon, toolbar glyph, logo variant). Covers Vanta's icon rules, geometry helpers, a variant explorer, checks that render review sheets, and the audit CI runs.
---

# Making Vanta icons

You can't see an SVG while you write it. This skill makes up for that: build
icons from code with `iconkit.py`, sweep variants with `explore.py`,
**look** at them on the review sheets the tools render, and let
`audit.py` guard everything that ships. Never call an icon done without
reading its sheet.

Needs `cairosvg` and `pillow` (`pip install cairosvg pillow`). All scripts
are in `.claude/skills/vanta-icons/scripts/`; run them from the repo root.

## Fast path

| Task | Command |
|---|---|
| Try many versions of one idea | `explore.py builder.py --param rim=60,80,100 --param angle=35,45 --out sweep.png` |
| Check one icon or a family | `icon_check.py a.svg b.svg --out review.png` |
| Pick between alternatives | `icon_check.py v1.svg v2.svg --variants --out review.png` |
| Replace shipped art | `icon_check.py new.svg --against branding/logo.svg` |
| Before committing | `audit.py --since HEAD` (CI runs plain `audit.py`) |
| After changing the toolkit | `test_toolkit.py` |

Add `--quiet` to see only problems, `--json` for machine-readable results.

## Workflow

1. **Find where the icon ships** in `icons.json` (or add it there). The
   smallest size it is shown at decides the design.
2. **Sketch the silhouette in words.** One idea that reads as a shape at
   16px, drawn from the eclipse: a disc, its shadow, a rim of light, a
   corona. If it needs detail to read, it's the wrong idea.
3. **Write a builder** in your scratchpad: a `build(**params)` returning
   SVG from iconkit, with the decisions you're unsure of as parameters.
   ```python
   import sys; sys.path.insert(0, ".claude/skills/vanta-icons/scripts")
   from iconkit import *
   def build(rim=100, angle=45, r=340):
       shadow = r - 40
       return icon(tile(inset=24, radius=208, edge_width=48),
                   eclipse(512, 512, r, shadow, shift=rim - 40, angle=angle))
   ```
4. **Sweep it:** `explore.py builder.py --param ... --keep DIR --out sweep.png`.
   It builds every combination, checks and ranks them, and draws the best
   on one sheet (128/32/16px, 16px at 8x, light background, key numbers).
   Read the sheet. Scores rank; your eyes decide. Narrow the ranges and
   sweep again around the winner rather than guessing one value.
5. **Check the pick properly:** `icon_check.py DIR/vNNN.svg --smallest N`
   (with `--against` when replacing art) and read `review.png`. Fix every
   FAIL; answer every warning (fix it, or know why it's fine).
6. **Ship it:** copy the SVG to its `branding/` path, list it in
   `icons.json`, run `python3 scripts/make-branding.py --preview sheet.png`
   and read that sheet, then `audit.py`. Commit sources and
   `branding/vanta/` together.
7. **Show Fredrik pictures, not SVG.** Put the sweep or review sheet in
   `/mnt/project-files/vanta/logo/`, attach it, and say the choice in one
   line. He judges by eye.

## Vanta's icon rules

Identity (decided with Fredrik, 2026-10-12/13):
- Dark by default, **monochrome**: black void `#000`, rim light `#ececf1`,
  tile edge `#2a2a2e`, dim `#9a9aa2`. Accents (ice `#9ec4ff`, sage
  `#a8c69a`, ember `#f4b183`) are user options in the UI, never the default
  icon colour. Electric lime was rejected as too heavy.
- The mark is the **Eclipse**: a lit disc cut by a shadow disc, light on
  the upper left (shadow pushed toward 45°). Variants keep that logic:
  total eclipse = private browsing (corona, no light).
- Calm and flat. No gradients except a faint corona glow, no drop shadows,
  no glass, no bevels, no texture. Sleek, distinct, quiet. Zen is an
  inspiration only; never copy another browser's art.
- Derive new shapes from Vanta's own: circles, rounded squares, the rim.

Craft:
- **App tile:** Linux tile is inset 64, radius 200 on 1024; macOS uses
  Apple's body (inset 100, size 824, radius 185) so the Dock shows it at
  the size of other apps; art for 32px and below goes near full-bleed
  (inset 24) with a heavier edge. Keep the `#2a2a2e` edge so the black tile
  separates from dark docks.
- **Minimum feature size:** about 1.5px at the smallest shipped size:
  `min_stroke(16)` = 96 units on 1024. The logo's rim (thickest about 59
  units) can't survive 16px, so `small.svg` exists. Prefer separate
  small-size art over a compromise.
- **Glyphs (16 units):** stroke 1.5 or 2, 1 unit of padding, straight edges
  on whole or half units, `context-fill` only, one idea per glyph. A set
  shares stroke weight and corner radius. When the crispness check offers
  a nudge, apply it.
- **Balance:** the eclipse leans up-left on purpose; anything else should
  sit within a few percent of centre.
- **A family must be told apart at 16px.**

Technical (the build renders with cairosvg, Firefox renders the rest):
- No `<mask>` (cairosvg ignores it; this already bit us once), no
  `<filter>`, `<text>`, `<image>` or `<foreignObject>`. Cut shapes with
  path maths: `crescent_path`, `ring`.
- If the browser and cairosvg disagree, the shipped icon won't match what
  you previewed: fix the SVG, never the check.
- `viewBox` is `0 0 1024 1024` for app art, `0 0 16 16` for glyphs.

## What the checks mean

| Check | Fails / warns when | Fix |
|---|---|---|
| lint | mask/filter/text/image, bad XML, no viewBox; off-palette colours, glyph without `context-fill`, long decimals, heavy file | use iconkit shapes and palette constants |
| bounds | tile inset is neither 64, 100 nor full-bleed; glyph touches the edge | match the grid for where it ships |
| legibility | at 16-24px the mark's strongest pixel is under 60% or fewer than 4 pixels are solid | thicker features, or separate small art |
| balance | (info) where the visual weight sits | move or resize the mark |
| crispness | a glyph is mostly half-tone at 16px, or a half-pixel nudge would sharpen it | apply the nudge, put edges on the pixel grid |
| contrast | mark vs tile under 4.5:1; glyph under 4.5:1 on a dark or light toolbar | use rim light / context-fill at full opacity |
| weight | (info) typical stroke in units and in pixels at the smallest size | compare with `min_stroke` |
| browser | Chromium and cairosvg differ on over 1% of pixels | remove what cairosvg can't draw |
| set | two siblings nearly identical at 16px; glyph strokes differ by over 30% | change silhouettes, unify weight |
| build (audit) | `branding/vanta/` doesn't match its sources | run `scripts/make-branding.py` |

Scores (0-100) subtract 25 per FAIL and 5 per warning, plus up to 30 for
too few solid pixels at the smallest size and up to 10 for blur. Use them
to rank, not to replace looking.

## Files

- `icons.json`: every shipped source, its smallest size and family. New
  icons go here, or the audit warns that nothing checks them.
- `scripts/iconkit.py`: palette, grids, shapes (`tile`, `eclipse`,
  `crescent_path`, `ring`, `arc`, `corona`, `disc`, `rounded_rect`, `line`),
  `icon()` and `min_stroke()`.
- `scripts/vcheck.py`, `scripts/vsheet.py`: the checks and sheets the
  three tools share.
- `scripts/icon_check.py`, `scripts/explore.py`, `scripts/audit.py`: the
  tools above. `scripts/test_toolkit.py`: proves the geometry is exact and
  the checks catch what they claim.
- `.github/workflows/icons.yml`: CI runs the tests and the audit on any PR
  that touches icons, and uploads the audit sheet.
- `tools/icon-studio.html`: the same shapes for Fredrik by hand. Its SVGs
  carry their layers in `<metadata id="vanta-studio">`.
