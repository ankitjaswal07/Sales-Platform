import "server-only";

import { getBusiness, latestAuditForBusiness } from "../db/repo/business";
import { getLead } from "../db/repo/lead";
import { getOrganization, listStages } from "../db/repo/org";
import { listPricingPlans, listServices } from "../db/repo/ops";
import { estimateProjectValue, type ProjectScopeInput, type ProjectValueEstimate } from "../scoring/lead";
import { scopeFor } from "./proposal";
import type { Audit } from "../db/repo/types";
import type { AuditFinding } from "../types";

/**
 * Pricing guidance (§32, §34).
 *
 * A price is always presented as a *range derived from measured scope*, never
 * as a quote, and never as a guaranteed outcome. Every figure carries its
 * derivation so a human can override it with a reason.
 */

export interface PricingRecommendation {
  estimate: ProjectValueEstimate;
  scope: ProjectScopeInput;
  confidence: number;
  drivers: { label: string; impact: "up" | "down" | "neutral"; note: string }[];
  catalogue: { services: { key: string; name: string; price: number; currency: string }[]; plans: { name: string; price: number; currency: string; pagesIncluded: number | null }[] };
  recommendedPlan: string | null;
  disclaimer: string;
  sourceOfTruth: "measured_scope" | "industry_default";
}

export function auditScoresFrom(audit: Audit | null): Record<string, number | null> | null {
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

export function estimateForLead(orgId: string, leadId: string): PricingRecommendation | null {
  const lead = getLead(orgId, leadId);
  if (!lead) return null;
  const business = lead.business ?? getBusiness(orgId, lead.businessId);
  if (!business) return null;

  const audit = latestAuditForBusiness(orgId, business.id);
  const findings = (audit?.findings ?? []) as AuditFinding[];
  const scope = scopeFor(business, findings, {
    suggestedStructure: ["Home", "Services", "Pricing", "About", "Contact"],
    suggestedFeatures: [],
    estimatedComplexity: { level: "standard" },
  } as never);

  const organization = getOrganization(orgId);
  const estimate = estimateProjectValue({ ...scope, currency: organization?.currency ?? lead.currency });
  const services = listServices(orgId).map((service) => ({ key: service.key, name: service.name, price: service.price ?? service.startingPrice, currency: service.currency }));
  const plans = listPricingPlans(orgId).map((plan) => ({ name: plan.name, price: plan.price, currency: plan.currency, pagesIncluded: plan.pagesIncluded }));

  // Confidence is a statement about the inputs, not the price.
  let confidence = 0.4;
  const notes: string[] = [];
  if (audit?.status === "complete") {
    confidence += 0.25;
    notes.push("A complete audit was available, so scope was derived from measured findings.");
  } else {
    notes.push("No completed audit is linked, so the scope is an industry default rather than a measurement.");
  }
  if (business.reviewCount && business.reviewCount > 20) {
    confidence += 0.1;
    notes.push("The business has enough public reviews to size the operation reliably.");
  }
  if (business.employeeRange) {
    confidence += 0.1;
    notes.push(`Employee range (${business.employeeRange}) was published by the data provider.`);
  }
  confidence += 0.1;
  confidence = Math.min(0.95, Math.round(confidence * 100) / 100);

  const recommendedPlan =
    plans.length === 0
      ? null
      : plans
          .slice()
          .sort((a, b) => Math.abs(a.price - estimate.mid) - Math.abs(b.price - estimate.mid))[0]?.name ?? null;

  return {
    estimate,
    scope,
    confidence,
    drivers: [
      ...estimate.drivers,
      { label: "Confidence in this range", impact: "neutral", note: `${Math.round(confidence * 100)}% — ${notes.join(" ")}` },
    ],
    catalogue: { services, plans },
    recommendedPlan,
    disclaimer:
      "This range is a planning estimate derived from the measured scope. It is not a quote, not a guarantee, and not an offer. A named person on the team sets the final fixed price, and only an approved proposal from the agency constitutes a price.",
    sourceOfTruth: audit?.status === "complete" ? "measured_scope" : "industry_default",
  };
}

export interface PriceOverrideInput {
  estimate: ProjectValueEstimate;
  override: Partial<ProjectValueEstimate> & { note?: string };
}

/** Applies a manual override, keeping the AI range visible for comparison. */
export function applyOverride(input: PriceOverrideInput): { estimate: ProjectValueEstimate; overrideNote: string; delta: number } {
  const merged: ProjectValueEstimate = { ...input.estimate, ...input.override };
  const delta = merged.mid - input.estimate.mid;
  const direction = delta === 0 ? "unchanged" : delta > 0 ? `+${delta.toLocaleString()}` : `−${Math.abs(delta).toLocaleString()}`;
  return {
    estimate: merged,
    overrideNote: `Manually adjusted from the ${input.estimate.currency} ${input.estimate.mid.toLocaleString()} recommendation by ${direction}.${input.override.note ? ` Reason: ${input.override.note}` : ""}`,
    delta,
  };
}

export function stageProbability(orgId: string, stageKey: string): number {
  return listStages(orgId).find((stage) => stage.key === stageKey)?.probability ?? 0;
}

/** Value of the pipeline weighted by stage probability — the forecast figure. */
export function weightedForecast(leads: { status: string; estimatedValue: number | null }[], orgId: string): number {
  const stages = listStages(orgId);
  return Math.round(
    leads.reduce((sum, lead) => {
      const probability = stages.find((stage) => stage.key === lead.status)?.probability ?? 0;
      return sum + (lead.estimatedValue ?? 0) * (probability / 100);
    }, 0),
  );
}
