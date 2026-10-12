"""Generate rig body-part textures (+ normal maps), rig definitions, combat FX and world sprites.

Usage: python3 tools/gen_sprites.py [--preview DIR]
Outputs assets/sprites/rigs/*.png and *_n.png, assets/rigs/<character>.json, assets/rigs/manifest.json,
assets/sprites/fx/*.png and assets/sprites/world/*.png.

Rig conventions (shared with src/rig/Rig.js):
  * Every part is drawn in its own local frame with the joint (pivot) at a known pixel.
  * Limb parts hang DOWN from their pivot (angle 0 = straight down, positive = clockwise when
    facing right). The torso and head point UP from their pivot (hip / neck).
  * Characters face +x (right). The game flips the whole rig for left.
  * `at` is where a child's pivot sits in the parent's local frame (x right, y down, pixels).

Shading pipeline (Part.finish): every draw op paints albedo, a material id, a structural height and a
fine-detail height. finish() builds a height field (rounded silhouette from a distance transform +
plates + strands), derives normals, and lights the albedo with a warm key, ambient occlusion at
concavities, a per-material specular pass and a cool moon rim from the back. The same height field
is written out as an OpenGL-convention tangent-space normal map (`<name>_n.png`).
"""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from artlib import (hex2rgb, lerp_rgb, fbm_2d, draw_tapered_line, new_rgba, rgba, chamfer_dt, gauss_f,
                    height_to_normals, encode_normal_map, downsample_premultiplied)

ROOT = os.path.join(os.path.dirname(__file__), '..')
SPR = os.path.join(ROOT, 'assets', 'sprites', 'rigs')
RIGS = os.path.join(ROOT, 'assets', 'rigs')
FX = os.path.join(ROOT, 'assets', 'sprites', 'fx')
SS = 4  # supersampling factor (output sizes are unchanged)

# key light: mostly from above, a little from the front (+x); rim: cool moonlight from the back (-x)
KEY_DIR = (0.30, -0.80, 0.52)
RIM_DIR = (-0.82, -0.36, 0.34)
SPEC_COL = np.array([255, 244, 222], float)

MATS = ['fur', 'metal', 'bone', 'cloth', 'leather', 'horn', 'skin', 'wood', 'stone', 'glow', 'gold', 'rust', 'membrane']
MAT = {n: i for i, n in enumerate(MATS)}
# material: (specular strength, exponent, rim multiplier)
MAT_PROPS = {
    'fur': (0.05, 5, 1.0), 'metal': (0.95, 44, 1.6), 'bone': (0.30, 14, 1.0), 'cloth': (0.03, 3, 0.8),
    'leather': (0.30, 12, 1.0), 'horn': (0.55, 26, 1.2), 'skin': (0.18, 9, 0.9), 'wood': (0.12, 8, 0.8),
    'stone': (0.07, 5, 0.8), 'glow': (0.0, 1, 0.0), 'gold': (1.1, 30, 1.5), 'rust': (0.10, 6, 0.9),
    'membrane': (0.25, 10, 1.4),
}
MAT_KS = np.array([MAT_PROPS[n][0] for n in MATS])
MAT_EX = np.array([MAT_PROPS[n][1] for n in MATS], float)
MAT_RM = np.array([MAT_PROPS[n][2] for n in MATS])


def mkdir(p):
    os.makedirs(p, exist_ok=True)


def _norm3(v):
    v = np.array(v, float)
    return v / (np.linalg.norm(v) or 1)


def mul(c, k):
    return tuple(int(max(0, min(255, round(v * k)))) for v in c)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def add(c, d):
    return tuple(int(max(0, min(255, c[i] + d[i]))) for i in range(3))


# ----------------------------------------------------------------- canvas ----

class Part:
    """A part canvas at SS resolution. Coordinates given in 1x pixels relative to the pivot.
    Layers: albedo (RGBA), structural height hs (F, SS px), fine height hf (F, SS px), material id (L),
    emissive mask (L)."""

    def __init__(self, name, w, h, pivot, light=None, mat='fur'):
        self.name = name
        self.w, self.h = w, h
        self.pivot = pivot  # (px, py) in 1x pixels from top-left
        size = (w * SS, h * SS)
        self.img = Image.new('RGBA', size, (0, 0, 0, 0))
        self.hs = Image.new('F', size, 0.0)
        self.hf = Image.new('F', size, 0.0)
        self.mt = Image.new('L', size, 0)
        self.em = Image.new('L', size, 0)
        self._draws()
        self.mat = mat
        self.layers = []   # overlays drawn after shading: fn(draw, part)
        self.glows = []    # (x, y, r, color, strength) soft additive halos after shading
        self.rs = np.random.RandomState(sum(ord(c) for c in name))

    def _draws(self):
        self.d = ImageDraw.Draw(self.img)
        self.dhs = ImageDraw.Draw(self.hs)
        self.dhf = ImageDraw.Draw(self.hf)
        self.dmt = ImageDraw.Draw(self.mt)
        self.dem = ImageDraw.Draw(self.em)
        self._scratch = None

    # -- translucent painting: PIL replaces pixels on RGBA images, so semi-transparent strokes are
    #    drawn on a scratch layer that is alpha-composited onto the albedo.
    def begin_layer(self):
        if self._scratch is None:
            self._scratch = Image.new('RGBA', self.img.size, (0, 0, 0, 0))
            self.d = ImageDraw.Draw(self._scratch)

    def end_layer(self):
        if self._scratch is not None:
            self.img.alpha_composite(self._scratch)
            self._scratch = None
            self.d = ImageDraw.Draw(self.img)

    def _paint(self, fn, alpha):
        """Run fn(draw) with alpha blending when alpha < 255 (unless a batch layer is open)."""
        if alpha >= 255 or self._scratch is not None:
            fn(self.d)
        else:
            self.begin_layer(); fn(self.d); self.end_layer()

    # -- coordinates
    def P(self, x, y):
        return ((self.pivot[0] + x) * SS, (self.pivot[1] + y) * SS)

    def PP(self, pts):
        return [self.P(*p) for p in pts]

    # -- primitive application over all layers
    def _apply(self, shape, fill, mat, h, dome, alpha=255, em=0):
        """shape(draw, value) draws the geometry with the given fill onto any ImageDraw."""
        if fill is not None:
            self._paint(lambda d: shape(d, tuple(fill) + (alpha,)), alpha)
        if mat is not None or (fill is not None and alpha >= 255):
            shape(self.dmt, MAT[mat or self.mat])
        if h is not None:
            shape(self.dhs, float(h) * SS)
        if em:
            shape(self.dem, int(em))
        if dome:
            m = Image.new('L', self.img.size, 0)
            shape(ImageDraw.Draw(m), 255)
            mask = np.array(m) > 127
            if mask.any():
                dist = chamfer_dt(mask)
                R = max(1.0, dist.max())
                t = np.clip(dist / R, 0, 1)
                prof = np.sqrt(t * (2 - t)) * dome * SS
                hs = np.array(self.hs, np.float64)
                hs += prof * mask
                self.hs = Image.fromarray(hs.astype(np.float32), 'F')
                self._draws()

    def poly(self, pts, fill, mat=None, h=None, dome=0, alpha=255, em=0):
        P = self.PP(pts)
        self._apply(lambda d, v: d.polygon(P, fill=v), fill, mat, h, dome, alpha, em)

    def ellipse(self, cx, cy, rx, ry, fill, mat=None, h=None, dome=0, alpha=255, em=0):
        x, y = self.P(cx, cy)
        box = [x - rx * SS, y - ry * SS, x + rx * SS, y + ry * SS]
        self._apply(lambda d, v: d.ellipse(box, fill=v), fill, mat, h, dome, alpha, em)

    def limb(self, p0, p1, w0, w1, fill, mat=None, h=None, dome=0, alpha=255):
        a, b = self.P(*p0), self.P(*p1)
        self._apply(lambda d, v: draw_tapered_line(d, a, b, w0 * SS, w1 * SS, v), fill, mat, h, dome, alpha)

    def line(self, pts, fill, width=1, mat=None, h=None, alpha=255):
        P = self.PP(pts)
        wd = max(1, int(round(width * SS)))
        if fill is not None:
            self._paint(lambda d: d.line(P, fill=tuple(fill) + (alpha,), width=wd), alpha)
        if mat is not None:
            self.dmt.line(P, fill=MAT[mat], width=wd)
        if h is not None:
            self.dhf.line(P, fill=float(h) * SS, width=wd)

    def stroke(self, p0, p1, w0, w1, fill, h=None, alpha=255, mat=None):
        """Fine tapered stroke: albedo + fine height (no structural height)."""
        a, b = self.P(*p0), self.P(*p1)
        if fill is not None:
            self._paint(lambda d: draw_tapered_line(d, a, b, w0 * SS, w1 * SS, tuple(fill) + (alpha,)), alpha)
        if mat is not None:
            draw_tapered_line(self.dmt, a, b, w0 * SS, w1 * SS, MAT[mat])
        if h is not None:
            draw_tapered_line(self.dhf, a, b, w0 * SS, w1 * SS, float(h) * SS)

    def dot(self, cx, cy, r, fill, h=None, mat=None, alpha=255):
        x, y = self.P(cx, cy)
        box = [x - r * SS, y - r * SS, x + r * SS, y + r * SS]
        if fill is not None:
            self._paint(lambda d: d.ellipse(box, fill=tuple(fill) + (alpha,)), alpha)
        if mat is not None:
            self.dmt.ellipse(box, fill=MAT[mat])
        if h is not None:
            self.dhf.ellipse(box, fill=float(h) * SS)

    def shade(self, pts, color, alpha=90, h=None):
        """Painted translucent shadow/highlight polygon (albedo only, optional fine height)."""
        self.poly(pts, color, mat=None, h=None, alpha=alpha)
        if h is not None:
            self.dhf.polygon(self.PP(pts), fill=float(h) * SS)

    def shade_ellipse(self, cx, cy, rx, ry, color, alpha=90):
        self.ellipse(cx, cy, rx, ry, color, mat=None, alpha=alpha)

    def erase(self, pts):
        P = self.PP(pts)
        self.end_layer()
        self.d.polygon(P, fill=(0, 0, 0, 0))
        self.dmt.polygon(P, fill=0)
        self.dhs.polygon(P, fill=0.0)
        self.dhf.polygon(P, fill=0.0)
        self.dem.polygon(P, fill=0)

    def glow(self, cx, cy, rx, ry, color, halo=2.5, strength=0.9):
        """Emissive ellipse (unshaded) plus a soft additive halo."""
        self.ellipse(cx, cy, rx, ry, color, mat='glow', em=255)
        self.glows.append((cx, cy, max(rx, ry) * halo, color, strength))

    def overlay(self, fn):
        self.layers.append(fn)

    def mask(self, pts):
        m = Image.new('L', self.img.size, 0)
        ImageDraw.Draw(m).polygon(self.PP(pts), fill=255)
        return np.array(m) > 127

    def inside(self, x, y):
        X, Y = self.P(x, y)
        if 0 <= int(X) < self.img.size[0] and 0 <= int(Y) < self.img.size[1]:
            return self.img.getpixel((int(X), int(Y)))[3] > 0
        return False

    # -- lighting
    def finish(self, outline=(22, 16, 18), outline_w=1.0, round_r=10, shape_k=0.8, ambient=0.42, diffuse=0.92,
               ao=0.6, rim=0.5, rim_color=(120, 150, 215), noise=0.06, glow=None, key=KEY_DIR, spec=1.0,
               tex_seed=0, nstrength=1.0, wrap_x=False, **_ignored):
        """Light the part. Returns (colour image, normal map image) at 1x."""
        self.end_layer()
        W, H = self.img.size
        arr = np.array(self.img).astype(np.float64)
        alb = arr[..., :3]
        a = arr[..., 3] / 255.0
        hs = np.array(self.hs, np.float64)
        hf = np.array(self.hf, np.float64)
        mt = np.array(self.mt)
        em = np.array(self.em, np.float64) / 255.0
        # -- outline: dilated alpha, dark tinted colour under the AA edge
        k = max(1, int(round(outline_w * SS)))
        if outline is not None and outline_w > 0:
            dil = np.array(self.img.getchannel('A').filter(ImageFilter.MaxFilter(2 * k + 1)), np.float64) / 255.0
        else:
            dil = a.copy()
        inside = a > 0.05
        mean_alb = alb[inside].mean(axis=0) if inside.any() else np.array(outline or (0, 0, 0), float)
        oc = np.array(outline or (0, 0, 0), float) * 0.62 + mean_alb * 0.38 * 0.42
        alb_full = alb * a[..., None] + oc[None, None, :] * (1 - a)[..., None]
        a_full = np.maximum(dil, a)
        # -- height field: rounded silhouette + structural plates + fine strands
        mask = a_full > 0.5
        dist = chamfer_dt(mask) if mask.any() else np.zeros_like(a_full)
        Rr = float(max(1.0, min(dist.max(), round_r * SS)))
        t = np.clip(dist / Rr, 0, 1)
        hsh = Rr * np.sqrt(t * (2 - t)) * shape_k
        h = hsh + gauss_f(hs, 1.2 * SS) + gauss_f(hf, 0.45 * SS)
        nx, ny, nz = height_to_normals(h, nstrength, wrap_x)
        # -- diffuse (wrapped lambert)
        L = _norm3(key)
        dif = nx * L[0] + ny * L[1] + nz * L[2]
        dif = np.clip((dif + 0.28) / 1.28, 0, 1)
        # -- ambient occlusion from concavities (two scales)
        occ = np.zeros_like(h)
        for s, wgt in ((1.6 * SS, 0.55), (4.5 * SS, 0.45)):
            occ += wgt * np.clip((gauss_f(h, s) - h) / (s * 0.55), 0, 1)
        aof = 1 - ao * np.clip(occ, 0, 1)
        # -- specular per material
        ks = MAT_KS[mt]; ex = MAT_EX[mt]; rm = MAT_RM[mt]
        Hv = _norm3(L + np.array([0, 0, 1.0]))
        ndh = np.clip(nx * Hv[0] + ny * Hv[1] + nz * Hv[2], 0, 1)
        sp = (ks * np.power(ndh, ex) + ks * 0.16 * ndh ** 3) * spec * aof
        # -- cool rim from the back edge
        Rd = _norm3(RIM_DIR)
        rv = np.clip(nx * Rd[0] + ny * Rd[1] + nz * Rd[2], 0, 1) ** 3.2 * rim * rm
        # -- subtle colour variation
        n1 = fbm_2d(W, H, max(1, W // (10 * SS)), max(1, H // (10 * SS)), octaves=4, seed=tex_seed, wrap_x=wrap_x)
        n2 = fbm_2d(W, H, max(1, W // (2 * SS)), max(1, H // (2 * SS)), octaves=2, seed=tex_seed + 77, wrap_x=wrap_x)
        alb_v = alb_full * (1 + (n1[..., None] - 0.5) * 2 * noise + (n2[..., None] - 0.5) * noise)
        alb_v = alb_v + (n1[..., None] - 0.5) * noise * np.array([90, 30, -70])[None, None, :]
        lit = (ambient + diffuse * dif) * aof
        col = alb_v * lit[..., None] + SPEC_COL[None, None, :] * sp[..., None] + np.array(rim_color, float)[None, None, :] * rv[..., None]
        col = col * (1 - em)[..., None] + alb_full * 1.12 * em[..., None]
        out = np.dstack([np.clip(col, 0, 255), a_full * 255])
        img = Image.fromarray(out.astype(np.uint8), 'RGBA')
        for fn in self.layers:
            fn(ImageDraw.Draw(img), self)
        arr = np.array(img).astype(np.float64)
        if self.glows:
            yy, xx = np.mgrid[0:H, 0:W]
            for (gx, gy, gr, gcol, gs) in self.glows:
                X, Y = self.P(gx, gy)
                dd = np.sqrt((xx - X) ** 2 + (yy - Y) ** 2) / (gr * SS)
                g = np.clip(1 - dd, 0, 1) ** 2.2 * gs
                arr[..., :3] += np.array(gcol, float)[None, None, :] * g[..., None] * (0.55 + 0.45 * (arr[..., 3] / 255))[..., None]
                arr[..., 3] = np.maximum(arr[..., 3], g * 255 * 0.85)
            arr = np.clip(arr, 0, 255)
        if glow is not None:
            gcol, radius, strength = glow
            ga = gauss_f(arr[..., 3], radius * SS) * strength
            base = np.dstack([np.ones((H, W, 3)) * np.array(gcol, float)[None, None, :], np.clip(ga, 0, 255)])
            top = Image.fromarray(arr.astype(np.uint8), 'RGBA')
            under = Image.fromarray(base.astype(np.uint8), 'RGBA')
            under.alpha_composite(top)
            arr = np.array(under).astype(np.float64)
        colour = downsample_premultiplied(arr, SS)
        nmap = encode_normal_map(nx, ny, nz, arr[..., 3] / 255.0, SS)
        return colour, nmap


def save_part(part, outdir, **kw):
    img, nmap = part.finish(**kw)
    img.save(os.path.join(outdir, part.name + '.png'))
    nmap.save(os.path.join(outdir, part.name + '_n.png'))
    return img


# ------------------------------------------------------------ detail brushes ----

def rand_pts(part, pts, n, rs, margin=0.0):
    """n random (x, y) 1x-coordinates inside polygon pts."""
    m = part.mask(pts)
    if margin > 0:
        m = np.array(Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(2 * int(margin * SS) + 1))) > 127
    idx = np.argwhere(m)
    if len(idx) == 0:
        return []
    sel = idx[rs.randint(0, len(idx), n)]
    return [(x / SS - part.pivot[0], y / SS - part.pivot[1]) for y, x in sel]


def fur(part, pts, n, length, angle, spread, light, dark, seed=0, width=1.3, h=0.14, grad=None, alpha=215, mat='fur'):
    """Directional fur strands inside polygon pts. angle in degrees (0 = +x, 90 = down).
    grad: optional fn(x, y) -> 0..1 mixing dark(0) to light(1) base tone."""
    rs = np.random.RandomState(seed)
    W, H = part.img.size
    clump = fbm_2d(W, H, max(1, W // (5 * SS)), max(1, H // (5 * SS)), octaves=2, seed=seed + 500, wrap_x=False)
    part.begin_layer()
    for (x, y) in rand_pts(part, pts, n, rs):
        a = math.radians(angle + rs.normal(0, spread))
        L = length * rs.uniform(0.6, 1.5)
        base = grad(x, y) if grad else 0.5
        X, Y = part.P(x, y)
        cl = clump[min(H - 1, max(0, int(Y))), min(W - 1, max(0, int(X)))] - 0.5
        tone = np.clip(base + cl * 0.9 + rs.normal(0, 0.18), 0, 1)
        col = mix(dark, light, tone)
        hv = (tone - 0.5) * 2 * h
        # slight curve: two segments
        mx, my = x + math.cos(a) * L * 0.5, y + math.sin(a) * L * 0.5
        a2 = a + rs.normal(0, 0.25)
        ex, ey = mx + math.cos(a2) * L * 0.5, my + math.sin(a2) * L * 0.5
        part.stroke((x, y), (mx, my), width, width * 0.7, col, hv, alpha, mat)
        part.stroke((mx, my), (ex, ey), width * 0.7, 0.25, col, hv, alpha, mat)
    part.end_layer()


def tufts(part, edge, n, length, out_angle, color, dark=None, seed=0, lean=0.0, width=3.0, h=0.5, mat='fur', spread=14):
    """Spiky fur tufts along a polyline edge pointing out at out_angle (deg)."""
    rs = np.random.RandomState(seed)
    segs = []
    total = 0
    for i in range(len(edge) - 1):
        L = math.hypot(edge[i + 1][0] - edge[i][0], edge[i + 1][1] - edge[i][1])
        segs.append(L); total += L
    for i in range(n):
        s = (i + rs.uniform(0.2, 0.8)) / n * total
        acc = 0
        for j, L in enumerate(segs):
            if acc + L >= s or j == len(segs) - 1:
                t = (s - acc) / (L or 1)
                x = edge[j][0] + (edge[j + 1][0] - edge[j][0]) * t
                y = edge[j][1] + (edge[j + 1][1] - edge[j][1]) * t
                tx, ty = (edge[j + 1][0] - edge[j][0]) / (L or 1), (edge[j + 1][1] - edge[j][1]) / (L or 1)
                break
            acc += L
        a = math.radians(out_angle + rs.normal(0, spread) + lean)
        Lt = length * rs.uniform(0.6, 1.4)
        tip = (x + math.cos(a) * Lt, y + math.sin(a) * Lt)
        wd = width * rs.uniform(0.7, 1.2)
        b0 = (x - tx * wd / 2, y - ty * wd / 2)
        b1 = (x + tx * wd / 2, y + ty * wd / 2)
        col = color if dark is None or rs.rand() < 0.6 else dark
        part.poly([b0, tip, b1], col, mat=mat, h=h * rs.uniform(0.5, 1.0))
        part.stroke(((b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2), tip, wd * 0.35, 0.2, mix(col, (255, 245, 230), 0.25), alpha=150)


def plate(part, pts, fill, h=1.0, mat='metal', bevel=0.9, seam=True, seam_col=None, light=None, dark=None):
    """Armour plate: raised polygon with a dark seam and painted bevel lines on edges facing the key light."""
    part.poly(pts, fill, mat=mat, h=h)
    n = len(pts)
    lc = light or mul(fill, 1.35)
    dc = dark or mul(fill, 0.55)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    for i in range(n):
        p0, p1 = pts[i], pts[(i + 1) % n]
        ex, ey = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(ex, ey) or 1
        nx, ny = -ey / L, ex / L
        # orient outward
        mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
        if (mx - cx) * nx + (my - cy) * ny < 0:
            nx, ny = -nx, -ny
        f = nx * -0.35 + ny * -0.9
        ins = bevel * 0.9
        q0 = (p0[0] - nx * ins, p0[1] - ny * ins)
        q1 = (p1[0] - nx * ins, p1[1] - ny * ins)
        if f > 0.25:
            part.line([q0, q1], lc, width=bevel * 0.8, alpha=200)
        elif f < -0.25:
            part.line([q0, q1], dc, width=bevel * 0.8, alpha=170)
    if seam:
        sc = seam_col or mul(fill, 0.32)
        part.line(pts + [pts[0]], sc, width=0.7, h=-0.6, alpha=230)


def rivets(part, pts, r, fill, seed=0):
    rs = np.random.RandomState(seed)
    for (x, y) in pts:
        part.dot(x, y, r, mul(fill, 0.55), h=None)
        part.dot(x - r * 0.15, y - r * 0.2, r * 0.8, mix(fill, (255, 250, 240), 0.18), h=r * 1.3, mat='metal')
        part.dot(x - r * 0.3, y - r * 0.35, r * 0.3, mix(fill, (255, 255, 255), 0.6))


def studs(part, pts, pitch, r, fill, seed=0, offset=(0, 0)):
    """Grid of rivets inside polygon pts."""
    m = part.mask(pts)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    out = []
    row = 0
    y = min(ys) + pitch * 0.5 + offset[1]
    while y < max(ys):
        x = min(xs) + pitch * 0.5 + offset[0] + (pitch * 0.5 if row % 2 else 0)
        while x < max(xs):
            X, Y = part.P(x, y)
            if 0 <= int(Y) < m.shape[0] and 0 <= int(X) < m.shape[1] and m[int(Y), int(X)]:
                # require margin
                ok = all(m[min(m.shape[0] - 1, max(0, int(Y + dy))), min(m.shape[1] - 1, max(0, int(X + dx)))]
                         for dx in (-r * SS * 1.5, r * SS * 1.5) for dy in (-r * SS * 1.5, r * SS * 1.5))
                if ok:
                    out.append((x, y))
            x += pitch
        y += pitch * 0.87
        row += 1
    rivets(part, out, r, fill, seed)


def scratches(part, pts, n, seed, light, dark, length=5, h=-0.3, width=0.6):
    rs = np.random.RandomState(seed)
    for (x, y) in rand_pts(part, pts, n, rs, margin=1):
        a = rs.uniform(0, math.pi)
        L = length * rs.uniform(0.4, 1.3)
        dx, dy = math.cos(a) * L, math.sin(a) * L
        part.line([(x - dx, y - dy), (x + dx, y + dy)], dark, width=width, h=h, alpha=180)
        part.line([(x - dx, y - dy - 0.5), (x + dx, y + dy - 0.5)], light, width=width * 0.8, alpha=150)


def dents(part, pts, n, seed, fill, r=2.2):
    rs = np.random.RandomState(seed)
    for (x, y) in rand_pts(part, pts, n, rs, margin=2):
        rr = r * rs.uniform(0.6, 1.3)
        part.ellipse(x, y, rr, rr * 0.75, mul(fill, 0.78), h=None)
        part.dot(x, y, rr * 0.9, None, h=-rr * 0.9)
        part.dot(x + rr * 0.3, y + rr * 0.3, rr * 0.5, mix(fill, (255, 255, 255), 0.12))


def chainmail(part, pts, base, light, dark, pitch=2.0, seed=0, mat='metal'):
    """Fine ring texture inside polygon pts."""
    part.poly(pts, base, mat=mat)
    m = part.mask(pts)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    rs = np.random.RandomState(seed)
    r = pitch * 0.55
    row = 0
    y = min(ys) + pitch * 0.4
    while y < max(ys):
        x = min(xs) + pitch * 0.4 + (pitch * 0.5 if row % 2 else 0)
        while x < max(xs):
            X, Y = part.P(x, y)
            if 0 <= int(Y) < m.shape[0] and 0 <= int(X) < m.shape[1] and m[int(Y), int(X)]:
                part.dot(x, y, r, dark)
                part.d.arc([X - r * SS, Y - r * SS, X + r * SS, Y + r * SS], 190, 330, fill=tuple(light) + (255,), width=max(1, int(0.55 * SS)))
                part.dot(x, y, r * 0.75, None, h=0.45)
            x += pitch
        y += pitch * 0.82
        row += 1


def cracks(part, pts, n, seed, color, length=6, h=-0.4, width=0.6, steps=5, alpha=220):
    rs = np.random.RandomState(seed)
    for (x, y) in rand_pts(part, pts, n, rs, margin=1):
        a = rs.uniform(0, 2 * math.pi)
        path = [(x, y)]
        for s in range(steps):
            a += rs.normal(0, 0.7)
            L = length / steps * rs.uniform(0.5, 1.5)
            x, y = x + math.cos(a) * L, y + math.sin(a) * L
            path.append((x, y))
        for i in range(len(path) - 1):
            w = width * (1 - i / len(path) * 0.7)
            part.stroke(path[i], path[i + 1], w, w * 0.6, color, h, alpha)
        # occasional branch
        if rs.rand() < 0.5 and len(path) > 2:
            bx, by = path[len(path) // 2]
            ba = a + rs.choice([-1, 1]) * rs.uniform(0.6, 1.4)
            part.stroke((bx, by), (bx + math.cos(ba) * length * 0.4, by + math.sin(ba) * length * 0.4), width * 0.7, 0.2, color, h, alpha)


def folds(part, lines, dark, light=None, width=1.2, h=-0.5, alpha=200):
    """Cloth folds: dark tapered creases with a light edge."""
    for (p0, p1) in lines:
        part.stroke(p0, p1, width, width * 0.4, dark, h, alpha)
        if light is not None:
            off = (0.8, 0)
            part.stroke((p0[0] + off[0], p0[1]), (p1[0] + off[0], p1[1]), width * 0.6, 0.2, light, -h * 0.5, int(alpha * 0.6))


def tatter(part, edge, seed, depth=4, n=8, holes=0, region=None):
    """Erase ragged triangles along the polyline edge (and optional holes inside region)."""
    rs = np.random.RandomState(seed)
    for i in range(len(edge) - 1):
        (x0, y0), (x1, y1) = edge[i], edge[i + 1]
        L = math.hypot(x1 - x0, y1 - y0)
        k = max(1, int(L / 5))
        for j in range(k):
            t0 = j / k; t1 = (j + rs.uniform(0.3, 0.9)) / k
            px0, py0 = x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0
            px1, py1 = x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1
            mx, my = (px0 + px1) / 2, (py0 + py1) / 2
            nx, ny = -(y1 - y0) / (L or 1), (x1 - x0) / (L or 1)
            d = depth * rs.uniform(0.3, 1.2)
            # notch points inward (opposite outward normal: assume edge traverses with inside to the left)
            part.erase([(px0, py0), (mx - nx * d, my - ny * d), (px1, py1)])
    if holes and region:
        for (x, y) in rand_pts(part, region, holes, rs, margin=2):
            r = rs.uniform(0.8, 1.8)
            pts = [(x + math.cos(a) * r * rs.uniform(0.6, 1.4), y + math.sin(a) * r * rs.uniform(0.6, 1.4)) for a in np.linspace(0, 2 * math.pi, 6, endpoint=False)]
            part.erase(pts)


def wraps(part, p0, p1, width, n, color, dark, light=None, h=0.5, mat='cloth', tilt=0.35):
    """Diagonal cloth/leather wrap bands along a limb axis p0->p1."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy) or 1
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    for i in range(n):
        t = (i + 0.5) / n
        cx, cy = p0[0] + ux * L * t, p0[1] + uy * L * t
        bw = L / n * 0.55
        s = tilt * bw
        a = (cx + nx * width / 2 - ux * bw / 2 - ux * s, cy + ny * width / 2 - uy * bw / 2 - uy * s)
        b = (cx + nx * width / 2 + ux * bw / 2 - ux * s, cy + ny * width / 2 + uy * bw / 2 - uy * s)
        c = (cx - nx * width / 2 + ux * bw / 2 + ux * s, cy - ny * width / 2 + uy * bw / 2 + uy * s)
        d = (cx - nx * width / 2 - ux * bw / 2 + ux * s, cy - ny * width / 2 - uy * bw / 2 + uy * s)
        part.poly([a, b, c, d], color, mat=mat, h=h)
        part.line([b, c], dark, width=0.6, h=-0.4, alpha=200)
        if light:
            part.line([a, d], light, width=0.5, alpha=140)


def chain(part, path, link=2.2, color=(120, 118, 124), dark=(40, 38, 44), seed=0):
    """Chain links along a polyline."""
    rs = np.random.RandomState(seed)
    pts = []
    for i in range(len(path) - 1):
        (x0, y0), (x1, y1) = path[i], path[i + 1]
        L = math.hypot(x1 - x0, y1 - y0)
        k = max(1, int(L / (link * 0.8)))
        for j in range(k):
            t = j / k
            pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, math.atan2(y1 - y0, x1 - x0)))
    for i, (x, y, a) in enumerate(pts):
        rx, ry = (link * 0.7, link * 0.42) if i % 2 == 0 else (link * 0.45, link * 0.55)
        X, Y = part.P(x, y)
        c = mul(color, rs.uniform(0.85, 1.1))
        box = [X - rx * SS, Y - ry * SS, X + rx * SS, Y + ry * SS]
        part.d.ellipse(box, outline=tuple(dark) + (255,), width=max(1, int(0.9 * SS)))
        part.d.ellipse([box[0] + 0.3 * SS, box[1] + 0.3 * SS, box[2] - 0.3 * SS, box[3] - 0.3 * SS], outline=tuple(c) + (255,), width=max(1, int(0.55 * SS)))
        part.dmt.ellipse(box, fill=MAT['metal'])
        part.dhf.ellipse(box, outline=0.6 * SS, width=max(1, int(0.8 * SS)))


def filigree(part, path, color, amp=1.6, seed=0, width=0.7, curls=True):
    """Ornamental gold line: wavy path with small curls."""
    rs = np.random.RandomState(seed)
    out = []
    for i in range(len(path) - 1):
        (x0, y0), (x1, y1) = path[i], path[i + 1]
        L = math.hypot(x1 - x0, y1 - y0)
        nx, ny = -(y1 - y0) / (L or 1), (x1 - x0) / (L or 1)
        k = max(4, int(L / 1.2))
        for j in range(k + 1):
            t = j / k
            w = math.sin(t * math.pi * max(1, L / 5)) * amp
            out.append((x0 + (x1 - x0) * t + nx * w, y0 + (y1 - y0) * t + ny * w))
    part.line(out, color, width=width, mat='gold', h=0.5)
    if curls:
        for i in range(2, len(out) - 2, max(3, len(out) // 6)):
            x, y = out[i]
            r = amp * 0.8
            X, Y = part.P(x, y)
            part.d.arc([X - r * SS, Y - r * SS, X + r * SS, Y + r * SS], rs.randint(0, 360), rs.randint(400, 600), fill=tuple(color) + (255,), width=max(1, int(width * SS)))
            part.dmt.ellipse([X - r * SS, Y - r * SS, X + r * SS, Y + r * SS], fill=MAT['gold'])


# ---------------------------------------------------------------- styles ----

BEAST = dict(
    fur=(80, 68, 60), fur_lt=(132, 114, 94), fur_dark=(34, 28, 26), umber=(96, 68, 48), belly=(150, 134, 112), belly_lt=(184, 168, 142),
    claw=(222, 212, 190), horn=(150, 132, 104), horn_dark=(74, 60, 46), eye=(255, 150, 30), mouth=(96, 20, 26), gum=(132, 36, 44),
    teeth=(238, 230, 208), outline=(18, 12, 14), scar=(140, 92, 86),
)
KNIGHT = dict(
    steel=(130, 136, 148), steel_lt=(186, 192, 204), steel_dark=(70, 74, 86), trim=(184, 150, 72), cloth=(118, 26, 32), cloth_dark=(62, 12, 18),
    leather=(76, 52, 36), skin=(150, 120, 100), outline=(16, 12, 18), eye=(255, 110, 40), mail=(96, 100, 110),
)
SPEARMAN = dict(
    steel=(118, 120, 126), steel_lt=(168, 170, 176), steel_dark=(66, 68, 76), trim=(140, 120, 80), cloth=(54, 62, 84), cloth_dark=(28, 34, 50),
    leather=(92, 64, 42), leather_dark=(52, 36, 24), skin=(182, 148, 122), skin_dark=(118, 88, 70), outline=(14, 12, 16), eye=(220, 200, 160),
    mail=(104, 106, 114), rust=(122, 70, 38),
)
SKELETON = dict(
    bone=(214, 200, 164), bone_lt=(236, 226, 196), bone_dark=(142, 126, 96), rag=(78, 70, 56), rag_dark=(46, 40, 32), rust=(118, 66, 36), eye=(110, 255, 150),
    outline=(22, 18, 14), crack=(84, 68, 48),
)
WARDEN = dict(
    steel=(58, 54, 66), steel_lt=(104, 100, 116), steel_dark=(26, 24, 32), trim=(214, 164, 70), cloth=(70, 12, 18), cloth_dark=(32, 6, 10),
    leather=(44, 32, 28), skin=(90, 80, 80), outline=(8, 6, 10), eye=(255, 50, 20), fur=(52, 42, 38), fur_lt=(94, 80, 70), fur_dark=(24, 18, 18),
)


# ---------------------------------------------------------------- beast ----

def beast_parts(outdir):
    S = BEAST
    base, fur_lt, fur_dk, umber = S['fur'], S['fur_lt'], S['fur_dark'], S['umber']
    pale, pale_lt, pale_dk = S['belly'], S['belly_lt'], mix(S['belly'], S['fur'], 0.55)
    spec_c = (232, 222, 200)   # painted specular ridge colour
    o = dict(outline=S['outline'], rim=0.36, ao=0.6, noise=0.07, round_r=9, shape_k=0.6, spec=1.3)

    def ridge(p, a, b, w, alpha=170):
        """Bright specular ridge stroke along a muscle crest (colour + raised fine height)."""
        p.stroke(a, b, w, w * 0.45, spec_c, h=0.35, alpha=alpha)
        p.stroke((a[0] + 0.3, a[1] + 0.4), (b[0] + 0.3, b[1] + 0.4), w * 0.45, 0.2, (255, 250, 236), alpha=int(alpha * 0.55))

    def crease(p, a, b, w, alpha=175):
        p.stroke(a, b, w, w * 0.4, mix(fur_dk, (0, 0, 0), 0.4), h=-0.5, alpha=alpha)

    def hackles(p, specs, seed):
        """Irregular large tufts: (base x, base y, length, angle deg, width)."""
        rs = np.random.RandomState(seed)
        for (x, y, L, ang, wd) in specs:
            a = math.radians(ang)
            tip = (x + math.cos(a) * L, y + math.sin(a) * L)
            nx, ny = -math.sin(a), math.cos(a)
            b0 = (x + nx * wd / 2, y + ny * wd / 2); b1 = (x - nx * wd / 2, y - ny * wd / 2)
            bend = (x + math.cos(a) * L * 0.55 + nx * L * 0.12, y + math.sin(a) * L * 0.55 + ny * L * 0.12)
            p.poly([b0, bend, tip, b1], mix(base, fur_dk, 0.45), mat='fur', dome=1.4)
            p.stroke(((b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2), tip, wd * 0.4, 0.2, mix(fur_lt, pale, 0.4), alpha=170)
            # a couple of smaller side strands
            for k in range(2):
                a2 = a + rs.uniform(-0.35, 0.35)
                L2 = L * rs.uniform(0.4, 0.7)
                sx, sy = x + nx * rs.uniform(-wd, wd) * 0.5, y + ny * rs.uniform(-wd, wd) * 0.5
                p.stroke((sx, sy), (sx + math.cos(a2) * L2, sy + math.sin(a2) * L2), wd * 0.35, 0.2, mix(base, fur_dk, 0.5), h=0.4)

    def edge_highlights(p, pts, seed, n=6, length=3.5, angle=180):
        """Lighter base highlight strokes along an edge so the silhouette breaks up."""
        tufts(p, pts, n, length, angle, mix(fur_lt, pale_lt, 0.5), mix(fur_lt, pale, 0.3), seed=seed, width=1.6, h=0.4, spread=16)

    # ---- torso: pivot at hip (bottom centre). Hunched forward (toward +x).
    p = Part('beast_torso', 64, 76, (28, 70))
    body = [(-13, 2), (-17, -14), (-18, -30), (-15, -46), (-10, -58), (-2, -65), (12, -67), (22, -62), (27, -52), (26, -38), (22, -22), (17, -8), (12, 2)]
    p.poly(body, mix(base, fur_dk, 0.35), mat='fur', dome=5)
    # pale chest/belly: runs from the neck down the whole front
    chest = [(-1, -64), (12, -67), (22, -62), (27, -52), (26, -38), (22, -22), (17, -8), (12, 2), (3, 0), (4, -16), (6, -36), (4, -52)]
    p.poly(chest, pale, mat='fur')
    # muscle groups (height domes + tone)
    p.ellipse(-5, -40, 9, 14, mix(base, fur_lt, 0.15), dome=3.6)        # lats / back mass
    p.ellipse(12, -52, 10, 7, mix(pale, pale_lt, 0.4), dome=4.4)       # pec
    p.ellipse(17, -41, 8, 5.5, mix(pale, pale_lt, 0.3), dome=3.2)      # lower pec
    p.ellipse(5, -59, 9, 6, mix(base, pale, 0.4), dome=3.6)             # trap / shoulder mass
    for (ax, ay) in ((13, -31), (11, -23), (9, -15)):                   # abs
        p.ellipse(ax, ay, 5.5, 3.6, mix(pale, pale_lt, 0.25), dome=2.6)
    # base strands: dark directional on the back, pale on the front
    bgrad = lambda x, y: np.clip((x + 18) / 36, 0, 1) * 0.45 + 0.05
    fur(p, [(-13, 2), (-17, -14), (-18, -30), (-15, -46), (-10, -58), (-2, -65), (4, -62), (5, -40), (3, -16), (2, 2)], 220, 4.2, 100, 14, fur_lt, fur_dk, seed=2, width=1.3, h=0.16, grad=bgrad)
    cgrad = lambda x, y: np.clip((x - 2) / 24, 0, 1) * 0.5 + np.clip((y + 67) / 70, 0, 1) * 0.3 + 0.2
    fur(p, chest, 230, 3.4, 95, 16, pale_lt, pale_dk, seed=1, width=1.1, h=0.14, grad=cgrad)
    # painted definition: dark creases between groups, specular ridges on crests
    crease(p, (3, -47), (22, -39), 2.2)                                 # under pec
    crease(p, (6, -34), (18, -34), 1.6); crease(p, (5, -26), (16, -27), 1.6); crease(p, (4, -18), (14, -19), 1.6)   # ab creases
    crease(p, (8, -36), (9, -8), 1.3, 120)                               # linea alba
    crease(p, (2, -62), (4, -10), 2.0, 160)                              # pale/dark base boundary
    crease(p, (-13, -10), (-7, -58), 2.2, 170)                           # spine groove
    ridge(p, (4, -57), (18, -58), 2.2)                                   # pec top
    ridge(p, (-6, -63), (12, -66), 2.4)                                  # shoulder/trap top
    ridge(p, (18, -47), (25, -42), 1.6, 140)                             # pec front
    for (ax, ay) in ((13, -31), (11, -23), (9, -15)):
        ridge(p, (ax - 4, ay - 2.4), (ax + 4, ay - 2.8), 1.2, 130)
    p.shade([(-18, -30), (-10, -58), (-2, -65), (-6, -64), (-13, -56), (-20, -30), (-19, -14)], fur_dk, alpha=130)  # back in shadow
    p.shade([(-13, 2), (-17, -14), (-18, -30), (-14, -30), (-12, -14), (-8, 2)], fur_dk, alpha=100)
    # mane around the neck / shoulders + 5 irregular hackles down the back ridge
    tufts(p, [(-12, -56), (-4, -64), (8, -68), (20, -64)], 10, 6, 265, mix(base, fur_dk, 0.3), fur_dk, seed=5, width=4.5, h=0.9, spread=22)
    tufts(p, [(-14, -50), (-6, -60), (6, -64)], 6, 5, 200, mix(base, fur_dk, 0.2), mix(fur_lt, base, 0.5), seed=6, width=3.5, h=0.7, spread=20)
    hackles(p, [(-11, -60, 12, 215, 5.5), (-15, -46, 9, 200, 5), (-18, -34, 13, 190, 6), (-18, -22, 7, 205, 4.5), (-15, -10, 10, 178, 5)], seed=3)
    # claw scars across the chest/abs
    for k in range(3):
        p.stroke((16 + k * 3, -46 + k * 2), (10 + k * 3, -26 + k * 2), 1.1, 0.4, S['scar'], h=-0.5, alpha=220)
        p.stroke((16.6 + k * 3, -46 + k * 2), (10.6 + k * 3, -26 + k * 2), 0.5, 0.2, mix(S['scar'], (255, 230, 220), 0.5), alpha=150)
    save_part(p, outdir, tex_seed=1, **o)

    # ---- head: pivot at neck (bottom-back). Snout toward +x, horns back.
    p = Part('beast_head', 70, 58, (22, 50))
    skull = [(-10, 0), (-15, -12), (-12, -26), (-4, -35), (8, -37), (18, -32), (30, -24), (42, -16), (44, -10), (36, -6), (26, -4), (16, 0), (4, 2)]
    p.poly(skull, mix(base, fur_dk, 0.3), mat='fur', dome=5)
    p.poly([(4, 2), (16, 0), (26, -4), (36, -6), (44, -10), (40, -14), (28, -14), (14, -10), (4, -8)], pale_dk, mat='fur')   # pale muzzle underside
    p.ellipse(4, -24, 10, 9, mix(base, fur_lt, 0.25), dome=2.6)         # cranium/brow mass
    p.ellipse(27, -18, 10, 5, mix(base, umber, 0.4), dome=2.0)          # muzzle bridge
    ridge(p, (14, -30), (34, -22), 1.8, 150)                           # muzzle bridge highlight
    p.limb((13, -28), (30, -24), 4, 3, mix(fur_dk, (0, 0, 0), 0.3), mat='fur', dome=1.8)   # dark brow ridge
    crease(p, (14, -26), (30, -22.5), 1.4, 200)
    # jaw (lower) with gum line, wet gums + fangs
    p.poly([(4, -1), (14, -3), (36, -9), (40, -6), (34, 2), (20, 7), (8, 7), (3, 4)], mix(base, umber, 0.5), mat='fur', dome=2)
    p.poly([(13, -4), (37, -9.5), (36, -5), (30, -2), (18, 1), (11, 0)], S['mouth'], mat='skin', h=-0.8)
    p.poly([(15, -3), (35, -8.5), (33, -5), (22, -3)], S['gum'], mat='skin')
    p.line([(13, -4.6), (37, -10)], mix(S['mouth'], (0, 0, 0), 0.5), width=0.9, h=-0.4)      # upper gum line
    p.stroke((17, -2.5), (31, -6), 0.8, 0.3, mix(S['gum'], (255, 200, 200), 0.5), alpha=160)   # wet highlight
    for tx, tl in ((19, 4.5), (25, 6.0), (31, 5.0), (36, 3.5)):
        y0 = -5.5 + (tx - 27) * -0.14
        p.poly([(tx - 1.8, y0), (tx + 1.8, y0 - 0.5), (tx + 0.3, y0 + tl)], S['teeth'], mat='horn', h=0.7)
        p.stroke((tx - 0.6, y0 + 0.5), (tx + 0.1, y0 + tl - 1), 0.6, 0.2, (255, 255, 248), alpha=200)
    for tx in (17, 22, 28, 33):
        y0 = 1 - (tx - 24) * 0.13
        p.poly([(tx - 1.3, y0), (tx + 1.3, y0), (tx, y0 - 2.8)], mix(S['teeth'], S['gum'], 0.15), mat='horn', h=0.5)
    # nostril
    p.ellipse(40, -13, 2.6, 1.8, mix(fur_dk, (0, 0, 0), 0.6), h=-0.8)
    p.dot(39.6, -13.6, 1.0, (8, 5, 6))
    # ear
    p.poly([(-6, -22), (-18, -32), (-14, -18), (-8, -14)], mix(base, fur_dk, 0.4), mat='fur', h=0.5)
    p.poly([(-7, -21), (-14, -28), (-12, -19)], mix(S['mouth'], base, 0.6), mat='skin')
    # horns: cracked, ridged
    def horn(base, tip, w0):
        (bx, by), (tx, ty) = base, tip
        p.limb(base, tip, w0, 1.2, S['horn'], mat='horn', dome=2.2)
        p.limb(base, ((bx + tx) / 2, (by + ty) / 2), w0 * 0.9, w0 * 0.6, S['horn_dark'], mat='horn')
        dx, dy = tx - bx, ty - by
        L = math.hypot(dx, dy)
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux
        for i in range(1, 9):
            t = i / 9
            w = (w0 * (1 - t) + 1.2 * t) * 0.5
            cx, cy = bx + dx * t, by + dy * t
            p.line([(cx - nx * w, cy - ny * w), (cx + nx * w, cy + ny * w)], mix(S['horn_dark'], (0, 0, 0), 0.3), width=0.6, h=-0.45, alpha=200)
            p.line([(cx - nx * w, cy - ny * w - 0.8), (cx + nx * w, cy + ny * w - 0.8)], mix(S['horn'], (255, 250, 230), 0.35), width=0.5, alpha=150)
        p.stroke((bx + dx * 0.55, by + dy * 0.55), (bx + dx * 0.8 + nx * 1.5, by + dy * 0.8 + ny * 1.5), 0.7, 0.2, mix(S['horn_dark'], (0, 0, 0), 0.4), h=-0.5)
        p.stroke(((bx + tx) / 2, (by + ty) / 2), tip, 1.0, 0.3, mix(S['horn'], (255, 250, 235), 0.3), h=0.3, alpha=200)
    horn((-2, -30), (-30, -50), 7)
    horn((8, -34), (-8, -56), 6.5)
    # base strands, mane along the back of the head and the jaw ruff
    hgrad = lambda x, y: np.clip((y + 37) / 40, 0, 1) * 0.5 + 0.1
    fur(p, [(-10, 0), (-15, -12), (-12, -26), (-4, -35), (8, -37), (18, -32), (30, -24), (26, -16), (14, -8), (4, -2)], 200, 3.2, 110, 20, fur_lt, fur_dk, seed=5, width=1.1, h=0.14, grad=hgrad)
    hackles(p, [(-12, -8, 9, 165, 5), (-14, -16, 7, 180, 4), (-13, -2, 8, 150, 4.5), (-4, -35, 6, 265, 4)], seed=7)
    tufts(p, [(4, 2), (-10, 0), (-15, -12)], 6, 5, 150, mix(base, fur_dk, 0.2), fur_dk, seed=6, width=4.0, h=0.6, spread=12)
    edge_highlights(p, [(8, -37), (18, -32), (30, -24)], 8, n=5, length=3, angle=280)
    # ember eye: bigger, hotter halo, glowing pupil sliver
    p.ellipse(22, -21, 6.0, 4.0, (20, 8, 4), mat='skin', h=-1.0)       # dark socket
    p.glow(22, -21, 4.6, 3.0, S['eye'], halo=4.0, strength=1.25)
    p.ellipse(22.4, -21, 3.0, 2.0, (255, 236, 140), mat='glow', em=255)
    p.ellipse(23.2, -21, 0.9, 1.9, (150, 30, 0), mat='glow', em=255)   # pupil sliver (dark core)
    p.ellipse(23.0, -21.2, 0.35, 1.2, (255, 120, 40), mat='glow', em=255)
    crease(p, (15, -27), (30, -25), 1.6, 220)                            # brow shadow over the eye
    save_part(p, outdir, tex_seed=2, **o)

    # ---- upper arm (hangs down from shoulder)
    p = Part('beast_arm_u', 26, 44, (13, 6))
    p.limb((0, 0), (0, 32), 17, 12, mix(base, fur_dk, 0.3), mat='fur', dome=5)
    p.poly([(1, -2), (8, 0), (8, 32), (3, 34), (1, 20)], pale_dk, mat='fur')                  # inner (front) pale base
    p.ellipse(0, 2, 9, 8, mix(base, fur_lt, 0.25), dome=4.2)     # deltoid
    p.ellipse(2, 16, 5.5, 8, mix(pale_dk, pale, 0.4), dome=3.6)   # bicep
    p.ellipse(-4, 20, 3.5, 7, mix(base, umber, 0.5), dome=1.4)    # tricep
    fur(p, [(-8, -4), (0, -4), (0, 34), (-6, 34)], 90, 3.2, 95, 16, fur_lt, fur_dk, seed=8, width=1.1, h=0.14)
    fur(p, [(0, -2), (8, -2), (8, 32), (2, 34)], 90, 3.0, 95, 16, pale_lt, pale_dk, seed=9, width=1.0, h=0.12)
    p.shade([(-9, 4), (-5, 4), (-4, 32), (-7, 32)], fur_dk, alpha=130)
    crease(p, (-1, 9), (-2, 26), 1.4, 150)                       # bicep/tricep split
    crease(p, (-3, 25), (6, 25), 1.6, 160)                       # elbow crease
    ridge(p, (-5, -1), (6, 0), 2.2)                              # deltoid crest
    ridge(p, (2, 9), (3.5, 20), 1.6, 150)                        # bicep crest
    edge_highlights(p, [(7, 4), (8, 16), (6, 28)], 11, n=4, length=3, angle=10)
    tufts(p, [(-8, 6), (-7, 24)], 2, 3.5, 150, mix(base, fur_dk, 0.3), fur_dk, seed=10, width=4.0, h=0.5, spread=8)
    save_part(p, outdir, tex_seed=3, **o)

    # ---- forearm with clawed hand
    p = Part('beast_arm_l', 34, 58, (14, 6))
    p.limb((0, 0), (1, 32), 12, 9, mix(base, fur_dk, 0.3), mat='fur', dome=4)
    p.poly([(0, -2), (6, 0), (5.5, 30), (1, 32)], pale_dk, mat='fur')                        # inner pale base
    p.ellipse(1, 10, 5, 8, mix(pale_dk, pale, 0.4), dome=3.2)      # forearm flexor
    p.ellipse(3, 36, 7.5, 6, mix(base, umber, 0.5), mat='fur', dome=3.2)  # hand
    for kx in (-2, 2, 6):
        p.ellipse(kx, 38, 2.0, 1.8, mix(base, fur_dk, 0.45), dome=1.0)   # knuckles
    fur(p, [(-6, -4), (0, -4), (0, 30), (-5, 30)], 70, 3.0, 92, 16, fur_lt, fur_dk, seed=12, width=1.1, h=0.14)
    fur(p, [(0, -2), (6, -2), (6, 30), (1, 30)], 70, 2.8, 92, 16, pale_lt, pale_dk, seed=13, width=1.0, h=0.12)
    p.shade([(-6, 2), (-3, 2), (-2, 30), (-5, 30)], fur_dk, alpha=130)
    ridge(p, (0, 4), (2, 18), 1.6, 160)                         # forearm crest
    crease(p, (-2, 6), (-3, 24), 1.2, 140)
    crease(p, (-3, 31), (7, 31), 1.6, 160)                      # wrist
    edge_highlights(p, [(6, 2), (6.5, 14), (6, 26)], 15, n=4, length=2.8, angle=10)
    tufts(p, [(-5, 30), (1, 30)], 3, 3.5, 160, base, fur_dk, seed=16, width=3.0, h=0.5, spread=10)  # wrist ruff
    # claws: long, bright, dark roots, specular tips
    for i, (x, y) in enumerate([(-5, 38), (2, 39.5), (8, 38)]):
        tip = (x + (i - 1) * 2.5, y + 14)
        p.poly([(x - 2.6, y - 2), (x + 2.6, y - 2), tip], mix(S['claw'], fur_dk, 0.55), mat='horn', dome=1.6)   # dark root
        p.poly([(x - 1.6, y + 2), (x + 1.8, y + 2), tip], S['claw'], mat='horn', dome=1.2)
        p.poly([(x - 0.8, y + 2), (x + 0.5, y + 2), (tip[0] - 0.2, tip[1] - 1)], (250, 246, 232), mat='horn')
        p.stroke((x + 1.0, y + 3), (tip[0] + 0.4, tip[1] - 2), 0.6, 0.2, mix(S['claw'], (90, 70, 50), 0.55), alpha=160)
    save_part(p, outdir, tex_seed=4, **o)

    # ---- thigh
    p = Part('beast_leg_u', 30, 46, (15, 6))
    p.limb((0, 0), (0, 34), 20, 13, mix(base, fur_dk, 0.3), mat='fur', dome=5)
    p.poly([(1, -2), (10, 0), (8, 34), (2, 36)], pale_dk, mat='fur')                         # inner thigh pale base
    p.ellipse(0, 2, 11, 9, mix(base, umber, 0.3), dome=3.0)
    p.ellipse(3, 16, 6, 10, mix(pale_dk, pale, 0.4), dome=4.0)   # quad
    p.ellipse(-5, 18, 3.5, 9, mix(base, umber, 0.5), dome=1.4)   # hamstring
    fur(p, [(-10, -4), (0, -4), (0, 38), (-7, 38)], 110, 3.4, 95, 16, fur_lt, fur_dk, seed=17, width=1.2, h=0.14)
    fur(p, [(0, -2), (10, -2), (8, 36), (0, 38)], 110, 3.2, 95, 16, pale_lt, pale_dk, seed=18, width=1.1, h=0.12)
    p.shade([(-10, 4), (-6, 4), (-5, 34), (-8, 34)], fur_dk, alpha=130)
    ridge(p, (2, 6), (4.5, 22), 2.0)                            # quad crest
    crease(p, (-2, 8), (-3, 28), 1.5, 150)                      # quad/hamstring split
    crease(p, (-6, 31), (6, 31), 1.8, 160)                      # knee crease
    edge_highlights(p, [(9, 4), (9, 18), (7, 30)], 20, n=4, length=3, angle=10)
    tufts(p, [(-10, 6), (-9, 26)], 2, 4, 150, mix(base, fur_dk, 0.3), fur_dk, seed=19, width=4.5, h=0.5, spread=8)
    save_part(p, outdir, tex_seed=5, **o)

    # ---- shin + paw (digitigrade)
    p = Part('beast_leg_l', 36, 56, (12, 6))
    p.limb((0, 0), (-2, 26), 13, 9, mix(base, fur_dk, 0.3), mat='fur', dome=4)
    p.limb((-2, 26), (8, 40), 9, 8, mix(base, fur_dk, 0.3), mat='fur', dome=3.5)
    p.poly([(0, -2), (6, 0), (3, 26), (-1, 26)], pale_dk, mat='fur')                         # front pale base
    p.ellipse(-1, 10, 4.5, 8, mix(pale_dk, pale, 0.3), dome=3.2)   # calf
    p.ellipse(10, 42, 9, 5, mix(base, umber, 0.5), mat='fur', dome=3.0)  # paw
    fur(p, [(-6, -4), (0, -4), (-2, 26), (-6, 26)], 60, 3.0, 95, 16, fur_lt, fur_dk, seed=21, width=1.1, h=0.14)
    fur(p, [(0, -2), (6, -2), (3, 26), (-1, 26)], 50, 2.8, 95, 16, pale_lt, pale_dk, seed=22, width=1.0, h=0.12)
    fur(p, [(-6, 24), (4, 24), (12, 36), (2, 40)], 50, 2.6, 125, 16, fur_lt, fur_dk, seed=23, width=1.0, h=0.12)
    p.shade([(-6, 2), (-3, 2), (-5, 26), (-8, 26)], fur_dk, alpha=130)
    ridge(p, (-2, 3), (0, 16), 1.6, 160)                        # calf crest
    crease(p, (-4, 6), (-5, 22), 1.2, 140)
    crease(p, (-6, 27), (3, 29), 1.6, 160)                      # hock
    tufts(p, [(-6, 26), (0, 34)], 3, 4, 160, base, fur_dk, seed=25, width=3.2, h=0.5, spread=10)
    edge_highlights(p, [(6, 2), (5, 12), (3, 22)], 26, n=4, length=2.8, angle=10)
    for x in (4, 11, 18):
        p.ellipse(x, 42, 2.2, 1.8, mix(base, fur_dk, 0.45), dome=0.8)
        p.poly([(x - 2.4, 41), (x + 2.4, 41), (x + 1, 49)], mix(S['claw'], fur_dk, 0.55), mat='horn', dome=1.3)   # dark root
        p.poly([(x - 1.5, 43.5), (x + 1.7, 43.5), (x + 1, 49)], S['claw'], mat='horn', dome=1.0)
        p.poly([(x - 0.8, 43.5), (x + 0.5, 43.5), (x + 0.9, 47.8)], (250, 246, 232), mat='horn')
    save_part(p, outdir, tex_seed=6, **o)

    # ---- tail segments (hang from pivot; angled by animation)
    p = Part('beast_tail1', 20, 40, (10, 4))
    p.limb((0, 0), (0, 32), 10, 6, mix(base, fur_dk, 0.3), mat='fur', dome=3.5)
    fur(p, [(-5, -3), (5, -3), (3, 34), (-3, 34)], 80, 2.8, 95, 14, fur_lt, fur_dk, seed=27, width=1.0, h=0.12, grad=lambda x, y: 0.5 + x / 10)
    hackles(p, [(-5, 6, 6, 198, 3.5), (-4, 24, 5, 190, 3)], seed=28)
    edge_highlights(p, [(5, 4), (4, 18), (3, 30)], 29, n=3, length=2.5, angle=10)
    save_part(p, outdir, tex_seed=7, **o)
    p = Part('beast_tail2', 20, 44, (10, 4))
    p.limb((0, 0), (0, 28), 6, 3, mix(base, fur_dk, 0.3), mat='fur', dome=2.5)
    p.poly([(-5, 24), (-2, 40), (0, 34), (2, 40), (5, 24)], mix(base, fur_dk, 0.35), mat='fur', dome=1.5)
    fur(p, [(-3, -3), (3, -3), (2, 30), (-2, 30)], 40, 2.5, 95, 14, fur_lt, fur_dk, seed=30, width=0.9, h=0.12, grad=lambda x, y: 0.5 + x / 6)
    hackles(p, [(-3, 5, 6, 200, 3), (-3, 20, 5, 195, 2.8)], seed=31)
    tufts(p, [(-5, 24), (-3, 34), (0, 40)], 4, 4.5, 210, fur_dk, None, seed=32, width=2.5, h=0.7)
    edge_highlights(p, [(3, 2), (2.5, 14), (3, 24)], 33, n=3, length=2.2, angle=10)
    save_part(p, outdir, tex_seed=8, **o)

    rig = humanoid_rig('beast', dict(
        torso=dict(tex='beast_torso', pivot=(28, 70), shoulder=(4, -56), neck=(2, -62), hip=(0, 0)),
        head=dict(tex='beast_head', pivot=(22, 50)),
        arm_u=dict(tex='beast_arm_u', pivot=(13, 6), len=32),
        arm_l=dict(tex='beast_arm_l', pivot=(14, 6), len=36, hand=(3, 36)),
        leg_u=dict(tex='beast_leg_u', pivot=(15, 6), len=34),
        leg_l=dict(tex='beast_leg_l', pivot=(12, 6), len=44),
        tail=[dict(tex='beast_tail1', pivot=(10, 4), len=32), dict(tex='beast_tail2', pivot=(10, 4), len=28)],
        hip_offset=(-6, 2),
    ), height=112, hunch=18)
    return rig


# -------------------------------------------------------------- humanoid ----

def device(part, cx, cy, size, color, alpha=255, h=None):
    """Faded heraldic device: a cross pattee with a chevron below."""
    s = size
    part.poly([(cx - s * 0.18, cy - s), (cx + s * 0.18, cy - s), (cx + s * 0.1, cy - s * 0.2), (cx + s * 0.1, cy + s * 0.2),
               (cx + s * 0.18, cy + s), (cx - s * 0.18, cy + s), (cx - s * 0.1, cy + s * 0.2), (cx - s * 0.1, cy - s * 0.2)], color, alpha=alpha)
    part.poly([(cx - s, cy - s * 0.18), (cx - s * 0.2, cy - s * 0.1), (cx + s * 0.2, cy - s * 0.1), (cx + s, cy - s * 0.18),
               (cx + s, cy + s * 0.18), (cx + s * 0.2, cy + s * 0.1), (cx - s * 0.2, cy + s * 0.1), (cx - s, cy + s * 0.18)], color, alpha=alpha)
    if h is not None:
        part.dhf.rectangle([part.P(cx - s * 0.18, cy - s), part.P(cx + s * 0.18, cy + s)], fill=float(h) * SS)


def armored_parts(prefix, S, outdir, helmet='great', weapon='sword', shield=True, heavy=False, bony=False):
    """Knight-like characters. Returns rig dict. Geometry (sizes, pivots, attach points) is fixed."""
    k = 1.0 if not heavy else 1.25
    sc = lambda v: v * k
    steel, steel_lt, steel_dk = S.get('steel'), S.get('steel_lt'), S.get('steel_dark')
    trim, cloth, cloth_dk, leather = S.get('trim'), S.get('cloth'), S.get('cloth_dark'), S.get('leather')
    mail = S.get('mail', steel_dk)
    mail_lt = mix(mail, (255, 255, 255), 0.35) if mail else None
    mail_dk = mul(mail, 0.45) if mail else None
    if bony:
        o = dict(outline=S['outline'], rim=0.4, ao=0.65, noise=0.07, round_r=5, shape_k=0.75)
    elif heavy:
        o = dict(outline=S['outline'], rim=0.6, ao=0.6, noise=0.05, round_r=11, shape_k=0.7, rim_color=(130, 160, 230))
    else:
        o = dict(outline=S['outline'], rim=0.55, ao=0.6, noise=0.05, round_r=10, shape_k=0.7, rim_color=(140, 165, 225))
    bone, bone_lt, bone_dk = S.get('bone'), S.get('bone_lt'), S.get('bone_dark')

    def bone_limb(p, a, b, w0, w1, knob0=1.3, knob1=1.3, seed=0):
        """Long bone: shaft + condyle knobs + cracks + yellowed shading."""
        p.limb(a, b, w0, w1, bone, mat='bone', dome=max(w0, w1) * 0.35)
        p.ellipse(a[0], a[1] + 1, w0 * knob0 * 0.5 + 0.5, w0 * 0.42, bone, mat='bone', dome=w0 * 0.3)
        p.ellipse(b[0], b[1] - 1, w1 * knob1 * 0.5 + 0.6, w1 * 0.45, bone, mat='bone', dome=w1 * 0.3)
        p.stroke((a[0] - w0 * 0.25, a[1] + 2), (b[0] - w1 * 0.25, b[1] - 2), w0 * 0.3, w1 * 0.3, mix(bone, (255, 255, 240), 0.4), alpha=120)
        p.stroke((a[0] + w0 * 0.3, a[1] + 2), (b[0] + w1 * 0.3, b[1] - 2), w0 * 0.3, w1 * 0.25, bone_dk, alpha=130)
        p.stroke((a[0], a[1] + 3), (b[0], b[1] - 3), w0 * 0.25, w1 * 0.2, mix(bone, (120, 100, 60), 0.3), alpha=90)
        cracks(p, [(a[0] - w0, a[1]), (a[0] + w0, a[1]), (b[0] + w1, b[1]), (b[0] - w1, b[1])], 2, seed, S['crack'], length=5, width=0.5)

    # ---------------------------------------------------------------- torso
    p = Part(f'{prefix}_torso', int(sc(56)), int(sc(78)), (int(sc(28)), int(sc(72))))
    if bony:
        # dark interior (shadowed cavity + rag backing)
        p.poly([(-9, 2), (-11, -30), (-9, -50), (-4, -58), (8, -58), (11, -50), (13, -30), (10, 2)], S['rag_dark'], mat='cloth', h=-1.0)
        # spine at the back: vertebrae
        for i in range(8):
            y = -56 + i * 7.2
            p.poly([(-9.5, y), (-5, y), (-4.8, y + 5), (-9.7, y + 5)], bone, mat='bone', dome=1.4)
            p.line([(-9.6, y + 5.2), (-4.8, y + 5.2)], S['crack'], width=0.5, h=-0.4)
            p.dot(-10.5, y + 2.5, 1.1, bone_dk)
        # ribs in profile: curve from the spine forward and down to the sternum, dark gaps between
        for i in range(6):
            y = -50 + i * 6.2
            wr = 2.5 - i * 0.12
            pts = [(-6, y), (-1, y + 0.8), (4, y + 2.6), (8, y + 5.5), (10 - i * 0.2, y + 8.5)]
            for j in range(len(pts) - 1):
                p.limb(pts[j], pts[j + 1], wr, wr * 0.9, bone, mat='bone', dome=1.1)
            p.stroke((pts[0][0], pts[0][1] - wr * 0.3), (pts[2][0], pts[2][1] - wr * 0.3), wr * 0.35, wr * 0.3, mix(bone, (255, 255, 240), 0.5), alpha=130)
            p.stroke((pts[1][0], pts[1][1] + wr * 0.4), (pts[4][0], pts[4][1] + wr * 0.3), wr * 0.3, wr * 0.25, bone_dk, alpha=160)
        # sternum
        p.poly([(9.5, -44), (12.5, -44), (12, -18), (10, -14), (8.5, -18)], bone, mat='bone', dome=1.3)
        # clavicle / shoulder blade
        p.limb((-7, -58), (6, -60), 2.4, 2.8, bone, mat='bone', dome=1.0)
        p.ellipse(7, -59, 3, 2.4, bone, mat='bone', dome=1.3)
        p.ellipse(-8, -57, 3, 3, bone, mat='bone', dome=1.3)
        # pelvis
        p.poly([(-9, -10), (-11, -2), (-9, 4), (-4, 6), (4, 6), (9, 4), (11, -2), (9, -10), (4, -8), (0, -4), (-4, -8)], bone, mat='bone', dome=2.0)
        p.ellipse(-5, -3, 2.2, 2.5, S['rag_dark'], mat='cloth', h=-1)
        p.ellipse(5, -3, 2.2, 2.5, S['rag_dark'], mat='cloth', h=-1)
        cracks(p, [(-9, -10), (9, -10), (9, 4), (-9, 4)], 3, 41, S['crack'], length=5, width=0.5)
        # torn burial rags: a narrow sash over one shoulder and a skirt at the hips
        sash = [(-7, -60), (-2, -62), (12, -34), (10, -26), (6, -24), (-9, -48)]
        p.poly(sash, S['rag'], mat='cloth', h=0.8, alpha=235)
        folds(p, [((-4, -56), (8, -32))], S['rag_dark'], mix(S['rag'], (255, 255, 255), 0.2), width=1.0)
        tatter(p, [(6, -24), (10, -26), (12, -34)], 42, depth=3, holes=2, region=sash)
        skirt = [(-12, -12), (12, -12), (13, 4), (6, 6), (-6, 6), (-13, 4)]
        p.poly(skirt, S['rag'], mat='cloth', h=0.8)
        folds(p, [((-8, -10), (-9, 4)), ((0, -10), (1, 5)), ((7, -10), (9, 4))], S['rag_dark'], mix(S['rag'], (255, 255, 255), 0.2), width=1.0)
        tatter(p, [(-13, 4), (-6, 6), (6, 6), (13, 4)], 43, depth=5, n=10, holes=4, region=skirt)
        p.poly([(-12, -12), (12, -12), (12, -9), (-12, -9)], mul(S['rag'], 0.7), mat='leather', h=1.0)   # rope belt
    else:
        body = [(sc(-14), 2), (sc(-17), sc(-30)), (sc(-14), sc(-50)), (sc(-6), sc(-60)), (sc(6), sc(-60)), (sc(16), sc(-50)), (sc(18), sc(-30)), (sc(13), 2)]
        if helmet == 'great':
            # mail base (shows at the armpits / waist gap), then plates
            chainmail(p, body, mail, mail_lt, mail_dk, pitch=2.0 * k, seed=1)
            # fauld lames (overlapping hip plates)
            for i, y in enumerate((sc(-14), sc(-7), sc(0))):
                plate(p, [(sc(-14), y), (sc(14), y), (sc(13.5), y + sc(8)), (sc(-13.5), y + sc(8))], mix(steel, steel_dk, 0.15 + i * 0.1), h=1.6 - i * 0.3, light=steel_lt, dark=steel_dk)
            # breastplate (globose)
            bp = [(sc(-14), sc(-50)), (sc(-6), sc(-60)), (sc(6), sc(-60)), (sc(16), sc(-50)), (sc(18), sc(-30)), (sc(15), sc(-16)), (sc(-13), sc(-16)), (sc(-16), sc(-30))]
            plate(p, bp, steel, h=2.6, light=steel_lt, dark=steel_dk)
            p.ellipse(sc(2), sc(-38), sc(13), sc(16), steel, mat='metal', dome=3.2)
            p.line([(sc(-1), sc(-56)), (sc(-1), sc(-20))], steel_lt, width=1.1, h=0.9, alpha=200)   # medial ridge
            p.line([(sc(0.4), sc(-55)), (sc(0.4), sc(-21))], steel_dk, width=0.7, alpha=160)
            # gorget
            plate(p, [(sc(-8), sc(-62)), (sc(8), sc(-62)), (sc(10), sc(-56)), (sc(-10), sc(-56))], mix(steel, steel_lt, 0.1), h=3.0, light=steel_lt, dark=steel_dk)
            rivets(p, [(sc(x), sc(y)) for (x, y) in ((-12, -46), (-14, -34), (-12, -20), (14, -46), (16, -34), (13, -20), (-11, -10), (11, -10), (-11, -3), (11, -3))], 0.9 * k, steel_lt)
            dents(p, bp, 3, 5, steel, r=2.0)
            scratches(p, bp, 9, 6, steel_lt, steel_dk, length=4)
            # tattered crimson tabard with a faded device
            tab = [(sc(-9), sc(-52)), (sc(9), sc(-52)), (sc(10), sc(-4)), (sc(-10), sc(-4))]
            p.poly(tab, cloth, mat='cloth', h=0.6)
            folds(p, [((sc(-6), sc(-46)), (sc(-7), sc(-8))), ((sc(5), sc(-44)), (sc(6), sc(-8))), ((sc(0), sc(-20)), (sc(-1), sc(-6)))], cloth_dk, mix(cloth, (255, 220, 200), 0.25), width=1.3)
            device(p, sc(0), sc(-32), sc(6.5), mix(trim, cloth, 0.45), alpha=200)
            tatter(p, [(sc(10), sc(-4)), (sc(-10), sc(-4))], 7, depth=4, holes=3, region=tab)
            scratches(p, tab, 4, 8, mix(cloth, (255, 255, 255), 0.2), cloth_dk, length=3, width=0.5)
            # leather belt + buckle + shoulder straps
            p.poly([(sc(-15), sc(-13)), (sc(15), sc(-13)), (sc(15), sc(-7)), (sc(-15), sc(-7))], leather, mat='leather', h=1.4)
            p.line([(sc(-15), sc(-12)), (sc(15), sc(-12))], mix(leather, (255, 255, 255), 0.25), width=0.6, alpha=160)
            p.poly([(sc(-3), sc(-14)), (sc(3), sc(-14)), (sc(3), sc(-6)), (sc(-3), sc(-6))], trim, mat='gold', h=2.0)
            p.poly([(sc(-1.8), sc(-12.5)), (sc(1.8), sc(-12.5)), (sc(1.8), sc(-7.5)), (sc(-1.8), sc(-7.5))], leather, mat='leather')
            p.poly([(sc(3), sc(-11)), (sc(9), sc(-10)), (sc(9), sc(-8)), (sc(3), sc(-9))], mul(leather, 0.8), mat='leather', h=1.6)  # strap end
            for sx in (-7, 7):
                p.poly([(sc(sx - 1.8), sc(-60)), (sc(sx + 1.8), sc(-60)), (sc(sx + 2.2), sc(-44)), (sc(sx - 2.2), sc(-44))], leather, mat='leather', h=1.0)
                p.poly([(sc(sx - 2.2), sc(-48)), (sc(sx + 2.2), sc(-48)), (sc(sx + 2.2), sc(-45)), (sc(sx - 2.2), sc(-45))], trim, mat='gold', h=1.4)
        elif helmet == 'kettle':
            # brigandine over mail: studded cloth body
            chainmail(p, body, mail, mail_lt, mail_dk, pitch=2.0, seed=2)
            brig = [(-14, -6), (-16, -30), (-13, -50), (-6, -57), (6, -57), (15, -50), (17, -30), (13, -6)]
            p.poly(brig, cloth, mat='cloth', h=1.6)
            for x in (-7, 0, 7):   # panel seams
                p.line([(x, -54), (x - 1, -8)], cloth_dk, width=0.7, h=-0.4, alpha=200)
            studs(p, brig, 4.2, 0.8, mix(trim, steel, 0.4), seed=3, offset=(1, 1))
            folds(p, [((-13, -24), (-12, -10)), ((14, -26), (12, -10))], cloth_dk, None, width=1.0)
            # leather chest strap with buckle, belt, pouch
            p.poly([(-13, -52), (-9, -54), (14, -22), (12, -19)], leather, mat='leather', h=1.4)
            p.poly([(2, -38), (6, -37), (5, -32), (1, -33)], trim, mat='gold', h=1.6)
            p.poly([(-15, -12), (15, -12), (15, -6), (-15, -6)], leather, mat='leather', h=1.6)
            p.line([(-15, -11), (15, -11)], mix(leather, (255, 255, 255), 0.25), width=0.6, alpha=150)
            p.poly([(-2.5, -13), (2.5, -13), (2.5, -5), (-2.5, -5)], mix(trim, steel, 0.3), mat='metal', h=2.0)
            p.ellipse(-9, -2, 4.5, 3.5, S['leather_dark'], mat='leather', dome=2.2)   # pouch
            p.line([(-13, -4), (-5, -4)], mul(S['leather_dark'], 0.6), width=0.6, h=-0.3)
            # mail skirt below the belt
            chainmail(p, [(-13, -6), (13, -6), (12, 6), (-12, 6)], mail, mail_lt, mail_dk, pitch=2.0, seed=4)
            p.poly([(-15, -7), (15, -7), (15, -6), (-15, -6)], mul(leather, 0.7), mat='leather')
            scratches(p, brig, 5, 9, mix(cloth, (255, 255, 255), 0.25), cloth_dk, length=3, width=0.5)
        else:  # warden: black iron, gold filigree, fur mantle, chains
            chainmail(p, body, mail if mail else steel_dk, steel_lt, steel_dk, pitch=2.2 * k, seed=5)
            for i, y in enumerate((sc(-16), sc(-8), sc(0))):
                pl = [(sc(-15), y), (sc(15), y), (sc(14.5), y + sc(9)), (sc(-14.5), y + sc(9))]
                plate(p, pl, mix(steel, steel_dk, 0.2 + i * 0.1), h=1.8 - i * 0.3, light=steel_lt, dark=steel_dk)
                p.line([(sc(-13), y + sc(7)), (sc(13), y + sc(7))], trim, width=0.8, mat='gold', h=0.5)
            bp = [(sc(-15), sc(-50)), (sc(-6), sc(-61)), (sc(6), sc(-61)), (sc(17), sc(-50)), (sc(19), sc(-30)), (sc(16), sc(-18)), (sc(-14), sc(-18)), (sc(-17), sc(-30))]
            plate(p, bp, steel, h=3.0, light=steel_lt, dark=steel_dk)
            p.ellipse(sc(2), sc(-38), sc(14), sc(17), steel, mat='metal', dome=3.6)
            # gold filigree trim and central emblem
            filigree(p, [(sc(-13), sc(-46)), (sc(-15), sc(-30)), (sc(-13), sc(-20))], trim, amp=1.3 * k, seed=1)
            filigree(p, [(sc(15), sc(-46)), (sc(17), sc(-30)), (sc(14), sc(-20))], trim, amp=1.3 * k, seed=2)
            filigree(p, [(sc(-12), sc(-19)), (sc(14), sc(-19))], trim, amp=1.1 * k, seed=3)
            p.ellipse(sc(1), sc(-40), sc(5.5), sc(5.5), trim, mat='gold', dome=1.6)
            p.ellipse(sc(1), sc(-40), sc(3.8), sc(3.8), steel_dk, mat='metal', h=-0.5)
            p.glow(sc(1), sc(-40), sc(1.8), sc(1.8), S['eye'], halo=3.0, strength=0.8)
            rivets(p, [(sc(x), sc(y)) for (x, y) in ((-11, -52), (13, -52), (-15, -36), (17, -36), (-12, -24), (14, -24))], 1.1 * k, trim)
            dents(p, bp, 3, 15, steel, r=2.4)
            scratches(p, bp, 10, 16, steel_lt, steel_dk, length=5)
            # tattered dark tabard
            tab = [(sc(-7), sc(-20)), (sc(7), sc(-20)), (sc(9), sc(4)), (sc(-9), sc(4))]
            p.poly(tab, cloth, mat='cloth', h=0.6)
            folds(p, [((sc(-4), sc(-18)), (sc(-5), sc(2))), ((sc(4), sc(-18)), (sc(5), sc(2)))], cloth_dk, None, width=1.2)
            tatter(p, [(sc(9), sc(4)), (sc(-9), sc(4))], 17, depth=5, holes=3, region=tab)
            # belt with skull-ish buckle and hanging chains
            p.poly([(sc(-16), sc(-15)), (sc(16), sc(-15)), (sc(16), sc(-8)), (sc(-16), sc(-8))], leather, mat='leather', h=1.6)
            p.poly([(sc(-4), sc(-16)), (sc(4), sc(-16)), (sc(4), sc(-7)), (sc(-4), sc(-7))], trim, mat='gold', h=2.2)
            p.ellipse(0, sc(-11.5), sc(2), sc(2.2), steel_dk, mat='metal', h=-0.4)
            chain(p, [(sc(-14), sc(-9)), (sc(-12), sc(2)), (sc(-8), sc(6))], link=2.2 * k, seed=1)
            chain(p, [(sc(14), sc(-9)), (sc(13), sc(0)), (sc(9), sc(6))], link=2.2 * k, seed=2)
            chain(p, [(sc(-14), sc(-50)), (sc(0), sc(-28)), (sc(16), sc(-46))], link=2.4 * k, seed=3)
            # fur mantle over the shoulders
            mantle = [(sc(-17), sc(-48)), (sc(-10), sc(-62)), (sc(6), sc(-64)), (sc(18), sc(-50)), (sc(14), sc(-44)), (sc(0), sc(-50)), (sc(-12), sc(-42))]
            p.poly(mantle, S['fur'], mat='fur', dome=3.0)
            fur(p, mantle, 220, 4.0, 110, 22, S['fur_lt'], S['fur_dark'], seed=18, width=1.3, h=0.16)
            tufts(p, [(sc(-17), sc(-48)), (sc(-10), sc(-62)), (sc(6), sc(-64)), (sc(18), sc(-50))], 9, 5, 250, S['fur'], S['fur_dark'], seed=19, width=4.5, h=0.8, spread=18)
            tufts(p, [(sc(-12), sc(-42)), (sc(0), sc(-50)), (sc(14), sc(-44))], 7, 5, 90, S['fur'], S['fur_dark'], seed=20, width=4.0, h=0.6, spread=16)
    torso = save_part(p, outdir, tex_seed=11, **o)

    # ---------------------------------------------------------------- head / helmet
    p = Part(f'{prefix}_head', int(sc(44)), int(sc(50)), (int(sc(20)), int(sc(44))))
    if bony:
        p.ellipse(2, -22, 13, 14, bone, mat='bone', dome=5)
        p.ellipse(0, -28, 11, 8, bone_lt, mat='bone', dome=2.0, alpha=140)             # cranium highlight
        p.poly([(-6, -12), (10, -12), (12, -8), (10, 0), (-4, 0), (-6, -6)], bone_dk, mat='bone', dome=1.5)   # jaw
        p.poly([(-4, -14), (12, -14), (13, -9), (-5, -9)], mix(bone, bone_dk, 0.5), mat='bone', h=1.0)      # upper teeth bar
        for x in (-2, 1, 4, 7, 10):
            p.poly([(x - 1.1, -9), (x + 1.1, -9), (x + 1.0, -5), (x - 1.0, -5)], bone_lt, mat='bone', h=1.2)
            p.line([(x + 1.2, -9), (x + 1.2, -5)], S['crack'], width=0.4, h=-0.3)
        p.poly([(-4, -4), (10, -4), (10, -1), (-4, -1)], mix(bone, bone_dk, 0.3), mat='bone', h=1.0)          # lower teeth bar
        p.ellipse(8, -24, 4.5, 2.6, mix(bone, bone_dk, 0.4), mat='bone', dome=1.6)      # cheekbone
        p.poly([(-2, -34), (10, -32), (14, -24), (10, -20), (-2, -22)], bone, mat='bone', dome=1.5, alpha=0)  # brow placeholder (no-op)
        p.limb((-6, -30), (13, -28), 3, 3, mix(bone, bone_lt, 0.3), mat='bone', dome=1.8)                      # brow ridge
        for ex in (0, 9):   # eye sockets with sickly green pinpoints
            p.ellipse(ex, -24, 3.8, 3.4, (26, 20, 14), mat='cloth', h=-2.2)
            p.ellipse(ex, -24, 2.6, 2.3, (12, 10, 8), mat='cloth')
            p.glow(ex + 0.4, -23.5, 1.1, 1.1, S['eye'], halo=3.2, strength=0.75)
        p.poly([(11, -19), (15, -17), (14, -13), (11, -14)], (26, 20, 14), mat='cloth', h=-1.6)   # nasal cavity
        cracks(p, [(-10, -34), (12, -34), (12, -14), (-10, -14)], 5, 44, S['crack'], length=6, width=0.5)
        p.shade([(-10, -14), (-9, -28), (-4, -34), (-2, -28), (-4, -14)], bone_dk, alpha=110)   # back of skull in shadow
    elif helmet == 'great':
        helm = [(sc(-14), 0), (sc(-14), sc(-30)), (sc(-8), sc(-40)), (sc(8), sc(-40)), (sc(14), sc(-30)), (sc(14), 0)]
        # mail aventail under the helm
        chainmail(p, [(sc(-14), sc(-6)), (sc(14), sc(-6)), (sc(13), sc(5)), (sc(-13), sc(5))], mail if mail else steel_dk, mail_lt or steel_lt, mail_dk or steel_dk, pitch=2.0 * k, seed=6)
        plate(p, helm, steel, h=3.0, light=steel_lt, dark=steel_dk)
        p.ellipse(0, sc(-22), sc(13), sc(20), steel, mat='metal', dome=3.6)
        # top cap
        plate(p, [(sc(-13), sc(-30)), (sc(-8), sc(-40)), (sc(8), sc(-40)), (sc(13), sc(-30))], mix(steel, steel_lt, 0.15), h=3.6, light=steel_lt, dark=steel_dk)
        # reinforcing bands (brass) + rivets
        band = trim if not heavy else trim
        p.poly([(sc(-1.5), sc(-40)), (sc(1.5), sc(-40)), (sc(1.5), 0), (sc(-1.5), 0)], band, mat='gold', h=1.2)
        p.poly([(sc(-14), sc(-30)), (sc(14), sc(-30)), (sc(14), sc(-27)), (sc(-14), sc(-27))], band, mat='gold', h=1.2)
        rivets(p, [(sc(x), sc(y)) for (x, y) in ((-11, -28.5), (-6, -28.5), (6, -28.5), (11, -28.5), (0, -36), (0, -12), (0, -4))], 0.9 * k, mix(band, (255, 255, 255), 0.2))
        # visor slit with burning glow
        p.poly([(sc(2), sc(-26)), (sc(15), sc(-26)), (sc(15), sc(-22)), (sc(2), sc(-22))], (12, 8, 12), mat='cloth', h=-2.0)
        p.glow(sc(9), sc(-24), sc(5.5), sc(1.3), S['eye'], halo=3.0, strength=1.0)
        p.ellipse(sc(9), sc(-24), sc(3), sc(0.8), mix(S['eye'], (255, 255, 230), 0.5), mat='glow', em=255)
        # breathing holes (cross pattern)
        for (hx, hy) in ((9, -16), (7, -13), (11, -13), (9, -10), (7, -7), (11, -7), (9, -4)):
            p.dot(sc(hx), sc(hy), 0.8 * k, (18, 14, 18), h=-1.0)
        dents(p, helm, 2, 12, steel, r=2.0)
        scratches(p, helm, 8, 13, steel_lt, steel_dk, length=4)
        if heavy:
            # horned helm: dark horns with gold rings
            for (base, mid, tip, w) in (((sc(-11), sc(-34)), (sc(-24), sc(-52)), (sc(-30), sc(-66)), 7), ((sc(10), sc(-36)), (sc(20), sc(-54)), (sc(26), sc(-66)), 6)):
                hc = mix(S['leather'], (120, 100, 80), 0.45)
                p.limb(base, mid, w, w * 0.6, hc, mat='horn', dome=2.4)
                p.limb(mid, tip, w * 0.6, 1.2, mix(hc, (200, 180, 150), 0.35), mat='horn', dome=1.5)
                for t in (0.35, 0.6):
                    cx, cy = base[0] + (mid[0] - base[0]) * t, base[1] + (mid[1] - base[1]) * t
                    p.ellipse(cx, cy, w * 0.55, w * 0.3, trim, mat='gold', h=1.0)
                for t in (0.2, 0.5, 0.8):
                    cx, cy = mid[0] + (tip[0] - mid[0]) * t, mid[1] + (tip[1] - mid[1]) * t
                    p.line([(cx - 2, cy + 1), (cx + 2, cy - 1)], mul(hc, 0.5), width=0.6, h=-0.4)
            filigree(p, [(sc(-12), sc(-8)), (sc(-12), sc(-24))], trim, amp=1.2 * k, seed=4)
            filigree(p, [(sc(12), sc(-8)), (sc(13), sc(-20))], trim, amp=1.0 * k, seed=5)
            p.poly([(sc(-6), sc(-40)), (sc(0), sc(-52)), (sc(6), sc(-40))], steel_dk, mat='metal', dome=1.5)   # crest spike
    else:  # kettle helm with a gaunt face
        skin, skin_dk = S['skin'], S['skin_dark']
        # cloth coif around the face
        p.poly([(-13, -34), (-4, -40), (10, -38), (-10, -4), (-12, 0), (-13, -18)], cloth, mat='cloth', dome=2.0)
        p.poly([(-10, -18), (-12, 0), (14, 0), (12, -18)], cloth, mat='cloth', dome=1.5)
        folds(p, [((-8, -18), (-9, -4)), ((4, -16), (6, -4))], cloth_dk, None, width=1.0)
        # face
        p.ellipse(3, -22, 11, 13, skin, mat='skin', dome=4)
        p.ellipse(7, -17, 5, 6, skin_dk, mat='skin', alpha=120)                      # hollow cheek
        p.shade([(-8, -14), (-2, -10), (2, -4), (-6, -6)], skin_dk, alpha=130)        # jaw shadow
        p.shade([(-6, -34), (6, -36), (13, -30), (4, -30), (-4, -28)], skin_dk, alpha=90)   # under the brim
        p.ellipse(13.5, -20, 2.2, 2.4, mix(skin, skin_dk, 0.5), mat='skin', dome=1.4)   # nose
        p.line([(12, -22), (15, -19)], skin_dk, width=0.6, alpha=160)
        p.line([(7, -12), (13, -11)], mul(skin_dk, 0.6), width=0.7, h=-0.4)            # mouth
        p.ellipse(9, -23, 2.6, 1.8, (28, 20, 16), mat='cloth', h=-1.0)                  # eye socket
        p.dot(9.6, -23, 0.9, (190, 176, 150))
        p.dot(9.8, -23.2, 0.4, (20, 14, 10))
        p.line([(6, -26), (12.5, -26.5)], mul(skin_dk, 0.5), width=0.8, alpha=200)     # brow
        p.stroke((4, -29), (8, -12), 0.9, 0.4, (124, 72, 70), h=-0.4, alpha=210)       # scar
        p.stroke((4.5, -29), (8.5, -12), 0.4, 0.2, (196, 150, 140), alpha=130)
        rs = np.random.RandomState(21)
        for (x, y) in rand_pts(p, [(-2, -14), (12, -12), (12, -5), (0, -5)], 60, rs):    # stubble
            p.dot(x, y, 0.35, mul(skin_dk, 0.55), alpha=170)
        # kettle helm
        brim = [(-18, -26), (-12, -33), (4, -37), (14, -33), (22, -26), (18, -24), (4, -27), (-10, -25), (-16, -23)]
        p.poly([(-13, -32), (-6, -44), (4, -47), (12, -42), (15, -33)], steel, mat='metal', dome=4)     # crown
        plate(p, brim, mix(steel, steel_lt, 0.1), h=1.6, light=steel_lt, dark=steel_dk)
        p.line([(-16, -24), (20, -25)], steel_dk, width=0.8, h=-0.5, alpha=220)
        p.poly([(-4, -47), (0, -50), (6, -46)], steel_dk, mat='metal', dome=1.2)          # top knob
        rivets(p, [(-10, -29), (-2, -32), (8, -31), (16, -28)], 0.8, steel_lt)
        for (x, y, r) in ((-8, -38, 2.2), (9, -39, 1.8), (18, -27, 1.5), (-15, -28, 1.4), (2, -44, 1.6)):   # rust
            p.ellipse(x, y, r, r * 0.7, S['rust'], mat='rust', alpha=200)
            p.ellipse(x + 0.5, y + 0.3, r * 0.5, r * 0.35, mul(S['rust'], 0.6), mat='rust', alpha=200)
        dents(p, [(-13, -32), (-6, -44), (4, -47), (12, -42), (15, -33)], 2, 22, steel, r=1.8)
        scratches(p, brim, 5, 23, steel_lt, steel_dk, length=3)
    head = save_part(p, outdir, tex_seed=12, **o)

    # ---------------------------------------------------------------- arms
    p = Part(f'{prefix}_arm_u', int(sc(30)), int(sc(44)), (int(sc(15)), int(sc(6))))
    if bony:
        bone_limb(p, (0, 0), (0, 30), 6, 5, seed=45)
    else:
        if helmet == 'kettle':
            chainmail(p, [(-6, -2), (6, -2), (6, 32), (-6, 32)], mail, mail_lt, mail_dk, pitch=2.0, seed=7)
            p.shade([(-6, 4), (-3, 4), (-3, 30), (-5, 30)], mail_dk, alpha=120)
            # leather spaulder with studs
            p.ellipse(0, 2, 12, 8, leather, mat='leather', dome=3.5)
            p.poly([(-11, 4), (11, 4), (9, 11), (-9, 11)], mul(leather, 0.85), mat='leather', h=1.6)
            p.line([(-9, 10.5), (9, 10.5)], S['leather_dark'], width=0.7, h=-0.4)
            rivets(p, [(-7, 1), (0, -1), (7, 1), (-5, 8), (5, 8)], 0.8, mix(trim, steel, 0.4))
            scratches(p, [(-11, -4), (11, -4), (9, 11), (-9, 11)], 4, 24, mix(leather, (255, 255, 255), 0.25), S['leather_dark'], length=3)
        else:
            # mail sleeve + rerebrace plate + pauldron with a spike
            chainmail(p, [(sc(-6), sc(-2)), (sc(6), sc(-2)), (sc(6), sc(34)), (sc(-6), sc(34))], mail if mail else steel_dk, mail_lt or steel_lt, mail_dk or steel_dk, pitch=2.0 * k, seed=8)
            plate(p, [(sc(-6), sc(10)), (sc(6), sc(10)), (sc(5), sc(28)), (sc(-5), sc(28))], steel, h=2.2, light=steel_lt, dark=steel_dk)
            p.limb((0, sc(12)), (0, sc(26)), sc(10), sc(8), steel, mat='metal', dome=2.6)
            p.poly([(sc(-5.5), sc(26)), (sc(5.5), sc(26)), (sc(5), sc(29)), (sc(-5), sc(29))], leather, mat='leather', h=1.4)   # strap
            p.ellipse(0, sc(2), sc(13), sc(9), steel, mat='metal', dome=4.5)       # pauldron
            plate(p, [(sc(-11), sc(5)), (sc(11), sc(5)), (sc(9), sc(12)), (sc(-9), sc(12))], mix(steel, steel_dk, 0.2), h=1.8, light=steel_lt, dark=steel_dk)  # lame
            p.poly([(sc(-9), sc(-1)), (sc(-15), sc(0)), (sc(-8), sc(4))], mix(steel, steel_lt, 0.2), mat='metal', dome=1.4)   # spike (back)
            p.poly([(sc(-9), sc(-1)), (sc(-14.4), sc(0)), (sc(-9), sc(1))], steel_lt, mat='metal', alpha=160)
            if heavy:
                p.poly([(sc(2), sc(-5)), (sc(5), sc(-6)), (sc(7), sc(2))], mix(steel, steel_lt, 0.2), mat='metal', dome=1.2)   # second spike
                filigree(p, [(sc(-10), sc(8)), (sc(10), sc(8))], trim, amp=1.0 * k, seed=6)
                p.ellipse(0, sc(0), sc(4), sc(3), trim, mat='gold', dome=1.2)
                tufts(p, [(sc(-12), sc(-2)), (sc(-4), sc(-5)), (sc(6), sc(-4))], 6, 4, 280, S['fur'], S['fur_dark'], seed=25, width=3.5, h=0.6, spread=20)
            else:
                p.line([(sc(-9), sc(1)), (sc(9), sc(1))], steel_lt, width=0.9, h=0.6, alpha=170)   # pauldron ridge
            rivets(p, [(sc(-6), sc(8.5)), (sc(0), sc(9)), (sc(6), sc(8.5)), (sc(0), sc(-2))], 0.9 * k, steel_lt)
            dents(p, [(sc(-11), sc(-5)), (sc(11), sc(-5)), (sc(9), sc(8)), (sc(-9), sc(8))], 2, 26, steel, r=1.6)
            scratches(p, [(sc(-11), sc(-5)), (sc(11), sc(-5)), (sc(5), sc(28)), (sc(-5), sc(28))], 6, 27, steel_lt, steel_dk, length=3)
    arm_u = save_part(p, outdir, tex_seed=13, **o)

    p = Part(f'{prefix}_arm_l', int(sc(26)), int(sc(50)), (int(sc(13)), int(sc(6))))
    if bony:
        bone_limb(p, (-1.5, 0), (-1, 30), 4.2, 3.5, seed=46)
        p.limb((2.5, 2), (2.5, 28), 2.2, 2.0, mix(bone, bone_dk, 0.3), mat='bone', dome=1.0)    # second forearm bone
        p.ellipse(0, 33, 4, 4, bone, mat='bone', dome=1.8)                                        # carpals
        for i, fx in enumerate((-3, -1, 1, 3)):
            p.limb((fx, 35), (fx * 1.2, 41 + (i % 2)), 1.4, 1.1, bone, mat='bone', dome=0.6)
    else:
        if helmet == 'kettle':
            chainmail(p, [(-5.5, -2), (5.5, -2), (5, 30), (-5, 30)], mail, mail_lt, mail_dk, pitch=2.0, seed=9)
            wraps(p, (0, 8), (0, 28), 11, 5, mix(cloth, (200, 190, 170), 0.55), cloth_dk, mix(cloth, (255, 255, 255), 0.5), mat='cloth')
            p.ellipse(0, 34, 6, 6, leather, mat='leather', dome=3)    # glove
            p.poly([(-5, 29), (5, 29), (5, 32), (-5, 32)], S['leather_dark'], mat='leather', h=1.2)
            for fx in (-3, 0, 3):
                p.line([(fx, 34), (fx, 39)], S['leather_dark'], width=0.6, h=-0.4, alpha=200)
        else:
            chainmail(p, [(sc(-5.5), sc(-2)), (sc(5.5), sc(-2)), (sc(5), sc(32)), (sc(-5), sc(32))], mail if mail else steel_dk, mail_lt or steel_lt, mail_dk or steel_dk, pitch=2.0 * k, seed=10)
            p.ellipse(0, sc(2), sc(6.5), sc(5), steel, mat='metal', dome=2.8)           # couter (elbow)
            p.limb((0, sc(6)), (0, sc(28)), sc(11), sc(9.5), steel, mat='metal', dome=3.2)   # vambrace
            p.line([(sc(-1), sc(8)), (sc(-1), sc(26))], steel_lt, width=1.0, h=0.7, alpha=190)
            p.line([(sc(0.6), sc(8)), (sc(0.6), sc(26))], steel_dk, width=0.6, alpha=150)
            p.poly([(sc(-5.5), sc(27)), (sc(5.5), sc(27)), (sc(5.5), sc(30)), (sc(-5.5), sc(30))], leather, mat='leather', h=1.2)   # strap
            # gauntlet: cuff + finger lames
            p.ellipse(0, sc(34), sc(6.5), sc(6.5), steel, mat='metal', dome=3.0)
            plate(p, [(sc(-6), sc(29)), (sc(6), sc(29)), (sc(6.5), sc(34)), (sc(-6.5), sc(34))], mix(steel, steel_lt, 0.1), h=2.0, light=steel_lt, dark=steel_dk)
            for fy in (36.5, 38.5, 40.5):
                p.line([(sc(-4.5), sc(fy)), (sc(4.5), sc(fy))], steel_dk, width=0.6, h=-0.5, alpha=220)
            for fx in (-2.2, 0, 2.2):
                p.line([(sc(fx), sc(35)), (sc(fx), sc(41))], steel_dk, width=0.5, h=-0.4, alpha=200)
            rivets(p, [(sc(-4), sc(31.5)), (sc(4), sc(31.5))], 0.8 * k, steel_lt)
            if heavy:
                filigree(p, [(sc(-4), sc(8)), (sc(-4), sc(26))], trim, amp=1.0 * k, seed=7, curls=False)
                p.poly([(sc(-4), sc(33)), (sc(-9), sc(31)), (sc(-4), sc(37))], steel, mat='metal', dome=1.0)   # knuckle spike
            dents(p, [(sc(-5), sc(8)), (sc(5), sc(8)), (sc(4.5), sc(26)), (sc(-4.5), sc(26))], 2, 28, steel, r=1.5)
            scratches(p, [(sc(-5), sc(8)), (sc(5), sc(8)), (sc(4.5), sc(26)), (sc(-4.5), sc(26))], 5, 29, steel_lt, steel_dk, length=3)
    arm_l = save_part(p, outdir, tex_seed=14, **o)

    # ---------------------------------------------------------------- legs
    p = Part(f'{prefix}_leg_u', int(sc(30)), int(sc(46)), (int(sc(15)), int(sc(6))))
    if bony:
        bone_limb(p, (0, 0), (0, 32), 7, 5.5, knob0=1.5, seed=47)
    else:
        if helmet == 'kettle':
            p.limb((0, 0), (0, 32), 16, 11, cloth, mat='cloth', dome=4)
            folds(p, [((-4, 4), (-5, 28)), ((4, 6), (3, 26))], cloth_dk, mix(cloth, (255, 255, 255), 0.2), width=1.2)
            p.shade([(-8, 2), (-4, 2), (-4, 30), (-6, 30)], cloth_dk, alpha=120)
            p.poly([(-8, 0), (8, 0), (7, 10), (-7, 10)], leather, mat='leather', h=1.4)        # leather skirt flap
            p.line([(-7, 9.5), (7, 9.5)], S['leather_dark'], width=0.7, h=-0.4)
            rivets(p, [(-4, 5), (4, 5)], 0.8, mix(trim, steel, 0.4))
            wraps(p, (0, 24), (0, 34), 11, 2, leather, S['leather_dark'], mat='leather')      # knee straps
        else:
            plate(p, [(sc(-8), sc(2)), (sc(8), sc(2)), (sc(6.5), sc(30)), (sc(-6.5), sc(30))], steel, h=2.0, light=steel_lt, dark=steel_dk)
            p.limb((0, sc(4)), (0, sc(28)), sc(16), sc(11), steel, mat='metal', dome=3.6)   # cuisse
            p.line([(sc(-1), sc(6)), (sc(-1), sc(26))], steel_lt, width=1.0, h=0.7, alpha=180)
            p.poly([(sc(-8), sc(0)), (sc(8), sc(0)), (sc(7), sc(14)), (sc(-7), sc(14))], cloth, mat='cloth', h=0.8)   # tabard skirt remnant
            folds(p, [((sc(-3), sc(1)), (sc(-4), sc(13))), ((sc(3), sc(1)), (sc(4), sc(13)))], cloth_dk, None, width=1.0)
            tatter(p, [(sc(7), sc(14)), (sc(-7), sc(14))], 30, depth=3)
            p.ellipse(0, sc(31), sc(6.5), sc(5), steel, mat='metal', dome=2.8)              # poleyn (knee)
            p.poly([(sc(-7), sc(27)), (sc(7), sc(27)), (sc(7), sc(29.5)), (sc(-7), sc(29.5))], leather, mat='leather', h=1.2)
            rivets(p, [(sc(-5), sc(18)), (sc(5), sc(18))], 0.9 * k, steel_lt)
            if heavy:
                filigree(p, [(sc(-6), sc(16)), (sc(6), sc(16))], trim, amp=1.0 * k, seed=8)
            dents(p, [(sc(-6), sc(8)), (sc(6), sc(8)), (sc(5), sc(26)), (sc(-5), sc(26))], 2, 31, steel, r=1.6)
            scratches(p, [(sc(-6), sc(8)), (sc(6), sc(8)), (sc(5), sc(26)), (sc(-5), sc(26))], 5, 32, steel_lt, steel_dk, length=3)
    leg_u = save_part(p, outdir, tex_seed=15, **o)

    p = Part(f'{prefix}_leg_l', int(sc(34)), int(sc(52)), (int(sc(12)), int(sc(6))))
    if bony:
        bone_limb(p, (-1, 0), (-1, 34), 5.5, 4.5, seed=48)
        p.limb((2.5, 4), (2.5, 32), 2.2, 2.0, mix(bone, bone_dk, 0.3), mat='bone', dome=1.0)   # fibula
        # foot bones
        p.poly([(-5, 34), (6, 35), (12, 37), (12, 40), (-5, 40)], bone_dk, mat='bone', dome=1.5)
        for i, fx in enumerate((2, 5, 8, 11)):
            p.limb((fx - 2, 36), (fx, 40), 1.6, 1.3, bone, mat='bone', dome=0.6)
        p.ellipse(-2, 36, 3.5, 2.8, bone, mat='bone', dome=1.5)
    else:
        if helmet == 'kettle':
            p.limb((0, 0), (0, 30), 12, 9, cloth, mat='cloth', dome=3.5)
            wraps(p, (0, 4), (0, 30), 11, 6, mix(cloth, (200, 190, 170), 0.55), cloth_dk, mix(cloth, (255, 255, 255), 0.5), mat='cloth')
            p.poly([(-7, 28), (12, 31), (14, 36), (14, 40), (-7, 40)], leather, mat='leather', dome=2.5)   # boot
            p.poly([(-7, 28), (6, 29), (6, 33), (-7, 33)], mul(leather, 0.8), mat='leather', h=1.2)          # cuff
            p.line([(-6, 39), (13, 39)], S['leather_dark'], width=0.8, h=-0.4)
            p.shade([(6, 31), (13, 32), (14, 36), (8, 36)], S['leather_dark'], alpha=110)
        else:
            plate(p, [(sc(-6), sc(2)), (sc(6), sc(2)), (sc(4.5), sc(30)), (sc(-4.5), sc(30))], steel, h=2.0, light=steel_lt, dark=steel_dk)
            p.limb((0, sc(4)), (0, sc(28)), sc(12), sc(9), steel, mat='metal', dome=3.0)      # greave
            p.line([(sc(-1), sc(6)), (sc(-1), sc(26))], steel_lt, width=1.0, h=0.7, alpha=180)
            p.line([(sc(0.6), sc(6)), (sc(0.6), sc(26))], steel_dk, width=0.6, alpha=140)
            p.poly([(sc(-5.5), sc(10)), (sc(5.5), sc(10)), (sc(5.5), sc(12.5)), (sc(-5.5), sc(12.5))], leather, mat='leather', h=1.2)
            p.poly([(sc(-5), sc(22)), (sc(5), sc(22)), (sc(5), sc(24.5)), (sc(-5), sc(24.5))], leather, mat='leather', h=1.2)
            # sabaton over a leather boot
            p.poly([(sc(-7), sc(30)), (sc(14), sc(32)), (sc(14), sc(40)), (sc(-7), sc(40))], leather, mat='leather', dome=2.2)
            for i, (x0, x1) in enumerate(((-6, 2), (1, 8), (6, 13))):
                plate(p, [(sc(x0), sc(31 + i * 0.6)), (sc(x1), sc(31.5 + i * 0.8)), (sc(x1), sc(36 + i * 0.8)), (sc(x0), sc(36 + i * 0.6))], mix(steel, steel_dk, 0.1 + i * 0.05), h=1.6 - i * 0.2, light=steel_lt, dark=steel_dk)
            p.poly([(sc(11), sc(32)), (sc(14), sc(33)), (sc(14), sc(39)), (sc(10), sc(39))], steel, mat='metal', dome=1.5)   # toe cap
            if heavy:
                filigree(p, [(sc(-4), sc(14)), (sc(-4), sc(22))], trim, amp=0.9 * k, seed=9, curls=False)
                p.poly([(sc(-1), sc(31)), (sc(2), sc(26)), (sc(4), sc(31))], steel, mat='metal', dome=1.0)   # shin spike
            dents(p, [(sc(-5), sc(6)), (sc(5), sc(6)), (sc(4), sc(26)), (sc(-4), sc(26))], 2, 33, steel, r=1.4)
            scratches(p, [(sc(-5), sc(6)), (sc(5), sc(6)), (sc(4), sc(26)), (sc(-4), sc(26))], 5, 34, steel_lt, steel_dk, length=3)
    leg_l = save_part(p, outdir, tex_seed=16, **o)

    # ---------------------------------------------------------------- weapon (pivot at the grip)
    wparts = {}
    wo = dict(outline=S['outline'], rim=0.6, ao=0.5, noise=0.04, round_r=4, shape_k=0.7)
    if weapon == 'sword':
        p = Part(f'{prefix}_weapon', int(sc(24)), int(sc(96)), (int(sc(12)), int(sc(78))))
        bl, bl_lt, bl_dk = (176, 182, 194), (226, 230, 238), (108, 112, 126)
        p.poly([(sc(-3), sc(-66)), (0, sc(-74)), (sc(3), sc(-66)), (sc(3), sc(-8)), (sc(-3), sc(-8))], bl, mat='metal', dome=1.6)
        p.poly([(sc(-3), sc(-66)), (0, sc(-74)), (0, sc(-8)), (sc(-3), sc(-8))], bl_lt, mat='metal', alpha=120)   # lit bevel
        p.poly([(0, sc(-74)), (sc(3), sc(-66)), (sc(3), sc(-8)), (0, sc(-8))], bl_dk, mat='metal', alpha=90)      # shadow bevel
        p.poly([(sc(-0.9), sc(-62)), (sc(0.9), sc(-62)), (sc(0.9), sc(-12)), (sc(-0.9), sc(-12))], bl_dk, mat='metal', h=-0.8)   # fuller
        p.line([(sc(-1.1), sc(-62)), (sc(-1.1), sc(-12))], bl_lt, width=0.4, alpha=200)
        p.line([(sc(-2.6), sc(-64)), (sc(-2.6), sc(-9))], (240, 244, 250), width=0.5, alpha=220)   # edge highlight
        scratches(p, [(sc(-3), sc(-60)), (sc(3), sc(-60)), (sc(3), sc(-12)), (sc(-3), sc(-12))], 6, 35, bl_lt, bl_dk, length=3, width=0.4)
        p.erase([(sc(3.2), sc(-40)), (sc(2.0), sc(-39)), (sc(3.2), sc(-37.5))])   # notch
        # cross-guard with knobbed ends and ecusson
        p.poly([(sc(-10), sc(-8.5)), (sc(10), sc(-8.5)), (sc(10), sc(-4)), (sc(-10), sc(-4))], trim, mat='gold', dome=1.8)
        p.ellipse(sc(-10), sc(-6.2), sc(2), sc(2.6), trim, mat='gold', dome=1.2)
        p.ellipse(sc(10), sc(-6.2), sc(2), sc(2.6), trim, mat='gold', dome=1.2)
        p.poly([(sc(-3), sc(-8.5)), (sc(3), sc(-8.5)), (0, sc(-12))], trim, mat='gold', dome=1.0)
        p.line([(sc(-9), sc(-7.5)), (sc(9), sc(-7.5))], mix(trim, (255, 255, 255), 0.4), width=0.5, alpha=200)
        p.line([(sc(-9), sc(-4.6)), (sc(9), sc(-4.6))], mul(trim, 0.5), width=0.5, alpha=200)
        # wrapped grip
        p.poly([(sc(-2.5), sc(-4)), (sc(2.5), sc(-4)), (sc(2.5), sc(10)), (sc(-2.5), sc(10))], leather, mat='leather', dome=1.4)
        for i in range(7):
            y = sc(-3 + i * 2)
            p.line([(sc(-2.5), y + sc(1.2)), (sc(2.5), y)], mul(leather, 0.55), width=0.6, h=-0.4)
            p.line([(sc(-2.5), y + sc(1.9)), (sc(2.5), y + sc(0.7))], mix(leather, (255, 255, 255), 0.25), width=0.4, alpha=150)
        p.ellipse(0, sc(13), sc(3.5), sc(3.5), trim, mat='gold', dome=2.0)   # pommel
        p.dot(0, sc(13), 1.2 * k, mul(trim, 0.5), h=-0.5)
        wparts['weapon'] = dict(tex=f'{prefix}_weapon', pivot=(int(sc(12)), int(sc(78))), reach=sc(74))
        save_part(p, outdir, tex_seed=17, **wo)
    elif weapon == 'spear':
        p = Part(f'{prefix}_weapon', 20, 150, (10, 110))
        wood, wood_dk = (104, 76, 46), (58, 40, 24)
        p.limb((0, -100), (0, 36), 4, 4, wood, mat='wood', dome=1.8)
        for x in (-1.2, 0.6):   # grain
            p.line([(x, -96), (x + 0.3, 30)], wood_dk, width=0.4, h=-0.2, alpha=160)
        p.line([(-1.6, -96), (-1.6, 30)], mix(wood, (255, 240, 200), 0.3), width=0.4, alpha=150)
        # leaf blade with a central ridge
        p.poly([(-5, -102), (-2, -122), (0, -132), (2, -122), (5, -102), (0, -96)], (196, 200, 210), mat='metal', dome=2.0)
        p.poly([(-5, -102), (-2, -122), (0, -132), (0, -96)], (232, 236, 242), mat='metal', alpha=120)
        p.poly([(0, -132), (2, -122), (5, -102), (0, -96)], (120, 124, 136), mat='metal', alpha=100)
        p.line([(0, -130), (0, -98)], (240, 244, 250), width=0.6, h=0.6, alpha=220)
        p.poly([(-3, -102), (3, -102), (2.2, -88), (-2.2, -88)], (150, 152, 160), mat='metal', dome=1.4)   # socket
        wraps(p, (0, -88), (0, -74), 5.2, 5, (150, 120, 80), (80, 60, 36), mix((150, 120, 80), (255, 255, 255), 0.3), mat='leather', tilt=0.3)  # binding
        p.poly([(-3, 30), (3, 30), (2.5, 38), (-2.5, 38)], (120, 122, 130), mat='metal', dome=1.2)   # butt cap
        p.poly([(-4, 0), (4, 0), (4, 12), (-4, 12)], leather, mat='leather', dome=1.2)               # grip
        for i in range(5):
            p.line([(-4, 1 + i * 2.3), (4, 0.2 + i * 2.3)], S['leather_dark'], width=0.5, h=-0.3)
        scratches(p, [(-5, -120), (5, -120), (5, -100), (-5, -100)], 3, 36, (240, 244, 250), (120, 124, 136), length=3, width=0.4)
        wparts['weapon'] = dict(tex=f'{prefix}_weapon', pivot=(10, 110), reach=130)
        save_part(p, outdir, tex_seed=17, **wo)
    elif weapon == 'rusty':
        p = Part(f'{prefix}_weapon', 24, 80, (12, 64))
        bl, bl_dk = (156, 138, 112), (96, 80, 62)
        blade = [(-3, -54), (2, -58), (4, -50), (3, -8), (-3, -8)]
        p.poly(blade, bl, mat='metal', dome=1.4)
        p.poly([(-3, -54), (2, -58), (0, -56), (0, -8), (-3, -8)], mix(bl, (255, 255, 240), 0.3), mat='metal', alpha=110)
        p.line([(0.3, -52), (0.3, -12)], bl_dk, width=0.7, h=-0.5, alpha=200)   # fuller
        rs = np.random.RandomState(37)
        for (x, y) in rand_pts(p, blade, 7, rs):   # rust blotches
            r = rs.uniform(1.0, 2.2)
            p.ellipse(x, y, r, r * 0.6, S['rust'], mat='rust', alpha=210)
            p.ellipse(x + 0.4, y + 0.3, r * 0.45, r * 0.3, mul(S['rust'], 0.55), mat='rust', alpha=200)
        for (x, y) in rand_pts(p, blade, 25, rs):   # pitting
            p.dot(x, y, 0.35, bl_dk, h=-0.5, alpha=200)
        for (y, d) in ((-46, 1.6), (-36, 2.2), (-27, 1.4), (-18, 2.0)):   # notches on the edge
            p.erase([(4.2, y - d), (4 - d, y), (4.2, y + d)])
        p.erase([(-3.2, -42), (-3 + 1.2, -41), (-3.2, -39.5)])
        p.poly([(-8, -8), (8, -8), (8, -5), (-8, -5)], S['rust'], mat='rust', dome=1.6)   # rusted guard
        p.poly([(-8, -8), (8, -8), (8, -6.8), (-8, -6.8)], mix(S['rust'], (255, 220, 180), 0.3), mat='rust', alpha=140)
        p.poly([(-2, -5), (2, -5), (2, 10), (-2, 10)], S['rag'], mat='cloth', dome=1.2)   # rag-wrapped grip
        for i in range(6):
            p.line([(-2.2, -3 + i * 2.2), (2.2, -4 + i * 2.2)], S['rag_dark'], width=0.6, h=-0.3)
        p.poly([(-2.5, 9), (2.5, 9), (2, 12), (-2, 12)], S['rust'], mat='rust', dome=1.0)
        wparts['weapon'] = dict(tex=f'{prefix}_weapon', pivot=(12, 64), reach=58)
        save_part(p, outdir, tex_seed=17, **wo)
    elif weapon == 'axe':
        p = Part(f'{prefix}_weapon', 70, 130, (35, 100))
        haft, haft_dk = (52, 38, 30), (26, 18, 14)
        iron, iron_lt, iron_dk = (66, 62, 76), (124, 120, 138), (30, 28, 36)
        p.limb((0, -92), (0, 28), 7, 6, haft, mat='wood', dome=3.0)
        p.line([(-1.5, -88), (-1.5, 24)], mix(haft, (255, 230, 200), 0.25), width=0.6, alpha=140)
        p.line([(1.5, -88), (1.5, 24)], haft_dk, width=0.6, h=-0.3, alpha=180)
        for y in (-36, -20, 10):   # iron bands
            p.poly([(-4, y), (4, y), (4, y + 4), (-4, y + 4)], iron, mat='metal', dome=1.2)
            rivets(p, [(-2, y + 2), (2, y + 2)], 0.7, iron_lt)
        chain(p, [(-5, -34), (3, -26), (-4, -16)], link=2.2, seed=4)
        # double blades with curved edges
        for side in (-1, 1):
            edge = [(side * 24, -97), (side * 31, -88), (side * 35, -74), (side * 35, -56), (side * 31, -42), (side * 22, -34)]
            blade = [(0, -84), (side * 10, -92)] + edge + [(side * 8, -40), (0, -48)]
            p.poly(blade, iron, mat='metal', dome=2.8)
            # polished edge bevel
            inner = [(side * 21, -92), (side * 27, -84), (side * 30, -72), (side * 30, -58), (side * 27, -46), (side * 19, -39)]
            p.poly(edge + inner[::-1], iron_lt, mat='metal', alpha=150)
            p.line(edge, (226, 226, 238), width=0.8, alpha=230)
            filigree(p, [(side * 6, -86), (side * 18, -88), (side * 24, -70), (side * 24, -58), (side * 18, -42), (side * 6, -46)], trim, amp=1.4, seed=10 + side, width=0.8)
            # glowing rune
            rx = side * 15
            for (a, b) in (((rx - 4, -70), (rx + 4, -56)), ((rx + 4, -70), (rx - 4, -56)), ((rx - 5, -63), (rx + 5, -63))):
                p.line([a, b], S['eye'], width=1.3, mat='glow')
                p.dem.line([p.P(*a), p.P(*b)], fill=255, width=int(1.3 * SS))
            p.glows.append((rx, -63, 9, S['eye'], 0.7))
            scratches(p, [(side * 6, -86), (side * 28, -80), (side * 28, -46), (side * 6, -42)], 6, 38 + side, iron_lt, iron_dk, length=4)
            dents(p, [(side * 6, -86), (side * 28, -80), (side * 28, -46), (side * 6, -42)], 2, 39 + side, iron, r=1.8)
        p.poly([(-5, -92), (0, -116), (5, -92)], iron, mat='metal', dome=1.6)   # top spike
        p.poly([(-5, -92), (0, -116), (0, -92)], iron_lt, mat='metal', alpha=120)
        p.poly([(-6, -94), (6, -94), (6, -88), (-6, -88)], trim, mat='gold', dome=1.2)   # collar
        wparts['weapon'] = dict(tex=f'{prefix}_weapon', pivot=(35, 100), reach=110)
        save_part(p, outdir, tex_seed=17, **wo)
    if shield:
        p = Part(f'{prefix}_shield', int(sc(40)), int(sc(52)), (int(sc(20)), int(sc(24))))
        rim_pts = [(sc(-18), sc(-22)), (sc(18), sc(-22)), (sc(18), sc(2)), (0, sc(26)), (sc(-18), sc(2))]
        plate(p, rim_pts, steel_dk, h=2.0, light=steel, dark=mul(steel_dk, 0.6))
        p.poly(rim_pts, steel_dk, mat='metal', dome=3.0, alpha=0)
        field = [(sc(-14), sc(-18)), (sc(14), sc(-18)), (sc(14), 0), (0, sc(20)), (sc(-14), 0)]
        p.poly(field, cloth, mat='cloth', h=0.4)
        p.ellipse(0, sc(-2), sc(13), sc(16), cloth, mat='cloth', dome=2.5, alpha=0)
        # worn emblem (faded, chipped) + chevron
        device(p, 0, sc(-5), sc(8), mix(trim, cloth, 0.3), alpha=215, h=0.4)
        p.poly([(sc(-12), sc(2)), (0, sc(-4)), (sc(12), sc(2)), (sc(12), sc(5)), (0, sc(-1)), (sc(-12), sc(5))], mix(trim, cloth, 0.3), mat='cloth', alpha=200)
        folds(p, [((sc(-10), sc(-14)), (sc(-8), sc(6))), ((sc(9), sc(-12)), (sc(7), sc(6)))], cloth_dk, None, width=1.0)
        rivets(p, [(sc(x), sc(y)) for (x, y) in ((-16, -20), (0, -20), (16, -20), (-16, -6), (16, -6), (-9, 12), (9, 12), (0, 23))], 0.9 * k, steel_lt)
        scratches(p, field, 7, 40, mix(cloth, (255, 255, 255), 0.3), cloth_dk, length=4)
        scratches(p, rim_pts, 4, 41, steel_lt, mul(steel_dk, 0.6), length=3)
        dents(p, field, 3, 42, cloth, r=2.0)
        p.erase([(sc(18.5), sc(-10)), (sc(15.5), sc(-8)), (sc(18.5), sc(-6))])   # chipped rim
        p.erase([(sc(-18.5), sc(-2)), (sc(-16), sc(0)), (sc(-18.5), sc(2))])
        wparts['shield'] = dict(tex=f'{prefix}_shield', pivot=(int(sc(20)), int(sc(24))))
        save_part(p, outdir, tex_seed=18, **wo)

    spec = dict(
        torso=dict(tex=f'{prefix}_torso', pivot=(int(sc(28)), int(sc(72))), shoulder=(sc(2), sc(-54)), neck=(sc(0), sc(-60)), hip=(0, 0)),
        head=dict(tex=f'{prefix}_head', pivot=(int(sc(20)), int(sc(44)))),
        arm_u=dict(tex=f'{prefix}_arm_u', pivot=(int(sc(15)), int(sc(6))), len=sc(30)),
        arm_l=dict(tex=f'{prefix}_arm_l', pivot=(int(sc(13)), int(sc(6))), len=sc(32), hand=(0, sc(34))),
        leg_u=dict(tex=f'{prefix}_leg_u', pivot=(int(sc(15)), int(sc(6))), len=sc(32)),
        leg_l=dict(tex=f'{prefix}_leg_l', pivot=(int(sc(12)), int(sc(6))), len=sc(40)),
        hip_offset=(0, 0),
    )
    spec.update(wparts)
    return humanoid_rig(prefix, spec, height=int(sc(132)), hunch=4 if not bony else 10)


def humanoid_rig(name, spec, height, hunch=0):
    """Build the rig JSON: parts with parent, attach point (in parent local px), pivot, z-order."""
    T = spec['torso']
    parts = []

    def add(pname, tex, parent, at, pivot, z, length=0, flip_far=False):
        parts.append(dict(name=pname, tex=tex, parent=parent, at=list(at), pivot=list(pivot), z=z, len=length))

    hx, hy = spec.get('hip_offset', (0, 0))
    # root is the hip. z order: far limbs < tail < torso < head < near limbs < weapon
    add('torso', T['tex'], None, (hx, hy), T['pivot'], 10)
    add('head', spec['head']['tex'], 'torso', T['neck'], spec['head']['pivot'], 12)
    sh = T['shoulder']
    au, al = spec['arm_u'], spec['arm_l']
    add('arm_u_far', au['tex'], 'torso', (sh[0] - 6, sh[1] + 2), au['pivot'], 4, au['len'])
    add('arm_l_far', al['tex'], 'arm_u_far', (0, au['len']), al['pivot'], 5, al['len'])
    add('arm_u_near', au['tex'], 'torso', (sh[0] + 4, sh[1]), au['pivot'], 20, au['len'])
    add('arm_l_near', al['tex'], 'arm_u_near', (0, au['len']), al['pivot'], 21, al['len'])
    lu, ll = spec['leg_u'], spec['leg_l']
    add('leg_u_far', lu['tex'], None, (hx - 6, hy + 2), lu['pivot'], 2, lu['len'])
    add('leg_l_far', ll['tex'], 'leg_u_far', (0, lu['len']), ll['pivot'], 3, ll['len'])
    add('leg_u_near', lu['tex'], None, (hx + 6, hy), lu['pivot'], 14, lu['len'])
    add('leg_l_near', ll['tex'], 'leg_u_near', (0, lu['len']), ll['pivot'], 15, ll['len'])
    if 'tail' in spec:
        t1, t2 = spec['tail']
        add('tail1', t1['tex'], None, (hx - 8, hy - 4), t1['pivot'], 6, t1['len'])
        add('tail2', t2['tex'], 'tail1', (0, t1['len']), t2['pivot'], 7, t2['len'])
    if 'weapon' in spec:
        w = spec['weapon']
        add('weapon', w['tex'], 'arm_l_near', al['hand'], w['pivot'], 22)
    if 'shield' in spec:
        s = spec['shield']
        add('shield', s['tex'], 'arm_l_far', (0, al['len'] * 0.6), s['pivot'], 5.5)
    return dict(name=name, height=height, hunch=hunch, parts=parts,
                reach=spec.get('weapon', {}).get('reach', 0), leg_len=lu['len'] + ll['len'])



# ------------------------------------------------------------------ bat ----

def bat_parts(outdir):
    body, body_lt, dark = (72, 56, 70), (120, 98, 112), (34, 24, 36)
    mem, mem_lt, vein = (96, 62, 86), (150, 104, 128), (40, 22, 40)
    o = dict(outline=(12, 8, 14), rim=0.5, ao=0.5, noise=0.08, round_r=6, shape_k=0.7)
    p = Part('bat_body', 36, 30, (18, 14))
    p.ellipse(0, 0, 12, 9, body, mat='fur', dome=4)
    p.ellipse(-3, 1, 7, 5.5, mix(body, body_lt, 0.3), dome=1.5)
    # ears
    p.poly([(-8, -6), (-14, -18), (-4, -8)], dark, mat='fur', dome=1.2)
    p.poly([(2, -8), (6, -18), (8, -6)], dark, mat='fur', dome=1.2)
    p.poly([(-8, -7), (-12, -15), (-6, -8)], mix(dark, (160, 90, 110), 0.4), mat='skin', alpha=200)
    p.poly([(3, -8), (6, -15), (7, -7)], mix(dark, (160, 90, 110), 0.4), mat='skin', alpha=200)
    # fuzz
    fur(p, [(-12, -8), (12, -8), (12, 9), (-12, 9)], 170, 2.6, 100, 30, body_lt, dark, seed=31, width=0.9, h=0.12)
    tufts(p, [(-11, 2), (-6, 8), (2, 9), (9, 6)], 7, 2.5, 110, body, dark, seed=32, width=2.0, h=0.4, spread=20)
    tufts(p, [(-9, -7), (-2, -9)], 3, 2.5, 270, body, dark, seed=33, width=2.0, h=0.4, spread=20)
    # face: red eyes, snub nose, tiny fangs
    for ex in (1, 7):
        p.ellipse(ex, -2, 2.4, 2.2, (26, 12, 16), mat='cloth', h=-0.8)
        p.glow(ex + 0.3, -2, 1.5, 1.4, (255, 70, 50), halo=2.6, strength=0.8)
        p.dot(ex + 0.7, -2.4, 0.5, (255, 220, 200))
    p.ellipse(11, 1, 2, 1.6, mix(dark, (150, 70, 90), 0.5), mat='skin', dome=0.8)
    p.line([(6, 4), (11, 3.5)], dark, width=0.6, h=-0.3)
    for fx in (7, 10):
        p.poly([(fx - 0.7, 4), (fx + 0.7, 4), (fx, 6.5)], (236, 228, 214), mat='horn', h=0.4)
    # feet
    for fx in (-5, 1):
        p.limb((fx, 7), (fx - 1, 11), 1.6, 1.0, dark, mat='skin', dome=0.5)
    save_part(p, outdir, tex_seed=31, **o)

    p = Part('bat_wing', 52, 36, (4, 6))  # pivot at shoulder, wing extends +x (toward the back) and down
    outline = [(0, 0), (16, -4), (34, -2), (46, 6), (40, 14), (30, 22), (18, 26), (8, 20), (2, 10)]
    # translucent membrane with scalloped trailing edge
    p.poly(outline, mem, mat='membrane', dome=1.2, alpha=205)
    for (a, b) in (((46, 6), (40, 14)), ((40, 14), (30, 22)), ((30, 22), (18, 26)), ((18, 26), (8, 20))):
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        p.erase([a, (mx - (b[1] - a[1]) * 0.25, my + (b[0] - a[0]) * 0.25), b])
    # membrane gradient: lighter toward the trailing edge (backlit)
    p.poly([(10, 6), (34, 2), (44, 8), (38, 14), (28, 20), (16, 23), (8, 16)], mem_lt, alpha=90)
    # veins
    rs = np.random.RandomState(34)
    for tip in ((46, 6), (40, 14), (30, 22), (18, 26)):
        for s in (0.45, 0.7):
            x, y = tip[0] * s, tip[1] * s - 1
            for d in (-1, 1):
                p.stroke((x, y), (x + d * 2 + 3, y + 3.5), 0.5, 0.15, vein, h=0.15, alpha=170)
    # finger bones (dark tapered lines) with knuckle dots
    for tip in ((46, 6), (40, 14), (30, 22)):
        p.limb((0, 0), tip, 3.0, 1.0, dark, mat='bone', dome=1.0)
        p.stroke((0, 0), tip, 1.0, 0.3, mix(dark, (200, 150, 170), 0.3), alpha=140)
        p.dot(tip[0] * 0.5, tip[1] * 0.5, 1.1, dark, h=0.4)
    p.limb((0, 0), (16, -4), 3.2, 2.2, dark, mat='bone', dome=1.2)   # leading edge / arm
    p.limb((16, -4), (34, -2), 2.2, 1.6, dark, mat='bone', dome=1.0)
    p.poly([(33, -3), (37, -6), (35, -1)], (230, 220, 210), mat='horn', h=0.5)   # thumb claw
    p.ellipse(1, 1, 3, 3, body, mat='fur', dome=1.5)
    save_part(p, outdir, tex_seed=32, **o)
    return dict(name='bat', height=30, hunch=0, reach=0, leg_len=0, parts=[
        dict(name='wing_far', tex='bat_wing', parent=None, at=[-4, -4], pivot=[4, 6], z=2, len=40),
        dict(name='torso', tex='bat_body', parent=None, at=[0, 0], pivot=[18, 14], z=10, len=0),
        dict(name='wing_near', tex='bat_wing', parent=None, at=[-2, -2], pivot=[4, 6], z=20, len=40),
    ])


# ------------------------------------------------------------------- fx ----

def _fx_save(rgb, alpha, name, blur=0.0):
    """rgb (h,w,3) 0..255 float, alpha (h,w) 0..1 at SS res -> downsample and save."""
    arr = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha, 0, 1) * 255])
    if blur > 0:
        for c in range(4):
            arr[..., c] = gauss_f(arr[..., c], blur * SS)
    img = downsample_premultiplied(arr, SS)
    img.save(os.path.join(FX, name))
    return img


def _polar(w, h, cx, cy):
    yy, xx = np.mgrid[0:h * SS, 0:w * SS]
    xx = xx / SS - cx; yy = yy / SS - cy
    return xx, yy, np.sqrt(xx * xx + yy * yy), np.arctan2(yy, xx)


def _taper(t, p=0.8):
    return np.clip(np.sin(np.clip(t, 0, 1) * math.pi), 0, 1) ** p


def _arc_field(rr, aa, r0, a0, a1, width, seed=0, ragged=0.0, smear=0.0, streaks=0):
    """Intensity of a tapered arc of radius r0 from angle a0 to a1 (radians, increasing)."""
    t = ((aa - a0) % (2 * math.pi)) / ((a1 - a0) % (2 * math.pi) or 2 * math.pi)
    inside = t <= 1.0
    tap = _taper(t) * inside
    rs = np.random.RandomState(seed)
    rad = r0
    if ragged > 0:
        phase = rs.uniform(0, 100, 3)
        rad = r0 + ragged * (np.sin(t * 61 + phase[0]) * 0.5 + np.sin(t * 137 + phase[1]) * 0.3 + np.sin(t * 23 + phase[2]) * 0.4)
    wd = width * (0.35 + 0.65 * tap)
    core = np.exp(-((rr - rad) / np.maximum(wd * 0.5, 0.3)) ** 2) * tap
    field = core
    if smear > 0:
        # trailing smear: same arc, shifted back in angle, broader and fainter
        for i in range(1, 5):
            ts = t + i * 0.09
            tap2 = _taper(ts) * (ts <= 1.0)
            field = field + np.exp(-((rr - rad) / (wd * (0.8 + i * 0.35))) ** 2) * tap2 * smear * (0.5 ** i)
    for i in range(streaks):
        off = (i - streaks / 2 + 0.5) * width * 0.9
        field = field + np.exp(-((rr - rad - off) / 0.9) ** 2) * tap * 0.35 * (1 - abs(i - streaks / 2 + 0.5) / streaks)
    return field


def fx_sprites():
    mkdir(FX)
    hot = np.array([255, 255, 255], float); warm = np.array([255, 190, 120], float); ember = np.array([255, 110, 40], float)
    # ---- claw slash: three ragged tapered arcs with motion smear and hot white cores
    w, h = 160, 120
    xx, yy, rr, aa = _polar(w, h, 56, 46)
    I = np.zeros_like(rr)
    for i, (r0, da) in enumerate(((78, 0.0), (62, -0.08), (46, -0.16))):
        a0, a1 = math.radians(-78) + da, math.radians(42) + da
        I += _arc_field(rr, aa, r0, a0, a1, 5.5 - i * 0.6, seed=10 + i, ragged=1.4, smear=0.9, streaks=3)
    I = np.clip(I, 0, 1.6)
    col = warm[None, None, :] * (1 - np.clip(I, 0, 1))[..., None] + hot[None, None, :] * np.clip(I, 0, 1)[..., None]
    col = col * (0.6 + 0.4 * np.clip(I, 0, 1))[..., None]
    _fx_save(col, np.clip(I * 1.3, 0, 1), 'slash_claw.png', blur=0.4)
    # ---- sword slash: broad crescent with a bright outer edge
    xx, yy, rr, aa = _polar(w, h, 62, 60)
    a0, a1 = math.radians(-90), math.radians(40)
    t = ((aa - a0) % (2 * math.pi)) / ((a1 - a0) % (2 * math.pi))
    tap = _taper(t, 0.6) * (t <= 1)
    R = 78
    edge = np.exp(-((rr - R) / 2.2) ** 2) * tap
    fill = np.clip((rr - (R - 30)) / 30, 0, 1) ** 1.6 * (rr <= R) * tap * 0.7
    smear = np.exp(-((rr - R + 4) / 9) ** 2) * _taper(t + 0.12, 0.6) * ((t + 0.12) <= 1) * 0.35
    I = np.clip(edge * 1.2 + fill + smear, 0, 1.3)
    cool = np.array([170, 200, 255], float)
    col = cool[None, None, :] * (1 - np.clip(I, 0, 1))[..., None] + hot[None, None, :] * np.clip(I, 0, 1)[..., None]
    _fx_save(col, np.clip(I, 0, 1), 'slash_sword.png', blur=0.4)
    # ---- impact burst: radial spikes + hot core + ring
    s = 96
    xx, yy, rr, aa = _polar(s, s, s / 2, s / 2)
    rs = np.random.RandomState(3)
    I = np.zeros_like(rr)
    for i in range(14):
        ang = i / 14 * 2 * math.pi + rs.uniform(-0.1, 0.1)
        L = (s / 2 - 3) * rs.uniform(0.55, 1.0)
        d = np.abs((aa - ang + math.pi) % (2 * math.pi) - math.pi)
        spike = np.exp(-(d * rr / 1.6) ** 2) * np.clip(1 - rr / L, 0, 1) ** 0.8
        I += spike
    I += np.clip(1 - rr / 14, 0, 1) ** 0.7 * 1.4                         # core
    I += np.exp(-((rr - 30) / 2.5) ** 2) * 0.5                            # ring
    I = np.clip(I, 0, 1.5)
    col = warm[None, None, :] * (1 - np.clip(I, 0, 1))[..., None] + hot[None, None, :] * np.clip(I, 0, 1)[..., None]
    _fx_save(col, np.clip(I, 0, 1), 'impact.png', blur=0.3)
    # ---- shockwave: horizontal ground-shock ring, white-orange core fading outward
    w, h = 256, 64
    xx, yy, rr, aa = _polar(w, h, w / 2, h / 2)
    rho = np.sqrt((xx / (w / 2 - 4)) ** 2 + (yy / (h / 2 - 3)) ** 2)
    ring = np.exp(-((rho - 0.78) / 0.05) ** 2)
    outer = np.clip(1 - (rho - 0.78) / 0.22, 0, 1) ** 2 * (rho > 0.78)
    inner = np.clip(1 - (0.78 - rho) / 0.3, 0, 1) ** 2.5 * (rho < 0.78) * 0.6
    I = np.clip(ring * 1.3 + outer * 0.6 + inner, 0, 1.3)
    k = np.clip(I, 0, 1)
    col = ember[None, None, :] * (1 - k)[..., None] + warm[None, None, :] * (k * (1 - k) * 2)[..., None] + hot[None, None, :] * (k ** 2)[..., None]
    _fx_save(col, np.clip(I, 0, 1), 'shockwave.png', blur=0.5)
    # ---- dust ring: soft dust puff ring
    w, h = 128, 32
    xx, yy, rr, aa = _polar(w, h, w / 2, h / 2)
    rho = np.sqrt((xx / (w / 2 - 2)) ** 2 + (yy / (h / 2 - 2)) ** 2)
    n = fbm_2d(w * SS, h * SS, 12, 3, octaves=4, seed=9, wrap_x=False)
    band = np.exp(-((rho - 0.68) / 0.18) ** 2) * (0.55 + 0.9 * (n - 0.35))
    puffs = np.clip(band, 0, 1) * np.clip(1 - rho * 0.3, 0, 1)
    dust = np.array([214, 198, 172], float)
    col = dust[None, None, :] * (0.75 + 0.5 * n)[..., None]
    _fx_save(col, np.clip(puffs * 0.9, 0, 1), 'dust_ring.png', blur=1.2)
    # ---- air ring: thin white ring for the double jump
    s = 96
    xx, yy, rr, aa = _polar(s, s, s / 2, s / 2)
    I = np.exp(-((rr - 40) / 1.3) ** 2) * 1.2 + np.exp(-((rr - 40) / 5) ** 2) * 0.35
    col = np.array([235, 245, 255], float)[None, None, :] * (0.85 + 0.15 * np.clip(I, 0, 1))[..., None]
    _fx_save(col, np.clip(I, 0, 1), 'air_ring.png', blur=0.3)
    # ---- parry: bright blue-white star/spark burst
    I = np.zeros_like(rr)
    for i, (ang, L, wd) in enumerate([(0, 46, 1.2), (math.pi / 2, 46, 1.2), (math.pi, 46, 1.2), (3 * math.pi / 2, 46, 1.2),
                                       (math.pi / 4, 26, 0.9), (3 * math.pi / 4, 26, 0.9), (5 * math.pi / 4, 26, 0.9), (7 * math.pi / 4, 26, 0.9)]):
        d = np.abs((aa - ang + math.pi) % (2 * math.pi) - math.pi)
        I += np.exp(-(d * rr / wd) ** 2) * np.clip(1 - rr / L, 0, 1) ** 1.2 * 1.3
    I += np.clip(1 - rr / 9, 0, 1) ** 0.6 * 1.5 + np.exp(-((rr - 22) / 1.8) ** 2) * 0.8 + np.clip(1 - rr / 30, 0, 1) ** 3 * 0.5
    rs = np.random.RandomState(8)
    for i in range(12):   # sparks
        ang = rs.uniform(0, 2 * math.pi); d0 = rs.uniform(24, 42)
        sx, sy = math.cos(ang) * d0, math.sin(ang) * d0
        I += np.exp(-(((xx - sx) ** 2 + (yy - sy) ** 2) / 2.2)) * 1.2
    I = np.clip(I, 0, 1.5)
    blue = np.array([120, 170, 255], float)
    k = np.clip(I, 0, 1)
    col = blue[None, None, :] * (1 - k)[..., None] + hot[None, None, :] * k[..., None]
    _fx_save(col, k, 'parry.png', blur=0.3)
    # ---- guard flash: vertical crescent shimmer for a blocked hit
    w, h = 64, 96
    xx, yy, rr, aa = _polar(w, h, -8, h / 2)
    I = np.exp(-((rr - 44) / 2.6) ** 2) * np.clip(np.cos(aa) * 1.6 - 0.2, 0, 1) ** 0.8
    I += np.exp(-((rr - 44) / 7) ** 2) * np.clip(np.cos(aa) * 1.4 - 0.2, 0, 1) * 0.4
    I += np.exp(-((rr - 36) / 1.2) ** 2) * np.clip(np.cos(aa) * 1.8 - 0.6, 0, 1) * 0.5   # inner thin echo
    I = np.clip(I * 1.3, 0, 1.4)
    k = np.clip(I, 0, 1)
    col = np.array([150, 195, 255], float)[None, None, :] * (1 - k)[..., None] + hot[None, None, :] * k[..., None]
    _fx_save(col, k, 'guard_flash.png', blur=0.3)
    # ---- blood drop / spark shard (unchanged look)
    img = new_rgba(12 * SS, 12 * SS)
    d = ImageDraw.Draw(img)
    d.ellipse([2 * SS, 2 * SS, 10 * SS, 10 * SS], fill=(255, 255, 255, 255))
    img.resize((12, 12), Image.LANCZOS).save(os.path.join(FX, 'drop.png'))
    img = new_rgba(16 * SS, 6 * SS)
    d = ImageDraw.Draw(img)
    d.polygon([(0, 3 * SS), (16 * SS, 0), (16 * SS, 6 * SS)], fill=(255, 255, 255, 255))
    img.resize((16, 6), Image.LANCZOS).save(os.path.join(FX, 'shard.png'))
    # ---- torch flame frames (6) for animated torches
    fw, fh, n = 32, 48, 6
    sheet = new_rgba(fw * n, fh)
    for f in range(n):
        im = new_rgba(fw * SS, fh * SS)
        d = ImageDraw.Draw(im)
        rs = np.random.RandomState(100 + f)
        for layer, (col, scale) in enumerate((((255, 120, 20, 255), 1.0), ((255, 200, 60, 255), 0.65), ((255, 250, 200, 255), 0.35))):
            pts = []
            for i in range(12):
                a = i / 12 * 2 * math.pi
                r = scale * (10 + 4 * math.sin(f * 1.1 + i * 2.1) + rs.uniform(-2, 2))
                rx, ry = r * 0.7, r * 1.6
                pts.append((fw / 2 * SS + math.cos(a) * rx * SS, (fh - 14) * SS - ry * SS * (1 - math.sin(a)) * 0.9 + math.sin(a) * rx * SS * 0.4))
            d.polygon(pts, fill=col)
        im = im.filter(ImageFilter.GaussianBlur(1.0 * SS)).resize((fw, fh), Image.LANCZOS)
        sheet.alpha_composite(im, (f * fw, 0))
    sheet.save(os.path.join(FX, 'flame_sheet.png'))
    # ---- ground shadow blob
    arr = np.zeros((20, 64))
    y, x = np.mgrid[0:20, 0:64]
    r = np.sqrt(((x - 31.5) / 30) ** 2 + ((y - 9.5) / 8) ** 2)
    arr = np.clip(1 - r, 0, 1) ** 1.2
    rgba(np.zeros((20, 64, 3)), arr * 200).save(os.path.join(FX, 'shadow.png'))


# ------------------------------------------------------------- world props ----

def world_props():
    out = os.path.join(ROOT, 'assets', 'sprites', 'world')
    mkdir(out)
    # ---- iron gate: ornate rusted iron with spikes and chains, 200x260, pivot bottom-centre
    w, h = 200, 260
    p = Part('gate', w, h, (w // 2, h - 4))
    iron, iron_lt, iron_dk = (58, 58, 68), (112, 112, 126), (26, 26, 34)
    rust, rust_dk = (118, 66, 36), (70, 38, 22)
    stone, stone_lt, stone_dk = (74, 70, 76), (112, 106, 112), (40, 38, 44)
    # stone posts with block courses
    for sx in (-96, 76):
        post = [(sx, 0), (sx + 20, 0), (sx + 20, -230), (sx + 10, -246), (sx, -230)]
        p.poly(post, stone, mat='stone', dome=3)
        for i in range(9):
            y = -24 * i - 10
            p.line([(sx, y), (sx + 20, y)], stone_dk, width=1.0, h=-0.8, alpha=220)
            p.line([(sx + (6 if i % 2 else 13), y), (sx + (6 if i % 2 else 13), y - 22)], stone_dk, width=0.8, h=-0.6, alpha=200)
        p.poly([(sx - 3, -230), (sx + 23, -230), (sx + 22, -236), (sx - 2, -236)], stone_lt, mat='stone', h=2.0)   # cap
        p.poly([(sx + 2, -246), (sx + 18, -246), (sx + 10, -258)], stone, mat='stone', dome=2.0)                      # finial
        cracks(p, post, 5, 151 + sx, stone_dk, length=10, width=0.7)
        p.shade([(sx, 0), (sx + 6, 0), (sx + 6, -230), (sx, -230)], stone_dk, alpha=90)
        rs = np.random.RandomState(152 + sx)
        for (x, y) in rand_pts(p, [(sx, 0), (sx + 20, 0), (sx + 20, -60), (sx, -60)], 10, rs):   # moss low on the posts
            p.ellipse(x, y, rs.uniform(2, 4), rs.uniform(1.2, 2.5), (52, 76, 40), mat='stone', alpha=180)
    # arch with scrollwork
    arch = [(-76, -200), (-50, -236), (0, -250), (50, -236), (76, -200), (76, -186), (50, -222), (0, -236), (-50, -222), (-76, -186)]
    p.poly(arch, iron, mat='metal', dome=3)
    p.line([(-74, -198), (-50, -232), (0, -246), (50, -232), (74, -198)], iron_lt, width=1.2, h=0.6, alpha=170)
    filigree(p, [(-66, -196), (-40, -222), (0, -234), (40, -222), (66, -196)], iron_lt, amp=4, seed=53, width=1.4, curls=True)
    p.ellipse(0, -232, 9, 9, iron, mat='metal', dome=2.5)   # central boss
    p.ellipse(0, -232, 5, 5, iron_dk, mat='metal', h=-1.0)
    p.ellipse(0, -232, 2, 2, rust, mat='rust')
    # bars with spikes
    for i in range(9):
        bx = -68 + i * 17
        top = -228 + abs(i - 4) * 9
        p.poly([(bx - 3, 0), (bx + 3, 0), (bx + 3, top), (bx - 3, top)], iron, mat='metal', dome=2.2)
        p.line([(bx - 1.6, -4), (bx - 1.6, top + 2)], iron_lt, width=0.8, alpha=150)
        p.poly([(bx - 5, top), (bx + 5, top), (bx, top - 16)], iron_lt, mat='metal', dome=1.8)   # spike
        p.poly([(bx - 5, top), (bx, top), (bx, top - 16)], (150, 150, 165), mat='metal', alpha=120)
        p.ellipse(bx, top + 4, 4.5, 2.5, iron_dk, mat='metal', dome=1.0)                          # collar
        rs = np.random.RandomState(60 + i)
        for _ in range(4):   # rust streaks and blotches
            y = rs.uniform(top + 10, -10)
            p.ellipse(bx + rs.uniform(-1.5, 1.5), y, rs.uniform(1.5, 3), rs.uniform(3, 9), rust, mat='rust', alpha=200)
            p.stroke((bx + rs.uniform(-2, 2), y), (bx + rs.uniform(-2, 2), y + rs.uniform(10, 28)), 1.2, 0.3, rust_dk, alpha=160)
    # cross rails with rivets
    for ry in (-40, -120, -190):
        p.poly([(-76, ry), (76, ry), (76, ry + 8), (-76, ry + 8)], iron_dk, mat='metal', dome=2.0)
        p.line([(-76, ry + 1), (76, ry + 1)], iron_lt, width=0.8, alpha=140)
        rivets(p, [(-68 + i * 17, ry + 4) for i in range(9)], 1.6, iron_lt, seed=300 + ry)
        p.ellipse(rs.uniform(-60, 60), ry + 4, 6, 3, rust, mat='rust', alpha=180)
    # ornamental scrolls between the bars on the middle rail
    for i in range(8):
        cx = -59.5 + i * 17
        filigree(p, [(cx - 6, -112), (cx, -104), (cx + 6, -112)], iron_lt, amp=2.5, seed=70 + i, width=1.2)
    # chains draped from the arch and hanging off a rail
    chain(p, [(-70, -192), (-40, -160), (-10, -150), (20, -158), (50, -180)], link=5, color=(118, 114, 120), dark=iron_dk, seed=71)
    chain(p, [(60, -116), (62, -86), (58, -60)], link=4.5, color=(118, 114, 120), dark=iron_dk, seed=72)
    chain(p, [(-62, -116), (-64, -90)], link=4.5, color=(118, 114, 120), dark=iron_dk, seed=73)
    p.ellipse(58, -56, 5, 5, iron_dk, mat='metal', dome=1.5)   # padlock
    p.poly([(55, -60), (61, -60), (61, -52), (55, -52)], iron, mat='metal', dome=1.5)
    img, nmap = p.finish(outline=(10, 8, 12), outline_w=1.0, rim=0.5, ao=0.6, noise=0.06, round_r=4, shape_k=0.5, tex_seed=61)
    img.save(os.path.join(out, 'gate.png')); nmap.save(os.path.join(out, 'gate_n.png'))

    # ---- stone platform segment 96x28, tileable horizontally, plus normal map
    w, h = 96, 28
    p = Part('platform', w, h, (0, 0))
    rs = np.random.RandomState(5)
    # stone courses that wrap: widths summing to exactly 96
    def course(y0, y1, seed, shade):
        r = np.random.RandomState(seed)
        xs = [0]
        while xs[-1] < w:
            xs.append(min(w, xs[-1] + r.randint(16, 30)))
        if w - xs[-2] < 10:
            xs.pop(-2)
        for i in range(len(xs) - 1):
            x0, x1 = xs[i] + 1, xs[i + 1] - 1
            col = (64 + r.randint(-10, 10), 60 + r.randint(-8, 8), 58 + r.randint(-6, 8))
            col = mul(col, shade)
            for dx in (-w, 0, w):
                pts = [(x0 + dx, y0), (x1 + dx, y0 + r.uniform(-0.5, 0.5)), (x1 + dx + r.uniform(-1, 1), y1), (x0 + dx + r.uniform(-1, 1), y1)]
                p.poly(pts, col, mat='stone', dome=1.6 + r.uniform(0, 1))
                p.line([pts[0], pts[1]], mix(col, (255, 255, 255), 0.3), width=0.8, alpha=150)
                p.line([pts[3], pts[2]], mul(col, 0.5), width=0.8, alpha=170)
                cracks(p, pts, 1, seed + i, mul(col, 0.45), length=6, width=0.5)
    p.poly([(0, 6), (w, 6), (w, h), (0, h)], (34, 32, 32), mat='stone')   # mortar
    course(6, 16, 11, 1.0)
    course(17, 28, 12, 0.85)
    # moss in the joints and on top
    for (x, y) in rand_pts(p, [(0, 6), (w, 6), (w, 22), (0, 22)], 40, rs):
        if rs.rand() < 0.6:
            y = 6 + rs.uniform(0, 3)
        for dx in (-w, 0, w):
            p.ellipse(x + dx, y, rs.uniform(1.5, 4), rs.uniform(1, 2.2), (54 + rs.randint(-8, 8), 82 + rs.randint(-10, 10), 40), mat='stone', alpha=200, dome=0.4)
    # grass blades on top (extend above the slab)
    for i in range(70):
        gx = rs.uniform(0, w)
        g = (48 + rs.randint(-10, 20), 78 + rs.randint(-16, 20), 34 + rs.randint(-6, 10))
        for dx in (-w, 0, w):
            p.stroke((gx + dx, 8), (gx + dx + rs.uniform(-3, 3), 8 - rs.uniform(4, 11)), 1.8, 0.3, g, h=0.3)
    img, nmap = p.finish(outline=None, outline_w=0, rim=0.25, ao=0.7, noise=0.08, round_r=3, shape_k=0.0, tex_seed=62, wrap_x=True)
    arr = np.array(img).astype(float)
    arr[:, :, :3] *= np.linspace(1.1, 0.55, h)[:, None, None]   # darker underside
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(out, 'platform.png'))
    nmap.save(os.path.join(out, 'platform_n.png'))

    # ---- fence post + rail segment 64x60: weathered wood
    p = Part('fence', 64, 60, (32, 56))
    wood, wood_lt, wood_dk = (84, 64, 46), (128, 104, 80), (40, 30, 22)
    post = [(-30, 0), (-22, 0), (-22, -50), (-26, -56), (-30, -50)]
    p.poly(post, wood, mat='wood', dome=2.5)
    for x in (-28.5, -25.5, -23.5):
        p.line([(x, -2), (x + 0.4, -50)], wood_dk, width=0.5, h=-0.3, alpha=170)
    p.line([(-27, -4), (-27, -48)], wood_lt, width=0.5, alpha=120)
    cracks(p, post, 3, 81, wood_dk, length=8, width=0.6)
    p.ellipse(-26, -30, 1.6, 2.2, wood_dk, mat='wood', h=-0.8)   # knot
    p.ellipse(-26, -30, 0.8, 1.1, mul(wood_dk, 0.6), mat='wood')
    for (rail, seed) in (([(-32, -40), (32, -36), (32, -30), (-32, -34)], 82), ([(-32, -18), (32, -14), (32, -8), (-32, -12)], 83)):
        p.poly(rail, mix(wood, wood_lt, 0.1), mat='wood', dome=2.0)
        y0 = rail[0][1]
        for k in range(3):
            p.line([(-31, y0 + 1.5 + k * 1.8), (31, y0 + 5.5 + k * 1.8)], wood_dk, width=0.5, h=-0.3, alpha=160)
        p.line([(-31, y0 + 0.8), (31, y0 + 4.8)], wood_lt, width=0.6, alpha=140)
        cracks(p, rail, 3, seed, wood_dk, length=9, width=0.6)
        rivets(p, [(-26, y0 + 3), (-24, y0 + 4.5)], 0.9, (120, 110, 100), seed=seed)   # nails
        p.erase([(32.5, y0 + 1), (30, y0 + 3), (32.5, y0 + 4)])                        # split end
        p.erase([(-32.5, y0), (-30.5, y0 + 2), (-32.5, y0 + 2.5)])
    p.shade([(-30, -50), (-22, -50), (-22, 0), (-30, 0)], wood_dk, alpha=60)
    rs = np.random.RandomState(84)
    for (x, y) in rand_pts(p, [(-30, -20), (-22, -20), (-22, 0), (-30, 0)], 6, rs):   # lichen/moss on the post base
        p.ellipse(x, y, rs.uniform(1, 2), rs.uniform(0.8, 1.5), (76, 96, 50), mat='wood', alpha=170)
    img, nmap = p.finish(outline=(12, 9, 8), outline_w=1.0, rim=0.35, ao=0.6, noise=0.1, round_r=4, shape_k=0.6, tex_seed=63)
    img.save(os.path.join(out, 'fence.png')); nmap.save(os.path.join(out, 'fence_n.png'))


# ---------------------------------------------------------------- preview ----

def pose_preview(rig, outdir, path, scale=2):
    """Assemble the rig in a neutral pose (all angles 0) using the same maths as Rig.js.
    Writes the 2x view at `path`, a 1x view (`*_1x.png`), the normal maps (`*_n.png`) and a relit
    check (`*_lit.png`: colour modulated by a point light shaded from the normal map)."""
    parts = {p['name']: p for p in rig['parts']}
    imgs = {p['name']: Image.open(os.path.join(outdir, p['tex'] + '.png')).convert('RGBA') for p in rig['parts']}
    nimgs = {p['name']: Image.open(os.path.join(outdir, p['tex'] + '_n.png')).convert('RGBA') for p in rig['parts']}
    sc = rig.get('scale', 1)
    if sc != 1:   # a rig cut from a painting at native resolution: preview it at the size the game draws it
        parts = {p['name']: dict(p, at=[p['at'][0] * sc, p['at'][1] * sc], pivot=[p['pivot'][0] * sc, p['pivot'][1] * sc]) for p in rig['parts']}
        rs = lambda im: im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
        imgs = {k: rs(v) for k, v in imgs.items()}
        nimgs = {k: rs(v) for k, v in nimgs.items()}
    W, H = 320, 320
    origin = (W // 2, H - 110)

    def world(pname):
        p = parts[pname]
        if p['parent'] is None:
            return origin[0] + p['at'][0], origin[1] + p['at'][1]
        px, py = world(p['parent'])
        return px + p['at'][0], py + p['at'][1]

    def compose(src, bg):
        canvas = new_rgba(W, H, bg)
        for p in sorted(rig['parts'], key=lambda q: q['z']):
            x, y = world(p['name'])
            canvas.alpha_composite(src[p['name']], (int(x - p['pivot'][0]), int(y - p['pivot'][1])))
        return canvas
    canvas = compose(imgs, (40, 40, 60, 255))
    canvas.resize((W * scale, H * scale), Image.NEAREST).save(path)
    canvas.save(path.replace('.png', '_1x.png'))
    ncanvas = compose(nimgs, (128, 128, 255, 255))
    ncanvas.resize((W * scale, H * scale), Image.NEAREST).save(path.replace('.png', '_n.png'))
    # relit check: light from the lower right, using the normal maps
    c = np.array(canvas).astype(float); n = np.array(ncanvas).astype(float) / 255 * 2 - 1
    yy, xx = np.mgrid[0:H, 0:W]
    lx, ly, lz = (W * 0.85 - xx), -(H * 0.75 - yy), 60.0
    L = np.sqrt(lx * lx + ly * ly + lz * lz)
    lam = np.clip((n[..., 0] * lx + n[..., 1] * ly + n[..., 2] * lz) / L, 0, 1)
    c[..., :3] = np.clip(c[..., :3] * (0.25 + 1.3 * lam[..., None]), 0, 255)
    Image.fromarray(c.astype(np.uint8), 'RGBA').resize((W * scale, H * scale), Image.NEAREST).save(path.replace('.png', '_lit.png'))


def main():
    mkdir(SPR); mkdir(RIGS)
    preview = None
    if '--preview' in sys.argv:
        preview = sys.argv[sys.argv.index('--preview') + 1]
        mkdir(preview)
    # The beast and the undead knight are cut from painted concept sheets (tools/beast_from_concept.py,
    # tools/undead_from_concept.py); when such a rig is in place (source == "concept") its textures and
    # JSON are kept. Without the undead rig the four procedural humanoid enemies are generated instead.
    def concept_rig(name):
        path = os.path.join(RIGS, name + '.json')
        if os.path.exists(path):
            try:
                rig = json.load(open(path))
                if rig.get('source') == 'concept':
                    return rig
            except ValueError:
                pass
        return None
    beast = concept_rig('beast')
    undead = concept_rig('undead')
    rigs = [beast or beast_parts(SPR)]
    if undead:
        rigs.append(undead)
    else:
        rigs += [
            armored_parts('knight', KNIGHT, SPR, helmet='great', weapon='sword', shield=True),
            armored_parts('spearman', SPEARMAN, SPR, helmet='kettle', weapon='spear', shield=False),
            armored_parts('skeleton', SKELETON, SPR, helmet='none', weapon='rusty', shield=False, bony=True),
            armored_parts('warden', WARDEN, SPR, helmet='great', weapon='axe', shield=False, heavy=True),
        ]
    rigs.append(bat_parts(SPR))
    manifest = {}
    for rig in rigs:
        if rig.get('source') != 'concept':
            json.dump(rig, open(os.path.join(RIGS, rig['name'] + '.json'), 'w'), indent=1)
        manifest[rig['name']] = dict(textures=sorted({p['tex'] for p in rig['parts']}), normals=True)
        if preview:
            pose_preview(rig, SPR, os.path.join(preview, f"rig_{rig['name']}.png"))
    json.dump(manifest, open(os.path.join(RIGS, 'manifest.json'), 'w'), indent=1)
    fx_sprites()
    world_props()
    # fx manifest: merge our `extra` list into whatever other generators wrote (e.g. `common`)
    fxm_path = os.path.join(FX, 'manifest.json')
    fxm = {}
    if os.path.exists(fxm_path):
        try:
            fxm = json.load(open(fxm_path))
        except ValueError:
            fxm = {}
    fxm['extra'] = ['shockwave', 'dust_ring', 'air_ring', 'parry', 'guard_flash']
    json.dump(fxm, open(fxm_path, 'w'), indent=1)
    # world manifest: our props plus whatever tools/gen_world_tiles.py wrote to tiles.json
    world_dir = os.path.join(ROOT, 'assets', 'sprites', 'world')
    names = ['gate', 'platform', 'fence']
    tiles_path = os.path.join(world_dir, 'tiles.json')
    if os.path.exists(tiles_path):
        try:
            names += [k for k in json.load(open(tiles_path)).get('tiles', {}) if k not in names]
        except ValueError:
            pass
    json.dump(dict(textures=names, normals=list(names)), open(os.path.join(world_dir, 'manifest.json'), 'w'), indent=1)
    print('rigs:', ', '.join(manifest))


if __name__ == '__main__':
    main()
