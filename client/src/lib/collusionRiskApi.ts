/**
 * Client for the Collusion Risk Check API (/api/commissioner/collusion-risk).
 *
 * Decision-support only — the server surfaces SIGNALS, never verdicts. This
 * mirrors the shape of runCollusionRiskCheck() on the server.
 */
import { API_BASE } from "./apiBase";

export interface CollusionUser {
  username: string;
  displayName: string;
  userId: string;
  avatar: string | null;
}

export interface CollusionTradeAsset {
  assetType: "player" | "pick" | "faab";
  playerName?: string | null;
  position?: string | null;
  team?: string | null;
  pickSeason?: string | null;
  pickRound?: number | null;
  faabAmount?: number | null;
  fromRosterId?: number | null;
  toRosterId?: number | null;
  assetValue: number;
}

export interface CollusionTradeFlag {
  flagType: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
}

export interface CollusionTrade {
  id: string;
  leagueId: string;
  leagueName: string;
  season: string;
  week: number;
  createdTs: number | null;
  statusUpdatedTs: number | null;
  rosterIds: number[];
  rosterNames: Record<number, string>;
  rosterIdA: number;
  rosterIdB: number;
  totalValueByRoster: Record<string, number>;
  aReceivedValue: number;
  bReceivedValue: number;
  valueGapAbs: number;
  valueGapPct: number;
  winner: "A" | "B" | "even";
  riskScore: number;
  fairnessScore: number;
  isMultiTeam: boolean;
  assets: CollusionTradeAsset[];
  flags: CollusionTradeFlag[];
  timing: "deadline" | "playoffs" | null;
  premiumToWinner: boolean;
}

export interface SharedLeagueRow {
  leagueId: string;
  leagueName: string;
  format: string;
  leagueType: string;
  userATeam: string;
  userBTeam: string;
  tradesBetween: number;
  flags: number;
  status: string;
  seasonsScanned: string[];
}

export interface PatternFlag {
  key: string;
  title: string;
  description: string;
  severity: "info" | "low" | "medium" | "high";
}

export interface ScoreComponent {
  label: string;
  weight: number;
  score: number;
}

export interface CollusionResult {
  userA: CollusionUser;
  userB: CollusionUser;
  riskScore: number;
  riskLabel: string;
  evidenceStrength: number;
  sharedLeaguesCount: number;
  tradesTogether: number;
  flaggedTrades: number;
  valueFlow: { aGained: number; bGained: number; net: number; netSide: "A" | "B" | "even" };
  lastTrade: { week: number; season: string } | null;
  sharedLeagues: SharedLeagueRow[];
  trades: CollusionTrade[];
  patternFlags: PatternFlag[];
  scoreBreakdown: ScoreComponent[];
  activity: { aTotalTrades: number; bTotalTrades: number; aWithB: number; scope: string };
  scannedSeasons: string[];
}

const TIMEOUT_MS = 90_000; // the scan fans out across many Sleeper week endpoints

export async function runCollusionRiskCheck(userA: string, userB: string): Promise<CollusionResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ userA, userB });
    const res = await fetch(`${API_BASE}/api/commissioner/collusion-risk?${params.toString()}`, {
      credentials: "include",
      signal: ac.signal,
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Server returned a non-JSON response");
    }
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body as CollusionResult;
  } finally {
    clearTimeout(timer);
  }
}
