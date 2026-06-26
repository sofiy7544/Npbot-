# ───────────────────────────────────────────────────────────────────
# Multi-stage Dockerfile — minimal final image (~150MB).
# Build: docker build -t tg-ttn-bot:latest .
# ───────────────────────────────────────────────────────────────────

# ─── Stage 1: deps ────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apk add --no-cache openssl3 && \
    npm ci --omit=dev --ignore-scripts

# ─── Stage 2: build ───────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl3
COPY package.json package-lock.json* ./
RUN npm ci
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npx tsc -p tsconfig.json

# ─── Stage 3: runtime ─────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl3 tini && \
    addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--enable-source-maps"

COPY --from=deps  --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app package.json ./

USER app

# Healthcheck — process must respond to its own Telegram getMe roundtrip
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
