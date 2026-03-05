import type { Express } from "express";
import { createServer, type Server } from "http";
import { getFantasyCalcValues } from "./fantasycalc";
import {
  fetchSleeperUser,
  fetchSleeperLeagues,
  fetchSleeperLeagueFull,
  fetchPortfolioSummary,
} from "./sleeper";

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
      const season = (req.query.season as string) || "2025";
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
      const season = (req.query.season as string) || "2025";
      const leagues = await fetchSleeperLeagues(req.params.userId, season);
      const summary = await fetchPortfolioSummary(req.params.userId, leagues);
      res.json(summary);
    } catch (err: any) {
      console.error("Portfolio summary error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch portfolio summary" });
    }
  });

  return httpServer;
}
