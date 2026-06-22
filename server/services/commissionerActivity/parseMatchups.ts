/**
 * Convert Sleeper matchups into lineup-related ActivityEvents: empty starter
 * slots, lineup changes, and lineup-unchanged events (week-over-week).
 *
 * Lineup checks are skipped for best-ball leagues (no lineup to set) and outside
 * the regular season, controlled by the caller via `skipLineupChecks`.
 */
import type {
  ActivityEvent,
  SleeperMatchup,
  SleeperRoster,
  SleeperLeagueUser,
} from "./types";
import { getOwnerIdForRoster, buildUserMap, getTeamName } from "./helpers";
import { getLineupDiff, countEmptyStarters } from "./compareLineups";

export interface ParseMatchupInput {
  leagueId: string;
  season: string;
  week: number;
  matchups: SleeperMatchup[];
  previousWeekMatchups: SleeperMatchup[];
  rosters: SleeperRoster[];
  users: SleeperLeagueUser[];
  /** When true, emit no lineup/empty-slot events (best ball / offseason). */
  skipLineupChecks?: boolean;
  /** Epoch ms stamp for synthetic (non-transaction) events; passed in for determinism. */
  nowTs: number;
}

export function parseLineupEvents(input: ParseMatchupInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  if (input.skipLineupChecks) return events;

  const userById = buildUserMap(input.users ?? []);
  const teamName = (rid: number): string => {
    const roster = (input.rosters ?? []).find((r) => Number(r.roster_id) === Number(rid));
    const user = roster?.owner_id ? userById.get(String(roster.owner_id)) : undefined;
    return getTeamName(user, roster);
  };

  const previousByRosterId = new Map<number, SleeperMatchup>(
    (input.previousWeekMatchups ?? []).map((m) => [Number(m.roster_id), m]),
  );

  for (const matchup of input.matchups ?? []) {
    const rosterId = Number(matchup.roster_id);
    const ownerId = getOwnerIdForRoster(input.rosters, rosterId);
    const team = teamName(rosterId);
    const previous = previousByRosterId.get(rosterId);

    const emptyStarterSlots = countEmptyStarters(matchup.starters ?? []);
    if (emptyStarterSlots > 0) {
      events.push({
        leagueId: input.leagueId,
        season: input.season,
        week: input.week,
        rosterId,
        ownerId,
        eventType: "empty_starter",
        eventTitle: `${team} has ${emptyStarterSlots} empty starter slot(s)`,
        eventDescription: undefined,
        eventTs: input.nowTs,
        severity: emptyStarterSlots >= 2 ? "high" : "medium",
        rawEvent: { starters: matchup.starters, emptyStarterSlots },
      });
    }

    if (previous) {
      const diff = getLineupDiff(matchup.starters ?? [], previous.starters ?? []);
      if (diff.changed) {
        events.push({
          leagueId: input.leagueId,
          season: input.season,
          week: input.week,
          rosterId,
          ownerId,
          eventType: "lineup_change",
          eventTitle: `${team} changed ${diff.changeCount} starter slot(s)`,
          eventDescription: undefined,
          eventTs: input.nowTs,
          severity: "info",
          rawEvent: {
            currentStarters: matchup.starters,
            previousStarters: previous.starters,
            addedToLineup: diff.addedToLineup,
            removedFromLineup: diff.removedFromLineup,
            changeCount: diff.changeCount,
          },
        });
      } else {
        events.push({
          leagueId: input.leagueId,
          season: input.season,
          week: input.week,
          rosterId,
          ownerId,
          eventType: "lineup_unchanged",
          eventTitle: `${team} kept the same lineup as last week`,
          eventDescription: undefined,
          eventTs: input.nowTs,
          severity: "low",
          rawEvent: {
            currentStarters: matchup.starters,
            previousStarters: previous.starters,
          },
        });
      }
    }
  }

  return events;
}
