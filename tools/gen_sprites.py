"""Generate rig body-part textures, rig definitions and combat FX sprites.

Usage: python3 tools/gen_sprites.py [--preview DIR]
Outputs assets/sprites/rigs/*.png, assets/rigs/<character>.json and assets/sprites/fx/*.png.

Rig conventions (shared with src/rig/Rig.js):
  * Every part is drawn in its own local frame with the joint (pivot) at a known pixel.
  * Limb parts hang DOWN from their pivot (angle 0 = straight down, positive = clockwise when
    facing right). The torso and head point UP from their pivot (hip / neck).
  * Characters face +x (right). The game flips the whole rig for left.
  * `at` is where a child's pivot sits in the parent's local frame (x right, y down, pixels).
"""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from artlib import hex2rgb, lerp_rgb, fbm_2d, draw_tapered_line, new_rgba, rgba

ROOT = os.path.join(os.path.dirname(__file__), '..')
SPR = os.path.join(ROOT, 'assets', 'sprites', 'rigs')
RIGS = os.path.join(ROOT, 'assets', 'rigs')
FX = os.path.join(ROOT, 'assets', 'sprites', 'fx')
SS = 2  # supersampling factor


def mkdir(p):
    os.makedirs(p, exist_ok=True)


# ----------------------------------------------------------------- canvas ----

class Part:
    """A part canvas at SS resolution. Coordinates given in 1x pixels relative to the pivot."""

    def __init__(self, name, w, h, pivot, light=(-0.5, -0.85)):
        self.name = name
        self.w, self.h = w, h
        self.pivot = pivot  # (px, py) in 1x pixels from top-left
        self.img = new_rgba(w * SS, h * SS)
        self.d = ImageDraw.Draw(self.img)
        self.light = light
        self.layers = []  # extra overlays composited after shading (eyes, glows)

    def P(self, x, y):
        return ((self.pivot[0] + x) * SS, (self.pivot[1] + y) * SS)

    def poly(self, pts, fill):
        self.d.polygon([self.P(*p) for p in pts], fill=fill + (255,))

    def ellipse(self, cx, cy, rx, ry, fill):
        x, y = self.P(cx, cy)
        self.d.ellipse([x - rx * SS, y - ry * SS, x + rx * SS, y + ry * SS], fill=fill + (255,))

    def limb(self, p0, p1, w0, w1, fill):
        draw_tapered_line(self.d, self.P(*p0), self.P(*p1), w0 * SS, w1 * SS, fill + (255,))

    def line(self, pts, fill, width=1):
        self.d.line([self.P(*p) for p in pts], fill=fill + (255,), width=max(1, int(width * SS)))

    def overlay(self, fn):
        self.layers.append(fn)

    def finish(self, outline=(12, 8, 10), outline_w=1.4, texture=0.0, tex_seed=0, shade=0.5, rim=0.35,
               rim_color=(110, 140, 190), ambient=0.6, glow=None):
        img = self.img
        # shading from alpha-derived height field
        a = np.array(img.getchannel('A'), float) / 255.0
        blur_r = max(2, int(min(img.size) * 0.07))
        hgt = np.array(img.getchannel('A').filter(ImageFilter.GaussianBlur(blur_r)), float) / 255.0
        gy, gx = np.gradient(hgt)
        lx, ly = self.light
        L = math.hypot(lx, ly)
        lx, ly = lx / L, ly / L
        ndotl = gx * lx + gy * ly
        ndotl = ndotl / (np.abs(ndotl).max() + 1e-6)
        lit = ambient + shade * np.clip(ndotl * 2.2 + 0.55, 0, 1.4)
        # centre highlight (cylindrical feel)
        lit += 0.18 * np.clip(hgt - 0.5, 0, 1) * 2
        arr = np.array(img).astype(float)
        arr[..., :3] *= np.clip(lit, 0.25, 1.45)[..., None]
        rimmask = np.clip(-ndotl, 0, 1) * np.clip(1 - hgt * 1.3, 0, 1) * a
        arr[..., :3] += np.array(rim_color, float)[None, None, :] * (rimmask * rim)[..., None]
        if texture > 0:
            n = fbm_2d(img.size[0], img.size[1], 6, 6, octaves=4, persistence=0.6, seed=tex_seed, wrap_x=False)
            arr[..., :3] *= (1 + (n[..., None] - 0.5) * 2 * texture)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
        # overlays (unshaded details like eyes)
        for fn in self.layers:
            fn(ImageDraw.Draw(img), self)
        # outline: dilate alpha and put dark colour under
        if outline is not None and outline_w > 0:
            k = int(outline_w * SS)
            alpha = img.getchannel('A')
            dil = alpha.filter(ImageFilter.MaxFilter(2 * k + 1))
            under = Image.new('RGBA', img.size, outline + (0,))
            under.putalpha(dil)
            under.alpha_composite(img)
            img = under
        if glow is not None:
            col, radius, strength = glow
            ga = img.getchannel('A').filter(ImageFilter.GaussianBlur(radius * SS))
            g = Image.new('RGBA', img.size, col + (0,))
            g.putalpha(Image.fromarray((np.array(ga) * strength).astype(np.uint8)))
            g.alpha_composite(img)
            img = g
        out = img.resize((self.w, self.h), Image.LANCZOS)
        return out


# ---------------------------------------------------------------- styles ----

BEAST = dict(
    fur=(74, 66, 58), fur_dark=(44, 38, 34), belly=(118, 104, 86), claw=(214, 204, 180), horn=(196, 180, 150),
    eye=(255, 170, 40), mouth=(28, 10, 12), teeth=(230, 222, 200), outline=(14, 10, 12),
)
KNIGHT = dict(
    steel=(132, 138, 150), steel_dark=(78, 82, 94), trim=(170, 140, 70), cloth=(96, 24, 28), cloth_dark=(58, 14, 18),
    leather=(70, 48, 34), skin=(150, 120, 100), outline=(10, 8, 12), eye=(255, 90, 40),
)
SPEARMAN = dict(
    steel=(110, 112, 118), steel_dark=(66, 68, 76), trim=(140, 120, 80), cloth=(40, 50, 72), cloth_dark=(24, 30, 46),
    leather=(84, 58, 38), skin=(150, 120, 100), outline=(10, 8, 12), eye=(220, 200, 160),
)
SKELETON = dict(
    bone=(206, 196, 170), bone_dark=(140, 128, 104), rag=(60, 54, 44), rust=(104, 62, 36), eye=(120, 240, 170),
    outline=(16, 12, 10),
)
WARDEN = dict(
    steel=(70, 66, 80), steel_dark=(36, 32, 44), trim=(190, 120, 50), cloth=(50, 10, 16), cloth_dark=(28, 6, 10),
    leather=(40, 30, 26), skin=(90, 80, 80), outline=(6, 4, 8), eye=(255, 60, 30),
)


def save_part(part, outdir, **kw):
    img = part.finish(**kw)
    path = os.path.join(outdir, part.name + '.png')
    img.save(path)
    return img


# ---------------------------------------------------------------- beast ----

def beast_parts(outdir):
    S = BEAST
    parts = {}
    o = dict(outline=S['outline'], texture=0.12, rim=0.4)

    # torso: pivot at hip (bottom centre). Hunched forward (toward +x).
    p = Part('beast_torso', 64, 76, (28, 70))
    p.poly([(-13, 2), (-16, -22), (-12, -48), (-2, -64), (16, -66), (26, -56), (24, -34), (18, -10), (12, 2)], S['fur'])
    p.ellipse(10, -32, 11, 20, S['belly'])
    # fur spikes along the back
    for i, (x, y) in enumerate([(-15, -14), (-15, -28), (-12, -42), (-7, -54)]):
        p.poly([(x + 2, y + 6), (x - 9 - i, y - 2), (x + 3, y - 6)], S['fur_dark'])
    parts['torso'] = save_part(p, outdir, tex_seed=1, **o)

    # head: pivot at neck (bottom-back). Snout toward +x, horns back.
    p = Part('beast_head', 70, 58, (22, 50))
    p.poly([(-10, 0), (-14, -14), (-8, -28), (4, -34), (16, -30), (30, -22), (42, -14), (40, -8), (26, -6), (16, 0), (4, 2)], S['fur'])
    # jaw
    p.poly([(4, 0), (16, -2), (36, -8), (34, 0), (18, 6), (6, 6)], S['fur_dark'])
    # horns
    p.poly([(-4, -30), (-16, -44), (-30, -48), (-16, -38), (-6, -24)], S['horn'])
    p.poly([(6, -32), (-2, -46), (-10, -56), (2, -44), (12, -30)], S['horn'])
    # ear
    p.poly([(-8, -22), (-18, -30), (-10, -14)], S['fur_dark'])

    def eyes(d, part):
        x, y = part.P(22, -20)
        d.ellipse([x - 4 * SS, y - 2.5 * SS, x + 4 * SS, y + 2.5 * SS], fill=S['eye'] + (255,))
        d.ellipse([x - 1.5 * SS, y - 1.5 * SS, x + 1.5 * SS, y + 1.5 * SS], fill=(40, 10, 0, 255))
        # teeth
        for tx in (22, 28, 33):
            px, py = part.P(tx, -6)
            d.polygon([(px - 1.5 * SS, py), (px + 1.5 * SS, py), (px, py + 4 * SS)], fill=S['teeth'] + (255,))
    p.overlay(eyes)
    parts['head'] = save_part(p, outdir, tex_seed=2, **o)

    # upper arm (hangs down from shoulder)
    p = Part('beast_arm_u', 26, 44, (13, 6))
    p.limb((0, 0), (0, 32), 17, 12, S['fur'])
    p.ellipse(0, 2, 9, 8, S['fur'])
    parts['arm_u'] = save_part(p, outdir, tex_seed=3, **o)

    # forearm with clawed hand
    p = Part('beast_arm_l', 34, 58, (14, 6))
    p.limb((0, 0), (1, 32), 12, 9, S['fur'])
    p.ellipse(3, 36, 7, 6, S['fur_dark'])  # hand
    for i, (x, y) in enumerate([(-4, 40), (2, 42), (8, 40)]):
        p.poly([(x - 2, y - 2), (x + 2, y - 2), (x + (i - 1) * 2, y + 12)], S['claw'])
    parts['arm_l'] = save_part(p, outdir, tex_seed=4, **o)

    # thigh
    p = Part('beast_leg_u', 30, 46, (15, 6))
    p.limb((0, 0), (0, 34), 20, 13, S['fur'])
    p.ellipse(0, 2, 11, 9, S['fur'])
    parts['leg_u'] = save_part(p, outdir, tex_seed=5, **o)

    # shin + paw (digitigrade)
    p = Part('beast_leg_l', 36, 56, (12, 6))
    p.limb((0, 0), (-2, 26), 13, 9, S['fur'])
    p.limb((-2, 26), (8, 40), 9, 8, S['fur'])
    p.ellipse(10, 42, 9, 5, S['fur_dark'])  # paw
    for x in (4, 11, 18):
        p.poly([(x - 2, 42), (x + 2, 42), (x + 1, 48)], S['claw'])
    parts['leg_l'] = save_part(p, outdir, tex_seed=6, **o)

    # tail segments (hang from pivot; angled by animation)
    p = Part('beast_tail1', 20, 40, (10, 4))
    p.limb((0, 0), (0, 32), 10, 6, S['fur'])
    parts['tail1'] = save_part(p, outdir, tex_seed=7, **o)
    p = Part('beast_tail2', 20, 44, (10, 4))
    p.limb((0, 0), (0, 28), 6, 3, S['fur'])
    p.poly([(-5, 24), (0, 40), (5, 24)], S['fur_dark'])
    parts['tail2'] = save_part(p, outdir, tex_seed=8, **o)

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
    p.finish(outline=(8, 6, 10), texture=0.08, rim=0.5).save(os.path.join(out, 'gate.png'))
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
    p.finish(outline=(10, 8, 8), texture=0.15).save(os.path.join(out, 'fence.png'))


# ---------------------------------------------------------------- preview ----

def pose_preview(rig, outdir, path, scale=2):
    """Assemble the rig in a neutral pose (all angles 0) using the same maths as Rig.js."""
    parts = {p['name']: p for p in rig['parts']}
    imgs = {p['name']: Image.open(os.path.join(outdir, p['tex'] + '.png')).convert('RGBA') for p in rig['parts']}
    W, H = 320, 320
    canvas = new_rgba(W, H, (40, 40, 60, 255))
    origin = (W // 2, H - 110)

    def world(pname):
        p = parts[pname]
        if p['parent'] is None:
            return origin[0] + p['at'][0], origin[1] + p['at'][1]
        px, py = world(p['parent'])
        return px + p['at'][0], py + p['at'][1]
    for p in sorted(rig['parts'], key=lambda q: q['z']):
        x, y = world(p['name'])
        im = imgs[p['name']]
        canvas.alpha_composite(im, (int(x - p['pivot'][0]), int(y - p['pivot'][1])))
    canvas = canvas.resize((W * scale, H * scale), Image.NEAREST)
    canvas.save(path)


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
        manifest[rig['name']] = sorted({p['tex'] for p in rig['parts']})
        if preview:
            pose_preview(rig, SPR, os.path.join(preview, f"rig_{rig['name']}.png"))
    json.dump(manifest, open(os.path.join(RIGS, 'manifest.json'), 'w'), indent=1)
    fx_sprites()
    world_props()
    print('rigs:', ', '.join(manifest))


if __name__ == '__main__':
    main()
