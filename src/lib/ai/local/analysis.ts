import type { AuditFinding } from "../../types";
import type { BusinessAnalysis, AIFeatureContext } from "../types";
import { industryProfile, industryKeywords } from "./industry";

/**
 * Deterministic business analysis (§8).
 *
 * Reads measured findings and produces a structured, defensible analysis. Every
 * `mainProblems` entry carries an `evidenceRef` pointing at the finding it came
 * from, so the UI can show the receipt next to the claim.
 */

export function localBusinessAnalysis(ctx: AIFeatureContext): BusinessAnalysis {
  const profile = industryProfile(ctx.industry, null);
  const findings = ctx.findings ?? [];
  const negative = findings.filter((f) => f.severity !== "positive");
  const critical = negative.filter((f) => f.severity === "critical");
  const high = negative.filter((f) => f.severity === "high");
  const scores = ctx.scores ?? {};
  const hasWebsite = Boolean(ctx.websiteUrl);
  const overall = scores.overall ?? null;

  const reviewCount = ctx.reviewCount ?? 0;
  const rating = ctx.rating ?? null;
  const locality = ctx.city ?? "the local area";

  /* ── verified facts (nothing here is invented) ── */
  const verifiedFacts: string[] = [];
  if (ctx.websiteUrl) verifiedFacts.push(`Public website: ${ctx.websiteUrl}`);
  else verifiedFacts.push("No public website found for this business.");
  if (rating !== null) verifiedFacts.push(`Public rating ${rating.toFixed(1)}★ across ${reviewCount} reviews.`);
  else if (reviewCount) verifiedFacts.push(`${reviewCount} public reviews found; no aggregate rating displayed.`);
  if (overall !== null) verifiedFacts.push(`Measured website score ${overall}/100 (${ctx.cms ? `platform: ${ctx.cms}` : "platform not identified"}).`);
  critical.slice(0, 3).forEach((f) => verifiedFacts.push(`Critical finding: ${f.title} — ${f.evidence}`));

  /* ── business strengths ── */
  const businessStrengths: string[] = [];
  if (rating !== null && rating >= 4.2) businessStrengths.push(`Strong reputation: ${rating.toFixed(1)}★ average from ${reviewCount} public reviews.`);
  if (reviewCount >= 50) businessStrengths.push(`${reviewCount} verified public reviews indicate consistent, real customer demand.`);
  else if (reviewCount >= 15) businessStrengths.push(`${reviewCount} public reviews show an active, trading business.`);
  if (ctx.industry) businessStrengths.push(`Operates in ${profile.label.toLowerCase()} — a sector where buyers research online before making contact.`);
  if (ctx.city) businessStrengths.push(`Established local presence in ${ctx.city}, which makes local search visibility directly monetisable.`);
  if (businessStrengths.length === 0) businessStrengths.push("Public listing indicates an operating business with contactable details.");

  /* ── website weaknesses (each mapped to measured evidence) ── */
  const websiteWeaknesses = negative.slice(0, 6).map((f) => `${f.title} — measured: ${f.evidence}`);

  /* ── main problems ── */
  const mainProblems: BusinessAnalysis["mainProblems"] = negative.slice(0, 6).map((f) => ({
    title: f.title,
    detail: f.detail,
    severity: (f.severity === "positive" ? "low" : f.severity) as "critical" | "high" | "medium" | "low",
    evidenceRef: f.id,
  }));

  if (!hasWebsite) {
    mainProblems.unshift({
      title: "No website — every search-driven enquiry is going elsewhere",
      detail: `${profile.label} buyers in ${locality} search online before they call. Without a website the business is invisible at exactly the moment of intent, and only appears through third-party directories where it competes on someone else's terms.`,
      severity: "critical",
      evidenceRef: undefined,
    });
  }

  /* ── recommended improvements ── */
  const recommendedImprovements = buildImprovements(negative, profile, locality, hasWebsite);

  /* ── structure ── */
  const suggestedStructure = hasWebsite ? profile.mustHaveSections.slice(0, 8) : profile.mustHaveSections.slice(0, 9);

  /* ── complexity ── */
  const pageEstimate = hasWebsite ? (overall !== null && overall < 45 ? 9 : 7) : 7;
  const complexityLevel: BusinessAnalysis["estimatedComplexity"]["level"] =
    profile.key === "ecommerce" ? "premium" : pageEstimate >= 9 || profile.optionalFeatures.length > 4 ? "premium" : "standard";

  const timelineWeeks: [number, number] =
    complexityLevel === "premium" ? [5, 9] : complexityLevel === "standard" ? [3, 6] : [2, 4];

  /* ── objections & pre-emptive responses ── */
  const objections = buildObjections(ctx, profile, overall);

  /* ── talking points ── */
  const talkingPoints = buildTalkingPoints(ctx, profile, negative, locality, hasWebsite);

  /* ── summary ── */
  const opportunitySummary = buildOpportunitySummary(ctx, profile, {
    hasWebsite,
    overall,
    rating,
    reviewCount,
    critical: critical.length,
    high: high.length,
    locality,
  });

  const whyTheyAreAClient = buildWhyClient(ctx, profile, { hasWebsite, overall, reviewCount, rating, critical: critical.length, locality });

  const aiInterpretation = [
    "Judgement: a conversion-led rebuild is the highest-leverage investment this business can make in its online presence.",
    `Judgement: the ${profile.label.toLowerCase()} buying cycle rewards trust signals and instant booking — both of which the current presence handles poorly.`,
    "Judgement: pricing should be positioned against the value of the additional enquiries, not against the cost of the build.",
  ];

  const confidence = computeConfidence(findings.length, overall !== null, reviewCount);

  return {
    opportunitySummary,
    whyTheyAreAClient: whyTheyAreAClient,
    mainProblems,
    businessStrengths,
    websiteWeaknesses: websiteWeaknesses.length ? websiteWeaknesses : ["No website audit findings recorded yet — run a full audit to quantify weaknesses."],
    recommendedImprovements,
    suggestedStructure,
    suggestedCta: {
      primary: profile.primaryCta,
      secondary: profile.secondaryCta,
      placement: ["Header (persistent)", "Hero", "Mid-page after proof", "Sticky mobile bar", "Footer"],
    },
    suggestedDesignStyle: profile.designStyle,
    suggestedFeatures: [
      ...profile.mustHaveFeatures.slice(0, 5).map((name) => ({
        name,
        reason: `Essential for ${profile.label.toLowerCase()} — directly enables "${profile.primaryConversions[0]}".`,
        priority: "must" as const,
      })),
      ...profile.optionalFeatures.slice(0, 3).map((name) => ({
        name,
        reason: `Increases conversion and repeat business for ${profile.label.toLowerCase()} businesses.`,
        priority: "should" as const,
      })),
    ],
    estimatedComplexity: {
      level: complexityLevel,
      rationale: buildComplexityRationale(pageEstimate, profile, complexityLevel),
      timelineWeeks,
    },
    talkingPoints,
    objections,
    confidence,
    verifiedFacts,
    aiInterpretation,
    generatedBy: "local_engine",
  };
}

function buildOpportunitySummary(
  ctx: AIFeatureContext,
  profile: ReturnType<typeof industryProfile>,
  data: { hasWebsite: boolean; overall: number | null; rating: number | null; reviewCount: number; critical: number; high: number; locality: string },
): string {
  const name = ctx.businessName;
  const reputation =
    data.rating !== null && data.rating >= 4.2
      ? `an established local reputation (${data.rating.toFixed(1)}★ from ${data.reviewCount} public reviews)`
      : data.reviewCount >= 20
        ? `a track record of ${data.reviewCount} public reviews`
        : "an operating local presence";

  if (!data.hasWebsite) {
    return `${name} has ${reputation} but no website at all. ${profile.customerIntent} Every prospective customer who searches for ${profile.keywords[0]?.replace(/\{city\}/g, data.locality) ?? "these services"} currently lands on a competitor or a directory listing that ranks above them. A focused, conversion-led website would give the business a direct channel for the demand it has already earned — and would convert that reputation into enquiries rather than impressions.`;
  }

  const scoreText = data.overall !== null ? `its website scores ${data.overall}/100` : "its website has not been scored yet";
  const problemText =
    data.critical > 0
      ? `It carries ${data.critical} critical issue${data.critical === 1 ? "" : "s"}${data.high ? ` and ${data.high} high-severity issue${data.high === 1 ? "" : "s"}` : ""}.`
      : data.high > 0
        ? `It carries ${data.high} high-severity issue${data.high === 1 ? "" : "s"}.`
        : "It carries a number of improvable weaknesses.";

  return `${name} has ${reputation}, but ${scoreText}. ${problemText} ${profile.customerIntent.replace("The ", "The ")} A modern, conversion-focused rebuild would fix the measurable defects, restore credibility at the moment of comparison, and turn existing reputation into booked enquiries — the commercial case rests on conversion improvement rather than on more traffic.`;
}

function buildWhyClient(
  ctx: AIFeatureContext,
  profile: ReturnType<typeof industryProfile>,
  data: { hasWebsite: boolean; overall: number | null; reviewCount: number; rating: number | null; critical: number; locality: string },
): string {
  const reasons: string[] = [];
  if (!data.hasWebsite) reasons.push("they have no website at all, so there is nothing to migrate and no incumbent supplier relationship to displace");
  else if (data.overall !== null && data.overall < 50) reasons.push(`their site scores only ${data.overall}/100, meaning a rebuild will be cheaper and faster than incrementally repairing the existing one`);
  else if (data.overall !== null && data.overall < 70) reasons.push(`their site scores ${data.overall}/100, so targeted conversion and performance work is easy to justify commercially`);

  if (data.reviewCount >= 30 && (data.rating ?? 0) >= 4) reasons.push(`they have earned ${data.reviewCount} public reviews — reputation that is currently under-monetised online`);
  reasons.push(`${profile.label.toLowerCase()} customers research before they buy, so website quality maps directly onto revenue`);
  reasons.push(`${profile.businessOutcome.toLowerCase()}`);
  if (data.critical > 0) reasons.push(`the audit surfaced ${data.critical} critical, verifiable issue${data.critical === 1 ? "" : "s"} you can reference in the first email`);

  return reasons.map((r, i) => `${i + 1}. ${r.charAt(0).toUpperCase()}${r.slice(1)}.`).join(" ");
}

function buildImprovements(
  findings: AuditFinding[],
  profile: ReturnType<typeof industryProfile>,
  locality: string,
  hasWebsite: boolean,
): { title: string; detail: string; impact: string }[] {
  const improvements = findings.slice(0, 5).map((f) => ({
    title: f.recommendation,
    detail: f.detail,
    impact: f.impact,
  }));

  if (!hasWebsite) {
    improvements.unshift({
      title: `Build a conversion-focused ${profile.label.toLowerCase()} website`,
      detail: `A ${profile.mustHaveSections.length}-section site structured around how ${profile.label.toLowerCase()} customers actually decide: proof first, then services, then an obvious way to enquire.`,
      impact: `Direct capture of enquiries that currently go to competitors ranking in ${locality}.`,
    });
  }

  const evergreen = [
    {
      title: `Persistent "${profile.primaryCta}" primary action`,
      detail: "One dominant, outcome-led call to action repeated in the header, hero, after the proof section and in a sticky mobile bar.",
      impact: "The single highest-leverage conversion change on any service website.",
    },
    {
      title: `Show the trust signals ${profile.label.toLowerCase()} buyers look for`,
      detail: `Prominently display: ${profile.trustSignals.slice(0, 3).join("; ")}.`,
      impact: "Reduces the perceived risk of making contact with an unfamiliar local business.",
    },
    {
      title: "Capture enquiries outside opening hours",
      detail: `Add ${profile.mustHaveFeatures.filter((f) => /booking|quote|enquiry|form/i.test(f)).slice(0, 2).join(" and ") || "an enquiry form"} so the site works at 10pm as well as 10am.`,
      impact: "A meaningful share of local service enquiries happen outside business hours.",
    },
    {
      title: `Build local search foundations for ${locality}`,
      detail: "Structured data, location landing pages, Google Business Profile alignment and honest, specific service copy.",
      impact: "Higher visibility for the exact searches that precede a purchase.",
    },
    {
      title: "Instrument the site so results are provable",
      detail: "Privacy-respecting analytics with conversion events on every enquiry path, plus a simple monthly reporting view.",
      impact: "Lets the business see the return on the rebuild in enquiries, not opinions.",
    },
  ];

  return [...improvements, ...evergreen].slice(0, 6);
}

function buildObjections(
  ctx: AIFeatureContext,
  profile: ReturnType<typeof industryProfile>,
  overall: number | null,
): { objection: string; response: string }[] {
  const objections = [
    {
      objection: "We already have a website.",
      response: `The audit found specific, measurable issues: ${overall !== null ? `the site scores ${overall}/100 across performance, mobile, SEO and conversion` : "significant gaps in mobile usability, conversion paths and search fundamentals"}. The question is not whether a site exists, but whether it produces enquiries at the rate the business deserves.`,
    },
    {
      objection: "We get all our work through word of mouth.",
      response: "Word of mouth still ends with someone searching for you before they call. If what they find looks dated or is hard to use on a phone, the referral weakens at the final step. A better site protects the referrals you already earn.",
    },
    {
      objection: "We don't have the budget right now.",
      response: "That is a fair position. We can phase the work: fix conversion and mobile first, then extend into SEO and content over subsequent months. Most clients fund later phases from the enquiries the first phase generates.",
    },
    {
      objection: "We tried an agency before and it didn't work.",
      response: "The most common cause is a design-led build with no measurement attached. Every engagement starts with the audit findings, and success is measured on enquiry volume, not on how the homepage looks.",
    },
  ];
  if (profile.key === "ecommerce") {
    objections.push({
      objection: "We already sell through a marketplace.",
      response: "Marketplaces charge commission on every order and own the customer relationship. A direct store lets you build a customer list, raise average order value with bundles, and keep the margin you are currently giving away.",
    });
  }
  if (ctx.reviewCount && ctx.reviewCount > 40) {
    objections.push({
      objection: "Our Google listing already brings us enough work.",
      response: "That is a strong position to build from. A website converts a share of that visibility that a listing alone cannot — and it captures the visitors who want detail, pricing guidance and proof before they call.",
    });
  }
  return objections;
}

function buildTalkingPoints(
  ctx: AIFeatureContext,
  profile: ReturnType<typeof industryProfile>,
  findings: AuditFinding[],
  locality: string,
  hasWebsite: boolean,
): string[] {
  const points: string[] = [];
  findings.slice(0, 3).forEach((f) => points.push(`Reference the measured finding: "${f.title}" (${f.evidence}).`));
  if (!hasWebsite) points.push(`No website exists — ${profile.customerIntent}`);
  points.push(`Lead with their reputation: ${ctx.rating ? `${ctx.rating.toFixed(1)}★ across ${ctx.reviewCount ?? 0} reviews` : `${ctx.reviewCount ?? 0} public reviews`} deserves a site that matches it.`);
  points.push(`Name the buyer intent: customers search "${industryKeywords(profile, ctx.city)[0]}".`);
  points.push(`Be specific about the outcome: ${profile.businessOutcome.toLowerCase()}`);
  points.push(`Offer the low-commitment next step: a 15-minute call to walk through the findings, no obligation.`);
  return points;
}

function buildComplexityRationale(pageCount: number, profile: ReturnType<typeof industryProfile>, level: string): string {
  const parts = [`Approximately ${pageCount} pages recommended across ${profile.mustHaveSections.length} core sections.`];
  if (profile.key === "ecommerce") parts.push("E-commerce functionality adds catalogue, payments and fulfilment configuration.");
  if (profile.mustHaveFeatures.some((f) => /booking/i.test(f))) parts.push("Online booking requires scheduling configuration and calendar integration.");
  parts.push(
    level === "premium"
      ? "Custom design, bespoke content and integration work justify a premium scope."
      : level === "standard"
        ? "A standard professional build covers the requirement without bespoke development."
        : "A focused single-page or small multi-page build is sufficient.",
  );
  return parts.join(" ");
}

function computeConfidence(findingCount: number, hasScores: boolean, reviewCount: number): number {
  let confidence = 55;
  if (hasScores) confidence += 22;
  confidence += Math.min(12, findingCount * 2);
  if (reviewCount > 20) confidence += 6;
  if (reviewCount > 100) confidence += 5;
  return Math.min(96, confidence);
}
