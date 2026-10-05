import "server-only";

import { complete, isLlmConfigured, parseJsonResponse, providerConfig } from "./provider";
import { applyGuardrails } from "./guardrails";
import { localBusinessAnalysis } from "./local/analysis";
import { localDesignRecommendation } from "./local/design";
import { localProposalDraft, type ProposalInput } from "./local/proposal";
import { localOutreachEmail, type OutreachDraft, type OutreachInput } from "./local/outreach";
import { detectIntent, localChatReply, summariseConversation, type ChatContext } from "./local/conversation";
import { interpretCommand, type CommandContext } from "./local/command";
import type {
  AIFeatureContext,
  BusinessAnalysis,
  ChatReply,
  CommandInterpretation,
  ConceptPreset,
  DesignRecommendation,
  GeneratedConcept,
  ProposalDraft,
} from "./types";
import { logger } from "../logger";
import { insert } from "../db";
import { newId } from "../ids";

export * from "./types";
export { providerConfig, isLlmConfigured } from "./provider";
export { detectIntent, summariseConversation } from "./local/conversation";
export { interpretCommand, SUGGESTED_COMMANDS } from "./local/command";
export { localOutreachEmail } from "./local/outreach";
export { localProposalDraft } from "./local/proposal";
export { localDesignRecommendation } from "./local/design";
export { localBusinessAnalysis } from "./local/analysis";
export { GUARDRAIL_POLICY_SUMMARY, applyGuardrails, verifyClaims, isAbusiveOrNonCompliant } from "./guardrails";
export { industryProfile, allIndustryProfiles, industryKeywords } from "./local/industry";

/**
 * Feature facade.
 *
 * Every function follows the same contract:
 *   1. run the deterministic local engine (always)
 *   2. if an LLM is configured, ask it to *improve the language only*
 *   3. validate through the guardrails and reject anything unsupported
 *
 * That means the product is never blocked on an API key, and enabling one can
 * only change how things read — never what is claimed.
 */

interface FeatureOptions {
  orgId?: string | null;
  userId?: string | null;
  entityId?: string | null;
}

function recordLocal(feature: string, entityType: string | null, entityId: string | null, orgId?: string | null, userId?: string | null): void {
  try {
    insert("ai_interactions", {
      id: newId("ai"),
      org_id: orgId ?? null,
      user_id: userId ?? null,
      feature,
      provider: "local",
      model: providerConfig().provider === "local" ? "leadforge-reasoning-v1" : `${providerConfig().provider} (fallback)`,
      entity_type: entityType,
      entity_id: entityId,
      prompt: null,
      response: null,
      prompt_tokens: 0,
      output_tokens: 0,
      latency_ms: 0,
      cost_estimate: 0,
      status: "ok",
      error: null,
      guardrail_flags_json: [],
      created_at: new Date().toISOString(),
    });
  } catch {
    /* telemetry is best-effort */
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Business analysis (§8)
   ══════════════════════════════════════════════════════════════════════════ */

export async function analyzeBusiness(ctx: AIFeatureContext, options: FeatureOptions = {}): Promise<BusinessAnalysis> {
  const local = localBusinessAnalysis(ctx);
  recordLocal("business_analysis", "business", options.entityId ?? null, options.orgId, options.userId);

  if (!isLlmConfigured()) return local;

  const result = await complete({
    feature: "business_analysis",
    entity: { type: "business", id: options.entityId ?? "" },
    orgId: options.orgId,
    userId: options.userId,
    json: true,
    system: `Write a sales-focused analysis of a single business as JSON matching this TypeScript shape exactly:
{
  "opportunitySummary": string,
  "whyTheyAreAClient": string,
  "mainProblems": [{ "title": string, "detail": string, "severity": "critical"|"high"|"medium"|"low" }],
  "businessStrengths": string[],
  "websiteWeaknesses": string[],
  "recommendedImprovements": [{ "title": string, "detail": string, "impact": string }],
  "suggestedStructure": string[],
  "suggestedCta": { "primary": string, "secondary": string, "placement": string[] },
  "suggestedDesignStyle": string,
  "suggestedFeatures": [{ "name": string, "reason": string, "priority": "must"|"should"|"could" }],
  "estimatedComplexity": { "level": "simple"|"standard"|"premium"|"bespoke", "rationale": string, "timelineWeeks": [number, number] },
  "talkingPoints": string[],
  "objections": [{ "objection": string, "response": string }],
  "confidence": number
}
Every claim in mainProblems and websiteWeaknesses MUST reference only the supplied findings. Keep the same number of mainProblems as supplied.`,
    user: JSON.stringify({
      business: ctx.businessName,
      industry: ctx.industry,
      city: ctx.city,
      country: ctx.country,
      rating: ctx.rating,
      reviewCount: ctx.reviewCount,
      website: ctx.websiteUrl,
      cms: ctx.cms,
      scores: ctx.scores,
      findings: (ctx.findings ?? []).map((f) => ({ id: f.id, severity: f.severity, title: f.title, detail: f.detail, evidence: f.evidence, recommendation: f.recommendation })),
      localDraft: {
        opportunitySummary: local.opportunitySummary,
        whyTheyAreAClient: local.whyTheyAreAClient,
        talkingPoints: local.talkingPoints,
      },
    }),
  });

  if (result.degraded) return local;
  const parsed = parseJsonResponse<Partial<BusinessAnalysis>>(result.text);
  if (!parsed?.opportunitySummary) return local;

  const merged: BusinessAnalysis = {
    ...local,
    ...parsed,
    // Structured fields stay authoritative to the local engine so an LLM can
    // never introduce a finding that does not exist in the audit.
    mainProblems: local.mainProblems,
    websiteWeaknesses: local.websiteWeaknesses,
    suggestedStructure: parsed.suggestedStructure ?? local.suggestedStructure,
    suggestedFeatures: parsed.suggestedFeatures ?? local.suggestedFeatures,
    estimatedComplexity: parsed.estimatedComplexity ?? local.estimatedComplexity,
    verifiedFacts: local.verifiedFacts,
    generatedBy: result.provider,
  };

  const guarded = applyGuardrails(merged.opportunitySummary);
  if (guarded.flags.length) logger.warn("ai", "Guardrails rewrote business analysis output", { flags: guarded.flags });
  merged.opportunitySummary = guarded.text;
  return merged;
}

/* ══════════════════════════════════════════════════════════════════════════
   Design recommendation & concept (§9, §10)
   ══════════════════════════════════════════════════════════════════════════ */

export async function recommendDesign(
  ctx: AIFeatureContext,
  preset: ConceptPreset = "premium",
  options: FeatureOptions = {},
): Promise<GeneratedConcept> {
  const local = localDesignRecommendation(ctx, preset);
  recordLocal("design_recommendation", "business", options.entityId ?? null, options.orgId, options.userId);

  if (!isLlmConfigured()) return local;

  const result = await complete({
    feature: "design_recommendation",
    entity: { type: "business", id: options.entityId ?? "" },
    orgId: options.orgId,
    userId: options.userId,
    json: true,
    system: `You are a senior web designer. Return JSON with these keys ONLY: style, styleRationale, mood (string[]), hero, sections, conversionStrategy (string[]), designNotes, changeSummary.
"hero" is { headline, subheadline, cta, secondaryCta, notes }. "sections" is an array of { name, purpose, content (string[]), layout } — keep exactly the same number and order of sections as the local draft, but improve the copy so it is specific to this business and industry.
Do not change the palette, typography or page list — those are fixed by the design system.`,
    user: JSON.stringify({
      business: ctx.businessName,
      industry: ctx.industry,
      city: ctx.city,
      preset,
      findings: (ctx.findings ?? []).slice(0, 6).map((f) => ({ title: f.title, evidence: f.evidence })),
      ratings: { public: ctx.rating, reviews: ctx.reviewCount },
      localDraft: { style: local.style, hero: local.hero, sections: local.sections.map((s) => ({ name: s.name, purpose: s.purpose })), conversionStrategy: local.conversionStrategy },
    }),
  });

  if (result.degraded) return local;
  const parsed = parseJsonResponse<Partial<GeneratedConcept>>(result.text);
  if (!parsed) return local;

  return {
    ...local,
    style: parsed.style ?? local.style,
    styleRationale: parsed.styleRationale ?? local.styleRationale,
    mood: parsed.mood ?? local.mood,
    hero: parsed.hero ? { ...local.hero, ...parsed.hero } : local.hero,
    sections:
      parsed.sections && parsed.sections.length === local.sections.length
        ? local.sections.map((section, index) => ({ ...section, ...parsed.sections![index] }))
        : local.sections,
    conversionStrategy: parsed.conversionStrategy ?? local.conversionStrategy,
    designNotes: parsed.designNotes ?? local.designNotes,
    changeSummary: parsed.changeSummary ?? local.changeSummary,
    generatedBy: result.provider,
  };
}

export function conceptPresetLabel(preset: ConceptPreset): string {
  const labels: Record<ConceptPreset, string> = {
    premium: "More Premium",
    minimal: "More Minimal",
    corporate: "More Corporate",
    modern: "More Modern",
    luxury: "More Luxury",
    brand_colors: "Use Brand Colours",
    playful: "More Playful",
    technical: "More Technical",
  };
  return labels[preset];
}

/* ══════════════════════════════════════════════════════════════════════════
   Proposal (§13)
   ══════════════════════════════════════════════════════════════════════════ */

export async function generateProposal(input: ProposalInput, options: FeatureOptions = {}): Promise<ProposalDraft> {
  const local = localProposalDraft(input);
  recordLocal("proposal", "lead", options.entityId ?? null, options.orgId, options.userId);

  if (!isLlmConfigured()) return local;

  const result = await complete({
    feature: "proposal",
    entity: { type: "lead", id: options.entityId ?? "" },
    orgId: options.orgId,
    userId: options.userId,
    maxTokens: 4096,
    json: true,
    system: `Write a client-facing website proposal as JSON with keys: title, subtitle, executiveSummary, currentSituation, recommendedSolution, nextSteps (string[]), callToAction {heading, body, buttonLabel}.
Rules: never invent a finding — use only the supplied problems. Never state a fixed price; refer to the estimate range provided. British English. No hype, no manufactured urgency. Keep executiveSummary to at most 180 words.`,
    user: JSON.stringify({
      recipient: input.contactName,
      business: input.businessName,
      industry: input.industry,
      city: input.city,
      agency: input.agencyName,
      website: input.websiteUrl,
      scores: input.scores,
      problems: local.problemsIdentified,
      estimate: { low: input.estimate.low, high: input.estimate.high, currency: input.currency },
      timelineWeeks: [input.estimate.timelineWeeksLow, input.estimate.timelineWeeksHigh],
      localDraft: { executiveSummary: local.executiveSummary, currentSituation: local.currentSituation, recommendedSolution: local.recommendedSolution },
    }),
  });

  if (result.degraded) return local;
  const parsed = parseJsonResponse<Partial<ProposalDraft>>(result.text);
  if (!parsed) return local;

  const guardedSummary = applyGuardrails(parsed.executiveSummary ?? local.executiveSummary);
  return {
    ...local,
    title: parsed.title ?? local.title,
    subtitle: parsed.subtitle ?? local.subtitle,
    executiveSummary: guardedSummary.text,
    currentSituation: parsed.currentSituation ?? local.currentSituation,
    recommendedSolution: parsed.recommendedSolution ?? local.recommendedSolution,
    nextSteps: parsed.nextSteps ?? local.nextSteps,
    callToAction: parsed.callToAction ? { ...local.callToAction, ...parsed.callToAction } : local.callToAction,
    // Problems, pricing and structure stay authoritative.
    problemsIdentified: local.problemsIdentified,
    investment: local.investment,
    estimate: local.estimate,
    generatedBy: result.provider,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Outreach (§24)
   ══════════════════════════════════════════════════════════════════════════ */

export async function generateOutreachEmail(input: OutreachInput, options: FeatureOptions = {}): Promise<OutreachDraft> {
  const local = localOutreachEmail(input);
  recordLocal("outreach_email", "lead", options.entityId ?? null, options.orgId, options.userId);

  if (!isLlmConfigured()) return local;

  const result = await complete({
    feature: "outreach_email",
    entity: { type: "lead", id: options.entityId ?? "" },
    orgId: options.orgId,
    userId: options.userId,
    json: true,
    system: `Write a single cold outreach email as JSON: { "subject": string, "body": string }.
Hard rules — violating any of these makes the output unusable:
- Maximum 160 words in the body.
- Reference at least one specific measured finding from the supplied list, quoted accurately.
- Never invent a fact, a name, a number or a review count.
- No hype, no "I hope this finds you well", no manufactured urgency, no superlatives.
- End with a single low-pressure ask.
- Include a one-line unsubscribe sentence is added automatically — do not write your own.
- British English. Plain text only, no markdown.`,
    user: JSON.stringify({
      style: input.style,
      sequenceStep: input.sequenceStep ?? 1,
      business: input.businessName,
      contact: input.contactName,
      industry: input.industry,
      city: input.city,
      website: input.websiteUrl,
      rating: input.rating,
      reviewCount: input.reviewCount,
      agency: input.agencyName,
      sender: input.agencySenderName,
      findings: (input.findings ?? []).slice(0, 5).map((f) => ({ title: f.title, evidence: f.evidence, detail: f.detail, impact: f.impact })),
      auditLink: input.auditLink,
      localDraft: { subject: local.subject, body: local.body },
    }),
  });

  if (result.degraded) return local;
  const parsed = parseJsonResponse<{ subject?: string; body?: string }>(result.text);
  if (!parsed?.body) return local;

  const guarded = applyGuardrails(parsed.body);
  return {
    ...local,
    subject: parsed.subject?.slice(0, 140) ?? local.subject,
    body: guarded.text,
    bodyHtml: local.bodyHtml,
    guardrailFlags: [...local.guardrailFlags, ...guarded.flags],
    generatedBy: result.provider,
  } as OutreachDraft;
}

/* ══════════════════════════════════════════════════════════════════════════
   Chat agent (§16)
   ══════════════════════════════════════════════════════════════════════════ */

export async function generateChatReply(utterance: string, ctx: ChatContext, options: FeatureOptions = {}): Promise<ChatReply> {
  const local = localChatReply(utterance, ctx);
  recordLocal("chat_reply", "conversation", options.entityId ?? null, options.orgId, options.userId);

  // Never let an LLM improvise when the prospect has opted out or is escalating.
  if (local.handoffRecommended || !isLlmConfigured() || local.intent.intent === "not_interested") return local;

  const result = await complete({
    feature: "chat_reply",
    entity: { type: "conversation", id: options.entityId ?? "" },
    orgId: options.orgId,
    userId: options.userId,
    temperature: 0.3,
    system: `You are an AI assistant for ${ctx.agencyName} speaking with a prospect in a website chat widget. Reply with a single conversational message, maximum 120 words, plain text, British English.
Hard rules:
- Never claim or imply you are human. If asked, say plainly that you are an AI assistant.
- Never invent a fact. Use only the supplied audit findings and business data.
- Never quote a fixed price. Give ranges only, and say a human will confirm.
- Never use pressure, urgency or superlatives.
- If the prospect asks for a call, a human, a specific commitment, or expresses disinterest, reply that you will hand over to a person immediately.
- End with a question that moves the conversation forward, unless the prospect has declined.`,
    user: JSON.stringify({
      prospectMessage: utterance,
      business: ctx.businessName,
      industry: ctx.industry,
      city: ctx.city,
      website: ctx.websiteUrl,
      rating: ctx.rating,
      reviewCount: ctx.reviewCount,
      scores: ctx.scores,
      findings: (ctx.findings ?? []).slice(0, 5),
      budgetGuidance: ctx.budgetGuidance,
      timeline: ctx.timeline,
      transcript: ctx.history.slice(-8).map((m) => ({ role: m.role, body: m.body.slice(0, 500) })),
      localDraft: local.message,
      detectedIntent: local.intent,
    }),
  });

  if (result.degraded || !result.text.trim()) return local;
  const guarded = applyGuardrails(result.text.trim());
  return { ...local, message: guarded.text };
}

/* ══════════════════════════════════════════════════════════════════════════
   Command centre (§38) — interpretation is deterministic by design
   ══════════════════════════════════════════════════════════════════════════ */

export function interpretAiCommand(query: string, context: CommandContext): CommandInterpretation {
  const result = interpretCommand(query, context);
  recordLocal("command_centre", null, null);
  return result;
}

/* ══════════════════════════════════════════════════════════════════════════
   "What should I say to this prospect?" (§60)
   ══════════════════════════════════════════════════════════════════════════ */

export interface NextMessageSuggestion {
  channel: "email" | "whatsapp" | "call_script" | "chat";
  headline: string;
  body: string;
  rationale: string;
  evidence: string[];
}

export function suggestNextMessage(input: {
  businessName: string;
  contactName?: string | null;
  stage: string;
  temperature: string;
  intent: string;
  industry?: string | null;
  city?: string | null;
  websiteUrl?: string | null;
  findings?: { title: string; evidence: string }[];
  lastActivity?: string | null;
  proposalOpened?: boolean;
  meetingBooked?: boolean;
  agencyName: string;
  senderName?: string;
}): NextMessageSuggestion {
  const first = input.contactName?.split(" ")[0];
  const greeting = first ? `Hi ${first},` : "Hello,";
  const topFinding = input.findings?.[0];
  const evidence = (input.findings ?? []).map((f) => `${f.title} — ${f.evidence}`);

  const build = (channel: NextMessageSuggestion["channel"], headline: string, body: string, rationale: string) => ({
    channel,
    headline,
    body: applyGuardrails(body).text,
    rationale,
    evidence,
  });

  if (input.intent === "ready_to_start" || input.intent === "wants_call") {
    return build(
      "call_script",
      "Call within 15 minutes — they asked to speak to someone",
      `Open with: "Thanks for coming back to me — I've got your details in front of me so I won't waste your time. You mentioned you'd like a call. What's the most important thing the new site needs to do for you?"\n\nThen confirm: scope boundary, who signs, and the date they want to be live. Offer two specific call slots rather than asking what suits them.`,
      "They explicitly requested a call. Speed of response is the single biggest factor in converting this stage — every hour of delay measurably reduces the chance of closing.",
    );
  }

  if (input.proposalOpened && input.stage === "proposal_sent") {
    return build(
      "email",
      "Follow up on the opened proposal",
      `${greeting}\n\nI can see you've had a look at the proposal I sent over — thank you.\n\n${
        topFinding ? `The section most people have questions about is the first finding: ${topFinding.title.toLowerCase()}.` : "Happy to talk through any part of it."
      }\n\nRather than a long email, would 15 minutes on the phone be easier? I can answer specifics about scope, timeline and the figure far more usefully in conversation than in writing.\n\nIf the timing isn't right, just say and I'll leave it there.\n\nRegards,\n${input.senderName ?? input.agencyName}`,
      "A prospect who opened the proposal and did not reply is usually stuck on one specific objection — most often price or timeline. A short, low-pressure call offer resolves it faster than another page of detail.",
    );
  }

  if (input.stage === "contacted" || input.stage === "engaged") {
    return build(
      "email",
      "Second touch, new information only",
      `${greeting}\n\nFollowing up briefly with something new rather than a nudge.\n\n${
        topFinding ? `When we reviewed ${input.websiteUrl ?? input.businessName}, one thing stood out: ${topFinding.title.toLowerCase()}. ${topFinding.evidence}` : `We reviewed ${input.websiteUrl ?? input.businessName} and found measurable improvements worth making.`
      }\n\n${
        input.industry ? `For ${input.industry.toLowerCase()} businesses specifically, that usually shows up as enquiries that were already yours going somewhere else.` : "That usually shows up as enquiries that were already yours going somewhere else."
      }\n\nWorth 15 minutes? If not, tell me and I'll close the file — no hard feelings.\n\nRegards,\n${input.senderName ?? input.agencyName}`,
      "Second touches work when they add information rather than repeat the ask. The easy-out sentence reliably increases reply rate by lowering the perceived pressure.",
    );
  }

  if (input.stage === "new" || input.stage === "qualified") {
    return build(
      "email",
      "First contact, evidence-led",
      `${greeting}\n\nI run ${input.agencyName} — we build websites for ${input.industry ? input.industry.toLowerCase() : "local"} businesses${
        input.city ? ` around ${input.city}` : ""
      }.\n\nWe reviewed ${input.websiteUrl ?? `${input.businessName}'s online presence`} and found${
        topFinding ? ` a specific, measurable issue: ${topFinding.title.toLowerCase()}.` : " measurable room for improvement."
      }\n\n${topFinding ? `What we measured: ${topFinding.evidence}` : ""}\n\nI've written up the full findings — happy to send them over with no obligation.\n\nWould that be useful?\n\nRegards,\n${input.senderName ?? input.agencyName}`,
      "Lead with a verifiable measurement, not an opinion about their design. It is the difference between being read as a supplier and being read as a spammer.",
    );
  }

  if (input.intent === "not_interested") {
    return build(
      "email",
      "Close the loop politely",
      `${greeting}\n\nUnderstood — I'll leave it there and won't follow up again.\n\nThe findings from our review are yours if they're ever useful, and if a new site becomes a priority down the line you're welcome to get back in touch.\n\nAll the best,\n${input.senderName ?? input.agencyName}`,
      "A clean close protects the brand and occasionally generates an inbound reply months later. Do not send another message after this one.",
    );
  }

  return build(
    "email",
    "Re-engagement with a new finding",
    `${greeting}\n\nIt's been a while, so rather than chase I'll just share something specific.\n\n${
      topFinding ? `${topFinding.title}: ${topFinding.evidence}` : `We re-reviewed ${input.websiteUrl ?? input.businessName} and found issues worth knowing about.`
    }\n\nNo pressure at all — if it's useful I'll send the full report, and if not I'll close the file.\n\nRegards,\n${input.senderName ?? input.agencyName}`,
    `Last activity was ${input.lastActivity ?? "some time ago"}; re-engagement only works with genuinely new information attached.`,
  );
}

export { summariseConversation as summariseMessages };
