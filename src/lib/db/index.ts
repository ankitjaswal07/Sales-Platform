import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

/**
 * Single embedded database handle.
 *
 * Next.js dev mode hot-reloads modules, so the handle is cached on `globalThis`
 * to avoid leaking file descriptors and WAL writers across reloads.
 */

type SqliteDb = Database.Database;

const globalForDb = globalThis as unknown as { __leadforgeDb?: SqliteDb };

function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_PATH ?? "data/leadforge.db";
  const absolute = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  return absolute;
}

function openDatabase(): SqliteDb {
  const file = resolveDatabasePath();
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 8000");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA_SQL);

  const current = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!current) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('initialized_at', ?)").run(new Date().toISOString());
  }
  return db;
}

export function getDb(): SqliteDb {
  if (!globalForDb.__leadforgeDb) {
    globalForDb.__leadforgeDb = openDatabase();
  }
  return globalForDb.__leadforgeDb;
}

export function isDatabaseInitialized(): boolean {
  try {
    const row = getDb().prepare("SELECT COUNT(*) AS c FROM organizations").get() as { c: number };
    return row.c > 0;
  } catch {
    return false;
  }
}

/* ── query helpers ───────────────────────────────────────────────────────── */

export function one<T>(sql: string, params: unknown[] = []): T | null {
  return (getDb().prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
}

export function all<T>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function run(sql: string, params: unknown[] = []): Database.RunResult {
  return getDb().prepare(sql).run(...(params as never[]));
}

export function many(...statements: Array<() => void>): void {
  const db = getDb();
  db.transaction(() => statements.forEach((fn) => fn()))();
}

export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)() as T;
}

export function pluck<T = unknown>(sql: string, params: unknown[] = []): T | null {
  const row = getDb().prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined;
  if (!row) return null;
  return Object.values(row)[0] as T;
}

/** Insert helper that only writes the columns actually provided. */
export function insert(table: string, values: Record<string, unknown>): void {
  const keys = Object.keys(values);
  const placeholders = keys.map(() => "?").join(", ");
  run(
    `INSERT INTO ${table} (${keys.map(quoteIdent).join(", ")}) VALUES (${placeholders})`,
    keys.map((k) => normalizeValue(values[k])),
  );
}

export function update(table: string, id: string, values: Record<string, unknown>): void {
  const keys = Object.keys(values).filter((k) => k !== "id");
  if (keys.length === 0) return;
  run(
    `UPDATE ${table} SET ${keys.map((k) => `${quoteIdent(k)} = ?`).join(", ")} WHERE id = ?`,
    [...keys.map((k) => normalizeValue(values[k])), id],
  );
}

export function bool(value: unknown): 0 | 1 {
  return value ? 1 : 0;
}

export function normalizeValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number | bigint | Buffer;
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

/* ── json helpers ────────────────────────────────────────────────────────── */

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}
