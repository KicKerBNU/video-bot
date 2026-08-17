#!/usr/bin/env bash
set -euo pipefail

UID_NUM="$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"

for label in com.zanshinai.video-gen.wan com.zanshinai.video-gen.app; do
  launchctl bootout "gui/${UID_NUM}/${label}" 2>/dev/null || true
  rm -f "$AGENTS_DIR/${label}.plist"
  echo "Removed: $label"
done

echo "macOS background services uninstalled."
