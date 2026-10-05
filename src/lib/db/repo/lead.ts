import "server-only";

import { all, insert, one, parseJson, run, toBool, update } from "..";
import { newId, reference } from "../../ids";
import { LEAD_STATUSES, OPEN_STATUSES, type LeadStatus, type Temperature, type IntentLevel } from "../../types";
import type { ScoreFactor } from "../../scoring/lead";
import type { Activity, Lead, TimelineEvent } from "./types";
import { mapContact, mapBusiness } from "./business";
import type { Business as BusinessModel, Contact as ContactModel } from "./types";

/* ══════════════════════════════════════════════════════════════════════════
   Leads
   ══════════════════════════════════════════════════════════════════════════ */

interface LeadRow {
  id: string; org_id: string; business_id: string; contact_id: string | null; campaign_id: string | null;
  discovery_run_id: string | null; reference: string; source: string; status: string; stage_key: string;
  stage_position: number; temperature: string; priority: number; owner_id: string | null; tags_json: string;
  website_score: number | null; opportunity_score: number | null; lead_score: number | null;
  business_quality: number | null; buying_potential: number | null; contactability: number | null;
  intent: string; intent_score: number; estimated_value: number | null; currency: string;
  confidence: number | null; next_action: string | null; next_follow_up_at: string | null;
  last_activity_at: string | null; last_contacted_at: string | null; won_at: string | null;
  lost_at: string | null; lost_reason: string | null; disqualified: number; opt_out: number;
  is_demo: number; created_at: string; updated_at: string;
  score_factors_json?: string | null;
  score_reason?: string | null;
}

function mapLead(row: LeadRow): Lead {
  return {
    id: row.id,
    orgId: row.org_id,
    businessId: row.business_id,
    contactId: row.contact_id,
    campaignId: row.campaign_id,
    discoveryRunId: row.discovery_run_id,
    reference: row.reference,
    source: row.source,
    status: row.status as LeadStatus,
    stageKey: row.stage_key,
    stagePosition: row.stage_position,
    temperature: row.temperature as Temperature,
    priority: row.priority,
    ownerId: row.owner_id,
    tags: parseJson<string[]>(row.tags_json, []),
    websiteScore: row.website_score,
    opportunityScore: row.opportunity_score,
    leadScore: row.lead_score,
    businessQuality: row.business_quality,
    buyingPotential: row.buying_potential,
    contactability: row.contactability,
    intent: row.intent as IntentLevel,
    intentScore: row.intent_score,
    estimatedValue: row.estimated_value,
    currency: row.currency,
    confidence: row.confidence,
    nextAction: row.next_action,
    nextFollowUpAt: row.next_follow_up_at,
    lastActivityAt: row.last_activity_at,
    lastContactedAt: row.last_contacted_at,
    wonAt: row.won_at,
    lostAt: row.lost_at,
    lostReason: row.lost_reason,
    disqualified: toBool(row.disqualified),
    optOut: toBool(row.opt_out),
    isDemo: toBool(row.is_demo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scoreFactors: row.score_factors_json
      ? {
          businessQuality: row.business_quality ?? 0,
          websiteOpportunity: row.opportunity_score ?? 0,
          buyingPotential: row.buying_potential ?? 0,
          contactability: row.contactability ?? 0,
          buyingIntent: row.intent_score,
          total: row.lead_score ?? 0,
          temperature: row.temperature as Temperature,
          tier: row.temperature as Temperature,
          factors: parseJson<ScoreFactor[]>(row.score_factors_json, []),
          reason: row.score_reason ?? "",
          nextAction: row.next_action ?? "",
        }
      : null,
  };
}

export interface LeadFilter {
  search?: string;
  statuses?: LeadStatus[];
  stageKeys?: string[];
  temperatures?: Temperature[];
  intents?: IntentLevel[];
  ownerIds?: string[];
  unassigned?: boolean;
  campaignId?: string;
  industries?: string[];
  cities?: string[];
  countries?: string[];
  tags?: string[];
  minLeadScore?: number;
  maxLeadScore?: number;
  minWebsiteScore?: number;
  maxWebsiteScore?: number;
  minOpportunityScore?: number;
  minReviews?: number;
  maxReviews?: number;
  notContacted?: boolean;
  followUpDue?: boolean;
  overdueBefore?: string;
  websiteStatus?: string[];
  ids?: string[];
  createdAfter?: string;
  createdBefore?: string;
  sort?: "lead_score" | "opportunity" | "created_at" | "reviews" | "rating" | "value" | "follow_up" | "name";
  limit?: number;
  offset?: number;
}

const SORT_MAP: Record<NonNullable<LeadFilter["sort"]>, string> = {
  lead_score: "l.lead_score DESC NULLS LAST, l.opportunity_score DESC",
  opportunity: "l.opportunity_score DESC NULLS LAST, l.lead_score DESC",
  created_at: "l.created_at DESC",
  reviews: "COALESCE(b.review_count,0) DESC",
  rating: "COALESCE(b.rating,0) DESC",
  value: "COALESCE(l.estimated_value,0) DESC",
  follow_up: "l.next_follow_up_at ASC NULLS LAST",
  name: "b.name ASC",
};

function buildLeadWhere(orgId: string, filter: LeadFilter): { where: string; params: unknown[] } {
  const clauses: string[] = ["l.org_id = ?"];
  const params: unknown[] = [orgId];

  if (filter.search) {
    clauses.push("(b.name LIKE ? OR b.city LIKE ? OR l.reference LIKE ? OR c.name LIKE ? OR b.industry LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like, like, like);
  }
  if (filter.statuses?.length) {
    clauses.push(`l.status IN (${filter.statuses.map(() => "?").join(",")})`);
    params.push(...filter.statuses);
  }
  if (filter.stageKeys?.length) {
    clauses.push(`l.stage_key IN (${filter.stageKeys.map(() => "?").join(",")})`);
    params.push(...filter.stageKeys);
  }
  if (filter.temperatures?.length) {
    clauses.push(`l.temperature IN (${filter.temperatures.map(() => "?").join(",")})`);
    params.push(...filter.temperatures);
  }
  if (filter.intents?.length) {
    clauses.push(`l.intent IN (${filter.intents.map(() => "?").join(",")})`);
    params.push(...filter.intents);
  }
  if (filter.ownerIds?.length) {
    clauses.push(`l.owner_id IN (${filter.ownerIds.map(() => "?").join(",")})`);
    params.push(...filter.ownerIds);
  }
  if (filter.unassigned) clauses.push("(l.owner_id IS NULL OR l.owner_id = '')");
  if (filter.campaignId) { clauses.push("l.campaign_id = ?"); params.push(filter.campaignId); }
  if (filter.industries?.length) {
    clauses.push(`b.industry IN (${filter.industries.map(() => "?").join(",")})`);
    params.push(...filter.industries);
  }
  if (filter.cities?.length) {
    clauses.push(`b.city IN (${filter.cities.map(() => "?").join(",")})`);
    params.push(...filter.cities);
  }
  if (filter.countries?.length) {
    clauses.push(`b.country IN (${filter.countries.map(() => "?").join(",")})`);
    params.push(...filter.countries);
  }
  if (filter.tags?.length) {
    filter.tags.forEach((tag) => {
      clauses.push("EXISTS (SELECT 1 FROM json_each(json_extract(l.tags_json,'$')) WHERE value = ?)");
      params.push(tag);
    });
  }
  if (filter.minLeadScore !== undefined) { clauses.push("COALESCE(l.lead_score,0) >= ?"); params.push(filter.minLeadScore); }
  if (filter.maxLeadScore !== undefined) { clauses.push("COALESCE(l.lead_score,0) <= ?"); params.push(filter.maxLeadScore); }
  if (filter.minWebsiteScore !== undefined) { clauses.push("COALESCE(l.website_score,101) >= ?"); params.push(filter.minWebsiteScore); }
  if (filter.maxWebsiteScore !== undefined) { clauses.push("COALESCE(l.website_score,0) <= ?"); params.push(filter.maxWebsiteScore); }
  if (filter.minOpportunityScore !== undefined) { clauses.push("COALESCE(l.opportunity_score,0) >= ?"); params.push(filter.minOpportunityScore); }
  if (filter.minReviews !== undefined) { clauses.push("COALESCE(b.review_count,0) >= ?"); params.push(filter.minReviews); }
  if (filter.maxReviews !== undefined) { clauses.push("COALESCE(b.review_count,0) <= ?"); params.push(filter.maxReviews); }
  if (filter.notContacted) clauses.push("l.last_contacted_at IS NULL");
  if (filter.followUpDue) clauses.push("l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at <= datetime('now')");
  if (filter.overdueBefore) { clauses.push("l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < ?"); params.push(filter.overdueBefore); }
  if (filter.websiteStatus?.length) {
    clauses.push(`b.website_status IN (${filter.websiteStatus.map(() => "?").join(",")})`);
    params.push(...filter.websiteStatus);
  }
  if (filter.ids?.length) {
    clauses.push(`l.id IN (${filter.ids.map(() => "?").join(",")})`);
    params.push(...filter.ids);
  }
  if (filter.createdAfter) { clauses.push("l.created_at >= ?"); params.push(filter.createdAfter); }
  if (filter.createdBefore) { clauses.push("l.created_at <= ?"); params.push(filter.createdBefore); }

  return { where: `WHERE ${clauses.join(" AND ")}`, params };
}

const LEAD_SELECT = `
  SELECT l.*, ls.factors_json AS score_factors_json, ls.reason AS score_reason
  FROM leads l
  JOIN businesses b ON b.id = l.business_id
  LEFT JOIN contacts c ON c.id = l.contact_id
  LEFT JOIN (
    SELECT lead_id, factors_json, reason,
           ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY computed_at DESC) AS rn
    FROM lead_scores
  ) ls ON ls.lead_id = l.id AND ls.rn = 1
`;

export function listLeads(orgId: string, filter: LeadFilter = {}): { items: Lead[]; total: number } {
  const { where, params } = buildLeadWhere(orgId, filter);
  const order = SORT_MAP[filter.sort ?? "lead_score"];
  const limit = Math.min(filter.limit ?? 50, 1000);
  const offset = filter.offset ?? 0;

  const rows = all<LeadRow>(`${LEAD_SELECT} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const items = hydrateLeads(orgId, rows);
  const total = one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM leads l JOIN businesses b ON b.id = l.business_id LEFT JOIN contacts c ON c.id = l.contact_id ${where}`,
    params,
  )?.total ?? 0;
  return { items, total };
}

function hydrateLeads(orgId: string, rows: LeadRow[]): Lead[] {
  if (!rows.length) return [];
  const leads = rows.map(mapLead);
  const businessIds = Array.from(new Set(leads.map((l) => l.businessId)));
  const ownerIds = Array.from(new Set(leads.map((l) => l.ownerId).filter((v): v is string => Boolean(v))));

  const businesses = businessIds.length
    ? all<Parameters<typeof mapBusiness>[0]>(
        `SELECT * FROM businesses WHERE id IN (${businessIds.map(() => "?").join(",")})`,
        businessIds,
      )
    : [];
  const businessMap = new Map(businesses.map((b) => [b.id, mapBusiness(b)]));

  const contacts = leads
    .map((l) => (l.contactId ? one<Parameters<typeof mapContact>[0]>("SELECT * FROM contacts WHERE id = ?", [l.contactId]) : null))
    .filter((c): c is Parameters<typeof mapContact>[0] => Boolean(c));
  const contactMap = new Map(contacts.map((c) => [c.id, mapContact(c)]));

  const owners = ownerIds.length
    ? all<{ id: string; name: string; avatar_url: string | null }>(
        `SELECT id, name, avatar_url FROM users WHERE id IN (${ownerIds.map(() => "?").join(",")})`,
        ownerIds,
      )
    : [];
  const ownerMap = new Map(owners.map((o) => [o.id, { id: o.id, name: o.name, avatarUrl: o.avatar_url }]));

  void orgId;
  return leads.map((lead) => ({
    ...lead,
    business: businessMap.get(lead.businessId) ?? null,
    contact: lead.contactId ? contactMap.get(lead.contactId) ?? null : null,
    owner: lead.ownerId ? ownerMap.get(lead.ownerId) ?? null : null,
  }));
}

export function getLead(orgId: string, leadId: string): Lead | null {
  const row = one<LeadRow>(`${LEAD_SELECT} WHERE l.id = ? AND l.org_id = ?`, [leadId, orgId]);
  if (!row) return null;
  return hydrateLeads(orgId, [row])[0] ?? null;
}

export function getLeadByBusiness(orgId: string, businessId: string): Lead | null {
  const row = one<LeadRow>(`${LEAD_SELECT} WHERE l.business_id = ? AND l.org_id = ? ORDER BY l.created_at DESC LIMIT 1`, [businessId, orgId]);
  if (!row) return null;
  return hydrateLeads(orgId, [row])[0] ?? null;
}

export function createLead(orgId: string, input: {
  businessId: string;
  contactId?: string | null;
  source?: string;
  status?: LeadStatus;
  stageKey?: string;
  ownerId?: string | null;
  tags?: string[];
  campaignId?: string | null;
  discoveryRunId?: string | null;
  estimatedValue?: number | null;
  currency?: string;
  isDemo?: boolean;
}): Lead {
  const existing = getLeadByBusiness(orgId, input.businessId);
  if (existing) return existing;

  const id = newId("led");
  const timestamp = new Date().toISOString();
  const status = input.status ?? "new";
  const stageKey = input.stageKey ?? status;
  const stage = one<{ position: number }>("SELECT position FROM lead_stages WHERE org_id = ? AND key = ?", [orgId, stageKey]);

  insert("leads", {
    id,
    org_id: orgId,
    business_id: input.businessId,
    contact_id: input.contactId ?? null,
    campaign_id: input.campaignId ?? null,
    discovery_run_id: input.discoveryRunId ?? null,
    reference: reference("LD"),
    source: input.source ?? "discovery",
    status,
    stage_key: stageKey,
    stage_position: stage?.position ?? 0,
    temperature: "cold",
    owner_id: input.ownerId ?? null,
    tags_json: input.tags ?? [],
    intent: "unknown",
    intent_score: 0,
    estimated_value: input.estimatedValue ?? null,
    currency: input.currency ?? "GBP",
    last_activity_at: timestamp,
    is_demo: input.isDemo ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getLead(orgId, id)!;
}

const LEAD_COLUMN_MAP: Record<string, string> = {
  status: "status", stageKey: "stage_key", stagePosition: "stage_position", temperature: "temperature",
  priority: "priority", ownerId: "owner_id", tags: "tags_json", websiteScore: "website_score",
  opportunityScore: "opportunity_score", leadScore: "lead_score", businessQuality: "business_quality",
  buyingPotential: "buying_potential", contactability: "contactability", intent: "intent",
  intentScore: "intent_score", estimatedValue: "estimated_value", currency: "currency",
  confidence: "confidence", nextAction: "next_action", nextFollowUpAt: "next_follow_up_at",
  lastActivityAt: "last_activity_at", lastContactedAt: "last_contacted_at", wonAt: "won_at",
  lostAt: "lost_at", lostReason: "lost_reason", disqualified: "disqualified", optOut: "opt_out",
  contactId: "contact_id", campaignId: "campaign_id", source: "source",
};

export function updateLead(orgId: string, leadId: string, patch: Partial<Lead>): Lead | null {
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = LEAD_COLUMN_MAP[key];
    if (column) values[column] = value;
  });
  if (!Object.keys(values).length) return getLead(orgId, leadId);
  values.updated_at = new Date().toISOString();
  update("leads", leadId, values);
  return getLead(orgId, leadId);
}

/** Move a lead to a stage, keeping status/stage/timestamps coherent. */
export function moveLeadToStage(orgId: string, leadId: string, stageKey: string, options: { actorId?: string | null; note?: string } = {}): Lead | null {
  if (!LEAD_STATUSES.includes(stageKey as LeadStatus)) return null;
  const stage = one<{ position: number; name: string }>("SELECT position, name FROM lead_stages WHERE org_id = ? AND key = ?", [orgId, stageKey]);
  const before = getLead(orgId, leadId);
  if (!before) return null;

  const values: Record<string, unknown> = {
    status: stageKey,
    stage_key: stageKey,
    stage_position: stage?.position ?? 0,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  };
  if (stageKey === "won") {
    values.won_at = new Date().toISOString();
    values.lost_at = null;
  }
  if (stageKey === "lost") {
    values.lost_at = new Date().toISOString();
    values.won_at = null;
  }
  update("leads", leadId, values);

  if (before.status !== stageKey) {
    recordActivity(orgId, {
      leadId,
      businessId: before.businessId,
      userId: options.actorId ?? null,
      type: "stage_change",
      subject: `Stage: ${before.status} → ${stageKey}`,
      body: options.note ?? null,
      metadata: { from: before.status, to: stageKey },
    });
  }
  return getLead(orgId, leadId);
}

/** Persist a computed score and mirror the headline figures onto the lead row. */
export function saveLeadScore(
  orgId: string,
  leadId: string,
  score: {
    businessQuality: number;
    websiteOpportunity: number;
    buyingPotential: number;
    contactability: number;
    buyingIntent: number;
    total: number;
    temperature: Temperature;
    factors: ScoreFactor[];
    reason: string;
    nextAction: string;
  },
): void {
  const timestamp = new Date().toISOString();
  insert("lead_scores", {
    id: newId("scr"),
    org_id: orgId,
    lead_id: leadId,
    business_quality: score.businessQuality,
    website_opportunity: score.websiteOpportunity,
    buying_potential: score.buyingPotential,
    contactability: score.contactability,
    buying_intent: score.buyingIntent,
    total: score.total,
    tier: score.temperature,
    factors_json: score.factors,
    reason: score.reason,
    computed_at: timestamp,
  });
  update("leads", leadId, {
    lead_score: score.total,
    opportunity_score: score.websiteOpportunity,
    business_quality: score.businessQuality,
    buying_potential: score.buyingPotential,
    contactability: score.contactability,
    temperature: score.temperature,
    next_action: score.nextAction,
    updated_at: timestamp,
  });
}

export function latestLeadScore(orgId: string, leadId: string): { factors: ScoreFactor[]; reason: string; computedAt: string } | null {
  const row = one<{ factors_json: string; reason: string | null; computed_at: string }>(
    "SELECT factors_json, reason, computed_at FROM lead_scores WHERE lead_id = ? AND org_id = ? ORDER BY computed_at DESC LIMIT 1",
    [leadId, orgId],
  );
  if (!row) return null;
  return { factors: parseJson<ScoreFactor[]>(row.factors_json, []), reason: row.reason ?? "", computedAt: row.computed_at };
}

/* ══════════════════════════════════════════════════════════════════════════
   Activities
   ══════════════════════════════════════════════════════════════════════════ */

interface ActivityRow {
  id: string; org_id: string; lead_id: string | null; business_id: string | null; contact_id: string | null;
  user_id: string | null; type: string; channel: string | null; subject: string | null; body: string | null;
  metadata_json: string; is_system: number; occurred_at: string; created_at: string; actor_name?: string | null;
}

export function recordActivity(orgId: string, input: {
  leadId?: string | null;
  businessId?: string | null;
  contactId?: string | null;
  userId?: string | null;
  type: string;
  channel?: string | null;
  subject?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown>;
  isSystem?: boolean;
  occurredAt?: string;
}): Activity {
  const id = newId("act");
  const timestamp = input.occurredAt ?? new Date().toISOString();
  insert("activities", {
    id,
    org_id: orgId,
    lead_id: input.leadId ?? null,
    business_id: input.businessId ?? null,
    contact_id: input.contactId ?? null,
    user_id: input.userId ?? null,
    type: input.type,
    channel: input.channel ?? null,
    subject: input.subject ?? null,
    body: input.body ?? null,
    metadata_json: input.metadata ?? {},
    is_system: input.isSystem ? 1 : 0,
    occurred_at: timestamp,
    created_at: timestamp,
  });
  if (input.leadId) {
    run("UPDATE leads SET last_activity_at = ?, updated_at = ? WHERE id = ?", [timestamp, timestamp, input.leadId]);
  }
  return {
    id,
    orgId,
    leadId: input.leadId ?? null,
    businessId: input.businessId ?? null,
    contactId: input.contactId ?? null,
    userId: input.userId ?? null,
    type: input.type,
    channel: input.channel ?? null,
    subject: input.subject ?? null,
    body: input.body ?? null,
    metadata: input.metadata ?? {},
    isSystem: Boolean(input.isSystem),
    occurredAt: timestamp,
    createdAt: timestamp,
  };
}

export function listActivities(orgId: string, filter: { leadId?: string; businessId?: string; limit?: number; offset?: number } = {}): Activity[] {
  const clauses = ["a.org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.leadId) { clauses.push("a.lead_id = ?"); params.push(filter.leadId); }
  if (filter.businessId) { clauses.push("a.business_id = ?"); params.push(filter.businessId); }
  return all<ActivityRow>(
    `SELECT a.*, u.name AS actor_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${clauses.join(" AND ")} ORDER BY a.occurred_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 60, 400), filter.offset ?? 0],
  ).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    leadId: row.lead_id,
    businessId: row.business_id,
    contactId: row.contact_id,
    userId: row.user_id,
    type: row.type,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    isSystem: toBool(row.is_system),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    actorName: row.actor_name ?? null,
  }));
}

/** Merged, human-readable timeline for the lead detail page (§22). */
export function leadTimeline(orgId: string, leadId: string, limit = 80): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  all<ActivityRow>(
    `SELECT a.*, u.name AS actor_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.lead_id = ? ORDER BY a.occurred_at DESC LIMIT ?`,
    [leadId, limit],
  ).forEach((row) => {
    events.push({
      id: row.id,
      type: row.type,
      label: row.subject ?? row.type.replace(/_/g, " "),
      detail: row.body,
      at: row.occurred_at,
      actor: row.actor_name,
      tone: toneForActivity(row.type),
    });
  });

  all<{ id: string; title: string; subject: string | null; sent_at: string | null; created_at: string }>(
    "SELECT id, title, subject, sent_at, created_at FROM proposals WHERE lead_id = ? AND org_id = ?",
    [leadId, orgId],
  ).forEach((row) => {
    events.push({
      id: row.id,
      type: "proposal_created",
      label: `Proposal generated: ${row.title}`,
      at: row.created_at,
      tone: "brand",
    });
    if (row.sent_at) {
      events.push({ id: `${row.id}-sent`, type: "proposal_sent", label: "Proposal sent", at: row.sent_at, tone: "brand" });
    }
  });

  all<{ id: string; to_address: string; subject: string; sent_at: string | null; created_at: string; status: string }>(
    "SELECT id, to_address, subject, sent_at, created_at, status FROM emails WHERE lead_id = ? AND org_id = ? AND direction = 'outbound'",
    [leadId, orgId],
  ).forEach((row) => {
    events.push({
      id: row.id,
      type: "email",
      label: `Email sent: ${row.subject}`,
      detail: `To ${row.to_address} · status ${row.status}`,
      at: row.sent_at ?? row.created_at,
      tone: row.status === "failed" || row.status === "bounced" ? "danger" : "neutral",
    });
  });

  all<{ id: string; role: string; body: string; created_at: string; conversation_id: string }>(
    "SELECT m.id, m.role, m.body, m.created_at, m.conversation_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.lead_id = ? ORDER BY m.created_at DESC LIMIT 40",
    [leadId],
  ).forEach((row) => {
    events.push({
      id: row.id,
      type: `message_${row.role}`,
      label: row.role === "prospect" ? "Prospect replied" : row.role === "ai" ? "AI agent replied" : "Agent replied",
      detail: row.body.slice(0, 200),
      at: row.created_at,
      tone: row.role === "prospect" ? "warning" : "neutral",
    });
  });

  all<{ id: string; title: string; due_at: string | null; created_at: string; status: string }>(
    "SELECT id, title, due_at, created_at, status FROM tasks WHERE lead_id = ? AND org_id = ?",
    [leadId, orgId],
  ).forEach((row) => {
    events.push({ id: row.id, type: "task", label: `Task: ${row.title}`, at: row.created_at, tone: row.status === "done" ? "success" : "info" });
  });

  all<{ id: string; title: string; severity: string; created_at: string }>(
    "SELECT id, title, severity, created_at FROM alerts WHERE lead_id = ? AND org_id = ?",
    [leadId, orgId],
  ).forEach((row) => {
    events.push({ id: row.id, type: "alert", label: `Alert: ${row.title}`, at: row.created_at, tone: "ember" });
  });

  return events.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

function toneForActivity(type: string): string {
  if (type === "stage_change") return "brand";
  if (type === "alert") return "ember";
  if (type === "audit_complete") return "info";
  if (type === "call") return "success";
  if (type === "note") return "neutral";
  return "neutral";
}

/* ══════════════════════════════════════════════════════════════════════════
   Aggregates used by the dashboard & lead finder
   ══════════════════════════════════════════════════════════════════════════ */

export function leadStatusCounts(orgId: string): Record<string, number> {
  const rows = all<{ status: string; count: number }>("SELECT status, COUNT(*) AS count FROM leads WHERE org_id = ? GROUP BY status", [orgId]);
  const counts: Record<string, number> = {};
  LEAD_STATUSES.forEach((status) => {
    counts[status] = 0;
  });
  rows.forEach((row) => {
    counts[row.status] = row.count;
  });
  return counts;
}

export function countLeads(orgId: string, filter: LeadFilter = {}): number {
  return listLeads(orgId, { ...filter, limit: 1 }).total;
}

export function openPipelineValue(orgId: string): number {
  return (
    one<{ total: number }>(
      `SELECT COALESCE(SUM(COALESCE(estimated_value,0)),0) AS total FROM leads
       WHERE org_id = ? AND status IN (${OPEN_STATUSES.map(() => "?").join(",")})`,
      [orgId, ...OPEN_STATUSES],
    )?.total ?? 0
  );
}

export function leadsNeedingFollowUp(orgId: string, limit = 50): Lead[] {
  return listLeads(orgId, { followUpDue: true, sort: "follow_up", limit }).items;
}

/** Team workload snapshot for the team screen. */
export function agentWorkload(orgId: string): { userId: string; name: string; role: string; assigned: number; open: number; won: number; stale: number }[] {
  return all<{ user_id: string; name: string; role: string; assigned: number; open: number; won: number; stale: number }>(
    `SELECT u.id AS user_id, u.name, u.role,
            COUNT(l.id) AS assigned,
            SUM(CASE WHEN l.status NOT IN ('won','lost') THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN l.status NOT IN ('won','lost') AND (l.last_activity_at IS NULL OR l.last_activity_at < datetime('now','-14 days')) THEN 1 ELSE 0 END) AS stale
     FROM users u LEFT JOIN leads l ON l.owner_id = u.id AND l.org_id = u.org_id
     WHERE u.org_id = ? AND u.status = 'active'
     GROUP BY u.id ORDER BY assigned DESC`,
    [orgId],
  ).map((row) => ({
    userId: row.user_id,
    name: row.name,
    role: row.role,
    assigned: row.assigned ?? 0,
    open: row.open ?? 0,
    won: row.won ?? 0,
    stale: row.stale ?? 0,
  }));
}

export function businessIdsWithLeads(orgId: string): Set<string> {
  return new Set(all<{ business_id: string }>("SELECT business_id FROM leads WHERE org_id = ?", [orgId]).map((r) => r.business_id));
}

export function leadOptions(orgId: string): { id: string; label: string; status: string }[] {
  return all<{ id: string; name: string; status: string }>(
    "SELECT l.id, b.name, l.status FROM leads l JOIN businesses b ON b.id = l.business_id WHERE l.org_id = ? ORDER BY b.name ASC LIMIT 500",
    [orgId],
  ).map((row) => ({ id: row.id, label: row.name, status: row.status }));
}

export type { BusinessModel as HydratedBusiness, ContactModel as HydratedContact };
