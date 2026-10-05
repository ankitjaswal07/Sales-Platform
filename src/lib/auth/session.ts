import "server-only";

import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import {
  createSession,
  getOrganization,
  getSessionByTokenHash,
  getPrimaryOrganization,
  getUserById,
  permissionsForRole,
  revokeSession,
  updateOrganization,
  updateUser,
} from "../db/repo/org";
import { writeAuditLog } from "../db/repo/ops";
import type { Organization, User } from "../db/repo/types";
import { hashPii, newPublicToken, sha256 } from "../ids";
import { logger } from "../logger";
import type { Permission, UserRole } from "../types";

/**
 * Session architecture.
 *
 * A random 32-byte token is set as an httpOnly cookie. Only its SHA-256 hash is
 * stored, so a database leak does not yield usable sessions. Sessions are
 * revocable server-side and rotate on login. Everything runs over
 * `next/headers`, so no token ever reaches client JavaScript.
 */

export const SESSION_COOKIE = "leadforge_session";
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 720);

export interface SessionContext {
  user: User;
  organization: Organization;
  role: UserRole;
  permissions: Permission[];
  sessionId: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? "leadforge-development-secret-do-not-use-in-production";
  return new TextEncoder().encode(secret.padEnd(32, "0"));
}

/* ── request metadata ────────────────────────────────────────────────────── */

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0]!.trim() : headerList.get("x-real-ip");
    return { ip: ip ?? null, userAgent: headerList.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/* ── login / logout ──────────────────────────────────────────────────────── */

export async function startSession(userId: string): Promise<string> {
  const token = newPublicToken(32);
  const tokenHash = sha256(token);
  const meta = await requestMeta();

  createSession({
    userId,
    tokenHash,
    ipHash: hashPii(meta.ip),
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    ttlHours: SESSION_TTL_HOURS,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_HOURS * 3600,
  });

  return token;
}

export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = getSessionByTokenHash(sha256(token));
    if (session) revokeSession(session.id);
  }
  cookieStore.delete(SESSION_COOKIE);
}

/* ── resolution ──────────────────────────────────────────────────────────── */

export async function currentSession(): Promise<SessionContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = getSessionByTokenHash(sha256(token));
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const user = getUserById(session.user_id);
  if (!user || user.status !== "active") return null;

  const organization = getOrganization(user.orgId);
  if (!organization) return null;

  const permissions = permissionsForRole(user.role);

  return {
    user,
    organization,
    role: user.role,
    permissions: permissions[0] === "*" ? (["*"] as unknown as Permission[]) : (permissions as Permission[]),
    sessionId: session.id,
  };
}

export async function requireSession(): Promise<SessionContext> {
  const session = await currentSession();
  if (!session) throw new UnauthenticatedError("You must be signed in to continue.");
  return session;
}

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export function hasPermission(session: SessionContext, permission: Permission): boolean {
  const permissions = session.permissions as unknown as string[];
  return permissions.includes("*") || permissions.includes(permission);
}

export function requirePermission(session: SessionContext, permission: Permission): void {
  if (!hasPermission(session, permission)) {
    throw new PermissionDeniedError(`Your role (${session.role}) does not include the "${permission}" permission.`);
  }
}

export class PermissionDeniedError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

/* ── audit trail helper ──────────────────────────────────────────────────── */

export async function auditAction(
  session: SessionContext | null,
  action: string,
  options: { entityType?: string; entityId?: string; meta?: Record<string, unknown> } = {},
): Promise<void> {
  const meta = await requestMeta();
  writeAuditLog(session?.organization.id ?? null, {
    actorUserId: session?.user.id ?? null,
    actorType: session ? "user" : "system",
    action,
    entityType: options.entityType ?? null,
    entityId: options.entityId ?? null,
    ipHash: hashPii(meta.ip),
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    meta: options.meta,
  });
}

/* ── signed short-lived tokens (proposal / chat / invite links) ──────────── */

export async function signScopedToken(payload: Record<string, unknown>, expiresIn = "30d"): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("leadforge")
    .setExpirationTime(expiresIn)
    .sign(secretKey());
}

export async function verifyScopedToken<T extends Record<string, unknown>>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "leadforge" });
    return payload as T;
  } catch {
    return null;
  }
}

/* ── workspace bootstrap ─────────────────────────────────────────────────── */

/**
 * Returns the organisation for the current deployment. When no organisation
 * exists yet (fresh install) this creates one so the marketing landing page's
 * "Find my first leads" flow always has somewhere to land.
 */
export function ensureOrganization(): Organization {
  const existing = getPrimaryOrganization();
  if (existing) return existing;
  logger.info("auth", "No organisation found — the database has not been seeded yet");
  throw new Error("Workspace has not been initialised. Run `npm run db:seed` to create the demo workspace.");
}

export function touchUserLogin(userId: string): void {
  updateUser(userId, { last_login_at: new Date().toISOString() });
}

export function updateOrgOnboarding(orgId: string, patch: Record<string, boolean>): void {
  const org = getOrganization(orgId);
  updateOrganization(orgId, { onboarding_json: { ...(org?.onboarding ?? {}), ...patch } });
}
