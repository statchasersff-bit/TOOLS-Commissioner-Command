/**
 * tradeValue — StatChasers' trade-evaluation engine (pure functions, no I/O).
 *
 * A side's value is NOT the plain sum of its assets. Two discounts are applied,
 * in order:
 *   1. Diminishing returns (depth discount): assets sorted high→low, each
 *      successive piece weighted less — tier-aware (studs barely decay) and
 *      value-proximity-aware (two near-equal studs both barely decay).
 *   2. Package drag (junk discount): a multiplier (0.90–1.0) by tier composition.
 *
 * There is intentionally NO consolidation premium — a single player is never
 * worth more than its own number — so a 1-for-2 of near-equal studs correctly
 * reads as a win for the 2-player side.
 *
 * The verdict comes from the percentage gap between the two sides' ADJUSTED
 * totals. Decide with adjustedTotal, never rawTotal (rawTotal is transparency
 * only).
 */

export type Position = "QB" | "RB" | "WR" | "TE" | "PICK";
export type Format = "SF" | "1QB";
export type StarTier = "cornerstone" | "elite" | "nearElite" | "none";
export type AssetTier = "cornerstone" | "elite" | "nearElite" | "starter" | "depth" | "throwIn";
export type PackageQuality = "single" | "elite" | "premium" | "balanced" | "depth" | "junk";

const PREMIUM_TIERS: ReadonlySet<AssetTier> = new Set<AssetTier>(["cornerstone", "elite", "nearElite"]);
const LOW_TIERS: ReadonlySet<AssetTier> = new Set<AssetTier>(["depth", "throwIn"]);

/** Weight applied to each asset by descending-value rank (index 0 = most valuable). */
export const DIMINISHING_WEIGHTS = [1.0, 0.85, 0.72, 0.6, 0.5, 0.42, 0.36, 0.31];

export function getDiminishingWeight(index: number): number {
  return index < DIMINISHING_WEIGHTS.length ? DIMINISHING_WEIGHTS[index] : 0.31;
}

/**
 * Per-tier RETENTION FLOOR: the minimum fraction of an asset's value that
 * survives the depth discount. Effective weight = max(slotWeight, tierFloor).
 */
const TIER_RETENTION: Record<AssetTier, number> = {
  cornerstone: 0.95,
  elite: 0.9,
  nearElite: 0.85,
  starter: 0.8,
  depth: 0,
  throwIn: 0,
};

/** Plain sum of values (no adjustment). Reference/transparency only. */
export function rawTotal(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}

/** Trade-fairness thresholds, as a fraction of the LARGER adjusted side. */
export const FAIR_DIFF_PCT = 0.06;
export const SLIGHT_DIFF_PCT = 0.2;

/** Gap between two adjusted side totals as a fraction of the larger (0–1). */
export function tradeDiffPct(adjA: number, adjB: number): number {
  return Math.abs(adjA - adjB) / Math.max(adjA, adjB, 1);
}

/** Tier-blind diminishing sum — coarse reference only. */
export function adjustedTotal(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  return sorted.reduce((sum, v, i) => sum + v * getDiminishingWeight(i), 0);
}

/**
 * Within this value gap to the side's best asset, a premium piece is treated as
 * essentially as startable as the best asset. gap = (top − v) / top.
 */
const PROXIMITY_WINDOW = 0.15;

/**
 * Tier-aware diminishing returns: each asset's weight is the GREATER of its slot
 * weight and its (proximity-lifted) tier retention floor.
 */
function tierAwareDiminishingTotal(assets: ValuationAsset[], tiers: AssetTier[]): number {
  const paired = assets
    .map((a, i) => ({ value: a.value, tier: tiers[i] }))
    .sort((x, y) => y.value - x.value);
  const topValue = paired.length ? paired[0].value : 0;
  return paired.reduce((sum, p, i) => {
    let tierFloor = TIER_RETENTION[p.tier] ?? 0;
    if (i > 0 && topValue > 0 && PREMIUM_TIERS.has(p.tier)) {
      const gap = (topValue - p.value) / topValue;
      const closeness = Math.max(0, 1 - gap / PROXIMITY_WINDOW);
      tierFloor = Math.max(tierFloor, tierFloor + (1 - tierFloor) * closeness);
    }
    const weight = Math.max(getDiminishingWeight(i), tierFloor);
    return sum + p.value * weight;
  }, 0);
}

/** Package drag multiplier on the post-diminishing total, by tier composition. */
export function packageDragMultiplier(tiers: AssetTier[]): number {
  const n = tiers.length;
  if (n <= 2) return 1.0;
  const premiumCount = tiers.filter((t) => PREMIUM_TIERS.has(t)).length;
  const throwInCount = tiers.filter((t) => LOW_TIERS.has(t)).length;

  if (premiumCount >= 3) return 0.98;
  if (premiumCount >= 2 && n <= 4) return 0.96;
  if (throwInCount >= 2) return 0.92;
  if (n >= 5) return 0.9;
  return 0.95;
}

/** Human-readable package shape from its tier composition. */
export function getPackageQuality(tiers: AssetTier[]): PackageQuality {
  const n = tiers.length;
  if (n <= 1) return "single";
  const premiumCount = tiers.filter((t) => PREMIUM_TIERS.has(t)).length;
  const throwInCount = tiers.filter((t) => LOW_TIERS.has(t)).length;
  if (premiumCount >= 3) return "elite";
  if (premiumCount >= 2) return "premium";
  if (throwInCount >= Math.ceil(n / 2)) return "junk";
  if (premiumCount === 0 && throwInCount >= 1) return "depth";
  return "balanced";
}

interface PositionTierLimits {
  cornerstone: number;
  elite: number;
  nearElite: number;
}

const SUPERFLEX_ELITE_TIERS: Record<Exclude<Position, "PICK">, PositionTierLimits> = {
  QB: { cornerstone: 3, elite: 8, nearElite: 14 },
  RB: { cornerstone: 3, elite: 8, nearElite: 14 },
  WR: { cornerstone: 5, elite: 12, nearElite: 20 },
  TE: { cornerstone: 2, elite: 4, nearElite: 8 },
};

const ONE_QB_ELITE_TIERS: Record<Exclude<Position, "PICK">, PositionTierLimits> = {
  QB: { cornerstone: 1, elite: 3, nearElite: 6 },
  RB: { cornerstone: 3, elite: 8, nearElite: 14 },
  WR: { cornerstone: 5, elite: 12, nearElite: 20 },
  TE: { cornerstone: 2, elite: 4, nearElite: 8 },
};

export const PERCENTILE_FLOORS = {
  cornerstone: 0.92,
  elite: 0.85,
  nearElite: 0.75,
  starter: 0.5,
  depth: 0.25,
};
export const FALLBACK_VALUE_FLOORS = {
  cornerstone: 8000,
  elite: 6500,
  nearElite: 5000,
  starter: 3000,
  depth: 1500,
};

export interface ValuationContext {
  format: Format;
  tePremium: boolean;
  positionRank: (pos: string, value: number) => number;
  floors: { cornerstone: number; elite: number; nearElite: number; starter: number; depth: number };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Infinity;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** Build a ValuationContext from the live ranked value list. */
export function createValuationContext(
  ranked: Array<{ pos: string; value: number }>,
  opts: { format: Format; tePremium?: boolean },
): ValuationContext {
  const byPos = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of ranked) {
    if (!(r.value > 0)) continue;
    all.push(r.value);
    const key = (r.pos || "").toUpperCase();
    const arr = byPos.get(key);
    if (arr) arr.push(r.value);
    else byPos.set(key, [r.value]);
  }

  Array.from(byPos.values()).forEach((arr) => arr.sort((a, b) => b - a));
  const allAsc = [...all].sort((a, b) => a - b);

  const hasDistribution = allAsc.length >= 20;
  const floors = hasDistribution
    ? {
        cornerstone: percentile(allAsc, PERCENTILE_FLOORS.cornerstone),
        elite: percentile(allAsc, PERCENTILE_FLOORS.elite),
        nearElite: percentile(allAsc, PERCENTILE_FLOORS.nearElite),
        starter: percentile(allAsc, PERCENTILE_FLOORS.starter),
        depth: percentile(allAsc, PERCENTILE_FLOORS.depth),
      }
    : { ...FALLBACK_VALUE_FLOORS };

  const positionRank = (pos: string, value: number): number => {
    const arr = byPos.get((pos || "").toUpperCase());
    if (!arr || arr.length === 0) return Number.MAX_SAFE_INTEGER;
    let greater = 0;
    for (const v of arr) {
      if (v > value) greater++;
      else break;
    }
    return greater + 1;
  };

  return { format: opts.format, tePremium: !!opts.tePremium, positionRank, floors };
}

/** A trade asset as the model sees it. Picks set isPick (and usually omit pos). */
export interface ValuationAsset {
  value: number;
  pos?: string;
  isPick?: boolean;
}

export function getStarTier(asset: ValuationAsset, ctx: ValuationContext): StarTier {
  const v = asset.value;
  if (asset.isPick || !asset.pos) {
    if (v >= ctx.floors.cornerstone) return "nearElite";
    return "none";
  }
  const pos = asset.pos.toUpperCase();
  const tiers = ctx.format === "SF" ? SUPERFLEX_ELITE_TIERS : ONE_QB_ELITE_TIERS;
  const limits = (tiers as Record<string, PositionTierLimits>)[pos];
  if (!limits) return "none";
  const rank = ctx.positionRank(pos, v);
  const eliteLimit = pos === "TE" && ctx.tePremium ? limits.elite + 2 : limits.elite;
  if (rank <= limits.cornerstone && v >= ctx.floors.cornerstone) return "cornerstone";
  if (rank <= eliteLimit && v >= ctx.floors.elite) return "elite";
  if (rank <= limits.nearElite && v >= ctx.floors.nearElite) return "nearElite";
  return "none";
}

export function classifyAssetTier(asset: ValuationAsset, ctx: ValuationContext): AssetTier {
  const star = getStarTier(asset, ctx);
  if (star !== "none") return star;
  const v = asset.value;
  if (v >= ctx.floors.starter) return "starter";
  if (v >= ctx.floors.depth) return "depth";
  return "throwIn";
}

export interface SideBreakdown {
  diminishingReturnsAmount: number;
  packageDragMultiplier: number;
  packageDragAmount: number;
  netAdjustment: number;
  topTier: AssetTier;
  topAssetValue: number;
  tiers: AssetTier[];
  packageQuality: PackageQuality;
}

export interface SideResult {
  rawTotal: number;
  adjustedTotal: number;
  breakdown: SideBreakdown;
}

/** Full adjusted value of one side: raw → diminishing returns → package drag. */
export function evaluateSide(
  assets: ValuationAsset[],
  _otherAssets: ValuationAsset[],
  ctx: ValuationContext,
): SideResult {
  const values = assets.map((a) => a.value);
  const raw = rawTotal(values);

  const tiers = assets.map((a) => classifyAssetTier(a, ctx));
  const afterDiminishing = tierAwareDiminishingTotal(assets, tiers);
  const dragMult = packageDragMultiplier(tiers);
  const afterDrag = afterDiminishing * dragMult;

  const sideTop = values.length ? Math.max(...values) : 0;
  let topTier: AssetTier = "throwIn";
  if (values.length > 0) {
    const topAsset = assets.reduce((best, a) => (a.value > best.value ? a : best), assets[0]);
    topTier = classifyAssetTier(topAsset, ctx);
  }

  return {
    rawTotal: raw,
    adjustedTotal: afterDrag,
    breakdown: {
      diminishingReturnsAmount: afterDiminishing - raw,
      packageDragMultiplier: dragMult,
      packageDragAmount: afterDrag - afterDiminishing,
      netAdjustment: afterDrag - raw,
      topTier,
      topAssetValue: sideTop,
      tiers,
      packageQuality: getPackageQuality(tiers),
    },
  };
}
