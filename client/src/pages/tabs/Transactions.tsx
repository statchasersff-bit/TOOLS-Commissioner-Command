import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";
import { fetchLeagueTransactions as fetchLeagueTransactionsApi } from "@/lib/sleeperApi";
import { getPositionColor } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
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

function PlayerHeadshot({ playerId, pos }: { playerId: string; pos: string }) {
  const [imgError, setImgError] = useState(false);
  if (playerId && !imgError) {
    return (
      <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden bg-muted ring-1 ring-border/40">
        <img
          src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
          alt=""
          className="w-full h-full object-cover object-top"
          onError={() => setImgError(true)}
          data-testid={`img-player-txn-${playerId}`}
        />
      </div>
    );
  }
  return (
    <div
      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold bg-muted ring-1 ring-border/40 text-muted-foreground"
      data-testid={`img-player-txn-${playerId}`}
    >
      {(pos || "?").charAt(0)}
    </div>
  );
}

export default function Transactions({ leagueId }: { leagueId: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [showCount, setShowCount] = useState(50);
  const { valuesBySleeperId } = useValueModel();

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

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "trade": return <ArrowRightLeft className="w-3.5 h-3.5" />;
      case "waiver": return <UserPlus className="w-3.5 h-3.5" />;
      case "free_agent": return <UserPlus className="w-3.5 h-3.5" />;
      default: return <UserMinus className="w-3.5 h-3.5" />;
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

  const getTypeBadgeStyle = (type: string) => {
    switch (type) {
      case "trade": return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
      case "waiver": return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
      case "free_agent": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
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
            {visible.map((txn, idx) => (
              <Card
                key={`${txn.type}-${txn.timestamp}-${idx}`}
                className="p-4 hover:border-[#d4af37]/30 transition-colors"
                data-testid={`transaction-${idx}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <Badge variant="outline" className={cn("text-[10px] flex items-center gap-1 shrink-0", getTypeBadgeStyle(txn.type))}>
                      {getTypeIcon(txn.type)}
                      {getTypeLabel(txn.type)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] shrink-0">Wk {txn.week}</Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{formatDate(txn.timestamp)}</span>
                </div>

                {txn.type === "trade" ? (
                  <TradeTransaction txn={txn} valuesBySleeperId={valuesBySleeperId} />
                ) : (
                  <AddDropTransaction txn={txn} valuesBySleeperId={valuesBySleeperId} />
                )}
              </Card>
            ))}
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

function TeamAvatar({ rosterId, teamName, avatar }: { rosterId: number; teamName: string; avatar?: string | null }) {
  const [imgError, setImgError] = useState(false);
  const initial = (teamName || "?").charAt(0).toUpperCase();

  if (avatar && !imgError) {
    return (
      <img
        src={avatar}
        alt={teamName}
        className="w-6 h-6 rounded-full object-cover flex-shrink-0"
        onError={() => setImgError(true)}
        data-testid={`img-avatar-txn-${rosterId}`}
      />
    );
  }
  return (
    <div
      className="w-6 h-6 rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0"
      data-testid={`img-avatar-txn-${rosterId}`}
    >
      {initial}
    </div>
  );
}

function TradeTransaction({ txn, valuesBySleeperId }: { txn: Transaction; valuesBySleeperId: Record<string, number> }) {
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
        <div key={side.rosterId} className="p-3 rounded-lg border border-border/30 bg-muted/10">
          <div className="flex items-center gap-1.5 mb-2">
            <TeamAvatar rosterId={side.rosterId} teamName={side.teamName} avatar={side.avatar} />
            <p className="text-xs font-semibold" data-testid={`trade-team-${side.rosterId}`}>{side.teamName} receives:</p>
          </div>
          <div className="space-y-1.5">
            {side.received.map((p, i) => {
              const dynVal = valuesBySleeperId[p.playerId] ?? 0;
              return (
                <div key={i} className="flex items-center gap-2 min-w-0">
                  <PlayerHeadshot playerId={p.playerId} pos={p.pos} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge variant="outline" className={cn("text-[9px] w-6 justify-center shrink-0", getPositionColor(p.pos))}>{p.pos}</Badge>
                      <span className="text-xs font-medium truncate">{p.name}</span>
                      {p.team && <span className="text-[10px] text-muted-foreground shrink-0">{p.team}</span>}
                    </div>
                    {dynVal > 0 && (
                      <span className="text-[10px] font-semibold text-[#d4af37]" data-testid={`text-dynasty-val-${p.playerId}`}>
                        {dynVal.toLocaleString()} dynasty
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {side.picksReceived.map((dp, i) => (
              <div key={`pk-${i}`} className="flex items-center gap-2 py-0.5">
                <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 ring-1 ring-border/40">PK</div>
                <span className="text-xs font-medium">{dp.season} Round {dp.round}</span>
              </div>
            ))}
            {side.received.length === 0 && side.picksReceived.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">Picks only</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AddDropTransaction({ txn, valuesBySleeperId }: { txn: Transaction; valuesBySleeperId: Record<string, number> }) {
  const involved = txn.involvedTeams[0];
  const teamName = involved?.teamName || "Unknown";
  const rosterId = involved?.rosterId ?? 0;
  const avatar = involved?.avatar;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 mb-1" data-testid="transaction-team-name">
        <TeamAvatar rosterId={rosterId} teamName={teamName} avatar={avatar} />
        <p className="text-[11px] font-semibold text-muted-foreground">{teamName}</p>
      </div>
      {txn.adds.map((p, i) => {
        const dynVal = valuesBySleeperId[p.playerId] ?? 0;
        return (
          <div key={`add-${i}`} className="flex items-center gap-2 min-w-0">
            <PlayerHeadshot playerId={p.playerId} pos={p.pos} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-emerald-500 text-[10px] font-bold shrink-0">ADD</span>
                <Badge variant="outline" className={cn("text-[9px] w-6 justify-center shrink-0", getPositionColor(p.pos))}>{p.pos}</Badge>
                <span className="text-xs font-medium truncate">{p.name}</span>
                {p.team && <span className="text-[10px] text-muted-foreground shrink-0">{p.team}</span>}
              </div>
              {dynVal > 0 && (
                <span className="text-[10px] font-semibold text-[#d4af37]" data-testid={`text-dynasty-val-${p.playerId}`}>
                  {dynVal.toLocaleString()} dynasty
                </span>
              )}
            </div>
          </div>
        );
      })}
      {txn.drops.map((p, i) => (
        <div key={`drop-${i}`} className="flex items-center gap-2 min-w-0">
          <PlayerHeadshot playerId={p.playerId} pos={p.pos} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-red-500 text-[10px] font-bold shrink-0">DROP</span>
              <Badge variant="outline" className={cn("text-[9px] w-6 justify-center shrink-0", getPositionColor(p.pos))}>{p.pos}</Badge>
              <span className="text-xs font-medium text-muted-foreground truncate">{p.name}</span>
              {p.team && <span className="text-[10px] text-muted-foreground shrink-0">{p.team}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
