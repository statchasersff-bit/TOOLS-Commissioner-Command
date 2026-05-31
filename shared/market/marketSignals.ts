// Shared buy/sell signal logic for the Market Inefficiencies feature.
// A signal compares a player's market value against a "fair" comparison value
// (model value preferred, expected-from-production value as a fallback).
// Pure module — shared by the client page and the server API endpoint.

export type MarketTone = "buyStrong" | "buy" | "neutral" | "sell" | "sellStrong";

export type MarketSignal =
  | "Strong Buy"
  | "Buy"
  | "Fair Value"
  | "Sell"
  | "Strong Sell"
  | "Insufficient Data";

export interface MarketSignalResult {
  gap: number;
  gapPercent: number;
  signal: MarketSignal;
  tone: MarketTone;
}

export function getMarketSignal({
  marketValue,
  modelValue,
  expectedValue,
}: {
  marketValue: number;
  modelValue?: number;
  expectedValue?: number;
}): MarketSignalResult {
  const comparisonValue = modelValue ?? expectedValue;

  if (!marketValue || comparisonValue == null) {
    return { gap: 0, gapPercent: 0, signal: "Insufficient Data", tone: "neutral" };
  }

  const gap = comparisonValue - marketValue;
  const gapPercent = (gap / marketValue) * 100;

  if (gapPercent >= 25) return { gap, gapPercent, signal: "Strong Buy", tone: "buyStrong" };
  if (gapPercent >= 10) return { gap, gapPercent, signal: "Buy", tone: "buy" };
  if (gapPercent <= -25) return { gap, gapPercent, signal: "Strong Sell", tone: "sellStrong" };
  if (gapPercent <= -10) return { gap, gapPercent, signal: "Sell", tone: "sell" };
  return { gap, gapPercent, signal: "Fair Value", tone: "neutral" };
}

/** Tailwind classes per tone — used by MarketSignalBadge and bar fills. */
export const SIGNAL_STYLES: Record<MarketTone, string> = {
  buyStrong: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-300 border-emerald-500/40",
  buy:       "bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/25",
  neutral:   "bg-muted/40 text-muted-foreground border-border",
  sell:      "bg-red-500/10 text-red-600 dark-any:text-red-400 border-red-500/25",
  sellStrong:"bg-red-500/15 text-red-600 dark-any:text-red-300 border-red-500/40",
};

/** Hex fills for chart bars/dots keyed by tone (buy = green, sell = red). */
export const TONE_HEX: Record<MarketTone, string> = {
  buyStrong: "#059669",
  buy: "#10b981",
  neutral: "#94a3b8",
  sell: "#ef4444",
  sellStrong: "#dc2626",
};
