/**
 * Pure helper functions for the Trade Review Center. No I/O — these are used by
 * both the backend scoring pipeline and (conceptually) mirror the labels the UI
 * shows, so risk/fairness wording stays consistent everywhere.
 */
import type {
  ParsedTradeAsset,
  RiskLabel,
  FairnessLabel,
} from "./types";

export function getRiskLabel(score: number): RiskLabel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function getFairnessLabel(score: number): FairnessLabel {
  // score = 100 - valueDiffPct, so higher is fairer.
  if (score >= 90) return "fair";
  if (score >= 80) return "slightly_unbalanced";
  if (score >= 60) return "lopsided";
  return "severe";
}

/** Normalize an unordered roster pair so the lower id is always first. */
export function getManagerPairKey(a: number, b: number): { rosterIdA: number; rosterIdB: number } {
  return a <= b ? { rosterIdA: a, rosterIdB: b } : { rosterIdA: b, rosterIdB: a };
}

/** Sum the value each roster RECEIVED (assets where toRosterId === roster). */
export function calculateValueByRoster(assets: ParsedTradeAsset[]): Record<string, number> {
  const byRoster: Record<string, number> = {};
  for (const a of assets) {
    if (a.toRosterId == null) continue;
    const key = String(a.toRosterId);
    byRoster[key] = (byRoster[key] ?? 0) + (a.assetValue ?? 0);
  }
  return byRoster;
}

/** Group assets by the roster that received them, for side-by-side display. */
export function formatTradeAssetsByRoster(
  assets: ParsedTradeAsset[],
): Record<string, ParsedTradeAsset[]> {
  const byRoster: Record<string, ParsedTradeAsset[]> = {};
  for (const a of assets) {
    if (a.toRosterId == null) continue;
    const key = String(a.toRosterId);
    (byRoster[key] ??= []).push(a);
  }
  return byRoster;
}

/** Any pick whose season is strictly later than the current NFL season. */
export function detectFuturePicks(
  assets: ParsedTradeAsset[],
  currentSeason: number,
): ParsedTradeAsset[] {
  return assets.filter(
    (a) => a.assetType === "pick" && Number(a.pickSeason) > currentSeason,
  );
}

/** Future first-round picks specifically (the highest-leverage dynasty asset). */
export function detectPremiumFuturePicks(
  assets: ParsedTradeAsset[],
  currentSeason: number,
): ParsedTradeAsset[] {
  return detectFuturePicks(assets, currentSeason).filter((a) => Number(a.pickRound) === 1);
}

/** Any first-round pick (current or future). */
export function detectFirstRoundPicks(assets: ParsedTradeAsset[]): ParsedTradeAsset[] {
  return assets.filter((a) => a.assetType === "pick" && Number(a.pickRound) === 1);
}

/** Safe numeric coercion — never returns NaN. */
export function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
