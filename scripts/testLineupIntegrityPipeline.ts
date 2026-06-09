/**
 * Standalone integration test for Lineup Integrity & Anti-Tanking.
 * Exercises detect → optimal → suspicious → score → tanking → alerts →
 * persist/read-back against the REAL DB using synthetic data + a throwaway
 * leagueId, then cleans up. Run: npx tsx scripts/testLineupIntegrityPipeline.ts
 */
import { countEmptyStarterSlots } from "../server/services/lineupIntegrity/parseSleeperLineups";
import { getPlayerAvailability } from "../server/services/lineupIntegrity/playerAvailabilityService";
import { buildOptimalLineup } from "../server/services/lineupIntegrity/optimalLineupService";
import { detectSuspiciousBenchings } from "../server/services/lineupIntegrity/suspiciousBenchingService";
import { scoreLineupIntegrity, getLineupIntegrityLabel } from "../server/services/lineupIntegrity/scoreLineupIntegrity";
import { calculateTankingRisk, getTankingRiskLabel, ownsOwnFutureFirst } from "../server/services/lineupIntegrity/tankingRiskService";
import { generateLineupAlerts } from "../server/services/lineupIntegrity/generateLineupAlerts";
import {
  saveLineupCheck, saveLineupPlayerChecks, replaceOpenAlerts, getRecentLineupIssueCount,
} from "../server/services/lineupIntegrity/storage";
import { getLineupIntegritySettings, upsertLineupIntegritySettings } from "../server/services/lineupIntegrity/lineupIntegritySettings";
import { DEFAULT_LINEUP_INTEGRITY_SETTINGS, type PlayerCheck, type LineupCheckRow } from "../server/services/lineupIntegrity/types";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const LEAGUE = "TEST_LINEUP_PIPELINE";
const SEASON = "2099";
const WEEK = 8;
let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

async function cleanup() {
  // Delete checks last-ish; FKs cascade to player_checks + alerts, but be explicit.
  for (const t of [
    "commissioner_lineup_player_checks", "commissioner_lineup_alerts",
    "commissioner_lineup_strikes", "commissioner_lineup_checks",
    "commissioner_lineup_settings",
  ]) {
    await db.execute(sql.raw(`DELETE FROM ${t} WHERE league_id = '${LEAGUE}'`));
  }
}
async function count(table: string): Promise<number> {
  const r: any = await db.execute(sql.raw(`SELECT count(*)::int AS c FROM ${table} WHERE league_id = '${LEAGUE}'`));
  return Number((r.rows ?? r)[0].c);
}

function pc(over: Partial<PlayerCheck> & { playerId: string; position: string; projection: number; playerValue: number }): PlayerCheck {
  return {
    playerName: over.playerId, team: "DAL",
    lineupSlot: null, isStarter: false, isBench: false,
    injuryStatus: null, activeStatus: null,
    isOnBye: false, isInactive: false, isIr: false, isDoubtful: false,
    rankScore: over.playerValue, valueSource: "test",
    betterBenchOption: false, betterBenchPlayerId: null, betterBenchPlayerName: null,
    valueGapVsBench: 0, projectionGapVsBench: 0, flags: [],
    ...over,
  } as PlayerCheck;
}

async function main() {
  await cleanup();
  const settings = { ...DEFAULT_LINEUP_INTEGRITY_SETTINGS };

  // ── Availability: an OUT player is inactive; a healthy player is not ──
  const outAvail = getPlayerAvailability({ playerId: "wr2", player: { position: "WR", team: "DAL", injury_status: "Out" } as any, season: SEASON, nflWeek: WEEK });
  assert(outAvail.isInactive && outAvail.isOut, "OUT player flagged inactive");
  const okAvail = getPlayerAvailability({ playerId: "wr1", player: { position: "WR", team: "DAL" } as any, season: SEASON, nflWeek: WEEK });
  assert(!okAvail.isInactive, "Healthy player not flagged inactive");

  // ── Synthetic roster: starters with 1 empty slot + 1 OUT starter; a strong WR benched ──
  const starters = ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "flexrb", "k1", "0"];
  assert(countEmptyStarterSlots(starters) === 1, "Detects 1 empty starter slot");

  const startingPositions = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];
  const starterChecks: PlayerCheck[] = [
    pc({ playerId: "qb1", position: "QB", projection: 20, playerValue: 5000, lineupSlot: "QB", isStarter: true }),
    pc({ playerId: "rb1", position: "RB", projection: 14, playerValue: 4000, lineupSlot: "RB", isStarter: true }),
    pc({ playerId: "rb2", position: "RB", projection: 12, playerValue: 3000, lineupSlot: "RB", isStarter: true }),
    pc({ playerId: "wr1", position: "WR", projection: 13, playerValue: 3500, lineupSlot: "WR", isStarter: true }),
    pc({ playerId: "wr2", position: "WR", projection: 11, playerValue: 3000, lineupSlot: "WR", isStarter: true, isInactive: true, injuryStatus: "Out" }),
    pc({ playerId: "te1", position: "TE", projection: 8, playerValue: 1500, lineupSlot: "TE", isStarter: true }),
    pc({ playerId: "flexrb", position: "RB", projection: 9, playerValue: 1800, lineupSlot: "FLEX", isStarter: true }),
    pc({ playerId: "k1", position: "K", projection: 8, playerValue: 200, lineupSlot: "K", isStarter: true }),
  ];
  const benchChecks: PlayerCheck[] = [
    pc({ playerId: "wrStrong", position: "WR", projection: 16, playerValue: 6000, lineupSlot: "BN", isBench: true }),
    pc({ playerId: "def1", position: "DEF", projection: 7, playerValue: 300, lineupSlot: "BN", isBench: true }),
    pc({ playerId: "benchRb", position: "RB", projection: 5, playerValue: 500, lineupSlot: "BN", isBench: true }),
  ];
  const allChecks = [...starterChecks, ...benchChecks];

  // ── Optimal lineup: should bench-in wrStrong + def1, beating the started lineup ──
  const projectedStarterPoints = starterChecks.reduce((s, p) => s + p.projection, 0); // 95
  const { projectedOptimalPoints, optimalSlots } = buildOptimalLineup({ rosterPlayers: allChecks, rosterPositions: startingPositions });
  assert(projectedOptimalPoints > projectedStarterPoints, `Optimal (${projectedOptimalPoints}) > started (${projectedStarterPoints})`);
  assert(optimalSlots.some((s) => s.playerId === "wrStrong"), "Optimal lineup uses the benched strong WR");
  assert(!optimalSlots.some((s) => s.playerId === "wr2"), "Optimal lineup excludes the OUT starter");
  const optimalityGap = Math.round((projectedOptimalPoints - projectedStarterPoints) * 10) / 10;

  // ── Suspicious benching: OUT WR starter with an eligible active WR on the bench ──
  const susp = detectSuspiciousBenchings({ starterChecks, benchChecks, settings });
  // The strong benched WR (wrStrong) surfaces as the bench replacement; which
  // started WR it's attributed to is order/greedy-dependent (here wr1 by value gap).
  assert(susp.length >= 1 && susp.some((s) => s.benchPlayerId === "wrStrong"), `Detects suspicious benching w/ strong bench WR (${susp.length})`);

  // ── Integrity score ──
  const integrityScore = scoreLineupIntegrity({
    emptyStarterSlots: 1, byeStarters: 0, inactiveStarters: 1, irStarters: 0,
    doubtfulStarters: 0, suspiciousBenchings: susp.length, optimalityGap,
  });
  assert(integrityScore < 50, `Integrity score reflects serious issues (${integrityScore} = ${getLineupIntegrityLabel(integrityScore)})`);

  // ── Tanking risk (eliminated + owns own 1st) ──
  const tankRisk = calculateTankingRisk({
    lineupIntegrityScore: integrityScore, suspiciousBenchings: susp.length, optimalityGap,
    repeatIssueCount: 0, emptyStarterSlots: 1, inactiveStarters: 1,
    isEliminated: true, ownsOwnFirst: true, playoffImpactMatchup: false,
  });
  assert(tankRisk >= 50, `Tanking risk high (${tankRisk} = ${getTankingRiskLabel(tankRisk)})`);

  // ── ownsOwnFutureFirst helper ──
  assert(ownsOwnFutureFirst({ rosterId: 3, season: SEASON, tradedPicks: [] }) === true, "Owns own 1st when no pick traded");
  assert(
    ownsOwnFutureFirst({ rosterId: 3, season: SEASON, tradedPicks: [{ season: String(Number(SEASON) + 1), round: 1, roster_id: 3, owner_id: 5 } as any] }) === false,
    "Does not own own 1st when traded away",
  );

  // ── Build the persisted check row + alerts ──
  const check: LineupCheckRow = {
    leagueId: LEAGUE, season: SEASON, week: WEEK,
    rosterId: 3, ownerId: "u3", managerName: "Casey", teamName: "Team Charlie",
    starters, benchPlayers: benchChecks.map((b) => b.playerId), allPlayers: allChecks.map((p) => p.playerId),
    emptyStarterSlots: 1, byeStarters: 0, inactiveStarters: 1, irStarters: 0, doubtfulStarters: 0,
    suspiciousBenchings: susp.length, optimalityGap, optimalityGapPct: Math.round((optimalityGap / projectedOptimalPoints) * 1000) / 10,
    projectedStarterPoints, projectedOptimalPoints,
    lineupIntegrityScore: integrityScore, tankingRiskScore: tankRisk,
    riskLabel: getTankingRiskLabel(tankRisk), reviewStatus: "needs_review",
    flags: ["empty_starter", "inactive_starter", "suspicious_benching"],
    rawMatchup: { starters }, playerChecks: allChecks,
    suspiciousBenchingDetails: susp, optimalSlots,
  };

  const alerts = generateLineupAlerts(check, settings, { repeatIssueCount: 0, playoffImpactMatchup: false });
  const alertTypes = alerts.map((a) => a.alertType);
  assert(alertTypes.includes("empty_starter"), "Alert: empty_starter generated");
  assert(alertTypes.includes("inactive_starter"), "Alert: inactive_starter generated");
  assert(alertTypes.includes("suspicious_benching"), "Alert: suspicious_benching generated");
  assert(alertTypes.includes("potential_tanking"), "Alert: potential_tanking generated");
  assert(alerts.every((a) => !/cheat|tanking confirmed|scam/i.test(a.title + a.description)), "No accusatory wording in alerts");

  // ── Persist + read back ──
  const id = await saveLineupCheck(check);
  await saveLineupPlayerChecks(id, check);
  const alertCount = await replaceOpenAlerts(id, alerts);
  assert(id > 0, "Lineup check saved (got id)");
  assert(await count("commissioner_lineup_checks") === 1, "1 check row persisted");
  assert(await count("commissioner_lineup_player_checks") === allChecks.length, `${allChecks.length} player-check rows persisted`);
  assert(await count("commissioner_lineup_alerts") === alerts.length, `${alerts.length} alert rows persisted`);
  assert(alertCount === alerts.length, "replaceOpenAlerts returns count");

  // ── Idempotency: re-run the save path; counts stay stable, same check id ──
  const id2 = await saveLineupCheck(check);
  await saveLineupPlayerChecks(id2, check);
  await replaceOpenAlerts(id2, alerts);
  assert(id2 === id, "Re-scan upserts same check id (idempotent)");
  assert(await count("commissioner_lineup_checks") === 1, "Still 1 check row after re-scan");
  assert(await count("commissioner_lineup_player_checks") === allChecks.length, "Player checks replaced, not duplicated");
  assert(await count("commissioner_lineup_alerts") === alerts.length, "Open alerts replaced, not duplicated");

  // ── Repeat-issue lookup: seed a prior low-score week, then count ──
  await saveLineupCheck({ ...check, week: WEEK - 1, lineupIntegrityScore: 40 });
  const repeat = await getRecentLineupIssueCount({ leagueId: LEAGUE, rosterId: 3, season: SEASON, currentWeek: WEEK, lookbackWeeks: 3 });
  assert(repeat >= 1, `Repeat-issue count sees prior bad week (${repeat})`);

  // ── Settings round-trip ──
  await upsertLineupIntegritySettings(LEAGUE, { optimalityGapWarning: 15, enableTankingRiskChecks: false });
  const s = await getLineupIntegritySettings(LEAGUE);
  assert(s.optimalityGapWarning === 15 && s.enableTankingRiskChecks === false, "Settings upsert + read back");

  await cleanup();
  console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} FAILURE(S) ❌`);
  await (db as any).$client?.end?.();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("THREW:", e);
  try { await cleanup(); } catch {}
  process.exit(1);
});
