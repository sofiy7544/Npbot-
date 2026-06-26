/**
 * Minimal Nova Poshta API client.
 * Docs: https://developers.novaposhta.ua/
 *
 * If NP_API_KEY missing OR NP_MOCK_MODE=true → returns mock data (see np-mock.ts).
 * That lets you test the bot's full flow without hitting real NP API.
 */
import { isMockMode, mockFindCity, mockFindWarehouse, mockCreateTtn, mockTestApiKey } from "./np-mock.js";

const NP_URL = "https://api.novaposhta.ua/v2.0/json/";

type NPRequest = {
  apiKey: string;
  modelName: string;
  calledMethod: string;
  methodProperties?: Record<string, unknown>;
};

type NPResponse<T> = {
  success: boolean;
  data: T[];
  errors: string[];
  warnings: string[];
};

async function call<T>(modelName: string, method: string, props: Record<string, unknown> = {}): Promise<NPResponse<T>> {
  const apiKey = process.env.NP_API_KEY;
  if (!apiKey) {
    return { success: false, data: [], errors: ["NP_API_KEY not set"], warnings: [] };
  }
  const body: NPRequest = { apiKey, modelName, calledMethod: method, methodProperties: props };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(NP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return { success: false, data: [], errors: [`HTTP ${r.status}`], warnings: [] };
    return (await r.json()) as NPResponse<T>;
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: [], errors: [`Network: ${msg}`], warnings: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type NPCity = { Ref: string; Description: string; AreaDescription: string };
export type NPWarehouse = {
  Ref: string;
  Number: string;
  Description: string;
  ShortAddress: string;
  TypeOfWarehouse: string;
};

export type NPCreateDocResult = {
  Ref: string;
  CostOnSite: number;
  EstimatedDeliveryDate: string;
  IntDocNumber: string;
  TypeDocument: string;
};

export const POSTOMAT_TYPE_REF = "f9316480-5f2d-425d-bc2c-ac7cd29decf0";
export const BRANCH_TYPE_REF = "841339c7-591a-42e2-8233-7a0a00f0ed6f";

// ─────────────────────────────────────────────────────────────────────
// Public functions
// ─────────────────────────────────────────────────────────────────────

export async function findCity(query: string): Promise<NPCity | null> {
  if (isMockMode()) return mockFindCity(query);
  const r = await call<NPCity>("Address", "getCities", { FindByString: query, Limit: "5" });
  if (!r.success || !r.data.length) return null;
  const exact = r.data.find((c) => c.Description.toLowerCase() === query.toLowerCase());
  return exact ?? r.data[0];
}

export async function findWarehouse(opts: {
  cityRef: string;
  number: string;
  type: "branch" | "postomat";
}): Promise<NPWarehouse | null> {
  if (isMockMode()) return mockFindWarehouse(opts);
  const typeRef = opts.type === "postomat" ? POSTOMAT_TYPE_REF : BRANCH_TYPE_REF;
  const r = await call<NPWarehouse>("Address", "getWarehouses", {
    CityRef: opts.cityRef,
    TypeOfWarehouseRef: typeRef,
    Limit: "200",
  });
  if (!r.success) return null;
  return r.data.find((w) => w.Number === opts.number) ?? null;
}

export type CreateTtnInput = {
  recipientName: string;        // Full name "Last First [Middle]"
  recipientPhone: string;       // +380XXXXXXXXX or 0XXXXXXXXX (will normalize)
  cityRecipientRef: string;
  warehouseRecipientRef?: string;
  courierAddress?: string;      // when no warehouse (DoorsDoors)
  weight: number;               // kg
  cost: number;                 // UAH
  description: string;
  serviceType?: "WarehouseWarehouse" | "WarehouseDoors" | "DoorsDoors";
  paymentMethod?: "Cash" | "NonCash";
  payerType?: "Sender" | "Recipient";
};

export async function createTtn(input: CreateTtnInput): Promise<{ ok: true; data: NPCreateDocResult } | { ok: false; error: string }> {
  if (isMockMode()) return mockCreateTtn(input);

  const senderCityRef = process.env.NP_SENDER_CITY_REF;
  const senderWarehouseRef = process.env.NP_SENDER_WAREHOUSE_REF;
  const senderRef = process.env.NP_SENDER_REF;
  const senderContactRef = process.env.NP_SENDER_CONTACT_REF;
  const senderPhone = process.env.NP_SENDER_PHONE;

  if (!senderCityRef || !senderRef || !senderContactRef || !senderPhone) {
    return { ok: false, error: "Sender details not configured (.env)" };
  }

  // Split name
  const parts = input.recipientName.trim().split(/\s+/);
  let firstName = parts[0] ?? "";
  let lastName = parts.slice(1).join(" ");
  if (parts.length === 1) {
    // Single word → treat as last name
    lastName = parts[0];
    firstName = "Клієнт";
  } else if (parts.length === 2) {
    // "Last First" (UA convention) or "First Last"?
    // UA convention "Прізвище Ім'я" → first word is last name
    lastName = parts[0];
    firstName = parts[1];
  } else {
    // 3+ words: "Last First Middle" → first word is last name
    lastName = parts[0];
    firstName = parts.slice(1).join(" ");
  }

  const props: Record<string, unknown> = {
    PayerType: input.payerType ?? process.env.NP_DEFAULT_PAYER ?? "Recipient",
    PaymentMethod: input.paymentMethod ?? process.env.NP_DEFAULT_PAYMENT_METHOD ?? "Cash",
    DateTime: new Date().toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }),
    // CargoType=Cargo — universal across all SDKs (PHP lis-dev, Go platx). Was "Parcel" — works
    // but "Cargo" is the documented default for parcel deliveries.
    CargoType: "Cargo",
    Weight: String(input.weight),
    ServiceType: input.serviceType ?? "WarehouseWarehouse",
    SeatsAmount: "1",
    Description: input.description.slice(0, 100),
    Cost: String(input.cost),
    // VolumeGeneral in m³ — required when CargoType=Cargo per lis-dev/nova-poshta-api-2 tests.
    // Default 0.0004 m³ ≈ 8×8×18 cm (термокухоль). Override via env NP_DEFAULT_VOLUME_M3.
    VolumeGeneral: process.env.NP_DEFAULT_VOLUME_M3 ?? "0.0004",

    CitySender: senderCityRef,
    Sender: senderRef,
    SenderAddress: senderWarehouseRef ?? "",
    ContactSender: senderContactRef,
    SendersPhone: senderPhone.replace(/\D/g, ""),

    CityRecipient: input.cityRecipientRef,
    RecipientAddress: input.warehouseRecipientRef ?? "",
    RecipientsPhone: input.recipientPhone.replace(/\D/g, ""),
    NewAddress: "1",
    RecipientName: firstName,
    LastName: lastName,
    RecipientType: "PrivatePerson",
    SettlementType: "",
    OwnershipForm: "",
    EDRPOU: "",
    RecipientCityName: "",
    RecipientArea: "",
    RecipientAreaRegions: "",
    RecipientAddressName: "",
    RecipientHouse: "",
    RecipientFlat: "",
  };

  const r = await call<NPCreateDocResult>("InternetDocument", "save", props);
  if (r.success && r.data[0]) {
    return { ok: true, data: r.data[0] };
  }
  return { ok: false, error: r.errors.join("; ") || r.warnings.join("; ") || "Unknown NP error" };
}

/** Quick connectivity test — useful for /test command. */
export async function testApiKey(): Promise<{ ok: boolean; message: string }> {
  if (isMockMode()) return mockTestApiKey();
  const r = await call<NPCity>("Address", "getCities", { FindByString: "Київ", Limit: "1" });
  if (r.success && r.data.length > 0) {
    return { ok: true, message: `✅ Ключ працює. Знайшли: ${r.data[0].Description}` };
  }
  if (r.errors.length > 0) return { ok: false, message: `❌ ${r.errors.join(", ")}` };
  return { ok: false, message: "❌ Не вдалося перевірити ключ" };
}

/** Re-export for handlers/index.ts to print mode at startup. */
export { isMockMode } from "./np-mock.js";
