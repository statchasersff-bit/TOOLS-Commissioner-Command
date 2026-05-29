import { API_BASE } from "@/lib/apiBase";

// ── Types (mirror server/commandersReport.ts) ───────────────────────────────

export type ToneId = "full_chaos";

export interface Claim {
  id: string;
  claim_type: "rookie_pick" | "trade" | "waiver" | "award" | "chaos" | "stat";
  severity: "info" | "notable" | "spicy";
  manager: string;
  headline: string;
  evidence: Record<string, number | string | null>;
  allowed_tone: ToneId[];
}

export interface Award {
  key: string;
  label: string;
  manager: string;
  value: string;
  detail: string;
}

export interface RookiePickRow {
  pickNo: number;
  pickLabel: string;
  player: string;
  position: string;
  manager: string;
  adpPick: number | null;
  delta: number | null;
  classification: string;
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
  date: string;
  sides: TradeSide[];
  winner: string | null;
  lopsidedness: number;
  grade: string;
  reason: string;
  mysteryBox?: { victim: string; stud: string; studValue: number; package: string[] } | null;
}

export interface WaiverRow {
  id: string;
  date: string;
  manager: string;
  added: string;
  addedValue: number;
  faab: number;
  spendPct: number;
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

export type StorylineType =
  | "rookie_reach"
  | "massive_rookie_reach"
  | "rookie_value"
  | "rookie_pick_hoarder"
  | "position_collector"
  | "ghost_owner"
  | "pick_downgrade_trade"
  | "mystery_box_trade"
  | "old_name_faab"
  | "faab_overpay"
  | "roster_churn_theater"
  | "confusing_aggression";

// Mirrors server/storylines.ts → Storyline.
export interface Storyline {
  storyline_type: StorylineType;
  manager: string;
  involved_players: string[];
  involved_picks: string[];
  positions: string[];
  player_archetypes: string[];
  data_points: Record<string, string | number | null>;
  why_it_matters: string;
  suggested_roast_angle: string;
  safe_for_opening: boolean;
  good_for_callback: boolean;
  claimIds: string[];
  score: number;
  scoreBreakdown: Record<string, number>;
}

export interface RecapResult {
  meta: {
    leagueId: string;
    leagueName: string;
    format: string;
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
  /** Ranked storyline package (top 6-8). Optional: recaps cached before this existed omit it. */
  storylines?: Storyline[];
}

export interface Article {
  headline: string;
  /** Short, punchy one-liner for sharing. Present for the joke tones only. */
  shareText?: string;
  sections: Array<{ title: string; body: string; claimIds: string[] }>;
}

export interface ReportResponse {
  recap: RecapResult;
  article: Article | null;
  generatedAt: string | null;
  model: string | null;
  tone: ToneId;
  narrationAvailable: boolean;
  cached: boolean;
}

export interface PeriodsResponse {
  periods: Array<{ year: number; month: number; activityCount: number }>;
  defaultPeriod: { year: number; month: number };
}

export interface ShareResponse {
  token: string;
  path: string; // "/share/report/<token>"
}

export interface PublicReportResponse {
  recap: RecapResult;
  article: Article | null;
  generatedAt: string | null;
  model: string | null;
  tone: ToneId;
  leagueName: string;
  period: { year: number; month: number; label: string } | null;
}

const TIMEOUT_MS = 30_000;

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${url}`, { credentials: "include", signal: ac.signal, ...init });
    if (!res.ok) {
      let msg = `Request failed: HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return (await res.json()) as T;
  } catch (err: any) {
    // Surface our own timeout as a clear message instead of the raw DOMException
    // ("signal is aborted without reason") the browser throws on abort().
    if (timedOut || err?.name === "AbortError") {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s — leagues with a lot of activity can take a while. Please try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

export function fetchPeriods(leagueId: string): Promise<PeriodsResponse> {
  // Builds from a full season of Sleeper transactions on a cold cache — give it room.
  return fetchJson<PeriodsResponse>(`/api/commanders-report/periods?leagueId=${enc(leagueId)}`, undefined, 60_000);
}

export function fetchReport(leagueId: string, year: number, month: number, tone: ToneId): Promise<ReportResponse> {
  // First load computes the recap from Sleeper data; subsequent loads are cached.
  return fetchJson<ReportResponse>(
    `/api/commanders-report?leagueId=${enc(leagueId)}&year=${year}&month=${month}&tone=${tone}`,
    undefined,
    60_000,
  );
}

export function generateReport(leagueId: string, year: number, month: number, tone: ToneId): Promise<ReportResponse> {
  return fetchJson<ReportResponse>(
    `/api/commanders-report/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId, year, month, tone }),
    },
    120_000, // narration is a synchronous LLM call
  );
}

export function shareReport(leagueId: string, year: number, month: number, tone: ToneId): Promise<ShareResponse> {
  return fetchJson<ShareResponse>(`/api/commanders-report/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leagueId, year, month, tone }),
  });
}

export function revokeShare(leagueId: string, year: number, month: number, tone: ToneId): Promise<{ revoked: boolean }> {
  return fetchJson<{ revoked: boolean }>(`/api/commanders-report/share`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leagueId, year, month, tone }),
  });
}

export function fetchPublicReport(token: string): Promise<PublicReportResponse> {
  return fetchJson<PublicReportResponse>(`/api/commanders-report/public/${enc(token)}`);
}

/** Absolute URL for a share token, honoring the app's base path. */
export function shareUrl(path: string): string {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  return `${window.location.origin}${base}${path}`;
}

export const TONE_OPTIONS: Array<{ id: ToneId; label: string }> = [
  { id: "full_chaos", label: "Full Chaos" },
];
