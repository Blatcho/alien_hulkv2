"""Derelict-ship props -> public/assets/models/props.glb (one top-level node per prop).

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/props.py -- \
       --out public/assets/models [--preview tools/out/previews]

Contract (README "props.glb"): origin at floor-contact centre (x=0, z=0), width along X = `w`,
modelled centred on y=0 with the FRONT on the -Y side (the engine moves the node to its render
depth). Interactables carry a hinged child `<kind>_lid` / `<kind>_door` whose origin is on the
hinge line: lids rotate about local X, doors about local Z.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from lib.common import cyl, out_dir, reset_scene, script_args  # noqa: E402
from lib.env import (PAL, Geo, blob, bx, flat, lump, move, pipe, plate, poly_prism, quad, rotate,  # noqa: E402
                     row, col, sag, stencil, stripes, studs, tube, yz_prism, prop_grime, piece_info, piece_bounds,
                     ring, rifle_parts, place, smooth, lerp3, _rgb)
from lib.export import bounds, export_glb, write_meta  # noqa: E402

C = PAL
WIDTH = {
    "crate": 1.2, "locker": 1.0, "chest": 1.3, "cabinet": 1.4, "ammo_rack": 1.6, "barrel": 0.9, "bigcrate": 2.6,
    "console": 1.8, "bunk": 2.4, "medbed": 2.4, "shelf": 2.0, "table": 2.2, "reactor": 3.4, "pilot_seat": 1.2,
    "control_panel": 2.4, "debris": 1.5, "beam": 1.8, "airlock_hatch": 1.0,
    "barrel_explosive": 0.9, "barrel_wreck": 1.0, "console_broken": 1.8, "weapon_case": 1.4, "safe": 1.0, "scorch": 2.0,
    "barricade": 1.2, "turret": 1.0, "eggs": 1.6, "cryopod": 1.3, "body": 2.0,
    "missile": 2.6, "planter": 2.0, "specimen_tank": 1.3, "lab_bench": 2.2, "galley_counter": 2.2, "kiosk": 1.4,
}
BUDGET = {"reactor": 3000, "control_panel": 3000}


def rust(g, cx, cz, rx, rz, y, seed, two=True):
    g.add(poly_prism(blob(cx, cz, rx, rz, 8, seed), y - 0.004, y + 0.01), C["rust_dk"], jitter=0.12)
    if two:
        g.add(poly_prism(blob(cx, cz - rz * 0.1, rx * 0.6, rz * 0.55, 7, seed + 1), y - 0.008, y + 0.01),
              C["rust2"], jitter=0.12)


def screen_content(g, x0, x1, z0, z1, y, seed, kind="text"):
    """Emissive UI marks on a dark screen face at y (front). Keeps glow area small."""
    rnd = random.Random(seed)
    w, h = x1 - x0, z1 - z0
    g.add(bx(x0, x1, y, y + 0.01, z0, z1), C["screen"], jitter=0.0)
    y -= 0.003
    g.glow(bx(x0 + w * 0.05, x1 - w * 0.05, y, y + 0.003, z1 - h * 0.12, z1 - h * 0.07))
    if kind == "text":
        for i in range(5):
            z = z1 - h * (0.25 + i * 0.13)
            g.glow(bx(x0 + w * 0.06, x0 + w * rnd.uniform(0.3, 0.8), y, y + 0.003, z - h * 0.02, z + h * 0.02))
    elif kind == "bars":
        n = 6
        for i in range(n):
            xa = x0 + w * (0.1 + i * 0.8 / n)
            g.glow(bx(xa, xa + w * 0.08, y, y + 0.003, z0 + h * 0.1, z0 + h * rnd.uniform(0.25, 0.7)))
    elif kind == "radar":
        cx, cz, r = (x0 + x1) / 2, z0 + h * 0.45, min(w, h) * 0.32
        for rr in (r, r * 0.55):
            g.glow(tube([(cx + rr * math.cos(a), y, cz + rr * math.sin(a))
                         for a in [2 * math.pi * i / 14 for i in range(15)]], 0.006, verts=3, caps=False))
        g.glow(tube([(cx, y, cz), (cx + r * 0.9, y, cz + r * 0.45)], 0.007, verts=3))
        g.glow(bx(cx - r * 0.5, cx - r * 0.5 + 0.03, y, y + 0.003, cz + r * 0.3, cz + r * 0.3 + 0.03), "red")
    elif kind == "ecg":
        pts = []
        for i in range(15):
            t = i / 14
            spike = {5: 0.35, 6: -0.25, 11: 0.3}.get(i, 0.0)
            pts.append((x0 + w * (0.06 + t * 0.88), y, z0 + h * (0.45 + spike)))
        g.glow(tube(pts, 0.006, verts=3, caps=False))
        g.glow(bx(x0 + w * 0.65, x0 + w * 0.9, y, y + 0.003, z0 + h * 0.1, z0 + h * 0.22), "amber")


# ================================================================ containers (interactable)

def crate():
    g = Geo(seed=101)
    g.add(plate(-0.58, 0.58, 0.05, 0.62, -0.4, 0.4, steps=[(0.07, -0.02)], bevel=0.025), C["olive"])
    g.add(bx(-0.56, 0.56, -0.38, 0.38, 0.0, 0.06), C["dark"])
    for xa, xb in ((-0.6, -0.49), (0.49, 0.6)):   # corner guards
        g.add(plate(xa, xb, 0.02, 0.63, -0.425, 0.425, bevel=0.012), C["panel3"])
        g.add(studs(col(0.12, 0.54, 3, (xa + xb) / 2, -0.425), s=0.016, h=0.012), C["steel_lt"])
    g.add(bx(-0.4, 0.4, -0.387, -0.38, 0.4, 0.46), C["haz"], jitter=0.08)
    g.add(stencil("SUPPLY 7", 0.0, 0.33, -0.387, px=0.016, anchor="center"), C["stencil"], jitter=0.0)
    g.add(bx(-0.2, 0.2, -0.43, -0.4, 0.14, 0.2, bevel=0.01), C["steel"])       # grip
    rust(g, 0.3, 0.16, 0.12, 0.07, -0.382, 7, two=False)
    g.add(bx(-0.48, 0.48, -0.33, 0.33, 0.62, 0.622), C["void"], jitter=0.0)   # dark interior + stowed kit
    g.add(bx(-0.42, -0.04, -0.25, 0.2, 0.62, 0.69, bevel=0.01), C["olive_dk"])
    g.add(bx(0.05, 0.3, -0.22, 0.05, 0.62, 0.7, bevel=0.01), "#8a8c84")
    g.add(cyl(0.06, 0.2, (0.38, 0.1, 0.68), rot=(90, 0, 0), verts=7), C["drum"])
    body = g.build("crate", grime=prop_grime(1))
    lid = Geo(seed=102)
    lid.add(bx(-0.61, 0.61, -0.43, 0.43, 0.62, 0.76, bevel=0.025), C["olive_dk"])
    for x in (-0.3, 0.3):
        lid.add(bx(x - 0.12, x + 0.12, -0.36, 0.36, 0.76, 0.79, bevel=0.01), C["olive"])
        lid.add(bx(x - 0.05, x + 0.05, -0.455, -0.43, 0.54, 0.72, bevel=0.008), C["steel"])   # latches
        lid.add(bx(x - 0.03, x + 0.03, -0.465, -0.455, 0.56, 0.6), C["steel_lt"])
    lid.add(studs(row(-0.5, 0.5, 5, -0.43, 0.69), s=0.014, h=0.01), C["steel_lt"])
    lid.build("crate_lid", origin=(0, 0.43, 0.62), parent=body, grime=prop_grime(2))
    return body


def locker():
    g = Geo(seed=111)
    # hollow carcass (the interior is seen once the door swings open)
    g.add(bx(-0.47, 0.47, -0.25, 0.26, 0.0, 0.08), C["dark"])
    for xa, xb in ((-0.5, -0.46), (0.46, 0.5)):
        g.add(bx(xa, xb, -0.27, 0.28, 0.08, 2.2, bevel=0.01), C["panel3"])
    g.add(bx(-0.46, 0.46, 0.24, 0.28, 0.08, 2.2), C["panel3"])
    g.add(bx(-0.46, 0.46, -0.27, 0.24, 0.08, 0.13), C["panel3"])
    g.add(bx(-0.46, 0.46, -0.27, 0.24, 2.1, 2.2), C["panel3"])
    g.add(bx(-0.52, 0.52, -0.3, 0.3, 2.14, 2.22, bevel=0.015), C["rib"])
    g.add(quad(-0.46, 0.46, 0.13, 2.1, 0.239), "#1b1e20", jitter=0.0)
    g.add(studs(col(0.4, 1.9, 4, -0.485, -0.272), s=0.01, h=0.008), C["steel"])
    # contents: shelf with helmet + box, hanging fatigues, boots
    g.add(bx(-0.46, 0.46, -0.2, 0.24, 1.72, 1.75), C["steel"], top=0.35)
    g.add(lump((-0.2, 0.02, 1.75), 0.13, seed=1, seg=8, rings=5, rough=0.05, scale=(1.1, 1.0, 0.85), cut="bottom"),
          C["olive"], top=0.4)
    g.add(bx(0.08, 0.36, -0.1, 0.2, 1.75, 1.87), C["olive_dk"])
    g.add(pipe((-0.44, 0.02, 1.62), (0.44, 0.02, 1.62), 0.01, verts=4), C["steel_lt"])
    g.add(poly_prism([(-0.3, 1.56), (-0.06, 1.61), (0.06, 1.61), (0.3, 1.56), (0.27, 0.95), (-0.27, 0.95)], -0.05, 0.08),
          "#3a4230", jitter=0.06)
    g.add(poly_prism([(-0.08, 1.61), (0.08, 1.61), (0.0, 1.45)], -0.056, -0.05), "#23271c", jitter=0.0)
    for x in (-0.16, 0.1):
        g.add(lump((x, -0.03, 0.13), 0.1, seed=int(x * 100) & 7, seg=6, rings=4, rough=0.15, scale=(1.4, 0.8, 1.3),
                   cut="bottom"), C["dark"])
    body = g.build("locker", grime=prop_grime(11, h=1.8))
    d = Geo(seed=112)
    x0, x1, z0, z1, yf, yb = -0.46, 0.46, 0.13, 2.1, -0.305, -0.275
    d.add(plate(x0, x1, z0, z1, yf, yb, steps=[(0.04, -0.008)], bevel=0.01), "#3c444b")
    for i in range(6):   # louvres top and bottom
        for zc in (1.78 + i * 0.045, 0.3 + i * 0.045):
            s = bx(-0.26, 0.26, yf - 0.012, yf + 0.004, zc - 0.012, zc + 0.012)
            rotate(s, 30, "X", (0, yf, zc))
            d.add(s, C["panel"], top=0.4)
        d.add(bx(-0.27, 0.27, yf + 0.002, yf + 0.004, 1.76 + i * 0.045, 1.79 + i * 0.045), C["void"])
    d.add(bx(-0.2, 0.2, yf - 0.012, yf, 1.52, 1.62, bevel=0.005), C["cloth_lt"])      # name plate
    d.add(stencil("VOSS", 0.0, 1.6, yf - 0.014, px=0.013, anchor="center"), C["dark"], jitter=0.0)
    d.add(bx(0.33, 0.37, yf - 0.05, yf, 0.95, 1.3, bevel=0.01), C["steel_lt"], top=0.4)   # handle
    d.add(bx(0.3, 0.4, yf - 0.02, yf, 1.36, 1.48), C["dark"])                           # keypad
    d.glow(bx(0.33, 0.37, yf - 0.024, yf - 0.02, 1.43, 1.46), "red")
    rust(d, -0.25, 0.75, 0.13, 0.1, yf - 0.002, 13)
    d.add(bx(-0.46, -0.44, yf - 0.02, yf, 0.3, 0.42), C["steel"])                         # hinges
    d.add(bx(-0.46, -0.44, yf - 0.02, yf, 1.8, 1.92), C["steel"])
    d.build("locker_door", origin=(x0, yb, z0), parent=body, grime=prop_grime(12, h=1.8))
    return body


def chest():
    g = Geo(seed=121)
    g.add(plate(-0.63, 0.63, 0.03, 0.42, -0.32, 0.32, steps=[(0.05, -0.012)], bevel=0.02), "#3f4431")
    g.add(bx(-0.6, 0.6, -0.3, 0.3, 0.0, 0.04), C["dark"])
    for x in (-0.63, 0.55):   # brass corner brackets
        for z in (0.03, 0.32):
            g.add(bx(x, x + 0.08, -0.335, -0.315, z, z + 0.1, bevel=0.006), C["brass"], top=0.35)
    g.add(bx(-0.35, 0.35, -0.327, -0.32, 0.08, 0.11), C["haz"], jitter=0.08)
    g.add(stencil("S-12", -0.5, 0.31, -0.328, px=0.016), C["stencil"], jitter=0.0)
    g.add(bx(-0.08, 0.08, -0.34, -0.32, 0.27, 0.38, bevel=0.008), C["steel"])   # lock plate
    g.add(bx(-0.57, 0.57, -0.27, 0.27, 0.42, 0.422), C["void"], jitter=0.0)   # dark interior + contents
    g.add(bx(-0.5, -0.05, -0.22, 0.2, 0.42, 0.47, bevel=0.015), C["blanket"])
    g.add(bx(0.08, 0.46, -0.2, 0.14, 0.42, 0.5, bevel=0.01), C["olive"])
    body = g.build("chest", grime=prop_grime(21, h=0.6))
    lid = Geo(seed=122)
    lid.add(bx(-0.65, 0.65, -0.34, 0.34, 0.42, 0.53, bevel=0.02), "#353a29")
    lid.add(bx(-0.55, 0.55, -0.27, 0.27, 0.53, 0.56, bevel=0.01), "#3f4431")
    for x in (-0.65, 0.57):
        lid.add(bx(x, x + 0.08, -0.35, -0.33, 0.43, 0.53, bevel=0.006), C["brass"], top=0.35)
    lid.add(bx(-0.05, 0.05, -0.36, -0.34, 0.33, 0.5, bevel=0.006), C["steel_lt"])       # hasp
    lid.build("chest_lid", origin=(0, 0.34, 0.42), parent=body, grime=prop_grime(22, h=0.6))
    return body


def cabinet():
    g = Geo(seed=131)
    # hollow wall cabinet: shell, pale interior, shelves of supplies (seen when the door opens)
    for xa, xb in ((-0.7, -0.66), (0.66, 0.7)):
        g.add(bx(xa, xb, -0.16, 0.17, 1.0, 1.85, bevel=0.008), C["med"])
    g.add(bx(-0.66, 0.66, 0.13, 0.17, 1.0, 1.85), C["med"])
    g.add(bx(-0.66, 0.66, -0.16, 0.13, 1.0, 1.03), C["med"])
    g.add(bx(-0.66, 0.66, -0.16, 0.13, 1.82, 1.85), C["med"])
    g.add(quad(-0.66, 0.66, 1.03, 1.82, 0.129), "#4a4d48", jitter=0.0)
    g.add(yz_prism([(-0.2, 1.85), (0.17, 1.85), (0.17, 1.92), (-0.12, 1.9)], -0.72, 0.72), C["rib"])   # roof lip
    for z0, z1 in ((1.0, 1.06), (1.8, 1.86)):   # wall mounting rails back to the wall (hidden behind)
        g.add(bx(-0.55, 0.55, 0.17, 0.36, z0, z1), C["dark"])
    for z in (1.3, 1.56):
        g.add(bx(-0.66, 0.66, -0.13, 0.13, z - 0.02, z), C["steel"], top=0.35)
    for x in (-0.55, -0.22):   # medkits
        g.add(bx(x, x + 0.26, -0.1, 0.1, 1.3, 1.46, bevel=0.01), "#8a8c84")
        g.add(quad(x + 0.1, x + 0.16, 1.33, 1.43, -0.102), C["cross"], jitter=0.0)
        g.add(quad(x + 0.08, x + 0.18, 1.35, 1.41, -0.103), C["cross"], jitter=0.0)
    for i in range(5):   # bottles
        x = 0.15 + i * 0.1
        g.add(cyl(0.035, 0.16, (x, 0.0, 1.38), verts=6), ("#3f5a4a", "#6b5a30", "#5a2a22")[i % 3])
    g.add(cyl(0.05, 0.3, (-0.3, 0.0, 1.61), rot=(0, 90, 0), verts=7), "#9a9888")                 # bandage roll
    g.add(bx(0.1, 0.5, -0.1, 0.1, 1.56, 1.7, bevel=0.01), C["olive_dk"])
    g.add(bx(-0.6, -0.3, -0.1, 0.1, 1.03, 1.12), "#5a2a22")
    g.glow(bx(0.52, 0.62, -0.21, -0.19, 1.87, 1.9), "glow")            # status strip
    body = g.build("cabinet", grime=prop_grime(31, floor=1.0))
    d = Geo(seed=132)
    x0, x1, z0, z1, yf, yb = -0.67, 0.67, 1.03, 1.82, -0.2, -0.17
    d.add(plate(x0, x1, z0, z1, yf, yb, steps=[(0.05, -0.01)], bevel=0.012), "#6f7269")
    cx, cz = -0.05, 1.43
    d.add(bx(cx - 0.055, cx + 0.055, yf - 0.006, yf, cz - 0.19, cz + 0.19), C["cross"], jitter=0.03)
    d.add(bx(cx - 0.19, cx + 0.19, yf - 0.006, yf, cz - 0.055, cz + 0.055), C["cross"], jitter=0.03)
    d.add(bx(0.5, 0.56, yf - 0.05, yf, 1.25, 1.6, bevel=0.012), C["steel"], top=0.4)
    d.add(stencil("MEDICAL", cx, 1.16, yf - 0.006, px=0.013, anchor="center"), C["dark"], jitter=0.0)
    d.add(flat(blob(0.3, 1.2, 0.1, 0.07, 9, 5, jag=0.5), yf - 0.008), C["blood"], jitter=0.1)
    d.add(flat(blob(0.27, 1.07, 0.022, 0.09, 6, 6), yf - 0.008), C["blood"], jitter=0.1)
    d.build("cabinet_door", origin=(x0, yb, z0), parent=body, grime=prop_grime(32, floor=1.0))
    return body


def ammo_rack():
    g = Geo(seed=141)
    g.add(bx(-0.8, 0.8, 0.26, 0.3, 0.0, 1.9), C["panel3"])
    for xa, xb in ((-0.8, -0.75), (0.75, 0.8)):
        g.add(bx(xa, xb, -0.3, 0.3, 0.0, 1.92, bevel=0.01), C["rib"])
    g.add(bx(-0.82, 0.82, -0.32, 0.32, 1.88, 1.94, bevel=0.012), C["rib"])
    g.add(bx(-0.78, 0.78, -0.28, 0.28, 0.0, 0.1), C["dark"])
    for z in (0.66, 1.26):
        g.add(bx(-0.75, 0.75, -0.28, 0.26, z - 0.04, z), C["steel"], top=0.35)
    # bottom: ammo boxes
    for i, (x, z, w, h) in enumerate(((-0.7, 0.1, 0.45, 0.26), (-0.22, 0.1, 0.45, 0.26), (0.28, 0.1, 0.4, 0.3),
                                      (-0.62, 0.36, 0.42, 0.24), (-0.15, 0.36, 0.4, 0.22))):
        g.add(bx(x, x + w, -0.22, 0.22, z, z + h, bevel=0.01), C["olive"] if i % 2 else C["olive_dk"])
        g.add(bx(x + 0.05, x + w - 0.05, -0.226, -0.22, z + h * 0.45, z + h * 0.6), C["haz"], jitter=0.06)
        g.add(bx(x + w / 2 - 0.06, x + w / 2 + 0.06, -0.22, 0.0, z + h, z + h + 0.025), C["dark"])
    # middle: row of magazines
    for i in range(11):
        x = -0.7 + i * 0.13
        g.add(bx(x, x + 0.06, -0.2, -0.05, 0.66, 0.66 + 0.2 + (i % 3) * 0.02), C["dark"] if i % 4 else C["panel"])
        g.add(bx(x + 0.005, x + 0.055, -0.205, -0.2, 0.84, 0.86), "#8a6a2f")
    # top: weapon cases + ammo can
    g.add(bx(-0.72, 0.28, -0.22, 0.2, 1.26, 1.42, bevel=0.015), C["olive_dk"])
    g.add(bx(-0.66, 0.2, -0.2, 0.18, 1.42, 1.56, bevel=0.015), C["olive"])
    g.add(bx(0.36, 0.7, -0.18, 0.18, 1.26, 1.5, bevel=0.012), "#5a2a22")
    g.add(bx(0.38, 0.68, -0.186, -0.18, 1.36, 1.4), C["haz"], jitter=0.06)
    body = g.build("ammo_rack", grime=prop_grime(41, h=1.6))
    d = Geo(seed=142)
    x0, x1, z0, z1, y = -0.75, 0.75, 0.1, 1.86, -0.32
    for xa, xb, za, zb in ((x0, x1, z0, z0 + 0.05), (x0, x1, z1 - 0.05, z1), (x0, x0 + 0.05, z0, z1),
                           (x1 - 0.05, x1, z0, z1), (x0, x1, 0.95, 1.0)):
        d.add(bx(xa, xb, y - 0.02, y + 0.01, za, zb, bevel=0.006), C["steel"], top=0.35)
    for i in range(1, 9):
        x = x0 + i * (x1 - x0) / 9
        d.add(bx(x - 0.007, x + 0.007, y - 0.012, y, z0, z1), C["dark"])
    d.add(bx(0.58, 0.72, y - 0.05, y, 0.95, 1.18, bevel=0.01), C["rib"])          # lock box
    d.glow(bx(0.62, 0.68, y - 0.054, y - 0.05, 1.1, 1.14), "amber")
    d.add(bx(-0.3, 0.3, y - 0.03, y - 0.02, 1.7, 1.82), "#6a2a22", jitter=0.04)
    d.add(stencil("AMMO", 0.0, 1.8, y - 0.032, px=0.02, anchor="center"), C["stencil"], jitter=0.0)
    d.build("ammo_rack_door", origin=(x0, y, z0), parent=body, grime=prop_grime(42, h=1.6))
    return body


# ================================================================ static props

def barrel():
    g = Geo(seed=151)
    r, n = 0.42, 16
    g.add(cyl(r, 1.02, (0, 0, 0.51), verts=n), C["drum"], jitter=0.06)
    for z in (0.0025, 0.33, 0.71, 1.0):
        g.add(cyl(r + 0.02, 0.045, (0, 0, z + 0.02), verts=n), "#4a2a1c")
    # hazard band: twisted ring, alternate faces yellow/black -> diagonal stripes
    m = 28
    za, zb = 0.43, 0.62
    rr = r + 0.006
    bands = (bmesh.new(), bmesh.new())
    for i in range(m):
        bm = bands[(i // 2) % 2]
        a0, a1 = 2 * math.pi * i / m, 2 * math.pi * (i + 1) / m
        t = 2 * math.pi * 1.3 / m   # twist -> diagonal stripes
        vs = [bm.verts.new(p) for p in ((rr * math.cos(a0), rr * math.sin(a0), za), (rr * math.cos(a1), rr * math.sin(a1), za),
                                         (rr * math.cos(a1 + t), rr * math.sin(a1 + t), zb), (rr * math.cos(a0 + t), rr * math.sin(a0 + t), zb))]
        bm.faces.new(vs)
    g.add(bands[0], C["haz"], jitter=0.08)
    g.add(bands[1], C["haz_dk"], jitter=0.08)
    for x, y in ((0.18, 0.1), (-0.2, -0.05)):   # bungs
        g.add(cyl(0.05, 0.04, (x, y, 1.05), verts=6), C["dark"])
    # toxic ooze spilling over the rim
    g.add(tube([(0.12, -0.42, 1.03), (0.13, -0.435, 0.95), (0.11, -0.44, 0.84), (0.12, -0.44, 0.76)], 0.02, verts=4),
          C["slime_lt"], jitter=0.1)
    g.add(lump((0.1, -0.2, 1.03), 0.12, seed=3, seg=7, rings=4, rough=0.2, scale=(1.3, 1.6, 0.18)), C["slime"])
    g.add(poly_prism(blob(-0.2, 0.2, 0.1, 0.08, 7, 4), -0.43, -0.4), C["rust_dk"])
    g.add(stencil("TX-4", -0.1, 0.92, -0.43, px=0.014), C["stencil"], jitter=0.0)
    return g.build("barrel", grime=prop_grime(51))


def bigcrate():
    g = Geo(seed=161)
    g.add(bx(-1.28, 1.28, -0.78, 0.78, 0.0, 2.2), C["container"])
    for i in range(12):   # corrugation
        x = -1.08 + i * 0.196
        g.add(bx(x, x + 0.1, -0.81, -0.78, 0.16, 2.04, bevel=0.012), C["container"], top=0.3, jitter=0.08)
    for xa, xb in ((-1.3, -1.16), (1.16, 1.3)):
        g.add(bx(xa, xb, -0.82, 0.82, 0.0, 2.2, bevel=0.012), C["rib"])
        for z0 in (0.0, 2.06):
            g.add(bx(xa - 0.005, xb + 0.005, -0.83, -0.7, z0, z0 + 0.14, bevel=0.01), C["steel"])
            g.add(bx((xa + xb) / 2 - 0.03, (xa + xb) / 2 + 0.03, -0.835, -0.83, z0 + 0.04, z0 + 0.1), C["void"])
    for z0, z1 in ((0.0, 0.16), (2.04, 2.2)):
        g.add(bx(-1.16, 1.16, -0.83, 0.83, z0, z1, bevel=0.01), C["panel3"])
    g.add(bx(-1.0, -0.1, -0.815, -0.81, 1.65, 1.95), "#1c1d1e", jitter=0.02)
    g.add(stencil("HX-2291", -0.95, 1.9, -0.822, px=0.03), "#8a8676", jitter=0.03)
    g.add(stencil("MAX 24T", -0.95, 1.62, -0.822, px=0.016), "#7c786a", jitter=0.03)
    g.add(stripes(0.5, 1.1, 0.16, 0.5, -0.822, width=0.1, slant=0.8), C["haz"], jitter=0.1)
    rust(g, 0.2, 0.5, 0.35, 0.2, -0.822, 17)
    rust(g, -0.7, 1.2, 0.18, 0.28, -0.822, 19, two=False)
    return g.build("bigcrate", grime=prop_grime(61, h=2.0))


def _console_shell(g, broken=False):
    """Terminal desk shared by `console` and `console_broken`: base cabinet, sloped keyboard deck,
    monitor bank. Returns nothing; the callers add screens and damage."""
    g.add(plate(-0.9, 0.9, 0.08, 0.78, -0.32, 0.35, steps=[(0.05, -0.015)], bevel=0.02), C["panel3"])
    g.add(bx(-0.86, 0.86, -0.26, 0.3, 0.0, 0.08), C["dark"])
    for i in range(6):
        x = -0.5 + i * 0.06
        g.add(bx(x, x + 0.03, -0.312, -0.3, 0.2, 0.45), C["void"])
    g.add(yz_prism([(-0.46, 0.76), (-0.46, 0.83), (0.18, 1.02), (0.36, 1.02), (0.36, 0.76)], -0.92, 0.92), C["rib"])
    ang = math.degrees(math.atan2(0.19, 0.64))
    rnd = random.Random(7)
    for rw in range(3):
        t = 0.2 + rw * 0.25
        yk, zk = -0.46 + 0.64 * t, 0.83 + 0.19 * t
        for i in range(10):
            x = -0.78 + i * 0.13 + (0.1 if i >= 5 else 0.0)
            if x > 0.8:
                continue
            roll = rnd.random()
            if broken and (roll < 0.35 or abs(x + 0.2) < 0.3):
                continue   # keys ripped out around the impact
            k = bx(x, x + 0.08, yk - 0.03, yk + 0.03, zk, zk + 0.02)
            rotate(k, ang, "X", (x, yk, zk))
            if broken:
                g.add(k, C["steel"] if roll > 0.6 else C["dark"], top=0.4)
            elif roll < 0.2:
                g.glow(k, "amber")
            elif roll < 0.3:
                g.glow(k, "glow")
            elif roll < 0.35:
                g.glow(k, "red")
            else:
                g.add(k, C["steel"], top=0.4)


def console():
    g = Geo(seed=171)
    _console_shell(g)
    g.add(bx(-0.82, 0.82, 0.12, 0.4, 1.0, 1.8, bevel=0.025), C["panel3"])
    g.add(yz_prism([(0.05, 1.8), (0.4, 1.8), (0.4, 1.86), (0.0, 1.84)], -0.84, 0.84), C["rib"])
    for xa, xb, kind, seed in ((-0.74, -0.04, "text", 1), (0.04, 0.74, "radar", 2)):
        g.add(bx(xa - 0.02, xb + 0.02, 0.1, 0.12, 1.08, 1.72), C["dark"])
        screen_content(g, xa, xb, 1.12, 1.68, 0.095, seed, kind)
    g.add(tube([(0.7, 0.4, 1.3), (0.8, 0.42, 1.0), (0.84, 0.4, 0.6)], 0.03, verts=5), C["cable"])
    g.add(stencil("NAV-2", -0.86, 0.72, -0.335, px=0.014), C["stencil"], jitter=0.0)
    return g.build("console", grime=prop_grime(71))


def bunk():
    g = Geo(seed=181)
    for x in (-1.16, 1.16):
        for y in (-0.42, 0.42):
            g.add(bx(x - 0.035, x + 0.035, y - 0.035, y + 0.035, 0.0, 1.95, bevel=0.01), C["rib"])
    for z in (0.35, 1.3):
        g.add(bx(-1.2, 1.2, -0.46, 0.46, z, z + 0.1, bevel=0.012), C["panel3"])
        g.add(bx(-1.12, 1.12, -0.42, 0.42, z + 0.1, z + 0.25, bevel=0.04), C["cloth"], jitter=0.06)
        g.add(bx(-1.1, -0.78, -0.3, 0.3, z + 0.25, z + 0.35, bevel=0.035), C["cloth_lt"])   # pillow
        g.add(studs(row(-1.05, 1.05, 6, -0.46, z + 0.05), s=0.012, h=0.01), C["steel"])
    for x0, x1 in ((-1.2, -1.12), (1.12, 1.2)):   # head/foot boards
        for z0, z1 in ((0.45, 0.85), (1.4, 1.8)):
            g.add(bx(x0, x1, -0.4, 0.4, z0, z1), C["panel"])
    # rumpled blanket (lower) and one hanging over the front edge (upper)
    rnd = random.Random(3)
    for i in range(4):
        x = -0.4 + i * 0.38
        b = bx(x - 0.24, x + 0.24, -0.44, 0.4, 0.6, 0.66, bevel=0.02)
        rotate(b, rnd.uniform(-6, 6), "Y", (x, 0, 0.63))
        g.add(b, C["blanket"], jitter=0.08)
    g.add(bx(-0.3, 0.7, -0.44, 0.38, 1.55, 1.6, bevel=0.015), C["blanket"])
    g.add(yz_prism([(-0.44, 1.6), (-0.47, 1.58), (-0.5, 1.2), (-0.46, 1.18), (-0.43, 1.55)], -0.25, 0.62), C["blanket"])
    # guard rail + ladder on the front
    g.add(bx(-1.12, 0.3, -0.47, -0.43, 1.68, 1.72), C["steel"])
    for x in (-0.6, 0.25):
        g.add(bx(x - 0.015, x + 0.015, -0.47, -0.44, 1.55, 1.7), C["steel"])
    for x in (0.78, 1.04):
        g.add(bx(x - 0.02, x + 0.02, -0.5, -0.46, 0.0, 1.72), C["steel"])
    for z in (0.3, 0.62, 0.94, 1.26):
        g.add(bx(0.78, 1.04, -0.5, -0.47, z - 0.015, z + 0.015), C["steel_lt"], top=0.4)
    return g.build("bunk", grime=prop_grime(81, h=1.5))


def medbed():
    g = Geo(seed=191)
    g.add(bx(-0.55, 0.55, -0.32, 0.32, 0.0, 0.07, bevel=0.015), C["rib"])
    g.add(plate(-0.3, 0.3, 0.07, 0.52, -0.22, 0.22, steps=[(0.03, -0.01)], bevel=0.015), C["panel3"])
    g.add(bx(-1.05, 1.05, -0.4, 0.4, 0.52, 0.62, bevel=0.015), C["steel"])
    g.add(bx(-0.45, 1.02, -0.38, 0.38, 0.62, 0.72, bevel=0.03), C["med"])
    back = bx(-1.02, -0.45, -0.38, 0.38, 0.62, 0.72, bevel=0.03)
    rotate(back, 28, "Y", (-0.45, 0, 0.67))
    g.add(back, C["med"])
    g.add(bx(-0.95, -0.7, -0.3, 0.3, 0.9, 0.96, bevel=0.025), C["cloth_lt"])
    for x in (0.05, 0.55):   # restraint straps
        g.add(bx(x - 0.04, x + 0.04, -0.395, 0.395, 0.61, 0.735), C["leather"])
        g.add(bx(x - 0.02, x + 0.02, -0.4, -0.395, 0.66, 0.7), C["steel_lt"])
    g.add(bx(-0.7, 0.8, -0.46, -0.42, 0.8, 0.84), C["steel_lt"], top=0.4)     # side rail
    for x in (-0.6, 0.1, 0.7):
        g.add(bx(x - 0.015, x + 0.015, -0.45, -0.43, 0.6, 0.8), C["steel"])
    g.add(poly_prism(blob(0.35, 0.67, 0.18, 0.04, 7, 9, jag=0.5), -0.39, -0.37), C["blood"], jitter=0.1)
    g.add(lump((0.4, -0.1, 0.72), 0.2, seed=4, seg=7, rings=4, rough=0.3, scale=(1.3, 1.0, 0.05)), C["blood"])
    # monitor arm
    g.add(pipe((1.12, 0.28, 0.0), (1.12, 0.28, 1.95), 0.03, verts=6), C["steel"])
    g.add(cyl(0.12, 0.04, (1.12, 0.28, 0.02), verts=8), C["rib"])
    g.add(tube([(1.12, 0.28, 1.9), (0.9, 0.2, 1.92), (0.7, 0.05, 1.9)], 0.022, verts=5), C["steel"])
    g.add(bx(0.35, 0.85, -0.02, 0.06, 1.5, 1.88, bevel=0.015), C["rib"])
    screen_content(g, 0.39, 0.81, 1.54, 1.84, -0.03, 5, "ecg")
    g.add(tube(sag((0.8, 0.02, 1.5), (1.1, 0.25, 1.1), 0.1, 4), 0.012, verts=4), C["cable"])
    return g.build("medbed", grime=prop_grime(91))


def shelf():
    g = Geo(seed=201)
    for x in (-0.98, 0.98):
        for y in (-0.22, 0.22):
            g.add(bx(x - 0.025, x + 0.025, y - 0.025, y + 0.025, 0.0, 2.2), C["rib"])
        g.add(studs(col(0.2, 2.0, 8, x, -0.247), s=0.008, h=0.006), C["void"])
    xb = tube([(-0.96, 0.24, 0.1), (0.96, 0.24, 2.1)], 0.012, verts=4)
    g.add(xb, C["dark"])
    g.add(tube([(0.96, 0.24, 0.1), (-0.96, 0.24, 2.1)], 0.012, verts=4), C["dark"])
    rnd = random.Random(20)
    palette = [C["olive"], C["olive_dk"], C["panel"], "#4a4032", C["orange"], "#2f4a44", "#5a2a22"]
    for zs in (0.08, 0.65, 1.22, 1.79):
        g.add(bx(-1.0, 1.0, -0.25, 0.25, zs - 0.035, zs), C["steel"], top=0.35)
        g.add(bx(-1.0, 1.0, -0.26, -0.24, zs - 0.06, zs + 0.015), C["dark"])
        if zs > 1.7:
            limit = 0.36
        else:
            limit = 0.5
        x = -0.92
        while x < 0.85:
            kind = rnd.random()
            w = rnd.uniform(0.18, 0.42)
            if x + w > 0.93:
                break
            h = rnd.uniform(0.15, limit)
            rgb = rnd.choice(palette)
            if kind < 0.55:
                b = bx(x, x + w, -0.2, rnd.uniform(0.1, 0.22), zs, zs + h, bevel=0.01)
                rotate(b, rnd.uniform(-4, 4), "Z", (x + w / 2, 0, zs))
                g.add(b, rgb, jitter=0.07)
                if w > 0.28 and rnd.random() < 0.6:
                    g.add(bx(x + 0.04, x + w - 0.04, -0.206, -0.2, zs + h * 0.5, zs + h * 0.62), C["stencil_y"], jitter=0.06)
            elif kind < 0.85:
                n = max(1, int(w / 0.12))
                for k in range(n):
                    rr = w / n / 2 - 0.008
                    g.add(cyl(rr, h * 0.85, (x + rr + k * 2 * (rr + 0.008), -0.05, zs + h * 0.425), verts=7), rgb)
            else:
                g.add(bx(x, x + w, -0.18, 0.1, zs, zs + 0.12, bevel=0.012), "#6a2a22")
                g.add(bx(x + w * 0.3, x + w * 0.7, -0.05, -0.03, zs + 0.12, zs + 0.18), C["dark"])
            x += w + rnd.uniform(0.03, 0.12)
    g.add(bx(-1.02, 1.02, -0.27, 0.27, 2.18, 2.22), C["rib"])
    return g.build("shelf", grime=prop_grime(101, h=1.6))


def table():
    """Mess table with a bench in front, trays and mugs left mid-meal."""
    g = Geo(seed=211)
    g.add(bx(-1.1, 1.1, -0.45, 0.45, 0.74, 0.8, bevel=0.015), C["steel"])
    g.add(bx(-1.08, 1.08, -0.47, -0.44, 0.69, 0.76), C["rib"])
    g.add(studs(row(-0.95, 0.95, 6, -0.47, 0.725), s=0.012, h=0.008), C["steel_lt"])
    for x in (-0.8, 0.8):   # trestles
        g.add(bx(x - 0.05, x + 0.05, -0.3, 0.3, 0.06, 0.69), C["panel3"])
        g.add(bx(x - 0.08, x + 0.08, -0.4, 0.4, 0.0, 0.06, bevel=0.012), C["rib"])
    g.add(bx(-0.75, 0.75, -0.04, 0.04, 0.2, 0.28), C["panel3"])
    for sx in (-1, 1):
        g.add(tube([(sx * 0.1, -0.05, 0.28), (sx * 0.75, -0.05, 0.66)], 0.022, verts=4, phase=math.pi / 4), C["rib"])
    # front bench
    g.add(bx(-1.0, 1.0, -0.82, -0.56, 0.42, 0.47, bevel=0.012), C["steel"])
    for x in (-0.75, 0.75):
        g.add(bx(x - 0.04, x + 0.04, -0.72, -0.66, 0.0, 0.42), C["rib"])
    # meal left behind
    for x, rgb in ((-0.62, C["panel"]), (0.18, C["panel2"])):
        g.add(bx(x - 0.2, x + 0.2, -0.3, 0.02, 0.8, 0.825, bevel=0.006), rgb)
        g.add(lump((x - 0.07, -0.16, 0.825), 0.06, seed=int(x * 10) & 7, seg=6, rings=4, rough=0.3,
                   scale=(1.3, 1.0, 0.45), cut="bottom"), "#5a4a2c")
        g.add(lump((x + 0.08, -0.12, 0.825), 0.045, seed=5, seg=6, rings=4, rough=0.3, scale=(1.2, 1.0, 0.5),
                   cut="bottom"), "#4a5a30")
    for x, y in ((-0.28, -0.2), (0.55, 0.12)):
        g.add(cyl(0.042, 0.1, (x, y, 0.85), verts=7), "#6a6a5e")
        g.add(cyl(0.043, 0.015, (x, y, 0.87), verts=7), C["valve"])
    g.add(cyl(0.035, 0.24, (0.72, -0.22, 0.835), rot=(0, 82, 20), verts=7), "#3f5a4a")
    g.add(lump((0.9, -0.3, 0.8), 0.13, seed=2, seg=7, rings=4, rough=0.3, scale=(1.4, 1.0, 0.04)), "#2a2f22")
    for i in range(3):
        g.add(cyl(0.1, 0.012, (-0.1, 0.2, 0.806 + i * 0.013), verts=8), "#6a6a5e")
    return g.build("table", grime=prop_grime(111))


def reactor():
    g = Geo(seed=221)
    sy = 0.58   # squash depth so the core stays inside the room (render depth y=1.0)
    for r, z0, h, rgb in ((1.7, 0.0, 0.22, C["rib"]), (1.38, 0.22, 0.2, C["panel3"]), (1.08, 0.42, 0.16, C["rib"])):
        c = cyl(r, h, (0, 0, z0 + h / 2), verts=20)
        for v in c.verts:
            v.co.y *= sy
        g.add(c, rgb)
    g.add(stripes(-1.2, 1.2, 0.24, 0.4, -1.38 * sy - 0.012, width=0.12, slant=0.8), C["haz"], jitter=0.1)
    g.add(bx(-1.3, 1.3, -1.38 * sy + 0.0, -1.38 * sy + 0.02, 0.24, 0.4), C["haz_dk"])
    g.add(stencil("CORE 01", 0.0, 0.17, -1.7 * sy - 0.012, px=0.022, anchor="center"), C["stencil_y"], jitter=0.0)
    g.add(studs(row(-1.45, 1.45, 10, -1.7 * sy - 0.005, 0.11), s=0.02, h=0.015), C["steel_lt"])
    # core with glow rings and collars
    core_r = 0.72
    g.add(cyl(core_r, 3.0, (0, 0, 2.08), verts=16), C["panel2"])
    for z in (1.0, 1.7, 2.4, 3.1):
        g.glow(cyl(core_r + 0.05, 0.1, (0, 0, z), verts=16), "glow")
        for dz in (-0.08, 0.08):
            g.add(cyl(core_r + 0.1, 0.05, (0, 0, z + dz), verts=16), C["steel"])
    # containment ribs
    for k in range(8):
        a = math.radians(22.5 + 45 * k)
        x, y = (core_r + 0.12) * math.cos(a), (core_r + 0.12) * math.sin(a)
        rb = bx(-0.05, 0.05, -0.05, 0.05, 0.58, 3.6, bevel=0.012)
        rotate(rb, math.degrees(a), "Z")
        move(rb, (x, y, 0))
        g.add(rb, C["rib"])
    # glowing inspection slit on the front
    g.add(bx(-0.12, 0.12, -core_r - 0.03, -core_r + 0.05, 1.18, 1.52), C["dark"])
    g.glow(bx(-0.07, 0.07, -core_r - 0.04, -core_r - 0.03, 1.22, 1.48), "glow")
    # top cap
    g.add(cyl(core_r + 0.14, 0.28, (0, 0, 3.72), verts=16, r2=0.48), C["panel3"])
    g.add(cyl(0.36, 0.26, (0, 0, 3.98), verts=12), C["rib"])
    g.add(cyl(0.4, 0.05, (0, 0, 4.0), verts=12), C["steel"])
    # coolant conduits arcing from the cap to the base
    for sx in (-1, 1):
        for y, r, rgb in ((-0.32, 0.09, C["pipe_g"]), (0.32, 0.11, C["pipe"])):
            pts = [(sx * 0.5, y, 3.75), (sx * 1.0, y, 3.65), (sx * 1.3, y, 3.2), (sx * 1.42, y, 2.4),
                   (sx * 1.42, y, 0.9), (sx * 1.35, y, 0.45)]
            g.add(tube(pts, r, verts=8), rgb)
            for zc in (1.6, 2.8):
                g.add(pipe((sx * 1.42, y, zc - 0.05), (sx * 1.42, y, zc + 0.05), r + 0.03, verts=8), C["steel"])
        st = tube([(sx * 1.25, -0.2, 0.42), (sx * 0.86, -0.2, 2.05)], 0.05, verts=6)
        g.add(st, C["rib"])
    g.add(cyl(0.05, 0.1, (0.0, -core_r - 0.1, 3.4), rot=(90, 0, 0), verts=8), C["dark"])
    g.glow(cyl(0.035, 0.02, (0.0, -core_r - 0.16, 3.4), rot=(90, 0, 0), verts=8), "red")
    return g.build("reactor", grime=prop_grime(121, floor=0.75, h=1.0))


def pilot_seat():
    """Command chair seen in profile, facing +X (toward the control panel)."""
    g = Geo(seed=231)
    g.add(cyl(0.34, 0.05, (0, 0, 0.025), verts=10), C["rib"])
    g.add(cyl(0.07, 0.38, (0, 0, 0.24), verts=8), C["steel"])
    g.add(bx(-0.3, 0.3, -0.26, 0.26, 0.38, 0.44), C["panel3"])
    g.add(bx(-0.32, 0.36, -0.28, 0.28, 0.44, 0.58, bevel=0.04), C["leather"])
    for i in range(3):   # segmented backrest, reclined
        z0 = 0.62 + i * 0.26
        b = bx(-0.42, -0.26, -0.26, 0.26, z0, z0 + 0.24, bevel=0.035)
        rotate(b, -12, "Y", (-0.3, 0, 0.55))
        g.add(b, C["leather"])
    frame = bx(-0.47, -0.42, -0.2, 0.2, 0.5, 1.45, bevel=0.01)
    rotate(frame, -12, "Y", (-0.3, 0, 0.55))
    g.add(frame, C["rib"])
    hr = bx(-0.48, -0.3, -0.18, 0.18, 1.42, 1.62, bevel=0.04)
    rotate(hr, -12, "Y", (-0.3, 0, 0.55))
    g.add(hr, C["leather"])
    for y in (-0.33, 0.33):   # armrests + consoles
        g.add(bx(-0.3, 0.32, y - 0.05, y + 0.05, 0.74, 0.82, bevel=0.02), C["panel3"])
        g.add(bx(0.2, 0.26, y - 0.03, y + 0.03, 0.52, 0.74), C["rib"])
    g.add(bx(0.08, 0.34, -0.39, -0.36, 0.76, 0.84), C["dark"])
    for i, key in enumerate(("amber", "glow", "red")):
        g.glow(bx(0.11 + i * 0.075, 0.16 + i * 0.075, -0.395, -0.39, 0.785, 0.815), key)
    g.add(tube([(0.25, 0.0, 0.3), (0.42, 0.0, 0.22), (0.52, 0.0, 0.22)], 0.025, verts=6), C["steel"])   # footrest
    g.add(bx(0.44, 0.54, -0.18, 0.18, 0.18, 0.24, bevel=0.01), C["rib"])
    g.add(tube([(-0.05, 0.1, 0.1), (-0.3, 0.2, 0.25), (-0.45, 0.2, 0.7)], 0.02, verts=4), C["cable"])
    return g.build("pilot_seat", grime=prop_grime(131))


def control_panel():
    g = Geo(seed=241)
    # base with three bays
    g.add(bx(-1.2, 1.2, -0.22, 0.45, 0.08, 0.82, bevel=0.02), C["panel3"])
    g.add(bx(-1.16, 1.16, -0.16, 0.42, 0.0, 0.08), C["dark"])
    for xa in (-1.12, -0.36, 0.4):
        g.add(plate(xa, xa + 0.72, 0.14, 0.74, -0.235, -0.2, steps=[(0.03, -0.01)]), C["panel2"])
    for i in range(8):
        x = -0.28 + i * 0.07
        g.add(bx(x, x + 0.035, -0.245, -0.235, 0.25, 0.55), C["void"])
    g.add(stripes(-1.2, 1.2, 0.0, 0.08, -0.18, width=0.08, slant=0.8), C["haz"], jitter=0.1)
    # sloped desk with many buttons
    g.add(yz_prism([(-0.56, 0.8), (-0.56, 0.88), (0.14, 1.1), (0.45, 1.1), (0.45, 0.8)], -1.22, 1.22), C["rib"])
    ang = math.degrees(math.atan2(0.22, 0.7))
    rnd = random.Random(24)
    for rw in range(3):
        t = 0.18 + rw * 0.27
        yk, zk = -0.56 + 0.7 * t, 0.88 + 0.22 * t
        for i in range(16):
            x = -1.1 + i * 0.14
            if abs(x + 0.03) < 0.14 and rw < 2:
                continue   # leave room for the throttles
            k = bx(x, x + 0.09, yk - 0.035, yk + 0.035, zk, zk + 0.022)
            rotate(k, ang, "X", (x, yk, zk))
            roll = rnd.random()
            if roll < 0.28:
                g.glow(k, "amber")
            elif roll < 0.45:
                g.glow(k, "glow")
            elif roll < 0.52:
                g.glow(k, "red")
            else:
                g.add(k, C["steel"], top=0.4)
    for x in (-0.06, 0.06):   # throttle levers
        g.add(tube([(x, -0.3, 0.95), (x, -0.36, 1.12)], 0.015, verts=4), C["steel_lt"])
        g.add(lump((x, -0.36, 1.14), 0.035, seed=1, seg=6, rings=4, rough=0.0), "#6a2a22")
    # display bank: big nav screen + two angled side screens
    g.add(bx(-0.66, 0.66, 0.24, 0.46, 1.1, 2.12, bevel=0.03), C["panel3"])
    g.add(bx(-0.6, 0.6, 0.22, 0.24, 1.16, 2.06), C["dark"])
    g.add(bx(-0.56, 0.56, 0.212, 0.222, 1.2, 2.02), C["screen"], jitter=0.0)
    y = 0.208
    cx, cz = -0.05, 1.6
    for rr in (0.34, 0.2):
        g.glow(tube([(cx + rr * math.cos(a), y, cz + rr * 0.9 * math.sin(a)) for a in [2 * math.pi * i / 18 for i in range(19)]],
                    0.006, verts=3, caps=False))
    route = [(-0.48, y, 1.28), (-0.3, y, 1.42), (-0.12, y, 1.5), (0.1, y, 1.74), (0.32, y, 1.82), (0.46, y, 1.9)]
    g.glow(tube(route, 0.008, verts=3, caps=False), "amber")
    for px, pz, key in ((-0.3, 1.42, "glow"), (0.1, 1.74, "glow"), (0.46, 1.9, "red"), (0.22, 1.36, "red")):
        g.glow(bx(px - 0.02, px + 0.02, y - 0.003, y, pz - 0.02, pz + 0.02), key)
    for i in range(4):
        g.glow(bx(0.3, 0.3 + 0.08 + (i % 2) * 0.1, y, y + 0.003, 1.3 + i * 0.05, 1.315 + i * 0.05))
    g.glow(bx(-0.52, 0.52, y, y + 0.003, 1.96, 1.99))
    for sx in (-1, 1):   # side screens, angled toward the centre
        side = Geo(seed=242 + sx)
        xa, xb = (0.7, 1.2) if sx > 0 else (-1.2, -0.7)
        side.add(bx(xa, xb, 0.2, 0.36, 1.12, 1.9, bevel=0.02), C["panel3"])
        screen_content(side, xa + 0.04, xb - 0.04, 1.18, 1.84, 0.185, 3 + sx, "bars" if sx > 0 else "text")
        piv = Vector((0.7 * sx, 0.3, 0))
        m = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(20 * sx), 4, "Z") @ Matrix.Translation(-piv)
        g.absorb(side, m)
    # light bar + objective beacon
    g.add(bx(-0.7, 0.7, 0.22, 0.48, 2.12, 2.2, bevel=0.012), C["rib"])
    for x in (-0.5, 0.5):
        g.glow(bx(x - 0.06, x + 0.06, 0.2, 0.22, 2.14, 2.18), "amber")
    g.add(cyl(0.06, 0.08, (0, 0.34, 2.24), verts=8), C["dark"])
    g.glow(lump((0, 0.34, 2.3), 0.055, seed=0, seg=8, rings=4, rough=0.0), "red")
    g.add(stencil("NAVIGATION CORE", 0.0, 1.08, 0.2, px=0.012, anchor="center"), C["stencil_y"], jitter=0.0)
    g.add(tube([(0.62, 0.46, 1.3), (0.8, 0.5, 1.0), (0.95, 0.46, 0.84)], 0.035, verts=5), C["cable"])
    g.add(tube([(-0.62, 0.46, 1.4), (-0.85, 0.5, 1.1), (-0.95, 0.46, 0.84)], 0.03, verts=5), C["cable_r"])
    return g.build("control_panel", grime=prop_grime(141))


def debris():
    """Collapsed wreckage pile on the walking line (~1.5 m wide, ~0.8 m high): the squad jumps it."""
    g = Geo(seed=251)
    rnd = random.Random(25)
    g.add(lump((0.0, 0.0, 0.0), 0.8, seed=9, seg=10, rings=4, rough=0.2, scale=(0.85, 0.75, 0.2), cut="bottom"),
          "#262726", jitter=0.12)
    for i in range(9):   # rubble chunks
        x = rnd.uniform(-0.55, 0.55)
        y = rnd.uniform(-0.45, 0.45)
        r = rnd.uniform(0.1, 0.18)
        g.add(lump((x, y, 0.0), r, seed=i, seg=6, rings=4, rough=0.35, scale=(1.3, 1.1, 1.0), cut="bottom"),
              rnd.choice([C["panel3"], C["rib"], C["rust_dk"], "#3a3a36"]), jitter=0.12)
    # tilted hull plates, the first still carrying hazard paint (stripes built in the plate's frame)
    for k, (x, z, ry, rx, w, h, rgb) in enumerate(((-0.22, 0.28, 32, 10, 0.85, 0.46, C["panel"]),
                                                   (0.33, 0.26, -48, -15, 0.66, 0.42, C["panel2"]),
                                                   (0.05, 0.45, 68, 5, 0.56, 0.3, C["rust_dk"]))):
        off = (x, -0.12 + rnd.uniform(-0.15, 0.15), z)
        parts = [(bx(-w / 2, w / 2, -0.03, 0.03, -h / 2, h / 2, bevel=0.01), rgb)]
        if k == 0:
            parts.append((stripes(-w / 2 + 0.05, w / 2 - 0.05, -h / 2 + 0.04, -h / 2 + 0.14, -0.032, width=0.06,
                                  slant=0.8), C["haz"]))
            parts.append((studs(row(-w / 2 + 0.08, w / 2 - 0.08, 4, -0.03, h / 2 - 0.06), s=0.015, h=0.01), C["steel_lt"]))
        for bm, col_ in parts:
            rotate(bm, rx, "Z")
            rotate(bm, ry, "Y")
            move(bm, off)
            g.add(bm, col_, jitter=0.1)
    gb = bx(-0.42, 0.42, -0.06, 0.06, -0.07, 0.07)   # bent girder stub
    rotate(gb, 18, "Y")
    move(gb, (0.22, 0.22, 0.5))
    g.add(gb, C["rib"])
    g.add(tube([(-0.68, -0.2, 0.05), (-0.5, -0.25, 0.28), (-0.3, -0.3, 0.56), (-0.12, -0.28, 0.66)], 0.05, verts=6),
          C["pipe_cu"])
    g.add(tube([(0.2, -0.3, 0.1), (0.35, -0.35, 0.38), (0.52, -0.3, 0.5), (0.66, -0.36, 0.45)], 0.015, verts=4),
          C["cable_r"])
    g.glow(lump((0.67, -0.37, 0.45), 0.02, seed=0, seg=5, rings=3, rough=0.0), "amber")   # sparking end
    g.squash("z", 0.0, 0.08)   # plates that dip below the floor are buried in the rubble
    return g.build("debris", grime=prop_grime(151, h=0.8))


def beam():
    """Fallen truss girder hanging across the walkway: underside at 1.3 m, top at 2.2 m.
    Two torn cables still tie its high end to the ceiling (z = 4.5)."""
    g = Geo(seed=261)
    L, H, D, tilt = 1.66, 0.44, 0.14, 16.3
    ch = 0.09
    parts = [(bx(-L / 2, L / 2, -D, D, H / 2 - ch, H / 2, bevel=0.01), C["rib"]),
             (bx(-L / 2, L / 2, -D, D, -H / 2, -H / 2 + ch, bevel=0.01), C["rib"]),
             (bx(-L / 2, L / 2, -0.02, 0.02, -H / 2 + ch, H / 2 - ch), C["back"])]   # dark web plate behind the lacing
    bays = 5
    for i in range(bays):
        xa = -L / 2 + 0.06 + i * (L - 0.12) / bays
        xb = xa + (L - 0.12) / bays
        za, zb = (-H / 2 + ch, H / 2 - ch) if i % 2 == 0 else (H / 2 - ch, -H / 2 + ch)
        parts.append((tube([(xa, -D * 0.65, za), (xb, -D * 0.65, zb)], 0.035, verts=4, phase=math.pi / 4), C["panel"]))
    for xe in (L / 2 - 0.05, -L / 2 + 0.05):   # end gusset plates
        parts.append((bx(xe - 0.05, xe + 0.05, -D - 0.01, D + 0.01, -H / 2, H / 2), C["steel"]))
    parts.append((studs(row(-L / 2 + 0.12, L / 2 - 0.12, 8, -D, H / 2 - ch / 2), s=0.016, h=0.01), C["steel_lt"]))
    parts.append((studs(row(-L / 2 + 0.12, L / 2 - 0.12, 8, -D, -H / 2 + ch / 2), s=0.016, h=0.01), C["steel_lt"]))
    parts.append((stripes(-L / 2 + 0.12, -L / 2 + 0.62, -H / 2, -H / 2 + ch, -D - 0.004, width=0.06, slant=0.8), C["haz"]))
    parts.append((poly_prism([(-L / 2, -H / 2), (-L / 2 - 0.14, -H / 2 + 0.03), (-L / 2 - 0.03, -H / 2 + 0.07)], -D, D), C["rib"]))
    parts.append((poly_prism([(-L / 2, H / 2), (-L / 2 - 0.1, H / 2 - 0.04), (-L / 2, H / 2 - 0.08)], -D, D), C["rib"]))
    s, c = math.sin(math.radians(tilt)), math.cos(math.radians(tilt))
    cz = 1.3 + L / 2 * s + H / 2 * c
    for bm, rgb in parts:
        rotate(bm, -tilt, "Y")
        move(bm, (0, 0, cz))
        g.add(bm, rgb)
    hx, hz = L / 2 * c - 0.12, cz + L / 2 * s + 0.1
    g.add(tube([(hx, -0.06, hz), (hx - 0.06, -0.06, 3.1), (hx - 0.02, -0.06, 4.5)], 0.02, verts=4), C["cable"])
    g.add(tube([(hx - 0.2, 0.07, hz - 0.05), (hx - 0.34, 0.07, 3.3), (hx - 0.28, 0.07, 4.5)], 0.015, verts=4), C["cable_r"])
    g.add(tube([(-0.3, -0.16, 1.42), (-0.33, -0.17, 1.36), (-0.28, -0.17, 1.31)], 0.012, verts=4), C["cable_y"])
    g.squash("z", 1.3, 1.38)
    return g.build("beam", grime=None)


def airlock_hatch():
    g = Geo(seed=271)
    g.add(bx(-0.5, 0.5, -0.36, 0.36, 0.0, 0.06, bevel=0.012), C["rib"])
    g.add(stripes(-0.5, 0.5, 0.0, 0.06, -0.372, width=0.05, slant=0.8), C["haz"], jitter=0.1)
    g.add(plate(-0.24, 0.24, 0.06, 2.1, -0.2, 0.2, steps=[(0.04, -0.012)], bevel=0.025), C["panel3"])
    g.add(bx(-0.24, 0.24, -0.215, -0.2, 0.12, 0.42), C["haz_dk"])
    g.add(stripes(-0.24, 0.24, 0.12, 0.42, -0.222, width=0.07, slant=0.8), C["haz"], jitter=0.1)
    # control box
    g.add(plate(-0.19, 0.19, 0.95, 1.55, -0.3, -0.2, steps=[(0.025, -0.01)], bevel=0.015), C["rib"])
    screen_content(g, -0.14, 0.14, 1.3, 1.5, -0.3, 9, "text")
    for i in range(3):
        for j in range(3):
            key = "red" if (i, j) == (2, 2) else None
            k = bx(-0.13 + i * 0.07, -0.08 + i * 0.07, -0.305, -0.29, 1.02 + j * 0.07, 1.07 + j * 0.07)
            if key:
                g.glow(k, key)
            else:
                g.add(k, C["steel_lt"], top=0.4)
    g.add(stencil("CYCLE", 0.0, 1.27, -0.302, px=0.01, anchor="center"), C["stencil"], jitter=0.0)
    # big pull lever on the right
    g.add(bx(0.24, 0.36, -0.1, 0.1, 0.85, 1.35, bevel=0.015), C["rib"])
    g.add(tube([(0.36, -0.02, 1.1), (0.44, -0.04, 1.3), (0.46, -0.05, 1.52)], 0.022, verts=5), C["steel_lt"])
    g.add(cyl(0.035, 0.14, (0.46, -0.05, 1.56), verts=8), "#8a1c16")
    # conduits on the left
    g.add(tube([(-0.24, 0.05, 1.8), (-0.36, 0.05, 1.7), (-0.4, 0.05, 1.0), (-0.42, 0.1, 0.06)], 0.035, verts=6), C["pipe"])
    g.add(tube([(-0.24, 0.12, 1.6), (-0.3, 0.14, 1.5), (-0.32, 0.16, 0.06)], 0.022, verts=5), C["cable_r"])
    # red beacon on top
    g.add(cyl(0.12, 0.08, (0, 0, 2.14), verts=10), C["rib"])
    g.glow(lump((0, 0, 2.18), 0.09, seed=0, seg=10, rings=5, rough=0.0, scale=(1, 1, 1.3), cut="bottom"), "red")
    for a in (0, 60, 120):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        g.add(tube([(-0.1 * ca, -0.1 * sa, 2.18), (-0.1 * ca, -0.1 * sa, 2.3), (0, 0, 2.33),
                    (0.1 * ca, 0.1 * sa, 2.3), (0.1 * ca, 0.1 * sa, 2.18)], 0.008, verts=3, caps=False), C["dark"])
    g.add(stencil("AIRLOCK", 0.0, 1.95, -0.214, px=0.014, anchor="center"), C["stencil_y"], jitter=0.0)
    return g.build("airlock_hatch", grime=prop_grime(161, h=1.2))


# ================================================================ build / export / preview

# ================================================================ hazards, loot and wreckage (pass 2)

RED = "#9a1f16"
YEL = "#c9a02a"


def _drum_ring(g, r, z, h, rgb, n=16):
    g.add(cyl(r, h, (0, 0, z + h / 2), verts=n), rgb)


def _flame_glyph(g, cx, cz, s, y):
    """Hazard diamond with a flame: pale diamond, black border, black flame + base bar (flat decals)."""
    g.add(flat([(cx, cz - s), (cx + s, cz), (cx, cz + s), (cx - s, cz)], y), "#16181a", jitter=0.0)
    k = s * 0.84
    g.add(flat([(cx, cz - k), (cx + k, cz), (cx, cz + k), (cx - k, cz)], y - 0.003), "#d8cfa4", jitter=0.03)
    f = s * 0.42
    flame = [(cx - f * 0.62, cz - f * 0.55), (cx + f * 0.62, cz - f * 0.55), (cx + f * 0.7, cz - f * 0.05),
             (cx + f * 0.35, cz + f * 0.35), (cx + f * 0.3, cz + f * 0.05), (cx + f * 0.1, cz + f * 0.95),
             (cx - f * 0.2, cz + f * 0.45), (cx - f * 0.45, cz + f * 0.65), (cx - f * 0.7, cz)]
    g.add(flat(flame, y - 0.006), "#16181a", jitter=0.0)
    g.add(flat([(cx - f * 0.8, cz - f * 0.95), (cx + f * 0.8, cz - f * 0.95), (cx + f * 0.8, cz - f * 0.75),
                (cx - f * 0.8, cz - f * 0.75)], y - 0.006), "#16181a", jitter=0.0)


def barrel_explosive():
    """Red fuel drum: two hazard-yellow bands, a flame diamond and a pressure valve. Brighter and
    more saturated than the rust-brown `barrel`, so it reads as dangerous at a glance."""
    g = Geo(seed=171)
    r, n = 0.41, 16
    g.add(cyl(r, 1.02, (0, 0, 0.51), verts=n), RED, jitter=0.05)
    for z0, z1 in ((0.07, 0.22), (0.8, 0.95)):
        _drum_ring(g, r + 0.008, z0, z1 - z0, YEL)
        for zz in (z0, z1 - 0.018):
            _drum_ring(g, r + 0.01, zz, 0.018, "#16181a")
    for z in (0.0025, 0.36, 0.64, 1.0):
        _drum_ring(g, r + 0.02, z, 0.045, "#6a1612")
    _flame_glyph(g, 0.0, 0.5, 0.15, -r - 0.012)
    g.add(stencil("FUEL", 0.0, 0.2, -r - 0.012, px=0.013, anchor="center"), "#16181a", jitter=0.0)
    # top: bungs + pressure valve with a red hand wheel
    g.add(cyl(0.05, 0.04, (-0.2, -0.05, 1.04), verts=6), C["dark"])
    g.add(cyl(0.035, 0.16, (0.14, 0.05, 1.1), verts=6), C["steel"])
    g.add(tube([(0.14 + 0.07 * math.cos(a), 0.05 + 0.07 * math.sin(a), 1.19)
                for a in [2 * math.pi * i / 8 for i in range(9)]], 0.012, verts=3, caps=False), "#c8281c")
    g.add(cyl(0.05, 0.03, (0.14, 0.05, 1.03), verts=6), YEL)
    rust(g, -0.18, 0.72, 0.06, 0.05, -r - 0.004, 5, two=False)
    return g.build("barrel_explosive", grime=prop_grime(172, floor=0.8, stain=0.1))


def barrel_wreck():
    """The fuel drum after it went up: lower shell intact, the top burst into scorched petals
    peeled outward, embers inside and a char mark on the floor."""
    g = Geo(seed=181)
    r, n = 0.41, 16
    red, char = _rgb(RED), _rgb("#141210")

    def burn(co, c):   # paint -> soot toward the tear
        return lerp3(red, char, smooth(0.12, 0.42, co.z))
    g.add(cyl(r, 0.42, (0, 0, 0.21), verts=n, cap=False), RED, vfn=burn, jitter=0.05)
    _drum_ring(g, r + 0.02, 0.0025, 0.045, "#4a1210")
    _drum_ring(g, r + 0.02, 0.33, 0.045, "#2a1a14")
    g.add(cyl(r - 0.01, 0.02, (0, 0, 0.12), verts=n), "#0c0b0a", jitter=0.0)                 # charred inside
    for i, (x, y) in enumerate(((0.1, 0.05), (-0.12, -0.08), (0.02, -0.15))):                   # embers
        g.glow(lump((x, y, 0.15), 0.03, seed=i, seg=5, rings=3, rough=0.2), "amber")
    rnd = random.Random(18)
    k = 9
    for i in range(k):   # petals: strips peeling outward from the tear line, jagged tips
        a = 2 * math.pi * (i + rnd.uniform(-0.15, 0.15)) / k
        half = math.pi / k * rnd.uniform(0.7, 0.95)
        L = rnd.uniform(0.25, 0.45)
        flare = rnd.uniform(0.04, 0.09)
        droop = rnd.uniform(0.0, 0.35)
        rows = []
        for j in range(4):
            u = j / 3
            rr = r + flare * u + 0.02 * u * u
            z = 0.42 + L * u - droop * u * u
            w = half * (1.0 - 0.75 * u)
            rows.append([(rr * math.cos(a + s * w), rr * math.sin(a + s * w), z) for s in (-1, 1)])
        tip = (rows[-1][0][0] * 0.5 + rows[-1][1][0] * 0.5, rows[-1][0][1] * 0.5 + rows[-1][1][1] * 0.5,
               rows[-1][0][2] + rnd.uniform(0.03, 0.09))
        import bmesh as _bm
        bm = _bm.new()
        vs = [[bm.verts.new(p) for p in row] for row in rows]
        for j in range(3):
            bm.faces.new((vs[j][0], vs[j][1], vs[j + 1][1], vs[j + 1][0]))
        bm.faces.new((vs[3][0], vs[3][1], bm.verts.new(tip)))
        bm.normal_update()
        for f in bm.faces:   # outward
            c = f.calc_center_median()
            if f.normal.dot(Vector((c.x, c.y, 0))) < 0:
                f.normal_flip()
        g.add(bm, RED, vfn=burn, jitter=0.08)
    g.add(lump((0, 0, 0.0), 0.5, seed=4, seg=10, rings=4, rough=0.15, scale=(0.84, 0.8, 0.02), cut="bottom"),
          "#151312", jitter=0.1)                                                                   # floor char mark
    for i, (x, y, rz) in enumerate(((0.38, -0.25, 30), (-0.36, -0.3, -50), (0.26, 0.33, 70))):   # shards
        s = bx(-0.06, 0.06, -0.02, 0.02, 0.0, 0.1)
        rotate(s, 70, "Y")
        rotate(s, rz, "Z")
        move(s, (x, y, 0.02))
        g.add(s, "#2a1a14", jitter=0.1)
    g.squash("z", 0.0, 0.04)
    return g.build("barrel_wreck", grime=None)


def console_broken():
    """The terminal smashed: dark cracked screens, a gutted access panel spilling wiring, amber sparks."""
    g = Geo(seed=191)
    _console_shell(g, broken=True)
    # monitor bank knocked askew
    bank = Geo(seed=192)
    bank.add(bx(-0.82, 0.82, 0.12, 0.4, 1.0, 1.8, bevel=0.025), C["panel3"])
    bank.add(yz_prism([(0.05, 1.8), (0.4, 1.8), (0.4, 1.86), (0.0, 1.84)], -0.84, 0.84), C["rib"])
    for xa, xb in ((-0.74, -0.04), (0.04, 0.74)):
        bank.add(bx(xa - 0.02, xb + 0.02, 0.1, 0.12, 1.08, 1.72), C["dark"])
        bank.add(bx(xa, xb, 0.095, 0.105, 1.12, 1.68), "#0a0d0e", jitter=0.0)   # dead screen
    hole = blob(-0.38, 1.42, 0.2, 0.17, 11, 3, jag=0.55)
    bank.add(flat(hole, 0.09), C["void"], jitter=0.0)
    rnd = random.Random(19)
    for i in range(7):   # cracks radiating from the impact
        a = 2 * math.pi * i / 7 + rnd.uniform(-0.3, 0.3)
        pts = [(-0.38 + math.cos(a) * 0.17, 0.088, 1.42 + math.sin(a) * 0.15)]
        for kk in range(1, 3):
            d = 0.17 + kk * rnd.uniform(0.07, 0.13)
            aa = a + rnd.uniform(-0.25, 0.25)
            pts.append((max(-0.73, min(-0.05, -0.38 + math.cos(aa) * d)), 0.088,
                        max(1.13, min(1.67, 1.42 + math.sin(aa) * d))))
        bank.add(tube(pts, 0.004, verts=3, caps=False), "#5a6468", jitter=0.0)
    for i in range(3):
        x = 0.15 + i * 0.2
        bank.add(tube([(x, 0.088, 1.66), (x + 0.07, 0.088, 1.45), (x + 0.02, 0.088, 1.2)], 0.004, verts=3, caps=False),
                 "#4a5458", jitter=0.0)
    bank.add(flat(blob(-0.2, 1.72, 0.3, 0.08, 9, 5), 0.085), "#141414", jitter=0.08)   # scorch over the hole
    piv = Vector((0.82, 0.26, 1.0))
    m = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-6), 4, "Y") @ Matrix.Translation(-piv)
    g.absorb(bank, m)
    # gutted access panel: dark cavity, door hanging open, wires spilling out
    g.add(bx(0.2, 0.72, -0.335, -0.31, 0.16, 0.66), C["void"], jitter=0.0)
    door = bx(0.0, 0.5, -0.35, -0.33, 0.0, 0.48, bevel=0.008)
    rotate(door, -75, "Z")
    rotate(door, 12, "Y")
    move(door, (0.2, -0.34, 0.16))
    g.add(door, C["panel2"], jitter=0.05)
    wires = [((0.3, -0.3, 0.55), (0.28, -0.5, 0.3), (0.35, -0.55, 0.05), "#8a1c16"),
             ((0.42, -0.3, 0.5), (0.5, -0.46, 0.35), (0.62, -0.55, 0.22), "#b08a28"),
             ((0.55, -0.3, 0.6), (0.62, -0.42, 0.45), (0.7, -0.5, 0.5), "#2a4a8a"),
             ((0.35, -0.3, 0.3), (0.3, -0.4, 0.12), (0.22, -0.45, 0.02), "#3a6a2a"),
             ((0.6, -0.3, 0.35), (0.66, -0.45, 0.15), (0.74, -0.5, 0.02), "#8a1c16")]
    for a, b, c, rgb in wires:
        g.add(tube([a, b, c], 0.014, verts=4), rgb, jitter=0.03)
    # sparks at the torn ends and in the screen hole (small, bloom does the rest)
    for x, y, z in ((0.7, -0.51, 0.5), (0.62, -0.56, 0.22), (-0.36, 0.05, 1.45), (-0.47, 0.06, 1.36)):
        for ang in (0, 60, 120):
            s = bx(-0.05, 0.05, -0.004, 0.004, -0.006, 0.006)
            rotate(s, ang, "Y")
            move(s, (x, y, z))
            g.glow(s, "amber")
    for i, (x, y) in enumerate(((-0.55, -0.55), (0.1, -0.6), (0.85, -0.45))):   # debris on the floor
        s = bx(-0.05, 0.05, -0.03, 0.03, 0.0, 0.02)
        rotate(s, 25 * i + 10, "Z")
        move(s, (x, y, 0.0))
        g.add(s, C["steel"] if i % 2 else C["dark"])
    g.add(stencil("NAV-2", -0.86, 0.72, -0.335, px=0.014), C["stencil"], jitter=0.0)
    return g.build("console_broken", grime=prop_grime(191, stain=0.18))


def weapon_case():
    """Armoured weapons case on a stand. The M_Rarity strip on the front is the ONLY face with that
    material (the engine tints it per rarity). A rifle rests on cradle pegs above the case rim,
    hidden inside the lid until it opens, then seen in full profile."""
    g = Geo(seed=201)
    body, dk = "#2a2e33", "#1c1f22"
    for x in (-0.5, 0.5):   # trestle stand
        g.add(bx(x - 0.04, x + 0.04, -0.28, 0.28, 0.04, 0.45), C["rib"])
        g.add(bx(x - 0.06, x + 0.06, -0.34, 0.34, 0.0, 0.05, bevel=0.01), C["dark"])
    g.add(bx(-0.46, 0.46, -0.03, 0.03, 0.16, 0.22), C["rib"])
    g.add(plate(-0.7, 0.7, 0.45, 0.9, -0.32, 0.32, steps=[(0.05, -0.012)], bevel=0.02), body)
    for xa, xb in ((-0.72, -0.6), (0.6, 0.72)):   # armoured corners
        g.add(plate(xa, xb, 0.44, 0.9, -0.335, 0.335, bevel=0.012), dk)
        g.add(studs(col(0.52, 0.82, 3, (xa + xb) / 2, -0.335), s=0.014, h=0.01), C["steel_lt"])
    g.add(bx(-0.58, 0.58, -0.345, -0.325, 0.76, 0.82), "#0e1012", jitter=0.0)            # strip channel
    g.glow(bx(-0.55, 0.55, -0.35, -0.345, 0.77, 0.81), "rarity")
    g.add(stencil("ARMORY", -0.52, 0.66, -0.334, px=0.014), C["stencil"], jitter=0.0)
    g.add(bx(0.3, 0.55, -0.345, -0.325, 0.54, 0.64), C["dark"])                            # lock pad
    g.add(bx(-0.66, 0.66, -0.29, 0.29, 0.9, 0.905), "#15161a", jitter=0.0)                 # foam interior
    for x in (-0.3, 0.32):
        g.add(bx(x - 0.03, x + 0.03, -0.04, 0.04, 0.9, 0.95), C["dark"])                   # cradle pegs
    for bm, rgb in place(rifle_parts(1.03), loc=(-0.56, 0.0, 0.95)):
        g.add(bm, rgb, jitter=0.03)
    case = g.build("weapon_case", grime=prop_grime(201, floor=0.8))
    lid = Geo(seed=202)
    lid.add(bx(-0.71, 0.71, -0.33, 0.33, 0.9, 1.14, bevel=0.02), body)
    lid.add(bx(-0.64, 0.64, -0.27, 0.27, 0.897, 0.9), "#56606a", jitter=0.02)   # foam lining (backdrop for the rifle when open)
    for x in (-0.45, 0.0, 0.45):
        lid.add(bx(x - 0.12, x + 0.12, -0.27, 0.27, 1.14, 1.17, bevel=0.01), dk)
    lid.add(tube([(-0.2, 0.0, 1.17), (-0.18, 0.0, 1.24), (0.18, 0.0, 1.24), (0.2, 0.0, 1.17)], 0.018, verts=5),
            C["steel_lt"])
    for x in (-0.45, 0.45):   # latches over the rim
        lid.add(bx(x - 0.05, x + 0.05, -0.355, -0.33, 0.82, 1.06, bevel=0.008), C["steel"])
    lid.add(flat([(-0.1, 1.0), (0.0, 1.07), (0.1, 1.0), (0.1, 1.04), (0.0, 1.11), (-0.1, 1.04)], -0.334), C["haz"])
    lid.build("weapon_case_lid", origin=(0, 0.33, 0.9), parent=case, grime=prop_grime(202, floor=0.8))
    return case


def safe():
    """The captain's strongbox: heavy hollow safe with brass trim, a locking wheel and keypad on a
    hinged door; inside, gold and glowing data cores / a relic (M_GlowAmber)."""
    g = Geo(seed=211)
    steel, inner, brass, gold = "#2e3236", "#17191b", C["brass"], "#b08a3a"
    g.add(bx(-0.5, 0.5, -0.36, 0.36, 0.0, 0.08, bevel=0.01), C["dark"])
    for xa, xb in ((-0.5, -0.42), (0.42, 0.5)):
        g.add(bx(xa, xb, -0.4, 0.4, 0.08, 1.2, bevel=0.012), steel)
    g.add(bx(-0.42, 0.42, 0.32, 0.4, 0.08, 1.2), steel)
    g.add(bx(-0.42, 0.42, -0.4, 0.32, 0.08, 0.16), steel)
    g.add(bx(-0.42, 0.42, -0.4, 0.32, 1.12, 1.2), steel)
    g.add(quad(-0.42, 0.42, 0.16, 1.12, 0.319), inner, jitter=0.0)
    for xa, xb in ((-0.505, -0.47), (0.47, 0.505)):   # brass edge trims
        g.add(bx(xa, xb, -0.405, -0.37, 0.08, 1.2), brass, top=0.4)
    g.add(bx(-0.5, 0.5, -0.405, -0.37, 1.17, 1.21), brass, top=0.4)
    # contents: gold bars, data cores (glow bands), a relic orb on a stand
    g.add(bx(-0.42, 0.42, -0.3, 0.32, 0.58, 0.61), C["steel"], top=0.35)
    for i, (x, z) in enumerate(((-0.34, 0.16), (-0.18, 0.16), (-0.02, 0.16), (-0.26, 0.24), (-0.1, 0.24))):
        g.add(bx(x, x + 0.15, -0.1, 0.12, z, z + 0.08, bevel=0.01), gold, top=0.5)
    for i, x in enumerate((0.12, 0.24, 0.36)):
        g.add(cyl(0.045, 0.3, (x, 0.0, 0.31), verts=8), C["steel"])
        g.glow(cyl(0.048, 0.04, (x, 0.0, 0.25 + i * 0.04), verts=8), "amber")
        g.glow(cyl(0.048, 0.03, (x, 0.0, 0.4), verts=8), "amber")
    g.add(cyl(0.08, 0.1, (-0.15, 0.0, 0.66), verts=8, r2=0.05), brass)
    g.glow(lump((-0.15, 0.0, 0.82), 0.1, seed=1, seg=8, rings=5, rough=0.0), "amber")
    g.add(bx(0.08, 0.36, -0.1, 0.14, 0.61, 0.74, bevel=0.012), "#3a1c2e")                # ornate box
    g.add(bx(0.08, 0.36, -0.105, -0.1, 0.66, 0.68), brass, jitter=0.0)
    body = g.build("safe", grime=prop_grime(211, floor=0.85))
    d = Geo(seed=212)
    x0, x1, z0, z1, yf, yb = -0.46, 0.46, 0.1, 1.16, -0.48, -0.4
    d.add(plate(x0, x1, z0, z1, yf, yb, steps=[(0.05, -0.012), (0.04, 0.008)], bevel=0.015), steel)
    cx, cz = 0.0, 0.6
    d.add(ring(chamfer_like(cx, cz, 0.21, 12), chamfer_like(cx, cz, 0.25, 12), yf - 0.012, yf), brass, top=0.4)
    d.add(tube([(cx + 0.15 * math.cos(a), yf - 0.03, cz + 0.15 * math.sin(a)) for a in [2 * math.pi * i / 10 for i in range(11)]],
               0.018, verts=4, caps=False), brass, top=0.4)
    for a in (0.4, 0.4 + math.pi / 2, 0.4 + math.pi, 0.4 + 3 * math.pi / 2):
        d.add(tube([(cx, yf - 0.03, cz), (cx + 0.14 * math.cos(a), yf - 0.03, cz + 0.14 * math.sin(a))], 0.012, verts=4),
              brass)
    d.add(cyl(0.045, 0.06, (cx, yf - 0.03, cz), rot=(90, 0, 0), verts=8), gold)
    d.add(bx(0.18, 0.4, yf - 0.02, yf, 0.84, 1.08, bevel=0.008), "#15171a")                # keypad
    for i in range(3):
        for j in range(3):
            k = bx(0.2 + i * 0.065, 0.245 + i * 0.065, yf - 0.026, yf - 0.02, 0.87 + j * 0.06, 0.91 + j * 0.06)
            if (i, j) in ((0, 2), (2, 0)):
                d.glow(k, "amber")
            else:
                d.add(k, C["steel_lt"], top=0.4)
    d.glow(bx(0.36, 0.39, yf - 0.026, yf - 0.02, 1.04, 1.06), "red")
    for z in (0.25, 0.95):   # brass hinge knuckles on the left edge
        d.add(cyl(0.035, 0.16, (x0 + 0.02, yf - 0.02, z), verts=8), brass, top=0.4)
    d.add(stencil("CAPT", -0.36, 1.06, yf - 0.003, px=0.014), brass, jitter=0.0)
    d.build("safe_door", origin=(x0, yb, z0), parent=body, grime=prop_grime(212, floor=0.85))
    return body


def chamfer_like(cx, cz, r, n):
    return [(cx + r * math.cos(2 * math.pi * i / n), cz + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def scorch():
    """Blast mark for the back wall, modelled in place like the room-kit slime (origin at floor level,
    x in [-1, 1]); it sits at y ~1.68 so it stays in front of the wall relief. A soft soot halo, faint
    rays and a rising plume that fade to the wall's lit shade, a charred core with ruptured plating
    and a few dull embers."""
    g = Geo(seed=221)
    y = 1.68
    cx, cz = 0.0, 0.95
    soot, edge, core = _rgb("#0e0f10"), _rgb("#1f2225"), _rgb("#060606")
    rnd = random.Random(22)
    halo = [(max(-1.0, min(1.0, px)), max(0.04, pz)) for px, pz in blob(cx, cz + 0.25, 0.98, 1.2, 22, 8, jag=0.22)]
    g.add(flat(halo, y + 0.01), "#0e0f10", jitter=0.0,
          vfn=lambda co, c: lerp3(soot, edge, smooth(0.25, 1.0, math.hypot((co.x - cx) / 0.98, (co.z - cz - 0.25) / 1.2))))
    for s, h in ((-0.18, 1.75), (0.12, 1.6)):   # rising soot plume
        pl = [(cx + s - 0.16, cz + 0.2), (cx + s + 0.16, cz + 0.2), (cx + s + 0.1, cz + h), (cx + s - 0.02, cz + h + 0.15)]
        g.add(flat(pl, y + 0.007), "#0e0f10", jitter=0.0,
              vfn=lambda co, c, h=h: lerp3(soot, edge, smooth(cz + 0.3, cz + h + 0.1, co.z)))
    n = 22
    for i in range(n):   # faint rays
        a = 2 * math.pi * (i + rnd.uniform(-0.3, 0.3)) / n
        up = max(0.0, math.sin(a))
        L = rnd.uniform(0.8, 1.05) + 0.6 * up ** 1.5
        L = min(L, (cz - 0.05) / max(0.05, -math.sin(a))) if math.sin(a) < 0 else L
        w = rnd.uniform(0.05, 0.1)
        base = [(cx + math.cos(a + s) * 0.35, cz + math.sin(a + s) * 0.35) for s in (-w, w)]
        tipx, tipz = cx + math.cos(a) * L, cz + math.sin(a) * L
        tipx = max(-1.0, min(1.0, tipx))
        g.add(flat([base[0], base[1], (tipx, tipz)], y + 0.004 + 0.0001 * i), "#0e0f10", jitter=0.0,
              vfn=lambda co, c, L=L: lerp3(soot, edge, smooth(0.35, L, math.hypot(co.x - cx, co.z - cz)) ** 0.6))
    g.add(flat(blob(cx, cz, 0.46, 0.4, 14, 5, jag=0.3), y), "#0e0f10", jitter=0.0,
          vfn=lambda co, c: lerp3(core, soot, smooth(0.0, 0.5, math.hypot(co.x - cx, (co.z - cz) * 1.2))))
    g.add(flat(blob(cx, cz, 0.18, 0.15, 10, 6, jag=0.4), y - 0.004), C["void"], jitter=0.0)     # hole
    for i in range(6):   # ruptured plating petals bent toward the camera
        a = 2 * math.pi * (i + rnd.uniform(-0.2, 0.2)) / 6
        r0, r1 = 0.15, rnd.uniform(0.3, 0.42)
        wa = rnd.uniform(0.2, 0.35)
        p = [(cx + math.cos(a - wa) * r0, y - 0.005, cz + math.sin(a - wa) * r0),
             (cx + math.cos(a + wa) * r0, y - 0.005, cz + math.sin(a + wa) * r0),
             (cx + math.cos(a + wa * 0.3) * r1, y - rnd.uniform(0.08, 0.16), cz + math.sin(a + wa * 0.3) * r1),
             (cx + math.cos(a - wa * 0.6) * r1 * 0.85, y - 0.1, cz + math.sin(a - wa * 0.6) * r1 * 0.85)]
        import bmesh as _bm
        bm = _bm.new()
        f = bm.faces.new([bm.verts.new(v) for v in p])
        bm.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
        g.add(bm, "#2a2420", jitter=0.12, top=0.4)
    for i in range(5):   # dull embers (not emissive: a cold, old scorch)
        a = rnd.uniform(0, 2 * math.pi)
        rr = rnd.uniform(0.2, 0.4)
        g.add(flat(blob(cx + math.cos(a) * rr, cz + math.sin(a) * rr, 0.025, 0.018, 6, 30 + i), y - 0.006),
              "#5a1a0e", jitter=0.1)
    g.add(lump((0.0, 1.7, 0.0), 0.5, seed=7, seg=10, rings=4, rough=0.3, scale=(1.4, 0.4, 0.03), cut="bottom"),
          "#141414", jitter=0.08)                                                                   # soot on the floor
    return g.build("scorch", grime=None)


# ================================================================ set pieces (gen/populate.js placeOddities)

def _lean(bm, deg=-7.0):
    """Tilt the top back into its struts (+y), about the bottom edge."""
    return rotate(bm, deg, "X", (0, 0, 0.04))


def barricade():
    """The squad's deployable shield (~1.2 m wide, 1.15 m high), set down on the walking line: an
    olive steel plate with a vision slit and hazard trim, leaning back on two struts and skid feet."""
    g = Geo(seed=261)
    for x in (-0.47, 0.47):                                                      # skid feet, rear struts
        g.add(bx(x - 0.05, x + 0.05, -0.14, 0.42, 0.0, 0.05, bevel=0.01), C["dark"])
        g.add(tube([(x, 0.4, 0.05), (x, 0.08, 0.95)], 0.025, verts=5), C["steel"])
    g.add(_lean(plate(-0.6, 0.6, 0.04, 1.15, -0.06, 0.02, steps=[(0.05, -0.012)], bevel=0.015)), C["olive"])
    g.add(_lean(stripes(-0.55, 0.55, 0.1, 0.24, -0.074, width=0.09, slant=0.9)), C["haz"], jitter=0.06)
    g.add(_lean(bx(-0.27, 0.27, -0.08, -0.07, 0.81, 0.95)), C["steel_lt"], top=0.4)          # slit frame
    g.add(_lean(bx(-0.23, 0.23, -0.085, -0.075, 0.85, 0.91)), C["void"], jitter=0.0)          # vision slit
    g.add(_lean(studs(row(-0.52, 0.52, 6, -0.074, 1.07), s=0.014, h=0.01)), C["steel_lt"])
    g.add(_lean(stencil("SHIELD-4", -0.5, 0.5, -0.076, px=0.013)), C["stencil"], jitter=0.0)
    g.add(_lean(lump((0.32, -0.075, 0.62), 0.09, seed=3, seg=6, rings=4, rough=0.3, scale=(1.2, 0.05, 0.8))), C["rust_dk"])
    return g.build("barricade", grime=prop_grime(261, h=1.1))


def turret():
    """A ship's sentry gun on its pedestal (~1.0 m wide, ~1.55 m tall): an armoured head with twin
    barrels (a child, `turret_head`, which the engine mirrors to face its target), a red sensor eye,
    an amber standby lamp, the ammo feed running down into the pedestal."""
    g = Geo(seed=271)
    g.add(bx(-0.42, 0.42, -0.32, 0.32, 0.0, 0.08, bevel=0.012), C["dark"])                    # floor plate
    g.add(studs(row(-0.34, 0.34, 4, -0.32, 0.05), s=0.016, h=0.01), C["steel_lt"])
    g.add(cyl(0.15, 0.95, (0, 0.02, 0.555), verts=10, r2=0.11), C["panel3"])                  # pedestal
    g.add(bx(-0.09, 0.09, -0.16, -0.12, 0.2, 0.7), C["haz"], jitter=0.06)
    g.add(stencil("AUTO", -0.08, 0.62, -0.165, px=0.012), "#151618", jitter=0.0)
    g.add(cyl(0.21, 0.08, (0, 0.02, 1.06), verts=12), C["rib"])                               # slew ring
    body = g.build("turret", grime=prop_grime(271, h=1.0))
    h = Geo(seed=272)
    h.add(bx(-0.28, 0.24, -0.22, 0.24, 1.1, 1.5, bevel=0.04), C["olive"])                    # armoured head
    h.add(bx(-0.3, 0.26, -0.23, 0.25, 1.46, 1.53, bevel=0.02), C["olive_dk"])
    h.add(bx(-0.24, -0.04, -0.235, -0.222, 1.16, 1.3), C["haz"], jitter=0.06)
    for z in (1.24, 1.36):                                                                   # twin barrels, +x
        h.add(cyl(0.035, 0.3, (0.38, -0.02, z), rot=(0, 90, 0), verts=8), C["steel"])
        h.add(cyl(0.05, 0.06, (0.52, -0.02, z), rot=(0, 90, 0), verts=8), C["dark"])          # muzzle brakes
    h.add(bx(0.14, 0.26, -0.245, -0.2, 1.38, 1.47, bevel=0.01), "#1a0606")                   # sensor housing
    h.glow(cyl(0.032, 0.02, (0.2, -0.25, 1.425), rot=(90, 0, 0), verts=8), "red")            # sensor eye
    h.glow(bx(-0.27, -0.21, -0.236, -0.226, 1.41, 1.45), "amber")                            # standby lamp
    h.add(tube(sag((-0.22, 0.18, 1.14), (-0.12, 0.2, 0.72), 0.05, 4), 0.028, verts=5), C["cable"])   # ammo feed
    h.add(stencil("SENTRY", 0.0, 1.32, -0.225, px=0.011), C["stencil"], jitter=0.0)
    h.build("turret_head", origin=(0, 0.02, 1.06), parent=body, grime=prop_grime(272))
    return body


def eggs():
    """A clutch of leathery eggs in a mat of hive resin (~1.6 m wide, ~0.65 m tall): slime-wet and
    veined, two split open at the top into petals, a sickly glow inside one."""
    g = Geo(seed=281)
    g.add(lump((0.0, 0.0, 0.0), 0.8, seed=3, seg=10, rings=4, rough=0.25, scale=(1.0, 0.55, 0.12), cut="bottom"),
          C["resin"], jitter=0.1)
    clutch = ((-0.5, 0.06, 0.9), (-0.16, -0.1, 1.05), (0.2, 0.08, 0.95), (0.5, -0.06, 0.85), (0.02, 0.22, 0.8))
    for i, (x, y, s) in enumerate(clutch):
        r = 0.2 * s
        top = r * 2.9
        g.add(lump((x, y, 0.0), r, seed=10 + i, seg=10, rings=7, rough=0.05, scale=(0.95, 0.95, 2.9), cut="bottom"),
              C["resin3"] if i % 2 else C["resin2"], jitter=0.1)
        for k in range(3):   # veins up the shell
            a = 2.1 * k + i
            g.add(tube([(x + r * 0.85 * math.cos(a), y + r * 0.85 * math.sin(a), 0.02),
                        (x + r * 0.9 * math.cos(a + 0.3), y + r * 0.9 * math.sin(a + 0.3), top * 0.55),
                        (x + r * 0.4 * math.cos(a + 0.5), y + r * 0.4 * math.sin(a + 0.5), top * 0.95)], 0.012, verts=3),
                  C["resin"], jitter=0.08)
        if i in (1, 3):      # split open: four petals curling out of the crown
            for k in range(4):
                a = math.pi / 2 * k + 0.4
                p = lump((x + r * 0.45 * math.cos(a), y + r * 0.45 * math.sin(a), top * 0.92), r * 0.35, seed=20 + k,
                         seg=6, rings=4, rough=0.2, scale=(1.0, 0.5, 0.35))
                g.add(p, C["resin3"], jitter=0.1)
            g.glow(lump((x, y, top * 0.85), r * 0.28, seed=30 + i, seg=6, rings=4, rough=0.1), rgb=(0.55, 0.85, 0.3))
    for k in range(6):       # slime strings and puddles
        x = -0.7 + k * 0.28
        g.add(lump((x, -0.2 + 0.1 * (k % 2), 0.0), 0.08, seed=40 + k, seg=6, rings=3, rough=0.3, scale=(1.4, 1.0, 0.15),
                   cut="bottom"), C["slime"], jitter=0.12)
    return g.build("eggs", grime=None)


def cryopod():
    """A cryo pod standing against the bulkhead (~1.3 m wide, ~2.05 m tall): a padded steel shell, a
    frosted window door hinged on its left edge (`cryopod_door`), cold-blue status lights, coolant
    lines, and a figure's shadow behind the frost."""
    g = Geo(seed=291)
    g.add(bx(-0.62, 0.62, -0.4, 0.4, 0.0, 0.14, bevel=0.015), C["dark"])                     # plinth
    g.add(plate(-0.55, 0.55, 0.14, 2.05, -0.3, 0.35, steps=[(0.05, -0.012)], bevel=0.04), C["med"])   # shell
    g.add(bx(-0.42, 0.42, -0.31, -0.296, 0.3, 1.9), "#0c1418", jitter=0.0)                    # the cold inside
    g.add(lump((0.0, -0.27, 1.1), 0.3, seed=5, seg=7, rings=5, rough=0.1, scale=(0.75, 0.15, 2.2)), "#1c262c")  # a figure
    for side in (-1, 1):
        g.add(tube([(side * 0.58, 0.05, 0.14), (side * 0.64, -0.02, 1.0), (side * 0.58, 0.05, 1.9)], 0.03, verts=5),
              C["pipe_g"])
        g.glow(bx(side * 0.6 - 0.025, side * 0.6 + 0.025, -0.33, -0.31, 1.6, 1.75), "blue")
    g.add(bx(-0.5, 0.5, -0.33, -0.3, 1.93, 2.02), C["rib"])
    g.add(stencil("CRYO-3", -0.45, 1.995, -0.335, px=0.013), C["stencil"], jitter=0.0)
    screen_content(g, -0.3, 0.3, 0.16, 0.28, -0.405, 11, "bars")
    body = g.build("cryopod", grime=prop_grime(291, h=2.0))
    d = Geo(seed=292)
    x0, x1, z0, z1, yf, yb = -0.48, 0.48, 0.3, 1.92, -0.42, -0.36
    d.add(plate(x0, x1, z0, z1, yf, yb, steps=[(0.04, -0.01)], bevel=0.02), C["steel"])       # door frame
    d.add(bx(x0 + 0.08, x1 - 0.08, yf - 0.02, yf - 0.006, z0 + 0.1, z1 - 0.1), "#7f9ea8", jitter=0.0)   # window
    for k, (fx, fz, fw, fh) in enumerate(((-0.3, 0.45, 0.16, 0.09), (0.28, 0.5, 0.12, 0.07), (-0.32, 1.7, 0.1, 0.12),
                                          (0.3, 1.75, 0.14, 0.08), (0.0, 0.42, 0.2, 0.05))):   # frost at the edges
        d.add(bx(fx - fw, fx + fw, yf - 0.024, yf - 0.021, fz - fh, fz + fh), "#a9c6ce", jitter=0.04)
    d.glow(bx(x1 - 0.13, x1 - 0.06, yf - 0.03, yf - 0.02, z1 - 0.2, z1 - 0.14), "blue")         # lock lamp
    d.add(bx(x1 - 0.1, x1 - 0.04, yf - 0.05, yf - 0.02, 0.95, 1.25, bevel=0.01), C["steel_lt"], top=0.4)   # handle
    d.build("cryopod_door", origin=(x0, yf, z0), parent=body, grime=prop_grime(292))
    return body


def body():
    """A dead crewman face down on the deck (~2 m with his arm out): orange work suit, one arm flung out, a dark
    pool under him, his torch still lit by his hand, an ID card on a lanyard."""
    g = Geo(seed=301)
    skin, hair, suit = "#5a4636", "#17120e", C["orange"]
    g.add(lump((0.1, -0.02, 0.0), 0.62, seed=2, seg=10, rings=3, rough=0.3, scale=(1.35, 0.75, 0.02), cut="bottom"),
          C["blood"], jitter=0.1)                                                                 # the pool
    g.add(lump((0.12, 0.0, 0.0), 0.3, seed=1, seg=8, rings=5, rough=0.08, scale=(1.3, 0.8, 0.55), cut="bottom"), suit)  # torso
    g.add(tube([(-0.24, -0.08, 0.1), (-0.58, -0.12, 0.09), (-0.84, -0.12, 0.08)], 0.085, verts=6), suit)  # legs
    g.add(tube([(-0.24, 0.08, 0.1), (-0.55, 0.2, 0.09), (-0.82, 0.12, 0.08)], 0.085, verts=6), suit)
    for y in (-0.12, 0.12):
        g.add(lump((-0.9, y, 0.0), 0.08, seed=5, seg=6, rings=4, rough=0.1, scale=(1.5, 0.9, 1.0), cut="bottom"), C["leather"])
    g.add(lump((0.58, 0.0, 0.0), 0.12, seed=7, seg=8, rings=5, rough=0.05, scale=(1.1, 0.9, 1.0), cut="bottom"), skin)   # head
    g.add(lump((0.6, 0.02, 0.06), 0.11, seed=8, seg=8, rings=4, rough=0.15, scale=(1.1, 0.9, 0.7)), hair)
    g.add(tube([(0.36, 0.2, 0.12), (0.12, 0.26, 0.08), (-0.06, 0.24, 0.05)], 0.06, verts=6), suit)        # arm at his side
    g.add(tube([(0.38, -0.2, 0.12), (0.62, -0.42, 0.07), (0.82, -0.45, 0.05)], 0.06, verts=6), suit)      # arm flung out
    g.add(lump((0.88, -0.45, 0.0), 0.06, seed=9, seg=6, rings=4, rough=0.1, cut="bottom"), skin)
    g.add(cyl(0.03, 0.18, (0.95, -0.3, 0.035), rot=(0, 90, 25), verts=8), C["steel"])                     # his torch
    g.glow(cyl(0.032, 0.015, (1.03, -0.26, 0.04), rot=(0, 90, 25), verts=8), "white")
    g.add(tube([(0.42, -0.05, 0.16), (0.55, -0.22, 0.03)], 0.006, verts=3), C["cable_r"])                 # lanyard
    g.add(bx(0.52, 0.62, -0.3, -0.23, 0.0, 0.012), "#c8b060", jitter=0.0)                                # ID card
    for k in range(4):       # blood on the suit
        g.add(lump((0.0 + 0.12 * k, -0.15 + 0.1 * (k % 2), 0.12), 0.07, seed=60 + k, seg=6, rings=3, rough=0.3,
                   scale=(1.4, 1.0, 0.3)), C["blood"], jitter=0.1)
    return g.build("body", grime=prop_grime(301, h=0.4))


def seam(g, x0, x1, z0, z1, y):
    """A dark slot in a front face at y (a coin slot, a hatch gap)."""
    g.add(quad(x0, x1, z0, z1, y), C["void"], jitter=0.0)


# ================================================================ class props (gen/classes.js rooms)

def missile():
    """A ship-killer on its cradle in a corvette's magazine (~2.6 m along X): a grey body with a
    hazard band, tail fins, a red-tipped seeker and the loading stencils."""
    g = Geo(seed=311)
    body, body_dk = "#5f666c", "#4a5056"
    for x in (-0.62, 0.62):   # cradle: stands with a vee
        g.add(bx(x - 0.16, x + 0.16, -0.3, 0.3, 0.0, 0.1, bevel=0.01), C["dark"])
        g.add(bx(x - 0.06, x + 0.06, -0.08, 0.08, 0.1, 0.42), C["rib"])
        g.add(bx(x - 0.3, x + 0.3, -0.05, 0.05, 0.42, 0.5), C["steel"], top=0.4)
    g.add(cyl(0.27, 2.0, (0.0, 0.0, 0.78), rot=(0, 90, 0), verts=14), body, jitter=0.03)
    g.add(cyl(0.27, 0.32, (1.16, 0.0, 0.78), rot=(0, 90, 0), verts=14, r2=0.05), body_dk)   # nose
    g.glow(cyl(0.05, 0.04, (1.33, 0.0, 0.78), rot=(0, 90, 0), verts=8), "red")           # seeker
    for a in (0, 90, 180, 270):   # tail fins
        f = bx(-1.3, -0.95, -0.02, 0.02, 0.78, 1.16)
        rotate(f, a, "X", (0, 0, 0.78))
        g.add(f, body_dk, jitter=0.04)
    g.add(cyl(0.275, 0.12, (-0.55, 0.0, 0.78), rot=(0, 90, 0), verts=14), C["haz"], jitter=0.06)
    g.add(cyl(0.275, 0.05, (-0.46, 0.0, 0.78), rot=(0, 90, 0), verts=14), C["haz_dk"], jitter=0.0)
    g.add(cyl(0.275, 0.05, (-0.64, 0.0, 0.78), rot=(0, 90, 0), verts=14), C["haz_dk"], jitter=0.0)
    g.add(cyl(0.285, 0.04, (0.6, 0.0, 0.78), rot=(0, 90, 0), verts=14), C["rib"])        # a joint ring
    g.add(stencil("AGM-9  INERT", -0.3, 0.84, -0.275, px=0.016), C["stencil"], jitter=0.0)
    g.add(stencil("LIFT HERE", -0.2, 0.62, -0.275, px=0.011), C["stencil_y"], jitter=0.0)
    g.add(tube([(-0.9, -0.1, 0.52), (-0.6, -0.14, 0.4), (-0.3, -0.12, 0.5)], 0.014, verts=4), C["cable"])  # a loose cable
    return g.build("missile", grime=prop_grime(311, h=1.2))


def planter():
    """A hydroponics trough on legs (~2 m): soil and whatever still grows in it, a drip line, and
    the grow lamp over it still lit pink."""
    g = Geo(seed=321)
    green, green_lt, green_dk = "#3f6a2a", "#5a8a3a", "#2c4a1f"
    for x in (-0.9, 0.9):
        for y in (-0.28, 0.28):
            g.add(bx(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0.0, 0.55), C["rib"])
    g.add(bx(-1.0, 1.0, -0.36, 0.36, 0.55, 0.95, bevel=0.012), C["panel"], jitter=0.03)
    g.add(bx(-1.02, 1.02, -0.38, 0.38, 0.9, 0.95), C["steel"], top=0.4)
    g.add(bx(-0.96, 0.96, -0.32, 0.32, 0.93, 0.96), "#2a2219", jitter=0.08)   # soil
    g.add(stripes(-0.9, -0.3, 0.6, 0.72, -0.365, width=0.07, slant=0.8), C["haz"], jitter=0.1)
    g.add(stencil("BED 7  LEAF", -0.1, 0.62, -0.365, px=0.014), C["stencil"], jitter=0.0)
    rnd = random.Random(321)
    for i in range(9):   # plants: a stalk and a tuft of leaves, a few gone brown
        x = -0.85 + i * 0.21 + rnd.uniform(-0.04, 0.04)
        y = rnd.uniform(-0.18, 0.18)
        h = rnd.uniform(0.25, 0.55)
        dead = rnd.random() < 0.3
        g.add(tube([(x, y, 0.95), (x + rnd.uniform(-0.05, 0.05), y, 0.95 + h)], 0.012, verts=4),
              "#5a4a2a" if dead else green_dk)
        g.add(lump((x, y, 0.95 + h), 0.11, seed=30 + i, seg=6, rings=4, rough=0.35, scale=(1.3, 1.0, 0.7)),
              "#6a5230" if dead else rnd.choice((green, green_lt)), jitter=0.08)
    g.add(tube([(-1.0, 0.3, 0.9), (-1.0, 0.3, 1.5), (1.0, 0.3, 1.5), (1.0, 0.3, 0.9)], 0.016, verts=5), C["pipe_g"])  # drip line
    for x in (-0.95, 0.95):   # uprights and the lamp bar
        g.add(bx(x - 0.025, x + 0.025, 0.2, 0.25, 0.95, 1.6), C["rib"])
    g.add(bx(-1.0, 1.0, 0.1, 0.3, 1.6, 1.7, bevel=0.01), C["dark"])
    g.glow(bx(-0.95, 0.95, 0.12, 0.28, 1.595, 1.6), "pink")
    return g.build("planter", grime=prop_grime(321, h=1.0))


def specimen_tank():
    """A specimen tank (~1.3 m wide, 2.3 m tall): a plinth with its readout, a cylinder of murky
    fluid lit from below with its front open to the camera, something suspended in it, feed lines
    and the cap ring."""
    g = Geo(seed=331)
    g.add(bx(-0.62, 0.62, -0.5, 0.5, 0.0, 0.36, bevel=0.015), C["dark"])
    g.add(bx(-0.58, 0.58, -0.46, 0.46, 0.36, 0.42), C["steel"], top=0.4)
    screen_content(g, -0.42, 0.0, 0.1, 0.3, -0.505, 31, "bars")
    g.glow(bx(0.2, 0.26, -0.505, -0.5, 0.16, 0.22), "amber")
    g.add(cyl(0.5, 0.08, (0, 0, 0.46), verts=16), C["rib"])
    g.glow(cyl(0.47, 0.05, (0, 0, 0.5), verts=16), "glow")                              # the lit floor of the tank
    front = [(math.sin(math.radians(a)), -math.cos(math.radians(a)), 0.0) for a in [-82.5 + 15 * i for i in range(12)]]
    g.add(cyl(0.5, 1.5, (0, 0, 1.27), verts=16, cap=False), "#0e2a2c", cull=front, jitter=0.0)   # the back half of the glass
    g.add(lump((0.0, 0.0, 1.2), 0.3, seed=7, seg=8, rings=6, rough=0.2, scale=(0.6, 0.6, 1.5)), "#1c2a2c")   # the specimen
    g.add(lump((0.05, -0.05, 1.5), 0.14, seed=8, seg=6, rings=4, rough=0.3), "#223436")
    for i, (x, z) in enumerate(((-0.2, 0.7), (0.25, 0.95), (-0.1, 1.6), (0.3, 1.8), (-0.3, 1.3))):   # bubbles
        g.glow(cyl(0.015 + 0.004 * i, 0.02, (x, -0.2, z), verts=5), "glow")
    g.add(cyl(0.52, 0.12, (0, 0, 2.08), verts=16), C["steel"], top=0.35)
    g.add(cyl(0.3, 0.2, (0, 0, 2.2), verts=12), C["rib"])
    for side in (-1, 1):
        g.add(tube([(side * 0.3, 0.3, 2.25), (side * 0.45, 0.42, 1.6), (side * 0.5, 0.42, 0.5)], 0.028, verts=5), C["pipe_g"])
    g.glow(bx(-0.08, 0.08, -0.31, -0.3, 2.12, 2.16), "red")
    g.add(stencil("SPEC 11", -0.42, 2.03, -0.525, px=0.014), C["stencil"], jitter=0.0)
    return g.build("specimen_tank", grime=prop_grime(331, h=2.0))


def lab_bench():
    """A laboratory bench (~2.2 m): drawers below, a steel top with glassware in a rack, a flask
    with something still glowing in it, a microscope, a centrifuge and a readout."""
    g = Geo(seed=341)
    g.add(bx(-1.05, 1.05, -0.38, 0.38, 0.08, 0.86, bevel=0.01), C["panel"], jitter=0.02)
    g.add(bx(-1.05, 1.05, -0.39, 0.39, 0.0, 0.08), C["kick"])
    for i in range(3):   # drawer fronts with handles
        x0 = -0.98 + i * 0.66
        g.add(plate(x0, x0 + 0.6, 0.14, 0.78, -0.4, -0.38, steps=[(0.02, -0.006)], bevel=0.006), C["panel2"], jitter=0.02)
        g.add(bx(x0 + 0.2, x0 + 0.4, -0.43, -0.4, 0.44, 0.47), C["steel_lt"])
    g.add(bx(-1.1, 1.1, -0.42, 0.42, 0.86, 0.94, bevel=0.012), "#5f676e", top=0.4)
    g.add(bx(-0.98, -0.5, -0.2, 0.2, 0.94, 0.97), C["dark"])   # the rack
    for x, r, h, rgb in ((-0.9, 0.04, 0.22, "#3f5a4a"), (-0.78, 0.035, 0.18, "#6b5a30"), (-0.66, 0.045, 0.26, "#2f4a44"),
                         (-0.56, 0.03, 0.16, "#5a2a22")):
        g.add(cyl(r, h, (x, 0.0, 0.97 + h / 2), verts=7), rgb)
        g.add(cyl(r * 0.5, 0.08, (x, 0.0, 0.97 + h + 0.04), verts=6), rgb)
    g.add(cyl(0.09, 0.14, (-0.35, 0.05, 1.01), verts=8, r2=0.04), "#2f4a44")   # the flask
    g.glow(cyl(0.07, 0.04, (-0.35, 0.05, 0.96), verts=8), "glow")
    # microscope: base, column, arm, eyepiece, stage
    g.add(bx(0.0, 0.3, -0.14, 0.14, 0.94, 0.99, bevel=0.008), C["dark"])
    g.add(bx(0.2, 0.28, -0.04, 0.04, 0.99, 1.34), C["steel"])
    g.add(tube([(0.24, 0.0, 1.3), (0.1, 0.0, 1.36), (0.04, 0.0, 1.46)], 0.03, verts=6), C["steel"])
    g.add(cyl(0.025, 0.14, (0.08, 0.0, 1.18), verts=6), C["dark"])
    g.add(cyl(0.05, 0.015, (0.1, 0.0, 1.0), verts=8), C["steel_lt"])
    # centrifuge and the readout
    g.add(cyl(0.16, 0.2, (0.62, 0.0, 1.04), verts=10, bevel=0.01), C["med"])
    g.add(cyl(0.12, 0.02, (0.62, 0.0, 1.15), verts=10), C["dark"])
    g.glow(bx(0.52, 0.56, -0.165, -0.16, 1.0, 1.03), "amber")
    g.add(bx(0.78, 1.04, -0.08, 0.02, 0.94, 1.22), C["panel3"])
    screen_content(g, 0.8, 1.02, 1.0, 1.18, -0.085, 34, "ecg")
    g.add(stencil("BENCH 2", -0.98, 0.3, -0.4, px=0.012), C["stencil"], jitter=0.0)
    return g.build("lab_bench", grime=prop_grime(341, h=0.9))


def galley_counter():
    """A galley counter (~2.2 m): the hob with its rings and a pot still on one, a tray of bowls,
    the order-ticket rail, and a rail of utensils hung above."""
    g = Geo(seed=351)
    g.add(bx(-1.05, 1.05, -0.4, 0.4, 0.08, 0.86, bevel=0.01), C["panel"], jitter=0.02)
    g.add(bx(-1.05, 1.05, -0.41, 0.41, 0.0, 0.08), C["kick"])
    for i in range(2):   # cupboard doors
        x0 = -0.98 + i * 1.0
        g.add(plate(x0, x0 + 0.94, 0.14, 0.78, -0.42, -0.4, steps=[(0.02, -0.006)], bevel=0.006), C["panel2"], jitter=0.02)
        g.add(bx(x0 + 0.84 - i * 0.74, x0 + 0.88 - i * 0.74, -0.45, -0.42, 0.4, 0.56), C["steel_lt"])
    g.add(bx(-1.1, 1.1, -0.44, 0.44, 0.86, 0.94, bevel=0.012), C["steel"], top=0.4)
    g.add(bx(-0.95, -0.15, -0.36, 0.36, 0.94, 0.97), C["dark"])   # the hob
    for x in (-0.75, -0.35):
        g.add(cyl(0.14, 0.02, (x, 0.0, 0.98), verts=12), C["rib"])
        g.add(cyl(0.11, 0.01, (x, 0.0, 0.995), verts=12), C["dark"])
    g.add(cyl(0.15, 0.2, (-0.75, 0.0, 1.09), verts=12), C["steel"], jitter=0.03)   # the pot
    g.add(cyl(0.16, 0.025, (-0.75, 0.0, 1.2), verts=12), C["steel_lt"])
    g.add(tube([(-0.9, 0.0, 1.17), (-0.95, 0.0, 1.26), (-0.9, 0.0, 1.3)], 0.012, verts=4), C["dark"])   # its handle
    g.add(bx(0.1, 0.7, -0.3, 0.3, 0.94, 0.965, bevel=0.006), "#4a4e44")   # a tray of bowls
    for x in (0.22, 0.42, 0.6):
        g.add(cyl(0.07, 0.05, (x, 0.08, 0.99), verts=8, r2=0.05), C["med"])
    g.add(tube([(0.8, -0.4, 0.94), (0.8, -0.4, 1.12), (1.04, -0.4, 1.12)], 0.01, verts=4), C["steel_lt"])   # ticket rail
    for k in range(3):
        g.add(bx(0.84 + k * 0.07, 0.88 + k * 0.07, -0.405, -0.395, 1.0, 1.1), "#c8b89a", jitter=0.02)
    for x in (-0.95, 0.95):   # the utensil rail on two uprights
        g.add(bx(x - 0.02, x + 0.02, 0.3, 0.34, 0.94, 1.5), C["rib"])
    g.add(pipe((-0.97, 0.32, 1.5), (0.97, 0.32, 1.5), 0.016, verts=6), C["steel_lt"])
    for x, h, rgb in ((-0.6, 0.3, C["steel"]), (-0.3, 0.36, C["dark"]), (0.05, 0.28, C["steel_lt"]), (0.4, 0.34, C["steel"])):
        g.add(tube([(x, 0.3, 1.5), (x, 0.3, 1.5 - h)], 0.012, verts=4), rgb)
        g.add(bx(x - 0.04, x + 0.04, 0.27, 0.33, 1.5 - h - 0.08, 1.5 - h), rgb)
    g.add(stencil("GALLEY", -0.98, 0.3, -0.42, px=0.014), C["stencil"], jitter=0.0)
    return g.build("galley_counter", grime=prop_grime(351, h=0.9))


def kiosk():
    """A vending kiosk (~1.4 m, 2.2 m tall) on a station concourse: the advert panel still lit,
    product rows behind glass, a keypad, the hatch, and a dent where somebody kicked it."""
    g = Geo(seed=361)
    g.add(bx(-0.7, 0.7, -0.45, 0.45, 0.0, 0.12), C["kick"])
    g.add(plate(-0.68, 0.68, 0.12, 2.2, -0.46, 0.45, steps=[(0.04, -0.012)], bevel=0.025), C["panel3"], jitter=0.02)
    g.add(bx(-0.5, 0.5, -0.475, -0.46, 1.0, 1.9), "#0b151a", jitter=0.0)   # the product window
    rnd = random.Random(361)
    for j in range(3):
        zs = 1.08 + j * 0.28
        g.add(bx(-0.48, 0.48, -0.47, -0.42, zs - 0.02, zs), C["steel"], top=0.3)
        for i in range(5):
            x = -0.42 + i * 0.2
            rgb = rnd.choice((C["orange"], C["olive"], "#2f4a6a", "#6a2a22", "#4a4a3a"))
            if rnd.random() < 0.75:
                g.add(cyl(0.05, 0.16, (x, -0.455, zs + 0.08), verts=7), rgb, jitter=0.05)
    g.add(bx(-0.52, 0.52, -0.475, -0.46, 1.95, 2.12), C["dark"], jitter=0.0)   # the advert panel
    g.glow(bx(-0.48, 0.48, -0.478, -0.475, 1.98, 2.09), "amber")
    g.glow(bx(-0.4, -0.1, -0.481, -0.478, 2.01, 2.06), "red")
    g.add(bx(0.25, 0.45, -0.475, -0.46, 0.7, 0.9), C["dark"])   # slot and keypad
    seam(g, 0.28, 0.42, 0.74, 0.78, -0.476)
    for k in range(6):
        b = bx(0.27 + (k % 3) * 0.06, 0.31 + (k % 3) * 0.06, -0.48, -0.475, 0.8 + (k // 3) * 0.045, 0.83 + (k // 3) * 0.045)
        if k == 4:
            g.glow(b, "amber")
        else:
            g.add(b, C["steel_lt"])
    g.add(bx(-0.45, 0.1, -0.475, -0.46, 0.3, 0.6), C["dark"])   # the hatch
    g.add(bx(-0.43, 0.08, -0.47, -0.465, 0.32, 0.58), C["panel2"], jitter=0.02)
    g.add(lump((-0.2, -0.46, 0.45), 0.08, seed=3, seg=6, rings=4, rough=0.3, scale=(1.4, 0.3, 1.0)), C["panel3"])   # the dent
    g.add(stencil("VEND-O-MAT", -0.45, 0.68, -0.465, px=0.013), C["stencil"], jitter=0.0)
    rust(g, 0.5, 0.25, 0.12, 0.1, -0.465, 361)
    return g.build("kiosk", grime=prop_grime(361, h=1.8))


PROPS = [crate, locker, chest, cabinet, ammo_rack, barrel, bigcrate, console, bunk, medbed, shelf, table,
         reactor, pilot_seat, control_panel, debris, beam, airlock_hatch,
         barrel_explosive, barrel_wreck, console_broken, weapon_case, safe, scorch,
         barricade, turret, eggs, cryopod, body,
         missile, planter, specimen_tank, lab_bench, galley_counter, kiosk]


def build():
    out = {}
    for fn in PROPS:
        obj = fn()
        assert obj.name == fn.__name__, (obj.name, fn.__name__)
        out[obj.name] = obj
    return out


BOTTOM = {"cabinet": 1.0, "beam": 1.3, "scorch": None}        # floor contact (z) everywhere else = 0; None = skip
HINGES = {"crate": "crate_lid", "locker": "locker_door", "chest": "chest_lid", "cabinet": "cabinet_door",
          "ammo_rack": "ammo_rack_door", "weapon_case": "weapon_case_lid", "safe": "safe_door", "cryopod": "cryopod_door"}


def validate(props, info):
    """Print WARN lines for README "props.glb" contract violations (run-blender.mjs surfaces them)."""
    problems = []
    for n, o in props.items():
        lo, hi = piece_bounds(o)
        w = WIDTH[n]
        if abs(info[n]["w"] - w) > 0.1 * w:
            problems.append(f"{n}: width {info[n]['w']:.2f} vs {w} (+-10%)")
        if BOTTOM.get(n, 0.0) is not None and abs(lo.z - BOTTOM.get(n, 0.0)) > 0.01:
            problems.append(f"{n}: bottom z={lo.z:.3f}, expected {BOTTOM.get(n, 0.0)}")
        if abs((lo.x + hi.x) / 2) > 0.12 * w:
            problems.append(f"{n}: not centred on x=0 ({lo.x:.2f}..{hi.x:.2f})")
        if tuple(o.location) != (0.0, 0.0, 0.0):
            problems.append(f"{n}: node origin not at (0, 0, 0)")
        kids = [c.name for c in o.children]
        want = HINGES.get(n)
        if want and kids != [want]:
            problems.append(f"{n}: hinged child {kids} != ['{want}']")
        if want:   # the hinge line must lie on the body's bounding box edge
            h = o.children[0].location
            on_edge = (abs(h.x - lo.x) < 0.06 or abs(h.x - hi.x) < 0.06 or abs(h.y - lo.y) < 0.06 or
                       abs(h.y - hi.y) < 0.06)
            if not on_edge:
                problems.append(f"{n}: hinge origin {tuple(round(c, 3) for c in h)} not on the body edge")
    for p in problems:
        print("WARN contract", p)
    return problems


def main():
    args = script_args()
    out = out_dir(args)
    reset_scene()
    props = build()
    info = {}
    for n, o in props.items():
        i = piece_info(o)
        info[n] = i
        budget = BUDGET.get(n, 1500)
        flag = "  OVER BUDGET" if i["tris"] > budget else ""
        print(f"STATS props {n:14s} w={i['w']:.2f} h={i['h']:.2f} tris={i['tris']}{flag}")
    validate(props, info)
    export_glb(os.path.join(out, "props.glb"), list(props.values()))
    write_meta(out, "props", {"nodes": list(props), "pieces": info, "bounds": bounds(list(props.values()))})
    if args.get("preview"):
        from lib.env import sheet
        pdir = out_dir(args, "preview", "tools/out/previews")
        sheet(list(props.items()), os.path.join(pdir, "props.png"), cols=6, tile=300, yaw=0, pitch=6)
        sheet(list(props.items()), os.path.join(pdir, "props_3q.png"), cols=6, tile=300, yaw=35, pitch=15)
        open_pose(props)
        sheet([(n, props[n]) for n in HINGES], os.path.join(pdir, "props_open.png"), cols=5, tile=300, yaw=35,
              pitch=15)


def open_pose(props):
    """Swing every hinged part open (lids about local X, doors about local Z) for a review sheet.
    Runs after export, so the GLB keeps the closed rest pose."""
    for n, child in HINGES.items():
        c = props[n].children[0]
        if child.endswith("_lid"):
            c.rotation_euler = (math.radians(-100), 0, 0)
        else:
            c.rotation_euler = (0, 0, math.radians(-105))
    bpy.context.view_layer.update()


if __name__ == "__main__":
    main()
