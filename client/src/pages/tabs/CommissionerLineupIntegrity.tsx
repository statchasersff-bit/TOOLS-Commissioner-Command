/**
 * Lineup Integrity & Anti-Tanking (Commissioner Command).
 *
 * A decision-support surface: scan weekly Sleeper lineups, surface empty / bye /
 * inactive / IR starters, suspicious benchings, large optimality gaps, and
 * potential tanking SIGNALS, then let a commissioner review, note, and issue
 * strikes. Neutral language throughout — signals, never accusations.
 *
 * Sub-tabs: Overview · Lineup Checks · Anti-Tanking Review · Weekly Report ·
 * Settings. (Strike Tracker and Manager History live under League Analyzer →
 * Lineup Integrity.)
 *
 * Rendered in two modes (see `mode` prop): the per-league "single" view, and a
 * cross-league "multi" dashboard surfaced as its own "All Leagues" nav tab.
 */
import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useSleeper } from "@/contexts/SleeperContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert, RefreshCw, ArrowLeft, Copy, AlertTriangle, ListChecks,
  FileText, Settings as SettingsIcon, Scale, CheckCircle2,
  AlertCircle, Info, MessageSquare, EyeOff, ExternalLink, ChevronLeft, ChevronRight,
  UserX, CalendarClock, ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import { useLeagueAvatars } from "@/hooks/useLeagueAvatars";
import { type RosterIdentity } from "@/lib/sleeperApi";
import {
  lineupIntegrityApi as api,
  type LineupCheck,
  type LineupAlert,
  type LineupIntegritySettings,
  type MultiLeagueRow,
  type MultiLeagueAlert,
  type MultiLeagueStatus,
  type PlayerCheckView,
} from "@/lib/lineupIntegrityApi";

const GOLD = "#d4af37";

type SubTab =
  | "overview" | "checks" | "tanking" | "report" | "settings";

const SUB_TABS: { id: SubTab; label: string; icon: typeof ShieldAlert }[] = [
  { id: "overview", label: "Overview", icon: ShieldAlert },
  { id: "checks", label: "Lineup Checks", icon: ListChecks },
  { id: "tanking", label: "Anti-Tanking Review", icon: AlertTriangle },
  { id: "report", label: "Weekly Report", icon: FileText },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

// ── small display helpers ────────────────────────────────────────────────────

function integrityColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#84cc16";
  if (score >= 50) return "#eab308";
  if (score >= 25) return "#f97316";
  return "#ef4444";
}
function integrityLabel(score: number): string {
  if (score >= 90) return "Clean";
  if (score >= 75) return "Minor Issue";
  if (score >= 50) return "Needs Review";
  if (score >= 25) return "Serious Issue";
  return "Critical";
}
function tankingColor(label: string): string {
  switch (label) {
    case "critical": return "#ef4444";
    case "high": return "#f97316";
    case "medium": return "#eab308";
    default: return "#64748b";
  }
}
function severityColor(sev: string): string {
  switch (sev) {
    case "critical": return "#ef4444";
    case "high": return "#f97316";
    case "medium": return "#eab308";
    case "low": return "#84cc16";
    default: return "#64748b";
  }
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { toast } = useToast();
  return (
    <Button
      size="sm" variant="outline"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => toast({ title: "Copied to clipboard" }),
          () => toast({ title: "Copy failed", variant: "destructive" }),
        );
      }}
    >
      <Copy className="w-3.5 h-3.5 mr-1.5" /> {label}
    </Button>
  );
}

function teamLabel(c: { teamName: string | null; managerName: string | null; rosterId: number }): string {
  return c.teamName || c.managerName || `Roster ${c.rosterId}`;
}

/** Team/manager identity with the owner's Sleeper avatar. Falls back to the
 *  initials circle when the avatar map hasn't loaded or the owner has none. */
function TeamIdentity({
  check, avatars, size = "sm", className,
}: {
  check: { teamName: string | null; managerName: string | null; rosterId: number };
  avatars: Record<number, RosterIdentity>;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  return (
    <SleeperUserAvatar
      username={teamLabel(check)}
      avatar={avatars[check.rosterId]?.avatar ?? null}
      size={size}
      className={className}
    />
  );
}

// ── main page ────────────────────────────────────────────────────────────────

export default function CommissionerLineupIntegrity({
  onBack,
  mode = "single",
  onOpenLeague,
  initialWeek,
}: {
  onBack?: () => void;
  /** "single" shows the per-league view; "multi" is the cross-league dashboard. */
  mode?: "single" | "multi";
  /** Called from the multi view's "View" button to deep-link into a single league + week. */
  onOpenLeague?: (leagueId: string, week?: number) => void;
  /** Week to open the single-league view on (set when deep-linked from All Leagues). */
  initialWeek?: number;
}) {
  const sleeper = useSleeper();
  const leagues = sleeper.leagues;
  // Best ball leagues have no weekly lineup decisions to police, so they're
  // always excluded from the multi-league scan.
  const scanLeagues = leagues.filter((l) => !l.isBestBall);
  const { toast } = useToast();

  const isMulti = mode === "multi";
  const [sub, setSub] = useState<SubTab>("overview");
  const [leagueId, setLeagueId] = useState<string>(sleeper.activeLeagueId ?? leagues[0]?.leagueId ?? "");
  // null = each tab resolves the league's latest scanned week.
  const [week, setWeek] = useState<number | null>(initialWeek ?? null);

  const refreshMut = useMutation({
    mutationFn: () => api.refresh(leagueId),
    onSuccess: (r) => {
      if (r.skipped) {
        toast({ title: "Scan skipped", description: r.reason });
        return;
      }
      const issues = r.alertsCreated;
      toast({
        title: `Checked ${r.lineupsChecked} lineup${r.lineupsChecked === 1 ? "" : "s"}`,
        description: issues > 0 ? `${issues} issue${issues === 1 ? "" : "s"} flagged (${r.criticalAlerts} critical).` : "No issues flagged.",
      });
      queryClient.invalidateQueries({ queryKey: ["li", leagueId] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e?.message, variant: "destructive" }),
  });

  // Shares OverviewTab's query (same key) so this is deduped, not a 2nd request.
  // Used only to resolve the in-scope week + current NFL week → live/audit mode.
  const { data: overviewData } = useQuery({
    queryKey: ["li", leagueId, "overview", week ?? "latest"],
    queryFn: () => api.overview(leagueId, week ?? undefined),
    enabled: !isMulti && !!leagueId,
  });
  const currentWeek = overviewData?.currentWeek ?? null;
  const resolvedWeek = overviewData?.week ?? week;
  const scanMode: ScanMode = deriveScanMode(resolvedWeek, currentWeek);
  const scanMeta = MODE_META[scanMode];

  if (leagues.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 text-muted-foreground">
        <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="font-semibold text-foreground">No leagues connected</p>
        <p className="text-sm mt-1">Connect a Sleeper account with a league to run lineup integrity checks.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
        </Button>
      )}
      {isMulti ? (
        <MultiLeagueDashboard
          leagueIds={scanLeagues.map((l) => l.leagueId)}
          nameById={Object.fromEntries(scanLeagues.map((l) => [l.leagueId, l.name]))}
          avatarById={Object.fromEntries(scanLeagues.map((l) => [l.leagueId, l.avatar ?? null]))}
          onOpenLeague={(id, wk) => onOpenLeague?.(id, wk)}
        />
      ) : (
        <>
          <SectionHeader title="Lineups" subtitle={scanMeta.tagline} />
          {/* League picker + scan */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <select
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
              className="rounded-xl border border-border/60 bg-card/40 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40"
            >
              {leagues.map((l) => (
                <option key={l.leagueId} value={l.leagueId}>{l.name}</option>
              ))}
            </select>
            {/* Week stepper — review any scanned week (dispute protection). */}
            <div className="inline-flex items-center rounded-xl border border-border/60 bg-card/40 overflow-hidden">
              <button
                className="px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={week != null && week <= 1}
                onClick={() => setWeek((w) => Math.max(1, (w ?? 1) - 1))}
                aria-label="Previous week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-xs font-semibold min-w-[64px] text-center">{week == null ? "Latest" : `Week ${week}`}</span>
              <button
                className="px-2 py-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => setWeek((w) => (w ?? 1) + 1)}
                aria-label="Next week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {week != null && (
                <button className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground border-l border-border/60" onClick={() => setWeek(null)}>
                  Latest
                </button>
              )}
            </div>
            {/* Scan mode indicator (live = prevention, audit = accountability) */}
            <div className="flex items-center gap-2" data-testid="li-single-mode">
              <span className="text-xs font-semibold" style={{ color: GOLD }}>{scanMeta.scanLabel}</span>
              <Badge text={scanMeta.statusLabel} color={scanMeta.statusColor} />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                size="sm"
                disabled={refreshMut.isPending || !leagueId}
                onClick={() => refreshMut.mutate()}
                style={{ background: GOLD, color: "#1a1206" }}
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshMut.isPending ? "animate-spin" : ""}`} />
                {refreshMut.isPending ? "Scanning…" : "Run Lineup Check"}
              </Button>
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto border-b border-border/60 mb-5 -mx-1 px-1">
            {SUB_TABS.map((t) => {
              const Icon = t.icon;
              const active = sub === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSub(t.id)}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ background: GOLD }} />}
                </button>
              );
            })}
          </div>

          {leagueId && (
            <div key={`${leagueId}:${week ?? "latest"}`}>
              {sub === "overview" && <OverviewTab leagueId={leagueId} week={week} onScan={() => refreshMut.mutate()} scanning={refreshMut.isPending} />}
              {sub === "checks" && <ChecksTab leagueId={leagueId} week={week} />}
              {sub === "tanking" && <AntiTankingTab leagueId={leagueId} week={week} />}
              {sub === "report" && <WeeklyReportTab leagueId={leagueId} week={week} />}
              {sub === "settings" && <SettingsTab leagueId={leagueId} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-2xl font-black mt-1" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  );
}

function Loading() {
  return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
}
function EmptyHint({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-muted-foreground">{text}</div>;
}

function OverviewTab({ leagueId, week, onScan, scanning }: { leagueId: string; week: number | null; onScan: () => void; scanning: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "overview", week ?? "latest"],
    queryFn: () => api.overview(leagueId, week ?? undefined),
  });
  const avatars = useLeagueAvatars(leagueId);

  if (isLoading) return <Loading />;
  const s = data?.summary;
  if (!s || s.totalTeamsChecked === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground mb-4">No lineup checks yet for this week.</p>
        <Button onClick={onScan} disabled={scanning} style={{ background: GOLD, color: "#1a1206" }}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${scanning ? "animate-spin" : ""}`} /> Run Lineup Check
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Avg Integrity" value={`${s.averageIntegrityScore}/100`} accent={integrityColor(s.averageIntegrityScore)} />
        <KpiCard label="Clean Lineups" value={`${s.cleanLineups}/${s.totalTeamsChecked}`} />
        <KpiCard label="Needs Review" value={s.needsReview} accent={s.needsReview ? "#eab308" : undefined} />
        <KpiCard label="Empty Slots" value={s.emptyStarterSlots} accent={s.emptyStarterSlots ? "#ef4444" : undefined} />
        <KpiCard label="Inactive Starters" value={s.inactiveStarters} accent={s.inactiveStarters ? "#f97316" : undefined} />
        <KpiCard label="Suspicious Benchings" value={s.suspiciousBenchings} />
        <KpiCard label="High Tanking Risk" value={s.highTankingRiskTeams} accent={s.highTankingRiskTeams ? "#f97316" : undefined} />
        <KpiCard label="Open Alerts" value={s.openAlerts} />
      </div>

      {data!.highestRiskTeams.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-2">Highest-Risk Teams</h3>
          <div className="space-y-2">
            {data!.highestRiskTeams.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
                <TeamIdentity check={c} avatars={avatars} className="flex-1 min-w-0" />
                <Badge text={integrityLabel(c.lineupIntegrityScore)} color={integrityColor(c.lineupIntegrityScore)} />
                {c.tankingRiskScore >= 25 && <Badge text={`Tanking ${c.riskLabel}`} color={tankingColor(c.riskLabel)} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {data!.topAlerts.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-2">Top Alerts</h3>
          <div className="space-y-2">
            {data!.topAlerts.map((a) => <AlertCard key={a.id} alert={a} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color, background: `${color}1a`, border: `1px solid ${color}55` }}>
      {text}
    </span>
  );
}

function AlertCard({ alert }: { alert: LineupAlert }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Badge text={alert.severity} color={severityColor(alert.severity)} />
        <span className="font-semibold text-sm">{alert.title}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
      {alert.suggestedAction && <p className="text-[11px] text-muted-foreground/80 mt-1 italic">{alert.suggestedAction}</p>}
    </div>
  );
}

// ── Lineup Checks ────────────────────────────────────────────────────────────

const CHECK_FILTERS: { id: string; label: string; flag?: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs Review" },
  { id: "empty_starter", label: "Empty Starter", flag: "empty_starter" },
  { id: "bye_starter", label: "Bye Starter", flag: "bye_starter" },
  { id: "inactive_starter", label: "Inactive Starter", flag: "inactive_starter" },
  { id: "suspicious_benching", label: "Suspicious Benching", flag: "suspicious_benching" },
  { id: "potential_tanking", label: "Potential Tanking", flag: "potential_tanking" },
];

function ChecksTab({ leagueId, week }: { leagueId: string; week: number | null }) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const f = CHECK_FILTERS.find((x) => x.id === filter);
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "checks", week ?? "latest"],
    queryFn: () => api.checks(leagueId, { week: week ?? undefined }),
  });
  const avatars = useLeagueAvatars(leagueId);

  const checks = useMemo(() => {
    let rows = data?.checks ?? [];
    if (filter === "needs_review") rows = rows.filter((c) => c.reviewStatus === "needs_review");
    else if (f?.flag) rows = rows.filter((c) => c.flags.includes(f.flag!));
    return rows;
  }, [data, filter, f]);

  if (isLoading) return <Loading />;
  if (!data?.checks.length) return <EmptyHint text="No lineup checks yet — run a check from the header." />;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CHECK_FILTERS.map((x) => (
          <button
            key={x.id}
            onClick={() => setFilter(x.id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${filter === x.id ? "border-[#d4af37]/50 bg-[#d4af37]/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
              <th className="w-6" />
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-center px-2 py-2">Integrity</th>
              <th className="text-center px-2 py-2">Tanking</th>
              <th className="text-center px-2 py-2">Empty</th>
              <th className="text-center px-2 py-2">Bye</th>
              <th className="text-center px-2 py-2">Inact.</th>
              <th className="text-center px-2 py-2">Susp.</th>
              <th className="text-center px-2 py-2">Gap</th>
              <th className="text-left px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => {
              const isOpen = expanded === c.id;
              return (
                <Fragment key={c.id}>
                  <tr
                    className="border-b border-border/40 last:border-0 cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                  >
                    <td className="pl-2 text-muted-foreground">
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </td>
                    <td className="px-3 py-2"><TeamIdentity check={c} avatars={avatars} /></td>
                    <td className="px-2 py-2 text-center">
                      <span className="font-bold" style={{ color: integrityColor(c.lineupIntegrityScore) }}>{c.lineupIntegrityScore}</span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {c.tankingRiskScore >= 25 ? <Badge text={c.riskLabel} color={tankingColor(c.riskLabel)} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 text-center">{c.emptyStarterSlots || "—"}</td>
                    <td className="px-2 py-2 text-center">{c.byeStarters || "—"}</td>
                    <td className="px-2 py-2 text-center">{c.inactiveStarters + c.irStarters || "—"}</td>
                    <td className="px-2 py-2 text-center">{c.suspiciousBenchings || "—"}</td>
                    <td className="px-2 py-2 text-center">{c.optimalityGap > 0 ? c.optimalityGap.toFixed(1) : "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground capitalize">{c.reviewStatus.replace(/_/g, " ")}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/40">
                      <td colSpan={10} className="p-0">
                        <LineupDetail checkId={c.id} emptySlots={c.emptyStarterSlots} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Availability label for a player row (game kickoff / lock status not tracked). */
function playerStatusBadge(p: PlayerCheckView): { text: string; color: string } {
  if (p.isOnBye) return { text: "Bye", color: "#ef4444" };
  if (p.isIr) return { text: "IR", color: "#ef4444" };
  if (p.isInactive) return { text: "Out", color: "#ef4444" };
  if (p.isDoubtful) return { text: "Doubtful", color: "#f97316" };
  const inj = (p.injuryStatus ?? "").toLowerCase();
  if (inj === "questionable" || inj === "q") return { text: "Questionable", color: "#eab308" };
  return { text: "Active", color: "#22c55e" };
}

function starterIssue(p: PlayerCheckView): string {
  if (p.isOnBye) return "Starter on bye";
  if (p.isIr) return "IR in starting lineup";
  if (p.isInactive) return "Inactive / Out starter";
  if (p.isDoubtful) return "Doubtful starter";
  if (p.betterBenchOption) return p.betterBenchPlayerName ? `Better bench option (${p.betterBenchPlayerName})` : "Better bench option available";
  return "—";
}

/**
 * Expanded per-team lineup view: slot-by-slot starters with their availability
 * + issue, and the eligible bench replacements a commissioner would check for.
 * Game kickoff time / lock status are not in our data feed yet (shown as "—").
 */
function LineupDetail({ checkId, emptySlots }: { checkId: number; emptySlots: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", "detail", checkId],
    queryFn: () => api.checkDetail(checkId),
  });
  if (isLoading) return <div className="py-4 text-center text-xs text-muted-foreground">Loading lineup…</div>;
  if (!data) return <div className="py-4 text-center text-xs text-muted-foreground">No detail available.</div>;

  const starters = data.starters;
  const benchOptions = [...data.bench]
    .filter((p) => !p.isInactive && !p.isIr && !p.isOnBye)
    .sort((a, b) => b.projection - a.projection)
    .slice(0, 8);
  const copyMessages = Object.entries(data.copyMessages ?? {});

  return (
    <div className="p-3 space-y-4 bg-background/30">
      {emptySlots > 0 && (
        <p className="text-xs font-semibold text-red-500">
          {emptySlots} empty starter slot{emptySlots === 1 ? "" : "s"} this week.
        </p>
      )}

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Starting Lineup</p>
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
                <th className="text-left px-2 py-1.5">Slot</th>
                <th className="text-left px-2 py-1.5">Player</th>
                <th className="text-center px-2 py-1.5">Team</th>
                <th className="text-center px-2 py-1.5">Status</th>
                <th className="text-center px-2 py-1.5">Game Time</th>
                <th className="text-left px-2 py-1.5">Issue</th>
              </tr>
            </thead>
            <tbody>
              {starters.map((p) => {
                const st = playerStatusBadge(p);
                const issue = starterIssue(p);
                return (
                  <tr key={p.playerId} className="border-b border-border/40 last:border-0">
                    <td className="px-2 py-1.5 font-semibold text-muted-foreground">{p.lineupSlot ?? "—"}</td>
                    <td className="px-2 py-1.5 font-medium">{p.playerName ?? "—"}{p.position ? <span className="text-muted-foreground"> · {p.position}</span> : null}</td>
                    <td className="px-2 py-1.5 text-center text-muted-foreground">{p.team ?? "—"}</td>
                    <td className="px-2 py-1.5 text-center"><Badge text={st.text} color={st.color} /></td>
                    <td className="px-2 py-1.5 text-center text-muted-foreground">—</td>
                    <td className={`px-2 py-1.5 ${issue === "—" ? "text-muted-foreground" : "text-foreground"}`}>{issue}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Eligible Bench Replacements</p>
        {benchOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No available bench replacements.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
                  <th className="text-left px-2 py-1.5">Bench Player</th>
                  <th className="text-center px-2 py-1.5">Pos</th>
                  <th className="text-center px-2 py-1.5">Status</th>
                  <th className="text-center px-2 py-1.5">Projected</th>
                  <th className="text-center px-2 py-1.5">Game Time</th>
                </tr>
              </thead>
              <tbody>
                {benchOptions.map((p) => {
                  const st = playerStatusBadge(p);
                  return (
                    <tr key={p.playerId} className="border-b border-border/40 last:border-0">
                      <td className="px-2 py-1.5 font-medium">{p.playerName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-center text-muted-foreground">{p.position ?? "—"}</td>
                      <td className="px-2 py-1.5 text-center"><Badge text={st.text} color={st.color} /></td>
                      <td className="px-2 py-1.5 text-center font-semibold">{p.projection > 0 ? p.projection.toFixed(1) : "—"}</td>
                      <td className="px-2 py-1.5 text-center text-muted-foreground">—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {copyMessages.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {copyMessages.map(([key, text]) => (
            <CopyButton key={key} text={text} label={`Copy ${key.replace(/_/g, " ")}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Anti-Tanking Review ──────────────────────────────────────────────────────

function AntiTankingTab({ leagueId, week }: { leagueId: string; week: number | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "checks", week ?? "latest"],
    queryFn: () => api.checks(leagueId, { week: week ?? undefined }),
  });
  const avatars = useLeagueAvatars(leagueId);
  const resolvedWeek = data?.week ?? 0;
  const teams = (data?.checks ?? []).filter((c) => c.tankingRiskScore >= 25)
    .sort((a, b) => b.tankingRiskScore - a.tankingRiskScore);

  if (isLoading) return <Loading />;
  if (!teams.length) return <EmptyHint text="No teams currently show a tanking risk signal. This is good news." />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        These are <strong>signals for review</strong>, not determinations. Review context and follow league bylaws before any action.
      </p>
      {teams.map((c) => <TankingCard key={c.id} check={c} week={resolvedWeek} avatars={avatars} />)}
    </div>
  );
}

function buildSignals(c: LineupCheck): string[] {
  const out: string[] = [];
  if (c.optimalityGap > 0) out.push(`Projected lineup was ${c.optimalityGap.toFixed(1)} points below the estimated optimal lineup`);
  if (c.suspiciousBenchings > 0) out.push(`Benched ${c.suspiciousBenchings} higher-projected eligible player${c.suspiciousBenchings === 1 ? "" : "s"}`);
  if (c.emptyStarterSlots > 0) out.push(`Left ${c.emptyStarterSlots} starter slot${c.emptyStarterSlots === 1 ? "" : "s"} empty`);
  if (c.inactiveStarters + c.irStarters > 0) out.push(`Started ${c.inactiveStarters + c.irStarters} inactive/IR player${c.inactiveStarters + c.irStarters === 1 ? "" : "s"}`);
  if (c.flags.includes("repeat_lineup_issue")) out.push("Similar issues occurred in recent weeks");
  if (c.flags.includes("playoff_integrity")) out.push("Occurred in a matchup that may affect playoff seeding");
  return out;
}

function TankingCard({ check, week, avatars }: { check: LineupCheck; week: number; avatars: Record<number, RosterIdentity> }) {
  const signals = buildSignals(check);
  const msg =
    `Hey ${check.managerName ?? "Manager"}, your Week ${week} lineup was flagged for multiple integrity issues. ` +
    `Please update your lineup and confirm you are setting a competitive roster. ` +
    `Continued issues may result in commissioner action under league rules.`;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <TeamIdentity check={check} avatars={avatars} size="md" />
        <span className="text-xs text-muted-foreground">Manager: {check.managerName}</span>
        <Badge text={`Tanking Risk: ${check.riskLabel} · ${check.tankingRiskScore}/100`} color={tankingColor(check.riskLabel)} />
      </div>

      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Signals</p>
        <ul className="text-sm space-y-1">
          {signals.map((sig, i) => (
            <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span>{sig}</li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-muted-foreground/80 italic mt-3">
        Suggested action: Review context and follow league bylaws before issuing a warning.
      </p>

      <div className="flex flex-wrap gap-2 mt-3">
        <CopyButton text={msg} label="Copy Message" />
      </div>
    </div>
  );
}

// ── Weekly Report ────────────────────────────────────────────────────────────

function WeeklyReportTab({ leagueId, week }: { leagueId: string; week: number | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "report", week ?? "latest"],
    queryFn: () => api.report(leagueId, week ?? undefined),
  });
  if (isLoading) return <Loading />;
  const text = data?.copyText ?? "";
  if (!text) return <EmptyHint text="No report yet — run a lineup check first." />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><CopyButton text={text} label="Copy Weekly Report" /></div>
      <pre className="whitespace-pre-wrap text-sm rounded-xl border border-border/60 bg-card/40 p-4 font-mono leading-relaxed">{text}</pre>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

const TOGGLES: { key: keyof LineupIntegritySettings; label: string }[] = [
  { key: "enableEmptySlotChecks", label: "Flag empty starters" },
  { key: "enableByeStarterChecks", label: "Flag bye-week starters" },
  { key: "enableOutStarterChecks", label: "Flag OUT players" },
  { key: "enableIrStarterChecks", label: "Flag IR players" },
  { key: "enableDoubtfulStarterChecks", label: "Flag doubtful players" },
  { key: "enableQuestionableStarterChecks", label: "Flag questionable players" },
  { key: "enableUnchangedLineupChecks", label: "Flag unchanged lineups" },
  { key: "enableSuspiciousBenchingChecks", label: "Suspicious benching checks" },
  { key: "enableTankingRiskChecks", label: "Tanking risk checks" },
  { key: "ignoreEliminatedTeams", label: "Ignore eliminated teams" },
  { key: "ignoreLineupChecksInOffseason", label: "Skip checks in offseason" },
  { key: "ignoreLineupChecksForBestBall", label: "Ignore best ball leagues" },
  { key: "autoCreateAlerts", label: "Auto-create alerts" },
  { key: "autoCreateStrikes", label: "Auto-create strikes (off by default)" },
];

const NUMBERS: { key: keyof LineupIntegritySettings; label: string }[] = [
  { key: "suspiciousBenchingValueGap", label: "Suspicious benching value gap" },
  { key: "suspiciousBenchingProjectionGap", label: "Suspicious benching projection gap" },
  { key: "optimalityGapWarning", label: "Optimality gap warning" },
  { key: "optimalityGapCritical", label: "Optimality gap critical" },
  { key: "repeatIssueWeeks", label: "Repeat issue lookback (weeks)" },
  { key: "strikeAfterRepeatIssues", label: "Strike after N repeat issues" },
  { key: "playoffIntegrityStartWeek", label: "Playoff integrity start week" },
];

function SettingsTab({ leagueId }: { leagueId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "settings"],
    queryFn: () => api.settings(leagueId),
  });
  const { toast } = useToast();
  const [draft, setDraft] = useState<LineupIntegritySettings | null>(null);
  const settings = draft ?? data?.settings ?? null;

  const saveMut = useMutation({
    mutationFn: (patch: Partial<LineupIntegritySettings>) => api.updateSettings(leagueId, patch),
    onSuccess: (r) => { setDraft(r.settings); queryClient.invalidateQueries({ queryKey: ["li", leagueId] }); toast({ title: "Settings saved" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  if (isLoading || !settings) return <Loading />;

  const set = (patch: Partial<LineupIntegritySettings>) => setDraft({ ...settings, ...patch });

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="space-y-2">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-3 py-2 cursor-pointer">
            <span className="text-sm">{t.label}</span>
            <input
              type="checkbox"
              checked={Boolean(settings[t.key])}
              onChange={(e) => set({ [t.key]: e.target.checked } as Partial<LineupIntegritySettings>)}
              className="h-4 w-4 accent-[#d4af37]"
            />
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {NUMBERS.map((nb) => (
          <label key={nb.key} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
            <span className="text-sm">{nb.label}</span>
            <input
              type="number"
              value={Number(settings[nb.key])}
              onChange={(e) => set({ [nb.key]: Number(e.target.value) } as Partial<LineupIntegritySettings>)}
              className="w-24 rounded-lg border border-border/60 bg-background/40 px-2 py-1 text-sm text-right"
            />
          </label>
        ))}
      </div>

      <Button onClick={() => saveMut.mutate(settings)} disabled={saveMut.isPending} style={{ background: GOLD, color: "#1a1206" }}>
        {saveMut.isPending ? "Saving…" : "Save Settings"}
      </Button>

      {data?.policyText && (
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Scale className="w-4 h-4" /> Recommended Policy Text</h3>
            <CopyButton text={data.policyText} />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.policyText}</p>
        </div>
      )}
    </div>
  );
}

// ── Multi-league dashboard ───────────────────────────────────────────────────

const STATUS_META: Record<MultiLeagueStatus, { label: string; color: string }> = {
  clean: { label: "Clean", color: "#22c55e" },
  needs_review: { label: "Needs Review", color: "#eab308" },
  critical: { label: "Critical", color: "#ef4444" },
  resolved: { label: "Resolved", color: "#3b82f6" },
  best_ball_excluded: { label: "Best Ball Excluded", color: "#64748b" },
  not_started: { label: "Not Started", color: "#64748b" },
  data_pending: { label: "Data Pending", color: "#64748b" },
};

// ── Two-mode system ──────────────────────────────────────────────────────────
// "live"  = Current Week Scan: prevention. Catch issues before/while games play;
//           soft, actionable language (Needs Attention, At Risk, Reminder).
// "audit" = Completed Week Audit: accountability. Review final results; stronger
//           documentation language (Confirmed, Review Needed, Violation Candidate).
// Mode is derived from the selected week vs the current NFL week (week-level lock:
// any past week is final/locked; the current week is still in progress).
type ScanMode = "live" | "audit";

function deriveScanMode(week: number | null, currentWeek: number | null): ScanMode {
  if (week == null) return "live";           // null = latest = the live week
  if (currentWeek == null) return "live";    // unknown state → assume live
  return week < currentWeek ? "audit" : "live";
}

const MODE_META: Record<ScanMode, {
  toggleLabel: string; scanLabel: string; tagline: string; statusLabel: string; statusColor: string;
}> = {
  live: {
    toggleLabel: "Live Scan",
    scanLabel: "Live Lineup Check",
    tagline: "Catch lineup issues before kickoff — prevention, not penalties.",
    statusLabel: "In progress",
    statusColor: "#eab308",
  },
  audit: {
    toggleLabel: "Post-Week Audit",
    scanLabel: "Post-Week Audit",
    tagline: "Review final lineup issues after results are complete — document & resolve.",
    statusLabel: "Final",
    statusColor: "#3b82f6",
  },
};

// League status label, reworded per mode (colors stay from STATUS_META). Live mode
// keeps things actionable; audit mode escalates to accountability language.
const STATUS_LABEL_BY_MODE: Record<ScanMode, Partial<Record<MultiLeagueStatus, string>>> = {
  // Current week = prevention. Softer language; never "violation" yet.
  live: {
    clean: "Clean",
    needs_review: "Needs Attention",
    critical: "Warning",
    resolved: "Resolved",
  },
  // Completed weeks = accountability. Stronger audit language.
  audit: {
    clean: "No Action Needed",
    needs_review: "Confirmed Issue",
    critical: "Violation Candidate",
    resolved: "Reviewed",
  },
};

function leagueStatusLabel(status: MultiLeagueStatus, mode: ScanMode): string {
  return STATUS_LABEL_BY_MODE[mode][status] ?? STATUS_META[status].label;
}

// Compact relative time for the "Last Scanned" column — "Just now", "5m ago",
// "3h ago", "2d ago", falling back to a date for older scans.
function formatLastScanned(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "Just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── All-leagues scan: Lineup-Command-style KPI cards + expandable league rows ──

const SCAN_ACCENT: Record<string, string> = {
  red:     "bg-red-500/10 text-red-600 dark-any:text-red-400",
  amber:   "bg-amber-500/10 text-amber-600 dark-any:text-amber-400",
  orange:  "bg-orange-500/10 text-orange-600 dark-any:text-orange-400",
  blue:    "bg-blue-500/10 text-blue-600 dark-any:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
  slate:   "bg-slate-500/10 text-slate-500 dark-any:text-slate-400",
};

// Icon-box KPI card mirroring the Lineup Command tab: tinted rounded icon on the
// left, value + label stacked beside it, on the shared Card surface.
function ScanKpiCard({ icon: Icon, label, value, accent = "slate", sub }: {
  icon: typeof ShieldAlert; label: string; value: React.ReactNode;
  accent?: keyof typeof SCAN_ACCENT; sub?: string;
}) {
  return (
    <Card className="p-4 flex items-start gap-3 min-w-0">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", SCAN_ACCENT[accent])}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold tabular-nums leading-tight text-foreground">{value}</p>
        <p className="text-[11px] font-medium leading-tight mt-0.5 text-muted-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{sub}</p>}
      </div>
    </Card>
  );
}

// ── Scan Settings: cross-league control over what counts as an issue ─────────
// The dashboard spans every league a commissioner runs, so this compact panel
// edits the real per-league scan settings and applies the change to all of
// them at once. Seeds from the first league as the representative config.
const SCAN_SETTING_TOGGLES: { key: keyof LineupIntegritySettings; label: string; invert?: boolean }[] = [
  { key: "enableEmptySlotChecks", label: "Flag empty starters" },
  { key: "enableByeStarterChecks", label: "Flag bye-week starters" },
  { key: "enableOutStarterChecks", label: "Flag OUT players" },
  { key: "enableIrStarterChecks", label: "Flag IR players" },
  { key: "enableDoubtfulStarterChecks", label: "Flag doubtful players" },
  { key: "enableQuestionableStarterChecks", label: "Flag questionable players" },
  { key: "enableUnchangedLineupChecks", label: "Flag unchanged lineups" },
  { key: "ignoreEliminatedTeams", label: "Ignore eliminated teams" },
  // Best ball leagues are always excluded from the multi-league scan, so there's
  // no per-scan toggle for them here.
];

function ScanSettingsButton({ leagueIds }: { leagueIds: string[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<LineupIntegritySettings> | null>(null);
  const seedId = leagueIds[0];

  // Seed the toggles from the first league's effective settings.
  const { data, isLoading } = useQuery({
    queryKey: ["li", seedId, "settings"],
    queryFn: () => api.settings(seedId),
    enabled: open && !!seedId,
  });
  const settings = draft ?? data?.settings ?? null;

  const saveMut = useMutation({
    mutationFn: async (patch: Partial<LineupIntegritySettings>) => {
      const results = await Promise.allSettled(leagueIds.map((id) => api.updateSettings(id, patch)));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      return { ok, total: leagueIds.length };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["li"] });
      toast({
        title: `Scan settings saved`,
        description: `Applied to ${r.ok}/${r.total} league${r.total === 1 ? "" : "s"}. Re-scan to apply.`,
      });
      setOpen(false);
      setDraft(null);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        data-testid="button-scan-settings"
      >
        <SettingsIcon className="w-4 h-4 mr-1.5" /> Scan Settings
      </Button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-[140]" onClick={() => { setOpen(false); setDraft(null); }} />
          <div className="absolute right-0 mt-2 z-[150] w-[300px] rounded-2xl border border-border/60 bg-popover shadow-2xl shadow-black/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-bold">Scan Settings</h4>
              <span className="text-[10px] text-muted-foreground">{leagueIds.length} league{leagueIds.length === 1 ? "" : "s"}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">Choose what counts as an issue. Applies to every league you commission.</p>

            {isLoading || !settings ? (
              <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
            ) : (
              <>
                <div className="space-y-1">
                  {SCAN_SETTING_TOGGLES.map((t) => (
                    <label key={t.key} className="flex items-center justify-between rounded-lg px-2 py-1.5 cursor-pointer hover:bg-muted/40">
                      <span className="text-[13px]">{t.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(settings[t.key])}
                        onChange={(e) => setDraft({ ...settings, [t.key]: e.target.checked })}
                        className="h-4 w-4 accent-[#d4af37]"
                        data-testid={`scan-toggle-${t.key}`}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={saveMut.isPending || !draft}
                    onClick={() => {
                      if (!draft) return;
                      // Only the toggles this panel manages — leaves each
                      // league's numeric thresholds untouched.
                      const patch: Partial<LineupIntegritySettings> = {};
                      for (const t of SCAN_SETTING_TOGGLES) patch[t.key] = draft[t.key] as any;
                      saveMut.mutate(patch);
                    }}
                    style={{ background: GOLD, color: "#1a1206" }}
                  >
                    {saveMut.isPending ? "Saving…" : "Apply to all leagues"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setDraft(null); }}>Cancel</Button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Small league logo for the scan table. Sleeper stores a bare avatar hash, so
 *  compose the CDN thumb URL unless it's already a full URL. Falls back to an
 *  initials circle when the league has no avatar (or the image 404s). */
function LeagueAvatar({ avatar, name }: { avatar: string | null; name: string }) {
  const [err, setErr] = useState(false);
  const src = avatar
    ? (avatar.startsWith("http") ? avatar : `https://sleepercdn.com/avatars/thumbs/${avatar}`)
    : null;
  if (src && !err) {
    return (
      <img
        src={src}
        alt={name}
        className="w-6 h-6 rounded-full object-cover flex-shrink-0 ring-1 ring-border/40"
        onError={() => setErr(true)}
      />
    );
  }
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="w-6 h-6 rounded-full flex-shrink-0 bg-[#0b3a7a]/20 dark:bg-blue-900/30 flex items-center justify-center ring-1 ring-border/40">
      <span className="text-[9px] font-bold text-[#0b3a7a] dark:text-blue-300">{initials}</span>
    </div>
  );
}

function MultiLeagueDashboard({
  leagueIds, nameById, avatarById, onOpenLeague,
}: {
  leagueIds: string[];
  nameById: Record<string, string>;
  avatarById: Record<string, string | null>;
  onOpenLeague: (id: string, week?: number) => void;
}) {
  const { toast } = useToast();
  // Two modes: live (current-week prevention) vs audit (completed-week review).
  // In audit mode we always surface all open issues across weeks.
  const [mode, setMode] = useState<ScanMode>("live");
  const [auditWeek] = useState<number | null>(null);
  // Which league row is expanded to show its individual issues (one at a time).
  const [expandedLeague, setExpandedLeague] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["li", "multi", leagueIds.join(","), mode, mode === "audit" ? (auditWeek ?? "all") : "live"],
    queryFn: () => api.multiLeague(
      leagueIds,
      mode === "live"
        ? { live: true }
        : auditWeek == null
          ? { allOpen: true }
          : { week: auditWeek },
    ),
  });

  // Re-scan every league in parallel, then refresh the dashboard. Per-league
  // failures don't abort the batch (allSettled) — we summarize what succeeded.
  const scanMut = useMutation({
    mutationFn: async () => {
      const weeks = mode === "audit" && auditWeek != null ? [auditWeek] : undefined;
      const results = await Promise.allSettled(leagueIds.map((id) => api.refresh(id, weeks)));
      let ok = 0, lineups = 0, alerts = 0;
      for (const res of results) {
        if (res.status !== "fulfilled") continue;
        ok++;
        lineups += res.value.lineupsChecked || 0;
        alerts += res.value.alertsCreated || 0;
      }
      return { ok, total: leagueIds.length, lineups, alerts };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["li", "multi"] });
      toast({
        title: `Scanned ${r.ok}/${r.total} leagues`,
        description: `${r.lineups} lineup${r.lineups === 1 ? "" : "s"} checked, ${r.alerts} issue${r.alerts === 1 ? "" : "s"} flagged.`,
      });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) return <Loading />;

  const rows = data?.leagues ?? [];
  const meta = MODE_META[mode];

  const sum = (fn: (r: MultiLeagueRow) => number) => rows.reduce((s, r) => s + fn(r), 0);
  // "Inactive Starters" card bundles every won't-play starter: OUT/IR (already
  // folded into inactiveStarters), bye-week, and empty slots.
  const inactiveStarters = sum((r) => r.inactiveStarters + r.byeStarters + r.emptySlots);
  const quesDoubStarters = sum((r) => r.questionableStarters + r.doubtfulStarters);
  const needsReview = sum((r) => r.needsReview);
  const resolved = sum((r) => r.resolvedThisWeek);

  // Mode sub-tabs (Current Week / Post-Week Audit) — styled and positioned like
  // the Lineup Command sub-tabs: navy active pill with a gold underline, sitting
  // in the page header (desktop) with a full-width variant below on mobile.
  const modeTabs = (variant: "desktop" | "mobile") => (
    <div
      className={cn(
        "grid rounded-2xl p-1 gap-1 h-12",
        variant === "desktop" ? "flex-shrink-0 w-[340px]" : "w-full",
        // Light: white inner with slate border.
        "bg-[var(--sc-card-bg)] border border-[var(--sc-border)]",
        // Dark: legacy translucent strip.
        "dark-any:bg-white/[0.04] dark-any:border-white/[0.07]",
      )}
      style={{ gridTemplateColumns: "1fr 1fr" }}
      data-testid={variant === "desktop" ? "li-mode-toggle" : "li-mode-toggle-mobile"}
    >
      {(["live", "audit"] as const).map((m) => {
        const isActive = mode === m;
        const Icon = m === "live" ? CalendarClock : CheckCircle2;
        return (
          <button
            key={m}
            onClick={() => setMode(m)}
            data-testid={variant === "desktop" ? `li-mode-${m}` : `li-mode-${m}-mobile`}
            className={cn(
              "relative flex items-center justify-center gap-2 font-semibold transition-all duration-200 rounded-xl text-[13px] tracking-[0.01em]",
              isActive
                // Active: navy bg, white text, gold underline (added below).
                ? "bg-[var(--sc-blue)] text-white shadow-[0_4px_12px_rgba(11,35,68,0.18)] dark-any:bg-[linear-gradient(135deg,rgba(11,58,122,0.85)_0%,rgba(11,58,122,0.65)_100%)] dark-any:shadow-[0_2px_12px_rgba(11,58,122,0.40),inset_0_1px_0_rgba(255,255,255,0.06)] dark-any:border dark-any:border-[#d4af37]/30"
                // Inactive: muted navy text, transparent bg, gentle hover.
                : "text-[var(--sc-text-muted)] hover:bg-[var(--sc-blue-soft)] hover:text-[var(--sc-blue)] dark-any:text-white/45 dark-any:hover:bg-transparent dark-any:hover:text-white/70",
            )}
          >
            <Icon className="w-[15px] h-[15px] flex-shrink-0" />
            {MODE_META[m].toggleLabel}
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
  );

  return (
    <div className="space-y-5">
      {/* Page header — title left, mode sub-tabs top-right (desktop). */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title={meta.scanLabel}
          subtitle={meta.tagline}
        />
        <div className="hidden md:flex flex-shrink-0 pt-1">{modeTabs("desktop")}</div>
      </div>

      {/* Mode sub-tabs (mobile) */}
      <div className="md:hidden !mt-3">{modeTabs("mobile")}</div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ScanKpiCard icon={UserX} label="Inactive Starters" value={inactiveStarters} accent="red" sub="Out · IR · Bye · Empty" />
        <ScanKpiCard icon={AlertCircle} label="Risky Starters" value={quesDoubStarters} accent="amber" sub="Questionable · Doubtful" />
        <ScanKpiCard icon={ListChecks} label="Needs Review" value={needsReview} accent="orange" sub="Open issues" />
        <ScanKpiCard icon={CheckCircle2} label="Resolved" value={resolved} accent="blue" sub="This week" />
      </div>

      {/* League table */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold">{meta.scanLabel}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{meta.tagline}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ScanSettingsButton leagueIds={leagueIds} />
            <Button
              size="sm"
              onClick={() => scanMut.mutate()}
              disabled={scanMut.isPending}
              style={{ background: GOLD, color: "#1a1206" }}
              data-testid="button-scan-leagues"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${scanMut.isPending ? "animate-spin" : ""}`} />
              {scanMut.isPending ? "Scanning…" : "Scan Leagues"}
            </Button>
          </div>
        </div>
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
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <table className="w-full text-sm" style={{ minWidth: 900 }}>
            <thead>
              {/* Header — navy in light mode, glass strip in dark. */}
              <tr className="bg-[var(--sc-blue)] dark-any:bg-white/[0.02] border-b border-[var(--sc-blue-2)] dark-any:border-white/6 text-[9px] uppercase tracking-widest text-white/70 dark-any:text-white/30">
                <th className="text-left font-bold px-3 md:px-5 py-2.5 whitespace-nowrap">League</th>
                {mode === "audit" ? (
                  <>
                    <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Final Issues</th>
                    <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Managers</th>
                    <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Matchups Impacted</th>
                  </>
                ) : (
                  <>
                    <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Managers</th>
                  </>
                )}
                <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">OUT/BYE/IR/EMPTY</th>
                <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">QUES/DOUB</th>
                <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Tanking</th>
                <th className="text-left font-bold px-2 py-2.5 whitespace-nowrap">Status</th>
                <th className="text-left font-bold px-2 py-2.5 whitespace-nowrap">Last Scanned</th>
                <th className="text-right font-bold px-2 md:px-5 py-2.5 whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody>
              {leagueIds.map((id) => {
                const r = rows.find((x) => x.leagueId === id);
                const status = r?.status ?? "data_pending";
                const noData = status === "best_ball_excluded" || status === "not_started" || status === "data_pending";
                const cell = (v: number | undefined) => (noData ? "—" : (v ?? 0));
                const actionable = status === "critical" || status === "needs_review";
                const isOpen = expandedLeague === id;
                const expandable = !noData;
                return (
                  <Fragment key={id}>
                  <tr
                    className={cn(
                      "border-b border-[#edf2f7] dark-any:border-white/5 last:border-0 hover:bg-[var(--sc-card-soft)] dark-any:hover:bg-white/[0.02] transition-colors",
                      expandable && "cursor-pointer",
                    )}
                    onClick={expandable ? () => setExpandedLeague(isOpen ? null : id) : undefined}
                  >
                    <td className="px-3 md:px-5 py-2.5 font-bold text-[var(--sc-blue)] dark-any:text-white/90">
                      <div className="flex items-center gap-2">
                        {expandable ? (
                          <ChevronRight className={cn("w-3.5 h-3.5 flex-shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                        ) : (
                          <span className="w-3.5 flex-shrink-0" />
                        )}
                        <LeagueAvatar avatar={avatarById[id] ?? null} name={nameById[id] ?? id} />
                        <span className="truncate">{nameById[id] ?? id}</span>
                      </div>
                    </td>
                    {mode === "audit" ? (
                      <>
                        <td className="px-2 py-2.5 text-center tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">
                          {noData ? "—" : (r!.totalIssues ? <span className="font-bold text-amber-600 dark-any:text-amber-500">{r!.totalIssues}</span> : 0)}
                        </td>
                        <td className="px-2 py-2.5 text-center tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{cell(r?.affectedManagers)}</td>
                        <td className="px-2 py-2.5 text-center tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">
                          {noData ? "—" : (r!.matchupsImpacted ? <span className="font-bold text-red-600 dark-any:text-red-500">{r!.matchupsImpacted}</span> : 0)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-2.5 text-center tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{cell(r?.affectedManagers)}</td>
                      </>
                    )}
                    <td className="px-2 py-2.5 text-center tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">
                      {noData ? "—" : (() => {
                        const v = (r!.inactiveStarters ?? 0) + (r!.byeStarters ?? 0) + (r!.emptySlots ?? 0);
                        return v ? <span className="font-bold text-red-600 dark-any:text-red-500">{v}</span> : 0;
                      })()}
                    </td>
                    <td className="px-2 py-2.5 text-center tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">
                      {noData ? "—" : (() => {
                        const v = (r!.questionableStarters ?? 0) + (r!.doubtfulStarters ?? 0);
                        return v ? <span className="font-bold text-amber-600 dark-any:text-amber-500">{v}</span> : 0;
                      })()}
                    </td>
                    <td className="px-2 py-2.5 text-center tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">
                      {noData ? "—" : (r!.tankingTeams ? <span className="font-bold text-red-600 dark-any:text-red-500">{r!.tankingTeams}</span> : 0)}
                    </td>
                    <td className="px-2 py-2.5"><Badge text={leagueStatusLabel(status, mode)} color={STATUS_META[status].color} /></td>
                    <td className="px-2 py-2.5 text-xs whitespace-nowrap text-[var(--sc-text-muted)] dark-any:text-white/40" title={r?.lastScanned ? new Date(r.lastScanned).toLocaleString() : undefined}>
                      {formatLastScanned(r?.lastScanned ?? null)}
                    </td>
                    <td className="px-2 md:px-5 py-2.5 text-right">
                      {status === "best_ball_excluded" || status === "not_started" ? (
                        <span className="text-xs text-[var(--sc-text-muted)] dark-any:text-white/40">—</span>
                      ) : (
                        <button
                          className="text-xs text-[#d4af37] hover:underline inline-flex items-center gap-1"
                          onClick={(e) => { e.stopPropagation(); onOpenLeague(id, r?.week ?? undefined); }}
                        >
                          {actionable ? <><AlertTriangle className="w-3.5 h-3.5" /> Review</> : <><CheckCircle2 className="w-3.5 h-3.5" /> View</>}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-[var(--sc-card-soft)] dark-any:bg-white/[0.02] border-b border-[#edf2f7] dark-any:border-white/5">
                      <td colSpan={mode === "audit" ? 10 : 8} className="px-3 md:px-5 py-3">
                        {(r?.alerts?.length ?? 0) === 0 ? (
                          <p className="text-xs text-[var(--sc-text-muted)] dark-any:text-white/40">No open issues this week for this league.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {r!.alerts.map((a) => (
                              <div key={a.id} className="flex items-start gap-2 text-xs">
                                <span className={cn("mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0",
                                  a.bucket === "critical" ? "bg-red-500" : a.bucket === "warning" ? "bg-amber-500" : "bg-sky-500")} />
                                <div className="min-w-0">
                                  <div className="font-semibold text-foreground">
                                    {a.teamName || a.managerName || `Roster ${a.rosterId}`}
                                    <span className="ml-1.5 font-normal text-[var(--sc-text-muted)] dark-any:text-white/40">{a.title}</span>
                                  </div>
                                  {a.description && <div className="text-[var(--sc-text-muted)] dark-any:text-white/40">{a.description}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Best ball leagues are excluded from manual lineup integrity checks because managers do not set weekly starting lineups.
        </p>
      </div>
    </div>
  );
}
