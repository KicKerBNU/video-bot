#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
USER_NAME="$(whoami)"
UID_NUM="$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$ROOT/logs/macos"

mkdir -p "$AGENTS_DIR" "$LOG_DIR"
chmod +x "$ROOT/scripts/macos/run-wan.sh" "$ROOT/scripts/macos/run-tts.sh" "$ROOT/scripts/macos/run-video-gen.sh"

# Stop ad-hoc servers so LaunchAgents own the ports.
pkill -f "workers/wan/server.py" 2>/dev/null || true
pkill -f "workers/tts/server.py" 2>/dev/null || true
pkill -f "nest start" 2>/dev/null || true
pkill -f "node dist/main" 2>/dev/null || true
sleep 1

install_plist() {
  local src="$1"
  local label="$2"
  local dest="$AGENTS_DIR/${label}.plist"

  sed \
    -e "s|__ROOT__|${ROOT}|g" \
    -e "s|__USER__|${USER_NAME}|g" \
    "$src" > "$dest"

  launchctl bootout "gui/${UID_NUM}/${label}" 2>/dev/null || true
  launchctl bootstrap "gui/${UID_NUM}" "$dest"
  launchctl enable "gui/${UID_NUM}/${label}"
  launchctl kickstart -k "gui/${UID_NUM}/${label}"
  echo "Installed and started: $label"
}

install_plist "$ROOT/scripts/macos/com.zanshinai.video-gen.wan.plist" "com.zanshinai.video-gen.wan"
sleep 2
install_plist "$ROOT/scripts/macos/com.zanshinai.video-gen.tts.plist" "com.zanshinai.video-gen.tts"
sleep 1
install_plist "$ROOT/scripts/macos/com.zanshinai.video-gen.app.plist" "com.zanshinai.video-gen.app"

echo
echo "Services installed."
echo "  Wan logs:  $LOG_DIR/wan.stderr.log"
echo "  TTS logs:  $LOG_DIR/tts.stderr.log"
echo "  App logs:  $LOG_DIR/app.stderr.log"
echo "  Schedule:  CRON_SCHEDULE from .env (default 1 8 * * * UTC)"
echo
echo "Status:"
launchctl print "gui/${UID_NUM}/com.zanshinai.video-gen.wan" 2>/dev/null | sed -n '1,12p' || true
launchctl print "gui/${UID_NUM}/com.zanshinai.video-gen.tts" 2>/dev/null | sed -n '1,12p' || true
launchctl print "gui/${UID_NUM}/com.zanshinai.video-gen.app" 2>/dev/null | sed -n '1,12p' || true
