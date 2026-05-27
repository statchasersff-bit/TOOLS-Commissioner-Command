/**
 * Portfolio asset-ledger backfill.
 *
 * Reconstructs a manager's dynasty portfolio as an asset ledger from Sleeper:
 * every player and rookie pick is an asset that is acquired, held, and
 * disposed. We process drafts, trades, and waiver/FA transactions into
 * asset_positions + portfolio_events, then RECONCILE the open positions against
 * the live Sleeper roster + owned picks so the current holdings are exact even
 * when some historical events are missing (those get a low-confidence
 * league_import position).
 *
 * Historical *ownership* is real (from Sleeper); historical *values* are
 * estimated via portfolioValueService and labeled with a confidence level.
 *
 * v1 scope: the current dynasty season per league. The previous_league_id chain
 * (multi-season history) is a documented future extension.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { assetPositions, portfolioEvents } from "@shared/schema";
import { getSleeperPlayers } from "./sleeper";
import {
  loadPlayerValueSeries,
  loadCurrentValues,
  valueFromSeries,
  getPickValueOnDate,
  allocateCostBasis,
  type Confidence,
  type PickRef,
} from "./portfolioValueService";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const SLEEPER_API = "https://api.sleeper.app/v1";
// Power users can roster players in 100+ leagues; cap high enough to cover
// them while still bounding worst-case Sleeper traffic (~22 calls/league).
const MAX_LEAGUES = 120;
const FETCH_CONCURRENCY = 8;
const TRANSACTION_WEEKS = 18;
const MEANINGFUL_DROP_VALUE = 500; // below this, a drop isn't surfaced as an event

// ── tiny fetch utils ─────────────────────────────────────────────────────────
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function isoDate(ms: number | null | undefined, fallback: string): string {
  if (!ms || !Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString().slice(0, 10);
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Sleeper raw shapes (only what we use) ────────────────────────────────────
interface RosterRaw { roster_id: number; owner_id: string; players: string[] | null; }
interface DraftRaw { draft_id: string; season: string; status: string; start_time?: number | null; last_picked?: number | null; }
interface DraftPickRaw { player_id: string; picked_by: string; roster_id: number; round: number; pick_no: number; draft_slot: number; }
interface TradedPickRaw { season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number; }
interface TxnRaw {
  type: string;
  status: string;
  created?: number;
  status_updated?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  draft_picks?: Array<{ season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number }>;
}

// ── In-memory drafts of rows to persist ──────────────────────────────────────
interface PositionDraft {
  sleeperUserId: string;
  leagueId: string;
  rosterId: number | null;
  assetType: "player" | "pick";
  assetKey: string;
  playerId: string | null;
  playerName: string | null;
  pickSeason: number | null;
  pickRound: number | null;
  pickOriginalRosterId: number | null;
  pickSlot: number | null;
  pickBucket: string | null;
  acquiredDate: string;
  acquiredMethod: string;
  disposedDate: string | null;
  disposedMethod: string | null;
  acquisitionValue: number;
  costBasis: number;
  isCurrent: boolean;
  confidence: Confidence;
}
interface EventDraft {
  sleeperUserId: string;
  leagueId: string;
  rosterId: number | null;
  eventDate: string;
  eventType: string;
  title: string;
  description: string;
  valueBefore: number | null;
  valueAfter: number | null;
  valueSent: number | null;
  valueReceived: number | null;
  netDelta: number;
  rosterValueDelta: number;
  pickValueDelta: number;
  costBasisDelta: number;
  detail: unknown;
  rawTransactionId: string | null;
  rawDraftId: string | null;
  confidence: Confidence;
}

// ── Main entry ───────────────────────────────────────────────────────────────
export async function backfillPortfolioTimeline(
  sleeperUserId: string,
  leagueIds: string[],
): Promise<{ positions: number; events: number; leagues: number }> {
  const playersDb = (await getSleeperPlayers()) as Record<string, any>;
  const scanned = leagueIds.slice(0, MAX_LEAGUES);

  // First pass: pull each league's raw data (incl. league meta) so we can
  // gather every involved player id and load value series in ONE query.
  const leagueData = await mapBounded(scanned, FETCH_CONCURRENCY, (id) => fetchLeague(id));

  const allPlayerIds = new Set<string>();
  for (const d of leagueData) {
    if (!d) continue;
    for (const r of d.rosters) for (const pid of r.players || []) allPlayerIds.add(pid);
    for (const dp of d.draftPicks) allPlayerIds.add(dp.player_id);
    for (const t of d.txns) {
      for (const pid of Object.keys(t.adds || {})) allPlayerIds.add(pid);
      for (const pid of Object.keys(t.drops || {})) allPlayerIds.add(pid);
    }
  }
  const series = await loadPlayerValueSeries(Array.from(allPlayerIds), "sf");
  const currentValues = await loadCurrentValues();

  // Memoized pick valuation within this run.
  const pickMemo = new Map<string, { value: number; confidence: Confidence }>();
  const valuePick = async (ref: PickRef, date: string) => {
    const key = `${ref.season}-${ref.round}-${ref.bucket || "mid"}-${date}`;
    const cached = pickMemo.get(key);
    if (cached) return cached;
    const res = await getPickValueOnDate(ref, date);
    pickMemo.set(key, res);
    return res;
  };
  const nameOf = (pid: string) => {
    const p = playersDb[pid];
    return p?.full_name || (p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : pid);
  };
  const posOf = (pid: string) => (playersDb[pid]?.fantasy_positions?.[0] || playersDb[pid]?.position || "") as string;
  const valuePlayer = (pid: string, date: string) =>
    valueFromSeries(series.get(pid), date, { pos: posOf(pid), fallbackCurrent: currentValues[pid] });

  const positions: PositionDraft[] = [];
  const events: EventDraft[] = [];

  let leaguesProcessed = 0;
  for (let i = 0; i < scanned.length; i++) {
    const data = leagueData[i];
    if (!data) continue;
    await processLeague(scanned[i], data, sleeperUserId, { positions, events, playersDb, nameOf, posOf, valuePlayer, valuePick });
    leaguesProcessed++;
  }

  // Persist: wipe prior ledger for this user, then insert fresh.
  await db.delete(assetPositions).where(eq(assetPositions.sleeperUserId, sleeperUserId));
  await db.delete(portfolioEvents).where(eq(portfolioEvents.sleeperUserId, sleeperUserId));

  const BATCH = 400;
  for (let i = 0; i < positions.length; i += BATCH) {
    await db.insert(assetPositions).values(positions.slice(i, i + BATCH).map(toPositionRow));
  }
  for (let i = 0; i < events.length; i += BATCH) {
    await db.insert(portfolioEvents).values(events.slice(i, i + BATCH).map(toEventRow));
  }

  return { positions: positions.length, events: events.length, leagues: leaguesProcessed };
}

function toPositionRow(p: PositionDraft) {
  return {
    sleeperUserId: p.sleeperUserId,
    leagueId: p.leagueId,
    rosterId: p.rosterId ?? null,
    assetType: p.assetType,
    assetKey: p.assetKey,
    playerId: p.playerId,
    playerName: p.playerName,
    pickSeason: p.pickSeason,
    pickRound: p.pickRound,
    pickOriginalRosterId: p.pickOriginalRosterId,
    pickSlot: p.pickSlot,
    pickBucket: p.pickBucket,
    acquiredDate: p.acquiredDate,
    acquiredMethod: p.acquiredMethod,
    disposedDate: p.disposedDate,
    disposedMethod: p.disposedMethod,
    acquisitionValue: Math.round(p.acquisitionValue),
    costBasis: Math.round(p.costBasis),
    isCurrent: p.isCurrent,
    confidence: p.confidence,
  };
}
function toEventRow(e: EventDraft) {
  return {
    sleeperUserId: e.sleeperUserId,
    leagueId: e.leagueId,
    rosterId: e.rosterId ?? null,
    eventDate: e.eventDate,
    eventType: e.eventType,
    title: e.title,
    description: e.description,
    valueBefore: e.valueBefore,
    valueAfter: e.valueAfter,
    valueSent: e.valueSent,
    valueReceived: e.valueReceived,
    netDelta: Math.round(e.netDelta),
    rosterValueDelta: Math.round(e.rosterValueDelta),
    pickValueDelta: Math.round(e.pickValueDelta),
    costBasisDelta: Math.round(e.costBasisDelta),
    detail: e.detail as Record<string, unknown>,
    rawTransactionId: e.rawTransactionId,
    rawDraftId: e.rawDraftId,
    confidence: e.confidence,
  };
}

// ── Per-league raw fetch ─────────────────────────────────────────────────────
interface LeagueMeta {
  leagueId: string;
  name: string;
  season: string;
  totalRosters: number;
  previousLeagueId: string | null;
}
interface LeagueRawData {
  meta: LeagueMeta;
  rosters: RosterRaw[];
  drafts: DraftRaw[];
  draftPicks: Array<DraftPickRaw & { draftId: string; draftDate: string }>;
  tradedPicks: TradedPickRaw[];
  txns: TxnRaw[];
}

interface LeagueObjRaw {
  league_id: string;
  name?: string;
  season?: string;
  total_rosters?: number;
  previous_league_id?: string | null;
}

async function fetchLeague(leagueId: string): Promise<LeagueRawData | null> {
  const [league, rosters, drafts, tradedPicks] = await Promise.all([
    fetchJson<LeagueObjRaw>(`${SLEEPER_API}/league/${leagueId}`),
    fetchJson<RosterRaw[]>(`${SLEEPER_API}/league/${leagueId}/rosters`),
    fetchJson<DraftRaw[]>(`${SLEEPER_API}/league/${leagueId}/drafts`),
    fetchJson<TradedPickRaw[]>(`${SLEEPER_API}/league/${leagueId}/traded_picks`),
  ]);
  if (!rosters || !league) return null;
  const meta: LeagueMeta = {
    leagueId,
    name: league.name || "League",
    season: league.season || String(new Date().getFullYear()),
    totalRosters: league.total_rosters || rosters.length,
    previousLeagueId: league.previous_league_id || null,
  };

  // Draft picks across all completed drafts.
  const draftPicks: Array<DraftPickRaw & { draftId: string; draftDate: string }> = [];
  for (const d of drafts || []) {
    const picks = await fetchJson<DraftPickRaw[]>(`${SLEEPER_API}/draft/${d.draft_id}/picks`);
    if (!picks) continue;
    const draftDate = isoDate(d.start_time ?? d.last_picked ?? null, `${d.season}-05-01`);
    for (const p of picks) draftPicks.push({ ...p, draftId: d.draft_id, draftDate });
  }

  // Transactions across the season's weeks.
  const weeks = Array.from({ length: TRANSACTION_WEEKS }, (_, i) => i + 1);
  const weekTxns = await mapBounded(weeks, 6, (w) => fetchJson<TxnRaw[]>(`${SLEEPER_API}/league/${leagueId}/transactions/${w}`));
  const txns: TxnRaw[] = [];
  for (const list of weekTxns) for (const t of list || []) txns.push(t);

  return { meta, rosters, drafts: drafts || [], draftPicks, tradedPicks: tradedPicks || [], txns };
}

// ── Per-league ledger construction ───────────────────────────────────────────
interface ProcessCtx {
  positions: PositionDraft[];
  events: EventDraft[];
  playersDb: Record<string, any>;
  nameOf: (pid: string) => string;
  posOf: (pid: string) => string;
  valuePlayer: (pid: string, date: string) => { value: number; confidence: Confidence };
  valuePick: (ref: PickRef, date: string) => Promise<{ value: number; confidence: Confidence }>;
}

async function processLeague(
  leagueId: string,
  data: LeagueRawData,
  userId: string,
  ctx: ProcessCtx,
): Promise<void> {
  const lg = data.meta;
  const targetRoster = data.rosters.find((r) => r.owner_id === userId);
  if (!targetRoster) return;
  const rid = targetRoster.roster_id;
  const isContinuing = !!lg.previousLeagueId;
  const seasonStart = `${lg.season}-08-15`;

  // Open player positions for THIS league, keyed by playerId (most recent open).
  const openPlayers = new Map<string, PositionDraft>();

  const addPlayerPosition = (
    pid: string,
    acquiredDate: string,
    method: string,
    costBasisOverride?: number,
  ): PositionDraft => {
    const v = ctx.valuePlayer(pid, acquiredDate);
    const pos: PositionDraft = {
      sleeperUserId: userId,
      leagueId: lg.leagueId,
      rosterId: rid,
      assetType: "player",
      assetKey: `player_${pid}`,
      playerId: pid,
      playerName: ctx.nameOf(pid),
      pickSeason: null,
      pickRound: null,
      pickOriginalRosterId: null,
      pickSlot: null,
      pickBucket: null,
      acquiredDate,
      acquiredMethod: method,
      disposedDate: null,
      disposedMethod: null,
      acquisitionValue: v.value,
      costBasis: costBasisOverride ?? v.value,
      isCurrent: true,
      confidence: v.confidence,
    };
    ctx.positions.push(pos);
    openPlayers.set(pid, pos);
    return pos;
  };
  const closePlayerPosition = (pid: string, date: string, method: string) => {
    const open = openPlayers.get(pid);
    if (!open) return;
    open.disposedDate = date;
    open.disposedMethod = method;
    open.isCurrent = false;
    openPlayers.delete(pid);
  };

  // 1) Drafts → acquisitions.
  for (const dp of data.draftPicks) {
    if (dp.picked_by !== userId) continue;
    const method = isContinuing ? "rookie_draft" : "startup_draft";
    const pos = addPlayerPosition(dp.player_id, dp.draftDate, method);
    ctx.events.push({
      sleeperUserId: userId,
      leagueId: lg.leagueId,
      rosterId: rid,
      eventDate: dp.draftDate,
      eventType: isContinuing ? "rookie_draft" : "startup_draft",
      title: `${isContinuing ? "Rookie draft" : "Startup draft"}: ${ctx.nameOf(dp.player_id)}`,
      description: `Drafted ${ctx.nameOf(dp.player_id)} at ${dp.round}.${String(dp.draft_slot).padStart(2, "0")} in ${lg.name}`,
      valueBefore: null,
      valueAfter: pos.acquisitionValue,
      valueSent: null,
      valueReceived: pos.acquisitionValue,
      netDelta: 0,
      rosterValueDelta: pos.acquisitionValue,
      pickValueDelta: 0,
      costBasisDelta: pos.costBasis,
      detail: { received: [{ name: pos.playerName, pos: ctx.posOf(dp.player_id), value: pos.acquisitionValue, kind: "player" }] },
      rawTransactionId: null,
      rawDraftId: dp.draftId,
      confidence: pos.confidence,
    });
  }

  // 2) Transactions (trades + waivers/FA), chronological.
  const txns = data.txns
    .filter((t) => t.status === "complete" && Array.isArray(t.roster_ids) && t.roster_ids.includes(rid))
    .sort((a, b) => (a.status_updated ?? a.created ?? 0) - (b.status_updated ?? b.created ?? 0));

  for (const t of txns) {
    const date = isoDate(t.status_updated ?? t.created ?? null, seasonStart);
    const adds = t.adds || {};
    const drops = t.drops || {};
    const receivedPlayers = Object.keys(adds).filter((pid) => adds[pid] === rid);
    const sentPlayers = Object.keys(drops).filter((pid) => drops[pid] === rid);

    if (t.type === "trade") {
      // Picks moved in this trade.
      const receivedPicks = (t.draft_picks || []).filter((p) => p.owner_id === rid && p.previous_owner_id !== rid);
      const sentPicks = (t.draft_picks || []).filter((p) => p.previous_owner_id === rid && p.owner_id !== rid);

      // Value everything on the trade date.
      const sentPlayerVals = sentPlayers.map((pid) => ({ pid, ...ctx.valuePlayer(pid, date) }));
      const sentPickVals = await Promise.all(
        sentPicks.map(async (p) => ({ p, ...(await ctx.valuePick({ season: Number(p.season), round: p.round, bucket: "mid" }, date)) })),
      );
      const recvPlayerVals = receivedPlayers.map((pid) => ({ pid, ...ctx.valuePlayer(pid, date) }));
      const recvPickVals = await Promise.all(
        receivedPicks.map(async (p) => ({ p, ...(await ctx.valuePick({ season: Number(p.season), round: p.round, bucket: "mid" }, date)) })),
      );

      const valueSent =
        sentPlayerVals.reduce((s, x) => s + x.value, 0) + sentPickVals.reduce((s, x) => s + x.value, 0);
      const valueReceived =
        recvPlayerVals.reduce((s, x) => s + x.value, 0) + recvPickVals.reduce((s, x) => s + x.value, 0);

      // Close sent assets.
      for (const sp of sentPlayerVals) closePlayerPosition(sp.pid, date, "trade");
      for (const sp of sentPicks) {
        const key = pickKey(Number(sp.season), sp.round, sp.roster_id);
        const open = ctx.positions.find((x) => x.leagueId === lg.leagueId && x.assetKey === key && x.isCurrent);
        if (open) { open.disposedDate = date; open.disposedMethod = "trade"; open.isCurrent = false; }
      }

      // Open received assets with proportional cost-basis allocation from valueSent.
      const recvTotal = valueReceived || 1;
      for (const rp of recvPlayerVals) {
        addPlayerPosition(rp.pid, date, "trade", allocateCostBasis(valueSent, rp.value, recvTotal));
      }
      for (const idx in recvPickVals) {
        const rp = recvPickVals[idx];
        const basis = allocateCostBasis(valueSent, rp.value, recvTotal);
        openPickPosition(ctx, lg.leagueId, userId, rid, rp.p, date, "trade", rp.value, basis, rp.confidence);
      }

      const sentList = [
        ...sentPlayerVals.map((x) => ({ name: ctx.nameOf(x.pid), pos: ctx.posOf(x.pid), value: x.value, kind: "player" })),
        ...sentPickVals.map((x) => ({ name: pickLabel(Number(x.p.season), x.p.round), value: x.value, kind: "pick" })),
      ];
      const recvList = [
        ...recvPlayerVals.map((x) => ({ name: ctx.nameOf(x.pid), pos: ctx.posOf(x.pid), value: x.value, kind: "player" })),
        ...recvPickVals.map((x) => ({ name: pickLabel(Number(x.p.season), x.p.round), value: x.value, kind: "pick" })),
      ];
      if (sentList.length === 0 && recvList.length === 0) continue;
      ctx.events.push({
        sleeperUserId: userId,
        leagueId: lg.leagueId,
        rosterId: rid,
        eventDate: date,
        eventType: "trade",
        title: "Trade completed",
        description: `Trade in ${lg.name}`,
        valueBefore: null,
        valueAfter: null,
        valueSent: Math.round(valueSent),
        valueReceived: Math.round(valueReceived),
        netDelta: valueReceived - valueSent,
        rosterValueDelta: recvPlayerVals.reduce((s, x) => s + x.value, 0) - sentPlayerVals.reduce((s, x) => s + x.value, 0),
        pickValueDelta: recvPickVals.reduce((s, x) => s + x.value, 0) - sentPickVals.reduce((s, x) => s + x.value, 0),
        costBasisDelta: 0,
        detail: { sent: sentList, received: recvList },
        rawTransactionId: null,
        rawDraftId: null,
        confidence: "estimated",
      });
    } else if (t.type === "waiver" || t.type === "free_agent") {
      const addVals = receivedPlayers.map((pid) => ({ pid, ...ctx.valuePlayer(pid, date) }));
      const dropVals = sentPlayers.map((pid) => ({ pid, ...ctx.valuePlayer(pid, date) }));
      const method = t.type === "waiver" ? "waiver" : "free_agent";
      for (const a of addVals) addPlayerPosition(a.pid, date, method);
      for (const d of dropVals) closePlayerPosition(d.pid, date, "drop");

      const addValue = addVals.reduce((s, x) => s + x.value, 0);
      const dropValue = dropVals.reduce((s, x) => s + x.value, 0);
      // Skip noise: a tiny add/drop with no meaningful value isn't an "event".
      if (addValue < MEANINGFUL_DROP_VALUE && dropValue < MEANINGFUL_DROP_VALUE) continue;
      ctx.events.push({
        sleeperUserId: userId,
        leagueId: lg.leagueId,
        rosterId: rid,
        eventDate: date,
        eventType: t.type === "waiver" ? "waiver_claim" : "free_agent_add",
        title: t.type === "waiver" ? "Waiver claim" : "Free agent add",
        description: `${addVals.map((a) => ctx.nameOf(a.pid)).join(", ") || "—"} in ${lg.name}`,
        valueBefore: null,
        valueAfter: null,
        valueSent: Math.round(dropValue),
        valueReceived: Math.round(addValue),
        netDelta: addValue - dropValue,
        rosterValueDelta: addValue - dropValue,
        pickValueDelta: 0,
        costBasisDelta: addValue,
        detail: {
          received: addVals.map((x) => ({ name: ctx.nameOf(x.pid), pos: ctx.posOf(x.pid), value: x.value, kind: "player" })),
          sent: dropVals.map((x) => ({ name: ctx.nameOf(x.pid), pos: ctx.posOf(x.pid), value: x.value, kind: "player" })),
        },
        rawTransactionId: null,
        rawDraftId: null,
        confidence: "estimated",
      });
    }
  }

  // 3) Reconcile against the live roster so current holdings are exact.
  const currentIds = new Set(targetRoster.players || []);
  // Close still-open positions for players no longer rostered (unknown disposal).
  for (const [pid, open] of Array.from(openPlayers.entries())) {
    if (!currentIds.has(pid)) {
      open.disposedDate = todayStr();
      open.disposedMethod = "unknown";
      open.isCurrent = false;
      openPlayers.delete(pid);
    }
  }
  // Open league_import positions for current players we never saw acquired.
  for (const pid of Array.from(currentIds)) {
    if (!openPlayers.has(pid)) {
      const pos = addPlayerPosition(pid, seasonStart, "league_import");
      pos.confidence = "estimated";
    }
  }

  // 4) Reconcile current pick ownership.
  await reconcilePicks(lg, data, rid, userId, ctx);
}

// ── Pick helpers ─────────────────────────────────────────────────────────────
function pickKey(season: number, round: number, originalRosterId: number): string {
  return `pick_${season}_round${round}_orig${originalRosterId}`;
}
function pickLabel(season: number, round: number): string {
  const suffix = round === 1 ? "1st" : round === 2 ? "2nd" : round === 3 ? "3rd" : `${round}th`;
  return `${season} ${suffix}`;
}

function openPickPosition(
  ctx: ProcessCtx,
  leagueId: string,
  userId: string,
  rid: number,
  p: { season: string; round: number; roster_id: number },
  date: string,
  method: string,
  value: number,
  basis: number,
  confidence: Confidence,
): void {
  ctx.positions.push({
    sleeperUserId: userId,
    leagueId,
    rosterId: rid,
    assetType: "pick",
    assetKey: pickKey(Number(p.season), p.round, p.roster_id),
    playerId: null,
    playerName: null,
    pickSeason: Number(p.season),
    pickRound: p.round,
    pickOriginalRosterId: p.roster_id,
    pickSlot: null,
    pickBucket: "mid",
    acquiredDate: date,
    acquiredMethod: method,
    disposedDate: null,
    disposedMethod: null,
    acquisitionValue: value,
    costBasis: basis,
    isCurrent: true,
    confidence,
  });
}

/** Ensure open pick positions exactly match the future picks the roster owns now. */
async function reconcilePicks(
  lg: { leagueId: string; name: string; season: string },
  data: LeagueRawData,
  rid: number,
  userId: string,
  ctx: ProcessCtx,
): Promise<void> {
  const futureYears = [Number(lg.season) + 1, Number(lg.season) + 2, Number(lg.season) + 3];
  const rounds = [1, 2, 3, 4];
  // Current ownership: each roster starts with its own; traded_picks reassign.
  const owner = new Map<string, number>();
  for (const r of data.rosters) for (const y of futureYears) for (const rd of rounds) owner.set(`${y}-${rd}-${r.roster_id}`, r.roster_id);
  for (const tp of data.tradedPicks) {
    const y = Number(tp.season);
    if (!futureYears.includes(y)) continue;
    const key = `${y}-${tp.round}-${tp.roster_id}`;
    if (owner.has(key)) owner.set(key, tp.owner_id);
  }
  const ownedNow = new Set<string>();
  owner.forEach((own, key) => {
    if (own === rid) {
      const [y, rd, orig] = key.split("-").map(Number);
      ownedNow.add(pickKey(y, rd, orig));
    }
  });

  // Close open pick positions that are no longer owned.
  for (const pos of ctx.positions) {
    if (pos.leagueId !== lg.leagueId || pos.assetType !== "pick" || !pos.isCurrent) continue;
    if (!ownedNow.has(pos.assetKey)) {
      pos.disposedDate = todayStr();
      pos.disposedMethod = "unknown";
      pos.isCurrent = false;
    }
  }
  // Open league_import pick positions for owned picks not already tracked.
  const today = todayStr();
  for (const key of Array.from(ownedNow)) {
    const exists = ctx.positions.some((p) => p.leagueId === lg.leagueId && p.assetKey === key && p.isCurrent);
    if (exists) continue;
    const m = key.match(/^pick_(\d+)_round(\d+)_orig(\d+)$/);
    if (!m) continue;
    const season = Number(m[1]);
    const round = Number(m[2]);
    const orig = Number(m[3]);
    const v = await ctx.valuePick({ season, round, bucket: "mid" }, today);
    openPickPosition(ctx, lg.leagueId, userId, rid, { season: String(season), round, roster_id: orig }, today, "league_import", v.value, v.value, v.confidence);
  }
}
