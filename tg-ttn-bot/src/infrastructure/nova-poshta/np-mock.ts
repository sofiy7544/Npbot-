/**
 * Mock NP responses for testing without a real API key.
 * Activates when NP_API_KEY is missing OR NP_MOCK_MODE=true.
 *
 * Returns realistic-looking data but generates fake TTN numbers prefixed with `9999`
 * so they're obviously not real and won't accidentally hit production NP.
 */
// Local types — duplicated from np-client.ts to keep np-mock independent of the legacy file location.
export type NPCity = { Ref: string; Description: string; AreaDescription: string };
export type NPWarehouse = { Ref: string; Number: string; Description: string; ShortAddress: string; TypeOfWarehouse: string };
export type NPCreateDocResult = { Ref: string; CostOnSite: number; EstimatedDeliveryDate: string; IntDocNumber: string; TypeDocument: string };
export type CreateTtnInput = {
  recipientName: string; recipientPhone: string; cityRecipientRef: string;
  warehouseRecipientRef?: string; courierAddress?: string;
  weight: number; cost: number; description: string;
  serviceType?: string; paymentMethod?: string; payerType?: string;
};

// Hardcoded city dictionary for mock — top UA cities with realistic Refs
const MOCK_CITIES: Array<{ ref: string; name: string; area: string }> = [
  { ref: "8d5a980d-391c-11dd-90d9-001a92567626", name: "Київ", area: "Київська" },
  { ref: "db5c88f5-391c-11dd-90d9-001a92567626", name: "Львів", area: "Львівська" },
  { ref: "db5c88e0-391c-11dd-90d9-001a92567626", name: "Дніпро", area: "Дніпропетровська" },
  { ref: "db5c88d3-391c-11dd-90d9-001a92567626", name: "Одеса", area: "Одеська" },
  { ref: "db5c88f0-391c-11dd-90d9-001a92567626", name: "Харків", area: "Харківська" },
  { ref: "db5c88c4-391c-11dd-90d9-001a92567626", name: "Запоріжжя", area: "Запорізька" },
  { ref: "db5c8893-391c-11dd-90d9-001a92567626", name: "Вінниця", area: "Вінницька" },
  { ref: "db5c8870-391c-11dd-90d9-001a92567626", name: "Бровари", area: "Київська" },
  { ref: "ebc16707-e1c2-11e3-8c4a-0050568002cf", name: "Софіївська Борщагівка", area: "Київська" },
  { ref: "db5c889b-391c-11dd-90d9-001a92567626", name: "Полтава", area: "Полтавська" },
  { ref: "db5c88a8-391c-11dd-90d9-001a92567626", name: "Чернівці", area: "Чернівецька" },
  { ref: "db5c889a-391c-11dd-90d9-001a92567626", name: "Чернігів", area: "Чернігівська" },
  { ref: "db5c8898-391c-11dd-90d9-001a92567626", name: "Хмельницький", area: "Хмельницька" },
  { ref: "db5c88e3-391c-11dd-90d9-001a92567626", name: "Тернопіль", area: "Тернопільська" },
  { ref: "db5c889a-391c-11dd-90d9-001a92567627", name: "Івано-Франківськ", area: "Івано-Франківська" },
  { ref: "db5c88d4-391c-11dd-90d9-001a92567626", name: "Луцьк", area: "Волинська" },
  { ref: "db5c889e-391c-11dd-90d9-001a92567626", name: "Рівне", area: "Рівненська" },
  { ref: "db5c8893-391c-11dd-90d9-001a92567627", name: "Житомир", area: "Житомирська" },
  { ref: "db5c889d-391c-11dd-90d9-001a92567626", name: "Суми", area: "Сумська" },
  { ref: "db5c889c-391c-11dd-90d9-001a92567626", name: "Миколаїв", area: "Миколаївська" },
  { ref: "db5c889f-391c-11dd-90d9-001a92567626", name: "Херсон", area: "Херсонська" },
];

export function isMockMode(): boolean {
  if (process.env.NP_MOCK_MODE === "true") return true;
  if (process.env.NP_MOCK_MODE === "false") return false;
  // Auto: no API key → mock
  return !process.env.NP_API_KEY;
}

export function mockFindCity(query: string): NPCity | null {
  const ql = query.toLowerCase().trim();
  // Exact, then prefix match
  const exact = MOCK_CITIES.find((c) => c.name.toLowerCase() === ql);
  if (exact) return toNPCity(exact);
  const prefix = MOCK_CITIES.find((c) => c.name.toLowerCase().startsWith(ql));
  if (prefix) return toNPCity(prefix);
  const includes = MOCK_CITIES.find((c) => c.name.toLowerCase().includes(ql));
  if (includes) return toNPCity(includes);
  return null;
}

export function mockFindWarehouse(opts: {
  cityRef: string;
  number: string;
  type: "branch" | "postomat";
}): NPWarehouse | null {
  const cityName = MOCK_CITIES.find((c) => c.ref === opts.cityRef)?.name ?? "Невідоме";
  const n = parseInt(opts.number, 10);
  if (isNaN(n) || n < 1 || n > 9999) return null;

  // Mock typical NP structure
  const ref = `mock-${opts.type}-${opts.cityRef.slice(0, 8)}-${opts.number}`;
  const desc = opts.type === "postomat"
    ? `Поштомат №${opts.number}: вул. Тестова, 1 (m. ${cityName})`
    : `Відділення №${opts.number}: вул. Тестова, ${n}, м. ${cityName}`;
  const shortAddr = opts.type === "postomat"
    ? `вул. Тестова, 1`
    : `вул. Тестова, ${n}`;

  return {
    Ref: ref,
    Number: opts.number,
    Description: desc,
    ShortAddress: shortAddr,
    TypeOfWarehouse: opts.type === "postomat"
      ? "f9316480-5f2d-425d-bc2c-ac7cd29decf0"
      : "841339c7-591a-42e2-8233-7a0a00f0ed6f",
  };
}

export function mockCreateTtn(input: CreateTtnInput): { ok: true; data: NPCreateDocResult } {
  // Generate fake but realistic TTN: starts with 9999 (real NP uses 20-29...)
  const ttn = "9999" + String(Math.floor(Math.random() * 10000000000)).padStart(10, "0");
  const ref = `mock-doc-${ttn}`;
  // Cost: simple flat by service type
  const baseCost = input.serviceType === "DoorsDoors" ? 130 : 80;
  const cost = input.cost > 500 ? baseCost + Math.round(input.cost * 0.005) : baseCost;
  // ETA: tomorrow
  const eta = new Date(Date.now() + 86_400_000);
  const etaStr = eta.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });

  return {
    ok: true,
    data: {
      Ref: ref,
      CostOnSite: cost,
      EstimatedDeliveryDate: etaStr,
      IntDocNumber: ttn,
      TypeDocument: "InternetDocument",
    },
  };
}

export function mockTestApiKey(): { ok: boolean; message: string } {
  return {
    ok: true,
    message: "🧪 MOCK режим — реальний NP API не дзвоню. Замість ключа використовую тестові дані.",
  };
}

function toNPCity(c: { ref: string; name: string; area: string }): NPCity {
  return { Ref: c.ref, Description: c.name, AreaDescription: c.area };
}
