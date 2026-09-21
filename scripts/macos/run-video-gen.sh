#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Prefer the Node that built native modules (nvm Node 22), not /usr/local Node 18.
export PATH="$HOME/.nvm/versions/node/v22.13.1/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"
# Nest loads `.env` via ConfigModule — do not bash-source it.

LOG_DIR="$ROOT/logs/macos"
mkdir -p "$LOG_DIR"

NODE_BIN="${VIDEO_GEN_NODE_BIN:-$HOME/.nvm/versions/node/v22.13.1/bin/node}"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "node not found. Install Node 22 or set VIDEO_GEN_NODE_BIN." >&2
  exit 1
fi
echo "Using node: $NODE_BIN ($("$NODE_BIN" -v))"

# Wait for local Wan worker (image generation).
echo "Waiting for Wan on http://127.0.0.1:7860/health ..."
for _ in $(seq 1 120); do
  if curl -sf --max-time 2 "http://127.0.0.1:7860/health" >/dev/null 2>&1; then
    echo "Wan is ready"
    break
  fi
  sleep 2
done

if ! curl -sf --max-time 2 "http://127.0.0.1:7860/health" >/dev/null 2>&1; then
  echo "Wan did not become ready in time" >&2
  exit 1
fi

TTS_PROVIDER="$(grep -E '^TTS_PROVIDER=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
if [[ "${TTS_PROVIDER}" == "local" ]]; then
  echo "Waiting for local TTS on http://127.0.0.1:7861/health ..."
  for _ in $(seq 1 30); do
    if curl -sf --max-time 2 "http://127.0.0.1:7861/health" >/dev/null 2>&1; then
      echo "TTS is ready"
      break
    fi
    sleep 2
  done
  if ! curl -sf --max-time 2 "http://127.0.0.1:7861/health" >/dev/null 2>&1; then
    echo "TTS worker not ready; Nest will fall back to Edge" >&2
  fi
fi

# Build if dist is missing or older than src.
if [[ ! -f "$ROOT/dist/main.js" ]] || [[ "$ROOT/src" -nt "$ROOT/dist/main.js" ]]; then
  echo "Building Nest app..."
  yarn build
fi

exec "$NODE_BIN" "$ROOT/dist/main.js"
