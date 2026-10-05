import "server-only";

/**
 * Polite, bounded HTTP fetching for the audit engine.
 *
 * Rules we hold ourselves to (§4, §52):
 *  - We only ever request a URL the user explicitly asked us to analyse or that
 *    came from a public business listing.
 *  - `robots.txt` is honoured: if the path is disallowed for our user agent we
 *    refuse to crawl and record that as the audit result rather than spoofing
 *    a user agent or ignoring the directive.
 *  - Hard timeouts and a size ceiling so a hostile or enormous page can never
 *    stall a worker.
 *  - We send an honest, identifiable User-Agent with a contact URL.
 */

export interface FetchTiming {
  /** Time to first byte in ms (DNS + connect + response start). */
  ttfbMs: number;
  /** Time until the last byte of the body was received. */
  totalMs: number;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  html: string;
  byteLength: number;
  contentType: string;
  redirects: { from: string; to: string; status: number }[];
  timing: FetchTiming;
  blockedByRobots?: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT = Number(process.env.AUDIT_TIMEOUT_MS ?? 12000);
const MAX_BYTES = 3_500_000;
const MAX_REDIRECTS = 6;

export function userAgent(): string {
  return process.env.AUDIT_USER_AGENT ?? "LeadForgeBot/1.0 (+https://leadforge.example/bot)";
}

export function normalizeUrl(input: string): string {
  let raw = input.trim();
  if (!raw) throw new Error("A website URL is required.");
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  url.hash = "";
  // Collapse tracking params so the same page is not audited twice.
  const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
  drop.forEach((key) => url.searchParams.delete(key));
  if (url.pathname === "/index.html" || url.pathname === "/index.htm" || url.pathname === "/index.php") {
    url.pathname = "/";
  }
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function sameHost(a: string, b: string): boolean {
  return hostOf(a) === hostOf(b);
}

/* ── robots.txt ──────────────────────────────────────────────────────────── */

const robotsCache = new Map<string, { fetchedAt: number; rules: RobotsRules }>();

interface RobotsRules {
  disallowAll: boolean;
  disallow: string[];
  allow: string[];
  crawled: boolean;
}

async function loadRobots(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached.rules;

  const empty: RobotsRules = { disallowAll: false, disallow: [], allow: [], crawled: false };
  let rules = empty;
  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": userAgent() },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    if (response.ok) {
      const text = (await response.text()).slice(0, 200_000);
      rules = parseRobots(text);
      rules.crawled = true;
    }
  } catch {
    // Unreachable robots.txt is treated as "no restrictions", which matches
    // RFC 9309 behaviour for a 4xx response.
  }
  robotsCache.set(origin, { fetchedAt: Date.now(), rules });
  return rules;
}

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallowAll: false, disallow: [], allow: [], crawled: true };
  const lines = text.split(/\r?\n/);
  let inScope = false;
  const agent = userAgent().toLowerCase().split("/")[0];
  const seen = { starred: false };

  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      const target = value.toLowerCase();
      inScope = target === "*" || agent.includes(target) || target.includes(agent);
      if (target === "*") seen.starred = true;
      continue;
    }
    if (!inScope) continue;
    if (key === "disallow") {
      if (value === "/") rules.disallowAll = true;
      else if (value) rules.disallow.push(value);
    } else if (key === "allow") {
      if (value) rules.allow.push(value);
    }
  }
  return rules;
}

export function pathAllowed(rules: RobotsRules, pathname: string): boolean {
  if (!rules.crawled) return true;
  const matches = (pattern: string) =>
    pattern.length > 0 && pathname.startsWith(pattern.replace(/\*$/, ""));
  if (rules.allow.some(matches)) return true;
  if (rules.disallowAll) return false;
  return !rules.disallow.some(matches);
}

/* ── Fetching ────────────────────────────────────────────────────────────── */

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  checkRobots?: boolean;
}

export async function fetchPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  let url = normalizeUrl(rawUrl);
  const requestedUrl = url;

  if (options.checkRobots !== false) {
    const robotRules = await loadRobots(new URL(url).origin);
    if (!pathAllowed(robotRules, new URL(url).pathname)) {
      return {
        requestedUrl,
        finalUrl: url,
        status: 0,
        ok: false,
        headers: {},
        html: "",
        byteLength: 0,
        contentType: "",
        redirects: [],
        timing: { ttfbMs: 0, totalMs: 0 },
        blockedByRobots: true,
        error: "Blocked by the site's robots.txt policy for our crawler user-agent.",
      };
    }
  }

  const redirects: { from: string; to: string; status: number }[] = [];
  const started = Date.now();
  let ttfb = 0;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(url, {
        redirect: "manual",
        headers: {
          "user-agent": userAgent(),
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });

      if (!ttfb) ttfb = Date.now() - started;

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = new URL(location, url).toString();
        redirects.push({ from: url, to: next, status: response.status });
        url = next;
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        while (size < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            size += value.byteLength;
          }
        }
        try {
          await reader.cancel();
        } catch {
          /* stream already closed */
        }
      }
      const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const html = buffer.toString("utf8");

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      return {
        requestedUrl,
        finalUrl: url,
        status: response.status,
        ok: response.ok,
        headers,
        html,
        byteLength: buffer.byteLength,
        contentType,
        redirects,
        timing: { ttfbMs: ttfb || Date.now() - started, totalMs: Date.now() - started },
      };
    }

    return {
      requestedUrl,
      finalUrl: url,
      status: 0,
      ok: false,
      headers: {},
      html: "",
      byteLength: 0,
      contentType: "",
      redirects,
      timing: { ttfbMs: ttfb, totalMs: Date.now() - started },
      error: "Too many redirects (more than 6 hops).",
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "TimeoutError" || error.name === "AbortError"
          ? `Timed out after ${timeoutMs}ms.`
          : error.message
        : "Unknown network error";
    return {
      requestedUrl,
      finalUrl: url,
      status: 0,
      ok: false,
      headers: {},
      html: "",
      byteLength: 0,
      contentType: "",
      redirects,
      timing: { ttfbMs: ttfb, totalMs: Date.now() - started },
      error: message,
    };
  }
}

/** HEAD-style probe used when we only need liveness + HTTPS state. */
export async function probeUrl(url: string, timeoutMs = 8000): Promise<{ status: number; ok: boolean; https: boolean }> {
  try {
    const response = await fetch(normalizeUrl(url), {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": userAgent(), range: "bytes=0-2048" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return { status: response.status, ok: response.ok, https: new URL(response.url).protocol === "https:" };
  } catch {
    return { status: 0, ok: false, https: /^https:/i.test(url) };
  }
}
