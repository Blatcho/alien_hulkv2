"""Four-armed hunched predator (original design) -> public/assets/models/alien.glb

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/alien.py \
       -- --out public/assets/models [--preview tools/out/previews] [--review]

Design: a mantis-like hunter. Bone-white chitin bands (armadillo-style) over dark violet-crimson
flesh; a low arrow-head skull stepped with ridge plates, three pairs of small yellow eyes and glowing
gill slits; a big pair of folding scythe forelimbs above a small pair of grasping hands; digitigrade
legs; a short banded tail ending in a fan of spines. It skitters on all fours using the scythe
blades as forelegs.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mathutils import Vector  # noqa: E402

from lib.chars import (V, Poser, curve, limb, plate, review_sheet, rot_x, rot_y, rot_z, sampled_clip,  # noqa: E402
                       shard, shell, smooth, turnaround, wave)
from lib.common import box, material, out_dir, part, reset_scene, script_args, sphere, tri_count  # noqa: E402
from lib.export import bounds, export_glb, write_meta  # noqa: E402
from lib.preview import contact_sheet  # noqa: E402
from lib.rig import build_armature, skin, socket  # noqa: E402

args = script_args()
out = out_dir(args)
reset_scene()

M_BASE = material("M_Base", roughness=0.45, metallic=0.05)
M_GLOW = material("M_Glow", emissive=(1.0, 0.8, 0.16), emissive_strength=2.5)

BONE = "#c9bda0"
BONE_D = "#a99d80"
CLAW = "#ddd3b8"
FLESH = "#3a1c2e"
FLESH_D = "#2a1221"
FLESH_L = "#4f2640"
GUM = "#6a2030"
GLOW = "#ffd23a"

# ---------------------------------------------------------------- skeleton (rest pose, hunched)
bones = [
    ("hips", (0, 0.32, 0.92), (0, 0.14, 1.06), None),
    ("spine", (0, 0.14, 1.06), (0, -0.06, 1.24), "hips"),
    ("chest", (0, -0.06, 1.24), (0, -0.26, 1.32), "spine"),
    ("neck", (0, -0.26, 1.32), (0, -0.42, 1.26), "chest"),
    ("head", (0, -0.42, 1.26), (0, -0.84, 1.14), "neck"),
    ("jaw", (0, -0.46, 1.16), (0, -0.79, 1.08), "head"),
    ("tail1", (0, 0.36, 0.90), (0, 0.53, 0.84), "hips"),
    ("tail2", (0, 0.53, 0.84), (0, 0.68, 0.79), "tail1"),
    ("tail3", (0, 0.68, 0.79), (0, 0.81, 0.75), "tail2"),
    ("tail4", (0, 0.81, 0.75), (0, 0.93, 0.72), "tail3"),
]
HIP = (0.19, 0.30, 0.90)
KNEE = (0.19, 0.02, 0.62)
HOCK = (0.19, 0.30, 0.25)
BALL = (0.19, 0.22, 0.05)
TOE = (0.19, 0.06, 0.03)
SC_SH = (0.26, -0.20, 1.34)
SC_EL = (0.26, -0.32, 1.00)
SC_WR = (0.26, -0.38, 0.66)
SC_TIP = (0.26, -0.44, -0.02)
LO_SH = (0.15, -0.14, 1.10)
LO_EL = (0.15, -0.20, 0.90)
LO_WR = (0.15, -0.26, 0.72)
LO_TIP = (0.15, -0.29, 0.62)


def mx(p, s):
    return (p[0] * s, p[1], p[2])


for S, s in (("L", 1), ("R", -1)):
    bones += [
        (f"thigh.{S}", mx(HIP, s), mx(KNEE, s), "hips"),
        (f"shin.{S}", mx(KNEE, s), mx(HOCK, s), f"thigh.{S}"),
        (f"tarsus.{S}", mx(HOCK, s), mx(BALL, s), f"shin.{S}"),
        (f"toe.{S}", mx(BALL, s), mx(TOE, s), f"tarsus.{S}"),
        (f"sc_up.{S}", mx(SC_SH, s), mx(SC_EL, s), "chest"),
        (f"sc_lo.{S}", mx(SC_EL, s), mx(SC_WR, s), f"sc_up.{S}"),
        (f"blade.{S}", mx(SC_WR, s), mx(SC_TIP, s), f"sc_lo.{S}"),
        (f"lo_up.{S}", mx(LO_SH, s), mx(LO_EL, s), "chest"),
        (f"lo_lo.{S}", mx(LO_EL, s), mx(LO_WR, s), f"lo_up.{S}"),
        (f"hand.{S}", mx(LO_WR, s), mx(LO_TIP, s), f"lo_lo.{S}"),
    ]
arm = build_armature("AlienRig", bones)

# ---------------------------------------------------------------- model
parts = []


def add(name, bm, col, bone, mat=M_BASE, jitter=0.06, ao=0.4):
    parts.append(part(name, bm, mat, col, bone, jitter=jitter, ao=ao))


# body core
add("Pelvis", sphere(0.15, (0, 0.28, 0.95), seg=8, rings=6, scale=(1.25, 1.1, 0.9)), FLESH, "hips")
add("Waist", limb((0, 0.22, 0.99), (0, -0.04, 1.21), 0.115, 0.15, verts=7, scale=(1.1, 0.95)), FLESH_D, "spine")
add("Thorax", sphere(0.21, (0, -0.12, 1.24), seg=10, rings=7, scale=(1.3, 1.05, 0.95)), FLESH, "chest")
add("Neck", limb((0, -0.22, 1.31), (0, -0.47, 1.24), 0.10, 0.085, verts=6), FLESH_D, "neck")
# belly ridges
for i, (y, z) in enumerate(((0.12, 0.93), (0.02, 1.02), (-0.08, 1.07))):
    add(f"Belly{i}", box((0.16, 0.05, 0.03), (0, y, z), rot=(-40, 0, 0), bevel=0.008), FLESH_L, "spine")

# dorsal chitin bands (armadillo-like), front to back
for i, (y, pitch, rx, rz) in enumerate(((-0.27, 12, 0.25, 0.20), (-0.14, 0, 0.285, 0.215), (-0.01, -14, 0.27, 0.21))):
    add(f"ChestBand{i}", shell((0, y, 1.24), rx, rz, 0.15, arc=210, thick=0.03, taper=1.08, rot=(pitch, 0, 0)),
        BONE, "chest")
add("WaistBand0", shell((0, 0.10, 1.10), 0.165, 0.155, 0.13, arc=190, thick=0.028, taper=1.08, rot=(-32, 0, 0)),
    BONE_D, "spine")
add("WaistBand1", shell((0, 0.21, 1.01), 0.17, 0.15, 0.12, arc=190, thick=0.028, taper=1.08, rot=(-38, 0, 0)),
    BONE, "spine")
add("PelvisBand", shell((0, 0.32, 0.95), 0.20, 0.145, 0.19, arc=200, thick=0.03, taper=0.9, rot=(-18, 0, 0)),
    BONE, "hips")
add("NeckBand", shell((0, -0.35, 1.295), 0.115, 0.105, 0.13, arc=140, thick=0.025, taper=1.1, rot=(18, 0, 0)),
    BONE_D, "neck")
# dorsal spines along the back plates
for i, (y, z, b) in enumerate(((-0.27, 1.47, "chest"), (-0.13, 1.48, "chest"), (0.0, 1.45, "chest"),
                               (0.12, 1.30, "spine"))):
    add(f"Spine{i}", shard((0, y, z - 0.03), (0, y + 0.09, z + 0.07), 0.035, 0.06, n=2, tip=0.1), BONE_D, b)
# gill slits (glow) on the neck
for s in (1, -1):
    for i, y in enumerate((-0.30, -0.345, -0.39)):
        add(f"Gill{s}{i}", box((0.014, 0.014, 0.065), (s * 0.101, y, 1.27), rot=(15, 0, 0)), GLOW, "neck",
            mat=M_GLOW, jitter=0.0, ao=0.0)

# head: low arrow-head skull with stepped ridge plates
add("Skull", limb((0, -0.40, 1.27), (0, -0.86, 1.135), 0.085, 0.022, verts=6, scale=(1.1, 0.9)), FLESH_D, "head")
for i, (y, rx, rz, L) in enumerate(((-0.47, 0.107, 0.092, 0.14), (-0.58, 0.088, 0.078, 0.13),
                                     (-0.685, 0.068, 0.06, 0.12), (-0.785, 0.045, 0.04, 0.10))):
    z = 1.27 + (y + 0.40) * 0.295
    add(f"Ridge{i}", shell((0, y, z), rx, rz, L, arc=168, thick=0.02, taper=1.16, rot=(16, 0, 0)), BONE, "head")
for i, (y, z, h) in enumerate(((-0.43, 1.32, 0.10), (-0.535, 1.285, 0.075), (-0.64, 1.25, 0.05))):
    add(f"Crest{i}", shard((0, y, z), (0, y + 0.08, z + h), 0.022, 0.06, n=2, tip=0.1), CLAW, "head")
for s in (1, -1):
    add(f"Horn{s}", shard((s * 0.075, -0.44, 1.30), (s * 0.15, -0.24, 1.40), 0.05, 0.05, bend=(s * 0.02, 0, 0.04),
                          n=3, tip=0.08), BONE, "head")
    for i, (y, x, z) in enumerate(((-0.545, 0.086, 1.212), (-0.60, 0.078, 1.197), (-0.652, 0.068, 1.183))):
        add(f"Eye{s}{i}", sphere(0.025, (s * x, y, z), seg=6, rings=4), GLOW, "head", mat=M_GLOW, jitter=0.0,
            ao=0.0)
    for i in range(5):
        y = -0.53 - 0.062 * i
        x = s * (0.066 - 0.009 * i)
        z = 1.15 - 0.016 * i
        add(f"Fang{s}{i}", shard((x, y, z), (x * 0.9, y - 0.01, z - 0.058 + 0.006 * i), 0.018, 0.02, n=1, tip=0.1),
            CLAW, "head")
add("Palate", box((0.09, 0.28, 0.03), (0, -0.64, 1.15), rot=(12, 0, 0)), GUM, "head")

# jaw
add("Jaw", limb((0, -0.45, 1.14), (0, -0.80, 1.065), 0.066, 0.026, verts=5, scale=(1.2, 0.6)), FLESH, "jaw")
add("Tongue", box((0.065, 0.22, 0.025), (0, -0.62, 1.12), rot=(12, 0, 0)), GUM, "jaw")
for s in (1, -1):
    add(f"Mandible{s}", plate((s * 0.058, -0.46, 1.115), (s * 0.028, -0.79, 1.05), 0.03, 0.062), BONE, "jaw")
    for i in range(4):
        y = -0.56 - 0.065 * i
        x = s * (0.054 - 0.008 * i)
        z = 1.122 - 0.016 * i
        add(f"LowFang{s}{i}", shard((x, y, z), (x * 0.9, y - 0.01, z + 0.045), 0.016, 0.018, n=1, tip=0.1), CLAW,
            "jaw")

# tail
TAIL = [((0, 0.36, 0.90), (0, 0.55, 0.835), 0.09, 0.075), ((0, 0.53, 0.84), (0, 0.70, 0.785), 0.075, 0.06),
        ((0, 0.68, 0.79), (0, 0.83, 0.745), 0.06, 0.045), ((0, 0.81, 0.75), (0, 0.94, 0.715), 0.045, 0.03)]
for i, (a, b, r0, r1) in enumerate(TAIL):
    add(f"Tail{i}", limb(a, b, r0, r1, verts=6), FLESH_D, f"tail{i + 1}")
    mid = (Vector(a) + Vector(b)) / 2
    add(f"TailBand{i}", shell(tuple(mid + V(0, 0.01, 0.005)), r0 * 1.2, r0 * 1.12, (Vector(b) - Vector(a)).length * 0.95,
                              arc=200, thick=0.02, n=5, taper=0.92, rot=(-17, 0, 0)), BONE if i % 2 == 0 else BONE_D,
        f"tail{i + 1}")
for i, (dx, dz) in enumerate(((0, 0.05), (0.05, -0.01), (-0.05, -0.01))):
    add(f"TailSpike{i}", shard((0, 0.92, 0.72), (dx, 1.08, 0.74 + dz), 0.03, 0.03, n=2, tip=0.1), CLAW, "tail4")

# limbs
for S, s in (("L", 1), ("R", -1)):
    X = lambda x: s * x  # noqa: E731
    # legs
    th, sh_, ta, to = f"thigh.{S}", f"shin.{S}", f"tarsus.{S}", f"toe.{S}"
    add(f"Thigh{S}", limb((X(0.19), 0.31, 0.93), (X(0.19), 0.02, 0.62), 0.135, 0.085, verts=7, scale=(0.85, 1.1)),
        FLESH, th)
    add(f"ThighPlate{S}", plate((X(0.245), 0.27, 0.88), (X(0.235), 0.07, 0.67), 0.04, 0.17, taper=(1.0, 0.55),
                                bevel=0.01), BONE, th)
    add(f"Knee{S}", sphere(0.07, (X(0.19), 0.02, 0.62), seg=6, rings=4), FLESH_D, sh_)
    add(f"KneeSpur{S}", shard((X(0.19), -0.02, 0.64), (X(0.19), -0.13, 0.73), 0.035, 0.045, n=2, tip=0.1), BONE, sh_)
    add(f"Shin{S}", limb((X(0.19), 0.02, 0.62), (X(0.19), 0.30, 0.25), 0.078, 0.052, verts=6), FLESH, sh_)
    add(f"Greave{S}", plate((X(0.19), 0.06, 0.60), (X(0.19), 0.31, 0.27), 0.085, 0.05, taper=(0.7, 1.0),
                            offset=(0, -0.05)), BONE, sh_)
    add(f"HockSpur{S}", shard((X(0.19), 0.31, 0.27), (X(0.19), 0.44, 0.33), 0.035, 0.04, n=2, tip=0.1), BONE_D, ta)
    add(f"Tarsus{S}", limb((X(0.19), 0.30, 0.25), (X(0.19), 0.22, 0.05), 0.05, 0.042, verts=5), FLESH_D, ta)
    add(f"Pad{S}", sphere(0.05, (X(0.19), 0.21, 0.045), seg=6, rings=4, scale=(1.1, 1.3, 0.7)), FLESH_D, to)
    for i, dx in enumerate((-0.045, 0.0, 0.045)):
        add(f"Toe{S}{i}", shard((X(0.19 + dx), 0.18, 0.05), (X(0.19 + dx * 1.7), 0.02, 0.012), 0.03, 0.035,
                                bend=(0, 0, 0.03), n=3, tip=0.1), CLAW, to)
    add(f"DewClaw{S}", shard((X(0.19), 0.25, 0.06), (X(0.19), 0.34, 0.015), 0.025, 0.03, n=2, tip=0.1), CLAW, to)
    # scythe forelimbs
    su, sl, bl = f"sc_up.{S}", f"sc_lo.{S}", f"blade.{S}"
    add(f"ScUpper{S}", limb((X(0.26), -0.20, 1.34), (X(0.26), -0.32, 1.00), 0.08, 0.062, verts=6), FLESH, su)
    add(f"ScShoulder{S}", shell((X(0.28), -0.20, 1.35), 0.11, 0.10, 0.22, arc=200, thick=0.028, taper=0.75,
                                rot=(90, 0, s * -20)), BONE, su)
    add(f"ScElbow{S}", sphere(0.065, (X(0.26), -0.32, 1.00), seg=6, rings=4), FLESH_D, sl)
    add(f"ScFore{S}", plate((X(0.26), -0.31, 1.03), (X(0.26), -0.38, 0.67), 0.11, 0.15, taper=(0.72, 0.8),
                            bevel=0.014), BONE, sl)
    for i, (y, z) in enumerate(((-0.27, 0.95), (-0.29, 0.80))):
        add(f"ScBarb{S}{i}", shard((X(0.26), y, z), (X(0.26), y + 0.13, z + 0.06), 0.03, 0.045, n=2, tip=0.1),
            BONE_D, sl)
    add(f"ScWrist{S}", sphere(0.055, (X(0.26), -0.38, 0.67), seg=6, rings=4), FLESH_D, bl)
    b0, b1, bend = V(X(0.26), -0.37, 0.70), V(X(0.26), -0.42, -0.01), V(0, -0.22, 0)
    add(f"Blade{S}", shard(tuple(b0), tuple(b1), 0.036, 0.17, bend=tuple(bend), n=6, tip=0.05), CLAW, bl)
    mid = (b0 + b1) / 2 + bend
    for i, u in enumerate((0.3, 0.48, 0.66)):
        c = (1 - u) ** 2 * b0 + 2 * (1 - u) * u * mid + u * u * b1
        k = (1 - u) + u * 0.05
        c = c + V(0, 0.085 * k, 0)
        add(f"Serr{S}{i}", shard(tuple(c), tuple(c + V(0, 0.07, 0.04)), 0.022, 0.03, n=1, tip=0.1), BONE_D, bl)
    # lower grasping arms
    lu, ll, hd = f"lo_up.{S}", f"lo_lo.{S}", f"hand.{S}"
    add(f"LoUpper{S}", limb((X(0.15), -0.14, 1.10), (X(0.15), -0.20, 0.90), 0.045, 0.038, verts=5), FLESH, lu)
    add(f"LoFore{S}", limb((X(0.15), -0.20, 0.90), (X(0.15), -0.26, 0.72), 0.036, 0.03, verts=5), FLESH_D, ll)
    add(f"LoPlate{S}", plate((X(0.155), -0.215, 0.88), (X(0.155), -0.255, 0.75), 0.05, 0.055), BONE_D, ll)
    add(f"Palm{S}", box((0.06, 0.05, 0.05), (X(0.15), -0.27, 0.69), bevel=0.01), FLESH, hd)
    for i, dx in enumerate((-0.022, 0.0, 0.022)):
        add(f"Finger{S}{i}", shard((X(0.15 + dx), -0.275, 0.675), (X(0.15 + dx * 1.6), -0.32, 0.59), 0.016, 0.018,
                                   bend=(0, -0.015, 0), n=2, tip=0.15), CLAW, hd)

body = skin(parts, arm, "Alien")
print("STATS alien tris", tri_count(body))

socket("socket_head", arm, "head", (0, -0.55, 1.62))
socket("socket_mouth", arm, "head", (0, -0.82, 1.11))
SOCKETS = ["socket_head", "socket_mouth"]

# ---------------------------------------------------------------- pose building
P = Poser(arm)
HIPS_HEAD = Vector((0, 0.32, 0.92))
TARSUS_VEC = Vector(BALL) - Vector(HOCK)
BLADE_TIP_OFF = Vector((0, -0.04, -0.71))      # wrist -> blade tip (rest)
_err = {"max": 0.0}
TAIL_BONES = ["tail1", "tail2", "tail3", "tail4"]


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
    for b, r in zip(TAIL_BONES, p.get("tail", [(0, 0, 0)] * 4)):
        pose[b] = r
    # digitigrade legs: ball of the foot placed, tarsus pitched, thigh/shin solved to the hock
    for S, s in (("L", 1), ("R", -1)):
        f = p.get("foot" + S)
        if f is None:
            for b in ("thigh", "shin", "tarsus", "toe"):
                pose[f"{b}.{S}"] = p.get("legs", {}).get(f"{b}.{S}", (0, 0, 0))
            continue
        x, y, lift, tp, toe = (list(f) + [0, 0, 0])[:5]
        ball = Vector((x, y, BALL[2] + lift))
        Rt = rot_x(tp)
        hock = ball - Rt @ TARSUS_VEC
        P.ik(pose, f"thigh.{S}", f"shin.{S}", hock, Vector(p.get("knee" + S, (s * 0.15, -1, 0.1))), hinge=(1, 0, 0))
        P.set_world(pose, f"tarsus.{S}", R=Rt)
        P.set_world(pose, f"toe.{S}", R=rot_x(toe))
    M, CR = chest_rel(pose)
    Rc = P.rest["chest"].inverted()
    # scythes: ("rel", wrist-in-chest-rest-space, blade pitch, pole[, blade yaw]) or ("tip", world tip, pitch, pole)
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
        spec = p.get("lo" + S, ((s * 0.14, -0.36, 0.95), (s * 0.6, 0.4, -1), 0))
        pt, pole, curl = spec
        tgt = M @ Rc @ Vector(pt)
        P.ik(pose, f"lo_up.{S}", f"lo_lo.{S}", tgt, CR @ Vector(pole))
        pose[f"hand.{S}"] = (curl, 0, 0)
    return pose


def clip(name, frames, fn, loop=True, step=2, **meta):
    _err["max"] = 0.0
    c = sampled_clip(arm, P, name, frames, lambda t: build(fn(t)), loop=loop, step=step, **meta)
    if _err["max"] > 0.04:
        print(f"WARN alien {name}: scythe wrist misses target by {_err['max']:.3f} m")
    return c


def merged(base, **kw):
    d = dict(base)
    d.update(kw)
    return d


# reference poses ---------------------------------------------------------------
THREAT_L = ("rel", (0.30, -0.66, 1.42), -32, (0.5, 0.4, -1))
THREAT_R = ("rel", (-0.30, -0.66, 1.42), -32, (-0.5, 0.4, -1))
STAND = dict(hip=(0, 0.04, -0.10), hip_rot=(-8, 0, 0), spine=(-8, 0, 0), chest=(-6, 0, 0), neck=(12, 0, 0),
             look=(0, 0, 0), footL=(0.21, 0.14, 0, -20, 0), footR=(-0.21, 0.30, 0, -20, 0), scL=THREAT_L, scR=THREAT_R,
             tail=[(-8, 0, 0), (-6, 0, 0), (-4, 0, 0), (0, 0, 0)])


def tail_wave(t, amp=8, lift=0, cycles=1, phase=0.0):
    return [(lift * (0.6 + 0.2 * i), 0, amp * (0.5 + 0.35 * i) * wave(t, cycles, phase - 0.1 * i)) for i in range(4)]


# ---------------------------------------------------------------- clips
def idle(t):
    b = wave(t, 2)
    twitch = curve(t, [(0, 0), (0.30, 0), (0.33, 18), (0.55, 18), (0.58, -10), (0.80, -10), (0.83, 0), (1, 0)])
    tilt = curve(t, [(0, 0), (0.33, 0), (0.36, 12), (0.55, 12), (0.58, 0), (1, 0)])
    jaw = curve(t, [(0, 2), (0.6, 2), (0.66, 14), (0.74, 3), (1, 2)])
    sway = wave(t, 1)
    return merged(STAND, hip=(0.01 * sway, 0.04, -0.10 + 0.012 * b), chest=(-6 - 2 * b, 2 * sway, 0),
                  look=(4 - 2 * b, twitch, tilt), jaw=jaw, tail=tail_wave(t, 7, -6),
                  scL=("rel", (0.30, -0.66, 1.42 + 0.015 * b), -32 + 5 * wave(t, 2, 0.1), (0.5, 0.4, -1)),
                  scR=("rel", (-0.30, -0.66, 1.42 + 0.015 * b), -32 + 5 * wave(t, 2, 0.35), (-0.5, 0.4, -1)),
                  loL=((0.14, -0.38, 0.97), (0.6, 0.4, -1), 20 + 20 * max(0, wave(t, 3))),
                  loR=((-0.14, -0.38, 0.97), (-0.6, 0.4, -1), 20 + 20 * max(0, wave(t, 3, 0.4))))


def lurk(t):
    b = wave(t, 1)
    return dict(hip=(0, 0.06, -0.36 + 0.01 * b), hip_rot=(10, 0, 0), spine=(6 - 2 * b, 0, 0), chest=(6 - 3 * b, 0, 0),
                neck=(18, 0, 0), look=(28, 6 * wave(t, 1, 0.3), 0), jaw=1 + 2 * max(0, b),
                tail=[(-6, 0, 22), (-4, 0, 26), (0, 0, 30), (4, 0, 30)],
                footL=(0.24, 0.12, 0, -48, 0), footR=(-0.24, 0.22, 0, -52, 0),
                kneeL=(0.6, -1, 0.3), kneeR=(-0.6, -1, 0.3),
                scL=("rel", (0.24, -0.50, 1.08), -8, (0.3, 0.8, -0.3)),
                scR=("rel", (-0.24, -0.50, 1.08), -8, (-0.3, 0.8, -0.3)),
                loL=((0.12, -0.32, 1.02), (0.6, 0.5, -1), 40), loR=((-0.12, -0.32, 1.02), (-0.6, 0.5, -1), 40))


SK_F, SK_DUTY, SK_HALF = 12, 0.32, 0.38


def sk_track(ph, half, duty, lift, y0):
    ph %= 1.0
    if ph < duty:
        s = ph / duty
        return y0 - half + 2 * half * s, 0.0, s, True
    s = (ph - duty) / (1 - duty)
    return y0 + half - 2 * half * smooth(s), lift * math.sin(math.pi * s), s, False


def skitter(t):
    a = 2 * math.pi * t
    flex = math.sin(a)                      # spine flex/extend once per stride
    yl, ul, sl, stl = sk_track(t, SK_HALF, SK_DUTY, 0.24, 0.24)
    yr, ur, sr, str_ = sk_track(t + 0.9, SK_HALF, SK_DUTY, 0.24, 0.24)
    bl_, vl, _, bstl = sk_track(t + 0.52, SK_HALF, SK_DUTY, 0.30, -0.80)
    br_, vr, _, bstr = sk_track(t + 0.42, SK_HALF, SK_DUTY, 0.30, -0.80)
    bob = math.cos(2 * a)
    tpl = -8 if stl else -8 - 40 * math.sin(math.pi * sl)
    tpr = -8 if str_ else -8 - 40 * math.sin(math.pi * sr)
    pl = -24 if bstl else -24 - 40 * vl / 0.30
    pr = -24 if bstr else -24 - 40 * vr / 0.30
    return dict(
        hip=(0, 0.06, -0.24 + 0.03 * bob), hip_rot=(14 + 6 * flex, 0, 0), spine=(10 - 6 * flex, 0, 0),
        chest=(12 - 4 * flex, 0, 0), neck=(-10, 0, 0), look=(8, 0, 0), jaw=6,
        tail=[(-10 + 4 * flex, 0, 6 * math.sin(a + 1)), (-4, 0, 8 * math.sin(a + 0.6)), (2, 0, 10 * math.sin(a + 0.2)),
              (4, 0, 12 * math.sin(a - 0.2))],
        footL=(0.21, yl, ul, tpl, 0), footR=(-0.21, yr, ur, tpr, 0),
        scL=("tip", (0.31, bl_, 0.0 + vl), pl, (0.5, 0.6, 0.2)),
        scR=("tip", (-0.31, br_, 0.0 + vr), pr, (-0.5, 0.6, 0.2)),
        loL=((0.12, -0.30, 1.05), (0.6, 0.6, -1), 50), loR=((-0.12, -0.30, 1.05), (-0.6, 0.6, -1), 50),
    )


def leap(t):
    # .0-.18 coil, .18-.38 launch (stretched), .38-.8 air: scythes raised then hooking down, .8-1 land
    hz = curve(t, [(0, -0.04), (0.18, -0.22), (0.36, 0.02), (0.8, 0.0), (0.92, -0.18), (1, -0.1)])
    pitch = curve(t, [(0, 0), (0.18, 10), (0.38, 18), (0.65, 6), (0.85, 12), (1, 4)])
    lift = curve(t, [(0, 0), (0.22, 0), (0.40, 0.34), (0.7, 0.40), (0.86, 0.02), (0.9, 0)])
    back = curve(t, [(0, 0), (0.22, 0), (0.40, 0.30), (0.62, 0.05), (0.86, -0.05), (1, 0)])
    tp = curve(t, [(0, -6), (0.18, -30), (0.34, 30), (0.5, -10), (0.7, -40), (0.86, -10), (0.92, -30), (1, -8)])
    wz = curve(t, [(0, 1.40), (0.18, 1.30), (0.40, 1.62), (0.62, 1.55), (0.82, 1.05), (1, 1.35)])
    wy = curve(t, [(0, -0.52), (0.18, -0.40), (0.40, -0.66), (0.62, -0.70), (0.82, -0.78), (1, -0.55)])
    bp = curve(t, [(0, 14), (0.18, 30), (0.40, -150), (0.62, -140), (0.80, -20), (1, 10)])
    jaw = curve(t, [(0, 2), (0.3, 28), (0.75, 30), (1, 6)])
    return dict(hip=(0, 0.02, hz), hip_rot=(pitch, 0, 0), spine=(pitch * 0.4, 0, 0), chest=(pitch * 0.3, 0, 0),
                look=(0, 0, 0), jaw=jaw,
                tail=[(curve(t, [(0, 0), (0.4, -14), (0.8, 8), (1, 0)]) * k, 0, 0) for k in (0.6, 0.8, 1.0, 1.1)],
                footL=(0.21, 0.16 + back, lift, tp, 0), footR=(-0.21, 0.30 + back * 1.1, lift * 0.9, tp, 0),
                scL=("rel", (0.30, wy, wz), bp, (0.5, 0.4, -1)), scR=("rel", (-0.30, wy, wz), bp, (-0.5, 0.4, -1)),
                loL=((0.14, -0.40, 1.0), (0.6, 0.4, -1), 10), loR=((-0.14, -0.40, 1.0), (-0.6, 0.4, -1), 10))


SWING = [  # (u, wrist in chest-rest space (x sign applied), blade pitch, blade yaw)
    (0.00, (0.30, -0.66, 1.42), -32, 0),
    (0.30, (0.36, -0.28, 1.80), -165, -10),
    (0.46, (0.14, -0.80, 1.10), -40, 20),
    (0.60, (0.02, -0.62, 0.80), 30, 30),
    (0.80, (0.26, -0.56, 1.30), -10, 5),
    (1.00, (0.30, -0.66, 1.42), -32, 0),
]


def swing(u, s):
    w = curve(u, [(k, (s * p[0], p[1], p[2])) for k, p, _, _ in SWING])
    pitch = curve(u, [(k, b) for k, _, b, _ in SWING])
    yaw = curve(u, [(k, -s * y) for k, _, _, y in SWING])
    return ("rel", w, pitch, (s * 0.8, 0.3, -0.6), yaw)


def attack(t):
    # left swing in the first half, right in the second (0.85 s each)
    uL = t * 2 if t < 0.5 else 1.0
    uR = (t - 0.5) * 2 if t >= 0.5 else 1.0
    strikeL = curve(uL, [(0, 0), (0.3, -0.4), (0.46, 1), (0.7, 0.3), (1, 0)])
    strikeR = curve(uR, [(0, 0), (0.3, -0.4), (0.46, 1), (0.7, 0.3), (1, 0)])
    k = strikeL + strikeR
    twist = 12 * (strikeL - strikeR)
    jaw = curve(t, [(0, 4), (0.2, 30), (0.3, 8), (0.5, 4), (0.7, 30), (0.8, 8), (1, 4)])
    return merged(STAND, hip=(0, -0.08 * k, -0.06 - 0.04 * k), hip_rot=(4 * k, twist * 0.4, 0),
                  spine=(6 * k, twist * 0.3, 0), chest=(8 * k, twist * 0.5, 0), neck=(4 * k, 0, 0),
                  look=(6 * k, -twist * 0.5, 0), jaw=jaw, tail=tail_wave(t, 12, 6, 2),
                  footL=(0.21, 0.10, 0, -10, 0), footR=(-0.21, 0.36, 0, -10, 0),
                  scL=swing(uL, 1), scR=swing(uR, -1),
                  loL=((0.14, -0.44 - 0.12 * strikeL, 0.98), (0.6, 0.4, -1), 10 + 40 * strikeL),
                  loR=((-0.14, -0.44 - 0.12 * strikeR, 0.98), (-0.6, 0.4, -1), 10 + 40 * strikeR))


CL_F, CL_RISE = 15, 1.6


def cl_track(ph, top, bottom, duty=0.58):
    ph %= 1.0
    if ph < duty:
        return top + (bottom - top) * (ph / duty), 0.0
    s = (ph - duty) / (1 - duty)
    return bottom + (top - bottom) * smooth(s), math.sin(math.pi * s)


def climb(t):
    span = CL_RISE * 0.58
    hl, al = cl_track(t, 2.12, 2.12 - span)
    hr, ar = cl_track(t + 0.5, 2.12, 2.12 - span)
    fl, fla = cl_track(t + 0.5, 0.95, 0.95 - span)
    fr, fra = cl_track(t, 0.95, 0.95 - span)
    ll, lla = cl_track(t + 0.25, 1.45, 1.45 - span * 0.8)
    lr, lra = cl_track(t + 0.75, 1.45, 1.45 - span * 0.8)
    sn = math.sin(2 * math.pi * t)
    return dict(
        hip=(0.03 * sn, -0.10, 0.02), hip_rot=(-48, 0, 4 * sn), spine=(-6, 0, -3 * sn), chest=(-4, 0, -3 * sn),
        neck=(-10, 0, 0), look=(-40, 8 * sn, 0), jaw=4,
        tail=[(-40, 0, 10 * sn), (-10, 0, 12 * sn), (-5, 0, 14 * sn), (0, 0, 14 * sn)],
        footL=(0.22, -0.30 + 0.12 * fla, fl - 0.05 + 0.05 * fla, -30, 20),
        footR=(-0.22, -0.30 + 0.12 * fra, fr - 0.05 + 0.05 * fra, -30, 20),
        kneeL=(0.7, -1, 0.3), kneeR=(-0.7, -1, 0.3),
        scL=("wrist", (0.26, -0.34 + 0.12 * al, hl), 22 - 60 * al, (1, 0.5, -0.5)),
        scR=("wrist", (-0.26, -0.34 + 0.12 * ar, hr), 22 - 60 * ar, (-1, 0.5, -0.5)),
        loL=((0.14, -0.40, 1.05), (0.8, 0.5, -1), 40), loR=((-0.14, -0.40, 1.05), (-0.8, 0.5, -1), 40),
    ) | _climb_lower(ll, lla, lr, lra)


def _climb_lower(ll, lla, lr, lra):
    return {}


def hit(t):
    k = curve(t, [(0, 0), (0.15, 1), (0.4, 0.7), (1, 0)])
    return merged(STAND, hip=(0, 0.10 * k, -0.04 + 0.03 * k), hip_rot=(-10 * k, 6 * k, 0), spine=(-8 * k, 0, 4 * k),
                  chest=(-10 * k, 0, 6 * k), look=(-25 * k, 15 * k, 10 * k), jaw=2 + 30 * k,
                  tail=[(10 * k, 0, 10 * k)] * 4,
                  scL=("rel", (0.40, -0.40, 1.50), 14 - 50 * k, (0.8, 0.3, -1)),
                  scR=("rel", (-0.40, -0.40, 1.50), 14 - 50 * k, (-0.8, 0.3, -1)))


def scream(t):
    """The screamer's call (sim/alien.js 'scream'): rears up, throws its head back, jaws wide and
    claws spread, the throat shuddering - held - then down again."""
    k = curve(t, [(0, 0), (0.25, 1), (0.8, 1), (1, 0)])
    shake = 4 * math.sin(2 * math.pi * 9 * t) * k
    return merged(STAND, hip=(0, 0.08 * k, -0.1 + 0.06 * k), hip_rot=(-14 * k, 0, 0), spine=(-14 * k, 0, 0),
                  chest=(-16 * k, 0, 0), neck=(-6 * k, 0, 0), look=(-30 * k + shake, 0, shake * 0.5), jaw=4 + 40 * k,
                  tail=tail_wave(t, 8, 10 * k, 3),
                  scL=("rel", (0.48, -0.30, 1.55), 14 - 30 * k, (0.8, 0.3, -1)),
                  scR=("rel", (-0.48, -0.30, 1.55), 14 - 30 * k, (-0.8, 0.3, -1)))


_die_cache = {}


def die_body(t):
    """.0-.15 rear up shrieking, .15-.45 legs buckle, .45-.6 chest slams down, .6-.8 spasm, .8-1 still."""
    hz = curve(t, [(0, -0.10), (0.15, 0.02), (0.45, -0.42), (0.58, -0.72), (0.64, -0.66), (0.72, -0.72), (1, -0.72)])
    hy = curve(t, [(0, 0.04), (0.15, 0.08), (0.45, 0.0), (0.6, -0.06), (1, -0.06)])
    pitch = curve(t, [(0, -8), (0.15, -30), (0.45, 10), (0.58, 24), (1, 24)])
    roll = curve(t, [(0, 0), (0.45, 4), (0.6, 10), (0.7, 14), (1, 15)])
    tp = curve(t, [(0, -20), (0.15, -8), (0.45, -45), (0.6, -70), (0.7, -62), (0.76, -72), (1, -72)])
    kick = curve(t, [(0, 0), (0.6, 0), (0.68, 0.22), (0.76, 0), (1, 0)])
    jaw = curve(t, [(0, 2), (0.12, 40), (0.45, 30), (0.6, 12), (0.7, 30), (0.85, 20), (1, 22)])
    look = curve(t, [(0, 0), (0.15, -40), (0.45, 10), (0.58, 10), (0.66, 0), (1, 6)])
    down = smooth(max(0.0, (t - 0.4) / 0.25))
    return dict(hip=(0, hy, hz), hip_rot=(pitch, 0, roll), spine=(-8 + 14 * down, 0, roll * 0.3),
                chest=(-6 + 8 * down, 0, roll * 0.2), neck=(12 - 22 * down, 0, 0),
                look=(look, 25 * down, 35 * down), jaw=jaw,
                tail=[(-10 * down + 25 * kick, 0, (14 + 20 * down) * (1 if i % 2 else 0.6)) for i in range(4)],
                footL=(0.24, 0.14 + 0.14 * down + kick * 0.8, kick * 0.6, tp, 0),
                footR=(-0.26, 0.30 + 0.16 * down, 0, tp, 0),
                kneeL=(0.5, -1, 0.3), kneeR=(-0.5, -1, 0.3),
                loL=((0.16, -0.40, 0.98 - 0.1 * down), (0.6, 0.4, -1), 60 * down),
                loR=((-0.16, -0.40, 0.98 - 0.1 * down), (-0.6, 0.4, -1), 60 * down))


def die(t):
    p = die_body(t)
    spread = curve(t, [(0, 0), (0.15, 1), (0.42, 0.4)])
    for S, s in (("L", 1), ("R", -1)):
        rel = ("rel", (s * (0.30 + 0.25 * spread), -0.66 + 0.1 * spread, 1.42 + 0.3 * spread), -32 - 70 * spread,
               (s * 0.8, 0.3, -1))
        if t <= 0.42:
            p["sc" + S] = rel
            continue
        key = "sc" + S
        if key not in _die_cache:
            pose = build(merged(die_body(0.42), **{"sc" + S: ("rel",) + tuple(
                ((s * (0.30 + 0.25 * spread), -0.66 + 0.1 * spread, 1.42 + 0.3 * spread), -32 - 70 * spread,
                 (s * 0.8, 0.3, -1)))}))
            _die_cache[key] = P.world(pose, f"blade.{S}", Vector(mx(SC_WR, s)))
        u = smooth((t - 0.42) / 0.2)
        ground = V(s * 0.46, -0.92 if s > 0 else -0.78, 0.10)
        w = _die_cache[key].lerp(ground, u)
        p["sc" + S] = ("wrist", tuple(w), -84 * u + (-102) * (1 - u), (s * 0.9, 0.2, 0.6), s * 28 * u)
    return p


# ---------------------------------------------------------------- assemble
fps = 30
clips = [
    clip("idle", 72, idle),
    clip("lurk", 90, lurk),
    clip("skitter", SK_F, skitter, step=1, speed=round(2 * SK_HALF / (SK_DUTY * SK_F / fps), 3)),
    clip("climb", CL_F, climb, step=1, speed=round(CL_RISE / (CL_F / fps), 3)),
    clip("leap", 14, leap, loop=False, step=1),
    clip("attack", 51, attack, step=1, swing=0.85),
    clip("hit", 11, hit, loop=False, step=1),
    clip("scream", 36, scream, loop=False, step=1),
    clip("die", 36, die, loop=False, step=1),
]

export_glb(os.path.join(out, "alien.glb"), [arm])
write_meta(out, "alien", {"clips": clips, "sockets": SOCKETS, "bounds": bounds([body])})
print("STATS alien clips", ", ".join(f"{c['name']}:{c['duration']:.2f}s" + (f"@{c['speed']}" if 'speed' in c else "")
                                     for c in clips))

if args.get("preview"):
    pdir = out_dir(args, "preview", "tools/out/previews")
    if not args.get("nosheet"):
        contact_sheet(arm, clips, os.path.join(pdir, "alien.png"), target=(0, -0.1, 0.85), height=2.5, cols=6,
                      tile=220)
    if args.get("hero"):
        clip_name, _, tt = str(args["hero"]).partition("@")
        turnaround(arm, clip_name, float(tt or 0), os.path.join(pdir, f"alien_{clip_name}.png"),
                   target=(0, -0.05, 0.85), height=2.3)
    if args.get("review"):
        names = args.get("clips")
        names = names.split(",") if isinstance(names, str) else None
        yaws = tuple(float(y) for y in str(args.get("yaws", "90,-60")).split(","))
        tag = names[0] if names else "all"
        review_sheet(arm, clips, os.path.join(pdir, f"alien_review_{tag}.png"), target=(0, -0.1, 0.9), height=2.4,
                     yaws=yaws, cols=6, tile=240, names=names)
