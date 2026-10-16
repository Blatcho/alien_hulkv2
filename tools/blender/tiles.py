"""The ship tile kit: every piece the world builder instances per tile. One GLB per piece, all 32 px
tiles with their origin at the tile's bottom-left front corner (x right, z up, y into the screen).
    blender --background --python tools/blender/tiles.py -- assets/models/
(the argument is the output directory; it defaults to assets/models)."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PartMesh, export, reset, hexc, MODELS  # noqa: E402

T = 32
OUT = MODELS
if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 1:
    OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)

STEEL = hexc(0x4a5058)
STEEL_DK = hexc(0x2f343a)
STEEL_LT = hexc(0x6b737c)
DECK = hexc(0x3c4248)
GRATE = hexc(0x262a2f)
RUST = hexc(0x6b4a2a)
PIPE = hexc(0x5a5f55)
PIPE_RED = hexc(0x7a2e26)
WARN = hexc(0xb59a2a)
GLASS = hexc(0xbfe8ff)
RUNG = hexc(0x8a8f96)
VENT = hexc(0x1c1f23)


def piece(name, build, meta_extra=None, seed=1):
    reset()
    m = PartMesh(name, seed=seed)
    build(m)
    m.build(None, emissive_color=(0.85, 0.95, 1.0), emissive_strength=3.0)
    export(os.path.join(OUT, name + '.glb'), dict(name=name, tile=T, origin='bottom-left', **(meta_extra or {})))


# floor plate: deck plating with a grating strip and a lip
def floor(m):
    m.box((16, 0, 16), (32, 34, 32), STEEL_DK, wear=0.6, grime=0.7, rust=0.14, scratch=0.1)
    m.box((16, -17.4, 29.5), (32, 1.2, 5), STEEL_LT, wear=0.8, grime=0.4, rust=0.1)       # deck lip (front)
    m.box((16, -17.6, 16), (28, 0.8, 18), hexc(0x2a2e33), wear=0.3, grime=0.8, rust=0.2)   # recessed front panel
    for x in (4, 28):
        m.cylinder((x, -17.8, 16), 1.0, 1.0, STEEL_LT, segments=6, axis='Y', wear=0.5, grime=0.3)
    m.box((16, -12, 32.2), (30, 10, 0.6), GRATE, wear=0.3, grime=0.6, rust=0.1)           # grating on top
piece('tile_floor', floor, seed=3)


def floor_hazard(m):
    floor(m)
    for k in range(4):
        m.box((4 + k * 8, -17.8, 29.5), (4, 0.6, 4), WARN, wear=0.9, grime=0.6, rust=0.2)
piece('tile_floor_hazard', floor_hazard, seed=4)


# wall panels (the back wall of a room, seen face-on): riveted plate, piped, and a conduit variant
def wall(m):
    m.box((16, 10, 16), (32, 6, 32), STEEL, wear=0.5, grime=0.6, rust=0.1, scratch=0.08)
    m.box((16, 6.5, 16), (26, 1.2, 26), STEEL_DK, wear=0.3, grime=0.7, rust=0.12)
    for x, z in ((3, 3), (29, 3), (3, 29), (29, 29)):
        m.cylinder((x, 6.4, z), 1.0, 1.0, STEEL_LT, segments=6, axis='Y', wear=0.5, grime=0.3)
piece('tile_wall', wall, seed=5)


def wall_pipes(m):
    wall(m)
    m.cylinder((16, 5, 22), 2.2, 32, PIPE, segments=8, axis='X', wear=0.5, grime=0.6, rust=0.15)
    m.cylinder((16, 5, 11), 1.4, 32, PIPE_RED, segments=6, axis='X', wear=0.5, grime=0.5, rust=0.2)
    m.box((10, 5, 22), (3, 5, 5), STEEL_DK, wear=0.4, grime=0.5, rust=0.15)
piece('tile_wall_pipes', wall_pipes, seed=6)


def wall_conduit(m):
    wall(m)
    for k in range(3):
        m.box((16, 5.5, 6 + k * 10), (28, 1.6, 2), STEEL_DK, wear=0.3, grime=0.6, rust=0.12)
    m.box((25, 5.2, 16), (6, 1.4, 10), STEEL_LT, wear=0.4, grime=0.4, rust=0.1)
piece('tile_wall_conduit', wall_conduit, seed=7)


def wall_screen(m):
    wall(m)
    m.box((16, 5.6, 18), (20, 1.4, 12), STEEL_DK, wear=0.2, grime=0.4)
    m.box((16, 4.8, 18), (16, 0.8, 9), hexc(0x66d9a0), wear=0, grime=0, rust=0, emissive=True)
piece('tile_wall_screen', wall_screen, seed=8)


# bulkhead: the solid column between rooms (seen edge-on, heavier plating)
def bulkhead(m):
    m.box((16, 0, 16), (32, 34, 32), STEEL_DK, wear=0.5, grime=0.6, rust=0.12)
    m.box((16, -14, 16), (28, 6, 28), STEEL, wear=0.6, grime=0.5, rust=0.1)
    m.box((16, -17.5, 16), (6, 1.2, 30), STEEL_LT, wear=0.4, grime=0.4, rust=0.1)
piece('tile_bulkhead', bulkhead, seed=9)


# hull: the outer skin, battered
def hull(m):
    m.box((16, 0, 16), (32, 34, 32), hexc(0x3a3d44), wear=0.6, grime=0.7, rust=0.2, scratch=0.12)
    m.box((16, -16, 16), (30, 2, 30), hexc(0x2b2e34), wear=0.5, grime=0.7, rust=0.25)
piece('tile_hull', hull, seed=10)


# door: frame plus one sliding leaf (the leaf is a separate piece so it can move)
def door_frame(m):
    m.box((16, 10, 48), (32, 8, 96), STEEL_DK, wear=0.5, grime=0.6, rust=0.12)
    m.box((16, 5, 94), (32, 6, 4), STEEL_LT, wear=0.4, grime=0.4)
    m.box((3, 5, 48), (6, 6, 96), STEEL_LT, wear=0.4, grime=0.5, rust=0.1)
    m.box((29, 5, 48), (6, 6, 96), STEEL_LT, wear=0.4, grime=0.5, rust=0.1)
    m.box((16, 2, 90), (10, 2, 3), hexc(0xff5a3a), wear=0, grime=0, rust=0, emissive=True)      # status lamp
piece('door_frame', door_frame, dict(height=96), seed=11)


def door_leaf(m):
    m.box((16, 0, 44), (24, 6, 88), STEEL, wear=0.6, grime=0.5, rust=0.1, scratch=0.1)
    m.box((16, -3.5, 44), (20, 1.2, 80), STEEL_DK, wear=0.3, grime=0.6, rust=0.12)
    for k in range(3):
        m.box((16, -4.2, 20 + k * 24), (18, 0.8, 2), STEEL_LT, wear=0.3, grime=0.3)
    m.box((16, -4.4, 60), (8, 1, 8), WARN, wear=0.8, grime=0.5, rust=0.2)
piece('door_leaf', door_leaf, dict(height=88), seed=12)


# ladder: one tile of rails and two rungs (repeats vertically)
def ladder(m):
    for x in (6, 26):
        m.box((x, 2, 16), (3, 3, 32), STEEL_DK, wear=0.5, grime=0.5, rust=0.12)
    for z in (8, 24):
        m.cylinder((16, 2, z), 1.4, 22, RUNG, segments=6, axis='X', wear=0.9, grime=0.3, rust=0.1)
piece('ladder', ladder, seed=13)


# hatch: the trapdoor over a ladder shaft
def hatch(m):
    m.box((16, 0, 28), (30, 30, 3), STEEL, wear=0.6, grime=0.6, rust=0.12)
    m.box((16, 0, 29.8), (10, 10, 1), STEEL_LT, wear=0.4, grime=0.4)
    m.box((16, -14, 28), (30, 2, 2.5), WARN, wear=0.9, grime=0.5, rust=0.2)
piece('hatch', hatch, seed=14)


# stair: a diagonal tile rising to the right (the world mirrors it for the other direction)
def stair(m):
    for k in range(4):
        x0 = k * 8
        m.box((x0 + 4, 0, 4 + k * 8 - 0.5), (8, 30, 8 + k * 8 + 1), STEEL_DK, wear=0.5, grime=0.6, rust=0.12)
        m.box((x0 + 4, 0, 8 + k * 8 + 0.3), (8, 30, 1.2), STEEL_LT, wear=0.8, grime=0.4, rust=0.08)
piece('stair', stair, dict(rise='right'), seed=15)


# vent grille in a ceiling tile
def vent(m):
    m.box((16, 0, 16), (32, 34, 32), DECK, wear=0.7, grime=0.7, rust=0.12)
    m.box((16, -14, 6), (26, 8, 10), VENT, wear=0.2, grime=0.6)
    for k in range(5):
        m.box((5 + k * 5.5, -17, 6), (3, 1.2, 9), STEEL_LT, wear=0.5, grime=0.5, rust=0.1)
piece('vent', vent, seed=16)


# ceiling lamp: a hanging fixture with an emissive tube
def lamp(m):
    m.box((16, 0, 30), (18, 8, 3), STEEL_DK, wear=0.4, grime=0.5, rust=0.1)
    m.box((16, 0, 27.5), (14, 6, 2), GLASS, wear=0, grime=0, rust=0, emissive=True)
piece('lamp', lamp, seed=17)


def lamp_red(m):
    m.box((16, 0, 30), (12, 8, 4), STEEL_DK, wear=0.4, grime=0.5, rust=0.1)
    m.cylinder((16, 0, 27), 3.5, 3, hexc(0xff3b2a), segments=8, axis='Z', wear=0, grime=0, rust=0, emissive=True)
piece('lamp_red', lamp_red, seed=18)


# airlock ring: the hull opening where the dropship docks (3 tiles tall)
def airlock(m):
    m.box((16, 0, 48), (32, 34, 96), STEEL_DK, wear=0.5, grime=0.6, rust=0.15)
    m.box((16, -14, 48), (28, 8, 84), STEEL_LT, wear=0.5, grime=0.5, rust=0.1)
    m.box((16, -18.5, 48), (10, 2, 84), WARN, wear=0.9, grime=0.5, rust=0.2)
    m.box((16, -19, 92), (12, 2, 3), hexc(0x66ff88), wear=0, grime=0, rust=0, emissive=True)
piece('airlock', airlock, dict(height=96), seed=19)
