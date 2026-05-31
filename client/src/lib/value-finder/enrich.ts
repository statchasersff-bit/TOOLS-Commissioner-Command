// Enrichment pipeline: turn raw players into fully-scored ValueFinderPlayers
// for the currently-selected value source, then filter and summarize.

import type {
  ValueFinderPlayer,
  ValueFinderFilters,
  ValueFinderSummary,
  ValueSourceVF,
  Position,
  AgeRange,
} from "./types";
import { POSITIONS } from "./types";
import {
  getMarketValue,
  calculateDynastyValue,
  calculateContenderValue,
  calculateRebuilderValue,
  getUsageScore,
  getProductionScore,
  getLongevityScore,
  getMarketInsulationScore,
  getTrendScore,
  getPpgScore,
  getMaxMarketValue,
} from "./valueModel";
import { getValueSignal } from "./valueFinderScoring";
import { classify } from "./valueFinderLabels";
import { percentileRank } from "./valueNormalization";

/**
 * Enrich every player with absolute derived values for the selected source:
 * marketValue, modelValue, usageScore, contenderValue, rebuilderValue,
 * production-based expectedValue, plus model-gap signal fields and ranks.
 */
export function enrichPlayers(
  players: ValueFinderPlayer[],
  source: ValueSourceVF,
): ValueFinderPlayer[] {
  // Group by position for cohort-relative percentiles.
  const cohorts: Record<Position, ValueFinderPlayer[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
  };
  for (const p of players) cohorts[p.position]?.push(p);

  // Cohort usage-share values per position, for the usage-implied expected value.
  const usageShareByPos: Record<Position, number[]> = {
    QB: [], RB: [], WR: [], TE: [],
  };
  for (const p of players) {
    const share = p.opportunityShare ?? p.targetShare ?? p.routeShare ?? 0;
    usageShareByPos[p.position]?.push(share);
  }

  const enriched = players.map((player) => {
    const cohort = cohorts[player.position] ?? [];
    const marketValue = getMarketValue(player, source);
    const maxMarket = getMaxMarketValue(cohort, source);

    // Sub-scores (0–1).
    const usageScore = getUsageScore(player, cohort);
    const productionScore = getProductionScore(player, cohort);
    const longevityScore = getLongevityScore(player, cohort);
    const trendScore = getTrendScore(player, cohort);
    const marketInsulationScore = getMarketInsulationScore(player, cohort);

    // Purpose-specific values (0–10,000 or market-scaled), each comparable to market.
    const dynastyValue = calculateDynastyValue(player, cohort);
    const contenderValue = calculateContenderValue(player, cohort);
    const rebuilderValue = calculateRebuilderValue(player, cohort, source);

    // Production-implied expected value: PPG percentile * max market value.
    const productionValue = Math.round(getPpgScore(player, cohort) * maxMarket);
    // Usage-implied expected value: usage-share percentile * max market value.
    const usageShare =
      player.opportunityShare ?? player.targetShare ?? player.routeShare ?? 0;
    const usagePct = percentileRank(usageShare, usageShareByPos[player.position] ?? []);
    const usageValue = Math.round(usagePct * maxMarket);

    // Headline signal uses dynasty value vs market (the "Market Gaps" lens).
    const { gap, gapPercent, signal, tone } = getValueSignal({
      marketValue,
      comparisonValue: dynastyValue,
    });

    const scored: ValueFinderPlayer = {
      ...player,
      valueSource: source,
      marketValue,
      dynastyValue,
      modelValue: dynastyValue, // back-compat alias
      usageScore,
      productionScore,
      longevityScore,
      trendScore,
      marketInsulationScore,
      contenderValue,
      rebuilderValue,
      productionValue,
      usageValue,
      expectedValue: productionValue, // back-compat alias
      gap,
      gapPercent,
      signal,
      tone,
      valueFinderScore: Math.abs(gapPercent),
    };

    // Longevity-aware recommendation.
    const { buySignals, riskSignals, bestFit, finalLabel } = classify(scored);
    scored.buySignals = buySignals;
    scored.riskSignals = riskSignals;
    scored.bestFit = bestFit;
    scored.finalLabel = finalLabel;

    return scored;
  });

  // Assign market & model ranks within the full enriched pool.
  const byMarket = [...enriched]
    .filter((p) => p.marketValue != null)
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
  byMarket.forEach((p, i) => (p.marketRank = i + 1));

  const byModel = [...enriched].sort(
    (a, b) => (b.modelValue ?? 0) - (a.modelValue ?? 0),
  );
  byModel.forEach((p, i) => (p.modelRank = i + 1));

  return enriched;
}

function ageInRange(age: number | undefined, range: AgeRange): boolean {
  if (range === "All") return true;
  if (age == null) return false;
  switch (range) {
    case "Under 23":
      return age < 23;
    case "23-25":
      return age >= 23 && age <= 25;
    case "26-28":
      return age >= 26 && age <= 28;
    case "29+":
      return age >= 29;
    default:
      return true;
  }
}

export function filterPlayers(
  players: ValueFinderPlayer[],
  filters: ValueFinderFilters,
): ValueFinderPlayer[] {
  const search = filters.search.trim().toLowerCase();
  return players.filter((p) => {
    if (filters.position !== "All" && p.position !== filters.position) return false;
    if (!ageInRange(p.age, filters.ageRange)) return false;
    if (filters.minGamesPlayed > 0 && (p.gamesPlayed ?? 0) < filters.minGamesPlayed)
      return false;
    if (
      filters.minMarketValue != null &&
      (p.marketValue ?? 0) < filters.minMarketValue
    )
      return false;
    if (search) {
      const hay = `${p.playerName} ${p.team ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/** True when no player in the pool has a market value for the active source. */
export function hasMarketValues(players: ValueFinderPlayer[]): boolean {
  return players.some((p) => p.marketValue != null && p.marketValue > 0);
}

export function computeSummary(
  players: ValueFinderPlayer[],
): ValueFinderSummary {
  const withMarket = players.filter((p) => p.marketValue && p.marketValue > 0);

  const gapPct = (p: ValueFinderPlayer, comparison?: number) =>
    getValueSignal({ marketValue: p.marketValue, comparisonValue: comparison })
      .gapPercent;

  const pickMax = (
    comparison: (p: ValueFinderPlayer) => number | undefined,
    direction: "high" | "low",
  ): ValueFinderPlayer | null => {
    let best: ValueFinderPlayer | null = null;
    let bestVal = direction === "high" ? -Infinity : Infinity;
    for (const p of withMarket) {
      const v = gapPct(p, comparison(p));
      if (direction === "high" ? v > bestVal : v < bestVal) {
        bestVal = v;
        best = p;
      }
    }
    return best;
  };

  return {
    bestBuy: pickMax((p) => p.modelValue, "high"),
    biggestSell: pickMax((p) => p.modelValue, "low"),
    bestWinNowDiscount: pickMax((p) => p.contenderValue, "high"),
    bestRebuildTarget: pickMax((p) => p.rebuilderValue, "high"),
    totalPlayers: players.length,
  };
}
