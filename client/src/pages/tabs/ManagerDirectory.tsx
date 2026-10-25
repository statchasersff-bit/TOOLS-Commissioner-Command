/**
 * Manager Directory — Commissioner Command ▸ Activity ▸ Managers.
 *
 * A commissioner-facing manager database. For every manager across the
 * commissioner's leagues it answers: who is this, how many of my leagues are
 * they in, how active are they, do they have issues, and are they a VERIFIED
 * StatChasers account (system-controlled badge — commissioners can't set it).
 *
 * Cross-league surface: like the All-League Scan it self-resolves the
 * commissioner's leagues from SleeperContext and needs no single active league.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSleeper } from "@/contexts/SleeperContext";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SortableTh } from "@/components/SortableTh";
import { useSortableTable } from "@/hooks/useSortableTable";
import {
  Users, BadgeCheck, ShieldQuestion, AlertTriangle, RefreshCw, Search,
  Flag, CreditCard, LayoutGrid, ArrowRight, X, Activity,
} from "lucide-react";
import {
  fetchManagerDirectory,
  activityStatusColor, ACTIVITY_STATUS_DISPLAY, VERIFICATION_DISPLAY, lastSeenLabel,
  type ManagerDirectoryItem, type ActivityStatus,
} from "@/lib/managerDirectoryApi";

const GOLD = "#d4af37";

type QuickFilter = "all" | "verified" | "unverified" | "multi" | "flagged" | "payments";

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All Managers" },
  { id: "verified", label: "Verified" },
  { id: "unverified", label: "Unverified" },
  { id: "multi", label: "In Multiple Leagues" },
  { id: "flagged", label: "Flagged" },
  { id: "payments", label: "Payment Issues" },
];

// Rank activity status so the Activity column sorts by engagement level
// (active → quiet → inactive → unknown) rather than alphabetically.
const ACTIVITY_RANK: Record<ActivityStatus, number> = {
  active: 3, quiet: 2, inactive: 1, unknown: 0,
};

// ── Verified badge ─────────────────────────────────────────────────────────────
// Small, premium, tooltip-backed. Gold check = verified; amber = mismatch.
// Nothing renders for unverified/claim so rows stay quiet.
function VerifiedBadge({ status, size = 14 }: { status: ManagerDirectoryItem["verificationStatus"]; size?: number }) {
  if (status === "unverified" || status === "claim_pending") return null;
  const isMismatch = status === "mismatch";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex flex-shrink-0" data-testid={`verified-badge-${status}`}>
          {isMismatch ? (
            <AlertTriangle size={size} className="text-amber-500" />
          ) : (
            <BadgeCheck size={size} style={{ color: GOLD }} fill="rgba(212,175,55,0.15)" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">
        {VERIFICATION_DISPLAY[status].tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function KpiCard({ icon: Icon, label, value, accent = "slate" }: {
  icon: typeof Users; label: string; value: React.ReactNode;
  accent?: "gold" | "blue" | "red" | "slate";
}) {
  const colorByAccent: Record<string, string> = {
    gold: "bg-[#d4af37]/10 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]",
    blue: "bg-blue-500/10 text-blue-600 dark-any:text-blue-400",
    red: "bg-red-500/10 text-red-600 dark-any:text-red-400",
    slate: "bg-slate-500/10 text-slate-500 dark-any:text-slate-400",
  };
  return (
    <Card className="p-4 flex items-start gap-3 min-w-0">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", colorByAccent[accent])}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold tabular-nums leading-tight text-foreground">{value}</p>
        <p className="text-[11px] font-medium leading-tight mt-0.5 text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

// Manager identity cell — avatar + username (+ verified check). The directory
// identifies managers by their Sleeper username only; team names are not shown.
function ManagerIdentity({ m }: { m: ManagerDirectoryItem }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <SleeperUserAvatar username={m.sleeperUsername} avatar={m.avatar} size="sm" compact />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-bold truncate text-[var(--sc-blue)] dark-any:text-white/90">
            {m.sleeperUsername}
          </span>
          <VerifiedBadge status={m.verificationStatus} />
        </div>
      </div>
    </div>
  );
}

function FlagPill({ count, tone }: { count: number; tone: "flag" | "payment" }) {
  if (!count) return <span className="text-[var(--sc-text-muted)] dark-any:text-white/40">0</span>;
  const cls = tone === "flag"
    ? "text-amber-600 dark-any:text-amber-400"
    : "text-red-600 dark-any:text-red-400";
  return <span className={cn("font-bold tabular-nums", cls)}>{count}</span>;
}

const num = (v: number | null | undefined) => (v == null ? "—" : v);

export default function ManagerDirectory() {
  const sleeper = useSleeper();
  const leagues = sleeper.leagues;
  const leagueIds = leagues.map((l) => l.leagueId);
  const idsKey = leagueIds.join(",");

  const [quick, setQuick] = useState<QuickFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ManagerDirectoryItem | null>(null);

  const q = useQuery({
    queryKey: ["manager-directory", idsKey],
    queryFn: () => fetchManagerDirectory(leagueIds),
    enabled: leagueIds.length > 0,
  });

  const managers = q.data?.managers ?? [];

  const counts = useMemo(() => ({
    total: managers.length,
    verified: managers.filter((m) => m.verifiedStatChasersAccount).length,
    multi: managers.filter((m) => m.commissionerLeagueCount > 1).length,
    flagged: managers.filter((m) => m.activeFlagsCount > 0).length,
    payments: managers.filter((m) => m.paymentIssuesCount > 0).length,
  }), [managers]);

  const filtered = useMemo(() => {
    let list = managers;
    if (quick === "verified") list = list.filter((m) => m.verifiedStatChasersAccount);
    else if (quick === "unverified") list = list.filter((m) => !m.verifiedStatChasersAccount);
    else if (quick === "multi") list = list.filter((m) => m.commissionerLeagueCount > 1);
    else if (quick === "flagged") list = list.filter((m) => m.activeFlagsCount > 0);
    else if (quick === "payments") list = list.filter((m) => m.paymentIssuesCount > 0);

    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (m) =>
          m.sleeperUsername.toLowerCase().includes(term) ||
          m.teamName.toLowerCase().includes(term) ||
          m.displayName.toLowerCase().includes(term),
      );
    }
    return list;
  }, [managers, quick, search]);

  // Columns sort client-side via the shared table hook; defaults to "Your
  // Leagues" descending (the old "Most leagues with you" ordering).
  const { sorted: rows, sortKey, sortDir, toggle } = useSortableTable(
    filtered,
    {
      name: (m) => m.sleeperUsername,
      shared: (m) => m.commissionerLeagueCount,
      known: (m) => m.knownSleeperLeagueCount,
      flags: (m) => m.activeFlagsCount,
      payments: (m) => m.paymentIssuesCount,
      activity: (m) => ACTIVITY_RANK[m.activityStatus],
    },
    { defaultKey: "shared", defaultDir: "desc" },
  );

  if (!sleeper.isConnected) {
    return (
      <Card className="border-border/60">
        <div className="flex flex-col items-center justify-center text-center py-14 px-4">
          <Users className="w-8 h-8 text-muted-foreground/60 mb-3" />
          <p className="text-sm font-semibold text-foreground">Connect a Sleeper account</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Link your Sleeper username to build a directory of every manager across your leagues.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Manager Directory"
          subtitle="Every manager across your leagues — how many of your leagues they're in, their activity, issues, and whether they're a verified StatChasers account."
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => q.refetch()}
          disabled={q.isFetching || leagueIds.length === 0}
          data-testid="button-refresh-directory"
          className="flex-shrink-0"
        >
          <RefreshCw className={cn("w-4 h-4 mr-1.5", q.isFetching && "animate-spin")} />
          {q.isFetching ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Users} label="Managers" value={counts.total} accent="blue" />
        <KpiCard icon={BadgeCheck} label="Verified Accounts" value={counts.verified} accent="gold" />
        <KpiCard icon={LayoutGrid} label="In Multiple Leagues" value={counts.multi} accent="slate" />
        <KpiCard icon={Flag} label="Flagged" value={counts.flagged} accent="red" />
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map((f) => {
          const active = quick === f.id;
          const n =
            f.id === "verified" ? counts.verified
            : f.id === "unverified" ? counts.total - counts.verified
            : f.id === "multi" ? counts.multi
            : f.id === "flagged" ? counts.flagged
            : f.id === "payments" ? counts.payments
            : counts.total;
          return (
            <button
              key={f.id}
              onClick={() => setQuick(f.id)}
              data-testid={`filter-pill-${f.id}`}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                active
                  ? "bg-[var(--sc-blue)] text-white border-[var(--sc-blue)] dark-any:bg-white/10 dark-any:border-white/20"
                  : "bg-transparent text-[var(--sc-text)] dark-any:text-white/60 border-[var(--sc-border)] dark-any:border-white/10 hover:bg-[var(--sc-card-soft)] dark-any:hover:bg-white/[0.04]",
              )}
            >
              {f.label}
              <span className={cn("ml-1.5 tabular-nums", active ? "text-white/70" : "text-[var(--sc-text-muted)] dark-any:text-white/30")}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative min-w-[180px] max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search manager or team…"
          className="pl-8 h-9 text-sm"
          data-testid="input-search-managers"
        />
      </div>

      {q.isError && (
        <Card className="p-4 text-sm text-red-600 dark-any:text-red-400">
          Failed to load directory: {(q.error as Error).message}
        </Card>
      )}

      {q.data && !q.data.knownLeaguesResolved && (
        <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/40 px-1">
          Known Sleeper league counts are still warming up — refresh in a moment to fill in any “—”.
        </p>
      )}

      {/* Table */}
      <div
        className={cn(
          "rounded-2xl overflow-hidden",
          "bg-[var(--sc-card-bg)] border border-[var(--sc-border)] shadow-[var(--sc-shadow-card)]",
          "dark-any:border-white/6 dark-any:shadow-none dark-any:bg-[linear-gradient(180deg,rgba(4,13,26,0.9)_0%,rgba(4,10,20,0.95)_100%)]",
        )}
      >
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <table className="w-full text-sm" style={{ minWidth: 880 }}>
            <thead>
              <tr className="bg-[var(--sc-blue)] dark-any:bg-white/[0.02] border-b border-[var(--sc-blue-2)] dark-any:border-white/6 text-[9px] uppercase tracking-widest text-white/70 dark-any:text-white/30">
                <SortableTh sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="text-left font-bold px-3 md:px-5 py-2.5 whitespace-nowrap">Manager</SortableTh>
                <SortableTh sortKey="shared" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Your Leagues</SortableTh>
                <SortableTh sortKey="known" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Known Sleeper Leagues</SortableTh>
                <SortableTh sortKey="flags" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Flags</SortableTh>
                <SortableTh sortKey="payments" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Payment Issues</SortableTh>
                <SortableTh sortKey="activity" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Activity</SortableTh>
                <th className="text-center font-bold px-2 md:px-5 py-2.5 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#edf2f7] dark-any:border-white/5 last:border-0">
                    <td className="px-3 md:px-5 py-3"><Skeleton className="h-5 w-40" /></td>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-2 py-3"><Skeleton className="h-4 w-10 mx-auto" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-sm text-muted-foreground py-12">
                    {managers.length === 0 ? "No managers found across your leagues." : "No managers match these filters."}
                  </td>
                </tr>
              ) : (
                rows.map((m) => (
                  <tr
                    key={m.sleeperUserId}
                    className="border-b border-[#edf2f7] dark-any:border-white/5 last:border-0 hover:bg-[var(--sc-card-soft)] dark-any:hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setSelected(m)}
                    data-testid={`manager-row-${m.sleeperUserId}`}
                  >
                    <td className="px-3 md:px-5 py-2.5"><ManagerIdentity m={m} /></td>
                    <td className="text-center px-2 font-bold tabular-nums text-[var(--sc-blue)] dark-any:text-white/90">
                      {m.commissionerLeagueCount}
                    </td>
                    <td className="text-center px-2 tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/50">
                      {num(m.knownSleeperLeagueCount)}
                    </td>
                    <td className="text-center px-2"><FlagPill count={m.activeFlagsCount} tone="flag" /></td>
                    <td className="text-center px-2"><FlagPill count={m.paymentIssuesCount} tone="payment" /></td>
                    <td className={cn("text-center px-2 font-semibold", activityStatusColor(m.activityStatus))}>
                      {ACTIVITY_STATUS_DISPLAY[m.activityStatus]}
                    </td>
                    <td className="text-center px-2 md:px-5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={(e) => { e.stopPropagation(); setSelected(m); }}
                        data-testid={`button-view-${m.sleeperUserId}`}
                      >
                        View <ArrowRight className="w-3 h-3 ml-1" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ManagerProfileDrawer manager={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ── Profile drawer ─────────────────────────────────────────────────────────────

function StatBox({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-[var(--sc-border)] dark-any:border-white/10 px-3 py-2.5">
      <p className={cn("text-lg font-bold tabular-nums leading-none", accent)}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1.5">{label}</p>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ManagerProfileDrawer({ manager, onClose }: { manager: ManagerDirectoryItem | null; onClose: () => void }) {
  const v = manager ? VERIFICATION_DISPLAY[manager.verificationStatus] : null;
  return (
    <Sheet open={!!manager} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
        {manager && (
          <div className="flex flex-col">
            {/* Header */}
            <SheetHeader className="px-5 pt-5 pb-4 border-b border-[var(--sc-border)] dark-any:border-white/10 space-y-3">
              <div className="flex items-center gap-3">
                <SleeperUserAvatar username={manager.sleeperUsername} avatar={manager.avatar} size="md" compact />
                <div className="min-w-0">
                  <SheetTitle className="flex items-center gap-1.5 text-base">
                    <span className="truncate">{manager.sleeperUsername}</span>
                    <VerifiedBadge status={manager.verificationStatus} size={16} />
                  </SheetTitle>
                  <p className="text-xs text-muted-foreground">
                    {manager.verifiedStatChasersAccount ? "Verified StatChasers account" : "Unverified manager"}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <StatBox label="Your Leagues" value={manager.commissionerLeagueCount} accent="text-[var(--sc-blue)] dark-any:text-white/90" />
                <StatBox label="Known Leagues" value={num(manager.knownSleeperLeagueCount)} />
                <StatBox label="Flags" value={manager.activeFlagsCount} accent={manager.activeFlagsCount ? "text-amber-600 dark-any:text-amber-400" : undefined} />
                <StatBox label="Payments" value={manager.paymentIssuesCount} accent={manager.paymentIssuesCount ? "text-red-600 dark-any:text-red-400" : undefined} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Last seen: {lastSeenLabel(manager.lastActivity)}
              </p>
            </SheetHeader>

            <div className="px-5 py-5 space-y-6">
              {/* Shared Leagues */}
              <Section icon={LayoutGrid} title={`Shared Leagues (${manager.sharedLeagues.length})`}>
                <div className="rounded-xl border border-[var(--sc-border)] dark-any:border-white/10 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--sc-card-soft)] dark-any:bg-white/[0.03] text-[9px] uppercase tracking-wide text-muted-foreground">
                        <th className="text-left font-semibold px-3 py-2">League</th>
                        <th className="text-center font-semibold px-2 py-2">Format</th>
                        <th className="text-center font-semibold px-2 py-2">Flags</th>
                        <th className="text-center font-semibold px-2 py-2">Activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manager.sharedLeagues.map((s) => (
                        <tr key={s.leagueId} className="border-t border-[var(--sc-border)] dark-any:border-white/[0.06]">
                          <td className="px-3 py-2 font-semibold text-foreground truncate max-w-[140px]">{s.leagueName}</td>
                          <td className="px-2 py-2 text-center text-muted-foreground whitespace-nowrap">{s.format}</td>
                          <td className="px-2 py-2 text-center"><FlagPill count={s.activeFlagsCount + s.paymentIssuesCount} tone="flag" /></td>
                          <td className={cn("px-2 py-2 text-center font-semibold", activityStatusColor(s.activityStatus))}>
                            {ACTIVITY_STATUS_DISPLAY[s.activityStatus]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* Verification */}
              <Section icon={manager.verifiedStatChasersAccount ? BadgeCheck : ShieldQuestion} title="Verification">
                <div className="rounded-xl border border-[var(--sc-border)] dark-any:border-white/10 px-3.5 py-3 flex items-start gap-2.5">
                  {manager.verifiedStatChasersAccount
                    ? <BadgeCheck className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: GOLD }} />
                    : <ShieldQuestion className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />}
                  <div>
                    <p className="text-sm font-semibold text-foreground">{v?.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{v?.tooltip}</p>
                  </div>
                </div>
              </Section>

              {/* Payment Status */}
              <Section icon={CreditCard} title="Payment Status">
                <p className="text-xs text-muted-foreground">
                  {manager.paymentIssuesCount > 0
                    ? `${manager.paymentIssuesCount} open payment issue${manager.paymentIssuesCount === 1 ? "" : "s"} logged across your leagues. Review and resolve them in the League Treasury / Commissioner Log.`
                    : "No open payment issues logged for this manager."}
                </p>
              </Section>

              {/* Flags & Notes */}
              <Section icon={Flag} title="Flags & Notes">
                <p className="text-xs text-muted-foreground">
                  {manager.activeFlagsCount > 0
                    ? `${manager.activeFlagsCount} open flag${manager.activeFlagsCount === 1 ? "" : "s"} from your commissioner log. Open the relevant league to see details and add notes.`
                    : "No open flags. Commissioner flags and notes you add per league will surface here."}
                </p>
              </Section>

              {/* Trade & Lineup history pointer */}
              <Section icon={Activity} title="Trade & Lineup History">
                <p className="text-xs text-muted-foreground">
                  Deep per-manager trade, draft and lineup history lives in <span className="font-semibold text-foreground">Manager Intel</span> and the <span className="font-semibold text-foreground">Trade Review Center</span>. Open a shared league above to drill in.
                </p>
              </Section>
            </div>

            <div className="px-5 py-4 border-t border-[var(--sc-border)] dark-any:border-white/10 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose} data-testid="button-close-drawer">
                <X className="w-3.5 h-3.5 mr-1.5" /> Close
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
