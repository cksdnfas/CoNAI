#!/bin/sh
# Docker build helper: AI worker environment = uv-managed CPython 3.12 venv at $AI_VENV with torch for $TORCH_BACKEND
# (cpu, cu126, cu130, cu132). Same layout as the app's own installer, so both paths run the same versions.
set -eu
: "${AI_VENV:=/opt/conai-ai}"
: "${TORCH_BACKEND:=cpu}"
: "${UV_VERSION:=0.12.18}"
export UV_PYTHON_INSTALL_DIR=/opt/uv-python
export UV_PYTHON_PREFERENCE=only-managed
export UV_NO_CACHE=1
export UV_HTTP_TIMEOUT=120
python3 -m pip install --break-system-packages --no-cache-dir "uv==${UV_VERSION}"
uv python install 3.12
uv venv "$AI_VENV" --python 3.12 --no-project
uv pip install --python "$AI_VENV/bin/python" --torch-backend "$TORCH_BACKEND" \
  torch==2.14.1 torchvision==0.29.1 \
  -r "$(dirname "$0")/requirements-ai.txt"
"$AI_VENV/bin/python" "$(dirname "$0")/ai_runtime_probe.py"
