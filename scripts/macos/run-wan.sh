#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"
# Do not `source .env` here — cron values like `1 8 * * *` break bash.
# Wan uses its own defaults; Nest loads .env via ConfigModule.

LOG_DIR="$ROOT/logs/macos"
mkdir -p "$LOG_DIR"

VENV_PY="$ROOT/workers/wan/.venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "Wan venv missing. Run: yarn wan:setup" >&2
  exit 1
fi

# Free the port if a stale process is holding it.
if curl -sf --max-time 1 "http://127.0.0.1:7860/health" >/dev/null 2>&1; then
  echo "Wan already healthy on :7860"
fi

exec "$VENV_PY" "$ROOT/workers/wan/server.py" --host 127.0.0.1 --port 7860 --preload
