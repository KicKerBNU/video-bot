# AI News Video Bot

NestJS service that fetches a daily AI news script, renders a vertical TikTok/Reels-style video (voiceover + kinetic captions), and auto-posts to Twitter/X and TikTok.

## Setup

```bash
yarn install
cp .env.example .env
# Fill in NEWS_API_URL, ElevenLabs, Twitter, and TikTok credentials
# Requires ffmpeg on PATH (brew install ffmpeg) for local non-Docker runs
yarn start:dev
```

Set `SKIP_PUBLISH=true` to generate videos without posting while you wire credentials.

## Docker (local infrastructure)

Requires Docker Desktop / Compose. Uses Node 22 + system FFmpeg inside the image.

```bash
cp .env.example .env
# fill credentials in .env

docker compose up --build -d
docker compose ps
curl -s http://localhost:3000/health
```

Useful commands:

```bash
# follow logs
docker compose logs -f video-gen

# trigger a manual pipeline run
curl -sS -X POST http://localhost:3000/pipeline/run

# stop
docker compose down
```

Persistent volumes:
- `video_gen_data` → SQLite store (`/app/data`)
- `video_gen_output` → rendered MP4s (`/app/output`)

To inspect videos on the host, uncomment the `./output:/app/output` bind mount in `docker-compose.yml`.

## Ops endpoints

- `GET /health` — liveness
- `POST /pipeline/run` — run today's job manually
- `GET /pipeline/status` — last run + last posted item

## Custom Node video engine

MoviePy-style pipeline, fully in Node:

1. **ElevenLabs** — TTS + word timestamps
2. **Sharp** — branded 1080×1920 background + caption overlays
3. **FFmpeg** — compose background + timed overlays + delayed audio → MP4

Code lives under `src/video/engine/`.

## Daily flow

1. Cron (`CRON_SCHEDULE`, default `1 8 * * *` UTC) runs 1 minute after the digest job (`0 8 * * *` UTC → 09:00 Lisbon in summer, 08:00 in winter)
2. Fetches `NEWS_API_URL` (`/api/digest`) and builds today's video script from `headline` + `bullets`
3. ElevenLabs TTS with word timestamps
4. Custom FFmpeg engine renders 1080×1920 captions video
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
