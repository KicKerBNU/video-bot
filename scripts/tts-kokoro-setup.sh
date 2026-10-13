#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TTS_DIR="$ROOT/workers/tts"
VENV="$TTS_DIR/.venv"
MODEL_DIR="$TTS_DIR/models/kokoro"
ONNX_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

if [[ ! -x "$VENV/bin/pip" ]]; then
  echo "TTS venv missing. Run: yarn tts:setup" >&2
  exit 1
fi

mkdir -p "$MODEL_DIR"
"$VENV/bin/pip" install -q 'kokoro-onnx>=0.6.1' soundfile

if [[ ! -f "$MODEL_DIR/kokoro-v1.0.onnx" ]]; then
  echo "Downloading kokoro-v1.0.onnx (~310MB)…"
  curl -L --fail -o "$MODEL_DIR/kokoro-v1.0.onnx" "$ONNX_URL"
fi
if [[ ! -f "$MODEL_DIR/voices-v1.0.bin" ]]; then
  echo "Downloading voices-v1.0.bin…"
  curl -L --fail -o "$MODEL_DIR/voices-v1.0.bin" "$VOICES_URL"
fi

"$VENV/bin/python" - <<PY
from pathlib import Path
from kokoro_onnx import Kokoro
model = Path("$MODEL_DIR")
k = Kokoro(str(model / "kokoro-v1.0.onnx"), str(model / "voices-v1.0.bin"))
print(f"Kokoro ready — {len(k.voices)} voices (default am_michael)")
PY

echo
echo "Kokoro models in $MODEL_DIR"
echo "Restart TTS worker: launchctl kickstart -k gui/\$(id -u)/com.zanshinai.video-gen.tts"
