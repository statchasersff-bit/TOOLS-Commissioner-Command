/**
 * sleeperUserLog.ts — read-only report of everyone who entered a Sleeper
 * username into the tool, built from data we ALREADY persist:
 *   • sc_connected_accounts   — authed users who connected a Sleeper account (token)
 *   • adp_user_crawl_events   — every "user connected Sleeper" event, incl. anonymous
 *                               read-only username lookups (source tells them apart)
 *   • sc_users                — account email + last login timestamp
 *
 * Limits (by design — see the analytics_events work for the rest):
 *   • "time on tool" / session duration is NOT tracked historically → we show
 *     last login + a first-seen→last-seen span as a proxy only.
 *   • page views are NOT tracked historically → omitted entirely.
 *
 * Usage:  tsx script/sleeperUserLog.ts            # pretty table to stdout
 *         tsx script/sleeperUserLog.ts --csv      # CSV to stdout
 */
import pg from "pg";

const asCsv = process.argv.includes("--csv");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

type Row = {
  sleeperUsername: string | null;
  sleeperUserId: string;
  accountEmail: string | null;
  connectedToken: boolean;          // did they connect a Sleeper *token* (write access)?
  sources: string;                  // distinct origin tags, comma-joined
  events: number;                   // # of connect/lookup events
  firstSeen: Date | null;
  lastSeen: Date | null;
  lastLoginAt: Date | null;
  leaguesScanned: number;
  draftsFound: number;
};

async function main() {
  // Pull the union of everyone who ever entered a Sleeper username. The crawl
  // events table is the widest net (it captures anonymous read-only lookups
  // too), so we drive off it and LEFT JOIN the account/token tables.
  const { rows } = await pool.query(`
    WITH events AS (
      SELECT
        sleeper_user_id,
        MAX(sleeper_username)                          AS sleeper_username,
        string_agg(DISTINCT source, ',' ORDER BY source) AS sources,
        COUNT(*)                                       AS events,
        MIN(created_at)                                AS first_seen,
        MAX(updated_at)                                AS last_seen,
        MAX(leagues_scanned)                           AS leagues_scanned,
        MAX(drafts_found)                              AS drafts_found
      FROM adp_user_crawl_events
      GROUP BY sleeper_user_id
    )
    SELECT
      e.sleeper_user_id,
      COALESCE(e.sleeper_username, ca.sleeper_username) AS sleeper_username,
      u.email                                           AS account_email,
      (ca.encrypted_token IS NOT NULL)                  AS connected_token,
      e.sources,
      e.events,
      e.first_seen,
      e.last_seen,
      u.last_login_at,
      e.leagues_scanned,
      e.drafts_found
    FROM events e
    LEFT JOIN sc_connected_accounts ca
      ON ca.sleeper_user_id = e.sleeper_user_id AND ca.provider = 'sleeper'
    LEFT JOIN sc_users u ON u.id = ca.user_id
    ORDER BY e.last_seen DESC NULLS LAST
  `);

  // Fold in any connected accounts that somehow never produced a crawl event
  // (defensive — connect-sleeper always enqueues, but a failed enqueue or an
  // old account predating the events table would be missed otherwise).
  const { rows: orphanAccts } = await pool.query(`
    SELECT ca.sleeper_user_id, ca.sleeper_username, u.email AS account_email,
           (ca.encrypted_token IS NOT NULL) AS connected_token,
           ca.connected_at, u.last_login_at
    FROM sc_connected_accounts ca
    LEFT JOIN sc_users u ON u.id = ca.user_id
    WHERE ca.provider = 'sleeper'
      AND ca.sleeper_user_id IS NOT NULL
      AND ca.sleeper_user_id NOT IN (SELECT DISTINCT sleeper_user_id FROM adp_user_crawl_events)
  `);

  const data: Row[] = [
    ...rows.map((r: any) => ({
      sleeperUsername: r.sleeper_username,
      sleeperUserId: r.sleeper_user_id,
      accountEmail: r.account_email,
      connectedToken: !!r.connected_token,
      sources: r.sources ?? "",
      events: Number(r.events) || 0,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      lastLoginAt: r.last_login_at,
      leaguesScanned: Number(r.leagues_scanned) || 0,
      draftsFound: Number(r.drafts_found) || 0,
    })),
    ...orphanAccts.map((r: any) => ({
      sleeperUsername: r.sleeper_username,
      sleeperUserId: r.sleeper_user_id,
      accountEmail: r.account_email,
      connectedToken: !!r.connected_token,
      sources: "account_only",
      events: 0,
      firstSeen: r.connected_at,
      lastSeen: r.connected_at,
      lastLoginAt: r.last_login_at,
      leaguesScanned: 0,
      draftsFound: 0,
    })),
  ];

  const fmt = (d: Date | null) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "");
  // Token connect = a logged-in account holder who linked write access.
  // Read-only = entered username for a lookup but never connected a token.
  const kind = (r: Row) => (r.connectedToken ? "token" : "read-only");

  if (asCsv) {
    const head = [
      "sleeper_username", "sleeper_user_id", "account_email", "connection_type",
      "connected_token", "sources", "events", "first_seen", "last_seen",
      "last_login", "leagues_scanned", "drafts_found",
    ];
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    console.log(head.join(","));
    for (const r of data) {
      console.log([
        r.sleeperUsername, r.sleeperUserId, r.accountEmail, kind(r),
        r.connectedToken, r.sources, r.events, fmt(r.firstSeen), fmt(r.lastSeen),
        fmt(r.lastLoginAt), r.leaguesScanned, r.draftsFound,
      ].map(esc).join(","));
    }
  } else {
    const tokenCount = data.filter((r) => r.connectedToken).length;
    console.log(`\nSleeper username log — ${data.length} unique users (${tokenCount} connected a token)\n`);
    for (const r of data) {
      console.log(
        `${(r.sleeperUsername ?? "(unknown)").padEnd(22)} ` +
        `${kind(r).padEnd(10)} ` +
        `${(r.accountEmail ?? "—").padEnd(28)} ` +
        `seen ${fmt(r.firstSeen)}→${fmt(r.lastSeen)}  ` +
        `login ${fmt(r.lastLoginAt) || "—"}  ` +
        `lg:${r.leaguesScanned} dr:${r.draftsFound}  [${r.sources}]`
      );
    }
    console.log("");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
