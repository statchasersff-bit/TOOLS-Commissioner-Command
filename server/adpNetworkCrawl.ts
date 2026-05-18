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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  errors: string[];
  capsHit: string[];
  requestCount: number;
  durationMs: number;
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

async function writeCrawlLog(result: NetworkCrawlResult, status: "completed" | "failed"): Promise<void> {
  try {
    const message =
      `seed=${result.seedUser?.username ?? "(unresolved)"} ` +
      `depth=${result.maxDepth} ` +
      `seasons=${result.seasons.join(",")} ` +
      `users=${result.usersProcessed} leagues=${result.leaguesProcessed} ` +
      `dupSkipped=${result.duplicatesSkipped} ` +
      `caps=${result.capsHit.join("|") || "none"} ` +
      `errors=${result.errors.length} ` +
      `reqs=${result.requestCount}`;
    await db.insert(adpCrawlLog).values({
      jobType: "network-crawl",
      status,
      message,
      draftsFound: result.draftsFound,
      draftsIngested: result.draftsIngested,
      picksIngested: result.picksIngested,
      completedAt: new Date(),
    });
  } catch (err: any) {
    console.error("[NetworkCrawl] failed to write log row:", err?.message);
  }
}

// ── Main orchestrator ───────────────────────────────────────────────────────

export async function runNetworkCrawl(opts: NetworkCrawlOpts): Promise<NetworkCrawlResult> {
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

  const result: NetworkCrawlResult = {
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
    errors: [],
    capsHit: [],
    requestCount: 0,
    durationMs: 0,
  };

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

  // ── Resolve seed user ──────────────────────────────────────────────────
  result.requestCount++;
  const seed = await resolveSleeperUsername(opts.seedUsername);
  if (!seed) {
    result.errors.push(`Seed username "${opts.seedUsername}" did not resolve.`);
    result.durationMs = Date.now() - startedAt;
    await writeCrawlLog(result, "failed");
    return result;
  }
  result.seedUser = seed;
  console.log(`[NetworkCrawl] seed resolved: ${seed.username} (${seed.userId}) — depth ${maxDepth}, seasons ${seasons.join(",")}`);

  // BFS by depth.
  let currentDepth: Set<string> = new Set([seed.userId]);
  result.usersDiscoveredByDepth[0] = 1;

  for (let depth = 0; depth <= maxDepth; depth++) {
    const nextDepth = new Set<string>();
    const depthSize = currentDepth.size;
    console.log(`[NetworkCrawl] depth ${depth}: ${depthSize} candidate users`);

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
      if (requestCapHit()) { depthCapped = true; break; }

      processedUsers.add(userId);
      result.usersProcessed++;

      for (const season of seasons) {
        if (depthCapped) break;
        if (requestCapHit()) { depthCapped = true; break; }

        result.requestCount++;
        const leagues = await fetchUserLeagues(userId, season);
        if (!leagues || leagues.length === 0) continue;

        for (const lg of leagues) {
          if (depthCapped) break;
          if (!lg.league_id) continue;
          if (processedLeagues.has(lg.league_id)) continue;
          if (result.leaguesProcessed >= caps.maxLeagues) {
            result.capsHit.push("maxLeagues");
            console.warn(`[NetworkCrawl] Crawl capped for safety. (maxLeagues=${caps.maxLeagues})`);
            depthCapped = true;
            break;
          }
          processedLeagues.add(lg.league_id);
          result.leaguesProcessed++;

          // ── 1) Ingest drafts for this league ─────────────────────────────
          if (requestCapHit()) { depthCapped = true; break; }
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
                if (!categoryFilter.has(cat)) continue;
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
                } else if (!r.ok && r.reason) {
                  result.errors.push(`draft ${d.draft_id}: ${r.reason}`);
                }
              } catch (err: any) {
                result.errors.push(`draft ${d.draft_id} threw: ${err?.message ?? "unknown"}`);
              }
              if (requestCapHit()) { depthCapped = true; break; }
            }
          }

          // ── 2) Discover next-depth users (only when we have room) ────────
          if (depth < maxDepth && !depthCapped) {
            if (requestCapHit()) { depthCapped = true; break; }
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
    `caps=${result.capsHit.join("|") || "none"} reqs=${result.requestCount}`
  );
  await writeCrawlLog(result, "completed");
  return result;
}
