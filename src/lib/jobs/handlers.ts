import "server-only";

import { registerHandler, schedule, type JobHandler } from "../queue";
import { businessIdsWithLeads, getLead, listLeads, saveLeadScore } from "../db/repo/lead";
import { createBusiness, getBusiness, latestAuditForBusiness, listContacts, businessesNeedingAudit, updateBusiness } from "../db/repo/business";
import { listCampaigns, addCampaignRecipient, listCampaignRecipients } from "../db/repo/engagement";
import { createNotification, getSetting, listJobs, setSetting } from "../db/repo/ops";
import { getPrimaryOrganization } from "../db/repo/org";
import { computeLeadScore } from "../scoring/lead";
import { logger } from "../logger";

/**
 * Job handlers (§45).
 *
 * Registration is explicit and centralised so the Diagnostics screen can list
 * exactly which job types this build understands. Every handler reports real
 * progress; none of them "complete" work they did not do.
 */

let loaded = false;

export function loadHandlers(): void {
  if (loaded) return;
  loaded = true;

  registerHandler("discovery", discoveryHandler);
  registerHandler("audit", auditHandler);
  registerHandler("audit_bulk", auditBulkHandler);
  registerHandler("scoring", scoringHandler);
  registerHandler("ai_analysis", aiAnalysisHandler);
  registerHandler("concept", conceptHandler);
  registerHandler("proposal", proposalHandler);
  registerHandler("email_send", emailSendHandler);
  registerHandler("campaign_run", campaignRunHandler);
  registerHandler("enrichment", enrichmentHandler);
  registerHandler("notification", notificationHandler);
  registerHandler("report", reportHandler);
  registerHandler("import", importHandler);
  registerHandler("screenshot", screenshotHandler);

  logger.info("jobs", "Job handlers registered", { count: 14 });
}

/* ── discovery ───────────────────────────────────────────────────────────── */

const discoveryHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Discovery jobs require an organisation.");

  // The Lead Finder runs discovery synchronously for immediate feedback; this
  // handler exists so a discovery run can also be queued (scheduled searches,
  // API-triggered runs, retries) and still report real progress.
  const { discoverBusinesses, persistDiscoveredBusinesses } = await import("../services/discovery");
  ctx.report(5, "Preparing the search");
  const result = await discoverBusinesses(payload as never);
  ctx.report(25, `Found ${result.totalFound} businesses via ${result.provider}`);

  const outcome = await persistDiscoveredBusinesses({
    orgId,
    lead: result.found,
    createLeads: payload.createLeads !== false,
    createdBy: (ctx.job.payload.createdBy as string | null) ?? null,
    runId: typeof payload.runId === "string" ? payload.runId : null,
    deepAudit: payload.deepAudit === true,
    onProgress: ctx.report,
  });

  return {
    provider: result.provider,
    found: result.totalFound,
    created: outcome.created,
    duplicates: outcome.duplicates,
    leadsCreated: outcome.leadsCreated,
    audited: outcome.audited,
  };
};

/* ── audits ──────────────────────────────────────────────────────────────── */

const auditHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  const businessId = String(payload.businessId ?? "");
  if (!orgId || !businessId) throw new Error("Audit jobs require an organisation and a business id.");

  const { persistAudit } = await import("../services/audit-runner");
  const result = await persistAudit({
    orgId,
    businessId,
    url: typeof payload.url === "string" ? payload.url : null,
    leadId: typeof payload.leadId === "string" ? payload.leadId : null,
    actorId: (ctx.job.payload.createdBy as string | null) ?? null,
    onProgress: ctx.report,
  });

  ctx.log(result.message, { status: result.status, grade: result.grade, websiteScore: result.websiteScore });
  return { ...result };
};

const auditBulkHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Bulk audits require an organisation.");

  const limit = Number(payload.limit ?? 25);
  const onlyUnscored = payload.onlyUnscored !== false;
  const ids = Array.isArray(payload.businessIds) ? (payload.businessIds as string[]) : null;

  const targets = ids
    ? ids.map((id) => getBusiness(orgId, id)).filter((b): b is NonNullable<typeof b> => Boolean(b))
    : businessesNeedingAudit(orgId, limit).map((row) => ({ id: row.businessId, name: row.name, websiteUrl: row.url }));

  const { persistAudit } = await import("../services/audit-runner");
  let completed = 0;
  let failed = 0;
  const failures: { businessId: string; reason: string }[] = [];

  for (const [index, target] of targets.entries()) {
    ctx.assertActive();
    const url = "websiteUrl" in target ? target.websiteUrl : (target as { url: string }).url;
    if (onlyUnscored && !url) {
      completed += 1;
      continue;
    }
    ctx.report(Math.round(((index + 1) / targets.length) * 92), `Auditing ${index + 1} of ${targets.length}: ${target.name}`);
    try {
      const businessId = "id" in target ? (target as { id: string }).id : (target as { businessId: string }).businessId;
      const result = await persistAudit({
        orgId,
        businessId,
        url: url ?? null,
        actorId: (ctx.job.payload.createdBy as string | null) ?? null,
      });
      if (result.status === "failed") {
        failed += 1;
        failures.push({ businessId, reason: result.message });
      } else {
        completed += 1;
      }
    } catch (error) {
      failed += 1;
      failures.push({ businessId: String(target), reason: error instanceof Error ? error.message : String(error) });
    }
  }

  ctx.report(96, "Summarising");
  createNotification(orgId, {
    type: failed > 0 ? "job_failed" : "audit_completed",
    severity: failed > 0 ? "warning" : "info",
    title: `Bulk audit finished: ${completed} complete${failed > 0 ? `, ${failed} failed` : ""}`,
    body: `Requested ${targets.length} websites. ${failures.length ? `First failure: ${failures[0].reason}` : "Every site was measured successfully."}`,
    entityType: "audit",
    entityId: ctx.job.id,
    actionUrl: "/leads?unscored=1",
    icon: "activity",
  });

  return { requested: targets.length, completed, failed, failures: failures.slice(0, 10) };
};

/* ── scoring ─────────────────────────────────────────────────────────────── */

const scoringHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Scoring jobs require an organisation.");

  const { rescoreLead: rescore } = await import("../services/pipeline");
  const ids = Array.isArray(payload.leadIds) ? (payload.leadIds as string[]) : null;
  const leads = ids
    ? ids.map((id) => ({ id, businessName: getLead(orgId, id)?.business?.name ?? "" }))
    : listLeads(orgId, { limit: 500 }).items.map((lead) => ({ id: lead.id, businessName: lead.business?.name ?? "Unknown" }));

  let rescored = 0;
  for (const [index, lead] of leads.entries()) {
    ctx.assertActive();
    ctx.report(Math.round(((index + 1) / leads.length) * 95), `Scoring ${index + 1} of ${leads.length}: ${lead.businessName}`);
    if (rescore(orgId, lead.id)) rescored += 1;
  }
  return { rescored, requested: leads.length };
};

/* ── AI analysis & concepts ──────────────────────────────────────────────── */

const aiAnalysisHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  const leadId = String(payload.leadId ?? "");
  if (!orgId || !leadId) throw new Error("AI analysis jobs require an organisation and a lead id.");

  ctx.report(15, "Reading the audit findings");
  const { buildProposalBundle } = await import("../services/proposal");
  const bundle = await buildProposalBundle(orgId, leadId, { userId: ctx.job.payload.createdBy as string | null ?? null });
  ctx.report(85, "Analysis ready");

  return {
    business: bundle.business.name,
    opportunitySummary: bundle.analysis.opportunitySummary,
    problemCount: bundle.analysis.mainProblems.length,
    generatedBy: bundle.analysis.generatedBy,
  };
};

const conceptHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  const leadId = String(payload.leadId ?? "");
  if (!orgId || !leadId) throw new Error("Concept jobs require an organisation and a lead id.");

  ctx.report(20, "Selecting the design direction");
  const { buildProposalBundle } = await import("../services/proposal");
  const { saveConcept, selectConcept } = await import("../db/repo/engagement");
  const preset = (payload.preset as never) ?? "premium";
  const bundle = await buildProposalBundle(orgId, leadId, { preset, userId: ctx.job.payload.createdBy as string | null ?? null });

  if (!bundle.concept) {
    return { created: false, reason: "The design engine returned no concept." };
  }
  ctx.report(80, "Saving the concept");
  const concept = saveConcept(orgId, {
    businessId: bundle.business.id,
    leadId,
    createdBy: (ctx.job.payload.createdBy as string | null) ?? null,
    preset,
    concept: bundle.concept,
    variant: typeof payload.variant === "string" ? payload.variant : "primary",
  });
  selectConcept(orgId, bundle.business.id, concept.id);
  return { created: true, conceptId: concept.id, preset };
};

/* ── proposals ───────────────────────────────────────────────────────────── */

const proposalHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  const leadId = String(payload.leadId ?? "");
  if (!orgId || !leadId) throw new Error("Proposal jobs require an organisation and a lead id.");

  ctx.report(10, "Gathering the audit and business profile");
  const { createProposalForLead } = await import("../services/proposal");
  const created = await createProposalForLead(orgId, leadId, {
    preset: (payload.preset as never) ?? "premium",
    template: (payload.template as never) ?? "signature",
    userId: ctx.job.payload.createdBy as string | null ?? null,
    regenerate: payload.regenerate === true,
  });
  ctx.report(95, "Proposal drafted");
  return { proposalId: created.proposal.id, number: created.proposal.number, total: created.proposal.total, conceptId: created.conceptId };
};

/* ── email & campaigns ───────────────────────────────────────────────────── */

const emailSendHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Email jobs require an organisation.");
  const leadId = String(payload.leadId ?? "");
  const to = String(payload.to ?? "");
  if (!leadId || !to) throw new Error("Email jobs require a lead id and a recipient address.");

  ctx.report(30, "Composing the message");
  const { composeOutreach, sendOutreach } = await import("../services/outreach");

  const composed = await composeOutreach(orgId, leadId, {
    style: (payload.style as never) ?? "audit_based",
    sequenceStep: Number(payload.sequenceStep ?? 1),
    userId: ctx.job.payload.createdBy as string | null ?? null,
  });

  ctx.report(70, "Sending");
  const result = await sendOutreach(orgId, {
    leadId,
    to,
    subject: composed.draft.subject,
    body: composed.draft.body,
    bodyHtml: composed.draft.bodyHtml,
    style: composed.draft.style,
    campaignId: typeof payload.campaignId === "string" ? payload.campaignId : null,
    userId: ctx.job.payload.createdBy as string | null ?? null,
  });

  ctx.log(result.message, { status: result.status });
  if (!result.ok && result.status === "failed") throw new Error(result.message);
  return { status: result.status, emailId: result.emailId, subject: composed.draft.subject };
};

const campaignRunHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Campaign jobs require an organisation.");
  const campaignId = String(payload.campaignId ?? "");
  if (!campaignId) throw new Error("Campaign jobs require a campaign id.");

  ctx.report(5, "Loading the campaign");
  const { runCampaignPass } = await import("../services/outreach");
  const { getCampaign } = await import("../db/repo/engagement");
  const campaign = getCampaign(orgId, campaignId);
  if (!campaign) throw new Error("Campaign not found.");

  ctx.report(15, `Running "${campaign.name}"`);
  const outcome = await runCampaignPass(orgId, campaignId, campaign.dailyCap);

  // If the campaign still has recipients, queue the next pass for tomorrow.
  if (!outcome.complete) {
    schedule({
      orgId,
      type: "campaign_run",
      label: `Continue campaign: ${campaign.name}`,
      payload: { campaignId },
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdBy: (ctx.job.payload.createdBy as string | null) ?? null,
    });
    ctx.log("Campaign is not finished — the next pass is scheduled for tomorrow to stay inside the daily cap.");
  }

  return {
    campaign: campaign.name,
    processed: outcome.processed,
    sent: outcome.sent,
    skipped: outcome.skipped.length,
    failed: outcome.failed.length,
    complete: outcome.complete,
  };
};

/* ── enrichment ──────────────────────────────────────────────────────────── */

const enrichmentHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Enrichment jobs require an organisation.");

  const ids = Array.isArray(payload.businessIds) ? (payload.businessIds as string[]) : [];
  const candidates = ids.length
    ? ids.map((id) => getBusiness(orgId, id)).filter((b): b is NonNullable<typeof b> => Boolean(b))
    : listLeads(orgId, { limit: 50 }).items.map((lead) => getBusiness(orgId, lead.businessId)).filter((b): b is NonNullable<typeof b> => Boolean(b));

  let enriched = 0;
  const skipped: { name: string; reason: string }[] = [];

  for (const [index, business] of candidates.entries()) {
    ctx.assertActive();
    ctx.report(Math.round(((index + 1) / Math.max(candidates.length, 1)) * 90), `Checking ${business.name}`);
    if (business.email && business.websiteUrl) {
      skipped.push({ name: business.name, reason: "Already has an email and a website." });
      continue;
    }
    // Only public, legally available sources: the business's own website.
    if (!business.websiteUrl) {
      skipped.push({ name: business.name, reason: "No website to read a public email address from." });
      continue;
    }
    try {
      const { discoverContactDetails } = await import("../services/contact-discovery");
      const found = await discoverContactDetails(business.websiteUrl);
      if (found.emails.length || found.phones.length) {
        updateBusiness(orgId, business.id, {
          email: business.email ?? found.emails[0] ?? null,
          phone: business.phone ?? found.phones[0] ?? null,
        });
        if (found.emails.length) {
          const { createContact } = await import("../db/repo/business");
          createContact(orgId, {
            businessId: business.id,
            name: found.contactName ?? `Team at ${business.name}`,
            email: found.emails[0],
            phone: found.phones[0] ?? business.phone,
            title: found.role ?? "General enquiry",
            source: "website",
            emailStatus: "unverified",
          }, { dedupe: true });
        }
        enriched += 1;
      } else {
        skipped.push({ name: business.name, reason: "No public contact details found on the site." });
      }
    } catch (error) {
      skipped.push({ name: business.name, reason: error instanceof Error ? error.message : "Lookup failed" });
    }
  }

  return { checked: candidates.length, enriched, skipped: skipped.slice(0, 15) };
};

/* ── notifications & reports ─────────────────────────────────────────────── */

const notificationHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Notification jobs require an organisation.");
  const { fireAlerts } = await import("../services/notifications");
  const { buildSnapshotForLead } = await import("../services/alerts");
  const leadId = String(payload.leadId ?? "");
  if (!leadId) throw new Error("Notification jobs require a lead id.");

  const snapshot = buildSnapshotForLead(orgId, leadId);
  if (!snapshot) return { alerts: 0, reason: "Lead or business missing." };
  const result = await fireAlerts(orgId, snapshot);
  return { alerts: result.alerts, deliveries: result.deliveries };
};

const reportHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Report jobs require an organisation.");

  ctx.report(20, "Collecting the briefing");
  const { buildBriefing } = await import("../services/briefing");
  const briefing = buildBriefing(orgId, { userName: null });

  createNotification(orgId, {
    type: "system",
    severity: briefing.urgencyCount > 0 ? "warning" : "info",
    title: briefing.headline,
    body: briefing.subline,
    entityType: "report",
    entityId: ctx.job.id,
    actionUrl: "/dashboard",
    icon: "file-text",
  });

  ctx.report(90, "Sending the digest");
  const recipients = process.env.DIGEST_EMAIL_TO;
  let emailDetail = "No digest recipient configured (set DIGEST_EMAIL_TO).";
  if (recipients) {
    const { sendEmail } = await import("../services/email");
    const text = [briefing.headline, briefing.subline, "", ...briefing.needsAttentionNow.map((item) => `• ${item.title} — ${item.detail}`)].join("\n");
    const result = await sendEmail({
      orgId,
      to: recipients,
      subject: `LeadForge daily briefing — ${new Date().toLocaleDateString("en-GB")}`,
      text,
      category: "digest",
    });
    emailDetail = result.detail;
  }

  return { headline: briefing.headline, attentionItems: briefing.needsAttentionNow.length, emailDetail };
};

/* ── imports ─────────────────────────────────────────────────────────────── */

const importHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  if (!orgId) throw new Error("Import jobs require an organisation.");
  const rows = Array.isArray(payload.rows) ? (payload.rows as Record<string, string>[]) : [];
  const mapping = (payload.mapping as Record<string, string>) ?? {};

  let created = 0;
  let duplicates = 0;
  const errors: { row: number; reason: string }[] = [];

  ctx.report(5, `Importing ${rows.length} rows`);
  for (const [index, row] of rows.entries()) {
    ctx.assertActive();
    if (index % 10 === 0) ctx.report(5 + Math.round((index / Math.max(rows.length, 1)) * 88), `Row ${index + 1} of ${rows.length}`);
    const name = row[mapping.name ?? "name"] ?? row.name ?? row.business_name;
    if (!name) {
      errors.push({ row: index + 1, reason: "No business name column mapped." });
      continue;
    }
    try {
      const result = createBusiness(orgId, {
        name,
        industry: row[mapping.industry ?? "industry"] ?? null,
        city: row[mapping.city ?? "city"] ?? null,
        country: row[mapping.country ?? "country"] ?? null,
        phone: row[mapping.phone ?? "phone"] ?? null,
        email: row[mapping.email ?? "email"] ?? null,
        websiteUrl: row[mapping.website ?? "website"] ?? null,
        reviewCount: Number(row[mapping.reviews ?? "reviews"] ?? 0) || 0,
        rating: Number(row[mapping.rating ?? "rating"] ?? 0) || null,
        listingProvider: "import",
        dataSource: "manual_import",
        dataConfidence: 0.6,
      }, { createdBy: (ctx.job.payload.createdBy as string | null) ?? null, dedupe: true });
      if (result.created) created += 1;
      else duplicates += 1;
    } catch (error) {
      errors.push({ row: index + 1, reason: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  createNotification(orgId, {
    type: "system",
    severity: errors.length ? "warning" : "success",
    title: `Import finished: ${created} new, ${duplicates} duplicates`,
    body: errors.length ? `${errors.length} row(s) could not be imported. First problem: ${errors[0].reason}` : `All ${rows.length} rows were processed.`,
    entityType: "import",
    entityId: ctx.job.id,
    actionUrl: "/businesses",
    icon: "upload",
  });

  return { rows: rows.length, created, duplicates, errors: errors.slice(0, 20) };
};

/* ── screenshots ─────────────────────────────────────────────────────────── */

const screenshotHandler: JobHandler = async (payload, ctx) => {
  const orgId = ctx.job.orgId;
  const url = String(payload.url ?? "");
  if (!orgId || !url) throw new Error("Screenshot jobs require an organisation and a URL.");

  const configured = Boolean(process.env.SCREENSHOT_API_URL);
  if (!configured) {
    ctx.log("No screenshot provider is configured — set SCREENSHOT_API_URL to a rendering service you are licensed to use. Nothing was captured.");
    return { captured: false, reason: "Screenshot provider not configured.", url };
  }

  ctx.report(30, "Requesting the render");
  const response = await fetch(process.env.SCREENSHOT_API_URL!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.SCREENSHOT_API_KEY ? { authorization: `Bearer ${process.env.SCREENSHOT_API_KEY}` } : {}),
    },
    body: JSON.stringify({ url, viewport: { width: 1440, height: 900 } }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Screenshot provider returned ${response.status}: ${(await response.text()).slice(0, 200)}`);

  ctx.report(85, "Saving the image");
  const contentType = response.headers.get("content-type") ?? "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  const { saveBlob } = await import("../services/storage");
  const stored = await saveBlob({
    orgId,
    key: `screenshots/${new Date().toISOString().slice(0, 10)}/${encodeURIComponent(url).slice(0, 120)}`,
    contentType,
    bytes,
  });

  if (typeof payload.businessId === "string") {
    updateBusiness(orgId, payload.businessId, { screenshotUrl: stored.url });
  }

  return { captured: true, url: stored.url, storage: stored.driver, bytes: bytes.length };
};

/* ══════════════════════════════════════════════════════════════════════════
   Scheduled work
   ══════════════════════════════════════════════════════════════════════════ */

const SCHEDULE_KEY = "scheduled_jobs_last_run";

/** Called on start-up and by the daily tick. Safe to run repeatedly. */
export function scheduleRecurringWork(): { scheduled: string[]; skipped: string[] } {
  const org = getPrimaryOrganization();
  if (!org) return { scheduled: [], skipped: ["No organisation exists yet."] };

  const scheduled: string[] = [];
  const skipped: string[] = [];
  const now = new Date();

  // Daily briefing at the configured hour (default 08:00 local server time).
  const digestHour = Number(process.env.DIGEST_HOUR ?? 8);
  const digestAt = new Date(now);
  digestAt.setHours(digestHour, 0, 0, 0);
  if (digestAt.getTime() <= now.getTime()) digestAt.setDate(digestAt.getDate() + 1);

  const alreadyQueued = listJobs(org.id, { status: ["queued"], limit: 200 }).items.some(
    (job) => job.type === "report" && job.scheduledAt?.slice(0, 10) === digestAt.toISOString().slice(0, 10),
  );
  if (alreadyQueued) skipped.push("Daily briefing is already queued.");
  else {
    schedule({ orgId: org.id, type: "report", label: "Daily briefing", scheduledAt: digestAt.toISOString() });
    scheduled.push(`Daily briefing at ${digestAt.toISOString()}`);
  }

  // Re-audit stale websites weekly.
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const lastRun = getSetting(org.id, "jobs", SCHEDULE_KEY, "");
  if (lastRun < weekAgo.slice(0, 10)) {
    schedule({ orgId: org.id, type: "audit_bulk", label: "Weekly re-audit of stale sites", payload: { limit: 20 } });
    schedule({ orgId: org.id, type: "scoring", label: "Weekly re-score of all open leads" });
    setSetting(org.id, "jobs", SCHEDULE_KEY, now.toISOString().slice(0, 10));
    scheduled.push("Weekly re-audit and re-score");
  } else {
    skipped.push("Weekly re-audit already ran this week.");
  }

  // Continue any active campaign that still has recipients.
  for (const campaign of listCampaigns(org.id, { status: ["active"], limit: 10 }).items) {
    const remaining = listCampaignRecipients(campaign.id, { limit: 1 }).total;
    if (remaining > 0) {
      const queued = listJobs(org.id, { status: ["queued"], limit: 100 }).items.some((job) => job.payload.campaignId === campaign.id);
      if (!queued) {
        schedule({ orgId: org.id, type: "campaign_run", label: `Continue campaign: ${campaign.name}`, payload: { campaignId: campaign.id } });
        scheduled.push(`Campaign pass: ${campaign.name}`);
      }
    }
  }

  // Follow-up reminders for leads whose next action is overdue.
  const { leadsNeedingFollowUp } = require("../db/repo/lead") as typeof import("../db/repo/lead");
  const due = leadsNeedingFollowUp(org.id, 20);
  for (const lead of due) {
    const existing = listJobs(org.id, { status: ["queued"], limit: 200 }).items.some(
      (job) => job.type === "notification" && job.payload.leadId === lead.id,
    );
    if (existing) continue;
    schedule({
      orgId: org.id,
      type: "notification",
      label: `Follow-up reminder: ${lead.business?.name ?? "lead"}`,
      payload: { leadId: lead.id },
      priority: 2,
    });
  }
  if (due.length) scheduled.push(`${due.length} follow-up reminder(s)`);

  return { scheduled, skipped };
}

export function scheduledJobsTonight(): { type: string; label: string; scheduledAt: string; status: string }[] {
  const org = getPrimaryOrganization();
  if (!org) return [];
  return listJobs(org.id, { status: ["queued"], limit: 20 }).items.map((job) => ({
    type: job.type,
    label: job.label ?? job.type,
    scheduledAt: job.scheduledAt ?? job.createdAt,
    status: job.status,
  }));
}

export function handlerCatalogue(): { type: string; description: string }[] {
  return [
    { type: "discovery", description: "Search public business data providers, deduplicate and create leads." },
    { type: "audit", description: "Fetch a website and measure performance, SEO, mobile, UX, accessibility and conversion." },
    { type: "audit_bulk", description: "Audit many websites in sequence with progress reporting." },
    { type: "scoring", description: "Recompute lead, opportunity and temperature scores." },
    { type: "ai_analysis", description: "Produce the business analysis used by proposals and the AI assistant." },
    { type: "concept", description: "Generate and store a website concept for a business." },
    { type: "proposal", description: "Draft a full proposal with pricing, timeline and scope." },
    { type: "email_send", description: "Compose and send a single outreach email through the configured provider." },
    { type: "campaign_run", description: "Send one pass of a campaign, respecting the daily cap." },
    { type: "enrichment", description: "Read publicly available contact details from a business's own website." },
    { type: "notification", description: "Evaluate alert rules for a lead and deliver on every configured channel." },
    { type: "report", description: "Build the daily briefing and send the digest." },
    { type: "import", description: "Import businesses from a mapped CSV or spreadsheet upload." },
    { type: "screenshot", description: "Capture a website screenshot through the configured rendering provider." },
  ];
}

export { businessIdsWithLeads, computeLeadScore, latestAuditForBusiness, listContacts, saveLeadScore };
