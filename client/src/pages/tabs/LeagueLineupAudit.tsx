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
import { useMemo, useState } from "react";
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
import {
  RefreshCw, Loader2, ChevronLeft, ChevronRight, ShieldAlert, AlertTriangle,
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
  { id: "critical", label: "Critical" },
  { id: "warning", label: "Warnings" },
  { id: "empty", label: "Empty Slots" },
  { id: "out_ir", label: "Out/IR" },
  { id: "bye", label: "Bye Week" },
  { id: "repeat", label: "Repeated Issues" },
  { id: "resolved", label: "Resolved" },
];

function matchesFilter(i: AuditIssue, filter: string): boolean {
  switch (filter) {
    case "all": return true;
    case "critical": return i.severity === "critical";
    case "warning": return i.severity === "warning";
    case "empty": return i.category === "empty_slot";
    case "out_ir": return i.category === "out" || i.category === "ir" || i.category === "inactive";
    case "bye": return i.category === "bye";
    case "repeat": return i.isRepeatOffender;
    case "resolved": return i.issueStatus === "resolved" || i.issueStatus === "ignored";
    default: return true;
  }
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <Card className="p-3 border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-br from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628]">
      <div className="flex items-center gap-2">
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ring-1",
          accent ? "bg-[#d4af37]/10 ring-[#d4af37]/15" : "bg-muted/40 ring-border/40")}>
          <Icon className={cn("w-3.5 h-3.5", accent ? "text-[#d4af37]" : "text-muted-foreground")} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none truncate">{label}</p>
          <p className="text-lg font-bold leading-tight mt-0.5">{value}</p>
        </div>
      </div>
    </Card>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LeagueLineupAudit({ league, initialWeek }: { league: League; initialWeek?: number }) {
  const leagueId = league.id;
  const { toast } = useToast();

  const currentYear = new Date().getFullYear();
  const [season] = useState<string>(String(currentYear));
  const [week, setWeek] = useState<number | null>(initialWeek ?? null); // null → latest week with data
  const [filter, setFilter] = useState<string>("all");
  const [openIssue, setOpenIssue] = useState<AuditIssue | null>(null);

  const avatars = useLeagueAvatars(leagueId);

  const auditQuery = useQuery({
    queryKey: ["li-audit", leagueId, season, week],
    queryFn: () => lineupIntegrityApi.leagueWeekAudit(leagueId, { week: week ?? undefined, season }),
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

  const issues = audit?.issues ?? [];
  const filtered = issues.filter((i) => matchesFilter(i, filter));
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
        <Button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending} className="shrink-0" data-testid="button-refresh-audit">
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
          <Select value={String(effectiveWeek)} onValueChange={(v) => setWeek(Number(v))}>
            <SelectTrigger className="h-9 w-[110px]" data-testid="select-audit-week"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={effectiveWeek >= 18}
            onClick={() => setWeek(Math.min(18, effectiveWeek + 1))} data-testid="button-next-week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Button variant="ghost" size="sm" onClick={() => setWeek(null)} data-testid="button-current-week">
          <CalendarClock className="mr-1.5 h-4 w-4" /> Current
        </Button>

        {audit && (
          <Pill cls={LEAGUE_STATUS_META[audit.status].cls}>
            <ShieldAlert className="h-3 w-3" /> {LEAGUE_STATUS_META[audit.status].label}
          </Pill>
        )}
      </div>

      {/* Best ball / loading / empty states */}
      {isBestBall ? (
        <EmptyState icon={CircleSlash} title="Best ball league"
          body="Best ball leagues are excluded from manual lineup integrity checks because managers do not set weekly starting lineups." />
      ) : auditQuery.isLoading ? (
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
          {/* Summary cards */}
          {(() => {
            const badStarters = audit.summary.emptyStarterSlots + audit.summary.inactiveStarters;
            const overRosteredLineups = audit.summary.overRosteredLineups;
            const pendingResolve = Math.max(0, audit.summary.totalIssues - audit.summary.resolved);
            return (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <SummaryCard icon={UserX} label="Empty/Out/Bye/IR Starters" accent={badStarters > 0} value={badStarters} />
                <SummaryCard icon={Layers} label="Over Rostered Lineups" accent={overRosteredLineups > 0} value={overRosteredLineups} />
                <SummaryCard icon={AlertTriangle} label="Tanking" accent={tankingCount > 0} value={tankingCount} />
                <SummaryCard icon={CheckCircle2} label="Resolved" value={audit.summary.resolved} />
                <SummaryCard icon={CalendarClock} label="Pending Resolve" accent={pendingResolve > 0} value={pendingResolve} />
              </div>
            );
          })()}

          {audit.summary.totalIssues === 0 ? (
            <div className="mt-4">
              <EmptyState icon={CheckCircle2} title="Clean week"
                body={`No lineup integrity issues found for this league in Week ${audit.week}. All matchups are currently clean.`} />
            </div>
          ) : null}

          {/* League Issues */}
          <div className="mt-6">
            <SectionTitle icon={ListChecks}>League Issues</SectionTitle>
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
            <IssuesTable issues={filtered} avatars={avatars} onOpen={setOpenIssue} />
          </div>

          {/* Strike Tracker */}
          <StrikeTrackerSection leagueId={leagueId} week={audit.week} teams={strikeTeams} avatars={avatars} />

          {/* Manager History */}
          <ManagerHistorySection leagueId={leagueId} avatars={avatars} />
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

function IssuesTable({ issues, avatars, onOpen }: { issues: AuditIssue[]; avatars: Record<number, RosterIdentity>; onOpen: (i: AuditIssue) => void }) {
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
              <th className="px-3 py-2 font-semibold">Severity</th>
              <th className="px-3 py-2 font-semibold">Manager</th>
              <th className="px-3 py-2 font-semibold">Player</th>
              <th className="px-3 py-2 font-semibold">Issue</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2"><Pill cls={SEVERITY_META[i.severity].cls}>{SEVERITY_META[i.severity].label}</Pill></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <OwnerAvatar rosterId={i.rosterId} name={i.managerName || i.teamName} avatars={avatars} />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{i.managerName}</div>
                      <div className="text-xs text-muted-foreground truncate">{i.teamName}</div>
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
                <td className="px-3 py-2"><IssueStatusPill issue={i} /></td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => onOpen(i)} data-testid={`button-open-issue-${i.id}`}>Review</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Mobile/tablet stacked cards */}
      <div className="grid gap-2 lg:hidden">
        {issues.map((i) => (
          <Card key={i.id} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <Pill cls={SEVERITY_META[i.severity].cls}>{SEVERITY_META[i.severity].label}</Pill>
              <IssueStatusPill issue={i} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
              <OwnerAvatar rosterId={i.rosterId} name={i.managerName || i.teamName} avatars={avatars} />
              <span className="truncate">{i.managerName} · {i.teamName}</span>
            </div>
            <div className="text-xs text-muted-foreground">{i.opponentTeamName ? `vs ${i.opponentTeamName}` : ""}</div>
            <div className="mt-1.5 text-sm">
              <span className="font-medium">{i.slot ?? "—"}</span> · {i.playerName ?? "—"} — {i.issueType}
            </div>
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => onOpen(i)}>Review</Button>
            </div>
          </Card>
        ))}
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

function TeamLineupAuditDrawer({
  issue, league, season, week, onClose,
}: { issue: AuditIssue; league: League; season: string; week: number; onClose: () => void }) {
  const { toast } = useToast();
  const leagueId = league.id;
  const avatars = useLeagueAvatars(leagueId);

  const detailQuery = useQuery({
    queryKey: ["li-check-detail", issue.checkId],
    queryFn: () => lineupIntegrityApi.checkDetail(issue.checkId),
  });
  const historyQuery = useQuery({
    queryKey: ["li", leagueId, "history"],
    queryFn: () => lineupIntegrityApi.managerHistory(leagueId),
  });
  const auditLogQuery = useQuery({
    queryKey: ["li-audit-log", leagueId, season, issue.id],
    queryFn: () => lineupIntegrityApi.auditLog(leagueId, { season, lineupCheckId: issue.checkId, issueKey: issue.id }),
  });

  const detail = detailQuery.data;
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

  const lineupRows = detail ? buildLineupRows(detail, league.rosterPositions ?? []) : [];
  // Eligible active bench options (not out/ir/bye), best projection first.
  const benchOptions = (detail?.bench ?? [])
    .filter((p) => !p.isIr && !p.isOnBye && !p.isInactive)
    .sort((a, b) => b.projection - a.projection)
    .slice(0, 6);
  const replacementContext = !detail
    ? "Bench data unavailable."
    : benchOptions.length > 0
      ? "An eligible active replacement was available on the bench."
      : "No eligible active replacement was available.";

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
        {/* Commissioner actions */}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={markResolved} data-testid="action-resolve"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Mark Resolved</Button>
          <Button size="sm" variant="outline" onClick={ignoreWeek}><Ban className="mr-1.5 h-3.5 w-3.5" />Ignore This Week</Button>
          <Button size="sm" variant="outline" onClick={copyMessage}><ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />Copy Manager Message</Button>
          <Button size="sm" variant="outline" onClick={escalate}><ArrowUpRight className="mr-1.5 h-3.5 w-3.5" />Escalate</Button>
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

        {/* Full starting lineup */}
        <div>
          <SectionTitle icon={ListChecks}>Starting Lineup</SectionTitle>
          {detailQuery.isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</div>
          ) : (
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
          )}
        </div>

        {/* Eligible bench replacements */}
        <div>
          <SectionTitle icon={Users}>Eligible Bench Replacements</SectionTitle>
          {benchOptions.length > 0 ? (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2.5 py-1.5 font-semibold">Player</th>
                    <th className="px-2.5 py-1.5 font-semibold">Pos</th>
                    <th className="px-2.5 py-1.5 font-semibold">NFL</th>
                    <th className="px-2.5 py-1.5 font-semibold">Status</th>
                    <th className="px-2.5 py-1.5 text-right font-semibold">Proj</th>
                  </tr>
                </thead>
                <tbody>
                  {benchOptions.map((p) => (
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
          ) : (
            <p className="text-sm text-muted-foreground">No eligible active bench replacements found.</p>
          )}
          <p className="mt-2 text-xs">
            <span className="font-semibold">Replacement context: </span>
            <span className="text-muted-foreground">{replacementContext}</span>
          </p>
        </div>

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

        {/* Add commissioner note */}
        <div>
          <SectionTitle icon={StickyNote}>Commissioner Note</SectionTitle>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Document context for the record…" className="min-h-[70px]" data-testid="input-commish-note" />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="outline" onClick={addNote}><StickyNote className="mr-1.5 h-3.5 w-3.5" />Add Note</Button>
          </div>
        </div>

        {/* Audit log */}
        <div>
          <SectionTitle icon={ListChecks}>Audit Log</SectionTitle>
          <AuditLogView issue={issue} entries={auditLogQuery.data?.entries ?? []} loading={auditLogQuery.isLoading} />
        </div>
      </div>
    </div>
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

function StrikeTrackerSection({ leagueId, week, teams, avatars }: { leagueId: string; week: number; teams: StrikeTeam[]; avatars: Record<number, RosterIdentity> }) {
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

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle icon={Gavel}>Strike Tracker</SectionTitle>
        {teams.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setShowIssue((v) => !v)} data-testid="button-issue-strike">
            <Gavel className="mr-1.5 h-3.5 w-3.5" /> Issue Strike
          </Button>
        )}
      </div>
      {showIssue && teams.length > 0 && (
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
                <th className="px-3 py-2 font-semibold">Team</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Severity</th>
                <th className="px-3 py-2 font-semibold">Week</th>
                <th className="px-3 py-2 font-semibold">Reason</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {strikes.map((s) => (
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
                <th className="px-3 py-2 font-semibold">Manager</th>
                <th className="px-3 py-2 text-center font-semibold">Checks</th>
                <th className="px-3 py-2 text-center font-semibold">Avg Integrity</th>
                <th className="px-3 py-2 text-center font-semibold">Empty</th>
                <th className="px-3 py-2 text-center font-semibold">Bye</th>
                <th className="px-3 py-2 text-center font-semibold">Inactive</th>
                <th className="px-3 py-2 text-center font-semibold">Susp.</th>
                <th className="px-3 py-2 text-center font-semibold">Strikes</th>
                <th className="px-3 py-2 text-center font-semibold">Worst Wk</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => (
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
