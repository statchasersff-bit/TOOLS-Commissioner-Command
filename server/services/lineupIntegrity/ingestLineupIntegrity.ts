/**
 * ingestLineupIntegrityForLeague — the Phase-1 lineup integrity scanner.
 *
 * For each scanned week: pull Sleeper matchups/rosters/users/players, build a
 * starter+bench evaluation per roster, detect empty/bye/inactive/IR starters
 * and suspicious benchings, estimate the optimal lineup, score lineup integrity
 * and tanking RISK, persist checks + player rows, and (when enabled) generate
 * alerts. Re-running is idempotent and never resets commissioner decisions.
 *
 * Decision-support only: nothing here messages managers, edits lineups, or
 * changes standings.
 */
import {
  getNflState,
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getLeagueMatchups,
} from "../commissionerActivity/sleeperActivityApi";
import { getTradedPicks } from "../commissionerTrades/sleeperClient";
import { getSleeperPlayers } from "../../sleeper";

import { getLineupIntegritySettings } from "./lineupIntegritySettings";
import { buildLineupValueLookup, fantasyCalcFormatForLeague } from "./lineupProjectionService";
import { getPlayerAvailability, type SleeperPlayerMeta } from "./playerAvailabilityService";
import { parseSleeperLineup, getStartingSlots, countEmptyStarterSlots } from "./parseSleeperLineups";
import { buildOptimalLineup } from "./optimalLineupService";
import { detectSuspiciousBenchings } from "./suspiciousBenchingService";
import { scoreLineupIntegrity } from "./scoreLineupIntegrity";
import {
  calculateTankingRisk,
  getTankingRiskLabel,
  ownsOwnFutureFirst,
  isInPlayoffRace,
  type SleeperTradedPickLite,
} from "./tankingRiskService";
import { generateLineupAlerts, type AlertContext } from "./generateLineupAlerts";
import {
  saveLineupCheck,
  saveLineupPlayerChecks,
  replaceOpenAlerts,
  getRecentLineupIssueCount,
} from "./storage";
import type { LineupCheckRow, PlayerCheck, ReviewStatus } from "./types";

export interface IngestOptions {
  season?: string;
  weeks?: number[];
  forceRefresh?: boolean;
}

export interface IngestResult {
  success: boolean;
  leagueId: string;
  season?: string;
  weeksScanned: number[];
  lineupsChecked: number;
  alertsCreated: number;
  criticalAlerts: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export async function ingestLineupIntegrityForLeague(
  leagueId: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const force = Boolean(options.forceRefresh);
  const nflState = await getNflState(force);
  const season = options.season ?? String(nflState.season ?? new Date().getFullYear());
  const currentWeek = nflState.display_week ?? nflState.week ?? 1;
  const weeksToScan = options.weeks && options.weeks.length ? options.weeks : [currentWeek];

  const settings = await getLineupIntegritySettings(leagueId);

  if (settings.ignoreLineupChecksInOffseason && nflState.season_type && nflState.season_type !== "regular") {
    return {
      success: true, leagueId, season, weeksScanned: [], lineupsChecked: 0,
      alertsCreated: 0, criticalAlerts: 0, skipped: true,
      reason: "Lineup checks are disabled outside the regular season.",
    };
  }

  const [league, users, rosters, players, tradedPicks] = await Promise.all([
    getLeague(leagueId, force),
    getLeagueUsers(leagueId, force),
    getLeagueRosters(leagueId, force),
    getSleeperPlayers() as Promise<Record<string, SleeperPlayerMeta>>,
    getTradedPicks(leagueId).catch(() => [] as SleeperTradedPickLite[]),
  ]);

  const isBestBall = Number((league?.settings as any)?.best_ball) === 1;
  if (isBestBall && settings.ignoreLineupChecksForBestBall) {
    return {
      success: true, leagueId, season, weeksScanned: [], lineupsChecked: 0,
      alertsCreated: 0, criticalAlerts: 0, skipped: true,
      reason: "Lineup checks are disabled for best ball formats.",
    };
  }

  const rosterPositions: string[] = (league?.roster_positions as string[]) ?? [];
  const startingSlots = getStartingSlots(rosterPositions);
  const playoffTeams = Number((league?.settings as any)?.playoff_teams ?? 6);
  const valueFormat = fantasyCalcFormatForLeague(rosterPositions);
  const valueLookup = await buildLineupValueLookup(valueFormat);

  const userById = new Map<string, any>();
  for (const u of users) userById.set(u.user_id, u);

  const rosterById = new Map<number, any>();
  for (const r of rosters) rosterById.set(Number(r.roster_id), r);

  const standings = [...rosters].sort((a, b) => {
    const aw = Number(a.settings?.wins ?? 0);
    const bw = Number(b.settings?.wins ?? 0);
    if (bw !== aw) return bw - aw;
    return Number(b.settings?.fpts ?? 0) - Number(a.settings?.fpts ?? 0);
  });
  const rankByRoster = new Map<number, number>();
  standings.forEach((r, i) => rankByRoster.set(Number(r.roster_id), i + 1));

  let lineupsChecked = 0;
  let alertsCreated = 0;
  let criticalAlerts = 0;
  const weeksScanned: number[] = [];

  for (const week of weeksToScan) {
    const matchups = await getLeagueMatchups(leagueId, week, force);
    if (!matchups || matchups.length === 0) continue;
    weeksScanned.push(week);

    const matchupRosters = new Map<number, number[]>();
    for (const m of matchups) {
      const mid = Number(m.matchup_id ?? -1);
      if (mid < 0) continue;
      const arr = matchupRosters.get(mid) ?? [];
      arr.push(Number(m.roster_id));
      matchupRosters.set(mid, arr);
    }

    for (const matchup of matchups) {
      const rosterId = Number(matchup.roster_id);
      const roster = rosterById.get(rosterId);
      const ownerId: string | null = roster?.owner_id ?? null;
      const user = ownerId ? userById.get(ownerId) : null;
      const managerName: string = user?.display_name ?? user?.username ?? `Roster ${rosterId}`;
      const teamName: string = user?.metadata?.team_name ?? managerName;

      const parsed = parseSleeperLineup({ matchup, roster, rosterPositions });

      const starterChecks: PlayerCheck[] = [];
      const benchChecks: PlayerCheck[] = [];

      parsed.starters.forEach((pid, idx) => {
        if (!pid || pid === "0") return; // empty slot — counted separately
        starterChecks.push(
          buildPlayerCheck(pid, parsed.starterSlots[idx] ?? "FLEX", true, players, valueLookup, season, week),
        );
      });
      for (const pid of parsed.benchPlayers) {
        benchChecks.push(buildPlayerCheck(pid, "BN", false, players, valueLookup, season, week));
      }

      const allChecks = [...starterChecks, ...benchChecks];

      const emptyStarterSlots = settings.enableEmptySlotChecks ? countEmptyStarterSlots(parsed.starters) : 0;
      const byeStarters = settings.enableByeStarterChecks ? starterChecks.filter((p) => p.isOnBye).length : 0;
      const irStarters = settings.enableInactiveStarterChecks ? starterChecks.filter((p) => p.isIr).length : 0;
      const inactiveStarters = settings.enableInactiveStarterChecks
        ? starterChecks.filter((p) => p.isInactive && !p.isIr).length
        : 0;
      const doubtfulStarters = settings.enableInactiveStarterChecks
        ? starterChecks.filter((p) => p.isDoubtful).length
        : 0;

      const { optimalSlots, projectedOptimalPoints } = buildOptimalLineup({
        rosterPlayers: allChecks,
        rosterPositions: startingSlots,
      });
      const projectedStarterPoints =
        Math.round(starterChecks.reduce((s, p) => s + p.projection, 0) * 10) / 10;
      const optimalityGap = Math.max(0, Math.round((projectedOptimalPoints - projectedStarterPoints) * 10) / 10);
      const optimalityGapPct =
        projectedOptimalPoints > 0 ? Math.round((optimalityGap / projectedOptimalPoints) * 1000) / 10 : 0;

      const suspiciousDetails = settings.enableSuspiciousBenchingChecks
        ? detectSuspiciousBenchings({ starterChecks, benchChecks, settings })
        : [];
      const suspiciousBenchings = suspiciousDetails.length;

      const lineupIntegrityScore = scoreLineupIntegrity({
        emptyStarterSlots, byeStarters, inactiveStarters, irStarters,
        doubtfulStarters, suspiciousBenchings, optimalityGap,
      });

      const repeatIssueCount = await getRecentLineupIssueCount({
        leagueId, rosterId, season, currentWeek: week, lookbackWeeks: settings.repeatIssueWeeks,
      });
      const rank = rankByRoster.get(rosterId) ?? standings.length;
      const isEliminated = week >= settings.playoffIntegrityStartWeek && rank > playoffTeams + 2;
      const ownsOwnFirst = ownsOwnFutureFirst({ rosterId, season, tradedPicks });

      const mid = Number(matchup.matchup_id ?? -1);
      const oppRosterIds = (matchupRosters.get(mid) ?? []).filter((r) => r !== rosterId);
      const anyInRace = [rosterId, ...oppRosterIds].some((r) =>
        isInPlayoffRace(rankByRoster.get(r) ?? standings.length, playoffTeams),
      );
      const playoffImpactMatchup = week >= settings.playoffIntegrityStartWeek && anyInRace;

      const tankingRiskScore = settings.enableTankingRiskChecks
        ? calculateTankingRisk({
            lineupIntegrityScore, suspiciousBenchings, optimalityGap, repeatIssueCount,
            emptyStarterSlots, inactiveStarters: inactiveStarters + irStarters,
            isEliminated, ownsOwnFirst, playoffImpactMatchup,
          })
        : 0;

      const flags = buildFlags({
        emptyStarterSlots, byeStarters, inactiveStarters, irStarters, doubtfulStarters,
        suspiciousBenchings, optimalityGap, optimalityGapWarning: settings.optimalityGapWarning,
        repeatIssueCount, repeatIssueWeeks: settings.repeatIssueWeeks,
        tankingRiskScore, playoffImpactMatchup, lineupIntegrityScore,
      });

      const enteredQueue =
        lineupIntegrityScore < 75 || tankingRiskScore >= 25 || emptyStarterSlots > 0 ||
        byeStarters > 0 || inactiveStarters > 0 || irStarters > 0 || suspiciousBenchings > 0 ||
        optimalityGap >= settings.optimalityGapWarning;
      const reviewStatus: ReviewStatus = enteredQueue ? "needs_review" : "none";

      const row: LineupCheckRow = {
        leagueId, season, week, rosterId, ownerId, managerName, teamName,
        starters: parsed.starters, benchPlayers: parsed.benchPlayers, allPlayers: parsed.allPlayers,
        emptyStarterSlots, byeStarters, inactiveStarters, irStarters, doubtfulStarters,
        suspiciousBenchings, optimalityGap, optimalityGapPct,
        projectedStarterPoints, projectedOptimalPoints,
        lineupIntegrityScore, tankingRiskScore,
        riskLabel: getTankingRiskLabel(tankingRiskScore), reviewStatus,
        flags, rawMatchup: matchup,
        playerChecks: allChecks, suspiciousBenchingDetails: suspiciousDetails, optimalSlots,
      };

      const checkId = await saveLineupCheck(row);
      await saveLineupPlayerChecks(checkId, row);
      lineupsChecked++;

      if (settings.autoCreateAlerts) {
        const ctx: AlertContext = { repeatIssueCount, playoffImpactMatchup };
        const alerts = generateLineupAlerts(row, settings, ctx);
        const inserted = await replaceOpenAlerts(checkId, alerts);
        alertsCreated += inserted;
        criticalAlerts += alerts.filter((a) => a.severity === "critical").length;
      }
    }
  }

  return { success: true, leagueId, season, weeksScanned, lineupsChecked, alertsCreated, criticalAlerts };
}

function buildPlayerCheck(
  playerId: string,
  slot: string,
  isStarter: boolean,
  players: Record<string, SleeperPlayerMeta>,
  valueLookup: (id: string, pos?: string) => { projection: number; playerValue: number; source: string },
  season: string,
  week: number,
): PlayerCheck {
  const meta = players[playerId];
  const position = (meta?.position ?? meta?.fantasy_positions?.[0] ?? "").toUpperCase();
  const name =
    meta?.full_name ??
    [meta?.first_name, meta?.last_name].filter(Boolean).join(" ") ??
    playerId;
  const availability = getPlayerAvailability({ playerId, player: meta, season, nflWeek: week });
  const value = valueLookup(playerId, position);

  return {
    playerId,
    playerName: name || playerId,
    position,
    team: availability.team,
    lineupSlot: isStarter ? slot : "BN",
    isStarter,
    isBench: !isStarter,
    injuryStatus: availability.injuryStatus,
    activeStatus: availability.activeStatus,
    isOnBye: availability.isOnBye,
    isInactive: availability.isInactive,
    isIr: availability.isIr,
    isDoubtful: availability.isDoubtful,
    projection: value.projection,
    playerValue: value.playerValue,
    rankScore: value.playerValue,
    valueSource: value.source,
    betterBenchOption: false,
    betterBenchPlayerId: null,
    betterBenchPlayerName: null,
    valueGapVsBench: 0,
    projectionGapVsBench: 0,
    flags: [],
  };
}

function buildFlags(input: {
  emptyStarterSlots: number;
  byeStarters: number;
  inactiveStarters: number;
  irStarters: number;
  doubtfulStarters: number;
  suspiciousBenchings: number;
  optimalityGap: number;
  optimalityGapWarning: number;
  repeatIssueCount: number;
  repeatIssueWeeks: number;
  tankingRiskScore: number;
  playoffImpactMatchup: boolean;
  lineupIntegrityScore: number;
}): string[] {
  const flags: string[] = [];
  if (input.emptyStarterSlots > 0) flags.push("empty_starter");
  if (input.byeStarters > 0) flags.push("bye_starter");
  if (input.inactiveStarters > 0) flags.push("inactive_starter");
  if (input.irStarters > 0) flags.push("ir_starter");
  if (input.doubtfulStarters > 0) flags.push("doubtful_starter");
  if (input.suspiciousBenchings > 0) flags.push("suspicious_benching");
  if (input.optimalityGap >= input.optimalityGapWarning) flags.push("large_optimality_gap");
  if (input.repeatIssueCount >= input.repeatIssueWeeks) flags.push("repeat_lineup_issue");
  if (input.tankingRiskScore >= 50) flags.push("potential_tanking");
  if (input.playoffImpactMatchup && input.lineupIntegrityScore < 75) flags.push("playoff_integrity");
  return flags;
}
