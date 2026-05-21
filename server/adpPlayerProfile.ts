/**
 * Per-player ADP analytics used by the PlayerProfileDrawer in the ADP
 * Explorer. Backed by the same draft_picks table that drives the regular ADP
 * snapshots; no extra ingestion required.
 *
 *   /api/adp/player/:playerId/history       → time-bucketed ADP (7/30/90 day)
 *   /api/adp/player/:playerId/availability  → P(available at pick X) grid
 *
 * Both endpoints accept the same filter query string as /api/adp so the
 * modal reflects the *currently active* ADP Explorer dataset (rookie vs
 * startup, SF vs 1QB, TEP vs non-TEP, date range, etc.). Without this the
 * modal showed global startup-only data regardless of what the user had
 * selected in DraftCommand.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import { drafts, draftPicks } from "@shared/schema";
import { buildDraftWhere, type AdpFilters } from "./adp";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

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

  // Daily rolling average (last 90 days), one bucket per day with picks.
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const ts = safePickDate(r);
    if (ts == null || now - ts > 90 * dayMs) continue;
    const day = new Date(ts).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(r.pickNo);
  }
  const daily = Array.from(byDay.entries())
    .map(([date, picks]) => ({
      date,
      avgPick: Math.round((picks.reduce((s, n) => s + n, 0) / picks.length) * 10) / 10,
      count: picks.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

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

  return { playerId, appliedFilters: filters, buckets, daily, pickHistogram };
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
  const draftsWithPlayer = pickByDraft.size;
  const totalSlots = teams * rounds;

  // P(available at pick X) = (#drafts where pick_no for this player >= X OR
  //                          player was NOT drafted before slot X) / totalDrafts.
  // If the player wasn't drafted at all in a draft, they were available at
  // every observed pick — count them as available everywhere.
  const cells: AvailabilityCell[] = [];
  for (let pickNo = 1; pickNo <= totalSlots; pickNo++) {
    let available = 0;
    for (const draftId of eligibleIds) {
      const playerPick = pickByDraft.get(draftId);
      if (playerPick == null || playerPick >= pickNo) available++;
    }
    const availabilityPct = (available / totalDrafts) * 100;
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
    ? Math.round(
        (Array.from(pickByDraft.values()).reduce((s, n) => s + n, 0) / draftsWithPlayer) * 10
      ) / 10
    : null;

  // Pick-distribution histogram across the visible grid. Picks beyond the
  // final slot are folded into that slot so a long-tail late pick doesn't
  // silently drop from the chart.
  const histCounts = new Array<number>(totalSlots).fill(0);
  for (const p of Array.from(pickByDraft.values())) {
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
