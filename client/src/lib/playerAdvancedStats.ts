/**
 * Player advanced-stats resolver for the full Player Page.
 *
 * The advanced-stats JSON files (client/src/data/advanced_stats/*) are the same
 * ones that power the Position Stats leaderboard. They're keyed by `playerName`
 * (not Sleeper id), so we match by normalized name. This module loads the
 * relevant season files on demand and produces:
 *   - per-season production rows (fantasy points, games, PPG, positional finish)
 *   - the latest season's raw advanced-stat row + columns
 *   - position-specific composite scores (0–100 percentile blends) with rank
 *
 * Pure data shaping — no React. The page wraps this in a small loader hook.
 */

export type AdvStatRow = Record<string, unknown>;
export interface AdvStatColumn {
  key: string;
  label: string;
  type: "number" | "decimal" | "string";
  defaultVisible?: boolean;
}
interface AdvStatFile {
  updated_at: string;
  season: string | number;
  columns: AdvStatColumn[];
  rows: AdvStatRow[];
}

type Pos = "QB" | "RB" | "WR" | "TE";

// Vite needs static string literals for code-split dynamic imports.
const LOADERS: Record<string, () => Promise<{ default: AdvStatFile }>> = {
  qb_2025: () => import("@/data/advanced_stats/qb_advanced_stats_2025.json") as any,
  qb_2024: () => import("@/data/advanced_stats/qb_advanced_stats_2024.json") as any,
  qb_2023: () => import("@/data/advanced_stats/qb_advanced_stats_2023.json") as any,
  rb_2025: () => import("@/data/advanced_stats/rb_advanced_stats_2025.json") as any,
  rb_2024: () => import("@/data/advanced_stats/rb_advanced_stats_2024.json") as any,
  rb_2023: () => import("@/data/advanced_stats/rb_advanced_stats_2023.json") as any,
  wr_2025: () => import("@/data/advanced_stats/wr_advanced_stats_2025.json") as any,
  wr_2024: () => import("@/data/advanced_stats/wr_advanced_stats_2024.json") as any,
  wr_2023: () => import("@/data/advanced_stats/wr_advanced_stats_2023.json") as any,
  te_2025: () => import("@/data/advanced_stats/te_advanced_stats_2025.json") as any,
  te_2024: () => import("@/data/advanced_stats/te_advanced_stats_2024.json") as any,
  te_2023: () => import("@/data/advanced_stats/te_advanced_stats_2023.json") as any,
};

const SEASONS = ["2025", "2024", "2023"] as const;

// ── Composite definitions (higher-is-better component columns only) ──────────
// Each composite blends the percentile ranks of its component stats among all
// qualifying players at the position for that season.
interface CompositeDef {
  label: string;
  keys: string[];
  explanation: string;
}

const COMPOSITES: Record<Pos, CompositeDef[]> = {
  QB: [
    { label: "Volume Score", keys: ["attempts", "completions", "passingYards"], explanation: "How much the offense runs through his arm — dropback volume, completions, and passing yards." },
    { label: "Efficiency Score", keys: ["completionPct", "epaPerPlay", "successRate"], explanation: "How productive each dropback is — completion rate, EPA per play, and success rate." },
    { label: "Accuracy Score", keys: ["onTargetPct", "cpoe"], explanation: "How well he places the ball — on-target throws and completions over expectation." },
    { label: "Rushing Score", keys: ["rushYards", "rushTouchdowns", "rushAttempts"], explanation: "What he adds with his legs — designed-run and scramble production on the ground." },
    { label: "Fantasy Production Score", keys: ["fantasyPoints"], explanation: "Bottom-line fantasy output — total points produced on the season." },
  ],
  RB: [
    { label: "Workload Score", keys: ["rushAttempts", "snapPct", "routes"], explanation: "How heavily he's leaned on — carries, snap share, and routes run." },
    { label: "Efficiency Score", keys: ["yardsPerCarry", "yardsAfterContactPerAttempt", "explosiveRunPct"], explanation: "How much he does with his touches — yards per carry, yards after contact, and explosive runs." },
    { label: "Receiving Score", keys: ["receptions", "receivingYards", "targets", "yardsPerRouteRun"], explanation: "His value in the passing game — receptions, targets, and receiving efficiency." },
    { label: "Scoring Opportunity Score", keys: ["redZoneOpportunities", "goalLineCarries", "rushTouchdowns"], explanation: "His access to points — red-zone and goal-line usage plus rushing scores." },
    { label: "Fantasy Production Score", keys: ["fantasyPoints"], explanation: "Bottom-line fantasy output — total points produced on the season." },
  ],
  WR: [
    { label: "Usage Score", keys: ["routes", "targets", "targetsPerRouteRun", "targetSharePct", "snapPct"], explanation: "How central he is to the passing attack — routes, targets, target share, and per-route usage." },
    { label: "Efficiency Score", keys: ["yardsPerReception", "catchPct", "yardsPerRouteRun"], explanation: "How much he produces per opportunity — yards per catch, catch rate, and yards per route run." },
    { label: "Explosiveness Score", keys: ["airYardsPerReception", "longestReception", "receptions20Plus"], explanation: "His big-play, downfield impact — air yards per catch and chunk-play production." },
    { label: "Scoring Role Score", keys: ["redZoneTargets", "endZoneTargets", "receivingTouchdowns"], explanation: "His role near the end zone — red-zone and end-zone targets plus touchdowns." },
    { label: "Fantasy Production Score", keys: ["fantasyPoints"], explanation: "Bottom-line fantasy output — total points produced on the season." },
  ],
  TE: [
    { label: "Route Involvement Score", keys: ["routes", "routePct", "snapPct"], explanation: "How often he's actually a receiving option — routes run and snaps on the field." },
    { label: "Target Role Score", keys: ["targets", "targetSharePct", "targetsPerRouteRun"], explanation: "How much of the passing game flows through him — target volume, target share, and per-route targets." },
    { label: "Efficiency Score", keys: ["yardsPerReception", "catchPct", "yardsPerRouteRun"], explanation: "How much he produces per opportunity — yards per catch, catch rate, and yards per route run." },
    { label: "Red Zone Score", keys: ["redZoneTargets", "endZoneTargets", "receivingTouchdowns"], explanation: "His role near the end zone — red-zone usage and touchdown production." },
    { label: "Fantasy Production Score", keys: ["fantasyPoints"], explanation: "Bottom-line fantasy output — total points produced on the season." },
  ],
};

// ── Rank Snapshot stat definitions (per position) ────────────────────────────
// Curated stats surfaced as ranked cards. `get` pulls the value from a 2025 row
// (column or derived); `overview` marks the curated default view. Stats where a
// lower number is better (e.g. pressure faced, bad throws) set higherIsBetter:false.
type RankFormat = "int" | "dec1" | "dec2" | "pct0" | "pct1";
interface RankStatDef {
  key: string;
  label: string;
  category: RankCategory;
  overview?: boolean;
  higherIsBetter: boolean;
  format: RankFormat;
  get: (r: AdvStatRow) => number | null;
}

const col = (k: string) => (r: AdvStatRow) => num(r[k]);
const perGame = (k: string) => (r: AdvStatRow) => {
  const v = num(r[k]);
  const g = num(r.games);
  return v != null && g != null && g > 0 ? v / g : null;
};
const POINTS_PER_GAME: RankStatDef = {
  key: "pointsPerGame", label: "Points/Game", category: "production",
  overview: true, higherIsBetter: true, format: "dec1", get: perGame("fantasyPoints"),
};

// WR and TE share an identical column schema.
const RECEIVER_STATS: RankStatDef[] = [
  POINTS_PER_GAME,
  { key: "receivingYards", label: "Receiving Yards", category: "production", overview: true, higherIsBetter: true, format: "int", get: col("receivingYards") },
  { key: "receivingTouchdowns", label: "Receiving TDs", category: "production", higherIsBetter: true, format: "int", get: col("receivingTouchdowns") },
  { key: "receptions", label: "Receptions", category: "production", higherIsBetter: true, format: "int", get: col("receptions") },
  { key: "targets", label: "Targets", category: "production", higherIsBetter: true, format: "int", get: col("targets") },
  { key: "snapPct", label: "Snap Rate", category: "usage", overview: true, higherIsBetter: true, format: "pct0", get: col("snapPct") },
  { key: "routes", label: "Routes Run", category: "usage", higherIsBetter: true, format: "int", get: col("routes") },
  { key: "targetSharePct", label: "Target Share", category: "usage", overview: true, higherIsBetter: true, format: "pct1", get: col("targetSharePct") },
  { key: "airYardsSharePct", label: "Air Yards Share", category: "usage", higherIsBetter: true, format: "pct1", get: col("airYardsSharePct") },
  { key: "redZoneTargets", label: "Red Zone Targets", category: "usage", higherIsBetter: true, format: "int", get: col("redZoneTargets") },
  { key: "yardsPerReception", label: "Yards/Reception", category: "efficiency", higherIsBetter: true, format: "dec1", get: col("yardsPerReception") },
  { key: "yardsPerRouteRun", label: "Yards/Route Run", category: "efficiency", overview: true, higherIsBetter: true, format: "dec2", get: col("yardsPerRouteRun") },
  { key: "catchPct", label: "Catch Rate", category: "efficiency", overview: true, higherIsBetter: true, format: "pct0", get: col("catchPct") },
  { key: "yardsAfterCatchPerReception", label: "YAC/Reception", category: "efficiency", higherIsBetter: true, format: "dec1", get: col("yardsAfterCatchPerReception") },
  { key: "epaPerPlay", label: "Receiving EPA/Play", category: "advanced", overview: true, higherIsBetter: true, format: "dec2", get: col("epaPerPlay") },
  { key: "wopr", label: "WOPR", category: "advanced", overview: true, higherIsBetter: true, format: "dec2", get: col("wopr") },
  { key: "successRate", label: "Success Rate", category: "advanced", higherIsBetter: true, format: "pct0", get: col("successRate") },
];

const RANK_STATS: Record<Pos, RankStatDef[]> = {
  WR: RECEIVER_STATS,
  TE: RECEIVER_STATS,
  RB: [
    POINTS_PER_GAME,
    { key: "rushYards", label: "Rushing Yards", category: "production", overview: true, higherIsBetter: true, format: "int", get: col("rushYards") },
    { key: "rushTouchdowns", label: "Rushing TDs", category: "production", higherIsBetter: true, format: "int", get: col("rushTouchdowns") },
    { key: "receivingYards", label: "Receiving Yards", category: "production", higherIsBetter: true, format: "int", get: col("receivingYards") },
    { key: "receptions", label: "Receptions", category: "production", higherIsBetter: true, format: "int", get: col("receptions") },
    { key: "snapPct", label: "Snap Rate", category: "usage", overview: true, higherIsBetter: true, format: "pct0", get: col("snapPct") },
    { key: "rushAttempts", label: "Carries", category: "usage", overview: true, higherIsBetter: true, format: "int", get: col("rushAttempts") },
    { key: "routes", label: "Routes Run", category: "usage", higherIsBetter: true, format: "int", get: col("routes") },
    { key: "targetSharePct", label: "Target Share", category: "usage", higherIsBetter: true, format: "pct1", get: col("targetSharePct") },
    { key: "redZoneOpportunities", label: "Red Zone Opps", category: "usage", overview: true, higherIsBetter: true, format: "int", get: col("redZoneOpportunities") },
    { key: "yardsPerCarry", label: "Yards/Carry", category: "efficiency", overview: true, higherIsBetter: true, format: "dec1", get: col("yardsPerCarry") },
    { key: "yardsAfterContactPerAttempt", label: "YAC/Attempt", category: "efficiency", higherIsBetter: true, format: "dec1", get: col("yardsAfterContactPerAttempt") },
    { key: "explosiveRunPct", label: "Explosive Run %", category: "efficiency", higherIsBetter: true, format: "pct1", get: col("explosiveRunPct") },
    { key: "yardsPerRouteRun", label: "Yards/Route Run", category: "efficiency", higherIsBetter: true, format: "dec2", get: col("yardsPerRouteRun") },
    { key: "epaPerPlay", label: "EPA/Play", category: "advanced", overview: true, higherIsBetter: true, format: "dec2", get: col("epaPerPlay") },
    { key: "breakawayRunPct", label: "Breakaway %", category: "advanced", higherIsBetter: true, format: "pct1", get: col("breakawayRunPct") },
    { key: "tackleEludedRate", label: "Tackle Eluded %", category: "advanced", overview: true, higherIsBetter: true, format: "pct1", get: col("tackleEludedRate") },
  ],
  QB: [
    POINTS_PER_GAME,
    { key: "passingYards", label: "Passing Yards", category: "production", overview: true, higherIsBetter: true, format: "int", get: col("passingYards") },
    { key: "passingTouchdowns", label: "Passing TDs", category: "production", overview: true, higherIsBetter: true, format: "int", get: col("passingTouchdowns") },
    { key: "rushYards", label: "Rushing Yards", category: "production", higherIsBetter: true, format: "int", get: col("rushYards") },
    { key: "rushTouchdowns", label: "Rushing TDs", category: "production", higherIsBetter: true, format: "int", get: col("rushTouchdowns") },
    { key: "attempts", label: "Pass Attempts", category: "usage", overview: true, higherIsBetter: true, format: "int", get: col("attempts") },
    { key: "completions", label: "Completions", category: "usage", higherIsBetter: true, format: "int", get: col("completions") },
    { key: "completionPct", label: "Completion %", category: "efficiency", overview: true, higherIsBetter: true, format: "pct1", get: col("completionPct") },
    { key: "onTargetPct", label: "On-Target %", category: "efficiency", higherIsBetter: true, format: "pct1", get: col("onTargetPct") },
    { key: "cpoe", label: "CPOE", category: "efficiency", overview: true, higherIsBetter: true, format: "dec1", get: col("cpoe") },
    { key: "badThrowPct", label: "Bad Throw %", category: "efficiency", higherIsBetter: false, format: "pct1", get: col("badThrowPct") },
    { key: "epaPerPlay", label: "EPA/Play", category: "advanced", overview: true, higherIsBetter: true, format: "dec2", get: col("epaPerPlay") },
    { key: "successRate", label: "Success Rate", category: "advanced", higherIsBetter: true, format: "pct0", get: col("successRate") },
    { key: "pressurePct", label: "Pressure %", category: "advanced", overview: true, higherIsBetter: false, format: "pct1", get: col("pressurePct") },
    { key: "sacks", label: "Sacks Taken", category: "advanced", higherIsBetter: false, format: "int", get: col("sacks") },
  ],
};

function fmtRankValue(v: number, f: RankFormat): string {
  switch (f) {
    case "int":  return Math.round(v).toLocaleString();
    case "dec1": return v.toFixed(1);
    case "dec2": return v.toFixed(2);
    case "pct0": return `${Math.round(v)}%`;
    case "pct1": return `${v.toFixed(1)}%`;
  }
}

function rankTier(percentile: number): RankTier {
  if (percentile >= 90) return "elite";
  if (percentile >= 75) return "great";
  if (percentile >= 55) return "solid";
  if (percentile >= 35) return "average";
  return "poor";
}

// "Nico Collins" → "N. Collins" (compact neighbor labels).
function abbrevName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0]) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/** Rank the target player against the full position population for each stat. */
function buildRankCards(pos: Pos, file: AdvStatFile, target: string): RankCard[] {
  const out: RankCard[] = [];
  for (const def of RANK_STATS[pos]) {
    const vals = file.rows
      .map((r) => ({ key: rowName(r), name: String(r.playerName ?? ""), v: def.get(r) }))
      .filter((x): x is { key: string; name: string; v: number } => x.v != null);
    if (!vals.length) continue;
    vals.sort((a, b) => (def.higherIsBetter ? b.v - a.v : a.v - b.v));
    const idx = vals.findIndex((x) => x.key === target);
    if (idx < 0) continue;
    const rank = idx + 1;
    const total = vals.length;
    const percentile = Math.round(((total - rank + 1) / total) * 100);
    out.push({
      key: def.key,
      label: def.label,
      category: def.category,
      overview: !!def.overview,
      position: pos,
      value: fmtRankValue(vals[idx].v, def.format),
      rank,
      total,
      percentile,
      higherIsBetter: def.higherIsBetter,
      behindPlayer: idx > 0 ? abbrevName(vals[idx - 1].name) : null,
      aheadPlayer: idx < total - 1 ? abbrevName(vals[idx + 1].name) : null,
      tier: rankTier(percentile),
    });
  }
  return out;
}

// ── Public types ─────────────────────────────────────────────────────────────
export interface ProductionRow {
  season: string;
  team: string;
  games: number | null;
  // Fantasy PPG by scoring format. The advanced-stats files only carry Standard
  // fantasyPoints, so Half-PPR / PPR are derived by adding the reception bonus.
  ppgStd: number | null;
  ppgHalf: number | null;
  ppgPpr: number | null;
  // Positional finish (1 = best) by scoring format, ranked on season totals.
  finishStd: number | null;
  finishHalf: number | null;
  finishPpr: number | null;
  // PPG-based positional finish (server-provided; optional for adv-built rows).
  ppgFinishStd?: number | null;
  ppgFinishHalf?: number | null;
  ppgFinishPpr?: number | null;
}

export interface CompositeScore {
  label: string;
  score: number | null;      // 0–100
  percentile: number | null; // top X% (lower = better)
  rank: number | null;
  total: number | null;
  explanation: string;
}

export interface PlayerSeasonStats {
  season: string;
  row: AdvStatRow;
  columns: AdvStatColumn[];
}

// ── Rank Snapshot (2025-only per-stat positional ranking) ────────────────────
export type RankCategory = "production" | "usage" | "efficiency" | "advanced";
export type RankTier = "elite" | "great" | "solid" | "average" | "poor";

export interface RankCard {
  key: string;
  label: string;
  category: RankCategory;
  overview: boolean;          // included in the curated "Overview" view
  position: Pos;
  value: string;              // formatted stat value (e.g. "14.7", "86%")
  rank: number;               // 1 = best
  total: number;              // qualifying players at the position
  percentile: number;         // 0–100 (100 = best)
  higherIsBetter: boolean;
  behindPlayer: string | null; // player ranked one spot better ("you're behind them")
  aheadPlayer: string | null;  // player ranked one spot worse ("you're ahead of them")
  tier: RankTier;
}

// ── Season-End Finishes (PPR positional finish per season) ───────────────────
export interface SeasonFinish {
  season: number;
  position: Pos;
  pprPoints: number;      // total PPR fantasy points (Standard + 1/reception)
  games: number;
  pprPpg: number;         // pprPoints / games
  totalRank: number;      // positional finish ranked by total PPR points (1 = best)
  ppgRank: number;        // positional finish ranked by PPR PPG (min-games gated)
  isCurrentSeason: boolean;
}

export interface PlayerAdvancedResult {
  position: Pos;
  seasons: PlayerSeasonStats[]; // most recent first
  latest: PlayerSeasonStats | null;
  composites: CompositeScore[];
  production: ProductionRow[];
  rankCards: RankCard[];        // 2025-only positional rankings for the snapshot
}

// ── Helpers ──────────────────────────────────────────────────────────────────
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function posToKey(pos: string): Pos | null {
  const p = pos.toUpperCase();
  return p === "QB" || p === "RB" || p === "WR" || p === "TE" ? p : null;
}

function rowName(r: AdvStatRow): string {
  return normalizeName(String(r.playerName ?? r.player_name ?? r.name ?? ""));
}

/** Percentile (0–100) of `value` among `values` — fraction at or below. */
function percentileOf(values: number[], value: number): number {
  if (!values.length) return 0;
  const atOrBelow = values.filter((v) => v <= value).length;
  return (atOrBelow / values.length) * 100;
}

/**
 * Load advanced stats for a single player by position + name across seasons.
 * Returns null only when the position has no data files.
 */
export async function loadPlayerAdvancedStats(
  position: string,
  playerName: string,
): Promise<PlayerAdvancedResult | null> {
  const pos = posToKey(position);
  if (!pos) return null;
  const target = normalizeName(playerName);
  const key = pos.toLowerCase();

  const seasons: PlayerSeasonStats[] = [];
  const production: ProductionRow[] = [];

  // Cache loaded files so the composite step can reuse the latest season's rows.
  const loadedBySeason: Record<string, AdvStatFile | null> = {};

  for (const season of SEASONS) {
    const loader = LOADERS[`${key}_${season}`];
    if (!loader) continue;
    let file: AdvStatFile | null = null;
    try {
      file = (await loader()).default;
    } catch {
      file = null;
    }
    loadedBySeason[season] = file;
    if (!file) continue;

    const row = file.rows.find((r) => rowName(r) === target);
    if (!row) continue;

    seasons.push({ season, row, columns: file.columns });

    // Production row: PPG + positional finish for Standard / Half-PPR / PPR.
    // Half-PPR and PPR are derived from Standard fantasyPoints + a per-reception
    // bonus (0.5 / 1.0). Finish ranks all qualifying players in this season's
    // file by that format's season total.
    const fpStd = num(row.fantasyPoints);
    const rec = num(row.receptions) ?? 0;
    const games = num(row.games);
    const fpHalf = fpStd != null ? fpStd + 0.5 * rec : null;
    const fpPpr = fpStd != null ? fpStd + rec : null;

    const finishFor = (mult: number, playerTotal: number | null): number | null => {
      if (playerTotal == null) return null;
      const above = file.rows.filter((r) => {
        const base = num(r.fantasyPoints);
        if (base == null) return false;
        return base + mult * (num(r.receptions) ?? 0) > playerTotal;
      }).length;
      return above + 1;
    };
    const ppgOf = (fp: number | null): number | null =>
      fp != null && games != null && games > 0 ? fp / games : null;

    production.push({
      season,
      team: String(row.team ?? row.nfl_team ?? "—"),
      games,
      ppgStd: ppgOf(fpStd),
      ppgHalf: ppgOf(fpHalf),
      ppgPpr: ppgOf(fpPpr),
      finishStd: finishFor(0, fpStd),
      finishHalf: finishFor(0.5, fpHalf),
      finishPpr: finishFor(1, fpPpr),
    });
  }

  const latest = seasons[0] ?? null;

  // Composite scores from the latest season the player appears in.
  let composites: CompositeScore[] = [];
  if (latest) {
    const file = loadedBySeason[latest.season];
    const defs = COMPOSITES[pos];
    if (file) {
      // Precompute the numeric value arrays for every component column.
      const colValues: Record<string, number[]> = {};
      const allKeys = Array.from(new Set(defs.flatMap((d) => d.keys)));
      for (const k of allKeys) {
        colValues[k] = file.rows.map((r) => num(r[k])).filter((v): v is number => v != null);
      }

      // Per-row composite scores (avg of present component percentiles) so we
      // can rank the target among the field.
      const rowComposite = (r: AdvStatRow, def: CompositeDef): number | null => {
        const parts: number[] = [];
        for (const k of def.keys) {
          const v = num(r[k]);
          if (v == null || !colValues[k]?.length) continue;
          parts.push(percentileOf(colValues[k], v));
        }
        if (!parts.length) return null;
        return parts.reduce((s, p) => s + p, 0) / parts.length;
      };

      composites = defs.map((def) => {
        const targetScore = rowComposite(latest.row, def);
        if (targetScore == null) {
          return { label: def.label, score: null, percentile: null, rank: null, total: null, explanation: def.explanation };
        }
        const allScores = file.rows
          .map((r) => rowComposite(r, def))
          .filter((s): s is number => s != null);
        const total = allScores.length;
        const rank = allScores.filter((s) => s > targetScore).length + 1;
        const percentile = total > 0 ? Math.max(1, Math.round((rank / total) * 100)) : null;
        return {
          label: def.label,
          score: Math.round(targetScore),
          percentile,
          rank,
          total,
          explanation: def.explanation,
        };
      });
    }
  }

  // Rank snapshot uses the 2025 file specifically (per product spec), regardless
  // of which season is `latest`. Empty when the player has no 2025 row.
  let rankCards: RankCard[] = [];
  const file2025 = loadedBySeason["2025"];
  if (file2025 && file2025.rows.some((r) => rowName(r) === target)) {
    rankCards = buildRankCards(pos, file2025, target);
  }

  return { position: pos, seasons, latest, composites, production, rankCards };
}
