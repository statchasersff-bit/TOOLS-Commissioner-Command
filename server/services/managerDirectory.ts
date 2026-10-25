/**
 * Manager Directory — a commissioner-facing manager database (Commissioner
 * Command ▸ Activity ▸ Managers).
 *
 * Aggregates every manager who appears in the commissioner's leagues into a
 * single scannable list answering: who is this manager, how many of my leagues
 * are they in, how active are they, and are they actually a verified StatChasers
 * account?
 *
 * Data sources (all read-only):
 *   • Public Sleeper REST (rosters + users) for identity, team names, formats.
 *   • sc_connected_accounts (auth DB) for the system-controlled verified badge —
 *     a manager is verified ONLY when their Sleeper user id is linked to a
 *     logged-in StatChasers account. Commissioners cannot mark this manually.
 *   • commissioner_log for the commissioner's explicit Flags & Payment issues.
 *   • commissioner_manager_activity for the per-league activity label.
 *   • fetchSleeperLeagues for the best-effort "Known Sleeper Leagues" count
 *     (current season, visible leagues only — labelled as such in the UI since
 *     we can't guarantee we know every league a manager is in).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { commissionerManagerActivity, commissionerLog } from "@shared/schema";
import {
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  type SleeperLeagueMeta,
} from "./commissionerTrades/sleeperClient";
import type {
  SleeperRosterLite,
  SleeperLeagueUserLite,
} from "./commissionerTrades/types";
import { getVerifiedSleeperLinks } from "../scAuth";
import { fetchSleeperLeagues } from "../sleeper";

// ── Public types ──────────────────────────────────────────────────────────────

export type VerificationStatus = "verified" | "unverified" | "claim_pending" | "mismatch";
export type ActivityStatus = "active" | "quiet" | "inactive" | "unknown";

export interface SharedLeague {
  leagueId: string;
  leagueName: string;
  /** Team name in this league (may differ from the manager's username). */
  teamName: string;
  /** Compact format label, e.g. "12T SF" / "10T 1QB". */
  format: string;
  /** Sleeper league status (pre_draft | drafting | in_season | complete | …). */
  status: string;
  activeFlagsCount: number;
  paymentIssuesCount: number;
  activityStatus: ActivityStatus;
  /** Epoch ms of the manager's most recent tracked transaction here, or null. */
  lastActivity: number | null;
}

export interface ManagerDirectoryItem {
  sleeperUserId: string;
  sleeperUsername: string;
  displayName: string;
  /** Representative team name across the commissioner's leagues. */
  teamName: string;
  /** Sleeper avatar hash (not a URL); null falls back to initials. */
  avatar: string | null;
  /** True only when a StatChasers account is linked to this Sleeper user id. */
  verifiedStatChasersAccount: boolean;
  verificationStatus: VerificationStatus;
  statChasersUserId: string | null;
  /** Leagues run by this commissioner where the manager appears. */
  commissionerLeagueCount: number;
  /**
   * Sleeper leagues this season where the manager is on a team with a roster
   * (owner or co-owner). Excludes leagues they belong to without a roster, e.g.
   * commissioner-only leagues. Best-effort; null = not yet resolved.
   */
  knownSleeperLeagueCount: number | null;
  activeFlagsCount: number;
  paymentIssuesCount: number;
  activityStatus: ActivityStatus;
  /** Most recent tracked activity across shared leagues (epoch ms), or null. */
  lastActivity: number | null;
  sharedLeagues: SharedLeague[];
}

export interface ManagerDirectoryResponse {
  season: string;
  /** Number of commissioner leagues actually scanned. */
  leagueCount: number;
  managers: ManagerDirectoryItem[];
  /** True once every manager's Known Sleeper Leagues count was resolved. */
  knownLeaguesResolved: boolean;
}

// ── Small concurrency helper ──────────────────────────────────────────────────

async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Known-leagues cache ───────────────────────────────────────────────────────
// "Known leagues" = leagues this season where the manager is on a team with a
// roster (owner or co-owner) — not merely a league member (commissioner-only
// leagues, which the user can belong to without a roster, are excluded).
//
// That filter costs one roster lookup per league the manager is in, so a power
// user in 100+ leagues is expensive on a cold miss. Two caches keep it bounded:
//   • knownCache       — the final per-(user, season) count (6h TTL)
//   • rosterOwnersCache — per-league set of owner+co-owner ids (6h TTL), shared
//                         across managers and requests
// Plus a per-request budget on cold roster fetches, so any single request stays
// bounded; managers we can't fully resolve come back null ("—") and warm on a
// later load (the UI shows a "warming up" hint while incomplete).
const KNOWN_TTL_MS = 6 * 60 * 60 * 1000;
const KNOWN_MAX_LIVE = 40;
const ROSTER_FETCH_BUDGET = 300;
const knownCache = new Map<string, { ts: number; count: number }>();
const rosterOwnersCache = new Map<string, { ts: number; owners: Set<string> }>();

// Owner + co-owner user ids for a league, cached. Returns null on fetch failure
// so callers can distinguish "no roster" from "couldn't check".
async function leagueOwnerSet(leagueId: string): Promise<Set<string> | null> {
  const hit = rosterOwnersCache.get(leagueId);
  if (hit && Date.now() - hit.ts < KNOWN_TTL_MS) return hit.owners;
  let rosters: SleeperRosterLite[];
  try {
    rosters = await getLeagueRosters(leagueId);
  } catch {
    return null;
  }
  const owners = new Set<string>();
  for (const r of rosters) {
    if (r.owner_id) owners.add(String(r.owner_id));
    for (const co of r.co_owners ?? []) owners.add(String(co));
  }
  rosterOwnersCache.set(leagueId, { ts: Date.now(), owners });
  return owners;
}

async function resolveKnownLeagueCounts(
  sleeperUserIds: string[],
  season: string,
): Promise<{ counts: Map<string, number>; complete: boolean }> {
  const counts = new Map<string, number>();
  const need: string[] = [];
  for (const id of sleeperUserIds) {
    const hit = knownCache.get(`${id}:${season}`);
    if (hit && Date.now() - hit.ts < KNOWN_TTL_MS) counts.set(id, hit.count);
    else need.push(id);
  }
  const live = need.slice(0, KNOWN_MAX_LIVE);
  let rosterBudget = ROSTER_FETCH_BUDGET;
  let resolvedLive = 0;

  await mapBounded(live, 4, async (id) => {
    try {
      const leagues = await fetchSleeperLeagues(id, season, { includeAllTypes: true });
      let count = 0;
      let aborted = false;
      // Count only leagues where this user holds a roster. A cold roster lookup
      // draws from the shared request budget; if it's exhausted mid-manager we
      // abort (leave null) rather than record an undercount.
      await mapBounded(leagues, 6, async (lg) => {
        if (aborted) return;
        const cached = rosterOwnersCache.get(lg.leagueId);
        const fresh = cached && Date.now() - cached.ts < KNOWN_TTL_MS;
        let owners: Set<string> | null;
        if (fresh) {
          owners = cached!.owners;
        } else {
          if (rosterBudget <= 0) { aborted = true; return; }
          rosterBudget -= 1;
          owners = await leagueOwnerSet(lg.leagueId);
        }
        if (owners === null) { aborted = true; return; } // fetch failed → don't undercount
        if (owners.has(id)) count += 1;
      });
      if (!aborted) {
        knownCache.set(`${id}:${season}`, { ts: Date.now(), count });
        counts.set(id, count);
        resolvedLive += 1;
      }
    } catch {
      // Leave unresolved — the UI renders "—" rather than a wrong number.
    }
  });

  return { counts, complete: need.length <= live.length && resolvedLive === live.length };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveFormat(meta: SleeperLeagueMeta | null, teamCount: number): string {
  const positions = meta?.roster_positions ?? [];
  const isSf = positions.includes("SUPER_FLEX");
  return `${teamCount}T ${isSf ? "SF" : "1QB"}`;
}

function activityStatusFromLabel(label: string | null | undefined): ActivityStatus {
  switch (label) {
    case "highly_active":
    case "active":
      return "active";
    case "quiet":
      return "quiet";
    case "inactive_risk":
    case "inactive":
      return "inactive";
    default:
      return "unknown";
  }
}

// Pick the "best" status across a manager's leagues: active somewhere beats
// quiet, which beats inactive, which beats unknown.
const ACTIVITY_RANK: Record<ActivityStatus, number> = {
  active: 3,
  quiet: 2,
  inactive: 1,
  unknown: 0,
};

function teamNameFor(roster: SleeperRosterLite, user: SleeperLeagueUserLite | undefined, rosterId: number): string {
  return user?.metadata?.team_name || user?.display_name || user?.username || `Team ${rosterId}`;
}

const OPEN_LOG_STATUSES = new Set(["open", "watching", "escalated"]);

// ── Per-league scan (Sleeper) ─────────────────────────────────────────────────

interface LeagueScan {
  leagueId: string;
  leagueName: string;
  status: string;
  format: string;
  /** ownerId → { rosterId, username, displayName, avatar, teamName } */
  members: Map<string, {
    rosterId: number;
    username: string;
    displayName: string;
    avatar: string | null;
    teamName: string;
  }>;
}

async function scanLeague(leagueId: string): Promise<LeagueScan | null> {
  const [meta, rosters, users] = await Promise.all([
    getLeague(leagueId).catch(() => null),
    getLeagueRosters(leagueId).catch(() => [] as SleeperRosterLite[]),
    getLeagueUsers(leagueId).catch(() => [] as SleeperLeagueUserLite[]),
  ]);
  if (!rosters.length) return null;

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const members: LeagueScan["members"] = new Map();
  for (const r of rosters) {
    if (!r.owner_id) continue;
    const u = usersById.get(r.owner_id);
    members.set(r.owner_id, {
      rosterId: r.roster_id,
      username: u?.username || u?.display_name || `Team ${r.roster_id}`,
      displayName: u?.display_name || u?.username || `Team ${r.roster_id}`,
      avatar: (u as { avatar?: string | null } | undefined)?.avatar ?? null,
      teamName: teamNameFor(r, u, r.roster_id),
    });
  }

  return {
    leagueId,
    leagueName: meta?.name || `League ${leagueId}`,
    status: meta?.status || "unknown",
    format: deriveFormat(meta, rosters.length),
    members,
  };
}

// ── Activity + commissioner-log lookups (app DB) ──────────────────────────────

/** Latest-week activity label + last-activity ts per (leagueId, ownerId). */
async function loadActivityByOwner(
  leagueIds: string[],
  season: string,
): Promise<Map<string, { status: ActivityStatus; lastActivity: number | null }>> {
  const out = new Map<string, { status: ActivityStatus; lastActivity: number | null }>();
  if (!leagueIds.length) return out;
  const rows = await db
    .select({
      leagueId: commissionerManagerActivity.leagueId,
      ownerId: commissionerManagerActivity.ownerId,
      week: commissionerManagerActivity.week,
      activityLabel: commissionerManagerActivity.activityLabel,
      lastTransactionTs: commissionerManagerActivity.lastTransactionTs,
    })
    .from(commissionerManagerActivity)
    .where(
      and(
        inArray(commissionerManagerActivity.leagueId, leagueIds),
        eq(commissionerManagerActivity.season, season),
      ),
    );

  // Keep only the latest week per (leagueId, ownerId).
  const latestWeek = new Map<string, number>();
  for (const r of rows) {
    if (!r.ownerId) continue;
    const key = `${r.leagueId}:${r.ownerId}`;
    const w = r.week ?? 0;
    if (w >= (latestWeek.get(key) ?? -1)) {
      latestWeek.set(key, w);
      out.set(key, {
        status: activityStatusFromLabel(r.activityLabel),
        lastActivity: r.lastTransactionTs ?? null,
      });
    }
  }
  return out;
}

/** Open commissioner-log flag + payment-issue counts per (leagueId, ownerId). */
async function loadLogCountsByOwner(
  leagueIds: string[],
  season: string,
): Promise<Map<string, { flags: number; payments: number }>> {
  const out = new Map<string, { flags: number; payments: number }>();
  if (!leagueIds.length) return out;
  const rows = await db
    .select({
      leagueId: commissionerLog.leagueId,
      ownerId: commissionerLog.ownerId,
      category: commissionerLog.category,
      status: commissionerLog.status,
    })
    .from(commissionerLog)
    .where(
      and(
        inArray(commissionerLog.leagueId, leagueIds),
        eq(commissionerLog.season, season),
      ),
    );
  for (const r of rows) {
    if (!r.ownerId) continue;
    if (!OPEN_LOG_STATUSES.has(r.status)) continue;
    const key = `${r.leagueId}:${r.ownerId}`;
    const cur = out.get(key) ?? { flags: 0, payments: 0 };
    if (r.category === "payment_issue") cur.payments += 1;
    else cur.flags += 1;
    out.set(key, cur);
  }
  return out;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function getManagerDirectory(
  leagueIdsInput: string[],
  season: string,
  opts: { withKnownLeagues?: boolean } = {},
): Promise<ManagerDirectoryResponse> {
  const leagueIds = Array.from(new Set(leagueIdsInput.map((s) => s.trim()).filter(Boolean)));
  if (!leagueIds.length) {
    return { season, leagueCount: 0, managers: [], knownLeaguesResolved: true };
  }

  // 1) Scan each commissioner league for its members (bounded fan-out).
  const scans = (await mapBounded(leagueIds, 6, (id) => scanLeague(id))).filter(
    (s): s is LeagueScan => s != null,
  );

  // 2) Per-league activity + commissioner-log lookups (single query each).
  const scannedIds = scans.map((s) => s.leagueId);
  const [activityByOwner, logByOwner] = await Promise.all([
    loadActivityByOwner(scannedIds, season),
    loadLogCountsByOwner(scannedIds, season),
  ]);

  // 3) Aggregate by Sleeper user id.
  const byOwner = new Map<string, ManagerDirectoryItem>();
  for (const scan of scans) {
    for (const [ownerId, m] of Array.from(scan.members.entries())) {
      const key = `${scan.leagueId}:${ownerId}`;
      const log = logByOwner.get(key) ?? { flags: 0, payments: 0 };
      const act = activityByOwner.get(key) ?? { status: "unknown" as ActivityStatus, lastActivity: null };

      const shared: SharedLeague = {
        leagueId: scan.leagueId,
        leagueName: scan.leagueName,
        teamName: m.teamName,
        format: scan.format,
        status: scan.status,
        activeFlagsCount: log.flags,
        paymentIssuesCount: log.payments,
        activityStatus: act.status,
        lastActivity: act.lastActivity,
      };

      let item = byOwner.get(ownerId);
      if (!item) {
        item = {
          sleeperUserId: ownerId,
          sleeperUsername: m.username,
          displayName: m.displayName,
          teamName: m.teamName,
          avatar: m.avatar,
          verifiedStatChasersAccount: false,
          verificationStatus: "unverified",
          statChasersUserId: null,
          commissionerLeagueCount: 0,
          knownSleeperLeagueCount: null,
          activeFlagsCount: 0,
          paymentIssuesCount: 0,
          activityStatus: "unknown",
          lastActivity: null,
          sharedLeagues: [],
        };
        byOwner.set(ownerId, item);
      }
      item.sharedLeagues.push(shared);
      item.commissionerLeagueCount += 1;
      item.activeFlagsCount += log.flags;
      item.paymentIssuesCount += log.payments;
      if (ACTIVITY_RANK[act.status] > ACTIVITY_RANK[item.activityStatus]) {
        item.activityStatus = act.status;
      }
      if (act.lastActivity != null && (item.lastActivity == null || act.lastActivity > item.lastActivity)) {
        item.lastActivity = act.lastActivity;
      }
    }
  }

  const managers = Array.from(byOwner.values());

  // 4) Verification badge — system-controlled, from linked StatChasers accounts.
  const links = await getVerifiedSleeperLinks(managers.map((m) => m.sleeperUserId));
  for (const m of managers) {
    const link = links.get(m.sleeperUserId);
    if (link) {
      m.statChasersUserId = link.statChasersUserId;
      const linkedName = (link.sleeperUsername ?? "").toLowerCase();
      const currentName = m.sleeperUsername.toLowerCase();
      // Linked by user id either way; flag a username drift as a mismatch so the
      // commissioner can see the handle changed since linking.
      if (linkedName && currentName && linkedName !== currentName) {
        m.verificationStatus = "mismatch";
        m.verifiedStatChasersAccount = true;
      } else {
        m.verificationStatus = "verified";
        m.verifiedStatChasersAccount = true;
      }
    }
  }

  // 5) Best-effort Known Sleeper Leagues count (cached, capped).
  let knownLeaguesResolved = true;
  if (opts.withKnownLeagues !== false) {
    const { counts, complete } = await resolveKnownLeagueCounts(
      managers.map((m) => m.sleeperUserId),
      season,
    );
    for (const m of managers) {
      const c = counts.get(m.sleeperUserId);
      m.knownSleeperLeagueCount = c ?? null;
    }
    knownLeaguesResolved = complete;
  }

  // Default sort: most leagues with you, then username A–Z.
  managers.sort(
    (a, b) =>
      b.commissionerLeagueCount - a.commissionerLeagueCount ||
      a.sleeperUsername.localeCompare(b.sleeperUsername),
  );

  return {
    season,
    leagueCount: scans.length,
    managers,
    knownLeaguesResolved,
  };
}
