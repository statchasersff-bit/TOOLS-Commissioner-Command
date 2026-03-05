import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, RefreshCw, Trophy, Target, Radio, Zap, LayoutGrid, List } from "lucide-react";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";

interface DraftPick {
  round: number;
  pickNo: number;
  draftSlot: number;
  rosterId: number;
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
}

interface DraftInfo {
  draftId: string;
  status: string;
  type: string;
  rounds: number;
  teams: number;
  season: string;
  leagueName: string;
}

interface DraftSlot {
  slot: number;
  rosterId: number;
  displayName: string;
}

interface DraftResponse {
  draft: DraftInfo | null;
  picks: DraftPick[];
  players: Record<string, { name: string; pos: string; team: string }>;
  draftSlots: DraftSlot[];
  error: string | null;
}

interface LiveDraftInfo {
  leagueId: string;
  leagueName: string;
  draftId: string;
  status: string;
  type: string;
  season: string;
  rounds: number;
  teams: number;
  picksMade: number;
  totalPicks: number;
}

const POS_BG: Record<string, string> = {
  QB: "bg-red-500/20 border-red-500/40",
  RB: "bg-emerald-500/20 border-emerald-500/40",
  WR: "bg-blue-500/20 border-blue-500/40",
  TE: "bg-orange-500/20 border-orange-500/40",
};

const POS_TEXT: Record<string, string> = {
  QB: "text-red-700 dark:text-red-400",
  RB: "text-emerald-700 dark:text-emerald-400",
  WR: "text-blue-700 dark:text-blue-400",
  TE: "text-orange-700 dark:text-orange-400",
};

const POS_BADGE: Record<string, string> = {
  QB: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  RB: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  WR: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  TE: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
};

export default function LiveDraft() {
  const [leagueIdInput, setLeagueIdInput] = useState("");
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [draftData, setDraftData] = useState<DraftResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");

  const [liveDrafts, setLiveDrafts] = useState<LiveDraftInfo[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const { valuesBySleeperId, redraftValuesBySleeperId } = useValueModel();
  const { isConnected, user } = useSleeper();

  const scanForLiveDrafts = useCallback(async () => {
    if (!user?.userId) return;
    setIsDetecting(true);
    setScanError(null);
    try {
      const res = await fetch(`/api/sleeper/live-drafts/${user.userId}`);
      if (res.ok) {
        const data: LiveDraftInfo[] = await res.json();
        setLiveDrafts(data);
      } else {
        setScanError("Failed to scan leagues for live drafts");
      }
    } catch {
      setScanError("Network error while scanning for live drafts");
    }
    setIsDetecting(false);
    setHasScanned(true);
  }, [user?.userId]);

  useEffect(() => {
    if (isConnected && user?.userId && !hasScanned) {
      scanForLiveDrafts();
    }
  }, [isConnected, user?.userId, hasScanned, scanForLiveDrafts]);

  const handleJoinLiveDraft = (leagueId: string) => {
    setLeagueIdInput(leagueId);
    setDraftData(null);
    setApiError(null);
    setActiveLeagueId(leagueId);
    setAutoRefresh(true);
  };

  const fetchDraft = useCallback(async (id?: string) => {
    const targetId = id || activeLeagueId;
    if (!targetId) return;
    setIsLoading(true);
    setApiError(null);
    try {
      const res = await fetch(`/api/sleeper/draft/${targetId}`);
      const data: DraftResponse = await res.json();
      if (!res.ok) {
        setApiError((data as any).error || "Failed to fetch draft");
        return;
      }
      if (data.error) {
        setApiError(data.error);
        return;
      }
      setDraftData(data);
    } catch (err: any) {
      setApiError(err.message || "Network error");
    } finally {
      setIsLoading(false);
    }
  }, [activeLeagueId]);

  useEffect(() => {
    if (activeLeagueId) fetchDraft(activeLeagueId);
  }, [activeLeagueId]);

  useEffect(() => {
    if (autoRefresh && activeLeagueId) {
      intervalRef.current = setInterval(() => fetchDraft(), 15000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, activeLeagueId, fetchDraft]);

  const pickedPlayerIds = useMemo(() => {
    if (!draftData) return new Set<string>();
    return new Set(draftData.picks.map(p => p.playerId).filter(Boolean));
  }, [draftData]);

  const boardGrid = useMemo(() => {
    if (!draftData?.draft) return null;
    const { rounds, teams } = draftData.draft;
    const slots = draftData.draftSlots || [];

    const pickByRoundRoster = new Map<string, DraftPick>();
    for (const pick of draftData.picks) {
      if (pick.playerId) {
        pickByRoundRoster.set(`${pick.round}-${pick.rosterId}`, pick);
      }
    }

    const grid: (DraftPick | null)[][] = [];
    for (let r = 1; r <= rounds; r++) {
      const row: (DraftPick | null)[] = [];
      for (let s = 0; s < (slots.length || teams); s++) {
        const rosterId = slots[s]?.rosterId ?? (s + 1);
        row.push(pickByRoundRoster.get(`${r}-${rosterId}`) || null);
      }
      grid.push(row);
    }

    return grid;
  }, [draftData]);

  const bestAvailable = useMemo(() => {
    if (!draftData) return [];
    const players: { id: string; name: string; pos: string; team: string; value: number }[] = [];

    for (const [id, p] of Object.entries(draftData.players)) {
      if (pickedPlayerIds.has(id)) continue;
      const value = valuesBySleeperId[id] || redraftValuesBySleeperId[id] || 0;
      if (value <= 0) continue;
      players.push({ id, name: p.name, pos: p.pos, team: p.team, value });
    }

    players.sort((a, b) => b.value - a.value);
    return players;
  }, [draftData, valuesBySleeperId, redraftValuesBySleeperId, pickedPlayerIds]);

  const filteredBestAvailable = useMemo(() => {
    if (posFilter === "ALL") return bestAvailable;
    return bestAvailable.filter(p => p.pos === posFilter);
  }, [bestAvailable, posFilter]);

  const stats = useMemo(() => {
    if (!draftData?.draft) return { total: 0, picked: 0, available: 0 };
    const total = draftData.draft.rounds * draftData.draft.teams;
    const picked = draftData.picks.filter(p => p.playerId).length;
    return { total, picked, available: total - picked };
  }, [draftData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (leagueIdInput.trim()) {
      setDraftData(null);
      setApiError(null);
      setActiveLeagueId(leagueIdInput.trim());
    }
  };

  const getPlayerValue = (playerId: string) => {
    return valuesBySleeperId[playerId] || redraftValuesBySleeperId[playerId] || 0;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="live-draft-title">
          Live Draft Board
        </h2>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-sm text-muted-foreground mt-2" data-testid="text-draft-description">
          Enter a Sleeper league ID to load a visual draft board. Track picks in real-time with auto-refresh.
        </p>
      </div>

      {isConnected && (
        <Card className={liveDrafts.length > 0 ? "border-emerald-500/40 bg-emerald-500/5" : ""}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Radio className={`w-4 h-4 ${liveDrafts.length > 0 ? "text-emerald-500 animate-pulse" : "text-muted-foreground"}`} />
                <span className="text-sm font-semibold text-foreground" data-testid="text-live-detector-title">Live Draft Detector</span>
                {liveDrafts.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" data-testid="badge-live-count">
                    {liveDrafts.length} LIVE
                  </Badge>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={scanForLiveDrafts}
                disabled={isDetecting}
                data-testid="button-scan-drafts"
              >
                {isDetecting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                {hasScanned ? "Re-scan" : "Scan"}
              </Button>
            </div>
            {isDetecting && !hasScanned && (
              <p className="text-xs text-muted-foreground" data-testid="text-scanning">Scanning your leagues for active drafts...</p>
            )}
            {scanError && (
              <p className="text-xs text-red-500" data-testid="text-scan-error">{scanError}</p>
            )}
            {hasScanned && liveDrafts.length === 0 && !isDetecting && !scanError && (
              <p className="text-xs text-muted-foreground" data-testid="text-no-live-drafts">No active drafts detected across your leagues. You can still enter a league ID manually below.</p>
            )}
            {liveDrafts.length > 0 && (
              <div className="space-y-2" data-testid="list-live-drafts">
                {liveDrafts.map((ld) => (
                  <div
                    key={ld.draftId}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-emerald-500/20 bg-background"
                    data-testid={`live-draft-${ld.leagueId}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-[#d4af37] flex-shrink-0" />
                        <span className="font-medium text-sm text-foreground truncate" data-testid={`text-live-league-name-${ld.leagueId}`}>
                          {ld.leagueName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 ml-5.5">
                        <span className="text-[11px] text-muted-foreground">{ld.type} &middot; {ld.teams} teams &middot; {ld.rounds} rounds</span>
                        <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400" data-testid={`text-live-progress-${ld.leagueId}`}>
                          {ld.picksMade}/{ld.totalPicks} picks
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleJoinLiveDraft(ld.leagueId)}
                      data-testid={`button-join-draft-${ld.leagueId}`}
                    >
                      <Target className="w-3.5 h-3.5 mr-1.5" />
                      Join Board
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex gap-3 items-end" data-testid="draft-form">
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1.5 block" data-testid="label-league-id">Sleeper League ID</label>
              <Input
                data-testid="input-league-id"
                placeholder="e.g. 1170877498498940928"
                value={leagueIdInput}
                onChange={e => setLeagueIdInput(e.target.value)}
                className="font-mono"
              />
            </div>
            <Button type="submit" disabled={isLoading || !leagueIdInput.trim()} data-testid="button-load-draft">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Load Draft
            </Button>
          </form>
        </CardContent>
      </Card>

      {apiError && (
        <Card className="border-red-500/30">
          <CardContent className="pt-6">
            <p className="text-red-500 text-sm" data-testid="text-error">{apiError}</p>
          </CardContent>
        </Card>
      )}

      {draftData?.draft && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-[#d4af37]" />
                <span className="font-semibold text-foreground" data-testid="text-draft-season">
                  {draftData.draft.season} Draft
                </span>
                <Badge variant="outline" className="text-xs" data-testid="text-draft-status">
                  {draftData.draft.status}
                </Badge>
                <span className="text-xs text-muted-foreground" data-testid="text-draft-meta">
                  {draftData.draft.type} &middot; {draftData.draft.teams} teams &middot; {draftData.draft.rounds} rounds
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center border border-border rounded-md overflow-hidden">
                <button
                  className={`px-2.5 py-1.5 text-xs ${viewMode === "board" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setViewMode("board")}
                  data-testid="button-view-board"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  className={`px-2.5 py-1.5 text-xs ${viewMode === "list" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setViewMode("list")}
                  data-testid="button-view-list"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
              <Button
                variant={autoRefresh ? "default" : "outline"}
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
                data-testid="button-auto-refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${autoRefresh ? "animate-spin" : ""}`} />
                {autoRefresh ? "Auto-refresh On" : "Auto-refresh"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => fetchDraft()} disabled={isLoading} data-testid="button-refresh">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span data-testid="text-picked-count"><span className="font-semibold text-foreground">{stats.picked}</span>/{stats.total} picks made</span>
            <span data-testid="text-available-count"><span className="font-semibold text-emerald-600 dark:text-emerald-400">{stats.available}</span> remaining</span>
            <div className="flex items-center gap-2 ml-auto">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/20 border border-red-500/40" />QB</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/20 border border-emerald-500/40" />RB</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500/20 border border-blue-500/40" />WR</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500/20 border border-orange-500/40" />TE</span>
            </div>
          </div>

          {viewMode === "board" && boardGrid && (
            <div className="flex gap-4">
              <Card className="flex-1 min-w-0">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <div className="min-w-max" data-testid="draft-board-grid">
                      <div className="flex border-b border-border/50 bg-muted/30 sticky top-0 z-10">
                        <div className="w-12 flex-shrink-0 px-2 py-2.5 text-[10px] font-semibold text-muted-foreground text-center">RD</div>
                        {(draftData.draftSlots || []).map((slot) => (
                          <div
                            key={slot.slot}
                            className="w-28 flex-shrink-0 px-1.5 py-2.5 text-center border-l border-border/20"
                          >
                            <div className="text-[10px] font-semibold text-foreground truncate" data-testid={`slot-header-${slot.slot}`}>
                              {slot.displayName}
                            </div>
                          </div>
                        ))}
                      </div>

                      {boardGrid.map((row, roundIdx) => (
                        <div key={roundIdx} className="flex border-b border-border/20">
                          <div className="w-12 flex-shrink-0 px-2 py-1.5 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-muted-foreground">{roundIdx + 1}</span>
                          </div>
                          {row.map((pick, slotIdx) => {
                            if (pick && pick.playerId) {
                              const value = getPlayerValue(pick.playerId);
                              return (
                                <div
                                  key={slotIdx}
                                  className={`w-28 flex-shrink-0 px-1.5 py-1.5 border-l border-border/20 ${POS_BG[pick.pos] || "bg-muted/10"}`}
                                  data-testid={`pick-cell-${roundIdx + 1}-${slotIdx + 1}`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className={`text-[10px] font-bold ${POS_TEXT[pick.pos] || "text-muted-foreground"}`}>{pick.pos}</span>
                                    <span className="text-[9px] text-muted-foreground font-mono">{pick.round}.{String(pick.pickNo).padStart(2, "0")}</span>
                                  </div>
                                  <div className="text-[11px] font-semibold text-foreground leading-tight truncate mt-0.5" title={pick.playerName}>
                                    {pick.playerName.split(" ").pop()}
                                  </div>
                                  <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[9px] text-muted-foreground">{pick.team}</span>
                                    {value > 0 && <span className="text-[9px] font-mono font-semibold text-muted-foreground">{value.toLocaleString()}</span>}
                                  </div>
                                </div>
                              );
                            }
                            return (
                              <div
                                key={slotIdx}
                                className="w-28 flex-shrink-0 px-1.5 py-1.5 border-l border-border/20 bg-background"
                                data-testid={`pick-cell-${roundIdx + 1}-${slotIdx + 1}`}
                              >
                                <div className="text-[10px] text-muted-foreground/30 text-center py-2.5">—</div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="w-64 flex-shrink-0">
                <CardContent className="p-0">
                  <div className="px-3 py-2.5 border-b border-border/50 bg-muted/30 sticky top-0 z-10">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-foreground" data-testid="text-best-available-title">Best Available</span>
                      <span className="text-[10px] text-muted-foreground">{filteredBestAvailable.length}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {["ALL", "QB", "RB", "WR", "TE"].map(pos => (
                        <button
                          key={pos}
                          className={`px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors ${
                            posFilter === pos
                              ? "bg-[#0b3a7a] text-white"
                              : "text-muted-foreground hover:bg-muted/50"
                          }`}
                          onClick={() => setPosFilter(pos)}
                          data-testid={`button-filter-${pos.toLowerCase()}`}
                        >
                          {pos}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-[600px] overflow-y-auto" data-testid="best-available-list">
                    {filteredBestAvailable.slice(0, 50).map((player, idx) => (
                      <div
                        key={player.id}
                        className="flex items-center gap-2 px-3 py-1.5 border-b border-border/10 hover:bg-muted/20"
                        data-testid={`ba-player-${player.id}`}
                      >
                        <span className="text-[10px] text-muted-foreground w-5 text-right font-mono">{idx + 1}</span>
                        <Badge variant="outline" className={`text-[9px] px-1 py-0 ${POS_BADGE[player.pos] || ""}`}>
                          {player.pos}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-medium text-foreground truncate block">{player.name}</span>
                        </div>
                        <span className="text-[10px] font-mono font-semibold text-muted-foreground">{player.value.toLocaleString()}</span>
                      </div>
                    ))}
                    {filteredBestAvailable.length === 0 && (
                      <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">No players available</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {viewMode === "list" && (
            <>
              <div className="flex items-center gap-1.5">
                {["ALL", "QB", "RB", "WR", "TE"].map(pos => (
                  <Button
                    key={pos}
                    variant={posFilter === pos ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPosFilter(pos)}
                    data-testid={`button-filter-${pos.toLowerCase()}`}
                  >
                    {pos}
                  </Button>
                ))}
              </div>
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="table-draft-board">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/30">
                          <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-16">Pick</th>
                          <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Player</th>
                          <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-16">Pos</th>
                          <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-20">Team</th>
                          <th className="px-4 py-3 text-right font-semibold text-muted-foreground w-24">Value</th>
                          <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Drafter</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draftData.picks
                          .filter(p => p.playerId && (posFilter === "ALL" || p.pos === posFilter))
                          .map((pick) => {
                            const value = getPlayerValue(pick.playerId);
                            const drafter = draftData.draftSlots?.find(s => s.rosterId === pick.rosterId);
                            return (
                              <tr key={`${pick.round}-${pick.pickNo}`} className="border-b border-border/20 hover:bg-muted/20" data-testid={`list-pick-${pick.round}-${pick.pickNo}`}>
                                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                  {pick.round}.{String(pick.pickNo).padStart(2, "0")}
                                </td>
                                <td className="px-4 py-2.5 font-medium text-foreground">{pick.playerName}</td>
                                <td className="px-4 py-2.5">
                                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${POS_BADGE[pick.pos] || ""}`}>
                                    {pick.pos}
                                  </Badge>
                                </td>
                                <td className="px-4 py-2.5 text-xs text-muted-foreground">{pick.team}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">{value > 0 ? value.toLocaleString() : "—"}</td>
                                <td className="px-4 py-2.5 text-xs text-muted-foreground">{drafter?.displayName || `Roster ${pick.rosterId}`}</td>
                              </tr>
                            );
                          })}
                        {draftData.picks.filter(p => p.playerId).length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                              <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />
                              <p>No picks made yet</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {isLoading && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
            <p className="text-sm text-muted-foreground" data-testid="text-loading">Loading draft board...</p>
          </CardContent>
        </Card>
      )}

      {!activeLeagueId && !isLoading && !apiError && (
        <Card>
          <CardContent className="py-16 text-center">
            <Trophy className="w-12 h-12 mx-auto mb-4 text-[#d4af37] opacity-50" />
            <h3 className="font-semibold text-lg text-foreground mb-1" data-testid="text-empty-title">Enter a League ID to get started</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto" data-testid="text-empty-description">
              Paste a Sleeper league ID above and a visual draft board will load with pick-by-pick tracking,
              position color coding, and a best available player list.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
