#!/usr/bin/env python3
"""Look at an icon the way people will see it, and measure what eyes judge.

    python3 .claude/skills/vanta-icons/scripts/icon_check.py ICON.svg [MORE.svg ...]
        [--glyph] [--against REF.svg] [--out review.png]

Prints a report (lint, renderer agreement, bounds, small-size legibility,
family distinctness) and writes one review sheet PNG to Read: every size on
dark and light, real 16/24/32px pixels at 8x, the set side by side, and a
diff against --against. Exit status 1 when any check fails.

Needs cairosvg and pillow. Uses a Chromium-family browser if one is found
($VANTA_CHROME, Playwright's, chromium, google-chrome, Chrome.app) to check
that cairosvg (the build) and the browser draw the icon the same way.
"""
import argparse
import glob
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

import cairosvg
from PIL import Image, ImageChops, ImageDraw, ImageStat

DARK, LIGHT, PANEL = (28, 28, 31), (230, 230, 235), (12, 12, 14)
PALETTE = {"#000", "#000000", "#ececf1", "#2a2a2e", "#9a9aa2", "#0c0c0e", "#1c1c20", "#3a3a40",
           "#9ec4ff", "#a8c69a", "#f4b183", "#fff", "#ffffff", "context-fill", "none"}
FORBIDDEN = {"mask": "cairosvg ignores masks; the build would draw the masked shape whole",
             "filter": "filters render differently in cairosvg and cost GPU in Firefox chrome",
             "text": "text depends on installed fonts; convert it to paths",
             "image": "embedded bitmaps don't scale; draw it as shapes",
             "foreignObject": "not rendered by cairosvg"}

problems = []


def fail(msg):
    problems.append(msg)
    print("  FAIL " + msg)


def warn(msg):
    print("  warn " + msg)


def info(msg):
    print("  ok   " + msg)


def display_name(path):
    rel = os.path.relpath(path)
    return os.path.basename(path) if rel.startswith("..") else rel


def svg_bytes(path, ink="#ececf1"):
    text = open(path).read()
    # context-fill only means something inside Firefox; preview it as a solid colour.
    return text.replace("context-fill-opacity", "1").replace("context-fill", ink).encode()


def render(path, size, ink="#ececf1"):
    png = cairosvg.svg2png(bytestring=svg_bytes(path, ink), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def on(bg, im):
    base = Image.new("RGBA", im.size, bg + (255,))
    base.alpha_composite(im)
    return base


def pixels(im):
    """Pixel list across Pillow versions (getdata is deprecated in Pillow 12)."""
    get = getattr(im, "get_flattened_data", None)
    return list(get() if get else im.getdata())


def luma(px):
    return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]


def ink_map(path, size, glyph):
    """Per-pixel 'ink': how far a pixel stands out from what's behind the mark."""
    im = render(path, size)
    if glyph:
        return [a / 255 * 255 for a in pixels(im.getchannel("A"))]
    flat = on(DARK, im)
    px = pixels(flat)
    alpha = pixels(im.getchannel("A"))
    solid = sorted(luma(p) for p, a in zip(px, alpha) if a > 250)
    base = solid[len(solid) // 2] if solid else luma(DARK)   # the tile colour
    return [abs(luma(p) - base) * a / 255 for p, a in zip(px, alpha)]


# ---------- checks ----------

def lint(path, glyph):
    text = open(path).read()
    for tag, why in FORBIDDEN.items():
        if re.search(rf"<{tag}[\s>/]", text):
            fail(f"<{tag}>: {why}")
    if "clipPath" in text:
        warn("clipPath: fine in cairosvg, but prefer computing the shape (iconkit.crescent_path)")
    colors = {c.lower() for c in re.findall(r'(?:fill|stroke|stop-color)="([^"u][^"]*)"', text)}
    odd = sorted(c for c in colors if c not in PALETTE)
    if odd:
        warn("colours outside Vanta's palette: " + ", ".join(odd))
    if glyph:
        if "context-fill" not in text:
            fail("glyph has no context-fill, so it won't follow the toolbar text colour in dark and light")
        hard = [c for c in colors if c not in ("context-fill", "none")]
        if hard:
            warn("glyph uses fixed colours " + ", ".join(hard) + "; they won't adapt to light mode")
    m = re.search(r'viewBox="0 0 (\S+) (\S+)"', text)
    if not m:
        fail("no viewBox")
    elif glyph and m.group(1) != "16":
        warn(f"glyph viewBox is {m.group(1)} wide; Firefox toolbar icons are drawn on 16")


def find_chrome():
    cands = [os.environ.get("VANTA_CHROME", "")]
    cands += sorted(glob.glob("/opt/pw-browsers/chromium*/chrome-linux/chrome"))
    cands += sorted(glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium*/chrome-linux/chrome")))
    cands += [shutil.which(n) or "" for n in ("chromium", "chromium-browser", "google-chrome")]
    cands += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    return next((c for c in cands if c and os.path.exists(c)), None)


def browser_agrees(path, chrome):
    size = 256
    with tempfile.TemporaryDirectory() as tmp:
        svg = os.path.join(tmp, "i.svg")
        open(svg, "wb").write(svg_bytes(path))
        html = os.path.join(tmp, "i.html")
        open(html, "w").write(f'<html><body style="margin:0;background:rgb{DARK}">'
                              f'<img src="i.svg" width="{size}" height="{size}" style="display:block"></body></html>')
        out = os.path.join(tmp, "b.png")
        try:
            subprocess.run([chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                            "--force-device-scale-factor=1", f"--window-size={size * 2},{size * 2}",
                            f"--screenshot={out}", "file://" + html],
                           capture_output=True, timeout=60)
            b = Image.open(out).convert("RGB").crop((0, 0, size, size))
        except Exception as e:  # noqa: BLE001 - any browser trouble just skips this check
            warn(f"browser check skipped ({e.__class__.__name__})")
            return None
    c = on(DARK, render(path, size)).convert("RGB")
    diff = ImageChops.difference(b, c).convert("L")
    bad = sum(1 for v in pixels(diff) if v > 40) / (size * size)
    if bad > 0.01:
        fail(f"browser and cairosvg disagree on {bad:.1%} of pixels: the shipped icon "
             "won't look like the browser preview (see the diff row)")
    else:
        info(f"browser and cairosvg agree ({bad:.2%} pixels differ)")
    return b, c, diff


def bounds(path, glyph):
    size = 16 * 16 if glyph else 1024
    im = render(path, size)
    box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if not box:
        fail("icon is empty")
        return
    if glyph:
        s = size / 16
        l, t, r, b = (v / s for v in box)
        info(f"glyph spans x {l:.1f}..{r:.1f}, y {t:.1f}..{b:.1f} of 16")
        if l < 0.9 or t < 0.9 or r > 15.1 or b > 15.1:
            warn("glyph touches the edge; Firefox's own icons keep about 1 unit of padding")
        return
    inset = min(box[0], box[1], size - box[2], size - box[3])
    if 96 <= inset <= 104:
        note = "matches Apple's macOS grid (100)"
    elif 60 <= inset <= 68:
        note = "matches Vanta's Linux tile (64)"
    elif inset < 24:
        note = "nearly full-bleed: fine for the 32px-and-below art, too big for the Dock"
    else:
        note = "neither Apple's grid (100) nor Vanta's tile (64)"
    info(f"tile inset {inset}px of 1024: {note}")


def legibility(path, glyph, smallest=16):
    ref = ink_map(path, 256, glyph)
    full = max(ref) or 1
    rows = []
    for size in (s for s in (48, 32, 24, 16) if s >= smallest):
        ink = ink_map(path, size, glyph)
        peak = max(ink) / full
        solid = sum(1 for v in ink if v >= 0.75 * full)
        rows.append((size, peak, solid))
        msg = f"{size}px: strongest pixel {peak:.0%} of full contrast, {solid} solid pixels"
        if size <= 24 and (peak < 0.6 or solid < 4):
            fail(msg + " -> the mark dissolves; thicken it (iconkit.min_stroke) or use small-size art")
        elif peak < 0.8 or solid < 6:
            warn(msg + " -> soft; consider thicker features at this size")
        else:
            info(msg)
    # Where the eye lands: centre of the ink.
    s = 256
    total = sum(ref) or 1
    cx = sum((i % s) * v for i, v in enumerate(ref)) / total / s - 0.5
    cy = sum((i // s) * v for i, v in enumerate(ref)) / total / s - 0.5
    info(f"visual weight sits {cx:+.0%} x, {cy:+.0%} y from centre")
    return rows


def distinct(paths, glyph):
    if len(paths) < 2:
        return
    ims = {p: on(DARK, render(p, 16)).convert("L") for p in paths}
    names = list(paths)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            d = ImageStat.Stat(ImageChops.difference(ims[names[i]], ims[names[j]])).mean[0]
            pair = f"{os.path.basename(names[i])} vs {os.path.basename(names[j])}"
            if d < 6:
                warn(f"{pair}: nearly identical at 16px (difference {d:.1f}); make the silhouettes differ")
            else:
                info(f"{pair}: tell apart at 16px (difference {d:.1f})")


# ---------- review sheet ----------

def sheet(paths, glyph, against, browser_rows, out):
    sizes = [64, 32, 24, 16] if glyph else [256, 128, 64, 48, 32, 24, 16]
    row_w = sum(sizes) + 24 * len(sizes) + 24
    zoom_w = (16 + 24 + 32) * 8 + 4 * 24
    W = max(row_w * 2 + 24, zoom_w + 300, 900)
    blocks = []

    def label(img, text, xy, fill=(160, 160, 170)):
        ImageDraw.Draw(img).text(xy, text, fill=fill)

    for p in paths:
        h = max(sizes) + 40
        block = Image.new("RGB", (W, h * 1 + 300), PANEL)
        label(block, display_name(p), (12, 6), (236, 236, 241))
        for k, (bg, ink) in enumerate(((DARK, "#ececf1"), (LIGHT, "#1d1d24"))):
            x0 = 12 + k * (row_w + 12)
            ImageDraw.Draw(block).rounded_rectangle((x0, 24, x0 + row_w, 24 + h), 10, fill=bg)
            x = x0 + 12
            for s in sizes:
                im = render(p, s, ink)
                block.paste(im, (x, 24 + 12 + max(sizes) - s), im)
                label(block, str(s), (x, 24 + h - 14), (110, 110, 120) if k == 0 else (90, 90, 100))
                x += s + 24
        x, y = 12, 24 + h + 16
        label(block, "real pixels, 8x", (x, y))
        y += 16
        for s in (16, 24, 32):
            im = on(DARK, render(p, s)).convert("RGB").resize((s * 8, s * 8), Image.NEAREST)
            block.paste(im, (x, y))
            x += s * 8 + 24
        # in context: Dock-like row and a tab row
        cx = x + 12
        d = ImageDraw.Draw(block)
        d.rounded_rectangle((cx, y, cx + 300, y + 84), 20, fill=(60, 60, 66))
        for i in range(5):
            if i == 2:
                im = on((60, 60, 66), render(p, 64)).convert("RGB")
                block.paste(im, (cx + 18 + i * 56, y + 10))
            else:
                d.rounded_rectangle((cx + 22 + i * 56, y + 18, cx + 70 + i * 56, y + 66), 11, fill=(40, 40, 46))
        ty = y + 100
        d.rounded_rectangle((cx, ty, cx + 300, ty + 34), 8, fill=(0, 0, 0))
        im = render(p, 16)
        block.paste(im, (cx + 10, ty + 9), im)
        label(block, "Vanta - new tab", (cx + 34, ty + 11), (236, 236, 241))
        blocks.append(block.crop((0, 0, W, max(y + 24 * 8 + 12, ty + 50))))

    if len(paths) > 1:
        fam = Image.new("RGB", (W, 120), PANEL)
        label(fam, "the set at 32px and 16px", (12, 6))
        x = 12
        for p in paths:
            for s in (32, 16):
                im = render(p, s)
                fam.paste(im, (x, 30 + 32 - s), im)
                x += s + 12
            x += 24
        blocks.append(fam)

    if against:
        cmp = Image.new("RGB", (W, 300), PANEL)
        label(cmp, f"{display_name(paths[0])} | {display_name(against)} | difference", (12, 6))
        a, b = on(DARK, render(paths[0], 256)).convert("RGB"), on(DARK, render(against, 256)).convert("RGB")
        cmp.paste(a, (12, 30)); cmp.paste(b, (280, 30))
        cmp.paste(ImageChops.difference(a, b).point(lambda v: min(255, v * 3)), (548, 30))
        blocks.append(cmp)

    for name, rows in browser_rows:
        if not rows:
            continue
        b, c, diff = rows
        br = Image.new("RGB", (W, 300), PANEL)
        label(br, f"{name}: browser | cairosvg (build) | difference", (12, 6))
        br.paste(b, (12, 30)); br.paste(c, (280, 30)); br.paste(diff.point(lambda v: min(255, v * 3)).convert("RGB"), (548, 30))
        blocks.append(br)

    out_im = Image.new("RGB", (W, sum(b.height for b in blocks)), PANEL)
    y = 0
    for b in blocks:
        out_im.paste(b, (0, y)); y += b.height
    out_im.save(out)
    print(f"\nreview sheet: {out}  (Read it before calling the icon done)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("icons", nargs="+")
    ap.add_argument("--glyph", action="store_true", help="16-unit toolbar glyphs (context-fill)")
    ap.add_argument("--against", help="reference SVG to compare the first icon with")
    ap.add_argument("--out", default="icon-review.png")
    ap.add_argument("--smallest", type=int, default=16,
                    help="smallest size this art ships at (e.g. 48 for art the build swaps out below that)")
    ap.add_argument("--variants", action="store_true",
                    help="the icons are alternatives for one slot, so skip the set-distinctness check")
    ap.add_argument("--no-browser", action="store_true", help="skip the browser-vs-cairosvg check")
    args = ap.parse_args()

    chrome = None if args.no_browser else find_chrome()
    browser_rows = []
    for p in args.icons:
        print(f"\n{p}")
        lint(p, args.glyph)
        bounds(p, args.glyph)
        legibility(p, args.glyph, args.smallest)
        if chrome and not args.glyph:
            browser_rows.append((os.path.basename(p), browser_agrees(p, chrome)))
    if not chrome and not args.no_browser:
        print("\n  warn no Chromium found; browser-vs-build check skipped (set VANTA_CHROME)")
    if len(args.icons) > 1 and not args.variants:
        print("\nset")
        distinct(args.icons, args.glyph)
    sheet(args.icons, args.glyph, args.against, browser_rows, args.out)
    if problems:
        print(f"\n{len(problems)} check(s) failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
