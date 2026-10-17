"""Workbench preview renders: a contact sheet of every clip (rows) x sampled frames (cols),
plus single stills for props. Lets the art be reviewed without opening Blender."""
import math
import os
import tempfile

import bpy
import numpy as np
from mathutils import Vector


def _setup(res, bg=(0.06, 0.07, 0.08)):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = res[0]
    scene.render.resolution_y = res[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "VERTEX"
    sh.show_shadows = True
    sh.show_cavity = True
    sh.cavity_type = "WORLD"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.color = bg
    scene.display_settings.display_device = "sRGB"
    return scene


def _camera(target, height, yaw_deg, pitch_deg=8.0, dist=12.0):
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = height
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    # yaw 0 = looking from -Y (the character's front); positive yaw orbits to its left side.
    offset = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    cam.location = Vector(target) + offset
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def _render_to_array(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    arr = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    arr = arr.reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return arr


def _save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    print("PREVIEW", path)


def contact_sheet(arm, clips, path, target, height, cols=6, tile=220, yaw=55.0):
    """Rows = clips (in order), columns = evenly sampled frames of each clip."""
    _setup((tile, tile))
    cam = _camera(target, height, yaw)
    ad = arm.animation_data
    rows = []
    tmp = tempfile.mkdtemp()
    for clip in clips:
        action = bpy.data.actions[clip["name"]]
        ad.action = action
        if hasattr(ad, "action_slot") and ad.action_slot is None and len(action.slots):
            ad.action_slot = action.slots[0]
        first, last = action.frame_range
        row = []
        for c in range(cols):
            f = first + (last - first) * c / max(1, cols - (1 if not clip["loop"] else 0))
            bpy.context.scene.frame_set(int(round(f)))
            row.append(_render_to_array(os.path.join(tmp, f"f{c}.png")))
        rows.append(np.concatenate(row, axis=1))
        print("SHEET ROW", len(rows) - 1, clip["name"])
    ad.action = None
    sheet = np.concatenate(rows[::-1], axis=0)  # images are bottom-up
    _save(sheet, path)
    bpy.data.objects.remove(cam, do_unlink=True)


def still(path, target, height, res=(480, 480), yaw=35.0, pitch=12.0):
    _setup(res)
    cam = _camera(target, height, yaw, pitch)
    arr = _render_to_array(path)
    bpy.data.objects.remove(cam, do_unlink=True)
    return arr
