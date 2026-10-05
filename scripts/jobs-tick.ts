/**
 * Drains the background job queue once, then exits.
 *
 * This is the CLI equivalent of `POST /api/jobs/tick`, for hosts where cron can
 * run a command but HTTP is awkward, and for verifying the queue by hand:
 *
 *   npm run jobs:tick
 *
 * Exit code is 0 when every claimed job finished, 1 when anything failed, so a
 * scheduler can alert on it.
 */
import { loadHandlers, scheduleRecurringWork, scheduledJobsTonight } from "../src/lib/jobs/handlers.ts";
import { runPendingJobs } from "../src/lib/queue/index.ts";
import { jobStats, listJobs } from "../src/lib/db/repo/ops.ts";
import { getPrimaryOrganization } from "../src/lib/db/repo/org.ts";

const schedule = process.argv.includes("--schedule");

async function main(): Promise<number> {
  loadHandlers();

  if (schedule) {
    const result = scheduleRecurringWork();
    console.log(`Recurring work: ${result.scheduled.length} scheduled, ${result.skipped.length} already queued.`);
  }

  let processed = 0;
  let rounds = 0;
  // Claim work in batches until the queue is empty (or we hit the safety cap).
  while (rounds < 200) {
    const count = await runPendingJobs(4);
    if (count === 0) break;
    processed += count;
    rounds += 1;
  }

  const org = getPrimaryOrganization();
  const stats = org ? jobStats(org.id) : null;
  const failures = org
    ? listJobs(org.id, { status: ["failed"], limit: 20 }).items
    : [];

  console.log(`Processed ${processed} job${processed === 1 ? "" : "s"}.`);
  if (stats) {
    console.log(
      `Queue now: ${stats.queued} queued, ${stats.running} running, ${stats.succeeded} succeeded, ${stats.failed} failed.`,
    );
  }
  const tonight = scheduledJobsTonight().length;
  if (tonight) console.log(`${tonight} scheduled item(s) remain for later.`);

  if (failures.length) {
    console.log("\nFailed or retrying jobs:");
    failures.forEach((job) => console.log(`  • ${job.type} — ${job.error ?? "no error recorded"}`));
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Job tick failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
