/**
 * Shared types for League Activity Monitoring (Commissioner Command).
 *
 * Phase 1 is a read-only analysis pipeline: we ingest Sleeper transactions,
 * rosters, users, and matchups, normalize them into activity events, score
 * per-manager and league-wide activity, and raise alerts. Nothing here ever
 * writes back to Sleeper or messages managers. See ./ingestLeagueActivity.ts.
 */

// ── Sleeper raw shapes (subset of the fields we rely on) ─────────────────────

export interface SleeperTransaction {
  transaction_id: string;
  type: string; // "trade" | "waiver" | "free_agent" | ...
  status?: string; // "complete" | "failed" | ...
  created?: number; // epoch ms
  status_updated?: number; // epoch ms
  roster_ids?: number[];
  consenter_ids?: number[];
  adds?: Record<string, number> | null; // playerId -> rosterId
  drops?: Record<string, number> | null; // playerId -> rosterId
  draft_picks?: unknown[] | null;
  waiver_budget?: Array<{ sender: number; receiver: number; amount: number }> | null;
  metadata?: Record<string, unknown> | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id?: string | null;
  co_owners?: string[] | null;
  players?: string[] | null;
  starters?: string[] | null;
  reserve?: string[] | null; // IR
  taxi?: string[] | null;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    total_moves?: number;
    waiver_budget_used?: number;
    fpts?: number;
    [k: string]: unknown;
  } | null;
}

export interface SleeperLeagueUser {
  user_id: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  metadata?: { team_name?: string | null } | null;
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id?: number | null;
  starters?: Array<string | null> | null;
  players?: string[] | null;
  points?: number | null;
  starters_points?: number[] | null;
}

export interface SleeperNflState {
  week?: number;
  season?: string;
  season_type?: string; // "pre" | "regular" | "post" | "off"
  display_week?: number;
  league_season?: string;
}

// ── Normalized activity event ────────────────────────────────────────────────

export type ActivityEventType =
  | "trade"
  | "waiver"
  | "free_agent"
  | "drop"
  | "add"
  | "lineup_change"
  | "lineup_unchanged"
  | "empty_starter"
  | "bye_starter"
  | "inactive_starter"
  | "ir_starter"
  | "payment_note"
  | "commissioner_note";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface ActivityEvent {
  leagueId: string;
  season: string;
  week: number;
  rosterId?: number | null;
  ownerId?: string | null;
  eventType: ActivityEventType;
  eventTitle: string;
  eventDescription?: string;
  transactionId?: string;
  relatedPlayerIds?: string[];
  relatedRosterIds?: number[];
  eventTs?: number | null;
  severity: Severity;
  rawEvent?: unknown;
}

// ── Manager / league flags ───────────────────────────────────────────────────

export type ManagerActivityFlag =
  | "no_recent_transactions"
  | "lineup_unchanged"
  | "empty_starter"
  | "low_activity_score"
  | "high_inactivity_risk"
  | "possible_orphan_risk";

export type LeagueActivityFlag =
  | "low_transaction_volume"
  | "multiple_inactive_managers"
  | "multiple_empty_lineups"
  | "low_lineup_change_rate"
  | "league_at_risk";

export type ActivityLabel =
  | "highly_active"
  | "active"
  | "quiet"
  | "inactive_risk"
  | "inactive"
  | "unknown";

export type LeagueActivityLabel =
  | "thriving"
  | "healthy"
  | "average"
  | "low_activity"
  | "at_risk"
  | "unknown";

export type InactivityRiskLabel = "low" | "medium" | "high" | "critical";

// ── In-memory rows passed between services (camelCase, pre-persistence) ───────

export interface ManagerActivityRow {
  leagueId: string;
  season: string;
  week: number;
  rosterId: number;
  ownerId: string | null;
  managerName: string;
  teamName: string;

  transactionsCount: number;
  tradesCount: number;
  waiverCount: number;
  freeAgentCount: number;
  addsCount: number;
  dropsCount: number;

  lineupChanged: boolean;
  lineupChangeCount: number;
  emptyStarterSlots: number;

  lastTransactionTs: number | null;
  lastLineupChangeTs: number | null;

  weeksSinceTransaction: number | null;
  weeksSinceLineupChange: number | null;

  activityScore: number;
  inactivityRiskScore: number;
  activityLabel: ActivityLabel;

  flags: ManagerActivityFlag[];

  rawRoster?: unknown;
  rawMatchup?: unknown;
}

export interface LeagueSnapshotRow {
  leagueId: string;
  season: string;
  week: number;

  totalTransactions: number;
  totalTrades: number;
  totalWaivers: number;
  totalFreeAgentMoves: number;
  totalLineupChanges: number;
  totalEmptyStarterSlots: number;

  activeManagerCount: number;
  inactiveManagerCount: number;

  leagueActivityScore: number;
  leagueActivityLabel: LeagueActivityLabel;

  rawSummary: Record<string, unknown>;
}

export interface ActivityAlertRow {
  leagueId: string;
  season: string;
  week: number | null;
  rosterId: number | null;
  ownerId: string | null;
  alertType: string;
  severity: Severity;
  title: string;
  description: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
}

// ── Effective settings (merged defaults + DB overrides) ──────────────────────

export interface ActivitySettings {
  inactiveTransactionWeeks: number;
  inactiveLineupWeeks: number;
  unchangedLineupWeeks: number;

  flagEmptyStarters: boolean;
  flagNoTransactions: boolean;
  flagUnchangedLineups: boolean;
  flagLowLeagueActivity: boolean;

  lowActivityScoreThreshold: number;
  inactiveManagerScoreThreshold: number;

  ignoreLineupChecksInOffseason: boolean;
  ignoreLineupChecksForBestBall: boolean;
  includeTradesInActivityScore: boolean;
  includeWaiversInActivityScore: boolean;
  includeFreeAgentMovesInActivityScore: boolean;
}

export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = {
  inactiveTransactionWeeks: 3,
  inactiveLineupWeeks: 2,
  unchangedLineupWeeks: 2,
  flagEmptyStarters: true,
  flagNoTransactions: true,
  flagUnchangedLineups: true,
  flagLowLeagueActivity: true,
  lowActivityScoreThreshold: 40,
  inactiveManagerScoreThreshold: 60,
  ignoreLineupChecksInOffseason: true,
  ignoreLineupChecksForBestBall: true,
  includeTradesInActivityScore: true,
  includeWaiversInActivityScore: true,
  includeFreeAgentMovesInActivityScore: true,
};

/** League context that influences scoring (best ball / offseason). */
export interface LeagueActivityContext {
  /** True for best-ball leagues — lineup change penalties are disabled. */
  bestBall: boolean;
  /** Sleeper season_type ("regular" enables lineup-based scoring). */
  seasonType: string;
}
