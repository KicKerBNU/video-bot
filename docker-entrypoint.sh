#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
OUTPUT_DIR="${OUTPUT_DIR:-/data/output}"

mkdir -p "$DATA_DIR" "$OUTPUT_DIR"

# Railway volumes are often root-owned on first mount.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" "$OUTPUT_DIR" 2>/dev/null || true
  exec su -s /bin/sh node -c "node dist/main.js"
fi

exec node dist/main.js
