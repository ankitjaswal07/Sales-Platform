import "server-only";

import type { DiscoveredBusiness, DiscoveryQuery } from "./discovery";

/**
 * Built-in sample business dataset.
 *
 * This is NOT presented as real market data. Every record is labelled
 * `data_source: "leadforge_sample"` and the UI displays a clear banner. Its
 * purpose is to make every workflow — discovery, audit, scoring, proposals,
 * outreach — fully exercisable before a data provider is connected, and to make
 * the product demonstrable without fabricating claims about real businesses
 * (§69, but with honesty about what the data is).
 *
 * Generation is deterministic: the same query always produces the same set, so
 * screenshots and demos are reproducible.
 */

export const SAMPLE_DATA_NOTE =
  "No business-data provider is connected, so these are clearly-labelled sample listings generated locally. Connect Google Places or Yelp to search real public business data. Sample records are marked in the UI and never used for real outreach.";

interface Template {
  industry: string;
  category: string;
  names: string[];
  websitePattern: "none" | "mixed" | "legacy" | "modern";
  phonePrefix: string;
  employees: string;
  reviewRange: [number, number];
  ratingRange: [number, number];
  yearsRange: [number, number];
}

const TEMPLATES: Template[] = [
  { industry: "Construction", category: "Building contractor", names: ["Ashworth Construction", "Bramble & Sons Builders", "Northgate Building Co", "Keswick Contractors", "Ironbridge Developments", "Hollowfield Construction"], websitePattern: "mixed", phonePrefix: "0161", employees: "10-49", reviewRange: [18, 240], ratingRange: [3.6, 4.9], yearsRange: [6, 42] },
  { industry: "Dental", category: "Dental practice", names: ["Brightwell Dental", "Riverside Dental Care", "Oakfield Dental Studio", "Elmwood Family Dentistry", "Meridian Dental Clinic", "Harbourside Smiles"], websitePattern: "legacy", phonePrefix: "020", employees: "5-9", reviewRange: [40, 480], ratingRange: [4.1, 4.9], yearsRange: [8, 30] },
  { industry: "Restaurant", category: "Restaurant", names: ["The Copper Kettle", "Larders & Lye", "Saltmarsh Kitchen", "The Old Bakery Bistro", "Rookwood Dining Rooms", "Marina Brasserie"], websitePattern: "mixed", phonePrefix: "020", employees: "10-49", reviewRange: [80, 1200], ratingRange: [3.9, 4.8], yearsRange: [2, 26] },
  { industry: "Real Estate", category: "Estate agent", names: ["Grange & Whittle", "Belleview Property", "Cornerstone Estates", "Ashton Rise Lettings", "Maplewood Property Group", "Quayside Homes"], websitePattern: "modern", phonePrefix: "020", employees: "10-49", reviewRange: [25, 320], ratingRange: [3.5, 4.9], yearsRange: [5, 38] },
  { industry: "Plumbing", category: "Plumber", names: ["Draincraft Plumbing", "Hale & Foster Heating", "Emergency Flow Plumbing", "Pemberton Gas Services", "Clearwater Plumbing Co", "Barrowford Boilers"], websitePattern: "legacy", phonePrefix: "0161", employees: "1-4", reviewRange: [30, 520], ratingRange: [4.0, 5.0], yearsRange: [3, 25] },
  { industry: "HVAC", category: "Air conditioning", names: ["ThermaCore Climate", "Airedale HVAC Services", "Northwind Cooling", "Ventico Systems", "Precision Air Solutions"], websitePattern: "modern", phonePrefix: "0113", employees: "10-49", reviewRange: [12, 140], ratingRange: [4.0, 4.9], yearsRange: [4, 28] },
  { industry: "Legal", category: "Solicitor", names: ["Harrow & Blythe Solicitors", "Wrenfield Legal", "Castlegate Law", "Iveson & Grey", "Merrow Legal Partnership"], websitePattern: "mixed", phonePrefix: "020", employees: "10-49", reviewRange: [15, 210], ratingRange: [3.8, 4.9], yearsRange: [7, 60] },
  { industry: "Accounting", category: "Accountant", names: ["Ledgerline Accounting", "Pemberton & Vale", "Northcounty Tax", "Balancewell Accounts", "Cavendish Finance Partners"], websitePattern: "legacy", phonePrefix: "0161", employees: "5-9", reviewRange: [8, 120], ratingRange: [4.2, 5.0], yearsRange: [5, 35] },
  { industry: "Medical", category: "Physiotherapy clinic", names: ["Spinewell Physiotherapy", "Bodyline Sports Clinic", "Elmwood Chiropractic", "Restore Physio", "Gait & Motion Clinic"], websitePattern: "mixed", phonePrefix: "0117", employees: "5-9", reviewRange: [35, 400], ratingRange: [4.3, 5.0], yearsRange: [4, 22] },
  { industry: "Automotive", category: "Garage", names: ["Bayfield Motors", "Torque Lane Garage", "Ashcroft Auto Centre", "Riverside MOT & Service", "Gearhouse Automotive"], websitePattern: "legacy", phonePrefix: "0151", employees: "5-9", reviewRange: [45, 600], ratingRange: [4.0, 4.9], yearsRange: [6, 40] },
  { industry: "Cleaning", category: "Commercial cleaning", names: ["Sparkline Commercial Cleaning", "Pristine Facility Services", "Clearview Contract Cleaners", "Lumos Cleaning Group"], websitePattern: "none", phonePrefix: "0121", employees: "10-49", reviewRange: [3, 80], ratingRange: [4.0, 5.0], yearsRange: [2, 18] },
  { industry: "Landscaping", category: "Landscaping", names: ["Greenacre Landscapes", "Willowfield Garden Design", "Stonebrook Paving", "Fernhollow Grounds", "Birchwood Outdoor Living"], websitePattern: "mixed", phonePrefix: "0113", employees: "5-9", reviewRange: [14, 260], ratingRange: [4.1, 5.0], yearsRange: [3, 20] },
  { industry: "Fitness", category: "Gym", names: ["Ironworks Strength", "Momentum Fitness Studio", "The Conditioning Room", "Fielder Health Club"], websitePattern: "modern", phonePrefix: "020", employees: "5-9", reviewRange: [60, 900], ratingRange: [4.0, 4.9], yearsRange: [2, 15] },
  { industry: "Beauty", category: "Hair salon", names: ["Fable Hair Studio", "The Rosewood Salon", "Marlowe & Co Hairdressing", "Lumen Beauty Rooms", "Sable Aesthetics"], websitePattern: "mixed", phonePrefix: "020", employees: "5-9", reviewRange: [40, 620], ratingRange: [4.2, 5.0], yearsRange: [3, 24] },
  { industry: "Veterinary", category: "Veterinary practice", names: ["Brookvale Vets", "Pawsome Veterinary Care", "Oakridge Animal Hospital", "Meadow Lane Vets"], websitePattern: "legacy", phonePrefix: "0113", employees: "10-49", reviewRange: [70, 700], ratingRange: [4.3, 5.0], yearsRange: [8, 45] },
  { industry: "Professional Services", category: "Marketing agency", names: ["Northern Light Marketing", "Craftwell Studio", "Beacon Digital", "Thistle & Co Consulting"], websitePattern: "modern", phonePrefix: "0131", employees: "5-9", reviewRange: [5, 90], ratingRange: [4.0, 5.0], yearsRange: [2, 14] },
  { industry: "Manufacturing", category: "Precision engineering", names: ["Halstead Precision", "Fenwick Engineering", "Cobalt Metalworks", "Ridgeway Fabrication"], websitePattern: "legacy", phonePrefix: "0113", employees: "50-200", reviewRange: [4, 60], ratingRange: [3.8, 5.0], yearsRange: [12, 65] },
  { industry: "Education", category: "Tutoring service", names: ["Beacon Tutors", "Brightpath Education", "The Study Room", "Northstar Learning"], websitePattern: "mixed", phonePrefix: "020", employees: "5-9", reviewRange: [10, 180], ratingRange: [4.4, 5.0], yearsRange: [2, 16] },
];

const CITIES: { city: string; state: string; country: string; postcodePrefix: string; lat: number; lng: number }[] = [
  { city: "London", state: "England", country: "United Kingdom", postcodePrefix: "EC", lat: 51.5072, lng: -0.1276 },
  { city: "Manchester", state: "England", country: "United Kingdom", postcodePrefix: "M", lat: 53.4808, lng: -2.2426 },
  { city: "Birmingham", state: "England", country: "United Kingdom", postcodePrefix: "B", lat: 52.4862, lng: -1.8904 },
  { city: "Leeds", state: "England", country: "United Kingdom", postcodePrefix: "LS", lat: 53.8008, lng: -1.5491 },
  { city: "Bristol", state: "England", country: "United Kingdom", postcodePrefix: "BS", lat: 51.4545, lng: -2.5879 },
  { city: "Liverpool", state: "England", country: "United Kingdom", postcodePrefix: "L", lat: 53.4084, lng: -2.9916 },
  { city: "Edinburgh", state: "Scotland", country: "United Kingdom", postcodePrefix: "EH", lat: 55.9533, lng: -3.1883 },
  { city: "New York", state: "New York", country: "United States", postcodePrefix: "100", lat: 40.7128, lng: -74.006 },
  { city: "Chicago", state: "Illinois", country: "United States", postcodePrefix: "606", lat: 41.8781, lng: -87.6298 },
  { city: "Austin", state: "Texas", country: "United States", postcodePrefix: "787", lat: 30.2672, lng: -97.7431 },
  { city: "Dublin", state: "Leinster", country: "Ireland", postcodePrefix: "D", lat: 53.3498, lng: -6.2603 },
  { city: "Sydney", state: "New South Wales", country: "Australia", postcodePrefix: "200", lat: -33.8688, lng: 151.2093 },
  { city: "Toronto", state: "Ontario", country: "Canada", postcodePrefix: "M5", lat: 43.6532, lng: -79.3832 },
];

/* ── deterministic pseudo-random ─────────────────────────────────────────── */

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: string, index: number, min: number, max: number): number {
  const value = hash(`${seed}:${index}`);
  return min + (value % (Math.round((max - min) * 100) + 1)) / 100;
}

function pick<T>(items: T[], seed: string, index: number): T {
  return items[hash(`${seed}:pick:${index}`) % items.length];
}

const WEBSITE_ROOT: Record<string, string> = {
  Construction: "ashworthconstruction",
  Dental: "brightwelldental",
  Restaurant: "copperkettlektichen",
  "Real Estate": "grangewhittle",
  Plumbing: "draincraft",
  HVAC: "thermacore",
  Legal: "harrowblythe",
  Accounting: "ledgerline",
  Medical: "spinewell",
  Automotive: "bayfieldmotors",
  Cleaning: "sparkline",
  Landscaping: "greenacre",
  Fitness: "ironworks",
  Beauty: "fablehair",
  Veterinary: "brookvalevets",
  "Professional Services": "northernlight",
  Manufacturing: "halsteadprecision",
  Education: "beacontutors",
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 22);
}

const LEGACY_HOSTS = ["business.site", "wixsite.com", "godaddysites.com", "weebly.com"];

export function sampleListings(query: {
  industry?: string;
  city?: string;
  country?: string;
  minRating?: number;
  minReviews?: number;
  maxReviews?: number;
  websiteQuality?: DiscoveryQuery["websiteQuality"];
  limit?: number;
}): DiscoveredBusiness[] {
  const limit = Math.min(query.limit ?? 25, 120);
  const wantedIndustry = query.industry?.toLowerCase().trim();

  let templates = TEMPLATES;
  if (wantedIndustry) {
    const matched = TEMPLATES.filter(
      (t) => t.industry.toLowerCase().includes(wantedIndustry) || t.category.toLowerCase().includes(wantedIndustry),
    );
    if (matched.length) templates = matched;
  }

  let cities = CITIES;
  if (query.city) {
    const matched = CITIES.filter((c) => c.city.toLowerCase() === query.city!.toLowerCase().trim());
    if (matched.length) cities = matched;
    else if (query.country) {
      const matchedCountry = CITIES.filter((c) => c.country.toLowerCase() === query.country!.toLowerCase().trim());
      if (matchedCountry.length) cities = matchedCountry;
    }
  } else if (query.country) {
    const matchedCountry = CITIES.filter((c) => c.country.toLowerCase() === query.country!.toLowerCase().trim());
    if (matchedCountry.length) cities = matchedCountry;
  }

  const results: DiscoveredBusiness[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  while (results.length < limit && cursor < limit * 6) {
    const template = templates[cursor % templates.length];
    const location = cities[Math.floor(cursor / 2) % cities.length];
    const seed = `${template.industry}|${location.city}`;
    const index = Math.floor(cursor / (templates.length * cities.length)) + Math.floor(cursor / templates.length);

    const name = pick(template.names, seed, index);
    const key = `${name}|${location.city}`;
    cursor += 1;
    if (seen.has(key)) continue;
    seen.add(key);

    const rating = Math.round(seeded(`${seed}:rating`, index, template.ratingRange[0], template.ratingRange[1]) * 10) / 10;
    const reviewCount = Math.round(seeded(`${seed}:reviews`, index, template.reviewRange[0], template.reviewRange[1]));
    const years = Math.round(seeded(`${seed}:years`, index, template.yearsRange[0], template.yearsRange[1]));

    if (query.minRating !== undefined && rating < query.minRating) continue;
    if (query.minReviews !== undefined && reviewCount < query.minReviews) continue;
    if (query.maxReviews !== undefined && reviewCount > query.maxReviews) continue;

    /* Website presence is derived from the template's profile plus a stable
       per-record coin flip, so the mix is realistic rather than uniform. */
    const coin = seeded(`${seed}:web`, index, 0, 1);
    let websiteUrl: string | null = null;
    if (template.websitePattern === "none") {
      websiteUrl = coin > 0.8 ? buildUrl(template, name, location, "legacy") : null;
    } else if (template.websitePattern === "legacy") {
      websiteUrl = coin > 0.12 ? buildUrl(template, name, location, coin > 0.55 ? "legacy" : "own") : null;
    } else if (template.websitePattern === "mixed") {
      websiteUrl = coin > 0.15 ? buildUrl(template, name, location, coin > 0.6 ? "legacy" : "own") : null;
    } else {
      websiteUrl = coin > 0.06 ? buildUrl(template, name, location, "own") : null;
    }

    const quality = query.websiteQuality ?? "any";
    if (quality === "no_website" && websiteUrl) continue;
    if (quality !== "any" && quality !== "no_website" && !websiteUrl) continue;

    results.push({
      name,
      industry: template.industry,
      category: template.category,
      description: `${template.category} serving ${location.city} and the surrounding area. Established for ${years} years.`,
      addressLine1: `${Math.round(seeded(`${seed}:street`, index, 1, 240))} ${pick(["High Street", "Market Street", "Station Road", "Church Lane", "Mill Lane", "Park Road"], seed, index)}`,
      city: location.city,
      state: location.state,
      country: location.country,
      postalCode: `${location.postcodePrefix}${Math.round(seeded(`${seed}:pc`, index, 1, 9))} ${Math.round(seeded(`${seed}:pc2`, index, 1, 9))}${String.fromCharCode(65 + (hash(`${seed}:pc3:${index}`) % 26))}${String.fromCharCode(65 + (hash(`${seed}:pc4:${index}`) % 26))}`,
      latitude: location.lat + seeded(`${seed}:lat`, index, -0.06, 0.06),
      longitude: location.lng + seeded(`${seed}:lng`, index, -0.06, 0.06),
      phone: `+44 ${template.phonePrefix.slice(1)} ${Math.round(seeded(`${seed}:p1`, index, 200, 999))} ${Math.round(seeded(`${seed}:p2`, index, 100, 999))}`,
      email: null,
      websiteUrl,
      socials: hash(`${seed}:social:${index}`) % 3 === 0
        ? { facebook: `https://facebook.com/${slug(name)}` }
        : hash(`${seed}:social2:${index}`) % 3 === 0
          ? { facebook: `https://facebook.com/${slug(name)}`, instagram: `https://instagram.com/${slug(name)}` }
          : {},
      rating,
      reviewCount,
      employeeRange: template.employees,
      yearsInBusiness: years,
      listingProvider: "leadforge_sample",
      listingId: `sample_${hash(key).toString(36)}`,
      listingUrl: null,
      dataSource: "leadforge_sample",
      dataConfidence: 0.4,
      hourCount: 5 + (hash(`${seed}:hours:${index}`) % 3),
    });
  }

  // Prioritise the biggest opportunities first: no website, then most reviews.
  return results.sort((a, b) => {
    if (!a.websiteUrl && b.websiteUrl) return -1;
    if (a.websiteUrl && !b.websiteUrl) return 1;
    return b.reviewCount - a.reviewCount;
  });
}

function buildUrl(
  template: Template,
  name: string,
  location: { city: string },
  kind: "legacy" | "own",
): string {
  const root = WEBSITE_ROOT[template.industry] ?? slug(name);
  if (kind === "legacy") {
    const host = LEGACY_HOSTS[hash(`${name}${location.city}`) % LEGACY_HOSTS.length];
    if (host === "business.site") return `https://${root}-${slug(location.city)}.business.site`;
    return `https://${root}${hash(name) % 90}.${host}/${slug(location.city)}`;
  }
  return `https://www.${root}.co.uk`;
}

export const SAMPLE_CITIES = CITIES.map((c) => ({ city: c.city, country: c.country }));
export const SAMPLE_INDUSTRIES = TEMPLATES.map((t) => ({ industry: t.industry, category: t.category }));
