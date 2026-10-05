import "server-only";

import * as cheerio from "cheerio";
import { analyzeHtml, detectTech, type PageSignals } from "./analyzers";
import { fetchPage, hostOf, normalizeUrl, sameHost, type FetchedPage } from "./fetcher";
import { buildReport, gradeFor, type AuditReport, type CoreWebVitals } from "./scoring";
import { logger } from "../logger";

/**
 * Audit engine entry point.
 *
 * `runAudit` produces a fully measured report. It never fabricates a score:
 * when PageSpeed Insights is not configured, `coreWebVitals.source` is
 * `"unavailable"` and only locally-measured timings are reported.
 */

export const ENGINE_VERSION = "1.0.0";

export interface AuditOptions {
  /** Number of additional in-site pages to sample. 0 = homepage only. */
  maxPages?: number;
  /** Skip PageSpeed even when a key exists (faster bulk discovery passes). */
  skipPageSpeed?: boolean;
  /** Caller-supplied progress callback for the job runner (§45). */
  onProgress?: (percent: number, stage: string) => void;
}

export interface AuditOutcome {
  report: AuditReport;
  /** Flat numbers used for lead/opportunity scoring. */
  scores: {
    overall: number;
    performance: number;
    mobile: number;
    seo: number;
    ux: number;
    accessibility: number;
    conversion: number;
    technical: number;
    content: number;
    trust: number;
  };
  cms: string | null;
  techStack: string[];
}

/** Result for a business that has no website at all — deliberately not a "fake" audit. */
export interface NoWebsiteOutcome {
  hasWebsite: false;
  reason: string;
  /** What we can honestly say: every dimension is an unmeasured blank. */
  scores: null;
}

export async function runAudit(rawUrl: string, options: AuditOptions = {}): Promise<AuditOutcome> {
  const started = Date.now();
  const maxPages = Math.min(options.maxPages ?? Number(process.env.AUDIT_MAX_PAGES ?? 12), 25);
  options.onProgress?.(5, "Fetching homepage");

  const page = await fetchPage(rawUrl);
  options.onProgress?.(25, "Analysing markup");

  const signals = analyzeHtml(page);
  const tech = detectTech(page.html, page.headers);

  options.onProgress?.(45, "Measuring assets");
  const pages: AuditReport["pages"] = [
    { url: page.finalUrl, status: page.status, title: signals.title, byteLength: page.byteLength, ttfbMs: page.timing.ttfbMs },
  ];

  // Sample a few internal pages so the report reflects the site, not just "/".
  if (maxPages > 1 && page.ok) {
    const extra = await sampleInternalPages(page, signals, maxPages - 1, options);
    pages.push(...extra);
  }

  options.onProgress?.(70, "Checking Core Web Vitals");
  const vitals = options.skipPageSpeed ? unavailableVitals() : await fetchCoreWebVitals(page.finalUrl, page.timing.ttfbMs);

  options.onProgress?.(85, "Scoring");
  const report = buildReport({
    page,
    signals,
    tech,
    vitals,
    durationMs: Date.now() - started,
    pages,
    mode: "live",
    engineVersion: ENGINE_VERSION,
  });

  options.onProgress?.(100, "Complete");

  const dimensionScore = (key: string) => report.dimensions[key]?.score ?? 0;

  return {
    report,
    scores: {
      overall: report.overallScore,
      performance: dimensionScore("performance"),
      mobile: dimensionScore("mobile"),
      seo: dimensionScore("seo"),
      ux: dimensionScore("ux"),
      accessibility: dimensionScore("accessibility"),
      conversion: dimensionScore("conversion"),
      technical: dimensionScore("technical"),
      content: dimensionScore("content"),
      trust: dimensionScore("trust"),
    },
    cms: tech.cms,
    techStack: tech.stack,
  };
}

function unavailableVitals(ttfbMs?: number): CoreWebVitals {
  return { source: "unavailable", ttfbMs };
}

async function sampleInternalPages(
  homepage: FetchedPage,
  signals: PageSignals,
  budget: number,
  options: AuditOptions,
): Promise<AuditReport["pages"]> {
  // Priority order mirrors what a sales prospect actually cares about:
  // contact and service pages reveal whether the site converts.
  const $ = cheerio.load(homepage.html || "");
  const candidates: { url: string; priority: number }[] = [];
  const seen = new Set<string>([normalizeUrl(homepage.finalUrl)]);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    let absolute: string;
    try {
      absolute = new URL(href, homepage.finalUrl).toString();
    } catch {
      return;
    }
    if (!sameHost(absolute, homepage.finalUrl)) return;
    if (/\.(pdf|jpg|jpeg|png|gif|zip|docx?|xlsx?|mp4)$/i.test(absolute)) return;
    const normalized = normalizeUrl(absolute);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    const text = $(el).text().trim().toLowerCase() + " " + normalized.toLowerCase();
    let priority = 5;
    if (/contact|enquir|get-?in-?touch|quote|book|appointment/.test(text)) priority = 1;
    else if (/service|treatment|product|what-we-do|pricing|price/.test(text)) priority = 2;
    else if (/about|team|who-we-are/.test(text)) priority = 3;
    else if (/work|portfolio|project|case-stud|gallery|testimonial|review/.test(text)) priority = 4;
    else if (/blog|news|article/.test(text)) priority = 8;
    candidates.push({ url: normalized, priority });
  });

  candidates.sort((a, b) => a.priority - b.priority);
  const targets = candidates.slice(0, budget);
  const results: AuditReport["pages"] = [];
  let done = 0;

  for (const target of targets) {
    const result = await fetchPage(target.url, { timeoutMs: 9000 });
    results.push({
      url: result.finalUrl,
      status: result.status,
      title: cheerio.load(result.html || "")("title").first().text().trim() || null,
      byteLength: result.byteLength,
      ttfbMs: result.timing.ttfbMs,
    });
    done += 1;
    options.onProgress?.(45 + Math.round((done / Math.max(1, targets.length)) * 20), `Sampled ${done}/${targets.length} pages`);
  }

  // Broken links found by sampling become real, verifiable findings.
  const broken = results.filter((r) => r.status >= 400 || r.status === 0);
  if (broken.length) {
    signals.brokenLookingLinks += broken.length;
  }
  return results;
}

/**
 * Core Web Vitals via PageSpeed Insights when a key is configured.
 * Returns `source: "unavailable"` when not configured — we never estimate a
 * number and present it as a measurement.
 */
async function fetchCoreWebVitals(url: string, measuredTtfb: number): Promise<CoreWebVitals> {
  const base: CoreWebVitals = { source: "unavailable", ttfbMs: measuredTtfb };
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) return base;

  try {
    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("key", key);
    endpoint.searchParams.set("strategy", "mobile");
    endpoint.searchParams.append("category", "performance");
    const response = await fetch(endpoint.toString(), { signal: AbortSignal.timeout(25000), cache: "no-store" });
    if (!response.ok) return base;
    const payload = (await response.json()) as {
      lighthouseResult?: {
        audits?: Record<string, { numericValue?: number }>;
      };
    };
    const audits = payload.lighthouseResult?.audits ?? {};
    return {
      source: "pagespeed_api",
      ttfbMs: audits["server-response-time"]?.numericValue ?? measuredTtfb,
      lcpMs: audits["largest-contentful-paint"]?.numericValue,
      cls: audits["cumulative-layout-shift"]?.numericValue,
      inpMs: audits["total-blocking-time"]?.numericValue,
    };
  } catch (error) {
    logger.warn("audit", "PageSpeed Insights lookup failed; continuing with local measurements", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return base;
  }
}

/* ── Quick scan used by discovery so we can rank before full audits ─────── */

export interface QuickScan {
  url: string;
  reachable: boolean;
  status: number;
  https: boolean;
  ttfbMs: number;
  byteLength: number;
  hasViewport: boolean;
  hasTitle: boolean;
  hasMetaDescription: boolean;
  h1Count: number;
  hasForm: boolean;
  hasTelLink: boolean;
  imagesMissingAlt: number;
  renderBlockingScripts: number;
  copyrightYear: number | null;
  cms: string | null;
  techStack: string[];
  /** Cheap 0–100 heuristic used purely for ordering in the discovery table. */
  heuristicScore: number;
  checkedAt: string;
}

/**
 * Fast pre-audit used during discovery, so we can rank 200 businesses on a
 * budget without running 200 full audits. The heuristic is deliberately coarse
 * and is always labelled as an estimate in the UI until a full audit runs.
 */
export async function quickScan(url: string): Promise<QuickScan> {
  const page = await fetchPage(url, { timeoutMs: 8000 });
  const signals = analyzeHtml(page);
  const tech = detectTech(page.html, page.headers);
  let score = 100;

  if (!page.ok) score -= 55;
  if (!page.finalUrl.startsWith("https://")) score -= 15;
  if (page.timing.ttfbMs > 1200) score -= 12;
  else if (page.timing.ttfbMs > 600) score -= 6;
  if (page.timing.totalMs > 4000) score -= 10;
  if (!signals.viewport) score -= 18;
  if (!signals.title) score -= 6;
  if (!signals.metaDescription) score -= 6;
  if (signals.h1Count !== 1) score -= 5;
  if (signals.forms === 0) score -= 8;
  if (signals.phoneLinks === 0) score -= 6;
  if (signals.images > 0 && signals.imagesMissingAlt / signals.images > 0.4) score -= 6;
  if (signals.renderBlockingScripts > 2) score -= 5;
  if (signals.copyrightYear && signals.copyrightYear <= new Date().getFullYear() - 3) score -= 10;
  if (signals.ctaCandidates.filter((c) => c.score >= 3).length === 0) score -= 10;
  if (signals.deprecatedTags.length || signals.tableLayouts > 0) score -= 8;

  return {
    url: page.finalUrl,
    reachable: page.ok,
    status: page.status,
    https: page.finalUrl.startsWith("https://"),
    ttfbMs: page.timing.ttfbMs,
    byteLength: page.byteLength,
    hasViewport: Boolean(signals.viewport),
    hasTitle: Boolean(signals.title),
    hasMetaDescription: Boolean(signals.metaDescription),
    h1Count: signals.h1Count,
    hasForm: signals.forms > 0,
    hasTelLink: signals.phoneLinks > 0,
    imagesMissingAlt: signals.imagesMissingAlt,
    renderBlockingScripts: signals.renderBlockingScripts,
    copyrightYear: signals.copyrightYear,
    cms: tech.cms,
    techStack: tech.stack,
    heuristicScore: Math.max(0, Math.min(100, Math.round(score))),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Live scoring for a site that is unreachable or refuses crawlers. We record
 * *why* there is no report instead of inventing one.
 */
export function unreachableReport(url: string, error: string): AuditReport {
  const page: FetchedPage = {
    requestedUrl: url,
    finalUrl: url,
    status: 0,
    ok: false,
    headers: {},
    html: "",
    byteLength: 0,
    contentType: "",
    redirects: [],
    timing: { ttfbMs: 0, totalMs: 0 },
    error,
  };
  const signals = analyzeHtml(page);
  const tech = detectTech("", {});
  return buildReport({
    page,
    signals,
    tech,
    vitals: unavailableVitals(),
    durationMs: 0,
    pages: [],
    mode: "live",
    engineVersion: ENGINE_VERSION,
  });
}

export { hostOf, normalizeUrl, gradeFor };
export type { AuditReport, CoreWebVitals };
