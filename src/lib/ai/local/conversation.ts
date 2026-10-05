import type { IntentLevel } from "../../types";
import { INTENT_META } from "../../types";
import type { ChatReply, IntentDetection } from "../types";
import { industryProfile } from "./industry";
import { applyGuardrails, isAbusiveOrNonCompliant } from "../guardrails";

/**
 * AI sales chat agent (§16), intent detection (§17, §18).
 *
 * The agent is rule-driven and transparent. It never claims to be human, never
 * invents facts about the prospect, and hands over to a person the moment the
 * conversation becomes commercial, contentious or specific.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Intent detection
   ══════════════════════════════════════════════════════════════════════════ */

interface IntentSignal {
  pattern: RegExp;
  intent: IntentLevel;
  weight: number;
  meaning: string;
}

const INTENT_SIGNALS: IntentSignal[] = [
  { pattern: /\b(let'?s|we(?:'| a)?re ready to|happy to) (start|begin|proceed|go ahead|move forward|sign)\b/i, intent: "ready_to_start", weight: 40, meaning: "Explicit commitment to proceed" },
  { pattern: /\b(?:send|issue|prepare) (?:me |us )?(?:the |a )?(?:contract|agreement|paperwork|invoice)\b/i, intent: "ready_to_start", weight: 38, meaning: "Requesting contractual paperwork" },
  { pattern: /\b(?:can|could) (?:you|someone|one of your team) (?:give me a )?call\b/i, intent: "wants_call", weight: 34, meaning: "Explicitly requesting a phone call" },
  { pattern: /\b(?:call|ring|phone) me\b/i, intent: "wants_call", weight: 34, meaning: "Asking to be called" },
  { pattern: /\b(?:book|schedule|arrange) (?:a |the )?(?:call|meeting|chat|consultation|appointment|demo)\b/i, intent: "wants_call", weight: 30, meaning: "Requesting a meeting or call" },
  { pattern: /\bwhat(?:'s| is| would) (?:the |your )?(?:cost|price|pricing|budget|how much)\b/i, intent: "wants_pricing", weight: 26, meaning: "Asking about price" },
  { pattern: /\bhow much (?:would|does|do|will)\b/i, intent: "wants_pricing", weight: 26, meaning: "Asking about cost" },
  { pattern: /\b(?:what|how much)[\w\s'’,-]{0,28}?(?:cost|price|pricing|charge|budget|fees?)\b/i, intent: "wants_pricing", weight: 24, meaning: "Asking about cost" },
  { pattern: /\bbudget (?:is|would be|of|around)\b/i, intent: "wants_pricing", weight: 20, meaning: "Discussing budget" },
  { pattern: /\b(?:can|could) (?:you|we) (?:see|get) (?:a )?(?:demo|example|sample|mockup|preview|portfolio)\b/i, intent: "wants_demo", weight: 24, meaning: "Requesting examples or a demo" },
  { pattern: /\b(?:show|send) (?:me|us) (?:some |a few )?(?:examples|work|portfolio|case stud|sample)\b/i, intent: "wants_demo", weight: 22, meaning: "Requesting proof of work" },
  { pattern: /\bhow long (?:would|does|will|do) (?:it|this|that|the project)? ?(?:take|last)\b/i, intent: "high_intent", weight: 22, meaning: "Asking about timeline — a late-stage buying question" },
  { pattern: /\b(?:when could|how soon|what(?:'s| is) (?:the |your )?(?:lead time|turnaround|availability))\b/i, intent: "high_intent", weight: 18, meaning: "Testing delivery capacity" },
  { pattern: /\b(?:i(?:'m| am) (?:definitely |very |quite )?(?:interested|keen)|we(?:'re| are) interested|sounds (?:good|great) to me|that(?:'s| is) interesting)\b/i, intent: "interested", weight: 20, meaning: "Positive sentiment signal" },
  { pattern: /\bwe(?:'ve| have) been (?:thinking|looking|considering)\b/i, intent: "interested", weight: 16, meaning: "Already considering a project" },
  { pattern: /\b(?:we(?:'re| are)|i(?:'m| am)) (?:currently )?(?:looking for|needing)\b/i, intent: "interested", weight: 16, meaning: "Active requirement" },
  { pattern: /\b(?:redesign|rebuild|build|redo) (?:our|the|my|a new) (?:website|site)\b/i, intent: "interested", weight: 18, meaning: "Actively describing the project" },
  { pattern: /\bwho (?:would|will) (?:be )?(?:doing|building|working on|handling)\b/i, intent: "information_seeking", weight: 12, meaning: "Evaluating the team" },
  { pattern: /\b(?:what|which) (?:platform|technology|cms|stack)\b/i, intent: "information_seeking", weight: 12, meaning: "Technical due diligence" },
  { pattern: /\bdo you (?:also|offer)\b/i, intent: "information_seeking", weight: 10, meaning: "Exploring scope" },
  { pattern: /\b(?:can|could) you (?:tell|explain|clarify)\b/i, intent: "information_seeking", weight: 8, meaning: "Seeking information" },
  { pattern: /\b(?:tell me more|more (?:info|information|details)|interested to (?:hear|learn)|sounds interesting)\b/i, intent: "curious", weight: 10, meaning: "Curiosity — top of funnel" },
  { pattern: /\b(?:who are you|is this (?:an? )?(?:real )?(?:person|human|bot|robot|ai|automated|machine)|are you (?:an? )?(?:real |actual )?(?:person|human|bot|robot|ai|automated|machine)|am i (?:talking|speaking) to (?:an? )?(?:person|human|bot|ai))\b/i, intent: "curious", weight: 4, meaning: "Checking whether they are talking to a person" },
  { pattern: /\bno thanks\b|\bnot interested\b|\bnot for us\b|\bplease stop\b|\bunsubscribe\b|\bdon'?t contact\b|\bremove me\b/i, intent: "not_interested", weight: -30, meaning: "Explicit decline or opt-out request" },
  { pattern: /\bwe already have (?:a|our own|an) \w+/i, intent: "not_interested", weight: -14, meaning: "Already has a supplier" },
  { pattern: /\btoo expensive\b|\bcan'?t afford\b|\bno budget\b|\bbudget is (?:tight|not there)\b/i, intent: "not_interested", weight: -12, meaning: "Budget blocker" },
  { pattern: /\b(?:stop|don'?t) (?:emailing|calling|contacting)\b/i, intent: "not_interested", weight: -40, meaning: "Explicit opt-out — must be honoured immediately" },
];

const NEGATIVE_SENTIMENT = /\b(?:annoying|spam|inappropriate|unacceptable|rude|angry|frustrat|furious|report you)\b/i;
const POSITIVE_SENTIMENT = /\b(?:thanks|thank you|appreciate|helpful|good to know|great|brilliant|perfect|useful)\b/i;

export function detectIntent(utterance: string, history?: { role: string; body: string }[]): IntentDetection {
  const text = utterance.trim();
  const signals: IntentDetection["signals"] = [];
  // Held in an object so TypeScript's control-flow narrowing does not collapse
  // the union to whatever was assigned last.
  const state: { best: IntentLevel; weight: number; negative: boolean; bestWeight: number } = {
    best: "unknown",
    weight: 0,
    negative: false,
    bestWeight: 0,
  };

  INTENT_SIGNALS.forEach((signal) => {
    const match = signal.pattern.exec(text);
    if (!match) return;
    signals.push({ phrase: match[0], meaning: signal.meaning, weight: signal.weight });
    if (signal.weight < 0) state.negative = true;
    if (signal.weight > state.bestWeight) {
      state.bestWeight = signal.weight;
      state.best = signal.intent;
    }
  });

  // Multiple positive questions compound: pricing + call request is very strong.
  const positiveSignals = signals.filter((s) => s.weight > 0);
  if (positiveSignals.length >= 2 && state.bestWeight > 0) {
    state.bestWeight += positiveSignals.length * 4;
    const escalated: IntentLevel = state.bestWeight >= 52 ? "ready_to_start" : state.bestWeight >= 38 ? "high_intent" : state.best;
    if (escalated !== "not_interested") state.best = escalated;
  }

  // A question mark alone is weak evidence of curiosity, not disinterest.
  if (signals.length === 0 && /\?/.test(text)) {
    signals.push({ phrase: text.slice(0, 60), meaning: "Open-ended question", weight: 6 });
    state.best = "curious";
    state.bestWeight = 6;
  }

  if (state.negative) {
    const decline = signals.find((s) => s.weight <= -30);
    state.best = "not_interested";
    state.bestWeight = decline?.weight ?? -12;
  }

  // Prior history lifts the floor: an engaged thread is not a cold start.
  if (history && history.length >= 4 && !state.negative) {
    const priorPositive = history.some((m) => m.role === "prospect" && /price|cost|when|how long|call|start/i.test(m.body));
    if (priorPositive) state.bestWeight += 8;
  }

  const declared = INTENT_META[state.best]?.score ?? 0;
  const derived = Math.max(0, Math.min(100, state.bestWeight * 2));
  const baseScore = state.bestWeight < 0 ? declared : Math.max(declared, derived);
  const score = Math.max(0, Math.min(100, baseScore + Math.max(0, positiveSignals.length - 1) * 3));

  const sentiment: IntentDetection["sentiment"] = NEGATIVE_SENTIMENT.test(text) || state.negative
    ? "negative"
    : POSITIVE_SENTIMENT.test(text) || positiveSignals.length > 0
      ? "positive"
      : "neutral";

  const shouldEscalate = score >= 70 || /unsubscribe|stop contacting|remove me/i.test(text);
  const escalationReason = shouldEscalate
    ? /unsubscribe|stop contacting|remove me/i.test(text)
      ? "Prospect asked to stop being contacted — honour the opt-out immediately and suppress all channels."
      : `Buying intent score of ${score} exceeds the escalation threshold.`
    : undefined;

  const suggestedLeadStatus = resolveSuggestedStatus(state.best, text);

  return {
    intent: state.best,
    score,
    confidence: signals.length === 0 ? 40 : Math.min(96, 55 + signals.length * 12),
    signals,
    sentiment,
    shouldEscalate,
    escalationReason,
    suggestedLeadStatus,
    summary: summariseIntent(text, state.best, signals),
  };
}

function resolveSuggestedStatus(best: IntentLevel, text: string): string | undefined {
  if (best === "not_interested") return /unsubscribe|stop/i.test(text) ? "not_interested" : "follow_up_later";
  if (best === "ready_to_start" || best === "wants_call") return "interested";
  if (best === "wants_pricing" || best === "wants_demo" || best === "high_intent") return "interested";
  if (best === "interested") return "engaged";
  return undefined;
}

function summariseIntent(text: string, intent: IntentLevel, signals: IntentDetection["signals"]): string {
  const label = INTENT_META[intent]?.label ?? "Unknown";
  if (signals.length === 0) return `Classified as "${label}". Trigger phrase: "${text.slice(0, 90)}".`;
  return `Classified as "${label}" on: ${signals.map((s) => `"${s.phrase}" (${s.meaning})`).join("; ")}.`;
}

/* ══════════════════════════════════════════════════════════════════════════
   Chat reply generation
   ══════════════════════════════════════════════════════════════════════════ */

export interface ChatContext {
  businessName: string;
  contactName?: string | null;
  industry?: string | null;
  city?: string | null;
  websiteUrl?: string | null;
  findings?: { title: string; evidence: string; detail: string; recommendation: string; severity: string }[];
  scores?: Record<string, number | null | undefined> | null;
  rating?: number | null;
  reviewCount?: number | null;
  agencyName: string;
  agencyPhone?: string | null;
  agentName?: string | null;
  history: { role: string; body: string; created_at?: string }[];
  proposalLink?: string | null;
  auditLink?: string | null;
  budgetGuidance?: { low: number; high: number; currency: string } | null;
  timeline?: { low: number; high: number } | null;
}

export function localChatReply(utterance: string, ctx: ChatContext): ChatReply {
  const intent = detectIntent(utterance, ctx.history);
  const profile = industryProfile(ctx.industry, null);
  const findings = ctx.findings ?? [];
  const topFinding = findings
    .filter((f) => f.severity !== "positive")
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0];
  const questionsAsked = ctx.history.filter((m) => m.role === "prospect").length;
  const firstTurn = ctx.history.length === 0;

  const compliance = isAbusiveOrNonCompliant(utterance);
  if (!compliance.allowed) {
    return {
      message: "I understand. I will make sure your details are removed from our contact list and you will not hear from us again. Thank you for telling me.",
      intent,
      internalNote: `Blocked output: ${compliance.reason}`,
      suggestedQuestions: [],
      handoffRecommended: true,
      handoffReason: compliance.reason,
    };
  }

  const raw = composeReply({ utterance, intent, ctx, profile, topFinding, questionsAsked, firstTurn });
  const guarded = applyGuardrails(raw, { applyToneRules: true });

  // Asking whether they are talking to a person is itself a reason to offer one.
  const asksAboutBeingHuman = /\b(?:who are you|is this (?:an? )?(?:real )?(?:person|human|bot|robot|ai|automated|machine)|are you (?:an? )?(?:real |actual )?(?:person|human|bot|robot|ai|automated|machine)|am i (?:talking|speaking) to (?:an? )?(?:person|human|bot|ai)|real person)\b/i.test(utterance);

  const handoffRecommended =
    intent.shouldEscalate ||
    asksAboutBeingHuman ||
    intent.intent === "ready_to_start" ||
    intent.intent === "wants_call" ||
    intent.intent === "not_interested" ||
    questionsAsked >= 6;

  return {
    message: guarded.text,
    intent,
    internalNote: buildInternalNote(intent, topFinding?.title),
    suggestedQuestions: buildSuggestedQuestions(intent, ctx),
    handoffRecommended,
    handoffReason: handoffRecommended
      ? intent.escalationReason ??
        (intent.intent === "not_interested"
          ? "Prospect declined — close the loop politely and suppress further outreach."
          : "Sufficient intent to justify a human conversation. Take over now for the best chance of conversion.")
      : undefined,
  };
}

function severityRank(severity: string): number {
  return { critical: 0, high: 1, medium: 2, low: 3, positive: 4 }[severity] ?? 5;
}

function composeReply(args: {
  utterance: string;
  intent: IntentDetection;
  ctx: ChatContext;
  profile: ReturnType<typeof industryProfile>;
  topFinding: ChatContext["findings"] extends (infer T)[] | undefined ? T | undefined : never;
  questionsAsked: number;
  firstTurn: boolean;
}): string {
  const { utterance, intent, ctx, profile, topFinding, questionsAsked, firstTurn } = args;
  const name = ctx.contactName?.split(" ")[0] ?? null;
  const address = name ? `${name}, ` : "";
  const lower = utterance.toLowerCase();

  /* 1. Opt-out — always first, always unambiguous. */
  if (intent.intent === "not_interested" && /unsubscribe|stop|remove|don'?t contact/i.test(lower)) {
    return `Understood — I have removed ${ctx.businessName} from our contact list and you will not hear from us again. If anything changes in future, you are welcome to get in touch. Apologies for the interruption.`;
  }

  /* 2. "Are you a robot?" */
  if (/are you (?:a )?(?:human|real|bot|ai)|is this (?:a )?(?:bot|robot|ai)|who am i (?:talking|speaking) to|am i talking to a person/i.test(lower)) {
    return `Good question — I should be clear: I am an AI assistant working on behalf of ${ctx.agencyName}. A human from the team, usually ${ctx.agentName ?? "one of our specialists"}, reviews every conversation and will take over as soon as it makes sense for you. I can answer factual questions about the findings we made, and I will hand you to a person for anything commercial or specific. Would you like me to arrange that now?`;
  }

  /* 3. Opening turn — introduce honestly and explain why we made contact. */
  if (firstTurn && intent.intent === "unknown") {
    return `Hello${name ? ` ${name}` : ""} — thanks for getting in touch. I am an AI assistant for ${ctx.agencyName}. We contacted ${ctx.businessName} because ${
      ctx.websiteUrl
        ? `we reviewed ${ctx.websiteUrl} and found some specific, measurable things worth fixing`
        : `we could not find a website for the business, despite a strong public reputation`
    }. I can talk you through exactly what we found, and a person from the team can pick it up at any point. What would be most useful to start with?`;
  }

  /* 4. Pricing — give honest ranges, never commit. */
  if (intent.intent === "wants_pricing" || /how much|cost|price|budget|expensive/.test(lower)) {
    const guidance = ctx.budgetGuidance;
    const range = guidance
      ? `${guidance.currency} ${Math.round(guidance.low).toLocaleString()} and ${guidance.currency} ${Math.round(guidance.high).toLocaleString()}`
      : "a range we would confirm on a short call";
    return `${address}fair question. For a ${profile.label.toLowerCase()} project like the one we would recommend here, projects typically land between ${range} depending on the number of pages, whether ${
      profile.mustHaveFeatures.some((f) => /booking/i.test(f)) ? "booking is included" : "integrations are needed"
    } and whether we handle the copywriting.${topFinding ? ` The main driver in your case is ${topFinding.title.toLowerCase()} — fixing that properly affects the scope.` : ""}\n\nThat range is indicative rather than a quote. If you tell me roughly what you had in mind, I can say honestly whether it is realistic — and a 20-minute call is usually enough to give you a firm figure. Shall I set one up?`;
  }

  /* 5. Timeline. */
  if (/how long|timescale|how soon|when (?:could|can|would)|lead time|turnaround/.test(lower)) {
    const t = ctx.timeline;
    const weeks = t ? `${t.low}–${t.high} weeks` : "a matter of weeks";
    return `${address}typically ${weeks} from sign-off for a project of this scope${t ? `, with the design phase taking the first ${Math.max(1, t.low - 1)} of those` : ""}. The main variable is content and approvals rather than build time — projects where we receive images and copy quickly move fastest. We work to a fixed timeline agreed in writing before anything starts. Once I know your priorities, the team can give you exact dates.`;
  }

  /* 6. Requesting a call / meeting — escalate. */
  if (intent.intent === "wants_call" || intent.intent === "wants_demo" || /call|meeting|speak to someone|talk to (?:a )?(?:human|person)/.test(lower)) {
    const phone = ctx.agencyPhone ? ` on ${ctx.agencyPhone}` : "";
    return `${address}absolutely — I will flag this for the team now so a person picks it up straight away. You can reach them directly${phone}, or if you tell me a good time we will call you. A 20-minute call is usually enough;${
      ctx.auditLink ? ` you can also review the audit findings first here: ${ctx.auditLink}` : " we can walk through the findings on the call"
    }.`;
  }

  /* 7. Technical / process due diligence. */
  if (/which (?:platform|cms|system)|what (?:platform|technology|stack)|hosting|wordpress|shopify|wix/.test(lower)) {
    return `We build on a modern, portable stack — a content-managed site you can edit yourself, with no platform lock-in and the code owned by you at handover. If you already use a specific platform and want to stay on it, we will say honestly whether that is a sensible choice rather than pushing a rebuild you do not need. What are you using at the moment?`;
  }

  /* 8. Examples / proof. */
  if (/example|portfolio|case stud|show me|previous work|who else/.test(lower)) {
    return `${address}yes — I will ask the team to send the most relevant examples for ${profile.label.toLowerCase()} businesses. Anything we share is real client work with the numbers behind it, so you can judge outcomes rather than just visuals. If you tell me which of your services matters most commercially, they can prioritise examples from that area.`;
  }

  /* 9. Questions about what we found — the strongest trust-building answer. */
  if (/what did you find|what(?:'s| is) wrong|what problems|tell me (?:more|about)|why did you contact/.test(lower)) {
    if (topFinding) {
      return `${address}the finding I would lead with is: ${topFinding.title.toLowerCase()}.\n\nWhat we measured: ${topFinding.evidence}\n\nWhy it matters: ${topFinding.detail}\n\nWhat we would do about it: ${topFinding.recommendation}\n\n${ctx.auditLink ? `The full report with every measurement is here: ${ctx.auditLink} — nothing in it is a guess.` : "I can send the full report so you can check every measurement yourself."}`;
    }
    return `${address}rather than describe the site in general terms, we ran an automated review and recorded specific measurements. I will ask the team to send you the full report so you can check each finding yourself — that is more useful than any summary I could give.`;
  }

  /* 10. Ready to start — hand over immediately. */
  if (intent.intent === "ready_to_start") {
    return `${address}that is great to hear. I am going to hand this straight to a human from ${ctx.agencyName} so nothing gets delayed in translation — they will confirm scope, send a fixed-price agreement and book your kick-off. You should hear from them very shortly${ctx.agencyPhone ? `, and you can reach them directly on ${ctx.agencyPhone}` : ""}.`;
  }

  /* 11. Positive but non-specific. */
  if (intent.intent === "interested") {
    return `${address}glad it is relevant. The two things that usually decide the shape of a project are what you want the site to achieve commercially, and how quickly you want it live. If you can give me a steer on either, I will make sure the team comes to the call with something specific rather than generic. Would a 20-minute call this week work?`;
  }

  /* 12. Objection: existing site / existing supplier / no budget. */
  if (/already (?:have|got) (?:a|our|an)|existing (?:site|website|agency)|we (?:have|use) (?:an|a) (?:agency|developer)/.test(lower)) {
    return `${address}that is useful to know — and to be clear, we are not suggesting you have done anything wrong. The audit found specific, measurable issues: ${
      topFinding ? `${topFinding.title.toLowerCase()} (${topFinding.evidence})` : `scores below the threshold where visitors reliably convert`
    }. Whether that is worth fixing is your call; our job is to show you the measurement honestly. If your current setup is working well, we will say so.`;
  }
  if (/no budget|can'?t afford|too expensive|budget is tight/.test(lower)) {
    return `${address}completely understand, and I would rather be straight with you than waste your time. If budget is tight, the sensible path is to fix the highest-impact items first — usually ${
      topFinding ? topFinding.title.toLowerCase() : "the conversion and mobile issues"
    } — and phase the rest. That is often a fraction of a full rebuild and it pays for the later work. Happy to keep this on file and check back when it is a better moment.`;
  }

  /* 13. Curious / open question fallback. */
  if (intent.intent === "curious" || intent.intent === "information_seeking" || intent.intent === "unknown") {
    const opener = firstTurn
      ? `Hello${name ? ` ${name}` : ""} — I am an AI assistant for ${ctx.agencyName}. `
      : `${address}`;
    return `${opener}happy to help. In short: we reviewed ${ctx.businessName}'s online presence${
      ctx.rating ? ` — the ${ctx.rating.toFixed(1)}★ reputation across ${ctx.reviewCount ?? 0} reviews is genuinely strong` : ""
    } and found ${(ctx.findings ?? []).length || "a number of"} things worth improving. Ask me anything about what we found, how long it would take, or what a project typically costs. And if you would rather speak to a person, just say so and I will arrange it.`;
  }

  /* 14. Anything else — honest fallback with a human offer. */
  return `${address}I want to give you an accurate answer rather than a vague one, so let me have a person from ${ctx.agencyName} follow up on that specific point — they will have the full context of this conversation.${
    questionsAsked >= 2 ? " Would you prefer a call or an email?" : " In the meantime, is there anything about the findings themselves you would like me to explain?"
  }`;
}

function buildInternalNote(intent: IntentDetection, findingTitle?: string): string {
  const parts = [`Intent: ${INTENT_META[intent.intent]?.label ?? intent.intent} (${intent.score}/100, ${intent.confidence}% confidence).`];
  if (intent.signals.length) parts.push(`Triggers: ${intent.signals.map((s) => `"${s.phrase}"`).join(", ")}.`);
  parts.push(`Sentiment: ${intent.sentiment}.`);
  if (findingTitle) parts.push(`Referenced finding: ${findingTitle}.`);
  if (intent.shouldEscalate) parts.push("ESCALATION TRIGGERED.");
  return parts.join(" ");
}

function buildSuggestedQuestions(intent: IntentDetection, ctx: ChatContext): string[] {
  const name = ctx.contactName?.split(" ")[0];
  const base = [
    "What stage are you at with this — just exploring, or looking to move in the next few months?",
    "Is there a budget range you have in mind, so I can tell you honestly whether it is realistic?",
    "Who else would need to be involved in the decision?",
  ];
  if (intent.intent === "wants_pricing") return ["What is the single most important thing the new site needs to do?", "Do you have existing photography and copy, or would you want us to handle that?", ...base];
  if (intent.intent === "wants_call") return ["What times this week suit you for a 20-minute call?", "Is there anyone else who should join?"];
  if (intent.intent === "ready_to_start") return ["Confirm your preferred start date", "Confirm who signs the agreement", "Confirm access to the current site and domain"];
  if (intent.intent === "not_interested") return ["Confirm opt-out is recorded against the business and all channels are suppressed."];
  return name ? [`Ask ${name} which service matters most commercially.`, ...base] : base;
}

/* ══════════════════════════════════════════════════════════════════════════
   Conversation summary (§19, §20)
   ══════════════════════════════════════════════════════════════════════════ */

export function summariseConversation(messages: { role: string; body: string }[]): string {
  if (messages.length === 0) return "No messages yet.";
  const prospectMessages = messages.filter((m) => m.role === "prospect");
  const intents = prospectMessages.map((m) => detectIntent(m.body, messages));
  const peak = intents.reduce<IntentDetection | null>((best, current) => (!best || current.score > best.score ? current : best), null);
  const keyUtterances = prospectMessages.slice(-3).map((m) => `"${m.body.slice(0, 120).replace(/\s+/g, " ")}"`);

  return [
    `${messages.length} messages exchanged (${prospectMessages.length} from the prospect).`,
    peak ? `Peak intent: ${INTENT_META[peak.intent]?.label ?? peak.intent} at ${peak.score}/100.` : "No strong intent signal yet.",
    keyUtterances.length ? `Recent prospect messages: ${keyUtterances.join("; ")}.` : "",
    peak?.shouldEscalate ? "Escalation threshold reached — a human should take over." : "No escalation trigger yet.",
  ]
    .filter(Boolean)
    .join(" ");
}
