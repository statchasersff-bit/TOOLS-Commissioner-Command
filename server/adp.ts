import { db } from "./db";
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

// Shared, capped Postgres pool (see server/db.ts).

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
  /**
   * NFL season(s) to include. Defaults to the current season when omitted.
   * Stored as the same string Sleeper uses ("2026"). The crawler stamps
   * `drafts.season` from the raw Sleeper response, so this is the dimension
   * the read path filters on.
   *
   * Bug history: prior to 2026-05 the ADP read path had NO season filter,
   * which meant 2026 picks were averaged together with 2025/2024 picks and
   * the displayed ADP looked like a stale 2025 snapshot. Always include
   * `season` in queries + the snapshot cache key from here on.
   */
  season?: string | string[] | "all";
  draftType?: "startup" | "rookie" | "supplemental" | "all";
  draftFormat?: "snake" | "auction" | "linear" | "all";
  scoring?: "ppr" | "half" | "standard" | "all";
  superflex?: "yes" | "no" | "all";
  tePremium?: "yes" | "no" | "all";
  bestBall?: "yes" | "no" | "all";
  leagueMode?: "dynasty" | "keeper" | "redraft" | "all";
  teams?: number | "all";
  rookieMode?: "picks" | "direct" | "both";
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
  // 10th / 90th percentile picks — the middle 80% of drafts fall between
  // these two. Used by the Overview tab's "X% of drafts between …" line so
  // the rail isn't summarised only by min/max outliers.
  p10_pick: number;
  p90_pick: number;
  draft_count: number;
  positional_rank: number;
  overall_rank: number;
  trend_7d: number;
  trend_14d: number;
  trend_30d: number;
  sample_size_warning: boolean;
};

// ── Fetch helpers ────────────────────────────────────────────────────────────
// Global rate limiter for every Sleeper request the ADP pipeline makes —
// keeps us well below Sleeper's published 1000/min ceiling and avoids the
// "live page load fetches the world" trap. Exported so the crawler reuses
// the same gate: there's exactly one shared queue per process.
const MIN_GAP_MS = 400; // ≈150 req/min, leaves headroom for retries
let lastFetchAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rateLimitedFetchJson<T>(url: string): Promise<T | null> {
  const now = Date.now();
  const wait = Math.max(0, MIN_GAP_MS - (now - lastFetchAt));
  if (wait > 0) await sleep(wait);
  lastFetchAt = Date.now();
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  return rateLimitedFetchJson<T>(url);
}

// ── League scoring (for TEP / scoring / superflex / pass_td detection) ───────
// Draft payloads do *not* expose scoring overrides — TE Premium in particular
// only lives on the league's scoring_settings. We fetch the league once per
// process and cache it; leagues' scoring is effectively immutable in-season,
// and the cache resets on each server restart.

interface SleeperLeagueScoring {
  scoring_settings?: {
    rec?: number;
    bonus_rec_te?: number;
    rec_te?: number;
    pass_td?: number;
    [k: string]: any;
  };
  roster_positions?: string[];
  settings?: {
    /** Sleeper league type: 0 = redraft, 1 = keeper, 2 = dynasty. */
    type?: number;
    pass_td?: number;
    [k: string]: any;
  };
}

const leagueScoringCache = new Map<string, SleeperLeagueScoring | null>();

async function fetchLeagueScoring(leagueId: string | null | undefined): Promise<SleeperLeagueScoring | null> {
  if (!leagueId) return null;
  if (leagueScoringCache.has(leagueId)) return leagueScoringCache.get(leagueId) ?? null;
  const data = await fetchJson<SleeperLeagueScoring>(`${SLEEPER_API}/league/${leagueId}`);
  leagueScoringCache.set(leagueId, data ?? null);
  return data ?? null;
}

// ── Sleeper → normalized draft ───────────────────────────────────────────────

function deriveScoringType(d: SleeperDraftRaw, league: SleeperLeagueScoring | null): "ppr" | "half" | "standard" {
  // Prefer the league's scoring_settings.rec when present — draft.settings.rec
  // is sometimes missing for older drafts.
  const rec = league?.scoring_settings?.rec ?? d.settings?.rec ?? 0;
  if (rec >= 0.99) return "ppr";
  if (rec >= 0.4) return "half";
  return "standard";
}

function deriveSuperflex(d: SleeperDraftRaw, league: SleeperLeagueScoring | null): boolean {
  if ((d.settings?.slots_super_flex ?? 0) > 0) return true;
  const rp = league?.roster_positions ?? [];
  return rp.includes("SUPER_FLEX");
}

function derivePassTd(d: SleeperDraftRaw, league: SleeperLeagueScoring | null): number {
  const fromLeague = league?.scoring_settings?.pass_td;
  if (typeof fromLeague === "number") return fromLeague >= 5 ? 6 : 4;
  return d.settings?.pass_td === 6 ? 6 : 4;
}

function deriveTePremium(league: SleeperLeagueScoring | null): boolean {
  // TEP is encoded as a TE-only reception bonus on top of the base PPR. The
  // canonical Sleeper field is bonus_rec_te (additional points per TE
  // reception); some leagues use rec_te (full override). Either signal that
  // breaks the WR/TE reception parity counts as TEP.
  const s = league?.scoring_settings;
  if (!s) return false;
  const bonus = Number(s.bonus_rec_te ?? 0);
  if (bonus > 0) return true;
  const recTe = s.rec_te;
  const baseRec = Number(s.rec ?? 0);
  if (typeof recTe === "number" && recTe > baseRec) return true;
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

/**
 * Derive the Sleeper league mode from the fetched league object.
 * Sleeper encodes: settings.type 0 = redraft, 1 = keeper, 2 = dynasty.
 * Falls back to "dynasty" when the league isn't available (e.g. mock/test
 * drafts with no league_id) so existing behavior is preserved for those cases.
 */
function deriveLeagueMode(league: SleeperLeagueScoring | null): "dynasty" | "keeper" | "redraft" {
  const t = league?.settings?.type;
  if (t === 2) return "dynasty";
  if (t === 1) return "keeper";
  if (t === 0) return "redraft";
  // No league attached (standalone draft) — assume dynasty since this tool
  // is dynasty-only and the crawl already filters to dynasty leagues.
  return "dynasty";
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

// ── Defensive / IDP detection ────────────────────────────────────────────────
// IDP and team-defense drafts have radically different ADP curves from
// QB/RB/WR/TE-only drafts. Mixing them together corrupts the dataset (e.g.
// a defensive player like Jake Golday showing up as "QB16" because some IDP
// draft used the same Sleeper position string). Per spec: if *any* pick in a
// draft is a defensive player, the *entire* draft is excluded from ADP — we
// don't merely drop the bad pick.

const DEFENSIVE_POSITIONS = new Set([
  "DEF", "DST", "D/ST",
  "DL", "DE", "DT", "NT",
  "LB", "ILB", "OLB", "MLB",
  "DB", "CB", "S", "FS", "SS",
  "EDGE", "IDP",
]);

/** Offensive primary positions — used as a "trust the drafted slot" signal
 *  so multi-position-eligible players (e.g. Travis Hunter — Sleeper lists his
 *  fantasy_positions as ["DB","WR"]) aren't misclassified as IDP.
 *
 *  Bug history: prior to this guard, any pick whose `fantasy_positions`
 *  array contained a defensive token was flagged as IDP regardless of how
 *  the player was actually drafted. Travis Hunter alone — drafted as a WR
 *  in essentially every 2026 dynasty startup — caused ~595 startup drafts
 *  to be excluded as "contains_defensive_players", collapsing the ADP
 *  sample to a handful of drafts.
 */
const OFFENSIVE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "PICK"]);

/**
 * True when a single pick is a defensive / IDP player. Evaluation order:
 *   1. If the per-pick metadata position is offensive (QB/RB/WR/TE/K), the
 *      drafter explicitly took this player at an offensive slot — never IDP.
 *   2. If the per-pick metadata position is defensive, flag as IDP.
 *   3. If the cached player-DB primary position is offensive, the pick is
 *      a multi-position-eligible offensive player (Travis Hunter, etc.) —
 *      not IDP.
 *   4. If the player-DB primary position is defensive, flag as IDP.
 *   5. Only when no primary position is available do we fall back to
 *      `fantasy_positions`. That array is multi-position eligibility, NOT
 *      the source of truth for what they were drafted as.
 */
export function isDefensivePlayer(
  pick: SleeperDraftPickRaw,
  playersDb?: Record<string, { position?: string | null; fantasy_positions?: string[] | null }> | null,
): boolean {
  const metaPos = (pick.metadata?.position ?? "").toUpperCase().trim();
  if (metaPos && OFFENSIVE_POSITIONS.has(metaPos)) return false;
  if (metaPos && DEFENSIVE_POSITIONS.has(metaPos)) return true;

  if (pick.player_id && playersDb) {
    const p = playersDb[pick.player_id];
    if (p) {
      const dbPos = (p.position ?? "").toUpperCase().trim();
      if (dbPos && OFFENSIVE_POSITIONS.has(dbPos)) return false;
      if (dbPos && DEFENSIVE_POSITIONS.has(dbPos)) return true;
      const fp = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : [];
      // Only when *no* offensive eligibility exists do we treat a defensive
      // fantasy_positions entry as proof of IDP. Hybrid players (WR + DB)
      // are always offense in this codepath because step 1/3 returned early
      // if their primary position was offensive — this branch is the
      // "primary position missing" fallback.
      const hasOffensiveFp = fp.some(f => OFFENSIVE_POSITIONS.has(String(f).toUpperCase().trim()));
      if (hasOffensiveFp) return false;
      for (const f of fp) {
        if (DEFENSIVE_POSITIONS.has(String(f).toUpperCase().trim())) return true;
      }
    }
  }
  return false;
}

/** True when *any* pick in the draft is a defensive player. Used to mark the
 *  whole draft as excluded from ADP. */
export function draftContainsDefensivePlayers(
  picks: SleeperDraftPickRaw[],
  playersDb?: Record<string, { position?: string | null; fantasy_positions?: string[] | null }> | null,
): boolean {
  for (const p of picks) {
    if (!p.player_id) continue;
    if (isDefensivePlayer(p, playersDb)) return true;
  }
  return false;
}

/** Stored-row version of isDefensivePlayer — used by the reclassifier when we
 *  only have draft_picks rows (no raw Sleeper metadata) to work from. Mirrors
 *  the same offense-wins precedence as `isDefensivePlayer`. */
function isDefensiveFromStored(
  p: { position: string | null; playerId: string | null },
  playersDb?: Record<string, { position?: string | null; fantasy_positions?: string[] | null }> | null,
): boolean {
  const pos = (p.position ?? "").toUpperCase().trim();
  if (pos && OFFENSIVE_POSITIONS.has(pos)) return false;
  if (pos && DEFENSIVE_POSITIONS.has(pos)) return true;
  if (p.playerId && playersDb) {
    const pl = playersDb[p.playerId];
    if (pl) {
      const dbPos = (pl.position ?? "").toUpperCase().trim();
      if (dbPos && OFFENSIVE_POSITIONS.has(dbPos)) return false;
      if (dbPos && DEFENSIVE_POSITIONS.has(dbPos)) return true;
      const fp = Array.isArray(pl.fantasy_positions) ? pl.fantasy_positions : [];
      const hasOffensiveFp = fp.some(f => OFFENSIVE_POSITIONS.has(String(f).toUpperCase().trim()));
      if (hasOffensiveFp) return false;
      for (const f of fp) {
        if (DEFENSIVE_POSITIONS.has(String(f).toUpperCase().trim())) return true;
      }
    }
  }
  return false;
}

// ── Rookie / rookie-pick classification ──────────────────────────────────────
// Sleeper rookie-pick *placeholders* aren't always nullable player_ids — some
// leagues attach a real kicker player_id with metadata that names the slot
// (e.g. "Rookie 1.01"). Some leagues go further and just draft a real kicker
// (e.g. "Justin Tucker") repeatedly as their placeholder, leaving the metadata
// untouched. The old "if !player_id → placeholder" heuristic put both into
// the Direct Rookies bucket. These helpers detect both cases — pattern-match
// on the kicker name first, then fall back to a draft-wide signal so unnamed
// kicker placeholders still get caught.

const ROOKIE_PICK_NAME_PATTERNS: RegExp[] = [
  /\brookie\s*pick\b/i,
  /\brookie\b/i,
  /\b\d\.\d{1,2}\b/,             // 1.01, 2.04, etc.
  /\b(?:1st|2nd|3rd|4th|5th)\b/i,
  /\b20\d{2}\s+(?:1st|2nd|3rd|4th)/i, // "2026 1st"
];

function metaStr(meta: SleeperDraftPickRaw["metadata"] | undefined, key: string): string {
  const v = meta?.[key as keyof typeof meta];
  return typeof v === "string" ? v : "";
}

function pickDisplayName(pick: SleeperDraftPickRaw): string {
  const first = metaStr(pick.metadata, "first_name");
  const last = metaStr(pick.metadata, "last_name");
  return `${first} ${last}`.trim();
}

/** Context shared across a single draft's picks for classification — set
 *  once per draft after a draft-wide pass. */
export interface RookieDraftContext {
  /** True when this draft is using real kickers as placeholder slots (e.g.
   *  the same team drafted 2 kickers, or kickers are >=10% of all picks).
   *  When true, every K pick in the draft is treated as a placeholder
   *  regardless of name. */
  kickersArePlaceholders: boolean;
}

/**
 * Inspect the whole pick list to decide whether this draft is using kickers
 * as future-pick placeholders. Two signals:
 *   A) Kickers account for ≥10% of real-player picks AND there are ≥3 of them.
 *   B) Any single team drafted 2 or more kickers. No real team takes two
 *      rookie kickers — so that's an unambiguous placeholder signal.
 */
export function detectKickerPlaceholderDraft(
  picks: SleeperDraftPickRaw[],
  draftType: string,
): boolean {
  if (draftType === "startup") return false;

  const kickers = picks.filter((p) => {
    if (!p.player_id) return false;
    return (p.metadata?.position ?? "").toUpperCase() === "K";
  });
  if (kickers.length < 3) return false;

  const totalReal = picks.filter((p) => p.player_id).length;
  if (totalReal === 0) return false;

  // Signal A — kicker density.
  if (kickers.length / totalReal >= 0.10 && kickers.length >= 4) return true;

  // Signal B — same team drafted multiple kickers.
  const byRoster = new Map<number, number>();
  for (const k of kickers) {
    if (k.roster_id == null) continue;
    byRoster.set(k.roster_id, (byRoster.get(k.roster_id) ?? 0) + 1);
  }
  for (const c of Array.from(byRoster.values())) {
    if (c >= 2) return true;
  }
  return false;
}

/**
 * True when a pick is a rookie-pick *placeholder slot* — i.e. it occupies the
 * draft board but doesn't represent an actual NFL player selection. Catches:
 *   1) Null player_id (Sleeper's canonical encoding).
 *   2) Position == "K" *and* the name/metadata pattern-matches a rookie pick
 *      label (Sleeper's "use a kicker as a placeholder" encoding).
 *   3) Position == "K" in a draft where the *draft-wide* signal says kickers
 *      are being used as placeholders (real kicker names, e.g. "Justin
 *      Tucker", drafted as future-pick stand-ins).
 */
export function isRookiePickPlaceholder(
  pick: SleeperDraftPickRaw,
  ctx?: RookieDraftContext,
): boolean {
  if (!pick.player_id) return true;

  const pos = (pick.metadata?.position ?? "").toUpperCase();
  if (pos !== "K") return false;

  if (ctx?.kickersArePlaceholders) return true;

  const display = pickDisplayName(pick);
  if (!display) return false;
  return ROOKIE_PICK_NAME_PATTERNS.some((re) => re.test(display));
}

/**
 * True when a pick represents a real NFL rookie player selection (the
 * inverse of placeholder, requiring a real player_id + position).
 */
export function isActualRookiePlayer(
  pick: SleeperDraftPickRaw,
  ctx?: RookieDraftContext,
): boolean {
  if (!pick.player_id) return false;
  if (isRookiePickPlaceholder(pick, ctx)) return false;
  const pos = (pick.metadata?.position ?? "").toUpperCase();
  return pos.length > 0;
}

export type DraftRookieMode = "direct_rookies" | "rookie_picks" | "mixed" | "unknown";

/**
 * Per-draft classification driven by the per-pick counts. A draft counts as
 *   - rookie_picks   when most signal comes from placeholder slots
 *   - direct_rookies when most signal comes from real rookie players
 *   - mixed          when both are meaningfully represented
 *   - unknown        when there isn't enough signal to tell
 */
export function classifyDraftRookieMode(
  picks: SleeperDraftPickRaw[],
  draftType: string,
): DraftRookieMode {
  if (draftType === "startup") return "direct_rookies";

  const ctx: RookieDraftContext = {
    kickersArePlaceholders: detectKickerPlaceholderDraft(picks, draftType),
  };

  let placeholders = 0;
  let actual = 0;
  for (const p of picks) {
    if (isRookiePickPlaceholder(p, ctx)) placeholders++;
    else if (isActualRookiePlayer(p, ctx)) actual++;
  }
  const total = placeholders + actual;
  if (total < 3) return "unknown";

  // Treat a side as meaningful when it accounts for at least 25% of the
  // classified picks. Real-world Sleeper rookie drafts are essentially all
  // one mode or the other, so this threshold is generous.
  const placeholderShare = placeholders / total;
  const actualShare = actual / total;

  if (placeholderShare >= 0.75) return "rookie_picks";
  if (actualShare >= 0.75) return "direct_rookies";
  if (placeholderShare >= 0.25 && actualShare >= 0.25) return "mixed";
  return placeholderShare > actualShare ? "rookie_picks" : "direct_rookies";
}

/**
 * Derive the NFL season a player entered the league. Prefer the per-pick
 * `metadata.years` Sleeper sometimes attaches (it's a string year like
 * "2026"); fall back to `draftSeason - playerDb[pid].years_exp`. Returns
 * null when neither signal is available — typical for placeholder picks or
 * when the player isn't in our cached DB yet.
 */
export function deriveRookieYear(
  pick: { player_id?: string | null; metadata?: { years?: string | number; [k: string]: any } },
  draftSeason: string | number | null | undefined,
  playersDb: Record<string, { years_exp?: number | null }> | null | undefined,
): number | null {
  // Per-pick override — Sleeper sometimes encodes the rookie class directly.
  const m = pick.metadata?.years;
  if (m != null) {
    const n = typeof m === "number" ? m : parseInt(String(m), 10);
    if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  }

  // Player-DB fallback. Requires both the draft season and a years_exp
  // record. We treat years_exp === 0 as "rookie in this draft's season".
  if (!pick.player_id || !playersDb) return null;
  const player = playersDb[pick.player_id];
  const exp = player?.years_exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp < 0) return null;

  const seasonNum = typeof draftSeason === "number"
    ? draftSeason
    : draftSeason ? parseInt(String(draftSeason), 10) : NaN;
  if (!Number.isFinite(seasonNum)) return null;
  return seasonNum - exp;
}

// ── Ingestion ────────────────────────────────────────────────────────────────

export async function ingestDraftById(
  draftId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; status: string; picks: number; reason?: string; skipped?: boolean }> {
  // ── Dedup gate ───────────────────────────────────────────────────────────
  // We skip three cases:
  //   (a) Already fully ingested: status=complete AND picks present AND the
  //       saved pick count matches what the draft metadata says we should
  //       have (teams * rounds, with a 60% slack for late picks).
  //   (b) Permanently excluded: excludedFromAdp=true (IDP draft, quality
  //       filter, real-kicker exclusion). The decision is deterministic from
  //       the Sleeper payload so re-fetching can't change the outcome.
  //
  // We do NOT skip:
  //   - status=complete with 0 picks (crash mid-insert)
  //   - status=complete with fewer picks than expected (partial insert)
  //   - any non-"complete" status (pre_draft, drafting, paused)
  //
  // These are eligible for re-ingestion. This is the primary defence against
  // the "drafts appear in DB but aren't usable" failure mode — the previous
  // dedup only required picksStored > 0, which let partial inserts through.
  if (!opts.force) {
    const existing = await db
      .select({
        status: drafts.status,
        teams: drafts.teams,
        rounds: drafts.rounds,
        excludedFromAdp: drafts.excludedFromAdp,
      })
      .from(drafts)
      .where(eq(drafts.draftId, draftId))
      .limit(1);
    if (existing.length > 0) {
      const row = existing[0];
      if (row.excludedFromAdp) {
        return { ok: true, status: row.status, picks: 0, skipped: true, reason: "previously excluded" };
      }
      if (row.status === "complete") {
        const pickCount = await db
          .select({ c: sql<number>`count(*)` })
          .from(draftPicks)
          .where(eq(draftPicks.draftId, draftId));
        const picksStored = Number(pickCount[0]?.c ?? 0);
        const expected = (row.teams ?? 0) * (row.rounds ?? 0);
        // Threshold matches the quality-filter "enoughPicks" rule below.
        const minAcceptable = expected > 0 ? Math.floor(expected * 0.6) : 1;
        if (picksStored > 0 && picksStored >= minAcceptable) {
          return { ok: true, status: "complete", picks: picksStored, skipped: true, reason: "already ingested" };
        }
        console.log(
          `[ADP ingestDraftById] ${draftId} previously incomplete (status=complete, ` +
          `picks=${picksStored}, expected≈${expected}). Re-ingesting.`,
        );
      }
    }
  }

  const draftRaw = await fetchJson<SleeperDraftRaw>(`${SLEEPER_API}/draft/${draftId}`);
  if (!draftRaw) return { ok: false, status: "missing", picks: 0, reason: "draft not found" };

  // Pull picks first so we can use their presence as a fallback signal when
  // Sleeper's status field is missing or non-canonical.
  const picksRaw = await fetchJson<SleeperDraftPickRaw[]>(`${SLEEPER_API}/draft/${draftId}/picks`);
  const hasPicks = Array.isArray(picksRaw) && picksRaw.some((p) => p.player_id);
  const completed = isCompletedStatus(draftRaw.status, hasPicks);

  // Pull league scoring once per draft. This is the only way to detect TE
  // Premium, and the most reliable source for rec / superflex / pass_td.
  const league = await fetchLeagueScoring(draftRaw.league_id);

  console.log(
    `[ADP ingestDraftById] ${draftId} status="${draftRaw.status}" picks=${picksRaw?.length ?? 0} ` +
    `completed=${completed} tep=${deriveTePremium(league)} rec=${league?.scoring_settings?.rec ?? "?"}`
  );

  // Per spec: only completed drafts go into ADP by default. We still record
  // their existence so the admin tools can see in-progress drafts. Marked
  // as not excluded — when the draft completes later, a rerun will re-ingest.
  if (!completed) {
    await upsertDraftRow(draftRaw, /* directlyDraftedRookies */ false, "unknown", completed, league, false, null);
    return { ok: true, status: draftRaw.status, picks: 0, reason: "not complete" };
  }

  if (!picksRaw) return { ok: false, status: draftRaw.status, picks: 0, reason: "picks not found" };

  // Defensive-player / IDP guard. If the draft contains *any* defensive
  // pick, mark it excluded and skip pick ingestion. Mixing IDP drafts with
  // standard QB/RB/WR/TE drafts corrupts the ADP curves (see the Jake
  // Golday "QB16" bug — defensive player misattributed to an offensive
  // position because they were in the same dataset).
  const playersDbForDetection = await getSleeperPlayers().catch(() => ({} as Record<string, any>));
  if (draftContainsDefensivePlayers(picksRaw, playersDbForDetection)) {
    await db.transaction(async (tx) => {
      await upsertDraftRowTx(
        tx,
        draftRaw,
        /* directlyDraftedRookies */ false,
        "unknown",
        completed,
        league,
        /* excludedFromAdp */ true,
        "contains_defensive_players",
      );
      await tx.delete(draftPicks).where(eq(draftPicks.draftId, draftId));
    });
    return {
      ok: true,
      status: draftRaw.status,
      picks: 0,
      reason: "excluded: contains defensive players",
    };
  }

  const teams = draftRaw.settings?.teams ?? 12;
  const rounds = draftRaw.settings?.rounds ?? Math.ceil(picksRaw.length / Math.max(teams, 1));

  // Classify the draft from its picks. The per-pick helpers handle the
  // kicker-as-placeholder case Sleeper sometimes uses. The shared draft
  // context is computed once and threaded into the per-pick map below so a
  // single draft-wide rule (e.g. "a team drafted two kickers") flips every
  // K pick in this draft to placeholder.
  const draftType = deriveDraftType(draftRaw);
  const draftCtx: RookieDraftContext = {
    kickersArePlaceholders: detectKickerPlaceholderDraft(picksRaw, draftType),
  };
  const rookieMode = classifyDraftRookieMode(picksRaw, draftType);
  // Back-compat boolean — keeps consumers reading the legacy column working
  // while we migrate them onto rookieMode.
  const directlyDraftedRookies =
    rookieMode === "direct_rookies" || (draftType === "startup");

  // Quality filters: drop obvious mock / micro-leagues. We mark these
  // `excludedFromAdp=true` with reason="quality_filter" so the dedup gate
  // recognises them as a permanent decision and skips them on rerun —
  // previously they were stored as plain status=complete with 0 picks,
  // which was indistinguishable from a crash and led to wasted re-fetches
  // on every crawl pass.
  const minTeams = 8;
  const minRounds = draftType === "startup" ? 8 : 3;
  const enoughPicks = picksRaw.filter((p) => p.player_id).length >= minTeams * minRounds * 0.6;
  if (teams < minTeams || rounds < minRounds || !enoughPicks) {
    await upsertDraftRow(
      draftRaw,
      directlyDraftedRookies,
      rookieMode,
      completed,
      league,
      /* excludedFromAdp */ true,
      "quality_filter",
    );
    return {
      ok: true,
      status: draftRaw.status,
      picks: 0,
      reason: `quality filter (teams=${teams} rounds=${rounds} picks=${picksRaw.length})`,
    };
  }

  // Pull the cached Sleeper player DB once so we can fall back to
  // years_exp when a pick's metadata doesn't carry the rookie year. We
  // tolerate failure here — rookieYear stays null on a miss, which is
  // strictly better than failing the ingest.
  const playersDb = await getSleeperPlayers().catch(() => ({} as Record<string, any>));

  const rows = picksRaw.map((p) => {
    const pickInRound = ((p.pick_no - 1) % Math.max(teams, 1)) + 1;
    // New: placeholder detection covers null player_id AND the kicker-as-
    // placeholder case Sleeper uses on some league formats.
    const isPlaceholder = draftType !== "startup" && isRookiePickPlaceholder(p, draftCtx);
    const isRookie = draftType !== "startup" && isActualRookiePlayer(p, draftCtx);
    const rookieYear = isPlaceholder ? null : deriveRookieYear(p, draftRaw.season, playersDb);
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
      rookieYear,
    };
  });

  // ── Atomic persistence ──────────────────────────────────────────────────
  // All three writes (delete existing picks, insert new picks, upsert the
  // draft row with status=complete) happen inside a single Postgres
  // transaction. If any step throws — or the process dies before COMMIT —
  // Postgres rolls back automatically, leaving the previous state intact.
  //
  // The draft row is upserted LAST so status=complete is never visible
  // without its picks. Combined with the strengthened dedup gate above,
  // this guarantees that a partial ingest is invisible to subsequent reruns
  // (the row either doesn't exist, or has an earlier status that lets the
  // rerun re-fetch).
  const BATCH = 500;
  await db.transaction(async (tx) => {
    await tx.delete(draftPicks).where(eq(draftPicks.draftId, draftId));
    for (let i = 0; i < rows.length; i += BATCH) {
      await tx.insert(draftPicks).values(rows.slice(i, i + BATCH));
    }
    await upsertDraftRowTx(tx, draftRaw, directlyDraftedRookies, rookieMode, completed, league, false, null);
  });

  return { ok: true, status: draftRaw.status, picks: rows.length };
}

/**
 * Transaction-scoped version of `upsertDraftRow`. The normal flow inside
 * `ingestDraftById` calls this with the same `tx` used to write picks, so a
 * mid-write crash rolls back the entire ingest (status, picks, exclusion
 * flags) as a unit. Standalone callers can use `upsertDraftRow` below — it
 * forwards to this one with a fresh implicit txn.
 */
async function upsertDraftRowTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  draftRaw: SleeperDraftRaw,
  directlyDraftedRookies: boolean,
  rookieMode: DraftRookieMode,
  completed: boolean,
  league: SleeperLeagueScoring | null,
  excludedFromAdp: boolean,
  exclusionReason: string | null,
) {
  const values = buildDraftRowValues(
    draftRaw, directlyDraftedRookies, rookieMode, completed, league,
    excludedFromAdp, exclusionReason,
  );
  await tx
    .insert(drafts)
    .values(values)
    .onConflictDoUpdate({
      target: drafts.draftId,
      set: values,
    });
}

async function upsertDraftRow(
  draftRaw: SleeperDraftRaw,
  directlyDraftedRookies: boolean,
  rookieMode: DraftRookieMode,
  completed: boolean,
  league: SleeperLeagueScoring | null,
  excludedFromAdp: boolean,
  exclusionReason: string | null,
) {
  const values = buildDraftRowValues(
    draftRaw, directlyDraftedRookies, rookieMode, completed, league,
    excludedFromAdp, exclusionReason,
  );
  await db
    .insert(drafts)
    .values(values)
    .onConflictDoUpdate({
      target: drafts.draftId,
      set: values,
    });
}

function buildDraftRowValues(
  draftRaw: SleeperDraftRaw,
  directlyDraftedRookies: boolean,
  rookieMode: DraftRookieMode,
  completed: boolean,
  league: SleeperLeagueScoring | null,
  excludedFromAdp: boolean,
  exclusionReason: string | null,
) {
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
    scoringType: deriveScoringType(draftRaw, league),
    leagueMode: deriveLeagueMode(league),
    superflex: deriveSuperflex(draftRaw, league),
    tePremium: deriveTePremium(league),
    bestBall: (draftRaw.settings?.best_ball ?? 0) === 1,
    passTd: derivePassTd(draftRaw, league),
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
    rookieMode,
    excludedFromAdp,
    exclusionReason,
    ingestedAt: new Date(),
  };

  return values;
}

/**
 * Walk every league we've already stored a draft for, fetch each league's
 * scoring once, and update its drafts' tePremium / scoringType / superflex /
 * passTd flags in place. Avoids re-fetching draft payloads or picks — useful
 * after adding a new league-derived field.
 */
export async function backfillLeagueScoring(): Promise<{ leagues: number; drafts: number; tePremium: number }> {
  const distinct = await db
    .selectDistinct({ leagueId: drafts.leagueId })
    .from(drafts);

  const leagueIds = distinct
    .map((d) => d.leagueId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  let updated = 0;
  let tepCount = 0;

  for (const leagueId of leagueIds) {
    const league = await fetchLeagueScoring(leagueId);
    if (!league) continue;

    // Read each draft once so we can use deriveScoringType / deriveSuperflex
    // which want the raw SleeperDraftRaw — but for the backfill we only need
    // the league-derived flags, so we synthesize a minimal stand-in.
    const fakeDraft = { settings: {}, type: "snake", season: "" } as unknown as SleeperDraftRaw;
    const tep = deriveTePremium(league);
    const sf = deriveSuperflex(fakeDraft, league);
    const scoring = deriveScoringType(fakeDraft, league);
    const passTd = derivePassTd(fakeDraft, league);

    await db
      .update(drafts)
      .set({ tePremium: tep, superflex: sf, scoringType: scoring, passTd })
      .where(eq(drafts.leagueId, leagueId));

    updated++;
    if (tep) tepCount++;
  }

  console.log(`[ADP backfillLeagueScoring] leagues=${leagueIds.length} updated=${updated} tep=${tepCount}`);
  return { leagues: leagueIds.length, drafts: updated, tePremium: tepCount };
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

// Bump when the ADP computation rules change in a way that should
// invalidate every cached snapshot. Each bump appends a `_v<N>` suffix to
// every filter key so old cache rows can never match new reads.
//   v2 — exclude whole drafts that contain any K pick from Direct Rookies
//        (was: drop individual K picks only).
//   v3 — partition snapshots by `season` so 2026 picks never blend with
//        prior years. (Pre-v3 cached entries blend all seasons and are
//        unsafe to serve.)
//   v4 — fix IDP false-positive: hybrid offense/defense players
//        (Travis Hunter et al.) no longer flag their entire draft as IDP.
//        Pre-v4 snapshots were computed from a dataset where ~595 startup
//        drafts were wrongly excluded.
//   v5 — Direct Rookies excludes kickers across all draft types (not just
//        rookie drafts). Pre-v5 snapshots for draftType=all/supplemental
//        under rookieMode=direct could still contain K rows.
const FILTER_KEY_VERSION = "v9";

/** Normalize the season filter into a comma-joined sorted list, "all", or
 *  the inferred current season. Centralised so filterKey and the WHERE
 *  builder always agree on the same string. */
function normalizeSeasonFilter(f: AdpFilters): string {
  const s = f.season;
  if (s === "all") return "all";
  if (Array.isArray(s)) {
    const cleaned = s.map((x) => String(x).trim()).filter(Boolean);
    if (cleaned.length === 0) return String(new Date().getFullYear());
    return cleaned.sort().join(",");
  }
  if (typeof s === "string" && s.trim()) return s.trim();
  return String(new Date().getFullYear());
}

function filterKey(f: AdpFilters): string {
  // Deterministic key for cache lookups. Keep keys human-readable so logs
  // are usable.
  const k = {
    se: normalizeSeasonFilter(f),
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
    _ver: FILTER_KEY_VERSION,
  };
  return Object.entries(k).map(([key, val]) => `${key}=${val}`).join("|");
}

/** Corpus-wide ADP totals for the explorer banner.
 *   - totalPicks: every real pick ingested (draft_picks rows).
 *   - dynastyDraftsScanned: completed dynasty drafts in the corpus.
 *  Two cheap counts; result is cached at the route layer. */
export async function getAdpStats(): Promise<{ totalPicks: number; dynastyDraftsScanned: number }> {
  const [picks, dynDrafts] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(draftPicks),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(drafts)
      .where(and(eq(drafts.status, "complete"), eq(drafts.leagueMode, "dynasty"))),
  ]);
  return {
    totalPicks: picks[0]?.n ?? 0,
    dynastyDraftsScanned: dynDrafts[0]?.n ?? 0,
  };
}

export function buildDraftWhere(f: AdpFilters) {
  // Always exclude drafts flagged excludedFromAdp. This is the IDP/defensive-
  // player guardrail — those drafts have their own ADP curves and shouldn't
  // be mixed with the standard QB/RB/WR/TE dataset.
  //
  // Also require the draft to have at least one recorded pick. Sleeper drafts
  // that were started but abandoned are still stored with status='complete'
  // and zero pick rows (ingestDraftById records their existence for admin
  // tooling). They carry no ADP signal, but because they pass the status
  // filter they silently inflate every draft *count* — e.g. a 1.01 asset
  // reading as drafted in only 398/568 leagues when 167 of those had no picks
  // at all. Excluding them here fixes draftCount in computeAdp and the
  // "seen in X / Y drafts" denominators across the player profile in one place.
  const conds: any[] = [
    eq(drafts.status, "complete"),
    eq(drafts.excludedFromAdp, false),
    sql`EXISTS (SELECT 1 FROM ${draftPicks} WHERE ${draftPicks.draftId} = ${drafts.draftId})`,
  ];

  // Startup data-quality gate. A genuine dynasty startup always rosters the
  // perennial elite, so some drafts labelled "startup" that lack them are not
  // real startups: keeper/continuation drafts (top players already rostered)
  // or niche/devy formats. They have full pick data but anomalous order (e.g.
  // Jayden Reed at 1.01, Chase undrafted) that pollutes startup ADP and skews
  // "seen in X / Y drafts". Require both anchor studs to be present.
  //
  // Scoped to draftType === "startup" ONLY. Rookie/supplemental drafts never
  // contain veterans, so applying this anywhere else would wipe them out (it
  // would drop ~100% of rookie drafts). For the same reason it is intentionally
  // skipped for the mixed "all" view.
  //
  // MAINTENANCE: these are era-specific Sleeper player IDs, so the gate is
  // bounded to the window where they are consensus every-draft picks. Chase
  // entered the NFL in 2021 (so the rule starts with Jan 2022 startups), and
  // the upper bound (Feb 2027) makes the gate auto-expire instead of silently
  // dropping legit startups once these players may age out. Drafts outside the
  // window — or with no recorded date — are kept regardless of the anchors.
  const STARTUP_ANCHOR_IDS = ["7564" /* Ja'Marr Chase */, "5859" /* A.J. Brown */];
  const ANCHOR_WINDOW_START = "2022-01-01"; // inclusive
  const ANCHOR_WINDOW_END = "2027-03-01";   // exclusive (covers through Feb 2027)
  if (f.draftType === "startup") {
    const anchorExists = STARTUP_ANCHOR_IDS.map(
      (pid) => sql`EXISTS (SELECT 1 FROM ${draftPicks} WHERE ${draftPicks.draftId} = ${drafts.draftId} AND ${draftPicks.playerId} = ${pid})`,
    );
    conds.push(sql`(
      ${drafts.draftDate} IS NULL
      OR ${drafts.draftDate} < ${ANCHOR_WINDOW_START}::timestamp
      OR ${drafts.draftDate} >= ${ANCHOR_WINDOW_END}::timestamp
      OR (${sql.join(anchorExists, sql` AND `)})
    )`);
  }

  // Season filter. Default = current calendar year. Pass `season: "all"` to
  // disable the filter (admin tooling only — public reads should always be
  // season-scoped so 2026 picks don't blend into 2025 averages).
  const seasonNormalized = normalizeSeasonFilter(f);
  if (seasonNormalized !== "all") {
    const seasons = seasonNormalized.split(",").filter(Boolean);
    if (seasons.length === 1) conds.push(eq(drafts.season, seasons[0]));
    else if (seasons.length > 1) conds.push(inArray(drafts.season, seasons));
  }

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

  // Rookie-mode filter at the draft level.
  //
  // Rookie tab (draftType === "rookie") — long-standing behavior:
  //   - direct : restrict to rookie drafts whose classifier labelled them
  //              direct_rookies or mixed.
  //   - picks  : strict rule — EXISTS a placeholder pick AND NOT EXISTS
  //              any years_exp=0 player at draft time.
  //
  // Startup tab (draftType === "startup") — new branch:
  //   - picks  : Sleeper occasionally labels future-pick drafts as
  //              "startup" when commissioners use a real kicker as a
  //              placeholder. detectKickerPlaceholderDraft short-circuits
  //              to false for startups (server/adp.ts:457), so those
  //              drafts never get is_rookie_placeholder=true at ingest and
  //              the rookie-tab rule above misses them. This branch picks
  //              them up by reading the raw signals directly: a K-position
  //              pick must exist AND no years_exp=0 player may have been
  //              selected. The remaining rookieMode values ("direct",
  //              "both") fall through with no draft-level constraint.
  if (f.draftType === "rookie") {
    if (f.rookieMode === "direct") {
      conds.push(inArray(drafts.rookieMode, ["direct_rookies", "mixed"]));
    } else if (f.rookieMode === "picks") {
      conds.push(sql`EXISTS (
        SELECT 1 FROM ${draftPicks}
        WHERE ${draftPicks.draftId} = ${drafts.draftId}
          AND ${draftPicks.isRookiePlaceholder} = TRUE
      )`);
      conds.push(sql`NOT EXISTS (
        SELECT 1 FROM ${draftPicks}
        WHERE ${draftPicks.draftId} = ${drafts.draftId}
          AND ${draftPicks.rookieYear} = CAST(${drafts.season} AS integer)
      )`);
    }
    // "both" or undefined → no draft-level filter, all rookie drafts.
  } else if (f.draftType === "startup" && f.rookieMode === "picks") {
    conds.push(sql`EXISTS (
      SELECT 1 FROM ${draftPicks}
      WHERE ${draftPicks.draftId} = ${drafts.draftId}
        AND upper(${draftPicks.position}) = 'K'
    )`);
    conds.push(sql`NOT EXISTS (
      SELECT 1 FROM ${draftPicks}
      WHERE ${draftPicks.draftId} = ${drafts.draftId}
        AND ${draftPicks.rookieYear} = CAST(${drafts.season} AS integer)
    )`);
  }

  // ── Kicker-draft exclusion (Direct Rookies only) ────────────────────────
  // Per product rule: Direct Rookies should never include kicker rows. Real
  // rookie kickers are essentially never taken in dynasty rookie drafts, so
  // a K presence under "direct" signals either a placeholder-as-kicker
  // convention OR a league that drafts a kicker as a roster slot — both
  // pollute the curves we want to surface as "actual rookie draft order."
  //
  // We apply this at the draft level via NOT EXISTS rather than at the
  // pick level: removing K picks individually still leaves the rest of a
  // kicker-using draft in the dataset, which is exactly what the user is
  // complaining about. Whole-draft exclusion is the right tool.
  //
  // Applies whenever rookieMode === "direct", regardless of draftType, so
  // mixed (draftType=all) and rookie-only views are equally clean. Skipped
  // for "picks" and "both" so the Rookie Picks view (K-as-placeholder) and
  // the unfiltered "both" view aren't disturbed.
  if (f.rookieMode === "direct") {
    conds.push(sql`NOT EXISTS (
      SELECT 1 FROM ${draftPicks}
      WHERE ${draftPicks.draftId} = ${drafts.draftId}
        AND upper(${draftPicks.position}) = 'K'
    )`);
  }

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
  //   direct → exclude placeholder picks (show only real rookie players)
  //   picks  → include only placeholder picks
  //   both   → include everything
  //
  // Startup-tab "picks" expansion: ingest skips the kicker-as-placeholder
  // flag for startup-labelled drafts (see detectKickerPlaceholderDraft), so
  // K rows in those drafts have is_rookie_placeholder=false. The draft-level
  // filter in buildDraftWhere has already narrowed us to startups whose K
  // picks are functionally placeholders — include the K rows here so they
  // actually aggregate.
  const rookieMode = f.rookieMode ?? "direct";
  const placeholderCond =
    rookieMode === "picks"
      ? (f.draftType === "startup"
          ? sql`(${draftPicks.isRookiePlaceholder} = TRUE OR upper(${draftPicks.position}) = 'K')`
          : eq(draftPicks.isRookiePlaceholder, true))
    : rookieMode === "both" ? sql`true`
    : eq(draftPicks.isRookiePlaceholder, false);

  // Belt-and-braces pick-level K drop for Direct Rookies. The draft-level
  // NOT EXISTS in buildDraftWhere is the primary defense, but if any stray
  // K pick survives (e.g. a draft that was K-free at ingest but later had
  // a K added) this guarantees Direct Rookies never renders a kicker row.
  const dropKickers = rookieMode === "direct";
  const kickerCond = dropKickers
    ? sql`(${draftPicks.position} IS NULL OR upper(${draftPicks.position}) <> 'K')`
    : sql`true`;

  // Rookie-tab strict rookie filter. The draft-level rookieMode classifier
  // accepts "direct_rookies" and "mixed" drafts, but mixed drafts still
  // contain veteran picks — orphan / replacement drafts where a manager
  // refills a roster slot show real veterans (Najee Harris, Calvin Ridley)
  // alongside the actual rookies. For Direct Rookies on the Rookie tab the
  // user expects rookies only, so gate picks on rookieYear matching the
  // draft's season. Picks with NULL rookieYear are excluded — without an
  // ingest-time rookie-class signal we can't prove they're rookies, and
  // letting them through is exactly the leak we're closing.
  const rookieYearCond =
    rookieMode === "direct" && f.draftType === "rookie"
      ? sql`EXISTS (
          SELECT 1 FROM ${drafts}
          WHERE ${drafts.draftId} = ${draftPicks.draftId}
            AND ${draftPicks.rookieYear} IS NOT NULL
            AND ${draftPicks.rookieYear} = CAST(${drafts.season} AS integer)
        )`
      : sql`true`;

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
    .where(and(
      inArray(draftPicks.draftId, draftIds),
      placeholderCond,
      kickerCond,
      rookieYearCond,
      // Belt-and-braces allowlist at the pick level. Whole-draft exclusion is
      // the primary defense (see buildDraftWhere), but if a stray defensive
      // pick ever slipped past detection we still don't want it showing up
      // under "QB16". Allowed: QB/RB/WR/TE, plus K (handled separately by
      // kickerCond) and PICK placeholders.
      sql`(${draftPicks.position} IS NULL OR upper(${draftPicks.position}) IN ('QB','RB','WR','TE','K','PICK'))`,
    ));

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
  // A window needs at least this many observed picks before its mean is trusted
  // to define a trend. Below it, a single stray draft could masquerade as a
  // "mover", so we report no movement instead. Tune down (→2) on sparse slices
  // if the movers panel comes up empty.
  const MIN_TREND_PICKS = 3;

  // Nearest-rank percentile (no interpolation) — keeps values aligned to a
  // real observed pick. q in [0,1].
  const percentile = (sortedArr: number[], q: number): number => {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.ceil(q * sortedArr.length) - 1));
    return sortedArr[idx];
  };

  // Drop absurd late-pick outliers (junk/devy/abnormal drafts) before computing
  // range + percentiles, so a consensus 1.01 isn't reported as "max pick 359".
  // Generous fence (4× median, floor 36) leaves genuine ranges intact.
  const trimOutliers = (sortedArr: number[]): number[] => {
    if (sortedArr.length < 4) return sortedArr;
    const med = sortedArr[Math.floor(sortedArr.length / 2)];
    const upper = Math.max(med * 4, 36);
    const kept = sortedArr.filter((p) => p <= upper);
    return kept.length ? kept : sortedArr;
  };

  const rows: AdpRow[] = Array.from(agg.values()).map((a) => {
    const sorted = trimOutliers([...a.picks].sort((x, y) => x - y));
    const sum = sorted.reduce((s, v) => s + v, 0);
    const avg = sum / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p10 = percentile(sorted, 0.10);
    const p90 = percentile(sorted, 0.90);

    // Trend = recent window mean − prior (non-overlapping) window mean. Negative
    // means the player is going earlier than before (riser); positive means
    // slipping later (faller). Windows must not overlap, or the delta is diluted
    // by shared picks. The prior window is wider than the recent one so it forms
    // a stable baseline: 7d vs the 30 days before it (days 8–37), 14d vs the 30
    // days before it (days 15–44), 30d vs the 60 days before it (days 31–90).
    // Means (not sums) are compared, so the unequal window lengths are fine.
    const last7 = a.timed.filter((x) => now - x.t <= 7 * DAY).map((x) => x.p);
    const prev7 = a.timed.filter((x) => now - x.t > 7 * DAY && now - x.t <= 37 * DAY).map((x) => x.p);
    const last14 = a.timed.filter((x) => now - x.t <= 14 * DAY).map((x) => x.p);
    const prev14 = a.timed.filter((x) => now - x.t > 14 * DAY && now - x.t <= 44 * DAY).map((x) => x.p);
    const last30 = a.timed.filter((x) => now - x.t <= 30 * DAY).map((x) => x.p);
    const prior30 = a.timed.filter((x) => now - x.t > 30 * DAY && now - x.t <= 90 * DAY).map((x) => x.p);

    // Mean of a window only once it clears MIN_TREND_PICKS, else null — no
    // fallback to the all-time average, which used to fabricate a delta whenever
    // one side of the comparison was empty.
    const meanIf = (arr: number[]) =>
      arr.length >= MIN_TREND_PICKS ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    // Only a trend when BOTH windows have enough data; otherwise 0 (no movement),
    // which the movers panel filters out.
    const trendBetween = (recent: number[], prior: number[]) => {
      const r = meanIf(recent);
      const p = meanIf(prior);
      return r != null && p != null ? Math.round(r - p) : 0;
    };

    const trend7 = trendBetween(last7, prev7);
    const trend14 = trendBetween(last14, prev14);
    const trend30 = trendBetween(last30, prior30);

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
      p10_pick: p10,
      p90_pick: p90,
      draft_count: sorted.length,
      positional_rank: 0,
      overall_rank: 0,
      trend_7d: trend7,
      trend_14d: trend14,
      trend_30d: trend30,
      sample_size_warning: sorted.length < 8,
    };
  });

  // Drop very-small-sample players so someone drafted in just 1–2 of N drafts
  // doesn't get a misleadingly high rank beside full-sample players. Scaled to
  // the slice (≥5% of its drafts, floor 3), and only applied once the slice is
  // big enough to judge. Rookie-pick placeholders are exempt.
  const totalDrafts = eligibleDrafts.length;
  const minSample = totalDrafts >= 10 ? Math.max(3, Math.ceil(totalDrafts * 0.05)) : 1;
  const ranked = rows.filter((r) => r.is_rookie_placeholder || r.draft_count >= minSample);

  ranked.sort((a, b) => a.avg_pick - b.avg_pick);
  const posCounters: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, PICK: 0 };
  ranked.forEach((r, idx) => {
    r.overall_rank = idx + 1;
    posCounters[r.position] = (posCounters[r.position] ?? 0) + 1;
    r.positional_rank = posCounters[r.position];
  });

  return { rows: ranked, draftCount: totalDrafts, pickCount: picks.length };
}

// ── Reclassify already-ingested drafts ────────────────────────────────────
// Walks the stored draft_picks, recomputes per-pick isRookiePlaceholder
// using the new helpers, and recomputes per-draft rookieMode. Doesn't touch
// Sleeper — works entirely off the columns we already persisted.

/** Stored-column version of `isRookiePickPlaceholder`. Same logic, but reads
 *  from the normalized fields the ingester wrote into draft_picks. Accepts an
 *  optional draft context so the "team drafted kickers as placeholders" rule
 *  can override the per-pick name check. */
function isPlaceholderFromStoredPick(
  p: {
    playerId: string | null;
    playerName: string | null;
    position: string | null;
  },
  ctx?: RookieDraftContext,
): boolean {
  // Already encoded as a synthetic placeholder id by ingestion → trust it.
  if (p.playerId && p.playerId.startsWith("rookie_pick_")) return true;
  // Nulls are the canonical Sleeper-side placeholder shape.
  if (!p.playerId) return true;

  const pos = (p.position ?? "").toUpperCase();
  if (pos !== "K") return false;

  if (ctx?.kickersArePlaceholders) return true;

  const name = (p.playerName ?? "").trim();
  if (!name) return false;
  return ROOKIE_PICK_NAME_PATTERNS.some((re) => re.test(name));
}

/** Stored-column version of `detectKickerPlaceholderDraft`. Same rules
 *  (>=4 kickers AND >=10% share, OR any team with 2+ kickers) but reading
 *  from the persisted draft_picks rows. */
function detectKickerPlaceholderFromStored(
  picks: Array<{ playerId: string | null; position: string | null; rosterId: number | null }>,
  draftType: string,
): boolean {
  if (draftType === "startup") return false;

  const kickers = picks.filter((p) =>
    p.playerId &&
    !p.playerId.startsWith("rookie_pick_") &&
    (p.position ?? "").toUpperCase() === "K",
  );
  if (kickers.length < 3) return false;

  const totalReal = picks.filter((p) => p.playerId && !p.playerId.startsWith("rookie_pick_")).length;
  if (totalReal === 0) return false;

  if (kickers.length / totalReal >= 0.10 && kickers.length >= 4) return true;

  const byRoster = new Map<number, number>();
  for (const k of kickers) {
    if (k.rosterId == null) continue;
    byRoster.set(k.rosterId, (byRoster.get(k.rosterId) ?? 0) + 1);
  }
  for (const c of Array.from(byRoster.values())) {
    if (c >= 2) return true;
  }
  return false;
}

export async function reclassifyAdpDrafts(): Promise<{
  drafts: number;
  picksReclassified: number;
  rookieYearsBackfilled: number;
  byMode: Record<DraftRookieMode, number>;
  excludedIdp: number;
  excludedReal: number;
  includedAfter: number;
}> {
  const allDrafts = await db
    .select({ draftId: drafts.draftId, draftType: drafts.draftType, season: drafts.season })
    .from(drafts);

  // Cached Sleeper player DB — needed for the years_exp → rookieYear
  // fallback AND for defensive-position detection on stored picks. One
  // read covers every draft.
  const playersDb: Record<string, { years_exp?: number | null; position?: string | null; fantasy_positions?: string[] | null }> =
    await getSleeperPlayers().catch(() => ({} as Record<string, any>));

  let picksReclassified = 0;
  let rookieYearsBackfilled = 0;
  let excludedIdp = 0;
  let excludedReal = 0;
  let includedAfter = 0;
  const byMode: Record<DraftRookieMode, number> = {
    direct_rookies: 0, rookie_picks: 0, mixed: 0, unknown: 0,
  };

  for (const d of allDrafts) {
    const stored = await db
      .select({
        id: draftPicks.id,
        round: draftPicks.round,
        pickInRound: draftPicks.pickInRound,
        rosterId: draftPicks.rosterId,
        playerId: draftPicks.playerId,
        playerName: draftPicks.playerName,
        position: draftPicks.position,
        isRookiePlaceholder: draftPicks.isRookiePlaceholder,
        isRookie: draftPicks.isRookie,
        rookieYear: draftPicks.rookieYear,
      })
      .from(draftPicks)
      .where(eq(draftPicks.draftId, d.draftId));

    // IDP / defensive-player guard — applied first so we can short-circuit
    // the rest of the per-draft classification work for excluded drafts.
    const hasDefensive = stored.some((p) => isDefensiveFromStored(p, playersDb));
    if (hasDefensive) {
      await db
        .update(drafts)
        .set({ excludedFromAdp: true, exclusionReason: "contains_defensive_players" })
        .where(eq(drafts.draftId, d.draftId));
      excludedIdp++;
      continue;
    }

    const draftCtx: RookieDraftContext = {
      kickersArePlaceholders: detectKickerPlaceholderFromStored(stored, d.draftType),
    };

    let placeholderCount = 0;
    let actualCount = 0;
    const updates: Array<{
      id: number;
      isRookiePlaceholder: boolean;
      isRookie: boolean;
      rookieYear: number | null;
    }> = [];

    for (const p of stored) {
      const isPlaceholder = d.draftType !== "startup" && isPlaceholderFromStoredPick(p, draftCtx);
      const isReal = d.draftType !== "startup" && !isPlaceholder && !!p.playerId && (p.position ?? "").length > 0;

      // Derive rookieYear from the cached player DB. We can't access the
      // original Sleeper pick metadata.years at this stage — the ingester
      // dropped it. Real picks fall back to draftSeason - years_exp;
      // placeholders stay null.
      const newRookieYear = isPlaceholder
        ? null
        : deriveRookieYear({ player_id: p.playerId, metadata: {} }, d.season, playersDb);

      if (
        isPlaceholder !== p.isRookiePlaceholder ||
        isReal !== p.isRookie ||
        newRookieYear !== p.rookieYear
      ) {
        updates.push({
          id: p.id,
          isRookiePlaceholder: isPlaceholder,
          isRookie: isReal,
          rookieYear: newRookieYear,
        });
      }
      if (newRookieYear !== p.rookieYear) rookieYearsBackfilled++;
      if (isPlaceholder) placeholderCount++;
      else if (isReal) actualCount++;
    }

    // Apply pick-level updates.
    for (const u of updates) {
      await db
        .update(draftPicks)
        .set({
          isRookiePlaceholder: u.isRookiePlaceholder,
          isRookie: u.isRookie,
          rookieYear: u.rookieYear,
        })
        .where(eq(draftPicks.id, u.id));
    }
    picksReclassified += updates.length;

    // Compute draft-level rookieMode from the fresh counts.
    let newMode: DraftRookieMode;
    if (d.draftType === "startup") {
      newMode = "direct_rookies";
    } else {
      const total = placeholderCount + actualCount;
      if (total < 3) newMode = "unknown";
      else {
        const placeholderShare = placeholderCount / total;
        const actualShare = actualCount / total;
        if (placeholderShare >= 0.75) newMode = "rookie_picks";
        else if (actualShare >= 0.75) newMode = "direct_rookies";
        else if (placeholderShare >= 0.25 && actualShare >= 0.25) newMode = "mixed";
        else newMode = placeholderShare > actualShare ? "rookie_picks" : "direct_rookies";
      }
    }
    byMode[newMode]++;

    // Real-kicker guard: a rookie draft with a non-trivial number of real
    // kicker selections that aren't placeholders signals this is a "draft
    // your kicker" league, not a pure rookie ADP source. Flag the draft as
    // excluded so its picks don't pollute Direct Rookies.
    const realKickerCount = stored.filter((p) => {
      const pos = (p.position ?? "").toUpperCase();
      if (pos !== "K") return false;
      if (!p.playerId) return false;
      if (p.playerId.startsWith("rookie_pick_")) return false;
      return !isPlaceholderFromStoredPick(p, draftCtx);
    }).length;

    const realKickerExclusion =
      d.draftType !== "startup" && realKickerCount >= 1 && !draftCtx.kickersArePlaceholders;

    if (realKickerExclusion) {
      await db
        .update(drafts)
        .set({
          rookieMode: newMode,
          directlyDraftedRookies: newMode === "direct_rookies" || d.draftType === "startup",
          excludedFromAdp: true,
          exclusionReason: "contains_real_kickers",
        })
        .where(eq(drafts.draftId, d.draftId));
      excludedReal++;
    } else {
      await db
        .update(drafts)
        .set({
          rookieMode: newMode,
          directlyDraftedRookies: newMode === "direct_rookies" || d.draftType === "startup",
          excludedFromAdp: false,
          exclusionReason: null,
        })
        .where(eq(drafts.draftId, d.draftId));
      includedAfter++;
    }
  }

  // Existing snapshots reflect the OLD classification. Clear them so callers
  // get a fresh aggregation on the next read.
  await db.delete(adpSnapshots);

  return {
    drafts: allDrafts.length,
    picksReclassified,
    rookieYearsBackfilled,
    byMode,
    excludedIdp,
    excludedReal,
    includedAfter,
  };
}

// ── Admin status / debug counts ─────────────────────────────────────────────
// Surfaces totals + exclusion reasons so the ADP admin UI can show
// "X drafts ingested / Y included / Z excluded (IDP / kickers / other)".

export async function getAdpInclusionStatus(): Promise<{
  total: number;
  included: number;
  excluded: number;
  byReason: Record<string, number>;
}> {
  const all = await db
    .select({
      excluded: drafts.excludedFromAdp,
      reason: drafts.exclusionReason,
    })
    .from(drafts)
    .where(eq(drafts.status, "complete"));

  let included = 0;
  let excluded = 0;
  const byReason: Record<string, number> = {};
  for (const r of all) {
    if (r.excluded) {
      excluded++;
      const k = r.reason ?? "unknown";
      byReason[k] = (byReason[k] ?? 0) + 1;
    } else {
      included++;
    }
  }
  return { total: all.length, included, excluded, byReason };
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

// Snapshots with a date-range filter use a short TTL because the underlying
// data changes as new drafts are ingested (the window slides daily and
// crawl jobs add picks inside that range). Without this, the first load
// after a crawl still returns the old cached result.
// Snapshots without date filters are managed by the 6-hour scheduler.
const SNAPSHOT_DATE_RANGE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Single-flight guard for live ADP computes ────────────────────────────────
// computeAdp() is a heavy aggregation (multiple seconds, sometimes 20s+ on a
// cold filter). The frontend loads /api/adp for the same default filter on
// every visit, so on a cache miss DOZENS of identical requests would each kick
// off their OWN compute, each pinning a DB connection for the full duration —
// which exhausted the connection pool and 500'd auth (the recurring
// "spinner / Login failed" outage, second offender after the trade ingest).
// Collapsing concurrent identical computes onto one shared promise means N
// simultaneous misses cost ONE compute and ONE connection instead of N.
const inFlightAdpComputes = new Map<string, Promise<{ rows: AdpRow[]; draftCount: number; pickCount: number }>>();

// Compute ADP for `f`, de-duplicating concurrent identical computes and
// persisting the result as a snapshot so the NEXT read is a cheap cache hit
// instead of yet another full recompute.
async function computeAndCacheAdp(
  f: AdpFilters,
  key: string,
): Promise<{ rows: AdpRow[]; draftCount: number; pickCount: number }> {
  const existing = inFlightAdpComputes.get(key);
  if (existing) return existing;

  const work = (async () => {
    const fresh = await computeAdp(f);
    // Persist so subsequent requests for this filter hit getCachedAdp(). Date-
    // range snapshots self-expire via SNAPSHOT_DATE_RANGE_TTL_MS; default-combo
    // snapshots are refreshed by the scheduler. Best-effort — a write failure
    // must not fail the read the user is waiting on.
    //
    // Skip empty results: getAdp() only treats a snapshot as a hit when it has
    // rows (an empty snapshot means "no data yet", not a valid cache), so
    // persisting 0 rows would never serve a hit and would just accumulate
    // duplicate empty snapshots on every call. An empty compute is also cheap.
    if (fresh.rows.length > 0) {
      try {
        await db.insert(adpSnapshots).values({
          filterKey: key,
          filters: f as any,
          rows: fresh.rows as any,
          draftCount: fresh.draftCount,
          snapshotDate: todayStr(),
          computedAt: new Date(),
        });
      } catch (err) {
        console.warn(`[ADP getAdp] snapshot persist failed (key=${key}):`, (err as Error).message);
      }
    }
    return fresh;
  })().finally(() => inFlightAdpComputes.delete(key));

  inFlightAdpComputes.set(key, work);
  return work;
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

  // Stale-cache guard 1: under the new Direct-Rookies rule, kicker rows must
  // never appear. If an older snapshot still has a K row, treat it as
  // stale and recompute fresh. Skipped for "picks" mode where K-as-
  // placeholder rows are legitimate.
  const cacheHasForbiddenKickers =
    cached &&
    f.rookieMode === "direct" &&
    cached.rows.some((r) => r.position === "K");

  // Stale-cache guard 2: date-range filtered snapshots expire after 1 hour.
  // Without this, ingesting new drafts has no effect on the displayed data
  // until the snapshot is manually regenerated — the old cached result keeps
  // being served indefinitely.
  const hasDateFilter = !!(f.startDate || f.endDate);
  const cacheExpired =
    hasDateFilter &&
    cached !== null &&
    Date.now() - new Date(cached.computedAt).getTime() > SNAPSHOT_DATE_RANGE_TTL_MS;

  if (cached && cached.rows.length > 0 && !cacheHasForbiddenKickers && !cacheExpired) {
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
  if (cacheHasForbiddenKickers) {
    console.warn(
      `[ADP getAdp] stale snapshot dropped — contained K rows under ` +
      `Direct Rookies (key=${key}). Recomputing.`,
    );
  }
  if (cacheExpired) {
    console.info(
      `[ADP getAdp] date-range snapshot expired (>1h old, key=${key}). Recomputing from DB.`,
    );
  }
  const fresh = await computeAndCacheAdp(f, key);
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

const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

export function startAdpScheduler() {
  // Don't block server startup — kick the first refresh off-thread.
  // Backfill league-derived flags first so the snapshot refresh sees correct
  // tePremium / scoringType values when keying snapshots.
  backfillLeagueScoring()
    .then(() => refreshDefaultSnapshots())
    .then((r) => console.log(`[ADP] Initial snapshot refresh: ${r.combos} combos, ${r.rows} total rows`))
    .catch((err) => console.error("[ADP] Initial snapshot refresh failed:", err));

  // NOTE: Draft ingestion is now driven by the unified scheduled crawler
  // (server/unifiedCrawler.ts), so the periodic ingestCrawledLeagueDrafts pass
  // is retired. We only keep the snapshot refresh here — it recomputes the ADP
  // read-model from whatever drafts the unified crawler has ingested.
  adpInterval = setInterval(() => {
    refreshDefaultSnapshots().catch((err) => console.error("[ADP] Snapshot refresh failed:", err));
  }, SNAPSHOT_INTERVAL_MS);
}

export function stopAdpScheduler() {
  if (adpInterval) clearInterval(adpInterval);
  adpInterval = null;
}
