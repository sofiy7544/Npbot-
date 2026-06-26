/**
 * Typed, validated environment configuration.
 *
 * Calling `loadConfig()` reads `process.env`, validates with Zod, and returns
 * an immutable, fully-typed config object. **Fail fast** on misconfig at startup —
 * NEVER access process.env directly anywhere else in the codebase.
 */
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const Schema = z.object({
  // ─── Runtime ──────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_FILE: z.string().default("logs/bot.log"),

  // ─── Telegram ─────────────────────────────────────────────
  TG_BOT_TOKEN: z.string().min(40, "Telegram bot token looks malformed"),
  TG_WEBHOOK_URL: z.string().url().optional(),       // if set → webhook mode; else long-polling
  TG_WEBHOOK_SECRET: z.string().optional(),
  ALLOWED_CHAT_IDS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n)),
    ),
  ADMIN_TG_IDS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n)),
    ),

  // ─── Database ─────────────────────────────────────────────
  DATABASE_URL: z.string().url().default("postgresql://tgbot:tgbot@localhost:5432/tgttnbot"),

  // ─── Redis ────────────────────────────────────────────────
  REDIS_URL: z.string().default("redis://localhost:6379/0"),

  // ─── Nova Poshta ──────────────────────────────────────────
  NP_MOCK_MODE: z
    .string()
    .default("")
    .transform((s) => s.toLowerCase() === "true"),
  NP_API_KEY: z.string().default(""),
  NP_API_URL: z.string().url().default("https://api.novaposhta.ua/v2.0/json/"),
  NP_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  NP_API_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  NP_API_RATE_LIMIT_PER_SEC: z.coerce.number().int().min(1).max(100).default(8),

  NP_SENDER_CITY_REF: z.string().default(""),
  NP_SENDER_WAREHOUSE_REF: z.string().default(""),
  NP_SENDER_REF: z.string().default(""),
  NP_SENDER_CONTACT_REF: z.string().default(""),
  NP_SENDER_PHONE: z.string().default(""),

  NP_DEFAULT_WEIGHT_KG: z.coerce.number().min(0.01).max(50).default(0.6),
  NP_DEFAULT_VOLUME_M3: z.coerce.number().min(0.0001).max(1).default(0.0004),
  NP_DEFAULT_DESCRIPTION: z.string().default("Термокухоль"),
  NP_DEFAULT_SERVICE_TYPE: z.enum(["WarehouseWarehouse", "WarehouseDoors", "DoorsDoors", "DoorsWarehouse"]).default("WarehouseWarehouse"),
  NP_DEFAULT_PAYER: z.enum(["Sender", "Recipient"]).default("Recipient"),
  NP_DEFAULT_PAYMENT_METHOD: z.enum(["Cash", "NonCash"]).default("Cash"),

  // ─── Draft state ──────────────────────────────────────────
  DRAFT_TTL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(600_000),
  REDIS_CACHE_NP_TTL_S: z.coerce.number().int().min(60).default(604_800),       // 7d

  // ─── Rate limiting ────────────────────────────────────────
  RATE_LIMIT_PER_USER_PER_MIN: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_GLOBAL_PER_SEC: z.coerce.number().int().min(1).default(50),

  // ─── Admin API ────────────────────────────────────────────
  ADMIN_API_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false"),
  ADMIN_API_HOST: z.string().default("0.0.0.0"),
  ADMIN_API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ADMIN_API_TOKEN: z.string().min(16, "Set a strong ADMIN_API_TOKEN (≥16 chars)").default(""),

  // ─── Observability ────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),
  METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
});

export type AppConfig = Readonly<z.infer<typeof Schema>>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("\n❌ Config validation failed:\n");
    for (const issue of parsed.error.issues) {
      console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nFix your .env file (see .env.example) and restart.\n");
    process.exit(1);
  }
  cached = Object.freeze(parsed.data) as AppConfig;
  return cached;
}

/** For tests only — reset cached config. */
export function _resetConfigForTests() {
  cached = null;
}
