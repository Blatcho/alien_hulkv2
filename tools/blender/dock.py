"""Docked marine boarding craft, boarding tube and docking hull -> public/assets/models/dock.glb.

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/dock.py -- \
       --out public/assets/models [--preview tools/out/previews]

Same frame as the room kit: floor top z=0, back wall plane y=+2.0, front edge y=-1.0, side-view
cutaway with the detail on the -Y faces. Layout left to right when docked:
  dropship (nose x~-18 ... bay x in [-13, 0], open collar at x=0) | dock_tube x2.. (x in [0, 2]) | hull_dock
The dropship is deliberately a different mood from the derelict: clean blue-grey military interior,
olive armour outside, running lights and faint blue idling thrusters.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mathutils import Matrix, Vector  # noqa: E402

from lib.common import cyl, out_dir, prism, reset_scene, script_args  # noqa: E402
from lib.env import (PAL, Geo, blob, bx, chamfer_rect, check_clear, check_extent, flat, lump, move, pipe,  # noqa: E402
                     plate, poly_prism, quad, ring, rotate, row, col, sag, stencil, stripes, studs, tube,
                     wall_grime, prop_grime, yz_prism, piece_info, smooth, lerp3, _rgb, rifle_parts, place)
from lib.export import bounds, export_glb, write_meta  # noqa: E402

BACK = (0, 1, 0)
C = PAL
MIL = {   # clean military interior + olive exterior armour
    "wall": "#46505c", "wall_dk": "#38414c", "panel": "#4f5a67", "frame": "#5d6874", "trim": "#8a939d",
    "floor": "#2c323a", "floor_lt": "#3d4550", "seat": "#2b3846", "seat_lt": "#364657", "strap": "#15181b",
    "buckle": "#9aa2aa", "stencil": "#aeb5bb", "yellow": "#c9a13a", "armor": "#4a5040", "armor_dk": "#353a2e",
    "armor_lt": "#5f6650", "cut": "#1f2327", "insul": "#2a2f2a", "glass": "#0b151a", "gun": "#2c3034",
    "gun_red": "#5a1f1c", "rubber": "#2e3338", "rubber_lt": "#373d44",
}
DOCK_TOP = 3.2      # collar / tube clear height
TUBE_Y = (-1.0, 2.05)


def mil_grime(seed):
    """Clean ship: only a light floor darkening and faint stains."""
    return wall_grime(seed, floor=0.78, ceil=0.85, stain=0.1, depth=(1.6, 2.0, 0.18))


# ================================================================ dropship

def dropship():
    g = Geo(seed=301)
    x0, x1, zc = -13.0, 0.0, 4.2          # bay interior
    roof, keel = 5.5, -1.5
    # ---------------------------------------------------------------- interior back wall
    g.add(bx(x0, x1, 1.95, 2.05, 0.0, zc), MIL["wall_dk"], cull=[BACK])
    frames = [-12.8, -8.9, -5.0, -1.1]
    for i in range(len(frames) - 1):
        xa, xb = frames[i] + 0.14, frames[i + 1] - 0.14
        g.add(plate(xa, xb, 0.05, 1.45, 1.86, 1.95, steps=[(0.04, -0.01)], bevel=0.01), MIL["wall"], cull=[BACK], jitter=0.02)
        g.add(plate(xa, xb, 1.45, 3.95, 1.86, 1.95, steps=[(0.05, -0.012)], bevel=0.01), MIL["panel"], cull=[BACK], jitter=0.02)
        g.add(stencil(f"0{i + 1}", xa + 0.15, 3.85, 1.855, px=0.03), MIL["stencil"], jitter=0.0)
    for xf in frames:   # structural frames with a knee into the ceiling
        g.add(plate(xf - 0.14, xf + 0.14, 0.0, zc, 1.66, 1.95, steps=[(0.02, -0.01)], bevel=0.015), MIL["frame"], cull=[BACK])
        g.add(yz_prism([(1.66, zc - 0.5), (1.66, zc), (1.2, zc)], xf - 0.12, xf + 0.12), MIL["frame"], cull=[BACK])
        g.add(studs(col(0.3, 3.5, 6, xf, 1.66), s=0.018, h=0.01), MIL["trim"])
    # a strip of cool light along the wall base and a yellow safety line
    g.add(bx(x0, x1, 1.84, 1.95, 0.0, 0.05), MIL["yellow"], cull=[BACK])
    # ---------------------------------------------------------------- bench seats
    for gx in (-12.5, -8.6):
        for k in range(5):
            xs = gx + k * 0.72
            w = 0.66
            g.add(bx(xs + 0.03, xs + w - 0.03, 1.36, 1.9, 0.46, 0.56), MIL["seat"], cull=[BACK], top=0.3)
            g.add(yz_prism([(1.9, 0.46), (1.9, 0.16), (1.85, 0.16), (1.48, 0.44)], xs + w / 2 - 0.02, xs + w / 2 + 0.02),
                  MIL["frame"], cull=[BACK])
            g.add(bx(xs + 0.05, xs + w - 0.05, 1.8, 1.9, 0.62, 1.0), MIL["seat_lt"], cull=[BACK])
            g.add(bx(xs + 0.05, xs + w - 0.05, 1.8, 1.9, 1.04, 1.42), MIL["seat_lt"], cull=[BACK])
            g.add(bx(xs + 0.14, xs + w - 0.14, 1.8, 1.9, 1.5, 1.7), MIL["seat"], cull=[BACK])
            for sx in (xs + 0.16, xs + w - 0.2):   # harness straps + buckle
                g.add(bx(sx, sx + 0.04, 1.785, 1.8, 0.56, 1.42), MIL["strap"], cull=[BACK], jitter=0.0)
            g.add(bx(xs + w / 2 - 0.06, xs + w / 2 + 0.06, 1.775, 1.79, 0.84, 0.92), MIL["buckle"], cull=[BACK])
        # stowage bins above the benches
        g.add(plate(gx - 0.05, gx + 3.55, 2.55, 3.25, 1.55, 1.86, steps=[(0.03, -0.01)], bevel=0.015), MIL["frame"],
              cull=[BACK])
        for k in range(1, 4):
            g.add(quad(gx - 0.05 + k * 0.9, gx - 0.04 + k * 0.9, 2.6, 3.2, 1.549), MIL["strap"], jitter=0.0)
        g.add(stencil("KIT", gx + 0.1, 3.12, 1.548, px=0.022), MIL["stencil"], jitter=0.0)
    # ---------------------------------------------------------------- weapon rack (third bay)
    g.add(plate(-4.7, -2.3, 0.5, 2.3, 1.72, 1.86, steps=[(0.03, -0.01)], bevel=0.01), MIL["wall_dk"], cull=[BACK])
    for z in (0.62, 2.12):
        g.add(bx(-4.7, -2.3, 1.62, 1.86, z - 0.03, z + 0.03), MIL["frame"], cull=[BACK])
    for k in range(4):
        xr = -4.35 + k * 0.58
        parts = rifle_parts(1.35)
        place(parts, rot_y=-90, loc=(xr, 1.66, 0.66))
        for bm, rgb in parts:
            g.add(bm, rgb, cull=[BACK], jitter=0.03)
    for k in range(3):   # ammo boxes under the rack
        xa = -4.6 + k * 0.78
        g.add(bx(xa, xa + 0.62, 1.5, 1.92, 0.0, 0.38, bevel=0.015), MIL["armor"])
        g.add(quad(xa + 0.08, xa + 0.54, 0.22, 0.28, 1.498), MIL["yellow"], jitter=0.0)
    # ---------------------------------------------------------------- jump lights (on the collar lintel face)
    g.add(plate(-0.62, -0.08, 3.42, 4.62, -1.06, -1.03, steps=[(0.02, -0.008)], bevel=0.015), MIL["strap"], cull=[BACK])
    for zl, key in ((4.28, "red"), (3.86, "glow")):
        g.add(cyl(0.14, 0.05, (-0.35, -1.08, zl), rot=(90, 0, 0), verts=10), MIL["frame"], cull=[BACK])
        g.glow(lump((-0.35, -1.1, zl), 0.11, seed=0, seg=10, rings=5, rough=0.0, scale=(1, 0.5, 1), cut="back"), key)
    g.add(stencil("JUMP", -0.35, 3.62, -1.062, px=0.02, anchor="center"), MIL["stencil"], jitter=0.0)
    # ---------------------------------------------------------------- overhead handrail + grab loops
    g.add(pipe((x0 + 0.4, 0.3, 3.78), (-0.9, 0.3, 3.78), 0.03, verts=6, caps=True), MIL["trim"], top=0.4)
    for xp in (-12.2, -8.9, -5.6, -2.3):
        g.add(bx(xp - 0.02, xp + 0.02, 0.28, 0.32, 3.78, zc), MIL["frame"])
    for k in range(10):
        xl = -12.0 + k * 1.15
        g.add(tube([(xl - 0.07, 0.3, 3.76), (xl - 0.09, 0.3, 3.42), (xl + 0.09, 0.3, 3.42), (xl + 0.07, 0.3, 3.76)],
                   0.012, verts=3, caps=False), MIL["strap"], jitter=0.0)
    # ceiling light fixtures (glowing face visible from the side)
    for xl in (-10.5, -6.6, -2.8):
        g.add(bx(xl - 0.7, xl + 0.7, 0.9, 1.5, zc - 0.14, zc), MIL["frame"])
        g.glow(bx(xl - 0.62, xl + 0.62, 0.885, 0.9, zc - 0.11, zc - 0.05), "white")
    # ---------------------------------------------------------------- floor / keel cut section
    g.add(bx(x0, x1, -1.0, 2.05, -0.22, 0.0), MIL["floor"], top=0.15)
    for k in range(13):   # anti-slip ribs seen on the deck edge
        xa = x0 + 0.3 + k * 1.0
        g.add(bx(xa, xa + 0.5, -1.0, 1.95, 0.0, 0.012), MIL["floor_lt"])
    g.add(quad(x0, x1, -0.06, -0.02, -1.004), MIL["yellow"], jitter=0.0)
    for xl in (-12.2, -9.6, -7.0, -4.4, -1.8):   # floor lights
        g.glow(bx(xl - 0.18, xl + 0.18, -1.008, -1.0, -0.16, -0.09), "white")
    # keel: structure band (tapering up at the rear) + armour skin, seen as the cut under the deck
    g.add(bx(x0, -1.9, -0.95, 2.05, keel + 0.3, -0.22), MIL["cut"], cull=[BACK])
    g.add(poly_prism([(-1.9, keel + 0.3), (-0.7, -0.85), (-0.7, -0.22), (-1.9, -0.22)], -0.95, 2.05), MIL["cut"],
          cull=[BACK])
    for xr in frames[:-1]:
        g.add(bx(xr - 0.12, xr + 0.12, -1.0, -0.95, keel + 0.3, -0.22), MIL["frame"], cull=[BACK])
    for i in range(len(frames) - 2):
        xa, xb = frames[i] + 0.12, frames[i + 1] - 0.12
        for s in (1, -1):
            L = math.hypot(xb - xa, 0.9)
            ang = math.degrees(math.atan2(-0.9 * s, xb - xa))
            b = bx(-L / 2, L / 2, -0.985, -0.955, -0.04, 0.04)
            rotate(b, -ang, "Y")
            move(b, ((xa + xb) / 2, 0, (keel + 0.3 - 0.22) / 2))
            g.add(b, MIL["insul"], cull=[BACK])
    g.add(poly_prism([(x0, keel), (-1.9, keel), (-0.7, -1.1), (-0.7, -0.85), (-1.9, keel + 0.3), (x0, keel + 0.3)],
                     -1.02, 2.1), MIL["armor"], cull=[BACK])
    # ---------------------------------------------------------------- roof cut section
    g.add(bx(x0, -0.7, -1.0, 2.05, zc, zc + 0.14), MIL["trim"], cull=[BACK])              # ceiling lining
    g.add(bx(x0, -1.9, -0.96, 2.05, zc + 0.14, roof - 0.32), MIL["insul"], cull=[BACK])   # insulation core
    g.add(poly_prism([(-1.9, zc + 0.14), (-0.7, zc + 0.14), (-0.7, 4.62), (-1.9, roof - 0.32)], -0.96, 2.05),
          MIL["insul"], cull=[BACK])
    for xr in frames[:-1]:
        g.add(bx(xr - 0.12, xr + 0.12, -1.0, -0.96, zc + 0.14, roof - 0.32), MIL["frame"], cull=[BACK])
    g.add(poly_prism([(x0, roof - 0.32), (-1.9, roof - 0.32), (-0.7, 4.62), (-0.7, 4.95), (-1.9, roof), (x0, roof)],
                     -1.02, 2.1), MIL["armor"], cull=[BACK])
    g.add(studs(row(-12.4, -2.4, 9, -1.02, roof - 0.16), s=0.02, h=0.014), MIL["armor_lt"])
    g.add(studs(row(-12.4, -2.4, 9, -1.02, keel + 0.16), s=0.02, h=0.014), MIL["armor_lt"])
    # dorsal spine (raised hump along the roof) + rear main engine with a faint blue exhaust ring
    g.add(prism([(-12.9, roof), (-2.0, roof), (-1.5, roof + 0.2), (-2.2, roof + 0.45), (-12.2, roof + 0.45)], 1.8,
                loc=(0, 0.52, 0), bevel=0.03), MIL["armor_lt"], cull=[BACK])
    eng = [(-4.3, roof + 0.4), (-1.3, roof + 0.4), (-0.8, roof + 0.62), (-0.8, roof + 1.18), (-1.3, roof + 1.36),
           (-3.7, roof + 1.36), (-4.3, roof + 0.95)]
    g.add(prism(eng, 1.3, loc=(0, 0.6, 0), bevel=0.04), MIL["armor_dk"], cull=[BACK])
    g.add(poly_prism([(-3.9, roof + 0.55), (-1.5, roof + 0.55), (-1.2, roof + 0.9), (-1.5, roof + 1.2), (-3.5, roof + 1.2)],
                     0.6 - 0.67, 0.6 - 0.65), MIL["armor"], cull=[BACK])
    for k in range(4):   # intake louvres
        xa = -3.5 + k * 0.35
        g.add(quad(xa, xa + 0.2, roof + 0.7, roof + 1.05, 0.6 - 0.675), MIL["cut"], jitter=0.0)
    nz = cyl(0.3, 0.3, (0, 0, 0), verts=10, r2=0.38)
    rotate(nz, 90, "Y")
    move(nz, (-0.66, 0.6, roof + 0.9))
    g.add(nz, "#1e2226")
    ring_ = cyl(0.39, 0.05, (0, 0, 0), verts=10)
    rotate(ring_, 90, "Y")
    move(ring_, (-0.5, 0.6, roof + 0.9))
    g.glow(ring_, "blue")
    g.glow(bx(-0.52, -0.5, 0.3, 0.9, roof + 0.66, roof + 1.14), "blue")
    # ---------------------------------------------------------------- docking collar (x in [-0.7, 0])
    g.add(bx(-0.7, 0.0, -1.0, 2.05, DOCK_TOP, 4.95), MIL["armor_dk"], cull=[BACK])        # lintel + rear hull
    g.add(plate(-0.7, 0.0, DOCK_TOP, 4.9, -1.03, -1.0, steps=[(0.04, -0.01)], bevel=0.01), MIL["armor"], cull=[BACK])
    g.add(bx(-0.7, 0.0, -1.035, -1.03, DOCK_TOP, DOCK_TOP + 0.2), C["haz_dk"])
    g.add(stripes(-0.7, 0.0, DOCK_TOP + 0.01, DOCK_TOP + 0.19, -1.036, width=0.08, slant=0.8), MIL["yellow"], jitter=0.06)
    g.add(bx(-0.7, 0.0, 1.5, 2.05, 0.0, DOCK_TOP), MIL["armor_dk"], cull=[BACK])          # posts behind the opening
    g.add(plate(-0.7, 0.0, 0.0, DOCK_TOP, 1.5, 1.54, steps=[(0.03, -0.01)]), MIL["frame"], cull=[BACK])
    g.add(bx(-0.7, 0.0, -1.0, 2.05, -0.85, -0.22), MIL["armor_dk"], cull=[BACK])          # sill under the opening
    for z0, z1 in ((DOCK_TOP, 4.0), (-0.8, -0.22)):   # seal flange at x=0 (top/bottom only: opening stays clear)
        g.add(bx(-0.12, 0.0, -1.1, 2.1, z0, z1, bevel=0.01), MIL["trim"])
    g.add(bx(-0.12, 0.0, 1.5, 2.1, 0.0, DOCK_TOP), MIL["trim"], cull=[BACK])
    # ---------------------------------------------------------------- cockpit bulkhead + nose
    g.add(bx(-13.35, x0, -1.0, 2.05, 0.0, zc), MIL["frame"], cull=[BACK])
    g.add(plate(-13.35, x0, 0.0, zc, -1.02, -1.0, steps=[(0.03, -0.008)]), MIL["wall"], cull=[BACK])
    nose = [(-13.35, roof), (-14.7, 5.2), (-16.7, 3.3), (-18.3, 1.15), (-18.05, 0.35), (-16.4, -0.85), (-14.6, keel),
            (-13.35, keel)]
    g.add(prism(nose, 3.15, loc=(0, 0.52, 0), bevel=0.06), MIL["armor"], cull=[BACK])
    yf = 0.52 - 3.15 / 2 - 0.004
    # armour plates on the nose side
    for pts, rgb in (([(-13.45, 5.3), (-14.6, 5.05), (-15.6, 4.1), (-14.1, 3.6), (-13.45, 3.6)], MIL["armor_lt"]),
                     ([(-13.45, 3.45), (-14.2, 3.45), (-16.2, 2.3), (-17.3, 1.1), (-15.2, 0.6), (-13.45, 0.6)], MIL["armor"]),
                     ([(-13.45, 0.45), (-15.1, 0.45), (-17.6, 0.9), (-17.6, 0.4), (-16.2, -0.7), (-14.6, -1.35),
                       (-13.45, -1.35)], MIL["armor_dk"])):
        g.add(poly_prism(pts, yf - 0.03, yf + 0.02), rgb, cull=[BACK], jitter=0.04)
    # canopy
    canopy = [(-16.45, 3.62), (-15.25, 4.72), (-14.3, 4.82), (-14.35, 4.25), (-15.85, 3.42)]
    g.add(poly_prism(canopy, yf - 0.05, yf), MIL["glass"], cull=[BACK], jitter=0.0)
    g.add(flat([(-15.9, 3.95), (-15.3, 4.5), (-15.15, 4.5), (-15.75, 3.95)], yf - 0.055), "#2a4550", jitter=0.0)
    for (x, z), key in (((-14.7, 4.4), "glow"), ((-14.95, 4.33), "amber"), ((-14.55, 4.52), "red")):
        g.glow(quad(x - 0.04, x + 0.04, z - 0.025, z + 0.025, yf - 0.056), key)
    for pts in (([(-16.5, 3.55), (-14.25, 4.9), (-14.25, 4.97), (-16.58, 3.62)]),):
        g.add(poly_prism(pts, yf - 0.07, yf - 0.02), MIL["armor_dk"], cull=[BACK])
    # hazard chevrons + unit markings + nav light on the nose
    g.add(stripes(-17.9, -16.9, 0.45, 0.72, yf - 0.035, width=0.1, slant=0.8), MIL["yellow"], jitter=0.06)
    g.add(stencil("21", -14.55, 2.9, yf - 0.035, px=0.07), "#b9bcb0", jitter=0.03)
    g.add(stencil("KESTREL", -14.9, 1.95, yf - 0.035, px=0.028), "#9da190", jitter=0.03)
    g.glow(lump((-18.25, yf + 0.25, 1.12), 0.07, seed=0, seg=6, rings=4, rough=0.0), "red")
    g.add(lump((-16.9, 0.5, -0.8), 0.28, seed=2, seg=8, rings=5, rough=0.0, scale=(1.0, 1.0, 0.7), cut="top"),
          MIL["armor_dk"])                                                                      # chin sensor
    g.glow(quad(-17.0, -16.8, -0.78, -0.72, 0.5 - 0.29), "red")
    # exterior armour plates on the roof/keel skins, keel hazard band + markings
    for i in range(len(frames) - 1):
        xa, xb = frames[i] + 0.16, frames[i + 1] - 0.16
        for z0, z1, rgb in ((roof - 0.29, roof - 0.04, MIL["armor_lt"] if i % 2 else MIL["armor"]),
                            (keel + 0.04, keel + 0.28, MIL["armor"] if i % 2 else MIL["armor_lt"])):
            g.add(plate(xa, xb, z0, z1, -1.045, -1.02, bevel=0.01), rgb, cull=[BACK], jitter=0.04)
    g.add(stripes(-4.8, -2.2, keel + 0.06, keel + 0.26, -1.047, width=0.12, slant=0.8), MIL["yellow"], jitter=0.06)
    g.add(stencil("NO STEP", -12.2, keel + 0.22, -1.047, px=0.022), "#9da190", jitter=0.03)
    g.add(stencil("2-1", -12.2, roof - 0.08, -1.047, px=0.03), "#9da190", jitter=0.03)
    for k in range(3):   # nose intake slots
        g.add(quad(-15.9 + k * 0.28, -15.72 + k * 0.28, 0.9, 1.3, yf - 0.035), MIL["cut"], jitter=0.0)
    # ---------------------------------------------------------------- dorsal fin + antennae
    fin = [(-9.6, roof + 0.4), (-6.2, roof + 0.4), (-5.0, 7.45), (-5.8, 7.6), (-7.8, 6.55)]
    g.add(prism(fin, 0.3, loc=(0, 0.52, 0), bevel=0.03), MIL["armor"], cull=[BACK])
    g.add(poly_prism([(-6.3, 6.35), (-5.45, 7.2), (-5.35, 7.0), (-6.1, 6.2)], 0.52 - 0.16, 0.52 - 0.15), MIL["yellow"])
    g.glow(lump((-5.4, 0.36, 7.57), 0.05, seed=0, seg=6, rings=4, rough=0.0), "glow")
    for xa, zb, h in ((-11.4, roof + 0.45, 1.0), (-2.0, roof + 1.36, 0.6)):
        g.add(pipe((xa, 0.4, zb), (xa, 0.4, zb + h), 0.022, verts=5), MIL["trim"])
        g.add(pipe((xa - 0.06, 0.4, zb), (xa - 0.06, 0.4, zb + 0.18), 0.05, verts=6), MIL["armor_dk"])
    g.glow(lump((-11.4, 0.4, roof + 1.47), 0.035, seed=0, seg=5, rings=3, rough=0.0), "red")
    g.add(lump((-10.3, 0.5, roof + 0.45), 0.35, seed=1, seg=8, rings=4, rough=0.0, scale=(1.3, 1.0, 0.5), cut="bottom"),
          MIL["armor_dk"])                                                                      # sensor dome
    # ---------------------------------------------------------------- thruster pods under the keel
    for xa, xb in ((-11.9, -8.2), (-5.2, -1.9)):
        pod = [(xa, keel), (xb - 0.3, keel), (xb, keel - 0.35), (xb - 0.3, keel - 0.8), (xa + 0.4, keel - 0.8),
               (xa, keel - 0.45)]
        g.add(prism(pod, 2.0, loc=(0, 0.5, 0), bevel=0.04), MIL["armor_dk"], cull=[BACK])
        g.add(poly_prism([(xa + 0.3, keel - 0.12), (xb - 0.5, keel - 0.12), (xb - 0.35, keel - 0.35),
                          (xb - 0.5, keel - 0.62), (xa + 0.5, keel - 0.62)], -0.52, -0.5), MIL["armor"], cull=[BACK])
        # rear main nozzle (angled down-back) with a faint blue ring, plus two VTOL skirts
        nz = cyl(0.26, 0.4, (0, 0, 0), verts=10, r2=0.34)
        rotate(nz, 120, "Y")
        move(nz, (xb + 0.08, 0.5, keel - 0.45))
        g.add(nz, "#1e2226")
        rg = cyl(0.36, 0.06, (0, 0, 0), verts=10)
        rotate(rg, 120, "Y")
        move(rg, (xb + 0.24, 0.5, keel - 0.54))
        g.glow(rg, "blue")
        for xv in (xa + 0.8, xa + 1.9):
            g.add(cyl(0.22, 0.22, (xv, 0.5, keel - 0.9), verts=10, r2=0.18), "#1e2226")
            g.glow(cyl(0.23, 0.05, (xv, 0.5, keel - 1.02), verts=10), "blue")
    return g.build("dropship", grime=mil_grime(301))


# ================================================================ boarding tube

def dock_tube():
    """2 m ribbed flexible boarding tube, cut away along the front. Tiles along X."""
    g = Geo(seed=311)
    top, bot = DOCK_TOP, -0.12
    # walkway grating + front edge
    g.add(bx(0, 2, -1.0, 2.0, bot, 0.0), C["steel"], top=0.2)
    for i in range(20):
        x = 0.02 + i * 0.1
        g.add(bx(x, x + 0.03, -1.0, -0.96, bot, 0.0), C["steel_lt"], cull=[BACK], top=0.3)
    g.add(bx(0, 2, -1.0, -0.96, bot - 0.06, bot), MIL["yellow"], cull=[BACK])
    # back wall: bellows pleats (sawtooth in plan) between the rigid hoops
    g.add(bx(0, 2, 1.95, 2.05, 0.0, top), MIL["rubber"], cull=[BACK])
    for i in range(8):
        xa = i * 0.25
        pts = [(xa, 1.95), (xa + 0.125, 1.87), (xa + 0.25, 1.95)]
        # pleat: two slanted faces (a ridge running up the wall), lit side and shadow side
        for (a, ya), (b, yb), rgb in ((pts[0], pts[1], MIL["rubber_lt"]), (pts[1], pts[2], MIL["rubber"])):
            q = _vquad((a, ya, 0.02), (b, yb, 0.02), (b, yb, top - 0.02), (a, ya, top - 0.02))
            g.add(q, rgb, jitter=0.03, side=0.08)
    # top and bottom skins (cut sections) with pleats on the front face
    for z0, z1 in ((top, top + 0.62), (-0.72, bot - 0.06)):
        g.add(bx(0, 2, -0.95, 2.05, z0, z1), MIL["rubber"], cull=[BACK])
        for i in range(8):
            xa = i * 0.25
            g.add(yz_prism([(-0.95, z0 + 0.03), (-1.0, z0 + 0.06), (-1.0, z1 - 0.06), (-0.95, z1 - 0.03)], xa + 0.03,
                           xa + 0.22), MIL["rubber_lt"], cull=[BACK], jitter=0.04)
    # rigid hoops: half at each seam (x=0, x=2) + one in the middle
    for xa, xb in ((0.0, 0.07), (0.93, 1.07), (1.93, 2.0)):
        for z0, z1 in ((top - 0.02, top + 0.7), (-0.8, bot)):
            g.add(bx(xa, xb, -1.04, 2.1, z0, z1, bevel=0.01), C["steel"], cull=[BACK], top=0.3)
        g.add(bx(xa, xb, 1.72, 2.1, 0.0, top), C["steel"], cull=[BACK])
    g.add(studs([(1.0, -1.04, z) for z in (top + 0.2, top + 0.5, -0.3, -0.6)], s=0.018, h=0.012), C["steel_lt"])
    # running lights: amber at the floor edge, white under the top skin
    g.add(bx(0.88, 1.12, -1.07, -1.04, -0.42, -0.3), C["dark"])
    g.glow(bx(0.91, 1.09, -1.075, -1.07, -0.4, -0.32), "amber")
    g.add(bx(0.88, 1.12, -1.07, -1.04, top + 0.3, top + 0.42), C["dark"])
    g.glow(bx(0.91, 1.09, -1.075, -1.07, top + 0.32, top + 0.4), "white")
    g.glow(bx(0.2, 0.8, 1.93, 1.95, top - 0.12, top - 0.06), "white")
    g.glow(bx(1.2, 1.8, 1.93, 1.95, top - 0.12, top - 0.06), "white")
    # handrail along the back wall (continuous across tiles)
    g.add(pipe((0.0, 1.66, 1.0), (2.0, 1.66, 1.0), 0.025, verts=6, caps=False), C["steel_lt"], top=0.4)
    g.add(bx(0.97, 1.03, 1.66, 1.8, 0.97, 1.03), C["steel"])
    return g.build("dock_tube", grime=mil_grime(311))


def _vquad(a, b, c, d):
    import bmesh
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(p) for p in (a, b, c, d)])
    bm.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    return bm


# ================================================================ docking hull

def hull_dock():
    """Derelict outer hull at the airlock with a boarding tube clamped on (replaces hull_airlock
    while docked). Cut-away doorway z in [0, 3] like bulkhead_door; the engine adds a door_panel.
    The tube arrives from the LEFT (outside); its seal ring and clamps sit on the x=-0.6 side."""
    g = Geo(seed=321)
    # lintel and keel blocks (full depth), back posts behind the doorway
    g.add(bx(-0.6, 0.6, -0.9, 2.0, 3.0, 4.5), C["panel3"], cull=[BACK])
    g.add(bx(-0.6, 0.6, -0.9, 2.0, -0.5, 0.0), C["panel3"], cull=[BACK])
    g.add(bx(-0.6, 0.6, 1.55, 2.0, 0.0, 3.0), C["panel3"], cull=[BACK])
    g.add(plate(-0.6, 0.6, 0.0, 3.0, 1.51, 1.55, steps=[(0.04, -0.01)]), C["rib"], cull=[BACK])
    g.add(bx(-0.6, 0.6, 1.503, 1.51, 0.0, 0.45), C["haz_dk"])
    g.add(stripes(-0.6, 0.6, 0.02, 0.43, 1.501, width=0.09, slant=-0.6), C["haz"], jitter=0.1)
    for x in (-0.28, 0.28):   # shutter guide rails
        g.add(bx(x - 0.02, x + 0.02, 1.58, 1.65, 0.0, 3.0), C["dark"])
    # heavy hull plating on the lintel face (like hull_end), hazard edge, status lights, stencil
    for xa, xb in ((-0.6, -0.42), (0.42, 0.6)):
        g.add(plate(xa, xb, 3.0, 4.5, -1.0, -0.9, steps=[(0.02, -0.01)], bevel=0.015), C["rib"], cull=[BACK])
        g.add(plate(xa, xb, -0.5, 0.0, -1.0, -0.9, steps=[(0.02, -0.01)], bevel=0.015), C["rib"], cull=[BACK])
    g.add(plate(-0.42, 0.42, 3.0, 4.5, -0.98, -0.9, steps=[(0.04, -0.012), (0.03, 0.006)]), C["panel2"], cull=[BACK])
    g.add(plate(-0.42, 0.42, -0.5, 0.0, -0.98, -0.9, steps=[(0.03, -0.01)]), C["panel2"], cull=[BACK])
    g.add(bx(-0.6, 0.6, -1.0, -0.98, 3.0, 3.18), C["haz_dk"])
    g.add(stripes(-0.6, 0.6, 3.01, 3.17, -1.0, width=0.08, slant=0.8), C["haz"], jitter=0.1)
    g.add(stencil("DOCK 1", 0.02, 4.43, -0.985, px=0.018, anchor="center"), C["stencil_y"], jitter=0.0)
    for x, key in ((-0.1, "red"), (0.1, "glow")):
        g.add(bx(x - 0.07, x + 0.07, -0.995, -0.98, 4.0, 4.14), C["dark"])
        g.glow(bx(x - 0.05, x + 0.05, -1.0, -0.995, 4.02, 4.12), key)
    g.add(studs(row(-0.3, 0.3, 4, -0.98, 3.3) + row(-0.3, 0.3, 4, -0.98, -0.1), s=0.014, h=0.01), C["steel_lt"])
    # docking seal ring on the outer (left) face: only top, bottom and back parts, so the doorway
    # stays see-through; black gasket + steel flange
    for z0, z1 in ((3.0, 3.98), (-0.5, 0.0)):
        g.add(bx(-0.585, -0.44, -1.0, 2.0, z0, z1, bevel=0.012), C["steel"], cull=[BACK], top=0.3)
        g.add(bx(-0.6, -0.585, -1.0, 2.0, z0, z1), MIL["rubber"], cull=[BACK])
    g.add(bx(-0.6, -0.44, 1.5, 2.0, 0.0, 3.0), C["steel"], cull=[BACK])
    g.add(studs(col(3.1, 3.9, 3, -0.52, -1.0) + col(-0.42, -0.08, 2, -0.52, -1.0), s=0.016, h=0.0), C["steel_lt"])
    # hydraulic clamps gripping the ring (above the lintel edge and below the floor)
    for zc, flip in ((3.74, 1), (-0.27, -1)):
        g.add(plate(-0.34, 0.22, zc - 0.19, zc + 0.19, -1.0, -0.93, steps=[(0.02, -0.008)], bevel=0.015), C["dark"])
        g.add(stripes(-0.32, 0.2, zc - 0.17, zc + 0.17, -1.0, width=0.06, slant=0.8), C["haz"], jitter=0.1)
        g.add(pipe((-0.56, -0.965, zc), (-0.3, -0.965, zc), 0.055, verts=6), C["steel_lt"], top=0.4)
        g.add(pipe((-0.3, -0.965, zc), (-0.12, -0.965, zc), 0.08, verts=6), C["rib"])
        claw = [(-0.6, zc - 0.17), (-0.46, zc - 0.17), (-0.4, zc + 0.19 * flip), (-0.6, zc + 0.19 * flip)]
        g.add(poly_prism(claw, -1.0, -0.92), C["steel"], top=0.3)
        g.add(studs([(-0.52, -1.0, zc), (0.12, -0.93, zc - 0.13), (0.12, -0.93, zc + 0.13)], s=0.018, h=0.0),
              C["steel_lt"])
    g.squash("y", -1.0, -0.9)
    return g.build("hull_dock", grime=wall_grime(321, floor=0.75, stain=0.14))


# ================================================================ build / checks / export

PIECES = [("dropship", dropship), ("dock_tube", dock_tube), ("hull_dock", hull_dock)]
CONTRACT = {
    "dock_tube": dict(x=(0, 2), y=(-1.1, 2.1), z=(-0.9, 4.0)),
    "hull_dock": dict(x=(-0.6, 0.6), y=(-1, 2), z=(-0.5, 4.5)),
}
BUDGET = {"dropship": 6000, "dock_tube": 1500, "hull_dock": 1500}


def validate(pieces):
    problems = []
    for n, rng in CONTRACT.items():
        problems += check_extent(pieces[n], **rng)
    lo_x = min((pieces["dropship"].matrix_world @ v.co).x for v in pieces["dropship"].data.vertices)
    hi_x = max((pieces["dropship"].matrix_world @ v.co).x for v in pieces["dropship"].data.vertices)
    if hi_x > 0.005 or lo_x > -17.5:
        problems.append(f"dropship: x [{lo_x:.2f}, {hi_x:.2f}] (collar must end at x=0, nose near -18)")
    # walk-through openings must be clear in front of the back posts
    b = check_clear(pieces["dropship"], (-0.68, -0.02), (0.03, DOCK_TOP - 0.03), y_stop=1.5)
    b += check_clear(pieces["dock_tube"], (0.02, 1.98), (0.03, DOCK_TOP - 0.03), y_stop=1.6)
    b += check_clear(pieces["hull_dock"], (-0.58, 0.58), (0.03, 2.97), y_stop=1.5)
    if b:
        problems.append(f"{b} rays blocked in the walk-through openings")
    for p in problems:
        print("WARN contract", p)
    return problems


def build():
    out = {}
    for name, fn in PIECES:
        obj = fn()
        assert obj.name == name, (obj.name, name)
        out[name] = obj
    return out


def main():
    args = script_args()
    out = out_dir(args)
    reset_scene()
    pieces = build()
    info = {n: piece_info(o) for n, o in pieces.items()}
    for n, i in info.items():
        flag = "  OVER BUDGET" if i["tris"] > BUDGET[n] else ""
        print(f"STATS dock {n:10s} w={i['w']:.2f} h={i['h']:.2f} tris={i['tris']}{flag}")
    validate(pieces)
    export_glb(os.path.join(out, "dock.glb"), list(pieces.values()))
    write_meta(out, "dock", {"nodes": list(pieces), "pieces": info, "bounds": bounds(list(pieces.values()))})
    if args.get("preview"):
        from lib.env import sheet
        pdir = out_dir(args, "preview", "tools/out/previews")
        sheet([(n, o) for n, o in pieces.items()], os.path.join(pdir, "dock.png"), cols=3, tile=520, yaw=0, pitch=5)
        sheet([(n, o) for n, o in pieces.items()], os.path.join(pdir, "dock_3q.png"), cols=3, tile=520, yaw=28, pitch=14)
        import mockup
        mockup.docked(pieces, os.path.join(pdir, "dock_mockup.png"))


if __name__ == "__main__":
    main()
