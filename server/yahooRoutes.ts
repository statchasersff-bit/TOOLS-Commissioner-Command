import type { Express, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { sql, and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { requireAdmin } from "./adminAuth";
import { db } from "./db";
import {
  platformConnections,
  fantasyLeagues,
  fantasyTeams,
  fantasyRosterPlayers,
  fantasySyncRuns,
} from "@shared/schema";
import {
  getAuthorizeUrl,
  exchangeCodeForTokens,
  isYahooConfigured,
} from "./services/yahooOAuth";
import {
  getConnection,
  upsertConnection,
  disconnect,
  toPublicStatus,
} from "./services/platformConnections";
import { runYahooSync, getLatestSyncRun } from "./services/yahooSyncService";
import {
  listNormalizedLeagues,
  listLeagueTeams,
  getTeamRoster,
} from "./services/fantasyData";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-dev-secret";
const STATE_TTL = "10m";

// Where to send the browser after the OAuth round-trip. The SPA reads the
// ?yahoo= query param to show a toast / refresh the integrations card.
function appRedirect(status: "connected" | "error" | "denied", detail?: string): string {
  const base = process.env.APP_BASE_URL || "";
  const params = new URLSearchParams({ yahoo: status });
  if (detail) params.set("yahoo_detail", detail.slice(0, 140));
  return `${base}/?${params.toString()}`;
}

function signState(userId: string): string {
  return jwt.sign({ uid: userId, n: cryptoNonce() }, JWT_SECRET, { expiresIn: STATE_TTL });
}

function cryptoNonce(): string {
  // Small random nonce so two concurrent connect attempts produce distinct states.
  return Math.floor(Math.random() * 1e9).toString(36);
}

function verifyState(state: string): string | null {
  try {
    const payload = jwt.verify(state, JWT_SECRET) as { uid?: string };
    return payload.uid ?? null;
  } catch {
    return null;
  }
}

async function countWhere(table: any, where: any): Promise<number> {
  const rows = await db.select({ c: sql<number>`count(*)::int` }).from(table).where(where);
  return rows[0]?.c ?? 0;
}

export function registerYahooRoutes(app: Express): void {
  // ── GET /api/yahoo/connect ────────────────────────────────────────────────
  // Redirects an authenticated user to Yahoo's consent screen.
  app.get("/api/yahoo/connect", (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    if (!isYahooConfigured()) {
      return res.status(503).json({ error: "Yahoo integration is not configured on this server." });
    }
    const state = signState(userId);
    res.redirect(getAuthorizeUrl(state));
  });

  // ── GET /api/yahoo/callback ───────────────────────────────────────────────
  // Yahoo redirects here with ?code & ?state. We exchange the code, store
  // encrypted tokens, and kick off an initial sync.
  app.get("/api/yahoo/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return res.redirect(appRedirect("denied", error));
    if (!code || !state) return res.redirect(appRedirect("error", "missing code/state"));

    const userId = verifyState(state);
    if (!userId) return res.redirect(appRedirect("error", "invalid state"));

    try {
      const tokens = await exchangeCodeForTokens(code);
      await upsertConnection({
        userId,
        platform: "yahoo",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresInSeconds: tokens.expires_in,
        platformUserId: tokens.xoauth_yahoo_guid ?? null,
        scopes: "fspt-r",
      });
      // Fire-and-forget the first sync so the redirect is snappy; the UI polls
      // /api/yahoo/status for progress.
      runYahooSync(userId).catch((e) =>
        console.error("[yahoo] initial sync failed:", e?.message ?? e),
      );
      res.redirect(appRedirect("connected"));
    } catch (err: any) {
      console.error("[yahoo] callback error:", err?.message ?? err);
      res.redirect(appRedirect("error", err?.message ?? "token exchange failed"));
    }
  });

  // ── GET /api/yahoo/status ─────────────────────────────────────────────────
  // Safe connection + last-sync status. NEVER returns token material.
  app.get("/api/yahoo/status", async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    try {
      const conn = await getConnection(userId, "yahoo");
      const status = toPublicStatus(conn, "yahoo");
      const lastRun = await getLatestSyncRun(userId);
      res.json({
        ...status,
        configured: isYahooConfigured(),
        lastSync: lastRun
          ? {
              status: lastRun.status,
              startedAt: lastRun.startedAt?.toISOString() ?? null,
              completedAt: lastRun.completedAt?.toISOString() ?? null,
              leaguesSynced: lastRun.leaguesSynced,
              teamsSynced: lastRun.teamsSynced,
              playersSynced: lastRun.playersSynced,
              unmappedPlayers: lastRun.unmappedPlayers,
              errorMessage: lastRun.errorMessage,
            }
          : null,
      });
    } catch (err: any) {
      console.error("[yahoo] status error:", err?.message ?? err);
      res.status(500).json({ error: "Failed to load Yahoo status" });
    }
  });

  // ── POST /api/yahoo/disconnect ────────────────────────────────────────────
  app.post("/api/yahoo/disconnect", async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    try {
      await disconnect(userId, "yahoo");
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[yahoo] disconnect error:", err?.message ?? err);
      res.status(500).json({ error: "Failed to disconnect Yahoo" });
    }
  });

  // ── POST /api/yahoo/sync ──────────────────────────────────────────────────
  app.post("/api/yahoo/sync", async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    const conn = await getConnection(userId, "yahoo");
    if (!conn) return res.status(400).json({ error: "Yahoo is not connected" });
    try {
      const result = await runYahooSync(userId);
      res.json(result);
    } catch (err: any) {
      console.error("[yahoo] sync error:", err?.message ?? err);
      res.status(500).json({ error: "Sync failed", detail: err?.message ?? String(err) });
    }
  });

  // ── Normalized read endpoints (platform-agnostic) ─────────────────────────
  // Used by the league dropdown + read-only modules. Sleeper leagues continue
  // to load via the existing client; the frontend merges the two sources.

  app.get("/api/fantasy/leagues", async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    try {
      res.json({ leagues: await listNormalizedLeagues(userId) });
    } catch (err: any) {
      console.error("[fantasy] leagues error:", err?.message ?? err);
      res.status(500).json({ error: "Failed to load leagues" });
    }
  });

  app.get("/api/fantasy/leagues/:platform/:leagueKey/teams", async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    try {
      const teams = await listLeagueTeams(userId, req.params.platform, req.params.leagueKey);
      res.json({ teams });
    } catch (err: any) {
      console.error("[fantasy] teams error:", err?.message ?? err);
      res.status(500).json({ error: "Failed to load teams" });
    }
  });

  app.get("/api/fantasy/:platform/teams/:teamKey/roster", async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    try {
      const roster = await getTeamRoster(userId, req.params.platform, req.params.teamKey);
      res.json({ roster });
    } catch (err: any) {
      console.error("[fantasy] roster error:", err?.message ?? err);
      res.status(500).json({ error: "Failed to load roster" });
    }
  });

  // ── GET /api/admin/yahoo/debug ────────────────────────────────────────────
  // Admin-only diagnostics. Optional ?userId=<id> to inspect a specific user;
  // otherwise inspects the calling admin's own connection. NEVER exposes tokens.
  app.get("/api/admin/yahoo/debug", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetUserId = (req.query.userId as string) || getUserIdFromRequest(req);
      if (!targetUserId) return res.status(400).json({ error: "No userId to inspect" });

      const conn = await getConnection(targetUserId, "yahoo");
      const status = toPublicStatus(conn, "yahoo");
      const lastRun = await getLatestSyncRun(targetUserId);

      const [leagueCount, teamCount, unmappedCount] = await Promise.all([
        countWhere(
          fantasyLeagues,
          and(eq(fantasyLeagues.userId, targetUserId), eq(fantasyLeagues.platform, "yahoo")),
        ),
        countWhere(
          fantasyTeams,
          and(eq(fantasyTeams.userId, targetUserId), eq(fantasyTeams.platform, "yahoo")),
        ),
        countWhere(
          fantasyRosterPlayers,
          and(
            eq(fantasyRosterPlayers.userId, targetUserId),
            eq(fantasyRosterPlayers.platform, "yahoo"),
            eq(fantasyRosterPlayers.mapMethod, "unmapped"),
          ),
        ),
      ]);

      res.json({
        userId: targetUserId,
        configured: isYahooConfigured(),
        connection: {
          connected: status.connected,
          status: status.status,
          platformUserId: status.platformUserId,
          tokenExpiresAt: status.tokenExpiresAt,
          lastError: status.lastError,
          // Explicitly NOT included: access/refresh tokens.
        },
        counts: { leagues: leagueCount, teams: teamCount, unmappedPlayers: unmappedCount },
        latestSync: lastRun
          ? {
              status: lastRun.status,
              startedAt: lastRun.startedAt?.toISOString() ?? null,
              completedAt: lastRun.completedAt?.toISOString() ?? null,
              leaguesSynced: lastRun.leaguesSynced,
              teamsSynced: lastRun.teamsSynced,
              playersSynced: lastRun.playersSynced,
              unmappedPlayers: lastRun.unmappedPlayers,
              errorMessage: lastRun.errorMessage,
            }
          : null,
      });
    } catch (err: any) {
      console.error("[yahoo] debug error:", err?.message ?? err);
      res.status(500).json({ error: "Debug failed", detail: err?.message ?? String(err) });
    }
  });
}
