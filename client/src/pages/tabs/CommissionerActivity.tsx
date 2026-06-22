/**
 * League Activity Monitoring — the Commissioner Command "daily dashboard".
 *
 * Self-contained module rendered as the Command Center → League Activity sub-tab. It
 * owns its own league picker (commissioner leagues come from SleeperContext),
 * internal sub-tab navigation, and a multi-league aggregate view. All data is
 * read from /api/commissioner/activity/* and a "Refresh Activity" scan kicks the
 * ingest pipeline. Nothing here writes back to Sleeper — it surfaces who/what
 * needs commissioner attention.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useSleeper } from "@/contexts/SleeperContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableTh } from "@/components/SortableTh";
import { fetchLeagueAvatarMap } from "@/lib/sleeperApi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, RefreshCw, Users, AlertTriangle, ListChecks,
  Settings as SettingsIcon, ArrowLeft, ArrowRightLeft, ArrowRight,
  Inbox,
} from "lucide-react";
import Transactions from "@/pages/tabs/Transactions";
import {
  refreshActivity, fetchOverview, fetchManagers, fetchSettings, updateSettings,
  ACTIVITY_LABEL_DISPLAY, LEAGUE_LABEL_DISPLAY,
  activityLabelColor, leagueLabelColor, riskLabel,
  type ActivitySettings,
} from "@/lib/commissionerActivityApi";

const GOLD = "#d4af37";

type SubTab =
  | "overview" | "transactions" | "settings";

// Primary segments shown as a two-up pill toggle (mirrors the All-League Scan
// "Live Scan / Post-Week Audit" modes). Settings is intentionally excluded — it
// lives behind a gear button surfaced only inside the Overview area.
const SEGMENTS: { id: Extract<SubTab, "overview" | "transactions">; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "transactions", label: "Transactions", icon: ArrowRightLeft },
];

// ── Small shared UI ──────────────────────────────────────────────────────────

function Chip({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

function KpiCard({ icon, label, value, sub, accent = "slate" }: {
  icon?: typeof Activity; label: string; value: React.ReactNode; sub?: string;
  accent?: "red" | "gold" | "blue" | "yellow" | "slate" | "emerald";
}) {
  const Icon = icon;
  // Per-accent icon-box style: tinted background + icon color.
  const colorByAccent: Record<string, string> = {
    red:    "bg-red-500/10 text-red-600 dark-any:text-red-400",
    gold:   "bg-[#d4af37]/10 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]",
    blue:   "bg-blue-500/10 text-blue-600 dark-any:text-blue-400",
    emerald:"bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
    yellow: "bg-yellow-500/10 text-yellow-600 dark-any:text-yellow-400",
    slate:  "bg-slate-500/10 text-slate-500 dark-any:text-slate-400",
  };
  return (
    <Card className="p-4 flex items-start gap-3 min-w-0">
      {Icon && (
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", colorByAccent[accent])}>
          <Icon className="w-4 h-4" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xl font-bold tabular-nums leading-tight text-foreground">{value}</p>
        <p className="text-[11px] font-medium leading-tight mt-0.5 text-muted-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{sub}</p>}
      </div>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
      <h3 className="text-sm font-bold text-foreground">{children}</h3>
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: typeof Activity; title: string; hint?: string }) {
  return (
    <Card className="border-border/60 dark:border-[#1a2d4a]/80">
      <div className="flex flex-col items-center justify-center text-center py-14 px-4">
        <Icon className="w-8 h-8 text-muted-foreground/60 mb-3" />
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1 max-w-sm">{hint}</p>}
      </div>
    </Card>
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

function daysAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  return `${days}d`;
}

// ── Root component ───────────────────────────────────────────────────────────

export default function CommissionerActivity({ onBack, leagueId: leagueIdProp }: { onBack?: () => void; leagueId?: string }) {
  const sleeper = useSleeper();
  const { toast } = useToast();
  const leagues = sleeper.leagues;

  const [sub, setSub] = useState<SubTab>("overview");
  // Settings is treated as a child of the Overview area, so the toggle keeps
  // "Overview" highlighted while the settings panel is open.
  const activeSeg: "overview" | "transactions" = sub === "transactions" ? "transactions" : "overview";
  // League is fixed to the league passed in (League Profile embeds this scoped
  // to one league), else the active league (or the first commissioner league).
  // The in-tab picker was removed; the tab auto-scans this league on open.
  const [leagueId] = useState<string>(
    leagueIdProp ?? sleeper.activeLeagueId ?? leagues[0]?.leagueId ?? "",
  );

  const refreshMut = useMutation({
    mutationFn: ({ mode, auto }: { mode: "recent" | "season"; auto?: boolean }) =>
      // Auto-scans (on tab open) reuse the server's 10-min cache so remounts stay
      // cheap; the manual button forces a guaranteed-fresh pull from Sleeper.
      refreshActivity({ leagueId, mode, forceRefresh: !auto }),
    onSuccess: (res, { auto }) => {
      if (!auto) {
        toast({
          title: "Activity scan complete",
          description: `Scanned week(s) ${res.weeksScanned.join(", ")}. ${res.alertsCreated} alert(s) found.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["commish-activity"] });
    },
    onError: (err: Error, { auto }) => {
      // Stay quiet on auto-scan failures — the tab still renders its empty state.
      if (!auto) toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    },
  });

  // Auto-refresh when the tab opens, and once per league as the picker changes.
  // A ref guards against re-firing on the re-renders that query invalidation and
  // toasts trigger.
  const autoScanned = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!leagueId || autoScanned.current.has(leagueId)) return;
    autoScanned.current.add(leagueId);
    // Scan the full season so the season-wide activity score reflects every week.
    refreshMut.mutate({ mode: "season", auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

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

  // Sub-tab toggle — pill segments mirroring the All-League Scan modes. Lives in
  // the page header (desktop) with a full-width variant below on mobile. Settings
  // sits behind the gear and only appears within the Overview area.
  const subTabs = (variant: "desktop" | "mobile") => (
    <div className={cn("flex items-center gap-2", variant === "mobile" && "w-full")}>
      <div
        className={cn(
          "grid rounded-2xl p-1 gap-1 h-12",
          variant === "desktop" ? "flex-shrink-0 w-[300px]" : "flex-1",
          "bg-[var(--sc-card-bg)] border border-[var(--sc-border)]",
          "dark-any:bg-white/[0.04] dark-any:border-white/[0.07]",
        )}
        style={{ gridTemplateColumns: "1fr 1fr" }}
        data-testid={`activity-sub-toggle-${variant}`}
      >
        {SEGMENTS.map((s) => {
          const Icon = s.icon;
          const isActive = activeSeg === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSub(s.id)}
              data-testid={`subtab-${s.id}${variant === "mobile" ? "-mobile" : ""}`}
              className={cn(
                "relative flex items-center justify-center gap-2 font-semibold transition-all duration-200 rounded-xl text-[13px] tracking-[0.01em]",
                isActive
                  ? "bg-[var(--sc-blue)] text-white shadow-[0_4px_12px_rgba(11,35,68,0.18)] dark-any:bg-[linear-gradient(135deg,rgba(11,58,122,0.85)_0%,rgba(11,58,122,0.65)_100%)] dark-any:shadow-[0_2px_12px_rgba(11,58,122,0.40),inset_0_1px_0_rgba(255,255,255,0.06)] dark-any:border dark-any:border-[#d4af37]/30"
                  : "text-[var(--sc-text-muted)] hover:bg-[var(--sc-blue-soft)] hover:text-[var(--sc-blue)] dark-any:text-white/45 dark-any:hover:bg-transparent dark-any:hover:text-white/70",
              )}
            >
              <Icon className="w-[15px] h-[15px] flex-shrink-0" />
              {s.label}
              {isActive && (
                <span
                  className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full w-7 h-0.5"
                  style={{ background: "#d6a21e", opacity: 0.95 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Settings — only available from the Overview area; toggles the panel. */}
      {activeSeg === "overview" && (
        <Button
          variant="outline"
          onClick={() => setSub(sub === "settings" ? "overview" : "settings")}
          data-testid={`subtab-settings${variant === "mobile" ? "-mobile" : ""}`}
          aria-label="Settings"
          aria-pressed={sub === "settings"}
          className={cn(
            "h-12 px-3.5 rounded-2xl flex-shrink-0",
            sub === "settings" && "border-[#d4af37]/50 text-[#d4af37]",
          )}
        >
          <SettingsIcon className="w-4 h-4" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Page header — title left, sub-tab toggle top-right (desktop). */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title="League Activity" subtitle="Spot disengaged managers and at-risk leagues before they go quiet." />
        <div className="flex items-center gap-3 flex-shrink-0 pt-1">
          {refreshMut.isPending && (
            <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <RefreshCw className="w-3 h-3 animate-spin text-[#d4af37]" />
              <span>Scanning…</span>
            </div>
          )}
          <div className="hidden md:flex">{subTabs("desktop")}</div>
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-activity-back">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
            </Button>
          )}
        </div>
      </div>

      {/* Sub-tab toggle (mobile) */}
      <div className="md:hidden !mt-3">{subTabs("mobile")}</div>

      {leagueId && (
        <div key={leagueId}>
          {sub === "overview" && <OverviewTab leagueId={leagueId} />}
          {sub === "transactions" && <Transactions leagueId={leagueId} />}
          {sub === "settings" && <SettingsTab leagueId={leagueId} />}
        </div>
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ leagueId }: { leagueId: string }) {
  const q = useQuery({
    queryKey: ["commish-activity", "overview", leagueId],
    queryFn: () => fetchOverview(leagueId),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const data = q.data!;
  const snap = data.snapshot;

  if (!snap) {
    return <EmptyState icon={RefreshCw} title="No activity scan yet" hint="This league scans automatically when you open the tab. Reload the page if data hasn’t appeared yet." />;
  }

  const label = snap.leagueActivityLabel;
  return (
    <div className="space-y-5">
      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard icon={Activity} label="League Activity Score" value={`${snap.leagueActivityScore}/100`} accent="gold" sub={`${LEAGUE_LABEL_DISPLAY[label]} · ${snap.season} Season`} />
        <KpiCard
          icon={Users}
          label="Active Managers"
          value={`${snap.activeManagerCount}/${snap.activeManagerCount + snap.inactiveManagerCount}`}
          accent={snap.inactiveManagerCount > 0 ? "red" : "emerald"}
          sub={snap.inactiveManagerCount > 0 ? `${snap.inactiveManagerCount} at-risk` : "All engaged"}
        />
        <KpiCard icon={ListChecks} label="Transactions" value={snap.totalTransactions} accent="blue" sub={`${snap.totalTrades} trades`} />
      </div>

      {/* Manager activity table */}
      <ManagerActivityTab leagueId={leagueId} />
    </div>
  );
}

// ── Manager Activity ─────────────────────────────────────────────────────────

function ManagerActivityTab({ leagueId }: { leagueId: string }) {
  const q = useQuery({
    queryKey: ["commish-activity", "managers", leagueId],
    queryFn: () => fetchManagers(leagueId),
  });

  // Sleeper profile images, keyed by owner (user) id. Loads independently of
  // the manager table so a slow/failed avatar fetch never blocks the rows;
  // missing entries fall back to the initials circle.
  const avatarsQ = useQuery({
    queryKey: ["commish-activity", "avatars", leagueId],
    queryFn: () => fetchLeagueAvatarMap(leagueId),
    staleTime: 1000 * 60 * 30,
  });
  const avatarMap = avatarsQ.data ?? {};

  const managers = q.data?.managers ?? [];

  // Managers sorted by inactivity risk (highest first) by default; headers below
  // re-sort on click via the shared sortable-table hook.
  // NOTE: must be called before any early returns to satisfy the Rules of Hooks.
  const { sorted, sortKey, sortDir, toggle } = useSortableTable(
    managers,
    {
      team: (m) => m.managerName || m.teamName,
      score: (m) => m.activityScore,
      risk: (m) => m.inactivityRiskScore,
      trans: (m) => m.transactionsCount,
      trades: (m) => m.tradesCount,
      waiv: (m) => m.waiverCount,
      fa: (m) => m.freeAgentCount,
      lineup: (m) => (m.lineupChanged ? 1 : 0),
      empty: (m) => m.emptyStarterSlots,
      lastMove: (m) => m.lastTransactionTs,
    },
    { defaultKey: "risk", defaultDir: "desc" },
  );

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  if (!managers.length) return <EmptyState icon={RefreshCw} title="No manager data yet" hint="Manager data loads automatically when you open this league." />;

  return (
    <div>
      {/* Swipe hint — mobile only (mirrors Lineup Command table) */}
      <div className="flex items-center justify-end gap-1.5 md:hidden mb-1 px-1">
        <span className="text-[10px] text-[var(--sc-text-muted)] dark-any:text-white/25">Swipe to view</span>
        <ArrowRight className="w-3 h-3 text-[var(--sc-text-muted)]/70 dark-any:text-white/20" />
      </div>

      <div
        className={cn(
          "rounded-2xl overflow-hidden",
          // Light: clean white wrapper, slate border, premium shadow.
          "bg-[var(--sc-card-bg)] border border-[var(--sc-border)] shadow-[var(--sc-shadow-card)]",
          // Dark: legacy gradient.
          "dark-any:border-white/6 dark-any:shadow-none dark-any:bg-[linear-gradient(180deg,rgba(4,13,26,0.9)_0%,rgba(4,10,20,0.95)_100%)]",
        )}
      >
        {/* Title bar — gold tick + manager count */}
        <div className="flex items-center justify-between px-4 md:px-5 py-3.5 border-b border-[var(--sc-border)] dark-any:border-white/6">
          <div className="flex items-center gap-2">
            <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
            <h3 className="text-sm font-bold text-[var(--sc-text)] dark-any:text-white/90">Manager Activity</h3>
          </div>
          <span className="text-xs text-[var(--sc-text-muted)] dark-any:text-white/35">{sorted.length} manager{sorted.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Scroll container */}
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="w-full text-sm" style={{ minWidth: 720 }}>
          <thead>
            {/* Header — navy in light mode, glass strip in dark. */}
            <tr className="bg-[var(--sc-blue)] dark-any:bg-white/[0.02] border-b border-[var(--sc-blue-2)] dark-any:border-white/6 text-[9px] uppercase tracking-widest text-white/70 dark-any:text-white/30">
              <SortableTh sortKey="team" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="text-left font-bold px-3 md:px-5 py-2.5 whitespace-nowrap">Manager</SortableTh>
              <SortableTh sortKey="score" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Score</SortableTh>
              <SortableTh sortKey="risk" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Risk</SortableTh>
              <SortableTh sortKey="trans" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Trans</SortableTh>
              <SortableTh sortKey="trades" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Trades</SortableTh>
              <SortableTh sortKey="waiv" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Waiv</SortableTh>
              <SortableTh sortKey="fa" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">FA</SortableTh>
              <SortableTh sortKey="lineup" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Lineup</SortableTh>
              <SortableTh sortKey="empty" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Empty</SortableTh>
              <SortableTh sortKey="lastMove" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Last Move</SortableTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const rl = riskLabel(m.inactivityRiskScore);
              return (
                <tr
                  key={m.rosterId}
                  className="border-b border-[#edf2f7] dark-any:border-white/5 last:border-0 hover:bg-[var(--sc-card-soft)] dark-any:hover:bg-white/[0.02] transition-colors"
                  data-testid={`manager-row-${m.rosterId}`}
                >
                  <td className="px-3 md:px-5 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <SleeperUserAvatar
                        username={m.managerName || m.teamName || "?"}
                        avatar={m.ownerId ? avatarMap[m.ownerId] : null}
                        size="md"
                        compact
                      />
                      <div className="min-w-0">
                        <div className="font-bold truncate text-[var(--sc-blue)] dark-any:text-white/90">{m.managerName}</div>
                        {m.teamName && m.teamName !== m.managerName && (
                          <div className="text-xs truncate text-[var(--sc-text-muted)] dark-any:text-white/30">{m.teamName}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-center px-2"><Chip className={activityLabelColor(m.activityLabel)}>{m.activityScore}</Chip></td>
                  <td className="text-center px-2"><Chip className={rl.color}>{rl.text}</Chip></td>
                  <td className="text-center px-2 font-semibold tabular-nums text-[var(--sc-text)] dark-any:text-white/70">{m.transactionsCount}</td>
                  <td className="text-center px-2 tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{m.tradesCount}</td>
                  <td className="text-center px-2 tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{m.waiverCount}</td>
                  <td className="text-center px-2 tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{m.freeAgentCount}</td>
                  <td className="text-center px-2">{m.lineupChanged ? <span className="font-semibold text-emerald-600 dark-any:text-emerald-400">Yes</span> : <span className="text-[var(--sc-text-muted)] dark-any:text-white/40">No</span>}</td>
                  <td className="text-center px-2">{m.emptyStarterSlots > 0 ? <span className="font-bold tabular-nums text-orange-600 dark-any:text-orange-400">{m.emptyStarterSlots}</span> : <span className="text-[var(--sc-text-muted)] dark-any:text-white/40">0</span>}</td>
                  <td className="text-center px-2 text-xs tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{daysAgo(m.lastTransactionTs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
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

// ── Loading / error states ───────────────────────────────────────────────────

function LoadingRows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
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
