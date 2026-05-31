// Trend accessors shared by the Trend Radar chart and tables.

import type { ValueFinderPlayer, TrendWindow } from "./types";

/** Market value % change for the selected window (falls back across windows). */
export function getMarketTrend(p: ValueFinderPlayer, window: TrendWindow): number {
  switch (window) {
    case "7D":
      return p.marketValueChange7d ?? p.marketValueChange30d ?? p.marketValueChange90d ?? 0;
    case "30D":
      return p.marketValueChange30d ?? p.marketValueChange90d ?? p.marketValueChange7d ?? 0;
    case "90D":
      return p.marketValueChange90d ?? p.marketValueChange30d ?? p.marketValueChange7d ?? 0;
    default:
      return 0;
  }
}

/** Role/production trend, preferring role then usage then production. */
export function getRoleTrend(p: ValueFinderPlayer): number {
  return p.roleTrend ?? p.usageTrend ?? p.productionTrend ?? 0;
}

export function getProductionTrend(p: ValueFinderPlayer): number {
  return p.productionTrend ?? p.usageTrend ?? 0;
}
