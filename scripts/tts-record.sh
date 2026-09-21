#!/usr/bin/env bash
# Record or convert a 45–90s news-host sample for local XTTS cloning.
#
# Usage:
#   yarn tts:record
#   yarn tts:record --seconds 90
#   yarn tts:record --from ~/Desktop/voice.m4a
#   yarn tts:record --out everton --from ./take.wav
#   yarn tts:record --from ./take.m4a --polish
#   yarn tts:record --out everton-take2 --seconds 75
#   yarn tts:record --no-dialog --seconds 75 --polish
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOICES="$ROOT/workers/tts/voices"
SCRIPT="$VOICES/script.txt"
SECONDS_N=90
FROM=""
OUT_NAME="everton"
POLISH=0
NO_DIALOG=0

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage ;;
    --seconds) SECONDS_N="${2:-}"; shift 2 ;;
    --from) FROM="${2:-}"; shift 2 ;;
    --out) OUT_NAME="${2:-}"; shift 2 ;;
    --polish) POLISH=1; shift ;;
    --no-dialog) NO_DIALOG=1; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required (brew install ffmpeg)" >&2
  exit 1
fi

mkdir -p "$VOICES"
OUT="$VOICES/${OUT_NAME}.wav"
RAW_TMP="$(mktemp -t tts-record-XXXXXX).wav"
trap 'rm -f "$RAW_TMP"' EXIT

echo "Read this in a news-host voice (even pace, quiet room, same mic):"
echo "----"
cat "$SCRIPT"
echo "----"
echo
echo "Good take checklist:"
echo "  - Quiet room, consistent mic distance"
echo "  - 60–90 seconds, steady news pace (not theatrical)"
echo "  - Clear AI names, numbers, and the ZanshinAI closer"
echo "  - Target: mono 48 kHz 16-bit WAV"
echo "Output: $OUT"
echo

polish_wav() {
  local src="$1"
  local dest="$2"
  # High-pass + loudness normalize only. Do not strip silence aggressively —
  # that can wipe a whole take when the mic level is low.
  ffmpeg -y -i "$src" \
    -af "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11" \
    -ac 1 -ar 48000 -sample_fmt s16 \
    "$dest"
}

convert_to_wav() {
  local src="$1"
  local dest="$2"
  if [[ "$POLISH" -eq 1 ]]; then
    polish_wav "$src" "$dest"
  else
    ffmpeg -y -i "$src" -ac 1 -ar 48000 -sample_fmt s16 "$dest"
  fi
}

if [[ -n "$FROM" ]]; then
  if [[ ! -f "$FROM" ]]; then
    echo "Input file not found: $FROM" >&2
    exit 1
  fi
  convert_to_wav "$FROM" "$OUT"
  echo "Saved $OUT$([ "$POLISH" -eq 1 ] && echo ' (polished)' || true)"
  echo "Keep this file local (gitignored). Set LOCAL_TTS_VOICE=${OUT_NAME} in .env"
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Live capture is macOS-only. Convert an existing take with:" >&2
  echo "  yarn tts:record --from /path/to/recording.m4a --polish" >&2
  exit 1
fi

echo "Listing macOS audio capture devices:"
ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | sed -n '/AVFoundation audio/,/AVFoundation video/p' || true
echo
echo "Recording ${SECONDS_N}s from the default mic."
echo "Override device with TTS_RECORD_DEVICE, e.g. TTS_RECORD_DEVICE=':1' (MacBook Pro Microphone)"
if [[ "$(uname -s)" == "Darwin" && "$NO_DIALOG" -eq 0 ]]; then
  osascript <<EOF || true
display dialog "Voice clone recording (${SECONDS_N}s)

1. Click OK
2. Read workers/tts/voices/script.txt aloud in a news-host voice
3. Stay quiet after you finish until recording ends

Quiet room · steady pace · clear numbers

Script is also on your clipboard." buttons {"OK"} default button "OK" with title "ZanshinAI TTS record"
EOF
fi
echo "Press Ctrl+C within 3 seconds to abort..."
sleep 3

# Prefer MacBook Pro Microphone over Continuity iPhone mic when present.
DEVICE="${TTS_RECORD_DEVICE:-}"
if [[ -z "$DEVICE" ]]; then
  DEVICE=":1"
  echo "Using MacBook Pro Microphone (:1). Set TTS_RECORD_DEVICE to override."
fi
ffmpeg -y -f avfoundation -i "$DEVICE" -t "$SECONDS_N" -ac 1 -ar 48000 -sample_fmt s16 "$RAW_TMP"

# Reject empty / near-silent captures before polishing.
RAW_DUR="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$RAW_TMP" 2>/dev/null || echo 0)"
RAW_DUR_INT="${RAW_DUR%.*}"
if [[ -z "$RAW_DUR_INT" || "$RAW_DUR_INT" -lt 20 ]]; then
  echo "Recording looks too short (${RAW_DUR}s). Mic may be muted or permission denied." >&2
  echo "Enable Microphone for Terminal (System Settings → Privacy & Security → Microphone), then retry." >&2
  cp -f "$RAW_TMP" "${OUT%.wav}-raw-failed.wav" 2>/dev/null || true
  exit 1
fi

if [[ "$POLISH" -eq 1 ]]; then
  cp -f "$RAW_TMP" "${OUT%.wav}-raw.wav"
  polish_wav "$RAW_TMP" "$OUT"
  echo "Saved $OUT (polished) and ${OUT%.wav}-raw.wav"
else
  mv "$RAW_TMP" "$OUT"
  trap - EXIT
  echo "Saved $OUT"
fi
echo "Tip: capture 2–3 takes with --out everton-take2 / everton-take3, then copy the best to everton.wav"
echo "Keep this file local (gitignored). Set LOCAL_TTS_VOICE=${OUT_NAME} in .env"
