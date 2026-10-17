"""Room mock-up renders for reviewing the room kit + props in the in-game composition.

Not an asset script: roomkit.py calls `room()` from its --preview pass after exporting. It builds
the props (props.build()) into the same scene, assembles a sample 12 m room from linked copies
and renders it with an orthographic camera from -Y with a slight elevation, like the game.
"""
import math
import os
import random

import bpy
from mathutils import Vector

from lib.common import link
from lib.env import GLOW_RGB, Geo, bx, camera, inst, quad, render_view, _standard_view  # noqa: F401

DECK = 5.0


def _placeholder(name, bm, rgb, glow=None):
    g = Geo(seed=len(name))
    g.add(bm, rgb, jitter=0.02) if glow is None else g.glow(bm, glow)
    return g.build(name)


def _starfield():
    g = Geo(seed=3)
    g.add(bx(-8, 8, 2.3, 2.32, -1, 11), "#05070d", jitter=0.0)
    rnd = random.Random(4)
    for _ in range(260):
        x, z = rnd.uniform(-8, 8), rnd.uniform(-1, 11)
        s = rnd.choice((0.012, 0.018, 0.028))
        g.add(quad(x - s, x + s, z - s, z + s, 2.29), rnd.choice(("#8f9ab0", "#c8d2e8", "#6a7488")), jitter=0.0)
    return g.build("mock_stars")


def _marine(x, rgb="#3f4a2b"):
    """Crude 2.1 m silhouette for scale (the real marine is built elsewhere)."""
    g = Geo(seed=int(x * 10) & 0xff)
    g.add(bx(-0.22, 0.22, -0.2, 0.2, 0.0, 0.95, bevel=0.05), "#16181a")
    g.add(bx(-0.32, 0.32, -0.25, 0.25, 0.95, 1.7, bevel=0.08), rgb)
    g.add(bx(-0.42, 0.42, -0.27, 0.27, 1.45, 1.75, bevel=0.08), rgb)
    g.add(bx(-0.16, 0.16, -0.18, 0.18, 1.72, 2.08, bevel=0.06), rgb)
    g.glow(bx(-0.1, 0.1, -0.2, -0.17, 1.86, 1.92), "red")
    g.add(bx(0.2, 0.9, -0.33, -0.27, 1.25, 1.36), "#2c3034")
    o = g.build(f"mock_marine_{x:.1f}")
    o.location.x = x
    return o


def room(kit, path, props=None):
    """Assemble a sample 12 m room (x in [-6, 6]) plus a slice of the deck above, and render it."""
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = True
    if props is None:
        import props as props_mod
        props = props_mod.build()
        for o in props.values():
            o.hide_render = True
            for c in o.children_recursive:
                c.hide_render = True
    made = []

    def put(src, x, z=0.0, y=0.0, scale=None):
        o = inst(src, (x, y, z), scale=scale)
        made.append(o)
        made.extend(o.children)
        return o

    # structure: slabs are placeholders (the engine builds slab bodies itself). Their front is at y=-0.9:
    # floor_trim occupies y in [-1.0, -0.9] and would be hidden inside a slab that reached y=-1.0.
    shaft_x = -3.9
    for z0 in (-0.5, DECK - 0.5):
        segs = [(-6.6, 6.6)] if z0 < 0 else [(-6.6, shaft_x - 0.65), (shaft_x + 0.65, 6.6)]
        for xa, xb in segs:
            made.append(_placeholder(f"mock_slab_{z0}_{xa}", bx(xa, xb, -0.9, 2.0, z0, z0 + 0.5), "#1d2124"))
        if z0 > 0:
            made.append(_placeholder("mock_slab_front", bx(shaft_x - 0.65, shaft_x + 0.65, -0.9, 0.7, z0, z0 + 0.5), "#1d2124"))
    walls = ["wall_pipes", "wall_plain", "wall_window", "wall_screen", "wall_vent", "wall_hazard"]
    upper = ["wall_shelves", "wall_plain", "wall_pipes", "wall_window", "wall_plain", "wall_screen"]
    for i, (w, u) in enumerate(zip(walls, upper)):
        x = -5 + 2 * i
        put(kit[w], x)
        put(kit[u], x, z=DECK)
        put(kit["floor_trim"], x)
        put(kit["floor_trim"], x, z=DECK)
        if x in (-1, 3):
            put(kit["ceiling_lamp"], x)
        elif x != -5:
            put(kit["ceiling_pipes"], x)
    put(kit["hull_end"], -6.6)
    put(kit["hull_end"], -6.6, z=DECK)
    put(kit["bulkhead_door"], 6.3)
    put(kit["door_panel"], 6.3, scale=(1, 1, 0.35))
    put(kit["bulkhead_solid"], 6.3, z=DECK)
    put(kit["ladder"], shaft_x)
    put(kit["shaft_rim"], shaft_x, z=DECK)
    put(kit["lamp_red"], -5.6)
    put(kit["lamp_white"], 1.0)
    put(kit["cobweb"], -5.2)
    put(kit["slime"], 4.95)
    put(kit["vent_wall"], 4.6)
    put(kit["vent_ceiling"], -1.8)
    put(kit["biomass"], 1.6, z=DECK)
    # props at their render depths (Blender y = -three z from src/gen/templates.js)
    put(props["crate"], -2.4, y=1.2)
    put(props["barrel"], -1.35, y=1.1)
    put(props["locker"], 0.3, y=1.55)
    put(props["cabinet"], 1.9, y=1.6)
    put(props["console"], 3.4, y=1.5)
    put(props["debris"], 5.0, y=0.0)
    put(props["shelf"], -2.0, z=DECK, y=1.65)
    put(props["bunk"], 3.4, z=DECK, y=1.4)
    made.append(_starfield())
    for x in (-3.0, -0.9):
        made.append(_marine(x))
    for o in made:
        o.hide_render = False
    bpy.context.view_layer.update()
    render_view(path, target=(0.0, 0.0, 2.75), scale=14.4, res=(1920, 1080), yaw=0.0, pitch=4.0,
                label="ROOM MOCK-UP  12 M  (ORTHO FROM -Y, 4 DEG)")
    # a closer crop at game zoom around the squad
    render_view(path.replace(".png", "_close.png"), target=(-1.6, 0.0, 2.2), scale=8.0, res=(1600, 900),
                yaw=0.0, pitch=4.0, label="CLOSE")
    for o in made:
        bpy.data.objects.remove(o, do_unlink=True)
    return path


def _starfield_wide(x0, x1, z0, z1, n=500):
    g = Geo(seed=5)
    g.add(bx(x0, x1, 2.3, 2.32, z0, z1), "#04060c", jitter=0.0)
    rnd = random.Random(6)
    for _ in range(n):
        x, z = rnd.uniform(x0, x1), rnd.uniform(z0, z1)
        s = rnd.choice((0.015, 0.022, 0.035))
        g.add(quad(x - s, x + s, z - s, z + s, 2.29), rnd.choice(("#8f9ab0", "#c8d2e8", "#6a7488")), jitter=0.0)
    return g.build("mock_stars_wide")


def docked(dock, path, kit=None, props=None):
    """Dropship docked to the derelict's airlock through two tube sections (dock.py --preview)."""
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = True
    if kit is None:
        import roomkit
        kit = roomkit.build()
    if props is None:
        import props as props_mod
        props = props_mod.build()
    for o in list(kit.values()) + list(props.values()):
        for p in [o] + list(o.children_recursive):
            p.hide_render = True
    made = []

    def put(src, x, z=0.0, y=0.0, scale=None):
        o = inst(src, (x, y, z), scale=scale)
        made.append(o)
        made.extend(o.children)
        return o

    collar = -4.0
    put(dock["dropship"], collar)
    for k in range(2):
        put(dock["dock_tube"], collar + 2 * k)
    hx = collar + 4.0 + 0.6
    put(dock["hull_dock"], hx)
    put(kit["door_panel"], hx, scale=(1, 1, 0.45))
    put(kit["hull_end"], hx, z=DECK)
    x_room = hx + 0.6
    for k in range(4):
        x = x_room + 1 + 2 * k
        put(kit[("wall_hazard", "wall_plain", "wall_hazard", "wall_pipes")[k]], x)
        put(kit[("wall_plain", "wall_vent", "wall_plain", "wall_window")[k]], x, z=DECK)
        put(kit["floor_trim"], x)
        put(kit["floor_trim"], x, z=DECK)
    for z0 in (-0.5, DECK - 0.5):
        made.append(_placeholder(f"mock_dslab_{z0}", bx(x_room, x_room + 8, -0.9, 2.0, z0, z0 + 0.5), "#1d2124"))
    made.append(_placeholder("mock_dkeel", bx(hx - 0.6, x_room + 8, -0.6, 2.0, -2.1, -0.5), "#15181b"))
    made.append(_placeholder("mock_droof", bx(hx - 0.6, x_room + 8, -0.6, 2.0, 2 * DECK - 0.5, 2 * DECK + 0.9), "#15181b"))
    put(kit["lamp_red"], x_room + 2.5)
    put(props["airlock_hatch"], x_room + 0.6, y=1.4)
    put(props["barrel_explosive"], x_room + 5.0, y=1.1) if "barrel_explosive" in props else None
    made.append(_starfield_wide(-26, 14, -6, 13))
    for x in (-8.5, -5.5, -2.2):
        made.append(_marine(x))
    for o in made:
        o.hide_render = False
    bpy.context.view_layer.update()
    render_view(path, target=(-6.2, 0.0, 2.6), scale=33.0, res=(1920, 960), yaw=0.0, pitch=4.0,
                label="DOCKED: DROPSHIP + 2 TUBES + HULL_DOCK + AIRLOCK")
    render_view(path.replace(".png", "_close.png"), target=(-3.0, 0.0, 2.0), scale=17.0, res=(1600, 900),
                yaw=0.0, pitch=4.0, label="DOCK CLOSE")
    for o in made:
        bpy.data.objects.remove(o, do_unlink=True)
    return path
