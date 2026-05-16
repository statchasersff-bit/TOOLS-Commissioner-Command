import { useState, useEffect, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getSleeperSession } from "@/services/sleeperAuth";
import { fetchLeagueTransactionsFiltered, acceptTrade, rejectTrade } from "@/services/sleeperAuthedApi";
import type { SleeperTransaction, SleeperTransactionPick } from "@/services/sleeperAuthedApi";
import { getPositionColor } from "@/data/mockData";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import {
  ArrowRightLeft, TrendingUp, TrendingDown, RefreshCw, Loader2,
  Clock, AlertTriangle, CheckCircle2, XCircle, Inbox, Send,
  Lock, Activity, MessageSquare,
} from "lucide-react";
import {
  TradeActionModal,
  type NormalizedTrade,
  type AssetPlayer,
  type AssetPick,
  type TradeStatus,
  type TradeModalMode,
} from "@/components/trade/TradeActionModal";

const SLEEPER_API = "https://api.sleeper.app/v1";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Fetch trade transactions via the public REST API (no auth required).
 * NOTE: Sleeper's public API only returns status="complete" transactions —
 * pending trades are NOT visible without authentication.
 * Queries leg 0 + weeks 1–18 and deduplicates by transaction_id.
 */
async function fetchLeagueTradesPublicOnly(leagueId: string): Promise<SleeperTransaction[]> {
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

/**
 * Fetch all trade transactions for a league.
 * Strategy:
 *   1. If authenticated: use Sleeper GraphQL (returns ALL statuses including pending).
 *   2. If GraphQL fails or no session: fall back to public REST API
 *      (completed trades only — pending trades won't appear without auth).
 */
async function fetchLeagueTradesForSync(leagueId: string, hasAuth: boolean): Promise<{ txns: SleeperTransaction[]; usedAuth: boolean }> {
  if (hasAuth) {
    try {
      // No status_filters — return ALL statuses (pending, complete, rejected,
      // failed, cancelled, counter_offered, etc.) and filter client-side.
      const txns = await fetchLeagueTransactionsFiltered(leagueId, ["trade"], undefined, undefined);
      return { txns, usedAuth: true };
    } catch (err: any) {
      console.warn("[TradeSync] GraphQL failed for", leagueId, "→", err?.message);
    }
  }
  const txns = await fetchLeagueTradesPublicOnly(leagueId);
  return { txns, usedAuth: false };
}

// ─── Feature flag ─────────────────────────────────────────────────────────────
// NormalizedTrade, AssetPlayer, AssetPick, TradeStatus, TradeModalMode are now
// imported from client/src/components/trade/TradeActionModal.tsx
const USE_SHARED_TRADE_MODAL = true; // eslint-disable-line @typescript-eslint/no-unused-vars

// ─── Types ────────────────────────────────────────────────────────────────────

type TradeView = "pending" | "incoming" | "outgoing" | "completed" | "rejected" | "cancelled" | "activity";

interface RawLeagueData {
  leagueId: string;
  leagueName: string;
  leagueFormat: string;
  leagueAvatar: string | null;
  userRosterId: number;
  rookieDraftRounds: number;
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

function formatPickAssetLabel(season: string, round: number, pickNo?: number): string {
  const base = `${season} ${ordinalRound(round)}`;
  return pickNo ? `${base} (Pick ${pickNo})` : base;
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
  myUserId: string,
  rosterMap: Map<number, { name: string; avatar: string | null; ownerId: string }>,
  playersDb: Record<string, any>,
  valuesBySleeperId: Record<string, number>,
  rookieDraftRounds: number = 5
): NormalizedTrade | null {
  if (!t.roster_ids || !t.roster_ids.includes(userRosterId)) return null;

  const partnerRosterId = (t.roster_ids || []).find((id) => id !== userRosterId) ?? -1;
  const partnerInfo = partnerRosterId !== -1 ? rosterMap.get(partnerRosterId) : null;
  const partnerName = partnerInfo?.name ?? `Team ${partnerRosterId}`;
  const partnerAvatar = partnerInfo?.avatar ?? null;

  // ── Direction classification per Sleeper spec ─────────────────────────────
  // creator is a user_id (string); consenter_ids are roster_ids (numbers).
  const isProposed      = t.status === "proposed";
  const isCounter       = (t.settings as any)?.is_counter === 1;
  const iCreated        = t.creator === myUserId;
  const iHaveConsented  = (t.consenter_ids || []).includes(userRosterId);

  let direction: "incoming" | "outgoing";
  if (!isProposed) {
    // For completed/rejected/cancelled trades, use creator for history context
    direction = iCreated ? "outgoing" : "incoming";
  } else if (iCreated || iHaveConsented) {
    // I sent this offer, or I already consented — waiting on them
    direction = "outgoing";
  } else {
    // I haven't responded yet — needs my action
    direction = "incoming";
  }

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

  // draft_picks may arrive as a JSON-encoded string (Sleeper GraphQL JSON scalar),
  // a plain array, or null — normalise to an array before iterating.
  const rawDraftPicks = (t as any).draft_picks;
  // Sleeper's GraphQL API returns draft_picks as an array of CSV strings:
  //   "{roster_id},{season},{round},{previous_owner_id},{owner_id}"
  // The public REST API returns them as proper JSON objects.
  // Normalise both into SleeperTransactionPick objects before iterating.
  const draftPicks: SleeperTransactionPick[] = (() => {
    if (!rawDraftPicks) return [];
    if (typeof rawDraftPicks === "string") {
      try { return JSON.parse(rawDraftPicks) as SleeperTransactionPick[]; } catch { return []; }
    }
    if (!Array.isArray(rawDraftPicks)) return [];
    return (rawDraftPicks as any[]).map((dp) => {
      if (typeof dp === "string") {
        // Sleeper GraphQL CSV format:
        //   5 fields: "roster_id,season,round,owner_id,previous_owner_id"
        //   6 fields: "roster_id,season,round,owner_id,previous_owner_id,pick_no" (assigned/exact picks)
        // owner_id = new/receiving roster; previous_owner_id = old/giving roster
        const parts = dp.split(",");
        return {
          roster_id: Number(parts[0]),
          season: parts[1],
          round: Number(parts[2]),
          owner_id: Number(parts[3]),
          previous_owner_id: Number(parts[4]),
          pick_no: parts.length >= 6 && parts[5] ? Number(parts[5]) : undefined,
        } as SleeperTransactionPick;
      }
      return dp as SleeperTransactionPick;
    });
  })();

  for (const dp of draftPicks) {
    const round = Number(dp.round);
    const prevOwner = Number(dp.previous_owner_id);
    const nextOwner = Number(dp.owner_id);
    const origOwner = Number(dp.roster_id);
    const pickNo = dp.pick_no ?? undefined;
    const isStartup = round > rookieDraftRounds;
    const baseLabel = formatPickAssetLabel(String(dp.season), round, pickNo);
    const label = isStartup ? `Startup ${baseLabel}` : `Rookie ${baseLabel}`;
    const value = approxPickValue(String(dp.season), round);

    if (prevOwner === userRosterId) {
      // User is giving this pick away
      iGivePicks.push({ season: String(dp.season), round, originalRosterId: origOwner, label, value, pickNo, isStartup });
    } else if (nextOwner === userRosterId) {
      // User is receiving this pick
      iGetPicks.push({ season: String(dp.season), round, originalRosterId: origOwner, label, value, pickNo, isStartup });
    }
    // Picks between two other parties (3-way trades) are intentionally ignored
  }

  // ── FAAB (waiver_budget) ───────────────────────────────────────────────────
  // Sleeper REST  → array of {sender, receiver, amount} objects
  // Sleeper GQL   → JSON-encoded string (same scalar treatment as draft_picks)
  //                 or array of "sender,receiver,amount" CSV strings
  let iGiveFaab = 0;
  let iGetFaab = 0;
  let rawWB: any = (t as any).waiver_budget;
  if (typeof rawWB === "string") {
    try { rawWB = JSON.parse(rawWB); } catch { rawWB = null; }
  }
  if (Array.isArray(rawWB)) {
    for (const entry of rawWB) {
      let sender: number, receiver: number, amount: number;
      if (typeof entry === "string") {
        const parts = entry.split(",");
        sender = Number(parts[0]); receiver = Number(parts[1]); amount = Number(parts[2]);
      } else if (entry && typeof entry === "object") {
        sender = Number(entry.sender); receiver = Number(entry.receiver); amount = Number(entry.amount);
      } else continue;
      if (!amount || isNaN(amount)) continue;
      if (sender === userRosterId) iGiveFaab += amount;
      else if (receiver === userRosterId) iGetFaab += amount;
    }
  }

  const iGiveValue = iGivePlayers.reduce((s, p) => s + p.value, 0) + iGivePicks.reduce((s, p) => s + p.value, 0);
  const iGetValue = iGetPlayers.reduce((s, p) => s + p.value, 0) + iGetPicks.reduce((s, p) => s + p.value, 0);
  const valueEdge = iGetValue - iGiveValue;

  const expiresAt = t.settings?.expires_at ? (t.settings.expires_at > 1e12 ? t.settings.expires_at : t.settings.expires_at * 1000) : null;
  const statusUpdated = t.status_updated || t.created;

  return {
    transactionId: t.transaction_id,
    leagueId,
    leagueName,
    leagueFormat,
    leagueAvatar,
    status: (t.status || "proposed") as TradeStatus,
    direction,
    partnerName,
    partnerAvatar,
    partnerRosterId,
    partnerUserId: partnerInfo?.ownerId ?? null,
    userRosterId,
    iGive: { players: iGivePlayers, picks: iGivePicks, faab: iGiveFaab },
    iGet: { players: iGetPlayers, picks: iGetPicks, faab: iGetFaab },
    iGiveValue,
    iGetValue,
    valueEdge,
    expiresAt,
    created: t.created,
    statusUpdated,
    rawConsenterIds: t.consenter_ids || [],
    rawRosterIds: t.roster_ids || [],
    creatorUserId: t.creator ?? null,
    leg: t.leg ?? 1,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPICard({ label, value, sub, icon: Icon, color, loading, onClick, active }: {
  label: string; value: number | string; sub?: string;
  icon: React.ElementType; color: string; loading?: boolean;
  onClick?: () => void; active?: boolean;
}) {
  return (
    <Card
      className={cn(
        "p-4 flex items-start gap-3 min-w-0 transition-all",
        onClick && "cursor-pointer hover:border-[#0b3a7a]/40 hover:shadow-md hover:shadow-[#0b3a7a]/5",
        active && "border-[#d4af37]/50 shadow-sm"
      )}
      onClick={onClick}
    >
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
            <p className={cn("text-[11px] font-medium leading-tight mt-0.5", active ? "text-[#d4af37]" : "text-muted-foreground")}>{label}</p>
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
    <div className={cn(
      "flex items-center gap-1.5 rounded-md px-2 py-1",
      pick.isStartup
        ? "bg-violet-500/10 dark:bg-violet-400/10"
        : "bg-purple-500/10 dark:bg-purple-400/10"
    )}>
      <span className={cn(
        "text-[10px] font-bold",
        pick.isStartup ? "text-violet-700 dark:text-violet-400" : "text-purple-700 dark:text-purple-400"
      )}>{pick.isStartup ? "STUP" : "ROOK"}</span>
      <span className="text-[11px] font-medium text-foreground">{pick.label}</span>
      {pick.value > 0 && <span className="text-[10px] text-muted-foreground ml-auto">{pick.value.toLocaleString()}</span>}
    </div>
  );
}

// ─── Date helper ──────────────────────────────────────────────────────────────

function formatTradeDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Player headshot (Sleeper CDN) ────────────────────────────────────────────

function PlayerHeadshot({ playerId, name }: { playerId: string; name: string }) {
  const [err, setErr] = useState(false);
  if (!err) {
    return (
      <img
        src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
        alt={name}
        className="w-8 h-8 rounded-full object-cover object-top flex-shrink-0 bg-muted ring-1 ring-border/30"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-[#0b3a7a]/15 dark:bg-blue-400/15 flex items-center justify-center text-[11px] font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0">
      {(name || "?").charAt(0)}
    </div>
  );
}

// ─── Player row for card layout ───────────────────────────────────────────────

function PlayerCardRow({ player, showValue }: { player: AssetPlayer; showValue?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <PlayerAvatar
        id={player.playerId}
        name={player.name}
        pos={player.pos}
        team={player.team}
        size="sm"
      />
      {showValue && (
        <span className="ml-auto text-sm font-semibold tabular-nums text-muted-foreground flex-shrink-0">
          {player.value.toFixed(1)}
        </span>
      )}
    </div>
  );
}

function PickCardRow({ pick, showValue }: { pick: AssetPick; showValue?: boolean }) {
  const isStartup = pick.isStartup;
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
        isStartup
          ? "bg-violet-500/15 dark:bg-violet-400/15"
          : "bg-purple-500/15 dark:bg-purple-400/15"
      )}>
        <span className={cn(
          "text-[9px] font-bold",
          isStartup ? "text-violet-700 dark:text-violet-400" : "text-purple-700 dark:text-purple-400"
        )}>{isStartup ? "SU" : `R${pick.round}`}</span>
      </div>
      <span className="text-sm font-medium text-foreground truncate">{pick.label}</span>
      {showValue && <span className="ml-auto text-sm font-semibold tabular-nums text-muted-foreground flex-shrink-0">{pick.value.toFixed(1)}</span>}
    </div>
  );
}

function FaabRow({ amount, showValue }: { amount: number; showValue?: boolean }) {
  if (!amount) return null;
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className="w-8 h-8 rounded-full bg-emerald-500/15 dark:bg-emerald-400/15 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">$</span>
      </div>
      <span className="text-sm font-medium text-foreground truncate">${amount} FAAB</span>
      {showValue && <span className="ml-auto text-sm font-semibold tabular-nums text-muted-foreground flex-shrink-0">—</span>}
    </div>
  );
}

// ─── Direction pill badge ─────────────────────────────────────────────────────

function DirectionPill({ direction, status }: { direction: NormalizedTrade["direction"]; status: TradeStatus }) {
  const base = "text-[11px] font-bold px-2.5 py-1 rounded-full border";
  if (status === "complete")
    return <span className={base} style={{ background: "rgba(34,197,94,.18)", color: "#4ade80", borderColor: "rgba(74,222,128,.35)" }}>Completed</span>;
  if (status === "rejected")
    return <span className={base} style={{ background: "rgba(239,68,68,.16)", color: "#f87171", borderColor: "rgba(248,113,113,.32)" }}>Rejected</span>;
  if (status === "failed" || status === "cancelled")
    return <span className={base} style={{ background: "rgba(148,163,184,.12)", color: "#94a3b8", borderColor: "rgba(148,163,184,.22)" }}>Cancelled</span>;
  if (direction === "incoming")
    return <span className={base} style={{ background: "rgba(212,175,55,.14)", color: "#facc15", borderColor: "rgba(250,204,21,.28)" }}>Incoming</span>;
  if (direction === "outgoing")
    return <span className={base} style={{ background: "rgba(59,130,246,.18)", color: "#60a5fa", borderColor: "rgba(96,165,250,.35)" }}>Outgoing</span>;
  return null;
}

function ValueEdgeCell({ edge }: { edge: number }) {
  if (Math.abs(edge) < 10) return <span className="text-xs text-muted-foreground">~Even</span>;
  const isGood = edge > 0;
  return (
    <div className={cn("flex items-center gap-0.5 text-xs font-bold", isGood ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {isGood ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isGood ? "+" : ""}{Math.round(edge).toLocaleString()}
    </div>
  );
}

// ─── Trade Card ───────────────────────────────────────────────────────────────

function TradeCard({ trade, myUsername, myAvatar, onView, onCounter, onMessage }: {
  trade: NormalizedTrade;
  myUsername: string;
  myAvatar: string | null;
  onView: () => void;
  onCounter?: () => void;
  onMessage?: () => void;
}) {
  const expiring = isExpiringSoon(trade.expiresAt);
  const isProposed = trade.status === "proposed";

  const sentByLabel = trade.direction === "outgoing"
    ? "Sent by You"
    : `Sent by ${trade.partnerName}`;

  const myReceives = { players: trade.iGet.players, picks: trade.iGet.picks, faab: trade.iGet.faab };
  const theyReceive = { players: trade.iGive.players, picks: trade.iGive.picks, faab: trade.iGive.faab };

  return (
    <div
      className={cn(
        "border border-border/50 rounded-xl bg-card hover:border-[#0b3a7a]/40 hover:shadow-md hover:shadow-[#0b3a7a]/5 transition-all cursor-pointer",
        expiring && isProposed && "border-amber-500/40"
      )}
      data-testid={`trade-row-${trade.transactionId}`}
      onClick={onView}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5 flex-wrap">
        <DirectionPill direction={trade.direction} status={trade.status} />

        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground truncate">
          {trade.leagueName}
        </span>

        <span className="text-muted-foreground text-xs">·</span>
        <span className="text-xs text-muted-foreground">{formatTradeDate(trade.created)}</span>
        <span className="text-muted-foreground text-xs">·</span>
        <span className="text-xs text-muted-foreground">{sentByLabel}</span>

        {expiring && isProposed && (
          <>
            <span className="text-muted-foreground text-xs">·</span>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3" /> Expires {formatExpiryLabel(trade.expiresAt)}
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {Math.abs(trade.valueEdge) >= 10 && (
            <div className="hidden sm:flex items-center">
              <ValueEdgeCell edge={trade.valueEdge} />
            </div>
          )}
        </div>
      </div>

      {/* ── Body: two-column receives layout ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/40 px-4 pb-3">

        {/* My side: I receive */}
        <div className="pb-3 sm:pb-0 sm:pr-6 pt-1">
          <div className="flex items-center gap-2 mb-2.5">
            <TeamAvatar name={myUsername} avatar={myAvatar} size="md" />
            <span className="text-sm font-bold text-foreground">{myUsername}</span>
            <span className="text-sm text-muted-foreground">receives</span>
          </div>
          <div className="space-y-0.5 pl-1">
            {myReceives.players.map((p) => <PlayerCardRow key={p.playerId} player={p} />)}
            {myReceives.picks.map((p, i) => <PickCardRow key={`${i}-${p.originalRosterId}-${p.label}`} pick={p} />)}
            <FaabRow amount={myReceives.faab} />
            {myReceives.players.length === 0 && myReceives.picks.length === 0 && !myReceives.faab && (
              <p className="text-sm text-muted-foreground italic pl-1">Nothing</p>
            )}
          </div>
        </div>

        {/* Partner side: they receive */}
        <div className="pt-3 sm:pt-1 sm:pl-6">
          <div className="flex items-center gap-2 mb-2.5">
            <TeamAvatar name={trade.partnerName} avatar={trade.partnerAvatar} size="md" />
            <span className="text-sm font-bold text-foreground">{trade.partnerName}</span>
            <span className="text-sm text-muted-foreground">receives</span>
          </div>
          <div className="space-y-0.5 pl-1">
            {theyReceive.players.map((p) => <PlayerCardRow key={p.playerId} player={p} />)}
            {theyReceive.picks.map((p, i) => <PickCardRow key={`${i}-${p.originalRosterId}-${p.label}`} pick={p} />)}
            <FaabRow amount={theyReceive.faab} />
            {theyReceive.players.length === 0 && theyReceive.picks.length === 0 && !theyReceive.faab && (
              <p className="text-sm text-muted-foreground italic pl-1">Nothing</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer: Quick action buttons ── */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-t border-border/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Review / View Details */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-3 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
          onClick={onView}
          data-testid={`btn-review-${trade.transactionId}`}
        >
          Review
        </Button>

        {/* Message */}
        {trade.partnerUserId && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
            onClick={onMessage}
            data-testid={`btn-message-${trade.transactionId}`}
          >
            <MessageSquare className="w-3 h-3" /> Message
          </Button>
        )}

        {/* Mode-specific actions */}
        {isProposed && trade.direction === "incoming" && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-3 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={onCounter}
              data-testid={`btn-counter-${trade.transactionId}`}
            >
              <ArrowRightLeft className="w-3 h-3" /> Counter
            </Button>
            <Button
              size="sm"
              className="h-7 px-3 text-[11px] ml-auto bg-emerald-600/80 hover:bg-emerald-600 text-white font-semibold"
              onClick={onView}
              data-testid={`btn-accept-quick-${trade.transactionId}`}
            >
              <CheckCircle2 className="w-3 h-3 mr-1" /> Accept
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const VIEWS: Array<{ id: TradeView; label: string; icon: React.ElementType }> = [
  { id: "pending",   label: "All Open",   icon: Clock        },
  { id: "incoming",  label: "Incoming",   icon: Inbox        },
  { id: "outgoing",  label: "Outgoing",   icon: Send         },
  { id: "completed", label: "Completed",  icon: CheckCircle2 },
  { id: "rejected",  label: "Rejected",   icon: XCircle      },
  { id: "cancelled", label: "Cancelled",  icon: XCircle      },
  { id: "activity",  label: "All Trades", icon: Activity     },
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
  const [pendingTradesAvailable, setPendingTradesAvailable] = useState(false);
  const [view, setView] = useState<TradeView>("pending");
  const [modalState, setModalState] = useState<{ trade: NormalizedTrade; mode: TradeModalMode } | null>(null);

  const fetchAllData = useCallback(async () => {
    if (!sleeper.isConnected || !sleeper.user) return;
    setLoading(true);
    setErrors([]);
    const playersDb: Record<string, any> = {};

    const leagueResults = await Promise.allSettled(
      sleeper.leagues.map(async (ls) => {
        const [{ txns, usedAuth }, rostersRaw, usersRaw, draftsRaw] = await Promise.all([
          fetchLeagueTradesForSync(ls.leagueId, hasSession),
          fetchJson<any[]>(`${SLEEPER_API}/league/${ls.leagueId}/rosters`),
          fetchJson<any[]>(`${SLEEPER_API}/league/${ls.leagueId}/users`),
          fetchJson<any[]>(`${SLEEPER_API}/league/${ls.leagueId}/drafts`).catch(() => [] as any[]),
        ]);

        // Determine rookie draft round count from the league's non-startup drafts.
        // Picks with round > rookieDraftRounds are labelled as Startup picks.
        let rookieDraftRounds = 5; // safe default
        if (Array.isArray(draftsRaw) && draftsRaw.length > 0) {
          const rookieDrafts = draftsRaw.filter((d: any) => {
            const type = (d.metadata?.type || d.type || "").toLowerCase();
            return type === "rookie" || (type !== "startup" && (d.settings?.rounds ?? 99) <= 6);
          });
          if (rookieDrafts.length > 0) {
            rookieDraftRounds = Math.max(...rookieDrafts.map((d: any) => d.settings?.rounds || 3));
          }
        }

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
          rookieDraftRounds,
          rosterMap,
          transactions: txns,
          _usedAuth: usedAuth,
        } as RawLeagueData & { _usedAuth: boolean };
      })
    );

    const successData: RawLeagueData[] = [];
    const newErrors: FetchError[] = [];
    let anyAuthSucceeded = false;

    for (let i = 0; i < leagueResults.length; i++) {
      const r = leagueResults[i];
      const ls = sleeper.leagues[i];
      if (r.status === "fulfilled") {
        const { _usedAuth, ...data } = r.value as RawLeagueData & { _usedAuth: boolean };
        if (_usedAuth) anyAuthSucceeded = true;
        successData.push(data);
      } else {
        const msg = (r.reason as any)?.message || "Failed to load";
        newErrors.push({ leagueId: ls.leagueId, leagueName: ls.name, message: msg });
      }
    }

    setPendingTradesAvailable(anyAuthSucceeded);
    setRawData(successData);
    setErrors(newErrors);
    setLoading(false);
  }, [sleeper.isConnected, sleeper.user, sleeper.leagues, hasSession]);

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
          sleeper.user!.userId,
          ld.rosterMap,
          {},
          valuesBySleeperId,
          ld.rookieDraftRounds
        );
        if (norm) all.push(norm);
      }
    }
    return all.sort((a, b) => (b.statusUpdated || b.created) - (a.statusUpdated || a.created));
  }, [rawData, valuesBySleeperId]);

  // ── Client-side status/direction helpers ─────────────────────────────────
  // Sleeper status strings (as returned by GraphQL with no status_filters):
  // "proposed"   — open offer awaiting response
  // "complete"   — accepted and processed
  // "rejected"   — declined by other party
  // "failed"     — system-level failure (treat as cancelled)
  // "cancelled"  — proposer withdrew the offer
  // direction is pre-classified in normalizeTrade using creator + consenter_ids
  const isOpen      = (t: NormalizedTrade) => t.status === "proposed";
  const isCancelled = (t: NormalizedTrade) => t.status === "failed" || t.status === "cancelled";

  const filteredTrades = useMemo(() => {
    let result = trades;
    switch (view) {
      case "pending":   return result.filter(isOpen);
      case "incoming":  return result.filter((t) => isOpen(t) && t.direction === "incoming");
      case "outgoing":  return result.filter((t) => isOpen(t) && t.direction === "outgoing");
      case "completed": return result.filter((t) => t.status === "complete");
      case "rejected":  return result.filter((t) => t.status === "rejected");
      case "cancelled": return result.filter(isCancelled);
      case "activity":  return result;
      default:          return result;
    }
  }, [trades, view]);

  const kpis = useMemo(() => {
    const open      = trades.filter(isOpen);
    const incoming  = open.filter((t) => t.direction === "incoming");
    const outgoing  = open.filter((t) => t.direction === "outgoing");
    const completed = trades.filter((t) => t.status === "complete");
    const rejected  = trades.filter((t) => t.status === "rejected");
    const cancelled = trades.filter(isCancelled);
    return {
      totalPending: open.length,
      incoming: incoming.length,
      outgoing: outgoing.length,
      completed: completed.length,
      rejected: rejected.length,
      cancelled: cancelled.length,
      allTrades: trades.length,
    };
  }, [trades]);

  const openModal = useCallback((trade: NormalizedTrade, mode: TradeModalMode) => {
    setModalState({ trade, mode });
  }, []);

  const closeModal = useCallback(() => {
    setModalState(null);
  }, []);

  const optimisticallyUpdateStatus = useCallback((transactionId: string, leagueId: string, status: string, extra?: Record<string, unknown>) => {
    setRawData((prev) =>
      prev.map((ld) =>
        ld.leagueId !== leagueId
          ? ld
          : {
              ...ld,
              transactions: ld.transactions.map((t) =>
                t.transaction_id === transactionId
                  ? { ...t, status, metadata: extra ? { ...(t.metadata ?? {}), ...extra } : t.metadata }
                  : t
              ),
            }
      )
    );
  }, []);

  const handleAccept = useCallback(async () => {
    const trade = modalState?.trade;
    if (!trade) return;
    await acceptTrade(trade.leagueId, trade.transactionId);
    optimisticallyUpdateStatus(trade.transactionId, trade.leagueId, "complete");
    toast({ title: "Trade accepted", description: "Check Sleeper to confirm the update." });
    closeModal();
    setTimeout(() => fetchAllData(), 2000);
  }, [modalState, optimisticallyUpdateStatus, toast, closeModal, fetchAllData]);

  const handleReject = useCallback(async () => {
    const trade = modalState?.trade;
    if (!trade) return;
    const result = await rejectTrade(trade.leagueId, trade.transactionId, trade.leg);
    const rejecterId = result?.metadata?.["rejecter_id"] as string | undefined;
    optimisticallyUpdateStatus(trade.transactionId, trade.leagueId, "rejected", rejecterId ? { rejecter_id: rejecterId } : undefined);
    toast({ title: trade.direction === "outgoing" ? "Offer cancelled" : "Trade rejected" });
    closeModal();
    setTimeout(() => fetchAllData(), 2000);
  }, [modalState, rejectTrade, optimisticallyUpdateStatus, toast, closeModal, fetchAllData]);

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
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KPICard label="Total Open"  value={kpis.totalPending} icon={ArrowRightLeft} color="bg-blue-500/10 text-blue-600 dark:text-blue-400"         loading={loading} onClick={() => setView("pending")}   active={view === "pending"}   />
        <KPICard label="Incoming"    value={kpis.incoming}     icon={Inbox}          color="bg-[#d4af37]/10 text-[#d4af37]"                            loading={loading} onClick={() => setView("incoming")}  active={view === "incoming"}  />
        <KPICard label="Outgoing"    value={kpis.outgoing}     icon={Send}           color="bg-blue-500/10 text-blue-500 dark:text-blue-400"           loading={loading} onClick={() => setView("outgoing")}  active={view === "outgoing"}  />
        <KPICard label="Completed"   value={kpis.completed}    icon={CheckCircle2}   color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"  loading={loading} onClick={() => setView("completed")} active={view === "completed"} />
        <KPICard label="Rejected"    value={kpis.rejected}     icon={XCircle}        color="bg-red-500/10 text-red-500 dark:text-red-400"              loading={loading} onClick={() => setView("rejected")}  active={view === "rejected"}  />
        <KPICard label="Cancelled"   value={kpis.cancelled}    icon={XCircle}        color="bg-slate-500/10 text-slate-400"                            loading={loading} onClick={() => setView("cancelled")} active={view === "cancelled"} />
        <KPICard label="All Trades"  value={kpis.allTrades}    icon={Activity}       color="bg-muted text-muted-foreground"                            loading={loading} onClick={() => setView("activity")}  active={view === "activity"}  />
      </div>

      {/* Auth banner — public REST fallback only shows completed history */}
      {!pendingTradesAvailable && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Connected Sleeper session required</span> to view pending incoming/outgoing trade offers. Sign in via <span className="font-semibold text-foreground">Waiver Command</span> to unlock. Completed trade history is shown below.
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
        <div className="space-y-3">
          {filteredTrades.map((trade) => {
            const mode: TradeModalMode =
              trade.status !== "proposed" ? "completed"
              : trade.direction === "incoming" ? "incoming"
              : "outgoing";
            return (
              <TradeCard
                key={trade.transactionId}
                trade={trade}
                myUsername={sleeper.user?.username ?? sleeper.user?.displayName ?? "Me"}
                myAvatar={sleeper.user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${sleeper.user.avatar}` : null}
                onView={() => openModal(trade, mode)}
                onCounter={() => openModal(trade, "counter")}
                onMessage={() => openModal(trade, mode)}
              />
            );
          })}
        </div>
      )}

      {/* Shared Trade Action Modal */}
      {modalState && (
        <TradeActionModal
          trade={modalState.trade}
          mode={modalState.mode}
          open
          onClose={closeModal}
          myUserId={sleeper.user?.userId ?? ""}
          myUsername={sleeper.user?.username ?? sleeper.user?.displayName ?? "Me"}
          myAvatar={sleeper.user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${sleeper.user.avatar}` : null}
          valuesBySleeperId={valuesBySleeperId}
          onAccept={handleAccept}
          onReject={handleReject}
          onCounterSent={() => { closeModal(); setTimeout(fetchAllData, 2000); }}
        />
      )}
    </div>
  );
}
