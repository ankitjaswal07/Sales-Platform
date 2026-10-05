import "server-only";

import { addJobLog, claimNextJob, completeJob, enqueueJob, failJob, getJob, updateJobProgress } from "../db/repo/ops";
import { getDb } from "../db";
import { loadHandlers, scheduleRecurringWork } from "../jobs/handlers";
import type { Job } from "../db/repo/types";
import type { JobType } from "../types";
import { logger } from "../logger";

/**
 * Durable background queue (§45, §46).
 *
 * Jobs live in the `jobs` table, so they survive a restart and can be inspected
 * from the Diagnostics page. The default driver runs the worker inside the app
 * process when the instance starts (`instrumentation.ts`). Setting `REDIS_URL`
 * switches coordination to Redis so several instances can share the queue —
 * the handler contract is identical either way.
 *
 * Every handler receives a `report` callback so long operations can publish
 * real progress (percent + human-readable stage) for the UI to render.
 */

export interface JobContext {
  job: Job;
  report: (progress: number, stage: string) => void;
  log: (message: string, meta?: Record<string, unknown>) => void;
  /** Throws if the job has been cancelled while running. */
  assertActive: () => void;
}

export type JobHandler = (payload: Record<string, unknown>, context: JobContext) => Promise<Record<string, unknown>>;

const handlers = new Map<JobType, JobHandler>();

export function registerHandler(type: JobType, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function hasHandler(type: JobType): boolean {
  return handlers.has(type);
}

export function registeredTypes(): JobType[] {
  return [...handlers.keys()];
}

/* ── enqueue ─────────────────────────────────────────────────────────────── */

export function schedule(input: {
  orgId: string | null;
  type: JobType;
  label?: string;
  payload?: Record<string, unknown>;
  priority?: number;
  createdBy?: string | null;
  scheduledAt?: string;
}): Job {
  const job = enqueueJob(input.orgId, {
    type: input.type,
    label: input.label,
    payload: input.payload,
    priority: input.priority,
    createdBy: input.createdBy,
    scheduledAt: input.scheduledAt,
  });
  // Kick the worker immediately so short jobs feel synchronous.
  queueMicrotask(() => {
    void runPendingJobs(1).catch((error) => logger.warn("queue", "Immediate job run failed", { error: String(error) }));
  });
  return job;
}

/* ── execution ───────────────────────────────────────────────────────────── */

const running = new Set<string>();

export async function runPendingJobs(max = 3): Promise<number> {
  const concurrency = Math.min(Number(process.env.WORKER_CONCURRENCY ?? 3), 8);
  let processed = 0;

  for (let i = 0; i < max; i += 1) {
    if (running.size >= concurrency) break;
    const job = claimNextJob(registeredTypes());
    if (!job) break;
    void execute(job);
    processed += 1;
  }
  return processed;
}

export async function execute(job: Job): Promise<void> {
  if (running.has(job.id)) return;
  running.add(job.id);

  const handler = handlers.get(job.type);
  const started = Date.now();

  const context: JobContext = {
    job,
    report: (progress, stage) => {
      updateJobProgress(job.id, progress, stage);
      logger.debug("queue", `${job.type}: ${stage}`, { jobId: job.id, progress });
    },
    log: (message, meta) => addJobLog(job.id, "info", message, meta ?? {}),
    assertActive: () => {
      const current = getJob(job.orgId, job.id);
      if (!current || current.status === "cancelled") {
        throw new Error("Job was cancelled.");
      }
    },
  };

  try {
    if (!handler) {
      throw new Error(
        `No handler registered for job type "${job.type}". Registered types: ${registeredTypes().join(", ") || "none"}.`,
      );
    }
    const result = await handler(job.payload, context);
    completeJob(job.id, result);
    logger.info("queue", `Job ${job.type} succeeded`, { jobId: job.id, durationMs: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = failJob(job.id, message);
    logger.error("queue", `Job ${job.type} failed`, {
      jobId: job.id,
      error: message,
      attempt: outcome.attempts,
      willRetry: outcome.retrying,
      durationMs: Date.now() - started,
    });
  } finally {
    running.delete(job.id);
  }
}

/** Manually retry a failed job from the Diagnostics page. */
export function retryJob(jobId: string): boolean {
  const job = getJob(null, jobId);
  if (!job) return false;
  if (!["failed", "cancelled"].includes(job.status)) return false;
  updateJobProgress(jobId, 0, "Re-queued");
  getDb().prepare("UPDATE jobs SET status = 'queued', error = NULL, completed_at = NULL, scheduled_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    jobId,
  );
  addJobLog(jobId, "info", "Job manually re-queued");
  queueMicrotask(() => {
    void runPendingJobs(1);
  });
  return true;
}

/* ── worker lifecycle ────────────────────────────────────────────────────── */

const globalForWorker = globalThis as unknown as { __leadforgeWorker?: { timer: NodeJS.Timeout; startedAt: string } };

export function startWorker(intervalMs = 2500): void {
  if (globalForWorker.__leadforgeWorker) return;

  loadHandlers();

  const tick = async () => {
    try {
      await runPendingJobs(3);
    } catch (error) {
      logger.error("queue", "Worker tick failed", { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  // Do not keep the process alive purely for the poller.
  if (typeof timer.unref === "function") timer.unref();

  const recurring = scheduleRecurringWork();
  globalForWorker.__leadforgeWorker = { timer, startedAt: new Date().toISOString() };
  logger.info("queue", "Background worker started", {
    intervalMs,
    handlerCount: registeredTypes().length,
    driver: process.env.QUEUE_DRIVER ?? "inline",
    scheduled: recurring.scheduled.length,
  });

  void tick();
}

export function workerStatus(): { running: boolean; startedAt: string | null; handlers: number; driver: string } {
  return {
    running: Boolean(globalForWorker.__leadforgeWorker),
    startedAt: globalForWorker.__leadforgeWorker?.startedAt ?? null,
    handlers: registeredTypes().length,
    driver: process.env.QUEUE_DRIVER ?? "inline",
  };
}
