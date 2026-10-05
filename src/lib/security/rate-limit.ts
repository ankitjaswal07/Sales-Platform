import "server-only";

/**
 * In-process rate limiter (§50).
 *
 * A sliding window per key, kept in memory because the platform is designed to
 * run as a single tenant-scale node. The interface is intentionally the same
 * shape a Redis-backed limiter would expose, so swapping it for the shared
 * store in a multi-instance deployment is a one-file change.
 */

interface Bucket {
  hits: number[];
}

const globalForLimits = globalThis as unknown as { __leadforgeLimits?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  if (!globalForLimits.__leadforgeLimits) globalForLimits.__leadforgeLimits = new Map();
  return globalForLimits.__leadforgeLimits;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitVerdict {
  const now = Date.now();
  const store = buckets();
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    store.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(250, windowMs - (now - oldest)), limit };
  }

  bucket.hits.push(now);
  store.set(key, bucket);

  // Opportunistic sweep so an idle process does not accumulate keys forever.
  if (store.size > 5_000) {
    for (const [candidate, value] of store) {
      if (!value.hits.some((at) => now - at < windowMs)) store.delete(candidate);
    }
  }

  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterMs: 0, limit };
}

/** Common presets, so endpoints stay consistent about how strict they are. */
export const RATE_LIMITS = {
  /** Sign-in and other credential endpoints: brute-force protection. */
  auth: { limit: 10, windowMs: 60_000 },
  /** Anything that spends AI tokens or calls an external API. */
  expensive: { limit: 20, windowMs: 60_000 },
  /** Bulk mutations (imports, bulk audits, exports). */
  bulk: { limit: 6, windowMs: 60_000 },
  /** Outbound email and messaging. */
  outreach: { limit: 30, windowMs: 60_000 },
  /** Default for ordinary reads and writes. */
  standard: { limit: 240, windowMs: 60_000 },
  /** Public, unauthenticated endpoints (tracking pings, chat). */
  public: { limit: 120, windowMs: 60_000 },
} as const;
