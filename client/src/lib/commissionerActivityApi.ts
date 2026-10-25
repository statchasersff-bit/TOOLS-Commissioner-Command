/**
 * Client for the League Activity Monitoring API (Commissioner Command).
 * Mirrors server/services/commissionerActivity/types.ts. All requests are
 * same-origin (credentials included) and prefixed with API_BASE.
 */
import { API_BASE } from "@/lib/apiBase";

export type ActivityLabel =
  | "highly_active" | "active" | "quiet" | "inactive_risk" | "inactive" | "unknown";
export type LeagueActivityLabel =
  | "thriving" | "healthy" | "average" | "low_activity" | "at_risk" | "unknown";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export interface OverviewSnapshot {
  leagueActivityScore: number;
  leagueActivityLabel: LeagueActivityLabel;
  totalTransactions: number;
  totalTrades: number;
  totalWaivers: number;
  totalFreeAgentMoves: number;
  totalLineupChanges: number;
  totalEmptyStarterSlots: number;
  activeManagerCount: number;
  inactiveManagerCount: number;
  week: number;
  season: string;
}

export interface ManagerRow {
  id: number;
  rosterId: number;
  ownerId: string | null;
  managerName: string | null;
  teamName: string | null;
  transactionsCount: number;
  tradesCount: number;
  waiverCount: number;
  freeAgentCount: number;
  addsCount: number;
  dropsCount: number;
  lineupChanged: boolean;
  lineupChangeCount: number;
  emptyStarterSlots: number;
  lastTransactionTs: number | null;
  lastLineupChangeTs: number | null;
  weeksSinceTransaction: number | null;
  weeksSinceLineupChange: number | null;
  activityScore: number;
  inactivityRiskScore: number;
  activityLabel: ActivityLabel;
  flags: string[];
  week: number;
  season: string;
}

export interface ActivityEventRow {
  id: number;
  rosterId: number | null;
  ownerId: string | null;
  eventType: string;
  eventTitle: string;
  eventDescription: string | null;
  transactionId: string | null;
  relatedPlayerIds: string[];
  relatedRosterIds: number[];
  eventTs: number | null;
  severity: Severity;
  week: number;
  season: string;
}

export interface AlertRow {
  id: number;
  leagueId: string;
  season: string;
  week: number | null;
  rosterId: number | null;
  ownerId: string | null;
  alertType: string;
  severity: Severity;
  title: string;
  description: string;
  status: AlertStatus;
  notes: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  managerName?: string | null;
  teamName?: string | null;
}

export interface ActivitySettings {
  inactiveTransactionWeeks: number;
  inactiveLineupWeeks: number;
  unchangedLineupWeeks: number;
  flagEmptyStarters: boolean;
  flagNoTransactions: boolean;
  flagUnchangedLineups: boolean;
  flagLowLeagueActivity: boolean;
  lowActivityScoreThreshold: number;
  inactiveManagerScoreThreshold: number;
  ignoreLineupChecksInOffseason: boolean;
  ignoreLineupChecksForBestBall: boolean;
  includeTradesInActivityScore: boolean;
  includeWaiversInActivityScore: boolean;
  includeFreeAgentMovesInActivityScore: boolean;
}

export interface OverviewResponse {
  season: string;
  week: number | null;
  snapshot: OverviewSnapshot | null;
  openAlertCount: number;
  topAlerts: AlertRow[];
  mostActiveManagers: ManagerRow[];
  leastActiveManagers: ManagerRow[];
}

export interface RefreshResult {
  success: boolean;
  leagueId: string;
  season: string;
  weeksScanned: number[];
  managerRowsUpdated: number;
  eventsCreated: number;
  alertsCreated: number;
}

export interface MultiLeagueRow {
  leagueId: string;
  hasData: boolean;
  week: number | null;
  leagueActivityScore: number | null;
  leagueActivityLabel: LeagueActivityLabel;
  activeManagerCount: number | null;
  inactiveManagerCount: number | null;
  totalTransactions: number | null;
  totalEmptyStarterSlots: number | null;
  openAlerts: number;
  lastScan: string | null;
}

export interface ReminderTemplate {
  tone: "soft" | "empty_starter" | "inactivity" | "stronger";
  text: string;
}

const BASE = `${API_BASE}/api/commissioner/activity`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  return res.json() as Promise<T>;
}

async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function refreshActivity(body: {
  leagueId: string;
  weeks?: number[];
  mode?: "recent" | "season";
  forceRefresh?: boolean;
}): Promise<RefreshResult> {
  return sendJson<RefreshResult>("POST", `${BASE}/refresh`, body);
}

export function fetchOverview(leagueId: string, week?: number): Promise<OverviewResponse> {
  return getJson<OverviewResponse>(`${BASE}/overview${qs({ leagueId, week })}`);
}

export function fetchManagers(leagueId: string, week?: number): Promise<{ season: string; week: number | null; managers: ManagerRow[] }> {
  return getJson(`${BASE}/managers${qs({ leagueId, week })}`);
}

export function fetchFeed(
  leagueId: string,
  opts: { week?: number; allWeeks?: boolean; eventType?: string; rosterId?: number; severity?: string } = {},
): Promise<{ season: string; week: number | null; events: ActivityEventRow[] }> {
  return getJson(
    `${BASE}/feed${qs({
      leagueId,
      week: opts.week,
      allWeeks: opts.allWeeks ? 1 : undefined,
      eventType: opts.eventType,
      rosterId: opts.rosterId,
      severity: opts.severity,
    })}`,
  );
}

export function fetchAlerts(leagueId: string, status?: string): Promise<{ alerts: AlertRow[] }> {
  return getJson(`${BASE}/alerts${qs({ leagueId, status })}`);
}

export function updateAlert(alertId: number, body: { status: AlertStatus; notes?: string }): Promise<{ alert: AlertRow }> {
  return sendJson("PATCH", `${BASE}/alerts/${alertId}`, body);
}

export function fetchReport(leagueId: string, week?: number): Promise<{ season: string; week: number | null; copyText: string }> {
  return getJson(`${BASE}/report${qs({ leagueId, week })}`);
}

export function fetchReminders(leagueId: string, rosterId?: number, week?: number): Promise<{ rosterId: number | null; managerName: string; week: number | null; templates: ReminderTemplate[] }> {
  return getJson(`${BASE}/reminders${qs({ leagueId, rosterId, week })}`);
}

export function fetchSettings(leagueId: string): Promise<{ leagueId: string; settings: ActivitySettings }> {
  return getJson(`${BASE}/settings${qs({ leagueId })}`);
}

export function updateSettings(leagueId: string, patch: Partial<ActivitySettings>): Promise<{ leagueId: string; settings: ActivitySettings }> {
  return sendJson("PATCH", `${BASE}/settings${qs({ leagueId })}`, patch);
}

export function fetchMultiOverview(leagueIds: string[]): Promise<{ season: string; leagues: MultiLeagueRow[] }> {
  return getJson(`${BASE}/multi-overview${qs({ leagueIds: leagueIds.join(",") })}`);
}

// ── Display helpers (mirror server label maps) ───────────────────────────────

export const ACTIVITY_LABEL_DISPLAY: Record<ActivityLabel, string> = {
  highly_active: "Highly Active",
  active: "Active",
  quiet: "Quiet",
  inactive_risk: "Inactive Risk",
  inactive: "Inactive",
  unknown: "Unknown",
};

export const LEAGUE_LABEL_DISPLAY: Record<LeagueActivityLabel, string> = {
  thriving: "Thriving",
  healthy: "Healthy",
  average: "Average",
  low_activity: "Low Activity",
  at_risk: "At Risk",
  unknown: "Unknown",
};

export const FLAG_DISPLAY: Record<string, string> = {
  no_recent_transactions: "No Recent Moves",
  low_activity_score: "Low Activity",
  high_inactivity_risk: "Follow-Up Recommended",
  possible_orphan_risk: "Orphan Risk",
};

export function activityLabelColor(label: ActivityLabel): string {
  switch (label) {
    case "highly_active": return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
    case "active": return "text-green-400 border-green-500/40 bg-green-500/10";
    case "quiet": return "text-amber-400 border-amber-500/40 bg-amber-500/10";
    case "inactive_risk": return "text-orange-400 border-orange-500/40 bg-orange-500/10";
    case "inactive": return "text-red-400 border-red-500/40 bg-red-500/10";
    default: return "text-muted-foreground border-border bg-muted/30";
  }
}

// Tier a 0–100 activity score into green / yellow / red so score values read at a
// glance. Thresholds: green ≥70, yellow 40–69, red <40. Kept in one place so the
// All-League Scan and single-league Activity tabs stay consistent.
export function scoreTextColor(score: number): string {
  if (score >= 70) return "text-emerald-600 dark-any:text-emerald-400";
  if (score >= 40) return "text-amber-500 dark-any:text-amber-400";
  return "text-red-600 dark-any:text-red-400";
}

export function leagueLabelColor(label: LeagueActivityLabel): string {
  switch (label) {
    case "thriving": return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
    case "healthy": return "text-green-400 border-green-500/40 bg-green-500/10";
    case "average": return "text-amber-400 border-amber-500/40 bg-amber-500/10";
    case "low_activity": return "text-orange-400 border-orange-500/40 bg-orange-500/10";
    case "at_risk": return "text-red-400 border-red-500/40 bg-red-500/10";
    default: return "text-muted-foreground border-border bg-muted/30";
  }
}

export function severityColor(sev: Severity): string {
  switch (sev) {
    case "critical": return "text-red-400 border-red-500/40 bg-red-500/10";
    case "high": return "text-orange-400 border-orange-500/40 bg-orange-500/10";
    case "medium": return "text-amber-400 border-amber-500/40 bg-amber-500/10";
    case "low": return "text-sky-400 border-sky-500/40 bg-sky-500/10";
    default: return "text-muted-foreground border-border bg-muted/30";
  }
}

export function riskLabel(score: number): { text: string; color: string } {
  if (score >= 75) return { text: "Critical", color: "text-red-400 border-red-500/40 bg-red-500/10" };
  if (score >= 50) return { text: "High", color: "text-orange-400 border-orange-500/40 bg-orange-500/10" };
  if (score >= 25) return { text: "Medium", color: "text-amber-400 border-amber-500/40 bg-amber-500/10" };
  return { text: "Low", color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" };
}
