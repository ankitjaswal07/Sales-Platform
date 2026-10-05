/**
 * Next.js instrumentation hook.
 *
 * Runs once when the server boots — in `next dev`, `next start` and the
 * container image — and is where the background job queue gets its heartbeat,
 * so queued work (audits, imports, campaign sends, reports) actually progresses
 * without any external scheduler.
 *
 * Hosts that cannot keep a long-lived process alive (shared/cPanel hosting,
 * some PaaS runtimes) should set `WORKER_ENABLED=false` and drive the same queue
 * from cron instead — see `docs/DEPLOYMENT.md` and `POST /api/jobs/tick`.
 *
 * ⚠️ Read before editing this file.
 *
 * Next compiles `instrumentation.ts` for **both** the Node.js and Edge runtimes.
 * The Node-only bootstrap therefore has to sit *inside* a branch the bundler can
 * prove is dead for Edge — `if (process.env.NEXT_RUNTIME === "nodejs") { ... }`,
 * which Next replaces with a literal per runtime so webpack removes it.
 *
 * An earlier version of this file used early-return guards:
 *
 *     if (process.env.NEXT_RUNTIME !== "nodejs") return;
 *     if (process.env.WORKER_ENABLED === "false") return;   // ← runtime value
 *     const mod = await import("./lib/queue");              // ← still reachable
 *
 * Webpack cannot eliminate statements after a `return`, so the Edge bundle still
 * tried to resolve better-sqlite3's `require('fs')` and `next dev` failed to
 * compile. Keeping the import inside the `=== "nodejs"` block is what makes the
 * dead-branch elimination work — please keep it that way.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      // Imported here, not at the top of the file: see the note above.
      const { startBackgroundWorker } = await import("./lib/queue/bootstrap");
      startBackgroundWorker();
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
}
