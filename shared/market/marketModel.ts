// Builds the normalized MarketPlayer dataset the Market Inefficiencies feature
// renders. We work from data the app already has: dynasty market value
// (FantasyCalc/KTC/custom), redraft value (a win-now production proxy), age,
// position and team. Seasonal projected/actual points aren't available yet, so
// "production" is the redraft value and "model value" is a placeholder blend of
// normalized production + an age-curve score, rescaled to the market-value
// range so gaps are directly comparable.
//
// Pure module — shared by the client page (fed from ValueModelContext) and the
// server API endpoint (fed from FantasyCalc/KTC payloads). Both inputs share the
// same structural shape, captured by MarketInput.

import { ageCurveScore, linearRegression, normalizeToScale } from "./valueNormalization";
import { getMarketSignal, type MarketSignal, type MarketTone } from "./marketSignals";

export const MARKET_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type MktPos = (typeof MARKET_POSITIONS)[number];

/** Chart dot colors by position (QB red / RB green / WR blue / TE yellow). */
export const POSITION_COLORS: Record<MktPos, string> = {
  QB: "#ef4444",
  RB: "#10b981",
  WR: "#3b82f6",
  TE: "#eab308",
};

/**
 * Minimal player shape buildMarketPlayers needs. Both the client's RankedPlayer
 * and the server's FantasyCalc/KTC player rows are structurally assignable.
 */
export interface MarketInput {
  sleeperId: string;
  name: string;
  pos: string;
  team?: string;
  value: number;
  age?: number;
  /** Games played in the selected season (drives the Min GP filter). */
  gamesPlayed?: number;
}

export interface MarketPlayer {
  playerId: string;
  playerName: string;
  position: MktPos;
  team?: string;
  age?: number;
  /** Games played in the selected season (drives the Min GP filter). */
  gamesPlayed?: number;

  marketValue: number;
  marketRank?: number;
  valueSource?: string;

  modelValue?: number;
  modelRank?: number;

  /** Redraft (win-now) value used as a production proxy. */
  production?: number;
  /** Expected market value from the production regression (Value vs Production tab). */
  expectedValue?: number;
  ageScore?: number;

  /** Model-based gap = modelValue − marketValue. */
  gap?: number;
  gapPercent?: number;
  signal?: MarketSignal;
  tone?: MarketTone;
}

export interface MarketSummary {
  bestBuy: MarketPlayer | null;
  biggestSell: MarketPlayer | null;
  largestGap: MarketPlayer | null;
  totalPlayers: number;
}

function isMktPos(pos: string): pos is MktPos {
  return (MARKET_POSITIONS as readonly string[]).includes(pos);
}

/**
 * Turn a ranked player list + redraft values into the normalized dataset.
 * Market value comes from the active dynasty source; production from redraft.
 */
export function buildMarketPlayers(
  inputs: MarketInput[],
  redraftBySleeperId: Record<string, number>,
  sourceLabel: string,
): MarketPlayer[] {
  const base = inputs
    .filter((r) => isMktPos(r.pos) && r.value > 0)
    .map((r) => ({
      playerId: r.sleeperId,
      playerName: r.name,
      position: r.pos as MktPos,
      team: r.team || undefined,
      age: r.age && r.age > 0 ? r.age : undefined,
      gamesPlayed: r.gamesPlayed,
      marketValue: r.value,
      valueSource: sourceLabel,
      production: redraftBySleeperId[r.sleeperId] ?? 0,
    }));

  if (!base.length) return [];

  // Market rank (1 = most valuable).
  const byMarket = [...base].sort((a, b) => b.marketValue - a.marketValue);
  const marketRank = new Map(byMarket.map((p, i) => [p.playerId, i + 1]));

  // Normalize production for the model blend.
  const prodVals = base.map((p) => p.production);
  const minProd = Math.min(...prodVals);
  const maxProd = Math.max(...prodVals);

  const marketVals = base.map((p) => p.marketValue);
  const minMkt = Math.min(...marketVals);
  const maxMkt = Math.max(...marketVals);

  // Placeholder model value: normalized production + age-curve score.
  const withRaw = base.map((p) => {
    const prodNorm = maxProd > minProd ? (p.production - minProd) / (maxProd - minProd) : 0.5;
    const ageScore = ageCurveScore(p.position, p.age);
    const modelRaw = prodNorm * 0.65 + ageScore * 0.35;
    return { ...p, ageScore, modelRaw };
  });
  const rawVals = withRaw.map((p) => p.modelRaw);
  const minRaw = Math.min(...rawVals);
  const maxRaw = Math.max(...rawVals);

  // Expected market value from production (only players with real production).
  const regPoints = withRaw
    .filter((p) => p.production > 0)
    .map((p) => ({ x: p.production, y: p.marketValue }));
  const { slope, intercept } = linearRegression(regPoints);

  const players: MarketPlayer[] = withRaw.map((p) => {
    const modelValue = Math.round(normalizeToScale(p.modelRaw, minRaw, maxRaw, minMkt, maxMkt));
    const expectedValue = p.production > 0
      ? Math.max(0, Math.round(slope * p.production + intercept))
      : undefined;
    const sig = getMarketSignal({ marketValue: p.marketValue, modelValue });
    return {
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      team: p.team,
      age: p.age,
      gamesPlayed: p.gamesPlayed,
      marketValue: p.marketValue,
      marketRank: marketRank.get(p.playerId),
      valueSource: p.valueSource,
      production: p.production,
      ageScore: p.ageScore,
      modelValue,
      expectedValue,
      gap: sig.gap,
      gapPercent: sig.gapPercent,
      signal: sig.signal,
      tone: sig.tone,
    };
  });

  // Model rank (1 = highest model value).
  const byModel = [...players].sort((a, b) => (b.modelValue ?? 0) - (a.modelValue ?? 0));
  const modelRank = new Map(byModel.map((p, i) => [p.playerId, i + 1]));
  for (const p of players) p.modelRank = modelRank.get(p.playerId);

  return players;
}

/**
 * Deep-bench players carry tiny market values that blow up gapPercent — a player
 * worth 20 against a model of 3,000 reads as +14,900%, swamping every real
 * buy/sell. Rankings and the headline stat cards restrict to "relevant" assets:
 * those whose market value is within RELEVANCE_FRACTION of the set's top value.
 * Scale-independent, so it works for FantasyCalc, KTC and custom alike. Falls
 * back to the full set if the floor would empty it.
 */
export const RELEVANCE_FRACTION = 0.1;

export function relevantPool(players: MarketPlayer[]): MarketPlayer[] {
  if (!players.length) return players;
  const maxMkt = players.reduce((m, p) => Math.max(m, p.marketValue), 0);
  const floor = maxMkt * RELEVANCE_FRACTION;
  const pool = players.filter((p) => p.marketValue >= floor);
  return pool.length ? pool : players;
}

export function computeSummary(players: MarketPlayer[]): MarketSummary {
  if (!players.length) return { bestBuy: null, biggestSell: null, largestGap: null, totalPlayers: 0 };
  const pool = relevantPool(players);
  let bestBuy: MarketPlayer | null = null;
  let biggestSell: MarketPlayer | null = null;
  let largestGap: MarketPlayer | null = null;
  for (const p of pool) {
    const gp = p.gapPercent ?? 0;
    if (!bestBuy || gp > (bestBuy.gapPercent ?? -Infinity)) bestBuy = p;
    if (!biggestSell || gp < (biggestSell.gapPercent ?? Infinity)) biggestSell = p;
    if (!largestGap || Math.abs(gp) > Math.abs(largestGap.gapPercent ?? 0)) largestGap = p;
  }
  return { bestBuy, biggestSell, largestGap, totalPlayers: players.length };
}

// ── Filters ──────────────────────────────────────────────────────────────────
export type AgeRange = "All" | "u23" | "23-25" | "26-28" | "29+";

export interface MarketFilters {
  position: "All" | MktPos;
  ageRange: AgeRange;
  minMarketValue: number;
  /** Minimum games played in the selected season; 0 = no minimum. */
  minGamesPlayed: number;
  search: string;
}

export const DEFAULT_FILTERS: MarketFilters = {
  position: "All",
  ageRange: "All",
  minMarketValue: 0,
  minGamesPlayed: 0,
  search: "",
};

export function applyFilters(players: MarketPlayer[], f: MarketFilters): MarketPlayer[] {
  const q = f.search.trim().toLowerCase();
  return players.filter((p) => {
    if (f.position !== "All" && p.position !== f.position) return false;
    if (p.marketValue < f.minMarketValue) return false;
    if (f.minGamesPlayed > 0 && (p.gamesPlayed ?? 0) < f.minGamesPlayed) return false;
    if (q && !p.playerName.toLowerCase().includes(q)) return false;
    if (f.ageRange !== "All") {
      const age = p.age;
      if (age == null) return false;
      if (f.ageRange === "u23" && !(age < 23)) return false;
      if (f.ageRange === "23-25" && !(age >= 23 && age <= 25)) return false;
      if (f.ageRange === "26-28" && !(age >= 26 && age <= 28)) return false;
      if (f.ageRange === "29+" && !(age >= 29)) return false;
    }
    return true;
  });
}

/**
 * Numeric/raw filter used by the API endpoint (mirrors the query params:
 * position, ageMin, ageMax, minMarketValue, search). Any param may be omitted.
 */
export function filterMarketPlayers(
  players: MarketPlayer[],
  opts: {
    position?: string;
    ageMin?: number;
    ageMax?: number;
    minMarketValue?: number;
    search?: string;
  },
): MarketPlayer[] {
  const q = (opts.search ?? "").trim().toLowerCase();
  return players.filter((p) => {
    if (opts.position && opts.position !== "All" && p.position !== opts.position) return false;
    if (opts.minMarketValue != null && p.marketValue < opts.minMarketValue) return false;
    if (q && !p.playerName.toLowerCase().includes(q)) return false;
    if (opts.ageMin != null || opts.ageMax != null) {
      if (p.age == null) return false;
      if (opts.ageMin != null && p.age < opts.ageMin) return false;
      if (opts.ageMax != null && p.age > opts.ageMax) return false;
    }
    return true;
  });
}

// ── Age buckets (for the Age Curve overlay + table) ───────────────────────────
export const AGE_BUCKETS: Array<{ key: string; min: number; max: number; mid: number }> = [
  { key: "≤22", min: 0, max: 22, mid: 22 },
  { key: "23-25", min: 23, max: 25, mid: 24 },
  { key: "26-28", min: 26, max: 28, mid: 27 },
  { key: "29-31", min: 29, max: 31, mid: 30 },
  { key: "32+", min: 32, max: 99, mid: 33 },
];

export function ageBucketKey(age?: number): string {
  if (age == null) return "—";
  return AGE_BUCKETS.find((b) => age >= b.min && age <= b.max)?.key ?? "—";
}

/** Average market value per age bucket → points for the overlay line. */
export function bucketAverages(players: MarketPlayer[]): Array<{ age: number; marketValue: number }> {
  return AGE_BUCKETS.map((b) => {
    const inBucket = players.filter((p) => p.age != null && p.age >= b.min && p.age <= b.max);
    if (!inBucket.length) return null;
    const avg = inBucket.reduce((s, p) => s + p.marketValue, 0) / inBucket.length;
    return { age: b.mid, marketValue: Math.round(avg) };
  }).filter((x): x is { age: number; marketValue: number } => x !== null);
}
