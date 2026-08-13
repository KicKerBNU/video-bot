#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WAN_DIR="$ROOT/workers/wan"
VENV="$WAN_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-}"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3.12 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3.12)"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
  else
    echo "Python 3.12+ is required. Install with: brew install python@3.12" >&2
    exit 1
  fi
fi

echo "Using Python: $PYTHON_BIN"
"$PYTHON_BIN" -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"

python -m pip install --upgrade pip
python -m pip install -r "$WAN_DIR/requirements.txt"

MODEL_ID="${WAN_MODEL_ID:-Wan-AI/Wan2.1-T2V-1.3B-Diffusers}"
echo "Prefetching model weights: $MODEL_ID"
python - <<PY
from huggingface_hub import snapshot_download
snapshot_download("${MODEL_ID}")
print("Model download complete")
PY

echo
echo "Wan worker ready."
echo "Start it with: yarn wan:serve"
echo "Then set IMAGE_PROVIDER=wan in .env"
