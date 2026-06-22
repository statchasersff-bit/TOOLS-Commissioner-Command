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
import { fetchLeagueAvatarMap } from "@/lib/sleeperApi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, RefreshCw, Users, AlertTriangle, ListChecks,
  Settings as SettingsIcon, ArrowLeft, ArrowRightLeft,
  ShieldAlert, Inbox,
} from "lucide-react";
import Transactions from "@/pages/tabs/Transactions";
import {
  refreshActivity, fetchOverview, fetchManagers, fetchSettings, updateSettings,
  ACTIVITY_LABEL_DISPLAY, LEAGUE_LABEL_DISPLAY, FLAG_DISPLAY,
  activityLabelColor, leagueLabelColor, riskLabel,
  type ActivitySettings,
} from "@/lib/commissionerActivityApi";

const GOLD = "#d4af37";

type SubTab =
  | "overview" | "transactions" | "settings";

const SUB_TABS: { id: SubTab; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "transactions", label: "Transactions", icon: ArrowRightLeft },
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

function KpiCard({ icon, label, value, sub, accent }: { icon?: typeof Activity; label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  const Icon = icon;
  return (
    <Card className="p-4 border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-br from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628]">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ring-1",
            accent ? "bg-[#d4af37]/10 ring-[#d4af37]/15" : "bg-muted/40 ring-border/40",
          )}>
            <Icon className={cn("w-4 h-4", accent ? "text-[#d4af37]" : "text-muted-foreground")} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">{label}</p>
          <p className="text-xl font-bold mt-1 leading-tight text-foreground" style={accent ? { color: GOLD } : undefined}>
            {value}
          </p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

// Gold-tick card section header bar, mirroring Waiver/Lineup Command panels.
function CardHeaderBar({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="px-5 py-3.5 border-b border-border/40 dark:border-white/[0.06] flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
      {right}
    </div>
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

// ── Root component ───────────────────────────────────────────────────────────

export default function CommissionerActivity({ onBack }: { onBack?: () => void }) {
  const sleeper = useSleeper();
  const { toast } = useToast();
  const leagues = sleeper.leagues;

  const [sub, setSub] = useState<SubTab>("overview");
  // League is fixed to the active league (or the first commissioner league).
  // The in-tab picker was removed; the tab auto-scans this league on open.
  const [leagueId] = useState<string>(
    sleeper.activeLeagueId ?? leagues[0]?.leagueId ?? "",
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
    refreshMut.mutate({ mode: "recent", auto: true });
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

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title="League Activity" subtitle="Spot disengaged managers and at-risk leagues before they go quiet." />
        <div className="flex items-center gap-3 flex-shrink-0 pt-1">
          {refreshMut.isPending && (
            <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <RefreshCw className="w-3 h-3 animate-spin text-[#d4af37]" />
              <span>Scanning…</span>
            </div>
          )}
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-activity-back">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
            </Button>
          )}
        </div>
      </div>

      {/* Sub-tab nav */}
      <div className="flex gap-1 overflow-x-auto border-b border-border/40 dark:border-white/[0.06] -mx-1 px-1">
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
      {/* Hero score */}
      <Card className="px-5 py-5 border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-br from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628] flex flex-wrap items-center gap-5">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">League Activity Score</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-4xl font-black" style={{ color: GOLD }}>{snap.leagueActivityScore}</span>
            <span className="text-lg text-muted-foreground font-bold">/100</span>
          </div>
        </div>
        <Chip className={`${leagueLabelColor(label)} text-sm px-3 py-1`}>{LEAGUE_LABEL_DISPLAY[label]}</Chip>
        <div className="text-xs text-muted-foreground ml-auto">Week {snap.week} · {snap.season}</div>
      </Card>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={Users} label="Active Managers" value={snap.activeManagerCount} />
        <KpiCard icon={ShieldAlert} label="Inactive Risk" value={snap.inactiveManagerCount} accent={snap.inactiveManagerCount > 0} />
        <KpiCard icon={ListChecks} label="Transactions" value={snap.totalTransactions} sub={`${snap.totalTrades} trades`} />
        <KpiCard icon={Activity} label="Lineup Changes" value={snap.totalLineupChanges} />
        <KpiCard icon={AlertTriangle} label="Empty Slots" value={snap.totalEmptyStarterSlots} accent={snap.totalEmptyStarterSlots > 0} />
        <KpiCard icon={Inbox} label="Open Alerts" value={data.openAlertCount} accent={data.openAlertCount > 0} />
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

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const managers = q.data?.managers ?? [];
  if (!managers.length) return <EmptyState icon={RefreshCw} title="No manager data yet" hint="Manager data loads automatically when you open this league." />;

  // Managers sorted by inactivity risk (highest first).
  const sorted = [...managers].sort((a, b) => b.inactivityRiskScore - a.inactivityRiskScore);

  return (
    <div>
      <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80">
        <CardHeaderBar title="Manager Activity" right={<span className="text-xs text-muted-foreground">{sorted.length} manager{sorted.length !== 1 ? "s" : ""}</span>} />
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/40 dark:border-white/[0.05] bg-muted/30 dark:bg-white/[0.02]">
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
                    <div className="flex items-center gap-2.5 min-w-0">
                      <SleeperUserAvatar
                        username={m.managerName || m.teamName || "?"}
                        avatar={m.ownerId ? avatarMap[m.ownerId] : null}
                        size="md"
                        compact
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate">{m.teamName}</div>
                        <div className="text-xs text-muted-foreground truncate">{m.managerName}</div>
                      </div>
                    </div>
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
      </Card>
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
