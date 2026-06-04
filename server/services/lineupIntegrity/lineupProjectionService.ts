/**
 * Player value + weekly-projection lookup for the lineup checker.
 *
 * MVP value sourcing priority (the app has no per-week projection feed yet):
 *   1. FantasyCalc dynasty value (existing, cached) → playerValue, and a crude
 *      projection ESTIMATE derived from that value + position.
 *   2. Positional fallback when FantasyCalc doesn't know the player.
 *
 * `source` is surfaced in the UI so commissioners know not to over-trust a
 * fallback. For suspicious-benching detection, "projection" here is a relative
 * signal (value/rank proxy), not a real weekly point projection.
 */
import { getFantasyCalcValues } from "../../fantasycalc";

export interface LineupValue {
  projection: number;
  playerValue: number;
  source: "dynasty_value" | "position_fallback";
}

export type LineupValueLookup = (playerId: string, position?: string) => LineupValue;

const FALLBACK_PROJECTION: Record<string, number> = {
  QB: 14,
  RB: 8,
  WR: 8,
  TE: 6,
  K: 7,
  DEF: 7,
  DST: 7,
};

const FALLBACK_VALUE: Record<string, number> = {
  QB: 600,
  RB: 500,
  WR: 500,
  TE: 400,
  K: 50,
  DEF: 50,
  DST: 50,
};

export function getFallbackProjectionByPosition(position?: string): number {
  return FALLBACK_PROJECTION[(position ?? "").toUpperCase()] ?? 3;
}

export function getFallbackValueByPosition(position?: string): number {
  return FALLBACK_VALUE[(position ?? "").toUpperCase()] ?? 100;
}

/**
 * Map a dynasty value to a rough weekly-projection estimate. Dynasty values
 * span ~0–10000 (FantasyCalc superflex). We compress that onto a plausible
 * weekly-points band per position so the optimal-lineup sort is sensible. This
 * is intentionally crude — it ranks, it does not forecast.
 */
export function estimateProjectionFromValue(value: number, position?: string): number {
  const pos = (position ?? "").toUpperCase();
  const ceiling = FALLBACK_PROJECTION[pos] ?? 3;
  const norm = Math.min(1, Math.max(0, value / 8000));
  return Math.round((ceiling * (0.6 + norm * 1.9)) * 10) / 10;
}

/**
 * Build a synchronous value lookup for a run. Loads the FantasyCalc map once
 * (defensively — returns the fallback-only lookup if the source is down).
 */
export async function buildLineupValueLookup(format: string): Promise<LineupValueLookup> {
  let valuesBySleeperId: Record<string, number> = {};
  try {
    const fc = await getFantasyCalcValues(format);
    valuesBySleeperId = fc.valuesBySleeperId ?? {};
  } catch {
    valuesBySleeperId = {};
  }

  return (playerId: string, position?: string): LineupValue => {
    const dynastyValue = valuesBySleeperId[playerId];
    if (dynastyValue != null && Number.isFinite(dynastyValue)) {
      return {
        playerValue: Math.round(dynastyValue),
        projection: estimateProjectionFromValue(dynastyValue, position),
        source: "dynasty_value",
      };
    }
    return {
      playerValue: getFallbackValueByPosition(position),
      projection: getFallbackProjectionByPosition(position),
      source: "position_fallback",
    };
  };
}

/** Choose the FantasyCalc format key from league superflex-ness. */
export function fantasyCalcFormatForLeague(rosterPositions: string[]): string {
  const hasSuperflex = rosterPositions.some(
    (p) => p === "SUPER_FLEX" || p === "SUPERFLEX" || p === "QB/RB/WR/TE",
  );
  const qbSlots = rosterPositions.filter((p) => p === "QB").length;
  return hasSuperflex || qbSlots >= 2 ? "sf" : "1qb";
}
