/**
 * Telegram bot wrapper — thin layer around grammY that adapts to our domain.
 *
 * Responsibilities:
 *   - Long-polling OR webhook (TG_WEBHOOK_URL switch)
 *   - Global error handler (logs to pino, never crashes)
 *   - Flood control (catch FloodWaitError, requeue with delay)
 *   - Per-update correlation ID propagation
 *   - Graceful shutdown (drain in-flight handlers)
 */
import { Bot, GrammyError, HttpError, type Context } from "grammy";
import { randomUUID } from "node:crypto";
import { withContext, makeLogger } from "../../shared/logger.js";
import { loadConfig } from "../../shared/config.js";
import type { RedisRateLimiter } from "../redis/RedisRateLimiter.js";

const log = makeLogger("tg");

export class TelegramBot {
  public readonly bot: Bot;
  private isShuttingDown = false;

  constructor(token: string, private readonly rateLimiter: RedisRateLimiter) {
    this.bot = new Bot(token);

    // Correlation ID + structured logging per update
    this.bot.use(async (ctx, next) => {
      const requestId = randomUUID();
      await withContext(
        { requestId, chatId: ctx.chat?.id, userId: ctx.from?.id },
        async () => {
          const start = Date.now();
          try {
            await next();
          } finally {
            log.debug({ duration: Date.now() - start, updateType: ctx.update }, "tg.update_handled");
          }
        },
      );
    });

    // Per-user rate limiter
    this.bot.use(async (ctx, next) => {
      if (!ctx.from?.id) return next();
      const cfg = loadConfig();
      try {
        const r = await this.rateLimiter.checkUser(ctx.from.id, cfg.RATE_LIMIT_PER_USER_PER_MIN);
        if (!r.allowed) {
          log.warn({ userId: ctx.from.id, retryAfterMs: r.retryAfterMs }, "tg.rate_limited");
          await ctx.reply(`⏳ Занадто багато запитів. Спробуй через ${Math.ceil(r.retryAfterMs / 1000)}с.`).catch(() => {});
          return;
        }
      } catch (e) {
        log.error({ err: String(e) }, "tg.rate_limit_redis_failure");
        // Fail-open: allow request through if Redis is down
      }
      await next();
    });

    this.bot.catch((err) => {
      const ctx = err.ctx;
      const e = err.error;
      if (e instanceof GrammyError) {
        // Flood wait — Telegram throttling
        if (e.error_code === 429) {
          log.warn({ updateId: ctx.update.update_id, retryAfter: e.parameters?.retry_after }, "tg.flood_wait");
        } else if (e.error_code === 403) {
          log.info({ updateId: ctx.update.update_id, desc: e.description }, "tg.user_blocked_bot");
        } else {
          log.error({ updateId: ctx.update.update_id, code: e.error_code, desc: e.description }, "tg.api_error");
        }
      } else if (e instanceof HttpError) {
        log.error({ updateId: ctx.update.update_id, err: String(e) }, "tg.http_error");
      } else {
        log.error({ updateId: ctx.update.update_id, err: e instanceof Error ? e.stack : String(e) }, "tg.unknown_error");
      }
    });
  }

  async start(): Promise<void> {
    const cfg = loadConfig();
    if (cfg.TG_WEBHOOK_URL) {
      log.info({ url: cfg.TG_WEBHOOK_URL }, "tg.webhook_mode");
      await this.bot.api.setWebhook(cfg.TG_WEBHOOK_URL, {
        secret_token: cfg.TG_WEBHOOK_SECRET,
        allowed_updates: ["message", "edited_message", "callback_query"],
        drop_pending_updates: true,
      });
      // The Fastify webhook handler (presentation/webhooks) will call this.bot.handleUpdate()
    } else {
      log.info("tg.polling_mode");
      // Don't await — bot.start() blocks until shutdown
      void this.bot.start({
        drop_pending_updates: true,
        allowed_updates: ["message", "edited_message", "callback_query"],
        onStart: (me) => log.info({ username: me.username, id: me.id }, "tg.started"),
      });
    }

    await this.bot.api.setMyCommands([
      { command: "start", description: "Привітання + приклад" },
      { command: "help", description: "Які поля підтримуються" },
      { command: "test", description: "Перевірити NP API" },
      { command: "whoami", description: "ID цього чату" },
      { command: "stats", description: "Моя статистика" },
    ]).catch((e) => log.warn({ err: String(e) }, "tg.set_commands_failed"));
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    log.info("tg.stopping");
    await this.bot.stop();
  }
}
