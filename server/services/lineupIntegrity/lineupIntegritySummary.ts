/**
 * Copy-ready commissioner messaging + the weekly integrity report.
 *
 * Everything here is pure text formatting. Messages are neutral and
 * action-oriented; nothing is auto-sent. Templates mirror the feature spec.
 */
import { getLineupIntegrityLabel, integrityLabelDisplay } from "./scoreLineupIntegrity";

export interface ManagerIdentity {
  managerName: string;
  teamName: string;
}

export interface CopyMessages {
  softReminder: string;
  emptyStarter: string;
  byeInactive: string;
  suspiciousBenching: string;
  antiTanking: string;
  strikeNotice: string;
}

/** Minimal shape needed to build copy messages (satisfied by a full check). */
export interface CopyMessageCheck {
  week: number;
  suspiciousBenchingDetails: Array<{ benchName: string; starterName: string }>;
}

/** Per-check copy-paste messages with placeholders pre-filled where we can. */
export function buildCopyMessages(
  check: CopyMessageCheck,
  manager: ManagerIdentity,
): CopyMessages {
  const name = manager.managerName || manager.teamName || "Manager";
  const wk = check.week;
  const benchDetail = check.suspiciousBenchingDetails[0];
  const benchedPlayer = benchDetail?.benchName ?? "[Bench Player]";
  const startedPlayer = benchDetail?.starterName ?? "[Started Player]";

  return {
    softReminder:
      `Hey ${name}, quick reminder to check your lineup for Week ${wk}. ` +
      `Commissioner Command flagged that your team may need attention before kickoff.`,
    emptyStarter:
      `Hey ${name}, your lineup currently has an empty starter slot for Week ${wk}. ` +
      `Please update it before kickoff so we can keep the league competitive.`,
    byeInactive:
      `Hey ${name}, your lineup currently includes a player who appears to be on bye or inactive for Week ${wk}. ` +
      `Please review your lineup before kickoff.`,
    suspiciousBenching:
      `Hey ${name}, I'm reaching out because your Week ${wk} lineup was flagged for review. ` +
      `The system noticed that ${benchedPlayer} was on the bench while ${startedPlayer} was started in an eligible slot. ` +
      `Please take a look and update if needed.`,
    antiTanking:
      `Hey ${name}, your Week ${wk} lineup was flagged for multiple integrity issues. ` +
      `Please update your lineup and confirm you are setting a competitive roster. ` +
      `Continued issues may result in commissioner action under league rules.`,
    strikeNotice:
      `Hey ${name}, this is a formal lineup warning for Week ${wk}. ` +
      `Reason: [Reason]. This has been documented under the league's lineup integrity policy.`,
  };
}

export interface WeeklyReportTeam {
  managerName: string;
  teamName: string;
  lineupIntegrityScore: number;
  tankingRiskScore: number;
  emptyStarterSlots: number;
  byeStarters: number;
  inactiveStarters: number;
  suspiciousBenchings: number;
  optimalityGap: number;
  ownsOwnFirst: boolean;
  flags: string[];
}

export interface WeeklyReportInput {
  leagueName: string;
  week: number;
  totalTeamsChecked: number;
  cleanLineups: number;
  needsReview: number;
  emptyStarterSlots: number;
  inactiveStarters: number;
  potentialTankingSignals: number;
  teamsNeedingAttention: WeeklyReportTeam[];
  tankingReviewTeams: WeeklyReportTeam[];
}

/** A commissioner-ready, copy-paste weekly integrity report. */
export function buildWeeklyReport(input: WeeklyReportInput): string {
  const lines: string[] = [];
  lines.push(`Lineup Integrity Report - Week ${input.week}`);
  lines.push("");
  lines.push("League Summary:");
  lines.push(`- ${input.totalTeamsChecked} teams checked`);
  lines.push(`- ${input.cleanLineups} clean lineups`);
  lines.push(`- ${input.needsReview} teams need review`);
  lines.push(`- ${input.emptyStarterSlots} empty starter slot${input.emptyStarterSlots === 1 ? "" : "s"}`);
  lines.push(`- ${input.inactiveStarters} inactive starter${input.inactiveStarters === 1 ? "" : "s"}`);
  lines.push(`- ${input.potentialTankingSignals} potential tanking signal${input.potentialTankingSignals === 1 ? "" : "s"}`);
  lines.push("");

  if (input.teamsNeedingAttention.length) {
    lines.push("Teams Needing Attention:");
    input.teamsNeedingAttention.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.teamName || t.managerName}`);
      lines.push(`   Issue: ${describeIssue(t)}`);
      lines.push(`   Risk: ${riskWord(t)}`);
      lines.push(`   Suggested Action: ${suggestAction(t)}`);
    });
    lines.push("");
  }

  if (input.tankingReviewTeams.length) {
    lines.push("Potential Tanking Review:");
    input.tankingReviewTeams.forEach((t) => {
      const ownFirst = t.ownsOwnFirst ? " and owns its own next first-round pick" : "";
      lines.push(
        `- ${t.teamName || t.managerName} had a projected lineup ${round1(t.optimalityGap)} points below estimated optimal${ownFirst}.`,
      );
      lines.push(
        `  This does not prove tanking, but it should be reviewed and documented.`,
      );
    });
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function describeIssue(t: WeeklyReportTeam): string {
  const parts: string[] = [];
  if (t.emptyStarterSlots > 0) parts.push(`${t.emptyStarterSlots} empty starter slot${t.emptyStarterSlots === 1 ? "" : "s"}`);
  if (t.byeStarters > 0) parts.push(`${t.byeStarters} bye-week starter${t.byeStarters === 1 ? "" : "s"}`);
  if (t.inactiveStarters > 0) parts.push(`${t.inactiveStarters} inactive starter${t.inactiveStarters === 1 ? "" : "s"}`);
  if (t.suspiciousBenchings > 0) parts.push(`a stronger eligible option left on the bench`);
  if (!parts.length && t.optimalityGap > 0) parts.push(`a projected lineup ${round1(t.optimalityGap)} pts below optimal`);
  return parts.length ? capitalize(parts.join(", ")) + "." : "Lineup integrity concern flagged.";
}

function riskWord(t: WeeklyReportTeam): string {
  if (t.emptyStarterSlots > 0 || t.lineupIntegrityScore < 50) return "High";
  if (t.tankingRiskScore >= 50) return "High";
  if (t.lineupIntegrityScore < 75) return "Medium";
  return "Low";
}

function suggestAction(t: WeeklyReportTeam): string {
  if (t.emptyStarterSlots > 0) return "Warning recommended if not fixed before kickoff.";
  if (t.tankingRiskScore >= 50) return "Review context and document findings.";
  return "Send reminder.";
}

const LABEL_DISPLAY = { getLineupIntegrityLabel, integrityLabelDisplay };
export { LABEL_DISPLAY };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Recommended league-policy bylaw text shown in Settings/Help so commissioners
 * have neutral, pre-written rules.
 */
export const RECOMMENDED_POLICY_TEXT =
  "Managers are expected to set a reasonably competitive lineup each week. " +
  "Empty starter slots, players on bye, inactive players, or repeated benching of clearly superior active options " +
  "may result in commissioner review. The commissioner may issue reminders, warnings, or strikes depending on severity " +
  "and repeat history. The system is used as a review aid and does not automatically determine intent.";
