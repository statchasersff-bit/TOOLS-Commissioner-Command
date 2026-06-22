/**
 * Typed client for the League Profile API (/api/commissioner/{bylaws,log,
 * pick-notes,pick-movement}). Plain fetch + credentials, matching the rest of
 * the app. Documentation/decision-support only — nothing here touches Sleeper.
 */
import { API_BASE } from "./apiBase";
import type { StrikeRow } from "./lineupIntegrityApi";

const BASE = `${API_BASE}/api/commissioner`;

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
  try { return (await res.json())?.error ?? null; } catch { return null; }
}

// ── Rulebook / Bylaws ─────────────────────────────────────────────────────────
export interface BylawNote { id: string; text: string; author?: string; createdAt: string; }
export interface BylawSection {
  sectionId: string;
  key: string;
  title: string;
  body: string;
  pinned?: boolean;
  order: number;
  notes?: BylawNote[];
}
export interface BylawVersion {
  version: number;
  sections: BylawSection[];
  savedBy?: string;
  savedAt: string;
  note?: string;
}

export const rulebookApi = {
  get: (leagueId: string) =>
    get<{ leagueId: string; currentVersion: number; sections: BylawSection[] }>("/bylaws", { leagueId }),
  save: (leagueId: string, sections: BylawSection[], note?: string) =>
    send<{ success: boolean; currentVersion: number }>("PUT", "/bylaws", { leagueId, sections, note }),
  history: (leagueId: string) =>
    get<{ versions: BylawVersion[] }>("/bylaws/history", { leagueId }),
  patchSection: (leagueId: string, sectionId: string, patch: Partial<BylawSection>) =>
    send<{ success: boolean }>("PATCH", "/bylaws/section", { leagueId, sectionId, patch }),
};

// ── Commissioner Log ──────────────────────────────────────────────────────────
export type LogCategory =
  | "lineup_strike" | "payment_issue" | "inactivity_flag" | "trade_concern"
  | "tanking_concern" | "behavior_issue" | "rule_violation" | "warning" | "manual_note";
export type LogSeverity = "info" | "warning" | "strike" | "serious" | "removal_risk";
export type LogStatus = "open" | "watching" | "resolved" | "escalated";

export interface CommissionerLogEntry {
  id: number;
  leagueId: string;
  season: string;
  rosterId: number | null;
  ownerId: string | null;
  managerName: string | null;
  teamName: string | null;
  category: LogCategory;
  severity: LogSeverity;
  status: LogStatus;
  linkedRuleSectionId: string | null;
  note: string | null;
  resolution: string | null;
  evidenceUrl: string | null;
  activityRef: string | null;
  commissionerUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Unified shape for the Log view — manual entries plus system strikes. */
export interface LogEntry {
  source: "log" | "strike";
  id: string;            // namespaced: "log:12" / "strike:5"
  rosterId: number | null;
  managerName: string | null;
  teamName: string | null;
  category: string;      // LogCategory, or "lineup_strike" for strikes
  severity: string;
  status: string;
  note: string | null;
  resolution?: string | null;
  linkedRuleSectionId?: string | null;
  week?: number | null;
  createdAt: string | null;
}

export const commissionerLogApi = {
  list: (params: { leagueId: string; season?: string; status?: LogStatus; category?: LogCategory }) =>
    get<{ entries: CommissionerLogEntry[] }>("/log", params),
  create: (entry: Partial<CommissionerLogEntry> & { leagueId: string; category: LogCategory }) =>
    send<{ entry: CommissionerLogEntry }>("POST", "/log", entry),
  update: (id: number, patch: Partial<Pick<CommissionerLogEntry, "status" | "severity" | "note" | "resolution" | "evidenceUrl" | "linkedRuleSectionId">>) =>
    send<{ success: boolean }>("PATCH", `/log/${id}`, patch),
};

/** Normalize a manual log entry into the unified LogEntry view shape. */
export function logEntryFromCommissionerLog(e: CommissionerLogEntry): LogEntry {
  return {
    source: "log",
    id: `log:${e.id}`,
    rosterId: e.rosterId,
    managerName: e.managerName,
    teamName: e.teamName,
    category: e.category,
    severity: e.severity,
    status: e.status,
    note: e.note,
    resolution: e.resolution,
    linkedRuleSectionId: e.linkedRuleSectionId,
    createdAt: e.createdAt,
  };
}

/** Map a lineup strike's active/overturned/resolved status onto log statuses. */
function strikeStatusToLog(status: string): string {
  if (status === "overturned" || status === "expired") return "resolved";
  if (status === "resolved") return "resolved";
  return "open";
}

/** Merge manual log entries with system strikes into one date-sorted feed. */
export function mergeWithStrikes(entries: CommissionerLogEntry[], strikes: StrikeRow[]): LogEntry[] {
  const fromLog = entries.map(logEntryFromCommissionerLog);
  const fromStrikes: LogEntry[] = strikes.map((s) => ({
    source: "strike",
    id: `strike:${s.id}`,
    rosterId: s.rosterId,
    managerName: s.managerName,
    teamName: s.teamName,
    category: "lineup_strike",
    severity: s.severity === "critical" ? "serious" : s.severity === "high" ? "strike" : "warning",
    status: strikeStatusToLog(s.status),
    note: s.reason || s.commissionerNotes,
    week: s.week,
    createdAt: s.createdAt,
  }));
  return [...fromLog, ...fromStrikes].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
  });
}

// ── Draft pick notes / movement ───────────────────────────────────────────────
export interface PickNote {
  id: number;
  leagueId: string;
  pickSeason: string;
  round: number;
  originalRosterId: number;
  note: string | null;
  protection: string | null;
  updatedAt: string | null;
}

export interface PickMovement {
  id: number;
  tradeId: number;
  pickSeason: string | null;
  pickRound: number | null;
  pickOriginalRosterId: number | null;
  fromRosterId: number | null;
  toRosterId: number | null;
  assetValue: string | null;
}

export const pickNotesApi = {
  list: (leagueId: string) => get<{ notes: PickNote[] }>("/pick-notes", { leagueId }),
  upsert: (note: { leagueId: string; pickSeason: string; round: number; originalRosterId: number; note?: string; protection?: string }) =>
    send<{ success: boolean }>("PUT", "/pick-notes", note),
  movement: (leagueId: string) => get<{ movements: PickMovement[] }>("/pick-movement", { leagueId }),
};
