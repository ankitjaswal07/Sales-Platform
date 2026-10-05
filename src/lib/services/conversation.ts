import "server-only";

import {
  addMessage,
  closeConversation,
  conversationForLead,
  createConversation,
  getConversation,
  getConversationByToken,
  listConversations,
  listMessages,
  markConversationRead,
  resumeAi,
  takeOverConversation,
  updateConversation,
} from "../db/repo/engagement";
import { getBusiness, listContacts, latestAuditForBusiness } from "../db/repo/business";
import { getLead, moveLeadToStage, recordActivity, saveLeadScore, updateLead } from "../db/repo/lead";
import { createTask } from "../db/repo/ops";
import { generateChatReply } from "../ai";
import type { ChatContext } from "../ai/local/conversation";
import type { ChatReply, IntentDetection } from "../ai/types";
import { INTENT_META, type ConversationStatus, type IntentLevel, type LeadStatus } from "../types";
import { computeLeadScore } from "../scoring/lead";
import { auditScoresFrom } from "./proposal";
import { fireAlerts, notify, type LeadSnapshot } from "./notifications";
import { organizationProfile } from "./org-profile";
import { logger } from "../logger";
import type { Business, Conversation, Message } from "../db/repo/types";

/**
 * Prospect conversation handling (§16, §17, §18, §19).
 *
 * Flow for every inbound prospect message:
 *   1. store it
 *   2. detect buying intent deterministically
 *   3. if the AI is active, reply — and say plainly that it is an AI
 *   4. escalate to a human the moment the prospect asks for one, opts out, or
 *      shows high intent, then fire the configured alert rules
 *
 * The AI is never able to impersonate a person: the disclosure sentence is
 * composed here, in code, not left to a prompt or a model's judgement.
 */

export const AI_DISCLOSURE_LINE = "— AI assistant for {{agency}}. A person from the team is always available; just ask.";

export function disclosureFor(agencyName: string): string {
  return AI_DISCLOSURE_LINE.replace("{{agency}}", agencyName);
}

export interface InboundResult {
  conversationId: string;
  conversationToken: string | null;
  replyText: string | null;
  intent: IntentDetection;
  escalated: boolean;
  escalationReason: string | null;
  alertsFired: number;
  aiReplied: boolean;
}

export function getOrCreateConversation(
  orgId: string,
  input: { leadId: string; channel?: "web_chat" | "email" | "whatsapp"; userId?: string | null },
): { conversation: Conversation; created: boolean } {
  const existing = conversationForLead(orgId, input.leadId);
  if (existing) return { conversation: existing, created: false };

  const lead = getLead(orgId, input.leadId);
  if (!lead) throw new Error("Lead not found in this workspace.");

  const conversation = createConversation(orgId, {
    leadId: input.leadId,
    businessId: lead.businessId,
    contactId: lead.contactId,
    channel: input.channel ?? "web_chat",
    assignedUserId: lead.ownerId,
  });

  recordActivity(orgId, {
    leadId: input.leadId,
    businessId: lead.businessId,
    userId: input.userId ?? null,
    type: "conversation_started",
    subject: "Conversation started",
    body: `Channel: ${(input.channel ?? "web_chat").replace(/_/g, " ")}. The AI assistant handles the first reply and identifies itself as AI.`,
    isSystem: true,
  });

  return { conversation, created: true };
}

function chatContext(orgId: string, conversation: Conversation, leadId: string): ChatContext {
  const lead = getLead(orgId, leadId);
  const business = lead?.business ?? (lead ? getBusiness(orgId, lead.businessId) : null);
  const profile = organizationProfile(orgId);
  const audit = business ? latestAuditForBusiness(orgId, business.id) : null;
  const contacts = business ? listContacts(orgId, { businessId: business.id, limit: 5 }) : [];
  const history = listMessages(conversation.id, 40).map((message) => ({ role: message.role, body: message.body, created_at: message.createdAt }));

  return {
    businessName: business?.name ?? "your business",
    contactName: contacts[0]?.name ?? null,
    industry: business?.industry ?? null,
    city: business?.city ?? null,
    websiteUrl: business?.websiteUrl ?? null,
    findings: (audit?.findings ?? []).slice(0, 6).map((finding) => ({
      title: finding.title,
      evidence: finding.evidence,
      detail: finding.detail,
      recommendation: finding.recommendation,
      severity: finding.severity,
    })),
    scores: auditScoresFrom(audit),
    rating: business?.rating ?? null,
    reviewCount: business?.reviewCount ?? null,
    agencyName: profile.name,
    agencyPhone: profile.phone,
    agentName: null,
    history,
    proposalLink: null,
    auditLink: null,
    budgetGuidance: null,
    timeline: null,
  };
}

/** Resolve either an internal id or a public widget token. */
export function resolveConversation(orgId: string | null, idOrToken: string): Conversation | null {
  const byToken = getConversationByToken(idOrToken);
  if (byToken) return byToken;
  return orgId ? getConversation(orgId, idOrToken) : null;
}

export async function handleInboundMessage(
  orgId: string,
  input: { conversationId: string; body: string; authorName?: string | null; source?: string },
): Promise<InboundResult> {
  const conversation = resolveConversation(orgId, input.conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  const conversationId = conversation.id;
  const leadId = conversation.leadId;
  if (!leadId) throw new Error("Conversation is not linked to a lead, so there is nothing to qualify.");

  const intentFromProspect: null = null;
  void intentFromProspect;

  addMessage(orgId, {
    conversationId,
    role: "prospect",
    body: input.body,
    authorLabel: input.authorName ?? conversation.contactName ?? "Prospect",
  });

  const context = chatContext(orgId, conversation, leadId);
  const reply = await generateChatReply(input.body, context, { orgId, entityId: conversationId });
  const intent = reply.intent;

  const shouldEscalate = reply.handoffRecommended || intent.shouldEscalate;

  updateConversation(orgId, conversationId, {
    intent: intent.intent,
    intentScore: intent.score,
    sentiment: intent.sentiment,
    summary: intent.summary,
    unreadForOrg: 1,
    status: shouldEscalate ? "human_takeover" : "ai_active",
    aiEnabled: !shouldEscalate,
    escalatedAt: shouldEscalate ? new Date().toISOString() : null,
  });

  let aiReplied = false;
  if (!shouldEscalate && conversation.aiEnabled) {
    const profile = organizationProfile(orgId);
    const body = `${reply.message}\n\n${disclosureFor(profile.name)}`;
    addMessage(orgId, {
      conversationId,
      role: "ai",
      body,
      authorLabel: `${profile.name} assistant`,
      intent: intent.intent,
      intentScore: intent.score,
      signals: intent.signals,
    });
    aiReplied = true;
  }

  if (shouldEscalate) {
    addMessage(orgId, {
      conversationId,
      role: "system",
      body: `A human needs to take this over: ${reply.handoffReason ?? intent.escalationReason ?? "the prospect needs a person"}. The AI assistant is paused.`,
      authorLabel: "System",
    });
  }

  const lead = getLead(orgId, leadId);
  if (!lead) {
    return { conversationId, conversationToken: conversation.publicToken, replyText: null, intent, escalated: shouldEscalate, escalationReason: null, alertsFired: 0, aiReplied };
  }

  recordActivity(orgId, {
    leadId,
    businessId: lead.businessId,
    userId: null,
    type: "intent_detected",
    subject: `Intent: ${intent.intent.replace(/_/g, " ")} (${intent.score}/100)`,
    body: `${intent.summary}\n\nProspect wrote: "${input.body.slice(0, 240)}"`,
    metadata: {
      signals: intent.signals,
      sentiment: intent.sentiment,
      escalated: shouldEscalate,
      aiReplied,
      suggestedLeadStatus: intent.suggestedLeadStatus ?? null,
    },
    isSystem: true,
  });

  if (intent.suggestedLeadStatus) {
    const status = intent.suggestedLeadStatus as LeadStatus;
    moveLeadToStage(orgId, leadId, status, { actorId: null, note: `Detected intent: ${intent.intent.replace(/_/g, " ")}` });
  }

  /* ── re-score with the new intent signal ── */
  const business = getBusiness(orgId, lead.businessId);
  let snapshotForAlerts: LeadSnapshot | null = null;

  if (business) {
    const audit = latestAuditForBusiness(orgId, business.id);
    const contacts = listContacts(orgId, { businessId: business.id, limit: 5 });
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
        hasNamedContact: contacts.some((c) => Boolean(c.name)),
        hasEmail: contacts.some((c) => Boolean(c.email)) || Boolean(business.email),
        hasPhone: contacts.some((c) => Boolean(c.phone)) || Boolean(business.phone),
      },
      { intent: intent.intent as IntentLevel },
    );
    saveLeadScore(orgId, leadId, score);
    updateLead(orgId, leadId, {
      temperature: score.temperature,
      opportunityScore: score.websiteOpportunity,
      intent: intent.intent as IntentLevel,
      intentScore: intent.score,
      nextAction: suggestedAction(intent),
    });

    snapshotForAlerts = buildSnapshot(orgId, leadId, business, intent, conversationId, score.total);
  }

  let alertsFired = 0;
  if (snapshotForAlerts && (intent.score >= 60 || shouldEscalate || intent.intent === "ready_to_start")) {
    const result = await fireAlerts(orgId, snapshotForAlerts);
    alertsFired = result.alerts;
  }

  if (shouldEscalate && !aiReplied) {
    createTask(orgId, {
      title: `Take over the conversation with ${business?.name ?? "a prospect"}`,
      description: reply.handoffReason ?? intent.summary,
      type: "reply",
      priority: intent.score >= 70 ? "urgent" : "high",
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      leadId,
      businessId: lead.businessId,
      assignedUserId: lead.ownerId,
    });
  }

  logger.info("conversation", "Inbound message processed", {
    conversationId,
    intent: intent.intent,
    score: intent.score,
    escalated: shouldEscalate,
    alertsFired,
  });

  return {
    conversationId,
    conversationToken: conversation.publicToken,
    replyText: aiReplied ? `${reply.message}\n\n${disclosureFor(organizationProfile(orgId).name)}` : null,
    intent,
    escalated: shouldEscalate,
    escalationReason: reply.handoffReason ?? intent.escalationReason ?? null,
    alertsFired,
    aiReplied,
  };
}

export function suggestedAction(intent: IntentDetection): string {
  const map: Record<string, string> = {
    ready_to_start: "Send the agreement and book the kick-off call",
    wants_call: "Call them — they asked for a conversation",
    wants_pricing: "Send a fixed-price proposal for approval",
    wants_meeting: "Book the meeting",
    high_intent: "Move to a proposal today",
    interested: "Follow up within 24 hours while it is warm",
    information_seeking: "Send the audit summary",
    curious: "Keep the conversation warm",
    not_interested: "Close the loop politely and set a reminder for 90 days",
    unknown: "Ask what matters most to them",
  };
  return map[intent.intent] ?? "Review the conversation and reply";
}

function buildSnapshot(
  orgId: string,
  leadId: string,
  business: Business,
  intent: IntentDetection,
  conversationId: string,
  leadScore: number,
): LeadSnapshot | null {
  const lead = getLead(orgId, leadId);
  if (!lead) return null;
  const contacts = listContacts(orgId, { businessId: business.id, limit: 5 });
  const contact = contacts[0] ?? null;

  return {
    leadId,
    businessId: business.id,
    businessName: business.name,
    contactName: contact?.name ?? null,
    phone: contact?.phone ?? business.phone,
    email: contact?.email ?? business.email,
    websiteUrl: business.websiteUrl,
    leadScore,
    websiteScore: lead.websiteScore,
    opportunityScore: lead.opportunityScore,
    intent: intent.intent,
    intentScore: intent.score,
    temperature: lead.temperature,
    status: lead.status,
    reviewCount: business.reviewCount ?? 0,
    rating: business.rating,
    estimatedValue: lead.estimatedValue,
    currency: lead.currency,
    conversationSummary: intent.summary,
    recommendedAction: suggestedAction(intent),
    location: [business.city, business.country].filter(Boolean).join(", ") || null,
    industry: business.industry,
    websiteStatus: business.websiteStatus,
    proposalTotal: null,
    proposalAccepted: false,
    proposalViewed: false,
    now: new Date().toISOString(),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Human takeover (§20) and agent replies
   ══════════════════════════════════════════════════════════════════════════ */

export function takeOver(orgId: string, conversationId: string, userId: string): Conversation | null {
  const conversation = takeOverConversation(orgId, conversationId, userId);
  if (!conversation) return null;

  addMessage(orgId, {
    conversationId,
    role: "system",
    body: "A member of the team has joined the conversation. The AI assistant is paused and will not reply again until it is resumed.",
    authorLabel: "System",
  });

  if (conversation.leadId) {
    recordActivity(orgId, {
      leadId: conversation.leadId,
      businessId: conversation.businessId,
      userId,
      type: "human_takeover",
      subject: "Human took over the conversation",
      body: "The AI assistant was paused for this conversation. It can be resumed at any time.",
      metadata: { conversationId },
    });
  }
  return conversation;
}

export function handBackToAi(orgId: string, conversationId: string): Conversation | null {
  const conversation = resumeAi(orgId, conversationId);
  if (conversation) {
    addMessage(orgId, {
      conversationId,
      role: "system",
      body: "The AI assistant has resumed. It identifies itself as an AI and will escalate again if the prospect needs a person.",
      authorLabel: "System",
    });
  }
  return conversation;
}

export function agentReply(
  orgId: string,
  input: { conversationId: string; userId: string; body: string; internalNote?: string | null },
): Message | null {
  const conversation = getConversation(orgId, input.conversationId);
  if (!conversation) return null;

  const message = addMessage(orgId, {
    conversationId: input.conversationId,
    role: "agent",
    body: input.body,
    authorUserId: input.userId,
    authorLabel: conversation.assignedName ?? "Team",
  });

  updateConversation(orgId, input.conversationId, {
    unreadForOrg: 0,
    lastMessageAt: new Date().toISOString(),
    status: conversation.status === "closed" ? "human_takeover" : conversation.status,
    aiEnabled: false,
  });

  if (conversation.leadId) {
    recordActivity(orgId, {
      leadId: conversation.leadId,
      businessId: conversation.businessId,
      userId: input.userId,
      type: "message_sent",
      subject: "Reply sent to the prospect",
      body: input.internalNote ? `${input.body.slice(0, 300)}\n\nInternal note: ${input.internalNote}` : input.body.slice(0, 400),
      metadata: { conversationId: input.conversationId },
    });
    updateLead(orgId, conversation.leadId, { lastContactedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() });
  }

  return message;
}

export function close(orgId: string, conversationId: string, summary?: string): Conversation | null {
  const conversation = closeConversation(orgId, conversationId, summary);
  if (conversation?.leadId) {
    recordActivity(orgId, {
      leadId: conversation.leadId,
      businessId: conversation.businessId,
      userId: null,
      type: "conversation_closed",
      subject: "Conversation closed",
      body: summary ?? null,
      isSystem: true,
    });
  }
  return conversation;
}

export function markRead(orgId: string, conversationId: string): void {
  markConversationRead(orgId, conversationId);
}

export function escalateManually(orgId: string, conversationId: string, userId: string, reason: string): Conversation | null {
  const conversation = takeOver(orgId, conversationId, userId);
  if (conversation?.leadId) {
    createTask(orgId, {
      title: `Handle the escalated conversation with ${conversation.businessName ?? "a prospect"}`,
      description: reason,
      type: "reply",
      priority: "urgent",
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      leadId: conversation.leadId,
      businessId: conversation.businessId,
      assignedUserId: userId,
    });
    notify(orgId, {
      type: "chat_escalation",
      title: "Conversation escalated to a human",
      body: reason,
      entityType: "conversation",
      entityId: conversationId,
      actionUrl: `/conversations/${conversationId}`,
      severity: "critical",
    });
  }
  return conversation;
}

/* ══════════════════════════════════════════════════════════════════════════
   Views used by the Conversations screen
   ══════════════════════════════════════════════════════════════════════════ */

export function intentJourney(): { level: IntentLevel; label: string; score: number; description: string }[] {
  const guidance: Record<IntentLevel, string> = {
    not_interested: "Close the loop politely and stop outreach. Set a reminder for a later date if it was a timing objection.",
    curious: "They are early. Give something useful — the audit summary — and ask one easy question.",
    information_seeking: "They want detail. Send the findings and the recommended approach, no hard ask yet.",
    interested: "Real interest. Move to a proposal or a call within 24 hours.",
    high_intent: "Actively evaluating. A proposal with a fixed price, today.",
    wants_pricing: "Answer with a range from the pricing engine, then offer the fixed proposal.",
    wants_demo: "Show them the recommended concept and the before/after direction — examples beat descriptions.",
    wants_call: "Call them. They asked for a conversation.",
    ready_to_start: "Send the agreement and start the delivery checklist immediately.",
    unknown: "Ask what matters most to them and record the answer.",
  };
  return (Object.keys(INTENT_META) as IntentLevel[])
    .map((level) => ({ level, label: INTENT_META[level].label, score: INTENT_META[level].score, description: guidance[level] }))
    .sort((a, b) => a.score - b.score);
}

export function statusLabel(status: ConversationStatus): string {
  const map: Record<ConversationStatus, string> = {
    ai_active: "AI handling",
    human_takeover: "Human handling",
    awaiting_contact: "Waiting for the prospect",
    closed: "Closed",
  };
  return map[status];
}

export function inbox(orgId: string, filter: { status?: ConversationStatus[]; search?: string; minIntent?: number } = {}) {
  const { items, total } = listConversations(orgId, { ...filter, limit: 100 });
  return {
    items: items.map((conversation) => ({
      ...conversation,
      statusText: statusLabel(conversation.status),
      needsReply: conversation.status === "human_takeover" || (conversation.unreadForOrg > 0 && conversation.aiEnabled === false),
      hot: conversation.intentScore >= 70,
      lastMessage: listMessages(conversation.id, 50).at(-1) ?? null,
    })),
    total,
  };
}

export function conversationSummaryFor(orgId: string, conversationId: string) {
  const conversation = getConversation(orgId, conversationId);
  if (!conversation) return null;
  const messages = listMessages(conversationId, 200);
  return {
    conversation,
    messages,
    aiMessages: messages.filter((m) => m.role === "ai").length,
    prospectMessages: messages.filter((m) => m.role === "prospect").length,
    agentMessages: messages.filter((m) => m.role === "agent").length,
    disclosurePresent: messages.some((m) => m.role === "ai" && /AI assistant for/i.test(m.body)),
  };
}
