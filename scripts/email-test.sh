#!/usr/bin/env bash
# Send an existing video.mp4 via Resend (no pipeline regen).
#
# Usage:
#   yarn email:test
#   yarn email:test output/digest-2026-08-17/video.mp4
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.nvm/versions/node/v22.13.1/bin:${PATH}"

VIDEO="${1:-}"
if [[ -z "$VIDEO" ]]; then
  VIDEO="$(ls -1t output/digest-*/video.mp4 2>/dev/null | head -1 || true)"
fi

if [[ -z "$VIDEO" || ! -f "$VIDEO" ]]; then
  echo "No video found. Pass a path: yarn email:test output/digest-YYYY-MM-DD/video.mp4" >&2
  exit 1
fi

# Load only Resend-related keys without sourcing whole .env (cron stars break bash).
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    RESEND_API_KEY=*|RESEND_FROM_EMAIL=*|RESEND_TO_EMAIL=*|BRAND_NAME=*)
      key="${line%%=*}"
      val="${line#*=}"
      val="${val%\"}"
      val="${val#\"}"
      export "$key=$val"
      ;;
  esac
done < .env

if [[ -z "${RESEND_API_KEY:-}" || -z "${RESEND_TO_EMAIL:-}" ]]; then
  echo "Set RESEND_API_KEY and RESEND_TO_EMAIL in .env first." >&2
  exit 1
fi

export EMAIL_TEST_VIDEO="$VIDEO"
export EMAIL_TEST_NEWS_ID
EMAIL_TEST_NEWS_ID="$(basename "$(dirname "$VIDEO")")"

node <<'NODE'
const { readFileSync } = require('fs');
const { Resend } = require('resend');

const path = process.env.EMAIL_TEST_VIDEO;
const to = String(process.env.RESEND_TO_EMAIL || '')
  .split(/[,;\s]+/)
  .map((e) => e.trim())
  .filter((e) => e.includes('@'));
const from =
  process.env.RESEND_FROM_EMAIL || 'ZanshinAI <onboarding@resend.dev>';
const brand = process.env.BRAND_NAME || 'ZanshinAI';
const newsId = process.env.EMAIL_TEST_NEWS_ID || 'digest';
const buf = readFileSync(path);

(async () => {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `${brand} daily digest — ${newsId}`,
    html: `<p>${brand} video for <strong>${newsId}</strong> is attached.</p>`,
    text: `${brand} video attached: ${newsId}`,
    attachments: [{ filename: 'video.mp4', content: buf }],
  });
  if (error) {
    console.error('Resend error:', error);
    process.exit(1);
  }
  console.log('Sent', data?.id, '→', to.join(', '));
  console.log('File:', path, `(${Math.round(buf.length / 1024)}KB)`);
})();
NODE
