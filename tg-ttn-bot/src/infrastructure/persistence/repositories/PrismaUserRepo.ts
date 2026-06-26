import type { PrismaClient } from "@prisma/client";
import type { UserRecord, UserRepository } from "../../../application/ports/repositories.js";

export class PrismaUserRepo implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByTelegramId(telegramId: bigint): Promise<UserRecord | null> {
    const u = await this.prisma.user.findUnique({ where: { telegramId } });
    return u ? this.toRecord(u) : null;
  }

  async upsertOnFirstSeen(input: {
    telegramId: bigint; username?: string | null; firstName?: string | null; lastName?: string | null; languageCode?: string | null;
  }): Promise<UserRecord> {
    const u = await this.prisma.user.upsert({
      where: { telegramId: input.telegramId },
      create: {
        telegramId: input.telegramId,
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        languageCode: input.languageCode ?? null,
        lastSeenAt: new Date(),
      },
      update: {
        username: input.username ?? undefined,
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined,
      },
    });
    return this.toRecord(u);
  }

  async touchLastSeen(id: bigint): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  async setRole(id: bigint, role: UserRecord["role"]): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { role } });
  }

  async setBlocked(id: bigint, blocked: boolean): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { isBlocked: blocked } });
  }

  private toRecord(u: { id: bigint; telegramId: bigint; username: string | null; role: UserRecord["role"]; isActive: boolean; isBlocked: boolean; lastSeenAt: Date | null }): UserRecord {
    return {
      id: u.id,
      telegramId: u.telegramId,
      username: u.username,
      role: u.role,
      isActive: u.isActive,
      isBlocked: u.isBlocked,
      lastSeenAt: u.lastSeenAt,
    };
  }
}
