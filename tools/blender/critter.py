"""Six-legged scuttling vermin (neutral life form) -> public/assets/models/critter.glb

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/critter.py \
       -- --out public/assets/models [--preview tools/out/previews]

A pale, fat, segmented grub body on six dark spidery legs; small dark head capsule with mandibles
and twitchy antennae. Tripod-gait scurry; dies by flipping onto its back with the legs curling in.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mathutils import Vector  # noqa: E402

from lib.chars import V, Poser, curve, limb, review_sheet, rot_x, rot_y, sampled_clip, shard, smooth, turnaround, wave  # noqa: E402,E501
from lib.common import material, out_dir, part, reset_scene, script_args, sphere, tri_count  # noqa: E402
from lib.export import bounds, export_glb, write_meta  # noqa: E402
from lib.preview import contact_sheet  # noqa: E402
from lib.rig import build_armature, skin  # noqa: E402

args = script_args()
out = out_dir(args)
reset_scene()

M_BASE = material("M_Base", roughness=0.4, metallic=0.0)

GRUB = "#d2c4a2"
GRUB_D = "#b09f80"
GRUB_P = "#c7ab98"
CHITIN = "#2e2624"
LEG = "#1d1819"
MANDIBLE = "#5a3a2a"

# ---------------------------------------------------------------- skeleton
LEGS = [(1, -0.115, -0.07), (2, -0.05, 0.0), (3, 0.02, 0.08)]  # (index, coxa y, splay dy)
bones = [
    ("body", (0, -0.02, 0.12), (0, -0.15, 0.13), None),
    ("head", (0, -0.15, 0.13), (0, -0.25, 0.11), "body"),
    ("abd1", (0, 0.0, 0.13), (0, 0.12, 0.145), "body"),
    ("abd2", (0, 0.12, 0.145), (0, 0.25, 0.125), "abd1"),
]
FOOT = {}
for S, s in (("L", 1), ("R", -1)):
    for i, y, dy in LEGS:
        cox = (s * 0.055, y, 0.105)
        knee = (s * 0.155, y + dy, 0.19)
        foot = (s * 0.27, y + dy * 1.6, 0.012)
        FOOT[f"{i}{S}"] = Vector(foot)
        bones += [(f"fem{i}.{S}", cox, knee, "body"), (f"tib{i}.{S}", knee, foot, f"fem{i}.{S}")]
arm = build_armature("CritterRig", bones)

# ---------------------------------------------------------------- model
parts = []


def add(name, bm, col, bone, jitter=0.07, ao=0.45):
    parts.append(part(name, bm, M_BASE, col, bone, jitter=jitter, ao=ao))


add("Head", sphere(0.055, (0, -0.19, 0.12), seg=8, rings=5, scale=(1.0, 1.1, 0.8)), CHITIN, "head")
for s in (1, -1):
    add(f"Mandible{s}", shard((s * 0.03, -0.23, 0.10), (s * 0.006, -0.30, 0.085), 0.018, 0.02, bend=(s * 0.02, 0, 0),
                              n=2, tip=0.1), MANDIBLE, "head")
    add(f"Antenna{s}", shard((s * 0.025, -0.22, 0.15), (s * 0.10, -0.33, 0.24), 0.008, 0.008, bend=(0, -0.02, 0.03),
                             n=2, tip=0.3), LEG, "head")
add("Thorax", sphere(0.075, (0, -0.07, 0.125), seg=8, rings=5, scale=(1.0, 1.2, 0.75)), GRUB_D, "body")
add("ThoraxPlate", sphere(0.07, (0, -0.075, 0.14), seg=8, rings=4, scale=(0.9, 1.15, 0.6), cut="bottom"), CHITIN,
    "body")
add("Abd1", sphere(0.105, (0, 0.06, 0.135), seg=8, rings=6, scale=(1.0, 0.8, 0.8)), GRUB, "abd1")
add("Abd1b", sphere(0.10, (0, 0.13, 0.14), seg=8, rings=6, scale=(1.0, 0.7, 0.8)), GRUB_P, "abd1")
add("Abd2", sphere(0.09, (0, 0.19, 0.135), seg=8, rings=6, scale=(1.0, 0.75, 0.78)), GRUB, "abd2")
add("Abd2b", sphere(0.065, (0, 0.25, 0.125), seg=8, rings=5, scale=(1.0, 0.8, 0.75)), GRUB_P, "abd2")
for S, s in (("L", 1), ("R", -1)):
    for i, y, dy in LEGS:
        cox = V(s * 0.055, y, 0.105)
        knee = V(s * 0.155, y + dy, 0.19)
        foot = FOOT[f"{i}{S}"]
        add(f"Fem{i}{S}", limb(tuple(cox), tuple(knee), 0.017, 0.013, verts=4, side=(0, 1, 0)), LEG, f"fem{i}.{S}")
        add(f"Tib{i}{S}", shard(tuple(knee), tuple(foot), 0.022, 0.02, bend=tuple((knee - foot).normalized() * 0 +
                                                                                 V(s * 0.02, 0, 0.02)),
                                n=2, tip=0.25), LEG, f"tib{i}.{S}")

body = skin(parts, arm, "Critter")
print("STATS critter tris", tri_count(body))

# ---------------------------------------------------------------- poses
P = Poser(arm)
BODY_HEAD = Vector((0, -0.02, 0.12))
HINGE = {"L": Vector((0, 1, 0)), "R": Vector((0, -1, 0))}
TRIPOD_A = {"1L", "2R", "3L"}


def build(p):
    pose = {}
    pose["body"] = {"rot": p.get("rot", (0, 0, 0))}
    P.set_world(pose, "body", P=BODY_HEAD + Vector(p.get("off", (0, 0, 0))))
    pose["head"] = p.get("head", (0, 0, 0))
    pose["abd1"] = p.get("abd1", (0, 0, 0))
    pose["abd2"] = p.get("abd2", (0, 0, 0))
    feet = p.get("feet", {})
    for S, s in (("L", 1), ("R", -1)):
        for i, _, _ in LEGS:
            key = f"{i}{S}"
            tgt = feet.get(key, FOOT[key])
            if p.get("body_space"):
                M = P.world_matrix(pose, "body")
                tgt = M @ P.rest["body"].inverted() @ Vector(tgt)
            P.ik(pose, f"fem{i}.{S}", f"tib{i}.{S}", Vector(tgt), V(s * 0.3, 0, 1), hinge=HINGE[S])
    return pose


def clip(name, frames, fn, loop=True, step=1, **meta):
    return sampled_clip(arm, P, name, frames, lambda t: build(fn(t)), loop=loop, step=step, **meta)


def idle(t):
    b = wave(t, 2)
    tw = curve(t, [(0, 0), (0.4, 0), (0.44, 12), (0.5, -6), (0.56, 8), (0.62, 0), (1, 0)])
    lift = curve(t, [(0, 0), (0.7, 0), (0.76, 0.05), (0.84, 0), (1, 0)])
    feet = {k: tuple(v) for k, v in FOOT.items()}
    f = FOOT["1L"]
    feet["1L"] = (f.x, f.y - 0.02 * lift / 0.05, f.z + lift)
    return dict(off=(0, 0, 0.004 * b), rot=(0, 0, 3 * wave(t, 1)), head=(tw * 0.5, 0, tw),
                abd1=(2 * b, 0, 3 * wave(t, 1, 0.2)), abd2=(3 * b, 0, 5 * wave(t, 1, 0.1)), feet=feet)


SC_F, SC_HALF, SC_DUTY = 10, 0.16, 0.5


def scurry(t):
    feet = {}
    for key, f in FOOT.items():
        ph = (t + (0.0 if key in TRIPOD_A else 0.5)) % 1.0
        if ph < SC_DUTY:
            s = ph / SC_DUTY
            dy = -SC_HALF + 2 * SC_HALF * s
            up = 0.0
        else:
            s = (ph - SC_DUTY) / (1 - SC_DUTY)
            dy = SC_HALF - 2 * SC_HALF * smooth(s)
            up = 0.06 * math.sin(math.pi * s)
        feet[key] = (f.x * 0.95, f.y + dy, f.z + up)
    w = math.sin(4 * math.pi * t)
    return dict(off=(0.006 * math.sin(2 * math.pi * t), 0, 0.012 + 0.006 * w), rot=(-3, 0, 4 * math.sin(2 * math.pi * t)),
                head=(4 * w, 0, 6 * math.sin(2 * math.pi * t + 1)), abd1=(-2, 0, -6 * math.sin(2 * math.pi * t)),
                abd2=(-3, 0, -9 * math.sin(2 * math.pi * t - 0.6)), feet=feet)


def die(t):
    # .0-.2 rear/spasm, .2-.55 flip onto its back, .55-1 legs curl and twitch
    roll = curve(t, [(0, 0), (0.18, -15), (0.5, 180), (0.58, 172), (1, 180)])
    up = curve(t, [(0, 0), (0.18, 0.02), (0.34, 0.14), (0.5, 0.10), (0.58, 0.07), (1, 0.075)])
    curl = smooth(max(0.0, (t - 0.25) / 0.4))
    twitch = 0.02 * math.sin(40 * t) * max(0.0, 1 - abs(t - 0.75) / 0.2)
    feet = {}
    for key, f in FOOT.items():
        s = 1 if key.endswith("L") else -1
        # in body space: from standing stance to curled up against the belly (belly faces up once flipped)
        stand = Vector(f)
        curled = V(s * 0.12, f.y * 0.7, 0.02 - 0.00)
        p = stand.lerp(curled, curl)
        feet[key] = (p.x, p.y + twitch * (1 if key[0] == "2" else -1), p.z - 0.07 * curl)
    return dict(off=(0, 0, up), rot=(0, roll, 0), body_space=True, head=(curve(t, [(0, 0), (0.2, -25), (1, 18)]), 0, 0),
                abd1=(curve(t, [(0, 0), (0.2, -15), (0.6, 10), (1, 14)]), 0, 0),
                abd2=(curve(t, [(0, 0), (0.2, -20), (0.6, 12), (1, 16)]), 0, 0), feet=feet)


fps = 30
clips = [
    clip("idle", 60, idle, step=2),
    clip("scurry", SC_F, scurry, speed=round(2 * SC_HALF / (SC_DUTY * SC_F / fps), 3)),
    clip("die", 24, die, loop=False),
]

export_glb(os.path.join(out, "critter.glb"), [arm])
write_meta(out, "critter", {"clips": clips, "sockets": [], "bounds": bounds([body])})
print("STATS critter clips", ", ".join(f"{c['name']}:{c['duration']:.2f}s" + (f"@{c['speed']}" if 'speed' in c else "")
                                       for c in clips))

if args.get("preview"):
    pdir = out_dir(args, "preview", "tools/out/previews")
    if not args.get("nosheet"):
        contact_sheet(arm, clips, os.path.join(pdir, "critter.png"), target=(0, 0, 0.12), height=0.8, cols=6,
                      tile=200)
    if args.get("hero"):
        clip_name, _, tt = str(args["hero"]).partition("@")
        turnaround(arm, clip_name, float(tt or 0), os.path.join(pdir, f"critter_{clip_name}.png"),
                   target=(0, 0, 0.12), height=0.7, pitch=20)
    if args.get("review"):
        names = args.get("clips")
        names = names.split(",") if isinstance(names, str) else None
        yaws = tuple(float(y) for y in str(args.get("yaws", "90,-60")).split(","))
        review_sheet(arm, clips, os.path.join(pdir, "critter_review.png"), target=(0, 0, 0.12), height=0.8,
                     yaws=yaws, cols=6, tile=220, names=names, pitch=20)
