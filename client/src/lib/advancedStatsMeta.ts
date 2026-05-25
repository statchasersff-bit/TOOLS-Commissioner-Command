/**
 * Shared advanced-stats metadata + composite-score wiring.
 *
 * This is the single source of truth for the column → section grouping, the
 * per-section accent colours, the composite-score engines, and the value
 * formatter. The Position Stats tab, the Field View cards, and the player
 * detail modal all build on it so their section headers / grades stay
 * consistent.
 */
import { computeQbCompositeScores, QB_SCORE_CATEGORIES } from "./qbCompositeScores";
import { computeRbCompositeScores, RB_SCORE_CATEGORIES } from "./rbCompositeScores";
import {
  computeWrCompositeScores,
  computeTeCompositeScores,
  WR_SCORE_CATEGORIES,
  TE_SCORE_CATEGORIES,
} from "./receivingComposites";

// ── Types ───────────────────────────────────────────────────────────────────
export type StatPosition = "qb" | "rb" | "wr" | "te";

export interface ColDef {
  key: string;
  label: string;
  type: "number" | "decimal" | "string";
  defaultVisible: boolean;
}

export interface AdvancedStatsData {
  updated_at: string;
  season: string | number;
  week: number | null;
  table: string;
  columns: ColDef[];
  rows: Record<string, unknown>[];
}

// ── Column visibility sets ────────────────────────────────────────────────────
// Columns that are always pinned left / identity columns (not real stats).
export const PINNED_KEYS = new Set(["rank", "playerName", "player_name", "name", "team", "nfl_team"]);
// Columns that are never shown (redundant or no underlying data).
export const ALWAYS_HIDDEN = new Set([
  "playerId", "player_id", "sleeper_id", "sleeperId",
  "season",
  "contestedCatchRate", "yardsAfterContactPerReception",
]);

// ── Section grouping (column key → section label) ─────────────────────────────
const QB_COLUMN_GROUPS: Record<string, string> = {
  overallQBGrade: "Composite Grades", volumeScore: "Composite Grades",
  accuracyScore: "Composite Grades", explosivenessScore: "Composite Grades",
  mobilityScore: "Composite Grades", efficiencyScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  attempts: "Volume / Usage", completions: "Volume / Usage", passingYards: "Volume / Usage",
  airYards: "Volume / Usage", completedAirYards: "Volume / Usage", redZoneAttempts: "Volume / Usage",
  passingTouchdowns: "Volume / Usage", rushAttempts: "Volume / Usage", rushYards: "Volume / Usage",
  rushTouchdowns: "Volume / Usage",
  airYardsPerAttempt: "Aggressiveness",
  completedAirYardsPerCompletion: "Aggressiveness",
  yardsPerCatch: "Aggressiveness",
  completionPct: "Efficiency", onTargetPct: "Efficiency", poorThrows: "Efficiency",
  badThrowPct: "Efficiency", interceptions: "Efficiency", epaPerPlay: "Efficiency",
  successRate: "Efficiency", cpoe: "Efficiency",
  passes10Plus: "Explosiveness", passes20Plus: "Explosiveness", passes30Plus: "Explosiveness",
  passes40Plus: "Explosiveness", passes50Plus: "Explosiveness", longestPass: "Explosiveness",
  deepAttemptPct: "Explosiveness",
  pocketTime: "Pressure & Pocket", timeToThrow: "Pressure & Pocket", throwaways: "Pressure & Pocket",
  battedPasses: "Pressure & Pocket", scrambleRate: "Pressure & Pocket", yardsPerScramble: "Pressure & Pocket",
  hurries: "Pressure & Pocket", blitzes: "Pressure & Pocket", knockdowns: "Pressure & Pocket",
  sacks: "Pressure & Pocket", sackYardsLost: "Pressure & Pocket", fumbles: "Pressure & Pocket",
  pressurePct: "Pressure & Pocket",
};

const RB_COLUMN_GROUPS: Record<string, string> = {
  overallRBGrade: "Composite Grades", volumeScore: "Composite Grades",
  efficiencyScore: "Composite Grades", explosivenessScore: "Composite Grades",
  receivingScore: "Composite Grades", elusivenessScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  snapPct: "Usage / Workload", routes: "Usage / Workload", rushAttempts: "Usage / Workload",
  redZoneOpportunities: "Usage / Workload", goalLineCarries: "Usage / Workload",
  targets: "Usage / Workload", targetSharePct: "Usage / Workload", receptions: "Usage / Workload",
  redZoneTargets: "Usage / Workload", endZoneTargets: "Usage / Workload",
  rushYards: "Production", yardsPerCarry: "Production", rushTouchdowns: "Production",
  receivingYards: "Production", yardsPerReception: "Production", receivingYardsAfterCatch: "Production",
  yardsPerRouteRun: "Production", receivingTouchdowns: "Production", epaPerPlay: "Production",
  rushes10Plus: "Explosive Play Ability", rushes20Plus: "Explosive Play Ability",
  rushes30Plus: "Explosive Play Ability", rushes40Plus: "Explosive Play Ability",
  rushes50Plus: "Explosive Play Ability", explosiveRunPct: "Explosive Play Ability",
  breakawayRunPct: "Explosive Play Ability", longestRush: "Explosive Play Ability",
  longestRushTouchdown: "Explosive Play Ability",
  brokenTackles: "Contact & Tackle Breaking", rushAttemptsPerBrokenTackle: "Contact & Tackle Breaking",
  yardsBeforeContactPerAttempt: "Contact & Tackle Breaking",
  yardsAfterContactPerAttempt: "Contact & Tackle Breaking", tackleEludedRate: "Contact & Tackle Breaking",
  fumbles: "Ball Security / Negative Plays", tacklesForLoss: "Ball Security / Negative Plays",
  tacklesForLossYards: "Ball Security / Negative Plays", rushAttForNegativeYards: "Ball Security / Negative Plays",
};

// WR and TE share the same columns, so they share one group map.
const WR_TE_COLUMN_GROUPS: Record<string, string> = {
  overallWRGrade: "Composite Grades", overallTEGrade: "Composite Grades",
  volumeScore: "Composite Grades", efficiencyScore: "Composite Grades",
  explosivenessScore: "Composite Grades", handsScore: "Composite Grades",
  elusivenessScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  snapPct: "Usage/Role", routes: "Usage/Role", routePct: "Usage/Role", targets: "Usage/Role",
  targetsPerRouteRun: "Usage/Role", targetSharePct: "Usage/Role", airYardsPerTarget: "Usage/Role",
  airYardsPerReception: "Usage/Role", airYardsSharePct: "Usage/Role", wopr: "Usage/Role",
  redZoneTargets: "Usage/Role", endZoneTargets: "Usage/Role",
  receptions: "Production", receivingYards: "Production",
  yardsBeforeCatchPerReception: "Production", yardsAfterCatchPerReception: "Production",
  yardsPerReception: "Production", yardsPerRouteRun: "Production", receivingTouchdowns: "Production",
  epaPerPlay: "Production", successRate: "Production",
  catchPct: "Hands", contestedCatchRate: "Hands", catchableTargets: "Hands", drops: "Hands",
  dropPct: "Hands", interceptionsWhenTargeted: "Hands", fumbles: "Hands",
  avoidedTackleRate: "Elusiveness", brokenTackles: "Elusiveness",
  yardsAfterContactPerReception: "Elusiveness",
  receptions10Plus: "Explosiveness", receptions20Plus: "Explosiveness",
  receptions30Plus: "Explosiveness", receptions40Plus: "Explosiveness",
  receptions50Plus: "Explosiveness", longestReception: "Explosiveness",
};

export const COLUMN_GROUPS_BY_POSITION: Record<string, Record<string, string>> = {
  qb: QB_COLUMN_GROUPS,
  rb: RB_COLUMN_GROUPS,
  wr: WR_TE_COLUMN_GROUPS,
  te: WR_TE_COLUMN_GROUPS,
};

// ── Section accent colours ────────────────────────────────────────────────────
export const SECTION_ACCENTS: Record<string, string> = {
  "Composite Grades":             "#d4af37", // gold
  "Player Info":                  "#94a3b8", // slate
  "Volume / Usage":               "#f59e0b", // amber
  "Usage / Workload":             "#f59e0b",
  "Usage/Role":                   "#f59e0b",
  "Aggressiveness":  "#fb923c", // orange
  "Efficiency":                   "#60a5fa", // blue
  "Production":                   "#34d399", // emerald
  "Explosiveness":                "#c084fc", // purple
  "Explosive Play Ability":       "#c084fc",
  "Pressure & Pocket":            "#22d3ee", // cyan
  "Hands":                        "#2dd4bf", // teal
  "Elusiveness":                  "#fb7185", // rose
  "Contact & Tackle Breaking":    "#22d3ee",
  "Ball Security / Negative Plays":"#f87171", // red
};
export const sectionAccent = (label: string): string => SECTION_ACCENTS[label] ?? "#94a3b8";
export const SECTION_BAR_GRADIENT = "linear-gradient(90deg, rgba(20,35,60,0.97) 0%, rgba(12,22,40,0.97) 100%)";
export const SECTION_BAR_END = "rgba(12,22,40,0.97)";

// ── Composite-score engines ───────────────────────────────────────────────────
export interface ScoreCategoryMeta { key: string; label: string; shortLabel: string; description: string }
export interface ScoreEngine {
  compute: (rows: Record<string, unknown>[]) => Array<Record<string, number>>;
  categories: ScoreCategoryMeta[];
}
export const SCORE_ENGINES: Record<StatPosition, ScoreEngine> = {
  // QB/RB engines return nominal interfaces (all-number fields); cast to the
  // shared index-signature shape consumers read.
  qb: { compute: computeQbCompositeScores as unknown as ScoreEngine["compute"], categories: QB_SCORE_CATEGORIES },
  rb: { compute: computeRbCompositeScores as unknown as ScoreEngine["compute"], categories: RB_SCORE_CATEGORIES },
  wr: { compute: computeWrCompositeScores, categories: WR_SCORE_CATEGORIES },
  te: { compute: computeTeCompositeScores, categories: TE_SCORE_CATEGORIES },
};

// Bundled advanced-stats pools (latest season) — string literals required for
// Vite code-splitting.
export const ADV_STATS_LOADERS: Record<StatPosition, () => Promise<{ default: AdvancedStatsData }>> = {
  qb: () => import("@/data/advanced_stats/qb_advanced_stats_2025.json") as unknown as Promise<{ default: AdvancedStatsData }>,
  rb: () => import("@/data/advanced_stats/rb_advanced_stats_2025.json") as unknown as Promise<{ default: AdvancedStatsData }>,
  wr: () => import("@/data/advanced_stats/wr_advanced_stats_2025.json") as unknown as Promise<{ default: AdvancedStatsData }>,
  te: () => import("@/data/advanced_stats/te_advanced_stats_2025.json") as unknown as Promise<{ default: AdvancedStatsData }>,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
export const normalizeName = (n: string): string => n.toLowerCase().replace(/[^a-z0-9]/g, "");

export function formatVal(v: unknown, type: ColDef["type"]): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (type === "decimal") return v.toFixed(2);
    if (Number.isInteger(v)) return v.toLocaleString();
    return Math.abs(v) >= 1000 ? v.toLocaleString() : v.toFixed(2);
  }
  if (typeof v === "string") return v || "—";
  if (typeof v === "boolean") return v ? "✓" : "—";
  return String(v);
}

export function numVal(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return -Infinity;
}

/** All stat columns for a position pool, grouped by section in column order. */
export function groupColumns(
  position: StatPosition,
  columns: ColDef[],
): Array<{ label: string; accent: string; cols: ColDef[] }> {
  const groupMap = COLUMN_GROUPS_BY_POSITION[position];
  const order: string[] = [];
  const byLabel = new Map<string, ColDef[]>();
  for (const c of columns) {
    if (PINNED_KEYS.has(c.key) || ALWAYS_HIDDEN.has(c.key)) continue;
    const label = groupMap?.[c.key] ?? "Other";
    if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label); }
    byLabel.get(label)!.push(c);
  }
  return order.map((label) => ({ label, accent: sectionAccent(label), cols: byLabel.get(label)! }));
}
