"""Character helpers shared by marine.py, alien.py and critter.py.

  * extra bmesh primitives: `limb` (tapered prism between two points), `lathe` (surface of
    revolution), `arc_band` (curved strip, e.g. a helmet stripe), `shard` (claws/teeth),
    `plate` (bevelled box oriented between two points);
  * `Poser`: forward kinematics on the rest armature plus solvers that turn world-space
    intent (hand on the rifle grip, foot planted at y, gun pointing forward) into the local
    Euler rotations that `lib.anim.Clip.key` expects;
  * `sampled_clip`: key a clip from a pose function f(t) at a fixed frame step, so IK-solved
    contacts (hands on guns, planted feet) hold between keys;
  * `curve`: piecewise eased interpolation of scalars/tuples for authoring motion.

Nothing here changes the existing lib modules; it only builds on them.
"""
import math

import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector

from .anim import Clip
from .common import _bevel, _xform

# ---------------------------------------------------------------- math helpers


def V(*a):
    return Vector(a[0] if len(a) == 1 else a)


def frame_from_z(direction, side=Vector((1, 0, 0))):
    """3x3 rotation whose Z column is `direction` and X column is as close to `side` as possible."""
    z = Vector(direction).normalized()
    x = Vector(side) - z * Vector(side).dot(z)
    if x.length < 1e-5:
        x = Vector((0, 1, 0)) - z * z.y
    x.normalize()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed()
    return m


def rot_x(deg):
    return Matrix.Rotation(math.radians(deg), 3, "X")


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 3, "Y")


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 3, "Z")


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    if isinstance(a, (tuple, list, Vector)):
        return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))
    return a + (b - a) * t


def curve(t, keys, ease=smooth):
    """Piecewise interpolation of `keys` [(t0, v0), (t1, v1), ...] (t ascending) with easing.
    Values may be numbers or tuples. Outside the range the end values hold."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
            return lerp(v0, v1, ease(u))
    return keys[-1][1]


def wave(t, cycles=1.0, phase=0.0):
    """sin over normalised clip time, periodic for integer `cycles`."""
    return math.sin(2 * math.pi * (t * cycles + phase))


# ---------------------------------------------------------------- mesh primitives


def limb(p0, p1, r0, r1=None, verts=6, side=(1, 0, 0), bevel=0.0, scale=(1, 1), cap=True, twist=0.0):
    """Tapered cylinder/prism from p0 to p1 (radius r0 at p0, r1 at p1). `scale` squashes the
    cross-section (x toward `side`, y perpendicular); `verts`=4 gives a box-like section."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=verts, radius1=r0,
                          radius2=r0 if r1 is None else r1, depth=d.length)
    for v in bm.verts:
        v.co.z += d.length / 2
        v.co.x *= scale[0]
        v.co.y *= scale[1]
    if twist:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(twist), 3, "Z"))
    _bevel(bm, bevel)
    m = Matrix.Translation(p0) @ frame_from_z(d, Vector(side)).to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def plate(p0, p1, w, d, side=(1, 0, 0), bevel=0.0, taper=None, offset=(0, 0)):
    """Box whose local Z runs from p0 to p1; `w` along `side`, `d` perpendicular.
    `taper` scales the p1 end; `offset` shifts the section (x, y) off the axis."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        top = v.co.z > 0
        v.co.x *= w
        v.co.y *= d
        v.co.z = (v.co.z + 0.5) * L
        if taper and top:
            v.co.x *= taper[0]
            v.co.y *= taper[1]
        v.co.x += offset[0]
        v.co.y += offset[1]
    _bevel(bm, bevel)
    m = Matrix.Translation(p0) @ frame_from_z(p1 - p0, Vector(side)).to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def lathe(profile, verts=8, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), cap_bottom=True, cap_top=True,
          phase=0.0):
    """Surface of revolution about local Z. profile = [(radius, z), ...] from bottom to top.
    A radius of 0 at either end collapses to a pole vertex."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            ring = []
            for i in range(verts):
                a = 2 * math.pi * (i + phase) / verts
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
            rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        if len(ra) == 1:
            for i in range(verts):
                bm.faces.new((ra[0], rb[i], rb[(i + 1) % verts]))
        elif len(rb) == 1:
            for i in range(verts):
                bm.faces.new((ra[i], rb[0], ra[(i + 1) % verts]))
        else:
            for i in range(verts):
                bm.faces.new((ra[i], ra[(i + 1) % verts], rb[(i + 1) % verts], rb[i]))
    if cap_bottom and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _xform(bm, loc, rot, scale)


def arc_band(center, radius, a0, a1, width, thick, n=6, axis="X"):
    """Curved band (e.g. helmet stripe, pad rim) following an arc in the plane perpendicular
    to `axis` ('X': arc in YZ). Angles in degrees; 0 = +Z (top), 90 = -Y (front) for axis X."""
    c = Vector(center)
    bm = bmesh.new()
    rows = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        row = []
        for rr in (radius, radius + thick):
            for s in (-width / 2, width / 2):
                if axis == "X":
                    p = c + Vector((s, -rr * math.sin(a), rr * math.cos(a)))
                else:  # arc in XZ plane around Y
                    p = c + Vector((rr * math.sin(a), s, rr * math.cos(a)))
                row.append(bm.verts.new(p))
        rows.append(row)
    # quad loops: 0=(in,-) 1=(in,+) 2=(out,-) 3=(out,+)
    order = [(0, 1), (1, 3), (3, 2), (2, 0)]
    for ra, rb in zip(rows, rows[1:]):
        for i, j in order:
            bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
    bm.faces.new((rows[0][0], rows[0][2], rows[0][3], rows[0][1]))
    bm.faces.new((rows[-1][0], rows[-1][1], rows[-1][3], rows[-1][2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def shard(p0, p1, w, d, bend=None, n=3, side=(1, 0, 0), tip=0.05):
    """Tapered curved spike from p0 (base, w x d section) to p1 (tip). `bend` = world offset
    added to the midpoint (quadratic arc) - claws, horns, teeth, spines."""
    p0, p1 = Vector(p0), Vector(p1)
    mid = (p0 + p1) / 2 + (Vector(bend) if bend else Vector())
    bm = bmesh.new()
    rings = []
    for i in range(n + 1):
        t = i / n
        pos = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * mid + t * t * p1
        tan = 2 * (1 - t) * (mid - p0) + 2 * t * (p1 - mid)
        f = frame_from_z(tan, Vector(side))
        k = (1 - t) + t * tip
        ring = []
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            ring.append(bm.verts.new(pos + f @ Vector((sx * w / 2 * k, sy * d / 2 * k, 0))))
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        for i in range(4):
            bm.faces.new((ra[i], ra[(i + 1) % 4], rb[(i + 1) % 4], rb[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def shell(center, rx, rz, length, arc=200.0, thick=0.03, n=6, rot=(0, 0, 0), taper=1.0):
    """Curved armour/chitin plate: an `arc` (degrees, centred on +Z) of an elliptic tube running
    along local Y, `thick` deep. The rear end (+Y) is scaled by `taper` so stacked plates read as
    overlapping bands. Closed solid; placed at `center` with Euler `rot` (degrees)."""
    bm = bmesh.new()
    g = {}
    for e, (y, k) in enumerate(((-length / 2, 1.0), (length / 2, taper))):
        for layer, dr in enumerate((0.0, thick)):
            for i in range(n + 1):
                a = math.radians(-arc / 2 + arc * i / n)
                g[e, layer, i] = bm.verts.new(((rx * k + dr) * math.sin(a), y, (rz * k + dr) * math.cos(a)))
    for i in range(n):
        bm.faces.new((g[0, 1, i], g[0, 1, i + 1], g[1, 1, i + 1], g[1, 1, i]))
        bm.faces.new((g[0, 0, i], g[1, 0, i], g[1, 0, i + 1], g[0, 0, i + 1]))
        bm.faces.new((g[0, 0, i], g[0, 0, i + 1], g[0, 1, i + 1], g[0, 1, i]))
        bm.faces.new((g[1, 0, i], g[1, 1, i], g[1, 1, i + 1], g[1, 0, i + 1]))
    for i in (0, n):
        bm.faces.new((g[0, 0, i], g[0, 1, i], g[1, 1, i], g[1, 0, i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _xform(bm, center, rot)


def mirror_x(bm):
    """Mirror a bmesh across X (flips winding back so normals stay outward)."""
    bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------- pose solving


def _spec(v):
    if v is None:
        return (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
    if isinstance(v, dict):
        return tuple(v.get("rot", (0, 0, 0))), tuple(v.get("loc", (0, 0, 0)))
    return tuple(v), (0.0, 0.0, 0.0)


def _basis(v):
    rot, loc = _spec(v)
    return Matrix.Translation(Vector(loc)) @ Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()


class Poser:
    """FK on the rest armature (armature object at identity => armature space = world) and
    IK / world-placement solvers that write local Euler degrees into pose dicts."""

    def __init__(self, arm):
        self.arm = arm
        bones = arm.data.bones
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.length = {b.name: b.length for b in bones}
        self.head = {b.name: b.head_local.copy() for b in bones}
        self.tail = {b.name: b.tail_local.copy() for b in bones}
        order, seen = [], set()

        def visit(n):
            if n in seen:
                return
            if self.parent[n]:
                visit(self.parent[n])
            seen.add(n)
            order.append(n)

        for b in bones:
            visit(b.name)
        self.order = order
        self.prev = {}

    def reset(self):
        """Forget Euler continuity (call at the start of each clip)."""
        self.prev = {}

    # -- evaluation
    def fk(self, pose):
        M = {}
        for n in self.order:
            p = self.parent[n]
            F = (M[p] @ self.rest[p].inverted() @ self.rest[n]) if p else self.rest[n].copy()
            M[n] = F @ _basis(pose.get(n))
        return M

    def zero_frame(self, pose, bone, M=None):
        """World matrix `bone` would have with an identity basis (parents posed)."""
        M = M or self.fk(pose)
        p = self.parent[bone]
        return (M[p] @ self.rest[p].inverted() @ self.rest[bone]) if p else self.rest[bone].copy()

    def world(self, pose, bone, local=(0, 0, 0)):
        """World position of a point given in the bone's rest-world coordinates."""
        M = self.fk(pose)
        return M[bone] @ self.rest[bone].inverted() @ Vector(local)

    def world_matrix(self, pose, bone):
        return self.fk(pose)[bone]

    def _euler(self, bone, R3):
        prev = self.prev.get(bone)
        e = R3.to_euler("XYZ", prev) if prev is not None else R3.to_euler("XYZ")
        self.prev[bone] = e.copy()
        return tuple(math.degrees(a) for a in e)

    def _set(self, pose, bone, rot=None, loc=None):
        r0, l0 = _spec(pose.get(bone))
        pose[bone] = {"rot": tuple(rot) if rot is not None else r0, "loc": tuple(loc) if loc is not None else l0}

    def set_world(self, pose, bone, R=None, P=None):
        """Give `bone` world rotation R (3x3, in rest-relative sense: R @ rest_rot) and/or world
        head position P by solving its local rotation/location."""
        F = self.zero_frame(pose, bone)
        rot = loc = None
        if R is not None:
            q = F.to_3x3().inverted() @ (R @ self.rest[bone].to_3x3())
            rot = self._euler(bone, q)
        if P is not None:
            loc = tuple(F.inverted() @ Vector(P))
        self._set(pose, bone, rot, loc)
        return pose

    def set_world_abs(self, pose, bone, R3):
        """Give `bone` an absolute world rotation (columns = bone axes)."""
        F = self.zero_frame(pose, bone)
        self._set(pose, bone, self._euler(bone, F.to_3x3().inverted() @ R3), None)
        return pose

    def follow(self, pose, bone, driver, k, lift=0.0, max_deg=None):
        """Rotate `bone` by fraction k of `driver`'s swing away from its zero-pose direction
        (shoulder pads riding on the upper arms)."""
        M = self.fk(pose)
        F = self.zero_frame(pose, driver, M)
        d0 = F.col[1].xyz.normalized()
        d1 = M[driver].col[1].xyz.normalized()
        axis = d0.cross(d1)
        if axis.length < 1e-6:
            return pose
        ang = d0.angle(d1) * k
        if max_deg is not None:
            ang = min(ang, math.radians(max_deg))
        Rq = Quaternion(axis.normalized(), ang).to_matrix()
        Fb = self.zero_frame(pose, bone, M)
        q = Fb.to_3x3().inverted() @ Rq @ Fb.to_3x3()
        loc = None
        if lift:
            up = (Fb.to_3x3().inverted() @ Vector((0, 0, 1))) * lift * min(1.0, ang / 1.2)
            loc = tuple(up)
        self._set(pose, bone, self._euler(bone, q), loc)
        return pose

    def ik(self, pose, upper, lower, target, pole, hinge=None, tip=0.0, end=None, end_rot=None, iters=2):
        """Two-bone IK: place `lower`'s tail (or a point `tip` further along it) at `target`.
        `pole` (world direction) chooses the bend plane (where the elbow/knee points).
        `hinge` (world vector) fixes the sign of the bend axis; default = upper's zero X.
        `end`/`end_rot`: optionally give the end bone (hand/foot) a world rotation."""
        target = Vector(target)
        pole = Vector(pole)
        M = self.fk(pose)
        Fu = self.zero_frame(pose, upper, M)
        _, uloc = _spec(pose.get(upper))
        S = (Fu @ Matrix.Translation(Vector(uloc))).translation
        L1 = self.length[upper]
        L2 = self.length[lower]
        if hinge is None:
            hinge = Fu.col[0].xyz
        hinge = Vector(hinge)
        goal = target.copy()
        dl_prev = None
        for _ in range(max(1, iters if tip else 1)):
            if tip and dl_prev is not None:
                goal = target - dl_prev * tip
            d = goal - S
            D = max(abs(L1 - L2) + 1e-3, min(d.length, (L1 + L2) * 0.9995))
            t = d.normalized()
            p = pole - t * pole.dot(t)
            if p.length < 1e-6:
                p = Vector((0, -1, 0)) - t * t.y
            p.normalize()
            ca = max(-1.0, min(1.0, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)))
            a = math.acos(ca)
            E = S + (t * math.cos(a) + p * math.sin(a)) * L1
            W = S + t * D
            du = (E - S).normalized()
            dl = (W - E).normalized()
            dl_prev = dl
            if not tip:
                break
        n = du.cross(dl)
        if n.length < 1e-6:
            n = p.cross(t)
        n.normalize()
        if n.dot(hinge) < 0:
            n = -n
        Ru = Matrix((n, du, n.cross(du))).transposed()
        self._set(pose, upper, self._euler(upper, Fu.to_3x3().inverted() @ Ru), None)
        M = self.fk(pose)
        Fl = self.zero_frame(pose, lower, M)
        Rl = Matrix((n, dl, n.cross(dl))).transposed()
        self._set(pose, lower, self._euler(lower, Fl.to_3x3().inverted() @ Rl), None)
        if end and end_rot is not None:
            self.set_world_abs(pose, end, end_rot)
        return pose


# ---------------------------------------------------------------- clip sampling


def sampled_clip(arm, poser, name, frames, fn, loop=True, step=2, **meta):
    """Key clip `name` from pose function fn(t) (t in [0, 1]) every `step` frames.
    Loops key t=1 too, so fn must be periodic. Returns Clip.done() metadata."""
    poser.reset()
    clip = Clip(arm, name, frames, loop, **meta)
    fs = list(range(0, frames, step)) + [frames]
    for f in fs:
        t = f / frames
        pose = fn(t)
        clip.key(1 + f, pose)
    return clip.done()


# ---------------------------------------------------------------- review renders


def review_sheet(arm, clips, path, target, height, yaws=(90.0,), cols=6, tile=240, pitch=8.0, names=None):
    """Like preview.contact_sheet but with several camera yaws per clip (rows = clip x yaw).
    Used for art review only (side, 3/4 and back views)."""
    import os
    import tempfile

    import bpy
    import numpy as np

    from .preview import _camera, _render_to_array, _save, _setup

    _setup((tile, tile))
    ad = arm.animation_data
    tmp = tempfile.mkdtemp()
    rows = []
    wanted = [c for c in clips if names is None or c["name"] in names]
    for clip in wanted:
        action = bpy.data.actions[clip["name"]]
        ad.action = action
        if hasattr(ad, "action_slot") and ad.action_slot is None and len(action.slots):
            ad.action_slot = action.slots[0]
        first, last = action.frame_range
        for yaw in yaws:
            cam = _camera(target, height, yaw, pitch)
            row = []
            for c in range(cols):
                f = first + (last - first) * c / max(1, cols - (1 if not clip["loop"] else 0))
                bpy.context.scene.frame_set(int(round(f)))
                row.append(_render_to_array(os.path.join(tmp, f"r{c}.png")))
            rows.append(np.concatenate(row, axis=1))
            bpy.data.objects.remove(cam, do_unlink=True)
    ad.action = None
    _save(np.concatenate(rows[::-1], axis=0), path)


def turnaround(arm, clip_name, t, path, target, height, yaws=(35.0, 90.0, -90.0, 180.0), tile=480, pitch=8.0):
    """One row of large views of a single clip frame (t = normalised clip time)."""
    import os
    import tempfile

    import bpy
    import numpy as np

    from .preview import _camera, _render_to_array, _save, _setup

    _setup((tile, tile))
    ad = arm.animation_data
    action = bpy.data.actions[clip_name]
    ad.action = action
    if hasattr(ad, "action_slot") and ad.action_slot is None and len(action.slots):
        ad.action_slot = action.slots[0]
    first, last = action.frame_range
    bpy.context.scene.frame_set(int(round(first + (last - first) * t)))
    tmp = tempfile.mkdtemp()
    row = []
    for yaw in yaws:
        cam = _camera(target, height, yaw, pitch)
        row.append(_render_to_array(os.path.join(tmp, "t.png")))
        bpy.data.objects.remove(cam, do_unlink=True)
    ad.action = None
    _save(np.concatenate(row, axis=1), path)


# ---------------------------------------------------------------- paint


def paint_camo(obj, palette, cell=0.07, ao=0.3, seed=7):
    """Blotchy disruptive camo: each face takes a palette colour hashed from the world-space
    cell its centre falls in (neighbouring faces share patches instead of confetti noise)."""
    from .common import hexrgb, shade

    me = obj.data
    attr = me.color_attributes.get("Color") or me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    cols = [hexrgb(c) if isinstance(c, str) else c for c in palette]
    for poly in me.polygons:
        c = obj.matrix_world @ poly.center
        key = (math.floor(c.x / cell + 0.6 * math.sin(c.z * 23.0)), math.floor(c.y / cell + 0.6 * math.sin(c.x * 19.0)),
               math.floor(c.z / cell), seed)
        rgb = cols[hash(key) % len(cols)]
        k = 1.0 - ao * max(0.0, -poly.normal.z)
        for li in poly.loop_indices:
            attr.data[li].color = (*shade(rgb, k), 1.0)
    return obj


def lineup(arm, clip_name, t, path, setups, target, height, yaws=(35.0, 90.0), tile=400, pitch=8.0):
    """Grid of stills of one clip frame: rows = camera yaws, columns = `setups` callbacks run
    before each render (e.g. toggling which loadout meshes are visible)."""
    import os
    import tempfile

    import bpy
    import numpy as np

    from .preview import _camera, _render_to_array, _save, _setup

    _setup((tile, tile))
    ad = arm.animation_data
    action = bpy.data.actions[clip_name]
    ad.action = action
    if hasattr(ad, "action_slot") and ad.action_slot is None and len(action.slots):
        ad.action_slot = action.slots[0]
    first, last = action.frame_range
    bpy.context.scene.frame_set(int(round(first + (last - first) * t)))
    tmp = tempfile.mkdtemp()
    rows = []
    for yaw in yaws:
        cam = _camera(target, height, yaw, pitch)
        row = []
        for i, setup in enumerate(setups):
            setup()
            row.append(_render_to_array(os.path.join(tmp, f"l{i}.png")))
        rows.append(np.concatenate(row, axis=1))
        bpy.data.objects.remove(cam, do_unlink=True)
    ad.action = None
    _save(np.concatenate(rows[::-1], axis=0), path)
