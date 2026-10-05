import "server-only";

import { getDb } from "../db";
import { jobStats, listAppLogs, listJobs, listJobLogs, aiUsageSummary, listWebhooks, jobStats as stats, writeAuditLog } from "../db/repo/ops";
import { getPrimaryOrganization, permissionsForRole } from "../db/repo/org";
import { workerStatus, registeredTypes } from "../queue";
import { handlerCatalogue } from "../jobs/handlers";
import { providerConfig } from "../ai/provider";
import { integrationSummary } from "../integrations/registry";
import { storageStatus } from "./storage";
import { databaseStatus } from "../db";
import { logger } from "../logger";
import { APP_VERSION } from "../version";

/**
 * Diagnostics (§51, §58).
 *
 * Answers the two questions an operator actually has: *is this deployment
 * healthy?* and *is any feature silently not working?* Every number here is
 * read from the running system — no optimistic health checks.
 */

export interface HealthCheck {
  key: string;
  label: string;
  status: "healthy" | "degraded" | "down" | "not_configured";
  detail: string;
  hint: string | null;
  href: string | null;
}

export interface DiagnosticsReport {
  version: string;
  generatedAt: string;
  environment: string;
  uptimeSeconds: number;
  counts: Record<string, number>;
  jobs: { queued: number; running: number; failed: number; succeeded: number; oldestQueuedAt: string | null };
  checks: HealthCheck[];
  recentFailures: { id: string; type: string; label: string | null; error: string | null; attempts: number; completedAt: string | null }[];
  logs: { level: string; scope: string; message: string; createdAt: string; context: Record<string, unknown> }[];
  ai: ReturnType<typeof aiUsageSummary> & { provider: string; model: string; mode: string; configured: boolean };
  integrations: ReturnType<typeof integrationSummary>;
  storage: ReturnType<typeof storageStatus>;
}

export function diagnostics(orgId: string): DiagnosticsReport {
  const organization = getPrimaryOrganization();
  const db = getDb();

  const counts = {
    organizations: scalar(db, "SELECT COUNT(*) AS c FROM organizations"),
    users: scalar(db, "SELECT COUNT(*) AS c FROM users"),
    businesses: scalar(db, "SELECT COUNT(*) AS c FROM businesses"),
    contacts: scalar(db, "SELECT COUNT(*) AS c FROM contacts"),
    websites: scalar(db, "SELECT COUNT(*) AS c FROM websites"),
    audits: scalar(db, "SELECT COUNT(*) AS c FROM website_audits"),
    leads: scalar(db, "SELECT COUNT(*) AS c FROM leads"),
    conversations: scalar(db, "SELECT COUNT(*) AS c FROM conversations"),
    messages: scalar(db, "SELECT COUNT(*) AS c FROM messages"),
    proposals: scalar(db, "SELECT COUNT(*) AS c FROM proposals"),
    campaigns: scalar(db, "SELECT COUNT(*) AS c FROM campaigns"),
    emails: scalar(db, "SELECT COUNT(*) AS c FROM emails"),
    tasks: scalar(db, "SELECT COUNT(*) AS c FROM tasks"),
    projects: scalar(db, "SELECT COUNT(*) AS c FROM projects"),
    notifications: scalar(db, "SELECT COUNT(*) AS c FROM notifications"),
    ai_interactions: scalar(db, "SELECT COUNT(*) AS c FROM ai_interactions"),
    audit_logs: scalar(db, "SELECT COUNT(*) AS c FROM audit_logs"),
  };

  const dbStatus = databaseStatus();
  const config = providerConfig();
  const provider = { name: config.provider === "local" ? "Built-in reasoning engine" : config.label, model: config.model, configured: config.provider === "local" ? false : config.configured, local: config.provider === "local" };
  const storage = storageStatus();
  const worker = workerStatus();
  const integrations = integrationSummary();

  const checks: HealthCheck[] = [
    {
      key: "database",
      label: "Database",
      status: dbStatus.healthy ? "healthy" : "down",
      detail: `${dbStatus.driver} · ${dbStatus.file ?? "in-memory"} · ${Math.round(dbStatus.sizeBytes / 1024)} KB · WAL ${dbStatus.wal ? "on" : "off"} · ${dbStatus.foreignKeys ? "foreign keys enforced" : "foreign keys OFF"}`,
      hint: dbStatus.healthy ? null : dbStatus.error,
      href: null,
    },
    {
      key: "worker",
      label: "Background worker",
      status: worker.running ? (worker.handlers > 0 ? "healthy" : "degraded") : "degraded",
      detail: worker.running
        ? `Running since ${worker.startedAt ?? "unknown"} · ${worker.handlers} handler(s) · driver "${worker.driver}"`
        : "The worker is not running in this process. Jobs will queue but not execute until the app finishes starting.",
      hint: worker.handlers === 0 ? "No job handlers are registered — that is a build problem, not a configuration one." : null,
      href: null,
    },
    {
      key: "ai",
      label: "AI provider",
      status: provider.configured ? "healthy" : "degraded",
      detail: provider.configured
        ? `${provider.name} · model ${provider.model} — language layer supplied by the provider.`
        : `${provider.name} · model ${provider.model} — the built-in deterministic engine is producing every analysis, proposal and reply. No API key is required for the platform to function.`,
      hint: provider.configured ? null : "Add AI_API_KEY to raise the writing quality. Facts, scores and pricing stay local-authoritative either way.",
      href: "/settings?tab=integrations&highlight=ai_provider",
    },
    {
      key: "storage",
      label: "File storage",
      status: storage.configured ? (storage.driver === "local" ? "degraded" : "healthy") : "not_configured",
      detail: storage.note,
      hint: storage.driver === "local" ? "Local storage is fine for a single instance." : null,
      href: "/settings?tab=integrations&highlight=storage",
    },
    {
      key: "pagespeed",
      label: "Core Web Vitals source",
      status: integrationStatusOf(integrations, "pagespeed"),
      detail: integrationStatusOf(integrations, "pagespeed") === "healthy"
        ? "PageSpeed Insights is connected, so audits include real Core Web Vitals field data."
        : "No PageSpeed API key. Audits measure what can be measured from the page itself and clearly mark Core Web Vitals as unavailable — nothing is estimated.",
      hint: "PAGESPEED_API_KEY unlocks lab and field performance data.",
      href: "/settings?tab=integrations&highlight=pagespeed",
    },
    {
      key: "discovery",
      label: "Business data source",
      status: integrationStatusOf(integrations, "google_places"),
      detail: integrationStatusOf(integrations, "google_places") === "healthy"
        ? "Google Places is connected. Results come from real public business data."
        : "No business data provider is connected. The Lead Finder falls back to a clearly-labelled sample dataset so the workflow is testable end to end.",
      hint: "GOOGLE_PLACES_API_KEY replaces sample listings with real businesses.",
      href: "/settings?tab=integrations&highlight=google_places",
    },
    {
      key: "email",
      label: "Outbound email",
      status: integrationStatusOf(integrations, "email"),
      detail: integrationStatusOf(integrations, "email") === "healthy"
        ? "Email provider connected — outreach, proposals and alerts can be delivered."
        : "No email provider connected. Messages are composed, guardrailed and recorded with status \"not sent\" so nothing is falsely reported as delivered.",
      hint: "Set EMAIL_PROVIDER plus the matching API key and EMAIL_FROM.",
      href: "/settings?tab=integrations&highlight=email",
    },
    {
      key: "whatsapp",
      label: "WhatsApp alerts",
      status: integrationStatusOf(integrations, "whatsapp"),
      detail: integrationStatusOf(integrations, "whatsapp") === "healthy"
        ? "WhatsApp Cloud API connected — high-intent alerts can reach your phone."
        : "WhatsApp is not configured. In-app notifications still work. Only the official Meta Cloud API is supported; no personal-account automation exists in this codebase.",
      hint: "WHATSAPP_PROVIDER=cloud with WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and WHATSAPP_ALERT_TO.",
      href: "/settings?tab=integrations&highlight=whatsapp",
    },
    {
      key: "queue",
      label: "Job queue depth",
      status: jobHealth(jobStats(orgId)),
      detail: `${jobStats(orgId).queued} queued · ${jobStats(orgId).running} running · ${jobStats(orgId).failed} failed`,
      hint: jobStats(orgId).oldestQueuedAt ? `Oldest queued job: ${jobStats(orgId).oldestQueuedAt}` : null,
      href: "#recent-jobs",
    },
    {
      key: "authorization",
      label: "Roles and permissions",
      status: "healthy",
      detail: `${counts.users} user(s) · ${organization ? organization.settings.security.enforceMfa ? "MFA enforced" : "MFA available but not enforced" : "no organisation"}`,
      hint: organization?.settings.security.enforceMfa ? null : "Enable MFA enforcement in Settings → Security before inviting external collaborators.",
      href: "/settings?tab=security",
    },
  ];

  const recentFailures = listJobs(orgId, { status: ["failed", "retrying"], limit: 12 }).items.map((job) => ({
    id: job.id,
    type: job.type,
    label: job.label,
    error: job.error,
    attempts: job.attempts,
    completedAt: job.completedAt,
  }));

  const logs = listAppLogs(orgId, { limit: 40 }).map((entry) => ({
    level: entry.level,
    scope: entry.scope,
    message: entry.message,
    createdAt: entry.createdAt,
    context: entry.meta,
  }));

  const usage = aiUsageSummary(orgId);

  return {
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "development",
    uptimeSeconds: Math.round(process.uptime()),
    counts,
    jobs: stats(orgId),
    checks,
    recentFailures,
    logs,
    ai: { ...usage, provider: provider.name, model: provider.model, mode: provider.local ? "built-in engine" : "language model + built-in engine", configured: provider.configured },
    integrations,
    storage,
  };
}

export function jobLogsFor(jobId: string) {
  return listJobLogs(jobId, 200);
}

export function webhookLog(orgId: string) {
  return listWebhooks(orgId, 50);
}

export function handlerList() {
  return { registered: registeredTypes(), catalogue: handlerCatalogue() };
}

export function roleMatrix() {
  return (["owner", "admin", "sales_manager", "sales_agent", "researcher", "designer", "developer"] as const).map((role) => ({
    role,
    permissions: permissionsForRole(role),
  }));
}

export function recordDiagnosticRun(orgId: string, actorId: string | null, summary: string): void {
  logger.info("diagnostics", "Diagnostics run", { summary });
  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "diagnostics.run", entityType: "system", entityId: null, meta: { summary } });
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function scalar(db: ReturnType<typeof getDb>, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

function integrationStatusOf(integrations: ReturnType<typeof integrationSummary>, key: string): HealthCheck["status"] {
  const entry = integrations.find((integration) => integration.key === key);
  if (!entry) return "not_configured";
  return entry.configured ? "healthy" : "not_configured";
}

function jobHealth(stats: ReturnType<typeof jobStats>): HealthCheck["status"] {
  if (stats.failed > 5) return "down";
  if (stats.failed > 0 || stats.queued > 50) return "degraded";
  return "healthy";
}
