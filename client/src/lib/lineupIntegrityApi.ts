/**
 * Typed client for the Lineup Integrity & Anti-Tanking API
 * (/api/commissioner/lineup-integrity/*). Plain fetch + credentials, matching
 * the rest of the app. Every call is read-only on the manager's side — these
 * endpoints never message managers or change lineups.
 */
import { API_BASE } from "./apiBase";

const BASE = `${API_BASE}/api/commissioner/lineup-integrity`;

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = qs.toString() ? `${BASE}${path}?${qs}` : `${BASE}${path}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error((await safeErr(res)) || `Request failed (${res.status})`);
  return res.json();
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `Request failed (${res.status})`);
  return res.json();
}

async function safeErr(res: Response): Promise<string | null> {
  try {
    const data = await res.json();
    return data?.error ?? null;
  } catch {
    return null;
  }
}

// ── Types (mirror the server response shapes) ────────────────────────────────

export interface OverviewSummary {
  totalTeamsChecked: number;
  cleanLineups: number;
  needsReview: number;
  emptyStarterSlots: number;
  byeStarters: number;
  inactiveStarters: number;
  suspiciousBenchings: number;
  averageIntegrityScore: number;
  highTankingRiskTeams: number;
  openAlerts: number;
}

export interface LineupCheck {
  id: number;
  rosterId: number;
  ownerId: string | null;
  managerName: string | null;
  teamName: string | null;
  lineupIntegrityScore: number;
  tankingRiskScore: number;
  riskLabel: string;
  emptyStarterSlots: number;
  byeStarters: number;
  inactiveStarters: number;
  irStarters: number;
  doubtfulStarters: number;
  suspiciousBenchings: number;
  optimalityGap: number;
  optimalityGapPct: number;
  projectedStarterPoints: number;
  projectedOptimalPoints: number;
  reviewStatus: string;
  flags: string[];
}

export interface LineupAlert {
  id: number;
  week: number;
  rosterId: number;
  lineupCheckId: number | null;
  alertType: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction: string | null;
  status: string;
  notes: string | null;
}

export interface PlayerCheckView {
  playerId: string;
  playerName: string | null;
  position: string | null;
  team: string | null;
  lineupSlot: string | null;
  isStarter: boolean;
  isBench: boolean;
  injuryStatus: string | null;
  isOnBye: boolean;
  isInactive: boolean;
  isIr: boolean;
  isDoubtful: boolean;
  projection: number;
  playerValue: number;
  betterBenchOption: boolean;
  betterBenchPlayerName: string | null;
  valueGapVsBench: number;
  projectionGapVsBench: number;
  flags: string[];
}

export interface CheckDetail {
  check: LineupCheck;
  starters: PlayerCheckView[];
  bench: PlayerCheckView[];
  suspiciousBenchings: PlayerCheckView[];
  alerts: LineupAlert[];
  copyMessages: Record<string, string>;
}

export interface ManagerHistoryRow {
  rosterId: number;
  managerName: string;
  teamName: string;
  totalChecks: number;
  averageIntegrityScore: number;
  emptyStarterCount: number;
  byeStarterCount: number;
  inactiveStarterCount: number;
  suspiciousBenchingCount: number;
  strikes: number;
  weeksWithIssues: number[];
  worstWeek: { week: number; integrityScore: number } | null;
}

export interface StrikeRow {
  id: number;
  rosterId: number;
  managerName: string | null;
  teamName: string | null;
  strikeType: string;
  severity: string;
  reason: string;
  week: number;
  status: string;
  commissionerNotes: string | null;
  createdAt: string | null;
}

export interface LineupIntegritySettings {
  enableEmptySlotChecks: boolean;
  enableByeStarterChecks: boolean;
  enableInactiveStarterChecks: boolean;
  enableSuspiciousBenchingChecks: boolean;
  enableTankingRiskChecks: boolean;
  suspiciousBenchingValueGap: number;
  suspiciousBenchingProjectionGap: number;
  optimalityGapWarning: number;
  optimalityGapCritical: number;
  repeatIssueWeeks: number;
  strikeAfterRepeatIssues: number;
  playoffIntegrityStartWeek: number;
  ignoreLineupChecksInOffseason: boolean;
  ignoreLineupChecksForBestBall: boolean;
  autoCreateAlerts: boolean;
  autoCreateStrikes: boolean;
}

// ── API ──────────────────────────────────────────────────────────────────────

export const lineupIntegrityApi = {
  refresh: (leagueId: string, weeks?: number[]) =>
    send<{ success: boolean; skipped?: boolean; reason?: string; weeksScanned: number[]; lineupsChecked: number; alertsCreated: number; criticalAlerts: number }>(
      "POST", "/refresh", { leagueId, weeks },
    ),

  overview: (leagueId: string, week?: number) =>
    get<{ week: number; summary: OverviewSummary; topAlerts: LineupAlert[]; highestRiskTeams: LineupCheck[] }>(
      "/overview", { leagueId, week },
    ),

  checks: (leagueId: string, opts?: { week?: number; flag?: string; reviewStatus?: string; riskLabel?: string }) =>
    get<{ week: number; checks: LineupCheck[] }>("/checks", { leagueId, ...opts }),

  checkDetail: (checkId: number) => get<CheckDetail>(`/checks/${checkId}`),

  alerts: (leagueId: string, opts?: { status?: string; week?: number; alertType?: string }) =>
    get<{ alerts: LineupAlert[] }>("/alerts", { leagueId, ...opts }),

  updateAlert: (alertId: number, patch: { status?: string; notes?: string }) =>
    send<{ success: boolean }>("PATCH", `/alerts/${alertId}`, patch),

  issueStrike: (body: {
    leagueId: string;
    week: number;
    rosterId: number;
    ownerId?: string | null;
    managerName?: string | null;
    teamName?: string | null;
    strikeType: string;
    severity: string;
    reason: string;
    commissionerNotes?: string;
  }) => send<{ success: boolean; strikeId: number }>("POST", "/strikes", body),

  strikes: (leagueId: string) => get<{ strikes: StrikeRow[] }>("/strikes", { leagueId }),

  updateStrike: (strikeId: number, patch: { status?: string; commissionerNotes?: string }) =>
    send<{ success: boolean }>("PATCH", `/strikes/${strikeId}`, patch),

  managerHistory: (leagueId: string) =>
    get<{ managers: ManagerHistoryRow[] }>("/manager-history", { leagueId }),

  report: (leagueId: string, week?: number) =>
    get<{ week: number; copyText: string }>("/report", { leagueId, week }),

  multiLeague: (leagueIds: string[]) =>
    get<{ leagues: Array<{ leagueId: string; week: number | null; averageIntegrity: number | null; needsReview: number; criticalIssues: number; tankingSignals: number; openAlerts: number }> }>(
      "/multi-league", { leagueIds: leagueIds.join(",") },
    ),

  settings: (leagueId: string) =>
    get<{ settings: LineupIntegritySettings; policyText: string }>("/settings", { leagueId }),

  updateSettings: (leagueId: string, patch: Partial<LineupIntegritySettings>) =>
    send<{ success: boolean; settings: LineupIntegritySettings }>("PATCH", `/settings?leagueId=${encodeURIComponent(leagueId)}`, patch),
};
