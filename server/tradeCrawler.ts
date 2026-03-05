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

  for (const leagueInfo of leagueChain) {
    const existingLeague = await d.select().from(crawledLeagues).where(eq(crawledLeagues.id, leagueInfo.league_id)).limit(1);
    if (existingLeague.length > 0) continue;

    console.log(`[Crawler] Fetching trades for league ${leagueInfo.name} (${leagueInfo.season})`);

    const leagueTrades = await fetchLeagueTransactions(leagueInfo.league_id);

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
      const existingTrade = await d.select().from(trades).where(eq(trades.id, trade.transaction_id)).limit(1);
      if (existingTrade.length > 0) continue;

      await d.insert(trades).values({
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
      });

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
          const receiverInfo = rosterOwnerMap.get(pick.owner_id);
          const originalOwnerInfo = rosterOwnerMap.get(pick.roster_id);

          assetRows.push({
            tradeId: trade.transaction_id,
            rosterId: pick.owner_id,
            rosterOwnerName: receiverInfo?.ownerName || null,
            rosterTeamName: receiverInfo?.teamName || null,
            assetType: "pick",
            pickSeason: pick.season,
            pickRound: pick.round,
            pickOriginalRosterId: pick.roster_id,
            pickOriginalOwnerName: originalOwnerInfo?.ownerName || null,
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
            pickOriginalRosterId: pick.roster_id,
            pickOriginalOwnerName: originalOwnerInfo?.ownerName || null,
            direction: "sent",
          });
        }
      }

      if (assetRows.length > 0) {
        await d.insert(tradeAssets).values(assetRows);
      }

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
      (lg) => lg.settings?.type === 2 && lg.settings?.best_ball !== 1
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
      (lg) => lg.settings?.type === 2 && lg.settings?.best_ball !== 1
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
  page?: number;
  limit?: number;
}) {
  const d = getDb();
  const page = params.page || 1;
  const limit = Math.min(params.limit || 50, 100);
  const offset = (page - 1) * limit;

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

  const whereClause = allConditions.length > 0 ? and(...allConditions) : sql`1=1`;

  const [countResult] = await d
    .select({ total: count() })
    .from(trades)
    .where(whereClause);

  const tradeRows = await d
    .select()
    .from(trades)
    .where(whereClause)
    .orderBy(sql`${trades.timestamp} DESC`)
    .limit(limit)
    .offset(offset);

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
        teamName: firstAsset?.rosterTeamName || "Unknown",
        ownerName: firstAsset?.rosterOwnerName || "Unknown",
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
            originalOwnerName: a.pickOriginalOwnerName || "Unknown",
          })),
      };
    });

    return {
      tradeId: trade.id,
      season: trade.season,
      week: trade.week,
      timestamp: trade.timestamp,
      leagueName: trade.leagueName || "Unknown",
      leagueFormat: trade.leagueFormat || "1QB",
      leagueScoringFormat: trade.leagueScoringFormat || "PPR",
      leagueTotalRosters: trade.leagueTotalRosters || 0,
      sides,
    };
  });

  return {
    trades: enrichedTrades,
    total: countResult.total,
    page,
    limit,
  };
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
