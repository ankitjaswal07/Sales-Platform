import type { AuditDimension, AuditFinding, AuditMetric, FindingSeverity } from "../types";
import type { PageSignals } from "./analyzers";
import { detectHypeClaims, estimatePageWeight, type TechDetection } from "./analyzers";
import type { FetchedPage } from "./fetcher";

/**
 * Scoring model.
 *
 * Each dimension is scored independently from measured signals, then weighted
 * into an overall figure. Findings always carry an `evidence` string describing
 * exactly what was measured — the AI layer and the proposal generator read that
 * field rather than inventing claims (§52).
 */

export interface DimensionScore {
  key: AuditDimension | "trust";
  score: number;
  metrics: AuditMetric[];
  findings: AuditFinding[];
}

export interface CoreWebVitals {
  /** Present only when a PageSpeed Insights key is configured — never faked. */
  lcpMs?: number;
  cls?: number;
  inpMs?: number;
  ttfbMs?: number;
  source: "pagespeed_api" | "estimated" | "unavailable";
  estimatedLcpMs?: number;
}

export interface AuditReport {
  mode: "live" | "modelled";
  engineVersion: string;
  url: string;
  finalUrl: string;
  host: string;
  httpStatus: number;
  https: boolean;
  reachable: boolean;
  blockedByRobots: boolean;
  error?: string;
  durationMs: number;
  redirectChain: { from: string; to: string; status: number }[];
  dimensions: Record<string, DimensionScore>;
  overallScore: number;
  grade: string;
  findings: AuditFinding[];
  priorityImprovements: AuditFinding[];
  metrics: AuditMetric[];
  pages: { url: string; status: number; title: string | null; byteLength: number; ttfbMs: number }[];
  tech: TechDetection;
  pageWeight: { htmlKb: number; assetsKbEstimate: number; totalKbEstimate: number; compressed: boolean };
  coreWebVitals: CoreWebVitals;
  measuredAt: string;
}

const DIMENSION_WEIGHTS: Record<string, number> = {
  performance: 0.18,
  mobile: 0.16,
  seo: 0.17,
  ux: 0.12,
  accessibility: 0.09,
  conversion: 0.15,
  technical: 0.07,
  content: 0.03,
  trust: 0.03,
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));
const pass = (ok: boolean, points: number) => (ok ? points : 0);

function metric(
  key: string,
  label: string,
  value: number | string | null,
  status: AuditMetric["status"],
  extra: Partial<AuditMetric> = {},
): AuditMetric {
  return { key, label, value, status, ...extra };
}

let findingSeq = 0;
function finding(input: Omit<AuditFinding, "id">): AuditFinding {
  findingSeq += 1;
  return { id: `f${findingSeq.toString(36)}`, ...input };
}

function severityForRatio(failed: number, total: number): FindingSeverity {
  if (total === 0) return "low";
  const ratio = failed / total;
  if (ratio >= 0.75) return "critical";
  if (ratio >= 0.4) return "high";
  if (ratio >= 0.15) return "medium";
  return "low";
}

/* ══════════════════════════════════════════════════════════════════════════
   Performance
   ══════════════════════════════════════════════════════════════════════════ */

export function scorePerformance(
  page: FetchedPage,
  signals: PageSignals,
  vitals: CoreWebVitals,
): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  const weight = estimatePageWeight(page);
  let score = 100;

  const ttfb = page.timing.ttfbMs;
  metrics.push(metric("ttfb", "Server response (TTFB)", ttfb, ttfb < 300 ? "pass" : ttfb < 800 ? "warn" : "fail", { unit: "ms", target: "< 300ms", hint: "Measured from request start to first byte of HTML." }));
  if (ttfb > 800) {
    score -= 26;
    findings.push(
      finding({
        dimension: "performance",
        severity: ttfb > 2000 ? "critical" : "high",
        title: `Slow server response (${ttfb}ms TTFB)`,
        detail: "The server took a long time to return the first byte of HTML, so every visitor waits before anything renders.",
        evidence: `Measured time-to-first-byte of ${ttfb}ms for ${page.finalUrl}. Google treats ~800ms as the threshold where users perceive delay.`,
        recommendation: "Move to faster hosting or a CDN with edge caching, enable full-page caching, and enable gzip/brotli compression.",
        impact: "Faster first paint and measurable improvement in LCP and bounce rate.",
        effort: "medium",
      }),
    );
  } else if (ttfb > 300) {
    score -= 10;
  }

  metrics.push(metric("total_load", "Full response time", page.timing.totalMs, page.timing.totalMs < 1500 ? "pass" : page.timing.totalMs < 3500 ? "warn" : "fail", { unit: "ms" }));
  if (page.timing.totalMs > 3500) score -= 14;
  else if (page.timing.totalMs > 1500) score -= 6;

  metrics.push(metric("page_weight", "Estimated page weight", weight.totalKbEstimate, weight.totalKbEstimate < 1800 ? "pass" : weight.totalKbEstimate < 3500 ? "warn" : "fail", { unit: "KB", target: "< 1.8MB" }));
  if (weight.totalKbEstimate > 3500) {
    score -= 18;
    findings.push(
      finding({
        dimension: "performance",
        severity: "high",
        title: `Heavy page (~${(weight.totalKbEstimate / 1024).toFixed(1)}MB estimated)`,
        detail: "The page loads a large number of unoptimised assets. Heavy pages are slow on mobile connections and costly for visitors.",
        evidence: `HTML ${weight.htmlKb}KB plus an estimated ${weight.assetsKbEstimate}KB of declared images, stylesheets and scripts.`,
        recommendation: "Compress and convert images to WebP/AVIF, defer non-critical JavaScript, and remove unused CSS.",
        impact: "Typically 30–60% reduction in page weight after image optimisation alone.",
        effort: "medium",
      }),
    );
  } else if (weight.totalKbEstimate > 1800) score -= 8;

  metrics.push(metric("compression", "Text compression", weight.compressed ? "Detected" : "Not detected", weight.compressed ? "pass" : "warn", { hint: "Compared raw vs. transferred HTML size." }));
  if (!weight.compressed && page.byteLength > 20_000) {
    score -= 8;
    findings.push(
      finding({
        dimension: "performance",
        severity: "medium",
        title: "HTML does not appear to be compressed",
        detail: "Uncompressed HTML costs bandwidth on every page view and slows down mobile users.",
        evidence: `Transferred ${page.byteLength} bytes; transfer size is close to the uncompressed markup size, indicating gzip/brotli is not enabled.`,
        recommendation: "Enable gzip or brotli compression at the web server or CDN level.",
        impact: "Immediate 60–80% reduction in transferred HTML bytes.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("image_format", "Modern image formats", `${signals.imagesModernFormat}/${signals.images}`, signals.images === 0 ? "unknown" : signals.imagesModernFormat / signals.images > 0.5 ? "pass" : "fail", { hint: "Counts WebP/AVIF usage in <img> and <picture> sources." }));
  if (signals.images > 3 && signals.imagesModernFormat / signals.images < 0.25) {
    score -= 12;
    findings.push(
      finding({
        dimension: "performance",
        severity: "high",
        title: "Images served in legacy formats",
        detail: "JPEG and PNG files are significantly larger than modern formats for the same visual quality.",
        evidence: `${signals.imagesModernFormat} of ${signals.images} <img> elements reference WebP or AVIF assets.`,
        recommendation: "Convert imagery to WebP/AVIF and serve responsive sizes with srcset.",
        impact: "Large reduction in image payload, improving LCP on mobile.",
        effort: "medium",
      }),
    );
  }

  metrics.push(metric("image_dimensions", "Images with width/height", `${signals.images - signals.imagesWithoutDimensions}/${signals.images || 0}`, signals.images === 0 ? "unknown" : signals.imagesWithoutDimensions === 0 ? "pass" : "warn", { hint: "Missing dimensions cause layout shift (CLS)." }));
  if (signals.imagesWithoutDimensions > 2) {
    score -= 8;
    findings.push(
      finding({
        dimension: "performance",
        severity: "medium",
        title: "Images without explicit dimensions",
        detail: "Browsers cannot reserve space for images that have no width/height, which shifts the layout as the page loads.",
        evidence: `${signals.imagesWithoutDimensions} of ${signals.images} images declare no width/height attributes.`,
        recommendation: "Add width and height attributes (or aspect-ratio) to every image to eliminate layout shift.",
        impact: "Improves Cumulative Layout Shift, a Core Web Vital.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("render_blocking", "Render-blocking head scripts", signals.renderBlockingScripts, signals.renderBlockingScripts === 0 ? "pass" : signals.renderBlockingScripts <= 2 ? "warn" : "fail"));
  if (signals.renderBlockingScripts > 2) {
    score -= 10;
    findings.push(
      finding({
        dimension: "performance",
        severity: "medium",
        title: `${signals.renderBlockingScripts} render-blocking scripts in <head>`,
        detail: "Scripts in the head without async/defer block the browser from painting the page.",
        evidence: `Found ${signals.renderBlockingScripts} <script src> tags in <head> with neither the async nor the defer attribute.`,
        recommendation: "Add defer/async, or move non-critical scripts to the end of the body and load them on interaction.",
        impact: "Faster first meaningful paint.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("third_party", "Third-party script origins", signals.thirdPartyScripts.length, signals.thirdPartyScripts.length <= 4 ? "pass" : signals.thirdPartyScripts.length <= 9 ? "warn" : "fail"));
  if (signals.thirdPartyScripts.length > 9) {
    score -= 8;
    findings.push(
      finding({
        dimension: "performance",
        severity: "medium",
        title: "Many third-party scripts",
        detail: "Each third-party origin adds DNS, TLS and main-thread cost, and most are not needed on first view.",
        evidence: `${signals.thirdPartyScripts.length} distinct external script origins: ${signals.thirdPartyScripts.slice(0, 6).join(", ")}${signals.thirdPartyScripts.length > 6 ? "…" : ""}`,
        recommendation: "Audit tracking and widget scripts; load them after interaction or via a tag manager with lazy triggers.",
        impact: "Lower main-thread blocking, better INP.",
        effort: "medium",
      }),
    );
  }

  metrics.push(metric("preload_hints", "Resource hints (preconnect/preload)", signals.preloadHints, signals.preloadHints > 0 ? "pass" : "warn", { hint: "Hints let the browser start critical connections sooner." }));
  if (signals.preloadHints === 0) score -= 4;

  if (vitals.lcpMs && vitals.lcpMs > 2500) {
    score -= 16;
    metrics.push(metric("lcp", "Largest Contentful Paint", vitals.lcpMs, vitals.lcpMs > 4000 ? "fail" : "warn", { unit: "ms", target: "< 2.5s", hint: "Reported by PageSpeed Insights." }));
  }
  if (vitals.cls !== undefined && vitals.cls > 0.1) {
    score -= 12;
    metrics.push(metric("cls", "Cumulative Layout Shift", vitals.cls, vitals.cls > 0.25 ? "fail" : "warn", { target: "< 0.1" }));
  }

  return { key: "performance", score: clamp(score), metrics, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
   Mobile
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreMobile(signals: PageSignals): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  let score = 100;

  const hasViewport = Boolean(signals.viewport);
  metrics.push(metric("viewport", "Responsive viewport meta", hasViewport ? signals.viewport! : "Missing", hasViewport ? "pass" : "fail", { target: "width=device-width, initial-scale=1" }));
  if (!hasViewport) {
    score -= 40;
    findings.push(
      finding({
        dimension: "mobile",
        severity: "critical",
        title: "No responsive viewport meta tag",
        detail: "Without a viewport tag, mobile browsers render the desktop layout scaled down. Text becomes tiny and taps become guesswork.",
        evidence: "No <meta name=\"viewport\"> element was found in the document head.",
        recommendation: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> and rebuild the layout with fluid grids.",
        impact: "Most mobile visitors currently experience an unusable, zoomed-out page.",
        effort: "medium",
      }),
    );
  }

  if (signals.viewportUserScalableNo) {
    score -= 15;
    findings.push(
      finding({
        dimension: "mobile",
        severity: "high",
        title: "Zoom is disabled on mobile",
        detail: "Preventing pinch-zoom removes the only workaround a visitor has when text is too small.",
        evidence: `Viewport declaration includes user-scalable=no or maximum-scale=1: "${signals.viewport}".`,
        recommendation: "Remove user-scalable=no / maximum-scale restrictions.",
        impact: "Accessibility and usability on small screens.",
        effort: "low",
      }),
    );
  }

  const mobileNavPresent = signals.mobileNavSignals > 0;
  metrics.push(metric("mobile_nav", "Mobile navigation control", mobileNavPresent ? "Detected" : "Not detected", mobileNavPresent ? "pass" : "warn", { hint: "Looks for hamburger/toggler markup or aria-expanded patterns." }));
  if (!mobileNavPresent && signals.navLinks > 6) {
    score -= 18;
    findings.push(
      finding({
        dimension: "mobile",
        severity: "high",
        title: "No dedicated mobile navigation",
        detail: "A long desktop menu with no collapsible mobile control is hard to use on a phone and often overflows.",
        evidence: `Navigation contains ${signals.navLinks} links but no hamburger/toggle control or aria-expanded pattern was detected.`,
        recommendation: "Add a compact mobile menu (accessible toggle, focus management, 44px minimum tap targets).",
        impact: "Visitors can actually reach your service and contact pages on mobile.",
        effort: "medium",
      }),
    );
  }

  metrics.push(metric("fixed_width", "Fixed-width inline elements", signals.fixedWidthElements, signals.fixedWidthElements <= 2 ? "pass" : "warn", { hint: "Fixed pixel widths commonly cause horizontal scrolling on phones." }));
  if (signals.fixedWidthElements > 4) {
    score -= 10;
    findings.push(
      finding({
        dimension: "mobile",
        severity: "medium",
        title: "Fixed-width elements suggest horizontal scrolling",
        detail: "Elements with hard-coded pixel widths wider than a phone viewport force sideways scrolling.",
        evidence: `${signals.fixedWidthElements} elements declare a fixed width of 100px or more in their inline styles.`,
        recommendation: "Replace fixed widths with max-width and percentage/fluid units.",
        impact: "Removes sideways scrolling and zoomed-out layouts on phones.",
        effort: "medium",
      }),
    );
  }

  metrics.push(metric("small_fonts", "Sub-14px inline font sizes", signals.smallFontCount, signals.smallFontCount === 0 ? "pass" : "warn"));
  if (signals.smallFontCount > 6) {
    score -= 8;
    findings.push(
      finding({
        dimension: "mobile",
        severity: "low",
        title: "Very small text detected",
        detail: "Body copy below 14px is difficult to read on phones and often triggers zooming.",
        evidence: `${signals.smallFontCount} elements use an inline font-size smaller than 14px.`,
        recommendation: "Set a base body size of at least 16px with a scalable type scale.",
        impact: "Improved readability and lower bounce on mobile.",
        effort: "low",
      }),
    );
  }

  if (signals.deprecatedTags.length) {
    score -= 12;
    findings.push(
      finding({
        dimension: "mobile",
        severity: "medium",
        title: `Deprecated layout markup (${signals.deprecatedTags.join(", ")})`,
        detail: "Legacy tags such as <font> and <center> indicate a layout that predates responsive design.",
        evidence: `Found <${signals.deprecatedTags.join(">, <")}> elements in the document.`,
        recommendation: "Replace legacy markup with semantic HTML and CSS layout (flex/grid).",
        impact: "Foundation for a genuinely responsive rebuild.",
        effort: "high",
      }),
    );
  }

  if (signals.tableLayouts > 0) {
    score -= 10;
    findings.push(
      finding({
        dimension: "mobile",
        severity: "medium",
        title: "Table-based page layout",
        detail: "Tables used for layout cannot reflow on small screens and break the mobile experience.",
        evidence: `${signals.tableLayouts} data table(s) with more than 8 cells appear to be used for layout rather than tabular data.`,
        recommendation: "Rebuild the layout using CSS grid or flexbox; reserve tables for real tabular data.",
        impact: "Content reflows correctly on phones and tablets.",
        effort: "high",
      }),
    );
  }

  return { key: "mobile", score: clamp(score), metrics, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
   SEO
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreSeo(signals: PageSignals, page: FetchedPage): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  let score = 100;

  const titleOk = signals.titleLength >= 15 && signals.titleLength <= 62;
  metrics.push(metric("title", "Title tag", signals.title ?? "Missing", signals.title ? (titleOk ? "pass" : "warn") : "fail", { hint: `${signals.titleLength} characters (aim for 15–62).` }));
  if (!signals.title) {
    score -= 20;
    findings.push(
      finding({
        dimension: "seo",
        severity: "critical",
        title: "Missing page title",
        detail: "The title is the clickable headline in Google results and the label on browser tabs.",
        evidence: "No non-empty <title> element was found.",
        recommendation: "Write a unique title combining the service, city and brand (e.g. 'Emergency Plumber in Leeds | ABC Plumbing').",
        impact: "Directly affects click-through rate from search results.",
        effort: "low",
      }),
    );
  } else if (!titleOk) {
    score -= 8;
    findings.push(
      finding({
        dimension: "seo",
        severity: "medium",
        title: signals.titleLength < 15 ? "Title tag is too short" : "Title tag is too long",
        detail: "Titles that are too short waste ranking opportunity; titles that are too long are truncated in search results.",
        evidence: `Title is ${signals.titleLength} characters: "${signals.title?.slice(0, 90)}".`,
        recommendation: "Rewrite the title to 15–62 characters including the primary service and location.",
        impact: "Better search snippet presentation and click-through.",
        effort: "low",
      }),
    );
  }

  const descOk = signals.metaDescriptionLength >= 70 && signals.metaDescriptionLength <= 165;
  metrics.push(metric("meta_description", "Meta description", signals.metaDescription ? `${signals.metaDescriptionLength} chars` : "Missing", signals.metaDescription ? (descOk ? "pass" : "warn") : "fail"));
  if (!signals.metaDescription) {
    score -= 16;
    findings.push(
      finding({
        dimension: "seo",
        severity: "high",
        title: "Missing meta description",
        detail: "Without a description, Google invents the snippet shown to searchers, usually picking an unrelated fragment of copy.",
        evidence: "No <meta name=\"description\"> element was found.",
        recommendation: "Add a 70–165 character description for each page that states the service, location and a reason to click.",
        impact: "Higher click-through rate from existing rankings.",
        effort: "low",
      }),
    );
  } else if (!descOk) {
    score -= 6;
  }

  metrics.push(metric("h1", "H1 headings", signals.h1Count, signals.h1Count === 1 ? "pass" : signals.h1Count === 0 ? "fail" : "warn", { hint: "Exactly one H1 per page is the convention." }));
  if (signals.h1Count === 0) {
    score -= 14;
    findings.push(
      finding({
        dimension: "seo",
        severity: "high",
        title: "No H1 heading on the page",
        detail: "The H1 is the strongest on-page signal telling search engines what the page is about.",
        evidence: "Zero <h1> elements were found in the rendered markup.",
        recommendation: "Add a single, descriptive H1 that matches search intent for the page's main service.",
        impact: "Clarifies the page topic for both search engines and screen readers.",
        effort: "low",
      }),
    );
  } else if (signals.h1Count > 1) {
    score -= 7;
    findings.push(
      finding({
        dimension: "seo",
        severity: "medium",
        title: `${signals.h1Count} H1 headings on one page`,
        detail: "Multiple H1s dilute the topical signal and usually indicate styling-driven heading choices.",
        evidence: `H1 text found: ${signals.h1Text.map((t) => `"${t.slice(0, 50)}"`).join(" / ")}.`,
        recommendation: "Keep one H1 and demote the rest to H2/H3 in a logical order.",
        impact: "Cleaner document outline and better topical relevance.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("heading_structure", "Heading hierarchy gaps", signals.headingSkips, signals.headingSkips === 0 ? "pass" : signals.headingSkips <= 2 ? "warn" : "fail"));
  if (signals.headingSkips > 2) {
    score -= 8;
    findings.push(
      finding({
        dimension: "seo",
        severity: "medium",
        title: "Broken heading hierarchy",
        detail: "Skipping heading levels (for example H2 to H4) makes the content outline harder for crawlers and assistive tech to interpret.",
        evidence: `${signals.headingSkips} level jumps detected across ${signals.headingCount} headings.`,
        recommendation: "Use a sequential outline: one H1, then H2 for sections, H3 for sub-points.",
        impact: "Improved crawl understanding and screen-reader navigation.",
        effort: "low",
      }),
    );
  }

  const indexable = !/noindex/i.test(signals.robotsMeta ?? "");
  metrics.push(metric("indexability", "Indexable", indexable ? "Yes" : `Blocked (${signals.robotsMeta})`, indexable ? "pass" : "fail"));
  if (!indexable) {
    score -= 40;
    findings.push(
      finding({
        dimension: "seo",
        severity: "critical",
        title: "Page is blocked from search indexing",
        detail: "A noindex directive tells search engines to drop this page from results entirely.",
        evidence: `Robots meta tag: "${signals.robotsMeta}".`,
        recommendation: "Remove the noindex directive if this page should rank, or confirm it was intentional for a staging environment.",
        impact: "The page cannot rank at all while noindex is present.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("canonical", "Canonical URL", signals.canonical ?? "Missing", signals.canonical ? "pass" : "warn"));
  if (!signals.canonical) {
    score -= 5;
    findings.push(
      finding({
        dimension: "seo",
        severity: "low",
        title: "No canonical URL declared",
        detail: "Without a canonical, near-duplicate URLs (with and without tracking parameters) can compete with each other.",
        evidence: "No <link rel=\"canonical\"> element was found.",
        recommendation: "Add a self-referencing canonical to every page.",
        impact: "Prevents duplicate-content dilution.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("og_tags", "Open Graph tags", `${signals.ogTags.length}/5`, signals.ogTags.length >= 4 ? "pass" : signals.ogTags.length >= 2 ? "warn" : "fail", { hint: "Controls how the page looks when shared on social and messaging apps." }));
  if (signals.ogTags.length < 3) {
    score -= 9;
    findings.push(
      finding({
        dimension: "seo",
        severity: "medium",
        title: "Incomplete social sharing tags",
        detail: "Shared links render as a bare URL with no image or description, which suppresses click-through in WhatsApp, Facebook and LinkedIn.",
        evidence: `Only ${signals.ogTags.length} of the 5 core Open Graph tags are present (${signals.ogTags.join(", ") || "none"}).`,
        recommendation: "Add og:title, og:description, og:image (1200×630) and og:url to every page.",
        impact: "Higher engagement on shared links — important for local, referral-driven businesses.",
        effort: "low",
      }),
    );
  }

  const localBusinessSchema = signals.structuredDataTypes.some((t) => /LocalBusiness|Organization|Dentist|Restaurant|HomeAndConstructionBusiness|LegalService|MedicalBusiness|ProfessionalService|Store/i.test(t));
  metrics.push(metric("structured_data", "Structured data", signals.structuredDataBlocks === 0 ? "None" : signals.structuredDataTypes.join(", ").slice(0, 60), localBusinessSchema ? "pass" : signals.structuredDataBlocks > 0 ? "warn" : "fail"));
  if (!localBusinessSchema) {
    score -= 12;
    findings.push(
      finding({
        dimension: "seo",
        severity: "high",
        title: "No LocalBusiness structured data",
        detail: "Structured data is what powers rich results — star ratings, opening hours, price ranges and map panels in Google.",
        evidence: signals.structuredDataBlocks === 0
          ? "No JSON-LD structured data blocks were found."
          : `Structured data present but no local-business entity: ${signals.structuredDataTypes.join(", ")}.`,
        recommendation: "Add JSON-LD LocalBusiness schema with name, address, phone, opening hours, geo and aggregateRating.",
        impact: "Eligibility for rich results in local search — a large visibility gain for local businesses.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("internal_links", "Internal links", signals.internalLinks, signals.internalLinks >= 8 ? "pass" : signals.internalLinks >= 4 ? "warn" : "fail"));
  if (signals.internalLinks < 6) {
    score -= 10;
    findings.push(
      finding({
        dimension: "seo",
        severity: "medium",
        title: "Thin internal linking",
        detail: "With few internal links, search engines struggle to discover service and location pages, and visitors have nowhere to go next.",
        evidence: `Only ${signals.internalLinks} internal links found on the homepage.`,
        recommendation: "Link every service from the homepage and cross-link service pages to relevant locations and case studies.",
        impact: "Better crawl coverage and more pages viewed per session.",
        effort: "medium",
      }),
    );
  }

  metrics.push(metric("word_count", "Word count", signals.wordCount, signals.wordCount >= 350 ? "pass" : signals.wordCount >= 150 ? "warn" : "fail", { hint: "Thin pages rarely rank for competitive local terms." }));
  if (signals.wordCount < 250) {
    score -= 8;
    findings.push(
      finding({
        dimension: "seo",
        severity: "medium",
        title: "Very little content on the page",
        detail: "Thin content gives search engines little to work with and gives visitors no reason to stay.",
        evidence: `Approximately ${signals.wordCount} words of visible text were extracted from the page.`,
        recommendation: "Add service detail, areas covered, pricing guidance, FAQs and proof to reach 600+ words of genuinely useful copy.",
        impact: "More ranking surface for local and long-tail terms.",
        effort: "medium",
      }),
    );
  }

  metrics.push(metric("lang", "Language declared", signals.lang ?? "Missing", signals.lang ? "pass" : "warn"));
  if (!signals.lang) score -= 4;

  metrics.push(metric("redirects", "Redirect hops", page.redirects.length, page.redirects.length === 0 ? "pass" : page.redirects.length <= 2 ? "warn" : "fail"));
  if (page.redirects.length > 2) {
    score -= 7;
    findings.push(
      finding({
        dimension: "seo",
        severity: "medium",
        title: `${page.redirects.length} redirect hops before the page loads`,
        detail: "Chained redirects waste crawl budget and add latency for every visitor.",
        evidence: page.redirects.map((r) => `${r.status} ${r.from} → ${r.to}`).join(" | "),
        recommendation: "Point links and canonical URLs directly at the final destination.",
        impact: "Faster loads and cleaner crawl signals.",
        effort: "low",
      }),
    );
  }

  return { key: "seo", score: clamp(score), metrics, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
   UX
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreUx(signals: PageSignals): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  let score = 100;

  const navOk = signals.navLinks >= 4 && signals.navLinks <= 12;
  metrics.push(metric("nav", "Primary navigation links", signals.navLinks, signals.navLinks === 0 ? "fail" : navOk ? "pass" : "warn"));
  if (signals.navLinks === 0) {
    score -= 22;
    findings.push(
      finding({
        dimension: "ux",
        severity: "high",
        title: "No identifiable navigation",
        detail: "Visitors have no clear route to services, pricing or contact information.",
        evidence: "No <nav>, role=navigation or header list with links was detected.",
        recommendation: "Add a persistent primary navigation with Services, About, Work, Contact and a visible CTA.",
        impact: "Navigation is the single biggest predictor of task completion on a service website.",
        effort: "medium",
      }),
    );
  } else if (signals.navLinks > 14) {
    score -= 8;
    findings.push(
      finding({
        dimension: "ux",
        severity: "low",
        title: "Navigation is overloaded",
        detail: "Too many top-level links create decision paralysis.",
        evidence: `${signals.navLinks} links found in the navigation region.`,
        recommendation: "Group secondary pages under dropdowns or a footer resource column.",
        impact: "Faster orientation for first-time visitors.",
        effort: "low",
      }),
    );
  }

  const hasContactAccess = signals.contactLinks > 0;
  metrics.push(metric("contact_access", "Contact reachable from page", hasContactAccess ? "Yes" : "No", hasContactAccess ? "pass" : "fail"));
  if (!hasContactAccess) {
    score -= 20;
    findings.push(
      finding({
        dimension: "ux",
        severity: "critical",
        title: "No way to contact the business from this page",
        detail: "There is no telephone link, email link or contact page link. Enquiries that arrive by other means are lost.",
        evidence: "Zero tel:, mailto: or contact-page links were found in the document.",
        recommendation: "Add click-to-call, a contact form and a persistent header CTA.",
        impact: "Directly recovers enquiries that currently abandon.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("contact_forms", "Contact/lead forms", signals.forms, signals.forms > 0 ? "pass" : "fail"));
  if (signals.forms === 0) {
    score -= 12;
    findings.push(
      finding({
        dimension: "ux",
        severity: "high",
        title: "No enquiry form on the page",
        detail: "Visitors who are not ready to call have no low-commitment way to make contact.",
        evidence: "No <form> elements detected in the document.",
        recommendation: "Add a short enquiry form (name, contact, requirement) above the fold on key pages.",
        impact: "Captures enquiries outside business hours.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("email_capture", "Email input present", signals.emailInputs, signals.emailInputs > 0 ? "pass" : "warn"));
  if (signals.emailInputs === 0 && signals.forms > 0) score -= 5;

  metrics.push(metric("readability", "Paragraph structure", signals.paragraphCount, signals.paragraphCount >= 6 ? "pass" : "warn", { hint: "Walls of text are skipped; short paragraphs get read." }));
  if (signals.paragraphCount < 4 && signals.wordCount > 200) {
    score -= 8;
    findings.push(
      finding({
        dimension: "ux",
        severity: "medium",
        title: "Content is not broken into readable blocks",
        detail: "Long, unbroken copy is skimmed or skipped entirely.",
        evidence: `${signals.wordCount} words presented in only ${signals.paragraphCount} paragraph blocks.`,
        recommendation: "Break copy into short sections with subheadings, bullet lists and pull quotes.",
        impact: "Higher engagement and better message retention.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("visual_hierarchy", "Heading density", signals.headingCount, signals.headingCount >= 4 ? "pass" : "warn", { hint: "Subheadings act as signposts for scanners." }));
  if (signals.headingCount < 3 && signals.wordCount > 150) score -= 7;

  const ctaQuality = signals.ctaCandidates.length;
  metrics.push(metric("cta_presence", "Action-oriented calls to action", ctaQuality, ctaQuality >= 2 ? "pass" : ctaQuality === 1 ? "warn" : "fail"));
  if (ctaQuality === 0) {
    score -= 16;
    findings.push(
      finding({
        dimension: "ux",
        severity: "high",
        title: "No clear call to action",
        detail: "Nothing on the page tells the visitor what to do next.",
        evidence: "No button, submit input or link matched common action phrasing (quote, book, call, contact, enquire).",
        recommendation: "Add one primary CTA repeated at the top, mid-page and footer (e.g. 'Get a free quote').",
        impact: "The single highest-leverage conversion change on a service website.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("inline_styles", "Inline style usage", signals.inlineStyles, signals.inlineStyles < 40 ? "pass" : "warn", { hint: "Heavy inline styling usually signals an outdated, hard-to-maintain build." }));
  if (signals.inlineStyles > 120) {
    score -= 6;
    findings.push(
      finding({
        dimension: "ux",
        severity: "low",
        title: "Styling applied inline throughout the page",
        detail: "Inline styling makes the design inconsistent between pages and expensive to change.",
        evidence: `${signals.inlineStyles} elements carry inline style attributes.`,
        recommendation: "Consolidate styles into a design-token-driven stylesheet.",
        impact: "Faster future changes and a visually consistent site.",
        effort: "medium",
      }),
    );
  }

  return { key: "ux", score: clamp(score), metrics, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
   Accessibility (automated checks only — never a full audit)
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreAccessibility(signals: PageSignals): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  let score = 100;

  const altRatio = signals.images === 0 ? 1 : 1 - signals.imagesMissingAlt / signals.images;
  metrics.push(metric("alt_text", "Images with alt text", `${signals.images - signals.imagesMissingAlt}/${signals.images}`, altRatio === 1 ? "pass" : altRatio > 0.7 ? "warn" : "fail", { hint: "Automated check — meaningful alt quality still needs a human review." }));
  if (altRatio < 1) {
    score -= 16 * (1 - altRatio);
    findings.push(
      finding({
        dimension: "accessibility",
        severity: severityForRatio(signals.imagesMissingAlt, signals.images),
        title: `${signals.imagesMissingAlt} image(s) missing alt text`,
        detail: "Screen readers cannot describe these images, and search engines cannot read them either.",
        evidence: `${signals.imagesMissingAlt} of ${signals.images} <img> elements have no alt attribute.`,
        recommendation: "Add descriptive alt text to informative images and empty alt=\"\" to purely decorative ones.",
        impact: "Accessibility compliance and additional image-search relevance.",
        effort: "low",
      }),
    );
  }

  const labelRatio = signals.formFields === 0 ? 1 : signals.labelledFormFields / signals.formFields;
  metrics.push(metric("form_labels", "Form fields with labels", `${signals.labelledFormFields}/${signals.formFields}`, signals.formFields === 0 ? "unknown" : labelRatio === 1 ? "pass" : "fail", { hint: "Automated check for <label for>, wrapping labels or aria-label." }));
  if (signals.formFields > 0 && labelRatio < 1) {
    score -= 18 * (1 - labelRatio);
    findings.push(
      finding({
        dimension: "accessibility",
        severity: signals.unlabelledFormFields > 2 ? "high" : "medium",
        title: `${signals.unlabelledFormFields} form field(s) without an accessible label`,
        detail: "Fields identified only by placeholder text are invisible to screen readers and disappear once typing starts.",
        evidence: `${signals.unlabelledFormFields} of ${signals.formFields} inputs have no <label for>, wrapping label or aria-label (${signals.placeholderAsLabel} rely on placeholders).`,
        recommendation: "Give every field a programmatically associated label; keep placeholders for examples only.",
        impact: "Form completion for screen-reader and voice-control users.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("landmarks", "Landmarks / semantic regions", signals.ariaLandmarks, signals.ariaLandmarks >= 3 ? "pass" : signals.ariaLandmarks >= 1 ? "warn" : "fail"));
  if (signals.ariaLandmarks < 3) {
    score -= 12;
    findings.push(
      finding({
        dimension: "accessibility",
        severity: "medium",
        title: "Few semantic landmarks",
        detail: "Without main/nav/header/footer landmarks, assistive-technology users cannot jump between regions.",
        evidence: `${signals.ariaLandmarks} landmark regions detected.`,
        recommendation: "Use <main>, <nav>, <header>, <footer> and appropriate ARIA roles for each region.",
        impact: "Faster keyboard and screen-reader navigation.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("skip_link", "Skip-to-content link", signals.skipLinks > 0 ? "Present" : "Missing", signals.skipLinks > 0 ? "pass" : "warn"));
  if (signals.skipLinks === 0) score -= 6;

  metrics.push(metric("aria_labels", "ARIA labelling", signals.ariaLabels, signals.ariaLabels > 0 ? "pass" : "warn"));
  if (signals.ariaLabels === 0) score -= 5;

  metrics.push(metric("tabindex", "Positive tabindex values", signals.tabindexPositive, signals.tabindexPositive === 0 ? "pass" : "fail", { hint: "Positive tabindex breaks the natural focus order." }));
  if (signals.tabindexPositive > 0) {
    score -= 8;
    findings.push(
      finding({
        dimension: "accessibility",
        severity: "medium",
        title: "Positive tabindex values disrupt focus order",
        detail: "Keyboard focus jumps around the page in an unexpected order.",
        evidence: `${signals.tabindexPositive} elements declare a positive tabindex.`,
        recommendation: "Remove positive tabindex values; use natural DOM order.",
        impact: "Predictable keyboard navigation.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("lang_attr", "Document language", signals.lang ?? "Missing", signals.lang ? "pass" : "fail"));
  if (!signals.lang) {
    score -= 8;
    findings.push(
      finding({
        dimension: "accessibility",
        severity: "medium",
        title: "Document language not declared",
        detail: "Screen readers may pronounce the content using the wrong language rules.",
        evidence: "The <html> element has no lang attribute.",
        recommendation: "Add lang=\"en-GB\" (or the correct locale) to <html>.",
        impact: "Correct pronunciation by assistive technology.",
        effort: "low",
      }),
    );
  }

  if (signals.targetBlankNoRel > 0) {
    score -= 5;
    findings.push(
      finding({
        dimension: "accessibility",
        severity: "low",
        title: `${signals.targetBlankNoRel} new-tab link(s) without rel="noopener"`,
        detail: "Opening links in a new tab without noopener is a security and orientation risk, and can disorient keyboard users.",
        evidence: `${signals.targetBlankNoRel} anchors use target=\"_blank\" without rel=\"noopener\" or \"noreferrer\".`,
        recommendation: "Add rel=\"noopener noreferrer\" and indicate that the link opens in a new tab.",
        impact: "Security hardening and predictable navigation.",
        effort: "low",
      }),
    );
  }

  if (signals.contrastRiskCount > 8) {
    score -= 6;
    findings.push(
      finding({
        dimension: "accessibility",
        severity: "low",
        title: "Possible colour-contrast risk (heuristic)",
        detail: "Light-on-light colour pairs were detected in inline styles. This heuristic cannot prove a failure.",
        evidence: `${signals.contrastRiskCount} inline colour declarations use very light values.`,
        recommendation: "Run a full contrast audit against the live pages and adjust brand colours to meet WCAG AA (4.5:1 body text).",
        impact: "Readability in bright conditions and for low-vision users.",
        effort: "medium",
      }),
    );
  }

  return { key: "accessibility", score: clamp(score), metrics, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
   Conversion
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreConversion(signals: PageSignals): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  let score = 100;

  const hasPrimaryCta = signals.ctaCandidates.some((c) => c.score >= 3);
  metrics.push(metric("primary_cta", "Primary CTA above/near the fold", hasPrimaryCta ? "Yes" : "No", hasPrimaryCta ? "pass" : "fail"));
  if (!hasPrimaryCta) {
    score -= 26;
    findings.push(
      finding({
        dimension: "conversion",
        severity: "critical",
        title: "No strong primary call to action",
        detail: "The page does not ask the visitor to take a commercial action in explicit terms.",
        evidence: signals.ctaCandidates.length === 0
          ? "No button or link matched action phrasing such as 'get a quote', 'book', 'call now', 'enquire'."
          : `Closest matches were low-confidence: ${signals.ctaCandidates.slice(0, 3).map((c) => `"${c.text}"`).join(", ")}.`,
        recommendation: "Add one visually dominant CTA with an outcome-led label ('Get a free quote in 24 hours') repeated at the top, mid-page and footer.",
        impact: "Recovers the largest volume of currently-lost enquiries.",
        effort: "low",
      }),
    );
  }

  const clickToCall = signals.phoneLinks > 0;
  metrics.push(metric("click_to_call", "Click-to-call link", clickToCall ? `${signals.phoneLinks} link(s)` : "Missing", clickToCall ? "pass" : "fail"));
  if (!clickToCall) {
    score -= 14;
    findings.push(
      finding({
        dimension: "conversion",
        severity: "high",
        title: "Phone number is not clickable",
        detail: "Mobile visitors have to memorise or copy the number instead of tapping once. A measurable share abandon at this point.",
        evidence: "No href=\"tel:\" links were found.",
        recommendation: "Wrap every phone number in a tel: link, including the header and footer.",
        impact: "Highest-intent mobile visitors convert with one tap.",
        effort: "low",
      }),
    );
  }

  const booking = signals.bookingLinks > 0;
  metrics.push(metric("booking", "Booking / appointment flow", booking ? signals.bookingProviders.join(", ") || "On-site booking link" : "Missing", booking ? "pass" : "warn"));
  if (!booking) {
    score -= 12;
    findings.push(
      finding({
        dimension: "conversion",
        severity: "high",
        title: "No online booking or appointment path",
        detail: "Visitors who want to commit outside opening hours have no way to request a slot.",
        evidence: "No booking provider link or appointment-oriented link text was detected.",
        recommendation: "Add online scheduling (booking widget or a short appointment form) with confirmation email.",
        impact: "Captures bookings 24/7 instead of only during opening hours.",
        effort: "medium",
      }),
    );
  }

  const whatsapp = signals.whatsappLinks > 0;
  metrics.push(metric("whatsapp", "WhatsApp / messaging link", whatsapp ? "Present" : "Missing", whatsapp ? "pass" : "warn"));
  if (!whatsapp) score -= 6;

  const trustTotal = signals.testimonialSignals + signals.reviewSignals + signals.trustBadges;
  metrics.push(metric("trust_signals", "Trust signals", trustTotal, trustTotal >= 4 ? "pass" : trustTotal >= 1 ? "warn" : "fail", { hint: "Testimonials, reviews, accreditations and guarantees." }));
  if (trustTotal < 2) {
    score -= 14;
    findings.push(
      finding({
        dimension: "conversion",
        severity: "high",
        title: "Very few trust signals",
        detail: "Prospects comparing several providers choose the one that looks verifiably credible.",
        evidence: `${signals.testimonialSignals} testimonial reference(s), ${signals.reviewSignals} review reference(s) and ${signals.trustBadges} badge/guarantee element(s) detected.`,
        recommendation: "Add named testimonials with photos, your Google rating, accreditations and a clear guarantee statement.",
        impact: "Higher conversion from existing traffic, no additional ad spend required.",
        effort: "low",
      }),
    );
  }

  const hasForm = signals.forms > 0;
  metrics.push(metric("lead_capture", "Lead capture form", hasForm ? `${signals.forms} form(s), ${signals.formFields} field(s)` : "None", hasForm ? (signals.formFields <= 6 ? "pass" : "warn") : "fail", { hint: "Long forms reduce completion." }));
  if (hasForm && signals.formFields > 7) {
    score -= 10;
    findings.push(
      finding({
        dimension: "conversion",
        severity: "medium",
        title: "Enquiry form asks for too much",
        detail: "Each additional field reduces completion. Long forms also discourage mobile users.",
        evidence: `The form exposes ${signals.formFields} visible input fields.`,
        recommendation: "Reduce to name, one contact method and a brief requirement; qualify on the call instead.",
        impact: "Typically a step change in form completion rate.",
        effort: "low",
      }),
    );
  }

  const hasEmailCapture = signals.emailInputs > 0;
  metrics.push(metric("email_capture", "Email capture", hasEmailCapture ? "Present" : "Missing", hasEmailCapture ? "pass" : "warn"));
  if (!hasEmailCapture) score -= 6;

  const hasMap = signals.mapEmbeds > 0;
  const hasAddress = signals.addressSignals > 0 || signals.hoursSignals > 0;
  metrics.push(metric("location_info", "Address / opening hours", hasAddress ? "Present" : "Missing", hasAddress ? "pass" : "warn"));
  if (!hasAddress) {
    score -= 7;
    findings.push(
      finding({
        dimension: "conversion",
        severity: "medium",
        title: "Opening hours and address are not stated",
        detail: "Local visitors want to confirm you serve their area and when you are open before they make contact.",
        evidence: `Address-like markup: ${signals.addressSignals} element(s); opening-hours patterns: ${signals.hoursSignals}.`,
        recommendation: "Show the full address, opening hours, a map embed and the areas covered on every key page.",
        impact: "Removes a common pre-contact doubt for local buyers.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("price_guidance", "Pricing guidance", signals.priceSignals > 0 ? "Present" : "Missing", signals.priceSignals > 0 ? "pass" : "warn", { hint: "Even 'from £X' reduces unqualified enquiries." }));
  if (signals.priceSignals === 0) score -= 5;

  metrics.push(metric("faq", "FAQ content", signals.faqSignals > 0 ? "Present" : "Missing", signals.faqSignals > 0 ? "pass" : "warn"));
  if (signals.faqSignals === 0) score -= 5;

  return { key: "conversion", score: clamp(score), metrics, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
   Technical
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreTechnical(page: FetchedPage, signals: PageSignals): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  let score = 100;

  const https = page.finalUrl.startsWith("https://");
  metrics.push(metric("https", "HTTPS", https ? "Enabled" : "Not enabled", https ? "pass" : "fail"));
  if (!https) {
    score -= 35;
    findings.push(
      finding({
        dimension: "technical",
        severity: "critical",
        title: "Site is not served over HTTPS",
        detail: "Browsers label unencrypted sites 'Not secure', and visitors must click through a warning to reach you.",
        evidence: `Final URL is ${page.finalUrl} — the scheme is not https.`,
        recommendation: "Install a TLS certificate (free via Let's Encrypt) and redirect all HTTP traffic to HTTPS.",
        impact: "Removes browser warnings and protects form submissions in transit.",
        effort: "low",
      }),
    );
  }

  const statusOk = page.status >= 200 && page.status < 300;
  metrics.push(metric("http_status", "HTTP status", page.status || "No response", statusOk ? "pass" : "fail"));
  if (!statusOk) {
    score -= 40;
    findings.push(
      finding({
        dimension: "technical",
        severity: "critical",
        title: `Page returned HTTP ${page.status}${page.error ? ` (${page.error})` : ""}`,
        detail: "The page does not load successfully, so no visitor can see it and no crawler can index it.",
        evidence: `Request to ${page.requestedUrl} returned status ${page.status || "none"}${page.error ? ` with error "${page.error}"` : ""}.`,
        recommendation: "Restore the page or redirect it to a valid destination; add monitoring for uptime.",
        impact: "Any traffic to this page is currently lost entirely.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("redirects", "Redirect chain length", page.redirects.length, page.redirects.length === 0 ? "pass" : page.redirects.length <= 1 ? "warn" : "fail"));
  if (page.redirects.length > 1) score -= 6;

  const securityHeaders = ["strict-transport-security", "content-security-policy", "x-content-type-options", "referrer-policy", "x-frame-options"];
  const present = securityHeaders.filter((h) => Boolean(page.headers[h]));
  metrics.push(metric("security_headers", "Security headers present", `${present.length}/${securityHeaders.length}`, present.length >= 3 ? "pass" : present.length >= 1 ? "warn" : "fail", { hint: "Basic response-header check only — not a penetration test or full security audit." }));
  if (present.length === 0) {
    score -= 14;
    findings.push(
      finding({
        dimension: "security",
        severity: "medium",
        title: "No standard security headers configured",
        detail: "Missing response headers leave the site more exposed to clickjacking and MIME-sniffing, and increase spam form submissions.",
        evidence: `None of ${securityHeaders.join(", ")} were present in the response headers.`,
        recommendation: "Add HSTS, a Content-Security-Policy, X-Content-Type-Options and Referrer-Policy at the server or CDN.",
        impact: "Baseline hardening and better email deliverability for the sending domain.",
        effort: "medium",
      }),
    );
  }

  if (signals.brokenLookingLinks > 0) {
    score -= Math.min(18, signals.brokenLookingLinks * 4);
    findings.push(
      finding({
        dimension: "technical",
        severity: severityForRatio(signals.brokenLookingLinks, Math.max(1, signals.internalLinks + signals.brokenLookingLinks)),
        title: `${signals.brokenLookingLinks} placeholder or malformed link(s)`,
        detail: "Links pointing at '#' or an empty target do nothing when clicked, which reads as a broken site.",
        evidence: `${signals.brokenLookingLinks} anchors use href=\"#\", an empty href or a javascript:void target.`,
        recommendation: "Point every link at a real destination, or render non-interactive elements as text.",
        impact: "Removes dead ends in the visitor journey.",
        effort: "low",
      }),
    );
  }

  if (signals.anchorTextEmpty > 0) {
    score -= Math.min(10, signals.anchorTextEmpty * 2);
    findings.push(
      finding({
        dimension: "technical",
        severity: "low",
        title: `${signals.anchorTextEmpty} link(s) with no discernible text`,
        detail: "Links with no text cannot be understood by search engines or by screen readers.",
        evidence: `${signals.anchorTextEmpty} anchors contain neither text, an aria-label nor an image with alt text.`,
        recommendation: "Give every link descriptive text or an aria-label.",
        impact: "Better SEO and accessibility.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("iframes", "IFrames / embeds", signals.iframes, signals.iframes <= 3 ? "pass" : "warn"));
  if (signals.iframes > 5) score -= 5;

  metrics.push(metric("analytics", "Analytics detected", signals.hasAnalytics ? signals.analyticsVendors.join(", ") : "None", signals.hasAnalytics ? "pass" : "warn"));
  if (!signals.hasAnalytics) {
    score -= 10;
    findings.push(
      finding({
        dimension: "technical",
        severity: "medium",
        title: "No analytics detected",
        detail: "Without measurement, there is no evidence base for improving the site — and no way to prove the value of a redesign.",
        evidence: "No recognised analytics or tag-manager signature was found in the markup.",
        recommendation: "Install privacy-friendly analytics plus conversion tracking on form submissions and calls.",
        impact: "Visibility of traffic sources and conversion rate.",
        effort: "low",
      }),
    );
  }

  if (signals.hasCookieBanner === false && signals.hasAnalytics) {
    score -= 5;
    findings.push(
      finding({
        dimension: "technical",
        severity: "low",
        title: "Analytics loaded without an obvious consent banner",
        detail: "Loading non-essential analytics before consent conflicts with UK/EU cookie rules.",
        evidence: "Tracking signatures were found but no consent-banner markup was detected.",
        recommendation: "Add a compliant consent mechanism that gates non-essential scripts until opt-in.",
        impact: "Reduces regulatory risk for the business.",
        effort: "low",
      }),
    );
  }

  return { key: "technical", score: clamp(score), metrics, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
   Content & trust
   ══════════════════════════════════════════════════════════════════════════ */

export function scoreContent(signals: PageSignals, tech: TechDetection): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  let score = 100;

  metrics.push(metric("depth", "Content depth", `${signals.wordCount} words`, signals.wordCount >= 600 ? "pass" : signals.wordCount >= 300 ? "warn" : "fail"));
  if (signals.wordCount < 300) score -= 30;
  else if (signals.wordCount < 600) score -= 12;
  else if (signals.wordCount > 3000) score -= 8;

  metrics.push(metric("last_updated", "Copyright year", signals.copyrightYear ?? "Not stated", signals.copyrightYear === null ? "warn" : signals.copyrightYear >= new Date().getFullYear() - 1 ? "pass" : "fail", { hint: "An old copyright year is the clearest public signal of an abandoned site." }));
  if (signals.copyrightYear && signals.copyrightYear <= new Date().getFullYear() - 3) {
    score -= 18;
    findings.push(
      finding({
        dimension: "content",
        severity: "high",
        title: `Copyright notice still reads ${signals.copyrightYear}`,
        detail: "Visitors read an out-of-date copyright line as evidence the business may no longer be trading.",
        evidence: `The page's copyright notice states ${signals.copyrightYear} (${new Date().getFullYear() - signals.copyrightYear} years old).`,
        recommendation: "Refresh the footer with the current year and, more importantly, update the underlying content.",
        impact: "Immediate credibility improvement and a strong, verifiable talking point for outreach.",
        effort: "low",
      }),
    );
  }

  metrics.push(metric("faq_content", "FAQ content", signals.faqSignals > 0 ? "Present" : "Missing", signals.faqSignals > 0 ? "pass" : "warn"));
  if (signals.faqSignals === 0) score -= 10;

  metrics.push(metric("reviews_mentioned", "Reviews referenced", signals.reviewSignals > 0 ? "Yes" : "No", signals.reviewSignals > 0 ? "pass" : "warn"));
  if (signals.reviewSignals === 0) score -= 8;

  const hype = detectHypeClaims(signals.h1Text.join(" "));
  if (hype.length) {
    score -= 8;
    findings.push(
      finding({
        dimension: "content",
        severity: "low",
        title: "Unverifiable superlative claims in headlines",
        detail: "Absolute claims without proof reduce trust with informed buyers and can create advertising-compliance risk.",
        evidence: `Headline text contains: ${hype.map((h) => `"${h}"`).join(", ")}.`,
        recommendation: "Replace superlatives with specific, provable statements (years trading, job count, rating, guarantee).",
        impact: "Higher credibility with comparison-shopping buyers.",
        effort: "low",
      }),
    );
  }

  if (tech.themeHints.length) {
    metrics.push(metric("theme", "Platform detail", tech.themeHints.join(" · ").slice(0, 80), "unknown"));
  }

  return { key: "content", score: clamp(score), metrics, findings };
}

export function scoreTrust(signals: PageSignals): DimensionScore {
  const findings: AuditFinding[] = [];
  const metrics: AuditMetric[] = [];
  let score = 100;

  metrics.push(metric("social_presence", "Social profiles linked", signals.socialLinks.length, signals.socialLinks.length >= 2 ? "pass" : signals.socialLinks.length === 1 ? "warn" : "fail"));
  if (signals.socialLinks.length === 0) score -= 22;

  metrics.push(metric("address", "Physical address shown", signals.addressSignals > 0 ? "Yes" : "No", signals.addressSignals > 0 ? "pass" : "fail"));
  if (signals.addressSignals === 0) score -= 20;

  metrics.push(metric("hours", "Opening hours shown", signals.hoursSignals > 0 ? "Yes" : "No", signals.hoursSignals > 0 ? "pass" : "warn"));
  if (signals.hoursSignals === 0) score -= 12;

  metrics.push(metric("human_contact", "Direct phone/email contact", signals.phoneLinks + signals.mailtoLinks > 0 ? "Yes" : "No", signals.phoneLinks + signals.mailtoLinks > 0 ? "pass" : "fail"));
  if (signals.phoneLinks + signals.mailtoLinks === 0) score -= 24;

  metrics.push(metric("testimonials", "Testimonials / case studies", signals.testimonialSignals > 0 ? "Yes" : "No", signals.testimonialSignals > 0 ? "pass" : "warn"));
  if (signals.testimonialSignals === 0) score -= 14;

  if (signals.trustBadges === 0) {
    score -= 10;
    findings.push(
      finding({
        dimension: "trust",
        severity: "medium",
        title: "No accreditation or guarantee visible",
        detail: "Trust badges, memberships and guarantees are what differentiate a credible local business from an unvetted one.",
        evidence: "No badge, certification, insurance, accreditation or guarantee elements were detected.",
        recommendation: "Display trade memberships, insurance, certifications and a written guarantee near the primary CTA.",
        impact: "Better conversion among cautious, price-comparing buyers.",
        effort: "low",
      }),
    );
  }

  return { key: "trust", score: clamp(score), metrics, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
   Aggregate
   ══════════════════════════════════════════════════════════════════════════ */

export function gradeFor(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  if (score >= 35) return "E";
  return "F";
}

export function buildReport(input: {
  page: FetchedPage;
  signals: PageSignals;
  tech: TechDetection;
  vitals: CoreWebVitals;
  durationMs: number;
  pages: AuditReport["pages"];
  mode?: "live" | "modelled";
  engineVersion?: string;
}): AuditReport {
  const { page, signals, tech, vitals, durationMs, pages } = input;

  const dimensions: Record<string, DimensionScore> = {
    performance: scorePerformance(page, signals, vitals),
    mobile: scoreMobile(signals),
    seo: scoreSeo(signals, page),
    ux: scoreUx(signals),
    accessibility: scoreAccessibility(signals),
    conversion: scoreConversion(signals),
    technical: scoreTechnical(page, signals),
    content: scoreContent(signals, tech),
    trust: scoreTrust(signals),
  };

  // A site that does not load at all cannot score well in any dimension.
  if (!page.ok) {
    Object.values(dimensions).forEach((dimension) => {
      dimension.score = Math.min(dimension.score, 20);
    });
  }

  let weighted = 0;
  let weightSum = 0;
  Object.entries(dimensions).forEach(([key, value]) => {
    const weight = DIMENSION_WEIGHTS[key] ?? 0.05;
    weighted += value.score * weight;
    weightSum += weight;
  });
  const overallScore = clamp(weighted / Math.max(weightSum, 0.0001));

  const findings = Object.values(dimensions).flatMap((d) => d.findings);
  const severityRank: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, positive: 4 };
  const priorityImprovements = [...findings]
    .filter((f) => f.severity !== "positive")
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, 8);

  const metrics = Object.values(dimensions).flatMap((d) => d.metrics);

  return {
    mode: input.mode ?? "live",
    engineVersion: input.engineVersion ?? "1.0.0",
    url: page.requestedUrl,
    finalUrl: page.finalUrl,
    host: (() => {
      try {
        return new URL(page.finalUrl).host;
      } catch {
        return page.requestedUrl;
      }
    })(),
    httpStatus: page.status,
    https: page.finalUrl.startsWith("https://"),
    reachable: page.ok,
    blockedByRobots: Boolean(page.blockedByRobots),
    error: page.error,
    durationMs,
    redirectChain: page.redirects,
    dimensions,
    overallScore,
    grade: gradeFor(overallScore),
    findings,
    priorityImprovements,
    metrics,
    pages,
    tech,
    pageWeight: estimatePageWeight(page),
    coreWebVitals: vitals,
    measuredAt: new Date().toISOString(),
  };
}
