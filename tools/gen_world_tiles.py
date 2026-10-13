"""Generate the world tiles for the procedural vertical levels and the high-altitude backgrounds.

Usage: python3 tools/gen_world_tiles.py [--preview DIR] [--only tiles|bg]

Outputs
  assets/sprites/world/*.png (+ *_n.png normal maps) and assets/sprites/world/tiles.json
      64x64 painted masonry tiles (moor stone and the pale "sky ruin" marble variant), a 192x64
      cloud platform, 48x64 ladders, 64x64 diagonal stair tiles and a 64x32 broken railing.
  assets/bg/common/{clouds_near,clouds_far,clouds_top,sky_high}.webp, moon_big.png,
      floating_ruin{1,2,3}.png and assets/bg/common/altitude.json

Tiles are painted the same way as the rig parts in gen_sprites.py: every primitive writes albedo,
a structural height and a fine-detail height at 4x supersampling; the height field is lit with the
shared key light and written out as an OpenGL-convention tangent-space normal map (green = up,
flat = 128,128,255, transparent = 128,128,255,0). Everything that must tile is drawn with wrap
copies and blurred/down-sampled with wrap padding, so seams are exact.
"""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from artlib import (hex2rgb, fbm_1d, fbm_2d, gradient_column, rgba, new_rgba, soft_disc, multiply_alpha,
                    draw_tapered_line, fbm_warp, gaussian_blur_array, height_shade, brick_height, mask_array,
                    rim_light, paint_grain, draw_glow_blob, chamfer_dt, gauss_f, encode_normal_map,
                    fbm_2d_tile, gauss_wrap, chamfer_dt_wrap, height_to_normals_tiled, downsample_wrap,
                    pad_wrap, blend_toward)

ROOT = os.path.join(os.path.dirname(__file__), '..')
WORLD = os.path.join(ROOT, 'assets', 'sprites', 'world')
COMMON = os.path.join(ROOT, 'assets', 'bg', 'common')
SS = 4
KEY_DIR = (0.30, -0.80, 0.52)      # same key light as gen_sprites.py (above, a little from +x)
SPEC_COL = np.array([255, 244, 222], float)
T = 64


def mkdir(p):
    os.makedirs(p, exist_ok=True)


def norm3(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1)


def mul(c, k):
    return tuple(int(np.clip(round(v * k), 0, 255)) for v in c)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def jit(rs, c, k=8):
    return tuple(int(np.clip(v + rs.randint(-k, k + 1), 0, 255)) for v in c)


# ------------------------------------------------------------------ canvas ----

class Tile:
    """A tile canvas at SS resolution with wrap copies: albedo (RGBA), structural height hs,
    fine height hf (both float px at SS), specular strength ks (0..1 float)."""

    def __init__(self, name, w, h, wrap_x=True, wrap_y=True):
        self.name, self.w, self.h = name, w, h
        self.wrap_x, self.wrap_y = wrap_x, wrap_y
        size = (w * SS, h * SS)
        self.img = Image.new('RGBA', size, (0, 0, 0, 0))
        self.hs = Image.new('F', size, 0.0)
        self.hf = Image.new('F', size, 0.0)
        self.ks = Image.new('F', size, 0.0)
        self._draws()

    def _draws(self):
        self.d = ImageDraw.Draw(self.img)
        self.dhs = ImageDraw.Draw(self.hs)
        self.dhf = ImageDraw.Draw(self.hf)
        self.dks = ImageDraw.Draw(self.ks)

    def offsets(self):
        xs = (-self.w, 0, self.w) if self.wrap_x else (0,)
        ys = (-self.h, 0, self.h) if self.wrap_y else (0,)
        return [(x * SS, y * SS) for y in ys for x in xs]

    def P(self, pts, off):
        return [((x) * SS + off[0], (y) * SS + off[1]) for x, y in pts]

    def _apply(self, shape, fill, h, dome, alpha, ks, hf):
        """shape(draw, value, off) draws geometry for every wrap offset."""
        for off in self.offsets():
            if fill is not None:
                if alpha >= 255:
                    shape(self.d, tuple(fill) + (255,), off)
                else:
                    layer = Image.new('RGBA', self.img.size, (0, 0, 0, 0))
                    shape(ImageDraw.Draw(layer), tuple(fill) + (int(alpha),), off)
                    self.img.alpha_composite(layer)
                    self._draws()
            if h is not None:
                shape(self.dhs, float(h) * SS, off)
            if hf is not None:
                shape(self.dhf, float(hf) * SS, off)
            if ks is not None:
                shape(self.dks, float(ks), off)
        if dome:
            m = Image.new('L', self.img.size, 0)
            dm = ImageDraw.Draw(m)
            for off in self.offsets():
                shape(dm, 255, off)
            mask = np.array(m) > 127
            if mask.any():
                dist = chamfer_dt(mask)
                R = max(1.0, dist.max())
                t = np.clip(dist / R, 0, 1)
                prof = np.sqrt(t * (2 - t)) * dome * SS
                hs = np.array(self.hs, np.float64) + prof * mask
                self.hs = Image.fromarray(hs.astype(np.float32), 'F')
                self._draws()

    def poly(self, pts, fill, h=None, dome=0, alpha=255, ks=None, hf=None):
        self._apply(lambda d, v, off: d.polygon(self.P(pts, off), fill=v), fill, h, dome, alpha, ks, hf)

    def rect(self, x0, y0, x1, y1, fill, **kw):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], fill, **kw)

    def ellipse(self, cx, cy, rx, ry, fill, h=None, dome=0, alpha=255, ks=None, hf=None):
        def shape(d, v, off):
            x, y = cx * SS + off[0], cy * SS + off[1]
            d.ellipse([x - rx * SS, y - ry * SS, x + rx * SS, y + ry * SS], fill=v)
        self._apply(shape, fill, h, dome, alpha, ks, hf)

    def line(self, pts, fill, width=1.0, hf=None, alpha=255, ks=None):
        wd = max(1, int(round(width * SS)))
        self._apply(lambda d, v, off: d.line(self.P(pts, off), fill=v, width=wd), fill, None, 0, alpha, ks, hf)

    def stroke(self, p0, p1, w0, w1, fill, hf=None, alpha=255, ks=None):
        def shape(d, v, off):
            a, b = self.P([p0, p1], off)
            draw_tapered_line(d, a, b, w0 * SS, w1 * SS, v)
        self._apply(shape, fill, None, 0, alpha, ks, hf)

    def erase(self, pts):
        for off in self.offsets():
            P = self.P(pts, off)
            self.d.polygon(P, fill=(0, 0, 0, 0))
            self.dhs.polygon(P, fill=0.0)
            self.dhf.polygon(P, fill=0.0)
            self.dks.polygon(P, fill=0.0)

    def erase_mask(self, keep):
        """keep: (h*SS, w*SS) float 0..1 multiplier on alpha (height zeroed where keep < 0.5)."""
        arr = np.array(self.img).astype(np.float64)
        arr[..., 3] *= np.clip(keep, 0, 1)
        self.img = Image.fromarray(arr.astype(np.uint8), 'RGBA')
        for attr in ('hs', 'hf', 'ks'):
            a = np.array(getattr(self, attr), np.float64) * (keep > 0.5)
            setattr(self, attr, Image.fromarray(a.astype(np.float32), 'F'))
        self._draws()

    def tint(self, rgb_mul, mask=None):
        arr = np.array(self.img).astype(np.float64)
        m = 1.0 if mask is None else mask[..., None]
        arr[..., :3] = arr[..., :3] * (1 + (np.asarray(rgb_mul, float)[None, None, :] - 1) * m)
        self.img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
        self._draws()

    def finish(self, round_r=3, shape_k=0.5, ambient=0.42, diffuse=0.92, ao=0.6, noise=0.06, key=KEY_DIR,
               spec_exp=18.0, tex_seed=0, nstrength=1.0, rim=0.0, rim_color=(120, 150, 215), extra_h=None,
               alpha_blur=0.0):
        W, H = self.img.size
        arr = np.array(self.img).astype(np.float64)
        alb, a = arr[..., :3], arr[..., 3] / 255.0
        if alpha_blur > 0:
            a = np.clip(gauss_wrap(a, alpha_blur * SS, self.wrap_x, self.wrap_y), 0, 1)
        hs = np.array(self.hs, np.float64)
        hf = np.array(self.hf, np.float64)
        ks = np.array(self.ks, np.float64)
        mask = a > 0.5
        if shape_k > 0 and mask.any() and not mask.all():
            dist = chamfer_dt_wrap(mask, self.wrap_x, self.wrap_y, pad=round_r * SS + 4)
            Rr = float(max(1.0, min(dist.max(), round_r * SS)))
            t = np.clip(dist / Rr, 0, 1)
            hsh = Rr * np.sqrt(t * (2 - t)) * shape_k
        else:
            hsh = np.zeros_like(a)
        h = hsh + gauss_wrap(hs, 1.2 * SS, self.wrap_x, self.wrap_y) + gauss_wrap(hf, 0.45 * SS, self.wrap_x, self.wrap_y)
        if extra_h is not None:
            h = h + extra_h
        nx, ny, nz = height_to_normals_tiled(h, nstrength, self.wrap_x, self.wrap_y)
        L = norm3(key)
        dif = np.clip((nx * L[0] + ny * L[1] + nz * L[2] + 0.28) / 1.28, 0, 1)
        occ = np.zeros_like(h)
        for s, wgt in ((1.6 * SS, 0.55), (4.5 * SS, 0.45)):
            occ += wgt * np.clip((gauss_wrap(h, s, self.wrap_x, self.wrap_y) - h) / (s * 0.55), 0, 1)
        aof = 1 - ao * np.clip(occ, 0, 1)
        Hv = norm3(L + np.array([0, 0, 1.0]))
        ndh = np.clip(nx * Hv[0] + ny * Hv[1] + nz * Hv[2], 0, 1)
        sp = (ks * np.power(ndh, spec_exp) + ks * 0.16 * ndh ** 3) * aof
        n1 = fbm_2d_tile(W, H, max(1, self.w // 10), max(1, self.h // 10), octaves=4, seed=tex_seed, wrap_x=self.wrap_x, wrap_y=self.wrap_y)
        n2 = fbm_2d_tile(W, H, max(1, self.w // 2), max(1, self.h // 2), octaves=2, seed=tex_seed + 77, wrap_x=self.wrap_x, wrap_y=self.wrap_y)
        alb_v = alb * (1 + (n1[..., None] - 0.5) * 2 * noise + (n2[..., None] - 0.5) * noise)
        alb_v = alb_v + (n1[..., None] - 0.5) * noise * np.array([90, 30, -70])[None, None, :]
        lit = (ambient + diffuse * dif) * aof
        col = alb_v * lit[..., None] + SPEC_COL[None, None, :] * sp[..., None]
        if rim > 0:
            Rd = norm3((-0.82, -0.36, 0.34))
            rv = np.clip(nx * Rd[0] + ny * Rd[1] + nz * Rd[2], 0, 1) ** 3.2 * rim
            col = col + np.array(rim_color, float)[None, None, :] * rv[..., None]
        out = np.dstack([np.clip(col, 0, 255), a * 255])
        colour = downsample_wrap(out, SS, self.wrap_x, self.wrap_y)
        nmap = encode_normal_map(nx, ny, nz, a, SS)
        return colour, nmap


def save_tile(tile, img, nmap, meta, **info):
    img.save(os.path.join(WORLD, tile.name + '.png'))
    nmap.save(os.path.join(WORLD, tile.name + '_n.png'))
    meta[tile.name] = dict(w=tile.w, h=tile.h, tile_x=tile.wrap_x, tile_y=tile.wrap_y, normal=True, **info)
    print('  tile', tile.name, img.size)
    return img


# ------------------------------------------------------------- palettes ----

MOOR = dict(
    stone=(64, 62, 58), stone_var=[(58, 64, 54), (70, 64, 60), (56, 58, 62), (68, 62, 52), (62, 66, 60)],
    mortar=(28, 27, 28), hi=(255, 255, 255), lo=(0, 0, 0), crack=(26, 23, 24),
    moss=(54, 82, 40), moss2=(72, 98, 44), grass=(48, 78, 34), grass2=(70, 102, 42),
    chip=(42, 39, 38), ks=0.08, vein=None, frost=None, glow=None, dome=(1.5, 2.5), dirt=0.35,
    widths=dict(min_w=16, max_parts=3),
)
SKY = dict(
    stone=(148, 158, 182), stone_var=[(136, 150, 182), (160, 164, 176), (142, 156, 188), (166, 160, 154), (150, 162, 190)],
    mortar=(62, 68, 92), hi=(255, 255, 255), lo=(40, 48, 84), crack=(92, 98, 122),
    moss=(150, 170, 190), moss2=(168, 186, 204), grass=(200, 214, 230), grass2=(226, 236, 248),
    chip=(98, 104, 122), ks=0.4, vein=(214, 166, 72), frost=(224, 236, 252), glow=(140, 170, 230), dome=(0.9, 1.4), dirt=0.0,
    widths=dict(min_w=22, max_parts=2),
)


# -------------------------------------------------------------- masonry ----

def random_partition(rs, total, min_w=16, max_parts=3):
    for _ in range(50):
        n = rs.randint(2, max_parts + 1)
        cuts = np.sort(rs.randint(min_w, total - min_w + 1, n - 1))
        parts = np.diff(np.concatenate([[0], cuts, [total]]))
        if (parts >= min_w).all():
            return [int(p) for p in parts]
    return [total // 2, total - total // 2]


def masonry(t, pal, seed, courses, y0=0, width=64, joint=2.0, dome=None, cracks=True, chips=True,
            moss=0.0, texture=0.1, top_wear=False, course_phase=0):
    """Paint coursed rubble masonry on tile `t`: `courses` is a list of course heights starting at
    y0. Every course is a random partition of `width` with a phase shift so joints never stack.
    Returns the list of block rects (x0, y0, x1, y1)."""
    rs = np.random.RandomState(seed)
    dome = dome or pal['dome']
    blocks = []
    prev_joints = []
    y = y0
    for ci, ch in enumerate(courses):
        widths = random_partition(rs, width, min_w=pal['widths']['min_w'] if ch >= 12 else 14, max_parts=pal['widths']['max_parts'])
        for _ in range(20):
            phase = rs.randint(0, width)
            joints = [(phase + sum(widths[:k])) % width for k in range(len(widths))]
            if all(min(abs(j - pj), width - abs(j - pj)) >= 7 for j in joints for pj in prev_joints):
                break
        prev_joints = joints
        x = phase
        for wi, bw in enumerate(widths):
            bs = rs.randint(0, 1 << 30)
            r = np.random.RandomState(bs)
            x0, x1 = x + joint / 2, x + bw - joint / 2
            y1 = y + ch - joint / 2
            yt = y + joint / 2
            wob = lambda: r.uniform(-0.6, 0.6)
            pts = [(x0 + wob(), yt + wob()), (x1 + wob(), yt + wob()), (x1 + wob(), y1 + wob()), (x0 + wob(), y1 + wob())]
            if top_wear and ci == 0:
                # worn, slightly rounded top edge: a notched polyline instead of a straight top
                top = [(x0 + wob(), yt + r.uniform(0.2, 1.2))]
                for k in range(1, 5):
                    top.append((x0 + (x1 - x0) * k / 5 + wob(), yt + r.uniform(-0.3, 1.3)))
                top.append((x1 + wob(), yt + r.uniform(0.2, 1.2)))
                pts = top + [pts[2], pts[3]]
            base = pal['stone_var'][r.randint(len(pal['stone_var']))]
            col = jit(r, mix(pal['stone'], base, r.uniform(0.3, 0.9)), 6)
            dm = r.uniform(dome[0], dome[1])
            t.poly(pts, col, dome=dm, ks=pal['ks'])
            # bevel lines: light along the top edge, dark along the bottom
            t.line([pts[0], pts[1]] if not (top_wear and ci == 0) else pts[:6], mix(col, pal['hi'], 0.28), width=0.8, alpha=150)
            t.line([pts[-1], pts[-2]], mix(col, pal['lo'], 0.5), width=0.9, alpha=170)
            t.line([pts[-2], pts[1]], mix(col, pal['lo'], 0.3), width=0.6, alpha=120)
            if texture > 0:
                # a few soft tonal patches per stone (weathering)
                for _ in range(r.randint(1, 4)):
                    px, py = r.uniform(x0 + 2, x1 - 2), r.uniform(yt + 2, y1 - 2)
                    t.ellipse(px, py, r.uniform(2, 5), r.uniform(1.2, 2.5), mix(col, pal['lo' if r.rand() < 0.5 else 'hi'], 0.12), alpha=110)
            if cracks and r.rand() < 0.45:
                cx, cy = r.uniform(x0 + 3, x1 - 3), r.uniform(yt + 2, y1 - 2)
                ang = r.uniform(0, math.pi)
                pts_c = [(cx, cy)]
                for _ in range(r.randint(2, 4)):
                    ang += r.uniform(-0.7, 0.7)
                    L = r.uniform(2, 4.5)
                    pts_c.append((pts_c[-1][0] + math.cos(ang) * L, pts_c[-1][1] + math.sin(ang) * L))
                t.line(pts_c, pal['crack'], width=0.6, hf=-0.5, alpha=210)
            if chips and r.rand() < 0.4:
                # chipped corner: mortar-coloured notch with low height
                cx, cy = (x0, yt) if r.rand() < 0.5 else (x1, y1)
                sgn = 1 if cx == x0 else -1
                sgy = 1 if cy == yt else -1
                n = r.uniform(2, 4)
                t.poly([(cx, cy), (cx + sgn * n, cy), (cx, cy + sgy * n * r.uniform(0.6, 1.2))], pal['chip'], h=-0.6, hf=-0.4, ks=0)
            if pal['dirt'] > 0 and r.rand() < pal['dirt']:
                # weathering: a dark damp streak running down from the joint above
                sx = r.uniform(x0 + 2, x1 - 2)
                t.stroke((sx, yt - 1), (sx + r.uniform(-1, 1), yt + r.uniform(4, 9)), r.uniform(2, 3.5), 0.8, mix(col, pal['lo'], 0.5), alpha=70)
            blocks.append((x0, yt, x1, y1))
            x += bw
        y += ch
    if pal['vein'] is not None:
        # marble: soft mottling plus faint darker swirls through every stone
        W, H = t.img.size
        mot = fbm_2d_tile(W, H, 3, 3, octaves=4, persistence=0.6, seed=seed + 300, wrap_x=t.wrap_x, wrap_y=t.wrap_y)
        swirl = fbm_2d_tile(W, H, 4, 4, octaves=5, persistence=0.55, seed=seed + 301, wrap_x=t.wrap_x, wrap_y=t.wrap_y, ridged=True)
        m = 0.88 + 0.22 * mot - 0.16 * np.clip((swirl - 0.72) / 0.28, 0, 1)
        t.tint((1, 1, 1), None)
        arr = np.array(t.img).astype(np.float64)
        arr[..., :3] *= m[..., None]
        arr[..., 2] *= 1 + 0.06 * (mot - 0.5)
        t.img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
        t._draws()
    if moss > 0:
        for (x0, yt, x1, y1) in blocks:
            if rs.rand() < moss:
                # moss grows in the lower joints and in corners
                for _ in range(rs.randint(1, 3)):
                    mx = rs.uniform(x0, x1)
                    my = y1 + rs.uniform(-1.5, 1.0) if rs.rand() < 0.7 else yt + rs.uniform(-0.5, 2)
                    col = jit(rs, pal['moss'] if rs.rand() < 0.6 else pal['moss2'], 8)
                    t.ellipse(mx, my, rs.uniform(2, 4.5), rs.uniform(1, 2), col, alpha=200, hf=0.3)
                    t.ellipse(mx + rs.uniform(-2, 2), my - 0.5, rs.uniform(1, 2), rs.uniform(0.6, 1.2), jit(rs, pal['moss2'], 8), alpha=160)
    return blocks


def grass_tufts(t, rs, pal, y_base, n, x0=0, x1=64, up=(4, 11), lean=0.0):
    for _ in range(n):
        gx = rs.uniform(x0, x1)
        g = jit(rs, pal['grass'] if rs.rand() < 0.6 else pal['grass2'], 10)
        hgt = rs.uniform(*up)
        t.stroke((gx, y_base), (gx + rs.uniform(-3, 3) + lean * hgt, y_base - hgt), 1.8, 0.3, g, hf=0.3)


def sky_dress(t, pal, seed, region=(0, 0, 64, 64), veins=True, frost_edges=()):
    """Sky-ruin finish: gold veins through the marble, frost along exposed edges."""
    rs = np.random.RandomState(seed)
    x0, y0, x1, y1 = region
    if veins and pal['vein']:
        for _ in range(rs.randint(2, 4)):
            x, y = rs.uniform(x0, x1), rs.uniform(y0, y1)
            ang = rs.uniform(0, math.pi)
            pts = [(x, y)]
            for _ in range(rs.randint(3, 6)):
                ang += rs.uniform(-0.7, 0.7)
                L = rs.uniform(3, 7)
                pts.append((pts[-1][0] + math.cos(ang) * L, pts[-1][1] + math.sin(ang) * L))
            t.line(pts, mix(pal['vein'], (120, 90, 40), 0.4), width=1.2, alpha=120, ks=0.9, hf=0.15)
            t.line(pts, pal['vein'], width=0.7, alpha=210, ks=1.0)
            t.line(pts, mix(pal['vein'], (255, 240, 200), 0.6), width=0.35, alpha=170)
            if rs.rand() < 0.5:   # a side branch
                k = rs.randint(1, len(pts) - 1)
                bx, by = pts[k]
                ang2 = ang + rs.choice([-1, 1]) * rs.uniform(0.8, 1.6)
                br = [(bx, by), (bx + math.cos(ang2) * 4, by + math.sin(ang2) * 4), (bx + math.cos(ang2) * 8 + rs.uniform(-2, 2), by + math.sin(ang2) * 8)]
                t.line(br, pal['vein'], width=0.55, alpha=180, ks=1.0)
    for (ax, ay, bx, by, inward) in frost_edges:
        # frost: pale crystals clustering along an edge, thinning inwards
        n = int(math.hypot(bx - ax, by - ay) / 2.2)
        nx, ny = inward
        for _ in range(n):
            s = rs.rand()
            px, py = ax + (bx - ax) * s, ay + (by - ay) * s
            d = rs.rand() ** 2 * 7
            px, py = px + nx * d, py + ny * d
            col = mix(pal['frost'], (255, 255, 255), rs.rand() * 0.6)
            a = int(np.clip(230 - d * 28, 40, 230))
            t.ellipse(px, py, rs.uniform(0.8, 2.2), rs.uniform(0.6, 1.4), col, alpha=a, ks=0.5, hf=0.2)
            if rs.rand() < 0.25:
                t.stroke((px, py), (px + nx * rs.uniform(1.5, 4) + rs.uniform(-1.5, 1.5), py + ny * rs.uniform(1.5, 4) + rs.uniform(-1.5, 1.5)), 1.0, 0.2, col, alpha=190)


def finish_kwargs(pal):
    if pal is SKY:
        return dict(ambient=0.5, diffuse=0.75, ao=0.5, noise=0.04, spec_exp=24.0, rim=0.35, rim_color=(190, 210, 255))
    return dict(ambient=0.42, diffuse=0.92, ao=0.6, noise=0.08, spec_exp=16.0, rim=0.15)


def sky_glow(img, pal, strength=0.1, seed=0):
    """Faint cool luminance lift on the sky marble so it reads as 'lit from within' against the dark sky."""
    if pal is not SKY:
        return img
    arr = np.array(img).astype(np.float64)
    w, h = img.size
    n = fbm_2d_tile(w, h, 2, 2, octaves=3, seed=seed + 900)
    arr[..., :3] += np.array(pal['glow'], float)[None, None, :] * (strength * (0.6 + 0.8 * n))[..., None] * (arr[..., 3:4] / 255.0)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


# -------------------------------------------------------- the stone tiles ----

def stone_fill(name, pal, seed, meta):
    t = Tile(name, T, T, True, True)
    t.rect(-4, -4, T + 4, T + 4, pal['mortar'], ks=0)
    masonry(t, pal, seed, [16, 16, 16, 16], moss=0.25 if pal is MOOR else 0.0)
    if pal is SKY:
        sky_dress(t, pal, seed + 1)
    img, nmap = t.finish(shape_k=0.0, tex_seed=seed, **finish_kwargs(pal))
    img = sky_glow(img, pal, seed=seed)
    return save_tile(t, img, nmap, meta, role='fill')


def stone_top(name, pal, seed, meta):
    t = Tile(name, T, T, True, False)
    rs = np.random.RandomState(seed + 5)
    top = 6
    # mortar body with a slightly wavy top edge
    edge = [(x, top + rs.uniform(-0.6, 0.8)) for x in range(-4, T + 8, 6)]
    t.poly([(-4, T + 4), ] + edge + [(T + 8, T + 4)], pal['mortar'], ks=0)
    t.poly([(-4, T + 4), ] + edge + [(T + 8, T + 4)], pal['mortar'], ks=0)
    masonry(t, pal, seed, [14, 16, 16, 14], y0=top, moss=0.35 if pal is MOOR else 0.0, top_wear=True)
    # cap course: fewer, longer worn slabs read better as a walkable top -> a lighter wash on top row
    t.rect(-4, top, T + 4, top + 2.5, mix(pal['stone'], pal['hi'], 0.18 if pal is MOOR else 0.3), alpha=90)
    if pal is MOOR:
        # moss cushions creeping over the top edge and grass blades above it
        for _ in range(14):
            mx = rs.uniform(0, T)
            col = jit(rs, pal['moss'] if rs.rand() < 0.5 else pal['moss2'], 8)
            t.ellipse(mx, top + rs.uniform(-0.5, 2.5), rs.uniform(2.5, 5), rs.uniform(1.2, 2.4), col, alpha=215, hf=0.5)
        grass_tufts(t, rs, pal, top + 1.5, 46, up=(3, 7))
        grass_tufts(t, rs, pal, top + 1.5, 10, up=(5, 9), lean=0.3)
    else:
        sky_dress(t, pal, seed + 1, region=(0, top, T, T), frost_edges=[(0, top, T, top, (0, 1))])
        # a few pale lichen-like crystals standing on the edge
        for _ in range(6):
            gx = rs.uniform(0, T)
            hgt = rs.uniform(2.0, 4.5)
            tip = (gx + rs.uniform(-1.5, 1.5), top + 0.5 - hgt)
            t.poly([(gx - 1.6, top + 1), tip, (gx + 1.6, top + 1)], mix(pal['frost'], (255, 255, 255), 0.3), alpha=210, ks=0.9, dome=0.5)
            t.line([(gx - 0.4, top + 0.8), tip], (255, 255, 255), width=0.4, alpha=180)
    img, nmap = t.finish(round_r=3, shape_k=0.5, tex_seed=seed, **finish_kwargs(pal))
    img = sky_glow(img, pal, seed=seed)
    return save_tile(t, img, nmap, meta, role='top')


def stone_edge(name, pal, seed, meta, side):
    t = Tile(name, T, T, True, True)
    rs = np.random.RandomState(seed + 9)
    t.rect(-4, -4, T + 4, T + 4, pal['mortar'], ks=0)
    masonry(t, pal, seed, [16, 16, 16, 16], moss=0.2 if pal is MOOR else 0.0)
    # crumbled outer edge: erase a ragged strip along the outer side (wraps vertically)
    ys = np.arange(T * SS) / SS
    prof = fbm_1d(T * SS, 3, octaves=2, seed=seed + 3)
    cut = 1.5 + prof * 3.0
    # bites: a few deeper notches where a stone has broken away (wrap vertically)
    for _ in range(3):
        by, bh, bd = rs.uniform(0, T), rs.uniform(6, 13), rs.uniform(3, 6)
        for dy in (-T, 0, T):
            u = np.clip(1 - np.abs(ys - by - dy) / (bh / 2), 0, 1)
            cut = np.maximum(cut, 1.5 + bd * np.sqrt(u * (2 - u)))
    xs = np.arange(T * SS) / SS
    if side == 'l':
        keep = (xs[None, :] >= cut[:, None]).astype(float)
    else:
        keep = (xs[None, :] <= T - cut[:, None]).astype(float)
    t.erase_mask(keep)
    # the broken face: left edges face away from the key light (shadow), right edges catch it
    edge_pts = [((cut[i] if side == 'l' else T - cut[i]), ys[i]) for i in range(0, T * SS, SS)]
    edge_pts.append((edge_pts[0][0], T))
    inner = 1.0 if side == 'l' else -1.0
    shifted = [(x + inner * 0.9, y) for x, y in edge_pts]
    if side == 'l':
        t.line(shifted, mix(pal['stone'], pal['lo'], 0.55), width=1.6, alpha=150, hf=-0.4)
    else:
        t.line(shifted, mix(pal['stone'], pal['hi'], 0.3), width=1.2, alpha=140, hf=0.3)
    # loose chips drifting just outside the edge
    for _ in range(4):
        y = rs.uniform(0, T)
        c = cut[int(y * SS) % (T * SS)]
        x = (c if side == 'l' else T - c) - inner * rs.uniform(1.5, 3.5)
        t.poly([(x - 1.3, y - 0.8), (x + 1.3, y - 1.1), (x + 0.9, y + 1.2), (x - 1.1, y + 0.9)], jit(rs, pal['stone'], 10), dome=0.8, ks=pal['ks'])
    if pal is SKY:
        sky_dress(t, pal, seed + 1, frost_edges=[(3, 0, 3, T, (1, 0)) if side == 'l' else (T - 3, 0, T - 3, T, (-1, 0))])
    img, nmap = t.finish(round_r=3, shape_k=0.6, tex_seed=seed, **finish_kwargs(pal))
    img = sky_glow(img, pal, seed=seed)
    t.wrap_x = False     # an edge cap does not repeat sideways (its inner side matches the fill tile)
    return save_tile(t, img, nmap, meta, role='edge_' + side)


def stair(name, pal, seed, meta):
    t = Tile(name, T, T, False, False)
    rs = np.random.RandomState(seed + 7)
    t.rect(-4, -4, T + 4, T + 4, pal['mortar'], ks=0)
    masonry(t, pal, seed, [16, 16, 16, 16], moss=0.15 if pal is MOOR else 0.0)
    # erase everything above the step profile (steps rise bottom-left -> top-right)
    prof = [(0, 48), (16, 48), (16, 32), (32, 32), (32, 16), (48, 16), (48, 0), (64, 0)]
    t.erase([(-4, -4), (-4, 48)] + prof + [(68, 0), (68, -4)])
    tread_col = mix(pal['stone'], pal['hi'], 0.16)
    riser_col = mix(pal['stone'], pal['lo'], 0.45 if pal is MOOR else 0.28)
    for k in range(4):
        x0, yt = 16 * k, 48 - 16 * k
        # riser face (vertical, in shadow) sits just right of the step's left edge
        t.rect(x0, yt + 5, x0 + 1.6, yt + 16, riser_col, alpha=150, hf=-0.4, ks=0)
        t.rect(x0, yt + 5, x0 + 0.6, yt + 16, mix(riser_col, pal['lo'], 0.4), alpha=170)
        # tread slab with a small nose overhang to the left
        pts = [(x0 - 1.5, yt), (x0 + 16.6, yt), (x0 + 16.6, yt + 5.2), (x0 - 1.5, yt + 5.2)]
        t.poly(pts, jit(rs, tread_col, 5), dome=1.8, ks=pal['ks'])
        t.line([(x0 - 1.2, yt + 0.6), (x0 + 16.4, yt + 0.6)], mix(tread_col, pal['hi'], 0.35), width=0.9, alpha=190, hf=0.2)
        t.line([(x0 - 1.2, yt + 4.6), (x0 + 16.4, yt + 4.6)], mix(tread_col, pal['lo'], 0.45), width=0.8, alpha=170)
        # worn hollow in the middle of the tread
        t.ellipse(x0 + 8, yt + 2.6, 5, 1.2, mix(tread_col, pal['hi'], 0.12), alpha=90, hf=-0.25)
        # a crack or two on the tread
        if rs.rand() < 0.6:
            cx = x0 + rs.uniform(3, 12)
            t.line([(cx, yt + 1), (cx + rs.uniform(-2, 2), yt + 4)], pal['crack'], width=0.5, hf=-0.4, alpha=190)
        if pal is MOOR:
            # moss in the inner corner of each step (where tread meets the next riser)
            for _ in range(rs.randint(1, 3)):
                mx = x0 + 15 + rs.uniform(-3, 1)
                t.ellipse(mx, yt + rs.uniform(-0.5, 1.5), rs.uniform(1.5, 3), rs.uniform(0.8, 1.5), jit(rs, pal['moss'], 8), alpha=200, hf=0.3)
            if rs.rand() < 0.6:
                grass_tufts(t, rs, pal, yt + 0.5, 3, x0=x0 + 10, x1=x0 + 16, up=(2, 5))
        else:
            sky_dress(t, pal, seed + k, region=(x0, yt, x0 + 16, T), veins=False,
                      frost_edges=[(x0 - 1.5, yt, x0 + 16.6, yt, (0, 1))])
    if pal is SKY:
        sky_dress(t, pal, seed + 1, region=(0, 0, T, T), veins=True)
    img, nmap = t.finish(round_r=2, shape_k=0.5, tex_seed=seed, **finish_kwargs(pal))
    img = sky_glow(img, pal, seed=seed)
    return save_tile(t, img, nmap, meta, role='stair', step=16, diagonal='up-right')


# ------------------------------------------------------- doors and walls ----

DOOR_W, DOOR_H = 128, 192          # the opening between two rooms: 2 tiles wide, 3 tall


def gate_edge(name, seed, meta):
    """The portcullis seen edge-on, as a side-scroller shows a gate across the corridor: a narrow iron
    slab with the ends of its cross-bars as studs, a lit face on the left, spikes at the foot."""
    W, H = 28, DOOR_H
    t = Tile(name, W, H, False, False)
    rs = np.random.RandomState(seed)
    iron, iron_lt, iron_dk, rust = (40, 40, 46), (96, 96, 108), (12, 12, 16), (112, 62, 34)
    t.poly([(4, 0), (24, 0), (24, H - 16), (4, H - 16)], iron, dome=3.0, ks=0.7)
    t.rect(4, 0, 9, H - 16, mix(iron, iron_lt, 0.6), alpha=220, ks=0.8)
    t.line([(24, 1), (24, H - 17)], iron_dk, width=1.2, alpha=220)
    for k in range(6):
        y = 10 + k * 30
        t.poly([(1, y - 4), (27, y - 4), (27, y + 4), (1, y + 4)], mix(iron, iron_lt, 0.25), dome=2.2, ks=0.9)
        t.line([(2, y - 3.2), (26, y - 3.2)], iron_lt, width=0.8, alpha=180)
        t.line([(2, y + 3.3), (26, y + 3.3)], iron_dk, width=0.9, alpha=200)
        t.ellipse(14, y, 2.4, 2.4, iron_lt, dome=1.2, ks=1.0)
        t.ellipse(13.4, y - 0.5, 0.9, 0.9, (170, 170, 184), alpha=220)
        if rs.rand() < 0.6:
            t.stroke((8 + rs.uniform(0, 10), y + 4), (8 + rs.uniform(0, 10), y + 4 + rs.uniform(6, 16)), 1.6, 0.3, rust, alpha=140)
    for x in (8, 14, 20):
        t.poly([(x - 3.5, H - 16), (x + 3.5, H - 16), (x, H - 1)], iron, dome=1.6, ks=0.9)
        t.line([(x - 3.0, H - 15), (x, H - 2)], iron_lt, width=0.6, alpha=170)
    for k in range(5):
        cy = -6 + k * 5
        t.ellipse(14 + (1.5 if k % 2 else -1.5), cy, 1.6, 2.6, iron_lt, dome=1.0, ks=0.8)
    img, nmap = t.finish(round_r=3, shape_k=0.6, ambient=0.32, diffuse=0.85, ao=0.5, noise=0.05, tex_seed=seed, rim=0.15,
                         rim_color=(120, 150, 215))
    return save_tile(t, img, nmap, meta, role='gate_edge')


def gate_slot(name, pal, seed, meta):
    """The housing the gate rises into: a dressed lintel block with a dark slot, over the opening."""
    W, H = 56, 36
    t = Tile(name, W, H, False, False)
    rs = np.random.RandomState(seed)
    col = jit(rs, mix(pal['stone'], pal['stone_var'][0], 0.5), 5)
    t.poly([(1.5, 1.5), (W - 1.5, 1.5), (W - 1.5, H - 1.5), (1.5, H - 1.5)], col, dome=2.4, ks=pal['ks'])
    t.line([(2, 2), (W - 2, 2)], mix(col, pal['hi'], 0.3), width=0.9, alpha=160)
    t.line([(2, H - 2), (W - 2, H - 2)], mix(col, pal['lo'], 0.5), width=1.0, alpha=180)
    t.poly([(W / 2 - 5, 6), (W / 2 + 5, 6), (W / 2 + 5, H), (W / 2 - 5, H)], mix(pal['mortar'], (0, 0, 0), 0.6), hf=-3.0, ks=0)
    for _ in range(2):
        cx = rs.uniform(6, W - 6)
        t.line([(cx, 4), (cx + rs.uniform(-4, 4), H - 4)], pal['crack'], width=0.5, hf=-0.4, alpha=150)
    img, nmap = t.finish(round_r=2, shape_k=0.5, tex_seed=seed, **finish_kwargs(pal))
    img = sky_glow(img, pal, seed=seed)
    return save_tile(t, img, nmap, meta, role='gate_slot')


def crack_wall(name, pal, seed, meta, stage=1):
    """Breakable masonry that fills a door opening. Stage 1 is cracked, stage 2 has lost chunks."""
    # drawn as a horizontally wrapping canvas so the coursed masonry (which phases blocks modulo the
    # width) covers the whole slab; the sprite is still shown unwrapped
    t = Tile(name, DOOR_W, DOOR_H, True, False)
    rs = np.random.RandomState(seed + stage * 31)
    t.rect(-4, -4, DOOR_W + 4, DOOR_H + 4, pal['mortar'], ks=0)
    wp = dict(pal, widths=dict(min_w=18, max_parts=5))
    masonry(t, wp, seed, [24] * 8, width=DOOR_W, moss=0.1 if pal is MOOR else 0.0)
    # a web of deep cracks radiating from a weak point
    cx, cy = DOOR_W * rs.uniform(0.35, 0.65), DOOR_H * rs.uniform(0.35, 0.6)
    for k in range(6 if stage == 1 else 10):
        ang = rs.uniform(0, 2 * np.pi)
        pts = [(cx, cy)]
        x, y = cx, cy
        for _ in range(rs.randint(3, 7)):
            ang += rs.uniform(-0.7, 0.7)
            step = rs.uniform(10, 24)
            x, y = x + np.cos(ang) * step, y + np.sin(ang) * step
            pts.append((x, y))
        t.line(pts, pal['crack'], width=2.2 if stage == 1 else 3.2, hf=-1.6, alpha=240)
        t.line([(x + 0.8, y + 0.8) for x, y in pts], mix(pal['stone'], pal['hi'], 0.25), width=0.6, hf=0.3, alpha=110)
    if stage == 2:
        # missing stones: dark recesses
        for _ in range(4):
            hx, hy = cx + rs.uniform(-40, 40), cy + rs.uniform(-50, 50)
            pts = [(hx + rs.uniform(10, 22) * np.cos(a), hy + rs.uniform(8, 18) * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 7)[:-1]]
            t.poly(pts, mix(pal['mortar'], (0, 0, 0), 0.5), hf=-3.0, ks=0)
    # rubble at the foot
    for _ in range(8 if stage == 1 else 14):
        rx, ry = rs.uniform(4, DOOR_W - 4), DOOR_H - rs.uniform(2, 10)
        t.ellipse(rx, ry, rs.uniform(2, 5), rs.uniform(1.2, 2.6), jit(rs, pal['chip'], 8), dome=1.2, ks=pal['ks'])
    img, nmap = t.finish(round_r=2, shape_k=0.4, tex_seed=seed, **finish_kwargs(pal))
    img = sky_glow(img, pal, seed=seed)
    return save_tile(t, img, nmap, meta, role='breakable', stage=stage)


# ------------------------------------------------------------------ ladder ----

def ladder(name, seed, meta, sky=False):
    t = Tile(name, 48, 64, False, True)
    rs = np.random.RandomState(seed)
    if not sky:
        wood, wood_lt, wood_dk = (88, 66, 46), (134, 108, 82), (42, 30, 22)
        band, band_lt, band_dk = (52, 52, 60), (104, 104, 118), (22, 22, 28)
        rivet = (120, 118, 126)
        ks_w, ks_b = 0.1, 0.8
        rung, rung_lt, rung_dk = (96, 74, 52), (140, 114, 84), (44, 32, 24)
    else:
        wood, wood_lt, wood_dk = (178, 174, 170), (220, 218, 214), (104, 100, 102)
        band, band_lt, band_dk = (196, 150, 64), (244, 208, 112), (122, 86, 28)
        rivet = (250, 226, 150)
        ks_w, ks_b = 0.3, 1.0
        rung, rung_lt, rung_dk = (206, 198, 184), (236, 230, 218), (120, 112, 104)
    rails = ((8, 14), (34, 40))
    # rungs every 32 px, mortised into the rails
    for ry in (16, 48):
        t.poly([(9, ry - 2.6), (39, ry - 2.4), (39, ry + 2.5), (9, ry + 2.7)], rung, dome=2.4, ks=ks_w)
        t.line([(10, ry - 1.6), (38, ry - 1.4)], rung_lt, width=0.8, alpha=150)
        t.line([(10, ry + 1.7), (38, ry + 1.8)], rung_dk, width=0.8, alpha=170)
        for k in range(3):
            x = rs.uniform(12, 30)
            t.line([(x, ry + rs.uniform(-1.5, 1.5)), (x + rs.uniform(4, 9), ry + rs.uniform(-1.5, 1.5))], rung_dk, width=0.5, hf=-0.25, alpha=150)
        # worn pale patch where feet land
        t.ellipse(24 + rs.uniform(-4, 4), ry - 0.8, 5, 1.1, rung_lt, alpha=70)
    # rails (full height, wrap vertically)
    for (x0, x1) in rails:
        t.poly([(x0, -6), (x1, -6), (x1, 70), (x0, 70)], wood, dome=2.6, ks=ks_w)
        for gx in np.linspace(x0 + 1.2, x1 - 1.2, 3):
            pts = [(gx + rs.uniform(-0.4, 0.4), y) for y in range(-6, 72, 8)]
            t.line(pts, wood_dk, width=0.5, hf=-0.3, alpha=150)
        t.line([(x0 + 1.0, -6), (x0 + 1.0, 70)], wood_lt, width=0.6, alpha=120)
        t.line([(x1 - 0.8, -6), (x1 - 0.8, 70)], wood_dk, width=0.7, alpha=150)
        # knot and a split
        ky = rs.uniform(20, 44)
        t.ellipse((x0 + x1) / 2 + rs.uniform(-1, 1), ky, 1.4, 2.0, wood_dk, hf=-0.6)
        t.ellipse((x0 + x1) / 2 + rs.uniform(-1, 1), ky, 0.7, 1.0, mul(wood_dk, 0.6))
        sy = rs.uniform(0, 64)
        t.line([(x0 + 2.5, sy), (x0 + 2.8, sy + rs.uniform(5, 10))], wood_dk, width=0.6, hf=-0.4, alpha=200)
        # weathering: grey-silver wash on the lit side
        t.rect(x0, -6, x0 + 2.2, 70, mix(wood, (150, 150, 150) if not sky else (255, 255, 255), 0.25), alpha=70)
        # iron bands at each rung
        for ry in (16, 48):
            t.poly([(x0 - 1.0, ry - 4.2), (x1 + 1.0, ry - 4.2), (x1 + 1.0, ry + 4.2), (x0 - 1.0, ry + 4.2)], band, dome=1.0, ks=ks_b)
            t.line([(x0 - 0.8, ry - 3.4), (x1 + 0.8, ry - 3.4)], band_lt, width=0.7, alpha=170)
            t.line([(x0 - 0.8, ry + 3.5), (x1 + 0.8, ry + 3.5)], band_dk, width=0.8, alpha=190)
            for rx in (x0 + 1.2, x1 - 1.2):
                t.ellipse(rx, ry, 0.9, 0.9, rivet, dome=0.6, ks=ks_b)
            if not sky:
                # rust bleeding down from the band
                t.stroke((x0 + 2 + rs.uniform(0, 2), ry + 4), (x0 + 2 + rs.uniform(0, 2), ry + 4 + rs.uniform(4, 10)), 1.6, 0.3, (112, 62, 34), alpha=120)
    if sky:
        # gold cord lashings around the rung ends and a faint frost on the rail tops
        for ry in (16, 48):
            for (x0, x1) in rails:
                t.line([(x0 + 0.5, ry - 1.5), (x1 - 0.5, ry + 1.5)], band_lt, width=0.7, alpha=200, ks=1.0)
                t.line([(x0 + 0.5, ry + 1.5), (x1 - 0.5, ry - 1.5)], band_lt, width=0.7, alpha=200, ks=1.0)
    img, nmap = t.finish(round_r=3, shape_k=0.6, ambient=0.45, diffuse=0.9, ao=0.6, noise=0.08 if not sky else 0.04,
                         tex_seed=seed, rim=0.35 if not sky else 0.3, rim_color=(120, 150, 215) if not sky else (200, 215, 255))
    return save_tile(t, img, nmap, meta, role='ladder', rung_spacing=32, rail_x=[11, 37])


# -------------------------------------------------------------------- rail ----

def rail(name, seed, meta):
    t = Tile(name, 64, 32, False, False)
    rs = np.random.RandomState(seed)
    wood, wood_lt, wood_dk = (84, 64, 46), (128, 104, 80), (40, 30, 22)
    iron, iron_lt, iron_dk = (58, 58, 68), (112, 112, 126), (26, 26, 34)
    rust = (112, 62, 34)
    # posts: left one intact with an iron finial, right one snapped off
    for (px, top, broken) in ((7, 5, False), (55, 15, True)):
        if broken:
            pts = [(px - 2.5, 32), (px + 2.5, 32), (px + 2.8, top + 3), (px + 0.5, top), (px - 1.5, top + 2.5), (px - 2.8, top + 1)]
        else:
            pts = [(px - 2.5, 32), (px + 2.5, 32), (px + 2.5, top + 2), (px, top), (px - 2.5, top + 2)]
        t.poly(pts, wood, dome=2.2, ks=0.1)
        for gx in (px - 1.4, px + 0.4, px + 1.6):
            t.line([(gx, 31), (gx + rs.uniform(-0.3, 0.3), top + 3)], wood_dk, width=0.5, hf=-0.3, alpha=150)
        t.line([(px - 1.9, 31), (px - 1.9, top + 3)], wood_lt, width=0.6, alpha=120)
        if not broken:
            t.rect(px - 3.2, top + 2.5, px + 3.2, top + 5, iron, dome=1.0, ks=0.8)      # iron collar
            t.poly([(px - 2, top + 2.5), (px + 2, top + 2.5), (px, top - 3)], iron_lt, dome=1.0, ks=0.8)   # spike
            t.stroke((px + 1.5, top + 5), (px + 2, top + 12), 1.4, 0.3, rust, alpha=130)
        else:
            t.stroke((px - 0.5, top + 1), (px - 0.8, top + 6), 1.0, 0.3, mix(wood_lt, (200, 190, 170), 0.4), alpha=160)  # fresh split
        for (x, y) in [(px + rs.uniform(-2, 2), rs.uniform(24, 31)) for _ in range(3)]:
            t.ellipse(x, y, rs.uniform(1, 1.8), rs.uniform(0.7, 1.2), (70, 92, 48), alpha=170)   # moss at the base
    # top rail: runs from the left post, splinters off two thirds along
    r0, r1 = 9, 14
    t.poly([(2, r0), (41, r0 + 0.4), (44, r0 + 2.2), (40, r1 - 0.8), (42.5, r1 + 0.8), (2, r1)], wood, dome=1.8, ks=0.1)
    t.line([(3, r0 + 0.9), (40, r0 + 1.2)], wood_lt, width=0.6, alpha=140)
    t.line([(3, r1 - 0.8), (41, r1 - 0.5)], wood_dk, width=0.6, alpha=160)
    for k in range(3):
        t.line([(4 + k * 11 + rs.uniform(0, 4), r0 + 1.5 + k), (14 + k * 11 + rs.uniform(0, 4), r0 + 2.5 + k)], wood_dk, width=0.5, hf=-0.3, alpha=150)
    # loose end: splinters
    t.stroke((43.5, r0 + 2), (49, r0 + 0.5), 1.2, 0.2, wood_lt, hf=0.2)
    t.stroke((42, r1), (46.5, r1 + 1.5), 1.0, 0.2, wood_dk, hf=0.2)
    # lower rail: intact but sagging, nailed with iron straps
    y0 = 21
    t.poly([(2, y0), (64, y0 + 1.4), (64, y0 + 5.6), (2, y0 + 4.5)], mix(wood, wood_lt, 0.08), dome=1.8, ks=0.1)
    t.line([(3, y0 + 0.8), (63, y0 + 2.2)], wood_lt, width=0.6, alpha=140)
    t.line([(3, y0 + 3.8), (63, y0 + 4.9)], wood_dk, width=0.6, alpha=160)
    for k in range(5):
        t.line([(4 + k * 12 + rs.uniform(0, 3), y0 + 1.6 + rs.uniform(0, 1.5)), (12 + k * 12 + rs.uniform(0, 3), y0 + 2.2 + rs.uniform(0, 1.5))], wood_dk, width=0.5, hf=-0.3, alpha=150)
    for px in (7, 55):
        t.rect(px - 3.5, y0 - 0.5, px + 3.5, y0 + 6.2, iron, dome=0.8, ks=0.8)   # iron strap on each post
        t.line([(px - 3.3, y0), (px + 3.3, y0)], iron_lt, width=0.6, alpha=160)
        t.ellipse(px, y0 + 2.8, 0.9, 0.9, iron_lt, dome=0.5, ks=0.8)
        t.stroke((px + rs.uniform(-2, 2), y0 + 6), (px + rs.uniform(-2, 2), y0 + 11), 1.3, 0.3, rust, alpha=120)
    t.rect(4, r0 - 0.5, 10, r1 + 0.5, iron, dome=0.8, ks=0.8)
    t.ellipse(7, (r0 + r1) / 2, 0.9, 0.9, iron_lt, dome=0.5, ks=0.8)
    img, nmap = t.finish(round_r=3, shape_k=0.6, ambient=0.42, diffuse=0.92, ao=0.6, noise=0.1, tex_seed=seed, rim=0.35)
    return save_tile(t, img, nmap, meta, role='decoration', anchor='bottom')


# ------------------------------------------------------------ cloud platform ----

def cloud_platform(name, seed, meta):
    """Puffy walkable cumulus: overlapping lobes rendered as a sphere z-buffer, each pixel lit with
    the normal of the nearest lobe (crisp creases between billows), crown flattened into a walkable top."""
    w, h = 192, 64
    rs = np.random.RandomState(seed)
    W, H = w * SS, h * SS
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) / SS
    lobes = []
    x = rs.uniform(0, 10)
    while x < w:                                   # main row of billows
        r = rs.uniform(15, 22)
        lobes.append((x, 27 + rs.uniform(-3, 3), r))
        x += r * rs.uniform(0.8, 1.05)
    for _ in range(16):                            # crown lobes (their tops get flattened)
        lobes.append((rs.uniform(0, w), rs.uniform(15, 20), rs.uniform(8, 13)))
    for _ in range(20):                            # underside puffs
        lobes.append((rs.uniform(0, w), rs.uniform(36, 44), rs.uniform(7, 12)))
    squash = 0.7
    z = np.full((H, W), -1.0)
    nx = np.zeros((H, W)); ny = np.zeros((H, W)); nz = np.ones((H, W))
    for (bx, by, r) in lobes:
        for dx in (-w, 0, w):
            ddx, ddy = xx - bx - dx, yy - by
            d2 = (ddx * ddx + ddy * ddy) / (r * r)
            inside = d2 < 1
            zz = np.where(inside, np.sqrt(np.clip(1 - d2, 0, 1)) * r * squash, -1)
            win = zz > z
            z = np.where(win, zz, z)
            nx = np.where(win, ddx / r, nx)
            ny = np.where(win, ddy / r, ny)
            nz = np.where(win, np.sqrt(np.clip(1 - d2, 0, 1)) * 1.1, nz)
    a = (z > 0).astype(np.float64)
    # flattened crown: scalloped but walkable top line
    bumps = np.clip((fbm_1d(W, 18, octaves=2, persistence=0.4, seed=seed + 3) - 0.35) / 0.5, 0, 1) ** 0.7
    top = 12 - 3.5 * bumps + 0.5 * fbm_1d(W, 40, octaves=2, seed=seed + 4)
    a *= np.clip((yy - top[None, :]) / 1.0, 0, 1)
    plateau = np.clip(1 - (yy - top[None, :]) / 4.5, 0, 1)
    nx = nx * (1 - plateau); ny = ny * (1 - plateau) + (-0.35) * plateau; nz = nz * (1 - plateau) + 0.95 * plateau
    # ragged, wispy underside
    wisp = fbm_2d_tile(W, H, 20, 6, octaves=3, seed=seed + 8, wrap_y=False)
    under = np.clip(1 - (yy - 42 - wisp * 9) / 14, 0, 1) ** 1.4
    a = np.clip(a * under * 1.25, 0, 1)
    L = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9
    nx, ny, nz = nx / L, ny / L, nz / L
    # soften the normals a little so the lobes read painted rather than CG
    nx = gauss_wrap(nx, 0.8 * SS, True, False); ny = gauss_wrap(ny, 0.8 * SS, True, False); nz = gauss_wrap(nz, 0.8 * SS, True, False)
    L = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9
    nx, ny, nz = nx / L, ny / L, nz / L
    key = norm3((0.2, -0.85, 0.5))
    dif = np.clip(nx * key[0] + ny * key[1] + nz * key[2], 0, 1)
    zs = np.where(a > 0, z, 0)
    crease = np.clip((gauss_wrap(zs, 2.5 * SS, True, False) - zs) / 4.0, 0, 1)
    # colour: silver crowns, lavender bodies, violet-grey undersides
    grade = np.clip((yy - top[None, :] - 2) / 44, 0, 1)
    lit = np.array([240, 238, 250.0]); mid = np.array([170, 162, 206.0]); shd = np.array([80, 64, 118.0])
    lmix = np.clip(dif ** 1.1 * 1.25, 0, 1)[..., None]
    col = shd[None, None, :] * (1 - lmix) + lit[None, None, :] * lmix
    vmix = (0.35 + 0.65 * grade)[..., None]
    col = col * (1 - 0.45 * grade[..., None]) + mid[None, None, :] * (0.25 * grade[..., None])
    col = col * (1 - 0.55 * crease)[..., None] + shd[None, None, :] * (0.3 * crease)[..., None]
    col = col + np.array([30, 30, 20.0])[None, None, :] * (plateau * (a > 0) * np.clip(1 - (yy - top[None, :]) / 3.0, 0, 1))[..., None]
    fine = fbm_2d_tile(W, H, 12, 4, octaves=3, seed=seed + 9, wrap_y=False)
    col = col * (0.95 + 0.1 * fine)[..., None]
    a_soft = np.clip(gauss_wrap(a, 0.8 * SS, True, False), 0, 1)
    out = np.dstack([np.clip(col, 0, 255), a_soft * 255])
    img = downsample_wrap(out, SS, True, False)
    # normal map: lobe normals blended toward flat so Light2D does not over-sculpt the cloud
    nmap = encode_normal_map(nx * 0.7, ny * 0.7, np.sqrt(np.clip(1 - 0.49 * (nx * nx + ny * ny), 0, 1)), a_soft, SS)
    t = Tile(name, w, h, True, False)
    return save_tile(t, img, nmap, meta, role='platform', walk_top=10)


# -------------------------------------------------------------- backgrounds ----

def gblur(arr, r):
    """Gaussian blur of a float array that wraps horizontally."""
    if r <= 0:
        return arr.copy()
    pad = int(r * 3) + 2
    ext = np.concatenate([arr[:, -pad:], arr, arr[:, :pad]], axis=1)
    return gaussian_blur_array(ext, r)[:, pad:-pad]


def shift_up(a, k):
    out = np.empty_like(a)
    out[k:] = a[:-k]
    out[:k] = a[0]
    return out


def lobe_render(w, h, lobes, squash=0.7, wrap_x=True):
    """Sphere z-buffer of overlapping lobes (bx, by, r): returns depth z (>0 inside, -1 outside) and the
    image-space normal (nx, ny, nz) of the nearest lobe per pixel. Lobes wrap horizontally."""
    z = np.full((h, w), -1.0)
    nx = np.zeros((h, w)); ny = np.zeros((h, w)); nz = np.ones((h, w))
    for (bx, by, r) in lobes:
        for dx in ((-w, 0, w) if wrap_x else (0,)):
            cx = bx + dx
            x0, x1 = int(math.floor(cx - r)) - 1, int(math.ceil(cx + r)) + 2
            y0, y1 = int(math.floor(by - r)) - 1, int(math.ceil(by + r)) + 2
            x0, x1, y0, y1 = max(0, x0), min(w, x1), max(0, y0), min(h, y1)
            if x1 <= x0 or y1 <= y0:
                continue
            yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
            ddx, ddy = xx - cx, yy - by
            d2 = (ddx * ddx + ddy * ddy) / (r * r)
            zz = np.where(d2 < 1, np.sqrt(np.clip(1 - d2, 0, 1)) * r * squash, -1)
            win = zz > z[y0:y1, x0:x1]
            z[y0:y1, x0:x1] = np.where(win, zz, z[y0:y1, x0:x1])
            nx[y0:y1, x0:x1] = np.where(win, ddx / r, nx[y0:y1, x0:x1])
            ny[y0:y1, x0:x1] = np.where(win, ddy / r, ny[y0:y1, x0:x1])
            nz[y0:y1, x0:x1] = np.where(win, np.sqrt(np.clip(1 - d2, 0, 1)) * 1.1, nz[y0:y1, x0:x1])
    return z, nx, ny, nz


def shade_lobes(z, nx, ny, nz, alpha, lit, mid, shd, key=(0.2, -0.85, 0.5), soften=2.0, crease_r=10.0, crease_k=6.0,
                crease_dark=0.55, wrap_x=True, lit_gamma=1.3, mottle=0.12, seed=0):
    """Paint a lobe field: per-lobe normals (softened) lit from above with creases between billows."""
    nx = gauss_wrap(nx, soften, wrap_x, False); ny = gauss_wrap(ny, soften, wrap_x, False); nz = gauss_wrap(nz, soften, wrap_x, False)
    L = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9
    nx, ny, nz = nx / L, ny / L, nz / L
    k = norm3(key)
    dif = np.clip(nx * k[0] + ny * k[1] + nz * k[2], 0, 1)
    zs = np.where(alpha > 0, np.maximum(z, 0), 0)
    crease = np.clip((gauss_wrap(zs, crease_r, wrap_x, False) - zs) / crease_k, 0, 1)
    lit, mid, shd = (np.array(c, float) for c in (lit, mid, shd))
    lm = np.clip(dif ** lit_gamma * 1.15, 0, 1)[..., None]
    mm = np.clip(dif * 2.0, 0, 1)[..., None]
    col = shd[None, None, :] * (1 - mm) + mid[None, None, :] * mm
    col = col * (1 - lm) + lit[None, None, :] * lm
    col = col * (1 - crease_dark * crease)[..., None] + shd[None, None, :] * (crease_dark * 0.5 * crease)[..., None]
    # silver glint on the very crowns, deeper violet on faces turned down
    crown = np.clip(-ny - 0.55, 0, 1) * 2.0 * np.clip(nz, 0, 1)
    col = col + np.array([26, 26, 20.0])[None, None, :] * crown[..., None]
    down = np.clip(ny - 0.3, 0, 1)
    col = col * (1 - 0.35 * down)[..., None] + np.array(shd, float)[None, None, :] * (0.2 * down)[..., None]
    if mottle > 0:
        h, w = z.shape
        m = fbm_warp(w, h, 10, max(1, int(10 * h / w)), octaves=4, persistence=0.55, seed=seed + 23, warp=0.6)
        streak = fbm_2d(w, h, 60, max(1, int(8 * h / w)), octaves=2, seed=seed + 29)
        col = col * (1 + (m - 0.5) * 2 * mottle + (streak - 0.5) * mottle * 0.6)[..., None]
    return col


def cumulus_cluster(rs, cx, base_y, width, height, r_scale=1.0):
    """Lobes for one cumulus: a flat-ish base row of big billows with a cauliflower crown above."""
    lobes = []
    n = max(3, int(width / (60 * r_scale)))
    for i in range(n):
        t = (i + 0.5) / n
        x = cx - width / 2 + t * width + rs.uniform(-12, 12) * r_scale
        env = math.sin(math.pi * t) ** 0.6
        r = (38 + 42 * env) * r_scale * rs.uniform(0.85, 1.15)
        lobes.append((x, base_y - r * 0.75, r))
        # crown lobes stacked on top of this billow (two or three levels, never thin stalks)
        y, cr, cx_ = base_y - r * 0.75, r, x
        for lvl in range(rs.randint(2, 4)):
            cr = cr * rs.uniform(0.55, 0.75)
            if cr < 16 * r_scale or y - cr * 0.8 < base_y - height * env:
                break
            y -= cr * rs.uniform(0.65, 0.85)
            cx_ = cx_ + rs.uniform(-cr * 0.5, cr * 0.5)
            lobes.append((cx_, y, cr))
            if rs.rand() < 0.6:   # a neighbour lobe on the same level for a broader cauliflower
                lobes.append((cx_ + rs.choice([-1, 1]) * cr * rs.uniform(0.8, 1.2), y + cr * rs.uniform(0.1, 0.4), cr * rs.uniform(0.7, 0.95)))
    # a few small puffs at the sides and under the base
    for _ in range(max(2, n // 2)):
        side = rs.choice([-1, 1])
        lobes.append((cx + side * width * rs.uniform(0.4, 0.55), base_y - rs.uniform(10, 40) * r_scale, rs.uniform(18, 32) * r_scale))
    for _ in range(n):
        lobes.append((cx + rs.uniform(-width * 0.45, width * 0.45), base_y - rs.uniform(0, 12) * r_scale, rs.uniform(16, 30) * r_scale))
    return lobes


def feather_alpha(a, seed, w, h, blur=1.5, cells=48, strength=0.35, wrap_x=True):
    """Soften a hard lobe mask: blur plus noise-modulated edges so outlines read wispy, not CG."""
    soft = gauss_wrap(a, blur, wrap_x, False)
    fine = fbm_2d(w, h, cells, max(1, int(cells * h / w)), octaves=3, seed=seed)
    edge = np.clip(1 - soft, 0, 1) * np.clip(soft * 4, 0, 1)
    return np.clip(soft * (1 - strength * edge * (1.2 - fine * 1.6)), 0, 1)


def edge_fade(a, top=0, bottom=0):
    h = a.shape[0]
    ys = np.arange(h)[:, None].astype(float)
    m = np.ones_like(a)
    if top > 0:
        m = m * np.clip(ys / top, 0, 1)
    if bottom > 0:
        m = m * np.clip((h - 1 - ys) / bottom, 0, 1)
    return a * m


def gen_clouds_near(seed):
    w, h = 2048, 720
    rs = np.random.RandomState(seed)
    lobes = []
    xs = np.sort(rs.uniform(0, w, 7))
    for i, cx in enumerate(xs):
        width = rs.uniform(300, 560)
        base_y = rs.uniform(300, 560)
        lobes += cumulus_cluster(rs, cx, base_y, width, rs.uniform(150, 260), r_scale=rs.uniform(0.9, 1.25))
    for _ in range(6):                                    # small stray puffs high up and low down
        lobes += cumulus_cluster(rs, rs.uniform(0, w), rs.uniform(80, 680), rs.uniform(90, 170), rs.uniform(40, 80), r_scale=0.5)
    z, nx, ny, nz = lobe_render(w, h, lobes, squash=0.7)
    a = (z > 0).astype(np.float64)
    col = shade_lobes(z, nx, ny, nz, a, (234, 232, 246), (150, 142, 182), (56, 44, 86), soften=4.0, crease_r=14, crease_k=8, seed=seed)
    # cooler, darker toward the underside of every cluster: use depth of the lobe field below its crest
    ys = np.arange(h)[:, None].astype(float)
    under = np.clip(gauss_wrap(a, 18, True, False) - shift_up(gauss_wrap(a, 18, True, False), 30), 0, 1)
    col = col * (1 - 0.3 * under)[..., None] + np.array([70, 56, 108.0])[None, None, :] * (0.3 * under)[..., None]
    aa = feather_alpha(a, seed + 5, w, h, blur=1.6, cells=56, strength=0.5)
    # painterly halo: thin veil of cloud around the solid shapes
    halo = np.clip(gauss_wrap(a, 22, True, False) * 0.35 - aa * 0.35, 0, 1)
    rgb = col * aa[..., None] + np.array([150, 142, 190.0])[None, None, :] * (1 - aa)[..., None]
    aa = edge_fade(np.clip(aa + halo, 0, 1), top=40, bottom=40)
    img = rgba(rgb, aa * 255)
    return paint_grain(img, 0.02, 0.012, seed)


def gen_clouds_far(seed):
    w, h = 2048, 512
    rs = np.random.RandomState(seed)
    lobes = []
    wave = fbm_1d(w, 3, octaves=3, seed=seed + 2) * 120
    x = rs.uniform(0, 80)
    while x < w:
        width = rs.uniform(160, 300)
        base_y = 300 + wave[int(x) % w] + rs.uniform(-30, 30)
        lobes += cumulus_cluster(rs, x, base_y, width, rs.uniform(70, 130), r_scale=rs.uniform(0.5, 0.7))
        x += width * rs.uniform(0.55, 0.8)
    for _ in range(8):
        lobes += cumulus_cluster(rs, rs.uniform(0, w), rs.uniform(120, 220), rs.uniform(80, 150), rs.uniform(30, 60), r_scale=0.4)
    z, nx, ny, nz = lobe_render(w, h, lobes, squash=0.7)
    a = (z > 0).astype(np.float64)
    col = shade_lobes(z, nx, ny, nz, a, (196, 202, 234), (110, 118, 170), (56, 58, 106), soften=5.0, crease_r=10, crease_k=6, crease_dark=0.4, mottle=0.08, seed=seed)
    aa = feather_alpha(a, seed + 5, w, h, blur=3.0, cells=40, strength=0.45)
    halo = np.clip(gauss_wrap(a, 26, True, False) * 0.4 - aa * 0.4, 0, 1)
    rgb = col * aa[..., None] + np.array([110, 118, 170.0])[None, None, :] * (1 - aa)[..., None]
    aa = edge_fade(np.clip(aa * 0.9 + halo, 0, 1), top=40, bottom=50)
    img = rgba(rgb, aa * 255)
    return paint_grain(img, 0.015, 0.01, seed)


def gen_clouds_top(seed):
    """Cloud sea seen from above: rows of cumulus heads from far (top, pale) to near (bottom, big)."""
    w, h = 2048, 512
    rs = np.random.RandomState(seed)
    yy = np.arange(h)[:, None].astype(np.float64) * np.ones((1, w))
    out_rgb = np.zeros((h, w, 3))
    out_a = np.zeros((h, w))
    lit, mid, shd = (234, 232, 246), (150, 144, 188), (66, 54, 100)
    haze = np.array([150, 160, 208.0])
    rows = [(110, 0.42, 0.6), (195, 0.6, 0.4), (290, 0.8, 0.2), (400, 1.05, 0.0)]
    for (base_y, scale, far) in rows:
        wave = fbm_1d(w, 3, octaves=3, seed=seed + int(base_y)) * 40 - 20
        lobes = []
        x = rs.uniform(0, 60)
        while x < w:
            width = rs.uniform(140, 260) * scale
            lobes += cumulus_cluster(rs, x, base_y + wave[int(x) % w] + 40 * scale, width, rs.uniform(60, 110) * scale, r_scale=scale * 0.8)
            x += width * rs.uniform(0.5, 0.75)
        z, nx, ny, nz = lobe_render(w, h, lobes, squash=0.7)
        a = (z > 0).astype(np.float64)
        # everything below the row's crest is solid: a gentle slope so the base shades smoothly
        crest = base_y + wave[None, :] + 40 * scale
        solid = (yy > crest).astype(np.float64)
        zb = np.clip((yy - crest) / 60.0, 0, 1) * 30 * scale
        fill = (solid > 0) & (z <= 0)
        z = np.where(fill, zb, z)
        ny = np.where(fill, 0.25, ny); nx = np.where(fill, 0.0, nx); nz = np.where(fill, 0.97, nz)
        a = np.maximum(a, solid)
        col = shade_lobes(z, nx, ny, nz, a, lit, mid, shd, key=(0.25, -0.9, 0.45), soften=2.5 * scale + 1, crease_r=9 * scale + 3, crease_k=5 * scale + 2, mottle=0.08, seed=seed + int(base_y))
        col = col * (1 - far) + haze[None, None, :] * far
        fine = fbm_2d(w, h, 40, 10, octaves=3, seed=seed + int(base_y) + 7)
        col = col * (0.95 + 0.1 * fine)[..., None]
        aa = feather_alpha(a, seed + int(base_y), w, h, blur=1.2 + scale, cells=48, strength=0.3)
        aa = np.maximum(aa, solid)
        # drop shadow on the row behind
        sh = gauss_wrap(shift_up(aa, 1), 12, True, False) * 0.5 * (1 - aa)
        out_rgb = out_rgb * (1 - sh[..., None] * 0.8)
        out_rgb = out_rgb * (1 - aa[..., None]) + col * aa[..., None]
        out_a = np.maximum(out_a, aa)
    img = rgba(out_rgb, out_a * 255)
    return paint_grain(img, 0.02, 0.012, seed)


def gen_sky_high(seed):
    w, h = 2048, 1080
    rs = np.random.RandomState(seed)
    col = gradient_column(h, [(0, '#030210'), (0.3, '#090826'), (0.6, '#160f3a'), (0.85, '#261a52'), (1, '#33245e')])
    rgb = np.repeat(col[:, None, :], w, axis=1)
    atm = fbm_2d(w, h, 3, 2, octaves=3, seed=seed + 3)
    rgb *= (0.92 + 0.16 * atm)[..., None]
    ys = np.linspace(0, 1, h)[:, None]
    # faint aurora: vertical curtains drifting across a band
    curt = fbm_warp(w, h, 14, 2, octaves=5, persistence=0.6, seed=seed + 11, warp=0.9)
    curt = np.clip((curt - 0.42) / 0.35, 0, 1) ** 1.6
    streak = fbm_2d(w, h, 90, 2, octaves=2, seed=seed + 12)
    band_c = 0.42 + 0.06 * np.sin(np.linspace(0, 2 * math.pi, w, endpoint=False))[None, :]
    env = np.exp(-((ys - band_c) / 0.13) ** 2)
    aur = curt * (0.6 + 0.6 * streak) * env * 0.42
    teal, viol = np.array([70, 215, 170.0]), np.array([150, 80, 210.0])
    tt = np.clip((ys - band_c + 0.13) / 0.26, 0, 1)
    acol = teal[None, None, :] * (1 - tt)[..., None] + viol[None, None, :] * tt[..., None]
    rgb = rgb + acol * aur[..., None]
    # dense bright stars, a few with halos and colour
    stars = np.zeros((h, w))
    n = int(w * h * 0.0028)
    sx = rs.randint(0, w, n)
    sy = (rs.rand(n) ** 1.15 * h).astype(int)
    sb = rs.rand(n) ** 2.0
    np.add.at(stars, (sy, sx), 0.1 + 0.9 * sb)
    big = np.where(sb > 0.86)[0]
    for i in big:
        x, y = sx[i], sy[i]
        r = 1 + int(sb[i] > 0.95) + int(sb[i] > 0.985)
        for ddx in range(-r, r + 1):
            for ddy in range(-r, r + 1):
                if ddx == 0 and ddy == 0:
                    continue
                f = 0.4 / (1 + ddx * ddx + ddy * ddy)
                stars[min(h - 1, max(0, y + ddy)), (x + ddx) % w] += f * sb[i]
    # milky band of dust
    yc = 0.62 * h + 90 * np.sin(2 * math.pi * np.arange(w) / w + rs.uniform(0, 6))
    nm = int(n * 2.0)
    mx = rs.randint(0, w, nm)
    my = np.clip((yc[mx] + rs.randn(nm) * 110).astype(int), 0, h - 1)
    np.add.at(stars, (my, mx), rs.rand(nm) ** 2 * 0.25)
    mw = fbm_warp(w, h, 10, 5, octaves=5, persistence=0.6, seed=seed + 57, warp=0.8)
    yy = np.arange(h)[:, None]
    envm = np.exp(-((yy - yc[None, :]) / 120.0) ** 2)
    rgb += np.array([120, 125, 190.0])[None, None, :] * (np.clip((mw - 0.4) / 0.5, 0, 1) * envm * 0.16)[..., None]
    stars = np.clip(stars, 0, 1.5)
    rgb += np.array([232, 236, 255.0])[None, None, :] * (stars * 190)[..., None]
    warm = rs.rand(h, w) < 0.25
    cold = rs.rand(h, w) < 0.25
    rgb += np.array([35, -5, -45.0])[None, None, :] * (stars * warm)[..., None]
    rgb += np.array([-30, 0, 40.0])[None, None, :] * (stars * cold)[..., None]
    img = rgba(rgb, np.full((h, w), 255.0))
    return paint_grain(img, 0.02, 0.012, seed).convert('RGB')


def gen_moon_big(seed, size=420):
    r = 128
    img = new_rgba(size, size)
    glow = multiply_alpha(soft_disc(size, '#9aa6d8', inner=0.0, power=2.6), 0.55)
    img.alpha_composite(glow)
    glow2 = multiply_alpha(soft_disc(int(r * 2.9), '#b8c2ec', inner=0.12, power=1.6), 0.5)
    img.alpha_composite(glow2, (int(size / 2 - r * 1.45), int(size / 2 - r * 1.45)))
    ring = multiply_alpha(soft_disc(int(r * 3.1), '#c8d0ff', inner=0.9, power=1.0), 0.07)
    img.alpha_composite(ring, (int(size / 2 - r * 1.55), int(size / 2 - r * 1.55)))
    disc = new_rgba(size, size)
    d = ImageDraw.Draw(disc)
    c = size / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=hex2rgb('#eee9d8') + (255,))
    rs = np.random.RandomState(seed)
    n = fbm_warp(size, size, 5, 5, octaves=6, persistence=0.55, seed=seed, warp=0.9)
    n2 = fbm_2d(size, size, 40, 40, octaves=4, seed=seed + 4, wrap_x=False)
    y, x = np.mgrid[0:size, 0:size]
    rr = np.sqrt((x - c) ** 2 + (y - c) ** 2) / r
    shade = 0.86 + 0.14 * n + 0.08 * (n2 - 0.5)
    # maria: large dark basaltic plains with soft edges, slightly blue-grey
    maria = np.clip((n - 0.5) / 0.16, 0, 1) ** 0.8
    shade *= 1 - 0.3 * maria
    tint = np.ones((size, size, 3))
    tint[..., 0] -= 0.05 * maria; tint[..., 2] += 0.04 * maria
    # craters: dark floor, lit rim on the side facing the key light, a few bright ray systems
    for i in range(20):
        a = rs.uniform(0, 2 * math.pi); d0 = rs.uniform(0, 0.9) * r
        cx, cy = c + math.cos(a) * d0, c + math.sin(a) * d0
        cr = rs.uniform(3, r * 0.11) if i > 3 else rs.uniform(r * 0.1, r * 0.16)
        dd = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / cr
        floor = np.clip(1 - dd, 0, 1) ** 0.35
        rim = np.clip(1 - np.abs(dd - 1.0) / 0.3, 0, 1)
        side = np.clip(((x - cx) * -0.6 + (y - cy) * -0.8) / cr, -1, 1)
        shade *= 1 - 0.22 * floor * (0.5 + 0.5 * side) * (1 - 0.4 * np.clip(1 - dd * 1.6, 0, 1))
        shade *= 1 + 0.12 * rim * (0.5 - 0.5 * side)
        shade *= 1 - 0.06 * rim * (0.5 + 0.5 * side)
        if i < 2:
            ang = np.arctan2(y - cy, x - cx)
            rays = np.clip(1 - dd / rs.uniform(4, 7), 0, 1) ** 2 * np.clip(np.cos(ang * rs.randint(7, 12) + rs.uniform(0, 6)), 0, 1) ** 8
            shade *= 1 + 0.12 * rays * (dd > 1.1)
    # speckle of tiny craters
    shade *= 1 - 0.08 * np.clip((n2 - 0.7) / 0.3, 0, 1)
    shade *= np.clip(1.08 - rr ** 3 * 0.5, 0, 1)
    # terminator: darker limb on the right (waxing gibbous feel)
    shade *= 1 - 0.24 * np.clip((x - c) / r * 0.8 + rr ** 2 * 0.5 - 0.25, 0, 1)
    shade = shade[..., None] * tint
    arr = np.array(disc).astype(float)
    arr[..., :3] *= shade
    disc = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA').filter(ImageFilter.GaussianBlur(0.7))
    img.alpha_composite(disc)
    return img


# ------------------------------------------------------------ floating ruins ----

class RuinCanvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.sil = Image.new('L', (w, h), 0)
        self.ds = ImageDraw.Draw(self.sil)
        self.det = new_rgba(w, h)
        self.dd = ImageDraw.Draw(self.det)
        self.windows = []
        self.roots = new_rgba(w, h)
        self.dr = ImageDraw.Draw(self.roots)


def ruin_break(C, rs, x0, x1, y_line, amp=26, roots=6):
    """Erase everything below a jagged break line between x0..x1 and hang roots/rubble from it."""
    pts = [(x0 - 10, C.h + 10), (x0 - 10, y_line)]
    xs = np.linspace(x0, x1, 14)
    jag = []
    for i, x in enumerate(xs):
        yv = y_line + rs.uniform(-amp, amp) * (0.4 + 0.6 * math.sin(math.pi * i / (len(xs) - 1)))
        jag.append((x, yv))
    pts += jag + [(x1 + 10, y_line), (x1 + 10, C.h + 10)]
    C.ds.polygon(pts, fill=0)
    # small notches up into the masonry
    for _ in range(4):
        x = rs.uniform(x0, x1)
        y = np.interp(x, [p[0] for p in jag], [p[1] for p in jag])
        C.ds.polygon([(x - rs.uniform(4, 9), y + 3), (x + rs.uniform(4, 9), y + 3), (x + rs.uniform(-4, 4), y - rs.uniform(3, 9))], fill=0)
    root_col = (10, 9, 13, 255)
    for _ in range(roots):
        x = rs.uniform(x0 + 8, x1 - 8)
        y = np.interp(x, [p[0] for p in jag], [p[1] for p in jag]) - 3
        L = rs.uniform(30, 75)
        wd = rs.uniform(2.5, 5)
        p = [(x, y)]
        ang = math.pi / 2 + rs.uniform(-0.4, 0.4)
        for k in range(5):
            ang += rs.uniform(-0.45, 0.45)
            seg = L / 5
            p.append((p[-1][0] + math.cos(ang) * seg, p[-1][1] + math.sin(ang) * seg))
        for k in range(len(p) - 1):
            draw_tapered_line(C.dr, p[k], p[k + 1], wd * (1 - k / 6), wd * (1 - (k + 1) / 6), root_col)
            if rs.rand() < 0.5:
                tip = (p[k][0] + rs.uniform(-14, 14), p[k][1] + rs.uniform(6, 18))
                draw_tapered_line(C.dr, p[k], tip, wd * 0.5, 0.5, root_col)
    # rubble: small floating stones drifting below the break
    for _ in range(rs.randint(5, 10)):
        x = rs.uniform(x0, x1)
        y = np.interp(x, [p[0] for p in jag], [p[1] for p in jag]) + rs.uniform(8, 40)
        s = rs.uniform(2, 7)
        poly = [(x + math.cos(a) * s * rs.uniform(0.7, 1.2), y + math.sin(a) * s * rs.uniform(0.6, 1.0)) for a in np.linspace(0, 2 * math.pi, 6, endpoint=False)]
        C.ds.polygon(poly, fill=255)


def ruin_window(C, rs, x, y, w, h, lit):
    """Pointed gothic window cut through the chunk (lit ones glow)."""
    col = (240, 160, 64, 255) if lit else (0, 0, 0, 0)
    pts = [(x - w, y + h), (x - w, y), (x, y - w * 1.7), (x + w, y), (x + w, y + h)]
    if lit:
        C.dd.polygon(pts, fill=col)
        C.windows.append((x, y + h * 0.5, w * 4 + h))
    else:
        C.ds.polygon(pts, fill=0)
        C.dd.polygon(pts, fill=(0, 0, 0, 0))
    # tracery
    C.dd.line([(x, y - w * 1.7 + 3), (x, y + h)], fill=(18, 18, 26, 255), width=2)


def gen_floating_ruin(kind, seed):
    w, h = 300, 220
    rs = np.random.RandomState(seed)
    C = RuinCanvas(w, h)
    ds, dd = C.ds, C.dd
    dark = (16, 15, 24, 255)
    if kind == 1:
        # wall fragment with a pointed window, a buttress and a broken battlement
        ds.rectangle([70, 40, 230, 150], fill=255)
        for k in range(6):                                   # crenellation, two merlons broken
            x = 72 + k * 27
            if k not in (2, 4):
                ds.rectangle([x, 28, x + 15, 42], fill=255)
            else:
                ds.polygon([(x, 42), (x + 15, 42), (x + 12, 34 + rs.uniform(0, 4)), (x + 3, 38)], fill=255)
        ds.polygon([(230, 150), (262, 150), (248, 90), (230, 70)], fill=255)   # buttress
        ds.rectangle([228, 60, 240, 150], fill=255)
        dd.line([(70, 46), (230, 46)], fill=dark, width=2)                  # string course
        ruin_window(C, rs, 150, 80, 11, 36, lit=True)
        ruin_window(C, rs, 100, 92, 6, 22, lit=False)
        ruin_window(C, rs, 200, 92, 6, 22, lit=False)
        ruin_break(C, rs, 70, 262, 148, amp=22, roots=7)
    elif kind == 2:
        # broken arch: two piers and a fragment of the span, a slab of floor hanging under it
        ds.rectangle([60, 70, 92, 150], fill=255)
        ds.rectangle([208, 60, 238, 150], fill=255)
        pts = []
        for i in range(11):
            t = i / 10 * 0.62
            a = math.pi - t * math.pi
            pts.append((150 + math.cos(a) * 60, 78 - math.sin(a) * 48))
        pts += [(150 + math.cos(math.pi - 0.62 * math.pi) * 42, 86 - math.sin(0.62 * math.pi) * 36)]
        for i in range(10, -1, -1):
            t = i / 10 * 0.62
            a = math.pi - t * math.pi
            pts.append((150 + math.cos(a) * 42, 82 - math.sin(a) * 34))
        ds.polygon(pts, fill=255)
        ds.polygon([(238, 60), (222, 32), (205, 60)], fill=255)   # pinnacle on the taller pier
        ds.rectangle([60, 150, 238, 170], fill=255)                 # floor slab joining the piers
        dd.line([(60, 152), (238, 152)], fill=dark, width=2)
        ruin_window(C, rs, 223, 100, 5, 22, lit=rs.rand() < 0.7)
        ruin_break(C, rs, 50, 245, 168, amp=18, roots=8)
    else:
        # tower top: crenellated drum with a torn conical roof section, one lit window
        ds.rectangle([110, 70, 200, 160], fill=255)
        for k in range(5):
            x = 108 + k * 19
            ds.rectangle([x, 58, x + 11, 72], fill=255)
        ds.polygon([(104, 60), (155, 6), (206, 60)], fill=255)
        ds.polygon([(104, 60), (206, 60), (210, 68), (100, 68)], fill=0)      # gap between roof and parapet
        ds.polygon([(155, 6), (160, 20), (190, 48), (206, 60), (178, 60)], fill=0)   # torn roof
        dd.polygon([(104, 60), (155, 6), (178, 60)], fill=(10, 10, 16, 255))
        for i in range(6):                                                  # slate lines
            dd.line([(120 + i * 7, 60 - i * 2), (155 - i * 3, 14 + i * 7)], fill=(24, 24, 34, 255), width=1)
        dd.line([(155, 6), (155, -6)], fill=(40, 40, 50, 255), width=2)
        dd.polygon([(155, -6), (165, -2), (155, 2)], fill=(120, 30, 40, 255))   # pennant
        ruin_window(C, rs, 155, 100, 8, 30, lit=True)
        ds.rectangle([196, 90, 222, 102], fill=255)                            # a jutting beam / gargoyle stub
        ds.polygon([(222, 90), (236, 86), (238, 98), (222, 102)], fill=255)
        ruin_break(C, rs, 108, 206, 158, amp=24, roots=6)
    # ---- stonework shading (same recipe as the structures layer)
    mask = mask_array(C.sil)
    hgt, sid = brick_height(w, h, course=7, brick=18, mortar=1.2, bevel=1.5, seed=seed + 2, chip=0.4)
    weather = fbm_warp(w, h, 8, 6, octaves=4, persistence=0.55, seed=seed + 8, warp=0.7)
    base, var = np.array(hex2rgb('#14151f'), float), np.array(hex2rgb('#22233a'), float)
    rgb = base[None, None, :] * (1 - sid[..., None] * 0.6) + var[None, None, :] * (sid[..., None] * 0.6)
    rgb = rgb * (0.85 + 0.35 * weather)[..., None]
    rgb = height_shade(rgb, hgt * 2.6, light=(0.4, -0.8), strength=0.45, ambient=1.0, lo=0.55, hi=1.6)
    rgb = rgb * (0.62 + 0.38 * hgt)[..., None]
    soft = gaussian_blur_array(mask, 7)
    gy2, gx2 = np.gradient(soft)
    side = np.clip(1 + (-(gx2 * 0.4 + gy2 * -0.8)) * 10, 0.6, 1.5)
    rgb = rgb * side[..., None]
    rim = rim_light(mask, light=(0.4, -0.8), width=2.0, power=1.2)
    rgb += np.array(hex2rgb('#9aa4cc'), float)[None, None, :] * (rim * 0.6)[..., None]
    # the underside (break face) is darker, cold ambient from the clouds below
    yy = np.arange(h)[:, None]
    rgb = rgb * (1 - np.clip((yy - 120) / 120, 0, 0.35))[..., None]
    img = rgba(rgb, mask * 255)
    img = Image.fromarray(np.array(img), 'RGBA')
    # roots sit behind the rubble but in front of the sky: composite under the masonry
    roots = C.roots.filter(ImageFilter.GaussianBlur(0.4))
    under = new_rgba(w, h)
    under.alpha_composite(roots)
    under.alpha_composite(img)
    under.alpha_composite(C.det)
    for (wx, wy, r) in C.windows:
        draw_glow_blob(under, wx, wy, r, r * 0.8, '#f0a040', alpha=0.3, power=2.2)
    # distance haze toward the high-sky violet
    f = np.full((h, w), 0.14)
    under = blend_toward(under, '#3a2e62', f)
    under = paint_grain(under, 0.03, 0.02, seed)
    return under.filter(ImageFilter.GaussianBlur(0.5))


# ---------------------------------------------------------------- previews ----

def preview_tiles(meta, out_dir):
    """Sheets for eyeballing: every tile repeated 3x3 (or 3x1) at 2x on a dark sky, plus a mock room."""
    mkdir(out_dir)
    bg = (24, 22, 40, 255)
    names = list(meta)
    cell = 64 * 3 * 2 + 16
    cols = 4
    rows = (len(names) + cols - 1) // cols
    sheet = new_rgba(cols * (cell + 20), rows * (cell + 30), bg)
    for i, n in enumerate(names):
        im = Image.open(os.path.join(WORLD, n + '.png'))
        w, h = im.size
        m = meta[n]
        rx = 3 if m['tile_x'] else 1
        ry = 3 if m['tile_y'] else 1
        if n.startswith('stair'):
            rx = ry = 3
        panel = new_rgba(w * rx, h * ry, (0, 0, 0, 0))
        for a in range(rx):
            for b in range(ry):
                if n.startswith('stair'):
                    panel.alpha_composite(im, (a * w, (ry - 1 - a) * h)) if b == 0 else None
                else:
                    panel.alpha_composite(im, (a * w, b * h))
        panel = panel.resize((panel.size[0] * 2, panel.size[1] * 2), Image.NEAREST)
        x, y = (i % cols) * (cell + 20) + 10, (i // cols) * (cell + 30) + 20
        sheet.alpha_composite(panel, (x, y))
        ImageDraw.Draw(sheet).text((x, y - 14), n, fill=(220, 220, 220, 255))
    sheet.save(os.path.join(out_dir, 'tiles_sheet.png'))
    # normal sheet
    sheet_n = new_rgba(cols * (cell + 20), rows * (cell + 30), bg)
    for i, n in enumerate(names):
        im = Image.open(os.path.join(WORLD, n + '_n.png'))
        panel = im.resize((im.size[0] * 2, im.size[1] * 2), Image.NEAREST)
        x, y = (i % cols) * (cell + 20) + 10, (i // cols) * (cell + 30) + 20
        sheet_n.alpha_composite(panel, (x, y))
    sheet_n.save(os.path.join(out_dir, 'tiles_normals.png'))
    # mock rooms at 1x
    for pal_name in ('stone', 'sky'):
        room = new_rgba(13 * 64, 8 * 64, bg)
        if pal_name == 'sky' and os.path.exists(os.path.join(COMMON, 'sky_high.webp')):
            sky = Image.open(os.path.join(COMMON, 'sky_high.webp')).convert('RGBA').crop((0, 300, 13 * 64, 300 + 8 * 64))
            room.alpha_composite(sky)
        get = lambda k: Image.open(os.path.join(WORLD, k + '.png'))
        fill, top, el, er = get(pal_name + '_fill'), get(pal_name + '_top'), get(pal_name + '_edge_l'), get(pal_name + '_edge_r')
        st = get('stair' if pal_name == 'stone' else 'stair_sky')
        ld = get('ladder' if pal_name == 'stone' else 'ladder_sky')
        # floor: two rows
        for c in range(13):
            room.alpha_composite(top, (c * 64, 6 * 64))
            room.alpha_composite(fill, (c * 64, 7 * 64))
        # left wall column with a top cap and a right edge
        for r in range(2, 6):
            room.alpha_composite(er, (0, r * 64))
        room.alpha_composite(top, (0, 1 * 64))
        # a ledge
        for c in range(7, 10):
            room.alpha_composite(top, (c * 64, 3 * 64))
            room.alpha_composite(fill, (c * 64, 4 * 64))
        room.alpha_composite(el, (6 * 64, 4 * 64)); room.alpha_composite(top, (6 * 64, 3 * 64))
        room.alpha_composite(er, (10 * 64, 4 * 64)); room.alpha_composite(top, (10 * 64, 3 * 64))
        # staircase from the floor up to the ledge
        room.alpha_composite(st, (3 * 64, 5 * 64)); room.alpha_composite(st, (4 * 64, 4 * 64)); room.alpha_composite(st, (5 * 64, 3 * 64))
        room.alpha_composite(fill, (4 * 64, 5 * 64)); room.alpha_composite(fill, (5 * 64, 4 * 64)); room.alpha_composite(fill, (5 * 64, 5 * 64))
        # ladder from the ledge upwards
        for r in range(0, 3):
            room.alpha_composite(ld, (8 * 64 + 8, r * 64))
        room.alpha_composite(get('rail'), (7 * 64, 3 * 64 - 32 + 6))
        if pal_name == 'sky':
            cp = get('cloud_platform')
            room.alpha_composite(cp, (11 * 64 - 32, 2 * 64)); room.alpha_composite(cp, (11 * 64 - 32 + 192, 2 * 64))
        room.save(os.path.join(out_dir, f'room_{pal_name}.png'))


def preview_bg(out_dir):
    mkdir(out_dir)
    sky = Image.open(os.path.join(COMMON, 'sky_high.webp')).convert('RGBA')
    view = sky.crop((300, 0, 300 + 1280, 720))
    far = Image.open(os.path.join(COMMON, 'clouds_far.webp')).convert('RGBA')
    near = Image.open(os.path.join(COMMON, 'clouds_near.webp')).convert('RGBA')
    top = Image.open(os.path.join(COMMON, 'clouds_top.webp')).convert('RGBA')
    moon = Image.open(os.path.join(COMMON, 'moon_big.png'))
    view.alpha_composite(moon, (780, -40))
    view.alpha_composite(far.crop((500, 0, 1780, 512)), (0, 150))
    view.alpha_composite(near.crop((200, 0, 1480, 720)), (0, 0))
    view.save(os.path.join(out_dir, 'bg_through_clouds.png'))
    view2 = sky.crop((900, 0, 900 + 1280, 720))
    view2.alpha_composite(moon, (200, 30))
    for i in range(1, 4):
        r = Image.open(os.path.join(COMMON, f'floating_ruin{i}.png'))
        view2.alpha_composite(r, (80 + (i - 1) * 400, 120 + (i % 2) * 60))
    view2.alpha_composite(top.crop((1100, 0, 2380, 512)), (0, 260))
    view2.save(os.path.join(out_dir, 'bg_above_clouds.png'))


# -------------------------------------------------------------------- main ----

def build_tiles():
    mkdir(WORLD)
    meta = {}
    print('tiles')
    stone_fill('stone_fill', MOOR, 101, meta)
    stone_top('stone_top', MOOR, 102, meta)
    stone_edge('stone_edge_l', MOOR, 103, meta, 'l')
    stone_edge('stone_edge_r', MOOR, 104, meta, 'r')
    stone_fill('sky_fill', SKY, 201, meta)
    stone_top('sky_top', SKY, 202, meta)
    stone_edge('sky_edge_l', SKY, 203, meta, 'l')
    stone_edge('sky_edge_r', SKY, 204, meta, 'r')
    cloud_platform('cloud_platform', 301, meta)
    ladder('ladder', 401, meta, sky=False)
    ladder('ladder_sky', 402, meta, sky=True)
    stair('stair', MOOR, 105, meta)
    stair('stair_sky', SKY, 205, meta)
    rail('rail', 501, meta)
    gate_edge('gate_edge', 603, meta)
    gate_slot('gate_slot', MOOR, 601, meta)
    gate_slot('gate_slot_sky', SKY, 602, meta)
    crack_wall('crack_wall', MOOR, 604, meta, stage=1)
    crack_wall('crack_wall2', MOOR, 605, meta, stage=2)
    crack_wall('crack_wall_sky', SKY, 606, meta, stage=1)
    crack_wall('crack_wall2_sky', SKY, 607, meta, stage=2)
    doc = dict(
        tile=64,
        notes='Normal maps are OpenGL convention (green up), flat = (128,128,255); tile_x/tile_y say which axes repeat '
              'seamlessly. stair tiles chain along the up-right diagonal (next tile +64 x, -64 y). cloud_platform repeats every 192 px; '
              'its walkable top is at walk_top px from the top of the sprite. ladder rungs repeat every 32 px vertically.',
        tiles=meta,
    )
    json.dump(doc, open(os.path.join(WORLD, 'tiles.json'), 'w'), indent=1)
    return meta


def build_backgrounds():
    mkdir(COMMON)
    print('backgrounds')
    files = {}

    def save_webp(img, key, rgb=False):
        path = os.path.join(COMMON, key + '.webp')
        (img.convert('RGB') if rgb else img).save(path, 'WEBP', quality=86, method=6)
        files[key] = dict(file=key + '.webp', w=img.size[0], h=img.size[1], alpha=not rgb, tile_x=True)
        print('  ', key, img.size)

    save_webp(gen_sky_high(7), 'sky_high', rgb=True)
    save_webp(gen_clouds_near(11), 'clouds_near')
    save_webp(gen_clouds_far(13), 'clouds_far')
    save_webp(gen_clouds_top(17), 'clouds_top')
    moon = gen_moon_big(19)
    moon.save(os.path.join(COMMON, 'moon_big.png'))
    files['moon_big'] = dict(file='moon_big.png', w=moon.size[0], h=moon.size[1], alpha=True, tile_x=False)
    print('   moon_big', moon.size)
    for i in (1, 2, 3):
        r = gen_floating_ruin(i, 700 + i)
        r.save(os.path.join(COMMON, f'floating_ruin{i}.png'))
        files[f'floating_ruin{i}'] = dict(file=f'floating_ruin{i}.png', w=r.size[0], h=r.size[1], alpha=True, tile_x=False)
        print(f'   floating_ruin{i}', r.size)
    doc = dict(
        notes='Backgrounds for the altitude bands. clouds_near is a parallax layer the player passes through (RGBA, gaps); '
              'clouds_far is a distant cloud sea; clouds_top is the view from above a cloud sea (bottom edge opaque, top transparent) '
              'and serves as the ground backdrop of the high-sky band; sky_high is the starfield behind everything above the clouds.',
        files=files,
    )
    json.dump(doc, open(os.path.join(COMMON, 'altitude.json'), 'w'), indent=1)


def main():
    preview = None
    if '--preview' in sys.argv:
        preview = sys.argv[sys.argv.index('--preview') + 1]
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
    if only in (None, 'bg'):
        build_backgrounds()
    if only in (None, 'tiles'):
        meta = build_tiles()
        if preview:
            preview_tiles(meta, preview)
    if preview and only in (None, 'bg'):
        preview_bg(preview)


if __name__ == '__main__':
    main()
