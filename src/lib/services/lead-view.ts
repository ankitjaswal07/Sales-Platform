import "server-only";

import type { Lead } from "../db/repo/types";

/**
 * Flattened lead shape for the UI and services.
 *
 * The repository returns a normalised record with joined `business`, `contact`
 * and `owner` objects. Screens and services almost always want the flat version
 * (for tables, Kanban cards, alerts and exports), so the mapping lives in one
 * place and every consumer sees exactly the same fields.
 */

export interface LeadView {
  id: string;
  reference: string;
  businessId: string;
  businessName: string;
  industry: string | null;
  category: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  address: string | null;
  websiteUrl: string | null;
  hasWebsite: boolean;
  websiteStatus: string;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactTitle: string | null;
  status: Lead["status"];
  stageKey: string;
  temperature: Lead["temperature"];
  priority: number;
  leadScore: number;
  websiteScore: number | null;
  opportunityScore: number | null;
  businessQuality: number | null;
  buyingPotential: number | null;
  contactability: number | null;
  intent: Lead["intent"];
  intentScore: number;
  /** Canonical field name from the repository. */
  estimatedValue: number | null;
  /** Alias used throughout the UI copy and exports. */
  value: number | null;
  currency: string;
  nextAction: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  lastContactedAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerInitials: string | null;
  ownerAvatarUrl: string | null;
  rating: number | null;
  reviewCount: number;
  tags: string[];
  source: string;
  campaignId: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  optOut: boolean;
  daysSinceActivity: number;
  daysSinceContact: number | null;
}

export function toLeadView(lead: Lead): LeadView {
  const business = lead.business ?? null;
  const contact = lead.contact ?? null;

  return {
    id: lead.id,
    reference: lead.reference,
    businessId: lead.businessId,
    businessName: business?.name ?? "Unknown business",
    industry: business?.industry ?? null,
    category: business?.category ?? null,
    city: business?.city ?? null,
    state: business?.state ?? null,
    country: business?.country ?? null,
    postalCode: business?.postalCode ?? null,
    address: business?.addressLine1 ?? null,
    websiteUrl: business?.websiteUrl ?? null,
    hasWebsite: Boolean(business?.websiteUrl),
    websiteStatus: business?.websiteStatus ?? "unknown",
    phone: contact?.phone ?? business?.phone ?? null,
    email: contact?.email ?? business?.email ?? null,
    contactName: contact?.name ?? null,
    contactEmail: contact?.email ?? null,
    contactPhone: contact?.phone ?? null,
    contactTitle: contact?.title ?? null,
    status: lead.status,
    stageKey: lead.stageKey,
    temperature: lead.temperature,
    priority: lead.priority,
    leadScore: lead.leadScore ?? 0,
    websiteScore: lead.websiteScore,
    opportunityScore: lead.opportunityScore,
    businessQuality: lead.businessQuality,
    buyingPotential: lead.buyingPotential,
    contactability: lead.contactability,
    intent: lead.intent,
    intentScore: lead.intentScore,
    estimatedValue: lead.estimatedValue,
    value: lead.estimatedValue,
    currency: lead.currency,
    nextAction: lead.nextAction,
    nextFollowUpAt: lead.nextFollowUpAt,
    lastActivityAt: lead.lastActivityAt,
    lastContactedAt: lead.lastContactedAt,
    ownerId: lead.ownerId,
    ownerName: lead.owner?.name ?? null,
    ownerInitials: initials(lead.owner?.name ?? null),
    ownerAvatarUrl: lead.owner?.avatarUrl ?? null,
    rating: business?.rating ?? null,
    reviewCount: business?.reviewCount ?? 0,
    tags: lead.tags ?? [],
    source: lead.source,
    campaignId: lead.campaignId,
    wonAt: lead.wonAt,
    lostAt: lead.lostAt,
    lostReason: lead.lostReason,
    optOut: lead.optOut,
    daysSinceActivity: daysSince(lead.lastActivityAt ?? lead.updatedAt),
    daysSinceContact: lead.lastContactedAt ? daysSince(lead.lastContactedAt) : null,
  };
}

export function toLeadViews(leads: Lead[]): LeadView[] {
  return leads.map(toLeadView);
}

export function locationOf(view: LeadView): string | null {
  const parts = [view.city, view.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function initials(name: string | null): string | null {
  if (!name) return null;
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
