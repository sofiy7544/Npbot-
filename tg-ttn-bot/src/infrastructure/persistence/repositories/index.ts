/**
 * Misc Prisma repos — smaller implementations grouped together.
 * Each follows the same pattern: ctor(PrismaClient), implements interface from application/ports/repositories.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AllowedChatRepository,
  AuditLogRepository,
  CustomerRepository,
  FailedRequestRepository,
  IncomingMessageRepository,
  NpCacheRepository,
} from "../../../application/ports/repositories.js";

export class PrismaCustomerRepo implements CustomerRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async upsertByPhone(input: { phone: string; fullName?: string | null; cityName?: string | null }): Promise<{ id: bigint }> {
    const c = await this.prisma.customer.upsert({
      where: { phone: input.phone },
      create: { phone: input.phone, fullName: input.fullName ?? null, cityName: input.cityName ?? null, lastOrderAt: new Date() },
      update: { fullName: input.fullName ?? undefined, cityName: input.cityName ?? undefined, lastOrderAt: new Date() },
    });
    return { id: c.id };
  }
  async incrementOrderStats(id: bigint, costUah: number): Promise<void> {
    await this.prisma.customer.update({ where: { id }, data: { totalOrders: { increment: 1 }, totalSpent: { increment: costUah } } });
  }
}

export class PrismaAllowedChatRepo implements AllowedChatRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async isAllowed(chatId: bigint): Promise<boolean> {
    const c = await this.prisma.allowedChat.findUnique({ where: { chatId } });
    return c?.isActive ?? false;
  }
  async add(chatId: bigint, chatType: string, title?: string | null, topicId?: number | null): Promise<void> {
    await this.prisma.allowedChat.upsert({
      where: { chatId },
      create: { chatId, chatType, title: title ?? null, topicId: topicId ?? null },
      update: { isActive: true, title: title ?? undefined },
    });
  }
  async remove(chatId: bigint): Promise<void> {
    await this.prisma.allowedChat.update({ where: { chatId }, data: { isActive: false } });
  }
  async list() {
    return (await this.prisma.allowedChat.findMany({ orderBy: { createdAt: "desc" } }))
      .map((c) => ({ chatId: c.chatId, chatType: c.chatType, title: c.title, isActive: c.isActive }));
  }
}

export class PrismaIncomingMessageRepo implements IncomingMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async record(input: { userId?: bigint | null; chatId: bigint; chatType: string; messageId: bigint; topicId?: number | null; text: string; hasMedia: boolean; isOrder: boolean; rawUpdate: unknown }) {
    try {
      const m = await this.prisma.incomingMessage.create({
        data: {
          userId: input.userId,
          chatId: input.chatId,
          chatType: input.chatType,
          messageId: input.messageId,
          topicId: input.topicId,
          text: input.text,
          hasMedia: input.hasMedia,
          isOrder: input.isOrder,
          rawUpdate: input.rawUpdate as Prisma.InputJsonValue,
        },
      });
      return { id: m.id, isFirstOccurrence: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existing = await this.prisma.incomingMessage.findUnique({
          where: { chatId_messageId: { chatId: input.chatId, messageId: input.messageId } },
        });
        return { id: existing!.id, isFirstOccurrence: false };
      }
      throw e;
    }
  }
}

export class PrismaAuditLogRepo implements AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async log(input: { actorId?: bigint | null; action: string; entityType: string; entityId?: bigint | null; before?: unknown; after?: unknown; ipAddress?: string; userAgent?: string }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before as Prisma.InputJsonValue | undefined,
        after: input.after as Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }
}

export class PrismaFailedRequestRepo implements FailedRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async log(input: { service: string; endpoint: string; request: unknown; response?: unknown; errorMessage: string; statusCode?: number | null; context?: Record<string, unknown> }): Promise<void> {
    await this.prisma.failedRequest.create({
      data: {
        service: input.service,
        endpoint: input.endpoint,
        request: input.request as Prisma.InputJsonValue,
        response: input.response as Prisma.InputJsonValue | undefined,
        errorMessage: input.errorMessage,
        statusCode: input.statusCode,
        context: (input.context ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}

export class PrismaNpCacheRepo implements NpCacheRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async get(cacheKey: string): Promise<unknown | null> {
    const e = await this.prisma.npCacheEntry.findUnique({ where: { cacheKey } });
    if (!e || e.expiresAt < new Date()) return null;
    await this.prisma.npCacheEntry.update({ where: { id: e.id }, data: { hitCount: { increment: 1 } } }).catch(() => {});
    return e.result;
  }
  async set(cacheKey: string, method: string, args: unknown, result: unknown, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.prisma.npCacheEntry.upsert({
      where: { cacheKey },
      create: { cacheKey, method, args: args as Prisma.InputJsonValue, result: result as Prisma.InputJsonValue, expiresAt },
      update: { result: result as Prisma.InputJsonValue, expiresAt, hitCount: 0 },
    });
  }
  async delete(cacheKey: string): Promise<void> {
    await this.prisma.npCacheEntry.delete({ where: { cacheKey } }).catch(() => {});
  }
  async sweepExpired(): Promise<number> {
    const { count } = await this.prisma.npCacheEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return count;
  }
}
