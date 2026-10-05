import "server-only";

import { logger } from "../logger";
import { startWorker } from "./index";
import { loadHandlers } from "../jobs/handlers";

/**
 * Starts the in-process background worker.
 *
 * This module must only ever be reached from the Node.js runtime, which is why
 * `instrumentation.ts` imports it from inside a `NEXT_RUNTIME === "nodejs"`
 * branch (see the note there). It pulls in better-sqlite3 through the queue, so
 * a bundler that tried to include it for the Edge runtime would fail to resolve
 * `fs` — that is exactly what this separation prevents.
 */
export function startBackgroundWorker(): void {
  // Never start timers while `next build` is collecting page data.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  if (process.env.WORKER_ENABLED === "false") {
    logger.info("queue", "Background worker disabled by WORKER_ENABLED=false", {
      hint: "Drive the queue from cron via POST /api/jobs/tick, or run `npm run jobs:tick`.",
    });
    return;
  }

  loadHandlers();
  startWorker(Number(process.env.WORKER_INTERVAL_MS ?? 2500));
}
