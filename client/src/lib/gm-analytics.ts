// GM Dashboard analytics — pure, memoizable helpers consumed by the
// expanded My Team → Overview sections. Nothing in this module touches React;
// callers (`useMemo` in the section components) decide when to recompute.

import type { League, Player, Pick, Team } from "@/types";

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
  stabilityScore: number;    // 0..100
  totalTeams: number;
}

/** Sum win-now (redraft) value of every player flagged as a starter. */
export function calculateStarterStrength(
  team: Team,
  getRedraftValue: (p: Player) => number,
): number {
  return team.roster
    .filter((p) => p.starter)
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

/**
 * Lineup stability — heuristic 0..100. Factors:
 *  - depth at each starter position (more backups = more stable)
 *  - age dispersion (extreme ages = volatility, esp. RBs)
 *  - QB depth premium (no backup QB = big risk in SF)
 */
export function calculateStabilityScore(
  team: Team,
  league: League,
  getPlayerValue: (p: Player) => number,
): number {
  const starters = team.roster.filter((p) => p.starter);
  const bench = team.roster.filter((p) => !p.starter && !p.onTaxi && !p.onReserve);
  if (starters.length === 0) return 0;

  // Depth ratio per position
  const posCounts = (list: Player[]) =>
    POSITIONS.reduce((acc, pos) => {
      acc[pos] = list.filter((p) => p.pos === pos).length;
      return acc;
    }, {} as Record<Position, number>);
  const sCount = posCounts(starters);
  const bCount = posCounts(bench);

  // Average backups per starter (clamped at 2.5)
  const depthRatios = POSITIONS.map((pos) => {
    if (sCount[pos] === 0) return 1;
    return Math.min(2.5, bCount[pos] / sCount[pos]);
  });
  const depthScore = (depthRatios.reduce((s, r) => s + r, 0) / depthRatios.length / 2.5) * 100;

  // Age volatility — high age stdev at RB drags stability hard.
  const rbAges = team.roster
    .filter((p) => p.pos === "RB" && getPlayerValue(p) > 500)
    .map((p) => p.age);
  let ageVolPenalty = 0;
  if (rbAges.length >= 2) {
    const mean = rbAges.reduce((s, a) => s + a, 0) / rbAges.length;
    const variance = rbAges.reduce((s, a) => s + (a - mean) ** 2, 0) / rbAges.length;
    const std = Math.sqrt(variance);
    ageVolPenalty = Math.min(20, std * 5);
  }

  return Math.max(0, Math.min(100, Math.round(depthScore - ageVolPenalty)));
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
): StrengthSnapshot {
  const starterStrength = calculateStarterStrength(team, getRedraftValue);
  const benchDepth = calculateBenchDepth(team, getPlayerValue);

  const starterRank =
    [...league.teams]
      .map((t) => ({ id: t.id, v: calculateStarterStrength(t, getRedraftValue) }))
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
    stabilityScore: calculateStabilityScore(team, league, getPlayerValue),
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

/**
 * Only count players whose value clears a small threshold so "deep bench
 * dart throws" don't drag the average toward 22 years old. Threshold is
 * relative to the league's median dynasty value so it adapts to scoring.
 */
function meaningfulPlayerThreshold(league: League, getPlayerValue: (p: Player) => number): number {
  const all: number[] = [];
  for (const t of league.teams) for (const p of t.roster) all.push(getPlayerValue(p));
  if (all.length === 0) return 0;
  all.sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)];
  // 25% of league median, clamped at 200 minimum.
  return Math.max(200, Math.round(median * 0.25));
}

export function calculateAgeCurve(
  team: Team,
  league: League,
  getPlayerValue: (p: Player) => number,
): AgeCurveResult {
  const threshold = meaningfulPlayerThreshold(league, getPlayerValue);
  const meaningful = (p: Player) => getPlayerValue(p) >= threshold;

  const entries: AgeCurveEntry[] = POSITIONS.map((pos) => {
    const mine = team.roster.filter((p) => p.pos === pos && meaningful(p));
    const all = league.teams.flatMap((t) => t.roster.filter((p) => p.pos === pos && meaningful(p)));
    const avgAge = mine.length > 0 ? mine.reduce((s, p) => s + p.age, 0) / mine.length : 0;
    const leagueAvgAge = all.length > 0 ? all.reduce((s, p) => s + p.age, 0) / all.length : 0;
    const band: AgeBand = mine.length > 0 ? classifyAge(pos, avgAge) : "Prime";
    const rule = AGE_RULES[pos];
    // Aging risk: distance from "young end" of the band, scaled.
    const span = Math.max(1, rule.prime + 4 - rule.young);
    const agingRisk = Math.max(0, Math.min(100, Math.round(((avgAge - rule.young) / span) * 100)));
    return { pos, count: mine.length, avgAge, leagueAvgAge, band, agingRisk };
  });

  // Weighted ages (by dynasty value)
  const weightedAge = (list: Player[]) => {
    const filtered = list.filter(meaningful);
    if (filtered.length === 0) return 0;
    const totalV = filtered.reduce((s, p) => s + Math.max(1, getPlayerValue(p)), 0);
    return filtered.reduce((s, p) => s + p.age * Math.max(1, getPlayerValue(p)), 0) / totalV;
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

// ── Roster construction archetype ───────────────────────────────────────────

export interface RosterConstruction {
  primary: string;
  secondary: string[];
  explanation: string;
  comparable: string;
}

/**
 * Heuristic archetype classifier. Rules are tuned to be readable and
 * defensible (each archetype has a clear trigger), not statistically pure.
 */
export function classifyRosterConstruction(
  team: Team,
  league: League,
  getPlayerValue: (p: Player) => number,
  getRedraftValue: (p: Player) => number,
  getPickValue: (p: Pick) => number,
): RosterConstruction {
  const totalDynasty =
    team.roster.reduce((s, p) => s + getPlayerValue(p), 0) +
    team.picks.reduce((s, p) => s + getPickValue(p), 0);

  if (totalDynasty <= 0) {
    return {
      primary: "Empty Roster",
      secondary: [],
      explanation: "Not enough data on this roster yet.",
      comparable: "—",
    };
  }

  const posValue = (pos: Position) =>
    team.roster.filter((p) => p.pos === pos).reduce((s, p) => s + getPlayerValue(p), 0);
  const wrShare = posValue("WR") / totalDynasty;
  const rbShare = posValue("RB") / totalDynasty;
  const qbShare = posValue("QB") / totalDynasty;
  const teShare = posValue("TE") / totalDynasty;
  const picksShare = team.picks.reduce((s, p) => s + getPickValue(p), 0) / totalDynasty;

  const meaningful = team.roster.filter((p) => getPlayerValue(p) > 500);
  const avgAge = meaningful.length > 0 ? meaningful.reduce((s, p) => s + p.age, 0) / meaningful.length : 26;
  const winNowValue = team.roster.filter((p) => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
  const leagueWinNowAvg =
    league.teams.reduce(
      (s, t) => s + t.roster.filter((p) => p.starter).reduce((a, p) => a + getRedraftValue(p), 0),
      0,
    ) / Math.max(1, league.teams.length);

  // Quality flags
  const eliteRBCount = team.roster.filter(
    (p) => p.pos === "RB" && getPlayerValue(p) >= percentileValue(league, getPlayerValue, 0.85),
  ).length;
  const eliteWRCount = team.roster.filter(
    (p) => p.pos === "WR" && getPlayerValue(p) >= percentileValue(league, getPlayerValue, 0.85),
  ).length;
  const eliteQB = team.roster.some(
    (p) => p.pos === "QB" && getPlayerValue(p) >= percentileValue(league, getPlayerValue, 0.90),
  );

  // Primary archetype rules — pick the first matching, ordered by specificity
  let primary = "Balanced Build";

  if (qbShare > 0.20 && eliteQB) primary = "Elite QB Build";
  else if (picksShare > 0.25 && winNowValue < leagueWinNowAvg * 0.85) primary = "Pick-Heavy Rebuild";
  else if (wrShare >= 0.42 && eliteWRCount >= 3) primary = "WR Heavy Contender";
  else if (rbShare >= 0.32 && eliteRBCount >= 2) primary = "Robust RB Build";
  else if (rbShare >= 0.32 && eliteRBCount <= 1) primary = "Fragile RB Build";
  else if (avgAge < 24.5 && winNowValue < leagueWinNowAvg * 0.95) primary = "Young Core";
  else if (avgAge > 27.5 && winNowValue > leagueWinNowAvg * 1.05) primary = "Aging Contender";
  else if (winNowValue > leagueWinNowAvg * 1.15 && avgAge >= 25 && avgAge <= 27) primary = "Win-Now Aggressive";
  else if (picksShare > 0.18 && avgAge < 25.5) primary = "Future-Focused";

  // Secondary traits (collected independently)
  const secondary: string[] = [];
  if (primary !== "WR Heavy Contender" && wrShare >= 0.40) secondary.push("WR Heavy");
  if (primary !== "Robust RB Build" && rbShare >= 0.30) secondary.push("RB Concentration");
  if (eliteWRCount >= 2 && primary !== "WR Heavy Contender") secondary.push("Strong WR core");
  if (eliteQB && primary !== "Elite QB Build") secondary.push("Elite QB");
  if (avgAge < 24.5 && primary !== "Young Core") secondary.push("Young Core");
  if (avgAge > 27.5 && primary !== "Aging Contender") secondary.push("Veteran skew");
  if (picksShare > 0.20 && primary !== "Pick-Heavy Rebuild") secondary.push("Pick capital");
  if (teShare >= 0.10) secondary.push("Top-shelf TE");
  if (secondary.length > 3) secondary.length = 3;

  // Explanation — generated from the same signals, GM-tone
  const explanationParts: string[] = [];
  if (wrShare >= 0.40) explanationParts.push(`${Math.round(wrShare * 100)}% of your dynasty value sits at WR`);
  if (rbShare >= 0.30) explanationParts.push(`${Math.round(rbShare * 100)}% concentrated at RB`);
  if (eliteQB) explanationParts.push("you have an elite QB anchor");
  if (avgAge < 25) explanationParts.push(`your meaningful contributors average just ${avgAge.toFixed(1)} years old`);
  else if (avgAge > 27.5) explanationParts.push(`your contributors average ${avgAge.toFixed(1)} years old`);
  if (picksShare > 0.20)
    explanationParts.push(`draft capital represents ${Math.round(picksShare * 100)}% of your asset stack`);
  if (winNowValue > leagueWinNowAvg * 1.15)
    explanationParts.push("starting-lineup value is well above the league average");
  else if (winNowValue < leagueWinNowAvg * 0.85)
    explanationParts.push("starting-lineup value lags the league average");

  const explanation =
    explanationParts.length === 0
      ? "Your roster is well-distributed across positions, ages, and capital types, no single trait dominates."
      : `${capitalize(explanationParts.join("; "))}. That combination points to a ${primary.toLowerCase()} profile.`;

  const comparable = COMPARABLES[primary] ?? "Similar to balanced dynasty builds.";

  return { primary, secondary, explanation, comparable };
}

function percentileValue(
  league: League,
  getPlayerValue: (p: Player) => number,
  pctTopShare: number, // 0..1, where 0.9 = top 10%
): number {
  const vals = league.teams
    .flatMap((t) => t.roster.map(getPlayerValue))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  return vals[Math.floor(vals.length * pctTopShare)] ?? vals[vals.length - 1];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const COMPARABLES: Record<string, string> = {
  "Elite QB Build": "Reminiscent of QB-anchored superflex contenders.",
  "Pick-Heavy Rebuild": "Looks like classic accumulator rebuilds.",
  "WR Heavy Contender": "Resembles modern WR-led championship squads.",
  "Robust RB Build": "Built like a Zero-WR-era contender.",
  "Fragile RB Build": "Productive struggle: one or two injuries reshape the season.",
  "Young Core": "Trending toward a future powerhouse window.",
  "Aging Contender": "Last-call veteran contenders chasing one more run.",
  "Win-Now Aggressive": "All-in builds that mortgage future depth for current ceiling.",
  "Future-Focused": "Patient builds banking on rookie-pick equity.",
  "Balanced Build": "Similar to balanced dynasty builds, no glaring tilts.",
};

// ── League power differential ───────────────────────────────────────────────

export interface PowerDifferential {
  yourDynasty: number;
  leagueAvgDynasty: number;
  topDynasty: number;
  cutoffDynasty: number;     // dynasty value of team at the playoff cutoff
  worstDynasty: number;
  yourStarter: number;
  topStarter: number;
  // Deltas in percentage points (your - other) / other * 100, signed
  vsLeagueAvgPct: number;
  vsTopPct: number;
  vsCutoffPct: number;
  vsWorstPct: number;
  closestTeam: Team | null;
}

export function calculatePowerDifferentials(
  team: Team,
  league: League,
  getPlayerValue: (p: Player) => number,
  getRedraftValue: (p: Player) => number,
  getPickValue: (p: Pick) => number,
): PowerDifferential {
  const dynastyOf = (t: Team) =>
    t.roster.reduce((s, p) => s + getPlayerValue(p), 0) +
    t.picks.reduce((s, p) => s + getPickValue(p), 0);
  const starterOf = (t: Team) =>
    t.roster.filter((p) => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);

  const dynasties = league.teams.map((t) => ({ id: t.id, v: dynastyOf(t), team: t }));
  const yourDynasty = dynasties.find((d) => d.id === team.id)?.v ?? 0;
  const sortedDesc = [...dynasties].sort((a, b) => b.v - a.v);
  const top = sortedDesc[0]?.v ?? 0;
  const worst = sortedDesc[sortedDesc.length - 1]?.v ?? 0;
  const avg = dynasties.reduce((s, d) => s + d.v, 0) / Math.max(1, dynasties.length);
  const playoffSlots = league.playoffTeams ?? Math.max(2, Math.round(league.teams.length / 3));
  const cutoff = sortedDesc[Math.min(sortedDesc.length - 1, playoffSlots - 1)]?.v ?? avg;

  const pctDelta = (your: number, other: number) =>
    other === 0 ? 0 : Math.round(((your - other) / other) * 1000) / 10;

  const yourStarter = starterOf(team);
  const topStarter = Math.max(...league.teams.map(starterOf), 1);

  // Closest comparable — minimize absolute dynasty diff among other teams.
  const closestTeam =
    [...league.teams]
      .filter((t) => t.id !== team.id)
      .sort((a, b) => Math.abs(dynastyOf(a) - yourDynasty) - Math.abs(dynastyOf(b) - yourDynasty))[0] ?? null;

  return {
    yourDynasty,
    leagueAvgDynasty: avg,
    topDynasty: top,
    cutoffDynasty: cutoff,
    worstDynasty: worst,
    yourStarter,
    topStarter,
    vsLeagueAvgPct: pctDelta(yourDynasty, avg),
    vsTopPct: pctDelta(yourDynasty, top),
    vsCutoffPct: pctDelta(yourDynasty, cutoff),
    vsWorstPct: pctDelta(yourDynasty, worst),
    closestTeam,
  };
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
): TeamSnapshotPayload {
  const dynastyPlayers = team.roster.reduce((s, p) => s + getPlayerValue(p), 0);
  const pickValue = team.picks.reduce((s, p) => s + getPickValue(p), 0);
  const winNowValue = team.roster.filter((p) => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
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
