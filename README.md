# AI News Video Bot

NestJS service that fetches a daily AI news script, renders a vertical TikTok/Reels-style video (voiceover + kinetic captions), and auto-posts to Twitter/X and TikTok.

## Setup

```bash
yarn install
cp .env.example .env
# Fill in NEWS_API_URL, ElevenLabs, Twitter, and TikTok credentials
yarn start:dev
```

Set `SKIP_PUBLISH=true` to generate videos without posting while you wire credentials.

## Ops endpoints

- `GET /health` — liveness
- `POST /pipeline/run` — run today's job manually
- `GET /pipeline/status` — last run + last posted item

## Remotion studio (caption preview)

```bash
yarn studio
```

Composition entrypoint: `compositions/index.ts`. Requires `ffmpeg` on PATH for rendering.

## Daily flow

1. Cron (`CRON_SCHEDULE`, default `5 9 * * *` in `Europe/Lisbon`) runs shortly after the digest publishes at 09:00
2. Fetches `NEWS_API_URL` (`/api/digest`) and builds today's video script from `headline` + `bullets`
3. ElevenLabs TTS with word timestamps
4. Remotion render (1080×1920 captions video)
5. Publishes to Twitter/X and TikTok
6. Stores the digest id (`digest-YYYY-MM-DD`) in SQLite so it is not posted again

## News API shape

Expected response from `GET /api/digest`:

```json
{
  "ok": true,
  "digest": {
    "timestamp": "2026-08-12T08:00:01.919695+00:00",
    "headline": "...",
    "bullets": [
      { "title": "...", "summary": "...", "source": "TechStartups" }
    ]
  }
}
```

The pipeline posts one daily video (`digest-YYYY-MM-DD`) assembled from all bullets. Individual bullet scripts are also normalized and stored with stable ids for later use.
