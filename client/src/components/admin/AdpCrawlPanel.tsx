import { useState, useCallback, useEffect, useRef } from "react";
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
type RunState = "idle" | "running" | "success" | "error";

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
  notCompleteSkipped?: number;
  categoryFilteredSkipped?: number;
  excludedSkipped?: number;
  errors: string[];
  capsHit: string[];
  requestCount: number;
  durationMs: number;
}

/** Live progress shape returned by the /crawl-network/progress endpoint.
 *  Superset of CrawlResult — adds phase/activity/% so the panel can render
 *  a live progress bar while the server-side crawl runs. */
interface CrawlLiveState extends CrawlResult {
  jobId: string;
  /** adp_crawl_log row id — null until the scan opens its audit row. */
  logId?: number | null;
  status: "idle" | "running" | "completed" | "failed" | "cancelled" | "partial";
  startedAt: number | null;
  completedAt: number | null;
  /** Server-side flag set by /cancel. UI uses this to grey out the Stop
   *  button while the crawl finishes the in-flight request. */
  cancelRequested?: boolean;
  seedUsername: string;
  draftCategories: string[];
  phase: "seed" | "depth" | "snapshots" | "done";
  phaseLabel: string;
  currentActivity: string;
  currentDepth: number;
  depthProgress: Array<{ depth: number; totalUsers: number; processedUsers: number }>;
  overallPct: number;
}

/** Defaults applied client-side so the payload is never sent with empty arrays. */
const DEFAULT_SEASONS = ["2026", "2025", "2024"] as const;
const DEFAULT_CATEGORIES: DraftCategory[] = ["startup", "rookie"];

/** Read the body once; try to parse JSON, otherwise return the raw text so the
 *  caller can detect HTML / Vite catch-all / empty responses and surface a
 *  clear error instead of silently degrading to `{}`. */
async function readResponse(res: Response): Promise<{ json: any | null; text: string; isHtml: boolean }> {
  const text = await res.text();
  const isHtml = /^\s*<(!doctype|html)/i.test(text);
  let json: any | null = null;
  if (!isHtml && text.trim().length > 0) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { json, text, isHtml };
}

/** Map common HTTP failure modes to readable admin-facing messages. */
function describeFailure(status: number, isHtml: boolean, json: any | null, text: string): string {
  if (isHtml) {
    return "Server returned app HTML instead of API JSON. Restart server or check route registration.";
  }
  if (status === 401 || status === 403) {
    return json?.error
      ? `Admin authorization failed: ${json.error}`
      : "Admin authorization failed. Add ADMIN_SECRET in Replit Secrets or enter override secret.";
  }
  if (status === 404) {
    return "Crawl route not registered. Restart dev server.";
  }
  if (status === 400 && json?.error) {
    return `Bad request: ${json.error}`;
  }
  if (json?.error) return `${json.error} (HTTP ${status})`;
  if (text.trim().length > 0) return `HTTP ${status}: ${text.slice(0, 240)}`;
  return `HTTP ${status}`;
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
  const [runState, setRunState] = useState<RunState>("idle");
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<CrawlResult | null>(null);
  const [error, setError] = useState<string>("");
  const [rawResponse, setRawResponse] = useState<string>("");
  // Live progress for the in-flight server-side crawl. Populated by the
  // initial POST response and refreshed every ~1.5s by the polling effect.
  const [liveProgress, setLiveProgress] = useState<CrawlLiveState | null>(null);
  const pollRef = useRef<number | null>(null);
  const running = runState === "running";

  // ── Status state ────────────────────────────────────────────────────────
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<CrawlStatus | null>(null);

  const runCrawl = useCallback(async (depth: Depth) => {
    const trimmedSeed = seedUsername.trim();
    if (!trimmedSeed) { setError("Seed username required."); setRunState("error"); return; }

    // Defensive: never POST an empty seasons/categories array — fall back to spec
    // defaults so the server sees a valid payload even if the user un-checks
    // every box.
    const seasonsPayload = seasons.size > 0
      ? Array.from(seasons).sort().reverse()
      : [...DEFAULT_SEASONS];
    const categoriesPayload = categories.size > 0
      ? Array.from(categories)
      : [...DEFAULT_CATEGORIES];

    setRunState("running");
    setRunStartedAt(Date.now());
    setError("");
    setResult(null);
    setRawResponse("");

    const payload = {
      seedUsername: trimmedSeed,
      seasons: seasonsPayload,
      maxDepth: depth,
      draftCategories: categoriesPayload,
      refreshSnapshots,
      maxUsers,
      maxLeagues,
      maxDrafts,
    };

    try {
      const res = await fetch(`${API_BASE}/api/admin/adp/crawl-network`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...buildAdminHeaders(adminSecretOverride),
        },
        body: JSON.stringify(payload),
      });

      const { json, text, isHtml } = await readResponse(res);
      setRawResponse(text.slice(0, 4000));

      if (!res.ok) {
        setError(describeFailure(res.status, isHtml, json, text));
        setRunState("error");
        return;
      }
      if (isHtml || json === null) {
        setError("Server returned a non-JSON response (likely HTML). The API route may not be registered, restart the dev server.");
        setRunState("error");
        return;
      }
      // New response shape: { jobId, state }. The crawl now runs in the
      // background on the server; we hold "running" UI state and poll the
      // /progress endpoint for live updates.
      const state = (json && typeof json === "object" && json.state) ? json.state as CrawlLiveState : null;
      if (!state || typeof state.status !== "string") {
        setError("Response did not match the expected crawl-state shape. See raw response below.");
        setRunState("error");
        return;
      }
      setLiveProgress(state);
      // The polling effect (below) will pick up "running" status and start
      // refreshing. If the server returned a state that's already terminal
      // (rare — caps tripped, snapshot-only paths), reflect that here.
      if (state.status === "completed" || state.status === "failed") {
        setResult(state);
        setRunState(state.status === "completed" ? "success" : "error");
        if (state.status === "failed") setError(state.errors[0] ?? "Crawl failed");
      }
    } catch (err: any) {
      setError(err?.message || "Request failed");
      setRunState("error");
      setRunStartedAt(null);
    }
    // NOTE: we intentionally do NOT clear runStartedAt on success here — the
    // server-side crawl is still running. The polling effect keeps the badge
    // ticking from state.startedAt, and clears it when the crawl terminates.
  }, [seedUsername, seasons, categories, refreshSnapshots, maxUsers, maxLeagues, maxDrafts, adminSecretOverride]);

  // ── Live-progress polling ───────────────────────────────────────────────
  // Single long-lived poller. Fires once on mount (so a crawl started in a
  // previous tab/component instance is picked up) and then every 1.5s while
  // the panel is mounted. All state transitions go through functional
  // setters so the closure doesn't capture stale runState. The interval
  // does NOT clear on terminal — that way clicking "Run" again immediately
  // resumes live updates without needing to re-create the effect.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/adp/crawl-network/progress`, {
          credentials: "include",
          headers: buildAdminHeaders(adminSecretOverride),
        });
        if (!res.ok) return; // 403 / 404 silent — usually means signed out
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) return;
        const state = (await res.json()) as CrawlLiveState;
        if (cancelled) return;

        setLiveProgress(state);

        if (state.status === "running") {
          setRunState((prev) => (prev === "running" ? prev : "running"));
          setRunStartedAt(state.startedAt);
        } else if (state.status === "completed") {
          setResult(state);
          setRunState((prev) => (prev === "success" ? prev : "success"));
        } else if (state.status === "cancelled") {
          // Cancelled = the user stopped the crawl. Treat it as a "success"
          // for the result panel so partial counters are surfaced; the
          // capsHit / phaseLabel already say "Cancelled" so the user knows.
          setResult(state);
          setRunState((prev) => (prev === "success" ? prev : "success"));
        } else if (state.status === "failed") {
          setResult(state);
          setRunState((prev) => (prev === "error" ? prev : "error"));
          if (state.errors.length > 0) {
            setError((prev) => prev || state.errors[state.errors.length - 1]);
          }
        }
      } catch {
        /* transient — ignore and let the next tick retry */
      }
    };

    tick();
    pollRef.current = window.setInterval(tick, 1500);

    return () => {
      cancelled = true;
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [adminSecretOverride]);

  const cancelCrawl = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/adp/crawl-network/cancel`, {
        method: "POST",
        credentials: "include",
        headers: buildAdminHeaders(adminSecretOverride),
      });
      if (!res.ok) {
        const { json, text, isHtml } = await readResponse(res);
        setError(describeFailure(res.status, isHtml, json, text));
      }
      // The /progress poller will surface the new "cancelled" status within
      // ~1.5s — no need to setRunState here. Showing "Stopping…" is handled
      // server-side via state.currentActivity.
    } catch (err: any) {
      setError(err?.message || "Cancel request failed");
    }
  }, [adminSecretOverride]);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/adp/crawl-status`, {
        credentials: "include",
        headers: buildAdminHeaders(adminSecretOverride),
      });
      const { json, text, isHtml } = await readResponse(res);
      if (!res.ok) {
        setError(describeFailure(res.status, isHtml, json, text));
        return;
      }
      if (isHtml || json === null) {
        setError("Status endpoint returned a non-JSON response.");
        return;
      }
      setStatus(json as CrawlStatus);
    } catch (err: any) {
      setError(err?.message || "Status request failed");
    } finally {
      setStatusLoading(false);
    }
  }, [adminSecretOverride]);

  const repairCrawlState = useCallback(async (dryRun: boolean) => {
    setError("");
    if (!dryRun) {
      const ok = window.confirm(
        "Reset incomplete ADP drafts?\n\n" +
        "This deletes draft rows the crawl never finished writing picks for, " +
        "so the next scan will re-ingest them cleanly. IDP-excluded and " +
        "quality-filtered drafts are left alone. Stuck 'running' scan log " +
        "rows are also flipped to 'failed'.",
      );
      if (!ok) return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/admin/adp/crawl-network/repair${dryRun ? "?dryRun=true" : ""}`,
        {
          method: "POST",
          credentials: "include",
          headers: buildAdminHeaders(adminSecretOverride),
        },
      );
      const { json, text, isHtml } = await readResponse(res);
      if (!res.ok || !json) {
        setError(describeFailure(res.status, isHtml, json, text));
        return;
      }
      const r = json.recovery ?? {};
      const d = json.drafts ?? {};
      const summary =
        `${dryRun ? "[Dry-run] " : ""}` +
        `Flagged ${r.staleScansFlagged ?? 0} stale scan logs, ` +
        `reset ${r.staleQueueItemsReset ?? 0} stuck queue items. ` +
        `Drafts inspected=${d.inspected ?? 0}, ` +
        `orphans=${d.orphansDeleted ?? 0}, partials=${d.partialsDeleted ?? 0}.`;
      // Surface via the error slot — it's the only banner the panel has.
      setError(summary);
      // Refresh status so the new counts appear.
      void refreshStatus();
    } catch (err: any) {
      setError(err?.message || "Repair request failed");
    }
  }, [adminSecretOverride, refreshStatus]);

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
        {/*
         * Recovery hatch for the "drafts in DB but not visible/usable" bug.
         * Resets any scan log row stuck in `running`, requeues stuck queue
         * items, and deletes draft rows that are status=complete but missing
         * picks (so the next scan re-ingests them cleanly).
         */}
        <RunButton
          label="Repair Crawl State (dry-run)"
          variant="ghost"
          onClick={() => repairCrawlState(true)}
          disabled={running}
          testId="button-repair-crawl-dry"
        />
        <RunButton
          label="Reset Incomplete ADP Drafts"
          variant="ghost"
          onClick={() => repairCrawlState(false)}
          disabled={running}
          testId="button-repair-crawl"
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

      {liveProgress && liveProgress.status === "running" && (
        <div
          className="mt-4 border border-amber-500/40 rounded-md p-3 bg-amber-500/5"
          data-testid="crawl-live-progress"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-500">
              Live progress
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[10px] text-muted-foreground">
                Running in background, safe to switch tabs
              </div>
              {/* Stop button — flags the server-side crawl to halt at the
                  next BFS boundary. Disabled once cancellation has already
                  been requested so the user knows the click registered. */}
              <button
                type="button"
                onClick={cancelCrawl}
                disabled={!!liveProgress.cancelRequested}
                className="px-2 py-1 rounded-md border border-red-500/40 text-[11px] font-semibold text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-cancel-crawl"
                title={liveProgress.cancelRequested ? "Stop already requested, finishing the current request." : "Stop the in-flight crawl. Partial progress is preserved."}
              >
                {liveProgress.cancelRequested ? "Stopping…" : "Stop"}
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
              <span className="font-semibold text-foreground">{liveProgress.phaseLabel || "Working…"}</span>
              <span className="tabular-nums">{liveProgress.overallPct.toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, liveProgress.overallPct))}%` }}
              />
            </div>
            {liveProgress.currentActivity && (
              <div className="mt-1.5 text-[11px] text-muted-foreground truncate" title={liveProgress.currentActivity}>
                {liveProgress.currentActivity}
              </div>
            )}
          </div>

          {/* Live counters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px] mt-3">
            <Stat label="Seed" value={liveProgress.seedUser?.username ?? liveProgress.seedUsername ?? "—"} />
            <Stat label="Elapsed" value={formatDuration(Date.now() - (liveProgress.startedAt ?? Date.now()))} />
            <Stat label="Requests" value={formatNum(liveProgress.requestCount)} />
            <Stat label="Users processed" value={formatNum(liveProgress.usersProcessed)} />
            <Stat label="Leagues processed" value={formatNum(liveProgress.leaguesProcessed)} />
            <Stat label="Drafts found" value={formatNum(liveProgress.draftsFound)} />
            <Stat label="Drafts ingested" value={formatNum(liveProgress.draftsIngested)} />
            <Stat label="Picks ingested" value={formatNum(liveProgress.picksIngested)} />
            <Stat label="Already in DB" value={formatNum(liveProgress.duplicatesSkipped)} />
            <Stat label="Not complete" value={formatNum(liveProgress.notCompleteSkipped ?? 0)} />
            <Stat label="Category filtered" value={formatNum(liveProgress.categoryFilteredSkipped ?? 0)} />
            <Stat label="Excluded" value={formatNum(liveProgress.excludedSkipped ?? 0)} />
          </div>

          {/* Skip-reason hint: if drafts are being found but none ingested,
              surface the most likely cause so the user isn't left guessing. */}
          {liveProgress.draftsFound > 0 && liveProgress.draftsIngested === 0 && (
            <div className="mt-2 text-[11px] text-amber-500/90 leading-snug">
              {(() => {
                const nc = liveProgress.notCompleteSkipped ?? 0;
                const cf = liveProgress.categoryFilteredSkipped ?? 0;
                const dup = liveProgress.duplicatesSkipped;
                const exc = liveProgress.excludedSkipped ?? 0;
                const parts: string[] = [];
                if (nc > 0) parts.push(`${nc} still in progress / pre-draft`);
                if (cf > 0) parts.push(`${cf} skipped by category filter`);
                if (dup > 0) parts.push(`${dup} already ingested`);
                if (exc > 0) parts.push(`${exc} excluded by quality gates`);
                return parts.length > 0
                  ? `Found ${liveProgress.draftsFound} drafts but ingested none: ${parts.join(", ")}.`
                  : null;
              })()}
            </div>
          )}

          {/* Per-depth progress */}
          {liveProgress.depthProgress.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Depth progress
              </div>
              {liveProgress.depthProgress.map((dp) => {
                const pct = dp.totalUsers > 0 ? (dp.processedUsers / dp.totalUsers) * 100 : 0;
                const isCurrent = dp.depth === liveProgress.currentDepth;
                return (
                  <div key={dp.depth} className={isCurrent ? "" : "opacity-60"}>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span>
                        Depth {dp.depth}{isCurrent ? " (current)" : ""}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {dp.processedUsers} / {dp.totalUsers} users
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className={`h-full ${isCurrent ? "bg-amber-500" : "bg-emerald-500/60"} transition-all duration-500`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {liveProgress.capsHit.length > 0 && (
            <div className="mt-2 text-[10px] text-amber-500/80">
              Caps hit: {liveProgress.capsHit.join(", ")}
            </div>
          )}
        </div>
      )}

      {runState === "success" && result && (
        <div className="mt-4 border border-border/60 rounded-md p-3 bg-background/40" data-testid="crawl-result-summary">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Last crawl result</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
            <Stat label="Seed" value={result.seedUser?.username ?? "—"} />
            <Stat label="Depth" value={formatNum(result.maxDepth)} />
            <Stat label="Duration" value={formatDuration(result.durationMs)} />
            <Stat label="Requests" value={formatNum(result.requestCount)} />
            <Stat label="Users processed" value={formatNum(result.usersProcessed)} testId="stat-users-processed" />
            <Stat label="Leagues processed" value={formatNum(result.leaguesProcessed)} testId="stat-leagues-processed" />
            <Stat label="Drafts found" value={formatNum(result.draftsFound)} testId="stat-drafts-found" />
            <Stat label="Drafts ingested" value={formatNum(result.draftsIngested)} testId="stat-drafts-ingested" />
            <Stat label="Picks ingested" value={formatNum(result.picksIngested)} testId="stat-picks-ingested" />
            <Stat label="Already in DB" value={formatNum(result.duplicatesSkipped)} testId="stat-duplicates-skipped" />
            <Stat label="Not complete" value={formatNum(result.notCompleteSkipped ?? 0)} testId="stat-not-complete-skipped" />
            <Stat label="Category filtered" value={formatNum(result.categoryFilteredSkipped ?? 0)} testId="stat-category-filtered" />
            <Stat label="Excluded" value={formatNum(result.excludedSkipped ?? 0)} testId="stat-excluded-skipped" />
            <Stat label="Caps hit" value={(result.capsHit ?? []).length === 0 ? "none" : (result.capsHit ?? []).join(", ")} testId="stat-caps-hit" />
            <Stat label="Errors" value={formatNum((result.errors ?? []).length)} testId="stat-errors-count" />
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

      {/* Raw response dev box — shown after any run that produced bytes. Useful
          for diagnosing HTML / empty / shape-mismatch responses. */}
      {rawResponse && (
        <details className="mt-3" data-testid="raw-response-details">
          <summary className="text-[11px] cursor-pointer text-muted-foreground hover:text-foreground">
            Raw response ({rawResponse.length} bytes)
          </summary>
          <pre className="mt-1 text-[10px] font-mono text-muted-foreground/80 max-h-60 overflow-auto whitespace-pre-wrap p-2 bg-background/40 border border-border/40 rounded">
            {rawResponse}
          </pre>
        </details>
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
              <Stat label="Total drafts" value={formatNum(status.totals.drafts ?? 0)} />
              <Stat label="Completed" value={formatNum(status.totals.completedDrafts ?? 0)} />
              <Stat label="Picks" value={formatNum(status.totals.picks ?? 0)} />
              <Stat label="Seeds" value={formatNum(status.totals.seeds ?? 0)} />
            </div>
          )}

          {status.queue && (
            <div className="grid grid-cols-4 gap-2 text-[12px] mb-2">
              <Stat label="Queue pending" value={formatNum(status.queue.pending ?? 0)} />
              <Stat label="Processing" value={formatNum(status.queue.processing ?? 0)} />
              <Stat label="Failed" value={formatNum(status.queue.failed ?? 0)} />
              <Stat label="Completed" value={formatNum(status.queue.completed ?? 0)} />
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

      <PassiveCrawlEventsSection />

      <p className="mt-3 text-[10px] text-muted-foreground/70">
        Admin DC users authorize via session token automatically. Override secret, if entered, is held in component memory only.
      </p>
    </div>
  );
}

// ── Passive user-login crawl events ──────────────────────────────────────────
// Lists recent automatic depth-1 crawls triggered by users connecting their
// Sleeper account (authed or read-only). Polls /api/admin/adp/passive-events
// while at least one row is queued/running so counters update live.

interface PassiveEvent {
  id: number;
  sleeperUserId: string;
  sleeperUsername: string | null;
  source: string;
  status: string;
  queuedItems: number;
  leaguesScanned: number;
  draftsFound: number;
  draftsAdded: number;
  pendingItems: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function PassiveCrawlEventsSection() {
  const [events, setEvents] = useState<PassiveEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [recrawlingId, setRecrawlingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/admin/adp/passive-events?limit=50`, {
        headers: buildAdminHeaders(""),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setEvents(j?.events ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load passive events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh while anything is queued/running so counters tick up.
  useEffect(() => {
    if (!events) return;
    const anyOpen = events.some(e => e.status === "queued" || e.status === "running");
    if (!anyOpen) return;
    const id = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(id);
  }, [events, load]);

  const recrawl = useCallback(async (e: PassiveEvent) => {
    setRecrawlingId(e.sleeperUserId);
    try {
      const r = await fetch(`${API_BASE}/api/admin/adp/passive-events/recrawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAdminHeaders("") },
        body: JSON.stringify({ sleeperUserId: e.sleeperUserId, sleeperUsername: e.sleeperUsername }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Recrawl failed");
    } finally {
      setRecrawlingId(null);
    }
  }, [load]);

  return (
    <div className="mt-6 pt-4 border-t border-border/30" data-testid="passive-crawl-events">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h4 className="text-sm font-bold text-amber-500 dark:text-amber-400">Passive User Crawls</h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Depth-1 crawls triggered automatically when users connect Sleeper. 7-day cooldown per user; 24h on failure.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-[11px] px-2 py-1 rounded border border-border/40 hover:bg-muted/40 disabled:opacity-50"
          data-testid="button-refresh-passive-events"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-red-500 mt-1" data-testid="passive-events-error">{error}</p>
      )}

      {events && events.length === 0 && !loading && (
        <p className="text-[11px] text-muted-foreground py-2">No passive crawl events yet.</p>
      )}

      {events && events.length > 0 && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">When</th>
                <th className="px-2 py-1 text-left">User</th>
                <th className="px-2 py-1 text-left">Source</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-right">Leagues</th>
                <th className="px-2 py-1 text-right">Drafts found</th>
                <th className="px-2 py-1 text-right">Drafts added</th>
                <th className="px-2 py-1 text-right">Pending</th>
                <th className="px-2 py-1 text-left">Error</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-border/30" data-testid={`passive-event-row-${e.id}`}>
                  <td className="px-2 py-1 whitespace-nowrap font-mono text-muted-foreground">{formatTime(e.createdAt)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {e.sleeperUsername ?? <span className="text-muted-foreground">—</span>}
                    <span className="text-[10px] text-muted-foreground ml-1">{e.sleeperUserId}</span>
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">{e.source}</td>
                  <td className={`px-2 py-1 font-semibold ${statusColor(e.status)}`}>{e.status}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{e.leaguesScanned}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{e.draftsFound}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{e.draftsAdded}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{e.pendingItems}</td>
                  <td className="px-2 py-1 max-w-[200px] truncate text-red-500/80" title={e.errorMessage ?? ""}>{e.errorMessage ?? "—"}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      onClick={() => void recrawl(e)}
                      disabled={recrawlingId === e.sleeperUserId || e.status === "queued" || e.status === "running"}
                      className="text-[10px] px-2 py-0.5 rounded border border-border/40 hover:bg-muted/40 disabled:opacity-40"
                      data-testid={`button-recrawl-${e.id}`}
                      title={e.status === "queued" || e.status === "running" ? "Already running" : "Force a new crawl bypassing the cooldown"}
                    >
                      {recrawlingId === e.sleeperUserId ? "…" : "Recrawl"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

/** Render a number safely. undefined/null/NaN/non-finite → "—". */
function formatNum(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

/** Format a duration in ms. Missing/invalid → "—". */
function formatDuration(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
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
