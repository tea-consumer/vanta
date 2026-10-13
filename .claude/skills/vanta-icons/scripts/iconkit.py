"""Vanta icon geometry: build icon SVGs from code instead of hand-typed paths.

Import it from a throwaway script:

    import sys; sys.path.insert(0, ".claude/skills/vanta-icons/scripts")
    from iconkit import *
    svg = icon(tile(), eclipse(512, 512, 300, 278, shift=37))
    open("branding/src/new.svg", "w").write(svg)

Everything here emits plain shapes and paths: no masks, filters, text or
clip paths, because scripts/make-branding.py renders with cairosvg, which
ignores masks and draws filters and text differently from the browser.
"""
import math

# Vanta's palette (branding/logo.svg, chrome/vanta.css).
VOID = "#000000"   # tile, the void
RIM = "#ececf1"    # the eclipse's light
EDGE = "#2a2a2e"   # tile edge, separates black tile from dark docks
DIM = "#9a9aa2"    # quiet details (private browsing corona ring)
PAGE = "#0c0c0e"   # raised dark surfaces
ICE, SAGE, EMBER = "#9ec4ff", "#a8c69a", "#f4b183"   # user accents, never the default
CONTEXT = "context-fill"   # glyphs: Firefox paints them in the toolbar text colour

# Grids. App icons are 1024 units; glyphs 16.
APP = 1024
GLYPH = 16
APPLE_BODY = (100, 824, 185)   # inset, size, corner radius of Apple's macOS icon body
VANTA_BODY = (64, 896, 200)    # Vanta's own tile (logo.svg), used on Linux


def f(v):
    """Short number formatting for SVG."""
    v = round(v, 3)
    return str(int(v)) if v == int(v) else str(v)


def icon(*parts, size=APP, glyph=False, comment=None):
    head = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}"'
    if glyph:
        head += ' fill="context-fill" fill-opacity="context-fill-opacity"'
    body = "\n".join("  " + p for p in parts if p)
    note = f"  <!-- {comment} -->\n" if comment else ""
    return f"{head}>\n{note}{body}\n</svg>\n"


def tile(inset=64, radius=200, fill=VOID, edge=EDGE, edge_width=2, size=APP):
    """Rounded-square app tile with an inner edge line (drawn inside the tile)."""
    w = size - 2 * inset
    out = f'<rect x="{f(inset)}" y="{f(inset)}" width="{f(w)}" height="{f(w)}" rx="{f(radius)}" fill="{fill}"/>'
    if edge and edge_width:
        h = edge_width / 2
        out += (f'\n  <rect x="{f(inset + h)}" y="{f(inset + h)}" width="{f(w - edge_width)}" '
                f'height="{f(w - edge_width)}" rx="{f(max(0, radius - h))}" fill="none" '
                f'stroke="{edge}" stroke-width="{f(edge_width)}"/>')
    return out


def circle_path(cx, cy, r):
    return (f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0"
            f"a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0Z")


def crescent_path(cx, cy, r, sx, sy, sr):
    """Disc (cx,cy,r) minus shadow disc (sx,sy,sr), as one path (evenodd)."""
    d = math.hypot(sx - cx, sy - cy)
    if d >= r + sr or sr <= 0:
        return circle_path(cx, cy, r)
    if d + r <= sr:
        return ""
    if d + sr <= r:
        return circle_path(cx, cy, r) + circle_path(sx, sy, sr)
    ux, uy = (sx - cx) / d, (sy - cy) / d
    a = (d * d + r * r - sr * sr) / (2 * d)
    h = math.sqrt(max(0.0, r * r - a * a))
    p1 = (cx + a * ux - h * uy, cy + a * uy + h * ux)
    p2 = (cx + a * ux + h * uy, cy + a * uy - h * ux)

    def arc(c, q, s, m, e):
        ang = lambda p: math.atan2(p[1] - c[1], p[0] - c[0])
        fwd = lambda x: (x - ang(s)) % (2 * math.pi)
        sweep = 1 if fwd(ang(m)) < fwd(ang(e)) else 0
        span = fwd(ang(e)) if sweep else 2 * math.pi - fwd(ang(e))
        return f"A{f(q)} {f(q)} 0 {1 if span > math.pi else 0} {sweep} {f(e[0])} {f(e[1])}"

    return (f"M{f(p1[0])} {f(p1[1])}"
            + arc((cx, cy), r, p1, (cx - r * ux, cy - r * uy), p2)
            + arc((sx, sy), sr, p2, (sx - sr * ux, sy - sr * uy), p1) + "Z")


def eclipse(cx, cy, r, shadow_r, shift, angle=45, fill=RIM):
    """The Vanta mark: a lit disc with a shadow disc pushed `shift` units toward
    `angle` degrees (45 = down-right, so the light sits top-left).
    Rim at its thickest = shift + (r - shadow_r)."""
    a = math.radians(angle)
    d = crescent_path(cx, cy, r, cx + math.cos(a) * shift, cy + math.sin(a) * shift, shadow_r)
    return f'<path d="{d}" fill="{fill}" fill-rule="evenodd"/>'


def disc(cx, cy, r, fill=RIM, opacity=1):
    op = f' opacity="{f(opacity)}"' if opacity < 1 else ""
    return f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="{fill}"{op}/>'


def ring(cx, cy, r, width, fill=RIM, opacity=1):
    """A ring as a filled path (renders the same everywhere, unlike some strokes)."""
    op = f' opacity="{f(opacity)}"' if opacity < 1 else ""
    d = circle_path(cx, cy, r + width / 2) + circle_path(cx, cy, r - width / 2)
    return f'<path d="{d}" fill="{fill}" fill-rule="evenodd"{op}/>'


def arc(cx, cy, r, width, start, sweep, fill=RIM):
    """An open stroked arc with round caps; angles in degrees, 0 = right, clockwise."""
    a0, a1 = math.radians(start), math.radians(start + sweep)
    p = lambda a: f"{f(cx + math.cos(a) * r)} {f(cy + math.sin(a) * r)}"
    return (f'<path d="M{p(a0)}A{f(r)} {f(r)} 0 {1 if sweep > 180 else 0} 1 {p(a1)}" '
            f'fill="none" stroke="{fill}" stroke-width="{f(width)}" stroke-linecap="round"/>')


def corona(cx, cy, r, spread=0.34, fill=RIM, opacity=0.22, id="corona"):
    """A soft radial glow. The only gradient Vanta uses; keep it faint."""
    return (f'<defs><radialGradient id="{id}" cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="{f(1 - spread)}" stop-color="{fill}" stop-opacity="{f(opacity)}"/>'
            f'<stop offset="1" stop-color="{fill}" stop-opacity="0"/></radialGradient></defs>'
            f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="url(#{id})"/>')


def rounded_rect(x, y, w, h, radius, fill=RIM, opacity=1):
    op = f' opacity="{f(opacity)}"' if opacity < 1 else ""
    return f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" rx="{f(radius)}" fill="{fill}"{op}/>'


def line(x1, y1, x2, y2, width, fill=RIM):
    return (f'<line x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}" stroke="{fill}" '
            f'stroke-width="{f(width)}" stroke-linecap="round"/>')


def min_stroke(size, px=1.5, canvas=APP):
    """Units a feature must span to be `px` pixels wide when shown at `size` px."""
    return px * canvas / size
