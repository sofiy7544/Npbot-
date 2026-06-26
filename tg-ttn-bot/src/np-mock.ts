/**
 * Mock NP responses for testing without a real API key.
 * Activates when NP_API_KEY is missing OR NP_MOCK_MODE=true.
 *
 * Returns realistic-looking data but generates fake TTN numbers prefixed with `9999`
 * so they're obviously not real and won't accidentally hit production NP.
 *
 * NEVER returns null for a city — generates a deterministic mock Ref from the city
 * name hash. This means mock mode accepts ANY city the parser found.
 */
import { createHash } from "node:crypto";
import type { NPCity, NPWarehouse, NPCreateDocResult, CreateTtnInput } from "./np-client.js";

/** Real NP Refs for the most common cities — used for visual consistency in MOCK mode. */
const REAL_CITY_REFS: Record<string, { ref: string; area: string }> = {
  "Київ": { ref: "8d5a980d-391c-11dd-90d9-001a92567626", area: "Київська" },
  "Львів": { ref: "db5c88f5-391c-11dd-90d9-001a92567626", area: "Львівська" },
  "Дніпро": { ref: "db5c88e0-391c-11dd-90d9-001a92567626", area: "Дніпропетровська" },
  "Одеса": { ref: "db5c88d3-391c-11dd-90d9-001a92567626", area: "Одеська" },
  "Харків": { ref: "db5c88f0-391c-11dd-90d9-001a92567626", area: "Харківська" },
  "Запоріжжя": { ref: "db5c88c4-391c-11dd-90d9-001a92567626", area: "Запорізька" },
  "Вінниця": { ref: "db5c8893-391c-11dd-90d9-001a92567626", area: "Вінницька" },
  "Бровари": { ref: "db5c8870-391c-11dd-90d9-001a92567626", area: "Київська" },
  "Софіївська Борщагівка": { ref: "ebc16707-e1c2-11e3-8c4a-0050568002cf", area: "Київська" },
  "Полтава": { ref: "db5c889b-391c-11dd-90d9-001a92567626", area: "Полтавська" },
  "Чернівці": { ref: "db5c88a8-391c-11dd-90d9-001a92567626", area: "Чернівецька" },
  "Чернігів": { ref: "db5c889a-391c-11dd-90d9-001a92567626", area: "Чернігівська" },
  "Хмельницький": { ref: "db5c8898-391c-11dd-90d9-001a92567626", area: "Хмельницька" },
  "Тернопіль": { ref: "db5c88e3-391c-11dd-90d9-001a92567626", area: "Тернопільська" },
  "Івано-Франківськ": { ref: "db5c889a-391c-11dd-90d9-001a92567627", area: "Івано-Франківська" },
  "Луцьк": { ref: "db5c88d4-391c-11dd-90d9-001a92567626", area: "Волинська" },
  "Рівне": { ref: "db5c889e-391c-11dd-90d9-001a92567626", area: "Рівненська" },
  "Житомир": { ref: "db5c8893-391c-11dd-90d9-001a92567627", area: "Житомирська" },
  "Суми": { ref: "db5c889d-391c-11dd-90d9-001a92567626", area: "Сумська" },
  "Миколаїв": { ref: "db5c889c-391c-11dd-90d9-001a92567626", area: "Миколаївська" },
  "Херсон": { ref: "db5c889f-391c-11dd-90d9-001a92567626", area: "Херсонська" },
  "Ірпінь": { ref: "db5c8a5d-391c-11dd-90d9-001a92567626", area: "Київська" },
  "Буча": { ref: "db5c8a5e-391c-11dd-90d9-001a92567626", area: "Київська" },
  "Біла Церква": { ref: "db5c8a60-391c-11dd-90d9-001a92567626", area: "Київська" },
  "Кривий Ріг": { ref: "db5c8a61-391c-11dd-90d9-001a92567626", area: "Дніпропетровська" },
  "Кам'янець-Подільський": { ref: "db5c8a62-391c-11dd-90d9-001a92567626", area: "Хмельницька" },
  "Кропивницький": { ref: "db5c8a63-391c-11dd-90d9-001a92567626", area: "Кіровоградська" },
  "Черкаси": { ref: "db5c8a64-391c-11dd-90d9-001a92567626", area: "Черкаська" },
  "Ужгород": { ref: "db5c8a65-391c-11dd-90d9-001a92567626", area: "Закарпатська" },
  "Бориспіль": { ref: "db5c8a66-391c-11dd-90d9-001a92567626", area: "Київська" },
  "Кременчук": { ref: "db5c8a67-391c-11dd-90d9-001a92567626", area: "Полтавська" },
  "Маріуполь": { ref: "db5c8a68-391c-11dd-90d9-001a92567626", area: "Донецька" },
  "Володимир-Волинський": { ref: "db5c8a69-391c-11dd-90d9-001a92567626", area: "Волинська" },
  "Коростень": { ref: "db5c8a6a-391c-11dd-90d9-001a92567626", area: "Житомирська" },
  "Дубляни": { ref: "db5c8a6b-391c-11dd-90d9-001a92567626", area: "Львівська" },
  "Ходосівка": { ref: "db5c8a6c-391c-11dd-90d9-001a92567626", area: "Київська" },
};

/** Generate a deterministic mock UUID from a string (so same city name = same ref every call). */
function pseudoUuid(seed: string): string {
  const h = createHash("md5").update(`mock-city:${seed.toLowerCase()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function isMockMode(): boolean {
  if (process.env.NP_MOCK_MODE === "true") return true;
  if (process.env.NP_MOCK_MODE === "false") return false;
  // Auto: no API key → mock
  return !process.env.NP_API_KEY;
}

export function mockFindCity(query: string): NPCity | null {
  const q = query.trim();
  if (!q) return null;
  // 1. Real-Ref lookup for top cities (so UI shows realistic UUIDs)
  for (const [name, info] of Object.entries(REAL_CITY_REFS)) {
    if (name.toLowerCase() === q.toLowerCase()) {
      cityNameByRef.set(info.ref, name);
      return { Ref: info.ref, Description: name, AreaDescription: info.area };
    }
  }
  // 2. Substring match against real-ref dict (handles "Київ обл" → "Київ")
  for (const [name, info] of Object.entries(REAL_CITY_REFS)) {
    if (q.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(q.toLowerCase())) {
      cityNameByRef.set(info.ref, name);
      return { Ref: info.ref, Description: name, AreaDescription: info.area };
    }
  }
  // 3. ANY other city — generate deterministic pseudo-UUID. NEVER return null.
  //    Mock mode = developer testing, so accept any reasonable city name.
  if (q.length >= 2 && q.length <= 50) {
    const ref = pseudoUuid(q);
    cityNameByRef.set(ref, q);          // remember for warehouse lookup
    return { Ref: ref, Description: q, AreaDescription: "—" };
  }
  return null;
}

// Side channel: last-seen city name per ref, populated by findCity. Used by findWarehouse for
// nicer description text when the cityRef is a pseudo-UUID (not in REAL_CITY_REFS).
const cityNameByRef = new Map<string, string>();

export function mockFindWarehouse(opts: {
  cityRef: string;
  number: string;
  type: "branch" | "postomat";
}): NPWarehouse | null {
  // Reverse lookup: real refs → name, then side channel for pseudo-UUIDs
  const realCity = Object.entries(REAL_CITY_REFS).find(([, info]) => info.ref === opts.cityRef);
  const cityName = realCity ? realCity[0] : cityNameByRef.get(opts.cityRef) ?? "Місто";
  const n = parseInt(opts.number, 10);
  // Postomats can have 5-digit numbers (e.g. 23504, 58687); branches usually 1-4 digit (up to 9999).
  // Accept 1-99999 to cover both — never return null for valid integer input.
  if (isNaN(n) || n < 1 || n > 99999) return null;

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
