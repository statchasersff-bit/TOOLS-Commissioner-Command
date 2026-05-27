import { API_BASE } from "@/lib/apiBase";

// ── Types (mirror server/portfolioSnapshots.ts) ──────────────────────────────

export interface TimelinePoint {
  date: string;
  totalValue: number;
  rosterValue: number;
  pickValue: number;
  costBasis: number;
  netValueCreated: number;
  leagueCount: number;
  averageTeamValue: number;
  confidence: string;
}

export interface TimelineSummary {
  totalPortfolioValue: number;
  rosterValue: number;
  pickValue: number;
  costBasis: number;
  netValueCreated: number;
  change: number;
  changePct: number;
  leaguesTracked: number;
  averageTeamValue: number;
  confidence: "high" | "medium" | "low";
}

export interface TimelineResponse {
  sleeperUsername: string;
  range: string;
  mode: string;
  summary: TimelineSummary;
  points: TimelinePoint[];
}

export interface PortfolioEvent {
  id: number;
  date: string;
  type: string;
  title: string;
  description: string;
  netDelta: number;
  valueSent: number | null;
  valueReceived: number | null;
  leagueId: string | null;
  detail: {
    sent?: Array<{ name: string; pos?: string; value: number; kind: string }>;
    received?: Array<{ name: string; pos?: string; value: number; kind: string }>;
  } | null;
  confidence: string;
}

export interface LeagueBreakdownRow {
  leagueId: string;
  leagueName: string;
  currentValue: number;
  rosterValue: number;
  pickValue: number;
  costBasis: number;
  netValueCreated: number;
  confidence: string;
}

export interface AssetRow {
  assetType: string;
  playerId: string | null;
  name: string;
  ownedCount: number;
  currentValueTotal: number;
  costBasisTotal: number;
  netValueCreated: number;
  leagues: Array<{ leagueId: string; leagueName: string; costBasis: number; acquiredMethod: string; acquiredDate: string }>;
}

const TIMEOUT_MS = 20_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${url}`, { credentials: "include", signal: ac.signal, ...init });
    if (!res.ok) throw new Error(`Request failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

export function getPortfolioTimeline(
  handle: string,
  opts: { range?: string; leagueId?: string; sameLeague?: boolean } = {},
): Promise<TimelineResponse> {
  const q = new URLSearchParams();
  if (opts.range) q.set("range", opts.range);
  if (opts.leagueId) q.set("leagueId", opts.leagueId);
  if (opts.sameLeague) q.set("sameLeague", "1");
  const qs = q.toString() ? `?${q.toString()}` : "";
  return fetchJson<TimelineResponse>(`/api/portfolio/${enc(handle)}/timeline${qs}`);
}

export function getPortfolioEvents(
  handle: string,
  opts: { eventType?: string; leagueId?: string; minImpact?: number; limit?: number } = {},
): Promise<{ events: PortfolioEvent[] }> {
  const q = new URLSearchParams();
  if (opts.eventType) q.set("eventType", opts.eventType);
  if (opts.leagueId) q.set("leagueId", opts.leagueId);
  if (opts.minImpact != null) q.set("minImpact", String(opts.minImpact));
  if (opts.limit != null) q.set("limit", String(opts.limit));
  const qs = q.toString() ? `?${q.toString()}` : "";
  return fetchJson<{ events: PortfolioEvent[] }>(`/api/portfolio/${enc(handle)}/events${qs}`);
}

export function getLeagueBreakdown(handle: string): Promise<{ leagues: LeagueBreakdownRow[] }> {
  return fetchJson<{ leagues: LeagueBreakdownRow[] }>(`/api/portfolio/${enc(handle)}/league-breakdown`);
}

export function getPortfolioAssets(handle: string): Promise<{ assets: AssetRow[] }> {
  return fetchJson<{ assets: AssetRow[] }>(`/api/portfolio/${enc(handle)}/assets`);
}

export interface ValueSourceRow {
  method: string;
  label: string;
  currentValue: number;
  costBasis: number;
  netValueCreated: number;
  count: number;
}

export function getValueSourceBreakdown(handle: string): Promise<{ sources: ValueSourceRow[] }> {
  return fetchJson<{ sources: ValueSourceRow[] }>(`/api/portfolio/${enc(handle)}/value-sources`);
}

export function runPortfolioBackfill(handle: string): Promise<{ ok: boolean; positions: number; events: number; leagues: number; snapshots: number }> {
  return fetchJson(`/api/portfolio/${enc(handle)}/backfill`, { method: "POST" });
}

export function recalcPortfolio(handle: string): Promise<{ ok: boolean; snapshots: number }> {
  return fetchJson(`/api/portfolio/${enc(handle)}/recalculate`, { method: "POST" });
}
