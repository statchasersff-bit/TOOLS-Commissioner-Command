/**
 * Trade value service — assigns a numeric value to every traded asset.
 *
 * Value sourcing priority (Phase 1):
 *   1. FantasyCalc dynasty values (the app's existing, cached source). Its
 *      `valuesBySleeperId` map already contains BOTH players (keyed by Sleeper
 *      id) AND picks (keyed like "FP_2027_1"), so it covers most assets.
 *   2. A static pick-value baseline table when FantasyCalc lacks a pick.
 *   3. A small positional fallback for players FantasyCalc doesn't know.
 *
 * League-setting adjustments (superflex QB premium, TE-premium, etc.) are applied
 * on top of the base value. Picks are discounted the further out they are.
 *
 * Hooks left for later: per-team early/mid/late pick valuation once standings /
 * projected Max PF are available, and a custom user value set selector.
 */
import { getFantasyCalcValues } from "../../fantasycalc";
import { createValuationContext, type ValuationContext } from "./tradeValue";
import type { LeagueValueSettings, ParsedTradeAsset } from "./types";

// Baseline rookie-pick values by round (mid-round assumption). Used only when
// FantasyCalc has no value for the pick. Tuned to the spec's MVP table.
const PICK_BASE_VALUES: Record<number, number> = {
  1: 4500,
  2: 2200,
  3: 1000,
  4: 450,
  5: 150,
};

// Future picks lose value the further out they are (uncertainty + time value).
const FUTURE_DISCOUNT_PER_YEAR = 0.88;

// $1 of FAAB ≈ this much trade value. Small but nonzero so FAAB-laden trades
// still register, without letting FAAB dominate a player/pick valuation.
const FAAB_VALUE_PER_DOLLAR = 8;

// Crude positional fallback for players FantasyCalc doesn't recognize (deep
// stashes, just-signed UDFAs). Keeps the pipeline from valuing them at 0.
const POSITION_FALLBACK: Record<string, number> = {
  QB: 600,
  RB: 500,
  WR: 500,
  TE: 400,
  K: 50,
  DEF: 50,
};

export interface AssetValue {
  value: number;
  source: string;
}

let cachedFcFormat: string | null = null;
let cachedFcMap: Record<string, number> | null = null;

/** Load (and memoize per format) the FantasyCalc value map for a run. */
async function loadFantasyCalcMap(format: string): Promise<Record<string, number>> {
  if (cachedFcMap && cachedFcFormat === format) return cachedFcMap;
  try {
    const fc = await getFantasyCalcValues(format);
    cachedFcMap = fc.valuesBySleeperId ?? {};
    cachedFcFormat = format;
  } catch (err) {
    console.warn("[TradeReview] FantasyCalc values unavailable, using fallbacks:", err);
    cachedFcMap = {};
    cachedFcFormat = format;
  }
  return cachedFcMap;
}

function applyLeagueAdjustments(
  value: number,
  position: string | undefined,
  settings: LeagueValueSettings,
): number {
  let v = value;
  const pos = (position ?? "").toUpperCase();
  if (settings.superflex && pos === "QB") v *= 1.25;
  if (settings.tep && pos === "TE") v *= 1.15;
  // Best-ball removes weekly start/sit risk, so depth pieces hold a touch more.
  if (settings.bestBall && (pos === "RB" || pos === "WR")) v *= 1.03;
  return v;
}

function pickFantasyCalcKey(season: string | number, round: number): string {
  // FantasyCalc keys future picks as FP_<season>_<round>.
  return `FP_${season}_${round}`;
}

function staticPickValue(season: string, round: number, currentSeason: number): number {
  const base = PICK_BASE_VALUES[round] ?? 100;
  const yearsOut = Number(season) - currentSeason;
  const discount = Math.pow(FUTURE_DISCOUNT_PER_YEAR, Math.max(0, yearsOut));
  return Math.round(base * discount);
}

/** Resolve a single asset's value. Defensive — never throws, never returns NaN. */
export async function valueForAsset(
  asset: ParsedTradeAsset,
  opts: { format: string; settings: LeagueValueSettings; currentSeason: number },
): Promise<AssetValue> {
  const fcMap = await loadFantasyCalcMap(opts.format);

  if (asset.assetType === "faab") {
    const amount = Number(asset.faabAmount ?? 0);
    return { value: Math.max(0, Math.round(amount * FAAB_VALUE_PER_DOLLAR)), source: "faab" };
  }

  if (asset.assetType === "pick") {
    const season = asset.pickSeason ?? String(opts.currentSeason);
    const round = Number(asset.pickRound ?? 0);
    const fcKey = pickFantasyCalcKey(season, round);
    if (fcMap[fcKey] != null) {
      return { value: Math.round(fcMap[fcKey]), source: "fantasycalc" };
    }
    return { value: staticPickValue(season, round, opts.currentSeason), source: "pick_table" };
  }

  // Player.
  if (asset.playerId && fcMap[asset.playerId] != null) {
    const adjusted = applyLeagueAdjustments(fcMap[asset.playerId], asset.position, opts.settings);
    return { value: Math.round(adjusted), source: "fantasycalc" };
  }
  const fallback = POSITION_FALLBACK[(asset.position ?? "").toUpperCase()] ?? 100;
  const adjusted = applyLeagueAdjustments(fallback, asset.position, opts.settings);
  return { value: Math.round(adjusted), source: "fallback" };
}

/** Value every asset in-place (mutates assetValue / assetValueSource). */
export async function valueAssets(
  assets: ParsedTradeAsset[],
  opts: { format: string; settings: LeagueValueSettings; currentSeason: number },
): Promise<ParsedTradeAsset[]> {
  for (const a of assets) {
    const { value, source } = await valueForAsset(a, opts);
    a.assetValue = value;
    a.assetValueSource = source;
  }
  return assets;
}

/**
 * Build the trade-evaluation ValuationContext for a league.
 *
 * The engine's adaptive tier floors are percentiles of the LIVE value
 * distribution, so the universe must be the full FantasyCalc player list for the
 * format — and on the SAME scale as the trade assets. We therefore apply the
 * identical league adjustments (superflex/TE-premium/best-ball) to each player
 * that valueForAsset applies, so positionRank lines up with the asset values.
 *
 * Degrades gracefully: if FantasyCalc is unavailable the empty universe makes
 * createValuationContext fall back to its fixed value floors.
 */
export async function buildValuationContext(
  format: string,
  settings: LeagueValueSettings,
): Promise<ValuationContext> {
  let players: Array<{ pos: string; value: number }> = [];
  try {
    const fc = await getFantasyCalcValues(format);
    players = (fc.players ?? []).map((p) => ({ pos: p.pos, value: p.value }));
  } catch (err) {
    console.warn("[TradeReview] FantasyCalc universe unavailable, using fallback floors:", err);
  }
  const ranked = players
    .filter((p) => p.value > 0)
    .map((p) => ({ pos: p.pos, value: applyLeagueAdjustments(p.value, p.pos, settings) }));
  return createValuationContext(ranked, {
    format: format === "sf" ? "SF" : "1QB",
    tePremium: settings.tep,
  });
}

/** Reset the in-process FantasyCalc cache (used between large backfills/tests). */
export function _resetValueCache(): void {
  cachedFcMap = null;
  cachedFcFormat = null;
}
