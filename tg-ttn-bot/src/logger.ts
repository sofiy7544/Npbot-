/**
 * Tiny structured logger — writes both to console and to logs/bot.log
 * (gitignored). Format: ISO timestamp + LEVEL + tag + JSON payload.
 *
 * Why a custom logger and not winston/pino? — zero deps, easy to tail
 * (`tail -f logs/bot.log`), single file, ESM-friendly.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const LOG_FILE = process.env.LOG_FILE ?? "logs/bot.log";

let dirEnsured = false;
async function ensureDir() {
  if (dirEnsured) return;
  try {
    await mkdir(dirname(LOG_FILE), { recursive: true });
  } catch {
    /* ignore */
  }
  dirEnsured = true;
}

type Level = "info" | "warn" | "error" | "debug";

async function write(level: Level, tag: string, data: unknown) {
  await ensureDir();
  const ts = new Date().toISOString();
  const payload = data === undefined ? "" : " " + safeStringify(data);
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${tag}]${payload}\n`;
  // Don't await — fire and forget so handlers don't block on disk
  appendFile(LOG_FILE, line, "utf8").catch(() => {
    /* swallow */
  });
  // also console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(line.trimEnd());
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
  } catch {
    return String(v);
  }
}

export const log = {
  info: (tag: string, data?: unknown) => void write("info", tag, data),
  warn: (tag: string, data?: unknown) => void write("warn", tag, data),
  error: (tag: string, data?: unknown) => void write("error", tag, data),
  debug: (tag: string, data?: unknown) => {
    if (process.env.DEBUG) void write("debug", tag, data);
  },
};
