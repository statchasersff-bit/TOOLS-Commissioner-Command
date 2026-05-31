// GM Dashboard analytics — pure, memoizable helpers consumed by the
// expanded My Team → Overview sections. Nothing in this module touches React;
// callers (`useMemo` in the section components) decide when to recompute.

import type { League, Player, Pick, Team } from "@/types";

// Picks are part of dynasty value but optional for callers that don't have a
// pick valuer handy; default to 0 so player-only callers still work.
const NO_PICK_VALUE = (_p: Pick) => 0;

// ── Constants ───────────────────────────────────────────────────────────────

export const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type Position = (typeof POSITIONS)[number];

export type AgeBand = "Young" | "Prime" | "Aging";

interface AgeRule {
  young: number;   // strictly less than → Young
  prime: number;   // strictly less than → Prime
  // anything >= prime → Aging
}

// Position-specific age bands per the spec.
const AGE_RULES: Record<Position, AgeRule> = {
  QB: { young: 25, prime: 31 },
  RB: { young: 24, prime: 27 },
  WR: { young: 24, prime: 29 },
  TE: { young: 25, prime: 30 },
};

export function classifyAge(pos: Position, age: number): AgeBand {
  const r = AGE_RULES[pos];
  if (age < r.young) return "Young";
  if (age < r.prime) return "Prime";
  return "Aging";
}

// ── Starter / bench strength ────────────────────────────────────────────────

export interface StrengthSnapshot {
  starterStrength: number;   // sum of optimal-starter redraft values
  benchDepth: number;        // sum of non-starter dynasty values
  starterRank: number;       // 1 = best
  benchRank: number;
  ceilingScore: number;      // 0..100
  floorScore: number;        // 0..100
  dynastyScore: number;      // 0..100 — long-term franchise value vs league best
  dynastyValue: number;      // total dynasty value (players + picks)
  dynastyRank: number;       // 1 = best total dynasty value in the league
  pickValue: number;         // total rookie draft-pick value
  pickRank: number;          // 1 = best pick capital in the league
  totalTeams: number;
}

/**
 * Sum win-now (redraft) value of a team.
 *
 * Standard leagues: only players flagged as starters count, since bench points
 * never reach the scoreboard. Best-ball leagues have no set lineup — every
 * rostered player's best weeks auto-score — so win-now value reflects the
 * ENTIRE roster's redraft value, not just the optimal starters.
 */
export function calculateStarterStrength(
  team: Team,
  getRedraftValue: (p: Player) => number,
  isBestBall = false,
): number {
  return team.roster
    .filter((p) => isBestBall || p.starter)
    .reduce((s, p) => s + getRedraftValue(p), 0);
}

/** Sum dynasty value of every non-starter, ignoring IR/taxi shelves. */
export function calculateBenchDepth(
  team: Team,
  getPlayerValue: (p: Player) => number,
): number {
  return team.roster
    .filter((p) => !p.starter && !p.onTaxi && !p.onReserve)
    .reduce((s, p) => s + getPlayerValue(p), 0);
}

/**
 * Heuristic weekly ceiling — what the team can score in a great week. We sum
 * the top-3 starter redraft values + a smaller share of the rest, plus a
 * bonus when the team has a top-tier QB (highest variance position).
 * Returned as a 0..100 score relative to league-best.
 */
export function calculateCeilingScore(
  team: Team,
  league: League,
  getRedraftValue: (p: Player) => number,
): number {
  const score = (t: Team) => {
    const starters = [...t.roster.filter((p) => p.starter)].sort(
      (a, b) => getRedraftValue(b) - getRedraftValue(a),
    );
    const top3 = starters.slice(0, 3).reduce((s, p) => s + getRedraftValue(p), 0);
    const rest = starters.slice(3).reduce((s, p) => s + getRedraftValue(p), 0);
    const qbBonus = starters
      .filter((p) => p.pos === "QB")
      .slice(0, 1)
      .reduce((s, p) => s + getRedraftValue(p) * 0.25, 0);
    return top3 + rest * 0.4 + qbBonus;
  };
  const mine = score(team);
  const best = Math.max(1, ...league.teams.map(score));
  return Math.round((mine / best) * 100);
}

/**
 * Heuristic weekly floor — bad-week resilience. We measure the gap between
 * worst and best starter at each position: small gaps + high minimums mean a
 * stable floor. Score is 0..100, league-relative.
 */
export function calculateFloorScore(
  team: Team,
  league: League,
  getRedraftValue: (p: Player) => number,
): number {
  const score = (t: Team) => {
    const starters = t.roster.filter((p) => p.starter);
    if (starters.length === 0) return 0;
    const vals = starters.map(getRedraftValue).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    const minThird = vals.slice(0, Math.max(1, Math.floor(vals.length / 3)));
    const minAvg = minThird.reduce((s, v) => s + v, 0) / minThird.length;
    // Higher minAvg = better floor; weight it more than median.
    return minAvg * 0.6 + median * 0.4;
  };
  const mine = score(team);
  const best = Math.max(1, ...league.teams.map(score));
  return Math.round((mine / best) * 100);
}

/** Total long-term dynasty value of a franchise — every rostered player
 *  (including IR/taxi shelves, which still hold dynasty value) plus draft picks. */
export function calculateDynastyValue(
  team: Team,
  getPlayerValue: (p: Player) => number,
  getPickValue: (p: Pick) => number = NO_PICK_VALUE,
): number {
  const rosterValue = team.roster.reduce((s, p) => s + getPlayerValue(p), 0);
  const pickValue = team.picks.reduce((s, p) => s + getPickValue(p), 0);
  return rosterValue + pickValue;
}

/**
 * Dynasty strength — overall long-term franchise value (players + picks) as a
 * 0..100 score relative to the league's strongest team. Higher = a deeper,
 * more valuable dynasty asset base.
 */
export function calculateDynastyScore(
  team: Team,
  league: League,
  getPlayerValue: (p: Player) => number,
  getPickValue: (p: Pick) => number = NO_PICK_VALUE,
): number {
  const mine = calculateDynastyValue(team, getPlayerValue, getPickValue);
  const best = Math.max(1, ...league.teams.map((t) => calculateDynastyValue(t, getPlayerValue, getPickValue)));
  return Math.round((mine / best) * 100);
}

/**
 * Compute the full strength snapshot for one team (with league-wide ranks).
 * Single pass so the section component only memoizes once.
 */
export function calculateStrengthSnapshot(
  team: Team,
  league: League,
  getRedraftValue: (p: Player) => number,
  getPlayerValue: (p: Player) => number,
  getPickValue: (p: Pick) => number = NO_PICK_VALUE,
): StrengthSnapshot {
  const isBestBall = league.isBestBall ?? false;
  const starterStrength = calculateStarterStrength(team, getRedraftValue, isBestBall);
  const benchDepth = calculateBenchDepth(team, getPlayerValue);

  const starterRank =
    [...league.teams]
      .map((t) => ({ id: t.id, v: calculateStarterStrength(t, getRedraftValue, isBestBall) }))
      .sort((a, b) => b.v - a.v)
      .findIndex((t) => t.id === team.id) + 1;

  const benchRank =
    [...league.teams]
      .map((t) => ({ id: t.id, v: calculateBenchDepth(t, getPlayerValue) }))
      .sort((a, b) => b.v - a.v)
      .findIndex((t) => t.id === team.id) + 1;

  return {
    starterStrength,
    benchDepth,
    starterRank,
    benchRank,
    ceilingScore: calculateCeilingScore(team, league, getRedraftValue),
    floorScore: calculateFloorScore(team, league, getRedraftValue),
    dynastyScore: calculateDynastyScore(team, league, getPlayerValue, getPickValue),
    dynastyValue: calculateDynastyValue(team, getPlayerValue, getPickValue),
    dynastyRank:
      [...league.teams]
        .map((t) => ({ id: t.id, v: calculateDynastyValue(t, getPlayerValue, getPickValue) }))
        .sort((a, b) => b.v - a.v)
        .findIndex((t) => t.id === team.id) + 1,
    pickValue: team.picks.reduce((s, p) => s + getPickValue(p), 0),
    pickRank:
      [...league.teams]
        .map((t) => ({ id: t.id, v: t.picks.reduce((s, p) => s + getPickValue(p), 0) }))
        .sort((a, b) => b.v - a.v)
        .findIndex((t) => t.id === team.id) + 1,
    totalTeams: league.teams.length,
  };
}

// ── Age curves ──────────────────────────────────────────────────────────────

export interface AgeCurveEntry {
  pos: Position;
  count: number;          // contributors used in the avg
  avgAge: number;
  leagueAvgAge: number;
  band: AgeBand;
  // Heuristic risk: 0..100. Higher = older/riskier.
  agingRisk: number;
}

export interface AgeCurveResult {
  entries: AgeCurveEntry[];
  // 1 = youngest in league, totalTeams = oldest
  youngestRank: number;
  oldestRank: number;       // i.e. league rank when sorted by oldest first
  weightedStarterAge: number;
  weightedRosterAge: number;
  totalTeams: number;
}

export function calculateAgeCurve(
  team: Team,
  league: League,
  getPlayerValue: (p: Player) => number,
): AgeCurveResult {
  // The age curve covers the ENTIRE roster — every rostered player at each
  // position, no value threshold — so the averages reflect the full roster's
  // age profile rather than just the headline contributors.
  const entries: AgeCurveEntry[] = POSITIONS.map((pos) => {
    const mine = team.roster.filter((p) => p.pos === pos);
    const all = league.teams.flatMap((t) => t.roster.filter((p) => p.pos === pos));
    const avgAge = mine.length > 0 ? mine.reduce((s, p) => s + p.age, 0) / mine.length : 0;
    const leagueAvgAge = all.length > 0 ? all.reduce((s, p) => s + p.age, 0) / all.length : 0;
    const band: AgeBand = mine.length > 0 ? classifyAge(pos, avgAge) : "Prime";
    const rule = AGE_RULES[pos];
    // Aging risk: distance from "young end" of the band, scaled.
    const span = Math.max(1, rule.prime + 4 - rule.young);
    const agingRisk = Math.max(0, Math.min(100, Math.round(((avgAge - rule.young) / span) * 100)));
    return { pos, count: mine.length, avgAge, leagueAvgAge, band, agingRisk };
  });

  // Weighted ages (by dynasty value) across the whole roster.
  const weightedAge = (list: Player[]) => {
    if (list.length === 0) return 0;
    const totalV = list.reduce((s, p) => s + Math.max(1, getPlayerValue(p)), 0);
    return list.reduce((s, p) => s + p.age * Math.max(1, getPlayerValue(p)), 0) / totalV;
  };
  const weightedRosterAge = weightedAge(team.roster);
  const weightedStarterAge = weightedAge(team.roster.filter((p) => p.starter));

  const teamAvgAges = league.teams.map((t) => ({ id: t.id, age: weightedAge(t.roster) }));
  const sortedAsc = [...teamAvgAges].sort((a, b) => a.age - b.age);
  const sortedDesc = [...teamAvgAges].sort((a, b) => b.age - a.age);
  const youngestRank = sortedAsc.findIndex((t) => t.id === team.id) + 1;
  const oldestRank = sortedDesc.findIndex((t) => t.id === team.id) + 1;

  return {
    entries,
    youngestRank,
    oldestRank,
    weightedStarterAge,
    weightedRosterAge,
    totalTeams: league.teams.length,
  };
}

// ── Asset tiers ─────────────────────────────────────────────────────────────

export type TierName = "Elite" | "Core" | "Flex" | "Depth" | "Lottery";
export const TIER_ORDER: TierName[] = ["Elite", "Core", "Flex", "Depth", "Lottery"];

export interface AssetTierResult {
  tiers: Record<TierName, Player[]>;
  /** Per-tier positional distribution */
  positionDistribution: Record<TierName, Record<Position, number>>;
  /** Lower bound (inclusive) for each tier — useful for chart axes. */
  thresholds: Record<TierName, number>;
}

/**
 * Build dynamic thresholds from the full league player pool, then bucket
 * THIS team's players. Top 5% league-wide = Elite; next 15% = Core; etc.
 */
export function buildAssetTiers(
  team: Team,
  league: League,
  getPlayerValue: (p: Player) => number,
): AssetTierResult {
  const all = league.teams
    .flatMap((t) => t.roster.map((p) => getPlayerValue(p)))
    .filter((v) => v > 0)
    .sort((a, b) => b - a);

  // Percentile cutoffs (descending — highest values first)
  const pct = (p: number) => all[Math.min(all.length - 1, Math.floor(all.length * p))] ?? 0;
  const thresholds: Record<TierName, number> = {
    Elite: pct(0.05),
    Core: pct(0.20),
    Flex: pct(0.50),
    Depth: pct(0.80),
    Lottery: 1, // anything below Depth that has any value
  };

  const bucket = (v: number): TierName | null => {
    if (v <= 0) return null;
    if (v >= thresholds.Elite) return "Elite";
    if (v >= thresholds.Core) return "Core";
    if (v >= thresholds.Flex) return "Flex";
    if (v >= thresholds.Depth) return "Depth";
    return "Lottery";
  };

  const tiers: Record<TierName, Player[]> = { Elite: [], Core: [], Flex: [], Depth: [], Lottery: [] };
  const positionDistribution: Record<TierName, Record<Position, number>> = {
    Elite: { QB: 0, RB: 0, WR: 0, TE: 0 },
    Core: { QB: 0, RB: 0, WR: 0, TE: 0 },
    Flex: { QB: 0, RB: 0, WR: 0, TE: 0 },
    Depth: { QB: 0, RB: 0, WR: 0, TE: 0 },
    Lottery: { QB: 0, RB: 0, WR: 0, TE: 0 },
  };

  for (const p of team.roster) {
    const t = bucket(getPlayerValue(p));
    if (!t) continue;
    tiers[t].push(p);
    positionDistribution[t][p.pos as Position] = (positionDistribution[t][p.pos as Position] ?? 0) + 1;
  }

  // Sort players within each tier desc by value so callers can render top N.
  for (const t of TIER_ORDER) {
    tiers[t].sort((a, b) => getPlayerValue(b) - getPlayerValue(a));
  }

  return { tiers, positionDistribution, thresholds };
}

// ── Aggregate "current snapshot" — used by the trajectory recorder ──────────

export interface TeamSnapshotPayload {
  dynastyValue: number;
  winNowValue: number;
  pickValue: number;
  starterStrength: number;
  avgAge: number;
}

export function buildSnapshotPayload(
  team: Team,
  getPlayerValue: (p: Player) => number,
  getRedraftValue: (p: Player) => number,
  getPickValue: (p: Pick) => number,
  isBestBall = false,
): TeamSnapshotPayload {
  const dynastyPlayers = team.roster.reduce((s, p) => s + getPlayerValue(p), 0);
  const pickValue = team.picks.reduce((s, p) => s + getPickValue(p), 0);
  // Best-ball has no set lineup, so win-now spans the entire roster (see
  // calculateStarterStrength); standard leagues count starters only.
  const winNowValue = team.roster
    .filter((p) => isBestBall || p.starter)
    .reduce((s, p) => s + getRedraftValue(p), 0);
  const starters = team.roster.filter((p) => p.starter);
  const avgAge =
    starters.length > 0 ? starters.reduce((s, p) => s + p.age, 0) / starters.length : 0;
  return {
    dynastyValue: Math.round(dynastyPlayers + pickValue),
    winNowValue: Math.round(winNowValue),
    pickValue: Math.round(pickValue),
    starterStrength: Math.round(winNowValue),
    avgAge: Math.round(avgAge * 10) / 10,
  };
}
