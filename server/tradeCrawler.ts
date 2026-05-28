import { eq, and, sql, asc, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  crawledLeagues,
  crawledUsers,
  trades,
  tradeAssets,
  crawlState,
  crawlQueue,
} from "@shared/schema";
import { getSleeperPlayers } from "./sleeper";

const SLEEPER_API = "https://api.sleeper.app/v1";
const RATE_LIMIT_MS = 500;
const MAX_SEASONS_BACK = 5;

let db: ReturnType<typeof drizzle> | null = null;
let isProcessing = false;

function getDb() {
  if (!db) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool);
  }
  return db;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

interface SleeperDraftInfo {
  draft_id: string;
  season: string;
  type: string;
  settings?: { rounds?: number; [key: string]: any };
  slot_to_roster_id?: Record<string, number>;
}

interface SleeperDraftPick {
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: number;
  player_id: string | null;
}

/**
 * Startup drafts have many rounds (one per roster slot, typically 14-20).
 * Rookie/supplemental drafts have few rounds (typically 3-5).
 */
function isStartupDraft(draft: SleeperDraftInfo): boolean {
  const rounds = draft.settings?.rounds ?? 0;
  return rounds > 7;
}

/**
 * Returns slot map and season draft classification for a league.
 * "startup-only"  → only a startup draft exists for that season; skip those picks
 * "has-rookie"    → rookie/supplemental draft exists; picks are meaningful trade assets
 * "unknown"       → no drafts found or cannot determine
 */
async function fetchLeagueDraftInfo(leagueId: string, season: string): Promise<{
  slotMap: Map<number, number>;
  seasonDraftType: "startup-only" | "has-rookie" | "unknown";
}> {
  const slotMap = new Map<number, number>();
  let seasonDraftType: "startup-only" | "has-rookie" | "unknown" = "unknown";
  try {
    const drafts = await fetchJson<SleeperDraftInfo[]>(`${SLEEPER_API}/league/${leagueId}/drafts`);
    if (!drafts?.length) return { slotMap, seasonDraftType };

    const seasonDrafts = drafts.filter((d) => d.season === season);
    const hasRookie = seasonDrafts.some((d) => !isStartupDraft(d));
    const hasStartup = seasonDrafts.some((d) => isStartupDraft(d));

    if (hasRookie) seasonDraftType = "has-rookie";
    else if (hasStartup) seasonDraftType = "startup-only";

    // Use the rookie draft for slot mapping; fall back to whichever draft exists
    const rookieDraft = seasonDrafts.find((d) => !isStartupDraft(d)) ?? seasonDrafts[0];
    if (!rookieDraft) return { slotMap, seasonDraftType };

    // Primary: slot_to_roster_id from the draft detail (populated when draft order is set)
    const detail = await fetchJson<SleeperDraftInfo>(`${SLEEPER_API}/draft/${rookieDraft.draft_id}`);
    if (detail?.slot_to_roster_id) {
      for (const [slot, rosterId] of Object.entries(detail.slot_to_roster_id)) {
        slotMap.set(rosterId, parseInt(slot, 10));
      }
    }

    // Fallback: /draft/{id}/picks endpoint — covers drafts in progress or complete
    // where slot_to_roster_id might not be present but pick-level draft_slot is available.
    if (slotMap.size === 0) {
      const picks = await fetchJson<SleeperDraftPick[]>(`${SLEEPER_API}/draft/${rookieDraft.draft_id}/picks`);
      if (picks?.length) {
        for (const pick of picks) {
          if (pick.roster_id && pick.draft_slot) {
            // draft_slot is constant per roster_id in linear dynasty drafts
            slotMap.set(pick.roster_id, pick.draft_slot);
          }
        }
      }
    }
  } catch {
    // silently skip — pick will just show round without slot
  }
  return { slotMap, seasonDraftType };
}

interface SleeperTransactionRaw {
  transaction_id: string;
  type: string;
  status: string;
  status_updated: number;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: Array<{
    season: string;
    round: number;
    roster_id: number;
    previous_owner_id: number;
    owner_id: number;
  }> | null;
  leg: number;
  consenter_ids: number[] | null;
}

interface SleeperLeagueInfo {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: { rec?: number; [key: string]: any };
  previous_league_id: string | null;
  status: string;
  settings: any;
}

interface SleeperRosterInfo {
  roster_id: number;
  owner_id: string | null;
  players: string[];
}

interface SleeperUserInfo {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar: string | null;
  metadata?: { team_name?: string };
}

function deriveFormat(rosterPositions: string[]): string {
  return rosterPositions?.includes("SUPER_FLEX") ? "SF" : "1QB";
}

function deriveScoringFormat(scoringSettings: { rec?: number }): string {
  const rec = scoringSettings?.rec ?? 0;
  if (rec === 1) return "PPR";
  if (rec === 0.5) return "Half";
  return "Standard";
}

async function getOrCreateCrawlState() {
  const d = getDb();
  const existing = await d.select().from(crawlState).limit(1);
  if (existing.length > 0) return existing[0];

  const [created] = await d
    .insert(crawlState)
    .values({ status: "idle", currentDegree: 0, maxDegree: 4 })
    .returning();
  return created;
}

async function updateCrawlState(updates: Partial<{
  status: string;
  seedUsername: string;
  currentDegree: number;
  leaguesDiscovered: number;
  leaguesCrawled: number;
  tradesCollected: number;
  usersDiscovered: number;
  startedAt: Date;
  errorLog: string | null;
}>) {
  const d = getDb();
  const state = await getOrCreateCrawlState();
  await d
    .update(crawlState)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(crawlState.id, state.id));
}

async function incrementCrawlStats(field: "leaguesCrawled" | "tradesCollected" | "usersDiscovered" | "leaguesDiscovered", amount: number = 1) {
  const d = getDb();
  const state = await getOrCreateCrawlState();
  const fieldMap = {
    leaguesCrawled: crawlState.leaguesCrawled,
    tradesCollected: crawlState.tradesCollected,
    usersDiscovered: crawlState.usersDiscovered,
    leaguesDiscovered: crawlState.leaguesDiscovered,
  };
  await d
    .update(crawlState)
    .set({
      [field]: sql`${fieldMap[field]} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(crawlState.id, state.id));
}

async function discoverUser(userId: string, username: string | null, displayName: string | null) {
  const d = getDb();
  const existing = await d.select().from(crawledUsers).where(eq(crawledUsers.id, userId)).limit(1);
  if (existing.length > 0) return false;
  await d.insert(crawledUsers).values({
    id: userId,
    username: username,
    displayName: displayName,
  });
  await incrementCrawlStats("usersDiscovered");
  return true;
}

async function queueLeague(leagueId: string, degree: number) {
  const d = getDb();
  const existingLeague = await d.select().from(crawledLeagues).where(eq(crawledLeagues.id, leagueId)).limit(1);
  if (existingLeague.length > 0) return false;
  const existingQueue = await d.select().from(crawlQueue).where(eq(crawlQueue.leagueId, leagueId)).limit(1);
  if (existingQueue.length > 0) return false;
  await d.insert(crawlQueue).values({ leagueId, degree, status: "pending" });
  await incrementCrawlStats("leaguesDiscovered");
  return true;
}

async function fetchLeagueChain(startLeagueId: string): Promise<SleeperLeagueInfo[]> {
  const chain: SleeperLeagueInfo[] = [];
  let currentId: string | null = startLeagueId;

  while (currentId && chain.length < MAX_SEASONS_BACK) {
    await sleep(RATE_LIMIT_MS);
    const info = await fetchJson<SleeperLeagueInfo>(`${SLEEPER_API}/league/${currentId}`);
    if (!info) break;
    chain.push(info);
    currentId = info.previous_league_id;
  }

  return chain;
}

async function fetchLeagueTransactions(leagueId: string): Promise<SleeperTransactionRaw[]> {
  const allTrades: SleeperTransactionRaw[] = [];

  const roundPromises = [];
  for (let round = 1; round <= 18; round++) {
    roundPromises.push(
      sleep(RATE_LIMIT_MS * round).then(() =>
        fetchJson<SleeperTransactionRaw[]>(`${SLEEPER_API}/league/${leagueId}/transactions/${round}`)
      )
    );
  }

  const results = await Promise.all(roundPromises);
  for (const data of results) {
    if (!data) continue;
    const completedTrades = data.filter(
      (t) => t.type === "trade" && t.status === "complete"
    );
    allTrades.push(...completedTrades);
  }

  return allTrades;
}

async function processLeague(leagueId: string, degree: number) {
  const d = getDb();
  const playersDb = await getSleeperPlayers();

  const leagueChain = await fetchLeagueChain(leagueId);
  if (leagueChain.length === 0) {
    console.log(`[Crawler] Empty league chain for ${leagueId}, skipping`);
    await incrementCrawlStats("leaguesCrawled");
    return;
  }

  const primaryLeague = leagueChain[0];

  await sleep(RATE_LIMIT_MS);
  const usersRaw = await fetchJson<SleeperUserInfo[]>(`${SLEEPER_API}/league/${leagueId}/users`);
  await sleep(RATE_LIMIT_MS);
  const rostersRaw = await fetchJson<SleeperRosterInfo[]>(`${SLEEPER_API}/league/${leagueId}/rosters`);

  const rosterOwnerMap = new Map<number, { ownerId: string; ownerName: string; teamName: string }>();
  if (usersRaw && rostersRaw) {
    const usersMap = new Map<string, SleeperUserInfo>();
    for (const u of usersRaw) {
      usersMap.set(u.user_id, u);
    }
    for (const r of rostersRaw) {
      if (!r.owner_id) continue;
      const user = usersMap.get(r.owner_id);
      rosterOwnerMap.set(r.roster_id, {
        ownerId: r.owner_id,
        ownerName: user?.display_name || user?.username || "Unknown",
        teamName: user?.metadata?.team_name || user?.display_name || user?.username || "Unknown",
      });
    }

    for (const r of rostersRaw) {
      if (!r.owner_id) continue;
      const user = usersMap.get(r.owner_id);
      await discoverUser(r.owner_id, user?.username || null, user?.display_name || null);
    }
  }

  const format = deriveFormat(primaryLeague.roster_positions || []);
  const scoringFormat = deriveScoringFormat(primaryLeague.scoring_settings || {});
  const bestBall = primaryLeague.settings?.best_ball === 1;

  for (const leagueInfo of leagueChain) {
    const existingLeague = await d.select().from(crawledLeagues).where(eq(crawledLeagues.id, leagueInfo.league_id)).limit(1);
    if (existingLeague.length > 0) continue;

    console.log(`[Crawler] Fetching trades for league ${leagueInfo.name} (${leagueInfo.season})`);

    const leagueTrades = await fetchLeagueTransactions(leagueInfo.league_id);
    const { slotMap: draftSlots, seasonDraftType } = await fetchLeagueDraftInfo(leagueInfo.league_id, leagueInfo.season);

    await d.insert(crawledLeagues).values({
      id: leagueInfo.league_id,
      name: leagueInfo.name || "Unknown",
      season: leagueInfo.season,
      totalRosters: leagueInfo.total_rosters || 0,
      format,
      scoringFormat,
      rosterPositions: leagueInfo.roster_positions || [],
      previousLeagueId: leagueInfo.previous_league_id,
      tradeCount: leagueTrades.length,
    }).onConflictDoNothing();

    for (const trade of leagueTrades) {
      const rosterIds = trade.roster_ids || [];
      // Must have at least 2 parties — empty roster_ids slips past .some() checks
      if (rosterIds.length < 2) continue;

      const insertedTrade = await d.insert(trades).values({
        id: trade.transaction_id,
        leagueId: leagueInfo.league_id,
        season: leagueInfo.season,
        week: trade.leg || 0,
        timestamp: trade.status_updated || Date.now(),
        rosterIds: trade.roster_ids || [],
        status: trade.status,
        leagueName: leagueInfo.name,
        leagueFormat: format,
        leagueScoringFormat: scoringFormat,
        leagueTotalRosters: leagueInfo.total_rosters || 0,
        bestBall,
      }).onConflictDoNothing().returning({ id: trades.id });

      // If no row was returned, this trade already exists — skip asset insertion
      if (insertedTrade.length === 0) continue;

      const assetRows: Array<typeof tradeAssets.$inferInsert> = [];
      const involvedRosters = new Set(trade.roster_ids || []);

      if (trade.adds) {
        for (const [playerId, rosterId] of Object.entries(trade.adds)) {
          const player = playersDb[playerId];
          const rosterInfo = rosterOwnerMap.get(rosterId);
          assetRows.push({
            tradeId: trade.transaction_id,
            rosterId,
            rosterOwnerName: rosterInfo?.ownerName || null,
            rosterTeamName: rosterInfo?.teamName || null,
            assetType: "player",
            playerSleeperId: playerId,
            playerName: player?.full_name || `Player ${playerId}`,
            playerPos: player?.position || null,
            playerTeam: player?.team || null,
            playerAge: player?.age || null,
            direction: "received",
          });
        }
      }

      if (trade.drops) {
        for (const [playerId, rosterId] of Object.entries(trade.drops)) {
          if (!involvedRosters.has(rosterId)) continue;
          const player = playersDb[playerId];
          const rosterInfo = rosterOwnerMap.get(rosterId);
          assetRows.push({
            tradeId: trade.transaction_id,
            rosterId,
            rosterOwnerName: rosterInfo?.ownerName || null,
            rosterTeamName: rosterInfo?.teamName || null,
            assetType: "player",
            playerSleeperId: playerId,
            playerName: player?.full_name || `Player ${playerId}`,
            playerPos: player?.position || null,
            playerTeam: player?.team || null,
            playerAge: player?.age || null,
            direction: "sent",
          });
        }
      }

      if (trade.draft_picks) {
        for (const pick of trade.draft_picks) {
          if (!pick.owner_id || !pick.previous_owner_id) continue;
          // Skip picks beyond round 5 (invalid/junk data)
          if (pick.round > 5) continue;
          // Skip picks that belong to a startup-only draft context (no rookie draft exists)
          if (pick.season === leagueInfo.season && seasonDraftType === "startup-only") continue;
          const receiverInfo = rosterOwnerMap.get(pick.owner_id);
          const originalOwnerInfo = rosterOwnerMap.get(pick.roster_id);
          // Only assign a known slot when the pick is for the current league season.
          // Future-year picks (e.g. 2027 in a 2025 league) have no determined draft
          // order yet — storing the current year's slot would be misleading.
          const slot = pick.season === leagueInfo.season
            ? (draftSlots.get(pick.roster_id) ?? null)
            : null;
          // Classify the pick: current-season picks inherit league classification,
          // future-year picks are always rookie picks.
          const pickDraftType: string = pick.season === leagueInfo.season
            ? (seasonDraftType === "has-rookie" ? "rookie" : "unknown")
            : "rookie";

          assetRows.push({
            tradeId: trade.transaction_id,
            rosterId: pick.owner_id,
            rosterOwnerName: receiverInfo?.ownerName || null,
            rosterTeamName: receiverInfo?.teamName || null,
            assetType: "pick",
            pickSeason: pick.season,
            pickRound: pick.round,
            pickSlot: slot,
            pickOriginalRosterId: pick.roster_id,
            pickOriginalOwnerName: originalOwnerInfo?.ownerName || null,
            pickDraftType,
            direction: "received",
          });

          assetRows.push({
            tradeId: trade.transaction_id,
            rosterId: pick.previous_owner_id,
            rosterOwnerName: rosterOwnerMap.get(pick.previous_owner_id)?.ownerName || null,
            rosterTeamName: rosterOwnerMap.get(pick.previous_owner_id)?.teamName || null,
            assetType: "pick",
            pickSeason: pick.season,
            pickRound: pick.round,
            pickSlot: slot,
            pickOriginalRosterId: pick.roster_id,
            pickOriginalOwnerName: originalOwnerInfo?.ownerName || null,
            pickDraftType,
            direction: "sent",
          });
        }
      }

      // Final check: every roster must have received at least one asset.
      // If any startup picks or junk got stripped, the trade could end up empty.
      const receivedRosterIds = new Set(
        assetRows.filter((a) => a.direction === "received").map((a) => a.rosterId)
      );
      if (assetRows.length === 0 || rosterIds.some((rid) => !receivedRosterIds.has(rid))) {
        await d.delete(trades).where(eq(trades.id, trade.transaction_id));
        continue;
      }

      await d.insert(tradeAssets).values(assetRows);
      await incrementCrawlStats("tradesCollected");
    }

    if (leagueTrades.length > 0) {
      console.log(`[Crawler] Found ${leagueTrades.length} trades in ${leagueInfo.name} (${leagueInfo.season})`);
    }
  }

  await incrementCrawlStats("leaguesCrawled");
}

async function discoverUserLeagues(userId: string, degree: number, maxDegree: number) {
  if (degree >= maxDegree) return;

  const d = getDb();
  const user = await d.select().from(crawledUsers).where(eq(crawledUsers.id, userId)).limit(1);
  if (user.length > 0 && user[0].leaguesCrawled) return;

  const seasons = ["2025", "2024", "2023"];
  let leaguesFound = 0;

  for (const season of seasons) {
    await sleep(RATE_LIMIT_MS);
    const leagues = await fetchJson<SleeperLeagueInfo[]>(
      `${SLEEPER_API}/user/${userId}/leagues/nfl/${season}`
    );
    if (!leagues || !Array.isArray(leagues)) continue;

    const dynastyLeagues = leagues.filter(
      (lg) => lg.settings?.type === 2
    );

    for (const lg of dynastyLeagues) {
      const queued = await queueLeague(lg.league_id, degree + 1);
      if (queued) leaguesFound++;
    }
  }

  await d
    .update(crawledUsers)
    .set({ leaguesCrawled: true })
    .where(eq(crawledUsers.id, userId));

  if (leaguesFound > 0) {
    console.log(`[Crawler] Discovered ${leaguesFound} new leagues from user ${userId} at degree ${degree + 1}`);
  }
}

async function processCrawlQueue() {
  if (isProcessing) return;
  isProcessing = true;

  const d = getDb();

  try {
    while (true) {
      const state = await getOrCreateCrawlState();
      if (state.status !== "running") {
        console.log(`[Crawler] Stopping - status is ${state.status}`);
        break;
      }

      const [nextItem] = await d
        .select()
        .from(crawlQueue)
        .where(eq(crawlQueue.status, "pending"))
        .orderBy(asc(crawlQueue.degree), asc(crawlQueue.id))
        .limit(1);

      if (!nextItem) {
        console.log("[Crawler] Queue empty - crawl complete");
        await updateCrawlState({ status: "completed" });
        break;
      }

      await updateCrawlState({ currentDegree: nextItem.degree });

      await d
        .update(crawlQueue)
        .set({ status: "processing" })
        .where(eq(crawlQueue.id, nextItem.id));

      try {
        await processLeague(nextItem.leagueId, nextItem.degree);

        await d
          .update(crawlQueue)
          .set({ status: "done" })
          .where(eq(crawlQueue.id, nextItem.id));

        const usersToExpand = await d
          .select()
          .from(crawledUsers)
          .where(eq(crawledUsers.leaguesCrawled, false))
          .limit(20);

        for (const user of usersToExpand) {
          const freshState = await getOrCreateCrawlState();
          if (freshState.status !== "running") break;
          await discoverUserLeagues(user.id, nextItem.degree, freshState.maxDegree);
        }
      } catch (err: any) {
        console.error(`[Crawler] Error processing league ${nextItem.leagueId}:`, err.message);
        await d
          .update(crawlQueue)
          .set({ status: "failed" })
          .where(eq(crawlQueue.id, nextItem.id));
      }
    }
  } finally {
    isProcessing = false;
  }
}

export async function startCrawl(seedUsername: string) {
  const d = getDb();

  const currentState = await getOrCreateCrawlState();
  if (currentState.status === "running") {
    throw new Error("Crawler is already running. Pause it first before starting a new crawl.");
  }

  await d.update(crawlState).set({
    leaguesDiscovered: 0,
    leaguesCrawled: 0,
    tradesCollected: 0,
    usersDiscovered: 0,
    currentDegree: 0,
    errorLog: null,
  }).where(eq(crawlState.id, currentState.id));

  await d.delete(crawlQueue).where(sql`1=1`);

  const userRes = await fetch(`${SLEEPER_API}/user/${seedUsername}`);
  if (!userRes.ok) throw new Error("Sleeper user not found");
  const userData = (await userRes.json()) as { user_id: string; username: string; display_name: string };

  await discoverUser(userData.user_id, userData.username, userData.display_name);

  const seasons = ["2025", "2024", "2023"];
  for (const season of seasons) {
    const leagues = await fetchJson<SleeperLeagueInfo[]>(
      `${SLEEPER_API}/user/${userData.user_id}/leagues/nfl/${season}`
    );
    if (!leagues || !Array.isArray(leagues)) continue;

    const dynastyLeagues = leagues.filter(
      (lg) => lg.settings?.type === 2
    );

    for (const lg of dynastyLeagues) {
      await queueLeague(lg.league_id, 0);
    }
  }

  await d
    .update(crawledUsers)
    .set({ leaguesCrawled: true })
    .where(eq(crawledUsers.id, userData.user_id));

  await updateCrawlState({
    status: "running",
    seedUsername,
    currentDegree: 0,
    startedAt: new Date(),
    errorLog: null,
  });

  console.log(`[Crawler] Starting crawl from user ${seedUsername}`);

  processCrawlQueue().catch((err) => {
    console.error("[Crawler] Fatal error:", err);
    updateCrawlState({ status: "paused", errorLog: err.message });
  });

  return getCrawlStatus();
}

export async function pauseCrawl() {
  await updateCrawlState({ status: "paused" });
  return getCrawlStatus();
}

export async function resumeCrawl() {
  await updateCrawlState({ status: "running" });

  processCrawlQueue().catch((err) => {
    console.error("[Crawler] Fatal error:", err);
    updateCrawlState({ status: "paused", errorLog: err.message });
  });

  return getCrawlStatus();
}

export async function getCrawlStatus() {
  const state = await getOrCreateCrawlState();
  return {
    status: state.status,
    seedUsername: state.seedUsername,
    currentDegree: state.currentDegree,
    maxDegree: state.maxDegree,
    leaguesDiscovered: state.leaguesDiscovered,
    leaguesCrawled: state.leaguesCrawled,
    tradesCollected: state.tradesCollected,
    usersDiscovered: state.usersDiscovered,
    startedAt: state.startedAt?.toISOString() || null,
    updatedAt: state.updatedAt?.toISOString() || null,
  };
}

export async function searchTrades(params: {
  q?: string;
  format?: string;
  scoring?: string;
  leagueSize?: number;
  season?: string;
  bestBall?: string;
  page?: number;
  limit?: number;
}) {
  const d = getDb();
  const page = params.page || 1;
  const limit = Math.min(params.limit || 50, 100);
  const offset = (page - 1) * limit;

  // All data quality filters (zero-side, invalid picks) are now applied at ingestion time.
  let conditions: any[] = [];

  if (params.format && params.format !== "all") {
    conditions.push(eq(trades.leagueFormat, params.format));
  }
  if (params.scoring && params.scoring !== "all") {
    conditions.push(eq(trades.leagueScoringFormat, params.scoring));
  }
  if (params.season && params.season !== "all") {
    conditions.push(eq(trades.season, params.season));
  }
  if (params.leagueSize && params.leagueSize > 0) {
    conditions.push(eq(trades.leagueTotalRosters, params.leagueSize));
  }
  if (params.bestBall === "yes") {
    conditions.push(eq(trades.bestBall, true));
  } else if (params.bestBall === "no") {
    conditions.push(eq(trades.bestBall, false));
  }

  let tradeIds: string[] | null = null;

  if (params.q && params.q.trim()) {
    const searchPattern = `%${params.q.trim()}%`;
    const matchingAssets = await d
      .select({ tradeId: tradeAssets.tradeId })
      .from(tradeAssets)
      .where(sql`${tradeAssets.playerName} ILIKE ${searchPattern} OR ${tradeAssets.rosterOwnerName} ILIKE ${searchPattern} OR ${tradeAssets.rosterTeamName} ILIKE ${searchPattern}`)
      .limit(500);

    tradeIds = [...new Set(matchingAssets.map((a) => a.tradeId))];
    if (tradeIds.length === 0) {
      return { trades: [], total: 0, page, limit };
    }
  }

  const allConditions = [...conditions];

  if (tradeIds) {
    allConditions.push(sql`${trades.id} IN (${sql.join(tradeIds.map(id => sql`${id}`), sql`, `)})`);
  }

  const whereClause = and(...allConditions);
  const hasFilters = allConditions.length > 0;

  // For the unfiltered default view use the blazing-fast pg_class estimate (2 ms).
  // For filtered queries run count + fetch in parallel to save ~100 ms.
  let totalCount: number;
  let tradeRows: (typeof trades.$inferSelect)[];

  if (!hasFilters) {
    const [approx, rows] = await Promise.all([
      d.execute(sql`SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'trades'`),
      d.select().from(trades).orderBy(sql`${trades.timestamp} DESC`).limit(limit).offset(offset),
    ]);
    totalCount = Number((approx.rows[0] as any)?.n ?? 0);
    tradeRows = rows;
  } else {
    const [countResult, rows] = await Promise.all([
      d.select({ total: count() }).from(trades).where(whereClause),
      d.select().from(trades).where(whereClause).orderBy(sql`${trades.timestamp} DESC`).limit(limit).offset(offset),
    ]);
    totalCount = Number(countResult[0]?.total ?? 0);
    tradeRows = rows;
  }

  if (tradeRows.length === 0) {
    return { trades: [], total: 0, page, limit };
  }

  const tradeRowIds = tradeRows.map((t) => t.id);
  const assets = await d
    .select()
    .from(tradeAssets)
    .where(sql`${tradeAssets.tradeId} IN (${sql.join(tradeRowIds.map(id => sql`${id}`), sql`, `)})`);

  const assetsByTrade = new Map<string, typeof assets>();
  for (const asset of assets) {
    const existing = assetsByTrade.get(asset.tradeId) || [];
    existing.push(asset);
    assetsByTrade.set(asset.tradeId, existing);
  }

  const enrichedTrades = tradeRows.map((trade) => {
    const tradeAssetList = assetsByTrade.get(trade.id) || [];
    const rosterIds = trade.rosterIds || [];

    const sides = rosterIds.map((rosterId) => {
      const rosterAssets = tradeAssetList.filter((a) => a.rosterId === rosterId);
      const received = rosterAssets.filter((a) => a.direction === "received");

      const firstAsset = rosterAssets[0];
      return {
        rosterId,
        teamName: firstAsset?.rosterTeamName || "",
        ownerName: firstAsset?.rosterOwnerName || "",
        playersReceived: received
          .filter((a) => a.assetType === "player")
          .map((a) => ({
            sleeperId: a.playerSleeperId || "",
            name: a.playerName || "Unknown",
            pos: a.playerPos || "?",
            age: a.playerAge || 0,
            team: a.playerTeam || "",
          })),
        picksReceived: received
          .filter((a) => a.assetType === "pick")
          .map((a) => ({
            season: a.pickSeason || "",
            round: a.pickRound || 0,
            slot: a.pickSlot ?? null,
            originalOwnerName: a.pickOriginalOwnerName || null,
            draftType: a.pickDraftType || null,
          })),
      };
    });

    return {
      tradeId: trade.id,
      season: trade.season,
      week: trade.week,
      timestamp: trade.timestamp,
      leagueName: trade.leagueName || null,
      leagueFormat: trade.leagueFormat || "1QB",
      leagueScoringFormat: trade.leagueScoringFormat || "PPR",
      leagueTotalRosters: trade.leagueTotalRosters || 0,
      sides,
    };
  // Application-level safety net: drop any trade where a side still has no received assets
  }).filter((t) =>
    t.sides.length >= 2 &&
    t.sides.every((s) => s.playersReceived.length + s.picksReceived.length > 0)
  );

  return {
    trades: enrichedTrades,
    total: totalCount,
    page,
    limit,
  };
}

export async function ingestLeagueTrades(params: {
  leagueId: string;
  season: string;
  teamCount: number;
  format: string;
  scoringFormat: string;
  bestBall?: boolean;
  sinceMs?: number;
}): Promise<{ inserted: number; skipped: number; alreadyIndexed: boolean }> {
  const d = getDb();
  const playersDb = await getSleeperPlayers();

  const existingLeague = await d
    .select({ id: crawledLeagues.id })
    .from(crawledLeagues)
    .where(eq(crawledLeagues.id, params.leagueId))
    .limit(1);

  if (existingLeague.length > 0) {
    return { inserted: 0, skipped: 0, alreadyIndexed: true };
  }

  // Callers with the league's settings in hand (e.g. ingestUserLeagues) pass the
  // flag directly; the single-league route omits it, so fetch it once here.
  const bestBall = params.bestBall ?? await (async () => {
    const lg = await fetchJson<SleeperLeagueInfo>(`${SLEEPER_API}/league/${params.leagueId}`);
    return lg?.settings?.best_ball === 1;
  })();

  const rawTransactions = await fetchLeagueTransactions(params.leagueId);
  const { slotMap: draftSlots, seasonDraftType } = await fetchLeagueDraftInfo(params.leagueId, params.season);

  const filteredTransactions = params.sinceMs
    ? rawTransactions.filter((t) => (t.status_updated || 0) >= params.sinceMs!)
    : rawTransactions;

  await d.insert(crawledLeagues).values({
    id: params.leagueId,
    name: "user-contributed",
    season: params.season,
    totalRosters: params.teamCount,
    format: params.format,
    scoringFormat: params.scoringFormat,
    rosterPositions: [],
    tradeCount: filteredTransactions.length,
  }).onConflictDoNothing();

  let inserted = 0;
  let skipped = 0;

  for (const trade of filteredTransactions) {
    const tradeRosterIds = trade.roster_ids || [];
    // Must have at least 2 parties — empty roster_ids slips past .some() checks
    if (tradeRosterIds.length < 2) {
      skipped++;
      continue;
    }

    const insertedTrade = await d.insert(trades).values({
      id: trade.transaction_id,
      leagueId: params.leagueId,
      season: params.season,
      week: trade.leg || 0,
      timestamp: trade.status_updated || Date.now(),
      rosterIds: trade.roster_ids || [],
      status: trade.status,
      leagueName: null,
      leagueFormat: params.format,
      leagueScoringFormat: params.scoringFormat,
      leagueTotalRosters: params.teamCount,
      bestBall,
    }).onConflictDoNothing().returning({ id: trades.id });

    // If no row was returned, this trade already exists — skip asset insertion
    if (insertedTrade.length === 0) {
      skipped++;
      continue;
    }

    const assetRows: Array<typeof tradeAssets.$inferInsert> = [];
    const involvedRosters = new Set(trade.roster_ids || []);

    if (trade.adds) {
      for (const [playerId, rosterId] of Object.entries(trade.adds)) {
        const player = playersDb[playerId];
        assetRows.push({
          tradeId: trade.transaction_id,
          rosterId: rosterId as number,
          rosterOwnerName: null,
          rosterTeamName: null,
          assetType: "player",
          playerSleeperId: playerId,
          playerName: player?.full_name || `Player ${playerId}`,
          playerPos: player?.position || null,
          playerTeam: player?.team || null,
          playerAge: player?.age || null,
          direction: "received",
        });
      }
    }

    if (trade.drops) {
      for (const [playerId, rosterId] of Object.entries(trade.drops)) {
        const rid = rosterId as number;
        if (!involvedRosters.has(rid)) continue;
        const player = playersDb[playerId];
        assetRows.push({
          tradeId: trade.transaction_id,
          rosterId: rid,
          rosterOwnerName: null,
          rosterTeamName: null,
          assetType: "player",
          playerSleeperId: playerId,
          playerName: player?.full_name || `Player ${playerId}`,
          playerPos: player?.position || null,
          playerTeam: player?.team || null,
          playerAge: player?.age || null,
          direction: "sent",
        });
      }
    }

    if (trade.draft_picks) {
      for (const pick of trade.draft_picks) {
        if (!pick.owner_id || !pick.previous_owner_id) continue;
        // Skip picks beyond round 5 (invalid/junk data)
        if (pick.round > 5) continue;
        // Skip picks from startup-only leagues (no rookie draft for this season)
        if (pick.season === params.season && seasonDraftType === "startup-only") continue;
        // Only assign a known slot when the pick season matches this league's season.
        const slot = pick.season === params.season
          ? (draftSlots.get(pick.roster_id) ?? null)
          : null;
        const pickDraftType: string = pick.season === params.season
          ? (seasonDraftType === "has-rookie" ? "rookie" : "unknown")
          : "rookie";

        assetRows.push({
          tradeId: trade.transaction_id,
          rosterId: pick.owner_id,
          rosterOwnerName: null,
          rosterTeamName: null,
          assetType: "pick",
          pickSeason: pick.season,
          pickRound: pick.round,
          pickSlot: slot,
          pickOriginalRosterId: pick.roster_id,
          pickOriginalOwnerName: null,
          pickDraftType,
          direction: "received",
        });

        assetRows.push({
          tradeId: trade.transaction_id,
          rosterId: pick.previous_owner_id,
          rosterOwnerName: null,
          rosterTeamName: null,
          assetType: "pick",
          pickSeason: pick.season,
          pickRound: pick.round,
          pickSlot: slot,
          pickOriginalRosterId: pick.roster_id,
          pickOriginalOwnerName: null,
          pickDraftType,
          direction: "sent",
        });
      }
    }

    // Final check: every roster must have received at least one asset.
    // If picks got stripped (startup draft, round > 5) the trade can end up empty.
    const ingestReceivedRosterIds = new Set(
      assetRows.filter((a) => a.direction === "received").map((a) => a.rosterId)
    );
    if (assetRows.length === 0 || tradeRosterIds.some((rid) => !ingestReceivedRosterIds.has(rid))) {
      await d.delete(trades).where(eq(trades.id, trade.transaction_id));
      skipped++;
      continue;
    }

    await d.insert(tradeAssets).values(assetRows);
    inserted++;
  }

  return { inserted, skipped, alreadyIndexed: false };
}

export async function ingestUserLeagues(username: string): Promise<{ started: number; alreadyIndexed: number }> {
  const d = getDb();
  const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
  const sinceMs = Date.now() - SIX_MONTHS_MS;
  const seasons = ["2026", "2025"];

  // 1. Resolve username → user_id
  const userRes = await fetch(`${SLEEPER_API}/user/${username}`);
  if (!userRes.ok) throw new Error("Sleeper user not found");
  const userData = (await userRes.json()) as { user_id: string };

  // Helper: fetch dynasty leagues for a single user
  async function fetchDynastyLeaguesForUser(userId: string): Promise<SleeperLeagueInfo[]> {
    const result: SleeperLeagueInfo[] = [];
    for (const season of seasons) {
      await sleep(RATE_LIMIT_MS);
      const leagues = await fetchJson<SleeperLeagueInfo[]>(
        `${SLEEPER_API}/user/${userId}/leagues/nfl/${season}`
      );
      if (!leagues) continue;
      leagues
        .filter((lg) => lg.settings?.type === 2)
        .forEach((lg) => result.push(lg));
    }
    return result;
  }

  // 2. Get the entered user's own leagues
  const seedLeagues = await fetchDynastyLeaguesForUser(userData.user_id);

  // 3. Discover all unique members across those leagues
  const allMemberIds = new Set<string>([userData.user_id]);
  for (const lg of seedLeagues) {
    await sleep(RATE_LIMIT_MS);
    const users = await fetchJson<SleeperUserInfo[]>(
      `${SLEEPER_API}/league/${lg.league_id}/users`
    );
    if (users) {
      users.forEach((u) => allMemberIds.add(u.user_id));
    }
  }

  // 4. Collect all dynasty leagues across every member (deduplicated by league_id)
  const allLeagueMap = new Map<string, { season: string; format: string; scoringFormat: string; teamCount: number; bestBall: boolean }>();

  for (const memberId of allMemberIds) {
    const memberLeagues = await fetchDynastyLeaguesForUser(memberId);
    for (const lg of memberLeagues) {
      if (!allLeagueMap.has(lg.league_id)) {
        allLeagueMap.set(lg.league_id, {
          season: lg.season,
          format: deriveFormat(lg.roster_positions || []),
          scoringFormat: deriveScoringFormat(lg.scoring_settings || {}),
          teamCount: lg.total_rosters || 12,
          bestBall: lg.settings?.best_ball === 1,
        });
      }
    }
  }

  console.log(`[UserIngest] Discovered ${allLeagueMap.size} unique leagues across ${allMemberIds.size} members for ${username}`);

  // 5. Filter out already-indexed leagues
  const toProcess: Array<{ leagueId: string; season: string; format: string; scoringFormat: string; teamCount: number; bestBall: boolean }> = [];
  let alreadyIndexed = 0;

  for (const [leagueId, info] of allLeagueMap) {
    const existing = await d
      .select({ id: crawledLeagues.id })
      .from(crawledLeagues)
      .where(eq(crawledLeagues.id, leagueId))
      .limit(1);

    if (existing.length > 0) {
      alreadyIndexed++;
      continue;
    }
    toProcess.push({ leagueId, ...info });
  }

  // 6. Background-process all new leagues with the 6-month timestamp filter
  if (toProcess.length > 0) {
    (async () => {
      let done = 0;
      for (const params of toProcess) {
        try {
          await ingestLeagueTrades({ ...params, sinceMs });
          done++;
          console.log(`[UserIngest] (${done}/${toProcess.length}) Indexed ${params.leagueId} (${params.season})`);
        } catch (err: any) {
          console.error(`[UserIngest] Failed ${params.leagueId}:`, err.message);
        }
      }
      console.log(`[UserIngest] Complete — ${done} leagues indexed for ${username}`);
    })().catch(() => {});
  }

  return { started: toProcess.length, alreadyIndexed };
}

export async function getTradeStats() {
  const d = getDb();

  const [totalTrades] = await d.select({ total: count() }).from(trades);
  const [totalLeagues] = await d.select({ total: count() }).from(crawledLeagues);

  const formatBreakdown = await d
    .select({
      format: trades.leagueFormat,
      count: count(),
    })
    .from(trades)
    .groupBy(trades.leagueFormat);

  const scoringBreakdown = await d
    .select({
      scoring: trades.leagueScoringFormat,
      count: count(),
    })
    .from(trades)
    .groupBy(trades.leagueScoringFormat);

  const seasonBreakdown = await d
    .select({
      season: trades.season,
      count: count(),
    })
    .from(trades)
    .groupBy(trades.season)
    .orderBy(sql`${trades.season} DESC`);

  return {
    totalTrades: totalTrades.total,
    totalLeagues: totalLeagues.total,
    formatBreakdown: formatBreakdown.map((r) => ({ format: r.format, count: r.count })),
    scoringBreakdown: scoringBreakdown.map((r) => ({ scoring: r.scoring, count: r.count })),
    seasonBreakdown: seasonBreakdown.map((r) => ({ season: r.season, count: r.count })),
  };
}

/**
 * Most-traded players over a recent window. Counts distinct trades each player
 * appears in (asset_type = 'player') where the trade timestamp falls within the
 * last `days` days. Trade timestamps are stored in milliseconds (Sleeper's
 * status_updated), so the cutoff is computed in ms.
 */
export async function getMostTradedPlayers(days = 7, limit = 10) {
  const d = getDb();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const rows = await d
    .select({
      sleeperId: tradeAssets.playerSleeperId,
      name: sql<string>`max(${tradeAssets.playerName})`,
      pos: sql<string>`max(${tradeAssets.playerPos})`,
      team: sql<string>`max(${tradeAssets.playerTeam})`,
      tradeCount: sql<number>`count(distinct ${tradeAssets.tradeId})`,
    })
    .from(tradeAssets)
    .innerJoin(trades, eq(tradeAssets.tradeId, trades.id))
    .where(
      and(
        eq(tradeAssets.assetType, "player"),
        sql`${tradeAssets.playerSleeperId} IS NOT NULL`,
        sql`${trades.timestamp} >= ${cutoff}`,
      ),
    )
    .groupBy(tradeAssets.playerSleeperId)
    .orderBy(sql`count(distinct ${tradeAssets.tradeId}) DESC`)
    .limit(limit);

  return rows.map((r) => ({
    sleeperId: r.sleeperId,
    name: r.name,
    pos: r.pos,
    team: r.team,
    tradeCount: Number(r.tradeCount),
  }));
}

/**
 * One-time cleanup: null out pick_slot for any pick asset whose season is
 * different from the league season it was traded in. These slots were written
 * using the current year's draft order as a false stand-in for future picks.
 */
export async function cleanupFuturePickSlots(): Promise<{ cleared: number }> {
  const d = getDb();
  const result = await d.execute(sql`
    UPDATE trade_assets ta
    SET pick_slot = NULL
    FROM trades t
    JOIN crawled_leagues cl ON cl.id = t.league_id
    WHERE ta.trade_id = t.id
      AND ta.asset_type = 'pick'
      AND ta.pick_slot IS NOT NULL
      AND ta.pick_season IS NOT NULL
      AND ta.pick_season != cl.season
  `);
  const cleared = (result as any).rowCount ?? 0;
  if (cleared > 0) {
    console.log(`[PickSlotCleanup] Cleared ${cleared} incorrect future-pick slots`);
  }
  return { cleared };
}

/**
 * One-time backfill: for every crawled league, fetch its rookie draft slot
 * order and update any pick assets that are still missing a pickSlot.
 */
export async function backfillPickSlots(): Promise<{ updated: number; leagues: number }> {
  const d = getDb();

  const leagues = await d
    .select({ id: crawledLeagues.id, season: crawledLeagues.season })
    .from(crawledLeagues);

  let totalUpdated = 0;

  for (const league of leagues) {
    const { slotMap } = await fetchLeagueDraftInfo(league.id, league.season);
    if (slotMap.size === 0) continue;

    // Find all pick assets linked to this league that have no slot yet
    const unslottedPicks = await d
      .select({ id: tradeAssets.id, pickOriginalRosterId: tradeAssets.pickOriginalRosterId })
      .from(tradeAssets)
      .innerJoin(trades, eq(tradeAssets.tradeId, trades.id))
      .where(
        and(
          eq(trades.leagueId, league.id),
          eq(tradeAssets.assetType, "pick"),
          sql`${tradeAssets.pickSlot} IS NULL`,
          eq(tradeAssets.pickSeason, league.season)
        )
      );

    for (const asset of unslottedPicks) {
      if (asset.pickOriginalRosterId == null) continue;
      const slot = slotMap.get(asset.pickOriginalRosterId);
      if (slot == null) continue;

      await d
        .update(tradeAssets)
        .set({ pickSlot: slot })
        .where(eq(tradeAssets.id, asset.id));
      totalUpdated++;
    }
  }

  return { updated: totalUpdated, leagues: leagues.length };
}

export async function cleanupOneSidedTrades(): Promise<{ deleted: number }> {
  const d = getDb();

  // Identify bad trades in two categories:
  //   1) Zero-asset trades: no rows at all in trade_assets (JOIN misses these)
  //   2) One-sided trades: some rosters have no received assets
  // Deletes assets first (no FK cascade), then the trade rows, atomically.
  const result = await d.execute<{ deleted: string }>(sql`
    WITH bad_trades AS (
      -- Category 1: trades with zero asset rows
      SELECT t.id
      FROM trades t
      WHERE NOT EXISTS (SELECT 1 FROM trade_assets WHERE trade_id = t.id)
      UNION
      -- Category 2: trades where at least one roster_id has no received asset
      SELECT DISTINCT t.id
      FROM trades t
      JOIN trade_assets ta ON ta.trade_id = t.id
      GROUP BY t.id, t.roster_ids
      HAVING COUNT(DISTINCT ta.roster_id) FILTER (WHERE ta.direction = 'received')
           < array_length(t.roster_ids, 1)
    ),
    del_assets AS (
      DELETE FROM trade_assets
      WHERE trade_id IN (SELECT id FROM bad_trades)
    ),
    del_trades AS (
      DELETE FROM trades
      WHERE id IN (SELECT id FROM bad_trades)
      RETURNING id
    )
    SELECT COUNT(*) AS deleted FROM del_trades
  `);

  const deleted = parseInt(result.rows[0]?.deleted ?? "0", 10);

  // Verification: confirm 0 one-sided trades remain
  const check = await d.execute<{ remaining: string }>(sql`
    SELECT COUNT(*) AS remaining
    FROM (
      SELECT DISTINCT t.id
      FROM trades t
      JOIN trade_assets ta ON ta.trade_id = t.id
      GROUP BY t.id, t.roster_ids
      HAVING COUNT(DISTINCT ta.roster_id) FILTER (WHERE ta.direction = 'received')
           < array_length(t.roster_ids, 1)
    ) sub
  `);
  const remaining = parseInt(check.rows[0]?.remaining ?? "0", 10);
  console.log(`[Cleanup] cleanupOneSidedTrades: deleted=${deleted}, remaining=${remaining}`);

  return { deleted };
}
