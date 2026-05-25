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
    { label: "Volume Score", keys: ["attempts", "completions", "passingYards"], explanation: "Driven by dropback volume, completions, and passing yards." },
    { label: "Efficiency Score", keys: ["completionPct", "epaPerPlay", "successRate"], explanation: "Completion rate, EPA per play, and success rate." },
    { label: "Accuracy Score", keys: ["onTargetPct", "cpoe"], explanation: "On-target rate and completion percentage over expected." },
    { label: "Rushing Score", keys: ["rushYards", "rushTouchdowns", "rushAttempts"], explanation: "Designed-run and scramble production on the ground." },
    { label: "Fantasy Production Score", keys: ["fantasyPoints"], explanation: "Total fantasy points produced." },
  ],
  RB: [
    { label: "Workload Score", keys: ["rushAttempts", "snapPct", "routes"], explanation: "Carries, snap share, and routes run." },
    { label: "Efficiency Score", keys: ["yardsPerCarry", "yardsAfterContactPerAttempt", "explosiveRunPct"], explanation: "Yards per carry, yards after contact, and explosive-run rate." },
    { label: "Receiving Score", keys: ["receptions", "receivingYards", "targets", "yardsPerRouteRun"], explanation: "Passing-game involvement and receiving efficiency." },
    { label: "Scoring Opportunity Score", keys: ["redZoneOpportunities", "goalLineCarries", "rushTouchdowns"], explanation: "Red-zone and goal-line usage plus rushing scores." },
    { label: "Fantasy Production Score", keys: ["fantasyPoints"], explanation: "Total fantasy points produced." },
  ],
  WR: [
    { label: "Usage Score", keys: ["routes", "targets", "targetsPerRouteRun", "targetSharePct", "snapPct"], explanation: "Routes, targets, target share, and per-route usage." },
    { label: "Efficiency Score", keys: ["yardsPerReception", "catchPct", "yardsPerRouteRun"], explanation: "Yards per catch, catch rate, and yards per route run." },
    { label: "Explosiveness Score", keys: ["airYardsPerReception", "longestReception", "receptions20Plus"], explanation: "Downfield air yards and big-play production." },
    { label: "Scoring Role Score", keys: ["redZoneTargets", "endZoneTargets", "receivingTouchdowns"], explanation: "Red-zone and end-zone target volume plus scores." },
    { label: "Fantasy Production Score", keys: ["fantasyPoints"], explanation: "Total fantasy points produced." },
  ],
  TE: [
    { label: "Route Involvement Score", keys: ["routes", "routePct", "snapPct"], explanation: "How often the player is in route and on the field." },
    { label: "Target Role Score", keys: ["targets", "targetSharePct", "targetsPerRouteRun"], explanation: "Target volume, target share, and per-route targets." },
    { label: "Efficiency Score", keys: ["yardsPerReception", "catchPct", "yardsPerRouteRun"], explanation: "Yards per catch, catch rate, and yards per route run." },
    { label: "Red Zone Score", keys: ["redZoneTargets", "endZoneTargets", "receivingTouchdowns"], explanation: "Red-zone usage and touchdown production." },
    { label: "Fantasy Production Score", keys: ["fantasyPoints"], explanation: "Total fantasy points produced." },
  ],
};

// ── Public types ─────────────────────────────────────────────────────────────
export interface ProductionRow {
  season: string;
  team: string;
  games: number | null;
  fantasyPoints: number | null;
  ppg: number | null;
  positionFinish: number | null;
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

export interface PlayerAdvancedResult {
  position: Pos;
  seasons: PlayerSeasonStats[]; // most recent first
  latest: PlayerSeasonStats | null;
  composites: CompositeScore[];
  production: ProductionRow[];
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

    // Production row + positional finish (rank by fantasy points that season).
    const fp = num(row.fantasyPoints);
    const games = num(row.games);
    let finish: number | null = null;
    if (fp != null) {
      const above = file.rows.filter((r) => {
        const v = num(r.fantasyPoints);
        return v != null && v > fp;
      }).length;
      finish = above + 1;
    }
    production.push({
      season,
      team: String(row.team ?? row.nfl_team ?? "—"),
      games,
      fantasyPoints: fp,
      ppg: fp != null && games != null && games > 0 ? fp / games : null,
      positionFinish: finish,
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
      const allKeys = new Set(defs.flatMap((d) => d.keys));
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

  return { position: pos, seasons, latest, composites, production };
}
