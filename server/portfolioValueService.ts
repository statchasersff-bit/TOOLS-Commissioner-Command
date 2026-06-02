/**
 * Portfolio value lookup — estimates what a player or rookie pick was worth on
 * a given date, for the Portfolio Timeline ledger.
 *
 * Data reality: we only have player value snapshots going FORWARD from when the
 * app began capturing them (playerValueSnapshots), and no historical pick-value
 * archive. So this service implements a fallback ladder and labels every result
 * with a confidence level so the UI can be honest about estimated history:
 *
 *   exact → interpolated → nearest(window) → estimated(latest) → replacement
 *
 * Values use the SF-dynasty scale by default (comparable to FantasyCalc/KTC).
 */

import { db } from "./db";
import { inArray, and, eq, asc } from "drizzle-orm";
import { playerValueSnapshots, pickValueHistory } from "@shared/schema";
import { getFantasyCalcValues } from "./fantasycalc";

// Shared, capped Postgres pool (see server/db.ts).

export type Confidence = "exact" | "interpolated" | "nearest" | "estimated" | "replacement" | "unknown";

export interface ValueResult {
  value: number;
  confidence: Confidence;
}

const NEAREST_WINDOW_DAYS = 45;

// Replacement-level fallback when we have no snapshot for a player at all.
const REPLACEMENT_BY_POS: Record<string, number> = { QB: 600, RB: 350, WR: 350, TE: 250 };
function getReplacementValue(pos: string | null | undefined): number {
  return REPLACEMENT_BY_POS[(pos || "").toUpperCase()] ?? 200;
}

// Rookie-pick bucket adjustment applied to a round baseline (early > mid > late).
const BUCKET_MULTIPLIER: Record<string, number> = { early: 1.15, mid: 1.0, late: 0.85, unknown: 1.0 };

function daysBetween(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

/** Proportional cost-basis allocation for a traded-for asset:
 *  the value you sent, split across received assets by their trade-date value. */
export function allocateCostBasis(valueSent: number, receivedValue: number, receivedTotal: number): number {
  if (receivedTotal <= 0) return 0;
  return valueSent * (receivedValue / receivedTotal);
}

export function interpolateValue(
  beforeValue: number,
  afterValue: number,
  beforeDate: string,
  afterDate: string,
  targetDate: string,
): number {
  const span = Date.parse(afterDate) - Date.parse(beforeDate);
  if (span <= 0) return beforeValue;
  const frac = (Date.parse(targetDate) - Date.parse(beforeDate)) / span;
  return Math.round(beforeValue + frac * (afterValue - beforeValue));
}

// ── Player value series (preloaded for efficient batch valuation) ────────────

export interface ValuePoint {
  date: string;
  value: number;
  pos: string;
}

/** Load every snapshot (sorted ascending by date) for a set of players. */
export async function loadPlayerValueSeries(
  sleeperIds: string[],
  format: "sf" | "1qb" = "sf",
): Promise<Map<string, ValuePoint[]>> {
  const out = new Map<string, ValuePoint[]>();
  if (sleeperIds.length === 0) return out;
  const col = format === "1qb" ? playerValueSnapshots.dynastyValue : playerValueSnapshots.dynastyValueSf;
  const rows = await db
    .select({
      sleeperId: playerValueSnapshots.sleeperId,
      date: playerValueSnapshots.snapshotDate,
      value: col,
      pos: playerValueSnapshots.pos,
    })
    .from(playerValueSnapshots)
    .where(inArray(playerValueSnapshots.sleeperId, Array.from(new Set(sleeperIds))))
    .orderBy(asc(playerValueSnapshots.snapshotDate));
  for (const r of rows) {
    const list = out.get(r.sleeperId) ?? [];
    list.push({ date: r.date, value: r.value ?? 0, pos: r.pos });
    out.set(r.sleeperId, list);
  }
  return out;
}

/**
 * Pure in-memory value lookup against a player's preloaded snapshot series.
 * `fallbackCurrent` (the player's current FantasyCalc value) is used when no
 * snapshot is in range — far better than the replacement floor.
 */
export function valueFromSeries(
  series: ValuePoint[] | undefined,
  targetDate: string,
  opts: { pos?: string; fallbackCurrent?: number } = {},
): ValueResult {
  const { pos, fallbackCurrent } = opts;
  const floor = (): ValueResult =>
    fallbackCurrent && fallbackCurrent > 0
      ? { value: fallbackCurrent, confidence: "estimated" }
      : { value: getReplacementValue(pos ?? series?.[0]?.pos), confidence: "replacement" };

  if (!series || series.length === 0) return floor();
  let before: ValuePoint | null = null;
  let after: ValuePoint | null = null;
  for (const p of series) {
    if (p.date === targetDate) return { value: p.value, confidence: "exact" };
    if (p.date < targetDate) before = p; // series is ascending → last one before wins
    else if (p.date > targetDate && !after) after = p;
  }
  if (before && after) {
    return {
      value: interpolateValue(before.value, after.value, before.date, after.date, targetDate),
      confidence: "interpolated",
    };
  }
  const nearest = before ?? after;
  if (nearest && daysBetween(nearest.date, targetDate) <= NEAREST_WINDOW_DAYS) {
    return { value: nearest.value, confidence: "nearest" };
  }
  // Outside the window: prefer the closest snapshot, else the current-value floor.
  if (nearest) return { value: nearest.value, confidence: "estimated" };
  return floor();
}

let currentValuesCache: { values: Record<string, number>; at: number } | null = null;
const CURRENT_VALUES_TTL_MS = 6 * 60 * 60 * 1000;

/** Current FantasyCalc SF-dynasty values by sleeperId (cached) — used as the
 *  in-range fallback so present-day holdings get real values. */
export async function loadCurrentValues(): Promise<Record<string, number>> {
  if (currentValuesCache && Date.now() - currentValuesCache.at < CURRENT_VALUES_TTL_MS) {
    return currentValuesCache.values;
  }
  try {
    const fc = await getFantasyCalcValues("sf");
    currentValuesCache = { values: fc.valuesBySleeperId, at: Date.now() };
    return fc.valuesBySleeperId;
  } catch {
    return currentValuesCache?.values ?? {};
  }
}

/** Single-player convenience lookup (loads the series, then values it). */
export async function getPlayerValueOnDate(
  sleeperId: string,
  date: string,
  opts: { format?: "sf" | "1qb"; pos?: string } = {},
): Promise<ValueResult> {
  const series = await loadPlayerValueSeries([sleeperId], opts.format ?? "sf");
  const current = await loadCurrentValues();
  return valueFromSeries(series.get(sleeperId), date, { pos: opts.pos, fallbackCurrent: current[sleeperId] });
}

// ── Pick value lookup ────────────────────────────────────────────────────────

let pickBaselineCache: { values: Record<string, number>; at: number } | null = null;
const PICK_BASELINE_TTL_MS = 6 * 60 * 60 * 1000;

/** Current FantasyCalc round baselines, keyed FP_{season}_{round}. */
async function getPickBaselines(): Promise<Record<string, number>> {
  if (pickBaselineCache && Date.now() - pickBaselineCache.at < PICK_BASELINE_TTL_MS) {
    return pickBaselineCache.values;
  }
  try {
    const fc = await getFantasyCalcValues("sf");
    pickBaselineCache = { values: fc.valuesBySleeperId, at: Date.now() };
    return fc.valuesBySleeperId;
  } catch {
    return pickBaselineCache?.values ?? {};
  }
}

export interface PickRef {
  season: number;
  round: number;
  bucket?: "early" | "mid" | "late" | "unknown" | null;
  slot?: number | null;
}

export async function getPickValueOnDate(pick: PickRef, date: string): Promise<ValueResult> {
  const bucket = pick.bucket || "mid";
  // 1) Historical pick-value rows if we've recorded any near this date.
  try {
    const rows = await db
      .select({ date: pickValueHistory.snapshotDate, value: pickValueHistory.value })
      .from(pickValueHistory)
      .where(
        and(
          eq(pickValueHistory.season, pick.season),
          eq(pickValueHistory.round, pick.round),
          eq(pickValueHistory.slotBucket, bucket),
        ),
      )
      .orderBy(asc(pickValueHistory.snapshotDate));
    if (rows.length > 0) {
      const series: ValuePoint[] = rows.map((r) => ({ date: r.date, value: r.value ?? 0, pos: "PICK" }));
      const res = valueFromSeries(series, date, { pos: "PICK" });
      if (res.confidence !== "replacement") return res;
    }
  } catch {
    /* fall through to baseline */
  }
  // 2) Current FantasyCalc round baseline × bucket multiplier (estimated).
  const baselines = await getPickBaselines();
  const baseline = baselines[`FP_${pick.season}_${pick.round}`];
  if (typeof baseline === "number" && baseline > 0) {
    return { value: Math.round(baseline * (BUCKET_MULTIPLIER[bucket] ?? 1)), confidence: "estimated" };
  }
  // 3) Replacement: crude round-based floor.
  const floor = Math.max(50, 1200 - (pick.round - 1) * 400);
  return { value: floor, confidence: "replacement" };
}

/** Aggregate a set of per-asset confidences into a snapshot-level grade. */
export function aggregateConfidence(confidences: Confidence[]): "high" | "medium" | "low" {
  if (confidences.length === 0) return "low";
  const score = (c: Confidence) =>
    c === "exact" ? 3 : c === "interpolated" ? 3 : c === "nearest" ? 2 : c === "estimated" ? 1 : 0;
  const avg = confidences.reduce((s, c) => s + score(c), 0) / confidences.length;
  if (avg >= 2.4) return "high";
  if (avg >= 1.2) return "medium";
  return "low";
}
