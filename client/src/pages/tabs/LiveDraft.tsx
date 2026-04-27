import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, RefreshCw, Trophy, Target, Radio, Zap, Timer, ChevronUp, ChevronDown, Minus } from "lucide-react";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { detectLiveDrafts as detectLiveDraftsApi, fetchDraftBoard as fetchDraftBoardApi } from "@/lib/sleeperApi";

interface DraftPick {
  round: number;
  pickNo: number;
  draftSlot: number;
  rosterId: number;
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
  pickedAt: number | null;
  isAutoPick: boolean;
}

interface DraftInfo {
  draftId: string;
  status: string;
  type: string;
  draftCategory: string;
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
  draftCategory: string;
  season: string;
  rounds: number;
  teams: number;
  picksMade: number;
  totalPicks: number;
}

const POS_CELL_BG: Record<string, string> = {
  QB: "bg-red-500/25 dark:bg-red-500/30 border-red-500/40 text-red-900 dark:text-red-200",
  RB: "bg-emerald-500/25 dark:bg-emerald-500/30 border-emerald-500/40 text-emerald-900 dark:text-emerald-200",
  WR: "bg-blue-500/25 dark:bg-blue-500/30 border-blue-500/40 text-blue-900 dark:text-blue-200",
  TE: "bg-orange-500/25 dark:bg-orange-500/30 border-orange-500/40 text-orange-900 dark:text-orange-200",
  K: "bg-purple-500/20 dark:bg-purple-500/25 border-purple-500/30 text-purple-900 dark:text-purple-200",
  DEF: "bg-slate-500/20 dark:bg-slate-500/25 border-slate-500/30 text-slate-900 dark:text-slate-200",
};

const POS_CELL_PROJECTION: Record<string, string> = {
  QB: "bg-red-500/8 dark:bg-red-500/10 border-red-500/15 text-red-800/60 dark:text-red-300/50",
  RB: "bg-emerald-500/8 dark:bg-emerald-500/10 border-emerald-500/15 text-emerald-800/60 dark:text-emerald-300/50",
  WR: "bg-blue-500/8 dark:bg-blue-500/10 border-blue-500/15 text-blue-800/60 dark:text-blue-300/50",
  TE: "bg-orange-500/8 dark:bg-orange-500/10 border-orange-500/15 text-orange-800/60 dark:text-orange-300/50",
  K: "bg-purple-500/5 dark:bg-purple-500/8 border-purple-500/10 text-purple-800/50 dark:text-purple-300/40",
  DEF: "bg-slate-500/5 dark:bg-slate-500/8 border-slate-500/10 text-slate-800/50 dark:text-slate-300/40",
};

const POS_BADGE_SM: Record<string, string> = {
  QB: "text-red-600 dark:text-red-400",
  RB: "text-emerald-600 dark:text-emerald-400",
  WR: "text-blue-600 dark:text-blue-400",
  TE: "text-orange-600 dark:text-orange-400",
};

interface PickTimerStat {
  managerId: string;
  managerName: string;
  totalMs: number;
  pickCount: number;
  autoPickCount: number;
  avgMs: number;
  longestMs: number;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function buildPickTimerStats(
  picks: DraftPick[],
  draftSlots: { slot: number; rosterId: number; displayName: string }[]
): { stats: PickTimerStat[]; hasTimestamps: boolean } {
  const slotMap = new Map<number, string>();
  for (const s of draftSlots) slotMap.set(s.rosterId, s.displayName);

  const sorted = [...picks]
    .filter(p => p.playerId)
    .sort((a, b) => a.pickNo - b.pickNo);

  const hasTimestamps = sorted.some(p => p.pickedAt !== null);
  if (!hasTimestamps) return { stats: [], hasTimestamps: false };

  const managerMap = new Map<number, { name: string; totalMs: number; pickCount: number; autoPickCount: number; longestMs: number }>();

  for (const pick of sorted) {
    const rosterId = pick.rosterId;
    const name = slotMap.get(rosterId) || `Roster ${rosterId}`;
    if (!managerMap.has(rosterId)) {
      managerMap.set(rosterId, { name, totalMs: 0, pickCount: 0, autoPickCount: 0, longestMs: 0 });
    }
    if (pick.isAutoPick) {
      managerMap.get(rosterId)!.autoPickCount += 1;
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev.pickedAt || !curr.pickedAt) continue;
    const diffMs = curr.pickedAt - prev.pickedAt;
    if (diffMs <= 0) continue;

    const rosterId = curr.rosterId;
    const name = slotMap.get(rosterId) || `Roster ${rosterId}`;
    const existing = managerMap.get(rosterId);
    if (existing) {
      existing.totalMs += diffMs;
      existing.pickCount += 1;
      if (diffMs > existing.longestMs) existing.longestMs = diffMs;
    } else {
      managerMap.set(rosterId, { name, totalMs: diffMs, pickCount: 1, autoPickCount: 0, longestMs: diffMs });
    }
  }

  const stats: PickTimerStat[] = Array.from(managerMap.entries())
    .filter(([, v]) => v.pickCount > 0)
    .map(([id, v]) => ({
      managerId: String(id),
      managerName: v.name,
      totalMs: v.totalMs,
      pickCount: v.pickCount,
      autoPickCount: v.autoPickCount,
      avgMs: Math.round(v.totalMs / v.pickCount),
      longestMs: v.longestMs,
    }));

  return { stats, hasTimestamps: true };
}

type TimerSortKey = "avgMs" | "totalMs" | "pickCount" | "autoPickCount" | "longestMs";

function PickTimerView({ draftData, isLoading }: {
  draftData: { picks: DraftPick[]; draftSlots: { slot: number; rosterId: number; displayName: string }[] } | null;
  isLoading: boolean;
}) {
  const [sortKey, setSortKey] = useState<TimerSortKey>("avgMs");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const { stats, hasTimestamps } = useMemo(() => {
    if (!draftData) return { stats: [], hasTimestamps: false };
    return buildPickTimerStats(draftData.picks, draftData.draftSlots);
  }, [draftData]);

  const sorted = useMemo(() => {
    return [...stats].sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortDir === "desc" ? -diff : diff;
    });
  }, [stats, sortKey, sortDir]);

  const handleSort = (key: TimerSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ k }: { k: TimerSortKey }) => {
    if (sortKey !== k) return <Minus className="w-3 h-3 opacity-30" />;
    return sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />;
  };

  const slowest = stats.length > 0 ? [...stats].sort((a, b) => b.avgMs - a.avgMs)[0] : null;
  const fastest = stats.length > 0 ? [...stats].sort((a, b) => a.avgMs - b.avgMs)[0] : null;
  const longestPick = stats.length > 0 ? [...stats].sort((a, b) => b.longestMs - a.longestMs)[0] : null;

  const emptyState = (msg: string) => (
    <Card>
      <CardContent className="py-16 text-center">
        <Timer className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground" data-testid="text-pick-timer-empty">{msg}</p>
      </CardContent>
    </Card>
  );

  if (isLoading) return (
    <Card>
      <CardContent className="py-16 text-center">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
        <p className="text-sm text-muted-foreground">Loading draft data...</p>
      </CardContent>
    </Card>
  );

  if (!draftData) return emptyState("Pick timing will appear once draft picks are made.");
  if (!hasTimestamps) return emptyState("Pick timing data is unavailable for this draft.");
  if (draftData.picks.filter(p => p.playerId && p.pickedAt).length < 2)
    return emptyState("At least two completed picks are needed to calculate pick timing.");
  if (stats.length === 0) return emptyState("Pick timing will appear once draft picks are made.");

  return (
    <div className="space-y-5" data-testid="pick-timer-view">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4" data-testid="card-slowest-picker">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Slowest Avg Picker</p>
          <p className="text-base font-bold text-foreground truncate">{slowest?.managerName ?? "—"}</p>
          <p className="text-2xl font-bold text-red-500 dark:text-red-400">{slowest ? formatDuration(slowest.avgMs) : "—"}</p>
          <p className="text-[11px] text-muted-foreground">avg per pick</p>
        </Card>
        <Card className="p-4" data-testid="card-fastest-picker">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Fastest Avg Picker</p>
          <p className="text-base font-bold text-foreground truncate">{fastest?.managerName ?? "—"}</p>
          <p className="text-2xl font-bold text-emerald-500 dark:text-emerald-400">{fastest ? formatDuration(fastest.avgMs) : "—"}</p>
          <p className="text-[11px] text-muted-foreground">avg per pick</p>
        </Card>
        <Card className="p-4" data-testid="card-longest-pick">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Longest Single Pick</p>
          <p className="text-base font-bold text-foreground truncate">{longestPick?.managerName ?? "—"}</p>
          <p className="text-2xl font-bold text-amber-500 dark:text-amber-400">{longestPick ? formatDuration(longestPick.longestMs) : "—"}</p>
          <p className="text-[11px] text-muted-foreground">single pick time</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="pick-timer-table">
            <thead>
              <tr className="border-b border-border/40 bg-muted/30">
                <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-10">#</th>
                <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Manager</th>
                {(["totalMs", "pickCount", "autoPickCount", "avgMs", "longestMs"] as TimerSortKey[]).map((k) => (
                  <th
                    key={k}
                    className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => handleSort(k)}
                    data-testid={`th-sort-${k}`}
                  >
                    <span className="inline-flex items-center gap-1 justify-end">
                      {k === "totalMs" ? "Total Time" : k === "pickCount" ? "# of Picks" : k === "autoPickCount" ? "Auto Picks" : k === "avgMs" ? "Avg / Pick" : "Longest"}
                      <SortIcon k={k} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => (
                <tr key={s.managerId} className="border-b border-border/20 hover:bg-muted/20 transition-colors" data-testid={`row-timer-${s.managerId}`}>
                  <td className="px-3 py-2.5 text-xs font-medium text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2.5 font-semibold text-foreground">{s.managerName}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatDuration(s.totalMs)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{s.pickCount}</td>
                  <td className="px-3 py-2.5 text-right text-xs" data-testid={`cell-auto-picks-${s.managerId}`}>
                    {s.autoPickCount > 0
                      ? <span className="inline-flex items-center justify-end gap-1 font-semibold text-amber-500 dark:text-amber-400">{s.autoPickCount}</span>
                      : <span className="text-muted-foreground/60">0</span>
                    }
                  </td>
                  <td className={`px-3 py-2.5 text-right font-bold font-mono text-sm ${sortKey === "avgMs" ? "text-foreground" : "text-muted-foreground"}`}>{formatDuration(s.avgMs)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${sortKey === "longestMs" ? "text-foreground" : "text-muted-foreground"}`}>{formatDuration(s.longestMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function LiveDraft({ subTab = "draft-board" }: { subTab?: string }) {
  const [leagueIdInput, setLeagueIdInput] = useState("");
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [draftData, setDraftData] = useState<DraftResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [teamCount, setTeamCount] = useState(12);

  const [liveDrafts, setLiveDrafts] = useState<LiveDraftInfo[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const { dynastyPlayerList, redraftValuesBySleeperId } = useValueModel();
  const [rankMode, setRankMode] = useState<"dynasty" | "redraft">("dynasty");
  const { isConnected, user } = useSleeper();

  const scanForLiveDrafts = useCallback(async () => {
    if (!user?.userId) return;
    setIsDetecting(true);
    setScanError(null);
    try {
      const data: LiveDraftInfo[] = await detectLiveDraftsApi(user.userId);
      setLiveDrafts(data);
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
    setAutoRefresh(false);
  };

  const fetchDraft = useCallback(async (id?: string) => {
    const targetId = id || activeLeagueId;
    if (!targetId) return;
    setIsLoading(true);
    setApiError(null);
    try {
      const data: DraftResponse = await fetchDraftBoardApi(targetId);
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
      intervalRef.current = setInterval(() => fetchDraft(), 45000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, activeLeagueId, fetchDraft]);

  const redraftPlayerList = useMemo(() => {
    if (!redraftValuesBySleeperId || Object.keys(redraftValuesBySleeperId).length === 0) return dynastyPlayerList;
    return [...dynastyPlayerList]
      .map(p => ({ ...p, redraftValue: redraftValuesBySleeperId[p.sleeperId] ?? 0 }))
      .sort((a, b) => b.redraftValue - a.redraftValue);
  }, [dynastyPlayerList, redraftValuesBySleeperId]);

  const fullBoard = useMemo(() => {
    const list = rankMode === "redraft" ? redraftPlayerList : dynastyPlayerList;
    return list.slice(0, 300);
  }, [rankMode, dynastyPlayerList, redraftPlayerList]);

  const globalRankMap = useMemo(() => {
    const map = new Map<string, number>();
    fullBoard.forEach((p, i) => map.set(p.sleeperId, i + 1));
    return map;
  }, [fullBoard]);

  const pickedPlayerIds = useMemo(() => {
    if (!draftData) return new Set<string>();
    return new Set(draftData.picks.map(p => p.playerId).filter(Boolean));
  }, [draftData]);

  const boardGrid = useMemo(() => {
    const rounds = draftData?.draft?.rounds || Math.ceil(fullBoard.length / teamCount);
    const effectiveRounds = Math.min(rounds, Math.ceil(fullBoard.length / teamCount));
    const grid: Array<Array<{ rank: number; player: typeof fullBoard[0] | null; pick: DraftPick | null; isSnake: boolean; isDrafted: boolean }>> = [];

    const pickMap = new Map<string, DraftPick>();
    if (draftData) {
      for (const p of draftData.picks) {
        const key = `${p.round}-${p.draftSlot}`;
        pickMap.set(key, p);
      }
    }

    for (let r = 0; r < effectiveRounds; r++) {
      const row: typeof grid[0] = [];
      const isSnakeRound = r % 2 === 1;

      for (let slot = 0; slot < teamCount; slot++) {
        const actualSlot = isSnakeRound ? (teamCount - 1 - slot) : slot;
        const overallPick = r * teamCount + slot;
        const player = overallPick < fullBoard.length ? fullBoard[overallPick] : null;

        const draftPick = pickMap.get(`${r + 1}-${actualSlot + 1}`);

        let draftedPlayer: typeof fullBoard[0] | null = null;
        if (draftPick?.playerId && draftData?.players) {
          const pInfo = draftData.players[draftPick.playerId];
          if (pInfo) {
            const found = fullBoard.find(p => p.sleeperId === draftPick.playerId);
            draftedPlayer = found || { sleeperId: draftPick.playerId, name: pInfo.name, pos: pInfo.pos, team: pInfo.team, value: 0, age: 0 };
          }
        }

        row.push({
          rank: overallPick + 1,
          player: draftedPlayer || player,
          pick: draftPick || null,
          isSnake: isSnakeRound,
          isDrafted: !!draftedPlayer,
        });
      }
      grid.push(row);
    }
    return grid;
  }, [fullBoard, teamCount, draftData]);

  const slotHeaders = useMemo(() => {
    if (draftData?.draftSlots && draftData.draftSlots.length > 0) {
      return draftData.draftSlots
        .sort((a, b) => a.slot - b.slot)
        .map(s => s.displayName);
    }
    return Array.from({ length: teamCount }, (_, i) => `Pick ${i + 1}`);
  }, [draftData, teamCount]);

  const stats = useMemo(() => {
    const totalDrafted = draftData?.picks.filter(p => p.playerId).length || 0;
    const totalPicks = (draftData?.draft?.rounds || 0) * teamCount;
    return { drafted: totalDrafted, total: totalPicks };
  }, [draftData, teamCount]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (leagueIdInput.trim()) {
      setDraftData(null);
      setApiError(null);
      setActiveLeagueId(leagueIdInput.trim());
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="live-draft-title">
          {subTab === "pick-timer" ? "Pick Timer" : "Live Draft Board"}
        </h2>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-sm text-muted-foreground mt-2" data-testid="text-draft-description">
          {subTab === "pick-timer"
            ? "See how long each manager takes on their picks — load a draft to view timing data."
            : "Track your dynasty drafts in real-time with a visual board layout."}
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
                        <span className="text-[11px] text-muted-foreground">
                          {ld.draftCategory === "rookie" ? "Rookie Draft" : ld.draftCategory === "startup" ? "Startup Draft" : ld.type}
                          {" · "}{ld.teams} teams · {ld.rounds} rounds
                        </span>
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

      {isLoading && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
            <p className="text-sm text-muted-foreground" data-testid="text-loading-draft">Loading draft data...</p>
          </CardContent>
        </Card>
      )}

      {!activeLeagueId && !isLoading && subTab !== "pick-timer" && (
        <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="draft-empty-state">
          <div className="w-16 h-16 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-6">
            <Trophy className="w-8 h-8 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">Select a Draft to Begin</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            {isConnected
              ? "Pick a live draft above or enter a league ID to load the draft board."
              : "Connect your Sleeper account to auto-detect live drafts, or enter a league ID manually above."}
          </p>
        </div>
      )}

      {subTab === "pick-timer" && (
        <PickTimerView draftData={draftData} isLoading={isLoading} />
      )}

      {subTab !== "pick-timer" && activeLeagueId && !isLoading && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-[#d4af37]" />
                <span className="font-semibold text-foreground" data-testid="text-rankings-title">
                  Draft Board
                </span>
                {draftData?.draft && (
                  <Badge variant="outline" className="text-xs" data-testid="text-draft-status">
                    {draftData.draft.status === "drafting" ? "LIVE" : draftData.draft.status}
                  </Badge>
                )}
                {draftData?.draft?.draftCategory && (
                  <Badge
                    variant="outline"
                    className={`text-xs ${draftData.draft.draftCategory === "rookie" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-amber-500/40 text-amber-600 dark:text-amber-400"}`}
                    data-testid="text-draft-category"
                  >
                    {draftData.draft.draftCategory === "rookie" ? "Rookie Draft" : draftData.draft.draftCategory === "startup" ? "Startup Draft" : draftData.draft.draftCategory}
                  </Badge>
                )}
                {draftData && stats.drafted > 0 && (
                  <span className="text-xs text-muted-foreground" data-testid="text-board-progress">
                    {stats.drafted} / {stats.total} picks made
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {teamCount && (
                  <span className="text-xs text-muted-foreground" data-testid="text-team-count">
                    {teamCount} teams
                  </span>
                )}
                <div className="flex items-center border border-border rounded-md overflow-hidden" data-testid="toggle-rank-mode">
                  <button
                    className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      rankMode === "dynasty" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"
                    }`}
                    onClick={() => setRankMode("dynasty")}
                    data-testid="button-rank-dynasty"
                  >
                    Dynasty
                  </button>
                  <button
                    className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      rankMode === "redraft" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"
                    }`}
                    onClick={() => setRankMode("redraft")}
                    data-testid="button-rank-redraft"
                  >
                    Redraft
                  </button>
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
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30 border border-red-500/40" />QB</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/40" />RB</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500/30 border border-blue-500/40" />WR</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500/30 border border-orange-500/40" />TE</span>
            </div>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded border-2 border-dashed border-border/60" />
              Empty pick
            </span>
            {draftData && (
              <span className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border/40">
                <span className="w-3 h-3 rounded bg-muted/30 border border-border/30 opacity-50" />
                Already drafted
              </span>
            )}
          </div>

          {dynastyPlayerList.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
                <p className="text-sm text-muted-foreground" data-testid="text-loading">Loading dynasty rankings...</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-2xl overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <div className="min-w-[700px]" data-testid="draft-board-grid">
                    <div className="grid gap-px bg-border/30" style={{ gridTemplateColumns: `48px repeat(${teamCount}, 1fr)` }}>
                      <div className="bg-muted/50 dark:bg-muted/20 p-1.5 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase">Rd</span>
                      </div>
                      {slotHeaders.map((header, i) => (
                        <div key={i} className="bg-muted/50 dark:bg-muted/20 p-1.5 text-center" data-testid={`col-header-${i}`}>
                          <span className="text-[10px] font-bold text-muted-foreground uppercase truncate block leading-tight">
                            {header.length > 8 ? header.slice(0, 7) + "…" : header}
                          </span>
                        </div>
                      ))}

                      {boardGrid.map((row, roundIdx) => (
                        <>
                          <div key={`round-${roundIdx}`} className="bg-muted/30 dark:bg-muted/10 p-1.5 flex items-center justify-center border-t border-border/20">
                            <span className="text-xs font-bold text-[#0b3a7a] dark:text-[#d4af37]">{roundIdx + 1}</span>
                          </div>
                          {row.map((cell, slotIdx) => {
                            const hasPlayer = !!cell.player;
                            const pos = cell.player?.pos || cell.pick?.pos || "";
                            const wasDrafted = hasPlayer && cell.isDrafted && !!draftData;
                            const cellStyle = hasPlayer
                              ? wasDrafted
                                ? (POS_CELL_PROJECTION[pos] || "bg-muted/10 border-border/20 text-muted-foreground")
                                : (POS_CELL_BG[pos] || "bg-muted/20 border-border/30 text-foreground")
                              : "";
                            const isEmpty = !hasPlayer;

                            return (
                              <div
                                key={`${roundIdx}-${slotIdx}`}
                                className={`
                                  p-1 md:p-1.5 border-t border-border/20 flex flex-col items-center justify-center min-h-[52px] md:min-h-[56px] transition-colors
                                  ${hasPlayer ? `${cellStyle} border rounded-sm` : isEmpty ? "bg-background border border-dashed border-border/30 rounded-sm" : "bg-muted/10 rounded-sm"}
                                `}
                                data-testid={`cell-${roundIdx + 1}-${slotIdx + 1}`}
                              >
                                {hasPlayer ? (
                                  <>
                                    <span className={`text-[10px] md:text-[11px] leading-tight text-center truncate w-full px-0.5 ${wasDrafted ? "font-medium opacity-60" : "font-bold"}`}>
                                      {cell.player!.name.split(" ").length > 1
                                        ? `${cell.player!.name.split(" ")[0][0]}. ${cell.player!.name.split(" ").slice(1).join(" ")}`
                                        : cell.player!.name}
                                    </span>
                                    <span className={`text-[9px] font-bold mt-0.5 ${wasDrafted ? "opacity-40 " : ""}${POS_BADGE_SM[pos] || "text-muted-foreground"}`}>
                                      {pos}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground/40 font-mono">
                                    {roundIdx + 1}.{String(slotIdx + 1).padStart(2, "0")}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
