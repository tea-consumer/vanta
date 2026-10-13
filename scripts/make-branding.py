#!/usr/bin/env python3
"""Vanta's icon builder.

Renders the logo sources into every file Firefox's branding directory
reads on macOS and Linux, written to branding/vanta/ (which
scripts/apply-vanta.sh copies over Firefox's unofficial branding).

Sources:
  branding/logo.svg              the Eclipse, master art (Linux, about dialog)
  branding/src/small.svg         32px and below: thicker rim, visible edge
  branding/src/macos.svg         the Eclipse on Apple's app-icon grid
  branding/src/private.svg       private browsing: a total eclipse
  branding/src/document.svg      macOS document icon
  branding/src/wordmark.svg      the VANTA wordmark (about dialog, new tab)
  branding/src/dmg-background.svg  the .dmg install window
  branding/src/aboutDialog.css   about dialog colours (copied as is)

A dev-time tool: run it after changing any source and commit the output.
  python3 scripts/make-branding.py              # write branding/vanta/
  python3 scripts/make-branding.py --check      # fail if the output is stale
  python3 scripts/make-branding.py --preview out.png   # also a contact sheet
Needs cairosvg and pillow (pip install cairosvg pillow, or on NixOS
nix-shell -p 'python3.withPackages (p: [p.cairosvg p.pillow])').
"""
import argparse
import filecmp
import io
import os
import shutil
import sys
import tempfile

import cairosvg
from PIL import Image, ImageChops, ImageDraw

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
branding = os.path.join(here, "branding")
src = os.path.join(branding, "src")

LOGO = os.path.join(branding, "logo.svg")
SMALL = os.path.join(src, "small.svg")
MACOS = os.path.join(src, "macos.svg")
PRIVATE = os.path.join(src, "private.svg")
DOCUMENT = os.path.join(src, "document.svg")
WORDMARK = os.path.join(src, "wordmark.svg")
DMG = os.path.join(src, "dmg-background.svg")

# Above this size the master art reads fine; at and below it the rim
# would be under a pixel wide, so the small variant takes over.
SMALL_MAX = 32
ICNS_SIZES = [(s, s) for s in (16, 32, 64, 128, 256, 512, 1024)]


def render(svg, width, height=None):
    png = cairosvg.svg2png(url=svg, output_width=width, output_height=height or width)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def app_icon(size):
    return render(SMALL if size <= SMALL_MAX else LOGO, size)


def colored(svg, color):
    """Inline a context-fill SVG with a fixed colour (for raster previews)."""
    text = open(svg).read().replace("context-fill", color)
    return text.encode()


def build(out):
    content = os.path.join(out, "content")
    os.makedirs(content, exist_ok=True)

    # Linux window/taskbar icons; Firefox also serves these as
    # chrome://branding/content/icon{16,32,48,64,128}.png.
    for size in (16, 22, 24, 32, 48, 64, 128, 256):
        app_icon(size).save(os.path.join(out, f"default{size}.png"))

    # About dialog.
    render(LOGO, 192).save(os.path.join(content, "about-logo.png"))
    render(LOGO, 384).save(os.path.join(content, "about-logo@2x.png"))
    shutil.copyfile(LOGO, os.path.join(content, "about-logo.svg"))
    render(PRIVATE, 192).save(os.path.join(content, "about-logo-private.png"))
    render(PRIVATE, 384).save(os.path.join(content, "about-logo-private@2x.png"))
    shutil.copyfile(os.path.join(src, "aboutDialog.css"), os.path.join(content, "aboutDialog.css"))
    about = Image.new("RGB", (300, 236), "#000")
    mark = render(LOGO, 160)
    about.paste(mark, (70, 38), mark)
    about.save(os.path.join(content, "about.png"))

    # Wordmarks: Firefox's unofficial branding ships "Nightly" here.
    shutil.copyfile(WORDMARK, os.path.join(content, "about-wordmark.svg"))
    text = open(WORDMARK).read().replace(
        'fill="context-fill"',
        'fill="context-fill light-dark(#000, #ececf1)"').replace(
        "<path", "<style>:root { color-scheme: light dark }</style>\n  <path", 1)
    with open(os.path.join(content, "firefox-wordmark.svg"), "w") as f:
        f.write(text)

    # macOS: app, document and disk image icons, and the .dmg window.
    big = render(MACOS, 1024)
    small = {s: render(SMALL, s) for s in (16, 32)}
    for name in ("firefox.icns", "disk.icns"):
        big.save(os.path.join(out, name), sizes=ICNS_SIZES, append_images=list(small.values()))
    render(DOCUMENT, 1024).save(os.path.join(out, "document.icns"), sizes=ICNS_SIZES)
    render(DMG, 1440, 880).save(os.path.join(out, "background.png"))

    # Windows icons, kept in sync so the branding directory stays complete.
    ico = [app_icon(s) for s in (16, 32, 48, 256)]
    ico[-1].save(os.path.join(out, "firefox.ico"), sizes=[i.size for i in ico], append_images=ico[:-1])
    ico64 = [app_icon(s) for s in (16, 32, 48, 64)]
    ico64[-1].save(os.path.join(out, "firefox64.ico"), sizes=[i.size for i in ico64], append_images=ico64[:-1])


def preview(path):
    """One image with every icon at the sizes people will see them."""
    sheet = Image.new("RGB", (1400, 660), "#1c1c1f")
    draw = ImageDraw.Draw(sheet)
    x = 30
    for size in (256, 128, 64, 48, 32, 24, 16):
        icon = app_icon(size)
        sheet.paste(icon, (x, 30 + (256 - size)), icon)
        x += size + 30
    x = 30
    for svg, size in ((MACOS, 256), (PRIVATE, 256), (DOCUMENT, 256)):
        icon = render(svg, size)
        sheet.paste(icon, (x, 316), icon)
        x += size + 30
    for size, y in ((16, 330), (32, 360)):
        icon = render(PRIVATE, size)
        sheet.paste(icon, (x, y), icon)
    word = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=colored(WORDMARK, "#ececf1"), output_height=44)))
    sheet.paste(word, (x + 60, 340), word)
    dmg = render(DMG, 360, 220)
    sheet.paste(dmg, (x + 60, 410), dmg)
    sheet.save(path)
    print("wrote", path)


def same(a, b):
    """Byte-equal, or for images, the same pixels within antialiasing noise:
    a different cairo or Pillow version (CI vs a laptop) re-encodes icons
    slightly differently without anything having changed."""
    if filecmp.cmp(a, b, shallow=False):
        return True
    if not a.endswith((".png", ".icns", ".ico")):
        return False
    try:
        ia, ib = Image.open(a), Image.open(b)
        if ia.size != ib.size:
            return False
        diff = ImageChops.difference(ia.convert("RGBA"), ib.convert("RGBA")).convert("L")
        hist = diff.histogram()
        changed = sum(hist[16:])
        return changed <= 0.005 * ia.size[0] * ia.size[1]
    except OSError:
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if branding/vanta/ is out of date")
    ap.add_argument("--preview", metavar="PNG", help="also write a contact sheet of every icon")
    args = ap.parse_args()
    out = os.path.join(branding, "vanta")

    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            build(tmp)
            stale = []
            for root, _, files in os.walk(tmp):
                for name in files:
                    rel = os.path.relpath(os.path.join(root, name), tmp)
                    mine = os.path.join(out, rel)
                    if not os.path.exists(mine) or not same(os.path.join(tmp, rel), mine):
                        stale.append(rel)
            if stale:
                sys.exit("stale icons, run scripts/make-branding.py: " + ", ".join(sorted(stale)))
        print("branding/vanta is up to date")
    else:
        build(out)
        print("wrote", out)
    if args.preview:
        preview(args.preview)


if __name__ == "__main__":
    main()
