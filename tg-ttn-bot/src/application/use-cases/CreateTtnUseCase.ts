/**
 * CreateTtn — confirm a draft and issue a real (or mock) Nova Poshta waybill.
 *
 * CRITICAL: idempotent on idempotencyKey = sha256(chatId:messageId:userId).
 * If this UC is called twice (Telegram retry, BullMQ retry, user double-click),
 * it returns the EXISTING shipment instead of creating a duplicate TTN.
 *
 * Flow:
 *   1. Load draft, validate isReady
 *   2. Check idempotency table — if shipment exists, return it
 *   3. NP: findCity → findWarehouse
 *   4. NP: createInternetDocument
 *   5. Persist Shipment (atomic insert with idempotencyKey unique constraint)
 *   6. Mark draft TTN_CREATED, increment customer stats
 *   7. Return shipment
 *
 * Failures: every NP error is logged to FailedRequest + audit log + draft.errorReason.
 */
import { createHash } from "node:crypto";
import type {
  CustomerRepository,
  DraftRepository,
  FailedRequestRepository,
  ShipmentRecord,
  ShipmentRepository,
} from "../ports/repositories.js";
import type { NovaPoshtaClient } from "../ports/nova-poshta.js";
import { type Result, ok, err, AppError } from "../../shared/result.js";
import { makeLogger } from "../../shared/logger.js";
import { loadConfig } from "../../shared/config.js";
import { Phone } from "../../domain/value-objects/Phone.js";

const log = makeLogger("usecase.createTtn");

export type CreateTtnInput = {
  draftId: bigint;
  actorUserId: bigint;       // who confirmed
};

export class CreateTtnUseCase {
  constructor(
    private readonly draftRepo: DraftRepository,
    private readonly shipmentRepo: ShipmentRepository,
    private readonly customerRepo: CustomerRepository,
    private readonly failedReqRepo: FailedRequestRepository,
    private readonly np: NovaPoshtaClient,
  ) {}

  async execute(input: CreateTtnInput): Promise<Result<ShipmentRecord>> {
    const cfg = loadConfig();

    // ── 1. Load draft ──────────────────────────────────────────
    const draft = await this.draftRepo.findById(input.draftId);
    if (!draft) {
      return err(new AppError("db.not_found", "Draft not found or expired", { draftId: input.draftId }));
    }
    if (draft.status === "TTN_CREATED") {
      // Already created — find existing shipment by idempotency key and return
      const idempotencyKey = this.makeIdempotencyKey(draft.sourceChatId, draft.sourceMessageId, draft.userId);
      const existing = await this.shipmentRepo.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        log.info({ draftId: draft.id, ttn: existing.ttn }, "ttn.already_created.idempotent");
        return ok(existing);
      }
    }

    // ── 2. Validate completeness ───────────────────────────────
    if (!draft.recipientName || !draft.recipientPhone || !draft.cityName) {
      return err(new AppError(
        "parser.incomplete_draft",
        "Required fields missing",
        { draftId: draft.id, missing: { name: !draft.recipientName, phone: !draft.recipientPhone, city: !draft.cityName } },
      ));
    }

    let phone: Phone;
    try {
      phone = Phone.parse(draft.recipientPhone);
    } catch (e) {
      return err(e as AppError);
    }

    // ── 3. Pre-check idempotency (cheaper than waiting for unique-constraint exception) ──
    const idempotencyKey = this.makeIdempotencyKey(draft.sourceChatId, draft.sourceMessageId, draft.userId);
    const existing = await this.shipmentRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      log.info({ draftId: draft.id, ttn: existing.ttn }, "ttn.idempotent_replay");
      if (draft.status !== "TTN_CREATED") {
        await this.draftRepo.markTtnCreated(draft.id);
      }
      return ok(existing);
    }

    // ── 4. NP: resolve city ────────────────────────────────────
    const cityResult = await this.np.findCity(draft.cityName);
    if (!cityResult.ok) {
      await this.draftRepo.markTtnFailed(draft.id, cityResult.error.message);
      return err(cityResult.error);
    }
    if (!cityResult.value) {
      const error = new AppError("np.city_not_found", `City "${draft.cityName}" not found in NP`, { cityName: draft.cityName });
      await this.draftRepo.markTtnFailed(draft.id, error.message);
      return err(error);
    }
    const city = cityResult.value;

    // ── 5. NP: resolve warehouse (if not courier) ──────────────
    let warehouseRef: string | undefined;
    let courierAddress: string | undefined;
    if (draft.warehouseType === "COURIER") {
      if (!draft.courierAddress) {
        return err(new AppError("parser.incomplete_draft", "Courier requires address", { draftId: draft.id }));
      }
      courierAddress = draft.courierAddress;
    } else {
      if (!draft.warehouseNumber) {
        return err(new AppError("parser.incomplete_draft", "Warehouse number required", { draftId: draft.id }));
      }
      const whResult = await this.np.findWarehouse({
        cityRef: city.ref,
        number: draft.warehouseNumber,
        isPostomat: draft.warehouseType === "POSTOMAT",
      });
      if (!whResult.ok) {
        await this.draftRepo.markTtnFailed(draft.id, whResult.error.message);
        return err(whResult.error);
      }
      if (!whResult.value) {
        const error = new AppError(
          "np.warehouse_not_found",
          `${draft.warehouseType === "POSTOMAT" ? "Поштомат" : "Відділення"} №${draft.warehouseNumber} not found in ${city.description}`,
          { cityRef: city.ref, number: draft.warehouseNumber },
        );
        await this.draftRepo.markTtnFailed(draft.id, error.message);
        return err(error);
      }
      warehouseRef = whResult.value.ref;
    }

    // ── 6. Create TTN via NP ───────────────────────────────────
    const cost = draft.cost ?? 1;
    const weight = draft.weightKg ?? cfg.NP_DEFAULT_WEIGHT_KG;
    const description = (draft.description ?? cfg.NP_DEFAULT_DESCRIPTION).slice(0, 100);

    const ttnResult = await this.np.createTtn({
      recipientName: draft.recipientName,
      recipientPhone: phone.value,
      cityRecipientRef: city.ref,
      warehouseRecipientRef: warehouseRef,
      courierAddress,
      weightKg: Number(weight),
      volumeM3: cfg.NP_DEFAULT_VOLUME_M3,
      cost,
      description,
      serviceType: draft.warehouseType === "COURIER" ? "DoorsDoors" : cfg.NP_DEFAULT_SERVICE_TYPE,
      paymentMethod: draft.paymentMethod === "NON_CASH" ? "NonCash" : "Cash",
      payerType: draft.payerType === "SENDER" ? "Sender" : "Recipient",
    });

    if (!ttnResult.ok) {
      await this.failedReqRepo.log({
        service: "nova_poshta",
        endpoint: "InternetDocument.save",
        request: { draftId: draft.id.toString(), cityRef: city.ref, warehouseRef, cost, weight },
        errorMessage: ttnResult.error.message,
        context: { draftId: draft.id.toString(), userId: draft.userId.toString() },
      });
      await this.draftRepo.markTtnFailed(draft.id, ttnResult.error.message);
      return err(ttnResult.error);
    }

    // ── 7. Upsert customer (for repeat-order analytics) ────────
    const customer = await this.customerRepo.upsertByPhone({
      phone: phone.value,
      fullName: draft.recipientName,
      cityName: city.description,
    });

    // ── 8. Persist shipment (atomic on idempotencyKey) ─────────
    let shipment: ShipmentRecord;
    try {
      shipment = await this.shipmentRepo.create({
        draftId: draft.id,
        userId: draft.userId,
        customerId: customer.id,
        idempotencyKey,
        ttn: ttnResult.value.ttn,
        ttnRef: ttnResult.value.ref,
        estimatedDelivery: ttnResult.value.estimatedDelivery,
        costOnSite: ttnResult.value.costOnSite,
        recipientName: draft.recipientName,
        recipientPhone: phone.value,
        cityName: city.description,
        cityRef: city.ref,
        warehouseType: draft.warehouseType,
        warehouseNumber: draft.warehouseNumber,
        warehouseRef,
        courierAddress,
        cost,
        weightKg: Number(weight),
        description,
        paymentMethod: draft.paymentMethod,
        payerType: draft.payerType,
        rawNpResponse: ttnResult.value.rawResponse,
      });
    } catch (e) {
      // Unique-constraint violation = race condition (two workers picked the same job)
      if (e instanceof AppError && e.code === "db.unique_violation") {
        const winner = await this.shipmentRepo.findByIdempotencyKey(idempotencyKey);
        if (winner) {
          log.warn({ draftId: draft.id, ttn: winner.ttn }, "ttn.race_resolved");
          return ok(winner);
        }
      }
      throw e;
    }

    await this.customerRepo.incrementOrderStats(customer.id, cost);
    await this.draftRepo.markTtnCreated(draft.id);

    log.info({ shipmentId: shipment.id, ttn: shipment.ttn, cost }, "ttn.created");
    return ok(shipment);
  }

  private makeIdempotencyKey(chatId: bigint, messageId: bigint, userId: bigint): string {
    return createHash("sha256")
      .update(`${chatId}:${messageId}:${userId}`)
      .digest("hex");
  }
}
