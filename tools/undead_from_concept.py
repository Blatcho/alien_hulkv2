"""Build the undead knight's rig parts from the painted skeleton concept sheet.

Usage: python3 tools/undead_from_concept.py [--src SHEET.webp] [--preview DIR] [--debug DIR]

Takes the SIDE figure of the top row (the armoured skeleton walking right with its sword low), mattes
it off the grey gradient background, cuts it into rig parts with hand-placed polygons, fills the parts
of a limb hidden behind another part (so nothing is missing when limbs rotate), rotates each limb so
its bone axis is vertical (0 deg = hanging straight down, the convention in src/rig/Rig.js), writes the
colour textures plus normal maps to assets/sprites/rigs/undead_*.png and the measured rig geometry to
assets/rigs/undead.json. The shield comes from the MARCH pose of the bottom row (scaled up to match).

Coordinates below are pixels of the source sheet (1024x572). The figure faces +x already.

The rig JSON gets `"source": "concept"` (tools/gen_sprites.py leaves such rigs alone) and
`"scale": 0.5`: the painting is cut at native resolution (~270 px tall) and drawn at half size, which
puts the knight at the same height as the beast. Every humanoid enemy (src/data/enemies.js) uses this
rig with its own tint, scale and loadout.
"""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from beast_from_concept import (poly_mask, morph, fill_hidden, rotate_part, crop_alpha, normal_map,  # noqa: E402
                                mkdir, pose_world, render_pose)

ROOT = os.path.join(os.path.dirname(__file__), '..')
SPR = os.path.join(ROOT, 'assets', 'sprites', 'rigs')
RIGS = os.path.join(ROOT, 'assets', 'rigs')
DEFAULT_SRC = '/tmp/claude-0/-home-user-dungeoncrawler/95a99ce9-8514-51b0-b78b-e1b4eab6151c/images/4.webp'

# ------------------------------------------------------------------ figure ----
FIG_BOX = (580, 36, 778, 332)
BG_COLS = [(560, 582), (776, 800)]
MATTE_THRESHOLD = 14.0
MAX_POCKET = 30
# loose envelope: keeps the neighbouring figures' blades and the ruled lines out
FIGURE_ENVELOPE = [(586, 300), (596, 212), (604, 130), (640, 86), (660, 42), (716, 40), (716, 96),
                   (700, 130), (704, 190), (770, 248), (770, 266), (724, 300), (726, 326), (580, 328)]

# Shield (MARCH pose, bottom row). It is painted at the smaller bottom-row scale, so it is enlarged.
SHIELD_BOX = (300, 380, 400, 500)
SHIELD_BG_COLS = [(300, 304), (390, 400)]
SHIELD_POLY = [(325, 420), (353, 421), (366, 432), (370, 445), (364, 462), (352, 474), (344, 480),
               (336, 474), (326, 462), (322, 448), (323, 432)]
SHIELD_SCALE = 1.75
SHIELD_GRIP = (334, 452)

# Joints measured on the painting (sheet pixels, figure facing right).
J = dict(
    neck=(686, 106),
    shoulder=(656, 112),
    elbow=(634, 160),
    wrist=(647, 195),
    hand=(654, 206),
    grip=(653, 205),
    tip=(760, 262),
    hip=(662, 216),
    knee=(620, 256),         # rear leg (the thigh texture)
    ankle=(604, 301),
    kneeF=(700, 246),        # front leg (the shin + foot texture)
    ankleF=(700, 302),
    toeF=(722, 318),
)

PARTS = {
    'undead_head': dict(
        poly=[(662, 100), (660, 86), (664, 66), (672, 52), (684, 44), (698, 44), (710, 52), (716, 66),
              (716, 86), (712, 100), (706, 108), (698, 112), (688, 114), (676, 112), (668, 108)],
        pivot='neck', axis=None,
    ),
    'undead_torso': dict(
        poly=[(676, 104), (692, 100), (700, 112), (700, 130), (698, 150), (696, 170), (700, 190), (704, 206),
              (704, 226), (702, 244), (698, 256), (684, 258), (668, 254), (654, 256), (646, 250), (646, 232),
              (648, 212), (646, 190), (648, 170), (646, 150), (640, 130), (638, 110), (644, 94), (656, 88),
              (670, 90)],
        pivot='hip', axis=None,
        holes=['arm_u_hole', 'arm_l_hole'],
        clones=[('arm_u_hole', (36, 0), 0.5), ('arm_l_hole', (40, -4), 0.4)],
    ),
    'undead_arm_u': dict(
        poly=[(644, 100), (660, 98), (670, 108), (668, 126), (660, 140), (650, 154), (642, 168), (632, 174),
              (624, 168), (622, 156), (628, 140), (634, 126), (638, 112)],
        pivot='shoulder', axis='elbow',
        holes=['shoulder_hole'], clones=[('shoulder_hole', (-6, 30), 1.0)],
    ),
    'undead_arm_l': dict(
        poly=[(624, 158), (634, 150), (644, 156), (650, 168), (654, 182), (660, 192), (664, 202), (662, 212),
              (654, 216), (644, 214), (638, 206), (634, 192), (628, 178), (622, 168)],
        pivot='elbow', axis='hand',
    ),
    'undead_weapon': dict(
        poly=[(648, 196), (660, 193), (670, 201), (700, 219), (730, 236), (758, 252), (766, 262), (760, 269),
              (730, 257), (700, 242), (668, 228), (652, 217), (645, 208)],
        pivot='grip', axis='tip', flip_axis=True,
    ),
    'undead_pauldron': dict(
        poly=[(637, 100), (646, 92), (660, 90), (672, 98), (676, 110), (672, 124), (662, 134), (648, 136), (638, 128),
              (634, 114)],
        pivot='shoulder', axis=None,
    ),
    'undead_leg_u': dict(
        poly=[(642, 210), (664, 210), (672, 222), (662, 240), (646, 256), (632, 266), (618, 270), (608, 262),
              (610, 248), (620, 236), (632, 222)],
        pivot='hip', axis='knee',
        holes=['thigh_hole'], clones=[('thigh_hole', (-18, 28), 0.9)],
    ),
    'undead_leg_l': dict(
        poly=[(684, 238), (698, 232), (712, 240), (712, 262), (708, 284), (710, 298), (722, 310), (728, 320),
              (720, 326), (700, 324), (686, 320), (682, 304), (682, 280), (682, 256)],
        pivot='kneeF', axis='ankleF',
    ),
}

HOLES = {
    'arm_u_hole': [(626, 128), (646, 128), (660, 134), (650, 154), (642, 168), (632, 174), (624, 168), (622, 156)],
    'arm_l_hole': PARTS['undead_arm_l']['poly'],
    # the pauldron (torso) covers the top of the upper arm
    'shoulder_hole': [(638, 96), (662, 94), (672, 104), (670, 124), (660, 134), (646, 134), (638, 122)],
    # the tabard covers the top of the thigh
    'thigh_hole': [(640, 208), (668, 208), (674, 222), (664, 238), (650, 248), (640, 244), (636, 228)],
}

NEAR_LEG_OFFSET = (4, 0)
FAR_LEG_OFFSET = (-6, 2)
FAR_ARM_OFFSET = (-6, 4)
REST = dict()
# draw order: the tabard hangs over the near thigh, the arm swings under the pauldron, the shield sits in
# front of the chest
Z = dict(torso=10, head=12, arm_u_far=4, arm_l_far=5, shield=11, arm_u_near=20, arm_l_near=21, weapon=22, pauldron=23,
         leg_u_far=2, leg_l_far=3, leg_u_near=8, leg_l_near=9)

# Pose keys (copied from undeadClips in src/rig/clips/humanoid.js) used by the preview.
POSES = [
    ('neutral', {}),
    ('idle', dict(torso=12, head=10, arm_u_near=14, arm_l_near=-24, arm_u_far=18, arm_l_far=-16, weapon=130,
                  leg_u_near=-18, leg_l_near=14, leg_u_far=16, leg_l_far=6, rootY=4)),
    ('march', dict(torso=10, head=6, arm_u_near=18, arm_l_near=-30, arm_u_far=-30, arm_l_far=-100, shield=90, weapon=120,
                   leg_u_near=-28, leg_l_near=12, leg_u_far=24, leg_l_far=40, rootY=2)),
    ('windup', dict(torso=-12, head=8, arm_u_near=150, arm_l_near=-60, arm_u_far=130, arm_l_far=-60, weapon=-20,
                    leg_u_near=-14, leg_l_near=10, leg_u_far=24, leg_l_far=20, rootY=-2)),
    ('attack', dict(torso=26, head=-6, arm_u_near=-90, arm_l_near=-20, arm_u_far=30, arm_l_far=-40, weapon=90,
                    leg_u_near=-44, leg_l_near=36, leg_u_far=26, leg_l_far=50, rootX=10, rootY=6)),
    ('impact', dict(torso=-24, head=-18, arm_u_near=-70, arm_l_near=-50, arm_u_far=-110, arm_l_far=-40, weapon=130,
                    leg_u_near=-20, leg_l_near=20, leg_u_far=16, leg_l_far=10, rootY=4)),
    ('collapse', dict(torso=46, head=40, arm_u_near=-50, arm_l_near=-10, arm_u_far=-40, arm_l_far=-10, weapon=150,
                      leg_u_near=-96, leg_l_near=120, leg_u_far=-80, leg_l_far=110, rootY=64)),
]
IDLE = POSES[1][1]


def estimate_background(rgb, bg_cols):
    H, W = rgb.shape[:2]
    cols = []
    for (x0, x1) in bg_cols:
        cols.append((0.5 * (x0 + x1), np.median(rgb[:, x0:x1], axis=1)))
    (xa, ca), (xb, cb) = cols
    t = np.clip((np.arange(W) - xa) / (xb - xa), 0, 1)
    return ca[:, None, :] * (1 - t)[None, :, None] + cb[:, None, :] * t[None, :, None]


def matte(rgb, fig_box, bg_cols, envelope, threshold=MATTE_THRESHOLD, max_pocket=MAX_POCKET):
    """Figure alpha (float 0..1) from the colour distance to the gradient background."""
    H, W = rgb.shape[:2]
    bg = estimate_background(rgb, bg_cols)
    d = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    m = d > threshold
    m &= poly_mask(envelope, W, H) > 0.5
    m = morph(morph(m, 1, 'dilate'), 1, 'erode')
    m = morph(morph(m, 1, 'erode'), 1, 'dilate')
    bx0, by0, bx1, by1 = fig_box
    sub = m[by0:by1, bx0:bx1]
    bgm = ~sub
    reach = np.zeros_like(bgm)
    reach[0, :] = bgm[0, :]; reach[-1, :] = bgm[-1, :]; reach[:, 0] = bgm[:, 0]; reach[:, -1] = bgm[:, -1]
    while True:
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]; grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]; grown[:, :-1] |= reach[:, 1:]
        grown &= bgm
        if (grown == reach).all():
            break
        reach = grown
    pockets = bgm & ~reach
    keep = np.zeros_like(pockets)
    seen = np.zeros_like(pockets)
    ph, pw = pockets.shape
    for (y, x) in zip(*np.nonzero(pockets)):
        if seen[y, x]:
            continue
        comp, stack = [], [(y, x)]
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            comp.append((cy, cx))
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < ph and 0 <= nx < pw and pockets[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(comp) <= max_pocket:
            for cy, cx in comp:
                keep[cy, cx] = True
    m[by0:by1, bx0:bx1] = sub | keep
    a = np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float64) / 255
    return a, m, d


def cut_part(rgb, alpha, spec, joints, box, name):
    """Cut one part: mask, hidden-area fill, rotate so the axis hangs straight down, crop."""
    H, W = rgb.shape[:2]
    pm = poly_mask(spec['poly'], W, H)
    a = pm * alpha
    known = a > 0.5
    hole = np.zeros((H, W), bool)
    for hn in spec.get('holes', []):
        hole |= poly_mask(HOLES[hn], W, H) > 0.5
    hole &= pm > 0.5
    prgb = rgb
    if hole.any():
        clones = [(HOLES[hn], off, wt) for hn, off, wt in spec.get('clones', [])]
        prgb, a = fill_hidden(rgb, a, known | hole, hole, clones, W, H)
        soft = np.array(Image.fromarray((np.maximum(a, hole) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float64) / 255
        a = np.minimum(a, soft)
    rgba = np.dstack([prgb, a * 255])
    bx0, by0, bx1, by1 = box
    rgba = rgba[by0:by1, bx0:bx1]
    jj = {k: (v[0] - bx0, v[1] - by0) for k, v in joints.items()}
    pivot = jj[spec['pivot']]
    theta = 0.0
    if spec.get('axis'):
        ax, ay = jj[spec['axis']]
        theta = math.degrees(math.atan2(ax - pivot[0], ay - pivot[1]))
        if spec.get('flip_axis'):
            theta += 180.0          # the blade points UP in the texture (weapon convention)
        rgba, pivot, jj = rotate_part(rgba, pivot, theta, jj)
    rgba, pivot, jj = crop_alpha(rgba, pivot, jj)
    return rgba, (int(round(pivot[0])), int(round(pivot[1]))), jj, theta


def build(src, out_spr, out_rig, debug=None):
    sheet = Image.open(src).convert('RGB')
    rgb = np.array(sheet, np.float64)
    alpha, hard, dist = matte(rgb, FIG_BOX, BG_COLS, FIGURE_ENVELOPE)
    if debug:
        mkdir(debug)
        mt = Image.new('RGBA', sheet.size, (255, 0, 255, 255))
        mt.alpha_composite(Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA'))
        mt = mt.crop(FIG_BOX)
        mt.resize((mt.width * 2, mt.height * 2), Image.NEAREST).save(os.path.join(debug, 'matte.png'))
        ov = sheet.copy()
        d = ImageDraw.Draw(ov, 'RGBA')
        cols = [(255, 80, 80), (80, 255, 80), (80, 160, 255), (255, 255, 80), (255, 80, 255), (80, 255, 255), (255, 160, 60), (200, 200, 200)]
        for i, (name, spec) in enumerate(PARTS.items()):
            col = cols[i % len(cols)]
            d.polygon(spec['poly'], outline=col + (255,), fill=col + (40,))
            px, py = J[spec['pivot']]
            d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=col + (255,))
        for hn, hp in HOLES.items():
            d.polygon(hp, outline=(255, 255, 255, 160))
        d.polygon(FIGURE_ENVELOPE, outline=(255, 255, 255, 90))
        for k, (x, y) in J.items():
            d.ellipse([x - 2, y - 2, x + 2, y + 2], outline=(255, 255, 255, 255))
        ov = ov.crop(FIG_BOX)
        ov.resize((ov.width * 3, ov.height * 3), Image.LANCZOS).save(os.path.join(debug, 'polys.png'))
        sv = sheet.copy()
        ImageDraw.Draw(sv, 'RGBA').polygon(SHIELD_POLY, outline=(80, 255, 80, 255))
        sv = sv.crop(SHIELD_BOX)
        sv.resize((sv.width * 4, sv.height * 4), Image.LANCZOS).save(os.path.join(debug, 'shield_poly.png'))

    mkdir(out_spr)
    parts = {}
    for name, spec in PARTS.items():
        rgba, pivot, jj, theta = cut_part(rgb, alpha, spec, J, FIG_BOX, name)
        img = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA')
        nm = normal_map(rgba, round_r=10.0 if name in ('undead_torso', 'undead_head') else 6.0, detail=1.4)
        img.save(os.path.join(out_spr, name + '.png'))
        nm.save(os.path.join(out_spr, name + '_n.png'))
        parts[name] = dict(img=img, nmap=nm, pivot=pivot, joints=jj, theta=theta)
        print(f'{name:14s} {img.width:4d}x{img.height:<4d} pivot={pivot} painted-angle={theta:6.1f} deg')

    # shield: matte the march pose locally, cut, enlarge to the top-row scale
    s_alpha, _, _ = matte(rgb, SHIELD_BOX, SHIELD_BG_COLS, SHIELD_POLY, threshold=12.0, max_pocket=40)
    sp = dict(poly=SHIELD_POLY, pivot='grip', axis=None)
    srgba, spv, sj, _ = cut_part(rgb, s_alpha, sp, dict(grip=SHIELD_GRIP), SHIELD_BOX, 'undead_shield')
    simg = Image.fromarray(np.clip(srgba, 0, 255).astype(np.uint8), 'RGBA')
    sw, sh = int(round(simg.width * SHIELD_SCALE)), int(round(simg.height * SHIELD_SCALE))
    simg = simg.resize((sw, sh), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    spv = (int(round(spv[0] * SHIELD_SCALE)), int(round(spv[1] * SHIELD_SCALE)))
    snm = normal_map(np.array(simg, np.float64), round_r=10.0, detail=1.2)
    simg.save(os.path.join(out_spr, 'undead_shield.png'))
    snm.save(os.path.join(out_spr, 'undead_shield_n.png'))
    parts['undead_shield'] = dict(img=simg, nmap=snm, pivot=spv, joints={}, theta=0)
    print(f'undead_shield  {simg.width:4d}x{simg.height:<4d} pivot={spv}')

    rig = make_rig(parts)
    mkdir(out_rig)
    json.dump(rig, open(os.path.join(out_rig, 'undead.json'), 'w'), indent=1)
    return rig, parts


def make_rig(parts):
    def jp(part, joint):
        p = parts[part]
        x, y = p['joints'][joint]
        return (x - p['pivot'][0], y - p['pivot'][1])

    def dist(part, a, b):
        pa, pb = parts[part]['joints'][a], parts[part]['joints'][b]
        return math.hypot(pb[0] - pa[0], pb[1] - pa[1])

    r = lambda v: int(round(v))
    neck = jp('undead_torso', 'neck')
    sh = jp('undead_torso', 'shoulder')
    len_au = dist('undead_arm_u', 'shoulder', 'elbow')
    len_al = dist('undead_arm_l', 'elbow', 'hand')
    len_lu = dist('undead_leg_u', 'hip', 'knee')
    len_ll = dist('undead_leg_l', 'kneeF', 'ankleF')
    P = []

    def add(name, tex, parent, at, length=0):
        d = dict(name=name, tex=tex, parent=parent, at=[r(at[0]), r(at[1])],
                 pivot=list(parts[tex]['pivot']), z=Z[name], len=r(length))
        if REST.get(name):
            d['rest'] = REST[name]
        P.append(d)
    add('torso', 'undead_torso', None, (0, 0))
    add('head', 'undead_head', 'torso', neck)
    add('pauldron', 'undead_pauldron', 'torso', sh)
    add('arm_u_far', 'undead_arm_u', 'torso', (sh[0] + FAR_ARM_OFFSET[0], sh[1] + FAR_ARM_OFFSET[1]), len_au)
    add('arm_l_far', 'undead_arm_l', 'arm_u_far', (0, len_au), len_al)
    add('shield', 'undead_shield', 'arm_l_far', (0, len_al * 0.55))
    add('arm_u_near', 'undead_arm_u', 'torso', sh, len_au)
    add('arm_l_near', 'undead_arm_l', 'arm_u_near', (0, len_au), len_al)
    add('weapon', 'undead_weapon', 'arm_l_near', (0, len_al))
    add('leg_u_far', 'undead_leg_u', None, FAR_LEG_OFFSET, len_lu)
    add('leg_l_far', 'undead_leg_l', 'leg_u_far', (0, len_lu), len_ll)
    add('leg_u_near', 'undead_leg_u', None, NEAR_LEG_OFFSET, len_lu)
    add('leg_l_near', 'undead_leg_l', 'leg_u_near', (0, len_lu), len_ll)
    rig = dict(name='undead', source='concept', scale=0.5, height=0, hunch=0, parts=P, reach=0, leg_len=0)
    top, bottom = pose_extent(rig, parts, IDLE)
    rig['height'] = r(bottom - top)
    rig['leg_len'] = r(bottom / 0.88)
    return rig


def pose_extent(rig, parts, pose):
    """(top, bottom) of the body (sword and shield excluded) relative to the root, in rig pixels."""
    body = dict(rig, parts=[p for p in rig['parts'] if p['name'] not in ('weapon', 'shield')])
    img, origin = render_pose(body, parts, pose)
    ys = np.nonzero(np.array(img)[..., 3] > 64)[0]
    return ys.min() - origin[1], ys.max() - origin[1]


def preview(rig, parts, out):
    """Contact sheet of the sheet-inspired poses, drawn with the same transform as Rig.apply."""
    cell = 400
    per_row = 4
    rows = (len(POSES) + per_row - 1) // per_row
    sheet = Image.new('RGBA', (cell * per_row, (cell + 30) * rows), (40, 40, 48, 255))
    d = ImageDraw.Draw(sheet)
    far_tint = (154, 154, 176)
    for i, (label, pose) in enumerate(POSES):
        world = pose_world(rig, pose)
        cx, cy = (i % per_row) * cell, (i // per_row) * (cell + 30)
        ox, oy = cx + cell // 2, cy + cell - 120
        for p in sorted(rig['parts'], key=lambda q: q['z']):
            if p['name'] == 'shield' and 'shield' not in pose:
                continue
            wx, wy, wr = world[p['name']]
            img = parts[p['tex']]['img']
            if p['name'].endswith('_far') or p['name'] == 'shield':
                arr = np.array(img, np.float64)
                arr[..., :3] *= np.array(far_tint) / 255.0
                img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
            px, py = p['pivot']
            rot = img.rotate(-math.degrees(wr), resample=Image.BICUBIC, expand=True, center=(px, py))
            # pivot position inside the rotated image
            c, s = math.cos(wr), math.sin(wr)
            corners = [(0, 0), (img.width, 0), (0, img.height), (img.width, img.height)]
            xs = [px + (u - px) * c - (v - py) * s for u, v in corners]
            ys = [py + (u - px) * s + (v - py) * c for u, v in corners]
            npx, npy = px - min(xs), py - min(ys)
            sheet.alpha_composite(rot, (int(round(ox + wx - npx)), int(round(oy + wy - npy))))
        d.text((cx + 8, cy + cell + 8), label, fill=(230, 220, 200, 255))
        d.line([(cx, oy + rig['leg_len'] * 0.88), (cx + cell, oy + rig['leg_len'] * 0.88)], fill=(90, 90, 100, 255))
    sheet.save(out)


if __name__ == '__main__':
    src = DEFAULT_SRC
    if '--src' in sys.argv:
        src = sys.argv[sys.argv.index('--src') + 1]
    debug = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None
    rig, parts = build(src, SPR, RIGS, debug=debug)
    if '--preview' in sys.argv:
        pdir = sys.argv[sys.argv.index('--preview') + 1]
        mkdir(pdir)
        preview(rig, parts, os.path.join(pdir, 'undead_poses.png'))
    print('height', rig['height'], 'leg_len', rig['leg_len'])
