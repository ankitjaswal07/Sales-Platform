import "server-only";

import type { IntegrationDefinition } from "../db/repo/ops";

/**
 * Integration registry (§42).
 *
 * Each entry declares the environment variables that must be present before it
 * can do anything. The Integrations screen renders live connection state from
 * this registry, so nothing in the product ever pretends an integration works
 * when it has not been configured (§69). Every provider listed here is an
 * official API — there is no scraping or unofficial automation anywhere.
 */

export type IntegrationCategory =
  | "ai"
  | "cms"
  | "business_data"
  | "website_intelligence"
  | "email"
  | "messaging"
  | "calendar"
  | "notifications"
  | "storage"
  | "payments"
  | "analytics"
  | "observability";

export interface RegistryEntry extends IntegrationDefinition {
  category: IntegrationCategory;
  /** Shown on the integration card as the setup instruction. */
  setup: string;
  /** What changes in the product once this is connected. */
  benefit: string;
  optionalEnv?: string[];
}

export const INTEGRATION_REGISTRY: RegistryEntry[] = [
  {
    key: "ai_provider",
    name: "AI language model",
    category: "ai",
    description: "Optional LLM used to improve the wording of analyses, proposals and outreach. The platform's reasoning, scoring and audit engines run locally and do not require this.",
    requiredEnv: ["AI_PROVIDER", "AI_API_KEY"],
    optionalEnv: ["AI_MODEL", "AI_BASE_URL", "AI_MAX_TOKENS", "AI_TEMPERATURE"],
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    configurable: false,
    setup: "Set AI_PROVIDER (openai, anthropic, azure-openai or openrouter), AI_API_KEY and optionally AI_MODEL. Server-side only — the key never reaches the browser.",
    benefit: "Sharper, more natural copy across analyses, proposals and outreach. Falls back to the deterministic engine automatically if a request fails.",
  },
  {
    key: "google_places",
    name: "Google Places / Business Profile",
    category: "business_data",
    description: "Public business listings: name, address, category, rating, review count, phone and website.",
    requiredEnv: ["GOOGLE_PLACES_API_KEY"],
    docsUrl: "https://developers.google.com/maps/documentation/places/web-service/overview",
    configurable: false,
    setup: "Create a Google Cloud project, enable Places API (New) and set GOOGLE_PLACES_API_KEY. Usage is billed by Google.",
    benefit: "Live business discovery. Without it, the Lead Finder uses the built-in sample dataset so every workflow remains demonstrable.",
  },
  {
    key: "opencorporates",
    name: "OpenCorporates",
    category: "business_data",
    description: "Company registration data: legal name, incorporation date, status and registered address.",
    requiredEnv: ["OPENCORPORATES_API_KEY"],
    docsUrl: "https://api.opencorporates.com/documentation/API-Reference",
    configurable: false,
    setup: "Request an API key from OpenCorporates and set OPENCORPORATES_API_KEY.",
    benefit: "Confirms the business is actively registered and how long it has traded — a strong predictor of budget.",
  },
  {
    key: "yelp",
    name: "Yelp Fusion",
    category: "business_data",
    description: "Additional public business listings and review volume for local discovery.",
    requiredEnv: ["YELP_API_KEY"],
    docsUrl: "https://docs.developer.yelp.com/docs/fusion-intro",
    configurable: false,
    setup: "Create a Yelp app and set YELP_API_KEY.",
    benefit: "Wider coverage in markets where Yelp has strong local data.",
  },
  {
    key: "pagespeed",
    name: "Google PageSpeed Insights",
    category: "website_intelligence",
    description: "Real Core Web Vitals and Lighthouse scores for audited sites.",
    requiredEnv: ["PAGESPEED_API_KEY"],
    docsUrl: "https://developers.google.com/speed/docs/insights/v5/get-started",
    configurable: false,
    setup: "Enable the PageSpeed Insights API in Google Cloud and set PAGESPEED_API_KEY.",
    benefit: "Audits report real LCP, CLS and INP. Without it, the audit still measures server response time, page weight and every DOM signal locally — it simply reports Core Web Vitals as unavailable rather than estimating them.",
  },
  {
    key: "screenshot",
    name: "Website screenshots",
    category: "website_intelligence",
    description: "Rendered screenshots used in before/after proposal comparisons.",
    requiredEnv: ["SCREENSHOT_API_URL"],
    optionalEnv: ["SCREENSHOT_API_KEY"],
    docsUrl: "https://developers.cloudflare.com/browser-rendering/",
    configurable: false,
    setup: "Point SCREENSHOT_API_URL at a browser-rendering service (Cloudflare Browser Rendering, ScreenshotOne, Browserless). Set SCREENSHOT_API_KEY if the provider requires one.",
    benefit: "Proposals include a genuine rendered screenshot of the current site beside the recommended design.",
  },
  {
    key: "email",
    name: "Transactional email",
    category: "email",
    description: "Delivery provider for outreach, notifications and proposal links.",
    requiredEnv: ["EMAIL_PROVIDER"],
    optionalEnv: ["RESEND_API_KEY", "SENDGRID_API_KEY", "POSTMARK_TOKEN", "SMTP_URL", "EMAIL_FROM", "EMAIL_REPLY_TO"],
    docsUrl: "https://resend.com/docs",
    configurable: false,
    setup: "Set EMAIL_PROVIDER to resend, sendgrid, postmark or smtp, then supply the matching credential. Also set EMAIL_FROM to a verified sending domain.",
    benefit: "Outreach and alerts are actually delivered. Until configured, emails are composed and recorded in the log with status 'not_sent' so nothing is lost and nothing is falsely reported as sent.",
  },
  {
    key: "whatsapp",
    name: "WhatsApp Business Cloud API",
    category: "messaging",
    description: "Official Meta WhatsApp Business API for high-intent lead alerts to the agency.",
    requiredEnv: ["WHATSAPP_PROVIDER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ALERT_TO"],
    optionalEnv: ["WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"],
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    configurable: false,
    setup: "Create a Meta Business app, add the WhatsApp product, set WHATSAPP_PROVIDER=cloud, then supply the phone number ID, a permanent system-user token and the destination number. Set WHATSAPP_APP_SECRET to verify inbound webhook signatures.",
    benefit: "Instant WhatsApp alerts when a prospect shows buying intent. Only the official Cloud API is supported — no unofficial automation, no personal-account automation.",
  },
  {
    key: "calendar",
    name: "Calendar & scheduling",
    category: "calendar",
    description: "Booking links for proposals and meeting scheduling.",
    requiredEnv: ["CALENDAR_BOOKING_URL"],
    docsUrl: "https://developers.calendar.google.com/",
    configurable: false,
    setup: "Set CALENDAR_BOOKING_URL to your Cal.com, Calendly or Google Appointment page. The URL is templated into proposals and confirmation emails.",
    benefit: "Proposal CTAs become live booking links rather than a request to reply.",
  },
  {
    key: "slack",
    name: "Slack notifications",
    category: "notifications",
    description: "Posts hot-lead and proposal alerts into a channel.",
    requiredEnv: ["SLACK_WEBHOOK_URL"],
    docsUrl: "https://api.slack.com/messaging/webhooks",
    configurable: false,
    setup: "Create an incoming webhook in your Slack workspace and set SLACK_WEBHOOK_URL.",
    benefit: "The whole team sees hot leads the moment they are detected.",
  },
  {
    key: "storage",
    name: "Object storage",
    category: "storage",
    description: "S3-compatible storage for screenshots, proposal PDFs and data exports.",
    requiredEnv: ["STORAGE_DRIVER"],
    optionalEnv: ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
    docsUrl: "https://developers.cloudflare.com/r2/",
    configurable: false,
    setup: "Set STORAGE_DRIVER=s3 and provide the endpoint, region, bucket and credentials. Leave as 'local' to store files on the server filesystem.",
    benefit: "Assets survive redeploys and can be served from a CDN.",
  },
  {
    key: "payments",
    name: "Payments & deposits",
    category: "payments",
    description: "Optional deposit and invoice collection on accepted proposals.",
    requiredEnv: ["PAYMENTS_PROVIDER", "PAYMENTS_API_KEY"],
    docsUrl: "https://stripe.com/docs/api",
    configurable: false,
    setup: "Set PAYMENTS_PROVIDER=stripe and PAYMENTS_API_KEY. Payment links are attached to accepted proposals only.",
    benefit: "Converts an accepted proposal into a paid deposit without leaving the platform.",
  },
  {
    key: "product_analytics",
    name: "Product analytics",
    category: "analytics",
    description: "Optional platform-level usage analytics (server-side events only, no PII).",
    requiredEnv: ["POSTHOG_API_KEY"],
    docsUrl: "https://posthog.com/docs/api",
    configurable: false,
    setup: "Set POSTHOG_API_KEY and POSTHOG_HOST. Events are sent server-side and never contain prospect personal data.",
    benefit: "Understand which workflows your team actually uses.",
  },
  {
    key: "error_monitoring",
    name: "Error monitoring",
    category: "observability",
    description: "Crash and exception reporting with stack traces.",
    requiredEnv: ["SENTRY_DSN"],
    docsUrl: "https://docs.sentry.io/platforms/javascript/guides/nextjs/",
    configurable: false,
    setup: "Create a Sentry project and set SENTRY_DSN.",
    benefit: "Errors are captured with context instead of being lost in server logs. The in-app Diagnostics page always shows local logs regardless.",
  },
  {
    key: "wordpress",
    name: "WordPress connector",
    category: "cms",
    description: "Launches this workspace from a WordPress site with signed sign-in, and shows live status in wp-admin.",
    requiredEnv: ["WORDPRESS_CONNECTOR_SECRET"],
    docsUrl: "/downloads/leadforge-connector-1.0.0.zip",
    configurable: false,
    setup:
      "Set WORDPRESS_CONNECTOR_SECRET to 32+ random characters, then install the LeadForge Connector plugin on the WordPress site (download from this row) and paste the same value into its settings.",
    benefit:
      "Your team signs in to LeadForge from wp-admin with one click — no password crosses between the two systems, and each launch link is single-use and expires in 3 minutes.",
  },
  {
    key: "redis",
    name: "Redis queue & cache",
    category: "observability",
    description: "Shared cache and job coordination for multi-instance deployments.",
    requiredEnv: ["REDIS_URL"],
    docsUrl: "https://redis.io/docs/",
    configurable: false,
    setup: "Set REDIS_URL and QUEUE_DRIVER=redis for multi-instance deployments. A single-instance deployment runs the in-process durable queue and needs no Redis.",
    benefit: "Background jobs are coordinated safely across several app instances.",
  },
];

export const PROVIDER_SUPPORT: Record<string, { env: string[]; note: string }> = {
  email: {
    env: ["EMAIL_PROVIDER", "RESEND_API_KEY", "SENDGRID_API_KEY", "POSTMARK_TOKEN", "SMTP_URL"],
    note: "Every provider is called from the server. Keys are read from the environment and never serialised into a response.",
  },
  whatsapp: {
    env: ["WHATSAPP_PROVIDER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ALERT_TO", "WHATSAPP_APP_SECRET"],
    note: "Only the official Cloud API is supported. Inbound webhooks are verified with the app secret before any message is processed.",
  },
};

export function registryEntry(key: string): RegistryEntry | undefined {
  return INTEGRATION_REGISTRY.find((entry) => entry.key === key);
}

export function integrationState(key: string): {
  configured: boolean;
  missing: string[];
  present: string[];
} {
  const entry = registryEntry(key);
  if (!entry) return { configured: false, missing: [], present: [] };
  const missing = entry.requiredEnv.filter((name) => !process.env[name]);
  const present = entry.requiredEnv.filter((name) => Boolean(process.env[name]));
  return { configured: missing.length === 0, missing, present };
}

export function integrationSummary(): {
  key: string;
  name: string;
  category: IntegrationCategory;
  configured: boolean;
  missing: string[];
  setup: string;
  benefit: string;
  docsUrl: string;
}[] {
  return INTEGRATION_REGISTRY.map((entry) => {
    const state = integrationState(entry.key);
    return {
      key: entry.key,
      name: entry.name,
      category: entry.category,
      configured: state.configured,
      missing: state.missing,
      setup: entry.setup,
      benefit: entry.benefit,
      docsUrl: entry.docsUrl,
      description: entry.description,
    };
  });
}

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  ai: "Artificial intelligence",
  cms: "Website builder & CMS",
  business_data: "Business data",
  website_intelligence: "Website intelligence",
  email: "Email",
  messaging: "Messaging",
  calendar: "Calendar",
  notifications: "Notifications",
  storage: "Storage",
  payments: "Payments",
  analytics: "Analytics",
  observability: "Observability",
};
