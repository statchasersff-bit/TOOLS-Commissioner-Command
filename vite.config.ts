import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          runtimeErrorOverlay(),
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@dispersal": path.resolve(import.meta.dirname, "client", "src", "features", "dispersal-draft"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  // Deployment sub-path. MUST match the path the SPA is served from in
  // production (e.g. "/commissioner-command/launch/") AND match the path
  // server/static.ts mounts express.static at. If this is wrong, the asset
  // URLs emitted into index.html won't resolve and the JS request gets the
  // SPA fallback HTML (Firefox: "disallowed MIME type 'text/html'").
  //
  //   Build root deployment:    npm run build
  //   Build sub-path deployment: VITE_BASE_PATH=/commissioner-command/launch/ npm run build
  //
  // The server reads the same env var at runtime to mount static assets at
  // the matching path.
  base: process.env.VITE_BASE_PATH || "/",
  root: path.resolve(import.meta.dirname, "client"),
  // `root` is client/, but our .env (VITE_ENABLE_LEAGUE_SHARE etc.) lives at
  // the project root. Vite's envDir defaults to `root`, so without this it
  // looks for client/.env and silently ignores the project-root file —
  // leaving VITE_ENABLE_LEAGUE_SHARE undefined and the share feature gated off
  // in the published build. Point envDir back at the project root.
  envDir: import.meta.dirname,
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
