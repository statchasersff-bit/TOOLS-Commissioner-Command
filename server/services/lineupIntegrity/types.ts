/**
 * Shared types for Lineup Integrity & Anti-Tanking (Commissioner Command).
 *
 * Phase 1 is a read-only, decision-support pipeline: scan weekly Sleeper
 * matchups + rosters, detect lineup issues (empty / bye / inactive / IR
 * starters, suspicious benchings, large optimality gaps), score lineup
 * integrity and tanking RISK, raise alerts, and let a commissioner record
 * notes, strikes, and decisions. Nothing here ever writes back to Sleeper,
 * messages managers, or changes standings.
 *
 * Language rule: this system surfaces "potential signals", never accusations.
 */

// ── Effective settings (DB row merged onto defaults) ─────────────────────────

export interface LineupIntegritySettings {
  enableEmptySlotChecks: boolean;
  enableByeStarterChecks: boolean;
  /** Legacy master toggle for OUT/IR/doubtful; the three granular flags below
   *  fall back to it when unset. Still read by older settings rows. */
  enableInactiveStarterChecks: boolean;
  enableOutStarterChecks: boolean;
  enableIrStarterChecks: boolean;
  enableDoubtfulStarterChecks: boolean;
  enableUnchangedLineupChecks: boolean;
  enableSuspiciousBenchingChecks: boolean;
  enableTankingRiskChecks: boolean;

  suspiciousBenchingValueGap: number;
  suspiciousBenchingProjectionGap: number;
  optimalityGapWarning: number;
  optimalityGapCritical: number;

  repeatIssueWeeks: number;
  strikeAfterRepeatIssues: number;

  playoffIntegrityStartWeek: number;

  ignoreLineupChecksInOffseason: boolean;
  ignoreLineupChecksForBestBall: boolean;
  ignoreEliminatedTeams: boolean;

  autoCreateAlerts: boolean;
  autoCreateStrikes: boolean;
}

export const DEFAULT_LINEUP_INTEGRITY_SETTINGS: LineupIntegritySettings = {
  enableEmptySlotChecks: true,
  enableByeStarterChecks: true,
  enableInactiveStarterChecks: true,
  enableOutStarterChecks: true,
  enableIrStarterChecks: true,
  enableDoubtfulStarterChecks: true,
  enableUnchangedLineupChecks: false,
  enableSuspiciousBenchingChecks: true,
  enableTankingRiskChecks: true,

  suspiciousBenchingValueGap: 1500,
  suspiciousBenchingProjectionGap: 6,
  optimalityGapWarning: 12,
  optimalityGapCritical: 25,

  repeatIssueWeeks: 2,
  strikeAfterRepeatIssues: 2,

  playoffIntegrityStartWeek: 10,

  ignoreLineupChecksInOffseason: true,
  ignoreLineupChecksForBestBall: true,
  ignoreEliminatedTeams: false,

  autoCreateAlerts: true,
  autoCreateStrikes: false,
};

// ── Player-level evaluation row (pre-persistence, camelCase) ─────────────────

export interface PlayerCheck {
  playerId: string;
  playerName: string;
  position: string;
  team: string | null;

  lineupSlot: string | null; // e.g. "QB" | "FLEX" | "BN" (bench)
  isStarter: boolean;
  isBench: boolean;

  injuryStatus: string | null;
  activeStatus: string | null;
  isOnBye: boolean;
  isInactive: boolean;
  isIr: boolean;
  isDoubtful: boolean;

  projection: number;
  playerValue: number;
  rankScore: number;
  valueSource: string;

  // Filled in by suspicious-benching detection.
  betterBenchOption: boolean;
  betterBenchPlayerId: string | null;
  betterBenchPlayerName: string | null;
  valueGapVsBench: number;
  projectionGapVsBench: number;

  flags: string[];
}

// ── Lineup-level check row (pre-persistence, camelCase) ──────────────────────

export type TankingRiskLabel = "low" | "medium" | "high" | "critical";
export type IntegrityLabel =
  | "clean"
  | "minor_issue"
  | "needs_review"
  | "serious_issue"
  | "critical";
export type ReviewStatus =
  | "none"
  | "needs_review"
  | "reviewed"
  | "warning_sent"
  | "strike_issued"
  | "dismissed"
  | "resolved";

export interface SuspiciousBenching {
  starterPlayerId: string;
  starterName: string;
  benchPlayerId: string;
  benchName: string;
  lineupSlot: string | null;
  projectionGap: number;
  valueGap: number;
  reason: string;
}

export interface OptimalSlot {
  slot: string;
  playerId: string | null;
  playerName?: string | null;
  projection: number;
}

export interface LineupCheckRow {
  leagueId: string;
  season: string;
  week: number;

  rosterId: number;
  ownerId: string | null;
  managerName: string;
  teamName: string;

  starters: Array<string | null>;
  benchPlayers: string[];
  allPlayers: string[];

  emptyStarterSlots: number;
  byeStarters: number;
  inactiveStarters: number;
  irStarters: number;
  doubtfulStarters: number;

  suspiciousBenchings: number;
  optimalityGap: number;
  optimalityGapPct: number;

  projectedStarterPoints: number;
  projectedOptimalPoints: number;

  lineupIntegrityScore: number;
  tankingRiskScore: number;

  riskLabel: TankingRiskLabel;
  reviewStatus: ReviewStatus;

  flags: string[];
  rawMatchup: unknown;

  // Carried alongside for persistence + alert generation (not stored on the
  // lineup-check row itself).
  playerChecks: PlayerCheck[];
  suspiciousBenchingDetails: SuspiciousBenching[];
  optimalSlots: OptimalSlot[];
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export type LineupAlertType =
  | "empty_starter"
  | "bye_starter"
  | "inactive_starter"
  | "ir_starter"
  | "doubtful_starter"
  | "unchanged_lineup"
  | "suspicious_benching"
  | "large_optimality_gap"
  | "repeat_lineup_issue"
  | "potential_tanking"
  | "playoff_integrity";

export type AlertSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface LineupAlertRow {
  leagueId: string;
  season: string;
  week: number;
  rosterId: number;
  ownerId: string | null;
  alertType: LineupAlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  suggestedAction: string;
}

// ── Roster context for tanking risk ──────────────────────────────────────────

export interface RosterContext {
  rosterId: number;
  ownerId: string | null;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  totalMoves: number;
  ownsOwnFirst: boolean;
  isEliminated: boolean;
  recentActivityScore?: number;
  repeatIssueCount: number;
  playoffImpactMatchup: boolean;
}
