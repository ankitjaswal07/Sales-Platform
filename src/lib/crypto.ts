import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * Credential handling primitives.
 *
 *  - Passwords: scrypt (N=16384, r=8, p=1) with a per-user 16-byte salt.
 *    Verified in constant time. Format: `scrypt$<salt-b64>$<hash-b64>`.
 *  - Integration secrets: AES-256-GCM, key derived from AUTH_SECRET.
 *    Ciphertext format: `v1.<iv-b64>.<tag-b64>.<data-b64>` so we can rotate
 *    the scheme later without ambiguity.
 *  - MFA is *ready* rather than enforced: `mfa_secret_enc` is encrypted at rest
 *    and the login flow already branches on `mfa_enabled` (see docs/SECURITY.md).
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    // Development fallback — loud, but never silently insecure in production.
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set to a 32+ character value in production.");
    }
    return "leadforge-development-secret-do-not-use-in-production";
  }
  return value;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): { ok: boolean; needsRehash: boolean } {
  try {
    const [scheme, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !saltB64 || !hashB64) return { ok: false, needsRehash: false };
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return { ok: timingSafeEqual(expected, actual), needsRehash: false };
  } catch {
    return { ok: false, needsRehash: false };
  }
}

function encryptionKey(): Buffer {
  return scryptSync(secret(), "leadforge-secret-v1", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [version, ivB64, tagB64, dataB64] = payload.split(".");
    if (version !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Mask a secret for display: `sk-…4f2a` — never return full credentials to the client. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string; hints: string[] } {
  const hints: string[] = [];
  let score = 0;
  if (password.length >= 10) score += 1;
  else hints.push("Use at least 10 characters");
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  else hints.push("Mix upper and lower case");
  if (/\d/.test(password)) score += 1;
  else hints.push("Add a number");
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  else hints.push("Add a symbol");
  const labels = ["Very weak", "Weak", "Fair", "Strong", "Excellent"];
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score], hints };
}

/**
 * Inbound webhook verification. Providers differ slightly, so we accept either
 * the raw hex digest or the `sha256=<digest>` prefixed form and always compare
 * in constant time.
 */
export function verifyWebhookSignature(payload: string, signature: string, secretValue: string): boolean {
  const expected = createHmac("sha256", secretValue).update(payload).digest("hex");
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function signWebhookPayload(payload: string, secretValue: string): string {
  return createHmac("sha256", secretValue).update(payload).digest("hex");
}
