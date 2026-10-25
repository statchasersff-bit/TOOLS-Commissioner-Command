/**
 * Client for the Trade Review Center API (/api/commissioner/trades/*).
 *
 * All calls go through the same-origin API with the auth cookie attached and a
 * generous timeout (ingestion fans out across many Sleeper week endpoints).
 * Mirrors the shape of the backend's `shapeTrade` response.
 */
import { API_BASE } from "./apiBase";

export type ReviewStatus =
  | "unreviewed"
  | "reviewed"
  | "watchlist"
  | "disputed"
  | "no_action";

export type RiskLabel = "low" | "medium" | "high" | "critical";
export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface TradeAsset {
  id?: number;
  assetType: "player" | "pick" | "faab";
  playerId?: string | null;
  playerName?: string | null;
  position?: string | null;
  team?: string | null;
  pickSeason?: string | null;
  pickRound?: number | null;
  faabAmount?: number | null;
  fromRosterId?: number | null;
  toRosterId?: number | null;
  assetValue: number;
  assetValueSource?: string | null;
}

export interface TradeFlag {
  flagType: string;
  severity: Severity;
  title: string;
  description: string;
}

export interface TradeRow {
  id: number;
  leagueId: string;
  /** Human-readable league name, resolved server-side (null if unavailable). */
  leagueName: string | null;
  /** roster id → team name, for labeling trades across leagues. */
  rosterNames: Record<number, string>;
  sleeperTransactionId: string;
  season: string | null;
  week: number | null;
  status: string | null;
  createdTs: number | null;
  statusUpdatedTs: number | null;
  rosterIds: number[];
  totalValueByRoster: Record<string, number>;
  valueDiffAbs: number;
  valueDiffPct: number;
  riskScore: number;
  riskLabel: RiskLabel;
  fairnessScore: number;
  reviewStatus: ReviewStatus;
  summary: string;
  /** True when at least one commissioner note has been saved for this trade. */
  hasNote: boolean;
  isMultiTeam: boolean;
  assets: TradeAsset[];
  flags: TradeFlag[];
}

export interface TradeReview {
  id: number;
  tradeId: number;
  reviewerUserId: string | null;
  reviewStatus: ReviewStatus;
  notes: string | null;
  decisionReason: string | null;
  createdAt: string;
}

export interface IngestResult {
  success: boolean;
  leagueId: string;
  tradesFound: number;
  newTrades: number;
  updatedTrades: number;
  error?: string;
}

export interface ManagerHistory {
  rosterId: number;
  leagueId: string;
  totalTrades: number;
  valueReceived: number;
  valueSent: number;
  netValue: number;
  futurePicksTradedAway: number;
  highRiskTrades: number;
  disputedTrades: number;
  trades: TradeRow[];
}

export interface LeagueAnalytics {
  totalTrades: number;
  tradesByWeek: Record<string, number>;
  mostActiveManagers: Array<{ rosterId: number; count: number }>;
  frequentTradePairs: Array<{ rosterIdA: number; rosterIdB: number; tradeCount: number; totalValueMoved: number }>;
  avgValueDiffPct: number;
  highRiskTrades: number;
  futurePickTrades: number;
  reviewedCount: number;
  unreviewedCount: number;
}

const TIMEOUT_MS = 60_000;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${url}`, {
      credentials: "include",
      signal: ac.signal,
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Server returned a non-JSON response");
    }
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export function ingestTrades(
  leagueId: string,
  opts?: { weeks?: number[]; forceRefresh?: boolean },
): Promise<IngestResult> {
  return api<IngestResult>("/api/commissioner/trades/ingest", {
    method: "POST",
    body: JSON.stringify({ leagueId, ...opts }),
  });
}

export function fetchTradeFeed(
  leagueId: string | string[],
  filters?: { reviewStatus?: string; risk?: string; managerRosterId?: number },
): Promise<{ leagueId: string; leagueIds: string[]; trades: TradeRow[] }> {
  const ids = (Array.isArray(leagueId) ? leagueId : [leagueId]).filter(Boolean);
  const params = new URLSearchParams({ leagueIds: ids.join(",") });
  if (filters?.reviewStatus && filters.reviewStatus !== "all") params.set("reviewStatus", filters.reviewStatus);
  if (filters?.risk && filters.risk !== "all") params.set("risk", filters.risk);
  if (filters?.managerRosterId != null) params.set("managerRosterId", String(filters.managerRosterId));
  return api(`/api/commissioner/trades?${params.toString()}`);
}

export function fetchTrade(tradeId: number): Promise<{
  trade: TradeRow;
  assets: TradeAsset[];
  flags: TradeFlag[];
  reviews: TradeReview[];
  generatedSummary: string;
}> {
  return api(`/api/commissioner/trades/${tradeId}`);
}

export function updateReview(
  tradeId: number,
  body: { reviewStatus: ReviewStatus; notes?: string; decisionReason?: string },
): Promise<{ success: boolean; tradeId: number; reviewStatus: ReviewStatus }> {
  return api(`/api/commissioner/trades/${tradeId}/review`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function fetchManagerHistory(rosterId: number, leagueId: string): Promise<ManagerHistory> {
  return api(`/api/commissioner/trades/manager/${rosterId}?leagueId=${encodeURIComponent(leagueId)}`);
}

export function fetchAnalytics(leagueId: string): Promise<LeagueAnalytics> {
  return api(`/api/commissioner/trades/analytics?leagueId=${encodeURIComponent(leagueId)}`);
}
