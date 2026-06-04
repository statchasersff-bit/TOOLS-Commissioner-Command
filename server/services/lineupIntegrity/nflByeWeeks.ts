/**
 * NFL bye weeks by season, keyed by team abbreviation.
 *
 * IMPORTANT: bye-week detection is intentionally OFF until a season's real
 * schedule data is populated here. Returning `null` from getByeWeeks() makes
 * the availability pipeline skip bye-starter detection entirely so we never
 * raise a FALSE "started a player on bye" alert from guessed data. Populate a
 * season only with values verified against the official NFL schedule.
 *
 * Shape:
 *   nflByeWeeksBySeason["2026"] = { ARI: 8, ATL: 5, ... }
 */
export const nflByeWeeksBySeason: Record<string, Record<string, number>> = {
  // Populate with verified data per season, e.g.:
  // "2025": { ARI: 8, ATL: 5, BAL: 7, ... },
};

/**
 * Return the bye-week map for a season, or null when we have no verified data
 * (callers MUST treat null as "skip bye detection", not "no byes").
 */
export function getByeWeeks(season: string | number): Record<string, number> | null {
  const map = nflByeWeeksBySeason[String(season)];
  if (!map || Object.keys(map).length === 0) return null;
  return map;
}

/** True when we have verified bye data for the season. */
export function byeWeekDataAvailable(season: string | number): boolean {
  return getByeWeeks(season) != null;
}
