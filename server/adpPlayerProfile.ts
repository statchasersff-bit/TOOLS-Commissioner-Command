/**
 * Per-player ADP analytics powering the ADP tab on the full player profile
 * page. Backed by the same draft_picks table that drives the regular ADP
 * snapshots; no extra ingestion required.
 *
 *   /api/adp/player/:playerId/history       → time-bucketed ADP (7/30/90 day)
 *   /api/adp/player/:playerId/availability  → P(available at pick X) grid
 *
 * Both endpoints accept the same filter query string as /api/adp so the
 * sections reflect the requested league shape (rookie vs startup, SF vs 1QB,
 * TEP vs non-TEP, scoring, date range, etc.) rather than global startup-only
 * data.
 */

import { db } from "./db";
import { and, eq, inArray } from "drizzle-orm";
import { drafts, draftPicks } from "@shared/schema";
import { buildDraftWhere, type AdpFilters } from "./adp";

// Shared, capped Postgres pool (see server/db.ts).

function safePickDate(d: { completedAt: number | null; startTime: number | null; createdAt: number | null }): number | null {
  return d.completedAt ?? d.startTime ?? d.createdAt ?? null;
}

/** Resolve the set of draft IDs that match the current ADP Explorer filters.
 *  Returns an empty array when no drafts match — callers should short-circuit
 *  to an empty response in that case. */
async function eligibleDraftIds(f: AdpFilters): Promise<{ draftId: string; teams: number }[]> {
  const rows = await db
    .select({ draftId: drafts.draftId, teams: drafts.teams })
    .from(drafts)
    .where(buildDraftWhere(f));
  return rows;
}

export interface AdpHistoryPoint {
  window: "7d" | "30d" | "90d";
  draftCount: number;
  avgPick: number | null;
  minPick: number | null;
  maxPick: number | null;
  asOf: string;
}

export interface AdpHistoryResponse {
  playerId: string;
  /** Echoes the resolved filter context so the UI can show "12T · SF · TEP · …". */
  appliedFilters: AdpFilters;
  buckets: AdpHistoryPoint[];
  /** One bucket per calendar month (UTC) the player was drafted in, capped at
   *  the last 36 months. Months with zero picks are omitted, so a rookie with
   *  a one-year career naturally returns ≤12 months without a separate
   *  "NFL entry date" lookup. Drives the ADP-over-time chart. */
  monthly: Array<{ month: string; avgPick: number; count: number }>;
  /** Legacy field — kept (always empty) so older cached frontends that read
   *  `daily.length` don't crash post-deploy. New code should use `monthly`. */
  daily: Array<{ date: string; avgPick: number; count: number }>;
  /** Per-pick count across the filtered draft pool. The UI bins this into
   *  rounds client-side using the user's teams filter so the same payload
   *  feeds both a per-pick view (Avail tab) and a per-round view (ADP tab). */
  pickHistogram: Array<{ pickNo: number; count: number }>;
}

export async function getAdpHistory(playerId: string, filters: AdpFilters): Promise<AdpHistoryResponse> {
  const eligible = await eligibleDraftIds(filters);
  if (eligible.length === 0) {
    return {
      playerId,
      appliedFilters: filters,
      buckets: (["7d", "30d", "90d"] as const).map((w) => ({
        window: w, draftCount: 0, avgPick: null, minPick: null, maxPick: null,
        asOf: new Date().toISOString(),
      })),
      monthly: [],
      daily: [],
      pickHistogram: [],
    };
  }
  const draftIds = eligible.map((d) => d.draftId);

  // Pull every pick for this player in the filtered draft pool along with the
  // parent draft's completion timestamp.
  const rows = await db
    .select({
      pickNo: draftPicks.pickNo,
      draftId: draftPicks.draftId,
      completedAt: drafts.completedAt,
      startTime: drafts.startTime,
      createdAt: drafts.createdAt,
    })
    .from(draftPicks)
    .innerJoin(drafts, eq(draftPicks.draftId, drafts.draftId))
    .where(and(eq(draftPicks.playerId, playerId), inArray(draftPicks.draftId, draftIds)));

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const buckets: AdpHistoryPoint[] = (["7d", "30d", "90d"] as const).map((w) => {
    const days = w === "7d" ? 7 : w === "30d" ? 30 : 90;
    const cutoff = now - days * dayMs;
    const winRows = rows.filter((r) => {
      const ts = safePickDate(r);
      return ts != null && ts >= cutoff;
    });
    if (winRows.length === 0) {
      return { window: w, draftCount: 0, avgPick: null, minPick: null, maxPick: null, asOf: new Date(now).toISOString() };
    }
    const picks = winRows.map((r) => r.pickNo);
    const avg = picks.reduce((s, n) => s + n, 0) / picks.length;
    return {
      window: w,
      draftCount: winRows.length,
      avgPick: Math.round(avg * 10) / 10,
      minPick: Math.min(...picks),
      maxPick: Math.max(...picks),
      asOf: new Date(now).toISOString(),
    };
  });

  // Monthly rolling average — one bucket per UTC calendar month the player
  // was drafted in, capped at the last 36 months. Computed with calendar
  // arithmetic (not a rolling day count) so the boundary lands exactly at
  // the same day-of-month 36 months ago instead of drifting by leap days.
  const monthlyCutoffDate = new Date(now);
  monthlyCutoffDate.setUTCMonth(monthlyCutoffDate.getUTCMonth() - 36);
  const monthlyCutoff = monthlyCutoffDate.getTime();

  // The monthly chart promises a 3-year window. Default ADP filters scope
  // drafts to the current calendar year, and the user may also have an
  // explicit date range applied — both would cap the chart to a sliver of
  // the last 36 months. Re-query with season/date-range relaxed, but keep
  // the rest of the filter context (draftType, scoring, SF, TEP, teams,
  // rookieMode, etc.) so the chart still reflects the user's league shape.
  const needsBroadQuery =
    filters.season !== "all" ||
    !!filters.startDate ||
    !!filters.endDate;

  let monthlyRows = rows;
  if (needsBroadQuery) {
    const broadFilters: AdpFilters = {
      ...filters,
      season: "all",
      startDate: undefined,
      endDate: undefined,
    };
    const broadEligible = await eligibleDraftIds(broadFilters);
    const broadDraftIds = broadEligible.map((d) => d.draftId);
    if (broadDraftIds.length > 0) {
      monthlyRows = await db
        .select({
          pickNo: draftPicks.pickNo,
          draftId: draftPicks.draftId,
          completedAt: drafts.completedAt,
          startTime: drafts.startTime,
          createdAt: drafts.createdAt,
        })
        .from(draftPicks)
        .innerJoin(drafts, eq(draftPicks.draftId, drafts.draftId))
        .where(and(eq(draftPicks.playerId, playerId), inArray(draftPicks.draftId, broadDraftIds)));
    } else {
      monthlyRows = [];
    }
  }

  const byMonth = new Map<string, number[]>();
  for (const r of monthlyRows) {
    const ts = safePickDate(r);
    if (ts == null || ts < monthlyCutoff) continue;
    const d = new Date(ts);
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey)!.push(r.pickNo);
  }
  const monthly = Array.from(byMonth.entries())
    .map(([month, picks]) => ({
      month,
      avgPick: Math.round((picks.reduce((s, n) => s + n, 0) / picks.length) * 10) / 10,
      count: picks.length,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // `daily` retained as an empty array to keep older cached frontends —
  // which read `data.daily.length` on the chart path — from throwing.
  const daily: Array<{ date: string; avgPick: number; count: number }> = [];

  // Per-pick histogram across the entire filtered pool. Capped at a generous
  // upper bound so a single outlier "drafted at 240" doesn't blow up the
  // array — anything past the cap rolls into the final bucket.
  const HIST_CAP = 360;
  const histCounts = new Array<number>(HIST_CAP).fill(0);
  for (const r of rows) {
    const idx = Math.min(HIST_CAP, Math.max(1, r.pickNo)) - 1;
    histCounts[idx] += 1;
  }
  // Trim trailing zeros so the client doesn't loop over empty tail buckets.
  let lastNonZero = -1;
  for (let i = histCounts.length - 1; i >= 0; i--) {
    if (histCounts[i] > 0) { lastNonZero = i; break; }
  }
  const pickHistogram = histCounts
    .slice(0, lastNonZero + 1)
    .map((count, i) => ({ pickNo: i + 1, count }));

  return { playerId, appliedFilters: filters, buckets, monthly, daily, pickHistogram };
}

export interface AvailabilityCell {
  pickNo: number;
  round: number;
  pickInRound: number;
  availabilityPct: number; // 0-100
}

export interface AdpAvailabilityResponse {
  playerId: string;
  /** Echoes the resolved filter context so the UI can show "12T · SF · TEP · …". */
  appliedFilters: AdpFilters;
  teams: number;
  rounds: number;
  totalDrafts: number;
  draftsWithPlayer: number;
  expectedPick: number | null;
  /** Steepest single-pick drop in availability — surfaced by the UI as the
   *  "draft cliff" insight. Null when fewer than 2 cells have data. */
  biggestDropAt: { fromPick: number; toPick: number; delta: number } | null;
  cells: AvailabilityCell[];
  /** Per-pick count of how often the player was actually drafted at that
   *  slot inside the visible grid (pickNo 1..teams*rounds). Drives the
   *  pick-distribution histogram below the heatmap. Picks outside the grid
   *  bucket into the final cell as "+overflow" so users see late draft
   *  capture without inflating the x-axis. */
  pickHistogram: Array<{ pickNo: number; count: number }>;
}

// A consensus asset occasionally shows up in a junk/devy/abnormal draft at an
// absurd slot (e.g. a 1.01 "drafted" at pick 359). Those extreme late outliers
// flatten the availability curve and bloat the min/max range, so drop them
// before computing. Generous fence (4× the player's median pick, floor 36) so a
// player's genuine range is left intact — only egregious outliers are removed.
function trimPickOutliers(sortedPicks: number[]): number[] {
  if (sortedPicks.length < 4) return sortedPicks;
  const median = sortedPicks[Math.floor(sortedPicks.length / 2)];
  const upper = Math.max(median * 4, 36);
  const kept = sortedPicks.filter((p) => p <= upper);
  return kept.length ? kept : sortedPicks; // never trim everything away
}

export interface AvailabilityMatrixResponse {
  totalDrafts: number;
  teams: number;
  rounds: number;
  // playerId → probabilities indexed by (pickNo - 1), 0–100, one decimal.
  players: Record<string, { draftsWithPlayer: number; cells: number[] }>;
}

/**
 * Real per-pick availability for MANY players in one pass — powers the Draft
 * Availability Matrix. Same definition as getAdpAvailability
 * (P(available at X) = drafts where the player's pick ≥ X, or was undrafted),
 * computed from the actual draftPicks table over the same filtered pool.
 */
export async function getAdpAvailabilityMatrix(
  playerIds: string[],
  filters: AdpFilters,
  teams: number = 12,
  rounds: number = 5,
): Promise<AvailabilityMatrixResponse> {
  const totalSlots = teams * rounds;
  const eligible = await eligibleDraftIds(filters);
  const filtered = teams > 0 ? eligible.filter((d) => d.teams === teams || d.teams === 0) : eligible;
  const eligibleIds = filtered.map((d) => d.draftId);
  const totalDrafts = eligibleIds.length;

  const players: AvailabilityMatrixResponse["players"] = {};
  if (!eligibleIds.length || !playerIds.length) {
    for (const pid of playerIds) players[pid] = { draftsWithPlayer: 0, cells: [] };
    return { totalDrafts, teams, rounds, players };
  }

  // One query for all requested players' picks within the eligible pool.
  const picks = await db
    .select({ playerId: draftPicks.playerId, pickNo: draftPicks.pickNo })
    .from(draftPicks)
    .where(and(inArray(draftPicks.playerId, playerIds), inArray(draftPicks.draftId, eligibleIds)));

  const byPlayer = new Map<string, number[]>();
  for (const p of picks) {
    if (!p.playerId) continue;
    const arr = byPlayer.get(p.playerId);
    if (arr) arr.push(p.pickNo);
    else byPlayer.set(p.playerId, [p.pickNo]);
  }

  for (const pid of playerIds) {
    const arr = trimPickOutliers((byPlayer.get(pid) ?? []).slice().sort((a, b) => a - b));
    const drafted = arr.length;
    // Denominator = drafts where the player was actually drafted (not the whole
    // slice). This avoids the misleading flat floor that "undrafted = available
    // everywhere" produces from partial/abandoned drafts, so a consensus pick
    // reads 100% at his slot then drops cleanly toward 0%.
    if (!drafted) { players[pid] = { draftsWithPlayer: 0, cells: [] }; continue; }
    const cells: number[] = [];
    let idx = 0; // advancing pointer: # of this player's picks strictly before pickNo
    for (let pickNo = 1; pickNo <= totalSlots; pickNo++) {
      while (idx < arr.length && arr[idx] < pickNo) idx++;
      const stillAvailable = drafted - idx; // drafts where his pick was >= pickNo
      cells.push(Math.round((stillAvailable / drafted) * 1000) / 10);
    }
    players[pid] = { draftsWithPlayer: drafted, cells };
  }

  return { totalDrafts, teams, rounds, players };
}

export async function getAdpAvailability(
  playerId: string,
  filters: AdpFilters,
  teams: number = 12,
  rounds: number = 5,
): Promise<AdpAvailabilityResponse> {
  // Use the full filtered draft pool — not just startup — so the modal's
  // Avail tab matches the table the user is looking at. The old impl
  // hardcoded draftType=startup which made Avail wrong for rookie views.
  const eligible = await eligibleDraftIds(filters);

  // Filter to drafts that match the requested team size when we have it.
  // teams=0 in the source means "unspecified" — we keep those in the pool
  // so small datasets still produce some signal.
  // buildDraftWhere already excludes zero-pick drafts (abandoned drafts stored
  // as status='complete' with no picks), so the denominator below counts only
  // drafts that actually have draft data.
  const filtered = teams > 0
    ? eligible.filter((d) => d.teams === teams || d.teams === 0)
    : eligible;
  const eligibleIds = filtered.map((d) => d.draftId);
  if (eligibleIds.length === 0) {
    return {
      playerId, appliedFilters: filters, teams, rounds,
      totalDrafts: 0, draftsWithPlayer: 0, expectedPick: null,
      biggestDropAt: null, cells: [], pickHistogram: [],
    };
  }

  const playerPicks = await db
    .select({ draftId: draftPicks.draftId, pickNo: draftPicks.pickNo })
    .from(draftPicks)
    .where(and(eq(draftPicks.playerId, playerId), inArray(draftPicks.draftId, eligibleIds)));

  const pickByDraft = new Map<string, number>();
  for (const p of playerPicks) pickByDraft.set(p.draftId, p.pickNo);

  const totalDrafts = eligibleIds.length;
  const totalSlots = teams * rounds;

  // P(available at pick X), conditioned on the player actually being drafted in
  // this slice = (#drafts where his pick >= X) / draftsWithPlayer. Using only
  // drafts that drafted him (rather than the whole slice, counting undrafted as
  // "available everywhere") avoids a misleading flat floor from partial drafts,
  // so a consensus pick reads 100% at his slot then drops cleanly toward 0%.
  // Outlier picks (junk/devy drafts) are trimmed first.
  const observedPicks = trimPickOutliers([...pickByDraft.values()].sort((a, b) => a - b));
  const draftsWithPlayer = observedPicks.length;
  const cells: AvailabilityCell[] = [];
  for (let pickNo = 1; pickNo <= totalSlots; pickNo++) {
    let stillAvailable = 0;
    for (const pk of observedPicks) if (pk >= pickNo) stillAvailable++;
    const availabilityPct = draftsWithPlayer > 0 ? (stillAvailable / draftsWithPlayer) * 100 : 0;
    cells.push({
      pickNo,
      round: Math.ceil(pickNo / teams),
      pickInRound: ((pickNo - 1) % teams) + 1,
      availabilityPct: Math.round(availabilityPct * 10) / 10,
    });
  }

  // Identify the steepest pick-to-pick drop so the UI can surface a
  // "draft cliff" insight without needing the whole curve client-side.
  let biggestDropAt: AdpAvailabilityResponse["biggestDropAt"] = null;
  for (let i = 1; i < cells.length; i++) {
    const delta = cells[i - 1].availabilityPct - cells[i].availabilityPct;
    if (delta > 0 && (biggestDropAt == null || delta > biggestDropAt.delta)) {
      biggestDropAt = {
        fromPick: cells[i - 1].pickNo,
        toPick: cells[i].pickNo,
        delta: Math.round(delta * 10) / 10,
      };
    }
  }

  const expectedPick = draftsWithPlayer > 0
    ? Math.round((observedPicks.reduce((s, n) => s + n, 0) / draftsWithPlayer) * 10) / 10
    : null;

  // Pick-distribution histogram across the visible grid. Picks beyond the
  // final slot are folded into that slot so a long-tail late pick doesn't
  // silently drop from the chart.
  const histCounts = new Array<number>(totalSlots).fill(0);
  for (const p of observedPicks) {
    const slot = Math.min(totalSlots, Math.max(1, p));
    histCounts[slot - 1] += 1;
  }
  const pickHistogram = histCounts.map((count, i) => ({ pickNo: i + 1, count }));

  return {
    playerId, appliedFilters: filters, teams, rounds,
    totalDrafts, draftsWithPlayer, expectedPick, biggestDropAt, cells,
    pickHistogram,
  };
}
