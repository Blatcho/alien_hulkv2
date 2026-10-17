"""Pipeline smoke test: 2-bone rigid-skinned arm with 2 clips + a socket.

Run: blender --background --factory-startup --python-exit-code 1 --python tools/blender/spike.py -- --preview tools/out/previews
Output goes to tools/out/spike (never into the game's manifest).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from lib.anim import Clip  # noqa: E402
from lib.common import box, cyl, material, merge, out_dir, part, reset_scene, script_args  # noqa: E402
from lib.export import bounds, export_glb, write_meta  # noqa: E402
from lib.preview import contact_sheet  # noqa: E402
from lib.rig import build_armature, skin, socket  # noqa: E402

args = script_args()
out = out_dir(args, default="tools/out/spike")
reset_scene()

base = material("M_Base")
glow = material("M_Glow", emissive=(1.0, 0.2, 0.1))

arm = build_armature("SpikeRig", [
    ("base", (0, 0, 0), (0, 0, 1), None),
    ("upper", (0, 0, 1), (0, 0, 2), "base"),
])
parts = [
    part("Base", merge(box((0.6, 0.6, 1.0), (0, 0, 0.5), bevel=0.05), cyl(0.35, 0.1, (0, 0, 0.05))), base, "#4a5a35", "base"),
    part("Upper", box((0.4, 0.4, 1.0), (0, 0, 1.5), bevel=0.05, taper=(0.6, 0.6)), base, "#a08040", "upper"),
    part("Eye", box((0.12, 0.05, 0.12), (0, -0.2, 1.8)), glow, "#ff4020", "upper"),
]
body = skin(parts, arm, "SpikeBody")
socket("socket_tip", arm, "upper", (0, -0.25, 2.0))

clips = [
    Clip(arm, "idle", 30).cycle([{"upper": (0, 0, 0)}, {"upper": (-8, 0, 0)}]).done(),
    Clip(arm, "wave", 24).cycle([{"upper": (-60, 0, 0)}, {"upper": (60, 0, 0)}]).done(),
]
export_glb(os.path.join(out, "spike.glb"), [arm])
write_meta(out, "spike", {"clips": clips, "sockets": ["socket_tip"], "bounds": bounds([body])})
if args.get("preview"):
    contact_sheet(arm, clips, os.path.join(out_dir(args, "preview", "tools/out/previews"), "spike.png"),
                  target=(0, 0, 1.0), height=2.6, cols=4, tile=160)
