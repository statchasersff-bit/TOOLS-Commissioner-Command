import { useState, useCallback } from "react";
import { API_BASE } from "@/lib/apiBase";

/**
 * Admin panel for the 2-hop ADP network crawl.
 *
 * Authorization: by default the DC session JWT in localStorage
 * (`sc_auth_token`) is sent as a Bearer token — backend admins (email in
 * shared/admin.ts) authorize automatically with no secret typed in the
 * UI. For non-DC contexts (e.g. testing from a guest browser) an optional
 * collapsible "Override with ADMIN_SECRET" field is exposed; the secret
 * stays in component memory only.
 *
 * Visibility is gated by `useAuth().isAdmin` at the mount point — this
 * component does not render the gate itself.
 */

type DraftCategory = "startup" | "rookie";
type Depth = 0 | 1 | 2;

interface CrawlResult {
  seedUser: { username: string; userId: string } | null;
  seasons: string[];
  maxDepth: number;
  usersDiscoveredByDepth: Record<number, number>;
  usersProcessed: number;
  leaguesProcessed: number;
  draftsFound: number;
  draftsIngested: number;
  picksIngested: number;
  duplicatesSkipped: number;
  errors: string[];
  capsHit: string[];
  requestCount: number;
  durationMs: number;
}

interface CrawlStatus {
  totals?: { drafts?: number; completedDrafts?: number; picks?: number; seeds?: number };
  queue?: { pending?: number; processing?: number; failed?: number; completed?: number };
  recentLog?: Array<{
    id: number;
    jobType: string;
    status: string;
    message?: string | null;
    draftsFound: number;
    draftsIngested: number;
    picksIngested: number;
    startedAt?: string;
    completedAt?: string | null;
  }>;
  workerRunning?: boolean;
}

const ALL_SEASONS = ["2026", "2025", "2024"] as const;
const SC_TOKEN_KEY = "sc_auth_token";

function getDcToken(): string | null {
  try { return localStorage.getItem(SC_TOKEN_KEY); } catch { return null; }
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function buildAdminHeaders(secretOverride: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (secretOverride) {
    headers["x-admin-secret"] = secretOverride;
  }
  const dcToken = getDcToken();
  if (dcToken) headers["Authorization"] = `Bearer ${dcToken}`;
  return headers;
}

export function AdpCrawlPanel() {
  // ── Form state ──────────────────────────────────────────────────────────
  const [seedUsername, setSeedUsername] = useState("Makitrain");
  const [seasons, setSeasons] = useState<Set<string>>(new Set(ALL_SEASONS));
  const [categories, setCategories] = useState<Set<DraftCategory>>(new Set<DraftCategory>(["startup", "rookie"]));
  const [refreshSnapshots, setRefreshSnapshots] = useState(true);
  const [maxUsers, setMaxUsers] = useState<number>(500);
  const [maxLeagues, setMaxLeagues] = useState<number>(2500);
  const [maxDrafts, setMaxDrafts] = useState<number>(1000);

  // ── Optional admin secret override (for testing as a guest) ─────────────
  const [showSecretOverride, setShowSecretOverride] = useState(false);
  const [adminSecretOverride, setAdminSecretOverride] = useState("");

  // ── Run state ───────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<CrawlResult | null>(null);
  const [error, setError] = useState<string>("");

  // ── Status state ────────────────────────────────────────────────────────
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<CrawlStatus | null>(null);

  const runCrawl = useCallback(async (depth: Depth) => {
    if (!seedUsername.trim()) { setError("Seed username required."); return; }
    if (seasons.size === 0) { setError("Pick at least one season."); return; }

    setRunning(true);
    setRunStartedAt(Date.now());
    setError("");
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/admin/adp/crawl-network`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...buildAdminHeaders(adminSecretOverride),
        },
        body: JSON.stringify({
          seedUsername: seedUsername.trim(),
          seasons: Array.from(seasons).sort().reverse(),
          maxDepth: depth,
          draftCategories: Array.from(categories),
          refreshSnapshots,
          maxUsers,
          maxLeagues,
          maxDrafts,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
      } else {
        setResult(data as CrawlResult);
      }
    } catch (err: any) {
      setError(err?.message || "Request failed");
    } finally {
      setRunning(false);
      setRunStartedAt(null);
    }
  }, [seedUsername, seasons, categories, refreshSnapshots, maxUsers, maxLeagues, maxDrafts, adminSecretOverride]);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/adp/crawl-status`, {
        credentials: "include",
        headers: buildAdminHeaders(adminSecretOverride),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
      } else {
        setStatus(data as CrawlStatus);
      }
    } catch (err: any) {
      setError(err?.message || "Status request failed");
    } finally {
      setStatusLoading(false);
    }
  }, [adminSecretOverride]);

  return (
    <div
      data-testid="adp-crawl-panel"
      className="mt-8 border border-amber-500/30 bg-amber-500/5 rounded-lg p-4 md:p-5 text-sm"
    >
      <div className="flex items-center justify-between mb-4 gap-2">
        <div>
          <h3 className="text-base font-bold text-amber-500 dark:text-amber-400">
            ADP Data Crawl
            <span className="text-[10px] uppercase tracking-wider opacity-70 ml-2">admin tools</span>
          </h3>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            2-hop public-API discovery starting from a Sleeper username.
          </p>
        </div>
        {running && <RunningBadge startedAt={runStartedAt} />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Seed username">
          <input
            type="text"
            value={seedUsername}
            onChange={e => setSeedUsername(e.target.value)}
            data-testid="input-seed-username"
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Seasons">
          <div className="flex items-center gap-2 flex-wrap py-1">
            {ALL_SEASONS.map(s => (
              <Checkbox
                key={s}
                label={s}
                checked={seasons.has(s)}
                onChange={() => setSeasons(prev => toggleInSet(prev, s))}
                testId={`checkbox-season-${s}`}
              />
            ))}
          </div>
        </Field>

        <Field label="Draft categories">
          <div className="flex items-center gap-2 flex-wrap py-1">
            <Checkbox
              label="Startup"
              checked={categories.has("startup")}
              onChange={() => setCategories(prev => toggleInSet(prev, "startup"))}
              testId="checkbox-cat-startup"
            />
            <Checkbox
              label="Rookie"
              checked={categories.has("rookie")}
              onChange={() => setCategories(prev => toggleInSet(prev, "rookie"))}
              testId="checkbox-cat-rookie"
            />
          </div>
        </Field>

        <Field label="After crawl">
          <Checkbox
            label="Refresh ADP snapshots"
            checked={refreshSnapshots}
            onChange={() => setRefreshSnapshots(v => !v)}
            testId="checkbox-refresh-snapshots"
          />
        </Field>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Safety caps</div>
        <div className="grid grid-cols-3 gap-2">
          <NumField label="maxUsers" value={maxUsers} setValue={setMaxUsers} testId="input-max-users" />
          <NumField label="maxLeagues" value={maxLeagues} setValue={setMaxLeagues} testId="input-max-leagues" />
          <NumField label="maxDrafts" value={maxDrafts} setValue={setMaxDrafts} testId="input-max-drafts" />
        </div>
      </div>

      {/* Optional secret override — for testing without a DC admin session */}
      <details className="mt-3" open={showSecretOverride} onToggle={(e) => setShowSecretOverride((e.target as HTMLDetailsElement).open)}>
        <summary className="text-[11px] cursor-pointer text-muted-foreground hover:text-foreground">
          Authorize with ADMIN_SECRET override (advanced)
        </summary>
        <div className="mt-2">
          <input
            type="password"
            value={adminSecretOverride}
            onChange={e => setAdminSecretOverride(e.target.value)}
            placeholder="x-admin-secret (sent as header for this session only)"
            autoComplete="off"
            data-testid="input-admin-secret-override"
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <RunButton
          label="Test Crawl Depth 0"
          variant="ghost"
          onClick={() => runCrawl(0)}
          disabled={running}
          testId="button-crawl-depth-0"
        />
        <RunButton
          label="Run Depth 1 Crawl"
          variant="ghost"
          onClick={() => runCrawl(1)}
          disabled={running}
          testId="button-crawl-depth-1"
        />
        <RunButton
          label="Run Full Depth 2 Crawl"
          variant="primary"
          onClick={() => runCrawl(2)}
          disabled={running}
          testId="button-crawl-depth-2"
        />
        <RunButton
          label={statusLoading ? "Loading…" : "Refresh Status"}
          variant="outline"
          onClick={refreshStatus}
          disabled={statusLoading}
          testId="button-refresh-status"
        />
      </div>

      {error && (
        <div
          data-testid="text-crawl-error"
          className="mt-3 px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-[12px] text-red-500"
        >
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 border border-border/60 rounded-md p-3 bg-background/40" data-testid="crawl-result-summary">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Last crawl result</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
            <Stat label="Seed" value={result.seedUser ? `${result.seedUser.username}` : "(unresolved)"} />
            <Stat label="Depth" value={String(result.maxDepth)} />
            <Stat label="Duration" value={`${Math.round(result.durationMs / 1000)}s`} />
            <Stat label="Requests" value={String(result.requestCount)} />
            <Stat label="Users processed" value={String(result.usersProcessed)} testId="stat-users-processed" />
            <Stat label="Leagues processed" value={String(result.leaguesProcessed)} testId="stat-leagues-processed" />
            <Stat label="Drafts found" value={String(result.draftsFound)} testId="stat-drafts-found" />
            <Stat label="Drafts ingested" value={String(result.draftsIngested)} testId="stat-drafts-ingested" />
            <Stat label="Picks ingested" value={String(result.picksIngested)} testId="stat-picks-ingested" />
            <Stat label="Dup skipped" value={String(result.duplicatesSkipped)} testId="stat-duplicates-skipped" />
            <Stat label="Caps hit" value={(result.capsHit ?? []).length === 0 ? "none" : (result.capsHit ?? []).join(", ")} testId="stat-caps-hit" />
            <Stat label="Errors" value={String((result.errors ?? []).length)} testId="stat-errors-count" />
          </div>

          {Object.keys(result.usersDiscoveredByDepth ?? {}).length > 0 && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              <span className="font-semibold mr-1">Users by depth:</span>
              {Object.entries(result.usersDiscoveredByDepth).map(([d, n]) => (
                <span key={d} className="mr-2">d{d}={n}</span>
              ))}
            </div>
          )}

          {(result.errors ?? []).length > 0 && (
            <details className="mt-2">
              <summary className="text-[11px] text-red-400 cursor-pointer">{(result.errors ?? []).length} errors</summary>
              <pre className="mt-1 text-[10px] font-mono text-red-400/80 max-h-40 overflow-auto whitespace-pre-wrap">
                {(result.errors ?? []).slice(0, 50).join("\n")}
                {(result.errors ?? []).length > 50 ? `\n…+${(result.errors ?? []).length - 50} more` : ""}
              </pre>
            </details>
          )}
        </div>
      )}

      {status && (
        <div className="mt-4 border border-border/60 rounded-md p-3 bg-background/40" data-testid="crawl-status-panel">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Crawl status
            <span className={`ml-2 text-[10px] ${status.workerRunning ? "text-emerald-500" : "text-muted-foreground/70"}`}>
              worker: {status.workerRunning ? "running" : "stopped"}
            </span>
          </div>

          {status.totals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px] mb-2">
              <Stat label="Total drafts" value={String(status.totals.drafts ?? 0)} />
              <Stat label="Completed" value={String(status.totals.completedDrafts ?? 0)} />
              <Stat label="Picks" value={String(status.totals.picks ?? 0)} />
              <Stat label="Seeds" value={String(status.totals.seeds ?? 0)} />
            </div>
          )}

          {status.queue && (
            <div className="grid grid-cols-4 gap-2 text-[12px] mb-2">
              <Stat label="Queue pending" value={String(status.queue.pending ?? 0)} />
              <Stat label="Processing" value={String(status.queue.processing ?? 0)} />
              <Stat label="Failed" value={String(status.queue.failed ?? 0)} />
              <Stat label="Completed" value={String(status.queue.completed ?? 0)} />
            </div>
          )}

          {status.recentLog && status.recentLog.length > 0 && (
            <details className="mt-2" open>
              <summary className="text-[11px] cursor-pointer text-muted-foreground">
                Recent crawl log ({status.recentLog.length})
              </summary>
              <div className="mt-1 max-h-64 overflow-auto border border-border/40 rounded">
                <table className="w-full text-[10px]">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left">
                      <th className="px-2 py-1">when</th>
                      <th className="px-2 py-1">job</th>
                      <th className="px-2 py-1">status</th>
                      <th className="px-2 py-1 text-right">found</th>
                      <th className="px-2 py-1 text-right">ingested</th>
                      <th className="px-2 py-1 text-right">picks</th>
                      <th className="px-2 py-1">message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.recentLog.map((row) => (
                      <tr key={row.id} className="border-t border-border/30">
                        <td className="px-2 py-1 whitespace-nowrap font-mono text-muted-foreground">{formatTime(row.startedAt)}</td>
                        <td className="px-2 py-1">{row.jobType}</td>
                        <td className={`px-2 py-1 font-semibold ${statusColor(row.status)}`}>{row.status}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{row.draftsFound}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{row.draftsIngested}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{row.picksIngested}</td>
                        <td className="px-2 py-1 truncate max-w-[400px]" title={row.message ?? ""}>{row.message ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground/70">
        Admin DC users authorize via session token automatically. Override secret, if entered, is held in component memory only.
      </p>
    </div>
  );
}

// ── Small subcomponents ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Checkbox({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: () => void; testId?: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[12px] cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        data-testid={testId}
        className="w-3.5 h-3.5"
      />
      <span>{label}</span>
    </label>
  );
}

function NumField({ label, value, setValue, testId }: { label: string; value: number; setValue: (n: number) => void; testId?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => {
          const n = Number(e.target.value);
          setValue(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        data-testid={testId}
        className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm tabular-nums"
      />
    </label>
  );
}

function RunButton({ label, onClick, disabled, variant, testId }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant: "primary" | "ghost" | "outline";
  testId?: string;
}) {
  const styles =
    variant === "primary" ? "bg-[#d4af37] hover:bg-[#e0bf4a] text-[#060d1a] border border-[#d4af37]" :
    variant === "ghost"   ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30" :
                            "bg-transparent hover:bg-muted/30 text-foreground border border-border";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`px-3 py-1.5 text-[12px] font-semibold rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles}`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums">{value}</div>
    </div>
  );
}

function RunningBadge({ startedAt }: { startedAt: number | null }) {
  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold text-amber-500 bg-amber-500/15 border border-amber-500/40">
      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
      Running {elapsed > 0 ? `(${elapsed}s)` : "…"}
    </span>
  );
}

function statusColor(s: string): string {
  if (s === "completed") return "text-emerald-500";
  if (s === "failed") return "text-red-500";
  if (s === "running") return "text-amber-500";
  return "text-muted-foreground";
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
