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
                   shrine skull gravestone1 gravestone2 gravestone3 torch pillar cage)
    --samples N    Cycles samples per frame (default 48, denoised)
    --ss N         supersampling factor; frames are rendered at N x the target size and
                   box-filtered down (default 2) for crisp anti-aliased sprites
    --out DIR      output directory (default assets/sprites/props next to the repo root)

Output
    assets/sprites/props/*.png   RGBA sprite sheets / single frames, transparent background
    assets/sprites/props/props.json   frame size, frame count and suggested pivot per file

Everything is modelled procedurally from primitives (no .blend files), so the output is
reproducible. Each asset is rendered with an orthographic camera at a slight 3/4 downward
angle, a warm key light from the upper left, a cool blue fill from the right and a strong
rim light from behind, against a transparent background. Materials use an ambient
occlusion term for edge darkening so the pieces read as solid at small sizes. A bloom-like
glow for emissive parts (gem, potions, lit shrine, open chest) is added in numpy after the
render so it also extends into the transparent area.
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
ARGS = {"only": None, "samples": 48, "ss": 2, "out": os.path.join(REPO, "assets", "sprites", "props")}
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
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
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
    return sc


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
            if ob.type != "MESH":
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
# Materials
# ----------------------------------------------------------------------------------------

def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def _ao_color(nt, color_socket_or_rgb, strength=0.7, distance=0.35):
    """Return an output socket: base colour darkened by ambient occlusion (edge darkening)."""
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = distance
    ao.samples = 4
    ao.only_local = True
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = strength
    if isinstance(color_socket_or_rgb, tuple):
        mix.inputs["A"].default_value = (*color_socket_or_rgb, 1.0)
    else:
        nt.links.new(color_socket_or_rgb, mix.inputs["A"])
    # Lift the AO a little so crevices are dark but never pitch black.
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 1.0
    mr.inputs["To Min"].default_value = 0.25
    mr.inputs["To Max"].default_value = 1.0
    nt.links.new(ao.outputs["AO"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], mix.inputs["B"])
    return mix.outputs["Result"]


def mat_simple(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0,
               ao=0.7, specular=0.5, coat=0.0):
    m, nt, out = _new_mat(name)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(_ao_color(nt, color, ao), p.inputs["Base Color"])
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    p.inputs["Specular IOR Level"].default_value = specular
    p.inputs["Coat Weight"].default_value = coat
    if emission is not None:
        p.inputs["Emission Color"].default_value = (*emission, 1.0)
        p.inputs["Emission Strength"].default_value = emission_strength
    nt.links.new(p.outputs[0], out.inputs[0])
    return m


def mat_noisy(name, color_a, color_b, scale=4.0, detail=3.0, roughness=0.8, bump=0.3, metallic=0.0,
              moss=None, moss_amount=0.0, ao=0.8, ramp=(0.35, 0.65)):
    """Stone / wood style material: two-colour noise, bump, optional moss towards the bottom
    and on upward-facing surfaces."""
    m, nt, out = _new_mat(name)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Roughness"].default_value = roughness
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Specular IOR Level"].default_value = 0.35
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    noise.inputs["Roughness"].default_value = 0.6
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].position = ramp[0]
    cr.color_ramp.elements[0].color = (*color_a, 1)
    cr.color_ramp.elements[1].position = ramp[1]
    cr.color_ramp.elements[1].color = (*color_b, 1)
    nt.links.new(noise.outputs["Fac"], cr.inputs["Fac"])
    col = cr.outputs["Color"]
    if moss is not None and moss_amount > 0:
        # moss mask: big soft noise * (facing up or low on the object)
        n2 = nt.nodes.new("ShaderNodeTexNoise")
        n2.inputs["Scale"].default_value = 1.6
        n2.inputs["Detail"].default_value = 4.0
        nt.links.new(tc.outputs["Object"], n2.inputs["Vector"])
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        sepn = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(geo.outputs["Normal"], sepn.inputs[0])
        up = nt.nodes.new("ShaderNodeMath")
        up.operation = "MULTIPLY_ADD"
        up.inputs[1].default_value = 0.5
        up.inputs[2].default_value = 0.45
        nt.links.new(sepn.outputs["Z"], up.inputs[0])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        nt.links.new(n2.outputs["Fac"], mul.inputs[0])
        nt.links.new(up.outputs[0], mul.inputs[1])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.42
        mr.inputs["From Max"].default_value = 0.62
        mr.inputs["To Max"].default_value = moss_amount
        nt.links.new(mul.outputs[0], mr.inputs["Value"])
        mixm = nt.nodes.new("ShaderNodeMix")
        mixm.data_type = "RGBA"
        nt.links.new(mr.outputs["Result"], mixm.inputs["Factor"])
        nt.links.new(col, mixm.inputs["A"])
        mixm.inputs["B"].default_value = (*moss, 1)
        col = mixm.outputs["Result"]
    nt.links.new(_ao_color(nt, col, ao), p.inputs["Base Color"])
    if bump > 0:
        b = nt.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = bump
        b.inputs["Distance"].default_value = 0.08
        n3 = nt.nodes.new("ShaderNodeTexNoise")
        n3.inputs["Scale"].default_value = scale * 3.0
        n3.inputs["Detail"].default_value = 6.0
        nt.links.new(tc.outputs["Object"], n3.inputs["Vector"])
        nt.links.new(n3.outputs["Fac"], b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
    nt.links.new(p.outputs[0], out.inputs[0])
    return m


def mat_glass(name, tint=(0.75, 0.9, 1.0), alpha=0.22, roughness=0.08):
    """Stylised glass: a transparent shader mixed with a glossy one by fresnel, so the
    silhouette keeps a bright rim and highlights but you can see what is inside."""
    m, nt, out = _new_mat(name)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr.inputs["Color"].default_value = (*tint, 1)
    gl = nt.nodes.new("ShaderNodeBsdfPrincipled")
    gl.inputs["Base Color"].default_value = (*tint, 1)
    gl.inputs["Roughness"].default_value = roughness
    gl.inputs["Metallic"].default_value = 0.0
    gl.inputs["Specular IOR Level"].default_value = 1.0
    gl.inputs["Coat Weight"].default_value = 1.0
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = alpha
    mr.inputs["To Max"].default_value = 1.0
    nt.links.new(lw.outputs["Facing"], mr.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mr.outputs["Result"], mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(gl.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    m.blend_method = "BLEND"
    return m


def mat_gem(name, base=(0.35, 0.08, 0.7), glow=(0.1, 0.95, 0.9), strength=1.6):
    m, nt, out = _new_mat(name)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (*base, 1)
    p.inputs["Roughness"].default_value = 0.05
    p.inputs["Transmission Weight"].default_value = 0.85
    p.inputs["IOR"].default_value = 1.9
    p.inputs["Coat Weight"].default_value = 1.0
    p.inputs["Emission Color"].default_value = (*glow, 1)
    # Stronger emission at the facets facing away from the camera -> inner glow look.
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = strength * 0.4
    mr.inputs["To Max"].default_value = strength
    nt.links.new(lw.outputs["Fresnel"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], p.inputs["Emission Strength"])
    nt.links.new(p.outputs[0], out.inputs[0])
    return m


def mat_emissive(name, color, strength):
    m, nt, out = _new_mat(name)
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


def mat_liquid(name, color, glow, strength=2.5):
    m, nt, out = _new_mat(name)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = 0.25
    p.inputs["Subsurface Weight"].default_value = 0.4
    p.inputs["Subsurface Radius"].default_value = (0.3, 0.1, 0.1)
    p.inputs["Emission Color"].default_value = (*glow, 1)
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = strength
    mr.inputs["To Max"].default_value = strength * 0.35
    nt.links.new(lw.outputs["Facing"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], p.inputs["Emission Strength"])
    nt.links.new(p.outputs[0], out.inputs[0])
    return m


# Shared material library (rebuilt per scene because reset_scene wipes data).
def materials():
    M = {}
    M["gold"] = mat_simple("Gold", (1.0, 0.74, 0.22), metallic=1.0, roughness=0.3, ao=0.45)
    M["gold_dark"] = mat_simple("GoldDark", (0.75, 0.42, 0.08), metallic=1.0, roughness=0.42, ao=0.6)
    M["iron"] = mat_noisy("Iron", (0.12, 0.12, 0.13), (0.32, 0.3, 0.3), scale=6, roughness=0.5, bump=0.25, metallic=0.85, ao=0.7)
    M["iron_dark"] = mat_noisy("IronDark", (0.06, 0.06, 0.07), (0.2, 0.19, 0.2), scale=6, roughness=0.55, bump=0.25, metallic=0.8, ao=0.7)
    M["wood"] = mat_noisy("Wood", (0.30, 0.15, 0.06), (0.55, 0.32, 0.14), scale=2.5, detail=5, roughness=0.75, bump=0.35, ao=0.8, ramp=(0.3, 0.7))
    M["wood_dark"] = mat_noisy("WoodDark", (0.16, 0.08, 0.03), (0.33, 0.18, 0.08), scale=3, detail=5, roughness=0.8, bump=0.3, ao=0.8)
    M["stone"] = mat_noisy("Stone", (0.30, 0.31, 0.32), (0.58, 0.58, 0.55), scale=3.0, roughness=0.9, bump=0.5,
                           moss=(0.16, 0.34, 0.10), moss_amount=0.85, ao=0.85)
    M["stone_dark"] = mat_noisy("StoneDark", (0.18, 0.19, 0.21), (0.42, 0.43, 0.42), scale=3.0, roughness=0.9, bump=0.5,
                                moss=(0.14, 0.30, 0.09), moss_amount=0.7, ao=0.85)
    M["bone"] = mat_noisy("Bone", (0.62, 0.56, 0.44), (0.92, 0.88, 0.76), scale=5.0, roughness=0.6, bump=0.2, ao=0.9, ramp=(0.3, 0.7))
    M["black"] = mat_simple("Black", (0.01, 0.01, 0.012), roughness=0.9, ao=0.0, specular=0.0)
    M["cork"] = mat_noisy("Cork", (0.45, 0.28, 0.12), (0.7, 0.5, 0.25), scale=8, roughness=0.9, bump=0.4, ao=0.8)
    M["glass"] = mat_glass("Glass")
    M["cloth"] = mat_noisy("Cloth", (0.05, 0.04, 0.04), (0.2, 0.12, 0.08), scale=6, roughness=1.0, bump=0.5, ao=0.9)
    M["rope"] = mat_noisy("Rope", (0.35, 0.26, 0.14), (0.6, 0.48, 0.3), scale=20, roughness=0.95, bump=0.6, ao=0.9)
    return M


# ----------------------------------------------------------------------------------------
# Geometry helpers
# ----------------------------------------------------------------------------------------

ALL_OBJS = []


def _finish(ob, mat=None, smooth=False, bevel=None, bevel_segments=3, name=None):
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
        bm.angle_limit = math.radians(40)
        bm.harden_normals = smooth
        bm.use_clamp_overlap = True
    ALL_OBJS.append(ob)
    return ob


def box(size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.03, name="Box"):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(scale=True)
    return _finish(ob, mat, smooth=False, bevel=bevel, name=name)


def cyl(radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, verts=32, bevel=0.02, smooth=True, name="Cyl", scale=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=verts, location=loc, rotation=rot)
    ob = bpy.context.active_object
    if scale:
        ob.scale = scale
        bpy.ops.object.transform_apply(scale=True)
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
        bpy.ops.object.transform_apply(scale=True)
    return _finish(ob, mat, smooth=True, name=name)


def torus(major, minor, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, scale=None, name="Torus", seg=32, ring=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=seg, minor_segments=ring)
    ob = bpy.context.active_object
    if scale:
        ob.scale = scale
        bpy.ops.object.transform_apply(scale=True)
    return _finish(ob, mat, smooth=True, name=name)


def mesh_from_pydata(name, verts, faces, mat=None, smooth=False, bevel=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel_segments=3):
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
    return _finish(ob, mat, smooth=smooth, bevel=bevel, name=name, bevel_segments=bevel_segments)


def prism(profile, z0, z1, name="Prism", **kw):
    """Extrude a closed 2D profile (list of (x, y)) from z0 to z1."""
    n = len(profile)
    verts = [(x, y, z0) for x, y in profile] + [(x, y, z1) for x, y in profile]
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


def bisect(ob, plane_co, plane_no, clear_outer=True, fill=True):
    """Cut a mesh with a plane, discarding one side and capping the hole."""
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


def render_frame(w, h, tag):
    """Render the current scene at ss x (w, h) and return a float HxWx4 premultiplied
    image (sRGB-encoded values) at the target size."""
    sc = bpy.context.scene
    ss = ARGS["ss"]
    sc.render.resolution_x = w * ss
    sc.render.resolution_y = h * ss
    path = os.path.join(SCRATCH, f"{tag}.png")
    sc.render.filepath = path
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
    return pm


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

def build_coin(M):
    ALL_OBJS.clear()
    # Coin axis along Y so it faces the camera; it spins about world Z.
    body = cyl(1.0, 0.2, rot=(math.pi / 2, 0, 0), mat=M["gold"], verts=64, bevel=0.06, name="Coin")
    body.modifiers["Bevel"].segments = 4
    # raised rims on both faces
    for s in (1, -1):
        torus(0.82, 0.045, loc=(0, s * 0.1, 0), rot=(math.pi / 2, 0, 0), mat=M["gold"], name="Rim")
        st = prism(star_profile(5, 0.56, 0.26, rot=math.pi / 2), -0.045, 0.045, name="Star", mat=M["gold"], bevel=0.02)
        st.rotation_euler = (math.pi / 2, 0, 0) if s > 0 else (-math.pi / 2, 0, 0)
        st.location = (0, s * 0.12, 0)
        # dark recessed field between star and rim reads as embossing at small size
        cyl(0.76, 0.012, loc=(0, s * 0.105, 0), rot=(math.pi / 2, 0, 0), mat=M["gold_dark"], verts=64, bevel=0, name="Field")
    root = group(list(ALL_OBJS), "CoinRoot")

    def on_frame(i):
        root.rotation_euler = (0, 0, math.radians(180.0 * i / 12 + 8.0))

    return list(ALL_OBJS), on_frame, dict(key=7.0, fill=1.6, rim=8.0, az=0, el=16, margin=0.05)


def build_gem(M):
    ALL_OBJS.clear()
    s = 0.72
    verts = [(s, 0, 0), (0, s, 0), (-s, 0, 0), (0, -s, 0), (0, 0, 1.15), (0, 0, -1.05)]
    faces = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [1, 0, 5], [2, 1, 5], [3, 2, 5], [0, 3, 5]]
    gem = mesh_from_pydata("Gem", verts, faces, mat=mat_gem("GemMat", strength=0.55), bevel=0.16, bevel_segments=2)
    gem.modifiers["Bevel"].limit_method = "NONE"
    core = sphere(0.28, mat=mat_emissive("Core", (0.3, 1.0, 0.95), 2.2), scale=(1, 1, 1.5), name="Core")
    root = group([gem, core], "GemRoot")
    root.rotation_euler = (math.radians(12), 0, 0)

    def on_frame(i):
        root.rotation_euler = (math.radians(12), math.radians(6), math.radians(90.0 * i / 12 + 20))

    return list(ALL_OBJS), on_frame, dict(key=3.5, fill=1.0, rim=4.0, az=0, el=14, margin=0.14,
                                          glow=dict(threshold=0.7, sigma=2.5, strength=0.9, tint=(0.2, 0.95, 0.9)))


def build_potion(M, color):
    ALL_OBJS.clear()
    if color == "red":
        liq_col, glow = (0.7, 0.02, 0.03), (1.0, 0.1, 0.06)
    else:
        liq_col, glow = (0.08, 0.6, 0.05), (0.3, 1.0, 0.15)
    glass = M["glass"]
    bulb = sphere(1.0, loc=(0, 0, 1.0), mat=glass, name="Bulb")
    cyl(0.36, 1.2, loc=(0, 0, 2.2), mat=glass, bevel=0.0, name="Neck")
    torus(0.38, 0.09, loc=(0, 0, 2.75), mat=glass, name="Lip")
    cyl(0.3, 0.55, loc=(0, 0, 2.95), mat=M["cork"], bevel=0.06, name="Cork")
    # liquid: inner sphere cut at the fill level, plus a little in the neck
    liq = sphere(0.9, loc=(0, 0, 1.0), mat=mat_liquid("Liquid", liq_col, glow, 0.75), name="Liquid")
    bisect(liq, (0, 0, 1.55), (0, 0, 1))
    # highlight blob
    sphere(0.13, loc=(-0.45, -0.6, 1.5), mat=mat_emissive("Spark", (1, 1, 1), 1.2), name="Spark")
    return list(ALL_OBJS), None, dict(key=4.5, fill=1.6, rim=6.0, az=10, el=12, margin=0.06,
                                      glow=dict(threshold=0.65, sigma=2.0, strength=0.7, tint=glow))


def build_chest(M):
    ALL_OBJS.clear()
    W, D, H = 2.2, 1.3, 1.1
    body = box((W, D, H), loc=(0, 0, H / 2), mat=M["wood"], bevel=0.04, name="Body")
    # dark interior cavity (visible when open)
    box((W - 0.2, D - 0.2, H - 0.1), loc=(0, 0, H / 2 + 0.06), mat=M["wood_dark"], bevel=0.0, name="Inner")
    # iron bands and corner plates on the body
    for x in (-0.72, 0.72):
        box((0.18, D + 0.04, H + 0.02), loc=(x, 0, H / 2), mat=M["iron"], bevel=0.02, name="Band")
    box((W + 0.04, D + 0.04, 0.12), loc=(0, 0, 0.08), mat=M["iron_dark"], bevel=0.02, name="Foot")
    box((W + 0.04, D + 0.04, 0.1), loc=(0, 0, H - 0.05), mat=M["iron"], bevel=0.02, name="TopBand")
    # lid: half cylinder along X, hinged at the back top edge
    lid_parts = []
    lid = cyl(D / 2, W, rot=(0, math.pi / 2, 0), mat=M["wood"], verts=32, bevel=0.0, name="Lid")
    bisect(lid, (0, 0, 0), (0, 0, 1), clear_outer=False)
    lid_parts.append(lid)
    for x in (-0.72, 0.72):
        b = cyl(D / 2 + 0.035, 0.18, loc=(x, 0, 0), rot=(0, math.pi / 2, 0), mat=M["iron"], verts=32, bevel=0.0, name="LidBand")
        bisect(b, (0, 0, -0.02), (0, 0, 1), clear_outer=False)
        lid_parts.append(b)
    lb = cyl(D / 2 + 0.03, W + 0.04, rot=(0, math.pi / 2, 0), mat=M["iron"], verts=32, bevel=0.0, name="LidEdge")
    bisect(lb, (0, 0, 0.0), (0, 0, 1), clear_outer=False)
    bisect(lb, (0, 0, 0.1), (0, 0, 1), clear_outer=True)
    lid_parts.append(lb)
    # lock hasp on the lid front
    lid_parts.append(box((0.3, 0.1, 0.35), loc=(0, -D / 2 - 0.02, -0.05), mat=M["gold"], bevel=0.03, name="Hasp"))
    lid_root = bpy.data.objects.new("LidRoot", None)
    bpy.context.scene.collection.objects.link(lid_root)
    for p in lid_parts:
        p.parent = lid_root
    lid_root.location = (0, D / 2, H)  # hinge at back top edge
    for p in lid_parts:
        p.location = (p.location.x, p.location.y - D / 2, p.location.z)
    # lock plate on body
    box((0.36, 0.08, 0.3), loc=(0, -D / 2 - 0.03, H - 0.25), mat=M["gold"], bevel=0.03, name="Lock")
    sphere(0.06, loc=(0, -D / 2 - 0.08, H - 0.3), mat=M["black"], name="Keyhole")
    # treasure inside (only visible when open)
    gl = mat_emissive("Treasure", (1.0, 0.75, 0.3), 6.0)
    treasure = [box((W - 0.4, D - 0.4, 0.08), loc=(0, 0, H - 0.25), mat=gl, bevel=0.0, name="GlowPlane")]
    rng = np.random.RandomState(3)
    for k in range(9):
        x = rng.uniform(-0.7, 0.7)
        y = rng.uniform(-0.3, 0.3)
        treasure.append(cyl(0.16, 0.05, loc=(x, y, H - 0.2 + k * 0.01), rot=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0),
                            mat=M["gold"], verts=24, bevel=0.01, name="Coin"))
    light = add_light("ChestGlow", "POINT", location=(0, 0, H + 0.4), color=(1.0, 0.7, 0.3), energy=60, size=0.4)

    def on_frame(i):
        open_ = i == 1
        lid_root.rotation_euler = (math.radians(-105) if open_ else 0, 0, 0)
        for t in treasure:
            t.hide_render = not open_
        light.hide_render = not open_
        light.data.energy = 60 if open_ else 0

    return list(ALL_OBJS), on_frame, dict(key=4.5, fill=1.5, rim=5.0, az=22, el=20, pad=(0.08, 0.08, 0.04, 0.06),
                                          glow=dict(threshold=0.8, sigma=2.5, strength=0.6, tint=(1.0, 0.7, 0.3)))


def build_shrine(M):
    ALL_OBJS.clear()
    stone = M["stone"]
    box((2.6, 2.6, 0.35), loc=(0, 0, 0.175), mat=M["stone_dark"], bevel=0.04, name="Step1")
    box((2.0, 2.0, 0.35), loc=(0, 0, 0.5), mat=stone, bevel=0.04, name="Step2")
    frustum(0.75, 0.5, 0.65, 4.6, name="Obelisk", mat=stone, bevel=0.05)
    frustum(0.5, 0.08, 4.6, 5.4, name="Tip", mat=stone, bevel=0.03)
    # ornamental ring near top
    frustum(0.62, 0.58, 4.2, 4.45, name="Collar", mat=M["stone_dark"], bevel=0.03)
    # rune glyph on the front face (front = -Y). Face slope: half-width goes 0.75 -> 0.5 over z 0.65..4.6
    def hw(z):
        return 0.75 + (0.5 - 0.75) * (z - 0.65) / (4.6 - 0.65)

    rune_mat = mat_emissive("Rune", (0.2, 0.95, 0.85), 1.0)
    rune_parts = []
    tilt = math.atan2(0.25, 3.95)
    for (z, w, h) in [(2.6, 0.12, 1.5), (3.05, 0.6, 0.12), (2.2, 0.45, 0.12)]:
        rune_parts.append(box((w, 0.06, h), loc=(0, -hw(z) - 0.0, z), rot=(tilt, 0, 0), mat=rune_mat, bevel=0.0, name="Rune"))
    d = box((0.36, 0.06, 0.36), loc=(0, -hw(3.6) - 0.0, 3.6), rot=(tilt, 0, math.pi / 4), mat=rune_mat, bevel=0.0, name="RuneEye")
    rune_parts.append(d)
    # small crystal on top
    verts = [(0.18, 0, 0), (0, 0.18, 0), (-0.18, 0, 0), (0, -0.18, 0), (0, 0, 0.45), (0, 0, -0.3)]
    faces = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [1, 0, 5], [2, 1, 5], [3, 2, 5], [0, 3, 5]]
    crystal = mesh_from_pydata("Crystal", verts, faces, mat=rune_mat, loc=(0, 0, 5.65))
    rune_parts.append(crystal)
    light = add_light("RuneGlow", "POINT", location=(0, -1.6, 3.0), color=(0.2, 0.95, 0.85), energy=250, size=0.6)

    def on_frame(i):
        lit = i == 1
        rune_mat.node_tree.nodes["Emission"].inputs["Strength"].default_value = 7.0 if lit else 0.0
        rune_mat.node_tree.nodes["Emission"].inputs["Color"].default_value = (0.2, 0.95, 0.85, 1) if lit else (0.07, 0.1, 0.11, 1)
        light.hide_render = not lit
        light.data.energy = 250 if lit else 0

    return list(ALL_OBJS), on_frame, dict(key=4.5, fill=1.6, rim=5.0, az=20, el=12, pad=(0.08, 0.08, 0.02, 0.06),
                                          glow=dict(threshold=0.7, sigma=3.0, strength=0.8, tint=(0.2, 0.95, 0.85)))


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
    # teeth
    for k in range(6):
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
        # rounded-top slab with a carved cross
        w, d, h = 1.5, 0.3, 1.9
        slab = box((w, d, h), loc=(0, 0, h / 2), mat=stone, bevel=0.05, name="Slab")
        top = cyl(w / 2, d, loc=(0, 0, h), rot=(math.pi / 2, 0, 0), mat=stone, verts=48, bevel=0.05, smooth=False, name="Top")
        bisect(top, (0, 0, h), (0, 0, 1), clear_outer=False)
        box((0.18, 0.08, 1.1), loc=(0, -d / 2, 1.35), mat=M["stone_dark"], bevel=0.0, name="CrossV")
        box((0.7, 0.08, 0.18), loc=(0, -d / 2, 1.65), mat=M["stone_dark"], bevel=0.0, name="CrossH")
        box((w + 0.5, d + 0.5, 0.25), loc=(0, 0.05, 0.12), mat=M["stone_dark"], bevel=0.05, name="Base")
        root = group(list(ALL_OBJS))
        root.rotation_euler = (0, math.radians(-4), 0)
        opts = dict(az=18, el=14)
    elif kind == 2:
        # stone cross on a plinth
        box((1.3, 1.0, 0.3), loc=(0, 0, 0.15), mat=M["stone_dark"], bevel=0.04, name="Plinth")
        box((0.9, 0.7, 0.3), loc=(0, 0, 0.42), mat=stone, bevel=0.04, name="Plinth2")
        box((0.42, 0.34, 2.4), loc=(0, 0, 1.75), mat=stone, bevel=0.05, name="CrossV")
        box((1.35, 0.34, 0.42), loc=(0, 0, 2.3), mat=stone, bevel=0.05, name="CrossH")
        # chipped arm: cut the end of the right arm with a tilted box
        cutter = box((0.5, 0.8, 0.8), loc=(0.78, 0, 2.62), rot=(0, math.radians(30), 0), mat=M["stone"], bevel=0.0, name="Chip")
        boolean_cut(ALL_OBJS[-2], cutter)
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
        root = group(list(ALL_OBJS))
        root.rotation_euler = (0, math.radians(13), 0)
        opts = dict(az=14, el=14)
    opts.update(key=4.5, fill=1.6, rim=5.0, pad=(0.06, 0.06, 0.02, 0.06))
    return list(ALL_OBJS), None, opts


def build_torch(M):
    ALL_OBJS.clear()
    iron = M["iron"]
    # wall plate (wall is behind, +Y)
    box((0.7, 0.12, 1.3), loc=(0, 0.56, 0.2), mat=M["iron_dark"], bevel=0.03, name="Plate")
    for z in (-0.3, 0.7):
        sphere(0.07, loc=(0, 0.48, z), mat=iron, name="Rivet")
    # bracket arm: angled bar from plate to ring
    cyl(0.06, 0.75, loc=(0, 0.22, 0.05), rot=(math.radians(60), 0, 0), mat=iron, verts=12, bevel=0.0, name="Arm")
    cyl(0.06, 0.5, loc=(0, 0.3, -0.15), rot=(math.radians(-50), 0, 0), mat=iron, verts=12, bevel=0.0, name="Brace")
    torus(0.3, 0.06, loc=(0, -0.1, 0.3), mat=iron, name="Ring", seg=32, ring=10)
    torus(0.3, 0.05, loc=(0, -0.1, -0.1), mat=iron, name="Ring2", seg=32, ring=10)
    # torch stick with wrapped rag head
    cyl(0.2, 2.0, loc=(0, -0.1, 0.9), mat=M["wood_dark"], verts=16, bevel=0.03, name="Stick")
    cyl(0.28, 0.5, loc=(0, -0.1, 1.85), mat=M["cloth"], verts=16, bevel=0.05, name="Rag")
    for z in (1.68, 1.98):
        torus(0.28, 0.035, loc=(0, -0.1, z), mat=M["rope"], name="Twine", seg=24, ring=8)
    # embers at the top (no flame, but a warm hint)
    sphere(0.14, loc=(0, -0.1, 2.12), mat=mat_emissive("Ember", (1.0, 0.35, 0.05), 3.0), scale=(1.4, 1.4, 0.6), name="Ember")
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
    box((2.6, 2.6, 0.5), loc=(0, 0, 0.25), mat=M["stone_dark"], bevel=0.05, name="Plinth")
    box((2.1, 2.1, 0.4), loc=(0, 0, 0.7), mat=stone, bevel=0.05, name="Plinth2")
    torus(0.95, 0.2, loc=(0, 0, 1.0), mat=stone, name="Torus")
    # fluted shaft with a jagged broken top
    prof = fluted_profile()
    n = len(prof)
    verts = [(x, y, 1.0) for x, y in prof]
    rng = np.random.RandomState(7)
    top = []
    for i, (x, y) in enumerate(prof):
        t = i / n * TAU
        z = 6.6 + 0.9 * math.sin(t * 2 + 0.6) + 0.45 * math.sin(t * 5 + 2.0) + 0.2 * math.sin(t * 11)
        top.append((x * 1.0, y * 1.0, z))
    verts += top
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces.append(list(range(n))[::-1])
    faces.append(list(range(n, 2 * n)))
    shaft = mesh_from_pydata("Shaft", verts, faces, mat=stone, smooth=False)
    # extra broken ridge: a slanted cap to make the break read as a jagged face
    cap = cone(1.0, 0.0, 1.2, loc=(0.15, 0.1, 6.9), rot=(math.radians(14), math.radians(-18), 0), mat=M["stone_dark"], verts=9, smooth=False)
    # rubble at the base
    for k in range(6):
        ang = rng.uniform(0, TAU)
        rad = rng.uniform(1.2, 1.7)
        s = rng.uniform(0.25, 0.5)
        box((s, s * 0.8, s * 0.7), loc=(math.cos(ang) * rad, math.sin(ang) * rad * 0.6 - 0.3, 0.5 + s * 0.35),
            rot=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, 3)), mat=stone, bevel=0.04, name="Rubble")
    return list(ALL_OBJS), None, dict(key=4.5, fill=1.6, rim=5.0, az=16, el=10, pad=(0.05, 0.05, 0.02, 0.04))


def build_cage(M):
    ALL_OBJS.clear()
    iron = M["iron"]
    R = 1.0
    # floor plate and rings
    cyl(R, 0.1, loc=(0, 0, 0.0), mat=M["iron_dark"], verts=32, bevel=0.02, name="Floor")
    for z in (0.08, 1.3, 2.5, 3.6):
        torus(R, 0.06, loc=(0, 0, z), mat=iron, name="Ring", seg=40, ring=10)
    # vertical bars
    nb = 10
    for k in range(nb):
        t = k / nb * TAU
        cyl(0.045, 3.65, loc=(math.cos(t) * R, math.sin(t) * R, 1.85), mat=iron, verts=8, bevel=0.0, name="Bar")
    # dome ribs
    for k in range(nb // 2):
        t = k / (nb / 2) * math.pi
        rib = torus(1.0, 0.045, loc=(0, 0, 3.6), rot=(math.pi / 2, 0, t), mat=iron, name="Rib", seg=40, ring=8)
        bisect(rib, (0, 0, 3.6), (0, 0, 1), clear_outer=False, fill=False)
    torus(0.5, 0.05, loc=(0, 0, 4.45), mat=iron, name="DomeRing", seg=32, ring=8)
    # finial and chain
    sphere(0.14, loc=(0, 0, 4.62), mat=iron, name="Finial")
    torus(0.16, 0.035, loc=(0, 0, 4.85), rot=(math.pi / 2, 0, 0), mat=iron, name="Link", seg=20, ring=8)
    for k in range(7):
        z = 5.1 + k * 0.3
        torus(0.17, 0.035, loc=(0, 0, z), rot=(math.pi / 2, 0, (k % 2) * math.pi / 2), mat=iron, name="Link", seg=20, ring=8, scale=(1, 1, 1.3))
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
    # arms hanging, legs folded
    cyl(0.05, 0.9, loc=(0.42, -0.1, 2.0), rot=(0, math.radians(8), 0), mat=bone, verts=8, bevel=0.0, name="ArmR")
    cyl(0.05, 0.9, loc=(-0.4, -0.05, 1.95), rot=(0, math.radians(-6), 0), mat=bone, verts=8, bevel=0.0, name="ArmL")
    cyl(0.065, 1.1, loc=(0.2, -0.35, 0.85), rot=(math.radians(-25), math.radians(10), 0), mat=bone, verts=8, bevel=0.0, name="LegR")
    cyl(0.065, 1.1, loc=(-0.22, -0.3, 0.8), rot=(math.radians(-25), math.radians(-12), 0), mat=bone, verts=8, bevel=0.0, name="LegL")
    cyl(0.055, 0.9, loc=(0.35, -0.75, 0.3), rot=(math.radians(-80), 0, math.radians(20)), mat=bone, verts=8, bevel=0.0, name="ShinR")
    cyl(0.055, 0.9, loc=(-0.3, -0.7, 0.3), rot=(math.radians(-80), 0, math.radians(-20)), mat=bone, verts=8, bevel=0.0, name="ShinL")
    return list(ALL_OBJS), None, dict(key=5.0, fill=1.8, rim=6.0, az=18, el=10, pad=(0.05, 0.05, 0.03, 0.02))


# ----------------------------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------------------------

def render_asset(name, builder, w, h, nframes=1, filename=None, pivot=(0.5, 1.0), post=None):
    t0 = time.time()
    reset_scene()
    M = materials()
    objs, on_frame, opts = builder(M)
    glow = opts.pop("glow", None)
    light_rig(key=opts.pop("key", 5.0), fill=opts.pop("fill", 1.6), rim=opts.pop("rim", 6.0))
    set_camera(objs, w, h, frames_setup=on_frame, nframes=nframes, **opts)
    sheet = np.zeros((h, w * nframes, 4), np.float32)
    for f in range(nframes):
        if on_frame:
            on_frame(f)
        pm = render_frame(w, h, f"{name}_{f}")
        if glow:
            pm = add_glow(pm, **glow)
        if post:
            pm = post(pm)
        sheet[:, f * w:(f + 1) * w] = pm
    fn = filename or f"{name}.png"
    write_png(os.path.join(OUT_DIR, fn), to_uint8(sheet))
    dt = time.time() - t0
    print(f"[props] {fn}: {nframes} x {w}x{h} in {dt:.1f}s")
    return dict(file=fn, frame_width=w, frame_height=h, frames=nframes, pivot=list(pivot))


ASSETS = [
    ("coin", lambda: render_asset("coin", build_coin, 40, 40, 12, "coin_sheet.png", pivot=(0.5, 0.5))),
    ("gem", lambda: render_asset("gem", build_gem, 40, 40, 12, "gem_sheet.png", pivot=(0.5, 0.5))),
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
]

DESCRIPTIONS = {
    "coin": "Gold coin spinning about its vertical axis; 12 frames over 180 degrees, loops.",
    "gem": "Floating soul gem, glowing teal/violet; 12 frames over a quarter turn, loops.",
    "potion_red": "Health potion flask (red).",
    "potion_green": "Stamina potion flask (green).",
    "chest": "Treasure chest: frame 0 closed, frame 1 open with glow.",
    "shrine": "Checkpoint shrine / obelisk: frame 0 unlit, frame 1 lit rune.",
    "skull": "Small weathered skull (ground decoration).",
    "gravestone1": "Rounded gravestone with carved cross.",
    "gravestone2": "Stone cross on a plinth, chipped arm.",
    "gravestone3": "Tilted slab with broken corner.",
    "torch": "Wall-mounted iron torch bracket, no flame (flame animated in-game). Wall is behind.",
    "pillar": "Broken fluted gothic pillar with rubble.",
    "cage": "Hanging gibbet cage with skeleton; pivot at the chain top.",
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
                 "[0.5, 0.0] = top centre for hanging props.",
        "sprites": {k: meta[k] for k, _ in ASSETS if k in meta},
    }
    with open(json_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"[props] done in {time.time() - t0:.1f}s -> {OUT_DIR}")


if __name__ == "__main__":
    main()
