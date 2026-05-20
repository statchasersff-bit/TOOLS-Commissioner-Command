import type { Express } from "express";
import { createServer, type Server } from "http";
import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalc";
import { computePlayoffCalculator, computeWeeklyMatchups } from "./playoffCalculator";
import { getAdpHistory, getAdpAvailability } from "./adpPlayerProfile";
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
  startAdpScheduler,
  backfillLeagueScoring,
  type AdpFilters,
} from "./adp";
import {
  enqueueSeeds,
  startCrawlWorker,
  getCrawlStatus as getAdpCrawlStatus,
  resetFailedQueueItems,
  type SeedInput,
} from "./adpCrawler";
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
import { requireReadOnlySleeperContext } from "./accessMiddleware";
import {
  startCrawlInBackground,
  getCrawlLiveState,
  type DraftCategory,
} from "./adpNetworkCrawl";
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
const searchCache  = makeCache<any>(2 * 60 * 1000);   // 2-min TTL
const playoffCalcCache = makeCache<any>(10 * 60 * 1000); // 10-min TTL
const weeklyMatchupsCache = makeCache<any>(5 * 60 * 1000); // 5-min TTL — live scores need fresher data

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerScAuthRoutes(app);
  registerBillingRoutes(app);
  registerSleeperDraftPickRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", ts: Date.now() });
  });

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

  // Player profile analytics for the ADP Explorer drawer.
  app.get("/api/adp/player/:playerId/history", async (req, res) => {
    try {
      const { playerId } = req.params;
      if (!playerId) return res.status(400).json({ error: "playerId is required" });
      const data = await getAdpHistory(playerId);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(data);
    } catch (err: any) {
      console.error("[AdpPlayerProfile/history] error:", err);
      res.status(500).json({ error: err?.message || "Failed to load ADP history" });
    }
  });

  app.get("/api/adp/player/:playerId/availability", async (req, res) => {
    try {
      const { playerId } = req.params;
      const teams = Math.max(4, Math.min(20, parseInt(String(req.query.teams ?? "12"), 10) || 12));
      const rounds = Math.max(1, Math.min(20, parseInt(String(req.query.rounds ?? "5"), 10) || 5));
      if (!playerId) return res.status(400).json({ error: "playerId is required" });
      const data = await getAdpAvailability(playerId, teams, rounds);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(data);
    } catch (err: any) {
      console.error("[AdpPlayerProfile/availability] error:", err);
      res.status(500).json({ error: err?.message || "Failed to load availability" });
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

      const filters: AdpFilters = {
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

  // ── ADP crawler admin endpoints ───────────────────────────────────────────
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

  startSnapshotScheduler();
  startAdpScheduler();
  startCrawlWorker();

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
