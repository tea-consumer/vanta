"""The measuring half of the Vanta icon toolkit (imported by icon_check,
explore and audit). Every check returns findings instead of printing, so
the three tools can rank, summarise or fail on them.

Needs cairosvg and pillow. Chromium is optional (browser-vs-build check).
"""
import functools
import glob
import io
import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image, ImageChops, ImageFilter, ImageStat

DARK, LIGHT, PANEL, BLACK = (28, 28, 31), (230, 230, 235), (12, 12, 14), (0, 0, 0)
INK_DARK, INK_LIGHT = "#ececf1", "#1d1d24"     # what context-fill shows as on dark / light toolbars
PALETTE = {"#000", "#000000", "#ececf1", "#2a2a2e", "#9a9aa2", "#0c0c0e", "#1c1c20", "#3a3a40",
           "#9ec4ff", "#a8c69a", "#f4b183", "#fff", "#ffffff", "context-fill", "none"}
FORBIDDEN = {"mask": "cairosvg ignores masks; the build would draw the masked shape whole",
             "filter": "filters render differently in cairosvg and cost GPU in Firefox chrome",
             "text": "text depends on installed fonts; convert it to paths",
             "image": "embedded bitmaps don't scale; draw it as shapes",
             "foreignObject": "not rendered by cairosvg"}
FAIL, WARN, OK = "FAIL", "warn", "ok"
PENALTY = {FAIL: 25, WARN: 5, OK: 0}


class Report:
    """Findings and numbers for one icon."""

    def __init__(self, path, glyph, smallest=16):
        self.path, self.glyph, self.smallest = path, glyph, smallest
        self.findings = []      # (level, check, message)
        self.metrics = {}

    def add(self, level, check, msg):
        self.findings.append((level, check, msg))

    @property
    def failed(self):
        return any(level == FAIL for level, _, _ in self.findings)

    @property
    def score(self):
        """0-100. Penalties for problems, plus credit for staying solid when small."""
        s = 100 - sum(PENALTY[level] for level, _, _ in self.findings)
        leg = self.metrics.get("legibility", {})
        small = leg.get(str(self.smallest)) or leg.get("16")
        if small:
            s -= max(0, 30 * (1 - min(1, small["solid"] / 20)))
        crisp = self.metrics.get("crispness", {}).get("16")
        if crisp is not None:
            s -= 10 * crisp
        return max(0, round(s))

    @property
    def rank_key(self):
        """Sort key, best first: score, then solid pixels at the smallest size."""
        leg = self.metrics.get("legibility", {}).get(str(self.smallest), {})
        return (-self.score, -leg.get("solid", 0))

    def as_dict(self):
        return {"path": self.path, "score": self.score, "failed": self.failed,
                "findings": [{"level": l, "check": c, "message": m} for l, c, m in self.findings],
                "metrics": self.metrics}


# ---------- rendering ----------

def display_name(path):
    rel = os.path.relpath(path)
    return os.path.basename(path) if rel.startswith("..") else rel


def _text(path):
    with open(path) as fh:
        return fh.read()


def svg_bytes(path, ink=INK_DARK, shift=(0, 0)):
    text = _text(path)
    # context-fill only means something inside Firefox; preview it as a solid colour.
    text = text.replace("context-fill-opacity", "1").replace("context-fill", ink)
    if shift != (0, 0):
        text = re.sub(r"(<svg[^>]*>)", rf'\1<g transform="translate({shift[0]} {shift[1]})">', text, count=1)
        text = text.replace("</svg>", "</g></svg>")
    return text.encode()


@functools.lru_cache(maxsize=512)
def _render(path, mtime, size, ink, shift):
    png = cairosvg.svg2png(bytestring=svg_bytes(path, ink, shift), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def render(path, size, ink=INK_DARK, shift=(0, 0)):
    """RGBA render, cached per file version, size, ink colour and offset."""
    return _render(path, os.path.getmtime(path), size, ink, tuple(shift)).copy()


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


def rel_lum(rgb):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb[:3]
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a, b):
    la, lb = sorted((rel_lum(a), rel_lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def ink_image(path, size, glyph, shift=(0, 0)):
    """'L' image of how far each pixel stands out from what's behind the mark
    (the tile for app icons, transparency for glyphs). 255 = full contrast."""
    im = render(path, size, shift=shift)
    if glyph:
        return im.getchannel("A")
    base, top = _tile_and_full(r_key(path))
    alpha = pixels(im.getchannel("A"))
    lum = [luma(p) for p in pixels(on(DARK, im))]
    out = Image.new("L", im.size)
    out.putdata([min(255, int(abs(l - base) * a / 255 * 255 / top)) for l, a in zip(lum, alpha)])
    return out


def r_key(path):
    return path, os.path.getmtime(path)


@functools.lru_cache(maxsize=128)
def _tile_and_full(key):
    """Tile colour and the mark's full contrast against it, measured at 256px."""
    im = render(key[0], 256)
    alpha = pixels(im.getchannel("A"))
    lum = [luma(p) for p in pixels(on(DARK, im))]
    solid = sorted(l for l, a in zip(lum, alpha) if a > 250)
    base = solid[len(solid) // 2] if solid else luma(DARK)
    top = max(abs(l - base) * a / 255 for l, a in zip(lum, alpha)) or 1
    return base, top


# ---------- checks ----------

def check_lint(r):
    text = _text(r.path)
    try:
        ET.fromstring(text)
    except ET.ParseError as e:
        r.add(FAIL, "lint", f"not valid XML: {e}")
        return
    for tag, why in FORBIDDEN.items():
        if re.search(rf"<{tag}[\s>/]", text):
            r.add(FAIL, "lint", f"<{tag}>: {why}")
    if "clipPath" in text:
        r.add(WARN, "lint", "clipPath: prefer computing the shape (iconkit.crescent_path)")
    colors = {c.lower() for c in re.findall(r'(?:fill|stroke|stop-color)="([^"u][^"]*)"', text)}
    odd = sorted(c for c in colors if c not in PALETTE)
    if odd:
        r.add(WARN, "lint", "colours outside Vanta's palette: " + ", ".join(odd))
    if r.glyph:
        if "context-fill" not in text:
            r.add(FAIL, "lint", "glyph has no context-fill, so it won't follow the toolbar colour in dark and light")
        hard = [c for c in colors if c not in ("context-fill", "none")]
        if hard:
            r.add(WARN, "lint", "glyph uses fixed colours " + ", ".join(hard) + "; they won't adapt to light mode")
    m = re.search(r'viewBox="0 0 (\S+) (\S+)"', text)
    if not m:
        r.add(FAIL, "lint", "no viewBox")
    elif r.glyph and m.group(1) != "16":
        r.add(WARN, "lint", f"glyph viewBox is {m.group(1)} wide; Firefox toolbar icons are drawn on 16")
    body = re.sub(r"<metadata.*?</metadata>", "", text, flags=re.S)
    long_nums = len(re.findall(r"\d\.\d{4,}", body))
    size = len(body.encode())
    r.metrics["bytes"] = size
    if long_nums:
        r.add(WARN, "lint", f"{long_nums} numbers with 4+ decimals; round them (iconkit.f does)")
    if size > (4000 if r.glyph else 20000):
        r.add(WARN, "lint", f"{size} bytes is heavy for an icon; simplify the paths")


def check_bounds(r):
    size = 256 if r.glyph else 1024
    im = render(r.path, size)
    box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if not box:
        r.add(FAIL, "bounds", "icon is empty")
        return
    if r.glyph:
        s = size / 16
        l, t, rr, b = (v / s for v in box)
        r.metrics["bounds"] = [round(v, 2) for v in (l, t, rr, b)]
        if l < 0.9 or t < 0.9 or rr > 15.1 or b > 15.1:
            r.add(WARN, "bounds", "glyph touches the edge; keep about 1 unit of padding like Firefox's own icons")
        else:
            r.add(OK, "bounds", f"glyph spans x {l:.1f}..{rr:.1f}, y {t:.1f}..{b:.1f} of 16")
        return
    bw, bh = box[2] - box[0], box[3] - box[1]
    if abs(bw - bh) > 0.08 * max(bw, bh):
        r.add(OK, "bounds", f"not a square tile (spans {bw}x{bh} of 1024); grid check skipped")
        return
    inset = min(box[0], box[1], size - box[2], size - box[3])
    r.metrics["inset"] = inset
    if 96 <= inset <= 104:
        note = "matches Apple's macOS grid (100)"
    elif 60 <= inset <= 68:
        note = "matches Vanta's Linux tile (64)"
    elif inset < 32:
        note = "near full-bleed: right for 32px-and-below art, too big for the Dock"
    else:
        note = "neither Apple's grid (100) nor Vanta's tile (64)"
    r.add(OK if "matches" in note or "full-bleed" in note else WARN, "bounds", f"tile inset {inset}/1024: {note}")


def check_legibility(r):
    out = {}
    for size in (s for s in (48, 32, 24, 16) if s >= r.smallest):
        ink = pixels(ink_image(r.path, size, r.glyph))
        peak = max(ink) / 255
        solid = sum(1 for v in ink if v >= 0.75 * 255)
        out[str(size)] = {"peak": round(peak, 2), "solid": solid}
        msg = f"{size}px: strongest pixel {peak:.0%}, {solid} solid pixels"
        if size <= 24 and (peak < 0.6 or solid < 4):
            r.add(FAIL, "legibility", msg + "; the mark dissolves: thicken it or use small-size art")
        elif peak < 0.8 or solid < 6:
            r.add(WARN, "legibility", msg + "; soft at this size")
        else:
            r.add(OK, "legibility", msg)
    r.metrics["legibility"] = out
    # Where the eye lands: centre of the ink.
    ink = ink_image(r.path, 256, r.glyph)
    vals = pixels(ink)
    total = sum(vals) or 1
    cx = sum((i % 256) * v for i, v in enumerate(vals)) / total / 256 - 0.5
    cy = sum((i // 256) * v for i, v in enumerate(vals)) / total / 256 - 0.5
    r.metrics["weight_centre"] = [round(cx, 3), round(cy, 3)]
    r.add(OK, "balance", f"visual weight sits {cx:+.0%} x, {cy:+.0%} y from centre")


def blur_ratio(ink):
    """Share of the mark's pixels that are half-tone (antialiased) rather than solid."""
    v = [p for p in pixels(ink) if p > 25]
    return sum(1 for p in v if 64 <= p <= 192) / len(v) if v else 0


def check_crispness(r):
    """How much of the mark lands on whole pixels. Glyphs should be crisp;
    for app art it's information. Also tries half-pixel nudges for glyphs."""
    res = {}
    for size in (16, 32):
        if size < r.smallest:
            continue
        res[str(size)] = round(blur_ratio(ink_image(r.path, size, r.glyph)), 2)
    r.metrics["crispness"] = res
    if not res:
        return
    if r.glyph and "16" in res:
        base = res["16"]
        best = min(((dx, dy) for dx in (0, 0.25, 0.5, -0.25) for dy in (0, 0.25, 0.5, -0.25)),
                   key=lambda s: blur_ratio(ink_image(r.path, 16, True, shift=s)))
        best_val = blur_ratio(ink_image(r.path, 16, True, shift=best))
        r.metrics["best_nudge"] = list(best)
        if best != (0, 0) and best_val < base - 0.1:
            r.add(WARN, "crispness", f"16px is {base:.0%} half-tone; moving the glyph by {best} units "
                                     f"drops that to {best_val:.0%} (put straight edges on pixel lines)")
        elif base > 0.55:
            r.add(WARN, "crispness", f"16px is {base:.0%} half-tone; curves and diagonals blur, keep them few")
        else:
            r.add(OK, "crispness", f"16px is {base:.0%} half-tone")
    else:
        r.add(OK, "crispness", ", ".join(f"{k}px {v:.0%} half-tone" for k, v in res.items()))


def check_contrast(r):
    if r.glyph:
        im = render(r.path, 64)
        peak = max(pixels(im.getchannel("A"))) / 255
        for name, bg, ink in (("dark", (20, 20, 24), (236, 236, 241)), ("light", (249, 249, 251), (29, 29, 36))):
            mix = tuple(round(bg[i] + (ink[i] - bg[i]) * peak) for i in range(3))
            c = contrast(mix, bg)
            lvl = OK if c >= 4.5 else WARN if c >= 3 else FAIL
            r.add(lvl, "contrast", f"{name} toolbar: {c:.1f}:1 (aim for 4.5:1, icons need 3:1)")
        return
    im = render(r.path, 256)
    px, alpha = pixels(im), pixels(im.getchannel("A"))
    solid = [p for p, a in zip(px, alpha) if a > 250]
    if not solid:
        return
    tile = sorted(solid, key=luma)[len(solid) // 2]
    mark = max(solid, key=lambda p: abs(luma(p) - luma(tile)))
    c = contrast(mark, tile)
    r.metrics["mark_contrast"] = round(c, 1)
    r.add(OK if c >= 4.5 else WARN, "contrast", f"mark against tile {c:.1f}:1")
    # Does the tile still read as a shape on common backgrounds?
    seen = {}
    for name, bg in (("dark dock", DARK), ("black panel", BLACK), ("light desktop", LIGHT)):
        seen[name] = round(contrast(tile, bg), 2)
    r.metrics["tile_vs_background"] = seen
    if seen["black panel"] < 1.1:
        r.add(OK, "contrast", "on pure black the tile vanishes and only the mark shows (expected for Vanta's black tile)")


def stroke_weight(path, glyph, size=256):
    """Typical stroke thickness of the mark, in canvas units (1024 or 16)."""
    m = ink_image(path, size, glyph).point(lambda v: 255 if v >= 128 else 0)
    total = sum(1 for v in pixels(m) if v)
    if not total:
        return 0
    k = 0
    while True:
        m = m.filter(ImageFilter.MinFilter(3))
        k += 1
        left = sum(1 for v in pixels(m) if v)
        if left <= total * 0.5 or k > size // 2:
            break
    # Each 3x3 erosion eats a pixel from both sides, so a stroke w pixels wide
    # loses half its area after about w/4 rounds.
    px = 4 * k
    return round(px / size * (16 if glyph else 1024), 2)


def check_weight(r):
    w = stroke_weight(r.path, r.glyph)
    r.metrics["stroke"] = w
    canvas = 16 if r.glyph else 1024
    at = r.smallest
    r.add(OK, "weight", f"typical stroke {w} units, {w * at / canvas:.1f}px at {at}px")


def find_chrome():
    cands = [os.environ.get("VANTA_CHROME", "")]
    cands += sorted(glob.glob("/opt/pw-browsers/chromium*/chrome-linux/chrome"))
    cands += sorted(glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium*/chrome-linux/chrome")))
    cands += [shutil.which(n) or "" for n in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable")]
    cands += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    return next((c for c in cands if c and os.path.exists(c)), None)


def check_browser(r, chrome, size=256):
    """Chromium vs cairosvg, so what we preview is what the build ships."""
    with tempfile.TemporaryDirectory() as tmp:
        open(os.path.join(tmp, "i.svg"), "wb").write(svg_bytes(r.path))
        html = os.path.join(tmp, "i.html")
        open(html, "w").write(f'<html><body style="margin:0;background:rgb{DARK}">'
                              f'<img src="i.svg" width="{size}" height="{size}" style="display:block"></body></html>')
        out = os.path.join(tmp, "b.png")
        try:
            subprocess.run([chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                            "--force-device-scale-factor=1", f"--window-size={size * 2},{size * 2}",
                            f"--screenshot={out}", "file://" + html], capture_output=True, timeout=60)
            b = Image.open(out).convert("RGB").crop((0, 0, size, size))
        except Exception as e:  # noqa: BLE001 - any browser trouble only skips this check
            r.add(WARN, "browser", f"browser check skipped ({e.__class__.__name__})")
            return None
    c = on(DARK, render(r.path, size)).convert("RGB")
    diff = ImageChops.difference(b, c).convert("L")
    bad = sum(1 for v in pixels(diff) if v > 40) / (size * size)
    r.metrics["browser_diff"] = round(bad, 4)
    if bad > 0.01:
        r.add(FAIL, "browser", f"browser and cairosvg disagree on {bad:.1%} of pixels; "
                               "the shipped icon won't match the preview")
    else:
        r.add(OK, "browser", f"browser and cairosvg agree ({bad:.2%} differ)")
    return b, c, diff


def check_icon(path, glyph=False, smallest=16, chrome=None):
    r = Report(path, glyph, smallest)
    check_lint(r)
    if r.failed and any(c == "lint" and "XML" in m for _, c, m in r.findings):
        return r, None
    check_bounds(r)
    check_legibility(r)
    check_crispness(r)
    check_contrast(r)
    check_weight(r)
    rows = check_browser(r, chrome) if chrome and not glyph else None
    return r, rows


def check_set(reports):
    """Family checks: tell siblings apart at 16px; glyph sets share a stroke weight."""
    out = []
    ims = {r.path: on(DARK, render(r.path, 16)).convert("L") for r in reports}
    for i in range(len(reports)):
        for j in range(i + 1, len(reports)):
            a, b = reports[i].path, reports[j].path
            d = ImageStat.Stat(ImageChops.difference(ims[a], ims[b])).mean[0]
            pair = f"{os.path.basename(a)} vs {os.path.basename(b)}"
            if d < 6:
                out.append((WARN, "set", f"{pair}: nearly identical at 16px ({d:.1f}); make the silhouettes differ"))
            else:
                out.append((OK, "set", f"{pair}: distinct at 16px ({d:.1f})"))
    glyphs = [r for r in reports if r.glyph and r.metrics.get("stroke")]
    if len(glyphs) > 1:
        ws = [r.metrics["stroke"] for r in glyphs]
        lo, hi = min(ws), max(ws)
        if hi / lo > 1.3:
            out.append((WARN, "set", f"stroke weights range {lo}-{hi} units; a toolbar set should share one weight"))
        else:
            out.append((OK, "set", f"stroke weights consistent ({lo}-{hi} units)"))
    return out
