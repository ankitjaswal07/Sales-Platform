import "server-only";

import { all, insert, one, parseJson, run, toBool, update } from "..";
import { newId } from "../../ids";
import { hashPassword, verifyPassword } from "../../crypto";
import { ROLE_PERMISSIONS, type Permission, type UserRole } from "../../types";
import type { Organization, OrgSettings, User } from "./types";

/**
 * Organization, user, session and permission storage.
 *
 * Multi-tenancy is structural from day one (§48): every query is scoped by
 * `org_id`. Adding a second agency is a data operation, not a refactor.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Row mapping
   ══════════════════════════════════════════════════════════════════════════ */

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  logo_url: string | null;
  brand_primary: string;
  brand_accent: string;
  brand_font: string;
  address: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  timezone: string;
  currency: string;
  plan: string;
  settings_json: string;
  onboarding_json: string;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  org_id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  title: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string;
  mfa_enabled: number;
  timezone: string | null;
  quota_monthly: number | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapOrganization(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    legalName: row.legal_name,
    logoUrl: row.logo_url,
    brandPrimary: row.brand_primary,
    brandAccent: row.brand_accent,
    brandFont: row.brand_font,
    address: row.address,
    city: row.city,
    country: row.country,
    email: row.email,
    phone: row.phone,
    website: row.website,
    timezone: row.timezone,
    currency: row.currency,
    plan: row.plan,
    settings: parseJson<OrgSettings>(row.settings_json, defaultOrgSettings()),
    onboarding: parseJson<Record<string, boolean>>(row.onboarding_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    name: row.name,
    role: row.role,
    title: row.title,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    status: row.status,
    mfaEnabled: toBool(row.mfa_enabled),
    timezone: row.timezone,
    quotaMonthly: row.quota_monthly,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function defaultOrgSettings(): OrgSettings {
  return {
    branding: { primary: "#5b5bd6", accent: "#e8763a", font: "Geist", proposalTemplate: "signature", showAgencyLogo: true },
    sales: {
      defaultCurrency: "GBP",
      defaultValidityDays: 21,
      followUpCadence: [4, 5, 6, 7],
      requireProposalApproval: true,
      autoSendUnder: 0,
    },
    notifications: { email: true, whatsapp: false, browser: true, highIntent: true, proposalOpened: true, dailyDigest: true, quietHours: { from: "20:00", to: "07:30" } },
    ai: { tone: "consultative", aggressiveness: "measured", qualificationRules: "standard", discloseAi: true, model: "local" },
    leadScoring: { weights: { businessQuality: 0.24, websiteOpportunity: 0.3, buyingPotential: 0.2, contactability: 0.14, buyingIntent: 0.12 }, hotThreshold: 78, warmThreshold: 58 },
    pipeline: { customStages: [], slaHours: 24 },
    security: { enforceMfa: false, sessionHours: 720, ipAllowlist: [], requireApprovalForDeletion: true },
    data: { retentionDays: 730, autoDeleteLostAfterDays: 0, allowExports: true },
  };
}

function now(): string {
  return new Date().toISOString();
}

/* ══════════════════════════════════════════════════════════════════════════
   Organizations
   ══════════════════════════════════════════════════════════════════════════ */

export function getOrganization(orgId: string): Organization | null {
  const row = one<OrgRow>("SELECT * FROM organizations WHERE id = ?", [orgId]);
  return row ? mapOrganization(row) : null;
}

export function getPrimaryOrganization(): Organization | null {
  const row = one<OrgRow>("SELECT * FROM organizations ORDER BY created_at ASC LIMIT 1");
  return row ? mapOrganization(row) : null;
}

export function createOrganization(input: {
  name: string;
  slug: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  brandPrimary?: string;
  brandAccent?: string;
  currency?: string;
  timezone?: string;
}): Organization {
  const id = newId("org");
  const timestamp = now();
  insert("organizations", {
    id,
    name: input.name,
    slug: input.slug,
    logo_url: input.logoUrl ?? null,
    brand_primary: input.brandPrimary ?? "#5b5bd6",
    brand_accent: input.brandAccent ?? "#e8763a",
    brand_font: "Geist",
    email: input.email ?? null,
    phone: input.phone ?? null,
    website: input.website ?? null,
    currency: input.currency ?? "GBP",
    timezone: input.timezone ?? "Europe/London",
    plan: "scale",
    settings_json: defaultOrgSettings(),
    onboarding_json: {},
    created_at: timestamp,
    updated_at: timestamp,
  });
  seedDefaultStages(id);
  seedDefaultRoles(id);
  return getOrganization(id)!;
}

export function updateOrganization(orgId: string, patch: Partial<Record<string, unknown>>): Organization | null {
  const allowed = [
    "name", "legal_name", "logo_url", "brand_primary", "brand_accent", "brand_font",
    "address", "city", "country", "email", "phone", "website", "timezone", "currency", "plan",
  ];
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    if (allowed.includes(key)) values[key] = value;
  });
  if (Object.keys(values).length === 0) return getOrganization(orgId);
  values.updated_at = now();
  update("organizations", orgId, values);
  return getOrganization(orgId);
}

export function updateOrgSettings(orgId: string, patch: Partial<OrgSettings>): OrgSettings {
  const org = getOrganization(orgId);
  const current = org?.settings ?? defaultOrgSettings();
  const merged: OrgSettings = {
    ...current,
    ...patch,
    branding: { ...current.branding, ...(patch.branding ?? {}) },
    sales: { ...current.sales, ...(patch.sales ?? {}) },
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
    ai: { ...current.ai, ...(patch.ai ?? {}) },
    leadScoring: { ...current.leadScoring, ...(patch.leadScoring ?? {}) },
    pipeline: { ...current.pipeline, ...(patch.pipeline ?? {}) },
    security: { ...current.security, ...(patch.security ?? {}) },
    data: { ...current.data, ...(patch.data ?? {}) },
  };
  run("UPDATE organizations SET settings_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(merged), now(), orgId]);
  return merged;
}

export function setOnboardingStep(orgId: string, key: string, complete: boolean): Record<string, boolean> {
  const org = getOrganization(orgId);
  const onboarding = { ...(org?.onboarding ?? {}), [key]: complete };
  run("UPDATE organizations SET onboarding_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(onboarding), now(), orgId]);
  return onboarding;
}

/* ══════════════════════════════════════════════════════════════════════════
   Users
   ══════════════════════════════════════════════════════════════════════════ */

export function findUserByEmail(orgId: string, email: string): UserRow | null {
  return one<UserRow>("SELECT * FROM users WHERE org_id = ? AND email = ? COLLATE NOCASE", [orgId, email]);
}

export function getUserById(id: string): User | null {
  const row = one<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return row ? mapUser(row) : null;
}

export function listUsers(orgId: string): (User & { passwordHash?: never })[] {
  return all<UserRow>("SELECT * FROM users WHERE org_id = ? ORDER BY created_at ASC", [orgId]).map(mapUser);
}

export function createUser(input: {
  orgId: string;
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  title?: string | null;
  phone?: string | null;
}): User {
  const id = newId("usr");
  const timestamp = now();
  insert("users", {
    id,
    org_id: input.orgId,
    email: input.email.toLowerCase(),
    password_hash: hashPassword(input.password),
    name: input.name,
    role: input.role ?? "sales_agent",
    title: input.title ?? null,
    phone: input.phone ?? null,
    status: "active",
    mfa_enabled: 0,
    timezone: "Europe/London",
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getUserById(id)!;
}

export function updateUser(userId: string, patch: Partial<Record<string, unknown>>): User | null {
  const allowed = ["name", "email", "role", "title", "phone", "avatar_url", "status", "mfa_enabled", "mfa_secret_enc", "timezone", "quota_monthly"];
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    if (allowed.includes(key)) values[key] = value;
  });
  if ("email" in values && typeof values.email === "string") values.email = values.email.toLowerCase();
  if (Object.keys(values).length === 0) return getUserById(userId);
  values.updated_at = now();
  update("users", userId, values);
  return getUserById(userId);
}

export function changePassword(userId: string, newPassword: string): void {
  update("users", userId, { password_hash: hashPassword(newPassword), updated_at: now() });
}

export function verifyUserCredentials(
  orgId: string,
  email: string,
  password: string,
): { user: User; row: UserRow } | { error: "not_found" | "invalid_password" | "suspended" } {
  const row = findUserByEmail(orgId, email);
  if (!row) return { error: "not_found" };
  const result = verifyPassword(password, row.password_hash);
  if (!result.ok) return { error: "invalid_password" };
  if (row.status !== "active") return { error: "suspended" };
  run("UPDATE users SET last_login_at = ? WHERE id = ?", [now(), row.id]);
  return { user: mapUser({ ...row, last_login_at: now() }), row };
}

/* ══════════════════════════════════════════════════════════════════════════
   Sessions
   ══════════════════════════════════════════════════════════════════════════ */

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  ip_hash: string | null;
  user_agent: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export function createSession(input: {
  userId: string;
  tokenHash: string;
  ipHash?: string | null;
  userAgent?: string | null;
  ttlHours: number;
}): SessionRow {
  const id = newId("ses");
  const timestamp = now();
  const expiresAt = new Date(Date.now() + input.ttlHours * 3600_000).toISOString();
  insert("sessions", {
    id,
    user_id: input.userId,
    token_hash: input.tokenHash,
    ip_hash: input.ipHash ?? null,
    user_agent: input.userAgent ?? null,
    expires_at: expiresAt,
    created_at: timestamp,
  });
  return one<SessionRow>("SELECT * FROM sessions WHERE id = ?", [id])!;
}

export function getSessionByTokenHash(tokenHash: string): SessionRow | null {
  return one<SessionRow>("SELECT * FROM sessions WHERE token_hash = ?", [tokenHash]);
}

export function revokeSession(sessionId: string): void {
  run("UPDATE sessions SET revoked_at = ? WHERE id = ?", [now(), sessionId]);
}

export function revokeAllUserSessions(userId: string): void {
  run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [now(), userId]);
}

export function purgeExpiredSessions(): number {
  const result = run("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL", [now()]);
  return result.changes;
}

/* ══════════════════════════════════════════════════════════════════════════
   Permissions
   ══════════════════════════════════════════════════════════════════════════ */

export function permissionsForRole(role: UserRole): Permission[] | ["*"] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: UserRole, permission: Permission): boolean {
  const permissions = permissionsForRole(role);
  if (permissions[0] === "*") return true;
  return (permissions as Permission[]).includes(permission);
}

export function assertPermission(role: UserRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new PermissionError(`Your role (${role}) does not include the "${permission}" permission.`);
  }
}

export class PermissionError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export function listRoles(orgId: string): { key: string; name: string; description: string | null; permissions: Permission[]; isSystem: boolean; userCount: number }[] {
  const rows = all<{ key: string; name: string; description: string | null; permissions_json: string; is_system: number }>(
    "SELECT * FROM roles WHERE org_id = ? ORDER BY is_system DESC, name ASC",
    [orgId],
  );
  const counts = all<{ role: string; count: number }>("SELECT role, COUNT(*) AS count FROM users WHERE org_id = ? GROUP BY role", [orgId]);
  const countMap = new Map(counts.map((c) => [c.role, c.count]));
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    description: row.description,
    permissions: parseJson<Permission[]>(row.permissions_json, []),
    isSystem: toBool(row.is_system),
    userCount: countMap.get(row.key) ?? 0,
  }));
}

export function seedDefaultRoles(orgId: string): void {
  const existing = one<{ c: number }>("SELECT COUNT(*) AS c FROM roles WHERE org_id = ?", [orgId]);
  if ((existing?.c ?? 0) > 0) return;
  const timestamp = now();
  Object.entries(ROLE_PERMISSIONS).forEach(([role, permissions]) => {
    insert("roles", {
      id: newId("rol"),
      org_id: orgId,
      key: role,
      name: role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: roleDescription(role),
      permissions_json: permissions,
      is_system: 1,
      created_at: timestamp,
    });
  });
}

function roleDescription(role: string): string {
  const descriptions: Record<string, string> = {
    owner: "Full access to every feature, setting and billing detail.",
    admin: "Manages team, integrations, settings and all sales data. Cannot delete the organisation.",
    sales_manager: "Owns the pipeline, campaigns and proposal approvals across the team.",
    sales_agent: "Works assigned leads, conversations, tasks and proposals.",
    researcher: "Finds and audits businesses; cannot send outreach or approve proposals.",
    designer: "Creates website concepts and proposal content; read-only on pipeline stages.",
    developer: "Sees won projects and delivery tasks only.",
  };
  return descriptions[role] ?? "";
}

/* ══════════════════════════════════════════════════════════════════════════
   Pipeline stages
   ══════════════════════════════════════════════════════════════════════════ */

export function seedDefaultStages(orgId: string): void {
  const existing = one<{ c: number }>("SELECT COUNT(*) AS c FROM lead_stages WHERE org_id = ?", [orgId]);
  if ((existing?.c ?? 0) > 0) return;
  const stages: { key: string; name: string; probability: number; color: string; sla?: number }[] = [
    { key: "new", name: "New", probability: 5, color: "#6b7280", sla: 24 },
    { key: "qualified", name: "Qualified", probability: 15, color: "#0ea5e9" },
    { key: "contacted", name: "Contacted", probability: 25, color: "#6366f1" },
    { key: "engaged", name: "Engaged", probability: 40, color: "#8b5cf6" },
    { key: "interested", name: "Interested", probability: 55, color: "#f59e0b" },
    { key: "proposal_sent", name: "Proposal Sent", probability: 65, color: "#f97316" },
    { key: "meeting_scheduled", name: "Meeting", probability: 75, color: "#eab308" },
    { key: "negotiation", name: "Negotiation", probability: 85, color: "#ef4444" },
    { key: "won", name: "Won", probability: 100, color: "#10b981" },
    { key: "lost", name: "Lost", probability: 0, color: "#9ca3af" },
  ];
  const timestamp = now();
  stages.forEach((stage, index) => {
    insert("lead_stages", {
      id: newId("stg"),
      org_id: orgId,
      key: stage.key,
      name: stage.name,
      position: index,
      type: stage.key === "won" ? "won" : stage.key === "lost" ? "lost" : "open",
      color: stage.color,
      probability: stage.probability,
      sla_hours: stage.sla ?? null,
      is_active: 1,
    });
  });
  void timestamp;
}

export function listStages(orgId: string): {
  key: string;
  name: string;
  position: number;
  type: string;
  color: string | null;
  probability: number;
  slaHours: number | null;
  isActive: boolean;
}[] {
  return all<{
    key: string; name: string; position: number; type: string; color: string | null;
    probability: number; sla_hours: number | null; is_active: number;
  }>("SELECT * FROM lead_stages WHERE org_id = ? ORDER BY position ASC", [orgId]).map((row) => ({
    key: row.key,
    name: row.name,
    position: row.position,
    type: row.type,
    color: row.color,
    probability: row.probability,
    slaHours: row.sla_hours,
    isActive: toBool(row.is_active),
  }));
}
