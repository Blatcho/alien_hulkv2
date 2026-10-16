#!/usr/bin/env bash
# Builds every GLB in assets/models from the Blender scripts in tools/blender.
# Needs either the `bpy` module in the current python (pip install bpy) or a `blender` binary.
#   BLENDER=/path/to/blender tools/build-models.sh      # use a Blender binary
#   PYTHON=.venv/bin/python tools/build-models.sh        # use a python with bpy
set -euo pipefail
cd "$(dirname "$0")/.."
run() {
  if [ -n "${BLENDER:-}" ]; then "$BLENDER" --background --python "$1" -- "${@:2}"
  elif "${PYTHON:-python3}" -c "import bpy" 2>/dev/null; then "${PYTHON:-python3}" "$1" "${@:2}"
  elif command -v blender >/dev/null; then blender --background --python "$1" -- "${@:2}"
  else echo "need bpy (pip install bpy) or a blender binary (BLENDER=...)" >&2; exit 1; fi
}
for s in marine alien survivor kestrel; do run tools/blender/$s.py assets/models/$s.glb 2>&1 | grep -E "^wrote|Error|Traceback" || true; done
run tools/blender/tiles.py assets/models 2>&1 | grep -E "^wrote|Error|Traceback" || true
run tools/blender/props.py assets/models 2>&1 | grep -E "^wrote|Error|Traceback" || true
node tools/check-glb.mjs assets/models/*.glb
