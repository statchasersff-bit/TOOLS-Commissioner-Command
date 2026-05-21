/**
 * 2-hop ADP network crawl.
 *
 * Starts from a seed Sleeper username (read-only public API only). Discovers:
 *   depth 0: the seed user.
 *   depth 1: every user in any league the seed is in (across requested seasons).
 *   depth 2: every user in any league a depth-1 user is in.
 *
 * For each user × season we:
 *   1. fetch the user's NFL leagues for that season
 *   2. for each new league:
 *        - fetch the league's drafts and ingest them via ingestDraftById
 *          (which handles dedup, classification, quality filters, and picks)
 *        - if we have room for another depth, fetch the league's users and
 *          add them to the next-depth seed set
 *
 * Hard rules:
 *   - public/read-only Sleeper endpoints only — no auth, no mutations.
 *   - max depth is capped at 2; the caller cannot exceed without code change.
 *   - global rate limiter (rateLimitedFetchJson in server/adp.ts) gates every
 *     fetch, plus small inter-user and inter-league pauses keep the crawl
 *     under ~100 req/min on average.
 *   - dedup via in-memory Sets for users / leagues; drafts dedup via
 *     ingestDraftById's existing per-row check.
 *   - safety caps stop the crawl gracefully and log the reason.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { adpCrawlLog } from "@shared/schema";
import {
  rateLimitedFetchJson,
  ingestDraftById,
  refreshDefaultSnapshots,
} from "./adp";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const SLEEPER_API = "https://api.sleeper.app/v1";

// Spec hard ceiling — crawling deeper than 2 requires a code change.
const ABSOLUTE_MAX_DEPTH = 2;

// Default safety caps. Caller can override per-request.
const DEFAULT_CAPS = {
  maxUsers: 500,
  maxLeagues: 2500,
  maxDrafts: 1000,
  maxRequests: 25_000,
} as const;

// Pause between processing units to keep the crawl burst-free. The global
// rateLimitedFetchJson already enforces ~400ms between any two Sleeper calls;
// these add a tiny extra breath between batches.
const INTER_USER_PAUSE_MS = 250;
const INTER_LEAGUE_PAUSE_MS = 100;

// Periodic snapshot refresh during the crawl. The user-facing ADP Explorer
// reads from the `adp_snapshots` table; without this, partial crawl
// progress would only become visible after the post-crawl refresh (or the
// 6h scheduler tick). Every Nth newly-ingested draft we fire a background
// refresh so any interruption — server crash, OOM, user Stop — leaves the
// most recent partial state visible to readers.
const IN_CRAWL_SNAPSHOT_REFRESH_EVERY = 100;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// In-flight guard so overlapping crawls / fast-firing periodic refreshes
// don't pile on each other. The fire-and-forget call below skips when a
// previous refresh is still running — the next one fires after another
// N drafts anyway.
let snapshotRefreshInFlight = false;
let lastInCrawlRefreshAt = 0;

/**
 * Fire-and-forget periodic snapshot refresh during the crawl. Skips when
 * the previous refresh is still running or when the threshold hasn't been
 * crossed yet. Errors are logged and swallowed — they must never abort
 * the crawl, since each individual draft is already safely persisted by
 * `ingestDraftById`.
 */
function maybeRefreshSnapshotsDuringCrawl(result: { draftsIngested: number }): void {
  if (snapshotRefreshInFlight) return;
  if (result.draftsIngested - lastInCrawlRefreshAt < IN_CRAWL_SNAPSHOT_REFRESH_EVERY) return;
  lastInCrawlRefreshAt = result.draftsIngested;
  snapshotRefreshInFlight = true;
  void (async () => {
    try {
      const r = await refreshDefaultSnapshots();
      console.log(`[NetworkCrawl] mid-crawl snapshot refresh @${result.draftsIngested} drafts → ${r.combos} combos, ${r.rows} rows`);
    } catch (err: any) {
      console.error("[NetworkCrawl] mid-crawl snapshot refresh failed:", err?.message ?? err);
    } finally {
      snapshotRefreshInFlight = false;
    }
  })();
}

// ── Types ───────────────────────────────────────────────────────────────────

export type DraftCategory = "startup" | "rookie" | "unknown";

export interface NetworkCrawlOpts {
  seedUsername: string;
  seasons: string[];
  maxDepth: number;
  /** When set, drafts not matching one of these categories are skipped at the list step. */
  draftCategories?: DraftCategory[];
  refreshSnapshots?: boolean;
  maxUsers?: number;
  maxLeagues?: number;
  maxDrafts?: number;
  maxRequests?: number;
}

export interface NetworkCrawlResult {
  seedUser: { username: string; userId: string } | null;
  seasons: string[];
  maxDepth: number;
  usersDiscoveredByDepth: Record<number, number>;
  usersProcessed: number;
  leaguesProcessed: number;
  draftsFound: number;
  draftsIngested: number;
  picksIngested: number;
  duplicatesSkipped: number;
  /** Drafts that exist but aren't completed yet (pre_draft / drafting). */
  notCompleteSkipped: number;
  /** Drafts skipped because their category didn't match the user's filter. */
  categoryFilteredSkipped: number;
  /** Drafts dropped by ADP quality gates (too few rounds/teams, IDP, etc.). */
  excludedSkipped: number;
  errors: string[];
  capsHit: string[];
  requestCount: number;
  durationMs: number;
}

/**
 * Background-job view of the crawl. Returned by the POST endpoint immediately
 * (so the HTTP request doesn't hold open for the full crawl) and by the GET
 * progress endpoint while the work runs. UI polls /progress every ~1.5s.
 */
export interface CrawlLiveState extends NetworkCrawlResult {
  jobId: string;
  /** adp_crawl_log row id for this scan. Used by the recovery sweep to flag
   *  stale `running` rows as failed, and by the finalize step to UPDATE the
   *  same row rather than insert a duplicate. */
  logId: number | null;
  /** Terminal status, including the new "partial" state for crawls that
   *  saved some drafts before hitting an error. */
  status: "idle" | "running" | "completed" | "failed" | "cancelled" | "partial";
  startedAt: number | null;
  completedAt: number | null;
  /** Set by the cancel endpoint. The crawl loop checks this between BFS
   *  iterations and returns gracefully so partial work (drafts already
   *  ingested) is preserved. */
  cancelRequested?: boolean;

  // Inputs echoed for UI display
  seedUsername: string;
  draftCategories: DraftCategory[];

  // Phase/activity
  phase: "seed" | "depth" | "snapshots" | "done";
  phaseLabel: string;
  currentActivity: string;
  currentDepth: number;
  depthProgress: Array<{ depth: number; totalUsers: number; processedUsers: number }>;
  overallPct: number;
}

interface SleeperLeagueListItem {
  league_id: string;
  name?: string | null;
  status?: string | null;
  previous_league_id?: string | null;
  total_rosters?: number | null;
  settings?: { type?: number; [k: string]: unknown };
}

interface SleeperLeagueUser {
  user_id: string | null;
  display_name?: string | null;
}

interface SleeperDraftListItem {
  draft_id: string;
  league_id?: string | null;
  status?: string | null;
  type?: string | null;
  metadata?: Record<string, unknown> | null;
  settings?: { rounds?: number; teams?: number; [k: string]: unknown } | null;
}

// ── Small public-API helpers ────────────────────────────────────────────────

async function resolveSleeperUsername(username: string): Promise<{ username: string; userId: string } | null> {
  const data = await rateLimitedFetchJson<{ user_id?: string; username?: string }>(
    `${SLEEPER_API}/user/${encodeURIComponent(username)}`
  );
  if (!data?.user_id) return null;
  return { username: data.username || username, userId: data.user_id };
}

async function fetchUserLeagues(userId: string, season: string): Promise<SleeperLeagueListItem[] | null> {
  return rateLimitedFetchJson<SleeperLeagueListItem[]>(
    `${SLEEPER_API}/user/${userId}/leagues/nfl/${season}`
  );
}

async function fetchLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[] | null> {
  return rateLimitedFetchJson<SleeperLeagueUser[]>(
    `${SLEEPER_API}/league/${leagueId}/users`
  );
}

async function fetchLeagueDrafts(leagueId: string): Promise<SleeperDraftListItem[] | null> {
  return rateLimitedFetchJson<SleeperDraftListItem[]>(
    `${SLEEPER_API}/league/${leagueId}/drafts`
  );
}

/**
 * Estimate a draft's category from its list metadata so we can skip the
 * full ingest path when the caller has filtered draftCategories.
 * Mirrors the heuristic in adp.ts's deriveDraftType: rounds >= 8 → startup,
 * else rookie. Returns "unknown" only when settings are entirely missing.
 */
function estimateDraftCategory(d: SleeperDraftListItem): DraftCategory {
  const rounds = d.settings?.rounds;
  if (typeof rounds !== "number" || rounds <= 0) return "unknown";
  return rounds >= 8 ? "startup" : "rookie";
}

// ── Logging ─────────────────────────────────────────────────────────────────
// Scan log lifecycle:
//   * `openCrawlLog` runs at scan START with status="running" and returns
//     the row id. This is the audit anchor — even if the process is killed
//     before completion, the row stays in adp_crawl_log so admins can see
//     the crash. The startup recovery sweep (recoverStaleCrawlLogs) reaps
//     any row still "running" after the inactivity threshold and flips it
//     to status="failed".
//   * `finalizeCrawlLog` runs at scan END (or in the catch block when
//     something throws) with a terminal status — "completed", "failed",
//     "partial", or "cancelled". The same row is UPDATEd, not a second row
//     inserted, so the log shows one row per scan.
//   * If finalize never runs (e.g. SIGKILL), the row is left in the
//     `running` state for the recovery sweep — which is exactly what we
//     want for the "scan crashed mid-run, disappears from logs" failure
//     mode the original code had.

export type CrawlLogStatus = "running" | "completed" | "failed" | "partial" | "cancelled";

async function openCrawlLog(seedUsername: string, seasons: string[], maxDepth: number): Promise<number | null> {
  try {
    const message = `seed=${seedUsername} depth=${maxDepth} seasons=${seasons.join(",")} (started)`;
    const inserted = await db
      .insert(adpCrawlLog)
      .values({
        jobType: "network-crawl",
        status: "running",
        message,
        draftsFound: 0,
        draftsIngested: 0,
        picksIngested: 0,
      })
      .returning({ id: adpCrawlLog.id });
    return inserted[0]?.id ?? null;
  } catch (err: any) {
    console.error("[NetworkCrawl] failed to open log row:", err?.message);
    return null;
  }
}

async function finalizeCrawlLog(
  logId: number | null,
  result: NetworkCrawlResult,
  status: CrawlLogStatus,
): Promise<void> {
  try {
    const message =
      `seed=${result.seedUser?.username ?? "(unresolved)"} ` +
      `depth=${result.maxDepth} ` +
      `seasons=${result.seasons.join(",")} ` +
      `users=${result.usersProcessed} leagues=${result.leaguesProcessed} ` +
      `dupSkipped=${result.duplicatesSkipped} ` +
      `caps=${result.capsHit.join("|") || "none"} ` +
      `errors=${result.errors.length} ` +
      `reqs=${result.requestCount}` +
      (result.errors[0] ? ` lastError=${result.errors[result.errors.length - 1].slice(0, 200)}` : "");

    if (logId == null) {
      // Open failed (rare) — fall back to inserting a terminal row so the
      // scan still shows up in the audit log.
      await db.insert(adpCrawlLog).values({
        jobType: "network-crawl",
        status,
        message,
        draftsFound: result.draftsFound,
        draftsIngested: result.draftsIngested,
        picksIngested: result.picksIngested,
        completedAt: new Date(),
      });
      return;
    }

    await db
      .update(adpCrawlLog)
      .set({
        status,
        message,
        draftsFound: result.draftsFound,
        draftsIngested: result.draftsIngested,
        picksIngested: result.picksIngested,
        completedAt: new Date(),
      })
      .where(eq(adpCrawlLog.id, logId));
  } catch (err: any) {
    console.error("[NetworkCrawl] failed to finalize log row:", err?.message);
  }
}

// ── Background job singleton + progress tracking ───────────────────────────
// The route handler kicks off the crawl via startCrawlInBackground and returns
// immediately. The crawl mutates `liveState` as it progresses; the GET
// /api/admin/adp/crawl-network/progress endpoint reads from `liveState` so the
// UI can poll and survive tab/component remounts.

const PHASE_WEIGHTS = { seed: 1, depth0: 4, depth1: 30, depth2: 60, snapshots: 5 } as const;

let liveState: CrawlLiveState = makeIdleState();

function makeIdleState(): CrawlLiveState {
  return {
    jobId: "",
    logId: null,
    status: "idle",
    startedAt: null,
    completedAt: null,
    seedUsername: "",
    seasons: [],
    maxDepth: 0,
    draftCategories: [],
    seedUser: null,
    usersDiscoveredByDepth: {},
    usersProcessed: 0,
    leaguesProcessed: 0,
    draftsFound: 0,
    draftsIngested: 0,
    picksIngested: 0,
    duplicatesSkipped: 0,
    notCompleteSkipped: 0,
    categoryFilteredSkipped: 0,
    excludedSkipped: 0,
    errors: [],
    capsHit: [],
    requestCount: 0,
    durationMs: 0,
    phase: "seed",
    phaseLabel: "Idle",
    currentActivity: "",
    currentDepth: 0,
    depthProgress: [],
    overallPct: 0,
  };
}

function makeRunningState(opts: NetworkCrawlOpts): CrawlLiveState {
  const seasons = (opts.seasons && opts.seasons.length > 0) ? opts.seasons : ["2026", "2025", "2024"];
  const maxDepth = Math.min(Math.max(0, opts.maxDepth ?? 2), ABSOLUTE_MAX_DEPTH);
  return {
    jobId: `crawl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    logId: null,
    status: "running",
    startedAt: Date.now(),
    completedAt: null,
    seedUsername: opts.seedUsername,
    seasons,
    maxDepth,
    draftCategories: (opts.draftCategories ?? []) as DraftCategory[],
    seedUser: null,
    usersDiscoveredByDepth: {},
    usersProcessed: 0,
    leaguesProcessed: 0,
    draftsFound: 0,
    draftsIngested: 0,
    picksIngested: 0,
    duplicatesSkipped: 0,
    notCompleteSkipped: 0,
    categoryFilteredSkipped: 0,
    excludedSkipped: 0,
    errors: [],
    capsHit: [],
    requestCount: 0,
    durationMs: 0,
    phase: "seed",
    phaseLabel: "Resolving seed user…",
    currentActivity: `Resolving Sleeper user ${opts.seedUsername}`,
    currentDepth: 0,
    depthProgress: [],
    overallPct: 0,
  };
}

function depthWeight(depth: number): number {
  return depth === 0 ? PHASE_WEIGHTS.depth0
       : depth === 1 ? PHASE_WEIGHTS.depth1
       : PHASE_WEIGHTS.depth2;
}

function recomputeOverallPct(s: CrawlLiveState): void {
  if (s.status === "completed") { s.overallPct = 100; return; }
  if (s.status === "idle") { s.overallPct = 0; return; }
  let total = PHASE_WEIGHTS.seed + PHASE_WEIGHTS.snapshots;
  for (let d = 0; d <= s.maxDepth; d++) total += depthWeight(d);

  let done = 0;
  if (s.phase === "seed") {
    done = 0;
  } else if (s.phase === "depth") {
    done = PHASE_WEIGHTS.seed;
    for (let d = 0; d < s.currentDepth; d++) done += depthWeight(d);
    const cur = s.depthProgress.find((p) => p.depth === s.currentDepth);
    const frac = cur && cur.totalUsers > 0 ? cur.processedUsers / cur.totalUsers : 0;
    done += depthWeight(s.currentDepth) * frac;
  } else if (s.phase === "snapshots") {
    done = PHASE_WEIGHTS.seed;
    for (let d = 0; d <= s.maxDepth; d++) done += depthWeight(d);
    done += PHASE_WEIGHTS.snapshots * 0.5;
  } else if (s.phase === "done") {
    done = total;
  }
  s.overallPct = Math.min(100, Math.round((done / total) * 1000) / 10);
}

export function getCrawlLiveState(): CrawlLiveState {
  // Recompute on read so the percent reflects the latest counters even if
  // the crawl hasn't crossed a phase boundary.
  recomputeOverallPct(liveState);
  return liveState;
}

export function isCrawlRunning(): boolean {
  return liveState.status === "running";
}

/**
 * Request the in-flight crawl to stop. The crawl loop checks the flag at
 * BFS boundaries and returns gracefully, preserving any drafts already
 * ingested. Idempotent — calling when no crawl is running is a no-op.
 *
 * Returns true when a running crawl was flagged for cancellation.
 */
export function requestCrawlCancel(): boolean {
  if (liveState.status !== "running") return false;
  liveState.cancelRequested = true;
  liveState.currentActivity = "Stopping after current request…";
  return true;
}

/**
 * Start a crawl in the background. Returns the freshly-initialized live state
 * (or the existing state if a crawl is already running). The HTTP handler can
 * return this state immediately; the crawl continues server-side regardless
 * of whether the UI tab is still open.
 */
export function startCrawlInBackground(opts: NetworkCrawlOpts): CrawlLiveState {
  if (liveState.status === "running") return liveState;

  liveState = makeRunningState(opts);

  // Fire and forget — DO NOT await. The HTTP request returns immediately and
  // the crawl mutates `liveState` until it terminates.
  (async () => {
    const state = liveState;
    // Open the audit row IMMEDIATELY with status="running" so a process
    // kill before the work completes still leaves a trail. The recovery
    // sweep at startup will flip stale running rows to "failed".
    state.logId = await openCrawlLog(opts.seedUsername, state.seasons, state.maxDepth);

    try {
      await runNetworkCrawl(opts, state);
      const wasCancelled = !!state.cancelRequested;
      // "partial" when we stored some drafts but also hit errors; "completed"
      // is reserved for clean finishes (no errors).
      const finalStatus: CrawlLogStatus = wasCancelled
        ? "cancelled"
        : state.errors.length > 0 && state.draftsIngested > 0
          ? "partial"
          : state.errors.length > 0
            ? "failed"
            : "completed";
      state.status = finalStatus === "completed" ? "completed"
        : finalStatus === "cancelled" ? "cancelled"
        : finalStatus === "partial" ? "partial"
        : "failed";
      state.completedAt = Date.now();
      state.durationMs = state.completedAt - (state.startedAt ?? state.completedAt);
      state.phase = "done";
      state.phaseLabel =
        finalStatus === "cancelled" ? "Cancelled"
        : finalStatus === "partial" ? "Partial"
        : finalStatus === "failed" ? "Failed"
        : "Done";
      state.currentActivity = "";
      recomputeOverallPct(state);
      await finalizeCrawlLog(state.logId, state, finalStatus);
    } catch (err: any) {
      console.error("[NetworkCrawl] background run failed:", err);
      // Any drafts we successfully ingested before the throw are real — mark
      // the scan partial when there's work to recover, otherwise failed.
      const finalStatus: CrawlLogStatus = state.draftsIngested > 0 ? "partial" : "failed";
      state.status = finalStatus === "partial" ? "partial" : "failed";
      state.completedAt = Date.now();
      state.durationMs = state.completedAt - (state.startedAt ?? state.completedAt);
      if (err?.message) state.errors.push(err.message);
      state.phase = "done";
      state.phaseLabel = finalStatus === "partial" ? "Partial" : "Failed";
      await finalizeCrawlLog(state.logId, state, finalStatus);
    } finally {
      // Always refresh ADP snapshots when the crawl exits — success,
      // failure, or user-cancel. The raw drafts have already been
      // persisted by ingestDraftById, so this just makes whatever was
      // ingested visible to the Explorer. Without the finally, a
      // mid-flight throw would orphan the ingested rows for up to 6h
      // (until the scheduler tick).
      if (opts.refreshSnapshots !== false && state.draftsIngested > 0) {
        try {
          const r = await refreshDefaultSnapshots();
          console.log(`[NetworkCrawl] finalize snapshot refresh: ${r.combos} combos, ${r.rows} rows`);
        } catch (refreshErr: any) {
          console.error("[NetworkCrawl] finalize snapshot refresh failed:", refreshErr?.message ?? refreshErr);
        }
      }
    }
  })().catch(() => {/* terminal handler above already logged */});

  return liveState;
}

// ── Main orchestrator ───────────────────────────────────────────────────────

export async function runNetworkCrawl(
  opts: NetworkCrawlOpts,
  externalState?: CrawlLiveState,
): Promise<NetworkCrawlResult> {
  const startedAt = Date.now();
  const maxDepth = Math.min(Math.max(0, opts.maxDepth ?? 2), ABSOLUTE_MAX_DEPTH);
  const seasons = (opts.seasons && opts.seasons.length > 0) ? opts.seasons : ["2026", "2025", "2024"];
  const categoryFilter = opts.draftCategories && opts.draftCategories.length > 0
    ? new Set<DraftCategory>(opts.draftCategories)
    : null;

  const caps = {
    maxUsers: opts.maxUsers ?? DEFAULT_CAPS.maxUsers,
    maxLeagues: opts.maxLeagues ?? DEFAULT_CAPS.maxLeagues,
    maxDrafts: opts.maxDrafts ?? DEFAULT_CAPS.maxDrafts,
    maxRequests: opts.maxRequests ?? DEFAULT_CAPS.maxRequests,
  };

  // When called from startCrawlInBackground we share the live singleton so
  // progress is visible via the /progress endpoint. When called standalone
  // (tests, scripts) we allocate a private state object.
  const result: CrawlLiveState = externalState ?? {
    jobId: "",
    logId: null,
    status: "running",
    startedAt: Date.now(),
    completedAt: null,
    seedUsername: opts.seedUsername,
    draftCategories: (opts.draftCategories ?? []) as DraftCategory[],
    seedUser: null,
    seasons,
    maxDepth,
    usersDiscoveredByDepth: {},
    usersProcessed: 0,
    leaguesProcessed: 0,
    draftsFound: 0,
    draftsIngested: 0,
    picksIngested: 0,
    duplicatesSkipped: 0,
    notCompleteSkipped: 0,
    categoryFilteredSkipped: 0,
    excludedSkipped: 0,
    errors: [],
    capsHit: [],
    requestCount: 0,
    durationMs: 0,
    phase: "seed",
    phaseLabel: "Resolving seed user…",
    currentActivity: "",
    currentDepth: 0,
    depthProgress: [],
    overallPct: 0,
  };
  // Sync any inputs into the state so /progress reflects them even before
  // the loop starts.
  result.seasons = seasons;
  result.maxDepth = maxDepth;
  result.draftCategories = (opts.draftCategories ?? []) as DraftCategory[];

  const processedUsers = new Set<string>();
  const processedLeagues = new Set<string>();

  // Helper: bump request counter and return whether we've exceeded the cap.
  const requestCapHit = (): boolean => {
    if (result.requestCount >= caps.maxRequests) {
      if (!result.capsHit.includes("maxRequests")) {
        result.capsHit.push("maxRequests");
        console.warn(`[NetworkCrawl] Crawl capped for safety. (maxRequests=${caps.maxRequests})`);
      }
      return true;
    }
    return false;
  };

  // Helper: user-initiated cancel. Checked at every BFS boundary so the
  // crawl stops between the next league / user / depth iteration without
  // abandoning a partially-ingested draft mid-write.
  const cancelHit = (): boolean => {
    if (result.cancelRequested) {
      if (!result.capsHit.includes("cancelled")) {
        result.capsHit.push("cancelled");
        console.warn(`[NetworkCrawl] Crawl cancelled by user.`);
      }
      return true;
    }
    return false;
  };

  // ── Resolve seed user ──────────────────────────────────────────────────
  result.phase = "seed";
  result.phaseLabel = "Resolving seed user…";
  result.currentActivity = `Resolving Sleeper user ${opts.seedUsername}`;
  recomputeOverallPct(result);

  result.requestCount++;
  const seed = await resolveSleeperUsername(opts.seedUsername);
  if (!seed) {
    result.errors.push(`Seed username "${opts.seedUsername}" did not resolve.`);
    result.durationMs = Date.now() - startedAt;
    if (!externalState) {
      const logId = await openCrawlLog(opts.seedUsername, result.seasons, result.maxDepth);
      await finalizeCrawlLog(logId, result, "failed");
    }
    return result;
  }
  result.seedUser = seed;
  console.log(`[NetworkCrawl] seed resolved: ${seed.username} (${seed.userId}) — depth ${maxDepth}, seasons ${seasons.join(",")}`);

  // BFS by depth.
  let currentDepth: Set<string> = new Set([seed.userId]);
  result.usersDiscoveredByDepth[0] = 1;

  for (let depth = 0; depth <= maxDepth; depth++) {
    if (cancelHit()) break;
    const nextDepth = new Set<string>();
    const depthSize = currentDepth.size;
    console.log(`[NetworkCrawl] depth ${depth}: ${depthSize} candidate users`);

    // Initialize phase + per-depth progress for the live state
    result.phase = "depth";
    result.phaseLabel = `Depth ${depth} of ${maxDepth} — processing users`;
    result.currentDepth = depth;
    const existingDp = result.depthProgress.find((p) => p.depth === depth);
    if (existingDp) {
      existingDp.totalUsers = depthSize;
    } else {
      result.depthProgress.push({ depth, totalUsers: depthSize, processedUsers: 0 });
    }
    recomputeOverallPct(result);

    let depthCapped = false;

    for (const userId of Array.from(currentDepth)) {
      if (depthCapped) break;
      if (processedUsers.has(userId)) continue;
      if (result.usersProcessed >= caps.maxUsers) {
        result.capsHit.push("maxUsers");
        console.warn(`[NetworkCrawl] Crawl capped for safety. (maxUsers=${caps.maxUsers})`);
        depthCapped = true;
        break;
      }
      if (requestCapHit() || cancelHit()) { depthCapped = true; break; }

      processedUsers.add(userId);
      result.usersProcessed++;
      const dp = result.depthProgress.find((p) => p.depth === depth);
      if (dp) dp.processedUsers++;
      result.currentActivity = `Depth ${depth}: user ${userId.slice(-6)} (${(dp?.processedUsers ?? 0)}/${(dp?.totalUsers ?? depthSize)})`;
      recomputeOverallPct(result);

      for (const season of seasons) {
        if (depthCapped) break;
        if (requestCapHit() || cancelHit()) { depthCapped = true; break; }

        result.requestCount++;
        const leagues = await fetchUserLeagues(userId, season);
        if (!leagues || leagues.length === 0) continue;

        for (const lg of leagues) {
          if (depthCapped) break;
          if (!lg.league_id) continue;
          if (processedLeagues.has(lg.league_id)) continue;
          // Mark as seen immediately so other depth paths don't re-examine it.
          processedLeagues.add(lg.league_id);

          // Only dynasty leagues (settings.type === 2) carry dynasty ADP data.
          // Sleeper encodes: 0 = redraft, 1 = keeper, 2 = dynasty.
          // Skipping non-dynasty here prevents redraft/keeper drafts from being
          // ingested and avoids wasting API quota on irrelevant leagues.
          if ((lg.settings?.type ?? 0) !== 2) continue;

          if (result.leaguesProcessed >= caps.maxLeagues) {
            result.capsHit.push("maxLeagues");
            console.warn(`[NetworkCrawl] Crawl capped for safety. (maxLeagues=${caps.maxLeagues})`);
            depthCapped = true;
            break;
          }
          result.leaguesProcessed++;
          result.currentActivity = `Depth ${depth}: league ${(lg.name ?? lg.league_id).slice(0, 40)} (${season})`;

          // ── 1) Ingest drafts for this league ─────────────────────────────
          if (requestCapHit() || cancelHit()) { depthCapped = true; break; }
          result.requestCount++;
          const draftList = await fetchLeagueDrafts(lg.league_id);
          if (draftList && draftList.length > 0) {
            for (const d of draftList) {
              if (!d.draft_id) continue;
              if (result.draftsFound >= caps.maxDrafts) {
                result.capsHit.push("maxDrafts");
                console.warn(`[NetworkCrawl] Crawl capped for safety. (maxDrafts=${caps.maxDrafts})`);
                depthCapped = true;
                break;
              }
              result.draftsFound++;

              if (categoryFilter) {
                const cat = estimateDraftCategory(d);
                // "unknown" means the LIST response didn't carry enough
                // metadata to classify (no settings.rounds). We can't tell
                // whether it's a real startup/rookie draft from the
                // summary, so we let it through and let `ingestDraftById`
                // make the call via the full draft detail + Sleeper's
                // actual rounds/teams. Without this, drafts whose list
                // summary lacks `rounds` (older formats, certain auction
                // types) get silently dropped here even though they'd
                // pass the real classifier.
                if (cat !== "unknown" && !categoryFilter.has(cat)) {
                  result.categoryFilteredSkipped++;
                  console.log(`[NetworkCrawl] skip ${d.draft_id}: category=${cat} not in filter (rounds=${d.settings?.rounds ?? "?"})`);
                  continue;
                }
              }

              // ingestDraftById issues 2 fetches (draft + picks) when not
              // already ingested. Count conservatively as 2 requests.
              result.requestCount += 2;
              try {
                const r = await ingestDraftById(d.draft_id);
                if (r.skipped) {
                  result.duplicatesSkipped++;
                } else if (r.ok && r.picks > 0) {
                  result.draftsIngested++;
                  result.picksIngested += r.picks;
                  // Periodically refresh the ADP snapshot table so partial
                  // crawl progress is visible in the Explorer immediately
                  // — and survives a process restart mid-crawl. Without
                  // this, the user-facing snapshot only updates after the
                  // full crawl finishes (or the 6h scheduler tick).
                  maybeRefreshSnapshotsDuringCrawl(result);
                } else if (r.ok && r.picks === 0) {
                  // ingestDraftById succeeded but produced no picks. The two
                  // documented reasons are: draft "not complete" (still
                  // in-progress / pre-draft) and ADP quality gates
                  // (excluded — defensive players, too few rounds/teams).
                  // Both used to be silently dropped from the counters,
                  // making the UI show "0 ingested" with no explanation.
                  const reason = r.reason ?? "no picks";
                  if (reason === "not complete") {
                    result.notCompleteSkipped++;
                  } else {
                    result.excludedSkipped++;
                  }
                  console.log(`[NetworkCrawl] skip ${d.draft_id}: ${reason} (status=${r.status})`);
                } else if (!r.ok && r.reason) {
                  result.errors.push(`draft ${d.draft_id}: ${r.reason}`);
                  console.log(`[NetworkCrawl] error ${d.draft_id}: ${r.reason}`);
                }
              } catch (err: any) {
                result.errors.push(`draft ${d.draft_id} threw: ${err?.message ?? "unknown"}`);
              }
              if (requestCapHit() || cancelHit()) { depthCapped = true; break; }
            }
          }

          // ── 2) Discover next-depth users (only when we have room) ────────
          if (depth < maxDepth && !depthCapped) {
            if (requestCapHit() || cancelHit()) { depthCapped = true; break; }
            result.requestCount++;
            const lgUsers = await fetchLeagueUsers(lg.league_id);
            if (lgUsers) {
              for (const u of lgUsers) {
                if (u.user_id && !processedUsers.has(u.user_id)) {
                  nextDepth.add(u.user_id);
                }
              }
            }
          }

          if (INTER_LEAGUE_PAUSE_MS > 0) await sleep(INTER_LEAGUE_PAUSE_MS);
        }
      }
      if (INTER_USER_PAUSE_MS > 0) await sleep(INTER_USER_PAUSE_MS);
    }

    if (depth < maxDepth) {
      // Filter out anyone already seen across depths.
      for (const id of Array.from(processedUsers)) nextDepth.delete(id);
      result.usersDiscoveredByDepth[depth + 1] = nextDepth.size;
      currentDepth = nextDepth;
      if (currentDepth.size === 0) {
        console.log(`[NetworkCrawl] depth ${depth + 1}: no new users discovered — stopping early.`);
        break;
      }
    }
  }

  // ── Refresh ADP snapshots so the Draft Command UI sees the new data ─────
  if (opts.refreshSnapshots !== false) {
    result.phase = "snapshots";
    result.phaseLabel = "Refreshing ADP snapshots…";
    result.currentActivity = "Recomputing default ADP snapshots";
    recomputeOverallPct(result);
    try {
      console.log("[NetworkCrawl] refreshing default ADP snapshots…");
      const snap = await refreshDefaultSnapshots();
      console.log(`[NetworkCrawl] snapshot refresh: ${snap.combos} combos, ${snap.rows} rows`);
    } catch (err: any) {
      result.errors.push(`snapshot refresh failed: ${err?.message ?? "unknown"}`);
    }
  }

  result.durationMs = Date.now() - startedAt;
  console.log(
    `[NetworkCrawl] done in ${result.durationMs}ms — ` +
    `users=${result.usersProcessed} leagues=${result.leaguesProcessed} ` +
    `drafts=${result.draftsFound} ingested=${result.draftsIngested} ` +
    `picks=${result.picksIngested} dupSkipped=${result.duplicatesSkipped} ` +
    `notComplete=${result.notCompleteSkipped} catFiltered=${result.categoryFilteredSkipped} ` +
    `excluded=${result.excludedSkipped} errors=${result.errors.length} ` +
    `caps=${result.capsHit.join("|") || "none"} reqs=${result.requestCount}`
  );
  // When called from startCrawlInBackground the wrapper opens + finalizes
  // the log row (so it can mark "failed" / "partial" on a thrown error).
  // Standalone callers still get one terminal row written here so scripts
  // and tests don't lose their audit trail.
  if (!externalState) {
    const logId = await openCrawlLog(opts.seedUsername, result.seasons, result.maxDepth);
    const finalStatus: CrawlLogStatus =
      result.errors.length > 0 && result.draftsIngested > 0 ? "partial"
      : result.errors.length > 0 ? "failed"
      : "completed";
    await finalizeCrawlLog(logId, result, finalStatus);
  }
  return result;
}
