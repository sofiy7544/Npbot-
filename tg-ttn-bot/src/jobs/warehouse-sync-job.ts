/**
 * BullMQ warehouse-sync job + scheduler.
 *
 * Scheduling:
 *   - Repeating job: cron "0 3 * * 0"  (every Sunday at 03:00 UTC)
 *   - Jitter: 0-30 min — spread load if multiple instances run
 *   - Idempotent jobId: "warehouse-sync-weekly" — BullMQ deduplicates auto
 *
 * Manual trigger:
 *   - CLI: `npm run sync:warehouses`
 *   - Admin API: POST /admin/sync/warehouses
 *
 * Concurrency: 1 worker only — running 2 syncs in parallel against NP would
 * burn rate-limit and double-count counters.
 */
import { Queue, Worker, type Job } from "bullmq";
import { getRedis } from "../infrastructure/redis/redis.js";
import { makeLogger, withContext } from "../shared/logger.js";
import { randomUUID } from "node:crypto";
import { buildContainer } from "../main.container.js";

const log = makeLogger("queue.warehouse-sync");

export const WAREHOUSE_SYNC_QUEUE = "warehouseSync";
export const WAREHOUSE_SYNC_JOB_NAME = "warehouseSync";
export const WAREHOUSE_SYNC_RECURRING_ID = "warehouse-sync-weekly";

export type WarehouseSyncJobData = {
  trigger: "scheduled" | "manual" | "retry";
  resumeFromCityRef?: string;
  maxCities?: number;
  dryRun?: boolean;
};

function getConnection() {
  const redis = getRedis();
  return { connection: redis as never };
}

let queue: Queue<WarehouseSyncJobData> | null = null;

export function getSyncQueue(): Queue<WarehouseSyncJobData> {
  if (queue) return queue;
  queue = new Queue<WarehouseSyncJobData>(WAREHOUSE_SYNC_QUEUE, getConnection());
  return queue;
}

/** Register the weekly cron — call once at startup. */
export async function scheduleWeeklyWarehouseSync(): Promise<void> {
  const q = getSyncQueue();
  await q.add(
    WAREHOUSE_SYNC_JOB_NAME,
    { trigger: "scheduled" },
    {
      jobId: WAREHOUSE_SYNC_RECURRING_ID,
      repeat: { pattern: "0 3 * * 0" },     // Sunday 03:00 UTC
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },     // 1m → 2m → 4m
      removeOnComplete: { age: 86400 * 30, count: 20 },
      removeOnFail: { age: 86400 * 90 },
    },
  );
  log.info("schedule.registered");
}

/** Enqueue a manual run NOW (e.g. from /admin/sync/warehouses POST). */
export async function enqueueManualSync(opts: { dryRun?: boolean; maxCities?: number } = {}): Promise<string> {
  const q = getSyncQueue();
  const jobId = `warehouse-sync-manual-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await q.add(
    WAREHOUSE_SYNC_JOB_NAME,
    { trigger: "manual", ...opts },
    {
      jobId,
      attempts: 1,                       // manual = fail loud, don't retry silently
      removeOnComplete: { age: 86400 * 7 },
      removeOnFail: { age: 86400 * 30 },
    },
  );
  log.info({ jobId, opts }, "manual.enqueued");
  return jobId;
}

/** Spawn the worker — call from worker.ts process. */
export function makeWarehouseSyncWorker(): Worker<WarehouseSyncJobData> {
  const worker = new Worker<WarehouseSyncJobData>(
    WAREHOUSE_SYNC_QUEUE,
    async (job: Job<WarehouseSyncJobData>) => {
      const requestId = randomUUID();
      return withContext({ requestId }, async () => {
        log.info({ jobId: job.id, data: job.data, attempt: job.attemptsMade + 1 }, "sync.job.start");
        const container = await buildContainer();

        const r = await container.syncWarehousesUseCase.execute({
          trigger: job.data.trigger,
          resumeFromCityRef: job.data.resumeFromCityRef,
          maxCities: job.data.maxCities,
          dryRun: job.data.dryRun,
        });

        if (!r.ok) {
          log.error({ jobId: job.id, error: r.error.message }, "sync.job.failed");
          throw r.error;
        }
        log.info({ jobId: job.id, result: r.value }, "sync.job.success");
        return r.value;
      });
    },
    {
      ...getConnection(),
      concurrency: 1,                    // single sync at a time
      lockDuration: 30 * 60_000,        // 30min lock — sync may take 15-20min
      stalledInterval: 60_000,
    },
  );
  worker.on("failed", (job, err) => log.error({ jobId: job?.id, err: String(err) }, "sync.worker.failed"));
  worker.on("completed", (job) => log.info({ jobId: job.id }, "sync.worker.completed"));
  return worker;
}
