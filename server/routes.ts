import type { Express } from "express";
import { createServer, type Server } from "http";
import { getFantasyCalcValues } from "./fantasycalc";

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

  return httpServer;
}
