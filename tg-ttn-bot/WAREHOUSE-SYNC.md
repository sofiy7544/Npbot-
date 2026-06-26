# NP Warehouse Sync — Production Sync System

Полное зеркалирование инфраструктуры Нової Пошти (всі ~28k міст + ~12k відділень/поштоматів) в нашу PostgreSQL базу. Тижневе оновлення diff-based, з retry, idempotency, resumability.

## Архітектура

```
┌─────────────────────────────────────────────────────────────────┐
│ BullMQ Repeatable Job (cron "0 3 * * 0" = Sunday 03:00 UTC)    │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
       ┌──────────────────────────────────────────┐
       │ SyncNpWarehousesUseCase                  │
       │                                          │
       │  1. Snapshot existing DB (sha1 checksums)│
       │  2. Page through Address.getCities (500/page) │
       │  3. For each city: Address.getWarehouses (500/req) │
       │  4. Compute DIFF: insert | update | deactivate     │
       │  5. Apply in batched transactions       │
       │  6. Update city.warehouseCount counters │
       │  7. Write NpSyncRun audit row           │
       └──────────────────────────────────────────┘
                           ▼
        ┌─────────────────────────────────────┐
        │ Tables:                              │
        │   - NpCity (~28k rows)               │
        │   - NpWarehouse (~12k rows)          │
        │   - NpSyncRun (audit, retained 90d)  │
        └─────────────────────────────────────┘
```

## Tables

### `NpWarehouse` (~12k rows expected)

| Column | Type | Notes |
|---|---|---|
| `ref` | String **PK** | NP UUID — immutable, primary key |
| `number` | String | Display number ("5", "23034") |
| `type` | enum | BRANCH \| POSTOMAT \| COURIER |
| `cityRef` | String | FK to NpCity |
| `cityName`, `cityNameRu` | String | Denormalized for fast queries |
| `description` | String | Full address text |
| `latitude`, `longitude` | Decimal(10,7) | Geo coords for map |
| `maxWeightKg` | Float | Weight limit |
| `schedule` | Json | Working hours |
| **`isActive`** | Boolean | **Soft-delete flag — never DELETE** |
| `dataVersion` | Int | Incremented on each change |
| `rawData` | Json | Full NP response (forensics) |
| `firstSeenAt` | DateTime | When we first saw this ref |
| `lastSyncedAt` | DateTime | Last sync that touched this row |
| `deactivatedAt` | DateTime? | When isActive flipped to false |

**Indexes:**
- `(cityRef, type, isActive)` — autocomplete dropdown queries
- `(cityName, number, type)` — "find by number" lookups
- `(number, isActive)` — cross-city number search
- `(lastSyncedAt)` — sync diagnostics

### `NpCity` (~28k rows)

| Column | Type |
|---|---|
| `ref` | String **PK** (NP UUID) |
| `name`, `nameRu` | "Київ" |
| `area` | "Київська область" |
| `region` | район |
| `settlementType` | "місто" / "село" / "смт" |
| `warehouseCount` | Int — denormalized counter |
| `isActive`, `dataVersion`, `firstSeenAt`, `lastSyncedAt` | стандарт |

### `NpSyncRun` (audit, retained 90d)

| Column | Notes |
|---|---|
| `id` | bigint PK |
| `startedAt`, `finishedAt` | DateTime |
| `status` | RUNNING \| SUCCESS \| FAILED \| PARTIAL |
| `trigger` | "scheduled" \| "manual" \| "retry" |
| `citiesFetched`, `warehousesFetched` | counters |
| `inserted`, `updated`, `deactivated`, `reactivated`, `unchanged` | diff stats |
| `errorMessage`, `errorContext` | on failure |
| `lastProcessedCityRef` | resume checkpoint |
| `apiCallsMade`, `durationMs` | observability |

## Diff Algorithm

```
existing = snapshot DB → Map<ref, { isActive, sha1(description|shortAddress|number|lat|lon) }>
seen = Set<ref>

for each city in NP:
  for each warehouse in city:
    seen.add(ref)
    if not in existing:
      INSERT (dataVersion=1, firstSeenAt=now)
    elif existing.checksum != current.checksum OR existing.isActive == false:
      UPDATE (dataVersion++, deactivatedAt=null)

# after all warehouses processed:
to_deactivate = existing.keys - seen  AND  isActive=true
UPDATE isActive=false, deactivatedAt=now FOR refs IN to_deactivate
```

**Properties:**
- ✅ Idempotent — running 2× in a row: 2nd run = 0 inserts, 0 updates
- ✅ Resumable — `lastProcessedCityRef` lets next run skip ahead on crash
- ✅ Safe — soft-delete preserves history (existing TTNs still reference deactivated warehouses)
- ✅ Auditable — every change → `dataVersion++` + `lastSyncedAt` + `NpSyncRun` row

## Running

### Weekly automatic (production)
Worker process registers cron at boot:
```bash
docker compose up -d worker
# → "0 3 * * 0" = Sunday 03:00 UTC sync runs automatically
```

### Manual one-shot
```bash
# Full sync
npm run sync:warehouses

# Dry-run (compute diff, don't write) — first 5 cities only
npm run sync:warehouses:dry

# Resume from a checkpoint (after crash)
npm run sync:warehouses -- --resume=<cityRef>

# Limit for testing
npm run sync:warehouses -- --max=10
```

### Manual via Admin API (future)
```bash
curl -X POST http://localhost:3001/admin/sync/warehouses \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

## Throttling & rate limits

- **NP API budget**: ~10 req/sec free tier
- **User-facing client** (`NovaPoshtaHttpClient`): 8 req/sec budget
- **Sync client** (`NpRawFetcherHttp`): 4 req/sec — uses HALF the budget so it doesn't starve UX
- **Per-request timeout**: 10s
- **Retries**: 3 attempts, exponential backoff (1s → 2s → 4s + jitter)
- **Expected duration**: ~15-20 min for full UA sync (28k cities × ~1 req each = ~30 min @ 4 req/s)

## Failure modes & recovery

| Failure | Behavior |
|---|---|
| Single city 5xx | Logged as warning, sync continues with next city. `NpSyncRun.status=PARTIAL` if any city failed. |
| NP API completely down | After 3 retries per call, sync fails. `NpSyncRun.status=FAILED`. BullMQ retries job up to 3 times with 1m/2m/4m backoff. |
| Worker crash mid-sync | `NpSyncRun.lastProcessedCityRef` saved every 100 cities. Next run can be invoked with `--resume=<that ref>` to skip already-done work. |
| DB unique-violation (race condition with manual run) | `createMany({ skipDuplicates: true })` handles it. |
| Old shipment references deactivated warehouse | Still works — FK is to `ref` which never deletes. UI shows "Відділення №X (закрите)". |

## Monitoring

Query last 7 runs:
```sql
SELECT startedAt, status, durationMs/1000 AS seconds, citiesFetched,
       warehousesFetched, inserted, updated, deactivated, errorMessage
FROM "NpSyncRun"
ORDER BY startedAt DESC
LIMIT 7;
```

Alert if:
- last run `status != SUCCESS` for >24h
- `warehousesFetched < 8000` (something's wrong — UA has ~12k)
- `durationMs > 60*60*1000` (sync taking >1h)
- `inserted + updated + deactivated > 1000` in a single run (suspicious — usually <50)

## Why no scraping?

NP has a stable, well-documented free JSON API. Scraping their dashboard would be:
- **Brittle** — HTML structure changes weekly
- **Against ToS** — NP explicitly prohibits scraping in their API agreement
- **Slower** — JSON API is 10× faster than rendering HTML
- **Unnecessary** — `Address.getCities` + `Address.getWarehouses` cover 100% of public warehouse data

The fallback option you suggested isn't needed. We use the API directly.

## What's tracked

For each warehouse (~12k rows):
- ✅ Address text (full + short, UA/RU)
- ✅ Geo coords (for future map UI)
- ✅ Working schedule (weekday hours)
- ✅ Weight limit
- ✅ Type (відділення / поштомат)
- ✅ Full raw JSON (forensics — what if NP adds new fields?)

Not tracked (NP doesn't expose):
- Real-time queue length
- Available volume for incoming parcels
- Operator names
