/**
 * End-to-end smoke test — one real order in, one real bot reply out.
 *
 * Drives the ACTUAL grammY handlers (`registerHandlers`) with synthetic Telegram
 * updates, so the path under test is the production one: parser → IngestMessage
 * → draft in Postgres → inline button → CreateTtn → Nova Poshta → reply text.
 *
 * Nothing leaves the machine: an API transformer intercepts every Telegram call
 * and returns a canned response, so `TG_BOT_TOKEN` is never used against
 * api.telegram.org. Nova Poshta runs in MOCK mode (empty NP_API_KEY), so the TTN
 * is a fake `9999…` number and nobody is charged.
 *
 * Requires a reachable Postgres and Redis (DATABASE_URL / REDIS_URL) with
 * migrations applied — see DEPLOY-CLOUD.md. Run:
 *   npm run smoke:e2e
 *
 * Exit code 0 = every step passed; 1 = something broke (details printed).
 */
import type { Message, Update, UserFromGetMe } from "grammy/types";
import { buildContainer } from "../src/main.container.js";
import { TelegramBot } from "../src/infrastructure/telegram/TelegramBot.js";
import { registerHandlers } from "../src/presentation/bot/handlers.js";
import { closePrisma } from "../src/infrastructure/persistence/prisma.js";
import { closeRedis } from "../src/infrastructure/redis/redis.js";
import { isMockMode } from "../src/infrastructure/nova-poshta/np-mock.js";

// ── Tiny assert harness, same ✅/❌ convention as the other test files ──
let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}

/** Every Telegram API call the handlers made, in order. */
type ApiCall = { method: string; payload: Record<string, unknown> };
const calls: ApiCall[] = [];

const CHAT_ID = -1001234567890; // a group, like the real order chat
const USER_ID = 7714034244;
const BOT_INFO: UserFromGetMe = {
  id: 999_000_111,
  is_bot: true,
  first_name: "SmokeBot",
  username: "smoke_bot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business_account: false,
  has_main_web_app: false,
};

/** A realistic Ukrainian order, in the format the parser is built for. */
const ORDER_TEXT = ["Іванова Олена Петрівна", "+380501234567", "Київ № 5", "Опл 2500"].join("\n");

function messageUpdate(text: string, messageId: number): Update {
  return {
    update_id: 1,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT_ID, type: "supergroup", title: "Замовлення" },
      from: { id: USER_ID, is_bot: false, first_name: "Софія", username: "shop_owner", language_code: "uk" },
      text,
    } as Message,
  } as Update;
}

function callbackUpdate(data: string, messageId: number): Update {
  return {
    update_id: 2,
    callback_query: {
      id: "cb-1",
      chat_instance: "ci-1",
      from: { id: USER_ID, is_bot: false, first_name: "Софія", username: "shop_owner", language_code: "uk" },
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Замовлення" },
        from: BOT_INFO,
        text: "preview",
      } as Message,
      data,
    },
  } as Update;
}

/** Pulls `create:<id>` out of whatever inline keyboard the preview carried. */
function findCallbackData(payload: Record<string, unknown>, prefix: string): string | null {
  const markup = payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined;
  for (const row of markup?.inline_keyboard ?? []) {
    for (const btn of row) {
      if (btn.callback_data?.startsWith(prefix)) return btn.callback_data;
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log("\n=== E2E smoke: order message → bot reply ===\n");

  const container = await buildContainer();
  assert(isMockMode(), "Nova Poshta is in MOCK mode (no real TTN will be billed)");

  const telegramBot = new TelegramBot(process.env.TG_BOT_TOKEN!, container.rateLimiter);

  // Intercept every outbound Telegram call — nothing reaches api.telegram.org.
  telegramBot.bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage" || method === "editMessageText") {
      return {
        ok: true,
        result: {
          message_id: 1000 + calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: CHAT_ID, type: "supergroup" },
          text: String((payload as { text?: string }).text ?? ""),
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  });

  // handleUpdate() needs bot info; normally getMe() fills it during start().
  telegramBot.bot.botInfo = BOT_INFO;
  registerHandlers(telegramBot.bot, {
    ingest: container.ingestMessageUseCase,
    createTtn: container.createTtnUseCase,
    draftRepo: container.draftRepo,
    np: container.np,
  });

  // ── Signal 1: the order message ──────────────────────────────────
  console.log("--- signal 1: order message ---");
  await telegramBot.bot.handleUpdate(messageUpdate(ORDER_TEXT, 501));

  const preview = calls.find((c) => c.method === "sendMessage");
  assert(!!preview, "bot answered the order with a message");
  if (!preview) return;

  const previewText = String(preview.payload.text ?? "");
  console.log("\n<<< bot replied >>>\n" + previewText + "\n");

  assert(previewText.includes("Іванова Олена Петрівна"), "preview echoes the recipient name");
  assert(previewText.includes("380501234567"), "preview echoes the phone");
  assert(previewText.includes("Київ"), "preview echoes the city");
  assert(previewText.includes("2500"), "preview echoes the cost");

  const createData = findCallbackData(preview.payload, "create:");
  assert(!!createData, "preview offers the «Створити ТТН» button", "no create:<id> in the inline keyboard");
  if (!createData) return;

  // ── Signal 2: pressing «Створити ТТН» ────────────────────────────
  console.log(`--- signal 2: pressing the button (${createData}) ---`);
  calls.length = 0;
  await telegramBot.bot.handleUpdate(callbackUpdate(createData, 1001));

  const edits = calls.filter((c) => c.method === "editMessageText");
  assert(edits.length > 0, "bot edited the preview after the button press");
  const finalText = String(edits.at(-1)?.payload.text ?? "");
  console.log("\n<<< bot replied >>>\n" + finalText + "\n");

  const ttn = finalText.match(/\b(\d{10,14})\b/)?.[1] ?? "";
  assert(/^9999/.test(ttn), "a mock TTN was issued (starts with 9999)", `got: ${ttn || "no number in reply"}`);
  assert(!finalText.includes("❌"), "the final reply is not an error");

  // ── The draft must have actually moved on in Postgres ────────────
  const draftId = BigInt(createData.split(":")[1]);
  const draft = await container.draftRepo.findById(draftId);
  assert(draft?.status === "TTN_CREATED", "draft is TTN_CREATED in Postgres", `status: ${draft?.status}`);

  const shipment = ttn ? await container.shipmentRepo.findByTtn(ttn) : null;
  assert(!!shipment, "shipment row was persisted", `ttn ${ttn} not found`);

  // ── Idempotency: the same message twice must not double-charge ───
  console.log("--- signal 3: the same order resent (idempotency) ---");
  calls.length = 0;
  await telegramBot.bot.handleUpdate(messageUpdate(ORDER_TEXT, 501));
  const resendCreate = calls
    .filter((c) => c.method === "sendMessage")
    .map((c) => findCallbackData(c.payload, "create:"))
    .find(Boolean);
  assert(
    resendCreate === null || resendCreate === undefined || resendCreate === createData,
    "resending the same message reuses the same draft (no duplicate TTN)",
    `first: ${createData}, second: ${resendCreate}`,
  );
}

main()
  .catch((e) => {
    failed++;
    console.error("\n❌ smoke test crashed:", e instanceof Error ? e.stack : String(e));
  })
  .finally(async () => {
    await closePrisma().catch(() => {});
    await closeRedis().catch(() => {});
    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  });
