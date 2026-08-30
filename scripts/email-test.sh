#!/usr/bin/env bash
# Re-send latest digest email with video.mp4 + threads.jpg + youtube-thumbnail.jpg (no full regen).
#
# Usage:
#   yarn email:test
#   yarn email:test output/digest-2026-08-28/video.mp4
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
  echo "No video found." >&2
  exit 1
fi

export EMAIL_TEST_VIDEO="$VIDEO"
export EMAIL_TEST_DIR
EMAIL_TEST_DIR="$(dirname "$VIDEO")"

yarn build >/dev/null
node <<'NODE'
const { readFileSync } = require('fs');
const { ConfigService } = require('@nestjs/config');
const { Resend } = require('resend');
const { AppConfigService } = require('./dist/config/app-config.service');
const { ThreadsImageService } = require('./dist/publishers/threads-image.service');
const { YoutubeThumbnailService } = require('./dist/publishers/youtube-thumbnail.service');
const {
  buildTwitterCaption,
  buildTikTokCaption,
  buildThreadsCaption,
  buildYoutubeCaption,
  digestHeadlines,
  scriptHashtags,
} = require('./dist/publishers/post-captions');

const envMap = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return [l.slice(0, i), v];
    }),
);

const appConfig = new AppConfigService(new ConfigService(envMap));
const threadsImage = new ThreadsImageService(appConfig);
const youtubeThumb = new YoutubeThumbnailService(appConfig);
const videoPath = process.env.EMAIL_TEST_VIDEO;
const outDir = process.env.EMAIL_TEST_DIR;

(async () => {
  const res = await fetch(envMap.NEWS_API_URL, {
    headers: { Accept: 'application/json' },
  });
  const payload = await res.json();
  const digest = payload.digest || {};
  const bullets = (digest.bullets || []).filter((b) => b.title && b.summary);
  const script = {
    id: require('path').basename(outDir),
    title: (digest.headline || bullets[0]?.title || 'AI digest').trim(),
    body: '',
    hashtags: ['#AI', '#TechNews', '#AINews'],
    segments: bullets.map((b, i) => ({
      id: `bullet-${i + 1}`,
      title: b.title.trim(),
      spokenHint: 'a',
      searchQuery: 'a',
    })),
  };

  const threadsPath = await threadsImage.render(script, outDir);
  const youtubePath = await youtubeThumb.render(script, outDir);
  const twitter = buildTwitterCaption(script);
  const tiktok = buildTikTokCaption(script);
  const threadsCap = buildThreadsCaption(script);
  const youtubeCap = buildYoutubeCaption(script);
  const esc = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const headlines = digestHeadlines(script)
    .map((l) => `<li>${esc(l)}</li>`)
    .join('');
  const html = `<!doctype html><html><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;line-height:1.5">
  <p style="letter-spacing:.12em;text-transform:uppercase;color:#888;font-size:12px">${esc(envMap.BRAND_NAME || 'ZanshinAI')} daily digest</p>
  <h1 style="font-size:22px">${esc(script.title)}</h1>
  <p><strong>Hashtags:</strong> ${esc(scriptHashtags(script, 6).join(' '))}</p>
  <h2 style="font-size:15px;text-transform:uppercase;color:#666">Headlines</h2><ul>${headlines}</ul>
  <h2 style="font-size:15px;text-transform:uppercase;color:#666">Copy for X / Twitter</h2>
  <pre style="white-space:pre-wrap;background:#f4f4f5;padding:14px;border-radius:10px">${esc(twitter)}</pre>
  <h2 style="font-size:15px;text-transform:uppercase;color:#666">Copy for TikTok</h2>
  <pre style="white-space:pre-wrap;background:#f4f4f5;padding:14px;border-radius:10px">${esc(tiktok)}</pre>
  <h2 style="font-size:15px;text-transform:uppercase;color:#666">Copy for Threads</h2>
  <p style="font-size:13px;color:#666">Post <strong>threads.jpg</strong> with this caption:</p>
  <pre style="white-space:pre-wrap;background:#f4f4f5;padding:14px;border-radius:10px">${esc(threadsCap)}</pre>
  <h2 style="font-size:15px;text-transform:uppercase;color:#666">Copy for YouTube Shorts</h2>
  <p style="font-size:13px;color:#666">Upload <strong>video.mp4</strong> as a Short; custom thumb = <strong>youtube-thumbnail.jpg</strong>. First line = title:</p>
  <pre style="white-space:pre-wrap;background:#f4f4f5;padding:14px;border-radius:10px">${esc(youtubeCap)}</pre>
  <p>Attachments: <strong>video.mp4</strong> + <strong>threads.jpg</strong> + <strong>youtube-thumbnail.jpg</strong></p>
  </body></html>`;

  const to = envMap.RESEND_TO_EMAIL.split(/[,;\s]+/).filter((e) =>
    e.includes('@'),
  );
  const resend = new Resend(envMap.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: envMap.RESEND_FROM_EMAIL,
    to,
    subject: `${envMap.BRAND_NAME || 'ZanshinAI'} daily digest — ${script.title}`.slice(
      0,
      120,
    ),
    html,
    text: `X:\n${twitter}\n\nTikTok:\n${tiktok}\n\nThreads:\n${threadsCap}\n\nYouTube:\n${youtubeCap}`,
    attachments: [
      { filename: 'video.mp4', content: readFileSync(videoPath) },
      { filename: 'threads.jpg', content: readFileSync(threadsPath) },
      {
        filename: 'youtube-thumbnail.jpg',
        content: readFileSync(youtubePath),
      },
    ],
  });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log('Sent', data.id, '→', to.join(', '));
  console.log('threads.jpg:', threadsPath);
  console.log('youtube-thumbnail.jpg:', youtubePath);
})();
NODE
