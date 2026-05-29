import { useState, useCallback, useEffect } from "react";
import { API_BASE } from "@/lib/apiBase";

/**
 * Admin panel: Unified Crawler (trades + drafts).
 *
 * The "Passive User Crawls" table only tracks DRAFT counters per user-connect.
 * Trades are gathered by the unified scheduled crawler and recorded in
 * unified_crawl_runs — which this panel surfaces (GET
 * /api/admin/unified-crawl/status), including trades-added and DB-wide totals.
 *
 * Also flags the silent-failure case: the scheduler only auto-runs when
 * ENABLE_CRAWLER=true in the deployment env. If it's off (or the last run is
 * stale), this panel says so loudly.
 *
 * Auth mirrors the other admin panels (DC bearer token; optional ADMIN_SECRET).
 * Visibility is gated by the caller (isServerAdmin).
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

interface Run {
  id: number;
  status: string;
  seedUsername: string | null;
  leagueCapTarget: number;
  leaguesDiscovered: number;
  leaguesScanned: number;
  tradesInserted: number;
  draftsIngested: number;
  membersDiscovered: number;
  message: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface StatusResponse {
  running: boolean;
  schedulerEnabled: boolean;
  totals: {
    totalTrades: number;
    totalDrafts: number;
    addedLast30Runs: { trades: number; drafts: number; leaguesScanned: number };
    lastRunAt: string | null;
  };
  runs: Run[];
}

const fmtNum = (n: number) => (n ?? 0).toLocaleString();

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function ageHours(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

const STATUS_COLOR: Record<string, string> = {
  complete: "text-emerald-500",
  running: "text-sky-500",
  failed: "text-red-500",
  skipped: "text-muted-foreground",
};

export function UnifiedCrawlerPanel() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [secretOverride, setSecretOverride] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/unified-crawl/status`, {
        headers: buildAdminHeaders(secretOverride),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text();
        let msg = body;
        try { msg = JSON.parse(body)?.error ?? JSON.parse(body)?.reason ?? body; } catch { /* keep raw */ }
        throw new Error(res.status === 403 ? `Admin authorization failed: ${msg}` : `${res.status}: ${msg}`);
      }
      setData(await res.json());
      setState("success");
    } catch (err: any) {
      setError(err?.message || "Failed to load crawler status");
      setState("error");
    }
  }, [secretOverride]);

  useEffect(() => { void load(); }, [load]);

  const runOnce = useCallback(async () => {
    setTriggering(true);
    setNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/unified-crawl/run-once`, {
        method: "POST",
        headers: buildAdminHeaders(secretOverride),
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `${res.status}`);
      setNotice(
        body.started
          ? "Crawl started — a full run takes several minutes. Refresh to watch progress."
          : `Not started: ${body.reason ?? "unknown"}.`,
      );
    } catch (err: any) {
      setError(`Run failed: ${err?.message || "unknown"}`);
    } finally {
      setTriggering(false);
    }
  }, [secretOverride]);

  const totals = data?.totals;
  const lastAge = ageHours(totals?.lastRunAt ?? null);
  // "Stale" = scheduler claims to be enabled but nothing has run in >2h (runs
  // are scheduled every 30–60m, so >2h means it's wedged or actually off).
  const stale = data?.schedulerEnabled && lastAge != null && lastAge > 2;
  const disabled = data && !data.schedulerEnabled;
  // Zombie runs: status "running" but started long ago. A real run finishes in
  // minutes; a "running" row older than 1h means the process died mid-run and
  // the row was never reconciled to complete/failed.
  const stuckRuns = (data?.runs ?? []).filter(
    (r) => r.status === "running" && !data?.running && (ageHours(r.startedAt) ?? 0) > 1,
  );

  return (
    <section className="mt-8 border border-amber-500/30 bg-amber-500/5 rounded-lg p-4 md:p-5 text-sm">
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <h3 className="text-base font-bold text-amber-500 dark:text-amber-400">
          Unified Crawler
          <span className="text-[10px] uppercase tracking-wider opacity-70 ml-2">trades + drafts</span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={state === "loading"}
            className="px-3 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-[12px] font-semibold disabled:opacity-50"
            data-testid="unified-crawl-refresh"
          >
            {state === "loading" ? "Loading…" : "Refresh"}
          </button>
          <button
            onClick={runOnce}
            disabled={triggering || data?.running}
            className="px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-[12px] font-semibold disabled:opacity-50"
            data-testid="unified-crawl-run-once"
          >
            {data?.running ? "Running…" : triggering ? "Starting…" : "Run once"}
          </button>
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground mb-3">
        Trades aren&apos;t tracked in the per-user Passive Crawls table — they&apos;re gathered here.
      </p>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-[12px] text-red-500">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 px-3 py-2 rounded-md border border-sky-500/30 bg-sky-500/10 text-[12px] text-sky-500">
          {notice}
        </div>
      )}

      {disabled && (
        <div className="mb-3 px-3 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-[12px] text-red-500" data-testid="unified-crawl-disabled">
          ⚠️ Auto-crawling is <strong>disabled</strong> — the scheduler only runs when
          {" "}<code className="font-mono">ENABLE_CRAWLER=true</code> is set in this deployment&apos;s secrets.
          No new trades or drafts are being gathered automatically. Use “Run once” to crawl manually, or set the env var and redeploy.
        </div>
      )}
      {stale && (
        <div className="mb-3 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-[12px] text-amber-600 dark:text-amber-400" data-testid="unified-crawl-stale">
          ⚠️ Scheduler is enabled but the last run was {Math.round(lastAge!)}h ago (expected every 30–60m). It may be wedged — check deployment logs.
        </div>
      )}
      {stuckRuns.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-[12px] text-red-500" data-testid="unified-crawl-stuck">
          ⚠️ {stuckRuns.length} run{stuckRuns.length === 1 ? "" : "s"} stuck in “running” (started over an hour ago, no longer active).
          These died mid-run — the process restarted before they finished, so 0 trades/drafts were credited. Each discovered leagues but never scanned them.
        </div>
      )}

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <Stat label="Trades in DB" value={fmtNum(totals.totalTrades)} accent />
          <Stat label="Drafts in DB" value={fmtNum(totals.totalDrafts)} accent />
          <Stat label="Trades added (recent runs)" value={`+${fmtNum(totals.addedLast30Runs.trades)}`} />
          <Stat label="Drafts added (recent runs)" value={`+${fmtNum(totals.addedLast30Runs.drafts)}`} />
        </div>
      )}

      {data?.runs && data.runs.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-muted/50 text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Started</th>
                <th className="px-2 py-1.5 font-semibold">Status</th>
                <th className="px-2 py-1.5 font-semibold">Seed</th>
                <th className="px-2 py-1.5 font-semibold text-right">Leagues scanned</th>
                <th className="px-2 py-1.5 font-semibold text-right">Trades +</th>
                <th className="px-2 py-1.5 font-semibold text-right">Drafts +</th>
                <th className="px-2 py-1.5 font-semibold text-right">New members</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtWhen(r.startedAt)}</td>
                  <td className={`px-2 py-1.5 font-medium ${STATUS_COLOR[r.status] ?? "text-foreground"}`}>{r.status}</td>
                  <td className="px-2 py-1.5">{r.seedUsername ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(r.leaguesScanned)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(r.tradesInserted)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(r.draftsIngested)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(r.membersDiscovered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : state === "success" ? (
        <div className="text-[12px] text-muted-foreground py-4">
          No crawl runs recorded yet.
        </div>
      ) : null}

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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${accent ? "text-amber-500 dark:text-amber-400" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
