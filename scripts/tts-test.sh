#!/usr/bin/env bash
# A/B Edge TTS vs local XTTS clone on a news-style script.
#
# Usage:
#   yarn tts:test
#   yarn tts:test --render   # POST /pipeline/run only if SKIP_PUBLISH=true
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/output/tts-tests"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
RENDER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --render) RENDER=1; shift ;;
    --help|-h)
      sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SCRIPT='DeepSeek launched V4.1 Flash with pricing that undercuts OpenAI, Anthropic, Gemini, and Meta. Off-peak, Flash costs about fifteen cents per million input tokens. That is all for today'\''s news on ZanshinAI.'
SCRIPT_WORDS="$(python3 -c "import re,sys; print(len([p for p in re.sub(r'\\s+', ' ', sys.argv[1]).strip().split(' ') if p]))" "$SCRIPT")"

check_words() {
  local json_path="$1"
  python3 - "$json_path" "$SCRIPT_WORDS" <<'PY'
import json, sys
path, expected = sys.argv[1], int(sys.argv[2])
data = json.load(open(path))
words = data.get("words") or []
duration = int(data.get("durationMs") or 0)
starts = [int(w.get("startMs") or 0) for w in words]
monotonic = all(starts[i] >= starts[i - 1] for i in range(1, len(starts)))
last_end = int(words[-1]["endMs"]) if words else 0
drift = abs(len(words) - expected)
print(f"  words={len(words)} expected={expected} drift={drift}")
print(f"  durationMs={duration} lastEndMs={last_end} monotonic={monotonic}")
if not words:
    raise SystemExit("no word timestamps")
if not monotonic:
    raise SystemExit("word startMs is not monotonic")
if duration and last_end and abs(last_end - duration) > max(1500, duration * 0.2):
    raise SystemExit("last word endMs does not cover duration")
if drift > max(8, expected // 5):
    raise SystemExit(f"word count drifted too far from script ({drift})")
print("  timestamps OK")
PY
}

echo "== Edge TTS =="
EDGE_AUDIO="$OUT_DIR/edge-$STAMP.mp3"
EDGE_JSON="$OUT_DIR/edge-$STAMP.json"
node --input-type=module - "$SCRIPT" "$EDGE_AUDIO" "$EDGE_JSON" <<'JS'
import { writeFile } from 'fs/promises';
import { EdgeTTS } from 'edge-tts-universal';

const [text, audioPath, jsonPath] = process.argv.slice(2);
const tts = new EdgeTTS(text, process.env.EDGE_TTS_VOICE || 'en-US-GuyNeural');
const result = await tts.synthesize();
const audio = Buffer.from(await result.audio.arrayBuffer());
await writeFile(audioPath, audio);

const cues = result.subtitle ?? [];
const words = [];
for (const cue of cues) {
  const parts = String(cue.text || '')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) continue;
  const startMs = Math.round(cue.offset / 10_000);
  const endMs = Math.max(startMs + 40, Math.round((cue.offset + cue.duration) / 10_000));
  const slice = Math.max(40, (endMs - startMs) / parts.length);
  parts.forEach((part, index) => {
    const partStart = Math.round(startMs + index * slice);
    words.push({ word: part, startMs: partStart, endMs: Math.round(partStart + slice) });
  });
}
const durationMs = words.length ? words[words.length - 1].endMs : 1000;
await writeFile(jsonPath, JSON.stringify({ durationMs, words }, null, 2));
console.log(`  wrote ${audioPath}`);
JS
check_words "$EDGE_JSON"

echo
echo "== Local XTTS clone =="
if ! curl -sf --max-time 2 "http://127.0.0.1:7861/health" >/dev/null; then
  echo "  worker down. Start with: yarn tts:serve"
  echo "  Skipping clone sample."
else
  HEALTH="$(curl -sf --max-time 2 http://127.0.0.1:7861/health)"
  echo "  health: $HEALTH"
  VOICE_NAME="everton"
  if [[ -f "$ROOT/workers/tts/voices/everton.wav" ]]; then
    VOICE_NAME="everton"
  else
    echo "  No everton.wav — cloning the Edge sample as workers/tts/voices/dev-check.wav (wiring test only)"
    ffmpeg -y -i "$EDGE_AUDIO" -ac 1 -ar 48000 -sample_fmt s16 "$ROOT/workers/tts/voices/dev-check.wav" >/dev/null 2>&1
    VOICE_NAME="dev-check"
  fi
  LOCAL_JSON="$OUT_DIR/local-$STAMP.json"
  LOCAL_AUDIO="$OUT_DIR/local-$STAMP.mp3"
  python3 - "$SCRIPT" "$LOCAL_JSON" "$LOCAL_AUDIO" "$VOICE_NAME" <<'PY'
import base64, json, sys, urllib.request
text, json_path, audio_path, voice = sys.argv[1:5]
payload = json.dumps({"text": text, "language": "en", "speaker_wav": voice}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:7861/synthesize",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=600) as resp:
    data = json.loads(resp.read().decode())
if not data.get("ok", True):
    raise SystemExit(data)
audio = base64.b64decode(data["audio_base64"])
open(audio_path, "wb").write(audio)
open(json_path, "w").write(json.dumps({
    "durationMs": data.get("durationMs"),
    "words": data.get("words") or [],
    "voice": data.get("voice"),
    "device": data.get("device"),
}, indent=2))
print(f"  wrote {audio_path} voice={voice}")
PY
  check_words "$LOCAL_JSON"
fi

echo
echo "Listen to the samples in $OUT_DIR"
echo "A full video render is SKIP_PUBLISH=true then POST /pipeline/run"

if [[ "$RENDER" -eq 1 ]]; then
  SKIP_PUBLISH="$(grep -E '^SKIP_PUBLISH=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  if [[ "$SKIP_PUBLISH" != "true" ]]; then
    echo "--render refused: set SKIP_PUBLISH=true in .env so this does not post" >&2
    exit 1
  fi
  if ! curl -sf --max-time 2 http://localhost:3000/health >/dev/null; then
    echo "Nest is not running on :3000; start the app before --render" >&2
    exit 1
  fi
  echo
  echo "== SKIP_PUBLISH pipeline/run =="
  curl -sS -X POST http://localhost:3000/pipeline/run
  echo
fi
