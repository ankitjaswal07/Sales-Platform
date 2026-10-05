import "server-only";

import {
  addCampaignRecipient,
  addOptOut,
  campaignStats,
  createCampaign,
  createEmail,
  dueCampaignRecipients,
  emailsSentToday,
  getCampaign,
  isOptedOut,
  listEmails,
  markEmailFailed,
  markEmailSent,
  updateCampaign,
  updateRecipient,
} from "../db/repo/engagement";
import { getBusiness, listContacts } from "../db/repo/business";
import { getLead, recordActivity, updateLead } from "../db/repo/lead";
import { createNotification, createTask, getSetting } from "../db/repo/ops";
import { generateOutreachEmail } from "../ai";
import { applyGuardrails } from "../ai/guardrails";
import { sendEmail, emailProvider } from "./email";
import { organizationProfile } from "./org-profile";
import { notify } from "./notifications";
import type { OutreachDraft } from "../ai/local/outreach";
import type { AuditFinding, EmailStyle } from "../types";
import type { Campaign } from "../db/repo/types";
import { logger } from "../logger";
import { run } from "../db";

/**
 * Outreach engine (§24, §25, §26).
 *
 * Every message is: (1) generated from measured findings, (2) passed through
 * the guardrails, (3) checked against opt-outs and daily caps, (4) recorded
 * with its real delivery status. When no email provider is configured the
 * message is stored as `not_sent` with the exact reason — never reported as
 * delivered.
 */

export interface SpamCheck {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

/** Matches `Campaign["sequence"]` in the repository. */
export type SequenceStep = { step: number; dayOffset: number; name: string; style: EmailStyle; intent: string };

export function defaultSequence(): SequenceStep[] {
  return [
    { step: 1, dayOffset: 0, name: "The measured finding", style: "audit_based", intent: "lead_with_evidence" },
    { step: 2, dayOffset: 4, name: "Short follow-up", style: "short", intent: "ask_one_question" },
    { step: 3, dayOffset: 9, name: "What this would change", style: "value_based", intent: "show_the_outcome" },
    { step: 4, dayOffset: 15, name: "Closing the loop", style: "friendly", intent: "polite_close" },
  ];
}

export function spamChecks(orgId: string, businessId: string | null, email: string | null): SpamCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!email) {
    blockers.push("No email address is on file. Add a contact or use the website enquiry form instead.");
  } else if (isOptedOut(orgId, email)) {
    blockers.push(`${email} has opted out of contact. The platform will not send to this address again.`);
  }

  if (businessId) {
    const business = getBusiness(orgId, businessId);
    if (business && isOptedOut(orgId, business.websiteUrl ?? null)) {
      blockers.push("This business has opted out of all communication. Sending would violate their request.");
    }
  }

  const cap = Number(process.env.CAMPAIGN_DAILY_CAP ?? 40);
  const sentToday = emailsSentToday(orgId);
  if (sentToday >= cap) {
    blockers.push(`The daily send cap of ${cap} has been reached (${sentToday} sent). The cap protects your domain reputation; raise CAMPAIGN_DAILY_CAP if your provider allows it.`);
  } else if (sentToday > cap * 0.8) {
    warnings.push(`${sentToday} of ${cap} daily sends used. Long sends are spread automatically.`);
  }

  const provider = emailProvider();
  if (!provider.configured) {
    warnings.push(`No email provider is connected (${provider.provider}), so messages will be composed and recorded but not delivered. Configure ${provider.missing.join(", ")} to send.`);
  }

  return { allowed: blockers.length === 0, blockers, warnings };
}

/* ══════════════════════════════════════════════════════════════════════════
   Single-message composition
   ══════════════════════════════════════════════════════════════════════════ */

export interface ComposedEmail {
  draft: OutreachDraft;
  to: string | null;
  businessName: string;
  checks: SpamCheck;
  leadId: string | null;
  contactId: string | null;
}

export async function composeOutreach(
  orgId: string,
  leadId: string,
  options: { style?: EmailStyle; sequenceStep?: number; userId?: string | null; tone?: string } = {},
): Promise<ComposedEmail> {
  const lead = getLead(orgId, leadId);
  if (!lead) throw new Error("Lead not found in this workspace.");
  const business = lead.business ?? getBusiness(orgId, lead.businessId);
  if (!business) throw new Error("The lead's business record is missing.");

  const contacts = listContacts(orgId, { businessId: business.id, limit: 10 });
  const contact = contacts.find((c) => c.email) ?? contacts[0] ?? null;
  const profile = organizationProfile(orgId);
  const findings = ((lead as unknown as { findings?: AuditFinding[] }).findings ?? []) as AuditFinding[];

  const style = options.style ?? (options.sequenceStep && options.sequenceStep > 1 ? defaultSequence()[Math.min(options.sequenceStep, 4) - 1].style : "audit_based");

  const draft = await generateOutreachEmail(
    {
      businessName: business.name,
      contactName: contact?.name ?? null,
      industry: business.industry,
      city: business.city,
      websiteUrl: business.websiteUrl,
      rating: business.rating,
      reviewCount: business.reviewCount,
      findings,
      scores: lead.websiteScore !== null ? { overall: lead.websiteScore, opportunity: lead.opportunityScore } : null,
      agencyName: profile.name,
      agencySenderName: profile.name,
      agencyPhone: profile.phone,
      agencyWebsite: profile.website,
      auditLink: null,
      proposalLink: null,
      style,
      sequenceStep: options.sequenceStep ?? 1,
      tone: options.tone,
    },
    { orgId, userId: options.userId, entityId: leadId },
  );

  const guarded = applyGuardrails(draft.body);
  const finalDraft: OutreachDraft = { ...draft, body: guarded.text };

  return {
    draft: finalDraft,
    to: contact?.email ?? business.email,
    businessName: business.name,
    checks: spamChecks(orgId, business.id, contact?.email ?? business.email),
    leadId,
    contactId: contact?.id ?? null,
  };
}

export interface SendOutreachResult {
  ok: boolean;
  message: string;
  emailId: string | null;
  status: "sent" | "skipped" | "failed" | "blocked";
}

export async function sendOutreach(
  orgId: string,
  input: {
    leadId: string;
    to: string;
    subject: string;
    body: string;
    bodyHtml?: string;
    style?: EmailStyle;
    campaignId?: string | null;
    contactId?: string | null;
    userId?: string | null;
    /** Set when the send is part of an approved campaign rather than a manual one-off. */
    allowedByCampaign?: boolean;
  },
): Promise<SendOutreachResult> {
  const lead = getLead(orgId, input.leadId);
  if (!lead) return { ok: false, message: "Lead not found.", emailId: null, status: "blocked" };

  const checks = spamChecks(orgId, lead.businessId, input.to);
  if (!checks.allowed) {
    return { ok: false, message: checks.blockers.join(" "), emailId: null, status: "blocked" };
  }

  const guarded = applyGuardrails(input.body);
  const profile = organizationProfile(orgId);
  const body = guarded.text;
  const bodyHtml = input.bodyHtml ?? plainToHtml(body, profile.name);

  const record = createEmail(orgId, {
    campaignId: input.campaignId ?? null,
    leadId: input.leadId,
    businessId: lead.businessId,
    contactId: input.contactId ?? null,
    userId: input.userId ?? null,
    style: input.style ?? "professional",
    fromAddress: profile.email,
    toAddress: input.to,
    subject: input.subject,
    bodyText: body,
    bodyHtml,
    provider: emailProvider().provider,
    status: "queued",
  });

  const result = await sendEmail({
    orgId,
    to: input.to,
    subject: input.subject,
    text: body,
    html: bodyHtml,
    replyTo: profile.email,
    category: "outreach",
  });

  if (result.status === "sent") {
    markEmailSent(record.id, { provider: emailProvider().provider, providerMessageId: result.providerMessageId ?? null });
    updateLead(orgId, input.leadId, {
      status: lead.status === "new" ? "contacted" : lead.status,
      lastContactedAt: new Date().toISOString(),
      nextFollowUpAt: nextFollowUp(profile.followUpCadence[0] ?? 4),
      nextAction: "Check for a reply, then send the next sequence step",
    });
    recordActivity(orgId, {
      leadId: input.leadId,
      businessId: lead.businessId,
      userId: input.userId ?? null,
      type: "email_sent",
      subject: input.subject,
      body: `Sent to ${input.to} via ${emailProvider().provider}.`,
      metadata: { emailId: record.id, style: input.style ?? "professional", guardrailFlags: guarded.flags },
    });
    logger.info("outreach", "Outreach email sent", { leadId: input.leadId, to: input.to, style: input.style });
    return { ok: true, message: `Sent to ${input.to}.`, emailId: record.id, status: "sent" };
  }

  if (result.status === "skipped") {
    // Composed, recorded, not delivered — the honest state.
    run("UPDATE emails SET status = 'not_sent', error = ? WHERE id = ?", [result.detail, record.id]);
    return {
      ok: false,
      message: result.detail,
      emailId: record.id,
      status: "skipped",
    };
  }

  markEmailFailed(record.id, result.detail);
  return { ok: false, message: result.detail, emailId: record.id, status: "failed" };
}

function nextFollowUp(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function plainToHtml(body: string, agencyName: string): string {
  const escaped = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${block.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16181d"><div style="max-width:600px;margin:0 auto">${paragraphs}</div><p style="max-width:600px;margin:24px auto 0;font-size:12px;color:#8b909a">Sent by ${agencyName} using LeadForge.</p></body></html>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   Campaigns (§25)
   ══════════════════════════════════════════════════════════════════════════ */

export interface CampaignLaunchCheck {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
  recipientCount: number;
  sendableCount: number;
  estimatedDays: number;
}

export function launchChecks(orgId: string, campaignId: string): CampaignLaunchCheck {
  const campaign = getCampaign(orgId, campaignId);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!campaign) return { allowed: false, blockers: ["Campaign not found."], warnings: [], recipientCount: 0, sendableCount: 0, estimatedDays: 0 };

  const provider = emailProvider();
  if (!provider.configured) {
    warnings.push(`No email provider is connected (${provider.provider}). The campaign will run and record every message, but nothing will be delivered until ${provider.missing.join(", ")} is set.`);
  }

  const recipients = dueCampaignRecipients(1000).filter((recipient) => recipient.campaignId === campaignId);
  const contacts = campaign.targetCount || recipients.length;
  const withEmail = recipients.filter((recipient) => {
    const business = getBusiness(orgId, recipient.businessId);
    if (!business) return false;
    const email = listContacts(orgId, { businessId: business.id, limit: 5 }).find((c) => c.email)?.email ?? business.email;
    return Boolean(email);
  }).length;
  if (contacts === 0) blockers.push("This campaign has no recipients yet. Add leads from the Lead Finder or the campaign's recipient list.");
  if (contacts > 0 && withEmail === 0) {
    blockers.push("None of the recipients have a public email address on file. Enrich them first, or use the website enquiry form route.");
  }

  const cap = Number(process.env.CAMPAIGN_DAILY_CAP ?? 40);
  const estimatedDays = withEmail > 0 ? Math.ceil(withEmail / cap) : 0;

  if (warnings.length === 0 && withEmail > cap * 3) {
    warnings.push(`${withEmail} recipients at a cap of ${cap}/day means roughly ${estimatedDays} days of sending. Sequence steps are spread automatically.`);
  }

  return { allowed: blockers.length === 0, blockers, warnings, recipientCount: contacts, sendableCount: withEmail, estimatedDays };
}

export function createCampaignFromLeads(
  orgId: string,
  input: {
    name: string;
    description?: string;
    leadIds: string[];
    sequence?: SequenceStep[];
    dailyCap?: number;
    ownerId?: string | null;
    createdBy?: string | null;
    industry?: string | null;
    location?: string | null;
    criteria?: Record<string, unknown>;
  },
): { campaign: Campaign; added: number; skipped: { leadId: string; reason: string }[] } {
  const campaign = createCampaign(orgId, {
    name: input.name,
    description: input.description,
    industry: input.industry,
    location: input.location,
    criteria: input.criteria,
    sequence: input.sequence ?? defaultSequence(),
    dailyCap: input.dailyCap ?? Number(process.env.CAMPAIGN_DAILY_CAP ?? 40),
    ownerId: input.ownerId,
    requireApproval: true,
    status: "draft",
  });

  const skipped: { leadId: string; reason: string }[] = [];
  let added = 0;

  for (const leadId of input.leadIds) {
    const lead = getLead(orgId, leadId);
    if (!lead) {
      skipped.push({ leadId, reason: "Lead not found." });
      continue;
    }
    const contacts = listContacts(orgId, { businessId: lead.businessId, limit: 5 });
    const contact = contacts.find((c) => c.email) ?? null;
    const business = getBusiness(orgId, lead.businessId);

    if (!contact?.email && !business?.email) {
      skipped.push({ leadId, reason: "No public email address — needs enrichment or the website form." });
    }

    const result = addCampaignRecipient(orgId, {
      campaignId: campaign.id,
      businessId: lead.businessId,
      leadId,
      contactId: contact?.id ?? null,
      skipReason: contact?.email || business?.email ? null : "No public email address",
    });
    if (result.created) added += 1;
    else if (!result.created) skipped.push({ leadId, reason: "Already in this campaign." });
  }

  return { campaign, added, skipped };
}

export interface CampaignRunOutcome {
  processed: number;
  sent: number;
  skipped: { recipientId: string; reason: string }[];
  failed: { recipientId: string; reason: string }[];
  complete: boolean;
  stats?: ReturnType<typeof campaignStats>;
}

/**
 * One pass of a campaign. Called by the scheduled worker so long campaigns
 * respect the daily cap instead of blasting every address at once.
 */
export async function runCampaignPass(orgId: string, campaignId: string, limit = 5): Promise<CampaignRunOutcome> {
  const outcome: CampaignRunOutcome = { processed: 0, sent: 0, skipped: [], failed: [], complete: false };
  const campaign = getCampaign(orgId, campaignId);
  if (!campaign) return outcome;

  const due = dueCampaignRecipients(limit).filter((recipient) => recipient.campaignId === campaignId);
  const profile = organizationProfile(orgId);

  for (const recipient of due) {
    outcome.processed += 1;
    const business = getBusiness(orgId, recipient.businessId);
    if (!business) {
      outcome.skipped.push({ recipientId: recipient.id, reason: "Business record missing." });
      continue;
    }
    const contacts = listContacts(orgId, { businessId: business.id, limit: 5 });
    const contact = contacts.find((c) => c.id === recipient.contactId) ?? contacts.find((c) => c.email) ?? null;
    const to = contact?.email ?? business.email;

    const composed = await composeOutreach(orgId, recipient.leadId ?? "", {
      style: campaign.sequence[Math.min(recipient.step, campaign.sequence.length) - 1]?.style ?? "professional",
      sequenceStep: recipient.step,
      userId: campaign.ownerId,
    }).catch(() => null);

    if (!composed || !to) {
      const reason = !to ? "No public email address" : "Could not compose the message";
      updateRecipient(recipient.id, { state: "skipped" });
      run("UPDATE campaign_recipients SET skip_reason = ?, updated_at = ? WHERE id = ?", [reason, new Date().toISOString(), recipient.id]);
      outcome.skipped.push({ recipientId: recipient.id, reason });
      continue;
    }

    const result = await sendOutreach(orgId, {
      leadId: recipient.leadId ?? "",
      to,
      subject: composed.draft.subject,
      body: composed.draft.body,
      bodyHtml: composed.draft.bodyHtml,
      style: composed.draft.style,
      campaignId,
      contactId: contact?.id ?? null,
      userId: campaign.ownerId,
      allowedByCampaign: true,
    });

    if (result.ok) {
      outcome.sent += 1;
      updateRecipient(recipient.id, { state: "sent", step: recipient.step + 1 });
      const nextStep = campaign.sequence[recipient.step];
      if (nextStep) {
        updateRecipient(recipient.id, { nextSendAt: new Date(Date.now() + nextStep.dayOffset * 86_400_000).toISOString(), state: "scheduled" });
      } else {
        updateRecipient(recipient.id, { state: "completed" });
      }
    } else {
      outcome.failed.push({ recipientId: recipient.id, reason: result.message });
      updateRecipient(recipient.id, { state: result.status === "skipped" ? "not_sent" : "failed" });
      run("UPDATE campaign_recipients SET skip_reason = ?, updated_at = ? WHERE id = ?", [result.message, new Date().toISOString(), recipient.id]);
    }
  }

  const remaining = dueCampaignRecipients(1000).filter((recipient) => recipient.campaignId === campaignId).length;
  const stats = campaignStats(campaignId);
  const complete = remaining === 0;
  if (complete && campaign.status === "active") {
    updateCampaign(orgId, campaignId, { status: "completed", completedAt: new Date().toISOString() });
    notify(orgId, {
      type: "campaign_completed",
      title: `Campaign finished: ${campaign.name}`,
      body: `${stats.sent} sent · ${stats.replied} replied · ${stats.interested} interested · ${stats.converted} converted.`,
      entityType: "campaign",
      entityId: campaignId,
      actionUrl: `/campaigns/${campaignId}`,
      severity: "success",
    });
  }

  void profile;
  return { ...outcome, complete, stats };
}

/* ══════════════════════════════════════════════════════════════════════════
   Replies, opt-outs and contact hygiene
   ══════════════════════════════════════════════════════════════════════════ */

export function handleOptOut(orgId: string, input: { email?: string | null; domain?: string | null; reason?: string; leadId?: string | null }): void {
  addOptOut(orgId, { email: input.email ?? null, domain: input.domain ?? null, reason: input.reason ?? "Requested no further contact" });
  if (input.leadId) {
    const lead = getLead(orgId, input.leadId);
    if (lead) {
      updateLead(orgId, input.leadId, { status: "not_interested", nextAction: "Suppressed — do not contact again", nextFollowUpAt: null });
      recordActivity(orgId, {
        leadId: input.leadId,
        businessId: lead.businessId,
        userId: null,
        type: "opt_out",
        subject: "Opted out of contact",
        body: input.reason ?? "The recipient asked not to be contacted again. All future sends are suppressed automatically.",
        isSystem: true,
      });
    }
  }
  logger.info("outreach", "Opt-out recorded", { email: input.email, domain: input.domain });
}

export function outreachHistory(orgId: string, leadId: string) {
  return listEmails(orgId, { leadId, limit: 50 }).items;
}

export function followUpQueue(orgId: string) {
  const cap = getSetting(orgId, "outreach", "daily_cap", Number(process.env.CAMPAIGN_DAILY_CAP ?? 40));
  return { cap, sentToday: emailsSentToday(orgId), remaining: Math.max(0, cap - emailsSentToday(orgId)) };
}

export function notifyReply(orgId: string, input: { businessName: string; leadId: string; summary: string; intent: string; intentScore: number }): void {
  createNotification(orgId, {
    type: "new_response",
    title: `${input.businessName} replied`,
    body: `${input.summary} (detected intent: ${input.intent.replace(/_/g, " ")}, ${input.intentScore}/100)`,
    entityType: "lead",
    entityId: input.leadId,
    actionUrl: `/leads/${input.leadId}?tab=conversation`,
    severity: input.intentScore >= 70 ? "critical" : "info",
    icon: "mail",
  });
  if (input.intentScore >= 70) {
    const lead = getLead(orgId, input.leadId);
    createTask(orgId, {
      title: `Reply to ${input.businessName} — high intent`,
      description: input.summary,
      type: "reply",
      priority: "urgent",
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      leadId: input.leadId,
      businessId: lead?.businessId ?? null,
      assignedUserId: lead?.ownerId ?? null,
    });
  }
}
