/**
 * BullMQ queue definitions + helpers.
 *
 * Queues:
 *   - createTtn  — confirmed drafts → NP API → Shipment
 *   - refreshStatus — periodic tracking sync (every 30min)
 *   - sweepDrafts  — clean up expired PENDING drafts (every 5min)
 *
 * Strategy:
 *   - All queues have DLQ (dead letter) handling — after maxAttempts, move to "failed" and alert.
 *   - Exponential backoff: 1s → 2s → 4s → 8s → ... (capped at 60s)
 *   - Concurrency tuned per queue (createTtn=5 to respect NP rate limit, sweep=1)
 *   - Job IDs are deterministic for idempotency (draftId-based)
 */
import { Queue, type QueueOptions } from "bullmq";
import { getRedis } from "../infrastructure/redis/redis.js";
import { makeLogger } from "../shared/logger.js";

const log = makeLogger("queue");

export const QUEUE_NAMES = {
  createTtn: "createTtn",
  refreshStatus: "refreshStatus",
  sweepDrafts: "sweepDrafts",
} as const;

export type CreateTtnJobData = { draftId: string; actorUserId: string };
export type RefreshStatusJobData = { shipmentId: string };
export type SweepDraftsJobData = Record<string, never>;

function queueOptions(): QueueOptions {
  // BullMQ requires its OWN ioredis connection. Use the shared instance —
  // BullMQ keeps it pinned and reuses it via its own pool.
  const redis = getRedis();
  return { connection: redis as unknown as QueueOptions["connection"] };
}

type Queues = {
  createTtn: Queue<CreateTtnJobData>;
  refreshStatus: Queue<RefreshStatusJobData>;
  sweepDrafts: Queue<SweepDraftsJobData>;
};

let queues: Queues | null = null;

export function getQueues(): Queues {
  if (queues) return queues;
  const opts = queueOptions();
  queues = {
    createTtn: new Queue<CreateTtnJobData>(QUEUE_NAMES.createTtn, opts),
    refreshStatus: new Queue<RefreshStatusJobData>(QUEUE_NAMES.refreshStatus, opts),
    sweepDrafts: new Queue<SweepDraftsJobData>(QUEUE_NAMES.sweepDrafts, opts),
  };
  return queues;
}

/** Enqueue with deterministic jobId for idempotency. */
export async function enqueueCreateTtn(draftId: bigint, actorUserId: bigint): Promise<void> {
  const q = getQueues().createTtn;
  const jobId = `ttn-${draftId}`;
  await q.add(
    "createTtn",
    { draftId: draftId.toString(), actorUserId: actorUserId.toString() },
    {
      jobId,
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 86400 * 7, count: 1000 },
      removeOnFail: { age: 86400 * 30 },
    },
  );
  log.info({ jobId, draftId: draftId.toString() }, "queue.enqueued");
}

export async function scheduleSweepDrafts(): Promise<void> {
  const q = getQueues().sweepDrafts;
  await q.add("sweep", {}, { repeat: { pattern: "*/5 * * * *" }, jobId: "recurring-sweep" });
}

export async function closeQueues(): Promise<void> {
  const qs = queues;
  if (!qs) return;
  await Promise.all([qs.createTtn.close(), qs.refreshStatus.close(), qs.sweepDrafts.close()]);
  queues = null;
}
