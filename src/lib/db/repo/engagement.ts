import "server-only";

import { all, insert, one, parseJson, run, toBool, update } from "..";
import { newId, newPublicToken } from "../../ids";
import type {
  ConversationStatus,
  EmailStyle,
  IntentLevel,
  LeadStatus,
  ProposalLineItem,
  ProposalSection,
  ProposalStatus,
  CampaignStatus,
} from "../../types";
import type {
  Campaign,
  CampaignStats,
  ConceptRecord,
  Conversation,
  EmailRecord,
  Message,
  Proposal,
  ProposalViewRecord,
} from "./types";
import type { ConceptPreset, GeneratedConcept } from "../../ai/types";

/* ══════════════════════════════════════════════════════════════════════════
   Conversations & messages
   ══════════════════════════════════════════════════════════════════════════ */

interface ConversationRow {
  id: string; org_id: string; lead_id: string | null; business_id: string; contact_id: string | null;
  channel: string; status: string; ai_enabled: number; assigned_user_id: string | null; intent: string;
  intent_score: number; sentiment: string; summary: string | null; transcript_url: string | null;
  public_token: string | null; unread_for_org: number; message_count: number; escalated_at: string | null;
  last_message_at: string | null; last_ai_at: string | null; created_at: string; updated_at: string;
  business_name?: string | null; contact_name?: string | null; assigned_name?: string | null;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    orgId: row.org_id,
    leadId: row.lead_id,
    businessId: row.business_id,
    contactId: row.contact_id,
    channel: row.channel,
    status: row.status as ConversationStatus,
    aiEnabled: toBool(row.ai_enabled),
    assignedUserId: row.assigned_user_id,
    intent: row.intent as IntentLevel,
    intentScore: row.intent_score,
    sentiment: row.sentiment,
    summary: row.summary,
    publicToken: row.public_token,
    unreadForOrg: row.unread_for_org,
    messageCount: row.message_count,
    escalatedAt: row.escalated_at,
    lastMessageAt: row.last_message_at,
    lastAiAt: row.last_ai_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    businessName: row.business_name ?? undefined,
    contactName: row.contact_name ?? null,
    assignedName: row.assigned_name ?? null,
  };
}

const CONVERSATION_SELECT = `
  SELECT c.*, b.name AS business_name, ct.name AS contact_name, u.name AS assigned_name
  FROM conversations c
  JOIN businesses b ON b.id = c.business_id
  LEFT JOIN contacts ct ON ct.id = c.contact_id
  LEFT JOIN users u ON u.id = c.assigned_user_id
`;

export function listConversations(orgId: string, filter: { status?: ConversationStatus[]; search?: string; minIntent?: number; limit?: number; offset?: number } = {}): { items: Conversation[]; total: number } {
  const clauses = ["c.org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.status?.length) {
    clauses.push(`c.status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  if (filter.search) {
    clauses.push("(b.name LIKE ? OR ct.name LIKE ? OR c.summary LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }
  if (filter.minIntent !== undefined) {
    clauses.push("c.intent_score >= ?");
    params.push(filter.minIntent);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<ConversationRow>(
    `${CONVERSATION_SELECT} ${where} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 300), filter.offset ?? 0],
  ).map(mapConversation);
  const total = one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM conversations c JOIN businesses b ON b.id=c.business_id LEFT JOIN contacts ct ON ct.id=c.contact_id ${where}`,
    params,
  )?.total ?? 0;
  return { items, total };
}

export function getConversation(orgId: string, conversationId: string): Conversation | null {
  const row = one<ConversationRow>(`${CONVERSATION_SELECT} WHERE c.id = ? AND c.org_id = ?`, [conversationId, orgId]);
  return row ? mapConversation(row) : null;
}

export function getConversationByToken(token: string): Conversation | null {
  const row = one<ConversationRow>(`${CONVERSATION_SELECT} WHERE c.public_token = ?`, [token]);
  return row ? mapConversation(row) : null;
}

export function conversationForLead(orgId: string, leadId: string): Conversation | null {
  const row = one<ConversationRow>(`${CONVERSATION_SELECT} WHERE c.lead_id = ? AND c.org_id = ? ORDER BY c.created_at DESC LIMIT 1`, [leadId, orgId]);
  return row ? mapConversation(row) : null;
}

export function createConversation(orgId: string, input: {
  businessId: string;
  leadId?: string | null;
  contactId?: string | null;
  channel?: string;
  assignedUserId?: string | null;
}): Conversation {
  const id = newId("cnv");
  const timestamp = new Date().toISOString();
  insert("conversations", {
    id,
    org_id: orgId,
    lead_id: input.leadId ?? null,
    business_id: input.businessId,
    contact_id: input.contactId ?? null,
    channel: input.channel ?? "web_chat",
    status: "ai_active",
    ai_enabled: 1,
    assigned_user_id: input.assignedUserId ?? null,
    intent: "unknown",
    intent_score: 0,
    sentiment: "neutral",
    public_token: newPublicToken(),
    unread_for_org: 0,
    message_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
    last_message_at: timestamp,
  });
  return getConversation(orgId, id)!;
}

export function updateConversation(orgId: string, conversationId: string, patch: Partial<Conversation>): Conversation | null {
  const columnMap: Record<string, string> = {
    status: "status", aiEnabled: "ai_enabled", assignedUserId: "assigned_user_id", intent: "intent",
    intentScore: "intent_score", sentiment: "sentiment", summary: "summary", unreadForOrg: "unread_for_org",
    escalatedAt: "escalated_at", lastMessageAt: "last_message_at", lastAiAt: "last_ai_at",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (!Object.keys(values).length) return getConversation(orgId, conversationId);
  values.updated_at = new Date().toISOString();
  update("conversations", conversationId, values);
  return getConversation(orgId, conversationId);
}

export function takeOverConversation(orgId: string, conversationId: string, userId: string): Conversation | null {
  return updateConversation(orgId, conversationId, {
    status: "human_takeover",
    aiEnabled: false,
    assignedUserId: userId,
    escalatedAt: new Date().toISOString(),
  });
}

export function resumeAi(orgId: string, conversationId: string): Conversation | null {
  return updateConversation(orgId, conversationId, { status: "ai_active", aiEnabled: true, escalatedAt: null });
}

export function closeConversation(orgId: string, conversationId: string, summary?: string): Conversation | null {
  return updateConversation(orgId, conversationId, { status: "closed", aiEnabled: false, summary: summary ?? undefined });
}

interface MessageRow {
  id: string; org_id: string; conversation_id: string; role: string; author_user_id: string | null;
  author_label: string | null; body: string; intent: string | null; intent_score: number | null;
  signals_json: string; created_at: string;
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    orgId: row.org_id,
    conversationId: row.conversation_id,
    role: row.role as Message["role"],
    authorUserId: row.author_user_id,
    authorLabel: row.author_label,
    body: row.body,
    intent: (row.intent as IntentLevel) ?? null,
    intentScore: row.intent_score,
    signals: parseJson<{ phrase: string; meaning: string; weight: number }[]>(row.signals_json, []),
    createdAt: row.created_at,
  };
}

export function listMessages(conversationId: string, limit = 200): Message[] {
  return all<MessageRow>(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?",
    [conversationId, Math.min(limit, 500)],
  ).map(mapMessage);
}

export function addMessage(orgId: string, input: {
  conversationId: string;
  role: Message["role"];
  body: string;
  authorUserId?: string | null;
  authorLabel?: string | null;
  intent?: IntentLevel | null;
  intentScore?: number | null;
  signals?: { phrase: string; meaning: string; weight: number }[];
}): Message {
  const id = newId("msg");
  const timestamp = new Date().toISOString();
  insert("messages", {
    id,
    org_id: orgId,
    conversation_id: input.conversationId,
    role: input.role,
    author_user_id: input.authorUserId ?? null,
    author_label: input.authorLabel ?? null,
    body: input.body,
    intent: input.intent ?? null,
    intent_score: input.intentScore ?? null,
    signals_json: input.signals ?? [],
    created_at: timestamp,
  });
  run(
    `UPDATE conversations SET message_count = message_count + 1,
       last_message_at = ?, updated_at = ?, unread_for_org = unread_for_org + CASE WHEN ? = 'prospect' THEN 1 ELSE 0 END,
       last_ai_at = CASE WHEN ? = 'ai' THEN ? ELSE last_ai_at END
     WHERE id = ?`,
    [timestamp, timestamp, input.role, input.role, timestamp, input.conversationId],
  );
  return mapMessage(one<MessageRow>("SELECT * FROM messages WHERE id = ?", [id])!);
}

export function markConversationRead(orgId: string, conversationId: string): void {
  run("UPDATE conversations SET unread_for_org = 0 WHERE id = ? AND org_id = ?", [conversationId, orgId]);
}

/* ══════════════════════════════════════════════════════════════════════════
   Proposals
   ══════════════════════════════════════════════════════════════════════════ */

interface ProposalRow {
  id: string; org_id: string; lead_id: string | null; business_id: string; contact_id: string | null;
  audit_id: string | null; concept_id: string | null; number: string; title: string; status: string;
  template: string; currency: string; subtotal: number; discount: number; tax: number; total: number;
  monthly_retainer: number | null; timeline_weeks: number | null; sections_json: string;
  line_items_json: string; design_json: string; concept_json: string; pricing_source: string;
  ai_generated: number; approved_by: string | null; approved_at: string | null; public_token: string | null;
  version: number; valid_until: string | null; sent_at: string | null; viewed_at: string | null;
  view_count: number; time_spent_seconds: number; accepted_at: string | null; declined_at: string | null;
  decline_reason: string | null; notes: string | null; created_at: string; updated_at: string;
  business_name?: string | null; contact_name?: string | null; lead_status?: string | null;
}

function mapProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    orgId: row.org_id,
    leadId: row.lead_id,
    businessId: row.business_id,
    contactId: row.contact_id,
    auditId: row.audit_id,
    conceptId: row.concept_id,
    number: row.number,
    title: row.title,
    status: row.status as ProposalStatus,
    template: row.template,
    currency: row.currency,
    subtotal: row.subtotal,
    discount: row.discount,
    tax: row.tax,
    total: row.total,
    monthlyRetainer: row.monthly_retainer ?? 0,
    timelineWeeks: row.timeline_weeks,
    sections: parseJson<ProposalSection[]>(row.sections_json, []),
    lineItems: parseJson<ProposalLineItem[]>(row.line_items_json, []),
    design: parseJson<Record<string, unknown>>(row.design_json, {}),
    concept: parseJson<Record<string, unknown>>(row.concept_json, {}),
    pricingSource: row.pricing_source,
    aiGenerated: toBool(row.ai_generated),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    publicToken: row.public_token,
    version: row.version,
    validUntil: row.valid_until,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    viewCount: row.view_count,
    timeSpentSeconds: row.time_spent_seconds,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    declineReason: row.decline_reason,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    businessName: row.business_name ?? undefined,
    contactName: row.contact_name ?? null,
    leadStatus: (row.lead_status as LeadStatus) ?? null,
  };
}

const PROPOSAL_SELECT = `
  SELECT p.*, b.name AS business_name, ct.name AS contact_name, l.status AS lead_status
  FROM proposals p
  JOIN businesses b ON b.id = p.business_id
  LEFT JOIN contacts ct ON ct.id = p.contact_id
  LEFT JOIN leads l ON l.id = p.lead_id
`;

export function listProposals(orgId: string, filter: { status?: ProposalStatus[]; leadId?: string; search?: string; limit?: number; offset?: number; opened?: boolean } = {}): { items: Proposal[]; total: number } {
  const clauses = ["p.org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.status?.length) {
    clauses.push(`p.status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  if (filter.leadId) { clauses.push("p.lead_id = ?"); params.push(filter.leadId); }
  if (filter.search) {
    clauses.push("(b.name LIKE ? OR p.title LIKE ? OR p.number LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }
  if (filter.opened) clauses.push("p.view_count > 0");
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<ProposalRow>(
    `${PROPOSAL_SELECT} ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 300), filter.offset ?? 0],
  ).map(mapProposal);
  const total = one<{ total: number }>(
    `SELECT COUNT(*) AS total FROM proposals p JOIN businesses b ON b.id=p.business_id ${where}`,
    params,
  )?.total ?? 0;
  return { items, total };
}

export function getProposal(orgId: string, proposalId: string): Proposal | null {
  const row = one<ProposalRow>(`${PROPOSAL_SELECT} WHERE p.id = ? AND p.org_id = ?`, [proposalId, orgId]);
  return row ? mapProposal(row) : null;
}

export function getProposalByToken(token: string): Proposal | null {
  const row = one<ProposalRow>(`${PROPOSAL_SELECT} WHERE p.public_token = ?`, [token]);
  return row ? mapProposal(row) : null;
}

export function nextProposalNumber(orgId: string): string {
  const year = new Date().getFullYear();
  const count = one<{ c: number }>("SELECT COUNT(*) AS c FROM proposals WHERE org_id = ? AND number LIKE ?", [orgId, `PR-${year}-%`])?.c ?? 0;
  return `PR-${year}-${String(count + 1).padStart(3, "0")}`;
}

export function createProposal(orgId: string, input: {
  businessId: string;
  leadId?: string | null;
  contactId?: string | null;
  auditId?: string | null;
  conceptId?: string | null;
  title: string;
  template?: string;
  currency?: string;
  sections: ProposalSection[];
  lineItems: ProposalLineItem[];
  design?: Record<string, unknown>;
  concept?: Record<string, unknown>;
  total: number;
  monthlyRetainer?: number;
  timelineWeeks?: number | null;
  validUntil?: string | null;
  status?: ProposalStatus;
  notes?: string | null;
  pricingSource?: string;
}): Proposal {
  const id = newId("prp");
  const timestamp = new Date().toISOString();
  insert("proposals", {
    id,
    org_id: orgId,
    lead_id: input.leadId ?? null,
    business_id: input.businessId,
    contact_id: input.contactId ?? null,
    audit_id: input.auditId ?? null,
    concept_id: input.conceptId ?? null,
    number: nextProposalNumber(orgId),
    title: input.title,
    status: input.status ?? "draft",
    template: input.template ?? "signature",
    currency: input.currency ?? "GBP",
    subtotal: input.total,
    discount: 0,
    tax: 0,
    total: input.total,
    monthly_retainer: input.monthlyRetainer ?? 0,
    timeline_weeks: input.timelineWeeks ?? null,
    sections_json: input.sections,
    line_items_json: input.lineItems,
    design_json: input.design ?? {},
    concept_json: input.concept ?? {},
    pricing_source: input.pricingSource ?? "ai_recommended",
    ai_generated: 1,
    public_token: newPublicToken(),
    version: 1,
    valid_until: input.validUntil ?? null,
    notes: input.notes ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getProposal(orgId, id)!;
}

export function updateProposal(orgId: string, proposalId: string, patch: Partial<Proposal>): Proposal | null {
  const columnMap: Record<string, string> = {
    title: "title", status: "status", template: "template", currency: "currency", subtotal: "subtotal",
    discount: "discount", tax: "tax", total: "total", monthlyRetainer: "monthly_retainer",
    timelineWeeks: "timeline_weeks", sections: "sections_json", lineItems: "line_items_json",
    design: "design_json", concept: "concept_json", pricingSource: "pricing_source",
    approvedBy: "approved_by", approvedAt: "approved_at", validUntil: "valid_until",
    sentAt: "sent_at", viewedAt: "viewed_at", viewCount: "view_count",
    timeSpentSeconds: "time_spent_seconds", acceptedAt: "accepted_at", declinedAt: "declined_at",
    declineReason: "decline_reason", notes: "notes", version: "version",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (!Object.keys(values).length) return getProposal(orgId, proposalId);
  values.updated_at = new Date().toISOString();
  update("proposals", proposalId, values);
  return getProposal(orgId, proposalId);
}

export function approveProposal(orgId: string, proposalId: string, userId: string): Proposal | null {
  return updateProposal(orgId, proposalId, { status: "approved", approvedBy: userId, approvedAt: new Date().toISOString() });
}

export function markProposalSent(orgId: string, proposalId: string, channel: string): Proposal | null {
  void channel;
  return updateProposal(orgId, proposalId, { status: "sent", sentAt: new Date().toISOString() });
}

export function recordProposalView(orgId: string, proposalId: string, input: {
  sessionKey: string;
  ipHash?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
}): ProposalViewRecord {
  const existing = one<{ id: string }>(
    "SELECT id FROM proposal_views WHERE proposal_id = ? AND session_key = ?",
    [proposalId, input.sessionKey],
  );
  const timestamp = new Date().toISOString();

  if (existing) {
    run("UPDATE proposal_views SET last_seen_at = ? WHERE id = ?", [timestamp, existing.id]);
  } else {
    insert("proposal_views", {
      id: newId("pvw"),
      org_id: orgId,
      proposal_id: proposalId,
      session_key: input.sessionKey,
      viewer_ip_hash: input.ipHash ?? null,
      user_agent: input.userAgent ?? null,
      referrer: input.referrer ?? null,
      duration_seconds: 0,
      max_scroll: 0,
      sections_viewed_json: [],
      cta_clicks_json: [],
      opened_at: timestamp,
      last_seen_at: timestamp,
    });
  }

  const proposal = getProposal(orgId, proposalId);
  if (proposal) {
    update("proposals", proposalId, {
      view_count: proposal.viewCount + (existing ? 0 : 1),
      viewed_at: proposal.viewedAt ?? timestamp,
      status: proposal.status === "sent" || proposal.status === "approved" ? "viewed" : proposal.status,
      updated_at: timestamp,
    });
  }

  const row = one<{
    id: string; proposal_id: string; session_key: string; duration_seconds: number; max_scroll: number;
    sections_viewed_json: string; cta_clicks_json: string; opened_at: string; last_seen_at: string;
  }>("SELECT * FROM proposal_views WHERE proposal_id = ? AND session_key = ?", [proposalId, input.sessionKey])!;

  return {
    id: row.id,
    proposalId: row.proposal_id,
    sessionKey: row.session_key,
    durationSeconds: row.duration_seconds,
    maxScroll: row.max_scroll,
    sectionsViewed: parseJson<string[]>(row.sections_viewed_json, []),
    ctaClicks: parseJson<string[]>(row.cta_clicks_json, []),
    openedAt: row.opened_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function recordProposalEngagement(proposalId: string, sessionKey: string, input: {
  durationSeconds?: number;
  maxScroll?: number;
  section?: string;
  cta?: string;
}): void {
  const row = one<{
    id: string; duration_seconds: number; max_scroll: number; sections_viewed_json: string; cta_clicks_json: string;
  }>("SELECT * FROM proposal_views WHERE proposal_id = ? AND session_key = ?", [proposalId, sessionKey]);
  if (!row) return;

  const sections = new Set(parseJson<string[]>(row.sections_viewed_json, []));
  if (input.section) sections.add(input.section);
  const clicks = new Set(parseJson<string[]>(row.cta_clicks_json, []));
  if (input.cta) clicks.add(input.cta);

  run(
    `UPDATE proposal_views SET duration_seconds = MAX(duration_seconds, ?), max_scroll = MAX(max_scroll, ?),
      sections_viewed_json = ?, cta_clicks_json = ?, last_seen_at = ? WHERE id = ?`,
    [
      input.durationSeconds ?? row.duration_seconds,
      input.maxScroll ?? row.max_scroll,
      JSON.stringify([...sections]),
      JSON.stringify([...clicks]),
      new Date().toISOString(),
      row.id,
    ],
  );
  if (input.durationSeconds) {
    run("UPDATE proposals SET time_spent_seconds = (SELECT COALESCE(SUM(duration_seconds),0) FROM proposal_views WHERE proposal_id = ?) WHERE id = ?", [proposalId, proposalId]);
  }
}

export function listProposalViews(proposalId: string): ProposalViewRecord[] {
  return all<{
    id: string; proposal_id: string; session_key: string; duration_seconds: number; max_scroll: number;
    sections_viewed_json: string; cta_clicks_json: string; opened_at: string; last_seen_at: string;
  }>("SELECT * FROM proposal_views WHERE proposal_id = ? ORDER BY opened_at DESC", [proposalId]).map((row) => ({
    id: row.id,
    proposalId: row.proposal_id,
    sessionKey: row.session_key,
    durationSeconds: row.duration_seconds,
    maxScroll: row.max_scroll,
    sectionsViewed: parseJson<string[]>(row.sections_viewed_json, []),
    ctaClicks: parseJson<string[]>(row.cta_clicks_json, []),
    openedAt: row.opened_at,
    lastSeenAt: row.last_seen_at,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   Website concepts
   ══════════════════════════════════════════════════════════════════════════ */

export function saveConcept(orgId: string, input: {
  businessId: string;
  leadId?: string | null;
  createdBy?: string | null;
  preset: ConceptPreset;
  concept: GeneratedConcept;
  parentId?: string | null;
  variant?: string;
}): ConceptRecord {
  const id = newId("cpt");
  const timestamp = new Date().toISOString();
  insert("website_concepts", {
    id,
    org_id: orgId,
    business_id: input.businessId,
    lead_id: input.leadId ?? null,
    created_by: input.createdBy ?? null,
    variant: input.variant ?? "primary",
    preset: input.preset,
    style: input.concept.style,
    palette_json: input.concept.palette,
    typography_json: input.concept.typography,
    structure_json: input.concept.sections,
    content_json: {
      hero: input.concept.hero,
      navigation: input.concept.navigation,
      pages: input.concept.pages,
      features: input.concept.features,
      conversionStrategy: input.concept.conversionStrategy,
      contentStructure: input.concept.contentStructure,
      images: input.concept.images,
      icons: input.concept.icons,
      animations: input.concept.animations,
      accessibilityNotes: input.concept.accessibilityNotes,
    },
    design_notes: input.concept.designNotes,
    conversion_json: { strategy: input.concept.conversionStrategy },
    preview_json: input.concept.preview,
    parent_id: input.parentId ?? null,
    is_selected: 0,
    created_at: timestamp,
  });
  return getConcept(orgId, id)!;
}

export function getConcept(orgId: string, conceptId: string): ConceptRecord | null {
  const row = one<{
    id: string; business_id: string; lead_id: string | null; preset: string; style: string;
    palette_json: string; typography_json: string; structure_json: string; content_json: string;
    design_notes: string | null; preview_json: string; is_selected: number; created_at: string; variant: string;
  }>("SELECT * FROM website_concepts WHERE id = ? AND org_id = ?", [conceptId, orgId]);
  if (!row) return null;
  return hydrateConcept(row);
}

function hydrateConcept(row: {
  id: string; business_id: string; lead_id: string | null; preset: string; style: string;
  palette_json: string; typography_json: string; structure_json: string; content_json: string;
  design_notes: string | null; preview_json: string; is_selected: number; created_at: string;
}): ConceptRecord {
  const content = parseJson<{
    hero: GeneratedConcept["hero"];
    navigation: string[];
    pages: string[];
    features: string[];
    conversionStrategy: string[];
    contentStructure: GeneratedConcept["contentStructure"];
    images: string[];
    icons: string[];
    animations: string[];
    accessibilityNotes: string[];
  }>(row.content_json, {
    hero: { headline: "", subheadline: "", cta: "", secondaryCta: "", notes: "" },
    navigation: [], pages: [], features: [], conversionStrategy: [], contentStructure: [],
    images: [], icons: [], animations: [], accessibilityNotes: [],
  });

  return {
    id: row.id,
    businessId: row.business_id,
    leadId: row.lead_id,
    preset: row.preset as ConceptPreset,
    isSelected: toBool(row.is_selected),
    createdAt: row.created_at,
    style: row.style,
    styleRationale: "",
    mood: [],
    palette: parseJson(row.palette_json, []),
    typography: parseJson(row.typography_json, { heading: "", body: "", rationale: "" }),
    layout: "",
    hero: content.hero,
    navigation: content.navigation,
    sections: parseJson(row.structure_json, []),
    contentStructure: content.contentStructure,
    images: content.images,
    icons: content.icons,
    animations: content.animations,
    conversionStrategy: content.conversionStrategy,
    pages: content.pages,
    features: content.features,
    designNotes: row.design_notes ?? "",
    accessibilityNotes: content.accessibilityNotes,
    generatedBy: "local_engine",
    preview: parseJson(row.preview_json, { wireframe: [], heroPreview: { headline: "", subheadline: "", cta: "", palette: [] } }),
    changeSummary: "",
  };
}

export function listConcepts(orgId: string, filter: { businessId?: string; leadId?: string; limit?: number } = {}): ConceptRecord[] {
  const clauses = ["org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.businessId) { clauses.push("business_id = ?"); params.push(filter.businessId); }
  if (filter.leadId) { clauses.push("lead_id = ?"); params.push(filter.leadId); }
  return all<{
    id: string; business_id: string; lead_id: string | null; preset: string; style: string;
    palette_json: string; typography_json: string; structure_json: string; content_json: string;
    design_notes: string | null; preview_json: string; is_selected: number; created_at: string;
  }>(
    `SELECT * FROM website_concepts WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, Math.min(filter.limit ?? 20, 100)],
  ).map(hydrateConcept);
}

export function selectConcept(orgId: string, businessId: string, conceptId: string): void {
  run("UPDATE website_concepts SET is_selected = 0 WHERE org_id = ? AND business_id = ?", [orgId, businessId]);
  run("UPDATE website_concepts SET is_selected = 1 WHERE id = ? AND org_id = ?", [conceptId, orgId]);
}

/* ══════════════════════════════════════════════════════════════════════════
   Campaigns & emails
   ══════════════════════════════════════════════════════════════════════════ */

interface CampaignRow {
  id: string; org_id: string; name: string; description: string | null; industry: string | null;
  location: string | null; criteria_json: string; sequence_json: string; status: string; daily_cap: number;
  require_approval: number; owner_id: string | null; target_count: number; started_at: string | null;
  completed_at: string | null; paused_reason: string | null; created_at: string; updated_at: string;
}

function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    industry: row.industry,
    location: row.location,
    criteria: parseJson<Record<string, unknown>>(row.criteria_json, {}),
    sequence: parseJson<Campaign["sequence"]>(row.sequence_json, []),
    status: row.status as CampaignStatus,
    dailyCap: row.daily_cap,
    requireApproval: toBool(row.require_approval),
    ownerId: row.owner_id,
    targetCount: row.target_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    pausedReason: row.paused_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCampaigns(orgId: string, filter: { status?: CampaignStatus[]; limit?: number; offset?: number } = {}): { items: Campaign[]; total: number } {
  const clauses = ["org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.status?.length) {
    clauses.push(`status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<CampaignRow>(
    `SELECT * FROM campaigns ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 200), filter.offset ?? 0],
  ).map((row) => {
    const campaign = mapCampaign(row);
    campaign.stats = campaignStats(row.id);
    return campaign;
  });
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM campaigns ${where}`, params)?.total ?? 0;
  return { items, total };
}

export function getCampaign(orgId: string, campaignId: string): Campaign | null {
  const row = one<CampaignRow>("SELECT * FROM campaigns WHERE id = ? AND org_id = ?", [campaignId, orgId]);
  if (!row) return null;
  const campaign = mapCampaign(row);
  campaign.stats = campaignStats(campaignId);
  return campaign;
}

export function campaignStats(campaignId: string): CampaignStats {
  const recipients = one<{
    total: number; pending: number; sent: number; replied: number; unsubscribed: number;
    bounced: number; engaged: number; convertable: number;
  }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN state IN ('sent','opened','clicked') THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied,
            SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS unsubscribed,
            SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
            SUM(CASE WHEN engaged = 1 THEN 1 ELSE 0 END) AS engaged,
            SUM(CASE WHEN state = 'converted' THEN 1 ELSE 0 END) AS convertable
     FROM campaign_recipients WHERE campaign_id = ?`,
    [campaignId],
  );

  const emailsAgg = one<{ sent: number; opened: number; clicked: number; replied: number }>(
    `SELECT COUNT(*) AS sent,
            SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
            SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
            SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied
     FROM emails WHERE campaign_id = ? AND direction = 'outbound'`,
    [campaignId],
  );

  const total = recipients?.total ?? 0;
  const sent = emailsAgg?.sent ?? 0;
  const opened = emailsAgg?.opened ?? 0;
  const replied = emailsAgg?.replied ?? 0;

  return {
    total,
    pending: recipients?.pending ?? 0,
    sent,
    delivered: Math.max(0, sent - (recipients?.bounced ?? 0)),
    opened,
    clicked: emailsAgg?.clicked ?? 0,
    replied,
    interested: recipients?.engaged ?? 0,
    unsubscribed: recipients?.unsubscribed ?? 0,
    bounced: recipients?.bounced ?? 0,
    converted: recipients?.convertable ?? 0,
    openRate: sent ? Math.round((opened / sent) * 100) : 0,
    replyRate: sent ? Math.round((replied / sent) * 100) : 0,
    conversionRate: sent ? Math.round(((recipients?.convertable ?? 0) / sent) * 100) : 0,
  };
}

export function createCampaign(orgId: string, input: {
  name: string;
  description?: string | null;
  industry?: string | null;
  location?: string | null;
  criteria?: Record<string, unknown>;
  sequence?: Campaign["sequence"];
  dailyCap?: number;
  requireApproval?: boolean;
  ownerId?: string | null;
  status?: CampaignStatus;
}): Campaign {
  const id = newId("cmp");
  const timestamp = new Date().toISOString();
  insert("campaigns", {
    id,
    org_id: orgId,
    name: input.name,
    description: input.description ?? null,
    industry: input.industry ?? null,
    location: input.location ?? null,
    criteria_json: input.criteria ?? {},
    sequence_json: input.sequence ?? [],
    status: input.status ?? "draft",
    daily_cap: input.dailyCap ?? 50,
    require_approval: input.requireApproval === false ? 0 : 1,
    owner_id: input.ownerId ?? null,
    target_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getCampaign(orgId, id)!;
}

export function updateCampaign(orgId: string, campaignId: string, patch: Partial<Campaign>): Campaign | null {
  const columnMap: Record<string, string> = {
    name: "name", description: "description", industry: "industry", location: "location",
    criteria: "criteria_json", sequence: "sequence_json", status: "status", dailyCap: "daily_cap",
    requireApproval: "require_approval", ownerId: "owner_id", targetCount: "target_count",
    startedAt: "started_at", completedAt: "completed_at", pausedReason: "paused_reason",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (!Object.keys(values).length) return getCampaign(orgId, campaignId);
  values.updated_at = new Date().toISOString();
  update("campaigns", campaignId, values);
  return getCampaign(orgId, campaignId);
}

export function addCampaignRecipient(orgId: string, input: {
  campaignId: string;
  businessId: string;
  leadId?: string | null;
  contactId?: string | null;
  skipReason?: string | null;
}): { id: string; created: boolean } {
  const existing = one<{ id: string }>("SELECT id FROM campaign_recipients WHERE campaign_id = ? AND business_id = ?", [input.campaignId, input.businessId]);
  if (existing) return { id: existing.id, created: false };
  const id = newId("rcp");
  const timestamp = new Date().toISOString();
  insert("campaign_recipients", {
    id,
    org_id: orgId,
    campaign_id: input.campaignId,
    lead_id: input.leadId ?? null,
    business_id: input.businessId,
    contact_id: input.contactId ?? null,
    step: 0,
    state: input.skipReason ? "skipped" : "pending",
    skip_reason: input.skipReason ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  run("UPDATE campaigns SET target_count = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ?), updated_at = ? WHERE id = ?", [
    input.campaignId,
    timestamp,
    input.campaignId,
  ]);
  return { id, created: true };
}

export function listCampaignRecipients(campaignId: string, filter: { state?: string; limit?: number; offset?: number } = {}): {
  items: { id: string; businessId: string; businessName: string; contactName: string | null; email: string | null; state: string; step: number; lastSentAt: string | null; repliedAt: string | null; skipReason: string | null }[];
  total: number;
} {
  const clauses = ["r.campaign_id = ?"];
  const params: unknown[] = [campaignId];
  if (filter.state) { clauses.push("r.state = ?"); params.push(filter.state); }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const rows = all<{
    id: string; business_id: string; business_name: string; contact_name: string | null; email: string | null;
    state: string; step: number; last_sent_at: string | null; replied_at: string | null; skip_reason: string | null;
  }>(
    `SELECT r.id, r.business_id, b.name AS business_name, c.name AS contact_name, c.email,
            r.state, r.step, r.last_sent_at, r.replied_at, r.skip_reason
     FROM campaign_recipients r
     JOIN businesses b ON b.id = r.business_id
     LEFT JOIN contacts c ON c.id = r.contact_id
     ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 300), filter.offset ?? 0],
  );
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM campaign_recipients r ${where}`, params)?.total ?? 0;
  return {
    items: rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      businessName: row.business_name,
      contactName: row.contact_name,
      email: row.email,
      state: row.state,
      step: row.step,
      lastSentAt: row.last_sent_at,
      repliedAt: row.replied_at,
      skipReason: row.skip_reason,
    })),
    total,
  };
}

export function updateRecipient(recipientId: string, patch: {
  state?: string;
  step?: number;
  lastSentAt?: string | null;
  nextSendAt?: string | null;
  repliedAt?: string | null;
  bouncedAt?: string | null;
  unsubscribedAt?: string | null;
  engaged?: boolean;
}): void {
  const columnMap: Record<string, string> = {
    state: "state", step: "step", lastSentAt: "last_sent_at", nextSendAt: "next_send_at",
    repliedAt: "replied_at", bouncedAt: "bounced_at", unsubscribedAt: "unsubscribed_at", engaged: "engaged",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (!Object.keys(values).length) return;
  values.updated_at = new Date().toISOString();
  update("campaign_recipients", recipientId, values);
}

export function dueCampaignRecipients(limit: number): { id: string; campaignId: string; businessId: string; contactId: string | null; step: number; leadId: string | null }[] {
  return all<{ id: string; campaign_id: string; business_id: string; contact_id: string | null; step: number; lead_id: string | null }>(
    `SELECT r.id, r.campaign_id, r.business_id, r.contact_id, r.step, r.lead_id
     FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id
     WHERE r.state IN ('pending','scheduled') AND c.status = 'active'
       AND (r.next_send_at IS NULL OR r.next_send_at <= now_iso())
     ORDER BY COALESCE(r.next_send_at, r.created_at) ASC LIMIT ?`,
    [limit],
  ).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    businessId: row.business_id,
    contactId: row.contact_id,
    step: row.step,
    leadId: row.lead_id,
  }));
}

/* ── emails ─────────────────────────────────────────────────────────────── */

interface EmailRow {
  id: string; org_id: string; campaign_id: string | null; lead_id: string | null; business_id: string | null;
  contact_id: string | null; user_id: string | null; direction: string; style: string | null;
  from_address: string | null; to_address: string; subject: string; body_text: string | null;
  body_html: string | null; provider: string | null; provider_message_id: string | null; status: string;
  error: string | null; opened_at: string | null; clicked_at: string | null; replied_at: string | null;
  bounced_at: string | null; sent_at: string | null; created_at: string; business_name?: string | null;
}

function mapEmail(row: EmailRow): EmailRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    campaignId: row.campaign_id,
    leadId: row.lead_id,
    businessId: row.business_id,
    contactId: row.contact_id,
    direction: row.direction,
    style: (row.style as EmailStyle) ?? null,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    provider: row.provider,
    status: row.status,
    error: row.error,
    openedAt: row.opened_at,
    clickedAt: row.clicked_at,
    repliedAt: row.replied_at,
    bouncedAt: row.bounced_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    businessName: row.business_name ?? undefined,
  };
}

export function createEmail(orgId: string, input: {
  campaignId?: string | null;
  leadId?: string | null;
  businessId?: string | null;
  contactId?: string | null;
  userId?: string | null;
  style?: EmailStyle;
  fromAddress?: string | null;
  toAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  provider?: string | null;
  status?: string;
}): EmailRecord {
  const id = newId("eml");
  const timestamp = new Date().toISOString();
  insert("emails", {
    id,
    org_id: orgId,
    campaign_id: input.campaignId ?? null,
    lead_id: input.leadId ?? null,
    business_id: input.businessId ?? null,
    contact_id: input.contactId ?? null,
    user_id: input.userId ?? null,
    direction: "outbound",
    style: input.style ?? null,
    from_address: input.fromAddress ?? null,
    to_address: input.toAddress,
    subject: input.subject,
    body_text: input.bodyText,
    body_html: input.bodyHtml,
    provider: input.provider ?? null,
    status: input.status ?? "queued",
    created_at: timestamp,
  });
  return mapEmail(one<EmailRow>("SELECT * FROM emails WHERE id = ?", [id])!);
}

export function markEmailSent(emailId: string, input: { provider: string; providerMessageId?: string | null }): void {
  update("emails", emailId, {
    status: "sent",
    provider: input.provider,
    provider_message_id: input.providerMessageId ?? null,
    sent_at: new Date().toISOString(),
  });
}

export function markEmailFailed(emailId: string, error: string): void {
  update("emails", emailId, { status: "failed", error });
}

export function markEmailOpened(emailId: string): void {
  update("emails", emailId, { status: "opened", opened_at: new Date().toISOString() });
}

export function listEmails(orgId: string, filter: { leadId?: string; campaignId?: string; status?: string; limit?: number; offset?: number } = {}): { items: EmailRecord[]; total: number } {
  const clauses = ["e.org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.leadId) { clauses.push("e.lead_id = ?"); params.push(filter.leadId); }
  if (filter.campaignId) { clauses.push("e.campaign_id = ?"); params.push(filter.campaignId); }
  if (filter.status) { clauses.push("e.status = ?"); params.push(filter.status); }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<EmailRow>(
    `SELECT e.*, b.name AS business_name FROM emails e LEFT JOIN businesses b ON b.id = e.business_id ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 300), filter.offset ?? 0],
  ).map(mapEmail);
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM emails e ${where}`, params)?.total ?? 0;
  return { items, total };
}

/* ── opt-outs (§52, §25) ────────────────────────────────────────────────── */

export function addOptOut(orgId: string, input: { email?: string | null; domain?: string | null; reason?: string }): void {
  const email = input.email?.toLowerCase() ?? null;
  const domain = input.domain?.toLowerCase() ?? (email ? email.split("@")[1] : null);
  const existing = one<{ id: string }>(
    "SELECT id FROM outreach_optouts WHERE org_id = ? AND (email = ? OR (domain IS NOT NULL AND domain = ?))",
    [orgId, email, domain],
  );
  if (existing) return;
  insert("outreach_optouts", {
    id: newId("opt"),
    org_id: orgId,
    email,
    domain,
    reason: input.reason ?? "recipient_request",
    created_at: new Date().toISOString(),
  });
}

export function isOptedOut(orgId: string, email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase() ?? null;
  const row = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM outreach_optouts WHERE org_id = ? AND (lower(email) = ? OR (domain IS NOT NULL AND lower(domain) = ?))",
    [orgId, email.toLowerCase(), domain],
  );
  return (row?.c ?? 0) > 0;
}

export function listOptOuts(orgId: string, limit = 100): { email: string | null; domain: string | null; reason: string | null; createdAt: string }[] {
  return all<{ email: string | null; domain: string | null; reason: string | null; created_at: string }>(
    "SELECT email, domain, reason, created_at FROM outreach_optouts WHERE org_id = ? ORDER BY created_at DESC LIMIT ?",
    [orgId, limit],
  ).map((row) => ({ email: row.email, domain: row.domain, reason: row.reason, createdAt: row.created_at }));
}

export function emailsSentToday(orgId: string): number {
  return (
    one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM emails WHERE org_id = ? AND sent_at >= datetime('now','start of day') AND direction = 'outbound'",
      [orgId],
    )?.c ?? 0
  );
}
