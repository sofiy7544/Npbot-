/**
 * BullMQ worker process. Runs as separate `npm run worker` to scale independently.
 *
 * Concurrency:
 *   - createTtn: 5 (matches NP API rate-limit budget)
 *   - sweepDrafts: 1 (only one sweeper at a time)
 *
 * Graceful shutdown drains in-flight jobs.
 */
import { Worker } from "bullmq";
import { QUEUE_NAMES, type CreateTtnJobData, type SweepDraftsJobData } from "./queues.js";
import { getRedis, closeRedis } from "../infrastructure/redis/redis.js";
import { closePrisma, getPrisma } from "../infrastructure/persistence/prisma.js";
import { makeLogger, withContext } from "../shared/logger.js";
import { randomUUID } from "node:crypto";
import { buildContainer, type AppContainer } from "../main.container.js";
import { makeWarehouseSyncWorker, scheduleWeeklyWarehouseSync } from "./warehouse-sync-job.js";

const log = makeLogger("worker");

async function main() {
  const container: AppContainer = await buildContainer();
  const redis = getRedis();
  const conn = { host: redis.options.host, port: redis.options.port, db: redis.options.db, password: redis.options.password ?? undefined };

  // ── createTtn worker ──────────────────────────────────────
  const createTtnWorker = new Worker<CreateTtnJobData>(
    QUEUE_NAMES.createTtn,
    async (job) => {
      const requestId = randomUUID();
      return withContext({ requestId, draftId: BigInt(job.data.draftId) }, async () => {
        log.info({ jobId: job.id, attempt: job.attemptsMade + 1 }, "job.start");
        const r = await container.createTtnUseCase.execute({
          draftId: BigInt(job.data.draftId),
          actorUserId: BigInt(job.data.actorUserId),
        });
        if (!r.ok) {
          log.warn({ jobId: job.id, error: r.error.code }, "job.failed");
          throw r.error; // BullMQ will retry per backoff
        }
        log.info({ jobId: job.id, ttn: r.value.ttn }, "job.success");
        return { ttn: r.value.ttn };
      });
    },
    { connection: conn, concurrency: 5 },
  );

  createTtnWorker.on("failed", (job, err) => log.error({ jobId: job?.id, err: String(err) }, "worker.job_failed"));
  createTtnWorker.on("completed", (job) => log.debug({ jobId: job.id }, "worker.job_completed"));

  // ── sweepDrafts worker ────────────────────────────────────
  const sweepWorker = new Worker<SweepDraftsJobData>(
    QUEUE_NAMES.sweepDrafts,
    async () => {
      const swept = await container.draftRepo.sweepExpired(new Date(), 1000);
      const cacheSwept = await container.npCacheRepo.sweepExpired();
      log.info({ drafts: swept, cache: cacheSwept }, "sweep.done");
      return { drafts: swept, cache: cacheSwept };
    },
    { connection: conn, concurrency: 1 },
  );

  // ── warehouseSync worker + weekly cron ────────────────────
  const syncWorker = makeWarehouseSyncWorker();
  // Register the weekly cron job — idempotent (BullMQ dedupes by jobId)
  await scheduleWeeklyWarehouseSync().catch((e) => log.warn({ err: String(e) }, "sync.schedule_failed"));

  log.info("worker.ready");

  // Graceful shutdown
  const stop = async () => {
    log.info("worker.shutdown.start");
    await Promise.all([createTtnWorker.close(), sweepWorker.close(), syncWorker.close()]);
    await closePrisma();
    await closeRedis();
    log.info("worker.shutdown.done");
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((e) => {
  log.fatal({ err: e instanceof Error ? e.stack : String(e) }, "worker.crash");
  process.exit(1);
});
