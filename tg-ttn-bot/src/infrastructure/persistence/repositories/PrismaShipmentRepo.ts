import { Prisma, type PrismaClient } from "@prisma/client";
import type { CreateShipmentInput, ShipmentRecord, ShipmentRepository } from "../../../application/ports/repositories.js";
import { AppError } from "../../../shared/result.js";

export class PrismaShipmentRepo implements ShipmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateShipmentInput): Promise<ShipmentRecord> {
    try {
      const s = await this.prisma.shipment.create({
        data: {
          draftId: input.draftId,
          userId: input.userId,
          customerId: input.customerId,
          idempotencyKey: input.idempotencyKey,
          ttn: input.ttn,
          ttnRef: input.ttnRef,
          estimatedDelivery: input.estimatedDelivery,
          costOnSite: input.costOnSite,
          pdfMarkingUrl: input.pdfMarkingUrl,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          cityName: input.cityName,
          cityRef: input.cityRef,
          warehouseType: input.warehouseType,
          warehouseNumber: input.warehouseNumber,
          warehouseRef: input.warehouseRef,
          courierAddress: input.courierAddress,
          cost: input.cost,
          weightKg: input.weightKg,
          description: input.description,
          paymentMethod: input.paymentMethod,
          payerType: input.payerType,
          rawNpResponse: input.rawNpResponse as Prisma.InputJsonValue,
        },
      });
      return this.toRecord(s);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new AppError("db.unique_violation", "Shipment with this idempotencyKey already exists", { key: input.idempotencyKey });
      }
      throw e;
    }
  }

  async findByIdempotencyKey(key: string): Promise<ShipmentRecord | null> {
    const s = await this.prisma.shipment.findUnique({ where: { idempotencyKey: key } });
    return s ? this.toRecord(s) : null;
  }

  async findById(id: bigint): Promise<ShipmentRecord | null> {
    const s = await this.prisma.shipment.findUnique({ where: { id } });
    return s ? this.toRecord(s) : null;
  }

  async findByTtn(ttn: string): Promise<ShipmentRecord | null> {
    const s = await this.prisma.shipment.findUnique({ where: { ttn } });
    return s ? this.toRecord(s) : null;
  }

  async list(opts: { userId?: bigint; status?: ShipmentRecord["status"]; fromDate?: Date; toDate?: Date; limit: number; offset: number }) {
    const where: Prisma.ShipmentWhereInput = {
      deletedAt: null,
      ...(opts.userId !== undefined && { userId: opts.userId }),
      ...(opts.status !== undefined && { status: opts.status }),
      ...((opts.fromDate || opts.toDate) && {
        createdAt: { ...(opts.fromDate && { gte: opts.fromDate }), ...(opts.toDate && { lte: opts.toDate }) },
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.shipment.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit, skip: opts.offset }),
      this.prisma.shipment.count({ where }),
    ]);
    return { items: items.map((s) => this.toRecord(s)), total };
  }

  async updateStatus(id: bigint, status: ShipmentRecord["status"]): Promise<void> {
    await this.prisma.shipment.update({ where: { id }, data: { status, statusUpdatedAt: new Date() } });
  }

  async softDelete(id: bigint): Promise<void> {
    await this.prisma.shipment.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private toRecord(s: Awaited<ReturnType<PrismaClient["shipment"]["findUnique"]>> & object): ShipmentRecord {
    return s as unknown as ShipmentRecord;
  }
}
