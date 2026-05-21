// ── Draft Command type definitions ───────────────────────────────────────────
//
// These mirror the Sleeper draft data shape we'll normalize from the public
// API once the backend adapter is wired. The frontend operates on these
// stable shapes so the UI is decoupled from raw Sleeper payloads.

export type DraftType = "startup" | "rookie" | "supplemental";
export type DraftFormat = "snake" | "auction" | "linear";
export type ScoringType = "ppr" | "half" | "standard";
export type LeagueMode = "dynasty" | "keeper" | "redraft";
export type PassTd = 4 | 6;
export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "PICK";

// Rookie mode the user has selected. Drives which rows are included.
export type RookieMode = "picks" | "direct" | "both";

export interface DraftRecord {
  draft_id: string;
  league_id: string | null;
  season: string;
  draft_type: DraftType;
  status: "complete" | "drafting" | "pre_draft";
  created_at: string;       // ISO
  completed_at: string | null;
  teams: number;
  scoring_type: ScoringType;
  best_ball: boolean;
  superflex: boolean;
  te_premium: boolean;
  pass_td: PassTd;
  roster_size: number;
  starter_count: number;
  league_mode: LeagueMode;
  uses_rookie_placeholders: boolean;
  directly_drafted_rookies: boolean;
  source: "sleeper";
}

export interface PickRecord {
  draft_id: string;
  pick_no: number;            // overall pick (1-based)
  round: number;
  pick_in_round: number;
  player_id: string;          // stable id — sleeper id OR normalized rookie pick id
  player_name: string;
  position: Position;
  team: string;               // NFL team, "FA", or "" for rookie placeholders
  is_rookie: boolean;
  is_rookie_placeholder: boolean;
  rookie_pick_label: string | null; // e.g. "2026 Rookie 1.01"
  picked_by: string | null;
  metadata?: Record<string, unknown>;
}

export interface ADPResult {
  player_id: string;
  player_name: string;
  position: Position;
  team: string;
  is_rookie_placeholder: boolean;
  rookie_pick_label?: string | null;
  avg_pick: number;
  median_pick: number;
  min_pick: number;
  max_pick: number;
  // Middle 80% pick band — present on rows produced by the new aggregator.
  // Older cached responses may omit these; treat as optional client-side.
  p10_pick?: number;
  p90_pick?: number;
  draft_count: number;
  positional_rank: number;
  overall_rank: number;
  trend_7d: number;           // negative = rising (ADP getting smaller); positive = falling
  trend_30d: number;
  sample_size_warning: boolean;
}

// Filters captured by the settings panel.
export interface DraftFilters {
  /**
   * NFL season(s) to include. Default = current calendar year. Use "all" to
   * disable season filtering (admin tooling only — public reads should be
   * season-scoped, otherwise 2026 picks blend into the historical mean).
   */
  season: string | string[] | "all";
  dateRange: { start: string; end: string }; // ISO dates
  draftType: DraftType | "all";
  draftFormat: DraftFormat | "all";
  rookieMode: RookieMode;
  teams: number | "all";
  scoring: ScoringType | "all";
  passTd: PassTd | "all";
  tePremium: "yes" | "no" | "all";
  starters: number | "all";
  rosterSize: number | "all";
  bestBall: "yes" | "no" | "all";
  superflex: "yes" | "no" | "all";
  leagueMode: LeagueMode | "all";
  search: string;
}

export const DEFAULT_FILTERS: DraftFilters = {
  season: String(new Date().getFullYear()),
  dateRange: defaultDateRange(),
  draftType: "startup",
  draftFormat: "snake",
  rookieMode: "direct",
  teams: 12,
  scoring: "ppr",
  passTd: "all",
  tePremium: "yes",
  starters: "all",
  rosterSize: "all",
  bestBall: "no",
  superflex: "yes",
  leagueMode: "dynasty",
  search: "",
};

function defaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
