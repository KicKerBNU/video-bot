#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"
export COQUI_TOS_AGREED=1

# Kokoro Edge-fallback voice (from .env; defaults match server.py)
if [[ -f "$ROOT/.env" ]]; then
  while IFS= read -r line; do
    case "$line" in
      KOKORO_VOICE=*|KOKORO_SPEED=*|KOKORO_LANG=*)
        key="${line%%=*}"
        val="${line#*=}"
        val="${val%\"}"
        val="${val#\"}"
        val="${val%\'}"
        val="${val#\'}"
        export "$key=$val"
        ;;
    esac
  done < "$ROOT/.env"
fi
export KOKORO_VOICE="${KOKORO_VOICE:-am_michael}"
export KOKORO_SPEED="${KOKORO_SPEED:-1.0}"

LOG_DIR="$ROOT/logs/macos"
mkdir -p "$LOG_DIR"

VENV_PY="$ROOT/workers/tts/.venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "TTS venv missing. Run: yarn tts:setup" >&2
  exit 1
fi

if curl -sf --max-time 1 "http://127.0.0.1:7861/health" >/dev/null 2>&1; then
  echo "TTS already healthy on :7861"
fi

# Lazy-load models on first synthesize so Wan can keep unified memory.
exec "$VENV_PY" "$ROOT/workers/tts/server.py" --host 127.0.0.1 --port 7861
