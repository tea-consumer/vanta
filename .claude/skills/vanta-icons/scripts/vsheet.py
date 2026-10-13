"""Review sheets: images of icons as people will see them, for Claude to Read."""
import os

from PIL import Image, ImageChops, ImageDraw

from vcheck import DARK, INK_DARK, INK_LIGHT, LIGHT, PANEL, display_name, on, render

MUTED, TEXT = (150, 150, 160), (236, 236, 241)


def _label(img, text, xy, fill=MUTED):
    ImageDraw.Draw(img).text(xy, text, fill=fill)


def _stack(blocks, width):
    out = Image.new("RGB", (width, sum(b.height for b in blocks) or 1), PANEL)
    y = 0
    for b in blocks:
        out.paste(b, (0, y))
        y += b.height
    return out


def icon_block(path, glyph, width, title=None):
    """One icon: every size on dark and light, 8x real pixels, Dock and tab mockups."""
    sizes = [64, 32, 24, 16] if glyph else [256, 128, 64, 48, 32, 24, 16]
    row_w = sum(sizes) + 24 * len(sizes) + 24
    h = max(sizes) + 40
    block = Image.new("RGB", (width, h + 24 + 16 + 16 + 32 * 8 + 16), PANEL)
    _label(block, title or display_name(path), (12, 6), TEXT)
    d = ImageDraw.Draw(block)
    for k, (bg, ink) in enumerate(((DARK, INK_DARK), (LIGHT, INK_LIGHT))):
        x0 = 12 + k * (row_w + 12)
        d.rounded_rectangle((x0, 24, x0 + row_w, 24 + h), 10, fill=bg)
        x = x0 + 12
        for s in sizes:
            im = render(path, s, ink)
            block.paste(im, (x, 24 + 12 + max(sizes) - s), im)
            _label(block, str(s), (x, 24 + h - 14), (110, 110, 120) if k == 0 else (90, 90, 100))
            x += s + 24
    x, y = 12, 24 + h + 16
    _label(block, "real pixels, 8x", (x, y))
    y += 16
    for s in (16, 24, 32):
        im = on(DARK, render(path, s)).convert("RGB").resize((s * 8, s * 8), Image.NEAREST)
        block.paste(im, (x, y))
        x += s * 8 + 24
    cx = x + 12
    if glyph:
        for k, (bg, ink) in enumerate(((DARK, INK_DARK), (LIGHT, INK_LIGHT))):
            ty = y + k * 48
            d.rounded_rectangle((cx, ty, cx + 300, ty + 36), 8, fill=bg)
            for i, gx in enumerate((cx + 12, cx + 40, cx + 272)):
                im = render(path, 16, ink)
                block.paste(im, (gx, ty + 10), im)
            d.rounded_rectangle((cx + 68, ty + 8, cx + 260, ty + 28), 6, fill=tuple(int(c * 0.85) for c in bg))
    else:
        d.rounded_rectangle((cx, y, cx + 300, y + 84), 20, fill=(60, 60, 66))
        for i in range(5):
            if i == 2:
                block.paste(on((60, 60, 66), render(path, 64)).convert("RGB"), (cx + 18 + i * 56, y + 10))
            else:
                d.rounded_rectangle((cx + 22 + i * 56, y + 18, cx + 70 + i * 56, y + 66), 11, fill=(40, 40, 46))
        ty = y + 100
        d.rounded_rectangle((cx, ty, cx + 300, ty + 34), 8, fill=(0, 0, 0))
        im = render(path, 16)
        block.paste(im, (cx + 10, ty + 9), im)
        _label(block, "Vanta - new tab", (cx + 34, ty + 11), TEXT)
    return block


def set_block(paths, width):
    block = Image.new("RGB", (width, 100), PANEL)
    _label(block, "the set at 32px and 16px, on dark and light", (12, 6))
    for k, (bg, ink) in enumerate(((DARK, INK_DARK), (LIGHT, INK_LIGHT))):
        y = 26 + k * 36
        ImageDraw.Draw(block).rectangle((12, y - 2, width - 12, y + 34), fill=bg)
        x = 20
        for p in paths:
            for s in (32, 16):
                im = render(p, s, ink)
                block.paste(im, (x, y + 32 - s), im)
                x += s + 10
            x += 18
    return block


def compare_block(title, a, b, width):
    """Three 256px panes: a, b and their difference (amplified)."""
    block = Image.new("RGB", (width, 300), PANEL)
    _label(block, title, (12, 6))
    block.paste(a, (12, 30))
    block.paste(b, (280, 30))
    block.paste(ImageChops.difference(a.convert("RGB"), b.convert("RGB")).point(lambda v: min(255, v * 3)), (548, 30))
    return block


def review_sheet(reports, out, against=None, browser_rows=()):
    glyph = all(r.glyph for r in reports)
    width = 1544 if not glyph else 1000
    blocks = [icon_block(r.path, r.glyph, width, f"{display_name(r.path)}   score {r.score}") for r in reports]
    if len(reports) > 1:
        blocks.append(set_block([r.path for r in reports], width))
    if against:
        a = on(DARK, render(reports[0].path, 256)).convert("RGB")
        b = on(DARK, render(against, 256)).convert("RGB")
        blocks.append(compare_block(f"{display_name(reports[0].path)} | {display_name(against)} | difference", a, b, width))
    for name, rows in browser_rows:
        if rows:
            b, c, _ = rows
            blocks.append(compare_block(f"{name}: browser | cairosvg (build) | difference", b, c, width))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    _stack(blocks, width).save(out)
    return out


def variant_grid(items, out, glyph, cols=4):
    """Ranked variants side by side: name, score, 128/32/16 and 16px at 8x."""
    cell_w, cell_h = 380, 330
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cell_w * min(cols, len(items)) + 12, cell_h * rows + 12), PANEL)
    d = ImageDraw.Draw(sheet)
    for i, (label, report) in enumerate(items):
        x, y = 12 + (i % cols) * cell_w, 12 + (i // cols) * cell_h
        d.rounded_rectangle((x, y, x + cell_w - 12, y + cell_h - 12), 12, fill=DARK)
        flag = "  FAIL" if report.failed else ""
        _label(sheet, f"#{i + 1}  score {report.score}{flag}", (x + 10, y + 8), TEXT)
        _label(sheet, label, (x + 10, y + 22))
        big = render(report.path, 128)
        sheet.paste(big, (x + 10, y + 44), big)
        for s, (sx, sy) in ((32, (x + 150, y + 140)), (16, (x + 196, y + 156))):
            im = render(report.path, s)
            sheet.paste(im, (sx, sy), im)
        z = on(DARK, render(report.path, 16)).convert("RGB").resize((128, 128), Image.NEAREST)
        sheet.paste(z, (x + 230, y + 44))
        lt = render(report.path, 32, INK_LIGHT)
        bg = Image.new("RGBA", (48, 48), LIGHT + (255,))
        bg.alpha_composite(lt, (8, 8))
        sheet.paste(bg.convert("RGB"), (x + 10, y + 190))
        leg = report.metrics.get("legibility", {})
        small = leg.get(str(report.smallest), {})
        lines = [f"solid px at {report.smallest}: {small.get('solid', '-')}",
                 f"stroke: {report.metrics.get('stroke', '-')} units"]
        if report.metrics.get("crispness"):
            lines.append("half-tone: " + ", ".join(f"{k}px {v:.0%}" for k, v in report.metrics["crispness"].items()))
        for j, line in enumerate(lines):
            _label(sheet, line, (x + 70, y + 192 + j * 14))
        worst = [m for lvl, _, m in report.findings if lvl != "ok"][:2]
        for j, m in enumerate(worst):
            _label(sheet, m[:58], (x + 10, y + 250 + j * 14), (244, 177, 131))
    sheet.save(out)
    return out
