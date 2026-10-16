"""A survivor: a crew member in a grimy jumpsuit, found cowering in the ship and escorted to the airlock.
    blender --background --python tools/blender/survivor.py -- assets/models/survivor.glb
Same rig conventions as the marine (faces +X, pixels, hips root) minus the gun bone."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PartMesh, make_rig, make_clip, export, clip_meta, out_path, reset, hexc  # noqa: E402

reset()

BONES = [
    dict(name='hips', parent=None, head=(0, 0, 33), tail=(0, 0, 37)),
    dict(name='spine', parent='hips', head=(0, 0, 37), tail=(0, 0, 45)),
    dict(name='chest', parent='spine', head=(0, 0, 45), tail=(0, 0, 51)),
    dict(name='head', parent='chest', head=(0, 0, 51), tail=(0, 0, 59)),
    dict(name='upper_arm_l', parent='chest', head=(0, 6.5, 49), tail=(0, 6.5, 39)),
    dict(name='forearm_l', parent='upper_arm_l', head=(0, 6.5, 39), tail=(0, 6.5, 29)),
    dict(name='upper_arm_r', parent='chest', head=(0, -6.5, 49), tail=(0, -6.5, 39)),
    dict(name='forearm_r', parent='upper_arm_r', head=(0, -6.5, 39), tail=(0, -6.5, 29)),
    dict(name='thigh_l', parent='hips', head=(0, 3.5, 33), tail=(0, 3.5, 19)),
    dict(name='shin_l', parent='thigh_l', head=(0, 3.5, 19), tail=(0, 3.5, 5)),
    dict(name='foot_l', parent='shin_l', head=(0, 3.5, 5), tail=(6, 3.5, 1)),
    dict(name='thigh_r', parent='hips', head=(0, -3.5, 33), tail=(0, -3.5, 19)),
    dict(name='shin_r', parent='thigh_r', head=(0, -3.5, 19), tail=(0, -3.5, 5)),
    dict(name='foot_r', parent='shin_r', head=(0, -3.5, 5), tail=(6, -3.5, 1)),
]
UPPER = ['spine', 'chest', 'head', 'upper_arm_l', 'forearm_l', 'upper_arm_r', 'forearm_r']
rig = make_rig('survivor', BONES)

SUIT = hexc(0x8a6a3c)      # orange-brown jumpsuit, filthy
SUIT_DK = hexc(0x5e4628)
SKIN = hexc(0xc9a07a)
HAIR = hexc(0x2a1d14)
BOOT = hexc(0x1e1a16)
STRIPE = hexc(0xd8d0b8)
BADGE = hexc(0x66d9a0)

m = PartMesh('survivor', seed=11)
W = dict(wear=0.5, grime=0.85, rust=0.0, scratch=0.05)
m.box((0, 0, 35), (8, 10, 5), SUIT_DK, 'hips', **W)
m.box((0, 0, 41), (7.5, 10, 8), SUIT, 'spine', **W)
m.box((0, 0, 48), (8, 11, 7), SUIT, 'chest', **W)
m.box((0, 0, 48.5), (8.5, 11.5, 1.2), STRIPE, 'chest', wear=0.6, grime=0.8)     # reflective stripe
m.box((3.8, -3.5, 49.5), (0.8, 2.5, 1.5), BADGE, 'chest', wear=0, grime=0, emissive=True)   # id badge
m.box((0, 0, 52), (3.5, 3.5, 2), SKIN, 'head', wear=0.1, grime=0.3)
m.box((0, 0, 56), (7, 7.5, 7), SKIN, 'head', wear=0.1, grime=0.35)
m.box((-1, 0, 58.5), (7.5, 8, 3), HAIR, 'head', wear=0.2, grime=0.3)
m.box((-3, 0, 55), (2.5, 8, 5), HAIR, 'head', wear=0.2, grime=0.3)
m.box((3.5, 1.5, 56.5), (0.6, 1.2, 1.2), hexc(0x101010), 'head', wear=0, grime=0)       # eyes
m.box((3.5, -1.5, 56.5), (0.6, 1.2, 1.2), hexc(0x101010), 'head', wear=0, grime=0)
for side, sgn in (('l', 1), ('r', -1)):
    m.box((0, 6.5 * sgn, 44), (4.5, 4.5, 10), SUIT, f'upper_arm_{side}', **W)
    m.box((0, 6.5 * sgn, 34.5), (4, 4, 9), SUIT, f'forearm_{side}', **W)
    m.box((0, 6.5 * sgn, 29), (3.5, 4, 3), SKIN, f'forearm_{side}', wear=0.1, grime=0.4)
    m.box((0, 3.5 * sgn, 26), (5.5, 5, 13), SUIT, f'thigh_{side}', **W)
    m.box((0, 3.5 * sgn, 12), (5, 4.8, 13), SUIT_DK, f'shin_{side}', **W)
    m.box((2, 3.5 * sgn, 2.5), (8, 5, 4.5), BOOT, f'foot_{side}', wear=0.3, grime=0.8)
m.build(rig, emissive_color=(0.4, 1.0, 0.6), emissive_strength=2.5)


def legs(tl, sl, tr, sr, fl=0, fr=0):
    return {'thigh_l': dict(swing=tl), 'shin_l': dict(swing=sl), 'thigh_r': dict(swing=tr), 'shin_r': dict(swing=sr),
            'foot_l': dict(swing=fl), 'foot_r': dict(swing=fr)}


def arms(ul, fl, ur, fr, sl=0, sr=0):
    return {'upper_arm_l': dict(swing=ul, side=sl), 'forearm_l': dict(swing=fl), 'upper_arm_r': dict(swing=ur, side=sr), 'forearm_r': dict(swing=fr)}


def pose(hips=(0, 0, 0), spine=0, chest=0, head=0, a=None, l=None):
    p = {'hips': dict(loc=hips), 'spine': dict(swing=spine), 'chest': dict(swing=chest), 'head': dict(swing=head)}
    p.update(a or arms(0, 0, 0, 0))
    p.update(l or legs(0, 0, 0, 0))
    return p


clips = []
idle = {
    1: pose(spine=3, head=-2, a=arms(-4, 10, 4, 8), l=legs(-4, 6, 6, 4)),
    24: pose(hips=(0, 0, -0.8), spine=4, head=-4, a=arms(-6, 12, 6, 10), l=legs(-4, 6, 6, 4)),
}
clips.append((make_clip(rig, 'idle', idle, loop=True), dict(loop=True)))
# cower: crouched against the wall, arms over the head, shaking
cower = {
    1: pose(hips=(2, 0, -16), spine=50, chest=20, head=-20, a=arms(150, -120, 140, -110, -20, 20), l=legs(-100, 120, -96, 118, 0, 0)),
    6: pose(hips=(2, 0, -16.5), spine=52, chest=22, head=-22, a=arms(154, -122, 136, -108, -22, 22), l=legs(-100, 120, -96, 118, 0, 0)),
    12: pose(hips=(2, 0, -16), spine=50, chest=20, head=-20, a=arms(148, -118, 142, -112, -20, 20), l=legs(-100, 120, -96, 118, 0, 0)),
}
clips.append((make_clip(rig, 'cower', cower, loop=True), dict(loop=True)))
walk = {
    1: pose(spine=4, a=arms(-20, 10, 20, 14), l=legs(-24, 6, 22, 38, -4, 10)),
    7: pose(hips=(0, 0, 1.2), spine=5, a=arms(-4, 12, 4, 12), l=legs(2, 24, 6, 12, 8, -4)),
    13: pose(spine=4, a=arms(20, 14, -20, 10), l=legs(22, 38, -24, 6, 10, -4)),
    19: pose(hips=(0, 0, 1.2), spine=5, a=arms(4, 12, -4, 12), l=legs(6, 12, 2, 24, -4, 8)),
}
clips.append((make_clip(rig, 'walk', walk, loop=True), dict(loop=True, events={'step': [1, 13]}, speed=90)))
run = {
    1: pose(spine=14, head=-8, a=arms(-40, 60, 40, 70), l=legs(-44, 18, 42, 70, -6, 14)),
    5: pose(hips=(0, 0, 3), spine=16, head=-8, a=arms(-6, 70, 6, 70), l=legs(-4, 60, 10, 20, 12, -2)),
    9: pose(spine=14, head=-8, a=arms(40, 70, -40, 60), l=legs(42, 70, -44, 18, 14, -6)),
    13: pose(hips=(0, 0, 3), spine=16, head=-8, a=arms(6, 70, -6, 70), l=legs(10, 20, -4, 60, -2, 12)),
}
clips.append((make_clip(rig, 'run', run, loop=True), dict(loop=True, events={'step': [1, 9]}, speed=200)))
# wave: stands and waves the near arm (rescued / follow me)
wave = {
    1: pose(spine=2, a=arms(-4, 10, 150, -40, 0, 30), l=legs(-4, 6, 6, 4)),
    6: pose(spine=2, a=arms(-4, 10, 160, -70, 0, 50), l=legs(-4, 6, 6, 4)),
    12: pose(spine=2, a=arms(-4, 10, 150, -40, 0, 30), l=legs(-4, 6, 6, 4)),
}
clips.append((make_clip(rig, 'wave', wave, loop=True), dict(loop=True, upper=True)))
hurt = {
    1: pose(spine=-14, chest=-6, head=-10, a=arms(30, 40, 30, 40), l=legs(-10, 14, 10, 8)),
    5: pose(hips=(-2, 0, -1), spine=-20, chest=-8, head=-14, a=arms(40, 50, 40, 50), l=legs(-14, 20, 14, 10)),
    9: pose(spine=3, head=-2, a=arms(-4, 10, 4, 8), l=legs(-4, 6, 6, 4)),
}
clips.append((make_clip(rig, 'hurt', hurt, loop=False), dict(loop=False)))
death = {
    1: pose(spine=-10, head=-14, a=arms(20, 30, 20, 30), l=legs(-10, 16, 12, 10)),
    8: pose(hips=(-4, 0, -12), spine=-24, chest=-6, head=-20, a=arms(10, 10, 0, 20, -30, 30), l=legs(40, 70, 50, 80, 10, 10)),
    22: pose(hips=(-12, 0, -30), spine=-80, chest=-4, head=-10, a=arms(-20, 0, -30, 0, -50, 50), l=legs(60, 20, 70, 30, 0, 0)),
    30: pose(hips=(-12, 0, -30), spine=-82, chest=-4, head=-6, a=arms(-20, 0, -30, 0, -50, 50), l=legs(60, 20, 70, 30, 0, 0)),
}
clips.append((make_clip(rig, 'death', death, loop=False), dict(loop=False)))

meta = dict(
    name='survivor', facing='+x', height=60, width=20, bones=[b['name'] for b in BONES], upper=UPPER, root='hips',
    clips=clip_meta(clips), eye=(3, 0, 56), speeds={'walk': 90, 'run': 200},
)
export(out_path('survivor'), meta, rig)
