// Value normalization helpers. Implementations follow the product spec verbatim.

export function normalizeToScale({
  value,
  min,
  max,
  targetMin = 0,
  targetMax = 10000,
}: {
  value: number;
  min: number;
  max: number;
  targetMin?: number;
  targetMax?: number;
}) {
  if (max === min) return targetMin;
  return ((value - min) / (max - min)) * (targetMax - targetMin) + targetMin;
}

export function percentileRank(value: number, values: number[]) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;

  const below = sorted.filter((v) => v <= value).length;
  return below / sorted.length;
}
