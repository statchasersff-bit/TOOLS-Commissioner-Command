import { isBestBallLeague } from './isBestBall';
import { isDynastyLeague } from './isDynasty';

export interface LeagueFilterOptions {
  excludeBestBall?: boolean;    // Default: true (always exclude Best Ball)
  excludeDynasty?: boolean;     // Default: false (user toggle for dynasty/keeper)
}

export interface LeagueFilterResult<T> {
  filtered: T[];
  counts: {
    total: number;
    bestBallExcluded: number;
    dynastyExcluded: number;
    remaining: number;
  };
}

/**
 * Centralized league filtering logic used across Home and Matchups views.
 * Ensures consistent filtering behavior throughout the application.
 * 
 * Handles two types of inputs:
 * 1. Raw league objects (from Sleeper API) - used in Home view
 * 2. Objects with .league property (like LeagueMetrics) - used in Matchups view
 * 
 * @param items - Array of league objects or objects containing league property
 * @param options - Filtering options
 * @param extractLeague - Function to extract league from item (defaults to item => item.league || item)
 * @returns Filtered items and exclusion counts
 */
export function filterLeagues<T>(
  items: T[],
  options: LeagueFilterOptions = {},
  extractLeague: (item: T) => any = (item: any) => item.league || item
): LeagueFilterResult<T> {
  const {
    excludeBestBall = true,  // Default: always exclude Best Ball
    excludeDynasty = false,  // Default: include dynasty/keeper unless toggled
  } = options;

  const total = items.length;
  let filtered = [...items];
  let bestBallExcluded = 0;
  let dynastyExcluded = 0;

  // ALWAYS filter out Best Ball leagues (unless explicitly disabled)
  if (excludeBestBall) {
    const beforeBestBall = filtered.length;
    filtered = filtered.filter(item => {
      const league = extractLeague(item);
      return !isBestBallLeague(league);
    });
    bestBallExcluded = beforeBestBall - filtered.length;
  }

  // Optionally filter out Dynasty/Keeper leagues (based on user toggle)
  if (excludeDynasty) {
    const beforeDynasty = filtered.length;
    filtered = filtered.filter(item => {
      const league = extractLeague(item);
      return !isDynastyLeague(league);
    });
    dynastyExcluded = beforeDynasty - filtered.length;
  }

  return {
    filtered,
    counts: {
      total,
      bestBallExcluded,
      dynastyExcluded,
      remaining: filtered.length,
    },
  };
}
