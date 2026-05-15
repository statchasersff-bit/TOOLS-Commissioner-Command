import { useState, useMemo, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";
import { fetchLeagueTransactions as fetchLeagueTransactionsApi, acceptTradeOnSleeper, rejectTradeOnSleeper } from "@/lib/sleeperApi";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import {
  ArrowRightLeft, UserPlus, UserMinus, Loader2, RefreshCw, ChevronDown,
  ShieldCheck, CheckCircle2, AlertTriangle, Key, XCircle, Undo2,
} from "lucide-react";

const SLEEPER_JWT_KEY = "dc-sleeper-draft-jwt";

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

interface PendingTrade {
  transactionId: string;
  leg: number;
  status: string;
  creator: string;
  consenterIds: number[];
  waiverBudget: Array<{ senderId: number; receiverId: number; amount: number }>;
  adds: TransactionPlayer[];
  drops: TransactionPlayer[];
  draftPicks: TransactionPick[];
  involvedTeams: Array<{ rosterId: number; teamName: string; avatar?: string | null }>;
  week: number;
  created: number;
}

type FilterType = "all" | "trade" | "waiver" | "free_agent";

function PlayerHeadshot({ playerId, pos, team = "", size = "md" }: { playerId: string; pos: string; team?: string; size?: "sm" | "md" }) {
  return (
    <PlayerAvatar id={playerId} name="" pos={pos} team={team} size={size === "sm" ? "xs" : "sm"} compact />
  );
}

function TeamAvatar({ rosterId, teamName, avatar, size = "sm" }: { rosterId: number; teamName: string; avatar?: string | null; size?: "sm" | "md" }) {
  const [imgError, setImgError] = useState(false);
  const dim = size === "md" ? "w-7 h-7" : "w-5 h-5";
  const initial = (teamName || "?").charAt(0).toUpperCase();
  if (avatar && !imgError) {
    return (
      <img src={avatar} alt={teamName}
        className={cn(dim, "rounded-full object-cover flex-shrink-0 ring-1 ring-border/50")}
        onError={() => setImgError(true)} data-testid={`img-avatar-txn-${rosterId}`} />
    );
  }
  return (
    <div className={cn(dim, "rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0", size === "md" ? "text-[11px]" : "text-[9px]")}
      data-testid={`img-avatar-txn-${rosterId}`}>
      {initial}
    </div>
  );
}

export default function Transactions({ leagueId }: { leagueId: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingTrades, setPendingTrades] = useState<PendingTrade[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [showCount, setShowCount] = useState(50);
  const { valuesBySleeperId, getPickValue } = useValueModel();
  const { user } = useSleeper();
  const myUserId = user?.userId ?? null;

  // JWT — shared with Live Draft tab
  const [sleeperJwt, setSleeperJwt] = useState<string | null>(() => localStorage.getItem(SLEEPER_JWT_KEY));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === SLEEPER_JWT_KEY) setSleeperJwt(e.newValue); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Accept state
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptResult, setAcceptResult] = useState<{ txnId: string; status: string } | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Reject / withdraw state
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectResult, setRejectResult] = useState<{ txnId: string; status: string } | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const clearPanels = () => {
    setConfirmingId(null);
    setRejectingId(null);
    setAcceptError(null);
    setRejectError(null);
  };

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchLeagueTransactionsApi(leagueId);
      setTransactions(data.transactions || []);
      setPendingTrades((data as any).pendingTrades || []);
    } catch (err: any) {
      setError(err.message || "Failed to load transactions");
    } finally {
      setIsLoading(false);
    }
  }, [leagueId]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  // Listen for trades proposed from Trade Calculator
  useEffect(() => {
    const onCreated = (e: Event) => {
      const trade = (e as CustomEvent).detail as PendingTrade;
      if (!trade?.transactionId) return;
      setPendingTrades(prev =>
        prev.some(t => t.transactionId === trade.transactionId) ? prev : [trade, ...prev]
      );
    };
    const onRefresh = () => { fetchTransactions(); };
    window.addEventListener("sleeper-txn-created", onCreated);
    window.addEventListener("sleeper-txn-refresh", onRefresh);
    return () => {
      window.removeEventListener("sleeper-txn-created", onCreated);
      window.removeEventListener("sleeper-txn-refresh", onRefresh);
    };
  }, [fetchTransactions]);

  const handleAccept = useCallback(async (trade: PendingTrade) => {
    if (!sleeperJwt) return;
    setAccepting(true);
    setAcceptError(null);
    setAcceptResult(null);
    try {
      const result = await acceptTradeOnSleeper(leagueId, trade.transactionId, trade.leg, sleeperJwt);
      setAcceptResult({ txnId: trade.transactionId, status: result?.status ?? "submitted" });
      setConfirmingId(null);
      await fetchTransactions();
    } catch (e: any) {
      setAcceptError(e.message || "Failed to accept trade");
    } finally {
      setAccepting(false);
    }
  }, [sleeperJwt, leagueId, fetchTransactions]);

  const handleReject = useCallback(async (trade: PendingTrade) => {
    if (!sleeperJwt) return;
    setRejecting(true);
    setRejectError(null);
    setRejectResult(null);
    try {
      const result = await rejectTradeOnSleeper(leagueId, trade.transactionId, trade.leg, sleeperJwt);
      setRejectResult({ txnId: trade.transactionId, status: result?.status ?? "rejected" });
      setRejectingId(null);
      await fetchTransactions();
    } catch (e: any) {
      setRejectError(e.message || "Failed to reject trade");
    } finally {
      setRejecting(false);
    }
  }, [sleeperJwt, leagueId, fetchTransactions]);

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

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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
      case "trade": return "Trade"; case "waiver": return "Waiver";
      case "free_agent": return "Free Agent"; case "commissioner": return "Commissioner";
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
    { key: "all", label: "All" }, { key: "trade", label: "Trades" },
    { key: "waiver", label: "Waivers" }, { key: "free_agent", label: "Free Agency" },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader title="Transactions" subtitle="League trades, waivers, and free agent pickups" />

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

      {/* ── Pending Trades ─────────────────────────────────────────────── */}
      {!isLoading && pendingTrades.length > 0 && (
        <div className="space-y-3" data-testid="section-pending-trades">
          <div className="flex items-center gap-2">
            <div className="w-[3px] h-5 rounded-full bg-amber-500" />
            <span className="text-sm font-bold text-foreground">Pending Trades</span>
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5">
              {pendingTrades.length} awaiting action
            </Badge>
          </div>

          {!sleeperJwt && (
            <Card className="p-4 border-amber-500/20 bg-amber-500/5">
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                <Key className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Set your Sleeper auth token in the <strong>Live Draft</strong> tab to accept or reject trades.</span>
              </div>
            </Card>
          )}

          {pendingTrades.map((trade) => (
            <PendingTradeCard
              key={trade.transactionId}
              trade={trade}
              leagueId={leagueId}
              myUserId={myUserId}
              sleeperJwt={sleeperJwt}
              isConfirming={confirmingId === trade.transactionId}
              isRejecting={rejectingId === trade.transactionId}
              accepting={accepting && confirmingId === trade.transactionId}
              rejecting={rejecting && rejectingId === trade.transactionId}
              acceptResult={acceptResult?.txnId === trade.transactionId ? acceptResult : null}
              rejectResult={rejectResult?.txnId === trade.transactionId ? rejectResult : null}
              acceptError={confirmingId === trade.transactionId ? acceptError : null}
              rejectError={rejectingId === trade.transactionId ? rejectError : null}
              valuesBySleeperId={valuesBySleeperId}
              getPickValue={getPickValue}
              onRequestConfirm={() => { clearPanels(); setConfirmingId(trade.transactionId); }}
              onCancelConfirm={() => setConfirmingId(null)}
              onAccept={() => handleAccept(trade)}
              onRequestReject={() => { clearPanels(); setRejectingId(trade.transactionId); }}
              onCancelReject={() => setRejectingId(null)}
              onReject={() => handleReject(trade)}
            />
          ))}
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1.5">
              {filters.map((f) => (
                <button key={f.key}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    filter === f.key ? "bg-[#0b3a7a] text-white shadow-sm" : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  onClick={() => { setFilter(f.key); setShowCount(50); }}
                  data-testid={`button-filter-${f.key}`}>
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
                <Card key={`${txn.type}-${txn.timestamp}-${idx}`}
                  className="overflow-hidden hover:border-[#d4af37]/30 transition-colors"
                  data-testid={`transaction-${idx}`}>
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/20">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className={cn("text-[10px] flex items-center gap-1 shrink-0 py-0.5", getTypeBadgeStyle(txn.type, dropOnly))}>
                        {getTypeIcon(txn.type, dropOnly)} {getTypeLabel(txn.type)}
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
                  <div className="px-4 py-3">
                    {txn.type === "trade"
                      ? <TradeTransaction txn={txn} valuesBySleeperId={valuesBySleeperId} getPickValue={getPickValue} />
                      : <AddDropTransaction txn={txn} valuesBySleeperId={valuesBySleeperId} />
                    }
                  </div>
                </Card>
              );
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setShowCount((prev) => prev + 50)} data-testid="button-show-more-transactions">
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

// ─── PendingTradeCard ───────────────────────────────────────────────────────

interface PendingTradeCardProps {
  trade: PendingTrade;
  leagueId: string;
  myUserId: string | null;
  sleeperJwt: string | null;
  isConfirming: boolean;
  isRejecting: boolean;
  accepting: boolean;
  rejecting: boolean;
  acceptResult: { txnId: string; status: string } | null;
  rejectResult: { txnId: string; status: string } | null;
  acceptError: string | null;
  rejectError: string | null;
  valuesBySleeperId: Record<string, number>;
  getPickValue: (pick: any) => number;
  onRequestConfirm: () => void;
  onCancelConfirm: () => void;
  onAccept: () => void;
  onRequestReject: () => void;
  onCancelReject: () => void;
  onReject: () => void;
}

function PendingTradeCard({
  trade, myUserId, sleeperJwt,
  isConfirming, isRejecting, accepting, rejecting,
  acceptResult, rejectResult, acceptError, rejectError,
  valuesBySleeperId, getPickValue,
  onRequestConfirm, onCancelConfirm, onAccept,
  onRequestReject, onCancelReject, onReject,
}: PendingTradeCardProps) {
  const isMyOffer = !!myUserId && trade.creator === myUserId;
  const rejectLabel = isMyOffer ? "Withdraw Offer" : "Reject Trade";
  const rejectIcon = isMyOffer ? <Undo2 className="w-3.5 h-3.5 mr-1.5" /> : <XCircle className="w-3.5 h-3.5 mr-1.5" />;

  const teamIds = [...new Set([...trade.adds.map(a => a.rosterId), ...trade.drops.map(d => d.rosterId)])];
  const sides = teamIds.map((rid) => {
    const team = trade.involvedTeams.find(t => t.rosterId === rid);
    const received = trade.adds.filter(a => a.rosterId === rid);
    const picksReceived = trade.draftPicks.filter(dp => {
      const toTeam = trade.involvedTeams.find(t => t.teamName === dp.toTeam);
      return toTeam?.rosterId === rid;
    });
    return { rosterId: rid, teamName: team?.teamName || `Team ${rid}`, avatar: team?.avatar, received, picksReceived };
  });

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const rejectResultLabel = (status: string) => {
    if (status === "cancelled") return isMyOffer ? "Offer withdrawn successfully." : "Trade cancelled.";
    if (status === "rejected") return "Trade rejected.";
    return `Status: ${status}`;
  };

  const anyLoading = accepting || rejecting;
  const anyPanel = isConfirming || isRejecting;

  return (
    <Card className="overflow-hidden border-amber-500/30 hover:border-amber-500/50 transition-colors" data-testid={`pending-trade-${trade.transactionId}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 flex items-center gap-1 py-0.5">
            <ArrowRightLeft className="w-3 h-3" /> Pending Trade
          </Badge>
          <span className="text-[10px] text-muted-foreground">Wk {trade.week}</span>
          <span className="text-[10px] text-muted-foreground">· leg {trade.leg}</span>
          {isMyOffer && (
            <Badge variant="outline" className="text-[9px] border-blue-500/30 text-blue-500 dark:text-blue-400 bg-blue-500/5">
              Your offer
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{formatDate(trade.created)}</span>
      </div>

      {/* Trade assets */}
      <div className="px-4 pt-3 pb-2">
        <div className={cn("grid gap-3", sides.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1")}>
          {sides.map((side) => (
            <div key={side.rosterId} className="rounded-lg border border-border/40 bg-muted/10 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/20">
                <TeamAvatar rosterId={side.rosterId} teamName={side.teamName} avatar={side.avatar} size="md" />
                <p className="text-xs font-semibold truncate" data-testid={`pending-trade-team-${side.rosterId}`}>{side.teamName}</p>
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">receives</span>
              </div>
              <div className={cn("px-3 py-2", side.received.length + side.picksReceived.length > 3 ? "grid grid-cols-2 gap-x-2 gap-y-0.5" : "space-y-0.5")}>
                {side.received.map((p, i) => (
                  <PlayerRow key={i} player={p} action="received" dynVal={valuesBySleeperId[p.playerId] ?? 0} />
                ))}
                {side.picksReceived.map((dp, i) => {
                  const pickVal = getPickValue({ year: parseInt(dp.season, 10), round: dp.round, ownerTeamId: "", originalRosterId: dp.originalRosterId, pickSlot: dp.pickSlot, projectedRange: dp.pickSlot != null ? (dp.pickSlot <= 4 ? "early" : dp.pickSlot <= 8 ? "mid" : "late") : "mid" });
                  return (
                    <div key={`pk-${i}`} className="flex items-center gap-3 py-1">
                      <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 ring-1 ring-border/50">PK</div>
                      <div>
                        <p className="text-sm font-semibold">{dp.season} {ordinalRound(dp.round)}</p>
                        {pickVal > 0 ? <p className="text-[10px] text-[#d4af37] font-semibold">{pickVal.toLocaleString()} dynasty</p> : <p className="text-[10px] text-muted-foreground">Draft pick</p>}
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

        {/* FAAB budget */}
        {trade.waiverBudget.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`pending-faab-${trade.transactionId}`}>
            {trade.waiverBudget.map((wb, i) => {
              const senderTeam = trade.involvedTeams.find(t => t.rosterId === wb.senderId)?.teamName || `Team ${wb.senderId}`;
              const receiverTeam = trade.involvedTeams.find(t => t.rosterId === wb.receiverId)?.teamName || `Team ${wb.receiverId}`;
              return (
                <span key={i} className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                  FAAB: {senderTeam} sends <strong>${wb.amount}</strong> → {receiverTeam}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="px-4 pb-3 space-y-2">

        {/* Accept result */}
        {acceptResult && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 text-xs text-emerald-700 dark:text-emerald-400" data-testid={`accept-result-${trade.transactionId}`}>
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Trade accepted — status: <strong>{acceptResult.status}</strong>. May remain pending until commissioner review is complete.</span>
          </div>
        )}

        {/* Reject result */}
        {rejectResult && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border/40 px-3 py-2.5 text-xs text-muted-foreground" data-testid={`reject-result-${trade.transactionId}`}>
            <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{rejectResultLabel(rejectResult.status)}</span>
          </div>
        )}

        {/* Accept confirmation panel */}
        {isConfirming && !acceptResult && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5" data-testid={`confirm-panel-${trade.transactionId}`}>
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Confirm Trade Acceptance</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  You are accepting this trade on behalf of your team. The trade may remain <strong>pending</strong> until commissioner review or league rules are satisfied.
                </p>
              </div>
            </div>
            <TradeSummaryBox sides={sides} waiverBudget={trade.waiverBudget} involvedTeams={trade.involvedTeams} />
            {acceptError && (
              <div className="flex items-center gap-1.5 text-xs text-red-500" data-testid={`accept-error-${trade.transactionId}`}>
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /><span>{acceptError}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-8 bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs px-4"
                onClick={onAccept} disabled={anyLoading} data-testid={`button-confirm-accept-${trade.transactionId}`}>
                {accepting ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Accepting…</> : <><CheckCircle2 className="w-3 h-3 mr-1.5" />Confirm Accept</>}
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onCancelConfirm} disabled={anyLoading} data-testid={`button-cancel-confirm-${trade.transactionId}`}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Reject / Withdraw confirmation panel */}
        {isRejecting && !rejectResult && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2.5" data-testid={`reject-panel-${trade.transactionId}`}>
            <div className="flex items-start gap-2">
              {isMyOffer ? <Undo2 className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />}
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {isMyOffer ? "Confirm Withdraw Offer" : "Confirm Reject Trade"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {isMyOffer
                    ? "This will cancel your trade offer and return all assets to their original owners."
                    : "This will reject the trade offer. The other party will be notified."
                  }
                </p>
              </div>
            </div>
            <TradeSummaryBox sides={sides} waiverBudget={trade.waiverBudget} involvedTeams={trade.involvedTeams} />
            {rejectError && (
              <div className="flex items-center gap-1.5 text-xs text-red-500" data-testid={`reject-error-${trade.transactionId}`}>
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /><span>{rejectError}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="destructive" className="h-8 text-xs px-4"
                onClick={onReject} disabled={anyLoading} data-testid={`button-confirm-reject-${trade.transactionId}`}>
                {rejecting ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />{isMyOffer ? "Withdrawing…" : "Rejecting…"}</> : <>{rejectIcon}{isMyOffer ? "Confirm Withdraw" : "Confirm Reject"}</>}
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onCancelReject} disabled={anyLoading} data-testid={`button-cancel-reject-${trade.transactionId}`}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Primary action buttons — hidden while a panel is open or results shown */}
        {!anyPanel && !acceptResult && !rejectResult && (
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {/* Accept — only if not your own offer */}
            {!isMyOffer && (
              <Button size="sm" variant="outline"
                className="h-8 text-xs border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                onClick={onRequestConfirm} disabled={!sleeperJwt}
                data-testid={`button-accept-trade-${trade.transactionId}`}>
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Accept Trade
              </Button>
            )}
            {/* Reject / Withdraw */}
            <Button size="sm" variant="outline"
              className="h-8 text-xs border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10"
              onClick={onRequestReject} disabled={!sleeperJwt}
              data-testid={`button-reject-trade-${trade.transactionId}`}>
              {rejectIcon}{rejectLabel}
            </Button>
            {!sleeperJwt && (
              <span className="text-[10px] text-muted-foreground">Token required — set in Live Draft tab</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Trade Summary Box (shared between confirm panels) ──────────────────────

function TradeSummaryBox({ sides, waiverBudget, involvedTeams }: {
  sides: Array<{ rosterId: number; teamName: string; received: TransactionPlayer[]; picksReceived: TransactionPick[] }>;
  waiverBudget: PendingTrade["waiverBudget"];
  involvedTeams: PendingTrade["involvedTeams"];
}) {
  return (
    <div className="rounded bg-muted/30 border border-border/30 px-3 py-2 space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Trade Summary</p>
      {sides.map(side => (
        <div key={side.rosterId} className="text-[11px]">
          <span className="font-semibold">{side.teamName}</span>
          <span className="text-muted-foreground"> receives: </span>
          <span>
            {[
              ...side.received.map(p => p.name),
              ...side.picksReceived.map(dp => `${dp.season} ${ordinalRound(dp.round)}`),
            ].join(", ") || "—"}
          </span>
        </div>
      ))}
      {waiverBudget.map((wb, i) => {
        const sender = involvedTeams.find(t => t.rosterId === wb.senderId)?.teamName || `Team ${wb.senderId}`;
        const receiver = involvedTeams.find(t => t.rosterId === wb.receiverId)?.teamName || `Team ${wb.receiverId}`;
        return <div key={i} className="text-[11px] text-emerald-700 dark:text-emerald-400">FAAB: {sender} sends ${wb.amount} to {receiver}</div>;
      })}
    </div>
  );
}

// ─── Shared sub-components ──────────────────────────────────────────────────

function PlayerRow({ player, action, dynVal }: { player: TransactionPlayer; action: "add" | "drop" | "received"; dynVal: number }) {
  const actionCls =
    action === "add" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30" :
    action === "drop" ? "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30" : "";

  return (
    <div className="flex items-center gap-2 py-1 min-w-0">
      <PlayerAvatar id={player.playerId} name="" pos={player.pos} team={player.team ?? ""} size="sm" compact />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn("text-sm font-semibold truncate", action === "drop" && "text-muted-foreground")}>{player.name}</span>
          {player.pos && (
            <span className={cn("text-[10px] font-bold shrink-0",
              player.pos === "QB" ? "text-rose-400" : player.pos === "RB" ? "text-emerald-400" :
              player.pos === "WR" ? "text-sky-400" : player.pos === "TE" ? "text-yellow-400" : "text-muted-foreground"
            )}>{player.pos}</span>
          )}
          {player.team && <span className="text-[10px] text-muted-foreground shrink-0">{player.team}</span>}
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
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/20">
            <TeamAvatar rosterId={side.rosterId} teamName={side.teamName} avatar={side.avatar} size="md" />
            <p className="text-xs font-semibold truncate" data-testid={`trade-team-${side.rosterId}`}>{side.teamName}</p>
            <span className="ml-auto text-[10px] text-muted-foreground shrink-0">receives</span>
          </div>
          <div className={cn("px-3 py-2", side.received.length + side.picksReceived.length > 3 ? "grid grid-cols-2 gap-x-2 gap-y-0.5" : "space-y-0.5")}>
            {side.received.map((p, i) => (
              <PlayerRow key={i} player={p} action="received" dynVal={valuesBySleeperId[p.playerId] ?? 0} />
            ))}
            {side.picksReceived.map((dp, i) => {
              const pickVal = getPickValue({ year: parseInt(dp.season, 10), round: dp.round, ownerTeamId: "", originalRosterId: dp.originalRosterId, pickSlot: dp.pickSlot, projectedRange: dp.pickSlot != null ? (dp.pickSlot <= 4 ? "early" : dp.pickSlot <= 8 ? "mid" : "late") : "mid" });
              return (
                <div key={`pk-${i}`} className="flex items-center gap-3 py-1">
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 ring-1 ring-border/50">PK</div>
                  <div>
                    <p className="text-sm font-semibold">{dp.season} {ordinalRound(dp.round)}</p>
                    {pickVal > 0 ? (
                      <p className="text-[10px] text-[#d4af37] font-semibold" data-testid={`text-pick-val-${dp.season}-${dp.round}-${i}`}>{pickVal.toLocaleString()} dynasty</p>
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
      {txn.adds.map((p, i) => <PlayerRow key={`add-${i}`} player={p} action="add" dynVal={valuesBySleeperId[p.playerId] ?? 0} />)}
      {txn.drops.map((p, i) => <PlayerRow key={`drop-${i}`} player={p} action="drop" dynVal={0} />)}
    </div>
  );
}
