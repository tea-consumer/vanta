---
name: vanta-icons
description: Design, change or review any Vanta icon (app icon, private-browsing or document icon, toolbar glyph, logo variant). Covers Vanta's icon rules, geometry helpers and a checker that renders review sheets to look at.
---

# Making Vanta icons

You can't see an SVG while you write it. This skill makes up for that: build
icons from code with `scripts/iconkit.py`, then **look** at them with
`scripts/icon_check.py`, which renders a review sheet image and measures what
the eye judges. Never call an icon done without reading its review sheet.

Needs `cairosvg` and `pillow` (`pip install cairosvg pillow`).

## Workflow

1. **Find where the icon ships.** Know every size it will be shown at
   before drawing (table below). Small sizes decide the design.
2. **Sketch the silhouette in words first.** One idea, readable as a shape
   at 16px. Vanta's ideas come from the eclipse: a disc, its shadow, a rim
   of light, a corona. If the idea needs detail to read, it's the wrong idea.
3. **Build it with iconkit**, in a throwaway script in your scratchpad, so
   numbers stay exact and changeable:
   ```python
   import sys; sys.path.insert(0, ".claude/skills/vanta-icons/scripts")
   from iconkit import *
   open("branding/src/new.svg", "w").write(
       icon(tile(), eclipse(512, 512, 300, 278, shift=37), comment="what this is"))
   ```
   Make **two or three variants** that differ in one decision (rim weight,
   shadow angle, inset) instead of one guess.
4. **Check and look:**
   ```
   python3 .claude/skills/vanta-icons/scripts/icon_check.py v1.svg v2.svg v3.svg --variants --out review.png
   ```
   (`--variants` skips the set check; leave it off when the icons are a
   family that must be told apart.)
   Read `review.png`. Fix every FAIL. Treat warnings as questions you
   answer, not noise. Pick the variant that reads best at 16-32px real
   pixels, not the prettiest at 256.
5. **Compare with what ships today** when replacing art:
   `--against branding/logo.svg` adds a side-by-side and a difference image.
6. **Wire it in and render:** sources live in `branding/` (see table), then
   `python3 scripts/make-branding.py --preview sheet.png` and read that sheet
   too. Commit sources and `branding/vanta/` together.
7. **Show Fredrik pictures, not SVG.** Put the review sheet in
   `/mnt/project-files/vanta/logo/` and attach it to the reply. He judges
   by eye; describe the choice in one line.

## Where icons ship

| Source | Shown as | Check with |
|---|---|---|
| `branding/logo.svg` | Linux icons 48-256px, about dialog | `--smallest 48` |
| `branding/src/small.svg` | everything 32px and below (taskbar, tabs, menu bar) | default (16) |
| `branding/src/macos.svg` | macOS Dock, Finder, disk image | `--smallest 48` (16/32 come from small.svg) |
| `branding/src/private.svg` | private-browsing about logo, 192/384px only | `--smallest 192` (look only) |
| `branding/src/document.svg` | macOS document icon | default |
| `branding/src/wordmark.svg` | about dialog, about:welcome | look only (not an icon) |
| `branding/glyphs/*.svg` | toolbar glyphs, 16px, `context-fill` | `--glyph` |

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
  no glass, no bevels, no texture. Fredrik's taste: sleek, distinct, quiet.
  Zen is an inspiration only; never copy another browser's art.
- Derive new shapes from Vanta's own: circles, rounded squares, the rim.

Craft:
- **App tile:** Linux tile is inset 64 with radius 200 on 1024; macOS uses
  Apple's body (inset 100, size 824, radius 185) so the Dock shows it the
  same size as other apps. Keep the 2-unit `#2a2a2e` edge so the black tile
  separates from dark docks and panels.
- **Minimum feature size:** anything that must be seen needs about 1.5px at
  the smallest size it ships at: `min_stroke(16)` = 96 units on 1024. The
  logo's rim (thickest about 59 units) fails at 16px; that's why
  `small.svg` exists. Prefer separate small-size art over a compromise.
- **Glyphs (16 units):** stroke 1.5 or 2, keep 1 unit of padding, put
  straight edges on whole or half units so they land on pixels, use
  `context-fill` only, one idea per glyph. Glyphs in a set share stroke
  weight and corner radius.
- **Optical balance:** the checker reports where the visual weight sits.
  The eclipse is meant to lean up-left; anything else should sit within a
  few percent of centre.
- **A set must be told apart at 16px.** Check siblings together; the
  checker flags pairs that look nearly the same.

Technical (the build renders with cairosvg, Firefox renders the rest):
- No `<mask>` (cairosvg ignores it and draws the shape whole: this already
  bit us once), no `<filter>`, `<text>`, `<image>` or `<foreignObject>`.
  Cut shapes with path maths instead: `crescent_path`, `ring`.
- The checker compares cairosvg with a real browser when it finds
  Chromium. If they disagree, the shipped icon won't match what you
  previewed; fix the SVG, never the check.
- Keep a `viewBox` of `0 0 1024 1024` for app art and `0 0 16 16` for glyphs.

## What the checks mean

- **lint:** forbidden elements, colours outside the palette, glyphs
  without `context-fill`.
- **tile inset:** whether the art fits Apple's grid or Vanta's tile.
- **legibility:** per size, how strong the mark's brightest pixel is
  compared with full size, and how many pixels are solidly lit. Under 4
  solid pixels at 16-24px means the mark dissolves into grey.
- **browser vs build:** share of pixels where Chromium and cairosvg differ.
- **set:** how different each pair looks at 16px.
- The review sheet has each icon at every size on dark and light, real
  16/24/32px pixels at 8x, a Dock and tab mockup, the set side by side,
  and the browser-vs-build and `--against` comparisons.

The Icon Studio (`tools/icon-studio.html`) is the same toolbox for Fredrik
by hand; SVGs it exports carry their layers in `<metadata id="vanta-studio">`.
