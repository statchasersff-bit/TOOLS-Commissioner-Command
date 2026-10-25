/**
 * Lineup Integrity — league-specific weekly audit (Commissioner decision-support).
 *
 * This is the drill-in view from the all-leagues Lineup Integrity triage. Where
 * the triage answers "which leagues need attention this week", this answers the
 * sharper question for ONE league:
 *
 *   "What exactly is wrong in this league this week, who is affected, and what
 *    should the commissioner do?"
 *
 * Read-only / action-assist ONLY: nothing here edits or submits a lineup or
 * messages a manager. Commissioner actions (resolve / ignore / note / copy
 * message / escalate) are recorded to an audit trail for dispute protection.
 */
import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { League } from "@/types";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import { useLeagueAvatars } from "@/hooks/useLeagueAvatars";
import { type RosterIdentity } from "@/lib/sleeperApi";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { SortableTh } from "@/components/SortableTh";
import { useSortableTable } from "@/hooks/useSortableTable";
import {
  RefreshCw, Loader2, ChevronLeft, ChevronRight, ChevronDown, ShieldAlert, AlertTriangle,
  Users, CircleSlash, UserX, CheckCircle2, ClipboardCopy, Flag, ExternalLink,
  StickyNote, Ban, ArrowUpRight, Eye, History, ListChecks, CalendarClock, Gavel,
  Layers,
} from "lucide-react";
import {
  lineupIntegrityApi,
  type LeagueWeekAudit, type AuditIssue,
  type IssueSeverity, type LeagueStatus,
  type CheckDetail, type PlayerCheckView, type AuditLogEntry, type ManagerHistoryRow,
  type StrikeRow,
} from "@/lib/lineupIntegrityApi";

const GOLD = "#d4af37";
const NON_STARTING = new Set(["BN", "IR", "TAXI"]);

// ── Status / severity styling ─────────────────────────────────────────────────

const LEAGUE_STATUS_META: Record<LeagueStatus, { label: string; cls: string }> = {
  clean: { label: "Clean", cls: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30" },
  needs_review: { label: "Needs Review", cls: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30" },
  critical: { label: "Critical", cls: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30" },
  resolved: { label: "Resolved", cls: "bg-sky-500/15 text-sky-600 dark-any:text-sky-400 border-sky-500/30" },
  data_pending: { label: "Data Pending", cls: "bg-muted text-muted-foreground border-border" },
  not_started: { label: "Not Started", cls: "bg-muted text-muted-foreground border-border" },
};

const SEVERITY_META: Record<IssueSeverity, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30" },
  warning: { label: "Warning", cls: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30" },
  info: { label: "Info", cls: "bg-sky-500/15 text-sky-600 dark-any:text-sky-400 border-sky-500/30" },
};

function Pill({ cls, children }: { cls: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", cls)}>
      {children}
    </span>
  );
}

const ISSUE_FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open Issues" },
  { id: "resolved", label: "Resolved" },
];

function isResolved(i: AuditIssue): boolean {
  return i.issueStatus === "resolved" || i.issueStatus === "ignored";
}

function matchesFilter(i: AuditIssue, filter: string): boolean {
  switch (filter) {
    case "open": return !isResolved(i);
    case "resolved": return isResolved(i);
    default: return true; // "all"
  }
}

// ── Summary cards ─────────────────────────────────────────────────────────────

const SUMMARY_ACCENT: Record<string, string> = {
  red:     "bg-red-500/10 text-red-600 dark-any:text-red-400",
  amber:   "bg-amber-500/10 text-amber-600 dark-any:text-amber-400",
  orange:  "bg-orange-500/10 text-orange-600 dark-any:text-orange-400",
  blue:    "bg-blue-500/10 text-blue-600 dark-any:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
  slate:   "bg-slate-500/10 text-slate-500 dark-any:text-slate-400",
};

// Icon-box KPI card mirroring the Live Lineup Check scan cards: tinted rounded
// icon on the left, value + label + sub stacked beside it.
function SummaryCard({ icon: Icon, label, value, accent = "slate", sub }: {
  icon: typeof Users; label: string; value: React.ReactNode;
  accent?: keyof typeof SUMMARY_ACCENT; sub?: string;
}) {
  return (
    <Card className="p-4 flex items-start gap-3 min-w-0">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", SUMMARY_ACCENT[accent])}>
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

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

type AuditSubTab = "issues" | "strikes" | "managers";

const AUDIT_SUB_TABS: { id: AuditSubTab; label: string; icon: typeof ListChecks }[] = [
  { id: "issues", label: "League Issues", icon: ListChecks },
  { id: "strikes", label: "Strike Tracker", icon: Gavel },
  { id: "managers", label: "Manager History", icon: History },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LeagueLineupAudit({ league, initialWeek }: { league: League; initialWeek?: number }) {
  const leagueId = league.id;
  const { toast } = useToast();

  const currentYear = new Date().getFullYear();
  const [week, setWeek] = useState<number | null>(initialWeek ?? null); // null → latest week with data
  const [filter, setFilter] = useState<string>("open");
  const [openIssue, setOpenIssue] = useState<AuditIssue | null>(null);
  const [subTab, setSubTab] = useState<AuditSubTab>("issues");

  const avatars = useLeagueAvatars(leagueId);

  // Resolve the active NFL season + current week from the state feed — the same
  // source the rest of the tool uses. Hardcoding the calendar year breaks in the
  // offseason, when Sleeper still reports the prior season: the audit would then
  // query a season with no scanned data and show "No data yet" even on the
  // Current option. Everything downstream (audit fetch, scan, drawer) keys off
  // this resolved season.
  const overviewQuery = useQuery({
    queryKey: ["li", leagueId, "current-week"],
    queryFn: () => lineupIntegrityApi.overview(leagueId),
  });
  const currentWeek = overviewQuery.data?.currentWeek ?? null;
  const season = overviewQuery.data?.season ?? String(currentYear);

  const auditQuery = useQuery({
    queryKey: ["li-audit", leagueId, season, week],
    queryFn: () => lineupIntegrityApi.leagueWeekAudit(leagueId, { week: week ?? undefined, season }),
    // Wait until the season feed has settled so we don't fetch the wrong
    // (calendar-year) season first; on a feed error we fall back to it and still
    // run rather than getting stuck.
    enabled: !overviewQuery.isLoading,
  });
  const audit = auditQuery.data;
  const effectiveWeek = week ?? audit?.week ?? 1;

  // Tanking risk isn't part of the audit payload — pull the per-roster checks
  // for the same week to count teams showing a tanking signal (score ≥ 25,
  // matching the Anti-Tanking review threshold).
  const checksQuery = useQuery({
    queryKey: ["li", leagueId, "checks", audit?.week ?? "latest"],
    queryFn: () => lineupIntegrityApi.checks(leagueId, { week: audit?.week }),
    enabled: !!audit,
  });
  const tankingCount = (checksQuery.data?.checks ?? []).filter((c) => c.tankingRiskScore >= 25).length;

  // Lineups for the current (or a future) NFL week aren't locked yet, so the
  // audit is VIEW-ONLY for those weeks: no reviews, notes, or strikes until the
  // week's results are final. No one should be penalized for a lineup they can
  // still change.
  const isLiveWeek = currentWeek != null && effectiveWeek >= currentWeek;
  // You can only scan through the current (in-progress) week — a future week
  // can't be scanned until the prior week is complete. Cap navigation and the
  // scan button accordingly (falls back to the full slate while currentWeek is
  // still loading/unknown).
  const maxScanWeek = currentWeek ?? 18;
  const isFutureWeek = currentWeek != null && effectiveWeek > currentWeek;

  const refreshMut = useMutation({
    mutationFn: () => lineupIntegrityApi.refresh(leagueId, [effectiveWeek], season),
    onSuccess: (r) => {
      if (r.skipped) {
        toast({ title: "Scan skipped", description: r.reason ?? "Nothing to scan." });
      } else {
        toast({ title: "Lineup scan complete", description: `${r.lineupsChecked} lineups checked, ${r.alertsCreated} alerts.` });
      }
      queryClient.invalidateQueries({ queryKey: ["li-audit", leagueId] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e?.message, variant: "destructive" }),
  });

  // During a live week lineups aren't locked, so nothing can legitimately be
  // resolved/acknowledged yet — every issue is just a preview. Force all
  // statuses to "open" so no stale "Resolved" badges leak into the preview.
  const issues = useMemo<AuditIssue[]>(() => {
    const raw = audit?.issues ?? [];
    return isLiveWeek ? raw.map((i) => ({ ...i, issueStatus: "open" as const })) : raw;
  }, [audit, isLiveWeek]);
  // The All / Open Issues / Resolved filters only make sense once the week is
  // final and real issues can be triaged. During a live week we show every
  // preview issue and hide the filter chips entirely.
  const filtered = issues.filter((i) => matchesFilter(i, isLiveWeek ? "all" : filter));
  const isBestBall = league.isBestBall === true;

  // Every team in the league (deduped), used to target a manually-issued strike.
  const strikeTeams = useMemo<StrikeTeam[]>(() => {
    const byRoster = new Map<number, StrikeTeam>();
    for (const m of audit?.matchups ?? []) {
      for (const t of m.teams) {
        if (!byRoster.has(t.rosterId)) {
          byRoster.set(t.rosterId, { rosterId: t.rosterId, managerName: t.managerName, teamName: t.teamName });
        }
      }
    }
    return Array.from(byRoster.values()).sort((a, b) =>
      (a.teamName || a.managerName).localeCompare(b.teamName || b.managerName));
  }, [audit]);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <SectionHeader
          title="Lineup Integrity"
          subtitle="Review weekly lineup issues, affected matchups, manager history, and commissioner actions for this league."
        />
        <Button
          onClick={() => refreshMut.mutate()}
          disabled={refreshMut.isPending || isFutureWeek}
          title={isFutureWeek ? `Week ${effectiveWeek} hasn't started yet — finish Week ${currentWeek} first.` : undefined}
          className="shrink-0"
          data-testid="button-refresh-audit"
        >
          {refreshMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* Controls */}
      <div className="mt-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={effectiveWeek <= 1}
            onClick={() => setWeek(Math.max(1, effectiveWeek - 1))} data-testid="button-prev-week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select
            value={week === null ? "current" : String(effectiveWeek)}
            onValueChange={(v) => setWeek(v === "current" ? null : Number(v))}
          >
            <SelectTrigger className="h-9 w-[120px]" data-testid="select-audit-week"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Current</SelectItem>
              {Array.from({ length: maxScanWeek }, (_, i) => i + 1).map((w) => (
                <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={effectiveWeek >= maxScanWeek}
            onClick={() => setWeek(Math.min(maxScanWeek, effectiveWeek + 1))} data-testid="button-next-week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {audit && (() => {
          // A live week can't be "Resolved" — re-derive a preview status from
          // the (all-open) issues instead of trusting stale alert statuses.
          const displayStatus: LeagueStatus = isLiveWeek && audit.status === "resolved"
            ? (issues.some((i) => i.severity === "critical") ? "critical" : issues.length > 0 ? "needs_review" : "clean")
            : audit.status;
          return (
            <Pill cls={LEAGUE_STATUS_META[displayStatus].cls}>
              <ShieldAlert className="h-3 w-3" /> {LEAGUE_STATUS_META[displayStatus].label}
            </Pill>
          );
        })()}
      </div>

      {/* Best ball / loading / empty states */}
      {isBestBall ? (
        <EmptyState icon={CircleSlash} title="Best ball league"
          body="Best ball leagues are excluded from manual lineup integrity checks because managers do not set weekly starting lineups." />
      ) : (week !== null && isLiveWeek) ? (
        // A specific week was picked that isn't final yet (the live week or a
        // future one). Lineups aren't locked, so the audit can't be trusted —
        // surface a clear "not available" state instead of a misleading preview.
        <EmptyState icon={CalendarClock}
          title={isFutureWeek ? `Week ${effectiveWeek} hasn’t started yet` : `Week ${effectiveWeek} isn’t final yet`}
          body={`The lineup audit for Week ${effectiveWeek} becomes available once the week’s results are final. Lineups aren’t locked yet, so managers can still change them — no one can be reviewed until the week is complete.`}
          action={<Button variant="outline" onClick={() => setWeek(null)} data-testid="button-view-current">
            <CalendarClock className="mr-2 h-4 w-4" /> View current</Button>} />
      ) : (overviewQuery.isLoading || auditQuery.isLoading) ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading week {effectiveWeek}…
        </div>
      ) : auditQuery.isError ? (
        <EmptyState icon={AlertTriangle} title="Couldn’t load this week"
          body={(auditQuery.error as any)?.message ?? "Try refreshing the scan."} />
      ) : !audit || audit.summary.totalTeams === 0 ? (
        <EmptyState icon={CalendarClock} title="No data yet"
          body={`Lineup data is not available yet for this league and Week ${effectiveWeek}. Click Refresh to scan Sleeper.`}
          action={<Button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
            {refreshMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh</Button>} />
      ) : (
        <>
          {/* Live-week guard — lineups aren't locked yet, so reviews/notes/strikes
              are disabled until the week is final. */}
          {isLiveWeek && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark-any:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                <b>Week {effectiveWeek} is still live.</b> Lineups aren’t locked yet, so this is a preview only — reviews, notes, and strikes are disabled until the week’s results are final.
              </span>
            </div>
          )}

          {/* Summary cards */}
          {(() => {
            const badStarters = audit.summary.emptyStarterSlots + audit.summary.inactiveStarters;
            const overRosteredLineups = audit.summary.overRosteredLineups;
            // Live week → nothing can be resolved yet; every issue is pending.
            const resolvedCount = isLiveWeek ? 0 : audit.summary.resolved;
            const pendingResolve = Math.max(0, audit.summary.totalIssues - resolvedCount);
            return (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <SummaryCard icon={UserX} label="Inactive Starters" value={badStarters} accent="red" sub="Out · IR · Bye · Empty" />
                <SummaryCard icon={Layers} label="Over Rostered Lineups" value={overRosteredLineups} accent="amber" sub="Too many starters" />
                <SummaryCard icon={AlertTriangle} label="Tanking" value={tankingCount} accent="orange" sub="Potential signals" />
                <SummaryCard icon={CheckCircle2} label="Resolved" value={resolvedCount} accent="blue" sub="This week" />
                <SummaryCard icon={CalendarClock} label="Pending Resolve" value={pendingResolve} accent="slate" sub="Open issues" />
              </div>
            );
          })()}

          {/* Sub-tab switcher */}
          <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border/60 mb-5 -mx-1 px-1">
            {AUDIT_SUB_TABS.map((t) => {
              const Icon = t.icon;
              const active = subTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSubTab(t.id)}
                  data-testid={`audit-subtab-${t.id}`}
                  className={cn("relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ background: GOLD }} />}
                </button>
              );
            })}
          </div>

          {/* League Issues */}
          {subTab === "issues" && (
            <>
              {audit.summary.totalIssues === 0 ? (
                <div className="mt-4">
                  <EmptyState icon={CheckCircle2} title="Clean week"
                    body={`No lineup integrity issues found for this league in Week ${audit.week}. All matchups are currently clean.`} />
                </div>
              ) : null}
              {!isLiveWeek && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {ISSUE_FILTERS.map((f) => (
                    <button key={f.id} onClick={() => setFilter(f.id)}
                      data-testid={`filter-issue-${f.id}`}
                      className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        filter === f.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70")}>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              <IssuesTable issues={filtered} avatars={avatars} onOpen={setOpenIssue} showStatus={!isLiveWeek} rosterPositions={league.rosterPositions ?? []} />
            </>
          )}

          {/* Strike Tracker */}
          {subTab === "strikes" && (
            <StrikeTrackerSection leagueId={leagueId} week={audit.week} teams={strikeTeams} avatars={avatars} readOnly={isLiveWeek} />
          )}

          {/* Manager History */}
          {subTab === "managers" && (
            <ManagerHistorySection leagueId={leagueId} avatars={avatars} />
          )}
        </>
      )}

      {/* Team Lineup Audit drawer */}
      <Sheet open={openIssue != null} onOpenChange={(o) => !o && setOpenIssue(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
          {openIssue && audit && (
            <TeamLineupAuditDrawer
              issue={openIssue}
              league={league}
              season={season}
              week={audit.week}
              readOnly={isLiveWeek}
              onClose={() => setOpenIssue(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The owner's Sleeper avatar circle (no name), sized to sit inline beside an
 *  existing team/manager label. Falls back to the initials circle when the
 *  league avatar map hasn't loaded or the owner has none. */
function OwnerAvatar({
  rosterId, name, avatars, size = "sm",
}: {
  rosterId: number;
  name: string;
  avatars: Record<number, RosterIdentity>;
  size?: "xs" | "sm" | "md";
}) {
  return (
    <SleeperUserAvatar
      username={name}
      avatar={avatars[rosterId]?.avatar ?? null}
      size={size}
      compact
    />
  );
}

// ── League Issues table ───────────────────────────────────────────────────────

function IssuesTable({ issues, avatars, onOpen, showStatus = true, rosterPositions = [] }: { issues: AuditIssue[]; avatars: Record<number, RosterIdentity>; onOpen: (i: AuditIssue) => void; showStatus?: boolean; rosterPositions?: string[] }) {
  const { sorted, sortKey, sortDir, toggle } = useSortableTable(issues, {
    manager: (i) => i.managerName || i.teamName,
    player: (i) => i.playerName,
    issue: (i) => i.issueType,
    status: (i) => i.issueStatus,
  });

  // Rows expand inline to show the full starting lineup + bench replacements.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  // Manager + Player + Issue + (Status) + Action, plus the leading expander cell.
  const colCount = (showStatus ? 5 : 4) + 1;

  if (issues.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No issues match the current filter.</p>;
  }
  return (
    <>
      {/* Desktop */}
      <Card className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-8 px-2 py-2" aria-hidden />
              <SortableTh sortKey="manager" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Manager</SortableTh>
              <SortableTh sortKey="player" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Player</SortableTh>
              <SortableTh sortKey="issue" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Issue</SortableTh>
              {showStatus && (
                <SortableTh sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Status</SortableTh>
              )}
              <th className="px-3 py-2 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => {
              const isOpen = expanded.has(i.id);
              return (
                <Fragment key={i.id}>
                  <tr
                    className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30"
                    onClick={() => toggleExpand(i.id)}
                    data-testid={`issue-row-${i.id}`}
                  >
                    <td className="px-2 py-2 text-muted-foreground">
                      <ChevronDown className={cn("h-4 w-4 transition-transform", !isOpen && "-rotate-90")} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <OwnerAvatar rosterId={i.rosterId} name={i.managerName || i.teamName} avatars={avatars} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{i.managerName}</div>
                          {i.teamName && i.teamName !== i.managerName && (
                            <div className="text-xs text-muted-foreground truncate">{i.teamName}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {i.playerName ? (
                        <PlayerAvatar id={i.playerId ?? ""} name={i.playerName} pos={i.position ?? ""} team={i.nflTeam ?? ""} size="xs" />
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div>{i.issueType}</div>
                      {i.isRepeatOffender && <span className="text-xs text-amber-500">repeat offender</span>}
                    </td>
                    {showStatus && <td className="px-3 py-2"><IssueStatusPill issue={i} /></td>}
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onOpen(i); }} data-testid={`button-open-issue-${i.id}`}>Review</Button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/60 last:border-0 bg-muted/20">
                      <td colSpan={colCount} className="px-4 py-4">
                        <CompactLineupDetail issue={i} checkId={i.checkId} rosterPositions={rosterPositions} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Mobile/tablet stacked cards */}
      <div className="grid gap-2 lg:hidden">
        {issues.map((i) => {
          const isOpen = expanded.has(i.id);
          return (
            <Card key={i.id} className="p-3">
              {showStatus && (
                <div className="flex items-center justify-end gap-2">
                  <IssueStatusPill issue={i} />
                </div>
              )}
              <button
                type="button"
                onClick={() => toggleExpand(i.id)}
                className="mt-2 flex w-full items-center gap-2 text-left text-sm font-semibold"
                data-testid={`issue-card-${i.id}`}
              >
                <ChevronDown className={cn("h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
                <OwnerAvatar rosterId={i.rosterId} name={i.managerName || i.teamName} avatars={avatars} />
                <span className="truncate">{i.teamName && i.teamName !== i.managerName ? `${i.managerName} · ${i.teamName}` : i.managerName}</span>
              </button>
              <div className="text-xs text-muted-foreground">{i.opponentTeamName ? `vs ${i.opponentTeamName}` : ""}</div>
              <div className="mt-1.5 text-sm">
                <span className="font-medium">{i.slot ?? "—"}</span> · {i.playerName ?? "—"} — {i.issueType}
              </div>
              {isOpen && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <CompactLineupDetail issue={i} checkId={i.checkId} rosterPositions={rosterPositions} />
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="outline" onClick={() => onOpen(i)}>Review</Button>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function IssueStatusPill({ issue }: { issue: AuditIssue }) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: "Open", cls: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30" },
    acknowledged: { label: "Acknowledged", cls: "bg-sky-500/15 text-sky-600 dark-any:text-sky-400 border-sky-500/30" },
    resolved: { label: "Resolved", cls: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30" },
    ignored: { label: "Ignored", cls: "bg-muted text-muted-foreground border-border" },
  };
  const m = map[issue.issueStatus] ?? map.open;
  return <Pill cls={m.cls}>{m.label}</Pill>;
}

// ── Team Lineup Audit drawer ──────────────────────────────────────────────────

function buildLineupRows(detail: CheckDetail, rosterPositions: string[]) {
  const startingSlots = (rosterPositions ?? []).filter((p) => !NON_STARTING.has(p));
  const pool = [...detail.starters];
  const rows: Array<{ slot: string; player: PlayerCheckView | null }> = [];
  for (const slot of startingSlots) {
    const idx = pool.findIndex((p) => p.lineupSlot === slot);
    if (idx >= 0) {
      rows.push({ slot, player: pool[idx] });
      pool.splice(idx, 1);
    } else {
      rows.push({ slot, player: null }); // empty starter slot
    }
  }
  // Any starters whose slot label didn't match (defensive) get appended.
  for (const p of pool) rows.push({ slot: p.lineupSlot ?? "FLEX", player: p });
  return rows;
}

function playerStatusLabel(p: PlayerCheckView): string {
  if (p.isOnBye) return "Bye";
  if (p.isIr) return "IR";
  const inj = (p.injuryStatus ?? "").toLowerCase();
  if (inj === "out" || inj === "o") return "Out";
  if (p.isInactive) return "Inactive";
  if (p.isDoubtful || inj === "doubtful" || inj === "d") return "Doubtful";
  if (inj === "questionable" || inj === "q") return "Questionable";
  return "Active";
}

function statusTone(label: string): string {
  if (label === "Active") return "text-emerald-600 dark-any:text-emerald-400";
  if (label === "Questionable" || label === "Doubtful") return "text-amber-600 dark-any:text-amber-400";
  if (label === "Empty") return "text-muted-foreground";
  return "text-red-600 dark-any:text-red-400";
}

// Eligible active bench options (not out/ir/bye), best projection first.
function eligibleBench(detail: CheckDetail | undefined, limit = 6): PlayerCheckView[] {
  return (detail?.bench ?? [])
    .filter((p) => !p.isIr && !p.isOnBye && !p.isInactive)
    .sort((a, b) => b.projection - a.projection)
    .slice(0, limit);
}

// Compact one-letter-ish status code for inline summaries: "Q", "D", "Out", …
function shortStatus(label: string): string {
  switch (label) {
    case "Questionable": return "Q";
    case "Doubtful": return "D";
    case "Out": return "Out";
    case "Inactive": return "Out";
    case "IR": return "IR";
    case "Bye": return "Bye";
    case "Empty": return "Empty";
    default: return label;
  }
}

// Full slot-by-slot starting lineup. Behind progressive disclosure in the inline
// row; always shown in the Team Lineup Audit drawer.
function StartingLineupTable({ detail, rosterPositions }: { detail: CheckDetail; rosterPositions: string[] }) {
  const lineupRows = buildLineupRows(detail, rosterPositions ?? []);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-2.5 py-1.5 font-semibold">Slot</th>
            <th className="px-2.5 py-1.5 font-semibold">Player</th>
            <th className="px-2.5 py-1.5 font-semibold">Pos</th>
            <th className="px-2.5 py-1.5 font-semibold">NFL</th>
            <th className="px-2.5 py-1.5 font-semibold">Status</th>
            <th className="px-2.5 py-1.5 font-semibold">Issue</th>
          </tr>
        </thead>
        <tbody>
          {lineupRows.map((r, idx) => {
            const label = r.player ? playerStatusLabel(r.player) : "Empty";
            const problem = !r.player || ["Out", "IR", "Bye", "Inactive"].includes(label);
            return (
              <tr key={idx} className={cn("border-b border-border/60 last:border-0", problem && "bg-red-500/[0.04]")}>
                <td className="px-2.5 py-1.5 font-medium">{r.slot}</td>
                <td className="px-2.5 py-1.5">{r.player?.playerName ?? <span className="text-muted-foreground">Empty</span>}</td>
                <td className="px-2.5 py-1.5 text-muted-foreground">{r.player?.position ?? "—"}</td>
                <td className="px-2.5 py-1.5 text-muted-foreground">{r.player?.team ?? "—"}</td>
                <td className={cn("px-2.5 py-1.5 font-medium", statusTone(label))}>{label}</td>
                <td className="px-2.5 py-1.5">
                  {!r.player ? <span className="text-xs text-red-500">Empty slot</span>
                    : r.player.betterBenchOption ? <span className="text-xs text-amber-500">Better bench option</span>
                    : problem ? <span className="text-xs text-red-500">{label}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// Tiny uppercase section label for the compact panel.
function MiniLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{children}</div>;
}

// Full starting lineup + eligible bench replacements — the deep dive shown in the
// Team Lineup Audit drawer (Review action).
function LineupDetailPanel({ checkId, rosterPositions }: { checkId: number; rosterPositions: string[] }) {
  const detailQuery = useQuery({
    queryKey: ["li-check-detail", checkId],
    queryFn: () => lineupIntegrityApi.checkDetail(checkId),
  });
  const detail = detailQuery.data;
  const benchOptions = eligibleBench(detail);
  const replacementContext = !detail
    ? "Bench data unavailable."
    : benchOptions.length > 0
      ? "An eligible active replacement was available on the bench."
      : "No eligible active replacement was available.";

  if (detailQuery.isLoading) {
    return <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading lineup…</div>;
  }
  if (!detail) return <p className="py-6 text-center text-sm text-muted-foreground">No detail available.</p>;

  return (
    <div className="space-y-5">
      {/* Full starting lineup */}
      <div>
        <SectionTitle icon={ListChecks}>Starting Lineup</SectionTitle>
        <StartingLineupTable detail={detail} rosterPositions={rosterPositions} />
      </div>

      {/* Eligible bench replacements */}
      <div>
        <SectionTitle icon={Users}>Eligible Bench Replacements</SectionTitle>
        {benchOptions.length > 0 ? (
          <BenchReplacementsTable options={benchOptions} />
        ) : (
          <p className="text-sm text-muted-foreground">No eligible active bench replacements found.</p>
        )}
        <p className="mt-2 text-xs">
          <span className="font-semibold">Replacement context: </span>
          <span className="text-muted-foreground">{replacementContext}</span>
        </p>
      </div>
    </div>
  );
}

// Compact inline detail for an expanded issue row. Defaults to just the flagged
// starter + top 3 replacements in a two-column layout; the full starting lineup
// and full bench list are progressive disclosure behind toggles.
function CompactLineupDetail({ issue, checkId, rosterPositions }: { issue: AuditIssue; checkId: number; rosterPositions: string[] }) {
  const [showFullLineup, setShowFullLineup] = useState(false);
  const [showAllBench, setShowAllBench] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["li-check-detail", checkId],
    queryFn: () => lineupIntegrityApi.checkDetail(checkId),
  });
  const detail = detailQuery.data;

  if (detailQuery.isLoading) {
    return <div className="py-4 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading lineup…</div>;
  }
  if (!detail) return <p className="py-4 text-center text-sm text-muted-foreground">No detail available.</p>;

  // The flagged starter: match by playerId, else by slot (empty slots have no player).
  const flagged = issue.playerId
    ? detail.starters.find((p) => p.playerId === issue.playerId) ?? null
    : detail.starters.find((p) => p.lineupSlot === issue.slot) ?? null;
  const slot = issue.slot ?? flagged?.lineupSlot ?? "—";
  const flaggedLabel = flagged ? playerStatusLabel(flagged) : "Empty";
  const flaggedName = flagged?.playerName ?? issue.playerName ?? "Empty slot";
  const flaggedProj = flagged?.projection ?? 0;

  const benchAll = eligibleBench(detail, 50);
  const best = benchAll[0];
  const top3 = benchAll.slice(0, 3);
  const moreCount = Math.max(0, benchAll.length - top3.length);
  const gap = best ? best.projection - flaggedProj : null;

  return (
    <div className="space-y-3">
      {/* One-line decision summary — what's flagged, the best swap, the gap. */}
      <div className="text-sm">
        <span className="font-semibold text-foreground">{flaggedName}</span>
        {flagged && <span className="text-muted-foreground"> ({shortStatus(flaggedLabel)})</span>}
        <span className="text-muted-foreground"> at {slot}</span>
        {best ? (
          <>
            <span className="mx-1.5 text-muted-foreground/60">→</span>
            <span className="text-muted-foreground">Best replacement: </span>
            <span className="font-semibold text-foreground">{best.playerName}</span>
            <span className="ml-1 tabular-nums text-muted-foreground">({best.projection.toFixed(1)})</span>
          </>
        ) : (
          <span className="ml-1.5 text-muted-foreground">· No eligible replacement available</span>
        )}
      </div>
      {best && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {gap !== null && (
            <span className={cn("font-bold tabular-nums", gap >= 0 ? "text-amber-600 dark-any:text-amber-400" : "text-muted-foreground")}>
              Gap: {gap >= 0 ? "+" : ""}{gap.toFixed(1)} pts
            </span>
          )}
          {moreCount > 0 && (
            <span className="text-muted-foreground">{moreCount} other eligible replacement{moreCount === 1 ? "" : "s"}</span>
          )}
        </div>
      )}

      {/* Two compact columns: the flagged starter, and the top replacements. */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Section A — Current Starter */}
        <div>
          <MiniLabel>Current Starter</MiniLabel>
          <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
            <span className="w-16 flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{slot}</span>
            {flagged ? (
              <>
                <div className="min-w-0 flex-1">
                  <PlayerAvatar id={flagged.playerId} name={flagged.playerName ?? "—"} pos={flagged.position ?? ""} team={flagged.team ?? ""} size="xs" />
                </div>
                <span className={cn("flex-shrink-0 text-xs font-medium", statusTone(flaggedLabel))}>{flaggedLabel}</span>
                <span className="flex-shrink-0 w-10 text-right text-sm font-bold tabular-nums text-foreground/90">{flaggedProj.toFixed(1)}</span>
              </>
            ) : (
              <span className="text-sm font-medium text-red-600 dark-any:text-red-400">Empty slot</span>
            )}
          </div>
        </div>

        {/* Section B — Top replacements (top 3, with progressive disclosure) */}
        <div>
          <MiniLabel>Best Replacements</MiniLabel>
          {top3.length === 0 ? (
            <p className="text-sm text-muted-foreground">No eligible active bench replacements found.</p>
          ) : (
            <div className="space-y-1">
              {top3.map((p, idx) => {
                const g = p.projection - flaggedProj;
                const label = playerStatusLabel(p);
                return (
                  <div key={p.playerId} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5">
                    <span className="w-4 flex-shrink-0 text-xs tabular-nums text-muted-foreground">{idx + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <PlayerAvatar id={p.playerId} name={p.playerName ?? "—"} pos={p.position ?? ""} team={p.team ?? ""} size="xs" />
                    </div>
                    <span className={cn("flex-shrink-0 text-xs font-medium", statusTone(label))}>{label}</span>
                    <span className="flex-shrink-0 w-10 text-right text-sm font-bold tabular-nums text-foreground/90">{p.projection.toFixed(1)}</span>
                    <span className={cn("flex-shrink-0 w-12 text-right text-xs font-semibold tabular-nums", g >= 0 ? "text-amber-600 dark-any:text-amber-400" : "text-muted-foreground")}>
                      {g >= 0 ? "+" : ""}{g.toFixed(1)}
                    </span>
                  </div>
                );
              })}
              {showAllBench && (
                <div className="pt-1">
                  <BenchReplacementsTable options={benchAll} />
                </div>
              )}
              {moreCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllBench((v) => !v)}
                  className="mt-0.5 text-xs font-medium text-[#0b3a7a] hover:underline dark-any:text-sky-400"
                >
                  {showAllBench ? "Hide bench options" : "Show all eligible bench options"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full starting lineup — progressive disclosure, not default content. */}
      <div>
        <button
          type="button"
          onClick={() => setShowFullLineup((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !showFullLineup && "-rotate-90")} />
          {showFullLineup ? "Hide full starting lineup" : "Show full starting lineup"}
        </button>
        {showFullLineup && (
          <div className="mt-2">
            <StartingLineupTable detail={detail} rosterPositions={rosterPositions} />
          </div>
        )}
      </div>
    </div>
  );
}

function TeamLineupAuditDrawer({
  issue, league, season, week, readOnly, onClose,
}: { issue: AuditIssue; league: League; season: string; week: number; readOnly?: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const leagueId = league.id;
  const avatars = useLeagueAvatars(leagueId);

  const historyQuery = useQuery({
    queryKey: ["li", leagueId, "history"],
    queryFn: () => lineupIntegrityApi.managerHistory(leagueId),
  });
  const auditLogQuery = useQuery({
    queryKey: ["li-audit-log", leagueId, season, issue.id],
    queryFn: () => lineupIntegrityApi.auditLog(leagueId, { season, lineupCheckId: issue.checkId, issueKey: issue.id }),
  });

  const managerRow: ManagerHistoryRow | undefined = historyQuery.data?.managers.find((m) => m.rosterId === issue.rosterId);

  const [note, setNote] = useState("");

  const record = async (action: string, extra?: string) => {
    try {
      await lineupIntegrityApi.appendAudit({
        leagueId, season, week, rosterId: issue.rosterId, lineupCheckId: issue.checkId,
        issueKey: issue.id, action, note: extra ?? null,
      });
      queryClient.invalidateQueries({ queryKey: ["li-audit-log", leagueId, season, issue.id] });
    } catch (e: any) {
      toast({ title: "Couldn’t record action", description: e?.message, variant: "destructive" });
    }
  };

  const updateAlertStatus = async (status: string) => {
    if (issue.alertId != null) {
      await lineupIntegrityApi.updateAlert(issue.alertId, { status }).catch(() => {});
    }
  };

  const markResolved = async () => {
    await updateAlertStatus("resolved");
    await record("marked_resolved", note || undefined);
    toast({ title: "Marked resolved" });
    queryClient.invalidateQueries({ queryKey: ["li-audit", leagueId] });
  };
  const ignoreWeek = async () => {
    await updateAlertStatus("dismissed");
    await record("ignored_week", note || undefined);
    toast({ title: "Ignored for this week" });
    queryClient.invalidateQueries({ queryKey: ["li-audit", leagueId] });
  };
  const escalate = async () => {
    await updateAlertStatus("acknowledged");
    await record("escalated", note || undefined);
    toast({ title: "Escalated", description: "Flagged for commissioner review." });
    queryClient.invalidateQueries({ queryKey: ["li-audit", leagueId] });
  };
  const addNote = async () => {
    if (!note.trim()) { toast({ title: "Add a note first", variant: "destructive" }); return; }
    if (issue.alertId != null) await lineupIntegrityApi.updateAlert(issue.alertId, { notes: note }).catch(() => {});
    await record("note_added", note.trim());
    setNote("");
    toast({ title: "Note added to audit log" });
  };

  const managerMessage = useMemo(() => {
    const issueText = issue.issueType.toLowerCase();
    if (issue.severity === "critical") {
      return `Hey, your Week ${week} lineup in ${league.name} had a locked lineup integrity issue: ${issueText}. I’m documenting it for commissioner review.`;
    }
    return `Hey, your Week ${week} lineup in ${league.name} has a potential issue: ${issueText}. Please update your lineup before kickoff if possible.`;
  }, [issue, week, league.name]);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(managerMessage);
      await record("message_copied");
      toast({ title: "Message copied", description: "Manager alert copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard unavailable.", variant: "destructive" });
    }
  };

  return (
    <div>
      <SheetHeader className="border-b border-border bg-muted/30 p-4">
        <SheetTitle className="flex items-center gap-2 text-base">
          <Eye className="h-4 w-4" style={{ color: GOLD }} /> Team Lineup Audit
        </SheetTitle>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <OwnerAvatar rosterId={issue.rosterId} name={issue.managerName || issue.teamName} avatars={avatars} />
            <span className="truncate"><b className="text-foreground">{issue.managerName}</b> · {issue.teamName}</span>
          </span>
          <span>Week {week} · {league.name}</span>
          <span>{issue.opponentTeamName ? `vs ${issue.opponentTeamName}` : "Matchup —"}</span>
          <span className="flex items-center gap-1.5">
            <Pill cls={SEVERITY_META[issue.severity].cls}>{SEVERITY_META[issue.severity].label}</Pill>
            <IssueStatusPill issue={issue} />
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-foreground">{issue.issueType}</p>
      </SheetHeader>

      <div className="space-y-5 p-4">
        {/* Commissioner actions — write-actions (resolve / ignore / escalate /
            copy message) are hidden while the week is live, since the lineup
            isn't locked and shouldn't be acted on yet. */}
        <div className="flex flex-wrap gap-1.5">
          {readOnly ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark-any:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" /> View only — lineups aren’t locked yet this week.
            </span>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={markResolved} data-testid="action-resolve"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Mark Resolved</Button>
              <Button size="sm" variant="outline" onClick={ignoreWeek}><Ban className="mr-1.5 h-3.5 w-3.5" />Ignore This Week</Button>
              <Button size="sm" variant="outline" onClick={copyMessage}><ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />Copy Manager Message</Button>
              <Button size="sm" variant="outline" onClick={escalate}><ArrowUpRight className="mr-1.5 h-3.5 w-3.5" />Escalate</Button>
            </>
          )}
          <a href={`https://sleeper.com/leagues/${leagueId}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />View on Sleeper</Button>
          </a>
          <Button size="sm" variant="ghost" onClick={onClose}><Flag className="mr-1.5 h-3.5 w-3.5" />View Matchup</Button>
        </div>

        {/* Suggested manager message preview */}
        <Card className="bg-muted/30 p-3 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested message</div>
          <p className="italic text-muted-foreground">{managerMessage}</p>
        </Card>

        {/* Full starting lineup + eligible bench replacements */}
        <LineupDetailPanel checkId={issue.checkId} rosterPositions={league.rosterPositions ?? []} />

        {/* Manager integrity history */}
        <div>
          <SectionTitle icon={History}>Manager Integrity History</SectionTitle>
          {managerRow ? (
            <Card className="p-3 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Weeks w/ issues" value={managerRow.weeksWithIssues.length} />
                <Stat label="Empty slots" value={managerRow.emptyStarterCount} />
                <Stat label="Inactive starters" value={managerRow.inactiveStarterCount} />
                <Stat label="Strikes" value={managerRow.strikes} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Season trend:</span>
                <span className="font-medium">{managerRow.weeksWithIssues.length} issue-week(s) of {managerRow.totalChecks}</span>
                <Pill cls={managerRow.weeksWithIssues.length >= 2 ? SEVERITY_META.warning.cls : SEVERITY_META.info.cls}>
                  {managerRow.weeksWithIssues.length >= 2 ? "Repeat offender" : "Not repeated"}
                </Pill>
              </div>
              {managerRow.weeksWithIssues.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {managerRow.weeksWithIssues.map((w) => (
                    <span key={w} className="rounded bg-muted px-1.5 py-0.5 text-xs">W{w}</span>
                  ))}
                </div>
              )}
            </Card>
          ) : historyQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading history…</p>
          ) : (
            <p className="text-sm text-muted-foreground">No season history yet for this manager.</p>
          )}
        </div>

        {/* Add commissioner note — disabled while the week is live. */}
        {!readOnly && (
          <div>
            <SectionTitle icon={StickyNote}>Commissioner Note</SectionTitle>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Document context for the record…" className="min-h-[70px]" data-testid="input-commish-note" />
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="outline" onClick={addNote}><StickyNote className="mr-1.5 h-3.5 w-3.5" />Add Note</Button>
            </div>
          </div>
        )}

        {/* Audit log */}
        <div>
          <SectionTitle icon={ListChecks}>Audit Log</SectionTitle>
          <AuditLogView issue={issue} entries={auditLogQuery.data?.entries ?? []} loading={auditLogQuery.isLoading} />
        </div>
      </div>
    </div>
  );
}

function BenchReplacementsTable({ options }: { options: PlayerCheckView[] }) {
  const { sorted, sortKey, sortDir, toggle } = useSortableTable(options, {
    player: (p) => p.playerName ?? p.playerId,
    pos: (p) => p.position,
    nfl: (p) => p.team,
    status: (p) => playerStatusLabel(p),
    proj: (p) => p.projection,
  }, { defaultKey: "proj", defaultDir: "desc" });
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <SortableTh sortKey="player" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2.5 py-1.5 font-semibold">Player</SortableTh>
            <SortableTh sortKey="pos" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2.5 py-1.5 font-semibold">Pos</SortableTh>
            <SortableTh sortKey="nfl" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2.5 py-1.5 font-semibold">NFL</SortableTh>
            <SortableTh sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2.5 py-1.5 font-semibold">Status</SortableTh>
            <SortableTh sortKey="proj" activeKey={sortKey} dir={sortDir} onSort={toggle} align="right" className="px-2.5 py-1.5 text-right font-semibold">Proj</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.playerId} className="border-b border-border/60 last:border-0">
              <td className="px-2.5 py-1.5">{p.playerName ?? p.playerId}</td>
              <td className="px-2.5 py-1.5 text-muted-foreground">{p.position ?? "—"}</td>
              <td className="px-2.5 py-1.5 text-muted-foreground">{p.team ?? "—"}</td>
              <td className={cn("px-2.5 py-1.5", statusTone(playerStatusLabel(p)))}>{playerStatusLabel(p)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{p.projection.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  detected: "Issue detected",
  message_copied: "Message copied",
  note_added: "Note added",
  marked_resolved: "Marked resolved",
  ignored_week: "Ignored this week",
  escalated: "Escalated",
  reopened: "Reopened",
};

function AuditLogView({ issue, entries, loading }: { issue: AuditIssue; entries: AuditLogEntry[]; loading: boolean }) {
  // Always lead with a synthetic "detected" event so there's a clear origin.
  const rows = useMemo(() => {
    const detected: AuditLogEntry = {
      id: -1, week: 0, rosterId: issue.rosterId, lineupCheckId: issue.checkId, issueKey: issue.id,
      action: "detected", actor: "System", note: issue.issueType, createdAt: null,
    };
    return [detected, ...entries];
  }, [entries, issue]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading audit log…</p>;
  return (
    <Card className="divide-y divide-border/60">
      {rows.map((e, idx) => (
        <div key={e.id === -1 ? `detected-${idx}` : e.id} className="flex items-start gap-2 p-2.5 text-sm">
          <UserX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>
              <span className="text-xs text-muted-foreground">{e.actor}</span>
              <span className="text-xs text-muted-foreground">{e.createdAt ? new Date(e.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</span>
            </div>
            {e.note && <div className="text-xs text-muted-foreground">{e.note}</div>}
          </div>
        </div>
      ))}
    </Card>
  );
}

// ── Strike Tracker ────────────────────────────────────────────────────────────

type StrikeTeam = { rosterId: number; managerName: string; teamName: string };

const STRIKE_TYPES = ["empty_lineup", "invalid_starter", "repeat_issue", "tanking_review", "manual"];
const STRIKE_SEVERITIES = ["low", "medium", "high", "critical"];

const STRIKE_SEVERITY_CLS: Record<string, string> = {
  low: "bg-sky-500/15 text-sky-600 dark-any:text-sky-400 border-sky-500/30",
  medium: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30",
  high: "bg-orange-500/15 text-orange-600 dark-any:text-orange-400 border-orange-500/30",
  critical: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30",
};

function IssueStrikeForm({ leagueId, week, teams, onDone }: {
  leagueId: string; week: number; teams: StrikeTeam[]; onDone: () => void;
}) {
  const { toast } = useToast();
  const [rosterId, setRosterId] = useState<number>(teams[0]?.rosterId ?? 0);
  const [strikeType, setStrikeType] = useState("manual");
  const [severity, setSeverity] = useState("medium");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const team = teams.find((t) => t.rosterId === rosterId);
  const selectCls = "rounded-lg border border-border/60 bg-card/40 px-2 py-1 text-xs";

  const mut = useMutation({
    mutationFn: () => lineupIntegrityApi.issueStrike({
      leagueId, week, rosterId, ownerId: null,
      managerName: team?.managerName ?? null, teamName: team?.teamName ?? null,
      strikeType, severity, reason, commissionerNotes: notes,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["li", leagueId] }); onDone(); },
    onError: (e: any) => toast({ title: "Failed to issue strike", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card className="mt-3 space-y-2 p-3">
      <div className="flex flex-wrap gap-2">
        <select value={rosterId} onChange={(e) => setRosterId(Number(e.target.value))} className={selectCls} data-testid="select-strike-team">
          {teams.map((t) => <option key={t.rosterId} value={t.rosterId}>{t.teamName || t.managerName || `Roster ${t.rosterId}`}</option>)}
        </select>
        <select value={strikeType} onChange={(e) => setStrikeType(e.target.value)} className={selectCls}>
          {STRIKE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={selectCls}>
          {STRIKE_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (documented with the strike)…" className="min-h-[52px]" data-testid="input-strike-reason" />
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Commissioner notes (optional)…" className="min-h-[40px]" />
      <div className="flex justify-end">
        <Button size="sm" disabled={!reason.trim() || mut.isPending} onClick={() => mut.mutate()} data-testid="button-document-strike">
          {mut.isPending ? "Saving…" : "Document Strike"}
        </Button>
      </div>
    </Card>
  );
}

function StrikeTrackerSection({ leagueId, week, teams, avatars, readOnly }: { leagueId: string; week: number; teams: StrikeTeam[]; avatars: Record<number, RosterIdentity>; readOnly?: boolean }) {
  const { toast } = useToast();
  const [showIssue, setShowIssue] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "strikes"],
    queryFn: () => lineupIntegrityApi.strikes(leagueId),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => lineupIntegrityApi.updateStrike(id, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["li", leagueId, "strikes"] }); toast({ title: "Strike updated" }); },
  });
  const strikes: StrikeRow[] = data?.strikes ?? [];

  const STRIKE_SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  const { sorted: sortedStrikes, sortKey, sortDir, toggle } = useSortableTable(strikes, {
    team: (s) => s.teamName || s.managerName || `Roster ${s.rosterId}`,
    type: (s) => s.strikeType,
    severity: (s) => STRIKE_SEVERITY_RANK[s.severity] ?? 0,
    week: (s) => s.week,
    reason: (s) => s.reason,
    status: (s) => s.status,
  });

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle icon={Gavel}>Strike Tracker</SectionTitle>
        {/* No new strikes while the week is live — lineups aren't locked yet. */}
        {!readOnly && teams.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setShowIssue((v) => !v)} data-testid="button-issue-strike">
            <Gavel className="mr-1.5 h-3.5 w-3.5" /> Issue Strike
          </Button>
        )}
      </div>
      {!readOnly && showIssue && teams.length > 0 && (
        <IssueStrikeForm
          leagueId={leagueId}
          week={week}
          teams={teams}
          onDone={() => { setShowIssue(false); toast({ title: "Strike issued" }); }}
        />
      )}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading strikes…</p>
      ) : strikes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No strikes issued for this league.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <SortableTh sortKey="team" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Team</SortableTh>
                <SortableTh sortKey="type" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Type</SortableTh>
                <SortableTh sortKey="severity" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Severity</SortableTh>
                <SortableTh sortKey="week" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Week</SortableTh>
                <SortableTh sortKey="reason" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Reason</SortableTh>
                <SortableTh sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Status</SortableTh>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedStrikes.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <OwnerAvatar rosterId={s.rosterId} name={s.teamName || s.managerName || `Roster ${s.rosterId}`} avatars={avatars} />
                      <span className="font-medium truncate">{s.teamName || s.managerName || `Roster ${s.rosterId}`}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{s.strikeType.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2"><Pill cls={STRIKE_SEVERITY_CLS[s.severity] ?? STRIKE_SEVERITY_CLS.medium}>{s.severity}</Pill></td>
                  <td className="px-3 py-2">{s.week || "—"}</td>
                  <td className="px-3 py-2 max-w-[260px] truncate text-muted-foreground" title={s.reason}>{s.reason}</td>
                  <td className="px-3 py-2 capitalize">{s.status}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {s.status === "active" && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => updateMut.mutate({ id: s.id, status: "overturned" })} data-testid={`button-strike-overturn-${s.id}`}>Overturn</Button>
                        <Button size="sm" variant="ghost" onClick={() => updateMut.mutate({ id: s.id, status: "resolved" })} data-testid={`button-strike-resolve-${s.id}`}>Resolve</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── Manager History ───────────────────────────────────────────────────────────

function integrityColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#84cc16";
  if (score >= 50) return "#eab308";
  if (score >= 25) return "#f97316";
  return "#ef4444";
}

function ManagerHistorySection({ leagueId, avatars }: { leagueId: string; avatars: Record<number, RosterIdentity> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "history"],
    queryFn: () => lineupIntegrityApi.managerHistory(leagueId),
  });
  const managers: ManagerHistoryRow[] = data?.managers ?? [];

  const { sorted, sortKey, sortDir, toggle } = useSortableTable(managers, {
    manager: (m) => m.teamName || m.managerName,
    checks: (m) => m.totalChecks,
    integrity: (m) => m.averageIntegrityScore,
    empty: (m) => m.emptyStarterCount,
    bye: (m) => m.byeStarterCount,
    inactive: (m) => m.inactiveStarterCount,
    susp: (m) => m.suspiciousBenchingCount,
    strikes: (m) => m.strikes,
    worst: (m) => m.worstWeek?.integrityScore ?? null,
  });

  return (
    <div className="mt-6">
      <SectionTitle icon={History}>Manager History</SectionTitle>
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading history…</p>
      ) : managers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No history yet — run lineup checks across a few weeks to build manager patterns.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <SortableTh sortKey="manager" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-3 py-2 font-semibold">Manager</SortableTh>
                <SortableTh sortKey="checks" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-3 py-2 text-center font-semibold">Checks</SortableTh>
                <SortableTh sortKey="integrity" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-3 py-2 text-center font-semibold">Avg Integrity</SortableTh>
                <SortableTh sortKey="empty" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-3 py-2 text-center font-semibold">Empty</SortableTh>
                <SortableTh sortKey="bye" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-3 py-2 text-center font-semibold">Bye</SortableTh>
                <SortableTh sortKey="inactive" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-3 py-2 text-center font-semibold">Inactive</SortableTh>
                <SortableTh sortKey="susp" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-3 py-2 text-center font-semibold">Susp.</SortableTh>
                <SortableTh sortKey="strikes" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-3 py-2 text-center font-semibold">Strikes</SortableTh>
                <SortableTh sortKey="worst" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="px-3 py-2 text-center font-semibold">Worst Wk</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.rosterId} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <OwnerAvatar rosterId={m.rosterId} name={m.teamName || m.managerName} avatars={avatars} />
                      <span className="font-medium truncate">{m.teamName || m.managerName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">{m.totalChecks}</td>
                  <td className="px-3 py-2 text-center"><span className="font-bold" style={{ color: integrityColor(m.averageIntegrityScore) }}>{m.averageIntegrityScore}</span></td>
                  <td className="px-3 py-2 text-center">{m.emptyStarterCount || "—"}</td>
                  <td className="px-3 py-2 text-center">{m.byeStarterCount || "—"}</td>
                  <td className="px-3 py-2 text-center">{m.inactiveStarterCount || "—"}</td>
                  <td className="px-3 py-2 text-center">{m.suspiciousBenchingCount || "—"}</td>
                  <td className="px-3 py-2 text-center">{m.strikes || "—"}</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">{m.worstWeek ? `W${m.worstWeek.week} (${m.worstWeek.integrityScore})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <div className="h-4 w-[3px] rounded-full" style={{ background: GOLD }} />
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-bold">{children}</h3>
    </div>
  );
}

function EmptyState({ icon: Icon, title, body, action }: { icon: typeof Users; title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card className="border-border/60">
      <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
        <Icon className="mb-3 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{body}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </Card>
  );
}
