import "server-only";

import { getLead, listLeads, moveLeadToStage, recordActivity, saveLeadScore, updateLead, type LeadFilter } from "../db/repo/lead";
import { listStages, getOrganization } from "../db/repo/org";
import { getBusiness, listContacts, latestAuditForBusiness } from "../db/repo/business";
import { one } from "../db";
import { createTask, getSetting, listPricingPlans, listServices, setSetting } from "../db/repo/ops";
import { notify } from "./notifications";
import { computeLeadScore } from "../scoring/lead";
import { auditScoresFrom } from "./proposal";
import { LEAD_STATUSES, type IntentLevel, type LeadStatus } from "../types";
import { toLeadViews, type LeadView } from "./lead-view";
import { logger } from "../logger";

/**
 * Pipeline operations (§33, §36).
 *
 * The Kanban board reads straight from the lead table and writes through
 * `moveLeadToStage`, which keeps status, stage position and the activity
 * timeline consistent. Invalid transitions are rejected with an explanation
 * rather than silently ignored.
 */

export interface BoardStage {
  key: string;
  label: string;
  position: number;
  type: string;
  color: string | null;
  probability: number;
  slaHours: number | null;
  isActive: boolean;
  count: number;
  value: number;
  averageScore: number;
  hotCount: number;
  staleCount: number;
  leads: BoardLead[];
}

export interface BoardLead {
  id: string;
  reference: string;
  businessName: string;
  industry: string | null;
  city: string | null;
  country: string | null;
  status: LeadStatus;
  temperature: string;
  leadScore: number;
  websiteScore: number | null;
  opportunityScore: number | null;
  value: number | null;
  currency: string;
  ownerName: string | null;
  ownerInitials: string | null;
  reviewCount: number;
  rating: number | null;
  daysInStage: number;
  lastActivityAt: string | null;
  nextAction: string | null;
  intent: string;
  hasWebsite: boolean;
}

export interface BoardMetrics {
  totalLeads: number;
  totalValue: number;
  weightedValue: number;
  wonValue: number;
  averageScore: number;
  hotCount: number;
  staleCount: number;
  currency: string;
}

export function pipelineBoard(orgId: string, options: { ownerId?: string; search?: string; limitPerStage?: number } = {}): { stages: BoardStage[]; metrics: BoardMetrics } {
  const stages = listStages(orgId).filter((stage) => stage.isActive);
  const organization = getOrganization(orgId);
  const currency = organization?.currency ?? "GBP";
  const limitPerStage = options.limitPerStage ?? 40;

  const filter: LeadFilter = {};
  if (options.ownerId) filter.ownerIds = [options.ownerId];
  if (options.search) filter.search = options.search;

  const { items } = listLeads(orgId, { ...filter, limit: 1000, sort: "lead_score" });
  const leads = toLeadViews(items);

  const board: BoardStage[] = stages.map((stage) => {
    const stageLeads = leads.filter((lead) => lead.status === stage.key).slice(0, limitPerStage);
    const mapped = stageLeads.map(toBoardLead);
    const all = leads.filter((lead) => lead.status === stage.key);

    return {
      key: stage.key,
      label: stage.name,
      position: stage.position,
      type: stage.type,
      color: stage.color,
      probability: stage.probability,
      slaHours: stage.slaHours,
      isActive: stage.isActive,
      count: all.length,
      value: all.reduce((sum, lead) => sum + (lead.estimatedValue ?? 0), 0),
      averageScore: all.length ? Math.round(all.reduce((sum, lead) => sum + lead.leadScore, 0) / all.length) : 0,
      hotCount: all.filter((lead) => lead.temperature === "hot").length,
      staleCount: all.filter((lead) => lead.daysSinceActivity > 7).length,
      leads: mapped,
    };
  });

  const openStages = stages.filter((stage) => !["won", "lost"].includes(stage.key));
  const openLeads = leads.filter((lead) => openStages.some((stage) => stage.key === lead.status));
  const weightedValue = openLeads.reduce((sum, lead) => {
    const stage = stages.find((s) => s.key === lead.status);
    return sum + (lead.estimatedValue ?? 0) * ((stage?.probability ?? 0) / 100);
  }, 0);

  return {
    stages: board,
    metrics: {
      totalLeads: leads.length,
      totalValue: openLeads.reduce((sum, lead) => sum + (lead.estimatedValue ?? 0), 0),
      weightedValue: Math.round(weightedValue),
      wonValue: leads.filter((lead) => lead.status === "won").reduce((sum, lead) => sum + (lead.estimatedValue ?? 0), 0),
      averageScore: leads.length ? Math.round(leads.reduce((sum, lead) => sum + lead.leadScore, 0) / leads.length) : 0,
      hotCount: leads.filter((lead) => lead.temperature === "hot").length,
      staleCount: openLeads.filter((lead) => lead.daysSinceActivity > 7).length,
      currency,
    },
  };
}

function toBoardLead(lead: LeadView): BoardLead {
  return {
    id: lead.id,
    reference: lead.reference,
    businessName: lead.businessName,
    industry: lead.industry,
    city: lead.city,
    country: lead.country,
    status: lead.status,
    temperature: lead.temperature,
    leadScore: lead.leadScore,
    websiteScore: lead.websiteScore,
    opportunityScore: lead.opportunityScore,
    value: lead.estimatedValue,
    currency: lead.currency,
    ownerName: lead.ownerName,
    ownerInitials: lead.ownerInitials,
    reviewCount: lead.reviewCount,
    rating: lead.rating,
    daysInStage: lead.daysSinceActivity,
    lastActivityAt: lead.lastActivityAt,
    nextAction: lead.nextAction,
    intent: lead.intent,
    hasWebsite: lead.hasWebsite,
  };
}

/* ── transitions ─────────────────────────────────────────────────────────── */

export interface TransitionResult {
  ok: boolean;
  message: string;
  lead?: ReturnType<typeof getLead>;
}

export function transitionLead(
  orgId: string,
  leadId: string,
  toStage: LeadStatus,
  options: { actorId: string | null; note?: string; force?: boolean; value?: number | null },
): TransitionResult {
  if (!LEAD_STATUSES.includes(toStage)) {
    return { ok: false, message: `"${toStage}" is not a pipeline stage in this workspace.` };
  }

  const lead = getLead(orgId, leadId);
  if (!lead) return { ok: false, message: "Lead not found." };
  if (lead.status === toStage) {
    return { ok: true, message: `${getBusiness(orgId, lead.businessId)?.name ?? "This lead"} is already in ${toStage}.`, lead };
  }

  const stages = listStages(orgId);
  const target = stages.find((s) => s.key === toStage);
  if (!target) return { ok: false, message: `The "${toStage}" stage no longer exists. Reload the pipeline.` };

  // Guardrail: winning a lead without a proposal is almost always a mistake.
  const proposalRow = one<{ id: string }>("SELECT id FROM proposals WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1", [leadId]);
  if (toStage === "won" && !options.force && !proposalRow) {
    return {
      ok: false,
      message: "This lead has no proposal yet. Create and approve a proposal first, or confirm you want to mark it won without one.",
    };
  }

  const moved = moveLeadToStage(orgId, leadId, toStage, { actorId: options.actorId, note: options.note });

  if (options.value !== undefined) {
    updateLead(orgId, leadId, { estimatedValue: options.value });
  }

  if (toStage === "won") {
    updateLead(orgId, leadId, { wonAt: new Date().toISOString(), lostAt: null, lostReason: null });
    notify(orgId, {
      type: "proposal_accepted",
      title: `🎉 Won: ${getBusiness(orgId, lead.businessId)?.name ?? "Lead"}`,
      body: `Moved to Won at ${lead.estimatedValue ? `${lead.currency} ${lead.estimatedValue.toLocaleString()}` : "no recorded value"}. Convert it to a project to start delivery.`,
      entityType: "lead",
      entityId: leadId,
      actionUrl: `/leads/${leadId}?tab=project`,
      severity: "success",
    });
  }

  if (toStage === "lost") {
    updateLead(orgId, leadId, { lostAt: new Date().toISOString(), lostReason: options.note ?? null });
  }

  // Moving out of a terminal state clears the terminal timestamps.
  if (toStage !== "won" && toStage !== "lost") {
    updateLead(orgId, leadId, { wonAt: null, lostAt: null });
  }

  recordActivity(orgId, {
    leadId,
    businessId: lead.businessId,
    userId: options.actorId,
    type: "stage_change",
    subject: `Moved from ${lead.status.replace(/_/g, " ")} to ${target.name}`,
    body: options.note ?? null,
    metadata: { from: lead.status, to: toStage, probability: target.probability },
  });

  logger.info("pipeline", "Lead stage changed", { leadId, from: lead.status, to: toStage, actor: options.actorId });

  return { ok: true, message: `${getBusiness(orgId, lead.businessId)?.name ?? "Lead"} moved to ${target.name}.`, lead: getLead(orgId, leadId) };
}

/** SLA + staleness sweep, called by the daily job and on demand from the board. */
export function stalledLeads(orgId: string): { leadId: string; businessName: string; status: LeadStatus; days: number; slaHours: number; reason: string }[] {
  const stages = listStages(orgId);
  const { items } = listLeads(orgId, { limit: 500, sort: "lead_score" });
  const leads = toLeadViews(items);
  const results: { leadId: string; businessName: string; status: LeadStatus; days: number; slaHours: number; reason: string }[] = [];

  for (const lead of leads) {
    if (["won", "lost", "not_interested"].includes(lead.status)) continue;
    const stage = stages.find((s) => s.key === lead.status);
    const days = lead.daysSinceActivity;
    const slaHours = stage?.slaHours ?? 48;

    if (days * 24 > slaHours) {
      results.push({
        leadId: lead.id,
        businessName: lead.businessName,
        status: lead.status,
        days,
        slaHours,
        reason: `No activity for ${days} day${days === 1 ? "" : "s"}; this stage targets a response within ${Math.round(slaHours / 24)} day${slaHours <= 24 ? "" : "s"}.`,
      });
    }
  }

  return results.sort((a, b) => b.days - a.days);
}

export function createFollowUpTask(
  orgId: string,
  leadId: string,
  input: { title?: string; dueAt: string; priority?: "low" | "medium" | "high" | "urgent"; assignedUserId?: string | null; description?: string },
): ReturnType<typeof createTask> {
  const lead = getLead(orgId, leadId);
  const view = lead ? toLeadViews([lead])[0] : null;
  return createTask(orgId, {
    title: input.title ?? `Follow up with ${view?.businessName ?? "lead"}`,
    description: input.description ?? lead?.nextAction ?? "Continue the conversation and confirm next steps.",
    type: "follow_up",
    priority: input.priority ?? (lead?.temperature === "hot" ? "urgent" : "medium"),
    dueAt: input.dueAt,
    leadId,
    businessId: lead?.businessId ?? null,
    assignedUserId: input.assignedUserId ?? lead?.ownerId ?? null,
  });
}

/* ── re-score a single lead on demand ────────────────────────────────────── */

export function rescoreLead(orgId: string, leadId: string): { total: number; temperature: string; reason: string } | null {
  const lead = getLead(orgId, leadId);
  const business = lead ? getBusiness(orgId, lead.businessId) : null;
  if (!lead || !business) return null;

  const audit = latestAuditForBusiness(orgId, business.id);
  const contacts = listContacts(orgId, { businessId: business.id, limit: 10 });
  const organization = getOrganization(orgId);
  const weights = organization?.settings.leadScoring.weights;

  const score = computeLeadScore(
    {
      name: business.name,
      industry: business.industry,
      category: business.category,
      city: business.city,
      country: business.country,
      phone: business.phone,
      email: business.email,
      websiteUrl: business.websiteUrl,
      rating: business.rating,
      reviewCount: business.reviewCount,
      employeeRange: business.employeeRange,
      revenueRange: business.revenueRange,
      yearsInBusiness: business.yearsInBusiness,
      socials: business.socials,
      hasDescription: Boolean(business.description),
      hours: business.hours,
    },
    {
      exists: Boolean(business.websiteUrl),
      reachable: business.websiteStatus !== "broken",
      https: true,
      scores: auditScoresFrom(audit) as never,
    },
    {
      hasNamedContact: contacts.some((c) => Boolean(c.name) && !/^(info|hello|enquiries|contact)$/i.test(c.name)),
      hasEmail: contacts.some((c) => Boolean(c.email)) || Boolean(business.email),
      hasPhone: contacts.some((c) => Boolean(c.phone)) || Boolean(business.phone),
      emailVerified: contacts.some((c) => c.emailStatus === "verified"),
    },
    { intent: lead.intent as IntentLevel, weights },
  );

  saveLeadScore(orgId, leadId, score);
  updateLead(orgId, leadId, {
    websiteScore: audit?.overallScore ?? null,
    opportunityScore: score.websiteOpportunity,
    nextAction: score.nextAction,
  });

  return { total: score.total, temperature: score.temperature, reason: score.reason };
}

/* ── stage configuration (§33 custom stages) ─────────────────────────────── */

export function stageOptions(orgId: string) {
  return listStages(orgId).map((stage) => ({
    key: stage.key as LeadStatus,
    label: stage.name,
    probability: stage.probability,
    color: stage.color,
    type: stage.type,
    slaHours: stage.slaHours,
    isActive: stage.isActive,
  }));
}

export function savedPipelineView(orgId: string, userId: string | null) {
  return getSetting(orgId, "pipeline", "default_view", { ownerId: null as string | null, sort: "lead_score" as const, density: "comfortable" as const });
}

export function savePipelineView(orgId: string, userId: string | null, view: Record<string, unknown>): void {
  setSetting(orgId, "pipeline", "default_view", view);
}

export function catalogueSummary(orgId: string) {
  return { services: listServices(orgId), plans: listPricingPlans(orgId) };
}
