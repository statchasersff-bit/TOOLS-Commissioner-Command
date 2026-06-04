/**
 * League Activity Monitoring — the Commissioner Command "daily dashboard".
 *
 * Self-contained module rendered for the `commissioner-command` main tab. It
 * owns its own league picker (commissioner leagues come from SleeperContext),
 * internal sub-tab navigation, and a multi-league aggregate view. All data is
 * read from /api/commissioner/activity/* and a "Refresh Activity" scan kicks the
 * ingest pipeline. Nothing here writes back to Sleeper — it surfaces who/what
 * needs commissioner attention.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useSleeper } from "@/contexts/SleeperContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Activity, RefreshCw, Users, AlertTriangle, ListChecks, FileText,
  Settings as SettingsIcon, Layers, ArrowLeft, Copy, CheckCircle2, Clock,
  ShieldAlert, Inbox, Zap,
} from "lucide-react";
import {
  refreshActivity, fetchOverview, fetchManagers, fetchFeed, fetchAlerts,
  updateAlert, fetchReport, fetchReminders, fetchSettings, updateSettings,
  fetchMultiOverview,
  ACTIVITY_LABEL_DISPLAY, LEAGUE_LABEL_DISPLAY, FLAG_DISPLAY,
  activityLabelColor, leagueLabelColor, severityColor, riskLabel,
  type ManagerRow, type ActivityEventRow, type AlertStatus,
  type ActivitySettings, type ReminderTemplate,
} from "@/lib/commissionerActivityApi";

const GOLD = "#d4af37";

type SubTab =
  | "overview" | "managers" | "feed" | "inactive" | "alerts" | "report" | "settings";

const SUB_TABS: { id: SubTab; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "managers", label: "Manager Activity", icon: Users },
  { id: "feed", label: "Activity Feed", icon: ListChecks },
  { id: "inactive", label: "Inactive Managers", icon: ShieldAlert },
  { id: "alerts", label: "Activity Alerts", icon: AlertTriangle },
  { id: "report", label: "Weekly Report", icon: FileText },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

// ── Small shared UI ──────────────────────────────────────────────────────────

function Chip({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 px-4 py-3.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-black ${accent ? "" : "text-foreground"}`} style={accent ? { color: GOLD } : undefined}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3">{children}</h3>;
}

function EmptyState({ icon: Icon, title, hint }: { icon: typeof Activity; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      <Icon className="w-8 h-8 text-muted-foreground/60 mb-3" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1 max-w-sm">{hint}</p>}
    </div>
  );
}

async function copyText(text: string, toast: ReturnType<typeof useToast>["toast"], label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: label, description: "Copied to clipboard." });
  } catch {
    toast({ title: "Copy failed", description: "Select and copy manually.", variant: "destructive" });
  }
}

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < day) return "today";
  const days = Math.floor(diff / day);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

// ── Root component ───────────────────────────────────────────────────────────

export default function CommissionerActivity({ onBack }: { onBack?: () => void }) {
  const sleeper = useSleeper();
  const { toast } = useToast();
  const leagues = sleeper.leagues;

  const [view, setView] = useState<"league" | "multi">("league");
  const [sub, setSub] = useState<SubTab>("overview");
  const [leagueId, setLeagueId] = useState<string>(
    sleeper.activeLeagueId ?? leagues[0]?.leagueId ?? "",
  );

  const refreshMut = useMutation({
    mutationFn: (mode: "recent" | "season") =>
      refreshActivity({ leagueId, mode, forceRefresh: true }),
    onSuccess: (res) => {
      toast({
        title: "Activity scan complete",
        description: `Scanned week(s) ${res.weeksScanned.join(", ")}. ${res.alertsCreated} alert(s) found.`,
      });
      queryClient.invalidateQueries({ queryKey: ["commish-activity"] });
    },
    onError: (err: Error) =>
      toast({ title: "Scan failed", description: err.message, variant: "destructive" }),
  });

  if (!sleeper.isConnected) {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          icon={Activity}
          title="Connect a Sleeper account to monitor league activity"
          hint="League Activity Monitoring works across the leagues you commission."
        />
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState icon={Users} title="No commissioner leagues found" hint="We only monitor leagues where you are the commissioner." />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.25)" }}>
          <Activity className="w-5 h-5" style={{ color: GOLD }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black tracking-tight text-foreground leading-none">League Activity</h1>
          <p className="text-xs text-muted-foreground mt-1">Spot disengaged managers and at-risk leagues before they go quiet.</p>
        </div>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-activity-back">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
        )}
      </div>

      {/* View switch + league picker + refresh */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="inline-flex rounded-xl border border-border/60 p-0.5 bg-card/40">
          <button
            onClick={() => setView("league")}
            data-testid="button-view-league"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === "league" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Single League
          </button>
          <button
            onClick={() => setView("multi")}
            data-testid="button-view-multi"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${view === "multi" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Layers className="w-3.5 h-3.5" /> All Leagues ({leagues.length})
          </button>
        </div>

        {view === "league" && (
          <>
            <select
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
              data-testid="select-activity-league"
              className="rounded-xl border border-border/60 bg-card/40 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40"
            >
              {leagues.map((l) => (
                <option key={l.leagueId} value={l.leagueId}>{l.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                size="sm" variant="outline"
                disabled={refreshMut.isPending || !leagueId}
                onClick={() => refreshMut.mutate("season")}
                data-testid="button-full-season-scan"
              >
                <Zap className="w-4 h-4 mr-1.5" /> Full Season Scan
              </Button>
              <Button
                size="sm"
                disabled={refreshMut.isPending || !leagueId}
                onClick={() => refreshMut.mutate("recent")}
                data-testid="button-refresh-activity"
                style={{ background: GOLD, color: "#1a1206" }}
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshMut.isPending ? "animate-spin" : ""}`} />
                {refreshMut.isPending ? "Scanning…" : "Refresh Activity"}
              </Button>
            </div>
          </>
        )}
      </div>

      {view === "multi" ? (
        <MultiLeagueDashboard
          onOpenLeague={(id) => { setLeagueId(id); setView("league"); setSub("overview"); }}
        />
      ) : (
        <>
          {/* Sub-tab nav */}
          <div className="flex gap-1 overflow-x-auto border-b border-border/60 mb-5 -mx-1 px-1">
            {SUB_TABS.map((t) => {
              const Icon = t.icon;
              const active = sub === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSub(t.id)}
                  data-testid={`subtab-${t.id}`}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ background: GOLD }} />}
                </button>
              );
            })}
          </div>

          {leagueId && (
            <div key={leagueId}>
              {sub === "overview" && <OverviewTab leagueId={leagueId} onGoToAlerts={() => setSub("alerts")} onGoToInactive={() => setSub("inactive")} />}
              {sub === "managers" && <ManagerActivityTab leagueId={leagueId} />}
              {sub === "feed" && <FeedTab leagueId={leagueId} />}
              {sub === "inactive" && <InactiveManagersTab leagueId={leagueId} />}
              {sub === "alerts" && <AlertsTab leagueId={leagueId} />}
              {sub === "report" && <WeeklyReportTab leagueId={leagueId} />}
              {sub === "settings" && <SettingsTab leagueId={leagueId} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ leagueId, onGoToAlerts, onGoToInactive }: { leagueId: string; onGoToAlerts: () => void; onGoToInactive: () => void }) {
  const q = useQuery({
    queryKey: ["commish-activity", "overview", leagueId],
    queryFn: () => fetchOverview(leagueId),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const data = q.data!;
  const snap = data.snapshot;

  if (!snap) {
    return <EmptyState icon={RefreshCw} title="No activity scan yet" hint="Click “Refresh Activity” above to scan the current and previous week." />;
  }

  const label = snap.leagueActivityLabel;
  return (
    <div className="space-y-6">
      {/* Hero score */}
      <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-card/70 to-card/30 px-5 py-5 flex flex-wrap items-center gap-5">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">League Activity Score</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-4xl font-black" style={{ color: GOLD }}>{snap.leagueActivityScore}</span>
            <span className="text-lg text-muted-foreground font-bold">/100</span>
          </div>
        </div>
        <Chip className={`${leagueLabelColor(label)} text-sm px-3 py-1`}>{LEAGUE_LABEL_DISPLAY[label]}</Chip>
        <div className="text-xs text-muted-foreground ml-auto">Week {snap.week} · {snap.season}</div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Active Managers" value={snap.activeManagerCount} />
        <KpiCard label="Inactive Risk" value={snap.inactiveManagerCount} accent={snap.inactiveManagerCount > 0} />
        <KpiCard label="Transactions" value={snap.totalTransactions} sub={`${snap.totalTrades} trades`} />
        <KpiCard label="Lineup Changes" value={snap.totalLineupChanges} />
        <KpiCard label="Empty Slots" value={snap.totalEmptyStarterSlots} accent={snap.totalEmptyStarterSlots > 0} />
        <KpiCard label="Open Alerts" value={data.openAlertCount} accent={data.openAlertCount > 0} />
      </div>

      {/* Top alerts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Top Alerts</SectionTitle>
          <button onClick={onGoToAlerts} className="text-xs font-semibold text-muted-foreground hover:text-foreground">View all →</button>
        </div>
        {data.topAlerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open alerts. League looks healthy. ✅</p>
        ) : (
          <div className="space-y-2">
            {data.topAlerts.map((a) => (
              <div key={a.id} className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/40 px-3.5 py-2.5">
                <Chip className={severityColor(a.severity)}>{a.severity}</Chip>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Leaders */}
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <SectionTitle>Most Active</SectionTitle>
          <ManagerMiniList rows={data.mostActiveManagers} metric="activity" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>Needs Attention</SectionTitle>
            <button onClick={onGoToInactive} className="text-xs font-semibold text-muted-foreground hover:text-foreground -mt-3">View →</button>
          </div>
          <ManagerMiniList rows={data.leastActiveManagers} metric="risk" />
        </div>
      </div>
    </div>
  );
}

function ManagerMiniList({ rows, metric }: { rows: ManagerRow[]; metric: "activity" | "risk" }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No data.</p>;
  return (
    <div className="space-y-2">
      {rows.map((m) => {
        const rl = riskLabel(m.inactivityRiskScore);
        return (
          <div key={m.rosterId} className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground truncate">{m.teamName}</div>
              <div className="text-xs text-muted-foreground truncate">{m.managerName}</div>
            </div>
            {metric === "activity" ? (
              <Chip className={activityLabelColor(m.activityLabel)}>{m.activityScore}</Chip>
            ) : (
              <Chip className={rl.color}>{rl.text}</Chip>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Manager Activity ─────────────────────────────────────────────────────────

type SortKey = "risk" | "activity" | "transactions" | "lineup" | "team";
type ManagerFilter = "all" | "highly_active" | "active" | "quiet" | "inactive_risk" | "inactive" | "has_alerts" | "empty_starter" | "no_moves";

function ManagerActivityTab({ leagueId }: { leagueId: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [filter, setFilter] = useState<ManagerFilter>("all");
  const q = useQuery({
    queryKey: ["commish-activity", "managers", leagueId],
    queryFn: () => fetchManagers(leagueId),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const managers = q.data?.managers ?? [];
  if (!managers.length) return <EmptyState icon={RefreshCw} title="No manager data yet" hint="Run a scan from the Refresh Activity button." />;

  const filtered = managers.filter((m) => {
    switch (filter) {
      case "all": return true;
      case "has_alerts": return m.inactivityRiskScore >= 50 || m.emptyStarterSlots > 0;
      case "empty_starter": return m.emptyStarterSlots > 0;
      case "no_moves": return m.flags.includes("no_recent_transactions");
      default: return m.activityLabel === filter;
    }
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "activity": return b.activityScore - a.activityScore;
      case "transactions": return b.transactionsCount - a.transactionsCount;
      case "lineup": return b.lineupChangeCount - a.lineupChangeCount;
      case "team": return (a.teamName ?? "").localeCompare(b.teamName ?? "");
      case "risk":
      default: return b.inactivityRiskScore - a.inactivityRiskScore;
    }
  });

  const filters: { id: ManagerFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "highly_active", label: "Highly Active" },
    { id: "active", label: "Active" },
    { id: "quiet", label: "Quiet" },
    { id: "inactive_risk", label: "Inactive Risk" },
    { id: "inactive", label: "Inactive" },
    { id: "has_alerts", label: "Has Alerts" },
    { id: "empty_starter", label: "Empty Starter" },
    { id: "no_moves", label: "No Recent Moves" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              data-testid={`filter-${f.id}`}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${filter === f.id ? "border-[#d4af37]/50 bg-[#d4af37]/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          data-testid="select-manager-sort"
          className="ml-auto rounded-lg border border-border/60 bg-card/40 px-2.5 py-1 text-xs text-foreground"
        >
          <option value="risk">Sort: Inactivity Risk</option>
          <option value="activity">Sort: Activity Score</option>
          <option value="transactions">Sort: Transactions</option>
          <option value="lineup">Sort: Lineup Changes</option>
          <option value="team">Sort: Team Name</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <th className="text-left font-bold px-3 py-2.5">Manager / Team</th>
              <th className="text-center font-bold px-2 py-2.5">Score</th>
              <th className="text-center font-bold px-2 py-2.5">Risk</th>
              <th className="text-center font-bold px-2 py-2.5">Txns</th>
              <th className="text-center font-bold px-2 py-2.5">Trades</th>
              <th className="text-center font-bold px-2 py-2.5">Waiv</th>
              <th className="text-center font-bold px-2 py-2.5">FA</th>
              <th className="text-center font-bold px-2 py-2.5">Lineup</th>
              <th className="text-center font-bold px-2 py-2.5">Empty</th>
              <th className="text-center font-bold px-2 py-2.5">Last Move</th>
              <th className="text-left font-bold px-3 py-2.5">Flags</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const rl = riskLabel(m.inactivityRiskScore);
              return (
                <tr key={m.rosterId} className="border-b border-border/40 last:border-0 hover:bg-muted/20" data-testid={`manager-row-${m.rosterId}`}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-foreground">{m.teamName}</div>
                    <div className="text-xs text-muted-foreground">{m.managerName}</div>
                  </td>
                  <td className="text-center px-2"><Chip className={activityLabelColor(m.activityLabel)}>{m.activityScore}</Chip></td>
                  <td className="text-center px-2"><Chip className={rl.color}>{rl.text}</Chip></td>
                  <td className="text-center px-2 text-foreground">{m.transactionsCount}</td>
                  <td className="text-center px-2 text-muted-foreground">{m.tradesCount}</td>
                  <td className="text-center px-2 text-muted-foreground">{m.waiverCount}</td>
                  <td className="text-center px-2 text-muted-foreground">{m.freeAgentCount}</td>
                  <td className="text-center px-2">{m.lineupChanged ? <span className="text-emerald-400">Yes</span> : <span className="text-muted-foreground">No</span>}</td>
                  <td className="text-center px-2">{m.emptyStarterSlots > 0 ? <span className="text-orange-400 font-semibold">{m.emptyStarterSlots}</span> : <span className="text-muted-foreground">0</span>}</td>
                  <td className="text-center px-2 text-xs text-muted-foreground">{m.weeksSinceTransaction != null ? `${m.weeksSinceTransaction}w` : timeAgo(m.lastTransactionTs)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {m.flags.map((f) => (
                        <Chip key={f} className="border-border/60 text-muted-foreground">{FLAG_DISPLAY[f] ?? f}</Chip>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Activity Feed ────────────────────────────────────────────────────────────

const FEED_FILTERS: { id: string; label: string; eventType?: string }[] = [
  { id: "all", label: "All Activity" },
  { id: "trade", label: "Trades", eventType: "trade" },
  { id: "waiver", label: "Waivers", eventType: "waiver" },
  { id: "free_agent", label: "Free Agents", eventType: "free_agent" },
  { id: "lineup_change", label: "Lineup Changes", eventType: "lineup_change" },
  { id: "empty_starter", label: "Empty Slots", eventType: "empty_starter" },
];

function FeedTab({ leagueId }: { leagueId: string }) {
  const [filterId, setFilterId] = useState("all");
  const eventType = FEED_FILTERS.find((f) => f.id === filterId)?.eventType;
  const q = useQuery({
    queryKey: ["commish-activity", "feed", leagueId, filterId],
    queryFn: () => fetchFeed(leagueId, { allWeeks: true, eventType }),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const events = q.data?.events ?? [];

  // Group by week (descending) for a timeline feel.
  const byWeek = new Map<number, ActivityEventRow[]>();
  for (const e of events) {
    const arr = byWeek.get(e.week) ?? [];
    arr.push(e);
    byWeek.set(e.week, arr);
  }
  const weeks = Array.from(byWeek.keys()).sort((a, b) => b - a);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {FEED_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilterId(f.id)}
            data-testid={`feed-filter-${f.id}`}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${filterId === f.id ? "border-[#d4af37]/50 bg-[#d4af37]/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <EmptyState icon={ListChecks} title="No activity recorded" hint="Run a scan to populate the activity timeline." />
      ) : (
        <div className="space-y-6">
          {weeks.map((wk) => (
            <div key={wk}>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Week {wk}</div>
              <div className="space-y-2">
                {byWeek.get(wk)!.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/40 px-3.5 py-2.5">
                    <Chip className={feedTypeColor(e.eventType)}>{feedTypeLabel(e.eventType)}</Chip>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground">{e.eventTitle}</div>
                      {e.eventDescription && <div className="text-xs text-muted-foreground">{e.eventDescription}</div>}
                    </div>
                    <div className="text-[11px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {timeAgo(e.eventTs)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function feedTypeLabel(t: string): string {
  return ({ trade: "Trade", waiver: "Waiver", free_agent: "Free Agent", lineup_change: "Lineup", lineup_unchanged: "No Change", empty_starter: "Alert" } as Record<string, string>)[t] ?? t;
}
function feedTypeColor(t: string): string {
  switch (t) {
    case "trade": return "text-purple-400 border-purple-500/40 bg-purple-500/10";
    case "waiver": return "text-sky-400 border-sky-500/40 bg-sky-500/10";
    case "free_agent": return "text-cyan-400 border-cyan-500/40 bg-cyan-500/10";
    case "lineup_change": return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
    case "empty_starter": return "text-orange-400 border-orange-500/40 bg-orange-500/10";
    default: return "border-border/60 text-muted-foreground";
  }
}

// ── Inactive Managers ────────────────────────────────────────────────────────

function InactiveManagersTab({ leagueId }: { leagueId: string }) {
  const { toast } = useToast();
  const q = useQuery({
    queryKey: ["commish-activity", "managers", leagueId],
    queryFn: () => fetchManagers(leagueId),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const managers = (q.data?.managers ?? []).filter((m) => m.inactivityRiskScore >= 25);

  if (!managers.length) {
    return <EmptyState icon={CheckCircle2} title="No managers need attention" hint="Everyone is at low inactivity risk right now." />;
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {managers.map((m) => (
        <InactiveManagerCard key={m.rosterId} leagueId={leagueId} manager={m} toast={toast} />
      ))}
    </div>
  );
}

function InactiveManagerCard({ leagueId, manager: m, toast }: { leagueId: string; manager: ManagerRow; toast: ReturnType<typeof useToast>["toast"] }) {
  const rl = riskLabel(m.inactivityRiskScore);
  const signals: string[] = [];
  if (m.weeksSinceTransaction != null && m.weeksSinceTransaction >= 2) signals.push(`No transactions in ${m.weeksSinceTransaction} week(s)`);
  if (m.weeksSinceLineupChange != null && m.weeksSinceLineupChange >= 2) signals.push(`Same lineup for ${m.weeksSinceLineupChange} week(s)`);
  if (m.emptyStarterSlots > 0) signals.push(`${m.emptyStarterSlots} empty starter slot(s)`);
  if (!signals.length) signals.push("Low overall engagement");

  const remindersQ = useQuery({
    queryKey: ["commish-activity", "reminders", leagueId, m.rosterId],
    queryFn: () => fetchReminders(leagueId, m.rosterId),
  });

  const pickTone = (): ReminderTemplate | undefined => {
    const t = remindersQ.data?.templates ?? [];
    if (m.emptyStarterSlots > 0) return t.find((x) => x.tone === "empty_starter");
    if (m.inactivityRiskScore >= 75) return t.find((x) => x.tone === "stronger");
    return t.find((x) => x.tone === "inactivity") ?? t[0];
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-foreground truncate">{m.teamName}</div>
          <div className="text-xs text-muted-foreground">Manager: {m.managerName}</div>
        </div>
        <Chip className={rl.color}>Risk: {rl.text}</Chip>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Signals</div>
        <ul className="space-y-1">
          {signals.map((s) => (
            <li key={s} className="text-xs text-foreground/90 flex items-start gap-1.5">
              <span className="text-orange-400 mt-0.5">•</span> {s}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm" variant="outline"
          disabled={!remindersQ.data}
          onClick={() => { const t = pickTone(); if (t) copyText(t.text, toast, "Reminder copied"); }}
          data-testid={`button-copy-reminder-${m.rosterId}`}
        >
          <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Reminder
        </Button>
      </div>
    </div>
  );
}

// ── Alerts ───────────────────────────────────────────────────────────────────

function AlertsTab({ leagueId }: { leagueId: string }) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const q = useQuery({
    queryKey: ["commish-activity", "alerts", leagueId, statusFilter],
    queryFn: () => fetchAlerts(leagueId, statusFilter === "all" ? undefined : statusFilter),
  });

  const mut = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: AlertStatus; notes?: string }) =>
      updateAlert(id, { status, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commish-activity", "alerts", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["commish-activity", "overview", leagueId] });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const statuses = ["open", "acknowledged", "resolved", "dismissed", "all"];

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const alerts = q.data?.alerts ?? [];

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            data-testid={`alert-status-${s}`}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border capitalize transition-colors ${statusFilter === s ? "border-[#d4af37]/50 bg-[#d4af37]/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {alerts.length === 0 ? (
        <EmptyState icon={Inbox} title="No alerts" hint="No alerts match this filter." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <th className="text-left font-bold px-3 py-2.5">Severity</th>
                <th className="text-left font-bold px-3 py-2.5">Alert</th>
                <th className="text-left font-bold px-3 py-2.5">Team</th>
                <th className="text-center font-bold px-2 py-2.5">Wk</th>
                <th className="text-center font-bold px-2 py-2.5">Status</th>
                <th className="text-right font-bold px-3 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-b border-border/40 last:border-0 align-top" data-testid={`alert-row-${a.id}`}>
                  <td className="px-3 py-3"><Chip className={severityColor(a.severity)}>{a.severity}</Chip></td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-foreground">{a.title}</div>
                    <div className="text-xs text-muted-foreground max-w-md">{a.description}</div>
                    {a.notes && <div className="text-[11px] text-muted-foreground/80 mt-1 italic">Note: {a.notes}</div>}
                  </td>
                  <td className="px-3 py-3 text-foreground">{a.teamName ?? (a.rosterId == null ? "League" : `Roster ${a.rosterId}`)}</td>
                  <td className="px-2 py-3 text-center text-muted-foreground">{a.week ?? "—"}</td>
                  <td className="px-2 py-3 text-center"><Chip className="border-border/60 text-muted-foreground capitalize">{a.status}</Chip></td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {a.status === "open" && (
                        <button onClick={() => mut.mutate({ id: a.id, status: "acknowledged" })} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-border/60 hover:bg-muted/40">Acknowledge</button>
                      )}
                      {a.status !== "resolved" && (
                        <button onClick={() => mut.mutate({ id: a.id, status: "resolved" })} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10">Resolve</button>
                      )}
                      {a.status !== "dismissed" && (
                        <button onClick={() => mut.mutate({ id: a.id, status: "dismissed" })} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-border/60 text-muted-foreground hover:bg-muted/40">Dismiss</button>
                      )}
                      <button
                        onClick={() => { const note = window.prompt("Add a note to this alert:", a.notes ?? ""); if (note != null) mut.mutate({ id: a.id, status: a.status, notes: note }); }}
                        className="text-[11px] font-semibold px-2 py-1 rounded-md border border-border/60 hover:bg-muted/40"
                      >
                        Note
                      </button>
                      <button onClick={() => copyText(`${a.title} — ${a.description}`, toast, "Alert copied")} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-border/60 hover:bg-muted/40">Copy</button>
                    </div>
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

// ── Weekly Report ────────────────────────────────────────────────────────────

function WeeklyReportTab({ leagueId }: { leagueId: string }) {
  const { toast } = useToast();
  const q = useQuery({
    queryKey: ["commish-activity", "report", leagueId],
    queryFn: () => fetchReport(leagueId),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const text = q.data?.copyText ?? "";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionTitle>Commissioner Report</SectionTitle>
        <Button size="sm" onClick={() => copyText(text, toast, "Report copied")} data-testid="button-copy-report" style={{ background: GOLD, color: "#1a1206" }}>
          <Copy className="w-4 h-4 mr-1.5" /> Copy Weekly Report
        </Button>
      </div>
      <pre className="whitespace-pre-wrap rounded-2xl border border-border/60 bg-card/40 p-4 text-sm text-foreground/90 font-mono leading-relaxed">{text}</pre>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

function SettingsTab({ leagueId }: { leagueId: string }) {
  const { toast } = useToast();
  const q = useQuery({
    queryKey: ["commish-activity", "settings", leagueId],
    queryFn: () => fetchSettings(leagueId),
  });
  const [draft, setDraft] = useState<ActivitySettings | null>(null);

  const settings = draft ?? q.data?.settings ?? null;

  const mut = useMutation({
    mutationFn: (patch: Partial<ActivitySettings>) => updateSettings(leagueId, patch),
    onSuccess: (res) => {
      setDraft(res.settings);
      queryClient.invalidateQueries({ queryKey: ["commish-activity", "settings", leagueId] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  if (!settings) return null;

  const set = (patch: Partial<ActivitySettings>) => setDraft({ ...settings, ...patch });

  const numFields: { key: keyof ActivitySettings; label: string }[] = [
    { key: "inactiveTransactionWeeks", label: "Inactive after N weeks without a transaction" },
    { key: "inactiveLineupWeeks", label: "Inactive after N weeks without a lineup change" },
    { key: "unchangedLineupWeeks", label: "Flag unchanged lineup after N weeks" },
    { key: "lowActivityScoreThreshold", label: "Low league activity score threshold" },
    { key: "inactiveManagerScoreThreshold", label: "Inactive manager score threshold" },
  ];
  const boolFields: { key: keyof ActivitySettings; label: string }[] = [
    { key: "flagEmptyStarters", label: "Flag empty starter slots" },
    { key: "flagNoTransactions", label: "Flag no recent transactions" },
    { key: "flagUnchangedLineups", label: "Flag unchanged lineups" },
    { key: "flagLowLeagueActivity", label: "Flag low league activity" },
    { key: "ignoreLineupChecksInOffseason", label: "Ignore lineup checks in offseason" },
    { key: "ignoreLineupChecksForBestBall", label: "Ignore lineup checks for best ball" },
    { key: "includeTradesInActivityScore", label: "Include trades in activity score" },
    { key: "includeWaiversInActivityScore", label: "Include waivers in activity score" },
    { key: "includeFreeAgentMovesInActivityScore", label: "Include free agent moves in activity score" },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <SectionTitle>Thresholds</SectionTitle>
        <div className="space-y-2.5">
          {numFields.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card/40 px-3.5 py-2.5">
              <span className="text-sm text-foreground/90">{f.label}</span>
              <input
                type="number" min={0}
                value={Number(settings[f.key])}
                onChange={(e) => set({ [f.key]: Number(e.target.value) } as Partial<ActivitySettings>)}
                data-testid={`setting-${f.key}`}
                className="w-20 rounded-lg border border-border/60 bg-background px-2 py-1 text-sm text-foreground text-center"
              />
            </label>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>Toggles</SectionTitle>
        <div className="space-y-2.5">
          {boolFields.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card/40 px-3.5 py-2.5 cursor-pointer">
              <span className="text-sm text-foreground/90">{f.label}</span>
              <input
                type="checkbox"
                checked={Boolean(settings[f.key])}
                onChange={(e) => set({ [f.key]: e.target.checked } as Partial<ActivitySettings>)}
                data-testid={`setting-${f.key}`}
                className="w-4 h-4 accent-[#d4af37]"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => mut.mutate(settings)} disabled={mut.isPending} data-testid="button-save-settings" style={{ background: GOLD, color: "#1a1206" }}>
          {mut.isPending ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ── Multi-league dashboard ───────────────────────────────────────────────────

function MultiLeagueDashboard({ onOpenLeague }: { onOpenLeague: (leagueId: string) => void }) {
  const sleeper = useSleeper();
  const leagueIds = useMemo(() => sleeper.leagues.map((l) => l.leagueId), [sleeper.leagues]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of sleeper.leagues) m.set(l.leagueId, l.name);
    return m;
  }, [sleeper.leagues]);

  const q = useQuery({
    queryKey: ["commish-activity", "multi", leagueIds.join(",")],
    queryFn: () => fetchMultiOverview(leagueIds),
    enabled: leagueIds.length > 0,
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const rows = q.data?.leagues ?? [];

  const monitored = rows.filter((r) => r.hasData);
  const healthy = monitored.filter((r) => (r.leagueActivityScore ?? 0) >= 70).length;
  const lowActivity = monitored.filter((r) => (r.leagueActivityScore ?? 0) < 50).length;
  const atRiskManagers = monitored.reduce((s, r) => s + (r.inactiveManagerCount ?? 0), 0);
  const openAlerts = rows.reduce((s, r) => s + r.openAlerts, 0);
  const emptySlots = monitored.reduce((s, r) => s + (r.totalEmptyStarterSlots ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Leagues" value={leagueIds.length} sub={`${monitored.length} scanned`} />
        <KpiCard label="Healthy" value={healthy} />
        <KpiCard label="Low Activity" value={lowActivity} accent={lowActivity > 0} />
        <KpiCard label="At-Risk Mgrs" value={atRiskManagers} accent={atRiskManagers > 0} />
        <KpiCard label="Open Alerts" value={openAlerts} accent={openAlerts > 0} />
        <KpiCard label="Empty Slots" value={emptySlots} accent={emptySlots > 0} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <th className="text-left font-bold px-3 py-2.5">League</th>
              <th className="text-center font-bold px-2 py-2.5">Score</th>
              <th className="text-center font-bold px-2 py-2.5">Active</th>
              <th className="text-center font-bold px-2 py-2.5">Inactive</th>
              <th className="text-center font-bold px-2 py-2.5">Txns</th>
              <th className="text-center font-bold px-2 py-2.5">Alerts</th>
              <th className="text-center font-bold px-2 py-2.5">Last Scan</th>
              <th className="text-right font-bold px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.leagueId} className="border-b border-border/40 last:border-0 hover:bg-muted/20" data-testid={`multi-row-${r.leagueId}`}>
                <td className="px-3 py-2.5 font-semibold text-foreground">{nameById.get(r.leagueId) ?? r.leagueId}</td>
                <td className="text-center px-2">
                  {r.hasData ? <Chip className={leagueLabelColor(r.leagueActivityLabel)}>{r.leagueActivityScore}</Chip> : <span className="text-xs text-muted-foreground">—</span>}
                </td>
                <td className="text-center px-2 text-foreground">{r.activeManagerCount ?? "—"}</td>
                <td className="text-center px-2">{(r.inactiveManagerCount ?? 0) > 0 ? <span className="text-orange-400 font-semibold">{r.inactiveManagerCount}</span> : <span className="text-muted-foreground">{r.inactiveManagerCount ?? "—"}</span>}</td>
                <td className="text-center px-2 text-muted-foreground">{r.totalTransactions ?? "—"}</td>
                <td className="text-center px-2">{r.openAlerts > 0 ? <span className="text-amber-400 font-semibold">{r.openAlerts}</span> : <span className="text-muted-foreground">0</span>}</td>
                <td className="text-center px-2 text-xs text-muted-foreground">{r.lastScan ? timeAgo(new Date(r.lastScan).getTime()) : "never"}</td>
                <td className="px-3 py-2.5 text-right">
                  <button onClick={() => onOpenLeague(r.leagueId)} className="text-xs font-semibold text-[#d4af37] hover:underline" data-testid={`button-open-${r.leagueId}`}>View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {monitored.length === 0 && (
        <p className="text-sm text-muted-foreground">No leagues have been scanned yet. Open a league and click “Refresh Activity” to populate this dashboard.</p>
      )}
    </div>
  );
}

// ── Loading / error states ───────────────────────────────────────────────────

function LoadingRows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 rounded-xl border border-border/40 bg-card/30 animate-pulse" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" /> Something went wrong</div>
      <div className="text-xs text-red-300/80 mt-1">{message}</div>
    </div>
  );
}
