#!/usr/bin/env sh
# Regenerate every av-golden fixture from the ORIGINAL Python apps.
# Override the interpreters / app locations with env vars if they moved:
#   SPRITE_PY, AUDIO_PY, SPRITE_APP_BACKEND, SFX_APP_BACKEND, AV_GOLDEN_TMP
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
SPRITE_PY=${SPRITE_PY:-"D:/Share/0_DEV/Tooling/Active/video-sprite-extractor/backend/.venv/Scripts/python.exe"}
AUDIO_PY=${AUDIO_PY:-"D:/Share/0_DEV/Tooling/Active/stable-audio-sfx-manager/backend/.venv/Scripts/python.exe"}

rm -f "$HERE/../manifest.json"
"$SPRITE_PY" -B "$HERE/make_inputs.py"
"$SPRITE_PY" -B "$HERE/sprite_cases.py"
"$AUDIO_PY" -B "$HERE/audio_cases.py"
