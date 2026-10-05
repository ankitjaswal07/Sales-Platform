import "server-only";

import { logger } from "../logger";

/**
 * Public contact-detail discovery (§26, §27).
 *
 * Scope, deliberately narrow: we read the business's *own* website — the pages
 * they publish publicly — and extract the contact details they chose to make
 * public. No purchased data, no social scraping, no private sources, no
 * bypassing any protection. If a site's robots.txt disallows us, we stop.
 *
 * Everything found is recorded as *unverified*, because pattern-matching an
 * address is not the same as confirming it exists.
 */

const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/get-in-touch", "/enquiries"];

const ROLE_ADDRESSES = ["info", "hello", "enquiries", "sales", "contact", "admin", "office", "mail", "team", "reception", "support"];

export interface DiscoveredContactDetails {
  url: string;
  emails: string[];
  phones: string[];
  contactName: string | null;
  role: string | null;
  pagesChecked: string[];
  blockedByRobots: boolean;
  note: string;
}

export async function discoverContactDetails(websiteUrl: string): Promise<DiscoveredContactDetails> {
  const base = normalize(websiteUrl);
  const result: DiscoveredContactDetails = {
    url: base,
    emails: [],
    phones: [],
    contactName: null,
    role: null,
    pagesChecked: [],
    blockedByRobots: false,
    note: "",
  };

  const robots = await robotsDisallows(base);
  if (robots) {
    result.blockedByRobots = true;
    result.note = "The site's robots.txt disallows automated access, so no contact details were read. Enter them manually or use the site's own contact form.";
    return result;
  }

  for (const path of CONTACT_PATHS) {
    const pageUrl = new URL(path, base).toString();
    try {
      const response = await fetch(pageUrl, {
        headers: { "user-agent": userAgent(), accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(Number(process.env.AUDIT_TIMEOUT_MS ?? 12_000)),
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) continue;
      const html = (await response.text()).slice(0, 600_000);
      result.pagesChecked.push(pageUrl);

      result.emails.push(...extractEmails(html, base));
      result.phones.push(...extractPhones(html));

      if (!result.contactName) {
        const named = extractNamedContact(html);
        if (named) {
          result.contactName = named.name;
          result.role = named.role;
        }
      }
      if (result.emails.length >= 4 && result.phones.length >= 2) break;
    } catch (error) {
      logger.debug("contact-discovery", "Page fetch failed", { pageUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }

  result.emails = dedupe(result.emails).sort((a, b) => rankEmail(a) - rankEmail(b)).slice(0, 6);
  result.phones = dedupe(result.phones).slice(0, 4);

  if (result.emails.length) result.role = result.role ?? roleOf(result.emails[0]);
  result.note = result.emails.length || result.phones.length
    ? `Read from ${result.pagesChecked.length} public page(s) on the business's own website. Addresses are recorded as unverified — send a first message and treat a bounce as a signal to try the enquiry form instead.`
    : `No public contact details were found on ${result.pagesChecked.length} page(s). Many sites only expose a form — use that, or record the details manually from a conversation.`;

  return result;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function normalize(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const parsed = new URL(withScheme);
  return `${parsed.protocol}//${parsed.host}/`;
}

function userAgent(): string {
  return process.env.AUDIT_USER_AGENT ?? `LeadForgeBot/1.0 (+${process.env.APP_URL ?? "https://leadforge.example"}/bot)`;
}

async function robotsDisallows(base: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/robots.txt", base).toString(), {
      headers: { "user-agent": userAgent() },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return false;
    const text = (await response.text()).slice(0, 100_000);
    const agent = userAgent().split("/")[0].toLowerCase();
    let applies = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.split("#")[0].trim();
      if (!line) continue;
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*" || value.toLowerCase().includes(agent);
      else if (key === "disallow" && applies && value === "/") return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function extractEmails(html: string, base?: string): string[] {
  const found: string[] = [];
  const mailto = html.matchAll(/mailto:([^"'<>\s?]+)/gi);
  for (const match of mailto) {
    const address = decodeURIComponent(match[1]).trim().toLowerCase();
    if (isUsableEmail(address)) found.push(address);
  }
  const generic = html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
  for (const match of generic) {
    const address = match[0].toLowerCase();
    if (isUsableEmail(address)) found.push(address);
  }
  if (base) {
    const host = new URL(base).hostname.replace(/^www\./, "");
    const escaped = host.replace(/\./g, "\\.");
    const ownDomain = new RegExp(`[a-z0-9._%+-]+@${escaped}`, "gi");
    for (const match of html.matchAll(ownDomain)) {
      if (isUsableEmail(match[0].toLowerCase())) found.push(match[0].toLowerCase());
    }
  }
  return found;
}

function isUsableEmail(address: string): boolean {
  if (address.length > 120) return false;
  if (/\.(png|jpe?g|gif|svg|webp|css|js|ico)$/i.test(address)) return false;
  if (/^(noreply|no-reply|donotreply|postmaster|abuse|webmaster)@/i.test(address)) return false;
  if (/@(example|test|sentry|localhost)\./i.test(address)) return false;
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address);
}

export function extractPhones(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/tel:([+()\d\s.-]{7,25})/gi)) {
    const phone = normalizePhone(match[1]);
    if (phone) found.push(phone);
  }
  for (const match of html.matchAll(/(?:\+44\s?\d{2,4}|0\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g)) {
    const phone = normalizePhone(match[0]);
    if (phone) found.push(phone);
  }
  return found;
}

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.replace(/\D/g, "").length < 9) return null;
  if (cleaned.replace(/\D/g, "").length > 15) return null;
  if (/^(0{3,}|\+?(\d)\1{4,})/.test(cleaned)) return null;
  if (/^0?1900|^0?0800|^0?084|^0?087/.test(cleaned)) return null; // premium/redirect numbers
  return cleaned.startsWith("0") ? `+44${cleaned.slice(1)}` : cleaned;
}

function extractNamedContact(html: string): { name: string; role: string | null } | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  const patterns = [
    /\b(?:contact|speak to|ask for|managed by|director|founder|owner)[:\s]+([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,20})\b/,
    /\b([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,20})\b[,\s]+(?:Director|Founder|Owner|Manager|Partner|Principal|Practice Manager)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const role = /director|founder|owner|manager|partner|principal/i.exec(match[0])?.[0] ?? null;
      return { name: match[1], role };
    }
  }
  return null;
}

function rankEmail(address: string): number {
  const local = address.split("@")[0];
  const index = ROLE_ADDRESSES.indexOf(local);
  if (index === -1) return 10 + local.length;
  return index;
}

function roleOf(address: string): string {
  const local = address.split("@")[0];
  return ROLE_ADDRESSES.includes(local) ? local : "named";
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
