/**
 * Client for the Manager Directory API (Commissioner Command ▸ Activity ▸
 * Managers). Mirrors server/services/managerDirectory.ts. Same-origin,
 * credentials included.
 */
import { API_BASE } from "@/lib/apiBase";

export type VerificationStatus = "verified" | "unverified" | "claim_pending" | "mismatch";
export type ActivityStatus = "active" | "quiet" | "inactive" | "unknown";

export interface SharedLeague {
  leagueId: string;
  leagueName: string;
  teamName: string;
  format: string;
  status: string;
  activeFlagsCount: number;
  paymentIssuesCount: number;
  activityStatus: ActivityStatus;
  lastActivity: number | null;
}

export interface ManagerDirectoryItem {
  sleeperUserId: string;
  sleeperUsername: string;
  displayName: string;
  teamName: string;
  avatar: string | null;
  verifiedStatChasersAccount: boolean;
  verificationStatus: VerificationStatus;
  statChasersUserId: string | null;
  commissionerLeagueCount: number;
  knownSleeperLeagueCount: number | null;
  activeFlagsCount: number;
  paymentIssuesCount: number;
  activityStatus: ActivityStatus;
  lastActivity: number | null;
  sharedLeagues: SharedLeague[];
}

export interface ManagerDirectoryResponse {
  season: string;
  leagueCount: number;
  managers: ManagerDirectoryItem[];
  knownLeaguesResolved: boolean;
}

const BASE = `${API_BASE}/api/commissioner/activity`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  return res.json() as Promise<T>;
}

export function fetchManagerDirectory(leagueIds: string[]): Promise<ManagerDirectoryResponse> {
  const sp = new URLSearchParams({ leagueIds: leagueIds.join(",") });
  return getJson<ManagerDirectoryResponse>(`${BASE}/managers-directory?${sp.toString()}`);
}

// ── Display helpers ───────────────────────────────────────────────────────────

export const ACTIVITY_STATUS_DISPLAY: Record<ActivityStatus, string> = {
  active: "Active",
  quiet: "Quiet",
  inactive: "Inactive",
  unknown: "Unknown",
};

export function activityStatusColor(status: ActivityStatus): string {
  switch (status) {
    case "active": return "text-emerald-600 dark-any:text-emerald-400";
    case "quiet": return "text-amber-500 dark-any:text-amber-400";
    case "inactive": return "text-red-600 dark-any:text-red-400";
    default: return "text-[var(--sc-text-muted)] dark-any:text-white/40";
  }
}

export const VERIFICATION_DISPLAY: Record<VerificationStatus, { label: string; tooltip: string }> = {
  verified: {
    label: "Verified",
    tooltip: "Verified StatChasers account linked to this Sleeper username.",
  },
  unverified: {
    label: "Unverified",
    tooltip: "This manager has not linked their Sleeper account to StatChasers.",
  },
  claim_pending: {
    label: "Claim Pending",
    tooltip: "A StatChasers account link for this Sleeper username is pending.",
  },
  mismatch: {
    label: "Mismatch",
    tooltip:
      "This Sleeper account is linked to a StatChasers account, but the username has changed since it was linked.",
  },
};

export function lastSeenLabel(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const day = 86_400_000;
  if (diff < 3_600_000) return "Just now";
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / day);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
