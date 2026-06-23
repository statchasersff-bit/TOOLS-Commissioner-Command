/**
 * Dependency-free unit tests for orphan handling in League Activity scoring.
 * Run with: npx tsx server/services/commissionerActivity/orphanScoring.test.ts
 *
 * An orphan (empty, ownerless roster) must be SURFACED in the manager table but
 * NOT scored as a negligent manager — otherwise its staleness trips every risk
 * penalty (~95) and drags the league activity score down. These tests pin that
 * behavior across the manager score, the league aggregate, and alert generation.
 */
import assert from "node:assert/strict";
import { scoreManagerActivity } from "./scoreManagerActivity";
import { scoreLeagueActivity } from "./scoreLeagueActivity";
import { generateActivityAlerts } from "./generateActivityAlerts";
import { DEFAULT_ACTIVITY_SETTINGS } from "./types";
import type { ManagerActivityRow, LeagueSnapshotRow } from "./types";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

const settings = DEFAULT_ACTIVITY_SETTINGS;

function makeRow(overrides: Partial<ManagerActivityRow>): ManagerActivityRow {
  return {
    leagueId: "L1",
    season: "2025",
    week: 15,
    rosterId: 1,
    ownerId: "owner-1",
    managerName: "Manager 1",
    teamName: "Team 1",
    transactionsCount: 0,
    tradesCount: 0,
    waiverCount: 0,
    freeAgentCount: 0,
    addsCount: 0,
    dropsCount: 0,
    lineupChanged: false,
    lineupChangeCount: 0,
    emptyStarterSlots: 0,
    lastTransactionTs: null,
    lastLineupChangeTs: null,
    weeksSinceTransaction: 0,
    weeksSinceLineupChange: null,
    activityScore: 0,
    inactivityRiskScore: 0,
    activityLabel: "unknown",
    flags: [],
    ...overrides,
  };
}

console.log("scoreManagerActivity (orphan)");
test("empty orphan gets neutral scores, not a ~95 risk", () => {
  // Empty, ownerless roster carried to week 15 with no transaction ever — the
  // staleness path would otherwise drive risk to ~95.
  const scored = scoreManagerActivity(
    makeRow({ ownerId: null, weeksSinceTransaction: 15 }),
    settings,
  );
  assert.equal(scored.activityScore, 0);
  assert.equal(scored.inactivityRiskScore, 0);
  assert.equal(scored.activityLabel, "unknown");
});
test("orphan is flagged possible_orphan_risk (surfaced) and nothing else", () => {
  const scored = scoreManagerActivity(
    makeRow({ ownerId: null, weeksSinceTransaction: 15 }),
    settings,
  );
  assert.deepEqual(scored.flags, ["possible_orphan_risk"]);
});
test("owned active manager still scores normally", () => {
  const scored = scoreManagerActivity(
    makeRow({ transactionsCount: 3, tradesCount: 1, waiverCount: 1, weeksSinceTransaction: 0 }),
    settings,
  );
  assert.ok(scored.activityScore > 0, `expected >0, got ${scored.activityScore}`);
});

console.log("scoreLeagueActivity (orphan exclusion)");
test("orphans excluded from average, count, and inactive penalty", () => {
  const active = scoreManagerActivity(
    makeRow({ rosterId: 1, transactionsCount: 3, weeksSinceTransaction: 0 }),
    settings,
  );
  const orphanA = scoreManagerActivity(
    makeRow({ rosterId: 2, ownerId: null, weeksSinceTransaction: 15 }),
    settings,
  );
  const orphanB = scoreManagerActivity(
    makeRow({ rosterId: 3, ownerId: null, weeksSinceTransaction: 15 }),
    settings,
  );

  const withOrphans = scoreLeagueActivity({
    leagueId: "L1",
    season: "2025",
    week: 15,
    managerRows: [active, orphanA, orphanB],
    transactionEvents: [],
    lineupEvents: [],
    settings,
  });
  const onlyActive = scoreLeagueActivity({
    leagueId: "L1",
    season: "2025",
    week: 15,
    managerRows: [active],
    transactionEvents: [],
    lineupEvents: [],
    settings,
  });

  // The two empty orphans must not change the league score at all.
  assert.equal(withOrphans.leagueActivityScore, onlyActive.leagueActivityScore);
  assert.equal(withOrphans.inactiveManagerCount, 0);
  assert.equal((withOrphans.rawSummary as any).managerCount, 1);
});

console.log("generateActivityAlerts (orphan)");
test("orphan does not generate negligent-manager alerts", () => {
  const orphan = scoreManagerActivity(
    makeRow({ rosterId: 2, ownerId: null, weeksSinceTransaction: 15, emptyStarterSlots: 3 }),
    settings,
  );
  const snapshot = { leagueActivityScore: 80 } as LeagueSnapshotRow;
  const alerts = generateActivityAlerts({
    leagueId: "L1",
    season: "2025",
    week: 15,
    managers: [orphan],
    leagueSnapshot: snapshot,
    settings,
  });
  assert.equal(alerts.length, 0, `expected no alerts, got ${JSON.stringify(alerts)}`);
});

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}.`);
