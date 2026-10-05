import "server-only";

import {
  approveProposal,
  createProposal,
  getProposal,
  listProposalViews,
  markProposalSent,
  nextProposalNumber,
  recordProposalEngagement,
  recordProposalView,
  saveConcept,
  selectConcept,
  updateProposal,
  listConcepts,
} from "../db/repo/engagement";
import { getBusiness, listContacts, latestAuditForBusiness } from "../db/repo/business";
import { getLead, recordActivity, saveLeadScore } from "../db/repo/lead";
import { getOrganization, getUserById, listStages, defaultOrgSettings } from "../db/repo/org";
import { listPricingPlans, listServices, getSetting, setSetting } from "../db/repo/ops";
import { generateProposal, recommendDesign, analyzeBusiness } from "../ai";
import type { BusinessAnalysis, ConceptPreset, GeneratedConcept, ProposalDraft } from "../ai/types";
import type { ProposalInput } from "../ai/local/proposal";
import { CONCEPT_PRESETS } from "../ai/types";
import { computeLeadScore, estimateProjectValue, type ProjectScopeInput } from "../scoring/lead";
import type { Proposal, Business, Audit } from "../db/repo/types";
import type { AuditFinding, ProposalLineItem, ProposalSection, IntentLevel, WebsiteStatus } from "../types";

/** Mirrors `OrgSettings["branding"]["proposalTemplate"]`. */
export type ProposalTemplate = "signature" | "editorial" | "technical" | "compact";

/** The nine measured dimension scores, flattened for convenience. */
export type AuditScores = Record<string, number | null>;
import { notify } from "./notifications";
import { organizationProfile } from "./org-profile";
import { logger } from "../logger";

/**
 * Proposal + concept orchestration (§13, §16).
 *
 * The AI drafts; the human approves. Nothing leaves the platform until a user
 * with `proposals.approve` approves the specific version (§16), and the price
 * always carries its derivation and an override path (§34).
 */

export interface ProposalContextBundle {
  business: Business;
  leadId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  auditScores: AuditScores | null;
  findings: AuditFinding[];
  analysis: BusinessAnalysis;
  concept: GeneratedConcept | null;
  draft: ProposalDraft;
  estimate: ReturnType<typeof estimateProjectValue>;
}

export async function buildProposalBundle(
  orgId: string,
  leadId: string,
  options: { preset?: ConceptPreset; userId?: string | null; tone?: string } = {},
): Promise<ProposalContextBundle> {
  const lead = getLead(orgId, leadId);
  if (!lead) throw new Error("Lead not found in this workspace.");
  const business = lead.business ?? getBusiness(orgId, lead.businessId);
  if (!business) throw new Error("The lead's business record is missing.");

  const organization = getOrganization(orgId);
  const profile = organizationProfile(orgId);
  const contacts = listContacts(orgId, { businessId: business.id, limit: 10 });
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;

  const audit = latestAuditForBusiness(orgId, business.id);
  const findings = (audit?.findings ?? []) as AuditFinding[];
  const auditScores = auditScoresFrom(audit);

  const analysis = await analyzeBusiness(
    {
      orgId,
      userId: options.userId ?? null,
      businessName: business.name,
      industry: business.industry,
      city: business.city,
      country: business.country,
      rating: business.rating,
      reviewCount: business.reviewCount,
      websiteUrl: business.websiteUrl,
      findings,
      scores: auditScores as unknown as Record<string, number | null> | null,
      cms: findCms(audit?.tech),
      brandColors: brandColorsFor(organization),
      tone: options.tone,
    },
    { orgId, userId: options.userId, entityId: business.id },
  );

  const concept = await recommendDesign(
    {
      orgId,
      userId: options.userId ?? null,
      businessName: business.name,
      industry: business.industry,
      city: business.city,
      country: business.country,
      rating: business.rating,
      reviewCount: business.reviewCount,
      websiteUrl: business.websiteUrl,
      findings,
      scores: auditScores,
      brandColors: brandColorsFor(organization),
    },
    options.preset ?? "premium",
    { orgId, userId: options.userId, entityId: business.id },
  );

  const estimate = estimateProjectValue(scopeFor(business, findings, analysis));

  const draft = await generateProposal(
    proposalInput({
      business,
      analysis,
      findings,
      auditScores,
      contactName: primary?.name ?? null,
      agencyName: profile.name,
      agencyEmail: profile.email,
      agencyPhone: profile.phone,
      agencyWebsite: profile.website,
      services: listServices(orgId).map((s) => ({
        key: s.key,
        name: s.name,
        price: s.price ?? s.startingPrice,
        description: s.description ?? "",
        timelineDays: [s.timelineDaysMin, s.timelineDaysMax],
      })),
      packages: listPricingPlans(orgId).map((p) => ({
        name: p.name,
        price: p.price,
        features: p.features,
        pagesIncluded: p.pagesIncluded ?? null,
      })),
      estimate,
      currency: profile.currency,
      validityDays: profile.proposalValidityDays,
      industry: business.industry,
      city: business.city,
      country: business.country,
      websiteUrl: business.websiteUrl,
      rating: business.rating,
      reviewCount: business.reviewCount,
      scores: auditScores as unknown as Record<string, number | null> | null,
      tone: options.tone,
    }),
    { orgId, userId: options.userId, entityId: leadId },
  );

  return {
    business,
    leadId,
    contactName: primary?.name ?? null,
    contactEmail: primary?.email ?? null,
    auditScores,
    findings,
    analysis,
    concept,
    draft,
    estimate,
  };
}

export function proposalInput(args: {
  business: Business;
  analysis: BusinessAnalysis;
  findings: AuditFinding[];
  auditScores: AuditScores | null;
  contactName: string | null;
  agencyName: string;
  agencyEmail: string | null;
  agencyPhone: string | null;
  agencyWebsite: string | null;
  services: ProposalInput["services"];
  packages: ProposalInput["packages"];
  estimate: ReturnType<typeof estimateProjectValue>;
  currency: string;
  validityDays: number;
  industry: string | null;
  city: string | null;
  country: string | null;
  websiteUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  scores: Record<string, number | null> | null;
  tone?: string;
}): ProposalInput {
  return {
    businessName: args.business.name,
    industry: args.industry,
    city: args.city,
    country: args.country,
    websiteUrl: args.websiteUrl,
    rating: args.rating,
    reviewCount: args.reviewCount,
    findings: args.findings,
    scores: args.scores,
    contactName: args.contactName,
    agencyName: args.agencyName,
    agencyEmail: args.agencyEmail,
    agencyPhone: args.agencyPhone,
    agencyWebsite: args.agencyWebsite,
    services: args.services,
    packages: args.packages,
    estimate: args.estimate,
    currency: args.currency,
    validityDays: args.validityDays,
    tone: args.tone,
  };
}

/** Heuristic project scope used to derive a price range before the user edits it. */
export function scopeFor(business: Business, findings: AuditFinding[], analysis: BusinessAnalysis): ProjectScopeInput {
  const reviews = business.reviewCount ?? 0;
  const employees = business.employeeRange ?? "";
  const businessSize: ProjectScopeInput["businessSize"] =
    /200|500|1000/.test(employees) ? "large" : /50/.test(employees) ? "medium" : reviews > 150 ? "medium" : reviews > 20 ? "small" : "micro";

  const complexity: ProjectScopeInput["designComplexity"] =
    businessSize === "large" ? "premium" : analysis.estimatedComplexity.level === "bespoke" ? "bespoke" : businessSize === "medium" ? "standard" : "standard";

  const industry = (business.industry ?? "").toLowerCase();
  const hasWebsite = Boolean(business.websiteUrl);

  return {
    newBuild: !hasWebsite,
    pages: Math.max(5, analysis.suggestedStructure.length),
    ecommerce: /ecommerce|retail|shop/i.test(industry),
    booking: /dental|medical|beauty|fitness|salon|clinic|restaurant|veterinary/i.test(industry),
    customFunctionality: businessSize === "large" || /portal|quote|configurator/i.test(analysis.suggestedFeatures.map((f) => f.name).join(" ")),
    copywriting: !hasWebsite || findings.some((f) => /content|copy|thin/i.test(f.title)),
    seo: true,
    brandRefresh: !hasWebsite || findings.some((f) => /design|brand|inconsistent/i.test(f.title)),
    cms: true,
    designComplexity: complexity,
    businessSize,
  };
}

function findCms(tech: string[] | null | undefined): string | null {
  if (!tech?.length) return null;
  const match = tech.find((entry) => /wordpress|wix|squarespace|shopify|webflow|joomla|drupal|godaddy|weebly|hubspot/i.test(entry));
  return match ?? null;
}

/* ── create the stored proposal ──────────────────────────────────────────── */

export interface CreateProposalOptions {
  preset?: ConceptPreset;
  template?: ProposalTemplate;
  userId: string | null;
  regenerate?: boolean;
  notes?: string | null;
}

export interface CreatedProposal {
  proposal: Proposal;
  bundle: ProposalContextBundle;
  conceptId: string | null;
}

export async function createProposalForLead(orgId: string, leadId: string, options: CreateProposalOptions): Promise<CreatedProposal> {
  const bundle = await buildProposalBundle(orgId, leadId, { preset: options.preset, userId: options.userId });
  const profile = organizationProfile(orgId);
  const audit = latestAuditForBusiness(orgId, bundle.business.id);

  let conceptId: string | null = null;
  if (bundle.concept) {
    const concept = saveConcept(orgId, {
      businessId: bundle.business.id,
      leadId,
      createdBy: options.userId,
      preset: options.preset ?? "premium",
      concept: bundle.concept,
      variant: options.regenerate ? `variant-${Date.now().toString(36)}` : "primary",
    });
    conceptId = concept.id;
    selectConcept(orgId, bundle.business.id, concept.id);
  }

  const sections = toSections(bundle.draft, bundle.estimate, profile);
  const lineItems = toLineItems(bundle.draft, bundle.estimate);
  const total = bundle.estimate.mid;

  const proposal = createProposal(orgId, {
    businessId: bundle.business.id,
    leadId,
    contactId: null,
    auditId: audit?.id ?? null,
    conceptId,
    title: bundle.draft.title,
    template: options.template ?? "signature",
    currency: profile.currency,
    sections,
    lineItems,
    design: { concept: bundle.concept, preview: bundle.concept?.preview ?? null, notes: bundle.draft.proposedWebsite.designNotes },
    concept: { preset: options.preset ?? "premium", preview: bundle.concept?.preview ?? null, hero: bundle.concept?.hero ?? null, pages: bundle.draft.recommendedPages },
    total,
    monthlyRetainer: bundle.estimate.monthlyRetainer,
    timelineWeeks: bundle.estimate.timelineWeeksHigh,
    validUntil: new Date(Date.now() + profile.proposalValidityDays * 86_400_000).toISOString(),
    status: "draft",
    notes: options.notes ?? null,
    pricingSource: "ai_recommended",
  });

  recordActivity(orgId, {
    leadId,
    businessId: bundle.business.id,
    userId: options.userId,
    type: "proposal_created",
    subject: `Proposal ${proposal.number} drafted`,
    body: `AI generated a proposal with ${lineItems.length} line items totalling ${profile.currency} ${total.toLocaleString()}. Awaiting approval before it can be sent.`,
    metadata: { proposalId: proposal.id, total, currency: profile.currency, generatedBy: bundle.draft.generatedBy, preset: options.preset ?? "premium" },
    isSystem: false,
  });

  const { updateLead } = await import("../db/repo/lead");
  updateLead(orgId, leadId, { nextAction: "Review and approve the draft proposal" });

  logger.info("proposal", "Proposal drafted", { proposal: proposal.number, leadId, total, provider: bundle.draft.generatedBy });

  return { proposal, bundle, conceptId };
}

export function toSections(draft: ProposalDraft, estimate: ReturnType<typeof estimateProjectValue>, profile: { currency: string }): ProposalSection[] {
  const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: estimate.currency, maximumFractionDigits: 0 }).format(value);
  return [
    { id: "sec_summary", key: "executive_summary", title: "Executive summary", body: draft.executiveSummary, bullets: [], visible: true },
    { id: "sec_situation", key: "current_situation", title: "Where you are today", body: draft.currentSituation, bullets: draft.beforeAfter.current, visible: true },
    {
      id: "sec_problems",
      key: "problems",
      title: "What we found",
      body: "Each item below comes from the website audit we ran. Nothing here is assumed.",
      bullets: draft.problemsIdentified.map((p) => `${p.title} — ${p.detail} (${p.evidence})`),
      visible: true,
    },
    { id: "sec_solution", key: "solution", title: "Recommended approach", body: draft.recommendedSolution, bullets: draft.proposedWebsite.structure, visible: true },
    {
      id: "sec_design",
      key: "design",
      title: "Design direction",
      body: draft.proposedWebsite.designDirection,
      bullets: [
        ...(draft.proposedWebsite.designNotes ? [draft.proposedWebsite.designNotes] : []),
        ...draft.beforeAfter.recommended.slice(0, 6),
      ],
      visible: true,
    },
    {
      id: "sec_pages",
      key: "pages",
      title: "Pages and features",
      body: "The structure we recommend, in the order visitors will meet it.",
      bullets: [
        ...draft.recommendedPages.map((p) => `${p.name}: ${p.purpose}`),
        ...draft.recommendedFeatures.map((f) => `${f.name}: ${f.benefit}`),
      ],
      visible: true,
    },
    {
      id: "sec_benefits",
      key: "benefits",
      title: "What this changes",
      body: "Expected outcomes. These are goals we will measure together, not guarantees.",
      bullets: draft.benefits.map((b) => `${b.title} — ${b.detail}${b.metric ? ` (${b.metric})` : ""}`),
      visible: true,
    },
    {
      id: "sec_timeline",
      key: "timeline",
      title: "Timeline",
      body: `${estimate.timelineWeeksLow}–${estimate.timelineWeeksHigh} weeks from kick-off, in phases.`,
      bullets: draft.timeline.map((t) => `${t.phase} (${t.duration}): ${t.detail}`),
      visible: true,
    },
    {
      id: "sec_investment",
      key: "investment",
      title: "Investment",
      body: `Recommended range: ${money(estimate.low)} – ${money(estimate.high)}, centred on ${money(estimate.mid)}. Optional ongoing care from ${money(estimate.monthlyRetainer)} per month.`,
      bullets: draft.investment.lineItems.map((item) => `${item.name}: ${money(item.total)} — ${item.description}`),
      visible: true,
    },
    {
      id: "sec_terms",
      key: "terms",
      title: "How we work together",
      body: "50% on acceptance to reserve the schedule, 50% on launch. Two rounds of revisions per phase. You own the domain, the hosting account and every asset we produce. This proposal is a fixed scope, not an estimate: if we discover something that changes the work, we tell you in writing before proceeding and you decide.",
      bullets: [],
      visible: true,
    },
    { id: "sec_next", key: "next_steps", title: "Next steps", body: draft.nextSteps.join(" "), bullets: draft.nextSteps, visible: true },
  ];
}

export function toLineItems(draft: ProposalDraft, estimate: ReturnType<typeof estimateProjectValue>): ProposalLineItem[] {
  const mid = estimate.mid;
  const design = Math.round((mid * 0.42) / 50) * 50;
  const build = Math.round((mid * 0.34) / 50) * 50;
  const conversion = Math.round((mid * 0.14) / 50) * 50;
  const seo = mid - design - build - conversion;

  const items: ProposalLineItem[] = [
    { id: "li_design", name: "Discovery, strategy and design system", description: "Audit review, information architecture, wireframes and a full visual design system for every page.", unitPrice: design, quantity: 1, total: design, optional: false },
    { id: "li_build", name: "Development and build", description: `Responsive build of ${draft.recommendedPages.length} pages with an editable CMS and the integrations listed above.`, unitPrice: build, quantity: 1, total: build, optional: false },
    { id: "li_conversion", name: "Conversion and integration work", description: "Enquiry forms, booking or quoting flow, analytics and where relevant e-commerce setup.", unitPrice: conversion, quantity: 1, total: conversion, optional: false },
    { id: "li_seo", name: "Technical SEO, speed and analytics setup", description: "Metadata, schema, Core Web Vitals work and analytics configuration.", unitPrice: seo, quantity: 1, total: seo, optional: false },
  ];

  if (estimate.monthlyRetainer > 0) {
    items.push({
      id: "li_care",
      name: "Ongoing care plan (monthly, optional)",
      description: "Hosting oversight, updates, backups, uptime monitoring and a monthly improvement report. Cancel any time.",
      unitPrice: estimate.monthlyRetainer,
      quantity: 12,
      total: estimate.monthlyRetainer * 12,
      optional: true,
    });
  }

  return items;
}

/* ── approval, sending and tracking ──────────────────────────────────────── */

export interface ApprovalCheck {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

export function approvalChecks(orgId: string, proposal: Proposal): ApprovalCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!proposal.sections.some((s) => s.key === "problems" && s.visible)) {
    warnings.push("The 'What we found' section is hidden. Proposals convert better when the evidence is visible.");
  }
  if (proposal.total <= 0) blockers.push("The proposal total is zero. Set a price before approving.");
  if (!proposal.leadId) warnings.push("This proposal is not linked to a lead, so view tracking will not update a pipeline record.");
  const business = getBusiness(orgId, proposal.businessId);
  const hasContactEmail = business ? listContacts(orgId, { businessId: business.id, limit: 5 }).some((c) => Boolean(c.email)) : false;
  if (!business?.email && !hasContactEmail) {
    warnings.push("No email address is on file for this business. You will need one to send the proposal by email — or share the public link.");
  }
  const hasAudit = Boolean(proposal.auditId);
  if (!hasAudit) {
    warnings.push("No website audit is linked, so the findings sections are based on AI interpretation rather than measurements. Run an audit first for maximum credibility.");
  }

  return { allowed: blockers.length === 0, blockers, warnings };
}

export function approve(orgId: string, proposalId: string, userId: string): { proposal: Proposal | null; check: ApprovalCheck } {
  const existing = getProposal(orgId, proposalId);
  if (!existing) return { proposal: null, check: { allowed: false, blockers: ["Proposal not found."], warnings: [] } };
  const check = approvalChecks(orgId, existing);
  if (!check.allowed) return { proposal: existing, check };

  const proposal = approveProposal(orgId, proposalId, userId);
  const user = getUserById(userId);
  if (proposal?.leadId) {
    recordActivity(orgId, {
      leadId: proposal.leadId,
      businessId: proposal.businessId,
      userId,
      type: "proposal_approved",
      subject: `Proposal ${proposal.number} approved`,
      body: `${user?.name ?? "A team member"} approved the proposal for external send.`,
      metadata: { proposalId, total: proposal.total },
    });
  }
  logger.info("proposal", "Proposal approved", { proposal: proposal?.number, by: user?.email });
  return { proposal, check };
}

export async function sendProposal(
  orgId: string,
  proposalId: string,
  options: { channel: "email" | "link"; userId: string; to?: string; message?: string },
): Promise<{ ok: boolean; message: string; url: string }> {
  const proposal = getProposal(orgId, proposalId);
  if (!proposal) return { ok: false, message: "Proposal not found.", url: "" };
  if (proposal.status === "draft" && !proposal.approvedAt) {
    return { ok: false, message: "This proposal has not been approved yet. Approve it first — the approval step exists so nothing incorrect reaches a client.", url: proposalUrl(proposal.publicToken) };
  }

  const url = proposalUrl(proposal.publicToken);
  const profile = organizationProfile(orgId);
  const business = getBusiness(orgId, proposal.businessId);
  const contacts = listContacts(orgId, { businessId: proposal.businessId, limit: 5 });

  if (options.channel === "link") {
    markProposalSent(orgId, proposalId, "link");
    return { ok: true, message: "Shareable link is live. Copy it from the box below.", url };
  }

  const to = options.to ?? contacts.find((c) => c.email)?.email ?? business?.email ?? null;
  if (!to) {
    return { ok: false, message: "No email address is available for this business. Add a contact, or copy the shareable link instead.", url };
  }

  const { sendEmail, emailTemplates } = await import("./email");
  const template = emailTemplates.proposalLink({
    businessName: business?.name ?? "your business",
    agencyName: profile.name,
    proposalUrl: url,
    total: new Intl.NumberFormat("en-GB", { style: "currency", currency: proposal.currency, maximumFractionDigits: 0 }).format(proposal.total),
    validUntil: proposal.validUntil ? new Date(proposal.validUntil).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null,
  });

  const result = await sendEmail({
    orgId,
    to,
    subject: template.subject,
    text: options.message ? `${options.message}\n\n${template.text}` : template.text,
    html: template.html,
    category: "proposal",
  });

  if (result.status === "sent") {
    markProposalSent(orgId, proposalId, "email");
    if (proposal.leadId) {
      const { createEmail } = await import("../db/repo/engagement");
      createEmail(orgId, {
        leadId: proposal.leadId,
        contactId: proposal.contactId,
        toAddress: to,
        subject: template.subject,
        bodyText: template.text,
        bodyHtml: template.html,
        provider: result.providerMessageId ?? process.env.EMAIL_PROVIDER ?? "email",
        status: "sent",
        style: "professional",
      });
      const { updateLead } = await import("../db/repo/lead");
      updateLead(orgId, proposal.leadId, { status: "proposal_sent", nextAction: "Follow up in 3 days if the proposal has not been opened" });
    }
  }

  return { ok: result.status === "sent", message: result.detail, url };
}

export function proposalUrl(token: string | null): string {
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return token ? `${base.replace(/\/$/, "")}/p/${token}` : "";
}

export function proposalTimeline(orgId: string, proposalId: string) {
  return listProposalViews(proposalId).map((view) => ({
    ...view,
    label: view.ctaClicks.length > 0 ? "Clicked the call to action" : view.sectionsViewed.length > 0 ? `Read ${view.sectionsViewed.length} sections` : "Opened the proposal",
  }));
}

export function proposalConcepts(orgId: string, businessId: string) {
  return listConcepts(orgId, { businessId, limit: 20 });
}

export { CONCEPT_PRESETS, recordProposalView, recordProposalEngagement, nextProposalNumber, updateProposal, getSetting, setSetting };

/** Recompute the lead score after a proposal is opened or accepted. */
export async function rescoreAfterProposal(orgId: string, proposal: Proposal): Promise<void> {
  if (!proposal.leadId) return;
  const lead = getLead(orgId, proposal.leadId);
  const business = lead?.business ?? getBusiness(orgId, proposal.businessId);
  if (!lead || !business) return;

  const audit = latestAuditForBusiness(orgId, business.id);
  const intent = proposal.acceptedAt ? "ready_to_start" : proposal.viewedAt ? "interested" : "contacted";
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
    { intent: intent as IntentLevel },
  );
  saveLeadScore(orgId, proposal.leadId, score);
  const { updateLead } = await import("../db/repo/lead");
  updateLead(orgId, proposal.leadId, { temperature: score.temperature, intent: intent as IntentLevel });
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

export function auditScoresFrom(audit: Audit | null): AuditScores | null {
  if (!audit || audit.overallScore === null) return null;
  return {
    overall: audit.overallScore,
    performance: audit.performance,
    mobile: audit.mobile,
    seo: audit.seo,
    ux: audit.ux,
    accessibility: audit.accessibility,
    conversion: audit.conversion,
    technical: audit.technical,
    content: audit.content,
    trust: audit.trust,
  };
}

function brandColorsFor(organization: { brandPrimary?: string; brandAccent?: string } | null): string[] {
  if (!organization) return [];
  return [organization.brandPrimary, organization.brandAccent].filter((color): color is string => Boolean(color));
}

export function pipelineStageLabels(orgId: string): { key: string; label: string; probability: number }[] {
  return listStages(orgId).map((stage) => ({ key: stage.key, label: stage.name, probability: stage.probability }));
}

export function organizationSettings(orgId: string) {
  return defaultOrgSettings();
}

export function notificationForProposalOpen(orgId: string, proposal: Proposal, seconds: number, sections: string[]): void {
  notify(orgId, {
    type: "proposal_opened",
    title: `${getBusiness(orgId, proposal.businessId)?.name ?? "A prospect"} opened proposal ${proposal.number}`,
    body: `Spent ${Math.round(seconds / 60)} minutes across ${sections.length} section${sections.length === 1 ? "" : "s"}. This is the moment to follow up.`,
    entityType: "proposal",
    entityId: proposal.id,
    actionUrl: `/proposals/${proposal.id}`,
    severity: seconds > 120 ? "warning" : "info",
  });
}
