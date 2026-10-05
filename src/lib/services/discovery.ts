import "server-only";

import { runAudit, quickScan } from "../audit/engine";
import { createBusiness, businessFacets, getBusiness } from "../db/repo/business";
import { createLead, getLeadByBusiness, recordActivity, saveLeadScore, updateLead } from "../db/repo/lead";
import { createDiscoveryRun, updateDiscoveryRun, enqueueJob, createNotification } from "../db/repo/ops";
import { addCampaignRecipient } from "../db/repo/engagement";
import { getOrganization } from "../db/repo/org";
import { logger } from "../logger";
import { computeLeadScore } from "../scoring/lead";
import type { Business } from "../db/repo/types";
import { integrationState } from "../integrations/registry";
import { sampleListings, SAMPLE_DATA_NOTE } from "./sample-data";

/**
 * Business discovery engine (§4, §37).
 *
 * Providers, in preference order:
 *   1. Google Places (New)  — when GOOGLE_PLACES_API_KEY is set
 *   2. The built-in sample dataset — always available, clearly labelled
 *
 * There is no scraping, no CAPTCHA bypass and no rate-limit circumvention
 * anywhere in this pipeline (§4). When a provider is not configured the run
 * returns sample results and the UI states that plainly, so a demo is honest
 * about what it is.
 */

export interface DiscoveryQuery {
  industry?: string;
  category?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  keywords?: string;
  minRating?: number;
  minReviews?: number;
  maxReviews?: number;
  websiteQuality?: "any" | "no_website" | "under_50" | "under_60" | "under_75" | "over_75";
  companySize?: string;
  limit?: number;
  /** Run a full audit on each result rather than a heuristic quick scan. */
  deepAudit?: boolean;
  /** Automatically create leads for the newly discovered businesses. */
  createLeads?: boolean;
  /** Add everything found to an existing campaign. */
  campaignId?: string;
  ownerId?: string | null;
}

export interface DiscoveredBusiness {
  name: string;
  industry: string | null;
  category: string | null;
  description: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  socials: Record<string, string>;
  rating: number | null;
  reviewCount: number;
  employeeRange: string | null;
  yearsInBusiness: number | null;
  listingProvider: string;
  listingId: string | null;
  listingUrl: string | null;
  dataSource: string;
  dataConfidence: number;
  hourCount: number;
}

export interface DiscoveryResult {
  provider: string;
  providerConfigured: boolean;
  providerNote: string;
  query: DiscoveryQuery;
  found: DiscoveredBusiness[];
  totalFound: number;
}

export function activeBusinessProvider(): { provider: string; configured: boolean; note: string } {
  const google = integrationState("google_places");
  const yelp = integrationState("yelp");
  const openCorp = integrationState("opencorporates");

  const available = [google, yelp, openCorp].filter((state) => state.configured).length;
  if (available === 0) {
    return {
      provider: "leadforge_sample",
      configured: false,
      note: SAMPLE_DATA_NOTE,
    };
  }
  return {
    provider: [google.configured ? "google_places" : null, yelp.configured ? "yelp" : null, openCorp.configured ? "opencorporates" : null]
      .filter(Boolean)
      .join(" + "),
    configured: true,
    note: "Results come from the configured public business-data provider(s). Attribution and usage limits are governed by those providers' terms.",
  };
}

export async function discoverBusinesses(query: DiscoveryQuery): Promise<DiscoveryResult> {
  const provider = activeBusinessProvider();
  const limit = Math.min(query.limit ?? 25, Number(process.env.DISCOVERY_MAX_RESULTS_PER_JOB ?? 250));

  if (provider.provider === "leadforge_sample" || !provider.configured) {
    const found = sampleListings({
      industry: query.industry,
      city: query.city,
      country: query.country,
      minRating: query.minRating,
      minReviews: query.minReviews,
      maxReviews: query.maxReviews,
      websiteQuality: query.websiteQuality,
      limit,
    });
    return { provider: provider.provider, providerConfigured: provider.configured, providerNote: provider.note, query, found, totalFound: found.length };
  }

  try {
    const found = await discoverFromGooglePlaces(query, limit);
    return { provider: provider.provider, providerConfigured: provider.configured, providerNote: provider.note, query, found, totalFound: found.length };
  } catch (error) {
    logger.error("discovery", "Provider lookup failed; falling back to the sample dataset", {
      error: error instanceof Error ? error.message : String(error),
    });
    const found = sampleListings({ industry: query.industry, city: query.city, country: query.country, limit });
    return {
      provider: "leadforge_sample",
      providerConfigured: false,
      providerNote: `The configured provider failed (${error instanceof Error ? error.message : "unknown error"}). Showing sample data so the workflow remains testable.`,
      query,
      found,
      totalFound: found.length,
    };
  }
}

async function discoverFromGooglePlaces(query: DiscoveryQuery, limit: number): Promise<DiscoveredBusiness[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY!;
  const textQuery = [query.industry, query.keywords, "in", query.city ?? query.postalCode ?? query.country]
    .filter(Boolean)
    .join(" ")
    .trim();

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.addressComponents",
        "places.location",
        "places.rating",
        "places.userRatingCount",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.primaryTypeDisplayName",
        "places.types",
        "places.regularOpeningHours",
        "places.priceLevel",
        "places.businessStatus",
        "places.editorialSummary",
        "places.googleMapsUri",
      ].join(","),
    },
    body: JSON.stringify({ textQuery, maxResultCount: Math.min(20, limit), languageCode: "en" }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) throw new Error(`Places API ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = (await response.json()) as { places?: GooglePlace[] };
  const places = payload.places ?? [];

  return places.map((place) => {
    const components = place.addressComponents ?? [];
    const pick = (type: string) => components.find((c) => c.types?.includes(type))?.longText ?? null;
    return {
      name: place.displayName?.text ?? "Unknown business",
      industry: place.primaryTypeDisplayName?.text ?? null,
      category: place.primaryTypeDisplayName?.text ?? place.types?.[0] ?? null,
      description: place.editorialSummary?.text ?? null,
      addressLine1: place.formattedAddress ?? null,
      city: pick("locality") ?? pick("postal_town") ?? null,
      state: pick("administrative_area_level_1") ?? null,
      country: pick("country") ?? query.country ?? null,
      postalCode: pick("postal_code") ?? null,
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? null,
      email: null, // Places does not expose email addresses.
      websiteUrl: place.websiteUri ?? null,
      socials: {},
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? 0,
      employeeRange: null,
      yearsInBusiness: null,
      listingProvider: "google_places",
      listingId: place.id ?? null,
      listingUrl: place.googleMapsUri ?? null,
      dataSource: "google_places",
      dataConfidence: 0.92,
      hourCount: place.regularOpeningHours?.weekdayDescriptions?.length ?? 0,
    };
  });
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; types?: string[] }[];
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  priceLevel?: string;
  businessStatus?: string;
  editorialSummary?: { text?: string };
  googleMapsUri?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   Persistence: turn discovered listings into businesses, audits and leads
   ══════════════════════════════════════════════════════════════════════════ */

export interface PersistOptions {
  orgId: string;
  lead?: DiscoveredBusiness[];
  createLeads?: boolean;
  campaignId?: string;
  ownerId?: string | null;
  createdBy?: string | null;
  runId?: string | null;
  onProgress?: (percent: number, stage: string) => void;
  deepAudit?: boolean;
  /** Cap on how many businesses to full-audit in one pass. */
  auditBudget?: number;
}

export interface PersistOutcome {
  created: number;
  duplicates: number;
  leadsCreated: number;
  audited: number;
  scores: { businessId: string; leadId: string | null; leadScore: number; websiteScore: number | null; message: string }[];
  campaignAdded: number;
  skipped: { name: string; reason: string }[];
}

export async function persistDiscoveredBusinesses(options: PersistOptions): Promise<PersistOutcome> {
  const outcome: PersistOutcome = { created: 0, duplicates: 0, leadsCreated: 0, audited: 0, scores: [], campaignAdded: 0, skipped: [] };
  const listings = options.lead ?? [];
  const total = listings.length || 1;
  let index = 0;

  for (const listing of listings) {
    index += 1;
    options.onProgress?.(Math.round((index / total) * 80), `Processing ${listing.name}`);

    const { business, created } = createBusiness(options.orgId, {
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
      email: listing.email,
      websiteUrl: listing.websiteUrl,
      socials: listing.socials,
      rating: listing.rating,
      reviewCount: listing.reviewCount,
      employeeRange: listing.employeeRange,
      yearsInBusiness: listing.yearsInBusiness,
      listingProvider: listing.listingProvider,
      listingId: listing.listingId,
      listingUrl: listing.listingUrl,
      dataSource: listing.dataSource,
      dataConfidence: listing.dataConfidence,
      hours: Array.from({ length: listing.hourCount }, (_, i) => ({ day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i] ?? `Day ${i + 1}`, open: "09:00", close: "17:00" })),
      websiteStatus: listing.websiteUrl ? "unknown" : "none",
    }, { createdBy: options.createdBy, dedupe: true });

    if (!created) {
      outcome.duplicates += 1;
    } else {
      outcome.created += 1;
    }

    let leadId: string | null = null;
    if (options.createLeads) {
      const existingLead = getLeadByBusiness(options.orgId, business.id);
      if (existingLead) {
        leadId = existingLead.id;
      } else {
        const lead = createLead(options.orgId, {
          businessId: business.id,
          source: "discovery",
          status: "new",
          ownerId: options.ownerId ?? null,
          discoveryRunId: options.runId ?? null,
        });
        leadId = lead.id;
        outcome.leadsCreated += 1;
        recordActivity(options.orgId, {
          leadId: lead.id,
          businessId: business.id,
          userId: options.createdBy ?? null,
          type: "lead_discovered",
          subject: "Lead discovered",
          body: `${business.name}${business.city ? ` in ${business.city}` : ""} added from ${listing.dataSource}.`,
          isSystem: true,
        });
      }
    }

    if (options.campaignId && leadId) {
      const result = addCampaignRecipient(options.orgId, {
        campaignId: options.campaignId,
        businessId: business.id,
        leadId,
        contactId: null,
        skipReason: listing.email ? null : "No public email address — enrich or use the website contact form",
      });
      if (result.created) outcome.campaignAdded += 1;
    }

    /* ── website analysis ── */
    if (listing.websiteUrl && options.auditBudget !== 0) {
      const shouldDeepAudit = options.deepAudit && outcome.audited < (options.auditBudget ?? 15);
      try {
        if (shouldDeepAudit) {
          const { persistAudit } = await import("./audit-runner");
          const result = await persistAudit({
            orgId: options.orgId,
            businessId: business.id,
            url: listing.websiteUrl,
            leadId,
            actorId: options.createdBy ?? null,
          });
          outcome.audited += 1;
          outcome.scores.push({
            businessId: business.id,
            leadId,
            leadScore: result.leadScore,
            websiteScore: result.websiteScore,
            message: result.message,
          });
          continue;
        }

        const scan = await quickScan(listing.websiteUrl);
        const { updateBusiness } = await import("../db/repo/business");
        updateBusiness(options.orgId, business.id, {
          websiteStatus: scan.reachable
            ? scan.heuristicScore >= 75
              ? "good"
              : scan.heuristicScore >= 50
                ? "average"
                : "poor"
            : "broken",
        });

        if (leadId) {
          const refreshed = getBusiness(options.orgId, business.id)!;
          const score = computeLeadScore(
            toBusinessInput(refreshed),
            {
              exists: true,
              reachable: scan.reachable,
              https: scan.https,
              scores: null,
              cms: scan.cms,
              copyrightYear: scan.copyrightYear,
              hasForm: scan.hasForm,
              hasAnalytics: undefined,
            },
            { hasNamedContact: false, hasEmail: Boolean(refreshed.email), hasPhone: Boolean(refreshed.phone) },
          );
          saveLeadScore(options.orgId, leadId, score);
          outcome.scores.push({ businessId: business.id, leadId, leadScore: score.total, websiteScore: scan.heuristicScore, message: `Quick scan: estimated website score ${scan.heuristicScore}/100 (run a full audit for exact figures).` });
        }
      } catch (error) {
        outcome.skipped.push({ name: listing.name, reason: `Website analysis failed: ${error instanceof Error ? error.message : "unknown error"}` });
      }
    } else if (!listing.websiteUrl) {
      const refreshed = getBusiness(options.orgId, business.id)!;
      if (leadId) {
        const score = computeLeadScore(
          toBusinessInput(refreshed),
          { exists: false, scores: null },
          { hasNamedContact: false, hasEmail: Boolean(refreshed.email), hasPhone: Boolean(refreshed.phone) },
        );
        saveLeadScore(options.orgId, leadId, score);
        outcome.scores.push({ businessId: business.id, leadId, leadScore: score.total, websiteScore: null, message: "No website — maximum website opportunity." });
      }
      outcome.skipped.push({ name: listing.name, reason: "No website found, so no audit was run. Recorded as a 'no website' opportunity." });
    }
  }

  options.onProgress?.(95, "Scoring opportunities");
  return outcome;
}

/** Shape adapter: DB business → lead scoring input. */
export function toBusinessInput(business: Business): Parameters<typeof computeLeadScore>[0] {
  return {
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
  };
}

/** Convenience used by the Lead Finder page: discover → persist → score in one call. */
export async function runDiscovery(options: {
  orgId: string;
  query: DiscoveryQuery;
  createdBy?: string | null;
  onProgress?: (percent: number, stage: string) => void;
  campaignId?: string;
}): Promise<{ runId: string; provider: string; providerNote: string; outcome: PersistOutcome }> {
  const job = enqueueJob(options.orgId, {
    type: "discovery",
    label: `Discover ${options.query.industry ?? "businesses"}${options.query.city ? ` in ${options.query.city}` : ""}`,
    payload: options.query as unknown as Record<string, unknown>,
    createdBy: options.createdBy ?? null,
  });

  const run = createDiscoveryRun(options.orgId, {
    query: options.query as unknown as Record<string, unknown>,
    jobId: job.id,
    createdBy: options.createdBy ?? null,
  });

  options.onProgress?.(8, "Querying business data providers");
  const discovery = await discoverBusinesses(options.query);

  options.onProgress?.(22, `Found ${discovery.totalFound} businesses · provider: ${discovery.provider}`);
  const outcome = await persistDiscoveredBusinesses({
    orgId: options.orgId,
    lead: discovery.found,
    createLeads: options.query.createLeads !== false,
    campaignId: options.campaignId,
    ownerId: options.query.ownerId ?? null,
    createdBy: options.createdBy ?? null,
    runId: run.id,
    deepAudit: options.query.deepAudit,
    auditBudget: options.query.deepAudit ? 12 : 0,
    onProgress: (percent, stage) => options.onProgress?.(22 + Math.round(percent * 0.7), stage),
  });

  updateDiscoveryRun(run.id, {
    status: "complete",
    providers: [discovery.provider],
    foundCount: discovery.totalFound,
    newCount: outcome.created,
    duplicateCount: outcome.duplicates,
    auditedCount: outcome.audited,
    completedAt: new Date().toISOString(),
  });

  const organization = getOrganization(options.orgId);
  if (outcome.leadsCreated > 0 && organization) {
    createNotification(options.orgId, {
      type: "new_lead",
      title: `${outcome.leadsCreated} new lead${outcome.leadsCreated === 1 ? "" : "s"} discovered`,
      body: `${options.query.industry ?? "Businesses"}${options.query.city ? ` in ${options.query.city}` : ""} · provider ${discovery.provider}`,
      entityType: "discovery_run",
      entityId: run.id,
      actionUrl: "/leads",
      icon: "user-plus",
    });
  }

  // Job row mirrors the run so the Diagnostics page tells the same story.
  const { updateJobProgress, completeJob } = await import("../db/repo/ops");
  updateJobProgress(job.id, 100, "Complete");
  completeJob(job.id, { runId: run.id, found: discovery.totalFound, created: outcome.created, leads: outcome.leadsCreated, audited: outcome.audited });

  logger.info("discovery", "Discovery run complete", {
    provider: discovery.provider,
    found: discovery.totalFound,
    created: outcome.created,
    leads: outcome.leadsCreated,
  });

  return { runId: run.id, provider: discovery.provider, providerNote: discovery.providerNote, outcome };
}

export function discoveryFacets(orgId: string): ReturnType<typeof businessFacets> {
  return businessFacets(orgId);
}

export { runAudit };
