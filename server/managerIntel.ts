/**
 * Manager Intel — aggregates a Sleeper user's visible dynasty footprint into
 * the payload consumed by the ManagerIntelDrawer.
 *
 * Scope guard: ONLY uses public Sleeper REST endpoints. No DMs, no private
 * GraphQL, no auth tokens. Every cross-league figure is labelled "visible
 * Sleeper leagues only" in the UI to avoid claiming privileged data.
 *
 * Cost shape: a single call hits ~1 + N_leagues + 18*N_leagues endpoints
 * (league fetch + 18 weekly transaction pages per league). We cap N at
 * MAX_LEAGUES_SCANNED so the worst case stays in the 100-call range; the
 * route layer caches by (userId, leagueId, season) for 6h on top.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, desc } from "drizzle-orm";
import { managerIntelCache } from "@shared/schema";
import {
  fetchSleeperUser,
  fetchSleeperLeagues,
  getSleeperPlayers,
  type SleeperUser,
  type SleeperLeagueSummary,
} from "./sleeper";
import { getFantasyCalcValues, getFantasyCalcRedraftValues } from "./fantasycalc";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const SLEEPER_API = "https://api.sleeper.app/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_LEAGUES_SCANNED = 20;
const TRANSACTION_WEEKS = 18;
const FETCH_CONCURRENCY = 4;
const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

// ── Public types ─────────────────────────────────────────────────────────────

export type ActivityRating = "Low" | "Moderate" | "Active" | "Aggressive" | "Very Active";

export interface ManagerIntelPayload {
  user: {
    user_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
  };
  currentLeague: {
    league_id: string;
    teamName: string;
    rosterId: number;
    dynastyStrengths: PositionScore[];
    winNowStrengths: PositionScore[];
    teamNeeds: string[];
    teamDirection: "Contender" | "Middle" | "Rebuild" | "Unknown";
    pickCapitalSummary: string;
    ageSummary: string;
  } | null;
  crossLeague: {
    dynastyLeagueCount: number;
    oldestLeagueSeason: string | null;
    estimatedYearsActive: number | null;
    tradeCount: number;
    waiverCount: number;
    tradeActivityRating: ActivityRating;
    waiverActivityRating: ActivityRating;
    mostRosteredPlayers: PlayerExposure[];
    mostDraftedPlayers: PlayerExposure[] | null;
    commonRosterBuild: string;
    averageTeamAge: number | null;
    positionStrengthProfile: string;
  };
  performance: {
    playoffAppearances: number | null;
    championshipWins: number | null;
    finalsAppearances: number | null;
    avgRegularSeasonFinish: number | null;
    avgPointsFor: number | null;
    notes: string;
  };
  tradeApproach: {
    summary: string;
    suggestedAngle: string;
    likelyNeeds: string[];
    assetsTheyMayValue: string[];
    cautionNotes: string;
  };
  meta: {
    season: string;
    leaguesScanned: number;
    computedAt: string;
    dataSourceNote: string;
  };
}

export interface PositionScore {
  position: "QB" | "RB" | "WR" | "TE";
  /** Total dynasty value held by manager at this position. */
  value: number;
  /** Position rank within the league (1 = strongest). null if unavailable. */
  leagueRank: number | null;
  /** Manager's value vs league average at this position. */
  vsLeagueAvg: number;
  /** Coarse label for the drawer chip. */
  tier: "Elite" | "Strong" | "Average" | "Weak" | "Thin";
}

export interface PlayerExposure {
  playerId: string;
  name: string;
  pos: string;
  team: string;
  leagueCount: number;
  exposure: number; // 0..100
}

// ── Tiny fetch primitives — keep self-contained so we don't widen sleeper.ts's API surface ──

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Run an async map with bounded concurrency. */
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

// ── Cache layer ──────────────────────────────────────────────────────────────

async function readCache(userId: string, leagueId: string, season: string) {
  const rows = await db
    .select()
    .from(managerIntelCache)
    .where(
      and(
        eq(managerIntelCache.userId, userId),
        eq(managerIntelCache.leagueId, leagueId),
        eq(managerIntelCache.season, season),
      ),
    )
    .orderBy(desc(managerIntelCache.computedAt))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const age = Date.now() - (row.computedAt?.getTime() ?? 0);
  if (age > CACHE_TTL_MS) return null;
  return row.payload as ManagerIntelPayload;
}

async function writeCache(
  userId: string,
  leagueId: string,
  season: string,
  payload: ManagerIntelPayload,
) {
  // Naive upsert — delete-then-insert. The table is tiny per row and we want
  // the latest snapshot to be the one we read.
  await db
    .delete(managerIntelCache)
    .where(
      and(
        eq(managerIntelCache.userId, userId),
        eq(managerIntelCache.leagueId, leagueId),
        eq(managerIntelCache.season, season),
      ),
    );
  await db.insert(managerIntelCache).values({
    userId,
    leagueId,
    season,
    payload: payload as unknown as Record<string, unknown>,
  });
}

// ── Activity ratings ─────────────────────────────────────────────────────────

function rateTradeActivity(tradesPerLeague: number): ActivityRating {
  if (tradesPerLeague < 1) return "Low";
  if (tradesPerLeague < 3) return "Moderate";
  if (tradesPerLeague < 6) return "Active";
  return "Aggressive";
}

function rateWaiverActivity(waiversPerLeague: number): ActivityRating {
  if (waiversPerLeague < 3) return "Low";
  if (waiversPerLeague < 8) return "Moderate";
  if (waiversPerLeague < 20) return "Active";
  return "Very Active";
}

// ── Positional analysis ──────────────────────────────────────────────────────

interface RawRosterPick {
  playerId: string;
  pos: "QB" | "RB" | "WR" | "TE";
  dynasty: number;
  redraft: number;
  age: number | null;
}

function summarizeStrengths(
  myRoster: RawRosterPick[],
  leagueRosters: RawRosterPick[][],
  metric: "dynasty" | "redraft",
): PositionScore[] {
  const positions: Array<"QB" | "RB" | "WR" | "TE"> = ["QB", "RB", "WR", "TE"];
  return positions.map((pos) => {
    const mine = myRoster.filter((p) => p.pos === pos).reduce((s, p) => s + p[metric], 0);
    const perLeagueAtPos = leagueRosters.map((r) =>
      r.filter((p) => p.pos === pos).reduce((s, p) => s + p[metric], 0),
    );
    const avg = perLeagueAtPos.length
      ? perLeagueAtPos.reduce((s, v) => s + v, 0) / perLeagueAtPos.length
      : 0;

    const sorted = [...perLeagueAtPos].sort((a, b) => b - a);
    const rank = perLeagueAtPos.length ? sorted.indexOf(mine) + 1 : null;

    const ratio = avg > 0 ? mine / avg : 0;
    let tier: PositionScore["tier"];
    if (ratio >= 1.4) tier = "Elite";
    else if (ratio >= 1.15) tier = "Strong";
    else if (ratio >= 0.85) tier = "Average";
    else if (ratio >= 0.6) tier = "Weak";
    else tier = "Thin";

    return {
      position: pos,
      value: Math.round(mine),
      leagueRank: rank,
      vsLeagueAvg: avg > 0 ? Math.round(((mine - avg) / avg) * 100) : 0,
      tier,
    };
  });
}

function deriveTeamNeeds(dynasty: PositionScore[]): string[] {
  // Surface positions below ~average. Two tiers: Weak/Thin become explicit
  // needs; Average is acknowledged but not flagged.
  return dynasty
    .filter((p) => p.tier === "Weak" || p.tier === "Thin")
    .sort((a, b) => a.vsLeagueAvg - b.vsLeagueAvg)
    .map((p) => p.position);
}

function deriveTeamDirection(
  dynasty: PositionScore[],
  winNow: PositionScore[],
  age: number,
): ManagerIntelPayload["currentLeague"] extends infer T
  ? T extends { teamDirection: infer D }
    ? D
    : never
  : never {
  const totalDyn = dynasty.reduce((s, p) => s + p.value, 0);
  const totalRed = winNow.reduce((s, p) => s + p.value, 0);
  if (totalDyn === 0 && totalRed === 0) return "Unknown" as any;

  // Heuristic: high redraft + average age >= 27 → Contender; low both + young
  // age <= 24 → Rebuild; everyone else Middle.
  const redraftStrong = winNow.filter((p) => p.tier === "Elite" || p.tier === "Strong").length;
  const dynastyStrong = dynasty.filter((p) => p.tier === "Elite" || p.tier === "Strong").length;

  if (redraftStrong >= 2 && age >= 26.5) return "Contender" as any;
  if (dynastyStrong >= 2 && age <= 24.5) return "Rebuild" as any;
  return "Middle" as any;
}

// ── Roster construction summary ──────────────────────────────────────────────

function summariseRosterConstruction(myRoster: RawRosterPick[]): string {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const p of myRoster) counts[p.pos]++;
  const total = myRoster.length || 1;
  const wrShare = counts.WR / total;
  const rbShare = counts.RB / total;
  if (wrShare > 0.45) return "WR-heavy build";
  if (rbShare > 0.35) return "RB-heavy build";
  if (counts.QB >= 3) return "QB-stacked build";
  if (counts.TE >= 3) return "Deep TE room";
  return "Balanced positional build";
}

// ── Narrative builders ───────────────────────────────────────────────────────

function buildSummary(
  user: SleeperUser,
  current: ManagerIntelPayload["currentLeague"],
  cross: ManagerIntelPayload["crossLeague"],
): string {
  const sentences: string[] = [];
  sentences.push(
    `${user.displayName || user.username} is visible in ${cross.dynastyLeagueCount} dynasty league${cross.dynastyLeagueCount === 1 ? "" : "s"} this season.`,
  );
  sentences.push(
    `Trade activity is ${cross.tradeActivityRating.toLowerCase()} and waiver activity is ${cross.waiverActivityRating.toLowerCase()}.`,
  );
  if (current) {
    sentences.push(
      `In this league they look like a ${current.teamDirection.toLowerCase() === "unknown" ? "team with unclear direction" : current.teamDirection.toLowerCase()}.`,
    );
    if (current.teamNeeds.length > 0) {
      sentences.push(`Roster needs jump out at ${current.teamNeeds.join(", ")}.`);
    } else {
      sentences.push(`Their roster has no glaring positional holes vs league average.`);
    }
  }
  sentences.push(`Construction reads as ${cross.commonRosterBuild.toLowerCase()}.`);
  return sentences.join(" ");
}

function buildTradeApproach(
  current: ManagerIntelPayload["currentLeague"],
  cross: ManagerIntelPayload["crossLeague"],
  topRostered: PlayerExposure[],
): ManagerIntelPayload["tradeApproach"] {
  const needs = current?.teamNeeds ?? [];
  const direction = current?.teamDirection ?? "Unknown";

  let suggestedAngle: string;
  if (direction === "Contender") {
    suggestedAngle =
      "Lead with proven win-now production. They will pay a premium for help at their weak spots.";
  } else if (direction === "Rebuild") {
    suggestedAngle =
      "Lead with rookie picks and young upside. Aging veterans are unlikely to move the needle.";
  } else if (direction === "Middle") {
    suggestedAngle =
      "Offer balanced packages — they're open to either side. Frame deals as upgrades, not pivots.";
  } else {
    suggestedAngle =
      "Direction is unclear — feel them out with a low-cost opener before tailoring.";
  }

  const assetsTheyMayValue: string[] = [];
  if (cross.tradeActivityRating === "Aggressive" || cross.tradeActivityRating === "Active") {
    assetsTheyMayValue.push("Volume-style trades (multi-piece packages)");
  }
  if (cross.commonRosterBuild.includes("WR-heavy")) {
    assetsTheyMayValue.push("Top-12 WRs and rookie WR picks");
  } else if (cross.commonRosterBuild.includes("RB-heavy")) {
    assetsTheyMayValue.push("Workhorse RBs and bell-cow handcuffs");
  } else if (cross.commonRosterBuild.includes("QB-stacked")) {
    assetsTheyMayValue.push("Top-12 QBs (especially in Superflex)");
  }
  if (topRostered.length > 0) {
    const names = topRostered
      .slice(0, 3)
      .map((p) => p.name)
      .join(", ");
    assetsTheyMayValue.push(`Players they keep gravitating to: ${names}`);
  }
  if (assetsTheyMayValue.length === 0) {
    assetsTheyMayValue.push("Insufficient signal — open with a balanced two-for-two.");
  }

  let cautionNotes: string;
  if (cross.tradeActivityRating === "Low") {
    cautionNotes =
      "Manager rarely trades. Confidence in this read is low — treat suggestions as a starting point only.";
  } else if (cross.dynastyLeagueCount <= 1) {
    cautionNotes =
      "Only one visible dynasty league — cross-league tendencies are not reliable here.";
  } else {
    cautionNotes = "Based on visible Sleeper leagues only; private leagues are not included.";
  }

  return {
    summary: suggestedAngle,
    suggestedAngle,
    likelyNeeds: needs,
    assetsTheyMayValue,
    cautionNotes,
  };
}

// ── Pick capital ─────────────────────────────────────────────────────────────

interface RosterAndPicks {
  ownedPickCount: number;
  earlyPicks: number;
}

function summarisePickCapital(picks: RosterAndPicks): string {
  if (picks.ownedPickCount === 0) {
    return "No future rookie picks visible in this league.";
  }
  if (picks.earlyPicks >= 3) {
    return `${picks.ownedPickCount} rookie picks total (${picks.earlyPicks} early — strong asset base).`;
  }
  return `${picks.ownedPickCount} rookie picks (${picks.earlyPicks} early).`;
}

// ── Sleeper helpers used here ────────────────────────────────────────────────

interface SleeperLeagueRaw {
  league_id: string;
  name: string;
  season: string;
  settings?: { type?: number; best_ball?: number; previous_league_id?: string };
  scoring_settings?: { rec?: number };
  roster_positions?: string[];
  total_rosters?: number;
}

interface SleeperRosterRaw {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  settings?: {
    wins?: number;
    losses?: number;
    fpts?: number;
    fpts_decimal?: number;
  };
}

interface SleeperLeagueUserRaw {
  user_id: string;
  display_name: string;
  username?: string | null;
  avatar: string | null;
  metadata?: { team_name?: string };
}

interface SleeperTradedPickRaw {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

// ── Per-league scan ──────────────────────────────────────────────────────────

interface LeagueScan {
  leagueId: string;
  season: string;
  format: "SF" | "1QB";
  totalRosters: number;
  managerRoster: RawRosterPick[] | null;
  /** Every roster in this league, hydrated with values + positions. */
  allRosters: RawRosterPick[][];
  /** roster_id of the manager in this league, or null if not present. */
  managerRosterId: number | null;
  /** Count of completed trade transactions involving the manager this season. */
  managerTrades: number;
  /** Count of waiver/FA transactions initiated by the manager this season. */
  managerWaivers: number;
  /** Pick capital. */
  picks: RosterAndPicks;
  /** Roster wins/losses for the manager in this league. */
  managerRecord: { wins: number; losses: number; fpts: number } | null;
  /** Display label fields for the current-league summary. */
  teamName: string;
  ownedPlayerIds: string[];
}

async function scanLeague(
  league: SleeperLeagueSummary,
  managerUserId: string,
  playersDb: Record<string, any>,
  fcDynastySf: Record<string, number>,
  fcDynasty1Qb: Record<string, number>,
  fcRedraftSf: Record<string, number>,
  fcRedraft1Qb: Record<string, number>,
): Promise<LeagueScan | null> {
  const [rosters, users, tradedPicks] = await Promise.all([
    fetchJson<SleeperRosterRaw[]>(`${SLEEPER_API}/league/${league.leagueId}/rosters`),
    fetchJson<SleeperLeagueUserRaw[]>(`${SLEEPER_API}/league/${league.leagueId}/users`),
    fetchJson<SleeperTradedPickRaw[]>(`${SLEEPER_API}/league/${league.leagueId}/traded_picks`),
  ]);
  if (!rosters) return null;

  const isSf = league.format === "SF";
  const fcDyn = isSf ? fcDynastySf : fcDynasty1Qb;
  const fcRed = isSf ? fcRedraftSf : fcRedraft1Qb;

  const allRosters: RawRosterPick[][] = rosters.map((r) =>
    (r.players || [])
      .map((pid): RawRosterPick | null => {
        const p = playersDb[pid];
        if (!p) return null;
        const pos = (p.fantasy_positions?.[0] || p.position) as RawRosterPick["pos"];
        if (!VALID_POSITIONS.has(pos)) return null;
        return {
          playerId: pid,
          pos,
          dynasty: fcDyn[pid] || 0,
          redraft: fcRed[pid] || 0,
          age: p.age ?? null,
        };
      })
      .filter((x): x is RawRosterPick => x !== null),
  );

  const managerIdx = rosters.findIndex((r) => r.owner_id === managerUserId);
  const managerRoster = managerIdx >= 0 ? allRosters[managerIdx] : null;
  const managerRosterId = managerIdx >= 0 ? rosters[managerIdx].roster_id : null;

  // Pick capital for the manager in this league.
  const picks: RosterAndPicks = { ownedPickCount: 0, earlyPicks: 0 };
  if (managerRosterId != null && tradedPicks) {
    const futureYears = [
      parseInt(league.season, 10) + 1,
      parseInt(league.season, 10) + 2,
      parseInt(league.season, 10) + 3,
    ];
    const baseRounds = [1, 2, 3, 4];
    const owned = new Set<string>();
    for (const y of futureYears) {
      for (const r of baseRounds) owned.add(`${y}-${r}`);
    }
    for (const tp of tradedPicks) {
      const yr = parseInt(tp.season, 10);
      if (!futureYears.includes(yr)) continue;
      // If the manager originally owned this pick and traded it away, remove.
      if (tp.previous_owner_id === managerRosterId && tp.owner_id !== managerRosterId) {
        owned.delete(`${yr}-${tp.round}`);
      }
      // Picks acquired from elsewhere.
      if (tp.owner_id === managerRosterId && tp.previous_owner_id !== managerRosterId) {
        owned.add(`${yr}-${tp.round}-from-${tp.previous_owner_id}`);
      }
    }
    picks.ownedPickCount = owned.size;
    picks.earlyPicks = Array.from(owned).filter((k) => k.split("-")[1] === "1" || k.split("-")[1] === "2").length;
  }

  // Trade/waiver counts — page through 18 transaction weeks.
  let managerTrades = 0;
  let managerWaivers = 0;
  if (managerRosterId != null) {
    const weeks = Array.from({ length: TRANSACTION_WEEKS }, (_, i) => i + 1);
    const weekResults = await mapBounded(weeks, 6, async (w) => {
      const txns = await fetchJson<any[]>(`${SLEEPER_API}/league/${league.leagueId}/transactions/${w}`);
      return txns || [];
    });
    for (const txns of weekResults) {
      for (const t of txns) {
        if (t.status !== "complete") continue;
        if (!Array.isArray(t.roster_ids)) continue;
        if (!t.roster_ids.includes(managerRosterId)) continue;
        if (t.type === "trade") managerTrades++;
        else if (t.type === "waiver" || t.type === "free_agent") managerWaivers++;
      }
    }
  }

  const managerRow = managerIdx >= 0 ? rosters[managerIdx] : null;
  const managerRecord = managerRow
    ? {
        wins: managerRow.settings?.wins ?? 0,
        losses: managerRow.settings?.losses ?? 0,
        fpts:
          (managerRow.settings?.fpts ?? 0) +
          (managerRow.settings?.fpts_decimal ?? 0) / 100,
      }
    : null;

  const managerUser = users?.find((u) => u.user_id === managerUserId);
  const teamName =
    managerUser?.metadata?.team_name ||
    managerUser?.display_name ||
    `Team ${managerRosterId ?? "?"}`;

  return {
    leagueId: league.leagueId,
    season: league.season,
    format: league.format as "SF" | "1QB",
    totalRosters: league.totalRosters,
    managerRoster,
    allRosters,
    managerRosterId,
    managerTrades,
    managerWaivers,
    picks,
    managerRecord,
    teamName,
    ownedPlayerIds: managerRoster ? managerRoster.map((p) => p.playerId) : [],
  };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function getManagerIntel(opts: {
  userId: string;
  leagueId?: string;
  season?: string;
  refresh?: boolean;
}): Promise<ManagerIntelPayload> {
  const season = opts.season || String(new Date().getFullYear());
  const leagueId = opts.leagueId || "";
  if (!opts.refresh) {
    const cached = await readCache(opts.userId, leagueId, season);
    if (cached) return cached;
  }

  const payload = await computeManagerIntel(opts.userId, leagueId, season);
  // Best-effort cache write; never let a cache failure poison the response.
  writeCache(opts.userId, leagueId, season, payload).catch((err) =>
    console.error("[ManagerIntel] cache write failed:", err?.message || err),
  );
  return payload;
}

async function computeManagerIntel(
  userId: string,
  currentLeagueId: string,
  season: string,
): Promise<ManagerIntelPayload> {
  // Resolve the user. fetchSleeperUser accepts both username and user_id.
  let user: SleeperUser;
  try {
    user = await fetchSleeperUser(userId);
  } catch {
    return emptyPayload(userId, season, "User not found on Sleeper.");
  }

  const [leagues, playersDb, fcSf, fc1Qb, fcRedSf, fcRed1Qb] = await Promise.all([
    fetchSleeperLeagues(user.userId, season),
    getSleeperPlayers(),
    getFantasyCalcValues("sf").catch(() => ({ valuesBySleeperId: {} })),
    getFantasyCalcValues("1qb").catch(() => ({ valuesBySleeperId: {} })),
    getFantasyCalcRedraftValues("sf").catch(() => ({ valuesBySleeperId: {} })),
    getFantasyCalcRedraftValues("1qb").catch(() => ({ valuesBySleeperId: {} })),
  ]);

  const fcDynastySf = (fcSf as any).valuesBySleeperId || {};
  const fcDynasty1Qb = (fc1Qb as any).valuesBySleeperId || {};
  const fcRedraftSf = (fcRedSf as any).valuesBySleeperId || {};
  const fcRedraft1Qb = (fcRed1Qb as any).valuesBySleeperId || {};

  if (leagues.length === 0) {
    return emptyPayload(user.userId, season, "No visible dynasty leagues found.", user);
  }

  // Cap scan to avoid runaway costs on power users with many leagues.
  const scannedLeagues = leagues.slice(0, MAX_LEAGUES_SCANNED);
  const scans = (
    await mapBounded(scannedLeagues, FETCH_CONCURRENCY, (lg) =>
      scanLeague(lg, user.userId, playersDb, fcDynastySf, fcDynasty1Qb, fcRedraftSf, fcRedraft1Qb),
    )
  ).filter((s): s is LeagueScan => s !== null);

  const currentScan =
    scans.find((s) => s.leagueId === currentLeagueId) ?? scans[0] ?? null;

  // Cross-league exposure across visible dynasty rosters.
  const exposureMap = new Map<string, { name: string; pos: string; team: string; count: number }>();
  for (const s of scans) {
    for (const pid of s.ownedPlayerIds) {
      const p = playersDb[pid];
      if (!p) continue;
      const pos = p.fantasy_positions?.[0] || p.position;
      if (!VALID_POSITIONS.has(pos)) continue;
      const e = exposureMap.get(pid);
      if (e) e.count++;
      else
        exposureMap.set(pid, {
          name: p.full_name || `${p.first_name} ${p.last_name}`,
          pos,
          team: p.team || "FA",
          count: 1,
        });
    }
  }
  const totalLeagues = scans.length || 1;
  const mostRosteredPlayers: PlayerExposure[] = Array.from(exposureMap.entries())
    .map(([playerId, d]) => ({
      playerId,
      name: d.name,
      pos: d.pos,
      team: d.team,
      leagueCount: d.count,
      exposure: Math.round((d.count / totalLeagues) * 100),
    }))
    .sort((a, b) => b.leagueCount - a.leagueCount)
    .slice(0, 8);

  // Activity counts + rating.
  const totalTrades = scans.reduce((s, x) => s + x.managerTrades, 0);
  const totalWaivers = scans.reduce((s, x) => s + x.managerWaivers, 0);
  const tradesPerLeague = totalTrades / totalLeagues;
  const waiversPerLeague = totalWaivers / totalLeagues;
  const tradeActivityRating = rateTradeActivity(tradesPerLeague);
  const waiverActivityRating = rateWaiverActivity(waiversPerLeague);

  // Common roster build — derived from the manager's rosters across leagues.
  const buildCounts: Record<string, number> = {};
  for (const s of scans) {
    if (!s.managerRoster) continue;
    const label = summariseRosterConstruction(s.managerRoster);
    buildCounts[label] = (buildCounts[label] || 0) + 1;
  }
  const commonRosterBuild =
    Object.entries(buildCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Balanced positional build";

  // Average team age across visible rosters.
  const ageSamples: number[] = [];
  for (const s of scans) {
    if (!s.managerRoster) continue;
    for (const p of s.managerRoster) {
      if (p.age != null) ageSamples.push(p.age);
    }
  }
  const averageTeamAge =
    ageSamples.length > 0
      ? Math.round((ageSamples.reduce((a, b) => a + b, 0) / ageSamples.length) * 10) / 10
      : null;

  // Strengths/needs for current league.
  let currentLeague: ManagerIntelPayload["currentLeague"] = null;
  if (currentScan && currentScan.managerRoster) {
    const dynasty = summarizeStrengths(currentScan.managerRoster, currentScan.allRosters, "dynasty");
    const winNow = summarizeStrengths(currentScan.managerRoster, currentScan.allRosters, "redraft");
    const needs = deriveTeamNeeds(dynasty);
    const ages = currentScan.managerRoster.map((p) => p.age).filter((a): a is number => a != null);
    const teamAvgAge =
      ages.length > 0 ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : 0;
    const direction = deriveTeamDirection(dynasty, winNow, teamAvgAge);

    const youngCount = ages.filter((a) => a <= 24).length;
    const vetCount = ages.filter((a) => a >= 29).length;
    const ageSummary =
      ages.length === 0
        ? "Roster age data not available."
        : `Avg age ${teamAvgAge}. ${youngCount} young (≤24), ${vetCount} vet (≥29).`;

    currentLeague = {
      league_id: currentScan.leagueId,
      teamName: currentScan.teamName,
      rosterId: currentScan.managerRosterId ?? 0,
      dynastyStrengths: dynasty,
      winNowStrengths: winNow,
      teamNeeds: needs,
      teamDirection: direction,
      pickCapitalSummary: summarisePickCapital(currentScan.picks),
      ageSummary,
    };
  }

  // Position strength profile across leagues — one-liner.
  const profilePieces: string[] = [];
  if (currentLeague) {
    const strong = currentLeague.dynastyStrengths
      .filter((p) => p.tier === "Elite" || p.tier === "Strong")
      .map((p) => p.position);
    if (strong.length > 0) profilePieces.push(`strong at ${strong.join("/")}`);
    if (currentLeague.teamNeeds.length > 0)
      profilePieces.push(`thin at ${currentLeague.teamNeeds.join("/")}`);
  }
  const positionStrengthProfile =
    profilePieces.length > 0 ? profilePieces.join(", ") : "Balanced positional value";

  // Performance — best-effort using current-season standings only.
  const fptsList = scans
    .map((s) => s.managerRecord?.fpts)
    .filter((v): v is number => v != null && v > 0);
  const avgPointsFor =
    fptsList.length > 0
      ? Math.round((fptsList.reduce((a, b) => a + b, 0) / fptsList.length) * 10) / 10
      : null;

  const oldestLeagueSeason = scans
    .map((s) => s.season)
    .sort()[0] || null;

  const crossLeague: ManagerIntelPayload["crossLeague"] = {
    dynastyLeagueCount: leagues.length,
    oldestLeagueSeason,
    estimatedYearsActive: oldestLeagueSeason
      ? Math.max(1, parseInt(season, 10) - parseInt(oldestLeagueSeason, 10) + 1)
      : null,
    tradeCount: totalTrades,
    waiverCount: totalWaivers,
    tradeActivityRating,
    waiverActivityRating,
    mostRosteredPlayers,
    mostDraftedPlayers: null, // Reliable draft attribution requires per-draft picks data we don't fetch in v1.
    commonRosterBuild,
    averageTeamAge,
    positionStrengthProfile,
  };

  const performance: ManagerIntelPayload["performance"] = {
    playoffAppearances: null,
    championshipWins: null,
    finalsAppearances: null,
    avgRegularSeasonFinish: null,
    avgPointsFor,
    notes:
      "Multi-season playoff and championship data isn't reliably exposed by the Sleeper public API. Showing current-season points only.",
  };

  const tradeApproach = buildTradeApproach(currentLeague, crossLeague, mostRosteredPlayers);

  // Replace tradeApproach.summary with the holistic narrative summary used on
  // the Overview tab. The drawer renders both; keeping `suggestedAngle` short
  // and `summary` paragraph-length.
  const summary = buildSummary(user, currentLeague, crossLeague);
  tradeApproach.summary = summary;

  return {
    user: {
      user_id: user.userId,
      username: user.username,
      display_name: user.displayName,
      avatar: user.avatar,
    },
    currentLeague,
    crossLeague,
    performance,
    tradeApproach,
    meta: {
      season,
      leaguesScanned: scans.length,
      computedAt: new Date().toISOString(),
      dataSourceNote:
        "Visible Sleeper leagues only. Private leagues and DMs are not included.",
    },
  };
}

function emptyPayload(
  userId: string,
  season: string,
  note: string,
  user?: SleeperUser,
): ManagerIntelPayload {
  return {
    user: {
      user_id: user?.userId ?? userId,
      username: user?.username ?? userId,
      display_name: user?.displayName ?? userId,
      avatar: user?.avatar ?? null,
    },
    currentLeague: null,
    crossLeague: {
      dynastyLeagueCount: 0,
      oldestLeagueSeason: null,
      estimatedYearsActive: null,
      tradeCount: 0,
      waiverCount: 0,
      tradeActivityRating: "Low",
      waiverActivityRating: "Low",
      mostRosteredPlayers: [],
      mostDraftedPlayers: null,
      commonRosterBuild: "Insufficient data",
      averageTeamAge: null,
      positionStrengthProfile: "Insufficient data",
    },
    performance: {
      playoffAppearances: null,
      championshipWins: null,
      finalsAppearances: null,
      avgRegularSeasonFinish: null,
      avgPointsFor: null,
      notes: note,
    },
    tradeApproach: {
      summary: note,
      suggestedAngle: "Insufficient data — no actionable read available.",
      likelyNeeds: [],
      assetsTheyMayValue: [],
      cautionNotes: "Visible Sleeper leagues only.",
    },
    meta: {
      season,
      leaguesScanned: 0,
      computedAt: new Date().toISOString(),
      dataSourceNote: note,
    },
  };
}
