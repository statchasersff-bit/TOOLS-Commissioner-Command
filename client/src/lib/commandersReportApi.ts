import { API_BASE } from "@/lib/apiBase";

// ── Types (mirror server/commandersReport.ts) ───────────────────────────────

export type ToneId = "light_roast" | "clean_analyst" | "full_chaos" | "commissioner_safe";

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
  const timer = setTimeout(() => ac.abort(), timeoutMs);
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
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

export function fetchPeriods(leagueId: string): Promise<PeriodsResponse> {
  return fetchJson<PeriodsResponse>(`/api/commanders-report/periods?leagueId=${enc(leagueId)}`);
}

export function fetchReport(leagueId: string, year: number, month: number, tone: ToneId): Promise<ReportResponse> {
  return fetchJson<ReportResponse>(
    `/api/commanders-report?leagueId=${enc(leagueId)}&year=${year}&month=${month}&tone=${tone}`,
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
  { id: "light_roast", label: "Light Roast" },
  { id: "clean_analyst", label: "Clean Analyst" },
  { id: "full_chaos", label: "Full Chaos" },
  { id: "commissioner_safe", label: "Commissioner Safe" },
];
