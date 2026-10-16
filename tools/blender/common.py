"""Shared toolkit for the model scripts (run with `blender --background --python <script> -- out.glb`
or plain `python` with the `bpy` module installed).

Conventions
- Units are world pixels: a 32 px tile is 32 units. Characters face +X; Blender is Z-up, the glTF
  exporter converts to Y-up so +X stays screen-right and +Z becomes screen-up.
- Low-poly bmesh parts with per-corner vertex colours; weathering (edge wear, grime, rust, scratches)
  is baked into the colours, there are no textures.
- Rigid skinning: every vertex belongs to exactly one bone (weight 1).
- Clips are authored as poses per keyframe with semantic rotations (`swing` = tip toward +X,
  `side` = tip toward +Y, `twist` = about the bone) so the author never thinks about bone roll.
- Every model is exported as GLB plus `<name>.meta.json` describing bones, the upper-body bone set,
  clips (loop, fps, frames, events) and attachment points, checked by tools/check-glb.mjs.
"""
import bpy
import bmesh
import json
import math
import os
import random
import sys
from mathutils import Vector, Matrix, Euler

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MODELS = os.path.join(ROOT, 'assets', 'models')
FPS = 24


def out_path(default_name):
    """GLB path: the argument after `--` when run under Blender, else assets/models/<name>.glb."""
    argv = sys.argv
    if '--' in argv and len(argv) > argv.index('--') + 1:
        return argv[argv.index('--') + 1]
    for a in argv[1:]:
        if a.endswith('.glb'):
            return a
    os.makedirs(MODELS, exist_ok=True)
    return os.path.join(MODELS, default_name + '.glb')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.unit_settings.system = 'NONE'
    return scene


# ------------------------------------------------------------------------------- colours ----

def hexc(h):
    return ((h >> 16 & 255) / 255.0, (h >> 8 & 255) / 255.0, (h & 255) / 255.0)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def mul(c, k):
    return tuple(min(1.0, max(0.0, v * k)) for v in c)


def weathered(color, rs, nz, wear=0.5, grime=0.5, rust=0.08, scratch=0.06):
    """A corner colour for a face whose normal has vertical component nz (Blender Z-up)."""
    c = list(color)
    j = 1.0 + rs.uniform(-0.05, 0.05)
    c = [v * j for v in c]
    if nz > 0.5:            # tops catch light and wear paler
        c = [v * (1.0 + 0.10 * wear) for v in c]
    elif nz < -0.5:         # undersides collect grime
        c = [v * (1.0 - 0.28 * grime) for v in c]
    else:
        c = [v * (1.0 - 0.08 * grime) for v in c]
    r = rs.random()
    if r < rust:
        c = list(mix(c, (0.42, 0.22, 0.10), 0.55))
    elif r < rust + scratch:
        c = [v * 1.18 + 0.04 for v in c]
    if rs.random() < 0.3 * grime:
        c = [v * (1.0 - rs.uniform(0.05, 0.22)) for v in c]
    return (min(1.0, max(0.0, c[0])), min(1.0, max(0.0, c[1])), min(1.0, max(0.0, c[2])), 1.0)


# ----------------------------------------------------------------------------- geometry ----

class PartMesh:
    """One mesh object made of boxes, plates and cylinders, each painted and bound to a bone."""

    def __init__(self, name, seed=1):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')
        self.rs = random.Random(seed)
        self.groups = {}            # bone -> set of vert indices (assigned at build)
        self._pending = []          # (verts, bone)
        self.faces_emissive = []    # faces marked emissive (second material)
        self.emit = self.bm.faces.layers.int.new('emit')

    def _paint(self, faces, color, wear, grime, rust, scratch):
        for f in faces:
            nz = f.normal.z if f.normal.length > 0 else 0.0
            for l in f.loops:
                l[self.col] = weathered(color, self.rs, nz, wear, grime, rust, scratch)

    def _add(self, geom, bone, color, wear=0.5, grime=0.5, rust=0.08, scratch=0.06, emissive=False):
        verts = [g for g in geom if isinstance(g, bmesh.types.BMVert)]
        faces = [g for g in geom if isinstance(g, bmesh.types.BMFace)]
        if not faces:
            faces = list({f for v in verts for f in v.link_faces})
        self.bm.normal_update()
        self._paint(faces, color, wear, grime, rust, scratch)
        if emissive:
            for f in faces:
                f[self.emit] = 1
        self._pending.append((verts, bone))
        return verts, faces

    def box(self, center, size, color, bone=None, rot=(0, 0, 0), wear=0.5, grime=0.5, rust=0.08, scratch=0.06, emissive=False):
        """An axis-aligned box of `size` (sx, sy, sz) at `center`, rotated by `rot` degrees (XYZ)."""
        cx, cy, cz = center
        sx, sy, sz = size
        before = set(self.bm.verts)
        geom = bmesh.ops.create_cube(self.bm, size=1.0)['verts']
        verts = list(geom)
        m = Matrix.Translation(Vector(center)) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((sx, sy, sz, 1.0))
        for v in verts:
            v.co = m @ v.co
        faces = list({f for v in verts for f in v.link_faces})
        return self._add(verts + faces, bone, color, wear, grime, rust, scratch, emissive)

    def plate(self, center, size, color, bone=None, rot=(0, 0, 0), thickness=2.0, **kw):
        """A thin panel: size is (w, h) in its local XZ plane, thickness along local Y."""
        return self.box(center, (size[0], thickness, size[1]), color, bone, rot, **kw)

    def cylinder(self, center, radius, height, color, bone=None, segments=8, axis='Z', rot=(0, 0, 0), **kw):
        geom = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=height)['verts']
        verts = list(geom)
        if axis == 'X':
            base = Euler((0, math.radians(90), 0), 'XYZ').to_matrix().to_4x4()
        elif axis == 'Y':
            base = Euler((math.radians(90), 0, 0), 'XYZ').to_matrix().to_4x4()
        else:
            base = Matrix.Identity(4)
        m = Matrix.Translation(Vector(center)) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ base
        for v in verts:
            v.co = m @ v.co
        faces = list({f for v in verts for f in v.link_faces})
        return self._add(verts + faces, bone, color, **kw)

    def wedge(self, center, size, color, bone=None, rot=(0, 0, 0), **kw):
        """A triangular prism: a box whose top edge on the -X side is collapsed (sloping top)."""
        verts, faces = self.box(center, size, color, bone, rot, **kw)
        # collapse the two top vertices on the -X side down to the bottom
        cx, cy, cz = center
        sx, sy, sz = size
        inv = (Matrix.Translation(Vector(center)) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()).inverted()
        for v in verts:
            lc = inv @ v.co
            if lc.x < 0 and lc.z > 0:
                lc.z = -sz / 2
                v.co = inv.inverted() @ lc
        bmesh.ops.remove_doubles(self.bm, verts=verts, dist=0.01)
        return verts, faces

    def tint(self, verts, color):
        for v in verts:
            for l in v.link_loops:
                l[self.col] = (*color, 1.0)

    def build(self, rig=None, emissive_color=(1.0, 0.7, 0.4), emissive_strength=3.0):
        bm = self.bm
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        # tag vertex groups by vertex index now that the table is stable
        index_groups = {}
        for verts, bone in self._pending:
            if bone is None:
                continue
            index_groups.setdefault(bone, set()).update(v.index for v in verts)
        emissive_faces = [f.index for f in bm.faces if f[self.emit] == 1]
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        if hasattr(me, 'color_attributes') and len(me.color_attributes):
            me.color_attributes.active_color_index = 0
            me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        # materials: vertex colour; a second emissive slot for lamps and screens
        mat = bpy.data.materials.new(self.name + '_vc')
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.85
        me.materials.append(mat)
        if emissive_faces:
            em = bpy.data.materials.new(self.name + '_emit')
            em.use_nodes = True
            nt2 = em.node_tree
            b2 = nt2.nodes['Principled BSDF']
            vc2 = nt2.nodes.new('ShaderNodeVertexColor')
            vc2.layer_name = 'Col'
            nt2.links.new(vc2.outputs['Color'], b2.inputs['Base Color'])
            b2.inputs['Emission Color'].default_value = (*emissive_color, 1.0)
            b2.inputs['Emission Strength'].default_value = emissive_strength
            me.materials.append(em)
            for i in emissive_faces:
                me.polygons[i].material_index = 1
        if rig is not None:
            for bone, idx in index_groups.items():
                vg = ob.vertex_groups.new(name=bone)
                vg.add(sorted(idx), 1.0, 'REPLACE')
            mod = ob.modifiers.new('Armature', 'ARMATURE')
            mod.object = rig
            ob.parent = rig
        return ob


# ------------------------------------------------------------------------------- rigs ----

def make_rig(name, bones):
    """bones: list of dicts {name, parent, head, tail}. Returns the armature object."""
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in bones:
        e = arm.edit_bones.new(b['name'])
        e.head = Vector(b['head'])
        e.tail = Vector(b['tail'])
        e.roll = 0.0
        if b.get('parent'):
            e.parent = eb[b['parent']]
        eb[b['name']] = e
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.rotation_mode = 'XYZ'
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    return rig


def _local_axis_for(bone, world_axis):
    """(index, sign) of the bone's local axis most aligned with a world direction."""
    m = bone.matrix_local.to_3x3()
    best, bi, bs = -1.0, 0, 1.0
    for i in range(3):
        ax = Vector((m[0][i], m[1][i], m[2][i]))
        d = ax.dot(Vector(world_axis))
        if abs(d) > best:
            best, bi, bs = abs(d), i, (1.0 if d >= 0 else -1.0)
    return bi, bs


def pose_rotation(rig, bone_name, swing=0.0, side=0.0, twist=0.0):
    """Euler (XYZ, radians) in the bone's local frame for semantic rotations in degrees:
    swing moves the tip toward +X, side moves the tip toward +Y, twist spins about the bone."""
    bone = rig.data.bones[bone_name]
    m = bone.matrix_local.to_3x3()
    axis_dir = Vector((m[0][1], m[1][1], m[2][1]))          # the bone's own direction (local Y)
    rot = [0.0, 0.0, 0.0]
    if swing:
        # rotation about world Y: tip toward +X is +theta for upward bones, -theta for downward ones
        i, s = _local_axis_for(bone, (0, 1, 0))
        sign_dir = 1.0 if axis_dir.z >= 0 else -1.0
        if abs(axis_dir.z) < 0.5:                             # horizontal bone (tail, gun): tip +X means pitch
            sign_dir = -1.0 if axis_dir.x >= 0 else 1.0
        rot[i] += math.radians(swing) * s * sign_dir
    if side:
        i, s = _local_axis_for(bone, (1, 0, 0))
        sign_dir = -1.0 if axis_dir.z >= 0 else 1.0
        rot[i] += math.radians(side) * s * sign_dir
    if twist:
        rot[1] += math.radians(twist)
    return Euler(rot, 'XYZ')


def make_clip(rig, name, keys, fps=FPS, loop=True, root='hips'):
    """keys: {frame: {bone: {swing, side, twist, loc:(x,y,z)}}}. Creates and returns the action.
    Bones not mentioned at a frame keep their previous key (the exporter samples every frame)."""
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    frames = sorted(keys)
    # every bone that appears anywhere gets a key on every listed frame so interpolation is explicit
    bones = sorted({b for f in frames for b in keys[f]})
    last = {b: {} for b in bones}
    for f in frames:
        for b in bones:
            spec = keys[f].get(b, last[b])
            last[b] = spec
            pb = rig.pose.bones[b]
            pb.rotation_euler = pose_rotation(rig, b, spec.get('swing', 0.0), spec.get('side', 0.0), spec.get('twist', 0.0))
            pb.keyframe_insert('rotation_euler', frame=f)
            if 'loc' in spec or b == root:
                loc = Vector(spec.get('loc', (0.0, 0.0, 0.0)))
                # world offset -> the bone's local frame
                inv = rig.data.bones[b].matrix_local.to_3x3().inverted()
                pb.location = inv @ loc
                pb.keyframe_insert('location', frame=f)
    if loop and frames and frames[-1] != frames[0]:
        # close the loop: repeat the first frame's pose one frame after the last key
        f0, fl = frames[0], frames[-1]
        for b in bones:
            spec = keys[f0].get(b, {})
            pb = rig.pose.bones[b]
            pb.rotation_euler = pose_rotation(rig, b, spec.get('swing', 0.0), spec.get('side', 0.0), spec.get('twist', 0.0))
            pb.keyframe_insert('rotation_euler', frame=fl + (frames[1] - frames[0] if len(frames) > 1 else 1))
            if 'loc' in spec or b == root:
                inv = rig.data.bones[b].matrix_local.to_3x3().inverted()
                pb.location = inv @ Vector(spec.get('loc', (0.0, 0.0, 0.0)))
                pb.keyframe_insert('location', frame=fl + (frames[1] - frames[0] if len(frames) > 1 else 1))
    for fc in action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    act.use_fake_user = True
    return act


def action_fcurves(act):
    """F-curves of an action across the legacy and slotted (Blender 4.4+) APIs."""
    if hasattr(act, 'fcurves'):
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


# ----------------------------------------------------------------------------- export ----

def _gltf_kwargs(**kw):
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    return {k: v for k, v in kw.items() if k in props}


def export(path, meta, rig=None):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    if rig is not None:
        bpy.context.view_layer.objects.active = rig
    kw = _gltf_kwargs(
        filepath=path, export_format='GLB', export_apply=True, export_yup=True,
        export_animations=rig is not None, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_range=False, export_nla_strips=False, export_skins=rig is not None, export_all_influences=False,
        export_def_bones=False, export_vertex_color='MATERIAL', export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True, export_materials='EXPORT', export_normals=True,
        export_texcoords=False, export_cameras=False, export_lights=False, export_extras=False,
        export_optimize_animation_size=False, export_bake_animation=False, use_selection=False,
    )
    bpy.ops.export_scene.gltf(**kw)
    meta_path = os.path.splitext(path)[0] + '.meta.json'
    with open(meta_path, 'w') as fh:
        json.dump(meta, fh, indent=1)
    print('wrote', path, 'and', os.path.basename(meta_path))


def clip_meta(actions, extra=None):
    """Clip entries for the meta: frame counts come from the actions themselves."""
    out = {}
    for act, spec in actions:
        fr = act.frame_range
        out[act.name] = dict(loop=bool(spec.get('loop', True)), fps=FPS, frames=int(round(fr[1] - fr[0])) + 1,
                             events=spec.get('events', {}), upper=bool(spec.get('upper', False)))
    if extra:
        out.update(extra)
    return out
