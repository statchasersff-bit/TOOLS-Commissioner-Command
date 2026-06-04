/**
 * Standalone integration test for League Activity Monitoring.
 * Exercises parse → score → alert → persist → read-back against the REAL DB
 * using synthetic Sleeper data + a throwaway leagueId, then cleans up.
 * Run: npx tsx scripts/testActivityPipeline.ts
 */
import { parseTransactionEvents, countAddsDropsForRoster } from "../server/services/commissionerActivity/parseTransactions";
import { parseLineupEvents } from "../server/services/commissionerActivity/parseMatchups";
import { scoreManagerActivity } from "../server/services/commissionerActivity/scoreManagerActivity";
import { scoreLeagueActivity } from "../server/services/commissionerActivity/scoreLeagueActivity";
import { generateActivityAlerts } from "../server/services/commissionerActivity/generateActivityAlerts";
import {
  countTransactionTypesForRoster, countLineupEventsForRoster,
  buildUserMap, getManagerDisplayName, getTeamName,
} from "../server/services/commissionerActivity/helpers";
import {
  saveActivityEventsForWeek, saveManagerActivityRows, saveActivitySnapshot, saveActivityAlerts,
  getSnapshot, getManagerRows, getEvents, getAlerts, updateAlertStatus,
  getWeeksSinceLastTransaction, getWeeksSinceLastLineupChange,
} from "../server/services/commissionerActivity/storage";
import { buildOverview, generateWeeklyActivityReport, reminderTemplate } from "../server/services/commissionerActivity/activitySummary";
import { DEFAULT_ACTIVITY_SETTINGS, type ManagerActivityRow, type ActivityEvent } from "../server/services/commissionerActivity/types";
import { getNflState } from "../server/services/commissionerActivity/sleeperActivityApi";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const LEAGUE = "TEST_ACTIVITY_PIPELINE";
const SEASON = "2099";
let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

async function cleanup() {
  for (const t of [
    "commissioner_activity_events", "commissioner_manager_activity",
    "commissioner_activity_snapshots", "commissioner_activity_alerts",
  ]) {
    await db.execute(sql.raw(`DELETE FROM ${t} WHERE league_id = '${LEAGUE}'`));
  }
}

async function main() {
  await cleanup();

  const state = await getNflState();
  assert(typeof state.season === "string" || typeof state.season === "number", `Live NFL state fetched (season=${state.season})`);

  const rosters = [
    { roster_id: 1, owner_id: "u1", starters: ["p10", "p11", "p12"] },
    { roster_id: 2, owner_id: "u2", starters: ["p20", "0", "p22"] },
    { roster_id: 3, owner_id: null, starters: ["p30", "p31", "p32"] },
  ];
  const users = [
    { user_id: "u1", display_name: "Active Annie", metadata: { team_name: "Annie's Aces" } },
    { user_id: "u2", display_name: "Quiet Quinn", metadata: { team_name: "Quinn's Quitters" } },
  ];

  const week = 5;
  const txns = [
    { transaction_id: "t1", type: "trade", status: "complete", status_updated: 1000, roster_ids: [1, 2], adds: { p99: 1 }, drops: { p98: 2 } },
    { transaction_id: "t2", type: "waiver", status: "complete", status_updated: 2000, roster_ids: [1], adds: { p77: 1 }, drops: {} },
    { transaction_id: "t3", type: "free_agent", status: "complete", status_updated: 3000, roster_ids: [1], adds: { p55: 1 }, drops: {} },
    { transaction_id: "t4", type: "waiver", status: "complete", status_updated: 2500, roster_ids: [2], adds: { p66: 2 }, drops: {} },
    { transaction_id: "t5", type: "waiver", status: "failed", roster_ids: [3], adds: { p44: 3 }, drops: {} },
  ];
  const prevMatchups = [
    { roster_id: 1, starters: ["p10", "p11", "p12"] },
    { roster_id: 2, starters: ["p20", "p21", "p22"] },
    { roster_id: 3, starters: ["p30", "p31", "p32"] },
  ];
  const matchups = [
    { roster_id: 1, starters: ["p10", "p11", "p13"] },
    { roster_id: 2, starters: ["p20", "0", "p22"] },
    { roster_id: 3, starters: ["p30", "p31", "p32"] },
  ];

  const txnEvents = parseTransactionEvents({ leagueId: LEAGUE, season: SEASON, week, transactions: txns as any, rosters: rosters as any, users: users as any });
  assert(txnEvents.filter((e) => e.eventType === "trade").length === 2, "Trade emits one event per roster (2)");
  assert(!txnEvents.some((e) => e.transactionId === "t5"), "Failed waiver excluded");

  const lineupEvents = parseLineupEvents({ leagueId: LEAGUE, season: SEASON, week, matchups: matchups as any, previousWeekMatchups: prevMatchups as any, rosters: rosters as any, users: users as any, nowTs: 5000 });
  assert(lineupEvents.some((e) => e.eventType === "lineup_change" && e.rosterId === 1), "Roster 1 lineup_change detected");
  assert(lineupEvents.some((e) => e.eventType === "empty_starter" && e.rosterId === 2), "Roster 2 empty_starter detected");
  assert(lineupEvents.some((e) => e.eventType === "lineup_unchanged" && e.rosterId === 3), "Roster 3 lineup_unchanged detected");

  const allEvents: ActivityEvent[] = [...txnEvents, ...lineupEvents];
  const saved = await saveActivityEventsForWeek(LEAGUE, SEASON, week, allEvents);
  assert(saved === allEvents.length, `Saved ${saved} events`);

  const wst1 = await getWeeksSinceLastTransaction(LEAGUE, SEASON, 1, week);
  assert(wst1 === 0, `Roster 1 transacted this week (weeksSince=${wst1})`);
  const wst3 = await getWeeksSinceLastTransaction(LEAGUE, SEASON, 3, week);
  assert(wst3 === week, `Roster 3 never transacted (weeksSince=${wst3})`);

  const userById = buildUserMap(users as any);
  const rows: ManagerActivityRow[] = [];
  for (const r of rosters) {
    const user = r.owner_id ? userById.get(r.owner_id) : undefined;
    const tc = countTransactionTypesForRoster(allEvents, r.roster_id);
    const lc = countLineupEventsForRoster(allEvents, r.roster_id);
    const ad = countAddsDropsForRoster(txns as any, r.roster_id);
    rows.push({
      leagueId: LEAGUE, season: SEASON, week, rosterId: r.roster_id,
      ownerId: r.owner_id ?? null,
      managerName: getManagerDisplayName(user as any, r as any),
      teamName: getTeamName(user as any, r as any),
      transactionsCount: tc.transactionsCount, tradesCount: tc.tradesCount,
      waiverCount: tc.waiverCount, freeAgentCount: tc.freeAgentCount,
      addsCount: ad.addsCount, dropsCount: ad.dropsCount,
      lineupChanged: lc.lineupChanged, lineupChangeCount: lc.lineupChangeCount,
      emptyStarterSlots: lc.emptyStarterSlots,
      lastTransactionTs: null, lastLineupChangeTs: null,
      weeksSinceTransaction: await getWeeksSinceLastTransaction(LEAGUE, SEASON, r.roster_id, week),
      weeksSinceLineupChange: await getWeeksSinceLastLineupChange(LEAGUE, SEASON, r.roster_id, week),
      activityScore: 0, inactivityRiskScore: 0, activityLabel: "unknown", flags: [],
    });
  }
  const scored = rows.map((r) => scoreManagerActivity(r, DEFAULT_ACTIVITY_SETTINGS));
  const r1 = scored.find((m) => m.rosterId === 1)!;
  const r2 = scored.find((m) => m.rosterId === 2)!;
  const r3 = scored.find((m) => m.rosterId === 3)!;
  assert(r1.activityScore > r2.activityScore && r1.activityScore > r3.activityScore, `Roster 1 most active (${r1.activityScore} > ${r2.activityScore}, ${r3.activityScore})`);
  assert(r2.flags.includes("empty_starter"), "Roster 2 flagged empty_starter");
  assert(r3.flags.includes("possible_orphan_risk"), "Roster 3 (no owner) flagged orphan risk");

  const snap = scoreLeagueActivity({ leagueId: LEAGUE, season: SEASON, week, managerRows: scored, transactionEvents: txnEvents, lineupEvents, settings: DEFAULT_ACTIVITY_SETTINGS });
  assert(snap.totalTrades === 1, `Snapshot totalTrades=1 (distinct txn, got ${snap.totalTrades})`);
  assert(snap.totalEmptyStarterSlots === 1, `Snapshot empty slots=1 (got ${snap.totalEmptyStarterSlots})`);

  await saveActivitySnapshot(snap);
  await saveManagerActivityRows(scored);
  const alerts = generateActivityAlerts({ leagueId: LEAGUE, season: SEASON, week, managers: scored, leagueSnapshot: snap, settings: DEFAULT_ACTIVITY_SETTINGS });
  await saveActivityAlerts(alerts);
  assert(alerts.some((a) => a.alertType === "empty_starter"), "Empty starter alert generated");

  await saveActivityEventsForWeek(LEAGUE, SEASON, week, allEvents);
  await saveActivityAlerts(alerts);
  const dbEvents = await getEvents(LEAGUE, SEASON, week, {});
  assert(dbEvents.length === allEvents.length, `Events idempotent after re-scan (${dbEvents.length})`);

  const dbSnap = await getSnapshot(LEAGUE, SEASON, week);
  assert(dbSnap != null && dbSnap.totalTrades === 1, "Snapshot read back");
  const dbMgrs = await getManagerRows(LEAGUE, SEASON, week);
  assert(dbMgrs.length === 3 && dbMgrs[0].inactivityRiskScore >= dbMgrs[2].inactivityRiskScore, "Managers read back, sorted by risk desc");
  const dbAlerts = await getAlerts(LEAGUE, { status: "open" });
  assert(dbAlerts.length > 0, `Open alerts read back (${dbAlerts.length})`);

  const overview = buildOverview(dbSnap, dbMgrs, dbAlerts);
  assert(overview.mostActiveManagers[0].rosterId === 1, "Overview: roster 1 most active");
  const report = generateWeeklyActivityReport(dbSnap, dbMgrs, dbAlerts);
  assert(report.includes("Commissioner Activity Report") && report.includes("Annie's Aces"), "Weekly report renders");
  const reminder = reminderTemplate("empty_starter", { managerName: "Quinn", week });
  assert(reminder.includes("Quinn") && reminder.includes("empty starter"), "Reminder template renders");

  const target = dbAlerts[0];
  const upd = await updateAlertStatus(target.id, "resolved", "fixed after reminder");
  assert(upd?.status === "resolved" && upd?.resolvedAt != null, "Alert resolved + timestamp set");
  const stillOpen = await getAlerts(LEAGUE, { status: "open" });
  assert(stillOpen.every((a) => a.id !== target.id), "Resolved alert no longer in open filter");

  await saveActivityAlerts(alerts);
  const afterRescan = await getAlerts(LEAGUE, {});
  const reResolved = afterRescan.find((a) => a.id === target.id);
  assert(reResolved?.status === "resolved", "Re-scan preserves commissioner status");

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
