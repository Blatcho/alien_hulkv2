#!/usr/bin/env python
"""
blender_props.py -- procedural 3D props and pickups for Beast of Thornmoor, rendered
to sprite sheets with Blender (the `bpy` Python module, Cycles on CPU).

How to run
----------
This script needs a Python environment that has the `bpy` module (Blender 4.x/5.x) and
numpy installed. In this repo that is the venv under the scratchpad:

    <venv>/bin/python tools/blender_props.py              # render everything
    <venv>/bin/python tools/blender_props.py --only coin,gem   # just some assets
    <venv>/bin/python tools/blender_props.py --ss 1 --samples 16   # fast preview

Options
    --only a,b,c   comma-separated asset names (coin gem potion_red potion_green chest
                   shrine skull gravestone1 gravestone2 gravestone3 torch pillar cage
                   brazier banner)
    --samples N    Cycles samples per frame (default 128, adaptive, denoised)
    --ss N         supersampling factor; frames are rendered at N x the target size and
                   box-filtered down (default 2) for crisp anti-aliased sprites
    --out DIR      output directory (default assets/sprites/props next to the repo root)

Output
    assets/sprites/props/<name>.png     RGBA sprite sheets / single frames, transparent background
    assets/sprites/props/<name>_n.png   matching normal map (same size and frame layout)
    assets/sprites/props/props.json     frame size, frame count, pivot and normal map per file

Everything is modelled procedurally from primitives (no .blend files), so the output is
reproducible. Each asset is rendered with an orthographic camera at a slight 3/4 downward
angle, a warm key light from the upper left, a cool blue fill from the right and a strong
rim light from behind, against a transparent background. Materials are layered: rust streaks
and chipped paint on iron, grain and cracks on weathered wood, lichen, moss and damp on stone,
cracked yellowing bone. A bloom-like glow for emissive parts (gem, potions, lit shrine, open
chest) is added in numpy after the render so it also extends into the transparent area.

Normal maps
-----------
Every render also writes Cycles' Normal pass through the compositor (uncompressed EXR, parsed
with numpy). The world-space normals are rotated into camera space and encoded as a
tangent-space-style map in the OpenGL convention Phaser's Light2D pipeline expects:
R = right, G = up (in image space), B = towards the viewer; a flat surface facing the camera
is (128, 128, 255). Alpha is the alpha of the colour sprite; fully transparent pixels are
(128, 128, 255, 0).
"""

import json
import math
import os
import struct
import sys
import time
import zlib

import numpy as np

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

# ----------------------------------------------------------------------------------------
# Paths / arguments
# ----------------------------------------------------------------------------------------

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = {"only": None, "samples": 128, "ss": 2, "out": os.path.join(REPO, "assets", "sprites", "props")}
_argv = sys.argv[1:]
_i = 0
while _i < len(_argv):
    a = _argv[_i]
    if a == "--only":
        ARGS["only"] = set(_argv[_i + 1].split(","))
        _i += 2
    elif a == "--samples":
        ARGS["samples"] = int(_argv[_i + 1])
        _i += 2
    elif a == "--ss":
        ARGS["ss"] = int(_argv[_i + 1])
        _i += 2
    elif a == "--out":
        ARGS["out"] = _argv[_i + 1]
        _i += 2
    else:
        _i += 1

OUT_DIR = ARGS["out"]
SCRATCH = os.path.join(os.environ.get("TMPDIR", "/tmp"), "blender_props_frames")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(SCRATCH, exist_ok=True)

TAU = math.tau
NORMAL_EXR = os.path.join(SCRATCH, "normal_.exr")


# ----------------------------------------------------------------------------------------
# Scene setup
# ----------------------------------------------------------------------------------------

def reset_scene():
    """Fresh empty scene with Cycles configured for small, punchy sprite renders."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = ARGS["samples"]
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.adaptive_min_samples = min(32, ARGS["samples"])
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
        sc.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.render.film_transparent = True
    sc.render.filter_size = 1.2
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.render.image_settings.compression = 15
    sc.render.resolution_percentage = 100
    sc.render.dither_intensity = 0.0
    # Colour management: AgX with the punchy look keeps saturated colours and rolls off
    # the emissive highlights nicely.
    sc.display_settings.display_device = "sRGB"
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Punchy"
    except Exception:
        sc.view_settings.view_transform = "Standard"
    sc.view_settings.exposure = 0.35
    sc.view_settings.gamma = 1.0
    setup_world(sc)
    setup_normal_pass(sc)
    return sc


def setup_normal_pass(sc):
    """Enable the Normal pass and write it through the compositor as an uncompressed
    float EXR next to the colour render (the colour still goes through the normal
    PNG output with the view transform applied)."""
    sc.view_layers[0].use_pass_normal = True
    sc.render.use_compositing = True
    try:
        sc.render.compositor_device = "CPU"
    except Exception:
        pass
    if hasattr(sc, "compositing_node_group"):  # Blender 5.x
        ng = bpy.data.node_groups.new("PropsComp", "CompositorNodeTree")
        sc.compositing_node_group = ng
        ng.nodes.clear()
        rl = ng.nodes.new("CompositorNodeRLayers")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        go = ng.nodes.new("NodeGroupOutput")
        ng.links.new(rl.outputs["Image"], go.inputs[0])
        fo = ng.nodes.new("CompositorNodeOutputFile")
        fo.directory = SCRATCH
        fo.file_name = "normal_"
        try:
            fo.format.exr_codec = "NONE"
        except Exception:
            pass
        it = fo.file_output_items.new("RGBA", "Normal")
        it.override_node_format = True
        it.format.file_format = "OPEN_EXR"
        it.format.color_depth = "32"
        it.format.color_mode = "RGBA"
        it.format.exr_codec = "NONE"
        ng.links.new(rl.outputs["Normal"], fo.inputs[0])
    else:  # Blender 4.x
        sc.use_nodes = True
        ng = sc.node_tree
        ng.nodes.clear()
        rl = ng.nodes.new("CompositorNodeRLayers")
        comp = ng.nodes.new("CompositorNodeComposite")
        ng.links.new(rl.outputs["Image"], comp.inputs[0])
        fo = ng.nodes.new("CompositorNodeOutputFile")
        fo.base_path = SCRATCH
        fo.format.file_format = "OPEN_EXR"
        fo.format.color_depth = "32"
        fo.format.color_mode = "RGBA"
        fo.format.exr_codec = "NONE"
        fo.file_slots[0].path = "normal_"
        ng.links.new(rl.outputs["Normal"], fo.inputs[0])


def setup_world(sc):
    """Dark blue-grey sky gradient: dim ambient, but metals have something to reflect."""
    w = bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.02, 0.02, 0.04, 1)
    e1 = ramp.color_ramp.elements[1]
    e1.position = 0.55
    e1.color = (0.18, 0.22, 0.32, 1)
    e2 = ramp.color_ramp.elements.new(1.0)
    e2.color = (0.9, 0.75, 0.55, 1)
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.8
    nt.links.new(bg.outputs[0], out.inputs[0])


def add_light(name, kind, direction=None, location=None, color=(1, 1, 1), energy=3.0, angle=0.25, size=4.0):
    """Sun lights pointing along `direction` (world-space, from light towards target)."""
    ld = bpy.data.lights.new(name, kind)
    ld.color = color
    ld.energy = energy
    if kind == "SUN":
        ld.angle = angle
    else:
        ld.shadow_soft_size = size
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    if direction is not None:
        d = Vector(direction).normalized()
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if location is not None:
        ob.location = location
    return ob


def light_rig(key=5.0, fill=1.6, rim=6.0, extra_point=None, bbox=None):
    """Warm key from upper-left-front, cool fill from right, strong rim from behind."""
    # Directions are "from the light towards the subject". Camera looks along +Y from -Y.
    add_light("Key", "SUN", direction=(0.55, 0.55, -0.75), color=(1.0, 0.86, 0.66), energy=key, angle=0.35)
    add_light("Fill", "SUN", direction=(-0.8, 0.45, -0.25), color=(0.45, 0.62, 1.0), energy=fill, angle=0.8)
    add_light("Rim", "SUN", direction=(-0.35, -0.85, -0.5), color=(0.85, 0.95, 1.0), energy=rim, angle=0.2)
    add_light("RimLow", "SUN", direction=(0.5, -0.8, 0.25), color=(1.0, 0.7, 0.45), energy=rim * 0.35, angle=0.4)
    if extra_point is not None:
        loc, col, en = extra_point
        add_light("Glow", "POINT", location=loc, color=col, energy=en, size=0.3)


def set_camera(objs, w, h, frames_setup=None, nframes=1, margin=0.06, az=18.0, el=22.0, pad=None):
    """Orthographic camera at a 3/4 downward angle, fitted to the union bounding box of
    all frames. `pad` is (left, right, bottom, top) extra padding as fractions."""
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    cam_data.clip_end = 1000
    cam = bpy.data.objects.new("Cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    a = math.radians(az)
    e = math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = d * 60.0
    cam.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    # Collect projected extents over all frames.
    xs, ys = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for f in range(nframes):
        if frames_setup:
            frames_setup(f)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        for ob in objs:
            if ob.type != "MESH" or ob.hide_render:
                continue
            ev = ob.evaluated_get(dg)
            mw = ev.matrix_world
            for c in ev.bound_box:
                p = inv @ (mw @ Vector(c))
                xs.append(p.x)
                ys.append(p.y)
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pl, pr, pb, pt = pad if pad else (margin, margin, margin, margin)
    ew, eh = x1 - x0, y1 - y0
    x0 -= ew * pl
    x1 += ew * pr
    y0 -= eh * pb
    y1 += eh * pt
    ew, eh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # ortho_scale covers the larger render dimension (sensor fit AUTO).
    if w >= h:
        scale = max(ew, eh * w / h)
    else:
        scale = max(eh, ew * h / w)
    cam_data.ortho_scale = scale
    # Shift the camera in its own plane so the bbox centre sits in the middle.
    cam.location = cam.location + cam.matrix_world.to_3x3() @ Vector((cx, cy, 0.0))
    if frames_setup:
        frames_setup(0)
    return cam


# ----------------------------------------------------------------------------------------
# Node-tree helpers
# ----------------------------------------------------------------------------------------

class NB:
    """Tiny node-tree builder: `nb.n(type, {input: value_or_socket}, attr=...)`."""

    def __init__(self, nt):
        self.nt = nt

    def set(self, node, key, v):
        sock = node.inputs[key]
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        elif isinstance(v, (tuple, list)) and len(v) == 3 and sock.type == "RGBA":
            sock.default_value = (*v, 1.0)
        else:
            sock.default_value = v

    def n(self, t, inputs=None, **attrs):
        node = self.nt.nodes.new(t)
        for k, v in attrs.items():
            setattr(node, k, v)
        if inputs:
            for k, v in inputs.items():
                self.set(node, k, v)
        return node

    # convenience wrappers returning output sockets
    def math(self, op, a, b=0.0, c=None, clamp=False):
        ins = {0: a, 1: b}
        if c is not None:
            ins[2] = c
        return self.n("ShaderNodeMath", ins, operation=op, use_clamp=clamp).outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        return self.n("ShaderNodeMix", {"Factor": fac, "A": a, "B": b}, data_type="RGBA", blend_type=blend).outputs["Result"]

    def mixf(self, fac, a, b):
        return self.n("ShaderNodeMix", {"Factor": fac, "A": a, "B": b}, data_type="FLOAT").outputs["Result"]

    def ramp(self, fac, stops):
        """stops: list of (pos, rgb)."""
        r = self.n("ShaderNodeValToRGB", {"Fac": fac})
        cr = r.color_ramp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = (*stops[0][1], 1)
        for pos, col in stops[1:]:
            e = cr.elements.new(pos)
            e.color = (*col, 1)
        return r.outputs["Color"]

    def maprange(self, v, a, b, c=0.0, d=1.0, clamp=True):
        return self.n("ShaderNodeMapRange", {"Value": v, "From Min": a, "From Max": b, "To Min": c, "To Max": d}, clamp=clamp).outputs["Result"]

    def smooth(self, v, a, b):
        """smoothstep between a and b."""
        return self.n("ShaderNodeMapRange", {"Value": v, "From Min": a, "From Max": b}, interpolation_type="SMOOTHSTEP").outputs["Result"]

    def noise(self, vec, scale, detail=3.0, rough=0.55, distortion=0.0, dim="3D"):
        return self.n("ShaderNodeTexNoise", {"Vector": vec, "Scale": scale, "Detail": detail, "Roughness": rough, "Distortion": distortion},
                      noise_dimensions=dim).outputs["Fac"]

    def voronoi(self, vec, scale, feature="F1", rnd=1.0, out="Distance", smooth=0.0):
        v = self.n("ShaderNodeTexVoronoi", {"Vector": vec, "Scale": scale, "Randomness": rnd}, feature=feature)
        if feature == "SMOOTH_F1":
            v.inputs["Smoothness"].default_value = smooth
        return v.outputs[out]

    def mapping(self, vec, scale=(1, 1, 1), rot=(0, 0, 0), loc=(0, 0, 0)):
        m = self.n("ShaderNodeMapping", {"Vector": vec})
        m.inputs["Scale"].default_value = scale
        m.inputs["Rotation"].default_value = rot
        m.inputs["Location"].default_value = loc
        return m.outputs["Vector"]

    def coords(self):
        tc = self.n("ShaderNodeTexCoord")
        geo = self.n("ShaderNodeNewGeometry")
        return tc, geo

    def sep(self, vec):
        s = self.n("ShaderNodeSeparateXYZ", {"Vector": vec})
        return s.outputs["X"], s.outputs["Y"], s.outputs["Z"]

    def bump(self, height, strength, distance=0.05, normal=None, invert=False):
        b = self.n("ShaderNodeBump", {"Height": height, "Strength": strength, "Distance": distance}, invert=invert)
        if normal is not None:
            self.nt.links.new(normal, b.inputs["Normal"])
        return b.outputs["Normal"]

    def ao(self, distance=0.35, samples=4):
        a = self.n("ShaderNodeAmbientOcclusion", {"Distance": distance})
        a.samples = samples
        a.only_local = True
        return a.outputs["AO"]

    def facing(self, blend=0.5):
        return self.n("ShaderNodeLayerWeight", {"Blend": blend}).outputs["Facing"]

    def principled(self, **kw):
        p = self.n("ShaderNodeBsdfPrincipled", kw)
        return p

    def out(self, shader):
        o = self.n("ShaderNodeOutputMaterial")
        self.nt.links.new(shader, o.inputs[0])
        return o


def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return m, NB(nt)


def _ao_mul(nb, col, strength=0.7, distance=0.35, floor=0.35):
    """Darken a colour socket by local ambient occlusion (edge/crevice darkening)."""
    ao = nb.maprange(nb.ao(distance), 0.0, 1.0, floor, 1.0)
    return nb.mix(strength, col, ao, "MULTIPLY")


# ----------------------------------------------------------------------------------------
# Materials
# ----------------------------------------------------------------------------------------

def mat_simple(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0,
               ao=0.7, specular=0.5, coat=0.0):
    m, nb = _new_mat(name)
    p = nb.principled(**{"Base Color": _ao_mul(nb, color, ao), "Metallic": metallic, "Roughness": roughness,
                         "Specular IOR Level": specular, "Coat Weight": coat})
    if emission is not None:
        p.inputs["Emission Color"].default_value = (*emission, 1.0)
        p.inputs["Emission Strength"].default_value = emission_strength
    nb.out(p.outputs[0])
    return m


def mat_emissive(name, color, strength):
    """Emissive surface built on Principled (black base) so it still writes a normal."""
    m, nb = _new_mat(name)
    p = nb.principled(**{"Base Color": (0.0, 0.0, 0.0), "Roughness": 0.6, "Specular IOR Level": 0.2,
                         "Emission Color": color, "Emission Strength": strength})
    nb.out(p.outputs[0])
    return m


def mat_gold(name, color=(1.0, 0.74, 0.22), dark=(0.72, 0.42, 0.10), roughness=0.28, ao=0.5):
    """Polished gold with micro-scratches, slightly duller tone in the recesses and a touch
    of brown tarnish in crevices."""
    m, nb = _new_mat(name)
    tc, geo = nb.coords()
    ob = tc.outputs["Object"]
    tone = nb.noise(ob, 3.0, 2.0, 0.5)
    base = nb.mix(nb.maprange(tone, 0.35, 0.65), color, dark)
    # tarnish in crevices
    aoc = nb.ao(0.25)
    tarn = nb.maprange(aoc, 0.3, 0.9, 1.0, 0.0)
    base = nb.mix(nb.math("MULTIPLY", tarn, 0.4), base, (0.35, 0.18, 0.05))
    base = _ao_mul(nb, base, ao, 0.3, 0.45)
    # micro scratches: stretched fine noise
    scr = nb.noise(nb.mapping(ob, scale=(40, 2, 40)), 1.0, 1.0, 0.5)
    rough = nb.maprange(scr, 0.3, 0.7, roughness - 0.08, roughness + 0.12)
    nrm = nb.bump(scr, 0.08, 0.02)
    p = nb.principled(**{"Base Color": base, "Metallic": 1.0, "Roughness": rough, "Normal": nrm, "Coat Weight": 0.15})
    nb.out(p.outputs[0])
    return m


def mat_iron(name, dark=(0.10, 0.10, 0.11), light=(0.30, 0.29, 0.29), rust=0.55, paint=None, chips=0.45,
             roughness=0.5, bump=0.3, soot_z=None, streak_axis="Z"):
    """Wrought iron: grey metal with rust streaks (stretched noise running down the surface,
    heavier in crevices and on downward-facing areas) and optional chipped paint on top.
    `soot_z` = (z0, z1) blackens the surface between those world heights (torch soot)."""
    m, nb = _new_mat(name)
    tc, geo = nb.coords()
    ob = tc.outputs["Object"]
    pos = geo.outputs["Position"]
    nx, ny, nz = nb.sep(geo.outputs["Normal"])
    # base metal
    grain = nb.noise(ob, 7.0, 4.0, 0.6)
    base = nb.mix(nb.maprange(grain, 0.3, 0.7), dark, light)
    fine = nb.noise(ob, 30.0, 5.0, 0.7)
    # rust mask: vertical streaks * blobs + crevices + down-facing
    streak_scale = (7.0, 7.0, 0.8) if streak_axis == "Z" else (0.8, 7.0, 7.0)
    streak = nb.noise(nb.mapping(ob, scale=streak_scale), 1.0, 3.0, 0.7)
    blob = nb.noise(ob, 1.8, 3.0, 0.6)
    aoc = nb.ao(0.3)
    crev = nb.maprange(aoc, 0.4, 1.0, 1.0, 0.0)
    down = nb.maprange(nz, -1.0, 0.4, 0.45, 0.0)
    acc = nb.math("ADD", nb.math("MULTIPLY", streak, 0.55), nb.math("MULTIPLY", blob, 0.55))
    acc = nb.math("ADD", acc, nb.math("MULTIPLY", crev, 0.35))
    acc = nb.math("ADD", acc, down)
    rmask = nb.smooth(acc, 0.72 - rust * 0.25, 0.9 - rust * 0.2)
    rust_col = nb.mix(nb.maprange(nb.noise(ob, 12.0, 4.0, 0.6), 0.3, 0.7), (0.28, 0.10, 0.03), (0.62, 0.28, 0.08))
    col = nb.mix(rmask, base, rust_col)
    metal = nb.mixf(rmask, 0.85, 0.05)
    rough = nb.mixf(rmask, nb.maprange(fine, 0.3, 0.7, roughness - 0.1, roughness + 0.1), 0.95)
    h = nb.math("ADD", nb.math("MULTIPLY", fine, 0.6), nb.math("MULTIPLY", rmask, nb.noise(ob, 25.0, 3.0, 0.7)))
    if paint is not None:
        # paint layer with chips: voronoi cells thresholded by noise so chips cluster at edges
        cell = nb.voronoi(ob, 9.0, "SMOOTH_F1", smooth=0.3)
        cn = nb.noise(ob, 4.0, 3.0, 0.6)
        chip = nb.math("ADD", nb.math("MULTIPLY", cell, 0.8), nb.math("MULTIPLY", cn, 0.6))
        chip = nb.math("ADD", chip, nb.math("MULTIPLY", crev, 0.6))
        pmask = nb.smooth(chip, 0.55 + chips * 0.2, 0.65 + chips * 0.2)  # 1 = chipped away
        paint_col = nb.mix(nb.maprange(nb.noise(ob, 6.0, 3.0, 0.6), 0.3, 0.7), paint, tuple(c * 0.6 for c in paint))
        col = nb.mix(pmask, paint_col, col)
        metal = nb.mixf(pmask, 0.0, metal)
        rough = nb.mixf(pmask, 0.55, rough)
        h = nb.math("ADD", h, nb.math("MULTIPLY", pmask, -0.5))
    if soot_z is not None:
        z = nb.sep(pos)[2]
        soot = nb.smooth(z, soot_z[0], soot_z[1])
        soot = nb.math("MULTIPLY", soot, nb.maprange(nb.noise(ob, 3.0, 3.0, 0.6), 0.25, 0.75, 0.4, 1.0))
        col = nb.mix(soot, col, (0.012, 0.011, 0.01))
        rough = nb.mixf(soot, rough, 0.95)
        metal = nb.mixf(soot, metal, 0.0)
    col = _ao_mul(nb, col, 0.6, 0.3, 0.4)
    nrm = nb.bump(h, bump, 0.04)
    p = nb.principled(**{"Base Color": col, "Metallic": metal, "Roughness": rough, "Normal": nrm, "Specular IOR Level": 0.5})
    nb.out(p.outputs[0])
    return m


def mat_wood(name, light=(0.50, 0.28, 0.11), dark=(0.20, 0.09, 0.03), grey=(0.34, 0.31, 0.27), weather=0.5,
             axis="X", scale=1.0, roughness=0.75, cracks=0.5):
    """Weathered planks: wave-texture grain running along `axis`, grey sun-bleached patches,
    cracks following the grain (dark, bumped) and fine pores."""
    m, nb = _new_mat(name)
    tc, geo = nb.coords()
    ob = tc.outputs["Object"]
    rot = {"X": (0, 0, 0), "Y": (0, 0, math.pi / 2), "Z": (0, math.pi / 2, 0)}[axis]
    v = nb.mapping(ob, scale=(1.0 / scale, 1.0 / scale, 1.0 / scale), rot=rot)
    wave = nb.n("ShaderNodeTexWave", {"Vector": v, "Scale": 1.6, "Distortion": 3.0, "Detail": 3.0, "Detail Scale": 1.5, "Detail Roughness": 0.6},
                wave_type="BANDS", bands_direction="Y", wave_profile="SIN").outputs["Fac"]
    pores = nb.noise(nb.mapping(v, scale=(1.5, 30, 30)), 1.0, 2.0, 0.6)
    g = nb.math("ADD", nb.math("MULTIPLY", wave, 0.75), nb.math("MULTIPLY", pores, 0.35))
    col = nb.ramp(g, [(0.15, dark), (0.5, light), (0.75, tuple(min(1, c * 1.25) for c in light)), (0.95, dark)])
    # weathering: grey on exposed areas (big noise + facing up)
    nz = nb.sep(geo.outputs["Normal"])[2]
    wn = nb.noise(ob, 1.4, 3.0, 0.6)
    wmask = nb.smooth(nb.math("ADD", wn, nb.math("MULTIPLY", nb.maprange(nz, -0.2, 1.0), 0.25)), 0.55 - weather * 0.2, 0.75 - weather * 0.1)
    col = nb.mix(wmask, col, nb.mix(nb.maprange(wave, 0.3, 0.7), grey, tuple(c * 0.7 for c in grey)))
    # cracks along the grain
    cv = nb.voronoi(nb.mapping(v, scale=(0.35, 3.0, 3.0)), 3.0, "DISTANCE_TO_EDGE")
    ck = nb.smooth(cv, 0.02 + cracks * 0.03, 0.0)  # 1 at the crack line
    ckm = nb.math("MULTIPLY", ck, nb.smooth(nb.noise(ob, 2.0, 2.0, 0.5), 0.45, 0.6))
    col = nb.mix(ckm, col, (0.03, 0.015, 0.008))
    col = _ao_mul(nb, col, 0.75, 0.3, 0.4)
    h = nb.math("ADD", nb.math("MULTIPLY", wave, 0.4), nb.math("MULTIPLY", pores, 0.3))
    h = nb.math("SUBTRACT", h, nb.math("MULTIPLY", ckm, 1.2))
    nrm = nb.bump(h, 0.45, 0.05)
    rough = nb.maprange(wmask, 0, 1, roughness, 0.92)
    p = nb.principled(**{"Base Color": col, "Roughness": rough, "Normal": nrm, "Specular IOR Level": 0.3})
    nb.out(p.outputs[0])
    return m


def mat_stone(name, a=(0.15, 0.17, 0.21), b=(0.42, 0.41, 0.39), moss=0.9, lichen=0.6, damp=1.2, scale=3.0, bump=0.6):
    """Weathered masonry: two-tone noise with voronoi facets (worn chips), fine grit,
    pale lichen blotches, moss on up-facing/low areas and damp darkening near the ground."""
    m, nb = _new_mat(name)
    tc, geo = nb.coords()
    ob = tc.outputs["Object"]
    pos = geo.outputs["Position"]
    nz = nb.sep(geo.outputs["Normal"])[2]
    wz = nb.sep(pos)[2]
    n1 = nb.noise(ob, scale, 4.0, 0.6)
    cells = nb.voronoi(ob, scale * 1.3, "SMOOTH_F1", smooth=0.4)
    grit = nb.noise(ob, scale * 9.0, 5.0, 0.7)
    t = nb.math("ADD", nb.math("MULTIPLY", n1, 0.6), nb.math("MULTIPLY", cells, 0.3))
    t = nb.math("ADD", t, nb.math("MULTIPLY", grit, 0.2))
    col = nb.ramp(t, [(0.3, a), (0.55, b), (0.75, tuple(c * 0.8 for c in b))])
    # lichen: hard-edged pale blotches
    ln = nb.noise(ob, 2.6, 5.0, 0.65)
    lm = nb.smooth(ln, 0.56 - lichen * 0.04, 0.6 - lichen * 0.04)
    lcol = nb.mix(nb.noise(ob, 15.0, 2.0, 0.5), (0.42, 0.46, 0.25), (0.60, 0.58, 0.36))
    col = nb.mix(nb.math("MULTIPLY", lm, lichen), col, lcol)
    # moss: soft noise on up-facing or low surfaces
    mn = nb.noise(ob, 1.6, 4.0, 0.6)
    up = nb.math("MULTIPLY_ADD", nz, 0.5, 0.45)
    low = nb.maprange(wz, 0.0, damp * 1.5, 0.4, 0.0) if damp > 0 else 0.0
    mm = nb.math("MULTIPLY", mn, nb.math("ADD", up, low))
    mm = nb.maprange(mm, 0.36, 0.56, 0.0, moss)
    col = nb.mix(mm, col, nb.mix(nb.noise(ob, 8.0, 3.0, 0.6), (0.10, 0.26, 0.07), (0.20, 0.38, 0.10)))
    # damp darkening low down
    if damp > 0:
        dm = nb.maprange(wz, 0.0, damp, 1.0, 0.0)
        dm = nb.math("MULTIPLY", dm, nb.maprange(nb.noise(ob, 2.0, 3.0, 0.5), 0.3, 0.7, 0.5, 1.0))
        col = nb.mix(nb.math("MULTIPLY", dm, 0.6), col, (0.03, 0.035, 0.04))
        rough = nb.mixf(dm, 0.9, 0.55)
    else:
        rough = 0.9
    col = _ao_mul(nb, col, 0.85, 0.35, 0.35)
    h = nb.math("ADD", nb.math("MULTIPLY", grit, 0.5), nb.math("MULTIPLY", cells, 0.5))
    h = nb.math("ADD", h, nb.math("MULTIPLY", lm, 0.15))
    nrm = nb.bump(h, bump, 0.08)
    p = nb.principled(**{"Base Color": col, "Roughness": rough, "Normal": nrm, "Specular IOR Level": 0.3})
    nb.out(p.outputs[0])
    return m


def mat_bone(name, light=(0.80, 0.74, 0.58), yellow=(0.56, 0.44, 0.25), cracks=0.6):
    """Old bone: cream with yellow/brown staining in crevices and low down, thin dark
    cracks, porous bump."""
    m, nb = _new_mat(name)
    tc, geo = nb.coords()
    ob = tc.outputs["Object"]
    wz = nb.sep(geo.outputs["Position"])[2]
    n1 = nb.noise(ob, 4.0, 4.0, 0.6)
    col = nb.mix(nb.maprange(n1, 0.3, 0.7), light, tuple(c * 0.85 for c in light))
    aoc = nb.ao(0.25)
    stain = nb.math("ADD", nb.maprange(aoc, 0.35, 1.0, 1.0, 0.0), nb.math("MULTIPLY", nb.noise(ob, 1.5, 3.0, 0.6), 0.6))
    stain = nb.math("ADD", stain, nb.maprange(wz, 0.0, 0.8, 0.35, 0.0))
    stain = nb.smooth(stain, 0.35, 1.0)
    col = nb.mix(stain, col, yellow)
    cv = nb.voronoi(nb.mapping(ob, scale=(1.0, 1.0, 0.45)), 5.0, "DISTANCE_TO_EDGE")
    ck = nb.smooth(cv, 0.025, 0.0)
    ckm = nb.math("MULTIPLY", ck, nb.smooth(nb.noise(ob, 2.5, 2.0, 0.5), 0.42, 0.55))
    ckm = nb.math("MULTIPLY", ckm, cracks)
    col = nb.mix(ckm, col, (0.08, 0.05, 0.03))
    col = _ao_mul(nb, col, 0.85, 0.3, 0.4)
    pores = nb.noise(ob, 25.0, 4.0, 0.7)
    h = nb.math("SUBTRACT", nb.math("MULTIPLY", pores, 0.4), nb.math("MULTIPLY", ckm, 1.0))
    nrm = nb.bump(h, 0.35, 0.03)
    rough = nb.maprange(stain, 0, 1, 0.5, 0.75)
    p = nb.principled(**{"Base Color": col, "Roughness": rough, "Normal": nrm, "Specular IOR Level": 0.35})
    nb.out(p.outputs[0])
    return m


def mat_cloth(name, col_a=(0.42, 0.03, 0.04), col_b=(0.22, 0.015, 0.02), emblem_img=None, emblem_col=(0.72, 0.58, 0.22),
              fade=0.6, roughness=0.9):
    """Heavy dyed cloth: weave bump, sun-faded towards the bottom, grime stains, optional
    emblem from a mask image mapped with Generated coordinates (faded and worn)."""
    m, nb = _new_mat(name)
    tc, geo = nb.coords()
    ob = tc.outputs["Object"]
    gen = tc.outputs["Generated"]
    gz = nb.sep(gen)[2]
    weave = nb.n("ShaderNodeTexWave", {"Vector": ob, "Scale": 60.0, "Distortion": 0.3, "Detail": 1.0}, wave_type="BANDS", bands_direction="X").outputs["Fac"]
    weave2 = nb.n("ShaderNodeTexWave", {"Vector": ob, "Scale": 60.0, "Distortion": 0.3, "Detail": 1.0}, wave_type="BANDS", bands_direction="Z").outputs["Fac"]
    wv = nb.math("MULTIPLY", weave, weave2)
    n1 = nb.noise(ob, 2.0, 4.0, 0.6)
    col = nb.mix(nb.maprange(n1, 0.3, 0.7), col_a, col_b)
    if emblem_img is not None:
        img = nb.n("ShaderNodeTexImage", {"Vector": gen})
        img.image = emblem_img
        img.interpolation = "Cubic"
        img.extension = "CLIP"
        try:
            img.image.colorspace_settings.name = "Non-Color"
        except Exception:
            pass
        em = img.outputs["Color"]
        wear = nb.smooth(nb.noise(ob, 5.0, 4.0, 0.65), 0.3, 0.5)
        em = nb.math("MULTIPLY", em, wear)
        ecol = nb.mix(nb.maprange(nb.noise(ob, 8.0, 3.0, 0.6), 0.3, 0.7), emblem_col, tuple(c * 0.6 for c in emblem_col))
        col = nb.mix(nb.math("MULTIPLY", em, 0.95), col, ecol)
    # fade towards the bottom (generated z = 0 at the bottom)
    fm = nb.maprange(gz, 0.0, 0.7, fade, 0.0)
    fm = nb.math("MULTIPLY", fm, nb.maprange(nb.noise(ob, 1.5, 3.0, 0.5), 0.3, 0.7, 0.5, 1.0))
    col = nb.mix(fm, col, (0.55, 0.32, 0.28))
    # grime: dark stains
    grime = nb.smooth(nb.noise(ob, 3.0, 5.0, 0.7), 0.6, 0.72)
    col = nb.mix(nb.math("MULTIPLY", grime, 0.7), col, (0.05, 0.03, 0.025))
    col = _ao_mul(nb, col, 0.5, 0.3, 0.5)
    nrm = nb.bump(wv, 0.25, 0.01)
    p = nb.principled(**{"Base Color": col, "Roughness": roughness, "Normal": nrm, "Sheen Weight": 0.6, "Specular IOR Level": 0.25})
    nb.out(p.outputs[0])
    return m


def mat_glass(name, tint=(0.6, 0.8, 1.0), alpha=0.1, roughness=0.12):
    """Stylised glass: a transparent shader mixed with a glossy one by fresnel, so the
    silhouette keeps a bright rim and highlights but you can see what is inside."""
    m, nb = _new_mat(name)
    tr = nb.n("ShaderNodeBsdfTransparent", {"Color": tint})
    gl = nb.principled(**{"Base Color": tuple(c * 0.55 for c in tint), "Roughness": roughness, "Specular IOR Level": 0.7, "Coat Weight": 0.2, "Coat Roughness": 0.05})
    fac = nb.maprange(nb.facing(0.25), 0.0, 1.0, alpha, 1.0)
    mix = nb.n("ShaderNodeMixShader", {"Fac": fac, 1: tr.outputs[0], 2: gl.outputs[0]})
    nb.out(mix.outputs[0])
    m.blend_method = "BLEND"
    return m


def mat_gem(name, base=(0.20, 0.03, 0.55), rim=(0.55, 0.12, 1.0), core=(0.12, 0.95, 0.9), strength=1.0):
    """Soul gem: faceted violet crystal with a teal glow in the middle of each facet that
    turns violet towards the silhouette (fresnel), plus 'caustic' flares: facets whose
    normals catch one of a few fixed directions flare bright teal-white while their
    neighbours stay deep violet. A little transmission lets the emissive core leak through."""
    m, nb = _new_mat(name)
    tc, geo = nb.coords()
    nrm = geo.outputs["Normal"]

    def flare(d, k):
        dot = nb.n("ShaderNodeVectorMath", {0: nrm, 1: d}, operation="DOT_PRODUCT").outputs["Value"]
        return nb.math("POWER", nb.math("MAXIMUM", dot, 0.0), k)

    f1 = flare((0.55, -0.6, 0.58), 16.0)
    f2 = flare((-0.7, -0.5, 0.5), 20.0)
    f3 = flare((0.1, -0.3, -0.95), 12.0)
    fl = nb.math("ADD", nb.math("ADD", f1, nb.math("MULTIPLY", f2, 0.8)), nb.math("MULTIPLY", f3, 0.5))
    fl = nb.math("MINIMUM", fl, 1.0)
    fac = nb.math("POWER", nb.facing(0.45), 1.6)
    ecol = nb.mix(fac, rim, core)
    ecol = nb.mix(fl, ecol, (0.75, 1.0, 1.0))
    estr = nb.math("ADD", nb.maprange(fac, 0, 1, strength * 0.4, strength * 0.9), nb.math("MULTIPLY", fl, strength * 1.5))
    p = nb.principled(**{"Base Color": base, "Roughness": 0.12, "Coat Weight": 0.5, "Coat Roughness": 0.03, "Specular IOR Level": 0.7,
                         "Transmission Weight": 0.12, "IOR": 1.7, "Emission Color": ecol, "Emission Strength": estr})
    nb.out(p.outputs[0])
    return m


def mat_liquid(name, color, glow, strength=2.5):
    m, nb = _new_mat(name)
    fac = nb.facing(0.5)
    estr = nb.maprange(fac, 0, 1, strength, strength * 0.35)
    p = nb.principled(**{"Base Color": color, "Roughness": 0.3, "Specular IOR Level": 0.4, "Coat Weight": 0.0,
                         "Emission Color": glow, "Emission Strength": estr})
    nb.out(p.outputs[0])
    return m


def mat_ember(name, dark=(0.03, 0.02, 0.02), glow=(1.0, 0.3, 0.04), strength=2.0, scale=6.0):
    """Charcoal with glowing cracks between the lumps."""
    m, nb = _new_mat(name)
    tc, geo = nb.coords()
    ob = tc.outputs["Object"]
    cv = nb.voronoi(ob, scale, "DISTANCE_TO_EDGE")
    crack = nb.smooth(cv, 0.08, 0.0)
    crack = nb.math("MULTIPLY", crack, nb.maprange(nb.noise(ob, 2.0, 2.0, 0.5), 0.3, 0.7, 0.3, 1.0))
    col = nb.mix(nb.maprange(nb.noise(ob, 10.0, 3.0, 0.6), 0.3, 0.7), dark, tuple(c * 2.5 for c in dark))
    h = nb.math("SUBTRACT", nb.noise(ob, 12.0, 3.0, 0.7), nb.math("MULTIPLY", crack, 1.5))
    p = nb.principled(**{"Base Color": col, "Roughness": 0.85, "Normal": nb.bump(h, 0.5, 0.04),
                         "Emission Color": glow, "Emission Strength": nb.math("MULTIPLY", crack, strength)})
    nb.out(p.outputs[0])
    return m


# Shared material library (rebuilt per scene because reset_scene wipes data).
def materials():
    M = {}
    M["gold"] = mat_gold("Gold")
    M["gold_dark"] = mat_gold("GoldDark", color=(0.80, 0.50, 0.12), dark=(0.52, 0.30, 0.06), roughness=0.45, ao=0.7)
    M["iron"] = mat_iron("Iron")
    M["iron_dark"] = mat_iron("IronDark", dark=(0.05, 0.05, 0.06), light=(0.18, 0.17, 0.18), rust=0.45, paint=(0.06, 0.07, 0.06), chips=0.5)
    M["iron_rusty"] = mat_iron("IronRusty", rust=0.9, roughness=0.6)
    M["wood"] = mat_wood("Wood", weather=0.3)
    M["wood_dark"] = mat_wood("WoodDark", light=(0.30, 0.16, 0.07), dark=(0.12, 0.06, 0.02), weather=0.3, axis="Z", scale=0.7)
    M["stone"] = mat_stone("Stone")
    M["stone_dark"] = mat_stone("StoneDark", a=(0.09, 0.10, 0.12), b=(0.27, 0.27, 0.26), moss=0.8, lichen=0.4)
    M["bone"] = mat_bone("Bone")
    M["black"] = mat_simple("Black", (0.01, 0.01, 0.012), roughness=0.9, ao=0.0, specular=0.0)
    M["cork"] = mat_wood("Cork", light=(0.62, 0.42, 0.20), dark=(0.38, 0.22, 0.09), weather=0.0, axis="Z", scale=0.25, cracks=0.0, roughness=0.9)
    M["glass"] = mat_glass("Glass")
    M["cloth"] = mat_cloth("Rag", col_a=(0.12, 0.09, 0.07), col_b=(0.04, 0.03, 0.03), fade=0.0)
    M["rope"] = mat_wood("Rope", light=(0.62, 0.50, 0.30), dark=(0.33, 0.24, 0.12), weather=0.0, axis="Z", scale=0.12, cracks=0.0, roughness=0.95)
    return M


# ----------------------------------------------------------------------------------------
# Geometry helpers
# ----------------------------------------------------------------------------------------

ALL_OBJS = []


def _finish(ob, mat=None, smooth=False, bevel=None, bevel_segments=3, name=None, bevel_angle=40.0):
    if name:
        ob.name = name
    if mat is not None:
        if ob.data.materials:
            ob.data.materials[0] = mat
        else:
            ob.data.materials.append(mat)
    if smooth:
        ob.data.shade_smooth()
    else:
        ob.data.shade_flat()
    if bevel:
        bm = ob.modifiers.new("Bevel", "BEVEL")
        bm.width = bevel
        bm.segments = bevel_segments
        bm.limit_method = "ANGLE"
        bm.angle_limit = math.radians(bevel_angle)
        bm.harden_normals = smooth
        bm.use_clamp_overlap = True
    ALL_OBJS.append(ob)
    return ob


def box(size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.03, name="Box"):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, mat, smooth=False, bevel=bevel, name=name)


def cyl(radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, verts=32, bevel=0.02, smooth=True, name="Cyl", scale=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=verts, location=loc, rotation=rot)
    ob = bpy.context.active_object
    if scale:
        ob.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, mat, smooth=smooth, bevel=bevel, name=name)


def cone(r1, r2, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, verts=32, bevel=0.0, smooth=True, name="Cone"):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    ob = bpy.context.active_object
    return _finish(ob, mat, smooth=smooth, bevel=bevel, name=name)


def sphere(radius, loc=(0, 0, 0), mat=None, scale=None, rot=(0, 0, 0), segments=32, rings=16, name="Sphere"):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, rotation=rot, segments=segments, ring_count=rings)
    ob = bpy.context.active_object
    if scale:
        ob.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, mat, smooth=True, name=name)


def torus(major, minor, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, scale=None, name="Torus", seg=32, ring=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=seg, minor_segments=ring)
    ob = bpy.context.active_object
    if scale:
        ob.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, mat, smooth=True, name=name)


def mesh_from_pydata(name, verts, faces, mat=None, smooth=False, bevel=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel_segments=3, bevel_angle=40.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return _finish(ob, mat, smooth=smooth, bevel=bevel, name=name, bevel_segments=bevel_segments, bevel_angle=bevel_angle)


def prism(profile, z0, z1, name="Prism", **kw):
    """Extrude a closed 2D profile (list of (x, y)) from z0 to z1."""
    n = len(profile)
    verts = [(x, y, z0) for x, y in profile] + [(x, y, z1) for x, y in profile]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces.append(list(range(n))[::-1])
    faces.append(list(range(n, 2 * n)))
    return mesh_from_pydata(name, verts, faces, **kw)


def extrude_x(profile_yz, x0, x1, name="Plank", **kw):
    """Extrude a closed 2D profile given in the YZ plane along X from x0 to x1."""
    n = len(profile_yz)
    verts = [(x0, y, z) for y, z in profile_yz] + [(x1, y, z) for y, z in profile_yz]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces.append(list(range(n))[::-1])
    faces.append(list(range(n, 2 * n)))
    return mesh_from_pydata(name, verts, faces, **kw)


def frustum(hw0, hw1, z0, z1, name="Frustum", **kw):
    """Square tapered block: half-width hw0 at z0, hw1 at z1."""
    verts = [(-hw0, -hw0, z0), (hw0, -hw0, z0), (hw0, hw0, z0), (-hw0, hw0, z0),
             (-hw1, -hw1, z1), (hw1, -hw1, z1), (hw1, hw1, z1), (-hw1, hw1, z1)]
    faces = [[0, 1, 2, 3][::-1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return mesh_from_pydata(name, verts, faces, **kw)


def star_profile(points, r_out, r_in, rot=0.0):
    prof = []
    for i in range(points * 2):
        ang = rot + i * math.pi / points
        r = r_out if i % 2 == 0 else r_in
        prof.append((math.cos(ang) * r, math.sin(ang) * r))
    return prof


def rod(p0, p1, r, mat=None, verts=12, name="Rod", bevel=0.0):
    """Cylinder from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = cyl(r, d.length, loc=(p0 + p1) / 2, mat=mat, verts=verts, bevel=bevel, name=name)
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return ob


def chain(p0, p1, nlinks, link=0.17, thick=0.035, mat=None, name="Link"):
    """Row of alternating chain links from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    q = d.to_track_quat("Z", "Y")
    out = []
    for k in range(nlinks):
        c = p0 + d * ((k + 0.5) / nlinks)
        t = torus(link, thick, loc=c, mat=mat, name=name, seg=20, ring=8, scale=(1, 1, 1.35))
        rot = q.to_matrix() @ Euler((math.pi / 2, 0, (k % 2) * math.pi / 2)).to_matrix()
        t.rotation_euler = rot.to_euler()
        out.append(t)
    return out


def bisect(ob, plane_co, plane_no, clear_outer=True, fill=True):
    """Cut a mesh with a world-space plane, discarding one side and capping the hole."""
    bpy.context.view_layer.update()
    inv = ob.matrix_world.inverted()
    plane_co = inv @ Vector(plane_co)
    plane_no = (inv.to_3x3() @ Vector(plane_no)).normalized()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=plane_co, plane_no=plane_no,
                                 clear_outer=clear_outer, clear_inner=not clear_outer)
    if fill:
        edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.edgeloop_fill(bm, edges=edges)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def boolean_cut(target, cutter, solver="EXACT"):
    md = target.modifiers.new("Cut", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.object = cutter
    md.solver = solver
    if solver == "EXACT":
        md.material_mode = "TRANSFER"
    cutter.hide_render = True
    cutter.hide_viewport = True
    if cutter in ALL_OBJS:
        ALL_OBJS.remove(cutter)
    return md


def group(objs, name="Root"):
    """Parent objects to an empty so the whole prop can be rotated as one."""
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        o.parent = root
    return root


def horn(loc, major=0.22, minor=0.05, rot=(0, 0, 0), mat=None, name="Horn", flip=False):
    """Curved horn: a torus cut in half, tapering a little via scale."""
    t = torus(major, minor, loc=loc, mat=mat, name=name, seg=24, ring=8)
    bisect(t, loc, (0, 0, 1), clear_outer=False)
    t.rotation_euler = rot
    if flip:
        t.scale = (-1, 1, 1)
    return t


def glyph(segs, parent, cx, cz, size, mat, width=0.06, depth=0.05, name="Rune"):
    """Carve a rune made of line segments (unit coords: x in -0.5..0.5, y in 0..1) as
    thin boxes in the parent's local XZ plane."""
    out = []
    for (x0, y0, x1, y1) in segs:
        dx, dy = (x1 - x0) * size, (y1 - y0) * size
        L = math.hypot(dx, dy)
        ang = math.atan2(dy, dx)
        b = box((L + width, depth, width), mat=mat, bevel=0.0, name=name)
        b.parent = parent
        b.location = (cx + (x0 + x1) / 2 * size, 0.0, cz + (y0 + y1) / 2 * size)
        b.rotation_euler = (0, -ang, 0)
        out.append(b)
    return out


RUNES = {
    "algiz": [(0, 0, 0, 1), (0, 0.55, -0.4, 1), (0, 0.55, 0.4, 1)],
    "thurs": [(0, 0, 0, 1), (0, 0.78, 0.42, 0.5), (0.42, 0.5, 0, 0.22)],
    "othala": [(-0.38, 0.55, 0, 1), (0, 1, 0.38, 0.55), (-0.38, 0.55, 0.32, 0), (0.38, 0.55, -0.32, 0)],
    "tiwaz": [(0, 0, 0, 1), (0, 1, -0.4, 0.72), (0, 1, 0.4, 0.72)],
    "kenaz": [(-0.3, 0, 0.3, 0.5), (0.3, 0.5, -0.3, 1)],
}


def emblem_image(name="BeastEmblem", w=256, h=512):
    """Rasterise a horned beast-skull emblem mask with numpy and load it as a Blender image
    (white emblem on black, mapped with Generated coordinates: u across, v up)."""
    u = (np.arange(w) + 0.5) / w
    v = 1.0 - (np.arange(h) + 0.5) / h  # row 0 = top
    U, V = np.meshgrid(u, v)

    def ell(cx, cy, rx, ry):
        return ((U - cx) / rx) ** 2 + ((V - cy) / ry) ** 2 <= 1.0

    m = ell(0.5, 0.60, 0.17, 0.19)  # cranium
    m |= ell(0.5, 0.47, 0.115, 0.13)  # cheeks / upper jaw
    m |= (np.abs(U - 0.5) < 0.085) & (V > 0.33) & (V < 0.48)  # muzzle
    # horns: arcs sweeping out and up
    for s in (-1, 1):
        cx, cy = 0.5 + s * 0.17, 0.60
        r = np.hypot(U - cx, V - cy)
        ang = np.arctan2(V - cy, (U - cx) * s)
        m |= (r > 0.15) & (r < 0.215) & (ang > -0.2) & (ang < 1.9)
        # horn tips
        m |= ell(cx + s * 0.03, cy + 0.215, 0.035, 0.05)
    # eyes, nose, tooth gaps cut out
    m &= ~ell(0.43, 0.60, 0.05, 0.055)
    m &= ~ell(0.57, 0.60, 0.05, 0.055)
    m &= ~(((np.abs(U - 0.5) < 0.03 * (V - 0.42) / 0.12) & (V > 0.42) & (V < 0.54)))
    for k in range(5):
        x = 0.44 + k * 0.03
        m &= ~((np.abs(U - x) < 0.006) & (V > 0.33) & (V < 0.39))
    img = np.zeros((h, w, 4), np.uint8)
    img[..., :3] = (m * 255).astype(np.uint8)[..., None]
    img[..., 3] = 255
    path = os.path.join(SCRATCH, f"{name}.png")
    write_png(path, img)
    bim = bpy.data.images.load(path)
    bim.colorspace_settings.name = "Non-Color"
    return bim


# ----------------------------------------------------------------------------------------
# Image helpers: render a frame, read it back, supersample down, glow, write PNG.
# ----------------------------------------------------------------------------------------

def write_png(path, rgba):
    """rgba: HxWx4 uint8 (top row first), straight alpha."""
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def read_exr(path):
    """Minimal reader for uncompressed scanline OpenEXR files (as written by Blender with
    codec NONE). Returns {channel name: HxW float32 array}, top row first."""
    with open(path, "rb") as f:
        data = f.read()
    assert data[:4] == b"\x76\x2f\x31\x01", "not an EXR"
    pos = 8

    def cstr():
        nonlocal pos
        e = data.index(b"\0", pos)
        s = data[pos:e]
        pos = e + 1
        return s

    attrs = {}
    while True:
        name = cstr()
        if name == b"":
            break
        typ = cstr()
        size = struct.unpack_from("<i", data, pos)[0]
        pos += 4
        attrs[name] = (typ, data[pos:pos + size])
        pos += size
    chl = attrs[b"channels"][1]
    chans = []
    p = 0
    while chl[p] != 0:
        e = chl.index(b"\0", p)
        nm = chl[p:e].decode()
        p = e + 1
        ptype = struct.unpack_from("<i", chl, p)[0]
        p += 16
        chans.append((nm, ptype))
    comp = attrs[b"compression"][1][0]
    assert comp == 0, f"EXR compression {comp} not supported (need NONE)"
    x0, y0, x1, y1 = struct.unpack_from("<iiii", attrs[b"dataWindow"][1])
    w, h = x1 - x0 + 1, y1 - y0 + 1
    pos += 8 * h  # offset table
    out = {nm: np.empty((h, w), np.float32) for nm, _ in chans}
    dt = {1: np.float16, 2: np.float32, 0: np.uint32}
    for _ in range(h):
        y, size = struct.unpack_from("<ii", data, pos)
        pos += 8
        for nm, ptype in chans:
            n = w * np.dtype(dt[ptype]).itemsize
            out[nm][y - y0] = np.frombuffer(data[pos:pos + n], dt[ptype]).astype(np.float32)
            pos += n
    return out


def render_frame(w, h, tag):
    """Render the current scene at ss x (w, h). Returns (colour, normal):
    colour = float HxWx4 premultiplied image (sRGB-encoded values) at the target size,
    normal = float HxWx3 camera-space normals (coverage-weighted, not yet normalised)."""
    sc = bpy.context.scene
    ss = ARGS["ss"]
    sc.render.resolution_x = w * ss
    sc.render.resolution_y = h * ss
    path = os.path.join(SCRATCH, f"{tag}.png")
    sc.render.filepath = path
    if os.path.exists(NORMAL_EXR):
        os.remove(NORMAL_EXR)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    buf = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    a = buf.reshape(h * ss, w * ss, 4)[::-1].copy()  # top row first
    # premultiply, box filter down
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4]
    pm = pm.reshape(h, ss, w, ss, 4).mean(axis=(1, 3))
    # normal pass (world space, scanlines top-first) -> camera space
    nrm = np.zeros((h, w, 3), np.float32)
    if os.path.exists(NORMAL_EXR):
        ch = read_exr(NORMAL_EXR)
        nw = np.stack([ch["Normal.R"], ch["Normal.G"], ch["Normal.B"]], axis=-1)
        if nw.shape[0] == h * ss and nw.shape[1] == w * ss:
            Ri = np.array(sc.camera.matrix_world.to_3x3().inverted(), np.float32)
            nc = nw @ Ri.T
            nrm = nc.reshape(h, ss, w, ss, 3).mean(axis=(1, 3))
    return pm, nrm


def encode_normals(nrm, alpha):
    """Camera-space normals (any length) + straight alpha (HxWx1 0..1) -> uint8 RGBA
    OpenGL-style normal map (flat = 128,128,255; transparent = 128,128,255,0)."""
    ln = np.linalg.norm(nrm, axis=2, keepdims=True)
    unit = np.where(ln > 0.08, nrm / np.maximum(ln, 1e-6), np.array([0.0, 0.0, 1.0], np.float32))
    # blend low-coverage / glow-only pixels towards flat so soft edges do not flicker
    k = np.clip((ln - 0.08) / 0.4, 0, 1)
    unit = unit * k + np.array([0.0, 0.0, 1.0], np.float32) * (1 - k)
    unit /= np.maximum(np.linalg.norm(unit, axis=2, keepdims=True), 1e-6)
    rgb = np.clip(unit * 0.5 + 0.5, 0, 1)
    out = np.zeros((*rgb.shape[:2], 4), np.uint8)
    out[..., :3] = (rgb * 255 + 0.5).astype(np.uint8)
    a8 = (np.clip(alpha[..., 0], 0, 1) * 255 + 0.5).astype(np.uint8)
    out[..., 3] = a8
    flat = a8 == 0
    out[flat, 0] = 128
    out[flat, 1] = 128
    out[flat, 2] = 255
    return out


def _gauss1d(sigma):
    r = max(1, int(sigma * 3))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    return k / k.sum()


def blur(img, sigma):
    k = _gauss1d(sigma)
    r = len(k) // 2
    out = np.zeros_like(img)
    pad = np.pad(img, ((r, r), (0, 0), (0, 0)), mode="constant")
    for i, kv in enumerate(k):
        out += kv * pad[i:i + img.shape[0]]
    pad = np.pad(out, ((0, 0), (r, r), (0, 0)), mode="constant")
    out = np.zeros_like(img)
    for i, kv in enumerate(k):
        out += kv * pad[:, i:i + img.shape[1]]
    return out


def add_glow(pm, threshold=0.75, sigma=3.0, strength=0.9, tint=None):
    """Bloom-like glow on a premultiplied image, extending into transparent pixels."""
    rgb = pm[..., :3]
    lum = rgb.max(axis=2, keepdims=True)
    hi = np.clip((lum - threshold) / max(1e-3, 1 - threshold), 0, 1)
    src = rgb * hi
    if tint is not None:
        src = src * 0.4 + hi * np.array(tint, np.float32) * 0.6
    g = blur(src, sigma) * strength
    g2 = blur(src, sigma * 2.5) * strength * 0.6
    glow = g + g2
    ga = glow.max(axis=2, keepdims=True)
    out = pm.copy()
    out[..., :3] = np.clip(out[..., :3] + glow, 0, 1)
    out[..., 3:4] = np.clip(out[..., 3:4] + ga * (1 - out[..., 3:4]), 0, 1)
    out[..., :3] = np.minimum(out[..., :3], out[..., 3:4])
    return out


def to_uint8(pm):
    """premultiplied float -> straight uint8 RGBA"""
    a = pm[..., 3:4]
    rgb = np.where(a > 1e-4, pm[..., :3] / np.maximum(a, 1e-4), 0.0)
    out = np.concatenate([np.clip(rgb, 0, 1), np.clip(a, 0, 1)], axis=2)
    return (out * 255 + 0.5).astype(np.uint8)


def contrast(pm, amount=1.0, gamma=1.0, saturation=1.0):
    """Small punch-up on the premultiplied image (operates on straight colour)."""
    a = np.maximum(pm[..., 3:4], 1e-4)
    rgb = np.clip(pm[..., :3] / a, 0, 1)
    if saturation != 1.0:
        l = rgb @ np.array([0.3, 0.59, 0.11], np.float32)
        rgb = np.clip(l[..., None] + (rgb - l[..., None]) * saturation, 0, 1)
    if gamma != 1.0:
        rgb = rgb ** gamma
    if amount != 1.0:
        rgb = np.clip((rgb - 0.5) * amount + 0.5, 0, 1)
    out = pm.copy()
    out[..., :3] = rgb * pm[..., 3:4]
    return out


# ----------------------------------------------------------------------------------------
# Asset builders. Each returns (objects, on_frame(i) or None, options dict)
# ----------------------------------------------------------------------------------------

def beast_head(loc, scale, mat, eye_mat, parent=None, y_dir=-1):
    """Small 3D horned beast-skull emblem lying in the XZ plane, raised towards -Y
    (y_dir=-1) or +Y. Returns the objects."""
    s = scale
    parts = []
    parts.append(sphere(0.28 * s, loc=loc, mat=mat, scale=(1.0, 0.3, 1.1), name="EmblemHead", segments=24, rings=12))
    parts.append(box((0.26 * s, 0.1 * s, 0.22 * s), loc=(loc[0], loc[1], loc[2] - 0.3 * s), mat=mat, bevel=0.02 * s, name="EmblemJaw"))
    for sx in (-1, 1):
        parts.append(horn((loc[0] + sx * 0.22 * s, loc[1], loc[2] + 0.16 * s), major=0.2 * s, minor=0.055 * s,
                          rot=(math.pi / 2, 0, 0), mat=mat, name="EmblemHorn", flip=sx < 0))
        parts.append(sphere(0.06 * s, loc=(loc[0] + sx * 0.1 * s, loc[1] + y_dir * 0.07 * s, loc[2] + 0.02 * s), mat=eye_mat, name="EmblemEye", segments=12, rings=8))
    if parent is not None:
        for p in parts:
            p.parent = parent
    return parts


def build_coin(M):
    ALL_OBJS.clear()
    # Coin body: reeded edge (96 tiny ridges), beveled rims; axis along Y so it faces
    # the camera; it spins about world Z.
    body = prism(star_profile(48, 1.0, 0.965), -0.1, 0.1, name="Coin", mat=M["gold"], bevel=0.05, bevel_segments=3, bevel_angle=75)
    body.rotation_euler = (math.pi / 2, 0, 0)
    for s in (1, -1):
        torus(0.84, 0.045, loc=(0, s * 0.1, 0), rot=(math.pi / 2, 0, 0), mat=M["gold"], name="Rim")
        # dark recessed field inside the rim reads as engraving at small size
        cyl(0.78, 0.014, loc=(0, s * 0.105, 0), rot=(math.pi / 2, 0, 0), mat=M["gold_dark"], verts=64, bevel=0, name="Field")
        # inner engraved ring
        torus(0.68, 0.02, loc=(0, s * 0.11, 0), rot=(math.pi / 2, 0, 0), mat=M["gold"], name="Ring", seg=48, ring=8)
        # raised beast emblem
        beast_head((0, s * 0.14, 0.02), 1.0, M["gold"], M["gold_dark"], y_dir=s)
        # four small studs around the emblem (compass points)
        for ang in (0.25, 0.75, 1.25, 1.75):
            a = ang * math.pi
            sphere(0.035, loc=(math.cos(a) * 0.56, s * 0.12, math.sin(a) * 0.56), mat=M["gold"], name="Stud", segments=12, rings=8)
    root = group(list(ALL_OBJS), "CoinRoot")

    def on_frame(i):
        root.rotation_euler = (0, 0, math.radians(180.0 * i / 12 + 8.0))

    return list(ALL_OBJS), on_frame, dict(key=7.0, fill=1.6, rim=8.0, az=0, el=16, margin=0.05)


def build_gem(M):
    ALL_OBJS.clear()
    # Faceted crystal: two rings of 8 vertices (offset by half a step) between two apexes,
    # triangulated so every facet is a flat triangle.
    n = 8
    ru, rl = 0.58, 0.74
    zu, zl = 0.42, -0.18
    verts = [(0, 0, 1.2)]
    for k in range(n):
        a = k / n * TAU
        verts.append((math.cos(a) * ru, math.sin(a) * ru, zu))
    for k in range(n):
        a = (k + 0.5) / n * TAU
        verts.append((math.cos(a) * rl, math.sin(a) * rl, zl))
    verts.append((0, 0, -1.1))
    bot = 1 + 2 * n
    faces = []
    for k in range(n):
        u0, u1 = 1 + k, 1 + (k + 1) % n
        l0, l1 = 1 + n + k, 1 + n + (k + 1) % n
        faces.append([0, u0, u1])
        faces.append([u0, l0, u1])
        faces.append([u1, l0, l1])
        faces.append([l0, bot, l1])
    gem = mesh_from_pydata("Gem", verts, faces, mat=mat_gem("GemMat", strength=0.5), smooth=False)
    # glowing core so light leaks through the transmission
    core = sphere(0.40, loc=(0, 0, 0.05), mat=mat_emissive("Core", (0.2, 1.0, 0.9), 2.0), scale=(1, 1, 1.5), name="Core", segments=16, rings=8)
    root = group([gem, core], "GemRoot")
    root.rotation_mode = "ZYX"  # spin about the gem's own axis first, then the fixed tilt

    def on_frame(i):
        root.rotation_euler = (math.radians(12), math.radians(6), math.radians(90.0 * i / 12 + 20))

    return list(ALL_OBJS), on_frame, dict(key=2.0, fill=0.8, rim=4.0, az=0, el=14, margin=0.1, view="Standard", exposure=-0.4,
                                          glow=dict(threshold=0.55, sigma=2.5, strength=0.8, tint=(0.45, 0.7, 1.0)))


def build_potion(M, color):
    ALL_OBJS.clear()
    if color == "red":
        liq_col, glow = (0.65, 0.01, 0.02), (1.0, 0.08, 0.04)
    else:
        liq_col, glow = (0.05, 0.55, 0.03), (0.25, 1.0, 0.1)
    glass = M["glass"]
    sphere(1.0, loc=(0, 0, 1.0), mat=glass, name="Bulb", scale=(1.0, 1.0, 0.96))
    cyl(0.36, 1.2, loc=(0, 0, 2.2), mat=glass, bevel=0.0, name="Neck")
    torus(0.38, 0.09, loc=(0, 0, 2.75), mat=glass, name="Lip")
    cyl(0.3, 0.55, loc=(0, 0, 2.95), mat=M["cork"], bevel=0.06, name="Cork")
    torus(0.31, 0.02, loc=(0, 0, 2.95), mat=M["rope"], name="CorkTwine", seg=24, ring=6)
    # liquid: inner sphere cut at the fill level, meniscus ring climbing the glass
    lm = mat_liquid("Liquid", liq_col, glow, 0.9)
    liq = sphere(0.93, loc=(0, 0, 1.0), mat=lm, name="Liquid")
    bisect(liq, (0, 0, 1.52), (0, 0, 1))
    r_lvl = math.sqrt(max(0.0, 0.93 ** 2 - 0.52 ** 2))
    torus(r_lvl - 0.03, 0.045, loc=(0, 0, 1.56), mat=mat_liquid("Meniscus", liq_col, glow, 1.6), name="Meniscus", seg=40, ring=8)
    # bubbles: small bright spheres rising through the liquid
    rng = np.random.RandomState(11 if color == "red" else 12)
    bm = mat_liquid("Bubble", tuple(min(1, c * 1.8 + 0.15) for c in liq_col), glow, 1.4)
    for k in range(7):
        a = rng.uniform(0, TAU)
        r = rng.uniform(0.1, 0.6)
        z = rng.uniform(0.45, 1.4)
        sphere(rng.uniform(0.035, 0.075), loc=(math.cos(a) * r, math.sin(a) * r, z), mat=bm, name="Bubble", segments=12, rings=8)
    # glass highlights: a bright blob and a long streak on the front-left of the bulb
    sphere(0.13, loc=(-0.45, -0.6, 1.5), mat=mat_emissive("Spark", (1, 1, 1), 1.2), name="Spark")
    sphere(0.05, loc=(-0.62, -0.68, 0.95), mat=mat_emissive("Spark2", (1, 1, 1), 1.0), scale=(1, 1, 7), name="Streak")
    return list(ALL_OBJS), None, dict(key=4.5, fill=1.6, rim=6.0, az=10, el=12, margin=0.06,
                                      glow=dict(threshold=0.65, sigma=2.0, strength=0.7, tint=glow))


def build_chest(M):
    ALL_OBJS.clear()
    W, D, H = 2.2, 1.3, 1.1
    iron = M["iron"]
    # body: four horizontal planks with seams
    np_ = 4
    ph = (H - 0.015 * (np_ - 1)) / np_
    for k in range(np_):
        box((W, D, ph), loc=(0, 0, ph / 2 + k * (ph + 0.015)), mat=M["wood"], bevel=0.02, name="Plank")
    # dark interior cavity (visible when open)
    box((W - 0.2, D - 0.2, H - 0.12), loc=(0, 0, H / 2), mat=M["wood_dark"], bevel=0.0, name="Inner")
    # iron bands, corner plates, studs
    for x in (-0.72, 0.72):
        box((0.18, D + 0.04, H + 0.02), loc=(x, 0, H / 2), mat=iron, bevel=0.02, name="Band")
        for z in (0.22, 0.55, 0.88):
            sphere(0.04, loc=(x, -D / 2 - 0.035, z), mat=iron, name="Stud", segments=12, rings=8)
    box((W + 0.04, D + 0.04, 0.12), loc=(0, 0, 0.08), mat=M["iron_dark"], bevel=0.02, name="Foot")
    box((W + 0.04, D + 0.04, 0.1), loc=(0, 0, H - 0.05), mat=iron, bevel=0.02, name="TopBand")
    for x in (-1.0, -0.35, 0.35, 1.0):
        sphere(0.04, loc=(x, -D / 2 - 0.035, H - 0.05), mat=iron, name="Stud", segments=12, rings=8)
    for sx in (-1, 1):
        for z in (0.2, H - 0.22):
            box((0.14, 0.14, 0.3), loc=(sx * (W / 2 - 0.02), -D / 2 + 0.02, z), mat=M["iron_dark"], bevel=0.02, name="Corner")
        # side carry rings
        torus(0.16, 0.03, loc=(sx * (W / 2 + 0.04), 0, H * 0.55), rot=(0, math.pi / 2, 0), mat=iron, name="Handle", seg=24, ring=8)
    # lid: five curved planks around the hinge axis, iron bands with studs, hinged at the back top edge
    lid_parts = []
    R = D / 2
    na = 5
    gap = 0.025
    for k in range(na):
        a0 = k / na * math.pi + gap
        a1 = (k + 1) / na * math.pi - gap
        prof = [(R * math.cos(a), R * math.sin(a)) for a in np.linspace(a0, a1, 7)]
        prof += [((R - 0.12) * math.cos(a), (R - 0.12) * math.sin(a)) for a in np.linspace(a1, a0, 7)]
        lid_parts.append(extrude_x(prof, -W / 2, W / 2, name="LidPlank", mat=M["wood"], bevel=0.015, smooth=False))
    for x in (-0.72, 0.72):
        b = cyl(R + 0.035, 0.18, loc=(x, 0, 0), rot=(0, math.pi / 2, 0), mat=iron, verts=32, bevel=0.0, name="LidBand")
        bisect(b, (0, 0, -0.02), (0, 0, 1), clear_outer=False)
        lid_parts.append(b)
        for a in (0.35, 0.8, 1.25, 1.7):
            lid_parts.append(sphere(0.04, loc=(x, math.cos(a) * (R + 0.05), math.sin(a) * (R + 0.05)), mat=iron, name="Stud", segments=12, rings=8))
    lb = cyl(R + 0.03, W + 0.04, rot=(0, math.pi / 2, 0), mat=iron, verts=32, bevel=0.0, name="LidEdge")
    bisect(lb, (0, 0, 0.0), (0, 0, 1), clear_outer=False)
    bisect(lb, (0, 0, 0.1), (0, 0, 1), clear_outer=True)
    lid_parts.append(lb)
    # hinge knuckles at the back
    for x in (-0.6, 0.0, 0.6):
        lid_parts.append(cyl(0.06, 0.3, loc=(x, R, 0), rot=(0, math.pi / 2, 0), mat=M["iron_dark"], verts=12, bevel=0.0, name="Hinge"))
    # hasp on the lid front
    lid_parts.append(box((0.3, 0.08, 0.38), loc=(0, -R - 0.03, -0.08), mat=iron, bevel=0.02, name="Hasp"))
    lid_root = bpy.data.objects.new("LidRoot", None)
    bpy.context.scene.collection.objects.link(lid_root)
    for p in lid_parts:
        p.parent = lid_root
    lid_root.location = (0, R, H)  # hinge at back top edge
    for p in lid_parts:
        p.location = (p.location.x, p.location.y - R, p.location.z)
    # lock plate and padlock on the body
    box((0.4, 0.06, 0.34), loc=(0, -D / 2 - 0.03, H - 0.27), mat=M["gold"], bevel=0.02, name="LockPlate")
    sphere(0.04, loc=(0, -D / 2 - 0.07, H - 0.25), mat=M["black"], scale=(1, 0.5, 1.4), name="Keyhole")
    box((0.26, 0.12, 0.22), loc=(0, -D / 2 - 0.12, H - 0.5), mat=M["iron_dark"], bevel=0.03, name="Padlock")
    sh = torus(0.085, 0.025, loc=(0, -D / 2 - 0.12, H - 0.39), rot=(math.pi / 2, 0, 0), mat=iron, name="Shackle", seg=20, ring=8)
    bisect(sh, (0, 0, H - 0.4), (0, 0, 1), clear_outer=False, fill=False)
    # treasure inside (only visible when open)
    gl = mat_emissive("Treasure", (1.0, 0.75, 0.3), 6.0)
    treasure = [box((W - 0.3, D - 0.3, 0.08), loc=(0, 0, H - 0.12), mat=gl, bevel=0.0, name="GlowPlane")]
    rng = np.random.RandomState(3)
    for k in range(12):
        x = rng.uniform(-0.75, 0.75)
        y = rng.uniform(-0.3, 0.3)
        treasure.append(cyl(0.15, 0.05, loc=(x, y, H - 0.06 + k * 0.012), rot=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0),
                            mat=M["gold"], verts=24, bevel=0.01, name="Coin"))
    gem_mat = mat_emissive("GemLoot", (0.45, 0.2, 1.0), 4.0)
    for (x, y) in ((-0.45, 0.05), (0.3, -0.1), (0.6, 0.2)):
        verts = [(0.1, 0, 0), (0, 0.1, 0), (-0.1, 0, 0), (0, -0.1, 0), (0, 0, 0.16), (0, 0, -0.1)]
        faces = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [1, 0, 5], [2, 1, 5], [3, 2, 5], [0, 3, 5]]
        treasure.append(mesh_from_pydata("LootGem", verts, faces, mat=gem_mat, loc=(x, y, H + 0.1)))
    light = add_light("ChestGlow", "POINT", location=(0, 0, H + 0.4), color=(1.0, 0.7, 0.3), energy=60, size=0.4)

    def on_frame(i):
        open_ = i == 1
        lid_root.rotation_euler = (math.radians(-112) if open_ else 0, 0, 0)
        for t in treasure:
            t.hide_render = not open_
        light.hide_render = not open_
        light.data.energy = 60 if open_ else 0

    return list(ALL_OBJS), on_frame, dict(key=4.5, fill=1.5, rim=5.0, az=22, el=28, pad=(0.08, 0.08, 0.04, 0.06),
                                          glow=dict(threshold=0.8, sigma=2.5, strength=0.6, tint=(1.0, 0.7, 0.3)))


def build_shrine(M):
    ALL_OBJS.clear()
    stone = M["stone"]
    s1 = box((2.6, 2.6, 0.35), loc=(0, 0, 0.175), mat=M["stone_dark"], bevel=0.04, name="Step1")
    chip = box((0.6, 0.6, 0.5), loc=(1.3, -1.3, 0.45), rot=(0.3, 0.4, 0.6), mat=stone, bevel=0.0, name="Chip")
    boolean_cut(s1, chip)
    box((2.0, 2.0, 0.35), loc=(0, 0, 0.5), mat=stone, bevel=0.04, name="Step2")
    frustum(0.75, 0.5, 0.65, 4.6, name="Obelisk", mat=stone, bevel=0.05)
    frustum(0.5, 0.08, 4.6, 5.4, name="Tip", mat=stone, bevel=0.03)
    # ornamental collar near the top and a carved base band
    frustum(0.62, 0.58, 4.2, 4.45, name="Collar", mat=M["stone_dark"], bevel=0.03)
    frustum(0.84, 0.80, 0.65, 0.95, name="BaseBand", mat=M["stone_dark"], bevel=0.03)
    # small skull set into the base band, front
    sk = sphere(0.14, loc=(0, -0.84, 0.82), mat=M["bone"], scale=(1, 0.8, 1), name="BaseSkull", segments=16, rings=10)
    for x in (-0.05, 0.05):
        sphere(0.035, loc=(x, -0.95, 0.83), mat=M["black"], name="SkullEye", segments=8, rings=6)
    # rune glyphs carved into the front face (front = -Y). Face slope: half-width 0.75 -> 0.5 over z 0.65..4.6
    def hw(z):
        return 0.75 + (0.5 - 0.75) * (z - 0.65) / (4.6 - 0.65)

    rune_mat = mat_emissive("Rune", (0.2, 0.95, 0.85), 1.0)
    tilt = -math.atan2(0.25, 3.95)
    face = bpy.data.objects.new("FaceRoot", None)
    bpy.context.scene.collection.objects.link(face)
    face.location = (0, -hw(2.6) + 0.0, 2.6)
    face.rotation_euler = (tilt, 0, 0)
    rune_parts = []
    for name, z in (("algiz", 3.05), ("othala", 2.35), ("thurs", 1.7), ("tiwaz", 1.1)):
        # local z relative to the face root (which sits at z=2.6 on the face)
        rune_parts += glyph(RUNES[name], face, 0.0, z - 2.6 - 0.25, 0.5, rune_mat, width=0.065, depth=0.05)
    d = box((0.36, 0.06, 0.36), loc=(0, -hw(3.7), 3.7), rot=(tilt, 0, math.pi / 4), mat=rune_mat, bevel=0.0, name="RuneEye")
    rune_parts.append(d)
    sphere(0.075, loc=(0, -hw(3.7) - 0.02, 3.7), mat=M["black"], scale=(1, 0.5, 1), name="EyePupil", segments=12, rings=8)
    # carved vertical grooves along the front edges
    for sx in (-1, 1):
        g = box((0.05, 0.06, 3.4), loc=(sx * 0.46, -hw(2.6), 2.6), rot=(tilt, 0, 0), mat=M["stone_dark"], bevel=0.0, name="Groove")
        g.rotation_euler = (tilt, -sx * 0.038, 0)
    # crystal on top
    verts = [(0.18, 0, 0), (0, 0.18, 0), (-0.18, 0, 0), (0, -0.18, 0), (0, 0, 0.45), (0, 0, -0.3)]
    faces = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [1, 0, 5], [2, 1, 5], [3, 2, 5], [0, 3, 5]]
    crystal = mesh_from_pydata("Crystal", verts, faces, mat=rune_mat, loc=(0, 0, 5.65))
    rune_parts.append(crystal)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        cl = box((0.05, 0.05, 0.4), loc=(math.cos(a) * 0.12, math.sin(a) * 0.12, 5.45), rot=(-math.sin(a) * 0.35, math.cos(a) * 0.35, 0), mat=M["iron"], bevel=0.0, name="Claw")
    light = add_light("RuneGlow", "POINT", location=(0, -1.6, 3.0), color=(0.2, 0.95, 0.85), energy=250, size=0.6)

    def on_frame(i):
        lit = i == 1
        p = rune_mat.node_tree.nodes["Principled BSDF"]
        p.inputs["Emission Strength"].default_value = 4.0 if lit else 0.6
        p.inputs["Emission Color"].default_value = (0.2, 0.95, 0.85, 1) if lit else (0.04, 0.07, 0.08, 1)
        light.hide_render = not lit
        light.data.energy = 110 if lit else 0

    return list(ALL_OBJS), on_frame, dict(key=3.5, fill=1.6, rim=6.0, az=20, el=12, pad=(0.08, 0.08, 0.02, 0.06),
                                          glow=dict(threshold=0.75, sigma=3.0, strength=0.55, tint=(0.2, 0.95, 0.85)))


def build_skull(M):
    ALL_OBJS.clear()
    bone = M["bone"]
    cran = sphere(1.0, loc=(0, 0, 1.05), mat=bone, scale=(0.95, 1.1, 1.0), segments=48, rings=24, name="Cranium")
    # cheek / upper jaw block
    jaw_u = box((1.1, 0.9, 0.55), loc=(0, -0.45, 0.45), mat=bone, bevel=0.15, name="UpperJaw")
    jaw_u.modifiers["Bevel"].segments = 4
    # eye sockets and nose cut out with a dark material
    for x in (-0.36, 0.36):
        c = sphere(0.33, loc=(x, -0.78, 0.98), mat=M["black"], scale=(1.0, 0.8, 1.15), name="SocketCut")
        boolean_cut(cran, c)
    nose = cone(0.16, 0.02, 0.5, loc=(0, -0.95, 0.62), rot=(math.radians(-70), 0, 0), mat=M["black"], verts=8)
    boolean_cut(jaw_u, nose)
    # a hole smashed into the right side of the cranium
    hole = sphere(0.3, loc=(0.75, -0.1, 1.5), mat=M["black"], name="HoleCut", scale=(1, 1.2, 0.8))
    boolean_cut(cran, hole)
    # cheekbones
    for x in (-0.55, 0.55):
        sphere(0.2, loc=(x, -0.55, 0.62), mat=bone, scale=(1.0, 0.9, 0.7), name="Cheek", segments=16, rings=10)
    # teeth (one missing)
    for k in range(6):
        if k == 2:
            continue
        x = -0.4 + k * 0.16
        box((0.12, 0.14, 0.2), loc=(x, -0.86, 0.12), mat=bone, bevel=0.02, name="Tooth")
    # lower jaw
    box((1.05, 0.8, 0.22), loc=(0, -0.35, -0.06), mat=M["bone"], bevel=0.06, name="LowerJaw")
    for k in range(5):
        x = -0.32 + k * 0.16
        box((0.12, 0.14, 0.16), loc=(x, -0.82, 0.03), mat=bone, bevel=0.02, name="Tooth")
    # tilt a little for character
    root = group(list(ALL_OBJS), "SkullRoot")
    root.rotation_euler = (math.radians(-6), math.radians(8), math.radians(-18))
    return list(ALL_OBJS), None, dict(key=4.5, fill=1.4, rim=5.0, az=15, el=18, margin=0.06)


def build_gravestone(M, kind):
    ALL_OBJS.clear()
    stone = M["stone"]
    if kind == 1:
        # rounded-top slab with a carved cross and chipped shoulder
        w, d, h = 1.5, 0.3, 1.9
        prof = [(-w / 2, 0.0), (w / 2, 0.0)]
        for k in range(25):  # semicircular top, right to left
            a = math.pi * k / 24
            prof.append((math.cos(a) * w / 2, h + math.sin(a) * w / 2))
        slab = prism(prof, -d / 2, d / 2, name="Slab", mat=stone, bevel=0.05, rot=(math.pi / 2, 0, 0))
        chip = box((0.5, 0.8, 0.5), loc=(-0.7, 0, 2.45), rot=(0.2, math.radians(-35), 0.3), mat=stone, bevel=0.0, name="Chip")
        boolean_cut(slab, chip)
        box((0.18, 0.08, 1.1), loc=(0, -d / 2, 1.35), mat=M["stone_dark"], bevel=0.0, name="CrossV")
        box((0.7, 0.1, 0.18), loc=(0, -d / 2, 1.65), mat=M["stone_dark"], bevel=0.0, name="CrossH")
        for z in (0.55, 0.4):
            box((0.8, 0.06, 0.05), loc=(0, -d / 2, z), mat=M["stone_dark"], bevel=0.0, name="Line")
        box((w + 0.5, d + 0.5, 0.25), loc=(0, 0.05, 0.12), mat=M["stone_dark"], bevel=0.05, name="Base")
        root = group(list(ALL_OBJS))
        root.rotation_euler = (0, math.radians(-4), 0)
        opts = dict(az=18, el=14)
    elif kind == 2:
        # stone cross on a plinth
        box((1.3, 1.0, 0.3), loc=(0, 0, 0.15), mat=M["stone_dark"], bevel=0.04, name="Plinth")
        box((0.9, 0.7, 0.3), loc=(0, 0, 0.42), mat=stone, bevel=0.04, name="Plinth2")
        box((0.42, 0.34, 2.4), loc=(0, 0, 1.75), mat=stone, bevel=0.05, name="CrossV")
        box((1.35, 0.38, 0.42), loc=(0, 0, 2.3), mat=stone, bevel=0.05, name="CrossH")
        # chipped arm: cut the end of the right arm with a tilted box
        cutter = box((0.5, 0.8, 0.8), loc=(0.78, 0, 2.62), rot=(0, math.radians(30), 0), mat=M["stone"], bevel=0.0, name="Chip")
        boolean_cut(ALL_OBJS[-2], cutter)
        torus(0.42, 0.05, loc=(0, 0, 2.3), rot=(math.pi / 2, 0, 0), mat=M["stone_dark"], name="Halo", seg=32, ring=8)
        root = group(list(ALL_OBJS))
        root.rotation_euler = (0, math.radians(3), 0)
        opts = dict(az=22, el=14)
    else:
        # tilted slab with broken corner
        w, d, h = 1.35, 0.26, 2.1
        slab = box((w, d, h), loc=(0, 0, h / 2), mat=stone, bevel=0.05, name="Slab")
        cutter = box((1.2, 1.0, 1.2), loc=(0.85, 0, 2.3), rot=(0, math.radians(35), 0), mat=stone, bevel=0.0, name="Break")
        boolean_cut(slab, cutter)
        # engraved lines
        for z in (1.45, 1.2, 0.95):
            box((0.7, 0.06, 0.07), loc=(-0.05, -d / 2, z), mat=M["stone_dark"], bevel=0.0, name="Line")
        box((w + 0.4, d + 0.4, 0.22), loc=(0, 0, 0.11), mat=M["stone_dark"], bevel=0.04, name="Base")
        # the broken-off corner lying on the ground
        box((0.5, 0.3, 0.35), loc=(0.95, -0.3, 0.38), rot=(0.2, 0.5, 0.4), mat=stone, bevel=0.04, name="Shard")
        root = group(list(ALL_OBJS))
        root.rotation_euler = (0, math.radians(13), 0)
        opts = dict(az=14, el=14)
    opts.update(key=3.5, fill=1.6, rim=6.0, pad=(0.06, 0.06, 0.02, 0.06))
    return list(ALL_OBJS), None, opts


def build_torch(M):
    ALL_OBJS.clear()
    iron = M["iron"]
    plate_mat = mat_iron("PlateSoot", dark=(0.05, 0.05, 0.06), light=(0.18, 0.17, 0.18), rust=0.5, paint=(0.06, 0.07, 0.06), chips=0.5, soot_z=(0.1, 0.85))
    # wall plate (wall is behind, +Y)
    box((0.7, 0.12, 1.3), loc=(0, 0.56, 0.2), mat=plate_mat, bevel=0.03, name="Plate")
    for z in (-0.3, 0.7):
        sphere(0.07, loc=(0, 0.48, z), mat=iron, name="Rivet")
    # bracket arm: angled bar from plate to ring, with a scroll curl
    cyl(0.06, 0.75, loc=(0, 0.22, 0.05), rot=(math.radians(60), 0, 0), mat=iron, verts=12, bevel=0.0, name="Arm")
    cyl(0.06, 0.5, loc=(0, 0.3, -0.15), rot=(math.radians(-50), 0, 0), mat=iron, verts=12, bevel=0.0, name="Brace")
    sc = torus(0.1, 0.04, loc=(0, 0.3, -0.42), rot=(0, math.pi / 2, 0), mat=iron, name="Scroll", seg=16, ring=8)
    torus(0.3, 0.06, loc=(0, -0.1, 0.3), mat=iron, name="Ring", seg=32, ring=10)
    torus(0.3, 0.05, loc=(0, -0.1, -0.1), mat=iron, name="Ring2", seg=32, ring=10)
    # torch stick with wrapped rag head, charred on top
    cyl(0.2, 2.0, loc=(0, -0.1, 0.9), mat=M["wood_dark"], verts=16, bevel=0.03, name="Stick")
    rag_mat = mat_cloth("RagSoot", col_a=(0.14, 0.10, 0.07), col_b=(0.05, 0.035, 0.03), fade=0.0)
    cyl(0.28, 0.5, loc=(0, -0.1, 1.85), mat=rag_mat, verts=16, bevel=0.05, name="Rag")
    cyl(0.29, 0.12, loc=(0, -0.1, 2.08), mat=mat_ember("Char", glow=(1.0, 0.35, 0.05), strength=2.5, scale=10.0), verts=16, bevel=0.03, name="Char")
    for z in (1.68, 1.98):
        torus(0.28, 0.035, loc=(0, -0.1, z), mat=M["rope"], name="Twine", seg=24, ring=8)
    # embers at the top (no flame, but a warm hint)
    sphere(0.1, loc=(0, -0.1, 2.14), mat=mat_emissive("Ember", (1.0, 0.35, 0.05), 2.0), scale=(1.6, 1.6, 0.5), name="Ember")
    return list(ALL_OBJS), None, dict(key=4.5, fill=1.6, rim=5.0, az=12, el=12, margin=0.05,
                                      glow=dict(threshold=0.8, sigma=1.5, strength=0.4, tint=(1.0, 0.45, 0.1)))


def fluted_profile(n=96, r=0.9, flutes=14, depth=0.07):
    prof = []
    for i in range(n):
        t = i / n * TAU
        rr = r - depth * max(0.0, math.cos(flutes * t)) ** 0.7
        prof.append((math.cos(t) * rr, math.sin(t) * rr))
    return prof


def build_pillar(M):
    ALL_OBJS.clear()
    stone = M["stone"]
    rng = np.random.RandomState(7)
    box((2.6, 2.6, 0.5), loc=(0, 0, 0.25), mat=M["stone_dark"], bevel=0.05, name="Plinth")
    box((2.1, 2.1, 0.4), loc=(0, 0, 0.7), mat=stone, bevel=0.05, name="Plinth2")
    torus(0.95, 0.2, loc=(0, 0, 1.0), mat=stone, name="Torus")
    # carved arcading band around the base of the shaft
    for k in range(12):
        a = k / 12 * TAU
        x, y = math.cos(a) * 0.92, math.sin(a) * 0.92
        box((0.2, 0.1, 0.42), loc=(x, y, 1.42), rot=(0, 0, a), mat=M["stone_dark"], bevel=0.01, name="Arch")
        sphere(0.1, loc=(x, y, 1.64), mat=M["stone_dark"], scale=(1, 0.5, 1.6), rot=(0, 0, a), name="ArchTop", segments=12, rings=8)
    torus(0.93, 0.07, loc=(0, 0, 1.85), mat=stone, name="Astragal", seg=48, ring=8)
    # fluted shaft with a jagged broken top
    prof = fluted_profile()
    n = len(prof)
    verts = [(x, y, 1.0) for x, y in prof]
    top = []
    tops = []
    for i, (x, y) in enumerate(prof):
        t = i / n * TAU
        z = 6.6 + 0.9 * math.sin(t * 2 + 0.6) + 0.45 * math.sin(t * 5 + 2.0) + 0.2 * math.sin(t * 11)
        top.append((x, y, z))
        tops.append(z)
    verts += top
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces.append(list(range(n))[::-1])
    faces.append(list(range(n, 2 * n)))
    shaft = mesh_from_pydata("Shaft", verts, faces, mat=stone, smooth=False)
    # extra broken ridge: a slanted cap to make the break read as a jagged face
    cap = cone(1.0, 0.0, 1.2, loc=(0.15, 0.1, 6.9), rot=(math.radians(14), math.radians(-18), 0), mat=M["stone_dark"], verts=9, smooth=False)
    # a deep crack down the shaft
    crack = box((0.05, 0.5, 2.2), loc=(-0.55, -0.85, 4.2), rot=(0, math.radians(6), math.radians(25)), mat=M["stone_dark"], bevel=0.0, name="Crack")
    boolean_cut(shaft, crack)
    # rubble sitting on the broken top
    for k in range(4):
        ang = rng.uniform(0, TAU)
        rad = rng.uniform(0.1, 0.55)
        s = rng.uniform(0.2, 0.38)
        zt = 6.6 + 0.9 * math.sin(ang * 2 + 0.6) * rad + 0.5
        box((s, s * 0.8, s * 0.6), loc=(math.cos(ang) * rad, math.sin(ang) * rad, zt + s * 0.2),
            rot=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, 3)), mat=stone, bevel=0.03, name="TopRubble")
    # rubble at the base
    for k in range(7):
        ang = rng.uniform(0, TAU)
        rad = rng.uniform(1.2, 1.75)
        s = rng.uniform(0.25, 0.5)
        box((s, s * 0.8, s * 0.7), loc=(math.cos(ang) * rad, math.sin(ang) * rad * 0.6 - 0.3, 0.5 + s * 0.35),
            rot=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, 3)), mat=stone, bevel=0.04, name="Rubble")
    # a fallen fluted drum fragment
    drum = prism(fluted_profile(48, 0.5, 10, 0.05), -0.3, 0.3, name="Drum", mat=stone, bevel=0.02, rot=(math.radians(80), 0, math.radians(30)), loc=(1.35, -0.6, 0.78))
    return list(ALL_OBJS), None, dict(key=3.5, fill=1.6, rim=6.0, az=16, el=10, pad=(0.05, 0.05, 0.02, 0.04))


def build_cage(M):
    ALL_OBJS.clear()
    iron = M["iron_rusty"]
    R = 1.0
    # floor plate and rings
    cyl(R, 0.1, loc=(0, 0, 0.0), mat=M["iron_dark"], verts=32, bevel=0.02, name="Floor")
    for z in (0.08, 1.3, 2.5, 3.6):
        torus(R, 0.06, loc=(0, 0, z), mat=iron, name="Ring", seg=40, ring=10)
        for k in range(10):
            t = k / 10 * TAU + 0.314
            sphere(0.05, loc=(math.cos(t) * (R + 0.04), math.sin(t) * (R + 0.04), z), mat=iron, name="Rivet", segments=10, rings=6)
    # vertical bars
    nb_ = 10
    for k in range(nb_):
        t = k / nb_ * TAU
        cyl(0.045, 3.65, loc=(math.cos(t) * R, math.sin(t) * R, 1.85), mat=iron, verts=8, bevel=0.0, name="Bar")
    # one bar bent outwards
    bent = cyl(0.045, 1.2, loc=(math.cos(-1.1) * R + 0.12, math.sin(-1.1) * R - 0.15, 1.9), rot=(math.radians(-14), math.radians(8), 0), mat=iron, verts=8, bevel=0.0, name="BentBar")
    # dome ribs
    for k in range(nb_ // 2):
        t = k / (nb_ / 2) * math.pi
        rib = torus(1.0, 0.045, loc=(0, 0, 3.6), rot=(math.pi / 2, 0, t), mat=iron, name="Rib", seg=40, ring=8)
        bisect(rib, (0, 0, 3.6), (0, 0, 1), clear_outer=False, fill=False)
    torus(0.5, 0.05, loc=(0, 0, 4.45), mat=iron, name="DomeRing", seg=32, ring=8)
    # finial, swivel hook and chain
    sphere(0.14, loc=(0, 0, 4.62), mat=iron, name="Finial")
    torus(0.16, 0.035, loc=(0, 0, 4.85), rot=(math.pi / 2, 0, 0), mat=iron, name="Link", seg=20, ring=8)
    chain((0, 0, 5.0), (0, 0, 7.2), 7, mat=iron)
    # short chain and a shackle dangling below the floor
    chain((0.6, -0.5, -0.05), (0.75, -0.7, -0.75), 3, link=0.12, thick=0.028, mat=iron, name="Dangle")
    # skeleton, slumped against the bars
    bone = M["bone"]
    sk = sphere(0.36, loc=(0.1, -0.15, 2.95), mat=bone, scale=(0.9, 1.0, 1.0), name="Skull")
    for x in (-0.12, 0.14):
        c = sphere(0.12, loc=(0.1 + x, -0.45, 2.98), mat=M["black"], name="Socket")
        boolean_cut(sk, c)
    box((0.32, 0.26, 0.14), loc=(0.1, -0.22, 2.6), mat=bone, bevel=0.03, name="Jaw")
    cyl(0.06, 1.1, loc=(0.0, 0.0, 2.05), rot=(math.radians(8), math.radians(5), 0), mat=bone, verts=8, bevel=0.0, name="Spine")
    for k in range(5):
        z = 2.5 - k * 0.14
        torus(0.34 - k * 0.02, 0.035, loc=(0.0, -0.05, z), rot=(math.radians(10), 0, 0), mat=bone, scale=(1, 0.75, 1), name="Rib", seg=24, ring=6)
    box((0.5, 0.3, 0.3), loc=(0.0, 0.0, 1.45), mat=bone, bevel=0.08, name="Pelvis")
    # tattered loincloth
    cyl(0.33, 0.45, loc=(0, 0, 1.25), mat=M["cloth"], verts=12, bevel=0.0, name="Rag", scale=(1, 0.8, 1))
    # arms hanging, legs folded
    cyl(0.05, 0.9, loc=(0.42, -0.1, 2.0), rot=(0, math.radians(8), 0), mat=bone, verts=8, bevel=0.0, name="ArmR")
    cyl(0.05, 0.9, loc=(-0.4, -0.05, 1.95), rot=(0, math.radians(-6), 0), mat=bone, verts=8, bevel=0.0, name="ArmL")
    for x in (0.46, -0.44):
        sphere(0.07, loc=(x, -0.08, 1.52), mat=bone, scale=(1, 1, 0.7), name="Hand", segments=10, rings=6)
        torus(0.1, 0.03, loc=(x, -0.08, 1.62), mat=iron, name="Manacle", seg=16, ring=6)
    cyl(0.065, 1.1, loc=(0.2, -0.35, 0.85), rot=(math.radians(-25), math.radians(10), 0), mat=bone, verts=8, bevel=0.0, name="LegR")
    cyl(0.065, 1.1, loc=(-0.22, -0.3, 0.8), rot=(math.radians(-25), math.radians(-12), 0), mat=bone, verts=8, bevel=0.0, name="LegL")
    cyl(0.055, 0.9, loc=(0.35, -0.75, 0.3), rot=(math.radians(-80), 0, math.radians(20)), mat=bone, verts=8, bevel=0.0, name="ShinR")
    cyl(0.055, 0.9, loc=(-0.3, -0.7, 0.3), rot=(math.radians(-80), 0, math.radians(-20)), mat=bone, verts=8, bevel=0.0, name="ShinL")
    return list(ALL_OBJS), None, dict(key=5.0, fill=1.8, rim=6.0, az=18, el=10, pad=(0.05, 0.05, 0.03, 0.02))


def build_brazier(M):
    ALL_OBJS.clear()
    iron = M["iron_rusty"]
    dark = M["iron_dark"]
    zc, rb = 2.05, 0.95
    bowl = sphere(rb, loc=(0, 0, zc), mat=dark, name="Bowl", segments=48, rings=24)
    bisect(bowl, (0, 0, zc + 0.22), (0, 0, 1), clear_outer=True, fill=False)
    inner = sphere(rb - 0.08, loc=(0, 0, zc + 0.02), mat=M["iron"], name="BowlInner", segments=48, rings=24)
    bisect(inner, (0, 0, zc + 0.22), (0, 0, 1), clear_outer=True, fill=False)
    torus(rb * 0.975, 0.07, loc=(0, 0, zc + 0.22), mat=iron, name="Rim", seg=48, ring=10)
    for k in range(12):
        a = k / 12 * TAU
        sphere(0.045, loc=(math.cos(a) * (rb + 0.02), math.sin(a) * (rb + 0.02), zc + 0.1), mat=iron, name="Rivet", segments=10, rings=6)
    # straps around the bowl
    for a in (0.0, TAU / 3, 2 * TAU / 3):
        s = torus(rb + 0.015, 0.035, loc=(0, 0, zc), rot=(math.pi / 2, 0, a + math.pi / 2), mat=iron, name="Strap", seg=40, ring=8, scale=(1, 1, 1))
        bisect(s, (0, 0, zc + 0.1), (0, 0, 1), clear_outer=True, fill=False)
    # coals
    rng = np.random.RandomState(5)
    ember = mat_ember("Coal", strength=1.6, scale=5.0)
    for k in range(14):
        a = rng.uniform(0, TAU)
        r = rng.uniform(0, 0.62)
        z = zc + 0.05 + 0.25 * (1 - r / 0.7) + rng.uniform(-0.05, 0.1)
        sphere(rng.uniform(0.14, 0.24), loc=(math.cos(a) * r, math.sin(a) * r, z), mat=ember, scale=(1, 0.9, 0.7),
               rot=(rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0, 3)), name="Coal", segments=12, rings=8)
    # tripod legs with claw feet, a brace ring, and a collar under the bowl
    top = Vector((0, 0, zc - 0.55))
    torus(0.42, 0.06, loc=(0, 0, zc - 0.6), mat=iron, name="Collar", seg=32, ring=8)
    feet = []
    for k in range(3):
        a = math.pi / 2 + k * TAU / 3 + math.pi / 3
        foot = Vector((math.cos(a) * 1.0, math.sin(a) * 1.0, 0.08))
        rod(top + Vector((math.cos(a) * 0.35, math.sin(a) * 0.35, 0)), foot, 0.065, mat=iron, verts=12, name="Leg")
        cone(0.13, 0.03, 0.22, loc=(foot.x * 1.03, foot.y * 1.03, 0.1), rot=(0, math.radians(-35), a), mat=dark, verts=10, name="Claw")
        sphere(0.09, loc=foot, mat=iron, name="Knuckle", segments=10, rings=6)
        feet.append(foot)
    brace = torus(0.62, 0.04, loc=(0, 0, 0.85), mat=iron, name="Brace", seg=32, ring=8)
    # decorative scrolls on the legs
    for k in range(3):
        a = math.pi / 2 + k * TAU / 3 + math.pi / 3
        torus(0.12, 0.035, loc=(math.cos(a) * 0.58, math.sin(a) * 0.58, 0.85), rot=(math.pi / 2, 0, a), mat=iron, name="Scroll", seg=16, ring=6)
    return list(ALL_OBJS), None, dict(key=4.5, fill=1.6, rim=6.0, az=20, el=20, pad=(0.04, 0.04, 0.02, 0.04),
                                      glow=dict(threshold=0.8, sigma=1.5, strength=0.35, tint=(1.0, 0.4, 0.08)))


def build_banner(M):
    ALL_OBJS.clear()
    iron = M["iron"]
    # crossbar with finials and a hanging ring + chain (pivot is the chain top)
    cyl(0.07, 2.5, rot=(0, math.pi / 2, 0), mat=M["wood_dark"], verts=16, bevel=0.0, name="Bar")
    for sx in (-1, 1):
        cone(0.11, 0.0, 0.3, loc=(sx * 1.38, 0, 0), rot=(0, sx * math.pi / 2, 0), mat=iron, verts=12, name="Finial")
        torus(0.09, 0.03, loc=(sx * 1.2, 0, 0), rot=(0, math.pi / 2, 0), mat=iron, name="Collar", seg=16, ring=6)
    torus(0.14, 0.03, loc=(0, 0, 0.18), rot=(math.pi / 2, 0, 0), mat=iron, name="HangRing", seg=20, ring=8)
    chain((0, 0, 0.3), (0, 0, 1.1), 3, link=0.12, thick=0.03, mat=iron)
    for x in (-0.85, 0.0, 0.85):
        torus(0.1, 0.025, loc=(x, 0, 0), rot=(0, math.pi / 2, 0), mat=iron, name="ClothRing", seg=16, ring=6)
    # cloth: waving grid with a tattered bottom edge and moth holes
    rng = np.random.RandomState(21)
    nx, nz = 24, 50
    x0, x1, zt, zb = -1.0, 1.0, 0.0, -4.7
    xs = np.linspace(x0, x1, nx + 1)
    zs = np.linspace(zt, zb, nz + 1)
    nib = rng.uniform(0, 1, nx + 1)
    holes = [(rng.uniform(-0.85, 0.85), rng.uniform(zb + 0.9, zt - 1.8), rng.uniform(0.05, 0.15)) for _ in range(7)]

    def bottom(x):
        v = 0.0
        v += 0.22 * (1 + math.sin(x * 7.3 + 1.0)) * 0.5
        v += 0.35 * abs(math.sin(x * 2.6 + 0.4))
        v += 0.85 * max(0.0, 1 - abs(x) / 0.42)  # swallow-tail notch in the middle
        v += 0.25 * max(0.0, 1 - abs(x - 0.75) / 0.2)
        return zb + v

    verts = []
    for iz, z in enumerate(zs):
        hang = min(1.0, (zt - z) / 1.0)
        for ix, x in enumerate(xs):
            y = 0.09 + 0.1 * math.sin(z * 1.5 + 0.6) * hang + 0.05 * math.sin(x * 4.0 + z * 0.9) * hang + 0.035 * math.sin(x * 9.0 + 1.0) * hang
            verts.append((x, y, z))
    faces = []
    for iz in range(nz):
        for ix in range(nx):
            i00 = iz * (nx + 1) + ix
            i10 = i00 + 1
            i01 = i00 + nx + 1
            i11 = i01 + 1
            cx = (xs[ix] + xs[ix + 1]) / 2
            zlow = zs[iz + 1]
            if zlow < bottom(cx) + nib[ix] * 0.12:
                continue
            # moth holes: a few irregular clusters
            cz = (zs[iz] + zlow) / 2
            if any(math.hypot((cx - hx) * 1.0, (cz - hz) * 0.8) < hr * (0.7 + 0.6 * nib[(ix * 7 + iz * 3) % (nx + 1)]) for hx, hz, hr in holes):
                continue
            faces.append([i00, i10, i11, i01])
    cloth = mesh_from_pydata("Cloth", verts, faces, mat=mat_cloth("Banner", emblem_img=emblem_image()), smooth=True)
    sol = cloth.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.03
    sol.offset = 0.0
    # fringe / cord along the top edge
    cyl(0.03, 2.0, loc=(0, 0.1, -0.02), rot=(0, math.pi / 2, 0), mat=M["rope"], verts=8, bevel=0.0, name="Cord")
    return list(ALL_OBJS), None, dict(key=4.0, fill=1.6, rim=5.0, az=8, el=8, pad=(0.04, 0.04, 0.02, 0.02))


# ----------------------------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------------------------

def normal_name(fn):
    stem, ext = os.path.splitext(fn)
    return f"{stem}_n{ext}"


def render_asset(name, builder, w, h, nframes=1, filename=None, pivot=(0.5, 1.0), post=None):
    t0 = time.time()
    reset_scene()
    M = materials()
    objs, on_frame, opts = builder(M)
    glow = opts.pop("glow", None)
    view = opts.pop("view", None)
    exposure = opts.pop("exposure", None)
    if exposure is not None:
        bpy.context.scene.view_settings.exposure = exposure
    if view:  # per-asset view transform (Standard keeps emissive colours saturated)
        bpy.context.scene.view_settings.view_transform = view
        bpy.context.scene.view_settings.look = "None"
    light_rig(key=opts.pop("key", 5.0), fill=opts.pop("fill", 1.6), rim=opts.pop("rim", 6.0))
    set_camera(objs, w, h, frames_setup=on_frame, nframes=nframes, **opts)
    sheet = np.zeros((h, w * nframes, 4), np.float32)
    nsheet = np.zeros((h, w * nframes, 3), np.float32)
    for f in range(nframes):
        if on_frame:
            on_frame(f)
        pm, nrm = render_frame(w, h, f"{name}_{f}")
        if glow:
            pm = add_glow(pm, **glow)
        if post:
            pm = post(pm)
        sheet[:, f * w:(f + 1) * w] = pm
        nsheet[:, f * w:(f + 1) * w] = nrm
    fn = filename or f"{name}.png"
    rgba = to_uint8(sheet)
    write_png(os.path.join(OUT_DIR, fn), rgba)
    nfn = normal_name(fn)
    write_png(os.path.join(OUT_DIR, nfn), encode_normals(nsheet, rgba[..., 3:4].astype(np.float32) / 255.0))
    dt = time.time() - t0
    print(f"[props] {fn} + {nfn}: {nframes} x {w}x{h} in {dt:.1f}s")
    return dict(file=fn, normal=nfn, frame_width=w, frame_height=h, frames=nframes, pivot=list(pivot))


ASSETS = [
    ("coin", lambda: render_asset("coin", build_coin, 40, 40, 12, "coin_sheet.png", pivot=(0.5, 0.5),
                                  post=lambda pm: contrast(pm, amount=1.15, gamma=0.85, saturation=1.15))),
    ("gem", lambda: render_asset("gem", build_gem, 40, 40, 12, "gem_sheet.png", pivot=(0.5, 0.5),
                                 post=lambda pm: contrast(pm, amount=1.05, saturation=1.2))),
    ("potion_red", lambda: render_asset("potion_red", lambda M: build_potion(M, "red"), 36, 44, 1, pivot=(0.5, 0.5))),
    ("potion_green", lambda: render_asset("potion_green", lambda M: build_potion(M, "green"), 36, 44, 1, pivot=(0.5, 0.5))),
    ("chest", lambda: render_asset("chest", build_chest, 96, 80, 2, "chest_sheet.png", pivot=(0.5, 1.0))),
    ("shrine", lambda: render_asset("shrine", build_shrine, 120, 200, 2, "shrine.png", pivot=(0.5, 1.0))),
    ("skull", lambda: render_asset("skull", build_skull, 36, 32, 1, pivot=(0.5, 1.0))),
    ("gravestone1", lambda: render_asset("gravestone1", lambda M: build_gravestone(M, 1), 90, 120, 1, pivot=(0.5, 1.0))),
    ("gravestone2", lambda: render_asset("gravestone2", lambda M: build_gravestone(M, 2), 90, 120, 1, pivot=(0.5, 1.0))),
    ("gravestone3", lambda: render_asset("gravestone3", lambda M: build_gravestone(M, 3), 90, 120, 1, pivot=(0.5, 1.0))),
    ("torch", lambda: render_asset("torch", build_torch, 40, 90, 1, pivot=(0.5, 0.5))),
    ("pillar", lambda: render_asset("pillar", build_pillar, 100, 300, 1, pivot=(0.5, 1.0))),
    ("cage", lambda: render_asset("cage", build_cage, 90, 180, 1, pivot=(0.5, 0.0))),
    ("brazier", lambda: render_asset("brazier", build_brazier, 60, 80, 1, pivot=(0.5, 1.0))),
    ("banner", lambda: render_asset("banner", build_banner, 70, 160, 1, pivot=(0.5, 0.0))),
]

DESCRIPTIONS = {
    "coin": "Gold coin with a raised beast emblem and reeded edge, spinning about its vertical axis; 12 frames over 180 degrees, loops.",
    "gem": "Floating faceted soul gem, glowing teal/violet; 12 frames over a quarter turn, loops.",
    "potion_red": "Health potion flask (red) with meniscus, bubbles and glass highlights.",
    "potion_green": "Stamina potion flask (green) with meniscus, bubbles and glass highlights.",
    "chest": "Iron-bound, studded treasure chest with padlock: frame 0 closed, frame 1 open with inner glow.",
    "shrine": "Checkpoint shrine / obelisk with carved runes: frame 0 unlit, frame 1 runes lit.",
    "skull": "Small weathered, cracked skull (ground decoration).",
    "gravestone1": "Rounded gravestone with carved cross and chipped shoulder.",
    "gravestone2": "Stone cross on a plinth, chipped arm.",
    "gravestone3": "Tilted slab with broken corner.",
    "torch": "Wall-mounted iron torch bracket with sooted plate, no flame (flame animated in-game). Wall is behind.",
    "pillar": "Broken fluted gothic pillar with carved arcading and rubble.",
    "cage": "Hanging rusted gibbet cage with a shackled skeleton and chains; pivot at the chain top.",
    "brazier": "Standing iron brazier bowl on a clawed tripod, coals but no flame (flame animated in-game).",
    "banner": "Hanging tattered crimson banner on a crossbar with a faded beast emblem; pivot at the chain top.",
}


def main():
    t0 = time.time()
    json_path = os.path.join(OUT_DIR, "props.json")
    meta = {}
    if os.path.exists(json_path):
        try:
            with open(json_path) as f:
                meta = json.load(f).get("sprites", {})
        except Exception:
            meta = {}
    for name, fn in ASSETS:
        if ARGS["only"] and name not in ARGS["only"]:
            continue
        info = fn()
        info["description"] = DESCRIPTIONS[name]
        meta[name] = info
    out = {
        "generator": "tools/blender_props.py",
        "notes": "pivot is the sprite origin as fractions of the frame (x right, y down): "
                 "[0.5, 1.0] = bottom centre for ground props, [0.5, 0.5] = centre for pickups, "
                 "[0.5, 0.0] = top centre for hanging props. 'normal' is the matching normal map "
                 "(same frame layout, OpenGL convention: +X right, +Y up, flat = 128,128,255) "
                 "for Phaser's Light2D pipeline.",
        "sprites": {k: meta[k] for k, _ in ASSETS if k in meta},
    }
    with open(json_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"[props] done in {time.time() - t0:.1f}s -> {OUT_DIR}")


if __name__ == "__main__":
    main()
