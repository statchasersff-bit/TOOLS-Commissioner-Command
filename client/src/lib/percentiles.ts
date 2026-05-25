/**
 * Position-agnostic percentile + composite-score primitives.
 *
 * Everything here is deliberately free of QB/RB/WR/TE assumptions so the same
 * primitives back every position's composite engine. Position-specific weights
 * and field maps live in the per-position engines (e.g. qbCompositeScores.ts).
 */

/**
 * Percentile rank (0-100) of `value` within `values`.
 * Defined as the share of the population strictly below `value`, so ties land
 * at the lower bound (conservative). Higher is better.
 */
export function percentileRank(value: number, values: number[]): number {
  if (!values.length) return 0;
  let below = 0;
  for (const v of values) if (v < value) below++;
  return Math.round((below / values.length) * 100);
}

/**
 * Inverted percentile for "lower is better" stats (INT, sacks, bad-throw %, …).
 */
export function invertedPercentile(value: number, values: number[]): number {
  return 100 - percentileRank(value, values);
}

/** Round to the nearest integer and clamp into the 0-100 score range. */
export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Coerce an unknown cell value to a finite number (missing → 0). */
export function toFiniteNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export type Direction = 'higherIsBetter' | 'lowerIsBetter';

/**
 * Precompute percentile ranks (0-100) for one field across every row, returning
 * an array aligned to `rows`. `direction` flips the scale for stats where lower
 * is better. Missing/non-numeric values are treated as the lowest value so
 * incomplete rows sink to the bottom rather than skewing the distribution.
 */
export function percentileColumn<T>(
  rows: T[],
  accessor: (row: T) => number,
  direction: Direction = 'higherIsBetter',
): number[] {
  return percentileColumnAgainst(rows, accessor, rows, direction);
}

/**
 * Like `percentileColumn`, but ranks every row in `rows` against the
 * distribution of a separate `baseline` population (e.g. only "qualified"
 * players). Lets low-sample rows still receive a score without letting them
 * define the percentile curve. Falls back to `rows` if the baseline is empty.
 */
export function percentileColumnAgainst<T, B = T>(
  rows: T[],
  accessor: (row: T | B) => number,
  baseline: B[],
  direction: Direction = 'higherIsBetter',
): number[] {
  const baseValues = (baseline.length ? baseline : (rows as unknown as B[])).map(accessor);
  return rows.map(r => {
    const v = accessor(r);
    return direction === 'lowerIsBetter'
      ? invertedPercentile(v, baseValues)
      : percentileRank(v, baseValues);
  });
}
