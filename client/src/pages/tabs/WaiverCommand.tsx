import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import type { RankedPlayer } from "@/contexts/ValueModelContext";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { submitWaiverClaim } from "@/services/sleeperAuthedApi";
import { getSleeperSession, isSessionExpired, type SleeperSession } from "@/services/sleeperAuth";
import {
  Waves, Zap, Users, DollarSign, Star, TrendingUp, TrendingDown,
  Minus, Lock, AlertCircle, RefreshCw, ChevronUp, ChevronDown,
  Plus, CheckCircle2, ArrowLeft, Search, Trophy, Sprout, BarChart3, LayoutList, Layers, X,
} from "lucide-react";

const SLEEPER_API = "https://api.sleeper.app/v1";

type TierFilter = "all" | "contender" | "bubble" | "rebuild";
type SortKey = "tier" | "openSlots" | "faabPct" | "difference" | "leagueName";
type WaiverView = "overview" | "league" | "bulk";

interface PlayerSummary {
  id: string;
  name: string;
  position: string;
  team: string;
  value: number;
  ownedPct?: number;
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
  rosteredPlayerIds: string[];
  rosterCountByPlayerId: Record<string, number>;
  starterCount: number;
}

interface AvailablePlayer {
  sleeperId: string;
  name: string;
  pos: string;
  team: string;
  age: number;
  dynastyValue: number;
  winNowValue: number;
  userRosterPct: number;
  crossLeaguePct: number;
  sleeperRosterPct: number;
}

type DetailSortKey = "dynastyValue" | "winNowValue" | "age" | "userRosterPct" | "crossLeaguePct" | "sleeperRosterPct";

interface WaiverTransaction {
  transaction_id: string;
  type: string;
  status: string;
  roster_ids: number[];
  settings: { waiver_bid?: number } | null;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  created: number;
}

interface ManagerTendency {
  rosterId: number;
  displayName: string;
  avgBid: number;
  claimCount: number;
  activity: "High" | "Medium" | "Low";
  style: "Aggressive" | "Patient" | "Hype Chaser" | "Balanced";
  notes: string;
}

interface TendencyData {
  loading: boolean;
  transactions: WaiverTransaction[];
  rosterIdToName: Record<number, string>;
}

async function fetchTendencyData(leagueId: string, faabBudget: number): Promise<{ transactions: WaiverTransaction[]; rosterIdToName: Record<number, string> }> {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const [txResults, usersRaw, rostersRaw] = await Promise.all([
    Promise.allSettled(
      weeks.map((w) =>
        fetch(`${SLEEPER_API}/league/${leagueId}/transactions/${w}`)
          .then((r) => r.json())
          .then((d) => (Array.isArray(d) ? d : []) as WaiverTransaction[])
      )
    ),
    fetch(`${SLEEPER_API}/league/${leagueId}/users`).then((r) => r.json()).catch(() => []),
    fetch(`${SLEEPER_API}/league/${leagueId}/rosters`).then((r) => r.json()).catch(() => []),
  ]);

  const allTx: WaiverTransaction[] = txResults.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );
  const waiverTx = allTx.filter((t) => t.type === "waiver" && t.status === "complete");

  const ownerIdToName: Record<string, string> = {};
  (usersRaw as any[]).forEach((u: any) => {
    ownerIdToName[u.user_id] = u.display_name || u.username || `Team ${u.user_id.slice(-4)}`;
  });

  const rosterIdToName: Record<number, string> = {};
  (rostersRaw as any[]).forEach((r: any) => {
    const name = ownerIdToName[r.owner_id] ?? `Team ${r.roster_id}`;
    rosterIdToName[r.roster_id] = name;
  });

  return { transactions: waiverTx, rosterIdToName };
}

function computeTendencies(
  transactions: WaiverTransaction[],
  rosterIdToName: Record<number, string>,
  faabBudget: number
): { summaryMetrics: { aggressionScore: number; avgWinningBidPct: number; activeBidders: number; claimsPerWeek: number; highestBidPct: number }; managerTendencies: ManagerTendency[] } {
  if (transactions.length === 0) {
    return { summaryMetrics: { aggressionScore: 0, avgWinningBidPct: 0, activeBidders: 0, claimsPerWeek: 0, highestBidPct: 0 }, managerTendencies: [] };
  }

  const budget = faabBudget > 0 ? faabBudget : 100;
  const bids = transactions.map((t) => t.settings?.waiver_bid ?? 0);
  const bidPcts = bids.map((b) => (b / budget) * 100);
  const avgWinningBidPct = bidPcts.length > 0 ? Math.round(bidPcts.reduce((s, v) => s + v, 0) / bidPcts.length) : 0;
  const highestBidPct = bidPcts.length > 0 ? Math.round(Math.max(...bidPcts)) : 0;
  const activeBidders = new Set(transactions.map((t) => t.roster_ids[0])).size;

  const weekSet = new Set<number>();
  transactions.forEach((t) => {
    const weekApprox = Math.floor(t.created / (1000 * 60 * 60 * 24 * 7));
    weekSet.add(weekApprox);
  });
  const weeksActive = Math.max(1, weekSet.size);
  const claimsPerWeek = Math.round((transactions.length / weeksActive) * 10) / 10;

  const aggressionScore = Math.min(100, Math.round(
    (avgWinningBidPct / 25) * 60 + (claimsPerWeek / 15) * 25 + (activeBidders / 12) * 15
  ));

  const byRoster: Record<number, { bids: number[]; adds: Record<string, number> }> = {};
  transactions.forEach((t) => {
    const rid = t.roster_ids[0];
    if (!rid) return;
    if (!byRoster[rid]) byRoster[rid] = { bids: [], adds: {} };
    byRoster[rid].bids.push(t.settings?.waiver_bid ?? 0);
    Object.keys(t.adds ?? {}).forEach((pid) => {
      byRoster[rid].adds[pid] = (byRoster[rid].adds[pid] ?? 0) + 1;
    });
  });

  const managerTendencies: ManagerTendency[] = Object.entries(byRoster)
    .map(([ridStr, data]) => {
      const rid = Number(ridStr);
      const displayName = rosterIdToName[rid] ?? `Team ${rid}`;
      const bidPctArr = data.bids.map((b) => (b / budget) * 100);
      const avgBid = bidPctArr.length > 0 ? Math.round(bidPctArr.reduce((s, v) => s + v, 0) / bidPctArr.length) : 0;
      const claimCount = data.bids.length;
      const activity: "High" | "Medium" | "Low" = claimCount >= 6 ? "High" : claimCount >= 3 ? "Medium" : "Low";
      const maxBid = bidPctArr.length > 0 ? Math.max(...bidPctArr) : 0;
      const variance = bidPctArr.length > 1 ? Math.sqrt(bidPctArr.reduce((s, v) => s + (v - avgBid) ** 2, 0) / bidPctArr.length) : 0;

      let style: ManagerTendency["style"];
      if (avgBid >= 16) style = "Aggressive";
      else if (avgBid <= 5 && activity !== "High") style = "Patient";
      else if (variance >= 10 && maxBid >= 20) style = "Hype Chaser";
      else style = "Balanced";

      const notes: string[] = [];
      if (style === "Aggressive") notes.push("Frequently outbids competition");
      else if (style === "Patient") notes.push("Conserves FAAB budget");
      else if (style === "Hype Chaser") notes.push("Spikes on high-value targets");
      if (claimCount >= 8) notes.push("Very active on wire");
      else if (claimCount === 0) notes.push("Rarely uses waivers");
      if (maxBid >= 30) notes.push(`Peak bid ${Math.round(maxBid)}%`);

      return { rosterId: rid, displayName, avgBid, claimCount, activity, style, notes: notes.join(" · ") || "—" };
    })
    .sort((a, b) => b.claimCount - a.claimCount);

  return { summaryMetrics: { aggressionScore, avgWinningBidPct, activeBidders, claimsPerWeek, highestBidPct }, managerTendencies };
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
  const [claimPreAddId, setClaimPreAddId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<WaiverRow | null>(null);
  const [activeView, setActiveView] = useState<WaiverView>("overview");

  const openClaim = useCallback((row: WaiverRow, preAddId?: string) => {
    setClaimRow(row);
    setClaimPreAddId(preAddId ?? null);
  }, []);

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
      rosteredPlayerIds: [],
      rosterCountByPlayerId: {},
      starterCount: 0,
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
            rosteredPlayerIds: [],
            rosterCountByPlayerId: {},
            starterCount: 0,
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
              return { id: pid, name: p.full_name || "Unknown", position: pos, team: p.team || "FA", value: val, ownedPct: p.ownership?.owned_pct };
            })
            .sort((a, b) => b.value - a.value)
            .slice(0, 50);

          const rosterCountByPlayerId: Record<string, number> = {};
          rostersRaw.forEach((r: any) => {
            (r.players ?? []).forEach((pid: string) => {
              rosterCountByPlayerId[pid] = (rosterCountByPlayerId[pid] ?? 0) + 1;
            });
          });
          const rosteredPlayerIds = Object.keys(rosterCountByPlayerId);

          const nonBench = new Set(["BN", "TAXI", "IR"]);
          const starterCount = (leagueRaw?.roster_positions ?? []).filter((p: string) => !nonBench.has(p)).length;

          const { tier, rank, total } = deriveLeagueTier(userRosterId, rostersRaw, valuesBySleeperId);

          return { ...base, tier, tierRank: rank, totalTeams: total, openSlots, faabRemaining, faabBudget, faabPct, bestAvailable, lowestOnTeam, difference, rosterId: userRosterId, waiverType, userRosterPlayers, topAvailable, rosteredPlayerIds, rosterCountByPlayerId, starterCount };
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

        <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-0.5 bg-muted/50 dark:bg-white/[0.04] rounded-lg p-0.5 border border-border/40 dark:border-white/[0.06]">
            {([
              { id: "overview" as const, icon: LayoutList, label: "Overview" },
              { id: "league"   as const, icon: BarChart3,  label: "League View" },
              { id: "bulk"     as const, icon: Layers,     label: "Bulk Claims" },
            ]).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => {
                  setActiveView(id);
                  if (id === "league" && !detailRow) {
                    const first = rows.find(r => !r.loading && !r.error);
                    if (first) setDetailRow(first);
                  }
                }}
                data-testid={`view-toggle-${id}`}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  activeView === id
                    ? "bg-background shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeView === "overview" && (<>
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
                  { key: null,                    label: "Detail",          align: "center" },
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
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No leagues match this filter.
                  </td>
                </tr>
              )}
              {sorted.map((row) => (
                <WaiverTableRow key={row.leagueId} row={row} onClaim={() => openClaim(row)} onView={() => { setDetailRow(row); setActiveView("league"); }} />
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
      </>)}

      {activeView === "league" && (
        <div className="space-y-4">
          {/* League picker */}
          <div className="flex items-center gap-2">
            <Select
              value={detailRow?.leagueId ?? ""}
              onValueChange={id => {
                const found = rows.find(r => r.leagueId === id);
                if (found) setDetailRow(found);
              }}
            >
              <SelectTrigger
                className="w-72 bg-[#0a1628] border-[#1a2d4a] focus:border-[#d4af37]/50 text-sm"
                data-testid="select-league-view"
              >
                <SelectValue placeholder="Select a league…" />
              </SelectTrigger>
              <SelectContent className="bg-[#0c1929] border-[#1a2d4a]">
                {rows.filter(r => !r.loading && !r.error).map(r => (
                  <SelectItem key={r.leagueId} value={r.leagueId} className="text-sm">
                    <span className="flex items-center gap-2">
                      {r.leagueAvatar ? (
                        <img src={r.leagueAvatar} alt="" className="w-4 h-4 rounded-full flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-[#0b3a7a]/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-[8px] font-bold text-blue-400">{r.leagueName[0]}</span>
                        </div>
                      )}
                      {r.leagueName}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {detailRow && (
              <span className="text-xs text-muted-foreground">
                {rows.filter(r => !r.loading && !r.error).length} leagues loaded
              </span>
            )}
          </div>

          {detailRow ? (
            <LeagueWaiverDetail
              row={detailRow}
              allRows={rows}
              onBack={() => setActiveView("overview")}
              onClaim={(preAddId) => openClaim(detailRow, preAddId)}
              claimModal={<ClaimPlayerModal row={claimRow} preAddId={claimPreAddId} onClose={() => { setClaimRow(null); setClaimPreAddId(null); }} />}
            />
          ) : isFetching ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#d4af37]" />
              <span>Loading leagues…</span>
            </div>
          ) : (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Select a league above to view its detail.
            </div>
          )}
        </div>
      )}

      {activeView === "bulk" && (
        <BulkClaimsView
          rows={rows}
          dynastyPlayerList={dynastyPlayerList}
          isFetching={isFetching}
        />
      )}

      <ClaimPlayerModal row={claimRow} preAddId={claimPreAddId} onClose={() => { setClaimRow(null); setClaimPreAddId(null); }} />
    </div>
  );
}

function WaiverTableRow({ row, onClaim, onView }: { row: WaiverRow; onClaim: () => void; onView: () => void }) {
  const diffColor = row.difference > 300
    ? "text-emerald-600 dark:text-emerald-400"
    : row.difference > 0
    ? "text-amber-600 dark:text-amber-400"
    : "text-rose-600 dark:text-rose-400";

  if (row.loading) {
    return (
      <tr className="animate-pulse">
        {Array.from({ length: 9 }).map((_, i) => (
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
        <td colSpan={8} className="px-4 py-3">
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
          <PlayerAvatar
            id={row.bestAvailable.id}
            name={row.bestAvailable.name}
            pos={row.bestAvailable.position}
            team={row.bestAvailable.team}
            size="sm"
          />
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
          <PlayerAvatar
            id={row.lowestOnTeam.id}
            name={row.lowestOnTeam.name}
            pos={row.lowestOnTeam.position}
            team={row.lowestOnTeam.team}
            size="sm"
            sub={row.lowestOnTeam.value.toLocaleString()}
          />
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

      {/* View detail */}
      <td className="px-4 py-3 text-center">
        <button
          onClick={onView}
          data-testid={`btn-view-${row.leagueId}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 bg-[#0b3a7a]/10 text-[#0b3a7a] dark:bg-blue-400/10 dark:text-blue-400 hover:bg-[#0b3a7a]/20 dark:hover:bg-blue-400/20 border border-[#0b3a7a]/20 dark:border-blue-400/20"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Detail
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

// ─── Bulk Claims ───────────────────────────────────────────────────────────

interface BulkScanRow {
  leagueId: string;
  leagueName: string;
  leagueAvatar: string | null;
  rosterId: number | null;
  available: boolean;
  openSlots: number;
  rosterFull: boolean;
  faabRemaining: number;
  faabBudget: number;
  waiverType: number;
  suggestedDrop: PlayerSummary | null;
  rosterPlayers: PlayerSummary[];
  suggestedBid: number;
  warnings: string[];
}

interface LeagueSel {
  selected: boolean;
  bid: number;
  dropId: string;
}

function computeBulkScan(rows: WaiverRow[], player: RankedPlayer): BulkScanRow[] {
  return rows
    .filter(r => !r.loading && !r.error)
    .map(r => {
      const available = !r.rosteredPlayerIds.includes(player.sleeperId);
      const rosterFull = r.openSlots === 0;
      const isFaab = r.waiverType === 2;
      const warnings: string[] = [];
      if (!available) warnings.push("Already rostered");
      else if (rosterFull) warnings.push("Roster full — must drop");
      if (available && isFaab && r.faabRemaining === 0) warnings.push("$0 FAAB remaining");
      const suggestedBid = isFaab
        ? Math.min(Math.round(r.faabRemaining * 0.12), r.faabRemaining)
        : 0;
      return {
        leagueId: r.leagueId,
        leagueName: r.leagueName,
        leagueAvatar: r.leagueAvatar,
        rosterId: r.rosterId,
        available,
        openSlots: r.openSlots,
        rosterFull,
        faabRemaining: r.faabRemaining,
        faabBudget: r.faabBudget,
        waiverType: r.waiverType,
        suggestedDrop: r.lowestOnTeam,
        rosterPlayers: r.userRosterPlayers.slice().sort((a, b) => a.value - b.value),
        suggestedBid,
        warnings,
      };
    });
}

function BulkClaimsView({
  rows,
  dynastyPlayerList,
  isFetching,
}: {
  rows: WaiverRow[];
  dynastyPlayerList: RankedPlayer[];
  isFetching: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [targetPlayer, setTargetPlayer] = useState<RankedPlayer | null>(null);
  const [scanResults, setScanResults] = useState<BulkScanRow[]>([]);
  const [selections, setSelections] = useState<Record<string, LeagueSel>>({});
  const [step, setStep] = useState<"search" | "review" | "confirm" | "results">("search");
  const [submitting, setSubmitting] = useState(false);
  const [submitResults, setSubmitResults] = useState<Record<string, { status: "pending" | "success" | "error"; message?: string }>>({});
  const [session, setSession] = useState<SleeperSession | null>(() => getSleeperSession());
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSession(getSleeperSession()); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const suggestions = useMemo(() => {
    if (!query.trim() || query.length < 2) return [];
    const q = query.toLowerCase();
    return dynastyPlayerList.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, dynastyPlayerList]);

  const token = session && !isSessionExpired(session) ? session.token : null;

  const handleSelectPlayer = (p: RankedPlayer) => {
    setTargetPlayer(p);
    setQuery(p.name);
    setShowSuggestions(false);
    const scan = computeBulkScan(rows, p);
    setScanResults(scan);
    const sel: Record<string, LeagueSel> = {};
    for (const r of scan) {
      const canClaim = r.available && !(r.waiverType === 2 && r.faabRemaining === 0);
      sel[r.leagueId] = {
        selected: canClaim,
        bid: r.suggestedBid,
        dropId: r.rosterFull && r.suggestedDrop ? r.suggestedDrop.id : "none",
      };
    }
    setSelections(sel);
    setStep("review");
  };

  const selectedLeagues = scanResults.filter(r => selections[r.leagueId]?.selected);
  const totalFaab = selectedLeagues.reduce((s, r) => s + (r.waiverType === 2 ? (selections[r.leagueId]?.bid ?? 0) : 0), 0);
  const highestBid = selectedLeagues.reduce((m, r) => Math.max(m, r.waiverType === 2 ? (selections[r.leagueId]?.bid ?? 0) : 0), 0);
  const dropCount = selectedLeagues.filter(r => selections[r.leagueId]?.dropId !== "none").length;

  const handleSubmit = async () => {
    if (!token) return;
    const initial: Record<string, { status: "pending" | "success" | "error" }> = {};
    for (const r of selectedLeagues) initial[r.leagueId] = { status: "pending" };
    setSubmitResults(initial);
    setStep("results");
    setSubmitting(true);
    for (const r of selectedLeagues) {
      const sel = selections[r.leagueId];
      try {
        await submitWaiverClaim(
          r.leagueId,
          r.rosterId!,
          [targetPlayer!.sleeperId],
          sel.dropId !== "none" ? [sel.dropId] : [],
          r.waiverType === 2 ? sel.bid : 0
        );
        setSubmitResults(prev => ({ ...prev, [r.leagueId]: { status: "success" } }));
      } catch (e: any) {
        setSubmitResults(prev => ({ ...prev, [r.leagueId]: { status: "error", message: e.message ?? "Claim failed" } }));
      }
    }
    setSubmitting(false);
  };

  const handleReset = () => {
    setQuery(""); setTargetPlayer(null); setScanResults([]);
    setSelections({}); setStep("search"); setSubmitResults({});
  };

  const posBadge: Record<string, string> = {
    QB: "bg-rose-900/30 text-rose-400",
    RB: "bg-emerald-900/30 text-emerald-400",
    WR: "bg-sky-900/30 text-sky-400",
    TE: "bg-yellow-900/30 text-yellow-400",
  };
  const posText: Record<string, string> = {
    QB: "text-rose-400", RB: "text-emerald-400", WR: "text-sky-400", TE: "text-yellow-400",
  };

  // ── SEARCH ──
  if (step === "search") {
    return (
      <div className="flex flex-col items-center gap-8 py-8 px-4 max-w-xl mx-auto">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-xl bg-[#d4af37]/10 ring-1 ring-[#d4af37]/25 flex items-center justify-center mb-3">
            <Layers className="w-5 h-5 text-[#d4af37]" />
          </div>
          <h3 className="text-xl font-bold">Bulk Waiver Claims</h3>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
            Search one player, scan every league, and submit waiver claims across your full dynasty portfolio.
          </p>
        </div>

        {isFetching && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#d4af37]" />
            Still loading league data — you can search now, results will update.
          </div>
        )}

        <div className="w-full relative" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search player — e.g. Ty Chandler"
              value={query}
              onChange={e => { setQuery(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              className="pl-9 h-11 text-sm bg-[#0a1628] border-[#1a2d4a] focus:border-[#d4af37]/50"
              data-testid="input-bulk-search"
            />
            {query && (
              <button
                onClick={() => { setQuery(""); setShowSuggestions(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#0c1929] border border-[#1a2d4a] rounded-lg shadow-xl overflow-hidden">
              {suggestions.map(p => (
                <button
                  key={p.sleeperId}
                  onClick={() => handleSelectPlayer(p)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors text-left"
                  data-testid={`suggestion-${p.sleeperId}`}
                >
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded min-w-[26px] text-center", posBadge[p.pos] ?? "bg-muted text-muted-foreground")}>{p.pos}</span>
                  <span className="flex-1 text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.team}</span>
                  <span className="text-xs text-[#d4af37] font-semibold tabular-nums">{p.value.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
          {showSuggestions && query.length >= 2 && suggestions.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#0c1929] border border-[#1a2d4a] rounded-lg shadow-xl px-4 py-3 text-sm text-muted-foreground">
              No players found for "{query}"
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── REVIEW ──
  if (step === "review" && targetPlayer) {
    const availableCount = scanResults.filter(r => r.available).length;
    const eligibleCount = scanResults.filter(r => r.available && !r.warnings.some(w => w.includes("$0 FAAB"))).length;
    const allEligibleSelected = eligibleCount > 0 && scanResults
      .filter(r => r.available && !r.warnings.some(w => w.includes("$0 FAAB")))
      .every(r => selections[r.leagueId]?.selected);

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleReset} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> New Search
          </button>
          <div className="h-4 w-px bg-border/50" />
          <div className="flex items-center gap-2">
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", posBadge[targetPlayer.pos] ?? "bg-muted text-muted-foreground")}>{targetPlayer.pos}</span>
            <span className="font-bold text-foreground">{targetPlayer.name}</span>
            <span className="text-xs text-muted-foreground">{targetPlayer.team} · {targetPlayer.value.toLocaleString()}</span>
          </div>
        </div>

        {/* Summary pills */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
            Available in {availableCount} of {scanResults.length} leagues
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20 font-semibold">
            Eligible to claim: {eligibleCount}
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 text-muted-foreground border border-border/40 font-semibold">
            Already rostered: {scanResults.length - availableCount}
          </span>
        </div>

        {/* Auth warning */}
        {!token && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200/80">
              <strong className="text-amber-300">Sleeper write access required</strong> — Go to{" "}
              <strong>Connect</strong> → Sleeper Actions and sign in before submitting.
            </p>
          </div>
        )}

        {/* Results table */}
        <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80">
          <div className="px-4 py-3 border-b border-border/40 dark:border-white/[0.06] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
              <span className="text-sm font-bold">League Scan Results</span>
              <span className="text-xs text-muted-foreground">{scanResults.length} leagues</span>
            </div>
            <button
              onClick={() => {
                const next = { ...selections };
                scanResults.forEach(r => {
                  const canClaim = r.available && !(r.waiverType === 2 && r.faabRemaining === 0);
                  if (canClaim) next[r.leagueId] = { ...next[r.leagueId], selected: !allEligibleSelected };
                });
                setSelections(next);
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {allEligibleSelected ? "Deselect All" : "Select All Eligible"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 dark:border-white/[0.05] bg-muted/30 dark:bg-white/[0.02]">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">League</th>
                  <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Open Slots</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Suggested Drop</th>
                  <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">FAAB Left</th>
                  <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Bid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 dark:divide-white/[0.04]">
                {scanResults.map(r => {
                  const sel = selections[r.leagueId] ?? { selected: false, bid: 0, dropId: "none" };
                  const isFaab = r.waiverType === 2;
                  const canClaim = r.available && !(isFaab && r.faabRemaining === 0);
                  return (
                    <tr
                      key={r.leagueId}
                      className={cn(
                        "transition-colors",
                        sel.selected ? "bg-[#d4af37]/[0.03]" : "",
                        !canClaim ? "opacity-55" : "hover:bg-white/[0.02]"
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <Checkbox
                          checked={sel.selected}
                          disabled={!canClaim}
                          onCheckedChange={v => setSelections(prev => ({ ...prev, [r.leagueId]: { ...prev[r.leagueId], selected: !!v } }))}
                          data-testid={`check-${r.leagueId}`}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          {r.leagueAvatar ? (
                            <img src={r.leagueAvatar} alt="" className="w-5 h-5 rounded-full flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-[#0b3a7a]/30 flex items-center justify-center flex-shrink-0">
                              <span className="text-[8px] font-bold text-blue-400">{r.leagueName[0]}</span>
                            </div>
                          )}
                          <span className="text-xs font-medium truncate max-w-[130px]">{r.leagueName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {!r.available ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 whitespace-nowrap">Rostered</span>
                        ) : isFaab && r.faabRemaining === 0 ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted/60 text-muted-foreground border border-border/40 whitespace-nowrap">$0 FAAB</span>
                        ) : r.rosterFull ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">Must Drop</span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">Available</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">{r.openSlots}</td>
                      <td className="px-3 py-2.5">
                        <Select
                          value={sel.dropId}
                          onValueChange={v => setSelections(prev => ({ ...prev, [r.leagueId]: { ...prev[r.leagueId], dropId: v } }))}
                          disabled={!canClaim}
                        >
                          <SelectTrigger className="h-7 text-[11px] bg-[#0a1628] border-[#1a2d4a] min-w-[140px] focus:border-[#d4af37]/50">
                            <SelectValue placeholder="No drop" />
                          </SelectTrigger>
                          <SelectContent className="bg-[#0c1929] border-[#1a2d4a]">
                            <SelectItem value="none" className="text-xs text-muted-foreground">No drop</SelectItem>
                            {r.rosterPlayers.map(p => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                <span className="flex items-center gap-1.5">
                                  <span className={cn("text-[9px] font-bold", posText[p.position] ?? "text-muted-foreground")}>{p.position}</span>
                                  {p.name}
                                  <span className="text-muted-foreground text-[10px]">{p.value.toLocaleString()}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                        {isFaab ? `$${r.faabRemaining}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {isFaab ? (
                          <Input
                            type="number"
                            min={0}
                            max={r.faabRemaining}
                            value={sel.bid}
                            disabled={!canClaim || !sel.selected}
                            onChange={e => setSelections(prev => ({ ...prev, [r.leagueId]: { ...prev[r.leagueId], bid: Math.min(r.faabRemaining, Math.max(0, Number(e.target.value))) } }))}
                            className="h-7 w-20 text-center text-xs bg-[#0a1628] border-[#1a2d4a] focus:border-[#d4af37]/50"
                            data-testid={`input-bid-${r.leagueId}`}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-muted-foreground">
            {selectedLeagues.length > 0 ? (
              <><strong className="text-foreground">{selectedLeagues.length}</strong> league{selectedLeagues.length !== 1 ? "s" : ""} selected</>
            ) : "No leagues selected"}
          </span>
          <Button
            disabled={selectedLeagues.length === 0}
            onClick={() => setStep("confirm")}
            className="bg-[#d4af37] hover:bg-[#d4af37]/90 text-[#0a1628] font-semibold"
            data-testid="btn-bulk-continue"
          >
            <Layers className="w-4 h-4 mr-2" />
            Review {selectedLeagues.length} Claim{selectedLeagues.length !== 1 ? "s" : ""}
          </Button>
        </div>
      </div>
    );
  }

  // ── CONFIRM ──
  if (step === "confirm" && targetPlayer) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <button onClick={() => setStep("review")} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Review
        </button>

        <Card className="p-5 border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-[#0c1929] to-[#0a1628]">
          <div className="flex items-start gap-3 mb-5 pb-4 border-b border-white/[0.06]">
            <div className="w-10 h-10 rounded-xl bg-[#d4af37]/10 ring-1 ring-[#d4af37]/25 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Layers className="w-5 h-5 text-[#d4af37]" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Confirm Waiver Claims</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                You are about to submit waiver claims for{" "}
                <strong className="text-foreground">{targetPlayer.name}</strong>{" "}
                (<span className={cn("font-semibold", posBadge[targetPlayer.pos] ? posText[targetPlayer.pos] : "")}>{targetPlayer.pos}</span>){" "}
                in <strong className="text-foreground">{selectedLeagues.length}</strong> league{selectedLeagues.length !== 1 ? "s" : ""}.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "Total FAAB", value: `$${totalFaab}` },
              { label: "Highest Bid",  value: `$${highestBid}` },
              { label: "Requiring Drop", value: String(dropCount) },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-lg bg-[#0b3a7a]/10 border border-[#0b3a7a]/20 text-center">
                <div className="text-lg font-bold text-foreground tabular-nums">{value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {selectedLeagues.map(r => {
              const sel = selections[r.leagueId];
              const drop = r.rosterPlayers.find(p => p.id === sel?.dropId);
              const isFaab = r.waiverType === 2;
              return (
                <div key={r.leagueId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  {r.leagueAvatar ? (
                    <img src={r.leagueAvatar} alt="" className="w-5 h-5 rounded-full flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-[#0b3a7a]/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-[8px] font-bold text-blue-400">{r.leagueName[0]}</span>
                    </div>
                  )}
                  <span className="text-xs font-medium flex-1 truncate">{r.leagueName}</span>
                  <div className="flex items-center gap-3 text-xs flex-shrink-0">
                    {isFaab && <span className="text-[#d4af37] font-semibold">Bid ${sel.bid}</span>}
                    {drop && <span className="text-muted-foreground">Drop {drop.name}</span>}
                    {!drop && <span className="text-muted-foreground/40">No drop</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {!token && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-rose-200/80">
              <strong className="text-rose-300">Cannot submit — Sleeper write access not connected.</strong>{" "}
              Go to Connect and sign in via Sleeper Actions, then return here.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 justify-end">
          <Button variant="outline" onClick={() => setStep("review")} className="border-[#1a2d4a]">
            Back to Review
          </Button>
          <Button
            disabled={!token || submitting}
            onClick={handleSubmit}
            className="bg-[#d4af37] hover:bg-[#d4af37]/90 text-[#0a1628] font-semibold"
            data-testid="btn-bulk-submit"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Submit {selectedLeagues.length} Claim{selectedLeagues.length !== 1 ? "s" : ""}
          </Button>
        </div>
      </div>
    );
  }

  // ── RESULTS ──
  if (step === "results" && targetPlayer) {
    const successCount = Object.values(submitResults).filter(r => r.status === "success").length;
    const errorCount = Object.values(submitResults).filter(r => r.status === "error").length;
    const pendingCount = Object.values(submitResults).filter(r => r.status === "pending").length;

    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", posBadge[targetPlayer.pos] ?? "bg-muted text-muted-foreground")}>{targetPlayer.pos}</span>
            <span className="font-bold text-foreground">{targetPlayer.name}</span>
          </div>
          <div className="ml-auto">
            <button onClick={handleReset} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Search className="w-3 h-3" /> New Search
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          {successCount > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
              <CheckCircle2 className="w-3 h-3" /> {successCount} submitted
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-semibold">
              <AlertCircle className="w-3 h-3" /> {errorCount} failed
            </span>
          )}
          {pendingCount > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 text-muted-foreground border border-border/40 font-semibold">
              <RefreshCw className="w-3 h-3 animate-spin" /> {pendingCount} pending
            </span>
          )}
        </div>

        <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80">
          <div className="divide-y divide-border/30 dark:divide-white/[0.04]">
            {selectedLeagues.map(r => {
              const result = submitResults[r.leagueId];
              const sel = selections[r.leagueId];
              const drop = r.rosterPlayers.find(p => p.id === sel?.dropId);
              const isFaab = r.waiverType === 2;
              return (
                <div key={r.leagueId} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-shrink-0 w-5 flex items-center justify-center">
                    {!result || result.status === "pending" ? (
                      <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
                    ) : result.status === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {r.leagueAvatar ? (
                      <img src={r.leagueAvatar} alt="" className="w-5 h-5 rounded-full flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-[#0b3a7a]/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-[8px] font-bold text-blue-400">{r.leagueName[0]}</span>
                      </div>
                    )}
                    <span className="text-xs font-medium truncate">{r.leagueName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                    {isFaab && sel?.bid > 0 && <span className="text-[#d4af37] font-semibold">Bid ${sel.bid}</span>}
                    {drop && <span>Drop {drop.name}</span>}
                  </div>
                  <div className="text-xs font-semibold flex-shrink-0 w-20 text-right">
                    {!result || result.status === "pending" ? (
                      <span className="text-muted-foreground">Submitting…</span>
                    ) : result.status === "success" ? (
                      <span className="text-emerald-400">Submitted</span>
                    ) : (
                      <span className="text-rose-400" title={result.message}>Failed</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {!submitting && (
          <p className="text-xs text-muted-foreground text-center">
            Check Sleeper to confirm transactions processed. Claims may still be pending waiver resolution.
          </p>
        )}
      </div>
    );
  }

  return null;
}

// PlayerAvatar is imported from @/components/PlayerAvatar

function ClaimPlayerModal({ row, preAddId, onClose }: { row: WaiverRow | null; preAddId?: string | null; onClose: () => void }) {
  const [session, setSession] = useState<SleeperSession | null>(() => getSleeperSession());

  const [selectedAddId, setSelectedAddId] = useState<string>("");
  const [selectedDropId, setSelectedDropId] = useState<string>("none");
  const [faabBid, setFaabBid] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!row) return;
    setSession(getSleeperSession());
    const defaultAdd = preAddId ?? row.bestAvailable?.id ?? row.topAvailable[0]?.id ?? "";
    setSelectedAddId(defaultAdd);
    setSelectedDropId("none");
    setFaabBid(Math.min(10, row.faabRemaining));
    setSubmitError(null);
    setSuccess(false);
  }, [row, preAddId]);

  if (!row) return null;

  const token = session && !isSessionExpired(session) ? session.token : null;
  const isFaab = row.waiverType === 2;
  const selectedAdd = row.topAvailable.find((p) => p.id === selectedAddId) ?? row.bestAvailable ?? null;
  const selectedDrop = selectedDropId !== "none" ? row.userRosterPlayers.find((p) => p.id === selectedDropId) ?? null : null;

  const handleClaim = async () => {
    if (!token || !selectedAdd || !row.rosterId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitWaiverClaim(
        row.leagueId,
        row.rosterId,
        [selectedAdd.id],
        selectedDrop ? [selectedDrop.id] : [],
        isFaab ? faabBid : 0
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
        ) : !token ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Sleeper write access required</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  Go to <strong className="text-foreground">Connect</strong> in the top nav and complete the{" "}
                  <strong className="text-foreground">Sleeper Actions (write access)</strong> sign-in, then come back to claim.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full border-[#1a2d4a]" onClick={onClose}>Got it</Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="flex items-center p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Signed in as @{session!.display_name}
                </div>
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TopAddCard({
  icon,
  label,
  player,
  sub,
  accent,
  onClaim,
}: {
  icon: React.ReactNode;
  label: string;
  player: AvailablePlayer | null;
  sub: string;
  accent: "gold" | "blue" | "green" | "purple";
  onClaim: () => void;
}) {
  const accentMap = {
    gold:   { icon: "text-[#d4af37]",  bg: "bg-[#d4af37]/10",   ring: "ring-[#d4af37]/20",  btn: "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/30 hover:bg-[#d4af37]/25" },
    blue:   { icon: "text-blue-400",   bg: "bg-blue-400/10",    ring: "ring-blue-400/20",    btn: "bg-blue-400/10 text-blue-400 border-blue-400/20 hover:bg-blue-400/20" },
    green:  { icon: "text-emerald-400",bg: "bg-emerald-400/10", ring: "ring-emerald-400/20", btn: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20 hover:bg-emerald-400/20" },
    purple: { icon: "text-violet-400", bg: "bg-violet-400/10",  ring: "ring-violet-400/20",  btn: "bg-violet-400/10 text-violet-400 border-violet-400/20 hover:bg-violet-400/20" },
  };
  const c = accentMap[accent];

  return (
    <Card className="p-4 border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-br from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628] flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ring-1", c.bg, c.ring)}>
          <span className={c.icon}>{icon}</span>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      {player ? (
        <>
          <PlayerAvatar
            id={player.sleeperId}
            name={player.name}
            pos={player.pos}
            team={player.team}
            size="md"
          />
          <div className="text-[11px] text-muted-foreground">{sub}</div>
          <button
            onClick={onClaim}
            className={cn("mt-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 border", c.btn)}
          >
            <Plus className="w-3.5 h-3.5" />
            Claim
          </button>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">No data</div>
      )}
    </Card>
  );
}

function LeagueWaiverDetail({
  row,
  allRows,
  onBack,
  onClaim,
  claimModal,
}: {
  row: WaiverRow;
  allRows: WaiverRow[];
  onBack: () => void;
  onClaim: (preAddId: string) => void;
  claimModal: React.ReactNode;
}) {
  const { dynastyPlayerList, valuesBySleeperId, redraftValuesBySleeperId } = useValueModel();
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<DetailSortKey>("dynastyValue");
  const [sortAsc, setSortAsc] = useState(false);
  const [tendency, setTendency] = useState<TendencyData>({ loading: true, transactions: [], rosterIdToName: {} });

  useEffect(() => {
    setTendency({ loading: true, transactions: [], rosterIdToName: {} });
    fetchTendencyData(row.leagueId, row.faabBudget)
      .then(({ transactions, rosterIdToName }) => setTendency({ loading: false, transactions, rosterIdToName }))
      .catch(() => setTendency({ loading: false, transactions: [], rosterIdToName: {} }));
  }, [row.leagueId, row.faabBudget]);

  const { summaryMetrics, managerTendencies } = useMemo(
    () => computeTendencies(tendency.transactions, tendency.rosterIdToName, row.faabBudget),
    [tendency.transactions, tendency.rosterIdToName, row.faabBudget]
  );

  const allLeagueTeamCount = allRows.reduce((s, r) => s + r.totalTeams, 0);
  const totalLeaguesLoaded = allRows.filter((r) => !r.loading && !r.error).length;

  const availablePlayers: AvailablePlayer[] = useMemo(() => {
    const rosteredSet = new Set(row.rosteredPlayerIds);
    return row.topAvailable.map((ps) => {
      const dp = dynastyPlayerList.find((p) => p.sleeperId === ps.id);
      const age = dp?.age ?? 0;
      const winNowValue = redraftValuesBySleeperId[ps.id] ?? 0;
      const dynastyValue = valuesBySleeperId[ps.id] ?? ps.value;

      let userRosterCount = 0;
      let crossLeagueRostered = 0;
      allRows.forEach((r) => {
        if (r.loading || r.error) return;
        if ((r.rosterCountByPlayerId[ps.id] ?? 0) > 0) crossLeagueRostered++;
        const userTeams = allRows.filter((rr) => !rr.loading && !rr.error).length;
        if (r.rosterCountByPlayerId[ps.id] ?? 0) userRosterCount++;
      });
      const userRosterPct = totalLeaguesLoaded > 0 ? Math.round((userRosterCount / totalLeaguesLoaded) * 100) : 0;
      const crossLeaguePct = allLeagueTeamCount > 0
        ? Math.round((Object.values(row.rosterCountByPlayerId).reduce((s, v) => s + (row.rosterCountByPlayerId[ps.id] ?? 0 > 0 ? 1 : 0), 0) / row.totalTeams) * 100)
        : 0;

      const ownedCount = row.rosterCountByPlayerId[ps.id] ?? 0;
      const ownershipPct = row.totalTeams > 0 ? Math.round((ownedCount / row.totalTeams) * 100) : 0;

      let totalTeamsWithPlayer = 0;
      let totalTeamsAcrossLeagues = 0;
      allRows.forEach((r) => {
        if (r.loading || r.error) return;
        totalTeamsAcrossLeagues += r.totalTeams;
        totalTeamsWithPlayer += (r.rosterCountByPlayerId[ps.id] ?? 0);
      });
      const sleeperRosterPct = totalTeamsAcrossLeagues > 0
        ? Math.round((totalTeamsWithPlayer / totalTeamsAcrossLeagues) * 100)
        : -1;
      return { sleeperId: ps.id, name: ps.name, pos: ps.position, team: ps.team, age, dynastyValue, winNowValue, userRosterPct, crossLeaguePct: ownershipPct, sleeperRosterPct };
    });
  }, [row, dynastyPlayerList, valuesBySleeperId, redraftValuesBySleeperId, allRows, totalLeaguesLoaded, allLeagueTeamCount]);

  const topByDynasty  = availablePlayers.slice().sort((a, b) => b.dynastyValue - a.dynastyValue)[0] ?? null;
  const topByWinNow   = availablePlayers.slice().sort((a, b) => b.winNowValue - a.winNowValue)[0] ?? null;
  const youngest      = availablePlayers.filter((p) => p.age > 0).slice().sort((a, b) => a.age - b.age)[0] ?? null;
  const mostOwned     = availablePlayers.slice().sort((a, b) => b.userRosterPct - a.userRosterPct)[0] ?? null;

  const filtered = useMemo(() => {
    let list = availablePlayers;
    if (posFilter !== "ALL") list = list.filter((p) => p.pos === posFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    list = list.slice().sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortAsc ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
    return list;
  }, [availablePlayers, posFilter, search, sortKey, sortAsc]);

  const handleSort = (col: DetailSortKey) => {
    if (sortKey === col) setSortAsc((a) => !a);
    else { setSortKey(col); setSortAsc(false); }
  };

  const DetailSortIcon = ({ col }: { col: DetailSortKey }) => {
    if (sortKey !== col) return <Minus className="w-3 h-3 opacity-30" />;
    return sortAsc ? <ChevronUp className="w-3 h-3 text-[#d4af37]" /> : <ChevronDown className="w-3 h-3 text-[#d4af37]" />;
  };

  const tierAccent = getTierAccent(row.tier);

  return (
    <div className="space-y-5">
      {/* Back nav + header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            data-testid="btn-back-detail"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-all border border-border/40"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All Leagues
          </button>
          <div className="flex items-center gap-2.5">
            {row.leagueAvatar ? (
              <img src={row.leagueAvatar} alt="" className="w-9 h-9 rounded-full object-cover ring-1 ring-border/40" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#0b3a7a]/20 dark:bg-blue-900/40 flex items-center justify-center ring-1 ring-border/40">
                <span className="text-[12px] font-bold text-[#0b3a7a] dark:text-blue-400 uppercase">{row.leagueName[0] ?? "?"}</span>
              </div>
            )}
            <div>
              <h2 className="text-lg font-bold text-foreground leading-tight">{row.leagueName}</h2>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">${row.faabRemaining}</span> FAAB remaining
          <span className="text-muted-foreground/40">·</span>
          <span className="font-semibold text-foreground">{row.openSlots}</span> open slot{row.openSlots !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Top Add cards */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
          <h3 className="text-sm font-bold text-foreground">Top Recommended Adds</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <TopAddCard
            icon={<Trophy className="w-4 h-4" />}
            label="Best Dynasty"
            player={topByDynasty}
            sub={topByDynasty ? `Dynasty value: ${topByDynasty.dynastyValue.toLocaleString()}` : ""}
            accent="gold"
            onClaim={() => topByDynasty && onClaim(topByDynasty.sleeperId)}
          />
          <TopAddCard
            icon={<TrendingUp className="w-4 h-4" />}
            label="Win-Now"
            player={topByWinNow}
            sub={topByWinNow ? `Redraft value: ${topByWinNow.winNowValue.toLocaleString()}` : ""}
            accent="blue"
            onClaim={() => topByWinNow && onClaim(topByWinNow.sleeperId)}
          />
          <TopAddCard
            icon={<Sprout className="w-4 h-4" />}
            label="Youngest"
            player={youngest}
            sub={youngest ? `Age: ${youngest.age}` : ""}
            accent="green"
            onClaim={() => youngest && onClaim(youngest.sleeperId)}
          />
          <TopAddCard
            icon={<BarChart3 className="w-4 h-4" />}
            label="Most Owned"
            player={mostOwned}
            sub={mostOwned ? `${mostOwned.userRosterPct}% of your leagues` : ""}
            accent="purple"
            onClaim={() => mostOwned && onClaim(mostOwned.sleeperId)}
          />
        </div>
      </div>

      {/* Available players table */}
      <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80">
        <div className="px-5 py-3.5 border-b border-border/40 dark:border-white/[0.06] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
            <h3 className="text-sm font-bold text-foreground">Available Players</h3>
            <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Position filter */}
            {["ALL","QB","RB","WR","TE"].map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                data-testid={`filter-pos-${pos}`}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all",
                  posFilter === pos
                    ? "bg-[#d4af37] text-[#0a1628]"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
                )}
              >
                {pos}
              </button>
            ))}
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search player…"
                data-testid="input-player-search"
                className="pl-7 pr-3 py-1.5 text-[12px] bg-muted/30 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40 text-foreground placeholder:text-muted-foreground/50 w-36"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="detail-player-table">
            <thead>
              <tr className="border-b border-border/40 dark:border-white/[0.05] bg-muted/30 dark:bg-white/[0.02]">
                {([
                  { key: null,               label: "Player",          align: "left"   },
                  { key: "dynastyValue"  as DetailSortKey, label: "Dynasty Val", align: "center" },
                  { key: "winNowValue"   as DetailSortKey, label: "Win-Now Val", align: "center" },
                  { key: "age"           as DetailSortKey, label: "Age",         align: "center" },
                  { key: "userRosterPct"     as DetailSortKey, label: "Your Leagues %",    align: "center" },
                  { key: "sleeperRosterPct" as DetailSortKey, label: "Portfolio Own%", align: "center" },
                  { key: null,                                label: "Claim",               align: "center" },
                ] as { key: DetailSortKey | null; label: string; align: string }[]).map((col, i) => (
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
                      {col.key && <DetailSortIcon col={col.key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30 dark:divide-white/[0.04]">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">No players match your filters.</td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.sleeperId} className="hover:bg-muted/30 dark:hover:bg-white/[0.025] transition-colors" data-testid={`row-player-${p.sleeperId}`}>
                  <td className="px-4 py-3">
                    <PlayerAvatar
                      id={p.sleeperId}
                      name={p.name}
                      pos={p.pos}
                      team={p.team}
                      size="sm"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-[13px] font-bold text-foreground">{p.dynastyValue > 0 ? p.dynastyValue.toLocaleString() : "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-[13px] font-bold text-foreground">{p.winNowValue > 0 ? p.winNowValue.toLocaleString() : "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("text-[13px] font-bold", p.age > 0 && p.age <= 24 ? "text-emerald-500" : p.age <= 27 ? "text-amber-500" : "text-muted-foreground")}>
                      {p.age > 0 ? p.age : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-[13px] font-bold text-foreground">{p.userRosterPct}%</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.sleeperRosterPct >= 0 ? (
                      <span className={cn(
                        "text-[13px] font-bold",
                        p.sleeperRosterPct >= 67 ? "text-rose-400" :
                        p.sleeperRosterPct >= 33 ? "text-amber-400" :
                        "text-muted-foreground"
                      )}>
                        {p.sleeperRosterPct}%
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => onClaim(p.sleeperId)}
                      data-testid={`btn-claim-player-${p.sleeperId}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 bg-[#d4af37]/15 text-[#d4af37] hover:bg-[#d4af37]/25 border border-[#d4af37]/30 hover:border-[#d4af37]/50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Claim
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* League Tendency Analysis */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
          <h3 className="text-sm font-bold text-foreground">League Tendency Analysis</h3>
          {tendency.loading && <Skeleton className="h-3 w-20 rounded" />}
        </div>

        {/* Summary KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
          {tendency.loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="p-4 border-border/60 dark:border-[#1a2d4a]/80 animate-pulse">
                <Skeleton className="h-3 w-20 mb-2 rounded" />
                <Skeleton className="h-6 w-14 rounded" />
              </Card>
            ))
          ) : (
            <>
              <TendencyKpi
                label="Aggression Score"
                value={`${summaryMetrics.aggressionScore}/100`}
                accent={summaryMetrics.aggressionScore >= 70 ? "red" : summaryMetrics.aggressionScore >= 40 ? "amber" : "green"}
                tip="Composite league aggression based on bid %, claim volume, and active bidder count"
              />
              <TendencyKpi
                label="Avg Winning Bid"
                value={`${summaryMetrics.avgWinningBidPct}%`}
                accent="gold"
                tip="Average FAAB bid % on completed waiver claims this season"
              />
              <TendencyKpi
                label="Active Bidders"
                value={`${summaryMetrics.activeBidders}/${row.totalTeams}`}
                accent="blue"
                tip="Number of distinct managers who have submitted at least one waiver claim"
              />
              <TendencyKpi
                label="Claims / Week"
                value={summaryMetrics.claimsPerWeek.toString()}
                accent="purple"
                tip="Average number of completed waiver claims per active week"
              />
              <TendencyKpi
                label="Highest Bid"
                value={`${summaryMetrics.highestBidPct}%`}
                accent={summaryMetrics.highestBidPct >= 30 ? "red" : "amber"}
                tip="Highest single FAAB bid percentage recorded this season"
              />
            </>
          )}
        </div>

        {/* Manager Tendencies table */}
        <Card className="overflow-hidden border-border/60 dark:border-[#1a2d4a]/80">
          <div className="px-5 py-3.5 border-b border-border/40 dark:border-white/[0.06]">
            <h4 className="text-sm font-bold text-foreground">Manager Tendencies</h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">Based on completed waiver transactions this season</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="manager-tendency-table">
              <thead>
                <tr className="border-b border-border/40 dark:border-white/[0.05] bg-muted/30 dark:bg-white/[0.02]">
                  {["Manager", "Style", "Avg Bid", "Activity", "Claims", "Notes"].map((h) => (
                    <th key={h} className={cn("px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap", h === "Manager" || h === "Notes" ? "text-left" : "text-center")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30 dark:divide-white/[0.04]">
                {tendency.loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : managerTendencies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No waiver transaction history found for this league yet.
                    </td>
                  </tr>
                ) : (
                  managerTendencies.map((m) => {
                    const styleColors: Record<ManagerTendency["style"], string> = {
                      Aggressive:    "bg-rose-500/10 text-rose-500 border-rose-500/20",
                      Patient:       "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
                      "Hype Chaser": "bg-violet-500/10 text-violet-500 border-violet-500/20",
                      Balanced:      "bg-sky-500/10 text-sky-500 border-sky-500/20",
                    };
                    const activityColors: Record<ManagerTendency["activity"], string> = {
                      High:   "text-emerald-500",
                      Medium: "text-amber-500",
                      Low:    "text-muted-foreground",
                    };
                    return (
                      <tr key={m.rosterId} className="hover:bg-muted/30 dark:hover:bg-white/[0.025] transition-colors" data-testid={`row-manager-${m.rosterId}`}>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-[13px] text-foreground">{m.displayName}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", styleColors[m.style])}>
                            {m.style}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-[13px] font-bold text-foreground">{m.avgBid}%</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("text-[12px] font-semibold", activityColors[m.activity])}>{m.activity}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-[13px] font-bold text-foreground">{m.claimCount}</span>
                        </td>
                        <td className="px-4 py-3 text-left">
                          <span className="text-[11px] text-muted-foreground">{m.notes}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {claimModal}
    </div>
  );
}

function TendencyKpi({ label, value, accent, tip }: { label: string; value: string; accent: "gold" | "blue" | "green" | "amber" | "red" | "purple"; tip: string }) {
  const accentMap = {
    gold:   { val: "text-[#d4af37]",   bg: "bg-[#d4af37]/10",   ring: "ring-[#d4af37]/20"   },
    blue:   { val: "text-blue-400",    bg: "bg-blue-400/10",    ring: "ring-blue-400/20"    },
    green:  { val: "text-emerald-400", bg: "bg-emerald-400/10", ring: "ring-emerald-400/20" },
    amber:  { val: "text-amber-400",   bg: "bg-amber-400/10",   ring: "ring-amber-400/20"   },
    red:    { val: "text-rose-400",    bg: "bg-rose-400/10",    ring: "ring-rose-400/20"    },
    purple: { val: "text-violet-400",  bg: "bg-violet-400/10",  ring: "ring-violet-400/20"  },
  };
  const c = accentMap[accent];
  return (
    <Card className={cn("p-4 border-border/60 dark:border-[#1a2d4a]/80 ring-1", c.bg, c.ring)} title={tip} data-testid={`kpi-tendency-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 truncate">{label}</div>
      <div className={cn("text-xl font-black tracking-tight", c.val)}>{value}</div>
    </Card>
  );
}
