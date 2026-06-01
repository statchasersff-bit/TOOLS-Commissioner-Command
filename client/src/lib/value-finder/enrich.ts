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
  getDynastyScore,
  getContenderScore,
  getRebuilderScore,
  getUsageScore,
  getProductionScore,
  getLongevityScore,
  getMarketInsulationScore,
  getTrendScore,
  getPpgScore,
} from "./valueModel";
import { getValueSignal } from "./valueFinderScoring";
import { classify } from "./valueFinderLabels";

/**
 * Rank-matching calibration. Assigns the i-th best score the i-th highest market
 * value in the cohort, so the SET of expected values equals the SET of market
 * values (a permutation). This makes the model market-neutral: a player only
 * shows a gap when the model ranks him differently than the market does — which
 * is exactly what a value finder should surface. Robust to the right-skew of
 * market values that a flat score×constant scaling would distort.
 */
function expectedByRank<T extends { id: string; market: number; score: number }>(
  rows: T[],
): Map<string, number> {
  const marketsDesc = rows.map((r) => r.market).sort((a, b) => b - a);
  const byScore = [...rows].sort((a, b) => b.score - a.score);
  const out = new Map<string, number>();
  byScore.forEach((r, i) => out.set(r.id, marketsDesc[i]));
  return out;
}

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

  // Pass 1 — raw sub-scores and per-purpose blended scores (0–1) per player.
  const raw = players.map((player) => {
    const cohort = cohorts[player.position] ?? [];
    const usageScore = getUsageScore(player, cohort);
    const productionScore = getProductionScore(player, cohort);
    return {
      player,
      cohort,
      marketValue: getMarketValue(player, source),
      usageScore,
      productionScore,
      longevityScore: getLongevityScore(player, cohort),
      trendScore: getTrendScore(player, cohort),
      marketInsulationScore: getMarketInsulationScore(player, cohort),
      dynastyScore: getDynastyScore(player, cohort),
      contenderScore: getContenderScore(player, cohort),
      rebuilderScore: getRebuilderScore(player, cohort),
      ppgScore: getPpgScore(player, cohort),
      usageRoleScore: usageScore ?? productionScore,
    };
  });

  // Build per-cohort rank-matched expected values for the "is the market
  // mispricing him?" lenses (dynasty / production / usage). Only players with a
  // market value participate (others can't have a gap). Contender & rebuilder are
  // handled separately below — they re-price the market through each lens.
  const KEYS = ["dynasty", "production", "usage"] as const;
  const scoreOf: Record<(typeof KEYS)[number], (r: (typeof raw)[number]) => number> = {
    dynasty: (r) => r.dynastyScore,
    production: (r) => r.ppgScore,
    usage: (r) => r.usageRoleScore,
  };
  const expected: Record<string, Map<string, number>> = {};
  for (const pos of POSITIONS) {
    const cohortRows = raw.filter(
      (r) => r.player.position === pos && r.marketValue != null,
    );
    for (const key of KEYS) {
      expected[`${pos}:${key}`] = expectedByRank(
        cohortRows.map((r) => ({
          id: r.player.playerId,
          market: r.marketValue as number,
          score: scoreOf[key](r),
        })),
      );
    }
  }
  const exp = (pos: Position, key: (typeof KEYS)[number], id: string) =>
    expected[`${pos}:${key}`]?.get(id);

  // How much a win-now / rebuild team should pay: re-price the dynasty consensus
  // value by how much each lens likes the player relative to that consensus. A
  // productive-but-old player is worth more to a contender than the age-discounting
  // dynasty value says; a young ascending player is worth more to a rebuilder.
  // Anchoring on the consensus (not raw market) avoids inheriting market mispricing.
  // K controls sensitivity; clamp keeps values sane.
  const LENS_K = 1.5;
  const reprice = (anchor: number, lensScore: number, dynastyScore: number) =>
    Math.round(
      anchor * Math.min(2.5, Math.max(0.3, 1 + LENS_K * (lensScore - dynastyScore))),
    );

  // Pass 2 — attach values, headline signal, and the recommendation label.
  const enriched = raw.map((r) => {
    const { player, marketValue } = r;
    const pos = player.position;
    const id = player.playerId;

    const dynastyValue = exp(pos, "dynasty", id);
    const productionValue = exp(pos, "production", id);
    const usageValue = exp(pos, "usage", id);
    const contenderValue =
      dynastyValue != null ? reprice(dynastyValue, r.contenderScore, r.dynastyScore) : undefined;
    const rebuilderValue =
      dynastyValue != null ? reprice(dynastyValue, r.rebuilderScore, r.dynastyScore) : undefined;

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
      usageScore: r.usageScore,
      productionScore: r.productionScore,
      longevityScore: r.longevityScore,
      trendScore: r.trendScore,
      marketInsulationScore: r.marketInsulationScore,
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
