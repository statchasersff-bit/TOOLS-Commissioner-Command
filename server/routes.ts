import type { Express } from "express";
import { createServer, type Server } from "http";
import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalc";
import {
  fetchSleeperUser,
  fetchSleeperLeagues,
  fetchSleeperLeagueFull,
  fetchPortfolioSummary,
  fetchCrossLeagueTrades,
  fetchDraftBoard,
  detectLiveDrafts,
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
} from "./tradeCrawler";
import {
  captureValueSnapshot,
  getValueChanges,
  getAvailableSnapshotDates,
  startSnapshotScheduler,
} from "./valueSnapshots";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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

  app.get("/api/sleeper/user/:username", async (req, res) => {
    try {
      const user = await fetchSleeperUser(req.params.username);
      res.json(user);
    } catch (err: any) {
      console.error("Sleeper user fetch error:", err);
      const status = err.message === "User not found" ? 404 : 500;
      res.status(status).json({ error: err.message || "Failed to fetch user" });
    }
  });

  app.get("/api/sleeper/user/:userId/leagues", async (req, res) => {
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

  app.get("/api/sleeper/user/:userId/portfolio-summary", async (req, res) => {
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

  app.get("/api/sleeper/draft/:leagueId", async (req, res) => {
    try {
      const { leagueId } = req.params;
      const result = await fetchDraftBoard(leagueId);
      res.json(result);
    } catch (err: any) {
      console.error("Draft board error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch draft board" });
    }
  });

  app.get("/api/sleeper/live-drafts/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const results = await detectLiveDrafts(userId);
      res.json(results);
    } catch (err: any) {
      console.error("Live draft detection error:", err);
      res.status(500).json({ error: err.message || "Failed to detect live drafts" });
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
      const result = await searchTrades({
        q: req.query.q as string,
        format: req.query.format as string,
        scoring: req.query.scoring as string,
        leagueSize: req.query.leagueSize ? parseInt(req.query.leagueSize as string) : undefined,
        season: req.query.season as string,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      });
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
      const stats = await getTradeStats();
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

  startSnapshotScheduler();

  return httpServer;
}
