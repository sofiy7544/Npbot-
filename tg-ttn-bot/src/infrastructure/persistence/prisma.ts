/**
 * Prisma singleton — single PrismaClient shared across the app.
 * Lazy init, graceful shutdown.
 */
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../shared/config.js";
import { makeLogger } from "../../shared/logger.js";

const log = makeLogger("prisma");

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (client) return client;
  const cfg = loadConfig();
  client = new PrismaClient({
    datasources: { db: { url: cfg.DATABASE_URL } },
    log: cfg.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  log.info("prisma.connected");
  return client;
}

export async function closePrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
