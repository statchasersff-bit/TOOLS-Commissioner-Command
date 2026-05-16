import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");
  if (!fs.existsSync(distPath)) {
    // No static build present — running as API-only backend (e.g. deployed
    // when the frontend is hosted separately on Bluehost).
    console.log("[static] No build directory found — serving API only.");
    return;
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
