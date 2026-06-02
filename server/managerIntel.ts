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
 * MAX_LEAGUES_SCANNED to bound the worst case; the route layer caches by
 * (userId, leagueId, season) for 6h on top so the cost is paid rarely.
 */

import { db } from "./db";
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

// Shared, capped Postgres pool (see server/db.ts).

const SLEEPER_API = "https://api.sleeper.app/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
// Bump when the payload shape changes so stale cache rows are treated as misses
// and recomputed rather than served without the newer fields.
const CACHE_VERSION = 22;
// Cap the number of drafts pulled for the draft-tendencies profile. Each draft
// is one /draft/{id}/picks call; the chain discovery is shared with career
// history so no extra league fetches are incurred.
const MAX_DRAFTS_ANALYZED = 50;
const MAX_LEAGUES_SCANNED = 50;
const TRANSACTION_WEEKS = 18;
const FETCH_CONCURRENCY = 4;
// Career history walks each visible league's previous_league_id chain. Bound
// both the depth per chain and the total league-seasons fetched so a power user
// with many deep leagues can't blow up a single request.
const MAX_CAREER_DEPTH = 12;
const MAX_CAREER_LEAGUE_SEASONS = 200;
// Prior seasons whose leagues seed the career walk directly (in addition to the
// current season's). Commissioners who don't renew break the previous_league_id
// chain, so without direct seeding a manager's completed prior seasons — and thus
// their win rate, finishes, and titles — would be invisible.
const CAREER_SEED_PRIOR_SEASONS = 4;
const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

// ── Public types ─────────────────────────────────────────────────────────────

export type ActivityRating = "Low" | "Moderate" | "Active" | "Aggressive" | "Very Active";
export type Rating3 = "Low" | "Medium" | "High";

export interface ScorecardRow {
  category: string;
  rating: string;
  tone: "positive" | "neutral" | "caution" | "info";
}

export interface RankSnapshotRow {
  label: string;
  /** 1 = best in league; null when not computable. */
  rank: number | null;
  total: number;
}

export interface NeedRow {
  position: "QB" | "RB" | "WR" | "TE";
  level: "Low" | "Medium" | "High";
  reason: string;
}

/** Per-roster rank row for a league — enables a consistent You-vs-Them lookup
 *  by ownerId on the client without any viewer-specific server computation. */
export interface LeagueRosterRank {
  ownerId: string;
  rosterId: number;
  dynastyRank: number;
  winNowRank: number;
  youthRank: number;
  pickRank: number | null;
  qbRank: number;
  rbRank: number;
  wrRank: number;
  teRank: number;
  // Per-position win-now (redraft) ranks. Mirror the dynasty-based *Rank fields
  // above so the League tab can show a win-now vs dynasty positional split.
  qbWinNowRank: number;
  rbWinNowRank: number;
  wrWinNowRank: number;
  teWinNowRank: number;
  // Raw values powering the Roster Strength Profile (You/Avg/Best bars). The
  // client derives rank/avg/best across the league from these per-roster
  // values, mirroring the My Team Overview section.
  /** Sum of redraft value of the roster's top-`startersCount` players (win-now starters). */
  contenderValue: number;
  /** Sum of dynasty value of the remaining (non-starter) players. */
  benchValue: number;
  /** Total dynasty value of all rostered players plus owned future picks. */
  dynastyTotalValue: number;
  /** Dynasty value of owned future rookie picks. */
  pickCapitalValue: number;
}

/** A full per-league scouting report for the target manager. */
export interface LeagueReport {
  leagueId: string;
  name: string;
  season: string;
  format: "SF" | "1QB";
  scoringFormat: string;
  totalRosters: number;
  startersCount: number | null;
  /** Whether the requested ?leagueId pointed at this league. */
  isRequested: boolean;
  ownerId: string;
  rosterId: number;
  teamName: string;
  teamDirection: "Contender" | "Middle" | "Rebuild" | "Unknown";
  teamIdentity: { label: string; blurb: string };
  contextSummary: string;
  dynastyStrengths: PositionScore[];
  winNowStrengths: PositionScore[];
  /** Dynasty value of the target's owned future picks (for the dynasty pie). */
  pickValue: number;
  needs: NeedRow[];
  rankSnapshot: RankSnapshotRow[];
  relativeWeakness: string | null;
  tradeOpportunity: string;
  pickCapitalSummary: string;
  ageSummary: string;
  /** Ranks for every roster in the league (target + everyone else). */
  rosters: LeagueRosterRank[];
}

/** One (league, season) the manager rostered a team in, newest-first when listed. */
export interface CareerSeasonRow {
  season: string;
  leagueName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Null when the season has no winners-bracket data (in-progress or hidden). */
  madePlayoffs: boolean | null;
  champion: boolean | null;
  /** Finish bucket by final regular-season standing: 1 = top 25%, 2 = 26–50%,
   *  3 = 51–75%, 4 = bottom 25%. Null for in-progress seasons (not yet a finish)
   *  or when standings can't be resolved. */
  finishQuartile: number | null;
}

/** Distribution of completed-season finishes across standing quartiles. */
export interface CareerFinishes {
  /** Finished in the top quarter of the standings. */
  top25: number;
  /** 26–50%. */
  upperMid: number;
  /** 51–75%. */
  lowerMid: number;
  /** Bottom quarter. */
  bottom25: number;
  /** Completed seasons counted (sum of the four buckets). */
  total: number;
}

export interface CareerHistory {
  /** True once at least one league-season was resolved from the chain walk. */
  available: boolean;
  /** Distinct seasons the manager fielded a team across all visible chains. */
  seasonsActive: number;
  firstSeason: string | null;
  latestSeason: string | null;
  /** Total (league, season) entries — a 3-league, 2-season history = 6. */
  leagueSeasonsPlayed: number;
  record: { wins: number; losses: number; ties: number } | null;
  /** 0–100, ties counted as half-wins. */
  winPct: number | null;
  /** Average regular-season points-for per league-season. */
  avgPointsForPerSeason: number | null;
  /** Best-effort from completed-season brackets; null if no bracket data found. */
  championships: number | null;
  playoffAppearances: number | null;
  /** Completed-season finishes bucketed by standing quartile; null when no
   *  season has completed yet. */
  finishes: CareerFinishes | null;
  /** Per-season breakdown, newest first. */
  seasons: CareerSeasonRow[];
  /** True when the chain walk hit the league-season cap and stopped early. */
  truncated: boolean;
  note: string;
}

/** A single position-frequency row for the draft heatmap. Values are the % of
 *  the manager's picks in that round that were each position (each row ~100%). */
export interface DraftHeatmapRow {
  round: number;
  QB: number;
  RB: number;
  WR: number;
  TE: number;
}

/** Per-position draft investment vs the real pooled league baseline. */
export interface DraftBiasRow {
  position: "QB" | "RB" | "WR" | "TE";
  /** Share of the manager's core picks at this position. */
  userPct: number;
  /** Share of ALL drafters' core picks at this position, same drafts. */
  leagueAvgPct: number;
  /** userPct − leagueAvgPct, positive = over-drafts this position. */
  difference: number;
}

/** How a manager drafts across every visible dynasty draft (startup + rookie),
 *  aggregated across all seasons via the previous_league_id chain. */
export interface DraftProfile {
  /** True once the manager has at least one attributable core pick. */
  available: boolean;
  /** Drafts that returned picks and were included. */
  draftsAnalyzed: number;
  /** The manager's core (QB/RB/WR/TE) picks counted. */
  totalPicksAnalyzed: number;
  /** True when the draft count was capped (older drafts were skipped). */
  truncated: boolean;
  /** Round-by-round position frequency for the manager's picks. */
  heatmap: DraftHeatmapRow[];
  /** Per-position over/under-draft vs the pooled league baseline. */
  positionalBias: DraftBiasRow[];
  /** Rule-based read of the round-by-round tendencies. */
  tendencyAnalysis: string;
  /** Rule-based read of the positional bias. */
  biasAnalysis: string;
  note: string;
}

export interface ManagerIntelPayload {
  user: {
    user_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
  };
  /** Polished one-line "what kind of roster this is" statement. */
  rosterIdentity: string;
  /** Compact chips for the page header. */
  headerBadges: string[];
  /** How much to trust this read, given visible-league coverage. */
  confidence: { level: Rating3; basis: string };
  /** At-a-glance ratings table. */
  scorecard: ScorecardRow[];
  /** Derived behavioral leanings (also feed the scorecard + client matching). */
  preferences: {
    youthPreference: Rating3;
    veteranPreference: Rating3;
    pickValue: Rating3;
    aggressiveness: Rating3;
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
    /** Where this team ranks within the league on key axes. */
    rankSnapshot: RankSnapshotRow[];
    /** Plain-language identity card. */
    teamIdentity: { label: string; blurb: string };
    /** Softest position group even when there are no hard holes. */
    relativeWeakness: string | null;
  } | null;
  /** Per-league scouting reports across every visible league (drives the
   *  League tab's league selector + You-vs-Them comparison). */
  leagues: LeagueReport[];
  crossLeague: {
    dynastyLeagueCount: number;
    oldestLeagueSeason: string | null;
    estimatedYearsActive: number | null;
    tradeCount: number;
    waiverCount: number;
    tradeActivityRating: ActivityRating;
    waiverActivityRating: ActivityRating;
    mostRosteredPlayers: PlayerExposure[];
    /** Top exposure split out by position for easier scanning. */
    mostRosteredByPosition: { QB: PlayerExposure[]; RB: PlayerExposure[]; WR: PlayerExposure[]; TE: PlayerExposure[] };
    mostDraftedPlayers: PlayerExposure[] | null;
    /** Average roster value per position across the manager's visible leagues,
     *  split into dynasty and redraft. Per-league values are already SF/1QB
     *  aware (applied during the scan). Null when no rosters were found. */
    valueByPosition: {
      leagueCount: number;
      dynasty: Array<{ position: "QB" | "RB" | "WR" | "TE"; value: number }>;
      redraft: Array<{ position: "QB" | "RB" | "WR" | "TE"; value: number }>;
    } | null;
    /** Managers who share the most of this user's active leagues, ranked by
     *  shared-league count (top 12). */
    topLeaguemates: Array<{ ownerId: string; displayName: string; avatar: string | null; sharedLeagues: number }>;
    commonRosterBuild: string;
    averageTeamAge: number | null;
    positionStrengthProfile: string;
    /** "What kind of players they collect" tags, with a confidence label. */
    favoritePlayerTypes: Array<{ type: string; confidence: Rating3 }>;
    /** Memorable portfolio archetype title, e.g. "Young Upside Builder". */
    portfolioType: string;
    /** Sentence summarizing their cross-league portfolio identity. */
    portfolioIdentity: string;
    /** Per-position investment read across visible leagues. */
    positionBias: Array<{ position: "QB" | "RB" | "WR" | "TE"; signal: string; interpretation: string }>;
    /** What this portfolio implies for trading with them. */
    tradeImplications: { likelyValues: string[]; unlikelyValues: string[]; bestAngle: string };
  };
  performance: {
    playoffAppearances: number | null;
    championshipWins: number | null;
    finalsAppearances: number | null;
    avgRegularSeasonFinish: number | null;
    avgPointsFor: number | null;
    notes: string;
  };
  /** Multi-season career history, aggregated by walking each visible league's
   *  previous_league_id chain. All-time, as opposed to crossLeague/activity
   *  which are current-season only. */
  careerHistory: CareerHistory;
  /** How the manager drafts across every visible dynasty draft (startup +
   *  rookie, all seasons). Powers the League tab's draft-tendencies card. */
  draftProfile: DraftProfile;
  /** Current visible-season activity (the reframed "History"/Track Record tab). */
  activity: {
    visibleLeagues: number;
    oldestVisibleSeason: string | null;
    estimatedYearsActive: number | null;
    currentPointsFor: number | null;
    tradeCount: number;
    waiverCount: number;
    totalTransactions: number;
    activitySignal: "Active" | "Moderate" | "Quiet" | "Ghost";
    signalNote: string;
    /** Branded activity persona (Steady Manager, Trade Shark, etc.). */
    activityArchetype: { key: string; label: string; blurb: string };
    /** How easy they are to engage in a trade. High = very reachable. */
    tradeability: { level: Rating3; note: string };
    /** ISO date of the most recent visible transaction, or null. */
    lastActivity: string | null;
    /** Manager transactions in the trailing 30 / 90 days. */
    last30Days: number;
    last90Days: number;
    /** Direction of recent activity vs the prior window. */
    activityTrend: "Increasing" | "Stable" | "Declining" | "Unknown";
    /** Most recent visible transactions (newest first). */
    recent: Array<{ date: string; league: string; type: string }>;
    /** Detailed trade history across all visible dynasty leagues (newest first). */
    tradeHistory: Array<{ date: string; league: string; leagueType: string; week: number | null; added: string[]; dropped: string[]; partner: string }>;
    /** Detailed waiver/FA add history across all visible dynasty leagues (newest first). */
    waiverHistory: Array<{ date: string; league: string; kind: "waiver" | "free_agent"; added: string[]; dropped: string[] }>;
  };
  tradeApproach: {
    summary: string;
    suggestedAngle: string;
    /** One-line "what to actually do" recommendation for the Overview hero. */
    actionableTakeaway: string;
    /** Quick do / don't trade guidance. */
    doList: string[];
    dontList: string[];
    likelyNeeds: string[];
    assetsTheyMayValue: string[];
    cautionNotes: string;
    /** Structured "how to deal with them" profile. */
    tradeProfile: {
      tradeActivity: string;
      tradeStyle: string;
      bestOfferType: string;
      avoidOffering: string;
      likelyTargets: string[];
      sellCandidates: string[];
    };
    /** Templated opening-offer ideas. */
    openingOffers: string[];
    /** Positions they're most likely shopping for — drives client roster-match. */
    targetPositions: Array<"QB" | "RB" | "WR" | "TE">;
    /** Whether the client should bias roster-match toward younger players. */
    preferYouth: boolean;
    /** How hard they are to deal with, and why. */
    tradeDifficulty: { level: Rating3; reason: string };
    /** Consolidated "how to get a deal done" cheat sheet. */
    playbook: {
      bestApproach: string;
      likelyStyle: string;
      bestDealType: string;
      likelyMotivation: string;
      negotiationStyle: string;
      avoid: string;
    };
    /** Which kinds of deals fit them, with a fit rating. */
    dealTypes: Array<{ dealType: string; fit: Rating3; why: string }>;
    /** Short negotiation guidance bullets. */
    negotiationNotes: string[];
    /** Specific players of theirs worth targeting (current league roster). */
    targetableAssets: Array<{ name: string; pos: string; age: number | null; value: number; reason: string; difficulty: Rating3 }>;
    /** Players of theirs they're likely to protect. */
    protectedAssets: Array<{ name: string; pos: string; value: number; reason: string }>;
    /** Grouped target/sell reads for clearer scanning. */
    likelyTargetsGrouped: { high: string[]; conditional: string[] };
    sellCandidatesGrouped: { mostLikely: string[]; leastLikely: string[] };
  };
  meta: {
    season: string;
    leaguesScanned: number;
    computedAt: string;
    dataSourceNote: string;
    /** Payload schema version — bumped to invalidate stale cache rows. */
    version: number;
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
  /** Player age, when known — lets the client tag prospect vs veteran signals. */
  age: number | null;
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
  // Best-effort: a cache-layer failure (e.g. table not yet migrated, DB blip)
  // must never take down the endpoint — fall through to a live recompute.
  try {
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
    const payload = row.payload as ManagerIntelPayload;
    // Treat pre-versioned / older-schema rows as misses so we recompute with
    // the current field set instead of serving a partial payload.
    if ((payload?.meta?.version ?? 0) < CACHE_VERSION) return null;
    return payload;
  } catch (err: any) {
    console.error("[ManagerIntel] cache read failed:", err?.message || err);
    return null;
  }
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
      "Offer balanced packages. They're open to either side. Frame deals as upgrades, not pivots.";
  } else {
    suggestedAngle =
      "Direction is unclear. Feel them out with a low-cost opener before tailoring.";
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
    assetsTheyMayValue.push("Insufficient signal. Open with a balanced two-for-two.");
  }

  let cautionNotes: string;
  if (cross.tradeActivityRating === "Low") {
    cautionNotes =
      "Manager rarely trades. Confidence in this read is low. Treat suggestions as a starting point only.";
  } else if (cross.dynastyLeagueCount <= 1) {
    cautionNotes =
      "Only one visible dynasty league. Cross-league tendencies are not reliable here.";
  } else {
    cautionNotes = "Based on visible Sleeper leagues only; private leagues are not included.";
  }

  return {
    summary: suggestedAngle,
    suggestedAngle,
    actionableTakeaway: suggestedAngle,
    doList: [],
    dontList: [],
    likelyNeeds: needs,
    assetsTheyMayValue,
    cautionNotes,
    // Filled in by computeManagerIntel via buildTradeProfile/buildOpeningOffers.
    tradeProfile: {
      tradeActivity: cross.tradeActivityRating,
      tradeStyle: "Unknown",
      bestOfferType: "Balanced upgrade packages",
      avoidOffering: "Lateral moves with no clear upgrade",
      likelyTargets: [],
      sellCandidates: [],
    },
    openingOffers: [],
    targetPositions: [],
    preferYouth: false,
    tradeDifficulty: { level: "Medium", reason: "" },
    playbook: {
      bestApproach: "Balanced upgrade packages",
      likelyStyle: "Unknown",
      bestDealType: "Balanced package",
      likelyMotivation: "Unclear direction",
      negotiationStyle: "Unknown",
      avoid: "Lateral moves with no clear upgrade",
    },
    dealTypes: [],
    negotiationNotes: [],
    targetableAssets: [],
    protectedAssets: [],
    likelyTargetsGrouped: { high: [], conditional: [] },
    sellCandidatesGrouped: { mostLikely: [], leastLikely: [] },
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
    return `${picks.ownedPickCount} rookie picks total (${picks.earlyPicks} early, strong asset base).`;
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
  co_owners?: string[] | null;
  players: string[] | null;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
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
  name: string;
  season: string;
  format: "SF" | "1QB";
  scoringFormat: string;
  /** Starting lineup slot count (excludes BN/IR/TAXI). null if unknown. */
  startersCount: number | null;
  totalRosters: number;
  managerRoster: RawRosterPick[] | null;
  /** Every roster in this league, hydrated with values + positions. */
  allRosters: RawRosterPick[][];
  /** { ownerId, rosterId } aligned with allRosters by index. */
  rosterMeta: Array<{ ownerId: string; rosterId: number }>;
  /** League members (roster owners) with display name + avatar, for the
   *  cross-league "top leaguemates" aggregation. */
  owners: Array<{ ownerId: string; displayName: string; avatar: string | null }>;
  /** Weighted future-pick score per rosterId (early picks count double). */
  pickScoreByRoster: Record<number, number>;
  /** Dynasty value of owned future picks per rosterId (FantasyCalc baselines). */
  pickValueByRoster: Record<number, number>;
  /** roster_id of the manager in this league, or null if not present. */
  managerRosterId: number | null;
  /** Count of completed trade transactions involving the manager this season. */
  managerTrades: number;
  /** Count of waiver/FA transactions initiated by the manager this season. */
  managerWaivers: number;
  /** Timestamped manager transactions (epoch ms) for timeline aggregation. */
  managerTxns: Array<{ ts: number; type: "trade" | "waiver" }>;
  /** Detailed manager trade events in this league (what they got/gave). */
  managerTradeEvents: Array<{ ts: number; leagueName: string; leagueType: string; week: number | null; added: string[]; dropped: string[]; partner: string }>;
  /** Detailed manager waiver/FA add events in this league. */
  managerWaiverEvents: Array<{ ts: number; leagueName: string; kind: "waiver" | "free_agent"; added: string[]; dropped: string[] }>;
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

  // Generalized future-pick ownership for EVERY roster (drives pick-capital
  // ranks). Each roster starts owning its own (year, round) picks; traded_picks
  // reassign current ownership. Early picks (rounds 1–2) are weighted double.
  const pickScoreByRoster: Record<number, number> = {};
  const pickValueByRoster: Record<number, number> = {};
  {
    const futureYears = [
      parseInt(league.season, 10) + 1,
      parseInt(league.season, 10) + 2,
      parseInt(league.season, 10) + 3,
    ];
    const baseRounds = [1, 2, 3, 4];
    const pickOwner = new Map<string, number>(); // "year-round-originalRoster" -> current owner rosterId
    for (const r of rosters) {
      for (const y of futureYears) for (const rd of baseRounds) pickOwner.set(`${y}-${rd}-${r.roster_id}`, r.roster_id);
    }
    for (const tp of tradedPicks || []) {
      const yr = parseInt(tp.season, 10);
      if (!futureYears.includes(yr)) continue;
      const key = `${yr}-${tp.round}-${tp.roster_id}`;
      if (pickOwner.has(key)) pickOwner.set(key, tp.owner_id);
    }
    for (const r of rosters) pickScoreByRoster[r.roster_id] = 0;
    pickOwner.forEach((owner, key) => {
      const round = parseInt(key.split("-")[1], 10);
      pickScoreByRoster[owner] = (pickScoreByRoster[owner] || 0) + (round <= 2 ? 2 : 1);
    });

    // Dynasty value of each roster's owned picks, using FantasyCalc round
    // baselines (FP_{season}_{round}) so picks are on the same scale as players.
    for (const r of rosters) pickValueByRoster[r.roster_id] = 0;
    pickOwner.forEach((owner, key) => {
      const [yStr, rdStr] = key.split("-");
      const baseline = fcDyn[`FP_${yStr}_${rdStr}`] || 0;
      pickValueByRoster[owner] = (pickValueByRoster[owner] || 0) + baseline;
    });
  }

  const rosterMeta = rosters.map((r) => ({ ownerId: r.owner_id, rosterId: r.roster_id }));
  const owners = rosters
    .filter((r) => r.owner_id)
    .map((r) => {
      const u = users?.find((x) => x.user_id === r.owner_id);
      return {
        ownerId: r.owner_id,
        displayName: u?.display_name || u?.username || `Team ${r.roster_id}`,
        avatar: u?.avatar ?? null,
      };
    });
  const startersCount = league.rosterPositions
    ? league.rosterPositions.filter((p) => !["BN", "IR", "TAXI"].includes(p)).length
    : null;

  // Trade/waiver counts — page through 18 transaction weeks. Also capture each
  // manager transaction's timestamp so we can build a recent-activity timeline.
  let managerTrades = 0;
  let managerWaivers = 0;
  const managerTxns: Array<{ ts: number; type: "trade" | "waiver" }> = [];
  const managerTradeEvents: LeagueScan["managerTradeEvents"] = [];
  const managerWaiverEvents: LeagueScan["managerWaiverEvents"] = [];
  if (managerRosterId != null) {
    // rosterId → display team name (for trade partners).
    const teamNameByRoster = new Map<number, string>();
    for (const r of rosters) {
      const u = users?.find((x) => x.user_id === r.owner_id);
      teamNameByRoster.set(r.roster_id, u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`);
    }
    const nameOf = (pid: string): string => {
      const p = playersDb[pid];
      return p?.full_name || (p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : pid);
    };
    const pickLabel = (dp: any): string => `${dp.season} R${dp.round} pick`;

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
        const ts = Number(t.status_updated ?? t.created ?? 0) || 0;

        const added: string[] = [];
        const dropped: string[] = [];
        for (const [pid, rid] of Object.entries(t.adds || {})) if (rid === managerRosterId) added.push(nameOf(pid));
        for (const [pid, rid] of Object.entries(t.drops || {})) if (rid === managerRosterId) dropped.push(nameOf(pid));

        if (t.type === "trade") {
          managerTrades++;
          managerTxns.push({ ts, type: "trade" });
          for (const dp of t.draft_picks || []) {
            if (dp.owner_id === managerRosterId) added.push(pickLabel(dp));
            else if (dp.previous_owner_id === managerRosterId) dropped.push(pickLabel(dp));
          }
          const partner = (t.roster_ids as number[])
            .filter((rid) => rid !== managerRosterId)
            .map((rid) => teamNameByRoster.get(rid) || `Team ${rid}`)
            .join(", ");
          managerTradeEvents.push({ ts, leagueName: league.name, leagueType: league.type, week: Number(t.leg) || null, added, dropped, partner });
        } else if (t.type === "waiver" || t.type === "free_agent") {
          managerWaivers++;
          managerTxns.push({ ts, type: "waiver" });
          managerWaiverEvents.push({
            ts,
            leagueName: league.name,
            kind: t.type === "waiver" ? "waiver" : "free_agent",
            added,
            dropped,
          });
        }
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
    name: league.name,
    season: league.season,
    format: league.format as "SF" | "1QB",
    scoringFormat: league.scoringFormat,
    startersCount,
    totalRosters: league.totalRosters,
    managerRoster,
    allRosters,
    rosterMeta,
    owners,
    pickScoreByRoster,
    pickValueByRoster,
    managerRosterId,
    managerTrades,
    managerWaivers,
    managerTxns,
    managerTradeEvents,
    managerWaiverEvents,
    picks,
    managerRecord,
    teamName,
    ownedPlayerIds: managerRoster ? managerRoster.map((p) => p.playerId) : [],
  };
}

// ── Tendency + archetype synthesis ───────────────────────────────────────────

/** One aggregated exposure entry enriched with age/experience for typing. */
interface ExposureRich {
  pos: string;
  age: number | null;
  exp: number | null;
  leagueCount: number;
}

function youthRating(avgAge: number | null): Rating3 {
  if (avgAge == null) return "Medium";
  if (avgAge <= 24.8) return "High";
  if (avgAge <= 26.6) return "Medium";
  return "Low";
}

function veteranRating(avgAge: number | null): Rating3 {
  if (avgAge == null) return "Medium";
  if (avgAge >= 28) return "High";
  if (avgAge >= 26.6) return "Medium";
  return "Low";
}

function pickValueRating(avgEarlyPicks: number): Rating3 {
  if (avgEarlyPicks >= 2) return "High";
  if (avgEarlyPicks >= 1) return "Medium";
  return "Low";
}

function aggressivenessRating(trade: ActivityRating, waiver: ActivityRating): Rating3 {
  const score = (r: ActivityRating) =>
    r === "Aggressive" || r === "Very Active" ? 2 : r === "Active" ? 1 : 0;
  const s = score(trade) + score(waiver);
  if (s >= 3) return "High";
  if (s >= 1) return "Medium";
  return "Low";
}

type TeamDirection = "Contender" | "Middle" | "Rebuild" | "Unknown";

function ageBadge(youthPref: Rating3, veteranPref: Rating3): string {
  if (youthPref === "High") return "Young Roster";
  if (veteranPref === "High") return "Veteran Roster";
  return "Balanced Age";
}

function buildConfidence(leagueCount: number, totalTxns: number): { level: Rating3; basis: string } {
  let level: Rating3 = leagueCount >= 5 ? "High" : leagueCount >= 2 ? "Medium" : "Low";
  if (totalTxns < 2 && level === "High") level = "Medium";
  const lg = `${leagueCount} visible dynasty league${leagueCount === 1 ? "" : "s"}`;
  const txn = `${totalTxns} visible transaction${totalTxns === 1 ? "" : "s"}`;
  const basis =
    level === "High"
      ? `Based on ${lg} and ${txn}: enough roster and activity signal to read tendencies reliably.`
      : level === "Medium"
      ? `Based on ${lg} and ${txn}: a moderate sample, so treat finer reads as directional.`
      : `Based on only ${lg} and ${txn}: limited signal. Treat this as a rough first impression.`;
  return { level, basis };
}

/** Rank within a league: 1 = highest value. `lowerIsBetter` flips for age. */
function rankOf(values: number[], mine: number, lowerIsBetter = false): number | null {
  if (values.length === 0) return null;
  const better = lowerIsBetter
    ? values.filter((v) => v < mine).length
    : values.filter((v) => v > mine).length;
  return better + 1;
}

function buildTeamIdentity(
  dynasty: PositionScore[],
  direction: TeamDirection,
  avgAge: number | null,
): { label: string; blurb: string } {
  const strong = dynasty.filter((p) => p.tier === "Elite" || p.tier === "Strong").map((p) => p.position);
  const weak = dynasty.filter((p) => p.tier === "Weak" || p.tier === "Thin").map((p) => p.position);
  const ageWord = avgAge == null ? "" : avgAge <= 24.8 ? "Young " : avgAge >= 28 ? "Veteran " : "";
  const dirWord =
    direction === "Rebuild" ? "Rebuild"
    : direction === "Contender" ? "Contender"
    : direction === "Middle" ? "Core"
    : "Roster";
  const coreClause = strong.length ? ` With Strong ${strong.join("/")} Core` : "";
  const label = `${ageWord}${dirWord}${coreClause}`.trim();
  const parts: string[] = [];
  if (strong.length) parts.push(`Strong at ${strong.join(", ")}`);
  if (weak.length) parts.push(`thin at ${weak.join(", ")}`);
  const blurb = parts.length ? `${parts.join(", ")}.` : "Balanced positional value across the board.";
  return { label, blurb };
}

function buildRelativeWeakness(dynasty: PositionScore[], needs: string[]): string | null {
  if (needs.length > 0) return null; // hard holes are already surfaced as needs
  const sorted = [...dynasty].sort((a, b) => a.vsLeagueAvg - b.vsLeagueAvg);
  const weakest = sorted[0];
  if (!weakest) return null;
  const pct = `${weakest.vsLeagueAvg > 0 ? "+" : ""}${weakest.vsLeagueAvg}%`;
  return `No severe positional holes, but ${weakest.position} is their least valuable group vs league average (${pct}).`;
}

function buildFavoritePlayerTypes(
  exposures: ExposureRich[],
  totalLeagues: number,
): Array<{ type: string; confidence: Rating3 }> {
  // Weight by leagueCount so a player carried across many leagues counts more.
  const w = (es: ExposureRich[]) => es.reduce((s, e) => s + e.leagueCount, 0);
  const young = exposures.filter((e) => e.age != null && e.age <= 24);
  const vets = exposures.filter((e) => e.age != null && e.age >= 29);
  const rookies = exposures.filter((e) => e.exp != null && e.exp <= 1);
  const tags: Array<{ tag: string; weight: number }> = [];
  const add = (tag: string, weight: number, min: number) => {
    if (weight >= min) tags.push({ tag, weight });
  };
  add("Rookies & first-year players", w(rookies), 4);
  add("Young / rookie RBs", w(young.filter((e) => e.pos === "RB")), 3);
  add("Young WRs", w(young.filter((e) => e.pos === "WR")), 4);
  add("Young QBs", w(young.filter((e) => e.pos === "QB")), 2);
  add("TE prospects", w(young.filter((e) => e.pos === "TE")), 2);
  add("Productive veterans", w(vets), 4);
  // Confidence scales the cluster weight against how many leagues we can see —
  // a tag backed by ~1 player per league reads "High", a thin one "Low".
  const confidenceFor = (weight: number): Rating3 => {
    if (weight >= Math.max(6, totalLeagues)) return "High";
    if (weight >= Math.max(4, totalLeagues * 0.6)) return "Medium";
    return "Low";
  };
  return tags
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((t) => ({ type: t.tag, confidence: confidenceFor(t.weight) }));
}

function buildPortfolioType(
  youthPref: Rating3,
  veteranPref: Rating3,
  favoriteTypes: Array<{ type: string }>,
): string {
  const topRookie = favoriteTypes[0]?.type?.toLowerCase().includes("rookie");
  if (veteranPref === "High" && youthPref !== "High") return "Veteran-Anchored Portfolio";
  if (youthPref === "High") return topRookie ? "Prospect-Heavy Portfolio" : "Young Upside Builder";
  return "Balanced Portfolio Builder";
}

function buildPortfolioIdentity(
  portfolioType: string,
  youthPref: Rating3,
  veteranPref: Rating3,
  favoriteTypes: Array<{ type: string }>,
  topPosConc: { pos: string; share: number } | null,
): string {
  const lean =
    youthPref === "High" ? "lean toward future value and rookie/early-career assets"
    : veteranPref === "High" ? "lean on proven veteran production over speculative youth"
    : "balance youth and veteran value";
  const types = favoriteTypes.length
    ? `, especially ${favoriteTypes.slice(0, 3).map((t) => t.type.toLowerCase()).join(", ")}`
    : "";
  const conc =
    topPosConc && topPosConc.share >= 0.4 ? ` Their exposure skews heavily toward ${topPosConc.pos}.` : "";
  const closer =
    youthPref === "High"
      ? " They're unlikely to heavily prioritize aging short-term veterans unless the value is obvious."
      : veteranPref === "High"
      ? " Speculative youth is unlikely to move them without a clear value edge."
      : " They can be approached from either the win-now or future-value side.";
  return `This manager profiles as a ${portfolioType.toLowerCase()}. Their rosters ${lean}${types}.${conc}${closer}`;
}

function buildPositionBias(
  exposures: ExposureRich[],
): Array<{ position: "QB" | "RB" | "WR" | "TE"; signal: string; interpretation: string }> {
  const positions: Array<"QB" | "RB" | "WR" | "TE"> = ["QB", "RB", "WR", "TE"];
  return positions.map((pos) => {
    const entries = exposures.filter((e) => e.pos === pos);
    const weight = entries.reduce((s, e) => s + e.leagueCount, 0);
    if (weight === 0) {
      return { position: pos, signal: "Light", interpretation: "Little cross-league exposure here." };
    }
    const aged = entries.filter((e) => e.age != null);
    const youngWeight = aged.filter((e) => (e.age as number) <= 24).reduce((s, e) => s + e.leagueCount, 0);
    const agedWeight = aged.reduce((s, e) => s + e.leagueCount, 0) || 1;
    const young = youngWeight / agedWeight >= 0.5;
    switch (pos) {
      case "QB":
        return young
          ? { position: pos, signal: "Young-heavy", interpretation: "Invests in young QB upside." }
          : { position: pos, signal: "Strong", interpretation: "Values QB stability and scarcity." };
      case "RB":
        return young
          ? { position: pos, signal: "Prospect-heavy", interpretation: "Willing to bet on young RB upside." }
          : { position: pos, signal: "Veteran-leaning", interpretation: "Prefers proven RB production." };
      case "WR":
        return young
          ? { position: pos, signal: "Young-heavy", interpretation: "Prioritizes long-term WR value." }
          : { position: pos, signal: "Balanced", interpretation: "Mixes proven and developing WRs." };
      case "TE":
        return young
          ? { position: pos, signal: "Prospect-heavy", interpretation: "Likes upside TE stashes." }
          : { position: pos, signal: "Established", interpretation: "Values reliable TE production." };
    }
  });
}

function buildTradeImplications(
  prefs: ManagerIntelPayload["preferences"],
  positionBias: Array<{ position: string; signal: string }>,
): { likelyValues: string[]; unlikelyValues: string[]; bestAngle: string } {
  const likely: string[] = [];
  const unlikely: string[] = [];
  const youngWR = positionBias.find((p) => p.position === "WR")?.signal.includes("Young");
  const youngRB = positionBias.find((p) => p.position === "RB")?.signal.includes("Prospect");
  const proTE = positionBias.find((p) => p.position === "TE")?.signal === "Prospect-heavy";

  if (prefs.youthPreference !== "Low") {
    likely.push("Young, high-upside WRs");
    if (youngRB) likely.push("Rookie / young RBs");
    if (proTE) likely.push("TE prospects");
    likely.push("Premium young QBs");
  } else {
    likely.push("Proven, productive starters");
  }
  if (prefs.pickValue !== "Low") likely.push("Rookie / future draft picks");
  if (youngWR && !likely.includes("Young, high-upside WRs")) likely.push("Young, high-upside WRs");

  if (prefs.youthPreference !== "Low") {
    unlikely.push("Aging veterans", "Short-term RB rentals", "Low-upside depth pieces", "Win-now production with no future value");
  } else {
    unlikely.push("Multi-year projects with no current impact", "Speculative deep stashes");
  }

  const bestAngle =
    prefs.youthPreference !== "Low"
      ? "Lead with youth, picks, or long-term upside. Avoid framing the offer around immediate production unless the player still carries dynasty value."
      : "Lead with proven production and clear win-now upgrades rather than speculative youth.";

  return { likelyValues: likely.slice(0, 6), unlikelyValues: unlikely.slice(0, 5), bestAngle };
}

function buildScorecard(
  tradeRating: ActivityRating,
  waiverRating: ActivityRating,
  direction: TeamDirection,
  prefs: ManagerIntelPayload["preferences"],
  build: string,
  bestTradeAngle: string,
): ScorecardRow[] {
  const tone3 = (r: Rating3): ScorecardRow["tone"] =>
    r === "High" ? "positive" : r === "Low" ? "caution" : "neutral";
  const activityTone = (r: ActivityRating): ScorecardRow["tone"] =>
    r === "Aggressive" || r === "Very Active" ? "positive" : r === "Active" ? "neutral" : "caution";
  return [
    { category: "Trade Activity", rating: tradeRating, tone: activityTone(tradeRating) },
    { category: "Waiver Activity", rating: waiverRating, tone: activityTone(waiverRating) },
    { category: "Dynasty Direction", rating: direction, tone: "info" },
    { category: "Aggressiveness", rating: prefs.aggressiveness, tone: tone3(prefs.aggressiveness) },
    { category: "Pick Value", rating: prefs.pickValue, tone: tone3(prefs.pickValue) },
    { category: "Youth Preference", rating: prefs.youthPreference, tone: tone3(prefs.youthPreference) },
    { category: "Veteran Preference", rating: prefs.veteranPreference, tone: tone3(prefs.veteranPreference) },
    { category: "Roster Construction", rating: build, tone: "info" },
    { category: "Best Trade Angle", rating: bestTradeAngle, tone: "positive" },
  ];
}

function bestOfferLabel(direction: TeamDirection): string {
  return direction === "Rebuild" ? "Picks + young upside"
    : direction === "Contender" ? "Proven win-now production"
    : "Balanced upgrade packages";
}

function buildTradeProfile(
  direction: TeamDirection,
  tradeRating: ActivityRating,
  prefs: ManagerIntelPayload["preferences"],
  dynasty: PositionScore[],
  needs: string[],
): { profile: ManagerIntelPayload["tradeApproach"]["tradeProfile"]; targetPositions: Array<"QB" | "RB" | "WR" | "TE">; preferYouth: boolean } {
  const style =
    direction === "Rebuild" ? "Patient rebuilder"
    : direction === "Contender" ? "Win-now buyer"
    : direction === "Middle" ? "Opportunistic dealer"
    : "Feeling-out / unclear";
  const bestOfferType = bestOfferLabel(direction);
  const avoidOffering =
    direction === "Rebuild" ? "Aging veterans / short-term RB production"
    : direction === "Contender" ? "Multi-year projects with no current-season impact"
    : "Lateral moves with no clear upgrade";

  // Targets: hard needs first, otherwise the softest position group.
  const sortedWeak = [...dynasty].sort((a, b) => a.vsLeagueAvg - b.vsLeagueAvg);
  const targetPositions = (needs.length > 0
    ? needs
    : sortedWeak.slice(0, 1).map((p) => p.position)) as Array<"QB" | "RB" | "WR" | "TE">;

  const preferYouth = prefs.youthPreference !== "Low" && direction !== "Contender";
  const likelyTargets: string[] = [];
  if (targetPositions.length) likelyTargets.push(`Help at ${targetPositions.join(", ")}`);
  if (preferYouth) likelyTargets.push("Young, high-upside players");
  else likelyTargets.push("Established, productive players");
  if (prefs.pickValue !== "High" && direction === "Rebuild") likelyTargets.push("Rookie / future 1st-round picks");
  if (direction === "Contender") likelyTargets.push("Win-now starters at any position");

  const sellCandidates: string[] = [];
  const strong = dynasty.filter((p) => p.tier === "Elite" || p.tier === "Strong").map((p) => p.position);
  if (strong.length) sellCandidates.push(`Surplus depth at ${strong.join(", ")}`);
  sellCandidates.push(direction === "Rebuild" ? "Aging veterans they're cycling out" : "Younger projects that don't fit the window");

  return {
    profile: {
      tradeActivity: tradeRating,
      tradeStyle: style,
      bestOfferType,
      avoidOffering,
      likelyTargets,
      sellCandidates,
    },
    targetPositions,
    preferYouth,
  };
}

function buildOpeningOffers(
  direction: TeamDirection,
  needs: string[],
  season: string,
): string[] {
  const nextYr = parseInt(season, 10) + 1;
  const need = needs[0] || "a position of need";
  if (direction === "Rebuild") {
    return [
      `${nextYr} 1st + a young WR for an established producer`,
      `Two young pieces consolidated into one elite asset they covet`,
      `Aging veteran on your side for their ${need} youth + a future 2nd`,
    ];
  }
  if (direction === "Contender") {
    return [
      `Win-now starter for their picks + a young upside flier`,
      `Proven ${need} producer for a future 1st + depth`,
      `Two-for-one: package depth into a clear starter upgrade`,
    ];
  }
  return [
    `Balanced two-for-two framed as a ${need} upgrade`,
    `${nextYr} pick + depth for a starter at their weak spot`,
    `Buy-low on a struggling asset to test their openness`,
  ];
}

/** One-line "what to actually do" recommendation for the Overview hero. */
function buildActionableTakeaway(
  direction: TeamDirection,
  targetPositions: string[],
  preferYouth: boolean,
  pickValue: Rating3,
): string {
  const leadWith: string[] = [];
  if (preferYouth) leadWith.push("young upside");
  if (pickValue !== "High" || direction === "Rebuild") leadWith.push("premium picks");
  if (targetPositions.length) leadWith.push(`help at ${targetPositions.join("/")}`);
  if (leadWith.length === 0) leadWith.push("a clear, balanced upgrade");
  const avoid =
    direction === "Contender"
      ? "Avoid multi-year projects with no current-season impact."
      : "Avoid veteran-heavy offers unless they're clearly discounted.";
  return `Target this manager with ${leadWith.slice(0, 3).join(", ")}. ${avoid}`;
}

/** Quick do / don't trade guidance for the Overview. */
function buildDoDont(
  direction: TeamDirection,
  targetPositions: string[],
  preferYouth: boolean,
): { doList: string[]; dontList: string[] } {
  const posLabel = targetPositions.length ? targetPositions.join("/") : "their weak spots";
  const doList: string[] = [];
  const dontList: string[] = [];

  if (direction === "Contender") {
    doList.push("Offer proven win-now starters");
    doList.push(`Target their need at ${posLabel}`);
    doList.push("Ask for their future picks in return");
    dontList.push("Lead with multi-year projects");
    dontList.push("Assume they'll punt the current season");
    dontList.push("Send low-upside depth pieces");
  } else if (direction === "Rebuild") {
    doList.push("Offer rookie / future picks");
    doList.push(`Lead with young upside at ${posLabel}`);
    doList.push("Frame deals around long-term value");
    dontList.push("Lead with aging veterans");
    dontList.push("Assume they're chasing short-term points");
    dontList.push("Send win-now-only assets");
  } else {
    doList.push(`Offer a clear upgrade at ${posLabel}`);
    doList.push(preferYouth ? "Lean on young upside" : "Lean on proven production");
    doList.push("Keep packages balanced and fair");
    dontList.push("Send lateral, no-upgrade pieces");
    dontList.push("Lowball an experienced manager");
    dontList.push("Overload one side with depth");
  }
  return { doList, dontList };
}

/** Polished "what kind of roster this is" statement for the Overview. */
function buildRosterIdentity(
  build: string,
  dynasty: PositionScore[],
  positionStrengthProfile: string,
  pickValue: Rating3,
): string {
  const buildShort = build.replace(/ build$/i, "");
  const strong = dynasty.filter((p) => p.tier === "Elite" || p.tier === "Strong").map((p) => p.position);
  const foundation =
    strong.length > 0
      ? ` with a strong ${strong.join("/")} foundation`
      : positionStrengthProfile && positionStrengthProfile !== "Balanced positional value"
      ? ` (${positionStrengthProfile})`
      : "";
  const pickTail =
    pickValue === "High" ? " and meaningful rookie pick capital"
    : pickValue === "Low" ? " but little draft capital"
    : "";
  return `${buildShort} build${foundation}${pickTail}.`;
}

// ── Trade playbook builders ──────────────────────────────────────────────────

function buildTradeDifficulty(
  tradeRating: ActivityRating,
  hasStrongRosters: boolean,
): { level: Rating3; reason: string } {
  let score = tradeRating === "Low" ? 2 : tradeRating === "Moderate" ? 1 : 0;
  if (hasStrongRosters) score += 1;
  const level: Rating3 = score >= 3 ? "High" : score >= 1 ? "Medium" : "Low";
  const reason =
    level === "High"
      ? "A strong, well-built roster paired with limited trade activity. Expect a tough negotiation."
      : level === "Medium"
      ? "Moderate trade activity suggests they're reachable, but their roster is solid, so they're unlikely to make desperation moves."
      : "Active in the market and reachable. A fair offer has a real chance.";
  return { level, reason };
}

function buildDealTypes(
  direction: TeamDirection,
  needs: string[],
): Array<{ dealType: string; fit: Rating3; why: string }> {
  if (direction === "Rebuild") {
    return [
      { dealType: "Picks for a veteran producer", fit: "High", why: "A rebuilder may sell short-term production for future value." },
      { dealType: "Young player + pick for an upgrade", fit: "High", why: "Fits their long-term value mindset." },
      { dealType: "2-for-1 consolidation", fit: "Medium", why: "Works if they land the best long-term asset." },
      { dealType: "Aging veteran for a young asset", fit: "Low", why: "The opposite of their likely preference." },
      ...(needs.length ? [{ dealType: `${needs[0]} help package`, fit: "Medium" as Rating3, why: `${needs[0]} is a relative need.` }] : []),
    ];
  }
  if (direction === "Contender") {
    return [
      { dealType: "Win-now starter for their picks", fit: "High", why: "A contender will pay future capital for present help." },
      { dealType: "Productive vet for a young project", fit: "High", why: "They value current production over upside." },
      { dealType: "2-for-1 consolidation", fit: "Medium", why: "Works if it upgrades their starting lineup." },
      { dealType: "Picks-only rebuild offer", fit: "Low", why: "They're not punting the season." },
    ];
  }
  return [
    { dealType: "Balanced player-for-player upgrade", fit: "High", why: "They're open to either side if it's a clear upgrade." },
    { dealType: "Pick + depth for a starter", fit: "Medium", why: "Fits an opportunistic dealer." },
    { dealType: "Lateral swap", fit: "Low", why: "No clear reason for them to move." },
  ];
}

function buildNegotiationNotes(direction: TeamDirection, needs: string[]): string[] {
  if (direction === "Rebuild") {
    return [
      "Start with future value, not veteran production.",
      "They likely care more about asset insulation than short-term points.",
      "Don't expect a quick discount on young QBs or premium rookies.",
      "Use rookie picks as the centerpiece, not a throw-in.",
      "If offering veterans, attach picks or younger upside so the deal fits their direction.",
    ];
  }
  if (direction === "Contender") {
    return [
      "Lead with win-now production they can start immediately.",
      "They'll pay future picks for present upgrades. Use that.",
      "Don't expect them to value multi-year projects.",
      "Packaging two pieces into one starter is more appealing than depth.",
    ];
  }
  return [
    "Frame every offer as a clear upgrade, not a lateral move.",
    "Feel out whether they lean now vs. future before committing.",
    needs.length ? `They could use help at ${needs.join("/")}. Lead there.` : "No urgent needs, so make the value obvious.",
  ];
}

function buildPlaybook(
  direction: TeamDirection,
  tradeRating: ActivityRating,
  profile: ManagerIntelPayload["tradeApproach"]["tradeProfile"],
  dealTypes: Array<{ dealType: string; fit: Rating3 }>,
): ManagerIntelPayload["tradeApproach"]["playbook"] {
  const likelyMotivation =
    direction === "Rebuild" ? "Rebuild / long-term value"
    : direction === "Contender" ? "Win now"
    : direction === "Middle" ? "Opportunistic value"
    : "Unclear direction";
  const negotiationStyle =
    tradeRating === "Aggressive" || tradeRating === "Very Active" ? "Active dealer, moves quickly"
    : tradeRating === "Active" ? "Engaged and open to offers"
    : tradeRating === "Moderate" ? "Patient, not reckless"
    : "Slow to engage";
  return {
    bestApproach: profile.bestOfferType,
    likelyStyle: profile.tradeStyle,
    bestDealType: dealTypes.find((d) => d.fit === "High")?.dealType ?? dealTypes[0]?.dealType ?? "Balanced package",
    likelyMotivation,
    negotiationStyle,
    avoid: profile.avoidOffering,
  };
}

function buildGroupedTargetsSell(
  direction: TeamDirection,
  preferYouth: boolean,
  needs: string[],
): {
  likelyTargetsGrouped: { high: string[]; conditional: string[] };
  sellCandidatesGrouped: { mostLikely: string[]; leastLikely: string[] };
} {
  const high: string[] = [];
  if (needs.length) high.push(`Help at ${needs.join("/")}`);
  if (preferYouth) {
    high.push("Young, high-upside players", "Rookie / future picks", "Value-insulated young WRs");
  } else {
    high.push("Proven, productive starters", "Win-now upgrades at any position");
  }
  const conditional = preferYouth
    ? ["Veteran producers, only if discounted", "Older players, only as add-ons"]
    : ["Speculative youth, only with a clear value edge"];

  const mostLikely = [
    "Aging veterans",
    "Extra depth pieces",
    direction === "Rebuild" ? "Win-now players off their timeline" : "Younger projects off their window",
  ];
  const leastLikely = [
    "Young QB / WR anchors",
    "Premium rookie picks",
    "Their highest-exposure players across leagues",
  ];
  return { likelyTargetsGrouped: { high, conditional }, sellCandidatesGrouped: { mostLikely, leastLikely } };
}

function buildTheirAssets(
  managerRoster: RawRosterPick[] | null,
  playersDb: Record<string, any>,
  youthPref: Rating3,
): {
  targetableAssets: ManagerIntelPayload["tradeApproach"]["targetableAssets"];
  protectedAssets: ManagerIntelPayload["tradeApproach"]["protectedAssets"];
} {
  if (!managerRoster) return { targetableAssets: [], protectedAssets: [] };
  const nameOf = (pid: string) => {
    const p = playersDb[pid];
    return p?.full_name || (p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : pid);
  };
  const named = managerRoster.map((p) => ({ ...p, name: nameOf(p.playerId) }));
  const diff = (v: number): Rating3 => (v >= 4000 ? "High" : v >= 2000 ? "Medium" : "Low");

  const targetableAssets = named
    .filter((p) => p.age != null && p.age >= 28 && p.dynasty > 0)
    .sort((a, b) => b.dynasty - a.dynasty)
    .slice(0, 5)
    .map((p) => ({
      name: p.name,
      pos: p.pos,
      age: p.age,
      value: Math.round(p.dynasty),
      reason: youthPref === "High" ? "Doesn't fit their youth-heavy build" : "Veteran they may cycle out",
      difficulty: diff(p.dynasty),
    }));

  const protectedAssets = named
    .filter((p) => p.age != null && p.age <= 24 && p.dynasty > 0)
    .sort((a, b) => b.dynasty - a.dynasty)
    .slice(0, 5)
    .map((p) => ({ name: p.name, pos: p.pos, value: Math.round(p.dynasty), reason: `Young cornerstone ${p.pos}` }));

  return { targetableAssets, protectedAssets };
}

function activitySignalOf(
  tradesPerLeague: number,
  waiversPerLeague: number,
): { signal: ManagerIntelPayload["activity"]["activitySignal"]; note: string } {
  if (tradesPerLeague < 0.5 && waiversPerLeague < 1.5)
    return {
      signal: "Ghost",
      note: "Very little visible roster movement. They may be hard to reach. Expect a slow response to offers.",
    };
  const total = tradesPerLeague + waiversPerLeague;
  if (total < 4)
    return {
      signal: "Quiet",
      note: "Light transaction volume. Engaged occasionally, so a compelling offer is more likely to land than a routine one.",
    };
  if (total < 10)
    return {
      signal: "Moderate",
      note: "Steady, moderate transaction activity. Engaged enough to trade and work waivers, but not so active they're likely to make reckless moves.",
    };
  return {
    signal: "Active",
    note: "High transaction activity. Frequently tinkering. Very reachable and quick to engage on deals.",
  };
}

/** Branded activity persona from per-league trade/waiver rates. */
function buildActivityArchetype(
  tradesPerLeague: number,
  waiversPerLeague: number,
  visibleLeagues: number,
): { key: string; label: string; blurb: string } {
  if (visibleLeagues === 0 || tradesPerLeague + waiversPerLeague < 0.5) {
    return { key: "dormant", label: "Dormant / Low Signal", blurb: "Little visible activity, or not enough data to read them." };
  }
  if (tradesPerLeague < 0.5 && waiversPerLeague < 1.5) {
    return { key: "passive", label: "Passive Manager", blurb: "Low transaction activity. May be harder to engage." };
  }
  if (tradesPerLeague + waiversPerLeague >= 18) {
    return { key: "churner", label: "High-Volume Churner", blurb: "Constantly adjusting: heavy waivers and frequent trades." };
  }
  if (tradesPerLeague >= 3 && tradesPerLeague >= waiversPerLeague * 0.8) {
    return { key: "trade-shark", label: "Trade Shark", blurb: "Trade volume outpaces waivers. Likely open to negotiation." };
  }
  if (waiversPerLeague >= 10 && waiversPerLeague > tradesPerLeague * 2) {
    return { key: "waiver-grinder", label: "Waiver Grinder", blurb: "Works the wire harder than the trade market." };
  }
  return { key: "steady", label: "Steady Manager", blurb: "Moderate trades and waivers. Engaged, but not constantly churning." };
}

/** Tradeability (responsiveness) from trade-activity rating. High = reachable. */
function buildTradeability(tradeRating: ActivityRating): { level: Rating3; note: string } {
  if (tradeRating === "Aggressive" || tradeRating === "Very Active" || tradeRating === "Active") {
    return { level: "High", note: "Active in the trade market. They engage readily on fair offers." };
  }
  if (tradeRating === "Moderate") {
    return {
      level: "Medium",
      note: "Reachable, but not reckless. Send clean, value-aligned offers rather than fishing for quick wins.",
    };
  }
  return { level: "Low", note: "Rarely trades. It may take a standout offer to get their attention." };
}

/**
 * Build the recent-activity timeline from timestamped manager transactions
 * across all visible leagues. `txns` carry epoch-ms timestamps + league name.
 */
function buildTimeline(
  txns: Array<{ ts: number; type: "trade" | "waiver"; league: string }>,
): {
  lastActivity: string | null;
  last30Days: number;
  last90Days: number;
  activityTrend: "Increasing" | "Stable" | "Declining" | "Unknown";
  recent: Array<{ date: string; league: string; type: string }>;
} {
  const dated = txns.filter((t) => t.ts > 0).sort((a, b) => b.ts - a.ts);
  if (dated.length === 0) {
    return { lastActivity: null, last30Days: 0, last90Days: 0, activityTrend: "Unknown", recent: [] };
  }
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const last30Days = dated.filter((t) => now - t.ts <= 30 * DAY).length;
  const last90Days = dated.filter((t) => now - t.ts <= 90 * DAY).length;

  // Trend: trailing-30 rate vs the prior 60-day window (per-30-day rate).
  const prior = dated.filter((t) => now - t.ts > 30 * DAY && now - t.ts <= 90 * DAY).length / 2;
  let activityTrend: "Increasing" | "Stable" | "Declining" | "Unknown";
  if (last90Days < 3) activityTrend = "Unknown";
  else if (last30Days > prior * 1.3) activityTrend = "Increasing";
  else if (last30Days < prior * 0.7) activityTrend = "Declining";
  else activityTrend = "Stable";

  const recent = dated.slice(0, 8).map((t) => ({
    date: new Date(t.ts).toISOString(),
    league: t.league,
    type: t.type === "trade" ? "Trade completed" : "Waiver / FA add",
  }));

  return { lastActivity: new Date(dated[0].ts).toISOString(), last30Days, last90Days, activityTrend, recent };
}

// ── Per-league scouting report ───────────────────────────────────────────────

function buildTeamIdentityFromRanks(
  ranks: LeagueRosterRank,
  total: number,
  dynasty: PositionScore[],
): { label: string; blurb: string } {
  const top3 = (r: number) => r > 0 && r <= 3;
  const bottomHalf = (r: number) => r > total / 2;
  const { dynastyRank: dyn, winNowRank: win, youthRank: youth, pickRank: pick } = ranks;

  let label: string;
  if (top3(dyn) && top3(win) && top3(youth)) label = "Elite Young Contender";
  else if (top3(dyn) && top3(youth) && bottomHalf(win)) label = "Premium Rebuild";
  else if (top3(win) && bottomHalf(youth)) label = "Aging Contender";
  else if (top3(dyn) && top3(win)) label = "Loaded Contender";
  else if (top3(youth) && pick != null && top3(pick)) label = "Young Rebuild";
  else if (top3(dyn)) label = "Future Powerhouse";
  else if (top3(win)) label = "Win-Now Roster";
  else if (bottomHalf(dyn) && bottomHalf(win)) label = "Bottom-Tier Roster";
  else label = "Balanced Middle-Roster";

  // Blurb is the positional-strength line only. The rank recap + trade-angle
  // narrative lives in the league context summary, so don't repeat ranks here.
  const strong = dynasty.filter((p) => p.tier === "Elite" || p.tier === "Strong").map((p) => p.position);
  const weak = dynasty.filter((p) => p.tier === "Weak" || p.tier === "Thin").map((p) => p.position);
  let blurb = "";
  if (strong.length) blurb = `Strongest at ${strong.join(", ")}${weak.length ? `, softest at ${weak.join(", ")}` : ""}.`;
  else if (weak.length) blurb = `Softest at ${weak.join(", ")}.`;
  return { label, blurb };
}

function buildLeagueContextSummary(ranks: LeagueRosterRank, total: number): string {
  const top3 = (r: number) => r > 0 && r <= 3;
  const topHalf = (r: number) => r > 0 && r <= total / 2;
  const { dynastyRank: dyn, winNowRank: win, youthRank: youth, pickRank: pick } = ranks;
  const strongNow = top3(win);
  const strongFuture = top3(dyn);
  let lead: string;
  if (strongNow && strongFuture) lead = "One of the strongest teams in this league by both present and future value";
  else if (strongFuture) lead = "One of the strongest long-term rosters in this league";
  else if (strongNow) lead = "One of the strongest win-now rosters in this league";
  else if (topHalf(dyn)) lead = "An above-average roster in this league";
  else lead = "A middle-to-lower roster in this league";
  const ranksClause =
    pick != null
      ? `They rank #${dyn} in dynasty value, #${win} in win-now value, #${youth} in roster youth, and #${pick} in pick capital.`
      : `They rank #${dyn} in dynasty value, #${win} in win-now value, and #${youth} in roster youth.`;
  const tail =
    strongNow && strongFuture
      ? "That makes them a difficult trade target unless you offer premium long-term assets."
      : strongFuture && !strongNow
      ? "They're positioned for the future, so win-now help may pry value loose."
      : strongNow && !strongFuture
      ? "They're built to win now and may part with youth or picks for immediate upgrades."
      : "There may be room to buy low or target a clear need.";
  return `${lead}. ${ranksClause} ${tail}`;
}

function buildNeedsTable(dynasty: PositionScore[], winNow: PositionScore[]): NeedRow[] {
  const positions: Array<"QB" | "RB" | "WR" | "TE"> = ["QB", "RB", "WR", "TE"];
  return positions.map((pos) => {
    const d = dynasty.find((p) => p.position === pos);
    const w = winNow.find((p) => p.position === pos);
    const dWeak = d ? d.tier === "Weak" || d.tier === "Thin" : false;
    const wWeak = w ? w.tier === "Weak" || w.tier === "Thin" : false;
    let level: NeedRow["level"] = "Low";
    if (dWeak && wWeak) level = "High";
    else if (dWeak || wWeak) level = "Medium";
    const nuance =
      dWeak && wWeak ? ": weak both ways"
      : !dWeak && wWeak ? ": strong long-term, thin win-now"
      : dWeak && !wWeak ? ": thin long-term"
      : "";
    return {
      position: pos,
      level,
      reason: `#${d?.leagueRank ?? "—"} dynasty, #${w?.leagueRank ?? "—"} win-now${nuance}`,
    };
  });
}

function buildTradeOpportunity(dynasty: PositionScore[], winNow: PositionScore[]): string {
  // Prefer the nuanced "strong long-term but thin win-now" angle.
  const split = (["QB", "RB", "WR", "TE"] as const)
    .map((pos) => ({ pos, d: dynasty.find((p) => p.position === pos), w: winNow.find((p) => p.position === pos) }))
    .find((x) => x.d && x.w && x.d.tier !== "Weak" && x.d.tier !== "Thin" && (x.w.tier === "Weak" || x.w.tier === "Thin"));
  if (split) {
    return `Their ${split.pos} group is thin for win-now production despite holding up long-term. A productive veteran ${split.pos} could be a useful add-on in trade talks.`;
  }
  const sortedWeak = [...dynasty].sort((a, b) => a.vsLeagueAvg - b.vsLeagueAvg);
  const weakest = sortedWeak[0];
  if (weakest && (weakest.tier === "Weak" || weakest.tier === "Thin")) {
    return `${weakest.position} is their weakest relative dynasty group, but they're strong enough overall that they may not feel desperate. Lead with consolidation or future value rather than just "filling a hole".`;
  }
  if (weakest) {
    return `No glaring holes. ${weakest.position} is their softest group vs league average. The best angle is a clear upgrade or consolidating two pieces into one they covet.`;
  }
  return "Roster data is too thin to surface a specific trade angle in this league.";
}

function buildLeagueReport(scan: LeagueScan, targetUserId: string, requestedLeagueId: string): LeagueReport | null {
  const idx = scan.rosterMeta.findIndex((m) => m.ownerId === targetUserId);
  if (idx < 0) return null; // target isn't rostered here — skip

  const dynTotals = scan.allRosters.map((r) => r.reduce((s, p) => s + p.dynasty, 0));
  const redTotals = scan.allRosters.map((r) => r.reduce((s, p) => s + p.redraft, 0));
  const ageAvgs = scan.allRosters.map((r) => {
    const as = r.map((p) => p.age).filter((a): a is number => a != null);
    return as.length ? as.reduce((a, b) => a + b, 0) / as.length : 99;
  });
  const posTotals = (pos: "QB" | "RB" | "WR" | "TE", field: "dynasty" | "redraft" = "dynasty") =>
    scan.allRosters.map((r) => r.filter((p) => p.pos === pos).reduce((s, p) => s + p[field], 0));
  const qb = posTotals("QB");
  const rb = posTotals("RB");
  const wr = posTotals("WR");
  const te = posTotals("TE");
  const qbW = posTotals("QB", "redraft");
  const rbW = posTotals("RB", "redraft");
  const wrW = posTotals("WR", "redraft");
  const teW = posTotals("TE", "redraft");
  const pickScores = scan.rosterMeta.map((m) => scan.pickScoreByRoster[m.rosterId] ?? 0);
  const anyPicks = pickScores.some((v) => v > 0);

  // Roster Strength Profile values. We have no set-lineup data server-side, so
  // "starters" are approximated as each roster's top-`startersCount` players by
  // redraft value (a win-now contributors proxy); the rest are bench depth.
  const startN = scan.startersCount && scan.startersCount > 0 ? scan.startersCount : 9;
  const contenderVals = scan.allRosters.map((r) =>
    [...r].sort((a, b) => b.redraft - a.redraft).slice(0, startN).reduce((s, p) => s + p.redraft, 0),
  );
  const benchVals = scan.allRosters.map((r) =>
    [...r].sort((a, b) => b.redraft - a.redraft).slice(startN).reduce((s, p) => s + p.dynasty, 0),
  );

  const rosters: LeagueRosterRank[] = scan.rosterMeta.map((m, i) => {
    const pickCapitalValue = scan.pickValueByRoster[m.rosterId] ?? 0;
    return {
      ownerId: m.ownerId,
      rosterId: m.rosterId,
      dynastyRank: rankOf(dynTotals, dynTotals[i]) ?? 0,
      winNowRank: rankOf(redTotals, redTotals[i]) ?? 0,
      youthRank: rankOf(ageAvgs, ageAvgs[i], true) ?? 0,
      pickRank: anyPicks ? rankOf(pickScores, pickScores[i]) : null,
      qbRank: rankOf(qb, qb[i]) ?? 0,
      rbRank: rankOf(rb, rb[i]) ?? 0,
      wrRank: rankOf(wr, wr[i]) ?? 0,
      teRank: rankOf(te, te[i]) ?? 0,
      qbWinNowRank: rankOf(qbW, qbW[i]) ?? 0,
      rbWinNowRank: rankOf(rbW, rbW[i]) ?? 0,
      wrWinNowRank: rankOf(wrW, wrW[i]) ?? 0,
      teWinNowRank: rankOf(teW, teW[i]) ?? 0,
      contenderValue: Math.round(contenderVals[i]),
      benchValue: Math.round(benchVals[i]),
      dynastyTotalValue: Math.round(dynTotals[i] + pickCapitalValue),
      pickCapitalValue: Math.round(pickCapitalValue),
    };
  });

  const targetRanks = rosters[idx];
  const managerRoster = scan.allRosters[idx];
  const dynasty = summarizeStrengths(managerRoster, scan.allRosters, "dynasty");
  const winNow = summarizeStrengths(managerRoster, scan.allRosters, "redraft");
  const needsArr = deriveTeamNeeds(dynasty);
  const ages = managerRoster.map((p) => p.age).filter((a): a is number => a != null);
  const teamAvgAge = ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : 0;
  const direction = deriveTeamDirection(dynasty, winNow, teamAvgAge);
  const youngCount = ages.filter((a) => a <= 24).length;
  const vetCount = ages.filter((a) => a >= 29).length;
  const ageSummary =
    ages.length === 0
      ? "Roster age data not available."
      : `Avg age ${teamAvgAge}. ${youngCount} young (≤24), ${vetCount} vet (≥29).`;

  const total = scan.totalRosters || scan.allRosters.length;
  const rankSnapshot: RankSnapshotRow[] = [
    { label: "Dynasty value", rank: targetRanks.dynastyRank, total },
    { label: "Win-now value", rank: targetRanks.winNowRank, total },
    { label: "Roster youth", rank: targetRanks.youthRank, total },
    ...(targetRanks.pickRank != null ? [{ label: "Pick capital", rank: targetRanks.pickRank, total }] : []),
  ];

  return {
    leagueId: scan.leagueId,
    name: scan.name,
    season: scan.season,
    format: scan.format,
    scoringFormat: scan.scoringFormat,
    totalRosters: total,
    startersCount: scan.startersCount,
    isRequested: scan.leagueId === requestedLeagueId,
    ownerId: targetUserId,
    rosterId: scan.managerRosterId ?? 0,
    teamName: scan.teamName,
    teamDirection: direction,
    teamIdentity: buildTeamIdentityFromRanks(targetRanks, total, dynasty),
    contextSummary: buildLeagueContextSummary(targetRanks, total),
    dynastyStrengths: dynasty,
    winNowStrengths: winNow,
    pickValue: Math.round(scan.pickValueByRoster[scan.rosterMeta[idx].rosterId] ?? 0),
    needs: buildNeedsTable(dynasty, winNow),
    rankSnapshot,
    relativeWeakness: buildRelativeWeakness(dynasty, needsArr),
    tradeOpportunity: buildTradeOpportunity(dynasty, winNow),
    pickCapitalSummary: summarisePickCapital(scan.picks),
    ageSummary,
    rosters,
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

// ── Career history (multi-season) ────────────────────────────────────────────
//
// Walks each visible league's previous_league_id chain to assemble the
// manager's all-time record across seasons. Sleeper exposes one league object
// per (league, season); the chain links a dynasty league back through its prior
// seasons. Records (W/L/T, points-for) come from each season's roster settings;
// playoff/championship results are best-effort from the winners bracket and are
// only counted for seasons that expose one.

interface CareerLeagueRaw {
  league_id: string;
  name: string;
  season: string;
  status?: string;
  /** The league-season's primary draft (startup in the oldest season, the
   *  rookie draft in later seasons). Used by the draft-tendencies profile. */
  draft_id?: string | null;
  settings?: { previous_league_id?: string | null };
}

// A winners-bracket match. t1/t2 are either a roster_id (resolved) or a
// reference object ({ w | l: matchId }) before the feeding match completes.
interface BracketMatch {
  r?: number;
  m?: number;
  t1?: number | { w?: number; l?: number } | null;
  t2?: number | { w?: number; l?: number } | null;
  w?: number | null;
  l?: number | null;
  p?: number;
}

/** Roster IDs that appear as concrete entrants anywhere in the bracket = made playoffs. */
function bracketRosterIds(bracket: BracketMatch[]): Set<number> {
  const ids = new Set<number>();
  for (const m of bracket) {
    if (typeof m.t1 === "number") ids.add(m.t1);
    if (typeof m.t2 === "number") ids.add(m.t2);
  }
  return ids;
}

/** Champion roster_id: the winner of the placement-1 final, or the deepest-round
 *  decided match as a fallback. Null when the bracket has no decided winner. */
function championRosterId(bracket: BracketMatch[]): number | null {
  const final = bracket.find((m) => m.p === 1 && typeof m.w === "number");
  if (final && typeof final.w === "number") return final.w;
  let best: BracketMatch | null = null;
  for (const m of bracket) {
    if (typeof m.w !== "number") continue;
    if (!best || (m.r ?? 0) > (best.r ?? 0)) best = m;
  }
  return best && typeof best.w === "number" ? best.w : null;
}

/**
 * Phase 1 of the multi-season walk: discover every league-season by following
 * each visible league's previous_league_id chain backward. Chains run
 * concurrently; each chain is sequential (a step needs the prior league's
 * previous_league_id). Dedup by league_id so shared ancestors aren't fetched
 * twice, and stop globally at the league-season cap. Shared by career history
 * and the draft-tendencies profile so the league fetches happen only once.
 */
async function discoverCareerLeagues(
  currentLeagues: SleeperLeagueSummary[],
): Promise<{ discovered: CareerLeagueRaw[]; truncated: boolean }> {
  const seen = new Set<string>();
  let truncated = false;
  const discovered: CareerLeagueRaw[] = [];

  await mapBounded(currentLeagues, FETCH_CONCURRENCY, async (lg) => {
    let cursor: string | null = lg.leagueId;
    let depth = 0;
    while (cursor && depth < MAX_CAREER_DEPTH) {
      if (seen.has(cursor)) break; // already walked (shared ancestor)
      if (discovered.length >= MAX_CAREER_LEAGUE_SEASONS) {
        truncated = true;
        break;
      }
      seen.add(cursor);
      const raw = await fetchJson<CareerLeagueRaw>(`${SLEEPER_API}/league/${cursor}`);
      if (!raw) break;
      discovered.push(raw);
      cursor = raw.settings?.previous_league_id || null;
      depth++;
    }
  });

  return { discovered, truncated };
}

async function buildCareerHistory(
  discovered: CareerLeagueRaw[],
  truncated: boolean,
  userId: string,
): Promise<CareerHistory> {
  const empty: CareerHistory = {
    available: false,
    seasonsActive: 0,
    firstSeason: null,
    latestSeason: null,
    leagueSeasonsPlayed: 0,
    record: null,
    winPct: null,
    avgPointsForPerSeason: null,
    championships: null,
    playoffAppearances: null,
    finishes: null,
    seasons: [],
    truncated: false,
    note: "No prior-season league history was found for this manager.",
  };

  if (discovered.length === 0) return empty;

  // Phase 2 — resolve the manager's record (and playoff/title result) for each
  // discovered league-season. Skip seasons where the manager wasn't rostered.
  const rows = (
    await mapBounded(discovered, FETCH_CONCURRENCY, async (lg) => {
      const rosters = await fetchJson<SleeperRosterRaw[]>(
        `${SLEEPER_API}/league/${lg.league_id}/rosters`,
      );
      if (!rosters) return null;
      const mine = rosters.find(
        (r) => r.owner_id === userId || (r.co_owners?.includes(userId) ?? false),
      );
      if (!mine) return null;

      const s = mine.settings ?? {};
      const pointsFor = (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100;

      // Winners bracket is optional — present for completed seasons. Treat any
      // failure or absence as "no playoff data for this season" (null), not a
      // negative result.
      let madePlayoffs: boolean | null = null;
      let champion: boolean | null = null;
      const bracket = await fetchJson<BracketMatch[]>(
        `${SLEEPER_API}/league/${lg.league_id}/winners_bracket`,
      );
      if (Array.isArray(bracket) && bracket.length > 0) {
        madePlayoffs = bracketRosterIds(bracket).has(mine.roster_id);
        champion = championRosterId(bracket) === mine.roster_id;
      }

      // Finish bucket from the final regular-season standings (Sleeper tiebreak:
      // wins, then points-for). Only completed seasons count — an in-progress
      // season isn't a finish yet.
      let finishQuartile: number | null = null;
      if (lg.status === "complete" && rosters.length > 0) {
        const fptsOf = (st?: SleeperRosterRaw["settings"]) =>
          (st?.fpts ?? 0) + (st?.fpts_decimal ?? 0) / 100;
        const ranked = [...rosters].sort((a, b) => {
          const aw = a.settings?.wins ?? 0;
          const bw = b.settings?.wins ?? 0;
          if (bw !== aw) return bw - aw;
          return fptsOf(b.settings) - fptsOf(a.settings);
        });
        const rank = ranked.findIndex((r) => r.roster_id === mine.roster_id) + 1;
        if (rank > 0) {
          finishQuartile = Math.min(4, Math.max(1, Math.ceil((rank / rosters.length) * 4)));
        }
      }

      return {
        season: lg.season,
        leagueName: lg.name,
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        ties: s.ties ?? 0,
        pointsFor: Math.round(pointsFor * 10) / 10,
        madePlayoffs,
        champion,
        finishQuartile,
      } satisfies CareerSeasonRow;
    })
  ).filter((r): r is CareerSeasonRow => r !== null);

  if (rows.length === 0) return empty;

  rows.sort((a, b) => b.season.localeCompare(a.season));

  const seasonsSet = new Set(rows.map((r) => r.season));
  const sortedSeasons = [...seasonsSet].sort();
  const wins = rows.reduce((n, r) => n + r.wins, 0);
  const losses = rows.reduce((n, r) => n + r.losses, 0);
  const ties = rows.reduce((n, r) => n + r.ties, 0);
  const games = wins + losses + ties;
  const totalPf = rows.reduce((n, r) => n + r.pointsFor, 0);

  // Playoff/title counts only include seasons that actually exposed a bracket,
  // so an in-progress current season doesn't drag the totals down.
  const bracketRows = rows.filter((r) => r.madePlayoffs !== null);

  // Finish distribution across completed seasons only.
  const finishRows = rows.filter((r) => r.finishQuartile != null);
  const finishes: CareerFinishes | null =
    finishRows.length > 0
      ? {
          top25: finishRows.filter((r) => r.finishQuartile === 1).length,
          upperMid: finishRows.filter((r) => r.finishQuartile === 2).length,
          lowerMid: finishRows.filter((r) => r.finishQuartile === 3).length,
          bottom25: finishRows.filter((r) => r.finishQuartile === 4).length,
          total: finishRows.length,
        }
      : null;

  return {
    available: true,
    seasonsActive: seasonsSet.size,
    firstSeason: sortedSeasons[0] ?? null,
    latestSeason: sortedSeasons[sortedSeasons.length - 1] ?? null,
    leagueSeasonsPlayed: rows.length,
    record: { wins, losses, ties },
    winPct: games > 0 ? Math.round(((wins + ties * 0.5) / games) * 1000) / 10 : null,
    avgPointsForPerSeason: rows.length > 0 ? Math.round((totalPf / rows.length) * 10) / 10 : null,
    championships: bracketRows.length > 0 ? bracketRows.filter((r) => r.champion).length : null,
    playoffAppearances: bracketRows.length > 0 ? bracketRows.filter((r) => r.madePlayoffs).length : null,
    finishes,
    seasons: rows,
    truncated,
    note:
      "Aggregated from visible Sleeper leagues via prior-season links. Playoff and " +
      "championship results are read from completed-season brackets; seasons without " +
      "bracket data are excluded from those two counts. Finishes are bucketed by " +
      "final regular-season standing across completed seasons.",
  };
}

// ── Draft tendencies + positional bias ───────────────────────────────────────

type CorePos = "QB" | "RB" | "WR" | "TE";
const CORE_POSITIONS: CorePos[] = ["QB", "RB", "WR", "TE"];
// Round the heatmap covers. Rookie drafts rarely exceed ~6 rounds; startup
// drafts run deeper. 12 captures the meaningful early/mid signal without a long
// sparse tail.
const MAX_DRAFT_ROUND = 12;
// Startup vs. rookie draft separation. Startup drafts fill entire rosters and run
// deep (commonly 15-25+ rounds); annual rookie drafts add a few prospects and
// rarely exceed ~6 rounds. We analyze startup drafts only — rookie drafts are
// rookie-RB/WR heavy and skew the positional mix vs. roster-building drafts. The
// draft's planned `settings.rounds` is the primary signal (from the per-user
// drafts endpoint); the pick-derived round count is a backstop inside the loop.
const STARTUP_MIN_ROUNDS = 10;
// Seasons of startup drafts to include: the current season plus this many prior
// seasons. 1 → current + last season (e.g. 2026 + 2025).
const DRAFT_PROFILE_PRIOR_SEASONS = 1;

interface DraftPickRaw {
  round: number;
  roster_id: number | null;
  player_id: string | null;
  /** The Sleeper user_id who made the pick. */
  picked_by: string;
  metadata?: { position?: string };
}

/** A draft as returned by the per-user drafts endpoint
 *  (/user/{id}/drafts/nfl/{season}). `settings.rounds` is the planned length —
 *  used to separate deep startup drafts from short rookie drafts. `league_id` is
 *  null for mock drafts, which we skip. */
interface UserDraftRaw {
  draft_id: string;
  league_id: string | null;
  status?: string;
  settings?: { rounds?: number };
}

type SleeperPlayersDb = Awaited<ReturnType<typeof getSleeperPlayers>>;

/** Core position of a pick, preferring the players DB and falling back to the
 *  pick metadata. Returns null for non-core (K/DEF) or unresolved picks. */
function draftPickPosition(pick: DraftPickRaw, playersDb: SleeperPlayersDb): CorePos | null {
  const p = pick.player_id ? playersDb[pick.player_id] : null;
  const pos = (p?.fantasy_positions?.[0] || p?.position || pick.metadata?.position) as string | undefined;
  return pos && (CORE_POSITIONS as string[]).includes(pos) ? (pos as CorePos) : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const zeroCounts = (): Record<CorePos, number> => ({ QB: 0, RB: 0, WR: 0, TE: 0 });

function emptyDraftProfile(note: string): DraftProfile {
  return {
    available: false,
    draftsAnalyzed: 0,
    totalPicksAnalyzed: 0,
    truncated: false,
    heatmap: [],
    positionalBias: [],
    tendencyAnalysis: "",
    biasAnalysis: "",
    note,
  };
}

/**
 * Resolve the manager's dynasty STARTUP draft IDs across the current and prior
 * season(s). We list every draft the user took part in per season
 * (/user/{id}/drafts/nfl/{season}) and keep only those that (a) belong to one of
 * their dynasty leagues that season and (b) ran deep enough to be a startup
 * rather than a rookie draft (>= STARTUP_MIN_ROUNDS planned rounds).
 *
 * This deliberately does NOT rely on league.draft_id (which points to a league's
 * latest draft — the rookie draft for any continuing league) or the
 * previous_league_id chain (which breaks whenever a commissioner spins up a fresh
 * league each year instead of renewing), so fresh startups are no longer missed.
 */
async function collectStartupDraftIds(userId: string, season: string): Promise<string[]> {
  const seasons: string[] = [];
  const base = Number(season);
  for (let i = 0; i <= DRAFT_PROFILE_PRIOR_SEASONS; i++) {
    seasons.push(Number.isFinite(base) ? String(base - i) : season);
  }

  const ids = new Set<string>();
  await mapBounded(seasons, FETCH_CONCURRENCY, async (s) => {
    const [leagues, drafts] = await Promise.all([
      fetchSleeperLeagues(userId, s), // dynasty-only (settings.type === 2)
      fetchJson<UserDraftRaw[]>(`${SLEEPER_API}/user/${userId}/drafts/nfl/${s}`),
    ]);
    const dynastyLeagueIds = new Set(leagues.map((l) => l.leagueId));
    for (const d of drafts ?? []) {
      if (!d.draft_id) continue;
      // Dynasty leagues only; mock drafts (null league_id) are excluded here too.
      if (!d.league_id || !dynastyLeagueIds.has(d.league_id)) continue;
      if ((d.settings?.rounds ?? 0) < STARTUP_MIN_ROUNDS) continue; // skip rookie drafts
      ids.add(d.draft_id);
    }
  });
  return Array.from(ids);
}

/**
 * Build the manager's draft profile from their dynasty STARTUP drafts. The
 * draft IDs are resolved up front by collectStartupDraftIds() across the current
 * and prior season, so annual rookie drafts are already filtered out (they're
 * short and rookie-RB/WR heavy, and would skew the positional mix vs. roster-
 * building startup drafts — see STARTUP_MIN_ROUNDS). A length backstop below
 * re-checks each fetched draft in case a draft's planned rounds disagreed with
 * its actual picks.
 *
 * Two distributions come from the SAME pick arrays — no extra API calls beyond
 * one /picks fetch per draft:
 *   • the manager's own picks (picked_by === userId) → tendencies + their share
 *   • every drafter's picks (incl. the manager) → the real league baseline
 * Comparing the two gives a meaningful "over/under-drafts position X vs the
 * leagues they actually play in" read instead of a hardcoded flat baseline.
 */
async function buildDraftProfile(
  draftIds: string[],
  userId: string,
  playersDb: SleeperPlayersDb,
): Promise<DraftProfile> {
  if (draftIds.length === 0) {
    return emptyDraftProfile(
      "No startup drafts were found for this manager in the current or prior season.",
    );
  }

  const truncated = draftIds.length > MAX_DRAFTS_ANALYZED;
  const toScan = draftIds.slice(0, MAX_DRAFTS_ANALYZED);

  const pickLists = await mapBounded(toScan, FETCH_CONCURRENCY, (did) =>
    fetchJson<DraftPickRaw[]>(`${SLEEPER_API}/draft/${did}/picks`),
  );

  const userByRound = new Map<number, Record<CorePos, number>>();
  const userByPos = zeroCounts();
  const leagueByPos = zeroCounts();
  let userTotal = 0;
  let leagueTotal = 0;
  let draftsAnalyzed = 0;
  let rookieDraftsSkipped = 0;

  for (const picks of pickLists) {
    if (!Array.isArray(picks) || picks.length === 0) continue;
    // Skip rookie drafts: a draft that doesn't run deep enough to be a startup
    // is the annual rookie draft, which we exclude (see STARTUP_MIN_ROUNDS).
    const draftRounds = picks.reduce((m, p) => (p.round > m ? p.round : m), 0);
    if (draftRounds < STARTUP_MIN_ROUNDS) {
      rookieDraftsSkipped++;
      continue;
    }
    draftsAnalyzed++;
    for (const pick of picks) {
      const pos = draftPickPosition(pick, playersDb);
      if (!pos) continue;
      // Baseline pools every drafter's picks, including the manager's.
      leagueByPos[pos]++;
      leagueTotal++;
      if (pick.picked_by && pick.picked_by === userId) {
        userByPos[pos]++;
        userTotal++;
        const r = pick.round;
        if (r >= 1 && r <= MAX_DRAFT_ROUND) {
          const row = userByRound.get(r) ?? zeroCounts();
          row[pos]++;
          userByRound.set(r, row);
        }
      }
    }
  }

  if (draftsAnalyzed === 0) {
    return emptyDraftProfile(
      "No startup drafts were found in this manager's visible dynasty leagues.",
    );
  }
  if (userTotal === 0) {
    return emptyDraftProfile("No attributable startup draft picks were found for this manager.");
  }

  // Heatmap rows 1..maxRound (only rounds the manager actually drafted in).
  const maxRound = Math.max(0, ...Array.from(userByRound.keys()));
  const heatmap: DraftHeatmapRow[] = [];
  for (let r = 1; r <= maxRound; r++) {
    const row = userByRound.get(r) ?? zeroCounts();
    const tot = row.QB + row.RB + row.WR + row.TE;
    heatmap.push({
      round: r,
      QB: tot ? Math.round((row.QB / tot) * 100) : 0,
      RB: tot ? Math.round((row.RB / tot) * 100) : 0,
      WR: tot ? Math.round((row.WR / tot) * 100) : 0,
      TE: tot ? Math.round((row.TE / tot) * 100) : 0,
    });
  }

  const positionalBias: DraftBiasRow[] = CORE_POSITIONS.map((position) => {
    const userPct = (userByPos[position] / userTotal) * 100;
    const leagueAvgPct = leagueTotal ? (leagueByPos[position] / leagueTotal) * 100 : 0;
    return {
      position,
      userPct: round1(userPct),
      leagueAvgPct: round1(leagueAvgPct),
      difference: round1(userPct - leagueAvgPct),
    };
  });

  return {
    available: true,
    draftsAnalyzed,
    totalPicksAnalyzed: userTotal,
    truncated,
    heatmap,
    positionalBias,
    tendencyAnalysis: generateDraftTendencyAnalysis(userByRound, userByPos, userTotal),
    biasAnalysis: generatePositionalBiasAnalysis(positionalBias),
    note:
      `Aggregated from ${draftsAnalyzed} dynasty startup draft${draftsAnalyzed === 1 ? "" : "s"} ` +
      "across the manager's current and prior season. Annual rookie drafts are " +
      "excluded. The league average pools every drafter's picks from those same drafts.",
  };
}

/** Sum the manager's core picks across a contiguous round range (inclusive). */
function sumRounds(
  byRound: Map<number, Record<CorePos, number>>,
  from: number,
  to: number,
): Record<CorePos, number> {
  const out = zeroCounts();
  for (let r = from; r <= to; r++) {
    const row = byRound.get(r);
    if (!row) continue;
    for (const pos of CORE_POSITIONS) out[pos] += row[pos];
  }
  return out;
}

/** Rule-based sentence describing early-round leanings and QB/TE timing. */
function generateDraftTendencyAnalysis(
  byRound: Map<number, Record<CorePos, number>>,
  byPos: Record<CorePos, number>,
  total: number,
): string {
  const fragments: string[] = [];

  // Early rounds (1–3): which skill position leads.
  const early = sumRounds(byRound, 1, 3);
  const earlyTotal = early.QB + early.RB + early.WR + early.TE;
  if (earlyTotal > 0) {
    const rbShare = early.RB / earlyTotal;
    const wrShare = early.WR / earlyTotal;
    if (rbShare >= 0.4 && rbShare > wrShare) fragments.push("opens RB-heavy");
    else if (wrShare >= 0.4 && wrShare > rbShare) fragments.push("opens WR-heavy");
    else fragments.push("opens with a balanced RB/WR mix");
  }

  // QB timing — earliest round where QB is a meaningful share of picks.
  const firstQbRound = earliestPositionRound(byRound, "QB", 0.3);
  if (firstQbRound != null) {
    if (firstQbRound >= 5) fragments.push("waits on QB");
    else if (firstQbRound <= 2) fragments.push("targets QB early");
  }

  // TE timing.
  const firstTeRound = earliestPositionRound(byRound, "TE", 0.3);
  if (firstTeRound != null) {
    if (firstTeRound >= 6) fragments.push("grabs TEs late");
    else if (firstTeRound <= 3) fragments.push("invests early at TE");
  }

  // Overall positional lean as a fallback so we always say something.
  if (fragments.length === 0 && total > 0) {
    const top = CORE_POSITIONS.reduce((a, b) => (byPos[b] > byPos[a] ? b : a));
    fragments.push(`leans toward ${top}`);
  }

  if (fragments.length === 0) return "Not enough draft history to read a clear tendency yet.";
  return `Typically ${joinList(fragments)}.`;
}

/** Earliest round (1-based) where `pos` made up at least `threshold` of picks. */
function earliestPositionRound(
  byRound: Map<number, Record<CorePos, number>>,
  pos: CorePos,
  threshold: number,
): number | null {
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  for (const r of rounds) {
    const row = byRound.get(r)!;
    const tot = row.QB + row.RB + row.WR + row.TE;
    if (tot > 0 && row[pos] / tot >= threshold) return r;
  }
  return null;
}

/** Rule-based sentence describing the largest over/under-draft vs the league. */
function generatePositionalBiasAnalysis(bias: DraftBiasRow[]): string {
  const sorted = [...bias].sort((a, b) => b.difference - a.difference);
  const over = sorted[0];
  const under = sorted[sorted.length - 1];
  const parts: string[] = [];
  // Only call out gaps of at least ~5 points so noise doesn't read as a trend.
  if (over && over.difference >= 5) {
    parts.push(`drafts more ${over.position} than the league (+${over.difference} pts)`);
  }
  if (under && under.difference <= -5) {
    parts.push(`and fewer ${under.position} (${under.difference} pts)`);
  }
  if (parts.length === 0) {
    return "Positional draft mix closely tracks the leagues they play in. No strong lean.";
  }
  return `Relative to league average, ${parts.join(" ")}.`;
}

/** Join fragments as "a, b, and c". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
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

  // Kick off the multi-season walk now so its many fetches overlap with the
  // synchronous analysis below; awaited just before the payload is built. The
  // walk is seeded with the current season's leagues PLUS the manager's dynasty
  // leagues from recent prior seasons (fetched directly) so broken
  // previous_league_id chains don't hide completed history. discoverCareerLeagues
  // dedups by league_id and still walks each seed's chain for older seasons.
  const discoveryPromise = (async () => {
    const priorSeasons: string[] = [];
    const baseSeason = Number(season);
    if (Number.isFinite(baseSeason)) {
      for (let i = 1; i <= CAREER_SEED_PRIOR_SEASONS; i++) priorSeasons.push(String(baseSeason - i));
    }
    const priorSeedLists = await Promise.all(
      priorSeasons.map((s) => fetchSleeperLeagues(user.userId, s).catch(() => [])),
    );
    const seedMap = new Map<string, SleeperLeagueSummary>();
    for (const lg of [...scannedLeagues, ...priorSeedLists.flat()]) {
      if (!seedMap.has(lg.leagueId)) seedMap.set(lg.leagueId, lg);
    }
    return discoverCareerLeagues(Array.from(seedMap.values()));
  })().catch((err): { discovered: CareerLeagueRaw[]; truncated: boolean } => {
    console.error("[ManagerIntel] league discovery failed:", err?.message || err);
    return { discovered: [], truncated: false };
  });

  const careerHistoryPromise = discoveryPromise
    .then(({ discovered, truncated }) => buildCareerHistory(discovered, truncated, user.userId))
    .catch((err): CareerHistory => {
      console.error("[ManagerIntel] career history failed:", err?.message || err);
      return {
        available: false,
        seasonsActive: 0,
        firstSeason: null,
        latestSeason: null,
        leagueSeasonsPlayed: 0,
        record: null,
        winPct: null,
        avgPointsForPerSeason: null,
        championships: null,
        playoffAppearances: null,
        finishes: null,
        seasons: [],
        truncated: false,
        note: "Career history could not be loaded.",
      };
    });

  // Draft tendencies source their startup drafts directly from the user's
  // current + prior season drafts (not the previous_league_id chain, which breaks
  // for leagues that aren't renewed year-over-year), so fresh startups are found.
  const draftProfilePromise = collectStartupDraftIds(user.userId, season)
    .then((draftIds) => buildDraftProfile(draftIds, user.userId, playersDb))
    .catch((err): DraftProfile => {
      console.error("[ManagerIntel] draft profile failed:", err?.message || err);
      return emptyDraftProfile("Draft tendencies could not be loaded.");
    });

  // Cross-league exposure across visible dynasty rosters. Capture age/exp so we
  // can type their "favorite player types" downstream.
  const exposureMap = new Map<
    string,
    { name: string; pos: string; team: string; age: number | null; exp: number | null; count: number }
  >();
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
          age: p.age ?? null,
          exp: p.years_exp ?? null,
          count: 1,
        });
    }
  }
  const totalLeagues = scans.length || 1;
  const exposureList: Array<PlayerExposure & { age: number | null; exp: number | null }> = Array.from(
    exposureMap.entries(),
  )
    .map(([playerId, d]) => ({
      playerId,
      name: d.name,
      pos: d.pos,
      team: d.team,
      age: d.age,
      exp: d.exp,
      leagueCount: d.count,
      exposure: Math.round((d.count / totalLeagues) * 100),
    }))
    .sort((a, b) => b.leagueCount - a.leagueCount);
  const stripExposure = (e: PlayerExposure & { exp: number | null }): PlayerExposure => ({
    playerId: e.playerId,
    name: e.name,
    pos: e.pos,
    team: e.team,
    age: e.age,
    leagueCount: e.leagueCount,
    exposure: e.exposure,
  });
  const mostRosteredPlayers: PlayerExposure[] = exposureList.slice(0, 8).map(stripExposure);
  const mostRosteredByPosition = {
    QB: exposureList.filter((e) => e.pos === "QB").slice(0, 4).map(stripExposure),
    RB: exposureList.filter((e) => e.pos === "RB").slice(0, 4).map(stripExposure),
    WR: exposureList.filter((e) => e.pos === "WR").slice(0, 4).map(stripExposure),
    TE: exposureList.filter((e) => e.pos === "TE").slice(0, 4).map(stripExposure),
  };

  // Value by position — average value the manager carries at each position
  // across their visible leagues. scanLeague already applies the right SF/1QB
  // FantasyCalc values per league, so we sum each roster's per-position value
  // and divide by the number of leagues where they actually have a roster.
  const rosterScans = scans.filter((s) => s.managerRoster && s.managerRoster.length > 0);
  const dynastyByPos: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const redraftByPos: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const s of rosterScans) {
    for (const p of s.managerRoster!) {
      dynastyByPos[p.pos] = (dynastyByPos[p.pos] || 0) + p.dynasty;
      redraftByPos[p.pos] = (redraftByPos[p.pos] || 0) + p.redraft;
    }
  }
  const VALUE_POS_ORDER = ["QB", "RB", "WR", "TE"] as const;
  const valueByPosition =
    rosterScans.length > 0
      ? {
          leagueCount: rosterScans.length,
          dynasty: VALUE_POS_ORDER.map((position) => ({
            position,
            value: Math.round(dynastyByPos[position] / rosterScans.length),
          })),
          redraft: VALUE_POS_ORDER.map((position) => ({
            position,
            value: Math.round(redraftByPos[position] / rosterScans.length),
          })),
        }
      : null;

  // Position concentration (count-weighted share of the dominant position) —
  // feeds the portfolio-identity read.
  const posWeight: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const e of exposureList) posWeight[e.pos] = (posWeight[e.pos] || 0) + e.leagueCount;
  const totalPosWeight = Object.values(posWeight).reduce((a, b) => a + b, 0) || 1;
  const topPosEntry = Object.entries(posWeight).sort((a, b) => b[1] - a[1])[0];
  const topPositionConcentration = topPosEntry
    ? { pos: topPosEntry[0], share: topPosEntry[1] / totalPosWeight }
    : null;

  const exposureRich: ExposureRich[] = exposureList.map((e) => ({
    pos: e.pos,
    age: e.age,
    exp: e.exp,
    leagueCount: e.leagueCount,
  }));
  const favoritePlayerTypes = buildFavoritePlayerTypes(exposureRich, totalLeagues);
  const positionBias = buildPositionBias(exposureRich);

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

    // League rank snapshot — where this team sits vs the rest of the league.
    const total = currentScan.allRosters.length;
    const myIdx = currentScan.managerRoster
      ? currentScan.allRosters.indexOf(currentScan.managerRoster)
      : -1;
    const dynTotals = currentScan.allRosters.map((r) => r.reduce((s, p) => s + p.dynasty, 0));
    const redTotals = currentScan.allRosters.map((r) => r.reduce((s, p) => s + p.redraft, 0));
    const ageAvgs = currentScan.allRosters.map((r) => {
      const as = r.map((p) => p.age).filter((a): a is number => a != null);
      return as.length ? as.reduce((a, b) => a + b, 0) / as.length : 99;
    });
    const rankSnapshot: RankSnapshotRow[] =
      myIdx >= 0
        ? [
            { label: "Dynasty value", rank: rankOf(dynTotals, dynTotals[myIdx]), total },
            { label: "Win-now value", rank: rankOf(redTotals, redTotals[myIdx]), total },
            { label: "Roster youth", rank: rankOf(ageAvgs, ageAvgs[myIdx], true), total },
          ]
        : [];

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
      rankSnapshot,
      teamIdentity: buildTeamIdentity(dynasty, direction, teamAvgAge || null),
      relativeWeakness: buildRelativeWeakness(dynasty, needs),
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

  // ── Derived tendencies ──────────────────────────────────────────────────
  const direction = currentLeague?.teamDirection ?? "Unknown";
  const needs = currentLeague?.teamNeeds ?? [];
  const dynasty = currentLeague?.dynastyStrengths ?? [];
  const avgEarlyPicks =
    scans.length > 0 ? scans.reduce((s, x) => s + x.picks.earlyPicks, 0) / scans.length : 0;

  const preferences: ManagerIntelPayload["preferences"] = {
    youthPreference: youthRating(averageTeamAge),
    veteranPreference: veteranRating(averageTeamAge),
    pickValue: pickValueRating(avgEarlyPicks),
    aggressiveness: aggressivenessRating(tradeActivityRating, waiverActivityRating),
  };

  // "Strong rosters" = ranks in the top third of the current league on dynasty
  // value. Feeds the trade-difficulty read.
  const dynRankRow = currentLeague?.rankSnapshot.find((r) => r.label === "Dynasty value");
  const hasStrongRosters =
    !!dynRankRow && dynRankRow.rank != null && dynRankRow.rank <= Math.ceil(dynRankRow.total / 3);

  const portfolioType = buildPortfolioType(
    preferences.youthPreference,
    preferences.veteranPreference,
    favoritePlayerTypes,
  );
  const portfolioIdentity = buildPortfolioIdentity(
    portfolioType,
    preferences.youthPreference,
    preferences.veteranPreference,
    favoritePlayerTypes,
    topPositionConcentration,
  );
  const tradeImplications = buildTradeImplications(preferences, positionBias);

  // Top leaguemates — other managers who appear in the most of this user's
  // active leagues, ranked by shared-league count.
  const mateMap = new Map<string, { ownerId: string; displayName: string; avatar: string | null; sharedLeagues: number }>();
  for (const s of scans) {
    for (const o of s.owners) {
      if (!o.ownerId || o.ownerId === user.userId) continue;
      const existing = mateMap.get(o.ownerId);
      if (existing) {
        existing.sharedLeagues += 1;
        if (!existing.avatar && o.avatar) existing.avatar = o.avatar;
        if (existing.displayName.startsWith("Team ") && !o.displayName.startsWith("Team ")) existing.displayName = o.displayName;
      } else {
        mateMap.set(o.ownerId, { ownerId: o.ownerId, displayName: o.displayName, avatar: o.avatar, sharedLeagues: 1 });
      }
    }
  }
  const topLeaguemates = Array.from(mateMap.values())
    .sort((a, b) => b.sharedLeagues - a.sharedLeagues || a.displayName.localeCompare(b.displayName))
    .slice(0, 12);

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
    mostRosteredByPosition,
    mostDraftedPlayers: null, // Reliable draft attribution requires per-draft picks data we don't fetch in v1.
    valueByPosition,
    topLeaguemates,
    commonRosterBuild,
    averageTeamAge,
    positionStrengthProfile,
    favoritePlayerTypes,
    portfolioType,
    portfolioIdentity,
    positionBias,
    tradeImplications,
  };

  const performance: ManagerIntelPayload["performance"] = {
    playoffAppearances: null,
    championshipWins: null,
    finalsAppearances: null,
    avgRegularSeasonFinish: null,
    avgPointsFor,
    notes:
      "Multi-season playoff and championship data isn't reliably exposed by the Sleeper public API. Showing current-season activity only.",
  };

  const { signal, note: signalNote } = activitySignalOf(tradesPerLeague, waiversPerLeague);
  const timeline = buildTimeline(
    scans.flatMap((s) => s.managerTxns.map((t) => ({ ts: t.ts, type: t.type, league: s.name }))),
  );
  const HISTORY_LIMIT = 100;
  const tradeHistory = scans
    .flatMap((s) => s.managerTradeEvents)
    .filter((e) => e.ts > 0)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, HISTORY_LIMIT)
    .map((e) => ({ date: new Date(e.ts).toISOString(), league: e.leagueName, leagueType: e.leagueType, week: e.week, added: e.added, dropped: e.dropped, partner: e.partner }));
  const waiverHistory = scans
    .flatMap((s) => s.managerWaiverEvents)
    .filter((e) => e.ts > 0)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, HISTORY_LIMIT)
    .map((e) => ({ date: new Date(e.ts).toISOString(), league: e.leagueName, kind: e.kind, added: e.added, dropped: e.dropped }));
  const activity: ManagerIntelPayload["activity"] = {
    visibleLeagues: scans.length,
    oldestVisibleSeason: oldestLeagueSeason,
    estimatedYearsActive: crossLeague.estimatedYearsActive,
    currentPointsFor: avgPointsFor,
    tradeCount: totalTrades,
    waiverCount: totalWaivers,
    totalTransactions: totalTrades + totalWaivers,
    activitySignal: signal,
    signalNote,
    activityArchetype: buildActivityArchetype(tradesPerLeague, waiversPerLeague, scans.length),
    tradeability: buildTradeability(tradeActivityRating),
    lastActivity: timeline.lastActivity,
    last30Days: timeline.last30Days,
    last90Days: timeline.last90Days,
    activityTrend: timeline.activityTrend,
    recent: timeline.recent,
    tradeHistory,
    waiverHistory,
  };

  const tradeApproach = buildTradeApproach(currentLeague, crossLeague, mostRosteredPlayers);
  const { profile: tradeProfile, targetPositions, preferYouth } = buildTradeProfile(
    direction,
    tradeActivityRating,
    preferences,
    dynasty,
    needs,
  );
  tradeApproach.tradeProfile = tradeProfile;
  tradeApproach.openingOffers = buildOpeningOffers(direction, needs, season);
  tradeApproach.targetPositions = targetPositions;
  tradeApproach.preferYouth = preferYouth;
  tradeApproach.actionableTakeaway = buildActionableTakeaway(
    direction,
    targetPositions,
    preferYouth,
    preferences.pickValue,
  );
  const { doList, dontList } = buildDoDont(direction, targetPositions, preferYouth);
  tradeApproach.doList = doList;
  tradeApproach.dontList = dontList;

  // Trade playbook extras.
  const dealTypes = buildDealTypes(direction, needs);
  tradeApproach.dealTypes = dealTypes;
  tradeApproach.tradeDifficulty = buildTradeDifficulty(tradeActivityRating, hasStrongRosters);
  tradeApproach.playbook = buildPlaybook(direction, tradeActivityRating, tradeProfile, dealTypes);
  tradeApproach.negotiationNotes = buildNegotiationNotes(direction, needs);
  const grouped = buildGroupedTargetsSell(direction, preferYouth, needs);
  tradeApproach.likelyTargetsGrouped = grouped.likelyTargetsGrouped;
  tradeApproach.sellCandidatesGrouped = grouped.sellCandidatesGrouped;
  const theirAssets = buildTheirAssets(currentScan?.managerRoster ?? null, playersDb, preferences.youthPreference);
  tradeApproach.targetableAssets = theirAssets.targetableAssets;
  tradeApproach.protectedAssets = theirAssets.protectedAssets;

  // Keep the paragraph-length narrative summary too.
  tradeApproach.summary = buildSummary(user, currentLeague, crossLeague);

  const rosterIdentity = buildRosterIdentity(
    commonRosterBuild,
    dynasty,
    positionStrengthProfile,
    preferences.pickValue,
  );
  const confidence = buildConfidence(leagues.length, totalTrades + totalWaivers);
  const leagueReports = scans
    .map((s) => buildLeagueReport(s, user.userId, currentLeagueId))
    .filter((r): r is LeagueReport => r !== null);
  const scorecard = buildScorecard(
    tradeActivityRating,
    waiverActivityRating,
    direction,
    preferences,
    commonRosterBuild,
    tradeProfile.bestOfferType,
  );
  const headerBadges = [
    `${leagues.length} Dynasty League${leagues.length === 1 ? "" : "s"}`,
    `${tradeActivityRating} Trader`,
    commonRosterBuild.replace(/ build$/i, ""),
    ageBadge(preferences.youthPreference, preferences.veteranPreference),
  ];

  return {
    user: {
      user_id: user.userId,
      username: user.username,
      display_name: user.displayName,
      avatar: user.avatar,
    },
    rosterIdentity,
    headerBadges,
    confidence,
    scorecard,
    preferences,
    currentLeague,
    leagues: leagueReports,
    crossLeague,
    performance,
    careerHistory: await careerHistoryPromise,
    draftProfile: await draftProfilePromise,
    activity,
    tradeApproach,
    meta: {
      season,
      leaguesScanned: scans.length,
      computedAt: new Date().toISOString(),
      dataSourceNote:
        "Visible Sleeper leagues only. Private leagues and DMs are not included.",
      version: CACHE_VERSION,
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
    rosterIdentity: "Insufficient data.",
    headerBadges: [],
    confidence: { level: "Low", basis: note },
    scorecard: [],
    preferences: {
      youthPreference: "Medium",
      veteranPreference: "Medium",
      pickValue: "Low",
      aggressiveness: "Low",
    },
    currentLeague: null,
    leagues: [],
    crossLeague: {
      dynastyLeagueCount: 0,
      oldestLeagueSeason: null,
      estimatedYearsActive: null,
      tradeCount: 0,
      waiverCount: 0,
      tradeActivityRating: "Low",
      waiverActivityRating: "Low",
      mostRosteredPlayers: [],
      mostRosteredByPosition: { QB: [], RB: [], WR: [], TE: [] },
      mostDraftedPlayers: null,
      valueByPosition: null,
      topLeaguemates: [],
      commonRosterBuild: "Insufficient data",
      averageTeamAge: null,
      positionStrengthProfile: "Insufficient data",
      favoritePlayerTypes: [],
      portfolioType: "Unknown",
      portfolioIdentity: note,
      positionBias: [],
      tradeImplications: { likelyValues: [], unlikelyValues: [], bestAngle: note },
    },
    performance: {
      playoffAppearances: null,
      championshipWins: null,
      finalsAppearances: null,
      avgRegularSeasonFinish: null,
      avgPointsFor: null,
      notes: note,
    },
    careerHistory: {
      available: false,
      seasonsActive: 0,
      firstSeason: null,
      latestSeason: null,
      leagueSeasonsPlayed: 0,
      record: null,
      winPct: null,
      avgPointsForPerSeason: null,
      championships: null,
      playoffAppearances: null,
      finishes: null,
      seasons: [],
      truncated: false,
      note,
    },
    draftProfile: emptyDraftProfile(note),
    activity: {
      visibleLeagues: 0,
      oldestVisibleSeason: null,
      estimatedYearsActive: null,
      currentPointsFor: null,
      tradeCount: 0,
      waiverCount: 0,
      totalTransactions: 0,
      activitySignal: "Ghost",
      signalNote: note,
      activityArchetype: { key: "dormant", label: "Dormant / Low Signal", blurb: note },
      tradeability: { level: "Low", note: note },
      lastActivity: null,
      last30Days: 0,
      last90Days: 0,
      activityTrend: "Unknown",
      recent: [],
      tradeHistory: [],
      waiverHistory: [],
    },
    tradeApproach: {
      summary: note,
      suggestedAngle: "Insufficient data. No actionable read available.",
      actionableTakeaway: "Insufficient data. No actionable read available.",
      doList: [],
      dontList: [],
      likelyNeeds: [],
      assetsTheyMayValue: [],
      cautionNotes: "Visible Sleeper leagues only.",
      tradeProfile: {
        tradeActivity: "Low",
        tradeStyle: "Unknown",
        bestOfferType: "Insufficient data",
        avoidOffering: "Insufficient data",
        likelyTargets: [],
        sellCandidates: [],
      },
      openingOffers: [],
      targetPositions: [],
      preferYouth: false,
      tradeDifficulty: { level: "Low", reason: note },
      playbook: {
        bestApproach: "Insufficient data",
        likelyStyle: "Unknown",
        bestDealType: "Insufficient data",
        likelyMotivation: "Unknown",
        negotiationStyle: "Unknown",
        avoid: "Insufficient data",
      },
      dealTypes: [],
      negotiationNotes: [],
      targetableAssets: [],
      protectedAssets: [],
      likelyTargetsGrouped: { high: [], conditional: [] },
      sellCandidatesGrouped: { mostLikely: [], leastLikely: [] },
    },
    meta: {
      season,
      leaguesScanned: 0,
      computedAt: new Date().toISOString(),
      dataSourceNote: note,
      version: CACHE_VERSION,
    },
  };
}
