/**
 * Repository interfaces — pure abstractions, no Prisma here.
 *
 * Infrastructure layer (src/infrastructure/persistence/repositories) implements these
 * with concrete Prisma. Use cases depend on these interfaces, not on Prisma directly.
 *
 * Benefits:
 *   - Swap Prisma for Drizzle without touching business logic
 *   - Mock in tests trivially
 *   - Clear data-access boundary
 */
import type { DraftStatus, PaymentMethod, PayerType, ShipmentStatus, UserRole, WarehouseType } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────
// DTOs (data transfer objects between layers — Prisma types leak no further)
// ─────────────────────────────────────────────────────────────────────

export type UserRecord = {
  id: bigint;
  telegramId: bigint;
  username: string | null;
  role: UserRole;
  isActive: boolean;
  isBlocked: boolean;
  lastSeenAt: Date | null;
};

export type CreateDraftInput = {
  userId: bigint;
  sourceChatId: bigint;
  sourceMessageId: bigint;
  sourceText: string;
  replyMessageId?: bigint | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  cityName?: string | null;
  warehouseType: WarehouseType;
  warehouseNumber?: string | null;
  courierAddress?: string | null;
  cost?: number | null;
  weightKg?: number | null;
  description?: string | null;
  paymentMethod: PaymentMethod;
  payerType: PayerType;
  parseConfidence?: number | null;
  fieldStatus: Record<string, string>;
  warnings: string[];
  expiresAt: Date;
};

export type DraftRecord = CreateDraftInput & {
  id: bigint;
  status: DraftStatus;
  errorReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
};

export type CreateShipmentInput = {
  draftId: bigint | null;
  userId: bigint;
  customerId?: bigint | null;
  idempotencyKey: string;
  ttn: string;
  ttnRef?: string | null;
  estimatedDelivery?: Date | null;
  costOnSite?: number | null;
  pdfMarkingUrl?: string | null;
  recipientName: string;
  recipientPhone: string;
  cityName: string;
  cityRef: string;
  warehouseType: WarehouseType;
  warehouseNumber?: string | null;
  warehouseRef?: string | null;
  courierAddress?: string | null;
  cost: number;
  weightKg: number;
  description: string;
  paymentMethod: PaymentMethod;
  payerType: PayerType;
  rawNpResponse: unknown;
};

export type ShipmentRecord = CreateShipmentInput & {
  id: bigint;
  status: ShipmentStatus;
  statusUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

// ─────────────────────────────────────────────────────────────────────
// Repository interfaces
// ─────────────────────────────────────────────────────────────────────

export interface UserRepository {
  findByTelegramId(telegramId: bigint): Promise<UserRecord | null>;
  upsertOnFirstSeen(input: {
    telegramId: bigint;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    languageCode?: string | null;
  }): Promise<UserRecord>;
  touchLastSeen(id: bigint): Promise<void>;
  setRole(id: bigint, role: UserRole): Promise<void>;
  setBlocked(id: bigint, blocked: boolean): Promise<void>;
}

export interface DraftRepository {
  /** Create draft. Idempotent on (sourceChatId, sourceMessageId). */
  createOrReplace(input: CreateDraftInput): Promise<DraftRecord>;
  findById(id: bigint): Promise<DraftRecord | null>;
  findActiveByMessage(chatId: bigint, messageId: bigint): Promise<DraftRecord | null>;
  markConfirmed(id: bigint): Promise<void>;
  markCancelled(id: bigint, reason?: string): Promise<void>;
  markTtnCreated(id: bigint): Promise<void>;
  markTtnFailed(id: bigint, errorReason: string): Promise<void>;
  sweepExpired(now: Date, limit: number): Promise<number>;
}

export interface ShipmentRepository {
  /** Atomic create — fails with `db.unique_violation` if idempotencyKey clashes. */
  create(input: CreateShipmentInput): Promise<ShipmentRecord>;
  findByIdempotencyKey(key: string): Promise<ShipmentRecord | null>;
  findById(id: bigint): Promise<ShipmentRecord | null>;
  findByTtn(ttn: string): Promise<ShipmentRecord | null>;
  list(opts: {
    userId?: bigint;
    status?: ShipmentStatus;
    fromDate?: Date;
    toDate?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: ShipmentRecord[]; total: number }>;
  updateStatus(id: bigint, status: ShipmentStatus): Promise<void>;
  softDelete(id: bigint): Promise<void>;
}

export interface CustomerRepository {
  upsertByPhone(input: {
    phone: string;
    fullName?: string | null;
    cityName?: string | null;
  }): Promise<{ id: bigint }>;
  incrementOrderStats(id: bigint, costUah: number): Promise<void>;
}

export interface AllowedChatRepository {
  isAllowed(chatId: bigint): Promise<boolean>;
  add(chatId: bigint, chatType: string, title?: string | null, topicId?: number | null): Promise<void>;
  remove(chatId: bigint): Promise<void>;
  list(): Promise<Array<{ chatId: bigint; chatType: string; title: string | null; isActive: boolean }>>;
}

export interface IncomingMessageRepository {
  /** Idempotent on (chatId, messageId). */
  record(input: {
    userId?: bigint | null;
    chatId: bigint;
    chatType: string;
    messageId: bigint;
    topicId?: number | null;
    text: string;
    hasMedia: boolean;
    isOrder: boolean;
    rawUpdate: unknown;
  }): Promise<{ id: bigint; isFirstOccurrence: boolean }>;
}

export interface AuditLogRepository {
  log(input: {
    actorId?: bigint | null;
    action: string;
    entityType: string;
    entityId?: bigint | null;
    before?: unknown;
    after?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void>;
}

export interface FailedRequestRepository {
  log(input: {
    service: string;
    endpoint: string;
    request: unknown;
    response?: unknown;
    errorMessage: string;
    statusCode?: number | null;
    context?: Record<string, unknown>;
  }): Promise<void>;
}

export interface NpCacheRepository {
  get(cacheKey: string): Promise<unknown | null>;
  set(cacheKey: string, method: string, args: unknown, result: unknown, ttlSeconds: number): Promise<void>;
  delete(cacheKey: string): Promise<void>;
  sweepExpired(): Promise<number>;
}
