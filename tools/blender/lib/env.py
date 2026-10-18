"""Environment-art helpers for props.py and roomkit.py (static, non-skinned pieces).

  * `Geo`: accumulates bmesh parts into ONE mesh object, baking per-face colour (jitter, top
    light, fake AO, key light from the upper left) or per-corner gradients (`vfn`), plus an
    optional per-vertex grime function (`wall_grime` / `prop_grime`: floor darkening, depth
    occlusion, noise stains). Faces of several materials (M_Base + glow variants) can live in
    the same object. `squash()` compresses relief into a contract limit, `absorb()` merges.
  * Materials: `mat()` - M_Base, M_Glow (teal-cyan), M_GlowRed, M_GlowWhite, M_GlowAmber.
    `PAL` is the shared environment palette.
  * Extra shapes: `bx` (min/max box), `tube` (cables, bent pipes, tapered tendrils), `pipe`,
    `sag`, `studs` (bolt heads), `inset`/`plate` (bevelled inset panels), `ring` (frames around
    openings, nothing inside), `stripes` (hazard stripes clipped to a rectangle), `flat`/`quad`
    (single-polygon decals), `blob`/`lump` (rust, slime, resin, rubble), `stencil` (pixel-font
    lettering), `yz_prism` (side-profile extrusions along X).
  * Checks: `check_extent()` (contract bounds), `check_clear()` (openings stay see-through).
  * Preview: `sheet()` renders one labelled Workbench still per piece and tiles them;
    `render_view()` renders a whole scene (mock-ups); `inst()` copies a piece (with hinged
    children); `camera()`.

Conventions follow tools/blender/README.md: Z up, the camera looks from -Y, so the -Y side
carries the detail and faces pointing +Y (into the back wall) can be culled.
"""
import math
import os
import random
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

from .common import box, cyl, hexrgb, link, material, prism  # noqa: F401  (re-exported)
from . import preview as _pv

# ---------------------------------------------------------------- materials

GLOWS = {   # emissive strengths tuned against the game's bloom (threshold 0.82, ACES 1.15)
    "glow": ("M_Glow", (0.22, 0.95, 0.85), 1.4),        # screens / reactor rings (teal-cyan)
    "red": ("M_GlowRed", (1.0, 0.10, 0.05), 3.0),       # emergency lamps
    "white": ("M_GlowWhite", (0.85, 0.93, 1.0), 2.2),   # cold work lights
    "amber": ("M_GlowAmber", (1.0, 0.55, 0.12), 2.0),   # small indicator buttons
    "blue": ("M_GlowBlue", (0.3, 0.55, 1.0), 1.6),      # idling thrusters (faint)
    "pink": ("M_GlowPink", (1.0, 0.4, 0.85), 1.6),      # grow lamps (hydroponics)
    "green": ("M_GlowGreen", (0.35, 1.0, 0.45), 1.6),   # status lamps
    "rarity": ("M_Rarity", (1.0, 1.0, 1.0), 1.6),       # loot strip: white, the engine tints per rarity
}


def mat(key):
    if key == "base":
        return material("M_Base", roughness=0.72, metallic=0.3)
    name, rgb, strength = GLOWS[key]
    return material(name, roughness=0.4, metallic=0.0, emissive=rgb, emissive_strength=strength)


# display colours for glow faces (what Workbench previews and the base colour show)
GLOW_RGB = {"glow": "#5ff0d8", "red": "#ff3a22", "white": "#e8f2ff", "amber": "#ffae3a", "blue": "#6aa0ff",
            "pink": "#ff6ad0", "green": "#5aff78", "rarity": "#ffffff"}

# Shared environment palette (README art direction: gunmetal, rust, grime, sparse hazard yellow).
PAL = {
    # structure
    "back": "#15181a", "rib": "#262a2e", "panel": "#353a3e", "panel2": "#2f3337", "panel3": "#282c30",
    "kick": "#1e2124", "steel": "#484f55", "steel_lt": "#5f676e", "dark": "#121416", "void": "#050607",
    # wear
    "rust": "#5a3a22", "rust2": "#6b4427", "rust_dk": "#3a2618", "haz": "#a8852a", "haz_dk": "#151618",
    "grime": "#1a1c1c",
    # services
    "pipe": "#3e454b", "pipe_cu": "#5a4230", "pipe_g": "#34413c", "cable": "#131416", "cable_r": "#4c1f1b",
    "cable_y": "#7d6726", "stencil": "#6a695e", "stencil_y": "#7a6630", "screen": "#0b2220", "valve": "#6a2a22",
    # organics
    "slime": "#56782c", "slime_lt": "#88b242", "slime_dk": "#324c1d", "resin": "#34202a", "resin2": "#4a2438",
    "resin3": "#6a3a50", "web": "#a09f92",
    # prop materials
    "olive": "#454c35", "olive_dk": "#363c2a", "orange": "#6e4020", "drum": "#5e3322", "container": "#55291f",
    "med": "#686b64", "cross": "#8e1f19", "blood": "#3e100e", "leather": "#2a2420", "cloth": "#4a4e44",
    "cloth_lt": "#6d6c60", "blanket": "#3b4230", "brass": "#6d5733",
}


# ---------------------------------------------------------------- small maths

def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _rgb(c):
    return hexrgb(c) if isinstance(c, str) else tuple(c)


def _shade(rgb, k):
    return tuple(max(0.0, min(1.0, c * k)) for c in rgb)


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


# ---------------------------------------------------------------- mesh builder

class Geo:
    """Collects coloured bmesh parts; `build()` turns them into one flat-shaded mesh object."""

    def __init__(self, seed=1):
        self.v = []
        self.f = []
        self.fc = []
        self.fm = []
        self.rnd = random.Random(seed)

    def add(self, bm, rgb, m="base", jitter=0.05, top=0.35, ao=0.55, side=0.15, fn=None, cull=None, vfn=None):
        """Add a bmesh (freed). `fn(face, rgb) -> rgb` overrides colour per face; `vfn(co, rgb) -> rgb`
        colours per corner (gradients: fading streaks, wet highlights). `cull` = list of
        directions; faces whose normal points along one of them are dropped (hidden sides).
        Baked shading: top faces lighter, down faces darker (fake AO), and a key light from the
        upper left so bevels read as lit/shadowed edges in the flat side view."""
        bm.normal_update()
        if cull:
            dirs = [Vector(d).normalized() for d in cull]
            dead = [f for f in bm.faces if any(f.normal.dot(d) > 0.985 for d in dirs)]
            if dead:
                bmesh.ops.delete(bm, geom=dead, context="FACES_ONLY")
        bm.verts.index_update()
        base = len(self.v)
        self.v.extend(v.co.copy() for v in bm.verts)
        col = _rgb(rgb)
        glow = m != "base"
        for face in bm.faces:
            n = face.normal
            c = _rgb(fn(face, col)) if fn else col
            if glow:
                k = 1.0 - 0.15 * max(0.0, -n.z)
            else:
                k = 1.0 + self.rnd.uniform(-jitter, jitter)
                k *= 1.0 + top * max(0.0, n.z) - ao * max(0.0, -n.z) - side * max(0.0, n.x) \
                    + side * 0.5 * max(0.0, -n.x)
            self.f.append([base + v.index for v in face.verts])
            if vfn:
                self.fc.append([_shade(_rgb(vfn(v.co, c)), k) for v in face.verts])
            else:
                self.fc.append(_shade(c, k))
            self.fm.append(m)
        bm.free()
        return self

    def glow(self, bm, key="glow", rgb=None):
        return self.add(bm, rgb or GLOW_RGB[key], m=key)

    def absorb(self, other, matrix=None):
        """Append another Geo (already coloured), optionally transformed by a 4x4 matrix."""
        base = len(self.v)
        self.v.extend((matrix @ v) if matrix is not None else v.copy() for v in other.v)
        self.f.extend([base + i for i in f] for f in other.f)
        self.fc.extend(other.fc)
        self.fm.extend(other.fm)
        return self

    def squash(self, axis, limit, pivot):
        """Linearly compress coordinates beyond `pivot` so the extreme lands exactly on `limit`
        (e.g. front relief of a cut-away piece into y >= -1.0). Keeps layer order, so decals stay
        in front of what they sit on; the side-on view is unchanged."""
        i = "xyz".index(axis)
        beyond = [v[i] for v in self.v if (v[i] - pivot) * (limit - pivot) > 0]
        if not beyond:
            return self
        ext = max(beyond, key=lambda c: abs(c - pivot))
        if abs(ext - pivot) <= abs(limit - pivot):
            return self
        k = (limit - pivot) / (ext - pivot)
        for v in self.v:
            if (v[i] - pivot) * (limit - pivot) > 0:
                v[i] = pivot + (v[i] - pivot) * k
        return self

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def build(self, name, origin=(0, 0, 0), parent=None, grime=None):
        """Create the object. Vertices were given in world space; `origin` becomes the object
        origin (hinges, door-panel top). `grime(p) -> factor` darkens base faces per vertex."""
        o = Vector(origin)
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v - o) for v in self.v], [], self.f)
        order = []
        for m in self.fm:
            if m not in order:
                order.append(m)
        for m in order:
            me.materials.append(mat(m))
        slot = {m: i for i, m in enumerate(order)}
        attr = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
        me.color_attributes.active_color = attr
        try:
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except AttributeError:
            pass
        gcache = {}
        cols = []
        for p in me.polygons:
            m = self.fm[p.index]
            p.material_index = slot[m]
            fcol = self.fc[p.index]
            for j, li in enumerate(p.loop_indices):
                c = fcol[j] if isinstance(fcol, list) else fcol
                vi = me.loops[li].vertex_index
                if grime and m == "base":
                    g = gcache.get(vi)
                    if g is None:
                        g = gcache[vi] = grime(self.v[vi])
                    cc = _shade(c, g)
                else:
                    cc = c
                cols.extend((cc[0], cc[1], cc[2], 1.0))
        attr.data.foreach_set("color", cols)
        me.shade_flat()
        me.update()
        obj = link(bpy.data.objects.new(name, me))
        if parent is not None:
            obj.parent = parent
            obj.location = o - parent.matrix_world.translation
        else:
            obj.location = o
        return obj


# ---------------------------------------------------------------- grime functions

def wall_grime(seed=0, floor=0.5, ceil=0.7, stain=0.24, z_top=4.5, depth=(1.7, 1.96, 0.3)):
    """Darker toward the floor and under the ceiling, darker the deeper a surface sits in the
    wall relief (reads as ambient occlusion from the side), plus low-frequency noise stains."""
    off = Vector((seed * 3.17, seed * 1.3, seed * 0.71))

    def g(p):
        k = floor + (1.0 - floor) * smooth(0.0, 2.4, p.z)
        k *= 1.0 - (1.0 - ceil) * smooth(z_top - 0.7, z_top, p.z)
        if depth:
            k *= 1.0 - depth[2] * smooth(depth[0], depth[1], p.y)
        n = noise.noise(Vector((p.x * 1.4, p.y * 2.0, p.z * 0.8)) + off)
        n2 = noise.noise(Vector((p.x * 4.0, p.y * 4.0, p.z * 3.0)) + off * 2.0)
        return k * (1.0 + stain * n + stain * 0.4 * n2)
    return g


def prop_grime(seed=0, floor=0.7, h=1.2, stain=0.14):
    off = Vector((seed * 2.3, seed * 0.7, seed * 1.9))

    def g(p):
        k = floor + (1.0 - floor) * smooth(0.0, h, p.z)
        return k * (1.0 + stain * noise.noise(Vector((p.x * 2.5, p.y * 2.5, p.z * 2.0)) + off))
    return g


# ---------------------------------------------------------------- shapes

def bx(x0, x1, y0, y1, z0, z1, bevel=0.0, rot=None):
    """Box from min/max extents (handier than centre+size for layout work)."""
    size = (x1 - x0, y1 - y0, z1 - z0)
    loc = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return box(size, loc, rot or (0, 0, 0), bevel=bevel)


def tube(points, r, verts=6, caps=True, phase=0.0, ref=(0, 1, 0), scale_y=1.0, r1=None):
    """Tube along a polyline (cables, bent pipes, rails). Mitred joints. `r1` tapers the radius
    linearly to r1 at the last point (tendrils, drips); `scale_y` flattens it against a wall."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    refv = Vector(ref)
    rings = []
    angs = [phase + 2 * math.pi * j / verts for j in range(verts)]
    r0 = r
    for i, p in enumerate(pts):
        if r1 is not None:
            r = r0 + (r1 - r0) * i / max(1, len(pts) - 1)
        if i == 0:
            t = pts[1] - pts[0]
            mit = 1.0
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
            mit = 1.0
        else:
            a = (pts[i] - pts[i - 1]).normalized()
            b = (pts[i + 1] - pts[i]).normalized()
            t = a + b
            mit = 1.0 / max(0.5, math.cos(a.angle(b) / 2)) if a.dot(b) < 0.9999 else 1.0
        t.normalize()
        rv = refv if abs(t.dot(refv)) < 0.9 else Vector((1, 0, 0))
        n = t.cross(rv).normalized()
        b = t.cross(n).normalized()
        ring = []
        for a in angs:
            off = (math.cos(a) * n + math.sin(a) * b) * r
            # stretch only across the mitre plane component (approximate)
            off = off * (1.0 + (mit - 1.0) * abs(math.cos(a)))
            off.y *= scale_y
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(verts):
            k = (j + 1) % verts
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
    if caps and verts > 2:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm


def pipe(p0, p1, r, verts=8, caps=True, phase=None):
    return tube([p0, p1], r, verts, caps, phase=math.pi / verts if phase is None else phase)


def sag(p0, p1, droop, n=6):
    """Catenary-ish points between two anchors (cables)."""
    p0, p1 = Vector(p0), Vector(p1)
    return [p0.lerp(p1, i / n) - Vector((0, 0, 4 * droop * (i / n) * (1 - i / n))) for i in range(n + 1)]


def studs(points, s=0.035, h=0.022, facing="-y", cap=0.45):
    """Bolt heads: square frustums (4 bevel sides + a flat cap, 10 tris; cap=0 -> 4-tri pyramid).
    `points` sit on the surface; the head points along `facing` ('-y' or '+z')."""
    bm = bmesh.new()
    for p in points:
        x, y, z = p
        if facing == "-y":
            base = [(x - s, y, z - s), (x + s, y, z - s), (x + s, y, z + s), (x - s, y, z + s)]
            tip = [(x + (bx_ - x) * cap, y - h, z + (bz - z) * cap) for bx_, _, bz in base]
        elif facing == "+z":
            base = [(x - s, y - s, z), (x + s, y - s, z), (x + s, y + s, z), (x - s, y + s, z)]
            tip = [(x + (bx_ - x) * cap, y + (by - y) * cap, z + h) for bx_, by, _ in base]
        else:
            raise ValueError(facing)
        vs = [bm.verts.new(c) for c in base]
        if cap <= 0:
            a = bm.verts.new(tip[0])
            for i in range(4):  # this winding is outward for both facings
                bm.faces.new((vs[i], vs[(i + 1) % 4], a))
        else:
            ts = [bm.verts.new(c) for c in tip]
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new((vs[i], vs[j], ts[j], ts[i]))
            bm.faces.new(ts)   # same winding as the base square -> faces along `facing`
    return bm


def row(x0, x1, n, y, z, facing="-y"):
    """Evenly spaced points along X (for `studs`)."""
    if n == 1:
        return [((x0 + x1) / 2, y, z)]
    return [(x0 + (x1 - x0) * i / (n - 1), y, z) for i in range(n)]


def col(z0, z1, n, x, y):
    if n == 1:
        return [(x, y, (z0 + z1) / 2)]
    return [(x, y, z0 + (z1 - z0) * i / (n - 1)) for i in range(n)]


def front_face(bm, axis=(0, -1, 0)):
    ax = Vector(axis)
    bm.normal_update()
    cands = [f for f in bm.faces if f.normal.dot(ax) > 0.99]
    return max(cands, key=lambda f: f.calc_area())


def inset(bm, steps, axis=(0, -1, 0)):
    """Repeated bmesh insets on the biggest face pointing along `axis`.
    steps: [(thickness, depth), ...]; depth < 0 recesses, > 0 raises. Returns bm."""
    f = front_face(bm, axis)
    for t, d in steps:
        bmesh.ops.inset_region(bm, faces=[f], thickness=t, depth=d, use_even_offset=True)
    return bm


def plate(x0, x1, z0, z1, y_front, y_back, steps=(), bevel=0.0, axis=(0, -1, 0)):
    """Wall plate spanning [x0,x1]x[z0,z1] from y_front to y_back with optional insets."""
    bm = bx(x0, x1, y_front, y_back, z0, z1, bevel=bevel)
    if steps:
        inset(bm, steps, axis)
    return bm


def poly_prism(points, y0, y1):
    """Prism from an XZ outline between y0 (front) and y1 (back)."""
    d = abs(y1 - y0)
    return prism(points, d, loc=(0, (y0 + y1) / 2, 0))


def yz_prism(points, x0, x1):
    """Prism from a (y, z) side-profile outline, extruded along X from x0 to x1."""
    return prism(points, x1 - x0, loc=((x0 + x1) / 2, 0, 0), rot=(0, 0, 90))


def ring(inner, outer, y0, y1, y_inner=None):
    """Closed solid frame between two same-length XZ polygons (e.g. a window frame).
    Front face at y0 (outer edge) sloping to `y_inner` at the inner edge (a chamfered frame),
    back at y1. Nothing is created inside `inner` - the opening stays open."""
    bm = bmesh.new()
    n = len(inner)
    yi = y0 if y_inner is None else y_inner
    fi = [bm.verts.new((x, yi, z)) for x, z in inner]
    fo = [bm.verts.new((x, y0, z)) for x, z in outer]
    bi = [bm.verts.new((x, y1, z)) for x, z in inner]
    bo = [bm.verts.new((x, y1, z)) for x, z in outer]
    front = None
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((fi[i], fi[j], fo[j], fo[i]))    # front
        front = front or f
        bm.faces.new((bo[i], bo[j], bi[j], bi[i]))    # back
        bm.faces.new((fo[i], fo[j], bo[j], bo[i]))    # outer wall
        bm.faces.new((bi[i], bi[j], fi[j], fi[i]))    # inner reveal
    bm.normal_update()
    # make the front face point toward -Y
    if front.normal.y > 0:
        for f in bm.faces:
            f.normal_flip()
    return bm


def chamfer_rect(x0, x1, z0, z1, c):
    """Octagon outline: rectangle with chamfered corners (counter-clockwise in XZ)."""
    return [(x0 + c, z0), (x1 - c, z0), (x1, z0 + c), (x1, z1 - c),
            (x1 - c, z1), (x0 + c, z1), (x0, z1 - c), (x0, z0 + c)]


def stencil(text, x, z, y, px=0.02, anchor="left"):
    """Pixel-font stencil lettering as flat quads facing -Y (one quad per horizontal run).
    (x, z) is the top-left corner (or top-centre with anchor='center')."""
    width = (len(text) * 6 - 1) * px
    if anchor == "center":
        x -= width / 2
    bm = bmesh.new()
    cx = x
    for ch in text.upper():
        rows = FONT.get(ch, FONT[" "]).split()
        for r, bits in enumerate(rows):
            c = 0
            while c < 5:
                if bits[c] == "1":
                    c1 = c
                    while c1 + 1 < 5 and bits[c1 + 1] == "1":
                        c1 += 1
                    x0, x1 = cx + c * px, cx + (c1 + 1) * px
                    z1 = z - r * px
                    z0 = z1 - px
                    vs = [bm.verts.new(p) for p in ((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1))]
                    bm.faces.new(vs)
                    c = c1 + 1
                else:
                    c += 1
        cx += 6 * px
    return bm


def flat(points, y):
    """Single polygon in the XZ plane at depth y, facing -Y (decals: rust, streaks, stripes)."""
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, y, z)) for x, z in points])
    bm.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    return bm


def quad(x0, x1, z0, z1, y):
    """Single quad facing -Y."""
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1))]
    bm.faces.new(vs)
    return bm


def circle(cx, cz, r, n=16, phase=0.0):
    return [(cx + r * math.cos(phase + 2 * math.pi * i / n), cz + r * math.sin(phase + 2 * math.pi * i / n))
            for i in range(n)]


def _clip(poly, x0, x1, z0, z1):
    """Sutherland-Hodgman clip of a convex XZ polygon to a rectangle."""
    def clip_edge(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out

    def ix(xc):
        return lambda a, b: (xc, a[1] + (b[1] - a[1]) * (xc - a[0]) / (b[0] - a[0]))

    def iz(zc):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (zc - a[1]) / (b[1] - a[1]), zc)

    pts = poly
    for inside, inter in ((lambda p: p[0] >= x0, ix(x0)), (lambda p: p[0] <= x1, ix(x1)),
                          (lambda p: p[1] >= z0, iz(z0)), (lambda p: p[1] <= z1, iz(z1))):
        if not pts:
            break
        pts = clip_edge(pts, inside, inter)
    return pts


def stripes(x0, x1, z0, z1, y, width=0.12, slant=1.0, depth=0.012, phase=0.0, gap=None):
    """Diagonal hazard stripes clipped to a rectangle, as flat polygons at y facing -Y
    (`depth` > 0.02 makes solid prisms instead). Put them over a dark backing plate.
    Returns a bmesh (yellow stripes only)."""
    gap = width if gap is None else gap
    h = z1 - z0
    shift = slant * h
    parts = []
    a = x0 - abs(shift) - width * 2 + phase
    while a < x1 + abs(shift) + width:
        quad = [(a, z0), (a + width, z0), (a + width + shift, z1), (a + shift, z1)]
        pts = _clip(quad, x0, x1, z0, z1)
        if len(pts) >= 3:
            area = 0.5 * abs(sum(pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1] for i in range(len(pts))))
            if area > 1e-4:
                parts.append(poly_prism(pts, y, y + depth) if depth > 0.02 else flat(pts, y))
        a += width + gap
    out = bmesh.new()
    for p in parts:
        _append(out, p)
    return out


def blob(cx, cz, rx, rz, n=8, seed=0, jag=0.35):
    """Irregular convex-ish outline (rust patches, slime splats, resin lumps)."""
    rnd = random.Random(seed)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + rnd.uniform(-0.2, 0.2)
        k = 1.0 - rnd.uniform(0, jag)
        pts.append((cx + math.cos(a) * rx * k, cz + math.sin(a) * rz * k))
    return pts


def lump(center, radius, seed=0, seg=8, rings=5, rough=0.25, scale=(1, 1, 1), cut=None):
    """Noisy low-poly sphere (rubble, resin, slime blobs)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=radius)
    rnd = random.Random(seed)
    for v in bm.verts:
        v.co *= 1.0 + rnd.uniform(-rough, rough)
        v.co.x *= scale[0]
        v.co.y *= scale[1]
        v.co.z *= scale[2]
    if cut:
        axis, sign = {"bottom": (2, -1), "top": (2, 1), "back": (1, 1), "front": (1, -1)}[cut]
        for v in bm.verts:
            if v.co[axis] * sign > 0:
                v.co[axis] = 0.0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm


def rotate(bm, deg, axis="Z", pivot=(0, 0, 0)):
    m = Matrix.Translation(Vector(pivot)) @ Matrix.Rotation(math.radians(deg), 4, axis) @ \
        Matrix.Translation(-Vector(pivot))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def move(bm, vec):
    bmesh.ops.translate(bm, vec=Vector(vec), verts=bm.verts)
    return bm


def _append(dst, src):
    me = bpy.data.meshes.new("_tmp")
    src.to_mesh(me)
    src.free()
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)
    return dst


def join_bm(*bms):
    out = bmesh.new()
    for b in bms:
        _append(out, b)
    return out


# ---------------------------------------------------------------- shared props

def rifle_parts(scale=1.0):
    """Side profile of the squad's bulky rifle lying along +X from the origin (for racks/cases).
    Returns [(bmesh, colour)] in local space, 6 cm thick, centred on y=0."""
    t = 0.06
    s = scale
    P = lambda pts: prism([(x * s, z * s) for x, z in pts], t)  # noqa: E731
    return [
        (P([(0.0, 0.02), (0.26, 0.0), (0.26, 0.13), (0.04, 0.15)]), "#2c3034"),                    # stock
        (P([(0.26, 0.0), (0.72, 0.0), (0.72, 0.14), (0.26, 0.14)]), "#2c3034"),                   # receiver
        (P([(0.72, 0.035), (1.0, 0.035), (1.0, 0.115), (0.72, 0.115)]), "#23272b"),               # shroud
        (P([(1.0, 0.055), (1.08, 0.055), (1.08, 0.095), (1.0, 0.095)]), "#1a1d20"),                # muzzle
        (P([(0.44, 0.0), (0.54, 0.0), (0.58, -0.17), (0.47, -0.18)]), "#1c1f22"),                  # magazine
        (P([(0.3, 0.0), (0.37, 0.0), (0.34, -0.13), (0.27, -0.13)]), "#1c1f22"),                   # grip
        (P([(0.36, 0.14), (0.62, 0.14), (0.6, 0.19), (0.38, 0.19)]), "#3a3f44"),                   # sight rail
        (prism([(0.56 * s, 0.025 * s), (0.7 * s, 0.025 * s), (0.7 * s, 0.1 * s), (0.56 * s, 0.1 * s)], t + 0.01),
         "#5a1f1c"),                                                                            # casing detail
    ]


def place(parts, rot_y=0.0, loc=(0, 0, 0)):
    for bm, _ in parts:
        if rot_y:
            rotate(bm, rot_y, "Y")
        move(bm, loc)
    return parts


# ---------------------------------------------------------------- piece helpers

def piece_tris(obj):
    objs = [obj] + list(obj.children_recursive)
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")


def piece_bounds(obj):
    objs = [obj] + [c for c in obj.children_recursive]
    pts = []
    for o in objs:
        if o.type != "MESH":
            continue
        mw = o.matrix_world
        pts.extend(mw @ v.co for v in o.data.vertices)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def piece_info(obj):
    bpy.context.view_layer.update()
    lo, hi = piece_bounds(obj)
    return {"w": round(hi.x - lo.x, 3), "h": round(hi.z - lo.z, 3), "tris": piece_tris(obj)}


def check_extent(obj, x=None, y=None, z=None, tol=0.006):
    """Contract check: world-space bounds of a piece (children included) inside the given ranges.
    Returns a list of human-readable violations (empty = OK)."""
    lo, hi = piece_bounds(obj)
    out = []
    for axis, rng, a, b in (("x", x, lo.x, hi.x), ("y", y, lo.y, hi.y), ("z", z, lo.z, hi.z)):
        if rng is None:
            continue
        if a < rng[0] - tol or b > rng[1] + tol:
            out.append(f"{obj.name}: {axis} [{a:.3f}, {b:.3f}] outside [{rng[0]}, {rng[1]}]")
    return out


def check_clear(obj, xs, zs, y_from=-5.0, y_stop=5.0, step=0.05):
    """Contract check: rays cast along +Y through a grid of (x, z) points must not hit the piece
    before y_stop (window openings, see-through doorways). Returns the number of blocked rays."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(obj, dg)
    inv = obj.matrix_world.inverted()
    blocked = 0
    x = xs[0]
    while x <= xs[1] + 1e-6:
        z = zs[0]
        while z <= zs[1] + 1e-6:
            o = inv @ Vector((x, y_from, z))
            d = (inv.to_3x3() @ Vector((0, 1, 0))).normalized()
            hit, _, _, dist = tree.ray_cast(o, d)
            if hit is not None and (obj.matrix_world @ hit).y < y_stop - 0.002:   # faces AT y_stop are allowed
                blocked += 1
            z += step
        x += step
    return blocked


def inst(obj, loc=(0, 0, 0), scale=None, name=None):
    """Linked copy of a piece (and its hinged children) offset by `loc` - for mock-ups."""
    c = obj.copy()
    link(c)
    c.location = obj.location + Vector(loc)
    if scale:
        c.scale = scale
    for ch in obj.children:
        cc = ch.copy()
        link(cc)
        cc.parent = c
        cc.location = ch.location
    return c


# ---------------------------------------------------------------- preview rendering

FONT = {
    "A": "01110 10001 10001 11111 10001 10001 10001", "B": "11110 10001 10001 11110 10001 10001 11110",
    "C": "01110 10001 10000 10000 10000 10001 01110", "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111", "F": "11111 10000 10000 11110 10000 10000 10000",
    "G": "01110 10001 10000 10111 10001 10001 01111", "H": "10001 10001 10001 11111 10001 10001 10001",
    "I": "01110 00100 00100 00100 00100 00100 01110", "J": "00111 00010 00010 00010 00010 10010 01100",
    "K": "10001 10010 10100 11000 10100 10010 10001", "L": "10000 10000 10000 10000 10000 10000 11111",
    "M": "10001 11011 10101 10101 10001 10001 10001", "N": "10001 10001 11001 10101 10011 10001 10001",
    "O": "01110 10001 10001 10001 10001 10001 01110", "P": "11110 10001 10001 11110 10000 10000 10000",
    "Q": "01110 10001 10001 10001 10101 10010 01101", "R": "11110 10001 10001 11110 10100 10010 10001",
    "S": "01111 10000 10000 01110 00001 00001 11110", "T": "11111 00100 00100 00100 00100 00100 00100",
    "U": "10001 10001 10001 10001 10001 10001 01110", "V": "10001 10001 10001 10001 10001 01010 00100",
    "W": "10001 10001 10001 10101 10101 10101 01010", "X": "10001 10001 01010 00100 01010 10001 10001",
    "Y": "10001 10001 01010 00100 00100 00100 00100", "Z": "11111 00001 00010 00100 01000 10000 11111",
    "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
    "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11111 00010 00100 00010 00001 10001 01110",
    "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
    "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
    "_": "00000 00000 00000 00000 00000 00000 11111", "-": "00000 00000 00000 11111 00000 00000 00000",
    ".": "00000 00000 00000 00000 00000 01100 01100", ":": "00000 01100 01100 00000 01100 01100 00000",
    "/": "00001 00001 00010 00100 01000 10000 10000", " ": "00000 00000 00000 00000 00000 00000 00000",
    "=": "00000 00000 11111 00000 11111 00000 00000", "(": "00010 00100 01000 01000 01000 00100 00010",
    ")": "01000 00100 00010 00010 00010 00100 01000",
}


def stamp(img, text, x, y, scale=2, rgb=(0.85, 0.9, 0.8)):
    """Draw text into a top-down RGBA float image at pixel (x, y) = top-left."""
    cx = x
    for ch in text.upper():
        rows = FONT.get(ch, FONT[" "]).split()
        for r, bits in enumerate(rows):
            for c, b in enumerate(bits):
                if b == "1":
                    y0, x0 = y + r * scale, cx + c * scale
                    if 0 <= y0 < img.shape[0] - scale and 0 <= x0 < img.shape[1] - scale:
                        img[y0:y0 + scale, x0:x0 + scale, :3] = rgb
                        img[y0:y0 + scale, x0:x0 + scale, 3] = 1.0
        cx += 6 * scale
    return img


def camera(target, scale, yaw=0.0, pitch=6.0, dist=40.0, name="EnvCam"):
    """Orthographic camera orbiting `target`: yaw 0 = looking from -Y, pitch = elevation."""
    cd = bpy.data.cameras.new(name)
    cd.type = "ORTHO"
    cd.ortho_scale = scale
    cd.clip_start = 0.1
    cd.clip_end = dist * 3
    cam = link(bpy.data.objects.new(name, cd))
    yaw_r, pitch_r = math.radians(yaw), math.radians(pitch)
    off = Vector((math.sin(yaw_r) * math.cos(pitch_r), -math.cos(yaw_r) * math.cos(pitch_r), math.sin(pitch_r))) * dist
    cam.location = Vector(target) + off
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    bpy.context.view_layer.update()
    return cam


def _fit(lo, hi, yaw, pitch, aspect=1.0, pad=1.12):
    yaw_r, pitch_r = math.radians(yaw), math.radians(pitch)
    fwd = -Vector((math.sin(yaw_r) * math.cos(pitch_r), -math.cos(yaw_r) * math.cos(pitch_r), math.sin(pitch_r)))
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd).normalized()
    corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    c = (lo + hi) / 2
    pr = [(p - c).dot(right) for p in corners]
    pu = [(p - c).dot(up) for p in corners]
    target = c + right * (max(pr) + min(pr)) / 2 + up * (max(pu) + min(pu)) / 2
    w = max(pr) - min(pr)
    h = max(pu) - min(pu)
    scale = max(w, h * aspect) * pad if aspect >= 1 else max(w / aspect, h) * pad
    return target, max(scale, 0.3)


def _standard_view():
    """Show vertex colours as authored (the default AgX transform washes dark palettes out)."""
    vs = bpy.context.scene.view_settings
    try:
        vs.view_transform = "Standard"
        vs.look = "None"
    except TypeError:
        pass
    vs.exposure = 0.0
    vs.gamma = 1.0


def sheet(entries, path, cols=5, tile=300, yaw=0.0, pitch=6.0, bg=(0.035, 0.04, 0.045)):
    """entries: [(label, obj)] -> one PNG grid, one Workbench still per piece (children included)."""
    scene = bpy.context.scene
    _pv._setup((tile, tile), bg=bg)
    _standard_view()
    scene.display.shading.show_cavity = False
    everything = [o for o in scene.objects]
    saved = {o.name: o.hide_render for o in everything}
    tmp = tempfile.mkdtemp()
    tiles = []
    for i, (label, obj) in enumerate(entries):
        vis = {obj} | set(obj.children_recursive)
        for o in everything:
            o.hide_render = o not in vis
        lo, hi = piece_bounds(obj)
        target, scale = _fit(lo, hi, yaw, pitch)
        cam = camera(target, scale, yaw, pitch)
        arr = _pv._render_to_array(os.path.join(tmp, f"t{i}.png"))[::-1].copy()  # top-down
        stamp(arr, label, 6, 6)
        stamp(arr, f"{scale:.1f}M", 6, tile - 20, rgb=(0.45, 0.5, 0.45))
        arr[:, -1, :3] = 0.2
        arr[-1, :, :3] = 0.2
        tiles.append(arr)
        bpy.data.objects.remove(cam, do_unlink=True)
    for o in everything:
        o.hide_render = saved[o.name]
    while len(tiles) % cols:
        blank = np.zeros((tile, tile, 4), dtype=np.float32)
        blank[..., :3] = bg
        blank[..., 3] = 1
        tiles.append(blank)
    rows = [np.concatenate(tiles[r:r + cols], axis=1) for r in range(0, len(tiles), cols)]
    img = np.concatenate(rows, axis=0)
    _pv._save(img[::-1].copy(), path)
    return path


def render_view(path, target, scale, res, yaw=0.0, pitch=4.0, bg=(0.02, 0.025, 0.03), cavity=True, label=None):
    """Single Workbench render of whatever is visible (room mock-ups)."""
    scene = bpy.context.scene
    _pv._setup(res, bg=bg)
    _standard_view()
    scene.display.shading.show_cavity = cavity
    cam = camera(target, scale, yaw, pitch)
    tmp = tempfile.mkdtemp()
    arr = _pv._render_to_array(os.path.join(tmp, "view.png"))[::-1].copy()
    if label:
        stamp(arr, label, 10, 10)
    _pv._save(arr[::-1].copy(), path)
    bpy.data.objects.remove(cam, do_unlink=True)
    return path
