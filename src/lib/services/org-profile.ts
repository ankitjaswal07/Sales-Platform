import "server-only";

import { defaultOrgSettings, getOrganization } from "../db/repo/org";

/**
 * A single place that answers "who is this agency?" for every document, email
 * and proposal the platform produces (§31). Falls back to honest, clearly
 * incomplete defaults so onboarding can prompt for the missing details rather
 * than silently inventing them.
 */

export interface OrganizationProfile {
  id: string | null;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  currency: string;
  brandPrimary: string;
  brandAccent: string;
  brandFont: string;
  proposalTemplate: string;
  proposalValidityDays: number;
  followUpCadence: number[];
  requireProposalApproval: boolean;
  tone: string;
  configured: boolean;
  missing: string[];
}

const FALLBACK = {
  name: "Your agency",
  email: null as string | null,
  phone: null as string | null,
  website: null as string | null,
  city: null as string | null,
  country: null as string | null,
};

export function organizationProfile(orgId: string | null): OrganizationProfile {
  const organization = orgId ? getOrganization(orgId) : null;
  const settings = organization?.settings ?? defaultOrgSettings();

  const missing: string[] = [];
  if (!organization) missing.push("organization");
  if (!organization?.name || organization.name === "Your agency") missing.push("agency name");
  if (!organization?.email) missing.push("reply-to email");
  if (!organization?.phone) missing.push("phone number");
  if (!organization?.website) missing.push("website");

  return {
    id: organization?.id ?? null,
    name: organization?.name || FALLBACK.name,
    legalName: organization?.legalName ?? null,
    email: organization?.email ?? null,
    phone: organization?.phone ?? null,
    website: organization?.website ?? null,
    address: organization?.address ?? null,
    city: organization?.city ?? null,
    country: organization?.country ?? null,
    timezone: organization?.timezone ?? "Europe/London",
    currency: organization?.currency ?? settings.sales.defaultCurrency,
    brandPrimary: organization?.brandPrimary ?? settings.branding.primary,
    brandAccent: organization?.brandAccent ?? settings.branding.accent,
    brandFont: organization?.brandFont ?? settings.branding.font,
    proposalTemplate: settings.branding.proposalTemplate,
    proposalValidityDays: settings.sales.defaultValidityDays,
    followUpCadence: settings.sales.followUpCadence,
    requireProposalApproval: settings.sales.requireProposalApproval,
    tone: settings.ai.tone,
    configured: missing.length === 0,
    missing,
  };
}

/** Short label used in headers, emails and the sample-data banner. */
export function agencySignature(orgId: string | null): string {
  const profile = organizationProfile(orgId);
  const parts = [profile.name, profile.website, profile.phone].filter(Boolean);
  return parts.join(" · ");
}
