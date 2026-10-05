import "server-only";

import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { run, one } from "../db";
import { logger } from "../logger";

/**
 * Signed hand-off between the WordPress connector and this application.
 *
 * WordPress cannot run this app (different runtime), so the connector is a
 * launcher: it is given a shared secret, and the person clicks a link that
 * proves — cryptographically — which WordPress user they are, without ever
 * sending a password between the two systems.
 *
 * The scheme is deliberately small:
 *
 *   signature = base64url( HMAC-SHA256( secret, `${action}|${email}|${ts}|${nonce}` ) )
 *
 * and it is only accepted when all four of these hold:
 *   1. `WORDPRESS_CONNECTOR_SECRET` is configured (otherwise the whole feature
 *      is off and says so);
 *   2. the timestamp is inside the TTL window (no long-lived links lying around);
 *   3. the HMAC matches, compared in constant time;
 *   4. the nonce has never been used before (single use, enforced by a primary
 *      key, so a leaked URL cannot be replayed).
 *
 * Every attempt — accepted or rejected — is written to the audit log.
 */

export const LAUNCH_TTL_SECONDS = 180;

export type LaunchAction = "sso" | "status";

export function connectorSecret(): string | null {
  const secret = process.env.WORDPRESS_CONNECTOR_SECRET;
  return secret && secret.length >= 24 ? secret : null;
}

export interface ConnectorConfigState {
  configured: boolean;
  reason?: string;
}

/** Used by the Integrations and Diagnostics screens to report the real state. */
export function connectorState(): ConnectorConfigState {
  const secret = process.env.WORDPRESS_CONNECTOR_SECRET;
  if (!secret) {
    return { configured: false, reason: "WORDPRESS_CONNECTOR_SECRET is not set, so signed WordPress sign-in is disabled." };
  }
  if (secret.length < 24) {
    return { configured: false, reason: "WORDPRESS_CONNECTOR_SECRET is shorter than 24 characters; use a random value of 32+." };
  }
  return { configured: true };
}

export function signPayload(action: LaunchAction, email: string, ts: number, nonce: string, secret: string): string {
  const message = `${action}|${email.toLowerCase()}|${ts}|${nonce}`;
  return createHmac("sha256", secret).update(message).digest("base64url");
}

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides first so inputs of different lengths can still be compared
  // without leaking length information through timing.
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export interface VerifyResult {
  ok: boolean;
  reason?: "not_configured" | "expired" | "bad_signature" | "replayed" | "bad_request";
  message?: string;
}

export interface VerifyInput {
  action: LaunchAction;
  email: string;
  ts: string | number | null;
  nonce: string | null;
  signature: string | null;
  /** Recorded on the token and in the audit log: "wordpress" or a manual test. */
  source?: string;
  orgId: string;
}

export function verifyLaunchToken(input: VerifyInput): VerifyResult {
  const state = connectorState();
  if (!state.configured) {
    return { ok: false, reason: "not_configured", message: state.reason };
  }
  if (!input.email || !input.nonce || !input.ts || !input.signature) {
    return { ok: false, reason: "bad_request", message: "The launch link is missing one of email, ts, nonce or sig." };
  }
  if (input.nonce.length > 128) {
    return { ok: false, reason: "bad_request", message: "The launch nonce is not valid." };
  }

  const timestamp = Number(input.ts);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "bad_request", message: "The launch timestamp is not valid." };
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > LAUNCH_TTL_SECONDS) {
    return {
      ok: false,
      reason: "expired",
      message: `The launch link expired after ${LAUNCH_TTL_SECONDS} seconds. Open it again from WordPress.`,
    };
  }

  const expected = signPayload(input.action, input.email, timestamp, input.nonce, connectorSecret() as string);
  if (!constantTimeEquals(expected, input.signature)) {
    return { ok: false, reason: "bad_signature", message: "The launch signature did not match." };
  }

  // Single use: the primary key rejects a second attempt with the same nonce,
  // which is also what stops a shared or logged URL from being replayed.
  const now = Date.now();
  run("DELETE FROM sso_launch_tokens WHERE expires_at < ?", [new Date(now).toISOString()]);
  const existing = one<{ nonce: string }>("SELECT nonce FROM sso_launch_tokens WHERE nonce = ?", [input.nonce]);
  if (existing) {
    return { ok: false, reason: "replayed", message: "That launch link has already been used. Generate a fresh one." };
  }

  try {
    run(
      `INSERT INTO sso_launch_tokens (nonce, org_id, email, source, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.nonce,
        input.orgId,
        input.email.toLowerCase(),
        input.source ?? "wordpress",
        new Date(now).toISOString(),
        new Date(now + LAUNCH_TTL_SECONDS * 1000).toISOString(),
      ],
    );
  } catch {
    // Two requests raced for the same nonce; the loser must not be trusted.
    return { ok: false, reason: "replayed", message: "That launch link has already been used." };
  }

  return { ok: true };
}

export function logConnectorAttempt(input: {
  orgId: string | null;
  action: LaunchAction;
  email: string | null;
  ok: boolean;
  reason?: string;
  source?: string;
}): void {
  logger[input.ok ? "info" : "warn"]("connector", input.ok ? "WordPress sign-in accepted" : "WordPress sign-in rejected", {
    action: input.action,
    email: input.email,
    reason: input.reason ?? null,
    source: input.source ?? "wordpress",
  });
}

/**
 * Server-to-server callers sign a different message — they are not naming a
 * user, they are asking for data — so the payload is `${action}|${ts}|${nonce}`.
 */
export function signStatusRequest(ts: number, nonce: string, secret: string): string {
  return createHmac("sha256", secret).update(`status|${ts}|${nonce}`).digest("base64url");
}

export function verifyStatusRequest(input: { ts: string | number | null; nonce: string | null; signature: string | null }): VerifyResult {
  const state = connectorState();
  if (!state.configured) return { ok: false, reason: "not_configured", message: state.reason };
  if (!input.nonce || !input.ts || !input.signature) {
    return { ok: false, reason: "bad_request", message: "Provide ts, nonce and sig." };
  }
  const timestamp = Number(input.ts);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > LAUNCH_TTL_SECONDS) {
    return { ok: false, reason: "expired", message: `Requests must be signed within ${LAUNCH_TTL_SECONDS} seconds.` };
  }
  const expected = signStatusRequest(timestamp, input.nonce, connectorSecret() as string);
  if (!constantTimeEquals(expected, input.signature)) {
    return { ok: false, reason: "bad_signature", message: "The request signature did not match." };
  }
  return { ok: true };
}
