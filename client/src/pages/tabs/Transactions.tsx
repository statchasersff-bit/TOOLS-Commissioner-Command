import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";
import { fetchLeagueTransactions as fetchLeagueTransactionsApi } from "@/lib/sleeperApi";
import { getPositionColor } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ArrowRightLeft, UserPlus, UserMinus, Loader2, RefreshCw, ChevronDown } from "lucide-react";

interface TransactionPlayer {
  playerId: string;
  name: string;
  pos: string;
  team: string;
  rosterId: number;
  teamName: string;
}

interface TransactionPick {
  season: string;
  round: number;
  fromTeam: string;
  toTeam: string;
  originalRosterId?: number;
  pickSlot?: number;
}

interface Transaction {
  type: string;
  timestamp: number;
  week: number;
  adds: TransactionPlayer[];
  drops: TransactionPlayer[];
  draftPicks: TransactionPick[];
  involvedTeams: Array<{ rosterId: number; teamName: string; avatar?: string | null }>;
}

type FilterType = "all" | "trade" | "waiver" | "free_agent";

function PlayerHeadshot({ playerId, pos, team = "", size = "md" }: { playerId: string; pos: string; team?: string; size?: "sm" | "md" }) {
  return (
    <PlayerAvatar
      id={playerId}
      name=""
      pos={pos}
      team={team}
      size={size === "sm" ? "xs" : "sm"}
      compact
    />
  );
}

function TeamAvatar({ rosterId, teamName, avatar, size = "sm" }: { rosterId: number; teamName: string; avatar?: string | null; size?: "sm" | "md" }) {
  const [imgError, setImgError] = useState(false);
  const dim = size === "md" ? "w-7 h-7" : "w-5 h-5";
  const initial = (teamName || "?").charAt(0).toUpperCase();
  if (avatar && !imgError) {
    return (
      <img
        src={avatar}
        alt={teamName}
        className={cn(dim, "rounded-full object-cover flex-shrink-0 ring-1 ring-border/50")}
        onError={() => setImgError(true)}
        data-testid={`img-avatar-txn-${rosterId}`}
      />
    );
  }
  return (
    <div
      className={cn(dim, "rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0", size === "md" ? "text-[11px]" : "text-[9px]")}
      data-testid={`img-avatar-txn-${rosterId}`}
    >
      {initial}
    </div>
  );
}

export default function Transactions({ leagueId }: { leagueId: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [showCount, setShowCount] = useState(50);
  const { valuesBySleeperId, getPickValue } = useValueModel();

  const fetchTransactions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchLeagueTransactionsApi(leagueId);
      setTransactions(data.transactions || []);
    } catch (err: any) {
      setError(err.message || "Failed to load transactions");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [leagueId]);

  const filtered = useMemo(() => {
    if (filter === "all") return transactions;
    return transactions.filter((t) => t.type === filter);
  }, [transactions, filter]);

  const visible = filtered.slice(0, showCount);
  const hasMore = filtered.length > showCount;

  const counts = useMemo(() => ({
    all: transactions.length,
    trade: transactions.filter((t) => t.type === "trade").length,
    waiver: transactions.filter((t) => t.type === "waiver").length,
    free_agent: transactions.filter((t) => t.type === "free_agent").length,
  }), [transactions]);

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const getTypeIcon = (type: string, dropOnly = false) => {
    switch (type) {
      case "trade": return <ArrowRightLeft className="w-3 h-3" />;
      case "waiver": return <UserPlus className="w-3 h-3" />;
      case "free_agent": return dropOnly ? <UserMinus className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />;
      default: return <UserMinus className="w-3 h-3" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "trade": return "Trade";
      case "waiver": return "Waiver";
      case "free_agent": return "Free Agent";
      case "commissioner": return "Commissioner";
      default: return type;
    }
  };

  const getTypeBadgeStyle = (type: string, dropOnly = false) => {
    switch (type) {
      case "trade": return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
      case "waiver": return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
      case "free_agent": return dropOnly
        ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30"
        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const filters: Array<{ key: FilterType; label: string }> = [
    { key: "all", label: "All" },
    { key: "trade", label: "Trades" },
    { key: "waiver", label: "Waivers" },
    { key: "free_agent", label: "Free Agency" },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Transactions"
        subtitle="League trades, waivers, and free agent pickups"
      />

      {isLoading && (
        <Card className="p-12 text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" data-testid="transactions-loading" />
          <p className="text-sm text-muted-foreground">Loading transactions...</p>
        </Card>
      )}

      {error && (
        <Card className="p-6 border-red-500/30">
          <p className="text-sm text-red-500" data-testid="transactions-error">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={fetchTransactions} data-testid="button-retry-transactions">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
          </Button>
        </Card>
      )}

      {!isLoading && !error && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1.5">
              {filters.map((f) => (
                <button
                  key={f.key}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    filter === f.key
                      ? "bg-[#0b3a7a] text-white shadow-sm"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  onClick={() => { setFilter(f.key); setShowCount(50); }}
                  data-testid={`button-filter-${f.key}`}
                >
                  {f.label} <span className="ml-1 opacity-70">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={fetchTransactions} disabled={isLoading} data-testid="button-refresh-transactions">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>

          {visible.length === 0 && (
            <Card className="p-12 text-center">
              <ArrowRightLeft className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-transactions">No transactions found</p>
            </Card>
          )}

          <div className="space-y-2">
            {visible.map((txn, idx) => {
              const involved = txn.involvedTeams[0];
              const dropOnly = txn.type === "free_agent" && txn.adds.length === 0 && txn.drops.length > 0;
              return (
                <Card
                  key={`${txn.type}-${txn.timestamp}-${idx}`}
                  className="overflow-hidden hover:border-[#d4af37]/30 transition-colors"
                  data-testid={`transaction-${idx}`}
                >
                  {/* Card header */}
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/20">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className={cn("text-[10px] flex items-center gap-1 shrink-0 py-0.5", getTypeBadgeStyle(txn.type, dropOnly))}>
                        {getTypeIcon(txn.type, dropOnly)}
                        {getTypeLabel(txn.type)}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground shrink-0">Wk {txn.week}</span>
                      {txn.type !== "trade" && involved && (
                        <div className="flex items-center gap-1.5 min-w-0" data-testid="transaction-team-name">
                          <span className="text-border/60">·</span>
                          <TeamAvatar rosterId={involved.rosterId} teamName={involved.teamName} avatar={involved.avatar} size="sm" />
                          <span className="text-[11px] font-medium text-foreground truncate">{involved.teamName}</span>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{formatDate(txn.timestamp)}</span>
                  </div>

                  {/* Card body */}
                  <div className="px-4 py-3">
                    {txn.type === "trade" ? (
                      <TradeTransaction txn={txn} valuesBySleeperId={valuesBySleeperId} getPickValue={getPickValue} />
                    ) : (
                      <AddDropTransaction txn={txn} valuesBySleeperId={valuesBySleeperId} />
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => setShowCount((prev) => prev + 50)}
                data-testid="button-show-more-transactions"
              >
                <ChevronDown className="w-4 h-4 mr-1.5" />
                Show More ({Math.min(filtered.length - showCount, 50)} more)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  action,
  dynVal,
}: {
  player: TransactionPlayer;
  action: "add" | "drop" | "received";
  dynVal: number;
}) {
  const actionCls =
    action === "add"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
      : action === "drop"
      ? "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
      : "";

  return (
    <div className="flex items-center gap-2 py-1 min-w-0">
      <PlayerHeadshot playerId={player.playerId} pos={player.pos} team={player.team ?? ""} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className={cn("text-sm font-semibold truncate", action === "drop" && "text-muted-foreground")}>
            {player.name}
          </span>
          {player.team && (
            <span className="text-[10px] text-muted-foreground shrink-0">{player.team}</span>
          )}
        </div>
        {dynVal > 0 && (
          <p className="text-[10px] text-[#d4af37] font-semibold" data-testid={`text-dynasty-val-${player.playerId}`}>
            {dynVal.toLocaleString()} dynasty
          </p>
        )}
      </div>
      {action !== "received" && (
        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0", actionCls)}>
          {action === "add" ? "ADD" : "DROP"}
        </span>
      )}
    </div>
  );
}

function ordinalRound(round: number): string {
  if (round === 1) return "1st";
  if (round === 2) return "2nd";
  if (round === 3) return "3rd";
  return `${round}th`;
}

function formatPickLabel(dp: TransactionPick): string {
  return `${dp.season} ${ordinalRound(dp.round)}`;
}

function TradeTransaction({ txn, valuesBySleeperId, getPickValue }: { txn: Transaction; valuesBySleeperId: Record<string, number>; getPickValue: (pick: any) => number }) {
  const teamIds = [...new Set([...txn.adds.map(a => a.rosterId), ...txn.drops.map(d => d.rosterId)])];
  const sides = teamIds.map((rid) => {
    const team = txn.involvedTeams.find(t => t.rosterId === rid);
    const received = txn.adds.filter(a => a.rosterId === rid);
    const picksReceived = txn.draftPicks.filter(dp => {
      const toTeam = txn.involvedTeams.find(t => t.teamName === dp.toTeam);
      return toTeam?.rosterId === rid;
    });
    return { rosterId: rid, teamName: team?.teamName || `Team ${rid}`, avatar: team?.avatar, received, picksReceived };
  });

  return (
    <div className={cn("grid gap-3", sides.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1")}>
      {sides.map((side) => (
        <div key={side.rosterId} className="rounded-lg border border-border/40 bg-muted/10 overflow-hidden">
          {/* Team header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/20">
            <TeamAvatar rosterId={side.rosterId} teamName={side.teamName} avatar={side.avatar} size="md" />
            <p className="text-xs font-semibold truncate" data-testid={`trade-team-${side.rosterId}`}>
              {side.teamName}
            </p>
            <span className="ml-auto text-[10px] text-muted-foreground shrink-0">receives</span>
          </div>
          {/* Assets received */}
          <div className="px-3 py-2 space-y-0.5">
            {side.received.map((p, i) => (
              <PlayerRow
                key={i}
                player={p}
                action="received"
                dynVal={valuesBySleeperId[p.playerId] ?? 0}
              />
            ))}
            {side.picksReceived.map((dp, i) => {
              const pickVal = getPickValue({
                year: parseInt(dp.season, 10),
                round: dp.round,
                ownerTeamId: "",
                originalRosterId: dp.originalRosterId,
                pickSlot: dp.pickSlot,
                projectedRange: dp.pickSlot != null
                  ? (dp.pickSlot <= 4 ? "early" : dp.pickSlot <= 8 ? "mid" : "late")
                  : "mid",
              });
              const label = formatPickLabel(dp);
              return (
                <div key={`pk-${i}`} className="flex items-center gap-3 py-1">
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 ring-1 ring-border/50">
                    PK
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{label}</p>
                    {pickVal > 0 ? (
                      <p className="text-[10px] text-[#d4af37] font-semibold" data-testid={`text-pick-val-${dp.season}-${dp.round}-${i}`}>
                        {pickVal.toLocaleString()} dynasty
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">Draft pick</p>
                    )}
                  </div>
                </div>
              );
            })}
            {side.received.length === 0 && side.picksReceived.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic py-1">Picks only</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AddDropTransaction({ txn, valuesBySleeperId }: { txn: Transaction; valuesBySleeperId: Record<string, number> }) {
  return (
    <div className="space-y-1">
      {txn.adds.map((p, i) => (
        <PlayerRow
          key={`add-${i}`}
          player={p}
          action="add"
          dynVal={valuesBySleeperId[p.playerId] ?? 0}
        />
      ))}
      {txn.drops.map((p, i) => (
        <PlayerRow
          key={`drop-${i}`}
          player={p}
          action="drop"
          dynVal={0}
        />
      ))}
    </div>
  );
}
