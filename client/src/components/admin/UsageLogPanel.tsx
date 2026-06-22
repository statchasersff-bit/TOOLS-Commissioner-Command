import { useState, useCallback, useEffect } from "react";
import { API_BASE } from "@/lib/apiBase";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableTh } from "@/components/SortableTh";

/**
 * Admin panel: per-user usage log (page views + session duration + Sleeper
 * connection). Reads GET /api/admin/analytics. Authorization mirrors
 * AdpCrawlPanel — the DC session JWT (`sc_auth_token`) is sent as a Bearer
 * token; backend admins (email in shared/admin.ts) authorize automatically.
 * An optional ADMIN_SECRET override is exposed for non-DC contexts.
 *
 * Visibility is gated by the caller (isServerAdmin) — this component does not
 * render the gate itself.
 */

const SC_TOKEN_KEY = "sc_auth_token";

function getDcToken(): string | null {
  try { return localStorage.getItem(SC_TOKEN_KEY); } catch { return null; }
}

function buildAdminHeaders(secretOverride: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (secretOverride) headers["x-admin-secret"] = secretOverride;
  const dcToken = getDcToken();
  if (dcToken) headers["Authorization"] = `Bearer ${dcToken}`;
  return headers;
}

interface TopPage { path: string; views: number; }
interface UserRow {
  identity: string;
  sleeperUsername: string | null;
  sleeperUserId: string | null;
  accountEmail: string | null;
  connectedToken: boolean;
  sessions: number;
  totalDurationSec: number;
  pageviews: number;
  firstSeen: string | null;
  lastSeen: string | null;
  topPages: TopPage[];
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 1) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function UsageLogPanel() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [secretOverride, setSecretOverride] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { sorted, sortKey, sortDir, toggle } = useSortableTable(rows, {
    identity: (r) => r.identity,
    sleeper: (r) => r.sleeperUsername,
    token: (r) => (r.connectedToken ? 1 : 0),
    sessions: (r) => r.sessions,
    time: (r) => r.totalDurationSec,
    views: (r) => r.pageviews,
    lastSeen: (r) => r.lastSeen,
  });

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/analytics?limit=1000`, {
        headers: buildAdminHeaders(secretOverride),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text();
        let msg = body;
        try { msg = JSON.parse(body)?.error ?? body; } catch { /* keep raw */ }
        throw new Error(res.status === 403 ? `Admin authorization failed: ${msg}` : `${res.status}: ${msg}`);
      }
      const data = await res.json();
      setRows(data.users ?? []);
      setState("success");
    } catch (err: any) {
      setError(err?.message || "Failed to load usage log");
      setState("error");
    }
  }, [secretOverride]);

  // Auto-load on mount.
  useEffect(() => { void load(); }, [load]);

  // CSV download goes through fetch (rather than a bare link) so the admin
  // auth header rides along, then saves the blob client-side.
  const downloadCsv = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/analytics?limit=2000&format=csv`, {
        headers: buildAdminHeaders(secretOverride),
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "usage-log.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(`CSV export failed: ${err?.message || "unknown"}`);
    }
  }, [secretOverride]);

  return (
    <section className="mt-8 border border-amber-500/30 bg-amber-500/5 rounded-lg p-4 md:p-5 text-sm">
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <h3 className="text-base font-bold text-amber-500 dark:text-amber-400">
          Usage Log
          <span className="text-[10px] uppercase tracking-wider opacity-70 ml-2">admin tools</span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={state === "loading"}
            className="px-3 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-[12px] font-semibold disabled:opacity-50"
            data-testid="usage-log-refresh"
          >
            {state === "loading" ? "Loading…" : "Refresh"}
          </button>
          <button
            onClick={downloadCsv}
            disabled={!rows.length}
            className="px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-[12px] font-semibold disabled:opacity-50"
            data-testid="usage-log-csv"
          >
            Export CSV
          </button>
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground mb-3">
        Everyone who used the tool: time on site, pages viewed, and whether they connected Sleeper.
        Page views &amp; duration are tracked going forward only.
      </p>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-[12px] text-red-500">
          {error}
        </div>
      )}

      {state === "success" && rows.length === 0 && (
        <div className="text-[12px] text-muted-foreground py-4">
          No sessions recorded yet. Data accrues as visitors use the tool after this deploys.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-muted/50 text-left text-muted-foreground">
                <SortableTh sortKey="identity" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="px-2 py-1.5 font-semibold">User</SortableTh>
                <SortableTh sortKey="sleeper" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="px-2 py-1.5 font-semibold">Sleeper</SortableTh>
                <SortableTh sortKey="token" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-2 py-1.5 font-semibold text-center">Token</SortableTh>
                <SortableTh sortKey="sessions" activeKey={sortKey} dir={sortDir} onSort={toggle} align="right" className="px-2 py-1.5 font-semibold text-right">Sessions</SortableTh>
                <SortableTh sortKey="time" activeKey={sortKey} dir={sortDir} onSort={toggle} align="right" className="px-2 py-1.5 font-semibold text-right">Time</SortableTh>
                <SortableTh sortKey="views" activeKey={sortKey} dir={sortDir} onSort={toggle} align="right" className="px-2 py-1.5 font-semibold text-right">Views</SortableTh>
                <SortableTh sortKey="lastSeen" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="px-2 py-1.5 font-semibold">Last seen</SortableTh>
                <th className="px-2 py-1.5 font-semibold">Pages</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const key = r.sleeperUserId || r.accountEmail || r.identity;
                const isOpen = expanded === key;
                return (
                  <tr key={key} className="border-t border-border/60 hover:bg-muted/30 align-top">
                    <td className="px-2 py-1.5">
                      <div className="font-medium text-foreground">{r.identity}</div>
                      {r.accountEmail && r.accountEmail !== r.identity && (
                        <div className="text-[10px] text-muted-foreground">{r.accountEmail}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{r.sleeperUsername ?? "—"}</td>
                    <td className="px-2 py-1.5 text-center">
                      {r.connectedToken
                        ? <span className="text-emerald-500" title="Connected a Sleeper token">✓</span>
                        : <span className="text-muted-foreground" title="Read-only / no token">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.sessions}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtDuration(r.totalDurationSec)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.pageviews}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(r.lastSeen)}</td>
                    <td className="px-2 py-1.5">
                      {r.topPages.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <button
                          className="text-amber-500 hover:underline"
                          onClick={() => setExpanded(isOpen ? null : key)}
                        >
                          {isOpen ? "hide" : `${r.topPages.length} page${r.topPages.length === 1 ? "" : "s"}`}
                        </button>
                      )}
                      {isOpen && (
                        <ul className="mt-1 space-y-0.5">
                          {r.topPages.map((p) => (
                            <li key={p.path} className="text-[11px] text-muted-foreground">
                              <span className="font-mono">{p.path}</span>
                              <span className="opacity-60"> · {p.views}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="mt-3">
        <summary className="text-[11px] cursor-pointer text-muted-foreground hover:text-foreground">
          Override with ADMIN_SECRET
        </summary>
        <input
          type="password"
          value={secretOverride}
          onChange={(e) => setSecretOverride(e.target.value)}
          placeholder="ADMIN_SECRET (optional)"
          className="mt-2 w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono"
        />
      </details>
    </section>
  );
}
