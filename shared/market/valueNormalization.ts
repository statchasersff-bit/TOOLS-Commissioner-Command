// Value-normalization + small math helpers for the Market Inefficiencies feature.
// Different value sources (FantasyCalc, KTC, custom) live on different scales,
// so everything funnels through normalizeToScale before being compared.
// Pure module — shared by the client page and the server API endpoint.

/** Linearly map `value` from [min,max] onto [targetMin,targetMax]. */
export function normalizeToScale(
  value: number,
  min: number,
  max: number,
  targetMin = 0,
  targetMax = 10000,
): number {
  if (max === min) return (targetMin + targetMax) / 2;
  const t = (value - min) / (max - min);
  return targetMin + t * (targetMax - targetMin);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Ordinary least-squares fit of y = slope·x + intercept. */
export function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of points) {
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/**
 * Dynasty age-curve desirability, 0..1 (1 = peak/premium, lower = age risk).
 * Curves differ by position — RBs cliff early, QBs hold value far longer.
 * Returns a neutral 0.6 when age is unknown.
 */
export function ageCurveScore(pos: string, age?: number): number {
  if (age == null || !Number.isFinite(age)) return 0.6;
  const band = (ranges: Array<[number, number]>, fallback: number): number => {
    for (const [maxAge, score] of ranges) if (age <= maxAge) return score;
    return fallback;
  };
  switch (pos) {
    case "RB":
      return band([[23, 1.0], [25, 0.9], [27, 0.6], [28, 0.4]], 0.25);
    case "WR":
      return band([[23, 1.0], [26, 0.95], [29, 0.7], [31, 0.45]], 0.3);
    case "TE":
      return band([[24, 0.85], [28, 1.0], [31, 0.7]], 0.4);
    case "QB":
      return band([[25, 1.0], [32, 0.95], [36, 0.6]], 0.35);
    default:
      return band([[24, 1.0], [28, 0.8], [31, 0.55]], 0.35);
  }
}
