import type { CommandInterpretation } from "../types";
import { industryProfile, allIndustryProfiles } from "./industry";

/**
 * AI Command Centre interpreter (§38).
 *
 * Turns a natural-language instruction into a structured filter set plus a list
 * of proposed actions. Destructive actions are always marked as requiring
 * confirmation and are never executed by the interpreter itself.
 */

const INDUSTRY_HINTS = new Map<string, string>();
allIndustryProfiles().forEach((profile) => {
  INDUSTRY_HINTS.set(profile.key, profile.label);
  profile.aliases.forEach((alias) => INDUSTRY_HINTS.set(alias, profile.label));
});

const CITY_HINTS = [
  "london", "manchester", "birmingham", "leeds", "liverpool", "bristol", "sheffield", "newcastle", "nottingham", "leicester",
  "glasgow", "edinburgh", "cardiff", "belfast", "brighton", "southampton", "reading", "oxford", "cambridge", "york",
  "new york", "los angeles", "chicago", "houston", "phoenix", "philadelphia", "san diego", "dallas", "austin", "seattle",
  "boston", "denver", "atlanta", "miami", "toronto", "vancouver", "sydney", "melbourne", "dublin", "berlin", "paris",
  "amsterdam", "madrid", "barcelona", "dubai", "singapore", "bangalore", "mumbai", "delhi",
];

const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
  "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york state", "north carolina", "north dakota", "ohio", "oklahoma",
  "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington state", "west virginia", "wisconsin", "wyoming",
];

const STATUS_HINTS: { pattern: RegExp; status: string }[] = [
  { pattern: /\bnew leads?\b|\bnot (?:yet )?(?:contacted|reviewed)\b|\bfresh\b/, status: "new" },
  { pattern: /\bqualified\b/, status: "qualified" },
  { pattern: /\bcontacted\b/, status: "contacted" },
  { pattern: /\bengaged\b|\bopened\b|\breplied\b/, status: "engaged" },
  { pattern: /\binterested\b/, status: "interested" },
  { pattern: /\bproposals? (?:sent|out)\b|\bawaiting decision\b/, status: "proposal_sent" },
  { pattern: /\bmeetings?\b|\bcalls? booked\b/, status: "meeting_scheduled" },
  { pattern: /\bnegotiat/, status: "negotiation" },
  { pattern: /\bwon\b|\bclosed won\b|\bclients\b/, status: "won" },
  { pattern: /\blost\b|\bdead\b/, status: "lost" },
];

const TEMPERATURE_HINTS: { pattern: RegExp; value: string }[] = [
  { pattern: /\bhot\b|\bbest\b|\btop\b|\bhigh[- ]potential\b|\bpriority\b|\bhottest\b/, value: "hot" },
  { pattern: /\bwarm\b/, value: "warm" },
  { pattern: /\bcold\b|\blow priority\b/, value: "cold" },
];

export interface CommandContext {
  canWrite: boolean;
  userRole: string;
  availableIndustries: string[];
}

export function interpretCommand(query: string, context: CommandContext): CommandInterpretation {
  const text = query.trim();
  const lower = text.toLowerCase();
  const filters: CommandInterpretation["filters"] = {};
  const actions: CommandInterpretation["actions"] = [];
  let intent: CommandInterpretation["intent"] = "explain";
  const notes: string[] = [];

  /* ── numbers ── */
  const limitMatch = /\b(?:find|show|get|list|send|generate|contact)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?(\d{1,4})\b/.exec(lower) ?? /\btop\s+(\d{1,4})\b/.exec(lower);
  if (limitMatch) filters.limit = Math.min(500, Number(limitMatch[1]));

  /* ── score thresholds ── */
  const scoreBelow = /(?:score|scoring|websites?|sites?)\s*(?:below|under|less than|<)\s*(\d{1,3})/.exec(lower) ?? /(?:below|under|less than|<)\s*(\d{1,3})\s*(?:score)?/.exec(lower);
  if (/website|site/.test(lower) && scoreBelow) filters.maxWebsiteScore = Number(scoreBelow[1]);
  else if (scoreBelow && /website|site/.test(lower)) filters.maxWebsiteScore = Number(scoreBelow[1]);

  const leadScoreAbove = /(?:lead score|score|rating)\s*(?:above|over|greater than|>|at least)\s*(\d{1,3})/.exec(lower);
  if (leadScoreAbove && !/website|site/.test(lower.slice(Math.max(0, leadScoreAbove.index - 20), leadScoreAbove.index))) {
    filters.minLeadScore = Number(leadScoreAbove[1]);
  }

  const reviewsAbove = /(?:more than|over|at least|>=|>)\s*(\d{1,4})\s*reviews?/.exec(lower) ?? /(\d{1,4})\s*\+?\s*reviews?/.exec(lower);
  if (reviewsAbove) filters.minReviews = Number(reviewsAbove[1]);

  /* ── website status ── */
  if (/without? (?:a )?(?:website|site)\b|\bno website\b|\bdon'?t have (?:a )?(?:website|site)\b/.test(lower)) {
    filters.websiteStatus = ["none"];
    notes.push("Filtered to businesses with no website.");
  } else if (/poor|bad|terrible|awful|weak/.test(lower) && /website|site/.test(lower)) {
    filters.websiteStatus = ["poor", "very_poor", "broken"];
  } else if (/outdated|old|dated|stale|ancient/.test(lower)) {
    filters.websiteStatus = ["poor", "average"];
    notes.push("Filtered to websites showing dated-build signals.");
  } else if (/slow|performance|speed/.test(lower)) {
    notes.push("Filtered to websites with poor measured performance.");
    filters.websiteStatus = ["poor", "very_poor", "average"];
  } else if (/not mobile|mobile (?:issues|problems)|poor mobile|unresponsive/.test(lower)) {
    filters.websiteStatus = ["poor", "very_poor", "average"];
  }

  /* ── status ── */
  const statuses: string[] = [];
  STATUS_HINTS.forEach((hint) => {
    if (hint.pattern.test(lower) && !statuses.includes(hint.status)) statuses.push(hint.status);
  });
  if (statuses.length) filters.statuses = statuses;

  if (/haven'?t been contacted|not contacted|never contacted|no contact yet|untouched/.test(lower)) {
    filters.notContacted = true;
    notes.push("Filtered to leads with no outreach activity recorded.");
  }

  /* ── temperature ── */
  const temperatures: string[] = [];
  TEMPERATURE_HINTS.forEach((hint) => {
    if (hint.pattern.test(lower) && !temperatures.includes(hint.value)) temperatures.push(hint.value);
  });
  if (temperatures.length) filters.temperatures = temperatures;

  /* ── intent ── */
  const intentHints: { pattern: RegExp; value: string }[] = [
    { pattern: /\bhigh intent\b|\bready to (?:buy|start)\b|\bhot intent\b/, value: "high_intent" },
    { pattern: /\bwant(?:s|ing)? (?:a )?call\b|\basked for a call\b/, value: "wants_call" },
    { pattern: /\bwant(?:s|ing)? pricing\b|\basked (?:about )?(?:price|cost)/, value: "wants_pricing" },
    { pattern: /\binterested\b/, value: "interested" },
  ];
  intentHints.forEach((hint) => {
    if (hint.pattern.test(lower)) filters.intents = [...(filters.intents ?? []), hint.value];
  });

  /* ── industries ── */
  const industries: string[] = [];
  INDUSTRY_HINTS.forEach((label, alias) => {
    if (alias.length < 4) return;
    if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(lower)) {
      if (!industries.includes(label)) industries.push(label);
    }
  });
  if (industries.length) filters.industries = industries;

  /* ── locations ── */
  const locations: string[] = [];
  [...CITY_HINTS, ...US_STATES].forEach((place) => {
    if (lower.includes(place)) locations.push(place.replace(/\b\w/g, (c) => c.toUpperCase()));
  });
  if (locations.length) filters.locations = locations;

  const countryHints: Record<string, string> = { uk: "United Kingdom", "united kingdom": "United Kingdom", us: "United States", usa: "United States", "united states": "United States", canada: "Canada", australia: "Australia", ireland: "Ireland" };
  Object.entries(countryHints).forEach(([key, value]) => {
    if (new RegExp(`\\b${key}\\b`).test(lower)) filters.countries = [...(filters.countries ?? []), value];
  });

  /* ── time window ── */
  const dayMatch = /(?:last|past|previous)\s+(\d{1,3})\s*(?:days?|weeks?|months?)/.exec(lower);
  if (dayMatch) filters.days = Number(dayMatch[1]) * (/week/.test(dayMatch[0]) ? 7 : /month/.test(dayMatch[0]) ? 30 : 1);
  else if (/\bthis (?:week|7 days)\b|\blast week\b/.test(lower)) filters.days = 7;
  else if (/\bthis month\b|\blast 30 days\b|\bpast month\b/.test(lower)) filters.days = 30;
  else if (/\bthis quarter\b|\blast 90 days\b|\bpast quarter\b/.test(lower)) filters.days = 90;

  /* ── sorting ── */
  if (/best|highest|top|strongest|hot/.test(lower) && /lead|prospect|opportunit/.test(lower)) filters.sort = "lead_score";
  else if (/most reviews|highest reviews|popular/.test(lower)) filters.sort = "reviews";
  else if (/newest|recent|latest/.test(lower)) filters.sort = "created_at";
  else if (/biggest opportunity|best website opportunity|weakest website/.test(lower)) filters.sort = "opportunity";

  /* ── classify the request ── */
  const wantsDiscovery = /find (?:me )?\d{0,4}\s*(?:new )?(?:business|businesses|companies|prospects|leads? to (?:discover|find))|(?:source|discover|prospect for) (?:new )?(?:business|companies|leads)/.test(lower) &&
    !/\b(?:my|existing|current|our) (?:leads|pipeline|list)\b/.test(lower);
  const wantsProposal = /generate (?:the )?proposals?|create (?:the )?proposals?|write (?:the )?proposals?|send (?:the )?proposals?/.test(lower);
  const wantsAnalytics = /which|what|how many|how much|best[- ]performing|conversion rate|revenue|average deal|trend|compare/.test(lower) &&
    !/\b(find|show|list|get)\b/.test(lower);
  const wantsPipelineAction = /\b(assign|move|advance|mark|update|close|convert|delete|archive|send|email|contact)\b/.test(lower);
  const wantsBusinesses = /\b(?:business|businesses|companies|prospects)\b/.test(lower) && !/\bleads?\b/.test(lower);

  if (wantsProposal) intent = "generate_proposals";
  else if (wantsDiscovery && !filters.statuses?.length) intent = "run_discovery";
  else if (wantsAnalytics && !filters.industries?.length && !filters.locations?.length && !filters.minReviews && !filters.maxWebsiteScore) intent = "analytics_query";
  else if (wantsBusinesses) intent = "search_businesses";
  else if (/\b(?:find|show|list|get|search|who)\b/.test(lower)) intent = "search_leads";
  else if (wantsPipelineAction) intent = "pipeline_action";

  /* ── actions ── */
  if (intent === "generate_proposals") {
    actions.push({
      type: "generate_proposals",
      label: `Generate proposals for the top ${filters.limit ?? 10} matching leads`,
      destructive: false,
      requiresConfirmation: true,
      payload: { limit: filters.limit ?? 10 },
    });
    intent = "search_leads";
  }
  if (/send (?:an? )?emails?|start (?:an? )?campaign|add to campaign|outreach/.test(lower)) {
    actions.push({
      type: "create_campaign",
      label: "Create an outreach campaign from these leads",
      destructive: false,
      requiresConfirmation: true,
    });
  }
  if (/audit|analys(e|ze)/.test(lower) && /(?:run|perform|do|start|queue)/.test(lower)) {
    actions.push({ type: "run_audits", label: `Queue full website audits for the top ${filters.limit ?? 25} results`, destructive: false, requiresConfirmation: true, payload: { limit: filters.limit ?? 25 } });
  }
  if (/\b(?:assign|reassign)\b/.test(lower)) {
    actions.push({ type: "assign_owner", label: "Assign these leads to a team member", destructive: false, requiresConfirmation: true });
  }
  if (/\b(?:delete|remove|archive|suppress)\b/.test(lower)) {
    actions.push({
      type: /\b(?:delete|remove)\b/.test(lower) ? "delete_leads" : "archive_leads",
      label: /\b(?:delete|remove)\b/.test(lower) ? "Delete the matching leads (irreversible)" : "Archive the matching leads",
      destructive: true,
      requiresConfirmation: true,
    });
    notes.push("Destructive action detected — explicit confirmation required before execution.");
  }

  const needsConfirmation = actions.some((a) => a.requiresConfirmation) || actions.some((a) => a.destructive) || !context.canWrite;

  const summary = buildSummary(intent, filters, notes);

  return {
    intent,
    summary,
    filters,
    actions,
    explanation: buildExplanation(intent, filters, notes, text),
    confidence: computeConfidence(filters, intent),
    needsConfirmation,
  };
}

function buildSummary(intent: CommandInterpretation["intent"], filters: CommandInterpretation["filters"], notes: string[]): string {
  const parts: string[] = [];
  const scope = filters.industries?.length ? filters.industries.join(" / ") : "businesses";
  const where = filters.locations?.length ? ` in ${filters.locations.join(", ")}` : "";

  switch (intent) {
    case "run_discovery":
      parts.push(`Discover new ${scope}${where}${filters.maxWebsiteScore !== undefined ? ` with a website score below ${filters.maxWebsiteScore}` : ""}${filters.websiteStatus?.includes("none") ? " that have no website" : ""}.`);
      break;
    case "search_businesses":
      parts.push(`Show ${scope}${where}${filters.minReviews ? ` with at least ${filters.minReviews} reviews` : ""}.`);
      break;
    case "search_leads":
      parts.push(
        `Find leads${filters.temperatures?.length ? ` marked ${filters.temperatures.join("/")}` : ""}${
          filters.statuses?.length ? ` at stage ${filters.statuses.join(" / ")}` : ""
        }${where}${filters.minLeadScore !== undefined ? ` with a lead score of ${filters.minLeadScore}+` : ""}${filters.maxWebsiteScore !== undefined ? ` and a website score below ${filters.maxWebsiteScore}` : ""}.`,
      );
      break;
    case "analytics_query":
      parts.push("Run an analytics query across the pipeline.");
      break;
    case "pipeline_action":
      parts.push("Update matching leads in the pipeline.");
      break;
    default:
      parts.push("Answer from platform data.");
  }
  if (filters.limit) parts.push(`Limited to ${filters.limit} results.`);
  parts.push(...notes);
  return parts.join(" ");
}

function buildExplanation(
  intent: CommandInterpretation["intent"],
  filters: CommandInterpretation["filters"],
  notes: string[],
  original: string,
): string {
  const filterCount = Object.values(filters).filter((v) => v !== undefined && (!Array.isArray(v) || v.length)).length;
  if (filterCount === 0 && intent !== "analytics_query") {
    return `I could not extract a filter from "${original.slice(0, 120)}". Try naming an industry, a location, a score threshold or a stage — for example "hot construction leads in Manchester with websites below 50".`;
  }
  const lines = [
    `Interpreted as: ${intent.replace(/_/g, " ")}.`,
    `${filterCount} filter${filterCount === 1 ? "" : "s"} applied.`,
    notes.length ? `Notes: ${notes.join(" ")}` : "",
    "Filters are applied server-side, so results are always scoped to your organisation's data.",
  ];
  return lines.filter(Boolean).join(" ");
}

function computeConfidence(filters: CommandInterpretation["filters"], intent: CommandInterpretation["intent"]): number {
  if (intent === "analytics_query") return 62;
  const count = Object.values(filters).filter((v) => v !== undefined && (!Array.isArray(v) || v.length)).length;
  if (count === 0) return 22;
  return Math.min(94, 52 + count * 8);
}

/* ── Suggested prompts for the command centre UI ─────────────────────────── */

export const SUGGESTED_COMMANDS = [
  "Find 50 high-potential construction businesses in Manchester with websites below 50",
  "Show me all hot leads that haven't been contacted",
  "Generate proposals for the top 10 leads",
  "Which industry has the highest conversion rate?",
  "Show businesses with website scores below 40 and more than 50 reviews",
  "Find dental practices in London with no website",
  "Which campaign produced the most interested prospects?",
  "List leads asking about pricing in the last 14 days",
];
