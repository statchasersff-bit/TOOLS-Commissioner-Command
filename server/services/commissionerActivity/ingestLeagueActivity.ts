/**
 * Orchestrates a League Activity scan: pulls Sleeper data for the requested
 * weeks, normalizes activity into events, scores managers + the league, raises
 * alerts, and persists everything. Read-only with respect to Sleeper.
 *
 * Designed to degrade gracefully on the documented edge cases: a week with no
 * transactions or no matchups (preseason / offseason) simply yields zero events;
 * best-ball / non-regular-season leagues skip lineup checks; rosters with no
 * owner still get a row (and are surfaced as possible orphans).
 */
import {
  getNflState,
  getLeagueUsers,
  getLeagueRosters,
  getLeagueMatchups,
  getLeagueTransactions,
  invalidateLeagueCache,
} from "./sleeperActivityApi";
import {
  buildUserMap,
  countTransactionTypesForRoster,
  countLineupEventsForRoster,
  getManagerDisplayName,
  getTeamName,
  getWeeksToScan,
} from "./helpers";
import { parseTransactionEvents, countAddsDropsForRoster, type PlayersById } from "./parseTransactions";
import { parseLineupEvents } from "./parseMatchups";
import { getSleeperPlayers } from "../../sleeper";
import { scoreManagerActivity } from "./scoreManagerActivity";
import { scoreLeagueActivity, scoreSeasonActivity } from "./scoreLeagueActivity";
import { generateActivityAlerts } from "./generateActivityAlerts";
import {
  getActivitySettings,
  getLeagueActivityContext,
  shouldSkipLineupChecks,
} from "./activitySettings";
import {
  saveActivitySnapshot,
  saveManagerActivityRows,
  saveActivityEventsForWeek,
  saveActivityAlerts,
  getWeeksSinceLastTransaction,
  getWeeksSinceLastLineupChange,
  getSeasonTotals,
  getSeasonManagerAggregates,
} from "./storage";
import type {
  ActivityEvent,
  ManagerActivityRow,
  SleeperMatchup,
} from "./types";

export interface IngestInput {
  leagueId: string;
  season?: string;
  weeks?: number[];
  /** "recent" (prev + current) or "season" (1..current). Ignored if weeks given. */
  mode?: "recent" | "season";
  forceRefresh?: boolean;
}

export interface IngestResult {
  success: boolean;
  leagueId: string;
  season: string;
  weeksScanned: number[];
  managerRowsUpdated: number;
  eventsCreated: number;
  alertsCreated: number;
}

export async function ingestLeagueActivityForLeague(input: IngestInput): Promise<IngestResult> {
  const force = input.forceRefresh ?? false;
  if (force) invalidateLeagueCache(input.leagueId);

  const nflState = await getNflState(force);
  const season = input.season ?? String(nflState.season ?? new Date().getFullYear());
  const currentWeek = Number(nflState.display_week ?? nflState.week ?? 1) || 1;

  const weeksToScan =
    input.weeks && input.weeks.length
      ? input.weeks.filter((w) => w >= 1)
      : getWeeksToScan(currentWeek, input.mode ?? "recent");

  const [users, rosters] = await Promise.all([
    getLeagueUsers(input.leagueId, force),
    getLeagueRosters(input.leagueId, force),
  ]);

  const userById = buildUserMap(users);

  // Player map (/players/nfl, cached ~24h) for resolving names in feed events.
  // Degrade gracefully to ids if the (large) payload can't be loaded.
  let players: PlayersById = {};
  try {
    players = (await getSleeperPlayers()) as unknown as PlayersById;
  } catch {
    players = {};
  }

  const settings = await getActivitySettings(input.leagueId);
  const context = await getLeagueActivityContext(input.leagueId);
  const skipLineupChecks = shouldSkipLineupChecks(context, settings);

  // Stamp synthetic (non-transaction) events with a single timestamp per run.
  const nowTs = Date.now();

  let managerRowsUpdated = 0;
  let eventsCreated = 0;
  let alertsCreated = 0;

  for (const week of weeksToScan) {
    const [transactions, matchups] = await Promise.all([
      getLeagueTransactions(input.leagueId, week, force),
      getLeagueMatchups(input.leagueId, week, force),
    ]);
    const previousWeekMatchups: SleeperMatchup[] =
      week > 1 ? await getLeagueMatchups(input.leagueId, week - 1, force) : [];

    const transactionEvents = parseTransactionEvents({
      leagueId: input.leagueId,
      season,
      week,
      transactions,
      rosters,
      users,
    });

    const lineupEvents = parseLineupEvents({
      leagueId: input.leagueId,
      season,
      week,
      matchups,
      previousWeekMatchups,
      rosters,
      users,
      skipLineupChecks,
      nowTs,
    });

    const allEvents: ActivityEvent[] = [...transactionEvents, ...lineupEvents];

    // Persist events first so weeks-since lookups (below) see the current week.
    eventsCreated += await saveActivityEventsForWeek(input.leagueId, season, week, allEvents);

    const matchupByRoster = new Map<number, SleeperMatchup>(
      (matchups ?? []).map((m) => [Number(m.roster_id), m]),
    );

    // Build a manager row for every roster (not just those with activity).
    const baseRows: ManagerActivityRow[] = [];
    for (const roster of rosters ?? []) {
      const rosterId = Number(roster.roster_id);
      const user = roster.owner_id ? userById.get(String(roster.owner_id)) : undefined;

      const txnCounts = countTransactionTypesForRoster(allEvents, rosterId);
      const lineupCounts = countLineupEventsForRoster(allEvents, rosterId);
      const { addsCount, dropsCount } = countAddsDropsForRoster(transactions, rosterId);

      const txnEventsForRoster = transactionEvents.filter((e) => Number(e.rosterId) === rosterId);
      const lastTransactionTs = txnEventsForRoster.reduce<number | null>(
        (acc, e) => (e.eventTs != null && (acc == null || e.eventTs > acc) ? e.eventTs : acc),
        null,
      );
      const lastLineupChangeTs = lineupCounts.lineupChanged ? nowTs : null;

      const weeksSinceTransaction = await getWeeksSinceLastTransaction(
        input.leagueId,
        season,
        rosterId,
        week,
      );
      const weeksSinceLineupChange = skipLineupChecks
        ? null
        : await getWeeksSinceLastLineupChange(input.leagueId, season, rosterId, week);

      baseRows.push({
        leagueId: input.leagueId,
        season,
        week,
        rosterId,
        ownerId: roster.owner_id ? String(roster.owner_id) : null,
        managerName: getManagerDisplayName(user, roster),
        teamName: getTeamName(user, roster),
        transactionsCount: txnCounts.transactionsCount,
        tradesCount: txnCounts.tradesCount,
        waiverCount: txnCounts.waiverCount,
        freeAgentCount: txnCounts.freeAgentCount,
        addsCount,
        dropsCount,
        lineupChanged: lineupCounts.lineupChanged,
        lineupChangeCount: lineupCounts.lineupChangeCount,
        emptyStarterSlots: skipLineupChecks ? 0 : lineupCounts.emptyStarterSlots,
        lastTransactionTs,
        lastLineupChangeTs,
        weeksSinceTransaction,
        weeksSinceLineupChange,
        // Filled by scoreManagerActivity:
        activityScore: 0,
        inactivityRiskScore: 0,
        activityLabel: "unknown",
        flags: [],
        rawRoster: { settings: roster.settings ?? null, starters: roster.starters ?? null },
        rawMatchup: matchupByRoster.get(rosterId) ?? {},
      });
    }

    const scoredManagers = baseRows.map((r) => scoreManagerActivity(r, settings));

    const leagueSnapshot = scoreLeagueActivity({
      leagueId: input.leagueId,
      season,
      week,
      managerRows: scoredManagers,
      transactionEvents,
      lineupEvents,
      settings,
    });

    const alerts = generateActivityAlerts({
      leagueId: input.leagueId,
      season,
      week,
      managers: scoredManagers,
      leagueSnapshot,
      settings,
    });

    await saveActivitySnapshot(leagueSnapshot);
    managerRowsUpdated += await saveManagerActivityRows(scoredManagers);
    alertsCreated += await saveActivityAlerts(alerts);
  }

  // Roll every stored week up into one whole-season snapshot (sentinel week 0)
  // so the dashboard can show a single season-wide league activity score. Reads
  // from the DB (not just this run's weeks) so a "recent" scan still folds in the
  // earlier weeks that were persisted previously.
  const [seasonTotals, seasonAggregates] = await Promise.all([
    getSeasonTotals(input.leagueId, season),
    getSeasonManagerAggregates(input.leagueId, season),
  ]);
  if (seasonAggregates.length) {
    const seasonSnapshot = scoreSeasonActivity({
      leagueId: input.leagueId,
      season,
      weeks: seasonTotals.weeks,
      managerAggregates: seasonAggregates,
      totals: {
        totalTransactions: seasonTotals.totalTransactions,
        totalTrades: seasonTotals.totalTrades,
        totalWaivers: seasonTotals.totalWaivers,
        totalFreeAgentMoves: seasonTotals.totalFreeAgentMoves,
        totalLineupChanges: seasonTotals.totalLineupChanges,
        totalEmptyStarterSlots: seasonTotals.totalEmptyStarterSlots,
      },
      settings,
    });
    await saveActivitySnapshot(seasonSnapshot);
  }

  return {
    success: true,
    leagueId: input.leagueId,
    season,
    weeksScanned: weeksToScan,
    managerRowsUpdated,
    eventsCreated,
    alertsCreated,
  };
}
