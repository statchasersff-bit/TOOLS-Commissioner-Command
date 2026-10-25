/**
 * scoreTrade — compute the value distribution, fairness score, and risk score
 * for a trade from its valued assets plus a little league context.
 *
 *   fairnessScore = max(0, 100 - valueDiffPct)   (higher = fairer)
 *   riskScore     = additive points across independent risk factors, capped 100.
 *
 * Each roster's received package is run through the StatChasers trade-evaluation
 * engine (diminishing returns + package drag) so totalValueByRoster holds each
 * side's ADJUSTED value, not a raw sum. The gap is then measured off those
 * adjusted totals: for TWO-team trades valueDiffPct is the high-vs-low gap; for
 * THREE+-team trades a simple two-side gap is meaningless, so we measure the
 * spread of each roster's adjusted value around the group average instead (the
 * UI labels these "Multi-Team Trade").
 */
import type { LeagueValueSettings, ParsedTradeAsset, TradeScore } from "./types";
import {
  calculateValueByRoster,
  detectFuturePicks,
  detectPremiumFuturePicks,
  formatTradeAssetsByRoster,
} from "./helpers";
import { evaluateSide, type ValuationAsset, type ValuationContext } from "./tradeValue";

/** Extra signals that feed the risk score but aren't derivable from assets. */
export interface ScoreContext {
  currentSeason: number;
  repeatPartnerCount: number;
  /**
   * The league's valuation context (adaptive tier floors + positionRank). When
   * present, each side's value is the engine's adjusted total; when omitted, we
   * fall back to a raw per-roster sum so callers/tests without a context still
   * work.
   */
  valuationCtx?: ValuationContext;
  /** Manager on one side is flagged as orphan-risk (low activity / stripping). */
  orphanRiskManager?: boolean;
  /** A top contender is the major-value receiver. */
  topContenderReceivesMajorUpgrade?: boolean;
  /** Future-pick trade where dues for that future season look unpaid. */
  unpaidFutureDuesRisk?: boolean;
}

/** Map a parsed asset to the engine's shape (picks/FAAB omit position). */
function toValuationAsset(a: ParsedTradeAsset): ValuationAsset {
  return {
    value: a.assetValue ?? 0,
    pos: a.assetType === "player" ? a.position : undefined,
    isPick: a.assetType !== "player",
  };
}

/**
 * Adjusted value each roster RECEIVED: run that roster's received package
 * through the engine (diminishing returns + package drag).
 */
function computeAdjustedValueByRoster(
  assets: ParsedTradeAsset[],
  ctx: ValuationContext,
): Record<string, number> {
  const grouped = formatTradeAssetsByRoster(assets);
  const out: Record<string, number> = {};
  for (const [rosterId, received] of Object.entries(grouped)) {
    const sideAssets = received.map(toValuationAsset);
    out[rosterId] = Math.round(evaluateSide(sideAssets, [], ctx).adjustedTotal);
  }
  return out;
}

function computeValueSpread(totalValueByRoster: Record<string, number>): {
  valueDiffAbs: number;
  valueDiffPct: number;
} {
  const values = Object.values(totalValueByRoster);
  if (values.length < 2) return { valueDiffAbs: 0, valueDiffPct: 0 };

  if (values.length === 2) {
    const high = Math.max(...values);
    const low = Math.min(...values);
    const valueDiffAbs = high - low;
    const valueDiffPct = high > 0 ? (valueDiffAbs / high) * 100 : 0;
    return { valueDiffAbs, valueDiffPct };
  }

  // Multi-team: spread of the most-extreme roster from the group average.
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const maxDev = Math.max(...values.map((v) => Math.abs(v - avg)));
  const valueDiffPct = avg > 0 ? (maxDev / avg) * 100 : 0;
  return { valueDiffAbs: Math.round(maxDev), valueDiffPct };
}

export function scoreTrade(
  assets: ParsedTradeAsset[],
  ctx: ScoreContext,
  _settings?: LeagueValueSettings,
): TradeScore {
  const totalValueByRoster = ctx.valuationCtx
    ? computeAdjustedValueByRoster(assets, ctx.valuationCtx)
    : calculateValueByRoster(assets);
  const { valueDiffAbs, valueDiffPct } = computeValueSpread(totalValueByRoster);

  const fairnessScore = Math.max(0, Math.round(100 - valueDiffPct));

  // ── Risk score (additive, capped at 100) ──────────────────────────────────
  let risk = 0;

  // Imbalance.
  if (valueDiffPct >= 10) risk += 5;
  if (valueDiffPct >= 15) risk += 10;
  if (valueDiffPct >= 25) risk += 20;
  if (valueDiffPct >= 40) risk += 35;

  // Future picks.
  const futurePicks = detectFuturePicks(assets, ctx.currentSeason);
  const futureFirsts = detectPremiumFuturePicks(assets, ctx.currentSeason);
  if (futurePicks.length > 0) risk += 10;
  if (futureFirsts.length > 0) risk += 15;
  if (futureFirsts.length > 1) risk += 25;

  // Repeat trade partners.
  if (ctx.repeatPartnerCount >= 3) risk += 10;
  if (ctx.repeatPartnerCount >= 5) risk += 20;

  // Contextual risks (default off in MVP unless derivable).
  if (ctx.unpaidFutureDuesRisk) risk += 25;
  if (ctx.orphanRiskManager) risk += 20;
  if (ctx.topContenderReceivesMajorUpgrade) risk += 10;

  const riskScore = Math.min(100, risk);

  return {
    totalValueByRoster,
    valueDiffAbs: Math.round(valueDiffAbs),
    valueDiffPct: Math.round(valueDiffPct * 10) / 10,
    fairnessScore,
    riskScore,
  };
}
