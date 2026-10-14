#!/usr/bin/env python3
"""Render Vanta's logo (branding/logo.svg) into the icon files Firefox's
branding directory expects, written to branding/vanta/.

A dev-time tool: run it after changing the logo and commit the output.
The build itself only copies the files (see scripts/apply-vanta.sh).
Needs: pip install cairosvg pillow
"""
import io
import os

import cairosvg
from PIL import Image

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
svg = open(os.path.join(here, "branding", "logo.svg"), "rb").read()
out = os.path.join(here, "branding", "vanta")
os.makedirs(os.path.join(out, "content"), exist_ok=True)


def render(size):
    png = cairosvg.svg2png(bytestring=svg, output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


# Window and taskbar icons (Linux), and the chrome://branding icons.
for size in (16, 22, 24, 32, 48, 64, 128, 256):
    render(size).save(os.path.join(out, f"default{size}.png"))

# About dialog logo.
render(192).save(os.path.join(out, "content", "about-logo.png"))
render(384).save(os.path.join(out, "content", "about-logo@2x.png"))
with open(os.path.join(out, "content", "about-logo.svg"), "wb") as f:
    f.write(svg)

# macOS app and document icons.
big = render(1024)
for name in ("firefox.icns", "document.icns"):
    big.save(os.path.join(out, name), sizes=[(16, 16), (32, 32), (128, 128), (256, 256), (512, 512), (1024, 1024)])

# Windows icons, kept in sync so the branding directory stays complete.
render(256).save(os.path.join(out, "firefox.ico"), sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
render(64).save(os.path.join(out, "firefox64.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

print("wrote", out)
