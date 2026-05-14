import { useState, useEffect, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getSleeperSession } from "@/services/sleeperAuth";
import { acceptTrade, rejectTrade } from "@/services/sleeperAuthedApi";
import type { SleeperTransaction } from "@/services/sleeperAuthedApi";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { getPositionColor } from "@/data/mockData";
import {
  ArrowRightLeft, TrendingUp, TrendingDown, RefreshCw, Loader2,
  Clock, AlertTriangle, ChevronRight, X, ExternalLink, CheckCircle2,
  XCircle, Eye, ArrowRight, ArrowLeft, Inbox, Send, BarChart2,
  Lock, Activity, Zap, Calendar, Users,
} from "lucide-react";

const SLEEPER_API = "https://api.sleeper.app/v1";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Fetch all trade transactions for a league using the public REST API.
 * Queries leg 0 + weeks 1–18 in parallel (full season coverage + offseason pending)
 * and deduplicates by transaction_id.
 */
async function fetchLeagueTradesPublic(leagueId: string): Promise<SleeperTransaction[]> {
  // Fetch leg 0 (offseason/pending) + all 18 regular-season weeks
  const legs = [0, ...Array.from({ length: 18 }, (_, i) => i + 1)];
  const results = await Promise.allSettled(
    legs.map((leg) =>
      fetchJson<SleeperTransaction[]>(`${SLEEPER_API}/league/${leagueId}/transactions/${leg}`)
    )
  );
  const seen = new Map<string, SleeperTransaction>();
  for (const r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      for (const tx of r.value) {
        if (tx.type === "trade" && !seen.has(tx.transaction_id)) {
          seen.set(tx.transaction_id, tx);
        }
      }
    }
  }
  return Array.from(seen.values());
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TradeView = "pending" | "incoming" | "outgoing" | "completed" | "rejected" | "activity";
type TradeStatus = "pending" | "complete" | "rejected" | "failed";

interface AssetPlayer {
  playerId: string;
  name: string;
  pos: string;
  team: string;
  value: number;
}

interface AssetPick {
  season: string;
  round: number;
  originalRosterId: number;
  label: string;
  value: number;
}

interface NormalizedTrade {
  transactionId: string;
  leagueId: string;
  leagueName: string;
  leagueFormat: string;
  leagueAvatar: string | null;
  status: TradeStatus;
  direction: "incoming" | "outgoing";
  partnerName: string;
  partnerAvatar: string | null;
  partnerRosterId: number;
  userRosterId: number;
  iGive: { players: AssetPlayer[]; picks: AssetPick[] };
  iGet: { players: AssetPlayer[]; picks: AssetPick[] };
  iGiveValue: number;
  iGetValue: number;
  valueEdge: number;
  expiresAt: number | null;
  created: number;
  statusUpdated: number;
  rawConsenterIds: number[];
  rawRosterIds: number[];
  creatorUserId: string | null;
  leg: number;
  rejecterId?: string;
}

interface RawLeagueData {
  leagueId: string;
  leagueName: string;
  leagueFormat: string;
  leagueAvatar: string | null;
  userRosterId: number;
  rosterMap: Map<number, { name: string; avatar: string | null; ownerId: string }>;
  transactions: SleeperTransaction[];
}

interface FetchError {
  leagueId: string;
  leagueName: string;
  message: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const APPROX_PICK_VALUES: Record<string, Record<number, number>> = {
  "2026": { 1: 900, 2: 500, 3: 260, 4: 110 },
  "2027": { 1: 700, 2: 420, 3: 210, 4: 85 },
  "2028": { 1: 580, 2: 360, 3: 180, 4: 72 },
  "2029": { 1: 500, 2: 320, 3: 160, 4: 60 },
};

function approxPickValue(season: string, round: number): number {
  const yr = APPROX_PICK_VALUES[season] || APPROX_PICK_VALUES["2029"];
  return yr[round] ?? 60;
}

function ordinalRound(round: number): string {
  if (round === 1) return "1st";
  if (round === 2) return "2nd";
  if (round === 3) return "3rd";
  return `${round}th`;
}

function formatPickAssetLabel(season: string, round: number): string {
  return `${season} ${ordinalRound(round)}`;
}

function formatExpiryLabel(expiresAt: number | null): string {
  if (!expiresAt) return "—";
  const now = Date.now();
  const ms = expiresAt - now;
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function isExpiringSoon(expiresAt: number | null): boolean {
  if (!expiresAt) return false;
  return expiresAt - Date.now() < 24 * 3600 * 1000 && expiresAt > Date.now();
}

function normalizeTrade(
  t: SleeperTransaction,
  leagueId: string,
  leagueName: string,
  leagueFormat: string,
  leagueAvatar: string | null,
  userRosterId: number,
  creatorUserId: string | null,
  rosterMap: Map<number, { name: string; avatar: string | null; ownerId: string }>,
  playersDb: Record<string, any>,
  valuesBySleeperId: Record<string, number>
): NormalizedTrade | null {
  if (!t.roster_ids || !t.roster_ids.includes(userRosterId)) return null;

  const partnerRosterId = (t.roster_ids || []).find((id) => id !== userRosterId) ?? -1;
  const partnerInfo = partnerRosterId !== -1 ? rosterMap.get(partnerRosterId) : null;
  const partnerName = partnerInfo?.name ?? `Team ${partnerRosterId}`;
  const partnerAvatar = partnerInfo?.avatar ?? null;

  const isIncoming = !(t.consenter_ids || []).includes(userRosterId);
  const direction: "incoming" | "outgoing" = isIncoming ? "incoming" : "outgoing";

  const iGivePlayers: AssetPlayer[] = [];
  const iGetPlayers: AssetPlayer[] = [];

  if (t.drops) {
    for (const [pid, rosterId] of Object.entries(t.drops)) {
      if (rosterId === userRosterId) {
        const info = t.player_map?.[pid] || playersDb[pid];
        const name = info?.full_name || (info ? `${info.first_name || ""} ${info.last_name || ""}`.trim() : pid);
        const pos = info?.position || "?";
        const team = info?.team || "FA";
        iGivePlayers.push({ playerId: pid, name, pos, team, value: valuesBySleeperId[pid] || 0 });
      }
    }
  }

  if (t.adds) {
    for (const [pid, rosterId] of Object.entries(t.adds)) {
      if (rosterId === userRosterId) {
        const info = t.player_map?.[pid] || playersDb[pid];
        const name = info?.full_name || (info ? `${info.first_name || ""} ${info.last_name || ""}`.trim() : pid);
        const pos = info?.position || "?";
        const team = info?.team || "FA";
        iGetPlayers.push({ playerId: pid, name, pos, team, value: valuesBySleeperId[pid] || 0 });
      }
    }
  }

  const iGivePicks: AssetPick[] = [];
  const iGetPicks: AssetPick[] = [];

  for (const dp of t.draft_picks || []) {
    const label = formatPickAssetLabel(dp.season, dp.round);
    const value = approxPickValue(dp.season, dp.round);
    if (dp.previous_owner_id === userRosterId) {
      iGivePicks.push({ season: dp.season, round: dp.round, originalRosterId: dp.roster_id, label, value });
    } else if (dp.owner_id === userRosterId) {
      iGetPicks.push({ season: dp.season, round: dp.round, originalRosterId: dp.roster_id, label, value });
    }
  }

  const iGiveValue = iGivePlayers.reduce((s, p) => s + p.value, 0) + iGivePicks.reduce((s, p) => s + p.value, 0);
  const iGetValue = iGetPlayers.reduce((s, p) => s + p.value, 0) + iGetPicks.reduce((s, p) => s + p.value, 0);
  const valueEdge = iGetValue - iGiveValue;

  const expiresAt = t.settings?.expires_at ? (t.settings.expires_at > 1e12 ? t.settings.expires_at : t.settings.expires_at * 1000) : null;
  const statusUpdated = t.status_updated || t.updated || t.created;

  return {
    transactionId: t.transaction_id,
    leagueId,
    leagueName,
    leagueFormat,
    leagueAvatar,
    status: (t.status || "pending") as TradeStatus,
    direction,
    partnerName,
    partnerAvatar,
    partnerRosterId,
    userRosterId,
    iGive: { players: iGivePlayers, picks: iGivePicks },
    iGet: { players: iGetPlayers, picks: iGetPicks },
    iGiveValue,
    iGetValue,
    valueEdge,
    expiresAt,
    created: t.created,
    statusUpdated,
    rawConsenterIds: t.consenter_ids || [],
    rawRosterIds: t.roster_ids || [],
    creatorUserId,
    leg: t.leg ?? 1,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPICard({ label, value, sub, icon: Icon, color, loading }: {
  label: string; value: number | string; sub?: string;
  icon: React.ElementType; color: string; loading?: boolean;
}) {
  return (
    <Card className="p-4 flex items-start gap-3 min-w-0">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", color)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        {loading ? (
          <>
            <Skeleton className="h-6 w-12 mb-1" />
            <Skeleton className="h-3.5 w-20" />
          </>
        ) : (
          <>
            <p className="text-xl font-bold leading-tight text-foreground">{value}</p>
            <p className="text-[11px] font-medium text-muted-foreground leading-tight mt-0.5">{label}</p>
            {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

function TeamAvatar({ name, avatar, size = "sm" }: { name: string; avatar?: string | null; size?: "sm" | "md" }) {
  const [err, setErr] = useState(false);
  const dim = size === "md" ? "w-7 h-7 text-[11px]" : "w-5 h-5 text-[9px]";
  if (avatar && !err) {
    return <img src={avatar} alt={name} className={cn(dim, "rounded-full object-cover flex-shrink-0 ring-1 ring-border/50")} onError={() => setErr(true)} />;
  }
  return (
    <div className={cn(dim, "rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0")}>
      {(name || "?").charAt(0).toUpperCase()}
    </div>
  );
}

function AssetChip({ player }: { player: AssetPlayer }) {
  const posColor = getPositionColor(player.pos);
  return (
    <div className="flex items-center gap-1.5 bg-muted/40 rounded-md px-2 py-1 min-w-0">
      <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0", posColor)}>{player.pos}</span>
      <span className="text-[11px] font-medium text-foreground truncate">{player.name}</span>
      {player.value > 0 && <span className="text-[10px] text-muted-foreground ml-auto pl-1 flex-shrink-0">{player.value.toLocaleString()}</span>}
    </div>
  );
}

function PickChip({ pick }: { pick: AssetPick }) {
  return (
    <div className="flex items-center gap-1.5 bg-amber-500/10 dark:bg-amber-400/10 rounded-md px-2 py-1">
      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">PICK</span>
      <span className="text-[11px] font-medium text-foreground">{pick.label}</span>
      {pick.value > 0 && <span className="text-[10px] text-muted-foreground ml-auto">{pick.value.toLocaleString()}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: TradeStatus }) {
  const styles: Record<TradeStatus, string> = {
    pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    complete: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    rejected: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    failed: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  };
  const labels: Record<TradeStatus, string> = { pending: "Pending", complete: "Complete", rejected: "Rejected", failed: "Failed" };
  return <Badge variant="outline" className={cn("text-[10px] font-semibold", styles[status])}>{labels[status]}</Badge>;
}

function DirectionBadge({ direction }: { direction: "incoming" | "outgoing" }) {
  if (direction === "incoming") {
    return (
      <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
        <ArrowLeft className="w-3 h-3" /> Incoming
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-[10px] font-bold text-blue-700 dark:text-blue-400">
      <ArrowRight className="w-3 h-3" /> Outgoing
    </div>
  );
}

function ValueEdgeCell({ edge }: { edge: number }) {
  if (Math.abs(edge) < 10) return <span className="text-xs text-muted-foreground">~Even</span>;
  const isGood = edge > 0;
  return (
    <div className={cn("flex items-center gap-0.5 text-xs font-bold", isGood ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {isGood ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isGood ? "+" : ""}{edge > 0 ? Math.round(edge).toLocaleString() : Math.round(edge).toLocaleString()}
    </div>
  );
}

// ─── Trade Row ────────────────────────────────────────────────────────────────

function TradeRow({ trade, onView, onAccept, onReject, actionLoading, actionResult }: {
  trade: NormalizedTrade;
  onView: () => void;
  onAccept: () => void;
  onReject: () => void;
  actionLoading: boolean;
  actionResult: { success: boolean; message: string } | undefined;
}) {
  const expiring = isExpiringSoon(trade.expiresAt);

  return (
    <div
      className={cn(
        "group relative border border-border/60 rounded-xl p-4 bg-card hover:border-[#0b3a7a]/30 hover:shadow-md hover:shadow-[#0b3a7a]/5 transition-all cursor-pointer",
        expiring && trade.status === "pending" && "border-amber-500/40 bg-amber-500/5"
      )}
      onClick={onView}
      data-testid={`trade-row-${trade.transactionId}`}
    >
      {expiring && trade.status === "pending" && (
        <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3" /> Expiring soon
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_auto_auto] gap-3 items-center">

        {/* League */}
        <div className="flex items-center gap-2 min-w-0">
          <TeamAvatar name={trade.leagueName} avatar={trade.leagueAvatar} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{trade.leagueName}</p>
            <p className="text-[10px] text-muted-foreground">{trade.leagueFormat}</p>
          </div>
        </div>

        {/* Direction */}
        <div className="hidden md:flex flex-col items-center gap-1 px-2">
          <StatusBadge status={trade.status} />
          {trade.status === "pending" && <DirectionBadge direction={trade.direction} />}
        </div>

        {/* Partner */}
        <div className="flex items-center gap-2 min-w-0">
          <TeamAvatar name={trade.partnerName} avatar={trade.partnerAvatar} />
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground">Partner</p>
            <p className="text-xs font-semibold text-foreground truncate">{trade.partnerName}</p>
          </div>
        </div>

        {/* You Give */}
        <div className="hidden lg:block min-w-0 max-w-[180px]">
          <p className="text-[10px] text-muted-foreground mb-1 font-medium">You Give</p>
          <div className="space-y-0.5">
            {trade.iGive.players.slice(0, 2).map((p) => (
              <AssetChip key={p.playerId} player={p} />
            ))}
            {trade.iGive.picks.slice(0, 1).map((p) => (
              <PickChip key={p.label} pick={p} />
            ))}
            {(trade.iGive.players.length + trade.iGive.picks.length) > 3 && (
              <span className="text-[10px] text-muted-foreground">+{(trade.iGive.players.length + trade.iGive.picks.length) - 3} more</span>
            )}
            {trade.iGive.players.length === 0 && trade.iGive.picks.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic">Nothing</span>
            )}
          </div>
        </div>

        {/* You Get */}
        <div className="hidden lg:block min-w-0 max-w-[180px]">
          <p className="text-[10px] text-muted-foreground mb-1 font-medium">You Get</p>
          <div className="space-y-0.5">
            {trade.iGet.players.slice(0, 2).map((p) => (
              <AssetChip key={p.playerId} player={p} />
            ))}
            {trade.iGet.picks.slice(0, 1).map((p) => (
              <PickChip key={p.label} pick={p} />
            ))}
            {(trade.iGet.players.length + trade.iGet.picks.length) > 3 && (
              <span className="text-[10px] text-muted-foreground">+{(trade.iGet.players.length + trade.iGet.picks.length) - 3} more</span>
            )}
            {trade.iGet.players.length === 0 && trade.iGet.picks.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic">Nothing</span>
            )}
          </div>
        </div>

        {/* Value Edge */}
        <div className="hidden md:block text-center px-2">
          <p className="text-[10px] text-muted-foreground mb-0.5">Edge</p>
          <ValueEdgeCell edge={trade.valueEdge} />
        </div>

        {/* Expiration */}
        <div className="hidden md:block text-center px-2">
          <p className="text-[10px] text-muted-foreground mb-0.5">Expires</p>
          <p className={cn("text-xs font-medium", expiring ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            {formatExpiryLabel(trade.expiresAt)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {actionResult && (
            <span className={cn("text-[10px] font-semibold", actionResult.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
              {actionResult.success ? <CheckCircle2 className="w-3.5 h-3.5 inline" /> : <XCircle className="w-3.5 h-3.5 inline" />}
            </span>
          )}
          {actionLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 hover:border-[#0b3a7a]/40" onClick={onView} data-testid={`btn-view-${trade.transactionId}`}>
                <Eye className="w-3 h-3" /> View
              </Button>
              {trade.status === "pending" && trade.direction === "incoming" && (
                <>
                  <Button size="sm" className="h-7 px-2 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onAccept} data-testid={`btn-accept-${trade.transactionId}`}>
                    <CheckCircle2 className="w-3 h-3" /> Accept
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 hover:border-red-400/50 hover:text-red-500" onClick={onReject} data-testid={`btn-reject-${trade.transactionId}`}>
                    <XCircle className="w-3 h-3" /> Reject
                  </Button>
                </>
              )}
              {trade.status === "pending" && trade.direction === "outgoing" && (
                <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 hover:border-red-400/50 hover:text-red-500" onClick={onReject} data-testid={`btn-cancel-${trade.transactionId}`}>
                  <X className="w-3 h-3" /> Cancel
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Trade Drawer ─────────────────────────────────────────────────────────────

function TradeDrawer({ trade, open, onClose, onAccept, onReject, actionLoading }: {
  trade: NormalizedTrade | null;
  open: boolean;
  onClose: () => void;
  onAccept: (t: NormalizedTrade) => void;
  onReject: (t: NormalizedTrade) => void;
  actionLoading: boolean;
}) {
  if (!trade) return null;

  const totalGive = trade.iGiveValue;
  const totalGet = trade.iGetValue;
  const totalCombined = totalGive + totalGet || 1;
  const giveWidth = Math.round((totalGive / totalCombined) * 100);
  const expiring = isExpiringSoon(trade.expiresAt);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto bg-background border-l border-border/60">
        <SheetHeader className="pb-4 border-b border-border/40">
          <SheetTitle className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <ArrowRightLeft className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400 flex-shrink-0" />
                <span className="text-base font-bold">Trade Details</span>
                <StatusBadge status={trade.status} />
                {trade.status === "pending" && <DirectionBadge direction={trade.direction} />}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-normal">{trade.leagueName}</p>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 pt-5">

          {/* Expiry Banner */}
          {trade.expiresAt && trade.status === "pending" && (
            <div className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium",
              expiring
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                : "bg-muted/50 text-muted-foreground border border-border/40"
            )}>
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span>
                {expiring ? "⚠ Expiring " : "Expires in "}
                <strong>{formatExpiryLabel(trade.expiresAt)}</strong>
                {" — "}{new Date(trade.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          )}

          {/* Partner */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border/40">
            <TeamAvatar name={trade.partnerName} avatar={trade.partnerAvatar} size="md" />
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Trade Partner</p>
              <p className="text-sm font-bold text-foreground">{trade.partnerName}</p>
            </div>
            <a
              href={`https://sleeper.com/leagues/${trade.leagueId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" /> Open in Sleeper
            </a>
          </div>

          {/* Assets Comparison */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <ArrowRight className="w-3.5 h-3.5 text-red-500" />
                <p className="text-[11px] font-bold text-foreground uppercase tracking-wider">You Give</p>
                <span className="ml-auto text-[11px] font-semibold text-muted-foreground tabular-nums">{totalGive.toLocaleString()}</span>
              </div>
              <div className="space-y-1.5">
                {trade.iGive.players.map((p) => (
                  <div key={p.playerId} className="bg-muted/40 border border-border/40 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded", getPositionColor(p.pos))}>{p.pos}</span>
                      <span className="text-xs font-semibold text-foreground truncate">{p.name}</span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-muted-foreground">{p.team}</span>
                      <span className="text-[10px] font-bold text-foreground">{p.value.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {trade.iGive.picks.map((p) => (
                  <div key={p.label} className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{p.label}</span>
                      <span className="text-[10px] font-bold text-foreground">~{p.value.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {trade.iGive.players.length === 0 && trade.iGive.picks.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-2">Nothing</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <ArrowLeft className="w-3.5 h-3.5 text-emerald-500" />
                <p className="text-[11px] font-bold text-foreground uppercase tracking-wider">You Get</p>
                <span className="ml-auto text-[11px] font-semibold text-muted-foreground tabular-nums">{totalGet.toLocaleString()}</span>
              </div>
              <div className="space-y-1.5">
                {trade.iGet.players.map((p) => (
                  <div key={p.playerId} className="bg-muted/40 border border-border/40 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded", getPositionColor(p.pos))}>{p.pos}</span>
                      <span className="text-xs font-semibold text-foreground truncate">{p.name}</span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-muted-foreground">{p.team}</span>
                      <span className="text-[10px] font-bold text-foreground">{p.value.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {trade.iGet.picks.map((p) => (
                  <div key={p.label} className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{p.label}</span>
                      <span className="text-[10px] font-bold text-foreground">~{p.value.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {trade.iGet.players.length === 0 && trade.iGet.picks.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-2">Nothing</p>
                )}
              </div>
            </div>
          </div>

          {/* Value Bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-bold text-foreground uppercase tracking-wider">Value Analysis</p>
              <ValueEdgeCell edge={trade.valueEdge} />
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
              <div
                className="bg-red-500/70 rounded-l-full transition-all"
                style={{ width: `${giveWidth}%` }}
              />
              <div
                className="bg-emerald-500/70 rounded-r-full transition-all"
                style={{ width: `${100 - giveWidth}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">You give {totalGive.toLocaleString()}</span>
              <span className="text-[10px] text-muted-foreground">You get {totalGet.toLocaleString()}</span>
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-1.5 text-center">
              Values from FantasyCalc · Pick values are approximate dynasty estimates
            </p>
          </div>

          {/* Created / Updated */}
          <div className="flex gap-4 text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3">
            <div>
              <p className="font-semibold text-foreground">Created</p>
              <p>{trade.created ? new Date(trade.created).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p>
            </div>
            <div className="border-l border-border/40 pl-4">
              <p className="font-semibold text-foreground">Last Updated</p>
              <p>{trade.statusUpdated ? new Date(trade.statusUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p>
            </div>
          </div>

          {/* Action Buttons */}
          {trade.status === "pending" && (
            <div className="space-y-2 pt-2 border-t border-border/40">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</p>
              <div className="grid grid-cols-2 gap-2">
                {trade.direction === "incoming" && (
                  <Button
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-10"
                    onClick={() => onAccept(trade)}
                    disabled={actionLoading}
                    data-testid={`drawer-btn-accept-${trade.transactionId}`}
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Accept Trade
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="gap-1.5 hover:border-red-400/50 hover:text-red-500 h-10"
                  onClick={() => onReject(trade)}
                  disabled={actionLoading}
                  data-testid={`drawer-btn-reject-${trade.transactionId}`}
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  {trade.direction === "incoming" ? "Reject" : "Cancel Offer"}
                </Button>
                <a
                  href={`https://sleeper.com/leagues/${trade.leagueId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="col-span-2"
                >
                  <Button variant="outline" className="w-full gap-1.5 h-9 text-xs" data-testid={`drawer-btn-open-sleeper-${trade.transactionId}`}>
                    <ExternalLink className="w-3.5 h-3.5" /> Open in Sleeper App
                  </Button>
                </a>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ trade, action, onConfirm, onCancel, loading, result }: {
  trade: NormalizedTrade | null;
  action: "accept" | "reject" | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  result: { success: boolean; message: string } | null;
}) {
  const isAccept = action === "accept";
  return (
    <Dialog open={!!trade && !!action} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent data-testid="confirm-trade-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isAccept
              ? <><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Accept Trade</>
              : <><XCircle className="w-5 h-5 text-red-500" /> {trade?.direction === "outgoing" ? "Cancel Offer" : "Reject Trade"}</>
            }
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            {result ? (
              <span className={cn("flex items-start gap-2 font-medium", result.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                {result.success
                  ? <><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />{result.message}</>
                  : <><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{result.message}</>
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
                    <p><span className="font-semibold">League:</span> {trade.leagueName}</p>
                    <p><span className="font-semibold">Partner:</span> {trade.partnerName}</p>
                    <p><span className="font-semibold">You give:</span> {[...trade.iGive.players.map(p => p.name), ...trade.iGive.picks.map(p => p.label)].join(", ") || "Nothing"}</p>
                    <p><span className="font-semibold">You get:</span> {[...trade.iGet.players.map(p => p.name), ...trade.iGet.picks.map(p => p.label)].join(", ") || "Nothing"}</p>
                  </div>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          {result ? (
            <Button variant="outline" onClick={onCancel} data-testid="confirm-dialog-close">Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onCancel} disabled={loading} data-testid="confirm-dialog-cancel">Cancel</Button>
              <Button
                className={cn(isAccept ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-600 hover:bg-red-700 text-white")}
                onClick={onConfirm}
                disabled={loading}
                data-testid="confirm-dialog-confirm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {isAccept ? "Accept Trade" : trade?.direction === "outgoing" ? "Cancel Offer" : "Reject Trade"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const VIEWS: Array<{ id: TradeView; label: string; icon: React.ElementType }> = [
  { id: "pending",   label: "Pending",   icon: Clock          },
  { id: "incoming",  label: "Incoming",  icon: Inbox          },
  { id: "outgoing",  label: "Outgoing",  icon: Send           },
  { id: "completed", label: "Completed", icon: CheckCircle2   },
  { id: "rejected",  label: "Rejected",  icon: XCircle        },
  { id: "activity",  label: "Activity",  icon: Activity       },
];

export default function TradeSync() {
  const sleeper = useSleeper();
  const { valuesBySleeperId } = useValueModel();
  const { toast } = useToast();

  const [hasSession, setHasSession] = useState(() => {
    const s = getSleeperSession();
    return !!s?.token;
  });

  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<RawLeagueData[]>([]);
  const [errors, setErrors] = useState<FetchError[]>([]);
  const [view, setView] = useState<TradeView>("pending");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [selectedTrade, setSelectedTrade] = useState<NormalizedTrade | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{ trade: NormalizedTrade; action: "accept" | "reject" } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [confirmResult, setConfirmResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchAllData = useCallback(async () => {
    if (!sleeper.isConnected || !sleeper.user) return;
    setLoading(true);
    setErrors([]);

    let playersDb: Record<string, any> = {};
    try { playersDb = await getSleeperPlayers(); } catch {}

    const leagueResults = await Promise.allSettled(
      sleeper.leagues.map(async (ls) => {
        const [txns, rostersRaw, usersRaw] = await Promise.all([
          fetchLeagueTradesPublic(ls.leagueId),
          fetchJson<any[]>(`${SLEEPER_API}/league/${ls.leagueId}/rosters`),
          fetchJson<any[]>(`${SLEEPER_API}/league/${ls.leagueId}/users`),
        ]);

        const ownerMap = new Map<string, { name: string; avatar: string | null }>();
        for (const u of usersRaw) {
          ownerMap.set(u.user_id, {
            name: u.metadata?.team_name || u.display_name || u.user_id,
            avatar: u.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null,
          });
        }
        const rosterMap = new Map<number, { name: string; avatar: string | null; ownerId: string }>();
        let userRosterId = -1;
        for (const r of rostersRaw) {
          const owner = ownerMap.get(r.owner_id) || { name: `Team ${r.roster_id}`, avatar: null };
          rosterMap.set(r.roster_id, { ...owner, ownerId: r.owner_id || "" });
          if (r.owner_id === sleeper.user!.userId) userRosterId = r.roster_id;
        }

        const leagueAvatar = (ls as any).avatar ? `https://sleepercdn.com/avatars/thumbs/${(ls as any).avatar}` : null;

        return {
          leagueId: ls.leagueId,
          leagueName: ls.name,
          leagueFormat: `${ls.scoringFormat} ${ls.format}`,
          leagueAvatar,
          userRosterId,
          rosterMap,
          transactions: txns,
        } as RawLeagueData;
      })
    );

    const successData: RawLeagueData[] = [];
    const newErrors: FetchError[] = [];

    for (let i = 0; i < leagueResults.length; i++) {
      const r = leagueResults[i];
      const ls = sleeper.leagues[i];
      if (r.status === "fulfilled") {
        successData.push(r.value);
      } else {
        const msg = (r.reason as any)?.message || "Failed to load";
        if (!msg.includes("connect your Sleeper account")) {
          newErrors.push({ leagueId: ls.leagueId, leagueName: ls.name, message: msg });
        } else {
          setHasSession(false);
        }
      }
    }

    setRawData(successData);
    setErrors(newErrors);
    setLoading(false);
  }, [sleeper.isConnected, sleeper.user, sleeper.leagues]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const trades: NormalizedTrade[] = useMemo(() => {
    const all: NormalizedTrade[] = [];
    for (const ld of rawData) {
      for (const t of ld.transactions) {
        const norm = normalizeTrade(
          t,
          ld.leagueId,
          ld.leagueName,
          ld.leagueFormat,
          ld.leagueAvatar,
          ld.userRosterId,
          t.creator ?? null,
          ld.rosterMap,
          {},
          valuesBySleeperId
        );
        if (norm) all.push(norm);
      }
    }
    return all.sort((a, b) => (b.statusUpdated || b.created) - (a.statusUpdated || a.created));
  }, [rawData, valuesBySleeperId]);

  const filteredTrades = useMemo(() => {
    let result = trades;
    if (leagueFilter !== "all") result = result.filter((t) => t.leagueId === leagueFilter);
    switch (view) {
      case "pending":   return result.filter((t) => t.status === "pending");
      case "incoming":  return result.filter((t) => t.status === "pending" && t.direction === "incoming");
      case "outgoing":  return result.filter((t) => t.status === "pending" && t.direction === "outgoing");
      case "completed": return result.filter((t) => t.status === "complete");
      case "rejected":  return result.filter((t) => t.status === "rejected" || t.status === "failed");
      case "activity":  return result;
      default:          return result;
    }
  }, [trades, view, leagueFilter]);

  const kpis = useMemo(() => {
    const pending = trades.filter((t) => t.status === "pending");
    const incoming = pending.filter((t) => t.direction === "incoming");
    const outgoing = pending.filter((t) => t.direction === "outgoing");
    const expiring = pending.filter((t) => isExpiringSoon(t.expiresAt));
    const positiveValue = pending.filter((t) => t.valueEdge > 50);
    return {
      totalPending: pending.length,
      incoming: incoming.length,
      outgoing: outgoing.length,
      expiringSoon: expiring.length,
      needsResponse: incoming.length,
      positiveValue: positiveValue.length,
    };
  }, [trades]);

  const handleView = useCallback((trade: NormalizedTrade) => {
    setSelectedTrade(trade);
    setDrawerOpen(true);
  }, []);

  const handleAcceptClick = useCallback((trade: NormalizedTrade) => {
    setConfirmResult(null);
    setConfirmState({ trade, action: "accept" });
  }, []);

  const handleRejectClick = useCallback((trade: NormalizedTrade) => {
    setConfirmResult(null);
    setConfirmState({ trade, action: "reject" });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirmState) return;
    const { trade, action } = confirmState;
    setActionLoading(trade.transactionId);
    try {
      if (action === "accept") {
        await acceptTrade(trade.leagueId, trade.transactionId);
        const msg = "Trade accepted! Check Sleeper to confirm the update.";
        setConfirmResult({ success: true, message: msg });
        setActionResults((prev) => new Map(prev).set(trade.transactionId, { success: true, message: "Accepted" }));
        toast({ title: "Trade accepted", description: msg });
        setRawData((prev) =>
          prev.map((ld) =>
            ld.leagueId !== trade.leagueId
              ? ld
              : {
                  ...ld,
                  transactions: ld.transactions.map((t) =>
                    t.transaction_id === trade.transactionId
                      ? { ...t, status: "complete" }
                      : t
                  ),
                }
          )
        );
      } else {
        const result = await rejectTrade(trade.leagueId, trade.transactionId, trade.leg);
        const rejecterId = result.metadata
          ? (result.metadata["rejecter_id"] as string | undefined)
          : undefined;
        const msg = "Trade rejected successfully.";
        setConfirmResult({ success: true, message: msg });
        setActionResults((prev) => new Map(prev).set(trade.transactionId, { success: true, message: "Rejected" }));
        toast({ title: "Trade rejected", description: msg });
        setRawData((prev) =>
          prev.map((ld) =>
            ld.leagueId !== trade.leagueId
              ? ld
              : {
                  ...ld,
                  transactions: ld.transactions.map((t) =>
                    t.transaction_id === trade.transactionId
                      ? {
                          ...t,
                          status: "rejected",
                          metadata: rejecterId
                            ? { ...(t.metadata ?? {}), rejecter_id: rejecterId }
                            : t.metadata,
                        }
                      : t
                  ),
                }
          )
        );
      }
      setTimeout(() => fetchAllData(), 1500);
    } catch (err: any) {
      const msg = err?.message || "Action failed";
      const errorMsg = `${msg}. You can also act directly on Sleeper.com.`;
      setConfirmResult({ success: false, message: errorMsg });
      setActionResults((prev) => new Map(prev).set(trade.transactionId, { success: false, message: "Failed" }));
      toast({ title: action === "accept" ? "Accept failed" : "Reject failed", description: errorMsg, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [confirmState, fetchAllData, toast]);

  const handleConfirmCancel = useCallback(() => {
    setConfirmState(null);
    setConfirmResult(null);
  }, []);

  if (!sleeper.isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Card className="p-8 text-center max-w-sm w-full">
          <Lock className="w-10 h-10 mx-auto mb-3 text-[#0b3a7a] dark:text-blue-400 opacity-60" />
          <h3 className="text-base font-bold mb-1">Connect Sleeper to Unlock</h3>
          <p className="text-sm text-muted-foreground">Trade Sync requires a connected Sleeper account.</p>
        </Card>
      </div>
    );
  }


  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <SectionHeader
          title="Trade Sync"
          subtitle="All pending trade offers across your leagues — managed from one dashboard."
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={fetchAllData}
          disabled={loading}
          data-testid="button-refresh-tradesync"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard label="Total Pending"   value={kpis.totalPending}   icon={ArrowRightLeft} color="bg-blue-500/10 text-blue-600 dark:text-blue-400"    loading={loading} />
        <KPICard label="Incoming"        value={kpis.incoming}       icon={Inbox}          color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" loading={loading} />
        <KPICard label="Outgoing"        value={kpis.outgoing}       icon={Send}           color="bg-purple-500/10 text-purple-600 dark:text-purple-400" loading={loading} />
        <KPICard label="Expiring Soon"   value={kpis.expiringSoon}   icon={Clock}          color="bg-amber-500/10 text-amber-600 dark:text-amber-400"    loading={loading} />
        <KPICard label="Needs Response"  value={kpis.needsResponse}  icon={AlertTriangle}  color="bg-red-500/10 text-red-600 dark:text-red-400"          loading={loading} />
        <KPICard label="Win-Value Deals" value={kpis.positiveValue}  icon={TrendingUp}     color="bg-[#d4af37]/15 text-[#b8920f]"                         loading={loading} />
      </div>

      {/* No-session soft banner — viewing works, accept/reject requires auth */}
      {!hasSession && (
        <Card className="p-3 border-[#0b3a7a]/30 bg-[#0b3a7a]/5">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Sign in via Waiver Command</span> to accept or reject trades directly. Viewing is available without sign-in.
            </p>
          </div>
        </Card>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs">
              <p className="font-semibold text-amber-700 dark:text-amber-400">Some leagues failed to load</p>
              <p className="text-muted-foreground mt-0.5">{errors.map((e) => e.leagueName).join(", ")}</p>
            </div>
          </div>
        </Card>
      )}

      {/* View + League Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5 flex-wrap">
          {VIEWS.map(({ id, label, icon: Icon }) => {
            const count = id === "pending"   ? kpis.totalPending
                       : id === "incoming"  ? kpis.incoming
                       : id === "outgoing"  ? kpis.outgoing
                       : undefined;
            return (
              <button
                key={id}
                onClick={() => setView(id)}
                data-testid={`view-tab-${id}`}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all",
                  view === id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
                {count !== undefined && count > 0 && (
                  <span className={cn("text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none", view === id ? "bg-[#d4af37]/20 text-[#b8920f]" : "bg-muted text-muted-foreground")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {rawData.length > 1 && (
          <select
            className="text-xs bg-muted/50 border border-border/50 rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#0b3a7a]/30"
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            data-testid="league-filter-select"
          >
            <option value="all">All Leagues ({rawData.length})</option>
            {rawData.map((ld) => (
              <option key={ld.leagueId} value={ld.leagueId}>{ld.leagueName}</option>
            ))}
          </select>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {filteredTrades.length} trade{filteredTrades.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Trade List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-4">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-7 w-16" />
              </div>
            </Card>
          ))}
        </div>
      ) : filteredTrades.length === 0 ? (
        <Card className="p-12 text-center" data-testid="empty-state-tradesync">
          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
            {view === "pending" ? <Clock className="w-6 h-6 text-muted-foreground" /> : <CheckCircle2 className="w-6 h-6 text-muted-foreground" />}
          </div>
          <p className="text-sm font-semibold text-foreground mb-1">
            {view === "pending" ? "No pending trades" : `No ${view} trades`}
          </p>
          <p className="text-xs text-muted-foreground">
            {view === "pending"
              ? "You're all caught up — no open trade offers across your leagues."
              : "No trades match this filter."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredTrades.map((trade) => (
            <TradeRow
              key={trade.transactionId}
              trade={trade}
              onView={() => handleView(trade)}
              onAccept={() => handleAcceptClick(trade)}
              onReject={() => handleRejectClick(trade)}
              actionLoading={actionLoading === trade.transactionId}
              actionResult={actionResults.get(trade.transactionId)}
            />
          ))}
        </div>
      )}

      {/* Trade Drawer */}
      <TradeDrawer
        trade={selectedTrade}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTrade(null); }}
        onAccept={handleAcceptClick}
        onReject={handleRejectClick}
        actionLoading={actionLoading === selectedTrade?.transactionId}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        trade={confirmState?.trade ?? null}
        action={confirmState?.action ?? null}
        onConfirm={handleConfirm}
        onCancel={handleConfirmCancel}
        loading={actionLoading === confirmState?.trade?.transactionId}
        result={confirmResult}
      />
    </div>
  );
}
