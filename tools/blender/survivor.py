"""Civilian survivor NPC (stranded engineer of the derelict) -> public/assets/models/survivor.glb

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/survivor.py \
       -- --out public/assets/models [--preview tools/out/previews] [--review --clips a,b --yaws 90,-60]

Design goals: reads instantly as a human non-combatant next to the marines. Lanky and unarmoured
(1.75 m), bare face under a safety-yellow hard hat with a warm headlamp, a faded hi-vis padded
vest with reflective strips over a work jumpsuit (jumpsuit panels on M_Accent so the engine can
tint them), tool belt with a wrench and hammer, a breather mask hanging at the chest.
Rigid skinning, IK-planted feet and IK hands for the cower / wave poses (see lib/chars.py).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mathutils import Vector  # noqa: E402

from lib.chars import V, Poser, curve, limb, plate, review_sheet, rot_x, rot_y, rot_z, sampled_clip, smooth, turnaround, wave  # noqa: E402,E501
from lib.common import box, cyl, material, out_dir, part, reset_scene, script_args, sphere, tri_count  # noqa: E402
from lib.export import bounds, export_glb, write_meta  # noqa: E402
from lib.preview import contact_sheet  # noqa: E402
from lib.rig import build_armature, skin, socket  # noqa: E402

args = script_args()
out = out_dir(args)
reset_scene()

MATS = {
    "base": material("M_Base", roughness=0.75, metallic=0.05),
    "acc": material("M_Accent", roughness=0.8, metallic=0.0),
    "glow": material("M_Glow", emissive=(1.0, 0.86, 0.62), emissive_strength=5.0),
}

SUIT = "#c6c2b6"       # jumpsuit (M_Accent: engine multiplies by a tint)
SUIT_D = "#a29e92"     # seams, pockets, cuffs on the suit
VEST = "#8a4a22"       # faded hi-vis padded vest
VEST_D = "#6e3a1c"
STRIP = "#c9c7b8"      # reflective strips
SKIN = "#b3876a"
SKIN_D = "#96705a"
HAIR = "#2b211a"
HAT = "#b8912a"        # safety yellow hard hat
HAT_D = "#8f7020"
LEATHER = "#3b2c20"
BOOT = "#2e241c"
GLOVE = "#3b352c"
STEEL = "#6b6f73"
DARK = "#1c1d20"
LAMP = "#fff2d8"

# ---------------------------------------------------------------- skeleton (rest pose)
SH = (0.18, 0.0, 1.41)
EL = (0.18, 0.012, 1.12)
WR = (0.18, 0.0, 0.87)
HT = (0.18, -0.01, 0.78)
HP = (0.095, 0.0, 0.93)
KN = (0.095, -0.012, 0.50)
AN = (0.095, 0.0, 0.085)
TO = (0.095, -0.14, 0.025)
HIPS_HEAD = Vector((0, 0, 0.90))
FIST = 0.05


def mx(p, s):
    return (p[0] * s, p[1], p[2])


bones = [
    ("hips", (0, 0, 0.90), (0, 0, 1.02), None),
    ("spine", (0, 0, 1.02), (0, 0, 1.20), "hips"),
    ("chest", (0, 0, 1.20), (0, 0, 1.44), "spine"),
    ("head", (0, 0, 1.46), (0, 0, 1.70), "chest"),
]
for S, s in (("L", 1), ("R", -1)):
    bones += [
        (f"upper_arm.{S}", mx(SH, s), mx(EL, s), "chest"),
        (f"forearm.{S}", mx(EL, s), mx(WR, s), f"upper_arm.{S}"),
        (f"hand.{S}", mx(WR, s), mx(HT, s), f"forearm.{S}"),
        (f"thigh.{S}", mx(HP, s), mx(KN, s), "hips"),
        (f"shin.{S}", mx(KN, s), mx(AN, s), f"thigh.{S}"),
        (f"foot.{S}", mx(AN, s), mx(TO, s), f"shin.{S}"),
    ]
arm = build_armature("SurvivorRig", bones)

# ---------------------------------------------------------------- model
parts = []


def add(name, bm, col, bone, mat="base", jitter=0.05, ao=0.35):
    parts.append(part(name, bm, MATS[mat], col, bone, jitter=jitter, ao=ao))


# hips: jumpsuit seat + tool belt
add("Seat", box((0.30, 0.20, 0.17), (0, 0.0, 0.95), bevel=0.035), SUIT, "hips", mat="acc")
add("Belt", box((0.315, 0.215, 0.055), (0, 0.0, 1.005), bevel=0.012), LEATHER, "hips")
add("Buckle", box((0.06, 0.02, 0.045), (0, -0.11, 1.005)), STEEL, "hips")
for s in (1, -1):
    add(f"Pouch{s}", box((0.07, 0.06, 0.085), (s * 0.135, -0.055, 0.97), bevel=0.01), LEATHER, "hips")
add("PouchBack", box((0.10, 0.05, 0.07), (0.06, 0.12, 0.975), bevel=0.01), LEATHER, "hips")
add("Wrench", plate((0.165, 0.03, 0.99), (0.17, 0.035, 0.80), 0.015, 0.035), STEEL, "hips")
add("WrenchJaw", box((0.02, 0.06, 0.04), (0.17, 0.035, 0.795)), STEEL, "hips")
add("HammerGrip", limb((-0.165, 0.02, 1.0), (-0.17, 0.03, 0.84), 0.014, verts=5), LEATHER, "hips")
add("HammerHead", box((0.03, 0.10, 0.035), (-0.165, 0.025, 1.015)), STEEL, "hips")

# torso: jumpsuit + padded hi-vis vest
add("Waist", box((0.25, 0.17, 0.20), (0, 0.005, 1.11), bevel=0.03), SUIT, "spine", mat="acc")
add("Torso", box((0.28, 0.18, 0.26), (0, 0.005, 1.31), taper=(1.08, 1.0), bevel=0.035), SUIT, "chest", mat="acc")
add("Vest", box((0.335, 0.235, 0.27), (0, 0.0, 1.285), taper=(1.02, 0.95), bevel=0.045), VEST, "chest", jitter=0.08)
add("VestCollar", limb((0, 0.005, 1.40), (0, 0.01, 1.455), 0.105, 0.085, verts=8), VEST_D, "chest")
for i, z in enumerate((1.205, 1.285)):
    add(f"Strip{i}", box((0.342, 0.242, 0.022), (0, 0.0, z)), STRIP, "chest", ao=0.0)
add("Zip", box((0.012, 0.01, 0.25), (0, -0.119, 1.29)), DARK, "chest")
add("Collar", box((0.20, 0.15, 0.05), (0, 0.01, 1.43), bevel=0.012), SUIT_D, "chest", mat="acc")
add("Badge", box((0.045, 0.012, 0.055), (0.075, -0.122, 1.34)), STRIP, "chest", ao=0.0)
add("Mask", cyl(0.042, 0.05, (-0.02, -0.135, 1.36), rot=(80, 0, -10), verts=8), DARK, "chest")
add("MaskFilter", cyl(0.025, 0.03, (-0.02, -0.17, 1.355), rot=(80, 0, -10), verts=8), STEEL, "chest")
add("MaskStrap", box((0.20, 0.012, 0.012), (0, -0.09, 1.415), rot=(0, 0, 0)), DARK, "chest")

# head: bare human face under a hard hat
add("Neck", limb((0, 0.0, 1.42), (0, 0.0, 1.53), 0.045, verts=6), SKIN, "head")
add("Head", sphere(0.1, (0, -0.005, 1.60), seg=10, rings=7, scale=(0.82, 0.98, 1.1)), SKIN, "head", jitter=0.03)
add("Jaw", box((0.12, 0.11, 0.06), (0, -0.035, 1.525), taper=(0.8, 0.8), bevel=0.015), SKIN, "head")
add("Nose", limb((0, -0.085, 1.605), (0, -0.112, 1.585), 0.016, 0.01, verts=4, twist=45), SKIN_D, "head")
for s in (1, -1):
    add(f"Eye{s}", box((0.026, 0.01, 0.012), (s * 0.034, -0.088, 1.618)), DARK, "head", ao=0.0)
    add(f"Brow{s}", box((0.034, 0.012, 0.01), (s * 0.035, -0.09, 1.636), rot=(0, 0, s * 8)), HAIR, "head", ao=0.0)
    add(f"Ear{s}", box((0.018, 0.035, 0.05), (s * 0.083, 0.0, 1.60)), SKIN_D, "head")
add("Hair", box((0.16, 0.08, 0.10), (0, 0.06, 1.61), bevel=0.02), HAIR, "head")
add("Hat", sphere(0.118, (0, 0.0, 1.655), seg=10, rings=6, cut="bottom", scale=(0.92, 1.05, 0.85)), HAT, "head",
    jitter=0.06)
add("HatBrim", cyl(0.128, 0.014, (0, 0.0, 1.655), verts=10, bevel=0.0), HAT_D, "head")
add("HatPeak", box((0.16, 0.075, 0.014), (0, -0.14, 1.652), rot=(-6, 0, 0)), HAT_D, "head")
add("HatRidge", box((0.03, 0.22, 0.02), (0, 0.0, 1.752)), HAT_D, "head")
add("LampBody", cyl(0.024, 0.04, (0, -0.118, 1.70), rot=(78, 0, 0), verts=8), DARK, "head")
add("Lamp", cyl(0.02, 0.01, (0, -0.14, 1.696), rot=(78, 0, 0), verts=8), LAMP, "head", mat="glow", jitter=0.0, ao=0.0)

# limbs
for S, s in (("L", 1), ("R", -1)):
    X = lambda x: s * x  # noqa: E731
    add(f"UpperArm{S}", limb((X(0.18), 0.0, 1.43), (X(0.18), 0.012, 1.12), 0.055, 0.047, verts=7), SUIT,
        f"upper_arm.{S}", mat="acc")
    add(f"Shoulder{S}", sphere(0.062, (X(0.172), 0.0, 1.40), seg=8, rings=5), SUIT, f"upper_arm.{S}", mat="acc")
    add(f"Elbow{S}", box((0.07, 0.05, 0.06), (X(0.18), 0.04, 1.12)), VEST_D, f"forearm.{S}")
    add(f"Forearm{S}", limb((X(0.18), 0.012, 1.14), (X(0.18), 0.0, 0.89), 0.047, 0.039, verts=7), SUIT,
        f"forearm.{S}", mat="acc")
    add(f"Cuff{S}", limb((X(0.18), 0.003, 0.925), (X(0.18), 0.0, 0.885), 0.045, verts=7), SUIT_D, f"forearm.{S}",
        mat="acc")
    add(f"Glove{S}", box((0.05, 0.075, 0.085), (X(0.18), -0.005, 0.83), bevel=0.012), GLOVE, f"hand.{S}")
    add(f"Thumb{S}", box((0.02, 0.025, 0.045), (X(0.18) - s * 0.02, -0.04, 0.84)), GLOVE, f"hand.{S}")
    add(f"Thigh{S}", limb((X(0.095), 0.0, 0.96), (X(0.095), -0.012, 0.50), 0.088, 0.063, verts=7), SUIT,
        f"thigh.{S}", mat="acc")
    add(f"CargoPocket{S}", box((0.03, 0.10, 0.11), (X(0.172), -0.01, 0.72)), SUIT_D, f"thigh.{S}", mat="acc")
    add(f"KneePad{S}", box((0.085, 0.045, 0.10), (X(0.095), -0.06, 0.50), rot=(-5, 0, 0), bevel=0.012), DARK,
        f"shin.{S}")
    add(f"Shin{S}", limb((X(0.095), -0.012, 0.50), (X(0.095), 0.0, 0.13), 0.06, 0.047, verts=7), SUIT,
        f"shin.{S}", mat="acc")
    add(f"BootCuff{S}", limb((X(0.095), 0.0, 0.19), (X(0.095), 0.0, 0.08), 0.05, 0.052, verts=6), BOOT, f"foot.{S}")
    add(f"Boot{S}", box((0.10, 0.25, 0.085), (X(0.095), -0.045, 0.055), taper=(0.95, 0.8), bevel=0.02), BOOT,
        f"foot.{S}")
    add(f"Sole{S}", box((0.105, 0.26, 0.022), (X(0.095), -0.045, 0.011)), DARK, f"foot.{S}")

body = skin(parts, arm, "Survivor")
print("STATS survivor tris", tri_count(body))
socket("socket_head", arm, "head", (0, 0.0, 2.06))
socket("socket_light", arm, "head", (0, -0.147, 1.695))
SOCKETS = ["socket_head", "socket_light"]

# ---------------------------------------------------------------- pose building
P = Poser(arm)
T0 = Vector((0, -0.17, 0.0))
H0 = Vector((0, 0.07, 0.0))
A0 = Vector((0, 0, 0.085))
FIST_REST = {S: Vector((s * WR[0], WR[1], WR[2] - FIST)) for S, s in (("L", 1), ("R", -1))}
_err = {"max": 0.0}


def ankle(x, ref, pitch, lift=0.0):
    piv = T0 if pitch >= 0 else H0
    a = Vector((x, ref, 0)) + piv + rot_x(pitch) @ (A0 - piv)
    a.z += lift
    return a


def build(p):
    pose = {}
    pose["hips"] = {"rot": p.get("hip_rot", (0, 0, 0))}
    P.set_world(pose, "hips", P=HIPS_HEAD + Vector(p.get("hip", (0, 0, 0))))
    pose["spine"] = p.get("spine", (0, 0, 0))
    pose["chest"] = p.get("chest", (0, 0, 0))
    if "head" in p:
        pose["head"] = p["head"]
    else:
        lk = p.get("look", (0, 0, 0))
        P.set_world(pose, "head", R=rot_z(lk[1]) @ rot_x(lk[0]) @ rot_y(lk[2] if len(lk) > 2 else 0))
    for S, s in (("L", 1), ("R", -1)):
        f = p.get("foot" + S)
        x, ref, pitch, lift, yaw = (list(f) + [0, 0, 0])[:5]
        knee = Vector(p.get("knee" + S, (s * 0.1, -1.0, 0.1)))
        P.ik(pose, f"thigh.{S}", f"shin.{S}", ankle(x, ref, pitch, lift), knee, hinge=(1, 0, 0))
        P.set_world(pose, f"foot.{S}", R=rot_z(yaw) @ rot_x(pitch))
    for S, s in (("L", 1), ("R", -1)):
        h = p.get("hand" + S)
        if h is None:
            a = p.get("arm" + S, ((0, 0, 0), (0, 0, 0), (0, 0, 0)))
            pose[f"upper_arm.{S}"], pose[f"forearm.{S}"], pose[f"hand.{S}"] = a
            continue
        tgt = Vector(h)
        if p.get("hands_rel"):
            M = P.world_matrix(pose, p["hands_rel"])
            tgt = M @ P.rest[p["hands_rel"]].inverted() @ tgt
        P.ik(pose, f"upper_arm.{S}", f"forearm.{S}", tgt, Vector(p.get("elbow" + S, (s * 0.6, 0.4, -0.6))),
             tip=FIST)
        pose[f"hand.{S}"] = p.get("wrist" + S, (0, 0, 0))
        got = P.world(pose, f"hand.{S}", FIST_REST[S])
        _err["max"] = max(_err["max"], (got - tgt).length)
    return pose


def clip(name, frames, fn, loop=True, step=1, **meta):
    _err["max"] = 0.0
    c = sampled_clip(arm, P, name, frames, lambda t: build(fn(t)), loop=loop, step=step, **meta)
    if _err["max"] > 0.03:
        print(f"WARN survivor {name}: hand misses target by {_err['max']:.3f} m")
    return c


def merged(base, **kw):
    d = dict(base)
    d.update(kw)
    return d


def walk_foot(ph, half, duty, lift, y0=0.0, toe=26, heel=-14):
    ph %= 1.0
    if ph < duty:
        s = ph / duty
        return y0 - half + 2 * half * s, curve(s, [(0, heel), (0.18, 0), (0.7, 0), (1.0, toe)]), 0.0
    s = (ph - duty) / (1 - duty)
    ref = y0 + half - 2 * half * smooth(s)
    pitch = curve(s, [(0, toe), (0.35, toe * 0.6), (0.8, heel * 0.7), (1.0, heel)])
    return ref, pitch, lift * math.sin(math.pi * min(1.0, s * 1.1)) ** 0.8


def swing_arm(a, bend=-25, out=6):
    """FK arm swing: a > 0 swings the hand back, a < 0 forward (degrees at the shoulder)."""
    return ((a, 0, out), (bend - max(0.0, -a) * 0.5, 0, 0), (0, 0, 0))


STAND = dict(hip=(0, 0, -0.02), hip_rot=(2, 0, 0), spine=(4, 0, 0), chest=(6, 0, 0), look=(-4, 0, 0),
             footL=(0.12, -0.04, 0, 0, -8), footR=(-0.11, 0.06, 0, 0, 10))


# ---------------------------------------------------------------- clips
def idle(t):
    """Nervous: hunched, wringing hands at the belly, darting glances, weight shifting."""
    b = wave(t, 3)
    look = curve(t, [(0, 0), (0.12, 0), (0.16, -38), (0.34, -38), (0.38, 30), (0.55, 30), (0.59, -12), (0.66, -12),
                     (0.70, 42), (0.84, 42), (0.90, 0), (1, 0)])
    tilt = curve(t, [(0, 0), (0.16, 6), (0.38, -4), (0.70, 8), (0.9, 0), (1, 0)])
    shift = wave(t, 1)
    wring = 0.012 * math.sin(2 * math.pi * 6 * t)
    return merged(STAND, hip=(0.015 * shift, 0, -0.02 + 0.004 * b), hip_rot=(2, look * 0.08, 2 * shift),
                  spine=(5, look * 0.12, -shift), chest=(8 - 1.5 * b, look * 0.15, 0), look=(-4 + tilt * 0.3, look, tilt),
                  handL=(0.04 + wring, -0.19, 1.13), handR=(-0.04 - wring, -0.19, 1.14 + wring),
                  elbowL=(0.8, 0.5, -0.3), elbowR=(-0.8, 0.5, -0.3), wristL=(-20, 0, -30), wristR=(-20, 0, 30))


WALK_HALF, WALK_DUTY, WALK_F = 0.34, 0.5, 24


def walk(t):
    fL = walk_foot(t, WALK_HALF, WALK_DUTY, 0.13)
    fR = walk_foot(t + 0.5, WALK_HALF, WALK_DUTY, 0.13)
    c = math.cos(2 * math.pi * t)
    sn = math.sin(2 * math.pi * t)
    bob = -math.cos(4 * math.pi * t)
    hz = -0.085 + 0.025 * bob
    glance = 12 * math.sin(2 * math.pi * t + 0.8)
    return dict(hip=(0.02 * sn, 0, hz), hip_rot=(4, -8 * c, 3 * sn), spine=(5, 5 * c, -1.5 * sn),
                chest=(7, 6 * c, -sn), look=(-2, glance, 0),
                footL=(0.10, fL[0], fL[1], fL[2], -4), footR=(-0.10, fR[0], fR[1], fR[2], 4),
                armL=swing_arm(24 * c), armR=swing_arm(-24 * c))


RUN_HALF, RUN_DUTY, RUN_F, RUN_Y0 = 0.33, 0.33, 18, 0.08


def run(t):
    """Panicked sprint: leaning in, arms flailing wide, head thrown about."""
    fL = walk_foot(t, RUN_HALF, RUN_DUTY, 0.30, y0=RUN_Y0, toe=40, heel=-8)
    fR = walk_foot(t + 0.5, RUN_HALF, RUN_DUTY, 0.30, y0=RUN_Y0, toe=40, heel=-8)
    c = math.cos(2 * math.pi * t)
    sn = math.sin(2 * math.pi * t)
    bob = -math.cos(4 * math.pi * (t - RUN_DUTY / 2))
    hz = -0.05 + 0.035 * bob
    flail = math.sin(2 * math.pi * t + 0.6)
    return dict(hip=(0.02 * sn, 0.04, hz), hip_rot=(12, -10 * c, 4 * sn), spine=(8, 8 * c, -2 * sn),
                chest=(4, 9 * c, -2 * sn), look=(-8, 10 * flail, 6 * flail),
                footL=(0.09, fL[0], fL[1], fL[2], -3), footR=(-0.09, fR[0], fR[1], fR[2], 3),
                kneeL=(0.1, -1, 0.3), kneeR=(-0.1, -1, 0.3),
                armL=((60 * c - 8, 0, 18 + 14 * flail), (-60 - 20 * max(0, -c), 0, 0), (0, 0, 0)),
                armR=((-60 * c - 8, 0, -18 + 14 * flail), (-60 - 20 * max(0, c), 0, 0), (0, 0, 0)))


def cower(t):
    """Crouched hiding: sat on the heels, knees up, back curled, forearms wrapped over the helmet,
    trembling."""
    tr = math.sin(2 * math.pi * 14 * t)          # fast tremble
    br = wave(t, 2)
    return dict(hip=(0.004 * tr, 0.06, -0.62 + 0.006 * br), hip_rot=(8 + 1.5 * tr, 0, 0), spine=(26, 0, 0),
                chest=(28 + 2 * br, 0, 1.2 * tr), look=(70 + 2 * tr, 0, 0),
                footL=(0.14, -0.06, 18, 0, -14), footR=(-0.14, -0.02, 18, 0, 14),
                kneeL=(0.25, -1, 0.6), kneeR=(-0.25, -1, 0.6),
                hands_rel="head", handL=(0.07, 0.03 + 0.006 * tr, 1.77), handR=(-0.07, 0.05 - 0.006 * tr, 1.76),
                elbowL=(0.7, -1, -0.2), elbowR=(-0.7, -1, -0.2), wristL=(-40, 0, 0), wristR=(-40, 0, 0))


def wave_clip(t):
    """One-shot 'over here!': both arms up waving big crossing arcs overhead, bouncing on the toes."""
    up = curve(t, [(0, 0), (0.12, 1), (0.82, 1), (1, 0)])
    w = math.sin(2 * math.pi * 3.2 * t)
    bounce = abs(math.sin(2 * math.pi * 3.2 * t)) * up
    base = merged(STAND, hip=(0, 0.02, -0.02 + 0.04 * bounce), hip_rot=(-2 * up, 0, 3 * w * up),
                  spine=(4 - 6 * up, 0, 0), chest=(6 - 10 * up, 6 * w * up, 0), look=(-4 - 16 * up, 8 * w * up, 0),
                  footL=(0.12, -0.04, 12 * bounce, 0, -8), footR=(-0.11, 0.06, 12 * bounce, 0, 10))
    down = {"L": V(0.19, -0.02, 0.83), "R": V(-0.19, -0.02, 0.83)}
    for S, s in (("L", 1), ("R", -1)):
        high = V(s * (0.26 - 0.20 * w * s), -0.12, 1.86 + 0.05 * abs(w))
        base["hand" + S] = tuple(down[S].lerp(high, up))
        base["elbow" + S] = (s * 1.0, 0.2, -0.3)
        base["wrist" + S] = (0, 0, -s * 25 * w * up)
    return base


def hit(t):
    k = curve(t, [(0, 0), (0.15, 1), (0.4, 0.75), (1, 0)])
    return merged(STAND, hip=(0, 0.06 * k, -0.02 - 0.03 * k), hip_rot=(2 - 8 * k, 6 * k, 4 * k), spine=(4 - 10 * k, 0, 3 * k),
                  chest=(6 - 14 * k, 10 * k, 4 * k), look=(-4 - 22 * k, 16 * k, 10 * k),
                  footR=(-0.11, 0.06 + 0.10 * k, 0, 0.04 * math.sin(math.pi * min(1, t * 2.5)), 10),
                  armL=((-40 * k, 0, 20 * k), (-70 * k, 0, 0), (0, 0, 0)),
                  armR=((-30 * k, 0, -25 * k), (-80 * k, 0, 0), (0, 0, 0)))


def die(t):
    """Clutches the chest, knees buckle, twists and falls onto the back, arms flung out."""
    fall = curve(t, [(0, 2), (0.15, 12), (0.42, 20), (0.62, -40), (0.78, -86), (0.86, -80), (1, -84)])
    hz = curve(t, [(0, -0.02), (0.15, -0.06), (0.42, -0.40), (0.62, -0.60), (0.78, -0.77), (0.86, -0.73), (1, -0.76)])
    hy = curve(t, [(0, 0), (0.42, -0.08), (0.62, 0.10), (0.78, 0.28), (1, 0.30)])
    twist = curve(t, [(0, 0), (0.42, 25), (0.78, 12), (1, 10)])
    pitch = curve(t, [(0, 0), (0.15, 0), (0.42, 40), (0.62, 20), (0.78, -60), (1, -70)])
    refL = curve(t, [(0, -0.04), (0.42, -0.02), (0.62, -0.20), (0.78, -0.55), (1, -0.58)])
    refR = curve(t, [(0, 0.06), (0.42, 0.08), (0.62, -0.10), (0.78, -0.35), (1, -0.40)])
    liftR = curve(t, [(0, 0), (0.78, 0.0), (0.86, 0.06), (1, 0.04)])
    p = dict(hip=(0, hy, hz), hip_rot=(fall, twist, 6 * smooth(t)), spine=(curve(t, [(0, 4), (0.15, 16), (0.42, 22),
                                                                                   (0.78, -4), (1, -2)]), 0, 0),
             chest=(curve(t, [(0, 6), (0.15, 18), (0.42, 20), (0.78, -6), (1, -4)]), 0, 0),
             head=(curve(t, [(0, 0), (0.15, 20), (0.5, 10), (0.78, -30), (0.86, -10), (1, -18)]),
                   curve(t, [(0, 0), (0.7, 0), (0.9, 40), (1, 38)]), 0),
             footL=(0.13, refL, pitch, 0, -10), footR=(-0.13, refR, pitch * 0.8, liftR, 14),
             kneeL=(0.2, -1, 0.4), kneeR=(-0.2, -1, 0.4))
    grab = curve(t, [(0, 0), (0.15, 1), (0.5, 1)])
    fling = curve(t, [(0.5, 0), (0.8, 1)])
    Mc = P.world_matrix(build(dict(p)), "chest")
    Rc = P.rest["chest"].inverted()
    ground = {"L": V(0.36, 1.10, 0.05), "R": V(-0.52, 0.62, 0.05)}
    for S, s in (("L", 1), ("R", -1)):
        hang = Mc @ Rc @ V(s * 0.19, -0.02, 0.83)
        clutch = Mc @ Rc @ V(s * 0.05, -0.17, 1.30)
        tgt = hang.lerp(clutch, grab).lerp(ground[S], fling) + V(0, 0, 0.18 * math.sin(math.pi * fling))
        p["hand" + S] = tuple(tgt)
        p["elbow" + S] = tuple(V(s * 0.8, 0.4, -0.3).lerp(V(s * 0.6, 0.0, 1.0), fling))
    return p


fps = 30
clips = [
    clip("cower", 60, cower),
    clip("idle", 90, idle, step=2),
    clip("walk", WALK_F, walk, speed=round(2 * WALK_HALF / (WALK_DUTY * WALK_F / fps), 3)),
    clip("run", RUN_F, run, speed=round(2 * RUN_HALF / (RUN_DUTY * RUN_F / fps), 3)),
    clip("wave", 45, wave_clip, loop=False),
    clip("hit", 12, hit, loop=False),
    clip("die", 40, die, loop=False),
]

export_glb(os.path.join(out, "survivor.glb"), [arm])
write_meta(out, "survivor", {"clips": clips, "sockets": SOCKETS, "bounds": bounds([body])})
print("STATS survivor clips", ", ".join(f"{c['name']}:{c['duration']:.2f}s" + (f"@{c['speed']}" if 'speed' in c else "")
                                        for c in clips))

if args.get("preview"):
    pdir = out_dir(args, "preview", "tools/out/previews")
    if not args.get("nosheet"):
        contact_sheet(arm, clips, os.path.join(pdir, "survivor.png"), target=(0, -0.1, 0.9), height=2.3, cols=6,
                      tile=220)
    if args.get("hero"):
        clip_name, _, tt = str(args["hero"]).partition("@")
        turnaround(arm, clip_name, float(tt or 0), os.path.join(pdir, f"survivor_{clip_name}.png"),
                   target=(0, -0.05, 0.9), height=2.0)
    if args.get("review"):
        names = args.get("clips")
        names = names.split(",") if isinstance(names, str) else None
        yaws = tuple(float(y) for y in str(args.get("yaws", "90,-60")).split(","))
        review_sheet(arm, clips, os.path.join(pdir, f"survivor_review_{(names or ['all'])[0]}.png"),
                     target=(0, -0.1, 0.9), height=2.3, yaws=yaws, cols=6, tile=240, names=names)
