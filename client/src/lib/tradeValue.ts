/**
 * Shared trade-value math.
 *
 * A side's value in a dynasty trade is NOT a plain sum of dynasty values — two
 * adjustments apply, matching what the Trade Calculator (TradeCenter.tsx) does:
 *
 *   1. Diminishing returns — sorted high→low, each successive asset is weighted
 *      less (you can only start so many players, so the 4th piece is worth less
 *      than the 1st). DIMINISHING_WEIGHTS is the weight per rank.
 *   2. Overpay tax — if one asset is more than 35% of the raw total, the side is
 *      a top-heavy "consolidation" package and pays a small 3% premium penalty.
 *
 * Both the Trade Calculator and the Finder's Idea Generator import these so the
 * two features value a package identically. Functions take raw `number[]` value
 * lists so they're agnostic to the caller's asset shape.
 */

/** Weight applied to each asset by descending-value rank (index 0 = most valuable). */
export const DIMINISHING_WEIGHTS = [1.0, 0.85, 0.72, 0.6, 0.5, 0.42, 0.36, 0.31];

/** Diminishing-returns weight for an asset at a given (0-based) value rank. */
export function getDiminishingWeight(index: number): number {
  return index < DIMINISHING_WEIGHTS.length ? DIMINISHING_WEIGHTS[index] : 0.31;
}

/** Plain sum of values (no adjustment). */
export function rawTotal(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}

/** Sum with diminishing returns: sort high→low, weight each by its rank. */
export function adjustedTotal(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  return sorted.reduce((sum, v, i) => sum + v * getDiminishingWeight(i), 0);
}

/**
 * Overpay tax: a 3% penalty when the package is top-heavy (its single biggest
 * asset is worth more than 35% of the raw total). Mirrors the Trade Calculator.
 */
export function applyOverpayPenalty(values: number[], adjusted: number, raw: number): number {
  if (values.length === 0) return adjusted;
  const topAsset = Math.max(...values);
  if (topAsset > raw * 0.35) return adjusted * 0.97;
  return adjusted;
}

/**
 * Full adjusted value of one trade side: diminishing returns + overpay tax.
 * This is the number to compare across sides — use it anywhere you'd otherwise
 * sum dynasty values for a package.
 */
export function sideValue(values: number[]): number {
  const raw = rawTotal(values);
  return applyOverpayPenalty(values, adjustedTotal(values), raw);
}
