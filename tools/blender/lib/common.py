"""Scene, material, colour and mesh helpers shared by every asset script.

Conventions (see tools/blender/README.md):
  * 1 Blender unit = 1 metre. Z is up. Characters face -Y (towards a front-view camera);
    the glTF exporter converts to +Y up, so in three.js they face +Z.
  * Everything is built from bmesh primitives in world space, flat shaded, coloured with a
    per-corner colour attribute ("Color") that the glTF exporter writes as COLOR_0.
"""
import math
import os
import random
import sys
import zlib

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


# ---------------------------------------------------------------- arguments / scene

def script_args():
    """Arguments after `--` on the Blender command line, as a dict of --key value pairs."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--"):
            key = argv[i][2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[key] = argv[i + 1]
                i += 2
            else:
                out[key] = True
                i += 1
        else:
            i += 1
    return out


def reset_scene(fps=30):
    """Empty the default scene and set units/frame rate."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions,
                 bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for block in list(coll):
            coll.remove(block)
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------- materials

_MATS = {}


def material(name, roughness=0.65, metallic=0.25, emissive=None, emissive_strength=4.0):
    """Principled material whose base colour comes straight from the "Color" attribute.

    A Color Attribute node wired directly into Base Color is what makes the glTF exporter
    emit COLOR_0 (three.js multiplies it with material.color, which is how accent tints work).
    `emissive` (rgb) makes an unlit-looking glow material for eyes, lamps and screens.
    """
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Color"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    if emissive is not None:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    _MATS[name] = mat
    return mat


# ---------------------------------------------------------------- colour

def hexrgb(h):
    """'#rrggbb' -> linear-ish float tuple (Blender byte colours are stored sRGB)."""
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def shade(rgb, k):
    return tuple(max(0.0, min(1.0, c * k)) for c in rgb)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def paint(obj, rgb, jitter=0.0, ao=0.35, seed=0):
    """Fill the "Color" attribute: base colour, per-face value jitter and a cheap fake AO
    that darkens downward-facing faces. Gives flat-shaded low-poly a worn, lit look."""
    if isinstance(rgb, str):
        rgb = hexrgb(rgb)
    me = obj.data
    attr = me.color_attributes.get("Color") or me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    rnd = random.Random(seed or hash(obj.name) & 0xFFFF)
    for poly in me.polygons:
        k = 1.0 + (rnd.uniform(-jitter, jitter) if jitter else 0.0)
        k *= 1.0 - ao * max(0.0, -poly.normal.z)
        c = shade(rgb, k)
        for li in poly.loop_indices:
            attr.data[li].color = (*c, 1.0)
    return obj


def weather(obj, worn="#9a968a", dirt="#2a2419", chip=0.7, fleck=0.03, grime=0.9, mud=0.35, scorch=0.05, stains=True,
            seed=None):
    """Battle wear over the painted colours (call after paint):
      * paint chipped back to bare metal along bevelled edges (`chip` of the bevel strips) and
        the odd fleck on a plate (`fleck` of the other faces);
      * grime rising from the ground to `grime` metres - per corner, so it fades up each plate;
      * mud splashed over the faces below `mud` metres;
      * scorch marks (`scorch` of the faces), and soot and dust stains in patches (`stains`).
    Deterministic per object name (or `seed`)."""
    me = obj.data
    attr = me.color_attributes.get("Color")
    if attr is None:
        return obj
    edge = me.attributes.get("edge")
    rnd = random.Random(seed if seed is not None else zlib.crc32(obj.name.encode()))
    W, D = hexrgb(worn), hexrgb(dirt)
    mw = obj.matrix_world
    zs = [(mw @ v.co).z for v in me.vertices]
    for poly in me.polygons:
        lis = list(poly.loop_indices)
        c = tuple(attr.data[lis[0]].color[:3])
        on_edge = edge is not None and edge.data[poly.index].value
        if rnd.random() < (chip if on_edge else fleck):
            c = mix(c, W, rnd.uniform(0.4, 0.8) if on_edge else rnd.uniform(0.15, 0.3))
        if rnd.random() < scorch:
            c = shade(c, rnd.uniform(0.4, 0.65))
        # Soot and dust in patches that run across neighbouring plates (hashed by world cell).
        p = mw @ poly.center
        cell = zlib.crc32(f"{math.floor(p.x / 0.13)},{math.floor(p.y / 0.13)},{math.floor(p.z / 0.13)}".encode())
        if stains and cell % 100 < 16:
            c = shade(c, 0.55 + (cell // 100 % 20) / 100)
        elif stains and cell % 100 > 90:
            c = mix(c, D, 0.35)
        if mud and (mw @ poly.center).z < mud and rnd.random() < 0.4:
            c = mix(c, D, rnd.uniform(0.5, 0.85))
        k = rnd.uniform(0.55, 0.85)
        for li in lis:
            z = zs[me.loops[li].vertex_index]
            g = ((grime - z) / grime) ** 1.3 * k if grime and z < grime else 0.0
            attr.data[li].color = (*mix(c, D, g), 1.0)
    return obj


# ---------------------------------------------------------------- bmesh primitives
# All primitives return a fresh bmesh already transformed into world space.

def _xform(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    m = Matrix.Translation(Vector(loc)) @ Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()
    if scale is not None:
        m = m @ Matrix.Diagonal((*scale, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def _bevel(bm, amount, segments=1):
    if amount > 0:
        # Tag the bevel strips: weather() wears the paint off along them (chipped edges). The layer
        # must exist before the bevel - adding one afterwards invalidates the faces it returns.
        layer = bm.faces.layers.int.get("edge") or bm.faces.layers.int.new("edge")
        res = bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=amount, segments=segments,
                              affect="EDGES", profile=0.5, clamp_overlap=True)
        for f in res["faces"]:
            f[layer] = 1
    return bm


def box(size, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, seg=1, taper=None):
    """Axis box of `size` (x, y, z) centred at `loc`. `taper`=(sx, sy) scales the top face,
    which is how most armour plates and consoles get their wedge shapes."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
        if taper and v.co.z > 0:
            v.co.x *= taper[0]
            v.co.y *= taper[1]
    _bevel(bm, bevel, seg)
    return _xform(bm, loc, rot)


def cyl(r, depth, loc=(0, 0, 0), rot=(0, 0, 0), verts=8, r2=None, cap=True, bevel=0.0):
    """Cylinder (or cone/frustum when r2 is given) along local Z."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=verts,
                          radius1=r, radius2=r if r2 is None else r2, depth=depth)
    _bevel(bm, bevel)
    return _xform(bm, loc, rot)


def sphere(r, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), seg=10, rings=6, cut=None):
    """UV sphere; `cut`='bottom'/'top'/'back'... removes the verts on that side (domes, pads)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    if cut:
        axis, sign = {"bottom": (2, -1), "top": (2, 1), "back": (1, 1), "front": (1, -1),
                      "left": (0, 1), "right": (0, -1)}[cut]
        doomed = [v for v in bm.verts if v.co[axis] * sign > 1e-4]
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    return _xform(bm, loc, rot, scale)


def prism(points, depth, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
    """Extrude a 2D outline given in the XZ plane by `depth` along Y (centred).
    Good for side-profile shapes: door frames, stair stringers, blades, pauldron rims."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, -depth / 2, z)) for x, z in points]
    face = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, depth, 0), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _bevel(bm, bevel)
    return _xform(bm, loc, rot)


def merge(*bms):
    """Concatenate several bmeshes into one (inputs are freed)."""
    out = bmesh.new()
    for bm in bms:
        me = bpy.data.meshes.new("_tmp")
        bm.to_mesh(me)
        bm.free()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
    return out


# ---------------------------------------------------------------- objects

def part(name, bm, mat, rgb, bone=None, jitter=0.04, ao=0.35):
    """Turn a bmesh into a coloured object. `bone` = vertex group weighted 100% to that bone
    (rigid skinning: armour pieces move with exactly one bone, no weight painting)."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    me.materials.append(mat)
    paint(obj, rgb, jitter=jitter, ao=ao)
    if bone:
        vg = obj.vertex_groups.new(name=bone)
        vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    return obj


def join(objs, name):
    """Join objects into one mesh object (vertex groups, materials and colours merge by name)."""
    target = objs[0]
    with bpy.context.temp_override(active_object=target, object=target,
                                   selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def empty(name, loc=(0, 0, 0), size=0.1):
    obj = link(bpy.data.objects.new(name, None))
    obj.empty_display_size = size
    obj.location = loc
    return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def out_dir(args, key="out", default="public/assets/models"):
    path = os.path.abspath(args.get(key, default))
    os.makedirs(path, exist_ok=True)
    return path
