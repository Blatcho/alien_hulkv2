"""The dropship Kestrel 21, seen side-on and docked nose-first to the rear airlock. Static, 6 tiles long,
3 tiles tall, with emissive cockpit glass and engine glow. Origin: the docking collar (its left-most
point at x=0, floor of the airlock deck at z=0).
    blender --background --python tools/blender/kestrel.py -- assets/models/kestrel.glb"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PartMesh, export, out_path, reset, hexc  # noqa: E402

reset()
HULL = hexc(0x555b63)
HULL_DK = hexc(0x3a3f46)
HULL_LT = hexc(0x7a828b)
STRIPE = hexc(0xb59a2a)
GLASS = hexc(0x9fd8ff)
ENGINE = hexc(0xff9a4a)
TYRE = hexc(0x1c1d20)

m = PartMesh('kestrel', seed=21)
W = dict(wear=0.7, grime=0.6, rust=0.1, scratch=0.12)
# docking collar and boarding tube
m.box((6, 0, 48), (12, 30, 80), HULL_DK, **W)
m.box((3, -16, 48), (6, 2, 70), STRIPE, wear=0.9, grime=0.5, rust=0.2)
m.box((16, 0, 46), (10, 26, 56), HULL, **W)
# fuselage: a fat body with a stepped nose block (nose faces the ship, -x side), tail to the right
m.box((80, 0, 50), (120, 40, 60), HULL, **W)
m.box((80, -21, 50), (110, 2, 48), HULL_DK, wear=0.5, grime=0.6, rust=0.12)           # side plating
m.box((80, -22.2, 62), (100, 1.2, 4), STRIPE, wear=0.9, grime=0.5, rust=0.2)           # stripe
m.box((34, 0, 60), (28, 36, 36), HULL_DK, **W)                                          # cockpit block
m.box((26, -14, 64), (14, 10, 12), GLASS, wear=0, grime=0, rust=0, emissive=True)      # cockpit glass
m.box((26, 14, 64), (14, 10, 12), GLASS, wear=0, grime=0, rust=0, emissive=True)
# wings (stubby, edge on) and engine pods
m.box((110, 0, 40), (60, 90, 6), HULL_DK, **W)
for y in (-38, 38):
    m.cylinder((126, y, 44), 11, 44, HULL, segments=10, axis='X', **W)
    m.cylinder((150, y, 44), 7, 4, ENGINE, segments=10, axis='X', wear=0, grime=0, rust=0, emissive=True)
# tail fin and rear ramp
m.box((136, 0, 84), (24, 4, 28), HULL_DK, **W)
m.box((136, 0, 98), (10, 4, 4), STRIPE, wear=0.9, grime=0.4, rust=0.15)
m.box((132, 0, 24), (26, 36, 8), HULL_DK, **W)
# landing gear and hull detail
for x in (50, 118):
    m.box((x, -10, 12), (4, 4, 20), HULL_LT, wear=0.4, grime=0.6, rust=0.15)
    m.cylinder((x, -10, 4), 4.5, 6, TYRE, segments=8, axis='Y', wear=0.3, grime=0.7)
for k in range(5):
    m.box((56 + k * 14, -22.4, 50), (8, 0.8, 8), HULL_LT, wear=0.5, grime=0.5, rust=0.1)
m.box((70, -22.6, 40), (30, 0.6, 3), HULL_LT, wear=0.3, grime=0.5)                      # 'KESTREL 21' plate
m.build(None, emissive_color=(1.0, 0.75, 0.45), emissive_strength=3.0)
export(out_path('kestrel'), dict(name='kestrel', width=192, height=96, origin='collar-left'))
