/**
 * Redis singleton — single ioredis connection shared across the app.
 * BullMQ uses its own connection (it requires a dedicated one for blocking).
 */
import { Redis } from "ioredis";
import { loadConfig } from "../../shared/config.js";
import { makeLogger } from "../../shared/logger.js";

const log = makeLogger("redis");

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const cfg = loadConfig();
  client = new Redis(cfg.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    reconnectOnError: () => true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  client.on("error", (e) => log.error({ err: e.message }, "redis.error"));
  client.on("connect", () => log.info("redis.connected"));
  client.on("reconnecting", () => log.warn("redis.reconnecting"));
  return client;
}

const bullConnections: Redis[] = [];

/**
 * Dedicated connection for a BullMQ Worker.
 *
 * Two reasons this exists instead of reusing `getRedis()`:
 *   1. Workers issue blocking commands (BRPOPLPUSH) that monopolise a connection,
 *      so every Worker needs its own — sharing one starves the others.
 *   2. It is built from REDIS_URL, so TLS (`rediss://`) and ACL usernames survive.
 *      Rebuilding options by hand from `client.options` drops both, which breaks
 *      every managed Redis (Railway, Render, Upstash).
 */
export function makeBullConnection(): Redis {
  const cfg = loadConfig();
  const conn = new Redis(cfg.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false, // BullMQ manages readiness itself
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  conn.on("error", (e) => log.error({ err: e.message }, "redis.bull.error"));
  bullConnections.push(conn);
  return conn;
}

export async function closeBullConnections(): Promise<void> {
  await Promise.all(bullConnections.map((c) => c.quit().catch(() => c.disconnect())));
  bullConnections.length = 0;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
