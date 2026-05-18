import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  drafts,
  draftPicks,
  adpSnapshots,
  crawledLeagues,
  type Draft,
} from "@shared/schema";
import { getSleeperPlayers } from "./sleeper";

const SLEEPER_API = "https://api.sleeper.app/v1";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ── Types ────────────────────────────────────────────────────────────────────

interface SleeperDraftRaw {
  draft_id: string;
  league_id: string | null;
  status: string;
  type: string;
  season: string;
  start_time: number | null;
  created: number;
  last_picked: number | null;
  settings?: {
    rounds?: number;
    teams?: number;
    slots_qb?: number;
    slots_rb?: number;
    slots_wr?: number;
    slots_te?: number;
    slots_flex?: number;
    slots_super_flex?: number;
    slots_k?: number;
    slots_def?: number;
    slots_bn?: number;
    rec?: number;
    pass_td?: number;
    best_ball?: number;
    [key: string]: any;
  };
  metadata?: {
    scoring_type?: string;
    [key: string]: any;
  };
}

interface SleeperDraftPickRaw {
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: number | null;
  picked_by: string | null;
  player_id: string | null;
  is_keeper: boolean | null;
  metadata?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
    [key: string]: any;
  };
}

export type AdpFilters = {
  draftType?: "startup" | "rookie" | "supplemental" | "all";
  draftFormat?: "snake" | "auction" | "linear" | "all";
  scoring?: "ppr" | "half" | "standard" | "all";
  superflex?: "yes" | "no" | "all";
  tePremium?: "yes" | "no" | "all";
  bestBall?: "yes" | "no" | "all";
  leagueMode?: "dynasty" | "keeper" | "redraft" | "all";
  teams?: number | "all";
  rookieMode?: "picks" | "direct";
  passTd?: 4 | 6 | "all";
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
};

export type AdpRow = {
  player_id: string;
  player_name: string;
  position: "QB" | "RB" | "WR" | "TE" | "K" | "PICK";
  team: string;
  is_rookie_placeholder: boolean;
  rookie_pick_label: string | null;
  avg_pick: number;
  median_pick: number;
  min_pick: number;
  max_pick: number;
  draft_count: number;
  positional_rank: number;
  overall_rank: number;
  trend_7d: number;
  trend_30d: number;
  sample_size_warning: boolean;
};

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ── Sleeper → normalized draft ───────────────────────────────────────────────

function deriveScoringType(d: SleeperDraftRaw): "ppr" | "half" | "standard" {
  const rec = d.settings?.rec ?? 0;
  if (rec === 1) return "ppr";
  if (rec === 0.5) return "half";
  return "standard";
}

function deriveSuperflex(d: SleeperDraftRaw): boolean {
  return (d.settings?.slots_super_flex ?? 0) > 0;
}

function deriveTePremium(d: SleeperDraftRaw): boolean {
  // Sleeper exposes TE premium via scoring overrides on the league, not the
  // draft. We don't have those here, so the flag stays false unless we
  // explicitly pull league scoring. Defensive default keeps filters honest.
  return false;
}

function deriveDraftType(d: SleeperDraftRaw): "startup" | "rookie" | "supplemental" {
  const rounds = d.settings?.rounds ?? 0;
  // Rookie/supplemental drafts have few rounds (typically 3-5). Startups
  // run one round per roster slot, usually 14+.
  if (rounds >= 8) return "startup";
  return d.type === "linear" ? "rookie" : "rookie";
}

function deriveDraftFormat(d: SleeperDraftRaw): "snake" | "auction" | "linear" {
  if (d.type === "auction") return "auction";
  if (d.type === "linear") return "linear";
  return "snake";
}

/** Normalize a Sleeper timestamp value to JS milliseconds. */
function toMillis(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  // > 1e12 → already ms; > 1e9 → seconds; smaller → garbage.
  if (v > 1e12) return v;
  if (v > 1e9) return v * 1000;
  return null;
}

function isCompletedStatus(status: string | null | undefined, hasPicks: boolean): boolean {
  // Accept Sleeper's canonical 'complete' plus a few defensive variants. If
  // the status is missing entirely but the pick list is populated, treat the
  // draft as complete so we don't silently drop ingestable data.
  if (!status) return hasPicks;
  const s = status.toLowerCase();
  return s === "complete" || s === "completed" || s === "closed" || s === "done";
}

function pickDraftDate(d: SleeperDraftRaw, completed: boolean): {
  draftDate: Date | null;
  completedAt: number | null;
  startTime: number | null;
  createdAt: number | null;
} {
  // Per spec: prefer completed_at (Sleeper exposes this as last_picked when
  // the draft is complete), then start_time, then created.
  const completedAt = completed ? toMillis(d.last_picked) : null;
  const startTime = toMillis(d.start_time);
  const createdAt = toMillis(d.created);
  const chosen = completedAt ?? startTime ?? createdAt;
  return {
    draftDate: chosen ? new Date(chosen) : null,
    completedAt,
    startTime,
    createdAt,
  };
}

function rookiePickLabelFromMetadata(meta: SleeperDraftPickRaw["metadata"], round: number, pickInRound: number, season: string | null): string | null {
  // Sleeper rookie drafts encode placeholder picks via metadata.years and a
  // null player_id when the slot is unfilled. We use the round/pick form so
  // the label matches the frontend convention.
  if (!season) return null;
  const pr = String(pickInRound).padStart(2, "0");
  return `${season} Rookie ${round}.${pr}`;
}

// ── Ingestion ────────────────────────────────────────────────────────────────

export async function ingestDraftById(draftId: string): Promise<{ ok: boolean; status: string; picks: number; reason?: string }> {
  const draftRaw = await fetchJson<SleeperDraftRaw>(`${SLEEPER_API}/draft/${draftId}`);
  if (!draftRaw) return { ok: false, status: "missing", picks: 0, reason: "draft not found" };

  // Pull picks first so we can use their presence as a fallback signal when
  // Sleeper's status field is missing or non-canonical.
  const picksRaw = await fetchJson<SleeperDraftPickRaw[]>(`${SLEEPER_API}/draft/${draftId}/picks`);
  const hasPicks = Array.isArray(picksRaw) && picksRaw.some((p) => p.player_id);
  const completed = isCompletedStatus(draftRaw.status, hasPicks);

  console.log(`[ADP ingestDraftById] ${draftId} status="${draftRaw.status}" picks=${picksRaw?.length ?? 0} completed=${completed}`);

  // Per spec: only completed drafts go into ADP by default. We still record
  // their existence so the admin tools can see in-progress drafts.
  if (!completed) {
    await upsertDraftRow(draftRaw, /* directlyDraftedRookies */ false, completed);
    return { ok: true, status: draftRaw.status, picks: 0, reason: "not complete" };
  }

  if (!picksRaw) return { ok: false, status: draftRaw.status, picks: 0, reason: "picks not found" };

  const teams = draftRaw.settings?.teams ?? 12;
  const rounds = draftRaw.settings?.rounds ?? Math.ceil(picksRaw.length / Math.max(teams, 1));

  // Classify rookie drafts: if any pick has a non-null player_id AND its
  // position is a real NFL position, this is a "directly drafted rookies"
  // draft. Otherwise the draft enumerates rookie pick placeholders.
  const draftType = deriveDraftType(draftRaw);
  const directlyDraftedRookies = draftType !== "startup"
    && picksRaw.some((p) => p.player_id && (p.metadata?.position || "").length > 0);

  await upsertDraftRow(draftRaw, directlyDraftedRookies, completed);

  // Replace picks atomically (cheap — they're small per draft).
  await db.delete(draftPicks).where(eq(draftPicks.draftId, draftId));

  if (picksRaw.length === 0) {
    return { ok: true, status: draftRaw.status, picks: 0 };
  }

  const rows = picksRaw.map((p) => {
    const pickInRound = ((p.pick_no - 1) % Math.max(teams, 1)) + 1;
    const isPlaceholder = draftType !== "startup" && !p.player_id;
    const isRookie = draftType !== "startup" && !!p.player_id;
    const playerName = p.metadata?.first_name && p.metadata?.last_name
      ? `${p.metadata.first_name} ${p.metadata.last_name}`.trim()
      : null;

    return {
      draftId,
      pickNo: p.pick_no,
      round: p.round,
      pickInRound,
      draftSlot: p.draft_slot ?? null,
      rosterId: p.roster_id ?? null,
      pickedBy: p.picked_by ?? null,
      playerId: isPlaceholder
        ? `rookie_pick_${draftRaw.season}_${p.round}_${pickInRound}`
        : (p.player_id ?? null),
      playerName: isPlaceholder
        ? rookiePickLabelFromMetadata(p.metadata, p.round, pickInRound, draftRaw.season)
        : playerName,
      position: (isPlaceholder ? "PICK" : (p.metadata?.position ?? null)) as string | null,
      team: p.metadata?.team ?? null,
      isRookie,
      isRookiePlaceholder: isPlaceholder,
      rookiePickLabel: isPlaceholder
        ? rookiePickLabelFromMetadata(p.metadata, p.round, pickInRound, draftRaw.season)
        : null,
    };
  });

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(draftPicks).values(rows.slice(i, i + BATCH));
  }

  return { ok: true, status: draftRaw.status, picks: rows.length };
}

async function upsertDraftRow(draftRaw: SleeperDraftRaw, directlyDraftedRookies: boolean, completed: boolean) {
  const dates = pickDraftDate(draftRaw, completed);
  const draftType = deriveDraftType(draftRaw);
  const draftFormat = deriveDraftFormat(draftRaw);

  const values = {
    draftId: draftRaw.draft_id,
    leagueId: draftRaw.league_id ?? null,
    season: draftRaw.season,
    // Normalize all completed-ish statuses to "complete" so the read query
    // filter has one canonical value to match against.
    status: completed ? "complete" : (draftRaw.status ?? "unknown"),
    draftType,
    draftFormat,
    teams: draftRaw.settings?.teams ?? 12,
    rounds: draftRaw.settings?.rounds ?? 0,
    scoringType: deriveScoringType(draftRaw),
    leagueMode: "dynasty" as const,
    superflex: deriveSuperflex(draftRaw),
    tePremium: deriveTePremium(draftRaw),
    bestBall: (draftRaw.settings?.best_ball ?? 0) === 1,
    passTd: draftRaw.settings?.pass_td === 6 ? 6 : 4,
    rosterSize:
      (draftRaw.settings?.slots_qb ?? 0) +
      (draftRaw.settings?.slots_rb ?? 0) +
      (draftRaw.settings?.slots_wr ?? 0) +
      (draftRaw.settings?.slots_te ?? 0) +
      (draftRaw.settings?.slots_flex ?? 0) +
      (draftRaw.settings?.slots_super_flex ?? 0) +
      (draftRaw.settings?.slots_k ?? 0) +
      (draftRaw.settings?.slots_def ?? 0) +
      (draftRaw.settings?.slots_bn ?? 0),
    starterCount:
      (draftRaw.settings?.slots_qb ?? 0) +
      (draftRaw.settings?.slots_rb ?? 0) +
      (draftRaw.settings?.slots_wr ?? 0) +
      (draftRaw.settings?.slots_te ?? 0) +
      (draftRaw.settings?.slots_flex ?? 0) +
      (draftRaw.settings?.slots_super_flex ?? 0),
    draftDate: dates.draftDate,
    completedAt: dates.completedAt,
    startTime: dates.startTime,
    createdAt: dates.createdAt,
    directlyDraftedRookies,
    ingestedAt: new Date(),
  };

  await db
    .insert(drafts)
    .values(values)
    .onConflictDoUpdate({
      target: drafts.draftId,
      set: values,
    });
}

export async function ingestLeagueDrafts(leagueId: string): Promise<{ ok: boolean; drafts: number; completed: number }> {
  const list = await fetchJson<SleeperDraftRaw[]>(`${SLEEPER_API}/league/${leagueId}/drafts`);
  if (!list || list.length === 0) return { ok: true, drafts: 0, completed: 0 };

  let completed = 0;
  for (const d of list) {
    const result = await ingestDraftById(d.draft_id);
    if (result.ok && result.status === "complete") completed++;
  }
  return { ok: true, drafts: list.length, completed };
}

export async function ingestUserDrafts(username: string, season: string = "2026"): Promise<{ ok: boolean; leagues: number; drafts: number; completed: number }> {
  const userRes = await fetch(`${SLEEPER_API}/user/${username}`);
  if (!userRes.ok) return { ok: false, leagues: 0, drafts: 0, completed: 0 };
  const userData = (await userRes.json()) as { user_id: string };
  if (!userData?.user_id) return { ok: false, leagues: 0, drafts: 0, completed: 0 };

  const leagues = await fetchJson<Array<{ league_id: string }>>(
    `${SLEEPER_API}/user/${userData.user_id}/leagues/nfl/${season}`
  );
  if (!leagues) return { ok: false, leagues: 0, drafts: 0, completed: 0 };

  let totalDrafts = 0;
  let totalCompleted = 0;
  for (const lg of leagues) {
    const r = await ingestLeagueDrafts(lg.league_id);
    totalDrafts += r.drafts;
    totalCompleted += r.completed;
  }
  return { ok: true, leagues: leagues.length, drafts: totalDrafts, completed: totalCompleted };
}

/**
 * Walk the leagues we've already crawled (via the trade crawler) and pull
 * their drafts. This is the workhorse for the background refresh — it never
 * touches Sleeper for league discovery, just for the draft data.
 */
export async function ingestCrawledLeagueDrafts(limit: number = 200): Promise<{ leagues: number; drafts: number; completed: number }> {
  const rows = await db
    .select({ id: crawledLeagues.id })
    .from(crawledLeagues)
    .orderBy(desc(crawledLeagues.crawledAt))
    .limit(limit);

  let totalDrafts = 0;
  let totalCompleted = 0;
  for (const row of rows) {
    try {
      const r = await ingestLeagueDrafts(row.id);
      totalDrafts += r.drafts;
      totalCompleted += r.completed;
    } catch (err) {
      console.error(`[ADP] ingestLeagueDrafts failed for ${row.id}:`, (err as Error).message);
    }
  }
  return { leagues: rows.length, drafts: totalDrafts, completed: totalCompleted };
}

// ── ADP computation ──────────────────────────────────────────────────────────

function filterKey(f: AdpFilters): string {
  // Deterministic key for cache lookups. Keep keys human-readable so logs
  // are usable.
  const k = {
    dt: f.draftType ?? "startup",
    df: f.draftFormat ?? "snake",
    sc: f.scoring ?? "all",
    sf: f.superflex ?? "all",
    te: f.tePremium ?? "all",
    bb: f.bestBall ?? "all",
    lm: f.leagueMode ?? "dynasty",
    t: f.teams ?? "all",
    rm: f.rookieMode ?? "direct",
    pt: f.passTd ?? "all",
    sd: f.startDate ?? "",
    ed: f.endDate ?? "",
  };
  return Object.entries(k).map(([key, val]) => `${key}=${val}`).join("|");
}

function buildDraftWhere(f: AdpFilters) {
  const conds: any[] = [eq(drafts.status, "complete")];
  if (f.draftType && f.draftType !== "all") conds.push(eq(drafts.draftType, f.draftType));
  if (f.draftFormat && f.draftFormat !== "all") conds.push(eq(drafts.draftFormat, f.draftFormat));
  if (f.scoring && f.scoring !== "all") conds.push(eq(drafts.scoringType, f.scoring));
  if (f.leagueMode && f.leagueMode !== "all") conds.push(eq(drafts.leagueMode, f.leagueMode));
  if (f.teams && f.teams !== "all") conds.push(eq(drafts.teams, f.teams as number));
  if (f.superflex === "yes") conds.push(eq(drafts.superflex, true));
  if (f.superflex === "no") conds.push(eq(drafts.superflex, false));
  if (f.tePremium === "yes") conds.push(eq(drafts.tePremium, true));
  if (f.tePremium === "no") conds.push(eq(drafts.tePremium, false));
  if (f.bestBall === "yes") conds.push(eq(drafts.bestBall, true));
  if (f.bestBall === "no") conds.push(eq(drafts.bestBall, false));
  if (f.passTd && f.passTd !== "all") conds.push(eq(drafts.passTd, f.passTd as number));
  if (f.startDate) conds.push(sql`${drafts.draftDate} >= ${f.startDate}::timestamp`);
  if (f.endDate) conds.push(sql`${drafts.draftDate} < (${f.endDate}::timestamp + interval '1 day')`);
  return and(...conds);
}

/** Compute ADP rows from the stored draft_picks for a given filter set. */
export async function computeAdp(f: AdpFilters): Promise<{ rows: AdpRow[]; draftCount: number; pickCount: number }> {
  const eligibleDrafts = await db
    .select({ draftId: drafts.draftId, draftDate: drafts.draftDate })
    .from(drafts)
    .where(buildDraftWhere(f));

  console.log(`[ADP computeAdp] eligible drafts: ${eligibleDrafts.length}`);
  if (eligibleDrafts.length === 0) return { rows: [], draftCount: 0, pickCount: 0 };

  const draftIds = eligibleDrafts.map((d) => d.draftId);
  const draftDateById = new Map(eligibleDrafts.map((d) => [d.draftId, d.draftDate]));

  // Picks filtered by rookie mode.
  const rookieMode = f.rookieMode ?? "direct";
  const placeholderCond = rookieMode === "picks"
    ? sql`true`
    : eq(draftPicks.isRookiePlaceholder, false);

  const picks = await db
    .select({
      draftId: draftPicks.draftId,
      pickNo: draftPicks.pickNo,
      playerId: draftPicks.playerId,
      playerName: draftPicks.playerName,
      position: draftPicks.position,
      team: draftPicks.team,
      isRookiePlaceholder: draftPicks.isRookiePlaceholder,
      rookiePickLabel: draftPicks.rookiePickLabel,
    })
    .from(draftPicks)
    .where(and(inArray(draftPicks.draftId, draftIds), placeholderCond));

  console.log(`[ADP computeAdp] picks matched: ${picks.length}`);

  // Aggregate per player.
  type Agg = {
    playerId: string;
    name: string;
    position: string;
    team: string;
    isRookiePlaceholder: boolean;
    rookiePickLabel: string | null;
    picks: number[];
    // For trend, keep (date_ms, pick_no) so we can split by 7d/30d windows.
    timed: Array<{ t: number; p: number }>;
  };
  const agg = new Map<string, Agg>();

  for (const p of picks) {
    if (!p.playerId) continue;
    const existing = agg.get(p.playerId);
    if (existing) {
      existing.picks.push(p.pickNo);
      const dd = draftDateById.get(p.draftId);
      if (dd) existing.timed.push({ t: dd.getTime(), p: p.pickNo });
    } else {
      const dd = draftDateById.get(p.draftId);
      agg.set(p.playerId, {
        playerId: p.playerId,
        name: p.playerName ?? p.playerId,
        position: p.position ?? "??",
        team: p.team ?? "",
        isRookiePlaceholder: p.isRookiePlaceholder,
        rookiePickLabel: p.rookiePickLabel,
        picks: [p.pickNo],
        timed: dd ? [{ t: dd.getTime(), p: p.pickNo }] : [],
      });
    }
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const rows: AdpRow[] = Array.from(agg.values()).map((a) => {
    const sorted = [...a.picks].sort((x, y) => x - y);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const avg = sum / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];

    const last7 = a.timed.filter((x) => now - x.t <= 7 * DAY).map((x) => x.p);
    const last30 = a.timed.filter((x) => now - x.t <= 30 * DAY).map((x) => x.p);
    const prior30 = a.timed.filter((x) => now - x.t > 30 * DAY && now - x.t <= 60 * DAY).map((x) => x.p);
    const meanOr = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : avg);

    const trend7 = Math.round(meanOr(last7) - meanOr(last30));
    const trend30 = Math.round(meanOr(last30) - meanOr(prior30));

    const validPos = (["QB", "RB", "WR", "TE", "K", "PICK"] as const).includes(a.position as any)
      ? (a.position as AdpRow["position"])
      : "QB";

    return {
      player_id: a.playerId,
      player_name: a.name,
      position: validPos,
      team: a.team,
      is_rookie_placeholder: a.isRookiePlaceholder,
      rookie_pick_label: a.rookiePickLabel,
      avg_pick: Math.round(avg * 10) / 10,
      median_pick: median,
      min_pick: sorted[0],
      max_pick: sorted[sorted.length - 1],
      draft_count: sorted.length,
      positional_rank: 0,
      overall_rank: 0,
      trend_7d: trend7,
      trend_30d: trend30,
      sample_size_warning: sorted.length < 8,
    };
  });

  rows.sort((a, b) => a.avg_pick - b.avg_pick);
  const posCounters: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, PICK: 0 };
  rows.forEach((r, idx) => {
    r.overall_rank = idx + 1;
    posCounters[r.position] = (posCounters[r.position] ?? 0) + 1;
    r.positional_rank = posCounters[r.position];
  });

  return { rows, draftCount: eligibleDrafts.length, pickCount: picks.length };
}

// ── Snapshot cache ───────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compute ADP for a filter set and persist the result as today's snapshot. */
export async function refreshAdpSnapshot(f: AdpFilters): Promise<{ rows: number; drafts: number; picks: number; key: string }> {
  const key = filterKey(f);
  const { rows, draftCount, pickCount } = await computeAdp(f);

  await db.insert(adpSnapshots).values({
    filterKey: key,
    filters: f as any,
    rows: rows as any,
    draftCount,
    snapshotDate: todayStr(),
    computedAt: new Date(),
  });

  return { rows: rows.length, drafts: draftCount, picks: pickCount, key };
}

/** Return the most recent snapshot for a filter set, or null if none exists. */
export async function getCachedAdp(f: AdpFilters): Promise<{
  rows: AdpRow[];
  draftCount: number;
  snapshotDate: string;
  computedAt: string;
} | null> {
  const key = filterKey(f);
  const result = await db
    .select()
    .from(adpSnapshots)
    .where(eq(adpSnapshots.filterKey, key))
    .orderBy(desc(adpSnapshots.computedAt))
    .limit(1);

  if (result.length === 0) return null;
  const row = result[0];
  return {
    rows: (row.rows as AdpRow[]) ?? [],
    draftCount: row.draftCount,
    snapshotDate: row.snapshotDate,
    computedAt: row.computedAt?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Read-time entry point: returns the cached snapshot when available, falls
 * back to a live computation against our own draft_picks table when no
 * snapshot exists yet for that filter key. We never reach back out to
 * Sleeper here — the cost ceiling is a single Postgres query.
 */
export async function getAdp(f: AdpFilters): Promise<{
  rows: AdpRow[];
  draftCount: number;
  pickCount: number;
  filterKey: string;
  snapshotDate: string | null;
  computedAt: string;
  cached: boolean;
}> {
  const key = filterKey(f);
  const cached = await getCachedAdp(f);
  if (cached && cached.rows.length > 0) {
    return {
      rows: cached.rows,
      draftCount: cached.draftCount,
      pickCount: cached.rows.reduce((s, r) => s + r.draft_count, 0),
      filterKey: key,
      snapshotDate: cached.snapshotDate,
      computedAt: cached.computedAt,
      cached: true,
    };
  }
  const fresh = await computeAdp(f);
  return {
    rows: fresh.rows,
    draftCount: fresh.draftCount,
    pickCount: fresh.pickCount,
    filterKey: key,
    snapshotDate: null,
    computedAt: new Date().toISOString(),
    cached: false,
  };
}

// ── Default snapshot combos refreshed by the scheduler ───────────────────────
const DEFAULT_COMBOS: AdpFilters[] = [
  // Startup / dynasty defaults split by superflex and scoring.
  { draftType: "startup", draftFormat: "snake", leagueMode: "dynasty", rookieMode: "direct", scoring: "ppr", superflex: "no" },
  { draftType: "startup", draftFormat: "snake", leagueMode: "dynasty", rookieMode: "direct", scoring: "ppr", superflex: "yes" },
  { draftType: "startup", draftFormat: "snake", leagueMode: "dynasty", rookieMode: "direct", scoring: "half", superflex: "no" },
  { draftType: "startup", draftFormat: "snake", leagueMode: "dynasty", rookieMode: "direct", scoring: "half", superflex: "yes" },
  // Rookie drafts.
  { draftType: "rookie", draftFormat: "snake", leagueMode: "dynasty", rookieMode: "direct", scoring: "ppr", superflex: "no" },
  { draftType: "rookie", draftFormat: "snake", leagueMode: "dynasty", rookieMode: "direct", scoring: "ppr", superflex: "yes" },
];

export async function refreshDefaultSnapshots(): Promise<{ combos: number; rows: number }> {
  let totalRows = 0;
  for (const combo of DEFAULT_COMBOS) {
    try {
      const r = await refreshAdpSnapshot(combo);
      totalRows += r.rows;
    } catch (err) {
      console.error(`[ADP] refreshAdpSnapshot failed for ${filterKey(combo)}:`, (err as Error).message);
    }
  }
  return { combos: DEFAULT_COMBOS.length, rows: totalRows };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let adpInterval: NodeJS.Timeout | null = null;
let ingestInterval: NodeJS.Timeout | null = null;

const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const INGEST_INTERVAL_MS = 12 * 60 * 60 * 1000;  // 12h
const INGEST_BATCH = 100;

export function startAdpScheduler() {
  // Don't block server startup — kick the first refresh off-thread.
  refreshDefaultSnapshots()
    .then((r) => console.log(`[ADP] Initial snapshot refresh: ${r.combos} combos, ${r.rows} total rows`))
    .catch((err) => console.error("[ADP] Initial snapshot refresh failed:", err));

  ingestCrawledLeagueDrafts(INGEST_BATCH)
    .then((r) => {
      if (r.completed > 0) {
        console.log(`[ADP] Initial ingest: ${r.leagues} leagues, ${r.completed} completed drafts`);
      }
    })
    .catch((err) => console.error("[ADP] Initial ingest failed:", err));

  adpInterval = setInterval(() => {
    refreshDefaultSnapshots().catch((err) => console.error("[ADP] Snapshot refresh failed:", err));
  }, SNAPSHOT_INTERVAL_MS);

  ingestInterval = setInterval(() => {
    ingestCrawledLeagueDrafts(INGEST_BATCH).catch((err) =>
      console.error("[ADP] Crawled-league ingest failed:", err)
    );
  }, INGEST_INTERVAL_MS);
}

export function stopAdpScheduler() {
  if (adpInterval) clearInterval(adpInterval);
  if (ingestInterval) clearInterval(ingestInterval);
  adpInterval = null;
  ingestInterval = null;
}
