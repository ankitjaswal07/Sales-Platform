import "server-only";

import { interpretAiCommand, suggestNextMessage, type NextMessageSuggestion } from "../ai";
import type { CommandInterpretation } from "../ai/types";
import { getBusiness, businessFacets, listContacts, latestAuditForBusiness, listBusinesses } from "../db/repo/business";
import { getLead, listLeads, listActivities, leadTimeline, type LeadFilter } from "../db/repo/lead";
import { analyticsSummary, rangeFor, nextBestActions } from "../db/repo/analytics";
import { listConversations, listMessages, conversationForLead } from "../db/repo/engagement";
import { listStages, can } from "../db/repo/org";
import { globalSearch } from "../db/repo/ops";
import { organizationProfile } from "./org-profile";
import { toLeadViews, type LeadView } from "./lead-view";
import { one } from "../db";
import type { UserRole } from "../types";
import { auditScoresFrom, estimateForLead } from "./pricing";
import type { AuditFinding, IntentLevel } from "../types";

/**
 * AI command centre (§37) and the global assistant (§57).
 *
 * Interpretation is deterministic: the same sentence always produces the same
 * filters and the same proposed actions, which is what makes a confirmation
 * prompt trustworthy. Destructive or bulk actions are returned with
 * `requiresConfirmation` and are never executed here.
 */

export interface CommandExecution {
  interpretation: CommandInterpretation;
  results: {
    leads?: LeadView[];
    businesses?: { id: string; name: string; industry: string | null; city: string | null; hasWebsite: boolean }[];
    metrics?: Record<string, number | string>;
    explanation?: string;
  };
  /** True when the interpretation needs the user to confirm before anything runs. */
  awaitingConfirmation: boolean;
  confirmationPrompt: string | null;
}

export function commandContext(orgId: string, role: UserRole, userId: string | null): {
  canWrite: boolean;
  userRole: string;
  availableIndustries: string[];
} {
  void userId;
  const facets = businessFacets(orgId);
  return {
    canWrite: can(role, "leads.edit") || can(role, "businesses.edit"),
    userRole: role,
    availableIndustries: facets.industries.map((entry) => entry.value),
  };
}

export function runCommand(orgId: string, query: string, role: UserRole, userId: string | null): CommandExecution {
  const interpretation = interpretAiCommand(query, commandContext(orgId, role, userId));

  switch (interpretation.intent) {
    case "search_leads":
    case "generate_proposals": {
      const leads = searchFromInterpretation(orgId, interpretation);
      return {
        interpretation,
        results: { leads },
        awaitingConfirmation: interpretation.needsConfirmation || interpretation.actions.some((action) => action.requiresConfirmation),
        confirmationPrompt: buildConfirmation(interpretation, leads.length),
      };
    }

    case "search_businesses": {
      const { items } = listBusinesses(orgId, {
        search: query.match(/\b(?:called|named)\s+"?([^"]+)"?/i)?.[1],
        industries: interpretation.filters.industries,
        cities: interpretation.filters.locations,
        countries: interpretation.filters.countries,
        minRating: undefined,
        limit: interpretation.filters.limit ?? 20,
      });
      return {
        interpretation,
        results: {
          businesses: items.map((business) => ({
            id: business.id,
            name: business.name,
            industry: business.industry,
            city: business.city,
            hasWebsite: Boolean(business.websiteUrl),
          })),
        },
        awaitingConfirmation: false,
        confirmationPrompt: null,
      };
    }

    case "run_discovery": {
      return {
        interpretation,
        results: { explanation: interpretation.explanation },
        awaitingConfirmation: true,
        confirmationPrompt: `This will search public business data for ${describeFilters(interpretation)} and create leads. It uses your configured provider, and existing businesses are deduplicated rather than duplicated. Run it?`,
      };
    }

    case "analytics_query": {
      const days = interpretation.filters.days ?? 30;
      const summary = analyticsSummary(orgId, rangeFor(days));
      const metrics: Record<string, number | string> = {
        range: `Last ${days} days`,
        totalLeads: summary.leads.total,
        hotLeads: summary.leads.hot,
        warmLeads: summary.leads.warm,
        uncontactedLeads: summary.leads.uncontacted,
        newThisWeek: summary.leads.newThisWeek,
        websitesAudited: summary.websites.audited,
        poorWebsites: summary.websites.poor,
        highOpportunity: summary.websites.highOpportunity,
        proposalsSent: summary.sales.proposalsSent,
        proposalsOpened: summary.sales.proposalsOpened,
        proposalsAccepted: summary.sales.proposalsAccepted,
        closeRate: `${summary.sales.closeRate}%`,
        contactRate: `${summary.sales.contactRate}%`,
        pipelineValue: summary.sales.pipelineValue,
        wonRevenue: summary.sales.wonRevenue,
        averageDealSize: summary.sales.averageDealSize,
        averageSalesCycleDays: summary.sales.averageSalesCycleDays,
      };
      return { interpretation, results: { metrics }, awaitingConfirmation: false, confirmationPrompt: null };
    }

    case "pipeline_action": {
      const leads = searchFromInterpretation(orgId, interpretation);
      return {
        interpretation,
        results: { leads },
        awaitingConfirmation: true,
        confirmationPrompt:
          interpretation.actions.find((action) => action.destructive)?.label !== undefined
            ? `Confirm: ${interpretation.actions.find((a) => a.destructive)?.label} will affect ${leads.length} lead(s). This cannot be undone in bulk once applied.`
            : buildConfirmation(interpretation, leads.length),
      };
    }

    default: {
      const suggestions = nextBestActions(orgId);
      return {
        interpretation,
        results: { explanation: interpretation.explanation, metrics: { openActions: suggestions.length } },
        awaitingConfirmation: false,
        confirmationPrompt: null,
      };
    }
  }
}

function searchFromInterpretation(orgId: string, interpretation: CommandInterpretation): LeadView[] {
  const filter: LeadFilter = {
    search: interpretation.filters.industries?.length === 0 ? undefined : undefined,
    industries: interpretation.filters.industries,
    cities: interpretation.filters.locations,
    countries: interpretation.filters.countries,
    statuses: interpretation.filters.statuses as never,
    temperatures: interpretation.filters.temperatures as never,
    intents: interpretation.filters.intents as never,
    minLeadScore: interpretation.filters.minLeadScore,
    maxWebsiteScore: interpretation.filters.maxWebsiteScore,
    minReviews: interpretation.filters.minReviews,
    maxReviews: interpretation.filters.maxReviews,
    websiteStatus: interpretation.filters.websiteStatus as never,
    limit: interpretation.filters.limit ?? 25,
    sort: interpretation.filters.sort ?? "lead_score",
    notContacted: interpretation.filters.notContacted,
  };
  const { items } = listLeads(orgId, filter);
  return toLeadViews(items);
}

function buildConfirmation(interpretation: CommandInterpretation, count: number): string | null {
  if (!interpretation.actions.length) return null;
  const action = interpretation.actions[0];
  if (!action.requiresConfirmation) return null;
  return `${action.label} will run for ${count} lead${count === 1 ? "" : "s"}. ${action.destructive ? "This changes records and is not reversible in bulk." : "Nothing is sent to a prospect without your approval of the specific content."} Continue?`;
}

function describeFilters(interpretation: CommandInterpretation): string {
  const parts: string[] = [];
  if (interpretation.filters.industries?.length) parts.push(interpretation.filters.industries.join(", "));
  if (interpretation.filters.locations?.length) parts.push(`in ${interpretation.filters.locations.join(", ")}`);
  if (interpretation.filters.countries?.length) parts.push(`in ${interpretation.filters.countries.join(", ")}`);
  return parts.length ? parts.join(" ") : "the requested criteria";
}

/* ══════════════════════════════════════════════════════════════════════════
   "What should I say to this prospect?"
   ══════════════════════════════════════════════════════════════════════════ */

export interface LeadAdvice {
  leadId: string;
  businessName: string;
  headline: string;
  situation: string;
  evidence: string[];
  suggestion: NextMessageSuggestion;
  /** Channels that are genuinely available for this lead right now, and why. */
  channelOptions: { channel: NextMessageSuggestion["channel"]; label: string; available: boolean; reason: string }[];
  nextAction: string;
  shouldCallInstead: boolean;
  callReason: string | null;
  pricingGuidance: { low: number; mid: number; high: number; currency: string; confidence: number; disclaimer: string } | null;
  verifiedFacts: string[];
  aiInterpretation: string[];
}

export async function adviseOnLead(orgId: string, leadId: string, options: { channel?: NextMessageSuggestion["channel"]; userId?: string | null } = {}): Promise<LeadAdvice | null> {
  const lead = getLead(orgId, leadId);
  if (!lead) return null;
  const business = lead.business ?? getBusiness(orgId, lead.businessId);
  if (!business) return null;

  const profile = organizationProfile(orgId);
  const audit = latestAuditForBusiness(orgId, business.id);
  const contacts = listContacts(orgId, { businessId: business.id, limit: 5 });
  const conversation = conversationForLead(orgId, leadId);
  const timeline = leadTimeline(orgId, leadId, 12);
  const findings = (audit?.findings ?? []) as AuditFinding[];

  const proposalRow = one<{ id: string; viewed_at: string | null }>("SELECT id, viewed_at FROM proposals WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1", [leadId]) ?? null;

  const suggestion = suggestNextMessage({
    businessName: business.name,
    contactName: contacts[0]?.name ?? null,
    stage: lead.status,
    temperature: lead.temperature,
    intent: lead.intent,
    industry: business.industry,
    city: business.city,
    websiteUrl: business.websiteUrl,
    findings: findings.map((finding) => ({ title: finding.title, evidence: finding.evidence })),
    lastActivity: lead.lastActivityAt,
    proposalOpened: Boolean(proposalRow?.viewed_at),
    meetingBooked: false,
    agencyName: profile.name,
    senderName: undefined,
  });

  const pricing = estimateForLead(orgId, leadId);

  const evidence = findings
    .filter((finding) => finding.severity !== "positive")
    .slice(0, 6)
    .map((finding) => `[${finding.severity}] ${finding.title} — ${finding.evidence}`);

  const shouldCallInstead = ["wants_call", "ready_to_start", "high_intent", "wants_pricing"].includes(lead.intent) || (lead.estimatedValue ?? 0) > 8000;

  return {
    leadId,
    businessName: business.name,
    headline: suggestion.headline,
    situation: [
      `${business.name} is a ${business.industry?.toLowerCase() ?? "business"}${business.city ? ` in ${business.city}` : ""} with ${business.reviewCount ?? 0} public reviews${business.rating ? ` at ${business.rating.toFixed(1)}★` : ""}.`,
      lead.websiteScore !== null ? `Their website scores ${lead.websiteScore}/100 — ${lead.websiteScore < 55 ? "well below what the market expects" : "close to acceptable but with fixable gaps"}.` : "No website audit has been run yet.",
      conversation?.summary ? `Conversation so far: ${conversation.summary}` : "No conversation has started yet.",
      lead.lastContactedAt ? `Last contacted ${Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86_400_000)} day(s) ago.` : "Never contacted.",
    ].join(" "),
    evidence,
    suggestion,
    channelOptions: [
      {
        channel: "email",
        label: "Email",
        available: Boolean(contacts.find((c) => c.email)?.email ?? business.email),
        reason: contacts.find((c) => c.email)?.email ?? business.email ? `Address on file: ${contacts.find((c) => c.email)?.email ?? business.email}` : "No email address on file — enrich the contact or use the enquiry form.",
      },
      {
        channel: "call_script",
        label: "Call",
        available: Boolean(contacts.find((c) => c.phone)?.phone ?? business.phone),
        reason: contacts.find((c) => c.phone)?.phone ?? business.phone ? `Number on file: ${contacts.find((c) => c.phone)?.phone ?? business.phone}` : "No phone number recorded for this business.",
      },
      {
        channel: "chat",
        label: "Live chat",
        available: Boolean(conversation && conversation.status !== "closed"),
        reason: conversation ? `Conversation ${conversation.status === "human_takeover" ? "is waiting for a human" : "is active"}.` : "No conversation has started yet — start one from the Conversation tab.",
      },
      {
        channel: "whatsapp",
        label: "WhatsApp",
        available: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && (contacts.find((c) => c.phone)?.phone ?? business.phone)),
        reason: process.env.WHATSAPP_PHONE_NUMBER_ID
          ? "Only for replies inside an open 24-hour session, and only via the official Cloud API. Cold business-initiated messages require an approved template."
          : "WhatsApp is not configured. Alerts and outreach via WhatsApp require the official Meta Cloud API credentials.",
      },
    ],
    nextAction: lead.nextAction ?? "Send the suggested message and record the outcome.",
    shouldCallInstead,
    callReason: shouldCallInstead
      ? "Their detected intent or project value points to a conversation rather than another email. Emails are easy to postpone; a call converts intent into a decision."
      : null,
    pricingGuidance: pricing
      ? {
          low: pricing.estimate.low,
          mid: pricing.estimate.mid,
          high: pricing.estimate.high,
          currency: pricing.estimate.currency,
          confidence: pricing.confidence,
          disclaimer: "This is an estimate derived from measured scope, not a quote. A human approves every figure before it reaches a client, and the final proposal is fixed-price.",
        }
      : null,
    verifiedFacts: [
      ...(audit
        ? [
            `Website audited ${new Date(audit.completedAt ?? audit.createdAt).toLocaleDateString("en-GB")} · overall ${audit.overallScore ?? "n/a"}/100 · ${audit.pages.length} page(s) measured`,
            ...(audit.coreWebVitals?.source === "page_speed_insights"
              ? [`Core Web Vitals measured via PageSpeed Insights (${String(audit.coreWebVitals.strategy ?? "mobile")})`]
              : ["Core Web Vitals were not measured — no PageSpeed API key configured, so no field data is claimed"]),
          ]
        : ["No audit has been run for this business yet."]),
      `${business.reviewCount ?? 0} reviews at ${business.rating ? business.rating.toFixed(1) : "no"} rating (as published by the data provider)`,
      timeline.length ? `${timeline.length} recorded timeline event(s) for this lead` : "No recorded activity yet",
    ],
    aiInterpretation: [
      suggestion.rationale,
      "Recommended tone and framing are generated from the measured signals above. They are a suggestion for a human to edit, not a script to send unread.",
    ],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Global search (§28) used by the command palette
   ══════════════════════════════════════════════════════════════════════════ */

export function paletteSearch(orgId: string, query: string) {
  const results = globalSearch(orgId, query, 4);
  const suggestions = nextBestActions(orgId).slice(0, 3);
  return { results, suggestions };
}

export interface AssistantOverview {
  headline: string;
  summary: string;
  sections: { title: string; items: { label: string; value: string; href: string | null }[] }[];
  capabilities: { label: string; example: string }[];
}

export function assistantOverview(orgId: string): AssistantOverview {
  const summary = analyticsSummary(orgId, rangeFor(30));
  const actions = nextBestActions(orgId);
  const conversations = listConversations(orgId, { status: ["human_takeover"], limit: 20 }).items;
  const stages = listStages(orgId);

  return {
    headline: "AI command centre",
    summary: `${summary.leads.total} leads scored · ${summary.websites.audited} websites audited · ${conversations.length} conversation(s) need a human · ${actions.length} recommended action(s) available.`,
    sections: [
      {
        title: "Right now",
        items: actions.slice(0, 6).map((action) => ({ label: action.label, value: `${action.count} · ${action.detail}`, href: action.href })),
      },
      {
        title: "Pipeline",
        items: stages.slice(0, 10).map((stage) => ({
          label: stage.name,
          value: `${stage.probability}% win probability${stage.slaHours ? ` · ${Math.round(stage.slaHours / 24)}-day response target` : ""}`,
          href: `/pipeline?stage=${stage.key}`,
        })),
      },
      {
        title: "Needs a human",
        items: conversations.slice(0, 5).map((conversation) => ({
          label: conversation.businessName ?? "Conversation",
          value: `${conversation.intent.replace(/_/g, " ")} · ${conversation.intentScore}/100 intent`,
          href: `/conversations/${conversation.id}`,
        })),
      },
    ],
    capabilities: [
      { label: "Find leads", example: "Find 20 plumbers in Leeds with websites scoring below 60" },
      { label: "Draft proposals", example: "Generate proposals for hot leads that have never been contacted" },
      { label: "Answer questions", example: "How many proposals were opened this month?" },
      { label: "Explain figures", example: "Why is Ashworth Construction a hot lead?" },
      { label: "Move the pipeline", example: "Show me leads that have stalled in Negotiation for more than a week" },
    ],
  };
}

export function leadActivityFeed(orgId: string, leadId: string) {
  const activities = listActivities(orgId, { leadId, limit: 40 });
  const timeline = leadTimeline(orgId, leadId, 40);
  return { activities, timeline };
}

export function conversationMessages(orgId: string, conversationId: string) {
  return listMessages(conversationId, 200);
}

export { auditScoresFrom };
