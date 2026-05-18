/**
 * Per-player ADP analytics used by the PlayerProfileDrawer in the ADP
 * Explorer. Backed by the same draft_picks table that drives the regular ADP
 * snapshots; no extra ingestion required.
 *
 *   /api/adp/player/:playerId/history       → time-bucketed ADP (7/30/90 day)
 *   /api/adp/player/:playerId/availability  → P(available at pick X) grid
 *
 * The history endpoint is intentionally conservative: it returns aggregate
 * averages over rolling windows rather than per-draft scatter, which is
 * already enough to render the inverted-axis "ADP over time" line chart.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, gte, inArray } from "drizzle-orm";
import { drafts, draftPicks } from "@shared/schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

function safePickDate(d: { completedAt: number | null; startTime: number | null; createdAt: number | null }): number | null {
  return d.completedAt ?? d.startTime ?? d.createdAt ?? null;
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
  buckets: AdpHistoryPoint[];
  daily: Array<{ date: string; avgPick: number; count: number }>;
}

export async function getAdpHistory(playerId: string): Promise<AdpHistoryResponse> {
  // Pull every pick for this player along with the parent draft's completion timestamp.
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
    .where(eq(draftPicks.playerId, playerId));

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

  return { playerId, buckets, daily };
}

export interface AvailabilityCell {
  pickNo: number;
  round: number;
  pickInRound: number;
  availabilityPct: number; // 0-100
}

export interface AdpAvailabilityResponse {
  playerId: string;
  teams: number;
  rounds: number;
  totalDrafts: number;
  draftsWithPlayer: number;
  expectedPick: number | null;
  cells: AvailabilityCell[];
}

export async function getAdpAvailability(
  playerId: string,
  teams: number = 12,
  rounds: number = 5,
): Promise<AdpAvailabilityResponse> {
  // Use only startup drafts in the requested team size for a clean baseline.
  // For now we accept any teams setting and fall back to "all drafts" so that
  // small samples still produce a result. The teams param controls the grid
  // layout (round = ceil(pick/teams)) but does not filter the source pool.
  const startupDrafts = await db
    .select({ draftId: drafts.draftId, teams: drafts.teams })
    .from(drafts)
    .where(and(eq(drafts.draftType, "startup"), eq(drafts.status, "complete")));

  const filtered = teams > 0
    ? startupDrafts.filter((d) => d.teams === teams || d.teams === 0)
    : startupDrafts;
  const eligibleIds = filtered.map((d) => d.draftId);
  if (eligibleIds.length === 0) {
    return { playerId, teams, rounds, totalDrafts: 0, draftsWithPlayer: 0, expectedPick: null, cells: [] };
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

  const expectedPick = draftsWithPlayer > 0
    ? Math.round(
        (Array.from(pickByDraft.values()).reduce((s, n) => s + n, 0) / draftsWithPlayer) * 10
      ) / 10
    : null;

  return { playerId, teams, rounds, totalDrafts, draftsWithPlayer, expectedPick, cells };
}
