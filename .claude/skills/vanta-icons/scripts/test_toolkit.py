#!/usr/bin/env python3
"""Tests for the icon toolkit itself: geometry is exact, checks catch what
they claim to. Run: python3 .claude/skills/vanta-icons/scripts/test_toolkit.py"""
import io
import os
import subprocess
import sys
import tempfile
import unittest

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import cairosvg  # noqa: E402
from PIL import Image, ImageChops, ImageDraw  # noqa: E402

import iconkit as k  # noqa: E402
import vcheck  # noqa: E402

N = 512   # raster size for geometry comparisons (canvas 1024 -> 0.5 scale)


def raster(svg):
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=N, output_height=N)
    return Image.open(io.BytesIO(png)).getchannel("A").point(lambda a: 255 if a > 127 else 0)


def reference(shapes):
    """Pillow drawing of (op, cx, cy, r) discs on 1024 canvas, op '+' or '-'."""
    im = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(im)
    s = N / 1024
    for op, cx, cy, r in shapes:
        d.ellipse(((cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s), fill=255 if op == "+" else 0)
    return im


def mismatch(a, b):
    diff = ImageChops.difference(a, b)
    return sum(1 for v in vcheck.pixels(diff) if v) / (N * N)


class Geometry(unittest.TestCase):
    def crescent_case(self, cx, cy, r, sx, sy, sr):
        svg = k.icon(f'<path d="{k.crescent_path(cx, cy, r, sx, sy, sr)}" fill="#fff" fill-rule="evenodd"/>')
        ref = reference([("+", cx, cy, r), ("-", sx, sy, sr)])
        self.assertLess(mismatch(raster(svg), ref), 0.004, (cx, cy, r, sx, sy, sr))

    def test_crescents(self):
        for case in [(512, 512, 300, 538, 538, 278),        # the logo
                     (512, 512, 340, 556, 556, 300),        # small art
                     (512, 512, 300, 700, 400, 250),        # odd angle, big bite
                     (512, 512, 300, 512, 512, 200),        # shadow inside: a ring
                     (512, 512, 200, 900, 900, 50),         # shadow misses
                     (400, 600, 250, 300, 500, 260)]:       # shadow up-left, larger than disc
            with self.subTest(case=case):
                self.crescent_case(*case)

    def test_fully_covered_is_empty(self):
        self.assertEqual(k.crescent_path(512, 512, 100, 512, 512, 200), "")

    def test_ring(self):
        svg = k.icon(k.ring(512, 512, 300, 40, fill="#fff"))
        ref = reference([("+", 512, 512, 320), ("-", 512, 512, 280)])
        self.assertLess(mismatch(raster(svg), ref), 0.004)

    def test_eclipse_rebuilds_logo(self):
        here_root = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
        logo = os.path.join(here_root, "branding", "logo.svg")
        if not os.path.exists(logo):
            self.skipTest("no branding/logo.svg")
        mine = k.icon(k.tile(inset=63.5, edge_width=0), k.eclipse(512, 512, 300, 278, shift=26 * 2 ** 0.5))
        png = cairosvg.svg2png(bytestring=mine.encode(), output_width=N, output_height=N)
        a = Image.open(io.BytesIO(png)).convert("L")
        b = Image.open(io.BytesIO(cairosvg.svg2png(url=logo, output_width=N, output_height=N))).convert("L")
        # Compare only the mark: the logo also has a tile.
        diff = ImageChops.difference(a.point(lambda v: 255 if v > 128 else 0),
                                     b.point(lambda v: 255 if v > 128 else 0))
        self.assertLess(sum(1 for v in vcheck.pixels(diff) if v) / (N * N), 0.003)

    def test_min_stroke(self):
        self.assertEqual(k.min_stroke(16), 96)
        self.assertEqual(k.min_stroke(16, canvas=k.GLYPH), 1.5)


class Checks(unittest.TestCase):
    def write(self, text):
        f = tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False)
        f.write(text)
        f.close()
        self.addCleanup(os.unlink, f.name)
        return f.name

    def levels(self, path, **kw):
        r, _ = vcheck.check_icon(path, **kw)
        return r

    def test_mask_fails(self):
        p = self.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><mask id="m">'
                       '<rect width="1024" height="1024" fill="#fff"/></mask>'
                       '<circle cx="512" cy="512" r="300" fill="#ececf1" mask="url(#m)"/></svg>')
        self.assertTrue(any(c == "lint" and "mask" in m for l, c, m in self.levels(p).findings if l == "FAIL"))

    def test_bad_xml_fails(self):
        p = self.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect></svg>')
        self.assertTrue(self.levels(p).failed)

    def test_hairline_fails_small(self):
        p = self.write(k.icon(k.tile(), k.ring(512, 512, 300, 6, fill=k.RIM)))
        self.assertTrue(any(c == "legibility" for l, c, m in self.levels(p).findings if l == "FAIL"))

    def test_bold_passes_small(self):
        p = self.write(k.icon(k.tile(inset=24, radius=208), k.ring(512, 512, 300, 120, fill=k.RIM)))
        self.assertFalse(self.levels(p).failed)

    def test_glyph_needs_context_fill(self):
        p = self.write(k.icon(k.ring(8, 8, 5, 1.5, fill="#ececf1"), size=k.GLYPH))
        self.assertTrue(self.levels(p, glyph=True).failed)

    def test_stroke_weight(self):
        p = self.write(k.icon(k.ring(8, 8, 5, 1.5, fill=k.CONTEXT), size=k.GLYPH, glyph=True))
        self.assertAlmostEqual(vcheck.stroke_weight(p, True), 1.5, delta=0.3)

    def test_nudge_suggested_for_blurry_glyph(self):
        # A 2-unit bar sitting on half pixels: 0.5 units of nudge makes it crisp.
        p = self.write(k.icon(k.rounded_rect(3.5, 7.5, 9, 2, 0, fill=k.CONTEXT), size=k.GLYPH, glyph=True))
        r = self.levels(p, glyph=True)
        self.assertTrue(any(c == "crispness" and "moving the glyph" in m for _, c, m in r.findings))

    def test_explore_ranks(self):
        builder = os.path.join(tempfile.mkdtemp(), "builder.py")
        with open(builder, "w") as fh:
            fh.write(f"import sys; sys.path.insert(0, {here!r})\nfrom iconkit import *\n"
                     "def build(width):\n    return icon(tile(), ring(512, 512, 300, width, fill=RIM))\n")
        self.addCleanup(os.unlink, builder)
        out = os.path.join(tempfile.mkdtemp(), "sweep.png")
        res = subprocess.run([sys.executable, os.path.join(here, "explore.py"), builder,
                              "--param", "width=8,120", "--out", out], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        first = [l for l in res.stdout.splitlines() if l.strip().startswith("#1 ")][0]
        self.assertIn("width=120", first)
        self.assertTrue(os.path.exists(out))


if __name__ == "__main__":
    unittest.main(verbosity=1)
