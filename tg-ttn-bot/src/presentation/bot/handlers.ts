/**
 * Telegram message + callback handlers.
 *
 * Thin layer: pulls Telegram payload → builds use-case input → dispatches.
 * NEVER puts business logic here. NEVER calls Prisma/NP/Redis directly.
 */
import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { IngestMessageUseCase } from "../../application/use-cases/IngestMessageUseCase.js";
import type { CreateTtnUseCase } from "../../application/use-cases/CreateTtnUseCase.js";
import type { DraftRepository } from "../../application/ports/repositories.js";
import type { NovaPoshtaClient } from "../../application/ports/nova-poshta.js";
import { makeLogger } from "../../shared/logger.js";
import { renderPreview, renderSuccess, renderError, renderHelp, renderStart } from "./views.js";

const log = makeLogger("tg.handlers");

export type Handlers = {
  ingest: IngestMessageUseCase;
  createTtn: CreateTtnUseCase;
  draftRepo: DraftRepository;
  np: NovaPoshtaClient;
};

export function registerHandlers(bot: Bot, deps: Handlers): void {
  // ── Commands ──────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    await ctx.reply(renderStart(), { parse_mode: "HTML" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(renderHelp(), { parse_mode: "HTML" });
  });

  bot.command("whoami", async (ctx) => {
    await ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>\nType: ${ctx.chat.type}`, { parse_mode: "HTML" });
  });

  bot.command("test", async (ctx) => {
    const m = await ctx.reply("🔄 Перевіряю NP API…");
    const r = await deps.np.testConnection();
    const text = r.ok ? r.value.message : `❌ ${r.error.message}`;
    await ctx.api.editMessageText(ctx.chat.id, m.message_id, text).catch(() => {});
  });

  // ── Main: incoming text → parse → preview ─────────────────
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;          // commands handled above
    if (ctx.message.text.length < 10) return;              // ignore short msgs

    const result = await deps.ingest.execute({
      telegramId: BigInt(ctx.from.id),
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
      lastName: ctx.from.last_name ?? null,
      languageCode: ctx.from.language_code ?? null,
      chatId: BigInt(ctx.chat.id),
      chatType: ctx.chat.type,
      messageId: BigInt(ctx.message.message_id),
      topicId: ctx.message.message_thread_id ?? null,
      text: ctx.message.text,
      rawUpdate: ctx.update,
    });

    if (!result.ok) {
      log.warn({ err: result.error.message, code: result.error.code }, "ingest.failed");
      return; // silent for auth errors — don't reveal whitelist
    }
    if (!result.value) return; // not an order

    const { draft, parsed, isReady } = result.value;
    const kb = new InlineKeyboard();
    if (isReady) {
      kb.text("✅ Створити ТТН", `create:${draft.id}`).text("❌ Скасувати", `cancel:${draft.id}`);
    } else {
      kb.text("❌ Скасувати", `cancel:${draft.id}`);
    }

    await ctx.reply(renderPreview(parsed, isReady), {
      parse_mode: "HTML",
      reply_markup: kb,
      reply_parameters: { message_id: ctx.message.message_id },
      link_preview_options: { is_disabled: true },
    }).catch((e) => log.error({ err: String(e) }, "tg.reply_failed"));
  });

  // ── Edited messages — re-parse and update preview ─────────
  bot.on("edited_message:text", async (ctx) => {
    if (!ctx.editedMessage) return;
    const result = await deps.ingest.execute({
      telegramId: BigInt(ctx.from!.id),
      username: ctx.from!.username ?? null,
      firstName: ctx.from!.first_name ?? null,
      lastName: ctx.from!.last_name ?? null,
      languageCode: ctx.from!.language_code ?? null,
      chatId: BigInt(ctx.chat.id),
      chatType: ctx.chat.type,
      messageId: BigInt(ctx.editedMessage.message_id),
      text: ctx.editedMessage.text,
      rawUpdate: ctx.update,
    });
    if (!result.ok || !result.value) return;
    // Don't send new preview — would be spammy. Could update in-place if we tracked reply_id.
    log.info({ draftId: result.value.draft.id }, "draft.updated_from_edit");
  });

  // ── Callbacks ─────────────────────────────────────────────
  bot.callbackQuery(/^(create|cancel):(\d+)$/, async (ctx) => {
    const m = ctx.callbackQuery.data!.match(/^(create|cancel):(\d+)$/)!;
    const action = m[1] as "create" | "cancel";
    const draftId = BigInt(m[2]);

    const draft = await deps.draftRepo.findById(draftId);
    if (!draft) {
      await ctx.answerCallbackQuery({ text: "Чернетка прострочена. Надішли ще раз.", show_alert: true });
      return;
    }

    if (action === "cancel") {
      await deps.draftRepo.markCancelled(draft.id, "user_cancel");
      await ctx.editMessageText("❌ <i>Скасовано</i>", { parse_mode: "HTML" }).catch(() => {});
      await ctx.answerCallbackQuery();
      return;
    }

    // action === "create"
    await ctx.answerCallbackQuery({ text: "Створюю ТТН…" });
    await ctx.editMessageText(renderPreview({
      recipientName: draft.recipientName ?? undefined,
      recipientPhone: draft.recipientPhone ?? undefined,
      cityName: draft.cityName ?? undefined,
      warehouseType: draft.warehouseType === "POSTOMAT" ? "postomat" : draft.warehouseType === "COURIER" ? "courier" : "branch",
      warehouseNumber: draft.warehouseNumber ?? undefined,
      courierAddress: draft.courierAddress ?? undefined,
      cost: draft.cost ?? undefined,
      paymentMethod: draft.paymentMethod === "NON_CASH" ? "NonCash" : "Cash",
      payerType: draft.payerType === "SENDER" ? "Sender" : "Recipient",
      fieldStatus: (draft.fieldStatus as Record<string, "ok" | "missing" | "guessed">) ?? {},
      warnings: draft.warnings,
    }, true) + "\n\n⏳ <i>Створюю ТТН…</i>", { parse_mode: "HTML" }).catch(() => {});

    const result = await deps.createTtn.execute({ draftId: draft.id, actorUserId: BigInt(ctx.from.id) });

    if (!result.ok) {
      await ctx.editMessageText(renderError(result.error.message), { parse_mode: "HTML" }).catch(() => {});
      return;
    }

    const s = result.value;
    await ctx.editMessageText(renderSuccess({
      ttn: s.ttn,
      cost: s.costOnSite ?? s.cost,
      estimatedDelivery: s.estimatedDelivery ?? null,
      recipientName: s.recipientName,
      city: s.cityName,
      warehouse: s.warehouseType === "COURIER" ? `Кур'єр: ${s.courierAddress ?? "—"}` :
        `${s.warehouseType === "POSTOMAT" ? "Поштомат" : "Відділення"} №${s.warehouseNumber}`,
    }), { parse_mode: "HTML", link_preview_options: { is_disabled: true } }).catch(() => {});
  });

  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Невідома дія" });
  });
}
