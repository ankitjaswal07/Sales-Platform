/**
 * AI guardrails (§52).
 *
 * These run on every generated artefact before it reaches a user or a prospect.
 * They are deliberately conservative: it is better to strip a sentence than to
 * let the platform send an unverifiable claim about a real business.
 */

export interface GuardrailReport {
  flags: string[];
  /** Rewritten, safe text. */
  text: string;
  blocked: boolean;
}

/** Phrases that assert a measurement the platform cannot guarantee. */
const FABRICATION_PATTERNS: { pattern: RegExp; flag: string; replacement: string }[] = [
  { pattern: /\bwe (?:have )?(?:already )?(?:tested|audited|analysed) (?:your|this) (?:site|website) on \d+ devices\b/gi, flag: "unverified-method", replacement: "our checks reviewed this site" },
  { pattern: /\byour (?:site|website) (?:is|was) (?:ranked|positioned) (?:at|number)\s*#?\d+/gi, flag: "fabricated-ranking", replacement: "your current search visibility could be improved" },
  { pattern: /\byou (?:are|'re) losing (?:about |approximately |around )?£?[\d,]+/gi, flag: "fabricated-loss-figure", replacement: "enquiries are likely being lost" },
  { pattern: /\bguarantee(?:d)? (?:first[- ]page|#1|number one|top) ranking/gi, flag: "guaranteed-ranking", replacement: "improved search foundations" },
  { pattern: /\b(?:100%|fully) guaranteed results?\b/gi, flag: "guaranteed-results", replacement: "measurable improvement" },
  { pattern: /\b(?:we|our (?:ai|team|platform|system|software))?\s*(?:will|can|shall)?\s*guarantee(?:d|s)?\s*(?:you|us)?\s*/gi, flag: "guaranteed-outcome", replacement: "work towards " },
  { pattern: /\blimited[- ]time (?:offer|deal|discount)\b/gi, flag: "manufactured-urgency", replacement: "current availability" },
  { pattern: /\b(?:act|move|respond) (?:fast|quickly|now)\b/gi, flag: "manufactured-urgency", replacement: "get in touch" },
  { pattern: /\b\d+\s*% more (?:leads|customers|sales|revenue|traffic)\b/gi, flag: "unverifiable-projection", replacement: "more enquiries" },
  { pattern: /\b(?:we|our team) (?:found|discovered) (?:that )?you (?:don'?t|do not) have (?:any )?(?:customers|clients|reviews)\b/gi, flag: "fabricated-detail", replacement: "your public review presence could be strengthened" },
  { pattern: /\b(?:we )?(?:have|'ve) (?:already )?spoken (?:to|with) (?:your )?(?:team|staff|owner)\b/gi, flag: "fabricated-history", replacement: "we would welcome a conversation" },
  { pattern: /\b(?:act|respond) (?:now|immediately|today) or (?:the|this) (?:offer|price|slot) (?:expires|is gone)\b/gi, flag: "manufactured-urgency", replacement: "we have availability this month if you would like to talk" },
  { pattern: /\bonly \d+ (?:spots?|places?|slots?) (?:left|remaining)\b/gi, flag: "manufactured-scarcity", replacement: "" },
  { pattern: /\b(?:i am|i'?m) (?:a )?(?:real )?(?:human|person)\b/gi, flag: "human-impersonation", replacement: "I am an AI assistant for" },
  { pattern: /\b(?:our|my) (?:human )?(?:agent|team) (?:will|can) (?:call|contact) you (?:at|on) \d/gi, flag: "fabricated-specifics", replacement: "someone from the team can arrange a call at a time that suits you" },
];

const PII_PATTERNS: { pattern: RegExp; flag: string }[] = [
  { pattern: /\b(?:\d[ -]*?){13,19}\b/g, flag: "possible-payment-card" },
  { pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, flag: "possible-bank-account" },
  { pattern: /\b(?:passport|national insurance|social security)\s*(?:number|no\.?|:)\s*\S+/gi, flag: "possible-government-id" },
];

const GENERIC_FILLER = [
  "in today's fast-paced digital world",
  "in the modern digital landscape",
  "unlock your potential",
  "take your business to the next level",
  "we are a full-service agency",
  "cutting-edge solutions",
  "synergy",
  "game-changer",
];

export interface GuardrailOptions {
  /** Set false for internal-only text (e.g. an agent note). */
  applySalesRules?: boolean;
  /** Set false when the text legitimately needs urgency language (e.g. a hot-lead internal alert). */
  applyToneRules?: boolean;
}

export function applyGuardrails(input: string, options: GuardrailOptions = {}): GuardrailReport {
  const flags: string[] = [];
  let text = input ?? "";
  let blocked = false;

  FABRICATION_PATTERNS.forEach(({ pattern, flag, replacement }) => {
    if (pattern.test(text)) {
      flags.push(flag);
      text = text.replace(pattern, replacement);
      if (["human-impersonation", "guaranteed-ranking", "guaranteed-results"].includes(flag)) blocked = false;
    }
    pattern.lastIndex = 0;
  });

  PII_PATTERNS.forEach(({ pattern, flag }) => {
    if (pattern.test(text)) {
      flags.push(flag);
      text = text.replace(pattern, "[redacted]");
    }
    pattern.lastIndex = 0;
  });

  if (options.applyToneRules !== false) {
    GENERIC_FILLER.forEach((phrase) => {
      const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      if (pattern.test(text)) {
        flags.push("generic-filler");
        text = text.replace(pattern, "");
      }
    });
    text = text.replace(/\s{3,}/g, "  ").replace(/\n{3,}/g, "\n\n").trim();
  }

  return { flags: Array.from(new Set(flags)), text, blocked };
}

/**
 * Claims-traceability check.
 *
 * Every factual statement in an outbound artefact must be supported by an
 * evidence string produced by the audit engine. Statements that reference a
 * concrete measurement (a number, a percentage, a metric name) but cannot be
 * matched to evidence are flagged for human review rather than silently sent.
 */
export function verifyClaims(text: string, evidence: string[]): { unsupported: string[]; checkedClaims: number } {
  const unsupported: string[] = [];
  let checkedClaims = 0;
  const evidenceBlob = evidence.join(" \n ").toLowerCase();

  // Sentences that assert a measured property of the prospect's site.
  const claimSentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 24);

  claimSentences.forEach((sentence) => {
    const lower = sentence.toLowerCase();
    const assertsMeasurement =
      /\b\d+\s*(ms|kb|mb|%|seconds?|score|px)\b/.test(lower) ||
      /\b(no |missing |without )(meta description|viewport|h1|title tag|alt text|analytics|ssl|https|contact form|booking)\b/.test(lower) ||
      /\b(scores?|scoring) \d{1,3}\b/.test(lower) ||
      /\b\d+(?:\.\d+)?\s*(?:stars?|reviews?|ratings?|locations?|years?)\b/.test(lower);
    if (!assertsMeasurement) return;
    checkedClaims += 1;

    // Loose keyword overlap is enough: we are catching invention, not nuance.
    const keywords = Array.from(new Set(lower.match(/[a-z]{4,}/g) ?? [])).filter(
      (word) => !["your", "this", "that", "with", "have", "been", "from", "site", "website", "page"].includes(word),
    );
    const overlap = keywords.filter((word) => evidenceBlob.includes(word)).length;
    const ratio = keywords.length ? overlap / keywords.length : 0;
    if (ratio < 0.34) unsupported.push(sentence.slice(0, 180));
  });

  return { unsupported, checkedClaims };
}

/** Used for chat: refuse to emit anything resembling a threat or harassment. */
export function isAbusiveOrNonCompliant(text: string): { allowed: boolean; reason?: string } {
  const lower = text.toLowerCase();
  if (/(?:we will|we'll) (?:sue|report|take legal action|publish)/.test(lower)) {
    return { allowed: false, reason: "Threat language is never permitted in prospect communications." };
  }
  if (/(?:last chance|final warning|you must respond)/.test(lower)) {
    return { allowed: false, reason: "Coercive language violates the anti-harassment policy." };
  }
  if (/\b(?:your) (?:personal|home) address\b/.test(lower)) {
    return { allowed: false, reason: "Referencing personal contact details is prohibited." };
  }
  return { allowed: true };
}

export const GUARDRAIL_POLICY_SUMMARY = [
  "No fabricated business facts, contact details or audit findings.",
  "Every measured claim in outbound copy traces to a stored audit finding.",
  "No guaranteed rankings or unverifiable superlatives.",
  "No manufactured urgency or false scarcity.",
  "No impersonation of a human; AI identity is disclosed on request and in the first message.",
  "Opt-outs are honoured across all channels and suppress the whole business.",
  "Pricing is labelled as an internal estimate until a human approves it.",
];
