import { useState, useEffect, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getSleeperSession } from "@/services/sleeperAuth";
import {
  fetchLeagueTransactionsFiltered, acceptTrade, rejectTrade,
  proposeTrade, getDmByMembers, sendTradeMessage,
} from "@/services/sleeperAuthedApi";
import type { SleeperTransaction } from "@/services/sleeperAuthedApi";
import { getPositionColor } from "@/data/mockData";
import type { League, Team } from "@/types";
import {
  ArrowRightLeft, TrendingUp, TrendingDown, RefreshCw, Loader2,
  Clock, AlertTriangle, ExternalLink, CheckCircle2, XCircle, Eye,
  ArrowRight, ArrowLeft, MessageCircle, CornerUpRight, Lock, Zap,
  GitBranch, Send, Paperclip,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PICK_VALUES: Record<string, Record<number, number>> = {
  "2026": { 1: 900, 2: 500, 3: 260, 4: 110 },
  "2027": { 1: 700, 2: 420, 3: 210, 4: 85  },
  "2028": { 1: 580, 2: 360, 3: 180, 4: 72  },
  "2029": { 1: 500, 2: 320, 3: 160, 4: 60  },
};

function pickVal(season: string, round: number): number {
  return (PICK_VALUES[season] ?? PICK_VALUES["2029"])[round] ?? 60;
}

function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

function expiryLabel(ms: number | null): string {
  if (!ms) return "—";
  const diff = ms - Date.now();
  if (diff <= 0) return "Expired";
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1h";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function expiringSoon(ms: number | null): boolean {
  return !!ms && ms - Date.now() < 86400000 && ms > Date.now();
}

function parseRosterId(teamId: string): number {
  return parseInt(teamId.replace("roster_", ""), 10);
}

function buildTransactionsByRoster(raw: SleeperTransaction): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rosterId of raw.roster_ids ?? []) {
    const adds  = Object.entries(raw.adds  ?? {}).filter(([, rid]) => rid === rosterId).map(([pid]) => pid);
    const drops = Object.entries(raw.drops ?? {}).filter(([, rid]) => rid === rosterId).map(([pid]) => pid);
    const picks = (raw.draft_picks ?? []).filter(
      dp => dp.owner_id === rosterId || dp.previous_owner_id === rosterId
    );
    result[String(rosterId)] = { adds, drops, draft_picks: picks };
  }
  return result;
}

function buildUsersInLeagueMap(teams: Team[]): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const t of teams) {
    if (t.ownerId) r[t.ownerId] = { display_name: t.owner, avatar: t.avatar ?? null };
  }
  return r;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface NegPlayer { id: string; name: string; pos: string; team: string; value: number }
interface NegPick   { season: string; round: number; label: string; value: number }

interface NegTrade {
  transactionId: string;
  leagueId: string;
  leg: number;
  status: "proposed" | "complete" | "rejected" | "failed";
  isCounter: boolean;
  direction: "incoming" | "outgoing";
  userRosterId: number;
  partnerRosterId: number;
  partnerName: string;
  partnerAvatar: string | null;
  partnerOwnerId: string | null;
  userGives: { players: NegPlayer[]; picks: NegPick[] };
  userGets:  { players: NegPlayer[]; picks: NegPick[] };
  userGivesValue: number;
  userGetsValue: number;
  valueEdge: number;
  expiresAt: number | null;
  created: number;
  statusUpdated: number;
  rawTransaction: SleeperTransaction;
}

type Section = "active" | "counters" | "history";
type RosterInfo = { name: string; avatar: string | null; ownerId: string | null };

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeNegTrade(
  t: SleeperTransaction,
  leagueId: string,
  userRosterId: number,
  rosterMap: Map<number, RosterInfo>,
  vals: Record<string, number>
): NegTrade | null {
  if (!t.roster_ids?.includes(userRosterId)) return null;

  const partnerRosterId = (t.roster_ids ?? []).find(id => id !== userRosterId) ?? -1;
  const partnerInfo     = rosterMap.get(partnerRosterId);
  const isIncoming      = !(t.consenter_ids ?? []).includes(userRosterId);

  const resolvePlayer = (pid: string): { name: string; pos: string; team: string } => {
    const info = t.player_map?.[pid] as any;
    if (!info) return { name: pid, pos: "?", team: "FA" };
    return {
      name: info.full_name || `${info.first_name ?? ""} ${info.last_name ?? ""}`.trim() || pid,
      pos:  info.position || "?",
      team: info.team     || "FA",
    };
  };

  const givePlayers: NegPlayer[] = [];
  const getPlayers:  NegPlayer[] = [];

  for (const [pid, rosterId] of Object.entries(t.drops ?? {})) {
    if (rosterId === userRosterId) {
      const { name, pos, team } = resolvePlayer(pid);
      givePlayers.push({ id: pid, name, pos, team, value: vals[pid] ?? 0 });
    }
  }
  for (const [pid, rosterId] of Object.entries(t.adds ?? {})) {
    if (rosterId === userRosterId) {
      const { name, pos, team } = resolvePlayer(pid);
      getPlayers.push({ id: pid, name, pos, team, value: vals[pid] ?? 0 });
    }
  }

  const givePicks: NegPick[] = [];
  const getPicks:  NegPick[] = [];
  for (const dp of t.draft_picks ?? []) {
    const label = `${dp.season} ${ordinal(dp.round)}`;
    const value  = pickVal(dp.season, dp.round);
    if      (dp.previous_owner_id === userRosterId) givePicks.push({ season: dp.season, round: dp.round, label, value });
    else if (dp.owner_id          === userRosterId) getPicks.push({ season: dp.season, round: dp.round, label, value });
  }

  const userGivesValue = givePlayers.reduce((s, p) => s + p.value, 0) + givePicks.reduce((s, p) => s + p.value, 0);
  const userGetsValue  = getPlayers.reduce((s, p)  => s + p.value, 0) + getPicks.reduce((s, p)  => s + p.value, 0);

  const rawExp    = t.settings?.expires_at;
  const expiresAt = rawExp ? (rawExp > 1e12 ? rawExp : rawExp * 1000) : null;
  const isCounter = !!(t.settings as any)?.is_counter;

  return {
    transactionId: t.transaction_id,
    leagueId,
    leg: t.leg ?? 1,
    status: (t.status || "proposed") as NegTrade["status"],
    isCounter,
    direction: isIncoming ? "incoming" : "outgoing",
    userRosterId,
    partnerRosterId,
    partnerName:    partnerInfo?.name    ?? `Team ${partnerRosterId}`,
    partnerAvatar:  partnerInfo?.avatar  ?? null,
    partnerOwnerId: partnerInfo?.ownerId ?? null,
    userGives: { players: givePlayers, picks: givePicks },
    userGets:  { players: getPlayers,  picks: getPicks  },
    userGivesValue,
    userGetsValue,
    valueEdge: userGetsValue - userGivesValue,
    expiresAt,
    created: t.created,
    statusUpdated: t.status_updated ?? t.updated ?? t.created,
    rawTransaction: t,
  };
}

// ─── Small UI ─────────────────────────────────────────────────────────────────

function ManagerAvatar({ name, avatar, size = "sm" }: { name: string; avatar?: string | null; size?: "sm" | "md" }) {
  const [err, setErr] = useState(false);
  const dim = size === "md" ? "w-8 h-8 text-[11px]" : "w-5 h-5 text-[9px]";
  if (avatar && !err)
    return <img src={avatar} alt={name} className={cn(dim, "rounded-full object-cover flex-shrink-0 ring-1 ring-border/40")} onError={() => setErr(true)} />;
  return (
    <div className={cn(dim, "rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0")}>
      {(name || "?").charAt(0).toUpperCase()}
    </div>
  );
}

function AssetChip({ player }: { player: NegPlayer }) {
  const c = getPositionColor(player.pos);
  return (
    <div className="flex items-center gap-1.5 bg-muted/40 rounded-md px-2 py-1 min-w-0">
      <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0", c)}>{player.pos}</span>
      <span className="text-[11px] font-medium text-foreground truncate">{player.name}</span>
      {player.value > 0 && <span className="text-[10px] text-muted-foreground ml-auto pl-1 flex-shrink-0">{player.value.toLocaleString()}</span>}
    </div>
  );
}

function PickChip({ pick }: { pick: NegPick }) {
  return (
    <div className="flex items-center gap-1.5 bg-amber-500/10 rounded-md px-2 py-1">
      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">PICK</span>
      <span className="text-[11px] font-medium text-foreground">{pick.label}</span>
      {pick.value > 0 && <span className="text-[10px] text-muted-foreground ml-auto">~{pick.value.toLocaleString()}</span>}
    </div>
  );
}

function StatusBadge({ status, isCounter }: { status: NegTrade["status"]; isCounter?: boolean }) {
  if (isCounter)
    return <Badge variant="outline" className="text-[10px] font-semibold bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30">Counter</Badge>;
  const s = {
    proposed: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    complete:  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    rejected:  "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    failed:    "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  }[status];
  const l = { proposed: "Proposed", complete: "Accepted", rejected: "Rejected", failed: "Failed" }[status];
  return <Badge variant="outline" className={cn("text-[10px] font-semibold", s)}>{l}</Badge>;
}

function DirectionBadge({ d }: { d: "incoming" | "outgoing" }) {
  return d === "incoming"
    ? <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400"><ArrowLeft className="w-3 h-3"/>Incoming</div>
    : <div className="flex items-center gap-1 text-[10px] font-bold text-blue-700 dark:text-blue-400"><ArrowRight className="w-3 h-3"/>Outgoing</div>;
}

function ValueEdge({ edge }: { edge: number }) {
  if (Math.abs(edge) < 10) return <span className="text-xs text-muted-foreground">~Even</span>;
  const good = edge > 0;
  return (
    <div className={cn("flex items-center gap-0.5 text-xs font-bold", good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {good ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>}
      {good ? "+" : ""}{Math.round(edge).toLocaleString()}
    </div>
  );
}

// ─── Trade Neg Card ───────────────────────────────────────────────────────────

function TradeNegCard({
  trade, actionLoading, dmLoading,
  onView, onCounter, onAccept, onReject, onMessage,
}: {
  trade: NegTrade;
  actionLoading: boolean;
  dmLoading: boolean;
  onView: () => void;
  onCounter: () => void;
  onAccept: () => void;
  onReject: () => void;
  onMessage: () => void;
}) {
  const expiring  = expiringSoon(trade.expiresAt);
  const isPending = trade.status === "proposed";

  return (
    <Card className={cn(
      "p-4 space-y-3 hover:border-[#0b3a7a]/30 hover:shadow-md hover:shadow-[#0b3a7a]/5 transition-all",
      expiring && isPending && "border-amber-500/40 bg-amber-500/5"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ManagerAvatar name={trade.partnerName} avatar={trade.partnerAvatar} size="md" />
          <div>
            <p className="text-xs font-semibold text-foreground">{trade.partnerName}</p>
            <p className="text-[10px] text-muted-foreground">Trade Partner</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge status={trade.status} isCounter={trade.isCounter} />
          {isPending && <DirectionBadge d={trade.direction} />}
          {expiring && isPending && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3"/>Expiring
            </div>
          )}
        </div>
      </div>

      {/* Assets grid */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
            <ArrowRight className="w-3 h-3 text-red-500"/>You Give
            <span className="ml-auto text-[10px] tabular-nums text-foreground/60">{trade.userGivesValue.toLocaleString()}</span>
          </p>
          <div className="space-y-0.5">
            {trade.userGives.players.slice(0, 2).map(p => <AssetChip key={p.id} player={p}/>)}
            {trade.userGives.picks.slice(0, 1).map(p => <PickChip key={p.label} pick={p}/>)}
            {trade.userGives.players.length + trade.userGives.picks.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{trade.userGives.players.length + trade.userGives.picks.length - 3} more</span>
            )}
            {trade.userGives.players.length === 0 && trade.userGives.picks.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic">Nothing</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
            <ArrowLeft className="w-3 h-3 text-emerald-500"/>You Get
            <span className="ml-auto text-[10px] tabular-nums text-foreground/60">{trade.userGetsValue.toLocaleString()}</span>
          </p>
          <div className="space-y-0.5">
            {trade.userGets.players.slice(0, 2).map(p => <AssetChip key={p.id} player={p}/>)}
            {trade.userGets.picks.slice(0, 1).map(p => <PickChip key={p.label} pick={p}/>)}
            {trade.userGets.players.length + trade.userGets.picks.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{trade.userGets.players.length + trade.userGets.picks.length - 3} more</span>
            )}
            {trade.userGets.players.length === 0 && trade.userGets.picks.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic">Nothing</span>
            )}
          </div>
        </div>
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40 flex-wrap">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <ValueEdge edge={trade.valueEdge}/>
          {trade.expiresAt && (
            <div className={cn("flex items-center gap-1", expiring && "text-amber-600 dark:text-amber-400")}>
              <Clock className="w-3 h-3"/>{expiryLabel(trade.expiresAt)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
          {actionLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground"/>
          ) : (
            <>
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 hover:border-[#0b3a7a]/40" onClick={onView} data-testid={`btn-view-neg-${trade.transactionId}`}>
                <Eye className="w-3 h-3"/>View
              </Button>
              {trade.partnerOwnerId && (
                <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 hover:border-blue-400/40 hover:text-blue-500" onClick={onMessage} disabled={dmLoading} data-testid={`btn-message-${trade.transactionId}`}>
                  {dmLoading ? <Loader2 className="w-3 h-3 animate-spin"/> : <MessageCircle className="w-3 h-3"/>}
                  {dmLoading ? "" : "Message"}
                </Button>
              )}
              {isPending && (
                <>
                  {trade.direction === "incoming" && (
                    <Button size="sm" className="h-7 px-2 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onAccept} data-testid={`btn-accept-neg-${trade.transactionId}`}>
                      <CheckCircle2 className="w-3 h-3"/>Accept
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 hover:border-purple-400/50 hover:text-purple-500" onClick={onCounter} data-testid={`btn-counter-${trade.transactionId}`}>
                    <CornerUpRight className="w-3 h-3"/>Counter
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 hover:border-red-400/50 hover:text-red-500" onClick={onReject} data-testid={`btn-reject-neg-${trade.transactionId}`}>
                    <XCircle className="w-3 h-3"/>Reject
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Details Sheet ────────────────────────────────────────────────────────────

function DetailsSheet({ trade, open, onClose, onAccept, onCounter, onReject, onMessage, actionLoading, leagueName }: {
  trade: NegTrade | null; open: boolean; onClose: () => void;
  onAccept: () => void; onCounter: () => void; onReject: () => void; onMessage: () => void;
  actionLoading: boolean; leagueName: string;
}) {
  if (!trade) return null;
  const expiring = expiringSoon(trade.expiresAt);
  const totalGive = trade.userGivesValue;
  const totalGet  = trade.userGetsValue;
  const combined  = (totalGive + totalGet) || 1;
  const giveW     = Math.round((totalGive / combined) * 100);
  const isPending = trade.status === "proposed";

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto bg-background border-l border-border/60">
        <SheetHeader className="pb-4 border-b border-border/40">
          <SheetTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <ArrowRightLeft className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400"/>
              <span className="text-base font-bold">Trade Details</span>
              <StatusBadge status={trade.status} isCounter={trade.isCounter}/>
              {isPending && <DirectionBadge d={trade.direction}/>}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-normal">{leagueName}</p>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 pt-5">
          {/* Expiry */}
          {trade.expiresAt && isPending && (
            <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium",
              expiring
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                : "bg-muted/50 text-muted-foreground border border-border/40"
            )}>
              <Clock className="w-4 h-4 flex-shrink-0"/>
              {expiring ? "⚠ Expiring " : "Expires in "}<strong>{expiryLabel(trade.expiresAt)}</strong>
            </div>
          )}

          {trade.isCounter && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-400">
              <GitBranch className="w-4 h-4 flex-shrink-0"/>
              This is a counter-offer
            </div>
          )}

          {/* Partner */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border/40">
            <ManagerAvatar name={trade.partnerName} avatar={trade.partnerAvatar} size="md"/>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Trade Partner</p>
              <p className="text-sm font-bold">{trade.partnerName}</p>
            </div>
            <a href={`https://sleeper.com/leagues/${trade.leagueId}`} target="_blank" rel="noopener noreferrer"
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ExternalLink className="w-3 h-3"/>Sleeper
            </a>
          </div>

          {/* Assets */}
          <div className="grid grid-cols-2 gap-3">
            {([
              { label: "You Give", icon: <ArrowRight className="w-3.5 h-3.5 text-red-500"/>, assets: trade.userGives, total: totalGive },
              { label: "You Get",  icon: <ArrowLeft  className="w-3.5 h-3.5 text-emerald-500"/>, assets: trade.userGets,  total: totalGet  },
            ] as const).map(({ label, icon, assets, total }) => (
              <div key={label}>
                <div className="flex items-center gap-1.5 mb-2">
                  {icon}
                  <p className="text-[11px] font-bold uppercase tracking-wider">{label}</p>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{total.toLocaleString()}</span>
                </div>
                <div className="space-y-1.5">
                  {assets.players.map(p => (
                    <div key={p.id} className="bg-muted/40 border border-border/40 rounded-lg p-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded", getPositionColor(p.pos))}>{p.pos}</span>
                        <span className="text-xs font-semibold truncate">{p.name}</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-muted-foreground">{p.team}</span>
                        <span className="text-[10px] font-bold">{p.value.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                  {assets.picks.map(p => (
                    <div key={p.label} className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 flex justify-between">
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{p.label}</span>
                      <span className="text-[10px] font-bold">~{p.value.toLocaleString()}</span>
                    </div>
                  ))}
                  {assets.players.length === 0 && assets.picks.length === 0 && (
                    <p className="text-xs text-muted-foreground italic py-2">Nothing</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Value bar */}
          <div>
            <div className="flex justify-between mb-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider">Value Analysis</p>
              <ValueEdge edge={trade.valueEdge}/>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
              <div className="bg-red-500/70 rounded-l-full transition-all" style={{ width: `${giveW}%` }}/>
              <div className="bg-emerald-500/70 rounded-r-full transition-all" style={{ width: `${100 - giveW}%` }}/>
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>Give {totalGive.toLocaleString()}</span>
              <span>Get {totalGet.toLocaleString()}</span>
            </div>
          </div>

          {/* Timestamps */}
          <div className="flex gap-4 text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3">
            <div>
              <p className="font-semibold text-foreground">Created</p>
              <p>{new Date(trade.created).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
            {trade.statusUpdated !== trade.created && (
              <div className="border-l border-border/40 pl-4">
                <p className="font-semibold text-foreground">Updated</p>
                <p>{new Date(trade.statusUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          {isPending && (
            <div className="space-y-2 pt-2 border-t border-border/40">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</p>
              <div className="grid grid-cols-2 gap-2">
                {trade.direction === "incoming" && (
                  <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-10" onClick={onAccept} disabled={actionLoading} data-testid={`drawer-accept-${trade.transactionId}`}>
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>}Accept Trade
                  </Button>
                )}
                <Button variant="outline" className="gap-1.5 hover:border-purple-400/50 hover:text-purple-500 h-10" onClick={onCounter} disabled={actionLoading} data-testid={`drawer-counter-${trade.transactionId}`}>
                  <CornerUpRight className="w-4 h-4"/>Counter
                </Button>
                <Button variant="outline" className={cn("gap-1.5 hover:border-red-400/50 hover:text-red-500 h-10", trade.direction === "incoming" ? "" : "col-span-2")} onClick={onReject} disabled={actionLoading} data-testid={`drawer-reject-${trade.transactionId}`}>
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <XCircle className="w-4 h-4"/>}
                  {trade.direction === "outgoing" ? "Cancel Offer" : "Reject Trade"}
                </Button>
                {trade.partnerOwnerId && (
                  <Button variant="outline" className="col-span-2 gap-1.5 h-9 text-xs hover:border-blue-400/40 hover:text-blue-500" onClick={onMessage} data-testid={`drawer-message-${trade.transactionId}`}>
                    <MessageCircle className="w-3.5 h-3.5"/>Message {trade.partnerName}
                  </Button>
                )}
                <a href={`https://sleeper.com/leagues/${trade.leagueId}`} target="_blank" rel="noopener noreferrer" className="col-span-2">
                  <Button variant="outline" className="w-full gap-1.5 h-9 text-xs"><ExternalLink className="w-3.5 h-3.5"/>Open in Sleeper App</Button>
                </a>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Counter Sheet ────────────────────────────────────────────────────────────

function CounterSheet({ trade, open, onClose, onConfirm, loading, leagueName }: {
  trade: NegTrade | null; open: boolean; onClose: () => void;
  onConfirm: () => void; loading: boolean; leagueName: string;
}) {
  if (!trade) return null;
  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto bg-background border-l border-border/60">
        <SheetHeader className="pb-4 border-b border-border/40">
          <SheetTitle className="flex items-center gap-2">
            <CornerUpRight className="w-4 h-4 text-purple-500"/>
            Counter Offer
          </SheetTitle>
          <p className="text-xs text-muted-foreground">{leagueName} · vs {trade.partnerName}</p>
        </SheetHeader>

        <div className="space-y-5 pt-5">
          <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-400 text-sm">
            <GitBranch className="w-4 h-4 mt-0.5 flex-shrink-0"/>
            <div>
              <p className="font-semibold">This will counter and reject the existing offer.</p>
              <p className="text-xs opacity-80 mt-0.5">The same trade terms will be sent back to {trade.partnerName}. For custom terms, use the Sleeper app.</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-bold text-foreground uppercase tracking-wider">Counter Terms (same as original)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><ArrowRight className="w-3 h-3 text-red-500"/>You Give</p>
                <div className="space-y-0.5">
                  {trade.userGives.players.map(p => <AssetChip key={p.id} player={p}/>)}
                  {trade.userGives.picks.map(p => <PickChip key={p.label} pick={p}/>)}
                  {trade.userGives.players.length + trade.userGives.picks.length === 0 && <span className="text-[10px] text-muted-foreground italic">Nothing</span>}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><ArrowLeft className="w-3 h-3 text-emerald-500"/>You Get</p>
                <div className="space-y-0.5">
                  {trade.userGets.players.map(p => <AssetChip key={p.id} player={p}/>)}
                  {trade.userGets.picks.map(p => <PickChip key={p.label} pick={p}/>)}
                  {trade.userGets.players.length + trade.userGets.picks.length === 0 && <span className="text-[10px] text-muted-foreground italic">Nothing</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-3 text-xs space-y-1 text-muted-foreground">
            <p><span className="font-semibold text-foreground">League:</span> {leagueName}</p>
            <p><span className="font-semibold text-foreground">Partner:</span> {trade.partnerName}</p>
            <p><span className="font-semibold text-foreground">Original Offer ID:</span> <span className="font-mono text-[10px]">{trade.transactionId}</span></p>
            <p><span className="font-semibold text-foreground">Expires:</span> 72 hours from now</p>
          </div>

          {(trade.userGives.picks.length > 0 || trade.userGets.picks.length > 0) && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"/>
              Draft picks will be included in the counter. Verify in Sleeper app before confirming.
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button className="flex-1 gap-1.5 bg-purple-600 hover:bg-purple-700 text-white" onClick={onConfirm} disabled={loading} data-testid="btn-confirm-counter">
              {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <CornerUpRight className="w-4 h-4"/>}
              Send Counter
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ trade, action, onConfirm, onCancel, loading, result }: {
  trade: NegTrade | null; action: "accept" | "reject" | null;
  onConfirm: () => void; onCancel: () => void;
  loading: boolean; result: { success: boolean; message: string } | null;
}) {
  const isAccept = action === "accept";
  return (
    <Dialog open={!!trade && !!action} onOpenChange={v => { if (!v) onCancel(); }}>
      <DialogContent data-testid="neg-confirm-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isAccept
              ? <><CheckCircle2 className="w-5 h-5 text-emerald-500"/>Accept Trade</>
              : <><XCircle className="w-5 h-5 text-red-500"/>{trade?.direction === "outgoing" ? "Cancel Offer" : "Reject Trade"}</>
            }
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            {result ? (
              <span className={cn("flex items-start gap-2 font-medium", result.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                {result.success
                  ? <><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0"/>{result.message}</>
                  : <><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0"/>{result.message}</>
                }
              </span>
            ) : (
              <>
                {isAccept
                  ? "Are you sure you want to accept this trade? This action cannot be undone."
                  : "This will reject the trade in Sleeper. This action cannot be undone."
                }
                {trade && (
                  <div className="mt-3 p-3 bg-muted/40 rounded-lg text-xs space-y-1">
                    <p><span className="font-semibold">Partner:</span> {trade.partnerName}</p>
                    <p><span className="font-semibold">You give:</span> {[...trade.userGives.players.map(p => p.name), ...trade.userGives.picks.map(p => p.label)].join(", ") || "Nothing"}</p>
                    <p><span className="font-semibold">You get:</span>  {[...trade.userGets.players.map(p => p.name),  ...trade.userGets.picks.map(p => p.label)].join(", ") || "Nothing"}</p>
                  </div>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          {result
            ? <Button variant="outline" onClick={onCancel} data-testid="neg-dialog-close">Close</Button>
            : <>
                <Button variant="outline" onClick={onCancel} disabled={loading} data-testid="neg-dialog-cancel">Cancel</Button>
                <Button
                  className={cn(isAccept ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-600 hover:bg-red-700 text-white")}
                  onClick={onConfirm} disabled={loading} data-testid="neg-dialog-confirm"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin mr-2"/>}
                  {isAccept ? "Accept Trade" : trade?.direction === "outgoing" ? "Cancel Offer" : "Reject Trade"}
                </Button>
              </>
          }
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Post-counter DM prompt ───────────────────────────────────────────────────

function PostCounterDmPrompt({ trade, onSendDm, onDismiss }: {
  trade: NegTrade | null;
  onSendDm: () => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog open={!!trade} onOpenChange={v => { if (!v) onDismiss(); }}>
      <DialogContent data-testid="post-counter-dm-prompt">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-500"/>
            Send Sleeper DM to trade partner?
          </DialogTitle>
          <DialogDescription>
            Counter offer sent to <strong>{trade?.partnerName}</strong>. Would you like to follow up with a message in Sleeper?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onDismiss} data-testid="post-counter-dm-skip">No thanks</Button>
          <Button className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={onSendDm} data-testid="post-counter-dm-yes">
            <MessageCircle className="w-4 h-4"/>Message {trade?.partnerName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Send DM modal ────────────────────────────────────────────────────────────

function SendDmModal({ trade, dmId, open, onClose, onSend, sending, leagueName, currentDisplayName }: {
  trade: NegTrade | null;
  dmId: string | null | undefined;
  open: boolean;
  onClose: () => void;
  onSend: (text: string, attachTradeCard: boolean) => Promise<void>;
  sending: boolean;
  leagueName: string;
  currentDisplayName: string;
}) {
  const defaultMsg = (t: NegTrade | null) =>
    `${currentDisplayName} proposed a trade in ${leagueName} via StatChasers Dynasty Command`;

  const [text, setText]           = useState(() => defaultMsg(trade));
  const [attachCard, setAttachCard] = useState(true);

  useEffect(() => {
    if (trade) setText(defaultMsg(trade));
    setAttachCard(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade?.transactionId]);

  if (!trade) return null;

  const charLimit = 500;
  const overLimit = text.length > charLimit;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="send-dm-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-500"/>
            Message {trade.partnerName}
          </DialogTitle>
          <DialogDescription>
            Send a Sleeper DM to your trade partner. You can edit the message before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* DM unavailable fallback */}
          {dmId === null && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-3 bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-sm">
              <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0"/>
              <div>
                <p className="font-semibold">Could not open DM channel.</p>
                <p className="text-xs opacity-80 mt-0.5">You may not have an existing DM with this manager. Open Sleeper directly to start a conversation.</p>
                <a href="https://sleeper.com/chat" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-xs underline underline-offset-2 hover:opacity-80">
                  <ExternalLink className="w-3 h-3"/>Open Sleeper Chat
                </a>
              </div>
            </div>
          )}

          {/* DM loading */}
          {dmId === undefined && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin"/>
              Opening DM channel…
            </div>
          )}

          {/* Message composer — only shown when dmId is known */}
          {dmId && (
            <>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Message</label>
                <Textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={4}
                  maxLength={600}
                  placeholder="Type your message…"
                  className={cn("resize-none text-sm", overLimit && "border-red-500/50 focus-visible:ring-red-500/30")}
                  data-testid="dm-message-input"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{text.trim().length === 0 ? "Message cannot be empty" : ""}</span>
                  <span className={overLimit ? "text-red-500 font-bold" : ""}>{text.length}/{charLimit}</span>
                </div>
              </div>

              {/* Attach trade card toggle */}
              <div className="flex items-center justify-between gap-3 p-3 bg-muted/30 rounded-xl border border-border/40">
                <div className="flex items-center gap-2 min-w-0">
                  <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0"/>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">Attach trade card</p>
                    <p className="text-[10px] text-muted-foreground">Sends trade details inline in Sleeper</p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={attachCard}
                  onClick={() => setAttachCard(v => !v)}
                  data-testid="dm-attach-toggle"
                  className={cn(
                    "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                    attachCard ? "bg-blue-600" : "bg-input"
                  )}
                >
                  <span className={cn(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                    attachCard ? "translate-x-4" : "translate-x-0"
                  )}/>
                </button>
              </div>

              {/* Trade summary preview */}
              <div className="bg-muted/20 border border-border/40 rounded-lg p-3 text-xs space-y-1.5 text-muted-foreground">
                <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider">Trade summary</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] font-medium flex items-center gap-0.5"><ArrowRight className="w-3 h-3 text-red-400"/>Give</span>
                    <p>{[...trade.userGives.players.map(p => p.name), ...trade.userGives.picks.map(p => p.label)].join(", ") || "—"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium flex items-center gap-0.5"><ArrowLeft className="w-3 h-3 text-emerald-400"/>Get</span>
                    <p>{[...trade.userGets.players.map(p => p.name), ...trade.userGets.picks.map(p => p.label)].join(", ") || "—"}</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={sending} data-testid="dm-cancel">Cancel</Button>
          {dmId && (
            <Button
              className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => onSend(text, attachCard)}
              disabled={sending || text.trim().length === 0 || overLimit}
              data-testid="dm-send"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}
              {sending ? "Sending…" : "Send DM"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const SECTIONS: Array<{ id: Section; label: string; icon: React.ElementType }> = [
  { id: "active",   label: "Active Offers", icon: ArrowRightLeft },
  { id: "counters", label: "Counters",       icon: CornerUpRight  },
  { id: "history",  label: "History",        icon: CheckCircle2   },
];

export default function TradeNegotiations({ league, userTeam }: { league: League; userTeam: Team }) {
  const { valuesBySleeperId }    = useValueModel();
  const { toast }                = useToast();
  const sleeper                  = useSleeper();
  const currentDisplayName       = sleeper.user?.displayName || sleeper.user?.username || "Your manager";

  const [hasSession] = useState(() => !!getSleeperSession()?.token);

  // ── list state ──
  const [loading, setLoading]   = useState(false);
  const [rawTxns, setRawTxns]   = useState<SleeperTransaction[]>([]);
  const [section, setSection]   = useState<Section>("active");

  // ── panel / dialog state ──
  const [selectedTrade,  setSelectedTrade]  = useState<NegTrade | null>(null);
  const [detailsOpen,    setDetailsOpen]    = useState(false);
  const [counterOpen,    setCounterOpen]    = useState(false);
  const [confirmState,   setConfirmState]   = useState<{ trade: NegTrade; action: "accept" | "reject" } | null>(null);
  const [confirmResult,  setConfirmResult]  = useState<{ success: boolean; message: string } | null>(null);
  const [actionLoading,  setActionLoading]  = useState<string | null>(null);
  const [counterLoading, setCounterLoading] = useState(false);

  // ── DM state ──
  const [dmCache,        setDmCache]        = useState<Map<string, string | null>>(new Map());
  const [dmLoading,      setDmLoading]      = useState<Set<string>>(new Set());
  const [pendingDmTrade, setPendingDmTrade] = useState<NegTrade | null>(null); // triggers post-counter prompt
  const [dmModalState,   setDmModalState]   = useState<{ trade: NegTrade; dmId: string | null | undefined } | null>(null);
  const [dmSending,      setDmSending]      = useState(false);

  const userRosterId = parseRosterId(userTeam.id);

  const rosterMap = useMemo<Map<number, RosterInfo>>(() => {
    const m = new Map<number, RosterInfo>();
    for (const t of league.teams) {
      m.set(parseRosterId(t.id), {
        name:    t.name,
        avatar:  t.avatar    ?? null,
        ownerId: t.ownerId   ?? null,
      });
    }
    return m;
  }, [league.teams]);

  const fetchTrades = useCallback(async () => {
    if (!hasSession) return;
    setLoading(true);
    try {
      const [pending, history] = await Promise.all([
        fetchLeagueTransactionsFiltered(league.id, ["trade"], undefined, ["proposed"]),
        fetchLeagueTransactionsFiltered(league.id, ["trade"], undefined, ["complete", "failed"]),
      ]);
      setRawTxns([...pending, ...history]);
    } catch (err: any) {
      toast({ title: "Failed to load trades", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [league.id, hasSession, toast]);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  const trades = useMemo<NegTrade[]>(() =>
    rawTxns
      .map(t => normalizeNegTrade(t, league.id, userRosterId, rosterMap, valuesBySleeperId))
      .filter((t): t is NegTrade => t !== null)
      .sort((a, b) => (b.statusUpdated || b.created) - (a.statusUpdated || a.created)),
    [rawTxns, league.id, userRosterId, rosterMap, valuesBySleeperId]
  );

  const sectioned = useMemo(() => ({
    active:   trades.filter(t => t.status === "proposed" && !t.isCounter),
    counters: trades.filter(t => t.status === "proposed" && t.isCounter),
    history:  trades.filter(t => t.status === "complete" || t.status === "rejected" || t.status === "failed"),
  }), [trades]);

  // ── DM helpers ──

  /** Fetch the DM channel id for an owner (cached). Returns null if no DM exists. */
  const fetchDmId = useCallback(async (ownerId: string): Promise<string | null> => {
    if (dmCache.has(ownerId)) return dmCache.get(ownerId) ?? null;
    setDmLoading(prev => new Set(prev).add(ownerId));
    try {
      const dmId = await getDmByMembers(ownerId);
      setDmCache(prev => new Map(prev).set(ownerId, dmId));
      return dmId;
    } catch {
      setDmCache(prev => new Map(prev).set(ownerId, null));
      return null;
    } finally {
      setDmLoading(prev => { const s = new Set(prev); s.delete(ownerId); return s; });
    }
  }, [dmCache]);

  /** Opens the SendDmModal — fetches dmId first if not cached. */
  const handleMessageClick = useCallback(async (trade: NegTrade) => {
    const ownerId = trade.partnerOwnerId;
    if (!ownerId) return;
    const cachedDmId = dmCache.has(ownerId) ? (dmCache.get(ownerId) ?? null) : undefined;
    // Optimistically open the modal — it will show a loading state while dmId resolves
    setDmModalState({ trade, dmId: cachedDmId });
    if (cachedDmId === undefined) {
      // Still need to fetch — update dmId in the modal once resolved
      const resolved = await fetchDmId(ownerId);
      setDmModalState(prev => prev?.trade.transactionId === trade.transactionId
        ? { trade, dmId: resolved }
        : prev
      );
    }
  }, [dmCache, fetchDmId]);

  /** Called from PostCounterDmPrompt "Yes" — fetches dmId then opens modal */
  const handlePostCounterDm = useCallback(async () => {
    if (!pendingDmTrade) return;
    setPendingDmTrade(null);
    await handleMessageClick(pendingDmTrade);
  }, [pendingDmTrade, handleMessageClick]);

  const handleSendDm = useCallback(async (text: string, attachTradeCard: boolean) => {
    if (!dmModalState?.dmId) return;
    const { trade, dmId } = dmModalState;
    setDmSending(true);
    try {
      await sendTradeMessage({
        dmId: dmId!,
        text,
        transactionId: trade.transactionId,
        leagueId: trade.leagueId,
        status: trade.status,
        transactionsByRoster: buildTransactionsByRoster(trade.rawTransaction),
        usersInLeagueMap: buildUsersInLeagueMap(league.teams),
        attachTradeCard,
      });
      toast({ title: "DM sent!", description: `Message delivered to ${trade.partnerName}.` });
      setDmModalState(null);
    } catch (err: any) {
      toast({
        title: "DM failed",
        description: err?.message || "Could not send message. Try in the Sleeper app.",
        variant: "destructive",
      });
    } finally {
      setDmSending(false);
    }
  }, [dmModalState, league.teams, toast]);

  // ── Trade actions ──

  const openDetails = useCallback((t: NegTrade) => { setSelectedTrade(t); setDetailsOpen(true); }, []);
  const openCounter = useCallback((t: NegTrade) => { setSelectedTrade(t); setCounterOpen(true); }, []);

  const handleAcceptClick = useCallback((t: NegTrade) => { setConfirmResult(null); setConfirmState({ trade: t, action: "accept" }); }, []);
  const handleRejectClick = useCallback((t: NegTrade) => { setConfirmResult(null); setConfirmState({ trade: t, action: "reject" }); }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirmState) return;
    const { trade, action } = confirmState;
    setActionLoading(trade.transactionId);
    try {
      if (action === "accept") {
        await acceptTrade(trade.leagueId, trade.transactionId);
        setConfirmResult({ success: true, message: "Trade accepted! Check Sleeper to confirm." });
        toast({ title: "Trade accepted", description: "Check Sleeper to confirm." });
      } else {
        await rejectTrade(trade.leagueId, trade.transactionId, trade.leg);
        setConfirmResult({ success: true, message: "Trade rejected successfully." });
        toast({ title: "Trade rejected" });
      }
      setRawTxns(prev => prev.map(t =>
        t.transaction_id === trade.transactionId
          ? { ...t, status: action === "accept" ? "complete" : "rejected" }
          : t
      ));
      setTimeout(() => fetchTrades(), 1500);
    } catch (err: any) {
      const msg = (err?.message || "Action failed") + ". Act directly on Sleeper.com.";
      setConfirmResult({ success: false, message: msg });
      toast({ title: action === "accept" ? "Accept failed" : "Reject failed", description: msg, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [confirmState, fetchTrades, toast]);

  const handleCounter = useCallback(async () => {
    if (!selectedTrade) return;
    setCounterLoading(true);
    try {
      const raw = selectedTrade.rawTransaction;
      await proposeTrade({
        leagueId: selectedTrade.leagueId,
        adds:      raw.adds  ?? {},
        drops:     raw.drops ?? {},
        draftPicks: [],
        expiresAt: Date.now() + 72 * 3600000,
        rejectTransactionId:  selectedTrade.transactionId,
        rejectTransactionLeg: selectedTrade.leg,
      });
      toast({ title: "Counter sent", description: `Counter offer sent to ${selectedTrade.partnerName}. The original offer has been rejected.` });
      const tradeForDm = selectedTrade;
      setCounterOpen(false);
      setDetailsOpen(false);
      setPendingDmTrade(tradeForDm); // prompts post-counter DM dialog
      setTimeout(() => fetchTrades(), 1500);
    } catch (err: any) {
      toast({ title: "Counter failed", description: err?.message || "Failed to send counter. Try in the Sleeper app.", variant: "destructive" });
    } finally {
      setCounterLoading(false);
    }
  }, [selectedTrade, fetchTrades, toast]);

  // ── Auth gate ──

  if (!hasSession) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Trade Negotiations" subtitle="Active trade offers and counter-offer management for this league"/>
        <Card className="p-8 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-xl bg-[#0b3a7a]/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-[#0b3a7a] dark:text-blue-400"/>
          </div>
          <h3 className="text-base font-bold mb-2">Sleeper Authentication Required</h3>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Trade Negotiations reads live trade data from Sleeper. Sign in via <strong>Waiver Command</strong> to enable this feature.
          </p>
          <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
            <Zap className="w-3 h-3 text-[#d4af37]"/>
            Your session is stored locally — never sent to our servers.
          </div>
        </Card>
      </div>
    );
  }

  const current = sectioned[section];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <SectionHeader title="Trade Negotiations" subtitle={`Active offers and counters for ${league.name}`}/>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={fetchTrades} disabled={loading} data-testid="btn-refresh-negotiations">
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")}/>Refresh
        </Button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const count = sectioned[id].length;
          return (
            <button
              key={id}
              onClick={() => setSection(id)}
              data-testid={`tab-neg-${id}`}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                section === id
                  ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                  : "bg-transparent text-muted-foreground border-border/50 hover:border-[#0b3a7a]/40 hover:text-foreground"
              )}
            >
              <Icon className="w-3 h-3"/>
              {label}
              {count > 0 && (
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  section === id ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                )}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl"/>)}
        </div>
      ) : current.length === 0 ? (
        <Card className="p-10 text-center">
          <ArrowRightLeft className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40"/>
          <p className="text-sm font-medium text-foreground mb-1">
            {section === "active"   ? "No active trade offers" :
             section === "counters" ? "No pending counters"    : "No trade history yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {section === "history" ? "Completed and rejected trades will appear here." : "Trade offers will appear here when they are pending."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {current.map(trade => (
            <TradeNegCard
              key={trade.transactionId}
              trade={trade}
              actionLoading={actionLoading === trade.transactionId}
              dmLoading={!!(trade.partnerOwnerId && dmLoading.has(trade.partnerOwnerId))}
              onView={() => openDetails(trade)}
              onCounter={() => openCounter(trade)}
              onAccept={() => handleAcceptClick(trade)}
              onReject={() => handleRejectClick(trade)}
              onMessage={() => handleMessageClick(trade)}
            />
          ))}
        </div>
      )}

      {/* Sheets & Dialogs */}
      <DetailsSheet
        trade={selectedTrade} open={detailsOpen} onClose={() => setDetailsOpen(false)}
        onAccept={() => { setDetailsOpen(false); selectedTrade && handleAcceptClick(selectedTrade); }}
        onCounter={() => { setDetailsOpen(false); selectedTrade && openCounter(selectedTrade); }}
        onReject={() => { setDetailsOpen(false); selectedTrade && handleRejectClick(selectedTrade); }}
        onMessage={() => { setDetailsOpen(false); selectedTrade && handleMessageClick(selectedTrade); }}
        actionLoading={!!(selectedTrade && actionLoading === selectedTrade.transactionId)}
        leagueName={league.name}
      />
      <CounterSheet
        trade={selectedTrade} open={counterOpen} onClose={() => setCounterOpen(false)}
        onConfirm={handleCounter} loading={counterLoading} leagueName={league.name}
      />
      <ConfirmDialog
        trade={confirmState?.trade ?? null} action={confirmState?.action ?? null}
        onConfirm={handleConfirm} onCancel={() => { setConfirmState(null); setConfirmResult(null); }}
        loading={!!(confirmState?.trade && actionLoading === confirmState.trade.transactionId)}
        result={confirmResult}
      />
      <PostCounterDmPrompt
        trade={pendingDmTrade}
        onSendDm={handlePostCounterDm}
        onDismiss={() => setPendingDmTrade(null)}
      />
      <SendDmModal
        trade={dmModalState?.trade ?? null}
        dmId={dmModalState?.dmId}
        open={!!dmModalState}
        onClose={() => setDmModalState(null)}
        onSend={handleSendDm}
        sending={dmSending}
        leagueName={league.name}
        currentDisplayName={currentDisplayName}
      />
    </div>
  );
}
