#!/usr/bin/env python3
"""Generate the bitmap fonts and UI frame art for Beast of Thornmoor.

Outputs (all deterministic):
  assets/fonts/{title,body,small}.{png,xml}   BMFont (XML) bitmap fonts
  assets/ui/*.png                              9-slice panel, bar frames, emblem, cursor,
                                               slots, vignette, controller/keyboard glyphs
  assets/ui/ui.json                            sizes and 9-slice insets of the UI art

Only Pillow and NumPy are required.  Run from anywhere:

  python3 tools/gen_font.py [--preview PATH]

--preview renders a sample string with every generated font, using ONLY the
atlas + XML metrics (a tiny BMFont renderer below), so the metrics can be
checked by eye.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, "assets", "fonts")
UI_DIR = os.path.join(ROOT, "assets", "ui")

DISPLAY_TTF = "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf"
BODY_TTF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS_TTF = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

CHARSET = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "0123456789"
    " !?.,:;'\"-()[]/+%&"
)

PAD = 2  # atlas padding around every glyph, in pixels


# --------------------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------------------
def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def rgba(h: str, a: int = 255) -> tuple[int, int, int, int]:
    return (*hex_rgb(h), a)


def lerp(a, b, t):
    return a + (b - a) * t


def next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p *= 2
    return p


# --------------------------------------------------------------------------------------
# Bitmap font generation
# --------------------------------------------------------------------------------------
@dataclass
class FontStyle:
    name: str
    ttf: str
    size: int
    outline: int
    outline_color: str
    fill_top: str
    fill_bottom: str
    shadow: tuple[int, int] = (0, 0)  # drop shadow offset (dx, dy); (0,0) = none
    shadow_alpha: float = 0.0


@dataclass
class Glyph:
    ch: str
    img: Image.Image  # RGBA glyph bitmap (may be 1x1 transparent for blanks)
    xoffset: int
    yoffset: int
    xadvance: int
    x: int = 0  # atlas position, filled by the packer
    y: int = 0


def render_glyph(ch: str, font: ImageFont.FreeTypeFont, st: FontStyle, base: int, cap_h: int) -> Glyph:
    """Render one glyph with outline/shadow/gradient and compute BMFont offsets.

    BMFont convention: the cursor sits at the TOP-LEFT of the line.  `xoffset`/`yoffset`
    move from the cursor to the top-left of the glyph bitmap, and `base` (in <common>) is
    the distance from the line top to the baseline.  PIL's "ls" anchor places the text's
    baseline-left at the drawing position, so `font.getbbox(ch, anchor="ls")` gives the
    ink box relative to the baseline origin, which maps directly onto those offsets.
    """
    o = st.outline
    sdx, sdy = st.shadow
    xadvance = int(round(font.getlength(ch)))

    x0, y0, x1, y1 = font.getbbox(ch, anchor="ls")
    if x1 <= x0 or y1 <= y0:  # blank glyph (space): 1x1 transparent so Phaser gets a frame
        return Glyph(ch, Image.new("RGBA", (1, 1), (0, 0, 0, 0)), 0, 0, xadvance)

    w = (x1 - x0) + 2 * o + max(sdx, 0)
    h = (y1 - y0) + 2 * o + max(sdy, 0)
    # Position so the un-stroked ink starts at (o, o) inside the bitmap.
    px, py = o - x0, o - y0

    fill_mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(fill_mask).text((px, py), ch, font=font, fill=255, anchor="ls")
    stroke_mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(stroke_mask).text(
        (px, py), ch, font=font, fill=255, anchor="ls", stroke_width=o, stroke_fill=255
    )

    xoffset = x0 - o
    yoffset = base + y0 - o

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # drop shadow
    if st.shadow_alpha > 0 and (sdx or sdy):
        sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        shifted = Image.new("L", (w, h), 0)
        shifted.paste(stroke_mask, (sdx, sdy))
        shifted = shifted.filter(ImageFilter.GaussianBlur(0.8))
        sh_alpha = (np.asarray(shifted, dtype=np.float32) * st.shadow_alpha).astype(np.uint8)
        sh.putalpha(Image.fromarray(sh_alpha, "L"))
        out = Image.alpha_composite(out, sh)

    # outline
    ol = Image.new("RGBA", (w, h), rgba(st.outline_color))
    ol.putalpha(stroke_mask)
    out = Image.alpha_composite(out, ol)

    # gradient fill, keyed to line space so every glyph shares the same ramp
    top = np.array(hex_rgb(st.fill_top), dtype=np.float32)
    bot = np.array(hex_rgb(st.fill_bottom), dtype=np.float32)
    rows = np.arange(h, dtype=np.float32) + yoffset  # line-space y of each bitmap row
    t = np.clip((rows - (base - cap_h)) / max(cap_h, 1), 0.0, 1.0)
    t = t[:, None, None]
    colour = (top[None, None, :] * (1 - t) + bot[None, None, :] * t)
    colour = np.repeat(colour, w, axis=1)
    fill = np.zeros((h, w, 4), dtype=np.uint8)
    fill[..., :3] = np.clip(colour, 0, 255).astype(np.uint8)
    fill[..., 3] = np.asarray(fill_mask)
    out = Image.alpha_composite(out, Image.fromarray(fill, "RGBA"))

    return Glyph(ch, out, xoffset, yoffset, xadvance)


def pack_glyphs(glyphs: list[Glyph]) -> tuple[int, int]:
    """Shelf-pack glyphs into the smallest power-of-two atlas; sets glyph.x/y."""
    order = sorted(range(len(glyphs)), key=lambda i: (-glyphs[i].img.height, -glyphs[i].img.width))
    best = None
    for W in (128, 256, 512, 1024, 2048):
        if any(g.img.width + 2 * PAD > W for g in glyphs):
            continue
        x = y = shelf = 0
        pos = {}
        for i in order:
            g = glyphs[i]
            gw, gh = g.img.width + 2 * PAD, g.img.height + 2 * PAD
            if x + gw > W:
                x, y, shelf = 0, y + shelf, 0
            pos[i] = (x + PAD, y + PAD)
            x += gw
            shelf = max(shelf, gh)
        H = next_pow2(y + shelf)
        area = W * H
        if best is None or area < best[0] or (area == best[0] and abs(W - H) < abs(best[1] - best[2])):
            best = (area, W, H, pos)
    assert best is not None
    _, W, H, pos = best
    for i, (gx, gy) in pos.items():
        glyphs[i].x, glyphs[i].y = gx, gy
    return W, H


def build_font(st: FontStyle) -> None:
    font = ImageFont.truetype(st.ttf, st.size)
    ascent, descent = font.getmetrics()
    o = st.outline
    sdy = max(st.shadow[1], 0)
    # Line box: ascent above the baseline, descent below, plus room for the outline/shadow.
    base = ascent + o
    line_h = ascent + descent + 2 * o + sdy
    cap_h = -font.getbbox("H", anchor="ls")[1]

    glyphs = [render_glyph(ch, font, st, base, cap_h) for ch in CHARSET]
    W, H = pack_glyphs(glyphs)

    atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for g in glyphs:
        atlas.paste(g.img, (g.x, g.y))
    atlas.save(os.path.join(FONT_DIR, f"{st.name}.png"), optimize=True)

    face = os.path.splitext(os.path.basename(st.ttf))[0]
    root = ET.Element("font")
    ET.SubElement(root, "info", {
        "face": face, "size": str(st.size), "bold": "1", "italic": "0", "charset": "",
        "unicode": "1", "stretchH": "100", "smooth": "1", "aa": "1",
        "padding": f"{o},{o},{o},{o}", "spacing": f"{PAD},{PAD}", "outline": str(o),
    })
    ET.SubElement(root, "common", {
        "lineHeight": str(line_h), "base": str(base), "scaleW": str(W), "scaleH": str(H),
        "pages": "1", "packed": "0", "alphaChnl": "0", "redChnl": "4", "greenChnl": "4", "blueChnl": "4",
    })
    pages = ET.SubElement(root, "pages")
    ET.SubElement(pages, "page", {"id": "0", "file": f"{st.name}.png"})
    chars = ET.SubElement(root, "chars", {"count": str(len(glyphs))})
    for g in sorted(glyphs, key=lambda g: ord(g.ch)):
        ET.SubElement(chars, "char", {
            "id": str(ord(g.ch)), "x": str(g.x), "y": str(g.y),
            "width": str(g.img.width), "height": str(g.img.height),
            "xoffset": str(g.xoffset), "yoffset": str(g.yoffset), "xadvance": str(g.xadvance),
            "page": "0", "chnl": "15",
        })
    ET.SubElement(root, "kernings", {"count": "0"})
    ET.indent(root, space="  ")
    xml = ET.tostring(root, encoding="unicode")
    with open(os.path.join(FONT_DIR, f"{st.name}.xml"), "w", encoding="utf-8") as fh:
        fh.write('<?xml version="1.0"?>\n' + xml + "\n")
    print(f"font {st.name}: {len(glyphs)} glyphs, atlas {W}x{H}, lineHeight {line_h}, base {base}")


FONT_STYLES = [
    FontStyle("title", DISPLAY_TTF, 64, 3, "#1a0c08", "#e8dcc0", "#9c7a3a", shadow=(3, 3), shadow_alpha=0.6),
    FontStyle("body", BODY_TTF, 24, 2, "#120a08", "#e0d6c0", "#e0d6c0"),
    FontStyle("small", BODY_TTF, 16, 1, "#120a08", "#ffffff", "#ffffff"),
]


# --------------------------------------------------------------------------------------
# Minimal BMFont renderer (verification only; uses nothing but the atlas + XML)
# --------------------------------------------------------------------------------------
def bmfont_render(name: str, text: str, guides: bool = True) -> Image.Image:
    tree = ET.parse(os.path.join(FONT_DIR, f"{name}.xml")).getroot()
    common = tree.find("common")
    page = tree.find("pages/page")
    atlas = Image.open(os.path.join(FONT_DIR, page.get("file"))).convert("RGBA")
    line_h, base = int(common.get("lineHeight")), int(common.get("base"))
    chars = {int(c.get("id")): {k: int(c.get(k)) for k in
             ("x", "y", "width", "height", "xoffset", "yoffset", "xadvance")}
             for c in tree.find("chars")}
    width = sum(chars[ord(c)]["xadvance"] for c in text if ord(c) in chars)
    img = Image.new("RGBA", (width + 16, line_h + 16), (28, 26, 36, 255))
    x, y = 8, 8
    for c in text:
        g = chars.get(ord(c))
        if g is None:
            continue
        tile = atlas.crop((g["x"], g["y"], g["x"] + g["width"], g["y"] + g["height"]))
        img.alpha_composite(tile, (x + g["xoffset"], y + g["yoffset"]))
        x += g["xadvance"]
    if guides:
        d = ImageDraw.Draw(img)
        d.line([(0, y), (img.width, y)], fill=(70, 110, 200, 255))              # line top
        d.line([(0, y + base), (img.width, y + base)], fill=(220, 60, 60, 255))  # baseline
        d.line([(0, y + line_h), (img.width, y + line_h)], fill=(70, 110, 200, 255))  # line bottom
    return img


def write_preview(path: str) -> None:
    sample = "Beast of Thornmoor: gold 1,250 / XP 97%"
    strips = [bmfont_render(st.name, sample) for st in FONT_STYLES]
    strips.append(bmfont_render("body", "Quick jumpy fox & [grey] \"wyvern\" (ok)!?"))
    W = max(s.width for s in strips)
    H = sum(s.height for s in strips) + 8 * (len(strips) + 1)
    out = Image.new("RGBA", (W + 16, H), (10, 10, 14, 255))
    y = 8
    for s in strips:
        out.alpha_composite(s, (8, y))
        y += s.height + 8
    out.save(path)
    print("preview written to", path)


# --------------------------------------------------------------------------------------
# UI art
# --------------------------------------------------------------------------------------
SS = 4  # supersampling factor for the vector-drawn UI pieces


def S(v: float) -> int:
    return int(round(v * SS))


def new_canvas(w: int, h: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def finish(img: Image.Image, w: int, h: int) -> Image.Image:
    return img.resize((w, h), Image.LANCZOS)


def save_ui(img: Image.Image, name: str) -> None:
    img.save(os.path.join(UI_DIR, name), optimize=True)


def rrect(d: ImageDraw.ImageDraw, box, r: float, fill=None, outline=None, width: int = 1) -> None:
    d.rounded_rectangle([S(box[0]), S(box[1]), S(box[2]), S(box[3])], radius=S(r),
                        fill=fill, outline=outline, width=S(width) if outline else 0)


def ellipse(d: ImageDraw.ImageDraw, cx, cy, rx, ry, fill=None, outline=None, width=1) -> None:
    d.ellipse([S(cx - rx), S(cy - ry), S(cx + rx), S(cy + ry)], fill=fill, outline=outline,
              width=S(width) if outline else 0)


def poly(d: ImageDraw.ImageDraw, pts, fill=None, outline=None, width=1) -> None:
    d.polygon([(S(x), S(y)) for x, y in pts], fill=fill, outline=outline, width=S(width) if outline else 0)


def line(d: ImageDraw.ImageDraw, pts, fill, width: float = 1) -> None:
    d.line([(S(x), S(y)) for x, y in pts], fill=fill, width=max(1, S(width)))


def rivet(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float) -> None:
    """Small domed iron stud with a highlight."""
    ellipse(d, cx + 0.4, cy + 0.4, r, r, fill=rgba("#09080c"))
    ellipse(d, cx, cy, r, r, fill=rgba("#4f4a55"), outline=rgba("#1a171d"), width=0.6)
    ellipse(d, cx - r * 0.3, cy - r * 0.35, r * 0.38, r * 0.3, fill=rgba("#8d8792"))


def bezier(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0]
        y = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]
        pts.append((x, y))
    return pts


def tapered(pts, w0: float, w1: float):
    """Polygon outline of a curve with a linearly tapering width."""
    left, right = [], []
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        ax, ay = pts[max(i - 1, 0)]
        bx, by = pts[min(i + 1, n - 1)]
        tx, ty = bx - ax, by - ay
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        w = lerp(w0, w1, i / (n - 1)) / 2
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    return left + right[::-1]


def thorn_curve(d, p0, p1, p2, p3, w0, w1, fill, outline=None, width=0.6):
    poly(d, tapered(bezier(p0, p1, p2, p3), w0, w1), fill=fill, outline=outline, width=width)


IRON = "#3d373f"
IRON_DARK = "#17141a"
IRON_LIGHT = "#6b6470"
IRON_HI = "#9a929e"
BONE = "#cfc3a6"
BONE_DARK = "#8c8066"
BONE_HI = "#efe6cf"
GOLD = "#d9a93c"
GOLD_HI = "#f6dd8e"


def gen_panel(rng: np.random.Generator) -> None:
    w = h = 96
    img, d = new_canvas(w, h)
    # outer dark edge + stone border
    rrect(d, (0, 0, w, h), 4, fill=rgba(IRON_DARK))
    rrect(d, (1, 1, w - 1, h - 1), 3.5, fill=rgba("#2c2830"))
    rrect(d, (1.5, 1.5, w - 1.5, h - 1.5), 3, outline=rgba("#5a5361"), width=1.2)  # bevel light
    rrect(d, (3.5, 3.5, w - 1.5, h - 1.5), 3, outline=rgba("#1b181f"), width=1.2)  # bevel shadow
    # carved groove inside the border
    rrect(d, (6, 6, w - 6, h - 6), 2, outline=rgba("#110f14"), width=1)
    rrect(d, (7, 7, w - 7, h - 7), 2, outline=rgba("#4b4551"), width=0.8)
    # interior (translucent leather/stone)
    rrect(d, (8, 8, w - 8, h - 8), 1.5, fill=rgba("#14121a", 224))
    # inner shadow line so the interior looks recessed
    rrect(d, (8, 8, w - 8, h - 8), 1.5, outline=rgba("#07060a", 200), width=1)
    # corner ornaments: diagonal carve + iron stud
    for cx, cy, sx, sy in ((12, 12, 1, 1), (w - 12, 12, -1, 1), (12, h - 12, 1, -1), (w - 12, h - 12, -1, -1)):
        line(d, [(cx + sx * 6, cy + sy * 1), (cx + sx * 1, cy + sy * 6)], rgba("#120f15"), 1.2)
        line(d, [(cx + sx * 9, cy + sy * 2), (cx + sx * 2, cy + sy * 9)], rgba("#120f15"), 1)
        rivet(d, cx, cy, 4.2)
    out = finish(img, w, h)
    # a touch of grain on the border only (interior stays flat so 9-slice stretching is clean)
    arr = np.asarray(out).astype(np.int16)
    grain = rng.integers(-7, 8, size=(h, w, 1), dtype=np.int16)
    mask = np.ones((h, w, 1), dtype=bool)
    mask[9:-9, 9:-9] = False
    arr[..., :3] = np.clip(arr[..., :3] + grain * mask, 0, 255)
    save_ui(Image.fromarray(arr.astype(np.uint8), "RGBA"), "panel.png")


def gen_bar_frame(name: str, fw: int, fh: int, inset: int, thorny: bool) -> None:
    img, d = new_canvas(fw, fh)
    band = inset  # frame thickness
    # iron body
    rrect(d, (0, 2, fw, fh - 2), 5, fill=rgba(IRON_DARK))
    rrect(d, (1, 3, fw - 1, fh - 3), 4, fill=rgba(IRON))
    rrect(d, (1.5, 3.5, fw - 1.5, fh - 3.5), 4, outline=rgba(IRON_LIGHT), width=0.9)
    rrect(d, (2.5, 4.5, fw - 1.5, fh - 3.5), 4, outline=rgba("#241f28"), width=0.9)
    # thorns / bone studs along the long edges
    step = 14 if thorny else 11
    col = BONE if thorny else "#a39a86"
    for x in range(10, fw - 8, step):
        if thorny:
            poly(d, [(x - 3.2, band - 1.5), (x, 0.2), (x + 3.2, band - 1.5)], fill=rgba(BONE_DARK))
            poly(d, [(x - 2.2, band - 2), (x, 0.8), (x + 2.2, band - 2)], fill=rgba(col))
            poly(d, [(x - 3.2, fh - band + 1.5), (x, fh - 0.2), (x + 3.2, fh - band + 1.5)], fill=rgba(BONE_DARK))
            poly(d, [(x - 2.2, fh - band + 2), (x, fh - 0.8), (x + 2.2, fh - band + 2)], fill=rgba(col))
        else:
            rivet(d, x, band / 2 + 0.5, 1.6)
            rivet(d, x, fh - band / 2 - 0.5, 1.6)
    # end caps: larger studs / bone knobs
    for cx in (band / 2 + 1, fw - band / 2 - 1):
        rivet(d, cx, fh / 2, band * 0.42)
    # cut the window
    hole = Image.new("L", img.size, 255)
    ImageDraw.Draw(hole).rectangle([S(inset), S(inset), S(fw - inset) - 1, S(fh - inset) - 1], fill=0)
    alpha = np.minimum(np.asarray(img)[..., 3], np.asarray(hole))
    img.putalpha(Image.fromarray(alpha.astype(np.uint8), "L"))
    # inner shadow strip just inside the window (overlays the bar fill, adds depth)
    sh, sd = new_canvas(fw, fh)
    for i, a in enumerate((150, 90, 40)):
        sd.rectangle([S(inset + i), S(inset + i), S(fw - inset - i) - 1, S(fh - inset - i) - 1],
                     outline=(0, 0, 0, a), width=S(1))
    img = Image.alpha_composite(img, sh)
    save_ui(finish(img, fw, fh), name)


def gen_emblem() -> None:
    w = h = 72
    cx = cy = 36
    img, d = new_canvas(w, h)
    # iron ring
    ellipse(d, cx, cy, 35.5, 35.5, fill=rgba(IRON_DARK))
    ellipse(d, cx, cy, 34, 34, fill=rgba(IRON))
    ellipse(d, cx - 0.6, cy - 0.6, 33.2, 33.2, outline=rgba(IRON_LIGHT), width=1)
    ellipse(d, cx, cy, 29.5, 29.5, fill=rgba(IRON_DARK))
    ellipse(d, cx, cy, 28, 28, fill=rgba("#0f0d14"))
    ellipse(d, cx + 0.5, cy + 0.6, 28, 28, outline=rgba("#2a2530"), width=0.8)
    # ring notches (bolts)
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        rivet(d, cx + 31.7 * math.cos(a), cy + 31.7 * math.sin(a), 1.5)
    # faint glow behind the skull
    glow, gd = new_canvas(w, h)
    ellipse(gd, cx, cy + 2, 20, 22, fill=rgba("#5a3a2a", 90))
    glow = glow.filter(ImageFilter.GaussianBlur(S(4)))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    # horns (tapered curves sweeping up and out)
    for s in (-1, 1):
        pts = ((cx + s * 9, cy - 3), (cx + s * 20, cy - 2), (cx + s * 26, cy - 14), (cx + s * 16, cy - 27))
        thorn_curve(d, *pts, 6.5, 1.2, fill=rgba(BONE_DARK), outline=rgba("#241c14"), width=0.7)
        pts2 = ((cx + s * 9, cy - 4.5), (cx + s * 19, cy - 4), (cx + s * 24, cy - 14), (cx + s * 16, cy - 26))
        thorn_curve(d, *pts2, 3.5, 0.6, fill=rgba(BONE))
    # cranium + jaw
    ellipse(d, cx, cy - 1, 12.5, 13, fill=rgba("#241c14"))
    ellipse(d, cx, cy - 1, 11.5, 12, fill=rgba(BONE))
    poly(d, [(cx - 8, cy + 6), (cx + 8, cy + 6), (cx + 6.5, cy + 17), (cx - 6.5, cy + 17)],
         fill=rgba(BONE), outline=rgba("#241c14"), width=0.7)
    ellipse(d, cx - 2, cy - 7, 6, 4.5, fill=rgba(BONE_HI))  # forehead highlight
    # eye sockets, nose, teeth
    for s in (-1, 1):
        ellipse(d, cx + s * 5.2, cy - 0.5, 3.6, 4.2, fill=rgba("#0f0d14"))
        ellipse(d, cx + s * 5.2, cy, 1.1, 1.1, fill=rgba("#c93a2a"))  # ember eye
    poly(d, [(cx, cy + 4), (cx - 1.8, cy + 8.5), (cx + 1.8, cy + 8.5)], fill=rgba("#0f0d14"))
    for tx in (-5, -2.5, 0, 2.5, 5):
        line(d, [(cx + tx, cy + 11.5), (cx + tx, cy + 16)], rgba("#241c14"), 0.7)
    line(d, [(cx - 7, cy + 11.5), (cx + 7, cy + 11.5)], rgba("#241c14"), 0.7)
    save_ui(finish(img, w, h), "emblem.png")


def gen_cursor() -> None:
    w = h = 24
    img, d = new_canvas(w, h)
    claw = [(3, 3), (21, 12), (3, 21), (9, 12)]
    poly(d, [(x + 1, y + 1.2) for x, y in claw], fill=rgba("#000000", 150))  # shadow
    poly(d, claw, fill=rgba(BONE), outline=rgba("#241c14"), width=1.2)
    poly(d, [(6, 6), (14, 11), (9, 12)], fill=rgba(BONE_HI))
    save_ui(finish(img, w, h), "cursor.png")


def gen_slots() -> None:
    w = h = 56
    for selected in (False, True):
        img, d = new_canvas(w, h)
        rim = GOLD if selected else IRON
        rim_hi = GOLD_HI if selected else IRON_LIGHT
        rim_dk = "#6e4f14" if selected else "#241f28"
        rrect(d, (0, 0, w, h), 4, fill=rgba(IRON_DARK))
        rrect(d, (1, 1, w - 1, h - 1), 3.5, fill=rgba(rim))
        rrect(d, (1.5, 1.5, w - 1.5, h - 1.5), 3, outline=rgba(rim_hi), width=0.9)
        rrect(d, (3, 3, w - 1.5, h - 1.5), 3, outline=rgba(rim_dk), width=0.9)
        rrect(d, (5, 5, w - 5, h - 5), 2, fill=rgba("#07060a"))
        rrect(d, (6, 6, w - 6, h - 6), 1.5, fill=rgba("#100e14"))
        for i, a in enumerate((120, 60, 25)):
            d.rounded_rectangle([S(6 + i), S(6 + i), S(w - 6 - i), S(h - 6 - i)], radius=S(1.5),
                                outline=(0, 0, 0, a), width=S(1))
        for cx, cy in ((3.2, 3.2), (w - 3.2, 3.2), (3.2, h - 3.2), (w - 3.2, h - 3.2)):
            rivet(d, cx, cy, 1.3)
        if selected:
            glow, gd = new_canvas(w, h)
            rrect(gd, (1.5, 1.5, w - 1.5, h - 1.5), 3, outline=rgba(GOLD_HI, 255), width=2.5)
            glow = glow.filter(ImageFilter.GaussianBlur(S(2.2)))
            img = Image.alpha_composite(img, glow)
        save_ui(finish(img, w, h), "slot_selected.png" if selected else "slot.png")


def gen_vignette(rng: np.random.Generator) -> None:
    w, h = 1280, 720
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx - (w - 1) / 2) / (w / 2)
    ny = (yy - (h - 1) / 2) / (h / 2)
    dist = np.sqrt(nx * nx + ny * ny) / math.sqrt(2.0)  # 0 centre .. 1 corners
    t = np.clip((dist - 0.28) / (1.0 - 0.28), 0.0, 1.0)
    t = t * t * (3 - 2 * t)  # smoothstep
    alpha = 0.70 * (t ** 1.35) * 255.0
    alpha += rng.uniform(-1.5, 1.5, size=alpha.shape).astype(np.float32)  # dither against banding
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = 4, 3, 8
    arr[..., 3] = np.clip(np.round(alpha), 0, 255).astype(np.uint8)
    save_ui(Image.fromarray(arr, "RGBA"), "vignette.png")


def gen_buttons() -> None:
    w = h = 28
    big = ImageFont.truetype(SANS_TTF, S(15))
    small = ImageFont.truetype(SANS_TTF, S(9.5))

    def face_circle(d, colour, dark, light):
        ellipse(d, 14, 14, 13.5, 13.5, fill=rgba("#0a0a0e"))
        ellipse(d, 14, 14, 12.5, 12.5, fill=rgba(colour))
        ellipse(d, 14, 14, 11.8, 11.8, outline=rgba(dark), width=1.1)
        ellipse(d, 13.2, 12.8, 10.2, 10.2, outline=rgba(light, 150), width=0.9)

    for name, colour, dark, light, text, text_col in (
        ("a", "#3fa33a", "#1f6a1d", "#9ae08f", "A", "#f4fff2"),
        ("b", "#d9382f", "#8c1f19", "#ffa49b", "B", "#fff3f1"),
        ("x", "#2f6fd6", "#1c418a", "#9dc0ff", "X", "#f0f5ff"),
        ("y", "#f0c02a", "#a07d0f", "#fff0a8", "Y", "#2a1e04"),
    ):
        img, d = new_canvas(w, h)
        face_circle(d, colour, dark, light)
        d.text((S(14), S(14.6)), text, font=big, fill=rgba(text_col), anchor="mm",
               stroke_width=S(0.6), stroke_fill=rgba(dark))
        save_ui(finish(img, w, h), f"button_{name}.png")

    for name, text in (("rb", "RB"), ("lb", "LB")):
        img, d = new_canvas(w, h)
        rrect(d, (0.5, 6, 27.5, 22), 7, fill=rgba("#0a0a0e"))
        rrect(d, (1.5, 7, 26.5, 21), 6.5, fill=rgba("#6c6c74"))
        rrect(d, (2, 7.5, 26, 20.5), 6, outline=rgba("#9c9ca4"), width=0.8)
        rrect(d, (2.5, 8.5, 26, 20.5), 6, outline=rgba("#44444c"), width=0.8)
        d.text((S(14), S(14.2)), text, font=small, fill=rgba("#f6f6f8"), anchor="mm",
               stroke_width=S(0.5), stroke_fill=rgba("#3a3a40"))
        save_ui(finish(img, w, h), f"button_{name}.png")

    img, d = new_canvas(w, h)
    face_circle(d, "#6c6c74", "#44444c", "#b0b0b8")
    for y in (10, 14, 18):
        line(d, [(8.5, y), (19.5, y)], rgba("#f6f6f8"), 2)
    save_ui(finish(img, w, h), "button_start.png")


def gen_key() -> None:
    w = h = 28
    img, d = new_canvas(w, h)
    rrect(d, (1, 1, 27, 27), 4, fill=rgba("#0a0a0e"))               # outline
    rrect(d, (2, 2, 26, 26), 3.5, fill=rgba("#4e4e56"))              # keycap side (bottom)
    rrect(d, (2, 2, 26, 23.5), 3.5, fill=rgba("#8a8a92"))            # top face
    rrect(d, (2.5, 2.5, 25.5, 23), 3, outline=rgba("#b8b8c0"), width=0.8)
    rrect(d, (3.5, 3.5, 25.5, 23), 3, outline=rgba("#6a6a72"), width=0.8)
    save_ui(finish(img, w, h), "key.png")


def write_ui_json() -> None:
    data = {
        "panel.png": {"size": [96, 96], "slice": {"left": 24, "top": 24, "right": 24, "bottom": 24},
                      "note": "9-slice gothic panel; interior #14121a @ 88% alpha"},
        "bar_frame_hp.png": {"size": [316, 34], "inner": {"x": 8, "y": 8, "width": 300, "height": 18},
                             "slice": {"left": 12, "top": 8, "right": 12, "bottom": 8}},
        "bar_frame_stamina.png": {"size": [236, 28], "inner": {"x": 8, "y": 8, "width": 220, "height": 12},
                                  "slice": {"left": 10, "top": 8, "right": 10, "bottom": 8}},
        "emblem.png": {"size": [72, 72]},
        "cursor.png": {"size": [24, 24], "hotspot": [21, 12]},
        "slot.png": {"size": [56, 56], "slice": {"left": 8, "top": 8, "right": 8, "bottom": 8}, "inner": {"x": 6, "y": 6, "width": 44, "height": 44}},
        "slot_selected.png": {"size": [56, 56], "slice": {"left": 8, "top": 8, "right": 8, "bottom": 8}, "inner": {"x": 6, "y": 6, "width": 44, "height": 44}},
        "vignette.png": {"size": [1280, 720]},
        "button_a.png": {"size": [28, 28]}, "button_b.png": {"size": [28, 28]},
        "button_x.png": {"size": [28, 28]}, "button_y.png": {"size": [28, 28]},
        "button_rb.png": {"size": [28, 28]}, "button_lb.png": {"size": [28, 28]},
        "button_start.png": {"size": [28, 28]},
        "key.png": {"size": [28, 28], "label_area": {"x": 2, "y": 2, "width": 24, "height": 21}},
        "fonts": {st.name: {"png": f"assets/fonts/{st.name}.png", "xml": f"assets/fonts/{st.name}.xml", "size": st.size}
                  for st in FONT_STYLES},
    }
    with open(os.path.join(UI_DIR, "ui.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


# --------------------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", help="write a font verification PNG (rendered from the atlases) to this path")
    args = ap.parse_args()

    os.makedirs(FONT_DIR, exist_ok=True)
    os.makedirs(UI_DIR, exist_ok=True)

    for st in FONT_STYLES:
        build_font(st)
    if args.preview:
        write_preview(args.preview)

    rng = np.random.default_rng(0x7E0)
    gen_panel(rng)
    gen_bar_frame("bar_frame_hp.png", 316, 34, 8, thorny=True)
    gen_bar_frame("bar_frame_stamina.png", 236, 28, 8, thorny=False)
    gen_emblem()
    gen_cursor()
    gen_slots()
    gen_vignette(rng)
    gen_buttons()
    gen_key()
    write_ui_json()
    print("ui art written to", UI_DIR)


if __name__ == "__main__":
    main()
