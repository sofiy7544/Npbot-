/**
 * NP warehouse sync — pulls full UA warehouse/postomat catalogue from Nova Poshta
 * and applies a DIFF against current DB state.
 *
 * Why diff vs full-replace:
 *   - Full-replace would briefly break FK references from existing shipments
 *   - Diff gives clear audit trail (X inserted, Y updated, Z deactivated)
 *   - Soft-delete (isActive=false) preserves history for old TTNs
 *   - Idempotent — running 2× in 1 minute is safe
 *
 * Strategy:
 *   1. Snapshot DB state (Map by ref → existing row)
 *   2. Fetch cities from NP (paginated, ~28k rows in 30 pages of 1000)
 *   3. Fetch warehouses per city (some cities have 100s)
 *   4. Compute 3 sets: inserts, updates, deactivations
 *   5. Apply in transaction with batching (1000-row chunks)
 *   6. Write NpSyncRun audit entry
 *
 * Resumability: on crash, NpSyncRun.lastProcessedCityRef lets next run skip ahead.
 * Throttling: NP HTTP client already token-bucketed at 8 req/sec.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { type Result, ok, err, AppError } from "../../shared/result.js";
import { makeLogger } from "../../shared/logger.js";
import { loadConfig } from "../../shared/config.js";

const log = makeLogger("sync.warehouses");

// ─────────────────────────────────────────────────────────────────────
// Types — domain-level, decoupled from Prisma/NP API
// ─────────────────────────────────────────────────────────────────────

type NpRawCity = {
  Ref: string;
  Description: string;
  DescriptionRu: string;
  Area: string;
  AreaDescription: string;
  Region: string | null;
  SettlementTypeDescription: string;
};

type NpRawWarehouse = {
  Ref: string;
  Number: string;
  CityRef: string;
  CityDescription: string;
  CityDescriptionRu: string;
  Description: string;
  DescriptionRu: string;
  ShortAddress: string;
  ShortAddressRu: string;
  Longitude: string;
  Latitude: string;
  TypeOfWarehouse: string;
  TotalMaxWeightAllowed: string;
  Schedule: Record<string, string>;
  PostMachineType?: string;
};

export type SyncOpts = {
  trigger: "scheduled" | "manual" | "retry";
  resumeFromCityRef?: string;
  maxCities?: number;          // limit for testing
  dryRun?: boolean;             // compute diff but don't apply
};

export type SyncResult = {
  runId: string;
  citiesFetched: number;
  warehousesFetched: number;
  inserted: number;
  updated: number;
  deactivated: number;
  reactivated: number;
  unchanged: number;
  durationMs: number;
  apiCalls: number;
};

const POSTOMAT_TYPE_REF = "f9316480-5f2d-425d-bc2c-ac7cd29decf0";

// ─────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────

export class SyncNpWarehousesUseCase {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly npFetcher: NpRawFetcher,
  ) {}

  async execute(opts: SyncOpts): Promise<Result<SyncResult>> {
    const startedAt = Date.now();
    const cfg = loadConfig();

    if (!cfg.NP_API_KEY) {
      return err(new AppError("np.invalid_sender_config", "NP_API_KEY required for sync (mock mode would yield 0 rows)"));
    }

    // ── 1. Create sync run record ──────────────────────────────
    const run = await this.prisma.npSyncRun.create({
      data: { trigger: opts.trigger, status: "RUNNING" },
    });
    log.info({ runId: run.id.toString(), trigger: opts.trigger, dryRun: !!opts.dryRun }, "sync.start");

    let apiCalls = 0;
    let citiesFetched = 0;
    let warehousesFetched = 0;
    let lastProcessedCityRef: string | null = null;

    try {
      // ── 2. Snapshot existing state ──────────────────────────
      // For 100k rows: ~30MB in memory — acceptable. If grows beyond, switch to streaming compare.
      const existingMap = await this.snapshotExisting();
      log.info({ existing: existingMap.size }, "sync.snapshot");

      // Track which refs we see this run (for deactivation logic)
      const seenRefs = new Set<string>();

      // ── 3. Stream cities → for each, fetch warehouses → diff ──
      const cityPageSize = 500;
      let cityPage = 1;
      let totalCityCount = 0;

      for (;;) {
        const citiesResult = await this.npFetcher.fetchCities(cityPage, cityPageSize);
        apiCalls++;
        if (!citiesResult.ok) throw citiesResult.error;
        const cities = citiesResult.value;
        if (cities.length === 0) break;

        // Process each city's warehouses
        for (const city of cities) {
          if (opts.resumeFromCityRef && city.Ref !== opts.resumeFromCityRef && totalCityCount === 0) {
            // Still seeking the resume point
            continue;
          }
          totalCityCount++;
          if (opts.maxCities && totalCityCount > opts.maxCities) break;

          // Upsert city (cheap)
          if (!opts.dryRun) {
            await this.prisma.npCity.upsert({
              where: { ref: city.Ref },
              create: {
                ref: city.Ref,
                name: city.Description,
                nameRu: city.DescriptionRu,
                area: city.AreaDescription,
                areaRef: city.Area,
                region: city.Region ?? null,
                settlementType: city.SettlementTypeDescription ?? null,
              },
              update: {
                name: city.Description,
                nameRu: city.DescriptionRu,
                area: city.AreaDescription,
                isActive: true,
                lastSyncedAt: new Date(),
              },
            });
          }

          // Fetch warehouses for this city
          const whResult = await this.npFetcher.fetchWarehousesByCity(city.Ref);
          apiCalls++;
          if (!whResult.ok) {
            log.warn({ cityRef: city.Ref, cityName: city.Description, err: whResult.error.message }, "sync.city_skip");
            continue;
          }
          warehousesFetched += whResult.value.length;
          lastProcessedCityRef = city.Ref;

          // Apply diff for this city's warehouses
          if (!opts.dryRun) {
            await this.applyCityDiff(city, whResult.value, existingMap, seenRefs);
          } else {
            for (const w of whResult.value) seenRefs.add(w.Ref);
          }

          // Persist resume point + counters periodically
          if (totalCityCount % 100 === 0) {
            citiesFetched = totalCityCount;
            await this.prisma.npSyncRun.update({
              where: { id: run.id },
              data: { citiesFetched, warehousesFetched, apiCallsMade: apiCalls, lastProcessedCityRef },
            });
            log.info({ citiesFetched, warehousesFetched, apiCalls }, "sync.progress");
          }
        }

        if (cities.length < cityPageSize) break;       // last page
        if (opts.maxCities && totalCityCount >= opts.maxCities) break;
        cityPage++;
      }
      citiesFetched = totalCityCount;

      // ── 4. Deactivate warehouses not seen this run ──────────
      let deactivated = 0;
      if (!opts.dryRun) {
        const toDeactivate = Array.from(existingMap.keys()).filter((ref) => !seenRefs.has(ref));
        // Only deactivate if existing was active (avoid touching already-inactive rows)
        const stillActiveSlice = toDeactivate.filter((r) => existingMap.get(r)?.isActive);
        if (stillActiveSlice.length > 0) {
          // Batch in chunks of 1000 to avoid huge IN-clauses
          for (let i = 0; i < stillActiveSlice.length; i += 1000) {
            const chunk = stillActiveSlice.slice(i, i + 1000);
            const r = await this.prisma.npWarehouse.updateMany({
              where: { ref: { in: chunk } },
              data: { isActive: false, deactivatedAt: new Date(), lastSyncedAt: new Date() },
            });
            deactivated += r.count;
          }
        }
      }

      // ── 5. Update city.warehouseCount denormalized counter ──
      // (cheap — single GROUP BY)
      if (!opts.dryRun) {
        await this.prisma.$executeRawUnsafe(`
          UPDATE "NpCity" c
          SET "warehouseCount" = sub.cnt
          FROM (
            SELECT "cityRef", COUNT(*)::int AS cnt
            FROM "NpWarehouse"
            WHERE "isActive" = true
            GROUP BY "cityRef"
          ) sub
          WHERE c."ref" = sub."cityRef";
        `);
      }

      // ── 6. Finalize run ─────────────────────────────────────
      const durationMs = Date.now() - startedAt;
      const inserted = Array.from(seenRefs).filter((r) => !existingMap.has(r)).length;
      const updated = Array.from(seenRefs).filter((r) => existingMap.has(r) && existingMap.get(r)?.dirty).length;
      const reactivated = Array.from(seenRefs).filter((r) => existingMap.has(r) && !existingMap.get(r)?.isActive).length;
      const unchanged = seenRefs.size - inserted - updated;

      await this.prisma.npSyncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "SUCCESS",
          citiesFetched,
          warehousesFetched,
          inserted,
          updated,
          deactivated,
          reactivated,
          unchanged,
          apiCallsMade: apiCalls,
          durationMs,
          lastProcessedCityRef,
        },
      });

      const result: SyncResult = {
        runId: run.id.toString(),
        citiesFetched,
        warehousesFetched,
        inserted,
        updated,
        deactivated,
        reactivated,
        unchanged,
        durationMs,
        apiCalls,
      };
      log.info(result, "sync.success");
      return ok(result);
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      const appErr = e instanceof AppError ? e : new AppError("system.internal_error", String(e));
      await this.prisma.npSyncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "FAILED",
          errorMessage: appErr.message,
          errorContext: appErr.context as Prisma.InputJsonValue,
          citiesFetched,
          warehousesFetched,
          apiCallsMade: apiCalls,
          durationMs,
          lastProcessedCityRef,
        },
      });
      log.error({ err: appErr.message, durationMs }, "sync.failed");
      return err(appErr);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Snapshot existing — for diff comparison.
  // Loads only fields needed to detect changes (not the full row).
  // ─────────────────────────────────────────────────────────
  private async snapshotExisting(): Promise<Map<string, ExistingSnapshot>> {
    const map = new Map<string, ExistingSnapshot>();
    // Stream in chunks to handle 100k+ rows without OOM
    const pageSize = 5000;
    let cursor: string | undefined;
    for (;;) {
      const rows: Array<{ ref: string; isActive: boolean; checksumSource: string | null }> = await this.prisma.$queryRaw`
        SELECT ref, "isActive",
          encode(digest(
            COALESCE("description",'') || '|' ||
            COALESCE("shortAddress",'') || '|' ||
            COALESCE("number",'') || '|' ||
            COALESCE("latitude"::text,'') || '|' ||
            COALESCE("longitude"::text,''),
          'sha1'), 'hex') AS "checksumSource"
        FROM "NpWarehouse"
        ${cursor ? Prisma.sql`WHERE ref > ${cursor}` : Prisma.empty}
        ORDER BY ref ASC
        LIMIT ${pageSize}
      `;
      for (const r of rows) {
        map.set(r.ref, { isActive: r.isActive, checksum: r.checksumSource ?? "", dirty: false });
      }
      if (rows.length < pageSize) break;
      cursor = rows[rows.length - 1].ref;
    }
    return map;
  }

  // ─────────────────────────────────────────────────────────
  // Apply diff for a single city's warehouses.
  // INSERT: not in DB → insert
  // UPDATE: in DB but data differs → update + bump dataVersion
  // (DEACTIVATE happens in finalization step)
  // ─────────────────────────────────────────────────────────
  private async applyCityDiff(
    city: NpRawCity,
    warehouses: NpRawWarehouse[],
    existingMap: Map<string, ExistingSnapshot>,
    seenRefs: Set<string>,
  ): Promise<void> {
    const inserts: Prisma.NpWarehouseCreateManyInput[] = [];
    const updates: Array<{ ref: string; data: Prisma.NpWarehouseUpdateInput }> = [];

    for (const w of warehouses) {
      seenRefs.add(w.Ref);
      const checksum = this.warehouseChecksum(w);
      const existing = existingMap.get(w.Ref);
      const isPostomat = w.TypeOfWarehouse === POSTOMAT_TYPE_REF;

      const common = {
        number: w.Number,
        type: isPostomat ? ("POSTOMAT" as const) : ("BRANCH" as const),
        cityRef: w.CityRef,
        cityName: w.CityDescription,
        cityNameRu: w.CityDescriptionRu,
        area: city.AreaDescription,
        description: w.Description,
        descriptionRu: w.DescriptionRu,
        shortAddress: w.ShortAddress,
        shortAddressRu: w.ShortAddressRu,
        latitude: w.Latitude ? new Prisma.Decimal(w.Latitude) : null,
        longitude: w.Longitude ? new Prisma.Decimal(w.Longitude) : null,
        maxWeightKg: w.TotalMaxWeightAllowed ? Number(w.TotalMaxWeightAllowed) : null,
        schedule: (w.Schedule ?? {}) as Prisma.InputJsonValue,
        rawData: w as unknown as Prisma.InputJsonValue,
        isActive: true,
        lastSyncedAt: new Date(),
      };

      if (!existing) {
        inserts.push({ ref: w.Ref, ...common, dataVersion: 1 });
      } else if (existing.checksum !== checksum || !existing.isActive) {
        existing.dirty = true;
        updates.push({
          ref: w.Ref,
          data: {
            ...common,
            dataVersion: { increment: 1 },
            deactivatedAt: null,
          },
        });
      }
    }

    // Batch insert (chunks of 1000)
    if (inserts.length > 0) {
      for (let i = 0; i < inserts.length; i += 1000) {
        await this.prisma.npWarehouse.createMany({
          data: inserts.slice(i, i + 1000),
          skipDuplicates: true,        // safety against race conditions
        });
      }
    }

    // Updates can't be batched in Prisma — but they're usually few per run
    if (updates.length > 0) {
      await this.prisma.$transaction(
        updates.map((u) => this.prisma.npWarehouse.update({ where: { ref: u.ref }, data: u.data })),
      );
    }
  }

  /**
   * sha1 of the fields we care about for change detection.
   * If checksum differs → row changed → update.
   * Excludes: rawData (always different by JSON ordering), lastSyncedAt.
   */
  private warehouseChecksum(w: NpRawWarehouse): string {
    const key = [
      w.Description ?? "",
      w.ShortAddress ?? "",
      w.Number ?? "",
      w.Latitude ?? "",
      w.Longitude ?? "",
    ].join("|");
    return createHash("sha1").update(key).digest("hex");
  }
}

type ExistingSnapshot = { isActive: boolean; checksum: string; dirty: boolean };

// ─────────────────────────────────────────────────────────────────────
// NP raw fetcher port — separates HTTP from sync logic for testability
// ─────────────────────────────────────────────────────────────────────

export interface NpRawFetcher {
  fetchCities(page: number, limit: number): Promise<Result<NpRawCity[]>>;
  fetchWarehousesByCity(cityRef: string): Promise<Result<NpRawWarehouse[]>>;
}
