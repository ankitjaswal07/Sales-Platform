import "server-only";

import { analyticsSummary, nextBestActions, rangeFor } from "../db/repo/analytics";
import { listLeads, leadsNeedingFollowUp, leadStatusCounts } from "../db/repo/lead";
import { listTasks, taskCounts, listNotifications, unreadNotificationCount, jobStats, listAlertRules, listJobs } from "../db/repo/ops";
import { listConversations } from "../db/repo/engagement";
import { getOrganization } from "../db/repo/org";
import { stalledLeads } from "./pipeline";
import { organizationProfile } from "./org-profile";
import { integrationState } from "../integrations/registry";

/**
 * The morning briefing (§2, §71) — the answer to "who should I contact today?".
 *
 * Everything here is derived from stored records. If the workspace is empty the
 * briefing says so and links to the action that fills it, rather than rendering
 * a wall of zeros that looks like a broken dashboard.
 */

export interface BestOpportunity {
  leadId: string;
  businessId: string;
  businessName: string;
  industry: string | null;
  location: string | null;
  websiteUrl: string | null;
  hasWebsite: boolean;
  leadScore: number;
  websiteScore: number | null;
  opportunityScore: number | null;
  temperature: string;
  status: string;
  intent: string;
  reviewCount: number;
  rating: number | null;
  estimatedValue: number | null;
  currency: string;
  topFinding: string | null;
  whyThisLead: string;
  recommendedAction: string;
  recommendedTone: string;
  urgency: "now" | "today" | "this_week";
  ownerName: string | null;
  lastActivityAt: string | null;
}

export interface Briefing {
  generatedAt: string;
  greeting: string;
  headline: string;
  subline: string;
  urgencyCount: number;
  metrics: {
    hotLeads: number;
    uncontactedHot: number;
    proposalsOutstanding: number;
    conversationsWaiting: number;
    overdueTasks: number;
    newLeadsThisWeek: number;
    pipelineValue: number;
    wonThisMonth: number;
    currency: string;
  };
  needsAttentionNow: BriefingItem[];
  bestOpportunities: BestOpportunity[];
  stalled: { leadId: string; businessName: string; status: string; days: number; reason: string }[];
  setup: SetupState;
  nextActions: ReturnType<typeof nextBestActions>;
}

export interface BriefingItem {
  id: string;
  kind: "hot_lead" | "conversation" | "proposal" | "task" | "alert" | "setup" | "job";
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
}

export interface SetupState {
  complete: boolean;
  completedSteps: number;
  totalSteps: number;
  steps: { key: string; label: string; done: boolean; href: string; detail: string; blocked?: string }[];
  integrationsReady: number;
  integrationsTotal: number;
  dataProviderConnected: boolean;
  emailConfigured: boolean;
  whatsappConfigured: boolean;
  aiMode: string;
}

export function setupState(orgId: string): SetupState {
  const organization = getOrganization(orgId);
  const profile = organizationProfile(orgId);
  const onboarding = organization?.onboarding ?? {};

  const integrationKeys = ["ai_provider", "google_places", "pagespeed", "email", "whatsapp", "storage"] as const;
  const states = integrationKeys.map((key) => ({ key, state: integrationState(key) }));
  const ready = states.filter((s) => s.state.configured).length;

  const steps: SetupState["steps"] = [
    {
      key: "agency_profile",
      label: "Complete your agency profile",
      done: profile.configured,
      href: "/settings?tab=agency",
      detail: "Your name, reply-to email, phone and website are used on every proposal and outreach email.",
      blocked: profile.missing.length ? `Missing: ${profile.missing.join(", ")}` : undefined,
    },
    {
      key: "team",
      label: "Invite your team and set roles",
      done: Boolean(onboarding.team),
      href: "/settings?tab=team",
      detail: "Roles control who can approve proposals, export data and change settings.",
    },
    {
      key: "data_source",
      label: "Connect a business data source",
      done: integrationState("google_places").configured || Boolean(onboarding.sample_data),
      href: "/settings?tab=integrations&highlight=google_places",
      detail: "Without a provider the Lead Finder uses a clearly-labelled sample dataset you can still explore end to end.",
      blocked: integrationState("google_places").configured ? undefined : "Google Places API key required for real market data.",
    },
    {
      key: "audit",
      label: "Run your first website audit",
      done: Boolean(onboarding.first_audit),
      href: "/lead-finder",
      detail: "Audits are what make the proposals specific — every claim traces back to a measurement.",
    },
    {
      key: "proposal",
      label: "Generate and approve a proposal",
      done: Boolean(onboarding.first_proposal),
      href: "/leads",
      detail: "Proposals are drafted by AI, then approved by a human before they can leave the platform.",
    },
    {
      key: "outreach",
      label: "Connect email to send outreach",
      done: integrationState("email").configured,
      href: "/settings?tab=integrations&highlight=email",
      detail: "Compose emails now, or connect Resend, SendGrid or Postmark to actually deliver them.",
      blocked: integrationState("email").configured ? undefined : "EMAIL_PROVIDER and a provider API key are required.",
    },
    {
      key: "alerts",
      label: "Turn on high-intent alerts",
      done: integrationState("whatsapp").configured,
      href: "/settings?tab=notifications",
      detail: "In-app alerts always work. Add the official WhatsApp Cloud API or email to be reachable when a prospect is ready.",
      blocked: integrationState("whatsapp").configured ? undefined : "WhatsApp alerts need the official Meta Cloud API credentials.",
    },
    {
      key: "first_leads",
      label: "Find My First Leads",
      done: Boolean(onboarding.first_leads),
      href: "/lead-finder",
      detail: "Run a search and the platform discovers, audits, scores and ranks everything for you.",
    },
  ];

  return {
    complete: steps.every((step) => step.done),
    completedSteps: steps.filter((step) => step.done).length,
    totalSteps: steps.length,
    steps,
    integrationsReady: ready,
    integrationsTotal: integrationKeys.length,
    dataProviderConnected: integrationState("google_places").configured,
    emailConfigured: integrationState("email").configured,
    whatsappConfigured: integrationState("whatsapp").configured,
    aiMode: integrationState("ai_provider").configured ? "Language model connected" : "Built-in reasoning engine (no API key required)",
  };
}

export function buildBriefing(orgId: string, options: { userId?: string | null; userName?: string | null; rangeDays?: number } = {}): Briefing {
  const days = options.rangeDays && options.rangeDays > 0 ? options.rangeDays : 30;
  const range = rangeFor(days);
  const summary = analyticsSummary(orgId, range);
  const organization = getOrganization(orgId);
  const currency = organization?.currency ?? "GBP";

  const hot = listLeads(orgId, { temperatures: ["hot"], limit: 12, sort: "opportunity" }).items;
  const uncontactedHot = hot.filter((lead) => !lead.lastContactedAt);
  const followUps = leadsNeedingFollowUp(orgId, 10);
  const conversations = listConversations(orgId, { status: ["human_takeover"], limit: 50 });
  const waitingOnUs = conversations.items.filter((c) => c.aiEnabled === false || c.unreadForOrg > 0);
  const tasks = taskCounts(orgId);
  const alerts = listNotifications(orgId, { unreadOnly: true, limit: 6 });
  const stalled = stalledLeads(orgId).slice(0, 6);
  const setup = setupState(orgId);
  const jobs = jobStats(orgId);
  const rules = listAlertRules(orgId).filter((rule) => rule.enabled);

  const needsAttentionNow: BriefingItem[] = [];

  for (const lead of uncontactedHot.slice(0, 4)) {
    needsAttentionNow.push({
      id: `hot_${lead.id}`,
      kind: "hot_lead",
      severity: "critical",
      title: `${lead.business?.name ?? "A lead"} is hot and has never been contacted`,
      detail: `Lead score ${lead.leadScore ?? 0}${lead.websiteScore !== null ? `, website ${lead.websiteScore}/100` : ""}${lead.estimatedValue ? `, worth about ${currency} ${lead.estimatedValue.toLocaleString()}` : ""}. ${lead.nextAction ?? "Reach out while the audit is fresh."}`,
      href: `/leads/${lead.id}`,
      actionLabel: "Open lead",
    });
  }

  for (const conversation of waitingOnUs.slice(0, 3)) {
    needsAttentionNow.push({
      id: `conv_${conversation.id}`,
      kind: "conversation",
      severity: conversation.intentScore >= 70 ? "critical" : "warning",
      title: `${conversation.businessName ?? "A prospect"} is waiting for a reply`,
      detail: `Last message from the prospect${conversation.lastMessageAt ? ` ${relativeTime(conversation.lastMessageAt)}` : ""}${conversation.intent ? ` · detected intent: ${conversation.intent.replace(/_/g, " ")}` : ""}.`,
      href: `/conversations/${conversation.id}`,
      actionLabel: "Reply now",
    });
  }

  const openedProposals = summary.sales.proposalsOpened;
  if (openedProposals > 0) {
    needsAttentionNow.push({
      id: "proposals_opened",
      kind: "proposal",
      severity: "warning",
      title: `${openedProposals} proposal${openedProposals === 1 ? "" : "s"} opened in the last ${range.label}`,
      detail: "An opened proposal is the strongest buying signal you will get. Call while they are reading.",
      href: "/proposals?opened=1",
      actionLabel: "Review opened",
    });
  }

  if (tasks.overdue > 0) {
    needsAttentionNow.push({
      id: "tasks_overdue",
      kind: "task",
      severity: "warning",
      title: `${tasks.overdue} overdue task${tasks.overdue === 1 ? "" : "s"}`,
      detail: `You also have ${tasks.today} due today. Clearing these first protects the follow-up cadence.`,
      href: "/tasks?overdue=1",
      actionLabel: "Open tasks",
    });
  }

  if (rules.length === 0) {
    needsAttentionNow.push({
      id: "no_rules",
      kind: "setup",
      severity: "info",
      title: "No high-intent alert rules are active",
      detail: "Without a rule, a prospect who says \"ready to start\" will not reach you outside the app.",
      href: "/settings?tab=notifications",
      actionLabel: "Add a rule",
    });
  }

  if (jobs.failed > 0) {
    needsAttentionNow.push({
      id: "jobs_failed",
      kind: "job",
      severity: "warning",
      title: `${jobs.failed} background job${jobs.failed === 1 ? "" : "s"} need attention`,
      detail: "Failed jobs include the reason and can be retried from Diagnostics.",
      href: "/settings?tab=diagnostics",
      actionLabel: "Open diagnostics",
    });
  }

  for (const alert of alerts.slice(0, 2)) {
    needsAttentionNow.push({
      id: `alert_${alert.id}`,
      kind: "alert",
      severity: alert.severity,
      title: alert.title,
      detail: alert.body ?? "",
      href: alert.actionUrl ?? "/notifications",
      actionLabel: "View",
    });
  }

  const leadIndex = new Map(listLeads(orgId, { limit: 1000 }).items.map((lead) => [lead.id, lead]));
  const bestOpportunities: BestOpportunity[] = summary.bestOpportunities.slice(0, 6).map((card) => {
    const lead = leadIndex.get(card.leadId) ?? null;
    const score = card.leadScore ?? 0;
    return {
      leadId: card.leadId,
      businessId: card.businessId,
      businessName: card.businessName,
      industry: card.industry,
      location: card.city,
      websiteUrl: card.websiteUrl,
      hasWebsite: Boolean(card.websiteUrl),
      leadScore: score,
      websiteScore: card.websiteScore,
      opportunityScore: card.opportunityScore,
      temperature: card.temperature,
      status: lead?.status ?? "new",
      intent: lead?.intent ?? "unknown",
      reviewCount: card.reviewCount,
      rating: card.rating,
      estimatedValue: card.estimatedValue,
      currency: card.currency,
      topFinding: card.topFinding,
      whyThisLead: card.whyThisLead,
      recommendedAction: card.recommendedAction,
      recommendedTone: score >= 78 ? "Direct and specific — they are actively looking." : "Consultative — lead with what you measured, then ask one question.",
      urgency: score >= 85 ? "now" : score >= 72 ? "today" : "this_week",
      ownerName: lead?.owner?.name ?? null,
      lastActivityAt: lead?.lastActivityAt ?? null,
    };
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = options.userName?.split(" ")[0] ?? "";
  const urgentCount = needsAttentionNow.filter((item) => item.severity === "critical").length;

  const headline = setup.completedSteps < setup.totalSteps && summary.leads.total === 0
    ? "Let's get your first leads in"
    : urgentCount > 0
      ? `${urgentCount} thing${urgentCount === 1 ? "" : "s"} need${urgentCount === 1 ? "s" : ""} you now`
      : summary.leads.total === 0
        ? "Your workspace is ready — nothing to chase"
        : "Nothing urgent — a good day to work the pipeline";

  const subline = summary.leads.total === 0
    ? `Set-up is ${setup.completedSteps}/${setup.totalSteps} complete. The fastest path to value is running a discovery search, which audits and ranks everything automatically.`
    : `${summary.leads.newThisWeek} new lead${summary.leads.newThisWeek === 1 ? "" : "s"} this week · ${summary.leads.hot} hot · ${summary.websites.highOpportunity} high-opportunity website${summary.websites.highOpportunity === 1 ? "" : "s"} · pipeline worth ${currency} ${summary.sales.pipelineValue.toLocaleString()}.`;

  return {
    generatedAt: new Date().toISOString(),
    greeting,
    headline: name ? `${greeting}, ${name}. ${headline}` : `${greeting}. ${headline}`,
    subline,
    urgencyCount: urgentCount,
    metrics: {
      hotLeads: summary.leads.hot,
      uncontactedHot: uncontactedHot.length,
      proposalsOutstanding: summary.sales.proposalsSent - summary.sales.proposalsAccepted,
      conversationsWaiting: waitingOnUs.length,
      overdueTasks: tasks.overdue,
      newLeadsThisWeek: summary.leads.newThisWeek,
      pipelineValue: summary.sales.pipelineValue,
      wonThisMonth: summary.sales.wonRevenue,
      currency,
    },
    needsAttentionNow: needsAttentionNow.slice(0, 8),
    bestOpportunities,
    stalled: stalled.map((item) => ({ leadId: item.leadId, businessName: item.businessName, status: item.status as string, days: item.days, reason: item.reason })),
    setup,
    nextActions: nextBestActions(orgId),
  };
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Scheduled work that will run in the next 24 hours — from the job queue, not invented. */
export function upcomingJobs(): { type: string; label: string; scheduledAt: string; status: string }[] {
  return listJobs("", { status: ["queued", "retrying", "running"], limit: 10 }).items.map((job) => ({
    type: job.type,
    label: job.label ?? job.type,
    scheduledAt: job.scheduledAt ?? job.createdAt,
    status: job.status,
  }));
}

export function notificationCount(orgId: string, userId: string | null): number {
  return unreadNotificationCount(orgId, userId ?? undefined);
}

export function statusBreakdown(orgId: string): Record<string, number> {
  return leadStatusCounts(orgId);
}

export function openTasks(orgId: string, userId?: string | null) {
  return listTasks(orgId, { status: ["open", "in_progress"], assignedUserId: userId ?? undefined, limit: 5 });
}
