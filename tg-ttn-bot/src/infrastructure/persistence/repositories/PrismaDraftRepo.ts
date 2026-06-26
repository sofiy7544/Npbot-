import type { PrismaClient } from "@prisma/client";
import type { CreateDraftInput, DraftRecord, DraftRepository } from "../../../application/ports/repositories.js";

export class PrismaDraftRepo implements DraftRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createOrReplace(input: CreateDraftInput): Promise<DraftRecord> {
    const d = await this.prisma.shipmentDraft.upsert({
      where: { sourceChatId_sourceMessageId: { sourceChatId: input.sourceChatId, sourceMessageId: input.sourceMessageId } },
      create: {
        userId: input.userId,
        sourceChatId: input.sourceChatId,
        sourceMessageId: input.sourceMessageId,
        sourceText: input.sourceText,
        replyMessageId: input.replyMessageId ?? null,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        cityName: input.cityName,
        warehouseType: input.warehouseType,
        warehouseNumber: input.warehouseNumber,
        courierAddress: input.courierAddress,
        cost: input.cost,
        weightKg: input.weightKg as unknown as number | undefined,
        description: input.description,
        paymentMethod: input.paymentMethod,
        payerType: input.payerType,
        parseConfidence: input.parseConfidence,
        fieldStatus: input.fieldStatus,
        warnings: input.warnings,
        expiresAt: input.expiresAt,
      },
      update: {
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        cityName: input.cityName,
        warehouseType: input.warehouseType,
        warehouseNumber: input.warehouseNumber,
        courierAddress: input.courierAddress,
        cost: input.cost,
        weightKg: input.weightKg as unknown as number | undefined,
        description: input.description,
        paymentMethod: input.paymentMethod,
        payerType: input.payerType,
        parseConfidence: input.parseConfidence,
        fieldStatus: input.fieldStatus,
        warnings: input.warnings,
        expiresAt: input.expiresAt,
        status: "PENDING",
        errorReason: null,
      },
    });
    return this.toRecord(d);
  }

  async findById(id: bigint): Promise<DraftRecord | null> {
    const d = await this.prisma.shipmentDraft.findUnique({ where: { id } });
    return d ? this.toRecord(d) : null;
  }

  async findActiveByMessage(chatId: bigint, messageId: bigint): Promise<DraftRecord | null> {
    const d = await this.prisma.shipmentDraft.findUnique({
      where: { sourceChatId_sourceMessageId: { sourceChatId: chatId, sourceMessageId: messageId } },
    });
    return d ? this.toRecord(d) : null;
  }

  async markConfirmed(id: bigint): Promise<void> {
    await this.prisma.shipmentDraft.update({
      where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
  }
  async markCancelled(id: bigint, reason?: string): Promise<void> {
    await this.prisma.shipmentDraft.update({ where: { id }, data: { status: "CANCELLED", errorReason: reason ?? null } });
  }
  async markTtnCreated(id: bigint): Promise<void> {
    await this.prisma.shipmentDraft.update({ where: { id }, data: { status: "TTN_CREATED" } });
  }
  async markTtnFailed(id: bigint, errorReason: string): Promise<void> {
    await this.prisma.shipmentDraft.update({ where: { id }, data: { status: "TTN_FAILED", errorReason } });
  }
  async sweepExpired(now: Date, limit: number): Promise<number> {
    const { count } = await this.prisma.shipmentDraft.updateMany({
      where: { status: "PENDING", expiresAt: { lt: now } },
      data: { status: "CANCELLED", errorReason: "expired" },
    });
    return count;
  }

  private toRecord(d: { id: bigint; userId: bigint; sourceChatId: bigint; sourceMessageId: bigint; sourceText: string; replyMessageId: bigint | null; recipientName: string | null; recipientPhone: string | null; cityName: string | null; warehouseType: DraftRecord["warehouseType"]; warehouseNumber: string | null; courierAddress: string | null; cost: number | null; weightKg: unknown; description: string | null; paymentMethod: DraftRecord["paymentMethod"]; payerType: DraftRecord["payerType"]; parseConfidence: number | null; fieldStatus: unknown; warnings: string[]; status: DraftRecord["status"]; errorReason: string | null; createdAt: Date; updatedAt: Date; expiresAt: Date; confirmedAt: Date | null }): DraftRecord {
    return {
      id: d.id,
      userId: d.userId,
      sourceChatId: d.sourceChatId,
      sourceMessageId: d.sourceMessageId,
      sourceText: d.sourceText,
      replyMessageId: d.replyMessageId,
      recipientName: d.recipientName,
      recipientPhone: d.recipientPhone,
      cityName: d.cityName,
      warehouseType: d.warehouseType,
      warehouseNumber: d.warehouseNumber,
      courierAddress: d.courierAddress,
      cost: d.cost,
      weightKg: d.weightKg as number | null,
      description: d.description,
      paymentMethod: d.paymentMethod,
      payerType: d.payerType,
      parseConfidence: d.parseConfidence,
      fieldStatus: (d.fieldStatus as Record<string, string>) ?? {},
      warnings: d.warnings,
      status: d.status,
      errorReason: d.errorReason,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      expiresAt: d.expiresAt,
      confirmedAt: d.confirmedAt,
    };
  }
}
