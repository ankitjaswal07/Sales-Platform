import "server-only";

import { getBusiness, listContacts, latestAuditForBusiness } from "../db/repo/business";
import { getLead } from "../db/repo/lead";
import { getProposal } from "../db/repo/engagement";
import { suggestedAction } from "./conversation";
import type { LeadSnapshot } from "./notifications";
import type { IntentDetection } from "../ai/types";
import { one } from "../db";

/**
 * Builds the flattened lead snapshot that alert rules are evaluated against
 * (§54). Rule conditions reference these field names directly, so this shape is
 * the contract between the rules UI and the engine.
 */

export const ALERT_FIELDS: { field: string; label: string; type: "number" | "string" | "boolean"; description: string }[] = [
  { field: "leadScore", label: "Lead score", type: "number", description: "Overall 0–100 lead score." },
  { field: "websiteScore", label: "Website score", type: "number", description: "Overall website audit score (0–100)." },
  { field: "opportunityScore", label: "Website opportunity score", type: "number", description: "How much upside a new website represents." },
  { field: "intentScore", label: "Intent score", type: "number", description: "Detected buying intent (0–100)." },
  { field: "intent", label: "Intent", type: "string", description: "One of the intent levels, e.g. ready_to_start." },
  { field: "temperature", label: "Temperature", type: "string", description: "hot, warm or cold." },
  { field: "status", label: "Lead status", type: "string", description: "Pipeline stage key." },
  { field: "reviewCount", label: "Review count", type: "number", description: "Public review count." },
  { field: "rating", label: "Rating", type: "number", description: "Public average rating." },
  { field: "estimatedValue", label: "Estimated value", type: "number", description: "Estimated project value in the workspace currency." },
  { field: "proposalViewed", label: "Proposal viewed", type: "boolean", description: "True once the proposal has been opened." },
  { field: "proposalAccepted", label: "Proposal accepted", type: "boolean", description: "True once the proposal has been accepted." },
  { field: "industry", label: "Industry", type: "string", description: "Business industry." },
  { field: "websiteStatus", label: "Website status", type: "string", description: "none, unknown, excellent … broken." },
];

export function buildSnapshotForLead(orgId: string, leadId: string): LeadSnapshot | null {
  const lead = getLead(orgId, leadId);
  if (!lead) return null;
  const business = lead.business ?? getBusiness(orgId, lead.businessId);
  if (!business) return null;

  const contacts = listContacts(orgId, { businessId: business.id, limit: 5 });
  const contact = contacts.find((c) => c.email) ?? contacts[0] ?? null;
  const audit = latestAuditForBusiness(orgId, business.id);
  const proposalRow = one<{ id: string; viewed_at: string | null; accepted_at: string | null; total: number | null }>(
    "SELECT id, viewed_at, accepted_at, total FROM proposals WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1",
    [leadId],
  );
  const proposal = proposalRow ? getProposal(orgId, proposalRow.id) : null;

  const intent: IntentDetection = {
    intent: lead.intent,
    score: lead.intentScore,
    confidence: 0.7,
    signals: [],
    sentiment: "neutral",
    shouldEscalate: false,
    summary: lead.nextAction ?? "Scored from stored signals.",
  };

  return {
    leadId,
    businessId: business.id,
    businessName: business.name,
    contactName: contact?.name ?? null,
    phone: contact?.phone ?? business.phone,
    email: contact?.email ?? business.email,
    websiteUrl: business.websiteUrl,
    leadScore: lead.leadScore ?? 0,
    websiteScore: audit?.overallScore ?? lead.websiteScore,
    opportunityScore: lead.opportunityScore,
    intent: lead.intent,
    intentScore: lead.intentScore,
    temperature: lead.temperature,
    status: lead.status,
    reviewCount: business.reviewCount ?? 0,
    rating: business.rating,
    estimatedValue: lead.estimatedValue,
    currency: lead.currency,
    conversationSummary: proposal ? `Proposal ${proposal.number} is at status "${proposal.status}".` : null,
    recommendedAction: intent.intent === "unknown" ? (lead.nextAction ?? suggestedAction(intent)) : suggestedAction(intent),
    location: [business.city, business.country].filter(Boolean).join(", ") || null,
    industry: business.industry,
    websiteStatus: business.websiteStatus,
    proposalTotal: proposal?.total ?? null,
    proposalAccepted: Boolean(proposal?.acceptedAt),
    proposalViewed: Boolean(proposal?.viewedAt),
    now: new Date().toISOString(),
  };
}

/** The default conditions shipped in `seedDefaultAlertRules`, for the UI editor. */
export const ALERT_OPERATORS = [
  { key: "eq", label: "is" },
  { key: "neq", label: "is not" },
  { key: "gte", label: "is at least" },
  { key: "lte", label: "is at most" },
  { key: "gt", label: "is more than" },
  { key: "lt", label: "is less than" },
  { key: "in", label: "is one of" },
  { key: "not_in", label: "is none of" },
  { key: "contains", label: "contains" },
] as const;
