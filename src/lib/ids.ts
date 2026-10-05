import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Collision-resistant, log-friendly sortable id: `<prefix>_<base36 time><random>`. */
export function newId(prefix: string): string {
  const now = Date.now();
  const time = now.toString(36).padStart(9, "0");
  const rand = randomBytes(5).toString("hex").slice(0, 8);
  return `${prefix}_${time}${rand}`;
}

/** Public, unguessable token used in proposal / chat / unsubscribe links. */
export function newPublicToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function uuid(): string {
  return randomUUID();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** One-way hash for IPs / user agents so audit logs never store PII in the clear. */
export function hashPii(value: string | null | undefined): string | null {
  if (!value) return null;
  const salt = process.env.AUTH_SECRET ?? "leadforge-dev-salt";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Human-readable sequential-ish reference, e.g. `LD-4F2K9`. */
export function reference(prefix: string): string {
  const n = randomBytes(4).readUInt32BE(0) % 0xfffff;
  return `${prefix}-${n.toString(36).toUpperCase().padStart(4, "0")}`;
}

const BASE = ALPHABET.length;
export function shortcode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % BASE];
  return out;
}
