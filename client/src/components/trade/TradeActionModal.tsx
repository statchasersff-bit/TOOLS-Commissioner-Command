import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Send, Loader2, ArrowRightLeft, CheckCircle2, XCircle,
  AlertTriangle, ExternalLink, Pencil, X,
} from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import {
  getDmByMembersFull, markDmRead, fetchDmMessages, sendDmMessage,
  sendTradeMessage, sendPlainDm,
  acceptTrade, rejectTrade, proposeTrade,
  buildTradeAttachment, makeTradeAttachmentUser,
  firePostTradeLinkDm,
} from "@/services/sleeperAuthedApi";
import { isGeneralMessagingEnabled } from "@/services/sleeperSafetyGate";
import type { SleeperDmMessage, SleeperTransactionPick, ProposeTradeResult } from "@/services/sleeperAuthedApi";
import { TradeEditTab, type EditAssetsWithFaab } from "./TradeEditTab";

// ─── Exported Types ───────────────────────────────────────────────────────────

export interface AssetPlayer {
  playerId: string;
  name: string;
  pos: string;
  team: string;
  value: number;
}

export interface AssetPick {
  season: string;
  round: number;
  originalRosterId: number;
  label: string;
  value: number;
  pickNo?: number;
  isStartup?: boolean;
}

export type TradeStatus =
  | "proposed" | "complete" | "rejected" | "failed" | "cancelled" | "counter_offered";

export interface NormalizedTrade {
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
  partnerUserId: string | null;
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
  leg: number;
  rejecterId?: string;
}

export type TradeModalMode = "incoming" | "outgoing" | "counter" | "completed" | "resend";

export interface TradeActionModalProps {
  open: boolean;
  onClose: () => void;
  mode: TradeModalMode;
  trade: NormalizedTrade;
  myUserId: string;
  myUsername: string;
  myAvatar: string | null;
  valuesBySleeperId: Record<string, number>;
  onAccept?: () => Promise<void>;
  onReject?: () => Promise<void>;
  onWithdraw?: () => Promise<void>;
  onCounterSent?: () => void;
  onRefresh?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a Sleeper-compatible trade-card payload from a ProposeTradeResult.
 * Every list field is an array (never undefined), `user` is never null, and
 * `status` is always set. This prevents `TypeError: r.map is not a function`
 * in Sleeper's desktop renderer.
 */
function buildCounterTradeAttachment(args: {
  result: ProposeTradeResult;
  leagueId: string;
  myUserId: string;
  myUsername: string;
  myRosterId: number;
  partnerUserId: string;
  partnerName: string;
  partnerRosterId: number;
}): { transactionsByRoster: Record<string, unknown>; usersInLeagueMap: Record<string, unknown> } {
  const { result, leagueId, myUserId, myUsername, myRosterId, partnerUserId, partnerName, partnerRosterId } = args;
  const playerMap = (result.player_map as Record<string, unknown> | null) ?? {};

  const rosterAdds: Record<string, unknown[]> = {};
  const rosterDrops: Record<string, unknown[]> = {};
  for (const [pid, rid] of Object.entries(result.adds ?? {})) {
    const r = String(rid);
    if (!rosterAdds[r]) rosterAdds[r] = [];
    rosterAdds[r].push(playerMap[pid] ?? { player_id: pid });
  }
  for (const [pid, rid] of Object.entries(result.drops ?? {})) {
    const r = String(rid);
    if (!rosterDrops[r]) rosterDrops[r] = [];
    rosterDrops[r].push(playerMap[pid] ?? { player_id: pid });
  }

  const rosterAddedPicks: Record<string, unknown[]> = {};
  if (Array.isArray(result.draft_picks)) {
    for (const pick of result.draft_picks) {
      if (typeof pick === "string") {
        const parts = pick.split(",");
        const r = String(Number(parts[3]));
        if (!rosterAddedPicks[r]) rosterAddedPicks[r] = [];
        rosterAddedPicks[r].push({
          roster_id: Number(parts[0]),
          season: parts[1],
          round: Number(parts[2]),
          owner_id: Number(parts[3]),
          previous_owner_id: Number(parts[4]),
        });
      } else if (pick && typeof pick === "object") {
        const obj = pick as Record<string, unknown>;
        const r = String(Number(obj.owner_id));
        if (!rosterAddedPicks[r]) rosterAddedPicks[r] = [];
        rosterAddedPicks[r].push(obj);
      }
    }
  }

  const involvedRids = new Set<number>([
    ...Object.values(result.adds ?? {}).map(Number),
    ...Object.values(result.drops ?? {}).map(Number),
    myRosterId,
    partnerRosterId,
  ]);

  const userForRid = (rid: number) => {
    if (rid === myRosterId) return makeTradeAttachmentUser(myUserId, myUsername, leagueId);
    if (rid === partnerRosterId) return makeTradeAttachmentUser(partnerUserId, partnerName, leagueId);
    return makeTradeAttachmentUser("", `Roster ${rid}`, leagueId);
  };

  const rosters = Array.from(involvedRids)
    .filter(rid => Number.isFinite(rid))
    .map(rid => ({
      rosterId: rid,
      user: userForRid(rid),
      adds: rosterAdds[String(rid)] ?? [],
      drops: rosterDrops[String(rid)] ?? [],
      added_picks: rosterAddedPicks[String(rid)] ?? [],
      dropped_picks: [],
      added_budget: [],
      dropped_budget: [],
    }));

  return buildTradeAttachment({
    status: result.status || "proposed",
    rosters,
    users: [
      makeTradeAttachmentUser(myUserId, myUsername, leagueId),
      makeTradeAttachmentUser(partnerUserId, partnerName, leagueId),
    ],
  });
}

function formatExpiryLabel(ts: number | null): string {
  if (!ts) return "—";
  const ms = ts - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "< 1h";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── ManagerAvatar ────────────────────────────────────────────────────────────

function ManagerAvatar({ name, avatar, sz = 7 }: { name: string; avatar: string | null; sz?: number }) {
  const [err, setErr] = useState(false);
  const initial = (name || "?").charAt(0).toUpperCase();
  const cls = `w-${sz} h-${sz}`;
  if (avatar && !err) {
    const src = avatar.startsWith("http")
      ? avatar
      : `https://sleepercdn.com/avatars/thumbs/${avatar}`;
    return (
      <img
        src={src} alt={name}
        className={cn(cls, "rounded-full object-cover flex-shrink-0 ring-1 ring-white/10")}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className={cn(cls, "rounded-full bg-[#0b3a7a]/50 flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white/60 ring-1 ring-white/[0.06]")}>
      {initial}
    </div>
  );
}

// ─── Asset Rows ───────────────────────────────────────────────────────────────

function PlayerAssetRow({ player, onRemove }: { player: AssetPlayer; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 py-0.5 group">
      <PlayerAvatar id={player.playerId} name={player.name} pos={player.pos} team={player.team} size="sm" compact />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-white/90 leading-tight truncate">{player.name}</p>
        <p className="text-[10px] font-bold uppercase">
          <span className={posText(player.pos)}>{player.pos}</span>
          {player.team && player.team !== "FA" && (
            <span className="text-muted-foreground/60"> · {player.team}</span>
          )}
        </p>
      </div>
      {player.value > 0 && (
        <span className="text-[11px] text-white/30 tabular-nums flex-shrink-0">
          {player.value.toLocaleString()}
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all flex-shrink-0 ml-0.5"
          aria-label="Remove"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function PickAssetRow({ pick, onRemove }: { pick: AssetPick; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 py-0.5 group">
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold",
        pick.isStartup
          ? "bg-violet-500/20 text-violet-400"
          : "bg-purple-500/20 text-purple-400"
      )}>
        {pick.isStartup ? "SU" : `R${pick.round}`}
      </div>
      <span className="text-[13px] text-white/85 flex-1 truncate">{pick.label}</span>
      {pick.value > 0 && (
        <span className="text-[11px] text-white/30 tabular-nums flex-shrink-0">
          {pick.value.toLocaleString()}
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all flex-shrink-0 ml-0.5"
          aria-label="Remove"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function FaabAssetRow({ amount }: { amount: number }) {
  if (!amount) return null;
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-emerald-400">
        $
      </div>
      <span className="text-[13px] text-white/85">${amount} FAAB</span>
    </div>
  );
}

function EmptyAssets() {
  return <p className="text-[12px] text-white/25 italic py-1">Nothing</p>;
}

function posText(pos: string): string {
  switch (pos) {
    case "QB": return "text-red-400";
    case "RB": return "text-emerald-400";
    case "WR": return "text-blue-400";
    case "TE": return "text-yellow-400";
    default: return "text-white/40";
  }
}

// ─── TradeDmCard ─────────────────────────────────────────────────────────────

function TradeDmCard() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.10] text-[12px] text-white/50 italic">
      <ArrowRightLeft className="w-3.5 h-3.5 text-[#d4af37]/60 flex-shrink-0" />
      Trade offer attached
    </div>
  );
}

// ─── TradeValueBar ────────────────────────────────────────────────────────────

function TradeValueBar({
  myValue, theirValue, myName, theirName,
}: { myValue: number; theirValue: number; myName: string; theirName: string }) {
  const total = (myValue + theirValue) || 1;
  const myPct = Math.round((myValue / total) * 100);
  const diff = myValue - theirValue;
  const even = Math.abs(diff) < 10;
  return (
    <div className="px-3 sm:px-6 py-3 border-t border-white/[0.06] flex-shrink-0">
      <div className="flex h-1.5 rounded-full overflow-hidden mb-1.5">
        <div className="bg-emerald-500 transition-all" style={{ width: `${myPct}%` }} />
        <div className="bg-red-500/60 transition-all" style={{ width: `${100 - myPct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/30">{myValue.toFixed(0)} vs {theirValue.toFixed(0)}</span>
        {even ? (
          <span className="text-white/30">~Even</span>
        ) : (
          <span className={diff > 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
            {Math.abs(diff).toFixed(0)} · Favors {diff > 0 ? myName : theirName}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── ReviewPanel ─────────────────────────────────────────────────────────────

function ReviewPanel({
  trade, myUsername, myAvatar,
}: { trade: NormalizedTrade; myUsername: string; myAvatar: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 px-3 sm:px-6 py-3 sm:py-4 overflow-y-auto flex-1 min-h-0">
      {/* You receive */}
      <div className="bg-white/[0.025] border border-white/[0.08] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ManagerAvatar name={myUsername} avatar={myAvatar} sz={7} />
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-white/90 leading-tight truncate">{myUsername}</p>
            <p className="text-[10px] text-white/40">receives</p>
          </div>
          {trade.iGetValue > 0 && (
            <span className="ml-auto text-[12px] font-bold tabular-nums text-[#d4af37]/70 flex-shrink-0">
              {trade.iGetValue.toFixed(0)}
            </span>
          )}
        </div>
        <div className="space-y-0.5">
          {trade.iGet.players.map((p) => <PlayerAssetRow key={p.playerId} player={p} />)}
          {trade.iGet.picks.map((p, i) => <PickAssetRow key={i} pick={p} />)}
          <FaabAssetRow amount={trade.iGet.faab} />
          {trade.iGet.players.length === 0 && trade.iGet.picks.length === 0 && !trade.iGet.faab && <EmptyAssets />}
        </div>
      </div>

      {/* Partner receives */}
      <div className="bg-white/[0.025] border border-white/[0.08] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ManagerAvatar name={trade.partnerName} avatar={trade.partnerAvatar} sz={7} />
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-white/90 leading-tight truncate">{trade.partnerName}</p>
            <p className="text-[10px] text-white/40">receives</p>
          </div>
          {trade.iGiveValue > 0 && (
            <span className="ml-auto text-[12px] font-bold tabular-nums text-[#d4af37]/70 flex-shrink-0">
              {trade.iGiveValue.toFixed(0)}
            </span>
          )}
        </div>
        <div className="space-y-0.5">
          {trade.iGive.players.map((p) => <PlayerAssetRow key={p.playerId} player={p} />)}
          {trade.iGive.picks.map((p, i) => <PickAssetRow key={i} pick={p} />)}
          <FaabAssetRow amount={trade.iGive.faab} />
          {trade.iGive.players.length === 0 && trade.iGive.picks.length === 0 && !trade.iGive.faab && <EmptyAssets />}
        </div>
      </div>
    </div>
  );
}

// ─── MessagesPanel ────────────────────────────────────────────────────────────

function MessagesPanel({
  trade, myUserId, myUsername,
  dmId, dmMessages, dmLoading,
  msgInput, setMsgInput, msgSending, onSend,
  msgListRef,
}: {
  trade: NormalizedTrade;
  myUserId: string;
  myUsername: string;
  dmId: string | null;
  dmMessages: SleeperDmMessage[];
  dmLoading: boolean;
  msgInput: string;
  setMsgInput: (v: string) => void;
  msgSending: boolean;
  onSend: () => void;
  msgListRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Message list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 pt-3 pb-2 space-y-3" ref={msgListRef}>
        {dmLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-white/30" />
          </div>
        ) : !trade.partnerUserId ? (
          <p className="text-center text-[12px] text-white/30 italic py-8">
            Partner user ID unavailable.
          </p>
        ) : !dmId ? (
          <p className="text-center text-[12px] text-white/30 italic py-8">
            Could not load DM thread.
          </p>
        ) : dmMessages.length === 0 ? (
          <p className="text-center text-[12px] text-white/30 italic py-8">
            No messages yet. Start the conversation below.
          </p>
        ) : (
          dmMessages.map((msg) => {
            const isMe = msg.author_id === myUserId;
            const isTradeCard = (msg.attachment as any)?.type === "trade_dm";
            return (
              <div
                key={msg.message_id}
                className={cn("flex items-end gap-2", isMe && "flex-row-reverse")}
              >
                {/* Avatar */}
                {msg.author_avatar ? (
                  <img
                    src={`https://sleepercdn.com/avatars/thumbs/${msg.author_avatar}`}
                    alt=""
                    className="w-6 h-6 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className={cn(
                    "w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white/60",
                    isMe ? "bg-[#0b3a7a]" : "bg-white/[0.10]"
                  )}>
                    {(isMe ? myUsername : trade.partnerName).charAt(0).toUpperCase()}
                  </div>
                )}
                <div className={cn("max-w-[68%] flex flex-col gap-0.5", isMe && "items-end")}>
                  {!isMe && (
                    <span className="text-[10px] text-white/30 px-1">
                      {msg.author_display_name || trade.partnerName}
                    </span>
                  )}
                  {isTradeCard ? (
                    <TradeDmCard />
                  ) : (
                    <div className={cn(
                      "px-3 py-2 rounded-2xl text-[13px] leading-relaxed break-words",
                      isMe
                        ? "bg-[#0b3a7a] text-white rounded-br-sm"
                        : "bg-white/[0.07] text-white/85 rounded-bl-sm",
                      msg._optimistic && "opacity-60"
                    )}>
                      {msg.text || <span className="text-white/30 italic">attachment</span>}
                    </div>
                  )}
                  <span className="text-[10px] text-white/20 px-1 tabular-nums">
                    {fmtTime(msg.created)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Compose */}
      <div className="flex gap-2 flex-shrink-0 px-3 sm:px-6 py-3 sm:py-4 border-t border-white/[0.06]">
        <input
          value={msgInput}
          onChange={(e) => setMsgInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
          placeholder={dmId ? `Message ${trade.partnerName}…` : "Loading thread…"}
          disabled={!dmId || msgSending}
          data-testid="input-trade-message"
          className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/20 disabled:opacity-40 transition-colors"
        />
        <Button
          onClick={onSend}
          disabled={!msgInput.trim() || !dmId || msgSending}
          className="h-10 px-4 bg-[#0b3a7a] hover:bg-[#0d4a9a] text-white flex-shrink-0"
          data-testid="btn-send-trade-message"
        >
          {msgSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

// ─── TradeActionModal ─────────────────────────────────────────────────────────

export function TradeActionModal({
  open, onClose, mode: initialMode, trade,
  myUserId, myUsername, myAvatar,
  valuesBySleeperId,
  onAccept, onReject, onWithdraw, onCounterSent, onRefresh,
}: TradeActionModalProps) {
  // Active mode (can transition incoming → counter)
  const [activeMode, setActiveMode] = useState<TradeModalMode>(initialMode);
  const [activeTab, setActiveTab] = useState<"review" | "edit" | "messages">(
    initialMode === "counter" ? "edit" : "review"
  );

  // DM state
  const [dmId, setDmId] = useState<string | null>(null);
  const [dmMessages, setDmMessages] = useState<SleeperDmMessage[]>([]);
  const [dmLoading, setDmLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [msgInput, setMsgInput] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const msgListRef = useRef<HTMLDivElement>(null);
  const dmLoadedRef = useRef(false);

  // Confirm state (two-step)
  const [confirmAction, setConfirmAction] = useState<"accept" | "reject" | "withdraw" | null>(null);

  // Action result
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);

  // Counter / resend state
  const [counterAssets, setCounterAssets] = useState<{ myReceive: EditAssetsWithFaab; myGive: EditAssetsWithFaab } | null>(null);
  const [counterSubmitting, setCounterSubmitting] = useState(false);
  const [counterResult, setCounterResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showResendConfirm, setShowResendConfirm] = useState(false);
  const [resendSubmitting, setResendSubmitting] = useState(false);

  // Reset when modal opens or trade changes
  useEffect(() => {
    if (open) {
      setActiveMode(initialMode);
      setActiveTab(initialMode === "counter" || initialMode === "resend" ? "edit" : "review");
      setConfirmAction(null);
      setActionResult(null);
      setCounterResult(null);
      setCounterAssets(null);
      setShowResendConfirm(false);
      setResendSubmitting(false);
      setDmId(null);
      setDmMessages([]);
      setHasUnread(false);
      setMsgInput("");
      dmLoadedRef.current = false;
    }
  }, [open, trade.transactionId, initialMode]);

  // Auto-scroll messages
  useEffect(() => {
    if (activeTab === "messages" && msgListRef.current) {
      msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
    }
  }, [dmMessages.length, activeTab]);

  const isProposed = trade.status === "proposed";
  const isExpiring = !!trade.expiresAt
    && trade.expiresAt - Date.now() < 24 * 3600000
    && trade.expiresAt > Date.now();

  // ── DM loading ──────────────────────────────────────────────────────────────
  const loadDm = useCallback(async () => {
    if (dmLoadedRef.current || !trade.partnerUserId) return;
    dmLoadedRef.current = true;
    setDmLoading(true);
    try {
      const info = await getDmByMembersFull(trade.partnerUserId);
      if (!info) return;
      setDmId(info.dm_id);
      const hasNew = !!info.last_message_id && info.last_message_id !== info.last_read_id;
      setHasUnread(hasNew);
      const msgs = await fetchDmMessages(info.dm_id);
      setDmMessages([...msgs].sort((a, b) => a.created - b.created));
      if (info.last_message_id) {
        markDmRead(info.dm_id, info.last_message_id).catch(() => {});
        setHasUnread(false);
      }
    } catch {}
    finally { setDmLoading(false); }
  }, [trade.partnerUserId]);

  const handleTabChange = useCallback((tab: "review" | "edit" | "messages") => {
    setActiveTab(tab);
    if (tab === "messages") loadDm();
  }, [loadDm]);

  // ── Send DM ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!dmId || !msgInput.trim() || msgSending) return;
    const text = msgInput.trim();
    setMsgInput("");
    setMsgSending(true);
    const optId = `opt-${Date.now()}`;
    const optimistic: SleeperDmMessage = {
      message_id: optId, parent_id: dmId, parent_type: "dm",
      author_id: myUserId, author_display_name: myUsername, author_avatar: null,
      author_real_name: null, author_is_bot: false, author_role_id: null,
      text, text_map: null, attachment: null, created: Date.now(),
      edited: null, pinned: false, reactions: null, user_reactions: null, _optimistic: true,
    };
    setDmMessages((prev) => [...prev, optimistic]);
    try {
      const sent = await sendDmMessage(dmId, text);
      setDmMessages((prev) => prev.map((m) => m.message_id === optId ? { ...sent } : m));
    } catch {
      setDmMessages((prev) => prev.filter((m) => m.message_id !== optId));
      setMsgInput(text);
    } finally {
      setMsgSending(false);
    }
  }, [dmId, msgInput, msgSending, myUserId, myUsername]);

  // ── Action handlers ──────────────────────────────────────────────────────────
  const handleActionConfirm = useCallback(async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      if (confirmAction === "accept" && onAccept) {
        await onAccept();
        setActionResult({ success: true, message: "Trade accepted! Your roster has been updated." });
      } else if (confirmAction === "reject" && onReject) {
        await onReject();
        setActionResult({ success: true, message: "Trade rejected." });
      } else if (confirmAction === "withdraw" && onWithdraw) {
        await onWithdraw();
        setActionResult({ success: true, message: "Trade offer withdrawn." });
      }
    } catch (err: any) {
      const msg = err?.message || "Action failed.";
      setActionResult({ success: false, message: `${msg} You can also act directly on Sleeper.` });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  }, [confirmAction, onAccept, onReject, onWithdraw]);

  // ── Counter submit ───────────────────────────────────────────────────────────
  const handleCounterSubmit = useCallback(async () => {
    if (!counterAssets) return;
    const { myReceive, myGive } = counterAssets;
    const hasAssets =
      myReceive.players.length > 0 || myReceive.picks.length > 0 || myReceive.faab > 0 ||
      myGive.players.length > 0 || myGive.picks.length > 0 || myGive.faab > 0;
    if (!hasAssets) return;

    setCounterSubmitting(true);
    try {
      const adds: Record<string, number> = {};
      const drops: Record<string, number> = {};
      for (const p of myReceive.players) {
        adds[p.playerId] = trade.userRosterId;
        drops[p.playerId] = trade.partnerRosterId;
      }
      for (const p of myGive.players) {
        adds[p.playerId] = trade.partnerRosterId;
        drops[p.playerId] = trade.userRosterId;
      }
      const draftPicks: SleeperTransactionPick[] = [
        ...myReceive.picks.map((p) => ({
          roster_id: p.originalRosterId,
          season: p.season,
          round: p.round,
          owner_id: trade.userRosterId,
          previous_owner_id: trade.partnerRosterId,
        })),
        ...myGive.picks.map((p) => ({
          roster_id: p.originalRosterId,
          season: p.season,
          round: p.round,
          owner_id: trade.partnerRosterId,
          previous_owner_id: trade.userRosterId,
        })),
      ];
      const waiverBudget: Array<{ sender: number; receiver: number; amount: number }> = [];
      if (myGive.faab > 0) waiverBudget.push({ sender: trade.userRosterId, receiver: trade.partnerRosterId, amount: myGive.faab });
      if (myReceive.faab > 0) waiverBudget.push({ sender: trade.partnerRosterId, receiver: trade.userRosterId, amount: myReceive.faab });
      const expiresAt = Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);
      const result = await proposeTrade({
        leagueId: trade.leagueId,
        adds, drops, draftPicks, waiverBudget, expiresAt,
        rejectTransactionId: trade.transactionId,
        rejectTransactionLeg: trade.leg,
      });

      // Automatic Dynasty Command link DM (non-fatal). Replaces the previous
      // trade-card builder + free-text link send — the controlled helper
      // handles 20–60s pacing, caps, and dedupe internally.
      if (trade.partnerUserId) {
        void firePostTradeLinkDm({
          recipientUserId: trade.partnerUserId,
          leagueId: trade.leagueId,
          senderUserId: myUserId,
          queueType: "counter-trade",
        });
      }

      setCounterResult({ success: true, message: "Counter offer sent! The existing offer has been rejected." });
      setTimeout(() => onCounterSent?.(), 1600);
    } catch (err: any) {
      setCounterResult({
        success: false,
        message: `${err?.message || "Failed to send counter."} You can also counter directly on Sleeper.`,
      });
    } finally {
      setCounterSubmitting(false);
    }
  }, [counterAssets, trade, myUserId, myUsername, onCounterSent]);

  // ── Edit & Resend submit ─────────────────────────────────────────────────────
  const handleResendSubmit = useCallback(async () => {
    if (!counterAssets) return;
    const { myReceive, myGive } = counterAssets;
    const hasAssets =
      myReceive.players.length > 0 || myReceive.picks.length > 0 || myReceive.faab > 0 ||
      myGive.players.length > 0 || myGive.picks.length > 0 || myGive.faab > 0;
    if (!hasAssets) return;

    setResendSubmitting(true);
    let withdrew = false;
    try {
      await rejectTrade(trade.leagueId, trade.transactionId, trade.leg);
      withdrew = true;

      const adds: Record<string, number> = {};
      const drops: Record<string, number> = {};
      for (const p of myReceive.players) {
        adds[p.playerId] = trade.userRosterId;
        drops[p.playerId] = trade.partnerRosterId;
      }
      for (const p of myGive.players) {
        adds[p.playerId] = trade.partnerRosterId;
        drops[p.playerId] = trade.userRosterId;
      }
      const draftPicks: SleeperTransactionPick[] = [
        ...myReceive.picks.map((p) => ({
          roster_id: p.originalRosterId,
          season: p.season,
          round: p.round,
          owner_id: trade.userRosterId,
          previous_owner_id: trade.partnerRosterId,
        })),
        ...myGive.picks.map((p) => ({
          roster_id: p.originalRosterId,
          season: p.season,
          round: p.round,
          owner_id: trade.partnerRosterId,
          previous_owner_id: trade.userRosterId,
        })),
      ];
      const waiverBudget: Array<{ sender: number; receiver: number; amount: number }> = [];
      if (myGive.faab > 0) waiverBudget.push({ sender: trade.userRosterId, receiver: trade.partnerRosterId, amount: myGive.faab });
      if (myReceive.faab > 0) waiverBudget.push({ sender: trade.partnerRosterId, receiver: trade.userRosterId, amount: myReceive.faab });
      const expiresAt = trade.expiresAt && trade.expiresAt > Date.now()
        ? Math.floor(trade.expiresAt / 1000)
        : Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);

      await proposeTrade({ leagueId: trade.leagueId, adds, drops, draftPicks, waiverBudget, expiresAt });

      // Automatic Dynasty Command link DM after the new offer lands.
      if (trade.partnerUserId) {
        void firePostTradeLinkDm({
          recipientUserId: trade.partnerUserId,
          leagueId: trade.leagueId,
          senderUserId: myUserId,
          queueType: "resend-trade",
        });
      }

      setCounterResult({ success: true, message: "Updated offer sent! Your previous offer has been withdrawn." });
      setTimeout(() => onCounterSent?.(), 1600);
    } catch (err: any) {
      if (withdrew) {
        setCounterResult({
          success: false,
          message: "Original offer was withdrawn, but the updated trade could not be sent. Please re-submit on Sleeper.",
        });
      } else {
        setCounterResult({
          success: false,
          message: `${err?.message || "Failed."} Your original offer was not changed.`,
        });
      }
    } finally {
      setResendSubmitting(false);
    }
  }, [counterAssets, trade, myUserId, myUsername, onCounterSent]);

  const handleClose = useCallback(() => {
    onRefresh?.();
    onClose();
  }, [onRefresh, onClose]);

  // ── Tabs ─────────────────────────────────────────────────────────────────────
  // The Messages tab and Message buttons were removed from the UI. Replies
  // still arrive in Sleeper itself; the in-app DM viewer plumbing below
  // remains dead-code-gated by isGeneralMessagingEnabled() in case messaging
  // is re-enabled later.
  const tabs: Array<{ id: "review" | "edit" | "messages"; label: string; badge?: boolean }> =
    activeMode === "counter"
      ? [{ id: "edit", label: "Edit Counter" }]
      : activeMode === "resend"
      ? [{ id: "edit", label: "Edit Trade" }]
      : [{ id: "review", label: "Review Trade" }];

  const modalTitle =
    activeMode === "counter"  ? "Counter Offer"   :
    activeMode === "resend"   ? "Edit & Resend"    :
    activeMode === "incoming" ? "Incoming Trade"   :
    activeMode === "outgoing" ? "Outgoing Trade"   :
    "Trade Details";

  const finalResult = actionResult || counterResult;
  const showTabs = !finalResult;

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent
        className="max-w-[820px] w-full bg-[#07111f] border border-white/[0.10] p-0 overflow-hidden max-h-[calc(90dvh-72px)] sm:max-h-[90dvh] flex flex-col gap-0 rounded-xl"
        data-testid={`trade-action-modal-${trade.transactionId}`}
      >
        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 flex-shrink-0 border-b border-white/[0.06]">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0b3a7a]/50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <ArrowRightLeft className="w-4 h-4 text-[#d4af37]" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-[15px] font-bold text-white leading-tight">
                {modalTitle}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1">
                <div className="flex items-center gap-1.5">
                  <ManagerAvatar name={trade.partnerName} avatar={trade.partnerAvatar} sz={5} />
                  <span className="text-[12px] text-white/70 font-semibold">{trade.partnerName}</span>
                </div>
                <span className="text-white/20 text-[10px]">·</span>
                <span className="text-[11px] text-white/40">{trade.leagueName}</span>
                {isProposed && trade.expiresAt && (
                  <>
                    <span className="text-white/20 text-[10px]">·</span>
                    <span className={cn("text-[11px] font-semibold flex items-center gap-1",
                      isExpiring ? "text-amber-400" : "text-white/35")}>
                      {isExpiring && <AlertTriangle className="w-3 h-3" />}
                      Expires {formatExpiryLabel(trade.expiresAt)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
        {showTabs && (
          <div className="flex px-4 sm:px-6 border-b border-white/[0.06] flex-shrink-0 overflow-x-auto scrollbar-hide">
            {tabs.map(({ id, label, badge }) => (
              <button
                key={id}
                onClick={() => handleTabChange(id)}
                data-testid={`trade-modal-tab-${id}`}
                className={cn(
                  "relative px-3 sm:px-5 py-3 text-[12px] font-semibold border-b-2 transition-all whitespace-nowrap",
                  activeTab === id
                    ? "border-[#d4af37] text-white"
                    : "border-transparent text-white/40 hover:text-white/65"
                )}
              >
                {label}
                {badge && (
                  <span className="absolute top-2.5 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Result banner ────────────────────────────────────────────────────── */}
        {finalResult && (
          <div className={cn(
            "mx-3 sm:mx-6 mt-4 sm:mt-5 flex items-start gap-3 px-4 py-3 rounded-xl text-[13px] font-medium flex-shrink-0",
            finalResult.success
              ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300"
              : "bg-red-500/10 border border-red-500/25 text-red-300"
          )}>
            {finalResult.success
              ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
            {finalResult.message}
          </div>
        )}

        {/* ── Confirm banner ───────────────────────────────────────────────────── */}
        {confirmAction && !actionLoading && (
          <div className="mx-3 sm:mx-6 mt-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.10] flex-shrink-0">
            <p className="text-[13px] text-white/75 mb-3">
              {confirmAction === "accept"
                ? "Are you sure you want to accept this trade? This cannot be undone."
                : confirmAction === "withdraw"
                ? "Withdraw your trade offer? This cannot be undone."
                : "Reject this trade offer? This cannot be undone."}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-white/50 hover:text-white/80"
                onClick={() => setConfirmAction(null)}
                data-testid="btn-confirm-cancel"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className={cn(
                  "font-semibold",
                  confirmAction === "accept"
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-red-600/80 hover:bg-red-700 text-white"
                )}
                onClick={handleActionConfirm}
                data-testid="btn-confirm-proceed"
              >
                {confirmAction === "accept" ? "Yes, Accept" :
                 confirmAction === "withdraw" ? "Yes, Withdraw" : "Yes, Reject"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Tab content ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {!finalResult && activeTab === "review" && (
            <>
              <ReviewPanel trade={trade} myUsername={myUsername} myAvatar={myAvatar} />
              {(trade.iGetValue > 0 || trade.iGiveValue > 0) && (
                <TradeValueBar
                  myValue={trade.iGetValue}
                  theirValue={trade.iGiveValue}
                  myName={myUsername}
                  theirName={trade.partnerName}
                />
              )}
            </>
          )}

          {!finalResult && activeTab === "edit" && activeMode === "counter" && (
            <TradeEditTab
              trade={trade}
              myUserId={myUserId}
              valuesBySleeperId={valuesBySleeperId}
              onAssetsChange={(myReceive, myGive) => setCounterAssets({ myReceive, myGive })}
            />
          )}

          {!finalResult && activeTab === "edit" && activeMode === "resend" && (
            <TradeEditTab
              trade={trade}
              myUserId={myUserId}
              valuesBySleeperId={valuesBySleeperId}
              initialMyReceive={{ players: trade.iGet.players, picks: trade.iGet.picks, faab: trade.iGet.faab }}
              initialMyGive={{ players: trade.iGive.players, picks: trade.iGive.picks, faab: trade.iGive.faab }}
              onAssetsChange={(myReceive, myGive) => setCounterAssets({ myReceive, myGive })}
            />
          )}

          {activeTab === "messages" && !finalResult && (
            isGeneralMessagingEnabled() ? (
              <MessagesPanel
                trade={trade}
                myUserId={myUserId}
                myUsername={myUsername}
                dmId={dmId}
                dmMessages={dmMessages}
                dmLoading={dmLoading}
                msgInput={msgInput}
                setMsgInput={setMsgInput}
                msgSending={msgSending}
                onSend={handleSend}
                msgListRef={msgListRef}
              />
            ) : (
              <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6">
                <div className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-6 text-center">
                  <div className="text-[12px] font-semibold text-white/75 mb-1">Messaging temporarily disabled</div>
                  <div className="text-[11px] text-white/45 leading-relaxed">
                    Dynasty Command's messaging UI is paused right now. Your trade was sent through Sleeper normally — only the in-app DM viewer is hidden. You can still see and reply to messages in the Sleeper app.
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap px-3 sm:px-6 py-3 sm:py-4 border-t border-white/[0.06] flex-shrink-0">
          {/* ── After result ── */}
          {finalResult ? (
            <>
              <Button
                onClick={handleClose}
                variant="outline"
                className="border-white/[0.12] text-white/60 hover:text-white"
                data-testid="btn-trade-modal-close"
              >
                Close
              </Button>
              {finalResult.success && (
                <Button asChild variant="ghost" className="text-white/40 hover:text-white/70">
                  <a href={`https://sleeper.com/leagues/${trade.leagueId}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Open in Sleeper
                  </a>
                </Button>
              )}
            </>
          ) : actionLoading ? (
            <div className="flex items-center gap-2 text-white/50 text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin" /> Processing…
            </div>
          ) : activeMode === "incoming" && isProposed ? (
            <>
              {/* Reject */}
              <Button
                onClick={() => setConfirmAction("reject")}
                variant="ghost"
                className="text-red-400/80 hover:text-red-400 hover:bg-red-500/10"
                data-testid="btn-reject-trade"
              >
                <XCircle className="w-4 h-4 mr-1.5" />
                Reject
              </Button>
              <div className="flex gap-2 ml-auto">
                {/* Counter */}
                <Button
                  variant="outline"
                  className="border-white/[0.12] text-white/70 hover:text-white font-semibold"
                  onClick={() => { setActiveMode("counter"); setActiveTab("edit"); setCounterAssets(null); }}
                  data-testid="btn-counter-trade"
                >
                  <ArrowRightLeft className="w-4 h-4 mr-1.5" />
                  Counter
                </Button>
                {/* Accept */}
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  onClick={() => setConfirmAction("accept")}
                  data-testid="btn-accept-trade"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  Accept Trade
                </Button>
              </div>
            </>
          ) : activeMode === "outgoing" && isProposed ? (
            showResendConfirm ? (
              /* Resend confirmation */
              <>
                <p className="flex-1 text-[12px] text-white/65 leading-relaxed">
                  Editing this offer will{" "}
                  <span className="text-white/90 font-semibold">withdraw</span> the current
                  Sleeper trade and create a new offer with your changes.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white/40 hover:text-white/70 flex-shrink-0"
                  onClick={() => setShowResendConfirm(false)}
                  data-testid="btn-resend-confirm-cancel"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-[#0b3a7a] hover:bg-[#0d4a9a] text-white font-semibold flex-shrink-0"
                  onClick={() => {
                    setShowResendConfirm(false);
                    setCounterAssets(null);
                    setActiveMode("resend");
                    setActiveTab("edit");
                  }}
                  data-testid="btn-resend-confirm-proceed"
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Edit Trade
                </Button>
              </>
            ) : (
              /* Normal outgoing footer */
              <>
                <Button
                  variant="ghost"
                  className="text-red-400/80 hover:text-red-400 hover:bg-red-500/10"
                  onClick={() => setConfirmAction("withdraw")}
                  data-testid="btn-withdraw-trade"
                >
                  <XCircle className="w-4 h-4 mr-1.5" />
                  Withdraw Offer
                </Button>
                <Button
                  variant="ghost"
                  className="text-white/55 hover:text-white/85"
                  onClick={() => setShowResendConfirm(true)}
                  data-testid="btn-edit-resend"
                >
                  <Pencil className="w-4 h-4 mr-1.5" />
                  Edit & Resend
                </Button>
              </>
            )
          ) : activeMode === "resend" ? (
            <>
              <Button
                variant="ghost"
                className="text-white/40 hover:text-white/60"
                onClick={() => {
                  setActiveMode("outgoing");
                  setActiveTab("review");
                  setCounterAssets(null);
                  setShowResendConfirm(false);
                }}
                disabled={resendSubmitting}
                data-testid="btn-resend-back"
              >
                ← Back
              </Button>
              <Button
                className="ml-auto bg-[#0b3a7a] hover:bg-[#0d4a9a] text-white font-bold"
                onClick={handleResendSubmit}
                disabled={
                  resendSubmitting ||
                  !counterAssets ||
                  (counterAssets.myReceive.players.length === 0 &&
                   counterAssets.myReceive.picks.length === 0 &&
                   counterAssets.myReceive.faab === 0 &&
                   counterAssets.myGive.players.length === 0 &&
                   counterAssets.myGive.picks.length === 0 &&
                   counterAssets.myGive.faab === 0)
                }
                data-testid="btn-resend-submit"
              >
                {resendSubmitting
                  ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  : <Pencil className="w-4 h-4 mr-1.5" />}
                Send Updated Trade
              </Button>
            </>
          ) : activeMode === "counter" ? (
            <>
              <Button
                variant="ghost"
                className="text-white/40 hover:text-white/60"
                onClick={() => { setActiveMode("incoming"); setActiveTab("review"); setCounterAssets(null); }}
                disabled={counterSubmitting}
                data-testid="btn-counter-back"
              >
                ← Back
              </Button>
              <Button
                className="ml-auto bg-[#0b3a7a] hover:bg-[#0d4a9a] text-white font-bold"
                onClick={handleCounterSubmit}
                disabled={
                  counterSubmitting ||
                  !counterAssets ||
                  (counterAssets.myReceive.players.length === 0 &&
                   counterAssets.myReceive.picks.length === 0 &&
                   counterAssets.myReceive.faab === 0 &&
                   counterAssets.myGive.players.length === 0 &&
                   counterAssets.myGive.picks.length === 0 &&
                   counterAssets.myGive.faab === 0)
                }
                data-testid="btn-counter-submit"
              >
                {counterSubmitting
                  ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  : <ArrowRightLeft className="w-4 h-4 mr-1.5" />}
                Send Counter Offer
              </Button>
            </>
          ) : (
            /* completed / rejected / cancelled */
            <>
              <Button
                onClick={handleClose}
                variant="outline"
                className="border-white/[0.12] text-white/60 hover:text-white"
              >
                Close
              </Button>
              <Button asChild variant="ghost" className="ml-auto text-white/40 hover:text-white/70">
                <a href={`https://sleeper.com/leagues/${trade.leagueId}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Open in Sleeper
                </a>
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
