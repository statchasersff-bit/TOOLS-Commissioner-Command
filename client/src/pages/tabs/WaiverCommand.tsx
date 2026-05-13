import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getSleeperPlayers, claimPlayerOnSleeper } from "@/lib/sleeperApi";
import {
  Waves, Zap, Users, DollarSign, Star, TrendingUp, TrendingDown,
  Minus, Lock, AlertCircle, RefreshCw, ChevronUp, ChevronDown,
  Plus, CheckCircle2, Eye, EyeOff, KeyRound,
} from "lucide-react";

const SLEEPER_API = "https://api.sleeper.app/v1";

type TierFilter = "all" | "contender" | "bubble" | "rebuild";
type SortKey = "tier" | "openSlots" | "faabPct" | "difference" | "leagueName";

interface PlayerSummary {
  id: string;
  name: string;
  position: string;
  team: string;
  value: number;
}

interface WaiverRow {
  leagueId: string;
  leagueName: string;
  leagueAvatar: string | null;
  format: string;
  scoringFormat: string;
  tier: "Contender" | "Bubble" | "Rebuild";
  tierRank: number;
  totalTeams: number;
  openSlots: number;
  faabRemaining: number;
  faabBudget: number;
  faabPct: number;
  bestAvailable: PlayerSummary | null;
  lowestOnTeam: PlayerSummary | null;
  difference: number;
  loading: boolean;
  error: boolean;
  isEmpty: boolean;
  rosterId: number | null;
  waiverType: number;
  userRosterPlayers: PlayerSummary[];
  topAvailable: PlayerSummary[];
}

async function fetchLeagueWaiverSnapshot(leagueId: string, userId: string) {
  const [leagueRaw, rostersRaw] = await Promise.all([
    fetch(`${SLEEPER_API}/league/${leagueId}`).then((r) => r.json()),
    fetch(`${SLEEPER_API}/league/${leagueId}/rosters`).then((r) => r.json()),
  ]);
  return { leagueRaw, rostersRaw, userId };
}

function deriveLeagueTier(
  userRosterId: number | null,
  rostersRaw: any[],
  valuesBySleeperId: Record<string, number>
): { tier: "Contender" | "Bubble" | "Rebuild"; rank: number; total: number } {
  if (!userRosterId || rostersRaw.length === 0) return { tier: "Bubble", rank: 0, total: 0 };

  const teamValues = rostersRaw.map((r: any) => {
    const players: string[] = r.players || [];
    const total = players.reduce((sum, pid) => sum + (valuesBySleeperId[pid] ?? 0), 0);
    return { rosterId: r.roster_id, total };
  });

  teamValues.sort((a, b) => b.total - a.total);
  const rank = teamValues.findIndex((t) => t.rosterId === userRosterId) + 1;
  const total = teamValues.length;
  const pct = rank / total;

  const tier = pct <= 0.33 ? "Contender" : pct <= 0.67 ? "Bubble" : "Rebuild";
  return { tier, rank, total };
}

function getTierAccent(tier: "Contender" | "Bubble" | "Rebuild") {
  if (tier === "Contender") return { bg: "bg-emerald-500/10 dark:bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/25 dark:border-emerald-500/30", dot: "bg-emerald-500" };
  if (tier === "Bubble")    return { bg: "bg-amber-500/10 dark:bg-amber-500/15",   text: "text-amber-600 dark:text-amber-400",   border: "border-amber-500/25 dark:border-amber-500/30",   dot: "bg-amber-500"   };
  return                           { bg: "bg-rose-500/10 dark:bg-rose-500/15",     text: "text-rose-600 dark:text-rose-400",     border: "border-rose-500/25 dark:border-rose-500/30",     dot: "bg-rose-500"    };
}

const FILTER_TABS: { id: TierFilter; label: string }[] = [
  { id: "all",       label: "All Leagues"  },
  { id: "contender", label: "Contenders"   },
  { id: "bubble",    label: "Bubble Teams" },
  { id: "rebuild",   label: "Rebuilds"     },
];

export default function WaiverCommand() {
  const { isConnected, user, leagues } = useSleeper();
  const { valuesBySleeperId, dynastyPlayerList, isLoading: valuesLoading } = useValueModel();

  const [rows, setRows] = useState<WaiverRow[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<TierFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("tier");
  const [sortAsc, setSortAsc] = useState(true);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [claimRow, setClaimRow] = useState<WaiverRow | null>(null);

  const userId = user?.userId ?? "";

  useEffect(() => {
    if (!isConnected || !userId || leagues.length === 0 || valuesLoading) return;

    setIsFetching(true);
    setFetchError(null);

    const skeletons: WaiverRow[] = leagues.map((lg) => ({
      leagueId:     lg.leagueId,
      leagueName:   lg.name,
      leagueAvatar: lg.avatar ? `https://sleepercdn.com/avatars/thumbs/${lg.avatar}` : null,
      format:       lg.format,
      scoringFormat: lg.scoringFormat,
      tier:         "Bubble",
      tierRank:     0,
      totalTeams:   lg.totalRosters,
      openSlots:    0,
      faabRemaining: 0,
      faabBudget:   100,
      faabPct:      100,
      bestAvailable: null,
      lowestOnTeam:  null,
      difference:   0,
      loading:      true,
      error:        false,
      isEmpty:      false,
      rosterId:     null,
      waiverType:   0,
      userRosterPlayers: [],
      topAvailable: [],
    }));
    setRows(skeletons);

    Promise.allSettled(leagues.map((lg) => fetchLeagueWaiverSnapshot(lg.leagueId, userId)))
      .then(async (results) => {
        const playersDb = await getSleeperPlayers().catch(() => ({} as Record<string, any>));

        const computed: WaiverRow[] = results.map((result, idx) => {
          const lg = leagues[idx];
          const base: WaiverRow = {
            leagueId:     lg.leagueId,
            leagueName:   lg.name,
            leagueAvatar: lg.avatar ? `https://sleepercdn.com/avatars/thumbs/${lg.avatar}` : null,
            format:       lg.format,
            scoringFormat: lg.scoringFormat,
            tier:         "Bubble",
            tierRank:     0,
            totalTeams:   lg.totalRosters,
            openSlots:    0,
            faabRemaining: 0,
            faabBudget:   100,
            faabPct:      100,
            bestAvailable: null,
            lowestOnTeam:  null,
            difference:   0,
            loading:      false,
            error:        result.status === "rejected",
            isEmpty:      false,
            rosterId:     null,
            waiverType:   0,
            userRosterPlayers: [],
            topAvailable: [],
          };

          if (result.status === "rejected") return base;

          const { leagueRaw, rostersRaw } = result.value;

          const totalRosteredPlayers = rostersRaw.reduce((sum: number, r: any) => sum + (r.players?.length ?? 0), 0);
          if (totalRosteredPlayers === 0) return { ...base, isEmpty: true };

          const userRoster = rostersRaw.find((r: any) => r.owner_id === userId) ?? null;
          const userRosterId: number | null = userRoster?.roster_id ?? null;

          const faabBudget   = leagueRaw?.settings?.waiver_budget ?? 100;
          const faabUsed     = userRoster?.settings?.waiver_budget_used ?? 0;
          const faabRemaining = Math.max(0, faabBudget - faabUsed);
          const faabPct      = faabBudget > 0 ? Math.round((faabRemaining / faabBudget) * 100) : 100;

          const maxRosterSize = (leagueRaw?.roster_positions ?? []).length || 25;
          const currentRosterCount = (userRoster?.players ?? []).length;
          const openSlots = Math.max(0, maxRosterSize - currentRosterCount);

          const rosteredIds = new Set<string>(rostersRaw.flatMap((r: any) => r.players ?? []));

          const validPos = new Set(["QB", "RB", "WR", "TE"]);
          const bestAvailable: PlayerSummary | null = Object.entries(valuesBySleeperId)
            .filter(([pid]) => {
              if (rosteredIds.has(pid)) return false;
              const p = playersDb[pid];
              if (!p) return false;
              const pos = p.fantasy_positions?.[0] || p.position;
              return validPos.has(pos);
            })
            .map(([pid, val]) => {
              const p = playersDb[pid];
              const pos = p.fantasy_positions?.[0] || p.position;
              return { id: pid, name: p.full_name || "Unknown", position: pos, team: p.team || "FA", value: val };
            })
            .sort((a, b) => b.value - a.value)[0] ?? null;

          const userPlayers: string[] = userRoster?.players ?? [];
          const userRatedPlayers = userPlayers
            .filter((pid) => {
              const p = playersDb[pid];
              return p && validPos.has(p.fantasy_positions?.[0] || p.position);
            })
            .map((pid) => {
              const p = playersDb[pid];
              const pos = p.fantasy_positions?.[0] || p.position;
              const value = valuesBySleeperId[pid] ?? 0;
              return { id: pid, name: p.full_name || "Unknown", position: pos, team: p.team || "FA", value };
            })
            .sort((a, b) => a.value - b.value);

          const lowestOnTeam: PlayerSummary | null = userRatedPlayers[0] ?? null;
          const difference = (bestAvailable?.value ?? 0) - (lowestOnTeam?.value ?? 0);

          const waiverType: number = leagueRaw?.settings?.waiver_type ?? 0;

          const userRosterPlayers: PlayerSummary[] = (userRoster?.players ?? [])
            .map((pid: string) => {
              const p = playersDb[pid];
              if (!p) return null;
              const pos = p.fantasy_positions?.[0] || p.position;
              return { id: pid, name: p.full_name || "Unknown", position: pos, team: p.team || "FA", value: valuesBySleeperId[pid] ?? 0 };
            })
            .filter(Boolean) as PlayerSummary[];

          const topAvailable: PlayerSummary[] = Object.entries(valuesBySleeperId)
            .filter(([pid]) => {
              if (rosteredIds.has(pid)) return false;
              const p = playersDb[pid];
              if (!p) return false;
              const pos = p.fantasy_positions?.[0] || p.position;
              return validPos.has(pos);
            })
            .map(([pid, val]) => {
              const p = playersDb[pid];
              const pos = p.fantasy_positions?.[0] || p.position;
              return { id: pid, name: p.full_name || "Unknown", position: pos, team: p.team || "FA", value: val };
            })
            .sort((a, b) => b.value - a.value)
            .slice(0, 20);

          const { tier, rank, total } = deriveLeagueTier(userRosterId, rostersRaw, valuesBySleeperId);

          return { ...base, tier, tierRank: rank, totalTeams: total, openSlots, faabRemaining, faabBudget, faabPct, bestAvailable, lowestOnTeam, difference, rosterId: userRosterId, waiverType, userRosterPlayers, topAvailable };
        });

        setRows(computed);
        setLastFetched(Date.now());
        setIsFetching(false);
      });
  }, [isConnected, userId, leagues, valuesLoading, dynastyPlayerList, valuesBySleeperId]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (r.isEmpty || r.error) return false;
      if (activeFilter === "all") return true;
      if (activeFilter === "contender") return r.tier === "Contender";
      if (activeFilter === "bubble")    return r.tier === "Bubble";
      if (activeFilter === "rebuild")   return r.tier === "Rebuild";
      return true;
    });
  }, [rows, activeFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "leagueName")  cmp = a.leagueName.localeCompare(b.leagueName);
      else if (sortKey === "tier")   cmp = ["Contender","Bubble","Rebuild"].indexOf(a.tier) - ["Contender","Bubble","Rebuild"].indexOf(b.tier);
      else if (sortKey === "openSlots") cmp = b.openSlots - a.openSlots;
      else if (sortKey === "faabPct")   cmp = b.faabPct - a.faabPct;
      else if (sortKey === "difference") cmp = b.difference - a.difference;
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortAsc]);

  const heroMetrics = useMemo(() => {
    const done = rows.filter((r) => !r.loading && !r.error);
    const priorityAdds    = done.filter((r) => (r.bestAvailable?.value ?? 0) - (r.lowestOnTeam?.value ?? 0) > 200).length;
    const totalOpenSlots  = done.reduce((s, r) => s + r.openSlots, 0);
    const avgFaab         = done.length > 0 ? Math.round(done.reduce((s, r) => s + r.faabPct, 0) / done.length) : 0;
    const topAdd          = done.sort((a, b) => (b.bestAvailable?.value ?? 0) - (a.bestAvailable?.value ?? 0))[0]?.bestAvailable ?? null;
    return { priorityAdds, totalOpenSlots, avgFaab, topAdd };
  }, [rows]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <Minus className="w-3 h-3 opacity-30" />;
    return sortAsc ? <ChevronUp className="w-3 h-3 text-[#d4af37]" /> : <ChevronDown className="w-3 h-3 text-[#d4af37]" />;
  };

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] px-4">
        <Card className="p-10 text-center max-w-md w-full border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628]">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-4 ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
            <Lock className="w-6 h-6 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <h3 className="text-xl font-bold mb-1.5">Connect Sleeper to Unlock</h3>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px] mx-auto">
            WaiverCommand requires a Sleeper connection to analyze waiver wire opportunities across all your leagues.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
            <Waves className="w-4.5 h-4.5 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground leading-tight" data-testid="text-waiver-command-title">WaiverCommand</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Centralized waiver management across every league</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[11px] text-muted-foreground/60">
              Updated {Math.round((Date.now() - lastFetched) / 1000)}s ago
            </span>
          )}
          {isFetching && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <RefreshCw className="w-3 h-3 animate-spin text-[#d4af37]" />
              <span>Fetching leagues…</span>
            </div>
          )}
        </div>
      </div>

      {/* Sticky filter bar */}
      <div className="flex items-center gap-1.5 p-1 bg-muted/40 dark:bg-white/[0.04] rounded-xl border border-border/40 dark:border-white/[0.06] w-fit" data-testid="waiver-filter-bar">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            data-testid={`filter-${tab.id}`}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150",
              activeFilter === tab.id
                ? "bg-[#0b3a7a] text-white shadow-sm shadow-[#0b3a7a]/30"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Hero metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HeroKpi
          icon={<Zap className="w-4 h-4" />}
          label="Priority Adds"
          value={isFetching ? null : heroMetrics.priorityAdds.toString()}
          accent="gold"
          tip="Leagues where best available > lowest roster player by 200+ pts"
          testId="kpi-priority-adds"
        />
        <HeroKpi
          icon={<Users className="w-4 h-4" />}
          label="Open Roster Spots"
          value={isFetching ? null : heroMetrics.totalOpenSlots.toString()}
          accent="blue"
          tip="Total open roster slots across all leagues"
          testId="kpi-open-slots"
        />
        <HeroKpi
          icon={<DollarSign className="w-4 h-4" />}
          label="Avg FAAB Remaining"
          value={isFetching ? null : `${heroMetrics.avgFaab}%`}
          accent={heroMetrics.avgFaab < 30 ? "red" : heroMetrics.avgFaab < 60 ? "amber" : "green"}
          tip="Average FAAB budget remaining across leagues"
          testId="kpi-avg-faab"
        />
        <HeroKpi
          icon={<Star className="w-4 h-4" />}
          label="Best Available"
          value={isFetching ? null : (heroMetrics.topAdd?.name ?? "—")}
          sub={heroMetrics.topAdd?.position}
          accent="green"
          tip="Highest dynasty value free agent available in any of your leagues"
          testId="kpi-best-available"
          compact
        />
      </div>

      {/* Main table */}
      <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80">
        <div className="px-5 py-3.5 border-b border-border/40 dark:border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
            <h3 className="text-sm font-bold text-foreground">League Waiver Overview</h3>
          </div>
          <span className="text-xs text-muted-foreground">{sorted.length} league{sorted.length !== 1 ? "s" : ""}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="waiver-table">
            <thead>
              <tr className="border-b border-border/40 dark:border-white/[0.05] bg-muted/30 dark:bg-white/[0.02]">
                {[
                  { key: "leagueName" as SortKey, label: "League",          align: "left"   },
                  { key: "openSlots"  as SortKey, label: "Open Slots",      align: "center" },
                  { key: "faabPct"    as SortKey, label: "FAAB Remaining",  align: "center" },
                  { key: null,                    label: "Best Available",  align: "left"   },
                  { key: null,                    label: "Dynasty Value",   align: "center" },
                  { key: null,                    label: "Lowest On Team",  align: "left"   },
                  { key: "difference" as SortKey, label: "Difference",      align: "center" },
                  { key: null,                    label: "Claim",           align: "center" },
                ].map((col, i) => (
                  <th
                    key={i}
                    onClick={() => col.key && handleSort(col.key)}
                    className={cn(
                      "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap",
                      col.align === "center" ? "text-center" : "text-left",
                      col.key && "cursor-pointer hover:text-foreground transition-colors select-none"
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.key && <SortIcon col={col.key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30 dark:divide-white/[0.04]">
              {sorted.length === 0 && !isFetching && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No leagues match this filter.
                  </td>
                </tr>
              )}
              {sorted.map((row) => (
                <WaiverTableRow key={row.leagueId} row={row} onClaim={() => setClaimRow(row)} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Tier legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="font-semibold">Tier Key:</span>
        {(["Contender","Bubble","Rebuild"] as const).map((t) => {
          const c = getTierAccent(t);
          return (
            <span key={t} className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", c.dot)} />
              <span>{t}</span>
            </span>
          );
        })}
        <span className="text-muted-foreground/60">· Tier = roster value rank within each league</span>
      </div>

      <ClaimPlayerModal row={claimRow} onClose={() => setClaimRow(null)} />
    </div>
  );
}

function WaiverTableRow({ row, onClaim }: { row: WaiverRow; onClaim: () => void }) {
  const diffColor = row.difference > 300
    ? "text-emerald-600 dark:text-emerald-400"
    : row.difference > 0
    ? "text-amber-600 dark:text-amber-400"
    : "text-rose-600 dark:text-rose-400";

  if (row.loading) {
    return (
      <tr className="animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <td key={i} className="px-4 py-3">
            <Skeleton className="h-4 w-full rounded" />
          </td>
        ))}
      </tr>
    );
  }

  if (row.error) {
    return (
      <tr className="opacity-60">
        <td className="px-4 py-3 font-medium text-foreground">{row.leagueName}</td>
        <td colSpan={7} className="px-4 py-3">
          <span className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed to load league data
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-muted/30 dark:hover:bg-white/[0.025] transition-colors" data-testid={`row-league-${row.leagueId}`}>
      {/* League name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          {row.leagueAvatar ? (
            <img
              src={row.leagueAvatar}
              alt=""
              className="w-8 h-8 rounded-full flex-shrink-0 object-cover bg-muted ring-1 ring-border/40"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-8 h-8 rounded-full flex-shrink-0 bg-[#0b3a7a]/20 dark:bg-blue-900/40 flex items-center justify-center ring-1 ring-border/40">
              <span className="text-[11px] font-bold text-[#0b3a7a] dark:text-blue-400 uppercase">{row.leagueName[0] ?? "?"}</span>
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold text-foreground text-[13px] truncate max-w-[180px]" title={row.leagueName}>
              {row.leagueName}
            </div>
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {row.scoringFormat && (
                <span className="inline-block text-[10px] font-medium px-1.5 py-[2px] rounded bg-white/[0.07] dark:bg-white/[0.06] text-slate-400 leading-none">
                  {row.scoringFormat}
                </span>
              )}
              <span className="inline-block text-[10px] font-medium px-1.5 py-[2px] rounded bg-white/[0.07] dark:bg-white/[0.06] text-slate-400 leading-none">
                {row.totalTeams} Teams
              </span>
              {row.format.split(" ").map((part, i) => (
                <span key={i} className="inline-block text-[10px] font-medium px-1.5 py-[2px] rounded bg-white/[0.07] dark:bg-white/[0.06] text-slate-400 leading-none">
                  {part}
                </span>
              ))}
            </div>
          </div>
        </div>
      </td>

      {/* Open slots */}
      <td className="px-4 py-3 text-center">
        <span className={cn(
          "text-[13px] font-bold",
          row.openSlots > 2 ? "text-emerald-600 dark:text-emerald-400" :
          row.openSlots > 0 ? "text-amber-600 dark:text-amber-400" :
          "text-muted-foreground"
        )}>
          {row.openSlots}
        </span>
      </td>

      {/* FAAB */}
      <td className="px-4 py-3 text-center">
        <div className="flex flex-col items-center gap-1">
          <span className={cn(
            "text-[13px] font-bold",
            row.faabPct < 20 ? "text-rose-600 dark:text-rose-400" :
            row.faabPct < 50 ? "text-amber-600 dark:text-amber-400" :
            "text-emerald-600 dark:text-emerald-400"
          )}>
            {row.faabPct}%
          </span>
          <div className="w-16 h-1 rounded-full bg-muted/60 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                row.faabPct < 20 ? "bg-rose-500" : row.faabPct < 50 ? "bg-amber-500" : "bg-emerald-500"
              )}
              style={{ width: `${row.faabPct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">${row.faabRemaining}/${row.faabBudget}</span>
        </div>
      </td>

      {/* Best available */}
      <td className="px-4 py-3">
        {row.bestAvailable ? (
          <div>
            <div className="text-[13px] font-semibold text-foreground truncate max-w-[150px]">
              {row.bestAvailable.name}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <PositionBadge pos={row.bestAvailable.position} />
              <span className="text-[11px] text-muted-foreground font-medium">{row.bestAvailable.team}</span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Dynasty value of best available */}
      <td className="px-4 py-3 text-center">
        {row.bestAvailable ? (
          <span className="text-[13px] font-semibold text-foreground">
            {row.bestAvailable.value.toLocaleString()}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>

      {/* Lowest on team */}
      <td className="px-4 py-3">
        {row.lowestOnTeam ? (
          <div>
            <div className="text-[13px] font-semibold text-muted-foreground truncate max-w-[150px]">
              {row.lowestOnTeam.name}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <PositionBadge pos={row.lowestOnTeam.position} />
              <span className="text-[11px] text-muted-foreground font-medium">{row.lowestOnTeam.team}</span>
              <span className="text-[10px] text-muted-foreground/60">· {row.lowestOnTeam.value.toLocaleString()}</span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Difference */}
      <td className="px-4 py-3 text-center">
        <span className={cn("text-[13px] font-bold", diffColor)}>
          {row.difference > 0 ? "+" : ""}{row.difference.toLocaleString()}
        </span>
        <div className="mt-0.5">
          {row.difference > 300 ? (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-0.5">
              <TrendingUp className="w-3 h-3" /> Add now
            </span>
          ) : row.difference > 0 ? (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center justify-center gap-0.5">
              <TrendingUp className="w-3 h-3" /> Consider
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
              <TrendingDown className="w-3 h-3" /> Hold
            </span>
          )}
        </div>
      </td>

      {/* Claim action */}
      <td className="px-4 py-3 text-center">
        <button
          onClick={onClaim}
          disabled={!row.bestAvailable || !row.rosterId}
          data-testid={`btn-claim-${row.leagueId}`}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150",
            row.bestAvailable && row.rosterId
              ? "bg-[#d4af37]/15 text-[#d4af37] hover:bg-[#d4af37]/25 border border-[#d4af37]/30 hover:border-[#d4af37]/50"
              : "bg-muted/30 text-muted-foreground/40 border border-border/20 cursor-not-allowed"
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          Claim
        </button>
      </td>
    </tr>
  );
}

function HeroKpi({
  icon, label, value, sub, accent, tip, testId, compact,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  sub?: string;
  accent: "gold" | "blue" | "green" | "amber" | "red";
  tip: string;
  testId: string;
  compact?: boolean;
}) {
  const accentMap = {
    gold:  { icon: "text-[#d4af37]",  bg: "bg-[#d4af37]/10",  ring: "ring-[#d4af37]/15"  },
    blue:  { icon: "text-blue-500",   bg: "bg-blue-500/10",   ring: "ring-blue-500/15"   },
    green: { icon: "text-emerald-500",bg: "bg-emerald-500/10",ring: "ring-emerald-500/15"},
    amber: { icon: "text-amber-500",  bg: "bg-amber-500/10",  ring: "ring-amber-500/15"  },
    red:   { icon: "text-rose-500",   bg: "bg-rose-500/10",   ring: "ring-rose-500/15"   },
  };
  const c = accentMap[accent];

  return (
    <Card className="p-4 border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-br from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628]" data-testid={testId} title={tip}>
      <div className="flex items-start gap-3">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ring-1", c.bg, c.ring)}>
          <span className={c.icon}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">{label}</p>
          {value === null ? (
            <Skeleton className="h-6 w-16 mt-1.5 rounded" />
          ) : (
            <p className={cn(
              "font-bold text-foreground mt-1 leading-tight",
              compact ? "text-sm truncate" : "text-xl"
            )} data-testid={`${testId}-value`}>
              {value}
              {sub && <span className="text-xs text-muted-foreground font-normal ml-1">({sub})</span>}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function PositionBadge({ pos }: { pos: string }) {
  const colors: Record<string, string> = {
    QB: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    RB: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    WR: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
    TE: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  return (
    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", colors[pos] ?? "bg-muted text-muted-foreground")}>
      {pos}
    </span>
  );
}

function ClaimPlayerModal({ row, onClose }: { row: WaiverRow | null; onClose: () => void }) {
  const { sleeperToken, loginWithPassword, clearToken } = useSleeper();

  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [selectedAddId, setSelectedAddId] = useState<string>("");
  const [selectedDropId, setSelectedDropId] = useState<string>("none");
  const [faabBid, setFaabBid] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!row) return;
    setSelectedAddId(row.bestAvailable?.id ?? row.topAvailable[0]?.id ?? "");
    setSelectedDropId("none");
    setFaabBid(Math.min(10, row.faabRemaining));
    setPassword("");
    setAuthError(null);
    setSubmitError(null);
    setSuccess(false);
  }, [row]);

  if (!row) return null;

  const isFaab = row.waiverType === 2;
  const selectedAdd = row.topAvailable.find((p) => p.id === selectedAddId) ?? row.bestAvailable ?? null;
  const selectedDrop = selectedDropId !== "none" ? row.userRosterPlayers.find((p) => p.id === selectedDropId) ?? null : null;

  const handleLogin = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await loginWithPassword(password);
    } catch (e: any) {
      setAuthError(e.message || "Login failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!sleeperToken || !selectedAdd || !row.rosterId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await claimPlayerOnSleeper(
        row.leagueId,
        row.rosterId,
        selectedAdd.id,
        selectedDrop?.id ?? null,
        isFaab ? faabBid : null,
        row.waiverType,
        sleeperToken
      );
      setSuccess(true);
    } catch (e: any) {
      setSubmitError(e.message || "Claim failed — check Sleeper for details");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md bg-gradient-to-b from-[#0c1929] to-[#0a1628] border-[#1a2d4a] text-foreground">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            {row.leagueAvatar ? (
              <img src={row.leagueAvatar} alt="" className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#0b3a7a]/30 flex items-center justify-center ring-1 ring-white/10">
                <span className="text-[11px] font-bold text-blue-400 uppercase">{row.leagueName[0]}</span>
              </div>
            )}
            <div>
              <DialogTitle className="text-base leading-tight">Claim Player</DialogTitle>
              <DialogDescription className="text-[11px] mt-0">{row.leagueName}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {success ? (
          <div className="py-6 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center ring-1 ring-emerald-500/30">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="font-semibold text-foreground">Claim submitted!</p>
            <p className="text-xs text-muted-foreground">Check Sleeper to confirm the transaction processed.</p>
            <Button variant="outline" size="sm" className="mt-2 border-[#1a2d4a]" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            {!sleeperToken ? (
              <div className="space-y-4 py-2">
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#0b3a7a]/15 border border-[#0b3a7a]/30">
                  <KeyRound className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">Sleeper login required</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Your password is used once to get a session token — it's never stored.</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Password</Label>
                  <div className="relative">
                    <Input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && password && handleLogin()}
                      placeholder="Sleeper password"
                      className="pr-9 bg-[#0a1628] border-[#1a2d4a] focus:border-[#d4af37]/50"
                      data-testid="input-sleeper-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {authError && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{authError}</p>}
                </div>
                <Button
                  onClick={handleLogin}
                  disabled={!password || authLoading}
                  className="w-full bg-[#d4af37] hover:bg-[#d4af37]/90 text-[#0a1628] font-semibold"
                  data-testid="btn-sleeper-login"
                >
                  {authLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <KeyRound className="w-3.5 h-3.5 mr-1.5" />}
                  {authLoading ? "Signing in…" : "Sign in to Sleeper"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Signed in to Sleeper
                  </div>
                  <button onClick={clearToken} className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">Sign out</button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Player to Add</Label>
                  <Select value={selectedAddId} onValueChange={setSelectedAddId}>
                    <SelectTrigger className="bg-[#0a1628] border-[#1a2d4a] focus:border-[#d4af37]/50 text-sm" data-testid="select-add-player">
                      <SelectValue placeholder="Select player" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0c1929] border-[#1a2d4a]">
                      {row.topAvailable.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-sm">
                          <span className="flex items-center gap-2">
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", {
                              "bg-rose-900/30 text-rose-400": p.position === "QB",
                              "bg-emerald-900/30 text-emerald-400": p.position === "RB",
                              "bg-sky-900/30 text-sky-400": p.position === "WR",
                              "bg-yellow-900/30 text-yellow-400": p.position === "TE",
                            })}>{p.position}</span>
                            {p.name}
                            <span className="text-muted-foreground text-[11px]">{p.team} · {p.value.toLocaleString()}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Drop Player <span className="text-muted-foreground/50 normal-case font-normal">(optional)</span></Label>
                  <Select value={selectedDropId} onValueChange={setSelectedDropId}>
                    <SelectTrigger className="bg-[#0a1628] border-[#1a2d4a] focus:border-[#d4af37]/50 text-sm" data-testid="select-drop-player">
                      <SelectValue placeholder="No drop" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0c1929] border-[#1a2d4a]">
                      <SelectItem value="none" className="text-sm text-muted-foreground">No drop</SelectItem>
                      {row.userRosterPlayers
                        .slice()
                        .sort((a, b) => a.value - b.value)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-sm">
                            <span className="flex items-center gap-2">
                              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", {
                                "bg-rose-900/30 text-rose-400": p.position === "QB",
                                "bg-emerald-900/30 text-emerald-400": p.position === "RB",
                                "bg-sky-900/30 text-sky-400": p.position === "WR",
                                "bg-yellow-900/30 text-yellow-400": p.position === "TE",
                              })}>{p.position}</span>
                              {p.name}
                              <span className="text-muted-foreground text-[11px]">{p.team} · {p.value.toLocaleString()}</span>
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {isFaab && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      FAAB Bid
                      <span className="text-muted-foreground/60 normal-case font-normal ml-1">(${row.faabRemaining} remaining)</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={row.faabRemaining}
                        value={faabBid}
                        onChange={(e) => setFaabBid(Math.min(row.faabRemaining, Math.max(0, Number(e.target.value))))}
                        className="bg-[#0a1628] border-[#1a2d4a] focus:border-[#d4af37]/50 w-28"
                        data-testid="input-faab-bid"
                      />
                      <span className="text-xs text-muted-foreground">/ ${row.faabBudget} budget</span>
                    </div>
                  </div>
                )}

                {submitError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/25 text-xs text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {submitError}
                  </div>
                )}
              </div>
            )}

            {sleeperToken && (
              <DialogFooter className="gap-2 pt-2">
                <Button variant="outline" size="sm" className="border-[#1a2d4a]" onClick={onClose}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleClaim}
                  disabled={submitting || !selectedAddId || !row.rosterId}
                  className="bg-[#d4af37] hover:bg-[#d4af37]/90 text-[#0a1628] font-semibold"
                  data-testid="btn-submit-claim"
                >
                  {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                  {submitting ? "Submitting…" : isFaab ? `Bid $${faabBid}` : "Add Player"}
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
