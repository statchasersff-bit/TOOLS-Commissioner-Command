// Position composite scores for the Value Finder, sourced from the SAME engines
// and SAME bundled data as the Position Stats table (the "Advanced Stats"
// league-wide table). This guarantees the Value Finder's Usage (= Volume composite)
// and Efficiency numbers match that table exactly.
//
// The Position Stats table computes grades by feeding the full per-position pool
// of rows for a season into the position's composite engine (computeQbCompositeScores
// etc.) — percentiles are ranked against the qualified baseline inside each engine,
// and every row receives a 0–100 integer score. We replicate that precisely here:
// same JSON files, same engines, same full-pool input, keyed by Sleeper playerId.

import { computeQbCompositeScores } from "@/lib/qbCompositeScores";
import { computeRbCompositeScores } from "@/lib/rbCompositeScores";
import {
  computeWrCompositeScores,
  computeTeCompositeScores,
} from "@/lib/receivingComposites";
import type { SeasonFilter } from "./types";

type Pos = "qb" | "rb" | "wr" | "te";

// Same bundled data the Position Stats table loads (Vite dedupes the JSON modules,
// so this is the identical data — no divergence possible).
type DataLoader = () => Promise<{ default: { rows: Record<string, unknown>[] } }>;
const DATA_LOADERS: Record<string, DataLoader> = {
  qb_2023: () => import("@/data/advanced_stats/qb_advanced_stats_2023.json"),
  qb_2024: () => import("@/data/advanced_stats/qb_advanced_stats_2024.json"),
  qb_2025: () => import("@/data/advanced_stats/qb_advanced_stats_2025.json"),
  rb_2023: () => import("@/data/advanced_stats/rb_advanced_stats_2023.json"),
  rb_2024: () => import("@/data/advanced_stats/rb_advanced_stats_2024.json"),
  rb_2025: () => import("@/data/advanced_stats/rb_advanced_stats_2025.json"),
  wr_2023: () => import("@/data/advanced_stats/wr_advanced_stats_2023.json"),
  wr_2024: () => import("@/data/advanced_stats/wr_advanced_stats_2024.json"),
  wr_2025: () => import("@/data/advanced_stats/wr_advanced_stats_2025.json"),
  te_2023: () => import("@/data/advanced_stats/te_advanced_stats_2023.json"),
  te_2024: () => import("@/data/advanced_stats/te_advanced_stats_2024.json"),
  te_2025: () => import("@/data/advanced_stats/te_advanced_stats_2025.json"),
};

// Same engines the table uses (SCORE_ENGINES in PositionStats.tsx). Each returns
// one score object per input row (aligned by index), including `volumeScore` and
// `efficiencyScore`. QB/RB engines have nominal return types; cast to the shared
// index-signature shape, exactly as PositionStats does.
type Engine = (rows: Record<string, unknown>[]) => Array<Record<string, number>>;
const ENGINES: Record<Pos, Engine> = {
  qb: computeQbCompositeScores as unknown as Engine,
  rb: computeRbCompositeScores as unknown as Engine,
  wr: computeWrCompositeScores,
  te: computeTeCompositeScores,
};

export interface PositionCompositeScore {
  /** Workload/usage composite (0–100). The table labels it "Volume" for every position. */
  volumeScore: number;
  /** Per-opportunity efficiency composite (0–100). */
  efficiencyScore: number;
}

/**
 * Per-player Volume + Efficiency composite scores (0–100 integers) for a season,
 * keyed by Sleeper `playerId`, computed identically to the Position Stats table.
 */
export async function loadPositionCompositeScores(
  season: SeasonFilter,
): Promise<Record<string, PositionCompositeScore>> {
  const out: Record<string, PositionCompositeScore> = {};
  const positions: Pos[] = ["qb", "rb", "wr", "te"];

  await Promise.all(
    positions.map(async (pos) => {
      const loader = DATA_LOADERS[`${pos}_${season}`];
      if (!loader) return;
      let rows: Record<string, unknown>[];
      try {
        rows = (await loader()).default.rows;
      } catch {
        return;
      }
      // Score against the full pool, unfiltered — same input the table uses.
      const scores = ENGINES[pos](rows);
      rows.forEach((r, i) => {
        const id = String(r.playerId ?? "");
        if (!id) return;
        const s = scores[i];
        if (!s) return;
        out[id] = {
          volumeScore: s.volumeScore,
          efficiencyScore: s.efficiencyScore,
        };
      });
    }),
  );

  return out;
}
