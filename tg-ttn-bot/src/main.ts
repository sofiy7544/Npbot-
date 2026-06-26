/**
 * Composition root + entry point.
 *
 * Lifecycle:
 *   1. Load + validate config (fail fast on misconfig)
 *   2. Init Prisma + Redis connections
 *   3. Build DI container
 *   4. Register Telegram handlers
 *   5. Start bot (polling or webhook)
 *   6. Wait for SIGTERM/SIGINT → graceful shutdown
 *
 * Separate process: `npm run worker` runs BullMQ workers
 * Separate process: `npm run admin` runs Fastify admin API
 */
import { loadConfig } from "./shared/config.js";
import { log } from "./shared/logger.js";
import { buildContainer } from "./main.container.js";
import { TelegramBot } from "./infrastructure/telegram/TelegramBot.js";
import { registerHandlers } from "./presentation/bot/handlers.js";
import { closePrisma } from "./infrastructure/persistence/prisma.js";
import { closeRedis } from "./infrastructure/redis/redis.js";
import { isMockMode } from "./infrastructure/nova-poshta/np-mock.js";

async function main() {
  const cfg = loadConfig();
  log.info({
    nodeEnv: cfg.NODE_ENV,
    mode: isMockMode() ? "MOCK" : "PRODUCTION",
    hasWebhook: !!cfg.TG_WEBHOOK_URL,
    allowedChats: cfg.ALLOWED_CHAT_IDS.length,
  }, "app.starting");

  const container = await buildContainer();
  const telegramBot = new TelegramBot(cfg.TG_BOT_TOKEN, container.rateLimiter);

  registerHandlers(telegramBot.bot, {
    ingest: container.ingestMessageUseCase,
    createTtn: container.createTtnUseCase,
    draftRepo: container.draftRepo,
    np: container.np,
  });

  await telegramBot.start();
  log.info("app.ready");

  // ── Graceful shutdown ────────────────────────────────────
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "app.shutdown.start");

    // Stop accepting new updates
    await telegramBot.stop().catch((e) => log.warn({ err: String(e) }, "shutdown.bot_stop_failed"));

    // Close DB / Redis connections
    await closePrisma().catch((e) => log.warn({ err: String(e) }, "shutdown.prisma_failed"));
    await closeRedis().catch((e) => log.warn({ err: String(e) }, "shutdown.redis_failed"));

    log.info("app.shutdown.done");
    setTimeout(() => process.exit(0), 100);
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  // Catch unhandled — never crash silently
  process.on("unhandledRejection", (reason) => log.error({ reason: String(reason) }, "process.unhandled_rejection"));
  process.on("uncaughtException", (err) => log.fatal({ err: err.stack }, "process.uncaught_exception"));
}

main().catch((e) => {
  log.fatal({ err: e instanceof Error ? e.stack : String(e) }, "app.crash");
  process.exit(1);
});
