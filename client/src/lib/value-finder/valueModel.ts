// Model / usage / contender / rebuilder value computations.
// Percentile-based, position-relative. Missing metrics are handled gracefully
// (reweighting available metrics rather than zeroing the score).

import type { ValueFinderPlayer, ValueSourceVF, Position } from "./types";
import { percentileRank } from "./valueNormalization";
import { getAgeCurveScore, getContenderAgeScore } from "./ageCurveUtils";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Resolve the active market value for a player from the selected source. */
export function getMarketValue(
  player: ValueFinderPlayer,
  source: ValueSourceVF,
): number | undefined {
  switch (source) {
    case "FantasyCalc":
      return player.fantasyCalcValue;
    case "KTC":
      return player.ktcValue;
    case "Custom":
      return player.customValue;
    case "Dynasty Command":
      return player.dynastyCommandValue;
    default:
      return player.marketValue;
  }
}

/** Weighted average that ignores undefined inputs and renormalizes the weights. */
function weightedAvailable(
  pairs: Array<[value: number | undefined, weight: number]>,
): number {
  let sum = 0;
  let weightTotal = 0;
  for (const [value, weight] of pairs) {
    if (value == null || !Number.isFinite(value)) continue;
    sum += value * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return 0;
  return sum / weightTotal;
}

/**
 * Dynasty score (0–1) — the longevity-aware headline blend.
 * usage*0.25 + production*0.20 + longevity*0.30 + trend*0.15 + insulation*0.10
 */
export function getDynastyScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const usageScore = getUsageScore(player, positionPlayers) ?? 0.4;
  const productionScore = getProductionScore(player, positionPlayers);
  const longevityScore = getLongevityScore(player, positionPlayers);
  const trendScore = getTrendScore(player, positionPlayers);
  const insulationScore = getMarketInsulationScore(player, positionPlayers);

  return (
    usageScore * 0.25 +
    productionScore * 0.2 +
    longevityScore * 0.3 +
    trendScore * 0.15 +
    insulationScore * 0.1
  );
}

/** Dynasty value (0–10,000) — score scaled. (Display/back-compat.) */
export function calculateDynastyValue(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  return Math.round(getDynastyScore(player, positionPlayers) * 10000);
}

/** Back-compat alias — the model value IS the dynasty value now. */
export const calculateModelValue = calculateDynastyValue;

/** Raw PPG percentile by position (0–1), falling back to projection. */
export function getPpgScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const values = positionPlayers.map(
    (p) => p.pointsPerGame ?? p.projectedPoints ?? 0,
  );
  const raw = player.pointsPerGame ?? player.projectedPoints ?? 0;
  return percentileRank(raw, values);
}

/**
 * Composite production score (0–1): current usefulness.
 * PPG*0.40 + VOR*0.25 + StartRate*0.20 + ProductionTrend*0.15 (cohort percentiles).
 */
export function getProductionScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const ppgScore = getPpgScore(player, positionPlayers);

  const vorScore = percentileRank(
    player.vor ?? 0,
    positionPlayers.map((p) => p.vor ?? 0),
  );
  const startRateScore = percentileRank(
    player.startRate ?? 0,
    positionPlayers.map((p) => p.startRate ?? 0),
  );
  const prodTrendScore = percentileRank(
    player.productionTrend ?? player.usageTrend ?? 0,
    positionPlayers.map((p) => p.productionTrend ?? p.usageTrend ?? 0),
  );

  return weightedAvailable([
    [ppgScore, 0.4],
    [vorScore, 0.25],
    [startRateScore, 0.2],
    [prodTrendScore, 0.15],
  ]);
}

/** Position career-length constant (0–1): RBs burn out, QBs last. */
const SHELF_LIFE: Record<Position, number> = {
  QB: 1.0,
  WR: 0.8,
  TE: 0.8,
  RB: 0.55,
};

/**
 * Market insulation (0–1): inverse of recent market-value volatility within the
 * cohort. Lower swing -> better insulated -> higher score.
 */
export function getMarketInsulationScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const swing = Math.abs(
    player.marketValueChange90d ?? player.marketValueChange30d ?? 0,
  );
  const swings = positionPlayers.map((p) =>
    Math.abs(p.marketValueChange90d ?? p.marketValueChange30d ?? 0),
  );
  return 1 - percentileRank(swing, swings);
}

/**
 * Longevity score (0–1): how durable this asset's value is.
 * AgeCurve*0.40 + RoleSecurity*0.30 + MarketInsulation*0.20 + ShelfLife*0.10.
 * RoleSecurity = high, stable/rising usage. ShelfLife = position constant.
 */
export function getLongevityScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const ageCurve = getAgeCurveScore(player);
  const usageScore = getUsageScore(player, positionPlayers) ?? 0.4;
  // roleTrend is a % change; map ~[-10,+10] onto [0,1] around a neutral 0.5.
  const roleTrend = player.roleTrend ?? player.usageTrend ?? 0;
  const roleSecurity = clamp01(0.6 * usageScore + 0.4 * clamp01(0.5 + roleTrend / 20));
  const insulation = getMarketInsulationScore(player, positionPlayers);
  const shelfLife = SHELF_LIFE[player.position] ?? 0.7;

  return (
    ageCurve * 0.4 +
    roleSecurity * 0.3 +
    insulation * 0.2 +
    shelfLife * 0.1
  );
}

/** Age-adjusted upside (0–1): young players with real ceiling score highest. */
export function getAgeAdjustedUpside(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const ageCurve = getAgeCurveScore(player);
  const ceiling = Math.max(
    getProductionScore(player, positionPlayers),
    getUsageScore(player, positionPlayers) ?? 0,
  );
  return ageCurve * (0.5 + 0.5 * ceiling);
}

/** Max market value across a position cohort (for expected-value scaling). */
export function getMaxMarketValue(
  positionPlayers: ValueFinderPlayer[],
  source: ValueSourceVF,
): number {
  let max = 0;
  for (const p of positionPlayers) {
    const v = getMarketValue(p, source);
    if (v != null && v > max) max = v;
  }
  return max;
}

/**
 * Position-specific usage score (0–1). Percentile inputs are computed against the
 * cohort; missing metrics drop out of the weighted average (weights renormalize).
 */
export function getUsageScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number | undefined {
  const pos = player.position;

  const pct = (
    get: (p: ValueFinderPlayer) => number | undefined,
  ): number | undefined => {
    const raw = get(player);
    if (raw == null || !Number.isFinite(raw)) return undefined;
    const values = positionPlayers
      .map(get)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (!values.length) return undefined;
    return percentileRank(raw, values);
  };

  // Shares are already 0–1, so use them directly; counting stats get percentiled.
  const direct = (v: number | undefined) =>
    v == null || !Number.isFinite(v) ? undefined : v;

  let score: number;

  if (pos === "RB") {
    score = weightedAvailable([
      [direct(player.snapShare), 0.2],
      [direct(player.rushAttemptShare), 0.25],
      [direct(player.targetShare), 0.2],
      [pct((p) => p.redZoneTouches), 0.2],
      [direct(player.routeShare), 0.15],
    ]);
  } else if (pos === "WR" || pos === "TE") {
    score = weightedAvailable([
      [direct(player.routeShare), 0.3],
      [direct(player.targetShare), 0.3],
      [direct(player.airYardsShare), 0.2],
      [pct((p) => p.targetsPerRouteRun), 0.1],
      [pct((p) => p.redZoneTargets), 0.1],
    ]);
  } else {
    // QB
    score = weightedAvailable([
      [pct((p) => p.passAttempts), 0.35],
      [pct((p) => p.dropbacks), 0.25],
      [pct((p) => p.designedRushAttempts), 0.25],
      [direct(player.teamPassRate), 0.15],
    ]);
  }

  if (score === 0) return undefined;
  return score;
}

/** Trend score (0–1) by position cohort, preferring usage trend. */
export function getTrendScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const values = positionPlayers.map(
    (p) => p.usageTrend ?? p.productionTrend ?? 0,
  );
  const raw = player.usageTrend ?? player.productionTrend ?? 0;
  return percentileRank(raw, values);
}

/** Usage-trend score (0–1) by position cohort. */
function getUsageTrendScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const values = positionPlayers.map((p) => p.usageTrend ?? p.roleTrend ?? 0);
  const raw = player.usageTrend ?? player.roleTrend ?? 0;
  return percentileRank(raw, values);
}

/**
 * Contender score (0–1), tuned for win-now rosters.
 * production*0.35 + usage*0.30 + startRate*0.20 + trend*0.10 + longevity(age)*0.05
 * Longevity weight is small and uses the lenient contender age score so productive
 * veterans are not punished.
 */
export function getContenderScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const productionScore = getProductionScore(player, positionPlayers);

  const startRates = positionPlayers
    .map((p) => p.startRate)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const startRateScore =
    player.startRate != null
      ? percentileRank(player.startRate, startRates)
      : productionScore; // fall back to production when start data is missing

  const usageScore = getUsageScore(player, positionPlayers) ?? productionScore;
  const ageScore = getContenderAgeScore(player);
  const trendScore = getTrendScore(player, positionPlayers);

  return (
    productionScore * 0.35 +
    usageScore * 0.3 +
    startRateScore * 0.2 +
    trendScore * 0.1 +
    ageScore * 0.05
  );
}

export function calculateContenderValue(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  return Math.round(getContenderScore(player, positionPlayers) * 10000);
}

/**
 * Rebuilder score (0–1), tuned for long-term builds.
 * longevity*0.35 + usageGrowth*0.25 + ageAdjustedUpside*0.20
 *   + marketInsulation*0.10 + productionFlash*0.10
 */
export function getRebuilderScore(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
): number {
  const longevityScore = getLongevityScore(player, positionPlayers);
  const usageGrowthScore = getUsageTrendScore(player, positionPlayers);
  const ageAdjustedUpside = getAgeAdjustedUpside(player, positionPlayers);
  const marketInsulationScore = getMarketInsulationScore(player, positionPlayers);
  const productionFlash = getPpgScore(player, positionPlayers);

  return (
    longevityScore * 0.35 +
    usageGrowthScore * 0.25 +
    ageAdjustedUpside * 0.2 +
    marketInsulationScore * 0.1 +
    productionFlash * 0.1
  );
}

export function calculateRebuilderValue(
  player: ValueFinderPlayer,
  positionPlayers: ValueFinderPlayer[],
  source: ValueSourceVF,
): number {
  return Math.round(getRebuilderScore(player, positionPlayers) * 10000);
}
