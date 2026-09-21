#!/usr/bin/env bash
# Resumable voice-pack recorder: 40 short news-host takes for XTTS multi-ref.
#
# Usage:
#   yarn tts:record-pack              # open Terminal.app and start/resume
#   yarn tts:record-pack --here       # run in current shell (needs mic TCC)
#   yarn tts:record-pack --status     # show which takes exist / pass QA
#   yarn tts:record-pack --only 07    # re-record a single id
#   yarn tts:record-pack --force      # re-record even if approved
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$ROOT/workers/tts/voices/scripts"
PACK_DIR="$ROOT/workers/tts/voices/everton/pack"
MANIFEST="$SCRIPTS_DIR/manifest.json"
DEVICE="${TTS_RECORD_DEVICE:-:1}"
HERE=0
STATUS=0
FORCE=0
ONLY=""

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage ;;
    --here) HERE=1; shift ;;
    --status) STATUS=1; shift ;;
    --force) FORCE=1; shift ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

if [[ ! -f "$MANIFEST" ]]; then
  echo "Missing $MANIFEST — run: yarn tts:scripts" >&2
  exit 1
fi

mkdir -p "$PACK_DIR"

mean_volume() {
  local wav="$1"
  ffmpeg -i "$wav" -af volumedetect -f null - 2>&1 \
    | awk -F': ' '/mean_volume/{gsub(/ dB/,"",$2); print $2; exit}'
}

duration_sec() {
  ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$1" 2>/dev/null || echo 0
}

take_ok() {
  local wav="$1"
  local min_sec="${2:-12}"
  [[ -f "$wav" ]] || return 1
  local dur vol
  dur="$(duration_sec "$wav")"
  local dur_int="${dur%.*}"
  [[ -n "$dur_int" && "$dur_int" -ge "$min_sec" ]] || return 1
  vol="$(mean_volume "$wav")"
  python3 -c "import sys; v=float(sys.argv[1] or -99); sys.exit(0 if v > -45 else 1)" "$vol" 2>/dev/null || return 1
  return 0
}

show_status() {
  local total=0 ok=0 missing=0 bad=0
  while IFS= read -r id; do
    total=$((total + 1))
    local wav="$PACK_DIR/${id}.wav"
    if take_ok "$wav" 12; then
      ok=$((ok + 1))
      printf "  %s  OK   %ss  %s dB\n" "$id" "$(duration_sec "$wav")" "$(mean_volume "$wav")"
    elif [[ -f "$wav" ]]; then
      bad=$((bad + 1))
      printf "  %s  BAD  %ss  (re-record)\n" "$id" "$(duration_sec "$wav")"
    else
      missing=$((missing + 1))
      printf "  %s  --\n" "$id"
    fi
  done < <(python3 -c "import json;print('\\n'.join(s['id'] for s in json.load(open('$MANIFEST'))['scripts']))")
  echo
  echo "Pack: $ok/$total approved, $bad bad, $missing missing → $PACK_DIR"
}

if [[ "$STATUS" -eq 1 ]]; then
  show_status
  exit 0
fi

if [[ "$HERE" -eq 0 && "$(uname -s)" == "Darwin" && -z "${TTS_RECORD_PACK_INNER:-}" ]]; then
  EXTRA=""
  [[ "$FORCE" -eq 1 ]] && EXTRA+=" --force"
  [[ -n "$ONLY" ]] && EXTRA+=" --only $ONLY"
  INNER_CMD="export TTS_RECORD_PACK_INNER=1 TTS_RECORD_DEVICE='$DEVICE'; cd '$ROOT' && bash scripts/tts-record-pack.sh --here$EXTRA"
  osascript \
    -e 'tell application "Terminal" to activate' \
    -e "tell application \"Terminal\" to do script \"$INNER_CMD\""
  osascript -e 'display notification "Voice pack recording started in Terminal — read each script aloud" with title "ZanshinAI" sound name "Glass"' || true
  echo "Opened Terminal.app for pack recording (mic TCC)."
  echo "Progress: yarn tts:record-pack --status"
  exit 0
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required (brew install ffmpeg)" >&2
  exit 1
fi

polish_wav() {
  ffmpeg -y -i "$1" \
    -af "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11" \
    -ac 1 -ar 48000 -sample_fmt s16 \
    "$2" >/dev/null 2>&1
}

echo "============================================"
echo " ZanshinAI voice pack recorder"
echo " Mic device: $DEVICE  (override TTS_RECORD_DEVICE)"
echo " Output: $PACK_DIR"
echo " Enable Microphone for Terminal if prompted."
echo "============================================"
echo

PROBE="/tmp/tts-pack-probe.wav"
echo "Mic probe (2s) — say 'test'..."
if ! ffmpeg -y -f avfoundation -i "$DEVICE" -t 2 -ac 1 -ar 48000 -sample_fmt s16 "$PROBE" >/tmp/tts-pack-probe.log 2>&1; then
  echo "Mic probe FAILED. Grant Microphone to Terminal, then retry." >&2
  tail -5 /tmp/tts-pack-probe.log >&2 || true
  exit 1
fi
echo "Probe OK ($(duration_sec "$PROBE")s, $(mean_volume "$PROBE") dB)"
echo

COUNT=0
while IFS= read -r row; do
  [[ -z "$row" ]] && continue
  id="$(echo "$row" | awk '{print $1}')"
  seconds="$(echo "$row" | awk '{print $2}')"
  file="$(echo "$row" | awk '{print $3}')"
  out="$PACK_DIR/${id}.wav"
  raw="$PACK_DIR/${id}-raw.wav"
  script_path="$SCRIPTS_DIR/$file"

  if [[ "$FORCE" -eq 0 ]] && take_ok "$out" 12; then
    echo ">>> $id already OK — skip"
    continue
  fi

  COUNT=$((COUNT + 1))
  if [[ $((COUNT % 10)) -eq 1 && "$COUNT" -gt 1 ]]; then
    echo
    echo "--- Short break (20s). Stretch, sip water. ---"
    sleep 20
  fi

  echo
  echo "========================================"
  echo " TAKE $id  (${seconds}s window)"
  echo "========================================"
  cat "$script_path"
  echo "========================================"
  afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || true
  echo "Get ready... recording in 5"
  for n in 5 4 3 2 1; do echo -n " $n"; sleep 1; done
  echo
  afplay /System/Library/Sounds/Tink.aiff 2>/dev/null || true
  echo "RECORDING NOW — read the script aloud"
  RAW_TMP="$(mktemp -t tts-pack-XXXXXX).wav"
  if ! ffmpeg -y -f avfoundation -i "$DEVICE" -t "$seconds" -ac 1 -ar 48000 -sample_fmt s16 "$RAW_TMP" >/tmp/tts-pack-ffmpeg.log 2>&1; then
    echo "ffmpeg capture failed — see /tmp/tts-pack-ffmpeg.log" >&2
    rm -f "$RAW_TMP"
    exit 1
  fi
  cp -f "$RAW_TMP" "$raw"
  polish_wav "$RAW_TMP" "$out"
  rm -f "$RAW_TMP"

  if take_ok "$out" 12; then
    echo ">>> $id SAVED ($(duration_sec "$out")s, $(mean_volume "$out") dB)"
  else
    echo ">>> $id REJECTED (too short or too quiet). Re-run: yarn tts:record-pack --only $id" >&2
  fi
done < <(python3 -c "
import json
m=json.load(open('$MANIFEST'))
only='$ONLY'.strip()
for s in m['scripts']:
    if only and s['id'] != only.zfill(2) and s['id'] != only:
        continue
    print(s['id'], s['recordSeconds'], s['file'])
")

echo
echo "Session pass complete."
show_status
echo
echo "Next: yarn tts:pack-qa"
afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || true
