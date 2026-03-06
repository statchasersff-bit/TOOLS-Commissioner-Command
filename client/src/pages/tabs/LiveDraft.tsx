import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, RefreshCw, Trophy, Target, Radio, Zap, ChevronDown } from "lucide-react";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import type { RankedPlayer } from "@/contexts/ValueModelContext";

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

const POS_BADGE: Record<string, string> = {
  QB: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  RB: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  WR: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  TE: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
};

const POS_ROW_BG: Record<string, string> = {
  QB: "bg-red-500/5",
  RB: "bg-emerald-500/5",
  WR: "bg-blue-500/5",
  TE: "bg-orange-500/5",
};

function formatPickLabel(rank: number, teamsInLeague: number): string {
  const round = Math.ceil(rank / teamsInLeague);
  const pick = ((rank - 1) % teamsInLeague) + 1;
  return `${round}.${String(pick).padStart(2, "0")}`;
}

export default function LiveDraft() {
  const [leagueIdInput, setLeagueIdInput] = useState("");
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [draftData, setDraftData] = useState<DraftResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [teamCount, setTeamCount] = useState(12);
  const [showCount, setShowCount] = useState(120);

  const [liveDrafts, setLiveDrafts] = useState<LiveDraftInfo[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const { dynastyPlayerList } = useValueModel();
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

  const handleJoinLiveDraft = (leagueId: string, teams: number) => {
    setLeagueIdInput(leagueId);
    setDraftData(null);
    setApiError(null);
    setActiveLeagueId(leagueId);
    setTeamCount(teams);
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
      if (data.draft?.teams) setTeamCount(data.draft.teams);
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

  const pickedByMap = useMemo(() => {
    if (!draftData) return new Map<string, { round: number; pickNo: number; drafter: string }>();
    const map = new Map<string, { round: number; pickNo: number; drafter: string }>();
    for (const pick of draftData.picks) {
      if (pick.playerId) {
        const drafter = draftData.draftSlots?.find(s => s.rosterId === pick.rosterId)?.displayName || `Team ${pick.rosterId}`;
        map.set(pick.playerId, { round: pick.round, pickNo: pick.pickNo, drafter });
      }
    }
    return map;
  }, [draftData]);

  const fullBoard = useMemo(() => dynastyPlayerList.slice(0, 300), [dynastyPlayerList]);

  const rankedPlayers = useMemo(() => {
    if (posFilter === "ALL") return fullBoard;
    return fullBoard.filter(p => p.pos === posFilter);
  }, [fullBoard, posFilter]);

  const globalRankMap = useMemo(() => {
    const map = new Map<string, number>();
    fullBoard.forEach((p, i) => map.set(p.sleeperId, i + 1));
    return map;
  }, [fullBoard]);

  const stats = useMemo(() => {
    const totalDrafted = fullBoard.filter(p => pickedPlayerIds.has(p.sleeperId)).length;
    const filteredDrafted = rankedPlayers.filter(p => pickedPlayerIds.has(p.sleeperId)).length;
    return { total: fullBoard.length, drafted: totalDrafted, showing: rankedPlayers.length, filteredDrafted, available: fullBoard.length - totalDrafted };
  }, [fullBoard, rankedPlayers, pickedPlayerIds]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (leagueIdInput.trim()) {
      setDraftData(null);
      setApiError(null);
      setActiveLeagueId(leagueIdInput.trim());
    }
  };

  const visiblePlayers = rankedPlayers.slice(0, showCount);
  const hasMore = rankedPlayers.length > showCount;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="live-draft-title">
          Dynasty Rankings Board
        </h2>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-sm text-muted-foreground mt-2" data-testid="text-draft-description">
          Dynasty source rankings ordered by value with pick slot assignments. Connect a Sleeper draft to fade picked players in real-time.
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
                        <span className="text-[11px] text-muted-foreground">{ld.type} · {ld.teams} teams · {ld.rounds} rounds</span>
                        <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400" data-testid={`text-live-progress-${ld.leagueId}`}>
                          {ld.picksMade}/{ld.totalPicks} picks
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleJoinLiveDraft(ld.leagueId, ld.teams)}
                      data-testid={`button-join-draft-${ld.leagueId}`}
                    >
                      <Target className="w-3.5 h-3.5 mr-1.5" />
                      Track Draft
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
              <label className="text-sm font-medium text-foreground mb-1.5 block" data-testid="label-league-id">Sleeper League ID (optional — to track drafted players)</label>
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

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[#d4af37]" />
            <span className="font-semibold text-foreground" data-testid="text-rankings-title">
              Dynasty Rankings
            </span>
            {draftData?.draft && (
              <Badge variant="outline" className="text-xs" data-testid="text-draft-status">
                {draftData.draft.status === "drafting" ? "LIVE" : draftData.draft.status}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>League Size:</span>
            <div className="flex items-center border border-border rounded-md overflow-hidden">
              {[8, 10, 12, 14, 16].map(n => (
                <button
                  key={n}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    teamCount === n ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => setTeamCount(n)}
                  data-testid={`button-teams-${n}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draftData?.draft && (
            <>
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
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <div className="flex items-center gap-1.5">
          {["ALL", "QB", "RB", "WR", "TE"].map(pos => (
            <button
              key={pos}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                posFilter === pos
                  ? "bg-[#0b3a7a] text-white shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => setPosFilter(pos)}
              data-testid={`button-filter-${pos.toLowerCase()}`}
            >
              {pos}
            </button>
          ))}
        </div>
        <span className="ml-auto" data-testid="text-stats-summary">
          {posFilter !== "ALL" && <><span className="font-semibold text-foreground">{stats.showing}</span> {posFilter}s · </>}
          <span className="font-semibold text-foreground">{stats.available}</span>/{stats.total} available
          {stats.drafted > 0 && (
            <> · <span className="font-semibold text-muted-foreground">{stats.drafted}</span> drafted</>
          )}
        </span>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/20 border border-red-500/40" />QB</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/20 border border-emerald-500/40" />RB</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500/20 border border-blue-500/40" />WR</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500/20 border border-orange-500/40" />TE</span>
        </div>
      </div>

      {dynastyPlayerList.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
            <p className="text-sm text-muted-foreground" data-testid="text-loading">Loading dynasty rankings...</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="rounded-2xl overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="rankings-board">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30 sticky top-0 z-10">
                      <th className="px-3 py-2.5 text-center font-bold text-[11px] text-muted-foreground uppercase tracking-wider w-16">Pick</th>
                      <th className="px-3 py-2.5 text-center font-bold text-[11px] text-muted-foreground uppercase tracking-wider w-10">Rank</th>
                      <th className="px-3 py-2.5 text-left font-bold text-[11px] text-muted-foreground uppercase tracking-wider">Player</th>
                      <th className="px-3 py-2.5 text-center font-bold text-[11px] text-muted-foreground uppercase tracking-wider w-14">Pos</th>
                      <th className="px-3 py-2.5 text-center font-bold text-[11px] text-muted-foreground uppercase tracking-wider w-14">NFL</th>
                      <th className="px-3 py-2.5 text-center font-bold text-[11px] text-muted-foreground uppercase tracking-wider w-14">Age</th>
                      <th className="px-3 py-2.5 text-right font-bold text-[11px] text-muted-foreground uppercase tracking-wider w-20">Value</th>
                      {draftData && <th className="px-3 py-2.5 text-left font-bold text-[11px] text-muted-foreground uppercase tracking-wider w-32">Drafted By</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePlayers.map((player, idx) => {
                      const isDrafted = pickedPlayerIds.has(player.sleeperId);
                      const draftInfo = pickedByMap.get(player.sleeperId);
                      const rank = globalRankMap.get(player.sleeperId) ?? idx + 1;
                      const pickLabel = formatPickLabel(rank, teamCount);
                      const isNewRound = posFilter === "ALL" && idx > 0 && Math.ceil((idx + 1) / teamCount) !== Math.ceil(idx / teamCount);

                      return (
                        <tr
                          key={player.sleeperId}
                          className={`
                            border-b border-border/20 transition-colors
                            ${isDrafted ? "opacity-30" : ""}
                            ${!isDrafted ? POS_ROW_BG[player.pos] || "" : ""}
                            ${isNewRound ? "border-t-2 border-t-[#d4af37]/30" : ""}
                          `}
                          data-testid={`rank-row-${player.sleeperId}`}
                        >
                          <td className="px-3 py-2 text-center">
                            <span className={`font-mono text-xs font-bold ${isDrafted ? "line-through text-muted-foreground" : "text-[#0b3a7a] dark:text-[#d4af37]"}`}>
                              {pickLabel}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-xs text-muted-foreground font-mono">{rank}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`font-medium ${isDrafted ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {player.name}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${POS_BADGE[player.pos] || ""}`}>
                              {player.pos}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-center text-xs text-muted-foreground">{player.team}</td>
                          <td className="px-3 py-2 text-center text-xs text-muted-foreground">{player.age > 0 ? player.age.toFixed(1) : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`font-mono text-xs font-semibold ${isDrafted ? "text-muted-foreground" : "text-foreground"}`}>
                              {player.value.toLocaleString()}
                            </span>
                          </td>
                          {draftData && (
                            <td className="px-3 py-2">
                              {draftInfo ? (
                                <span className="text-xs text-muted-foreground">
                                  {draftInfo.drafter}
                                  <span className="ml-1 font-mono text-[10px]">({draftInfo.round}.{String(draftInfo.pickNo).padStart(2, "0")})</span>
                                </span>
                              ) : null}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => setShowCount(prev => Math.min(prev + 60, 300))}
                data-testid="button-show-more"
              >
                <ChevronDown className="w-4 h-4 mr-1.5" />
                Show More ({Math.min(rankedPlayers.length - showCount, 60)} more)
              </Button>
            </div>
          )}
        </>
      )}

      {isLoading && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
            <p className="text-sm text-muted-foreground" data-testid="text-loading-draft">Loading draft data...</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
