/**
 * Shared types for the Trade Review Center (Commissioner decision-support).
 *
 * Phase 1 is intentionally a read-only analysis pipeline: nothing here ever
 * writes back to Sleeper. We ingest trade transactions, normalize the assets
 * moved, score value/risk, raise flags, and surface everything to a commissioner
 * who makes the actual call. See ./ingestSleeperTrades.ts for the orchestration.
 */

/** A normalized asset moved within a trade (player, draft pick, or FAAB). */
export interface ParsedTradeAsset {
  assetType: "player" | "pick" | "faab";
  playerId?: string;
  playerName?: string;
  position?: string;
  team?: string;
  pickSeason?: string;
  pickRound?: number;
  pickOriginalRosterId?: number;
  faabAmount?: number;
  fromRosterId?: number;
  toRosterId?: number;
  /** Filled in by the value service after parsing. */
  assetValue?: number;
  assetValueSource?: string;
}

/** Minimal shape of a Sleeper player record we rely on. */
export interface SleeperPlayerLite {
  player_id?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position?: string | null;
  team?: string | null;
  age?: number | null;
}

/** Minimal shape of a Sleeper trade transaction. */
export interface SleeperTransaction {
  transaction_id: string;
  type: string;
  status?: string;
  created?: number;
  status_updated?: number;
  roster_ids?: number[];
  consenter_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  draft_picks?: Array<{
    season: string | number;
    round: number;
    roster_id: number; // original owner roster
    previous_owner_id: number;
    owner_id: number;
  }> | null;
  waiver_budget?: Array<{ sender: number; receiver: number; amount: number }> | null;
  metadata?: Record<string, unknown> | null;
}

/** Sleeper roster record (subset). */
export interface SleeperRosterLite {
  roster_id: number;
  owner_id?: string | null;
}

/** Sleeper league-user record (subset). */
export interface SleeperLeagueUserLite {
  user_id: string;
  display_name?: string;
  username?: string;
  metadata?: { team_name?: string } | null;
}

/** Resolved manager identity for a roster id. */
export interface ManagerIdentity {
  rosterId: number;
  ownerId: string | null;
  /** Manager handle (username/display name). */
  managerName: string;
  /** Team name (falls back to "Team N"). */
  teamName: string;
}

/** League settings that influence value adjustments. */
export interface LeagueValueSettings {
  superflex: boolean;
  tep: boolean;
  bestBall: boolean;
  /** Number of starting slots (deeper lineups bump depth value). */
  starters?: number;
}

/** Commissioner-configurable thresholds for the Trade Review Center. */
export interface TradeReviewSettings {
  lopsidedThresholdPct: number;
  highRiskThresholdPct: number;
  autoQueueFutureFirsts: boolean;
  autoQueueMultipleFuturePicks: boolean;
  repeatPartnerThreshold: number;
  requireFutureDuesForFuturePickTrades: boolean;
  showValueInPublicSummary: boolean;
  valueSource: string;
}

export const DEFAULT_TRADE_REVIEW_SETTINGS: TradeReviewSettings = {
  lopsidedThresholdPct: 15,
  highRiskThresholdPct: 25,
  autoQueueFutureFirsts: true,
  autoQueueMultipleFuturePicks: true,
  repeatPartnerThreshold: 3,
  requireFutureDuesForFuturePickTrades: true,
  showValueInPublicSummary: true,
  valueSource: "default",
};

export type ReviewStatus =
  | "unreviewed"
  | "reviewed"
  | "watchlist"
  | "disputed"
  | "no_action";

export type RiskLabel = "low" | "medium" | "high" | "critical";
export type FairnessLabel = "fair" | "slightly_unbalanced" | "lopsided" | "severe";
export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface TradeFlag {
  flagType: string;
  severity: Severity;
  title: string;
  description: string;
}

/** Output of the scoring service. */
export interface TradeScore {
  totalValueByRoster: Record<string, number>;
  valueDiffAbs: number;
  valueDiffPct: number;
  fairnessScore: number;
  riskScore: number;
}
