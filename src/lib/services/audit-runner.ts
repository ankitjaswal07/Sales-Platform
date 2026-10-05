import "server-only";

import { createAudit, getBusiness, latestAuditForBusiness, saveAudit, updateBusiness, upsertWebsite, websiteForBusiness, listContacts } from "../db/repo/business";
import { getLeadByBusiness, recordActivity, saveLeadScore, updateLead } from "../db/repo/lead";
import { notify } from "./notifications";
import { runAudit } from "../audit/engine";
import { logger } from "../logger";
import { computeLeadScore } from "../scoring/lead";
import { toBusinessInput } from "./discovery";

/**
 * Audit orchestration: run the engine, persist the report, then re-score the
 * associated lead and fire any notifications that follow from the result.
 */

export interface AuditRunInput {
  orgId: string;
  businessId: string;
  url?: string | null;
  leadId?: string | null;
  actorId?: string | null;
  maxPages?: number;
  skipPageSpeed?: boolean;
  onProgress?: (percent: number, stage: string) => void;
}

export interface AuditRunResult {
  auditId: string;
  websiteScore: number | null;
  leadScore: number;
  status: "complete" | "failed" | "blocked";
  message: string;
  grade: string;
  criticalFindings: number;
  durationMs: number;
}

export async function persistAudit(input: AuditRunInput): Promise<AuditRunResult> {
  const started = Date.now();
  const business = getBusiness(input.orgId, input.businessId);
  if (!business) throw new Error(`Business ${input.businessId} was not found in this workspace.`);

  const url = input.url ?? business.websiteUrl;
  if (!url) {
    // No website is not a failure — it is the strongest possible opportunity.
    const lead = input.leadId ? null : getLeadByBusiness(input.orgId, input.businessId);
    const leadId = input.leadId ?? lead?.id ?? null;
    if (leadId) {
      const score = computeLeadScore(
        toBusinessInput(business),
        { exists: false, scores: null },
        contactSignals(input.orgId, business.id, business),
      );
      saveLeadScore(input.orgId, leadId, score);
      updateLead(input.orgId, leadId, { websiteScore: null, nextAction: score.nextAction });
      return {
        auditId: "",
        websiteScore: null,
        leadScore: score.total,
        status: "blocked",
        message: "No website found for this business. Recorded as the maximum website opportunity — there is nothing to audit, and nothing to migrate.",
        grade: "—",
        criticalFindings: 0,
        durationMs: Date.now() - started,
      };
    }
    return {
      auditId: "",
      websiteScore: null,
      leadScore: 0,
      status: "blocked",
      message: "No website found and no lead to score.",
      grade: "—",
      criticalFindings: 0,
      durationMs: Date.now() - started,
    };
  }

  const website = upsertWebsite(input.orgId, business.id, url);
  const audit = createAudit(input.orgId, {
    businessId: business.id,
    websiteId: website.id,
    status: "running",
    mode: "live",
  });

  try {
    input.onProgress?.(10, "Fetching the website");
    const outcome = await runAudit(url, {
      maxPages: input.maxPages ?? 6,
      skipPageSpeed: input.skipPageSpeed,
      onProgress: (percent, stage) => input.onProgress?.(10 + Math.round(percent * 0.75), stage),
    });

    const report = outcome.report;
    input.onProgress?.(90, "Saving results");

    saveAudit(input.orgId, audit.id, {
      status: report.blockedByRobots ? "blocked" : "complete",
      overallScore: report.overallScore,
      scores: outcome.scores,
      metrics: report.metrics,
      findings: report.findings,
      opportunities: report.priorityImprovements,
      pages: report.pages,
      tech: outcome.techStack,
      coreWebVitals: report.coreWebVitals as unknown as Record<string, unknown>,
      error: report.error ?? null,
      durationMs: report.durationMs,
      notes: report.blockedByRobots ? "The site's robots.txt disallows our crawler user-agent, so analysis was limited to a respectful refusal." : null,
    });

    updateBusiness(input.orgId, business.id, {
      websiteStatus: report.reachable
        ? report.overallScore >= 85
          ? "excellent"
          : report.overallScore >= 70
            ? "good"
            : report.overallScore >= 55
              ? "average"
              : report.overallScore >= 40
                ? "poor"
                : "very_poor"
        : "broken",
    });

    const refreshed = getBusiness(input.orgId, business.id)!;
    const critical = report.findings.filter((f) => f.severity === "critical").length;

    const lead = input.leadId ? null : getLeadByBusiness(input.orgId, business.id);
    const leadId = input.leadId ?? lead?.id ?? null;
    let leadScore = 0;

    if (leadId) {
      const score = computeLeadScore(
        toBusinessInput(refreshed),
        {
          exists: true,
          reachable: report.reachable,
          https: report.https,
          scores: outcome.scores,
          cms: outcome.cms,
          copyrightYear: findCopyrightYear(report),
          findingsCount: report.findings.length,
          criticalFindings: critical,
          hasForm: !report.findings.some((f) => f.title.includes("No enquiry form")),
          hasAnalytics: !report.findings.some((f) => f.title.includes("No analytics")),
        },
        contactSignals(input.orgId, business.id, refreshed),
      );
      saveLeadScore(input.orgId, leadId, score);
      leadScore = score.total;

      updateLead(input.orgId, leadId, {
        websiteScore: report.overallScore,
        opportunityScore: outcome.scores.conversion !== undefined ? score.websiteOpportunity : score.websiteOpportunity,
        nextAction: score.nextAction,
      });

      recordActivity(input.orgId, {
        leadId,
        businessId: business.id,
        userId: input.actorId ?? null,
        type: "audit_complete",
        subject: `Website audit complete — ${report.overallScore}/100 (${report.grade})`,
        body: `${report.findings.length} findings, ${critical} of them critical. ${report.durationMs}ms total.`,
        metadata: {
          auditId: audit.id,
          scores: outcome.scores,
          critical,
          pagesAnalyzed: report.pages.length,
          coreWebVitals: report.coreWebVitals.source,
        },
        isSystem: true,
      });

      notify(input.orgId, {
        type: "audit_completed",
        title: `Audit complete: ${business.name} scored ${report.overallScore}/100`,
        body: `${critical} critical and ${report.findings.filter((f) => f.severity === "high").length} high-severity findings. Lead score recalculated to ${score.total}.`,
        entityType: "lead",
        entityId: leadId,
        actionUrl: `/leads/${leadId}?tab=audit`,
      });

      // A very poor site on an established business is a hot signal on its own.
      if (score.temperature === "hot") {
        updateLead(input.orgId, leadId, { priority: 1 });
      }
    }

    logger.info("audit", "Audit complete", {
      business: business.name,
      url: report.finalUrl,
      score: report.overallScore,
      findings: report.findings.length,
      cwv: report.coreWebVitals.source,
      durationMs: report.durationMs,
    });

    return {
      auditId: audit.id,
      websiteScore: report.overallScore,
      leadScore,
      status: report.blockedByRobots ? "blocked" : "complete",
      message: report.blockedByRobots
        ? "The site's robots.txt disallows our crawler. Nothing was measured."
        : `Measured ${report.pages.length} page${report.pages.length === 1 ? "" : "s"} and ${report.findings.length} findings across ${report.dimensions ? Object.keys(report.dimensions).length : 0} dimensions.`,
      grade: report.grade,
      criticalFindings: critical,
      durationMs: report.durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    saveAudit(input.orgId, audit.id, { status: "failed", error: message, durationMs: Date.now() - started });
    logger.error("audit", "Audit failed", { business: business.name, url, error: message });
    notify(input.orgId, {
      type: "job_failed",
      title: `Website audit failed for ${business.name}`,
      body: `${message}. The audit can be retried from the lead's Website Audit tab.`,
      entityType: "business",
      entityId: business.id,
      actionUrl: `/audits?businessId=${business.id}`,
    });
    return {
      auditId: audit.id,
      websiteScore: null,
      leadScore: 0,
      status: "failed",
      message,
      grade: "—",
      criticalFindings: 0,
      durationMs: Date.now() - started,
    };
  }
}

function contactSignals(
  orgId: string,
  businessId: string,
  business: { email: string | null; phone: string | null; websiteUrl: string | null },
): { hasNamedContact: boolean; hasEmail: boolean; hasPhone: boolean; emailVerified?: boolean; emailStatus?: string | null } {
  const contacts = listContacts(orgId, { businessId, limit: 5 });
  const named = contacts.find((c) => c.name && !/^(info|hello|enquiries|contact)$/i.test(c.name));
  const contactEmail = contacts.find((c) => c.email)?.email ?? business.email;
  const contactPhone = contacts.find((c) => c.phone)?.phone ?? business.phone;
  const emailStatus = contacts.find((c) => c.email)?.emailStatus ?? null;

  return {
    hasNamedContact: Boolean(named),
    hasEmail: Boolean(contactEmail),
    hasPhone: Boolean(contactPhone),
    emailVerified: emailStatus === "verified",
    emailStatus,
  };
}

function findCopyrightYear(report: { findings: { title: string; evidence: string }[] }): number | null {
  const match = report.findings
    .map((f) => /copyright notice still reads (\d{4})/i.exec(f.title)?.[1] ?? /copyright notice states (\d{4})/i.exec(f.evidence)?.[1])
    .find(Boolean);
  return match ? Number(match) : null;
}

/** How stale an audit is, in days. `null` when the business has never been audited. */
export function auditAgeDays(orgId: string, businessId: string): number | null {
  const audit = latestAuditForBusiness(orgId, businessId);
  if (!audit?.completedAt) return null;
  return Math.floor((Date.now() - new Date(audit.completedAt).getTime()) / 86_400_000);
}

export function needsReaudit(orgId: string, businessId: string): boolean {
  const age = auditAgeDays(orgId, businessId);
  if (age === null) return true;
  return age > 30;
}

export { websiteForBusiness };
