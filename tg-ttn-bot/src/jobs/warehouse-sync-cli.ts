/**
 * CLI entry point — run an immediate warehouse sync.
 *
 * Usage:
 *   npm run sync:warehouses                — full sync
 *   npm run sync:warehouses -- --dry-run   — diff only, don't write
 *   npm run sync:warehouses -- --max=10    — limit to 10 cities (for testing)
 *   npm run sync:warehouses -- --resume=<cityRef>  — resume from checkpoint
 *
 * Exit codes:
 *   0  — success
 *   1  — sync failed
 *   2  — config error (e.g. missing NP_API_KEY)
 */
import { buildContainer } from "../main.container.js";
import { closePrisma } from "../infrastructure/persistence/prisma.js";
import { closeRedis } from "../infrastructure/redis/redis.js";
import { log } from "../shared/logger.js";
import { loadConfig } from "../shared/config.js";

function parseArgs(): { dryRun: boolean; maxCities?: number; resume?: string } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const resumeArg = args.find((a) => a.startsWith("--resume="));
  return {
    dryRun,
    maxCities: maxArg ? Number(maxArg.split("=")[1]) : undefined,
    resume: resumeArg ? resumeArg.split("=")[1] : undefined,
  };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.NP_API_KEY) {
    console.error("❌ NP_API_KEY missing — set it in .env to run sync");
    process.exit(2);
  }

  const opts = parseArgs();
  log.info(opts, "cli.starting_sync");

  const container = await buildContainer();
  const r = await container.syncWarehousesUseCase.execute({
    trigger: "manual",
    resumeFromCityRef: opts.resume,
    maxCities: opts.maxCities,
    dryRun: opts.dryRun,
  });

  if (!r.ok) {
    console.error(`\n❌ Sync failed: ${r.error.message}\n`, r.error.context);
    await closeAll();
    process.exit(1);
  }

  console.log("\n✅ Sync complete:");
  console.log(`   Cities fetched:     ${r.value.citiesFetched}`);
  console.log(`   Warehouses fetched: ${r.value.warehousesFetched}`);
  console.log(`   Inserted:           ${r.value.inserted}`);
  console.log(`   Updated:            ${r.value.updated}`);
  console.log(`   Reactivated:        ${r.value.reactivated}`);
  console.log(`   Deactivated:        ${r.value.deactivated}`);
  console.log(`   Unchanged:          ${r.value.unchanged}`);
  console.log(`   Duration:           ${(r.value.durationMs / 1000).toFixed(1)}s`);
  console.log(`   API calls:          ${r.value.apiCalls}`);

  await closeAll();
  process.exit(0);
}

async function closeAll() {
  await closePrisma().catch(() => {});
  await closeRedis().catch(() => {});
}

main().catch((e) => {
  log.fatal({ err: e instanceof Error ? e.stack : String(e) }, "cli.crash");
  process.exit(1);
});
