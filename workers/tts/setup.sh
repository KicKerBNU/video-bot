#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TTS_DIR="$ROOT/workers/tts"
VENV="$TTS_DIR/.venv"
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
python -m pip install -r "$TTS_DIR/requirements.txt"

# XTTS v2 is CPML-licensed; required to download weights non-interactively.
export COQUI_TOS_AGREED=1

echo "Prefetching XTTS v2 + Whisper base.en (first run downloads several GB)"
python - <<'PY'
from TTS.api import TTS
from faster_whisper import WhisperModel

print("Loading XTTS v2 weights...")
TTS("tts_models/multilingual/multi-dataset/xtts_v2")
print("Loading faster-whisper base.en...")
WhisperModel("base.en", device="cpu", compute_type="int8")
print("Model download complete")
PY

echo
echo "TTS worker ready."
echo "Record a clone sample: yarn tts:record"
echo "Start it with: yarn tts:serve"
echo "Then set TTS_PROVIDER=local in .env (Mac only; keep edge on Railway)"
