# LeadForge — production container image.
#
# Single-tenant self-hosting: one Node process serving Next.js, its own SQLite
# database on a mounted volume, and the background worker in-process.
#
#   docker build -t leadforge .
#   docker run -p 3000:3000 -v leadforge-data:/app/data --env-file .env.local leadforge
#
# See docs/DEPLOYMENT.md for the full walkthrough.

# ── deps: install with build tools so better-sqlite3 can compile if no prebuild matches ──
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# ── build: compile the Next.js production bundle ──
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A throwaway value so the build can run; the real secret is injected at runtime.
ENV AUTH_SECRET=build-time-placeholder-replaced-at-runtime
RUN npm run build

# ── runner: only what the app needs at runtime ──
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    DATABASE_PATH=data/leadforge.db

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1001 --create-home leadforge \
 && mkdir -p /app/data \
 && chown -R leadforge:leadforge /app

COPY --from=build --chown=leadforge:leadforge /app/node_modules ./node_modules
COPY --from=build --chown=leadforge:leadforge /app/.next ./.next
COPY --from=build --chown=leadforge:leadforge /app/package.json ./package.json
COPY --from=build --chown=leadforge:leadforge /app/next.config.ts ./next.config.ts
COPY --from=build --chown=leadforge:leadforge /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=leadforge:leadforge /app/scripts ./scripts
COPY --from=build --chown=leadforge:leadforge /app/src ./src
COPY --from=build --chown=leadforge:leadforge /app/public ./public
COPY --chown=leadforge:leadforge docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER leadforge
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "node_modules/.bin/next start -H 0.0.0.0 -p ${PORT}"]
