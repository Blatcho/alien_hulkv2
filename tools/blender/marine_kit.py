"""Marine geometry kit (imported by marine.py; not an asset script itself).

The marine is one armature with a BASE body mesh plus swappable variant meshes, all rigidly
skinned to the same bones, so the engine can toggle `.visible` per trooper:

  helmet  command | heavy | breacher | marksman      (bone: head)
  pads    command | heavy | breacher | marksman      (bones: pad.L / pad.R, chest)
  pack    command | heavy | breacher | marksman      (bone: chest)
  weapon  carbine | heavy | breacher | marksman | pistol | minigun   (bones: gun, mag, spin)
          fists                                     (bones: hand.L/R, forearm.L/R - no gun)
  melee   sword                                     (bone: hand.L)

Every weapon is modelled around the SAME pistol grip, fore-end and magazine points on the gun bone
(GRIP_R / GRIP_L / MAG_BOTTOM), so one set of IK-solved clips drives all of them. The bolt pistol
sits in the right fist alone, leaving the left free for the power sword; the power fists replace
the gun outright (the hands still hold the invisible gun's grips: a boxer's guard); the minigun's
barrel cluster rides its own 'spin' bone so the game can spin it up.
Every `build_*` function takes `add(name, bmesh, colour, bone, mat="base"|"acc"|"glow", ...)`.
"""
import math

import bmesh
from mathutils import Euler, Matrix, Vector

from lib.chars import arc_band, lathe, limb, plate, shell
from lib.common import box, cyl, prism, sphere

# ---------------------------------------------------------------- palette
# Grim and battered: dark, desaturated ceramite, tarnished brass, grimy trim (marine.py then
# chips the edges back to metal, grimes the legs and scorches the plates - lib/common.weather).
OLIVE = "#40472f"
OLIVE_D = "#323827"
OLIVE_L = "#4c533a"
BRASS = "#7d6232"
BLACK = "#16181a"
DARK = "#23262a"
LEATHER = "#2e2a22"
GUN = "#2c3034"
GUN_D = "#202326"
RED = "#5c1a17"
ACCENT = "#bdb6a4"
LENS = "#e8e4c8"
GLOW = "#ff3a22"
POWER = "#bfe6ff"   # power-field glow (sword edges, gauntlet coils): the M_Power material
STEEL = "#7d8790"
HAZARD = "#b8912a"
CLOTH = "#431818"
PARCHMENT = "#c4b48a"
WAX = "#7a1712"
CAMO = ["#454d34", "#3a3f2a", "#5c5238", "#2d3124", "#615c42"]

# ---------------------------------------------------------------- skeleton reference (rest pose)
SH = (0.265, -0.05, 1.52)     # shoulder joint (left; right mirrors x)
EL = (0.265, -0.03, 1.17)     # elbow
WR = (0.265, -0.04, 0.83)     # wrist
HT = (0.265, -0.04, 0.73)     # hand tip
HP = (0.15, 0.0, 1.10)        # hip joint
KN = (0.15, -0.015, 0.62)     # knee
AN = (0.15, 0.0, 0.14)        # ankle
TO = (0.15, -0.19, 0.05)      # foot tip
G0 = Vector((-0.10, -0.48, 1.16))   # weapon pistol-grip origin (rest)


def g(x, y, z):
    """Gun-local offset (x right->left, y back->front is negative, z up) -> rest world point."""
    return tuple(G0 + Vector((x, y, z)))


GRIP_R = g(0, 0.025, -0.06)        # right fist centre on the pistol grip
GRIP_L = g(0, -0.25, -0.03)        # left fist centre under the fore-end
MAG_BOTTOM = g(0, -0.15, -0.21)    # where the off hand grabs the magazine
CHARGING = g(0.10, -0.03, 0.09)    # charging handle on the left of the receiver

HELMETS = ["command", "heavy", "breacher", "marksman"]
PADS = ["command", "heavy", "breacher", "marksman"]
PACKS = ["command", "heavy", "breacher", "marksman"]
WEAPONS = ["carbine", "heavy", "breacher", "marksman", "pistol", "minigun", "fists"]
MELEE = ["sword"]
LOADOUTS = [
    {"name": "command", "helmet": "command", "pads": "command", "pack": "command", "weapon": "carbine"},
    {"name": "heavy", "helmet": "heavy", "pads": "heavy", "pack": "heavy", "weapon": "heavy"},
    {"name": "breacher", "helmet": "breacher", "pads": "breacher", "pack": "breacher", "weapon": "breacher"},
    {"name": "marksman", "helmet": "marksman", "pads": "marksman", "pack": "marksman", "weapon": "marksman"},
    {"name": "duelist", "helmet": "command", "pads": "breacher", "pack": "marksman", "weapon": "pistol",
     "melee": "sword"},
    {"name": "brawler", "helmet": "breacher", "pads": "heavy", "pack": "breacher", "weapon": "fists"},
    {"name": "gunner", "helmet": "heavy", "pads": "heavy", "pack": "heavy", "weapon": "minigun"},
]
FIST_L = (WR[0], WR[1], WR[2] - 0.055)   # left fist centre at rest (hand hanging, grip axis along Y)

# muzzle and flashlight-lens positions per weapon (rest world coords, parented to the gun bone)
WEAPON_SOCKETS = {
    "carbine": (g(0, -0.745, 0.09), g(0, -0.545, -0.03)),
    "heavy": (g(0, -0.90, 0.075), g(0, -0.62, -0.035)),
    "breacher": (g(0, -0.625, 0.105), g(0.075, -0.52, 0.10)),
    "marksman": (g(0, -1.10, 0.075), g(0, -0.645, -0.005)),
    "pistol": (g(0, -0.33, 0.10), g(0, -0.245, 0.03)),
    "minigun": (g(0, -0.90, 0.08), g(0, -0.40, 0.20)),
    "fists": (g(0, -0.10, 0.0), g(0, -0.10, 0.0)),   # no muzzle; the lamp rides between the fists
}
SPIN = (g(0, -0.30, 0.08), g(0, -0.50, 0.08))   # the minigun barrel cluster's bone (child of gun)


def xrot(bm, center, rot):
    """Rotate a bmesh about `center` by Euler degrees (XYZ)."""
    m = Euler([math.radians(a) for a in rot], "XYZ").to_matrix()
    bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(center), matrix=m)
    return bm


def sides():
    return (("L", 1), ("R", -1))


def oath_seal(add, name, at, bone, face=(90, 0, 0), strips=(-0.012, 0.014), length=0.14, drop=(0, -0.006, 0)):
    """A blood-red wax seal pressed onto the armour with parchment strips hanging below it.
    `at` = seal centre, `face` = rotation turning the disc to face out of the plate."""
    add(f"{name}Wax", cyl(0.032, 0.016, at, rot=face, verts=8), WAX, bone, jitter=0.12)
    for i, dx in enumerate(strips):
        top = (at[0] + dx, at[1] + drop[1], at[2] - 0.015)
        bottom = (top[0] + dx * 0.4, top[1] + drop[1] * 2, top[2] - length * (1.0 - 0.18 * i))
        add(f"{name}Strip{i}", plate(top, bottom, 0.026, 0.006), PARCHMENT, bone, jitter=0.14, ao=0.2)


# ---------------------------------------------------------------- base body
def build_base(add):
    # pelvis / belt
    add("Pelvis", box((0.34, 0.27, 0.20), (0, 0.0, 1.06), bevel=0.03), DARK, "hips")
    add("Codpiece", box((0.17, 0.07, 0.17), (0, -0.14, 1.03), taper=(1.4, 1.0), bevel=0.02), OLIVE, "hips")
    add("Belt", box((0.41, 0.31, 0.075), (0, 0.0, 1.155), bevel=0.015), LEATHER, "hips")
    add("Buckle", box((0.10, 0.03, 0.07), (0, -0.162, 1.155)), BRASS, "hips")
    add("BackPlate", box((0.30, 0.07, 0.17), (0, 0.15, 1.07), bevel=0.02), OLIVE_D, "hips")
    for s in (1, -1):
        add(f"Pouch{s}", box((0.08, 0.06, 0.09), (s * 0.135, -0.155, 1.125), bevel=0.012), LEATHER, "hips")
        add(f"Tasset{s}", box((0.05, 0.23, 0.22), (s * 0.265, -0.01, 1.05), rot=(0, -s * 10, 0), bevel=0.018),
            OLIVE_D, "hips")
    # abdomen
    add("Abdomen", box((0.32, 0.25, 0.24), (0, 0.01, 1.30), bevel=0.03), DARK, "spine")
    for z in (1.235, 1.30, 1.365):
        add(f"Rib{z}", box((0.345, 0.27, 0.026), (0, 0.01, z)), BLACK, "spine")
    add("AbPlate", box((0.21, 0.06, 0.18), (0, -0.13, 1.30), taper=(1.15, 1.0), bevel=0.02), OLIVE, "spine")
    # chest core + collar
    add("Cuirass", box((0.46, 0.34, 0.30), (0, 0.0, 1.51), taper=(1.16, 1.08), bevel=0.045), OLIVE, "chest")
    add("Plastron", box((0.42, 0.14, 0.25), (0, -0.20, 1.535), rot=(14, 0, 0), taper=(1.12, 0.78), bevel=0.035),
        OLIVE_L, "chest")
    add("ChestTrim", box((0.32, 0.03, 0.035), (0, -0.245, 1.425)), BRASS, "chest")
    for s in (1, -1):
        add(f"Vent{s}", box((0.07, 0.03, 0.06), (s * 0.13, -0.255, 1.50), rot=(14, 0, 0)), BLACK, "chest")
    # High gorget: the helmet sits down inside it, between the pauldrons.
    add("Gorget", box((0.38, 0.30, 0.14), (0, 0.03, 1.69), bevel=0.035), OLIVE_D, "chest")
    add("GorgetFront", box((0.30, 0.07, 0.10), (0, -0.135, 1.725), rot=(-18, 0, 0), taper=(1.12, 1.0), bevel=0.025),
        OLIVE, "chest")
    add("Collar", box((0.46, 0.09, 0.26), (0, 0.20, 1.76), rot=(-12, 0, 0), taper=(0.85, 1.0), bevel=0.03), OLIVE,
        "chest")
    # Unit badge across the breastplate: a winged chevron in tarnished brass.
    half = [(0.0, -0.07), (0.08, 0.0), (0.14, -0.005), (0.13, 0.015), (0.175, 0.03), (0.15, 0.05), (0.19, 0.08),
            (0.12, 0.09), (0.05, 0.06), (0.0, 0.05)]
    outline = half + [(-x, z) for x, z in reversed(half[1:-1])]
    add("Badge", prism(outline, 0.024, (0, -0.276, 1.565), rot=(14, 0, 0), bevel=0.004), BRASS, "chest")
    add("Neck", limb((0, 0.0, 1.62), (0, 0.0, 1.75), 0.075, verts=8), BLACK, "head")
    # limbs
    for S, s in sides():
        X = lambda x: s * x  # noqa: E731
        ua = f"upper_arm.{S}"
        add(f"UpperArm{S}", limb((X(0.265), -0.05, 1.50), (X(0.265), -0.03, 1.17), 0.07, 0.065, verts=6), BLACK, ua)
        add(f"Rerebrace{S}", limb((X(0.27), -0.045, 1.40), (X(0.268), -0.03, 1.21), 0.092, 0.085, verts=8,
                                  bevel=0.01), OLIVE, ua)
        add(f"ElbowCop{S}", box((0.10, 0.06, 0.10), (X(0.265), 0.04, 1.17), rot=(20, 0, 0), bevel=0.02), OLIVE_D, ua)
        fa = f"forearm.{S}"
        add(f"ElbowJoint{S}", sphere(0.068, (X(0.265), -0.03, 1.17), seg=8, rings=5), BLACK, fa)
        add(f"Vambrace{S}", plate((X(0.265), -0.03, 1.14), (X(0.265), -0.04, 0.86), 0.155, 0.165, taper=(1.2, 1.22),
                                  bevel=0.022), OLIVE, fa)
        add(f"Cuff{S}", plate((X(0.265), -0.04, 0.875), (X(0.265), -0.04, 0.835), 0.205, 0.22), BRASS, fa)
        hd = f"hand.{S}"
        add(f"Gauntlet{S}", box((0.12, 0.13, 0.085), (X(0.265), -0.04, 0.79), bevel=0.02), OLIVE_D, hd)
        add(f"Fingers{S}", box((0.10, 0.12, 0.065), (X(0.265), -0.05, 0.735), bevel=0.018), DARK, hd)
        th = f"thigh.{S}"
        add(f"ThighSuit{S}", limb((X(0.15), 0, 1.12), (X(0.15), -0.015, 0.64), 0.095, 0.085, verts=6), BLACK, th)
        add(f"Cuisse{S}", plate((X(0.158), -0.02, 1.05), (X(0.158), -0.03, 0.70), 0.235, 0.255, taper=(0.88, 0.86),
                                bevel=0.03), OLIVE, th)
        sh = f"shin.{S}"
        add(f"KneeJoint{S}", sphere(0.08, (X(0.15), -0.015, 0.62), seg=8, rings=5), BLACK, sh)
        add(f"KneePad{S}", box((0.17, 0.09, 0.19), (X(0.15), -0.12, 0.60), rot=(-8, 0, 0), taper=(0.82, 1.0),
                               bevel=0.03), ACCENT, sh, mat="acc")
        add(f"Greave{S}", plate((X(0.15), -0.01, 0.56), (X(0.15), -0.005, 0.18), 0.19, 0.225, taper=(1.14, 1.16),
                                bevel=0.03), OLIVE, sh)
        add(f"ShinRidge{S}", box((0.06, 0.04, 0.28), (X(0.15), -0.128, 0.37), rot=(-3, 0, 0)), OLIVE_L, sh)
        ft = f"foot.{S}"
        add(f"Boot{S}", box((0.22, 0.35, 0.13), (X(0.15), -0.06, 0.08), bevel=0.03), OLIVE_D, ft)
        add(f"ToeCap{S}", box((0.21, 0.11, 0.095), (X(0.15), -0.21, 0.062), taper=(0.9, 0.7), bevel=0.02), OLIVE, ft)
        add(f"Sole{S}", box((0.23, 0.40, 0.035), (X(0.15), -0.075, 0.0175)), BLACK, ft)
        add(f"Ankle{S}", box((0.21, 0.22, 0.09), (X(0.15), 0.0, 0.17), bevel=0.02), OLIVE_D, ft)
    oath_seal(add, "ThighSeal", (-0.17, -0.165, 1.0), "thigh.R", strips=(-0.012, 0.012), length=0.15)


# ---------------------------------------------------------------- helmets (bone: head)
def _lenses(add, r=0.034, z=1.838, y=-0.146, x=0.06):
    for s in (1, -1):
        add(f"Lens{s}", cyl(r, 0.03, (s * x, y, z), rot=(90, 0, s * 12), verts=8), GLOW, "head", mat="glow",
            jitter=0.0, ao=0.0)


def _grille(add, y=-0.257, zs=(1.715, 1.735, 1.755), w=0.068):
    for i, z in enumerate(zs):
        add(f"Grille{i}", box((w, 0.02, 0.011), (0, y, z)), BLACK, "head", ao=0.0)


def helmet_command(add):
    """Officer: the classic rebreather helm with a raised squad-colour crest and a vox whip."""
    add("Helmet", sphere(0.152, (0, 0.015, 1.845), seg=12, rings=7, scale=(0.92, 1.0, 0.93)), OLIVE, "head")
    add("FacePlate", box((0.20, 0.11, 0.14), (0, -0.095, 1.785), taper=(1.1, 1.0), bevel=0.02), OLIVE_D, "head")
    add("Snout", limb((0, -0.135, 1.762), (0, -0.25, 1.735), 0.074, 0.056, verts=4, twist=45, bevel=0.008), OLIVE_L,
        "head")
    _grille(add)
    add("Brow", box((0.25, 0.07, 0.05), (0, -0.128, 1.88), rot=(12, 0, 0), bevel=0.014), OLIVE_D, "head")
    add("BrowTrim", box((0.26, 0.02, 0.018), (0, -0.165, 1.893), rot=(12, 0, 0)), BRASS, "head")
    _lenses(add)
    for s in (1, -1):
        add(f"Cheek{s}", box((0.05, 0.15, 0.12), (s * 0.105, -0.09, 1.765), rot=(0, 0, -s * 16), bevel=0.014),
            OLIVE, "head")
    add("Crest", arc_band((0, 0.02, 1.845), 0.138, -118, 38, 0.034, 0.075, n=8), ACCENT, "head", mat="acc")
    add("CrestBase", arc_band((0, 0.02, 1.845), 0.132, -118, 40, 0.06, 0.02, n=8), BRASS, "head")
    add("Vox", box((0.05, 0.08, 0.08), (0.145, 0.03, 1.80), bevel=0.012), GUN, "head")
    add("Whip", limb((0.15, 0.05, 1.83), (0.17, 0.16, 2.12), 0.01, 0.006, verts=4), GUN_D, "head")


def helmet_heavy(add):
    """Reinforced full-face bucket helm with a single wide visor slit."""
    add("Helm", box((0.27, 0.30, 0.25), (0, 0.0, 1.835), taper=(0.86, 0.9), bevel=0.045), OLIVE, "head")
    add("Face", box((0.25, 0.08, 0.21), (0, -0.15, 1.80), rot=(6, 0, 0), bevel=0.02), OLIVE_D, "head")
    add("Visor", box((0.21, 0.03, 0.026), (0, -0.19, 1.838)), GLOW, "head", mat="glow", jitter=0.0, ao=0.0)
    add("VisorHood", box((0.27, 0.08, 0.045), (0, -0.19, 1.872), rot=(12, 0, 0), bevel=0.012), OLIVE_L, "head")
    add("Jaw", box((0.21, 0.11, 0.11), (0, -0.19, 1.725), taper=(1.18, 1.0), bevel=0.02), OLIVE_L, "head")
    for i, z in enumerate((1.705, 1.727, 1.749)):
        add(f"JawVent{i}", box((0.15, 0.02, 0.012), (0, -0.246, z)), BLACK, "head", ao=0.0)
    add("Ridge", box((0.055, 0.29, 0.022), (0, 0.0, 1.962)), ACCENT, "head", mat="acc")
    add("NeckGuard", box((0.28, 0.08, 0.11), (0, 0.15, 1.73), rot=(-15, 0, 0), bevel=0.02), OLIVE_D, "head")
    for s in (1, -1):
        add(f"Bolt{s}", cyl(0.03, 0.02, (s * 0.13, 0.0, 1.82), rot=(0, 90, 0), verts=6), BRASS, "head")


def helmet_breacher(add):
    """Round helm with a sealed respirator: twin round lenses, side filters, hoses to the back."""
    add("Helmet", sphere(0.15, (0, 0.02, 1.85), seg=10, rings=7, scale=(0.95, 1.0, 0.92)), OLIVE, "head")
    add("Mask", box((0.19, 0.12, 0.13), (0, -0.12, 1.765), taper=(1.1, 0.9), bevel=0.025), DARK, "head")
    add("Valve", limb((0, -0.17, 1.742), (0, -0.235, 1.735), 0.052, 0.046, verts=8), GUN, "head")
    add("ValveCap", cyl(0.036, 0.012, (0, -0.24, 1.735), rot=(90, 0, 0), verts=8), BLACK, "head", ao=0.0)
    add("Band", lathe([(0.142, -0.022), (0.149, 0.0), (0.142, 0.022)], verts=12, loc=(0, 0.02, 1.875),
                      scale=(0.95, 1.0, 1.0), cap_bottom=False, cap_top=False), ACCENT, "head", mat="acc")
    for s in (1, -1):
        add(f"Filter{s}", cyl(0.042, 0.10, (s * 0.105, -0.165, 1.72), rot=(62, 0, s * 38), verts=8), GUN_D, "head")
        add(f"FilterCap{s}", cyl(0.045, 0.02, (s * 0.135, -0.205, 1.70), rot=(62, 0, s * 38), verts=8), HAZARD,
            "head")
        add(f"HoseA{s}", limb((s * 0.12, -0.12, 1.72), (s * 0.165, 0.0, 1.745), 0.02, verts=5), BLACK, "head")
        add(f"HoseB{s}", limb((s * 0.165, 0.0, 1.745), (s * 0.10, 0.13, 1.78), 0.02, verts=5), BLACK, "head")
        add(f"LensRim{s}", cyl(0.053, 0.024, (s * 0.063, -0.128, 1.842), rot=(90, 0, s * 10), verts=10), BRASS,
            "head")
        add(f"Lens{s}", cyl(0.043, 0.03, (s * 0.063, -0.138, 1.842), rot=(90, 0, s * 10), verts=10), GLOW, "head",
            mat="glow", jitter=0.0, ao=0.0)


def helmet_marksman(add):
    """Low sleek helm; rangefinder monocle over the right eye, sensor ear on the left."""
    add("Helmet", sphere(0.148, (0, 0.02, 1.835), seg=12, rings=7, scale=(0.9, 1.06, 0.86)), OLIVE, "head")
    add("FacePlate", box((0.19, 0.12, 0.13), (0, -0.10, 1.78), taper=(1.05, 1.0), bevel=0.02), OLIVE_D, "head")
    add("Chin", limb((0, -0.14, 1.745), (0, -0.215, 1.73), 0.055, 0.042, verts=6), OLIVE_L, "head")
    _grille(add, y=-0.218, zs=(1.72, 1.74), w=0.05)
    add("Brow", box((0.21, 0.05, 0.035), (0, -0.152, 1.87), rot=(10, 0, 0), bevel=0.01), OLIVE_D, "head")
    add("EyeL", box((0.055, 0.02, 0.022), (0.062, -0.162, 1.838)), GLOW, "head", mat="glow", jitter=0.0, ao=0.0)
    add("Scope", limb((-0.062, -0.14, 1.838), (-0.062, -0.255, 1.838), 0.037, 0.034, verts=8), GUN_D, "head")
    add("ScopeRing", cyl(0.042, 0.02, (-0.062, -0.24, 1.838), rot=(90, 0, 0), verts=8), BRASS, "head")
    add("ScopeLens", cyl(0.028, 0.012, (-0.062, -0.259, 1.838), rot=(90, 0, 0), verts=8), GLOW, "head", mat="glow",
        jitter=0.0, ao=0.0)
    add("ScopeArm", box((0.05, 0.05, 0.022), (-0.11, -0.13, 1.87)), GUN, "head")
    add("Ear", box((0.045, 0.11, 0.10), (0.145, 0.01, 1.82), bevel=0.012), GUN, "head")
    add("EarDisc", cyl(0.04, 0.02, (0.172, 0.01, 1.82), rot=(0, 90, 0), verts=8), GUN_D, "head")
    add("EarStub", limb((0.155, 0.05, 1.86), (0.17, 0.12, 1.99), 0.009, 0.006, verts=4), GUN_D, "head")
    add("Stripe", arc_band((0, 0.02, 1.835), 0.13, -110, 45, 0.032, 0.012, n=7), ACCENT, "head", mat="acc")


def cape(center, radius, z0, z1, a0, a1, n=8, pleat=0.028, thick=0.016, flare=1.25):
    """Thin pleated cloth panel hanging round a vertical axis through `center` (x, y). Angles in
    degrees: 0 = +Y (back), 90 = +X (left). Top edge at z1 (radius), hem at z0 (radius * flare);
    alternate columns stand proud by `pleat` so the cloth reads as folds."""
    bm = bmesh.new()
    v = {}
    for zi, (z, k) in enumerate(((z0, flare), (z1, 1.0))):
        for layer, dr in enumerate((0.0, thick)):
            for i in range(n + 1):
                a = math.radians(a0 + (a1 - a0) * i / n)
                r = radius * k + dr + (pleat * k * (1.0 if zi == 0 else 0.4) if i % 2 else 0.0)
                v[zi, layer, i] = bm.verts.new((center[0] + r * math.sin(a), center[1] + r * math.cos(a), z))
    for i in range(n):
        bm.faces.new((v[0, 1, i], v[0, 1, i + 1], v[1, 1, i + 1], v[1, 1, i]))
        bm.faces.new((v[0, 0, i], v[1, 0, i], v[1, 0, i + 1], v[0, 0, i + 1]))
        bm.faces.new((v[0, 0, i], v[0, 0, i + 1], v[0, 1, i + 1], v[0, 1, i]))
        bm.faces.new((v[1, 0, i], v[1, 1, i], v[1, 1, i + 1], v[1, 0, i + 1]))
    for i in (0, n):
        bm.faces.new((v[0, 0, i], v[0, 1, i], v[1, 1, i], v[1, 0, i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------- pads (bones: pad.L / pad.R, chest)
PAD_PROF = [(0.0, 0.235), (0.085, 0.225), (0.15, 0.19), (0.19, 0.13), (0.207, 0.05), (0.214, -0.03), (0.228, -0.105)]
RIM_PROF = [(0.229, -0.108), (0.245, -0.094), (0.245, -0.05), (0.226, -0.03)]


PAD_GROW = (1.13, 1.13, 1.1)   # massive pauldrons...
PAD_LIFT = 0.035               # ...riding high, level with the helmet's jaw


def grown(loc, scale):
    """A pauldron's placement made bigger and higher (same shape)."""
    return ((loc[0] * 1.05, loc[1], loc[2] + PAD_LIFT), tuple(a * b for a, b in zip(scale, PAD_GROW)))


def pad_point(loc, rot, scale, r, a, z):
    """World point on a pauldron: lathe-local radius `r`, angle `a` (degrees; -90 = front) and
    height `z`, through the pad's own transform."""
    m = Matrix.Translation(Vector(loc)) @ Euler([math.radians(v) for v in rot], "XYZ").to_matrix().to_4x4() \
        @ Matrix.Diagonal((*scale, 1.0))
    return tuple(m @ Vector((r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), z)))


def studs(add, S, loc, rot, scale, r, z, n=8, size=0.016, name="Stud"):
    """Rivets round a pauldron's rim (lathe-local radius `r` at height `z`), same transform as the pad."""
    for i in range(n):
        add(f"{name}{S}{i}", sphere(size, pad_point(loc, rot, scale, r, 360 * (i + 0.5) / n, z), seg=5, rings=3),
            BRASS, f"pad.{S}", jitter=0.1, ao=0.1)


def _pad(add, S, s, prof, rim, loc, rot, scale, col=OLIVE, verts=12, name="Pad", stud=True):
    loc, scale = grown(loc, scale)
    add(f"{name}{S}", lathe(prof, verts=verts, loc=loc, rot=rot, scale=scale), col, f"pad.{S}", ao=0.12)
    if rim:
        add(f"{name}Rim{S}", lathe(rim, verts=verts, loc=loc, rot=rot, scale=scale, cap_bottom=False, cap_top=False),
            ACCENT, f"pad.{S}", mat="acc")
        if stud:
            studs(add, S, loc, rot, scale, rim[1][0] + 0.004, (rim[1][1] + rim[2][1]) / 2, name=f"{name}Stud")


def pads_command(add):
    """Trimmed classic pads (brass ridge + squad rims) and a crimson half-cape off the left pad."""
    for S, s in sides():
        loc, rot = (s * 0.365, -0.02, 1.535), (0, -s * 16, 0)
        _pad(add, S, s, PAD_PROF, RIM_PROF, loc, rot, (0.92, 1.1, 1.0))
        gl, _ = grown(loc, (1, 1, 1))
        add(f"PadRidge{S}", xrot(arc_band(gl, 0.228 * PAD_GROW[2], -62, 62, 0.045, 0.022, n=6), gl, rot), BRASS,
            f"pad.{S}")
    gl, gs = grown((0.365, -0.02, 1.535), (0.92, 1.1, 1.0))
    oath_seal(add, "PadSeal", pad_point(gl, (0, -16, 0), gs, 0.258, -70, -0.072), "pad.L", face=(90, 0, -22),
              length=0.16)
    add("Cape", cape((0.30, 0.04), 0.215, 1.10, 1.74, 18, 128, n=8), CLOTH, "pad.L", jitter=0.1, ao=0.45)
    add("CapeHem", cape((0.30, 0.04), 0.222, 1.085, 1.125, 18, 128, n=8, pleat=0.028, flare=1.25), ACCENT, "pad.L",
        mat="acc")
    add("Clasp", cyl(0.032, 0.025, (0.43, -0.13, 1.66), rot=(90, 0, 30), verts=8), BRASS, "pad.L")


def pads_heavy(add):
    """Huge layered pauldrons plus a bolted extra breastplate."""
    big = [(0.0, 0.265), (0.10, 0.255), (0.175, 0.21), (0.222, 0.14), (0.242, 0.05), (0.246, -0.035)]
    lame1 = [(0.248, -0.03), (0.262, -0.055), (0.262, -0.105)]
    lame2 = [(0.266, -0.10), (0.278, -0.125), (0.278, -0.175)]
    rim = [(0.279, -0.198), (0.292, -0.182), (0.292, -0.158), (0.278, -0.148)]
    for S, s in sides():
        loc, rot, sc = (s * 0.385, -0.02, 1.55), (0, -s * 18, 0), (0.95, 1.12, 1.0)
        _pad(add, S, s, big, None, loc, rot, sc)
        loc, sc = grown(loc, sc)
        add(f"Lame1{S}", lathe(lame1, verts=12, loc=loc, rot=rot, scale=sc, cap_bottom=False, cap_top=False), OLIVE_D,
            f"pad.{S}")
        add(f"Lame2{S}", lathe(lame2, verts=12, loc=loc, rot=rot, scale=sc, cap_bottom=False, cap_top=False), OLIVE,
            f"pad.{S}")
        add(f"PadRim{S}", lathe(rim, verts=12, loc=loc, rot=rot, scale=sc, cap_bottom=False, cap_top=False), ACCENT,
            f"pad.{S}", mat="acc")
        studs(add, S, loc, rot, sc, 0.296, -0.17, n=9, size=0.018)
    gl, gs = grown((0.385, -0.02, 1.55), (0.95, 1.12, 1.0))
    oath_seal(add, "PadSeal", pad_point(gl, (0, -18, 0), gs, 0.305, -70, -0.165), "pad.L", face=(90, 0, -22),
              length=0.17)
    add("ChestPlate", box((0.44, 0.08, 0.22), (0, -0.285, 1.53), rot=(14, 0, 0), taper=(1.08, 0.9), bevel=0.03),
        OLIVE_L, "chest")
    for x in (-0.16, 0.16):
        for z in (1.45, 1.60):
            add(f"Rivet{x}{z}", cyl(0.018, 0.02, (x, -0.33 + (z - 1.45) * 0.25, z), rot=(76, 0, 0), verts=6), BRASS,
                "chest")


def pads_breacher(add):
    """Asymmetric: a big left pad with a hanging breaching guard, a light right cap."""
    loc, rot, sc = (0.385, -0.02, 1.555), (0, -20, 0), (1.08, 1.26, 1.1)
    _pad(add, "L", 1, PAD_PROF, RIM_PROF, loc, rot, sc)
    add("Guard", shell((0.25, -0.04, 1.30), 0.135, 0.135, 0.26, arc=130, thick=0.028, n=5, rot=(90, 0, 55),
                       taper=1.08), OLIVE_D, "upper_arm.L")
    add("GuardStripe", shell((0.25, -0.04, 1.235), 0.147, 0.147, 0.04, arc=130, thick=0.02, n=5, rot=(90, 0, 55)),
        HAZARD, "upper_arm.L")
    light = [(0.0, 0.11), (0.08, 0.10), (0.13, 0.07), (0.152, 0.02), (0.155, -0.04)]
    lrim = [(0.157, -0.055), (0.168, -0.045), (0.168, -0.018), (0.155, -0.008)]
    _pad(add, "R", -1, light, lrim, (-0.315, -0.02, 1.53), (0, 12, 0), (0.92, 1.05, 1.0), verts=10)


def pads_marksman(add):
    """Low-profile pads under a camo cowl and hood."""
    low = [(0.0, 0.15), (0.10, 0.14), (0.16, 0.10), (0.185, 0.04), (0.19, -0.05)]
    lrim = [(0.192, -0.066), (0.204, -0.055), (0.204, -0.025), (0.19, -0.015)]
    for S, s in sides():
        _pad(add, S, s, low, lrim, (s * 0.345, -0.02, 1.53), (0, -s * 14, 0), (0.92, 1.08, 1.0), verts=10)
    add("Hood", shell((0, 0.05, 1.83), 0.19, 0.205, 0.30, arc=250, thick=0.02, n=8, rot=(-8, 0, 0), taper=0.62),
        CAMO[0], "chest", camo=True)
    add("Cowl", lathe([(0.31, -0.05), (0.285, 0.03), (0.22, 0.09), (0.16, 0.12)], verts=12, loc=(0, 0.02, 1.64),
                      scale=(1.0, 0.92, 1.0), cap_bottom=False, cap_top=False), CAMO[0], "chest", camo=True)


# ---------------------------------------------------------------- packs (bone: chest)
def _pack_box(add, size=(0.44, 0.21, 0.44), y=0.29, z=1.54, lid=True, slats=3):
    add("Pack", box(size, (0, y, z), bevel=0.035), OLIVE_D, "chest")
    add("PackBase", box((size[0] + 0.04, size[1] - 0.01, 0.12), (0, y, z - size[2] / 2 + 0.02), bevel=0.025), OLIVE,
        "chest")
    if lid:
        add("PackLid", box((size[0] - 0.06, size[1] - 0.03, 0.05), (0, y, z + size[2] / 2 + 0.01), bevel=0.018), OLIVE,
            "chest")
    for i in range(slats):
        add(f"Slat{i}", box((size[0] * 0.65, 0.03, 0.026), (0, y + size[1] / 2 + 0.005, z - 0.08 + 0.065 * i)),
            BLACK, "chest", ao=0.0)


def _stack(add, x, y=0.345, z=1.88, h=0.32):
    add(f"Stack{x}", cyl(0.056, h, (x, y, z), rot=(-8, 0, 0), verts=8), GUN, "chest")
    add(f"StackRing{x}", cyl(0.066, 0.045, (x, y - 0.007, z - 0.08), rot=(-8, 0, 0), verts=8), BRASS, "chest")
    add(f"StackCap{x}", cyl(0.042, 0.02, (x, y + 0.025, z + h / 2 + 0.018), rot=(-8, 0, 0), verts=8), BLACK, "chest",
        ao=0.0)


def pack_command(add):
    """Command pack: vox unit and a tall comms mast with a beacon."""
    _pack_box(add)
    _stack(add, -0.14)
    add("Vox", box((0.15, 0.13, 0.12), (0.13, 0.31, 1.84), bevel=0.015), GUN, "chest")
    add("VoxGrille", box((0.10, 0.02, 0.05), (0.13, 0.38, 1.84)), BLACK, "chest", ao=0.0)
    add("Mast", limb((0.15, 0.32, 1.88), (0.16, 0.37, 2.50), 0.017, 0.01, verts=4), GUN_D, "chest")
    m0, m1 = Vector((0.15, 0.32, 1.88)), Vector((0.16, 0.37, 2.50))
    for i, (u, w) in enumerate(((0.52, 0.14), (0.77, 0.09))):
        add(f"Spar{i}", box((w, 0.014, 0.014), tuple(m0.lerp(m1, u))), GUN_D, "chest")
    add("Beacon", sphere(0.02, (0.16, 0.372, 2.51), seg=6, rings=4), GLOW, "chest", mat="glow", jitter=0.0, ao=0.0)
    add("Dish", cyl(0.065, 0.03, (0.205, 0.335, 2.04), rot=(0, 90, 0), verts=8, r2=0.025), GUN, "chest")


def pack_heavy(add):
    """Heavy pack: a big ammo drum with a feed belt snaking round the right hip toward the weapon."""
    _pack_box(add, size=(0.50, 0.24, 0.46), y=0.30, z=1.52, lid=False, slats=0)
    for x in (0.16, -0.16):
        _stack(add, x, y=0.35, z=1.86, h=0.28)
    add("Drum", cyl(0.155, 0.40, (0, 0.53, 1.46), rot=(0, 90, 0), verts=12), GUN, "chest")
    for x in (0.205, -0.205):
        add(f"DrumCap{x}", cyl(0.16, 0.03, (x, 0.53, 1.46), rot=(0, 90, 0), verts=12), BRASS, "chest")
    add("DrumBand", cyl(0.162, 0.06, (0, 0.53, 1.46), rot=(0, 90, 0), verts=12), ACCENT, "chest", mat="acc")
    path = [(-0.20, 0.47, 1.36), (-0.30, 0.32, 1.28), (-0.335, 0.10, 1.22), (-0.30, -0.14, 1.15), (-0.21, -0.30, 1.13)]
    for i, (a, b) in enumerate(zip(path, path[1:])):
        add(f"Belt{i}", plate(a, b, 0.07, 0.022, side=(0, 0, 1)), BRASS, "chest", jitter=0.12)
    for i, p in enumerate(path[1:-1]):
        add(f"Link{i}", box((0.035, 0.035, 0.085), p), GUN_D, "chest")


def pack_breacher(add):
    """Breacher pack: three strapped breaching charges with armed detonators."""
    _pack_box(add, size=(0.40, 0.18, 0.42), y=0.28, z=1.53, slats=0)
    for i, x in enumerate((-0.13, 0.0, 0.13)):
        add(f"Charge{i}", cyl(0.052, 0.25, (x, 0.42, 1.52), verts=8), GUN_D, "chest")
        add(f"ChargeBand{i}", cyl(0.056, 0.045, (x, 0.42, 1.47), verts=8), HAZARD, "chest")
        add(f"ChargeCap{i}", cyl(0.04, 0.035, (x, 0.42, 1.66), verts=8), RED, "chest")
        add(f"Det{i}", box((0.022, 0.02, 0.022), (x, 0.475, 1.58)), GLOW, "chest", mat="glow", jitter=0.0, ao=0.0)
    for z in (1.42, 1.62):
        add(f"Strap{z}", box((0.43, 0.025, 0.03), (0, 0.475, z)), LEATHER, "chest")


def pack_marksman(add):
    """Compact pack with a bedroll and a mast-mounted sensor pod."""
    _pack_box(add, size=(0.38, 0.18, 0.38), y=0.28, z=1.52, slats=2)
    add("Roll", cyl(0.055, 0.40, (0, 0.30, 1.775), rot=(0, 90, 0), verts=8), CAMO[0], "chest", camo=True)
    add("PodMast", limb((-0.15, 0.33, 1.72), (-0.18, 0.34, 1.99), 0.018, 0.014, verts=4), GUN_D, "chest")
    add("Pod", sphere(0.075, (-0.18, 0.34, 2.035), seg=8, rings=5, scale=(1.0, 1.15, 0.9)), GUN, "chest")
    add("PodRing", cyl(0.045, 0.025, (-0.18, 0.265, 2.035), rot=(90, 0, 0), verts=8), GUN_D, "chest")
    add("PodEye", cyl(0.03, 0.012, (-0.18, 0.25, 2.035), rot=(90, 0, 0), verts=8), GLOW, "chest", mat="glow",
        jitter=0.0, ao=0.0)
    add("PodFin", box((0.012, 0.08, 0.05), (-0.18, 0.40, 2.08)), GUN_D, "chest")


# ---------------------------------------------------------------- weapons (bones: gun, mag)
def _torch(add, y, z, x=0.0, r=0.034, length=0.12):
    add("Torch", cyl(r, length, g(x, y, z), rot=(90, 0, 0), verts=8), GUN_D, "gun")
    add("TorchLens", cyl(r * 0.85, 0.012, g(x, y - length / 2 - 0.004, z), rot=(90, 0, 0), verts=8), LENS, "gun",
        jitter=0.0, ao=0.0)


def _pistol_grip(add):
    add("Grip", box((0.05, 0.065, 0.13), g(0, 0.02, -0.065), rot=(15, 0, 0), bevel=0.01), BLACK, "gun")
    add("Guard", box((0.02, 0.08, 0.015), g(0, -0.035, -0.05)), GUN_D, "gun")


def weapon_carbine(add):
    """Standard-issue boxy carbine (the original rifle)."""
    add("Stock", box((0.08, 0.13, 0.115), g(0, 0.09, 0.06), bevel=0.014), GUN, "gun")
    add("ButtPad", box((0.09, 0.03, 0.145), g(0, 0.165, 0.05)), BLACK, "gun")
    add("Receiver", box((0.118, 0.30, 0.17), g(0, -0.08, 0.07), bevel=0.018), GUN, "gun")
    add("Casing", box((0.126, 0.14, 0.06), g(0, -0.07, 0.045)), RED, "gun")
    add("Port", box((0.124, 0.07, 0.03), g(0, -0.10, 0.115)), BLACK, "gun", ao=0.0)
    add("Rail", box((0.055, 0.22, 0.035), g(0, -0.07, 0.17)), GUN_D, "gun")
    add("Sight", box((0.05, 0.07, 0.065), g(0, 0.0, 0.195)), GUN_D, "gun")
    _pistol_grip(add)
    add("Shroud", box((0.11, 0.34, 0.13), g(0, -0.40, 0.08), bevel=0.018), GUN, "gun")
    for i, y in enumerate((-0.31, -0.38, -0.45)):
        add(f"ShroudVent{i}", box((0.116, 0.035, 0.028), g(0, y, 0.11)), BLACK, "gun", ao=0.0)
    add("Barrel", cyl(0.028, 0.12, g(0, -0.625, 0.09), rot=(90, 0, 0), verts=8), GUN_D, "gun")
    add("Brake", box((0.075, 0.08, 0.075), g(0, -0.70, 0.09), bevel=0.012), GUN_D, "gun")
    add("BrakeSlot", box((0.08, 0.015, 0.024), g(0, -0.695, 0.09)), BLACK, "gun", ao=0.0)
    _torch(add, -0.475, -0.03)
    add("TorchMount", box((0.03, 0.06, 0.03), g(0, -0.475, 0.005)), GUN_D, "gun")
    add("Mag", box((0.075, 0.11, 0.21), g(0, -0.135, -0.105), rot=(-8, 0, 0), bevel=0.01), GUN_D, "mag")
    add("MagBase", box((0.078, 0.108, 0.025), g(0, -0.15, -0.20), rot=(-8, 0, 0)), BRASS, "mag")


def weapon_heavy(add):
    """Bulky drum-fed repeater: fat receiver, carry handle, finned heat shroud."""
    add("Stock", box((0.095, 0.12, 0.15), g(0, 0.08, 0.06), bevel=0.016), GUN, "gun")
    add("ButtPad", box((0.10, 0.03, 0.17), g(0, 0.15, 0.055)), BLACK, "gun")
    add("Receiver", box((0.15, 0.34, 0.20), g(0, -0.09, 0.08), bevel=0.022), GUN, "gun")
    add("Casing", box((0.158, 0.16, 0.07), g(0, -0.09, 0.05)), RED, "gun")
    add("FeedCover", box((0.12, 0.14, 0.04), g(0, -0.07, 0.195), bevel=0.01), GUN_D, "gun")
    add("Handle", box((0.03, 0.20, 0.03), g(0, -0.10, 0.285)), GUN_D, "gun")
    for i, y in enumerate((-0.02, -0.18)):
        add(f"HandlePost{i}", box((0.03, 0.03, 0.08), g(0, y, 0.245)), GUN_D, "gun")
    _pistol_grip(add)
    add("Jacket", cyl(0.062, 0.52, g(0, -0.52, 0.08), rot=(90, 0, 0), verts=8), GUN_D, "gun")
    for i, y in enumerate((-0.33, -0.43, -0.53, -0.63, -0.73)):
        add(f"Fin{i}", cyl(0.074, 0.026, g(0, y, 0.08), rot=(90, 0, 0), verts=8), GUN, "gun")
    add("Hider", cyl(0.04, 0.10, g(0, -0.83, 0.08), rot=(90, 0, 0), verts=8, r2=0.05), BLACK, "gun")
    add("Fore", box((0.07, 0.10, 0.05), g(0, -0.25, 0.0)), BLACK, "gun")
    _torch(add, -0.555, -0.035)
    add("Drum", cyl(0.095, 0.10, g(0, -0.095, -0.105), rot=(0, 90, 0), verts=12), GUN_D, "mag")
    add("DrumHub", cyl(0.045, 0.108, g(0, -0.095, -0.105), rot=(0, 90, 0), verts=8), BRASS, "mag")


def weapon_breacher(add):
    """Short fat combat shotgun: box magazine, pump fore-end, toothed breaching muzzle."""
    add("StockA", box((0.03, 0.17, 0.03), g(0, 0.10, 0.10)), GUN_D, "gun")
    add("StockB", box((0.03, 0.17, 0.03), g(0, 0.10, 0.02)), GUN_D, "gun")
    add("ButtPad", box((0.08, 0.03, 0.14), g(0, 0.19, 0.055)), BLACK, "gun")
    add("Receiver", box((0.13, 0.28, 0.17), g(0, -0.07, 0.075), bevel=0.02), GUN, "gun")
    add("Casing", box((0.136, 0.10, 0.05), g(0, -0.05, 0.12)), RED, "gun")
    for i, y in enumerate((-0.02, -0.06, -0.10, -0.14)):
        add(f"Shell{i}", box((0.02, 0.028, 0.06), g(0.072, y, 0.06)), RED, "gun")
    add("Sight", box((0.04, 0.05, 0.04), g(0, -0.02, 0.18)), GUN_D, "gun")
    _pistol_grip(add)
    add("Barrel", cyl(0.042, 0.40, g(0, -0.41, 0.105), rot=(90, 0, 0), verts=8), GUN_D, "gun")
    add("Tube", cyl(0.034, 0.30, g(0, -0.36, 0.03), rot=(90, 0, 0), verts=8), GUN_D, "gun")
    add("Pump", box((0.105, 0.17, 0.08), g(0, -0.265, 0.02), bevel=0.015), BLACK, "gun")
    add("Breach", cyl(0.056, 0.07, g(0, -0.60, 0.105), rot=(90, 0, 0), verts=8), GUN, "gun")
    for i in range(3):
        a = math.radians(-90 + 60 * i)
        add(f"Tooth{i}", box((0.018, 0.04, 0.018), g(0.06 * math.cos(a), -0.645, 0.105 + 0.06 * math.sin(a))),
            GUN, "gun")
    add("TorchMount", box((0.04, 0.05, 0.03), g(0.055, -0.46, 0.10)), GUN_D, "gun")
    _torch(add, -0.46, 0.10, x=0.075, r=0.028, length=0.1)
    add("Mag", box((0.075, 0.10, 0.20), g(0, -0.13, -0.10), rot=(-6, 0, 0), bevel=0.01), GUN_D, "mag")
    add("MagBand", box((0.08, 0.105, 0.03), g(0, -0.14, -0.17), rot=(-6, 0, 0)), HAZARD, "mag")


def weapon_marksman(add):
    """Long marksman rifle: thumbhole stock, long free-floated barrel, big scope, folded bipod."""
    add("Stock", box((0.07, 0.24, 0.12), g(0, 0.13, 0.045), bevel=0.014), GUN, "gun")
    add("Cheek", box((0.06, 0.14, 0.04), g(0, 0.12, 0.125)), GUN_D, "gun")
    add("ButtPad", box((0.08, 0.03, 0.15), g(0, 0.26, 0.04)), BLACK, "gun")
    add("Receiver", box((0.09, 0.30, 0.12), g(0, -0.07, 0.075), bevel=0.014), GUN, "gun")
    add("Casing", box((0.096, 0.10, 0.04), g(0, -0.06, 0.06)), RED, "gun")
    _pistol_grip(add)
    add("Handguard", box((0.085, 0.42, 0.09), g(0, -0.43, 0.07), bevel=0.012), GUN, "gun")
    for i, y in enumerate((-0.33, -0.43, -0.53)):
        add(f"Flute{i}", box((0.09, 0.05, 0.02), g(0, y, 0.085)), BLACK, "gun", ao=0.0)
    add("Barrel", cyl(0.02, 0.44, g(0, -0.86, 0.075), rot=(90, 0, 0), verts=8), GUN_D, "gun")
    add("Brake", box((0.05, 0.08, 0.05), g(0, -1.08, 0.075), bevel=0.008), GUN_D, "gun")
    add("Scope", cyl(0.036, 0.30, g(0, -0.09, 0.225), rot=(90, 0, 0), verts=8), GUN_D, "gun")
    add("Bell", cyl(0.05, 0.08, g(0, -0.275, 0.225), rot=(90, 0, 0), verts=8, r2=0.036), GUN_D, "gun")
    add("ScopeLens", cyl(0.042, 0.01, g(0, -0.318, 0.225), rot=(90, 0, 0), verts=8), LENS, "gun", jitter=0.0, ao=0.0)
    add("Eyepiece", cyl(0.042, 0.05, g(0, 0.075, 0.225), rot=(90, 0, 0), verts=8), BLACK, "gun")
    for i, y in enumerate((-0.01, -0.17)):
        add(f"ScopeMount{i}", box((0.035, 0.03, 0.07), g(0, y, 0.165)), GUN, "gun")
    for x in (0.02, -0.02):
        add(f"Bipod{x}", box((0.014, 0.26, 0.014), g(x, -0.60, 0.012)), GUN_D, "gun")
    _torch(add, -0.585, -0.005, r=0.028, length=0.1)
    add("Mag", box((0.06, 0.09, 0.19), g(0, -0.125, -0.10), rot=(-4, 0, 0), bevel=0.008), GUN_D, "mag")
    add("MagBase", box((0.064, 0.094, 0.02), g(0, -0.13, -0.19), rot=(-4, 0, 0)), BRASS, "mag")


def weapon_pistol(add):
    """Bolt pistol: a stubby, brutish sidearm - boxy frame and slide, fat barrel, brass band, a box
    magazine in the grip. One-handed: the left fist stays free for the sword."""
    _pistol_grip(add)
    add("Frame", box((0.076, 0.24, 0.11), g(0, -0.07, 0.04), bevel=0.014), GUN, "gun")
    add("Slide", box((0.082, 0.26, 0.066), g(0, -0.085, 0.122), bevel=0.012), GUN_D, "gun")
    add("Casing", box((0.086, 0.10, 0.03), g(0, -0.02, 0.09)), RED, "gun")
    add("Band", box((0.086, 0.03, 0.08), g(0, -0.19, 0.115)), BRASS, "gun")
    add("Barrel", cyl(0.032, 0.09, g(0, -0.25, 0.10), rot=(90, 0, 0), verts=8), GUN_D, "gun")
    add("Muzzle", box((0.064, 0.045, 0.064), g(0, -0.305, 0.10), bevel=0.008), GUN, "gun")
    add("Bore", cyl(0.016, 0.01, g(0, -0.33, 0.10), rot=(90, 0, 0), verts=6), BLACK, "gun", ao=0.0)
    add("SightF", box((0.02, 0.03, 0.03), g(0, -0.18, 0.168)), BLACK, "gun")
    add("SightR", box((0.04, 0.025, 0.03), g(0, 0.02, 0.168)), BLACK, "gun")
    add("TorchMount", box((0.03, 0.05, 0.03), g(0, -0.20, 0.0)), GUN_D, "gun")
    _torch(add, -0.21, 0.03, r=0.024, length=0.06)
    add("Mag", box((0.05, 0.07, 0.12), g(0, 0.03, -0.15), rot=(15, 0, 0), bevel=0.008), GUN_D, "mag")
    add("MagBase", box((0.054, 0.074, 0.02), g(0, 0.045, -0.205), rot=(15, 0, 0)), BRASS, "mag")


def weapon_minigun(add):
    """Rotary minigun: a six-barrel cluster on its own 'spin' bone, a boxy motor housing with a
    carry handle, a vertical fore-grip for the left hand and an ammo box underneath (on 'mag', so
    the reload swaps it)."""
    _pistol_grip(add)
    add("Housing", box((0.17, 0.34, 0.21), g(0, -0.09, 0.075), bevel=0.02), GUN, "gun")
    add("Casing", box((0.176, 0.14, 0.07), g(0, -0.07, 0.05)), RED, "gun")
    add("Motor", cyl(0.075, 0.12, g(0, 0.13, 0.085), rot=(90, 0, 0), verts=10), GUN_D, "gun")
    add("MotorCap", cyl(0.05, 0.03, g(0, 0.205, 0.085), rot=(90, 0, 0), verts=8), BRASS, "gun")
    add("Handle", box((0.03, 0.22, 0.03), g(0, -0.10, 0.26)), GUN_D, "gun")
    for i, y in enumerate((0.0, -0.20)):
        add(f"HandlePost{i}", box((0.03, 0.03, 0.08), g(0, y, 0.215)), GUN_D, "gun")
    add("ForeGrip", box((0.045, 0.055, 0.13), g(0, -0.25, -0.06), bevel=0.01), BLACK, "gun")
    add("ForeMount", box((0.06, 0.08, 0.04), g(0, -0.25, 0.0)), GUN_D, "gun")
    add("Bearing", cyl(0.07, 0.06, g(0, -0.28, 0.08), rot=(90, 0, 0), verts=10), GUN_D, "gun")
    add("TorchMount", box((0.03, 0.06, 0.04), g(0, -0.34, 0.175)), GUN_D, "gun")
    _torch(add, -0.37, 0.20, r=0.028, length=0.06)
    # the barrel cluster (spins)
    for z in (-0.33, -0.62, -0.86):
        add(f"Clamp{z}", cyl(0.082, 0.035, g(0, z, 0.08), rot=(90, 0, 0), verts=10), GUN_D, "spin")
    for i in range(6):
        a = math.radians(30 + 60 * i)
        add(f"Barrel{i}", cyl(0.017, 0.60, g(0.052 * math.cos(a), -0.58, 0.08 + 0.052 * math.sin(a)),
                                rot=(90, 0, 0), verts=6), GUN_D, "spin")
    add("Hub", cyl(0.03, 0.60, g(0, -0.58, 0.08), rot=(90, 0, 0), verts=6), BLACK, "spin")
    add("Ring", cyl(0.074, 0.03, g(0, -0.875, 0.08), rot=(90, 0, 0), verts=10), BRASS, "spin")
    # ammo box + belt into the receiver
    add("AmmoBox", box((0.13, 0.16, 0.12), g(0.02, -0.11, -0.10), bevel=0.012), GUN_D, "mag")
    add("AmmoLid", box((0.134, 0.164, 0.02), g(0.02, -0.11, -0.035)), HAZARD, "mag")
    for i, y in enumerate((-0.16, -0.12, -0.08, -0.04)):
        add(f"Round{i}", box((0.02, 0.02, 0.06), g(0.095, y, 0.0)), BRASS, "gun")


def weapon_fists(add):
    """Power fists: no gun at all - two massive gauntlets (knuckle plates down at rest, where a fist
    hits when the arm drives out), wreathed in a power field, with heavy cuffs and power cells up
    the forearms. The hands still hold the invisible gun's grips, which reads as a boxer's guard."""
    for S, s in (("L", 1), ("R", -1)):
        fx, fy, fz = s * FIST_L[0], FIST_L[1], FIST_L[2]
        add(f"Shell{S}", box((0.18, 0.20, 0.19), (fx, fy, fz), bevel=0.03), OLIVE, f"hand.{S}", camo=True)
        add(f"Back{S}", box((0.06, 0.17, 0.15), (fx + s * 0.085, fy, fz + 0.01), bevel=0.015), OLIVE_D, f"hand.{S}")
        add(f"Knuckles{S}", box((0.19, 0.19, 0.06), (fx, fy, fz - 0.12), bevel=0.015), GUN_D, f"hand.{S}")
        for i, dy in enumerate((-0.066, -0.022, 0.022, 0.066)):
            add(f"Stud{S}{i}", box((0.05, 0.034, 0.03), (fx, fy + dy, fz - 0.16), bevel=0.006), BRASS, f"hand.{S}")
        for j, dy in enumerate((-0.085, 0.085)):
            add(f"Coil{S}{j}", box((0.2, 0.018, 0.13), (fx, fy + dy, fz - 0.05)), POWER, f"hand.{S}", mat="power")
        add(f"Cuff{S}", cyl(0.11, 0.18, (fx, fy, fz + 0.17), verts=8), OLIVE_D, f"forearm.{S}")
        add(f"CuffRim{S}", cyl(0.118, 0.03, (fx, fy, fz + 0.09), verts=8), BRASS, f"forearm.{S}")
        add(f"Cell{S}", box((0.06, 0.07, 0.17), (fx + s * 0.11, fy + 0.02, fz + 0.2), bevel=0.01), GUN_D, f"forearm.{S}")
        add(f"CellGlow{S}", box((0.064, 0.03, 0.11), (fx + s * 0.112, fy - 0.02, fz + 0.2)), POWER, f"forearm.{S}",
            mat="power")


def melee_sword(add):
    """Power sword in the left fist: a long straight blade forward of the fist (the grip axis runs
    along Y at rest, like the fore-end it otherwise holds), brass cross-guard, a power generator at
    the hilt and both edges wreathed in the power field."""
    fx, fy, fz = FIST_L
    add("Hilt", cyl(0.024, 0.17, (fx, fy + 0.01, fz), rot=(90, 0, 0), verts=8), LEATHER, "hand.L")
    add("Pommel", sphere(0.036, (fx, fy + 0.11, fz), seg=8, rings=5), BRASS, "hand.L")
    add("Guard", box((0.05, 0.045, 0.22), (fx, fy - 0.095, fz), bevel=0.01), BRASS, "hand.L")
    add("Generator", box((0.06, 0.06, 0.08), (fx, fy - 0.135, fz), bevel=0.01), GUN_D, "hand.L")
    add("GenGlow", box((0.064, 0.02, 0.04), (fx, fy - 0.165, fz)), POWER, "hand.L", mat="power")
    add("Blade", box((0.018, 0.78, 0.074), (fx, fy - 0.56, fz)), STEEL, "hand.L")
    add("Fuller", box((0.022, 0.62, 0.014), (fx, fy - 0.52, fz)), GUN_D, "hand.L", ao=0.0)
    add("Tip", box((0.018, 0.074, 0.074), (fx, fy - 0.95, fz), rot=(45, 0, 0)), STEEL, "hand.L")
    for j, dz in enumerate((-0.04, 0.04)):
        add(f"Edge{j}", box((0.022, 0.80, 0.012), (fx, fy - 0.57, fz + dz)), POWER, "hand.L", mat="power")


BUILDERS = {
    "helmet": {"command": helmet_command, "heavy": helmet_heavy, "breacher": helmet_breacher,
               "marksman": helmet_marksman},
    "pads": {"command": pads_command, "heavy": pads_heavy, "breacher": pads_breacher, "marksman": pads_marksman},
    "pack": {"command": pack_command, "heavy": pack_heavy, "breacher": pack_breacher, "marksman": pack_marksman},
    "weapon": {"carbine": weapon_carbine, "heavy": weapon_heavy, "breacher": weapon_breacher,
               "marksman": weapon_marksman, "pistol": weapon_pistol, "minigun": weapon_minigun,
               "fists": weapon_fists},
    "melee": {"sword": melee_sword},
}
