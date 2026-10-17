"""Keyframed animation clips for rigid-skinned characters (Blender 5.x slotted actions).

Rules that keep the three.js side simple:
  * every clip keys EVERY bone at EVERY key (no stale bones leaking between crossfades);
  * clips are in place (no root motion) - stride speed goes in the manifest instead;
  * each finished action gets a fake user and an NLA stash so export mode 'ACTIONS'
    always emits it as its own named glTF animation.
"""
import bpy

import math


class Clip:
    def __init__(self, arm, name, frames, loop=True, **meta):
        self.arm = arm
        self.name = name
        self.frames = frames
        self.loop = loop
        self.meta = dict(meta)
        ad = arm.animation_data or arm.animation_data_create()
        self.action = bpy.data.actions.new(name)
        self.action.use_fake_user = True
        ad.action = self.action

    def key(self, frame, pose=None):
        """pose: {bone: (rx, ry, rz)} in degrees, or {bone: {"rot": (...), "loc": (...)}}.
        Bones not mentioned are keyed at rest."""
        pose = pose or {}
        for pb in self.arm.pose.bones:
            spec = pose.get(pb.name, (0, 0, 0))
            if isinstance(spec, dict):
                rot = spec.get("rot", (0, 0, 0))
                loc = spec.get("loc", (0, 0, 0))
            else:
                rot, loc = spec, (0, 0, 0)
            pb.rotation_euler = [math.radians(a) for a in rot]
            pb.location = loc
            pb.keyframe_insert("rotation_euler", frame=frame)
            pb.keyframe_insert("location", frame=frame)

    def cycle(self, poses):
        """Key a list of poses evenly across the clip; loops repeat the first pose at the end."""
        n = len(poses)
        steps = n if self.loop else max(1, n - 1)
        for i, pose in enumerate(poses):
            self.key(1 + round(i * self.frames / steps), pose)
        if self.loop:
            self.key(1 + self.frames, poses[0])
        return self

    def done(self):
        ad = self.arm.animation_data
        track = ad.nla_tracks.new()
        track.name = self.name
        track.strips.new(self.name, 1, self.action)
        track.mute = True
        ad.action = None
        fps = bpy.context.scene.render.fps
        return {"name": self.name, "loop": self.loop, "duration": self.frames / fps, **self.meta}


def lerp_pose(a, b, t):
    """Blend two pose dicts (rotations only) - handy for in-between keys."""
    out = {}
    for k in set(a) | set(b):
        ra = a.get(k, (0, 0, 0))
        rb = b.get(k, (0, 0, 0))
        ra = ra["rot"] if isinstance(ra, dict) else ra
        rb = rb["rot"] if isinstance(rb, dict) else rb
        out[k] = tuple(ra[i] + (rb[i] - ra[i]) * t for i in range(3))
    return out
