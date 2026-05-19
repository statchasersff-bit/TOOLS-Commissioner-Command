/**
 * Start/Sit Compare helpers — pure math + classification.
 *
 * These functions take in normalized projection data (the same shape returned
 * by useWeeklyPlayerProjections, mock today, real later) and produce the
 * derived values shown in the comparison UI.
 */

import type {
  MockPlayerWeekly,
  ProjectionSource,
} from "@/data/mockStartSitProjections";

export type StartSitRecommendation =
  | "Strong Start"
  | "Start"
  | "Lean Start"
  | "Toss-Up"
  | "Sit";

export type RiskLevel = "low" | "medium" | "high";

export interface ProjectionRange {
  high: number | null;
  low: number | null;
  range: number | null;
}

/** Average of non-null projections. Returns null if no source has data. */
export function calculateAverageProjection(sources: ProjectionSource[]): number | null {
  const nums = sources
    .map((s) => s.projectedPoints)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

/** High/low/range across non-null projections. */
export function calculateProjectionRange(sources: ProjectionSource[]): ProjectionRange {
  const nums = sources
    .map((s) => s.projectedPoints)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  if (nums.length === 0) return { high: null, low: null, range: null };
  const high = Math.max(...nums);
  const low = Math.min(...nums);
  return { high, low, range: high - low };
}

/**
 * Recommendation logic for a player in the context of the *current comparison*.
 *
 * Inputs are the player's average projection, plus the averages of *all*
 * players being compared (1–3). This lets us label Strong Start vs Toss-Up
 * relative to the alternatives, not in a vacuum.
 *
 * Mock heuristic (front-end only) — real model lives behind the future API.
 */
export function calculateStartSitRecommendation(opts: {
  averageProjection: number | null;
  comparedAverages: (number | null)[];
  projectionRange: number | null;
  matchupRankVsPos?: number | null;
}): StartSitRecommendation {
  const { averageProjection, comparedAverages } = opts;
  if (averageProjection == null) return "Toss-Up";

  const others = comparedAverages.filter((n): n is number => typeof n === "number");
  // Only one player selected → no relative call; lean on absolute projection.
  if (others.length <= 1) {
    if (averageProjection >= 18) return "Strong Start";
    if (averageProjection >= 13) return "Start";
    if (averageProjection >= 9)  return "Lean Start";
    if (averageProjection >= 6)  return "Toss-Up";
    return "Sit";
  }

  const max = Math.max(...others);
  const min = Math.min(...others);

  // Top of group by 3+ pts → Strong Start
  if (averageProjection >= max && averageProjection - secondBest(others, averageProjection) >= 3) {
    return "Strong Start";
  }
  // Top of group by 1–3 pts → Start
  if (averageProjection >= max && averageProjection - secondBest(others, averageProjection) >= 1) {
    return "Start";
  }
  // Within 1 pt of leader → Toss-Up
  if (max - averageProjection < 1) {
    return "Toss-Up";
  }
  // Bottom of group by 2+ pts → Sit
  if (averageProjection <= min && secondWorst(others, averageProjection) - averageProjection >= 2) {
    return "Sit";
  }
  // Otherwise → Lean Start
  return "Lean Start";
}

function secondBest(values: number[], selfValue: number): number {
  // Find the next-best value excluding the player's own (assume self appears
  // once in the array). If self not present, just return the second-max.
  const sorted = [...values].sort((a, b) => b - a);
  for (const v of sorted) {
    if (v < selfValue || (v === selfValue && sorted.indexOf(v) !== sorted.lastIndexOf(v))) {
      return v;
    }
  }
  return sorted[sorted.length - 1] ?? selfValue;
}

function secondWorst(values: number[], selfValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  for (const v of sorted) {
    if (v > selfValue || (v === selfValue && sorted.indexOf(v) !== sorted.lastIndexOf(v))) {
      return v;
    }
  }
  return sorted[sorted.length - 1] ?? selfValue;
}

/**
 * 0–100 confidence score. Higher = more confident in the recommendation.
 * Mock heuristic combining:
 *  - absolute projection level
 *  - separation from compared players
 *  - projection range (lower spread = higher confidence)
 *  - matchup rank vs position (worse defense = higher confidence)
 *  - role stability bump
 */
export function calculateConfidenceScore(opts: {
  averageProjection: number | null;
  comparedAverages: (number | null)[];
  projectionRange: number | null;
  matchupRankVsPos?: number | null;
  roleStability?: "stable" | "mixed" | "volatile";
}): number {
  const {
    averageProjection,
    comparedAverages,
    projectionRange,
    matchupRankVsPos,
    roleStability,
  } = opts;
  if (averageProjection == null) return 0;

  // Base on absolute projection — scaled to 0–60.
  let score = Math.min(60, (averageProjection / 25) * 60);

  // Separation bonus: up to +20.
  const others = comparedAverages.filter((n): n is number => typeof n === "number");
  if (others.length > 1) {
    const max = Math.max(...others);
    const diff = averageProjection - secondBest(others, averageProjection);
    if (averageProjection >= max) {
      score += Math.min(20, diff * 5);
    } else {
      score -= Math.min(15, (max - averageProjection) * 4);
    }
  }

  // Projection range penalty: wider spread = less confident.
  if (projectionRange != null) {
    score -= Math.min(10, projectionRange * 2);
  }

  // Matchup bump: lower rank (worse defense) = up to +10.
  if (matchupRankVsPos != null) {
    score += Math.min(10, Math.max(-5, (matchupRankVsPos - 16) * 0.6));
  }

  // Role stability bump.
  if (roleStability === "stable")   score += 4;
  if (roleStability === "volatile") score -= 6;

  return clamp(Math.round(score), 0, 100);
}

export function riskLevelFromConfidence(score: number): RiskLevel {
  if (score >= 70) return "low";
  if (score >= 45) return "medium";
  return "high";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Build a complete derived snapshot for one player in a comparison context. */
export function derivePlayerComparison(
  player: MockPlayerWeekly,
  comparedAverages: (number | null)[],
) {
  const avg = calculateAverageProjection(player.projections);
  const { high, low, range } = calculateProjectionRange(player.projections);
  const recommendation = calculateStartSitRecommendation({
    averageProjection: avg,
    comparedAverages,
    projectionRange: range,
    matchupRankVsPos: player.matchup.opponentRankVsPos,
  });
  const confidence = calculateConfidenceScore({
    averageProjection: avg,
    comparedAverages,
    projectionRange: range,
    matchupRankVsPos: player.matchup.opponentRankVsPos,
    roleStability: player.roleStability,
  });
  return {
    averageProjection: avg,
    highProjection: high,
    lowProjection: low,
    projectionRange: range,
    recommendation,
    confidence,
    risk: riskLevelFromConfidence(confidence),
  };
}
