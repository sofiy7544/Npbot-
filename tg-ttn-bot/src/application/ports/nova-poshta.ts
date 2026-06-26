/**
 * Nova Poshta API port — interface defining what use-cases need.
 * Concrete implementations: HTTP client (production) + MockClient (testing).
 */
import type { Result } from "../../shared/result.js";

export type NpCity = {
  ref: string;            // UUID
  description: string;    // "Київ"
  descriptionRu: string;
  area: string;
  areaRef: string;
};

export type NpWarehouse = {
  ref: string;
  number: string;
  description: string;
  shortAddress: string;
  cityRef: string;
  typeOfWarehouseRef: string;
  isPostomat: boolean;
};

export type CreateTtnInput = {
  // Recipient
  recipientName: string;
  recipientPhone: string;       // E.164 +380XXXXXXXXX
  cityRecipientRef: string;
  warehouseRecipientRef?: string;
  courierAddress?: string;

  // Package
  weightKg: number;
  volumeM3?: number;
  cost: number;                 // UAH
  description: string;

  // Service
  serviceType: "WarehouseWarehouse" | "WarehouseDoors" | "DoorsDoors" | "DoorsWarehouse";
  paymentMethod: "Cash" | "NonCash";
  payerType: "Sender" | "Recipient";
};

export type CreateTtnOutput = {
  ttn: string;                  // "20450123456789"
  ref: string;                  // NP internal UUID
  costOnSite: number;           // UAH
  estimatedDelivery: Date;
  rawResponse: unknown;
};

export interface NovaPoshtaClient {
  findCity(query: string): Promise<Result<NpCity | null>>;
  findWarehouse(opts: { cityRef: string; number: string; isPostomat: boolean }): Promise<Result<NpWarehouse | null>>;
  createTtn(input: CreateTtnInput): Promise<Result<CreateTtnOutput>>;
  trackTtn(ttn: string, phone: string): Promise<Result<{ status: string; statusCode: string; warehouseRecipient: string | null }>>;
  testConnection(): Promise<Result<{ ok: boolean; message: string }>>;
}
