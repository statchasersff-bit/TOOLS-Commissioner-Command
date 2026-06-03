/**
 * analytics.ts — first-party product analytics: page views + session duration.
 *
 * Public ingest:  POST /api/analytics/collect   (all visitors, no auth)
 * Admin readout:  GET  /api/admin/analytics      (requireAdmin)
 *
 * Design notes:
 *  • sc_user_id is resolved server-side from the auth cookie/JWT and is the only
 *    identity we trust. sleeper_user_id/username are accepted from the body
 *    (public handle, not a credential) so anonymous read-only visitors can be
 *    attributed once they enter a username.
 *  • Session duration = last_seen_at − started_at, kept current by client
 *    heartbeats and route-change pings. The ingest path is best-effort and
 *    never throws back to the client — analytics must not break the app.
 */
import type { Express, Request, Response } from "express";
import { pool, db, classifyDbError } from "./db";
import { sql } from "drizzle-orm";
import { analyticsSessions, analyticsPageViews } from "@shared/schema";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { requireAdmin } from "./adminAuth";

// Shared, capped Postgres pool (see server/db.ts).

const clip = (s: unknown, n: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, n) : null;
};

// Collapse high-cardinality ids in a path to keep the page list readable.
// e.g. /players/6786 → /players/:id, /managers/abc → /managers/:id
function normalizePath(raw: string): string {
  let p = raw.split(/[?#]/)[0] || "/";
  p = p.replace(/^(\/(?:players|managers))\/[^/]+/i, "$1/:id");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.slice(0, 200) || "/";
}

export interface CollectInput {
  sessionId?: string;
  visitorId?: string;
  path?: string;
  sleeperUserId?: string;
  sleeperUsername?: string;
  // "pageview" records a route view; "heartbeat" only extends the duration
  // window without adding a page row.
  type?: "pageview" | "heartbeat";
}

/**
 * Upsert the session row and (for pageviews) append a page-view row.
 * scUserId is passed in by the route after server-side auth resolution.
 */
export async function recordCollect(input: CollectInput, scUserId: string | null): Promise<void> {
  const sessionId = clip(input.sessionId, 40);
  if (!sessionId) return; // can't attribute without a session id

  const visitorId = clip(input.visitorId, 40);
  const sleeperUserId = clip(input.sleeperUserId, 32);
  const sleeperUsername = clip(input.sleeperUsername, 120);
  const isPageview = input.type !== "heartbeat";
  const path = isPageview ? normalizePath(clip(input.path, 200) ?? "/") : null;

  // Upsert the session. On conflict we always bump last_seen_at; we only fill
  // identity columns when we now know them and the row didn't already (COALESCE
  // keeps the first non-null), and increment the pageview counter for pageviews.
  await db
    .insert(analyticsSessions)
    .values({
      sessionId,
      visitorId: visitorId ?? undefined,
      scUserId: scUserId ?? undefined,
      sleeperUserId: sleeperUserId ?? undefined,
      sleeperUsername: sleeperUsername ?? undefined,
      pageviewCount: isPageview ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: analyticsSessions.sessionId,
      set: {
        lastSeenAt: sql`now()`,
        visitorId: sql`coalesce(${analyticsSessions.visitorId}, ${visitorId})`,
        scUserId: sql`coalesce(${analyticsSessions.scUserId}, ${scUserId})`,
        sleeperUserId: sql`coalesce(${analyticsSessions.sleeperUserId}, ${sleeperUserId})`,
        sleeperUsername: sql`coalesce(${analyticsSessions.sleeperUsername}, ${sleeperUsername})`,
        pageviewCount: sql`${analyticsSessions.pageviewCount} + ${isPageview ? 1 : 0}`,
      },
    });

  if (isPageview && path) {
    await db.insert(analyticsPageViews).values({ sessionId, path });
  }
}

export interface UserAnalyticsRow {
  identity: string;            // best label we have (username → email → visitor → session)
  sleeperUsername: string | null;
  sleeperUserId: string | null;
  accountEmail: string | null;
  connectedToken: boolean;     // derived from sc_connected_accounts
  sessions: number;
  totalDurationSec: number;    // summed across sessions
  pageviews: number;
  firstSeen: string | null;
  lastSeen: string | null;
  topPages: { path: string; views: number }[];
}

/**
 * Per-user rollup for the admin log. Groups sessions by the strongest identity
 * key available (sleeper_user_id → sc_user_id → visitor_id → session_id),
 * sums durations and pageviews, and attaches the most-visited pages and
 * connected-token status (joined authoritatively from sc_connected_accounts).
 */
export async function getUserAnalytics(limit = 500): Promise<UserAnalyticsRow[]> {
  const { rows } = await pool.query(
    `
    WITH grouped AS (
      SELECT
        coalesce(sleeper_user_id, sc_user_id, visitor_id, session_id) AS gkey,
        array_agg(session_id)                              AS session_ids,
        max(sleeper_username)                              AS sleeper_username,
        max(sleeper_user_id)                               AS sleeper_user_id,
        max(sc_user_id)                                    AS sc_user_id,
        count(*)                                           AS sessions,
        sum(extract(epoch FROM (last_seen_at - started_at))) AS total_duration_sec,
        sum(pageview_count)                                AS pageviews,
        min(started_at)                                    AS first_seen,
        max(last_seen_at)                                  AS last_seen
      FROM analytics_sessions
      GROUP BY 1
    )
    SELECT
      g.*,
      u.email AS account_email,
      EXISTS (
        SELECT 1 FROM sc_connected_accounts ca
        WHERE ca.provider = 'sleeper'
          AND ca.encrypted_token IS NOT NULL
          AND (ca.user_id = g.sc_user_id OR ca.sleeper_user_id = g.sleeper_user_id)
      ) AS connected_token,
      (
        SELECT json_agg(p ORDER BY (p->>'views')::int DESC)
        FROM (
          SELECT json_build_object('path', pv.path, 'views', count(*)) AS p
          FROM analytics_page_views pv
          WHERE pv.session_id = ANY(g.session_ids)
          GROUP BY pv.path
          ORDER BY count(*) DESC
          LIMIT 12
        ) top
      ) AS top_pages
    FROM grouped g
    LEFT JOIN sc_users u ON u.id = g.sc_user_id
    ORDER BY g.last_seen DESC NULLS LAST
    LIMIT $1
    `,
    [limit],
  );

  return rows.map((r: any): UserAnalyticsRow => {
    const sleeperUsername = r.sleeper_username ?? null;
    const accountEmail = r.account_email ?? null;
    const visitorOrSession = r.gkey ?? null;
    return {
      identity: sleeperUsername || accountEmail || visitorOrSession || "(unknown)",
      sleeperUsername,
      sleeperUserId: r.sleeper_user_id ?? null,
      accountEmail,
      connectedToken: !!r.connected_token,
      sessions: Number(r.sessions) || 0,
      totalDurationSec: Math.round(Number(r.total_duration_sec) || 0),
      pageviews: Number(r.pageviews) || 0,
      firstSeen: r.first_seen ? new Date(r.first_seen).toISOString() : null,
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      topPages: (r.top_pages ?? []).map((p: any) => ({ path: p.path, views: Number(p.views) || 0 })),
    };
  });
}

function toCsv(rows: UserAnalyticsRow[]): string {
  const head = [
    "identity", "sleeper_username", "sleeper_user_id", "account_email",
    "connected_token", "sessions", "total_duration_sec", "pageviews",
    "first_seen", "last_seen", "top_pages",
  ];
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.identity, r.sleeperUsername, r.sleeperUserId, r.accountEmail,
      r.connectedToken, r.sessions, r.totalDurationSec, r.pageviews,
      r.firstSeen, r.lastSeen,
      r.topPages.map((p) => `${p.path} (${p.views})`).join(" | "),
    ].map(esc).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

export function registerAnalyticsRoutes(app: Express): void {
  // Public ingest. Best-effort: validate cheaply, resolve trusted identity from
  // the auth cookie, never surface errors to the client.
  app.post("/api/analytics/collect", async (req: Request, res: Response) => {
    try {
      let scUserId: string | null = null;
      try { scUserId = getUserIdFromRequest(req); } catch { /* anonymous */ }
      await recordCollect((req.body ?? {}) as CollectInput, scUserId);
    } catch (err: any) {
      console.warn("[analytics] collect failed:", err?.message);
    }
    // 204 regardless — keeps sendBeacon happy and the client uncoupled.
    res.status(204).end();
  });

  // Admin readout — the per-user usage log.
  app.get("/api/admin/analytics", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(2000, Number(req.query.limit ?? 500) || 500);
      const rows = await getUserAnalytics(limit);
      if (String(req.query.format).toLowerCase() === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=usage-log.csv");
        return res.send(toCsv(rows));
      }
      res.json({ count: rows.length, users: rows });
    } catch (err: any) {
      const c = classifyDbError(err);
      console.error(`[analytics] admin readout FAILED [${c.kind}] waiting=${pool.waitingCount} :: ${c.detail}`);
      res.status(500).json({ ok: false, error: c.error, detail: c.detail, kind: c.kind });
    }
  });
}
