#!/usr/bin/env bash
# Send an existing video.mp4 via Resend with title + hashtags + captions.
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

while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    RESEND_API_KEY=*|RESEND_FROM_EMAIL=*|RESEND_TO_EMAIL=*|BRAND_NAME=*|NEWS_API_URL=*|NEWS_API_KEY=*)
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
const newsId = process.env.EMAIL_TEST_NEWS_ID || 'digest';
const brand = process.env.BRAND_NAME || 'ZanshinAI';
const to = String(process.env.RESEND_TO_EMAIL || '')
  .split(/[,;\s]+/)
  .map((e) => e.trim())
  .filter((e) => e.includes('@'));
const from =
  process.env.RESEND_FROM_EMAIL || 'ZanshinAI <onboarding@resend.dev>';
const buf = readFileSync(path);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadDigest() {
  const url = process.env.NEWS_API_URL;
  if (!url) return null;
  const headers = { Accept: 'application/json' };
  if (process.env.NEWS_API_KEY) {
    headers.Authorization = `Bearer ${process.env.NEWS_API_KEY}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const payload = await res.json();
  const digest = payload.digest || {};
  const bullets = (digest.bullets || []).filter((b) => b.title && b.summary);
  const title = (digest.headline || bullets[0]?.title || newsId).trim();
  const headlines = bullets.map((b) => b.title.trim());
  const hashtags = ['#AI', '#TechNews', '#AINews'];
  return { title, headlines, hashtags };
}

(async () => {
  const digest = (await loadDigest()) || {
    title: newsId,
    headlines: [newsId],
    hashtags: ['#AI', '#TechNews', '#AINews'],
  };

  const hashtagLine = digest.hashtags.join(' ');
  const twitterCaption = `${digest.title}\n\n${hashtagLine}`;
  const tiktokCaption =
    digest.headlines.length > 1
      ? [
          digest.title,
          '',
          "Also in today’s AI digest:",
          ...digest.headlines.slice(0, 4).map((line) => `• ${line}`),
          '',
          hashtagLine,
        ].join('\n')
      : `${digest.title}\n\n${hashtagLine}`;

  const headlineLis = digest.headlines
    .map((line) => `<li style="margin:0 0 6px;">${escapeHtml(line)}</li>`)
    .join('');

  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.5;color:#111;max-width:600px;margin:0 auto;padding:24px;">
    <p style="letter-spacing:0.12em;text-transform:uppercase;color:#888;font-size:12px;margin:0 0 16px;">${escapeHtml(brand)} daily digest</p>
    <h1 style="font-size:22px;margin:0 0 8px;">${escapeHtml(digest.title)}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#555;"><strong>Hashtags:</strong> ${escapeHtml(hashtagLine)}</p>
    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Headlines</h2>
    <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;color:#333;">${headlineLis}</ul>
    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Copy for X / Twitter</h2>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:10px;padding:14px;margin:0 0 20px;">${escapeHtml(twitterCaption)}</pre>
    <h2 style="font-size:15px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;color:#666;">Copy for TikTok</h2>
    <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;border-radius:10px;padding:14px;margin:0 0 20px;">${escapeHtml(tiktokCaption)}</pre>
    <p style="margin-top:8px;font-size:15px;">Today's vertical video is attached as <strong>video.mp4</strong>.</p>
  </body>
</html>`;

  const text = [
    `${brand} daily digest`,
    '',
    `TITLE: ${digest.title}`,
    `HASHTAGS: ${hashtagLine}`,
    '',
    'HEADLINES:',
    ...digest.headlines.map((line) => `- ${line}`),
    '',
    '--- COPY FOR X / TWITTER ---',
    twitterCaption,
    '',
    '--- COPY FOR TIKTOK ---',
    tiktokCaption,
    '',
    'Video attached: video.mp4',
  ].join('\n');

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `${brand} daily digest — ${digest.title}`.slice(0, 120),
    html,
    text,
    attachments: [{ filename: 'video.mp4', content: buf }],
  });
  if (error) {
    console.error('Resend error:', error);
    process.exit(1);
  }
  console.log('Sent', data?.id, '→', to.join(', '));
  console.log('Title:', digest.title);
  console.log('Hashtags:', hashtagLine);
  console.log('File:', path, `(${Math.round(buf.length / 1024)}KB)`);
})();
NODE
