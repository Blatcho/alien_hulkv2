"""Power-armoured squad marine: base body + 4 loadouts, stance clips, sockets -> marine.glb

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/marine.py \
       -- --out public/assets/models [--preview tools/out/previews] [--review --clips a,b --yaws 90,-60]

Build notes
  * Rigid skinning: every armour piece is weighted 100% to one bone. The mesh is split into
    `marine_base` plus variant meshes (`var_helmet_*`, `var_pads_*`, `var_pack_*`, `var_weapon_*`)
    that all share the one armature, so the engine toggles `.visible` per trooper (see
    marine_kit.py and the "variants"/"loadouts" meta).
  * The weapon lives on its own bone ('gun', child of 'chest') with a 'mag' child bone for reloads.
    Every weapon shares the same grip / fore-end / magazine points, so the IK-solved hands work
    for all four. Clips place the weapon in world space per stance:
      CASUAL  lowered diagonal carry, muzzle ~45 deg down, relaxed
      ALERT   hip level, muzzle level, slight crouch, head scanning
      ENGAGED shouldered at eye level, head down on the sights, braced
  * Shoulder pads ride on 'pad.L/R' bones that follow a fraction of the upper-arm swing.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import marine_kit as K  # noqa: E402
from lib.chars import (V, Poser, curve, lineup, paint_camo, review_sheet, rot_x, rot_y, rot_z,  # noqa: E402
                       sampled_clip, smooth, turnaround, wave)
from lib.common import material, out_dir, part, reset_scene, script_args, tri_count, weather  # noqa: E402
from lib.export import bounds, export_glb, write_meta  # noqa: E402
from lib.preview import contact_sheet  # noqa: E402
from lib.rig import build_armature, skin, socket  # noqa: E402

args = script_args()
out = out_dir(args)
reset_scene()

MATS = {
    "base": material("M_Base", roughness=0.72, metallic=0.3),   # battered, matte ceramite
    "acc": material("M_Accent", roughness=0.62, metallic=0.35),
    "glow": material("M_Glow", emissive=(1.0, 0.1, 0.05), emissive_strength=6.0),
    "power": material("M_Power", emissive=(0.45, 0.75, 1.0), emissive_strength=5.0),  # power fields
}

# ---------------------------------------------------------------- skeleton (rest pose)
SH, EL, WR, HT, HP, KN, AN, TO, G0 = K.SH, K.EL, K.WR, K.HT, K.HP, K.KN, K.AN, K.TO, K.G0
HIPS_HEAD = Vector((0, 0, 1.02))
FIST = 0.055                  # wrist -> fist centre


def mx(p, s):
    return (p[0] * s, p[1], p[2])


bones = [
    ("hips", (0, 0, 1.02), (0, 0, 1.20), None),
    ("spine", (0, 0, 1.20), (0, 0, 1.40), "hips"),
    ("chest", (0, 0, 1.40), (0, 0, 1.66), "spine"),
    ("head", (0, 0, 1.68), (0, 0, 1.92), "chest"),
]
for S, s in (("L", 1), ("R", -1)):
    bones += [
        (f"pad.{S}", mx(SH, s), mx((SH[0], SH[1], SH[2] + 0.2), s), "chest"),
        (f"upper_arm.{S}", mx(SH, s), mx(EL, s), "chest"),
        (f"forearm.{S}", mx(EL, s), mx(WR, s), f"upper_arm.{S}"),
        (f"hand.{S}", mx(WR, s), mx(HT, s), f"forearm.{S}"),
        (f"thigh.{S}", mx(HP, s), mx(KN, s), "hips"),
        (f"shin.{S}", mx(KN, s), mx(AN, s), f"thigh.{S}"),
        (f"foot.{S}", mx(AN, s), mx(TO, s), f"shin.{S}"),
    ]
bones += [
    ("gun", tuple(G0), tuple(G0 + Vector((0, -0.2, 0))), "chest"),
    ("mag", tuple(G0 + Vector((0, -0.13, -0.01))), tuple(G0 + Vector((0, -0.13, -0.2))), "gun"),
    ("spin", K.SPIN[0], K.SPIN[1], "gun"),   # the minigun's barrel cluster (the game spins it)
]
arm = build_armature("MarineRig", bones)

# ---------------------------------------------------------------- model: base + variant meshes
groups = {}


# Soft or dark materials don't chip back to bare metal - they only take the grime.
NO_CHIP = {K.LEATHER, K.CLOTH, K.BLACK, K.DARK, K.PARCHMENT, K.WAX}


def adder(group):
    def add(name, bm, col, bone, mat="base", jitter=0.05, ao=0.35, camo=False):
        obj = part(f"{group}.{name}", bm, MATS[mat], col, bone, jitter=jitter, ao=ao)
        if camo:
            paint_camo(obj, K.CAMO)
        if mat not in ("glow", "power"):
            soft = col in NO_CHIP
            weather(obj, chip=0.0 if soft else 0.7, fleck=0.0 if soft else 0.03, scorch=0.03 if soft else 0.06)
        groups.setdefault(group, []).append(obj)
    return add


K.build_base(adder("marine_base"))
VARIANTS = {"helmet": K.HELMETS, "pads": K.PADS, "pack": K.PACKS, "weapon": K.WEAPONS, "melee": K.MELEE}
for kind, names in VARIANTS.items():
    for n in names:
        K.BUILDERS[kind][n](adder(f"var_{kind}_{n}"))

meshes = {name: skin(objs, arm, name) for name, objs in groups.items()}
tris = {name: tri_count(o) for name, o in meshes.items()}
for name, n in tris.items():
    print(f"STATS marine {name} tris {n}")
for lo in K.LOADOUTS:
    n = tris["marine_base"] + sum(tris[f"var_{k}_{lo[k]}"] for k in VARIANTS if k in lo)
    print(f"STATS marine loadout {lo['name']} tris {n}")
print("STATS marine file tris", sum(tris.values()))

socket("socket_eye", arm, "head", (0, -0.16, 1.838))
socket("socket_head", arm, "head", (0, 0.0, 2.28))
SOCKETS = ["socket_muzzle", "socket_light", "socket_eye", "socket_head"]
socket("socket_muzzle", arm, "gun", K.WEAPON_SOCKETS["carbine"][0])
socket("socket_light", arm, "gun", K.WEAPON_SOCKETS["carbine"][1])
for w, (muzzle, light) in K.WEAPON_SOCKETS.items():
    socket(f"socket_muzzle_{w}", arm, "gun", muzzle)
    socket(f"socket_light_{w}", arm, "gun", light)
    SOCKETS += [f"socket_muzzle_{w}", f"socket_light_{w}"]

# ---------------------------------------------------------------- pose building
P = Poser(arm)
FIST_REST = {S: Vector((s * WR[0], WR[1], WR[2] - FIST)) for S, s in (("L", 1), ("R", -1))}
GRIP = {"R": Vector(K.GRIP_R), "L": Vector(K.GRIP_L)}
MAG_BOTTOM = Vector(K.MAG_BOTTOM)
T0 = Vector((0, -0.22, 0.0))   # toe pivot (relative to ankle ground projection)
H0 = Vector((0, 0.11, 0.0))    # heel pivot
A0 = Vector((0, 0, 0.14))
ELBOW = {"L": (0.7, 0.15, -0.7), "R": (-0.7, 0.45, -0.55)}
_err = {"max": 0.0}


def ankle(x, ref, pitch, lift=0.0):
    """Ankle position for a boot whose flat-footed ankle projection is (x, ref); pitch > 0
    rolls onto the toes (heel up), pitch < 0 onto the heel (toes up)."""
    piv = T0 if pitch >= 0 else H0
    a = Vector((x, ref, 0)) + piv + rot_x(pitch) @ (A0 - piv)
    a.z += lift
    return a


def grot(r):
    """(pitch, yaw, roll) -> world rotation; pitch > 0 dips the muzzle."""
    return rot_z(r[1]) @ rot_x(r[0]) @ rot_y(r[2] if len(r) > 2 else 0)


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
    # legs: planted/IK feet or explicit angles
    for S, s in (("L", 1), ("R", -1)):
        f = p.get("foot" + S)
        if f is None:
            for b in ("thigh", "shin", "foot"):
                pose[f"{b}.{S}"] = p.get("legs", {}).get(f"{b}.{S}", (0, 0, 0))
            continue
        x, ref, pitch, lift, yaw = (list(f) + [0, 0, 0])[:5]
        knee = Vector(p.get("knee" + S, (s * 0.12, -1.0, 0.1)))
        P.ik(pose, f"thigh.{S}", f"shin.{S}", ankle(x, ref, pitch, lift), knee, hinge=(1, 0, 0))
        P.set_world(pose, f"foot.{S}", R=rot_z(yaw) @ rot_x(pitch))
    # weapon
    if "gun_local" in p:
        pose["gun"] = p["gun_local"]
    elif "gun_M" in p:
        gp, gr = p["gun_M"]
        P.set_world(pose, "gun", R=gr, P=Vector(gp))
    else:
        gp, gr = p["gun"]
        P.set_world(pose, "gun", R=grot(gr), P=Vector(gp))
    if "mag_M" in p:
        mp, mr = p["mag_M"]
        P.set_world(pose, "mag", R=mr, P=Vector(mp))
    else:
        pose["mag"] = p.get("mag", (0, 0, 0))
    # arms
    for S in ("L", "R"):
        h = p.get("hand" + S, "grip")
        if h is None:
            for b in ("upper_arm", "forearm", "hand"):
                pose[f"{b}.{S}"] = p.get("arms", {}).get(f"{b}.{S}", (0, 0, 0))
        else:
            if isinstance(h, str) and h == "grip":
                tgt = P.world(pose, "gun", GRIP[S])
            elif isinstance(h, str) and h == "mag":
                tgt = P.world(pose, "mag", MAG_BOTTOM)
            else:
                tgt = Vector(h)
            P.ik(pose, f"upper_arm.{S}", f"forearm.{S}", tgt, Vector(p.get("elbow" + S, ELBOW[S])), tip=FIST)
            if "hand_rot" + S in p:
                pose[f"hand.{S}"] = p["hand_rot" + S]
            got = P.world(pose, f"hand.{S}", FIST_REST[S])
            _err["max"] = max(_err["max"], (got - tgt).length)
        P.follow(pose, f"pad.{S}", f"upper_arm.{S}", 0.22, lift=0.02, max_deg=p.get("pad_max", 16))
    return pose


def clip(name, frames, fn, loop=True, step=2, **meta):
    _err["max"] = 0.0
    c = sampled_clip(arm, P, name, frames, lambda t: build(fn(t)), loop=loop, step=step, **meta)
    if _err["max"] > 0.03:
        print(f"WARN marine {name}: hand misses target by {_err['max']:.3f} m")
    return c


def merged(base, **kw):
    d = dict(base)
    d.update(kw)
    return d


def lerp3(a, b, t):
    return Vector(a).lerp(Vector(b), t)


# ---------------------------------------------------------------- stances
CASUAL_GUN = ((-0.12, -0.27, 1.14), (45, 38, 0))
ALERT_GUN = ((-0.13, -0.40, 1.07), (0, 5, 0))
ENGAGED_GUN = ((-0.11, -0.50, 1.54), (0, 2, 0))

CASUAL = dict(hip=(0.01, 0.0, -0.025), hip_rot=(1, -3, 1), spine=(1, -2, 0), chest=(0, -3, -1), look=(4, 0, 0),
              gun=CASUAL_GUN, footL=(0.18, -0.08, 0, 0, -8), footR=(-0.17, 0.10, 0, 0, 12),
              elbowL=(0.8, 0.3, -0.6), elbowR=(-0.6, 0.5, -0.7))
ALERT = dict(hip=(0, 0.02, -0.075), hip_rot=(5, -7, 0), spine=(4, -6, 0), chest=(3, -7, 0), look=(-2, 0, 0),
             gun=ALERT_GUN, footL=(0.20, -0.14, 0, 0, -8), footR=(-0.19, 0.15, 0, 0, 16))
ENGAGED = dict(hip=(0, 0.03, -0.07), hip_rot=(4, -8, 0), spine=(4, -6, 0), chest=(5, -6, 0), look=(22, 0, 0),
               gun=ENGAGED_GUN, footL=(0.21, -0.16, 0, 0, -10), footR=(-0.19, 0.18, 0, 0, 18),
               elbowL=(0.6, 0.1, -1.0), elbowR=(-1.0, 0.2, 0.1))
KNEEL = dict(hip=(0.02, 0.06, -0.57), hip_rot=(4, -12, 0), spine=(5, -4, 0), chest=(2, -6, 0),
             footL=(0.21, -0.36, 0, 0, -10), footR=(-0.17, 0.52, 62, 0, 10),
             kneeL=(0.25, -1, 0.5), kneeR=(-0.1, -0.5, -1.0))
READY = ALERT


def gun_off(gun, dp=(0, 0, 0), dr=(0, 0, 0)):
    (p, r) = gun
    return (tuple(p[i] + dp[i] for i in range(3)), tuple(r[i] + dr[i] for i in range(3)))


def breathe(t, cycles=1):
    return wave(t, cycles)


# ---------------------------------------------------------------- locomotion helpers
def walk_foot(ph, half, duty, lift, y0=0.0, toe=28, heel=-14):
    """Foot track for a walk/run cycle; ph = 0 at heel strike (foot forward)."""
    ph %= 1.0
    if ph < duty:
        s = ph / duty
        ref = y0 - half + 2 * half * s
        pitch = curve(s, [(0, heel), (0.18, 0), (0.7, 0), (1.0, toe)])
        return ref, pitch, 0.0
    s = (ph - duty) / (1 - duty)
    ref = y0 + half - 2 * half * smooth(s)
    pitch = curve(s, [(0, toe), (0.35, toe * 0.6), (0.8, heel * 0.7), (1.0, heel)])
    up = lift * math.sin(math.pi * min(1.0, s * 1.1)) ** 0.8
    return ref, pitch, up


def gait(ph, half, duty, lift, hz0, bob_amp, twist=7.0, sway=0.025, x=0.17, toe=28, heel=-14):
    """Legs + pelvis for one stride phase ph in [0,1). Returns (pose dict, cos, sin, bob, hz)."""
    fL = walk_foot(ph, half, duty, lift, toe=toe, heel=heel)
    fR = walk_foot(ph + 0.5, half, duty, lift, toe=toe, heel=heel)
    c = math.cos(2 * math.pi * ph)
    sn = math.sin(2 * math.pi * ph)
    bob = -math.cos(4 * math.pi * ph)          # -1 at heel strikes, +1 mid-stance
    hz = hz0 + bob_amp * bob
    d = dict(hip=(sway * sn, 0.0, hz), footL=(x, fL[0], fL[1], fL[2], -4), footR=(-x, fR[0], fR[1], fR[2], 4))
    return d, c, sn, bob, hz


WALK_HALF, WALK_DUTY, WALK_F = 0.43, 0.5, 30
WALK_SPEED = round(2 * WALK_HALF / (WALK_DUTY * WALK_F / 30), 3)


# ---------------------------------------------------------------- CASUAL
def idle_casual(t):
    b = breathe(t, 2)
    yaw = curve(t, [(0, 0), (0.25, 0), (0.36, 22), (0.55, 22), (0.66, -12), (0.84, -12), (0.94, 0), (1, 0)])
    shift = wave(t, 1)
    return merged(CASUAL, hip=(0.012 * shift, 0.0, -0.025 + 0.005 * b), hip_rot=(1, -3, 1.5 * shift),
                  chest=(-0.8 * b, -3, -1 - shift), look=(6, yaw, 3 * shift),
                  gun=gun_off(CASUAL_GUN, (0, 0, 0.008 * b), (1.5 * b, 0, 0)))


def walk_casual(t):
    d, c, sn, bob, hz = gait(t, WALK_HALF, WALK_DUTY, 0.16, -0.08, 0.028)
    return merged(CASUAL, **d, hip_rot=(2, -7 * c, 3 * sn), spine=(2, 5 * c, -1.5 * sn),
                  chest=(2 + 1.5 * -bob, 6 * c - 3, -sn), look=(4, 5 * math.sin(2 * math.pi * t + 1), 0),
                  gun=gun_off(CASUAL_GUN, (0.012 * sn, 0, 0.7 * (hz + 0.08)), (2 * c, 0, 0)))


# ---------------------------------------------------------------- ALERT
def idle_alert(t):
    b = breathe(t, 2)
    scan = curve(t, [(0, -4), (0.15, -26), (0.40, -26), (0.55, 18), (0.80, 18), (0.95, -4), (1, -4)])
    return merged(ALERT, hip=(0, 0.02, -0.075 + 0.005 * b), chest=(3 - b, -7 + scan * 0.12, 0),
                  look=(-3, scan, 0), gun=gun_off(ALERT_GUN, (0, 0, 0.006 * b), (0, scan * 0.3, 0)))


def walk_alert(t):
    ph = (2 * t) % 1.0                           # two strides per loop (one head sweep)
    d, c, sn, bob, hz = gait(ph, WALK_HALF, WALK_DUTY, 0.16, -0.10, 0.03)
    scan = 20 * math.sin(2 * math.pi * t)
    lean = 11 + 2 * -bob
    return merged(ALERT, **d, hip_rot=(5, -7 * c, 3 * sn), spine=(lean * 0.4, 5 * c - 3, -1.5 * sn),
                  chest=(lean * 0.4, 6 * c - 7, -sn), look=(-2, scan, 0),
                  gun=gun_off(ALERT_GUN, (0.01 * sn, -0.02, 0.7 * (hz + 0.10) + 0.008 * bob), (0, 1.5 * c + 0.2 * scan, 0)))


KNEEL_ALERT_GUN = ((-0.13, -0.42, 0.62), (0, 5, 0))


def crouch_alert(t):
    b = breathe(t, 1)
    scan = curve(t, [(0, 0), (0.2, -18), (0.45, -18), (0.65, 14), (0.85, 14), (1, 0)])
    return merged(KNEEL, chest=(2 - 1.5 * b, -6, 0), look=(-4, scan, 0),
                  gun=gun_off(KNEEL_ALERT_GUN, (0, 0, 0.006 * b), (0, scan * 0.25, 0)))


CW_HALF, CW_DUTY, CW_F = 0.30, 0.62, 33


def crouch_walk(t):
    """Hunched sneak: deep knees, torso pitched ~48 deg so the helmet and pads pass under 1.3 m."""
    fL = walk_foot(t, CW_HALF, CW_DUTY, 0.10, y0=0.03, toe=18, heel=-8)
    fR = walk_foot(t + 0.5, CW_HALF, CW_DUTY, 0.10, y0=0.03, toe=18, heel=-8)
    c = math.cos(2 * math.pi * t)
    sn = math.sin(2 * math.pi * t)
    bob = -math.cos(4 * math.pi * t)
    hz = -0.54 + 0.015 * bob
    return dict(
        hip=(0.03 * sn, 0.12, hz), hip_rot=(24, -6 * c, 2.5 * sn),
        spine=(14, 4 * c, -1.5 * sn), chest=(10, 5 * c - 4, 0),
        look=(-8, 0, 0),
        footL=(0.21, fL[0], fL[1], fL[2], -8), footR=(-0.21, fR[0], fR[1], fR[2], 8),
        kneeL=(0.45, -1, 0.1), kneeR=(-0.45, -1, 0.1),
        gun=((-0.10, -0.50, 0.74 + 0.6 * (hz + 0.54)), (10, 6, 0)),
    )


# ---------------------------------------------------------------- ENGAGED
def aim(t):
    b = breathe(t, 1)
    sway = wave(t, 1, 0.25)
    return merged(ENGAGED, chest=(5 - 0.8 * b, -6, 0),
                  gun=gun_off(ENGAGED_GUN, (0.005 * sway, 0, 0.006 * b), (0.5 * b, 0.7 * sway, 0)))


WA_HALF, WA_DUTY, WA_F = 0.30, 0.56, 27


def walk_aim(t):
    """Slow tactical advance, rifle shouldered and steady, knees soft, minimal bob."""
    d, c, sn, bob, hz = gait(t, WA_HALF, WA_DUTY, 0.11, -0.11, 0.012, twist=3, sway=0.012, x=0.18, toe=20,
                             heel=-10)
    return merged(ENGAGED, **d, hip_rot=(5, -8 - 3 * c, 2 * sn), spine=(4, 2 * c, -sn), chest=(5, -6 + 1.5 * c, -0.5 * sn),
                  look=(22, 0, 0), gun=gun_off(ENGAGED_GUN, (0.004 * sn, 0, 0.35 * (hz + 0.11)), (0, 0, 0)))


def recoil(t, kicks=3):
    """One sharp kick per round: 3 kicks per 0.4 s loop = 7.5 rounds/s (engine fires 8/s in bursts)."""
    u = (t * kicks) % 1.0
    return curve(u, [(0, 1.0), (0.12, 0.8), (0.55, 0.12), (1.0, 0.0)])


def shoot(t):
    k = recoil(t)
    return merged(ENGAGED, spine=(4 - 1.0 * k, -6, 0), chest=(5 - 2.5 * k, -6, 0), look=(22 - 3 * k, 0, 0),
                  hip=(0, 0.03 + 0.012 * k, -0.07),
                  gun=gun_off(ENGAGED_GUN, (0, 0.05 * k, 0.012 * k), (-6 * k, 0, 0)))


KNEEL_AIM_GUN = ((-0.11, -0.50, 0.99), (0, 3, 0))
KNEEL_AIM = merged(KNEEL, hip_rot=(6, -12, 0), spine=(6, -4, 0), chest=(5, -6, 0), look=(22, 0, 0),
                   elbowL=(0.6, 0.1, -1.0), elbowR=(-1.0, 0.2, 0.1))


def crouch_aim(t):
    b = breathe(t, 1)
    return merged(KNEEL_AIM, chest=(5 - 1.2 * b, -6, 0),
                  gun=gun_off(KNEEL_AIM_GUN, (0, 0, 0.006 * b), (0.5 * b, 0.5 * wave(t, 1, 0.25), 0)))


def crouch_shoot(t):
    k = recoil(t)
    return merged(KNEEL_AIM, chest=(5 - 2.5 * k, -6, 0), look=(22 - 3 * k, 0, 0),
                  gun=gun_off(KNEEL_AIM_GUN, (0, 0.05 * k, 0.012 * k), (-6 * k, 0, 0)))


AIM_UP_GUN = ((-0.10, -0.40, 1.40), (-55, 3, 0))


def aim_up(t):
    """Covering a ladder shaft overhead: rifle raised ~55 deg, weight back, head up."""
    b = breathe(t, 1)
    sway = wave(t, 1, 0.25)
    return merged(ENGAGED, hip=(0, 0.05, -0.06), hip_rot=(-2, -7, 0), spine=(-4, -5, 0), chest=(-6 - b, -5, 0),
                  look=(-40, 3 * sway, 0), elbowR=(-1.0, 0.3, -0.3), elbowL=(0.7, 0.2, -0.8),
                  gun=gun_off(AIM_UP_GUN, (0.006 * sway, 0, 0.006 * b), (0.8 * b, 1.5 * sway, 0)))


AIM_DOWN_GUN = ((-0.10, -0.50, 0.82), (50, 3, 0))


def aim_down(t):
    """Kneeling at a hatch edge covering the deck below: rifle ~50 deg down and forward."""
    b = breathe(t, 1)
    sway = wave(t, 1, 0.25)
    return merged(KNEEL, hip_rot=(16, -10, 0), spine=(12, -4, 0), chest=(8 - b, -5, 0), look=(50, 3 * sway, 0),
                  elbowR=(-1.0, 0.3, 0.2), elbowL=(0.8, 0.0, -0.6),
                  gun=gun_off(AIM_DOWN_GUN, (0.005 * sway, 0, 0.005 * b), (0.8 * b, 1.5 * sway, 0)))


def signal(t):
    """One-shot closed-fist 'hold / clear' signal with the off hand; weapon stays at the hip."""
    up = curve(t, [(0, 0), (0.12, 0), (0.32, 1), (0.74, 1), (0.92, 0), (1, 0)])
    pump = curve(t, [(0.32, 0), (0.42, 1), (0.50, 0), (0.58, 1), (0.66, 0)])
    base = merged(ALERT, look=(-4, 12 * up, 0), chest=(3, -7 + 6 * up, 0), pad_max=16 + 14 * up,
                  gun=gun_off(ALERT_GUN, (-0.02 * up, 0.02 * up, -0.01 * up), (5 * up, -3 * up, 0)))
    if up <= 0.0:
        base["handL"] = "grip"
        return base
    fore = P.world(build(merged(base, handL=None)), "gun", GRIP["L"])
    fist = V(0.40, -0.32, 1.97 + 0.05 * pump)
    arc = V(0.12, 0.05, 0.0) * math.sin(math.pi * up)
    base["handL"] = tuple(fore.lerp(fist, up) + arc)
    base["elbowL"] = tuple(V(ELBOW["L"]).lerp(V(0.9, -0.1, -0.5), up))
    return base


# ---------------------------------------------------------------- run (port arms) and traversal
RUN_HALF, RUN_DUTY, RUN_F, RUN_Y0 = 0.40, 0.35, 21, 0.10


def run(t):
    fL = walk_foot(t, RUN_HALF, RUN_DUTY, 0.34, y0=RUN_Y0, toe=40, heel=-10)
    fR = walk_foot(t + 0.5, RUN_HALF, RUN_DUTY, 0.34, y0=RUN_Y0, toe=40, heel=-10)
    c = math.cos(2 * math.pi * t)
    sn = math.sin(2 * math.pi * t)
    bob = -math.cos(4 * math.pi * (t - RUN_DUTY / 2))   # low at mid-stance
    hz = -0.055 + 0.04 * bob
    return dict(
        hip=(0.02 * sn, 0.05, hz), hip_rot=(8, -9 * c, 3 * sn),
        spine=(7, 7 * c, -2 * sn), chest=(6 + 2 * bob, 8 * c - 4, -1.5 * sn),
        look=(-4, 0, 0),
        footL=(0.16, fL[0], fL[1], fL[2], -3), footR=(-0.16, fR[0], fR[1], fR[2], 3),
        kneeL=(0.1, -1, 0.3), kneeR=(-0.1, -1, 0.3),
        gun=((-0.08 + 0.012 * sn, -0.45, 1.22 + 0.8 * (hz + 0.055) + 0.015 * bob), (-12, 22 + 3 * c, 0)),
    )


def reload(t):
    tilt = curve(t, [(0, 0), (0.12, 1), (0.82, 1), (0.95, 0)])
    roll = curve(t, [(0, 0), (0.12, -34), (0.62, -34), (0.70, -22), (0.80, -30), (0.95, 0)])
    gp, gr = ALERT_GUN
    gun = (tuple(lerp3(gp, (-0.07, -0.36, 1.17), tilt)), (gr[0] - 18 * tilt, gr[1] + 16 * tilt, roll))
    base = merged(READY, gun=gun, look=(-2 + 28 * tilt, 12 * tilt, 0), chest=(3 + 4 * tilt, -7, 0))
    # magazine drops out of the well (.22-.34), goes to the belt and back (.34-.62), seats (.62-.70)
    drop = curve(t, [(0, 0), (0.22, 0), (0.34, 0.2), (0.62, 0.2), (0.70, 0), (1, 0)])
    base["mag"] = {"rot": (0, 0, 0), "loc": (0, drop, 0)}
    away = curve(t, [(0.34, 0), (0.45, 1), (0.51, 1), (0.62, 0)])
    if away > 0:
        pose = build(merged(base, handL=None))
        Mm = P.world_matrix(pose, "mag")
        q0 = (Mm.to_3x3() @ P.rest["mag"].to_3x3().inverted()).to_quaternion()
        q1 = rot_z(25).to_quaternion()
        base["mag_M"] = (Mm.translation.lerp(V(0.19, -0.17, 1.20), away), q0.slerp(q1, away).to_matrix())
    if t < 0.12:
        base["handL"] = "grip"
    elif t < 0.22:
        pose = build(merged(base, handL=None))
        a = P.world(pose, "gun", GRIP["L"])
        m = P.world(pose, "mag", MAG_BOTTOM) + V(0, 0, -0.02)
        base["handL"] = tuple(lerp3(a, m, smooth((t - 0.12) / 0.10)))
    elif t < 0.70:
        base["handL"] = "mag"
    elif t < 0.95:
        # palm the mag home, rack the charging handle, back to the fore-end
        pose = build(merged(base, handL=None))
        m = P.world(pose, "mag", MAG_BOTTOM) + V(0, 0, -0.02)
        ch = P.world(pose, "gun", Vector(K.CHARGING))
        fore = P.world(pose, "gun", GRIP["L"])
        pts = [(0.70, m), (0.78, ch), (0.84, ch + V(0, 0.09, 0)), (0.95, fore)]
        base["handL"] = tuple(curve(t, [(a, tuple(b)) for a, b in pts]))
        base["elbowL"] = (0.8, 0.3, -0.5)
    else:
        base["handL"] = "grip"
    return base


def jump(t):
    # 0-.22 crouch, .22-.36 push off, .36-.72 tuck in the air, .72-.85 land, .85-1 recover
    hz = curve(t, [(0, -0.075), (0.2, -0.24), (0.34, 0.02), (0.5, 0.0), (0.72, -0.02), (0.82, -0.26), (1, -0.075)])
    lift = curve(t, [(0, 0), (0.3, 0), (0.42, 0.28), (0.6, 0.34), (0.74, 0.02), (0.78, 0)])
    lean = curve(t, [(0, 8), (0.2, 16), (0.34, 2), (0.55, 8), (0.8, 16), (1, 8)])
    toe = curve(t, [(0, 0), (0.24, 0), (0.34, 38), (0.5, 25), (0.72, -4), (0.78, 0)])
    fwdL = curve(t, [(0, -0.14), (0.3, -0.12), (0.55, -0.24), (0.74, -0.16), (1, -0.14)])
    fwdR = curve(t, [(0, 0.15), (0.3, 0.13), (0.55, 0.02), (0.74, 0.10), (1, 0.15)])
    gz = curve(t, [(0, 1.07), (0.2, 1.00), (0.34, 1.20), (0.55, 1.18), (0.82, 0.98), (1, 1.07)])
    gpitch = curve(t, [(0, 0), (0.2, 10), (0.4, -12), (0.6, -4), (0.82, 12), (1, 0)])
    return merged(READY, hip=(0, 0.02, hz), hip_rot=(lean * 0.5, -7, 0), spine=(lean * 0.4, -6, 0),
                  chest=(lean * 0.3, -7, 0), look=(3 - lean * 0.4, 0, 0),
                  footL=(0.20, fwdL, toe, lift * 1.1, -8), footR=(-0.19, fwdR, toe, lift, 16),
                  gun=((-0.13, -0.42, gz), (gpitch, 5, 0)))


RUNG = 0.35
CLIMB_F = 22
CLIMB_RISE = 3 * RUNG            # ladder travel per cycle


def _slung():
    """Weapon mag-locked upright on the left flank of the backpack, muzzle up and leaning in
    (clear of every pack variant; local pose relative to the chest)."""
    pose = {}
    R = rot_y(-16) @ rot_x(-90) @ rot_y(-90)
    centre = V(0.41, 0.33, 1.36)
    P.set_world(pose, "gun", R=R, P=centre - R @ V(0, -0.28, 0.05))
    return pose["gun"]


SLUNG = _slung()


def climb_track(ph, top, bottom, duty=0.62):
    """Grip point height on the ladder: stuck to a rung (moving down) then reaching up."""
    ph %= 1.0
    if ph < duty:
        return top + (bottom - top) * (ph / duty), 0.0
    s = (ph - duty) / (1 - duty)
    return bottom + (top - bottom) * smooth(s), math.sin(math.pi * s)


def climb(t):
    span = CLIMB_RISE * 0.62
    hl, al = climb_track(t, 2.02, 2.02 - span)
    hr, ar = climb_track(t + 0.5, 2.02, 2.02 - span)
    fl, bl = climb_track(t + 0.5, 0.78, 0.78 - span)
    fr, br = climb_track(t, 0.78, 0.78 - span)
    sn = math.sin(2 * math.pi * t)
    return dict(
        hip=(0.03 * sn, 0.02, -0.05), hip_rot=(6, 0, 3 * sn), spine=(-2, 0, -2 * sn), chest=(-4, 0, -2 * sn),
        look=(-22, 6 * sn, 0),
        footL=(0.16, -0.22 + 0.10 * bl, 18, fl - 0.14 + 0.04 * bl, 0),
        footR=(-0.16, -0.22 + 0.10 * br, 18, fr - 0.14 + 0.04 * br, 0),
        kneeL=(0.6, -1, 0.1), kneeR=(-0.6, -1, 0.1),
        gun_local=SLUNG,
        handL=(0.22, -0.46 + 0.13 * al, hl), handR=(-0.22, -0.46 + 0.13 * ar, hr),
        elbowL=(1, 0.3, -0.4), elbowR=(-1, 0.3, -0.4),
    )


def interact(t):
    a = 2 * math.pi * t
    reach = V(0.08 + 0.08 * math.sin(a), -0.62 + 0.05 * math.sin(2 * a), 0.78 + 0.07 * math.cos(a))
    return merged(READY, hip=(0, 0.10, -0.16), hip_rot=(16, -4, 0), spine=(15, 0, 0),
                  chest=(10 + 2 * math.sin(2 * a), 3, 0), look=(38, 8 * math.sin(a), 0),
                  footL=(0.19, -0.16, 0, 0, -6), footR=(-0.18, 0.16, 0, 0, 14),
                  gun=((-0.26, -0.24, 0.98), (64, -10, -8)),
                  handL=tuple(reach), elbowL=(0.9, 0.2, -0.3), elbowR=(-0.9, 0.4, -0.2))


def hit(t):
    k = curve(t, [(0, 0), (0.12, 1), (0.35, 0.8), (1, 0)])
    return merged(ALERT, hip=(0, 0.02 + 0.05 * k, -0.075 - 0.04 * k), hip_rot=(5 - 8 * k, -7, 3 * k),
                  spine=(4 - 8 * k, -6, 2 * k), chest=(3 - 12 * k, -7 + 6 * k, 3 * k), look=(-2 - 16 * k, 10 * k, 5 * k),
                  gun=gun_off(ALERT_GUN, (0, 0.08 * k, 0.06 * k), (-18 * k, 8 * k, 6 * k)),
                  footR=(-0.19, 0.15 + 0.05 * k, 0, 0.03 * math.sin(math.pi * min(1, t * 2.5)), 16))


def bash(t):
    """One-shot shove (sim/melee.js): a short lunge driving the weapon's stock into whatever is in
    his face, then back into the alert stance."""
    k = curve(t, [(0, 0), (0.2, 0.35), (0.38, 1), (0.55, 0.9), (1, 0)])
    return merged(ALERT, hip=(0, -0.07 * k, -0.075 - 0.03 * k), hip_rot=(5 + 6 * k, -7 + 8 * k, 0),
                  spine=(4 + 8 * k, -6 + 6 * k, 0), chest=(3 + 12 * k, -7 + 12 * k, -4 * k), look=(-2 + 6 * k, 0, 0),
                  gun=gun_off(ALERT_GUN, (0.02 * k, -0.18 * k, 0.05 * k), (24 * k, -10 * k, 0)),
                  footR=(-0.19, 0.15 - 0.14 * k, 0, 0.04 * math.sin(math.pi * min(1.0, t * 3)), 16))


def slash(t):
    """One-shot power-sword cut (sim/melee.js): the pistol stays on target in the right hand while
    the left winds up over the shoulder and brings the blade down and across in front of him, the
    body turning into it, then back to the guard."""
    base = merged(ALERT)
    turn = curve(t, [(0, 0), (0.3, -1), (0.5, 1), (0.65, 0.9), (1, 0)])
    k = curve(t, [(0, 0), (0.3, 0.3), (0.5, 1), (0.65, 0.9), (1, 0)])
    base.update(hip=(0, -0.06 * k, -0.075 - 0.03 * k), hip_rot=(5 + 5 * k, -7 - 10 * turn, 0),
                spine=(4 + 6 * k, -6 - 8 * turn, 0), chest=(3 + 10 * k, -7 - 16 * turn, 0), look=(-2 + 8 * k, 0, 0),
                pad_max=30, footR=(-0.19, 0.15 - 0.12 * k, 0, 0.04 * math.sin(math.pi * min(1.0, t * 2.5)), 16))
    guard = P.world(build(merged(base, handL=None)), "gun", GRIP["L"])
    path = [(0, guard), (0.30, V(0.34, 0.12, 2.02)), (0.42, V(0.30, -0.42, 1.80)), (0.52, V(0.10, -0.70, 1.15)),
            (0.66, V(-0.02, -0.52, 0.98)), (1, guard)]
    for (t0, a), (t1, b) in zip(path, path[1:]):
        if t0 <= t <= t1:
            base["handL"] = tuple(a.lerp(b, smooth((t - t0) / (t1 - t0))))
            break
    flex = curve(t, [(0, 0), (0.30, -25), (0.42, 0), (0.52, 50), (0.66, 60), (1, 0)])
    base["hand_rotL"] = (flex, 0, 0)
    base["elbowL"] = tuple(V(ELBOW["L"]).lerp(V(0.9, 0.3, 0.4), curve(t, [(0, 0), (0.3, 1), (0.55, 0.2), (1, 0)])))
    return base


def punch(t):
    """One-shot power-fist blow (sim/melee.js): the right fist drives straight out from the guard
    at chest height, the shoulder and hips turning in behind it, then back to the guard."""
    k = curve(t, [(0, 0), (0.18, -0.2), (0.38, 1), (0.52, 1), (1, 0)])
    base = merged(ALERT, hip=(0, -0.08 * max(0, k), -0.075 - 0.03 * max(0, k)), hip_rot=(5 + 6 * k, -7 + 12 * k, 0),
                  spine=(4 + 6 * k, -6 + 10 * k, 0), chest=(3 + 8 * k, -7 + 22 * k, 0), look=(-2 + 4 * k, -10 * k, 0),
                  pad_max=30, footR=(-0.19, 0.15 - 0.16 * max(0, k), 0, 0.05 * math.sin(math.pi * min(1.0, t * 2.6)), 16))
    guard = P.world(build(merged(base, handR=None)), "gun", GRIP["R"])
    out = V(-0.10, -0.92, 1.42)
    base["handR"] = tuple(guard.lerp(out, max(0.0, k)))
    base["elbowR"] = tuple(V(ELBOW["R"]).lerp(V(-1.0, 0.4, 0.1), max(0.0, k)))
    return base


_die_cache = {}


def die_body(t):
    """Collapse: .12 jolt back, .40 on the knees, .62 toppling, .80 face down, .88 bounce, 1 settled."""
    fall = curve(t, [(0, 5), (0.12, -8), (0.40, 10), (0.62, 48), (0.80, 90), (0.88, 85), (1, 88)])
    hz = curve(t, [(0, -0.075), (0.12, -0.03), (0.40, -0.52), (0.62, -0.56), (0.80, -0.77), (0.88, -0.73),
                   (1, -0.765)])
    hy = curve(t, [(0, 0.02), (0.12, 0.05), (0.40, -0.20), (0.62, -0.35), (0.80, -0.55), (1, -0.56)])
    bend = curve(t, [(0, 0), (0.12, -10), (0.40, 20), (0.62, 14), (0.80, 0), (1, 3)])
    pitch = curve(t, [(0, 0), (0.12, 4), (0.40, 50), (0.62, 60), (0.80, 108), (1, 110)])
    refL = curve(t, [(0, -0.14), (0.12, -0.12), (0.40, 0.33), (0.62, 0.40), (0.80, 0.70), (1, 0.72)])
    refR = curve(t, [(0, 0.15), (0.12, 0.14), (0.40, 0.37), (0.62, 0.44), (0.80, 0.74), (1, 0.78)])
    return dict(hip=(0, hy, hz), hip_rot=(fall, -7 * (1 - t), 4 * t),
                spine=(4 + bend, -6 * (1 - t), 0), chest=(3 + bend * 0.8, -7 * (1 - t), 0),
                head=(curve(t, [(0, 0), (0.12, -22), (0.45, 25), (0.8, -20), (0.88, -8), (1, -14)]),
                      curve(t, [(0, 0), (0.66, 0), (0.85, 42), (1, 40)]), 0),
                footL=(0.20, refL, pitch, 0, -8 + 12 * t), footR=(-0.19, refR, pitch * 0.95, 0, 16 - 22 * t),
                kneeL=(0.15, -1, -0.5), kneeR=(-0.15, -1, -0.5))


def die(t):
    p = die_body(t)
    if t < 0.42:
        p["gun_local"] = READY_GUN
    else:
        if "gun" not in _die_cache:
            pose = build(merged(die_body(0.42), gun_local=READY_GUN))
            M = P.world_matrix(pose, "gun")
            _die_cache["gun"] = (M.translation.copy(),
                                 (M.to_3x3() @ P.rest["gun"].to_3x3().inverted()).to_quaternion())
        p0, q0 = _die_cache["gun"]
        drop = curve(t, [(0.42, 0), (0.64, 1), (0.70, 0.9), (0.76, 1)])
        u = smooth((t - 0.42) / 0.26)
        p1 = V(-0.50, -0.90, 0.075)
        q1 = grot((0, 35, 90)).to_quaternion()
        p["gun_M"] = (p0.lerp(p1, drop), q0.slerp(q1, u).to_matrix())
    for S, s, rel, ground in (("R", -1, 0.42, V(-0.42, -1.45, 0.07)), ("L", 1, 0.30, V(0.46, -0.45, 0.07))):
        if t < rel:
            p["hand" + S] = "grip"
            continue
        key = "hand" + S
        if key not in _die_cache:
            pose = build(merged(die_body(rel), gun_local=READY_GUN))
            _die_cache[key] = P.world(pose, "gun", GRIP[S])
        u = smooth((t - rel) / (0.80 - rel))
        p["hand" + S] = tuple(_die_cache[key].lerp(ground, u) + V(0, 0, 0.25 * math.sin(math.pi * u)))
        k = smooth((t - rel) / 0.3)
        p["elbow" + S] = tuple(V(ELBOW[S]).lerp(V(s * 0.7, 0.0, 0.8), k))
    return p


READY_GUN = build(READY)["gun"]

# ---------------------------------------------------------------- assemble clips
fps = 30
clips = [
    clip("idle_casual", 72, idle_casual),
    clip("walk_casual", WALK_F, walk_casual, speed=WALK_SPEED),
    clip("run", RUN_F, run, step=1, speed=round(2 * RUN_HALF / (RUN_DUTY * RUN_F / fps), 3)),
    clip("idle_alert", 90, idle_alert),
    clip("walk_alert", 2 * WALK_F, walk_alert, speed=WALK_SPEED),
    clip("crouch_alert", 72, crouch_alert),
    clip("crouch_walk", CW_F, crouch_walk, speed=round(2 * CW_HALF / (CW_DUTY * CW_F / fps), 3)),
    clip("aim", 60, aim),
    clip("walk_aim", WA_F, walk_aim, speed=round(2 * WA_HALF / (WA_DUTY * WA_F / fps), 3)),
    clip("shoot", 12, shoot, step=1),
    clip("crouch_aim", 60, crouch_aim),
    clip("crouch_shoot", 12, crouch_shoot, step=1),
    clip("aim_up", 60, aim_up),
    clip("aim_down", 60, aim_down),
    clip("signal", 36, signal, loop=False, step=1),
    clip("reload", 66, reload, loop=False, step=1),
    clip("jump", 20, jump, loop=False, step=1),
    clip("climb", CLIMB_F, climb, step=1, speed=round(CLIMB_RISE / (CLIMB_F / fps), 3)),
    clip("interact", 48, interact),
    clip("hit", 12, hit, loop=False, step=1),
    clip("bash", 14, bash, loop=False, step=1),
    clip("slash", 18, slash, loop=False, step=1),
    clip("punch", 14, punch, loop=False, step=1),
    clip("die", 42, die, loop=False, step=1),
]

export_glb(os.path.join(out, "marine.glb"), [arm])
# bounds of the bulkiest loadout (heavy); the command comms mast is a thin whip and would inflate the height
bound_meshes = [meshes["marine_base"]] + [meshes[f"var_{k}_{K.LOADOUTS[1][k]}"] for k in VARIANTS if k in K.LOADOUTS[1]]
write_meta(out, "marine", {
    "clips": clips,
    "sockets": SOCKETS,
    "nodes": list(meshes.keys()),
    "variants": {k: list(v) for k, v in VARIANTS.items()},
    "loadouts": K.LOADOUTS,
    "bounds": bounds(bound_meshes),
})
print("STATS marine clips", ", ".join(f"{c['name']}:{c['duration']:.2f}s" + (f"@{c['speed']}" if 'speed' in c else "")
                                      for c in clips))


# ---------------------------------------------------------------- previews
def show_loadout(lo):
    """Preview only: hide every variant mesh except those of loadout `lo` (None = base only)."""
    for name, obj in meshes.items():
        if name == "marine_base":
            obj.hide_render = False
            continue
        kind, _, var = name[4:].partition("_")
        obj.hide_render = lo is None or lo.get(kind) != var


STANCE_CLIPS = ["idle_casual", "walk_casual", "idle_alert", "walk_alert", "crouch_alert", "aim", "walk_aim",
                "crouch_aim", "aim_up", "aim_down", "signal"]

if args.get("preview"):
    pdir = out_dir(args, "preview", "tools/out/previews")
    show_loadout(K.LOADOUTS[0])
    if not args.get("nosheet"):
        contact_sheet(arm, clips, os.path.join(pdir, "marine.png"), target=(0, 0, 1.0), height=2.8, cols=6, tile=170)
        review_sheet(arm, clips, os.path.join(pdir, "marine_stances.png"), target=(0, -0.2, 1.05), height=2.6,
                     yaws=(90,), cols=6, tile=200, names=STANCE_CLIPS)
        lineup(arm, "idle_alert", 0.0, os.path.join(pdir, "marine_loadouts.png"),
               [lambda lo=lo: show_loadout(lo) for lo in K.LOADOUTS], yaws=(35, 90), target=(0, -0.2, 1.1),
               height=2.7, tile=420)
    if args.get("hero"):
        clip_name, _, tt = str(args["hero"]).partition("@")
        lo = next((x for x in K.LOADOUTS if x["name"] == args.get("loadout")), K.LOADOUTS[0])
        show_loadout(lo)
        turnaround(arm, clip_name, float(tt or 0), os.path.join(pdir, f"marine_{clip_name}_{lo['name']}.png"),
                   target=(0, -0.2, 1.05), height=2.5)
    if args.get("lineup"):
        clip_name, _, tt = str(args["lineup"]).partition("@")
        yaws = tuple(float(y) for y in str(args.get("yaws", "35,90")).split(","))
        lineup(arm, clip_name, float(tt or 0), os.path.join(pdir, f"marine_lineup_{clip_name}.png"),
               [lambda lo=lo: show_loadout(lo) for lo in K.LOADOUTS], yaws=yaws, target=(0, -0.2, 1.1),
               height=2.7, tile=360)
    if args.get("review"):
        names = args.get("clips")
        names = names.split(",") if isinstance(names, str) else None
        yaws = tuple(float(y) for y in str(args.get("yaws", "90,-60")).split(","))
        lo = next((x for x in K.LOADOUTS if x["name"] == args.get("loadout")), K.LOADOUTS[0])
        show_loadout(lo)
        tag = names[0] if names else "all"
        review_sheet(arm, clips, os.path.join(pdir, f"marine_review_{tag}.png"), target=(0, -0.2, 1.0), height=2.6,
                     yaws=yaws, cols=6, tile=240, names=names)
    show_loadout(None)
    for obj in meshes.values():
        obj.hide_render = False
