import type { Express } from "express";
import { createServer, type Server } from "http";
import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalc";
import {
  fetchSleeperUser,
  fetchSleeperLeagues,
  fetchSleeperLeagueFull,
  fetchPortfolioSummary,
} from "./sleeper";
import {
  startCrawl,
  pauseCrawl,
  resumeCrawl,
  getCrawlStatus,
  searchTrades,
  getTradeStats,
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
