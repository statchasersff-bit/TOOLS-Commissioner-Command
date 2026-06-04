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
import { getOwnerIdForRoster } from "./helpers";
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

  const previousByRosterId = new Map<number, SleeperMatchup>(
    (input.previousWeekMatchups ?? []).map((m) => [Number(m.roster_id), m]),
  );

  for (const matchup of input.matchups ?? []) {
    const rosterId = Number(matchup.roster_id);
    const ownerId = getOwnerIdForRoster(input.rosters, rosterId);
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
        eventTitle: "Empty starter slot detected",
        eventDescription: `Roster ${rosterId} has ${emptyStarterSlots} empty starter slot(s).`,
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
          eventTitle: "Lineup changed",
          eventDescription: `Roster ${rosterId} changed ${diff.changeCount} starter slot(s).`,
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
          eventTitle: "Lineup unchanged",
          eventDescription: `Roster ${rosterId} did not change its lineup from the previous week.`,
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
