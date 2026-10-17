"""GLB export + sidecar metadata used to build public/assets/models/manifest.json."""
import json
import os

import bpy

GLTF_OPTS = dict(
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,               # applies modifiers except the armature (skins stay skins)
    export_skins=True,
    export_animations=True,
    export_animation_mode="ACTIONS",  # one glTF animation per Blender action
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_anim_single_armature=True,
    export_vertex_color="ACTIVE",     # COLOR_0 from the "Color" attribute
    export_image_format="NONE",
    export_cameras=False,
    export_lights=False,
    export_extras=True,
    export_meshopt_compression_enable=True,  # EXT_meshopt_compression (three: GLTFLoader.setMeshoptDecoder)
)


def _valid(opts):
    """Drop options this Blender's exporter does not know (names drift between versions)."""
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    unknown = [k for k in opts if k not in props]
    if unknown:
        print("WARN unknown glTF export options ignored:", unknown)
    return {k: v for k, v in opts.items() if k in props}


def export_glb(path, objs, **overrides):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
        for child in o.children_recursive:
            child.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    opts = _valid({**GLTF_OPTS, **overrides})
    bpy.ops.export_scene.gltf(filepath=path, **opts)
    print("EXPORTED", path, os.path.getsize(path), "bytes")
    return path


def write_meta(out_dir, name, meta):
    """Per-asset JSON next to the GLB; tools/run-blender.mjs merges these into manifest.json."""
    path = os.path.join(out_dir, name + ".meta.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:  # LF on Windows too (no git noise)
        json.dump({"name": name, "file": name + ".glb", **meta}, f, indent=2)
    return path


def bounds(objs):
    """World-space AABB of mesh objects, reported in glTF axes (x, y-up, z)."""
    xs, ys, zs = [], [], []
    for o in objs:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(w.x)
            ys.append(w.z)
            zs.append(-w.y)
    return {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]}
