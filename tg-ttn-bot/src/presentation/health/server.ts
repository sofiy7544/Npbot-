/**
 * Minimal health server — the one HTTP surface the bot exposes.
 *
 * The bot itself is long-polling: it opens outbound connections to Telegram and
 * listens on nothing. Cloud platforms, however, want a port to probe
 * (Railway `healthcheckPath`, Render web services, Fly `http_service.checks`),
 * and without one they either mark the deploy unhealthy or kill it as idle.
 *
 * So: started only when PORT is set. Locally, and under docker-compose, PORT is
 * absent and nothing binds.
 *
 * Routes:
 *   GET /health  → 200 when Postgres AND Redis answer, 503 otherwise
 *   GET /        → 200 liveness (process is up; says nothing about dependencies)
 */
import { createServer, type Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { makeLogger } from "../../shared/logger.js";

const log = makeLogger("health");

/** A dependency probe must not hang the health check — cap every one of them. */
const PROBE_TIMEOUT_MS = 2000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function probe(name: string, fn: () => Promise<unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    await withTimeout(Promise.resolve(fn()), PROBE_TIMEOUT_MS);
    return { ok: true };
  } catch (e) {
    log.warn({ dep: name, err: String(e) }, "health.probe_failed");
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type HealthDeps = {
  prisma: PrismaClient;
  redis: Redis;
};

/**
 * Starts the health server. Returns null when PORT is unset (nothing to bind).
 * Never throws: a failed health server must not take the bot down with it.
 */
export function startHealthServer(port: number | undefined, deps: HealthDeps): Server | null {
  if (!port) {
    log.debug("health.disabled_no_port");
    return null;
  }

  const startedAt = Date.now();

  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (url.startsWith("/health")) {
      void (async () => {
        const [db, redis] = await Promise.all([
          probe("postgres", () => deps.prisma.$queryRaw`SELECT 1`),
          probe("redis", () => deps.redis.ping()),
        ]);
        const healthy = db.ok && redis.ok;
        const body = JSON.stringify({
          status: healthy ? "ok" : "degraded",
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          checks: { postgres: db, redis },
        });
        res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
        res.end(body);
      })();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "alive", uptimeSec: Math.round((Date.now() - startedAt) / 1000) }));
  });

  server.on("error", (e) => log.error({ err: String(e) }, "health.server_error"));
  server.listen(port, "0.0.0.0", () => log.info({ port }, "health.listening"));
  return server;
}

export function stopHealthServer(server: Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
