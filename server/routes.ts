import type { Express } from "express";
import { createServer, type Server } from "http";
import { fetchRotowireNfl, getNflNameIndex, matchSleeperId, playerNameFromTitle, sleeperHeadshot } from "./nflNews";
import { getPlayerNews, startPlayerNewsIngestion } from "./playerNews";
import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalc";
import { getKtcValues, getKtcRedraftValues } from "./ktc";
import { rebuildBasketSnapshots } from "./portfolioBasketValue";
import {
  getPortfolioTimeline,
  getPortfolioEvents,
  getLeagueBreakdown,
  getPortfolioAssets,
  getValueSourceBreakdown,
} from "./portfolioSnapshots";
import { computePlayoffCalculator, computeWeeklyMatchups } from "./playoffCalculator";
import { getAdpHistory, getAdpAvailability, getAdpAvailabilityMatrix } from "./adpPlayerProfile";
import { getPlayerMetadata, getPlayerProduction, getPlayerGameLogs, type ScoringKey, type GameLogSeasonType } from "./sleeperPlayerProfile";
import {
  fetchSleeperUser,
  fetchSleeperLeagues,
  fetchSleeperLeagueFull,
  fetchPortfolioSummary,
  fetchCrossLeagueTrades,
  fetchLeagueTransactions,
} from "./sleeper";
import {
  startCrawl,
  pauseCrawl,
  resumeCrawl,
  getCrawlStatus,
  searchTrades,
  getTradeStats,
  getMostTradedPlayers,
  ingestLeagueTrades,
  ingestUserLeagues,
  backfillPickSlots,
  cleanupFuturePickSlots,
  cleanupOneSidedTrades,
} from "./tradeCrawler";
import {
  captureValueSnapshot,
  getValueChanges,
  getAvailableSnapshotDates,
  startSnapshotScheduler,
} from "./valueSnapshots";
import {
  ingestDraftById,
  ingestLeagueDrafts,
  ingestUserDrafts,
  ingestCrawledLeagueDrafts,
  refreshAdpSnapshot,
  refreshDefaultSnapshots,
  reclassifyAdpDrafts,
  getAdp,
  getAdpInclusionStatus,
  getAdpStats,
  startAdpScheduler,
  backfillLeagueScoring,
  type AdpFilters,
} from "./adp";
import {
  enqueueSeeds,
  enqueueSleeperUser,
  getPassiveCrawlEvents,
  startCrawlWorker,
  getCrawlStatus as getAdpCrawlStatus,
  resetFailedQueueItems,
  type SeedInput,
} from "./adpCrawler";
import {
  startUnifiedCrawler,
  runOnce as runUnifiedCrawlOnce,
  isUnifiedCrawlRunning,
  getRecentRuns as getUnifiedCrawlRuns,
  getCrawlTotals as getUnifiedCrawlTotals,
  recoverStuckRuns as recoverUnifiedCrawlRuns,
} from "./unifiedCrawler";
import {
  previewCsv,
  saveValueSet,
  listValueSets,
  activateValueSet,
  deactivateValueSet,
  deleteValueSet,
  getResolvedValues,
  type ValueType,
  type ParsedRow,
} from "./customValues";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { getFinancesForUser, upsertLeagueFinance } from "./finances";
import { upsertTeamSnapshot, getTeamSnapshots } from "./teamValueSnapshots";
import { registerScAuthRoutes } from "./scAuthRoutes";
import { registerBillingRoutes } from "./billingRoutes";
import { registerSleeperDraftPickRoutes } from "./sleeperDraftPickRoutes";
import { registerDiscordRoutes } from "./discord";
import { registerCommandersReportRoutes } from "./commandersReportRoutes";
import { registerAnalyticsRoutes } from "./analytics";
import { requireReadOnlySleeperContext } from "./accessMiddleware";
import { getManagerIntel } from "./managerIntel";
import {
  startCrawlInBackground,
  getCrawlLiveState,
  requestCrawlCancel,
  type DraftCategory,
} from "./adpNetworkCrawl";
import {
  recoverAdpCrawlState,
  repairIncompleteDrafts,
} from "./adpCrawlRepair";
import { getUser } from "./scAuth";
import { isAdminByEmail } from "@shared/admin";
import {
  confirmSleeperToken,
  createChallenge,
  getChallenge,
  verifyChallenge,
  signToken,
  requireFinanceAuth,
  hasFinancePassword,
  setFinancePassword,
  checkFinancePassword,
} from "./auth";

// ── Shared filter parser for the player-profile endpoints ───────────────────
// Accepts the same query string as /api/adp so the modal can mirror whatever
// the DraftCommand view is currently filtered to. Unknown / blank values fall
// through to backend defaults — same precedence as the main /api/adp parser.
function parsePlayerProfileFilters(q: Record<string, unknown>): AdpFilters {
  const num = (v: unknown) => {
    if (v === undefined || v === null || v === "" || v === "all") return undefined;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = <T extends string>(v: unknown, allowed: readonly T[]): T | "all" | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const s = String(v);
    if (s === "all") return "all";
    return (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
  };
  const parseSeason = (v: unknown): AdpFilters["season"] => {
    if (v === undefined || v === null || v === "") return undefined;
    const s = String(v).trim();
    if (s === "all") return "all";
    if (s.includes(",")) {
      const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
      return parts.length > 1 ? parts : parts[0];
    }
    return s;
  };
  return {
    season: parseSeason(q.season),
    draftType: str(q.draftType, ["startup", "rookie", "supplemental"] as const) ?? "startup",
    draftFormat: str(q.draftFormat, ["snake", "auction", "linear"] as const) ?? "snake",
    scoring: str(q.scoring, ["ppr", "half", "standard"] as const) ?? "all",
    superflex: str(q.superflex, ["yes", "no"] as const) ?? "all",
    tePremium: str(q.tePremium, ["yes", "no"] as const) ?? "all",
    bestBall: str(q.bestBall, ["yes", "no"] as const) ?? "all",
    leagueMode: str(q.leagueMode, ["dynasty", "keeper", "redraft"] as const) ?? "dynasty",
    teams: num(q.teams) ?? "all",
    rookieMode: (str(q.rookieMode, ["picks", "direct", "both"] as const) ?? "direct") as AdpFilters["rookieMode"],
    passTd: (num(q.passTd) === 6 ? 6 : num(q.passTd) === 4 ? 4 : "all") as AdpFilters["passTd"],
    startDate: typeof q.startDate === "string" ? q.startDate : undefined,
    endDate: typeof q.endDate === "string" ? q.endDate : undefined,
  };
}

// ── Simple in-memory TTL cache ────────────────────────────────────────────────
interface CacheEntry<T> { data: T; expiresAt: number; }
function makeCache<T>(ttlMs: number) {
  const store = new Map<string, CacheEntry<T>>();
  return {
    get(key: string): T | null {
      const e = store.get(key);
      if (!e || Date.now() > e.expiresAt) { store.delete(key); return null; }
      return e.data;
    },
    set(key: string, data: T) { store.set(key, { data, expiresAt: Date.now() + ttlMs }); },
    invalidate(key: string) { store.delete(key); },
  };
}

const statsCache   = makeCache<any>(5 * 60 * 1000);   // 5-min TTL
const mostTradedCache = makeCache<any>(10 * 60 * 1000); // 10-min TTL
const searchCache  = makeCache<any>(2 * 60 * 1000);   // 2-min TTL
const playoffCalcCache = makeCache<any>(10 * 60 * 1000); // 10-min TTL
const weeklyMatchupsCache = makeCache<any>(5 * 60 * 1000); // 5-min TTL — live scores need fresher data
const statChasersDataCache = makeCache<any>(10 * 60 * 1000); // 10-min TTL — public-data repo JSON
const scheduleCache = makeCache<any>(5 * 60 * 1000); // 5-min TTL — NFL week schedule (kickoff/lock state)

// Allowed axes for the StatChasers public-data proxy. Kept in lock-step with
// client/src/lib/statChasersDataConfig.ts. If the data repo grows new
// positions/categories/years, update both this file and the client config.
// Default branch is `master`; data is nested one extra `statchasers-data/`
// directory deep (the repo wraps a Replit workspace). Mirror updates here
// and in client/src/lib/statChasersDataConfig.ts.
const STATCHASERS_DATA_BASE =
  "https://raw.githubusercontent.com/statchasersff-bit/statchasers-data/master/statchasers-data/output";
const STATCHASERS_POSITIONS = new Set(["qb", "rb", "wr", "te"]);
const STATCHASERS_CATEGORIES = new Set(["overview", "usage", "efficiency", "stat_explorer"]);
const STATCHASERS_YEARS = new Set([2023, 2024, 2025]);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerScAuthRoutes(app);
  registerBillingRoutes(app);
  registerSleeperDraftPickRoutes(app);
  registerDiscordRoutes(app);
  registerCommandersReportRoutes(app);
  registerAnalyticsRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", ts: Date.now() });
  });

  // ─── NFL News ticker — Rotowire RSS, fetched server-side + cached ──────────
  // We only ever expose the headline title + outbound Rotowire link (never the
  // article body), fetch server-side to dodge CORS, and cache for 10 minutes.
  // On failure we return 200 with the last good items (or empty) so the client
  // ticker hides itself instead of breaking the page.
  const NFL_NEWS_TTL_MS = 10 * 60 * 1000;
  type NflTickerItem = {
    id: string; title: string; link: string; pubDate: string | null;
    playerName: string | null; image: string | null;
  };
  let nflNewsCache: { items: NflTickerItem[]; ts: number } | null = null;

  app.get("/api/news/nfl", async (_req, res) => {
    try {
      if (nflNewsCache && Date.now() - nflNewsCache.ts < NFL_NEWS_TTL_MS) {
        res.set("Cache-Control", "public, max-age=600");
        return res.json({ items: nflNewsCache.items });
      }
      const [items, nameIndex] = await Promise.all([fetchRotowireNfl(), getNflNameIndex()]);
      const mapped: NflTickerItem[] = items.slice(0, 10).map((it, index) => {
        const sleeperId = matchSleeperId(it.title, nameIndex);
        return {
          id: it.guid || it.link || `nfl-news-${index}`,
          title: it.title,
          link: it.link,
          pubDate: it.pubDate,
          playerName: playerNameFromTitle(it.title),
          image: sleeperId ? sleeperHeadshot(sleeperId) : null,
        };
      });
      nflNewsCache = { items: mapped, ts: Date.now() };
      res.set("Cache-Control", "public, max-age=600");
      res.json({ items: mapped });
    } catch (error) {
      console.error("[news/nfl] feed fetch failed:", error instanceof Error ? error.message : error);
      // Serve stale cache if we have one; otherwise empty so the ticker hides.
      res.json({ items: nflNewsCache?.items ?? [] });
    }
  });

  // Persistent player news for profile pages — newest stored headlines for a
  // Sleeper player_id (metadata only). Empty array on any error so the UI can
  // show a clean empty state instead of breaking.
  app.get("/api/news/player/:playerId", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit ?? "10"), 10) || 10;
      const items = await getPlayerNews(req.params.playerId, limit);
      res.set("Cache-Control", "public, max-age=300");
      res.json({ items });
    } catch (error) {
      console.error("[news/player] query failed:", error instanceof Error ? error.message : error);
      res.json({ items: [] });
    }
  });

  // Kick off the background RSS → player_news ingestion loop (idempotent).
  startPlayerNewsIngestion();

  app.get("/api/values/fantasycalc", async (req, res) => {
    try {
      const format = (req.query.format as string) || "sf";
      if (format !== "sf" && format !== "1qb") {
        return res.status(400).json({ error: "format must be 'sf' or '1qb'" });
      }
      const data = await getFantasyCalcValues(format);
      res.json(data);
    } catch (err: any) {
      console.error("FantasyCalc fetch error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch values" });
    }
  });

  app.get("/api/values/ktc", async (req, res) => {
    try {
      const format = (req.query.format as string) || "sf";
      if (format !== "sf" && format !== "1qb") {
        return res.status(400).json({ error: "format must be 'sf' or '1qb'" });
      }
      const data = await getKtcValues(format);
      res.json(data);
    } catch (err: any) {
      console.error("KTC fetch error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch KTC values" });
    }
  });

  app.get("/api/values/ktc/redraft", async (req, res) => {
    try {
      const format = (req.query.format as string) || "sf";
      if (format !== "sf" && format !== "1qb") {
        return res.status(400).json({ error: "format must be 'sf' or '1qb'" });
      }
      const data = await getKtcRedraftValues(format);
      res.json(data);
    } catch (err: any) {
      console.error("KTC redraft fetch error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch KTC redraft values" });
    }
  });

  app.get("/api/values/fantasycalc/redraft", async (req, res) => {
    try {
      const format = (req.query.format as string) || "sf";
      if (format !== "sf" && format !== "1qb") {
        return res.status(400).json({ error: "format must be 'sf' or '1qb'" });
      }
      const data = await getFantasyCalcRedraftValues(format);
      res.json(data);
    } catch (err: any) {
      console.error("FantasyCalc redraft fetch error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch redraft values" });
    }
  });

  app.get("/api/sleeper/user/:username", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const user = await fetchSleeperUser(req.params.username);
      res.json(user);
    } catch (err: any) {
      console.error("Sleeper user fetch error:", err);
      const status = err.message === "User not found" ? 404 : 500;
      res.status(status).json({ error: err.message || "Failed to fetch user" });
    }
  });

  app.get("/api/sleeper/user/:userId/leagues", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const season = (req.query.season as string) || "2026";
      const leagues = await fetchSleeperLeagues(req.params.userId, season);
      res.json(leagues);
    } catch (err: any) {
      console.error("Sleeper leagues fetch error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch leagues" });
    }
  });

  app.get("/api/sleeper/league/:leagueId/full", async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "userId query param is required" });
      }
      const data = await fetchSleeperLeagueFull(req.params.leagueId, userId);
      res.json(data);
    } catch (err: any) {
      console.error("Sleeper league full fetch error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch league data" });
    }
  });

  app.get("/api/sleeper/user/:userId/portfolio-summary", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const season = (req.query.season as string) || "2026";
      const leagues = await fetchSleeperLeagues(req.params.userId, season);
      const summary = await fetchPortfolioSummary(req.params.userId, leagues);
      res.json(summary);
    } catch (err: any) {
      console.error("Portfolio summary error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch portfolio summary" });
    }
  });

  // ── Portfolio Timeline ──────────────────────────────────────────────────
  // Asset-ledger reconstruction of a manager's dynasty portfolio value over
  // time. :sleeperUsername accepts a username or a Sleeper user_id.
  const resolvePortfolioUser = async (handle: string) => {
    const user = await fetchSleeperUser(handle);
    const season = String(new Date().getFullYear());
    const leagues = await fetchSleeperLeagues(user.userId, season).catch(() => []);
    const leagueNames: Record<string, string> = {};
    for (const lg of leagues) leagueNames[lg.leagueId] = lg.name;
    return { userId: user.userId, leagues, leagueNames };
  };

  app.get("/api/portfolio/:sleeperUsername/timeline", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const { userId } = await resolvePortfolioUser(req.params.sleeperUsername);
      const range = (req.query.range as string) || "all";
      const leagueId = (req.query.leagueId as string) || undefined;
      const sameLeague = req.query.sameLeague === "1" || req.query.sameLeague === "true";
      const data = await getPortfolioTimeline(userId, { range, leagueId, sameLeague });
      res.setHeader("Cache-Control", "private, max-age=60");
      res.json({ sleeperUsername: req.params.sleeperUsername, range, mode: (req.query.mode as string) || "total", ...data });
    } catch (err: any) {
      console.error("Portfolio timeline error:", err);
      res.status(500).json({ error: err?.message || "Failed to load portfolio timeline" });
    }
  });

  app.get("/api/portfolio/:sleeperUsername/events", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const { userId } = await resolvePortfolioUser(req.params.sleeperUsername);
      const events = await getPortfolioEvents(userId, {
        eventType: (req.query.eventType as string) || undefined,
        leagueId: (req.query.leagueId as string) || undefined,
        minImpact: req.query.minImpact ? Number(req.query.minImpact) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ events });
    } catch (err: any) {
      console.error("Portfolio events error:", err);
      res.status(500).json({ error: err?.message || "Failed to load portfolio events" });
    }
  });

  app.get("/api/portfolio/:sleeperUsername/league-breakdown", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const { userId, leagueNames } = await resolvePortfolioUser(req.params.sleeperUsername);
      const leagues = await getLeagueBreakdown(userId, leagueNames);
      res.json({ leagues });
    } catch (err: any) {
      console.error("Portfolio league-breakdown error:", err);
      res.status(500).json({ error: err?.message || "Failed to load league breakdown" });
    }
  });

  app.get("/api/portfolio/:sleeperUsername/assets", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const { userId, leagueNames } = await resolvePortfolioUser(req.params.sleeperUsername);
      const assets = await getPortfolioAssets(userId, leagueNames);
      res.json({ assets });
    } catch (err: any) {
      console.error("Portfolio assets error:", err);
      res.status(500).json({ error: err?.message || "Failed to load portfolio assets" });
    }
  });

  app.get("/api/portfolio/:sleeperUsername/value-sources", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const { userId } = await resolvePortfolioUser(req.params.sleeperUsername);
      const sources = await getValueSourceBreakdown(userId);
      res.json({ sources });
    } catch (err: any) {
      console.error("Portfolio value-sources error:", err);
      res.status(500).json({ error: err?.message || "Failed to load value sources" });
    }
  });

  app.post("/api/portfolio/:sleeperUsername/backfill", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const { userId, leagues } = await resolvePortfolioUser(req.params.sleeperUsername);
      // Prefer the league set the client already resolved (the leagues the
      // user actually rosters players in). Sleeper's /leagues endpoint returns
      // every league a power-user has *joined* — incl. ones with no roster —
      // so deriving the set here would scan far more leagues than are real.
      const bodyIds = Array.isArray(req.body?.leagueIds)
        ? (req.body.leagueIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
        : [];
      const leagueIds = bodyIds.length > 0 ? bodyIds : leagues.map((l) => l.leagueId);
      if (leagueIds.length === 0) {
        return res.status(404).json({ error: "No dynasty leagues found for this user." });
      }
      const result = await rebuildBasketSnapshots(userId, leagueIds);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("Portfolio backfill error:", err);
      res.status(500).json({ error: err?.message || "Failed to backfill portfolio" });
    }
  });

  app.post("/api/portfolio/:sleeperUsername/recalculate", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const { userId, leagues } = await resolvePortfolioUser(req.params.sleeperUsername);
      const bodyIds = Array.isArray(req.body?.leagueIds)
        ? (req.body.leagueIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
        : [];
      const leagueIds = bodyIds.length > 0 ? bodyIds : leagues.map((l) => l.leagueId);
      const result = await rebuildBasketSnapshots(userId, leagueIds);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("Portfolio recalculate error:", err);
      res.status(500).json({ error: err?.message || "Failed to recalculate portfolio" });
    }
  });

  // Manager Intel — aggregated cross-league read for the click-to-open
  // ManagerIntelDrawer. Cached in Postgres for 6h per (userId, leagueId,
  // season); pass ?refresh=1 to bypass the cache.
  app.get("/api/manager-intel/:userId", requireReadOnlySleeperContext, async (req, res) => {
    try {
      const userId = req.params.userId;
      const leagueId = (req.query.leagueId as string) || "";
      const season = (req.query.season as string) || String(new Date().getFullYear());
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      const payload = await getManagerIntel({ userId, leagueId, season, refresh });
      res.setHeader("Cache-Control", "private, max-age=60");
      res.json(payload);
    } catch (err: any) {
      console.error("Manager Intel error:", err);
      res.status(500).json({
        error: err?.message || "Failed to compute manager intel",
      });
    }
  });

  // Player profile analytics for the ADP Explorer drawer. Both endpoints
  // accept the same filter query string as /api/adp so the modal reflects
  // the currently selected DraftCommand filters (rookie vs startup, SF,
  // TEP, scoring, date range, etc.). Without filters they fall back to
  // current-year startup defaults — matching the original behavior.
  app.get("/api/adp/player/:playerId/history", async (req, res) => {
    try {
      const { playerId } = req.params;
      if (!playerId) return res.status(400).json({ error: "playerId is required" });
      const filters = parsePlayerProfileFilters(req.query);
      const data = await getAdpHistory(playerId, filters);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(data);
    } catch (err: any) {
      console.error("[AdpPlayerProfile/history] error:", err);
      res.status(500).json({ error: err?.message || "Failed to load ADP history" });
    }
  });

  // Single-player metadata read from the cached Sleeper /players/nfl
  // payload. Cheap — no network call once the cache is warm. Header tabs
  // in the ADP Explorer modal hit this on every player open.
  app.get("/api/sleeper/player/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      if (!playerId) return res.status(400).json({ error: "playerId is required" });
      const meta = await getPlayerMetadata(playerId);
      if (!meta) return res.status(404).json({ error: "Player not found" });
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json(meta);
    } catch (err: any) {
      console.error("[SleeperPlayer/metadata] error:", err);
      res.status(500).json({ error: err?.message || "Failed to load player metadata" });
    }
  });

  // Per-season fantasy production. Backed by Sleeper's public
  // /stats/nfl/regular/{season} endpoint with on-disk caching per season.
  // Scoring defaults to PPR — front-end can pass scoring=half_ppr|std to
  // match the ADP Explorer view the user is looking at.
  app.get("/api/players/:playerId/production", async (req, res) => {
    try {
      const { playerId } = req.params;
      if (!playerId) return res.status(400).json({ error: "playerId is required" });
      const raw = String(req.query.scoring ?? "ppr").toLowerCase();
      const scoring: ScoringKey =
        raw === "std" || raw === "standard"  ? "std" :
        raw === "half" || raw === "half_ppr" ? "half_ppr" :
        "ppr";
      const seasons = await getPlayerProduction(playerId, scoring);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({ playerId, scoring, seasons });
    } catch (err: any) {
      console.error("[Player/production] error:", err);
      res.status(500).json({ error: err?.message || "Failed to load production" });
    }
  });

  // Week-by-week game logs from Sleeper's (unofficial) per-player weekly stats
  // endpoint, disk-cached. Returns 502 on upstream failure so the UI can show a
  // "temporarily unavailable" message without breaking the page.
  app.get("/api/players/:playerId/game-logs", async (req, res) => {
    try {
      const { playerId } = req.params;
      if (!playerId) return res.status(400).json({ error: "playerId is required" });
      const season = parseInt(String(req.query.season ?? ""), 10);
      if (!season || season < 2000 || season > 2100) {
        return res.status(400).json({ error: "valid season is required" });
      }
      const seasonType: GameLogSeasonType = String(req.query.type ?? "regular").toLowerCase() === "post" ? "post" : "regular";
      const logs = await getPlayerGameLogs(playerId, season, seasonType);
      res.setHeader("Cache-Control", "public, max-age=900");
      res.json({ playerId, season, seasonType, logs });
    } catch (err: any) {
      console.error("[Player/game-logs] error:", err);
      res.status(502).json({ error: err?.message || "Failed to load game logs" });
    }
  });

  app.get("/api/adp/player/:playerId/availability", async (req, res) => {
    try {
      const { playerId } = req.params;
      const teams = Math.max(4, Math.min(20, parseInt(String(req.query.teams ?? "12"), 10) || 12));
      const rounds = Math.max(1, Math.min(20, parseInt(String(req.query.rounds ?? "5"), 10) || 5));
      if (!playerId) return res.status(400).json({ error: "playerId is required" });
      const filters = parsePlayerProfileFilters(req.query);
      const data = await getAdpAvailability(playerId, filters, teams, rounds);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(data);
    } catch (err: any) {
      console.error("[AdpPlayerProfile/availability] error:", err);
      res.status(500).json({ error: err?.message || "Failed to load availability" });
    }
  });

  // Batch real availability for the Draft Availability Matrix — true per-pick
  // frequencies for many players from real draft results, in one query.
  app.get("/api/adp/availability-matrix", async (req, res) => {
    try {
      const teams = Math.max(4, Math.min(20, parseInt(String(req.query.teams ?? "12"), 10) || 12));
      const rounds = Math.max(1, Math.min(20, parseInt(String(req.query.rounds ?? "5"), 10) || 5));
      const playerIds = String(req.query.playerIds ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 250);
      if (!playerIds.length) return res.json({ totalDrafts: 0, teams, rounds, players: {} });
      const filters = parsePlayerProfileFilters(req.query);
      const data = await getAdpAvailabilityMatrix(playerIds, filters, teams, rounds);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(data);
    } catch (err: any) {
      console.error("[AdpPlayerProfile/availability-matrix] error:", err);
      res.status(500).json({ error: err?.message || "Failed to load availability matrix" });
    }
  });

  // Health probe so we can sanity-check that /api routes are reachable
  // without invoking the Sleeper/FantasyCalc chain. If this returns HTML,
  // the SPA catch-all is shadowing the API.
  app.get("/api/playoff-calculator/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/api/leagues/:leagueId/playoff-calculator", async (req, res) => {
    const { leagueId } = req.params;
    const simsRaw = req.query.simulations;
    const simulations = Math.max(100, Math.min(25000,
      parseInt(typeof simsRaw === "string" ? simsRaw : "10000", 10) || 10000
    ));
    console.log("[PlayoffCalculator] request received", { leagueId, simulations });
    if (!leagueId) {
      return res.status(400).json({ error: "leagueId is required" });
    }
    try {
      const cacheKey = `${leagueId}:${simulations}`;
      const cached = playoffCalcCache.get(cacheKey);
      if (cached) {
        res.setHeader("Cache-Control", "public, max-age=600");
        return res.json(cached);
      }
      const result = await computePlayoffCalculator(leagueId, simulations);
      playoffCalcCache.set(cacheKey, result);
      res.setHeader("Cache-Control", "public, max-age=600");
      res.json(result);
    } catch (err: any) {
      console.error("[PlayoffCalculator] error:", err);
      const msg = err?.message || "Failed to compute playoff odds";
      // Upstream Sleeper / FantasyCalc failure → 502; otherwise 500.
      const status = /sleeper|fantasycalc|fetch/i.test(msg) ? 502 : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.get("/api/leagues/:leagueId/playoff-calculator/matchups", async (req, res) => {
    const { leagueId } = req.params;
    if (!leagueId) {
      return res.status(400).json({ error: "leagueId is required" });
    }
    const weekRaw = req.query.week;
    const week = typeof weekRaw === "string" ? parseInt(weekRaw, 10) : NaN;
    const weekArg = Number.isFinite(week) && week > 0 ? week : undefined;
    try {
      const cacheKey = `${leagueId}:${weekArg ?? "auto"}`;
      const cached = weeklyMatchupsCache.get(cacheKey);
      if (cached) {
        res.setHeader("Cache-Control", "public, max-age=300");
        return res.json(cached);
      }
      const result = await computeWeeklyMatchups(leagueId, weekArg);
      weeklyMatchupsCache.set(cacheKey, result);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(result);
    } catch (err: any) {
      console.error("[WeeklyMatchups] error:", err);
      const msg = err?.message || "Failed to compute weekly matchups";
      const status = /sleeper|fantasycalc|fetch/i.test(msg) ? 502 : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.get("/api/sleeper/league/:leagueId/transactions", async (req, res) => {
    try {
      const { leagueId } = req.params;
      const result = await fetchLeagueTransactions(leagueId);
      res.json(result);
    } catch (err: any) {
      console.error("Transactions fetch error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch transactions" });
    }
  });

  app.post("/api/sleeper/cross-league-trades", async (req, res) => {
    try {
      const { userId, currentLeagueId, rosterPlayerIds } = req.body;
      if (!userId || !currentLeagueId || !Array.isArray(rosterPlayerIds) || rosterPlayerIds.length === 0) {
        return res.status(400).json({ error: "userId, currentLeagueId, and a non-empty rosterPlayerIds array are required" });
      }
      const result = await fetchCrossLeagueTrades(userId, currentLeagueId, rosterPlayerIds);
      res.json(result);
    } catch (err: any) {
      console.error("Cross-league trades error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch cross-league trades" });
    }
  });

  app.post("/api/crawler/start", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ error: "username is required" });
      }
      const status = await startCrawl(username);
      res.json(status);
    } catch (err: any) {
      console.error("Crawler start error:", err);
      res.status(500).json({ error: err.message || "Failed to start crawler" });
    }
  });

  app.post("/api/crawler/pause", async (_req, res) => {
    try {
      const status = await pauseCrawl();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to pause crawler" });
    }
  });

  app.post("/api/crawler/resume", async (_req, res) => {
    try {
      const status = await resumeCrawl();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to resume crawler" });
    }
  });

  app.get("/api/crawler/status", async (_req, res) => {
    try {
      const status = await getCrawlStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get crawler status" });
    }
  });

  app.get("/api/trades/search", async (req, res) => {
    try {
      const params = {
        q: req.query.q as string,
        format: req.query.format as string,
        scoring: req.query.scoring as string,
        leagueSize: req.query.leagueSize ? parseInt(req.query.leagueSize as string) : undefined,
        season: req.query.season as string,
        bestBall: req.query.bestBall as string,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      };
      const cacheKey = JSON.stringify(params);
      const cached = searchCache.get(cacheKey);
      if (cached) {
        res.setHeader("Cache-Control", "public, max-age=120");
        return res.json(cached);
      }
      const result = await searchTrades(params);
      searchCache.set(cacheKey, result);
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json(result);
    } catch (err: any) {
      console.error("Trade search error:", err);
      res.status(500).json({ error: err.message || "Failed to search trades" });
    }
  });

  app.post("/api/trades/ingest-user", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: "username is required" });
      const result = await ingestUserLeagues(username);
      res.json(result);
    } catch (err: any) {
      console.error("User ingest error:", err);
      res.status(500).json({ error: err.message || "Failed to ingest user leagues" });
    }
  });

  app.post("/api/trades/ingest-league", async (req, res) => {
    try {
      const { leagueId, season, teamCount, format, scoringFormat } = req.body;
      if (!leagueId) {
        return res.status(400).json({ error: "leagueId is required" });
      }
      const result = await ingestLeagueTrades({
        leagueId,
        season: season || "2025",
        teamCount: teamCount || 12,
        format: format || "1QB",
        scoringFormat: scoringFormat || "PPR",
      });
      res.json(result);
    } catch (err: any) {
      console.error("Trade ingest error:", err);
      res.status(500).json({ error: err.message || "Failed to ingest trades" });
    }
  });

  app.get("/api/trades/stats", async (_req, res) => {
    try {
      const cached = statsCache.get("stats");
      if (cached) {
        res.setHeader("Cache-Control", "public, max-age=300");
        return res.json(cached);
      }
      const stats = await getTradeStats();
      statsCache.set("stats", stats);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get trade stats" });
    }
  });

  app.get("/api/trades/most-traded-players", async (_req, res) => {
    try {
      const cached = mostTradedCache.get("week");
      if (cached) {
        res.setHeader("Cache-Control", "public, max-age=600");
        return res.json(cached);
      }
      const players = await getMostTradedPlayers(7, 10);
      const payload = { players };
      mostTradedCache.set("week", payload);
      res.setHeader("Cache-Control", "public, max-age=600");
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get most-traded players" });
    }
  });

  // ── StatChasers public-data proxy ─────────────────────────────────────────
  // Mirrors the static JSON files in statchasersff-bit/statchasers-data so
  // the frontend has one cached entrypoint instead of fanning out to raw
  // GitHub URLs. Cached server-side for 10 minutes per (position, category,
  // year) tuple. See client/src/lib/statChasersDataConfig.ts for the
  // canonical axes.
  app.get("/api/statchasers-data/positions/:position/:category/:year", async (req, res) => {
    try {
      const position = String(req.params.position ?? "").toLowerCase();
      const category = String(req.params.category ?? "");
      const yearNum = parseInt(String(req.params.year ?? ""), 10);

      if (!STATCHASERS_POSITIONS.has(position)) {
        return res.status(400).json({
          error: `Invalid position "${req.params.position}". Expected one of: qb, rb, wr, te.`,
        });
      }
      if (!STATCHASERS_CATEGORIES.has(category)) {
        return res.status(400).json({
          error: `Invalid category "${req.params.category}". Expected one of: overview, usage, efficiency, stat_explorer.`,
        });
      }
      if (!Number.isFinite(yearNum) || !STATCHASERS_YEARS.has(yearNum)) {
        return res.status(400).json({
          error: `Invalid year "${req.params.year}". Expected one of: 2023, 2024, 2025.`,
        });
      }

      const cacheKey = `${position}:${category}:${yearNum}`;
      const cached = statChasersDataCache.get(cacheKey);
      if (cached) {
        res.setHeader("Cache-Control", "public, max-age=600");
        return res.json(cached);
      }

      const url = `${STATCHASERS_DATA_BASE}/positions/${position}/${category}_${yearNum}.json`;
      const upstream = await fetch(url, { headers: { Accept: "application/json" } });
      const ct = upstream.headers.get("content-type") || "";
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: `Upstream fetch failed (${upstream.status} ${upstream.statusText})`,
          url,
        });
      }
      if (!ct.includes("application/json") && !ct.includes("text/plain")) {
        return res.status(502).json({
          error: `Non-JSON response from upstream (content-type=${ct || "none"})`,
          url,
        });
      }
      const text = await upstream.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (parseErr: any) {
        return res.status(502).json({
          error: `Failed to parse upstream JSON: ${parseErr?.message || parseErr}`,
          url,
        });
      }
      statChasersDataCache.set(cacheKey, json);
      res.setHeader("Cache-Control", "public, max-age=600");
      return res.json(json);
    } catch (err: any) {
      console.error("[statchasers-data] proxy error:", err);
      return res.status(500).json({
        error: err?.message || "Failed to fetch StatChasers data",
      });
    }
  });

  app.post("/api/values/snapshot", async (_req, res) => {
    try {
      const result = await captureValueSnapshot();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to capture snapshot" });
    }
  });

  app.get("/api/values/changes", async (req, res) => {
    try {
      const format = (req.query.format as string) === "1qb" ? "1qb" : "sf";
      const type = (req.query.type as string) === "redraft" ? "redraft" : "dynasty";
      const days = parseInt(req.query.days as string) || 30;
      const changes = await getValueChanges(format, type, Math.min(days, 90));
      res.json(changes);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get value changes" });
    }
  });

  app.get("/api/values/snapshot-dates", async (_req, res) => {
    try {
      const dates = await getAvailableSnapshotDates();
      res.json(dates);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get snapshot dates" });
    }
  });

  app.post("/api/trades/backfill-pick-slots", async (_req, res) => {
    try {
      const result = await backfillPickSlots();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to backfill pick slots" });
    }
  });

  // Finance / ROI routes
  app.get("/api/finances/:sleeperUserId", requireFinanceAuth, async (req, res) => {
    try {
      const data = await getFinancesForUser(req.params.sleeperUserId);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch finances" });
    }
  });

  app.post("/api/finances", requireFinanceAuth, async (req, res) => {
    try {
      const { sleeperUserId, leagueId, season, buyIn, prizes, notes, isFree, ignored, leagueSafeUrl } = req.body;
      if (!sleeperUserId || !leagueId) return res.status(400).json({ error: "sleeperUserId and leagueId required" });
      const result = await upsertLeagueFinance({ sleeperUserId, leagueId, season: season || "2026", buyIn: buyIn ?? 0, prizes: prizes ?? [], notes, isFree: isFree ?? false, ignored: ignored ?? false, leagueSafeUrl });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to save finances" });
    }
  });

  // Team value snapshots — feeds the GM Dashboard's "Team Trajectory" chart.
  // Idempotent per (leagueId, rosterId, snapshotDate) so the client can fire
  // a write on every Overview load without flooding the table.
  app.post("/api/teams/snapshots", async (req, res) => {
    try {
      const {
        leagueId, rosterId, snapshotDate,
        dynastyValue, winNowValue, pickValue, starterStrength, avgAge,
      } = req.body ?? {};
      if (!leagueId || typeof rosterId !== "number" || !snapshotDate) {
        return res.status(400).json({ error: "leagueId, rosterId and snapshotDate are required" });
      }
      // Defensive parsing: clients are trusted but we don't want NaN rows.
      const num = (v: any, def = 0) => (typeof v === "number" && Number.isFinite(v) ? v : def);
      const result = await upsertTeamSnapshot({
        leagueId, rosterId, snapshotDate,
        dynastyValue: num(dynastyValue),
        winNowValue: num(winNowValue),
        pickValue: num(pickValue),
        starterStrength: num(starterStrength),
        avgAge: num(avgAge),
      });
      res.json(result);
    } catch (err: any) {
      console.error("[TeamSnapshots] upsert error:", err);
      res.status(500).json({ error: err?.message || "Failed to save snapshot" });
    }
  });

  app.get("/api/leagues/:leagueId/rosters/:rosterId/snapshots", async (req, res) => {
    try {
      const { leagueId, rosterId } = req.params;
      const rId = parseInt(rosterId, 10);
      if (!leagueId || Number.isNaN(rId)) {
        return res.status(400).json({ error: "leagueId and numeric rosterId are required" });
      }
      const rows = await getTeamSnapshots(leagueId, rId);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ leagueId, rosterId: rId, snapshots: rows });
    } catch (err: any) {
      console.error("[TeamSnapshots] fetch error:", err);
      res.status(500).json({ error: err?.message || "Failed to fetch snapshots" });
    }
  });

  // --- Finance password auth ---

  app.get("/api/auth/finance-has-password/:sleeperId", async (req, res) => {
    try {
      const hasPw = await hasFinancePassword(req.params.sleeperId);
      res.json({ hasPassword: hasPw });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/finance-register", async (req, res) => {
    try {
      const { sleeperId, password, leagueId } = req.body;
      if (!sleeperId || !password) return res.status(400).json({ error: "sleeperId and password required" });
      if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
      const challenge = await verifyChallenge(sleeperId, leagueId ?? undefined);
      if (!challenge.ok) return res.status(401).json({ error: challenge.error });
      await setFinancePassword(sleeperId, password);
      res.json({ token: signToken(sleeperId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/finance-login", async (req, res) => {
    try {
      const { sleeperId, password } = req.body;
      if (!sleeperId || !password) return res.status(400).json({ error: "sleeperId and password required" });
      const valid = await checkFinancePassword(sleeperId, password);
      if (!valid) return res.status(401).json({ error: "Incorrect password." });
      res.json({ token: signToken(sleeperId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Sleeper identity challenge auth for Finance tab (fallback) ---

  app.get("/api/auth/challenge/:userId", (req, res) => {
    const code = createChallenge(req.params.userId);
    res.json({ code });
  });

  app.get("/api/auth/challenge-current/:userId", (req, res) => {
    const code = getChallenge(req.params.userId);
    if (!code) return res.status(404).json({ error: "No active challenge" });
    res.json({ code });
  });

  app.post("/api/auth/verify", async (req, res) => {
    try {
      const { sleeperId } = req.body;
      if (!sleeperId) return res.status(400).json({ error: "sleeperId required" });
      const result = await verifyChallenge(sleeperId);
      if (!result.ok) return res.status(401).json({ error: result.error });
      res.json({ token: signToken(sleeperId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Exchange a Sleeper session (OTP-verified) for a finance JWT.
  // Verifies identity by confirming the user ID exists on the public Sleeper API.
  app.post("/api/auth/sleeper-exchange", async (req, res) => {
    try {
      const { sleeperId } = req.body;
      if (!sleeperId) return res.status(400).json({ error: "sleeperId required" });
      const r = await fetch(`https://api.sleeper.app/v1/user/${sleeperId}`);
      if (!r.ok) return res.status(401).json({ error: "Could not verify Sleeper user" });
      const userData: any = await r.json();
      if (!userData || userData.user_id !== sleeperId) return res.status(401).json({ error: "User ID mismatch" });
      res.json({ token: signToken(sleeperId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Exchange failed" });
    }
  });

  // ── Custom value sets (Value Source Manager) ──────────────────────────────
  // Preview parses + matches without persisting; the parsed rows are kept in
  // a short-lived in-memory cache keyed by a token so the save call doesn't
  // re-upload the CSV.

  const previewCache = new Map<string, { userId: string; rows: ParsedRow[]; expiresAt: number }>();
  const PREVIEW_TTL_MS = 10 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of previewCache.entries()) {
      if (v.expiresAt < now) previewCache.delete(k);
    }
  }, 60 * 1000).unref?.();

  const MAX_CSV_BYTES = 4 * 1024 * 1024;
  const isValueType = (s: unknown): s is ValueType => s === "dynasty" || s === "redraft";

  const requireScUser = (req: any, res: any): string | null => {
    const uid = getUserIdFromRequest(req);
    if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
    return uid;
  };

  app.post("/api/values/custom/preview", async (req, res) => {
    const userId = requireScUser(req, res);
    if (!userId) return;
    try {
      const { csv, valueType } = req.body as { csv?: string; valueType?: string };
      if (!isValueType(valueType)) {
        return res.status(400).json({ error: "valueType must be 'dynasty' or 'redraft'" });
      }
      if (typeof csv !== "string" || csv.length === 0) {
        return res.status(400).json({ error: "csv body is required" });
      }
      if (csv.length > MAX_CSV_BYTES) {
        return res.status(413).json({ error: `CSV exceeds ${MAX_CSV_BYTES} byte limit` });
      }

      const preview = await previewCsv(csv);
      const token = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      previewCache.set(token, {
        userId,
        rows: preview.rows,
        expiresAt: Date.now() + PREVIEW_TTL_MS,
      });

      res.json({
        token,
        valueType,
        totalRows: preview.totalRows,
        matchedCount: preview.matchedCount,
        unmatchedCount: preview.unmatchedCount,
        invalidCount: preview.invalidCount,
        duplicateCount: preview.duplicateCount,
        matchRate: preview.matchRate,
        sample: preview.sample,
        unmatchedSample: preview.unmatchedSample,
        invalidSample: preview.invalidSample,
      });
    } catch (err: any) {
      console.error("[custom-values/preview] error:", err.message);
      res.status(400).json({ error: err.message || "Failed to parse CSV" });
    }
  });

  app.post("/api/values/custom/save", async (req, res) => {
    const userId = requireScUser(req, res);
    if (!userId) return;
    try {
      const { token, valueType, name, activate } = req.body as {
        token?: string;
        valueType?: string;
        name?: string;
        activate?: boolean;
      };
      if (!isValueType(valueType)) return res.status(400).json({ error: "valueType must be 'dynasty' or 'redraft'" });
      if (!token) return res.status(400).json({ error: "token is required" });

      const cached = previewCache.get(token);
      if (!cached || cached.userId !== userId) {
        return res.status(404).json({ error: "Preview expired. Please re-upload the CSV." });
      }

      const result = await saveValueSet({
        userId,
        valueType,
        name: (name && name.trim()) || `Custom ${valueType} values`,
        rows: cached.rows,
        activate: activate !== false,
      });

      previewCache.delete(token);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[custom-values/save] error:", err.message);
      res.status(500).json({ error: err.message || "Failed to save value set" });
    }
  });

  app.get("/api/values/custom/sets", async (req, res) => {
    const userId = requireScUser(req, res);
    if (!userId) return;
    try {
      const sets = await listValueSets(userId);
      res.json({ sets });
    } catch (err: any) {
      console.error("[custom-values/sets] error:", err.message);
      res.status(500).json({ error: err.message || "Failed to list value sets" });
    }
  });

  app.post("/api/values/custom/sets/:id/activate", async (req, res) => {
    const userId = requireScUser(req, res);
    if (!userId) return;
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      await activateValueSet(userId, id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to activate value set" });
    }
  });

  app.post("/api/values/custom/deactivate", async (req, res) => {
    const userId = requireScUser(req, res);
    if (!userId) return;
    try {
      const { valueType } = req.body as { valueType?: string };
      if (!isValueType(valueType)) return res.status(400).json({ error: "valueType must be 'dynasty' or 'redraft'" });
      await deactivateValueSet(userId, valueType);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to deactivate" });
    }
  });

  app.delete("/api/values/custom/sets/:id", async (req, res) => {
    const userId = requireScUser(req, res);
    if (!userId) return;
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      await deleteValueSet(userId, id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete value set" });
    }
  });

  // Resolved view for the client-side context — returns the active dynasty
  // and redraft maps (if any) keyed by sleeper id and by name+pos so the
  // context can layer them over FantasyCalc.
  app.get("/api/values/custom/resolved", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      // Not authenticated: behave like an empty set so unauthenticated UIs
      // still render with pure FantasyCalc.
      return res.json({ dynasty: null, redraft: null });
    }
    try {
      const resolved = await getResolvedValues(userId);
      res.json(resolved);
    } catch (err: any) {
      console.error("[custom-values/resolved] error:", err.message);
      res.status(500).json({ error: err.message || "Failed to resolve values" });
    }
  });

  // Health probe matching the playoff-calculator one — confirms /api/adp/*
  // is reachable independent of the snapshot/Sleeper chain. Must be defined
  // before /api/adp so it isn't shadowed by the catch-all query handler.
  app.get("/api/adp/health", (_req, res) => {
    res.json({ ok: true, route: "adp", ts: Date.now() });
  });

  // ── NFL week schedule (kickoff times + game state) ─────────────────────────
  // Proxies the public ESPN scoreboard so the Lineup Command engine can lock
  // players whose game has started. Returns { TEAM: { start: ms, state } } where
  // state is 'pre' | 'in' | 'post'. Cached 5 min. On upstream failure returns
  // {} so the client treats everyone as unlocked rather than erroring.
  app.get("/api/schedule", async (req, res) => {
    try {
      const season = String(req.query.season ?? "").trim();
      const week = String(req.query.week ?? "").trim();
      if (!/^\d{4}$/.test(season) || !/^\d{1,2}$/.test(week)) {
        return res.status(400).json({ error: "season (YYYY) and week (N) are required" });
      }
      const cacheKey = `${season}-${week}`;
      const cached = scheduleCache.get(cacheKey);
      if (cached) {
        res.setHeader("Cache-Control", "public, max-age=300");
        return res.json(cached);
      }

      // seasontype=2 → regular season.
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${encodeURIComponent(week)}&seasontype=2&year=${encodeURIComponent(season)}`;
      const espn = await fetch(url);
      if (!espn.ok) throw new Error(`ESPN scoreboard ${espn.status}`);
      const data: any = await espn.json();

      const schedule: Record<string, { start: number; state: "pre" | "in" | "post" }> = {};
      for (const event of (data?.events ?? []) as any[]) {
        const comp = event?.competitions?.[0];
        const stateRaw = comp?.status?.type?.state ?? event?.status?.type?.state ?? "pre";
        const state: "pre" | "in" | "post" = stateRaw === "in" ? "in" : stateRaw === "post" ? "post" : "pre";
        const start = Date.parse(event?.date ?? comp?.date ?? "") || 0;
        for (const c of (comp?.competitors ?? []) as any[]) {
          const abbr = c?.team?.abbreviation;
          if (abbr) schedule[String(abbr).toUpperCase()] = { start, state };
        }
      }

      scheduleCache.set(cacheKey, schedule);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(schedule);
    } catch (err: any) {
      console.error("[/api/schedule] error:", err?.message);
      // Degrade gracefully — empty schedule means "no one is locked".
      res.json({});
    }
  });

  // Corpus-wide ADP totals for the explorer banner (total drafts ingested).
  // Defined before the /api/adp catch-all so it isn't shadowed. Cached briefly.
  app.get("/api/adp/stats", async (_req, res) => {
    try {
      const stats = await getAdpStats();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(stats);
    } catch (err: any) {
      console.error("[ADP /api/adp/stats] error:", err);
      res.status(500).json({ error: err?.message || "Failed to load ADP stats" });
    }
  });

  // ── ADP: cached read endpoint ─────────────────────────────────────────────
  // Filters arrive as query params and map 1:1 onto AdpFilters. The handler
  // never reaches out to Sleeper — it serves the most recent adp_snapshots
  // row for the keyed filter set, with a fallback to computing live against
  // our own draft_picks table when no snapshot exists yet.
  //
  // Response shape:
  //   { items: AdpRow[],
  //     meta: { computed_at, draft_count, pick_count, filter_key,
  //             is_empty, cached, snapshot_date, message?, filters } }
  //
  // We never 500 for "no data ingested yet" — that case returns 200 with
  // is_empty=true so the frontend can render an empty state instead of an
  // error banner.
  app.get("/api/adp", async (req, res) => {
    const startMs = Date.now();
    try {
      const q = req.query;
      const num = (v: unknown) => {
        if (v === undefined || v === null || v === "" || v === "all") return undefined;
        const n = parseInt(String(v), 10);
        return Number.isFinite(n) ? n : undefined;
      };
      const str = <T extends string>(v: unknown, allowed: readonly T[]): T | "all" | undefined => {
        if (v === undefined || v === null || v === "") return undefined;
        const s = String(v);
        if (s === "all") return "all";
        return (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
      };

      // Season parsing — accepts:
      //   ?season=2026          → string
      //   ?season=2026,2025     → comma-list expanded to array
      //   ?season=all           → no season filter (admin tooling)
      //   omitted               → defaults to current year inside AdpFilters
      const parseSeason = (v: unknown): AdpFilters["season"] => {
        if (v === undefined || v === null || v === "") return undefined;
        const s = String(v).trim();
        if (s === "all") return "all";
        if (s.includes(",")) {
          const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
          return parts.length > 1 ? parts : parts[0];
        }
        return s;
      };

      const filters: AdpFilters = {
        season: parseSeason(q.season),
        draftType: str(q.draftType, ["startup", "rookie", "supplemental"] as const) ?? "startup",
        draftFormat: str(q.draftFormat, ["snake", "auction", "linear"] as const) ?? "snake",
        scoring: str(q.scoring, ["ppr", "half", "standard"] as const) ?? "all",
        superflex: str(q.superflex, ["yes", "no"] as const) ?? "all",
        tePremium: str(q.tePremium, ["yes", "no"] as const) ?? "all",
        bestBall: str(q.bestBall, ["yes", "no"] as const) ?? "all",
        leagueMode: str(q.leagueMode, ["dynasty", "keeper", "redraft"] as const) ?? "dynasty",
        teams: num(q.teams) ?? "all",
        rookieMode: (str(q.rookieMode, ["picks", "direct", "both"] as const) ?? "direct") as AdpFilters["rookieMode"],
        passTd: (num(q.passTd) === 6 ? 6 : num(q.passTd) === 4 ? 4 : "all") as AdpFilters["passTd"],
        startDate: typeof q.startDate === "string" ? q.startDate : undefined,
        endDate: typeof q.endDate === "string" ? q.endDate : undefined,
      };

      console.log("[ADP /api/adp] query:", q);
      console.log("[ADP /api/adp] filters:", filters);

      const result = await getAdp(filters);

      console.log(
        `[ADP /api/adp] key=${result.filterKey} cached=${result.cached} ` +
        `drafts=${result.draftCount} picks=${result.pickCount} rows=${result.rows.length} ` +
        `in ${Date.now() - startMs}ms`
      );

      const isEmpty = result.rows.length === 0;
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({
        items: result.rows,
        meta: {
          computed_at: isEmpty && result.draftCount === 0 ? null : result.computedAt,
          draft_count: result.draftCount,
          pick_count: result.pickCount,
          filter_key: result.filterKey,
          is_empty: isEmpty,
          cached: result.cached,
          snapshot_date: result.snapshotDate,
          message: isEmpty && result.draftCount === 0
            ? "No ADP data has been ingested yet."
            : undefined,
          filters,
        },
      });
    } catch (err: any) {
      console.error("[ADP /api/adp] error:", err?.stack || err);
      res.status(500).json({
        items: [],
        meta: {
          computed_at: null,
          draft_count: 0,
          pick_count: 0,
          filter_key: null,
          is_empty: true,
          cached: false,
          snapshot_date: null,
          message: err?.message || "Failed to fetch ADP",
          error: true,
        },
      });
    }
  });

  /**
   * Admin authorization gate — passes if EITHER:
   *   1. `x-admin-secret` header matches `process.env.ADMIN_SECRET`, OR
   *   2. The request has a valid DC session whose email is in the
   *      ADMIN_EMAILS allowlist (see shared/admin.ts).
   * Replies 403 and returns false on failure so callers can early-return.
   */
  const requireAdmin = async (req: any, res: any): Promise<boolean> => {
    const secret = process.env.ADMIN_SECRET;
    const provided = req.headers["x-admin-secret"];
    if (secret && typeof provided === "string" && provided === secret) return true;

    let userId: string | null = null;
    let userEmail: string | null = null;
    try {
      userId = getUserIdFromRequest(req);
      if (userId) {
        const user = await getUser(userId);
        userEmail = user?.email ?? null;
        if (user && isAdminByEmail(user.email)) {
          req.adminEmail = user.email;
          return true;
        }
      }
    } catch (err: any) {
      console.error("[requireAdmin] auth check threw:", err?.message);
    }

    // Specific reason so the panel can tell the user what to do next.
    const reason = !userId
      ? "Not signed in — log in to a StatChasers admin account and retry."
      : !userEmail
        ? "Signed in but the user record has no email."
        : `Email ${userEmail} is not in the admin allowlist.`;
    console.warn(`[requireAdmin] denied: ${reason}`);
    res.status(403).json({ error: "Forbidden", reason });
    return false;
  };

  app.post("/api/admin/adp/ingest-draft/:draftId", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const result = await ingestDraftById(req.params.draftId);
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] adp/ingest-draft error:", err);
      res.status(500).json({ error: err.message || "Ingest failed" });
    }
  });

  app.post("/api/admin/adp/ingest-league/:leagueId", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const result = await ingestLeagueDrafts(req.params.leagueId);
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] adp/ingest-league error:", err);
      res.status(500).json({ error: err.message || "Ingest failed" });
    }
  });

  app.post("/api/admin/adp/ingest-user", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const { username, season } = req.body || {};
      if (!username) return res.status(400).json({ error: "username is required" });
      const result = await ingestUserDrafts(username, season || "2026");
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] adp/ingest-user error:", err);
      res.status(500).json({ error: err.message || "Ingest failed" });
    }
  });

  app.post("/api/admin/adp/ingest-crawled", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const limit = parseInt((req.body?.limit ?? req.query?.limit ?? "100") as string, 10) || 100;
      const result = await ingestCrawledLeagueDrafts(limit);
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] adp/ingest-crawled error:", err);
      res.status(500).json({ error: err.message || "Ingest failed" });
    }
  });

  // ── Passive ADP enrichment (public — no auth required) ───────────────────
  // Called by the read-only Sleeper header connect after the client resolves
  // a username to a Sleeper user_id. The authed connect path
  // (/api/sc-auth/connect-sleeper) calls enqueueSleeperUser directly. Both
  // routes share the same 7-day cooldown gate inside enqueueSleeperUser so
  // repeated calls for the same user don't double-queue or pile up events.
  app.post("/api/adp/passive-enrich", async (req, res) => {
    try {
      const { sleeperUserId, sleeperUsername } = (req.body ?? {}) as {
        sleeperUserId?: string;
        sleeperUsername?: string;
      };
      if (!sleeperUserId || !/^\d{6,20}$/.test(sleeperUserId)) {
        return res.status(400).json({ error: "Valid sleeperUserId is required" });
      }
      const result = await enqueueSleeperUser(sleeperUserId, {
        sleeperUsername,
        source: "readonly_connect_depth1",
      });
      res.json(result);
    } catch (err: any) {
      console.warn("[adp passive-enrich] error:", err?.message);
      // Never bubble up — the connect UX must not depend on this succeeding.
      res.json({ enqueued: false, eventId: null, reason: "error" });
    }
  });

  // ── ADP crawler admin endpoints ───────────────────────────────────────────
  app.get("/api/admin/adp/passive-events", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
      const events = await getPassiveCrawlEvents(limit);
      res.json({ events });
    } catch (err: any) {
      console.error("[Admin] adp/passive-events error:", err);
      res.status(500).json({ error: err.message || "List passive events failed" });
    }
  });

  app.post("/api/admin/adp/passive-events/recrawl", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const { sleeperUserId, sleeperUsername } = (req.body ?? {}) as {
        sleeperUserId?: string;
        sleeperUsername?: string;
      };
      if (!sleeperUserId) return res.status(400).json({ error: "sleeperUserId is required" });
      const result = await enqueueSleeperUser(sleeperUserId, {
        sleeperUsername,
        source: "admin_recrawl",
        force: true,
      });
      startCrawlWorker();
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] passive-events/recrawl error:", err);
      res.status(500).json({ error: err.message || "Recrawl failed" });
    }
  });

  app.post("/api/admin/adp/seed", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const body = (req.body ?? {}) as SeedInput;
      if (!body.text && !(body.items && body.items.length > 0)) {
        return res.status(400).json({ error: "Provide 'text' (paste) or 'items' (structured list)" });
      }
      const result = await enqueueSeeds(body);
      startCrawlWorker();
      res.json({ ok: true, ...result, message: `Queued ${result.queueAdded} crawl items from ${result.seedsAdded} seeds.` });
    } catch (err: any) {
      console.error("[Admin] adp/seed error:", err);
      res.status(500).json({ error: err.message || "Seed enqueue failed" });
    }
  });

  app.get("/api/admin/adp/crawl-status", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const status = await getAdpCrawlStatus();
      res.json(status);
    } catch (err: any) {
      console.error("[Admin] adp/crawl-status error:", err);
      res.status(500).json({ error: err.message || "Status failed" });
    }
  });

  app.post("/api/admin/adp/crawl-retry-failed", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const result = await resetFailedQueueItems();
      startCrawlWorker();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Retry failed" });
    }
  });

  app.post("/api/admin/adp/backfill-league-scoring", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const result = await backfillLeagueScoring();
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] adp/backfill-league-scoring error:", err);
      res.status(500).json({ error: err.message || "Backfill failed" });
    }
  });

  /**
   * POST /api/admin/adp/reclassify
   *
   * Walks every stored draft, recomputes per-pick isRookiePlaceholder and
   * per-draft rookieMode using the new helpers in adp.ts, and clears the
   * snapshot cache so the next read sees fresh aggregations. Use this after
   * the rookie-mode classification bug fix to repair existing data.
   */
  app.post("/api/admin/adp/reclassify", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const result = await reclassifyAdpDrafts();
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] adp/reclassify error:", err);
      res.status(500).json({ error: err.message || "Reclassify failed" });
    }
  });

  // Alias: same handler under the more explicit name the data-repair spec
  // uses. Keeps both endpoints live so existing UI / scripts don't break.
  app.post("/api/admin/adp/reclassify-drafts", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const result = await reclassifyAdpDrafts();
      // Trigger a default-snapshot refresh so the freshly-included/excluded
      // counts are immediately reflected in ADP Explorer reads.
      refreshDefaultSnapshots().catch((err) =>
        console.error("[Admin] post-reclassify refresh failed:", err)
      );
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] adp/reclassify-drafts error:", err);
      res.status(500).json({ error: err.message || "Reclassify failed" });
    }
  });

  // Status / debug view — exposes draft inclusion vs. exclusion counts so
  // the ADP admin tools can show "X drafts total / Y included / Z excluded".
  app.get("/api/admin/adp/status", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const status = await getAdpInclusionStatus();
      res.json(status);
    } catch (err: any) {
      console.error("[Admin] adp/status error:", err);
      res.status(500).json({ error: err.message || "Status failed" });
    }
  });

  app.post("/api/admin/adp/refresh", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      // If a filter set is provided, refresh just that key; otherwise refresh
      // every default snapshot combo.
      if (req.body && Object.keys(req.body).length > 0) {
        const result = await refreshAdpSnapshot(req.body as AdpFilters);
        return res.json(result);
      }
      const result = await refreshDefaultSnapshots();
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] adp/refresh error:", err);
      res.status(500).json({ error: err.message || "Refresh failed" });
    }
  });

  /**
   * POST /api/admin/adp/cache-clear
   *
   * Wipes every cached ADP snapshot row. Use after fixing a data bug
   * (rookie-classification, season filter, etc.) when you want all reads
   * to recompute from raw picks rather than wait out the 6-hour TTL.
   * The next /api/adp request for any filter will recompute live and
   * re-populate the snapshot row.
   */
  app.post("/api/admin/adp/cache-clear", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const pg = await import("pg");
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      const result = await pool.query("DELETE FROM adp_snapshots");
      await pool.end();
      console.info(`[Admin] adp/cache-clear deleted ${result.rowCount ?? 0} snapshot rows`);
      res.json({ deleted: result.rowCount ?? 0 });
    } catch (err: any) {
      console.error("[Admin] adp/cache-clear error:", err);
      res.status(500).json({ error: err.message || "Cache clear failed" });
    }
  });

  /**
   * POST /api/admin/adp/debug/discover
   *
   * Targeted debug for "why isn't this draft showing up?" — given a seed
   * Sleeper username + season (+ optional leagueId / draftId), walks the
   * public Sleeper endpoints and reports each step's result. Used to
   * verify that the discovery pipeline can reach a specific draft.
   *
   * Body:
   *   { username: string, season: string, leagueId?: string, draftId?: string }
   */
  app.post("/api/admin/adp/debug/discover", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const body = (req.body ?? {}) as { username?: string; season?: string; leagueId?: string; draftId?: string };
      const username = String(body.username || "").trim();
      const season = String(body.season || new Date().getFullYear()).trim();
      const targetLeagueId = body.leagueId ? String(body.leagueId) : null;
      const targetDraftId = body.draftId ? String(body.draftId) : null;
      if (!username) {
        return res.status(400).json({ error: "username is required" });
      }

      const SLEEPER = "https://api.sleeper.app/v1";
      const fetchJson = async <T>(url: string): Promise<T | null> => {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          return (await r.json()) as T;
        } catch {
          return null;
        }
      };

      const trace: any = { username, season, targetLeagueId, targetDraftId, steps: {} };

      // Step 1: username → user_id
      const userRaw = await fetchJson<{ user_id?: string; username?: string; display_name?: string }>(
        `${SLEEPER}/user/${encodeURIComponent(username)}`,
      );
      trace.steps.userLookup = {
        url: `${SLEEPER}/user/${username}`,
        userId: userRaw?.user_id ?? null,
        resolvedUsername: userRaw?.username ?? null,
        ok: !!userRaw?.user_id,
      };
      if (!userRaw?.user_id) {
        trace.skipReason = "Sleeper /user/{username} returned no user_id";
        return res.json(trace);
      }

      // Step 2: user_id + season → leagues
      const leaguesRaw = await fetchJson<Array<{ league_id: string; name: string; season: string }>>(
        `${SLEEPER}/user/${userRaw.user_id}/leagues/nfl/${encodeURIComponent(season)}`,
      );
      const leagues = leaguesRaw ?? [];
      trace.steps.leagueList = {
        url: `${SLEEPER}/user/${userRaw.user_id}/leagues/nfl/${season}`,
        count: leagues.length,
        names: leagues.map((l) => ({ leagueId: l.league_id, name: l.name, season: l.season })),
        targetFound: targetLeagueId ? leagues.some((l) => l.league_id === targetLeagueId) : null,
      };

      // Step 3: per-league drafts (limit work to target league when provided)
      const leaguesToInspect = targetLeagueId
        ? leagues.filter((l) => l.league_id === targetLeagueId)
        : leagues.slice(0, 5);
      trace.steps.leagueDrafts = [];
      for (const lg of leaguesToInspect) {
        const drafts = await fetchJson<Array<any>>(`${SLEEPER}/league/${lg.league_id}/drafts`);
        trace.steps.leagueDrafts.push({
          leagueId: lg.league_id,
          leagueName: lg.name,
          season: lg.season,
          drafts: (drafts ?? []).map((d) => ({
            draftId: d.draft_id,
            type: d.type,
            status: d.status,
            season: d.season,
            settings: d.settings,
            metadataKeys: d.metadata ? Object.keys(d.metadata) : [],
          })),
        });
      }

      // Step 4: deep inspect a specific draft id when provided
      if (targetDraftId) {
        const draftRaw = await fetchJson<any>(`${SLEEPER}/draft/${targetDraftId}`);
        const picksRaw = await fetchJson<any[]>(`${SLEEPER}/draft/${targetDraftId}/picks`);
        const picksMade = (picksRaw ?? []).filter((p: any) => p?.player_id).length;
        trace.steps.draftDetail = {
          draftId: targetDraftId,
          draftType: draftRaw?.type ?? null,
          draftStatus: draftRaw?.status ?? null,
          draftSeason: draftRaw?.season ?? null,
          settings: draftRaw?.settings ?? null,
          metadata: draftRaw?.metadata ?? null,
          totalPicks: picksRaw?.length ?? 0,
          picksMade,
        };

        // Check storage state
        const pg = await import("pg");
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
        const storedQ = await pool.query(
          "SELECT draft_id, season, status, draft_type, excluded_from_adp FROM drafts WHERE draft_id = $1",
          [targetDraftId],
        );
        const picksStoredQ = await pool.query(
          "SELECT COUNT(*)::int AS n FROM draft_picks WHERE draft_id = $1",
          [targetDraftId],
        );
        await pool.end();
        trace.steps.storedState = {
          draftRow: storedQ.rows[0] ?? null,
          storedPickCount: picksStoredQ.rows[0]?.n ?? 0,
        };

        // Infer skip reason matching adp.ts ingestDraftById gates.
        const skipReasons: string[] = [];
        if (!draftRaw) skipReasons.push("Sleeper /draft/{id} returned no payload");
        else {
          const completed = draftRaw.status === "complete" || picksMade >= (draftRaw.settings?.teams ?? 12) * (draftRaw.settings?.rounds ?? 4);
          if (!completed) skipReasons.push(`status='${draftRaw.status}' — only 'complete' drafts contribute to ADP`);
          const teams = draftRaw.settings?.teams ?? 0;
          const rounds = draftRaw.settings?.rounds ?? 0;
          const draftType = (() => {
            if (rounds <= 6) return "rookie";
            return "startup";
          })();
          const minTeams = 8;
          const minRounds = draftType === "startup" ? 8 : 3;
          if (teams < minTeams) skipReasons.push(`teams=${teams} below minimum ${minTeams}`);
          if (rounds < minRounds) skipReasons.push(`rounds=${rounds} below minimum ${minRounds} (for draftType=${draftType})`);
          const enoughPicks = picksMade >= teams * rounds * 0.6;
          if (!enoughPicks) skipReasons.push(`picksMade=${picksMade} < 60% of teams*rounds (${teams * rounds})`);
        }
        trace.likelySkipReasons = skipReasons;
      }

      res.json(trace);
    } catch (err: any) {
      console.error("[Admin] adp/debug/discover error:", err);
      res.status(500).json({ error: err.message || "Discover debug failed" });
    }
  });

  /**
   * POST /api/admin/adp/crawl-network
   *
   * 2-hop ADP discovery crawl starting from a seed Sleeper username. Uses
   * only public/read-only Sleeper endpoints. Bounded by safety caps; cannot
   * exceed depth 2 without a code change. Refreshes default ADP snapshots
   * on completion so the Draft Command UI picks up the new data.
   *
   * Body:
   *   {
   *     "seedUsername":    string,                   // required
   *     "seasons":         string[],                 // default ["2026","2025","2024"]
   *     "maxDepth":        0 | 1 | 2,                // default 2
   *     "draftCategories": ("startup"|"rookie")[],   // optional filter
   *     "refreshSnapshots": boolean,                 // default true
   *     "maxUsers":        number,                   // default 500
   *     "maxLeagues":      number,                   // default 2500
   *     "maxDrafts":       number,                   // default 1000
   *     "maxRequests":     number                    // default 25000
   *   }
   *
   * Runs synchronously — for large depth-2 crawls expect minutes of wall time.
   * Consider invoking from a controlled script rather than a UI button.
   */
  app.post("/api/admin/adp/crawl-network", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const body = (req.body ?? {}) as {
        seedUsername?: string;
        seasons?: unknown;
        maxDepth?: unknown;
        draftCategories?: unknown;
        refreshSnapshots?: unknown;
        maxUsers?: unknown;
        maxLeagues?: unknown;
        maxDrafts?: unknown;
        maxRequests?: unknown;
      };

      // ── Validation ────────────────────────────────────────────────────────
      if (!body.seedUsername || typeof body.seedUsername !== "string" || !body.seedUsername.trim()) {
        return res.status(400).json({ error: "seedUsername is required" });
      }

      const rawSeasons = Array.isArray(body.seasons)
        ? body.seasons.filter((s): s is string => typeof s === "string" && /^\d{4}$/.test(s))
        : [];
      if (rawSeasons.length === 0) {
        return res.status(400).json({ error: "At least one season is required" });
      }

      const validCats: DraftCategory[] = ["startup", "rookie", "unknown"];
      const rawCats = Array.isArray(body.draftCategories)
        ? body.draftCategories.filter((c: any): c is DraftCategory => validCats.includes(c))
        : [];
      if (rawCats.length === 0) {
        return res.status(400).json({ error: "At least one draft category is required" });
      }

      const rawDepth = Number(body.maxDepth);
      const maxDepth = Number.isFinite(rawDepth) ? Math.min(2, Math.max(0, Math.floor(rawDepth))) : 2;

      // ── Start log ─────────────────────────────────────────────────────────
      console.log("[NetworkCrawl] request received", {
        seedUsername: body.seedUsername.trim(),
        seasons: rawSeasons,
        maxDepth,
        draftCategories: rawCats,
        maxUsers: typeof body.maxUsers === "number" ? body.maxUsers : "default",
        maxLeagues: typeof body.maxLeagues === "number" ? body.maxLeagues : "default",
        maxDrafts: typeof body.maxDrafts === "number" ? body.maxDrafts : "default",
      });

      // Kick off the crawl as a server-side background job and return the
      // initial live-state immediately. The HTTP handler does NOT await the
      // crawl — that's what kept the previous request open for the full
      // duration and made tab-switching look like the work had stopped.
      // The UI polls /api/admin/adp/crawl-network/progress for updates.
      const state = startCrawlInBackground({
        seedUsername: body.seedUsername.trim(),
        seasons: rawSeasons,
        maxDepth,
        draftCategories: rawCats,
        refreshSnapshots: body.refreshSnapshots !== false,
        maxUsers: typeof body.maxUsers === "number" ? body.maxUsers : undefined,
        maxLeagues: typeof body.maxLeagues === "number" ? body.maxLeagues : undefined,
        maxDrafts: typeof body.maxDrafts === "number" ? body.maxDrafts : undefined,
        maxRequests: typeof body.maxRequests === "number" ? body.maxRequests : undefined,
      });

      res.json({ jobId: state.jobId, state });
    } catch (err: any) {
      console.error("[Admin] adp/crawl-network error:", err);
      res.status(500).json({ error: err?.message || "Crawl failed" });
    }
  });

  /**
   * Live progress for the most recent network crawl. UI polls this every
   * ~1.5s while a crawl is running, and once on mount to detect a crawl
   * that was started before the panel was opened.
   */
  app.get("/api/admin/adp/crawl-network/progress", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    res.json(getCrawlLiveState());
  });

  /**
   * POST /api/admin/adp/crawl-network/cancel
   *
   * Asks the in-flight crawl to stop. The crawl loop checks the flag at
   * each BFS iteration boundary and returns gracefully — any drafts already
   * ingested stay, the live state moves to `cancelled`, and the next
   * /progress poll surfaces the new status to the UI.
   */
  app.post("/api/admin/adp/crawl-network/cancel", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const flagged = requestCrawlCancel();
    res.json({ ok: true, flagged, state: getCrawlLiveState() });
  });

  /**
   * POST /api/admin/adp/crawl-network/repair
   *
   * Admin recovery hatch for the "drafts in DB but not visible/usable"
   * failure mode. Runs two sweeps:
   *
   *   1) Crash recovery — any adp_crawl_log row stuck in status="running"
   *      past the inactivity threshold is flipped to "failed" with a
   *      recovery message. Any adp_crawl_queue row stuck in "processing" is
   *      reset to "pending".
   *
   *   2) Orphan draft cleanup — finds draft rows marked complete (and not
   *      intentionally excluded) whose pick count is missing or below the
   *      60% threshold, and deletes them so the next crawl re-ingests
   *      cleanly. IDP-excluded and quality-filter drafts are left alone.
   *
   * Pass `?dryRun=true` to count without deleting.
   */
  app.post("/api/admin/adp/crawl-network/repair", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const dryRun = req.query.dryRun === "true" || req.body?.dryRun === true;
      const recovery = await recoverAdpCrawlState();
      const drafts = await repairIncompleteDrafts({ dryRun });
      res.json({ ok: true, dryRun, recovery, drafts });
    } catch (err: any) {
      console.error("[Admin] adp/crawl-network/repair error:", err);
      res.status(500).json({ error: err?.message || "Repair failed" });
    }
  });

  app.post("/api/admin/cleanup-one-sided-trades", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const result = await cleanupOneSidedTrades();
      console.log(`[Admin] Cleaned up ${result.deleted} one-sided trades`);
      res.json({ ok: true, deleted: result.deleted });
    } catch (err: any) {
      console.error("[Admin] cleanup-one-sided-trades error:", err);
      res.status(500).json({ error: err.message || "Cleanup failed" });
    }
  });

  // ── Unified scheduled crawler (trades + drafts) ──────────────────────────
  app.get("/api/admin/unified-crawl/status", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const [runs, totals] = await Promise.all([
        getUnifiedCrawlRuns(20),
        getUnifiedCrawlTotals(),
      ]);
      // schedulerEnabled reflects the env gate at routes.ts (ENABLE_CRAWLER);
      // running is the in-process "a run is happening right now" flag.
      res.json({
        running: isUnifiedCrawlRunning(),
        schedulerEnabled: process.env.ENABLE_CRAWLER === "true",
        totals,
        runs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get unified-crawl status" });
    }
  });

  app.post("/api/admin/unified-crawl/run-once", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    if (isUnifiedCrawlRunning()) {
      return res.json({ ok: true, started: false, reason: "already-running" });
    }
    // Fire-and-forget — a full run can take a while; the run-log row tracks it.
    runUnifiedCrawlOnce().catch((err) =>
      console.error("[UnifiedCrawl] Manual run errored:", err),
    );
    res.json({ ok: true, started: true });
  });

  startSnapshotScheduler();
  startAdpScheduler();
  // The old ADP passive-crawl queue worker is retired in favor of the unified
  // scheduled crawler below, which gathers BOTH trades and drafts. (The worker
  // can still be started manually via the admin endpoints for debugging.)
  //
  // Gate auto-crawling to the published website only: it runs solely when
  // ENABLE_CRAWLER=true is set in the deployment's secrets. The Replit instance
  // leaves this unset, so it never crawls (avoids double Sleeper API load). The
  // manual /api/admin/unified-crawl/run-once endpoint still works everywhere.
  // Reconcile any run left stranded in "running" by a previous process before
  // the scheduler can start a fresh one, so the audit log is truthful and the
  // admin panel doesn't show perpetual zombie runs. Fire-and-forget.
  recoverUnifiedCrawlRuns().catch((err) =>
    console.error("[UnifiedCrawl] startup recovery failed:", err?.message),
  );

  if (process.env.ENABLE_CRAWLER === "true") {
    startUnifiedCrawler();
  } else if (process.env.NODE_ENV === "production") {
    // Loud warning: in production the crawler being off means NO trades or
    // drafts are gathered automatically. This is the #1 silent-failure mode —
    // make it impossible to miss in the deploy logs.
    console.warn(
      "[UnifiedCrawl] ⚠️  WARNING: auto-crawling is DISABLED in production. " +
      "No new trades/drafts will be gathered. Set ENABLE_CRAWLER=true in this " +
      "deployment's secrets and redeploy to enable background crawling.",
    );
  } else {
    console.log("[UnifiedCrawl] Scheduler disabled (set ENABLE_CRAWLER=true to enable auto-crawling)");
  }

  // Reap any scan log row or queue item that the previous process left
  // dangling. Without this, a crashed scan stays in status="running"
  // forever — blocking the in-flight guard and hiding the failure from
  // the audit log. Fire-and-forget so a recovery error doesn't break boot.
  recoverAdpCrawlState().catch((err) => {
    console.error("[ADP recovery] startup sweep failed:", err);
  });

  // One-time cleanup: remove one-sided trades stored before the UNNEST query fix.
  // Disable by setting SKIP_ONESIDED_CLEANUP=true once production confirms remaining=0.
  if (process.env.SKIP_ONESIDED_CLEANUP !== "true") {
    cleanupOneSidedTrades().catch((err) => {
      console.error("[Cleanup] cleanupOneSidedTrades error:", err);
    });
  }

  // Clean up any future-pick slots that were incorrectly stored with the
  // current year's draft order, then run the per-season slot backfill.
  cleanupFuturePickSlots().catch(() => {});
  backfillPickSlots().then((r) => {
    if (r.updated > 0) {
      console.log(`[PickSlots] Backfilled ${r.updated} pick assets across ${r.leagues} leagues.`);
    }
  }).catch(() => {});

  // ── Feedback endpoint ───────────────────────────────────────────────────────
  app.post("/api/feedback", async (req, res) => {
    try {
      const { type, message, email, screenshot, screenshotName, context } = req.body as {
        type?: string;
        message?: string;
        email?: string | null;
        screenshot?: string | null;
        screenshotName?: string | null;
        context?: Record<string, any>;
      };

      if (!message?.trim()) {
        return res.status(400).json({ error: "Message is required." });
      }

      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

      if (webhookUrl) {
        const typeEmoji: Record<string, string> = {
          bug: "🐛", feature: "💡", general: "💬", question: "❓",
        };
        const typeLabel: Record<string, string> = {
          bug: "Bug Report", feature: "Feature Request", general: "General Feedback", question: "Question",
        };
        const emoji = typeEmoji[type ?? "general"] ?? "💬";
        const label = typeLabel[type ?? "general"] ?? "Feedback";

        const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
        if (context?.tab)             fields.push({ name: "📍 Tab",       value: String(context.tab),            inline: true  });
        if (context?.leagueId)        fields.push({ name: "🏈 League ID", value: `\`${context.leagueId}\``,     inline: true  });
        if (context?.sleeperUsername) fields.push({ name: "😴 Sleeper",   value: `@${context.sleeperUsername}`, inline: true  });
        if (email)                    fields.push({ name: "📧 Email",      value: email,                         inline: true  });
        if (context?.browser)         fields.push({ name: "🖥 Browser",    value: String(context.browser),       inline: true  });
        if (context?.route)           fields.push({ name: "🔗 Route",      value: `\`${context.route}\``,        inline: false });
        if (context?.timestamp)       fields.push({ name: "🕐 Time",       value: String(context.timestamp),     inline: false });

        const embed = {
          title: `${emoji} New ${label}`,
          description: message.trim(),
          color: 0xd4af37,
          fields,
          footer: { text: "Dynasty Command · StatChasers" },
        };

        if (screenshot && screenshotName) {
          const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, "");
          const mimeMatch = screenshot.match(/^data:(image\/\w+);base64,/);
          const mimeType = mimeMatch?.[1] ?? "image/png";
          const buffer = Buffer.from(base64Data, "base64");

          const FormData = (await import("form-data")).default;
          const form = new FormData();
          form.append("file", buffer, { filename: screenshotName, contentType: mimeType });
          form.append("payload_json", JSON.stringify({ embeds: [embed] }));

          const { default: nodeFetch } = await import("node-fetch");
          const wRes = await nodeFetch(webhookUrl, { method: "POST", body: form as any, headers: form.getHeaders() });
          if (!wRes.ok) throw new Error(`Discord webhook error: ${wRes.status}`);
        } else {
          const wRes = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] }),
          });
          if (!wRes.ok) throw new Error(`Discord webhook error: ${wRes.status}`);
        }
      } else {
        console.log("[Feedback]", JSON.stringify({ type, message, email, context }, null, 2));
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[feedback] error:", err.message);
      res.status(500).json({ error: "Failed to submit feedback. Please try again." });
    }
  });

  return httpServer;
}
