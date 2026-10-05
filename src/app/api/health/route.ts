import { route, json } from "@/lib/api/http";
import { databaseStatus } from "@/lib/db";
import { workerStatus } from "@/lib/queue";
import { APP_VERSION } from "@/lib/version";

/**
 * Uptime check for hosting panels, load balancers and Docker healthchecks.
 *
 * Deliberately unauthenticated and deliberately quiet: it reports whether the
 * process and its database are healthy, and nothing about the workspace's
 * contents. No secrets, no row counts, no customer names.
 */
export const GET = route({ auth: false }, async () => {
  const database = databaseStatus();
  const worker = workerStatus();

  return json(
    {
      status: database.healthy ? "ok" : "degraded",
      version: APP_VERSION,
      database: {
        healthy: database.healthy,
        driver: database.driver,
        error: database.error ?? null,
      },
      worker: {
        // "cron" means timers are off and /api/jobs/tick is expected instead.
        driver: worker.running ? "in_process" : process.env.WORKER_ENABLED === "false" ? "cron" : "not_started",
        // Handlers registered in *this* process. On a cron-driven host this is
        // legitimately 0 until /api/jobs/tick loads them, and the field name
        // says so rather than implying the catalogue is empty.
        handlersRegisteredHere: worker.handlers,
      },
      checkedAt: new Date().toISOString(),
    },
    { status: database.healthy ? 200 : 503 },
  );
});
