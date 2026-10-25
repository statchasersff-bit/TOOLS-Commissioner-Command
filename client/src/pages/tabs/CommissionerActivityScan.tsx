/**
 * All-League Activity Scan — the Activity module's cross-league view.
 *
 * Scans every league the connected manager is in (best-ball excluded) and
 * renders a single comparison table: league activity score, active/inactive
 * managers, and transactions. Activity scores on transaction behavior only —
 * lineup signals are not used. Read-only — the scan just kicks each league's
 * activity ingest pipeline; nothing writes back to Sleeper.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useSleeper } from "@/contexts/SleeperContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableTh } from "@/components/SortableTh";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, RefreshCw, Users, ListChecks, ShieldAlert, ArrowRight, LayoutGrid } from "lucide-react";
import {
  refreshActivity, fetchMultiOverview, scoreTextColor,
  type MultiLeagueRow,
} from "@/lib/commissionerActivityApi";

const GOLD = "#d4af37";

function KpiCard({ icon: Icon, label, value, accent = "slate" }: {
  icon: typeof Activity; label: string; value: React.ReactNode;
  accent?: "gold" | "blue" | "red" | "slate";
}) {
  const colorByAccent: Record<string, string> = {
    gold:  "bg-[#d4af37]/10 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]",
    blue:  "bg-blue-500/10 text-blue-600 dark-any:text-blue-400",
    red:   "bg-red-500/10 text-red-600 dark-any:text-red-400",
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

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < 3_600_000) return "Just now";
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / day);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

const num = (v: number | null | undefined) => (v == null ? "—" : v);

const LEAGUE_TYPE_META: Record<string, { label: string }> = {
  dynasty: { label: "Dynasty" },
  keeper:  { label: "Keeper" },
  redraft: { label: "Redraft" },
};

export default function CommissionerActivityScan({
  onOpenLeague,
}: {
  /** Open the per-league League Activity tab for the given league. */
  onOpenLeague?: (leagueId: string) => void;
} = {}) {
  const sleeper = useSleeper();
  const { toast } = useToast();

  // Activity scores purely on transaction behavior (trades / waivers / FA);
  // lineup signals are not used. Best-ball leagues are included and badged "BB".
  const scanLeagues = sleeper.leagues;
  const leagueIds = scanLeagues.map((l) => l.leagueId);
  const nameById = Object.fromEntries(scanLeagues.map((l) => [l.leagueId, l.name]));
  const avatarById = Object.fromEntries(scanLeagues.map((l) => [l.leagueId, l.avatar ?? null]));
  const isBestBallById = Object.fromEntries(scanLeagues.map((l) => [l.leagueId, l.isBestBall ?? false]));
  const totalRostersById = Object.fromEntries(scanLeagues.map((l) => [l.leagueId, l.totalRosters]));
  const leagueTypeById = Object.fromEntries(scanLeagues.map((l) => [l.leagueId, l.leagueType]));
  const idsKey = leagueIds.join(",");

  const q = useQuery({
    queryKey: ["commish-activity", "multi", idsKey],
    queryFn: () => fetchMultiOverview(leagueIds),
    enabled: leagueIds.length > 0,
  });

  // Scan every league. `auto` (on open) reuses the server's 10-min cache; the
  // manual button forces a guaranteed-fresh pull from Sleeper for each league.
  const scanMut = useMutation({
    mutationFn: async ({ auto }: { auto?: boolean }) => {
      const results = await Promise.allSettled(
        leagueIds.map((id) => refreshActivity({ leagueId: id, mode: "season", forceRefresh: !auto })),
      );
      return { ok: results.filter((r) => r.status === "fulfilled").length, total: leagueIds.length };
    },
    onSuccess: (res, { auto }) => {
      if (!auto) {
        toast({ title: "Scan complete", description: `Scanned ${res.ok}/${res.total} league(s).` });
      }
      queryClient.invalidateQueries({ queryKey: ["commish-activity", "multi", idsKey] });
    },
    onError: (err: Error, { auto }) => {
      if (!auto) toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    },
  });

  // Auto-scan once per league set when the tab opens. A ref guards against
  // re-firing on the re-renders that query invalidation and toasts trigger.
  const autoScanned = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!idsKey || autoScanned.current.has(idsKey)) return;
    autoScanned.current.add(idsKey);
    scanMut.mutate({ auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const rows: MultiLeagueRow[] = q.data?.leagues ?? [];
  const scored = rows.filter((r) => r.hasData && r.leagueActivityScore != null);

  // Aggregate KPIs across leagues with data.
  const avgScore = scored.length
    ? Math.round(scored.reduce((s, r) => s + (r.leagueActivityScore ?? 0), 0) / scored.length)
    : 0;
  const totalActive = rows.reduce((s, r) => s + (r.activeManagerCount ?? 0), 0);
  // Total rosters across leagues that actually returned data, so the KPI reads
  // as "active / total managers" consistent with the table's Active column.
  const totalManagers = rows.reduce(
    (s, r) => s + (r.activeManagerCount != null ? (totalRostersById[r.leagueId] ?? 0) : 0),
    0,
  );
  const totalTransactions = rows.reduce((s, r) => s + (r.totalTransactions ?? 0), 0);

  // Most recent scan across all leagues, surfaced above the table.
  const lastScannedAt = rows.reduce<string | null>((latest, r) => {
    const ts = r.lastScan ?? null;
    if (!ts) return latest;
    if (!latest) return ts;
    return Date.parse(ts) > Date.parse(latest) ? ts : latest;
  }, null);

  // One display row per scanned league (rows may not yet have data for every id).
  const tableRows = leagueIds.map((id) => {
    const row = rows.find((r) => r.leagueId === id);
    return { id, name: nameById[id] ?? id, row };
  });

  const { sorted, sortKey, sortDir, toggle } = useSortableTable(
    tableRows,
    {
      league: (r) => r.name,
      type: (r) => leagueTypeById[r.id],
      score: (r) => r.row?.leagueActivityScore,
      active: (r) => r.row?.activeManagerCount,
      trans: (r) => r.row?.totalTransactions,
    },
    { defaultKey: "score", defaultDir: "desc" },
  );

  if (!sleeper.isConnected) {
    return (
      <Card className="border-border/60">
        <div className="flex flex-col items-center justify-center text-center py-14 px-4">
          <LayoutGrid className="w-8 h-8 text-muted-foreground/60 mb-3" />
          <p className="text-sm font-semibold text-foreground">Connect a Sleeper account</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">Link your Sleeper username to scan activity across all your leagues.</p>
        </div>
      </Card>
    );
  }

  const scanning = scanMut.isPending;

  return (
    <div className="space-y-5">
      {/* Page header — scanning runs automatically when the tab opens. */}
      <SectionHeader
        title="All-League Scan"
        subtitle="Scan every league you're in and compare activity scores, engagement and transactions side by side."
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={LayoutGrid} label="Leagues Scanned" value={`${scored.length}/${leagueIds.length}`} accent="blue" />
        <KpiCard icon={Activity} label="Avg Activity Score" value={`${avgScore}/100`} accent="gold" />
        <KpiCard icon={Users} label="Active Managers" value={`${totalActive}/${totalManagers}`} accent="slate" />
        <KpiCard icon={ListChecks} label="Total Transactions" value={totalTransactions} accent="slate" />
      </div>

      {/* Last scanned (left) + swipe hint (mobile, right) */}
      <div className="flex items-center justify-between gap-2 -mb-2 px-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/40" data-testid="text-last-scanned">
          {scanning ? (
            <>
              <RefreshCw className="w-3 h-3 animate-spin" />
              Last scanned: Scanning…
            </>
          ) : (
            <>Last scanned: {timeAgo(lastScannedAt)}</>
          )}
        </span>
        <span className="flex items-center gap-1.5 md:hidden">
          <span className="text-[10px] text-[var(--sc-text-muted)] dark-any:text-white/25">Swipe to view</span>
          <ArrowRight className="w-3 h-3 text-[var(--sc-text-muted)]/70 dark-any:text-white/20" />
        </span>
      </div>

      {/* League table */}
      <div
        className={cn(
          "rounded-2xl overflow-hidden",
          "bg-[var(--sc-card-bg)] border border-[var(--sc-border)] shadow-[var(--sc-shadow-card)]",
          "dark-any:border-white/6 dark-any:shadow-none dark-any:bg-[linear-gradient(180deg,rgba(4,13,26,0.9)_0%,rgba(4,10,20,0.95)_100%)]",
        )}
      >
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <table className="w-full text-sm" style={{ minWidth: 820 }}>
            <thead>
              <tr className="bg-[var(--sc-blue)] dark-any:bg-white/[0.02] border-b border-[var(--sc-blue-2)] dark-any:border-white/6 text-[9px] uppercase tracking-widest text-white/70 dark-any:text-white/30">
                <SortableTh sortKey="league" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="text-left font-bold px-3 md:px-5 py-2.5 whitespace-nowrap">League</SortableTh>
                <SortableTh sortKey="type" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Type</SortableTh>
                <SortableTh sortKey="score" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Score</SortableTh>
                <SortableTh sortKey="active" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Active</SortableTh>
                <SortableTh sortKey="trans" activeKey={sortKey} dir={sortDir} onSort={toggle} align="center" className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Trans</SortableTh>
                <th className="text-center font-bold px-2 md:px-5 py-2.5 whitespace-nowrap">View</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading || (scanning && rows.length === 0) ? (
                Array.from({ length: Math.max(1, Math.min(leagueIds.length, 6)) }).map((_, i) => (
                  <tr key={i} className="border-b border-[#edf2f7] dark-any:border-white/5 last:border-0">
                    <td className="px-3 md:px-5 py-3"><Skeleton className="h-4 w-40" /></td>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-2 py-3"><Skeleton className="h-4 w-10 mx-auto" /></td>
                    ))}
                  </tr>
                ))
              ) : leagueIds.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-sm text-muted-foreground py-12">No eligible leagues to scan.</td></tr>
              ) : (
                sorted.map(({ id, name, row }) => {
                  const score = row?.leagueActivityScore ?? null;
                  const isBestBall = isBestBallById[id] ?? false;
                  return (
                    <tr
                      key={id}
                      className="border-b border-[#edf2f7] dark-any:border-white/5 last:border-0 hover:bg-[var(--sc-card-soft)] dark-any:hover:bg-white/[0.02] transition-colors"
                      data-testid={`scan-row-${id}`}
                    >
                      <td className="px-3 md:px-5 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <LeagueAvatar avatar={avatarById[id] ?? null} name={name} />
                          <span className="font-bold truncate text-[var(--sc-blue)] dark-any:text-white/90">{name}</span>
                        </div>
                      </td>
                      <td className="text-center px-2 text-[var(--sc-text)] dark-any:text-white/70">
                        {LEAGUE_TYPE_META[leagueTypeById[id] ?? "redraft"].label}{isBestBall ? " BB" : ""}
                      </td>
                      <td className={`text-center px-2 font-bold tabular-nums ${score != null ? scoreTextColor(score) : "text-[var(--sc-text-muted)] dark-any:text-white/40"}`}>
                        {score != null ? `${score}` : "—"}
                      </td>
                      <td className="text-center px-2 font-semibold tabular-nums text-[var(--sc-text)] dark-any:text-white/70">
                        {row?.activeManagerCount != null ? `${row.activeManagerCount}/${totalRostersById[id] ?? "?"}` : "—"}
                      </td>
                      <td className="text-center px-2 tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{num(row?.totalTransactions)}</td>
                      <td className="text-center px-2 md:px-5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); onOpenLeague?.(id); }}
                          data-testid={`scan-view-${id}`}
                        >
                          View <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
