"""The player: Sgt. Vance, a colonial marine in battered olive armour with a pulse rifle.
    blender --background --python tools/blender/marine.py -- assets/models/marine.glb
Units are pixels; the marine stands ~58 px tall and faces +X. See common.py for the conventions."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PartMesh, make_rig, make_clip, export, clip_meta, out_path, reset, hexc  # noqa: E402

reset()

# ----------------------------------------------------------------------------- rig ----
# Left (y > 0) is the side away from the camera when facing right; right (y < 0) is near.
BONES = [
    dict(name='hips', parent=None, head=(0, 0, 34), tail=(0, 0, 38)),
    dict(name='spine', parent='hips', head=(0, 0, 38), tail=(0, 0, 46)),
    dict(name='chest', parent='spine', head=(0, 0, 46), tail=(0, 0, 52)),
    dict(name='head', parent='chest', head=(0, 0, 52), tail=(0, 0, 60)),
    dict(name='upper_arm_l', parent='chest', head=(0, 7, 50), tail=(0, 7, 40)),
    dict(name='forearm_l', parent='upper_arm_l', head=(0, 7, 40), tail=(0, 7, 30)),
    dict(name='upper_arm_r', parent='chest', head=(0, -7, 50), tail=(0, -7, 40)),
    dict(name='forearm_r', parent='upper_arm_r', head=(0, -7, 40), tail=(0, -7, 30)),
    dict(name='gun', parent='chest', head=(4, -3, 44), tail=(28, -3, 44)),
    dict(name='thigh_l', parent='hips', head=(0, 4, 34), tail=(0, 4, 20)),
    dict(name='shin_l', parent='thigh_l', head=(0, 4, 20), tail=(0, 4, 6)),
    dict(name='foot_l', parent='shin_l', head=(0, 4, 6), tail=(7, 4, 1)),
    dict(name='thigh_r', parent='hips', head=(0, -4, 34), tail=(0, -4, 20)),
    dict(name='shin_r', parent='thigh_r', head=(0, -4, 20), tail=(0, -4, 6)),
    dict(name='foot_r', parent='shin_r', head=(0, -4, 6), tail=(7, -4, 1)),
]
UPPER = ['spine', 'chest', 'head', 'upper_arm_l', 'forearm_l', 'upper_arm_r', 'forearm_r', 'gun']
rig = make_rig('marine', BONES)

# ---------------------------------------------------------------------------- mesh ----
ARMOUR = hexc(0x4f5a3c)
ARMOUR_DK = hexc(0x3a4330)
SUIT = hexc(0x23261f)
SKIN = hexc(0xb98a66)
VISOR = hexc(0x1a2430)
RIFLE = hexc(0x1d1e22)
RIFLE_LT = hexc(0x3a3c42)
BOOT = hexc(0x1a1714)
STRAP = hexc(0x3b3222)
PACK = hexc(0x35392c)
LAMP = hexc(0xdff6ff)

m = PartMesh('marine', seed=7)
W = dict(wear=0.7, grime=0.6, rust=0.05, scratch=0.08)
# hips and belt
m.box((0, 0, 36), (9, 11, 5), SUIT, 'hips', **W)
m.box((0, 0, 38.5), (10, 12, 2), STRAP, 'hips', wear=0.3, grime=0.5)
m.box((3, -5.5, 37), (4, 2, 4), ARMOUR_DK, 'hips', **W)          # pouch
# torso: undersuit, chest plate, back plate, pack
m.box((0, 0, 42), (8, 11, 8), SUIT, 'spine', **W)
m.box((0, 0, 49), (10, 13, 7), ARMOUR, 'chest', **W)
m.box((1.5, 0, 49.5), (3, 11, 5), ARMOUR_DK, 'chest', wear=0.9, grime=0.3)   # chest plate ridge
m.box((-6.5, 0, 47), (4, 10, 11), PACK, 'chest', **W)                        # backpack
m.box((-6.5, 3.5, 53), (2.5, 2.5, 3), RIFLE_LT, 'chest', wear=0.2)            # antenna base
m.box((0, 7.5, 50.5), (6, 3, 4), ARMOUR, 'chest', **W)                        # pauldrons
m.box((0, -7.5, 50.5), (6, 3, 4), ARMOUR, 'chest', **W)
# head: neck, helmet, visor, lamp
m.box((0, 0, 52.5), (4, 4, 2), SKIN, 'head', wear=0.2, grime=0.2, rust=0)
m.box((0, 0, 56.5), (8, 9, 7), ARMOUR, 'head', **W)
m.box((3.5, 0, 55.5), (2, 7, 3), VISOR, 'head', wear=0.1, grime=0.1, rust=0)
m.box((0, 0, 60.5), (7, 8, 1.5), ARMOUR_DK, 'head', **W)
m.box((4, -2, 58.5), (1.5, 2, 1.5), LAMP, 'head', wear=0, grime=0, rust=0, emissive=True)   # helmet lamp
# arms
for side, sgn in (('l', 1), ('r', -1)):
    m.box((0, 7 * sgn, 45), (5, 5, 10), ARMOUR, f'upper_arm_{side}', **W)
    m.box((0, 7 * sgn, 35), (4.5, 4.5, 10), SUIT, f'forearm_{side}', **W)
    m.box((0, 7 * sgn, 29.5), (4, 4.5, 3), STRAP, f'forearm_{side}', wear=0.3)     # glove
# rifle: receiver, barrel, magazine, stock, grip, muzzle lamp
m.box((16, -3, 44), (18, 3, 4), RIFLE, 'gun', wear=0.5, grime=0.3, rust=0.02, scratch=0.1)
m.box((24, -3, 45), (6, 2.2, 2.2), RIFLE_LT, 'gun', wear=0.5, grime=0.2, rust=0.02)      # barrel shroud
m.cylinder((29, -3, 45), 0.9, 6, RIFLE_LT, 'gun', segments=6, axis='X', wear=0.3, grime=0.1)
m.box((14, -3, 41), (3, 2.4, 5), RIFLE_LT, 'gun', wear=0.5, grime=0.3)                     # magazine
m.box((4, -3, 43.5), (6, 2.6, 3), RIFLE, 'gun', wear=0.5, grime=0.3)                       # stock
m.box((11, -3, 41.5), (2.2, 2.2, 3), STRAP, 'gun', wear=0.4)                              # grip
m.box((19, -3, 46.6), (4, 1.6, 1.2), ARMOUR_DK, 'gun', wear=0.5)                          # sight rail
# legs
for side, sgn in (('l', 1), ('r', -1)):
    m.box((0, 4 * sgn, 27), (6, 5.5, 13), ARMOUR, f'thigh_{side}', **W)
    m.box((0, 4 * sgn, 13.5), (5, 5, 12), SUIT, f'shin_{side}', **W)
    m.box((1, 4 * sgn, 15), (3, 5.5, 7), ARMOUR_DK, f'shin_{side}', **W)                  # shin guard
    m.box((2.5, 4 * sgn, 3), (9, 5.5, 5), BOOT, f'foot_{side}', wear=0.4, grime=0.8, rust=0.02)
body = m.build(rig, emissive_color=(0.75, 0.95, 1.0), emissive_strength=4.0)

# ---------------------------------------------------------------------------- clips ----
# Holding the rifle: both arms forward, the near (right) hand at the grip, the far hand under the barrel.
HOLD = {
    'upper_arm_l': dict(swing=52, side=-10), 'forearm_l': dict(swing=52),
    'upper_arm_r': dict(swing=38, side=4), 'forearm_r': dict(swing=70),
    'gun': dict(swing=0),
}
LOW = {   # rifle lowered a touch between fights
    'upper_arm_l': dict(swing=42, side=-10), 'forearm_l': dict(swing=50),
    'upper_arm_r': dict(swing=28, side=4), 'forearm_r': dict(swing=72),
    'gun': dict(swing=-14),
}


def legs(tl, sl, tr, sr, fl=0, fr=0):
    return {'thigh_l': dict(swing=tl), 'shin_l': dict(swing=sl), 'thigh_r': dict(swing=tr), 'shin_r': dict(swing=sr),
            'foot_l': dict(swing=fl), 'foot_r': dict(swing=fr)}


def pose(**parts):
    p = {}
    for part in parts.values():
        p.update(part)
    return p


clips = []
# idle: a slow breath with the rifle low
idle = {
    1: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=2), 'chest': dict(swing=1), 'head': dict(swing=-2)}, a=LOW, l=legs(-6, 8, 8, 4)),
    24: pose(h={'hips': dict(loc=(0, 0, -0.8))}, s={'spine': dict(swing=3), 'chest': dict(swing=2), 'head': dict(swing=-3)}, a={**LOW, 'gun': dict(swing=-12)}, l=legs(-6, 8, 8, 4)),
}
clips.append((make_clip(rig, 'idle', idle, loop=True), dict(loop=True)))
# walk: two steps per cycle, the rifle held low and bobbing
walk = {
    1: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=4)}, a=LOW, l=legs(-26, 6, 24, 40, -4, 10)),
    7: pose(h={'hips': dict(loc=(0, 0, 1.2))}, s={'spine': dict(swing=5)}, a=LOW, l=legs(2, 26, 6, 12, 8, -4)),
    13: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=4)}, a=LOW, l=legs(24, 40, -26, 6, 10, -4)),
    19: pose(h={'hips': dict(loc=(0, 0, 1.2))}, s={'spine': dict(swing=5)}, a=LOW, l=legs(6, 12, 2, 26, -4, 8)),
}
clips.append((make_clip(rig, 'walk', walk, loop=True), dict(loop=True, events={'step': [1, 13]}, speed=95)))
# run: a driving sprint, body leaning in, rifle tucked
run = {
    1: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=12), 'chest': dict(swing=4), 'head': dict(swing=-8)}, a=HOLD, l=legs(-44, 18, 42, 70, -6, 14)),
    5: pose(h={'hips': dict(loc=(0, 0, 2.5))}, s={'spine': dict(swing=13), 'chest': dict(swing=4), 'head': dict(swing=-8)}, a=HOLD, l=legs(-4, 60, 10, 20, 12, -2)),
    9: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=12), 'chest': dict(swing=4), 'head': dict(swing=-8)}, a=HOLD, l=legs(42, 70, -44, 18, 14, -6)),
    13: pose(h={'hips': dict(loc=(0, 0, 2.5))}, s={'spine': dict(swing=13), 'chest': dict(swing=4), 'head': dict(swing=-8)}, a=HOLD, l=legs(10, 20, -4, 60, -2, 12)),
}
clips.append((make_clip(rig, 'run', run, loop=True), dict(loop=True, events={'step': [1, 9]}, speed=230)))
# jump / fall / land
jump = {
    1: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=6)}, a=HOLD, l=legs(-30, 50, 20, 30, 10, 10)),
    8: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=4)}, a=HOLD, l=legs(-20, 40, 30, 50, 10, 10)),
}
clips.append((make_clip(rig, 'jump', jump, loop=False), dict(loop=False)))
fall = {
    1: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=-2)}, a=HOLD, l=legs(-16, 30, 24, 46, 14, 14)),
    12: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=-3)}, a=HOLD, l=legs(-22, 36, 28, 52, 16, 16)),
}
clips.append((make_clip(rig, 'fall', fall, loop=True), dict(loop=True)))
land = {
    1: pose(h={'hips': dict(loc=(0, 0, -7))}, s={'spine': dict(swing=16), 'head': dict(swing=-6)}, a=HOLD, l=legs(-40, 64, 36, 68, -10, -10)),
    8: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=4)}, a=HOLD, l=legs(-6, 8, 8, 4)),
}
clips.append((make_clip(rig, 'land', land, loop=False), dict(loop=False)))
# aim (upper body): rifle shouldered and level; the game adds the aim pitch on top
aim = {1: pose(a=HOLD, s={'chest': dict(swing=0)}), 2: pose(a=HOLD, s={'chest': dict(swing=0)})}
clips.append((make_clip(rig, 'aim', aim, loop=True, root='__none__'), dict(loop=True, upper=True)))
# fire (upper): a short recoil
fire = {
    1: pose(a=HOLD, s={'chest': dict(swing=0)}),
    2: pose(a={**HOLD, 'upper_arm_l': dict(swing=48, side=-10), 'upper_arm_r': dict(swing=34, side=4), 'gun': dict(swing=3)}, s={'chest': dict(swing=-4)}),
    6: pose(a=HOLD, s={'chest': dict(swing=0)}),
}
clips.append((make_clip(rig, 'fire', fire, loop=False, root='__none__'), dict(loop=False, upper=True)))
# reload (upper): rifle tilts down, the far hand drops to the magazine and comes back
reload_ = {
    1: pose(a=HOLD, s={'chest': dict(swing=0), 'head': dict(swing=0)}),
    8: pose(a={**HOLD, 'gun': dict(swing=-22), 'forearm_l': dict(swing=10), 'upper_arm_l': dict(swing=30, side=-8)}, s={'chest': dict(swing=4), 'head': dict(swing=10)}),
    16: pose(a={**HOLD, 'gun': dict(swing=-22), 'forearm_l': dict(swing=30), 'upper_arm_l': dict(swing=20, side=-8)}, s={'chest': dict(swing=4), 'head': dict(swing=12)}),
    24: pose(a={**HOLD, 'gun': dict(swing=-16), 'forearm_l': dict(swing=48), 'upper_arm_l': dict(swing=40, side=-10)}, s={'chest': dict(swing=2), 'head': dict(swing=6)}),
    30: pose(a=HOLD, s={'chest': dict(swing=0), 'head': dict(swing=0)}),
}
clips.append((make_clip(rig, 'reload', reload_, loop=False, root='__none__'), dict(loop=False, upper=True, events={'mag_out': [8], 'mag_in': [24]})))
# strike (upper): a rifle-butt jab for anything that gets too close
strike = {
    1: pose(a=HOLD, s={'chest': dict(swing=0)}),
    4: pose(a={**HOLD, 'upper_arm_l': dict(swing=30, side=-10), 'upper_arm_r': dict(swing=20, side=4), 'gun': dict(swing=10)}, s={'chest': dict(swing=-6)}),
    7: pose(a={**HOLD, 'upper_arm_l': dict(swing=70, side=-10), 'upper_arm_r': dict(swing=60, side=4), 'forearm_r': dict(swing=40), 'gun': dict(swing=-6)}, s={'chest': dict(swing=10)}),
    12: pose(a=HOLD, s={'chest': dict(swing=0)}),
}
clips.append((make_clip(rig, 'strike', strike, loop=False, root='__none__'), dict(loop=False, upper=True, events={'hit': [7]})))
# hurt
hurt = {
    1: pose(h={'hips': dict(loc=(-2, 0, 0))}, s={'spine': dict(swing=-14), 'chest': dict(swing=-6), 'head': dict(swing=-12)}, a=HOLD, l=legs(-14, 16, 16, 10)),
    10: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=2)}, a=HOLD, l=legs(-6, 8, 8, 4)),
}
clips.append((make_clip(rig, 'hurt', hurt, loop=False), dict(loop=False)))
# dodge: a backward hop with the knees tucked
dodge = {
    1: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=-10)}, a=HOLD, l=legs(-20, 30, 10, 30, 10, 10)),
    5: pose(h={'hips': dict(loc=(0, 0, 6))}, s={'spine': dict(swing=-18)}, a=HOLD, l=legs(30, 70, 40, 80, 20, 20)),
    10: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=0)}, a=HOLD, l=legs(-6, 8, 8, 4)),
}
clips.append((make_clip(rig, 'dodge', dodge, loop=False), dict(loop=False)))
# climb: hand over hand up a ladder, the rifle slung
climb = {
    1: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=6), 'head': dict(swing=-10)},
            a={'upper_arm_l': dict(swing=160), 'forearm_l': dict(swing=-10), 'upper_arm_r': dict(swing=100), 'forearm_r': dict(swing=-40), 'gun': dict(swing=-80)},
            l=legs(-60, 70, -10, 20, 20, 20)),
    7: pose(h={'hips': dict(loc=(0, 0, -2))}, s={'spine': dict(swing=8), 'head': dict(swing=-8)},
            a={'upper_arm_l': dict(swing=130), 'forearm_l': dict(swing=-30), 'upper_arm_r': dict(swing=130), 'forearm_r': dict(swing=-30), 'gun': dict(swing=-80)},
            l=legs(-35, 45, -35, 45, 20, 20)),
    13: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=6), 'head': dict(swing=-10)},
             a={'upper_arm_l': dict(swing=100), 'forearm_l': dict(swing=-40), 'upper_arm_r': dict(swing=160), 'forearm_r': dict(swing=-10), 'gun': dict(swing=-80)},
             l=legs(-10, 20, -60, 70, 20, 20)),
    19: pose(h={'hips': dict(loc=(0, 0, -2))}, s={'spine': dict(swing=8), 'head': dict(swing=-8)},
             a={'upper_arm_l': dict(swing=130), 'forearm_l': dict(swing=-30), 'upper_arm_r': dict(swing=130), 'forearm_r': dict(swing=-30), 'gun': dict(swing=-80)},
             l=legs(-35, 45, -35, 45, 20, 20)),
}
clips.append((make_clip(rig, 'climb', climb, loop=True), dict(loop=True, events={'rung': [1, 13]})))
# death: knees buckle, falls onto the back
death = {
    1: pose(h={'hips': dict(loc=(0, 0, 0))}, s={'spine': dict(swing=-10), 'head': dict(swing=-14)}, a=HOLD, l=legs(-10, 16, 12, 10)),
    8: pose(h={'hips': dict(loc=(-4, 0, -12))}, s={'spine': dict(swing=-24), 'chest': dict(swing=-6), 'head': dict(swing=-20)},
            a={'upper_arm_l': dict(swing=10, side=-30), 'forearm_l': dict(swing=10), 'upper_arm_r': dict(swing=0, side=30), 'forearm_r': dict(swing=20), 'gun': dict(swing=40)},
            l=legs(40, 70, 50, 80, 10, 10)),
    22: pose(h={'hips': dict(loc=(-12, 0, -30))}, s={'spine': dict(swing=-80), 'chest': dict(swing=-4), 'head': dict(swing=-10)},
             a={'upper_arm_l': dict(swing=-20, side=-50), 'forearm_l': dict(swing=0), 'upper_arm_r': dict(swing=-30, side=50), 'forearm_r': dict(swing=0), 'gun': dict(swing=70)},
             l=legs(60, 20, 70, 30, 0, 0)),
    30: pose(h={'hips': dict(loc=(-12, 0, -30))}, s={'spine': dict(swing=-82), 'chest': dict(swing=-4), 'head': dict(swing=-6)},
             a={'upper_arm_l': dict(swing=-20, side=-50), 'forearm_l': dict(swing=0), 'upper_arm_r': dict(swing=-30, side=50), 'forearm_r': dict(swing=0), 'gun': dict(swing=70)},
             l=legs(60, 20, 70, 30, 0, 0)),
}
clips.append((make_clip(rig, 'death', death, loop=False), dict(loop=False)))

meta = dict(
    name='marine', facing='+x', height=62, width=24, bones=[b['name'] for b in BONES], upper=UPPER, root='hips',
    clips=clip_meta(clips), aim_bone='chest', gun_bone='gun', muzzle=(32, -3, 45), eye=(4, 0, 56),
    speeds={'walk': 95, 'run': 230},
)
export(out_path('marine'), meta, rig)
