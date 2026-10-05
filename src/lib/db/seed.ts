import "server-only";

import { all, getDb, insert, one, parseJson, run } from ".";
import { newId } from "../ids";
import { hashPassword } from "../crypto";
import {
  createOrganization,
  createUser,
  getUserById,
  listUsers,
  seedDefaultRoles,
  seedDefaultStages,
  updateOrgSettings,
  setOnboardingStep,
} from "./repo/org";
import { createBusiness, createContact, createAudit, saveAudit, upsertWebsite } from "./repo/business";
import { createLead, recordActivity, saveLeadScore, updateLead } from "./repo/lead";
import { createConversation, addMessage, createProposal, saveConcept, createCampaign, addCampaignRecipient } from "./repo/engagement";
import {
  createTask,
  createProject,
  seedDefaultCatalogue,
  seedDefaultAlertRules,
  seedIntegrations,
  createNotification,
  enqueueJob,
  upsertIntegration,
} from "./repo/ops";
import { computeLeadScore } from "../scoring/lead";
import { INTEGRATION_REGISTRY } from "../integrations/registry";
import { sampleListings } from "../services/sample-data";
import { localDesignRecommendation } from "../ai/local/design";
import { localProposalDraft } from "../ai/local/proposal";
import { estimateProjectValue } from "../scoring/lead";
import { AUDIT_DIMENSIONS, type AuditDimension, type AuditFinding, type IntentLevel, type LeadStatus, type Temperature } from "../types";
import { logger } from "../logger";

/**
 * Demo dataset (§69).
 *
 * Everything this script writes is marked `is_demo` and labelled in the UI.
 * The audits are *modelled* — they are deterministic, plausible scores with
 * realistic findings, clearly recorded with `mode: "modelled"` and a note
 * explaining that no live crawl took place. Real audits run through the same
 * engine and are labelled `live`. Nothing here is presented as a measurement
 * of a real website.
 *
 * Seeding is idempotent: it exits early if an organisation already exists
 * unless `reset` is passed.
 */

export interface SeedResult {
  orgId: string;
  created: boolean;
  users: number;
  businesses: number;
  leads: number;
  audits: number;
  conversations: number;
  proposals: number;
  tasks: number;
  projects: number;
  password: string;
}

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "leadforge-demo";

const DEMO_ORG = {
  name: "Northlight Studio",
  slug: "northlight-studio",
  email: "hello@northlight.studio",
  phone: "+44 20 7946 0912",
  website: "https://northlight.studio",
  brandPrimary: "#4f46e5",
  brandAccent: "#e8763a",
  currency: "GBP",
  timezone: "Europe/London",
};

export function seedDemoData(options: { reset?: boolean; force?: boolean } = {}): SeedResult {
  const db = getDb();
  const existing = one<{ id: string }>("SELECT id FROM organizations LIMIT 1");

  if (existing && !options.force && !options.reset) {
    const org = one<{ id: string }>("SELECT id FROM organizations WHERE id = ?", [existing.id]);
    logger.info("seed", "Database already seeded — skipping", { orgId: org?.id });
    return {
      orgId: existing.id,
      created: false,
      users: count("users", existing.id),
      businesses: count("businesses", existing.id),
      leads: count("leads", existing.id),
      audits: count("website_audits", existing.id),
      conversations: count("conversations", existing.id),
      proposals: count("proposals", existing.id),
      tasks: count("tasks", existing.id),
      projects: count("projects", existing.id),
      password: DEMO_PASSWORD,
    };
  }

  const seeded = db.transaction(() => build());
  return seeded();
}

function count(table: string, orgId: string): number {
  return one<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table} WHERE org_id = ?`, [orgId])?.c ?? 0;
}

/* ══════════════════════════════════════════════════════════════════════════ */

function build(): SeedResult {
  // A second forced seed must not collide with the previous workspace's slug.
  const slugTaken = one<{ id: string }>("SELECT id FROM organizations WHERE slug = ?", [DEMO_ORG.slug]);
  const org = createOrganization({
    ...DEMO_ORG,
    slug: slugTaken ? `${DEMO_ORG.slug}-${Date.now().toString(36)}` : DEMO_ORG.slug,
  });
  const orgId = org.id;

  updateOrgSettings(orgId, {
    branding: { primary: DEMO_ORG.brandPrimary, accent: DEMO_ORG.brandAccent, font: "Geist", proposalTemplate: "signature", showAgencyLogo: true },
    sales: { defaultCurrency: "GBP", defaultValidityDays: 21, followUpCadence: [4, 5, 6, 7], requireProposalApproval: true, autoSendUnder: 0 },
    notifications: { email: true, whatsapp: false, browser: true, highIntent: true, proposalOpened: true, dailyDigest: true, quietHours: { from: "20:00", to: "07:30" } },
    ai: { tone: "consultative", aggressiveness: "measured", qualificationRules: "standard", discloseAi: true, model: "local" },
  });

  run("UPDATE organizations SET address = ?, city = ?, country = ?, legal_name = ? WHERE id = ?", [
    "41 Bramley Works, 12 Pearson Street",
    "London",
    "United Kingdom",
    "Northlight Studio Ltd",
    orgId,
  ]);

  seedDefaultRoles(orgId);
  seedDefaultStages(orgId);
  seedDefaultCatalogue(orgId);
  seedDefaultAlertRules(orgId);
  seedIntegrations(
    orgId,
    INTEGRATION_REGISTRY.map((entry) => ({
      key: entry.key,
      name: entry.name,
      category: entry.category,
      description: entry.description,
      requiredEnv: entry.requiredEnv,
      optionalEnv: entry.optionalEnv,
      docsUrl: entry.docsUrl,
      configurable: entry.configurable,
    })),
  );

  /* ── team ── */
  const owner = createUser({ orgId, email: "alex@northlight.studio", password: DEMO_PASSWORD, name: "Alex Mercer", role: "owner", title: "Founder & Director" });
  const admin = createUser({ orgId, email: "priya@northlight.studio", password: DEMO_PASSWORD, name: "Priya Raman", role: "admin", title: "Operations Lead" });
  const manager = createUser({ orgId, email: "daniel@northlight.studio", password: DEMO_PASSWORD, name: "Daniel Okafor", role: "sales_manager", title: "Sales Manager" });
  const agentA = createUser({ orgId, email: "sofia@northlight.studio", password: DEMO_PASSWORD, name: "SofiaLindqvist".replace("SofiaLindqvist", "Sofia Lindqvist"), role: "sales_agent", title: "Senior Sales Consultant" });
  const agentB = createUser({ orgId, email: "tom@northlight.studio", password: DEMO_PASSWORD, name: "Tom Whitfield", role: "sales_agent", title: "Sales Consultant" });
  createUser({ orgId, email: "nina@northlight.studio", password: DEMO_PASSWORD, name: "Nina Kowalski", role: "researcher", title: "Lead Researcher" });
  const designer = createUser({ orgId, email: "marco@northlight.studio", password: DEMO_PASSWORD, name: "Marco Bellini", role: "designer", title: "Design Lead" });
  createUser({ orgId, email: "hannah@northlight.studio", password: DEMO_PASSWORD, name: "Hannah Reid", role: "developer", title: "Lead Developer" });

  const agents = [agentA, agentB];
  const salesTeam = [manager, agentA, agentB];

  /* ── businesses + leads + audits ── */
  const listings = sampleListings({ limit: 96 });

  let audits = 0;
  let leads = 0;
  const createdLeads: { leadId: string; businessId: string; status: LeadStatus }[] = [];

  for (const [index, listing] of listings.entries()) {
    const { business } = createBusiness(orgId, {
      name: listing.name,
      industry: listing.industry,
      category: listing.category,
      description: listing.description,
      addressLine1: listing.addressLine1,
      city: listing.city,
      state: listing.state,
      country: listing.country,
      postalCode: listing.postalCode,
      latitude: listing.latitude,
      longitude: listing.longitude,
      phone: listing.phone,
      websiteUrl: listing.websiteUrl,
      socials: listing.socials,
      rating: listing.rating,
      reviewCount: listing.reviewCount,
      employeeRange: listing.employeeRange,
      yearsInBusiness: listing.yearsInBusiness,
      listingProvider: listing.listingProvider,
      listingId: listing.listingId,
      dataSource: "leadforge_sample",
      dataConfidence: 0.4,
      isDemo: true,
      websiteStatus: listing.websiteUrl ? "unknown" : "none",
      hours: [{ day: "Monday–Friday", open: "09:00", close: "17:30" }],
    }, { dedupe: true });

    const intentRoll = (index * 7) % 10;
    const intent: IntentLevel =
      intentRoll === 0 ? "ready_to_start"
      : intentRoll === 1 ? "wants_call"
      : intentRoll === 2 ? "wants_pricing"
      : intentRoll === 3 ? "high_intent"
      : intentRoll <= 5 ? "interested"
      : intentRoll === 6 ? "information_seeking"
      : intentRoll === 7 ? "curious"
      : intentRoll === 8 ? "not_interested"
      : "unknown";

    const status = statusFor(index, listing.websiteUrl !== null);
    const ownerId = status === "new" ? null : salesTeam[index % salesTeam.length].id;

    const lead = createLead(orgId, {
      businessId: business.id,
      source: "discovery",
      status,
      ownerId,
      isDemo: true,
    });
    leads += 1;
    // Intent is set with the score below, once the signals exist.
    void intent;

    /* ── contact for businesses with a website ── */
    if (listing.websiteUrl && index % 3 !== 2) {
      const firstName = ["James", "Sarah", "Michael", "Emma", "David", "Laura", "Peter", "Rebecca", "Ahmed", "Chloe"][index % 10];
      const lastName = ["Arnold", "Baxter", "Chowdhury", "Doyle", "Ellis", "Fraser", "Goddard", "Hughes", "Iqbal", "Jennings"][(index * 3) % 10];
      const local = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${new URL(listing.websiteUrl).hostname.replace(/^www\./, "")}`;
      createContact(orgId, {
        businessId: business.id,
        name: `${firstName} ${lastName}`,
        title: ["Owner", "Managing Director", "Practice Manager", "Operations Director", "Founder"][index % 5],
        email: index % 4 === 0 ? local : `info@${new URL(listing.websiteUrl).hostname.replace(/^www\./, "")}`,
        phone: listing.phone,
        isPrimary: index % 4 === 0,
        source: "website",
        emailStatus: index % 4 === 0 ? "unverified" : "role_address",
      }, { dedupe: true });
    }

    /* ── modelled audit ── */
    let scores: Record<string, number | null> | null = null;
    let findings: AuditFinding[] = [];

    if (listing.websiteUrl && status !== "new") {
      const modelled = modelledAudit(index, listing.websiteUrl, listing.name, listing.industry ?? "local services", listing.reviewCount);
      const website = upsertWebsite(orgId, business.id, listing.websiteUrl);
      const audit = createAudit(orgId, { businessId: business.id, websiteId: website.id, status: "complete", mode: "modelled" });
      saveAudit(orgId, audit.id, {
        status: "complete",
        overallScore: modelled.overall,
        scores: modelled.scores,
        metrics: modelled.metrics,
        findings: modelled.findings,
        opportunities: modelled.findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").slice(0, 5),
        pages: modelled.pages,
        tech: modelled.tech,
        coreWebVitals: { source: "unavailable", note: "Demo record — Core Web Vitals require a PageSpeed API key and a live crawl." },
        durationMs: 900 + (index % 7) * 240,
        notes:
          "MODELLED DEMO AUDIT. Scores and findings are generated deterministically to demonstrate the workflow — no live crawl was performed for this record. Run a real audit from the lead page to replace it with measured data.",
      });
      audits += 1;
      scores = modelled.scores;
      findings = modelled.findings;
    }

    /* ── score the lead ── */
    const contacts = all<{ name: string; email: string | null; phone: string | null; email_status: string }>(
      "SELECT name, email, phone, email_status FROM contacts WHERE business_id = ?",
      [business.id],
    );
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
        yearsInBusiness: business.yearsInBusiness,
        socials: business.socials,
        hasDescription: Boolean(business.description),
        hours: business.hours,
      },
      listing.websiteUrl ? { exists: true, reachable: true, https: true, scores: scores as never, cms: modelledCms(index), copyrightYear: index % 5 === 0 ? 2016 + (index % 3) : null, findingsCount: findings.length, criticalFindings: findings.filter((f) => f.severity === "critical").length } : { exists: false, scores: null },
      {
        hasNamedContact: contacts.some((c) => Boolean(c.name) && !/^(info|hello|enquiries)$/i.test(c.name)),
        hasEmail: contacts.some((c) => Boolean(c.email)),
        hasPhone: Boolean(business.phone) || contacts.some((c) => Boolean(c.phone)),
        emailVerified: contacts.some((c) => c.email_status === "verified"),
      },
      { intent },
    );
    saveLeadScore(orgId, lead.id, score);

    const estimated = listing.websiteUrl
      ? Math.round((estimateProjectValue({
          newBuild: false,
          pages: 6 + (index % 5),
          ecommerce: /retail|shop|ecommerce/i.test(listing.industry ?? ""),
          booking: /dental|medical|beauty|fitness|veterinary|restaurant/i.test(listing.industry ?? ""),
          customFunctionality: false,
          copywriting: findings.some((f) => /content|copy/i.test(f.title)),
          seo: true,
          brandRefresh: (scores?.ux ?? 100) < 60,
          cms: true,
          designComplexity: (listing.employeeRange ?? "").includes("50") ? "premium" : "standard",
          businessSize: (listing.employeeRange ?? "").includes("50") ? "medium" : (listing.reviewCount ?? 0) > 120 ? "medium" : "small",
        }).mid) / 50) * 50
      : Math.round((estimateProjectValue({
          newBuild: true,
          pages: 6,
          ecommerce: false,
          booking: /dental|medical|beauty|fitness|restaurant/i.test(listing.industry ?? ""),
          customFunctionality: false,
          copywriting: true,
          seo: true,
          brandRefresh: true,
          cms: true,
          designComplexity: "standard",
          businessSize: (listing.reviewCount ?? 0) > 100 ? "medium" : "small",
        }).mid) / 50) * 50;

    updateLead(orgId, lead.id, {
      estimatedValue: estimated,
      tags: [listing.industry ?? "local", listing.websiteUrl ? (scores && (scores.overall ?? 100) < 55 ? "weak-website" : "average-website") : "no-website"],
      lastActivityAt: daysAgo(index % 40),
      lastContactedAt: ["new", "researching", "qualified"].includes(status) ? null : daysAgo(2 + (index % 20)),
      temperature: score.temperature,
      nextAction: score.nextAction,
      intent,
      intentScore: score.buyingIntent,
      isDemo: true,
    });

    recordActivity(orgId, {
      leadId: lead.id,
      businessId: business.id,
      userId: ownerId,
      type: "lead_discovered",
      subject: "Lead discovered",
      body: `${business.name}${business.city ? ` in ${business.city}` : ""} added from the sample dataset. Website: ${listing.websiteUrl ?? "none found"}.`,
      isSystem: true,
    });

    if (audits && listing.websiteUrl && status !== "new") {
      recordActivity(orgId, {
        leadId: lead.id,
        businessId: business.id,
        userId: null,
        type: "audit_complete",
        subject: `Website audit complete — ${scores?.overall ?? "n/a"}/100`,
        body: `${findings.length} findings recorded (modelled demo data).`,
        metadata: { modelled: true, scores },
        isSystem: true,
        occurredAt: daysAgo(1 + (index % 25)),
      });
    }

    createdLeads.push({ leadId: lead.id, businessId: business.id, status });
  }

  /* ── conversations, proposals, tasks, projects ── */
  const byStatus = (status: LeadStatus) => createdLeads.filter((row) => row.status === status);

  const conversationCount = seedConversations(orgId, agentA.id, manager.id, createdLeads);
  const proposalResult = seedProposals(orgId, owner.id, salesTeam, createdLeads);
  const taskCount = seedTasks(orgId, salesTeam, createdLeads);
  const projectCount = seedProjects(orgId, designer.id, createdLeads);

  /* ── campaign ── */
  const campaign = createCampaign(orgId, {
    name: "Dental practices · London · audit-led",
    description: "Four-step sequence leading with the single most important measured finding on each practice's website.",
    industry: "Dental",
    location: "London, United Kingdom",
    criteria: { industry: "Dental", city: "London", maxWebsiteScore: 65 },
    sequence: [
      { step: 1, dayOffset: 0, name: "The measured finding", style: "audit_based", intent: "lead_with_evidence" },
      { step: 2, dayOffset: 4, name: "Short follow-up", style: "short", intent: "ask_one_question" },
      { step: 3, dayOffset: 9, name: "What this would change", style: "value_based", intent: "show_the_outcome" },
      { step: 4, dayOffset: 15, name: "Closing the loop", style: "friendly", intent: "polite_close" },
    ],
    dailyCap: 25,
    ownerId: agentB.id,
    status: "draft",
  });

  const campaignTargets = all<{ lead_id: string; business_id: string }>(
    "SELECT l.id AS lead_id, l.business_id FROM leads l JOIN businesses b ON b.id = l.business_id WHERE l.org_id = ? AND b.industry = 'Dental' LIMIT 8",
    [orgId],
  );
  for (const target of campaignTargets) {
    addCampaignRecipient(orgId, { campaignId: campaign.id, businessId: target.business_id, leadId: target.lead_id });
  }

  /* ── notifications ── */
  const hotLeads = all<{ id: string; name: string; lead_score: number; opportunity_score: number | null }>(
    `SELECT l.id, b.name, l.lead_score, l.opportunity_score FROM leads l JOIN businesses b ON b.id = l.business_id
     WHERE l.org_id = ? AND l.temperature = 'hot' ORDER BY l.lead_score DESC LIMIT 5`,
    [orgId],
  );
  for (const lead of hotLeads) {
    createNotification(orgId, {
      type: "hot_lead_alert",
      severity: "critical",
      title: `🔥 Hot lead: ${lead.name}`,
      body: `Lead score ${lead.lead_score}/100 with a website opportunity score of ${lead.opportunity_score ?? "n/a"}. Reach out while the audit is fresh.`,
      entityType: "lead",
      entityId: lead.id,
      actionUrl: `/leads/${lead.id}`,
      icon: "flame",
      channels: ["in_app"],
    });
  }

  createNotification(orgId, {
    type: "system",
    severity: "info",
    title: "Demo workspace ready",
    body: `Seeded ${leads} leads, ${audits} modelled audits and ${conversationCount} conversations. Sign in as alex@northlight.studio with the demo password to explore, then run a real discovery search when a data provider is connected.`,
    entityType: "organization",
    entityId: orgId,
    actionUrl: "/lead-finder",
    icon: "sparkles",
  });

  /* ── onboarding state ── */
  setOnboardingStep(orgId, "agency_profile", true);
  setOnboardingStep(orgId, "team", true);
  setOnboardingStep(orgId, "sample_data", true);
  setOnboardingStep(orgId, "first_audit", true);
  setOnboardingStep(orgId, "first_proposal", true);

  /* ── a couple of completed jobs so Diagnostics is not empty ── */
  const discoveryJob = enqueueJob(orgId, {
    type: "discovery",
    label: "Seeded demo dataset",
    payload: { source: "seed", limit: listings.length },
    createdBy: owner.id,
  });
  run(
    "UPDATE jobs SET status = 'succeeded', progress = 100, stage = 'Complete', started_at = ?, completed_at = ?, result_json = ? WHERE id = ?",
    [daysAgo(0.02), daysAgo(0.01), JSON.stringify({ found: listings.length, created: leads, leads }), discoveryJob.id],
  );
  run("UPDATE jobs SET status = 'failed', error = ?, attempts = 2, completed_at = ? WHERE id = ?", [
    "Demo record: the PageSpeed API key is not configured, so Core Web Vitals could not be measured. Everything else in the audit completed.",
    daysAgo(0.3),
    enqueueJob(orgId, { type: "audit_bulk", label: "Weekly re-audit of stale sites", payload: { limit: 20, demo: true } }).id,
  ]);

  /* ── mark a couple of integrations connected where the env really provides them ── */
  for (const entry of INTEGRATION_REGISTRY) {
    const present = entry.requiredEnv.every((name) => Boolean(process.env[name]));
    if (!present) continue;
    upsertIntegration(orgId, {
      key: entry.key,
      name: entry.name,
      category: entry.category,
      description: entry.description,
      requiredEnv: entry.requiredEnv,
      docsUrl: entry.docsUrl,
      status: "connected",
    });
  }

  logger.info("seed", "Demo workspace seeded", { orgId, leads, audits, conversations: conversationCount, proposals: proposalResult });

  return {
    orgId,
    created: true,
    users: listUsers(orgId).length,
    businesses: count("businesses", orgId),
    leads,
    audits,
    conversations: conversationCount,
    proposals: proposalResult,
    tasks: taskCount,
    projects: projectCount,
    password: DEMO_PASSWORD,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Deterministic modelled audits
   ══════════════════════════════════════════════════════════════════════════ */

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: string, min: number, max: number): number {
  const value = hash(seed);
  return min + (value % 1000) / 1000 * (max - min);
}

function modelledCms(index: number): string | null {
  return ["WordPress 6.4", "WordPress 5.9", "Wix", "Squarespace 7.1", "Custom PHP", "Webflow", "Shopify", null][index % 8];
}

interface ModelledAudit {
  overall: number;
  scores: Record<AuditDimension | "trust" | "overall", number>;
  metrics: { key: string; label: string; value: number | string | null; unit?: string; target?: string; status?: "pass" | "warn" | "fail" | "unknown"; hint?: string }[];
  findings: AuditFinding[];
  pages: { url: string; status: number; title: string | null; byteLength: number; ttfbMs: number }[];
  tech: string[];
}

function modelledAudit(index: number, url: string, name: string, industry: string, reviewCount: number): ModelledAudit {
  const seed = `${name}|${url}`;
  const cms = modelledCms(index);
  const legacy = cms ? /WordPress 5|Custom PHP|Wix|GoDaddy/i.test(cms) : true;

  const base = legacy ? 38 : 62;
  const scores: ModelledAudit["scores"] = {
    overall: 0,
    performance: Math.round(seeded(`${seed}:perf`, base - 12, base + 14)),
    mobile: Math.round(seeded(`${seed}:mobile`, base - 6, base + 18)),
    seo: Math.round(seeded(`${seed}:seo`, base - 14, base + 16)),
    ux: Math.round(seeded(`${seed}:ux`, base - 4, base + 20)),
    accessibility: Math.round(seeded(`${seed}:a11y`, base - 16, base + 10)),
    conversion: Math.round(seeded(`${seed}:conv`, base - 10, base + 12)),
    technical: Math.round(seeded(`${seed}:tech`, base - 8, base + 16)),
    content: Math.round(seeded(`${seed}:content`, base - 12, base + 14)),
    trust: Math.round(seeded(`${seed}:trust`, base - 6, base + 18)),
  };

  const weights: Record<Exclude<keyof ModelledAudit["scores"], "overall">, number> = {
    performance: 0.19, mobile: 0.16, seo: 0.16, ux: 0.12, accessibility: 0.09, conversion: 0.16, technical: 0.06, content: 0.04, trust: 0.02,
  };
  const overall = Math.round(
    (Object.keys(scores) as (keyof typeof scores)[])
      .filter((key) => key !== "overall")
      .reduce((sum, key) => sum + scores[key] * weights[key], 0),
  );
  scores.overall = overall;

  const findings: AuditFinding[] = [];
  const add = (dimension: AuditDimension | "trust", severity: AuditFinding["severity"], title: string, detail: string, evidence: string, recommendation: string, impact: string, effort?: "low" | "medium" | "high") =>
    findings.push({ id: newId("fnd"), dimension, severity, title, detail, evidence, recommendation, impact, effort });

  if (scores.performance < 55) {
    add("performance", scores.performance < 40 ? "critical" : "high", "Slow first load on mobile",
      "The homepage takes too long to become usable on a mid-range phone, which is where most local searches happen.",
      `Homepage HTML responded in ${Math.round(seeded(`${seed}:ttfb`, 600, 2400))}ms with ${Math.round(seeded(`${seed}:weight`, 2.1, 6.4) * 10) / 10}MB of transferred assets across ${Math.round(seeded(`${seed}:req`, 48, 160))} requests.`,
      "Serve properly sized WebP images, defer non-critical JavaScript and enable compression plus browser caching.",
      "Every additional second of load time reduces mobile conversion measurably; speed is the cheapest conversion win available.", "medium");
  }
  if (scores.mobile < 60) {
    add("mobile", "high", "Layout does not adapt properly on phones",
      "Content overflows horizontally and the primary action is hard to reach one-handed.",
      `Viewport meta tag present but the page reports horizontal overflow at 390px width; tap targets on the main navigation are below the 44px guideline.`,
      "Rework the layout mobile-first, increase tap-target size and pin the primary call to action within thumb reach.",
      "Roughly two-thirds of local service searches are mobile — a broken mobile layout loses those enquiries outright.", "medium");
  }
  if (scores.seo < 58) {
    add("seo", "high", "Service pages are not targeting local search intent",
      "Titles and headings describe the company rather than the service and location people actually search for.",
      `Homepage title is "${name}" with no service or location term; no structured data for LocalBusiness; ${Math.round(seeded(`${seed}:pages`, 3, 22))} of ${Math.round(seeded(`${seed}:pages2`, 6, 30))} pages have no meta description.`,
      "Write title and H1 patterns around service + location, add LocalBusiness and FAQ structured data, and align pages with Google Business Profile categories.",
      "Search visibility is where new customers come from; fixing metadata is low-effort and compounds.", "low");
  }
  if (scores.conversion < 60) {
    add("conversion", "high", "No clear next step on the busiest pages",
      "Visitors who are ready to enquire have no obvious way to do it, and there is no form above the fold.",
      `No enquiry form was found within the first two viewport heights on ${Math.round(seeded(`${seed}:cta`, 2, 6))} of the pages checked; the phone number is text, not a tap-to-call link.`,
      "Add a single dominant call to action per page, a short form with three fields at most, and click-to-call on mobile.",
      "Enquiries already reaching the site are being lost — this is the fastest measurable revenue improvement.", "low");
  }
  if (scores.accessibility < 55) {
    add("accessibility", "medium", "Automated accessibility checks failing",
      "Images are missing alternative text and form fields are not labelled, which also weakens search performance.",
      `${Math.round(seeded(`${seed}:alt`, 6, 34))} images have no alt attribute; contrast on secondary text measures below the 4.5:1 guideline.`,
      "Add alt text to meaningful images, label every form field, and raise contrast on secondary body text.",
      "Accessibility work widens the audience and reduces legal exposure.", "low");
  }
  if (scores.content < 55) {
    add("content", "medium", "Thin service content with no evidence",
      "Pages describe what the business does without pricing signals, credentials, or proof of work.",
      `The service pages average ${Math.round(seeded(`${seed}:words`, 90, 320))} words with no case studies, testimonials or team detail; the copyright notice still reads ${2016 + (index % 3)}.`,
      "Add one substantive page per core service with process, proof and pricing guidance; refresh the footer year automatically.",
      "Content depth is what separates a business that looks established from one that looks temporary.", "medium");
  }
  if (scores.technical < 65) {
    add("technical", "medium", "Technical hygiene gaps",
      "Mixed content and duplicate URLs dilute ranking signals and can trigger browser warnings.",
      `HTTP redirects to HTTPS correctly, but ${Math.round(seeded(`${seed}:dup`, 1, 4))} duplicate URL patterns were found (with and without www and trailing slash) and no canonical tags are present.`,
      "Set a canonical host, add canonical tags, and consolidate duplicate URL patterns with 301 redirects.",
      "Small technical fixes protect the ranking work that follows.", "low");
  }
  if (scores.trust < 60) {
    add("trust", "medium", "Weak trust signals above the fold",
      "The site does not show accreditations, reviews or guarantees where a first-time visitor looks for them.",
      `The business has ${reviewCount} public reviews but none are referenced on the site; no address is shown in the footer, which matters for local trust and for Google Business Profile consistency.`,
      "Surface the real review rating, accreditations and a verifiable business address near the primary call to action.",
      "Trust signals increase enquiry rates from visitors who are already interested.", "low");
  }

  add("performance", "positive", "Serving over HTTPS with a valid certificate",
    "Secure delivery is in place, which is the baseline requirement for trust and for modern browser features.",
    "TLS negotiation succeeded on the first attempt; no mixed-content assets detected on the homepage.",
    "No action required. Keep the certificate auto-renewing.", "Maintains the baseline expected by visitors and search engines.");

  const weightsSorted = findings.filter((f) => f.severity !== "positive");
  const criticalCount = weightsSorted.filter((f) => f.severity === "critical").length;

  return {
    overall,
    scores,
    metrics: [
      { key: "ttfb", label: "Server response", value: Math.round(seeded(`${seed}:ttfb2`, 180, 1800)), unit: "ms", target: "< 800ms", status: seeded(`${seed}:ttfb2`, 180, 1800) < 800 ? "pass" : "warn", hint: "Time to first byte, measured from the server response." },
      { key: "weight", label: "Page weight", value: `${(Math.round(seeded(`${seed}:w2`, 2.1, 6.4) * 10) / 10).toFixed(1)} MB`, target: "< 2 MB", status: seeded(`${seed}:w2`, 2.1, 6.4) < 2 ? "pass" : "fail" },
      { key: "requests", label: "Requests", value: Math.round(seeded(`${seed}:r2`, 48, 160)), target: "< 70", status: seeded(`${seed}:r2`, 48, 160) < 70 ? "pass" : "warn" },
      { key: "pages", label: "Pages checked", value: Math.round(seeded(`${seed}:pc`, 4, 12)) },
      { key: "findings", label: "Findings", value: findings.length, hint: `${criticalCount} critical` },
      { key: "https", label: "HTTPS", value: "Yes", status: "pass" },
      { key: "cms", label: "Platform", value: cms ?? "Unknown / custom" },
      { key: "viewport", label: "Mobile viewport", value: scores.mobile >= 60 ? "Configured" : "Present but broken", status: scores.mobile >= 60 ? "pass" : "fail" },
      { key: "cwv", label: "Core Web Vitals", value: "Not measured", status: "unknown", hint: "Requires a PageSpeed API key — nothing is estimated in its place." },
      { key: "industry", label: "Industry", value: industry },
    ],
    findings,
    pages: ["/", "/contact", "/services", "/about"].slice(0, 2 + (index % 3)).map((path, pageIndex) => ({
      url: new URL(path, url).toString(),
      status: 200,
      title: pageIndex === 0 ? name : `${path.replace("/", "").replace(/^\w/, (c) => c.toUpperCase())} — ${name}`,
      byteLength: Math.round(seeded(`${seed}:b${pageIndex}`, 42_000, 480_000)),
      ttfbMs: Math.round(seeded(`${seed}:t${pageIndex}`, 180, 1800)),
    })),
    tech: [cms, "Google Analytics 4", "jQuery 1.x", "Cloudflare", "Font Awesome"].filter((entry): entry is string => Boolean(entry)),
  };
}

function statusFor(index: number, hasWebsite: boolean): LeadStatus {
  const pool: LeadStatus[] = hasWebsite
    ? ["new", "researching", "qualified", "contacted", "engaged", "interested", "proposal_sent", "meeting_scheduled", "negotiation", "won", "lost", "not_interested", "follow_up_later"]
    : ["new", "researching", "qualified", "contacted", "interested", "proposal_sent", "follow_up_later"];
  return pool[index % pool.length];
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/* ── conversations ───────────────────────────────────────────────────────── */

function seedConversations(
  orgId: string,
  agentA: string,
  manager: string,
  leads: { leadId: string; businessId: string; status: LeadStatus }[],
): number {
  const candidates = leads.filter((row) => ["interested", "engaged", "proposal_sent", "meeting_scheduled", "negotiation", "contacted"].includes(row.status)).slice(0, 7);
  let created = 0;

  const scripts: { prospect: string; ai: string; intent: IntentLevel; score: number; escalate: boolean }[] = [
    {
      prospect: "Hi — I had a look at the report you sent. How long would a rebuild realistically take?",
      ai: "Thanks for reading it. Most rebuilds of this size take four to six weeks from kick-off, in two phases so you see the design before any build work starts. The exact figure depends on how many service pages you want to keep. Would it help if I put the timings and the fixed price in a short proposal?",
      intent: "interested",
      score: 62,
      escalate: false,
    },
    {
      prospect: "What would something like this cost? We have a budget meeting on Thursday.",
      ai: "I can give you a range now, but I would rather give you a fixed figure — a range invites the wrong comparison in a budget meeting. Based on what we measured, comparable rebuilds land between £4,500 and £7,000. I can have an exact proposal with the price and timeline to you before Thursday if that helps?",
      intent: "wants_pricing",
      score: 78,
      escalate: true,
    },
    {
      prospect: "This looks good. Can we get on a call this week? Thursday or Friday works for us.",
      ai: "Absolutely — I am handing this to a person on the team now so you get a confirmed time rather than a back-and-forth. They will come back with two slots and can answer anything about scope or delivery.",
      intent: "wants_call",
      score: 88,
      escalate: true,
    },
    {
      prospect: "We already have someone who does our website, so probably not for us right now.",
      ai: "That is completely fair, and I will not push. If it helps, the audit stays available — the mobile speed issue is the kind of thing that is worth raising with whoever maintains it. If anything changes, the report is there.",
      intent: "not_interested",
      score: 5,
      escalate: true,
    },
    {
      prospect: "Can you show me some examples of sites you have built for similar businesses?",
      ai: "Yes — I will have a person send the two closest examples in your sector, including the before-and-after for one of them. In the meantime, the concept we generated for you shows the direction we would take: it keeps your existing brand colours and focuses the homepage on the single service you told us brings the most work.",
      intent: "high_intent",
      score: 82,
      escalate: false,
    },
    {
      prospect: "Is this an AI talking to me?",
      ai: "Yes — I am an AI assistant working for Northlight Studio. A person from the team can take over at any point, and anything I say about your website comes from the audit we ran. Would you like me to bring someone into the conversation?",
      intent: "information_seeking",
      score: 40,
      escalate: true,
    },
    {
      prospect: "We are ready to go ahead. What do you need from us to start?",
      ai: "That is great to hear. I am handing this straight to a person so nothing is lost in translation — they will send the agreement and the kick-off checklist, and confirm the two or three things we need from you: brand assets, access to the current site and a decision-maker for sign-off.",
      intent: "ready_to_start",
      score: 96,
      escalate: true,
    },
  ];

  for (const [index, candidate] of candidates.entries()) {
    const script = scripts[index % scripts.length];
    const conversation = createConversation(orgId, {
      leadId: candidate.leadId,
      businessId: candidate.businessId,
      channel: index % 3 === 0 ? "email" : "web_chat",
      assignedUserId: index % 2 === 0 ? agentA : manager,
    });
    created += 1;

    addMessage(orgId, { conversationId: conversation.id, role: "prospect", body: script.prospect, authorLabel: "Prospect", intent: script.intent, intentScore: script.score });
    addMessage(orgId, {
      conversationId: conversation.id,
      role: "ai",
      body: `${script.ai}\n\n— AI assistant for Northlight Studio. A person from the team is always available; just ask.`,
      authorLabel: "Northlight Studio assistant",
      intent: script.intent,
      intentScore: script.score,
    });

    run(
      `UPDATE conversations SET intent = ?, intent_score = ?, status = ?, ai_enabled = ?, summary = ?, unread_for_org = ?, escalated_at = ?, last_message_at = ? WHERE id = ?`,
      [
        script.intent,
        script.score,
        script.escalate ? "human_takeover" : script.intent === "not_interested" ? "closed" : "ai_active",
        script.escalate ? 0 : 1,
        script.intent === "ready_to_start"
          ? "Prospect confirmed they want to proceed and asked what is needed to start. Handover to delivery required."
          : script.intent === "wants_pricing"
            ? "Prospect asked for pricing ahead of a Thursday budget meeting. Needs a fixed proposal before then."
            : script.intent === "wants_call"
              ? "Prospect requested a call this week and offered Thursday or Friday."
              : script.intent === "not_interested"
                ? "Prospect has an existing supplier and declined for now. Left the door open."
                : "Prospect engaged with the audit findings and asked about scope and examples.",
        script.escalate ? 1 : 0,
        script.escalate ? daysAgo(index * 0.4 + 0.2) : null,
        daysAgo(index * 0.6 + 0.1),
        conversation.id,
      ],
    );
  }

  return created;
}

/* ── proposals ───────────────────────────────────────────────────────────── */

function seedProposals(
  orgId: string,
  ownerId: string,
  team: { id: string; name: string }[],
  leads: { leadId: string; businessId: string; status: LeadStatus }[],
): number {
  const candidates = leads.filter((row) => ["proposal_sent", "meeting_scheduled", "negotiation", "won"].includes(row.status)).slice(0, 6);
  let created = 0;

  for (const [index, candidate] of candidates.entries()) {
    const lead = one<{ id: string; lead_score: number; website_score: number | null; business_id: string }>(
      "SELECT id, lead_score, website_score, business_id FROM leads WHERE id = ?",
      [candidate.leadId],
    );
    const business = one<{ name: string; industry: string | null; city: string | null; website_url: string | null; review_count: number | null; rating: number | null }>(
      "SELECT name, industry, city, website_url, review_count, rating FROM businesses WHERE id = ?",
      [candidate.businessId],
    );
    if (!lead || !business) continue;

    const audit = one<{ id: string; overall_score: number | null; findings_json: string }>(
      "SELECT id, overall_score, findings_json FROM website_audits WHERE business_id = ? ORDER BY created_at DESC LIMIT 1",
      [candidate.businessId],
    );
    const findings = parseJson<AuditFinding[]>(audit?.findings_json ?? "[]", []);

    const estimate = estimateProjectValue({
      newBuild: !business.website_url,
      pages: 7,
      ecommerce: false,
      booking: /dental|beauty|fitness|medical/i.test(business.industry ?? ""),
      customFunctionality: false,
      copywriting: true,
      seo: true,
      brandRefresh: true,
      cms: true,
      designComplexity: "standard",
      businessSize: (business.review_count ?? 0) > 120 ? "medium" : "small",
    });

    const concept = localDesignRecommendation(
      {
        businessName: business.name,
        industry: business.industry,
        city: business.city,
        websiteUrl: business.website_url,
        rating: business.rating,
        reviewCount: business.review_count,
        findings,
        scores: audit?.overall_score !== null && audit?.overall_score !== undefined ? { overall: audit.overall_score } : null,
        brandColors: ["#4f46e5", "#e8763a"],
      },
      index % 3 === 0 ? "premium" : index % 3 === 1 ? "corporate" : "modern",
    );

    const conceptRecord = saveConcept(orgId, {
      businessId: candidate.businessId,
      leadId: candidate.leadId,
      createdBy: ownerId,
      preset: index % 3 === 0 ? "premium" : index % 3 === 1 ? "corporate" : "modern",
      concept,
      variant: "primary",
    });

    const draft = localProposalDraft({
      businessName: business.name,
      industry: business.industry,
      city: business.city,
      country: "United Kingdom",
      websiteUrl: business.website_url,
      rating: business.rating,
      reviewCount: business.review_count,
      findings,
      scores: audit?.overall_score !== null && audit?.overall_score !== undefined ? { overall: audit.overall_score } : null,
      contactName: null,
      agencyName: "Northlight Studio",
      agencyEmail: "hello@northlight.studio",
      agencyPhone: "+44 20 7946 0912",
      agencyWebsite: "https://northlight.studio",
      services: [
        { key: "website_redesign", name: "Website Redesign", price: 2800, description: "Audit-driven rebuild", timelineDays: [14, 40] },
        { key: "seo", name: "SEO", price: 1100, description: "Technical and local SEO", timelineDays: [14, 45] },
      ],
      packages: [
        { name: "Essential", price: 2200, features: ["5 pages", "CMS", "SEO basics"], pagesIncluded: 5 },
        { name: "Signature", price: 4200, features: ["Up to 10 pages", "CMS", "Local SEO", "Analytics"], pagesIncluded: 10 },
        { name: "Premium", price: 6900, features: ["Unlimited pages", "Booking", "Copywriting", "Care plan"], pagesIncluded: null },
      ],
      estimate,
      currency: "GBP",
      validityDays: 21,
    });

    const status = candidate.status === "won" ? "accepted" : candidate.status === "negotiation" ? "negotiation" : candidate.status === "meeting_scheduled" ? "viewed" : "sent";
    const proposal = createProposal(orgId, {
      businessId: candidate.businessId,
      leadId: candidate.leadId,
      auditId: audit?.id ?? null,
      conceptId: conceptRecord.id,
      title: draft.title,
      template: "signature",
      currency: "GBP",
      sections: draft.sections,
      lineItems: draft.investment.lineItems,
      design: { concept: concept.preview, notes: draft.proposedWebsite.designNotes },
      concept: { preset: concept.preset, hero: concept.hero, preview: concept.preview },
      total: draft.investment.total,
      monthlyRetainer: estimate.monthlyRetainer,
      timelineWeeks: estimate.timelineWeeksHigh,
      validUntil: new Date(Date.now() + 21 * 86_400_000).toISOString(),
      status: status as never,
      pricingSource: "ai_recommended",
    });
    created += 1;

    const approvedAt = daysAgo(6 + index);
    const sentAt = daysAgo(5 + index);
    const viewedAt = status === "sent" && index % 2 === 0 ? null : daysAgo(3 + index * 0.5);
    const acceptedAt = status === "accepted" ? daysAgo(index * 0.4) : null;

    run(
      `UPDATE proposals SET status = ?, approved_by = ?, approved_at = ?, sent_at = ?, viewed_at = ?, view_count = ?, time_spent_seconds = ?, accepted_at = ? WHERE id = ?`,
      [
        status,
        team[index % team.length].id,
        approvedAt,
        sentAt,
        viewedAt,
        viewedAt ? 2 + (index % 5) : 0,
        viewedAt ? 90 + index * 65 : 0,
        acceptedAt,
        proposal.id,
      ],
    );

    if (viewedAt) {
      insert("proposal_views", {
        id: newId("pvw"),
        org_id: orgId,
        proposal_id: proposal.id,
        session_key: newId("ses"),
        viewer_ip_hash: null,
        user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)",
        referrer: index % 2 === 0 ? "https://mail.google.com/" : null,
        duration_seconds: 90 + index * 65,
        max_scroll: 68 + (index % 30),
        sections_viewed_json: draft.sections.slice(0, 3 + (index % 4)).map((section) => section.key),
        cta_clicks_json: index % 3 === 0 ? ["accept"] : [],
        opened_at: viewedAt,
        last_seen_at: viewedAt,
      });
    }
  }

  return created;
}

/* ── tasks ───────────────────────────────────────────────────────────────── */

function seedTasks(
  orgId: string,
  team: { id: string; name: string }[],
  leads: { leadId: string; businessId: string; status: LeadStatus }[],
): number {
  const hot = all<{ id: string; business_id: string; name: string }>(
    `SELECT l.id, l.business_id, b.name FROM leads l JOIN businesses b ON b.id = l.business_id
     WHERE l.org_id = ? AND l.temperature = 'hot' ORDER BY l.lead_score DESC LIMIT 6`,
    [orgId],
  );

  let created = 0;
  const templates: { title: (name: string) => string; type: string; priority: "low" | "medium" | "high" | "urgent"; dueInDays: number; description: string }[] = [
    { title: (name) => `Call ${name} — hot lead, never contacted`, type: "call", priority: "urgent", dueInDays: 0, description: "Highest-scoring uncontacted lead. Lead with the single most severe audit finding and ask one question." },
    { title: (name) => `Send the audit summary to ${name}`, type: "email", priority: "high", dueInDays: 1, description: "Attach the findings, no pricing yet. Offer two specific call slots." },
    { title: (name) => `Follow up on the proposal sent to ${name}`, type: "follow_up", priority: "high", dueInDays: 3, description: "Proposal has been opened. Call rather than email — they are deciding now." },
    { title: (name) => `Confirm the meeting with ${name}`, type: "meeting", priority: "medium", dueInDays: 2, description: "Send an agenda and confirm who will be on the call." },
    { title: (name) => `Prepare a before/after concept for ${name}`, type: "design", priority: "medium", dueInDays: 4, description: "Use the recommended direction and the business's own brand colours." },
    { title: (name) => `Re-check the website of ${name}`, type: "research", priority: "low", dueInDays: 7, description: "Confirm nothing changed before the next touch." },
    { title: (name) => `Check the quote from ${name}'s competitor angle`, type: "research", priority: "low", dueInDays: -2, description: "Overdue demo task so the overdue state is visible in the UI." },
  ];

  for (const [index, lead] of hot.entries()) {
    const template = templates[index % templates.length];
    createTask(orgId, {
      title: template.title(lead.name),
      description: template.description,
      type: template.type,
      priority: template.priority,
      dueAt: new Date(Date.now() + template.dueInDays * 86_400_000).toISOString(),
      leadId: lead.id,
      businessId: lead.business_id,
      assignedUserId: team[index % team.length].id,
    });
    created += 1;
    if (index % 3 === 0) {
      createTask(orgId, {
        title: `Add ${lead.name} to the dental campaign`,
        description: "Verify the contact address before adding — bounced addresses damage sender reputation.",
        type: "admin",
        priority: "medium",
        status: "done" as never,
        dueAt: daysAgo(1 + index),
        leadId: lead.id,
        businessId: lead.business_id,
        assignedUserId: team[index % team.length].id,
      });
      created += 1;
    }
  }

  void leads;
  return created;
}

/* ── projects ────────────────────────────────────────────────────────────── */

function seedProjects(
  orgId: string,
  designerId: string,
  leads: { leadId: string; businessId: string; status: LeadStatus }[],
): number {
  const won = leads.filter((row) => row.status === "won").slice(0, 3);
  let created = 0;

  for (const [index, lead] of won.entries()) {
    const business = one<{ name: string; industry: string | null; website_url: string | null; city: string | null }>(
      "SELECT name, industry, website_url, city FROM businesses WHERE id = ?",
      [lead.businessId],
    );
    if (!business) continue;
    const leadRow = one<{ estimated_value: number | null; currency: string; owner_id: string | null }>(
      "SELECT estimated_value, currency, owner_id FROM leads WHERE id = ?",
      [lead.leadId],
    );
    const project = createProject(orgId, {
      name: `${business.name} — website project`,
      businessId: lead.businessId,
      leadId: lead.leadId,
      status: index === 0 ? "design" : index === 1 ? "discovery" : "development",
      startDate: daysAgo(14 - index * 4).slice(0, 10),
      deadline: new Date(Date.now() + (28 - index * 6) * 86_400_000).toISOString().slice(0, 10),
      budget: leadRow?.estimated_value ?? 5200,
      currency: leadRow?.currency ?? "GBP",
      ownerId: leadRow?.owner_id ?? null,
      team: [{ userId: designerId, role: "design" }],
      scope: [
        { name: "Discovery and information architecture", detail: "Audit review, sitemap, wireframes for six core pages." },
        { name: "Design system", detail: "Typography, colour, components and states, in the client's existing brand palette." },
        { name: "Build", detail: "Responsive build with an editable CMS and enquiry tracking." },
        { name: "Launch and handover", detail: "Redirects, analytics verification and a recorded editor walkthrough." },
      ],
      requirements: [
        "Brand assets and any existing photography (client to supply)",
        "Read access to the current hosting and domain registrar",
        "Named decision-maker for design sign-off",
        "Opening hours and service list confirmed for structured data",
      ],
      notes: `Created from lead ${lead.leadId}. Delivery checklist generated automatically.`,
    });
    created += 1;

    createTask(orgId, { title: "Kick-off call and scope confirmation", type: "meeting", priority: "urgent", dueAt: daysAgo(8 - index * 2), projectId: project.id, businessId: lead.businessId, assignedUserId: leadRow?.owner_id ?? null, status: "done" as never });
    createTask(orgId, { title: "Homepage design — first pass", type: "design", priority: "high", dueAt: daysAgo(-3 + index), projectId: project.id, businessId: lead.businessId, assignedUserId: designerId });
    createTask(orgId, { title: "Content migration plan", type: "admin", priority: "medium", dueAt: daysAgo(-6 + index), projectId: project.id, businessId: lead.businessId, assignedUserId: leadRow?.owner_id ?? null });
    createTask(orgId, { title: "Pre-launch redirect map and QA", type: "launch", priority: "low", dueAt: daysAgo(-20 + index), projectId: project.id, businessId: lead.businessId, assignedUserId: leadRow?.owner_id ?? null });
  }

  return created;
}
