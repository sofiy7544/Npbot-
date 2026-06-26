/**
 * Distributed token-bucket rate limiter using Redis.
 *
 * Per-user, per-chat, and per-global keys. Atomic via Lua so multiple bot
 * instances behind a load balancer don't race.
 *
 * NB: Returns the number of MS until next allowed request (0 = allowed now).
 */
import type { Redis } from "ioredis";

const LUA_RATE_LIMIT = `
-- KEYS[1] = bucket key
-- ARGV[1] = capacity, ARGV[2] = refill_per_sec, ARGV[3] = cost, ARGV[4] = now_ms
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last = now
end

local elapsed = (now - last) / 1000.0
tokens = math.min(capacity, tokens + elapsed * refill)

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tokens, 'last', now)
  redis.call('EXPIRE', key, math.ceil(capacity / refill * 2) + 60)
  return 0
else
  local wait_ms = math.ceil((cost - tokens) / refill * 1000)
  redis.call('HMSET', key, 'tokens', tokens, 'last', now)
  redis.call('EXPIRE', key, math.ceil(capacity / refill * 2) + 60)
  return wait_ms
end
`;

export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  /**
   * Acquire 1 token from the bucket. Returns ms-to-wait (0 = allowed).
   * Throws on Redis errors (caller should fail-open or fail-closed).
   */
  async check(key: string, capacity: number, refillPerSec: number, cost = 1): Promise<number> {
    const result = await this.redis.eval(LUA_RATE_LIMIT, 1, key, capacity, refillPerSec, cost, Date.now());
    return Number(result);
  }

  /** Higher-level: per-user rate limit. */
  async checkUser(userId: bigint | number, perMin: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const wait = await this.check(`rl:user:${userId}`, perMin, perMin / 60);
    return { allowed: wait === 0, retryAfterMs: wait };
  }

  async checkGlobal(perSec: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const wait = await this.check(`rl:global`, perSec * 2, perSec);
    return { allowed: wait === 0, retryAfterMs: wait };
  }
}
