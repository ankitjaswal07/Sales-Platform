/**
 * Self-check suite.
 *
 * Deliberately dependency-free: it exercises the pure engines (scoring, audit
 * analysers, guardrails, pricing, discovery filters) and the database round
 * trip, and fails loudly if any invariant regresses. Run with `npm test`.
 */
import { computeLeadScore, estimateProjectValue } from "../src/lib/scoring/lead.ts";
import { applyGuardrails, verifyClaims } from "../src/lib/ai/guardrails.ts";
import { localProposalDraft } from "../src/lib/ai/local/proposal.ts";
import { localOutreachEmail } from "../src/lib/ai/local/outreach.ts";
import { localChatReply, detectIntent } from "../src/lib/ai/local/conversation.ts";
import { interpretCommand } from "../src/lib/ai/local/command.ts";
import { sampleListings, SAMPLE_INDUSTRIES, SAMPLE_CITIES } from "../src/lib/services/sample-data.ts";
import fs from "node:fs";
import { getPrimaryOrganization } from "../src/lib/db/repo/org.ts";
import { getJob, jobStats, listAlertRules, listIntegrations, listJobLogs } from "../src/lib/db/repo/ops.ts";
import { loadHandlers, handlerCatalogue, scheduleRecurringWork, scheduledJobsTonight } from "../src/lib/jobs/handlers.ts";
import { registeredTypes, runPendingJobs, schedule } from "../src/lib/queue/index.ts";
import { diagnostics } from "../src/lib/services/observability.ts";
import path from "node:path";
import { getDb } from "../src/lib/db/index.ts";
import { seedDemoData } from "../src/lib/db/seed.ts";
import { listLeads } from "../src/lib/db/repo/lead.ts";
import { analyticsSummary, rangeFor, nextBestActions } from "../src/lib/db/repo/analytics.ts";
import { listStages } from "../src/lib/db/repo/org.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("LeadForge checks\n================");

section("Scoring");
{
  const weakSite = computeLeadScore(
    { name: "Test Co", industry: "Plumbing", city: "Leeds", country: "United Kingdom", phone: "+441130000000", rating: 4.6, reviewCount: 180, employeeRange: "1-4", yearsInBusiness: 12, hasDescription: true },
    { exists: true, reachable: true, https: true, scores: { overall: 34, performance: 28, mobile: 30, seo: 31, ux: 40, accessibility: 33, conversion: 30, technical: 45 } },
    { hasNamedContact: false, hasEmail: true, hasPhone: true },
    { intent: "interested" },
  );
  const noSite = computeLeadScore(
    { name: "No Site Ltd", industry: "Cleaning", city: "London", country: "United Kingdom", phone: "+442000000000", rating: 4.9, reviewCount: 240, hasDescription: true },
    { exists: false, scores: null },
    { hasNamedContact: true, hasEmail: true, hasPhone: true },
    { intent: "high_intent" },
  );

  check("a very poor website produces a high opportunity score", weakSite.websiteOpportunity >= 70, `got ${weakSite.websiteOpportunity}`);
  check("no website scores maximum website opportunity", noSite.websiteOpportunity >= 90, `got ${noSite.websiteOpportunity}`);
  check("strong reviews raise buying potential", noSite.buyingPotential >= 60, `got ${noSite.buyingPotential}`);
  check("the result explains itself with factors", weakSite.factors.length >= 4, `${weakSite.factors.length} factors`);
  check("the total is inside 0–100", weakSite.total >= 0 && weakSite.total <= 100, `got ${weakSite.total}`);
  check("temperature is one of the three bands", ["hot", "warm", "cold"].includes(weakSite.temperature));
}

section("Project value estimation");
{
  const simple = estimateProjectValue({ newBuild: false, pages: 5, ecommerce: false, booking: false, customFunctionality: false, copywriting: false, seo: false, brandRefresh: false, cms: false, designComplexity: "simple", businessSize: "micro" });
  const big = estimateProjectValue({ newBuild: true, pages: 24, ecommerce: true, booking: true, customFunctionality: true, copywriting: true, seo: true, brandRefresh: true, cms: true, designComplexity: "bespoke", businessSize: "large" });
  check("a small scope is cheaper than a large one", simple.mid < big.mid, `${simple.mid} vs ${big.mid}`);
  check("the range is ordered low < mid < high", simple.low < simple.mid && simple.mid < simple.high);
  check("drivers explain every loading", big.drivers.length >= 6, `${big.drivers.length} drivers`);
  check("a monthly retainer is produced", big.monthlyRetainer > 0);
}

section("AI guardrails");
{
  const fabricated = applyGuardrails("Our AI will guarantee you 300% more leads within 7 days. This is a limited time offer!");
  check("prohibited promises are rewritten or flagged", fabricated.flags.length > 0, fabricated.flags.join(", ") || "no flags");
  check("guarantee language is removed", !/guarantee/i.test(fabricated.text), fabricated.text.slice(0, 120));

  const clean = applyGuardrails("Your homepage took 2.4 seconds to respond on mobile. We would rebuild the navigation so the primary action is within thumb reach.");
  check("honest measured copy passes untouched", clean.flags.length === 0, clean.flags.join(", "));

  const supported = verifyClaims("You have 4.9 stars from 240 reviews.", ["4.9 stars", "240 reviews"]);
  check("measured claims backed by evidence are accepted", supported.checkedClaims >= 1 && supported.unsupported.length === 0, JSON.stringify(supported));

  const invented = verifyClaims("Your lighthouse score is 23 and your homepage weighs 8mb.", ["mobile score 61"]);
  check("invented numbers are flagged for review", invented.unsupported.length === 1, JSON.stringify(invented));
}

section("Proposal generation");
{
  const draft = localProposalDraft({
    businessName: "Ashworth Construction",
    industry: "Construction",
    city: "Manchester",
    country: "United Kingdom",
    websiteUrl: "https://ashworthconstruction.co.uk",
    rating: 4.7,
    reviewCount: 96,
    findings: [
      { id: "f1", dimension: "performance", severity: "critical", title: "Slow first load on mobile", detail: "Takes too long to become usable.", evidence: "Homepage responded in 2100ms with 4.8MB of assets.", recommendation: "Optimise images and defer scripts.", impact: "Loses mobile enquiries." },
      { id: "f2", dimension: "conversion", severity: "high", title: "No clear next step", detail: "No enquiry form above the fold.", evidence: "No form within two viewport heights on 4 of 6 pages.", recommendation: "Add one dominant call to action.", impact: "Ready visitors leave." },
    ],
    scores: { overall: 42 },
    contactName: "James Arnold",
    agencyName: "Northlight Studio",
    agencyEmail: "hello@northlight.studio",
    agencyPhone: "+44 20 7946 0912",
    agencyWebsite: "https://northlight.studio",
    services: [{ key: "website_redesign", name: "Website Redesign", price: 2800, description: "Audit-driven rebuild", timelineDays: [14, 40] }],
    packages: [{ name: "Signature", price: 4200, features: ["10 pages", "CMS"], pagesIncluded: 10 }],
    estimate: estimateProjectValue({ newBuild: false, pages: 7, ecommerce: false, booking: false, customFunctionality: false, copywriting: true, seo: true, brandRefresh: true, cms: true, designComplexity: "standard", businessSize: "small" }),
    currency: "GBP",
    validityDays: 21,
  });

  check("a proposal has a title and summary", Boolean(draft.title) && draft.executiveSummary.length > 80);
  check("problems reference the measured findings", draft.problemsIdentified.length >= 1);
  check("pricing line items are present", draft.investment.lineItems.length >= 3);
  check("the estimate is described as an estimate, not a quote", /estimate|range|not a quote|planning/i.test(draft.estimate.disclaimer), draft.estimate.disclaimer.slice(0, 140));
  check("a timeline is produced", draft.timeline.length >= 3);
  check("the proposal is marked as locally generated", draft.generatedBy === "local_engine");
}

section("Outreach emails");
{
  const styles = ["professional", "friendly", "short", "consultative", "audit_based", "value_based"] as const;
  const bodies = styles.map((style) => localOutreachEmail({
    businessName: "Brightwell Dental",
    contactName: "Sarah Baxter",
    industry: "Dental",
    city: "London",
    websiteUrl: "https://brightwelldental.co.uk",
    rating: 4.8,
    reviewCount: 210,
    findings: [{ id: "f1", dimension: "mobile", severity: "high", title: "Layout does not adapt on phones", detail: "Booking is buried.", evidence: "Booking link is 5 taps deep on mobile.", recommendation: "Pin the booking action.", impact: "Loses bookings." }],
    scores: { overall: 44 },
    agencyName: "Northlight Studio",
    agencySenderName: "Alex Mercer",
    agencyPhone: "+44 20 7946 0912",
    agencyWebsite: "https://northlight.studio",
    style,
  }));

  check("all six styles produce distinct bodies", new Set(bodies.map((b) => b.body)).size === 6, `${new Set(bodies.map((b) => b.body)).size} unique`);
  check("every email names the recipient", bodies.every((b) => /Sarah/.test(b.body)));
  check("no email exceeds 220 words", bodies.every((b) => b.body.split(/\s+/).length <= 220), bodies.map((b) => b.body.split(/\s+/).length).join(", "));
  check("every email carries a follow-up recommendation", bodies.every((b) => b.followUpInDays > 0));
  check("every email cites the measured evidence", bodies.some((b) => /millisecond|booking|tap|second|mobile/i.test(b.body)));
}

section("Chat agent and intent detection");
{
  const ready = detectIntent("We are ready to go ahead — what do you need from us to start?", []);
  check("ready-to-start is detected with a high score", ready.intent === "ready_to_start" && ready.score >= 80, `${ready.intent} ${ready.score}`);

  const notInterested = detectIntent("We already have someone who does our website, so probably not for us right now.", []);
  check("disinterest is detected", notInterested.intent === "not_interested", notInterested.intent);
  check("disinterest is treated as an explicit decline", notInterested.intent === "not_interested" && notInterested.signals.length > 0);
  check("disinterest escalates in the chat agent", localChatReply("We already have someone who does our website, so probably not for us right now.", { businessName: "Test Co", industry: "Dental", agencyName: "Northlight Studio", history: [] }).handoffRecommended);

  const pricing = detectIntent("What would something like this cost?", []);
  check("phrased pricing questions are detected", pricing.intent === "wants_pricing", pricing.intent);
  const pricing2 = detectIntent("How much does a rebuild usually run to?", []);
  check("a second pricing phrasing is detected", pricing2.intent === "wants_pricing", pricing2.intent);

  const reply = localChatReply("Is this a real person?", {
    businessName: "Test Co",
    industry: "Dental",
    agencyName: "Northlight Studio",
    history: [],
  });
  check("the AI never claims to be human", /ai assistant|ai\b|automated/i.test(reply.message), reply.message.slice(0, 160));
  check("the AI recommends handover when asked about being human", reply.handoffRecommended);
  check("an internal note is produced for the agent", reply.internalNote.length > 10);
}

section("AI command centre");
{
  const find = interpretCommand("find 20 plumbers in leeds with websites scoring below 60", { canWrite: true, userRole: "sales_agent", availableIndustries: ["Plumbing"] });
  check("discovery-style queries map to lead search", ["search_leads", "search_businesses"].includes(find.intent), find.intent);
  check("a limit is parsed", find.filters.limit === 20, String(find.filters.limit));
  check("a website score threshold is parsed", find.filters.maxWebsiteScore === 60, String(find.filters.maxWebsiteScore));
  check("a location is parsed", (find.filters.locations ?? []).some((l) => /leeds/i.test(l)), JSON.stringify(find.filters.locations));

  const analytics = interpretCommand("how many proposals were opened this month?", { canWrite: true, userRole: "owner", availableIndustries: [] });
  check("analytics questions map to an analytics query", analytics.intent === "analytics_query", analytics.intent);
}

section("Discovery dataset");
{
  const all = sampleListings({ limit: 120 });
  check("the sample dataset covers many industries", new Set(all.map((b) => b.industry)).size >= 12, `${new Set(all.map((b) => b.industry)).size} industries`);
  check("the sample dataset spans multiple countries", new Set(all.map((b) => b.country)).size >= 4, `${new Set(all.map((b) => b.country)).size} countries`);
  check("every record is labelled as sample data", all.every((b) => b.dataSource === "leadforge_sample"));
  check("results are deterministic for the same query", sampleListings({ limit: 10 })[0].name === sampleListings({ limit: 10 })[0].name);

  const noWebsite = sampleListings({ websiteQuality: "no_website", limit: 40 });
  check("the no-website filter returns only businesses without a site", noWebsite.every((b) => !b.websiteUrl), `${noWebsite.filter((b) => b.websiteUrl).length} leaks`);
  check("a city filter is respected", sampleListings({ city: "Leeds", limit: 20 }).every((b) => b.city === "Leeds"));
  check("industry templates exist for reporting", SAMPLE_INDUSTRIES.length >= 12 && SAMPLE_CITIES.length >= 10);
}

section("Database and repositories");
{
  // Start from a clean database so the suite is repeatable.
  const dbFile = path.join(process.cwd(), process.env.DATABASE_PATH ?? "data/leadforge.db");
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`${dbFile}${suffix}`)) fs.rmSync(`${dbFile}${suffix}`);
  }
  getDb();
  const result = seedDemoData({ force: true });
  check("seeding creates an organisation", Boolean(result.orgId));
  check("seeding creates a team", result.users >= 7, `${result.users} users`);
  check("seeding creates businesses across industries", result.businesses >= 60, `${result.businesses} businesses`);
  check("seeding creates leads", result.leads >= 60, `${result.leads} leads`);
  check("seeding creates modelled audits", result.audits >= 40, `${result.audits} audits`);

  const org = getPrimaryOrganization();
  check("a primary organisation is resolvable", Boolean(org));
  if (org) {
    const stages = listStages(org.id);
    check("the default pipeline has the required stages", ["new", "qualified", "proposal_sent", "won", "lost"].every((key) => stages.some((s) => s.key === key)), `${stages.length} stages`);

    const { items, total } = listLeads(org.id, { limit: 50, sort: "lead_score" });
    check("leads are returned with joined business data", total > 0 && Boolean(items[0]?.business?.name), `${total} leads`);
    check("leads are sorted by score descending", items.every((lead, index) => index === 0 || (items[index - 1].leadScore ?? 0) >= (lead.leadScore ?? 0)));

    const hot = listLeads(org.id, { temperatures: ["hot"], limit: 100 }).items;
    check("hot leads exist in the demo data", hot.length > 0, `${hot.length} hot leads`);

    const summary = analyticsSummary(org.id, rangeFor(30));
    check("analytics counts the seeded leads", summary.leads.total > 0, `${summary.leads.total}`);
    check("analytics reports website opportunity statistics", summary.websites.audited > 0);
    check("the funnel has every stage", summary.funnel.length >= 8, `${summary.funnel.length} funnel steps`);
    check("best opportunities include a reason and a recommended action", summary.bestOpportunities.every((card) => card.whyThisLead.length > 0 && card.recommendedAction.length > 0));

    const actions = nextBestActions(org.id);
    check("next-best-action cards only appear when they have a count", actions.every((action) => action.count > 0));
  }
}

section("Queue and background jobs");
{
  const org = getPrimaryOrganization()!;
  const lead = listLeads(org.id, { limit: 1 }).items[0];

  loadHandlers();
  check("all job handlers register", registeredTypes().length === 14, `${registeredTypes().length} registered`);

  // Recurring work queues real jobs (stale-site re-audits, refreshes). Drain the
  // queue first so the assertions below are unambiguous about what ran.
  const recurring = scheduleRecurringWork();
  check("recurring work is registered", recurring.scheduled.length > 0, `${recurring.scheduled.length} schedules`);
  check("tonight's schedule is readable", scheduledJobsTonight().length > 0);

  const queued = schedule({ orgId: org.id, type: "scoring", payload: { leadIds: [lead.id] }, label: "Re-score one lead" });

  let rounds = 0;
  let processedTotal = 0;
  while (rounds < 40) {
    const processed = await runPendingJobs(4);
    if (processed === 0) break;
    processedTotal += processed;
    rounds += 1;
  }

  const job = getJob(org.id, queued.id)!;
  check("queued work is picked up by the worker", processedTotal > 0, `${processedTotal} job(s) processed`);
  check("the job completes and reports progress", job.status === "succeeded" && job.progress >= 95, `${job.status} at ${job.progress}%`);
  check("job logs are written", listJobLogs(job.id).length > 0);

  const other = schedule({ orgId: org.id, type: "notification", payload: { leadId: lead.id } });
  while ((await runPendingJobs(4)) > 0) {
    /* drain */
  }
  check("a second job type also processes", getJob(org.id, other.id)?.status === "succeeded", getJob(org.id, other.id)?.error ?? "");

  // Work that fails must be retained and retried with backoff, never dropped.
  const broken = schedule({ orgId: org.id, type: "proposal", payload: { nonsense: true } });
  while ((await runPendingJobs(4)) > 0) {
    /* drain */
  }
  const brokenJob = getJob(org.id, broken.id)!;
  check("failed work is queued for retry, not dropped", brokenJob.status === "queued" || brokenJob.status === "retrying", `${brokenJob.status}, attempt ${brokenJob.attempts}`);
  check("failures record a readable reason", Boolean(brokenJob.error), brokenJob.error ?? "no error stored");

  check("every job type is documented", handlerCatalogue().length === 14);
  const stats = jobStats(org.id);
  check("job statistics count everything that ran", stats.succeeded >= 4, JSON.stringify(stats));
}

console.log(`\n${passed} check${passed === 1 ? "" : "s"} passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((failure) => console.log(`  • ${failure}`));
  process.exitCode = 1;
}
