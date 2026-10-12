"""Build the beast's rig parts from the painted concept sheet.

Usage: python3 tools/beast_from_concept.py [--src SHEET.webp] [--preview DIR] [--debug DIR] [--flip]

Takes the third figure of the top row (side view of the armoured, horned werewolf), mattes it off
the grey gradient background, cuts it into rig parts with hand-placed polygons, fills the areas of a
part that are hidden by another part in the painting (so nothing is missing when limbs rotate),
rotates each limb so its bone axis is vertical (0 deg = hanging straight down, the convention in
src/rig/Rig.js and tools/gen_sprites.py), writes the colour textures plus normal maps to
assets/sprites/rigs/beast_*.png and the measured rig geometry to assets/rigs/beast.json.

Coordinates in POLY/JOINTS below are pixels of the source sheet (1024x572). The figure in the sheet
already faces +x (muzzle on the right, tail trailing left), so no flip is needed; `--flip` mirrors the
figure (and every coordinate) in case a mirrored sheet is used.

The rig JSON gets `"source": "concept"` which makes tools/gen_sprites.py leave the beast alone, and
`"scale": 0.5` because the painting is cut at native resolution (~310 px tall) and the game draws the
beast at half size.
"""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from artlib import chamfer_dt, gauss_f, height_to_normals, encode_normal_map  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
SPR = os.path.join(ROOT, 'assets', 'sprites', 'rigs')
RIGS = os.path.join(ROOT, 'assets', 'rigs')
DEFAULT_SRC = '/tmp/claude-0/-home-user-dungeoncrawler/95a99ce9-8514-51b0-b78b-e1b4eab6151c/images/3.webp'

# ------------------------------------------------------------------ figure ----
# Region of the sheet that holds the figure, and columns either side of it that only hold background
# (used to estimate the gradient per row).
FIG_BOX = (505, 30, 790, 352)
BG_COLS = [(505, 522), (778, 790)]
MATTE_THRESHOLD = 13.0
MAX_POCKET = 24             # enclosed background pockets up to this many px are treated as figure      # colour distance (0..255) to the estimated background that counts as figure

# Loose envelope of the figure (keeps bits of the neighbouring figures and the ruled lines out).
FIGURE_ENVELOPE = [(512, 222), (512, 262), (556, 272), (556, 352), (762, 352), (770, 120), (762, 40),
                   (640, 36), (610, 100), (588, 205), (596, 230)]


def ribbon(center, widths):
    """Polygon around a polyline with per-vertex half-widths."""
    n = len(center)
    left, right = [], []
    for i, (x, y) in enumerate(center):
        x0, y0 = center[max(0, i - 1)]
        x1, y1 = center[min(n - 1, i + 1)]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        w = widths[i]
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    return left + right[::-1]


# Joints measured on the painting (sheet pixels, figure facing right).
J = dict(
    neck=(706, 114),
    hip=(672, 212),
    shoulder=(672, 114),
    elbow=(637, 158),
    wrist=(666, 200),
    knuckle=(674, 224),
    claw=(684, 243),
    knee=(713, 250),
    ankle=(700, 302),
    toe=(746, 338),
    tail0=(642, 231),
    tail1=(582, 250),
    tail2=(521, 231),
)

TAIL_CENTER1 = [(644, 230), (625, 237), (605, 244), (582, 250)]
TAIL_CENTER2 = [(582, 250), (560, 254), (541, 247), (528, 238), (521, 230)]

# Hand-placed part polygons (sheet pixels). Holes are regions of the part hidden by another part in
# the painting that get filled in; clones are (hole polygon, (dx, dy)) sources copied first.
PARTS = {
    'beast_head': dict(
        poly=[(650, 100), (640, 90), (646, 80), (656, 68), (668, 58), (674, 44), (682, 42), (690, 54),
              (700, 44), (708, 42), (716, 56), (730, 60), (742, 70), (754, 80), (764, 94), (764, 110),
              (756, 124), (744, 132), (726, 134), (712, 132), (704, 126), (700, 116), (704, 100),
              (696, 82), (680, 78), (664, 84), (656, 94)],
        pivot='neck', axis=None,
    ),
    'beast_torso': dict(
        poly=[(698, 100), (712, 106), (724, 118), (722, 132), (712, 148), (704, 164), (698, 184),
              (700, 200), (708, 212), (704, 226), (698, 240), (688, 248), (676, 252), (666, 258),
              (660, 270), (652, 264), (642, 256), (628, 252), (612, 258), (600, 258), (596, 242), (598, 220),
              (604, 204), (602, 190), (600, 172), (602, 150), (606, 128), (614, 110), (630, 98),
              (648, 94), (660, 84), (680, 76), (696, 80)],
        pivot='hip', axis=None,
        holes=['arm_u_hole', 'arm_l_hole'],
        clones=[('arm_u_hole', (-40, 6), 0.6), ('arm_l_hole', (-30, -6), 0.5)],
    ),
    'beast_arm_u': dict(
        poly=[(646, 102), (650, 86), (660, 80), (676, 76), (692, 78), (702, 88), (704, 104), (700, 122),
              (690, 134), (678, 146), (668, 158), (658, 170), (646, 176), (634, 170), (626, 158),
              (632, 142), (640, 128), (646, 116)],
        pivot='shoulder', axis='elbow',
        holes=['elbow_hole'], clones=[('elbow_hole', (14, -18), 1.0)],
    ),
    'beast_arm_l': dict(
        poly=[(616, 152), (622, 140), (634, 134), (648, 138), (658, 146), (662, 160), (668, 176),
              (674, 188), (686, 196), (694, 208), (696, 224), (694, 238), (688, 247), (676, 249),
              (668, 243), (661, 232), (655, 216), (650, 202), (640, 188), (630, 176), (618, 164)],
        pivot='elbow', axis='knuckle',
    ),
    'beast_leg_u': dict(
        poly=[(646, 208), (658, 200), (676, 198), (694, 202), (706, 212), (714, 226), (724, 238),
              (730, 252), (726, 264), (714, 270), (700, 264), (688, 252), (674, 242), (660, 234),
              (648, 224)],
        pivot='hip', axis='knee',
        holes=['knee_hole'], clones=[('knee_hole', (-14, -16), 1.0)],
    ),
    'beast_leg_l': dict(
        poly=[(694, 238), (704, 228), (720, 226), (734, 234), (736, 252), (732, 266), (724, 274),
              (720, 286), (718, 298), (724, 308), (736, 318), (746, 328), (750, 338), (742, 344),
              (724, 342), (706, 338), (694, 334), (684, 324), (682, 308), (686, 298), (676, 298),
              (660, 298), (650, 292), (658, 282), (674, 280), (684, 268), (688, 254), (690, 244)],
        pivot='knee', axis='ankle',
    ),
    'beast_tail1': dict(
        poly=ribbon(TAIL_CENTER1, [8, 7.5, 7, 6.5]),
        pivot='tail0', axis='tail1',
        holes=['tail_hole'], clones=[('tail_hole', (-38, 10), 1.0)],
    ),
    'beast_tail2': dict(
        poly=ribbon(TAIL_CENTER2, [6.5, 6, 5, 3.5, 2]),
        pivot='tail1', axis='tail2',
    ),
}

HOLES = {
    # the near arm covers the torso's shoulder and chest
    'arm_u_hole': PARTS['beast_arm_u']['poly'],
    'arm_l_hole': PARTS['beast_arm_l']['poly'],
    # the elbow cop (arm_l) covers the end of the upper arm
    'elbow_hole': [(618, 150), (626, 138), (640, 134), (654, 140), (662, 152), (660, 166), (652, 176),
                   (640, 178), (628, 172), (620, 162)],
    # the knee plate (leg_l) covers the end of the thigh
    'knee_hole': [(696, 236), (706, 228), (720, 226), (734, 234), (736, 252), (732, 266), (724, 274),
                  (712, 272), (700, 262), (692, 250)],
    # the skirt covers the root of the tail
    'tail_hole': ribbon(TAIL_CENTER1[:3], [8, 7.5, 7]),
}

# Attach offsets in root space for the limbs that hang off the root rather than the torso.
NEAR_LEG_OFFSET = (3, 0)
FAR_LEG_OFFSET = (-9, 2)
FAR_ARM_OFFSET = (-8, 3)
# Rest angles (deg, added by the runtime to the animated angle): the painted stance has a bent elbow,
# a deeper digitigrade crouch and a tail carried out behind; the clips were tuned for the procedural
# beast, so these nudge every pose toward the painting without changing the animation.
REST = dict(arm_l_near=-15, arm_l_far=-15, leg_u_near=-10, leg_u_far=-10, leg_l_near=10, leg_l_far=10,
            tail1=30, tail2=15)
Z = dict(torso=10, head=12, arm_u_far=4, arm_l_far=5, arm_u_near=20, arm_l_near=21,
         leg_u_far=2, leg_l_far=3, leg_u_near=14, leg_l_near=15, tail1=6, tail2=7)

# Pose keys copied from src/rig/clips/humanoid.js (beastClips) used by the preview.
POSES = [
    ('neutral', {}),
    ('idle', dict(torso=4, head=-8, arm_u_near=24, arm_l_near=-10, arm_u_far=28, arm_l_far=-14,
                  leg_u_near=-14, leg_l_near=24, leg_u_far=10, leg_l_far=12, tail1=40, tail2=20)),
    ('run0', dict(torso=22, head=-4, leg_u_near=-42, leg_l_near=10, leg_u_far=33.6, leg_l_far=60,
                  arm_u_near=29.4, arm_l_near=-40, arm_u_far=-29.4, arm_l_far=-60, rootY=3, tail1=50, tail2=30)),
    ('run1', dict(torso=25, head=-2, leg_u_near=5, leg_l_near=30, leg_u_far=10, leg_l_far=20,
                  arm_u_near=0, arm_l_near=-50, arm_u_far=0, arm_l_far=-50, rootY=-3, tail1=40, tail2=40)),
    ('attack1 windup', dict(torso=-8, head=4, arm_u_near=130, arm_l_near=-50, arm_u_far=30, arm_l_far=-30,
                            leg_u_near=-24, leg_l_near=22, leg_u_far=16, leg_l_far=14, rootY=-2, tail1=70, tail2=40)),
    ('attack1 hit', dict(torso=22, head=-6, arm_u_near=-100, arm_l_near=-30, arm_u_far=50, arm_l_far=-40,
                         leg_u_near=-40, leg_l_near=40, leg_u_far=24, leg_l_far=40, rootX=10, rootY=4, tail1=30, tail2=10)),
    ('attack3 hit', dict(torso=34, head=-14, arm_u_near=-90, arm_l_near=-20, arm_u_far=-90, arm_l_far=-20,
                         leg_u_near=-50, leg_l_near=50, leg_u_far=30, leg_l_far=60, rootX=22, rootY=8, tail1=20, tail2=0)),
    ('guard', dict(torso=10, head=-6, arm_u_near=-70, arm_l_near=-110, arm_u_far=-60, arm_l_far=-120,
                   leg_u_near=-30, leg_l_near=36, leg_u_far=22, leg_l_far=30, rootY=8, tail1=40, tail2=20)),
]
IDLE = POSES[1][1]


# ------------------------------------------------------------------ helpers ----

def mkdir(p):
    os.makedirs(p, exist_ok=True)


def poly_mask(poly, W, H, ss=4):
    """Anti-aliased polygon coverage (float 0..1, shape (H, W))."""
    im = Image.new('L', (W * ss, H * ss), 0)
    ImageDraw.Draw(im).polygon([(x * ss, y * ss) for x, y in poly], fill=255)
    a = np.array(im, np.float64) / 255.0
    return a.reshape(H, ss, W, ss).mean(axis=(1, 3))


def box3(a):
    p = np.pad(a, 1, mode='edge')
    return (p[:-2, :-2] + p[:-2, 1:-1] + p[:-2, 2:] + p[1:-1, :-2] + p[1:-1, 1:-1] + p[1:-1, 2:]
            + p[2:, :-2] + p[2:, 1:-1] + p[2:, 2:])


def morph(mask, r, mode):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    f = ImageFilter.MaxFilter if mode == 'dilate' else ImageFilter.MinFilter
    return np.array(im.filter(f(2 * r + 1))) > 127


def estimate_background(rgb):
    """Per-row background colour from the columns either side of the figure, interpolated across x."""
    H, W = rgb.shape[:2]
    cols = []
    for (x0, x1) in BG_COLS:
        cols.append((0.5 * (x0 + x1), np.median(rgb[:, x0:x1], axis=1)))
    (xa, ca), (xb, cb) = cols
    t = np.clip((np.arange(W) - xa) / (xb - xa), 0, 1)
    bg = ca[:, None, :] * (1 - t)[None, :, None] + cb[:, None, :] * t[None, :, None]
    return bg


def matte(rgb):
    """Figure alpha (float 0..1) from the colour distance to the gradient background."""
    H, W = rgb.shape[:2]
    bg = estimate_background(rgb)
    d = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    m = d > MATTE_THRESHOLD
    m &= poly_mask(FIGURE_ENVELOPE, W, H) > 0.5
    m = morph(morph(m, 1, 'dilate'), 1, 'erode')       # close 1px gaps
    m = morph(morph(m, 1, 'erode'), 1, 'dilate')       # drop 1px specks
    # fill enclosed holes (dark-on-dark pockets that fell under the threshold): background pixels of
    # the figure box that cannot be reached from the box border stay inside the figure
    bx0, by0, bx1, by1 = FIG_BOX
    sub = m[by0:by1, bx0:bx1]
    bg = ~sub
    reach = np.zeros_like(bg)
    reach[0, :] = bg[0, :]; reach[-1, :] = bg[-1, :]; reach[:, 0] = bg[:, 0]; reach[:, -1] = bg[:, -1]
    while True:
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]; grown[:-1, :] |= reach[1:, :]
        grown[:, 1:] |= reach[:, :-1]; grown[:, :-1] |= reach[:, 1:]
        grown &= bg
        if (grown == reach).all():
            break
        reach = grown
    pockets = bg & ~reach
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
        if len(comp) <= MAX_POCKET:
            for cy, cx in comp:
                keep[cy, cx] = True
    m[by0:by1, bx0:bx1] = sub | keep
    # soft 1px edge
    a = np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float64) / 255
    return a, m, d


def fill_hidden(rgb, alpha, known, hole, clones, W, H):
    """Fill `hole` (bool mask) of a part so nothing is missing when another part rotates away:
    diffuse the surrounding known colour inwards, blend in cloned texture from an offset source where
    one is given (weight 1 = pure clone, used to continue a limb under a joint plate; a partial weight
    keeps the fur structure without hard edges), then darken slightly and add fur-like grain."""
    rgb = rgb.copy()
    alpha = np.maximum(alpha, hole.astype(np.float64))
    todo = hole.copy()
    k = known & ~hole
    col = rgb * k[..., None]
    w = k.astype(np.float64)
    for _ in range(200):
        if not todo.any():
            break
        cb = np.dstack([box3(col[..., c]) for c in range(3)])
        wb = box3(w)
        new = todo & (wb > 0)
        if not new.any():
            break
        rgb[new] = cb[new] / wb[new][:, None]
        k[new] = True; todo[new] = False
        col = rgb * k[..., None]; w = k.astype(np.float64)
    out = np.dstack([gauss_f(rgb[..., c], 0.9) for c in range(3)])
    src = rgb.copy()
    for (cpoly, (dx, dy), wt) in clones:
        cm = (poly_mask(cpoly, W, H) > 0.5) & hole
        ys, xs = np.nonzero(cm)
        sx, sy = xs + dx, ys + dy
        ok = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
        ok[ok] &= known[sy[ok], sx[ok]] & ~hole[sy[ok], sx[ok]]
        out[ys[ok], xs[ok]] = out[ys[ok], xs[ok]] * (1 - wt) + src[sy[ok], sx[ok]] * wt
    rs = np.random.RandomState(7)
    g = gauss_f(rs.normal(0, 1, (H, W)), 0.6)
    p = np.pad(g, ((4, 4), (0, 0)), mode='edge')
    cs = np.cumsum(p, axis=0)
    grain = (cs[8:] - cs[:-8]) / 8.0                    # vertical fur-like streaks
    grain = grain / (grain.std() + 1e-6)
    hm = hole.astype(np.float64)
    hm = np.array(Image.fromarray((hm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float64) / 255
    hm = hm * hole
    filled = out * 0.86 + grain[..., None] * 9.0
    rgb = rgb * (1 - hm)[..., None] + filled * hm[..., None]
    return np.clip(rgb, 0, 255), alpha


def rotate_part(rgba, pivot, theta_deg, joints):
    """Rotate an RGBA array about `pivot` by theta (image coords, +ve = clockwise on screen) and crop
    to the opaque bounding box. Returns (rgba, pivot, joints) in the new frame."""
    H, W = rgba.shape[:2]
    th = math.radians(theta_deg)
    c, s = math.cos(th), math.sin(th)
    px, py = pivot

    def fwd(x, y):
        dx, dy = x - px, y - py
        return (px + dx * c - dy * s, py + dx * s + dy * c)
    xs, ys = zip(*[fwd(0, 0), fwd(W, 0), fwd(0, H), fwd(W, H)])
    x0, y0 = math.floor(min(xs)), math.floor(min(ys))
    x1, y1 = math.ceil(max(xs)), math.ceil(max(ys))
    ow, oh = x1 - x0, y1 - y0
    # output (u, v) -> input: in = pivot + R(-th) * ((u + x0) - px, (v + y0) - py)
    a, b, cc = c, s, px - c * (px - x0) - s * (py - y0)
    d, e, f = -s, c, py + s * (px - x0) - c * (py - y0)
    im = Image.fromarray(rgba.astype(np.uint8), 'RGBA')
    # premultiply so the bicubic filter does not bleed transparent black into the edge
    arr = np.array(im, np.float64)
    pm = arr.copy(); pm[..., :3] *= arr[..., 3:4] / 255
    pim = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), 'RGBA')
    out = pim.transform((ow, oh), Image.AFFINE, (a, b, cc, d, e, f), resample=Image.BICUBIC)
    o = np.array(out, np.float64)
    al = o[..., 3:4]
    o[..., :3] = np.where(al > 0, o[..., :3] * 255 / np.maximum(al, 1e-6), 0)
    o = np.clip(o, 0, 255)
    npv = (px - x0, py - y0)
    nj = {k: (fwd(*v)[0] - x0, fwd(*v)[1] - y0) for k, v in joints.items()}
    return o, npv, nj


def crop_alpha(rgba, pivot, joints, margin=2):
    ys, xs = np.nonzero(rgba[..., 3] > 2)
    x0, y0 = max(0, xs.min() - margin), max(0, ys.min() - margin)
    x1, y1 = min(rgba.shape[1], xs.max() + 1 + margin), min(rgba.shape[0], ys.max() + 1 + margin)
    sub = rgba[y0:y1, x0:x1]
    pv = (pivot[0] - x0, pivot[1] - y0)
    nj = {k: (v[0] - x0, v[1] - y0) for k, v in joints.items()}
    return sub, pv, nj


def normal_map(rgba, round_r=9.0, shape_k=0.7, detail=1.6, strength=1.0):
    """Height = rounded silhouette (distance transform) + luminance detail (plates, fur strands)."""
    a = rgba[..., 3] / 255.0
    mask = a > 0.5
    if not mask.any():
        return encode_normal_map(np.zeros_like(a), np.zeros_like(a), np.ones_like(a), a)
    dist = chamfer_dt(mask)
    R = float(max(1.0, min(dist.max(), round_r)))
    t = np.clip(dist / R, 0, 1)
    hsh = R * np.sqrt(t * (2 - t)) * shape_k
    lum = (rgba[..., 0] * 0.299 + rgba[..., 1] * 0.587 + rgba[..., 2] * 0.114) / 255.0
    # keep the detail inside the silhouette: pad the luminance outward so the edge does not ring
    lum = np.where(mask, lum, 0.0)
    wsum = gauss_f(mask.astype(np.float64), 2.0)
    lum_in = np.where(mask, lum, gauss_f(lum, 2.0) / np.maximum(wsum, 1e-3))
    fine = gauss_f(lum_in, 0.8) - gauss_f(lum_in, 2.5)
    coarse = gauss_f(lum_in, 2.5) - gauss_f(lum_in, 7.0)
    hd = (fine * 2.2 + coarse * 1.4) * detail * R
    h = hsh + hd * mask
    h = gauss_f(h, 0.6)
    nx, ny, nz = height_to_normals(h, strength)
    return encode_normal_map(nx, ny, nz, a)


# --------------------------------------------------------------------- main ----

def build(src, out_spr, out_rig, flip=False, debug=None):
    sheet = Image.open(src).convert('RGB')
    rgb = np.array(sheet, np.float64)
    H, W = rgb.shape[:2]
    alpha, hard, dist = matte(rgb)   # hard mask / distance kept for debugging
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
        for k, (x, y) in J.items():
            d.ellipse([x - 2, y - 2, x + 2, y + 2], outline=(255, 255, 255, 255))
        ov = ov.crop(FIG_BOX)
        ov.resize((ov.width * 3, ov.height * 3), Image.LANCZOS).save(os.path.join(debug, 'polys.png'))

    parts = {}
    for name, spec in PARTS.items():
        pm = poly_mask(spec['poly'], W, H)
        a = pm * alpha
        known = (a > 0.5)
        hole = np.zeros((H, W), bool)
        for hn in spec.get('holes', []):
            hole |= poly_mask(HOLES[hn], W, H) > 0.5
        hole &= pm > 0.5
        prgb = rgb
        if hole.any():
            clones = [(HOLES[hn], off, wt) for hn, off, wt in spec.get('clones', [])]
            prgb, a = fill_hidden(rgb, a, known | hole, hole, clones, W, H)
            # the hole mask is hard-edged; re-feather the part's outer boundary by 1px
            soft = np.array(Image.fromarray((np.maximum(a, hole) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float64) / 255
            a = np.minimum(a, soft)
        rgba = np.dstack([prgb, a * 255])
        # crop to the figure box first (speed), keep absolute joint coordinates
        bx0, by0, bx1, by1 = FIG_BOX
        rgba = rgba[by0:by1, bx0:bx1]
        joints = {k: (v[0] - bx0, v[1] - by0) for k, v in J.items()}
        pivot = joints[spec['pivot']]
        if flip:
            rgba = rgba[:, ::-1]
            w = rgba.shape[1]
            joints = {k: (w - 1 - v[0], v[1]) for k, v in joints.items()}
            pivot = joints[spec['pivot']]
        theta = 0.0
        if spec.get('axis'):
            ax, ay = joints[spec['axis']]
            theta = math.degrees(math.atan2(ax - pivot[0], ay - pivot[1]))   # rotate by +theta -> axis straight down
            rgba, pivot, joints = rotate_part(rgba, pivot, theta, joints)
        rgba, pivot, joints = crop_alpha(rgba, pivot, joints)
        pivot = (int(round(pivot[0])), int(round(pivot[1])))
        img = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA')
        nm = normal_map(rgba, round_r=12.0 if name in ('beast_torso', 'beast_head') else 8.0)
        mkdir(out_spr)
        img.save(os.path.join(out_spr, name + '.png'))
        nm.save(os.path.join(out_spr, name + '_n.png'))
        parts[name] = dict(img=img, nmap=nm, pivot=pivot, joints=joints, theta=theta)
        print(f'{name:14s} {img.width:4d}x{img.height:<4d} pivot={pivot} painted-angle={theta:6.1f} deg')

    rig = make_rig(parts)
    mkdir(out_rig)
    json.dump(rig, open(os.path.join(out_rig, 'beast.json'), 'w'), indent=1)
    return rig, parts


def make_rig(parts):
    def jp(part, joint):
        """Joint position relative to the part's pivot, in the part image frame."""
        p = parts[part]
        x, y = p['joints'][joint]
        return (x - p['pivot'][0], y - p['pivot'][1])

    def dist(part, a, b):
        pa, pb = parts[part]['joints'][a], parts[part]['joints'][b]
        return math.hypot(pb[0] - pa[0], pb[1] - pa[1])

    r = lambda v: int(round(v))
    neck = jp('beast_torso', 'neck')
    sh = jp('beast_torso', 'shoulder')
    tail0 = jp('beast_torso', 'tail0')
    len_au = dist('beast_arm_u', 'shoulder', 'elbow')
    len_al = dist('beast_arm_l', 'elbow', 'claw')
    len_lu = dist('beast_leg_u', 'hip', 'knee')
    len_ll = dist('beast_leg_l', 'knee', 'ankle')
    len_t1 = dist('beast_tail1', 'tail0', 'tail1')
    len_t2 = dist('beast_tail2', 'tail1', 'tail2')
    P = []

    def add(name, tex, parent, at, z, length=0):
        d = dict(name=name, tex=tex, parent=parent, at=[r(at[0]), r(at[1])],
                 pivot=list(parts[tex]['pivot']), z=Z[name], len=r(length))
        if REST.get(name):
            d['rest'] = REST[name]
        P.append(d)
    add('torso', 'beast_torso', None, (0, 0), 10)
    add('head', 'beast_head', 'torso', neck, 12)
    add('arm_u_far', 'beast_arm_u', 'torso', (sh[0] + FAR_ARM_OFFSET[0], sh[1] + FAR_ARM_OFFSET[1]), 4, len_au)
    add('arm_l_far', 'beast_arm_l', 'arm_u_far', (0, len_au), 5, len_al)
    add('arm_u_near', 'beast_arm_u', 'torso', sh, 20, len_au)
    add('arm_l_near', 'beast_arm_l', 'arm_u_near', (0, len_au), 21, len_al)
    add('leg_u_far', 'beast_leg_u', None, FAR_LEG_OFFSET, 2, len_lu)
    add('leg_l_far', 'beast_leg_l', 'leg_u_far', (0, len_lu), 3, len_ll)
    add('leg_u_near', 'beast_leg_u', None, NEAR_LEG_OFFSET, 14, len_lu)
    add('leg_l_near', 'beast_leg_l', 'leg_u_near', (0, len_lu), 15, len_ll)
    add('tail1', 'beast_tail1', None, tail0, 6, len_t1)
    add('tail2', 'beast_tail2', 'tail1', (0, len_t1), 7, len_t2)
    rig = dict(name='beast', source='concept', scale=0.5, height=0, hunch=0, parts=P, reach=0, leg_len=0)
    # height: full-size standing extent in the idle pose; leg_len: hip-to-sole in idle / 0.88, which is
    # what Player.js uses to put the hip above the ground
    top, bottom = pose_extent(rig, parts, IDLE)
    rig['height'] = r(bottom - top)
    rig['leg_len'] = r(bottom / 0.88)
    return rig


# ------------------------------------------------------------------ preview ----

def pose_world(rig, pose):
    """Same maths as Rig.apply: returns {bone: (wx, wy, wr_rad)} with the root at (0, 0)."""
    DEG = math.pi / 180
    parts = {p['name']: p for p in rig['parts']}
    out = {}
    rx, ry = pose.get('rootX', 0), pose.get('rootY', 0)
    rot = pose.get('rot', 0) * DEG
    order = []
    while len(order) < len(rig['parts']):
        for p in rig['parts']:
            if p['name'] in order or (p['parent'] and p['parent'] not in order):
                continue
            order.append(p['name'])
    for n in order:
        d = parts[n]
        local = pose.get(n, 0) + (d.get('rest', 0) or 0) + (rig.get('hunch', 0) if n == 'torso' else 0)
        if d['parent']:
            px, py, pr = out[d['parent']]
        else:
            px, py, pr = rx, ry, rot
        c, s = math.cos(pr), math.sin(pr)
        ax, ay = d['at']
        out[n] = (px + ax * c - ay * s, py + ax * s + ay * c, pr + local * DEG)
    return out


def render_pose(rig, parts, pose, scale=1.0, tint_far=(154, 154, 176)):
    """Render a pose into an RGBA layer whose origin (rig root) is at `origin`; returns (img, origin)."""
    W = pose_world(rig, pose)
    pm = {p['name']: p for p in rig['parts']}
    layers = []
    for n in sorted(W, key=lambda k: pm[k]['z']):
        d = pm[n]
        tex = parts[d['tex']]['img']
        wx, wy, wr = W[n]
        pv = d['pivot']
        im = tex
        if n.endswith('_far'):
            arr = np.array(im, np.float64)
            arr[..., :3] *= np.array(tint_far, float)[None, None, :] / 255
            im = Image.fromarray(arr.astype(np.uint8), 'RGBA')
        # rotate about the pivot (PIL rotates CCW for +angle in screen space; our wr is CW)
        arr = np.array(im, np.float64)
        rot, npv, _ = rotate_part(arr, pv, math.degrees(wr), {})
        layers.append((Image.fromarray(np.clip(rot, 0, 255).astype(np.uint8), 'RGBA'), wx - npv[0], wy - npv[1]))
    xs0 = min(l[1] for l in layers); ys0 = min(l[2] for l in layers)
    xs1 = max(l[1] + l[0].width for l in layers); ys1 = max(l[2] + l[0].height for l in layers)
    cw, ch = int(math.ceil(xs1 - xs0)) + 2, int(math.ceil(ys1 - ys0)) + 2
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    for im, x, y in layers:
        canvas.alpha_composite(im, (int(round(x - xs0)), int(round(y - ys0))))
    origin = (-xs0, -ys0)
    if scale != 1.0:
        arr = np.array(canvas, np.float64)
        pmul = arr.copy(); pmul[..., :3] *= arr[..., 3:4] / 255
        sm = Image.fromarray(np.clip(pmul, 0, 255).astype(np.uint8), 'RGBA').resize(
            (max(1, int(cw * scale)), max(1, int(ch * scale))), Image.LANCZOS)
        a2 = np.array(sm, np.float64)
        a2[..., :3] = np.where(a2[..., 3:4] > 0, a2[..., :3] * 255 / np.maximum(a2[..., 3:4], 1e-6), 0)
        canvas = Image.fromarray(np.clip(a2, 0, 255).astype(np.uint8), 'RGBA')
        origin = (origin[0] * scale, origin[1] * scale)
    return canvas, origin


def pose_extent(rig, parts, pose):
    """(top, bottom) of the rendered pose relative to the root, in rig pixels."""
    img, origin = render_pose(rig, parts, pose)
    ys = np.nonzero(np.array(img)[..., 3] > 64)[0]
    return ys.min() - origin[1], ys.max() - origin[1]


def preview(rig, parts, outdir, src_sheet=None):
    mkdir(outdir)
    shot = Image.open(os.path.join(ROOT, 'docs', 'screenshot.png')).convert('RGBA')
    ground_shot = 606           # y of the floor line in docs/screenshot.png
    hip = rig['leg_len'] * 0.88
    # 1x strip: each pose standing on a ground line, with joints marked
    cells = []
    for pname, pose in POSES:
        img, origin = render_pose(rig, parts, pose)
        cell = Image.new('RGBA', (max(img.width + 20, 300), 420), (0, 0, 0, 0))
        bg = shot.crop((300, 300, 300 + cell.width, 300 + cell.height))
        cell.alpha_composite(bg)
        gy = 380
        ox = (cell.width - img.width) // 2
        oy = int(round(gy - hip - origin[1]))
        cell.alpha_composite(img, (ox, oy))
        d = ImageDraw.Draw(cell)
        d.line([(0, gy), (cell.width, gy)], fill=(255, 220, 120, 200), width=1)
        Wd = pose_world(rig, pose)
        for n, (wx, wy, wr) in Wd.items():
            X, Y = ox + origin[0] + wx, oy + origin[1] + wy
            d.ellipse([X - 2, Y - 2, X + 2, Y + 2], outline=(0, 255, 0, 255))
        d.text((6, 6), pname, fill=(255, 255, 255, 255))
        cells.append(cell)
    strip = Image.new('RGBA', (sum(c.width for c in cells), 420), (20, 20, 30, 255))
    x = 0
    for c in cells:
        strip.alpha_composite(c, (x, 0)); x += c.width
    strip.save(os.path.join(outdir, 'beast_poses_1x.png'))
    # 0.5x in the actual screenshot next to the knight for scale
    half = shot.copy()
    x = 80
    for pname, pose in POSES:
        img, origin = render_pose(rig, parts, pose, scale=rig['scale'])
        half.alpha_composite(img, (int(x), int(round(ground_shot - hip * rig['scale'] - origin[1]))))
        x += img.width + 30
    half.save(os.path.join(outdir, 'beast_poses_half.png'))
    # neutral pose vs the painting (sheet crop) at 1x, plus the normal maps and a relit check
    img, origin = render_pose(rig, parts, {})
    idle, io = render_pose(rig, parts, IDLE)
    panel = Image.new('RGBA', (img.width + idle.width + 320, max(img.height, idle.height, 330)), (60, 60, 70, 255))
    if src_sheet is not None:
        panel.alpha_composite(src_sheet.convert('RGBA').crop((500, 30, 800, 350)), (0, 0))
    panel.alpha_composite(img, (310, 10)); panel.alpha_composite(idle, (320 + img.width, 10))
    panel.save(os.path.join(outdir, 'beast_neutral_vs_painting.png'))
    # normal maps + relit check
    nparts = {k: dict(v, img=v['nmap']) for k, v in parts.items()}
    nimg, _ = render_pose(rig, nparts, IDLE, tint_far=(255, 255, 255))
    nimg.save(os.path.join(outdir, 'beast_idle_normals.png'))
    c = np.array(idle).astype(float); n = np.array(nimg).astype(float) / 255 * 2 - 1
    Hh, Ww = c.shape[:2]
    yy, xx = np.mgrid[0:Hh, 0:Ww]
    lx, ly, lz = (Ww * 0.9 - xx), -(Hh * 0.2 - yy), 90.0
    L = np.sqrt(lx * lx + ly * ly + lz * lz)
    lam = np.clip((n[..., 0] * lx + n[..., 1] * ly + n[..., 2] * lz) / L, 0, 1)
    c[..., :3] = np.clip(c[..., :3] * (0.25 + 1.4 * lam[..., None]), 0, 255)
    Image.fromarray(c.astype(np.uint8), 'RGBA').save(os.path.join(outdir, 'beast_idle_relit.png'))
    # parts sheet
    ims = [parts[k]['img'] for k in PARTS]
    sheet = Image.new('RGBA', (sum(i.width + 8 for i in ims), max(i.height for i in ims) + 8), (70, 70, 90, 255))
    x = 4
    for k in PARTS:
        p = parts[k]
        sheet.alpha_composite(p['img'], (x, 4))
        d = ImageDraw.Draw(sheet)
        px, py = p['pivot']
        d.ellipse([x + px - 3, 4 + py - 3, x + px + 3, 4 + py + 3], outline=(0, 255, 0, 255))
        x += p['img'].width + 8
    sheet.save(os.path.join(outdir, 'beast_parts.png'))
    return os.path.join(outdir, 'beast_poses_1x.png')


def main():
    argv = sys.argv[1:]
    src = argv[argv.index('--src') + 1] if '--src' in argv else DEFAULT_SRC
    prev = argv[argv.index('--preview') + 1] if '--preview' in argv else None
    debug = argv[argv.index('--debug') + 1] if '--debug' in argv else None
    flip = '--flip' in argv
    rig, parts = build(src, SPR, RIGS, flip=flip, debug=debug)
    print(json.dumps({p['name']: dict(at=p['at'], pivot=p['pivot'], len=p['len']) for p in rig['parts']}, indent=0))
    print('height', rig['height'], 'leg_len', rig['leg_len'])
    if prev:
        print('preview:', preview(rig, parts, prev, Image.open(src)))


if __name__ == '__main__':
    main()
