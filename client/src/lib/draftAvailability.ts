// Draft Availability Matrix — pure data + math layer (no React).
//
// Phase 1 (current): estimates each player's probability of still being on the
// board at every pick from aggregated ADP data (avg pick + an uncertainty
// spread), using a normal distribution. The UI consumes the normalized
// `DraftAvailabilityPlayer` shape below, so we can later swap the estimate for
// real per-draft pick results (Phase 2) without touching the components.

import type { ADPResult } from "@/types/draft";

export type AvailabilityBucket = "very-high" | "high" | "medium" | "low" | "very-low" | "gone";

export interface AvailabilityCell {
  pickNumber: number; // 1-based overall pick
  pickLabel: string;  // "1.05"
  probability: number; // 0–100
}

export interface DraftAvailabilityPlayer {
  playerId: string;
  name: string;
  position: string;
  team?: string;
  adp: number;            // average overall pick
  adpFormatted: string;   // "1.05"
  adpChange: number;      // positive = rising (drafted earlier) over 7d
  minPick: number;
  maxPick: number;
  rangeLabel: string;     // "1.02–3.04" (middle-80% band when available)
  sampleSize: number;
  overallRank: number;
  availabilityByPick: AvailabilityCell[]; // covers the shown pick window
}

export interface AvailabilityResult {
  players: DraftAvailabilityPlayer[];
  rounds: number[];   // actual round numbers shown (e.g. [5,6,7,8,9])
  teams: number;
  pickStart: number;  // first overall pick column shown
  pickEnd: number;    // last overall pick column shown
}

export const BAND_SIZE = 50;
export const MAX_ROUNDS_SHOWN = 8; // cap window width so position filters stay readable

// ── Pick ↔ label conversion ──────────────────────────────────────────────────
export function pickNumberToLabel(pickNumber: number, teams: number): string {
  const round = Math.floor((pickNumber - 1) / teams) + 1;
  const pick = ((pickNumber - 1) % teams) + 1;
  return `${round}.${String(pick).padStart(2, "0")}`;
}

export function pickLabelToNumber(label: string, teams: number): number {
  const [roundRaw, pickRaw] = label.split(".");
  return (Number(roundRaw) - 1) * teams + Number(pickRaw);
}

// ── Normal distribution helpers ──────────────────────────────────────────────
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x: number, mean: number, stdDev: number): number {
  return 0.5 * (1 + erf((x - mean) / (stdDev * Math.sqrt(2))));
}

// ── Availability estimation (ADP only) ───────────────────────────────────────
// Probability the player is still on the board for each pick in [pickStart, pickEnd].
function cellsForRange(opts: {
  adp: number; stdDev: number; minPick?: number; maxPick?: number;
  teams: number; pickStart: number; pickEnd: number;
}): AvailabilityCell[] {
  const { adp, stdDev, minPick, maxPick, teams, pickStart, pickEnd } = opts;
  const cells: AvailabilityCell[] = [];
  for (let pick = pickStart; pick <= pickEnd; pick++) {
    // Available when this pick is on the clock = P(player's draft slot >= pick).
    let probability = 100 * (1 - normalCdf(pick - 0.5, adp, stdDev));
    // Always 100% at or before the earliest pick the player has ever gone
    // (min_pick >= 1, so pick 1.01 is 100% for everyone — nobody's drafted yet).
    if (pick <= (minPick ?? 1)) probability = 100;
    // ...and they almost never last past where they've ever been seen drafted.
    else if (minPick && pick > minPick + 2 && probability > 98) probability = 98;
    if (maxPick && pick > maxPick) probability = 0;
    cells.push({
      pickNumber: pick,
      pickLabel: pickNumberToLabel(pick, teams),
      probability: Math.max(0, Math.min(100, Math.round(probability))),
    });
  }
  return cells;
}

const roundOf = (pick: number, teams: number) => Math.floor((pick - 1) / teams) + 1;

// ── Color buckets ─────────────────────────────────────────────────────────────
export function getAvailabilityBucket(probability: number): AvailabilityBucket {
  if (probability >= 85) return "very-high";
  if (probability >= 60) return "high";
  if (probability >= 30) return "medium";
  if (probability >= 10) return "low";
  if (probability > 0) return "very-low";
  return "gone";
}

// On-theme heatmap colors (tool gradient: emerald → teal → gold → orange → rose
// → dark). Saturated enough to read across a dense matrix.
export const BUCKET_CLASS: Record<AvailabilityBucket, string> = {
  "very-high": "bg-emerald-500/80 text-white",
  high:        "bg-teal-500/70 text-white",
  medium:      "bg-[#d4af37]/85 text-[#0b1f3a]",
  low:         "bg-orange-500/75 text-white",
  "very-low":  "bg-rose-500/70 text-white",
  gone:        "bg-rose-950/40 text-white/35",
};

// ── Derive uncertainty spread from the ADP row ───────────────────────────────
// Prefer the middle-80% band (p90 − p10 ≈ 2.563·σ for a normal); fall back to
// the full min/max range, then a heuristic fraction of ADP.
function deriveStdDev(r: ADPResult): number {
  if (r.p10_pick != null && r.p90_pick != null && r.p90_pick > r.p10_pick) {
    return Math.max(1.5, (r.p90_pick - r.p10_pick) / 2.5631);
  }
  if (r.max_pick > r.min_pick) return Math.max(1.5, (r.max_pick - r.min_pick) / 4);
  return Math.max(3, Math.min(24, r.avg_pick * 0.35));
}

/**
 * Build the availability matrix for one rank band (1-based; 50 players each).
 * The displayed pick-column window is derived from where the band's players
 * actually go (their p10–p90 spread), snapped to whole rounds and capped — so
 * the rounds shown adjust to the selected band instead of always starting at 1.
 */
export function buildAvailability(
  items: ADPResult[],
  opts: { teams: number; position: string; band: number | "all" },
): AvailabilityResult {
  const teams = opts.teams;
  const pos = opts.position.toUpperCase();
  const isAll = opts.band === "all";

  const pool = items
    .filter((r) => !r.is_rookie_placeholder && r.avg_pick > 0)
    .filter((r) => pos === "ALL" || r.position === pos)
    .sort((a, b) => a.avg_pick - b.avg_pick);

  let bandRows = isAll
    ? pool
    : pool.slice(((opts.band as number) - 1) * BAND_SIZE, ((opts.band as number) - 1) * BAND_SIZE + BAND_SIZE);
  if (!bandRows.length) return { players: [], rounds: [], teams, pickStart: 0, pickEnd: 0 };

  // Column window. "all" = a full board from round 1 through the deepest player
  // (capped). A band = from where it starts slipping (min p10) to where it's
  // typically gone (max p90), snapped to whole rounds and capped.
  let startRound: number;
  let endRound: number;
  if (isAll) {
    startRound = 1;
    const hi = Math.max(...bandRows.map((r) => Math.ceil(r.p90_pick ?? r.max_pick ?? r.avg_pick)));
    endRound = Math.min(MAX_ROUNDS_SHOWN, Math.max(1, roundOf(hi, teams)));
  } else {
    const lo = Math.min(...bandRows.map((r) => Math.max(1, Math.floor(r.p10_pick ?? r.min_pick ?? r.avg_pick))));
    const hi = Math.max(...bandRows.map((r) => Math.ceil(r.p90_pick ?? r.max_pick ?? r.avg_pick)));
    startRound = roundOf(lo, teams);
    endRound = roundOf(hi, teams);
    if (endRound - startRound + 1 > MAX_ROUNDS_SHOWN) endRound = startRound + MAX_ROUNDS_SHOWN - 1;
  }
  const pickStart = (startRound - 1) * teams + 1;
  const pickEnd = endRound * teams;
  const rounds = Array.from({ length: endRound - startRound + 1 }, (_, i) => startRound + i);

  // For the full board, drop players who never go within the shown window.
  if (isAll) bandRows = bandRows.filter((r) => r.avg_pick <= pickEnd);

  const players = bandRows.map((r) => {
    const stdDev = deriveStdDev(r);
    const pLo = r.p10_pick ?? r.min_pick;
    const pHi = r.p90_pick ?? r.max_pick;
    return {
      playerId: r.player_id,
      name: r.player_name,
      position: r.position,
      team: r.team,
      adp: r.avg_pick,
      adpFormatted: pickNumberToLabel(Math.max(1, Math.round(r.avg_pick)), teams),
      adpChange: -r.trend_7d, // flip so positive = rising (drafted earlier)
      minPick: r.min_pick,
      maxPick: r.max_pick,
      rangeLabel: `${pickNumberToLabel(Math.max(1, Math.round(pLo)), teams)}–${pickNumberToLabel(Math.max(1, Math.round(pHi)), teams)}`,
      sampleSize: r.draft_count,
      overallRank: r.overall_rank,
      availabilityByPick: cellsForRange({ adp: r.avg_pick, stdDev, minPick: r.min_pick, maxPick: r.max_pick, teams, pickStart, pickEnd }),
    };
  });

  return { players, rounds, teams, pickStart, pickEnd };
}
