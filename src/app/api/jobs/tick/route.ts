import { timingSafeEqual, createHash } from "node:crypto";
import { route, json, ApiError } from "@/lib/api/http";
import { runPendingJobs } from "@/lib/queue";
import { loadHandlers, scheduleRecurringWork, scheduledJobsTonight } from "@/lib/jobs/handlers";
import { jobStats } from "@/lib/db/repo/ops";
import { databaseStatus } from "@/lib/db";

/**
 * Cron-driven job tick.
 *
 * Hosts that cannot run long-lived timers (shared/cPanel hosting, most PaaS
 * request-scoped runtimes) call this endpoint from cron instead of relying on
 * the in-process worker:
 *
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     https://app.example.com/api/jobs/tick
 *
 * It processes queued work and, when `?schedule=1` is passed, also records the
 * recurring work for the day. It never reveals queue contents to an
 * unauthenticated caller.
 */

function sameSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export const POST = route({ auth: false }, async (request, _body, context) => {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret") ?? context.query.get("secret");
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProduction) {
      throw new ApiError(
        503,
        "Scheduled job processing is not enabled on this instance. Set CRON_SECRET, or leave WORKER_ENABLED at its default so the in-process worker runs.",
        "cron_not_configured",
      );
    }
  } else if (!sameSecret(provided, secret)) {
    throw new ApiError(401, "A valid x-cron-secret header is required.", "invalid_cron_secret");
  }

  const db = databaseStatus();
  if (!db.healthy) {
    throw new ApiError(503, "The database is not reachable, so queued work cannot run.", "database_unavailable");
  }

  loadHandlers();

  const max = Math.max(1, Math.min(25, Number(context.query.get("max") ?? 5) || 5));
  const processed = await runPendingJobs(max);

  const scheduled = context.query.get("schedule") === "1" ? scheduleRecurringWork() : null;

  return json({
    ok: true,
    unauthenticated: !secret && !isProduction,
    processed,
    stats: jobStats(context.organization.id),
    ...(scheduled ? { scheduled: scheduled.scheduled.length, skipped: scheduled.skipped.length } : {}),
    tonight: scheduledJobsTonight().length,
  });
});

/** Some cron services only issue GET requests; both do the same work. */
export const GET = POST;
