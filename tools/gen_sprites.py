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

    # -- coordinates
    def P(self, x, y):
        return ((self.pivot[0] + x) * SS, (self.pivot[1] + y) * SS)

    def PP(self, pts):
        return [self.P(*p) for p in pts]

    # -- primitive application over all layers
    def _apply(self, shape, fill, mat, h, dome, alpha=255, em=0):
        """shape(draw, value) draws the geometry with the given fill onto any ImageDraw."""
        if fill is not None:
            shape(self.d, tuple(fill) + (alpha,))
        if mat is not None or fill is not None:
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
            self.d.line(P, fill=tuple(fill) + (alpha,), width=wd)
        if mat is not None:
            self.dmt.line(P, fill=MAT[mat], width=wd)
        if h is not None:
            self.dhf.line(P, fill=float(h) * SS, width=wd)

    def stroke(self, p0, p1, w0, w1, fill, h=None, alpha=255, mat=None):
        """Fine tapered stroke: albedo + fine height (no structural height)."""
        a, b = self.P(*p0), self.P(*p1)
        if fill is not None:
            draw_tapered_line(self.d, a, b, w0 * SS, w1 * SS, tuple(fill) + (alpha,))
        if mat is not None:
            draw_tapered_line(self.dmt, a, b, w0 * SS, w1 * SS, MAT[mat])
        if h is not None:
            draw_tapered_line(self.dhf, a, b, w0 * SS, w1 * SS, float(h) * SS)

    def dot(self, cx, cy, r, fill, h=None, mat=None, alpha=255):
        x, y = self.P(cx, cy)
        box = [x - r * SS, y - r * SS, x + r * SS, y + r * SS]
        if fill is not None:
            self.d.ellipse(box, fill=tuple(fill) + (alpha,))
        if mat is not None:
            self.dmt.ellipse(box, fill=MAT[mat])
        if h is not None:
            self.dhf.ellipse(box, fill=float(h) * SS)

    def erase(self, pts):
        P = self.PP(pts)
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
    def finish(self, outline=(22, 16, 18), outline_w=1.0, round_r=10, shape_k=0.8, ambient=0.46, diffuse=0.80,
               ao=0.6, rim=0.5, rim_color=(120, 150, 215), noise=0.06, glow=None, key=KEY_DIR, spec=1.0,
               tex_seed=0, nstrength=1.0, wrap_x=False, **_ignored):
        """Light the part. Returns (colour image, normal map image) at 1x."""
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


def fur(part, pts, n, length, angle, spread, light, dark, seed=0, width=1.3, h=0.35, grad=None, alpha=255, mat='fur'):
    """Directional fur strands inside polygon pts. angle in degrees (0 = +x, 90 = down).
    grad: optional fn(x, y) -> 0..1 mixing dark(0) to light(1) base tone."""
    rs = np.random.RandomState(seed)
    W, H = part.img.size
    clump = fbm_2d(W, H, max(1, W // (5 * SS)), max(1, H // (5 * SS)), octaves=2, seed=seed + 500, wrap_x=False)
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
    fur=(88, 76, 66), fur_lt=(140, 122, 100), fur_dark=(40, 34, 30), umber=(98, 70, 50), belly=(158, 140, 114), belly_lt=(196, 180, 150),
    claw=(222, 212, 190), horn=(150, 132, 104), horn_dark=(74, 60, 46), eye=(255, 150, 30), mouth=(96, 20, 26), gum=(132, 36, 44),
    teeth=(238, 230, 208), outline=(18, 12, 14), scar=(140, 92, 86),
)
KNIGHT = dict(
    steel=(142, 148, 160), steel_lt=(190, 196, 206), steel_dark=(78, 82, 94), trim=(184, 150, 72), cloth=(118, 26, 32), cloth_dark=(62, 12, 18),
    leather=(76, 52, 36), skin=(150, 120, 100), outline=(16, 12, 18), eye=(255, 110, 40), mail=(96, 100, 110),
)
SPEARMAN = dict(
    steel=(118, 120, 126), steel_lt=(168, 170, 176), steel_dark=(66, 68, 76), trim=(140, 120, 80), cloth=(54, 62, 84), cloth_dark=(28, 34, 50),
    leather=(92, 64, 42), leather_dark=(52, 36, 24), skin=(166, 134, 110), skin_dark=(112, 84, 68), outline=(14, 12, 16), eye=(220, 200, 160),
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
    fur_lt, fur_dk, umber = S['fur_lt'], S['fur_dark'], S['umber']
    o = dict(outline=S['outline'], rim=0.34, ao=0.55, noise=0.08, round_r=9, shape_k=0.6)

    # ---- torso: pivot at hip (bottom centre). Hunched forward (toward +x).
    p = Part('beast_torso', 64, 76, (28, 70))
    body = [(-13, 2), (-17, -14), (-18, -30), (-15, -46), (-10, -58), (-2, -65), (12, -67), (22, -62), (27, -52), (26, -38), (22, -22), (17, -8), (12, 2)]
    p.poly(body, S['fur'], mat='fur', dome=5)
    # back/upper darker umber mass
    p.poly([(-13, 2), (-17, -14), (-18, -30), (-15, -46), (-10, -58), (-2, -65), (4, -62), (-2, -48), (-4, -30), (-3, -10), (-2, 2)], mix(S['fur'], umber, 0.5), mat='fur')
    # muscle groups
    p.ellipse(-4, -40, 10, 14, mix(S['fur'], fur_lt, 0.2), dome=3.4)      # lats / upper back mass
    p.ellipse(12, -50, 10, 7, mix(S['fur'], fur_lt, 0.35), dome=3.8)      # pec
    p.ellipse(16, -40, 8, 6, mix(S['fur'], fur_lt, 0.28), dome=3.0)       # lower pec
    p.ellipse(6, -58, 8, 6, mix(S['fur'], fur_lt, 0.3), dome=3.2)         # shoulder mass
    for i, (ax, ay) in enumerate([(12, -30), (10, -22), (8, -14)]):      # abs
        p.ellipse(ax, ay, 5, 3.4, mix(S['belly'], S['fur'], 0.45), dome=2.2)
    # pale belly gradient
    belly = [(14, -46), (22, -40), (24, -30), (21, -18), (16, -8), (11, 0), (6, -6), (8, -20), (10, -34)]
    p.poly(belly, S['belly'], mat='fur', alpha=0)
    grad = lambda x, y: np.clip((y + 46) / 46, 0, 1) * 0.5 + np.clip((x - 6) / 16, 0, 1) * 0.5
    fur(p, belly, 260, 3.2, 95, 18, S['belly_lt'], mix(S['belly'], S['fur'], 0.55), seed=1, width=1.1, h=0.3, grad=grad)
    # body fur: directional (down and slightly back), lighter toward the chest
    bgrad = lambda x, y: np.clip((x + 18) / 44, 0, 1) * 0.7 + np.clip((y + 67) / 70, 0, 1) * 0.3 - 0.15
    fur(p, [(-13, 2), (-17, -14), (-18, -30), (-15, -46), (-10, -58), (-2, -65), (12, -67), (22, -62), (27, -52), (16, -46), (8, -34), (6, -6), (12, 2)], 420, 3.6, 100, 16, fur_lt, fur_dk, seed=2, width=1.2, h=0.4, grad=bgrad)
    # fur spikes along the back ridge
    tufts(p, [(-17, -14), (-18, -30), (-15, -46), (-10, -58), (-2, -65)], 6, 7, 215, mix(S['fur'], fur_dk, 0.4), fur_dk, seed=3, lean=-10, width=5.0, h=1.2, spread=8)
    tufts(p, [(-13, 2), (-17, -14), (-18, -30), (-15, -46)], 5, 4, 170, S['fur'], fur_dk, seed=4, width=3.5, h=0.6, spread=10)
    # claw scars across the chest/abs
    for k in range(3):
        p.stroke((14 + k * 3, -44 + k * 2), (8 + k * 3, -24 + k * 2), 1.0, 0.4, S['scar'], h=-0.5, alpha=210)
        p.stroke((14.6 + k * 3, -44 + k * 2), (8.6 + k * 3, -24 + k * 2), 0.5, 0.2, mix(S['scar'], (255, 230, 220), 0.4), alpha=140)
    parts = save_part(p, outdir, tex_seed=1, **o)

    # ---- head: pivot at neck (bottom-back). Snout toward +x, horns back.
    p = Part('beast_head', 70, 58, (22, 50))
    skull = [(-10, 0), (-15, -12), (-12, -26), (-4, -35), (8, -37), (18, -32), (30, -24), (42, -16), (44, -10), (36, -6), (26, -4), (16, 0), (4, 2)]
    p.poly(skull, S['fur'], mat='fur', dome=5)
    p.ellipse(4, -24, 10, 9, mix(S['fur'], fur_lt, 0.25), dome=2.0)    # cranium/brow mass
    p.ellipse(27, -18, 10, 5, mix(S['fur'], umber, 0.4), dome=1.6)     # muzzle bridge
    p.ellipse(16, -27, 7, 3.5, mix(S['fur'], fur_dk, 0.5), dome=1.2)   # brow ridge
    # jaw (lower) with wet gums + fangs
    p.poly([(4, -1), (14, -3), (36, -9), (40, -6), (34, 2), (20, 7), (8, 7), (3, 4)], mix(S['fur'], umber, 0.5), mat='fur', dome=2)
    p.poly([(14, -4), (36, -9), (35, -5), (30, -2), (18, 1), (12, 0)], S['mouth'], mat='skin', h=-0.8)
    p.poly([(16, -3), (34, -8), (32, -5), (22, -3)], S['gum'], mat='skin')
    p.stroke((17, -2.5), (31, -6), 0.8, 0.3, mix(S['gum'], (255, 200, 200), 0.5), alpha=150)   # wet highlight
    for tx, tl in ((21, 4.5), (27, 5.5), (33, 4)):
        p.poly([(tx - 1.6, -5.5 + (tx - 27) * -0.12), (tx + 1.6, -6 + (tx - 27) * -0.12), (tx + 0.3, -6 + tl)], S['teeth'], mat='horn', h=0.6)
    for tx in (18, 24, 30):
        p.poly([(tx - 1.2, 1 - (tx - 24) * 0.12), (tx + 1.2, 1 - (tx - 24) * 0.12), (tx, -2.2)], mix(S['teeth'], S['gum'], 0.2), mat='horn', h=0.4)
    # nostril
    p.ellipse(40, -13, 2.2, 1.5, fur_dk, h=-0.6)
    p.dot(39.5, -13.5, 0.8, mix(fur_dk, (0, 0, 0), 0.5))
    # ear
    p.poly([(-6, -22), (-18, -32), (-14, -18), (-8, -14)], mix(S['fur'], fur_dk, 0.4), mat='fur', h=0.5)
    p.poly([(-7, -21), (-14, -28), (-12, -19)], mix(S['mouth'], S['fur'], 0.6), mat='skin')
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
    # fur strands on the head + cheek ruff tufts
    hgrad = lambda x, y: np.clip((y + 37) / 40, 0, 1) * 0.6 + 0.1
    fur(p, [(-10, 0), (-15, -12), (-12, -26), (-4, -35), (8, -37), (18, -32), (30, -24), (26, -16), (14, -8), (4, -2)], 220, 3.0, 110, 20, fur_lt, fur_dk, seed=5, width=1.1, h=0.35, grad=hgrad)
    tufts(p, [(4, 2), (-10, 0), (-15, -12)], 5, 5, 150, S['fur'], fur_dk, seed=6, width=4.0, h=0.6, spread=10)
    tufts(p, [(-4, -35), (8, -37)], 4, 3.5, 270, mix(S['fur'], fur_dk, 0.4), fur_dk, seed=7, width=2.5, h=0.5)
    # ember eye with halo (emissive)
    p.ellipse(22, -21, 4.6, 3.0, mix(S['eye'], (0, 0, 0), 0.75), mat='skin', h=-0.7)   # socket
    p.glow(22, -21, 3.6, 2.2, S['eye'], halo=3.2, strength=0.9)
    p.ellipse(22.4, -21, 2.2, 1.6, (255, 232, 120), mat='glow', em=255)
    p.ellipse(22.6, -21, 1.0, 1.0, (120, 30, 0), mat='glow', em=255)
    # brow shadow over the eye
    p.stroke((16, -26), (29, -24.5), 1.4, 0.5, fur_dk, h=-0.3, alpha=200)
    parts = save_part(p, outdir, tex_seed=2, **o)

    # ---- upper arm (hangs down from shoulder)
    p = Part('beast_arm_u', 26, 44, (13, 6))
    p.limb((0, 0), (0, 32), 17, 12, S['fur'], mat='fur', dome=5)
    p.ellipse(0, 2, 9, 8, mix(S['fur'], fur_lt, 0.2), dome=3.6)     # deltoid
    p.ellipse(2, 16, 5.5, 8, mix(S['fur'], fur_lt, 0.25), dome=3.0)   # bicep
    p.ellipse(-4, 20, 3.5, 7, mix(S['fur'], umber, 0.5), dome=1.0)    # tricep
    fur(p, [(-8, -4), (8, -4), (8, 34), (-6, 34)], 160, 3.2, 95, 16, fur_lt, fur_dk, seed=8, width=1.1, h=0.35, grad=lambda x, y: 0.5 + x / 18)
    tufts(p, [(-8, 6), (-7, 24)], 3, 4, 150, S['fur'], fur_dk, seed=9, width=4.0, h=0.5, spread=8)
    save_part(p, outdir, tex_seed=3, **o)

    # ---- forearm with clawed hand
    p = Part('beast_arm_l', 34, 58, (14, 6))
    p.limb((0, 0), (1, 32), 12, 9, S['fur'], mat='fur', dome=4)
    p.ellipse(1, 10, 5, 8, mix(S['fur'], fur_lt, 0.25), dome=2.8)      # forearm flexor
    p.ellipse(3, 36, 7.5, 6, mix(S['fur'], umber, 0.5), mat='fur', dome=3)  # hand
    for i, kx in enumerate((-2, 2, 6)):
        p.ellipse(kx, 38, 2.0, 1.8, mix(S['fur'], fur_dk, 0.45), dome=0.8)   # knuckles
    for i, (x, y) in enumerate([(-4, 40), (2, 42), (8, 40)]):
        tip = (x + (i - 1) * 2, y + 12)
        p.poly([(x - 2.2, y - 2), (x + 2.2, y - 2), tip], S['claw'], mat='horn', dome=1.4)
        p.poly([(x - 1.0, y - 1.5), (x + 0.4, y - 1.5), (tip[0] - 0.2, tip[1] - 1)], mix(S['claw'], (255, 255, 255), 0.5), mat='horn')
        p.stroke((x + 0.6, y), (tip[0] + 0.3, tip[1] - 2), 0.6, 0.2, mix(S['claw'], (90, 70, 50), 0.6), alpha=170)
    fur(p, [(-6, -4), (6, -4), (7, 30), (-5, 30)], 120, 3.0, 92, 16, fur_lt, fur_dk, seed=10, width=1.1, h=0.35, grad=lambda x, y: 0.55 + x / 14)
    tufts(p, [(-6, 4), (-5, 22)], 2, 3.6, 150, S['fur'], fur_dk, seed=11, width=3.5, h=0.5, spread=8)
    tufts(p, [(-5, 30), (1, 30)], 3, 3.5, 160, S['fur'], fur_dk, seed=12, width=3.0, h=0.5, spread=10)  # wrist ruff
    save_part(p, outdir, tex_seed=4, **o)

    # ---- thigh
    p = Part('beast_leg_u', 30, 46, (15, 6))
    p.limb((0, 0), (0, 34), 20, 13, S['fur'], mat='fur', dome=5)
    p.ellipse(0, 2, 11, 9, mix(S['fur'], umber, 0.3), dome=2.5)
    p.ellipse(3, 16, 6, 10, mix(S['fur'], fur_lt, 0.25), dome=3.4)   # quad
    p.ellipse(-5, 18, 3.5, 9, mix(S['fur'], umber, 0.5), dome=1.0)   # hamstring
    fur(p, [(-10, -4), (10, -4), (7, 38), (-7, 38)], 200, 3.4, 95, 16, fur_lt, fur_dk, seed=13, width=1.2, h=0.35, grad=lambda x, y: 0.5 + x / 20)
    tufts(p, [(-10, 6), (-9, 26)], 3, 4.5, 150, S['fur'], fur_dk, seed=14, width=4.5, h=0.6, spread=8)
    save_part(p, outdir, tex_seed=5, **o)

    # ---- shin + paw (digitigrade)
    p = Part('beast_leg_l', 36, 56, (12, 6))
    p.limb((0, 0), (-2, 26), 13, 9, S['fur'], mat='fur', dome=4)
    p.limb((-2, 26), (8, 40), 9, 8, S['fur'], mat='fur', dome=3.5)
    p.ellipse(-1, 10, 4.5, 8, mix(S['fur'], fur_lt, 0.25), dome=2.6)   # calf
    p.ellipse(10, 42, 9, 5, mix(S['fur'], umber, 0.5), mat='fur', dome=2.8)  # paw
    for x in (4, 11, 18):
        p.ellipse(x, 42, 2.2, 1.8, mix(S['fur'], fur_dk, 0.45), dome=0.8)
        p.poly([(x - 2, 42), (x + 2, 42), (x + 1, 48)], S['claw'], mat='horn', dome=1.2)
        p.poly([(x - 0.8, 42.5), (x + 0.5, 42.5), (x + 0.8, 46.5)], mix(S['claw'], (255, 255, 255), 0.5), mat='horn')
    fur(p, [(-6, -4), (6, -4), (3, 26), (-6, 26)], 110, 3.0, 95, 16, fur_lt, fur_dk, seed=15, width=1.1, h=0.35, grad=lambda x, y: 0.5 + x / 14)
    fur(p, [(-6, 24), (4, 24), (12, 36), (2, 40)], 50, 2.6, 125, 16, fur_lt, fur_dk, seed=16, width=1.0, h=0.3)
    tufts(p, [(-6, 4), (-7, 18)], 2, 3.5, 150, S['fur'], fur_dk, seed=17, width=3.5, h=0.5, spread=8)
    tufts(p, [(-6, 26), (0, 34)], 3, 4, 160, S['fur'], fur_dk, seed=18, width=3.2, h=0.5, spread=10)  # hock tuft
    save_part(p, outdir, tex_seed=6, **o)

    # ---- tail segments (hang from pivot; angled by animation)
    p = Part('beast_tail1', 20, 40, (10, 4))
    p.limb((0, 0), (0, 32), 10, 6, S['fur'], mat='fur', dome=3.5)
    fur(p, [(-5, -3), (5, -3), (3, 34), (-3, 34)], 90, 2.8, 95, 14, fur_lt, fur_dk, seed=19, width=1.0, h=0.35, grad=lambda x, y: 0.5 + x / 10)
    tufts(p, [(-5, 4), (-5, 16), (-4, 28)], 4, 5, 205, mix(S['fur'], fur_dk, 0.3), fur_dk, seed=20, width=3.4, h=0.8, spread=8)
    save_part(p, outdir, tex_seed=7, **o)
    p = Part('beast_tail2', 20, 44, (10, 4))
    p.limb((0, 0), (0, 28), 6, 3, S['fur'], mat='fur', dome=2.5)
    p.poly([(-5, 24), (-2, 40), (0, 34), (2, 40), (5, 24)], mix(S['fur'], fur_dk, 0.35), mat='fur', dome=1.5)
    fur(p, [(-3, -3), (3, -3), (2, 30), (-2, 30)], 50, 2.5, 95, 14, fur_lt, fur_dk, seed=21, width=0.9, h=0.3, grad=lambda x, y: 0.5 + x / 6)
    tufts(p, [(-3, 2), (-3, 12), (-3, 22)], 4, 5, 205, mix(S['fur'], fur_dk, 0.3), fur_dk, seed=22, width=3.0, h=0.8, spread=8)
    tufts(p, [(-5, 24), (-3, 34), (0, 40)], 4, 4, 210, fur_dk, None, seed=23, width=2.5, h=0.7)
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

def armored_parts(prefix, S, outdir, helmet='great', weapon='sword', shield=True, heavy=False, bony=False):
    """Knight-like characters. Returns rig dict."""
    o = dict(outline=S['outline'], texture=0.06, rim=0.45, rim_color=(140, 160, 210))
    k = 1.0 if not heavy else 1.25
    sc = lambda v: v * k

    # torso: breastplate + tabard
    p = Part(f'{prefix}_torso', int(sc(56)), int(sc(78)), (int(sc(28)), int(sc(72))))
    if bony:
        # ribcage + spine
        p.poly([(-7, 2), (-9, -30), (-6, -50), (-2, -58), (6, -58), (10, -50), (12, -30), (9, 2)], S['bone_dark'])
        p.limb((0, -58), (0, 0), 5, 4, S['bone'])
        for i in range(5):
            y = -48 + i * 8
            p.limb((-8, y), (8, y + 2), 3.5, 3.5, S['bone'])
        p.poly([(-9, -10), (-11, 4), (9, 4), (11, -10)], S['rag'])
    else:
        p.poly([(sc(-14), 2), (sc(-17), sc(-30)), (sc(-14), sc(-50)), (sc(-6), sc(-60)), (sc(6), sc(-60)), (sc(16), sc(-50)), (sc(18), sc(-30)), (sc(13), 2)], S['steel'])
        # tabard
        p.poly([(sc(-9), sc(-40)), (sc(9), sc(-40)), (sc(10), 4), (sc(-10), 4)], S['cloth'])
        p.poly([(sc(-2), sc(-40)), (sc(2), sc(-40)), (sc(2), 4), (sc(-2), 4)], S['cloth_dark'])
        # belt
        p.poly([(sc(-14), sc(-12)), (sc(14), sc(-12)), (sc(14), sc(-6)), (sc(-14), sc(-6))], S['leather'])
        p.ellipse(0, sc(-9), sc(3), sc(3), S['trim'])
        # chest ridge highlight
        p.limb((sc(-4), sc(-56)), (sc(-4), sc(-22)), sc(3), sc(2), S['steel_dark'])
    torso = save_part(p, outdir, tex_seed=11, **o)

    # head / helmet
    p = Part(f'{prefix}_head', int(sc(44)), int(sc(50)), (int(sc(20)), int(sc(44))))
    if bony:
        p.ellipse(2, -22, 13, 14, S['bone'])
        p.poly([(-6, -12), (10, -12), (10, 0), (-4, 0)], S['bone_dark'])
        for x in (-2, 2, 6):
            p.poly([(x - 1, -6), (x + 1, -6), (x + 1, -1), (x - 1, -1)], S['bone'])

        def face(d, part):
            for ex in (0, 9):
                x, y = part.P(ex, -24)
                d.ellipse([x - 3.5 * SS, y - 3 * SS, x + 3.5 * SS, y + 3 * SS], fill=(20, 14, 10, 255))
                d.ellipse([x - 1.5 * SS, y - 1.5 * SS, x + 1.5 * SS, y + 1.5 * SS], fill=S['eye'] + (255,))
            x, y = part.P(12, -17)
            d.polygon([(x - 2 * SS, y), (x + 3 * SS, y - 2 * SS), (x + 2 * SS, y + 3 * SS)], fill=(20, 14, 10, 255))
        p.overlay(face)
    elif helmet == 'great':
        p.poly([(sc(-14), 0), (sc(-14), sc(-30)), (sc(-8), sc(-40)), (sc(8), sc(-40)), (sc(14), sc(-30)), (sc(14), 0)], S['steel'])
        p.poly([(sc(-10), sc(-40)), (sc(0), sc(-50)), (sc(10), sc(-40))], S['steel_dark'])
        # visor slit
        p.poly([(sc(2), sc(-26)), (sc(15), sc(-26)), (sc(15), sc(-22)), (sc(2), sc(-22))], (14, 10, 14))
        p.poly([(sc(6), sc(-18)), (sc(14), sc(-18)), (sc(14), sc(-4)), (sc(6), sc(-4))], S['steel_dark'])
        if heavy:
            # horns on the warden's helm
            p.poly([(sc(-12), sc(-34)), (sc(-26), sc(-50)), (sc(-30), sc(-66)), (sc(-18), sc(-50)), (sc(-8), sc(-40))], S['trim'])
            p.poly([(sc(10), sc(-36)), (sc(20), sc(-52)), (sc(26), sc(-66)), (sc(14), sc(-50)), (sc(6), sc(-42))], S['trim'])

        def visor(d, part):
            x, y = part.P(sc(10), sc(-24))
            d.ellipse([x - 3 * SS, y - 1.5 * SS, x + 3 * SS, y + 1.5 * SS], fill=S['eye'] + (255,))
        p.overlay(visor)
    else:  # kettle / open helm with face
        p.ellipse(2, -22, 12, 13, S['skin'])
        p.poly([(-16, -26), (-10, -36), (4, -40), (14, -34), (20, -26), (-16, -24)], S['steel'])
        p.poly([(-4, -40), (0, -48), (6, -40)], S['steel_dark'])
        p.poly([(-10, -18), (-12, 0), (14, 0), (12, -18)], S['cloth'])

        def face(d, part):
            x, y = part.P(9, -22)
            d.ellipse([x - 2 * SS, y - 1.5 * SS, x + 2 * SS, y + 1.5 * SS], fill=(20, 14, 10, 255))
            x, y = part.P(8, -14)
            d.line([(x - 4 * SS, y), (x + 4 * SS, y)], fill=(60, 30, 24, 255), width=SS)
        p.overlay(face)
    head = save_part(p, outdir, tex_seed=12, **o)

    # arms
    p = Part(f'{prefix}_arm_u', int(sc(30)), int(sc(44)), (int(sc(15)), int(sc(6))))
    if bony:
        p.limb((0, 0), (0, 30), 6, 5, S['bone'])
        p.ellipse(0, 2, 5, 4, S['bone'])
    else:
        p.limb((0, 0), (0, sc(30)), sc(13), sc(10), S['cloth'] if helmet != 'great' else S['steel_dark'])
        p.ellipse(0, sc(2), sc(13), sc(9), S['steel'])  # pauldron
        p.ellipse(0, sc(2), sc(7), sc(5), S['steel_dark'])
    arm_u = save_part(p, outdir, tex_seed=13, **o)

    p = Part(f'{prefix}_arm_l', int(sc(26)), int(sc(50)), (int(sc(13)), int(sc(6))))
    if bony:
        p.limb((0, 0), (0, 30), 5, 4, S['bone'])
        p.ellipse(0, 33, 4, 4, S['bone'])
    else:
        p.limb((0, 0), (0, sc(30)), sc(11), sc(10), S['steel'])
        p.ellipse(0, sc(34), sc(6), sc(6), S['leather'])  # gauntlet
    arm_l = save_part(p, outdir, tex_seed=14, **o)

    # legs
    p = Part(f'{prefix}_leg_u', int(sc(30)), int(sc(46)), (int(sc(15)), int(sc(6))))
    if bony:
        p.limb((0, 0), (0, 32), 7, 5, S['bone'])
    else:
        p.limb((0, 0), (0, sc(32)), sc(16), sc(11), S['steel_dark'] if helmet == 'great' else S['cloth'])
        p.poly([(sc(-8), sc(0)), (sc(8), sc(0)), (sc(7), sc(14)), (sc(-7), sc(14))], S['cloth'] if helmet == 'great' else S['leather'])
    leg_u = save_part(p, outdir, tex_seed=15, **o)

    p = Part(f'{prefix}_leg_l', int(sc(34)), int(sc(52)), (int(sc(12)), int(sc(6))))
    if bony:
        p.limb((0, 0), (0, 34), 6, 4, S['bone'])
        p.poly([(-5, 34), (12, 36), (12, 40), (-5, 40)], S['bone_dark'])
    else:
        p.limb((0, 0), (0, sc(32)), sc(12), sc(9), S['steel'])
        p.poly([(sc(-7), sc(30)), (sc(14), sc(32)), (sc(14), sc(40)), (sc(-7), sc(40))], S['leather'])  # boot
    leg_l = save_part(p, outdir, tex_seed=16, **o)

    # weapon (pivot at the grip)
    wparts = {}
    if weapon == 'sword':
        p = Part(f'{prefix}_weapon', int(sc(24)), int(sc(96)), (int(sc(12)), int(sc(78))))
        p.poly([(sc(-3), sc(-66)), (0, sc(-74)), (sc(3), sc(-66)), (sc(3), sc(-8)), (sc(-3), sc(-8))], (200, 206, 216))
        p.poly([(sc(-1), sc(-64)), (sc(1), sc(-64)), (sc(1), sc(-10)), (sc(-1), sc(-10))], (150, 156, 170))
        p.poly([(sc(-10), sc(-8)), (sc(10), sc(-8)), (sc(10), sc(-4)), (sc(-10), sc(-4))], S['trim'])
        p.poly([(sc(-2.5), sc(-4)), (sc(2.5), sc(-4)), (sc(2.5), sc(10)), (sc(-2.5), sc(10))], S['leather'])
        p.ellipse(0, sc(13), sc(3.5), sc(3.5), S['trim'])
        wparts['weapon'] = dict(tex=f'{prefix}_weapon', pivot=(int(sc(12)), int(sc(78))), reach=sc(74))
        save_part(p, outdir, tex_seed=17, outline=S['outline'], texture=0.0, rim=0.5)
    elif weapon == 'spear':
        p = Part(f'{prefix}_weapon', 20, 150, (10, 110))
        p.limb((0, -100), (0, 36), 4, 4, (92, 66, 40))
        p.poly([(-5, -102), (0, -132), (5, -102), (0, -96)], (190, 196, 206))
        p.poly([(-4, 0), (4, 0), (4, 12), (-4, 12)], S['leather'])
        wparts['weapon'] = dict(tex=f'{prefix}_weapon', pivot=(10, 110), reach=130)
        save_part(p, outdir, tex_seed=17, outline=S['outline'], texture=0.0, rim=0.5)
    elif weapon == 'rusty':
        p = Part(f'{prefix}_weapon', 24, 80, (12, 64))
        p.poly([(-3, -54), (2, -58), (4, -50), (3, -8), (-3, -8)], (150, 120, 96))
        p.poly([(-8, -8), (8, -8), (8, -5), (-8, -5)], S['rust'])
        p.poly([(-2, -5), (2, -5), (2, 10), (-2, 10)], S['rag'])
        wparts['weapon'] = dict(tex=f'{prefix}_weapon', pivot=(12, 64), reach=58)
        save_part(p, outdir, tex_seed=17, outline=S['outline'], texture=0.1, rim=0.4)
    elif weapon == 'axe':
        p = Part(f'{prefix}_weapon', 70, 130, (35, 100))
        p.limb((0, -92), (0, 28), 7, 6, (60, 44, 34))
        p.poly([(0, -92), (-30, -80), (-34, -50), (0, -40)], (120, 118, 130))
        p.poly([(0, -92), (30, -80), (34, -50), (0, -40)], (120, 118, 130))
        p.poly([(-4, -98), (0, -112), (4, -98)], (160, 160, 170))
        wparts['weapon'] = dict(tex=f'{prefix}_weapon', pivot=(35, 100), reach=110)
        save_part(p, outdir, tex_seed=17, outline=S['outline'], texture=0.05, rim=0.5)
    if shield:
        p = Part(f'{prefix}_shield', int(sc(40)), int(sc(52)), (int(sc(20)), int(sc(24))))
        p.poly([(sc(-18), sc(-22)), (sc(18), sc(-22)), (sc(18), sc(2)), (0, sc(26)), (sc(-18), sc(2))], S['steel_dark'])
        p.poly([(sc(-14), sc(-18)), (sc(14), sc(-18)), (sc(14), 0), (0, sc(20)), (sc(-14), 0)], S['cloth'])
        p.poly([(sc(-2), sc(-18)), (sc(2), sc(-18)), (sc(2), sc(18)), (sc(-2), sc(18))], S['trim'])
        p.poly([(sc(-14), sc(-4)), (sc(14), sc(-4)), (sc(14), 0), (sc(-14), 0)], S['trim'])
        wparts['shield'] = dict(tex=f'{prefix}_shield', pivot=(int(sc(20)), int(sc(24))))
        save_part(p, outdir, tex_seed=18, outline=S['outline'], texture=0.05, rim=0.5)

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
    body = (58, 46, 60); dark = (32, 24, 36); mem = (70, 50, 70)
    o = dict(outline=(10, 6, 12), texture=0.1, rim=0.4)
    p = Part('bat_body', 36, 30, (18, 14))
    p.ellipse(0, 0, 12, 9, body)
    p.poly([(-8, -6), (-14, -18), (-4, -8)], dark)
    p.poly([(2, -8), (6, -18), (8, -6)], dark)

    def face(d, part):
        for ex in (0, 7):
            x, y = part.P(ex, -2)
            d.ellipse([x - 2 * SS, y - 2 * SS, x + 2 * SS, y + 2 * SS], fill=(255, 80, 60, 255))
    p.overlay(face)
    save_part(p, outdir, tex_seed=31, **o)
    p = Part('bat_wing', 52, 36, (4, 6))  # pivot at shoulder, wing extends +x (toward the back) and down
    p.poly([(0, 0), (16, -4), (34, -2), (46, 6), (40, 14), (30, 22), (18, 26), (8, 20), (2, 10)], mem)
    for tip in ((46, 6), (40, 14), (30, 22)):
        p.limb((0, 0), tip, 3, 1, dark)
    save_part(p, outdir, tex_seed=32, **o)
    return dict(name='bat', height=30, hunch=0, reach=0, leg_len=0, parts=[
        dict(name='wing_far', tex='bat_wing', parent=None, at=[-4, -4], pivot=[4, 6], z=2, len=40),
        dict(name='torso', tex='bat_body', parent=None, at=[0, 0], pivot=[18, 14], z=10, len=0),
        dict(name='wing_near', tex='bat_wing', parent=None, at=[-2, -2], pivot=[4, 6], z=20, len=40),
    ])


# ------------------------------------------------------------------- fx ----

def fx_sprites():
    mkdir(FX)
    # claw slash: three thin arcs, bright core with soft edge
    w, h = 160, 120
    img = new_rgba(w * SS, h * SS)
    d = ImageDraw.Draw(img)
    for i in range(3):
        off = (i - 1) * 22
        for k, (col, wd) in enumerate((((255, 230, 200), 10), ((255, 255, 255), 4))):
            d.arc([(-40) * SS, (-60 + off) * SS, (150) * SS, (150 + off) * SS], 300, 20, fill=col + (255,), width=wd * SS)
    img = img.filter(ImageFilter.GaussianBlur(1.5 * SS)).resize((w, h), Image.LANCZOS)
    img.save(os.path.join(FX, 'slash_claw.png'))
    # sword slash: one broad crescent
    img = new_rgba(w * SS, h * SS)
    d = ImageDraw.Draw(img)
    d.pieslice([(-20) * SS, (-20) * SS, (160) * SS, (140) * SS], 290, 40, fill=(210, 220, 255, 150))
    d.pieslice([(-8) * SS, (-8) * SS, (148) * SS, (128) * SS], 290, 40, fill=(0, 0, 0, 0))
    d.arc([(-20) * SS, (-20) * SS, (160) * SS, (140) * SS], 290, 40, fill=(255, 255, 255, 255), width=5 * SS)
    img = img.filter(ImageFilter.GaussianBlur(1.2 * SS)).resize((w, h), Image.LANCZOS)
    img.save(os.path.join(FX, 'slash_sword.png'))
    # impact burst: spiky star
    s = 96
    img = new_rgba(s * SS, s * SS)
    d = ImageDraw.Draw(img)
    pts = []
    rs = np.random.RandomState(3)
    for i in range(16):
        a = i / 16 * 2 * math.pi
        r = (s / 2 - 2) * (1 if i % 2 == 0 else rs.uniform(0.3, 0.45))
        pts.append((s / 2 * SS + math.cos(a) * r * SS, s / 2 * SS + math.sin(a) * r * SS))
    d.polygon(pts, fill=(255, 240, 210, 255))
    d.ellipse([(s / 2 - 12) * SS, (s / 2 - 12) * SS, (s / 2 + 12) * SS, (s / 2 + 12) * SS], fill=(255, 255, 255, 255))
    img = img.filter(ImageFilter.GaussianBlur(0.8 * SS)).resize((s, s), Image.LANCZOS)
    img.save(os.path.join(FX, 'impact.png'))
    # blood drop / spark shard
    img = new_rgba(12 * SS, 12 * SS)
    d = ImageDraw.Draw(img)
    d.ellipse([2 * SS, 2 * SS, 10 * SS, 10 * SS], fill=(255, 255, 255, 255))
    img.resize((12, 12), Image.LANCZOS).save(os.path.join(FX, 'drop.png'))
    img = new_rgba(16 * SS, 6 * SS)
    d = ImageDraw.Draw(img)
    d.polygon([(0, 3 * SS), (16 * SS, 0), (16 * SS, 6 * SS)], fill=(255, 255, 255, 255))
    img.resize((16, 6), Image.LANCZOS).save(os.path.join(FX, 'shard.png'))
    # torch flame frames (6) for animated torches
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
    # ground shadow blob
    img = new_rgba(64, 20)
    arr = np.zeros((20, 64))
    y, x = np.mgrid[0:20, 0:64]
    r = np.sqrt(((x - 31.5) / 30) ** 2 + ((y - 9.5) / 8) ** 2)
    arr = np.clip(1 - r, 0, 1) ** 1.2
    rgba(np.zeros((20, 64, 3)), arr * 200).save(os.path.join(FX, 'shadow.png'))


# ------------------------------------------------------------- world props ----

def world_props():
    out = os.path.join(ROOT, 'assets', 'sprites', 'world')
    mkdir(out)
    # iron gate: arch with bars and spikes, 200x260, pivot bottom-centre
    w, h = 200, 260
    p = Part('gate', w, h, (w // 2, h - 4))
    iron = (54, 56, 66); dark = (30, 30, 38); stone = (70, 66, 72)
    # stone posts
    for sx in (-96, 76):
        p.poly([(sx, 0), (sx + 20, 0), (sx + 20, -230), (sx + 10, -246), (sx, -230)], stone)
    # arch
    p.poly([(-76, -200), (-50, -236), (0, -250), (50, -236), (76, -200), (76, -186), (50, -222), (0, -236), (-50, -222), (-76, -186)], iron)
    # bars
    for i in range(9):
        bx = -68 + i * 17
        top = -228 + abs(i - 4) * 9
        p.poly([(bx - 3, 0), (bx + 3, 0), (bx + 3, top), (bx - 3, top)], iron)
        p.poly([(bx - 5, top), (bx + 5, top), (bx, top - 16)], (90, 92, 104))
    # cross rails
    for ry in (-40, -120, -190):
        p.poly([(-76, ry), (76, ry), (76, ry + 8), (-76, ry + 8)], dark)
    p.finish(outline=(8, 6, 10), texture=0.08, rim=0.5)[0].save(os.path.join(out, 'gate.png'))
    # stone platform segment 96x28, tileable horizontally, pivot irrelevant
    w, h = 96, 28
    img = new_rgba(w * SS, h * SS)
    d = ImageDraw.Draw(img)
    rs = np.random.RandomState(5)
    x = 0
    while x < w:
        sw = rs.randint(22, 40)
        col = (58 + rs.randint(-8, 8), 54 + rs.randint(-8, 8), 52 + rs.randint(-6, 6), 255)
        d.rectangle([x * SS, 6 * SS, min(w, x + sw) * SS - 2, h * SS], fill=col)
        d.rectangle([x * SS, 6 * SS, min(w, x + sw) * SS - 2, 9 * SS], fill=(90, 86, 80, 255))
        x += sw + 1
    # moss / grass on top
    for i in range(50):
        gx = rs.uniform(0, w)
        draw_tapered_line(d, (gx * SS, 8 * SS), ((gx + rs.uniform(-3, 3)) * SS, (8 - rs.uniform(4, 10)) * SS), 2 * SS, 0.5, (46, 64, 30, 255))
    img = img.resize((w, h), Image.LANCZOS)
    # dark underside
    arr = np.array(img).astype(float)
    arr[:, :, :3] *= np.linspace(1.15, 0.45, h)[:, None, None]
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(out, 'platform.png'))
    # fence post + rail segment 64x60
    p = Part('fence', 64, 60, (32, 56))
    wood = (52, 40, 30)
    p.poly([(-30, 0), (-22, 0), (-22, -50), (-26, -56), (-30, -50)], wood)
    p.poly([(-32, -40), (32, -36), (32, -30), (-32, -34)], wood)
    p.poly([(-32, -18), (32, -14), (32, -8), (-32, -12)], wood)
    p.finish(outline=(10, 8, 8), texture=0.15)[0].save(os.path.join(out, 'fence.png'))


# ---------------------------------------------------------------- preview ----

def pose_preview(rig, outdir, path, scale=2):
    """Assemble the rig in a neutral pose (all angles 0) using the same maths as Rig.js.
    Writes the 2x view at `path`, a 1x view (`*_1x.png`), the normal maps (`*_n.png`) and a relit
    check (`*_lit.png`: colour modulated by a point light shaded from the normal map)."""
    parts = {p['name']: p for p in rig['parts']}
    imgs = {p['name']: Image.open(os.path.join(outdir, p['tex'] + '.png')).convert('RGBA') for p in rig['parts']}
    nimgs = {p['name']: Image.open(os.path.join(outdir, p['tex'] + '_n.png')).convert('RGBA') for p in rig['parts']}
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
    rigs = [
        beast_parts(SPR),
        armored_parts('knight', KNIGHT, SPR, helmet='great', weapon='sword', shield=True),
        armored_parts('spearman', SPEARMAN, SPR, helmet='kettle', weapon='spear', shield=False),
        armored_parts('skeleton', SKELETON, SPR, helmet='none', weapon='rusty', shield=False, bony=True),
        armored_parts('warden', WARDEN, SPR, helmet='great', weapon='axe', shield=False, heavy=True),
        bat_parts(SPR),
    ]
    manifest = {}
    for rig in rigs:
        json.dump(rig, open(os.path.join(RIGS, rig['name'] + '.json'), 'w'), indent=1)
        manifest[rig['name']] = dict(textures=sorted({p['tex'] for p in rig['parts']}), normals=True)
        if preview:
            pose_preview(rig, SPR, os.path.join(preview, f"rig_{rig['name']}.png"))
    json.dump(manifest, open(os.path.join(RIGS, 'manifest.json'), 'w'), indent=1)
    fx_sprites()
    world_props()
    print('rigs:', ', '.join(manifest))


if __name__ == '__main__':
    main()
