const PICK_VALUES: Record<string, Record<string, number>> = {
  "1": { early: 8500, mid: 7000, late: 5500 },
  "2": { early: 4500, mid: 3500, late: 2500 },
  "3": { early: 2000, mid: 1500, late: 1000 },
  "4": { early: 800, mid: 500, late: 300 },
};

const YEAR_MULTIPLIER: Record<number, number> = {
  2026: 1.0,
  2027: 0.9,
  2028: 0.8,
};

export function getStaticPickValue(
  year: number,
  round: number,
  projectedRange: "early" | "mid" | "late" = "mid"
): number {
  const roundValues = PICK_VALUES[String(round)];
  if (!roundValues) return 200;
  const base = roundValues[projectedRange] ?? roundValues["mid"];
  const yearMult = YEAR_MULTIPLIER[year] ?? 0.7;
  return Math.round(base * yearMult);
}
