# AI News Video Bot

NestJS service that fetches a daily AI news script, renders a vertical TikTok/Reels-style video (voiceover + kinetic captions), and auto-posts to Twitter/X and TikTok.

## Setup

```bash
yarn install
cp .env.example .env
# Fill in NEWS_API_URL, Twitter, and TikTok credentials
# TTS uses free Microsoft Edge neural voices (no API key)
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

## Railway

Live service: https://video-gen-production-d57f.up.railway.app

Configured via `railway.toml` + `Dockerfile`. Persistent volume at `/data`.

```bash
railway link
railway up -d
railway logs
```

Ops:
- `GET https://video-gen-production-d57f.up.railway.app/health`
- `POST https://video-gen-production-d57f.up.railway.app/pipeline/run`
- `GET https://video-gen-production-d57f.up.railway.app/pipeline/status`

## Ops endpoints

- `GET /health` — liveness
- `POST /pipeline/run` — run today's job manually
- `GET /pipeline/status` — last run + last posted item

## macOS background service (auto daily run)

Keeps Wan + Nest running via LaunchAgents after login. Nest’s cron (`CRON_SCHEDULE`, default `1 8 * * *` UTC) generates the video every day — Cursor does not need to be open.

```bash
yarn build
yarn service:install    # install + start LaunchAgents
yarn service:status     # health + schedule
yarn service:uninstall  # stop + remove
```

Logs: `logs/macos/wan.*.log` and `logs/macos/app.*.log`.

Notes:
- Mac must be awake / logged in at schedule time (LaunchAgents are per-user).
- Keep `yarn wan:setup` done once so the Wan venv exists.
- For unattended publish later, set `SKIP_PUBLISH=false` and keep X API credits funded.

## Custom Node video engine

MoviePy-style pipeline, fully in Node:

1. **Edge TTS** — free Microsoft neural voices + word timestamps (no API key)
2. **Local Wan images** — open-source Wan2.1 stills per news segment (no cloud credits; Openverse fallback)
3. **Sharp + FFmpeg** — vertical slideshow + audio (no burned-in captions; platforms handle legends)

Code lives under `src/video/engine/`.

Default voice: `EDGE_TTS_VOICE=en-US-GuyNeural`.

### Local Wan (recommended)

Runs Alibaba's open-source **Wan2.1-T2V-1.3B** on your machine (Apple Silicon MPS / CUDA / CPU). No daily credit caps.

```bash
# one-time: create venv, install torch/diffusers, download weights (~several GB)
yarn wan:setup

# start the local image worker (keep this terminal open)
yarn wan:serve
```

In `.env`:
```bash
IMAGE_PROVIDER=wan
WAN_API_URL=http://127.0.0.1:7860
WAN_IMAGE_WIDTH=480
WAN_IMAGE_HEIGHT=832
```

First image is slow (model load). On a Mac with ~24GB unified memory, expect roughly a few minutes per still.

Optional cloud providers (credit-limited):
```bash
IMAGE_PROVIDER=huggingface
HF_TOKEN=hf_...
# or
IMAGE_PROVIDER=kling
KLING_API_KEY=your_api_key
```
Without a working AI provider, the bot falls back to Openverse stills automatically.

## Daily flow

1. Cron (`CRON_SCHEDULE`, default `1 8 * * *` UTC) runs 1 minute after the digest job (`0 8 * * *` UTC → 09:00 Lisbon in summer, 08:00 in winter). If today's digest isn't ready or the fetch fails, it retries up to **10 times every 10 minutes** (`PIPELINE_RETRY_ATTEMPTS` / `PIPELINE_RETRY_DELAY_MS`).
2. Fetches `NEWS_API_URL` (`/api/digest`) and builds today's video script from `headline` + `bullets`
3. Edge TTS with word timestamps
4. Local Wan images timed to each news segment (Openverse fallback)
5. Custom FFmpeg engine renders 1080×1920 slideshow video (no on-screen script text)
6. Builds `threads.jpg` (vertical post card) and `youtube-thumbnail.jpg` (**2160×3840, 9:16** — [YouTube Shorts custom thumbnail](https://support.google.com/youtube/answer/72431))
7. Publishes to Twitter/X and TikTok (or emails assets when `SKIP_PUBLISH=true`)
8. Stores the digest id (`digest-YYYY-MM-DD`) in SQLite so it is not posted again

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
