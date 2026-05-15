import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getSleeperSession } from "@/services/sleeperAuth";
import {
  fetchLeagueTransactionsFiltered, acceptTrade, rejectTrade,
  fetchDmMessages, sendDmMessage, proposeTrade,
} from "@/services/sleeperAuthedApi";
import type { SleeperTransaction, SleeperDmMessage, SleeperTransactionPick } from "@/services/sleeperAuthedApi";
import { Input } from "@/components/ui/input";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { getPositionColor } from "@/data/mockData";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import {
  ArrowRightLeft, TrendingUp, TrendingDown, RefreshCw, Loader2,
  Clock, AlertTriangle, X, ExternalLink, CheckCircle2,
  XCircle, ArrowRight, ArrowLeft, Inbox, Send,
  Lock, Activity, Share2, MessageSquare,
} from "lucide-react";

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

// ─── Types ────────────────────────────────────────────────────────────────────

type TradeView = "pending" | "incoming" | "outgoing" | "completed" | "rejected" | "cancelled" | "activity";
// Sleeper's actual status strings (proposed = open offer, not yet accepted)
type TradeStatus = "proposed" | "complete" | "rejected" | "failed" | "cancelled" | "counter_offered";

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
  pickNo?: number;
  isStartup?: boolean;
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
  iGive: { players: AssetPlayer[]; picks: AssetPick[]; faab: number };
  iGet: { players: AssetPlayer[]; picks: AssetPick[]; faab: number };
  iGiveValue: number;
  iGetValue: number;
  valueEdge: number;
  expiresAt: number | null;
  created: number;
  statusUpdated: number;
  rawConsenterIds: number[];
  rawRosterIds: number[];
  creatorUserId: string | null;
  partnerUserId: string | null;
  leg: number;
  rejecterId?: string;
}

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

function TradeCard({ trade, myUsername, myAvatar, onView }: {
  trade: NormalizedTrade;
  myUsername: string;
  myAvatar: string | null;
  onView: () => void;
}) {
  const expiring = isExpiringSoon(trade.expiresAt);
  const isProposed = trade.status === "proposed";

  const sentByLabel = trade.direction === "outgoing"
    ? "Sent by You"
    : trade.direction === "incoming"
      ? `Sent by ${trade.partnerName}`
      : `Sent by ${trade.partnerName}`;

  // User receives = iGet; Partner receives = iGive
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

        <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Value edge badge */}
          {Math.abs(trade.valueEdge) >= 10 && (
            <div className="hidden sm:flex items-center">
              <ValueEdgeCell edge={trade.valueEdge} />
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
            onClick={onView}
            data-testid={`btn-view-${trade.transactionId}`}
          >
            <Share2 className="w-3.5 h-3.5" /> Share
          </Button>
        </div>
      </div>

      {/* ── Body: two-column receives layout ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/40 px-4 pb-3.5">

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

    </div>
  );
}

// ─── Trade DM Attachment Card ─────────────────────────────────────────────────

function TradeDmAttachmentCard({ attachment }: { attachment: Record<string, unknown> }) {
  const adds = (attachment.adds as string[] | undefined) ?? [];
  const drops = (attachment.drops as string[] | undefined) ?? [];
  return (
    <div className="mt-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-1 font-semibold opacity-80">
        <ArrowRightLeft className="w-3 h-3" /> Trade Offer
      </div>
      {adds.length > 0 && <div><span className="font-medium">Gets:</span> {adds.join(", ")}</div>}
      {drops.length > 0 && <div><span className="font-medium">Gives:</span> {drops.join(", ")}</div>}
    </div>
  );
}

// ─── Negotiation Thread ───────────────────────────────────────────────────────

function NegotiationThread({
  partnerUserId,
  myUserId,
  partnerName,
}: {
  partnerUserId: string;
  myUserId: string;
  partnerName: string;
}) {
  const [dmId, setDmId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SleeperDmMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    let cancelled = false;
    setLoadingThread(true);
    setThreadError(null);
    setMessages([]);
    setDmId(null);

    (async () => {
      try {
        const { getDmByMembers } = await import("@/services/sleeperAuthedApi");
        const id = await getDmByMembers(partnerUserId);
        if (cancelled) return;
        if (!id) {
          setThreadError("No DM thread found with this manager.");
          setLoadingThread(false);
          return;
        }
        setDmId(id);
        const msgs = await fetchDmMessages(id);
        if (cancelled) return;
        setMessages([...msgs].sort((a, b) => a.created - b.created));
      } catch (err: any) {
        if (!cancelled) setThreadError(err.message || "Failed to load messages.");
      } finally {
        if (!cancelled) setLoadingThread(false);
      }
    })();

    return () => { cancelled = true; };
  }, [partnerUserId]);

  const handleSend = async () => {
    const msgText = text.trim();
    if (!msgText || !dmId || sending) return;
    setText("");
    setSending(true);
    const optimisticClientId = `opt-${Date.now()}`;
    const optimistic: SleeperDmMessage = {
      message_id: optimisticClientId,
      parent_id: dmId,
      parent_type: "dm",
      author_id: myUserId,
      author_display_name: "You",
      author_avatar: null,
      author_real_name: null,
      author_is_bot: false,
      author_role_id: null,
      text: msgText,
      text_map: null,
      attachment: null,
      created: Date.now(),
      edited: null,
      pinned: false,
      reactions: null,
      user_reactions: null,
      client_id: optimisticClientId,
      _optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const sent = await sendDmMessage(dmId, msgText);
      setMessages((prev) =>
        prev.map((m) => (m.client_id === optimisticClientId ? { ...sent, _optimistic: false } : m))
      );
    } catch {
      setMessages((prev) => prev.filter((m) => m.client_id !== optimisticClientId));
      setText(msgText);
    } finally {
      setSending(false);
    }
  };

  const formatMsgTime = (ts: number) =>
    new Date(ts).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });

  return (
    <div className="border-t border-border/40 pt-4 space-y-3" data-testid="negotiation-thread">
      <h4 className="text-sm font-bold flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-[#d4af37]" />
        Negotiation Thread
      </h4>

      {loadingThread ? (
        <div className="space-y-2 py-1">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-10 w-1/2 ml-auto" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : threadError ? (
        <p className="text-xs text-muted-foreground italic py-2">{threadError}</p>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="max-h-56 overflow-y-auto space-y-3 pr-0.5"
            data-testid="thread-messages"
          >
            {messages.length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-4">
                No messages yet — start the conversation below.
              </p>
            ) : (
              messages.map((msg) => {
                const isMe = msg.author_id === myUserId;
                return (
                  <div
                    key={msg.message_id}
                    className={cn(
                      "flex flex-col gap-0.5 max-w-[82%]",
                      isMe ? "ml-auto items-end" : "items-start"
                    )}
                  >
                    {!isMe && (
                      <span className="text-[10px] text-muted-foreground font-medium px-1">
                        {msg.author_display_name || partnerName}
                      </span>
                    )}
                    <div
                      className={cn(
                        "rounded-2xl px-3 py-2 text-sm leading-snug break-words",
                        isMe
                          ? "bg-[#0b3a7a] text-white rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm",
                        msg._optimistic && "opacity-60"
                      )}
                    >
                      {msg.text && <p>{msg.text}</p>}
                      {msg.attachment?.type === "trade_dm" && (
                        <TradeDmAttachmentCard
                          attachment={msg.attachment as Record<string, unknown>}
                        />
                      )}
                    </div>
                    <span className="text-[9px] text-muted-foreground/60 px-1">
                      {formatMsgTime(msg.created)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex gap-2 pt-1" data-testid="thread-compose">
            <textarea
              className="flex-1 resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50 focus:border-[#d4af37]/60 min-h-[38px] max-h-[100px]"
              placeholder={`Message ${partnerName}…`}
              value={text}
              rows={1}
              disabled={sending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              data-testid="input-negotiation-message"
            />
            <Button
              size="sm"
              className="h-9 w-9 p-0 bg-[#0b3a7a] hover:bg-[#0b3a7a]/80 text-white flex-shrink-0 self-end"
              onClick={handleSend}
              disabled={!text.trim() || sending}
              data-testid="btn-send-negotiation-message"
            >
              {sending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Send className="w-3.5 h-3.5" />
              }
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Trade Dialog (centered modal) ────────────────────────────────────────────

function TradeDialog({ trade, open, onClose, onAccept, onReject, onCounter, actionLoading, myUsername, myAvatar, myUserId }: {
  trade: NormalizedTrade | null;
  open: boolean;
  onClose: () => void;
  onAccept: (t: NormalizedTrade) => void;
  onReject: (t: NormalizedTrade) => void;
  onCounter: (t: NormalizedTrade) => void;
  actionLoading: boolean;
  myUsername: string;
  myAvatar: string | null;
  myUserId: string;
}) {
  if (!trade) return null;

  const myTotal    = trade.iGetValue;
  const theirTotal = trade.iGiveValue;
  const combined   = myTotal + theirTotal || 1;
  const myPct      = Math.round((myTotal / combined) * 100);
  const diff       = myTotal - theirTotal;
  const favors     = Math.abs(diff) < 5 ? null : diff > 0 ? myUsername : trade.partnerName;
  const isProposed = trade.status === "proposed";
  const expiring   = isExpiringSoon(trade.expiresAt);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden" data-testid={`trade-dialog-${trade.transactionId}`}>

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border/40 space-y-0.5">
          <DialogTitle className="text-lg font-bold leading-tight">Trade Offer</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {formatTradeDate(trade.created)} · {trade.leagueName}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-5 space-y-5 overflow-y-auto max-h-[70vh]">

          {/* Two-column receives */}
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">

            {/* My side */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <TeamAvatar name={myUsername} avatar={myAvatar} size="md" />
                <div className="min-w-0">
                  <span className="text-sm font-bold truncate block">{myUsername}</span>
                  <span className="text-[11px] text-muted-foreground">receives</span>
                </div>
                <span className="ml-auto text-sm font-bold tabular-nums flex-shrink-0">{myTotal.toFixed(1)}</span>
              </div>
              <div className="space-y-1">
                {trade.iGet.players.map((p) => <PlayerCardRow key={p.playerId} player={p} showValue />)}
                {trade.iGet.picks.map((p, i)   => <PickCardRow key={`${i}-${p.originalRosterId}-${p.label}`} pick={p} showValue />)}
                <FaabRow amount={trade.iGet.faab} showValue />
                {trade.iGet.players.length === 0 && trade.iGet.picks.length === 0 && !trade.iGet.faab && (
                  <p className="text-sm text-muted-foreground italic pl-1">Nothing</p>
                )}
              </div>
            </div>

            {/* Their side */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <TeamAvatar name={trade.partnerName} avatar={trade.partnerAvatar} size="md" />
                <div className="min-w-0">
                  <span className="text-sm font-bold truncate block">{trade.partnerName}</span>
                  <span className="text-[11px] text-muted-foreground">receives</span>
                </div>
                <span className="ml-auto text-sm font-bold tabular-nums flex-shrink-0">{theirTotal.toFixed(1)}</span>
              </div>
              <div className="space-y-1">
                {trade.iGive.players.map((p) => <PlayerCardRow key={p.playerId} player={p} showValue />)}
                {trade.iGive.picks.map((p, i)   => <PickCardRow key={`${i}-${p.originalRosterId}-${p.label}`} pick={p} showValue />)}
                <FaabRow amount={trade.iGive.faab} showValue />
                {trade.iGive.players.length === 0 && trade.iGive.picks.length === 0 && !trade.iGive.faab && (
                  <p className="text-sm text-muted-foreground italic pl-1">Nothing</p>
                )}
              </div>
            </div>
          </div>

          {/* Value bar */}
          <div>
            <div className="flex h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500 transition-all" style={{ width: `${myPct}%` }} />
              <div className="bg-red-500 transition-all"     style={{ width: `${100 - myPct}%` }} />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-xs">
              <span className="text-muted-foreground">{myTotal.toFixed(1)} vs {theirTotal.toFixed(1)}</span>
              {favors ? (
                <span className={diff > 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
                  {Math.abs(diff).toFixed(1)} — Favors {favors}
                </span>
              ) : (
                <span className="text-muted-foreground">~Even</span>
              )}
            </div>
          </div>

          {/* Expiry warning */}
          {trade.expiresAt && isProposed && expiring && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Expiring {formatExpiryLabel(trade.expiresAt)}</span>
            </div>
          )}

          {/* Action buttons */}
          {isProposed ? (
            <div className="space-y-2">
              {trade.direction === "incoming" && (
                <Button
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white gap-2 text-sm font-semibold"
                  onClick={() => onAccept(trade)}
                  disabled={actionLoading}
                  data-testid={`dialog-btn-accept-${trade.transactionId}`}
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Accept
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full h-11 gap-2 text-sm font-semibold"
                onClick={() => { onClose(); onCounter(trade); }}
                disabled={actionLoading}
                data-testid={`dialog-btn-counter-${trade.transactionId}`}
              >
                <ArrowRightLeft className="w-4 h-4" /> Counter
              </Button>
              <Button
                variant="outline"
                className="w-full h-11 gap-2 text-sm font-semibold hover:border-red-400/50 hover:text-red-400"
                onClick={() => onReject(trade)}
                disabled={actionLoading}
                data-testid={`dialog-btn-reject-${trade.transactionId}`}
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                {trade.direction === "incoming" ? "Reject" : "Cancel Offer"}
              </Button>
            </div>
          ) : (
            <Button asChild variant="outline" className="w-full h-10 gap-2 text-xs">
              <a href={`https://sleeper.com/leagues/${trade.leagueId}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" /> Open in Sleeper
              </a>
            </Button>
          )}

          {/* Negotiation Thread */}
          {trade.partnerUserId && myUserId && (
            <NegotiationThread
              partnerUserId={trade.partnerUserId}
              myUserId={myUserId}
              partnerName={trade.partnerName}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Counter Modal ─────────────────────────────────────────────────────────────

function CounterModal({ trade, myUserId, valuesBySleeperId, onClose, onSubmitted }: {
  trade: NormalizedTrade;
  myUserId: string;
  valuesBySleeperId: Record<string, number>;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [myRosterPlayers, setMyRosterPlayers] = useState<AssetPlayer[]>([]);

  const [theyOffer, setTheyOffer] = useState<AssetPlayer[]>(() => [...trade.iGet.players]);
  const [iOffer, setIOffer] = useState<AssetPlayer[]>(() => [...trade.iGive.players]);
  const [theyOfferPicks, setTheyOfferPicks] = useState<AssetPick[]>(() => [...trade.iGet.picks]);
  const [iOfferPicks, setIOfferPicks] = useState<AssetPick[]>(() => [...trade.iGive.picks]);

  const [playerSearch, setPlayerSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rostersRaw, playersDb] = await Promise.all([
          fetchJson<any[]>(`${SLEEPER_API}/league/${trade.leagueId}/rosters`),
          getSleeperPlayers(),
        ]);
        if (cancelled) return;
        const userRoster = rostersRaw.find((r: any) => r.owner_id === myUserId);
        const playerIds: string[] = userRoster?.players || [];
        const enriched: AssetPlayer[] = playerIds
          .map((pid) => {
            const info = playersDb[pid];
            if (!info) return null;
            const name = info.full_name || `${info.first_name || ""} ${info.last_name || ""}`.trim();
            if (!name) return null;
            return { playerId: pid, name, pos: info.position || "?", team: info.team || "FA", value: valuesBySleeperId[pid] || 0 };
          })
          .filter(Boolean) as AssetPlayer[];
        setMyRosterPlayers(enriched.sort((a, b) => b.value - a.value));
      } catch {}
      if (!cancelled) setLoadingRoster(false);
    })();
    return () => { cancelled = true; };
  }, [trade.leagueId, myUserId, valuesBySleeperId]);

  const iOfferIds = new Set(iOffer.map((p) => p.playerId));

  const searchResults = playerSearch.trim().length >= 2
    ? myRosterPlayers.filter(
        (p) => p.name.toLowerCase().includes(playerSearch.toLowerCase()) && !iOfferIds.has(p.playerId)
      ).slice(0, 8)
    : [];

  const counterIGetValue = theyOffer.reduce((s, p) => s + p.value, 0) + theyOfferPicks.reduce((s, p) => s + p.value, 0);
  const counterIGiveValue = iOffer.reduce((s, p) => s + p.value, 0) + iOfferPicks.reduce((s, p) => s + p.value, 0);
  const counterDiff = counterIGetValue - counterIGiveValue;

  async function handleSubmit() {
    if (iOffer.length === 0 && iOfferPicks.length === 0 && theyOffer.length === 0 && theyOfferPicks.length === 0) return;
    setSubmitting(true);
    try {
      const adds: Record<string, number> = {};
      const drops: Record<string, number> = {};
      for (const p of theyOffer) {
        adds[p.playerId] = trade.userRosterId;
        drops[p.playerId] = trade.partnerRosterId;
      }
      for (const p of iOffer) {
        adds[p.playerId] = trade.partnerRosterId;
        drops[p.playerId] = trade.userRosterId;
      }
      const draftPicks: SleeperTransactionPick[] = [
        ...theyOfferPicks.map((p) => ({
          roster_id: p.originalRosterId,
          season: p.season,
          round: p.round,
          owner_id: trade.userRosterId,
          previous_owner_id: trade.partnerRosterId,
        })),
        ...iOfferPicks.map((p) => ({
          roster_id: p.originalRosterId,
          season: p.season,
          round: p.round,
          owner_id: trade.partnerRosterId,
          previous_owner_id: trade.userRosterId,
        })),
      ];
      const expiresAt = Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);
      await proposeTrade({
        leagueId: trade.leagueId,
        adds,
        drops,
        draftPicks,
        expiresAt,
        rejectTransactionId: trade.transactionId,
        rejectTransactionLeg: trade.leg,
      });
      setResult({ success: true, message: "Counter offer sent! The existing offer has been rejected." });
      toast({ title: "Counter sent", description: `Your counter offer to ${trade.partnerName} was submitted.` });
      setTimeout(onSubmitted, 1500);
    } catch (err: any) {
      const msg = err?.message || "Failed to send counter offer.";
      setResult({ success: false, message: `${msg}. You can also counter directly on Sleeper.com.` });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !submitting) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden" data-testid="counter-modal">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border/40 space-y-0.5">
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-[#d4af37]" />
            Counter Offer
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Countering {trade.partnerName} · {trade.leagueName}. The existing offer will be rejected automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-5 space-y-5 overflow-y-auto max-h-[65vh]">
          {result ? (
            <div className={cn("flex items-start gap-2 p-4 rounded-lg text-sm font-medium", result.success ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-500")}>
              {result.success ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {result.message}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                {/* You receive */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">You receive</p>
                  <div className="space-y-1 min-h-[60px] p-3 rounded-lg bg-muted/30 border border-border/40">
                    {theyOffer.length === 0 && theyOfferPicks.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">Nothing</p>
                    )}
                    {theyOffer.map((p) => (
                      <div key={p.playerId} className="flex items-center gap-2 group">
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", getPositionColor(p.pos))}>{p.pos}</span>
                        <span className="text-sm flex-1 truncate">{p.name}</span>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                          onClick={() => setTheyOffer((prev) => prev.filter((x) => x.playerId !== p.playerId))}
                          data-testid={`counter-remove-receive-${p.playerId}`}
                        ><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    {theyOfferPicks.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 group">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">PICK</span>
                        <span className="text-xs flex-1 truncate">{p.label}</span>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                          onClick={() => setTheyOfferPicks((prev) => prev.filter((_, j) => j !== i))}
                          data-testid={`counter-remove-receive-pick-${i}`}
                        ><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground/60 pt-1">{counterIGetValue.toFixed(0)} pts</p>
                  </div>
                </div>

                {/* You give */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">You give</p>
                  <div className="space-y-1 min-h-[60px] p-3 rounded-lg bg-muted/30 border border-border/40">
                    {iOffer.length === 0 && iOfferPicks.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">Nothing</p>
                    )}
                    {iOffer.map((p) => (
                      <div key={p.playerId} className="flex items-center gap-2 group">
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", getPositionColor(p.pos))}>{p.pos}</span>
                        <span className="text-sm flex-1 truncate">{p.name}</span>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                          onClick={() => setIOffer((prev) => prev.filter((x) => x.playerId !== p.playerId))}
                          data-testid={`counter-remove-give-${p.playerId}`}
                        ><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    {iOfferPicks.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 group">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">PICK</span>
                        <span className="text-xs flex-1 truncate">{p.label}</span>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                          onClick={() => setIOfferPicks((prev) => prev.filter((_, j) => j !== i))}
                          data-testid={`counter-remove-give-pick-${i}`}
                        ><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground/60 pt-1">{counterIGiveValue.toFixed(0)} pts</p>
                  </div>

                  {/* Add player from roster */}
                  <div className="mt-3 relative">
                    <Input
                      placeholder={loadingRoster ? "Loading roster…" : "Add player from your roster…"}
                      value={playerSearch}
                      onChange={(e) => setPlayerSearch(e.target.value)}
                      disabled={loadingRoster}
                      className="h-8 text-xs"
                      data-testid="counter-player-search"
                    />
                    {searchResults.length > 0 && (
                      <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                        {searchResults.map((p) => (
                          <button
                            key={p.playerId}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60 text-left"
                            onClick={() => { setIOffer((prev) => [...prev, p]); setPlayerSearch(""); }}
                            data-testid={`counter-add-player-${p.playerId}`}
                          >
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0", getPositionColor(p.pos))}>{p.pos}</span>
                            <span className="flex-1 truncate">{p.name}</span>
                            <span className="text-xs text-muted-foreground">{p.value.toFixed(0)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Value summary */}
              <div className="flex items-center justify-between text-sm px-1">
                <span className="text-muted-foreground">Value: {counterIGetValue.toFixed(0)} vs {counterIGiveValue.toFixed(0)}</span>
                {Math.abs(counterDiff) >= 5 ? (
                  <span className={counterDiff > 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
                    {Math.abs(counterDiff).toFixed(0)} — Favors {counterDiff > 0 ? "You" : trade.partnerName}
                  </span>
                ) : (
                  <span className="text-muted-foreground">~Even</span>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="px-5 pb-5 pt-0 gap-2">
          {result ? (
            <Button variant="outline" onClick={onClose} data-testid="counter-close">Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting} data-testid="counter-cancel">Cancel</Button>
              <Button
                className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/80 text-white gap-2"
                onClick={handleSubmit}
                disabled={submitting || (iOffer.length === 0 && iOfferPicks.length === 0 && theyOffer.length === 0 && theyOfferPicks.length === 0)}
                data-testid="counter-submit"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                Send Counter
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                    <p><span className="font-semibold">You give:</span> {[...trade.iGive.players.map(p => p.name), ...trade.iGive.picks.map(p => p.label), ...(trade.iGive.faab ? [`$${trade.iGive.faab} FAAB`] : [])].join(", ") || "Nothing"}</p>
                    <p><span className="font-semibold">You get:</span> {[...trade.iGet.players.map(p => p.name), ...trade.iGet.picks.map(p => p.label), ...(trade.iGet.faab ? [`$${trade.iGet.faab} FAAB`] : [])].join(", ") || "Nothing"}</p>
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
  const [selectedTrade, setSelectedTrade] = useState<NormalizedTrade | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{ trade: NormalizedTrade; action: "accept" | "reject" } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [confirmResult, setConfirmResult] = useState<{ success: boolean; message: string } | null>(null);
  const [counterTrade, setCounterTrade] = useState<NormalizedTrade | null>(null);

  const fetchAllData = useCallback(async () => {
    if (!sleeper.isConnected || !sleeper.user) return;
    setLoading(true);
    setErrors([]);
    let playersDb: Record<string, any> = {};
    try { playersDb = await getSleeperPlayers(); } catch {}

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

  const handleCounterClick = useCallback((trade: NormalizedTrade) => {
    setCounterTrade(trade);
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
          {filteredTrades.map((trade) => (
            <TradeCard
              key={trade.transactionId}
              trade={trade}
              myUsername={sleeper.user?.username ?? sleeper.user?.displayName ?? "Me"}
              myAvatar={sleeper.user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${sleeper.user.avatar}` : null}
              onView={() => handleView(trade)}
            />
          ))}
        </div>
      )}

      {/* Trade Dialog */}
      <TradeDialog
        trade={selectedTrade}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTrade(null); }}
        onAccept={handleAcceptClick}
        onReject={handleRejectClick}
        onCounter={handleCounterClick}
        actionLoading={actionLoading === selectedTrade?.transactionId}
        myUsername={sleeper.user?.username ?? sleeper.user?.displayName ?? "Me"}
        myAvatar={sleeper.user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${sleeper.user.avatar}` : null}
        myUserId={sleeper.user?.userId ?? ""}
      />

      {/* Counter Modal */}
      {counterTrade && (
        <CounterModal
          trade={counterTrade}
          myUserId={sleeper.user?.userId ?? ""}
          valuesBySleeperId={valuesBySleeperId}
          onClose={() => setCounterTrade(null)}
          onSubmitted={() => { setCounterTrade(null); setTimeout(fetchAllData, 1500); }}
        />
      )}

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
