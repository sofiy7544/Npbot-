/**
 * DI Container — single composition root. Wires all dependencies once.
 *
 * Why a manual container instead of inversify/tsyringe?
 *   - 30 lines vs 200KB of metadata reflection
 *   - Full type safety, no string keys
 *   - Easy to read top-to-bottom
 *   - Trivially mockable in tests (pass overrides)
 */
import { loadConfig } from "./shared/config.js";
import { getPrisma } from "./infrastructure/persistence/prisma.js";
import { getRedis } from "./infrastructure/redis/redis.js";
import { RedisRateLimiter } from "./infrastructure/redis/RedisRateLimiter.js";
import { PrismaUserRepo } from "./infrastructure/persistence/repositories/PrismaUserRepo.js";
import { PrismaDraftRepo } from "./infrastructure/persistence/repositories/PrismaDraftRepo.js";
import { PrismaShipmentRepo } from "./infrastructure/persistence/repositories/PrismaShipmentRepo.js";
import {
  PrismaAllowedChatRepo,
  PrismaAuditLogRepo,
  PrismaCustomerRepo,
  PrismaFailedRequestRepo,
  PrismaIncomingMessageRepo,
  PrismaNpCacheRepo,
} from "./infrastructure/persistence/repositories/index.js";
import { NovaPoshtaHttpClient } from "./infrastructure/nova-poshta/NovaPoshtaHttpClient.js";
import { NpRawFetcherHttp } from "./infrastructure/nova-poshta/NpRawFetcherHttp.js";
import { IngestMessageUseCase } from "./application/use-cases/IngestMessageUseCase.js";
import { CreateTtnUseCase } from "./application/use-cases/CreateTtnUseCase.js";
import { SyncNpWarehousesUseCase } from "./application/use-cases/SyncNpWarehousesUseCase.js";

export type AppContainer = ReturnType<typeof buildContainer> extends Promise<infer T> ? T : never;

export async function buildContainer() {
  const config = loadConfig();
  const prisma = getPrisma();
  const redis = getRedis();

  // ── Repositories ──────────────────────────────────────────
  const userRepo = new PrismaUserRepo(prisma);
  const draftRepo = new PrismaDraftRepo(prisma);
  const shipmentRepo = new PrismaShipmentRepo(prisma);
  const customerRepo = new PrismaCustomerRepo(prisma);
  const chatRepo = new PrismaAllowedChatRepo(prisma);
  const msgRepo = new PrismaIncomingMessageRepo(prisma);
  const auditRepo = new PrismaAuditLogRepo(prisma);
  const failedRepo = new PrismaFailedRequestRepo(prisma);
  const npCacheRepo = new PrismaNpCacheRepo(prisma);

  // ── Adapters ──────────────────────────────────────────────
  const rateLimiter = new RedisRateLimiter(redis);
  const np = new NovaPoshtaHttpClient(config, npCacheRepo, failedRepo);
  const npRawFetcher = new NpRawFetcherHttp(config);

  // ── Use cases ─────────────────────────────────────────────
  const ingestMessageUseCase = new IngestMessageUseCase(userRepo, draftRepo, chatRepo, msgRepo);
  const createTtnUseCase = new CreateTtnUseCase(draftRepo, shipmentRepo, customerRepo, failedRepo, np);
  const syncWarehousesUseCase = new SyncNpWarehousesUseCase(prisma, npRawFetcher);

  return {
    config,
    prisma,
    redis,
    rateLimiter,
    userRepo,
    draftRepo,
    shipmentRepo,
    customerRepo,
    chatRepo,
    msgRepo,
    auditRepo,
    failedRepo,
    npCacheRepo,
    np,
    npRawFetcher,
    ingestMessageUseCase,
    createTtnUseCase,
    syncWarehousesUseCase,
  } as const;
}
