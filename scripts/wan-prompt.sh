#!/usr/bin/env bash
# Try prompts against the local Wan image worker and save PNGs.
#
# Usage:
#   yarn wan:prompt "Wall Street golden hour street canyon"
#   yarn wan:prompt --seed 42 --steps 30 "people using smartphones at night"
#   yarn wan:prompt --out /tmp/test.png "news studio desk"
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${WAN_API_URL:-http://127.0.0.1:7860}"
WIDTH="${WAN_IMAGE_WIDTH:-480}"
HEIGHT="${WAN_IMAGE_HEIGHT:-832}"
STEPS="${WAN_STEPS:-20}"
GUIDANCE="${WAN_GUIDANCE_SCALE:-5}"
SEED=""
OUT=""
NEGATIVE=""
PROMPT=""

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --seed) SEED="${2:-}"; shift 2 ;;
    --steps) STEPS="${2:-}"; shift 2 ;;
    --width) WIDTH="${2:-}"; shift 2 ;;
    --height) HEIGHT="${2:-}"; shift 2 ;;
    --guidance) GUIDANCE="${2:-}"; shift 2 ;;
    --negative) NEGATIVE="${2:-}"; shift 2 ;;
    --) shift; PROMPT="$*"; break ;;
    -*)
      echo "Unknown flag: $1" >&2
      usage
      ;;
    *)
      if [[ -n "$PROMPT" ]]; then
        PROMPT="$PROMPT $1"
      else
        PROMPT="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "Missing prompt." >&2
  usage
fi

if ! curl -sf "$API_URL/health" >/dev/null; then
  echo "Wan worker not reachable at $API_URL" >&2
  echo "Start it with: yarn wan:serve   (or yarn service:status)" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT/output/wan-tests"
mkdir -p "$OUT_DIR"
if [[ -z "$OUT" ]]; then
  OUT="$OUT_DIR/test-$STAMP.png"
fi

TMP_JSON="$(mktemp)"
TMP_RESP="$(mktemp)"
cleanup() { rm -f "$TMP_JSON" "$TMP_RESP"; }
trap cleanup EXIT

# Build JSON safely with Python (handles quotes in prompts).
python3 - "$PROMPT" "$WIDTH" "$HEIGHT" "$STEPS" "$GUIDANCE" "$SEED" "$NEGATIVE" <<'PY' >"$TMP_JSON"
import json, sys
prompt, width, height, steps, guidance, seed, negative = sys.argv[1:8]
payload = {
    "prompt": prompt,
    "width": int(width),
    "height": int(height),
    "steps": int(steps),
    "guidance_scale": float(guidance),
}
if seed.strip():
    payload["seed"] = int(seed)
if negative.strip():
    payload["negative_prompt"] = negative
json.dump(payload, sys.stdout)
PY

echo "→ POST $API_URL/generate"
echo "  prompt: $PROMPT"
echo "  ${WIDTH}x${HEIGHT} steps=$STEPS guidance=$GUIDANCE${SEED:+ seed=$SEED}"

HTTP_CODE="$(
  curl -sS -o "$TMP_RESP" -w "%{http_code}" \
    -X POST "$API_URL/generate" \
    -H "Content-Type: application/json" \
    --data @"$TMP_JSON" \
    --max-time "${WAN_TIMEOUT_SEC:-600}"
)"

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Wan failed HTTP $HTTP_CODE:" >&2
  head -c 800 "$TMP_RESP" >&2 || true
  echo >&2
  exit 1
fi

python3 - "$TMP_RESP" "$OUT" <<'PY'
import base64, json, sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
raw = payload.get("image_base64")
if not raw:
    raise SystemExit("Response missing image_base64")
Path(sys.argv[2]).write_bytes(base64.b64decode(raw))
print(f"saved {sys.argv[2]} ({payload.get('width')}x{payload.get('height')})")
PY

# Open on macOS when available.
if command -v open >/dev/null 2>&1; then
  open "$OUT"
fi
