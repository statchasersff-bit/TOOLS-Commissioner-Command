/**
 * Read-side summaries for the dashboard: overview payload, copy-ready reminder
 * templates, and the weekly commissioner report. These operate on persisted rows
 * so the UI renders instantly without re-scanning Sleeper.
 */
import type {
  CommissionerActivitySnapshot,
  CommissionerManagerActivity,
  CommissionerActivityAlert,
} from "@shared/schema";
import { LEAGUE_LABEL_DISPLAY } from "./helpers";
import type { LeagueActivityLabel } from "./types";

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

// ── Overview ─────────────────────────────────────────────────────────────────

export function buildOverview(
  snapshot: CommissionerActivitySnapshot | null,
  managers: CommissionerManagerActivity[],
  alerts: CommissionerActivityAlert[],
) {
  const sorted = [...managers];
  const mostActive = [...sorted]
    .sort((a, b) => (b.activityScore ?? 0) - (a.activityScore ?? 0))
    .slice(0, 5);
  const leastActive = [...sorted]
    .sort((a, b) => (b.inactivityRiskScore ?? 0) - (a.inactivityRiskScore ?? 0))
    .slice(0, 5);

  const topAlerts = [...alerts]
    .filter((a) => a.status === "open")
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, 5);

  return {
    snapshot: snapshot
      ? {
          leagueActivityScore: snapshot.leagueActivityScore ?? 0,
          leagueActivityLabel: snapshot.leagueActivityLabel ?? "unknown",
          totalTransactions: snapshot.totalTransactions ?? 0,
          totalTrades: snapshot.totalTrades ?? 0,
          totalWaivers: snapshot.totalWaivers ?? 0,
          totalFreeAgentMoves: snapshot.totalFreeAgentMoves ?? 0,
          totalLineupChanges: snapshot.totalLineupChanges ?? 0,
          totalEmptyStarterSlots: snapshot.totalEmptyStarterSlots ?? 0,
          activeManagerCount: snapshot.activeManagerCount ?? 0,
          inactiveManagerCount: snapshot.inactiveManagerCount ?? 0,
          week: snapshot.week,
          season: snapshot.season,
        }
      : null,
    openAlertCount: alerts.filter((a) => a.status === "open").length,
    topAlerts,
    mostActiveManagers: mostActive,
    leastActiveManagers: leastActive,
  };
}

// ── Reminder templates ───────────────────────────────────────────────────────

export type ReminderTone = "soft" | "empty_starter" | "inactivity" | "stronger";

export function reminderTemplate(
  tone: ReminderTone,
  vars: { managerName: string; week?: number | null; deadline?: string },
): string {
  const name = vars.managerName || "manager";
  const week = vars.week ?? "this week";
  const deadline = vars.deadline ?? "this week";
  switch (tone) {
    case "empty_starter":
      return `Hey ${name}, looks like your lineup has an empty starter slot for Week ${week}. Please update it before kickoff so we can keep the league competitive.`;
    case "inactivity":
      return `Hey ${name}, I noticed there has not been much activity on your team recently. Please confirm that you are still active in the league. If something is going on, just let me know.`;
    case "stronger":
      return `Hey ${name}, your team has been flagged for inactivity due to missed lineup activity and no recent roster moves. Please respond and update your team by ${deadline}. Continued inactivity may require commissioner action under league rules.`;
    case "soft":
    default:
      return `Hey ${name}, just a quick reminder to check your lineup ${typeof week === "number" ? `for Week ${week}` : week} when you get a chance. Commissioner Command flagged that your team may need attention.`;
  }
}

/** Pick the most appropriate reminder tone for an alert. */
export function reminderTemplateForAlert(
  alert: CommissionerActivityAlert,
  managerName: string,
): string {
  const base = { managerName, week: alert.week };
  switch (alert.alertType) {
    case "empty_starter":
      return reminderTemplate("empty_starter", base);
    case "inactive_manager_risk":
      return reminderTemplate(alert.severity === "critical" ? "stronger" : "inactivity", base);
    case "no_transactions":
      return reminderTemplate("inactivity", base);
    case "lineup_unchanged":
    default:
      return reminderTemplate("soft", base);
  }
}

// ── Weekly report ────────────────────────────────────────────────────────────

export function generateWeeklyActivityReport(
  snapshot: CommissionerActivitySnapshot | null,
  managers: CommissionerManagerActivity[],
  alerts: CommissionerActivityAlert[],
): string {
  const week = snapshot?.week ?? managers[0]?.week ?? "";
  const label = (snapshot?.leagueActivityLabel ?? "unknown") as LeagueActivityLabel;
  const labelText = LEAGUE_LABEL_DISPLAY[label] ?? "Unknown";
  const score = snapshot?.leagueActivityScore ?? 0;

  const lines: string[] = [];
  lines.push(`Commissioner Activity Report - Week ${week}`);
  lines.push("");
  lines.push(`League Activity: ${labelText}, ${score}/100`);
  lines.push("");

  const mostActive = [...managers]
    .filter((m) => (m.transactionsCount ?? 0) > 0 || (m.lineupChangeCount ?? 0) > 0)
    .sort((a, b) => moveCount(b) - moveCount(a))
    .slice(0, 3);
  if (mostActive.length) {
    lines.push("Most Active Managers:");
    mostActive.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.teamName} - ${moveCount(m)} move(s)`);
    });
    lines.push("");
  }

  const needsAttention = [...managers]
    .filter((m) => (m.inactivityRiskScore ?? 0) >= 25 || (m.emptyStarterSlots ?? 0) > 0)
    .sort((a, b) => (b.inactivityRiskScore ?? 0) - (a.inactivityRiskScore ?? 0))
    .slice(0, 8);
  if (needsAttention.length) {
    lines.push("Managers Needing Attention:");
    for (const m of needsAttention) {
      lines.push(`- ${m.teamName}: ${describeNeed(m)}`);
    }
    lines.push("");
  }

  lines.push("League Summary:");
  if (snapshot) {
    const changed = managers.filter((m) => m.lineupChanged).length;
    const flagged = managers.filter((m) => (m.inactivityRiskScore ?? 0) >= 50).length;
    lines.push(
      `There were ${snapshot.totalTransactions} total transactions this week, including ${snapshot.totalTrades} trade(s), ${snapshot.totalWaivers} waiver move(s), and ${snapshot.totalFreeAgentMoves} free agent move(s). ${changed} manager(s) changed their lineups. ${flagged} manager(s) were flagged for inactivity risk.`,
    );
  } else {
    lines.push("No activity snapshot is available yet for this week. Run a scan to generate one.");
  }

  const open = alerts.filter((a) => a.status === "open");
  if (open.length) {
    lines.push("");
    lines.push(`Open Alerts: ${open.length}`);
  }

  return lines.join("\n");
}

function moveCount(m: CommissionerManagerActivity): number {
  return (m.transactionsCount ?? 0) + (m.lineupChangeCount ?? 0);
}

function describeNeed(m: CommissionerManagerActivity): string {
  const parts: string[] = [];
  if ((m.emptyStarterSlots ?? 0) > 0) parts.push(`${m.emptyStarterSlots} empty starter slot(s)`);
  if (m.weeksSinceTransaction != null && m.weeksSinceTransaction >= 3) {
    parts.push(`no transactions in ${m.weeksSinceTransaction} week(s)`);
  }
  if (m.weeksSinceLineupChange != null && m.weeksSinceLineupChange >= 2) {
    parts.push(`lineup unchanged for ${m.weeksSinceLineupChange} week(s)`);
  }
  if (!parts.length) parts.push("inactivity risk");
  return parts.join(", ");
}
