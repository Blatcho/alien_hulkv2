"""The alien: a long-domed biomechanical hunter, ~64 px tall upright, low on all fours when crawling.
    blender --background --python tools/blender/alien.py -- assets/models/alien.glb"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PartMesh, make_rig, make_clip, export, clip_meta, out_path, reset, hexc  # noqa: E402

reset()

BONES = [
    dict(name='hips', parent=None, head=(0, 0, 30), tail=(0, 0, 34)),
    dict(name='spine', parent='hips', head=(0, 0, 34), tail=(0, 0, 42)),
    dict(name='chest', parent='spine', head=(0, 0, 42), tail=(0, 0, 50)),
    dict(name='neck', parent='chest', head=(0, 0, 50), tail=(3, 0, 56)),
    dict(name='head', parent='neck', head=(3, 0, 56), tail=(14, 0, 58)),
    dict(name='jaw', parent='head', head=(10, 0, 55), tail=(16, 0, 53)),
    dict(name='upper_arm_l', parent='chest', head=(0, 6, 48), tail=(0, 6, 36)),
    dict(name='forearm_l', parent='upper_arm_l', head=(0, 6, 36), tail=(0, 6, 24)),
    dict(name='claw_l', parent='forearm_l', head=(0, 6, 24), tail=(4, 6, 18)),
    dict(name='upper_arm_r', parent='chest', head=(0, -6, 48), tail=(0, -6, 36)),
    dict(name='forearm_r', parent='upper_arm_r', head=(0, -6, 36), tail=(0, -6, 24)),
    dict(name='claw_r', parent='forearm_r', head=(0, -6, 24), tail=(4, -6, 18)),
    dict(name='thigh_l', parent='hips', head=(0, 4, 30), tail=(-3, 4, 18)),
    dict(name='shin_l', parent='thigh_l', head=(-3, 4, 18), tail=(5, 4, 8)),
    dict(name='foot_l', parent='shin_l', head=(5, 4, 8), tail=(11, 4, 2)),
    dict(name='thigh_r', parent='hips', head=(0, -4, 30), tail=(-3, -4, 18)),
    dict(name='shin_r', parent='thigh_r', head=(-3, -4, 18), tail=(5, -4, 8)),
    dict(name='foot_r', parent='shin_r', head=(5, -4, 8), tail=(11, -4, 2)),
    dict(name='tail1', parent='hips', head=(-4, 0, 31), tail=(-16, 0, 28)),
    dict(name='tail2', parent='tail1', head=(-16, 0, 28), tail=(-28, 0, 22)),
    dict(name='tail3', parent='tail2', head=(-28, 0, 22), tail=(-40, 0, 14)),
]
UPPER = ['spine', 'chest', 'neck', 'head', 'jaw', 'upper_arm_l', 'forearm_l', 'claw_l', 'upper_arm_r', 'forearm_r', 'claw_r']
rig = make_rig('alien', BONES)

HIDE = hexc(0x232a33)
HIDE_LT = hexc(0x3d4754)
RIB = hexc(0x141a20)
TEETH = hexc(0xd8d2c4)
GUM = hexc(0x3a1f22)
DOME = hexc(0x1b2026)
EYE = hexc(0x6a7f90)

m = PartMesh('alien', seed=13)
W = dict(wear=0.9, grime=0.3, rust=0.0, scratch=0.14)
# hips, spine, ribbed chest
m.box((0, 0, 31.5), (7, 8, 5), HIDE, 'hips', **W)
m.box((0, 0, 38), (6, 7, 8), HIDE, 'spine', **W)
for k in range(3):
    m.box((1.5, 0, 35 + k * 2.6), (6.5, 8.5, 1.2), RIB, 'spine', wear=0.4, grime=0.5)
m.box((0, 0, 46), (7, 9, 8), HIDE, 'chest', **W)
for k in range(3):
    m.box((2, 0, 43 + k * 2.6), (7.5, 9.5, 1.2), RIB, 'chest', wear=0.4, grime=0.5)
# dorsal tubes
for k in range(4):
    y = (-3 + k * 2) if k < 2 else (-3 + (k - 2) * 2)
    z = 50 + (k % 2) * 3
    x = -4 - (k // 2) * 2
    m.cylinder((x, y, z), 1.3, 9, HIDE_LT, 'chest', segments=6, axis='Z', wear=0.5, grime=0.3)
m.box((-3.5, 0, 52), (5, 8, 2), HIDE_LT, 'chest', **W)
# neck and the long dome
m.box((1.5, 0, 53), (4, 4, 6), HIDE, 'neck', **W)
m.box((4, 0, 58), (20, 7, 6), DOME, 'head', wear=1.0, grime=0.25, scratch=0.18)             # dome
m.box((-7, 0, 59), (8, 5.5, 4), DOME, 'head', wear=1.0, grime=0.25)                         # crest trailing back
m.box((12, 0, 55.5), (6, 6, 3), HIDE, 'head', **W)                                          # muzzle top
m.box((9, 0, 57.5), (3, 7.5, 2), EYE, 'head', wear=0.2, grime=0.1)                           # brow ridge
m.box((13, 0, 53.5), (6, 5, 1.5), TEETH, 'head', wear=0, grime=0.1)                          # upper teeth
m.box((13, 0, 52), (6, 5, 2.4), GUM, 'jaw', wear=0.2, grime=0.3)                             # jaw
m.box((13.5, 0, 53.1), (5, 4.6, 0.9), TEETH, 'jaw', wear=0, grime=0.1)                       # lower teeth
# arms
for side, sgn in (('l', 1), ('r', -1)):
    m.box((0, 6 * sgn, 42), (4, 4, 12), HIDE, f'upper_arm_{side}', **W)
    m.box((0, 6 * sgn, 30), (3.5, 3.5, 12), HIDE, f'forearm_{side}', **W)
    m.box((1.5, 6 * sgn, 21), (5, 3, 4), HIDE_LT, f'claw_{side}', wear=0.6)
    for k in range(3):
        m.box((4, (6 + (k - 1) * 1.2) * sgn, 18.5), (3, 0.8, 1.2), TEETH, f'claw_{side}', wear=0, grime=0.2)
# legs (digitigrade)
for side, sgn in (('l', 1), ('r', -1)):
    m.box((-1.5, 4 * sgn, 24), (5, 5, 13), HIDE, f'thigh_{side}', rot=(0, 14, 0), **W)
    m.box((1, 4 * sgn, 13), (4, 4, 12), HIDE, f'shin_{side}', rot=(0, -38, 0), **W)
    m.box((8, 4 * sgn, 4.5), (8, 4, 3.5), HIDE_LT, f'foot_{side}', rot=(0, 30, 0), **W)
    m.box((12, 4 * sgn, 1.5), (4, 3, 1.5), TEETH, f'foot_{side}', wear=0, grime=0.3)
# tail: tapering segments with a blade
m.box((-10, 0, 29.5), (12, 4.5, 4.5), HIDE, 'tail1', rot=(0, 14, 0), **W)
m.box((-22, 0, 25), (12, 3.5, 3.5), HIDE, 'tail2', rot=(0, 26, 0), **W)
m.box((-34, 0, 18), (12, 2.6, 2.6), HIDE, 'tail3', rot=(0, 34, 0), **W)
m.box((-41, 0, 13), (6, 1.2, 4), TEETH, 'tail3', rot=(0, 34, 0), wear=0.2, grime=0.2)
body = m.build(rig)

# ---------------------------------------------------------------------------- clips ----


def P(**kw):
    out = {}
    for k, v in kw.items():
        if isinstance(v, (int, float)):
            out[k] = dict(swing=v)
        else:
            out[k] = v
    return out


ARMS_READY = P(upper_arm_l=40, forearm_l=-70, claw_l=10, upper_arm_r=40, forearm_r=-70, claw_r=10)
TAIL_SWAY = lambda a: P(tail1=10 + a, tail2=16 + a, tail3=20 + a * 1.5)   # noqa: E731

clips = []
idle = {
    1: {**P(hips=dict(loc=(0, 0, 0)), spine=8, chest=10, neck=-20, head=4, jaw=0), **ARMS_READY, **P(thigh_l=-10, shin_l=10, thigh_r=14, shin_r=0), **TAIL_SWAY(0)},
    18: {**P(hips=dict(loc=(0, 0, -1)), spine=10, chest=12, neck=-24, head=6, jaw=6), **ARMS_READY, **P(thigh_l=-10, shin_l=10, thigh_r=14, shin_r=0), **TAIL_SWAY(8)},
    36: {**P(hips=dict(loc=(0, 0, 0)), spine=8, chest=10, neck=-20, head=4, jaw=0), **ARMS_READY, **P(thigh_l=-10, shin_l=10, thigh_r=14, shin_r=0), **TAIL_SWAY(-6)},
}
clips.append((make_clip(rig, 'idle', idle, loop=True), dict(loop=True)))
walk = {
    1: {**P(hips=dict(loc=(0, 0, 0)), spine=14, chest=10, neck=-24, head=4), **ARMS_READY, **P(thigh_l=-30, shin_l=20, thigh_r=30, shin_r=50, foot_l=-6, foot_r=16), **TAIL_SWAY(4)},
    7: {**P(hips=dict(loc=(0, 0, 1.5)), spine=15, chest=10, neck=-24, head=4), **ARMS_READY, **P(thigh_l=0, shin_l=36, thigh_r=8, shin_r=14, foot_l=8, foot_r=-4), **TAIL_SWAY(-4)},
    13: {**P(hips=dict(loc=(0, 0, 0)), spine=14, chest=10, neck=-24, head=4), **ARMS_READY, **P(thigh_l=30, shin_l=50, thigh_r=-30, shin_r=20, foot_l=16, foot_r=-6), **TAIL_SWAY(4)},
    19: {**P(hips=dict(loc=(0, 0, 1.5)), spine=15, chest=10, neck=-24, head=4), **ARMS_READY, **P(thigh_l=8, shin_l=14, thigh_r=0, shin_r=36, foot_l=-4, foot_r=8), **TAIL_SWAY(-4)},
}
clips.append((make_clip(rig, 'walk', walk, loop=True), dict(loop=True, events={'step': [1, 13]}, speed=110)))
run = {
    1: {**P(hips=dict(loc=(0, 0, 0)), spine=26, chest=14, neck=-30, head=0), **P(upper_arm_l=60, forearm_l=-80, upper_arm_r=60, forearm_r=-80), **P(thigh_l=-50, shin_l=30, thigh_r=46, shin_r=76, foot_l=-10, foot_r=20), **TAIL_SWAY(10)},
    5: {**P(hips=dict(loc=(0, 0, 3)), spine=28, chest=14, neck=-30, head=0), **P(upper_arm_l=60, forearm_l=-80, upper_arm_r=60, forearm_r=-80), **P(thigh_l=-6, shin_l=64, thigh_r=12, shin_r=24, foot_l=14, foot_r=-4), **TAIL_SWAY(-8)},
    9: {**P(hips=dict(loc=(0, 0, 0)), spine=26, chest=14, neck=-30, head=0), **P(upper_arm_l=60, forearm_l=-80, upper_arm_r=60, forearm_r=-80), **P(thigh_l=46, shin_l=76, thigh_r=-50, shin_r=30, foot_l=20, foot_r=-10), **TAIL_SWAY(10)},
    13: {**P(hips=dict(loc=(0, 0, 3)), spine=28, chest=14, neck=-30, head=0), **P(upper_arm_l=60, forearm_l=-80, upper_arm_r=60, forearm_r=-80), **P(thigh_l=12, shin_l=24, thigh_r=-6, shin_r=64, foot_l=-4, foot_r=14), **TAIL_SWAY(-8)},
}
clips.append((make_clip(rig, 'run', run, loop=True), dict(loop=True, events={'step': [1, 9]}, speed=260)))
# crawl: low on all fours, the hips dropped, arms planted ahead, head level with the floor
CRAWL_BASE = P(hips=dict(loc=(6, 0, -14)), spine=52, chest=20, neck=-50, head=-10)
crawl = {
    1: {**CRAWL_BASE, **P(upper_arm_l=100, forearm_l=-40, claw_l=30, upper_arm_r=60, forearm_r=-10, claw_r=30), **P(thigh_l=20, shin_l=60, thigh_r=60, shin_r=30, foot_l=10, foot_r=30), **TAIL_SWAY(-20)},
    7: {**CRAWL_BASE, **P(upper_arm_l=80, forearm_l=-30, claw_l=30, upper_arm_r=80, forearm_r=-30, claw_r=30), **P(thigh_l=40, shin_l=50, thigh_r=40, shin_r=50, foot_l=20, foot_r=20), **TAIL_SWAY(-14)},
    13: {**CRAWL_BASE, **P(upper_arm_l=60, forearm_l=-10, claw_l=30, upper_arm_r=100, forearm_r=-40, claw_r=30), **P(thigh_l=60, shin_l=30, thigh_r=20, shin_r=60, foot_l=30, foot_r=10), **TAIL_SWAY(-20)},
    19: {**CRAWL_BASE, **P(upper_arm_l=80, forearm_l=-30, claw_l=30, upper_arm_r=80, forearm_r=-30, claw_r=30), **P(thigh_l=40, shin_l=50, thigh_r=40, shin_r=50, foot_l=20, foot_r=20), **TAIL_SWAY(-26)},
}
clips.append((make_clip(rig, 'crawl', crawl, loop=True), dict(loop=True, events={'step': [1, 13]}, speed=120)))
# lurk: coiled and still in a vent mouth
lurk = {
    1: {**P(hips=dict(loc=(0, 0, -10)), spine=40, chest=20, neck=-50, head=-6, jaw=0), **P(upper_arm_l=70, forearm_l=-60, upper_arm_r=70, forearm_r=-60), **P(thigh_l=50, shin_l=70, thigh_r=50, shin_r=70), **TAIL_SWAY(-30)},
    24: {**P(hips=dict(loc=(0, 0, -11)), spine=42, chest=22, neck=-52, head=-4, jaw=8), **P(upper_arm_l=70, forearm_l=-60, upper_arm_r=70, forearm_r=-60), **P(thigh_l=50, shin_l=70, thigh_r=50, shin_r=70), **TAIL_SWAY(-24)},
}
clips.append((make_clip(rig, 'lurk', lurk, loop=True), dict(loop=True)))
# attack: rear back, then lunge with the head and both claws, jaw snapping
attack = {
    1: {**P(hips=dict(loc=(0, 0, 0)), spine=0, chest=-10, neck=-30, head=10, jaw=0), **P(upper_arm_l=90, forearm_l=-90, claw_l=-20, upper_arm_r=90, forearm_r=-90, claw_r=-20), **P(thigh_l=-20, shin_l=20, thigh_r=20, shin_r=30), **TAIL_SWAY(20)},
    4: {**P(hips=dict(loc=(-3, 0, -2)), spine=-10, chest=-16, neck=-40, head=16, jaw=14), **P(upper_arm_l=120, forearm_l=-100, claw_l=-30, upper_arm_r=120, forearm_r=-100, claw_r=-30), **P(thigh_l=-30, shin_l=30, thigh_r=24, shin_r=36), **TAIL_SWAY(30)},
    8: {**P(hips=dict(loc=(10, 0, 2)), spine=30, chest=20, neck=-10, head=-6, jaw=28), **P(upper_arm_l=120, forearm_l=10, claw_l=20, upper_arm_r=110, forearm_r=10, claw_r=20), **P(thigh_l=-50, shin_l=40, thigh_r=30, shin_r=60), **TAIL_SWAY(-10)},
    11: {**P(hips=dict(loc=(10, 0, 0)), spine=32, chest=22, neck=-10, head=-6, jaw=2), **P(upper_arm_l=100, forearm_l=0, claw_l=20, upper_arm_r=90, forearm_r=0, claw_r=20), **P(thigh_l=-50, shin_l=40, thigh_r=30, shin_r=60), **TAIL_SWAY(-16)},
    16: {**P(hips=dict(loc=(0, 0, 0)), spine=8, chest=10, neck=-20, head=4, jaw=0), **ARMS_READY, **P(thigh_l=-10, shin_l=10, thigh_r=14, shin_r=0), **TAIL_SWAY(0)},
}
clips.append((make_clip(rig, 'attack', attack, loop=False), dict(loop=False, events={'windup': [1], 'hit': [8]})))
hurt = {
    1: {**P(hips=dict(loc=(-3, 0, 0)), spine=-14, chest=-10, neck=-10, head=14, jaw=20), **P(upper_arm_l=60, forearm_l=-40, upper_arm_r=60, forearm_r=-40), **P(thigh_l=-16, shin_l=20, thigh_r=16, shin_r=10), **TAIL_SWAY(30)},
    9: {**P(hips=dict(loc=(0, 0, 0)), spine=8, chest=10, neck=-20, head=4, jaw=0), **ARMS_READY, **P(thigh_l=-10, shin_l=10, thigh_r=14, shin_r=0), **TAIL_SWAY(0)},
}
clips.append((make_clip(rig, 'hurt', hurt, loop=False), dict(loop=False)))
death = {
    1: {**P(hips=dict(loc=(0, 0, 0)), spine=-10, chest=-6, neck=-20, head=14, jaw=24), **P(upper_arm_l=70, forearm_l=-30, upper_arm_r=70, forearm_r=-30), **P(thigh_l=-10, shin_l=10, thigh_r=14, shin_r=0), **TAIL_SWAY(26)},
    8: {**P(hips=dict(loc=(-6, 0, -12)), spine=-30, chest=-10, neck=-10, head=20, jaw=30), **P(upper_arm_l=20, forearm_l=-10, upper_arm_r=10, forearm_r=-10), **P(thigh_l=30, shin_l=60, thigh_r=40, shin_r=70), **TAIL_SWAY(40)},
    20: {**P(hips=dict(loc=(-14, 0, -24)), spine=-70, chest=-6, neck=10, head=10, jaw=30), **P(upper_arm_l=-20, forearm_l=0, upper_arm_r=-30, forearm_r=0), **P(thigh_l=50, shin_l=30, thigh_r=60, shin_r=40), **TAIL_SWAY(10)},
    24: {**P(hips=dict(loc=(-14, 0, -25)), spine=-72, chest=-6, neck=12, head=10, jaw=30), **P(upper_arm_l=-20, forearm_l=0, upper_arm_r=-30, forearm_r=0), **P(thigh_l=50, shin_l=30, thigh_r=60, shin_r=40), **TAIL_SWAY(6)},
}
clips.append((make_clip(rig, 'death', death, loop=False), dict(loop=False)))

meta = dict(
    name='alien', facing='+x', height=64, width=30, crawlHeight=38, bones=[b['name'] for b in BONES], upper=UPPER, root='hips',
    clips=clip_meta(clips), speeds={'walk': 110, 'run': 260, 'crawl': 120}, eye=(12, 0, 56), mouth=(16, 0, 53),
)
export(out_path('alien'), meta, rig)
