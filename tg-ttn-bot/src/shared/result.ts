/**
 * Result type — Rust-style typed error handling.
 * Forces callers to handle errors explicitly instead of try/catch ping-pong.
 *
 * Usage:
 *   const r = await createTtn(input);
 *   if (!r.ok) { log.error(r.error); return; }
 *   const ttn = r.value;
 */

export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Typed application error with category for retry/alerting decisions. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context: Record<string, unknown> = {},
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      cause: this.cause instanceof Error ? { name: this.cause.name, message: this.cause.message } : this.cause,
    };
  }
}

export type ErrorCode =
  // Validation / user input
  | "validation.invalid_input"
  | "validation.missing_field"
  | "validation.field_too_long"

  // Parsing
  | "parser.incomplete_draft"
  | "parser.unrecognized_format"

  // Nova Poshta
  | "np.api_error"
  | "np.rate_limited"
  | "np.timeout"
  | "np.network_error"
  | "np.city_not_found"
  | "np.warehouse_not_found"
  | "np.invalid_sender_config"
  | "np.duplicate_ttn"

  // Telegram
  | "tg.api_error"
  | "tg.flood_wait"
  | "tg.forbidden"
  | "tg.message_not_found"

  // Persistence
  | "db.unique_violation"
  | "db.connection_lost"
  | "db.transaction_failed"
  | "db.not_found"

  // Redis / Queue
  | "redis.connection_lost"
  | "queue.job_failed"
  | "queue.dead_letter"

  // Authorization
  | "auth.forbidden"
  | "auth.rate_limited"
  | "auth.user_blocked"
  | "auth.chat_not_allowed"

  // System
  | "system.internal_error"
  | "system.timeout"
  | "system.shutdown";

/** Is this error retryable by the job queue? */
export function isRetryable(error: AppError): boolean {
  const retryable: ErrorCode[] = [
    "np.timeout",
    "np.network_error",
    "np.rate_limited",
    "tg.flood_wait",
    "redis.connection_lost",
    "db.connection_lost",
    "system.timeout",
  ];
  return retryable.includes(error.code);
}
