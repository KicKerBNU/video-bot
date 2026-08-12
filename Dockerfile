# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN yarn install --frozen-lockfile \
  && yarn build \
  && yarn install --frozen-lockfile --production=true \
  && yarn cache clean


FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    OUTPUT_DIR=/data/output

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    fontconfig \
    fonts-liberation \
    fonts-dejavu-core \
    ca-certificates \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /data/output /app \
  && chown -R node:node /data /app

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/docker-entrypoint.sh"]
