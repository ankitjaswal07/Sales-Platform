import "server-only";

import { all, insert, one, parseJson, run, toBool, update } from "..";
import { newId, sha256 } from "../../ids";
import { normalizeUrl, hostOf } from "../../audit/fetcher";
import type { AuditFinding, AuditMetric, AuditDimension, WebsiteStatus } from "../../types";
import type { Audit, Business, Contact, Website } from "./types";

/* ══════════════════════════════════════════════════════════════════════════
   Businesses
   ══════════════════════════════════════════════════════════════════════════ */

interface BusinessRow {
  id: string; org_id: string; name: string; legal_name: string | null; industry: string | null;
  category: string | null; description: string | null; address_line1: string | null; address_line2: string | null;
  city: string | null; state: string | null; country: string | null; postal_code: string | null;
  latitude: number | null; longitude: number | null; phone: string | null; email: string | null;
  website_url: string | null; socials_json: string; hours_json: string; rating: number | null;
  review_count: number | null; price_level: number | null; employee_range: string | null;
  revenue_range: string | null; years_in_business: number | null; listing_provider: string | null;
  listing_id: string | null; listing_url: string | null; listing_categories_json: string;
  attributes_json: string; screenshot_url: string | null; website_status: string; data_source: string | null;
  data_confidence: number | null; is_demo: number; last_verified_at: string | null;
  created_at: string; updated_at: string;
  latest_score?: number | null;
  latest_findings?: number | null;
}

export function mapBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    legalName: row.legal_name,
    industry: row.industry,
    category: row.category,
    description: row.description,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    country: row.country,
    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone,
    email: row.email,
    websiteUrl: row.website_url,
    socials: parseJson<Record<string, string>>(row.socials_json, {}),
    hours: parseJson<{ day: string; open: string; close: string }[]>(row.hours_json, []),
    rating: row.rating,
    reviewCount: row.review_count ?? 0,
    priceLevel: row.price_level,
    employeeRange: row.employee_range,
    revenueRange: row.revenue_range,
    yearsInBusiness: row.years_in_business,
    listingProvider: row.listing_provider,
    listingId: row.listing_id,
    listingUrl: row.listing_url,
    listingCategories: parseJson<string[]>(row.listing_categories_json, []),
    attributes: parseJson<Record<string, unknown>>(row.attributes_json, {}),
    screenshotUrl: row.screenshot_url,
    websiteStatus: row.website_status as WebsiteStatus,
    dataSource: row.data_source,
    dataConfidence: row.data_confidence,
    isDemo: toBool(row.is_demo),
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    websiteScore: row.latest_score ?? null,
    openFindings: row.latest_findings ?? null,
  };
}

export interface BusinessFilter {
  search?: string;
  industries?: string[];
  cities?: string[];
  countries?: string[];
  states?: string[];
  postalCode?: string;
  websiteStatus?: WebsiteStatus[];
  minRating?: number;
  minReviews?: number;
  maxReviews?: number;
  hasEmail?: boolean;
  hasPhone?: boolean;
  minWebsiteScore?: number;
  maxWebsiteScore?: number;
  unscored?: boolean;
  ids?: string[];
  createdAfter?: string;
  sort?: "created_at" | "reviews" | "rating" | "website_score" | "name";
  limit?: number;
  offset?: number;
}

export function listBusinesses(orgId: string, filter: BusinessFilter = {}): { items: Business[]; total: number } {
  const { where, params } = buildBusinessWhere(orgId, filter);
  const order = businessOrder(filter.sort);
  const limit = Math.min(filter.limit ?? 50, 500);
  const offset = filter.offset ?? 0;

  const base = `
    FROM businesses b
    LEFT JOIN (
      SELECT business_id, overall_score,
             (SELECT COUNT(*) FROM json_each(json_extract(website_audits.findings_json, '$')) WHERE json_extract(value, '$.severity') IN ('critical','high')) AS findings_count,
             ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) AS rn
      FROM website_audits
    ) a ON a.business_id = b.id AND a.rn = 1
  `;

  const items = all<BusinessRow>(
    `SELECT b.*, a.overall_score AS latest_score, a.findings_count AS latest_findings ${base} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map(mapBusiness);

  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM businesses b ${where}`, params)?.total ?? 0;
  return { items, total };
}

function buildBusinessWhere(orgId: string, filter: BusinessFilter): { where: string; params: unknown[] } {
  const clauses: string[] = ["b.org_id = ?"];
  const params: unknown[] = [orgId];

  if (filter.search) {
    clauses.push("(b.name LIKE ? OR b.description LIKE ? OR b.city LIKE ? OR b.postal_code LIKE ? OR b.industry LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like, like, like);
  }
  if (filter.industries?.length) {
    clauses.push(`b.industry IN (${filter.industries.map(() => "?").join(",")})`);
    params.push(...filter.industries);
  }
  if (filter.cities?.length) {
    clauses.push(`b.city IN (${filter.cities.map(() => "?").join(",")})`);
    params.push(...filter.cities);
  }
  if (filter.countries?.length) {
    clauses.push(`b.country IN (${filter.countries.map(() => "?").join(",")})`);
    params.push(...filter.countries);
  }
  if (filter.states?.length) {
    clauses.push(`b.state IN (${filter.states.map(() => "?").join(",")})`);
    params.push(...filter.states);
  }
  if (filter.postalCode) {
    clauses.push("b.postal_code LIKE ?");
    params.push(`${filter.postalCode}%`);
  }
  if (filter.websiteStatus?.length) {
    clauses.push(`b.website_status IN (${filter.websiteStatus.map(() => "?").join(",")})`);
    params.push(...filter.websiteStatus);
  }
  if (filter.minRating !== undefined) {
    clauses.push("COALESCE(b.rating, 0) >= ?");
    params.push(filter.minRating);
  }
  if (filter.minReviews !== undefined) {
    clauses.push("COALESCE(b.review_count, 0) >= ?");
    params.push(filter.minReviews);
  }
  if (filter.maxReviews !== undefined) {
    clauses.push("COALESCE(b.review_count, 0) <= ?");
    params.push(filter.maxReviews);
  }
  if (filter.hasEmail) clauses.push("b.email IS NOT NULL AND b.email != ''");
  if (filter.hasPhone) clauses.push("b.phone IS NOT NULL AND b.phone != ''");
  if (filter.ids?.length) {
    clauses.push(`b.id IN (${filter.ids.map(() => "?").join(",")})`);
    params.push(...filter.ids);
  }
  if (filter.createdAfter) {
    clauses.push("b.created_at >= ?");
    params.push(filter.createdAfter);
  }
  if (filter.unscored) {
    clauses.push("EXISTS (SELECT 1 FROM businesses x WHERE x.id = b.id) AND NOT EXISTS (SELECT 1 FROM website_audits wa WHERE wa.business_id = b.id)");
  }
  if (filter.maxWebsiteScore !== undefined) {
    clauses.push("EXISTS (SELECT 1 FROM website_audits wa2 WHERE wa2.business_id = b.id AND wa2.overall_score <= ?)");
    params.push(filter.maxWebsiteScore);
  }
  if (filter.minWebsiteScore !== undefined) {
    clauses.push("EXISTS (SELECT 1 FROM website_audits wa3 WHERE wa3.business_id = b.id AND wa3.overall_score >= ?)");
    params.push(filter.minWebsiteScore);
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, params };
}

function businessOrder(sort: BusinessFilter["sort"]): string {
  switch (sort) {
    case "reviews": return "COALESCE(b.review_count,0) DESC, b.rating DESC";
    case "rating": return "COALESCE(b.rating,0) DESC, COALESCE(b.review_count,0) DESC";
    case "name": return "b.name ASC";
    case "website_score": return "a.overall_score ASC NULLS LAST";
    default: return "b.created_at DESC";
  }
}

export function getBusiness(orgId: string, businessId: string): Business | null {
  const row = one<BusinessRow>(
    `SELECT b.*, a.overall_score AS latest_score, a.findings_count AS latest_findings
     FROM businesses b
     LEFT JOIN (
       SELECT business_id, overall_score,
              (SELECT COUNT(*) FROM json_each(json_extract(findings_json, '$')) WHERE json_extract(value, '$.severity') IN ('critical','high')) AS findings_count,
              ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) AS rn
       FROM website_audits
     ) a ON a.business_id = b.id AND a.rn = 1
     WHERE b.id = ? AND b.org_id = ?`,
    [businessId, orgId],
  );
  return row ? mapBusiness(row) : null;
}

/** Deterministic duplicate key so the same business is never imported twice. */
export function businessDedupeKey(input: { name: string; city?: string | null; postalCode?: string | null; website?: string | null; phone?: string | null }): string {
  const normalizedName = input.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const location = (input.postalCode ?? input.city ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let domain = "";
  if (input.website) {
    try {
      domain = hostOf(normalizeUrl(input.website));
    } catch {
      domain = "";
    }
  }
  return sha256(`${normalizedName}|${location}|${domain}|${input.phone ?? ""}`);
}

export function findBusinessByDedupe(orgId: string, key: string): Business | null {
  const row = one<BusinessRow>("SELECT * FROM businesses WHERE org_id = ? AND (id = ? OR name = ?) LIMIT 1", [orgId, key, key]);
  return row ? mapBusiness(row) : null;
}

export function createBusiness(orgId: string, input: Partial<Business> & { name: string }, options: { createdBy?: string | null; dedupe?: boolean } = {}): { business: Business; created: boolean } {
  if (options.dedupe !== false) {
    const existing = one<{ id: string }>(
      `SELECT id FROM businesses WHERE org_id = ? AND lower(name) = lower(?) AND COALESCE(city,'') = COALESCE(?,'') LIMIT 1`,
      [orgId, input.name, input.city ?? ""],
    );
    if (existing) {
      const business = getBusiness(orgId, existing.id);
      if (business) return { business, created: false };
    }
  }

  const id = newId("biz");
  const timestamp = new Date().toISOString();
  insert("businesses", {
    id,
    org_id: orgId,
    name: input.name,
    legal_name: input.legalName ?? null,
    industry: input.industry ?? null,
    category: input.category ?? null,
    description: input.description ?? null,
    address_line1: input.addressLine1 ?? null,
    address_line2: input.addressLine2 ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    country: input.country ?? null,
    postal_code: input.postalCode ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website_url: input.websiteUrl ?? null,
    socials_json: input.socials ?? {},
    hours_json: input.hours ?? [],
    rating: input.rating ?? null,
    review_count: input.reviewCount ?? 0,
    price_level: input.priceLevel ?? null,
    employee_range: input.employeeRange ?? null,
    revenue_range: input.revenueRange ?? null,
    years_in_business: input.yearsInBusiness ?? null,
    listing_provider: input.listingProvider ?? null,
    listing_id: input.listingId ?? null,
    listing_url: input.listingUrl ?? null,
    listing_categories_json: input.listingCategories ?? [],
    attributes_json: input.attributes ?? {},
    website_status: input.websiteStatus ?? (input.websiteUrl ? "unknown" : "none"),
    data_source: input.dataSource ?? null,
    data_confidence: input.dataConfidence ?? 0.8,
    is_demo: input.isDemo ? 1 : 0,
    last_verified_at: timestamp,
    created_by: options.createdBy ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return { business: getBusiness(orgId, id)!, created: true };
}

export function updateBusiness(orgId: string, businessId: string, patch: Partial<Business>): Business | null {
  const columnMap: Record<string, string> = {
    name: "name", legalName: "legal_name", industry: "industry", category: "category", description: "description",
    addressLine1: "address_line1", addressLine2: "address_line2", city: "city", state: "state", country: "country",
    postalCode: "postal_code", latitude: "latitude", longitude: "longitude", phone: "phone", email: "email",
    websiteUrl: "website_url", socials: "socials_json", hours: "hours_json", rating: "rating", reviewCount: "review_count",
    priceLevel: "price_level", employeeRange: "employee_range", revenueRange: "revenue_range",
    yearsInBusiness: "years_in_business", websiteStatus: "website_status", screenshotUrl: "screenshot_url",
    listingCategories: "listing_categories_json", attributes: "attributes_json", dataSource: "data_source",
    dataConfidence: "data_confidence", lastVerifiedAt: "last_verified_at",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (!Object.keys(values).length) return getBusiness(orgId, businessId);
  values.updated_at = new Date().toISOString();
  update("businesses", businessId, values);
  return getBusiness(orgId, businessId);
}

export function businessFacets(orgId: string): {
  industries: { value: string; count: number }[];
  cities: { value: string; count: number }[];
  countries: { value: string; count: number }[];
  sources: { value: string; count: number }[];
} {
  const grouped = (column: string) =>
    all<{ value: string | null; count: number }>(
      `SELECT ${column} AS value, COUNT(*) AS count FROM businesses WHERE org_id = ? AND ${column} IS NOT NULL AND ${column} != '' GROUP BY ${column} ORDER BY count DESC LIMIT 60`,
      [orgId],
    ).map((r) => ({ value: r.value ?? "", count: r.count }));

  return {
    industries: grouped("industry"),
    cities: grouped("city"),
    countries: grouped("country"),
    sources: grouped("data_source"),
  };
}

export function countBusinesses(orgId: string): number {
  return one<{ c: number }>("SELECT COUNT(*) AS c FROM businesses WHERE org_id = ?", [orgId])?.c ?? 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   Contacts
   ══════════════════════════════════════════════════════════════════════════ */

interface ContactRow {
  id: string; org_id: string; business_id: string | null; name: string; title: string | null; email: string | null;
  phone: string | null; phone_e164: string | null; linkedin_url: string | null; is_primary: number; source: string | null;
  email_status: string; phone_status: string; timezone: string | null; tags_json: string; notes: string | null;
  last_verified_at: string | null; created_at: string; updated_at: string;
}

export function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    orgId: row.org_id,
    businessId: row.business_id,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    phoneE164: row.phone_e164,
    linkedinUrl: row.linkedin_url,
    isPrimary: toBool(row.is_primary),
    source: row.source,
    emailStatus: row.email_status,
    phoneStatus: row.phone_status,
    timezone: row.timezone,
    tags: parseJson<string[]>(row.tags_json, []),
    notes: row.notes,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listContacts(orgId: string, filter: { businessId?: string; search?: string; limit?: number } = {}): Contact[] {
  const clauses = ["org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.businessId) {
    clauses.push("business_id = ?");
    params.push(filter.businessId);
  }
  if (filter.search) {
    clauses.push("(name LIKE ? OR email LIKE ? OR phone LIKE ? OR title LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }
  return all<ContactRow>(
    `SELECT * FROM contacts WHERE ${clauses.join(" AND ")} ORDER BY is_primary DESC, created_at DESC LIMIT ?`,
    [...params, Math.min(filter.limit ?? 100, 500)],
  ).map(mapContact);
}

export function getContact(orgId: string, contactId: string): Contact | null {
  const row = one<ContactRow>("SELECT * FROM contacts WHERE id = ? AND org_id = ?", [contactId, orgId]);
  return row ? mapContact(row) : null;
}

export function createContact(orgId: string, input: Partial<Contact> & { name: string }, options: { dedupe?: boolean } = {}): { contact: Contact; created: boolean } {
  if (options.dedupe !== false && input.email) {
    const existing = one<{ id: string }>("SELECT id FROM contacts WHERE org_id = ? AND lower(email) = lower(?) LIMIT 1", [orgId, input.email]);
    if (existing) {
      const contact = getContact(orgId, existing.id);
      if (contact) return { contact, created: false };
    }
  }
  const id = newId("con");
  const timestamp = new Date().toISOString();
  if (input.isPrimary && input.businessId) {
    run("UPDATE contacts SET is_primary = 0 WHERE business_id = ?", [input.businessId]);
  }
  insert("contacts", {
    id,
    org_id: orgId,
    business_id: input.businessId ?? null,
    name: input.name,
    title: input.title ?? null,
    email: input.email ? input.email.toLowerCase() : null,
    phone: input.phone ?? null,
    phone_e164: input.phoneE164 ?? normalizePhone(input.phone),
    linkedin_url: input.linkedinUrl ?? null,
    is_primary: input.isPrimary ? 1 : 0,
    source: input.source ?? "manual",
    email_status: input.emailStatus ?? (input.email ? "unverified" : "missing"),
    phone_status: input.phoneStatus ?? (input.phone ? "unverified" : "missing"),
    timezone: input.timezone ?? null,
    tags_json: input.tags ?? [],
    notes: input.notes ?? null,
    last_verified_at: input.lastVerifiedAt ?? timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return { contact: getContact(orgId, id)!, created: true };
}

export function updateContact(orgId: string, contactId: string, patch: Partial<Contact>): Contact | null {
  const columnMap: Record<string, string> = {
    name: "name", title: "title", email: "email", phone: "phone", phoneE164: "phone_e164",
    linkedinUrl: "linkedin_url", isPrimary: "is_primary", emailStatus: "email_status",
    phoneStatus: "phone_status", tags: "tags_json", notes: "notes", lastVerifiedAt: "last_verified_at",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = key === "email" && typeof value === "string" ? value.toLowerCase() : value;
  });
  if (!Object.keys(values).length) return getContact(orgId, contactId);
  values.updated_at = new Date().toISOString();
  update("contacts", contactId, values);
  return getContact(orgId, contactId);
}

export function primaryContactFor(orgId: string, businessId: string): Contact | null {
  const row = one<ContactRow>(
    "SELECT * FROM contacts WHERE org_id = ? AND business_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1",
    [orgId, businessId],
  );
  return row ? mapContact(row) : null;
}

/** Minimal, dependency-free phone normaliser for display and dedupe. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (/^0\d{9,10}$/.test(digits)) return `+44${digits.slice(1)}`; // UK default
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return digits.length >= 7 ? `+${digits}` : null;
}

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim());
}

export function isRoleEmail(email: string): boolean {
  return /^(info|hello|enquiries|enquiry|contact|admin|sales|office|reception|mail)@/i.test(email);
}

export function findDuplicateContacts(orgId: string): { email: string; count: number; ids: string[] }[] {
  return all<{ email: string; count: number; ids: string }>(
    `SELECT lower(email) AS email, COUNT(*) AS count, GROUP_CONCAT(id) AS ids FROM contacts
     WHERE org_id = ? AND email IS NOT NULL AND email != '' GROUP BY lower(email) HAVING COUNT(*) > 1`,
    [orgId],
  ).map((row) => ({ email: row.email, count: row.count, ids: row.ids.split(",") }));
}

export function findDuplicateBusinesses(orgId: string): { key: string; count: number; ids: string[]; names: string }[] {
  return all<{ key: string; count: number; ids: string; names: string }>(
    `SELECT lower(replace(replace(name,' ',''),'.','')) AS key, COUNT(*) AS count,
            GROUP_CONCAT(id) AS ids, GROUP_CONCAT(name) AS names
     FROM businesses WHERE org_id = ? GROUP BY key HAVING COUNT(*) > 1`,
    [orgId],
  ).map((row) => ({ key: row.key, count: row.count, ids: row.ids.split(","), names: row.names }));
}

/* ══════════════════════════════════════════════════════════════════════════
   Websites & audits
   ══════════════════════════════════════════════════════════════════════════ */

interface WebsiteRow {
  id: string; org_id: string; business_id: string; url: string; normalized_url: string; host: string;
  status: string; https: number; http_status: number | null; redirect_chain_json: string; cms: string | null;
  tech_json: string; page_count: number | null; has_viewport: number | null; has_sitemap: number | null;
  has_robots: number | null; copyright_year: number | null; est_age_years: number | null;
  screenshot_url: string | null; last_crawled_at: string | null; created_at: string; updated_at: string;
}

function mapWebsite(row: WebsiteRow): Website {
  return {
    id: row.id,
    orgId: row.org_id,
    businessId: row.business_id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    host: row.host,
    status: row.status,
    https: toBool(row.https),
    httpStatus: row.http_status,
    redirectChain: parseJson<{ from: string; to: string; status: number }[]>(row.redirect_chain_json, []),
    cms: row.cms,
    tech: parseJson<string[]>(row.tech_json, []),
    pageCount: row.page_count ?? 0,
    hasViewport: row.has_viewport === null ? null : toBool(row.has_viewport),
    hasSitemap: row.has_sitemap === null ? null : toBool(row.has_sitemap),
    hasRobots: row.has_robots === null ? null : toBool(row.has_robots),
    copyrightYear: row.copyright_year,
    estAgeYears: row.est_age_years,
    screenshotUrl: row.screenshot_url,
    lastCrawledAt: row.last_crawled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertWebsite(orgId: string, businessId: string, rawUrl: string): Website {
  const normalized = normalizeUrl(rawUrl);
  const existing = one<WebsiteRow>("SELECT * FROM websites WHERE org_id = ? AND normalized_url = ?", [orgId, normalized]);
  if (existing) return mapWebsite(existing);

  const id = newId("web");
  const timestamp = new Date().toISOString();
  insert("websites", {
    id,
    org_id: orgId,
    business_id: businessId,
    url: rawUrl,
    normalized_url: normalized,
    host: hostOf(normalized),
    status: "unchecked",
    https: normalized.startsWith("https://") ? 1 : 0,
    redirect_chain_json: [],
    tech_json: [],
    created_at: timestamp,
    updated_at: timestamp,
  });
  run("UPDATE businesses SET website_url = COALESCE(website_url, ?), updated_at = ? WHERE id = ?", [rawUrl, timestamp, businessId]);
  return mapWebsite(one<WebsiteRow>("SELECT * FROM websites WHERE id = ?", [id])!);
}

export function getWebsite(orgId: string, websiteId: string): Website | null {
  const row = one<WebsiteRow>("SELECT * FROM websites WHERE id = ? AND org_id = ?", [websiteId, orgId]);
  return row ? mapWebsite(row) : null;
}

export function websiteForBusiness(orgId: string, businessId: string): Website | null {
  const row = one<WebsiteRow>("SELECT * FROM websites WHERE org_id = ? AND business_id = ? ORDER BY created_at DESC LIMIT 1", [orgId, businessId]);
  return row ? mapWebsite(row) : null;
}

export function updateWebsite(websiteId: string, patch: Partial<Website>): void {
  const columnMap: Record<string, string> = {
    status: "status", https: "https", httpStatus: "http_status", redirectChain: "redirect_chain_json",
    cms: "cms", tech: "tech_json", pageCount: "page_count", hasViewport: "has_viewport",
    hasSitemap: "has_sitemap", hasRobots: "has_robots", copyrightYear: "copyright_year",
    estAgeYears: "est_age_years", screenshotUrl: "screenshot_url", lastCrawledAt: "last_crawled_at",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (!Object.keys(values).length) return;
  values.updated_at = new Date().toISOString();
  update("websites", websiteId, values);
}

interface AuditRow {
  id: string; org_id: string; website_id: string | null; business_id: string; job_id: string | null;
  status: string; engine_version: string; mode: string; overall_score: number | null; performance: number | null;
  mobile: number | null; seo: number | null; ux: number | null; accessibility: number | null;
  conversion: number | null; technical: number | null; content: number | null; trust: number | null;
  metrics_json: string; findings_json: string; opportunities_json: string; pages_json: string; tech_json: string;
  core_web_vitals_json: string; notes: string | null; error: string | null; duration_ms: number | null;
  started_at: string | null; completed_at: string | null; created_at: string; url?: string | null;
}

function mapAudit(row: AuditRow): Audit {
  return {
    id: row.id,
    orgId: row.org_id,
    websiteId: row.website_id,
    businessId: row.business_id,
    jobId: row.job_id,
    status: row.status as Audit["status"],
    engineVersion: row.engine_version,
    mode: row.mode as Audit["mode"],
    overallScore: row.overall_score,
    performance: row.performance,
    mobile: row.mobile,
    seo: row.seo,
    ux: row.ux,
    accessibility: row.accessibility,
    conversion: row.conversion,
    technical: row.technical,
    content: row.content,
    trust: row.trust,
    metrics: parseJson<AuditMetric[]>(row.metrics_json, []),
    findings: parseJson<AuditFinding[]>(row.findings_json, []),
    opportunities: parseJson<AuditFinding[]>(row.opportunities_json, []),
    pages: parseJson<Audit["pages"]>(row.pages_json, []),
    tech: parseJson<string[]>(row.tech_json, []),
    coreWebVitals: parseJson<Record<string, unknown>>(row.core_web_vitals_json, {}),
    notes: row.notes,
    error: row.error,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    url: row.url ?? null,
  };
}

export function createAudit(orgId: string, input: {
  businessId: string;
  websiteId?: string | null;
  jobId?: string | null;
  status?: Audit["status"];
  mode?: Audit["mode"];
}): Audit {
  const id = newId("aud");
  const timestamp = new Date().toISOString();
  insert("website_audits", {
    id,
    org_id: orgId,
    website_id: input.websiteId ?? null,
    business_id: input.businessId,
    job_id: input.jobId ?? null,
    status: input.status ?? "queued",
    engine_version: "1.0.0",
    mode: input.mode ?? "live",
    metrics_json: [],
    findings_json: [],
    opportunities_json: [],
    pages_json: [],
    tech_json: [],
    core_web_vitals_json: {},
    started_at: timestamp,
    created_at: timestamp,
  });
  return mapAudit(one<AuditRow>("SELECT * FROM website_audits WHERE id = ?", [id])!);
}

export function saveAudit(orgId: string, auditId: string, input: {
  status: Audit["status"];
  overallScore?: number | null;
  scores?: Record<string, number | null>;
  metrics?: AuditMetric[];
  findings?: AuditFinding[];
  opportunities?: AuditFinding[];
  pages?: Audit["pages"];
  tech?: string[];
  coreWebVitals?: Record<string, unknown>;
  error?: string | null;
  durationMs?: number | null;
  notes?: string | null;
}): Audit | null {
  const values: Record<string, unknown> = {
    status: input.status,
    completed_at: new Date().toISOString(),
    error: input.error ?? null,
  };
  if (input.overallScore !== undefined) values.overall_score = input.overallScore;
  (["performance", "mobile", "seo", "ux", "accessibility", "conversion", "technical", "content", "trust"] as AuditDimension[]).forEach((dimension) => {
    if (input.scores?.[dimension] !== undefined) values[dimension] = input.scores[dimension];
  });
  if (input.metrics) values.metrics_json = input.metrics;
  if (input.findings) values.findings_json = input.findings;
  if (input.opportunities) values.opportunities_json = input.opportunities;
  if (input.pages) values.pages_json = input.pages;
  if (input.tech) values.tech_json = input.tech;
  if (input.coreWebVitals) values.core_web_vitals_json = input.coreWebVitals;
  if (input.durationMs !== undefined) values.duration_ms = input.durationMs;
  if (input.notes !== undefined) values.notes = input.notes;
  update("website_audits", auditId, values);

  // Keep the business-level website status in sync with the freshest score.
  const auditRow = one<{ business_id: string }>("SELECT business_id FROM website_audits WHERE id = ?", [auditId]);
  if (auditRow && input.overallScore !== undefined) {
    run("UPDATE businesses SET website_status = ?, updated_at = ? WHERE id = ?", [
      websiteStatusFromScore(input.overallScore),
      new Date().toISOString(),
      auditRow.business_id,
    ]);
  }
  return getAudit(orgId, auditId);
}

export function websiteStatusFromScore(score: number | null | undefined): WebsiteStatus {
  if (score === null || score === undefined) return "unknown";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 55) return "average";
  if (score >= 40) return "poor";
  return "very_poor";
}

export function getAudit(orgId: string, auditId: string): Audit | null {
  const row = one<AuditRow>(
    `SELECT a.*, w.url AS url FROM website_audits a LEFT JOIN websites w ON w.id = a.website_id WHERE a.id = ? AND a.org_id = ?`,
    [auditId, orgId],
  );
  return row ? mapAudit(row) : null;
}

export function latestAuditForBusiness(orgId: string, businessId: string): Audit | null {
  const row = one<AuditRow>(
    `SELECT a.*, w.url AS url FROM website_audits a LEFT JOIN websites w ON w.id = a.website_id
     WHERE a.business_id = ? AND a.org_id = ? AND a.status = 'complete' ORDER BY a.created_at DESC LIMIT 1`,
    [businessId, orgId],
  );
  return row ? mapAudit(row) : null;
}

export function listAudits(orgId: string, filter: { businessId?: string; status?: string; limit?: number; offset?: number; maxScore?: number; minScore?: number } = {}): { items: Audit[]; total: number } {
  const clauses = ["a.org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.businessId) { clauses.push("a.business_id = ?"); params.push(filter.businessId); }
  if (filter.status) { clauses.push("a.status = ?"); params.push(filter.status); }
  if (filter.maxScore !== undefined) { clauses.push("a.overall_score <= ?"); params.push(filter.maxScore); }
  if (filter.minScore !== undefined) { clauses.push("a.overall_score >= ?"); params.push(filter.minScore); }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<AuditRow>(
    `SELECT a.*, w.url AS url FROM website_audits a LEFT JOIN websites w ON w.id = a.website_id ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 500), filter.offset ?? 0],
  ).map(mapAudit);
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM website_audits a ${where}`, params)?.total ?? 0;
  return { items, total };
}

/** Businesses needing an audit (queued or stale). */
export function businessesNeedingAudit(orgId: string, limit = 50): { businessId: string; name: string; url: string }[] {
  return all<{ business_id: string; name: string; website_url: string }>(
    `SELECT b.id AS business_id, b.name, b.website_url
     FROM businesses b
     WHERE b.org_id = ? AND b.website_url IS NOT NULL AND b.website_url != ''
       AND NOT EXISTS (
         SELECT 1 FROM website_audits a WHERE a.business_id = b.id AND a.status IN ('queued','running')
       )
       AND NOT EXISTS (
         SELECT 1 FROM website_audits a2 WHERE a2.business_id = b.id AND a2.status = 'complete' AND a2.created_at > datetime('now','-30 days')
       )
     ORDER BY COALESCE(b.review_count,0) DESC LIMIT ?`,
    [orgId, limit],
  ).map((row) => ({ businessId: row.business_id, name: row.name, url: row.website_url }));
}
