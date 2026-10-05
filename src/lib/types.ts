/**
 * Shared domain vocabulary.
 *
 * These unions are the contract between the database, the API layer and the UI.
 * UI never duplicates a status string — it imports from here, so a rename can
 * never silently desynchronise a Kanban column from a query filter.
 */

/* ── Team & access ───────────────────────────────────────────────────────── */

export const USER_ROLES = [
  "owner",
  "admin",
  "sales_manager",
  "sales_agent",
  "researcher",
  "designer",
  "developer",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  admin: "Admin",
  sales_manager: "Sales Manager",
  sales_agent: "Sales Agent",
  researcher: "Researcher",
  designer: "Designer",
  developer: "Developer",
};

export type Permission =
  | "leads.view"
  | "leads.create"
  | "leads.edit"
  | "leads.delete"
  | "leads.assign"
  | "leads.export"
  | "businesses.view"
  | "businesses.create"
  | "businesses.edit"
  | "businesses.delete"
  | "audits.run"
  | "discovery.run"
  | "proposals.view"
  | "proposals.create"
  | "proposals.edit"
  | "proposals.approve"
  | "proposals.send"
  | "conversations.view"
  | "conversations.reply"
  | "conversations.takeover"
  | "campaigns.view"
  | "campaigns.create"
  | "campaigns.send"
  | "tasks.view"
  | "tasks.manage"
  | "projects.view"
  | "projects.manage"
  | "analytics.view"
  | "team.view"
  | "team.manage"
  | "services.manage"
  | "settings.view"
  | "settings.manage"
  | "integrations.manage"
  | "billing.manage"
  | "data.export"
  | "data.delete"
  | "security.manage"
  | "ai.use"
  | "ai.configure"
  | "logs.view";

export const ROLE_PERMISSIONS: Record<UserRole, Permission[] | ["*"]> = {
  owner: ["*"],
  admin: [
    "leads.view", "leads.create", "leads.edit", "leads.delete", "leads.assign", "leads.export",
    "businesses.view", "businesses.create", "businesses.edit", "businesses.delete",
    "audits.run", "discovery.run",
    "proposals.view", "proposals.create", "proposals.edit", "proposals.approve", "proposals.send",
    "conversations.view", "conversations.reply", "conversations.takeover",
    "campaigns.view", "campaigns.create", "campaigns.send",
    "tasks.view", "tasks.manage", "projects.view", "projects.manage",
    "analytics.view", "team.view", "team.manage", "services.manage",
    "settings.view", "settings.manage", "integrations.manage",
    "data.export", "ai.use", "ai.configure", "logs.view",
  ],
  sales_manager: [
    "leads.view", "leads.create", "leads.edit", "leads.assign", "leads.export",
    "businesses.view", "businesses.create", "businesses.edit",
    "audits.run", "discovery.run",
    "proposals.view", "proposals.create", "proposals.edit", "proposals.approve", "proposals.send",
    "conversations.view", "conversations.reply", "conversations.takeover",
    "campaigns.view", "campaigns.create", "campaigns.send",
    "tasks.view", "tasks.manage", "projects.view", "analytics.view", "team.view",
    "settings.view", "data.export", "ai.use",
  ],
  sales_agent: [
    "leads.view", "leads.create", "leads.edit", "leads.export",
    "businesses.view", "businesses.create",
    "audits.run",
    "proposals.view", "proposals.create", "proposals.edit",
    "conversations.view", "conversations.reply", "conversations.takeover",
    "campaigns.view", "tasks.view", "tasks.manage", "projects.view", "analytics.view", "ai.use",
  ],
  researcher: [
    "leads.view", "leads.create", "businesses.view", "businesses.create", "businesses.edit",
    "audits.run", "discovery.run", "tasks.view", "tasks.manage", "analytics.view", "ai.use",
  ],
  designer: [
    "leads.view", "businesses.view", "proposals.view", "proposals.create", "proposals.edit",
    "tasks.view", "tasks.manage", "projects.view", "ai.use",
  ],
  developer: ["leads.view", "businesses.view", "projects.view", "projects.manage", "tasks.view", "tasks.manage"],
};

/* ── Leads ───────────────────────────────────────────────────────────────── */

export const LEAD_STATUSES = [
  "new",
  "researching",
  "qualified",
  "contacted",
  "engaged",
  "interested",
  "proposal_sent",
  "meeting_scheduled",
  "negotiation",
  "won",
  "lost",
  "not_interested",
  "follow_up_later",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_META: Record<
  LeadStatus,
  { label: string; tone: StatusTone; description: string }
> = {
  new: { label: "New", tone: "info", description: "Discovered, not yet reviewed" },
  researching: { label: "Researching", tone: "info", description: "Audit or enrichment in progress" },
  qualified: { label: "Qualified", tone: "brand", description: "Meets fit + opportunity criteria" },
  contacted: { label: "Contacted", tone: "brand", description: "First outreach sent" },
  engaged: { label: "Engaged", tone: "brand", description: "Prospect has opened or replied" },
  interested: { label: "Interested", tone: "warning", description: "Positive buying signal detected" },
  proposal_sent: { label: "Proposal Sent", tone: "warning", description: "Proposal delivered, awaiting decision" },
  meeting_scheduled: { label: "Meeting", tone: "warning", description: "Call or meeting booked" },
  negotiation: { label: "Negotiation", tone: "ember", description: "Discussing scope or price" },
  won: { label: "Won", tone: "success", description: "Signed — convert to project" },
  lost: { label: "Lost", tone: "neutral", description: "Closed without winning" },
  not_interested: { label: "Not Interested", tone: "neutral", description: "Declined — suppress outreach" },
  follow_up_later: { label: "Follow Up Later", tone: "neutral", description: "Nurture at a later date" },
};

/** Pipeline columns (§34) — the subset of statuses that behave as Kanban stages. */
export const PIPELINE_STAGES: LeadStatus[] = [
  "new",
  "qualified",
  "contacted",
  "engaged",
  "interested",
  "proposal_sent",
  "meeting_scheduled",
  "negotiation",
  "won",
  "lost",
];

export const OPEN_STATUSES: LeadStatus[] = PIPELINE_STAGES.filter((s) => s !== "won" && s !== "lost");

export type Temperature = "hot" | "warm" | "cold";
export const TEMPERATURE_META: Record<Temperature, { label: string; tone: StatusTone; emoji: string }> = {
  hot: { label: "Hot lead", tone: "ember", emoji: "🔥" },
  warm: { label: "Warm lead", tone: "warning", emoji: "☀️" },
  cold: { label: "Cold lead", tone: "neutral", emoji: "❄️" },
};

export type IntentLevel =
  | "unknown"
  | "not_interested"
  | "curious"
  | "information_seeking"
  | "interested"
  | "high_intent"
  | "wants_pricing"
  | "wants_demo"
  | "wants_call"
  | "ready_to_start";

export const INTENT_META: Record<IntentLevel, { label: string; score: number; tone: StatusTone }> = {
  unknown: { label: "Unknown", score: 0, tone: "neutral" },
  not_interested: { label: "Not interested", score: 5, tone: "neutral" },
  curious: { label: "Curious", score: 25, tone: "info" },
  information_seeking: { label: "Information seeking", score: 38, tone: "info" },
  interested: { label: "Interested", score: 60, tone: "warning" },
  high_intent: { label: "High intent", score: 82, tone: "ember" },
  wants_pricing: { label: "Wants pricing", score: 78, tone: "ember" },
  wants_demo: { label: "Wants demo", score: 80, tone: "ember" },
  wants_call: { label: "Wants a call", score: 88, tone: "ember" },
  ready_to_start: { label: "Ready to start", score: 96, tone: "success" },
};

export type WebsiteStatus = "none" | "unknown" | "excellent" | "good" | "average" | "poor" | "very_poor" | "broken";

export const WEBSITE_STATUS_META: Record<WebsiteStatus, { label: string; tone: StatusTone }> = {
  none: { label: "No website", tone: "ember" },
  unknown: { label: "Unknown", tone: "neutral" },
  excellent: { label: "Excellent", tone: "success" },
  good: { label: "Good", tone: "success" },
  average: { label: "Average", tone: "warning" },
  poor: { label: "Poor", tone: "danger" },
  very_poor: { label: "Very poor", tone: "danger" },
  broken: { label: "Broken", tone: "danger" },
};

export type StatusTone = "neutral" | "brand" | "info" | "success" | "warning" | "danger" | "ember";

/* ── Conversations ───────────────────────────────────────────────────────── */

export type ConversationStatus = "ai_active" | "human_takeover" | "awaiting_contact" | "closed";
export const CONVERSATION_STATUS_META: Record<ConversationStatus, { label: string; tone: StatusTone }> = {
  ai_active: { label: "AI active", tone: "brand" },
  human_takeover: { label: "Human takeover", tone: "warning" },
  awaiting_contact: { label: "Awaiting prospect", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
};

export type MessageRole = "prospect" | "ai" | "agent" | "system";

/* ── Proposals ───────────────────────────────────────────────────────────── */

export const PROPOSAL_STATUSES = ["draft", "pending_approval", "approved", "sent", "viewed", "accepted", "declined", "expired"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_META: Record<ProposalStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Pending approval", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  sent: { label: "Sent", tone: "brand" },
  viewed: { label: "Viewed", tone: "brand" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

/* ── Campaigns ───────────────────────────────────────────────────────────── */

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed", "archived"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "info" },
  archived: { label: "Archived", tone: "neutral" },
};

export const EMAIL_STYLES = ["professional", "friendly", "short", "consultative", "audit_based", "value_based"] as const;
export type EmailStyle = (typeof EMAIL_STYLES)[number];

export const EMAIL_STYLE_META: Record<EmailStyle, { label: string; description: string }> = {
  professional: { label: "Professional", description: "Formal, measured, board-ready tone" },
  friendly: { label: "Friendly", description: "Warm and conversational, low pressure" },
  short: { label: "Short", description: "Three sentences and a single ask" },
  consultative: { label: "Consultative", description: "Advice-first, positions you as an expert" },
  audit_based: { label: "Audit-based", description: "Opens with a specific, verifiable finding" },
  value_based: { label: "Value-based", description: "Leads with the commercial upside" },
};

/* ── Tasks & projects ────────────────────────────────────────────────────── */

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const PROJECT_STATUSES = [
  "discovery",
  "design",
  "development",
  "review",
  "launch",
  "maintenance",
  "on_hold",
  "completed",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: StatusTone }> = {
  discovery: { label: "Discovery", tone: "info" },
  design: { label: "Design", tone: "brand" },
  development: { label: "Development", tone: "brand" },
  review: { label: "Review", tone: "warning" },
  launch: { label: "Launch", tone: "ember" },
  maintenance: { label: "Maintenance", tone: "success" },
  on_hold: { label: "On hold", tone: "neutral" },
  completed: { label: "Completed", tone: "success" },
};

/* ── Notifications & alerts ──────────────────────────────────────────────── */

export const NOTIFICATION_TYPES = [
  "new_lead",
  "high_value_lead",
  "hot_lead_alert",
  "interested_prospect",
  "proposal_opened",
  "proposal_accepted",
  "proposal_declined",
  "meeting_requested",
  "follow_up_due",
  "chat_escalation",
  "new_response",
  "audit_completed",
  "campaign_completed",
  "job_failed",
  "system",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type Severity = "info" | "success" | "warning" | "critical";

export const SEVERITY_TONE: Record<Severity, StatusTone> = {
  info: "info",
  success: "success",
  warning: "warning",
  critical: "danger",
};

/* ── Jobs ────────────────────────────────────────────────────────────────── */

export const JOB_TYPES = [
  "discovery",
  "audit",
  "audit_bulk",
  "ai_analysis",
  "concept",
  "proposal",
  "email_send",
  "campaign_run",
  "screenshot",
  "notification",
  "enrichment",
  "report",
  "import",
  "scoring",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "retrying";

/* ── Integrations ────────────────────────────────────────────────────────── */

export type IntegrationStatus = "not_connected" | "connected" | "error" | "available" | "disabled";

export const INTEGRATION_STATUS_META: Record<IntegrationStatus, { label: string; tone: StatusTone }> = {
  not_connected: { label: "Not connected", tone: "neutral" },
  available: { label: "Ready to connect", tone: "info" },
  connected: { label: "Connected", tone: "success" },
  error: { label: "Error", tone: "danger" },
  disabled: { label: "Disabled", tone: "neutral" },
};

/* ── Discovery ───────────────────────────────────────────────────────────── */

export const WEBSITE_QUALITY_BANDS = [
  { key: "any", label: "Any website quality", min: 0, max: 100 },
  { key: "under_50", label: "Below 50 (high opportunity)", min: 0, max: 49 },
  { key: "under_60", label: "Below 60 (needs work)", min: 0, max: 59 },
  { key: "under_75", label: "Below 75 (could improve)", min: 0, max: 74 },
  { key: "no_website", label: "No website at all", min: 0, max: 0 },
  { key: "over_75", label: "75+ (strong, low priority)", min: 75, max: 100 },
] as const;
export type WebsiteQualityBand = (typeof WEBSITE_QUALITY_BANDS)[number]["key"];

/* ── Score bands ─────────────────────────────────────────────────────────── */

export function scoreBand(score: number | null | undefined): {
  label: string;
  tone: StatusTone;
  grade: string;
} {
  if (score === null || score === undefined) return { label: "Not scored", tone: "neutral", grade: "—" };
  if (score >= 85) return { label: "Excellent", tone: "success", grade: "A" };
  if (score >= 70) return { label: "Good", tone: "success", grade: "B" };
  if (score >= 55) return { label: "Fair", tone: "warning", grade: "C" };
  if (score >= 40) return { label: "Poor", tone: "danger", grade: "D" };
  return { label: "Critical", tone: "danger", grade: "F" };
}

/** For opportunity scores, higher is *better for us*, so the wording flips. */
export function opportunityBand(score: number | null | undefined): { label: string; tone: StatusTone } {
  if (score === null || score === undefined) return { label: "Not scored", tone: "neutral" };
  if (score >= 85) return { label: "Exceptional opportunity", tone: "ember" };
  if (score >= 70) return { label: "Strong opportunity", tone: "warning" };
  if (score >= 55) return { label: "Moderate opportunity", tone: "info" };
  return { label: "Low opportunity", tone: "neutral" };
}

/* ── Audit dimensions ────────────────────────────────────────────────────── */

export const AUDIT_DIMENSIONS = [
  { key: "performance", label: "Performance", description: "Load speed, page weight, caching, Core Web Vitals where measurable" },
  { key: "mobile", label: "Mobile", description: "Responsive layout, viewport, tap targets, horizontal overflow" },
  { key: "seo", label: "SEO", description: "Titles, meta, headings, canonical, indexability, structured data" },
  { key: "ux", label: "UX", description: "Navigation, hierarchy, readability, contact & booking access" },
  { key: "accessibility", label: "Accessibility", description: "Automated checks only: alt text, labels, landmarks, contrast heuristics" },
  { key: "conversion", label: "Conversion", description: "CTA clarity, trust signals, friction, lead capture paths" },
  { key: "technical", label: "Technical", description: "HTTPS, redirects, errors, broken links, platform detection" },
  { key: "content", label: "Content", description: "Depth, freshness, contact details, service clarity" },
] as const;

export type AuditDimension = (typeof AUDIT_DIMENSIONS)[number]["key"];

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "positive";

export interface AuditFinding {
  id: string;
  dimension: AuditDimension | "trust" | "security";
  severity: FindingSeverity;
  title: string;
  detail: string;
  /** What the checks actually measured — keeps AI claims honest (§52). */
  evidence: string;
  recommendation: string;
  impact: string;
  effort?: "low" | "medium" | "high";
}

export interface AuditMetric {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  target?: number | string;
  status?: "pass" | "warn" | "fail" | "unknown";
  hint?: string;
}

/* ── Design recommendation ───────────────────────────────────────────────── */

export interface PaletteToken {
  name: string;
  hex: string;
  usage: string;
}

export interface TypographyChoice {
  heading: string;
  body: string;
  rationale: string;
}

export interface ConceptSection {
  name: string;
  purpose: string;
  content: string[];
  layout: string;
}

export interface WebsiteConcept {
  style: string;
  mood: string[];
  palette: PaletteToken[];
  typography: TypographyChoice;
  layout: string;
  hero: { headline: string; subheadline: string; cta: string; secondaryCta?: string; notes: string };
  navigation: string[];
  sections: ConceptSection[];
  features: string[];
  images: string[];
  icons: string[];
  animations: string[];
  conversionStrategy: string[];
  pages: string[];
  designNotes: string;
}

/* ── Pricing ─────────────────────────────────────────────────────────────── */

export interface PriceEstimate {
  currency: string;
  low: number;
  mid: number;
  high: number;
  confidence: number;
  drivers: { label: string; impact: "up" | "down" | "neutral"; note: string }[];
  recommendedServices: { key: string; name: string; price: number; reason: string }[];
  timelineWeeks: { low: number; high: number };
  /** AI output is never a quote until a human approves it (§32). */
  disclaimer: string;
}

export interface ProposalLineItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  optional?: boolean;
}

export interface ProposalSection {
  id: string;
  key: string;
  title: string;
  body: string;
  bullets: string[];
  visible: boolean;
}
