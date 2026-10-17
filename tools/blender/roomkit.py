"""Modular derelict-ship room kit -> public/assets/models/roomkit.glb (one top-level node per piece).

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/roomkit.py -- \
       --out public/assets/models [--preview tools/out/previews]

Deck frame (see README "roomkit.glb"): floor top z=0, ceiling underside z=4.5, back wall plane y=+2.0,
front floor edge y=-1.0. Every piece is modelled at its final depth with its node origin at x=0, z=0
(door_panel: origin at its top centre). The camera looks from -Y, so front faces carry the detail
and faces pointing +Y (into the wall) are culled.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mathutils import Vector, noise as mnoise  # noqa: E402

from lib.common import cyl, out_dir, reset_scene, script_args  # noqa: E402
from lib.env import (Geo, blob, bx, chamfer_rect, circle, flat, lump, move, pipe, plate,  # noqa: E402
                     poly_prism, quad, ring, rotate, row, col, sag, stencil, stripes, studs, tube,
                     wall_grime, prop_grime, yz_prism, piece_info, PAL, smooth, lerp3, _rgb, check_extent, check_clear)
from lib.export import bounds, export_glb, write_meta  # noqa: E402

BACK = (0, 1, 0)   # cull direction: faces pointing into the back wall are never seen

C = PAL
PALRGB = _rgb
mix3 = lerp3


# ================================================================ wear helpers

def shadow(g, x0, x1, z_top, h, y, rgb, k=0.5):
    """Soft contact shadow under a ledge: a quad at y fading from rgb*k (top) to rgb (bottom)."""
    base = PALRGB(rgb)
    g.add(quad(x0, x1, z_top - h, z_top, y), rgb, jitter=0.0,
          vfn=lambda co, c: tuple(ch * (k + (1 - k) * (z_top - co.z) / h) for ch in base))


def streak(g, x, z_top, length, w, y, seed, rgb=None, fade=None):
    """Ragged drip streak running down from (x, z_top), fading into the surface colour `fade`."""
    rnd = random.Random(seed)
    top, bot = PALRGB(rgb or C["rust_dk"]), PALRGB(fade or C["panel"])
    pts = [(x - w, z_top), (x + w, z_top), (x + w * 0.7, z_top - length * 0.35),
           (x + w * 0.35 + rnd.uniform(-0.01, 0.01), z_top - length * 0.75), (x + w * 0.1, z_top - length),
           (x - w * 0.15, z_top - length * 0.8), (x - w * 0.55, z_top - length * 0.45)]
    g.add(flat(pts, y - 0.003), rgb or C["rust_dk"], jitter=0.0,
          vfn=lambda co, c: mix3(top, bot, smooth(0.0, 1.0, (z_top - co.z) / length) ** 0.8))


def rust(g, cx, cz, rx, rz, y, seed, two=True, drips=1, fade=None):
    """Ragged rust patch (separate plates just in front of a face) with fading drip streaks."""
    g.add(flat(blob(cx, cz, rx, rz, 11, seed, jag=0.5), y - 0.004), C["rust_dk"],
          jitter=0.15)
    if two:
        g.add(flat(blob(cx - rx * 0.1, cz + rz * 0.1, rx * 0.55, rz * 0.5, 8, seed + 1, jag=0.45),
                    y - 0.007), C["rust"], jitter=0.15)
    rnd = random.Random(seed)
    for i in range(drips):
        x = cx + rnd.uniform(-rx * 0.5, rx * 0.5)
        streak(g, x, cz - rz * 0.3, rz * rnd.uniform(1.2, 2.4), rx * 0.18, y - 0.002, seed + 7 + i, C["rust_dk"], fade)


def patch(g, x0, x1, z0, z1, y, rgb, seed):
    """Bolted repair plate with a slightly different tint (patchwork wear)."""
    g.add(plate(x0, x1, z0, z1, y, y + 0.03, bevel=0.008), rgb, cull=[BACK], jitter=0.06)
    g.add(studs([(x0 + 0.035, y, z0 + 0.035), (x1 - 0.035, y, z0 + 0.035), (x0 + 0.035, y, z1 - 0.035),
                 (x1 - 0.035, y, z1 - 0.035)], s=0.014, h=0.01), C["steel"])


def seam(g, x0, x1, z0, z1, y):
    g.add(quad(x0, x1, z0, z1, y), C["void"], jitter=0.0)


# ================================================================ back-wall panels
# Bands (z): kick 0-0.36 | lower panel 0.36-1.45 | rail 1.45-1.6 | upper panel 1.6-3.75 |
# conduits 3.87 / 3.99 | sloped cornice 4.1-4.5. Half-ribs at x=+-1 pair up across tile seams.
# Everything continuous (rail, conduits, cornice, rib rhythm) is identical in every variant, so a
# run of mixed tiles reads as one room.

def wall_frame(g, seed, window=False, upper=True, lower=True, kick_slots=True, lower_rgb=None):
    if window:
        for x0, x1, z0, z1 in ((-1, -0.7, 0, 4.5), (0.7, 1, 0, 4.5), (-0.7, 0.7, 0, 1.75), (-0.7, 0.7, 3.35, 4.5)):
            g.add(bx(x0, x1, 1.95, 2.0, z0, z1), C["back"], cull=[BACK])
    else:
        g.add(bx(-1, 1, 1.95, 2.0, 0, 4.5), C["back"], cull=[BACK])
    for x0, x1, xs in ((-1.0, -0.9, -0.955), (0.9, 1.0, 0.955)):
        g.add(plate(x0, x1, 0, 4.5, 1.72, 1.95, steps=[(0.018, -0.01)], bevel=0.012), C["rib"], cull=[BACK])
        g.add(studs(col(0.3, 3.9, 7, xs, 1.728), s=0.017, h=0.012), C["steel"])
    g.add(plate(-0.9, 0.9, 0, 0.36, 1.82, 1.95, steps=[(0.025, -0.012)], bevel=0.008), C["kick"], cull=[BACK])
    if kick_slots:
        for i in range(5):
            x = -0.62 + i * 0.07
            g.add(quad(x, x + 0.035, 0.1, 0.26, 1.826), C["void"], jitter=0.0)
    lo = lower_rgb or C["panel"]
    if lower:
        g.add(plate(-0.9, 0.9, 0.36, 1.45, 1.84, 1.95, steps=[(0.045, -0.014), (0.05, 0.008)], bevel=0.008),
              lo, cull=[BACK], jitter=0.02)
    g.add(bx(-0.9, 0.9, 1.78, 1.95, 1.45, 1.6, bevel=0.014), C["steel"], cull=[BACK])
    g.add(studs(row(-0.8, 0.8, 7, 1.778, 1.525), s=0.016, h=0.01), C["steel_lt"])
    if lower:
        shadow(g, -0.9, 0.9, 1.45, 0.16, 1.836, lo)
    if upper:
        g.add(plate(-0.9, 0.9, 1.6, 3.75, 1.86, 1.95, steps=[(0.05, -0.016)], bevel=0.008), C["panel2"],
              cull=[BACK], jitter=0.02)
        shadow(g, -0.9, 0.9, 3.75, 0.2, 1.856, C["panel2"], k=0.55)
    g.add(pipe((-1, 1.8, 3.87), (1, 1.8, 3.87), 0.042, caps=False), C["pipe"], cull=[BACK])
    g.add(pipe((-1, 1.84, 3.99), (1, 1.84, 3.99), 0.028, caps=False, verts=6), C["pipe_g"], cull=[BACK])
    for x in (-0.55, 0.55):
        g.add(bx(x - 0.03, x + 0.03, 1.745, 1.95, 3.81, 4.04), C["dark"], cull=[BACK])
    g.add(yz_prism([(1.95, 4.1), (1.95, 4.5), (1.69, 4.5), (1.69, 4.4)], -1, 1), C["panel3"], cull=[BACK])
    g.add(bx(-1, 1, 1.685, 1.72, 4.4, 4.5), C["rib"], cull=[BACK])


def wall_plain():
    g = Geo(seed=11)
    wall_frame(g, 1, upper=False, lower=False)
    g.add(plate(-0.9, 0.9, 0.36, 1.45, 1.84, 1.95, steps=[(0.04, -0.012)], bevel=0.008), C["panel"], cull=[BACK],
          jitter=0.02)
    for z in (0.62, 0.9, 1.18):   # horizontal stiffeners with their own little shadows
        g.add(bx(-0.8, 0.8, 1.815, 1.855, z - 0.03, z + 0.03, bevel=0.01), C["panel2"], cull=[BACK])
        shadow(g, -0.8, 0.8, z - 0.03, 0.07, 1.849, C["panel"], k=0.6)
    shadow(g, -0.86, 0.86, 1.45, 0.14, 1.848, C["panel"])
    for x0, x1 in ((-0.9, -0.03), (0.03, 0.9)):   # two tall raised panels
        g.add(plate(x0, x1, 1.6, 3.75, 1.86, 1.95, steps=[(0.05, -0.018), (0.07, 0.012)], bevel=0.008),
              C["panel2"], cull=[BACK], jitter=0.02)
    shadow(g, -0.9, 0.9, 3.75, 0.2, 1.856, C["panel2"], k=0.55)
    seam(g, 0.1, 0.83, 2.62, 2.635, 1.864)
    g.add(plate(-0.06, 0.06, 1.6, 3.75, 1.8, 1.95, steps=[(0.015, -0.006)], bevel=0.01), C["rib"], cull=[BACK])
    g.add(studs(col(1.75, 3.6, 7, 0.0, 1.8), s=0.016, h=0.01), C["steel"])
    # unlabelled ID plate (no legible text: this tile repeats a lot) + a faded arrow marking
    g.add(bx(0.3, 0.66, 1.84, 1.86, 3.24, 3.4, bevel=0.006), C["dark"], cull=[BACK])
    for i, w in enumerate((0.22, 0.14, 0.18)):
        g.add(quad(0.34, 0.34 + w, 3.36 - i * 0.04, 3.38 - i * 0.04, 1.837), C["stencil"], jitter=0.05)
    g.add(flat([(-0.8, 1.29), (-0.62, 1.29), (-0.62, 1.25), (-0.54, 1.325), (-0.62, 1.4), (-0.62, 1.36), (-0.8, 1.36)],
               1.842), C["stencil_y"], jitter=0.05)
    # junction box feeding the conduit
    g.add(plate(0.45, 0.7, 2.05, 2.4, 1.78, 1.86, steps=[(0.02, -0.008)], bevel=0.01), C["steel"], cull=[BACK])
    g.add(studs([(0.47, 1.78, 2.07), (0.68, 1.78, 2.07), (0.47, 1.78, 2.38), (0.68, 1.78, 2.38)], s=0.012, h=0.008),
          C["steel_lt"])
    shadow(g, 0.45, 0.7, 2.05, 0.1, 1.855, C["panel2"], k=0.55)
    g.add(tube([(0.575, 1.81, 2.4), (0.575, 1.81, 3.55), (0.61, 1.81, 3.72), (0.61, 1.81, 3.85)], 0.022, verts=6),
          C["pipe"], cull=[BACK])
    patch(g, -0.72, -0.3, 2.2, 2.75, 1.84, "#3a3a33", 3)
    rust(g, -0.55, 0.8, 0.26, 0.18, 1.838, 5, drips=2)
    rust(g, 0.64, 3.55, 0.12, 0.09, 1.832, 9, two=False, fade=C["panel2"])
    streak(g, 0.575, 2.05, 0.5, 0.04, 1.85, 3, C["grime"], C["panel2"])
    streak(g, -0.45, 1.45, 0.55, 0.06, 1.834, 4, C["grime"])
    return g.build("wall_plain", grime=wall_grime(1))


def wall_pipes():
    g = Geo(seed=12)
    wall_frame(g, 2, lower_rgb="#31363a")
    runs = [(2.45, 1.73, 0.14, C["pipe_cu"]), (2.86, 1.77, 0.085, C["pipe_g"]), (1.12, 1.74, 0.075, C["pipe"])]
    for z, y, r, rgb in runs:
        shadow(g, -0.9, 0.9, z - r * 0.4, r * 1.8, 1.838 if z < 1.5 else 1.858, "#31363a" if z < 1.5 else C["panel2"],
               k=0.45)
        g.add(pipe((-1, y, z), (1, y, z), r, verts=8, caps=False), rgb, cull=[BACK], jitter=0.04)
        for x0, x1 in ((-1, -0.955), (0.955, 1)):
            g.add(pipe((x0, y, z), (x1, y, z), r + 0.03, verts=8, caps=False), C["steel"], cull=[BACK])
        g.add(studs([(-0.97, y - r - 0.03, z), (0.97, y - r - 0.03, z)], s=0.012, h=0.01), C["steel_lt"])
        for x in (-0.42, 0.42):   # clamp bands + standoffs
            g.add(pipe((x - 0.03, y, z), (x + 0.03, y, z), r + 0.014, verts=8, caps=False), C["dark"], cull=[BACK])
            g.add(bx(x - 0.04, x + 0.04, y, 1.9, z - 0.04, z + 0.04), C["dark"], cull=[BACK])
    # riser with elbows, valve wheel and gauge
    g.add(tube([(-0.6, 1.74, 1.12), (-0.6, 1.72, 1.3), (-0.6, 1.72, 2.2), (-0.6, 1.73, 2.4)], 0.055, verts=6),
          C["pipe"], cull=[BACK])
    wheel = tube([(-0.6 + 0.13 * math.cos(a), 1.63, 1.8 + 0.13 * math.sin(a))
                  for a in [2 * math.pi * i / 10 for i in range(11)]], 0.016, verts=4, caps=False)
    g.add(wheel, C["valve"], jitter=0.05)
    for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
        g.add(tube([(-0.6, 1.64, 1.8), (-0.6 + 0.12 * math.cos(a + 0.4), 1.635, 1.8 + 0.12 * math.sin(a + 0.4))],
                   0.01, verts=3, caps=False), C["valve"])
    g.add(pipe((-0.6, 1.62, 1.8), (-0.6, 1.68, 1.8), 0.03, verts=6), C["dark"])
    g.add(pipe((-0.45, 1.69, 1.55), (-0.45, 1.74, 1.55), 0.07, verts=8), C["steel"], cull=[BACK])
    g.add(pipe((-0.45, 1.686, 1.55), (-0.45, 1.69, 1.55), 0.055, verts=8), "#8c8a78", jitter=0.0)
    g.add(bx(-0.452, -0.448, 1.683, 1.686, 1.55, 1.6), "#8a1c16", jitter=0.0)
    # sagging cable bundle hung from clips at the seams
    for i, (dy, r, rgb) in enumerate(((0.0, 0.024, C["cable"]), (0.035, 0.019, C["cable_r"]),
                                      (0.065, 0.016, C["cable_y"]), (0.02, 0.014, C["cable"]))):
        pts = sag((-0.985, 1.66 + dy, 3.42 - i * 0.02), (0.985, 1.66 + dy, 3.42 - i * 0.02), 0.2 + i * 0.03, 6)
        g.add(tube(pts, r, verts=4, caps=False, phase=math.pi / 4), rgb, jitter=0.03)
    for x in (-0.96, 0.96):
        g.add(bx(x - 0.04, x + 0.04, 1.63, 1.72, 3.28, 3.46, bevel=0.01), C["dark"], cull=[BACK])
    # leak below the big flange, rust on the kick plate
    streak(g, 0.9, 2.3, 0.62, 0.06, 1.852, 4, C["rust_dk"], C["panel2"])
    streak(g, 0.1, 2.3, 0.4, 0.05, 1.852, 5, C["grime"], C["panel2"])
    rust(g, 0.55, 0.8, 0.2, 0.14, 1.838, 21, fade="#31363a")
    rust(g, -0.3, 0.2, 0.18, 0.08, 1.818, 23, two=False, drips=0)
    return g.build("wall_pipes", grime=wall_grime(2))


def wall_vent():
    g = Geo(seed=13)
    wall_frame(g, 3)
    outer = chamfer_rect(-0.64, 0.64, 1.98, 3.4, 0.12)
    inner = chamfer_rect(-0.5, 0.5, 2.1, 3.28, 0.07)
    g.add(ring(inner, outer, 1.65, 1.9, y_inner=1.7), C["steel"], cull=[BACK])
    g.add(bx(-0.52, 0.52, 1.88, 1.9, 2.08, 3.3), C["void"], cull=[BACK])
    g.add(bx(-0.52, 0.52, 1.72, 1.88, 2.08, 2.12), C["dark"])
    for i in range(8):                                                  # louvres
        z = 2.2 + i * 0.142
        s = bx(-0.5, 0.5, 1.78 - 0.013, 1.78 + 0.013, z - 0.075, z + 0.075)
        rotate(s, 38, "X", (0, 1.78, z))
        if i == 5:   # one louvre knocked loose, hanging askew
            rotate(s, 7, "Y", (-0.5, 1.78, z))
        g.add(s, C["panel"] if i != 5 else C["rust_dk"], cull=[BACK], top=0.35)
    g.add(bx(-0.025, 0.025, 1.7, 1.86, 2.1, 3.28), C["dark"], cull=[BACK])
    g.add(studs([(x, 1.655, z) for x, z in ((-0.57, 2.05), (0.57, 2.05), (-0.57, 3.33), (0.57, 3.33),
                                            (0.0, 2.02), (0.0, 3.36))], s=0.022, h=0.014), C["steel_lt"])
    shadow(g, -0.64, 0.64, 1.98, 0.14, 1.856, C["panel2"], k=0.5)
    # soot above the vent, dirt streaks below
    g.add(flat(blob(0.0, 3.53, 0.5, 0.13, 9, 31), 1.852), C["grime"], jitter=0.1)
    for i, x in enumerate((-0.42, -0.1, 0.3, 0.48)):
        streak(g, x, 1.98, 0.22 + 0.1 * (i % 2), 0.035, 1.852, 7 + i, C["grime"], C["panel2"])
    g.add(bx(0.3, 0.78, 1.832, 1.86, 1.02, 1.22, bevel=0.005), C["dark"], cull=[BACK])
    g.add(stencil("V-3", 0.36, 1.18, 1.83, px=0.022), C["stencil"], jitter=0.0)
    patch(g, -0.8, -0.35, 0.5, 0.95, 1.838, "#3b352f", 2)
    rust(g, -0.62, 0.62, 0.14, 0.1, 1.834, 44, drips=1)
    return g.build("wall_vent", grime=wall_grime(3))


def wall_window():
    g = Geo(seed=14)
    wall_frame(g, 4, window=True, upper=False)
    g.add(plate(-0.9, 0.9, 3.52, 3.75, 1.86, 1.95, bevel=0.006), C["panel2"], cull=[BACK])
    opening = chamfer_rect(-0.7, 0.7, 1.75, 3.35, 0.16)
    lip_out = chamfer_rect(-0.77, 0.77, 1.68, 3.42, 0.19)
    g.add(ring(opening, lip_out, 1.66, 2.0), C["dark"], cull=[BACK])
    f_in = chamfer_rect(-0.75, 0.75, 1.7, 3.4, 0.18)
    f_out = chamfer_rect(-0.92, 0.92, 1.6, 3.52, 0.26)
    g.add(ring(f_in, f_out, 1.57, 1.9, y_inner=1.63), C["steel"], cull=[BACK], top=0.35)
    bolts = [(x, 1.595, z) for x, z in chamfer_rect(-0.84, 0.84, 1.645, 3.475, 0.22)]
    bolts += [(x, 1.595, z) for x, z in ((0, 1.645), (0, 3.475), (-0.87, 2.55), (0.87, 2.55))]
    g.add(studs(bolts, s=0.02, h=0.012), C["steel_lt"])
    # blast-shutter housing above the window
    g.add(plate(-0.86, 0.86, 3.54, 3.74, 1.7, 1.9, steps=[(0.02, -0.01)], bevel=0.012), C["rib"], cull=[BACK])
    for i in range(9):
        x = -0.7 + i * 0.175
        g.add(bx(x - 0.012, x + 0.012, 1.695, 1.71, 3.58, 3.7), C["dark"], cull=[BACK])
    g.add(stripes(-0.86, 0.86, 1.6, 1.66, 1.567, width=0.06, slant=0.9), C["haz"], jitter=0.1)
    g.add(stencil("VIEWPORT 4", 0.0, 1.405, 1.83, px=0.012, anchor="center"), C["stencil"], jitter=0.0)
    # condensation grime running down from the sill
    for i, x in enumerate((-0.6, -0.15, 0.4)):
        streak(g, x, 1.45, 0.4 + 0.15 * i, 0.04, 1.836, 60 + i, C["grime"])
    rust(g, 0.55, 0.72, 0.2, 0.14, 1.838, 61)
    return g.build("wall_window", grime=wall_grime(4))


def wall_screen():
    g = Geo(seed=15)
    wall_frame(g, 5, lower_rgb="#34383a")
    g.add(plate(-0.68, 0.68, 1.98, 3.24, 1.7, 1.9, steps=[(0.07, -0.025)], bevel=0.02), C["rib"], cull=[BACK])
    shadow(g, -0.68, 0.68, 1.98, 0.14, 1.856, C["panel2"], k=0.5)
    g.add(bx(-0.6, 0.6, 1.72, 1.73, 2.06, 3.16), C["screen"], cull=[BACK], jitter=0.0)
    y = 1.717
    g.glow(bx(-0.55, 0.55, y, y + 0.004, 3.05, 3.09))
    rnd = random.Random(5)
    for i in range(6):
        z = 2.95 - i * 0.075
        g.glow(bx(-0.55, -0.55 + rnd.uniform(0.25, 0.6), y, y + 0.004, z - 0.01, z + 0.01))
    for i in range(7):
        x = 0.14 + i * 0.058
        g.glow(bx(x, x + 0.034, y, y + 0.004, 2.14, 2.14 + rnd.uniform(0.08, 0.34)))
    wave = [(-0.55 + i * 0.045, y, 2.3 + (0.08 if i % 4 == 1 else -0.05 if i % 4 == 3 else 0.0) * (1 + (i % 3) * 0.3))
            for i in range(14)]
    g.glow(tube(wave, 0.007, verts=3, caps=False))
    g.glow(bx(0.46, 0.54, y, y + 0.004, 2.93, 2.99), "red")
    g.add(bx(-0.6, 0.6, 1.716, 1.72, 2.6, 2.61), "#0a1817", jitter=0.0)    # scanline crack
    # keyboard shelf with indicator buttons
    g.add(yz_prism([(1.9, 1.62), (1.9, 1.95), (1.8, 1.95), (1.64, 1.7), (1.64, 1.62)], -0.46, 0.46),
          C["panel3"], cull=[BACK])
    for i in range(8):
        x = -0.38 + i * 0.108
        s = bx(x - 0.03, x + 0.03, 1.71, 1.73, 1.8, 1.84)
        rotate(s, -26, "X", (x, 1.72, 1.82))
        if i in (1, 4, 6):
            g.glow(s, "amber" if i != 4 else "red")
        else:
            g.add(s, C["steel_lt"], cull=[BACK])
    g.add(tube(sag((0.5, 1.8, 3.24), (0.72, 1.8, 3.86), -0.04, 4), 0.025, verts=5), C["cable"], cull=[BACK])
    g.add(studs([(x, 1.7, z) for x in (-0.64, 0.64) for z in (2.02, 3.2)], s=0.018, h=0.01), C["steel_lt"])
    streak(g, -0.4, 1.98, 0.3, 0.04, 1.852, 51, C["grime"], C["panel2"])
    rust(g, -0.62, 0.7, 0.15, 0.11, 1.838, 71, two=False, fade="#34383a")
    return g.build("wall_screen", grime=wall_grime(5))


def wall_shelves():
    g = Geo(seed=16)
    wall_frame(g, 6)
    rnd = random.Random(16)
    items = {
        0.95: [("box", -0.78, 0.34, 0.26, C["olive"]), ("can", -0.34, 0.1, 0.34, C["orange"]),
               ("can", -0.2, 0.1, 0.3, C["orange"]), ("box", 0.02, 0.3, 0.18, C["panel"]),
               ("box", 0.45, 0.36, 0.3, C["olive_dk"])],
        1.95: [("bottle", -0.78, 0.06, 0.24, "#3f5a4a"), ("bottle", -0.68, 0.06, 0.2, "#3f5a4a"),
               ("bottle", -0.58, 0.06, 0.26, "#6b5a30"), ("box", -0.42, 0.42, 0.2, C["panel3"]),
               ("spool", 0.2, 0.2, 0.2, C["cable_r"]), ("box", 0.48, 0.3, 0.38, C["olive"])],
        2.85: [("box", -0.8, 0.5, 0.36, "#4a4032"), ("box", -0.25, 0.3, 0.2, C["olive"]),
               ("can", 0.2, 0.14, 0.4, "#2f4a44"), ("can", 0.4, 0.14, 0.4, "#2f4a44"), ("box", 0.6, 0.22, 0.14, C["orange"])],
    }
    for zs, stock in items.items():
        g.add(bx(-0.88, 0.88, 1.58, 1.93, zs - 0.045, zs), C["steel"], cull=[BACK], top=0.35)
        g.add(bx(-0.88, 0.88, 1.565, 1.59, zs - 0.07, zs + 0.02), C["dark"], cull=[BACK])
        shadow(g, -0.88, 0.88, zs - 0.07, 0.18, 1.856 if zs > 1.6 else 1.836, C["panel2"] if zs > 1.6 else C["panel"])
        for x in (-0.7, 0.7):
            g.add(yz_prism([(1.93, zs - 0.045), (1.93, zs - 0.3), (1.9, zs - 0.3), (1.62, zs - 0.05)], x - 0.02, x + 0.02),
                  C["dark"], cull=[BACK])
        for kind, x, w, h, rgb in stock:
            yb = rnd.uniform(1.6, 1.66)
            if kind == "box":
                b = bx(x, x + w, yb, rnd.uniform(1.84, 1.92), zs, zs + h)
                rotate(b, rnd.uniform(-3, 3), "Z", (x + w / 2, 1.75, zs))
                g.add(b, rgb, cull=[BACK], jitter=0.06)
                if w > 0.25:
                    g.add(bx(x + w * 0.2, x + w * 0.8, yb - 0.004, yb, zs + h * 0.55, zs + h * 0.72), C["stencil_y"],
                          jitter=0.05)
            elif kind == "can":
                g.add(cyl(w / 2, h, (x + w / 2, 1.72, zs + h / 2), verts=7), rgb, cull=[BACK])
                g.add(cyl(w / 2 + 0.006, 0.03, (x + w / 2, 1.72, zs + h * 0.7), verts=7), C["haz"], cull=[BACK])
            elif kind == "bottle":
                g.add(cyl(w / 2, h * 0.7, (x, 1.7, zs + h * 0.35), verts=6), rgb, cull=[BACK])
                g.add(cyl(w / 4, h * 0.3, (x, 1.7, zs + h * 0.85), verts=5), rgb, cull=[BACK])
            elif kind == "spool":
                g.add(cyl(h / 2, 0.24, (x, 1.76, zs + h / 2), rot=(90, 0, 0), verts=10), rgb, cull=[BACK])
                g.add(cyl(h / 2 + 0.03, 0.02, (x, 1.635, zs + h / 2), rot=(90, 0, 0), verts=10), C["dark"], cull=[BACK])
    g.add(tube([(0.3, 1.62, 3.25), (0.33, 1.6, 2.95), (0.28, 1.6, 2.6), (0.34, 1.6, 2.35)], 0.014, verts=4),
          C["cable_y"])
    rust(g, 0.6, 0.55, 0.15, 0.1, 1.838, 81, two=False)
    return g.build("wall_shelves", grime=wall_grime(6))


def wall_hazard():
    g = Geo(seed=17)
    wall_frame(g, 7, lower=False, upper=False)
    g.add(plate(-0.9, 0.9, 0.36, 1.45, 1.83, 1.95, bevel=0.01), C["haz_dk"], cull=[BACK])
    g.add(stripes(-0.84, 0.84, 0.42, 1.39, 1.822, width=0.16, slant=0.75), C["haz"], jitter=0.14, top=0.0)
    for z0, z1 in ((0.36, 0.42), (1.39, 1.45)):
        g.add(bx(-0.9, 0.9, 1.815, 1.83, z0, z1), C["steel"], cull=[BACK])
    g.add(studs(row(-0.8, 0.8, 7, 1.815, 0.39) + row(-0.8, 0.8, 7, 1.815, 1.42), s=0.016, h=0.01), C["steel_lt"])
    shadow(g, -0.9, 0.9, 1.39, 0.12, 1.808, "#8a6d22", k=0.55)   # rail shadow over the stripes
    for i, (z0, z1) in enumerate(((1.6, 2.35), (2.3, 3.05), (3.0, 3.75))):   # heavy overlapping plates
        yf = 1.84 - i * 0.025
        g.add(plate(-0.9, 0.9, z0, z1, yf, 1.95, steps=[(0.03, -0.01)], bevel=0.015), C["panel2"], cull=[BACK],
              jitter=0.02)
        g.add(studs(row(-0.8, 0.8, 6, yf, z0 + 0.06), s=0.018, h=0.012), C["steel"])
        if i < 2:
            shadow(g, -0.9, 0.9, z1 - 0.05, 0.1, yf - 0.002, C["panel2"], k=0.6)
    shadow(g, -0.9, 0.9, 3.75, 0.2, 1.786, C["panel2"], k=0.55)
    tri = [(0.2, 2.45), (0.7, 2.45), (0.45, 2.88)]
    g.add(poly_prism(tri, 1.765, 1.8), C["haz"], cull=[BACK], jitter=0.05)
    g.add(poly_prism([(0.255, 2.48), (0.645, 2.48), (0.45, 2.815)], 1.76, 1.77), C["haz_dk"], cull=[BACK])
    g.add(poly_prism([(0.29, 2.5), (0.61, 2.5), (0.45, 2.775)], 1.755, 1.76), C["haz"], cull=[BACK], jitter=0.03)
    g.add(bx(0.43, 0.47, 1.748, 1.755, 2.585, 2.72), C["haz_dk"], jitter=0.0)
    g.add(bx(0.43, 0.47, 1.748, 1.755, 2.53, 2.565), C["haz_dk"], jitter=0.0)
    g.add(stencil("DANGER", -0.78, 2.75, 1.807, px=0.026), C["stencil_y"], jitter=0.05)
    g.add(stencil("HIGH PRESSURE", -0.78, 2.5, 1.807, px=0.011), C["stencil"], jitter=0.0)
    rust(g, -0.45, 0.62, 0.25, 0.16, 1.815, 91, drips=0)
    rust(g, 0.7, 3.3, 0.13, 0.18, 1.785, 93, two=False, fade=C["panel2"])
    streak(g, -0.2, 2.3, 0.45, 0.05, 1.835, 94, C["grime"], C["panel2"])
    return g.build("wall_hazard", grime=wall_grime(7))


# ================================================================ floor / ceiling

def floor_trim():
    g = Geo(seed=21)
    # top grating edge: dark gap + bearing bars
    g.add(bx(-1, 1, -0.97, -0.9, -0.12, 0.0), C["void"], cull=[BACK])
    for i in range(25):
        x = -0.98 + i * 0.08
        g.add(bx(x, x + 0.022, -1.0, -0.95, -0.12, 0.0), C["steel"], cull=[BACK], top=0.4)
    g.add(bx(-1, 1, -1.0, -0.96, -0.02, 0.0), C["steel_lt"], cull=[BACK], top=0.4)
    # angle lip + flange band with rivets
    g.add(plate(-1, 1, -0.2, -0.12, -0.99, -0.9, bevel=0.01), C["steel"], cull=[BACK])
    g.add(plate(-1, 1, -0.42, -0.2, -0.96, -0.9, steps=[(0.02, -0.01)]), C["panel3"], cull=[BACK])
    g.add(plate(-1, 1, -0.5, -0.42, -0.99, -0.9, bevel=0.01), C["rib"], cull=[BACK])
    g.add(studs(row(-0.875, 0.875, 8, -0.99, -0.16), s=0.018, h=0.01), C["steel_lt"])
    g.add(studs(row(-0.875, 0.875, 8, -0.99, -0.46), s=0.018, h=0.01), C["steel"])
    # seam joint plates (half at each end) + a drain slot
    for x0, x1 in ((-1, -0.94), (0.94, 1)):
        g.add(bx(x0, x1, -0.995, -0.9, -0.42, -0.2), C["rib"], cull=[BACK])
    for i in range(3):
        x = 0.3 + i * 0.09
        g.add(bx(x, x + 0.05, -0.965, -0.95, -0.36, -0.26), C["void"], cull=[BACK])
    return g.build("floor_trim", grime=wall_grime(8, floor=0.8, ceil=1.0, stain=0.15))


def ceiling_pipes():
    g = Geo(seed=22)
    # rectangular duct at the back
    g.add(bx(-1, 1, 1.2, 1.95, 4.08, 4.45, bevel=0.015), C["panel3"], cull=[BACK])
    for x0, x1 in ((-1, -0.95), (-0.03, 0.03), (0.95, 1)):
        g.add(bx(x0, x1, 1.17, 1.95, 4.05, 4.47), C["rib"], cull=[BACK])
    g.add(studs(row(-0.8, 0.8, 5, 1.2, 4.25), s=0.015, h=0.012), C["steel"])
    # hanger rails from the ceiling
    for x in (-0.5, 0.5):
        g.add(bx(x - 0.02, x + 0.02, 0.35, 1.18, 4.44, 4.5), C["dark"], cull=[BACK])
        g.add(bx(x - 0.015, x + 0.015, 0.55, 0.59, 3.9, 4.44), C["dark"])
        g.add(bx(x - 0.015, x + 0.015, 0.85, 0.89, 4.05, 4.44), C["dark"])
    # two pipes (continuous across tiles) with clamps
    for y, z, r, rgb in ((0.57, 3.98, 0.075, C["pipe_cu"]), (0.87, 4.14, 0.06, C["pipe_g"])):
        g.add(pipe((-1, y, z), (1, y, z), r, verts=8, caps=False), rgb, cull=[BACK])
        for x in (-0.5, 0.5):
            g.add(pipe((x - 0.025, y, z), (x + 0.025, y, z), r + 0.015, verts=8), C["dark"])
        for x0, x1 in ((-1, -0.965), (0.965, 1)):
            g.add(pipe((x0, y, z), (x1, y, z), r + 0.028, verts=8), C["steel"])
    # cable tray + sagging cables
    g.add(bx(-1, 1, 0.25, 0.45, 4.3, 4.33), C["steel"], cull=[BACK])
    g.add(bx(-1, 1, 0.24, 0.26, 4.3, 4.38), C["steel"])
    for i, (r, rgb) in enumerate(((0.022, C["cable"]), (0.018, C["cable_r"]), (0.016, C["cable"]))):
        pts = sag((-0.985, 0.29 + i * 0.05, 4.34), (0.985, 0.29 + i * 0.05, 4.34), 0.28 + i * 0.07, 8)
        g.add(tube(pts, r, verts=5, caps=False), rgb, jitter=0.03)
    # torn cable end dangling
    g.add(tube([(0.3, 0.42, 4.3), (0.32, 0.42, 4.05), (0.27, 0.4, 3.85), (0.31, 0.4, 3.74)], 0.014, verts=4),
          C["cable_y"])
    return g.build("ceiling_pipes", grime=wall_grime(9, floor=1.0, ceil=0.8, stain=0.18))


def ceiling_lamp():
    g = Geo(seed=23)
    for x in (-0.45, 0.45):
        g.add(bx(x - 0.015, x + 0.015, 1.08, 1.12, 4.12, 4.5), C["dark"])
        g.add(bx(x - 0.06, x + 0.06, 1.04, 1.16, 4.47, 4.5), C["rib"])
    # housing: angled hood so the camera sees its face
    g.add(yz_prism([(0.9, 4.02), (1.35, 4.02), (1.35, 4.12), (1.25, 4.16), (1.0, 4.16), (0.86, 4.08)], -0.62, 0.62),
          C["rib"], top=0.3)
    g.add(bx(-0.64, -0.6, 0.86, 1.36, 3.98, 4.16), C["steel"])
    g.add(bx(0.6, 0.64, 0.86, 1.36, 3.98, 4.16), C["steel"])
    for y in (1.0, 1.2):  # fluorescent tubes
        g.glow(pipe((-0.58, y, 3.99), (0.58, y, 3.99), 0.024, verts=6), "white")
    for x in (-0.3, 0.0, 0.3):  # wire guard
        g.add(tube([(x, 0.88, 4.02), (x, 0.9, 3.94), (x, 1.32, 3.94), (x, 1.34, 4.02)], 0.008, verts=4, caps=False),
              C["dark"])
    g.add(pipe((-0.58, 0.9, 3.94), (0.58, 0.9, 3.94), 0.008, verts=4), C["dark"])
    return g.build("ceiling_lamp", grime=wall_grime(10, floor=1.0, ceil=0.9, stain=0.1))


# ================================================================ doors / bulkheads / hull

def bulkhead_door():
    g = Geo(seed=31)
    # lintel block (the cut-away wall above the door)
    g.add(bx(-0.3, 0.3, -1.0, 2.0, 3.0, 4.5), C["panel3"], cull=[BACK])
    g.add(plate(-0.3, 0.3, 3.0, 4.5, -1.02, -0.98, steps=[(0.05, -0.012), (0.03, 0.008)], bevel=0.01),
          C["rib"], cull=[BACK])
    g.add(bx(-0.3, 0.3, -1.03, -1.0, 3.0, 3.2), C["haz_dk"])
    g.add(stripes(-0.3, 0.3, 3.0, 3.2, -1.035, width=0.07, slant=0.8), C["haz"], jitter=0.1)
    g.add(studs(row(-0.22, 0.22, 3, -1.02, 4.42) + row(-0.22, 0.22, 3, -1.02, 3.28), s=0.018, h=0.014), C["steel_lt"])
    g.add(bx(-0.09, 0.09, -1.035, -1.02, 3.62, 3.7), C["dark"])
    g.glow(bx(-0.07, 0.07, -1.04, -1.035, 3.635, 3.685), "amber")
    g.add(stencil("D4", 0.0, 4.05, -1.028, px=0.022, anchor="center"), C["stencil"], jitter=0.0)
    # back frame posts (only behind y=1.5 so the opening stays see-through)
    g.add(bx(-0.3, 0.3, 1.55, 2.0, 0.0, 3.0), C["panel3"], cull=[BACK])
    g.add(plate(-0.3, 0.3, 0.0, 3.0, 1.51, 1.55, steps=[(0.04, -0.01)]), C["rib"], cull=[BACK])
    g.add(bx(-0.3, 0.3, 1.503, 1.51, 0.0, 0.5), C["haz_dk"])
    g.add(stripes(-0.3, 0.3, 0.02, 0.48, 1.501, width=0.08, slant=-0.6), C["haz"], jitter=0.1)
    g.add(studs(col(0.7, 2.8, 5, -0.22, 1.512) + col(0.7, 2.8, 5, 0.22, 1.512), s=0.016, h=0.01), C["steel_lt"])
    # guide rails the shutter runs in (thin, at the back edge of the panel)
    for x in (-0.28, 0.28):
        g.add(bx(x - 0.02, x + 0.02, 1.58, 1.65, 0.0, 3.0), C["dark"])
    # threshold plate flush with the floor (1.2 cm, does not block the see-through opening)
    g.add(bx(-0.3, 0.3, -1.0, 1.5, 0.0, 0.012), C["steel"], top=0.1)
    g.squash("y", -1.0, -0.9)
    return g.build("bulkhead_door", grime=wall_grime(11, floor=0.8, stain=0.12))


def girder_face(g, x0, x1, z0, z1, y, seed):
    """I-beam style cut face: flanges on both sides, a recessed web with X-bracing."""
    w = x1 - x0
    fl = min(0.08, w * 0.15)
    g.add(bx(x0, x1, y + 0.08, 2.0, z0, z1), C["panel3"], cull=[BACK])            # body
    g.add(bx(x0 + fl, x1 - fl, y + 0.04, y + 0.09, z0, z1), C["back"], cull=[BACK])  # recessed web
    for xa, xb in ((x0, x0 + fl), (x1 - fl, x1)):
        g.add(plate(xa, xb, z0, z1, y, y + 0.09, bevel=0.01), C["rib"], cull=[BACK])
    return fl


def bulkhead_solid():
    """Solid wall between rooms, cut away: I-beam flanges framing stacked armour plates, a conduit
    running up the web and a sliced pipe passing through (the X-truss look is kept for the hull)."""
    g = Geo(seed=32)
    fl = girder_face(g, -0.3, 0.3, 0.0, 4.5, -1.0, 32)
    plates = [(0.32, 1.55), (1.62, 2.95), (3.02, 4.3)]
    for i, (z0, z1) in enumerate(plates):
        g.add(plate(-0.3 + fl + 0.01, 0.3 - fl - 0.01, z0, z1, -0.985, -0.95, steps=[(0.03, -0.008), (0.03, 0.006)],
                    bevel=0.01), C["panel2"] if i % 2 else C["panel"], cull=[BACK], jitter=0.03)
        g.add(studs([(x, -0.985, z) for x in (-0.16, 0.16) for z in (z0 + 0.05, z1 - 0.05)], s=0.014, h=0.01),
              C["steel_lt"])
        shadow(g, -0.3 + fl, 0.3 - fl, z0, 0.1, -0.952, C["back"], k=0.6)
    for z0, z1 in ((0.0, 0.32), (1.55, 1.62), (2.95, 3.02), (4.3, 4.5)):
        g.add(plate(-0.3, 0.3, z0, z1, -1.0, -0.9, bevel=0.008), C["steel"], cull=[BACK])
    g.add(studs(row(-0.22, 0.22, 3, -1.0, 4.4), s=0.012, h=0.01), C["steel_lt"])
    # conduit up the web + junction box
    g.add(pipe((0.13, -1.005, 1.62), (0.13, -1.005, 4.3), 0.028, verts=6, caps=False), C["pipe_g"], cull=[BACK])
    g.add(plate(0.04, 0.22, 2.05, 2.3, -1.03, -0.99, steps=[(0.015, -0.006)], bevel=0.008), C["rib"], cull=[BACK])
    # a pipe sliced through by the cut-away (cut end visible)
    g.add(pipe((-0.08, -1.03, 3.62), (-0.08, -0.9, 3.62), 0.1, verts=10), C["pipe_cu"])
    g.add(pipe((-0.08, -1.035, 3.62), (-0.08, -1.03, 3.62), 0.06, verts=10), C["void"], jitter=0.0)
    g.add(bx(-0.3, 0.3, -1.03, -1.0, 0.0, 0.3), C["haz_dk"])
    g.add(stripes(-0.3, 0.3, 0.02, 0.28, -1.035, width=0.07, slant=0.8), C["haz"], jitter=0.1)
    rust(g, 0.05, 1.2, 0.1, 0.16, -0.99, 101, two=False)
    streak(g, -0.08, 3.5, 0.5, 0.04, -0.99, 102, C["rust_dk"], C["panel2"])
    g.squash("y", -1.0, -0.9)
    return g.build("bulkhead_solid", grime=wall_grime(12, floor=0.7, stain=0.14, depth=None))


def hull_frame(g, seed, hatch=False):
    """Thick outer hull section: heavy side plates, massive ribs, dark bracing between."""
    g.add(bx(-0.6, 0.6, -0.9, 2.0, -0.5, 4.5), C["back"], cull=[BACK])
    for xa, xb in ((-0.6, -0.42), (0.42, 0.6)):
        g.add(plate(xa, xb, -0.5, 4.5, -1.02, 2.0, steps=[(0.025, -0.012)], bevel=0.02), C["panel3"], cull=[BACK])
        g.add(studs(col(-0.35, 4.35, 14, (xa + xb) / 2, -1.02), s=0.018, h=0.014), C["steel"])
    ribs = [(-0.5, -0.2), (1.25, 1.5), (3.0, 3.25), (4.25, 4.5)] if not hatch else [(-0.5, -0.2), (3.1, 3.35), (4.25, 4.5)]
    for z0, z1 in ribs:
        g.add(plate(-0.42, 0.42, z0, z1, -1.0, 2.0, steps=[(0.02, -0.01)], bevel=0.018), C["rib"], cull=[BACK])
        g.add(studs(row(-0.32, 0.32, 4, -1.0, (z0 + z1) / 2), s=0.016, h=0.012), C["steel_lt"])
    return ribs


def xbrace(g, x0, x1, z0, z1, y, rgb):
    for xa, za, xb, zb in ((x0, z0, x1, z1), (x1, z0, x0, z1)):
        L = math.hypot(xb - xa, zb - za)
        ang = math.degrees(math.atan2(zb - za, xb - xa))
        b = bx(-L / 2, L / 2, y, y + 0.05, -0.035, 0.035)
        rotate(b, -ang, "Y")
        move(b, ((xa + xb) / 2, 0, (za + zb) / 2))
        g.add(b, rgb, cull=[BACK])


def hull_end():
    g = Geo(seed=41)
    ribs = hull_frame(g, 41)
    for (za, zb), (zc, zd) in zip(ribs[:-1], ribs[1:]):
        xbrace(g, -0.42, 0.42, zb, zc, -0.96, C["panel"])
    g.add(pipe((0.25, -0.93, -0.2), (0.25, -0.93, 4.25), 0.05, verts=8, caps=False), C["pipe_g"], cull=[BACK])
    g.add(pipe((-0.26, -0.93, -0.2), (-0.26, -0.93, 4.25), 0.035, verts=6, caps=False), C["pipe"], cull=[BACK])
    g.add(bx(-0.42, 0.42, -1.03, -1.0, 0.0, 0.25), C["haz_dk"])
    g.add(stripes(-0.42, 0.42, 0.0, 0.25, -1.035, width=0.08, slant=0.8), C["haz"], jitter=0.1)
    rust(g, 0.5, 2.2, 0.08, 0.35, -1.03, 111, two=False)
    g.squash("y", -1.0, -0.9)
    return g.build("hull_end", grime=wall_grime(13, floor=0.75, stain=0.14))


def hull_airlock():
    g = Geo(seed=42)
    hull_frame(g, 42, hatch=True)
    cz = 1.55
    g.add(bx(-0.42, 0.42, -0.95, -0.9, -0.2, 3.1), C["panel3"], cull=[BACK])
    # hatch collar ring, door disc, locking wheel and dogs
    g.add(ring(circle(0, cz, 0.44, 20), circle(0, cz, 0.58, 20), -1.06, -0.9, y_inner=-1.02), C["steel"],
          cull=[BACK], top=0.3)
    g.add(poly_prism(circle(0, cz, 0.45, 20), -1.0, -0.9), C["panel"], cull=[BACK])
    g.add(ring(circle(0, cz, 0.3, 16), circle(0, cz, 0.36, 16), -1.03, -1.0), C["rib"], cull=[BACK])
    g.add(stripes(-0.42, 0.42, cz - 0.07, cz + 0.07, -1.012, width=0.06, slant=0.8), C["haz"], jitter=0.1)
    wheel = tube([(0.2 * math.cos(a), -1.09, cz + 0.2 * math.sin(a)) for a in [2 * math.pi * i / 12 for i in range(13)]],
                 0.02, verts=4, caps=False)
    g.add(wheel, "#6a2a22")
    for a in (0.3, 0.3 + math.pi / 2, 0.3 + math.pi, 0.3 + 3 * math.pi / 2):
        g.add(tube([(0, -1.07, cz), (0.19 * math.cos(a), -1.085, cz + 0.19 * math.sin(a))], 0.012, verts=4), "#6a2a22")
    g.add(pipe((0, -1.1, cz), (0, -1.0, cz), 0.05, verts=8), C["dark"])
    dogs = []
    for i in range(8):
        a = 2 * math.pi * i / 8 + math.pi / 8
        dogs.append((0.51 * math.cos(a), -1.06, cz + 0.51 * math.sin(a)))
    g.add(studs(dogs, s=0.03, h=0.025), C["steel_lt"])
    # red lamp above the hatch
    g.add(bx(-0.12, 0.12, -1.02, -0.95, 2.45, 2.6), C["dark"])
    g.glow(bx(-0.09, 0.09, -1.05, -1.02, 2.47, 2.58), "red")
    g.add(stencil("AIRLOCK", 0.0, 2.85, -1.0, px=0.02, anchor="center"), C["stencil_y"], jitter=0.0)
    g.add(bx(-0.42, 0.42, -1.03, -1.0, 0.0, 0.25), C["haz_dk"])
    g.add(stripes(-0.42, 0.42, 0.0, 0.25, -1.035, width=0.08, slant=0.8), C["haz"], jitter=0.1)
    g.squash("y", -1.0, -0.88)
    return g.build("hull_airlock", grime=wall_grime(14, floor=0.75, stain=0.14))


def door_panel():
    """Roller shutter. The camera sees its front end (y = -0.9): horizontal chamfered slats and a
    hazard-striped leading (bottom) edge. Origin at the top centre - the engine scales Z to open it."""
    g = Geo(seed=51)
    g.add(bx(-0.2, 0.2, -0.86, 1.6, 0.0, 3.0), C["panel3"], cull=[BACK])
    n = 14
    h = (3.0 - 0.3) / n
    for i in range(n):
        z0 = 0.3 + i * h
        z1 = z0 + h - 0.012
        prof = [(-0.89, z0 + 0.03), (-0.89, z1 - 0.03), (-0.865, z1), (-0.6, z1), (-0.6, z0), (-0.865, z0)]
        g.add(yz_prism(prof, -0.25, 0.25), C["panel"] if i % 2 else C["panel2"], cull=[BACK], top=0.4)
    g.add(bx(-0.25, 0.25, -0.87, -0.6, 0.0, 3.0), C["back"])   # gap filler behind the slats
    for xa, xb in ((-0.25, -0.215), (0.215, 0.25)):   # guide edges
        g.add(bx(xa, xb, -0.895, -0.85, 0.0, 3.0), C["rib"], cull=[BACK])
    g.add(bx(-0.12, 0.12, -0.9, -0.885, 0.62, 0.68), C["steel_lt"], top=0.4)   # grip
    g.add(bx(-0.25, 0.25, -0.895, 1.6, 0.03, 0.3), C["haz_dk"], cull=[BACK])
    g.add(stripes(-0.25, 0.25, 0.04, 0.29, -0.9, width=0.07, slant=0.9), C["haz"], jitter=0.1, top=0.0)
    g.add(bx(-0.25, 0.25, -0.895, 1.6, 0.0, 0.03), C["void"], cull=[BACK])
    g.add(stencil("04", 0.0, 2.6, -0.895, px=0.03, anchor="center"), C["stencil"], jitter=0.0)
    return g.build("door_panel", origin=(0, 0, 3.0), grime=wall_grime(15, floor=0.8, stain=0.1))


# ================================================================ vertical links

def ladder():
    g = Geo(seed=61)
    y = 1.45
    for x in (-0.3, 0.3):
        g.add(tube([(x, y, 0.0), (x, y, 5.55), (x, y + 0.08, 5.82), (x, y + 0.3, 5.96), (x, 1.95, 5.96)],
                   0.035, verts=6, phase=math.pi / 6), C["haz"], jitter=0.06)
        g.add(bx(x - 0.07, x + 0.07, y - 0.07, y + 0.07, 0.0, 0.03), C["dark"])
        for z in (0.6, 2.4, 4.2):   # wall standoffs
            g.add(bx(x - 0.02, x + 0.02, y + 0.02, 1.95, z - 0.02, z + 0.02), C["dark"], cull=[BACK])
            g.add(bx(x - 0.06, x + 0.06, 1.93, 1.95, z - 0.08, z + 0.08), C["rib"], cull=[BACK])
        g.add(bx(x - 0.06, x + 0.06, 1.93, 1.95, 5.92, 6.0), C["rib"], cull=[BACK])
    z = 0.35
    while z < 5.0:
        g.add(pipe((-0.3, y, z), (0.3, y, z), 0.022, verts=6, caps=False), C["steel_lt"], top=0.4)
        z += 0.35
    g.add(pipe((-0.3, y, 5.55), (0.3, y, 5.55), 0.02, verts=6, caps=False), C["haz"])
    return g.build("ladder", grime=prop_grime(61, floor=0.75, h=1.5))


def stairs():
    g = Geo(seed=62)
    n = 20
    rise = 5.0 / n
    for i in range(n):
        x0, x1 = max(0.0, i * rise - 0.01), min(5.0, (i + 1) * rise + 0.03)
        zt = (i + 1) * rise
        g.add(bx(x0, x1, 0.66, 1.54, zt - 0.05, zt, bevel=0.006), C["steel"], cull=[BACK], top=0.35)
        g.add(bx(x1 - 0.04, x1, 0.655, 1.54, zt - 0.052, zt - 0.005), C["haz"], jitter=0.12)   # nosing
    # stringers (sloped channels) under the tread line
    prof = [(0.1, 0.0), (5.0, 4.9), (5.0, 4.45), (0.55, 0.0)]
    for y0, y1, rgb in ((0.6, 0.68, C["rib"]), (1.52, 1.6, C["panel3"])):
        s = poly_prism(prof, y0, y1)
        g.add(s, rgb, cull=[BACK])
    rivets = [(0.45 + i * 0.5, 0.598, 0.45 + i * 0.5 - 0.22) for i in range(9)]
    g.add(studs(rivets, s=0.016, h=0.012), C["steel_lt"])
    # front railing: posts + handrail + mid-rail
    posts = [0.35, 1.6, 2.85, 4.1]
    for x in posts:
        zb = x - 0.18
        g.add(bx(x - 0.025, x + 0.025, 0.6, 0.65, zb, x + 0.95), C["dark"])
    g.add(tube([(0.2, 0.625, 0.2), (0.2, 0.625, 1.15), (0.35, 0.625, 1.3), (4.85, 0.625, 5.8), (4.96, 0.625, 5.8)],
               0.03, verts=6, phase=math.pi / 6), C["haz"], jitter=0.06)
    g.add(tube([(0.35, 0.625, 0.82), (4.85, 0.625, 5.32)], 0.018, verts=6, caps=True), C["steel"])
    g.add(bx(4.95, 5.0, 0.6, 0.65, 4.4, 5.8), C["dark"])
    g.squash("y", 0.6, 0.68)
    return g.build("stairs", grime=prop_grime(62, floor=0.7, h=2.5))


def shaft_rim():
    g = Geo(seed=63)
    for x0, x1, y0, y1 in ((-0.65, 0.65, 0.72, 0.84), (-0.65, 0.65, 1.88, 2.0), (-0.65, -0.53, 0.72, 2.0), (0.53, 0.65, 0.72, 2.0)):
        g.add(bx(x0, x1, y0, y1, -0.5, 0.0, bevel=0.01), C["rib"])
    g.add(bx(-0.65, 0.65, 0.703, 0.72, -0.5, 0.0), C["haz_dk"])
    g.add(stripes(-0.65, 0.65, -0.5, 0.0, 0.701, width=0.1, slant=0.8), C["haz"], jitter=0.1)
    # top flange with hazard stripes on the lip (visible from the slightly raised camera)
    g.add(bx(-0.65, 0.65, 0.705, 0.84, -0.02, -0.001), C["haz_dk"])
    for i in range(7):
        x = -0.6 + i * 0.19
        s = bx(x, x + 0.09, 0.705, 0.84, -0.019, 0.0)
        g.add(s, C["haz"], jitter=0.1)
    g.add(studs([(x, y, -0.012) for x in (-0.59, 0.59) for y in (0.9, 1.35, 1.8)], s=0.018, h=0.012, facing="+z"),
          C["steel_lt"])
    return g.build("shaft_rim", grime=prop_grime(63, floor=1.0))


# ================================================================ small dressing

def vent_wall():
    g = Geo(seed=71)
    outer = chamfer_rect(-0.5, 0.5, 0.1, 0.8, 0.07)
    inner = chamfer_rect(-0.42, 0.42, 0.17, 0.73, 0.04)
    g.add(ring(inner, outer, 1.72, 1.97, y_inner=1.76), C["steel"], cull=[BACK], top=0.3)
    g.add(bx(-0.44, 0.44, 1.8, 1.97, 0.15, 0.75), C["void"], cull=[BACK])
    for i in range(6):
        z = 0.22 + i * 0.09
        s = bx(-0.42, 0.42, 1.8 - 0.01, 1.8 + 0.01, z - 0.045, z + 0.045)
        rotate(s, 40 if i != 2 else 10, "X", (0, 1.8, z))
        if i == 2:
            rotate(s, 6, "Y", (0, 1.8, z))
        g.add(s, C["panel"], cull=[BACK], top=0.35)
    g.add(studs([(x, 1.725, z) for x in (-0.46, 0.46) for z in (0.14, 0.76)], s=0.018, h=0.014), C["steel_lt"])
    return g.build("vent_wall", grime=prop_grime(71, floor=0.75, h=0.8))


def vent_ceiling():
    g = Geo(seed=72)
    for x0, x1, y0, y1 in ((-0.5, 0.5, 0.41, 0.48), (-0.5, 0.5, 1.72, 1.8), (-0.5, -0.42, 0.41, 1.8), (0.42, 0.5, 0.41, 1.8)):
        g.add(bx(x0, x1, y0, y1, 4.36, 4.5, bevel=0.008), C["steel"], top=0.1)
    g.add(bx(-0.42, 0.42, 0.48, 1.72, 4.48, 4.5), C["void"])
    for i in range(9):
        x = -0.36 + i * 0.09
        g.add(bx(x - 0.012, x + 0.012, 0.48, 1.72, 4.39, 4.48), C["panel"], top=0.1)
    g.add(studs([(x, 0.41, z) for x in (-0.45, 0.45) for z in (4.43,)], s=0.015, h=0.01), C["steel_lt"])
    return g.build("vent_ceiling", grime=prop_grime(72, floor=1.0))


def lamp_red():
    """Caged emergency beacon: wall plate, housing ring, red dome behind two guard bars."""
    g = Geo(seed=81)
    z = 3.6
    g.add(plate(-0.14, 0.14, z - 0.2, z + 0.16, 1.76, 1.88, steps=[(0.015, -0.006)], bevel=0.012), C["rib"], cull=[BACK])
    g.add(studs([(x, 1.76, zz) for x in (-0.11, 0.11) for zz in (z - 0.17, z + 0.13)], s=0.012, h=0.008), C["steel"])
    g.add(cyl(0.105, 0.1, (0, 1.71, z - 0.02), rot=(90, 0, 0), verts=12), C["dark"], cull=[BACK])
    g.add(ring(circle(0, z - 0.02, 0.085, 12), circle(0, z - 0.02, 0.11, 12), 1.655, 1.68), C["steel"], cull=[BACK])
    dome = lump((0, 1.665, z - 0.02), 0.085, seed=0, seg=10, rings=5, rough=0.0, scale=(1, 0.75, 1), cut="back")
    g.glow(dome, "red")
    for dz in (-0.04, 0.04):   # guard bars across the dome
        g.add(tube([(-0.1, 1.65, z - 0.02 + dz), (0.0, 1.59, z - 0.02 + dz), (0.1, 1.65, z - 0.02 + dz)], 0.008,
                   verts=4), C["dark"])
    g.add(tube([(0.0, 1.62, z + 0.07), (0.0, 1.59, z - 0.02), (0.0, 1.62, z - 0.11)], 0.008, verts=4), C["dark"])
    g.add(tube([(0.06, 1.8, z + 0.16), (0.06, 1.8, z + 0.3), (0.12, 1.8, z + 0.3)], 0.012, verts=4), C["cable"])
    return g.build("lamp_red", grime=prop_grime(81, floor=1.0))


def lamp_white():
    g = Geo(seed=82)
    z = 3.6
    g.add(plate(-0.26, 0.26, z - 0.12, z + 0.12, 1.74, 1.88, steps=[(0.02, -0.008)], bevel=0.015), C["rib"], cull=[BACK])
    g.add(yz_prism([(1.74, z + 0.12), (1.64, z + 0.13), (1.62, z + 0.11), (1.74, z + 0.08)], -0.26, 0.26),
          C["steel"], top=0.4)        # hood
    g.glow(bx(-0.2, 0.2, 1.715, 1.74, z - 0.07, z + 0.06), "white")
    for x in (-0.12, 0.0, 0.12):   # guard bars
        g.add(bx(x - 0.008, x + 0.008, 1.69, 1.715, z - 0.1, z + 0.09), C["dark"])
    g.add(bx(-0.21, 0.21, 1.69, 1.715, z - 0.1, z - 0.085), C["dark"])
    return g.build("lamp_white", grime=prop_grime(82, floor=1.0))


def wiggle(p0, p1, n, amp, seed, axis=0):
    """Sinuous path between two points (organic tendrils / drips); `axis` = coordinate to wobble."""
    rnd = random.Random(seed)
    p0, p1 = Vector(p0), Vector(p1)
    out = []
    ph = rnd.uniform(0, 6.28)
    for i in range(n + 1):
        t = i / n
        p = p0.lerp(p1, t)
        if 0 < i < n:
            p[axis] += math.sin(ph + t * 5.0) * amp + rnd.uniform(-amp, amp) * 0.4
        out.append(tuple(p))
    return out


def drip_outline(cx, zb, width, top_h, tongues, seed):
    """Splat outline whose lower edge runs into drip tongues (like paint running down a wall).
    tongues: [(x_offset, length, half_width)] left to right."""
    rnd = random.Random(seed)
    pts = []
    for i in range(10):   # ragged upper arc, right to left
        a = math.pi * i / 9
        k = 1.0 - rnd.uniform(0.0, 0.25)
        pts.append((cx + math.cos(a) * width / 2 * k, zb + math.sin(a) * top_h * k))
    x = cx - width / 2
    for xo, L, w in tongues:   # lower edge, left to right
        xt = cx + xo
        pts.append((xt - w * 1.6, zb + rnd.uniform(-0.03, 0.03)))
        pts += [(xt - w * 0.55, zb - L * 0.45), (xt - w * 0.42, zb - L * 0.84),   # neck, then a round drop
                (xt - w * 0.78, zb - L * 0.93), (xt - w * 0.62, zb - L - w * 0.55), (xt, zb - L - w * 0.9),
                (xt + w * 0.62, zb - L - w * 0.55), (xt + w * 0.78, zb - L * 0.93), (xt + w * 0.42, zb - L * 0.84),
                (xt + w * 0.5, zb - L * 0.45)]
        x = xt + w * 1.6
    pts.append((cx + width / 2 * 0.95, zb + 0.02))
    return pts


def slime():
    """Green goo splattered high on the wall, running down in drip tongues and thin trickles to a
    puddle at the wall base."""
    g = Geo(seed=91)
    y = 1.66
    dk, md, lt = PALRGB(C["slime_dk"]), PALRGB(C["slime"]), PALRGB(C["slime_lt"])
    zb = 2.55
    tongues = [(-0.46, 0.22, 0.05), (-0.3, 0.55, 0.045), (-0.12, 0.3, 0.06), (0.05, 0.9, 0.05), (0.22, 0.4, 0.05),
               (0.38, 0.65, 0.04)]
    outer = drip_outline(0.0, zb, 1.1, 0.42, tongues, 3)
    g.add(flat(outer, y), C["slime_dk"], jitter=0.0,
          vfn=lambda co, c: mix3(dk, md, smooth(zb + 0.35, zb - 0.5, co.z)))
    inner_t = [(-0.3, 0.42, 0.028), (-0.12, 0.2, 0.035), (0.05, 0.78, 0.03), (0.22, 0.28, 0.03)]
    inner = drip_outline(0.02, zb + 0.02, 0.7, 0.28, inner_t, 5)
    g.add(flat(inner, y - 0.004), C["slime"], jitter=0.0,
          vfn=lambda co, c: mix3(md, lt, smooth(zb + 0.1, zb - 0.8, co.z)))
    for i, (x, z) in enumerate(((-0.2, 2.8), (0.12, 2.72), (0.28, 2.62), (0.06, 2.18), (-0.3, 2.3))):   # wet glints
        g.add(flat(blob(x, z, 0.03, 0.014, 6, 20 + i), y - 0.045 if z > 2.5 else y - 0.008), "#b2d66a", jitter=0.04)
    for i, (xo, L, top) in enumerate(((0.05, 1.62, 0.85), (-0.3, 0.55, 0.52), (0.38, 0.8, 0.62))):   # trickles
        z0 = zb - top
        pts = wiggle((xo, y - 0.006, z0), (xo + 0.02, y - 0.006, max(0.02, z0 - L)), 6, 0.01, 40 + i)
        g.add(tube(pts, 0.018, verts=4, phase=math.pi / 4, scale_y=0.45, r1=0.01), C["slime"], jitter=0.04,
              vfn=lambda co, c: mix3(md, lt, smooth(2.0, 0.3, co.z)))
    g.add(lump((0.02, 1.72, 0.0), 0.5, seed=21, seg=10, rings=4, rough=0.25, scale=(1.2, 0.42, 0.06), cut="bottom"),
          C["slime"], jitter=0.06, top=0.5)
    g.add(lump((0.1, 1.66, 0.0), 0.2, seed=22, seg=8, rings=4, rough=0.25, scale=(1.3, 0.6, 0.1), cut="bottom"),
          C["slime_lt"], jitter=0.05, top=0.5)
    return g.build("slime", grime=prop_grime(91, floor=0.85, stain=0.08))


def cobweb():
    """Pale strand fan anchored in the top-left corner (x=-0.8, z=4.5); mirror for the other side."""
    g = Geo(seed=92)
    ax, az, y = -0.8, 4.48, 1.6
    rnd = random.Random(92)
    angs = [-6, -20, -35, -50, -64, -78, -90]
    lens = [1.45, 1.4, 1.32, 1.28, 1.22, 1.15, 1.05]
    spokes = []
    for a, L in zip(angs, lens):
        r = math.radians(a + rnd.uniform(-3, 3))
        spokes.append([(ax + math.cos(r) * L * t, y - 0.02 * t, az + math.sin(r) * L * t) for t in (0.25, 0.5, 0.75, 1.0)])
        g.add(tube([(ax, y, az)] + [spokes[-1][-1]], 0.005, verts=3, caps=False), C["web"], jitter=0.08, ao=0.0)
    for k in range(4):   # sagging cross threads, denser toward the corner
        for i in range(len(spokes) - 1):
            if rnd.random() < 0.12:
                continue   # torn
            p0, p1 = spokes[i][k], spokes[i + 1][k]
            g.add(tube(sag(p0, p1, 0.02 + 0.02 * k, 3), 0.004, verts=3, caps=False), C["web"], jitter=0.1, ao=0.0)
    for i in range(3):   # loose hanging strands
        p = spokes[i + 2][3]
        g.add(tube([p, (p[0] + 0.02, y - 0.03, p[2] - rnd.uniform(0.25, 0.6))], 0.004, verts=3, caps=False), C["web"])
    g.add(lump((ax + 0.18, y, az - 0.16), 0.05, seed=3, seg=6, rings=4, rough=0.2, scale=(1, 0.6, 1.3)), "#8a887a")
    g.add(lump((ax + 0.6, y - 0.01, az - 0.55), 0.035, seed=4, seg=6, rings=4, rough=0.2, scale=(1, 0.6, 1.4)), "#7a786c")
    return g.build("cobweb", grime=None)


def biomass():
    """Purple-brown alien resin engulfing the wall base (nest marker): a lobed resin sheet with
    veined sacs, creeping tendrils, a floor mound and a few faintly glowing pustules."""
    g = Geo(seed=93)
    rnd = random.Random(93)
    y = 1.66
    rs, r2, r3 = PALRGB(C["resin"]), PALRGB(C["resin2"]), PALRGB(C["resin3"])
    sheet_pts = [(max(-1.05, min(1.05, px)), max(0.0, pz)) for px, pz in blob(0.0, 1.1, 1.0, 1.15, 16, 7, jag=0.3)]
    g.add(flat(sheet_pts, y), C["resin"], jitter=0.0,
          vfn=lambda co, c: mix3(rs, r2, 0.5 + 0.5 * noise_1(co)))
    for i in range(6):   # tendrils creeping up and sideways from the sheet
        x0 = -0.75 + i * 0.3 + rnd.uniform(-0.05, 0.05)
        z0 = 1.6 + rnd.uniform(-0.3, 0.3) - abs(x0) * 0.3
        x1 = max(-0.92, min(0.92, x0 + rnd.uniform(-0.4, 0.4)))
        z1 = z0 + rnd.uniform(0.5, 1.1)
        pts = wiggle((x0, y - 0.01, z0), (x1, y - 0.01, z1), 6, 0.08, 30 + i)
        g.add(tube(pts, rnd.uniform(0.035, 0.05), verts=4, scale_y=0.6, r1=0.008), C["resin2"], jitter=0.06)
    for i, (x, z, sx, sz) in enumerate(((-0.45, 0.75, 0.22, 0.38), (0.12, 1.1, 0.26, 0.44), (0.55, 0.6, 0.2, 0.32),
                                        (-0.1, 0.4, 0.18, 0.26))):   # fleshy sacs
        g.add(lump((x, y - 0.02, z), 1.0, seed=40 + i, seg=8, rings=6, rough=0.07, scale=(sx, 0.2, sz), cut="back"),
              C["resin2"], jitter=0.05, top=0.6, ao=0.6,
              vfn=lambda co, c, z=z, sz=sz: mix3(r2, r3, smooth(z - sz * 0.2, z + sz, co.z)))

        def surf(xx, zz, x=x, z=z, sx=sx, sz=sz):   # point on the sac's front surface
            d = 0.2 * math.sqrt(max(0.0, 1 - ((xx - x) / sx) ** 2 - ((zz - z) / sz) ** 2))
            return (xx, y - 0.02 - d - 0.006, zz)
        for side in (-0.45, 0.5):   # veins arching over the sac
            pts = [surf(x + side * sx * math.sin(math.pi * t) * 1.0, z - sz * 0.92 + 1.84 * sz * t) for t in
                   (0.02, 0.2, 0.4, 0.6, 0.8, 0.98)]
            g.add(tube(pts, 0.012, verts=4, scale_y=0.7), C["resin"], jitter=0.05)
        slit = [surf(x + 0.012 * math.sin(k * 1.7), z - sz * 0.55 + sz * 1.1 * k / 5) for k in range(6)]
        g.add(tube(slit, 0.01, verts=3, scale_y=0.5, caps=False), "#140810", jitter=0.0)
        g.add(flat(blob(x - sx * 0.3, z + sz * 0.45, sx * 0.14, sz * 0.09, 6, 50 + i), surf(x - sx * 0.3, z + sz * 0.45)[1] - 0.004),
              "#8a5a72", jitter=0.05)   # wet sheen
    for i, (x, z) in enumerate(((-0.62, 1.25), (0.38, 1.5), (0.8, 0.95), (-0.3, 1.55))):   # pustules
        g.add(lump((x, y - 0.03, z), 0.05, seed=60 + i, seg=6, rings=4, rough=0.1, scale=(1, 0.7, 1)), C["resin3"])
        g.glow(lump((x, y - 0.07, z), 0.022, seed=70 + i, seg=5, rings=3, rough=0.0), "amber", rgb="#d8c040")
    g.add(lump((0.0, 1.6, 0.0), 0.6, seed=31, seg=10, rings=4, rough=0.2, scale=(1.5, 0.65, 0.4), cut="bottom"),
          C["resin"], jitter=0.08, top=0.5)
    g.add(lump((-0.5, 1.2, 0.0), 0.3, seed=32, seg=8, rings=4, rough=0.25, scale=(1.3, 0.8, 0.35), cut="bottom"),
          C["resin2"], jitter=0.08, top=0.5)
    return g.build("biomass", grime=prop_grime(93, floor=0.85, h=2.0, stain=0.12))


def noise_1(co):
    return max(-1.0, min(1.0, mnoise.noise(Vector((co.x * 2.2, co.y, co.z * 2.2)))))


# ================================================================ build / export / preview

PIECES = [
    ("wall_plain", wall_plain), ("wall_pipes", wall_pipes), ("wall_vent", wall_vent),
    ("wall_window", wall_window), ("wall_screen", wall_screen), ("wall_shelves", wall_shelves),
    ("wall_hazard", wall_hazard), ("floor_trim", floor_trim), ("ceiling_pipes", ceiling_pipes),
    ("ceiling_lamp", ceiling_lamp), ("bulkhead_door", bulkhead_door), ("bulkhead_solid", bulkhead_solid),
    ("door_panel", door_panel), ("hull_end", hull_end), ("hull_airlock", hull_airlock), ("ladder", ladder),
    ("stairs", stairs), ("shaft_rim", shaft_rim), ("vent_wall", vent_wall), ("vent_ceiling", vent_ceiling),
    ("lamp_red", lamp_red), ("lamp_white", lamp_white), ("slime", slime), ("cobweb", cobweb), ("biomass", biomass),
]

# README "roomkit.glb" extents (world space, Blender axes). Stairs z allows the 0.85 m handrail above the
# landing; lamps/decals only need to stay inside the room (y <= 2.0).
WALL = dict(x=(-1, 1), y=(1.55, 2.0), z=(0, 4.5))
CONTRACT = {
    **{w: WALL for w in ("wall_plain", "wall_pipes", "wall_vent", "wall_window", "wall_screen", "wall_shelves",
                         "wall_hazard")},
    "floor_trim": dict(x=(-1, 1), y=(-1.0, -0.9), z=(-0.5, 0)),
    "ceiling_pipes": dict(x=(-1, 1), y=(0.2, 2.0), z=(3.7, 4.5)),
    "ceiling_lamp": dict(x=(-1, 1), y=(0.2, 2.0), z=(3.7, 4.5)),
    "bulkhead_door": dict(x=(-0.3, 0.3), y=(-1, 2), z=(0, 4.5)),
    "bulkhead_solid": dict(x=(-0.3, 0.3), y=(-1, 2), z=(0, 4.5)),
    "door_panel": dict(x=(-0.25, 0.25), y=(-0.9, 1.6), z=(0, 3.0)),
    "hull_end": dict(x=(-0.6, 0.6), y=(-1, 2), z=(-0.5, 4.5)),
    "hull_airlock": dict(x=(-0.6, 0.6), y=(-1, 2), z=(-0.5, 4.5)),
    "ladder": dict(x=(-0.4, 0.4), y=(-1, 2), z=(0, 6.0)),
    "stairs": dict(x=(0, 5), y=(0.6, 1.6), z=(0, 5.85)),
    "shaft_rim": dict(x=(-0.65, 0.65), y=(0.7, 2.0), z=(-0.5, 0)),
    "vent_wall": dict(x=(-0.5, 0.5), y=(1.6, 2.0), z=(0.1, 0.8)),
    "vent_ceiling": dict(x=(-0.5, 0.5), y=(0.4, 1.8), z=(4.35, 4.5)),
    "lamp_red": dict(y=(1.4, 2.0), z=(3.2, 4.1)),
    "lamp_white": dict(y=(1.4, 2.0), z=(3.2, 4.1)),
    "slime": dict(x=(-1, 1), y=(1.2, 2.0), z=(0, 4.5)),
    "cobweb": dict(x=(-1, 1), y=(1.2, 2.0), z=(0, 4.5)),
    "biomass": dict(x=(-1.1, 1.1), y=(0.9, 2.0), z=(0, 4.5)),
}


def build():
    out = {}
    for name, fn in PIECES:
        obj = fn()
        assert obj.name == name, (obj.name, name)
        out[name] = obj
    return out


def validate(pieces):
    """Print WARN lines for contract violations (run-blender.mjs surfaces them)."""
    problems = []
    for n, rng in CONTRACT.items():
        problems += check_extent(pieces[n], **rng)
    # the window opening must be truly open, the doorway see-through in front of the back posts
    blocked = (check_clear(pieces["wall_window"], (-0.52, 0.52), (1.78, 3.32)) +
               check_clear(pieces["wall_window"], (-0.68, 0.68), (1.93, 3.17)))
    if blocked:
        problems.append(f"wall_window: {blocked} rays blocked inside the opening")
    blocked = check_clear(pieces["bulkhead_door"], (-0.29, 0.29), (0.02, 2.98), y_stop=1.5)
    if blocked:
        problems.append(f"bulkhead_door: {blocked} rays blocked in the doorway in front of y=1.5")
    for p in problems:
        print("WARN contract", p)
    return problems


def main():
    args = script_args()
    out = out_dir(args)
    reset_scene()
    pieces = build()
    info = {n: piece_info(o) for n, o in pieces.items()}
    for n, i in info.items():
        budget = 1500
        flag = "" if i["tris"] <= budget else "  OVER BUDGET"
        print(f"STATS roomkit {n:15s} w={i['w']:.2f} h={i['h']:.2f} tris={i['tris']}{flag}")
    validate(pieces)
    export_glb(os.path.join(out, "roomkit.glb"), list(pieces.values()))
    write_meta(out, "roomkit", {"nodes": list(pieces), "pieces": info, "bounds": bounds(list(pieces.values()))})
    if args.get("preview"):
        from lib.env import sheet
        pdir = out_dir(args, "preview", "tools/out/previews")
        sheet([(n, o) for n, o in pieces.items()], os.path.join(pdir, "roomkit.png"), cols=5, tile=320, yaw=0, pitch=6)
        sheet([(n, o) for n, o in pieces.items()], os.path.join(pdir, "roomkit_3q.png"), cols=5, tile=320,
              yaw=30, pitch=14)
        import mockup
        mockup.room(pieces, os.path.join(pdir, "room_mockup.png"))


if __name__ == "__main__":
    main()
