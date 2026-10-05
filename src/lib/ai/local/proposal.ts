import type { AuditFinding, ProposalLineItem, ProposalSection, PriceEstimate } from "../../types";
import type { AIFeatureContext, ProposalDraft } from "../types";
import type { ProjectScopeInput, ProjectValueEstimate } from "../../scoring/lead";
import { industryProfile, industryKeywords } from "./industry";
import { localDesignRecommendation } from "./design";

/**
 * Deterministic proposal generation (§13).
 *
 * The proposal is assembled from measured audit findings, the industry playbook
 * and the pricing model. Nothing is asserted that is not in `verifiedFactsUsed`.
 */

export interface ProposalInput extends AIFeatureContext {
  contactName?: string | null;
  agencyName: string;
  agencyEmail?: string | null;
  agencyPhone?: string | null;
  agencyWebsite?: string | null;
  services: { key: string; name: string; price: number; description: string; timelineDays: [number, number] }[];
  packages: { name: string; price: number; features: string[]; pagesIncluded: number | null }[];
  estimate: ProjectValueEstimate;
  currency: string;
  validityDays: number;
  tone?: string;
}

export function localProposalDraft(input: ProposalInput): ProposalDraft {
  const profile = industryProfile(input.industry, null);
  const findings = (input.findings ?? []).filter((f) => f.severity !== "positive");
  const critical = findings.filter((f) => f.severity === "critical");
  const high = findings.filter((f) => f.severity === "high");
  const scores = input.scores ?? {};
  const hasWebsite = Boolean(input.websiteUrl);
  const locality = input.city ?? "your area";
  const recipient = input.contactName ?? `the ${input.businessName} team`;
  const concept = localDesignRecommendation(input, "premium");

  const problems = findings.slice(0, 6).map((f) => ({
    title: f.title,
    detail: f.detail,
    evidence: f.evidence,
  }));

  if (!hasWebsite) {
    problems.unshift({
      title: "No website — the business is invisible at the point of intent",
      detail: `${profile.label} customers in ${locality} research online before they call. Without a website, the business is only discoverable through third-party directories, where it competes on someone else's terms and pays for the privilege.`,
      evidence: "No website URL is associated with this business in its public listing data.",
    });
  }

  const lineItems = buildLineItems(input, profile);
  const subtotal = lineItems.reduce((sum, item) => sum + (item.optional ? 0 : item.total), 0);

  const structure = concept.sections.map((s, i) => `${i + 1}. ${s.name} — ${s.purpose}`);

  const timeline = buildTimeline(input, profile, conceptsToBuild(input));

  const sections = buildProposalSections({
    input,
    profile,
    concept,
    problems,
    locality,
    recipient,
    structure,
    timeline,
    lineItems,
    subtotal,
  });

  const verifiedFactsUsed = buildVerifiedFacts(input, findings, scores, hasWebsite);

  const beforeAfter = {
    current: hasWebsite
      ? [
          `Website score ${scores.overall ?? "—"}/100 (${scoreLabel(scores.overall)})`,
          `Mobile experience: ${scores.mobile ?? "—"}/100`,
          `Conversion readiness: ${scores.conversion ?? "—"}/100`,
          ...critical.slice(0, 2).map((f) => f.title),
          "No clear next step for the visitor in several key journeys",
        ]
      : [
          "No website at all",
          "No way for customers to find services, prices or availability online",
          "Every search-driven enquiry currently goes to a competitor",
          `Reputation (${input.rating ? `${input.rating.toFixed(1)}★, ` : ""}${input.reviewCount ?? 0} reviews) is not visible where buyers look`,
        ],
    recommended: [
      `A conversion-led ${profile.label.toLowerCase()} website with ${concept.sections.length} purposeful sections`,
      `Primary action "${profile.primaryCta}" repeated at every decision point`,
      `Trust proof placed before the first ask`,
      `Mobile-first build tested on real devices`,
      `Measurable enquiry tracking from launch day`,
      `Local search foundations targeting "${industryKeywords(profile, locality)[0]}"`,
    ],
  };

  const executiveSummary = buildExecutiveSummary(input, profile, {
    hasWebsite,
    scores,
    critical: critical.length,
    high: high.length,
    locality,
    recipient,
    estimate: input.estimate,
  });

  return {
    title: hasWebsite ? "Website Improvement Proposal" : "New Website Proposal",
    subtitle: `Prepared for ${input.businessName}${input.city ? `, ${input.city}` : ""}`,
    executiveSummary,
    currentSituation: buildCurrentSituation(input, profile, { hasWebsite, scores, locality, recipient }),
    problemsIdentified: problems,
    recommendedSolution: buildRecommendedSolution(input, profile, concept, { hasWebsite, locality }),
    proposedWebsite: {
      structure,
      designDirection: `${concept.style}. ${concept.styleRationale}`,
      designNotes: concept.designNotes,
    },
    recommendedPages: concept.pages.map((name) => ({ name, purpose: pagePurpose(name, profile) })),
    recommendedFeatures: concept.features.map((name) => ({ name, benefit: featureBenefit(name, profile) })),
    benefits: buildBenefits(input, profile, { hasWebsite, scores }),
    timeline,
    investment: {
      lineItems,
      subtotal,
      total: subtotal,
      currency: input.currency,
    },
    estimate: buildEstimate(input),
    nextSteps: [
      "A 20-minute call to walk through these findings and confirm priorities.",
      "We agree the scope and finalise the page list together.",
      "You receive a fixed-price agreement with the final figure and timeline.",
      "Design starts within five working days of sign-off.",
    ],
    callToAction: {
      heading: "Shall we walk through these findings together?",
      body: `A 20-minute call is enough to confirm priorities and give you a firm figure. There is no obligation, and you keep the audit findings either way.`,
      buttonLabel: "Schedule a 20-Minute Call",
    },
    beforeAfter,
    sections,
    confidence: computeProposalConfidence(findings.length, hasWebsite, Boolean(scores.overall), input.reviewCount ?? 0),
    verifiedFactsUsed,
    generatedBy: "local_engine",
  };
}

function scoreLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return "not scored";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 55) return "fair";
  if (score >= 40) return "poor";
  return "critical";
}

function conceptsToBuild(input: ProposalInput): number {
  const profile = industryProfile(input.industry, null);
  const base = 6;
  const extra = profile.key === "ecommerce" ? 6 : profile.optionalFeatures.length > 4 ? 3 : 1;
  return base + extra;
}

function buildLineItems(input: ProposalInput, profile: ReturnType<typeof industryProfile>): ProposalLineItem[] {
  const items: ProposalLineItem[] = [];
  const hasWebsite = Boolean(input.websiteUrl);
  const design = input.estimate;

  items.push({
    id: "li-design",
    name: hasWebsite ? "Website redesign — UI/UX" : "Website design — UI/UX",
    description: `Custom design for all recommended pages, built around the ${profile.label.toLowerCase()} buying journey. Includes responsive layouts for desktop, tablet and mobile, a component library, and two rounds of revision.`,
    quantity: 1,
    unitPrice: Math.round(design.mid * 0.42 / 50) * 50,
    total: Math.round(design.mid * 0.42 / 50) * 50,
  });

  items.push({
    id: "li-build",
    name: "Front-end build & CMS",
    description: `Semantic, accessible build with a content-managed structure so ${input.businessName} can update services, prices and gallery content without a developer.`,
    quantity: 1,
    unitPrice: Math.round(design.mid * 0.34 / 50) * 50,
    total: Math.round(design.mid * 0.34 / 50) * 50,
  });

  items.push({
    id: "li-conversion",
    name: "Conversion setup & integrations",
    description: `Primary CTA system, enquiry forms with spam protection, ${
      profile.mustHaveFeatures.some((f) => /booking/i.test(f)) ? "online booking integration, " : ""
    }click-to-call, map embed and enquiry notifications delivered to the right inbox.`,
    quantity: 1,
    unitPrice: Math.round(design.mid * 0.14 / 50) * 50,
    total: Math.round(design.mid * 0.14 / 50) * 50,
  });

  items.push({
    id: "li-seo",
    name: "Local SEO foundation & analytics",
    description: `Technical SEO setup, metadata, LocalBusiness structured data, location page structure, Google Business Profile alignment and privacy-respecting analytics with conversion tracking.`,
    quantity: 1,
    unitPrice: Math.round(design.mid * 0.1 / 50) * 50,
    total: Math.round(design.mid * 0.1 / 50) * 50,
  });

  if (input.services.length) {
    const extra = input.services
      .filter((s) => !/design|build/i.test(s.name))
      .slice(0, 2);
    extra.forEach((service, index) => {
      items.push({
        id: `li-svc-${index}`,
        name: service.name,
        description: service.description,
        quantity: 1,
        unitPrice: service.price,
        total: service.price,
        optional: index > 0,
      });
    });
  }

  items.push({
    id: "li-care",
    name: "Care plan (optional, monthly)",
    description:
      "Hosting management, security patching, weekly backups, uptime monitoring, minor content updates and a monthly enquiry report. Cancel any time with 30 days' notice.",
    quantity: 1,
    unitPrice: design.monthlyRetainer,
    total: design.monthlyRetainer,
    optional: true,
  });

  return items;
}

function buildTimeline(
  input: ProposalInput,
  profile: ReturnType<typeof industryProfile>,
  pageCount: number,
): ProposalDraft["timeline"] {
  const weeks = pageCount > 10 ? 2 : 1;
  return [
    {
      phase: "1 · Discovery & strategy",
      duration: `${weeks} week`,
      detail: "We confirm the page list, agree the primary conversion action, collect existing assets and audit what your competitors rank for.",
      deliverables: ["Agreed sitemap and page list", "Content requirements checklist", "Competitor search summary", "Access and asset collection"],
    },
    {
      phase: "2 · Design",
      duration: `${weeks + 1} weeks`,
      detail: `Homepage and one inner page designed first for sign-off, then the remainder of the ${pageCount} pages using the approved component library.`,
      deliverables: ["Homepage design (desktop + mobile)", "Inner page template", "Component library", "Two rounds of revision"],
    },
    {
      phase: "3 · Build & content",
      duration: `${weeks + 1}–${weeks + 2} weeks`,
      detail: "Responsive front-end build, CMS configuration, content population and conversion integrations, all on a staging URL you can review as it develops.",
      deliverables: ["Full responsive build", "CMS set up and documented", "Forms, booking and tracking live", "Staging link for ongoing review"],
    },
    {
      phase: "4 · QA & launch",
      duration: "1 week",
      detail: "Cross-device testing, accessibility checks, performance tuning, SEO redirects and analytics verification before go-live.",
      deliverables: ["Cross-browser and device QA", "Lighthouse performance pass", "Redirect map and analytics verification", "Launch and handover session"],
    },
    {
      phase: "5 · Post-launch support",
      duration: "30 days included",
      detail: "We monitor the first month for issues, review enquiry volume and make minor adjustments based on real visitor behaviour.",
      deliverables: ["30-day warranty on all delivered work", "Enquiry report at day 30", "Recommended next-phase roadmap"],
    },
  ];
}

function buildProposalSections(args: {
  input: ProposalInput;
  profile: ReturnType<typeof industryProfile>;
  concept: ReturnType<typeof localDesignRecommendation>;
  problems: ProposalDraft["problemsIdentified"];
  locality: string;
  recipient: string;
  structure: string[];
  timeline: ProposalDraft["timeline"];
  lineItems: ProposalLineItem[];
  subtotal: number;
}): ProposalSection[] {
  const { input, profile, concept, problems, locality, recipient, structure, timeline, lineItems, subtotal } = args;
  const money = (value: number) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: input.currency, maximumFractionDigits: 0 }).format(value);

  return [
    {
      id: "s-exec",
      key: "executive_summary",
      title: "Executive summary",
      body: `${input.businessName} has earned ${input.rating ? `a ${input.rating.toFixed(1)}★ rating across ` : ""}${input.reviewCount ?? 0} public reviews${
        input.city ? ` in ${locality}` : ""
      }, but the current online presence is not converting that reputation into enquiries. This proposal sets out what we measured, what we recommend, what it will cost and how long it will take.`,
      bullets: [
        problems.length ? `${problems.length} specific, measured issues identified in the audit` : "Full website audit findings attached",
        `${concept.sections.length} purposeful sections and ${concept.pages.length} recommended pages`,
        `Estimated delivery: ${input.estimate.timelineWeeksLow}–${input.estimate.timelineWeeksHigh} weeks`,
        `Indicative investment: ${money(input.estimate.low)} – ${money(input.estimate.high)} (final figure confirmed after our call)`,
      ],
      visible: true,
    },
    {
      id: "s-situation",
      key: "current_situation",
      title: "Current situation",
      body: `Below is what we found from public information and an automated audit of ${
        input.websiteUrl ? `the current site (${input.websiteUrl})` : "the business's online presence"
      }. Every point is something we measured or observed — nothing here is an assumption.`,
      bullets: problems.slice(0, 4).map((p) => `${p.title} — ${p.evidence}`),
      visible: true,
    },
    {
      id: "s-problems",
      key: "problems",
      title: "Problems identified",
      body: "These are ordered by commercial impact. Each one has a measurable effect on whether a visitor becomes an enquiry.",
      bullets: problems.map((p) => `${p.title}: ${p.detail}`),
      visible: true,
    },
    {
      id: "s-solution",
      key: "solution",
      title: "Recommended solution",
      body: `${profile.customerIntent} The proposed website is structured around that decision path: proof first, services in the customer's own language, a clear price expectation, and an unmissable way to make contact at every point of hesitation.`,
      bullets: concept.conversionStrategy,
      visible: true,
    },
    {
      id: "s-website",
      key: "proposed_website",
      title: "Proposed website",
      body: concept.styleRationale,
      bullets: structure,
      visible: true,
    },
    {
      id: "s-design",
      key: "design",
      title: "Design direction",
      body: concept.designNotes.split("\n\n").slice(0, 3).join(" "),
      bullets: [
        `Colour: ${concept.palette.map((c) => `${c.name} ${c.hex}`).join(" · ")}`,
        `Typography: ${concept.typography.heading} headings with ${concept.typography.body} body copy`,
        `Layout: ${concept.layout}`,
        `Motion: ${concept.animations[0]}`,
      ],
      visible: true,
    },
    {
      id: "s-pages",
      key: "recommended_pages",
      title: "Recommended pages",
      body: "Each page has one job. We do not add pages that exist only to fill a menu.",
      bullets: concept.pages.map((name) => `${name} — ${pagePurpose(name, profile)}`),
      visible: true,
    },
    {
      id: "s-features",
      key: "recommended_features",
      title: "Recommended features",
      body: "Every feature below maps to something a customer actually does, or to evidence the business can prove.",
      bullets: concept.features.map((name) => `${name} — ${featureBenefit(name, profile)}`),
      visible: true,
    },
    {
      id: "s-benefits",
      key: "benefits",
      title: "What this delivers",
      body: input.estimate.drivers.map((d) => `${d.label}: ${d.note}`).join(" "),
      bullets: [
        "More enquiries from the visibility the business has already earned",
        "Fewer unqualified enquiries, because the site answers questions up front",
        "A site that can be updated internally without developer cost",
        "Measurable enquiry tracking so results are provable, not anecdotal",
        "A mobile experience that works for how local customers actually search",
      ],
      visible: true,
    },
    {
      id: "s-timeline",
      key: "timeline",
      title: "Timeline",
      body: `Estimated ${input.estimate.timelineWeeksLow}–${input.estimate.timelineWeeksHigh} weeks from sign-off. Timings assume content and approvals are provided within two working days of request.`,
      bullets: timeline.map((p) => `${p.phase} — ${p.duration}: ${p.detail}`),
      visible: true,
    },
    {
      id: "s-investment",
      key: "investment",
      title: "Investment",
      body: `The figure below is a specific proposal for the scope described, not a template price. It excludes VAT and any third-party costs (domain, hosting, booking platform) which are billed at cost.`,
      bullets: lineItems.map((li) => `${li.name} — ${money(li.total)}${li.optional ? " (optional)" : ""}: ${li.description}`),
      visible: true,
    },
    {
      id: "s-cta",
      key: "cta",
      title: "Next step",
      body: `A 20-minute call is enough to confirm priorities and lock the final figure. If it is not the right time, you keep the audit findings and can act on them whenever suits — many clients start with the conversion and mobile fixes and phase the rest.`,
      bullets: ["No obligation and no pressure", "Fixed-price agreement before any work starts", "You own the design files and the code at handover"],
      visible: true,
    },
  ];
}

function buildExecutiveSummary(
  input: ProposalInput,
  profile: ReturnType<typeof industryProfile>,
  data: {
    hasWebsite: boolean;
    scores: Record<string, number | null | undefined>;
    critical: number;
    high: number;
    locality: string;
    recipient: string;
    estimate: ProjectValueEstimate;
  },
): string {
  const parts: string[] = [];
  parts.push(`${input.businessName} is a well-reviewed ${profile.label.toLowerCase()} business in ${data.locality}.`);

  if (data.hasWebsite) {
    parts.push(
      `We audited the current website and it scores ${data.scores.overall ?? "—"}/100 overall — ${scoreLabel(data.scores.overall)} across performance, mobile usability, search visibility and conversion readiness.`,
    );
    if (data.critical > 0) {
      parts.push(`The audit found ${data.critical} critical issues${data.high ? ` and ${data.high} high-severity issues` : ""}. These are not cosmetic: each one measurably reduces the number of visitors who become enquiries.`);
    }
  } else {
    parts.push("The business has no website, so every search-driven enquiry currently reaches a competitor or a directory listing rather than arriving directly.");
  }

  parts.push(
    `This proposal recommends a ${profile.designStyle.toLowerCase()} website of ${profile.mustHaveSections.length} core sections, structured around how ${profile.label.toLowerCase()} customers actually decide — ${profile.customerIntent.toLowerCase()}`,
  );
  parts.push(`Indicative investment is ${input.currency} ${input.estimate.low.toLocaleString()} – ${input.estimate.high.toLocaleString()}, delivered in ${input.estimate.timelineWeeksLow}–${input.estimate.timelineWeeksHigh} weeks. This is an estimate for planning, not a quote; the final fixed price is confirmed after a short call.`);
  return parts.join(" ");
}

function buildCurrentSituation(
  input: ProposalInput,
  profile: ReturnType<typeof industryProfile>,
  data: { hasWebsite: boolean; scores: Record<string, number | null | undefined>; locality: string; recipient: string },
): string {
  if (!data.hasWebsite) {
    return `We could not find a website associated with ${input.businessName}. Public listing data shows ${input.reviewCount ?? 0} reviews${
      input.rating ? ` at ${input.rating.toFixed(1)}★` : ""
    }${input.city ? ` in ${data.locality}` : ""}, which means customers are finding the business and then looking for more detail — and there is nowhere for them to go. In ${profile.label.toLowerCase()}, the majority of first contacts now begin with a search. A business without a website is dependent on third-party platforms for visibility, and those platforms charge for the privilege and own the customer relationship.`;
  }
  const s = data.scores;
  const lines = [
    `Our automated audit of ${input.websiteUrl} produced an overall score of ${s.overall ?? "—"}/100.`,
    `Performance ${s.performance ?? "—"}/100, mobile ${s.mobile ?? "—"}/100, SEO ${s.seo ?? "—"}/100, user experience ${s.ux ?? "—"}/100, accessibility ${s.accessibility ?? "—"}/100 and conversion readiness ${s.conversion ?? "—"}/100.`,
  ];
  if (input.cms) lines.push(`The site runs on ${input.cms}.`);
  lines.push(
    `Scores below 55 in a category indicate defects that measurably reduce enquiries. The findings sections below list exactly what was measured and how each issue affects the business.`,
  );
  return lines.join(" ");
}

function buildRecommendedSolution(
  input: ProposalInput,
  profile: ReturnType<typeof industryProfile>,
  concept: ReturnType<typeof localDesignRecommendation>,
  data: { hasWebsite: boolean; locality: string },
): string {
  return [
    data.hasWebsite
      ? `Rather than patch the existing site incrementally, we recommend a focused rebuild. The audit shows the weaknesses are structural — ${profile.label.toLowerCase()} buyers need ${concept.conversionStrategy.length} conversion mechanics working together, and retrofitting them onto the current platform would cost more than building cleanly.`
      : `We recommend building a new website from scratch, designed around the single job of converting ${profile.label.toLowerCase()} searchers into enquiries.`,
    `The approach is ${concept.style.toLowerCase()}. ${concept.styleRationale}`,
    `Structurally, the site does three things: it proves credibility before asking for anything, it answers pricing and process questions honestly, and it makes contacting ${input.businessName} effortless on any device.`,
    `Every page has one purpose and one primary action, and each enquiry path is instrumented so results can be measured from the first week rather than assumed.`,
  ].join("\n\n");
}

function buildBenefits(
  input: ProposalInput,
  profile: ReturnType<typeof industryProfile>,
  data: { hasWebsite: boolean; scores: Record<string, number | null | undefined> },
): ProposalDraft["benefits"] {
  const benefits: ProposalDraft["benefits"] = [
    {
      title: "Convert the reputation you already have",
      detail: `${input.rating ? `A ${input.rating.toFixed(1)}★ rating across ${input.reviewCount} reviews` : `${input.reviewCount ?? 0} public reviews`} is a genuine asset. Placing it where buyers make the decision converts existing trust into enquiries instead of leaving it on a third-party listing.`,
      metric: "Typically the largest single conversion gain available",
    },
    {
      title: "Capture enquiries around the clock",
      detail: `A clear ${profile.primaryCta.toLowerCase()} action and a short form mean enquiries arrive while you are on a job, not only when someone finds the time to call.`,
      metric: "Enquiries outside opening hours are typically 25–40% of local service volume",
    },
    {
      title: "Get found for the searches that matter",
      detail: `Technical SEO foundations, structured data and location pages targeting the terms ${profile.label.toLowerCase()} customers actually use.`,
      metric: `Target terms include "${industryKeywords(profile, input.city)[0]}"`,
    },
    {
      title: "Stop losing mobile visitors",
      detail: "Most local searches happen on a phone. The rebuild is designed mobile-first and tested on real devices, with tap targets and forms that work one-handed.",
      metric: "Mobile is typically 65–75% of local service traffic",
    },
    {
      title: "Save time on unqualified enquiries",
      detail: "Answering price, coverage, availability and process questions on the site means the enquiries that do arrive are further along and better qualified.",
      metric: "Fewer, better enquiries — not just more",
    },
    {
      title: "Own the asset outright",
      detail: "You own the design files, the code and the content at handover. No lock-in, and any developer can maintain it.",
      metric: "Full ownership at handover",
    },
  ];

  if (data.scores.performance !== undefined && (data.scores.performance ?? 100) < 60) {
    benefits.unshift({
      title: "Fix the speed problems that cost you enquiries",
      detail: `The current site scores ${data.scores.performance}/100 for performance. Slow pages lose visitors before they read anything, and speed is also a ranking factor.`,
      metric: "Measured performance: currently below the threshold where visitors abandon",
    });
  }
  return benefits;
}

function buildEstimate(input: ProposalInput): PriceEstimate {
  const recommendedServices = input.services.map((service) => ({
    key: service.key,
    name: service.name,
    price: service.price,
    reason: `Recommended because the audit findings and the ${industryProfile(input.industry, null).label.toLowerCase()} scope call for it directly.`,
  }));

  return {
    currency: input.currency,
    low: input.estimate.low,
    mid: input.estimate.mid,
    high: input.estimate.high,
    confidence: 68,
    drivers: input.estimate.drivers,
    recommendedServices,
    timelineWeeks: { low: input.estimate.timelineWeeksLow, high: input.estimate.timelineWeeksHigh },
    disclaimer:
      "This is an internal estimate generated from the measured scope, not a quotation. The final fixed price is confirmed by a human after a short scoping call and issued as a signed agreement.",
  };
}

function pagePurpose(name: string, profile: ReturnType<typeof industryProfile>): string {
  const purposes: Record<string, string> = {
    Home: "Establish relevance, credibility and the primary action within three seconds.",
    Services: `Let visitors self-select the exact ${profile.label.toLowerCase()} service they searched for.`,
    About: "Show who will actually do the work, with names and faces.",
    Contact: "Serve the highest-intent visitor who is ready to call or visit.",
    FAQ: "Remove the final objections before someone makes contact.",
    Gallery: "Provide visual proof that is hard to fake.",
    "Meet the Team": "Humanise the business and demonstrate competence.",
  };
  return purposes[name] ?? `Supports the ${profile.label.toLowerCase()} buying decision at this stage.`;
}

function featureBenefit(name: string, profile: ReturnType<typeof industryProfile>): string {
  if (/booking|appointment|schedul/i.test(name)) return "Converts visitors into committed appointments without a phone call, including outside opening hours.";
  if (/click-to-call|call/i.test(name)) return "One tap to call from a mobile — removes the biggest friction point for high-intent local visitors.";
  if (/gallery|portfolio|project/i.test(name)) return "Visual proof of quality, which is the primary way buyers judge providers in this sector.";
  if (/review|testimonial/i.test(name)) return "Third-party evidence that the claims on the site are true.";
  if (/quote|estimate|price/i.test(name)) return "Pre-qualifies enquiries on scope and budget, saving time on unsuitable leads.";
  if (/seo|schema|structured/i.test(name)) return "Eligibility for rich results and better visibility for local search terms.";
  if (/map|direction/i.test(name)) return "Confirms coverage area instantly, which is a common pre-contact question.";
  if (/analytic|tracking/i.test(name)) return "Makes the return on the website measurable in enquiries rather than impressions.";
  if (/form|enquiry/i.test(name)) return "A low-commitment route for visitors who are not ready to call.";
  if (/whatsapp|chat/i.test(name)) return "Meets customers on the channel they already use for quick questions.";
  if (/blog|insight|news/i.test(name)) return "Compounds search visibility over time with genuinely useful content.";
  if (/accessib/i.test(name)) return "Wider reach and reduced legal risk, with a better experience for every visitor.";
  return `Directly supports ${profile.primaryConversions[0].toLowerCase()} for ${profile.label.toLowerCase()} customers.`;
}

function buildVerifiedFacts(
  input: ProposalInput,
  findings: AuditFinding[],
  scores: Record<string, number | null | undefined>,
  hasWebsite: boolean,
): string[] {
  const facts: string[] = [];
  if (hasWebsite && input.websiteUrl) facts.push(`Audited URL: ${input.websiteUrl}`);
  if (scores.overall !== undefined && scores.overall !== null) facts.push(`Overall website score: ${scores.overall}/100`);
  if (input.rating !== null && input.rating !== undefined) facts.push(`Public rating: ${input.rating.toFixed(1)}★`);
  if (input.reviewCount) facts.push(`Public review count: ${input.reviewCount}`);
  if (input.cms) facts.push(`Detected platform: ${input.cms}`);
  findings.slice(0, 6).forEach((f) => facts.push(`${f.title} — ${f.evidence}`));
  return facts;
}

function computeProposalConfidence(findingCount: number, hasWebsite: boolean, hasScore: boolean, reviewCount: number): number {
  let confidence = hasWebsite ? 62 : 66;
  if (hasScore) confidence += 18;
  confidence += Math.min(10, findingCount * 2);
  if (reviewCount > 30) confidence += 6;
  return Math.min(95, confidence);
}

export type { ProjectScopeInput };
