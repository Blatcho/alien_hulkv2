"""The brood queen: the boss hulk's mother (original design) -> public/assets/models/queen.glb

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/queen.py \
       -- --out public/assets/models [--preview tools/out/previews]

Design: the alien's mother, built at her true size (about 3.3 m to the crest, 4.6 m from the
mandibles to the ovipositor; the engine draws her at scale 1, core/config.js ALIEN_TYPES.queen).
The same family as alien.py - bone-white chitin bands over dark violet flesh, yellow eyes and gill
slits, scythe forelimbs over small grasping hands, digitigrade legs - but a queen's build: a
crowned skull with a fan of crest plates and swept horns, four legs to carry a bloated egg-sac
abdomen that drags behind her, its segments studded with glowing eggs (M_GlowPink), ending in an
ovipositor. She never climbs or leaps: idle, lurk (brooding, low over the clutch), skitter (a
heavy four-legged walk), attack (two scythe swings), hit and die.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mathutils import Vector  # noqa: E402

from lib.chars import (V, Poser, curve, limb, plate, rot_x, rot_y, rot_z, sampled_clip,  # noqa: E402
                       shard, shell, smooth, wave)
from lib.common import box, material, out_dir, part, reset_scene, script_args, sphere, tri_count  # noqa: E402
from lib.export import bounds, export_glb, write_meta  # noqa: E402
from lib.preview import contact_sheet  # noqa: E402
from lib.rig import build_armature, skin, socket  # noqa: E402

args = script_args()
out = out_dir(args)
reset_scene()

M_BASE = material("M_Base", roughness=0.45, metallic=0.05)
M_GLOW = material("M_Glow", emissive=(1.0, 0.8, 0.16), emissive_strength=2.5)
M_EGG = material("M_GlowPink", emissive=(1.0, 0.32, 0.72), emissive_strength=0.9)  # (soft: the game blooms it)

BONE = "#c9bda0"
BONE_D = "#a99d80"
CLAW = "#ddd3b8"
FLESH = "#2e1630"
FLESH_D = "#1f0e22"
FLESH_L = "#4a2448"
SAC = "#5c2a5a"
SAC_L = "#7a3a74"
GUM = "#6a2030"
GLOW = "#ffd23a"
EGG = "#d86ab4"

# ---------------------------------------------------------------- skeleton (rest pose, hunched)
bones = [
    ("hips", (0, 0.80, 1.95), (0, 0.40, 2.15), None),
    ("spine", (0, 0.40, 2.15), (0, -0.05, 2.40), "hips"),
    ("chest", (0, -0.05, 2.40), (0, -0.55, 2.55), "spine"),
    ("neck", (0, -0.55, 2.55), (0, -0.95, 2.48), "chest"),
    ("head", (0, -0.95, 2.48), (0, -1.75, 2.20), "neck"),
    ("jaw", (0, -1.02, 2.26), (0, -1.68, 2.08), "head"),
    ("ab1", (0, 0.90, 1.90), (0, 1.55, 1.72), "hips"),
    ("ab2", (0, 1.55, 1.72), (0, 2.20, 1.45), "ab1"),
    ("ab3", (0, 2.20, 1.45), (0, 2.80, 1.12), "ab2"),
    ("ab4", (0, 2.80, 1.12), (0, 3.30, 0.80), "ab3"),
    ("sting", (0, 3.30, 0.80), (0, 3.80, 0.45), "ab4"),
]
# Two pairs of digitigrade legs: the front pair off the thorax, the hind pair off the pelvis.
LEGS = {  # tag: (parent, hip, knee, hock, ball, toe) - left side; the right is mirrored
    "F": ("chest", (0.52, -0.20, 2.25), (0.90, -0.62, 1.80), (0.92, -0.10, 0.72), (0.92, -0.32, 0.12), (0.92, -0.60, 0.05)),
    "H": ("hips", (0.50, 0.90, 1.90), (0.82, 0.55, 1.50), (0.88, 1.20, 0.62), (0.88, 1.02, 0.12), (0.88, 0.76, 0.05)),
}
SC_SH = (0.62, -0.48, 2.78)
SC_EL = (0.78, -0.80, 2.15)
SC_WR = (0.78, -0.95, 1.45)
SC_TIP = (0.78, -1.10, 0.05)
LO_SH = (0.36, -0.36, 2.32)
LO_EL = (0.42, -0.52, 1.85)
LO_WR = (0.46, -0.68, 1.42)
LO_TIP = (0.46, -0.76, 1.22)


def mx(p, s):
    return (p[0] * s, p[1], p[2])


for L, (par, HIP, KNEE, HOCK, BALL, TOE) in LEGS.items():
    for S, s in (("L", 1), ("R", -1)):
        bones += [
            (f"thigh{L}.{S}", mx(HIP, s), mx(KNEE, s), par),
            (f"shin{L}.{S}", mx(KNEE, s), mx(HOCK, s), f"thigh{L}.{S}"),
            (f"tarsus{L}.{S}", mx(HOCK, s), mx(BALL, s), f"shin{L}.{S}"),
            (f"toe{L}.{S}", mx(BALL, s), mx(TOE, s), f"tarsus{L}.{S}"),
        ]
for S, s in (("L", 1), ("R", -1)):
    bones += [
        (f"sc_up.{S}", mx(SC_SH, s), mx(SC_EL, s), "chest"),
        (f"sc_lo.{S}", mx(SC_EL, s), mx(SC_WR, s), f"sc_up.{S}"),
        (f"blade.{S}", mx(SC_WR, s), mx(SC_TIP, s), f"sc_lo.{S}"),
        (f"lo_up.{S}", mx(LO_SH, s), mx(LO_EL, s), "chest"),
        (f"lo_lo.{S}", mx(LO_EL, s), mx(LO_WR, s), f"lo_up.{S}"),
        (f"hand.{S}", mx(LO_WR, s), mx(LO_TIP, s), f"lo_lo.{S}"),
    ]
arm = build_armature("QueenRig", bones)

# ---------------------------------------------------------------- model
parts = []


def add(name, bm, col, bone, mat=M_BASE, jitter=0.06, ao=0.4):
    parts.append(part(name, bm, mat, col, bone, jitter=jitter, ao=ao))


def glow(name, bm, bone, col=GLOW, mat=M_GLOW):
    add(name, bm, col, bone, mat=mat, jitter=0.0, ao=0.0)


# body core
add("Pelvis", sphere(0.34, (0, 0.72, 2.00), seg=10, rings=7, scale=(1.3, 1.1, 0.9)), FLESH, "hips")
add("Waist", limb((0, 0.52, 2.08), (0, -0.08, 2.40), 0.28, 0.36, verts=8, scale=(1.15, 0.95)), FLESH_D, "spine")
add("Thorax", sphere(0.50, (0, -0.30, 2.45), seg=12, rings=8, scale=(1.35, 1.05, 0.95)), FLESH, "chest")
add("Neck", limb((0, -0.52, 2.56), (0, -1.02, 2.48), 0.24, 0.20, verts=7), FLESH_D, "neck")
# belly ridges under the waist and thorax
for i, (y, z) in enumerate(((0.36, 1.78), (0.14, 1.90), (-0.08, 1.98), (-0.34, 2.00))):
    add(f"Belly{i}", box((0.42, 0.11, 0.07), (0, y, z), rot=(-38, 0, 0), bevel=0.015), FLESH_L, "spine" if y > 0 else "chest")

# dorsal chitin bands (armadillo-like), front to back
for i, (y, pitch, rx, rz) in enumerate(((-0.62, 14, 0.56, 0.44), (-0.34, 2, 0.66, 0.50), (-0.06, -12, 0.64, 0.48))):
    add(f"ChestBand{i}", shell((0, y, 2.46), rx, rz, 0.34, arc=212, thick=0.06, taper=1.08, rot=(pitch, 0, 0)), BONE, "chest")
add("WaistBand0", shell((0, 0.22, 2.22), 0.40, 0.36, 0.30, arc=190, thick=0.055, taper=1.08, rot=(-30, 0, 0)), BONE_D, "spine")
add("WaistBand1", shell((0, 0.48, 2.10), 0.42, 0.36, 0.28, arc=190, thick=0.055, taper=1.08, rot=(-36, 0, 0)), BONE, "spine")
add("PelvisBand", shell((0, 0.76, 2.02), 0.47, 0.34, 0.42, arc=200, thick=0.06, taper=0.9, rot=(-16, 0, 0)), BONE, "hips")
add("NeckBand", shell((0, -0.78, 2.58), 0.27, 0.25, 0.28, arc=140, thick=0.05, taper=1.1, rot=(16, 0, 0)), BONE_D, "neck")
# dorsal spines along the back plates, a crest of them over the thorax
for i, (y, z, h, b) in enumerate(((-0.62, 2.98, 0.30, "chest"), (-0.34, 3.02, 0.36, "chest"), (-0.06, 2.98, 0.32, "chest"),
                                  (0.22, 2.64, 0.26, "spine"), (0.50, 2.52, 0.22, "spine"), (0.78, 2.40, 0.18, "hips"))):
    add(f"Spine{i}", shard((0, y, z - 0.06), (0, y + 0.22, z + h), 0.08, 0.13, n=2, tip=0.08), BONE_D, b)
    for s in (1, -1):
        add(f"SpineSide{i}{s}", shard((s * 0.30, y, z - 0.26), (s * 0.48, y + 0.16, z - 0.06), 0.06, 0.09, n=2, tip=0.1), BONE_D, b)
# gill slits (glow) down the neck
for s in (1, -1):
    for i, y in enumerate((-0.66, -0.76, -0.86)):
        glow(f"Gill{s}{i}", box((0.03, 0.03, 0.15), (s * 0.235, y, 2.50), rot=(15, 0, 0)), "neck")

# head: a long arrow-head skull with stepped ridge plates, crowned
add("Skull", limb((0, -0.92, 2.50), (0, -1.80, 2.22), 0.21, 0.05, verts=7, scale=(1.15, 0.9)), FLESH_D, "head")
for i, (y, rx, rz, L) in enumerate(((-1.06, 0.25, 0.21, 0.30), (-1.30, 0.21, 0.18, 0.28), (-1.52, 0.16, 0.14, 0.26), (-1.70, 0.10, 0.09, 0.20))):
    z = 2.50 + (y + 0.92) * 0.32
    add(f"Ridge{i}", shell((0, y, z), rx, rz, L, arc=168, thick=0.045, taper=1.16, rot=(16, 0, 0)), BONE, "head")
# the crown: a fan of crest plates up and back from the brow, the centre one tallest, and swept horns
for i, (x, y, h, back) in enumerate(((0.0, -1.02, 0.78, 0.34), (0.11, -1.04, 0.66, 0.30), (-0.11, -1.04, 0.66, 0.30),
                                      (0.21, -1.08, 0.52, 0.26), (-0.21, -1.08, 0.52, 0.26), (0.29, -1.14, 0.38, 0.20),
                                      (-0.29, -1.14, 0.38, 0.20))):
    add(f"Crest{i}", shard((x, y, 2.62), (x * 2.1, y + back, 2.62 + h), 0.09, 0.05, bend=(x * 0.2, 0.04, 0.10), n=3, tip=0.1),
        BONE if i % 2 == 0 else BONE_D, "head")
for s in (1, -1):
    add(f"Horn{s}", shard((s * 0.17, -1.00, 2.56), (s * 0.44, -0.42, 2.98), 0.13, 0.13, bend=(s * 0.06, 0, 0.14), n=4, tip=0.08), BONE, "head")
    # four pairs of eyes down each side of the skull
    for i, (y, x, z) in enumerate(((-1.18, 0.205, 2.40), (-1.30, 0.19, 2.37), (-1.43, 0.165, 2.34), (-1.55, 0.14, 2.31))):
        glow(f"Eye{s}{i}", sphere(0.052 - 0.006 * i, (s * x, y, z), seg=6, rings=4), "head")
    for i in range(6):
        y = -1.18 - 0.11 * i
        x = s * (0.15 - 0.016 * i)
        z = 2.27 - 0.03 * i
        add(f"Fang{s}{i}", shard((x, y, z), (x * 0.9, y - 0.02, z - 0.13 + 0.012 * i), 0.04, 0.045, n=1, tip=0.1), CLAW, "head")
add("Palate", box((0.20, 0.62, 0.06), (0, -1.42, 2.25), rot=(12, 0, 0)), GUM, "head")

# jaw, with a pair of long tusks
add("Jaw", limb((0, -1.04, 2.26), (0, -1.80, 2.10), 0.16, 0.06, verts=6, scale=(1.2, 0.6)), FLESH, "jaw")
add("Tongue", box((0.14, 0.50, 0.05), (0, -1.38, 2.20), rot=(12, 0, 0)), GUM, "jaw")
for s in (1, -1):
    add(f"Mandible{s}", plate((s * 0.13, -1.06, 2.22), (s * 0.06, -1.78, 2.08), 0.07, 0.14), BONE, "jaw")
    add(f"Tusk{s}", shard((s * 0.15, -1.50, 2.12), (s * 0.12, -2.02, 2.04), 0.07, 0.06, bend=(s * 0.06, -0.06, -0.08), n=3, tip=0.08), CLAW, "jaw")
    for i in range(5):
        y = -1.24 - 0.12 * i
        x = s * (0.12 - 0.015 * i)
        z = 2.21 - 0.03 * i
        add(f"LowFang{s}{i}", shard((x, y, z), (x * 0.9, y - 0.02, z + 0.10), 0.036, 0.04, n=1, tip=0.1), CLAW, "jaw")

# the abdomen: four bloated sac segments, banded on top, studded with glowing eggs, and the ovipositor
AB = [  # (bone, a, b, radius)
    ("ab1", (0, 0.90, 1.90), (0, 1.55, 1.72), 0.58),
    ("ab2", (0, 1.55, 1.72), (0, 2.20, 1.45), 0.72),
    ("ab3", (0, 2.20, 1.45), (0, 2.80, 1.12), 0.68),
    ("ab4", (0, 2.80, 1.12), (0, 3.30, 0.80), 0.52),
]
for i, (b, a, c, r) in enumerate(AB):
    a, c = Vector(a), Vector(c)
    mid = (a + c) / 2 + V(0, 0, -0.10)
    axis = c - a
    add(f"Sac{i}", sphere(r, tuple(mid), seg=10, rings=7, scale=(1.15, axis.length / r * 0.66, 0.95)), SAC if i % 2 == 0 else SAC_L, b)
    add(f"SacBand{i}", shell(tuple(mid + V(0, 0, 0.06)), r * 1.05, r * 0.9, axis.length * 0.9, arc=150, thick=0.05, n=6,
                             taper=0.94, rot=(-25 - 6 * i, 0, 0)), BONE if i % 2 == 0 else BONE_D, b)
    # eggs pressing through the sac wall: a cluster each side and one underneath
    for j, (sx, sy, sz, er) in enumerate(((1.0, -0.14, 0.0, 0.24), (1.0, 0.18, -0.28, 0.19), (-1.0, 0.02, -0.06, 0.23),
                                          (-1.0, 0.24, -0.34, 0.17), (0.0, 0.05, -0.70, 0.20), (0.6, 0.28, -0.56, 0.15),
                                          (-0.6, -0.26, -0.50, 0.15), (0.85, -0.30, 0.34, 0.13))):
        p = mid + V(sx * r * 0.84, sy, sz * r)
        glow(f"Egg{i}{j}", sphere(er, tuple(p), seg=6, rings=4), b, col=EGG, mat=M_EGG)
add("Sting", shard((0, 3.28, 0.82), (0, 3.95, 0.40), 0.16, 0.14, bend=(0, 0.05, -0.02), n=4, tip=0.05), CLAW, "sting")
for s in (1, -1):
    add(f"StingSpur{s}", shard((s * 0.10, 3.36, 0.84), (s * 0.30, 3.62, 0.96), 0.06, 0.06, n=2, tip=0.1), BONE_D, "sting")

# limbs
for S, s in (("L", 1), ("R", -1)):
    X = lambda x: s * x  # noqa: E731
    for L, (par, HIP, KNEE, HOCK, BALL, TOE) in LEGS.items():
        th, sh_, ta, to = f"thigh{L}.{S}", f"shin{L}.{S}", f"tarsus{L}.{S}", f"toe{L}.{S}"
        hip, knee, hock, ball, toe = (Vector(mx(p, s)) for p in (HIP, KNEE, HOCK, BALL, TOE))
        big = 1.0 if L == "F" else 0.92
        add(f"Thigh{L}{S}", limb(tuple(hip + V(0, 0.02, 0.06)), tuple(knee), 0.27 * big, 0.17 * big, verts=7, scale=(0.9, 1.1)), FLESH, th)
        add(f"ThighPlate{L}{S}", plate(tuple(hip + V(X(0.16), -0.02, 0.02)), tuple(knee + V(X(0.08), 0.02, 0.10)), 0.11 * big, 0.38 * big,
                                       taper=(1.0, 0.55), bevel=0.02), BONE, th)
        add(f"Knee{L}{S}", sphere(0.18 * big, tuple(knee), seg=6, rings=4), FLESH_D, sh_)
        add(f"KneeSpur{L}{S}", shard(tuple(knee + V(0, -0.08, 0.05)), tuple(knee + V(X(0.06), -0.36, 0.26)), 0.08, 0.10, n=2, tip=0.1), BONE, sh_)
        add(f"Shin{L}{S}", limb(tuple(knee), tuple(hock), 0.17 * big, 0.11 * big, verts=6), FLESH, sh_)
        add(f"Greave{L}{S}", plate(tuple(knee + V(0, 0.05, -0.06)), tuple(hock + V(0, 0.02, 0.04)), 0.20 * big, 0.12 * big, taper=(0.7, 1.0),
                                   offset=(0, -0.12)), BONE, sh_)
        add(f"HockSpur{L}{S}", shard(tuple(hock), tuple(hock + V(0, 0.30, 0.16)), 0.08, 0.09, n=2, tip=0.1), BONE_D, ta)
        add(f"Tarsus{L}{S}", limb(tuple(hock), tuple(ball), 0.11 * big, 0.085 * big, verts=5), FLESH_D, ta)
        add(f"Pad{L}{S}", sphere(0.10 * big, tuple(ball + V(0, -0.02, -0.02)), seg=6, rings=4, scale=(1.1, 1.3, 0.7)), FLESH_D, to)
        for i, dx in enumerate((-0.10, 0.0, 0.10)):
            add(f"Toe{L}{S}{i}", shard(tuple(ball + V(dx, -0.06, -0.02)), tuple(toe + V(dx * 1.8, -0.10, -0.03)), 0.06, 0.07,
                                       bend=(0, 0, 0.06), n=3, tip=0.1), CLAW, to)
        add(f"DewClaw{L}{S}", shard(tuple(ball + V(0, 0.06, 0.02)), tuple(ball + V(0, 0.26, -0.08)), 0.05, 0.06, n=2, tip=0.1), CLAW, to)
    # scythe forelimbs
    su, sl, bl = f"sc_up.{S}", f"sc_lo.{S}", f"blade.{S}"
    sh, el, wr = (Vector(mx(p, s)) for p in (SC_SH, SC_EL, SC_WR))
    add(f"ScUpper{S}", limb(tuple(sh), tuple(el), 0.17, 0.13, verts=6), FLESH, su)
    add(f"ScShoulder{S}", shell(tuple(sh + V(X(0.04), 0, 0.02)), 0.24, 0.22, 0.46, arc=200, thick=0.055, taper=0.75, rot=(90, 0, s * -20)), BONE, su)
    add(f"ScElbow{S}", sphere(0.14, tuple(el), seg=6, rings=4), FLESH_D, sl)
    add(f"ScFore{S}", plate(tuple(el + V(0, 0.02, 0.06)), tuple(wr + V(0, 0, 0.02)), 0.24, 0.32, taper=(0.72, 0.8), bevel=0.03), BONE, sl)
    for i, (y, z) in enumerate(((-0.70, 2.02), (-0.76, 1.72))):
        add(f"ScBarb{S}{i}", shard((X(0.78), y, z), (X(0.78), y + 0.28, z + 0.13), 0.065, 0.1, n=2, tip=0.1), BONE_D, sl)
    add(f"ScWrist{S}", sphere(0.12, tuple(wr), seg=6, rings=4), FLESH_D, bl)
    b0, b1, bend = wr + V(0, 0.02, 0.06), Vector(mx(SC_TIP, s)), V(0, -0.46, 0)
    add(f"Blade{S}", shard(tuple(b0), tuple(b1), 0.08, 0.36, bend=tuple(bend), n=7, tip=0.04), CLAW, bl)
    mid = (b0 + b1) / 2 + bend
    for i, u in enumerate((0.26, 0.40, 0.54, 0.68, 0.80)):
        c = (1 - u) ** 2 * b0 + 2 * (1 - u) * u * mid + u * u * b1
        k = (1 - u) + u * 0.04
        c = c + V(0, 0.18 * k, 0)
        add(f"Serr{S}{i}", shard(tuple(c), tuple(c + V(0, 0.15, 0.08)), 0.05, 0.065, n=1, tip=0.1), BONE_D, bl)
    # lower grasping arms
    lu, ll, hd = f"lo_up.{S}", f"lo_lo.{S}", f"hand.{S}"
    lsh, lel, lwr = (Vector(mx(p, s)) for p in (LO_SH, LO_EL, LO_WR))
    add(f"LoUpper{S}", limb(tuple(lsh), tuple(lel), 0.10, 0.08, verts=5), FLESH, lu)
    add(f"LoFore{S}", limb(tuple(lel), tuple(lwr), 0.078, 0.065, verts=5), FLESH_D, ll)
    add(f"LoPlate{S}", plate(tuple(lel + V(X(0.01), -0.03, -0.04)), tuple(lwr + V(X(0.01), -0.02, 0.06)), 0.11, 0.12), BONE_D, ll)
    add(f"Palm{S}", box((0.13, 0.11, 0.11), tuple(lwr + V(0, -0.03, -0.06)), bevel=0.02), FLESH, hd)
    for i, dx in enumerate((-0.05, 0.0, 0.05)):
        add(f"Finger{S}{i}", shard(tuple(lwr + V(dx, -0.05, -0.09)), tuple(lwr + V(dx * 1.6, -0.15, -0.30)), 0.035, 0.04,
                                   bend=(0, -0.03, 0), n=2, tip=0.15), CLAW, hd)

body = skin(parts, arm, "Queen")
print("STATS queen tris", tri_count(body))

socket("socket_head", arm, "head", (0, -1.25, 3.55))
socket("socket_mouth", arm, "head", (0, -1.78, 2.12))
SOCKETS = ["socket_head", "socket_mouth"]

# ---------------------------------------------------------------- pose building
P = Poser(arm)
HIPS_HEAD = Vector((0, 0.80, 1.95))
TARSUS_VEC = {L: Vector(spec[4]) - Vector(spec[3]) for L, spec in LEGS.items()}
BALL_Z = {L: spec[4][2] for L, spec in LEGS.items()}
BLADE_TIP_OFF = Vector(SC_TIP) - Vector(SC_WR)      # wrist -> blade tip (rest)
_err = {"max": 0.0}
AB_BONES = ["ab1", "ab2", "ab3", "ab4", "sting"]
LEG_TAGS = [("F", "L", 1), ("F", "R", -1), ("H", "L", 1), ("H", "R", -1)]
KNEE_POLE = {"F": (0.8, -0.6, 0.25), "H": (0.9, -0.3, 0.2)}


def chest_rel(pose):
    M = P.world_matrix(pose, "chest")
    return M, M.to_3x3() @ P.rest["chest"].to_3x3().inverted()


def build(p):
    pose = {}
    pose["hips"] = {"rot": p.get("hip_rot", (0, 0, 0))}
    P.set_world(pose, "hips", P=HIPS_HEAD + Vector(p.get("hip", (0, 0, 0))))
    pose["spine"] = p.get("spine", (0, 0, 0))
    pose["chest"] = p.get("chest", (0, 0, 0))
    pose["neck"] = p.get("neck", (0, 0, 0))
    lk = p.get("look")
    if lk is None:
        pose["head"] = p.get("head", (0, 0, 0))
    else:
        P.set_world(pose, "head", R=rot_z(lk[1]) @ rot_x(lk[0]) @ rot_y(lk[2] if len(lk) > 2 else 0))
    pose["jaw"] = (p.get("jaw", 0), 0, 0)
    for b, r in zip(AB_BONES, p.get("ab", [(0, 0, 0)] * 5)):
        pose[b] = r
    # four digitigrade legs: the ball of each foot placed, its tarsus pitched, thigh and shin solved to the hock
    for L, S, s in LEG_TAGS:
        f = p.get(f"foot{L}{S}")
        if f is None:
            for b in ("thigh", "shin", "tarsus", "toe"):
                pose[f"{b}{L}.{S}"] = p.get("legs", {}).get(f"{b}{L}.{S}", (0, 0, 0))
            continue
        x, y, lift, tp, toe = (list(f) + [0, 0, 0])[:5]
        ball = Vector((x, y, BALL_Z[L] + lift))
        Rt = rot_x(tp)
        hock = ball - Rt @ TARSUS_VEC[L]
        pole = p.get(f"knee{L}{S}", mx(KNEE_POLE[L], s))
        P.ik(pose, f"thigh{L}.{S}", f"shin{L}.{S}", hock, Vector(pole), hinge=(1, 0, 0))
        P.set_world(pose, f"tarsus{L}.{S}", R=Rt)
        P.set_world(pose, f"toe{L}.{S}", R=rot_x(toe))
    M, CR = chest_rel(pose)
    Rc = P.rest["chest"].inverted()
    # scythes: ("rel", wrist-in-chest-rest-space, blade pitch, pole[, blade yaw]) or ("tip" | "wrist", world point, pitch, pole)
    for S, s in (("L", 1), ("R", -1)):
        spec = p.get("sc" + S)
        if spec is None:
            for b in ("sc_up", "sc_lo", "blade"):
                pose[f"{b}.{S}"] = p.get("arms", {}).get(f"{b}.{S}", (0, 0, 0))
            continue
        mode, pt, pitch, pole = spec[:4]
        yaw = spec[4] if len(spec) > 4 else 0.0
        if mode == "rel":
            wrist = M @ Rc @ Vector(pt)
            Rb = CR @ rot_z(yaw) @ rot_x(pitch)
            polew = CR @ Vector(pole)
        elif mode == "wrist":
            wrist = Vector(pt)
            Rb = rot_z(yaw) @ rot_x(pitch)
            polew = Vector(pole)
        else:
            Rb = rot_z(yaw) @ rot_x(pitch)
            wrist = Vector(pt) - Rb @ BLADE_TIP_OFF
            polew = Vector(pole)
        P.ik(pose, f"sc_up.{S}", f"sc_lo.{S}", wrist, polew)
        P.set_world(pose, f"blade.{S}", R=Rb)
        got = P.world(pose, f"blade.{S}", Vector(mx(SC_WR, s)))
        _err["max"] = max(_err["max"], (got - wrist).length)
    # lower hands: target in chest-rest space, pole, finger curl
    for S, s in (("L", 1), ("R", -1)):
        spec = p.get("lo" + S, ((s * 0.40, -0.85, 1.95), (s * 0.6, 0.4, -1), 0))
        pt, pole, curl = spec
        tgt = M @ Rc @ Vector(pt)
        P.ik(pose, f"lo_up.{S}", f"lo_lo.{S}", tgt, CR @ Vector(pole))
        pose[f"hand.{S}"] = (curl, 0, 0)
    return pose


def clip(name, frames, fn, loop=True, step=2, **meta):
    _err["max"] = 0.0
    c = sampled_clip(arm, P, name, frames, lambda t: build(fn(t)), loop=loop, step=step, **meta)
    if _err["max"] > 0.06:
        print(f"WARN queen {name}: scythe wrist misses target by {_err['max']:.3f} m")
    return c


def merged(base, **kw):
    d = dict(base)
    d.update(kw)
    return d


# reference poses ---------------------------------------------------------------
THREAT_L = ("rel", (0.72, -1.25, 2.95), -32, (0.5, 0.4, -1))
THREAT_R = ("rel", (-0.72, -1.25, 2.95), -32, (-0.5, 0.4, -1))
FEET = dict(footFL=(0.92, -0.40, 0, -15, 0), footFR=(-0.92, -0.24, 0, -15, 0), footHL=(0.88, 0.95, 0, -15, 0), footHR=(-0.88, 1.10, 0, -15, 0))
AB_STAND = [(-3, 0, 0), (-2, 0, 0), (-2, 0, 0), (0, 0, 0), (0, 0, 0)]
AB_LEVEL = [(15, 0, 0), (7, 0, 0), (7, 0, 0), (4, 0, 0), (2, 0, 0)]  # the chain levelled out (lying on the deck)
STAND = dict(hip=(0, 0.04, -0.12), hip_rot=(-6, 0, 0), spine=(-6, 0, 0), chest=(-5, 0, 0), neck=(10, 0, 0),
             look=(0, 0, 0), scL=THREAT_L, scR=THREAT_R, ab=AB_STAND, **FEET)


def ab_wave(t, amp=6, lift=0, cycles=1, phase=0.0, base=AB_STAND):
    """The abdomen swaying side to side (and lifting), each segment a little behind the last."""
    return [(base[i][0] + lift * (0.5 + 0.2 * i), 0, amp * (0.4 + 0.3 * i) * wave(t, cycles, phase - 0.08 * i)) for i in range(5)]


# ---------------------------------------------------------------- clips
def idle(t):
    """Breathing, the sac heaving, the head sweeping slowly, the jaws working now and then."""
    b = wave(t, 2)
    sway = wave(t, 1)
    turn = curve(t, [(0, 0), (0.25, 0), (0.30, 16), (0.50, 16), (0.55, -12), (0.78, -12), (0.84, 0), (1, 0)])
    tilt = curve(t, [(0, 0), (0.30, 0), (0.34, 8), (0.50, 8), (0.55, 0), (1, 0)])
    jaw = curve(t, [(0, 3), (0.58, 3), (0.64, 18), (0.74, 4), (1, 3)])
    return merged(STAND, hip=(0.015 * sway, 0.04, -0.12 + 0.025 * b), chest=(-5 - 2 * b, 2 * sway, 0), spine=(-6 - 1.5 * b, 0, 0),
                  look=(4 - 2 * b, turn, tilt), jaw=jaw, ab=ab_wave(t, 5, -4 * b, 1),
                  scL=("rel", (0.72, -1.25, 2.95 + 0.03 * b), -32 + 5 * wave(t, 2, 0.1), (0.5, 0.4, -1)),
                  scR=("rel", (-0.72, -1.25, 2.95 + 0.03 * b), -32 + 5 * wave(t, 2, 0.35), (-0.5, 0.4, -1)),
                  loL=((0.40, -0.88, 1.98), (0.6, 0.4, -1), 20 + 20 * max(0, wave(t, 3))),
                  loR=((-0.40, -0.88, 1.98), (-0.6, 0.4, -1), 20 + 20 * max(0, wave(t, 3, 0.4))))


def lurk(t):
    """Brooding: low over the clutch, the sac on the deck, legs folded wide, scythes down, the head nodding."""
    b = wave(t, 1)
    return dict(hip=(0, 0.10, -0.72 + 0.02 * b), hip_rot=(8, 0, 0), spine=(5 - 2 * b, 0, 0), chest=(6 - 3 * b, 0, 0),
                neck=(18, 0, 0), look=(26, 6 * wave(t, 1, 0.3), 0), jaw=2 + 3 * max(0, b),
                ab=[(10 + 2 * b, 0, 3 * b), (5, 0, 4 * b), (4, 0, 5 * b), (2, 0, 5 * b), (0, 0, 4 * b)],
                footFL=(1.10, -0.36, 0, -45, 0), footFR=(-1.10, -0.20, 0, -45, 0),
                footHL=(1.08, 1.00, 0, -48, 0), footHR=(-1.08, 1.14, 0, -48, 0),
                kneeFL=(0.9, -0.4, 0.5), kneeFR=(-0.9, -0.4, 0.5), kneeHL=(0.9, -0.2, 0.5), kneeHR=(-0.9, -0.2, 0.5),
                scL=("rel", (0.62, -1.05, 2.25), -8, (0.3, 0.8, -0.3)),
                scR=("rel", (-0.62, -1.05, 2.25), -8, (-0.3, 0.8, -0.3)),
                loL=((0.34, -0.78, 2.05), (0.6, 0.5, -1), 40), loR=((-0.34, -0.78, 2.05), (-0.6, 0.5, -1), 40))


SK_F, SK_DUTY, SK_HALF = 24, 0.55, 0.45


def sk_track(ph, half, duty, lift, y0):
    ph %= 1.0
    if ph < duty:
        s = ph / duty
        return y0 - half + 2 * half * s, 0.0, s, True
    s = (ph - duty) / (1 - duty)
    return y0 + half - 2 * half * smooth(s), lift * math.sin(math.pi * s), s, False


def skitter(t):
    """A heavy four-legged walk: diagonal pairs, the sac swaying behind, the head low and the scythes up."""
    a = 2 * math.pi * t
    flex = math.sin(a)
    feet = {}
    for L, S, s, ph in (("F", "L", 1, 0.0), ("H", "R", -1, 0.0), ("F", "R", -1, 0.5), ("H", "L", 1, 0.5)):
        y0 = -0.32 if L == "F" else 1.02
        y, u, sw, stance = sk_track(t + ph, SK_HALF, SK_DUTY, 0.32, y0)
        tp = -12 if stance else -12 - 40 * math.sin(math.pi * sw)
        feet[f"foot{L}{S}"] = (s * (0.92 if L == "F" else 0.88), y, u, tp, 0)
    bob = math.cos(2 * a)
    return dict(
        hip=(0.02 * flex, 0.06, -0.22 + 0.035 * bob), hip_rot=(10 + 4 * flex, 0, 3 * flex), spine=(6 - 4 * flex, 0, -2 * flex),
        chest=(8 - 3 * flex, 0, -2 * flex), neck=(-6, 0, 0), look=(10, 0, 0), jaw=5,
        ab=[(-4 + 2 * flex, 0, 7 * math.sin(a + 1.0)), (-2, 0, 9 * math.sin(a + 0.6)), (0, 0, 10 * math.sin(a + 0.2)),
            (2, 0, 11 * math.sin(a - 0.2)), (2, 0, 12 * math.sin(a - 0.5))],
        scL=("rel", (0.74, -1.20, 2.85 + 0.04 * bob), -28 + 6 * flex, (0.5, 0.5, -1)),
        scR=("rel", (-0.74, -1.20, 2.85 + 0.04 * bob), -28 - 6 * flex, (-0.5, 0.5, -1)),
        loL=((0.36, -0.82, 2.0), (0.6, 0.6, -1), 50), loR=((-0.36, -0.82, 2.0), (-0.6, 0.6, -1), 50),
        **feet,
    )


SWING = [  # (u, wrist in chest-rest space (x sign applied), blade pitch, blade yaw)
    (0.00, (0.72, -1.25, 2.95), -32, 0),
    (0.30, (0.82, -0.64, 3.66), -165, -10),
    (0.46, (0.38, -1.65, 2.31), -40, 20),
    (0.60, (0.20, -1.22, 1.80), 30, 30),
    (0.80, (0.62, -1.18, 2.70), -10, 5),
    (1.00, (0.72, -1.25, 2.95), -32, 0),
]


def swing(u, s):
    w = curve(u, [(k, (s * p[0], p[1], p[2])) for k, p, _, _ in SWING])
    pitch = curve(u, [(k, b) for k, _, b, _ in SWING])
    yaw = curve(u, [(k, -s * y) for k, _, _, y in SWING])
    return ("rel", w, pitch, (s * 0.8, 0.3, -0.6), yaw)


def attack(t):
    """Left scythe in the first half, right in the second (1.1 s each), the whole body thrown into it."""
    uL = t * 2 if t < 0.5 else 1.0
    uR = (t - 0.5) * 2 if t >= 0.5 else 1.0
    strikeL = curve(uL, [(0, 0), (0.3, -0.4), (0.46, 1), (0.7, 0.3), (1, 0)])
    strikeR = curve(uR, [(0, 0), (0.3, -0.4), (0.46, 1), (0.7, 0.3), (1, 0)])
    k = strikeL + strikeR
    twist = 10 * (strikeL - strikeR)
    jaw = curve(t, [(0, 4), (0.2, 34), (0.3, 8), (0.5, 4), (0.7, 34), (0.8, 8), (1, 4)])
    return merged(STAND, hip=(0, -0.14 * k, -0.10 - 0.06 * k), hip_rot=(4 * k, twist * 0.4, 0),
                  spine=(6 * k, twist * 0.3, 0), chest=(8 * k, twist * 0.5, 0), neck=(4 * k, 0, 0),
                  look=(6 * k, -twist * 0.5, 0), jaw=jaw, ab=ab_wave(t, 10, 5, 2),
                  footFL=(0.92, -0.48, 0, -10, 0), footFR=(-0.92, -0.16, 0, -10, 0),
                  scL=swing(uL, 1), scR=swing(uR, -1),
                  loL=((0.40, -0.96 - 0.2 * strikeL, 1.98), (0.6, 0.4, -1), 10 + 40 * strikeL),
                  loR=((-0.40, -0.96 - 0.2 * strikeR, 1.98), (-0.6, 0.4, -1), 10 + 40 * strikeR))


def hit(t):
    k = curve(t, [(0, 0), (0.15, 1), (0.4, 0.7), (1, 0)])
    return merged(STAND, hip=(0, 0.14 * k, -0.08 + 0.04 * k), hip_rot=(-8 * k, 5 * k, 0), spine=(-7 * k, 0, 4 * k),
                  chest=(-9 * k, 0, 5 * k), look=(-22 * k, 14 * k, 8 * k), jaw=2 + 28 * k,
                  ab=[(6 * k, 0, 8 * k)] * 5,
                  scL=("rel", (0.92, -0.78, 3.05), 14 - 50 * k, (0.8, 0.3, -1)),
                  scR=("rel", (-0.92, -0.78, 3.05), 14 - 50 * k, (-0.8, 0.3, -1)))


def die(t):
    """.0-.16 rears up shrieking, scythes flung wide; .16-.5 the legs buckle; .5-.66 the body slams
    down, the sac slumps flat; .66-.85 a spasm; then still."""
    hz = curve(t, [(0, -0.12), (0.16, 0.06), (0.50, -0.90), (0.62, -1.62), (0.70, -1.56), (0.78, -1.62), (1, -1.62)])
    hy = curve(t, [(0, 0.04), (0.16, 0.10), (0.50, 0.0), (0.64, -0.10), (1, -0.10)])
    pitch = curve(t, [(0, -6), (0.16, -32), (0.50, 10), (0.62, 22), (1, 22)])
    roll = curve(t, [(0, 0), (0.50, 4), (0.64, 9), (0.74, 12), (1, 12)])
    tp = curve(t, [(0, -15), (0.16, -6), (0.50, -45), (0.64, -72), (0.72, -64), (0.8, -74), (1, -74)])
    kick = curve(t, [(0, 0), (0.66, 0), (0.72, 0.22), (0.80, 0), (1, 0)])
    jaw = curve(t, [(0, 2), (0.12, 44), (0.50, 32), (0.64, 12), (0.72, 30), (0.88, 20), (1, 22)])
    look = curve(t, [(0, 0), (0.16, -40), (0.50, 10), (0.62, 12), (0.70, 0), (1, 6)])
    spread = curve(t, [(0, 0), (0.16, 1), (0.50, 0.5), (0.64, 0.1), (1, 0.1)])
    down = smooth(max(0.0, (t - 0.44) / 0.22))
    wide = 0.25 * down
    ab = [(AB_STAND[i][0] + (AB_LEVEL[i][0] - AB_STAND[i][0]) * down - 2 * spread, 0, (8 + 14 * down) * (1 if i % 2 else 0.6) + 20 * kick * (i / 4))
          for i in range(5)]
    sc = {}
    for S, s in (("L", 1), ("R", -1)):
        up = ("rel", (s * (0.72 + 0.35 * spread), -1.10 + 0.1 * spread, 2.95 + 0.45 * spread), -32 - 70 * spread, (s * 0.8, 0.3, -1))
        if down <= 0:
            sc["sc" + S] = up
        else:
            # the blades come down flat on the deck either side of her
            ground = ("wrist", (s * 1.30, -1.55 if s > 0 else -1.25, 0.16 + 0.05 * kick), -84, (s * 0.9, 0.2, 0.6), s * 26)
            sc["sc" + S] = ground if down >= 1 else up if down < 0.5 else ground
    return dict(hip=(0, hy, hz), hip_rot=(pitch, 0, roll), spine=(-6 + 12 * down, 0, roll * 0.3),
                chest=(-5 + 8 * down, 0, roll * 0.2), neck=(10 - 20 * down, 0, 0),
                look=(look, 22 * down, 30 * down), jaw=jaw, ab=ab,
                footFL=(0.92 + wide, -0.40 - 0.3 * down + kick * 0.6, kick * 0.5, tp, 0), footFR=(-0.92 - wide, -0.24 - 0.3 * down, 0, tp, 0),
                footHL=(0.88 + wide, 0.95 + 0.3 * down, 0, tp, 0), footHR=(-0.88 - wide, 1.10 + 0.3 * down + kick * 0.4, kick * 0.3, tp, 0),
                kneeFL=(0.9, -0.5, 0.4), kneeFR=(-0.9, -0.5, 0.4), kneeHL=(0.9, -0.2, 0.4), kneeHR=(-0.9, -0.2, 0.4),
                loL=((0.44, -0.86, 1.98 - 0.2 * down), (0.6, 0.4, -1), 60 * down),
                loR=((-0.44, -0.86, 1.98 - 0.2 * down), (-0.6, 0.4, -1), 60 * down), **sc)


# ---------------------------------------------------------------- assemble
fps = 30
clips = [
    clip("idle", 84, idle),
    clip("lurk", 96, lurk),
    clip("skitter", SK_F, skitter, step=1, speed=round(2 * SK_HALF / (SK_DUTY * SK_F / fps), 3)),
    clip("attack", 66, attack, step=1, swing=1.1),
    clip("hit", 12, hit, loop=False, step=1),
    clip("die", 54, die, loop=False, step=1),
]

export_glb(os.path.join(out, "queen.glb"), [arm])
write_meta(out, "queen", {"clips": clips, "sockets": SOCKETS, "bounds": bounds([body])})
print("STATS queen clips", ", ".join(f"{c['name']}:{c['duration']:.2f}s" + (f"@{c['speed']}" if 'speed' in c else "")
                                     for c in clips))

if args.get("preview"):
    pdir = out_dir(args, "preview", "tools/out/previews")
    contact_sheet(arm, clips, os.path.join(pdir, "queen.png"), target=(0, 0.6, 1.6), height=5.2, cols=6, tile=240)
