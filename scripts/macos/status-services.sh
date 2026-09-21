#!/usr/bin/env bash
set -euo pipefail

UID_NUM="$(id -u)"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== LaunchAgents =="
for label in com.zanshinai.video-gen.wan com.zanshinai.video-gen.tts com.zanshinai.video-gen.app; do
  if launchctl print "gui/${UID_NUM}/${label}" >/dev/null 2>&1; then
    state="$(launchctl print "gui/${UID_NUM}/${label}" 2>/dev/null | awk '/state =/{print $3; exit}')"
    echo "$label: loaded (state=$state)"
  else
    echo "$label: not loaded"
  fi
done

echo
echo "== Health =="
curl -sf --max-time 2 http://127.0.0.1:7860/health && echo || echo "Wan: down"
TTS_HEALTH="$(curl -sf --max-time 2 http://127.0.0.1:7861/health || true)"
if [[ -n "$TTS_HEALTH" ]]; then
  echo "TTS: $TTS_HEALTH"
  echo "$TTS_HEALTH" | grep -q '"voice_ready":true' || echo "TTS warning: voice_ready=false — run yarn tts:record-pack"
  if echo "$TTS_HEALTH" | grep -q '"pack_count":0\|"pack_count": 0'; then
    echo "TTS tip: voice pack empty — yarn tts:record-pack then yarn tts:pack-qa"
  fi
else
  echo "TTS: down"
fi
curl -sf --max-time 2 http://127.0.0.1:3000/health && echo || echo "Nest: down"

echo
echo "== Schedule (.env) =="
grep -E '^(CRON_SCHEDULE|CRON_TIMEZONE|SKIP_PUBLISH|SKIP_EMAIL|RESEND_TO_EMAIL|RESEND_FROM_EMAIL|TTS_PROVIDER|LOCAL_TTS_VOICE)=' "$ROOT/.env" || true
# Don't print RESEND_API_KEY
if grep -q '^RESEND_API_KEY=.\+' "$ROOT/.env" 2>/dev/null; then
  echo "RESEND_API_KEY=(set)"
else
  echo "RESEND_API_KEY=(missing)"
fi


echo
echo "== Recent app log =="
tail -n 20 "$ROOT/logs/macos/app.stderr.log" 2>/dev/null || echo "(no app log yet)"
