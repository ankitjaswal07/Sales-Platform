import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { FetchedPage } from "./fetcher";

/**
 * DOM + response analysis.
 *
 * Everything here is a *measurement*, not an opinion. Scorers in `scoring.ts`
 * turn measurements into dimension scores and findings, and the AI layer is
 * only allowed to reference findings that exist in the audit record (§52).
 */

export interface PageSignals {
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  robotsMeta: string | null;
  viewport: string | null;
  lang: string | null;
  ogTags: string[];
  twitterTags: string[];
  structuredDataBlocks: number;
  structuredDataTypes: string[];
  h1Count: number;
  h1Text: string[];
  headingOrder: number[];
  headingSkips: number;
  headingCount: number;
  images: number;
  imagesMissingAlt: number;
  imagesWithoutDimensions: number;
  imagesLazy: number;
  imagesModernFormat: number;
  internalLinks: number;
  externalLinks: number;
  brokenLookingLinks: number;
  anchorTextEmpty: number;
  forms: number;
  formFields: number;
  labelledFormFields: number;
  unlabelledFormFields: number;
  emailInputs: number;
  phoneLinks: number;
  mailtoLinks: number;
  contactLinks: number;
  bookingLinks: number;
  bookingProviders: string[];
  whatsappLinks: number;
  socialLinks: string[];
  mapEmbeds: number;
  ctaCandidates: { text: string; tag: string; score: number }[];
  buttons: number;
  navLinks: number;
  navDepth: number;
  iframes: number;
  videoEmbeds: number;
  inlineStyles: number;
  scriptCount: number;
  externalScripts: number;
  thirdPartyScripts: string[];
  styleSheets: number;
  renderBlockingScripts: number;
  preloadHints: number;
  wordCount: number;
  textLength: number;
  paragraphCount: number;
  testimonialSignals: number;
  reviewSignals: number;
  trustBadges: number;
  priceSignals: number;
  faqSignals: number;
  hoursSignals: number;
  addressSignals: number;
  copyrightYear: number | null;
  pageAgeSignal: string | null;
  tableCount: number;
  fontFamilies: string[];
  hasCookieBanner: boolean;
  hasAnalytics: boolean;
  analyticsVendors: string[];
  viewportMeta: string | null;
  mobileNavSignals: number;
  fixedWidthElements: number;
  smallFontCount: number;
  contrastRiskCount: number;
  tabindexPositive: number;
  ariaLandmarks: number;
  skipLinks: number;
  ariaLabels: number;
  ariaHidden: number;
  targetBlankNoRel: number;
  placeholderAsLabel: number;
  autoplayMedia: number;
  viewportUserScalableNo: boolean;
  deprecatedTags: string[];
  tableLayouts: number;
}

const BOOKING_PROVIDERS: { pattern: RegExp; name: string }[] = [
  { pattern: /calendly\.com/i, name: "Calendly" },
  { pattern: /cal\.com/i, name: "Cal.com" },
  { pattern: /acuityscheduling/i, name: "Acuity" },
  { pattern: /booksy\.com/i, name: "Booksy" },
  { pattern: /setmore/i, name: "Setmore" },
  { pattern: /simplybook/i, name: "SimplyBook" },
  { pattern: /squareup\.com\/appointments/i, name: "Square Appointments" },
  { pattern: /zocdoc/i, name: "Zocdoc" },
  { pattern: /doctolib/i, name: "Doctolib" },
  { pattern: /opentable/i, name: "OpenTable" },
  { pattern: /resdiary/i, name: "ResDiary" },
  { pattern: /mindbody/i, name: "Mindbody" },
  { pattern: /servicetitan/i, name: "ServiceTitan" },
  { pattern: /housecallpro/i, name: "Housecall Pro" },
  { pattern: /book(ing)?[-_]?(now|online)/i, name: "On-site booking" },
];

const CTA_PATTERNS = [
  /^get\s+(a\s+)?(free\s+)?(quote|estimate|consultation|audit|price)/i,
  /^(request|book|schedule|arrange)\b/i,
  /^(contact|call|enquire|inquire|email)\s*(us|now|today)?$/i,
  /^(start|get started|get in touch|talk to us|speak to)/i,
  /^(buy|order|shop|subscribe|sign up|register|join)\b/i,
  /^(download|claim|apply|book now|reserve)/i,
  /free\s+(quote|consultation|estimate|trial|audit|survey)/i,
];

/** Phrases that lean on an unverifiable urgency/quantity claim. */
const HYPE_PATTERNS = [
  /world'?s\s+(best|leading|number\s*one|#1)/i,
  /\bguaranteed\s+(results|ranking|#1|first\s+page)\b/i,
  /\b100%\s+(free|guaranteed|safe)\b/i,
  /\binstant\s+results\b/i,
  /\bbest\s+in\s+(the\s+)?(world|country|city)\b/i,
];

const ANALYTICS_VENDORS: { pattern: RegExp; name: string }[] = [
  { pattern: /googletagmanager\.com|gtag\(|google-analytics\.com|ga\('create'/i, name: "Google Analytics / GTM" },
  { pattern: /plausible\.io/i, name: "Plausible" },
  { pattern: /matomo|piwik/i, name: "Matomo" },
  { pattern: /fathom\.com\/script/i, name: "Fathom" },
  { pattern: /clarity\.ms/i, name: "Microsoft Clarity" },
  { pattern: /hotjar/i, name: "Hotjar" },
  { pattern: /posthog/i, name: "PostHog" },
  { pattern: /segment\.(com|io)/i, name: "Segment" },
  { pattern: /facebook\.net\/.*fbevents|fbq\(/i, name: "Meta Pixel" },
];

export function analyzeHtml(page: Pick<FetchedPage, "html" | "headers" | "finalUrl">): PageSignals {
  const $: CheerioAPI = cheerio.load(page.html || "");
  const html = page.html || "";

  const meta = (name: string): string | null => {
    const el = $(`meta[name="${name}"]`).first();
    const value = el.attr("content");
    return value ? value.trim() : null;
  };
  const prop = (name: string): string | null => {
    const el = $(`meta[property="${name}"]`).first();
    const value = el.attr("content");
    return value ? value.trim() : null;
  };

  const title = $("head title").first().text().trim() || null;
  const metaDescription = meta("description") ?? prop("og:description");

  /* ── headings ── */
  const headingLevels: number[] = [];
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const level = Number((el as unknown as { tagName: string }).tagName.replace("h", ""));
    if (level >= 1 && level <= 6) headingLevels.push(level);
  });
  const h1Text = $("h1")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);
  let headingSkips = 0;
  for (let i = 1; i < headingLevels.length; i += 1) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) headingSkips += 1;
  }

  /* ── images ── */
  let imagesMissingAlt = 0;
  let imagesWithoutDimensions = 0;
  let imagesLazy = 0;
  let imagesModernFormat = 0;
  const allImages = $("img");
  imagesMissingAlt = allImages.filter((_, el) => !$(el).attr("alt")?.trim()).length;
  imagesWithoutDimensions = allImages.filter((_, el) => !$(el).attr("width") || !$(el).attr("height")).length;
  imagesLazy = allImages.filter((_, el) => ($(el).attr("loading") ?? "") === "lazy").length;
  imagesModernFormat = allImages.filter((_, el) => /\.(webp|avif)(\?|$)/i.test($(el).attr("src") ?? "")).length;
  $("picture source[type*='webp'], picture source[type*='avif']").each(() => {
    imagesModernFormat += 1;
  });

  /* ── links ── */
  let internalLinks = 0;
  let externalLinks = 0;
  let brokenLookingLinks = 0;
  let anchorTextEmpty = 0;
  let targetBlankNoRel = 0;
  const host = (() => {
    try {
      return new URL(page.finalUrl).host.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  $("a").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().trim();
    if (href.startsWith("http")) {
      try {
        const linkHost = new URL(href).host.replace(/^www\./, "");
        if (linkHost === host) internalLinks += 1;
        else externalLinks += 1;
      } catch {
        brokenLookingLinks += 1;
      }
    } else if (href.startsWith("/") && href !== "/") {
      internalLinks += 1;
    } else if (href === "#" || href === "" || href.toLowerCase().startsWith("javascript:void")) {
      brokenLookingLinks += 1;
    }
    if (!text && !$(el).attr("aria-label") && !$(el).find("img[alt]").length) anchorTextEmpty += 1;
    if ($(el).attr("target") === "_blank" && !/noopener|noreferrer/i.test($(el).attr("rel") ?? "")) targetBlankNoRel += 1;
  });

  /* ── contact & conversion affordances ── */
  const telLinks = $("a[href^='tel:']").length;
  const mailtoLinks = $("a[href^='mailto:']").length;
  const whatsappLinks = $("a[href*='wa.me'], a[href*='api.whatsapp.com'], a[href*='whatsapp://']").length;
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const bookingProviders = BOOKING_PROVIDERS.filter((p) => p.pattern.test(html)).map((p) => p.name);
  const bookingLinks = $("a").filter((_, el) => /book|appointment|schedule|reserve|reservation|consultation/i.test($(el).text() + ($(el).attr("href") ?? ""))).length +
    bookingProviders.length;

  /* ── CTA detection ── */
  const ctaCandidates: { text: string; tag: string; score: number }[] = [];
  $("a,button,input[type=submit]").each((_, el) => {
    const node = $(el);
    const text = (node.text() || node.attr("value") || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 60) return;
    const style = `${node.attr("class") ?? ""} ${node.attr("style") ?? ""}`;
    let score = 0;
    if (CTA_PATTERNS.some((p) => p.test(text))) score += 3;
    if (/btn|button|cta|primary/i.test(style)) score += 2;
    if (/background|color/.test(node.attr("style") ?? "")) score += 1;
    if (["BUTTON", "INPUT"].includes((el as unknown as { tagName: string }).tagName)) score += 2;
    if (score > 0) ctaCandidates.push({ text: text.slice(0, 80), tag: (el as unknown as { tagName: string }).tagName.toLowerCase(), score });
  });
  ctaCandidates.sort((a, b) => b.score - a.score);

  /* ── navigation ── */
  const navContainers = $("nav, [role='navigation'], header ul");
  const navLinks = Math.max(...navContainers.map((_, el) => $(el).find("a").length).get(), 0);
  const navDepth = navContainers.length > 0 ? (navContainers.length > 3 ? 3 : 1) : 0;
  const mobileNavSignals = $("[class*='hamburger'], [class*='menu-toggle'], [aria-controls*='menu'], [aria-expanded], [class*='mobile-menu'], [class*='navbar-toggler']").length;

  /* ── scripts & styles ── */
  const scriptSrcs = $("script[src]")
    .map((_, el) => $(el).attr("src") ?? "")
    .get();
  const thirdPartyScripts = Array.from(
    new Set(
      scriptSrcs
        .filter((src) => {
          try {
            return new URL(src, page.finalUrl).host.replace(/^www\./, "") !== host;
          } catch {
            return true;
          }
        })
        .map((src) => {
          try {
            return new URL(src, page.finalUrl).host;
          } catch {
            return src;
          }
        }),
    ),
  ).slice(0, 24);
  const renderBlockingScripts = $("head script[src]").filter((_, el) => !$(el).attr("defer") && !$(el).attr("async")).length;

  /* ── trust & content signals ── */
  const testimonialSignals =
    (bodyText.match(/testimonial|what our (clients|customers)|client review|customer stor|case stud/gi) ?? []).length +
    $("[class*='testimonial'], [id*='testimonial']").length;
  const reviewSignals =
    (bodyText.match(/\breviews?\b|\brated\b|\brating\b|google review|star rating/gi) ?? []).length +
    $("[class*='review'], [itemtype*='Review'], [class*='star']").length;
  const trustBadges = $(
    "[class*='badge'], [class*='certif'], [class*='insured'], [class*='accredit'], [class*='award'], [class*='guarantee'], [class*='trust']",
  ).length;
  const priceSignals = $("[class*='price'], [class*='pricing'], [class*='cost']").length;
  const faqSignals = $("[class*='faq'], [id*='faq']").length + (bodyText.match(/\bfaqs?\b|frequently asked/gi) ?? []).length;
  const hoursSignals = (bodyText.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[^\n]{0,40}\d{1,2}(:\d{2})?\s?(am|pm)/gi) ?? []).length +
    $("[class*='hours'], [itemprop='openingHours']").length;
  const addressSignals = $("[itemprop='address'], address, [class*='address']").length;

  /* ── copyright / freshness ── */
  const copyrightMatch = bodyText.match(/(?:©|&copy;|copyright)\s*(\d{4})(?:\s*[-–]\s*(\d{4}))?/i);
  const copyrightYear = copyrightMatch ? Number(copyrightMatch[2] ?? copyrightMatch[1]) : null;

  /* ── forms ── */
  const forms = $("form");
  let labelledFormFields = 0;
  let unlabelledFormFields = 0;
  let placeholderAsLabel = 0;
  const labelledIds = new Set<string>();
  $("label[for]").each((_, el) => {
    const id = $(el).attr("for");
    if (id) labelledIds.add(id);
  });
  let formFields = 0;
  forms.each((_, form) => {
    $(form)
      .find("input, select, textarea")
      .each((_i, field) => {
        const type = ($(field).attr("type") ?? "text").toLowerCase();
        if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;
        formFields += 1;
        const id = $(field).attr("id");
        const hasLabel = (id && labelledIds.has(id)) || $(field).closest("label").length > 0;
        const hasAria = Boolean($(field).attr("aria-label") || $(field).attr("aria-labelledby"));
        if (hasLabel || hasAria) labelledFormFields += 1;
        else {
          unlabelledFormFields += 1;
          if ($(field).attr("placeholder")) placeholderAsLabel += 1;
        }
      });
  });
  const emailInputs = $("input[type='email'], input[name*='email' i]").length;
  const contactLinks = $("a[href*='contact'], a[href^='tel:'], a[href^='mailto:']").length;

  /* ── accessibility-ish measures ── */
  const ariaLandmarks = $("[role='main'], main, [role='banner'], [role='contentinfo'], [role='navigation'], nav, [role='complementary'], aside").length;
  const skipLinks = $("a[href^='#']").filter((_, el) => /skip/i.test($(el).text())).length;
  const ariaLabels = $("[aria-label], [aria-labelledby]").length;
  const ariaHidden = $("[aria-hidden='true']").length;
  const tabindexPositive = $("[tabindex]").filter((_, el) => Number($(el).attr("tabindex")) > 0).length;
  const viewportMeta = $("meta[name='viewport']").attr("content") ?? null;
  const viewportUserScalableNo = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1\b/i.test(viewportMeta ?? "");

  /* ── inline style heuristics for mobile/contrast risk ── */
  const inlineStyles = $("[style]").length;
  const smallFontCount = $("[style*='font-size']").filter((_, el) => {
    const match = /font-size\s*:\s*(\d+)px/i.exec($(el).attr("style") ?? "");
    return match ? Number(match[1]) < 14 : false;
  }).length;
  const fixedWidthElements = $("[style*='width']").filter((_, el) => /\bwidth\s*:\s*\d{3,}px/i.test($(el).attr("style") ?? "")).length;
  const deprecatedTags = ["center", "font", "marquee", "blink", "frame", "frameset"].filter((tag) => $(tag).length > 0);
  const tableLayouts = $("table").filter((_, el) => $(el).attr("role") !== "presentation" && $(el).find("td").length > 8).length;

  /* ── structured data ── */
  const structuredDataBlocks = $("script[type='application/ld+json']").length;
  const structuredDataTypes: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      nodes.forEach((node: Record<string, unknown>) => {
        const type = node?.["@type"];
        if (typeof type === "string") structuredDataTypes.push(type);
        else if (Array.isArray(type)) structuredDataTypes.push(...type.map(String));
      });
    } catch {
      structuredDataTypes.push("invalid");
    }
  });

  const analyticsVendors = ANALYTICS_VENDORS.filter((v) => v.pattern.test(html)).map((v) => v.name);
  const fontFamilies = Array.from(
    new Set(
      ((html.match(/font-family\s*:\s*([^;"'}]+)/gi) ?? []) as string[])
        .map((m) => m.split(":")[1]?.trim().replace(/['"]/g, "").split(",")[0])
        .filter((v): v is string => Boolean(v)),
    ),
  ).slice(0, 8);

  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  return {
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    canonical: $("link[rel='canonical']").attr("href") ?? null,
    robotsMeta: meta("robots"),
    viewport: viewportMeta,
    viewportMeta,
    viewportUserScalableNo,
    lang: $("html").attr("lang") ?? null,
    ogTags: ["og:title", "og:description", "og:image", "og:type", "og:url"].filter((p) => Boolean(prop(p))),
    twitterTags: ["twitter:card", "twitter:title", "twitter:description", "twitter:image"].filter((n) => Boolean(meta(n))),
    structuredDataBlocks,
    structuredDataTypes: Array.from(new Set(structuredDataTypes)),
    h1Count: h1Text.length,
    h1Text: h1Text.slice(0, 3),
    headingOrder: headingLevels.slice(0, 80),
    headingSkips,
    headingCount: headingLevels.length,
    images: allImages.length,
    imagesMissingAlt,
    imagesWithoutDimensions,
    imagesLazy,
    imagesModernFormat,
    internalLinks,
    externalLinks,
    brokenLookingLinks,
    anchorTextEmpty,
    forms: forms.length,
    formFields,
    labelledFormFields,
    unlabelledFormFields,
    emailInputs,
    phoneLinks: telLinks,
    mailtoLinks,
    contactLinks,
    bookingLinks,
    bookingProviders,
    whatsappLinks,
    socialLinks: ["facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "tiktok.com"].filter((d) =>
      new RegExp(d.replace(".", "\\."), "i").test(html),
    ),
    mapEmbeds: $("iframe[src*='google.com/maps'], iframe[src*='maps.google'], [class*='map']").length,
    ctaCandidates: ctaCandidates.slice(0, 12),
    buttons: $("button, [role='button'], input[type=submit]").length,
    navLinks,
    navDepth,
    iframes: $("iframe").length,
    videoEmbeds: $("iframe[src*='youtube'], iframe[src*='vimeo'], video").length,
    inlineStyles,
    scriptCount: $("script").length,
    externalScripts: scriptSrcs.length,
    thirdPartyScripts,
    styleSheets: $("link[rel='stylesheet']").length,
    renderBlockingScripts,
    preloadHints: $("link[rel='preload'], link[rel='preconnect'], link[rel='dns-prefetch']").length,
    wordCount,
    textLength: bodyText.length,
    paragraphCount: $("p").length,
    testimonialSignals,
    reviewSignals,
    trustBadges,
    priceSignals,
    faqSignals,
    hoursSignals,
    addressSignals,
    copyrightYear,
    pageAgeSignal: copyrightYear ? (copyrightYear <= new Date().getFullYear() - 3 ? "dated_copyright" : "current_copyright") : null,
    tableCount: $("table").length,
    tableLayouts,
    fontFamilies,
    hasCookieBanner: /cookie|consent/i.test(html) && $("[class*='cookie'], [id*='cookie'], [class*='consent']").length > 0,
    hasAnalytics: analyticsVendors.length > 0,
    analyticsVendors,
    mobileNavSignals,
    fixedWidthElements,
    smallFontCount,
    contrastRiskCount: $("[style*='color']").filter((_, el) => /color\s*:\s*#?[cdefCDEF0-9]{3}/.test($(el).attr("style") ?? "")).length,
    tabindexPositive,
    ariaLandmarks,
    skipLinks,
    ariaLabels,
    ariaHidden,
    targetBlankNoRel,
    placeholderAsLabel,
    autoplayMedia: $("[autoplay]").length,
    deprecatedTags,
  };
}

export function detectHypeClaims(text: string): string[] {
  const found: string[] = [];
  HYPE_PATTERNS.forEach((pattern) => {
    const match = pattern.exec(text);
    if (match) found.push(match[0]);
  });
  return found.slice(0, 4);
}

/* ── technology detection ────────────────────────────────────────────────── */

export interface TechDetection {
  cms: string | null;
  cmsConfidence: number;
  stack: string[];
  themeHints: string[];
}

const CMS_SIGNATURES: { name: string; patterns: RegExp[]; weight: number }[] = [
  { name: "WordPress", patterns: [/wp-content/i, /wp-includes/i, /wp-json/i, /wordpress/i, /woocommerce/i], weight: 3 },
  { name: "Wix", patterns: [/wixstatic\.com/i, /wix\.com/i, /_wix_/i, /wix-image/i], weight: 3 },
  { name: "Squarespace", patterns: [/squarespace\.com/i, /static1\.squarespace/i, /sqs-block/i], weight: 3 },
  { name: "Shopify", patterns: [/cdn\.shopify\.com/i, /shopify\.theme/i, /myshopify\.com/i], weight: 3 },
  { name: "Webflow", patterns: [/webflow\.(com|io)/i, /w-nav-/, /data-wf-page/i], weight: 3 },
  { name: "GoDaddy Website Builder", patterns: [/godaddysites\.com/i, /wsimg\.com/i], weight: 2 },
  { name: "Drupal", patterns: [/drupal-settings-json/i, /sites\/default\/files/i, /\/core\/misc\/drupal/i], weight: 2 },
  { name: "Joomla", patterns: [/\/media\/jui\//i, /joomla/i, /com_content/i], weight: 2 },
  { name: "HubSpot CMS", patterns: [/hs-scripts\.com/i, /hubspot/i, /hs_cos_wrapper/i], weight: 2 },
  { name: "Weebly", patterns: [/weebly/i, /editmysite/i], weight: 2 },
  { name: "Ghost", patterns: [/ghost-.*\.js/i, /content\/themes\/casper/i], weight: 2 },
  { name: "Elementor (WordPress)", patterns: [/elementor/i, /elementor-widget/i], weight: 2 },
  { name: "Next.js", patterns: [/__NEXT_DATA__/i, /_next\/static/i], weight: 2 },
  { name: "React", patterns: [/data-reactroot/i, /react-dom/i, /__REACT_DEVTOOLS/i], weight: 1 },
  { name: "Vue", patterns: [/data-v-[0-9a-f]{8}/i, /__VUE__/i], weight: 1 },
  { name: "Angular", patterns: [/ng-version/i, /ng-app/i], weight: 1 },
  { name: "Bootstrap", patterns: [/bootstrap(\.min)?\.css/i, /col-md-/i], weight: 1 },
  { name: "jQuery", patterns: [/jquery(\.min)?\.js/i, /\$\(document\)\.ready/i], weight: 1 },
  { name: "Tailwind CSS", patterns: [/tailwind/i, /class="[^"]*\bflex\b[^"]*\bitems-center\b/], weight: 1 },
  { name: "Cloudflare", patterns: [/cloudflare/i, /cdnjs\.cloudflare\.com/i], weight: 1 },
];

export function detectTech(html: string, headers: Record<string, string>): TechDetection {
  const haystack = `${html}\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n")}`;
  const stack: string[] = [];
  let cms: string | null = null;
  let cmsConfidence = 0;

  CMS_SIGNATURES.forEach((sig) => {
    const hits = sig.patterns.filter((p) => p.test(haystack)).length;
    if (hits > 0) {
      if (!stack.includes(sig.name)) stack.push(sig.name);
      if (hits >= 2 && sig.weight >= 2 && cmsConfidence < hits) {
        const cmsLike = !["React", "Vue", "Angular", "Bootstrap", "jQuery", "Tailwind CSS", "Cloudflare"].includes(sig.name);
        if (cmsLike) {
          cms = sig.name;
          cmsConfidence = hits;
        }
      }
    }
  });

  const themeHints: string[] = [];
  const themeMatch = /wp-content\/themes\/([a-z0-9-_]+)/i.exec(html);
  if (themeMatch) themeHints.push(`WP theme: ${themeMatch[1]}`);
  const pluginMatches = Array.from(new Set((html.match(/wp-content\/plugins\/([a-z0-9-_]+)/gi) ?? []).map((m) => m.split("/").pop() ?? "")));
  if (pluginMatches.length) themeHints.push(`${pluginMatches.length} WordPress plugin bundle(s) referenced`);

  const server = headers.server;
  if (server) stack.push(`Server: ${server}`);

  return { cms, cmsConfidence, stack: Array.from(new Set(stack)).slice(0, 18), themeHints };
}

/** Weighted page-weight estimate from the markup we received (html bytes + declared assets). */
export function estimatePageWeight(page: Pick<FetchedPage, "html" | "byteLength">): {
  htmlKb: number;
  assetsKbEstimate: number;
  totalKbEstimate: number;
  compressed: boolean;
} {
  const htmlKb = Math.round(page.byteLength / 1024);
  const $ = cheerio.load(page.html || "");
  let assets = 0;
  $("img[src], link[rel='stylesheet'], script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("href") ?? "";
    if (/\.(jpg|jpeg|png|gif|bmp)$/i.test(src)) assets += 380;
    else if (/\.(webp|avif)$/i.test(src)) assets += 120;
    else if (/\.css(\?|$)/i.test(src)) assets += 70;
    else if (/\.js(\?|$)/i.test(src)) assets += 210;
  });
  return {
    htmlKb,
    assetsKbEstimate: assets,
    totalKbEstimate: htmlKb + assets,
    compressed: htmlKb > 0 && page.byteLength / Math.max(1, (page.html || "").length) < 0.85,
  };
}
