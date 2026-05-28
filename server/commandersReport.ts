/**
 * Commander's Report — deterministic recap engine.
 *
 * This module is the BRAIN of the Commander's Report feature. Given a league +
 * calendar month it aggregates trades, the rookie draft, and waiver/FAAB moves,
 * grades them with deterministic scoring models, and emits:
 *   - structured recap data (for the award cards / data tables), and
 *   - a list of `Claim` objects: one verified factual statement each, with the
 *     numeric evidence behind it.
 *
 * The narrator (templateNarrator.ts) composes prose only from this recap +
 * these claims — never raw Sleeper data — so every sentence traces back to a
 * claim the user can audit in the "Data Receipts" UI. No LLM calls anywhere.
 */
import { fetchLeagueTransactions, fetchSleeperLeagueFull } from "./sleeper";
import { getFantasyCalcValues } from "./fantasycalc";
import { getAdp } from "./adp";
import { rateLimitedFetchJson } from "./adp";

// ── Shared types (mirrored by client/src/lib/commandersReportApi.ts) ─────────

// Full Chaos is the only tone the report ships. Kept as a one-member union (and
// a DB-keyed value) rather than removed outright so report rows / share links
// stay keyed by a stable "tone" and re-adding tones later is a small change.
export type ToneId = "full_chaos";
export const TONES: ToneId[] = ["full_chaos"];
export function isTone(s: unknown): s is ToneId {
  return s === "full_chaos";
}

export type Severity = "info" | "notable" | "spicy";
export type ClaimType = "rookie_pick" | "trade" | "waiver" | "award" | "chaos" | "stat";

export interface Claim {
  id: string;
  claim_type: ClaimType;
  severity: Severity;
  manager: string;
  headline: string;
  evidence: Record<string, number | string | null>;
  /** Tones permitted to use this claim (single-tone now; retained in the data contract). */
  allowed_tone: ToneId[];
}

export interface Award {
  key: string;
  label: string;
  manager: string;
  value: string; // pre-formatted headline value, e.g. "Eli Raridon at 2.07"
  detail: string; // sub-line, e.g. "16.3 picks ahead of ADP"
}

export interface RookiePickRow {
  pickNo: number;
  pickLabel: string; // "2.07"
  player: string;
  position: string;
  manager: string;
  adpPick: number | null;
  delta: number | null;
  classification: string; // Major Steal | Strong Value | Fair Value | Reach | Major Reach | Unranked
}

export interface TradeSide {
  manager: string;
  players: string[];
  picks: string[];
  faab: number;
  value: number;
}

export interface TradeRow {
  id: string;
  date: string; // ISO
  sides: TradeSide[];
  winner: string | null;
  lopsidedness: number; // 0..1
  grade: string; // Robbery | Clear Win | Slight Win | Fair Deal | Confusing
  reason: string;
  // Set when the deal is a "mystery box" — one side shipped a single proven,
  // high-value player out for a multi-player package with no comparable piece
  // coming back. `victim` is the manager who sold the cornerstone.
  mysteryBox?: { victim: string; stud: string; studValue: number; package: string[] } | null;
}

export interface WaiverRow {
  id: string;
  date: string;
  manager: string;
  added: string;
  addedValue: number;
  faab: number;
  spendPct: number; // 0..1
  classification: string;
}

export interface ManagerSummary {
  manager: string;
  direction: "contender" | "fringe" | "rebuild";
  transactions: number;
  trades: number;
  waivers: number;
  faabSpent: number;
  draftPicks: number;
  draftAvgDelta: number | null;
  reaches: number;
  valuePicks: number;
  chaosScore: number;
}

export interface Article {
  headline: string;
  /** Short, punchy one-liner for sharing. Present for the joke tones only. */
  shareText?: string;
  sections: Array<{ title: string; body: string; claimIds: string[] }>;
}

export interface RecapResult {
  meta: {
    leagueId: string;
    leagueName: string;
    format: string; // "SF" | "1QB"
    scoringFormat: string;
    generatedAt: string;
    confidence: "high" | "medium" | "low";
  };
  period: { year: number; month: number; label: string };
  awards: Award[];
  rookieRecap: { drafted: number; rows: RookiePickRow[] };
  tradeRecap: { count: number; rows: TradeRow[] };
  waiverRecap: { count: number; totalFaab: number; rows: WaiverRow[] };
  chaosScore: { score: number; tier: string; drivers: string[] };
  managerSummaries: ManagerSummary[];
  claims: Claim[];
}

// ── Time helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthBounds(year: number, month: number): { startMs: number; endMs: number } {
  // month is 1-12. Bounds are [start, end) in UTC ms.
  return { startMs: Date.UTC(year, month - 1, 1), endMs: Date.UTC(year, month, 1) };
}

function ymOf(ms: number): { year: number; month: number } {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// ── Scoring: rookie pick delta vs rookie ADP ─────────────────────────────────

function classifyRookieDelta(delta: number): { label: string; severity: Severity } {
  if (delta >= 12) return { label: "Major Steal", severity: "spicy" };
  if (delta >= 6) return { label: "Strong Value", severity: "notable" };
  if (delta >= -5) return { label: "Fair Value", severity: "info" };
  if (delta >= -12) return { label: "Reach", severity: "notable" }; // -6 .. -11.x
  return { label: "Major Reach", severity: "spicy" };
}

// Convert an overall pick number to a "round.slot" label given the team count.
function pickLabel(pickNo: number, teams: number): string {
  if (!teams || teams < 1) return String(pickNo);
  const round = Math.floor((pickNo - 1) / teams) + 1;
  const slot = ((pickNo - 1) % teams) + 1;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

// ── Trade grading ─────────────────────────────────────────────────────────────

function gradeFromLopsidedness(lop: number): { grade: string; severity: Severity } {
  if (lop >= 0.55) return { grade: "Robbery", severity: "spicy" };
  if (lop >= 0.35) return { grade: "Clear Win", severity: "notable" };
  if (lop >= 0.18) return { grade: "Slight Win", severity: "notable" };
  if (lop >= 0.08) return { grade: "Fair Deal", severity: "info" };
  return { grade: "Even Swap", severity: "info" };
}

// ── Waiver / FAAB classification ─────────────────────────────────────────────

function classifyWaiver(opts: {
  addedValue: number;
  faab: number;
  spendPct: number;
  faabEnabled: boolean;
  droppedSoonAfter: boolean;
}): { label: string; severity: Severity } {
  const { addedValue, faab, spendPct, faabEnabled, droppedSoonAfter } = opts;
  if (droppedSoonAfter) return { label: "Roster Churn Theater", severity: "spicy" };
  if (!faabEnabled || faab <= 0) {
    return addedValue >= 1500
      ? { label: "Smart Stash", severity: "notable" }
      : { label: "Depth Flier", severity: "info" };
  }
  // Rough value-per-dollar yardstick: ~50 value pts per FAAB $ is "fair".
  const fairValueForSpend = faab * 50;
  if (spendPct >= 0.3 && addedValue < fairValueForSpend * 0.6) {
    return { label: "Desperation Bid", severity: "spicy" };
  }
  if (addedValue >= fairValueForSpend * 1.6 && spendPct <= 0.1) {
    return { label: "FAAB Heist", severity: "notable" };
  }
  if (spendPct >= 0.25) return { label: "FAAB Flex", severity: "notable" };
  return { label: "Fair Grab", severity: "info" };
}

// ── Internal aliases for the upstream return shapes ──────────────────────────

type TxnResult = Awaited<ReturnType<typeof fetchLeagueTransactions>>;
type Txn = TxnResult["transactions"][number];
type LeagueFull = Awaited<ReturnType<typeof fetchSleeperLeagueFull>>;
type Team = LeagueFull["league"]["teams"][number];

interface RawDraft {
  draft_id: string;
  type: string;
  status: string;
  season: string;
  start_time: number | null;
  last_picked: number | null;
  settings?: { rounds?: number; teams?: number } | null;
  metadata?: { scoring_type?: string } | null;
}
interface RawPick {
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: number;
  picked_by: string;
  player_id: string;
  metadata?: { first_name?: string; last_name?: string; position?: string; team?: string } | null;
}

const SLEEPER_API = "https://api.sleeper.app/v1";

// Caps so a hyperactive league doesn't flood the LLM context or the UI. Full
// totals are still reported via each section's `count`; only the displayed rows
// and the claims handed to the narrator are limited to the most significant.
const MAX_TRADE_ROWS = 14;
const MAX_TRADE_CLAIMS = 8;
const MAX_WAIVER_ROWS = 14;
const MAX_WAIVER_CLAIMS = 8;
const MAX_ROOKIE_ROWS = 64;
const MAX_ROOKIE_CLAIMS = 10;

const SEVERITY_RANK: Record<Severity, number> = { spicy: 3, notable: 2, info: 1 };

function waiverSeverityFor(label: string): Severity {
  if (label === "Roster Churn Theater" || label === "Desperation Bid") return "spicy";
  if (label === "FAAB Heist" || label === "FAAB Flex" || label === "Smart Stash") return "notable";
  return "info";
}

// ── Value helpers ─────────────────────────────────────────────────────────────

function makeValueLookup(valuesBySleeperId: Record<string, number>) {
  const playerValue = (sleeperId: string): number => valuesBySleeperId[sleeperId] ?? 0;
  // FantasyCalc encodes generic pick values under FP_{year}_{round}.
  const pickValue = (year: number, round: number): number =>
    valuesBySleeperId[`FP_${year}_${round}`] ?? 0;
  return { playerValue, pickValue };
}

// ── Team direction inference ─────────────────────────────────────────────────

function inferTeamDirections(
  teams: Team[],
  vals: ReturnType<typeof makeValueLookup>,
): Map<string, { direction: "contender" | "fringe" | "rebuild"; totalValue: number; avgAge: number }> {
  const rows = teams.map((t) => {
    // Upstream types roster entries as `T | null` (built via .filter(Boolean)); drop nulls.
    const roster = t.roster.filter((p): p is NonNullable<typeof p> => p != null);
    const rosterValue = roster.reduce((s, p) => s + vals.playerValue(p.sleeperId), 0);
    const pickValue = t.picks.reduce((s, p) => s + vals.pickValue(p.year, p.round), 0);
    const ages = roster.map((p) => p.age).filter((a) => a > 0);
    const avgAge = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : 0;
    return { manager: t.owner, totalValue: rosterValue + pickValue, avgAge };
  });
  const sorted = [...rows].sort((a, b) => b.totalValue - a.totalValue);
  const n = sorted.length || 1;
  const out = new Map<string, { direction: "contender" | "fringe" | "rebuild"; totalValue: number; avgAge: number }>();
  sorted.forEach((r, i) => {
    const pct = i / n; // 0 = richest
    let direction: "contender" | "fringe" | "rebuild";
    if (pct < 1 / 3) direction = "contender";
    else if (pct >= 2 / 3) direction = "rebuild";
    else direction = "fringe";
    out.set(r.manager, { direction, totalValue: r.totalValue, avgAge: r.avgAge });
  });
  return out;
}

// ── Mystery Box detection ────────────────────────────────────────────────────
// The "sold the boat for three mystery boxes" trade: one side ships out a single
// proven, high-value player and gets back a multi-player package, none of which
// is a comparable cornerstone. Detected purely on value shape, so it's
// scale-independent via a league-relative `eliteFloor`.
type SideValueInfo = { side: TradeSide; playerDetails: Array<{ name: string; value: number }> };

function detectMysteryBox(sideInfos: SideValueInfo[], eliteFloor: number): TradeRow["mysteryBox"] {
  if (sideInfos.length !== 2 || eliteFloor <= 0) return null;
  const [a, b] = sideInfos;
  for (const [studS, victimS] of [[a, b], [b, a]] as const) {
    if (studS.playerDetails.length !== 1) continue; // one side received a lone player...
    if (victimS.playerDetails.length < 2) continue; // ...the other received a multi-player package
    const studValue = studS.playerDetails[0].value;
    if (studValue < eliteFloor) continue; // the lone player must be a proven, high-value asset
    const pkgMax = Math.max(...victimS.playerDetails.map((p) => p.value));
    if (pkgMax >= studValue * 0.7) continue; // a comparable cornerstone came back → not a mystery box
    return {
      victim: victimS.side.manager, // gave the stud, received the boxes
      stud: studS.playerDetails[0].name,
      studValue: Math.round(studValue),
      package: victimS.playerDetails.map((p) => p.name),
    };
  }
  return null;
}

// ── Draft fetching ────────────────────────────────────────────────────────────

async function fetchLeagueDraftsInMonth(
  leagueId: string,
  startMs: number,
  endMs: number,
): Promise<Array<{ draft: RawDraft; picks: RawPick[] }>> {
  const drafts = await rateLimitedFetchJson<RawDraft[]>(`${SLEEPER_API}/league/${leagueId}/drafts`);
  if (!drafts || !Array.isArray(drafts)) return [];
  const inMonth = drafts.filter((d) => {
    if (d.status !== "complete") return false;
    const ts = (d.last_picked || d.start_time || 0); // Sleeper draft timestamps are ms
    return ts >= startMs && ts < endMs;
  });
  const out: Array<{ draft: RawDraft; picks: RawPick[] }> = [];
  for (const d of inMonth) {
    const picks = await rateLimitedFetchJson<RawPick[]>(`${SLEEPER_API}/draft/${d.draft_id}/picks`);
    if (picks && Array.isArray(picks)) out.push({ draft: d, picks });
  }
  return out;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function buildRecap(leagueId: string, year: number, month: number): Promise<RecapResult> {
  const { startMs, endMs } = monthBounds(year, month);

  const [txnResult, leagueFull, fcRaw] = await Promise.all([
    fetchLeagueTransactions(leagueId),
    fetchSleeperLeagueFull(leagueId, ""),
    // Format chosen after we know SF vs 1QB; but getFantasyCalcValues caches, so
    // a second call below is cheap. We fetch the SF set first as a default and
    // re-fetch the correct one once format is known.
    getFantasyCalcValues("sf").catch(() => null),
  ]);

  const format = leagueFull.format; // "SF" | "1QB"
  const fcFormat = format === "SF" ? "sf" : "1qb";
  const fc =
    fcRaw && fcFormat === "sf"
      ? fcRaw
      : await getFantasyCalcValues(fcFormat).catch(() => fcRaw);
  const valuesBySleeperId = fc?.valuesBySleeperId ?? {};
  const vals = makeValueLookup(valuesBySleeperId);
  const haveValues = Object.keys(valuesBySleeperId).length > 0;

  const teams = leagueFull.league.teams;
  const totalRosters = txnResult.totalRosters || teams.length || 12;
  const directions = inferTeamDirections(teams, vals);
  // League-relative "proven, high-value" floor (top ~15% of rostered players),
  // used to spot a cornerstone in Mystery Box trade detection without hardcoding
  // a value scale.
  const rosterValues = teams
    .flatMap((t) => t.roster.filter((p): p is NonNullable<typeof p> => p != null).map((p) => vals.playerValue(p.sleeperId)))
    .filter((v) => v > 0)
    .sort((x, y) => y - x);
  const eliteFloor = rosterValues.length ? rosterValues[Math.floor(rosterValues.length * 0.15)] : 0;
  const faabBudget = txnResult.waiverBudgetTotal || 100;
  const faabEnabled = faabBudget > 0;

  // Rookie ADP for the season (direct-rookies mode), keyed by player_id.
  const scoring = leagueFull.scoringFormat?.toLowerCase().includes("half")
    ? "half"
    : leagueFull.scoringFormat?.toLowerCase().includes("standard")
    ? "standard"
    : "ppr";
  let rookieAdpByPlayer = new Map<string, number>();
  try {
    const adp = await getAdp({
      season: String(year),
      draftType: "rookie",
      superflex: format === "SF" ? "yes" : "no",
      scoring: scoring as "ppr" | "half" | "standard",
      teams: totalRosters,
      rookieMode: "direct",
    });
    for (const r of adp.rows) {
      if (r.player_id) rookieAdpByPlayer.set(r.player_id, r.avg_pick);
    }
  } catch {
    rookieAdpByPlayer = new Map();
  }

  const claims: Claim[] = [];
  const periodTxns = txnResult.transactions.filter((t) => t.timestamp >= startMs && t.timestamp < endMs);

  // ── Rookie draft recap ──────────────────────────────────────────────────
  const draftsInMonth = await fetchLeagueDraftsInMonth(leagueId, startMs, endMs);
  const rookieRows: RookiePickRow[] = [];
  const rookieClaimCandidates: Array<{ claim: Claim; absDelta: number }> = [];
  for (const { draft, picks } of draftsInMonth) {
    const teamsInDraft = draft.settings?.teams || totalRosters;
    for (const p of picks) {
      const player =
        `${p.metadata?.first_name ?? ""} ${p.metadata?.last_name ?? ""}`.trim() || p.player_id;
      const manager = p.picked_by ? managerForUserId(p.picked_by, leagueFull) : "Unknown";
      const adpPick = rookieAdpByPlayer.get(p.player_id) ?? null;
      const delta = adpPick != null ? round1(adpPick - p.pick_no) : null;
      const cls = delta != null ? classifyRookieDelta(delta) : { label: "Unranked", severity: "info" as Severity };
      const label = pickLabel(p.pick_no, teamsInDraft);
      rookieRows.push({
        pickNo: p.pick_no,
        pickLabel: label,
        player,
        position: p.metadata?.position ?? "?",
        manager,
        adpPick: adpPick != null ? round1(adpPick) : null,
        delta,
        classification: cls.label,
      });
      // Only emit a steal/reach claim when we actually have ADP coverage.
      if (delta != null && cls.label !== "Fair Value") {
        rookieClaimCandidates.push({
          absDelta: Math.abs(delta),
          claim: {
            id: `rookie-${label}-${p.player_id}`,
            claim_type: "rookie_pick",
            severity: cls.severity,
            manager,
            headline: `${manager} took ${player} at ${label} — ${
              delta >= 0 ? `${delta} picks later than` : `${Math.abs(delta)} picks ahead of`
            } rookie ADP (${cls.label}).`,
            evidence: {
              player,
              position: p.metadata?.position ?? null,
              actualPick: p.pick_no,
              pickLabel: label,
              adpPick: round1(adpPick!),
              deltaSlots: delta,
              classification: cls.label,
            },
            allowed_tone: [...TONES],
          },
        });
      }
    }
  }
  // Keep the most extreme reaches/steals; they make the best (verifiable) copy.
  rookieClaimCandidates.sort((a, b) => b.absDelta - a.absDelta);
  for (const c of rookieClaimCandidates.slice(0, MAX_ROOKIE_CLAIMS)) claims.push(c.claim);
  // UI rows: surface graded picks first (by |delta|), then the rest by pick order.
  rookieRows.sort((a, b) => {
    const ad = a.delta == null ? -1 : Math.abs(a.delta);
    const bd = b.delta == null ? -1 : Math.abs(b.delta);
    if (ad !== bd) return bd - ad;
    return a.pickNo - b.pickNo;
  });

  // ── Trade recap ───────────────────────────────────────────────────────────
  const tradeTxns = periodTxns.filter((t) => t.type === "trade");
  const tradeRows: TradeRow[] = [];
  for (const t of tradeTxns) {
    const tradeId = `trade-${t.timestamp}-${t.involvedTeams.map((x) => x.rosterId).sort().join("-")}`;
    const sideInfos: SideValueInfo[] = t.involvedTeams.map((team) => {
      const playersReceived = t.adds.filter((a) => a.rosterId === team.rosterId);
      const picksReceived = t.draftPicks.filter((dp) => dp.toTeam === team.teamName);
      const faabReceived = t.faabTransfers
        .filter((f) => f.toTeam === team.teamName)
        .reduce((s, f) => s + f.amount, 0);
      const playerDetails = playersReceived.map((a) => ({ name: a.name, value: vals.playerValue(a.playerId) }));
      const playerVal = playerDetails.reduce((s, p) => s + p.value, 0);
      const pickVal = picksReceived.reduce((s, dp) => s + vals.pickValue(parseInt(dp.season, 10), dp.round), 0);
      const faabVal = faabReceived * 50; // same value-per-$ yardstick as waivers
      return {
        side: {
          manager: team.teamName,
          players: playerDetails.map((p) => p.name),
          picks: picksReceived.map((dp) => `${dp.season} R${dp.round}`),
          faab: faabReceived,
          value: Math.round(playerVal + pickVal + faabVal),
        },
        playerDetails,
      };
    });
    const sides: TradeSide[] = sideInfos.map((x) => x.side);
    // Winner = side that received the most value; lopsidedness = value gap share.
    const sideValues = sides.map((s) => s.value);
    const maxVal = sideValues.length ? Math.max(...sideValues) : 0;
    const minVal = sideValues.length ? Math.min(...sideValues) : 0;
    const lop = maxVal > 0 ? round2((maxVal - minVal) / maxVal) : 0;
    const winner = maxVal > 0 && sides.length >= 2 ? sides.reduce((a, b) => (a.value >= b.value ? a : b)).manager : null;
    const { grade, severity } = gradeFromLopsidedness(lop);
    const reason = describeTradeReason(sides, directions);
    void severity; // severity is re-derived per claim below from lopsidedness
    tradeRows.push({
      id: tradeId,
      date: new Date(t.timestamp).toISOString(),
      sides,
      winner,
      lopsidedness: lop,
      grade,
      reason,
      mysteryBox: haveValues ? detectMysteryBox(sideInfos, eliteFloor) : null,
    });
  }
  // Claims + UI rows: the most lopsided trades are the most worth narrating.
  const tradesByLop = [...tradeRows].sort((a, b) => b.lopsidedness - a.lopsidedness);
  for (const row of tradesByLop.slice(0, MAX_TRADE_CLAIMS)) {
    const sev: Severity = haveValues ? gradeFromLopsidedness(row.lopsidedness).severity : "info";
    claims.push({
      id: row.id,
      claim_type: "trade",
      severity: sev,
      manager: row.winner ?? row.sides[0]?.manager ?? "Unknown",
      headline: tradeHeadline(row.sides, row.winner, row.grade),
      evidence: {
        grade: row.grade,
        winner: row.winner,
        lopsidedness: row.lopsidedness,
        ...Object.fromEntries(
          row.sides.map((s, i) => [
            `side${i + 1}`,
            `${s.manager}: ${[...s.players, ...s.picks].join(", ") || `$${s.faab} FAAB`} (value ${s.value})`,
          ]),
        ),
        valueConfidence: haveValues ? "high" : "low",
      },
      allowed_tone: [...TONES],
    });
  }

  // ── Waiver / FAAB recap ─────────────────────────────────────────────────
  const waiverTxns = periodTxns.filter((t) => t.type === "waiver" || t.type === "free_agent");
  const waiverRows: WaiverRow[] = [];
  let totalFaab = 0;
  // "Roster churn" signal: a player picked up this month and then dropped again
  // in a *later* transaction within the same window.
  const dropTimeByPlayer = new Map<string, number>();
  for (const t of periodTxns) {
    for (const d of t.drops) {
      const prev = dropTimeByPlayer.get(d.playerId);
      if (prev == null || t.timestamp > prev) dropTimeByPlayer.set(d.playerId, t.timestamp);
    }
  }
  for (const t of waiverTxns) {
    for (const a of t.adds) {
      const faab = t.waiverBid ?? 0;
      totalFaab += faab;
      const spendPct = faabBudget > 0 ? round2(faab / faabBudget) : 0;
      const addedValue = vals.playerValue(a.playerId);
      const dropTime = dropTimeByPlayer.get(a.playerId);
      const droppedSoonAfter = dropTime != null && dropTime > t.timestamp;
      const cls = classifyWaiver({ addedValue, faab, spendPct, faabEnabled, droppedSoonAfter });
      const id = `waiver-${t.timestamp}-${a.playerId}`;
      waiverRows.push({
        id,
        date: new Date(t.timestamp).toISOString(),
        manager: a.teamName,
        added: a.name,
        addedValue: Math.round(addedValue),
        faab,
        spendPct,
        classification: cls.label,
      });
    }
  }
  // Sort by FAAB spend (the biggest spends are the headline-worthy ones), then
  // emit claims for the top handful that are actually notable.
  waiverRows.sort((a, b) => b.faab - a.faab);
  let waiverClaimsEmitted = 0;
  for (const row of waiverRows) {
    if (waiverClaimsEmitted >= MAX_WAIVER_CLAIMS) break;
    const sev = waiverSeverityFor(row.classification);
    if (row.faab <= 0 && sev === "info") continue;
    waiverClaimsEmitted += 1;
    claims.push({
      id: row.id,
      claim_type: "waiver",
      severity: sev,
      manager: row.manager,
      headline: row.faab > 0
        ? `${row.manager} spent $${row.faab} FAAB (${Math.round(row.spendPct * 100)}% of budget) on ${row.added} — ${row.classification}.`
        : `${row.manager} added ${row.added} off waivers — ${row.classification}.`,
      evidence: {
        player: row.added,
        faab: row.faab,
        spendPct: row.spendPct,
        budgetTotal: faabBudget,
        addedValue: row.addedValue,
        classification: row.classification,
      },
      allowed_tone: [...TONES],
    });
  }

  // ── Manager summaries ─────────────────────────────────────────────────────
  const managerSummaries = buildManagerSummaries(periodTxns, rookieRows, directions, teams);

  // ── Chaos score (league level) ────────────────────────────────────────────
  const chaos = computeChaosScore({
    trades: tradeRows,
    waiverCount: waiverRows.length,
    totalFaab,
    faabBudget,
    rosters: totalRosters,
    rookieRows,
  });
  claims.push({
    id: "chaos-league",
    claim_type: "chaos",
    severity: chaos.score >= 60 ? "notable" : "info",
    manager: "League",
    headline: `League Chaos Score: ${chaos.score}/100 — "${chaos.tier}". ${chaos.drivers.join(" ")}`,
    evidence: { score: chaos.score, tier: chaos.tier, trades: tradeRows.length, waivers: waiverRows.length, totalFaab },
    allowed_tone: [...TONES],
  });

  // ── Awards ─────────────────────────────────────────────────────────────────
  const awards = buildAwards({ rookieRows, tradeRows, waiverRows, managerSummaries });
  for (const aw of awards) {
    claims.push({
      id: `award-${aw.key}`,
      claim_type: "award",
      severity: "notable",
      manager: aw.manager,
      headline: `${aw.label}: ${aw.manager} — ${aw.value} (${aw.detail}).`,
      evidence: { award: aw.label, manager: aw.manager, value: aw.value, detail: aw.detail },
      allowed_tone: [...TONES],
    });
  }

  const confidence: "high" | "medium" | "low" = !haveValues
    ? "low"
    : rookieAdpByPlayer.size === 0 && rookieRows.length > 0
    ? "medium"
    : "high";

  return {
    meta: {
      leagueId,
      leagueName: txnResult.leagueName,
      format,
      scoringFormat: leagueFull.scoringFormat,
      generatedAt: new Date().toISOString(),
      confidence,
    },
    period: { year, month, label: `${MONTH_NAMES[month - 1]} ${year}` },
    awards,
    rookieRecap: { drafted: rookieRows.length, rows: rookieRows.slice(0, MAX_ROOKIE_ROWS) },
    tradeRecap: { count: tradeRows.length, rows: tradesByLop.slice(0, MAX_TRADE_ROWS) },
    waiverRecap: { count: waiverRows.length, totalFaab, rows: waiverRows.slice(0, MAX_WAIVER_ROWS) },
    chaosScore: chaos,
    managerSummaries,
    claims,
  };
}

// ── Period discovery ──────────────────────────────────────────────────────────

export async function listActivePeriods(
  leagueId: string,
): Promise<{ periods: Array<{ year: number; month: number; activityCount: number }>; defaultPeriod: { year: number; month: number } }> {
  const txnResult = await fetchLeagueTransactions(leagueId);
  const counts = new Map<string, { year: number; month: number; activityCount: number }>();
  for (const t of txnResult.transactions) {
    const { year, month } = ymOf(t.timestamp);
    const key = `${year}-${month}`;
    const cur = counts.get(key) ?? { year, month, activityCount: 0 };
    cur.activityCount += 1;
    counts.set(key, cur);
  }
  const periods = Array.from(counts.values()).sort((a, b) => b.year - a.year || b.month - a.month);
  const now = new Date();
  const defaultPeriod = periods[0] ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  return { periods, defaultPeriod };
}

// ── Sub-builders & small helpers ──────────────────────────────────────────────

function managerForUserId(userId: string, leagueFull: LeagueFull): string {
  const t = leagueFull.league.teams.find((tm) => tm.ownerId === userId);
  return t?.owner ?? "Unknown";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function describeTradeReason(
  sides: TradeSide[],
  directions: ReturnType<typeof inferTeamDirections>,
): string {
  if (sides.length < 2) return "Single-team transaction.";
  const parts = sides.map((s) => {
    const dir = directions.get(s.manager)?.direction ?? "fringe";
    const assets = [...s.players, ...s.picks].join(", ") || `$${s.faab} FAAB`;
    return `${s.manager} (${dir}) received ${assets}`;
  });
  return parts.join("; ") + ".";
}

function tradeHeadline(sides: TradeSide[], winner: string | null, grade: string): string {
  if (sides.length < 2) return `${sides[0]?.manager ?? "A manager"} made a roster move.`;
  const [a, b] = sides;
  const aAssets = [...a.players, ...a.picks].join(", ") || `$${a.faab} FAAB`;
  const bAssets = [...b.players, ...b.picks].join(", ") || `$${b.faab} FAAB`;
  return `${a.manager} sent ${bAssets} and got ${aAssets}; ${b.manager} got the other end. Verdict: ${grade}${winner ? `, edge ${winner}` : ""}.`;
}

function buildManagerSummaries(
  periodTxns: Txn[],
  rookieRows: RookiePickRow[],
  directions: ReturnType<typeof inferTeamDirections>,
  teams: Team[],
): ManagerSummary[] {
  const map = new Map<string, ManagerSummary>();
  const ensure = (manager: string): ManagerSummary => {
    let m = map.get(manager);
    if (!m) {
      m = {
        manager,
        direction: directions.get(manager)?.direction ?? "fringe",
        transactions: 0,
        trades: 0,
        waivers: 0,
        faabSpent: 0,
        draftPicks: 0,
        draftAvgDelta: null,
        reaches: 0,
        valuePicks: 0,
        chaosScore: 0,
      };
      map.set(manager, m);
    }
    return m;
  };
  // Seed every team so quiet managers still appear.
  for (const t of teams) ensure(t.owner);

  for (const t of periodTxns) {
    const actors = new Set<string>();
    if (t.type === "trade") {
      for (const it of t.involvedTeams) actors.add(it.teamName);
      for (const m of Array.from(actors)) {
        const s = ensure(m);
        s.trades += 1;
        s.transactions += 1;
      }
    } else {
      for (const a of t.adds) {
        const s = ensure(a.teamName);
        s.waivers += 1;
        s.transactions += 1;
        s.faabSpent += t.waiverBid ?? 0;
      }
    }
  }

  // Fold in draft deltas.
  const byManagerDeltas = new Map<string, number[]>();
  for (const r of rookieRows) {
    const s = ensure(r.manager);
    s.draftPicks += 1;
    if (r.delta != null) {
      const arr = byManagerDeltas.get(r.manager) ?? [];
      arr.push(r.delta);
      byManagerDeltas.set(r.manager, arr);
      if (r.classification === "Reach" || r.classification === "Major Reach") s.reaches += 1;
      if (r.classification === "Strong Value" || r.classification === "Major Steal") s.valuePicks += 1;
    }
  }
  for (const [manager, arr] of Array.from(byManagerDeltas)) {
    const s = ensure(manager);
    s.draftAvgDelta = arr.length ? round1(arr.reduce((x: number, y: number) => x + y, 0) / arr.length) : null;
  }

  // Per-manager chaos: activity + reaches + faab intensity, clamped 0..100.
  for (const s of Array.from(map.values())) {
    const raw =
      s.transactions * 6 +
      s.reaches * 8 +
      Math.min(s.faabSpent / 5, 30) +
      (s.trades >= 3 ? 12 : 0);
    s.chaosScore = Math.max(0, Math.min(100, Math.round(raw)));
  }

  return Array.from(map.values()).sort((a, b) => b.transactions - a.transactions);
}

function computeChaosScore(opts: {
  trades: TradeRow[];
  waiverCount: number;
  totalFaab: number;
  faabBudget: number;
  rosters: number;
  rookieRows: RookiePickRow[];
}): { score: number; tier: string; drivers: string[] } {
  const { trades, waiverCount, totalFaab, faabBudget, rosters, rookieRows } = opts;
  const lopsided = trades.filter((t) => t.lopsidedness >= 0.35).length;
  const bigReaches = rookieRows.filter((r) => r.classification === "Major Reach").length;
  const faabIntensity = faabBudget > 0 ? Math.min(totalFaab / (faabBudget * Math.max(rosters, 1)), 1) : 0;

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(trades.length * 7 + lopsided * 8 + waiverCount * 3 + bigReaches * 9 + faabIntensity * 40),
    ),
  );
  const tier =
    score <= 20 ? "Calm Waters" : score <= 45 ? "Mildly Restless" : score <= 70 ? "League Entertainment" : "Certified Menace";
  const drivers: string[] = [];
  if (trades.length) drivers.push(`${trades.length} trade${trades.length === 1 ? "" : "s"}${lopsided ? ` (${lopsided} lopsided)` : ""}.`);
  if (waiverCount) drivers.push(`${waiverCount} waiver/FA move${waiverCount === 1 ? "" : "s"}.`);
  if (bigReaches) drivers.push(`${bigReaches} major draft reach${bigReaches === 1 ? "" : "es"}.`);
  if (!drivers.length) drivers.push("A genuinely quiet month.");
  return { score, tier, drivers };
}

function buildAwards(opts: {
  rookieRows: RookiePickRow[];
  tradeRows: TradeRow[];
  waiverRows: WaiverRow[];
  managerSummaries: ManagerSummary[];
}): Award[] {
  const { rookieRows, tradeRows, waiverRows, managerSummaries } = opts;
  const awards: Award[] = [];

  const ranked = rookieRows.filter((r) => r.delta != null);
  if (ranked.length) {
    const reach = [...ranked].sort((a, b) => (a.delta! - b.delta!))[0];
    if (reach.delta! < 0) {
      awards.push({
        key: "biggest_reach",
        label: "Biggest Reach",
        manager: reach.manager,
        value: `${reach.player} at ${reach.pickLabel}`,
        detail: `${Math.abs(reach.delta!)} picks ahead of ADP`,
      });
    }
    const value = [...ranked].sort((a, b) => (b.delta! - a.delta!))[0];
    if (value.delta! > 0) {
      awards.push({
        key: "best_value",
        label: "Best Value",
        manager: value.manager,
        value: `${value.player} at ${value.pickLabel}`,
        detail: `${value.delta} picks after ADP`,
      });
    }
  }

  const topFaab = waiverRows[0];
  if (topFaab && topFaab.faab > 0) {
    awards.push({
      key: "largest_faab_spend",
      label: "Largest FAAB Spend",
      manager: topFaab.manager,
      value: topFaab.added,
      detail: `$${topFaab.faab}`,
    });
  }

  const topTrade = [...tradeRows].sort((a, b) => b.lopsidedness - a.lopsidedness)[0];
  if (topTrade && topTrade.winner) {
    awards.push({
      key: "best_trade",
      label: "Most Lopsided Trade",
      manager: topTrade.winner,
      value: topTrade.grade,
      detail: `${Math.round(topTrade.lopsidedness * 100)}% value edge`,
    });
  }

  const mostActive = [...managerSummaries].sort((a, b) => b.transactions - a.transactions)[0];
  if (mostActive && mostActive.transactions > 0) {
    awards.push({
      key: "most_active",
      label: "Most Active",
      manager: mostActive.manager,
      value: `${mostActive.transactions} moves`,
      detail: `${mostActive.trades} trades, ${mostActive.waivers} waivers`,
    });
  }

  const menace = [...managerSummaries].sort((a, b) => b.chaosScore - a.chaosScore)[0];
  if (menace && menace.chaosScore >= 40) {
    awards.push({
      key: "most_chaotic",
      label: "Most Chaotic Manager",
      manager: menace.manager,
      value: `Chaos ${menace.chaosScore}`,
      detail: `${menace.direction} energy`,
    });
  }

  return awards;
}
