/**
 * IngestMessage — entry point for every incoming Telegram message.
 *
 * Flow:
 *   1. Authorize (user not blocked, chat allowed)
 *   2. Persist raw message (audit + dedup by chatId:messageId)
 *   3. Parse with NLP/regex engine
 *   4. If looks like order → create/replace draft
 *   5. Return draft + parsed result for handler to render preview
 *
 * Idempotency: re-processing the SAME (chatId, messageId) returns the existing draft
 * instead of creating duplicates. Telegram retries / network reconnects are safe.
 */
import { parseOrder, isDraftReady, type OrderDraft } from "../../infrastructure/parser/parser.js";
import type {
  AllowedChatRepository,
  DraftRepository,
  DraftRecord,
  IncomingMessageRepository,
  UserRepository,
} from "../ports/repositories.js";
import { type Result, ok, err, AppError } from "../../shared/result.js";
import { makeLogger } from "../../shared/logger.js";
import { loadConfig } from "../../shared/config.js";

const log = makeLogger("usecase.ingest");

export type IngestInput = {
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  chatId: bigint;
  chatType: string;
  messageId: bigint;
  topicId?: number | null;
  text: string;
  rawUpdate: unknown;
};

export type IngestOutput = {
  draft: DraftRecord;
  parsed: OrderDraft;
  isFirstOccurrence: boolean;
  isReady: boolean;
};

export class IngestMessageUseCase {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly draftRepo: DraftRepository,
    private readonly chatRepo: AllowedChatRepository,
    private readonly msgRepo: IncomingMessageRepository,
  ) {}

  async execute(input: IngestInput): Promise<Result<IngestOutput | null>> {
    const cfg = loadConfig();

    // ── 1. Authorize chat ──────────────────────────────────────
    const allowedIds = cfg.ALLOWED_CHAT_IDS;
    if (allowedIds.length > 0) {
      const isAllowed = await this.chatRepo.isAllowed(input.chatId);
      const inEnvList = allowedIds.includes(Number(input.chatId));
      if (!isAllowed && !inEnvList) {
        log.warn({ chatId: input.chatId }, "chat.not_allowed");
        return err(new AppError("auth.chat_not_allowed", "Chat not in whitelist", { chatId: input.chatId }));
      }
    }

    // ── 2. Upsert user ─────────────────────────────────────────
    const user = await this.userRepo.upsertOnFirstSeen({
      telegramId: input.telegramId,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      languageCode: input.languageCode,
    });
    if (user.isBlocked) {
      log.warn({ userId: user.id, telegramId: input.telegramId }, "user.blocked");
      return err(new AppError("auth.user_blocked", "User is blocked", { userId: user.id }));
    }
    // Fire-and-forget — don't block request on lastSeen update
    this.userRepo.touchLastSeen(user.id).catch((e) => log.warn({ err: e }, "user.touch_failed"));

    // ── 3. Record message (idempotent on chatId:messageId) ─────
    const recorded = await this.msgRepo.record({
      userId: user.id,
      chatId: input.chatId,
      chatType: input.chatType,
      messageId: input.messageId,
      topicId: input.topicId ?? null,
      text: input.text,
      hasMedia: false,
      isOrder: false, // will update via parsed result later
      rawUpdate: input.rawUpdate,
    });

    if (!recorded.isFirstOccurrence) {
      log.info({ chatId: input.chatId, messageId: input.messageId }, "msg.duplicate_skipped");
      // Idempotent: return existing draft if any
      const existing = await this.draftRepo.findActiveByMessage(input.chatId, input.messageId);
      if (existing) {
        return ok({
          draft: existing,
          parsed: this.draftToParsed(existing),
          isFirstOccurrence: false,
          isReady: this.isReady(existing),
        });
      }
      return ok(null);
    }

    // ── 4. Parse ───────────────────────────────────────────────
    const parsed = parseOrder(input.text);
    const looksLikeOrder = !!parsed.recipientPhone || (!!parsed.cityName && !!parsed.warehouseNumber);
    if (!looksLikeOrder) {
      log.info({ chatId: input.chatId, msgId: input.messageId }, "msg.not_an_order");
      return ok(null);
    }

    // ── 5. Create/replace draft ─────────────────────────────────
    const expiresAt = new Date(Date.now() + cfg.DRAFT_TTL_MS);
    const draft = await this.draftRepo.createOrReplace({
      userId: user.id,
      sourceChatId: input.chatId,
      sourceMessageId: input.messageId,
      sourceText: input.text,
      recipientName: parsed.recipientName ?? null,
      recipientPhone: parsed.recipientPhone ?? null,
      cityName: parsed.cityName ?? null,
      warehouseType:
        parsed.warehouseType === "postomat" ? "POSTOMAT" :
        parsed.warehouseType === "courier" ? "COURIER" : "BRANCH",
      warehouseNumber: parsed.warehouseNumber ?? null,
      courierAddress: parsed.courierAddress ?? null,
      cost: parsed.cost ?? null,
      weightKg: parsed.weightKg ?? null,
      description: parsed.description ?? null,
      paymentMethod: parsed.paymentMethod === "NonCash" ? "NON_CASH" : "CASH",
      payerType: parsed.payerType === "Sender" ? "SENDER" : "RECIPIENT",
      parseConfidence: computeConfidence(parsed),
      fieldStatus: parsed.fieldStatus,
      warnings: parsed.warnings,
      expiresAt,
    });

    log.info({ draftId: draft.id, userId: user.id, ready: isDraftReady(parsed), warnings: parsed.warnings.length }, "draft.created");

    return ok({
      draft,
      parsed,
      isFirstOccurrence: true,
      isReady: isDraftReady(parsed),
    });
  }

  private draftToParsed(d: DraftRecord): OrderDraft {
    return {
      recipientName: d.recipientName ?? undefined,
      recipientPhone: d.recipientPhone ?? undefined,
      cityName: d.cityName ?? undefined,
      warehouseType:
        d.warehouseType === "POSTOMAT" ? "postomat" :
        d.warehouseType === "COURIER" ? "courier" : "branch",
      warehouseNumber: d.warehouseNumber ?? undefined,
      courierAddress: d.courierAddress ?? undefined,
      cost: d.cost ?? undefined,
      weightKg: d.weightKg ?? undefined,
      description: d.description ?? undefined,
      paymentMethod: d.paymentMethod === "NON_CASH" ? "NonCash" : "Cash",
      payerType: d.payerType === "SENDER" ? "Sender" : "Recipient",
      fieldStatus: d.fieldStatus as OrderDraft["fieldStatus"],
      warnings: d.warnings,
    };
  }

  private isReady(d: DraftRecord): boolean {
    return !!d.recipientName && !!d.recipientPhone && !!d.cityName &&
      (d.warehouseType === "COURIER" ? !!d.courierAddress : !!d.warehouseNumber);
  }
}

/** Aggregate confidence 0..1 from field statuses. */
function computeConfidence(d: OrderDraft): number {
  const required = ["name", "phone", "city", "warehouse"] as const;
  let score = 0;
  for (const f of required) {
    const status = d.fieldStatus[f];
    if (status === "ok") score += 0.25;
    else if (status === "guessed") score += 0.125;
  }
  return Math.round(score * 100) / 100;
}
