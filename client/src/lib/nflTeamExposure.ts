// Pure helpers for "How many players do I roster from each NFL team?"
// Used by the Favorite Team Widget (single-team focus) and the
// NflTeamExposure section (full breakdown). No React, no async — caller
// memoizes via useMemo.

import type { Player } from "@/types";

export interface NflTeamExposureEntry {
  teamAbbr: string;            // e.g. "ATL", or "FA" for free agents
  playerCount: number;
  dynastyValue: number;
  redraftValue: number;
  players: Player[];
  isFavoriteTeam: boolean;
  /** Share of THIS team's value within the entire (non-FA) roster value pool. 0..100. */
  dynastyValuePct: number;
  /** Share of THIS team's player count within the entire (non-FA) roster. 0..100. */
  rosterCountPct: number;
}

export type ExposureInsight =
  | { kind: "favorite-present"; teamAbbr: string; count: number }
  | { kind: "favorite-absent";  teamAbbr: string }
  | { kind: "heavy-concentration"; teamAbbr: string; count: number; valuePct: number };

export interface NflTeamExposureResult {
  /** Sorted by dynasty value desc. Excludes the FA bucket — that's exposed separately. */
  teams: NflTeamExposureEntry[];
  /** Optional aggregate for unsigned/team-less players. Null when no FAs in the roster. */
  freeAgents: NflTeamExposureEntry | null;
  /** Lookup for the favorite team (null if not selected or 0 players rostered). */
  favoriteTeamExposure: NflTeamExposureEntry | null;
  /** Highest-exposure team by dynasty value. Null when the roster is empty. */
  topExposureTeam: NflTeamExposureEntry | null;
  /** Generated insights ready for the UI to render verbatim or restyle. */
  insights: ExposureInsight[];
}

/**
 * Heavy-concentration thresholds. Mirrors the spec verbatim — kept as
 * exported constants so the UI can reference them in tooltips without
 * drifting from the rule that triggered the insight.
 */
export const HEAVY_EXPOSURE_PLAYER_COUNT = 4;
export const HEAVY_EXPOSURE_VALUE_PCT = 20;

/**
 * Group the user's rostered players by NFL team and tally counts + values.
 *
 * - Players with `team` empty/null/"FA" are bucketed under `freeAgents`.
 * - Picks are NOT in the Player[] shape — callers must pass only on-field
 *   players. We don't filter by position here so DEF/K stay if present.
 */
export function calculateNflTeamExposure(
  players: Player[],
  favoriteTeamAbbr: string | null | undefined,
  getPlayerValue: (p: Player) => number,
  getRedraftValue: (p: Player) => number,
): NflTeamExposureResult {
  const fav = favoriteTeamAbbr ? favoriteTeamAbbr.toUpperCase() : null;

  // Bucket by team abbreviation. Treat empty/"FA"/"0" as free agents.
  const buckets = new Map<string, Player[]>();
  for (const p of players) {
    const t = (p.team || "").toUpperCase();
    const key = !t || t === "0" || t === "FA" ? "__FA__" : t;
    const arr = buckets.get(key);
    if (arr) arr.push(p);
    else buckets.set(key, [p]);
  }

  // Total non-FA dynasty + count, used for percentage shares.
  let totalDynastyExclFa = 0;
  let totalCountExclFa = 0;
  buckets.forEach((arr, key) => {
    if (key === "__FA__") return;
    totalCountExclFa += arr.length;
    totalDynastyExclFa += arr.reduce((s, p) => s + getPlayerValue(p), 0);
  });

  const makeEntry = (teamAbbr: string, list: Player[]): NflTeamExposureEntry => {
    const dynastyValue = list.reduce((s, p) => s + getPlayerValue(p), 0);
    const redraftValue = list.reduce((s, p) => s + getRedraftValue(p), 0);
    return {
      teamAbbr,
      playerCount: list.length,
      dynastyValue: Math.round(dynastyValue),
      redraftValue: Math.round(redraftValue),
      players: [...list].sort((a, b) => getPlayerValue(b) - getPlayerValue(a)),
      isFavoriteTeam: fav !== null && teamAbbr === fav,
      dynastyValuePct: totalDynastyExclFa > 0 ? Math.round((dynastyValue / totalDynastyExclFa) * 1000) / 10 : 0,
      rosterCountPct: totalCountExclFa > 0 ? Math.round((list.length / totalCountExclFa) * 1000) / 10 : 0,
    };
  };

  const teams: NflTeamExposureEntry[] = [];
  let freeAgents: NflTeamExposureEntry | null = null;
  buckets.forEach((list, key) => {
    if (key === "__FA__") {
      freeAgents = makeEntry("FA", list);
    } else {
      teams.push(makeEntry(key, list));
    }
  });
  teams.sort((a, b) => b.dynastyValue - a.dynastyValue);

  const favoriteTeamExposure = fav ? teams.find((t) => t.teamAbbr === fav) ?? null : null;
  const topExposureTeam = teams[0] ?? null;

  // ── Insights ────────────────────────────────────────────────────────────
  const insights: ExposureInsight[] = [];
  if (fav) {
    if (favoriteTeamExposure && favoriteTeamExposure.playerCount > 0) {
      insights.push({ kind: "favorite-present", teamAbbr: fav, count: favoriteTeamExposure.playerCount });
    } else {
      insights.push({ kind: "favorite-absent", teamAbbr: fav });
    }
  }

  // Heavy concentration trigger: any team that hits EITHER threshold.
  // We surface the single highest-value such team to avoid spamming insights
  // when a user has 4+ players from multiple teams (rare, but it happens).
  const heavyCandidate = teams.find(
    (t) => t.playerCount >= HEAVY_EXPOSURE_PLAYER_COUNT || t.dynastyValuePct >= HEAVY_EXPOSURE_VALUE_PCT,
  );
  if (heavyCandidate) {
    insights.push({
      kind: "heavy-concentration",
      teamAbbr: heavyCandidate.teamAbbr,
      count: heavyCandidate.playerCount,
      valuePct: heavyCandidate.dynastyValuePct,
    });
  }

  return { teams, freeAgents, favoriteTeamExposure, topExposureTeam, insights };
}
