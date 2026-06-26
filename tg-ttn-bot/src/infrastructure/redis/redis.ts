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

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
