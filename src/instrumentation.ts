/**
 * Next.js instrumentation hook.
 *
 * Runs once when the Node server boots — in `next dev`, `next start` and the
 * container image. This is where the background job queue gets its heartbeat,
 * so queued work (audits, imports, campaign sends, reports) actually progresses
 * without any external scheduler.
 *
 * Hosts that cannot keep a long-lived process alive (shared/cPanel hosting,
 * some PaaS runtimes) should set `WORKER_ENABLED=false` and drive the same
 * queue from cron instead — see `docs/DEPLOYMENT.md` and
 * `POST /api/jobs/tick`.
 */
export async function register(): Promise<void> {
  // The queue uses better-sqlite3, which only exists in the Node.js runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Never start timers while `next build` is collecting page data.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.WORKER_ENABLED === "false") return;

  try {
    const [{ startWorker }, { loadHandlers }] = await Promise.all([
      import("./lib/queue"),
      import("./lib/jobs/handlers"),
    ]);
    loadHandlers();
    startWorker(Number(process.env.WORKER_INTERVAL_MS ?? 2500));
  } catch (error) {
    // A missing worker must never stop the app from serving pages; the cron
    // endpoint and the CLI can always drain the queue instead.
    console.error(
      JSON.stringify({
        level: "error",
        scope: "instrumentation",
        message: "Background worker did not start",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
