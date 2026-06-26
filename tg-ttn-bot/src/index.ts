/**
 * tg-ttn-bot entry point.
 *
 * Reads .env, starts long-polling bot, registers handlers.
 */
import "dotenv/config";
import { Bot, GrammyError, HttpError } from "grammy";
import { registerHandlers } from "./handlers.js";
import { isMockMode } from "./np-mock.js";
import { log } from "./logger.js";

const token = process.env.TG_BOT_TOKEN;
if (!token) {
  console.error("❌ TG_BOT_TOKEN not set in .env");
  process.exit(1);
}

const bot = new Bot(token);

// Global error handler — log + keep running
bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;
  if (e instanceof GrammyError) {
    log.error("bot.tg_error", { updateId: ctx.update.update_id, description: e.description });
  } else if (e instanceof HttpError) {
    log.error("bot.net_error", { updateId: ctx.update.update_id, message: String(e) });
  } else {
    log.error("bot.unknown_error", { updateId: ctx.update.update_id, error: String(e) });
  }
});

registerHandlers(bot);

// Set commands so / autocompletes
bot.api.setMyCommands([
  { command: "start", description: "Привітання + приклад" },
  { command: "help", description: "Які поля підтримуються" },
  { command: "test", description: "Перевірити NP API key" },
  { command: "whoami", description: "Показати ID цього чату" },
]).catch((e) => console.warn("[bot] setMyCommands failed:", e));

const MOCK = isMockMode();
log.info("bot.starting", {
  mode: MOCK ? "MOCK" : "PRODUCTION",
  allowedChats: process.env.ALLOWED_CHAT_IDS || "<any>",
  hasNpApiKey: !!process.env.NP_API_KEY,
  hasNpSender: !!process.env.NP_SENDER_REF,
});
console.log("🤖 tg-ttn-bot starting…");
console.log(`   Mode: ${MOCK ? "🧪 MOCK (fake NP, no real TTNs)" : "🟢 PRODUCTION (real NP API)"}`);
console.log(`   Allowed chats: ${process.env.ALLOWED_CHAT_IDS || "<any> (any chat — set ALLOWED_CHAT_IDS for prod!)"}`);
console.log(`   Log file: logs/bot.log`);

bot.start({
  onStart: (me) => {
    log.info("bot.started", { username: me.username, id: me.id });
    console.log(`✅ Bot @${me.username} is running (long-polling)`);
  },
  drop_pending_updates: true,
  allowed_updates: ["message", "callback_query"],
});

// Graceful shutdown
const stop = () => {
  console.log("\n👋 Shutting down…");
  bot.stop();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
