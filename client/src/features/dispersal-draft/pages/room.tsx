import React, { useState, useMemo, useRef, useEffect } from "react";
import { BankTimer } from "@dispersal/components/bank-timer";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "@dispersal/router";
import { Home, Lock, Unlock, ChevronDown, Download } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  useGetDraftRoom, 
  getGetDraftRoomQueryKey,
  useJoinDraftRoom,
  useMakePick,
  useManualPick,
  useUndoLastPick,
  useStartDraft,
  usePauseDraft,
  useResumeDraft,
  useUpdateDraftRoom,
  useDeleteDraftRoom,
  useListAssets,
  getListAssetsQueryKey,
  exportPicksCsv
} from "@dispersal/api";
import { useDraftSocket } from "@dispersal/hooks/use-draft-socket";
import { useDraftRoomState } from "@dispersal/hooks/use-draft-room-state";
import { useRecentRooms } from "@dispersal/hooks/use-recent-rooms";
import { useAssetQueue } from "@dispersal/hooks/use-asset-queue";
import { useSleeperLeague, deriveScoringHighlights, categorizeRosterPositions } from "@dispersal/hooks/use-sleeper-league";
import { useSoundSettings } from "@dispersal/hooks/use-sound-settings";
import { SoundToggle } from "@dispersal/components/sound-toggle";
import { unlockAudio, playPickSound, playOnClockSound, playDraftStartSound, playJoinSound, playRoomOpenFanfare } from "@dispersal/lib/sounds";
import { ChatPanel } from "@dispersal/components/chat-panel";
import { sleeperThumb, sleeperTeamLogo, positionColor, positionBarColor, positionAvatarStyle } from "@dispersal/lib/sleeper";
import { PickBadgeGroup } from "@dispersal/components/pick-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

const joinSchema = z.object({
  username: z.string().min(1, "Username is required")
});

export default function Room() {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { commissionerToken, participantId, setParticipantId } = useDraftRoomState(code);
  const { saveRoom } = useRecentRooms();

  const { data: detail, isLoading } = useGetDraftRoom(code, {
    query: {
      enabled: !!code,
      queryKey: getGetDraftRoomQueryKey(code),
      refetchInterval: 8000,
    }
  });

  // Save to recently-visited rooms whenever detail loads
  useEffect(() => {
    if (!detail?.room) return;
    saveRoom({
      shareCode: detail.room.shareCode,
      leagueName: detail.room.leagueName,
      role: commissionerToken ? "commissioner" : "manager",
    });
  }, [detail?.room?.shareCode]);

  const { data: allAssets } = useListAssets(detail?.room?.id || 0, { drafted: "false" }, {
    query: {
      enabled: !!detail?.room?.id,
      queryKey: getListAssetsQueryKey(detail?.room?.id || 0, { drafted: "false" })
    }
  });

  useDraftSocket(detail?.room?.id, code);

  const [assetType, setAssetType] = useState<"all" | "Player" | "Pick" | "FAAB">("all");
  const [positionFilter, setPositionFilter] = useState<"all" | "QB" | "RB" | "WR" | "TE">("all");
  const [pickYearFilter, setPickYearFilter] = useState<string>("all");
  const [pickRoundFilter, setPickRoundFilter] = useState<string>("all");
  const [assetSort, setAssetSort] = useState<"alpha" | "position">("position");
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedAssetToPick, setSelectedAssetToPick] = useState<number | null>(null);
  const { queue, toggleQueue, removeFromQueue, clearQueue, moveQueueUp, moveQueueDown } = useAssetQueue(detail?.room?.id ?? 0);
  const { data: sleeperLeague, isLoading: sleeperLoading, error: sleeperError } = useSleeperLeague(detail?.room?.sleeperLeagueId);
  const [sleeperIdInput, setSleeperIdInput] = useState(detail?.room?.sleeperLeagueId ?? "");
  const [sleeperIdSaving, setSleeperIdSaving] = useState(false);

  // Auto-remove drafted assets from queue when they leave the pool
  const allAssetIdSet = useMemo(() => new Set((allAssets ?? []).map(a => a.id)), [allAssets]);
  useEffect(() => {
    if (allAssets === undefined) return;
    queue.forEach(id => { if (!allAssetIdSet.has(id)) removeFromQueue(id); });
  }, [allAssetIdSet]); // only re-run when available asset set changes, not on every queue mutation
  const [exitingAssets, setExitingAssets] = useState<Map<number, { name: string; position: string | null; team: string | null; type: string; notes: string | null; draftedBy: string }>>(new Map());
  const exitPickCountRef = useRef(0);

  // Track newly-landed picks for the pick-land animation (must be before early returns)
  const [recentPickIds, setRecentPickIds] = useState<Set<number>>(new Set());
  const prevPickIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const livePicks = detail?.picks ?? [];
    const currentIds = new Set(livePicks.map(p => p.id));
    const newIds = Array.from(currentIds).filter(id => !prevPickIdsRef.current.has(id));
    if (newIds.length > 0 && prevPickIdsRef.current.size > 0) {
      setRecentPickIds(prev => new Set([...Array.from(prev), ...newIds]));
      newIds.forEach(id => {
        setTimeout(() => {
          setRecentPickIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        }, 900);
      });
    }
    prevPickIdsRef.current = currentIds;
  }, [detail?.picks]);

  // Animate assets out when they get drafted
  useEffect(() => {
    const livePicks = detail?.picks ?? [];
    if (livePicks.length > exitPickCountRef.current && exitPickCountRef.current > 0) {
      const newPicks = livePicks.slice(exitPickCountRef.current);
      for (const pick of newPicks) {
        const asset = (detail?.assets ?? []).find(a => a.id === pick.assetId);
        const assetInfo = {
          name: asset?.name ?? pick.assetName ?? "Player",
          position: asset?.position ?? null,
          team: asset?.team ?? null,
          type: asset?.type ?? "Player",
          notes: asset?.notes ?? null,
          draftedBy: pick.participantUsername ?? "Unknown",
        };
        const aid = pick.assetId;
        setExitingAssets(prev => { const n = new Map(prev); n.set(aid, assetInfo); return n; });
        setTimeout(() => {
          setExitingAssets(prev => { const n = new Map(prev); n.delete(aid); return n; });
        }, 2200);
      }
    }
    exitPickCountRef.current = livePicks.length;
  }, [detail?.picks?.length]);

  const joinDraft = useJoinDraftRoom();
  const makePick = useMakePick();
  const manualPick = useManualPick();
  const isDraftPending = makePick.isPending || manualPick.isPending;
  const undoPick = useUndoLastPick();
  const startDraft = useStartDraft();
  const pauseDraft = usePauseDraft();
  const resumeDraft = useResumeDraft();

  const joinForm = useForm<z.infer<typeof joinSchema>>({
    resolver: zodResolver(joinSchema),
    defaultValues: { username: "" }
  });

  // Must be before early returns (Rules of Hooks)
  const sortedParticipants = useMemo(() =>
    (detail?.participants ?? [])
      .filter(p => !p.isCommissioner)
      .sort((a, b) => (a.draftPosition || 99) - (b.draftPosition || 99)),
    [detail?.participants]
  );

  // Map assetId → full Asset (includes drafted assets via detail?.assets)
  const assetMap = useMemo(() => {
    const m = new Map<number, { id: number; name: string; type: string; position: string | null; team: string | null; notes: string | null }>();
    (detail?.assets ?? []).forEach(a => m.set(a.id, a));
    return m;
  }, [detail?.assets]);

  const allSlotNames = useMemo(() => {
    const names = new Set<string>();
    (allAssets || []).forEach(a => {
      // Only derive slot names from player assets — picks can be tagged with
      // origin-team names (active managers) which would create phantom slots
      if (a.type?.toLowerCase() !== 'player') return;
      const m = a.notes?.match(/From:\s*(.+?)(?:\s*·|$)/);
      if (m?.[1]) names.add(m[1].trim());
    });
    (detail?.participants ?? []).forEach(p => {
      if (p.orphanTeamName) names.add(p.orphanTeamName);
    });
    return Array.from(names).sort();
  }, [allAssets, detail?.participants]);

  const onJoinSubmit = (values: z.infer<typeof joinSchema>) => {
    if (!detail?.room?.id) return;
    joinDraft.mutate({ id: detail.room.id, data: { username: values.username } }, {
      onSuccess: (p) => {
        setParticipantId(p.id);
        toast({ title: "Joined room!" });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.data?.error || "Could not join", variant: "destructive" });
      }
    });
  };

  const onConfirmPick = () => {
    if (!detail?.room?.id || !participantId || !selectedAssetToPick) return;
    makePick.mutate({ id: detail.room.id, data: { participantId, assetId: selectedAssetToPick } }, {
      onSuccess: () => {
        setSelectedAssetToPick(null);
        toast({ title: "Pick successful!" });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.data?.error || "Could not make pick", variant: "destructive" });
        setSelectedAssetToPick(null);
      }
    });
  };

  const isCommissioner = !!commissionerToken;
  const queryClient = useQueryClient();
  const updateRoom = useUpdateDraftRoom();
  const deleteRoom = useDeleteDraftRoom();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [removingParticipantId, setRemovingParticipantId] = useState<number | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [retracting, setRetracting] = useState(false);
  const [mobileTab, setMobileTab] = useState<'order' | 'board' | 'assets' | 'roster' | 'settings' | 'chat'>('board');
  const [rightTab, setRightTab] = useState<'assets' | 'roster' | 'settings' | 'chat'>('assets');
  const [viewRosterParticipantId, setViewRosterParticipantId] = useState<number | null>(null);
  const [assetsSubTab, setAssetsSubTab] = useState<'pool' | 'queue'>('pool');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Sound settings
  const { level: soundLevel, cycle: cycleSoundLevel } = useSoundSettings();

  // Keep a always-current ref for soundLevel so event handlers don't go stale
  const soundLevelRef = useRef(soundLevel);
  useEffect(() => { soundLevelRef.current = soundLevel; }, [soundLevel]);

  // Unlock AudioContext on first user gesture, then play the room-open fanfare once
  const fanfarePlayed = useRef(false);
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      if (!fanfarePlayed.current && soundLevelRef.current !== "off") {
        fanfarePlayed.current = true;
        playRoomOpenFanfare();
      }
    };
    window.addEventListener("click", unlock, true);
    window.addEventListener("touchstart", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);

  // Sound: pick submitted (fires when picks count increases)
  const prevPickCountRef = useRef(0);
  useEffect(() => {
    const count = detail?.picks?.length ?? 0;
    if (count > prevPickCountRef.current && prevPickCountRef.current > 0) {
      if (soundLevel !== "off") playPickSound();
    }
    prevPickCountRef.current = count;
  }, [detail?.picks?.length, soundLevel]);

  // Sound: on the clock — only plays for the manager whose turn just started
  const prevOnClockRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const current = detail?.onTheClockParticipantId;
    if (current !== undefined && current !== prevOnClockRef.current) {
      if (current !== null && current === participantId && soundLevel !== "off") {
        playOnClockSound();
      }
    }
    prevOnClockRef.current = current;
  }, [detail?.onTheClockParticipantId, soundLevel, participantId]);

  // Sound: draft started
  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = detail?.room?.status;
    if (status === "active" && prevStatusRef.current === "setup") {
      if (soundLevel !== "off") playDraftStartSound();
    }
    prevStatusRef.current = status;
  }, [detail?.room?.status, soundLevel]);

  // Sound: participant joined (all-sounds only)
  const prevParticipantCountRef = useRef(0);
  useEffect(() => {
    const count = (detail?.participants ?? []).filter(p => !p.isCommissioner).length;
    if (count > prevParticipantCountRef.current && prevParticipantCountRef.current > 0) {
      if (soundLevel === "all") playJoinSound();
    }
    prevParticipantCountRef.current = count;
  }, [detail?.participants?.length, soundLevel]);

  const retractPick = async () => {
    if (!participantId || !detail?.room?.id || retracting) return;
    setRetracting(true);
    try {
      const res = await fetch(`/api/draft-rooms/${detail.room.id}/picks/retract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        toast({ title: "Cannot change pick", description: data.error, variant: "destructive" });
      }
    } finally {
      setRetracting(false);
    }
  };

  const assignToSlot = async (participantId: number, draftPosition: number, orphanTeamName: string) => {
    if (!detail?.room?.id) return;
    setAssigning(true);
    try {
      await fetch(`/api/draft-rooms/${detail.room.id}/participants/${participantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionerToken, draftPosition, orphanTeamName }),
      });
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
    } finally {
      setAssigning(false);
    }
  };

  const unassignFromSlot = async (participantId: number) => {
    if (!detail?.room?.id) return;
    setAssigning(true);
    try {
      await fetch(`/api/draft-rooms/${detail.room.id}/participants/${participantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionerToken, draftPosition: null, orphanTeamName: null }),
      });
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
    } finally {
      setAssigning(false);
    }
  };

  const randomizeUnassigned = async () => {
    if (!detail?.room?.id) return;
    const unassigned = detail.participants.filter(p => !p.isCommissioner && p.draftPosition === null);
    if (unassigned.length === 0) return;
    const takenPositions = new Set(
      detail.participants.filter(p => p.draftPosition !== null).map(p => p.draftPosition as number)
    );
    const openPositions: number[] = [];
    for (let pos = 1; pos <= detail.room.numOrphanSlots; pos++) {
      if (!takenPositions.has(pos)) openPositions.push(pos);
    }
    // Fisher-Yates shuffle of open positions
    for (let i = openPositions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [openPositions[i], openPositions[j]] = [openPositions[j]!, openPositions[i]!];
    }
    setAssigning(true);
    try {
      await Promise.all(
        unassigned.slice(0, openPositions.length).map((p, i) => {
          const pos = openPositions[i]!;
          const teamName = allSlotNames[pos - 1] ?? `Slot ${pos}`;
          return fetch(`/api/draft-rooms/${detail.room.id}/participants/${p.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commissionerToken, draftPosition: pos, orphanTeamName: teamName }),
          });
        })
      );
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
    } finally {
      setAssigning(false);
    }
  };

  const removeParticipantFromRoom = async (participantId: number) => {
    if (!commissionerToken || !detail?.room) return;
    setRemovingParticipantId(participantId);
    try {
      await fetch(`/api/draft-rooms/${detail.room.id}/participants/${participantId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionerToken }),
      });
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
    } catch {
      toast({ title: "Error", description: "Could not remove participant", variant: "destructive" });
    } finally {
      setRemovingParticipantId(null);
    }
  };

  const onDeleteRoom = () => {
    if (!commissionerToken || !detail?.room) return;
    deleteRoom.mutate({ id: detail.room.id, data: { commissionerToken } }, {
      onSuccess: () => {
        Object.keys(localStorage).filter(k => k.startsWith(`draft_${code}`)).forEach(k => localStorage.removeItem(k));
        setLocation("/");
      },
      onError: (err) => toast({ title: "Error", description: err.data?.error, variant: "destructive" })
    });
  };

  const onExportCsv = async () => {
    if (!commissionerToken || !detail?.room) return;
    setExporting(true);
    try {
      const csv = await exportPicksCsv(detail.room.id, commissionerToken);
      const safeName = (detail.room.leagueName || "dispersal-draft").replace(/[^a-z0-9-_]+/gi, "_");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}_draft_results.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.data?.error ?? err?.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const toggleLock = () => {
    if (!detail?.room || !commissionerToken) return;
    updateRoom.mutate({
      id: detail.room.id,
      data: { commissionerToken, isLocked: !detail.room.isLocked }
    }, {
      onSuccess: () => {
        toast({ title: detail.room.isLocked ? "Room unlocked" : "Room locked", description: detail.room.isLocked ? "Managers can now join." : "No new managers can join." });
        queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
      },
      onError: (err) => toast({ title: "Error", description: err.data?.error, variant: "destructive" })
    });
  };

  /** Returns { bankSeconds, turnStartedAt } to drive BankTimer — turnStartedAt only set when this participant is on the clock */
  const getTimerProps = (p: { id: number; timeBankRemainingSeconds: number | null }) => {
    const timeBankSeconds = detail?.room?.timeBankSeconds;
    if (!timeBankSeconds) return null;
    const bankSeconds = p.timeBankRemainingSeconds ?? timeBankSeconds;
    const isOnClock = p.id === detail?.onTheClockParticipantId && detail?.room?.status === 'active';
    const turnStartedAt = isOnClock && detail?.room?.currentTurnStartedAt ? detail.room.currentTurnStartedAt : null;
    return { bankSeconds, turnStartedAt, isOnClock };
  };

  // Must be before early returns (Rules of Hooks)
  const pickYears = useMemo(() => {
    const years = new Set<string>();
    (allAssets || []).filter(a => a.type === "Rookie Pick" || a.type === "Future Pick").forEach(a => {
      const m = a.name.match(/'?(\d{2,4})/);
      if (m) years.add(m[1].slice(-2));
    });
    return Array.from(years).sort();
  }, [allAssets]);

  const pickRounds = useMemo(() => {
    const rounds = new Set<string>();
    (allAssets || []).filter(a => a.type === "Rookie Pick" || a.type === "Future Pick").forEach(a => {
      const m = a.name.match(/R(\d+)/i);
      if (m) rounds.add(m[1]);
    });
    return Array.from(rounds).sort((a, b) => Number(a) - Number(b));
  }, [allAssets]);

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center bg-background text-primary text-xl font-bold">Loading Command Center…</div>;
  }

  if (!detail) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-destructive text-xl font-bold">Room not found</p>
        <p className="text-sm text-muted-foreground">This room may have been deleted or the code is incorrect.</p>
        <Link href="/" className="text-sm font-bold text-primary underline underline-offset-2 hover:text-primary/80">← Back to Home</Link>
      </div>
    );
  }

  const { room, participants, picks, onTheClockParticipantId } = detail;
  const unassignedParticipants = participants.filter(p => !p.isCommissioner && p.draftPosition === null);


  // A manager can retract their pick only if it's the very last pick made and no one has gone after them
  const lastPick = picks.length > 0 ? picks[picks.length - 1] : null;
  const canRetract = !isCommissioner && room.status === "active" && !!participantId && !!lastPick && lastPick.participantId === participantId;
  const showJoinModal = !participantId && !isCommissioner && participants.filter(p => !p.isCommissioner).length < room.numOrphanSlots;
  
  // Rounds = total assets (drafted + available) ÷ orphan teams, exactly
  const totalAssets = picks.length + (allAssets?.length ?? 0);
  const maxRound = room.numOrphanSlots > 0 ? Math.ceil(totalAssets / room.numOrphanSlots) : 1;
  const rounds = Array.from({ length: maxRound }, (_, i) => i + 1);

  const showPositionFilter = assetType === "all" || assetType === "Player";
  const showPickFilters = assetType === "Pick";
  const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

  const filteredAssets = (allAssets || []).filter(a => {
    const key = (a.type === "Rookie Pick" || a.type === "Future Pick") ? "Pick" : a.type;
    if (assetType !== "all" && key !== assetType) return false;
    if (a.type === "Player" && positionFilter !== "all") {
      if ((a.position ?? "").toUpperCase() !== positionFilter) return false;
    }
    if ((a.type === "Rookie Pick" || a.type === "Future Pick") && pickYearFilter !== "all") {
      const m = a.name.match(/'?(\d{2,4})/);
      if (!m || m[1].slice(-2) !== pickYearFilter) return false;
    }
    if ((a.type === "Rookie Pick" || a.type === "Future Pick") && pickRoundFilter !== "all") {
      const m = a.name.match(/R(\d+)/i);
      if (!m || m[1] !== pickRoundFilter) return false;
    }
    if (assetSearch && !a.name.toLowerCase().includes(assetSearch.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (assetSort === "alpha") return a.name.localeCompare(b.name);
    // position sort: QB → RB → WR → TE → others, then alpha within group
    const pa = POS_ORDER[a.position?.toUpperCase() ?? ""] ?? 99;
    const pb = POS_ORDER[b.position?.toUpperCase() ?? ""] ?? 99;
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
  });


  // Hoist draft-state variables so they're available for the mobile banner
  // (these mirror what the asset-list IIFE computes; keeping them outside avoids duplication)
  const myParticipant = participantId ? participants.find(p => p.id === participantId) : null;
  const myTP = myParticipant ? getTimerProps(myParticipant) : null;
  const myBankExhausted = !!(myTP && myTP.bankSeconds <= 0);
  const canPick = room.status === 'active' && onTheClockParticipantId === participantId && !myBankExhausted;
  const canForce = isCommissioner && room.status === 'active' && onTheClockParticipantId !== participantId;
  const bankExpiredOnClock = !isCommissioner && room.status === 'active' && onTheClockParticipantId === participantId && myBankExhausted;
  const actionable = canPick || canForce;
  const numManagers = sortedParticipants.length;
  const currentRoundNum = numManagers > 0 ? Math.floor(picks.length / numManagers) + 1 : 1;
  const otcManager = onTheClockParticipantId != null ? participants.find(p => p.id === onTheClockParticipantId) : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* Top Status Bar */}
      <header className="h-12 md:h-16 border-b border-border/40 bg-card flex items-center px-3 md:px-6 shrink-0 justify-between z-20 shadow-sm relative">
        <div className="flex items-center gap-2 md:gap-6 min-w-0 flex-1 overflow-hidden">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title="Home"><Home size={16} /></Link>
          {isCommissioner && <Link href={`/${code}/setup?step=review`} className="hidden md:inline text-muted-foreground hover:text-foreground text-sm font-medium transition-colors shrink-0">← Setup</Link>}
          <h1 className="text-sm md:text-xl font-bold text-primary tracking-tight truncate">{room.leagueName}</h1>
          {room.status !== 'setup' && (
            <div className={`px-3 py-1 rounded-lg text-xs uppercase tracking-wider font-bold ${
              room.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400 border border-emerald-300/50 dark-any:border-emerald-400/20' :
              room.status === 'paused' ? 'bg-amber-500/10 text-amber-600 dark-any:text-amber-400 border border-amber-300/50 dark-any:border-amber-400/20' :
              'bg-blue-500/10 text-blue-600 dark-any:text-blue-400 border border-blue-300/50 dark-any:border-blue-400/20'
            }`}>
              {room.status}
            </div>
          )}
          
          {room.status === 'active' && (() => {
            const onClockP = participants.find(p => p.id === onTheClockParticipantId);
            const timerProps = onClockP ? getTimerProps(onClockP) : null;
            return (
              <div className="hidden md:flex items-center gap-2">
                <span className="text-muted-foreground text-sm uppercase font-bold tracking-wider">On Clock:</span>
                <span className="text-primary font-bold">
                  {onClockP?.username || "Unknown"}
                </span>
                {timerProps && (
                  <BankTimer
                    bankSeconds={timerProps.bankSeconds}
                    turnStartedAt={timerProps.turnStartedAt}
                    isOnClock={timerProps.isOnClock}
                    pauseStart={room.dailyPauseStart}
                    pauseEnd={room.dailyPauseEnd}
                    pauseTimezone={room.pauseTimezone}
                    variant="header"
                  />
                )}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 md:gap-6 shrink-0">
          {canRetract && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-300/50 dark-any:border-amber-400/20 rounded-lg text-xs">
              <span className="text-amber-600 dark-any:text-amber-400 font-semibold">Picked: <span className="font-bold">{lastPick?.assetName}</span></span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark-any:text-amber-400 hover:text-amber-700 dark-any:hover:text-amber-300 hover:bg-amber-500/20 border border-amber-300/50 dark-any:border-amber-400/20"
                onClick={retractPick}
                disabled={retracting}
                title="Undo your pick while it's still your turn window"
              >
                {retracting ? "Changing…" : "Change Pick"}
              </Button>
            </div>
          )}
          <div className="hidden md:flex text-sm font-mono font-bold px-4 py-2 bg-secondary/50 rounded-lg border border-[var(--sc-border)] dark-any:border-white/6">
            RD {room.currentRound} <span className="text-muted-foreground mx-2">|</span> PK {room.currentPickNumber + 1}
          </div>
          
          <SoundToggle level={soundLevel} onCycle={cycleSoundLevel} />

          {isCommissioner && (
            <div className="hidden md:flex items-center gap-2 bg-card border border-[var(--sc-border)] dark-any:border-white/6 p-1 rounded-lg">
              {room.status === 'setup' && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`gap-1.5 font-bold ${room.isLocked ? "text-amber-600 dark-any:text-amber-400 hover:text-amber-700 dark-any:hover:text-amber-300 hover:bg-amber-500/10" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={toggleLock}
                    disabled={updateRoom.isPending}
                    title={room.isLocked ? "Unlock room to allow new managers" : "Lock room to prevent new managers"}
                  >
                    {room.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    {room.isLocked ? "Locked" : "Lock"}
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={sortedParticipants.length < room.numOrphanSlots || unassignedParticipants.length > 0}
                    title={unassignedParticipants.length > 0 ? "All managers must be assigned to a slot first" : sortedParticipants.length < room.numOrphanSlots ? "Not all slots are filled" : ""}
                    onClick={() => startDraft.mutate({ id: room.id, data: { commissionerToken }})}
                  >
                    Start Draft
                  </Button>
                </>
              )}
              {room.status === 'active' && (
                <Button size="sm" variant="secondary" onClick={() => pauseDraft.mutate({ id: room.id, data: { commissionerToken }})}>
                  Pause
                </Button>
              )}
              {room.status === 'paused' && (
                <Button size="sm" variant="default" onClick={() => resumeDraft.mutate({ id: room.id, data: { commissionerToken }})}>
                  Resume
                </Button>
              )}
              <Button size="sm" variant="destructive" onClick={() => undoPick.mutate({ id: room.id, data: { commissionerToken }})} disabled={picks.length === 0}>
                Undo Last
              </Button>
              <div className="w-px h-5 bg-border/60 mx-1" />
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 font-bold text-muted-foreground hover:text-foreground"
                onClick={onExportCsv}
                disabled={exporting || picks.length === 0}
                title="Download draft results as a CSV"
              >
                <Download className="w-3.5 h-3.5" />
                {exporting ? "Exporting…" : "Export CSV"}
              </Button>
              <div className="w-px h-5 bg-border/60 mx-1" />
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive/70 hover:text-destructive hover:bg-destructive/10 font-bold"
                onClick={() => setShowDeleteConfirm(true)}
                title="Permanently delete this draft room"
              >
                Delete Room
              </Button>
            </div>
          )}

          <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="text-destructive">Delete Draft Room?</DialogTitle>
                <DialogDescription>
                  This will permanently delete <span className="font-bold text-foreground">{room.leagueName}</span> and all its participants, assets, and picks. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleteRoom.isPending}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={onDeleteRoom} disabled={deleteRoom.isPending}>
                  {deleteRoom.isPending ? "Deleting…" : "Delete Forever"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Mobile-only: On Clock strip + commissioner action bar */}
      {room.status === 'active' && (() => {
        const onClockP = participants.find(p => p.id === onTheClockParticipantId);
        const timerProps = onClockP ? getTimerProps(onClockP) : null;
        const bankEmpty = timerProps && timerProps.bankSeconds <= 0;
        return (
          <div className={`md:hidden flex items-center justify-between px-3 py-2 border-b border-border/40 shrink-0 ${bankEmpty ? 'bg-destructive/10' : 'bg-primary/10'}`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground shrink-0">On Clock</span>
              <span className={`font-bold text-sm truncate ${bankEmpty ? 'text-destructive' : 'text-primary'}`}>{onClockP?.username || "Unknown"}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-mono text-muted-foreground">RD {room.currentRound} · PK {room.currentPickNumber}</span>
              {timerProps && (
                <BankTimer
                  bankSeconds={timerProps.bankSeconds}
                  turnStartedAt={timerProps.turnStartedAt}
                  isOnClock={timerProps.isOnClock}
                  variant="order"
                />
              )}
            </div>
          </div>
        );
      })()}

      {/* Mobile-only: Commissioner action bar */}
      {isCommissioner && (
        <div className="md:hidden flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 bg-card/60 shrink-0 overflow-x-auto">
          <Link href={`/${code}/setup?step=review`} className="text-[10px] font-bold text-muted-foreground shrink-0 px-2 py-1 rounded-lg border border-[var(--sc-border)] dark-any:border-white/6 bg-card hover:text-foreground transition-colors">← Setup</Link>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          {room.status === 'setup' && (
            <>
              <Button size="sm" variant="ghost" className={`gap-1 text-[10px] font-bold shrink-0 ${room.isLocked ? "text-amber-600 dark-any:text-amber-400" : "text-muted-foreground"}`} onClick={toggleLock} disabled={updateRoom.isPending}>
                {room.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                {room.isLocked ? "Locked" : "Lock"}
              </Button>
              <Button size="sm" variant="default" className="text-[10px] font-bold shrink-0" disabled={sortedParticipants.length < room.numOrphanSlots || unassignedParticipants.length > 0} onClick={() => startDraft.mutate({ id: room.id, data: { commissionerToken }})}>
                Start Draft
              </Button>
            </>
          )}
          {room.status === 'active' && (
            <Button size="sm" variant="secondary" className="text-[10px] font-bold shrink-0" onClick={() => pauseDraft.mutate({ id: room.id, data: { commissionerToken }})}>Pause</Button>
          )}
          {room.status === 'paused' && (
            <Button size="sm" variant="default" className="text-[10px] font-bold shrink-0" onClick={() => resumeDraft.mutate({ id: room.id, data: { commissionerToken }})}>Resume</Button>
          )}
          <Button size="sm" variant="destructive" className="text-[10px] font-bold shrink-0" onClick={() => undoPick.mutate({ id: room.id, data: { commissionerToken }})} disabled={picks.length === 0}>Undo</Button>
          {canRetract && (
            <Button size="sm" variant="ghost" className="text-[10px] font-bold text-amber-600 dark-any:text-amber-400 border border-amber-300/50 dark-any:border-amber-400/20 shrink-0" onClick={retractPick} disabled={retracting}>
              {retracting ? "…" : "Change Pick"}
            </Button>
          )}
          <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
          <Button size="sm" variant="ghost" className="text-[10px] font-bold text-destructive/70 shrink-0" onClick={() => setShowDeleteConfirm(true)}>Delete</Button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel: Participants */}
        {(() => {
          const commissioner = participants.find(p => p.isCommissioner);
          return (
            <aside className={`${mobileTab === 'order' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-64 border-r border-border/40 bg-card/30 z-10 shadow-[4px_0_24px_-10px_rgba(0,0,0,0.5)]`}>
              {/* Section: Draft Order */}
              <div className="px-3 py-2 border-b border-border/40 font-bold text-[9px] tracking-wider text-muted-foreground uppercase bg-card/80 backdrop-blur shrink-0">
                Draft Order
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="p-2.5 space-y-1.5">
                  {Array.from({ length: room.numOrphanSlots }, (_, i) => i + 1).map(pos => {
                    const assigned = sortedParticipants.find(p => p.draftPosition === pos);
                    const teamName = allSlotNames[pos - 1] ?? `Slot ${pos}`;
                    const isOnClock = assigned && onTheClockParticipantId === assigned.id && room.status === 'active';
                    return (
                      <div
                        key={pos}
                        className={`flex items-start gap-2 p-2.5 rounded-lg border transition-all duration-300 ${
                          isOnClock
                            ? 'bg-primary/20 border-primary shadow-[0_0_12px_rgba(var(--primary),0.15)]'
                            : 'bg-card/60 border-[var(--sc-border)] dark-any:border-white/6'
                        }`}
                      >
                        <span className={`font-mono font-bold text-xs shrink-0 w-4 text-right mt-0.5 ${isOnClock ? 'text-primary' : 'text-muted-foreground/50'}`}>{pos}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[9px] text-muted-foreground/40 truncate uppercase tracking-wide font-semibold mb-0.5">{teamName}</div>
                          {assigned ? (
                            <div className="flex items-center justify-between gap-1">
                              <div className={`font-semibold text-sm truncate ${isOnClock ? 'text-primary' : 'text-foreground/90'}`}>{assigned.username}</div>
                              {room.timeBankSeconds && (() => {
                                const tp = getTimerProps(assigned);
                                if (!tp) return null;
                                return (
                                  <BankTimer
                                    bankSeconds={tp.bankSeconds}
                                    turnStartedAt={tp.turnStartedAt}
                                    isOnClock={tp.isOnClock}
                                    pauseStart={room.dailyPauseStart}
                                    pauseEnd={room.dailyPauseEnd}
                                    pauseTimezone={room.pauseTimezone}
                                    variant="order"
                                  />
                                );
                              })()}
                              {isCommissioner && room.status === 'setup' && (
                                <button
                                  onClick={() => unassignFromSlot(assigned.id)}
                                  disabled={assigning}
                                  className="shrink-0 text-base leading-none text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-30"
                                  title="Remove from slot"
                                >×</button>
                              )}
                            </div>
                          ) : (
                            isCommissioner && room.status === 'setup' && unassignedParticipants.length > 0 ? (
                              <select
                                defaultValue=""
                                key={`select-${pos}-${unassignedParticipants.map(p => p.id).join(',')}`}
                                onChange={e => { if (e.target.value) assignToSlot(parseInt(e.target.value), pos, teamName); }}
                                disabled={assigning}
                                className="w-full text-xs bg-background/60 border border-[var(--sc-border)] dark-any:border-white/10 rounded-lg px-1.5 py-1 text-muted-foreground cursor-pointer disabled:opacity-40"
                              >
                                <option value="" disabled>Assign manager...</option>
                                {unassignedParticipants.map(p => (
                                  <option key={p.id} value={p.id}>{p.username}</option>
                                ))}
                              </select>
                            ) : (
                              <div className="text-xs text-muted-foreground/30 italic">Open</div>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Section: Unassigned */}
                {unassignedParticipants.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 flex items-center justify-between border-t border-border/40 bg-muted/10">
                      <span className="text-[9px] tracking-wider font-bold text-muted-foreground/50 uppercase">
                        Unassigned ({unassignedParticipants.length})
                      </span>
                      {isCommissioner && room.status === 'setup' && (
                        <button
                          onClick={randomizeUnassigned}
                          disabled={assigning}
                          className="text-[9px] font-bold uppercase tracking-wider text-primary/70 hover:text-primary border border-primary/30 hover:border-primary/60 rounded-lg px-1.5 py-0.5 transition-colors disabled:opacity-40"
                        >
                          Randomize
                        </button>
                      )}
                    </div>
                    <div className="px-2.5 pb-2.5 space-y-1.5">
                      {unassignedParticipants.map(p => (
                        <div key={p.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed border-[var(--sc-border)] dark-any:border-white/6 bg-card/30">
                          <span className="font-mono text-xs text-muted-foreground/30 shrink-0 w-4 text-right">—</span>
                          <div className="font-semibold text-sm truncate text-foreground/60 flex-1">{p.username}</div>
                          {isCommissioner && room.status === 'setup' && (
                            <button
                              onClick={() => removeParticipantFromRoom(p.id)}
                              disabled={removingParticipantId === p.id}
                              className="shrink-0 text-base leading-none text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-30"
                              title={`Remove ${p.username} from room`}
                            >×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Section: Commissioner (pinned at bottom) */}
              {commissioner && (
                <div className="shrink-0 border-t border-border/40 bg-card/80 px-3 py-2.5">
                  <div className="text-[9px] tracking-wider font-bold text-muted-foreground/40 uppercase mb-1.5">Commissioner</div>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 overflow-hidden">
                      {commissioner.sleeperAvatarId ? (
                        <img
                          src={`https://sleepercdn.com/avatars/thumbs/${commissioner.sleeperAvatarId}`}
                          alt={commissioner.username}
                          className="w-full h-full object-cover"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'flex'); }}
                        />
                      ) : null}
                      <span
                        className="text-primary font-bold text-xs w-full h-full flex items-center justify-center"
                        style={{ display: commissioner.sleeperAvatarId ? 'none' : 'flex' }}
                      >{commissioner.username.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-sm truncate text-foreground/90">{commissioner.username}</div>
                      <div className="text-[9px] uppercase tracking-wider font-bold text-primary/60">Commissioner</div>
                    </div>
                  </div>
                </div>
              )}
            </aside>
          );
        })()}

        {/* Center Panel: Draft Board */}
        <section className={`${mobileTab === 'board' ? 'flex' : 'hidden'} md:flex flex-1 flex-col overflow-hidden relative`} style={{ background: 'hsl(var(--background))' }}>
          {/* Subtle grid dot texture — slightly more visible than before */}
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--border)/0.35) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
          {/* Very faint vignette to anchor the board */}
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,transparent_60%,hsl(var(--background)/0.55)_100%)]" />
          
          <div className={`flex-1 flex flex-col ${isMobile ? 'overflow-hidden' : 'overflow-auto'} p-1 md:p-6 z-10 relative`}>
            <div className={isMobile ? 'flex-1 min-h-0 w-full' : 'min-w-max'}>
              <div
                className={`grid ${isMobile ? 'gap-0.5 h-full' : 'gap-2'}`}
                style={isMobile ? {
                  gridTemplateColumns: `20px repeat(${room.numOrphanSlots}, 1fr)`,
                  gridTemplateRows: `auto repeat(${rounds.length}, 1fr)`,
                } : {
                  gridTemplateColumns: `64px repeat(${room.numOrphanSlots}, minmax(180px, 1fr))`,
                }}
              >
                {/* Header Row */}
                <div className="sticky top-0 z-20 pb-2 border-b-2 border-border/30" style={{ background: 'hsl(var(--background)/0.95)', backdropFilter: 'blur(8px)' }} />
                {Array.from({ length: room.numOrphanSlots }, (_, i) => i + 1).map(pos => {
                  const p = sortedParticipants.find(sp => sp.draftPosition === pos);
                  const isOTC = room.status === 'active' && p?.id === onTheClockParticipantId;
                  const teamName = p?.orphanTeamName ?? allSlotNames[pos - 1];
                  return (
                    <div
                      key={`header-${pos}`}
                      className={`${isMobile ? '' : 'sticky top-0 z-20'} transition-all duration-500 border-b-2 ${
                        isMobile ? 'pb-1 px-1 pt-0.5' : 'pb-2.5 px-2.5 pt-1'
                      } ${
                        isOTC
                          ? 'border-primary animate-otc-header rounded-t-lg'
                          : 'border-border/30'
                      }`}
                      style={{ background: isOTC ? 'hsl(var(--primary)/0.1)' : 'hsl(var(--background)/0.95)', backdropFilter: 'blur(8px)' }}
                    >
                      {p ? (
                        <>
                          <div className="flex items-center gap-1 min-w-0">
                            <div className={`${isMobile ? 'text-[9px]' : 'text-sm'} font-bold truncate ${isOTC ? 'text-primary' : 'text-foreground/90'}`}>{p.username}</div>
                            {isOTC && !isMobile && (
                              <span className="animate-otc-badge shrink-0 text-[8px] font-bold uppercase tracking-wider bg-primary text-primary-foreground px-1.5 py-0.5 rounded-lg leading-none">
                                ON THE CLOCK
                              </span>
                            )}
                            {isOTC && isMobile && (
                              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            )}
                          </div>
                          {!isMobile && (
                            <div className="text-[10px] text-muted-foreground/60 font-semibold truncate mt-0.5">
                              {teamName ?? `Roster ${pos}`}
                            </div>
                          )}
                          {!isMobile && room.timeBankSeconds && (() => {
                            if (!p) return null;
                            const tp = getTimerProps(p);
                            if (!tp) return null;
                            return (
                              <BankTimer
                                bankSeconds={tp.bankSeconds}
                                turnStartedAt={tp.turnStartedAt}
                                isOnClock={tp.isOnClock}
                                pauseStart={room.dailyPauseStart}
                                pauseEnd={room.dailyPauseEnd}
                                pauseTimezone={room.pauseTimezone}
                                variant="board"
                                className="mt-1"
                              />
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          {isMobile ? (
                            <div className="text-[9px] font-bold text-muted-foreground/60 truncate">{pos}</div>
                          ) : (
                            <>
                              {teamName ? (
                                <div className="text-sm font-bold text-muted-foreground/70 truncate leading-tight">{teamName}</div>
                              ) : (
                                <div className="text-sm font-bold text-muted-foreground/70 truncate">Slot {pos}</div>
                              )}
                              <div className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/50 mt-0.5">Open Slot</div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Grid Body */}
                {rounds.map(round => (
                  <React.Fragment key={`round-${round}`}>
                    {/* Round Indicator */}
                    <div className={`flex items-center justify-center ${isMobile ? '' : 'h-20'}`}>
                      <div className={`flex flex-col items-center gap-0.5 border border-[var(--sc-border)] dark-any:border-white/6 rounded-lg bg-card/50 ${isMobile ? 'px-0.5 py-0.5' : 'px-2 py-1'}`}>
                        {!isMobile && <span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/50">Rd</span>}
                        <span className={`${isMobile ? 'text-[8px]' : 'text-base'} font-bold text-muted-foreground/80 leading-none`}>{round}</span>
                      </div>
                    </div>
                    
                    {/* Cells for this round */}
                    {Array.from({ length: room.numOrphanSlots }).map((_, colIndex) => {
                      // Each column is always the same fixed manager (draftPosition = colIndex+1).
                      // Snake/3rr order is reflected by which column is "on the clock" per round —
                      // the server's onTheClockParticipantId already handles all format logic.
                      const position = colIndex + 1;

                      const participant = sortedParticipants.find(p => p.draftPosition === position);
                      const pick = picks.find(p => p.round === round && p.participantId === participant?.id);
                      const isCurrentPickCell = room.status === 'active' && room.currentRound === round && participant?.id === onTheClockParticipantId;
                      const isActiveCol = room.status === 'active' && participant?.id === onTheClockParticipantId;
                      const isRecentPick = pick && recentPickIds.has(pick.id);

                      // 3RR: same as snake but round 3 stays reversed instead of going normal.
                      // From round 3 onward the parity flips: odd=reversed, even=normal.
                      // Formula: round<3 → snake (even=reversed); round>=3 → odd=reversed.
                      const n = room.numOrphanSlots;
                      const fmt = room.draftFormat;
                      const isRoundReversed =
                        fmt === 'snake' ? round % 2 === 0
                        : fmt === '3rr' ? (round < 3 ? round % 2 === 0 : round % 2 !== 0)
                        : false;
                      const pickWithinRound = isRoundReversed ? n - colIndex : colIndex + 1;
                      const pickLabel = `${round}.${String(pickWithinRound).padStart(2, '0')}`;

                      return (
                        <div
                          key={`cell-${round}-${colIndex}`}
                          className={`
                            relative ${isMobile ? 'p-1 rounded-md' : 'h-20 p-2.5 rounded-lg'} border flex flex-col justify-center transition-all duration-300
                            ${pick
                              ? `bg-card/70 border-border/60 shadow-[inset_0_1px_0_hsl(var(--border)/0.3)] ${isRecentPick ? 'animate-pick-land' : ''}`
                              : isCurrentPickCell
                              ? 'bg-primary/15 border-primary animate-otc-glow'
                              : isActiveCol
                              ? 'bg-primary/5 border-primary/30 border-dashed'
                              : 'bg-card/30 border-border/25'}
                          `}
                        >
                          {/* Pick # top-right */}
                          <span className={`absolute ${isMobile ? 'top-0.5 right-0.5 text-[7px]' : 'top-1.5 right-2 text-[8px]'} font-mono font-bold leading-none ${
                            pick ? 'text-muted-foreground/60' : isCurrentPickCell ? 'text-primary/60' : 'text-muted-foreground/50'
                          }`}>{pickLabel}</span>

                          {pick ? (() => {
                            const asset = assetMap.get(pick.assetId);
                            const isPlayer = pick.assetType === 'Player';
                            const thumb = isPlayer ? sleeperThumb(asset?.notes ?? null) : null;
                            const teamLogo = isPlayer ? sleeperTeamLogo(asset?.team ?? null) : null;
                            return (
                              <div className={isRecentPick ? 'animate-in fade-in zoom-in duration-200' : ''}>
                                {isMobile ? (
                                  <div className="font-bold text-foreground/90 leading-tight truncate text-[9px] pr-3">{pick.assetName}</div>
                                ) : (
                                  <div className="flex items-center gap-1.5 pr-6">
                                    {/* Avatar */}
                                    <div className="relative shrink-0">
                                      {thumb ? (
                                        <img src={thumb} alt="" className="w-8 h-8 rounded-full object-cover bg-muted ring-1 ring-border/40"
                                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                      ) : (
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ring-1 ring-border/40 ${isPlayer ? positionAvatarStyle(asset?.position) : 'bg-muted text-muted-foreground/60'}`}>
                                          {isPlayer ? (asset?.position || '?') : pick.assetType[0] || '·'}
                                        </div>
                                      )}
                                      {teamLogo && (
                                        <img src={teamLogo} alt="" className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border border-background bg-muted object-contain"
                                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                      )}
                                    </div>
                                    {/* Info */}
                                    <div className="min-w-0 flex-1">
                                      <div className="font-bold text-[11px] leading-tight truncate text-foreground/90">{pick.assetName}</div>
                                      {isPlayer ? (
                                        <div className="flex items-center gap-1 mt-0.5">
                                          {asset?.position && <span className={`text-[9px] font-bold ${positionColor(asset.position)}`}>{asset.position}</span>}
                                          {asset?.team && <span className="text-[9px] font-bold text-muted-foreground/70">{asset.team}</span>}
                                        </div>
                                      ) : (
                                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-mono">{pick.assetType}</div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })() : isCurrentPickCell ? (
                            <div className="flex flex-col gap-0.5">
                              {!isMobile && <span className="text-[8px] font-bold uppercase tracking-wider text-primary/80">On the Clock</span>}
                              <div className={`font-bold text-primary truncate ${isMobile ? 'text-[9px]' : 'text-[11px]'}`}>{participant?.username ?? 'Open'}</div>
                              {!isMobile && participant?.orphanTeamName && (
                                <div className="text-[9px] text-primary/70 truncate">{participant.orphanTeamName}</div>
                              )}
                              <div className="w-full h-0.5 bg-primary/40 rounded-full animate-pulse" />
                            </div>
                          ) : participant ? (
                            <div className="flex flex-col gap-0.5">
                              <div className={`font-semibold text-muted-foreground/80 truncate leading-tight ${isMobile ? 'text-[9px]' : 'text-[11px]'}`}>{participant.username}</div>
                              {!isMobile && participant.orphanTeamName && (
                                <div className="text-[9px] text-muted-foreground/60 truncate">{participant.orphanTeamName}</div>
                              )}
                            </div>
                          ) : (
                            <div className={`text-muted-foreground/55 font-mono uppercase ${isMobile ? 'text-[8px]' : 'text-[10px] tracking-wider'}`}>
                              {isMobile ? '–' : 'Open'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Mobile: Chat Tab */}
        <div className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} md:hidden flex-1 flex-col overflow-hidden`}>
          <ChatPanel
            roomId={room.id}
            shareCode={room.shareCode}
            participantId={participantId}
            commissionerToken={commissionerToken}
            isCommissioner={isCommissioner}
            mobile
          />
        </div>

        {/* Right Panel: Assets / Roster / Settings / Chat */}
        <aside className={`${['assets','roster','settings'].includes(mobileTab) ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-80 border-l border-border/40 bg-card/30 z-10 shadow-[-4px_0_24px_-10px_rgba(0,0,0,0.5)]`}>

          {/* Desktop tab bar */}
          <div className="hidden md:flex shrink-0 border-b border-border/40 bg-card/80 backdrop-blur">
            {(['assets', 'roster', 'settings', 'chat'] as const).map(t => (
              <button
                key={t}
                onClick={() => setRightTab(t)}
                className={`flex-1 py-2.5 text-[8px] font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px ${
                  rightTab === t ? 'text-primary border-primary' : 'text-muted-foreground/40 border-transparent hover:text-muted-foreground/70'
                }`}
              >
                {t === 'assets' ? 'Assets' : t === 'roster' ? 'Roster' : t === 'settings' ? 'League' : 'Chat'}
              </button>
            ))}
          </div>

          {/* ── ASSETS PANEL ─────────────────────────────────────── */}
          <div className={['flex-col flex-1 min-h-0 overflow-hidden', mobileTab === 'assets' ? 'flex' : 'hidden', rightTab === 'assets' ? 'md:flex' : 'md:hidden'].join(' ')}>
            {/* Sub-tab bar: Pool | Queue */}
            <div className="flex shrink-0 border-b border-border/40 bg-card/80 backdrop-blur">
              <button
                onClick={() => setAssetsSubTab('pool')}
                className={`flex-1 py-2.5 text-[9px] font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px ${
                  assetsSubTab === 'pool' ? 'text-primary border-primary' : 'text-muted-foreground/50 border-transparent hover:text-muted-foreground/70'
                }`}
              >
                Pool
              </button>
              <button
                onClick={() => setAssetsSubTab('queue')}
                className={`flex-1 py-2.5 text-[9px] font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px flex items-center justify-center gap-1.5 ${
                  assetsSubTab === 'queue'
                    ? 'text-primary border-primary'
                    : canPick && queue.length > 0
                    ? 'text-amber-600 dark-any:text-amber-400 border-transparent animate-otc-badge'
                    : 'text-muted-foreground/50 border-transparent hover:text-muted-foreground/70'
                }`}
              >
                Queue
                {queue.length > 0 && (
                  <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full ${
                    canPick ? 'bg-primary/30 text-primary' : 'bg-muted/60 text-muted-foreground/70'
                  }`}>
                    {queue.length}
                  </span>
                )}
              </button>
            </div>
            {/* Pool controls — only shown in pool sub-tab */}
            {assetsSubTab === 'pool' && (
              <div className="p-3 border-b border-border/40 bg-card/80 backdrop-blur sticky top-0 flex flex-col gap-3">
                <Input
                  placeholder="Search..."
                  value={assetSearch}
                  onChange={e => setAssetSearch(e.target.value)}
                  className="h-8 text-sm bg-background border-border/50 focus-visible:ring-primary"
                />
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select
                      value={assetType}
                      onChange={e => { setAssetType(e.target.value as typeof assetType); setPositionFilter("all"); setPickYearFilter("all"); setPickRoundFilter("all"); }}
                      className="w-full appearance-none bg-background border border-primary/30 text-foreground text-[10px] font-bold uppercase tracking-wider py-1.5 pl-2.5 pr-6 rounded-lg cursor-pointer focus:outline-none focus:border-primary/70 hover:border-primary/50 transition-colors"
                    >
                      <option value="all">All Assets</option>
                      <option value="Player">Players</option>
                      <option value="Pick">Picks</option>
                      <option value="FAAB">FAAB</option>
                    </select>
                    <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-primary pointer-events-none" />
                  </div>
                  {showPositionFilter && (
                    <div className="relative flex-1">
                      <select
                        value={positionFilter}
                        onChange={e => setPositionFilter(e.target.value as typeof positionFilter)}
                        className="w-full appearance-none bg-background border border-primary/30 text-foreground text-[10px] font-bold uppercase tracking-wider py-1.5 pl-2.5 pr-6 rounded-lg cursor-pointer focus:outline-none focus:border-primary/70 hover:border-primary/50 transition-colors"
                      >
                        <option value="all">All Pos</option>
                        <option value="QB">QB</option>
                        <option value="RB">RB</option>
                        <option value="WR">WR</option>
                        <option value="TE">TE</option>
                      </select>
                      <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-primary pointer-events-none" />
                    </div>
                  )}
                  {showPickFilters && pickYears.length > 0 && (
                    <div className="relative flex-1">
                      <select
                        value={pickYearFilter}
                        onChange={e => setPickYearFilter(e.target.value)}
                        className="w-full appearance-none bg-background border border-primary/30 text-foreground text-[10px] font-bold uppercase tracking-wider py-1.5 pl-2.5 pr-6 rounded-lg cursor-pointer focus:outline-none focus:border-primary/70 hover:border-primary/50 transition-colors"
                      >
                        <option value="all">All Years</option>
                        {pickYears.map(y => <option key={y} value={y}>'{y}</option>)}
                      </select>
                      <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-primary pointer-events-none" />
                    </div>
                  )}
                  {showPickFilters && pickRounds.length > 0 && (
                    <div className="relative flex-1">
                      <select
                        value={pickRoundFilter}
                        onChange={e => setPickRoundFilter(e.target.value)}
                        className="w-full appearance-none bg-background border border-primary/30 text-foreground text-[10px] font-bold uppercase tracking-wider py-1.5 pl-2.5 pr-6 rounded-lg cursor-pointer focus:outline-none focus:border-primary/70 hover:border-primary/50 transition-colors"
                      >
                        <option value="all">All Rds</option>
                        {pickRounds.map(r => <option key={r} value={r}>Rd {r}</option>)}
                      </select>
                      <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-primary pointer-events-none" />
                    </div>
                  )}
                  <div className="relative flex-1">
                    <select
                      value={assetSort}
                      onChange={e => setAssetSort(e.target.value as typeof assetSort)}
                      className="w-full appearance-none bg-background border border-primary/30 text-foreground text-[10px] font-bold uppercase tracking-wider py-1.5 pl-2.5 pr-6 rounded-lg cursor-pointer focus:outline-none focus:border-primary/70 hover:border-primary/50 transition-colors"
                    >
                      <option value="position">By Pos</option>
                      <option value="alpha">A–Z</option>
                    </select>
                    <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-primary pointer-events-none" />
                  </div>
                </div>
              </div>
            )}
          {/* Mobile "On The Clock" / Waiting banner */}
          {room.status === 'active' && !!participantId && (
            canPick ? (
              <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-primary shrink-0 border-b border-primary/60">
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-primary-foreground/60">Your Pick</div>
                  <div className="text-sm font-bold text-primary-foreground leading-tight">Round {currentRoundNum}</div>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-primary-foreground/80 animate-otc-badge shrink-0">On the Clock</div>
              </div>
            ) : (
              <div className="md:hidden flex items-center gap-2 px-4 py-2 bg-muted/20 border-b border-border/30 shrink-0">
                <div className="text-[10px] text-muted-foreground/60 font-medium leading-tight truncate">
                  {otcManager ? `Waiting for ${otcManager.username} · Round ${currentRoundNum}` : `Round ${currentRoundNum} · Waiting…`}
                </div>
              </div>
            )
          )}

          {/* ── QUEUE SUB-TAB VIEW ─────────────────────────── */}
          <div className={[
            'overflow-y-auto min-h-0 flex flex-col',
            assetsSubTab === 'queue' ? 'flex-1' : 'hidden',
            canPick && queue.length > 0 && assetsSubTab === 'queue' ? 'ring-1 ring-inset ring-primary/20' : '',
          ].join(' ')}>
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
                  <div className="text-2xl opacity-20">☆</div>
                  <div className="text-xs font-bold text-muted-foreground/40 uppercase tracking-wider">Queue is empty</div>
                  <div className="text-[11px] text-muted-foreground/30 leading-relaxed">Star any asset in the Pool to add it to your queue.</div>
                </div>
              ) : (
                <>
                  {/* OTC callout when it's your pick */}
                  {canPick && (
                    <div className="px-3 py-2.5 bg-primary/10 border-b border-primary/20 flex items-center gap-2 shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary animate-ping shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary/80">You're on the clock — draft from queue</span>
                    </div>
                  )}
                  {/* Queue list */}
                  <div className="flex-1 min-h-0">
                    {queue.map((qid, qIdx) => {
                      const qa = assetMap.get(qid);
                      if (!qa) return null;
                      const isDrafted = !allAssetIdSet.has(qid);
                      const isPlayer = qa.type === "Player";
                      const isFaab = qa.type === "FAAB";
                      const qThumb = isPlayer ? sleeperThumb(qa.notes ?? null) : null;
                      const qTeamLogo = isPlayer ? sleeperTeamLogo(qa.team ?? null) : null;
                      const isTop = qIdx === 0;
                      const handleQueueDraft = () => {
                        if (canPick) setSelectedAssetToPick(qid);
                        else if (canForce && onTheClockParticipantId)
                          manualPick.mutate({ id: room.id, data: { commissionerToken, participantId: onTheClockParticipantId, assetId: qid } });
                      };
                      return (
                        <div
                          key={qid}
                          className={`group relative flex items-center overflow-hidden border-b border-border/20 last:border-0 transition-all duration-150 ${
                            isDrafted
                              ? 'opacity-35'
                              : isTop && canPick
                              ? 'bg-primary/8 border-b-primary/20'
                              : 'hover:bg-primary/5 hover:border-primary/20'
                          }`}
                        >
                          {/* Position accent bar */}
                          <div className={`w-[3px] self-stretch shrink-0 ${
                            isPlayer ? positionBarColor(qa.position) + (isDrafted ? ' opacity-30' : ' opacity-70') : isFaab ? 'bg-primary/40' : 'bg-border/40'
                          }`} />

                          {/* Queue number */}
                          <div className={`w-5 text-center text-[9px] font-bold shrink-0 ml-1.5 ${isTop && !isDrafted ? 'text-primary/60' : 'text-muted-foreground/25'}`}>
                            {qIdx + 1}
                          </div>

                          {/* Avatar with team logo overlay */}
                          <div className="relative shrink-0 ml-1.5 my-2">
                            {qThumb ? (
                              <img
                                src={qThumb}
                                alt=""
                                className={`w-10 h-10 rounded-full object-cover bg-muted ring-1 ring-border/30 transition-all duration-150 ${isDrafted ? 'grayscale' : 'group-hover:ring-primary/40'}`}
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ring-1 ring-border/30 transition-all duration-150 ${
                                isPlayer ? positionAvatarStyle(qa.position) : isFaab ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                              } ${isDrafted ? 'opacity-50' : 'group-hover:ring-primary/40'}`}>
                                {isPlayer ? (qa.position ?? "?") : isFaab ? "$" : "·"}
                              </div>
                            )}
                            {qTeamLogo && !isDrafted && (
                              <img
                                src={qTeamLogo}
                                alt=""
                                className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background bg-muted object-contain"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                          </div>

                          {/* Info */}
                          <div className="min-w-0 flex-1 px-2.5 py-2">
                            <div className={`font-bold text-[13px] leading-tight truncate transition-colors duration-150 ${isDrafted ? 'line-through text-muted-foreground/40' : 'group-hover:text-primary'}`}>
                              {qa.name}
                            </div>
                            {isPlayer ? (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {isDrafted ? (
                                  <span className="text-[9px] text-destructive/50 uppercase tracking-wider font-bold">Drafted</span>
                                ) : (
                                  <>
                                    {isTop && canPick && <span className="text-[9px] text-primary/70 uppercase tracking-wider font-bold">Up next ·</span>}
                                    {qa.position && <span className={`text-[10px] font-bold ${positionColor(qa.position)}`}>{qa.position}</span>}
                                    {qa.team && <span className="text-[10px] font-bold text-muted-foreground">{qa.team}</span>}
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mt-0.5">
                                {isDrafted ? 'Drafted' : qa.type}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-0.5 pr-1.5 shrink-0">
                            {!isDrafted && (canPick || canForce) && isTop && (
                              <button
                                onClick={handleQueueDraft}
                                disabled={isDraftPending}
                                className={`text-[8px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg mr-0.5 transition-all disabled:opacity-40 ${
                                  canPick ? 'bg-primary text-primary-foreground shadow-[0_0_8px_hsl(var(--primary)/0.5)]' : 'bg-amber-500/80 text-white'
                                }`}
                              >
                                {canPick ? 'Draft' : 'Force'}
                              </button>
                            )}
                            {!isDrafted && (
                              <>
                                <button onClick={() => moveQueueUp(qid)} disabled={qIdx === 0} className="w-6 h-6 flex items-center justify-center text-[11px] text-muted-foreground/30 hover:text-foreground/60 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">↑</button>
                                <button onClick={() => moveQueueDown(qid)} disabled={qIdx === queue.length - 1} className="w-6 h-6 flex items-center justify-center text-[11px] text-muted-foreground/30 hover:text-foreground/60 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">↓</button>
                              </>
                            )}
                            <button onClick={() => removeFromQueue(qid)} className="w-6 h-6 flex items-center justify-center text-[11px] text-muted-foreground/25 hover:text-destructive transition-colors">×</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Clear button */}
                  <div className="px-3 py-2 border-t border-border/20 shrink-0">
                    <button onClick={clearQueue} className="text-[9px] text-muted-foreground/30 hover:text-muted-foreground/60 uppercase tracking-wider transition-colors">Clear all</button>
                  </div>
                </>
              )}
            </div>

          {/* ── POOL SUB-TAB VIEW ──────────────────────────── */}
          <div className={assetsSubTab === 'pool' ? 'flex-1 overflow-y-auto py-1 min-h-0' : 'hidden'}>
            {(() => {
              const filterPicks = filteredAssets.filter(a => a.type === "Rookie Pick" || a.type === "Future Pick");
              const others = filteredAssets.filter(a => a.type !== "Rookie Pick" && a.type !== "Future Pick");
              return (
                <>
                  {filterPicks.length > 0 && (() => {
                    const pickAction = canPick
                      ? (id: number) => setSelectedAssetToPick(id)
                      : canForce
                      ? (id: number) => { if (onTheClockParticipantId) manualPick.mutate({ id: room.id, data: { commissionerToken, participantId: onTheClockParticipantId, assetId: id } }); }
                      : undefined;
                    const actionLabel = canPick ? "PICK" : canForce ? "FORCE" : undefined;
                    const pickOwner = (p: { notes?: string | null; team?: string | null }) => {
                      const m = p.notes?.match(/From:\s*(.+?)(?:\s*·|$)/);
                      return m?.[1]?.trim() || p.team || "Unassigned";
                    };
                    const teamGroups = filterPicks.reduce<Record<string, typeof filterPicks>>((acc, p) => {
                      const key = pickOwner(p);
                      (acc[key] ??= []).push(p);
                      return acc;
                    }, {});
                    const teamKeys = Object.keys(teamGroups).sort((a, b) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b));
                    return (
                      <div className="mx-2 mb-1 mt-2 p-3 rounded-xl bg-card border border-[var(--sc-border)] dark-any:border-white/6 space-y-3">
                        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/70">Draft Picks</div>
                        {teamKeys.map(team => (
                          <div key={team}>
                            <div className="text-[9px] uppercase tracking-wider font-bold text-primary/60 mb-1.5 border-b border-border/30 pb-1">{team}</div>
                            <PickBadgeGroup assets={teamGroups[team]} onPick={pickAction} actionLabel={actionLabel} />
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Exiting / just-drafted assets */}
                  {Array.from(exitingAssets.entries()).map(([eid, info]) => {
                    const isEPlayer = info.type === "Player";
                    const eThumb = isEPlayer ? sleeperThumb(info.notes) : null;
                    return (
                      <div key={`exit-${eid}`} className="animate-exit-drafted relative flex items-center overflow-hidden border-b border-border/20">
                        <div className={`w-[3px] self-stretch shrink-0 opacity-40 ${isEPlayer ? positionBarColor(info.position) : 'bg-border/40'}`} />
                        <div className="relative shrink-0 ml-2.5 my-2 grayscale opacity-40">
                          {eThumb ? (
                            <img src={eThumb} alt="" className="w-10 h-10 rounded-full object-cover bg-muted ring-1 ring-border/30" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ring-1 ring-border/30 ${isEPlayer ? positionAvatarStyle(info.position) : 'bg-muted text-muted-foreground'}`}>
                              {isEPlayer ? (info.position ?? "?") : "$"}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 px-2.5 py-2 opacity-40">
                          <div className="font-bold text-[13px] leading-tight truncate line-through text-muted-foreground">{info.name}</div>
                          {isEPlayer && info.team && <div className="text-[10px] text-muted-foreground/50">{info.team}</div>}
                        </div>
                        <div className="absolute inset-0 flex items-center justify-end pr-3 bg-gradient-to-l from-background/90 via-background/60 to-transparent">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">Drafted by <span className="text-primary/60">{info.draftedBy}</span></span>
                        </div>
                      </div>
                    );
                  })}

                  {others.map(a => {
                    const isPlayer = a.type === "Player";
                    const isFaab = a.type === "FAAB";
                    const thumb = isPlayer ? sleeperThumb(a.notes ?? null) : null;
                    const teamLogo = isPlayer ? sleeperTeamLogo(a.team ?? null) : null;
                    const fromTeam = (() => { const m = a.notes?.match(/From:\s*(.+?)(?:\s*·|$)/); return m?.[1]?.trim() ?? null; })();
                    const isQueued = queue.includes(a.id);

                    const handleDraft = () => {
                      if (canPick) setSelectedAssetToPick(a.id);
                      else if (canForce && onTheClockParticipantId)
                        manualPick.mutate({ id: room.id, data: { commissionerToken, participantId: onTheClockParticipantId, assetId: a.id } });
                    };

                    return (
                      <div
                        key={a.id}
                        className={`group relative flex items-center overflow-hidden border-b transition-all duration-150 ${
                          actionable
                            ? 'border-border/20 md:cursor-pointer md:hover:bg-primary/8 md:hover:border-primary/40 md:hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]'
                            : 'border-border/20 md:hover:bg-card/60 md:hover:border-border/30'
                        }`}
                      >
                        {/* Position accent bar */}
                        <div className={`w-[3px] self-stretch shrink-0 transition-all duration-150 ${
                          isPlayer
                            ? positionBarColor(a.position) + (actionable ? ' group-hover:opacity-100' : ' opacity-70')
                            : isFaab ? 'bg-primary/40' : 'bg-border/40'
                        }`} />

                        {/* Avatar */}
                        <div className="relative shrink-0 ml-2.5 my-2">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt=""
                              className="w-10 h-10 rounded-full object-cover bg-muted ring-1 ring-border/30 group-hover:ring-primary/40 transition-all duration-150"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ring-1 ring-border/30 group-hover:ring-primary/40 transition-all duration-150 ${
                              isPlayer ? positionAvatarStyle(a.position) : isFaab ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                            }`}>
                              {isPlayer ? (a.position || "?") : isFaab ? "$" : "·"}
                            </div>
                          )}
                          {teamLogo && (
                            <img
                              src={teamLogo}
                              alt=""
                              className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background bg-muted object-contain"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          )}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1 px-2.5 py-2">
                          <div className="font-bold text-[13px] leading-tight truncate group-hover:text-primary transition-colors duration-150">{a.name}</div>
                          {isPlayer ? (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {a.position && (
                                <span className={`text-[10px] font-bold ${positionColor(a.position)}`}>{a.position}</span>
                              )}
                              {a.team && (
                                <span className="text-[10px] font-bold text-muted-foreground">{a.team}</span>
                              )}
                              {fromTeam && (
                                <span className="text-[9px] text-muted-foreground/40 truncate hidden group-hover:inline">· {fromTeam}</span>
                              )}
                            </div>
                          ) : (
                            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">{a.type}</div>
                          )}
                        </div>

                        {/* Right: queue star + draft buttons */}
                        <div className="flex items-center gap-1 pr-2 shrink-0">
                          {/* Star / queue toggle — desktop-visible on hover, always visible when queued */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleQueue(a.id); }}
                            className={`w-7 h-7 flex items-center justify-center text-[15px] transition-all duration-150 hover:scale-110 ${
                              isQueued
                                ? 'text-primary'
                                : 'opacity-0 group-hover:opacity-100 text-muted-foreground/30 hover:text-primary/60'
                            }`}
                            title={isQueued ? "Remove from queue" : "Add to queue"}
                          >
                            {isQueued ? '★' : '☆'}
                          </button>

                          {/* Desktop hover draft button — hidden on mobile */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDraft(); }}
                            disabled={isDraftPending}
                            className={`hidden md:inline-flex text-[9px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition-all duration-150 opacity-0 group-hover:opacity-100 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                              canPick
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-[0_0_8px_hsl(var(--primary)/0.4)]'
                                : canForce
                                ? 'bg-amber-500/80 text-white hover:bg-amber-500 cursor-pointer'
                                : 'bg-muted/40 text-muted-foreground/25 cursor-default'
                            }`}
                          >
                            {canForce ? 'Force' : 'Draft'}
                          </button>

                          {/* Mobile draft button — always visible, gold when on-clock, locked otherwise */}
                          {room.status === 'active' && (!!participantId || isCommissioner) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); if (!isDraftPending && (canPick || canForce)) handleDraft(); }}
                              disabled={isDraftPending || (!canPick && !canForce)}
                              className={`md:hidden w-14 text-center text-[9px] font-bold uppercase tracking-wider py-1.5 rounded-lg transition-all duration-150 shrink-0 ${
                                isDraftPending
                                  ? 'bg-primary/40 text-primary-foreground/60 cursor-not-allowed'
                                  : canPick
                                  ? 'bg-primary text-primary-foreground cursor-pointer animate-draft-pulse'
                                  : canForce
                                  ? 'bg-amber-500/80 text-white cursor-pointer'
                                  : 'bg-muted/20 text-muted-foreground/30 cursor-not-allowed'
                              }`}
                            >
                              {isDraftPending ? '···' : canPick ? 'Draft' : canForce ? 'Force' : 'Lock'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {bankExpiredOnClock && (
                    <div className="mx-2 mt-3 mb-1 px-3 py-2.5 rounded-xl bg-destructive/10 border border-destructive/30 text-center">
                      <div className="text-xs font-bold uppercase tracking-wider text-destructive">Time Bank Expired</div>
                      <div className="text-[10px] text-destructive/70 mt-0.5">The commissioner will assign your pick</div>
                    </div>
                  )}

                  {filteredAssets.length === 0 && (
                    <div className="text-center text-muted-foreground/50 text-sm font-medium py-12">No assets available</div>
                  )}
                </>
              );
            })()}
          </div>{/* close pool overflow-y-auto */}
          </div>{/* close ASSETS panel */}

          {/* ── ROSTER PANEL ─────────────────────────────────────── */}
          {(() => {
            const rosterViewId = viewRosterParticipantId ?? myParticipant?.id ?? sortedParticipants[0]?.id ?? null;
            const rosterParticipant = sortedParticipants.find(p => p.id === rosterViewId) ?? null;
            const rosterPicks = picks
              .filter(p => p.participantId === rosterViewId)
              .map(p => ({ ...p, asset: assetMap.get(p.assetId) }))
              .filter((p): p is typeof p & { asset: NonNullable<typeof p['asset']> } => !!p.asset);
            const rosterPlayers = rosterPicks.filter(p => p.asset.type === 'Player');
            const rosterPickAssets = rosterPicks.filter(p => p.asset.type === 'Rookie Pick' || p.asset.type === 'Future Pick');
            const rosterFaab = rosterPicks.filter(p => p.asset.type === 'FAAB');
            const posCounts: Record<string, number> = {};
            rosterPlayers.forEach(p => { const pos = (p.asset.position ?? 'UNK').toUpperCase(); posCounts[pos] = (posCounts[pos] ?? 0) + 1; });
            const byPos = (pos: string) => rosterPlayers.filter(p => (p.asset.position ?? '').toUpperCase() === pos);
            const starters: Array<{ slot: string; id: number; asset: NonNullable<ReturnType<typeof assetMap.get>> }> = [];
            const usedPickIds = new Set<number>();
            const take = (slot: string, pos: string, n: number) => {
              byPos(pos).filter(p => !usedPickIds.has(p.id)).slice(0, n).forEach(p => { usedPickIds.add(p.id); starters.push({ slot, id: p.id, asset: p.asset }); });
            };
            take('QB', 'QB', 1); take('RB', 'RB', 2); take('WR', 'WR', 2); take('TE', 'TE', 1);
            for (const flexPos of ['RB', 'WR', 'TE']) {
              const flex = byPos(flexPos).find(p => !usedPickIds.has(p.id));
              if (flex) { usedPickIds.add(flex.id); starters.push({ slot: 'FLEX', id: flex.id, asset: flex.asset }); break; }
            }
            const bench = rosterPlayers.filter(p => !usedPickIds.has(p.id));
            return (
              <div className={['flex-col flex-1 min-h-0 overflow-hidden', mobileTab === 'roster' ? 'flex' : 'hidden', rightTab === 'roster' ? 'md:flex' : 'md:hidden'].join(' ')}>
                <div className="p-3 border-b border-border/40 bg-card/80 backdrop-blur shrink-0 flex flex-col gap-2">
                  <div className="font-bold text-xs tracking-wider text-muted-foreground uppercase">My Roster</div>
                  {sortedParticipants.length > 0 && (
                    <div className="relative">
                      <select
                        value={rosterViewId ?? ''}
                        onChange={e => setViewRosterParticipantId(Number(e.target.value))}
                        className="w-full appearance-none bg-background border border-primary/30 text-foreground text-[10px] font-bold uppercase tracking-wider py-1.5 pl-2.5 pr-6 rounded-lg cursor-pointer focus:outline-none focus:border-primary/70"
                      >
                        {sortedParticipants.map(p => (
                          <option key={p.id} value={p.id}>{p.orphanTeamName ?? p.username}</option>
                        ))}
                      </select>
                      <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-primary pointer-events-none" />
                    </div>
                  )}
                  {rosterPlayers.length > 0 && (
                    <div className="grid grid-cols-5 gap-1 pt-1">
                      {(['QB', 'RB', 'WR', 'TE'] as const).map(pos => (
                        <div key={pos} className="flex flex-col items-center py-1.5 bg-card/60 rounded-lg border border-[var(--sc-border)] dark-any:border-white/6">
                          <div className={`text-sm font-bold ${positionColor(pos)}`}>{posCounts[pos] ?? 0}</div>
                          <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/50">{pos}</div>
                        </div>
                      ))}
                      <div className="flex flex-col items-center py-1.5 bg-card/60 rounded-lg border border-[var(--sc-border)] dark-any:border-white/6">
                        <div className="text-sm font-bold text-amber-600 dark-any:text-amber-400">{rosterPickAssets.length}</div>
                        <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/50">Picks</div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-4">
                  {rosterPicks.length === 0 && (
                    <div className="text-center text-muted-foreground/40 text-sm py-16">
                      {rosterParticipant ? `${rosterParticipant.orphanTeamName ?? rosterParticipant.username} hasn't drafted yet` : 'No picks yet'}
                    </div>
                  )}
                  {starters.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 flex items-center gap-1.5">
                        <span>Starting Lineup</span>
                        <span className="text-muted-foreground/25 font-normal normal-case tracking-normal text-[8px]">est.</span>
                      </div>
                      <div className="space-y-0.5">
                        {starters.map(({ slot, id, asset }) => {
                          const thumb = sleeperThumb(asset.notes ?? null);
                          return (
                            <div key={id} className="flex items-center gap-2 py-1.5 px-2 bg-card/40 rounded-lg border border-[var(--sc-border)] dark-any:border-white/6">
                              <div className="w-9 text-[9px] font-bold uppercase tracking-wider text-primary/40 shrink-0">{slot}</div>
                              {thumb ? (
                                <img src={thumb} alt="" className="w-7 h-7 rounded-full object-cover bg-muted shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              ) : (
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${positionAvatarStyle(asset.position)}`}>{asset.position ?? '?'}</div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-bold truncate leading-tight">{asset.name}</div>
                                {asset.team && <div className="text-[9px] text-muted-foreground/40">{asset.team}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {bench.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">Bench</div>
                      <div className="space-y-0.5">
                        {bench.map(p => {
                          const thumb = sleeperThumb(p.asset.notes ?? null);
                          return (
                            <div key={p.id} className="flex items-center gap-2 py-1.5 px-2 bg-card/40 rounded-lg border border-[var(--sc-border)] dark-any:border-white/6 opacity-70">
                              <div className="w-9 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/30 shrink-0">BN</div>
                              {thumb ? (
                                <img src={thumb} alt="" className="w-7 h-7 rounded-full object-cover bg-muted shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              ) : (
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${positionAvatarStyle(p.asset.position)}`}>{p.asset.position ?? '?'}</div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-bold truncate leading-tight">{p.asset.name}</div>
                                {p.asset.team && <div className="text-[9px] text-muted-foreground/40">{p.asset.team}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {rosterPickAssets.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">Draft Capital</div>
                      <div className="flex flex-wrap gap-1.5">
                        {rosterPickAssets.map(p => (
                          <span key={p.id} className="inline-flex items-center px-2 py-1 bg-primary/10 border border-primary/30 rounded-lg text-[10px] font-bold text-primary/80">{p.asset.name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {rosterFaab.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">FAAB</div>
                      <div className="flex flex-wrap gap-1.5">
                        {rosterFaab.map(p => (
                          <span key={p.id} className="inline-flex items-center px-2 py-1 bg-primary/5 border border-primary/20 rounded-lg text-[10px] font-bold text-primary/60">{p.asset.name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── LEAGUE SETTINGS PANEL ────────────────────────────── */}
          <div className={['flex-col flex-1 min-h-0 overflow-hidden', mobileTab === 'settings' ? 'flex' : 'hidden', rightTab === 'settings' ? 'md:flex' : 'md:hidden'].join(' ')}>
            <div className="p-3 border-b border-border/40 bg-card/80 backdrop-blur shrink-0">
              <div className="font-bold text-xs tracking-wider text-muted-foreground uppercase">League Settings</div>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-5">
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                <div className="text-[9px] font-bold uppercase tracking-wider text-primary/50 mb-2">League</div>
                <div className="text-base font-bold text-foreground leading-tight">{room.leagueName}</div>
                <div className="text-xs text-muted-foreground mt-1.5">
                  {room.numOrphanSlots}-Team Dynasty &nbsp;·&nbsp; {room.draftFormat === 'snake' ? 'Snake' : room.draftFormat === 'linear' ? 'Linear' : room.draftFormat} Draft
                </div>
              </div>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-3">Draft Settings</div>
                <div className="rounded-xl border border-[var(--sc-border)] dark-any:border-white/6 overflow-hidden">
                  {([
                    ['Format', room.draftFormat === 'snake' ? 'Snake' : room.draftFormat === 'linear' ? 'Linear' : room.draftFormat],
                    ['Teams', String(room.numOrphanSlots)],
                    ['Status', room.status.charAt(0).toUpperCase() + room.status.slice(1)],
                    ...(room.timeBankSeconds ? [['Time Bank', `${Math.floor(room.timeBankSeconds / 60)}m ${String(room.timeBankSeconds % 60).padStart(2, '0')}s`] as [string,string]] : []),
                  ] as [string, string][]).map(([label, value], i) => (
                    <div key={label} className={`flex justify-between items-center px-3 py-2 text-xs ${i > 0 ? 'border-t border-border/20' : ''}`}>
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-bold text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* ── Sleeper Import ──────────────────────────── */}
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-3">Sleeper League</div>
                {isCommissioner ? (
                  <div className="space-y-2">
                    <div className="text-[10px] text-muted-foreground/50 leading-relaxed">
                      Paste your Sleeper League ID to import scoring settings and roster positions.
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={sleeperIdInput}
                        onChange={e => setSleeperIdInput(e.target.value)}
                        placeholder="e.g. 1048268895199641600"
                        className="flex-1 min-w-0 bg-background border border-[var(--sc-border)] dark-any:border-white/10 text-foreground text-[11px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/30"
                      />
                      <button
                        onClick={async () => {
                          const val = sleeperIdInput.trim();
                          if (!val && !room.sleeperLeagueId) return;
                          setSleeperIdSaving(true);
                          try {
                            await updateRoom.mutateAsync({ id: room.id, data: { commissionerToken, sleeperLeagueId: val || null } });
                          } finally {
                            setSleeperIdSaving(false);
                          }
                        }}
                        disabled={sleeperIdSaving || sleeperIdInput.trim() === (room.sleeperLeagueId ?? "")}
                        className="text-[9px] font-bold uppercase tracking-wider px-3 py-1.5 bg-primary/80 text-primary-foreground rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary transition-colors shrink-0"
                      >
                        {sleeperIdSaving ? "…" : "Load"}
                      </button>
                    </div>
                    {room.sleeperLeagueId && (
                      <div className="text-[9px] text-muted-foreground/40 font-mono">ID: {room.sleeperLeagueId}</div>
                    )}
                  </div>
                ) : (
                  room.sleeperLeagueId ? (
                    <div className="text-[10px] text-muted-foreground/40 font-mono">League ID: {room.sleeperLeagueId}</div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground/40 italic">Not linked to Sleeper</div>
                  )
                )}
              </div>

              {/* ── Sleeper Data ─────────────────────────── */}
              {room.sleeperLeagueId && (
                sleeperLoading ? (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground/40">
                    <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/20 border-t-primary/50 animate-spin" />
                    <span className="text-[10px]">Loading from Sleeper…</span>
                  </div>
                ) : sleeperError ? (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-[11px] text-destructive/70">
                    Could not load league — check the ID and try again.
                  </div>
                ) : sleeperLeague ? (() => {
                  const sc = deriveScoringHighlights(sleeperLeague.scoring_settings, sleeperLeague.roster_positions);
                  const { starterSlots, benchCount, taxiCount, irCount } = categorizeRosterPositions(sleeperLeague.roster_positions);

                  const scoringRows: [string, string][] = [
                    ["PPR", sc.pprLabel],
                    ...(sc.tepLabel ? [["TEP", sc.tepLabel]] as [string,string][] : []),
                    ["Pass TD", `${sc.passTd} pts`],
                    ...(sc.ppc ? [["PPC", sc.ppc]] as [string,string][] : []),
                    ...(sc.passYdLabel ? [["Pass Yd", sc.passYdLabel]] as [string,string][] : []),
                    ["INT", `${sc.intPts} pts`],
                    ["Fum Lost", `${sc.fum} pts`],
                  ];

                  const pills: { label: string; active: boolean }[] = [
                    { label: sc.pprLabel, active: true },
                    ...(sc.tepLabel ? [{ label: `TEP ${sc.tepLabel}`, active: true }] : []),
                    { label: sc.hasSF ? "Superflex" : "No SF", active: sc.hasSF },
                    ...(sc.ppc ? [{ label: `PPC ${sc.ppc}`, active: true }] : []),
                  ];

                  return (
                    <>
                      {/* Scoring pills */}
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">Scoring Format</div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {pills.map(p => (
                            <span key={p.label} className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg ${p.active ? 'bg-primary/20 text-primary/80 border border-primary/30' : 'bg-muted/30 text-muted-foreground/40 border border-border/20'}`}>
                              {p.label}
                            </span>
                          ))}
                        </div>
                        <div className="rounded-xl border border-[var(--sc-border)] dark-any:border-white/6 overflow-hidden">
                          {scoringRows.map(([label, value], i) => (
                            <div key={label} className={`flex justify-between items-center px-3 py-1.5 text-xs ${i > 0 ? 'border-t border-border/15' : ''}`}>
                              <span className="text-muted-foreground/60">{label}</span>
                              <span className="font-bold text-foreground text-[11px]">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Roster positions */}
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">Roster Positions</div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {starterSlots.map(({ label, count }) =>
                            Array.from({ length: count }).map((_, i) => (
                              <span key={`${label}-${i}`} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-lg border ${
                                label === 'QB' ? 'bg-red-500/10 text-red-600 dark-any:text-red-400 border-red-300/50 dark-any:border-red-400/20' :
                                label === 'RB' ? 'bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400 border-emerald-300/50 dark-any:border-emerald-400/20' :
                                label === 'WR' ? 'bg-blue-500/10 text-blue-600 dark-any:text-blue-400 border-blue-300/50 dark-any:border-blue-400/20' :
                                label === 'TE' ? 'bg-amber-500/10 text-amber-600 dark-any:text-amber-400 border-amber-300/50 dark-any:border-amber-400/20' :
                                label === 'SF' ? 'bg-purple-500/10 text-purple-600 dark-any:text-purple-400 border-purple-300/50 dark-any:border-purple-400/20' :
                                'bg-muted/30 text-muted-foreground/60 border-border/20'
                              }`}>
                                {label}
                              </span>
                            ))
                          )}
                        </div>
                        <div className="flex gap-3 text-[10px] text-muted-foreground/50">
                          {benchCount > 0 && <span>{benchCount} Bench</span>}
                          {taxiCount > 0 && <span>{taxiCount} Taxi</span>}
                          {irCount > 0 && <span>{irCount} IR</span>}
                        </div>
                      </div>
                    </>
                  );
                })() : null
              )}
            </div>
          </div>

          {/* ── CHAT PANEL (desktop tab only) ────────────────────── */}
          <div className={`hidden flex-col flex-1 min-h-0 overflow-hidden ${rightTab === 'chat' ? 'md:flex' : 'md:hidden'}`}>
            <ChatPanel
              roomId={room.id}
              shareCode={room.shareCode}
              participantId={participantId}
              commissionerToken={commissionerToken}
              isCommissioner={isCommissioner}
            />
          </div>

        </aside>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden flex border-t border-border/40 bg-card shrink-0 z-30">
        {([
          { id: 'order', label: 'Order', icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          )},
          { id: 'board', label: 'Board', icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          )},
          { id: 'assets', label: 'Assets', icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          )},
          { id: 'roster', label: 'Roster', icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          )},
          { id: 'settings', label: 'League', icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
          )},
          { id: 'chat', label: 'Chat', icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          )},
        ] as { id: 'order' | 'board' | 'assets' | 'roster' | 'settings' | 'chat'; label: string; icon: React.ReactNode }[]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            className={`flex-1 py-2 flex flex-col items-center gap-0.5 transition-colors ${
              mobileTab === tab.id
                ? 'text-primary border-t-2 border-primary -mt-px'
                : 'text-muted-foreground/60 border-t-2 border-transparent -mt-px'
            }`}
          >
            {tab.icon}
            <span className="text-[8px] font-bold uppercase tracking-wider">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Join Modal */}
      <Dialog open={showJoinModal} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md bg-card border-border shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-primary tracking-tight">Join Draft Room</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Enter your manager name to join. The commissioner will assign you to a roster slot.
            </DialogDescription>
          </DialogHeader>
          <Form {...joinForm}>
            <form onSubmit={joinForm.handleSubmit(onJoinSubmit)} className="space-y-6 pt-4">
              <FormField
                control={joinForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Manager Name</FormLabel>
                    <FormControl>
                      <Input placeholder="DynastyManager99" className="bg-background border-border/50 focus-visible:ring-primary h-12" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-12 font-bold" disabled={joinDraft.isPending}>
                {joinDraft.isPending ? "Joining..." : "Claim Slot"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Confirm Pick Modal */}
      <Dialog open={selectedAssetToPick !== null} onOpenChange={(open) => !open && setSelectedAssetToPick(null)}>
        <DialogContent className="sm:max-w-sm bg-card border-border shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary tracking-tight">Confirm Pick</DialogTitle>
            <DialogDescription>
              Are you sure you want to draft this asset? You can change it until the next manager makes their pick.
            </DialogDescription>
          </DialogHeader>
          {selectedAssetToPick && (() => {
            const a = allAssets?.find(x => x.id === selectedAssetToPick);
            if (!a) return null;
            const isPlayer = a.type === 'Player';
            const isFaab = a.type === 'FAAB';
            const thumb = isPlayer ? sleeperThumb(a.notes ?? null) : null;
            const teamLogo = isPlayer ? sleeperTeamLogo(a.team ?? null) : null;
            return (
              <div className="flex items-center overflow-hidden border border-[var(--sc-border)] dark-any:border-white/10 rounded-xl bg-background/50 my-2">
                {/* Position accent bar */}
                <div className={`w-[4px] self-stretch shrink-0 ${isPlayer ? positionBarColor(a.position) : isFaab ? 'bg-primary/40' : 'bg-border/40'}`} />
                {/* Avatar */}
                <div className="relative shrink-0 ml-3 my-3">
                  {thumb ? (
                    <img src={thumb} alt="" className="w-14 h-14 rounded-full object-cover bg-muted ring-1 ring-border/30"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold ring-1 ring-border/30 ${isPlayer ? positionAvatarStyle(a.position) : isFaab ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {isPlayer ? (a.position || '?') : isFaab ? '$' : '·'}
                    </div>
                  )}
                  {teamLogo && (
                    <img src={teamLogo} alt="" className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border-2 border-background bg-muted object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                </div>
                {/* Info */}
                <div className="min-w-0 flex-1 px-3 py-3">
                  <div className="font-bold text-base leading-tight truncate">{a.name}</div>
                  {isPlayer ? (
                    <div className="flex items-center gap-2 mt-1">
                      {a.position && <span className={`text-xs font-bold ${positionColor(a.position)}`}>{a.position}</span>}
                      {a.team && <span className="text-xs font-bold text-muted-foreground">{a.team}</span>}
                    </div>
                  ) : (
                    <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-1">{a.type}</div>
                  )}
                </div>
              </div>
            );
          })()}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="secondary" onClick={() => setSelectedAssetToPick(null)}>Cancel</Button>
            <Button variant="default" onClick={onConfirmPick} disabled={makePick.isPending}>
              {makePick.isPending ? "Drafting..." : "Confirm Pick"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}