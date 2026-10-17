"""Stand-in for the `blender` executable when only the bpy module (Blender as a Python package,
`pip install bpy`) is available: runs `--python X.py -- args` the way headless Blender does.

    BLENDER=tools/bpy-blender npm run assets -- marine      (BPY_PYTHON: the Python with bpy)

Previews need EGL (e.g. `apt install libegl1`, then EGL_PLATFORM=surfaceless).
"""
import runpy
import sys
import traceback

argv = sys.argv[1:]
if "--version" in argv:
    import bpy
    print("Blender", bpy.app.version_string, "(bpy module)")
    sys.exit(0)
script = argv[argv.index("--python") + 1]
cut = argv.index("--") if "--" in argv else len(argv)
sys.argv = ["blender", *argv[:cut], *argv[cut:]]   # the scripts read their own args after "--"
import bpy  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    runpy.run_path(script, run_name="__main__")
except SystemExit as e:
    sys.exit(e.code if isinstance(e.code, int) else 0)
except Exception:
    traceback.print_exc()
    sys.exit(1)
