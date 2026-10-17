"""Armature building and rigid skinning.

Every bone is rolled so its local X axis equals world +X (the character's left side).
Because characters face -Y and animate in the sagittal plane, a pose rotation of +a degrees
about X always swings a bone's tip  up -> forward -> down -> back  (e.g. thigh -25 = step
forward, shin +40 = knee bend, upper arm -70 = raise arm forward).
"""
import bpy
from mathutils import Matrix, Vector

from .common import join, link


def build_armature(name, bones):
    """bones: list of (bone, head, tail, parent_or_None). Returns the armature object."""
    arm_data = bpy.data.armatures.new(name)
    arm = link(bpy.data.objects.new(name, arm_data))
    arm.show_in_front = True
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    for bname, head, tail, parent in bones:
        eb = arm_data.edit_bones.new(bname)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        y = (eb.tail - eb.head).normalized()
        z = Vector((1, 0, 0)).cross(y)
        if z.length < 1e-4:          # bone along X: fall back to Z up
            z = Vector((0, 0, 1))
        eb.align_roll(z.normalized())
        eb.use_deform = True
        if parent:
            eb.parent = ebs[parent]
            eb.use_connect = False
        ebs[bname] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(False)
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm


def skin(parts, arm, name):
    """Join rigid parts (each already carries a 100% vertex group) and bind to `arm`."""
    body = join(parts, name)
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return body


def socket(name, arm, bone, world_loc):
    """Empty parented to a bone at a world position; exported as a glTF node the game can
    query (muzzle flash origin, flashlight origin, eye glow...)."""
    obj = link(bpy.data.objects.new(name, None))
    obj.empty_display_size = 0.05
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()  # parent (bone) matrix must be evaluated first
    obj.matrix_world = Matrix.Translation(Vector(world_loc))
    return obj
