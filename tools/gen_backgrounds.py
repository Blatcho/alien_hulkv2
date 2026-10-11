"""Generate tileable parallax background layers for each zone.

Usage: python3 tools/gen_backgrounds.py [--preview DIR]
Outputs assets/bg/<zone>/*.png plus assets/bg/layers.json describing scroll factors and placement.
"""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from artlib import (hex2rgb, fbm_1d, fbm_2d, vgradient_image, rgba, new_rgba, tile_draw, ridge_fill,
                    alpha_fade_bottom, blend_toward, soft_disc, multiply_alpha, tint_noise, draw_tree,
                    draw_vine, draw_tapered_line, lerp_rgb)

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets', 'bg')
VW, VH = 1280, 720          # view size
GROUND_Y = 600              # collision top of the ground in view space
W = 2048                    # tile width for most layers

ZONES = {
    'thornmoor': dict(
        sky=[(0, '#06070f'), (0.3, '#121a2e'), (0.55, '#2a2f4a'), (0.7, '#4e4458'), (0.82, '#7a5a48'), (0.9, '#5a3e3a'), (1, '#2a2230')],
        star_density=0.0009, moon=dict(x=940, y=118, r=46, color='#ece6d6', glow='#9fa8c8'),
        cloud_color='#171a28', cloud_lit='#8c8aa6', cloud_cover=0.6,
        fog='#2e2c3c', far_mount=('#2a2a42', '#2c2c40'), near_mount=('#1a1b2c', '#1f2030'),
        castle='#10121b', castle_lit='#f0a040', trees='#0b0d12', hedge=('#0b100d', '#151c13'),
        ground=('#33291c', '#1a1510'), stone=('#3e3a36', '#2a2724'), grass='#2e3a1e',
        fg='#07090c', embers=True, structures='castle',
    ),
    'graveyard': dict(
        sky=[(0, '#04050b'), (0.4, '#0b1120'), (0.7, '#182334'), (0.88, '#2b3a3e'), (1, '#1a2422')],
        star_density=0.0016, moon=dict(x=640, y=130, r=70, color='#dfe6d8', glow='#7fb0a0'),
        cloud_color='#121824', cloud_lit='#5a7a78', cloud_cover=0.45,
        fog='#223034', far_mount=('#141c28', '#1c2630'), near_mount=('#10161f', '#161d26'),
        castle='#0d1117', castle_lit='#8fd0a0', trees='#070a0c', hedge=('#0c130f', '#152015'),
        ground=('#20241a', '#141710'), stone=('#4a4f48', '#30342e'), grass='#223020',
        fg='#05070a', embers=False, structures='chapel',
    ),
    'castle': dict(
        sky=[(0, '#07060a'), (0.4, '#171322'), (0.7, '#2a2030'), (0.88, '#4a2c2a'), (1, '#2a1a1c')],
        star_density=0.0004, moon=dict(x=300, y=100, r=40, color='#e8dccc', glow='#a08890'),
        cloud_color='#1c1620', cloud_lit='#7a5a60', cloud_cover=0.7,
        fog='#2e2430', far_mount=('#1a1522', '#241c2c'), near_mount=('#15111c', '#1c1622'),
        castle='#0e0b12', castle_lit='#ff9a30', trees='#0a080e', hedge=('#17131a', '#221c26'),
        ground=('#2a2628', '#19171a'), stone=('#5a5558', '#3c383c'), grass='#2a2a22',
        fg='#06050a', embers=True, structures='walls',
    ),
}


def mkdir(p):
    os.makedirs(p, exist_ok=True)


# ------------------------------------------------------------------ sky ----

def gen_sky(z, seed):
    rs = np.random.RandomState(seed)
    img = vgradient_image(W, VH, z['sky'])
    arr = np.array(img).astype(float)
    # stars
    n = int(W * VH * z['star_density'])
    for _ in range(n):
        x, y = rs.randint(0, W), int(rs.rand() ** 1.8 * VH * 0.6)
        b = rs.uniform(0.3, 1.0) * (1 - y / (VH * 0.6))
        arr[y, x, :3] = np.minimum(255, arr[y, x, :3] + 200 * b)
        if b > 0.7:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = (x + dx) % W, max(0, y + dy)
                arr[yy, xx, :3] = np.minimum(255, arr[yy, xx, :3] + 90 * b)
    img = Image.fromarray(arr.astype(np.uint8), 'RGBA')
    # clouds: two fbm fields, thresholded, soft; lit edges from above (moon light)
    cl = fbm_2d(W, VH, 6, 3, octaves=6, persistence=0.55, seed=seed + 11)
    cl2 = fbm_2d(W, VH, 12, 6, octaves=4, persistence=0.5, seed=seed + 23)
    ys = np.linspace(0, 1, VH)[:, None]
    band = np.clip(1 - np.abs(ys - 0.42) / 0.42, 0, 1) ** 0.8    # clouds mostly mid-upper sky
    density = (cl * 0.75 + cl2 * 0.25) * band
    cover = z['cloud_cover']
    a = np.clip((density - (0.56 - cover * 0.25)) / 0.16, 0, 1)
    a = a ** 1.2
    # lighting: gradient of density upward -> lit top edges
    gy, gx = np.gradient(density)
    lit = np.clip(-gy * 70 + 0.08, 0, 1)
    m = z['moon']
    xx = np.arange(W)[None, :]
    dist = np.sqrt(((xx - m['x']) / 520.0) ** 2 + ((np.arange(VH)[:, None] - m['y']) / 320.0) ** 2)
    moonlight = np.clip(1 - dist, 0, 1) ** 1.5
    lit = np.clip(lit * (0.6 + 0.9 * moonlight) + moonlight * 0.35, 0, 1)
    base = np.array(hex2rgb(z['cloud_color']), float)
    litc = np.array(hex2rgb(z['cloud_lit']), float)
    rgb = base[None, None, :] * (1 - lit[..., None]) + litc[None, None, :] * lit[..., None]
    # darker bottoms
    rgb *= (0.75 + 0.25 * (1 - ys))[..., None]
    cloud = rgba(rgb, a * 0.97 * 255)
    cloud = cloud.filter(ImageFilter.GaussianBlur(1.2))
    img.alpha_composite(cloud)
    # distant haze above the horizon
    haze = np.clip((ys - 0.7) / 0.3, 0, 1) ** 1.5
    img = blend_toward(img, z['fog'], np.repeat(haze, W, axis=1) * 0.55)
    return img


def gen_moon(z, seed):
    m = z['moon']
    r = m['r']
    size = int(r * 7)
    img = new_rgba(size, size)
    glow = soft_disc(size, m['glow'], inner=0.0, power=2.6)
    glow = multiply_alpha(glow, 0.55)
    img.alpha_composite(glow)
    glow2 = soft_disc(int(r * 2.6), m['glow'], inner=0.2, power=1.6)
    glow2 = multiply_alpha(glow2, 0.5)
    img.alpha_composite(glow2, (int(size / 2 - r * 1.3), int(size / 2 - r * 1.3)))
    disc = new_rgba(size, size)
    d = ImageDraw.Draw(disc)
    c = size / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=hex2rgb(m['color']) + (255,))
    # craters / mottling
    n = fbm_2d(size, size, 6, 6, octaves=4, seed=seed, wrap_x=False)
    arr = np.array(disc).astype(float)
    shade = 0.82 + 0.25 * n
    # limb darkening
    y, x = np.mgrid[0:size, 0:size]
    rr = np.sqrt((x - c) ** 2 + (y - c) ** 2) / r
    shade *= np.clip(1.05 - rr ** 3 * 0.35, 0, 1)
    arr[..., :3] *= shade[..., None]
    disc = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
    img.alpha_composite(disc)
    return img


# ------------------------------------------------------------ mountains ----

def gen_mountains(z, seed, base_y, amp, colors, fade_start, cells=5, jag=0.5, fog_strength=0.7):
    ridge = fbm_1d(W, cells, octaves=6, persistence=0.55, seed=seed)
    ridge_j = fbm_1d(W, cells * 4, octaves=4, persistence=0.6, seed=seed + 5, ridged=True)
    y = base_y - (ridge * 1.0 + ridge_j * jag) / (1 + jag) * amp
    # sharpen peaks
    y = base_y - (base_y - y) ** 1.08 * ((base_y - y).max() ** -0.08 if (base_y - y).max() > 0 else 1)
    tex = fbm_2d(W, VH, 24, 8, octaves=4, seed=seed + 9)
    img = ridge_fill(W, VH, y, colors[0], colors[1], fade_to=z['fog'], fade_start=fade_start,
                     fade_power=1.3, texture=tex, texture_strength=0.10)
    # fog that thickens toward the bottom
    ys = np.linspace(0, 1, VH)[:, None]
    f = np.clip((ys - fade_start) / (1 - fade_start), 0, 1) ** 1.2 * fog_strength
    img = blend_toward(img, z['fog'], np.repeat(f, W, axis=1))
    # slight lit rims on the moon side (right-facing slopes)
    arr = np.array(img).astype(float)
    slope = np.gradient(y)
    rim = np.clip(-slope * 0.5, 0, 1)
    band = np.zeros((VH, W))
    yy = np.arange(VH)[:, None]
    near = np.clip(1 - (yy - y[None, :]) / 14, 0, 1)
    band = near * rim[None, :]
    arr[..., :3] += band[..., None] * np.array([22, 22, 30])
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


# ------------------------------------------------------- castle / ruins ----

def crenellate(d, x0, x1, y, h, step, fill, dx):
    x = x0
    k = 0
    while x < x1:
        if k % 2 == 0:
            d.rectangle([x + dx, y - h, min(x + step, x1) + dx, y], fill=fill)
        x += step
        k += 1


def draw_castle(d, x, base_y, fill, lit, rs, dx, scale=1.0):
    S = scale
    # curtain wall
    wall_h = 150 * S
    d.rectangle([x + dx, base_y - wall_h, x + 520 * S + dx, base_y], fill=fill)
    crenellate(d, x, x + 520 * S, base_y - wall_h, 14 * S, 16 * S, fill, dx)
    # towers
    for tx, th, tw in ((0, 300, 70), (210, 420, 90), (450, 340, 76)):
        tx = x + tx * S; th *= S; tw *= S
        d.rectangle([tx + dx, base_y - th, tx + tw + dx, base_y], fill=fill)
        crenellate(d, tx - 6 * S, tx + tw + 6 * S, base_y - th, 16 * S, 12 * S, fill, dx)
        # spire
        d.polygon([(tx - 4 * S + dx, base_y - th - 14 * S), (tx + tw / 2 + dx, base_y - th - 120 * S), (tx + tw + 4 * S + dx, base_y - th - 14 * S)], fill=fill)
        # windows
        for wy in np.arange(base_y - th + 50 * S, base_y - 30 * S, 48 * S):
            wx = tx + tw / 2 + dx
            col = lit if rs.rand() < 0.45 else tuple(max(0, c - 8) for c in fill[:3]) + (255,)
            d.rectangle([wx - 3 * S, wy, wx + 3 * S, wy + 12 * S], fill=col)
            d.polygon([(wx - 3 * S, wy), (wx, wy - 5 * S), (wx + 3 * S, wy)], fill=col)
    # gatehouse arch
    gx = x + 300 * S
    d.rectangle([gx + dx, base_y - 190 * S, gx + 110 * S + dx, base_y], fill=fill)
    crenellate(d, gx - 8 * S, gx + 118 * S, base_y - 190 * S, 18 * S, 14 * S, fill, dx)


def draw_thorn_tower(d, x, base_y, fill, rs, dx, h=420):
    w = 54
    d.polygon([(x + dx, base_y), (x + 8 + dx, base_y - h), (x + w - 8 + dx, base_y - h), (x + w + dx, base_y)], fill=fill)
    # spikes crown
    for i in range(5):
        sx = x + 4 + i * (w - 8) / 4
        d.polygon([(sx - 7 + dx, base_y - h + 6), (sx + dx, base_y - h - 80 - rs.uniform(0, 40)), (sx + 7 + dx, base_y - h + 6)], fill=fill)
    # side spikes
    for i in range(7):
        sy = base_y - h * (0.25 + 0.7 * i / 7)
        side = -1 if i % 2 else 1
        bx = x + (0 if side < 0 else w) + dx
        d.polygon([(bx, sy - 10), (bx + side * 38, sy - 22 - rs.uniform(0, 14)), (bx, sy + 6)], fill=fill)


def draw_ruin_arch(d, x, base_y, fill, dx, w=120, h=160):
    d.rectangle([x + dx, base_y - h * 0.7, x + 22 + dx, base_y], fill=fill)
    d.rectangle([x + w - 22 + dx, base_y - h * 0.5, x + w + dx, base_y], fill=fill)
    d.chord([x + dx, base_y - h - 10, x + w + dx, base_y - h * 0.4], 180, 300, fill=fill)
    d.rectangle([x + 8 + dx, base_y - h * 0.9, x + 14 + dx, base_y - h * 0.72], fill=fill)


def draw_chapel(d, x, base_y, fill, lit, rs, dx):
    # ruined chapel: nave with broken roof, bell tower, rose window
    d.rectangle([x + dx, base_y - 130, x + 260 + dx, base_y], fill=fill)
    d.polygon([(x - 10 + dx, base_y - 130), (x + 120 + dx, base_y - 215), (x + 180 + dx, base_y - 170), (x + 270 + dx, base_y - 130)], fill=fill)
    # tower
    d.rectangle([x + 250 + dx, base_y - 300, x + 330 + dx, base_y], fill=fill)
    d.polygon([(x + 244 + dx, base_y - 300), (x + 290 + dx, base_y - 400), (x + 336 + dx, base_y - 300)], fill=fill)
    d.rectangle([x + 282 + dx, base_y - 280, x + 298 + dx, base_y - 250], fill=lit if rs.rand() < 0.5 else fill)
    # rose window glow
    d.ellipse([x + 100 + dx, base_y - 180, x + 140 + dx, base_y - 140], fill=lit)
    d.ellipse([x + 110 + dx, base_y - 170, x + 130 + dx, base_y - 150], fill=fill)
    # broken wall and arches
    for i in range(3):
        ax = x - 170 + i * 60
        d.rectangle([ax + dx, base_y - 70 - i * 18, ax + 16 + dx, base_y], fill=fill)


def draw_wall_section(d, x, base_y, fill, lit, rs, dx, w=600, h=260):
    d.rectangle([x + dx, base_y - h, x + w + dx, base_y], fill=fill)
    crenellate(d, x, x + w, base_y - h, 22, 24, fill, dx)
    for i in range(int(w // 90)):
        wx = x + 45 + i * 90 + dx
        for wy in (base_y - h + 70, base_y - h + 150):
            col = lit if rs.rand() < 0.35 else tuple(max(0, c - 8) for c in fill[:3]) + (255,)
            d.rectangle([wx - 3, wy, wx + 3, wy + 22], fill=col)
    # towers at ends
    for tx in (x - 40, x + w - 40):
        d.rectangle([tx + dx, base_y - h - 90, tx + 80 + dx, base_y], fill=fill)
        crenellate(d, tx - 6, tx + 86, base_y - h - 90, 20, 14, fill, dx)
        d.polygon([(tx - 6 + dx, base_y - h - 100), (tx + 40 + dx, base_y - h - 210), (tx + 86 + dx, base_y - h - 100)], fill=fill)


def gen_structures(z, seed, base_y=500):
    rs = np.random.RandomState(seed)
    img = new_rgba(W, VH)
    d = ImageDraw.Draw(img)
    fill = hex2rgb(z['castle']) + (255,)
    lit = hex2rgb(z['castle_lit']) + (255,)
    # rolling ground silhouette
    hill = fbm_1d(W, 6, octaves=4, persistence=0.5, seed=seed + 3)
    gy = base_y + 10 - hill * 40
    kind = z['structures']

    def draw(dx):
        if kind == 'castle':
            draw_castle(d, 1250, int(gy[1300]) + 2, fill, lit, rs, dx, scale=0.62)
            draw_thorn_tower(d, 560, int(gy[580]) + 2, fill, rs, dx, h=230)
            draw_ruin_arch(d, 120, int(gy[180]) + 2, fill, dx)
            draw_ruin_arch(d, 1840, int(gy[1900]) + 2, fill, dx, w=90, h=120)
        elif kind == 'chapel':
            draw_chapel(d, 900, int(gy[1000]) + 2, fill, lit, rs, dx)
            draw_ruin_arch(d, 300, int(gy[350]) + 2, fill, dx)
            draw_thorn_tower(d, 1700, int(gy[1720]) + 2, fill, rs, dx, h=300)
            # scattered far gravestones / crosses
            for i in range(14):
                cx = rs.randint(0, W)
                ch = rs.randint(14, 36)
                d.rectangle([cx + dx, int(gy[cx]) - ch, cx + 10 + dx, int(gy[cx]) + 2], fill=fill)
                if rs.rand() < 0.5:
                    d.rectangle([cx - 6 + dx, int(gy[cx]) - ch + 8, cx + 16 + dx, int(gy[cx]) - ch + 13], fill=fill)
        else:
            draw_wall_section(d, 200, int(gy[400]) + 2, fill, lit, rs, dx, w=700, h=240)
            draw_wall_section(d, 1200, int(gy[1400]) + 2, fill, lit, rs, dx, w=560, h=300)
            draw_castle(d, 860, int(gy[1000]) - 40, fill, lit, rs, dx, scale=0.8)
    tile_draw(draw, W)
    # ground silhouette under the structures
    ground = ridge_fill(W, VH, gy, z['castle'], z['castle'])
    img.alpha_composite(ground)
    # fog fade
    ys = np.linspace(0, 1, VH)[:, None]
    f = np.clip((ys - 0.45) / 0.4, 0, 1) ** 1.0 * 0.92
    img = blend_toward(img, z['fog'], np.repeat(f, W, axis=1))
    # slight blur for distance
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    return img


# ---------------------------------------------------------------- trees ----

def gen_trees(z, seed, base_y=540, count=9, big=True):
    rs = np.random.RandomState(seed)
    img = new_rgba(W, VH)
    d = ImageDraw.Draw(img)
    fill = hex2rgb(z['trees']) + (255,)
    hill = fbm_1d(W, 5, octaves=4, seed=seed + 1)
    gy = base_y + 12 - hill * 40
    xs = sorted(rs.uniform(0, W, count))

    def draw(dx):
        for i, x in enumerate(xs):
            h = rs.uniform(170, 300)
            if big and i in (1, 5):
                h = rs.uniform(380, 460)
            draw_tree(d, x + dx, int(gy[int(x) % W]) + 4, h, rs, fill, max_depth=7,
                      spread=rs.uniform(30, 44), lean=rs.uniform(-12, 12), gnarl=rs.uniform(0.3, 0.5))
    tile_draw(draw, W)
    ground = ridge_fill(W, VH, gy, z['trees'], z['trees'])
    img.alpha_composite(ground)
    ys = np.linspace(0, 1, VH)[:, None]
    f = np.clip((ys - 0.62) / 0.38, 0, 1) ** 1.2 * 0.75
    img = blend_toward(img, z['fog'], np.repeat(f, W, axis=1))
    return img


# ---------------------------------------------------------------- hedge ----

def gen_hedge(z, seed, top_y=500):
    rs = np.random.RandomState(seed)
    img = new_rgba(W, VH)
    d = ImageDraw.Draw(img)
    c0, c1 = hex2rgb(z['hedge'][0]), hex2rgb(z['hedge'][1])
    # mound of brambles
    hill = fbm_1d(W, 10, octaves=5, persistence=0.55, seed=seed + 2)
    gy = top_y + 70 - hill * 80
    mound = ridge_fill(W, VH, gy, z['hedge'][1], z['hedge'][0])
    img.alpha_composite(mound)
    # vines on top of the mound, curling upward
    thorn = tuple(int(c * 1.6) for c in c1) + (255,)

    def draw(dx):
        for i in range(60):
            x = rs.uniform(0, W)
            y0 = gy[int(x) % W] + rs.uniform(-5, 30)
            pts = [(x + dx, y0)]
            ang = rs.uniform(-150, -30)
            L = rs.uniform(40, 130)
            for k in range(5):
                a = math.radians(ang)
                x += math.cos(a) * L / 5; y0 += math.sin(a) * L / 5
                ang += rs.uniform(-55, 55)
                pts.append((x + dx, y0))
            col = lerp_rgb(c0, c1, rs.rand()) + (255,)
            draw_vine(d, pts, rs.uniform(4, 9), col, thorn_fill=col, rs=rs, thorn_every=14, thorn_len=7)
        # a few thin dead stems
        for i in range(10):
            x = rs.uniform(0, W)
            y0 = gy[int(x) % W] + 10
            h = rs.uniform(30, 70)
            draw_tapered_line(d, (x + dx, y0), (x + rs.uniform(-20, 20) + dx, y0 - h), 3, 1, c0 + (255,))
    tile_draw(draw, W)
    # fog at base
    ys = np.linspace(0, 1, VH)[:, None]
    f = np.clip((ys - 0.78) / 0.25, 0, 1) ** 1.5 * 0.5
    img = blend_toward(img, z['fog'], np.repeat(f, W, axis=1))
    img = tint_noise(img, 0.08, seed)
    return img


# --------------------------------------------------------------- ground ----

def gen_ground(z, seed, w=1024, h=220):
    """Ground strip: placed with its top at GROUND_Y - 20 in the game. Rows 0..20 are grass overhang."""
    rs = np.random.RandomState(seed)
    top = 20
    img = new_rgba(w, h)
    arr = np.zeros((h, w, 4), float)
    e0, e1 = np.array(hex2rgb(z['ground'][0]), float), np.array(hex2rgb(z['ground'][1]), float)
    ys = np.linspace(0, 1, h)[:, None]
    tex = fbm_2d(w, h, 16, 4, octaves=5, persistence=0.55, seed=seed)
    t = np.clip((ys - top / h) / (1 - top / h), 0, 1)
    rgb = e0[None, None, :] * (1 - t[..., None]) + e1[None, None, :] * t[..., None]
    rgb = np.repeat(rgb, w, axis=1) * (0.85 + 0.3 * tex)[..., None]
    arr[..., :3] = rgb
    arr[top:, :, 3] = 255
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
    d = ImageDraw.Draw(img)
    # flagstone path: irregular stones in a band
    s0, s1 = hex2rgb(z['stone'][0]), hex2rgb(z['stone'][1])
    x = -10
    row_y = top + 6
    while x < w + 40:
        sw = rs.uniform(30, 70); sh = rs.uniform(12, 22)
        pts = []
        n = rs.randint(5, 8)
        for k in range(n):
            a = 2 * math.pi * k / n + rs.uniform(-0.2, 0.2)
            pts.append((x + sw / 2 + math.cos(a) * sw / 2 * rs.uniform(0.85, 1.0), row_y + sh / 2 + math.sin(a) * sh / 2 * rs.uniform(0.8, 1.0)))
        col = lerp_rgb(s1, s0, rs.rand() * 0.7 + 0.15)
        for dx in (-w, 0, w):
            d.polygon([(px + dx, py) for px, py in pts], fill=col + (255,))
            # highlight top edge
            d.line([(px + dx, py - 1) for px, py in pts[: n // 2 + 1]], fill=lerp_rgb(col, (170, 160, 140), 0.18) + (255,), width=1)
        x += sw + rs.uniform(4, 26)
    # pebbles and cracks below
    for i in range(160):
        px, py = rs.uniform(0, w), rs.uniform(top + 36, h)
        r = rs.uniform(1.5, 4)
        col = lerp_rgb(s1, (20, 18, 14), rs.rand() * 0.6)
        for dx in (-w, 0, w):
            d.ellipse([px - r + dx, py - r * 0.6, px + r + dx, py + r * 0.6], fill=col + (255,))
    # grass tufts along the top edge, overhanging
    g = hex2rgb(z['grass'])
    for i in range(420):
        px = rs.uniform(0, w)
        hgt = rs.uniform(6, 22)
        lean = rs.uniform(-6, 6)
        col = lerp_rgb(g, (10, 14, 8), rs.rand() * 0.5) + (255,)
        for dx in (-w, 0, w):
            draw_tapered_line(d, (px + dx, top + 8), (px + lean + dx, top + 8 - hgt), 3, 0.5, col)
    img = tint_noise(img, 0.07, seed + 1, scale=1)
    # dark vignette toward the bottom
    a = np.array(img).astype(float)
    a[..., :3] *= (1 - np.clip((ys - 0.5) / 0.5, 0, 1) * 0.55)[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


# ----------------------------------------------------------- foreground ----

def gen_foreground(z, seed):
    rs = np.random.RandomState(seed)
    img = new_rgba(W, VH)
    d = ImageDraw.Draw(img)
    fill = hex2rgb(z['fg']) + (255,)
    thorn = tuple(min(255, int(c * 2.2 + 8)) for c in hex2rgb(z['fg'])) + (255,)

    def draw(dx):
        # bottom brambles
        for i in range(26):
            x = rs.uniform(0, W)
            y0 = VH + 10
            pts = [(x + dx, y0)]
            ang = rs.uniform(-130, -50)
            L = rs.uniform(90, 200)
            for k in range(6):
                a = math.radians(ang)
                x += math.cos(a) * L / 6; y0 += math.sin(a) * L / 6
                ang += rs.uniform(-50, 50)
                pts.append((x + dx, y0))
            draw_vine(d, pts, rs.uniform(10, 18), fill, thorn_fill=thorn, rs=rs, thorn_every=22, thorn_len=14)
        # top-left hanging thorns, every other tile
        for i in range(10):
            x = rs.uniform(0, 420)
            y0 = -10
            pts = [(x + dx, y0)]
            ang = rs.uniform(40, 120)
            L = rs.uniform(120, 260)
            for k in range(6):
                a = math.radians(ang)
                x += math.cos(a) * L / 6; y0 += math.sin(a) * L / 6
                ang += rs.uniform(-45, 45)
                pts.append((x + dx, y0))
            draw_vine(d, pts, rs.uniform(10, 16), fill, thorn_fill=thorn, rs=rs, thorn_every=24, thorn_len=14)
        # a few tall spikes from the bottom
        for i in range(8):
            x = rs.uniform(0, W)
            draw_tapered_line(d, (x + dx, VH + 4), (x + rs.uniform(-30, 30) + dx, VH - rs.uniform(90, 170)), 14, 1, fill)
    tile_draw(draw, W)
    img = img.filter(ImageFilter.GaussianBlur(1.6))
    return img


def gen_fog(seed, w=1024, h=256):
    n = fbm_2d(w, h, 6, 2, octaves=5, persistence=0.55, seed=seed)
    ys = np.linspace(0, 1, h)[:, None]
    shape = np.sin(ys * math.pi) ** 1.2
    a = np.clip((n - 0.35) / 0.45, 0, 1) * shape
    rgb = np.ones((h, w, 3)) * np.array([205, 210, 225])[None, None, :]
    return rgba(rgb, a * 255)


def gen_particles():
    mkdir(os.path.join(ROOT, 'assets', 'sprites', 'fx'))
    soft = soft_disc(32, '#ffffff', inner=0.0, power=2.0)
    soft.save(os.path.join(ROOT, 'assets', 'sprites', 'fx', 'particle_soft.png'))
    hard = soft_disc(16, '#ffffff', inner=0.55, power=1.0)
    hard.save(os.path.join(ROOT, 'assets', 'sprites', 'fx', 'particle_hard.png'))
    # light cone / torch glow
    glow = soft_disc(256, '#ffb060', inner=0.0, power=2.4)
    glow.save(os.path.join(ROOT, 'assets', 'sprites', 'fx', 'glow.png'))


def compose_preview(zone, layers, out_path, scroll_x=600):
    """Stack layers as the game would at a given camera x (for eyeballing)."""
    view = new_rgba(VW, VH, (0, 0, 0, 255))
    for L in layers:
        img = L['img']
        sf = L['scroll']
        if L.get('fixed'):
            view.alpha_composite(img, (L['x'], L['y']))
            continue
        w = img.size[0]
        off = int(-(scroll_x * sf) % w)
        y = L.get('y', 0)
        for k in range(-1, VW // w + 2):
            x = off + k * w - w
            if x > VW or x + w < 0:
                continue
            view.alpha_composite(img, (x, y))
    view.save(out_path)


def build_zone(name, preview_dir=None):
    z = ZONES[name]
    seed = abs(hash(name)) % 10000 if False else {'thornmoor': 7, 'graveyard': 23, 'castle': 41}[name]
    outdir = os.path.join(OUT, name)
    mkdir(outdir)
    layers = []
    sky = gen_sky(z, seed); sky.save(os.path.join(outdir, 'sky.png'))
    layers.append(dict(key='sky', img=sky, scroll=0.03))
    moon = gen_moon(z, seed); moon.save(os.path.join(outdir, 'moon.png'))
    mx, my = z['moon']['x'] - moon.size[0] // 2, z['moon']['y'] - moon.size[1] // 2
    layers.append(dict(key='moon', img=moon, scroll=0.0, fixed=True, x=mx, y=my))
    far = gen_mountains(z, seed + 1, 480, 330, z['far_mount'], 0.45, cells=3, jag=0.8, fog_strength=0.85)
    far.save(os.path.join(outdir, 'mountains_far.png'))
    layers.append(dict(key='mountains_far', img=far, scroll=0.08))
    near = gen_mountains(z, seed + 2, 500, 170, z['near_mount'], 0.55, cells=6, jag=1.0, fog_strength=0.75)
    near.save(os.path.join(outdir, 'mountains_near.png'))
    layers.append(dict(key='mountains_near', img=near, scroll=0.14))
    struct = gen_structures(z, seed + 3); struct.save(os.path.join(outdir, 'structures.png'))
    layers.append(dict(key='structures', img=struct, scroll=0.22))
    trees = gen_trees(z, seed + 4); trees.save(os.path.join(outdir, 'trees.png'))
    layers.append(dict(key='trees', img=trees, scroll=0.4))
    hedge = gen_hedge(z, seed + 5); hedge.save(os.path.join(outdir, 'hedge.png'))
    layers.append(dict(key='hedge', img=hedge, scroll=0.65))
    ground = gen_ground(z, seed + 6); ground.save(os.path.join(outdir, 'ground.png'))
    layers.append(dict(key='ground', img=ground, scroll=1.0, y=GROUND_Y - 20))
    fg = gen_foreground(z, seed + 7); fg.save(os.path.join(outdir, 'foreground.png'))
    layers.append(dict(key='foreground', img=fg, scroll=1.3))
    if preview_dir:
        mkdir(preview_dir)
        compose_preview(name, layers, os.path.join(preview_dir, f'preview_{name}.png'))
    meta = dict(
        ground_y=GROUND_Y,
        layers=[dict(key=L['key'], scroll=L['scroll'], y=L.get('y', 0), fixed=bool(L.get('fixed')), x=L.get('x', 0),
                     w=L['img'].size[0], h=L['img'].size[1]) for L in layers],
        moon=dict(x=z['moon']['x'], y=z['moon']['y']), embers=z['embers'], fog=z['fog'],
    )
    return meta


def main():
    preview = None
    if '--preview' in sys.argv:
        preview = sys.argv[sys.argv.index('--preview') + 1]
    only = None
    if '--zone' in sys.argv:
        only = sys.argv[sys.argv.index('--zone') + 1]
    mkdir(OUT)
    gen_particles()
    fog = gen_fog(99); mkdir(os.path.join(OUT, 'common')); fog.save(os.path.join(OUT, 'common', 'fog.png'))
    meta = {}
    meta_path = os.path.join(OUT, 'layers.json')
    if os.path.exists(meta_path):
        meta = json.load(open(meta_path))
    for name in ZONES:
        if only and name != only:
            continue
        print('zone', name)
        meta[name] = build_zone(name, preview)
    json.dump(meta, open(meta_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
