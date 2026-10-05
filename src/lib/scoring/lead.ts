import type { IntentLevel, Temperature } from "../types";
import { INTENT_META } from "../types";

/**
 * Lead, opportunity and priority scoring.
 *
 * Every factor is returned alongside the score so the UI can show *why* a lead
 * ranks where it does (§8, §71) and so nothing in the product is an unexplained
 * number. These functions are pure — they take data, they return a verdict.
 */

export interface BusinessInput {
  name: string;
  industry?: string | null;
  category?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  websiteUrl?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  employeeRange?: string | null;
  revenueRange?: string | null;
  yearsInBusiness?: number | null;
  socials?: Record<string, string> | null;
  hasDescription?: boolean;
  hours?: unknown[] | null;
}

export interface WebsiteInput {
  exists: boolean;
  reachable?: boolean;
  https?: boolean;
  scores?: {
    overall: number;
    performance: number;
    mobile: number;
    seo: number;
    ux: number;
    accessibility: number;
    conversion: number;
    technical: number;
    content?: number;
    trust?: number;
  } | null;
  cms?: string | null;
  copyrightYear?: number | null;
  findingsCount?: number;
  criticalFindings?: number;
  hasBooking?: boolean;
  hasForm?: boolean;
  hasAnalytics?: boolean;
}

export interface ContactInput {
  hasNamedContact: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  emailStatus?: string | null;
}

export interface ScoreFactor {
  label: string;
  detail: string;
  impact: "up" | "down" | "neutral";
  weight: number;
  contribution: number;
}

export interface LeadScoreResult {
  businessQuality: number;
  websiteOpportunity: number;
  buyingPotential: number;
  contactability: number;
  buyingIntent: number;
  total: number;
  temperature: Temperature;
  tier: "hot" | "warm" | "cold";
  factors: ScoreFactor[];
  reason: string;
  nextAction: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Industries where a modern website converts particularly well. */
const HIGH_VALUE_INDUSTRIES: Record<string, number> = {
  dental: 12,
  dentistry: 12,
  medical: 11,
  healthcare: 11,
  legal: 10,
  law: 10,
  "real estate": 10,
  construction: 9,
  hvac: 9,
  plumbing: 8,
  "home services": 8,
  automotive: 7,
  accounting: 7,
  "financial services": 7,
  landscaping: 6,
  cleaning: 6,
  "fitness": 6,
  beauty: 5,
  restaurant: 5,
  hospitality: 4,
  retail: 4,
  ecommerce: 8,
  manufacturing: 6,
  education: 5,
  veterinary: 9,
  architecture: 8,
  "interior design": 7,
  photography: 6,
  events: 5,
  "professional services": 7,
};

function industryDemand(industry?: string | null, category?: string | null): { score: number; label: string } {
  const haystack = `${industry ?? ""} ${category ?? ""}`.toLowerCase();
  let best = 0;
  let matched = "";
  Object.entries(HIGH_VALUE_INDUSTRIES).forEach(([key, value]) => {
    if (haystack.includes(key) && value > best) {
      best = value;
      matched = key;
    }
  });
  if (best === 0) return { score: 4, label: "general local services" };
  return { score: best, label: matched };
}

/* ══════════════════════════════════════════════════════════════════════════
   Business quality — "is this a real, established business worth pursuing?"
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreBusinessQuality(business: BusinessInput): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  let score = 44; // neutral baseline

  const rating = business.rating ?? null;
  const reviews = business.reviewCount ?? 0;

  if (rating !== null) {
    if (rating >= 4.6) {
      score += 14;
      factors.push({ label: "Outstanding public rating", detail: `${rating.toFixed(1)}★ average — reputation is a strong asset that a better website amplifies.`, impact: "up", weight: 14, contribution: 14 });
    } else if (rating >= 4.2) {
      score += 10;
      factors.push({ label: "Strong public rating", detail: `${rating.toFixed(1)}★ average from real customers.`, impact: "up", weight: 10, contribution: 10 });
    } else if (rating >= 3.6) {
      score += 4;
      factors.push({ label: "Acceptable public rating", detail: `${rating.toFixed(1)}★ average — room to improve perception.`, impact: "up", weight: 4, contribution: 4 });
    } else {
      score -= 8;
      factors.push({ label: "Weak public rating", detail: `${rating.toFixed(1)}★ average — the business may have underlying service issues that a website alone cannot fix.`, impact: "down", weight: -8, contribution: -8 });
    }
  } else {
    factors.push({ label: "No public rating found", detail: "No rating on the public listing, so business quality is estimated from other signals.", impact: "neutral", weight: 0, contribution: 0 });
  }

  if (reviews >= 200) {
    score += 18;
    factors.push({ label: "High review volume", detail: `${reviews} public reviews — a mature, established local presence with real demand.`, impact: "up", weight: 18, contribution: 18 });
  } else if (reviews >= 60) {
    score += 13;
    factors.push({ label: "Solid review volume", detail: `${reviews} public reviews — trading consistently with real customer flow.`, impact: "up", weight: 13, contribution: 13 });
  } else if (reviews >= 20) {
    score += 7;
    factors.push({ label: "Established review base", detail: `${reviews} public reviews — proven demand worth investing behind.`, impact: "up", weight: 7, contribution: 7 });
  } else if (reviews >= 5) {
    score += 2;
    factors.push({ label: "Small review base", detail: `${reviews} public reviews — smaller budget is likely.`, impact: "neutral", weight: 2, contribution: 2 });
  } else {
    score -= 6;
    factors.push({ label: "Almost no review history", detail: "Few to no public reviews, which usually means either a very new or a low-volume business.", impact: "down", weight: -6, contribution: -6 });
  }

  const demand = industryDemand(business.industry, business.category);
  score += demand.score;
  factors.push({
    label: "Category commercial value",
    detail: `Categorised as ${demand.label} — a sector where a conversion-focused site typically returns strongly.`,
    impact: demand.score >= 6 ? "up" : "neutral",
    weight: demand.score,
    contribution: demand.score,
  });

  if (business.yearsInBusiness && business.yearsInBusiness >= 10) {
    score += 6;
    factors.push({ label: "Long-established business", detail: `Trading approximately ${business.yearsInBusiness} years — cashflow and reputation to invest in growth.`, impact: "up", weight: 6, contribution: 6 });
  }

  const sizeBonus =
    business.employeeRange === "50-200" ? 8 : business.employeeRange === "10-49" ? 6 : business.employeeRange === "5-9" ? 4 : 0;
  if (sizeBonus) {
    score += sizeBonus;
    factors.push({ label: "Team size suggests real budget", detail: `${business.employeeRange} employees — larger projects become viable.`, impact: "up", weight: sizeBonus, contribution: sizeBonus });
  }

  if (business.hasDescription) {
    score += 2;
  }

  if (business.socials && Object.keys(business.socials).length >= 2) {
    score += 3;
    factors.push({ label: "Active on social channels", detail: "Links to multiple social profiles — the business already invests time in its online presence.", impact: "up", weight: 3, contribution: 3 });
  }

  if ((business.hours?.length ?? 0) > 0) score += 2;

  return { score: clamp(score), factors };
}

/* ══════════════════════════════════════════════════════════════════════════
   Website opportunity — "how much would a new site change their outcome?"
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreWebsiteOpportunity(website: WebsiteInput): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];

  if (!website.exists) {
    factors.push({
      label: "No website at all",
      detail: "The business is trading on directory listings and word of mouth alone — every search-driven enquiry currently goes to a competitor.",
      impact: "up",
      weight: 34,
      contribution: 34,
    });
    const withPresence = 40;
    return { score: clamp(58 + withPresence), factors };
  }

  let score = 30;
  const s = website.scores;

  if (!website.reachable) {
    factors.push({
      label: "Website does not load",
      detail: "The site is currently unreachable, so any traffic it receives is lost entirely.",
      impact: "up",
      weight: 30,
      contribution: 30,
    });
    score = 88;
    return { score: clamp(score), factors };
  }

  if (!s) {
    return { score: 55, factors: [{ label: "Not yet audited", detail: "Run a full audit to quantify this opportunity precisely.", impact: "neutral", weight: 0, contribution: 0 }] };
  }

  const invert = (value: number) => 100 - value;

  const overallGap = invert(s.overall) * 0.34;
  score += overallGap;
  factors.push({
    label: `Overall website score ${s.overall}/100`,
    detail:
      s.overall < 40
        ? "The site scores in the bottom band across most dimensions — a rebuild is likely cheaper and faster than incremental fixes."
        : s.overall < 60
          ? "Meaningful weaknesses across several dimensions that a redesign would address together."
          : "The site is functional; the opportunity is refinement rather than rebuild.",
    impact: s.overall < 55 ? "up" : "down",
    weight: Math.round(overallGap),
    contribution: Math.round(overallGap),
  });

  const conversionGap = invert(s.conversion) * 0.2;
  score += conversionGap;
  if (s.conversion < 55) {
    factors.push({
      label: `Conversion score ${s.conversion}/100`,
      detail: "Visitors are not being guided to enquire. This is the cheapest category of improvement to justify commercially.",
      impact: "up",
      weight: Math.round(conversionGap),
      contribution: Math.round(conversionGap),
    });
  }

  const mobileGap = invert(s.mobile) * 0.16;
  score += mobileGap;
  if (s.mobile < 60) {
    factors.push({
      label: `Mobile score ${s.mobile}/100`,
      detail: "Most local searches happen on a phone, so mobile defects directly suppress enquiries.",
      impact: "up",
      weight: Math.round(mobileGap),
      contribution: Math.round(mobileGap),
    });
  }

  const seoGap = invert(s.seo) * 0.1;
  score += seoGap;

  const perfGap = invert(s.performance) * 0.08;
  score += perfGap;

  const uxGap = invert(s.ux) * 0.06;
  score += uxGap;

  if (website.copyrightYear && website.copyrightYear <= new Date().getFullYear() - 3) {
    score += 6;
    factors.push({
      label: `Looks abandoned (© ${website.copyrightYear})`,
      detail: "An out-of-date copyright line is the clearest public signal that the site has been left to decay.",
      impact: "up",
      weight: 6,
      contribution: 6,
    });
  }

  if (website.criticalFindings && website.criticalFindings > 0) {
    const bonus = Math.min(10, website.criticalFindings * 3);
    score += bonus;
    factors.push({
      label: `${website.criticalFindings} critical issue(s) found`,
      detail: "Critical-severity findings from the audit give you concrete, evidence-backed talking points.",
      impact: "up",
      weight: bonus,
      contribution: bonus,
    });
  }

  if (website.hasBooking === false) {
    score += 5;
    factors.push({ label: "No online booking", detail: "Enquiries that arrive outside opening hours have nowhere to land.", impact: "up", weight: 5, contribution: 5 });
  }
  if (website.hasForm === false) {
    score += 4;
  }
  if (website.hasAnalytics === false) {
    factors.push({ label: "No analytics installed", detail: "The owner cannot see what works — which makes a measurement-led redesign easy to sell.", impact: "up", weight: 2, contribution: 2 });
    score += 2;
  }

  if (s.overall >= 78) {
    score -= 12;
    factors.push({ label: "Already a strong site", detail: "The site performs well; displacement is difficult and the pitch should focus on conversion gains.", impact: "down", weight: -12, contribution: -12 });
  }

  const datedPlatform = /Wix|GoDaddy|Weebly|Squarespace|Joomla|Drupal|Elementor/i.test(website.cms ?? "");
  if (datedPlatform) {
    factors.push({
      label: `Platform: ${website.cms}`,
      detail: "This platform is often the root cause of speed and mobile limitations, which makes a platform move a natural part of the proposal.",
      impact: "up",
      weight: 3,
      contribution: 3,
    });
    score += 3;
  }

  return { score: clamp(score), factors };
}

/* ══════════════════════════════════════════════════════════════════════════
   Buying potential — "are they likely to say yes, and soon?"
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreBuyingPotential(business: BusinessInput, website: WebsiteInput, intent: IntentLevel = "unknown"): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  let score = 42;

  const demand = industryDemand(business.industry, business.category);
  score += Math.round(demand.score * 0.9);
  factors.push({
    label: "Sector urgency",
    detail: `${demand.label} businesses typically compete on being found and trusted online, which makes website investment a high priority.`,
    impact: demand.score >= 6 ? "up" : "neutral",
    weight: Math.round(demand.score * 0.9),
    contribution: Math.round(demand.score * 0.9),
  });

  const reviews = business.reviewCount ?? 0;
  if (reviews >= 100) {
    score += 12;
    factors.push({ label: "High transaction volume", detail: `${reviews} reviews implies steady customer flow and the cashflow to fund a project.`, impact: "up", weight: 12, contribution: 12 });
  } else if (reviews >= 30) {
    score += 7;
    factors.push({ label: "Established customer flow", detail: `${reviews} reviews indicates an operating business with marketing budget.`, impact: "up", weight: 7, contribution: 7 });
  }

  if (business.employeeRange && ["10-49", "50-200", "200+"].includes(business.employeeRange)) {
    score += 8;
    factors.push({ label: "Business size implies budget", detail: `${business.employeeRange} employees — website spend is a normal operating line item at this size.`, impact: "up", weight: 8, contribution: 8 });
  }

  if (website.exists && !website.hasBooking) {
    score += 5;
  }

  const intentScore = INTENT_META[intent]?.score ?? 0;
  if (intentScore > 0) {
    const contribution = Math.round(intentScore * 0.34);
    score += contribution;
    factors.push({
      label: `Observed intent: ${INTENT_META[intent]?.label ?? intent}`,
      detail: "Direct engagement with our outreach is the strongest available predictor of a purchase.",
      impact: contribution > 10 ? "up" : "neutral",
      weight: contribution,
      contribution,
    });
  }

  if (!business.email && !business.phone) {
    score -= 15;
    factors.push({ label: "No public contact route", detail: "Without a public phone or email, reaching a decision-maker is hard regardless of fit.", impact: "down", weight: -15, contribution: -15 });
  }

  return { score: clamp(score), factors };
}

/* ══════════════════════════════════════════════════════════════════════════
   Contactability — "can we actually reach the decision maker?"
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreContactability(business: BusinessInput, contact: ContactInput): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  let score = 12;

  if (contact.hasPhone || business.phone) {
    score += 26;
    factors.push({ label: "Public phone number available", detail: contact.phoneVerified ? "Verified publicly listed number." : "Publicly listed number (verify before calling).", impact: "up", weight: 26, contribution: 26 });
  }
  if (contact.hasEmail || business.email) {
    score += 24;
    factors.push({
      label: "Public email address available",
      detail: contact.emailStatus === "verified" ? "Verified deliverable address." : contact.emailStatus === "risky" ? "Address looks valid but deliverability is uncertain." : "Address not yet verified — validate before bulk sending.",
      impact: "up",
      weight: 24,
      contribution: 24,
    });
  }
  if (contact.hasNamedContact) {
    score += 20;
    factors.push({ label: "Named decision-maker identified", detail: "Outreach addressed to a person consistently outperforms 'Dear Sir/Madam'.", impact: "up", weight: 20, contribution: 20 });
  }
  if (business.websiteUrl) {
    score += 12;
    factors.push({ label: "Website contact page reachable", detail: "A website suggests at least one monitored contact channel.", impact: "up", weight: 12, contribution: 12 });
  }
  if (business.hours && business.hours.length > 0) score += 3;
  if (contact.emailVerified) score += 5;

  if (!contact.hasEmail && !business.email) {
    factors.push({ label: "No email address", detail: "Email outreach is unavailable; use phone or a website contact form instead.", impact: "down", weight: 0, contribution: 0 });
  }

  return { score: clamp(score), factors };
}

/* ══════════════════════════════════════════════════════════════════════════
   Aggregate lead score
   ══════════════════════════════════════════════════════════════════════════ */

export interface LeadScoreWeights {
  businessQuality: number;
  websiteOpportunity: number;
  buyingPotential: number;
  contactability: number;
  buyingIntent: number;
}

export const DEFAULT_LEAD_WEIGHTS: LeadScoreWeights = {
  businessQuality: 0.24,
  websiteOpportunity: 0.3,
  buyingPotential: 0.2,
  contactability: 0.14,
  buyingIntent: 0.12,
};

export function computeLeadScore(
  business: BusinessInput,
  website: WebsiteInput,
  contact: ContactInput,
  options: { intent?: IntentLevel; weights?: Partial<LeadScoreWeights> } = {},
): LeadScoreResult {
  const weights = { ...DEFAULT_LEAD_WEIGHTS, ...options.weights };
  const intent = options.intent ?? "unknown";

  const bq = scoreBusinessQuality(business);
  const wo = scoreWebsiteOpportunity(website);
  const bp = scoreBuyingPotential(business, website, intent);
  const ca = scoreContactability(business, contact);
  const buyingIntent = INTENT_META[intent]?.score ?? 0;

  const totalWeight =
    weights.businessQuality + weights.websiteOpportunity + weights.buyingPotential + weights.contactability + weights.buyingIntent;

  const total = clamp(
    (bq.score * weights.businessQuality +
      wo.score * weights.websiteOpportunity +
      bp.score * weights.buyingPotential +
      ca.score * weights.contactability +
      buyingIntent * weights.buyingIntent) /
      totalWeight,
  );

  const factors = [...bq.factors, ...wo.factors, ...bp.factors, ...ca.factors].sort((a, b) => b.contribution - a.contribution);

  const temperature: Temperature = total >= 78 && wo.score >= 65 ? "hot" : total >= 58 ? "warm" : "cold";

  const strongest = factors.find((f) => f.contribution > 0);
  const weakest = [...factors].reverse().find((f) => f.contribution < 0);

  return {
    businessQuality: bq.score,
    websiteOpportunity: wo.score,
    buyingPotential: bp.score,
    contactability: ca.score,
    buyingIntent,
    total,
    temperature,
    tier: temperature,
    factors,
    reason: buildReason(business.name, temperature, strongest, weakest, wo.score, bq.score),
    nextAction: recommendNextAction({ temperature, website: wo.score, contact, intent, total }),
  };
}

function buildReason(
  name: string,
  temperature: Temperature,
  strongest: ScoreFactor | undefined,
  weakest: ScoreFactor | undefined,
  websiteScore: number,
  businessScore: number,
): string {
  const opener =
    temperature === "hot"
      ? `${name} is a high-priority prospect.`
      : temperature === "warm"
        ? `${name} is a solid prospect worth pursuing.`
        : `${name} is a lower-priority prospect right now.`;

  const parts: string[] = [opener];
  if (strongest) parts.push(strongest.detail);
  if (websiteScore >= 70) parts.push("The website gap is large enough that a rebuild is easy to justify commercially.");
  if (businessScore >= 75) parts.push("The underlying business is strong, so a better site has real upside to amplify.");
  if (weakest) parts.push(`Main caution: ${weakest.detail}`);
  return parts.join(" ");
}

function recommendNextAction(input: {
  temperature: Temperature;
  website: number;
  contact: ContactInput;
  intent: IntentLevel;
  total: number;
}): string {
  if (input.intent === "ready_to_start") return "Call now — prospect has said they are ready to begin. Confirm scope and send the proposal for signature.";
  if (input.intent === "wants_call") return "Call within 15 minutes — they explicitly asked for a call.";
  if (input.intent === "wants_pricing" || input.intent === "wants_demo") return "Send the tailored proposal, then follow up by phone within 24 hours.";
  if (input.intent === "high_intent") return "Send the personalised proposal and book a 20-minute review call.";
  if (input.temperature === "hot") {
    return input.contact.hasEmail
      ? "Send the audit-based outreach email, then call 2 days later if there is no reply."
      : "No email on file — call the business directly and reference the specific website findings.";
  }
  if (input.temperature === "warm") return "Run a full audit, then send a personalised email referencing one concrete finding.";
  return "Add to a nurture campaign — revisit when you have capacity for lower-probability outreach.";
}

/* ══════════════════════════════════════════════════════════════════════════
   Project value estimation (§32) — heuristic range, always overridable
   ══════════════════════════════════════════════════════════════════════════ */

export interface ProjectScopeInput {
  newBuild: boolean;
  pages: number;
  ecommerce: boolean;
  booking: boolean;
  customFunctionality: boolean;
  copywriting: boolean;
  seo: boolean;
  brandRefresh: boolean;
  cms: boolean;
  designComplexity: "simple" | "standard" | "premium" | "bespoke";
  businessSize: "micro" | "small" | "medium" | "large";
  currency?: string;
}

export interface ProjectValueEstimate {
  low: number;
  mid: number;
  high: number;
  currency: string;
  timelineWeeksLow: number;
  timelineWeeksHigh: number;
  drivers: { label: string; impact: "up" | "down" | "neutral"; note: string }[];
  monthlyRetainer: number;
}

const BASE_BUILD: Record<ProjectScopeInput["designComplexity"], number> = {
  simple: 1400,
  standard: 2600,
  premium: 4800,
  bespoke: 8200,
};

const SIZE_MULTIPLIER: Record<ProjectScopeInput["businessSize"], number> = {
  micro: 0.85,
  small: 1,
  medium: 1.35,
  large: 1.8,
};

export function estimateProjectValue(input: ProjectScopeInput): ProjectValueEstimate {
  const drivers: ProjectValueEstimate["drivers"] = [];
  const currency = input.currency ?? "GBP";
  const baseline = input.newBuild ? BASE_BUILD[input.designComplexity] : BASE_BUILD[input.designComplexity] * 0.82;

  drivers.push({
    label: `${input.newBuild ? "New build" : "Redesign"} · ${input.designComplexity} design`,
    impact: "neutral",
    note: `Baseline ${currency} ${Math.round(baseline).toLocaleString()} for ${input.designComplexity} design work.`,
  });

  let total = baseline;
  let weeksLow = 2;
  let weeksHigh = 5;

  const extraPages = Math.max(0, input.pages - 5);
  if (extraPages > 0) {
    const cost = extraPages * (input.designComplexity === "simple" ? 120 : input.designComplexity === "standard" ? 220 : 340);
    total += cost;
    weeksHigh += Math.ceil(extraPages / 3);
    drivers.push({ label: `${extraPages} pages beyond the 5-page template`, impact: "up", note: `Adds ${currency} ${cost.toLocaleString()} of build and content work.` });
  }
  if (input.pages <= 5) weeksLow = 1;

  if (input.ecommerce) {
    total += 3200;
    weeksHigh += 4;
    drivers.push({ label: "E-commerce", impact: "up", note: "Product catalogue, checkout, payment and fulfilment configuration." });
  }
  if (input.booking) {
    total += 1400;
    weeksHigh += 2;
    drivers.push({ label: "Booking / appointment system", impact: "up", note: "Scheduling, notifications and calendar integration." });
  }
  if (input.customFunctionality) {
    total += 2600;
    weeksHigh += 4;
    drivers.push({ label: "Custom functionality", impact: "up", note: "Quoting tools, portals or integrations require bespoke development." });
  }
  if (input.copywriting) {
    total += 900;
    weeksHigh += 1;
    drivers.push({ label: "Copywriting", impact: "up", note: "Conversion-focused copy for every recommended page." });
  }
  if (input.seo) {
    total += 1100;
    weeksHigh += 1;
    drivers.push({ label: "Technical + local SEO", impact: "up", note: "Schema, metadata, Google Business Profile alignment, speed work." });
  }
  if (input.brandRefresh) {
    total += 1200;
    weeksHigh += 1;
    drivers.push({ label: "Brand refresh", impact: "up", note: "Logo cleanup, palette, type system and brand guidelines." });
  }
  if (input.cms) {
    total += 450;
    drivers.push({ label: "Editable CMS", impact: "up", note: "The client can update their own content after launch." });
  }

  const sizeMultiplier = SIZE_MULTIPLIER[input.businessSize];
  if (sizeMultiplier !== 1) {
    total *= sizeMultiplier;
    drivers.push({
      label: `${input.businessSize} business`,
      impact: sizeMultiplier > 1 ? "up" : "down",
      note: `Complexity and approval tempo adjusted by ${Math.round((sizeMultiplier - 1) * 100)}%.`,
    });
  }

  const mid = Math.round(total);
  const low = Math.round((mid * 0.82) / 50) * 50;
  const high = Math.round((mid * 1.28) / 50) * 50;
  const monthlyRetainer = Math.round((mid * 0.055) / 5) * 5;

  return {
    low,
    mid,
    high,
    currency,
    timelineWeeksLow: Math.max(1, weeksLow),
    timelineWeeksHigh: Math.max(weeksLow + 1, weeksHigh),
    drivers,
    monthlyRetainer,
  };
}
