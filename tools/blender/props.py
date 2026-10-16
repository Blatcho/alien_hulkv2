"""Props, loot and set dressing: one GLB per kind, origin at the bottom centre, facing +X.
    blender --background --python tools/blender/props.py -- assets/models/"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PartMesh, export, reset, hexc, MODELS  # noqa: E402

OUT = MODELS
if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 1:
    OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)

STEEL = hexc(0x4a5058)
STEEL_DK = hexc(0x2f343a)
STEEL_LT = hexc(0x6b737c)
CRATE = hexc(0x5a5a3c)
CRATE2 = hexc(0x4a4f5a)
BARREL = hexc(0x3f4f3a)
BARREL_R = hexc(0x6e2f2a)
WARN = hexc(0xb59a2a)
SCREEN = hexc(0x66d9a0)
SCREEN_B = hexc(0x6ab8ff)
GLASS = hexc(0x9fd9f0)
SKIN = hexc(0xb98a66)
CLOTH = hexc(0x6b6355)
RESIN = hexc(0x2a2126)
RESIN_LT = hexc(0x4a3540)
EGG = hexc(0x3b3a30)
EGG_LT = hexc(0x6c6a4d)
GREEN = hexc(0x5aff6a)
RED = hexc(0xff5a3a)
AMMO = hexc(0x6a6a3a)
MED = hexc(0xe8e8e8)
PLANT = hexc(0x3c6a35)
RUST = hexc(0x6b4a2a)


def piece(name, build, meta_extra=None, seed=1, emissive=(0.85, 0.95, 1.0), strength=3.0):
    reset()
    m = PartMesh(name, seed=seed)
    build(m)
    m.build(None, emissive_color=emissive, emissive_strength=strength)
    export(os.path.join(OUT, name + '.glb'), dict(name=name, origin='bottom-centre', **(meta_extra or {})))


W = dict(wear=0.7, grime=0.6, rust=0.14, scratch=0.1)

piece('crate', lambda m: (m.box((0, 0, 11), (26, 22, 22), CRATE, **W), m.box((0, -11.5, 11), (22, 1.5, 3), STEEL_DK, wear=0.4),
                          m.box((0, -11.8, 16), (6, 1, 6), WARN, wear=0.9, grime=0.5, rust=0.2)), dict(w=26, h=22, solid=True), seed=21)
piece('crate_tall', lambda m: (m.box((0, 0, 20), (24, 22, 40), CRATE2, **W), m.box((0, -11.5, 10), (20, 1.5, 3), STEEL_LT, wear=0.4),
                               m.box((0, -11.5, 30), (20, 1.5, 3), STEEL_LT, wear=0.4)), dict(w=24, h=40, solid=True), seed=22)
piece('barrel', lambda m: (m.cylinder((0, 0, 13), 9, 26, BARREL, segments=10, axis='Z', **W),
                           m.cylinder((0, 0, 6), 9.6, 2, STEEL_DK, segments=10, axis='Z', wear=0.4),
                           m.cylinder((0, 0, 20), 9.6, 2, STEEL_DK, segments=10, axis='Z', wear=0.4)), dict(w=19, h=26, solid=True), seed=23)
piece('barrel_red', lambda m: (m.cylinder((0, 0, 13), 9, 26, BARREL_R, segments=10, axis='Z', **W),
                               m.cylinder((0, 0, 13), 9.6, 2, STEEL_DK, segments=10, axis='Z', wear=0.4),
                               m.box((0, -9.4, 15), (8, 1, 8), WARN, wear=0.9, grime=0.5, rust=0.2)), dict(w=19, h=26, solid=True, explosive=True), seed=24)
piece('locker', lambda m: (m.box((0, 0, 24), (18, 14, 48), STEEL, **W), m.box((0, -7.5, 24), (14, 1.2, 44), STEEL_DK, wear=0.3, grime=0.7),
                           m.box((5, -8.2, 24), (2, 0.8, 6), STEEL_LT, wear=0.4), m.box((0, -8.2, 40), (10, 0.8, 4), STEEL_LT, wear=0.4)), dict(w=18, h=48), seed=25)
piece('cabinet', lambda m: (m.box((0, 0, 18), (30, 14, 36), STEEL_LT, **W), m.box((0, -7.5, 18), (26, 1.2, 32), STEEL_DK, wear=0.3, grime=0.6),
                            m.box((0, -8.3, 24), (22, 0.8, 1.2), STEEL_LT, wear=0.3), m.box((0, -8.3, 12), (22, 0.8, 1.2), STEEL_LT, wear=0.3)), dict(w=30, h=36), seed=26)


def console(m):
    m.box((0, 0, 8), (30, 16, 16), STEEL_DK, **W)
    m.box((0, -1, 20), (28, 10, 8), STEEL, rot=(-20, 0, 0), **W)
    m.box((0, -5.5, 21.5), (22, 1, 5), SCREEN, rot=(-20, 0, 0), wear=0, grime=0, rust=0, emissive=True)
    m.box((-8, 0, 17.2), (6, 6, 1), STEEL_LT, wear=0.3, grime=0.4)
    m.cylinder((9, -4, 17.4), 1.2, 1, RED, segments=6, axis='Z', wear=0, grime=0, rust=0, emissive=True)
piece('console', console, dict(w=30, h=26, interact='console'), seed=27, emissive=(0.4, 0.85, 0.63), strength=4.0)


def console_tall(m):
    m.box((0, 0, 22), (24, 14, 44), STEEL_DK, **W)
    m.box((0, -7.5, 30), (18, 1.2, 14), SCREEN_B, wear=0, grime=0, rust=0, emissive=True)
    for k in range(4):
        m.box((-6 + k * 4, -7.6, 14), (2.5, 1, 2.5), STEEL_LT if k % 2 else GREEN, wear=0.2, grime=0.2, rust=0, emissive=k % 2 == 0)
piece('console_tall', console_tall, dict(w=24, h=44), seed=28, emissive=(0.42, 0.72, 1.0), strength=3.5)


def cryopod(m):
    m.box((0, 0, 6), (24, 18, 12), STEEL_DK, **W)
    m.box((0, 0, 32), (20, 14, 40), GLASS, wear=0.1, grime=0.3, rust=0, scratch=0.2)
    m.box((0, 0, 32), (8, 6, 26), SKIN, wear=0.1, grime=0.3, rust=0)
    m.box((0, 0, 54), (22, 16, 4), STEEL, **W)
    m.box((0, -8.5, 54), (12, 1.5, 2), SCREEN_B, wear=0, grime=0, rust=0, emissive=True)
piece('cryopod', cryopod, dict(w=24, h=56), seed=29, emissive=(0.5, 0.8, 1.0), strength=2.5)

piece('bunk', lambda m: (m.box((0, 0, 10), (40, 18, 4), STEEL_DK, **W), m.box((0, 0, 13), (38, 16, 3), CLOTH, wear=0.3, grime=0.7, rust=0),
                         m.box((0, 0, 30), (40, 18, 4), STEEL_DK, **W), m.box((0, 0, 33), (38, 16, 3), CLOTH, wear=0.3, grime=0.7, rust=0),
                         m.box((-19, 0, 20), (2, 16, 40), STEEL, **W), m.box((19, 0, 20), (2, 16, 40), STEEL, **W)), dict(w=40, h=40), seed=30)
piece('table', lambda m: (m.box((0, 0, 19), (36, 18, 2), STEEL_LT, **W), m.box((-14, 0, 9), (3, 14, 18), STEEL_DK, **W), m.box((14, 0, 9), (3, 14, 18), STEEL_DK, **W),
                          m.box((6, -4, 21.5), (5, 5, 3), BARREL_R, wear=0.3, grime=0.3)), dict(w=36, h=22), seed=31)
piece('chair', lambda m: (m.box((0, 0, 12), (14, 14, 3), CLOTH, wear=0.3, grime=0.6, rust=0), m.box((-6, 0, 22), (3, 14, 18), CLOTH, wear=0.3, grime=0.6, rust=0),
                          m.box((0, 0, 5), (4, 4, 10), STEEL_DK, **W), m.box((0, 0, 1), (12, 12, 2), STEEL_DK, **W)), dict(w=14, h=30), seed=32)
piece('rack', lambda m: (m.box((0, 0, 24), (4, 10, 48), STEEL_DK, **W), m.box((0, 0, 46), (30, 10, 3), STEEL_DK, **W), m.box((0, 0, 24), (30, 10, 2), STEEL_DK, **W),
                         *[m.box((-10 + k * 7, 0, 36), (2.5, 2.5, 20), STEEL_LT, wear=0.5, grime=0.4) for k in range(4)]), dict(w=30, h=48), seed=33)
piece('planter', lambda m: (m.box((0, 0, 8), (34, 16, 16), STEEL_DK, **W), *[m.box((-12 + k * 8, 0, 22), (5, 5, 12), PLANT, rot=(0, k * 15 - 20, 0), wear=0.2, grime=0.5, rust=0) for k in range(4)]), dict(w=34, h=30), seed=34)


def generator(m):
    m.box((0, 0, 18), (44, 22, 36), STEEL, **W)
    m.cylinder((0, 0, 44), 10, 16, STEEL_DK, segments=10, axis='Z', **W)
    m.box((0, -11.5, 18), (30, 1.5, 12), STEEL_DK, wear=0.4, grime=0.6)
    for k in range(3):
        m.cylinder((-8 + k * 8, -12.5, 18), 1.6, 1.2, GREEN if k < 2 else RED, segments=6, axis='Y', wear=0, grime=0, rust=0, emissive=True)
piece('generator', generator, dict(w=44, h=52, interact='generator'), seed=35, emissive=(0.5, 1.0, 0.5), strength=3.0)


def reactor(m):
    m.box((0, 0, 10), (48, 24, 20), STEEL_DK, **W)
    m.cylinder((0, 0, 44), 16, 48, STEEL, segments=12, axis='Z', **W)
    m.cylinder((0, 0, 44), 17, 6, STEEL_DK, segments=12, axis='Z', wear=0.4)
    m.cylinder((0, 0, 30), 17, 6, STEEL_DK, segments=12, axis='Z', wear=0.4)
    m.box((0, -16, 44), (10, 2, 20), hexc(0xffa040), wear=0, grime=0, rust=0, emissive=True)
piece('reactor', reactor, dict(w=48, h=70), seed=36, emissive=(1.0, 0.6, 0.25), strength=4.0)


def engine(m):
    m.cylinder((0, 0, 30), 22, 60, STEEL_DK, segments=12, axis='X', **W)
    m.cylinder((-24, 0, 30), 24, 8, STEEL, segments=12, axis='X', wear=0.5, grime=0.6, rust=0.2)
    m.cylinder((24, 0, 30), 24, 8, STEEL, segments=12, axis='X', wear=0.5, grime=0.6, rust=0.2)
    m.box((0, -22, 14), (40, 4, 6), RUST, wear=0.5, grime=0.7, rust=0.4)
    m.cylinder((30, 0, 30), 12, 6, hexc(0x4aa8ff), segments=12, axis='X', wear=0, grime=0, rust=0, emissive=True)
piece('engine', engine, dict(w=60, h=60), seed=37, emissive=(0.35, 0.65, 1.0), strength=3.0)

piece('pipe', lambda m: (m.cylinder((0, 0, 40), 3, 60, STEEL_LT, segments=8, axis='X', wear=0.5, grime=0.6, rust=0.2),
                         m.cylinder((-20, 0, 40), 4, 4, STEEL_DK, segments=8, axis='X', wear=0.4), m.cylinder((20, 0, 40), 4, 4, STEEL_DK, segments=8, axis='X', wear=0.4),
                         m.cylinder((0, 0, 20), 3, 40, STEEL_LT, segments=8, axis='Z', wear=0.5, grime=0.6, rust=0.2)), dict(w=60, h=44, background=True), seed=38)
piece('debris', lambda m: (m.box((-6, 0, 3), (16, 10, 6), STEEL_DK, rot=(0, 0, 20), **W), m.box((8, 3, 2), (12, 8, 4), RUST, rot=(0, 0, -30), wear=0.5, grime=0.7, rust=0.5),
                           m.box((2, -4, 6), (8, 6, 3), STEEL, rot=(0, 20, 0), **W)), dict(w=30, h=9, background=True), seed=39)


def resin(m):
    for k in range(6):
        a = k * 1.05
        m.box((math.cos(a) * 10, 0, 10 + (k % 3) * 9), (10 + (k % 2) * 6, 6, 14), RESIN if k % 2 else RESIN_LT, rot=(0, (k * 23) % 60 - 30, 0), wear=0.3, grime=0.8, rust=0, scratch=0.05)
    m.box((0, 0, 4), (36, 10, 8), RESIN, wear=0.3, grime=0.8, rust=0)
piece('resin', resin, dict(w=36, h=40, background=True), seed=40)


def egg(m):
    m.cylinder((0, 0, 9), 8, 18, EGG, segments=8, axis='Z', wear=0.3, grime=0.6, rust=0)
    m.cylinder((0, 0, 20), 5, 6, EGG_LT, segments=8, axis='Z', wear=0.3, grime=0.4, rust=0)
    m.box((0, 0, 23.5), (6, 6, 1.5), hexc(0x8cff7a), wear=0, grime=0, rust=0, emissive=True)
    m.box((0, 0, 3), (18, 12, 3), RESIN, wear=0.3, grime=0.8, rust=0)
piece('egg', egg, dict(w=18, h=25), seed=41, emissive=(0.55, 1.0, 0.45), strength=2.0)

# loot
piece('ammo', lambda m: (m.box((0, 0, 5), (14, 10, 10), AMMO, wear=0.6, grime=0.4, rust=0.1), m.box((0, -5.2, 5), (10, 0.8, 6), STEEL_DK, wear=0.3),
                         m.box((0, -5.6, 5), (6, 0.6, 2), WARN, wear=0.8, grime=0.3)), dict(w=14, h=10, pickup='ammo'), seed=42)
piece('medkit', lambda m: (m.box((0, 0, 5), (14, 10, 10), MED, wear=0.3, grime=0.3, rust=0), m.box((0, -5.2, 5), (6, 0.8, 2), RED, wear=0, grime=0, rust=0, emissive=True),
                           m.box((0, -5.2, 5), (2, 0.8, 6), RED, wear=0, grime=0, rust=0, emissive=True)), dict(w=14, h=10, pickup='medkit'), seed=43, emissive=(1.0, 0.35, 0.25), strength=2.0)
piece('weapon_shotgun', lambda m: (m.box((0, 0, 4), (26, 3, 3), STEEL_DK, wear=0.5, grime=0.3, rust=0.05), m.cylinder((10, 0, 5), 1.2, 14, STEEL_LT, segments=6, axis='X', wear=0.4),
                                   m.box((-9, 0, 3), (8, 3, 4), hexc(0x5a3a22), wear=0.5, grime=0.4, rust=0)), dict(w=26, h=7, pickup='weapon', weapon='shotgun'), seed=44)
piece('weapon_smg', lambda m: (m.box((0, 0, 4), (18, 3, 4), STEEL_DK, wear=0.5, grime=0.3, rust=0.05), m.cylinder((9, 0, 5), 1.0, 8, STEEL_LT, segments=6, axis='X', wear=0.4),
                               m.box((-2, 0, 1.5), (3, 2.5, 5), STEEL_DK, wear=0.5, grime=0.3)), dict(w=18, h=7, pickup='weapon', weapon='smg'), seed=45)
piece('log', lambda m: (m.box((0, 0, 5), (16, 12, 10), STEEL_DK, wear=0.4, grime=0.4, rust=0.05), m.box((0, -6.2, 6), (10, 0.8, 4), hexc(0xffb340), wear=0, grime=0, rust=0, emissive=True),
                        m.box((0, 0, 11), (12, 8, 2), STEEL_LT, wear=0.4, grime=0.3)), dict(w=16, h=12, pickup='log'), seed=46, emissive=(1.0, 0.7, 0.25), strength=3.5)
