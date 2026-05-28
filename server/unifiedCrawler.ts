/**
 * Unified scheduled crawler — the single data-gathering engine for BOTH the
 * Trade Database and the ADP Explorer.
 *
 * Each run:
 *   1. Picks ONE random seed Sleeper user from the eligible pool — anyone who
 *      entered their username into the tool (sc_connected_accounts +
 *      adp_user_crawl_events) OR a league-mate of such a user (crawled_users,
 *      which we keep growing via depth-1 discovery below).
 *   2. Runs a depth-1 crawl from that seed: the seed's own leagues (depth 0)
 *      plus the leagues of every co-member of those leagues (depth 1), across
 *      the 2023–2026 seasons. Discovered members are recorded into
 *      crawled_users so they become eligible seeds on future runs.
 *   3. Caps each run at a randomized 800–1200 unique leagues.
 *   4. For each newly-discovered league, ingests:
 *        • trades from the last 30 days  (ingestLeagueTrades, sinceMs)
 *        • startup + rookie drafts       (ingestLeagueDrafts; the April-2023
 *          floor is enforced by only fetching seasons >= 2023)
 *      Already-indexed leagues are skipped cheaply (crawled_leagues marker),
 *      so existing trade/draft data is preserved and never re-fetched.
 *   5. Re-schedules itself every randomized 30–60 minutes.
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { desc, eq, sql } from "drizzle-orm";
import { unifiedCrawlRuns } from "@shared/schema";
import {
  ingestLeagueTrades,
  deriveFormat,
  deriveScoringFormat,
  discoverUser,
} from "./tradeCrawler";
import { ingestLeagueDrafts } from "./adp";

const SLEEPER_API = "https://api.sleeper.app/v1";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ── Tunables ───────────────────────────────────────────────────────────────
// Drafts can go back to April 2023, so we fetch leagues for the 2023–2026
// seasons. (Each Sleeper season is a distinct league_id.)
const SEASONS = ["2026", "2025", "2024", "2023"];
const TRADE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // last 30 days only

// Per-run league cap varies between 800 and 1200.
const MIN_LEAGUES = 800;
const MAX_LEAGUES = 1200;

// Auto-run cadence varies between 30 and 60 minutes.
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;

// Short delay after boot before the first run, so startup isn't blocked.
const FIRST_RUN_DELAY_MS = 60 * 1000;

const RATE_LIMIT_MS = 500;

// ── small helpers ────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Inclusive random integer in [min, max]. */
function randInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface SleeperLeagueInfo {
  league_id: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: { rec?: number; [key: string]: any };
  settings: any;
}

interface SleeperUserInfo {
  user_id: string;
  display_name: string | null;
  username: string | null;
}

interface LeagueMeta {
  leagueId: string;
  season: string;
  format: string;
  scoringFormat: string;
  teamCount: number;
  bestBall: boolean;
}

// ── seed selection ───────────────────────────────────────────────────────────
/**
 * Pick one random Sleeper user_id from the union of: users who entered their
 * username (authed connect + read-only connect) and users discovered as their
 * league-mates. Returns null if the pool is empty.
 */
export async function pickSeedUser(): Promise<{ userId: string; username: string | null } | null> {
  const result = await db.execute(sql`
    SELECT user_id FROM (
      SELECT sleeper_user_id AS user_id FROM sc_connected_accounts WHERE sleeper_user_id IS NOT NULL
      UNION
      SELECT sleeper_user_id AS user_id FROM adp_user_crawl_events WHERE sleeper_user_id IS NOT NULL
      UNION
      SELECT id AS user_id FROM crawled_users
    ) pool
    ORDER BY random()
    LIMIT 1
  `);
  const userId = (result.rows[0] as any)?.user_id as string | undefined;
  if (!userId) return null;

  // Best-effort username for the run log (Sleeper resolves /user/{id} too).
  const user = await fetchJson<SleeperUserInfo>(`${SLEEPER_API}/user/${userId}`);
  return { userId, username: user?.username ?? user?.display_name ?? null };
}

// ── league discovery (depth-1) ───────────────────────────────────────────────
/** Fetch a single user's dynasty leagues across all crawl seasons. */
async function fetchUserLeagues(userId: string): Promise<SleeperLeagueInfo[]> {
  const out: SleeperLeagueInfo[] = [];
  for (const season of SEASONS) {
    await sleep(RATE_LIMIT_MS);
    const leagues = await fetchJson<SleeperLeagueInfo[]>(
      `${SLEEPER_API}/user/${userId}/leagues/nfl/${season}`,
    );
    if (!leagues) continue;
    for (const lg of leagues) {
      if (lg.settings?.type === 2) out.push(lg); // dynasty only
    }
  }
  return out;
}

function toMeta(lg: SleeperLeagueInfo): LeagueMeta {
  return {
    leagueId: lg.league_id,
    season: lg.season,
    format: deriveFormat(lg.roster_positions || []),
    scoringFormat: deriveScoringFormat(lg.scoring_settings || {}),
    teamCount: lg.total_rosters || 12,
    bestBall: lg.settings?.best_ball === 1,
  };
}

/**
 * Depth-1 crawl from the seed user. Collects unique dynasty leagues up to `cap`,
 * recording every co-member into crawled_users along the way. Returns the league
 * list plus a count of newly-discovered members.
 */
async function discoverDepth1Leagues(
  seedUserId: string,
  cap: number,
): Promise<{ leagues: LeagueMeta[]; membersDiscovered: number }> {
  const leagueMap = new Map<string, LeagueMeta>();
  let membersDiscovered = 0;

  const addLeagues = (list: SleeperLeagueInfo[]) => {
    for (const lg of list) {
      if (leagueMap.size >= cap) return;
      if (!leagueMap.has(lg.league_id)) leagueMap.set(lg.league_id, toMeta(lg));
    }
  };

  // Depth 0 — the seed user's own leagues.
  const seedLeagues = await fetchUserLeagues(seedUserId);
  addLeagues(seedLeagues);

  // Depth 1 — every co-member of those leagues, then each member's leagues.
  const memberIds = new Set<string>();
  for (const lg of seedLeagues) {
    if (leagueMap.size >= cap) break;
    await sleep(RATE_LIMIT_MS);
    const users = await fetchJson<SleeperUserInfo[]>(`${SLEEPER_API}/league/${lg.league_id}/users`);
    if (!users) continue;
    for (const u of users) {
      if (u.user_id === seedUserId) continue;
      if (memberIds.has(u.user_id)) continue;
      memberIds.add(u.user_id);
      // Record the member so they become an eligible seed on future runs.
      const isNew = await discoverUser(u.user_id, u.username, u.display_name);
      if (isNew) membersDiscovered++;
    }
  }

  for (const memberId of memberIds) {
    if (leagueMap.size >= cap) break;
    const memberLeagues = await fetchUserLeagues(memberId);
    addLeagues(memberLeagues);
  }

  return { leagues: [...leagueMap.values()], membersDiscovered };
}

// ── one crawl run ─────────────────────────────────────────────────────────────
let isRunning = false;

export async function runOnce(): Promise<{ ran: boolean; reason?: string }> {
  if (isRunning) return { ran: false, reason: "already-running" };
  isRunning = true;

  const cap = randInt(MIN_LEAGUES, MAX_LEAGUES);
  const [runRow] = await db
    .insert(unifiedCrawlRuns)
    .values({ status: "running", leagueCapTarget: cap })
    .returning({ id: unifiedCrawlRuns.id });
  const runId = runRow.id;

  try {
    const seed = await pickSeedUser();
    if (!seed) {
      await db
        .update(unifiedCrawlRuns)
        .set({ status: "skipped", message: "no eligible seed users", completedAt: new Date() })
        .where(eq(unifiedCrawlRuns.id, runId));
      console.log("[UnifiedCrawl] No eligible seed users — skipping run.");
      return { ran: false, reason: "no-seed" };
    }

    console.log(`[UnifiedCrawl] Run ${runId}: seed=${seed.username ?? seed.userId}, cap=${cap}`);
    await db
      .update(unifiedCrawlRuns)
      .set({ seedUserId: seed.userId, seedUsername: seed.username })
      .where(eq(unifiedCrawlRuns.id, runId));

    const { leagues, membersDiscovered } = await discoverDepth1Leagues(seed.userId, cap);
    console.log(
      `[UnifiedCrawl] Run ${runId}: discovered ${leagues.length} leagues, ${membersDiscovered} new members`,
    );
    await db
      .update(unifiedCrawlRuns)
      .set({ leaguesDiscovered: leagues.length, membersDiscovered })
      .where(eq(unifiedCrawlRuns.id, runId));

    const sinceMs = Date.now() - TRADE_WINDOW_MS;
    let scanned = 0;
    let tradesInserted = 0;
    let draftsIngested = 0;

    for (const lg of leagues) {
      try {
        const tradeRes = await ingestLeagueTrades({
          leagueId: lg.leagueId,
          season: lg.season,
          teamCount: lg.teamCount,
          format: lg.format,
          scoringFormat: lg.scoringFormat,
          bestBall: lg.bestBall,
          sinceMs,
        });

        // Only a newly-indexed league does fresh work; pull its drafts too.
        if (!tradeRes.alreadyIndexed) {
          scanned++;
          tradesInserted += tradeRes.inserted;
          const draftRes = await ingestLeagueDrafts(lg.leagueId);
          draftsIngested += draftRes.completed;
        }
      } catch (err: any) {
        console.error(`[UnifiedCrawl] Run ${runId}: league ${lg.leagueId} failed:`, err?.message);
      }
    }

    await db
      .update(unifiedCrawlRuns)
      .set({
        status: "complete",
        leaguesScanned: scanned,
        tradesInserted,
        draftsIngested,
        completedAt: new Date(),
        message: `scanned ${scanned} new leagues; +${tradesInserted} trades, +${draftsIngested} drafts`,
      })
      .where(eq(unifiedCrawlRuns.id, runId));

    console.log(
      `[UnifiedCrawl] Run ${runId} complete — ${scanned} new leagues, +${tradesInserted} trades, +${draftsIngested} drafts`,
    );
    return { ran: true };
  } catch (err: any) {
    await db
      .update(unifiedCrawlRuns)
      .set({ status: "failed", message: err?.message ?? "unknown error", completedAt: new Date() })
      .where(eq(unifiedCrawlRuns.id, runId));
    console.error(`[UnifiedCrawl] Run ${runId} failed:`, err?.message);
    return { ran: false, reason: "error" };
  } finally {
    isRunning = false;
  }
}

// ── scheduler ─────────────────────────────────────────────────────────────────
let timer: NodeJS.Timeout | null = null;

function scheduleNext() {
  const delay = randInt(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  console.log(`[UnifiedCrawl] Next run in ~${Math.round(delay / 60000)}m`);
  timer = setTimeout(() => {
    runOnce()
      .catch((err) => console.error("[UnifiedCrawl] Scheduled run errored:", err))
      .finally(scheduleNext);
  }, delay);
  if (timer.unref) timer.unref();
}

export function startUnifiedCrawler() {
  if (timer) return;
  console.log("[UnifiedCrawl] Scheduler started");
  timer = setTimeout(() => {
    runOnce()
      .catch((err) => console.error("[UnifiedCrawl] Initial run errored:", err))
      .finally(scheduleNext);
  }, FIRST_RUN_DELAY_MS);
  if (timer.unref) timer.unref();
}

export function stopUnifiedCrawler() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function isUnifiedCrawlRunning() {
  return isRunning;
}

/** Most-recent crawl runs for the admin status endpoint. */
export async function getRecentRuns(limit = 20) {
  return db
    .select()
    .from(unifiedCrawlRuns)
    .orderBy(desc(unifiedCrawlRuns.startedAt))
    .limit(limit);
}
