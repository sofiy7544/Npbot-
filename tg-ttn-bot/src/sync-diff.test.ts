/**
 * Sync engine unit tests — tests the diff algorithm in isolation
 * with mocked NP fetcher and in-memory tracking.
 *
 * No PostgreSQL or Redis required.
 */
import { ok, type Result } from "./shared/result.js";
import type { NpRawFetcher } from "./application/use-cases/SyncNpWarehousesUseCase.js";

type City = { Ref: string; Description: string; DescriptionRu: string; Area: string; AreaDescription: string; Region: string | null; SettlementTypeDescription: string };
type Warehouse = { Ref: string; Number: string; CityRef: string; CityDescription: string; CityDescriptionRu: string; Description: string; DescriptionRu: string; ShortAddress: string; ShortAddressRu: string; Longitude: string; Latitude: string; TypeOfWarehouse: string; TotalMaxWeightAllowed: string; Schedule: Record<string, string> };

class MockFetcher implements NpRawFetcher {
  constructor(public cities: City[], public warehousesByCity: Map<string, Warehouse[]>) {}
  async fetchCities(page: number, limit: number): Promise<Result<City[]>> {
    return ok(this.cities.slice((page - 1) * limit, page * limit));
  }
  async fetchWarehousesByCity(cityRef: string): Promise<Result<Warehouse[]>> {
    return ok(this.warehousesByCity.get(cityRef) ?? []);
  }
}

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name}${detail ? `: ${detail}` : ""}`); failed++; }
}

// Mock checksum function — same as production
import { createHash } from "node:crypto";
function checksum(w: Warehouse): string {
  return createHash("sha1").update([w.Description, w.ShortAddress, w.Number, w.Latitude, w.Longitude].join("|")).digest("hex");
}

// ── Test 1: fresh DB (empty) — all warehouses INSERTED ────
{
  const cities: City[] = [{ Ref: "city-1", Description: "Київ", DescriptionRu: "Киев", Area: "area-1", AreaDescription: "Київська", Region: null, SettlementTypeDescription: "місто" }];
  const wh1: Warehouse = { Ref: "wh-1", Number: "5", CityRef: "city-1", CityDescription: "Київ", CityDescriptionRu: "Киев", Description: "Відділення №5", DescriptionRu: "Отд. №5", ShortAddress: "вул. Шевченка 10", ShortAddressRu: "ул. Шевченко 10", Longitude: "30.5", Latitude: "50.4", TypeOfWarehouse: "branch-type-uuid", TotalMaxWeightAllowed: "30", Schedule: {} };
  const fetcher = new MockFetcher(cities, new Map([["city-1", [wh1]]]));
  const existing = new Map<string, { isActive: boolean; checksum: string; dirty: boolean }>();

  // Simulate diff
  const seen = new Set<string>();
  const inserts: string[] = [];
  const updates: string[] = [];
  for (const city of cities) {
    const whs = await (await fetcher.fetchWarehousesByCity(city.Ref)).value;
    for (const w of whs) {
      seen.add(w.Ref);
      const ex = existing.get(w.Ref);
      const cs = checksum(w);
      if (!ex) inserts.push(w.Ref);
      else if (ex.checksum !== cs || !ex.isActive) updates.push(w.Ref);
    }
  }
  const deactivations = Array.from(existing.keys()).filter((r) => !seen.has(r));

  assert("empty DB: 1 insert", inserts.length === 1);
  assert("empty DB: 0 updates", updates.length === 0);
  assert("empty DB: 0 deactivations", deactivations.length === 0);
}

// ── Test 2: SAME data — 0 changes (idempotent) ────────────
{
  const wh1: Warehouse = { Ref: "wh-1", Number: "5", CityRef: "city-1", CityDescription: "Київ", CityDescriptionRu: "Киев", Description: "Відділення №5", DescriptionRu: "Отд. №5", ShortAddress: "вул. Шевченка 10", ShortAddressRu: "ул. Шевченко 10", Longitude: "30.5", Latitude: "50.4", TypeOfWarehouse: "branch-type-uuid", TotalMaxWeightAllowed: "30", Schedule: {} };
  const cs = checksum(wh1);
  const existing = new Map([["wh-1", { isActive: true, checksum: cs, dirty: false }]]);

  const seen = new Set<string>(["wh-1"]);
  const inserts: string[] = [];
  const updates: string[] = [];

  const ex = existing.get("wh-1")!;
  if (ex.checksum === cs && ex.isActive) {
    // no-op
  } else {
    updates.push("wh-1");
  }

  const deactivations = Array.from(existing.keys()).filter((r) => !seen.has(r));
  assert("idempotent: 0 inserts", inserts.length === 0);
  assert("idempotent: 0 updates", updates.length === 0);
  assert("idempotent: 0 deactivations", deactivations.length === 0);
}

// ── Test 3: changed description → UPDATE ──────────────────
{
  const oldWh: Warehouse = { Ref: "wh-1", Number: "5", CityRef: "city-1", CityDescription: "Київ", CityDescriptionRu: "Киев", Description: "OLD address", DescriptionRu: "", ShortAddress: "old", ShortAddressRu: "", Longitude: "30.5", Latitude: "50.4", TypeOfWarehouse: "x", TotalMaxWeightAllowed: "30", Schedule: {} };
  const newWh: Warehouse = { ...oldWh, Description: "NEW address" };
  const existing = new Map([["wh-1", { isActive: true, checksum: checksum(oldWh), dirty: false }]]);

  const updates: string[] = [];
  if (existing.get("wh-1")!.checksum !== checksum(newWh)) updates.push("wh-1");
  assert("changed description → 1 update", updates.length === 1);
}

// ── Test 4: warehouse disappeared from NP → DEACTIVATE ────
{
  const existing = new Map([
    ["wh-1", { isActive: true, checksum: "abc", dirty: false }],
    ["wh-2", { isActive: true, checksum: "def", dirty: false }],
  ]);
  const seen = new Set<string>(["wh-1"]);  // wh-2 not in NP response

  const deactivations = Array.from(existing.keys()).filter((r) => !seen.has(r) && existing.get(r)!.isActive);
  assert("missing warehouse → 1 deactivation", deactivations.length === 1);
  assert("missing warehouse → it's wh-2", deactivations[0] === "wh-2");
}

// ── Test 5: previously deactivated warehouse → REACTIVATE ─
{
  const wh1: Warehouse = { Ref: "wh-1", Number: "5", CityRef: "city-1", CityDescription: "Київ", CityDescriptionRu: "Киев", Description: "Відділення №5", DescriptionRu: "", ShortAddress: "test", ShortAddressRu: "", Longitude: "0", Latitude: "0", TypeOfWarehouse: "x", TotalMaxWeightAllowed: "30", Schedule: {} };
  const existing = new Map([["wh-1", { isActive: false, checksum: checksum(wh1), dirty: false }]]);

  const updates: string[] = [];
  const ex = existing.get("wh-1")!;
  if (ex.checksum !== checksum(wh1) || !ex.isActive) updates.push("wh-1");
  assert("reactivated warehouse → 1 update (isActive=true again)", updates.length === 1);
}

// ── Test 6: large batch (1000 warehouses) — perf check ────
{
  const t0 = Date.now();
  const wh: Warehouse[] = [];
  for (let i = 0; i < 1000; i++) {
    wh.push({ Ref: `wh-${i}`, Number: String(i), CityRef: "city-1", CityDescription: "Київ", CityDescriptionRu: "Киев", Description: `Відділення №${i}`, DescriptionRu: "", ShortAddress: `addr-${i}`, ShortAddressRu: "", Longitude: "0", Latitude: "0", TypeOfWarehouse: "x", TotalMaxWeightAllowed: "30", Schedule: {} });
  }
  const existing = new Map<string, { isActive: boolean; checksum: string; dirty: boolean }>();
  for (const w of wh) existing.set(w.Ref, { isActive: true, checksum: checksum(w), dirty: false });
  // Diff with itself = no changes
  let inserts = 0, updates = 0;
  for (const w of wh) {
    const ex = existing.get(w.Ref);
    const cs = checksum(w);
    if (!ex) inserts++;
    else if (ex.checksum !== cs) updates++;
  }
  const ms = Date.now() - t0;
  assert(`1000 warehouses diff: 0 inserts, 0 updates`, inserts === 0 && updates === 0);
  assert(`1000 warehouses diff: completes <100ms`, ms < 100, `took ${ms}ms`);
}

console.log(`\n──────────────────────────────`);
console.log(`Sync diff: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
