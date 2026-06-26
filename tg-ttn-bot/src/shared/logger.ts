/**
 * Structured logger using pino (10x faster than winston, ~70× cheaper than JSON.stringify+console.log).
 *
 * - Production: NDJSON to stdout + file rotation via OS (logrotate / Docker)
 * - Development: pino-pretty for readable colorized output
 *
 * Always log with structured context (`log.info({ shipmentId, requestId }, "ttn.created")`)
 * — never string interpolation. Correlation IDs propagate via AsyncLocalStorage.
 */
import { pino, type Logger } from "pino";
import { AsyncLocalStorage } from "node:async_hooks";
import { loadConfig } from "./config.js";

const cfg = loadConfig();

const baseLogger: Logger = pino({
  level: cfg.LOG_LEVEL,
  base: {
    service: "tg-ttn-bot",
    env: cfg.NODE_ENV,
    pid: process.pid,
  },
  redact: {
    // Never log these — secrets / PII
    paths: [
      "*.password",
      "*.token",
      "*.apiKey",
      "*.NP_API_KEY",
      "*.TG_BOT_TOKEN",
      "*.ADMIN_API_TOKEN",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: cfg.NODE_ENV === "development"
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,service,env" },
      }
    : undefined,
});

// ─────────────────────────────────────────────────────────────────────
// Correlation ID propagation via AsyncLocalStorage.
// Every Telegram update / HTTP request gets a unique request_id that
// flows through ALL downstream calls without manual threading.
// ─────────────────────────────────────────────────────────────────────

type LogContext = {
  requestId?: string;
  userId?: number | bigint;
  chatId?: number | bigint;
  draftId?: number | bigint;
  shipmentId?: number | bigint;
};

const als = new AsyncLocalStorage<LogContext>();

export function withContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run({ ...als.getStore(), ...ctx }, fn);
}

export function getContext(): LogContext | undefined {
  return als.getStore();
}

function makeChildLogger(base: Logger): Logger {
  return new Proxy(base, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      if (!["fatal", "error", "warn", "info", "debug", "trace"].includes(String(prop))) return value;
      return (...args: unknown[]) => {
        const ctx = als.getStore();
        if (ctx && typeof args[0] === "object" && args[0] !== null) {
          (args[0] as Record<string, unknown>).ctx = ctx;
        } else if (ctx) {
          args.unshift({ ctx });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (value as any).apply(target, args);
      };
    },
  });
}

export const log: Logger = makeChildLogger(baseLogger);

/** Make a logger scoped to a particular module. */
export function makeLogger(module: string): Logger {
  return makeChildLogger(baseLogger.child({ module }));
}
