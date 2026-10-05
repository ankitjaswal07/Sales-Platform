import "server-only";

import { insert } from "./db";
import { newId } from "./ids";

/**
 * Structured logging.
 *
 * Every line is emitted as JSON to stdout so it can be shipped to any log
 * pipeline, and important scopes are also persisted to `app_logs` for the
 * in-product Diagnostics page (§51 Observability). Persistence is best-effort:
 * a logging failure must never break a user-facing request.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const PERSIST: LogLevel[] = ["warn", "error"];

function threshold(): number {
  const configured = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
  return LEVELS[configured] ?? LEVELS.info;
}

export function log(
  level: LogLevel,
  scope: string,
  message: string,
  meta: Record<string, unknown> = {},
  options: { orgId?: string | null; persist?: boolean } = {},
): void {
  if (LEVELS[level] < threshold()) return;
  const record = { ts: new Date().toISOString(), level, scope, message, ...meta };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  if (options.persist ?? PERSIST.includes(level)) {
    try {
      insert("app_logs", {
        id: newId("log"),
        org_id: options.orgId ?? null,
        level,
        scope,
        message,
        meta_json: meta,
        created_at: new Date().toISOString(),
      });
    } catch {
      /* logging must never throw */
    }
  }
}

export const logger = {
  debug: (scope: string, message: string, meta?: Record<string, unknown>, options?: { orgId?: string | null }) =>
    log("debug", scope, message, meta, options),
  info: (scope: string, message: string, meta?: Record<string, unknown>, options?: { orgId?: string | null }) =>
    log("info", scope, message, meta, options),
  warn: (scope: string, message: string, meta?: Record<string, unknown>, options?: { orgId?: string | null }) =>
    log("warn", scope, message, meta, options),
  error: (scope: string, message: string, meta?: Record<string, unknown>, options?: { orgId?: string | null }) =>
    log("error", scope, message, meta ?? {}, { ...options, persist: true }),
  /** Time a unit of work and log the outcome + duration. */
  async timed<T>(scope: string, message: string, fn: () => Promise<T>, meta?: Record<string, unknown>): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      log("info", scope, `${message} completed`, { ...meta, durationMs: Date.now() - started });
      return result;
    } catch (error) {
      log("error", scope, `${message} failed`, {
        ...meta,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

/** Truncate long values before they reach the log store. */
export function brief(value: unknown, max = 240): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
