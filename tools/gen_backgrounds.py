"""Generate tileable parallax background layers for each zone.

Usage: python3 tools/gen_backgrounds.py [--preview DIR] [--zone NAME]
Outputs assets/bg/<zone>/*.png plus assets/bg/layers.json describing scroll factors and placement,
and the shared overlay textures in assets/bg/common/.

Every layer is painted from noise fields and procedural silhouettes: skies with volumetric clouds and
star fields, textured rock with snow and mist, stonework structures with lit windows, bark-textured
trees with moss and roots, layered brambles, a bevelled cobblestone ground (with a tangent-space
normal map for Light2D) and depth-of-field foreground thorns.
"""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from artlib import (hex2rgb, fbm_1d, fbm_2d, gradient_column, rgba, new_rgba, tile_draw, ridge_fill,
                    blend_toward, soft_disc, multiply_alpha, tint_noise, draw_vine, draw_tapered_line, lerp_rgb,
                    fbm_warp, gaussian_blur_array, height_shade, normal_map_from_height, brick_height, mask_array,
                    rim_light, paint_grain, draw_tree2, draw_glow_blob, polygon_rotated)

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets', 'bg')
VW, VH = 1280, 720          # view size
GROUND_Y = 600              # collision top of the ground in view space
W = 2048                    # tile width for most layers

ZONES = {
    'thornmoor': dict(
        sky=[(0, '#05060e'), (0.28, '#0f1527'), (0.52, '#232a46'), (0.68, '#443a56'), (0.8, '#6b4a48'), (0.9, '#4a3238'), (1, '#262030')],
        mood=dict(color='#7a3f4a', y=0.5, h=0.1, strength=0.5),      # bruised dusk band
        star_density=0.0010, milky=0.45,
        moon=dict(x=940, y=118, r=46, color='#ece6d6', glow='#9fa8c8'),
        cloud_color='#141726', cloud_lit='#9a98b4', cloud_shadow='#0a0b14', cloud_cover=0.55, storm=False,
        fog='#2e2c3c', far_mount=('#3a3a58', '#2c2c44'), near_mount=('#1c1d30', '#202134'),
        snow='#aab0c8', mist='#5a5a74',
        castle='#12131c', castle_lit='#f0a040', stone_var='#1d1e2a',
        trees='#0b0d12', bark_hi='#1d2028', moss='#3a4436', hedge=('#0b100d', '#151c13'), leaf='#1f2a1a',
        ground=('#33291c', '#1a1510'), stone=('#4a443e', '#2c2825'), grass='#2e3a1e', mud='#241b14',
        puddle='#2a3040', fg='#07090c', embers=True, structures='castle',
        light=(0.5, -0.8), rim='#8c96b8', lantern='#ffb050',
    ),
    'graveyard': dict(
        sky=[(0, '#03040a'), (0.35, '#0a101e'), (0.62, '#15202f'), (0.8, '#1f3236'), (0.92, '#24403c'), (1, '#172420')],
        mood=dict(color='#2f6a5a', y=0.56, h=0.12, strength=0.45),        # cold green-teal haze
        star_density=0.0018, milky=0.7,
        moon=dict(x=640, y=130, r=70, color='#dfe6d8', glow='#7fb0a0'),
        cloud_color='#0f1620', cloud_lit='#6b8f8a', cloud_shadow='#070b10', cloud_cover=0.42, storm=False,
        fog='#223034', far_mount=('#1e2c38', '#1a2630'), near_mount=('#121a22', '#161e26'),
        snow='#9fb4b4', mist='#3e5a58',
        castle='#0d1117', castle_lit='#8fd0a0', stone_var='#161c22',
        trees='#070a0c', bark_hi='#161c1c', moss='#2f3f33', hedge=('#0c130f', '#152015'), leaf='#1b2b1c',
        ground=('#20241a', '#141710'), stone=('#55594f', '#30342e'), grass='#223020', mud='#171a12',
        puddle='#1e2e2c', fg='#05070a', embers=False, structures='chapel',
        light=(0.05, -0.9), rim='#8fc0b0', lantern='#9fe0b0',
    ),
    'castle': dict(
        sky=[(0, '#06050a'), (0.35, '#14101e'), (0.62, '#241a2c'), (0.8, '#3e2428'), (0.92, '#5a2a22'), (1, '#2a1818')],
        mood=dict(color='#8a3a20', y=0.6, h=0.12, strength=0.55),        # red ember glow at the horizon
        star_density=0.0004, milky=0.0,
        moon=dict(x=300, y=100, r=40, color='#e8dccc', glow='#a08890'),
        cloud_color='#17121c', cloud_lit='#7a5a64', cloud_shadow='#08060a', cloud_cover=0.78, storm=True,
        fog='#2e2430', far_mount=('#241c2e', '#221a28'), near_mount=('#17121e', '#1b1522'),
        snow='#9c8a98', mist='#4e3a48',
        castle='#0f0c13', castle_lit='#ff9a30', stone_var='#1a1520',
        trees='#0a080e', bark_hi='#1c1620', moss='#3a3030', hedge=('#17131a', '#221c26'), leaf='#2a2026',
        ground=('#2a2628', '#19171a'), stone=('#5e585c', '#3a363a'), grass='#2a2a22', mud='#1e1a1c',
        puddle='#2c2430', fg='#06050a', embers=True, structures='walls',
        light=(-0.55, -0.8), rim='#b08a98', lantern='#ff8a30',
    ),
}


def mkdir(p):
    os.makedirs(p, exist_ok=True)


def rgbf(h):
    return np.array(hex2rgb(h), float)


def to_img(rgb, alpha):
    return rgba(rgb, alpha)


def shift_up(a, k):
    """a[y] -> a[y-k] (rows move down), top padded with the first row."""
    out = np.empty_like(a)
    out[k:] = a[:-k]
    out[:k] = a[0]
    return out


# ------------------------------------------------------------------ sky ----

def cloud_field(z, seed, cells, aspect, band_c, band_w, cover, softness, warp, octaves=6, persistence=0.55):
    """Density 0..1 for a tileable cloud bank: domain-warped fbm shaped by a vertical envelope.
    The fbm is contrast-stretched so `cover` (0..1) maps to the fraction of the band that is cloud."""
    cy = max(1, int(round(cells * aspect)))
    d = fbm_warp(W, VH, cells, cy, octaves=octaves, persistence=persistence, seed=seed, warp=warp)
    d = (d - d.mean()) / (d.std() + 1e-6)          # ~N(0,1)
    ys = np.linspace(0, 1, VH)[:, None]
    env = np.exp(-((ys - band_c) / band_w) ** 2)
    dens = d + (env - 1.0) * 2.2                   # outside the band the density drops away
    thr = 1.1 - cover * 2.0                        # cover 0.5 -> threshold at ~0.1 sigma
    return np.clip((dens - thr) / (softness * 6), 0, 1) ** 1.3


def light_clouds(a, z, moon_x, moon_y, base_c, lit_c, shadow_c, silver=1.0, ember=None):
    """Colour a cloud alpha field: tops lit from above, undersides in shadow, silver rims facing the moon."""
    ys = np.arange(VH)[:, None].astype(float)
    xs = np.arange(W)[None, :].astype(float)
    soft = gaussian_blur_array(a, 2.5)
    thick = gaussian_blur_array(a, 14)
    # vertical self-shadowing: compare with the density a few px above
    top = np.clip((soft - shift_up(soft, 7)) * 1.6, 0, 1)
    under = np.clip((shift_up(soft, 7) - soft) * 1.4, 0, 1)
    # rims facing the moon
    gy, gx = np.gradient(soft)
    dx, dy = moon_x - xs, moon_y - ys
    dist = np.sqrt(dx * dx + dy * dy) + 1e-6
    dxn, dyn = dx / dist, dy / dist
    prox = np.clip(1 - dist / 620.0, 0, 1) ** 1.4
    rimm = np.clip(-(gx * dxn + gy * dyn) * 9.0, 0, 1) * (0.25 + 0.75 * prox) * silver
    # translucent glow of thin cloud near the moon
    glow = prox * (1 - thick) * 0.45
    base = rgbf(base_c)[None, None, :]
    lit = rgbf(lit_c)[None, None, :]
    shd = rgbf(shadow_c)[None, None, :]
    rgb = base * np.ones((VH, W, 1))
    # body gradient: brighter top of the bank
    rgb = rgb * (0.85 + 0.3 * (1 - ys / VH))[..., None]
    lmix = np.clip(top * 0.9 + rimm + glow, 0, 1)[..., None]
    rgb = rgb * (1 - lmix) + lit * lmix
    smix = np.clip(under * 0.9 * (1 - lmix[..., 0]), 0, 1)[..., None]
    rgb = rgb * (1 - smix) + shd * smix
    # silver highlight on the brightest rims
    rgb = rgb + np.array([60, 62, 80.0])[None, None, :] * (np.clip(rimm - 0.4, 0, 1) * prox)[..., None]
    if ember is not None:
        ecol, estr = rgbf(ember[0]), ember[1]
        hor = np.clip((ys / VH - 0.55) / 0.35, 0, 1) ** 1.5
        emix = (np.clip(under * 1.2, 0, 1) * hor * estr)[..., None]
        rgb = rgb * (1 - emix) + ecol[None, None, :] * emix
    return rgb


def gen_sky(z, seed):
    rs = np.random.RandomState(seed)
    col = gradient_column(VH, z['sky'])
    rgb = np.repeat(col[:, None, :], W, axis=1)
    ys = np.linspace(0, 1, VH)[:, None]
    xs = np.arange(W)[None, :]
    # horizon mood band (dusk bruise / teal haze / ember glow) with slow horizontal variation
    m = z['mood']
    var = 0.6 + 0.4 * fbm_1d(W, 3, octaves=3, seed=seed + 41)[None, :]
    band = np.exp(-((ys - m['y']) / m['h']) ** 2) * var * m['strength']
    if z['storm']:
        band = band + np.clip((ys - 0.5) / 0.5, 0, 1) ** 2 * var * 0.5   # fire-lit horizon
    rgb = rgb * (1 - band[..., None]) + rgbf(m['color'])[None, None, :] * band[..., None]
    # subtle large-scale atmospheric mottling
    atm = fbm_2d(W, VH, 3, 2, octaves=3, seed=seed + 3)
    rgb *= (0.92 + 0.16 * atm)[..., None]

    # ---- star field: varied brightness/size, a few with halos, horizon fade, milky-way band
    stars = np.zeros((VH, W))
    n = int(W * VH * z['star_density'])
    sx = rs.randint(0, W, n)
    sy = (rs.rand(n) ** 1.6 * VH * 0.62).astype(int)
    sb = rs.rand(n) ** 2.2
    np.add.at(stars, (sy, sx), 0.08 + 0.92 * sb)
    big = np.where(sb > 0.82)[0]
    for i in big:
        x, y = sx[i], sy[i]
        r = 1 + int(sb[i] > 0.95)
        for ddx in range(-r, r + 1):
            for ddy in range(-r, r + 1):
                f = 0.35 / (1 + ddx * ddx + ddy * ddy)
                if ddx == 0 and ddy == 0:
                    continue
                stars[max(0, y + ddy), (x + ddx) % W] += f * sb[i]
    if z['milky'] > 0:
        phase = rs.uniform(0, 2 * math.pi)
        yc = 0.26 * VH + 70 * np.sin(2 * math.pi * xs / W + phase)
        yy = np.arange(VH)[:, None]
        env = np.exp(-((yy - yc) / 95.0) ** 2)
        mw = fbm_warp(W, VH, 10, 4, octaves=5, persistence=0.6, seed=seed + 57, warp=0.8)
        haze = np.clip((mw - 0.35) / 0.5, 0, 1) * env * z['milky']
        rgb += rgbf('#8c94c0')[None, None, :] * (haze * 0.22)[..., None]
        # dense faint dust of tiny stars in the band
        nm = int(n * 1.8)
        mx = rs.randint(0, W, nm)
        my = np.clip((yc[0, mx] + rs.randn(nm) * 55).astype(int), 0, VH - 1)
        np.add.at(stars, (my, mx), rs.rand(nm) ** 2 * 0.22 * z['milky'])
    fade = np.clip(1 - (ys - 0.35) / 0.35, 0, 1)
    stars = np.clip(stars, 0, 1.4) * fade
    tint = rgbf('#e8ecff')
    rgb += tint[None, None, :] * (stars * 175)[..., None]
    # a few warm stars
    warm = rs.rand(VH, W) < 0.3
    rgb += np.array([30, -10, -40.0])[None, None, :] * (stars * warm)[..., None]

    # ---- clouds: several banks (high cirrus, mid cumulus, low heavy)
    m0 = z['moon']
    mx, my = m0['x'] + 400, m0['y']          # roughly where the moon sits over the tile in view
    ember = ('#7a3020', 0.6) if z['storm'] else None
    layers = []
    # thin high streaks
    cir = cloud_field(z, seed + 11, 5, 2.2, 0.18, 0.2, z['cloud_cover'] * 0.7, 0.26, 0.5, octaves=5)
    cir = cir * 0.45
    layers.append((cir, 0.6))
    if z['storm']:
        heavy = cloud_field(z, seed + 23, 6, 0.6, 0.38, 0.3, z['cloud_cover'], 0.1, 1.0, octaves=6)
        mid = cloud_field(z, seed + 29, 9, 0.5, 0.52, 0.16, z['cloud_cover'] * 0.9, 0.14, 0.9, octaves=6)
        layers.append((heavy, 0.98))
        layers.append((mid, 0.9))
    else:
        mid = cloud_field(z, seed + 23, 7, 0.55, 0.44, 0.22, z['cloud_cover'], 0.13, 0.9, octaves=6)
        low = cloud_field(z, seed + 29, 12, 0.5, 0.62, 0.1, z['cloud_cover'] * 0.8, 0.16, 0.7, octaves=5)
        layers.append((mid, 0.95))
        layers.append((low, 0.8))
    for k, (a, op) in enumerate(layers):
        crgb = light_clouds(a, z, mx, my, z['cloud_color'], z['cloud_lit'], z['cloud_shadow'],
                            silver=1.0 if k > 0 else 0.5, ember=ember)
        # feather the alpha with fine noise so edges look wispy
        fine = fbm_2d(W, VH, 48, 16, octaves=3, seed=seed + 90 + k)
        aa = np.clip(a * (0.8 + 0.4 * fine), 0, 1) * op
        cimg = to_img(crgb, aa * 255).filter(ImageFilter.GaussianBlur(0.8 if k else 1.6))
        carr = np.array(cimg).astype(float)
        ca = carr[..., 3:4] / 255.0
        rgb = rgb * (1 - ca) + carr[..., :3] * ca
    # distant haze above the horizon
    haze = np.clip((ys - 0.66) / 0.34, 0, 1) ** 1.6
    hz = rgbf(z['fog'])
    rgb = rgb * (1 - haze[..., None] * 0.6) + hz[None, None, :] * (haze[..., None] * 0.6)
    img = to_img(rgb, np.full((VH, W), 255.0))
    img = paint_grain(img, 0.025, 0.02, seed)
    return img


def gen_moon(z, seed):
    m = z['moon']
    r = m['r']
    size = int(r * 7)
    img = new_rgba(size, size)
    glow = soft_disc(size, m['glow'], inner=0.0, power=2.8)
    glow = multiply_alpha(glow, 0.5)
    img.alpha_composite(glow)
    glow2 = soft_disc(int(r * 2.8), m['glow'], inner=0.15, power=1.5)
    glow2 = multiply_alpha(glow2, 0.55)
    img.alpha_composite(glow2, (int(size / 2 - r * 1.4), int(size / 2 - r * 1.4)))
    # faint halo ring (ice crystals)
    ring = soft_disc(int(r * 4.2), '#c8d0ff', inner=0.86, power=1.0)
    ring = multiply_alpha(ring, 0.08)
    img.alpha_composite(ring, (int(size / 2 - r * 2.1), int(size / 2 - r * 2.1)))
    disc = new_rgba(size, size)
    d = ImageDraw.Draw(disc)
    c = size / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=hex2rgb(m['color']) + (255,))
    rs = np.random.RandomState(seed)
    n = fbm_warp(size, size, 7, 7, octaves=5, seed=seed, warp=0.6)
    n2 = fbm_2d(size, size, 20, 20, octaves=3, seed=seed + 4, wrap_x=False)
    y, x = np.mgrid[0:size, 0:size]
    rr = np.sqrt((x - c) ** 2 + (y - c) ** 2) / r
    shade = 0.78 + 0.22 * n + 0.08 * (n2 - 0.5)
    # maria: darker patches
    maria = np.clip((n - 0.55) / 0.2, 0, 1)
    shade *= 1 - 0.22 * maria
    # craters: rings with a lit rim and a dark floor
    for _ in range(14):
        a = rs.uniform(0, 2 * math.pi); d0 = rs.uniform(0, 0.8) * r
        cx, cy = c + math.cos(a) * d0, c + math.sin(a) * d0
        cr = rs.uniform(2, r * 0.16)
        dd = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / cr
        floor = np.clip(1 - dd, 0, 1) ** 0.6
        rim = np.clip(1 - np.abs(dd - 1) / 0.35, 0, 1)
        shade *= 1 - 0.18 * floor
        shade *= 1 + 0.12 * rim * ((x - cx) / cr < 0)
    shade *= np.clip(1.06 - rr ** 3 * 0.4, 0, 1)
    arr = np.array(disc).astype(float)
    arr[..., :3] *= shade[..., None]
    disc = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
    disc = disc.filter(ImageFilter.GaussianBlur(0.6))
    img.alpha_composite(disc)
    return img


# ------------------------------------------------------------ mountains ----

def gen_mountains(z, seed, base_y, amp, colors, fade_start, cells=5, jag=0.5, fog_strength=0.7, far=False):
    rs = np.random.RandomState(seed)
    ridge = fbm_1d(W, cells, octaves=6, persistence=0.55, seed=seed)
    ridge_j = fbm_1d(W, cells * 4, octaves=4, persistence=0.6, seed=seed + 5, ridged=True)
    y = base_y - (ridge * 1.0 + ridge_j * jag) / (1 + jag) * amp
    y = base_y - (base_y - y) ** 1.08 * ((base_y - y).max() ** -0.08 if (base_y - y).max() > 0 else 1)
    yy = np.arange(VH)[:, None].astype(float)
    xs = np.arange(W)[None, :].astype(float)
    below = yy - y[None, :]
    mask = np.clip(below + 0.5, 0, 1)
    lx, ly = z['light']

    # --- rock texture: domain-warped lumps, strata, cracks
    lumps = fbm_warp(W, VH, 14 if far else 18, 5, octaves=5, persistence=0.55, seed=seed + 9, warp=0.9)
    facets = fbm_warp(W, VH, 6, 2, octaves=3, persistence=0.6, seed=seed + 19, warp=1.2, ridged=True)
    wn = fbm_2d(W, VH, 10, 4, octaves=3, seed=seed + 31)
    strata = 0.5 + 0.5 * np.sin(2 * math.pi * (yy + (wn - 0.5) * 90 + below * 0.15) / (11.0 if far else 15.0))
    strata = strata ** 6
    cr = fbm_warp(W, VH, 24, 9, octaves=4, persistence=0.6, seed=seed + 47, warp=0.8, ridged=True)
    cracks = np.clip((cr - 0.86) / 0.1, 0, 1)
    height = lumps * 1.0 + facets * 1.6 - strata * 0.08 - cracks * 0.35
    height = height * (18.0 if far else 26.0)      # px-ish amplitude for shading gradients
    # peaks are sharper: more relief near the ridge line
    relief = np.clip(1 - below / (amp * 0.9), 0.35, 1)

    ct, cb = rgbf(colors[0]), rgbf(colors[1])
    t = np.clip(below / np.maximum(1, (VH - y[None, :])), 0, 1)
    rgb = ct[None, None, :] * (1 - t[..., None]) + cb[None, None, :] * t[..., None]
    rgb = rgb * (0.86 + 0.28 * lumps)[..., None]
    rgb = height_shade(rgb, height * relief, light=(lx, ly), strength=0.045, ambient=0.95, lo=0.4, hi=1.6)
    rgb = rgb * (1 - cracks * 0.35)[..., None]
    rgb = rgb * (1 - strata * 0.12)[..., None]
    # moonlit faces: slopes that face the moon get a cool highlight that fades with depth below the ridge
    slope = np.gradient(gaussian_blur_array(y[None, :].repeat(2, 0), 0)[0]) if False else np.gradient(y)
    slope_s = np.convolve(slope, np.ones(9) / 9, mode='same')
    facing = np.clip(np.sign(lx) * slope_s * 0.9 + 0.05, 0, 1) if abs(lx) > 0.15 else np.clip(0.3 - np.abs(slope_s) * 0.3, 0, 0.3)
    depthf = np.clip(1 - below / (90.0 if far else 140.0), 0, 1) ** 1.4
    moonlit = facing[None, :] * depthf * mask
    rgb += np.array([42, 46, 70.0])[None, None, :] * moonlit[..., None] * (0.7 + 0.5 * lumps)[..., None]
    # dark side faces
    away = np.clip(-np.sign(lx) * slope_s * 0.7, 0, 1) if abs(lx) > 0.15 else 0
    rgb *= (1 - (away[None, :] * depthf * 0.28))[..., None]
    # snow caps on the far peaks
    if far:
        alt = np.clip((base_y - y) / amp, 0, 1)
        snow_t = np.clip((alt - 0.5) / 0.3, 0, 1)
        depth_px = snow_t * 70 + 4
        sn = fbm_2d(W, VH, 40, 12, octaves=3, seed=seed + 61)
        snow = np.clip((depth_px[None, :] - below + (sn - 0.5) * 36) / 8, 0, 1) * (snow_t[None, :] > 0.02)
        snow = snow * (1 - cracks * 0.6) * (0.75 + 0.25 * lumps)
        scol = rgbf(z['snow'])
        srgb = height_shade(np.ones((VH, W, 3)) * scol, height * relief, light=(lx, ly), strength=0.03, ambient=0.95, lo=0.5, hi=1.3)
        rgb = rgb * (1 - snow[..., None]) + srgb * snow[..., None]
    # mist pockets in the valleys
    valley = np.clip((y - (base_y - amp * 0.5)) / (amp * 0.35), 0, 1)
    mn = fbm_warp(W, VH, 10, 3, octaves=4, persistence=0.6, seed=seed + 71, warp=1.0)
    pocket = np.exp(-((below - 60) / 55.0) ** 2) * np.clip((mn - 0.38) / 0.4, 0, 1)
    mistm = pocket * (0.35 + 0.65 * valley[None, :]) * 0.8
    mistc = rgbf(z['mist'])
    rgb = rgb * (1 - mistm[..., None]) + mistc[None, None, :] * mistm[..., None]
    # aerial perspective
    fogc = rgbf(z['fog'])
    f = np.clip((yy / VH - fade_start) / max(1e-6, 1 - fade_start), 0, 1) ** 1.3 * fog_strength
    f = f * np.ones((1, W))
    rgb = rgb * (1 - f[..., None]) + fogc[None, None, :] * f[..., None]
    img = to_img(rgb, mask * 255)
    img = paint_grain(img, 0.03, 0.03, seed)
    if far:
        img = img.filter(ImageFilter.GaussianBlur(0.7))
    return img


# ------------------------------------------------------- castle / ruins ----

class Canvas:
    """Draw targets for a structure layer: silhouette mask, detail overlay, light glow."""

    def __init__(self, z):
        self.sil = Image.new('L', (W, VH), 0)
        self.roof = Image.new('L', (W, VH), 0)
        self.det = new_rgba(W, VH)
        self.glow = new_rgba(W, VH)
        self.ds = ImageDraw.Draw(self.sil)
        self.dr = ImageDraw.Draw(self.roof)
        self.dd = ImageDraw.Draw(self.det)
        self.dg = ImageDraw.Draw(self.glow)
        self.lit = hex2rgb(z['castle_lit'])
        base = hex2rgb(z['castle'])
        self.dark = tuple(max(0, c - 6) for c in base) + (255,)
        self.slate = tuple(max(0, int(c * 0.8)) for c in base) + (255,)
        self.banner = (92, 26, 30, 255)
        self.iron = (10, 9, 12, 255)
        self.windows = []


def crenellate(ds, x0, x1, y, h, step, dx):
    x = x0
    k = 0
    while x < x1:
        if k % 2 == 0:
            ds.rectangle([x + dx, y - h, min(x + step, x1) + dx, y], fill=255)
        x += step
        k += 1


def window(C, x, y, w, h, dx, lit_prob, rs, glow_r=1.0, arrow=True):
    """Arrow slit (pointed) or square window; lit ones get a warm fill and a soft halo."""
    lit = rs.rand() < lit_prob
    col = C.lit + (255,) if lit else C.dark
    C.dd.rectangle([x - w + dx, y, x + w + dx, y + h], fill=col)
    if arrow:
        C.dd.polygon([(x - w + dx, y), (x + dx, y - w * 1.6), (x + w + dx, y)], fill=col)
    if lit:
        r = (w * 4 + h) * glow_r
        C.windows.append((x + dx, y + h / 2, r))


def pennant(C, x, y, length, width, rs, dx, side=1):
    """Torn banner hanging from (x,y): ragged bottom edge, a few tears."""
    pts = [(x + dx, y), (x + side * width + dx, y)]
    n = 6
    for i in range(n, -1, -1):
        t = i / n
        tear = rs.uniform(0, 0.35) * length if i in (2, 4) else rs.uniform(0, 0.12) * length
        pts.append((x + side * width * t + dx, y + length - tear - (length * 0.25 * (t if side > 0 else 1 - t))))
    C.dd.polygon(pts, fill=C.banner)
    # fold shadow
    C.dd.line([(x + side * width * 0.5 + dx, y), (x + side * width * 0.45 + dx, y + length * 0.6)], fill=(60, 14, 18, 255), width=1)
    C.dd.line([(x - side * 2 + dx, y - 2), (x + side * (width + 4) + dx, y - 2)], fill=C.iron, width=2)


def draw_castle(C, x, base_y, rs, dx, scale=1.0):
    S = scale
    ds = C.ds
    # curtain wall
    wall_h = 150 * S
    ds.rectangle([x + dx, base_y - wall_h, x + 520 * S + dx, base_y], fill=255)
    crenellate(ds, x, x + 520 * S, base_y - wall_h, 14 * S, 16 * S, dx)
    # a walkway shadow line under the battlements
    C.dd.line([(x + dx, base_y - wall_h + 16 * S), (x + 520 * S + dx, base_y - wall_h + 16 * S)], fill=C.dark, width=max(1, int(2 * S)))
    for i in range(int(520 * S // (46 * S))):
        wx = x + 23 * S + i * 46 * S
        window(C, wx, base_y - wall_h + 40 * S, 2.2 * S, 12 * S, dx, 0.3, rs)
    # towers
    for tx, th, tw in ((0, 300, 70), (210, 420, 90), (450, 340, 76)):
        tx = x + tx * S; th *= S; tw *= S
        ds.rectangle([tx + dx, base_y - th, tx + tw + dx, base_y], fill=255)
        crenellate(ds, tx - 6 * S, tx + tw + 6 * S, base_y - th, 16 * S, 12 * S, dx)
        # conical slate roof on the central tower, spire on the others
        apex = (tx + tw / 2 + dx, base_y - th - 120 * S)
        ds.polygon([(tx - 4 * S + dx, base_y - th - 14 * S), apex, (tx + tw + 4 * S + dx, base_y - th - 14 * S)], fill=255)
        C.dr.polygon([(tx - 4 * S + dx, base_y - th - 14 * S), apex, (tx + tw + 4 * S + dx, base_y - th - 14 * S)], fill=255)
        C.dd.line([apex, (apex[0], apex[1] - 22 * S)], fill=C.iron, width=max(1, int(2 * S)))
        C.dd.polygon([(apex[0], apex[1] - 22 * S), (apex[0] + 10 * S, apex[1] - 17 * S), (apex[0], apex[1] - 12 * S)], fill=C.banner)
        # string courses (horizontal stone bands)
        for by in np.arange(base_y - th + 30 * S, base_y - 20 * S, 70 * S):
            C.dd.line([(tx + dx, by), (tx + tw + dx, by)], fill=C.dark, width=max(1, int(2 * S)))
        for wy in np.arange(base_y - th + 50 * S, base_y - 30 * S, 48 * S):
            window(C, tx + tw / 2, wy, 3 * S, 13 * S, dx, 0.5, rs)
            if tw > 80 * S:
                window(C, tx + tw * 0.22, wy + 20 * S, 2 * S, 9 * S, dx, 0.3, rs)
    # torn banners on the central tower
    cx = x + 210 * S
    pennant(C, cx + 90 * S + 4 * S, base_y - 420 * S + 30 * S, 70 * S, 22 * S, rs, dx, side=1)
    pennant(C, cx - 4 * S, base_y - 300 * S, 60 * S, 20 * S, rs, dx, side=-1)
    # gatehouse with arch
    gx = x + 300 * S
    ds.rectangle([gx + dx, base_y - 190 * S, gx + 110 * S + dx, base_y], fill=255)
    crenellate(ds, gx - 8 * S, gx + 118 * S, base_y - 190 * S, 18 * S, 14 * S, dx)
    C.dd.rectangle([gx + 38 * S + dx, base_y - 60 * S, gx + 72 * S + dx, base_y], fill=C.dark)
    C.dd.pieslice([gx + 38 * S + dx, base_y - 94 * S, gx + 72 * S + dx, base_y - 26 * S], 180, 360, fill=C.dark)
    glow_c = C.lit + (255,)
    C.dd.rectangle([gx + 50 * S + dx, base_y - 40 * S, gx + 60 * S + dx, base_y], fill=glow_c)
    C.windows.append((gx + 55 * S + dx, base_y - 20 * S, 40 * S))


def draw_broken_bridge(C, x, base_y, rs, dx, w=260, h=120):
    """Two piers and a collapsed span; rubble beneath."""
    ds = C.ds
    pw = 26
    ds.rectangle([x + dx, base_y - h, x + pw + dx, base_y], fill=255)
    ds.rectangle([x + w - pw + dx, base_y - h * 0.85, x + w + dx, base_y], fill=255)
    # arch fragments from each pier, broken in the middle
    span = w - 2 * pw
    for side in (0, 1):
        pts = []
        steps = 9
        for i in range(steps + 1):
            t = i / steps * (0.42 + rs.uniform(0, 0.08))
            if side:
                t = 1 - t
            ax = x + pw + span * t
            ay = base_y - h + 4 - math.sin(t * math.pi) * h * 0.28
            pts.append((ax + dx, ay))
        top = pts
        bot = [(px, py + 18 + rs.uniform(-4, 6)) for px, py in reversed(top)]
        ds.polygon(top + bot, fill=255)
    # parapet stubs
    ds.rectangle([x - 4 + dx, base_y - h - 12, x + pw + 4 + dx, base_y - h], fill=255)
    for i in range(6):
        rx = x + pw + rs.uniform(0, span)
        rw, rh = rs.uniform(6, 16), rs.uniform(4, 9)
        ds.polygon([(rx + dx, base_y), (rx + rw * 0.3 + dx, base_y - rh), (rx + rw + dx, base_y - rh * 0.6), (rx + rw * 1.2 + dx, base_y)], fill=255)


def draw_thorn_tower(C, x, base_y, rs, dx, h=420):
    ds = C.ds
    w = 54
    ds.polygon([(x + dx, base_y), (x + 8 + dx, base_y - h), (x + w - 8 + dx, base_y - h), (x + w + dx, base_y)], fill=255)
    # iron bands and rivets
    for i in range(6):
        by = base_y - h * (0.12 + 0.8 * i / 6)
        t = (base_y - by) / h
        x0 = x + 8 * t + dx; x1 = x + w - 8 * t + dx
        C.dd.rectangle([x0, by - 3, x1, by + 3], fill=C.iron)
        for rx in np.linspace(x0 + 4, x1 - 4, 4):
            C.dd.point((rx, by), fill=(40, 38, 46, 255))
    # spiked crown of curved iron
    for i in range(5):
        sx = x + 4 + i * (w - 8) / 4
        tip = (sx + rs.uniform(-6, 6) + dx, base_y - h - 80 - rs.uniform(0, 40))
        ds.polygon([(sx - 7 + dx, base_y - h + 6), tip, (sx + 7 + dx, base_y - h + 6)], fill=255)
        C.dd.line([(sx + dx, base_y - h + 2), tip], fill=C.iron, width=1)
    # side spikes with iron brackets
    for i in range(7):
        sy = base_y - h * (0.25 + 0.7 * i / 7)
        side = -1 if i % 2 else 1
        bx = x + (0 if side < 0 else w) + dx
        tip = (bx + side * 38, sy - 22 - rs.uniform(0, 14))
        ds.polygon([(bx, sy - 10), tip, (bx, sy + 6)], fill=255)
        C.dd.line([(bx, sy - 2), tip], fill=C.iron, width=1)
        C.dd.rectangle([bx - 3, sy - 12, bx + 3, sy + 8], fill=C.iron)
    # one baleful lit window
    C.dd.rectangle([x + w / 2 - 3 + dx, base_y - h * 0.62, x + w / 2 + 3 + dx, base_y - h * 0.62 + 16], fill=C.lit + (255,))
    C.windows.append((x + w / 2 + dx, base_y - h * 0.62 + 8, 28))


def draw_ruin_arch(C, x, base_y, dx, w=120, h=160):
    ds = C.ds
    ds.rectangle([x + dx, base_y - h * 0.7, x + 22 + dx, base_y], fill=255)
    ds.rectangle([x + w - 22 + dx, base_y - h * 0.5, x + w + dx, base_y], fill=255)
    ds.chord([x + dx, base_y - h - 10, x + w + dx, base_y - h * 0.4], 180, 300, fill=255)
    ds.rectangle([x + 8 + dx, base_y - h * 0.9, x + 14 + dx, base_y - h * 0.72], fill=255)
    C.dd.line([(x + 22 + dx, base_y - h * 0.7), (x + 22 + dx, base_y)], fill=C.dark, width=1)


def draw_cross(C, x, y, h, angle, dx, w=None):
    w = w or h * 0.55
    t = max(2, h * 0.13)
    pts = [(-t / 2, 0), (t / 2, 0), (t / 2, -h * 0.62), (w / 2, -h * 0.62), (w / 2, -h * 0.62 - t), (t / 2, -h * 0.62 - t),
           (t / 2, -h), (-t / 2, -h), (-t / 2, -h * 0.62 - t), (-w / 2, -h * 0.62 - t), (-w / 2, -h * 0.62), (-t / 2, -h * 0.62)]
    C.ds.polygon(polygon_rotated(x + dx, y, pts, angle), fill=255)


def draw_chapel(C, x, base_y, rs, dx):
    ds = C.ds
    # nave with a collapsed roof: walls, broken gable, exposed rafters
    ds.rectangle([x + dx, base_y - 130, x + 260 + dx, base_y], fill=255)
    ds.polygon([(x - 10 + dx, base_y - 130), (x + 120 + dx, base_y - 215), (x + 150 + dx, base_y - 192),
                (x + 165 + dx, base_y - 150), (x + 200 + dx, base_y - 170), (x + 270 + dx, base_y - 130)], fill=255)
    for i in range(7):
        rx = x + 150 + i * 16
        ds.line([(rx + dx, base_y - 130), (rx + 10 + dx, base_y - 185 + i * 3)], fill=255, width=2)
    # pointed-arch windows along the nave
    for i in range(4):
        wx = x + 40 + i * 60
        window(C, wx, base_y - 100, 5, 40, dx, 0.0, rs)
    # bell tower with a broken parapet and a lit belfry
    ds.rectangle([x + 250 + dx, base_y - 300, x + 330 + dx, base_y], fill=255)
    ds.polygon([(x + 244 + dx, base_y - 300), (x + 262 + dx, base_y - 322), (x + 290 + dx, base_y - 400), (x + 320 + dx, base_y - 318), (x + 336 + dx, base_y - 300)], fill=255)
    window(C, x + 290, base_y - 280, 7, 34, dx, 1.0, rs, glow_r=0.8)
    for by in (base_y - 240, base_y - 160, base_y - 80):
        C.dd.line([(x + 250 + dx, by), (x + 330 + dx, by)], fill=C.dark, width=2)
    # rose window: glowing disc with tracery
    cx, cy, r = x + 120 + dx, base_y - 160, 24
    C.dd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=C.lit + (255,))
    C.dd.ellipse([cx - r + 2, cy - r + 2, cx + r - 2, cy + r - 2], fill=tuple(int(c * 0.8) for c in C.lit) + (255,))
    for k in range(8):
        a = k * math.pi / 4
        C.dd.line([(cx, cy), (cx + math.cos(a) * r, cy + math.sin(a) * r)], fill=C.dark, width=2)
    C.dd.ellipse([cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5], outline=C.dark, width=2)
    C.dd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=C.dark, width=3)
    C.windows.append((cx, cy, 90))
    # broken side walls and arches
    for i in range(3):
        ax = x - 170 + i * 60
        ds.rectangle([ax + dx, base_y - 70 - i * 18, ax + 16 + dx, base_y], fill=255)
    ds.chord([x - 170 + dx, base_y - 120, x - 94 + dx, base_y - 40], 200, 300, fill=255)


def draw_brazier(C, x, y, dx, rs, scale=1.0):
    S = scale
    C.ds.rectangle([x - 2 * S + dx, y - 26 * S, x + 2 * S + dx, y], fill=255)
    C.ds.chord([x - 10 * S + dx, y - 36 * S, x + 10 * S + dx, y - 16 * S], 0, 180, fill=255)
    C.dd.chord([x - 10 * S + dx, y - 36 * S, x + 10 * S + dx, y - 16 * S], 0, 180, fill=C.iron)
    for k in range(3):
        fx = x + rs.uniform(-4, 4) * S
        C.dd.polygon([(fx - 5 * S + dx, y - 26 * S), (fx + rs.uniform(-3, 3) * S + dx, y - 48 * S - rs.uniform(0, 10) * S), (fx + 5 * S + dx, y - 26 * S)],
                     fill=(255, 190 - k * 30, 80 - k * 20, 255))
    C.windows.append((x + dx, y - 32 * S, 60 * S))


def draw_wall_section(C, x, base_y, rs, dx, w=600, h=260, gate=False):
    ds = C.ds
    ds.rectangle([x + dx, base_y - h, x + w + dx, base_y], fill=255)
    crenellate(ds, x, x + w, base_y - h, 22, 24, dx)
    C.dd.line([(x + dx, base_y - h + 24), (x + w + dx, base_y - h + 24)], fill=C.dark, width=3)
    # machicolation corbels under the walkway
    for cx in np.arange(x + 12, x + w, 24):
        C.dd.polygon([(cx - 4 + dx, base_y - h + 26), (cx + 4 + dx, base_y - h + 26), (cx + dx, base_y - h + 36)], fill=C.dark)
    for i in range(int(w // 90)):
        wx = x + 45 + i * 90
        for wy in (base_y - h + 70, base_y - h + 150):
            window(C, wx, wy, 3, 24, dx, 0.35, rs)
    if gate:
        gx = x + w / 2
        gw, gh = 48, 110
        # gate passage lit from behind by ember light, with the portcullis grid
        C.dd.rectangle([gx - gw + dx, base_y - gh + 30, gx + gw + dx, base_y], fill=(120, 48, 20, 255))
        C.dd.pieslice([gx - gw + dx, base_y - gh - 18, gx + gw + dx, base_y - gh + 78], 180, 360, fill=(120, 48, 20, 255))
        C.dd.rectangle([gx - gw * 0.6 + dx, base_y - gh + 40, gx + gw * 0.6 + dx, base_y], fill=(210, 110, 40, 255))
        for bx in np.arange(gx - gw + 6, gx + gw, 12):
            C.dd.line([(bx + dx, base_y - gh - 10), (bx + dx, base_y)], fill=C.iron, width=4)
        for by in np.arange(base_y - gh + 6, base_y, 18):
            C.dd.line([(gx - gw + dx, by), (gx + gw + dx, by)], fill=C.iron, width=3)
        for bx in np.arange(gx - gw + 6, gx + gw, 12):
            C.dd.polygon([(bx - 3 + dx, base_y - 4), (bx + dx, base_y + 6), (bx + 3 + dx, base_y - 4)], fill=C.iron)
        C.windows.append((gx + dx, base_y - 30, 120))
        # gatehouse towers flanking the passage
        for tx in (gx - gw - 70, gx + gw):
            ds.rectangle([tx + dx, base_y - h - 60, tx + 70 + dx, base_y], fill=255)
            crenellate(ds, tx - 6, tx + 76, base_y - h - 60, 20, 14, dx)
            window(C, tx + 35, base_y - h + 10, 3, 24, dx, 0.8, rs)
            draw_brazier(C, tx + 35, base_y - h - 60, dx, rs, 1.1)
    # towers at the ends with conical roofs and braziers
    for tx in (x - 40, x + w - 40):
        ds.rectangle([tx + dx, base_y - h - 90, tx + 80 + dx, base_y], fill=255)
        crenellate(ds, tx - 6, tx + 86, base_y - h - 90, 20, 14, dx)
        apex = (tx + 40 + dx, base_y - h - 210)
        ds.polygon([(tx - 6 + dx, base_y - h - 100), apex, (tx + 86 + dx, base_y - h - 100)], fill=255)
        C.dr.polygon([(tx - 6 + dx, base_y - h - 100), apex, (tx + 86 + dx, base_y - h - 100)], fill=255)
        for wy in (base_y - h - 40, base_y - h + 40, base_y - h + 120):
            window(C, tx + 40, wy, 3, 22, dx, 0.6, rs)
        draw_brazier(C, tx + 12, base_y - h - 90, dx, rs, 0.9)
    pennant(C, x + w - 42, base_y - h - 60, 70, 24, rs, dx, side=-1)


def gen_structures(z, seed, base_y=500):
    rs = np.random.RandomState(seed)
    C = Canvas(z)
    hill = fbm_1d(W, 6, octaves=4, persistence=0.5, seed=seed + 3)
    gy = base_y + 10 - hill * 40
    kind = z['structures']

    def draw(dx):
        if kind == 'castle':
            draw_castle(C, 1250, int(gy[1300]) + 2, rs, dx, scale=0.62)
            draw_thorn_tower(C, 560, int(gy[580]) + 2, rs, dx, h=230)
            draw_broken_bridge(C, 60, int(gy[180]) + 2, rs, dx, w=280, h=120)
            draw_ruin_arch(C, 1840, int(gy[1900]) + 2, dx, w=90, h=120)
        elif kind == 'chapel':
            draw_chapel(C, 900, int(gy[1000]) + 2, rs, dx)
            draw_ruin_arch(C, 300, int(gy[350]) + 2, dx)
            draw_thorn_tower(C, 1700, int(gy[1720]) + 2, rs, dx, h=300)
            for i in range(22):
                cx = rs.randint(0, W)
                ch = rs.randint(16, 44)
                if rs.rand() < 0.55:
                    draw_cross(C, cx, int(gy[cx]) + 2, ch, rs.uniform(-22, 22), dx)
                else:
                    C.ds.rounded_rectangle([cx + dx, int(gy[cx]) - ch, cx + 12 + dx, int(gy[cx]) + 2], radius=5, fill=255)
        else:
            draw_wall_section(C, 120, int(gy[400]) + 2, rs, dx, w=780, h=250, gate=True)
            draw_wall_section(C, 1180, int(gy[1400]) + 2, rs, dx, w=600, h=300)
            draw_castle(C, 860, int(gy[1000]) - 40, rs, dx, scale=0.8)
    tile_draw(draw, W)
    # ground silhouette under the structures
    gmask = ridge_fill(W, VH, gy, '#ffffff', '#ffffff').getchannel('A')
    sil = Image.fromarray(np.maximum(np.array(C.sil), np.array(gmask)), 'L')
    mask = mask_array(sil)
    roof = mask_array(C.roof)
    # --- stonework
    coarse = kind == 'walls'
    hgt, sid = brick_height(W, VH, course=8 if coarse else 6, brick=32 if coarse else 16, mortar=1.2, bevel=1.5, seed=seed + 2, chip=0.4)
    weather = fbm_warp(W, VH, 24, 8, octaves=4, persistence=0.55, seed=seed + 8, warp=0.7)
    base = rgbf(z['castle']); var = rgbf(z['stone_var'])
    rgb = (base[None, None, :] * (1 - sid[..., None] * 0.6) + var[None, None, :] * (sid[..., None] * 0.6))
    rgb = rgb * (0.85 + 0.35 * weather)[..., None]
    lx, ly = z['light']
    rgb = height_shade(rgb, hgt * 2.2, light=(lx, ly), strength=0.35, ambient=1.0, lo=0.6, hi=1.5)
    rgb = rgb * (0.7 + 0.3 * hgt)[..., None]          # mortar darker than the stone faces
    # roofs: slate with diagonal tile lines
    yy, xx = np.mgrid[0:VH, 0:W].astype(float)
    tiles = (0.5 + 0.5 * np.sin((yy * 1.0 + xx * 0.25) * 1.4)) ** 8
    slate = rgbf(z['castle']) * 0.75
    rgb = rgb * (1 - roof[..., None]) + (slate[None, None, :] * (0.9 + 0.3 * weather - 0.25 * tiles)[..., None]) * roof[..., None]
    # rounded shading of towers/walls (soft silhouette gradient lit from the moon side)
    soft = gaussian_blur_array(mask, 9)
    gy2, gx2 = np.gradient(soft)
    side = np.clip(1 + (-(gx2 * lx + gy2 * ly)) * 10, 0.6, 1.5)
    rgb = rgb * side[..., None]
    # faint moonlit top edges
    rim = rim_light(mask, light=(lx, ly), width=2.0, power=1.2)
    rgb += rgbf(z['rim'])[None, None, :] * (rim * 0.5)[..., None]
    # vertical gradient toward the base + fog
    rgb = rgb * (1 - np.clip((yy - 380) / 300, 0, 0.45))[..., None]
    img = to_img(rgb, mask * 255)
    img.alpha_composite(C.det)
    # window halos
    for (wx, wy, r) in C.windows:
        draw_glow_blob(img, wx, wy, r, r * 0.8, z['castle_lit'], alpha=0.28, power=2.2)
    # fog fade
    ys = np.linspace(0, 1, VH)[:, None]
    f = np.clip((ys - 0.42) / 0.45, 0, 1) ** 1.1 * 0.9
    img = blend_toward(img, z['fog'], np.repeat(f, W, axis=1))
    img = paint_grain(img, 0.03, 0.02, seed)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    return img


# ---------------------------------------------------------------- trees ----

def paint_trees(z, seed, specs, gy, detail=1.0, moss_prob=0.5, rim_strength=1.0, roots=True):
    """Render a set of trees (x, height, extra kwargs) as a textured, lit RGBA layer.
    specs: list of dicts(x, h, spread, lean, gnarl). gy: ground line per x."""
    rs = np.random.RandomState(seed)
    sil = Image.new('L', (W, VH), 0)
    ds = ImageDraw.Draw(sil)
    det = new_rgba(W, VH)
    dd = ImageDraw.Draw(det)
    moss_c = hex2rgb(z['moss'])
    knot_c = tuple(max(0, c - 4) for c in hex2rgb(z['trees'])) + (255,)
    knot_hi = hex2rgb(z['bark_hi']) + (255,)
    all_segs = []

    def draw(dx):
        rs2 = np.random.RandomState(seed + 1)
        for sp in specs:
            segs = []
            x = sp['x']
            y0 = int(gy[int(x) % W]) + 4
            draw_tree2(ds, x + dx, y0, sp['h'], rs2, 255, max_depth=sp.get('depth', 7), spread=sp['spread'],
                       lean=sp['lean'], gnarl=sp['gnarl'], segments=segs, twist=sp.get('twist', 0.0))
            tw = sp['h'] * 0.09
            if roots:
                # root flares: fan of curved tapered lines from the base into the ground
                for k in range(rs2.randint(3, 6)):
                    a = rs2.uniform(-170, -10)
                    L = rs2.uniform(0.5, 1.4) * tw * 2.4
                    bx, by = x + dx, y0 - tw * 0.3
                    mx_, my_ = bx + math.cos(math.radians(a)) * L * 0.5, by + abs(math.sin(math.radians(a))) * L * 0.25 + 2
                    ex, ey = bx + math.cos(math.radians(a)) * L, by + abs(math.sin(math.radians(a))) * L * 0.35 + 8
                    draw_tapered_line(ds, (bx, by), (mx_, my_), tw * 0.7, tw * 0.35, 255)
                    draw_tapered_line(ds, (mx_, my_), (ex, ey), tw * 0.35, 2, 255)
            # knots on the trunk and main limbs
            for (x0, y0_, x1, y1, w0, w1, dpt) in segs:
                if dpt <= 1 and w0 > 7 and rs2.rand() < 0.45 * detail:
                    t = rs2.uniform(0.2, 0.8)
                    kx, ky = x0 + (x1 - x0) * t, y0_ + (y1 - y0_) * t
                    kr = w0 * rs2.uniform(0.18, 0.3)
                    dd.ellipse([kx - kr * 1.3, ky - kr, kx + kr * 1.3, ky + kr], fill=knot_hi)
                    dd.ellipse([kx - kr * 0.7, ky - kr * 0.55, kx + kr * 0.7, ky + kr * 0.55], fill=knot_c)
                # hanging moss / tatters from limbs
                if dpt >= 2 and rs2.rand() < moss_prob * detail and abs(y1 - y0_) < abs(x1 - x0) * 1.2:
                    for s in range(rs2.randint(1, 3)):
                        t = rs2.uniform(0.1, 0.9)
                        sx, sy = x0 + (x1 - x0) * t, y0_ + (y1 - y0_) * t + w0 * 0.3
                        L = rs2.uniform(10, 40) * (1 if dpt < 4 else 0.6)
                        col = lerp_rgb(moss_c, hex2rgb(z['trees']), rs2.rand() * 0.5) + (255,)
                        px, py = sx, sy
                        for q in range(4):
                            nx_ = px + rs2.uniform(-2.5, 2.5); ny_ = py + L / 4
                            dd.line([(px, py), (nx_, ny_)], fill=col, width=max(1, int(2 - q * 0.4)))
                            px, py = nx_, ny_
                        dd.polygon([(sx - 2, sy), (sx + 2, sy), (sx + rs2.uniform(-2, 2), sy + L * 0.4)], fill=col)
            all_segs.extend(segs)
    tile_draw(draw, W)
    mask = mask_array(sil)
    # bark: vertical streaks + fine grain, modulated by a soft trunk-roundness term
    bark = fbm_2d(W, VH, 256, 10, octaves=3, persistence=0.6, seed=seed + 12)
    grain = fbm_2d(W, VH, 128, 48, octaves=2, seed=seed + 13)
    base = rgbf(z['trees']); hi = rgbf(z['bark_hi'])
    b = np.clip((bark - 0.5) * 2.2 + 0.5, 0, 1) * (0.7 + 0.3 * grain)
    rgb = base[None, None, :] * (1 - b[..., None] * 0.9) + hi[None, None, :] * (b[..., None] * 0.9)
    # roundness: darker toward the silhouette edges on the side away from the light
    soft = gaussian_blur_array(mask, 3)
    lx, ly = z['light']
    gy2, gx2 = np.gradient(soft)
    side = np.clip(1 + (-(gx2 * lx + gy2 * ly)) * 4.0, 0.55, 1.35)
    rgb = rgb * side[..., None]
    # moonlit rim on the side facing the moon (varies tree to tree via a slow 1D field)
    vary = fbm_1d(W, 4, octaves=2, seed=seed + 14)[None, :]
    rim = rim_light(mask, light=(lx, ly), width=2.2, power=1.0) * np.clip(vary * 1.6 - 0.2, 0, 1) * rim_strength
    rgb += rgbf(z['rim'])[None, None, :] * (rim * 0.9)[..., None]
    img = to_img(rgb, mask * 255)
    img.alpha_composite(det)
    return img


def gen_trees(z, seed, base_y=540, count=9, big=True):
    rs = np.random.RandomState(seed)
    hill = fbm_1d(W, 5, octaves=4, seed=seed + 1)
    gy = base_y + 12 - hill * 40
    xs = sorted(rs.uniform(0, W, count))
    specs = []
    for i, x in enumerate(xs):
        h = rs.uniform(170, 300)
        if big and i in (1, 5):
            h = rs.uniform(380, 460)
        specs.append(dict(x=x, h=h, spread=rs.uniform(30, 46), lean=rs.uniform(-14, 14), gnarl=rs.uniform(0.3, 0.55),
                          twist=rs.uniform(-8, 8)))
    # a few far, thinner trees behind (blurred, fogged) for depth
    far_specs = [dict(x=rs.uniform(0, W), h=rs.uniform(120, 220), spread=rs.uniform(30, 44), lean=rs.uniform(-10, 10),
                      gnarl=0.4, twist=0.0, depth=6) for _ in range(6)]
    far = paint_trees(z, seed + 100, far_specs, gy + 6, detail=0.3, moss_prob=0.2, rim_strength=0.4, roots=False)
    far = blend_toward(far, z['fog'], np.full((VH, W), 0.45))
    far = far.filter(ImageFilter.GaussianBlur(1.2))
    img = far
    near = paint_trees(z, seed, specs, gy, detail=1.0, moss_prob=0.55)
    img.alpha_composite(near)
    # ground mound with coarse grass texture
    tex = fbm_2d(W, VH, 60, 20, octaves=3, seed=seed + 5)
    ground = ridge_fill(W, VH, gy, z['trees'], z['trees'], texture=tex, texture_strength=0.25)
    img.alpha_composite(ground)
    ys = np.linspace(0, 1, VH)[:, None]
    f = np.clip((ys - 0.6) / 0.4, 0, 1) ** 1.2 * 0.72
    img = blend_toward(img, z['fog'], np.repeat(f, W, axis=1))
    img = paint_grain(img, 0.03, 0.02, seed)
    return img


# ---------------------------------------------------------------- hedge ----

def draw_skull(d, x, y, r, col, dark):
    d.ellipse([x - r, y - r, x + r, y + r * 0.9], fill=col)
    d.rectangle([x - r * 0.6, y + r * 0.4, x + r * 0.6, y + r * 1.1], fill=col)
    d.ellipse([x - r * 0.65, y - r * 0.25, x - r * 0.15, y + r * 0.25], fill=dark)
    d.ellipse([x + r * 0.15, y - r * 0.25, x + r * 0.65, y + r * 0.25], fill=dark)
    d.polygon([(x - r * 0.12, y + r * 0.35), (x + r * 0.12, y + r * 0.35), (x, y + r * 0.6)], fill=dark)
    for k in range(-2, 3):
        d.line([(x + k * r * 0.22, y + r * 0.75), (x + k * r * 0.22, y + r * 1.05)], fill=dark, width=1)


def draw_bone(d, x, y, L, angle, col, dark):
    a = math.radians(angle)
    x1, y1 = x + math.cos(a) * L, y + math.sin(a) * L
    w = max(2, L * 0.12)
    draw_tapered_line(d, (x, y), (x1, y1), w, w, col)
    for px, py in ((x, y), (x1, y1)):
        nx_, ny_ = -math.sin(a), math.cos(a)
        d.ellipse([px + nx_ * w * 0.5 - w * 0.8, py + ny_ * w * 0.5 - w * 0.8, px + nx_ * w * 0.5 + w * 0.8, py + ny_ * w * 0.5 + w * 0.8], fill=col)
        d.ellipse([px - nx_ * w * 0.5 - w * 0.8, py - ny_ * w * 0.5 - w * 0.8, px - nx_ * w * 0.5 + w * 0.8, py - ny_ * w * 0.5 + w * 0.8], fill=col)
    d.line([(x, y), (x1, y1)], fill=dark, width=1)


def draw_fungi(d, x, y, rs, cap, stem, gill):
    for k in range(rs.randint(2, 5)):
        fx = x + rs.uniform(-10, 10)
        r = rs.uniform(2.5, 6)
        h = rs.uniform(4, 10)
        d.rectangle([fx - r * 0.3, y - h, fx + r * 0.3, y], fill=stem)
        d.chord([fx - r, y - h - r * 0.9, fx + r, y - h + r * 0.9], 180, 360, fill=cap)
        d.line([(fx - r, y - h), (fx + r, y - h)], fill=gill, width=1)


def draw_bramble_layer(d, rs, gy, dx, count, c0, c1, thorn, leaf, width_rng, length_rng, thorn_len, leaf_prob):
    for i in range(count):
        x = rs.uniform(0, W)
        y0 = gy[int(x) % W] + rs.uniform(-5, 30)
        pts = [(x + dx, y0)]
        ang = rs.uniform(-150, -30)
        L = rs.uniform(*length_rng)
        for k in range(5):
            a = math.radians(ang)
            x += math.cos(a) * L / 5; y0 += math.sin(a) * L / 5
            ang += rs.uniform(-55, 55)
            pts.append((x + dx, y0))
        col = lerp_rgb(c0, c1, rs.rand()) + (255,)
        wv = rs.uniform(*width_rng)
        draw_vine(d, pts, wv, col, thorn_fill=thorn, rs=rs, thorn_every=14, thorn_len=thorn_len)
        # small leaves along the vine
        if rs.rand() < leaf_prob:
            for (px, py) in pts[1:]:
                for q in range(rs.randint(1, 3)):
                    la = rs.uniform(0, 2 * math.pi)
                    lr = rs.uniform(3, 6)
                    lx_, ly_ = px + math.cos(la) * lr * 1.2, py + math.sin(la) * lr * 1.2
                    lp = polygon_rotated(lx_, ly_, [(-lr, 0), (-lr * 0.3, -lr * 0.5), (lr * 0.3, -lr * 0.4), (lr, 0), (lr * 0.3, lr * 0.5), (-lr * 0.3, lr * 0.4)], math.degrees(la))
                    d.polygon(lp, fill=leaf)
                    d.line([lp[0], lp[3]], fill=lerp_rgb(leaf[:3], (90, 110, 70), 0.3) + (255,), width=1)


def gen_hedge(z, seed, top_y=500):
    rs = np.random.RandomState(seed)
    c0, c1 = hex2rgb(z['hedge'][0]), hex2rgb(z['hedge'][1])
    hill = fbm_1d(W, 10, octaves=5, persistence=0.55, seed=seed + 2)
    gy = top_y + 70 - hill * 80
    # a few detailed trees standing in the hedge line (behind the brambles)
    tree_specs = [dict(x=rs.uniform(0, W), h=rs.uniform(300, 400), spread=rs.uniform(32, 44), lean=rs.uniform(-10, 10),
                       gnarl=rs.uniform(0.35, 0.5), twist=rs.uniform(-10, 10)) for _ in range(3)]
    img = paint_trees(z, seed + 50, tree_specs, gy - 10, detail=1.3, moss_prob=0.7, rim_strength=1.2)
    # bramble mound with texture
    tex = fbm_warp(W, VH, 40, 14, octaves=4, seed=seed + 4, warp=0.6)
    mound = ridge_fill(W, VH, gy, z['hedge'][1], z['hedge'][0], texture=tex, texture_strength=0.3)
    img.alpha_composite(mound)
    d = ImageDraw.Draw(img)
    thorn_hi = tuple(min(255, int(c * 2.4 + 20)) for c in c1) + (255,)
    thorn_lo = tuple(int(c * 1.5) for c in c1) + (255,)
    leaf = hex2rgb(z['leaf']) + (255,)
    bone = (168, 160, 140, 255); bone_dark = (70, 64, 54, 255)
    fence = (38, 30, 24, 255)
    lantern = hex2rgb(z['lantern'])

    def draw_back(dx):
        draw_bramble_layer(d, rs, gy - 6, dx, 45, c0, lerp_rgb(c0, c1, 0.5), thorn_lo, lerp_rgb(leaf[:3], c0, 0.5) + (255,),
                           (3, 6), (40, 110), 6, 0.3)
    tile_draw(draw_back, W)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    d = ImageDraw.Draw(img)
    props = []

    def draw_front(dx):
        # broken fence bits
        for i in range(4):
            fx = rs.uniform(0, W)
            fy = gy[int(fx) % W] + 12
            for p in range(rs.randint(2, 4)):
                px = fx + p * rs.uniform(18, 26)
                ph = rs.uniform(18, 40)
                d.polygon([(px - 3 + dx, fy), (px - 2 + rs.uniform(-4, 4) + dx, fy - ph), (px + 3 + rs.uniform(-4, 4) + dx, fy - ph), (px + 3 + dx, fy)], fill=fence)
                d.polygon([(px - 3 + dx, fy - ph), (px + dx, fy - ph - 4), (px + 3 + dx, fy - ph)], fill=fence)
            d.line([(fx - 6 + dx, fy - 16 + rs.uniform(-6, 6)), (fx + 60 + dx, fy - 20 + rs.uniform(-10, 10))], fill=fence, width=3)
        draw_bramble_layer(d, rs, gy, dx, 60, c0, c1, thorn_hi, leaf, (4, 9), (40, 130), 7, 0.55)
        for i in range(10):
            x = rs.uniform(0, W)
            y0 = gy[int(x) % W] + 10
            h = rs.uniform(30, 70)
            draw_tapered_line(d, (x + dx, y0), (x + rs.uniform(-20, 20) + dx, y0 - h), 3, 1, c0 + (255,))
        # bones and skulls in the brambles
        for i in range(7):
            x = rs.uniform(0, W)
            y = gy[int(x) % W] + rs.uniform(10, 40)
            if rs.rand() < 0.45:
                draw_skull(d, x + dx, y, rs.uniform(5, 9), bone, bone_dark)
            else:
                draw_bone(d, x + dx, y, rs.uniform(14, 30), rs.uniform(-40, 40), bone, bone_dark)
        # fungi clusters
        cap = lerp_rgb((150, 140, 120), lantern, 0.25) + (255,) if not z['embers'] else (120, 96, 70, 255)
        for i in range(9):
            x = rs.uniform(0, W)
            draw_fungi(d, x + dx, gy[int(x) % W] + rs.uniform(14, 36), rs, cap, (90, 84, 70, 255), (60, 50, 40, 255))
        # lanterns hanging from posts
        for i in range(2):
            x = rs.uniform(0, W)
            y = gy[int(x) % W] + 8
            ph = rs.uniform(60, 90)
            d.line([(x + dx, y), (x + 2 + dx, y - ph)], fill=fence, width=4)
            d.line([(x + 2 + dx, y - ph), (x + 22 + dx, y - ph + 6)], fill=fence, width=3)
            lx_, ly_ = x + 20 + dx, y - ph + 16
            d.line([(lx_, ly_ - 10), (lx_, ly_ - 4)], fill=(30, 28, 30, 255), width=1)
            d.rectangle([lx_ - 5, ly_ - 4, lx_ + 5, ly_ + 10], fill=(28, 26, 30, 255))
            d.rectangle([lx_ - 3, ly_ - 2, lx_ + 3, ly_ + 8], fill=lantern + (255,))
            props.append(('glow', lx_, ly_ + 3, 46))
    tile_draw(draw_front, W)
    for p in props:
        draw_glow_blob(img, p[1], p[2], p[3], p[3], z['lantern'], alpha=0.5, power=2.2)
        draw_glow_blob(img, p[1], p[2], p[3] * 0.35, p[3] * 0.35, '#ffe8b0', alpha=0.6, power=1.5)
    # ground mist rolling over the base of the mound
    mist = fbm_warp(W, VH, 12, 4, octaves=4, persistence=0.6, seed=seed + 9, warp=0.8)
    yy = np.arange(VH)[:, None].astype(float)
    env = np.exp(-((yy - (gy[None, :] + 50)) / 40.0) ** 2) * np.clip((yy - gy[None, :] + 20) / 40, 0, 1)
    ma = np.clip((mist - 0.4) / 0.4, 0, 1) * env * 0.55
    mimg = to_img(np.ones((VH, W, 3)) * rgbf(z['mist']) * 1.25, ma * 255)
    img.alpha_composite(mimg)
    ys = np.linspace(0, 1, VH)[:, None]
    f = np.clip((ys - 0.78) / 0.25, 0, 1) ** 1.5 * 0.45
    img = blend_toward(img, z['fog'], np.repeat(f, W, axis=1))
    img = paint_grain(img, 0.05, 0.03, seed)
    return img


# --------------------------------------------------------------- ground ----

def gen_ground(z, seed, w=1024, h=220):
    """Ground strip placed with its top at GROUND_Y - 20. Rows 0..20 are grass overhang.
    Returns (diffuse RGBA, normal map RGB)."""
    rs = np.random.RandomState(seed)
    top = 20
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    ys = np.linspace(0, 1, h)[:, None]
    e0, e1 = rgbf(z['ground'][0]), rgbf(z['ground'][1])
    mudc = rgbf(z['mud'])
    # --- base earth: colour + height
    t = np.clip((ys - top / h) / (1 - top / h), 0, 1)
    rgb = e0[None, None, :] * (1 - t[..., None]) + e1[None, None, :] * t[..., None]
    rgb = np.repeat(rgb, w, axis=1)
    soil = fbm_warp(w, h, 24, 6, octaves=5, persistence=0.55, seed=seed, warp=0.6)
    fine = fbm_2d(w, h, 128, 28, octaves=2, seed=seed + 1)
    rgb = rgb * (0.78 + 0.42 * soil)[..., None] * (0.9 + 0.2 * fine)[..., None]
    mudm = np.clip((soil - 0.55) / 0.25, 0, 1) * np.clip((yy - 70) / 60, 0, 1)
    rgb = rgb * (1 - mudm[..., None]) + (mudc[None, None, :] * (0.9 + 0.2 * fine)[..., None]) * mudm[..., None]
    height = (soil - 0.5) * 1.2 + (fine - 0.5) * 0.25 - mudm * 0.4

    # --- cobblestone path: individually bevelled stones in the top band
    stone_mask = Image.new('L', (w, h), 0)
    dsm = ImageDraw.Draw(stone_mask)
    stone_id = np.zeros((h, w))
    sid_img = Image.new('F', (w, h), 0.0)
    dsi = ImageDraw.Draw(sid_img)
    s0, s1 = hex2rgb(z['stone'][0]), hex2rgb(z['stone'][1])
    row_y = top + 4
    rows = [(row_y, 20, 1.0), (row_y + 20, 18, 0.9), (row_y + 38, 16, 0.8)]
    k = 0
    for (ry, rh, cov) in rows:
        x = -rs.uniform(0, 30)
        while x < w + 40:
            sw = rs.uniform(18, 46)
            if rs.rand() > cov:
                x += sw + rs.uniform(6, 30)
                continue
            n = rs.randint(5, 8)
            pts = []
            cx, cy = x + sw / 2, ry + rh / 2 + rs.uniform(-2, 2)
            for q in range(n):
                a = 2 * math.pi * q / n + rs.uniform(-0.25, 0.25)
                pts.append((cx + math.cos(a) * sw / 2 * rs.uniform(0.82, 1.0), cy + math.sin(a) * rh / 2 * rs.uniform(0.75, 1.0)))
            k += 1
            for dx in (-w, 0, w):
                dsm.polygon([(px + dx, py) for px, py in pts], fill=255)
                dsi.polygon([(px + dx, py) for px, py in pts], fill=float(k % 97) / 97.0)
            x += sw + rs.uniform(3, 10)
    smask = mask_array(stone_mask)
    sid = np.array(sid_img)
    # bevel: distance-to-edge ramp via successive erosions
    bevel = np.zeros((h, w))
    er = stone_mask
    for i in range(4):
        er = er.filter(ImageFilter.MinFilter(3))
        bevel += mask_array(er)
    bevel = bevel / 4.0
    dome = gaussian_blur_array(smask, 4) * smask
    stone_h = (0.35 + 0.65 * bevel) * smask * 1.0 + dome * 0.3
    sn = fbm_2d(w, h, 64, 16, octaves=3, seed=seed + 7)
    stone_h *= (0.85 + 0.3 * sn)
    scol = np.array([lerp_rgb(s1, s0, v) for v in np.linspace(0, 1, 32)], float)
    svar = scol[np.clip((sid * 31 * (0.6 + 0.4 * sn)).astype(int), 0, 31)]
    srgb = svar * (0.85 + 0.3 * sn)[..., None]
    # moss in the cracks and on the lower faces
    moss_c = rgbf(z['grass']) * 1.1
    mossn = fbm_warp(w, h, 48, 12, octaves=3, seed=seed + 8, warp=0.5)
    gap = np.clip((gaussian_blur_array(smask, 2.5) - smask * 0.6), 0, 1)
    moss = np.clip((mossn - 0.45) / 0.3, 0, 1) * gap * 1.6
    rgb = rgb * (1 - smask[..., None]) + srgb * smask[..., None]
    rgb = rgb * (1 - np.clip(moss, 0, 0.8)[..., None]) + moss_c[None, None, :] * np.clip(moss, 0, 0.8)[..., None]
    height = height * (1 - smask) + (stone_h * 2.4 - 0.2) * smask - gap * 0.4 * (1 - smask)

    # --- puddles (flat, low, reflective) in the mud band
    puddle = np.zeros((h, w))
    pimg = Image.new('L', (w, h), 0)
    dpu = ImageDraw.Draw(pimg)
    puddles = []
    for i in range(5):
        px, py = rs.uniform(0, w), rs.uniform(top + 80, h - 30)
        pw_, ph_ = rs.uniform(30, 80), rs.uniform(7, 16)
        puddles.append((px, py, pw_, ph_))
        for dx in (-w, 0, w):
            pts = []
            n = 10
            for q in range(n):
                a = 2 * math.pi * q / n
                pts.append((px + dx + math.cos(a) * pw_ * rs.uniform(0.8, 1.0), py + math.sin(a) * ph_ * rs.uniform(0.75, 1.0)))
            dpu.polygon(pts, fill=255)
    puddle = mask_array(pimg.filter(ImageFilter.GaussianBlur(1.0)))
    pcol = rgbf(z['puddle'])
    sky_ref = fbm_2d(w, h, 20, 6, octaves=3, seed=seed + 21)
    prgb = pcol[None, None, :] * (0.8 + 0.5 * sky_ref)[..., None]
    rgb = rgb * (1 - puddle[..., None]) + prgb * puddle[..., None]
    height = height * (1 - puddle) - 0.5 * puddle
    # moon highlight streaks on the puddles
    for (px, py, pw_, ph_) in puddles:
        hx = px + rs.uniform(-0.3, 0.3) * pw_
        for dx in (-w, 0, w):
            g = np.exp(-(((xx - hx - dx) / (pw_ * 0.3)) ** 2 + ((yy - py + ph_ * 0.2) / (ph_ * 0.25)) ** 2))
            rgb += np.array([150, 160, 190.0])[None, None, :] * (g * puddle * 0.9)[..., None]

    # --- pebbles: little bumps
    for i in range(260):
        px, py = rs.uniform(0, w), rs.uniform(top + 40, h)
        r = rs.uniform(1.2, 3.6)
        for dx in (-w, 0, w):
            if abs(px + dx - w / 2) > w / 2 + 8:
                continue
            g = np.exp(-(((xx - px - dx) / r) ** 2 + ((yy - py) / (r * 0.7)) ** 2) * 1.2)
            height += g * 0.9
            col = lerp_rgb(s1, (30, 28, 24), rs.rand() * 0.6)
            rgb = rgb * (1 - np.clip(g * 1.4, 0, 1)[..., None]) + np.array(col, float)[None, None, :] * np.clip(g * 1.4, 0, 1)[..., None]
    # --- exposed roots crossing the path
    img = to_img(rgb, np.full((h, w), 255.0))
    d = ImageDraw.Draw(img)
    hmask = Image.new('L', (w, h), 0)
    dh = ImageDraw.Draw(hmask)
    root_c = lerp_rgb(hex2rgb(z['trees']), hex2rgb(z['ground'][0]), 0.4)
    root_hi = lerp_rgb(root_c, (140, 120, 90), 0.3)
    for i in range(4):
        x = rs.uniform(0, w)
        y = rs.uniform(top + 56, h - 20)
        pts = [(x, y)]
        ang = rs.uniform(-30, 30)
        for k in range(5):
            ang += rs.uniform(-35, 35)
            x += math.cos(math.radians(ang)) * 22; y += math.sin(math.radians(ang)) * 10
            pts.append((x, y))
        for dx in (-w, 0, w):
            P = [(px + dx, py) for px, py in pts]
            for q in range(len(P) - 1):
                wq = 7 * (1 - q / 6)
                draw_tapered_line(d, P[q], P[q + 1], wq, wq * 0.8, root_c + (255,))
                draw_tapered_line(dh, P[q], P[q + 1], wq, wq * 0.8, 255)
                d.line([(P[q][0], P[q][1] - wq * 0.3), (P[q + 1][0], P[q + 1][1] - wq * 0.25)], fill=root_hi + (255,), width=1)
    rh = gaussian_blur_array(mask_array(hmask), 1.5)
    height = height + rh * 1.4
    # --- bones half buried
    bone = (150, 142, 122, 255); bone_dark = (60, 54, 46, 255)
    for i in range(3):
        x, y = rs.uniform(0, w), rs.uniform(top + 70, h - 16)
        for dx in (-w, 0, w):
            if rs.rand() < 0.5:
                draw_bone(d, x + dx, y, rs.uniform(12, 22), rs.uniform(-25, 25), bone, bone_dark)
            else:
                draw_skull(d, x + dx, y, rs.uniform(4, 6), bone, bone_dark)
    # --- grass clumps along the top edge with blade detail
    g = hex2rgb(z['grass'])
    for i in range(170):
        px = rs.uniform(0, w)
        base_c = lerp_rgb(g, (10, 14, 8), rs.rand() * 0.5)
        for b in range(rs.randint(3, 7)):
            hgt = rs.uniform(7, 24)
            lean = rs.uniform(-9, 9)
            bx = px + rs.uniform(-5, 5)
            col = lerp_rgb(base_c, (120, 140, 80), max(0, rs.rand() - 0.6)) + (255,)
            for dx in (-w, 0, w):
                draw_tapered_line(d, (bx + dx, top + 10), (bx + lean * 0.5 + dx, top + 10 - hgt * 0.6), 2.6, 1.6, col)
                draw_tapered_line(d, (bx + lean * 0.5 + dx, top + 10 - hgt * 0.6), (bx + lean + dx, top + 10 - hgt), 1.6, 0.4, col)
    # a few grass tufts further down the strip
    for i in range(40):
        px, py = rs.uniform(0, w), rs.uniform(top + 60, h - 10)
        col = lerp_rgb(g, (10, 14, 8), rs.rand() * 0.6) + (255,)
        for b in range(rs.randint(2, 4)):
            for dx in (-w, 0, w):
                draw_tapered_line(d, (px + rs.uniform(-3, 3) + dx, py), (px + rs.uniform(-8, 8) + dx, py - rs.uniform(5, 12)), 2, 0.4, col)
    # --- lighting from the height field and final shading
    arr = np.array(img).astype(float)
    lx, ly = z['light']
    shaded = height_shade(arr[..., :3], gaussian_blur_array(height, 0.6) * 3.0, light=(lx, -0.9), strength=0.18, ambient=1.0, lo=0.5, hi=1.5)
    arr[..., :3] = shaded
    arr[top + 10:, :, 3] = 255
    arr[:top + 10, :, 3] = np.array(img)[:top + 10, :, 3]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
    img = tint_noise(img, 0.05, seed + 1, scale=1)
    a = np.array(img).astype(float)
    a[..., :3] *= (1 - np.clip((ys - 0.45) / 0.55, 0, 1) * 0.55)[..., None]
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
    # normal map (rows above the soil are flat)
    hh = height.copy()
    hh[:top + 8] = hh[top + 8]
    nmap = normal_map_from_height(gaussian_blur_array(hh, 0.7) * 2.2, strength=1.0)
    return img, Image.fromarray(nmap, 'RGB')


# ----------------------------------------------------------- foreground ----

def draw_chain(d, x0, y0, length, angle, col, link=10, sway=0.0):
    a = math.radians(angle)
    px, py = x0, y0
    for i in range(int(length / link)):
        nx_, ny_ = px + math.cos(a) * link, py + math.sin(a) * link
        cx, cy = (px + nx_) / 2, (py + ny_) / 2
        if i % 2 == 0:
            d.ellipse([cx - link * 0.55, cy - link * 0.35, cx + link * 0.55, cy + link * 0.35], outline=col, width=3)
        else:
            d.ellipse([cx - link * 0.32, cy - link * 0.5, cx + link * 0.32, cy + link * 0.5], outline=col, width=3)
        a += math.radians(sway)
        px, py = nx_, ny_
    return px, py


def gen_foreground(z, seed):
    rs = np.random.RandomState(seed)
    fill = hex2rgb(z['fg']) + (255,)
    thorn = tuple(min(255, int(c * 2.6 + 14)) for c in hex2rgb(z['fg'])) + (255,)
    rim = lerp_rgb(hex2rgb(z['fg']), hex2rgb(z['rim']), 0.35) + (255,)
    # layer A: hanging chains and vines, strongly out of focus
    far = new_rgba(W, VH)
    da = ImageDraw.Draw(far)
    # layer B: sharp bottom brambles
    near = new_rgba(W, VH)
    db = ImageDraw.Draw(near)
    leaf = lerp_rgb(hex2rgb(z['fg']), hex2rgb(z['leaf']), 0.6) + (255,)

    def draw(dx):
        # bottom brambles (sharp)
        for i in range(24):
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
            wv = rs.uniform(10, 18)
            draw_vine(db, pts, wv, fill, thorn_fill=thorn, rs=rs, thorn_every=20, thorn_len=15)
            # moonlit edge along the upper side of the vine
            for q in range(len(pts) - 1):
                (ax, ay), (bx, by) = pts[q], pts[q + 1]
                db.line([(ax, ay - wv * 0.32), (bx, by - wv * 0.3)], fill=rim, width=2)
        # tall spikes
        for i in range(8):
            x = rs.uniform(0, W)
            draw_tapered_line(db, (x + dx, VH + 4), (x + rs.uniform(-30, 30) + dx, VH - rs.uniform(90, 170)), 14, 1, fill)
        # hanging vines / chains from the top-left region of the tile (out of focus)
        for i in range(6):
            x = rs.uniform(0, 420)
            y0 = -10
            pts = [(x + dx, y0)]
            ang = rs.uniform(50, 120)
            L = rs.uniform(120, 260)
            for k in range(6):
                a = math.radians(ang)
                x += math.cos(a) * L / 6; y0 += math.sin(a) * L / 6
                ang += rs.uniform(-40, 40)
                pts.append((x + dx, y0))
            draw_vine(da, pts, rs.uniform(10, 16), fill, thorn_fill=thorn, rs=rs, thorn_every=24, thorn_len=14)
            for (px, py) in pts[2:]:
                for q in range(rs.randint(1, 3)):
                    la = rs.uniform(0, 2 * math.pi); lr = rs.uniform(7, 12)
                    lp = polygon_rotated(px + math.cos(la) * lr, py + math.sin(la) * lr,
                                         [(-lr, 0), (-lr * 0.3, -lr * 0.6), (lr * 0.3, -lr * 0.5), (lr, 0), (lr * 0.3, lr * 0.6), (-lr * 0.3, lr * 0.5)], math.degrees(la))
                    da.polygon(lp, fill=leaf)
        for i in range(2):
            x = rs.uniform(60, 400)
            ex, ey = draw_chain(da, x + dx, -6, rs.uniform(140, 260), rs.uniform(80, 100), fill, link=12, sway=rs.uniform(-1.5, 1.5))
            # hook at the end
            da.arc([ex - 10, ey - 4, ex + 10, ey + 16], 0, 220, fill=fill, width=4)
    tile_draw(draw, W)
    far = far.filter(ImageFilter.GaussianBlur(3.2))
    near = near.filter(ImageFilter.GaussianBlur(0.9))
    img = far
    img.alpha_composite(near)
    return img


# ------------------------------------------------------------- common ----

def gen_fog(seed, w=1024, h=256):
    n = fbm_warp(w, h, 6, 2, octaves=5, persistence=0.55, seed=seed, warp=0.8)
    n2 = fbm_2d(w, h, 18, 5, octaves=3, seed=seed + 3)
    ys = np.linspace(0, 1, h)[:, None]
    shape = np.sin(ys * math.pi) ** 1.2
    a = np.clip((n - 0.35) / 0.45, 0, 1) * (0.8 + 0.4 * n2) * shape
    rgb = np.ones((h, w, 3)) * np.array([205, 210, 225])[None, None, :]
    return rgba(rgb, np.clip(a, 0, 1) * 255)


def gen_lightshaft(seed, w=256, h=512):
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    t = yy / h
    half = (10 + 95 * t)                       # wedge widens toward the bottom
    cx = w / 2
    prof = np.clip(1 - np.abs(xx - cx) / half, 0, 1) ** 1.6
    streaks = fbm_2d(w, h, 16, 2, octaves=3, seed=seed, wrap_x=False)
    a = prof * (0.55 + 0.45 * streaks) * (1 - t) ** 1.2 * np.clip(t * 6, 0, 1)
    rgb = np.ones((h, w, 3)) * 255
    return rgba(rgb, a * 255)


def gen_rain(w=4, h=24):
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    a = np.clip(1 - np.abs(xx - (w - 1) / 2) / 1.4, 0, 1) * np.sin(yy / (h - 1) * math.pi) ** 0.7
    rgb = np.ones((h, w, 3)) * np.array([235, 240, 255])[None, None, :]
    return rgba(rgb, a * 255)


def gen_leaf(size=12):
    img = new_rgba(size, size)
    d = ImageDraw.Draw(img)
    pts = polygon_rotated(size / 2, size / 2, [(-5, 0), (-2.5, -3), (2, -2.5), (5, 0), (2, 2.5), (-2.5, 3)], 20)
    d.polygon(pts, fill=(112, 72, 36, 255))
    d.line([pts[0], pts[3]], fill=(70, 42, 20, 255), width=1)
    d.line([pts[1], pts[4]], fill=(140, 96, 50, 255), width=1)
    return img


def gen_ash(size=6):
    disc = soft_disc(size, '#9a9aa0', inner=0.1, power=1.5)
    return multiply_alpha(disc, 0.9)


def gen_lightning(seed, w=400, h=600):
    rs = np.random.RandomState(seed)
    img = new_rgba(w, h)
    d = ImageDraw.Draw(img)

    def bolt(x, y, length, angle, width, depth):
        pts = [(x, y)]
        remaining = length
        while remaining > 0:
            step = rs.uniform(10, 26)
            angle += rs.uniform(-28, 28)
            x += math.sin(math.radians(angle)) * step
            y += math.cos(math.radians(angle)) * step
            pts.append((x, y))
            remaining -= step
            if depth < 3 and rs.rand() < 0.16 and remaining > 40:
                bolt(x, y, remaining * rs.uniform(0.3, 0.6), angle + rs.choice([-1, 1]) * rs.uniform(25, 55), max(1, width * 0.55), depth + 1)
        d.line(pts, fill=(255, 255, 255, 255), width=max(1, int(width)), joint='curve')
    bolt(w * 0.5, 0, h * 0.98, 0, 5, 0)
    glow = img.filter(ImageFilter.GaussianBlur(10))
    glow = multiply_alpha(glow, 0.9)
    core = img.filter(ImageFilter.GaussianBlur(1.2))
    out = new_rgba(w, h)
    # bluish halo under a white core
    garr = np.array(glow).astype(float)
    garr[..., :3] = np.array([170, 190, 255.0])[None, None, :]
    out.alpha_composite(Image.fromarray(garr.astype(np.uint8), 'RGBA'))
    out.alpha_composite(core)
    out.alpha_composite(img)
    return out


def gen_particles():
    mkdir(os.path.join(ROOT, 'assets', 'sprites', 'fx'))
    soft = soft_disc(32, '#ffffff', inner=0.0, power=2.0)
    soft.save(os.path.join(ROOT, 'assets', 'sprites', 'fx', 'particle_soft.png'))
    hard = soft_disc(16, '#ffffff', inner=0.55, power=1.0)
    hard.save(os.path.join(ROOT, 'assets', 'sprites', 'fx', 'particle_hard.png'))
    # light cone / torch glow
    glow = soft_disc(256, '#ffb060', inner=0.0, power=2.4)
    glow.save(os.path.join(ROOT, 'assets', 'sprites', 'fx', 'glow.png'))


def gen_common():
    cdir = os.path.join(OUT, 'common')
    mkdir(cdir)
    gen_fog(99).save(os.path.join(cdir, 'fog.png'))
    gen_lightshaft(5).save(os.path.join(cdir, 'lightshaft.png'))
    gen_rain().save(os.path.join(cdir, 'rain.png'))
    gen_leaf().save(os.path.join(cdir, 'leaf.png'))
    gen_ash().save(os.path.join(cdir, 'ash.png'))
    gen_lightning(17).save(os.path.join(cdir, 'lightning.png'))


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
        y = L.get('y', 0) + (50 if L['key'] == 'foreground' else 0)
        if L['key'] == 'foreground':
            img = multiply_alpha(img.copy(), 0.8)
        for k in range(-1, VW // w + 2):
            x = off + k * w - w
            if x > VW or x + w < 0:
                continue
            view.alpha_composite(img, (x, y))
    view.save(out_path)


def build_zone(name, preview_dir=None):
    z = ZONES[name]
    seed = {'thornmoor': 7, 'graveyard': 23, 'castle': 41}[name]
    outdir = os.path.join(OUT, name)
    mkdir(outdir)
    layers = []
    sky = gen_sky(z, seed); sky.save(os.path.join(outdir, 'sky.png'))
    layers.append(dict(key='sky', img=sky, scroll=0.03))
    moon = gen_moon(z, seed); moon.save(os.path.join(outdir, 'moon.png'))
    mx, my = z['moon']['x'] - moon.size[0] // 2, z['moon']['y'] - moon.size[1] // 2
    layers.append(dict(key='moon', img=moon, scroll=0.0, fixed=True, x=mx, y=my))
    far = gen_mountains(z, seed + 1, 480, 330, z['far_mount'], 0.45, cells=3, jag=0.8, fog_strength=0.85, far=True)
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
    ground, ground_n = gen_ground(z, seed + 6)
    ground.save(os.path.join(outdir, 'ground.png'))
    ground_n.save(os.path.join(outdir, 'ground_n.png'))
    layers.append(dict(key='ground', img=ground, scroll=1.0, y=GROUND_Y - 20, normal='ground_n.png'))
    fg = gen_foreground(z, seed + 7); fg.save(os.path.join(outdir, 'foreground.png'))
    layers.append(dict(key='foreground', img=fg, scroll=1.3))
    if preview_dir:
        mkdir(preview_dir)
        compose_preview(name, layers, os.path.join(preview_dir, f'preview_{name}.png'))
    meta_layers = []
    for L in layers:
        e = dict(key=L['key'], scroll=L['scroll'], y=L.get('y', 0), fixed=bool(L.get('fixed')), x=L.get('x', 0),
                 w=L['img'].size[0], h=L['img'].size[1])
        if L.get('normal'):
            e['normal'] = L['normal']
        meta_layers.append(e)
    meta = dict(
        ground_y=GROUND_Y, layers=meta_layers,
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
    gen_common()
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
