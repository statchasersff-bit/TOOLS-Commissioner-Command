/**
 * Lightweight in-memory job registry with per-type concurrency limits.
 *
 * Provides guard rails for admin-triggered heavy operations (ADP crawling,
 * trade ingestion). State is lost on server restart — terminal jobs simply
 * show "not found" in the polling UI and the admin can start a new one.
 *
 * Concurrency limits
 *   adp-crawl    — 1 (also enforced by startCrawlInBackground's liveState guard)
 *   trade-ingest — 2 (each is a DB write sweep; pooled, but still bounded)
 */

export type JobType = "adp-crawl" | "trade-ingest";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  message: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  meta?: Record<string, unknown>;
}

const CONCURRENCY: Record<JobType, number> = {
  "adp-crawl": 1,
  "trade-ingest": 2,
};

// ── Simple atomic counter for lightweight tracking ─────────────────────────
// We use two mechanisms in parallel:
//  1. activeCount — for tryAcquire/release (used by trade-ingest routes)
//  2. registry — for the /api/admin/jobs list endpoint (ADP crawl registers
//     itself here via registerCrawlJob; other types use createJob)

const activeCount = new Map<JobType, number>();
const registry = new Map<string, Job>();

function getCount(type: JobType): number {
  return activeCount.get(type) ?? 0;
}

/**
 * Try to acquire a slot for the given type. Returns true if acquired,
 * false if at the concurrency limit. Caller MUST call release() when done.
 */
export function tryAcquire(type: JobType): boolean {
  if (getCount(type) >= CONCURRENCY[type]) return false;
  activeCount.set(type, getCount(type) + 1);
  return true;
}

/** Release a previously acquired slot. */
export function release(type: JobType): void {
  activeCount.set(type, Math.max(0, getCount(type) - 1));
}

/** Current active count for a type (for status endpoints). */
export function getActiveCount(type: JobType): number {
  return getCount(type);
}

/** Max concurrency limit for a type. */
export function getConcurrencyLimit(type: JobType): number {
  return CONCURRENCY[type];
}

// ── Job registry (for list / status endpoints) ─────────────────────────────

function pruneOldJobs() {
  if (registry.size <= 50) return;
  const terminal = [...registry.entries()]
    .filter(([, j]) => ["completed", "failed", "cancelled"].includes(j.status))
    .sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
  for (const [id] of terminal.slice(0, registry.size - 20)) {
    registry.delete(id);
  }
}

/** Register an ADP crawl job that's already been started by startCrawlInBackground. */
export function registerCrawlJob(jobId: string): Job {
  const job: Job = {
    id: jobId,
    type: "adp-crawl",
    status: "running",
    progress: 0,
    message: "Crawl started",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  registry.set(jobId, job);
  pruneOldJobs();
  return job;
}

/** Look up a job by ID. Returns null if not found. */
export function getJob(id: string): Job | null {
  return registry.get(id) ?? null;
}

/** Update a job's fields. */
export function updateJob(id: string, updates: Partial<Job>): Job | null {
  const job = registry.get(id);
  if (!job) return null;
  Object.assign(job, updates, { updatedAt: Date.now() });
  return job;
}

/** Most recent jobs, newest first. */
export function listRecentJobs(limit = 30): Job[] {
  return [...registry.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
