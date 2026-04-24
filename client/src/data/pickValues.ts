/**
 * Exact 2026 rookie pick values by overall pick number (1-based).
 * Overall pick = (round - 1) * totalRosters + slot.
 * Source: provided trade value chart.
 */
export const PICK_2026_BY_OVERALL: Record<number, number> = {
  1: 7154, 2: 4289, 3: 4216, 4: 3881, 5: 3670, 6: 3118, 7: 2829, 8: 2561,
  9: 2561, 10: 2378, 11: 2224, 12: 2209, 13: 2055, 14: 2011, 15: 1769, 16: 1742,
  17: 1691, 18: 1678, 19: 1618, 20: 1534, 21: 1502, 22: 1418, 23: 1377, 24: 1338,
  25: 1315, 26: 1310, 27: 1298, 28: 1261, 29: 1227, 30: 1209, 31: 1116, 32: 1088,
  33: 1042, 34: 1013, 35: 1000, 36: 988, 37: 977, 38: 968, 39: 949, 40: 943,
  41: 937, 42: 903, 43: 877, 44: 863, 45: 817, 46: 806, 47: 744, 48: 726,
  49: 716, 50: 657, 51: 606, 52: 565, 53: 542, 54: 521, 55: 519, 56: 423,
  57: 409, 58: 408, 59: 362, 60: 362, 61: 329, 62: 329, 63: 322, 64: 312,
  65: 290, 66: 257, 67: 236, 68: 229, 69: 215, 70: 202,
};

/**
 * Fallback round-based buckets for future/unknown picks.
 * These are used when slot is unavailable or year != 2026.
 */
const PICK_VALUES: Record<string, Record<string, number>> = {
  "1": { early: 5000, mid: 3200, late: 2300 },
  "2": { early: 1900, mid: 1650, late: 1380 },
  "3": { early: 1300, mid: 1100, late: 1000 },
  "4": { early: 960, mid: 850, late: 730 },
};

const YEAR_MULTIPLIER: Record<number, number> = {
  2026: 1.0,
  2027: 0.88,
  2028: 0.76,
};

/**
 * Returns the value for a draft pick.
 *
 * For 2026 picks where an exact slot and league size are known, uses the
 * precise per-pick table. Otherwise falls back to round bucket × year discount.
 *
 * @param year       Pick season year
 * @param round      Round number (1-4)
 * @param range      "early" | "mid" | "late" — used for fallback only
 * @param slot       Within-round slot (1-based). Combined with totalRosters → overall pick.
 * @param totalRosters Number of teams in the league (needed to compute overall pick).
 */
export function getStaticPickValue(
  year: number,
  round: number,
  range: "early" | "mid" | "late" = "mid",
  slot?: number | null,
  totalRosters?: number | null
): number {
  if (year === 2026 && slot != null && slot > 0 && totalRosters != null && totalRosters > 0) {
    const overallPick = (round - 1) * totalRosters + slot;
    const exact = PICK_2026_BY_OVERALL[overallPick];
    if (exact != null) return exact;
    // Beyond pick 70: extrapolate gently downward
    if (overallPick > 70) return Math.max(150, Math.round(202 * Math.pow(0.97, overallPick - 70)));
  }

  const roundValues = PICK_VALUES[String(round)];
  if (!roundValues) return 200;
  const base = roundValues[range] ?? roundValues["mid"];
  const yearMult = YEAR_MULTIPLIER[year] ?? 0.65;
  return Math.round(base * yearMult);
}
