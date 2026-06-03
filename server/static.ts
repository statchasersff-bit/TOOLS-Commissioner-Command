import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Normalize a base path to "/segment/" form (leading + trailing slash).
 * Returns "/" for empty/root.
 */
function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw || "/").trim();
  if (!trimmed || trimmed === "/") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

/**
 * Express.static options that defensively force the correct Content-Type for
 * JS and CSS. The mime package usually gets this right, but a misconfigured
 * registry has caused Firefox to reject modules with
 *   "Loading module from … was blocked because of a disallowed MIME type"
 * so we override at the source.
 */
const STATIC_OPTIONS: Parameters<typeof express.static>[1] = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    } else if (filePath.endsWith(".css")) {
      res.setHeader("Content-Type", "text/css; charset=utf-8");
    }
  },
};

// Safe __dirname for both ESM (dev) and CJS (production esbuild output).
declare const __dirname: string | undefined;
const _dirname: string =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export function serveStatic(app: Express) {
  const distPath = path.resolve(_dirname, "../dist/public");
  if (!fs.existsSync(distPath)) {
    // No static build present — running as API-only backend (e.g. deployed
    // when the frontend is hosted separately on Bluehost).
    console.log("[static] No build directory found — serving API only.");
    return;
  }

  // The sub-path the SPA is deployed under (e.g. "/dynasty-command/launch/").
  // MUST match Vite's `base` so the asset URLs emitted in index.html resolve.
  // Set VITE_BASE_PATH (or DEPLOY_BASE_PATH) on both build and server runtime.
  const basePath = normalizeBasePath(
    process.env.VITE_BASE_PATH || process.env.DEPLOY_BASE_PATH
  );
  console.log(`[static] serving build from ${distPath} at base ${basePath}`);

  // Mount static at the sub-path so /<base>/assets/foo.js resolves to
  // dist/public/assets/foo.js. Without this, the request misses the file and
  // falls through to the SPA fallback (which returns HTML with the wrong
  // MIME type — Firefox then refuses to execute the script).
  if (basePath !== "/") {
    app.use(basePath, express.static(distPath, STATIC_OPTIONS));
  }
  // Also mount at root so root deployments and reverse proxies that strip the
  // prefix continue to work.
  app.use(express.static(distPath, STATIC_OPTIONS));

  // SPA fallback — serve index.html for unmatched HTML routes.
  //
  // CRITICAL: never return index.html for an asset request. An unfound
  // /assets/<hash>.js MUST 404 (so the browser surfaces the missing-file
  // error) rather than getting back HTML with text/html, which yields the
  // confusing "disallowed MIME type" message and bricks the SPA load.
  //
  // NOTE: No path argument — registered after all routes so it catches
  // everything that fell through. Avoids the path-to-regexp v8 wildcard
  // crash ("/{*path}" / "*" both throw in Express 5 + path-to-regexp 8.x).
  app.use((req, res, next) => {
    if (req.path.includes("/assets/")) return next();
    const lastDot = req.path.lastIndexOf(".");
    if (lastDot > -1) {
      const ext = req.path.slice(lastDot + 1).toLowerCase();
      if (ext && ext !== "html" && ext !== "htm") return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
