/**
 * BulkTrade — Multi-step bulk trade offer builder with safe queue execution.
 *
 * Step 1: Build your offer (give assets + get template)
 * Step 2: Choose target managers (current league)
 * Step 3: Review all queued offers + confirmation
 * Step 4: Queue execution — safe delays, pause/resume/cancel
 */

import { useState, useRef, useMemo, useCallback } from "react";
import { useSleeper } from "@/contexts/SleeperContext";
import { fetchSleeperLeagueFull } from "@/lib/sleeperApi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useValueModel } from "@/contexts/ValueModelContext";
import { proposeTrade, firePostTradeLinkDm } from "@/services/sleeperAuthedApi";
import { sleeperWriteLimiter } from "@/services/sleeperWriteLimiter";
import { preflightBatch, isWriteEnabled } from "@/services/sleeperSafetyGate";
import { SafePacingNotice } from "@/components/SafePacingNotice";
import { getSleeperToken, getSleeperSession } from "@/services/sleeperAuth";
import { fmtEta } from "@/services/optimizeQueue";
import type { League, Team, Player, Pick } from "@/types";
import type { SleeperTransactionPick } from "@/services/sleeperAuthedApi";
import {
  ArrowRightLeft, Plus, X, CheckCircle2, AlertTriangle,
  ChevronLeft, Pause, Play, SkipForward, Clock, Loader2, Package,
  ScanLine, RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkAsset {
  uid: string;
  type: "player" | "pick";
  player?: Player;
  pick?: Pick;
  label: string;
  dynVal: number;
  rdVal: number;
}

interface TargetEntry {
  partner: Team;
  selected: boolean;
  warnings: string[];
  blockers: string[];
  resolvedGetAssets: BulkAsset[];
}

interface QueueItem {
  id: string;
  partner: Team;
  leagueId: string;
  leagueName: string;
  giveAssets: BulkAsset[];
  getAssets: BulkAsset[];
  userRosterId: number;
  partnerRosterId: number;
  status: "pending" | "processing" | "done" | "failed" | "skipped";
  error?: string;
  skipReason?: string;
  sentAt?: number;
  dynNet: number;
  rdNet: number;
}

// ─── Cross-league scan target ─────────────────────────────────────────────────

interface CrossLeagueTarget {
  uid: string;           // `${leagueId}:${partner.id}` — globally unique
  partner: Team;
  leagueId: string;
  leagueName: string;
  userRosterId: number;
  selected: boolean;
  resolvedGetAssets: BulkAsset[];
  delta: number;         // wantValue - giveValue
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

/**
 * Delay between trade offers:
 * - After every 10 offers: 8–15 min pause
 * - After every 5 offers:  3–7 min pause
 * - Normal gap:            45–120 s
 */
function computeTradeDelay(completedCount: number): number {
  const r = Math.random();
  if (completedCount > 0 && completedCount % 10 === 0) return Math.floor((8  + r * 7)  * 60_000);
  if (completedCount > 0 && completedCount % 5  === 0) return Math.floor((3  + r * 4)  * 60_000);
  return                                                      Math.floor((45 + r * 75) * 1_000);
}

function estimateTradeQueueMs(completedCount: number, pendingCount: number): number {
  let ms = 0;
  for (let i = 0; i < pendingCount; i++) {
    const idx = completedCount + i;
    if (idx === 0)        ms += 1_500;
    else if (idx % 10 === 0) ms += 11.5 * 60_000;
    else if (idx % 5  === 0) ms += 5   * 60_000;
    else                  ms += 82_500;
  }
  return ms;
}

function computeExpiresAt(option: string): number | null {
  const now = Math.floor(Date.now() / 1000);
  switch (option) {
    case "never": return null;
    case "1h":    return now + 3_600;
    case "24h":   return now + 86_400;
    case "2d":    return now + 172_800;
    case "1w":    return now + 604_800;
    default:      return now + 86_400;
  }
}

// ─── AssetChip ────────────────────────────────────────────────────────────────

function AssetChip({
  asset,
  onRemove,
  size = "md",
}: {
  asset: BulkAsset;
  onRemove?: () => void;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 bg-muted/40 border border-border/50 rounded-lg",
        size === "sm" ? "px-2 py-1" : "px-2.5 py-1.5",
      )}
    >
      {asset.type === "player" && asset.player ? (
        <PlayerAvatar
          id={asset.player.sleeperId ?? asset.player.id}
          name={asset.player.name}
          pos={asset.player.pos}
          team={asset.player.team ?? ""}
          size="sm"
          sub={asset.dynVal > 0 ? asset.dynVal.toLocaleString() : undefined}
        />
      ) : (
        <div className="flex flex-col">
          <span className={cn("font-semibold text-foreground", size === "sm" ? "text-[10px]" : "text-xs")}>
            {asset.label}
          </span>
          {asset.dynVal > 0 && (
            <span className="text-[9px] text-muted-foreground">{asset.dynVal.toLocaleString()}</span>
          )}
        </div>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          data-testid="btn-remove-asset"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── AssetSelectorModal ───────────────────────────────────────────────────────

const POS_TABS = ["QB", "RB", "WR", "TE", "PICKS"] as const;
type PosTab = typeof POS_TABS[number];

function AssetSelectorModal({
  side,
  userTeam,
  otherTeams,
  alreadySelected,
  onAdd,
  onClose,
  getPlayerValue,
  getRedraftValue,
  getPickValue,
}: {
  side: "give" | "get";
  userTeam: Team;
  otherTeams: Team[];
  alreadySelected: BulkAsset[];
  onAdd: (asset: BulkAsset) => void;
  onClose: () => void;
  getPlayerValue: (p: Player) => number;
  getRedraftValue: (p: Player) => number;
  getPickValue: (p: Pick) => number;
}) {
  const [activePos, setActivePos] = useState<PosTab>("RB");
  const [search, setSearch] = useState("");

  const selectedUids = new Set(alreadySelected.map(a => a.uid));

  const sourcePlayers: Player[] = side === "give"
    ? userTeam.roster
    : otherTeams.flatMap(t => t.roster);

  const sourcePicks: Pick[] = side === "give"
    ? userTeam.picks
    : otherTeams.flatMap(t => t.picks);

  const filteredPlayers = sourcePlayers
    .filter(p =>
      p.pos === activePos &&
      !selectedUids.has(`player:${p.sleeperId ?? p.id}`) &&
      p.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => getPlayerValue(b) - getPlayerValue(a));

  const filteredPicks = sourcePicks
    .filter(p => {
      const label = `${p.year} Rd ${p.round}`;
      return (
        !selectedUids.has(`pick:${p.year}-${p.round}-${p.ownerTeamId}`) &&
        label.toLowerCase().includes(search.toLowerCase())
      );
    })
    .sort((a, b) => getPickValue(b) - getPickValue(a));

  const makePlayer = (p: Player): BulkAsset => ({
    uid:    `player:${p.sleeperId ?? p.id}`,
    type:   "player",
    player: p,
    label:  p.name,
    dynVal: getPlayerValue(p),
    rdVal:  getRedraftValue(p),
  });

  const makePick = (p: Pick): BulkAsset => ({
    uid:    `pick:${p.year}-${p.round}-${p.ownerTeamId}`,
    type:   "pick",
    pick:   p,
    label:  `${p.year} Rd ${p.round}${p.projectedRange ? ` (${p.projectedRange})` : ""}`,
    dynVal: getPickValue(p),
    rdVal:  0,
  });

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="w-full md:max-w-lg bg-background border border-border rounded-t-2xl md:rounded-2xl overflow-hidden max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h3 className="font-bold text-sm">
            {side === "give" ? "Add Asset You Send" : "Add Asset You Want"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="btn-modal-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Position tabs */}
        <div className="flex gap-1 p-3 border-b border-border flex-shrink-0">
          {POS_TABS.map(pos => (
            <button
              key={pos}
              onClick={() => { setActivePos(pos); setSearch(""); }}
              className={cn(
                "flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                activePos === pos
                  ? "bg-[#0b3a7a] text-white"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted/70",
              )}
              data-testid={`btn-modal-tab-${pos.toLowerCase()}`}
            >
              {pos}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-3 py-2 flex-shrink-0">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={activePos === "PICKS" ? "Search picks…" : `Search ${activePos}s…`}
            className="text-sm h-8"
            data-testid="input-asset-search"
          />
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 px-3 pb-3 space-y-1">
          {activePos === "PICKS" ? (
            filteredPicks.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-6">No picks available.</p>
            ) : filteredPicks.map((pick, i) => {
              const asset = makePick(pick);
              return (
                <button
                  key={i}
                  onClick={() => onAdd(asset)}
                  className="w-full flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border/40 hover:bg-muted/40 transition-colors text-left"
                  data-testid={`btn-add-pick-${pick.year}-${pick.round}`}
                >
                  <div>
                    <span className="text-sm font-semibold">{asset.label}</span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">
                      {asset.dynVal > 0 ? `${asset.dynVal.toLocaleString()} dyn` : "—"}
                    </span>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-[#d4af37] flex-shrink-0" />
                </button>
              );
            })
          ) : (
            filteredPlayers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-6">No {activePos}s available.</p>
            ) : filteredPlayers.map(player => {
              const asset = makePlayer(player);
              return (
                <button
                  key={player.sleeperId ?? player.id}
                  onClick={() => onAdd(asset)}
                  className="w-full flex items-center justify-between gap-2 p-2 rounded-lg border border-border/40 hover:bg-muted/40 transition-colors text-left"
                  data-testid={`btn-add-player-${player.sleeperId ?? player.id}`}
                >
                  <PlayerAvatar
                    id={player.sleeperId ?? player.id}
                    name={player.name}
                    pos={player.pos}
                    team={player.team ?? ""}
                    size="sm"
                    sub={`${getPlayerValue(player).toLocaleString()} dyn · ${getRedraftValue(player).toLocaleString()} rd`}
                  />
                  <Plus className="w-3.5 h-3.5 text-[#d4af37] flex-shrink-0" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── BulkTrade ────────────────────────────────────────────────────────────────

export function BulkTrade({
  league,
  userTeam,
  onBack,
}: {
  league: League;
  userTeam: Team;
  onBack?: () => void;
}) {
  const { getPlayerValue, getRedraftValue, getPickValue } = useValueModel();
  const isSleeperAuthed = !!getSleeperToken();
  const sleeperCtx = useSleeper();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // ── Step 1 state ──────────────────────────────────────────────────────────
  const [giveAssets, setGiveAssets] = useState<BulkAsset[]>([]);
  const [getAssets,  setGetAssets]  = useState<BulkAsset[]>([]);
  const [addingTo,   setAddingTo]   = useState<"give" | "get" | null>(null);
  const [expiresOption, setExpiresOption] = useState("24h");

  // ── Step 2 state ──────────────────────────────────────────────────────────
  const [targets, setTargets] = useState<TargetEntry[]>(() =>
    league.teams
      .filter(t => t.id !== userTeam.id)
      .map(partner => ({
        partner,
        selected: false,
        warnings: [],
        blockers: [],
        resolvedGetAssets: [],
      }))
  );

  // ── Step 3 state ──────────────────────────────────────────────────────────
  const [confirmed, setConfirmed] = useState(false);

  // ── Queue state ───────────────────────────────────────────────────────────
  const [queueItems, setQueueItemsRaw] = useState<QueueItem[]>([]);
  const [qStatus, setQStatus] = useState<"idle" | "running" | "paused" | "done">("idle");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pauseMsg, setPauseMsg] = useState<string | null>(null);

  // ── Cross-league scan state ──────────────────────────────────────────────
  const [crossTargets, setCrossTargets] = useState<CrossLeagueTarget[]>([]);
  const [clScanState, setClScanState]   = useState<"idle" | "scanning" | "done">("idle");
  const [clProgress, setClProgress]     = useState(0);
  const [clTotal, setClTotal]           = useState(0);
  const qStatusRef = useRef<"idle" | "running" | "paused" | "done">("idle");
  const queueRef   = useRef<QueueItem[]>([]);
  const loopActive = useRef(false);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const sumDyn = (assets: BulkAsset[]) => assets.reduce((s, a) => s + a.dynVal, 0);
  const sumRd  = (assets: BulkAsset[]) => assets.reduce((s, a) => s + a.rdVal, 0);

  const giveTotal = { dyn: sumDyn(giveAssets), rd: sumRd(giveAssets) };
  const getTotal  = { dyn: sumDyn(getAssets),  rd: sumRd(getAssets)  };
  const dynNet    = getTotal.dyn - giveTotal.dyn;
  const rdNet     = giveTotal.rd - getTotal.rd;

  const otherTeams = useMemo(
    () => league.teams.filter(t => t.id !== userTeam.id),
    [league, userTeam],
  );

  const selectedTargets      = targets.filter(t => t.selected && t.blockers.length === 0);
  const selectedCrossTargets = crossTargets.filter(t => t.selected);

  // ── Queue state management ────────────────────────────────────────────────
  function setQueueItems(
    updater: QueueItem[] | ((prev: QueueItem[]) => QueueItem[]),
  ) {
    setQueueItemsRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      queueRef.current = next;
      return next;
    });
  }

  function patchItem(id: string, patch: Partial<QueueItem>) {
    setQueueItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const validateTargets = useCallback(() => {
    setTargets(prev => prev.map(t => {
      const warnings: string[] = [];
      const blockers: string[] = [];

      if (!isSleeperAuthed) blockers.push("Sleeper auth required");
      if (giveAssets.length === 0) blockers.push("No give assets");
      if (getAssets.length === 0)  blockers.push("No get assets");

      for (const asset of giveAssets) {
        if (asset.type === "player" && asset.player) {
          const sid = asset.player.sleeperId ?? asset.player.id;
          const ok = userTeam.roster.some(p => (p.sleeperId ?? p.id) === sid);
          if (!ok) warnings.push(`${asset.player.name} not on your roster`);
        }
      }

      const resolvedGetAssets: BulkAsset[] = [];
      for (const asset of getAssets) {
        if (asset.type === "player" && asset.player) {
          const sid = asset.player.sleeperId ?? asset.player.id;
          const onPartner = t.partner.roster.some(p => (p.sleeperId ?? p.id) === sid);
          if (onPartner) {
            resolvedGetAssets.push(asset);
          } else {
            warnings.push(`${asset.player.name} not on ${t.partner.owner}'s roster`);
          }
        } else if (asset.type === "pick" && asset.pick) {
          const match = t.partner.picks.find(
            p => p.year === asset.pick!.year && p.round === asset.pick!.round,
          );
          if (match) {
            resolvedGetAssets.push({
              ...asset,
              pick: match,
              uid: `pick:${match.year}-${match.round}-${match.ownerTeamId}`,
            });
          } else {
            warnings.push(`${asset.label} not owned by ${t.partner.owner}`);
          }
        }
      }

      if (resolvedGetAssets.length === 0 && getAssets.length > 0) {
        blockers.push("Partner has none of the requested assets");
      }

      return { ...t, warnings, blockers, resolvedGetAssets };
    }));
  }, [giveAssets, getAssets, userTeam, isSleeperAuthed]);

  // ── Cross-league scan ─────────────────────────────────────────────────────
  const handleCrossLeagueScan = useCallback(async () => {
    if (!sleeperCtx.user) return;

    const givePlayer = giveAssets.find(a => a.type === "player" && a.player)?.player ?? null;
    const wantPlayer = getAssets.find(a => a.type === "player" && a.player)?.player ?? null;
    if (!givePlayer || !wantPlayer) return;

    const allLeagues = sleeperCtx.leagues ?? [];
    setClScanState("scanning");
    setClProgress(0);
    setClTotal(allLeagues.length);
    setCrossTargets([]);

    const giveSid  = givePlayer.sleeperId ?? givePlayer.id;
    const wantSid  = wantPlayer.sleeperId ?? wantPlayer.id;
    const giveName = givePlayer.name.toLowerCase();
    const wantName = wantPlayer.name.toLowerCase();

    function playerMatches(p: Player, sid: string, name: string) {
      return (p.sleeperId ?? p.id) === sid || p.name.toLowerCase() === name;
    }

    await Promise.allSettled(
      allLeagues.map(async (summary) => {
        try {
          if (summary.leagueId === league.id) return; // current league already shown above
          const data = await fetchSleeperLeagueFull(summary.leagueId, sleeperCtx.user!.userId);
          const { league: lg, userTeamId } = data;

          const ut = userTeamId ? lg.teams.find((t: Team) => t.id === userTeamId) : null;
          if (!ut) return;
          if (!ut.roster.some((p: Player) => playerMatches(p, giveSid, giveName))) return;

          for (const team of lg.teams) {
            if (team.id === userTeamId) continue;
            const partnerHas = team.roster.find((p: Player) => playerMatches(p, wantSid, wantName));
            if (!partnerHas) continue;

            // Resolve all get assets against this partner
            const resolvedGetAssets: BulkAsset[] = [];
            for (const asset of getAssets) {
              if (asset.type === "player" && asset.player) {
                const match = team.roster.find((p: Player) =>
                  playerMatches(p, asset.player!.sleeperId ?? asset.player!.id, asset.player!.name.toLowerCase()),
                );
                if (match) resolvedGetAssets.push({ ...asset, player: match, uid: `player:${match.sleeperId ?? match.id}` });
              } else if (asset.type === "pick" && asset.pick) {
                const match = team.picks.find((p: Pick) =>
                  p.year === asset.pick!.year && p.round === asset.pick!.round,
                );
                if (match) resolvedGetAssets.push({ ...asset, pick: match, uid: `pick:${match.year}-${match.round}-${match.ownerTeamId}` });
              }
            }
            if (resolvedGetAssets.length === 0) continue;

            const uid = `${summary.leagueId}:${team.id}`;
            setCrossTargets(prev => {
              if (prev.some(ct => ct.uid === uid)) return prev;
              return [...prev, {
                uid,
                partner: team,
                leagueId: summary.leagueId,
                leagueName: summary.name,
                userRosterId: parseInt(ut!.id),
                selected: false,
                resolvedGetAssets,
                delta: getPlayerValue(partnerHas) - getPlayerValue(givePlayer),
              }];
            });
          }
        } catch { /* skip unreachable leagues silently */ }
        finally { setClProgress(p => p + 1); }
      }),
    );

    setClScanState("done");
  }, [giveAssets, getAssets, sleeperCtx, league.id, getPlayerValue]);

  // ── Queue loop ────────────────────────────────────────────────────────────
  const runQueueLoop = useCallback(async () => {
    if (loopActive.current) return;
    loopActive.current = true;

    try {
      let completed = queueRef.current.filter(
        i => i.status === "done" || i.status === "failed" || i.status === "skipped",
      ).length;

      outerLoop: while (true) {
        const st = qStatusRef.current;
        if (st === "idle" || st === "done") break;

        if (st === "paused") {
          await new Promise<void>(resolve => {
            const id = setInterval(() => {
              if (qStatusRef.current !== "paused") { clearInterval(id); resolve(); }
            }, 300);
          });
          continue;
        }

        const item = queueRef.current.find(i => i.status === "pending");
        if (!item) break;

        if (completed > 0) {
          const delayMs = computeTradeDelay(completed);
          const STEP = 500;
          let elapsed = 0;
          while (elapsed < delayMs) {
            if (qStatusRef.current === "idle")   break outerLoop;
            if (qStatusRef.current === "paused") continue outerLoop;
            await new Promise(r => setTimeout(r, Math.min(STEP, delayMs - elapsed)));
            elapsed += STEP;
          }
          if (qStatusRef.current === "idle")   break;
          if (qStatusRef.current === "paused") continue;
        }

        setProcessingId(item.id);
        patchItem(item.id, { status: "processing" });

        const adds:  Record<string, number> = {};
        const drops: Record<string, number> = {};
        const draftPicks: SleeperTransactionPick[] = [];

        for (const a of item.giveAssets) {
          if (a.type === "player" && a.player?.sleeperId) {
            adds[a.player.sleeperId]  = item.partnerRosterId;
            drops[a.player.sleeperId] = item.userRosterId;
          } else if (a.type === "pick" && a.pick) {
            draftPicks.push({
              season:            String(a.pick.year),
              round:             a.pick.round,
              roster_id:         a.pick.originalRosterId ?? item.userRosterId,
              owner_id:          item.userRosterId,
              previous_owner_id: item.userRosterId,
            });
          }
        }
        for (const a of item.getAssets) {
          if (a.type === "player" && a.player?.sleeperId) {
            adds[a.player.sleeperId]  = item.userRosterId;
            drops[a.player.sleeperId] = item.partnerRosterId;
          } else if (a.type === "pick" && a.pick) {
            draftPicks.push({
              season:            String(a.pick.year),
              round:             a.pick.round,
              roster_id:         a.pick.originalRosterId ?? item.partnerRosterId,
              owner_id:          item.partnerRosterId,
              previous_owner_id: item.partnerRosterId,
            });
          }
        }

        if (!getSleeperToken()) {
          patchItem(item.id, { status: "skipped", skipReason: "No Sleeper auth token." });
          setProcessingId(null);
          qStatusRef.current = "paused";
          setQStatus("paused");
          setPauseMsg("Queue paused — Sleeper authentication lost. Please reconnect and resume.");
          loopActive.current = false;
          return;
        }

        let ok = false;
        let lastErr = "";

        try {
          await sleeperWriteLimiter.waitTurn("trade");
          await proposeTrade({
            leagueId: item.leagueId,
            adds, drops, draftPicks,
            expiresAt: computeExpiresAt(expiresOption),
          });
          ok = true;
        } catch (e: any) {
          lastErr = e?.message ?? "Trade proposal failed";
          if (/429|403|auth/i.test(lastErr)) {
            patchItem(item.id, { status: "failed", error: lastErr });
            setProcessingId(null);
            completed++;
            qStatusRef.current = "paused";
            setQStatus("paused");
            setPauseMsg(
              "Queue paused because Sleeper rejected one or more requests. Please review before continuing.",
            );
            loopActive.current = false;
            return;
          }
        }

        if (!ok && qStatusRef.current === "running") {
          await new Promise(r => setTimeout(r, 8_000 + Math.random() * 7_000));
          if (qStatusRef.current === "running") {
            try {
              await sleeperWriteLimiter.waitTurn("trade");
              await proposeTrade({
                leagueId: item.leagueId,
                adds, drops, draftPicks,
                expiresAt: computeExpiresAt(expiresOption),
              });
              ok = true;
            } catch (e: any) {
              lastErr = e?.message ?? "Retry failed";
            }
          }
        }

        // Fire the automatic StatChasers-link DM after a successful trade.
        // Fire-and-forget so the queue moves on immediately; the helper
        // handles the 20–60s pause + caps + dedupe internally and never
        // throws. A failed DM has no effect on the trade outcome.
        if (ok && item.partner?.ownerId) {
          const me = getSleeperSession();
          void firePostTradeLinkDm({
            recipientUserId: item.partner.ownerId,
            leagueId: item.leagueId,
            senderUserId: me?.user_id ?? null,
            queueType: "bulk-trade",
          });
        }

        patchItem(
          item.id,
          ok
            ? { status: "done", sentAt: Date.now() }
            : { status: "failed", error: lastErr },
        );
        setProcessingId(null);
        completed++;
      }
    } finally {
      loopActive.current = false;
    }

    if (qStatusRef.current === "running") {
      qStatusRef.current = "done";
      setQStatus("done");
    }
  }, [expiresOption]);

  // ── Queue controls ────────────────────────────────────────────────────────
  const startQueue = useCallback(() => {
    const inLeague: QueueItem[] = selectedTargets.map((t, i) => ({
      id:              `bt-${t.partner.id}-${Date.now()}-${i}`,
      partner:         t.partner,
      leagueId:        league.id,
      leagueName:      league.name,
      giveAssets,
      getAssets:       t.resolvedGetAssets,
      userRosterId:    parseInt(userTeam.id),
      partnerRosterId: parseInt(t.partner.id),
      status:          "pending",
      dynNet:          sumDyn(t.resolvedGetAssets) - sumDyn(giveAssets),
      rdNet:           sumRd(giveAssets)           - sumRd(t.resolvedGetAssets),
    }));
    const crossLeague: QueueItem[] = selectedCrossTargets.map((t, i) => ({
      id:              `bt-cl-${t.uid}-${Date.now()}-${i}`,
      partner:         t.partner,
      leagueId:        t.leagueId,
      leagueName:      t.leagueName,
      giveAssets,
      getAssets:       t.resolvedGetAssets,
      userRosterId:    t.userRosterId,
      partnerRosterId: parseInt(t.partner.id),
      status:          "pending",
      dynNet:          sumDyn(t.resolvedGetAssets) - sumDyn(giveAssets),
      rdNet:           sumRd(giveAssets)           - sumRd(t.resolvedGetAssets),
    }));
    const items = [...inLeague, ...crossLeague];
    // Safety preflight — kill switch + soft cap. Aborts the start when the
    // gate refuses; the caller-facing notice below already explains why.
    const pre = preflightBatch({ action: "trade", batchSize: items.length });
    if (!pre.ok) {
      setPauseMsg(
        pre.blockedReason === "kill-switch"
          ? "Sleeper actions are temporarily paused by StatChasers for safety. Please try again later."
          : "Batch cancelled.",
      );
      return;
    }
    queueRef.current   = items;
    qStatusRef.current = "running";
    setQueueItems(items);
    setQStatus("running");
    setProcessingId(null);
    setPauseMsg(null);
    runQueueLoop();
  }, [selectedTargets, selectedCrossTargets, league, userTeam, giveAssets, runQueueLoop]);

  const pauseQueue  = () => { if (qStatusRef.current === "running") { qStatusRef.current = "paused"; setQStatus("paused"); } };
  const resumeQueue = () => {
    if (qStatusRef.current === "paused") {
      qStatusRef.current = "running";
      setQStatus("running");
      setPauseMsg(null);
      if (!loopActive.current) runQueueLoop();
    }
  };
  const cancelQueue = () => {
    qStatusRef.current = "idle";
    setQStatus("idle");
    setProcessingId(null);
    setQueueItems(prev =>
      prev.map(i =>
        i.status === "pending" || i.status === "processing"
          ? { ...i, status: "skipped", skipReason: "Cancelled" }
          : i,
      ),
    );
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToStep2 = () => { validateTargets(); setStep(2); };
  const goToStep3 = () => { setConfirmed(false); setStep(3); };
  const goToStep4 = () => { setStep(4); startQueue(); };

  const resetAll = () => {
    setStep(1);
    setGiveAssets([]);
    setGetAssets([]);
    setTargets(prev => prev.map(t => ({ ...t, selected: false, warnings: [], blockers: [], resolvedGetAssets: [] })));
    setConfirmed(false);
    qStatusRef.current = "idle";
    setQStatus("idle");
    setQueueItems([]);
    setProcessingId(null);
    setPauseMsg(null);
    setCrossTargets([]);
    setClScanState("idle");
    setClProgress(0);
    setClTotal(0);
  };

  // ── Derived queue metrics ─────────────────────────────────────────────────
  const completedCount = queueItems.filter(i => ["done","failed","skipped"].includes(i.status)).length;
  const pendingCount   = queueItems.filter(i => ["pending","processing"].includes(i.status)).length;
  const doneCount      = queueItems.filter(i => i.status === "done").length;
  const failedCount    = queueItems.filter(i => i.status === "failed").length;

  // ── Step breadcrumb ───────────────────────────────────────────────────────
  const stepLabels = ["Build Offer", "Choose Targets", "Review", "Queue"] as const;
  const StepCrumb = () => (
    <div className="flex items-center gap-1.5 flex-wrap">
      {([1, 2, 3, 4] as const).map((n, idx) => (
        <div key={n} className="flex items-center gap-1.5">
          <span className={cn(
            "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0",
            n === step  ? "bg-[#d4af37] text-black"   :
            n < step    ? "bg-emerald-600 text-white"  :
                          "bg-muted text-muted-foreground",
          )}>
            {n < step ? "✓" : n}
          </span>
          <span className={cn(
            "text-[11px] font-medium",
            n === step ? "text-foreground" : "text-muted-foreground/50",
          )}>
            {stepLabels[n - 1]}
          </span>
          {idx < 3 && <span className="text-muted-foreground/30 text-[10px]">›</span>}
        </div>
      ))}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5" data-testid="bulk-trade-workspace">

      {/* Top nav */}
      <div className="flex items-start gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground mt-0.5 flex-shrink-0 transition-colors"
            data-testid="btn-bulk-back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <StepCrumb />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Bulk Trade lets you prepare similar offers across managers and send them gradually through a safe queue.
          </p>
        </div>
      </div>

      {/* ── STEP 1: Build Offer ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">

          {/* You Send */}
          <Card className="p-5">
            <div className="mb-3">
              <h4 className="text-sm font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                You Send
              </h4>
              <span className="block h-[2px] w-6 bg-[#d4af37] rounded-full mt-1" />
            </div>
            <div className="flex flex-wrap gap-2 min-h-[40px] items-start">
              {giveAssets.map(a => (
                <AssetChip
                  key={a.uid}
                  asset={a}
                  onRemove={() => setGiveAssets(prev => prev.filter(x => x.uid !== a.uid))}
                />
              ))}
              <button
                onClick={() => setAddingTo("give")}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-[#d4af37]/50 text-[#d4af37] text-xs hover:bg-[#d4af37]/5 transition-colors"
                data-testid="btn-add-give-asset"
              >
                <Plus className="w-3 h-3" /> Add Asset
              </button>
            </div>
          </Card>

          {/* You Want */}
          <Card className="p-5">
            <div className="mb-3">
              <h4 className="text-sm font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                You Want
                <span className="text-[10px] font-normal text-muted-foreground">(template — checked per partner)</span>
              </h4>
              <span className="block h-[2px] w-6 bg-[#d4af37] rounded-full mt-1" />
            </div>
            <div className="flex flex-wrap gap-2 min-h-[40px] items-start">
              {getAssets.map(a => (
                <AssetChip
                  key={a.uid}
                  asset={a}
                  onRemove={() => setGetAssets(prev => prev.filter(x => x.uid !== a.uid))}
                />
              ))}
              <button
                onClick={() => setAddingTo("get")}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-emerald-500/50 text-emerald-500 text-xs hover:bg-emerald-500/5 transition-colors"
                data-testid="btn-add-get-asset"
              >
                <Plus className="w-3 h-3" /> Add Asset
              </button>
            </div>
          </Card>

          {/* Value snapshot */}
          {(giveAssets.length > 0 || getAssets.length > 0) && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Dynasty delta",  val: dynNet, fmt: (v: number) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}`, color: dynNet > 0 ? "text-emerald-500" : dynNet < 0 ? "text-amber-500" : "text-foreground" },
                { label: "Partner win-now",val: rdNet,  fmt: (v: number) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}`, color: rdNet  > 0 ? "text-blue-400"   : "text-muted-foreground" },
                { label: "Assets",         val: 0,      fmt: () => `${giveAssets.length}↔${getAssets.length}`,                     color: "text-foreground" },
              ].map(({ label, val, fmt, color }) => (
                <div key={label} className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={cn("text-sm font-bold tabular-nums", color)}>{fmt(val)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Expiry + continue */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground flex-shrink-0">Expires:</span>
            <select
              value={expiresOption}
              onChange={e => setExpiresOption(e.target.value)}
              className="text-xs border border-border rounded-lg px-2 py-1 bg-background text-foreground"
              data-testid="select-bulk-expiry"
            >
              <option value="never">Never</option>
              <option value="1h">1 Hour</option>
              <option value="24h">24 Hours</option>
              <option value="2d">2 Days</option>
              <option value="1w">1 Week</option>
            </select>
          </div>

          <Button
            className="w-full bg-[#0b3a7a] hover:bg-[#0b3a7a]/80 text-white"
            onClick={goToStep2}
            disabled={giveAssets.length === 0 || getAssets.length === 0}
            data-testid="btn-bulk-step1-continue"
          >
            Choose Targets →
          </Button>
        </div>
      )}

      {/* ── STEP 2: Choose Targets ───────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold">Choose Targets</h4>
              <span className="block h-[2px] w-6 bg-[#d4af37] rounded-full mt-1" />
              <p className="text-[10px] text-muted-foreground mt-1">
                {selectedTargets.length + selectedCrossTargets.length} manager{(selectedTargets.length + selectedCrossTargets.length) !== 1 ? "s" : ""} selected
                · {league.name}
                {selectedCrossTargets.length > 0 && ` + ${selectedCrossTargets.length} cross-league`}
              </p>
            </div>
            <button
              onClick={() => setTargets(prev => {
                const anySelected = prev.some(t => t.selected);
                return prev.map(t => ({ ...t, selected: t.blockers.length === 0 ? !anySelected : false }));
              })}
              className="text-[11px] text-[#d4af37] hover:underline"
              data-testid="btn-bulk-toggle-all"
            >
              {targets.some(t => t.selected) ? "Deselect all" : "Select all eligible"}
            </button>
          </div>

          {!isSleeperAuthed && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-500">
                Connect your Sleeper account to queue trade offers.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {targets.map(target => {
              const isBlocked  = target.blockers.length > 0;
              const hasWarning = target.warnings.length > 0;
              return (
                <div
                  key={target.partner.id}
                  onClick={() => !isBlocked && setTargets(prev =>
                    prev.map(t =>
                      t.partner.id === target.partner.id ? { ...t, selected: !t.selected } : t,
                    ),
                  )}
                  className={cn(
                    "rounded-xl border p-4 transition-colors",
                    isBlocked                                 ? "border-border/30 opacity-45 cursor-not-allowed" :
                    target.selected                           ? "border-[#d4af37]/40 bg-[#d4af37]/5 cursor-pointer" :
                                                                "border-border/50 hover:border-border cursor-pointer",
                  )}
                  data-testid={`target-card-${target.partner.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                      target.selected ? "bg-[#d4af37] border-[#d4af37]" : "border-border",
                    )}>
                      {target.selected && <CheckCircle2 className="w-2.5 h-2.5 text-black" />}
                    </div>
                    <img
                      src={target.partner.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                      alt={target.partner.owner}
                      className="w-7 h-7 rounded-full object-cover bg-muted flex-shrink-0"
                      onError={e => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold">{target.partner.name}</span>
                      <span className="text-xs text-muted-foreground ml-1.5">{target.partner.owner}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isBlocked ? (
                        <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/30 whitespace-nowrap">
                          {target.blockers[0]}
                        </Badge>
                      ) : hasWarning ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 cursor-default" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[200px] text-[10px] space-y-0.5">
                            {target.warnings.map((w, i) => <p key={i}>{w}</p>)}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                    </div>
                  </div>
                  {hasWarning && !isBlocked && (
                    <div className="mt-2 ml-7 flex flex-wrap gap-1">
                      {target.warnings.slice(0, 2).map((w, i) => (
                        <span key={i} className="text-[9px] text-amber-500 bg-amber-500/10 rounded px-1.5 py-0.5">{w}</span>
                      ))}
                      {target.warnings.length > 2 && (
                        <span className="text-[9px] text-muted-foreground">+{target.warnings.length - 2} more</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Scan All My Leagues ─────────────────────────────────────── */}
          <div className="rounded-xl border border-border/50 overflow-hidden" data-testid="cross-league-scan-section">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <h5 className="text-xs font-bold flex items-center gap-1.5">
                  <ScanLine className="w-3.5 h-3.5 text-[#d4af37]" />
                  Scan All My Leagues
                </h5>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Find partners in your other leagues who own your target asset.
                </p>
              </div>
              <button
                onClick={handleCrossLeagueScan}
                disabled={
                  clScanState === "scanning" ||
                  !sleeperCtx.user ||
                  !giveAssets.some(a => a.type === "player") ||
                  !getAssets.some(a => a.type === "player")
                }
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex-shrink-0 ml-3",
                  clScanState === "scanning"
                    ? "bg-muted/30 text-muted-foreground/40 cursor-not-allowed"
                    : clScanState === "done"
                    ? "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                    : (!sleeperCtx.user || !giveAssets.some(a => a.type === "player") || !getAssets.some(a => a.type === "player"))
                    ? "bg-muted/30 text-muted-foreground/40 cursor-not-allowed"
                    : "bg-[#0b3a7a] text-white hover:bg-[#0b3a7a]/80",
                )}
                data-testid="btn-cross-league-scan"
              >
                {clScanState === "scanning" ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> {clProgress}/{clTotal}</>
                ) : clScanState === "done" ? (
                  <><RefreshCw className="w-3 h-3" /> Re-scan</>
                ) : (
                  <><ScanLine className="w-3 h-3" /> Scan {sleeperCtx.leagues?.length ?? ""} Leagues</>
                )}
              </button>
            </div>

            {clScanState === "scanning" && clTotal > 0 && (
              <div className="px-4 pb-3">
                <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#d4af37]/60 transition-all duration-300"
                    style={{ width: `${Math.round((clProgress / clTotal) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {crossTargets.length > 0 && (
              <div className="border-t border-border/30 divide-y divide-border/20">
                {crossTargets.map(t => (
                  <div
                    key={t.uid}
                    onClick={() => setCrossTargets(prev => prev.map(ct =>
                      ct.uid === t.uid ? { ...ct, selected: !ct.selected } : ct,
                    ))}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                      t.selected ? "bg-[#d4af37]/5" : "hover:bg-muted/20",
                    )}
                    data-testid={`cross-target-${t.uid}`}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                      t.selected ? "bg-[#d4af37] border-[#d4af37]" : "border-border",
                    )}>
                      {t.selected && <CheckCircle2 className="w-2.5 h-2.5 text-black" />}
                    </div>
                    <img
                      src={t.partner.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                      alt={t.partner.owner}
                      className="w-7 h-7 rounded-full object-cover bg-muted flex-shrink-0"
                      onError={e => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{t.partner.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{t.partner.owner} · {t.leagueName}</p>
                    </div>
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0",
                      Math.abs(t.delta) < 50 ? "text-muted-foreground bg-muted/40" :
                      t.delta > 0 ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10",
                    )}>
                      {Math.abs(t.delta) < 50 ? "≈ Even" : `${t.delta > 0 ? "+" : ""}${Math.round(t.delta).toLocaleString()} dyn`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {clScanState === "done" && crossTargets.length === 0 && (
              <p className="px-4 pb-3 text-center text-[11px] text-muted-foreground/60">
                No additional trade partners found in your other leagues.
              </p>
            )}

            {!sleeperCtx.user && (
              <p className="px-4 pb-3 text-center text-[11px] text-muted-foreground/50">
                Connect your Sleeper account to scan across leagues.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1" data-testid="btn-bulk-step2-back">
              ← Back
            </Button>
            <Button
              className="flex-1 bg-[#0b3a7a] hover:bg-[#0b3a7a]/80 text-white"
              onClick={goToStep3}
              disabled={selectedTargets.length === 0 && selectedCrossTargets.length === 0}
              data-testid="btn-bulk-step2-continue"
            >
              {(() => {
                const n = selectedTargets.length + selectedCrossTargets.length;
                return `Review ${n > 0 ? `${n} ` : ""}Offer${n !== 1 ? "s" : ""} →`;
              })()}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Review ───────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-bold">Review Offers</h4>
            <span className="block h-[2px] w-6 bg-[#d4af37] rounded-full mt-1" />
            <p className="text-[10px] text-muted-foreground mt-1">
              {selectedTargets.length} offer{selectedTargets.length !== 1 ? "s" : ""} queued · safe delays between sends
            </p>
          </div>

          {isWriteEnabled() ? (
            <SafePacingNotice
              variant="idle"
              batchSize={selectedTargets.length + selectedCrossTargets.length}
            />
          ) : (
            <SafePacingNotice variant="kill" />
          )}

          <div className="space-y-3">
            {selectedTargets.map(target => {
              const resolvedGet = target.resolvedGetAssets.length > 0 ? target.resolvedGetAssets : getAssets;
              const localDynNet = sumDyn(resolvedGet) - sumDyn(giveAssets);
              const localRdNet  = sumRd(giveAssets)   - sumRd(resolvedGet);
              return (
                <div
                  key={target.partner.id}
                  className="rounded-xl border border-border/50 p-4 bg-muted/10"
                  data-testid={`review-card-${target.partner.id}`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <img
                      src={target.partner.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                      alt={target.partner.owner}
                      className="w-6 h-6 rounded-full object-cover bg-muted flex-shrink-0"
                      onError={e => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                    />
                    <span className="text-sm font-semibold">{target.partner.name}</span>
                    <span className="text-xs text-muted-foreground">{target.partner.owner}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/60 truncate max-w-[120px]">{league.name}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_22px_1fr] gap-2 items-start">
                    <div>
                      <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">You Send</p>
                      <div className="flex flex-wrap gap-1">
                        {giveAssets.map(a => <AssetChip key={a.uid} asset={a} size="sm" />)}
                      </div>
                    </div>
                    <div className="flex items-center justify-center pt-4">
                      <ArrowRightLeft className="w-3 h-3 text-muted-foreground/50" />
                    </div>
                    <div>
                      <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">You Receive</p>
                      <div className="flex flex-wrap gap-1">
                        {resolvedGet.map(a => <AssetChip key={a.uid} asset={a} size="sm" />)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-border/30 flex items-center gap-1.5 flex-wrap">
                    <Badge
                      variant={localDynNet > 0 ? "default" : "secondary"}
                      className={cn("text-[9px]", localDynNet > 0 && "bg-emerald-600 text-white border-0")}
                    >
                      {localDynNet > 0 ? "+" : ""}{Math.round(localDynNet).toLocaleString()} dynasty
                    </Badge>
                    {localRdNet > 0 && (
                      <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">
                        partner +{Math.round(localRdNet).toLocaleString()} win-now
                      </Badge>
                    )}
                    {target.warnings.length > 0 && (
                      <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/30">
                        {target.warnings.length} warning{target.warnings.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cross-league selected targets */}
          {selectedCrossTargets.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider px-0.5">Cross-League</p>
              {selectedCrossTargets.map(target => {
                const localDynNet = sumDyn(target.resolvedGetAssets) - sumDyn(giveAssets);
                const localRdNet  = sumRd(giveAssets)               - sumRd(target.resolvedGetAssets);
                return (
                  <div
                    key={target.uid}
                    className="rounded-xl border border-border/50 p-4 bg-muted/10"
                    data-testid={`review-cross-card-${target.uid}`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <img
                        src={target.partner.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                        alt={target.partner.owner}
                        className="w-6 h-6 rounded-full object-cover bg-muted flex-shrink-0"
                        onError={e => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                      />
                      <span className="text-sm font-semibold">{target.partner.name}</span>
                      <span className="text-xs text-muted-foreground">{target.partner.owner}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground/60 truncate max-w-[120px]">{target.leagueName}</span>
                    </div>
                    <div className="grid grid-cols-[1fr_22px_1fr] gap-2 items-start">
                      <div>
                        <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">You Send</p>
                        <div className="flex flex-wrap gap-1">
                          {giveAssets.map(a => <AssetChip key={a.uid} asset={a} size="sm" />)}
                        </div>
                      </div>
                      <div className="flex items-center justify-center pt-4">
                        <ArrowRightLeft className="w-3 h-3 text-muted-foreground/50" />
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">You Receive</p>
                        <div className="flex flex-wrap gap-1">
                          {target.resolvedGetAssets.map(a => <AssetChip key={a.uid} asset={a} size="sm" />)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/30 flex items-center gap-1.5 flex-wrap">
                      <Badge
                        variant={localDynNet > 0 ? "default" : "secondary"}
                        className={cn("text-[9px]", localDynNet > 0 && "bg-emerald-600 text-white border-0")}
                      >
                        {localDynNet > 0 ? "+" : ""}{Math.round(localDynNet).toLocaleString()} dynasty
                      </Badge>
                      {localRdNet > 0 && (
                        <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">
                          partner +{Math.round(localRdNet).toLocaleString()} win-now
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Safe queue info */}
          <div className="rounded-lg border border-[#0b3a7a]/30 bg-[#0b3a7a]/10 p-3.5 space-y-1.5">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#d4af37]" /> Safe Queue Mode
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Offers are sent with 45–120 second gaps. After every 5 offers the queue pauses 3–7 minutes.
              After every 10 it pauses 8–15 minutes. You can pause or cancel at any time.
            </p>
          </div>

          {/* Confirmation checkbox */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 flex-shrink-0 accent-[#d4af37]"
              data-testid="checkbox-bulk-confirm"
            />
            <span className="text-xs text-muted-foreground select-none">
              I understand these trade offers will be queued and sent gradually. I have reviewed each offer above.
            </span>
          </label>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)} className="flex-1" data-testid="btn-bulk-step3-back">
              ← Back
            </Button>
            <Button
              className="flex-1 bg-[#d4af37] hover:bg-[#d4af37]/80 text-black font-semibold"
              onClick={goToStep4}
              disabled={!confirmed || selectedTargets.length === 0}
              data-testid="btn-bulk-queue-trades"
            >
              <Package className="w-3.5 h-3.5 mr-1.5" />
              Queue {selectedTargets.length} Trade{selectedTargets.length !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Queue ────────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">

          {/* Status banner */}
          <div className="rounded-xl border border-[#0b3a7a]/30 bg-[#0b3a7a]/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-bold">
                  {qStatus === "done"    ? "Queue Complete"  :
                   qStatus === "paused"  ? "Queue Paused"    :
                   qStatus === "running" ? "Queue Running"   :
                                          "Queue Ready"}
                </h4>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {doneCount} sent · {failedCount} failed · {pendingCount} pending
                  {qStatus === "running" && pendingCount > 0 && (
                    <> · {fmtEta(estimateTradeQueueMs(completedCount, pendingCount))} remaining</>
                  )}
                </p>
              </div>
              <div className="flex gap-1.5">
                {qStatus === "running" && (
                  <button
                    onClick={pauseQueue}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                    data-testid="btn-queue-pause"
                  >
                    <Pause className="w-3 h-3" /> Pause
                  </button>
                )}
                {qStatus === "paused" && (
                  <button
                    onClick={resumeQueue}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37]/10 transition-colors"
                    data-testid="btn-queue-resume"
                  >
                    <Play className="w-3 h-3" /> Resume
                  </button>
                )}
                {(qStatus === "running" || qStatus === "paused") && (
                  <button
                    onClick={cancelQueue}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
                    data-testid="btn-queue-cancel"
                  >
                    <X className="w-3 h-3" /> Cancel
                  </button>
                )}
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#d4af37] transition-all duration-700"
                style={{ width: queueItems.length > 0 ? `${(completedCount / queueItems.length) * 100}%` : "0%" }}
              />
            </div>
          </div>

          {/* Pause message */}
          {pauseMsg && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-500">{pauseMsg}</p>
            </div>
          )}

          {/* Pacing notice — shown while queue is running so the user
               understands the long gaps between sends. */}
          {qStatus === "running" && !pauseMsg && (
            <SafePacingNotice variant="active" message="Submitting trades safely — Dynasty Command paces each send like a real user." />
          )}

          {/* Queue items */}
          <div className="space-y-2">
            {queueItems.map(item => (
              <div
                key={item.id}
                className={cn(
                  "rounded-lg border p-3 flex items-center gap-3 transition-colors",
                  item.status === "done"       ? "border-emerald-500/20 bg-emerald-500/5" :
                  item.status === "failed"     ? "border-red-500/20 bg-red-500/5" :
                  item.status === "skipped"    ? "border-border/20 opacity-40" :
                  item.status === "processing" ? "border-[#d4af37]/30 bg-[#d4af37]/5" :
                                                 "border-border/40",
                )}
                data-testid={`queue-item-${item.id}`}
              >
                <div className="flex-shrink-0 w-4 flex justify-center">
                  {item.status === "done"       && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  {item.status === "failed"     && <X className="w-4 h-4 text-red-500" />}
                  {item.status === "skipped"    && <SkipForward className="w-4 h-4 text-muted-foreground" />}
                  {item.status === "processing" && <Loader2 className="w-4 h-4 text-[#d4af37] animate-spin" />}
                  {item.status === "pending"    && <Clock className="w-4 h-4 text-muted-foreground/50" />}
                </div>
                <img
                  src={item.partner.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                  alt={item.partner.owner}
                  className="w-6 h-6 rounded-full object-cover bg-muted flex-shrink-0"
                  onError={e => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{item.partner.name}</p>
                  {item.status === "failed"  && item.error      && <p className="text-[10px] text-red-400 truncate">{item.error}</p>}
                  {item.status === "skipped" && item.skipReason && <p className="text-[10px] text-muted-foreground truncate">{item.skipReason}</p>}
                  {item.status === "done"    && item.sentAt     && <p className="text-[10px] text-muted-foreground">Sent {new Date(item.sentAt).toLocaleTimeString()}</p>}
                  {item.status === "pending" && <p className="text-[10px] text-muted-foreground">Queued</p>}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] flex-shrink-0",
                    item.status === "done"       ? "text-emerald-500 border-emerald-500/30" :
                    item.status === "failed"     ? "text-red-500 border-red-500/30" :
                    item.status === "processing" ? "text-[#d4af37] border-[#d4af37]/30" :
                    item.status === "skipped"    ? "text-muted-foreground border-border/30" :
                                                   "text-muted-foreground/60 border-border/30",
                  )}
                >
                  {item.status === "processing" ? "Sending…"  :
                   item.status === "done"        ? "Sent"      :
                   item.status === "failed"      ? "Failed"    :
                   item.status === "skipped"     ? "Skipped"   : "Pending"}
                </Badge>
              </div>
            ))}
          </div>

          {/* Done actions */}
          {(qStatus === "done" || qStatus === "idle") && queueItems.length > 0 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={resetAll}
                className="flex-1"
                data-testid="btn-bulk-new"
              >
                New Bulk Trade
              </Button>
              {onBack && (
                <Button
                  variant="outline"
                  onClick={onBack}
                  className="flex-1"
                  data-testid="btn-bulk-done-back"
                >
                  Back to Finder
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Asset selector modal ─────────────────────────────────────────────── */}
      {addingTo && (
        <AssetSelectorModal
          side={addingTo}
          userTeam={userTeam}
          otherTeams={otherTeams}
          alreadySelected={addingTo === "give" ? giveAssets : getAssets}
          onAdd={asset => {
            if (addingTo === "give") setGiveAssets(prev => [...prev, asset]);
            else                    setGetAssets(prev  => [...prev, asset]);
            setAddingTo(null);
          }}
          onClose={() => setAddingTo(null)}
          getPlayerValue={getPlayerValue}
          getRedraftValue={getRedraftValue}
          getPickValue={getPickValue}
        />
      )}
    </div>
  );
}
