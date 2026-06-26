/**
 * Telegram bot handlers: message → preview, callback → create TTN.
 *
 * Callback flow:
 *   1. user posts order text → bot replies with preview + buttons
 *      keyed by *source message id* (callback_data = "create:<srcMsgId>" / "cancel:<srcMsgId>")
 *   2. callback handler looks up draft by source message id
 *
 * That way callback_data fits in 64 bytes and survives bot restart.
 */
import { Bot, InlineKeyboard } from "grammy";
import { parseOrder, isDraftReady, type OrderDraft } from "./parser.js";
import { saveDraft, getDraft, deleteDraft } from "./state.js";
import { formatPreview, formatSuccess, formatError } from "./format.js";
import { findCity, findWarehouse, createTtn, testApiKey, type NPCreateDocResult } from "./np-client.js";
import { log } from "./logger.js";

const ALLOWED_CHAT_IDS = (process.env.ALLOWED_CHAT_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => parseInt(s, 10))
  .filter((n) => !isNaN(n));

function isAllowed(chatId: number): boolean {
  if (ALLOWED_CHAT_IDS.length === 0) return true; // dev: any chat
  return ALLOWED_CHAT_IDS.includes(chatId);
}

function draftKey(chatId: number, srcMsgId: number): string {
  return `${chatId}:${srcMsgId}`;
}

export function registerHandlers(bot: Bot) {
  // ─────────────────────────────────────────────────────────
  // Commands
  // ─────────────────────────────────────────────────────────

  bot.command("start", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) {
      await ctx.reply(`Цей чат не у whitelist. Додай chat_id <code>${ctx.chat.id}</code> у .env → ALLOWED_CHAT_IDS`, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(
      `👋 Привіт! Я приймаю замовлення в Telegram і створюю ТТН Нової Пошти.

<b>Приклад:</b>
<code>Іванова Олена Петрівна
+380501234567
Київ, № 42
Сума: 2500
Quencher 40oz Cream
Накладений</code>

Або одним рядком:
<code>Іванова О. +380501234567 Київ № 42 сума 2500 термокухоль</code>

Команди:
/test — перевірити NP API key
/whoami — показати ID цього чату
/help — ця довідка`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("help", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    await ctx.reply(
      `<b>Підтримувані поля:</b>
• <b>ПІБ</b> — кирилицею, 2-3 слова
• <b>Телефон</b> — +380... або 0...
• <b>Місто</b> — Київ, Львів, Дніпро тощо
• <b>Відділення/поштомат</b> — «№ 42», «поштомат 5», «кур'єр»
• <b>Сума</b> — «2500», «2500 ₴», «сума 2500»
• <b>Вага</b> — «0.6 кг», «600 г», «вага 0.5»
• <b>Опис</b> — назва товару
• <b>Оплата</b> — «накладений» / «карта» / «готівка»

Можна вільним текстом або з лейблами (ПІБ:, Тел:, Місто:, Відділення:, Сума:, Опис:).`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("whoami", async (ctx) => {
    await ctx.reply(
      `Chat ID: <code>${ctx.chat.id}</code>\nType: ${ctx.chat.type}\n\nДодай цей ID в .env → ALLOWED_CHAT_IDS`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("test", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) return;
    const msg = await ctx.reply("🔄 Перевіряю NP API…");
    const r = await testApiKey();
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, r.message);
  });

  // ─────────────────────────────────────────────────────────
  // Main: text message → parse → preview
  // ─────────────────────────────────────────────────────────

  bot.on("message:text", async (ctx) => {
    if (!isAllowed(ctx.chat.id)) {
      log.warn("msg.blocked", { chatId: ctx.chat.id, from: ctx.from?.username });
      return;
    }
    const text = ctx.message.text;
    log.info("msg.received", {
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      from: ctx.from?.username ?? ctx.from?.first_name,
      msgId: ctx.message.message_id,
      text: text.slice(0, 500),
    });
    if (text.startsWith("/")) return;
    if (text.length < 10) {
      log.debug("msg.tooShort", { text });
      return;
    }

    const draft = parseOrder(text);
    log.info("msg.parsed", {
      name: draft.recipientName,
      phone: draft.recipientPhone,
      city: draft.cityName,
      whType: draft.warehouseType,
      whNumber: draft.warehouseNumber,
      cost: draft.cost,
      payment: draft.paymentMethod,
      paymentScore: draft.paymentScore,
      paymentRules: draft.paymentReasoning?.map((r) => r.rule),
      ready: isDraftReady(draft),
      warnings: draft.warnings,
    });

    // Sanity check: needs at least phone OR (city + warehouse) to be considered an order
    const looksLikeOrder = !!draft.recipientPhone || (!!draft.cityName && !!draft.warehouseNumber);
    if (!looksLikeOrder) {
      log.info("msg.notOrder", { reason: "no phone and no city+warehouse" });
      return; // silently ignore non-orders
    }

    const srcMsgId = ctx.message.message_id;
    const key = draftKey(ctx.chat.id, srcMsgId);

    const kb = new InlineKeyboard();
    if (isDraftReady(draft)) {
      kb.text("✅ Створити ТТН", `create:${srcMsgId}`).text("❌ Скасувати", `cancel:${srcMsgId}`);
    } else {
      kb.text("❌ Скасувати", `cancel:${srcMsgId}`);
    }

    const reply = await ctx.reply(formatPreview(draft), {
      parse_mode: "HTML",
      reply_markup: kb,
      reply_parameters: { message_id: srcMsgId },
      link_preview_options: { is_disabled: true },
    });

    saveDraft(key, {
      draft,
      sourceChatId: ctx.chat.id,
      sourceMessageId: srcMsgId,
      authorId: ctx.from?.id ?? 0,
      authorName: ctx.from?.first_name ?? "?",
    });

    // Stash reply message id in draft (so we can edit on action)
    saveDraft(key + ":reply", {
      draft,
      sourceChatId: reply.chat.id,
      sourceMessageId: reply.message_id,
      authorId: 0,
      authorName: "",
    });
  });

  // ─────────────────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────────────────

  bot.callbackQuery(/^(create|cancel):(\d+)$/, async (ctx) => {
    log.info("cb.received", {
      data: ctx.callbackQuery.data,
      chatId: ctx.chat?.id,
      from: ctx.from?.username,
    });
    const m = ctx.callbackQuery.data!.match(/^(create|cancel):(\d+)$/);
    if (!m) {
      await ctx.answerCallbackQuery();
      return;
    }
    const action = m[1] as "create" | "cancel";
    const srcMsgId = parseInt(m[2], 10);
    const chatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id;
    if (!chatId) {
      await ctx.answerCallbackQuery({ text: "Не зрозумів контекст чату", show_alert: true });
      return;
    }

    const key = draftKey(chatId, srcMsgId);
    const entry = getDraft(key);

    if (!entry) {
      await ctx.answerCallbackQuery({
        text: "Чернетка прострочена. Надішли замовлення повторно.",
        show_alert: true,
      });
      return;
    }

    if (action === "cancel") {
      deleteDraft(key);
      deleteDraft(key + ":reply");
      await ctx.editMessageText("❌ <i>Скасовано</i>", { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
      return;
    }

    // action === "create"
    if (!isDraftReady(entry.draft)) {
      await ctx.answerCallbackQuery({
        text: "Не вистачає обов'язкових полів. Перевір повідомлення.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Створюю ТТН…" });
    await ctx.editMessageText(formatPreview(entry.draft) + "\n\n⏳ <i>Створюю ТТН…</i>", {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });

    const result = await createTtnFromDraft(entry.draft);
    log.info("ttn.result", { ok: result.ok, ...(result.ok ? { ttn: result.data.IntDocNumber, cost: result.data.CostOnSite } : { error: result.error }) });

    if (!result.ok) {
      await ctx.editMessageText(formatError(result.error), { parse_mode: "HTML" });
      return;
    }

    const r = result.data;
    const whLabel =
      entry.draft.warehouseType === "courier"
        ? `Кур'єр: ${entry.draft.courierAddress ?? "—"}`
        : `${entry.draft.warehouseType === "postomat" ? "Поштомат" : "Відділення"} №${entry.draft.warehouseNumber}`;

    await ctx.editMessageText(
      formatSuccess({
        ttn: r.IntDocNumber,
        cost: r.CostOnSite,
        estimatedDelivery: r.EstimatedDeliveryDate,
        recipientName: entry.draft.recipientName!,
        city: entry.draft.cityName!,
        warehouse: whLabel,
      }),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );

    deleteDraft(key);
    deleteDraft(key + ":reply");
  });

  // Unknown callback fallback
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Невідома дія" });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Core: draft → TTN
// ─────────────────────────────────────────────────────────────────────

async function createTtnFromDraft(draft: OrderDraft): Promise<
  | { ok: true; data: NPCreateDocResult }
  | { ok: false; error: string }
> {
  if (!draft.cityName || !draft.recipientName || !draft.recipientPhone) {
    return { ok: false, error: "Не вистачає обов'язкових полів (ПІБ, телефон, місто)" };
  }

  const city = await findCity(draft.cityName);
  if (!city) return { ok: false, error: `Місто «${draft.cityName}» не знайдено в НП` };

  let warehouseRef: string | undefined;
  if (draft.warehouseType !== "courier" && draft.warehouseNumber) {
    const wh = await findWarehouse({
      cityRef: city.Ref,
      number: draft.warehouseNumber,
      type: draft.warehouseType,
    });
    if (!wh) {
      return {
        ok: false,
        error: `${draft.warehouseType === "postomat" ? "Поштомат" : "Відділення"} №${draft.warehouseNumber} не знайдено в ${draft.cityName}`,
      };
    }
    warehouseRef = wh.Ref;
  }

  const cost = draft.cost ?? 1;
  const weight = draft.weightKg ?? parseFloat(process.env.NP_DEFAULT_WEIGHT_KG ?? "0.6");
  const description = draft.description ?? process.env.NP_DEFAULT_DESCRIPTION ?? "Посилка";

  return createTtn({
    recipientName: draft.recipientName,
    recipientPhone: draft.recipientPhone,
    cityRecipientRef: city.Ref,
    warehouseRecipientRef: warehouseRef,
    courierAddress: draft.courierAddress,
    weight,
    cost,
    description,
    serviceType: draft.warehouseType === "courier" ? "DoorsDoors" : "WarehouseWarehouse",
    paymentMethod: draft.paymentMethod,
    payerType: draft.payerType,
  });
}
