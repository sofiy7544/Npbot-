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

# The Prisma CLI (a devDependency, so absent from the deps stage) ships in the
# runtime image on purpose: the container runs `prisma migrate deploy` on start.
# Without it `npx prisma` would fetch ~45MB from the npm registry on every boot —
# slow, and a hard failure whenever the registry is unreachable.
COPY --from=build --chown=app:app /app/node_modules/prisma ./node_modules/prisma

COPY --chown=app:app prisma ./prisma
COPY --chown=app:app healthcheck.mjs ./
COPY --chown=app:app package.json ./

USER app

# Probes the health server when PORT is set; a bare liveness pass otherwise.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node healthcheck.mjs || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
