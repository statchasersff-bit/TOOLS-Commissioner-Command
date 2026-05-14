import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, RefreshCw, Trophy, Target, Radio, Zap, MessageSquare, Key, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { detectLiveDrafts as detectLiveDraftsApi, fetchDraftBoard as fetchDraftBoardApi } from "@/lib/sleeperApi";
import { ROOKIE_BOARD_2026_SF, ROOKIE_BOARD_2026_1QB } from "@/data/rookieBoard2026";

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
  startTime: number | null;
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

interface DraftMessage {
  message_id: string;
  author_is_bot: boolean;
  created: number;
  text: string;
}

interface ParsedPick {
  message_id: string;
  round: number;
  pickInRound: number;
  playerName: string;
  position: string;
  team: string;
  forced: boolean;
  created: number;
}

const SLEEPER_JWT_KEY = "dc-sleeper-draft-jwt";

const PICK_RE = /^Pick (\d+)\.(\d+) - Pick: (.+?) \((\w+) - (\w+)\)$/;
const FORCED_RE = /^Pick (\d+)\.(\d+) - Commish forced pick: (.+?) \((\w+) - (\w+)\)$/;

function parsePickMessage(msg: DraftMessage): ParsedPick | null {
  const forced = FORCED_RE.exec(msg.text);
  if (forced) {
    return { message_id: msg.message_id, round: +forced[1], pickInRound: +forced[2], playerName: forced[3], position: forced[4], team: forced[5], forced: true, created: msg.created };
  }
  const normal = PICK_RE.exec(msg.text);
  if (normal) {
    return { message_id: msg.message_id, round: +normal[1], pickInRound: +normal[2], playerName: normal[3], position: normal[4], team: normal[5], forced: false, created: msg.created };
  }
  return null;
}

async function fetchDraftMessages(draftId: string, jwt: string): Promise<DraftMessage[]> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "authorization": jwt,
      "x-sleeper-graphql-op": "messages",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `query messages { messages(parent_id: "${draftId}") { message_id author_is_bot created text } }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  return (json?.data?.messages as DraftMessage[]) || [];
}

async function fetchDraftQueue(draftId: string, jwt: string): Promise<string[]> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "authorization": jwt,
      "x-sleeper-graphql-op": "draft_queue",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `query draft_queue { draft_queue(draft_id: "${draftId}") }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  return (json?.data?.draft_queue as string[]) || [];
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

export default function LiveDraft() {
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
  const [rookieFormat, setRookieFormat] = useState<"SF" | "1QB">("1QB");
  const [manualRookieMode, setManualRookieMode] = useState(false);
  const { isConnected, user, leagues } = useSleeper();

  // ── Draft log / message history ──────────────────────────────────────────
  const [sleeperJwt, setSleeperJwt] = useState<string | null>(null);
  const [jwtInput, setJwtInput] = useState("");
  const [showJwtInput, setShowJwtInput] = useState(false);
  const [draftMessages, setDraftMessages] = useState<DraftMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draftStarted, setDraftStarted] = useState(false);
  const [showFullLog, setShowFullLog] = useState(false);
  const [draftQueue, setDraftQueue] = useState<string[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(SLEEPER_JWT_KEY);
    if (saved) setSleeperJwt(saved);
  }, []);

  const activeDraftId = draftData?.draft?.draftId ?? null;

  const refreshMessages = useCallback(async (draftId: string, jwt: string) => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const msgs = await fetchDraftMessages(draftId, jwt);
      const sorted = [...msgs].sort((a, b) => a.created - b.created);
      setDraftMessages(sorted);
      setDraftStarted(sorted.some(m => m.text === "This draft has begun!"));
    } catch (e: any) {
      setMessagesError(e.message || "Failed to load draft log");
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const refreshQueue = useCallback(async (draftId: string, jwt: string) => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const ids = await fetchDraftQueue(draftId, jwt);
      setDraftQueue(ids);
    } catch (e: any) {
      setQueueError(e.message || "Failed to load queue");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeDraftId && sleeperJwt) {
      setDraftMessages([]);
      setDraftQueue([]);
      refreshMessages(activeDraftId, sleeperJwt);
      refreshQueue(activeDraftId, sleeperJwt);
    }
  }, [activeDraftId, sleeperJwt, refreshMessages, refreshQueue]);

  // Clear messages + queue when draft changes
  useEffect(() => {
    setDraftMessages([]);
    setDraftStarted(false);
    setMessagesError(null);
    setDraftQueue([]);
    setQueueError(null);
  }, [activeLeagueId]);

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
      intervalRef.current = setInterval(() => {
        fetchDraft();
        if (activeDraftId && sleeperJwt) {
          refreshMessages(activeDraftId, sleeperJwt);
          refreshQueue(activeDraftId, sleeperJwt);
        }
      }, 45000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, activeLeagueId, activeDraftId, sleeperJwt, fetchDraft, refreshMessages, refreshQueue]);

  const redraftPlayerList = useMemo(() => {
    if (!redraftValuesBySleeperId || Object.keys(redraftValuesBySleeperId).length === 0) return dynastyPlayerList;
    return [...dynastyPlayerList]
      .map(p => ({ ...p, redraftValue: redraftValuesBySleeperId[p.sleeperId] ?? 0 }))
      .sort((a, b) => b.redraftValue - a.redraftValue);
  }, [dynastyPlayerList, redraftValuesBySleeperId]);

  // Rounds ≤ 6 = rookie; > 6 = startup. Also honour explicit draftCategory.
  const isRookieDraft =
    draftData?.draft?.draftCategory === "rookie" ||
    (!!draftData?.draft && draftData.draft.draftCategory !== "startup" && draftData.draft.rounds <= 6);
  const effectiveRookieMode = isRookieDraft || manualRookieMode;

  // Auto-detect SF vs 1QB from the connected user's league list
  useEffect(() => {
    if (!effectiveRookieMode || !activeLeagueId) return;
    const league = leagues.find(l => l.leagueId === activeLeagueId);
    if (league) {
      const isSF = league.rosterPositions.includes("SUPER_FLEX");
      setRookieFormat(isSF ? "SF" : "1QB");
    }
  }, [effectiveRookieMode, activeLeagueId, leagues]);

  // Sync manualRookieMode with auto-detected isRookieDraft when draft loads
  useEffect(() => {
    if (isRookieDraft) setManualRookieMode(true);
  }, [isRookieDraft]);

  const fullBoard = useMemo(() => {
    if (effectiveRookieMode) {
      return rookieFormat === "SF" ? ROOKIE_BOARD_2026_SF : ROOKIE_BOARD_2026_1QB;
    }
    const list = rankMode === "redraft" ? redraftPlayerList : dynastyPlayerList;
    return list.slice(0, 300);
  }, [effectiveRookieMode, rookieFormat, rankMode, dynastyPlayerList, redraftPlayerList]);

  const globalRankMap = useMemo(() => {
    const map = new Map<string, number>();
    fullBoard.forEach((p, i) => map.set(p.sleeperId, i + 1));
    return map;
  }, [fullBoard]);

  const posRankMap = useMemo(() => {
    const map = new Map<string, number>();
    const counters: Record<string, number> = {};
    for (const p of fullBoard) {
      counters[p.pos] = (counters[p.pos] || 0) + 1;
      map.set(p.sleeperId, counters[p.pos]);
    }
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

        row.push({
          rank: overallPick + 1,
          player,  // Always the board-ranked player — never replaced
          pick: draftPick || null,
          isSnake: isSnakeRound,
          isDrafted: !!(draftPick?.playerId),  // slot has been filled in Sleeper
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

  const parsedPicks = useMemo<ParsedPick[]>(() => {
    return draftMessages.map(parsePickMessage).filter((p): p is ParsedPick => p !== null);
  }, [draftMessages]);

  const handleSaveJwt = () => {
    const val = jwtInput.trim();
    if (!val) return;
    localStorage.setItem(SLEEPER_JWT_KEY, val);
    setSleeperJwt(val);
    setJwtInput("");
    setShowJwtInput(false);
    if (activeDraftId) {
      refreshMessages(activeDraftId, val);
      refreshQueue(activeDraftId, val);
    }
  };

  const handleClearJwt = () => {
    localStorage.removeItem(SLEEPER_JWT_KEY);
    setSleeperJwt(null);
    setDraftMessages([]);
    setDraftStarted(false);
    setDraftQueue([]);
  };

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
          Live Draft Board
        </h2>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-sm text-muted-foreground mt-2" data-testid="text-draft-description">
          Track your dynasty drafts in real-time with a visual board layout.
        </p>
      </div>

      {isConnected && (
        <Card className={liveDrafts.length > 0 ? "border-emerald-500/40 bg-emerald-500/5" : ""}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Radio className={`w-4 h-4 flex-shrink-0 ${liveDrafts.length > 0 ? "text-emerald-500 animate-pulse" : "text-muted-foreground"}`} />
                <span className="text-sm font-semibold text-foreground whitespace-nowrap" data-testid="text-live-detector-title">Live Draft Detector</span>
                {liveDrafts.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 flex-shrink-0" data-testid="badge-live-count">
                    {liveDrafts.length} LIVE
                  </Badge>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="flex-shrink-0 px-2.5"
                onClick={scanForLiveDrafts}
                disabled={isDetecting}
                data-testid="button-scan-drafts"
              >
                {isDetecting ? <Loader2 className="w-3.5 h-3.5 animate-spin sm:mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">{hasScanned ? "Re-scan" : "Scan"}</span>
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
                    className="flex items-center justify-between gap-2 p-3 rounded-lg border border-emerald-500/20 bg-background"
                    data-testid={`live-draft-${ld.leagueId}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-[#d4af37] flex-shrink-0" />
                        <span className="font-medium text-sm text-foreground truncate" data-testid={`text-live-league-name-${ld.leagueId}`}>
                          {ld.leagueName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 ml-5">
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {ld.draftCategory === "rookie" ? "Rookie" : ld.draftCategory === "startup" ? "Startup" : ld.type}
                          {" · "}{ld.teams}T · {ld.rounds}R
                        </span>
                        <span className="text-[11px] text-muted-foreground">·</span>
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap" data-testid={`text-live-progress-${ld.leagueId}`}>
                          {ld.picksMade}/{ld.totalPicks} picks
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="flex-shrink-0 px-3"
                      onClick={() => handleJoinLiveDraft(ld.leagueId, ld.teams)}
                      data-testid={`button-join-draft-${ld.leagueId}`}
                    >
                      <Target className="w-3.5 h-3.5 mr-1.5" />
                      <span className="hidden sm:inline">Track Draft</span>
                      <span className="sm:hidden">Track</span>
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
              <label className="text-sm font-medium text-foreground mb-1.5 block" data-testid="label-league-id">Sleeper League ID (optional, to track drafted players)</label>
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

      {!activeLeagueId && !isLoading && (
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

      {activeLeagueId && !isLoading && (
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
                {draftData && (
                  <div className="flex items-center border border-border rounded-md overflow-hidden" data-testid="toggle-rookie-mode">
                    <button
                      className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${effectiveRookieMode ? "bg-emerald-600 text-white" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                      onClick={() => setManualRookieMode(!effectiveRookieMode)}
                      data-testid="button-rookie-mode"
                    >
                      Rookie Board
                    </button>
                  </div>
                )}
                {effectiveRookieMode ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5" data-testid="badge-rookie-rankings">
                      FantasyCalc 2026 (PPR)
                    </Badge>
                    <div className="flex items-center border border-border rounded-md overflow-hidden" data-testid="toggle-rookie-format">
                      <button
                        className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${rookieFormat === "1QB" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                        onClick={() => setRookieFormat("1QB")}
                        data-testid="button-rookie-1qb"
                      >
                        1QB
                      </button>
                      <button
                        className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${rookieFormat === "SF" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                        onClick={() => setRookieFormat("SF")}
                        data-testid="button-rookie-sf"
                      >
                        SF
                      </button>
                    </div>
                  </div>
                ) : (
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
                )}
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

          {!isRookieDraft && dynastyPlayerList.length === 0 ? (
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
                        <Fragment key={`round-${roundIdx}`}>
                          <div className="bg-muted/30 dark:bg-muted/10 p-1.5 flex items-center justify-center border-t border-border/20">
                            <span className="text-xs font-bold text-[#0b3a7a] dark:text-[#d4af37]">{roundIdx + 1}</span>
                          </div>
                          {row.map((cell, slotIdx) => {
                            const hasPlayer = !!cell.player;
                            const pos = cell.player?.pos || "";
                            const wasDrafted = cell.isDrafted && !!draftData;
                            const pickLabel = `${roundIdx + 1}.${String(slotIdx + 1).padStart(2, "0")}`;
                            const posRank = cell.player ? posRankMap.get(cell.player.sleeperId) : undefined;
                            const posLabel = pos && posRank ? `${pos}${posRank}` : pos;
                            const fullName = cell.player?.name || "";
                            const nameParts = fullName.split(" ");
                            const firstName = nameParts[0] || "";
                            const lastName = nameParts.slice(1).join(" ") || firstName;
                            const sid = cell.player?.sleeperId || "";
                            const hasRealImage = sid && !sid.startsWith("rookie_");

                            const posTextColor: Record<string, string> = {
                              QB: "text-red-900 dark:text-red-100",
                              RB: "text-emerald-900 dark:text-emerald-100",
                              WR: "text-blue-900 dark:text-blue-100",
                              TE: "text-orange-900 dark:text-orange-100",
                            };
                            const posBorderColor: Record<string, string> = {
                              QB: "border-red-500/50",
                              RB: "border-emerald-500/50",
                              WR: "border-blue-500/50",
                              TE: "border-orange-500/50",
                            };
                            const posGradient: Record<string, string> = {
                              QB: "from-red-200 dark:from-red-950",
                              RB: "from-emerald-200 dark:from-emerald-950",
                              WR: "from-blue-200 dark:from-blue-950",
                              TE: "from-orange-200 dark:from-orange-950",
                            };

                            return (
                              <div
                                key={`${roundIdx}-${slotIdx}`}
                                className={`relative overflow-hidden rounded-sm border transition-all min-h-[76px] ${
                                  hasPlayer
                                    ? `${POS_CELL_BG[pos] || "bg-muted/20 border-border/30"} ${posBorderColor[pos] || ""}`
                                    : "bg-background border-dashed border-border/30"
                                } ${wasDrafted ? "opacity-30" : ""}`}
                                data-testid={`cell-${roundIdx + 1}-${slotIdx + 1}`}
                              >
                                {hasPlayer ? (
                                  <>
                                    {/* Player headshot — full height right side */}
                                    {hasRealImage && (
                                      <div className="absolute right-0 top-0 bottom-0 w-[52%] overflow-hidden pointer-events-none">
                                        <img
                                          src={`https://sleepercdn.com/content/nfl/players/${sid}.jpg`}
                                          alt={fullName}
                                          className="h-full w-full object-cover object-top"
                                          onError={(e) => {
                                            const img = e.target as HTMLImageElement;
                                            img.src = `https://sleepercdn.com/content/nfl/players/thumb/${sid}.jpg`;
                                            img.onerror = () => { img.style.display = "none"; };
                                          }}
                                        />
                                        {/* gradient from bg colour → transparent so text is readable */}
                                        <div className={`absolute inset-0 bg-gradient-to-r ${posGradient[pos] || "from-muted"} via-transparent to-transparent`} />
                                      </div>
                                    )}
                                    {/* Left content */}
                                    <div className={`relative z-10 p-1 flex flex-col justify-between min-h-[76px] ${hasRealImage ? "w-[54%]" : "w-full"} ${posTextColor[pos] || "text-foreground"}`}>
                                      <span className="text-[8.5px] font-extrabold leading-none opacity-90 tabular-nums">
                                        {pickLabel} {posLabel}
                                      </span>
                                      <div>
                                        <div className="text-[8px] leading-none opacity-75 truncate">{firstName}</div>
                                        <div className="text-[11px] font-bold leading-tight truncate">{lastName}</div>
                                        <div className="text-[8px] opacity-70 font-medium mt-0.5">
                                          ({(cell.player!.value || 0).toLocaleString()})
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <div className="flex items-center justify-center min-h-[76px]">
                                    <span className="text-[10px] text-muted-foreground/40 font-mono">{pickLabel}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── My Queue ─────────────────────────────────────────────────── */}
          {sleeperJwt && (
            <Card data-testid="card-my-queue">
              <CardContent className="pt-5 pb-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                    <span className="text-sm font-semibold">My Queue</span>
                    {draftQueue.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">{draftQueue.length}</Badge>
                    )}
                    {queueLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  {activeDraftId && (
                    <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs"
                      onClick={() => refreshQueue(activeDraftId, sleeperJwt!)}
                      disabled={queueLoading} data-testid="button-refresh-queue">
                      <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                    </Button>
                  )}
                </div>

                {queueError && (
                  <p className="text-xs text-red-500" data-testid="text-queue-error">{queueError}</p>
                )}

                {!queueLoading && draftQueue.length === 0 && !queueError && (
                  <p className="text-xs text-muted-foreground text-center py-3" data-testid="text-queue-empty">
                    No queued players yet
                  </p>
                )}

                {draftQueue.length > 0 && (
                  <div className="space-y-1" data-testid="list-queue-players">
                    {draftQueue.map((playerId, idx) => {
                      const p = draftData?.players?.[playerId];
                      const name = p?.name ?? playerId;
                      const pos = p?.pos ?? "";
                      const team = p?.team ?? "";
                      const rank = globalRankMap.get(playerId);
                      const isDrafted = pickedPlayerIds.has(playerId);
                      const posColors: Record<string, string> = {
                        QB: "text-red-600 dark:text-red-400",
                        RB: "text-emerald-600 dark:text-emerald-400",
                        WR: "text-blue-600 dark:text-blue-400",
                        TE: "text-orange-500 dark:text-orange-400",
                      };
                      const posBorderColors: Record<string, string> = {
                        QB: "border-red-500/30",
                        RB: "border-emerald-500/30",
                        WR: "border-blue-500/30",
                        TE: "border-orange-500/30",
                      };
                      return (
                        <div key={playerId}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
                            isDrafted
                              ? "opacity-40 border-border/20 bg-muted/10 line-through"
                              : `border-border/30 bg-muted/20 ${pos ? posBorderColors[pos] || "" : ""}`
                          }`}
                          data-testid={`queue-player-${playerId}`}>
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-5 flex-shrink-0">
                            {idx + 1}
                          </span>
                          {pos && (
                            <span className={`text-[10px] font-bold flex-shrink-0 w-6 ${posColors[pos] || "text-muted-foreground"}`}>
                              {pos}
                            </span>
                          )}
                          <span className={`font-semibold truncate flex-1 ${isDrafted ? "text-muted-foreground" : "text-foreground"}`}>
                            {name}
                          </span>
                          {team && <span className="text-[10px] text-muted-foreground flex-shrink-0">{team}</span>}
                          {rank && !isDrafted && (
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">#{rank}</span>
                          )}
                          {isDrafted && (
                            <Badge variant="outline" className="text-[9px] px-1 h-4 border-border/40 text-muted-foreground flex-shrink-0">
                              Drafted
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Draft Log ─────────────────────────────────────────────────── */}
          <Card data-testid="card-draft-log">
            <CardContent className="pt-5 pb-4 space-y-4">

              {/* Header row */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                  <span className="text-sm font-semibold">Draft Log</span>
                  {draftStarted && (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                      Draft Started
                    </Badge>
                  )}
                  {parsedPicks.some(p => p.forced) && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Forced Pick
                    </Badge>
                  )}
                  {messagesLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-2">
                  {sleeperJwt && activeDraftId && (
                    <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs"
                      onClick={() => refreshMessages(activeDraftId, sleeperJwt)}
                      disabled={messagesLoading} data-testid="button-refresh-messages">
                      <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className={`h-7 px-2.5 text-xs gap-1.5 ${sleeperJwt ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : ""}`}
                    onClick={() => setShowJwtInput(v => !v)} data-testid="button-jwt-toggle">
                    <Key className="w-3 h-3" />
                    {sleeperJwt ? "Token Set" : "Set Token"}
                  </Button>
                </div>
              </div>

              {/* JWT input panel */}
              {showJwtInput && (
                <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3" data-testid="panel-jwt-input">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-foreground">Sleeper Auth Token</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Paste your Sleeper JWT to enable draft message history. Find it in browser DevTools → Application → Local Storage → <code className="font-mono bg-muted px-1 rounded text-[10px]">sleeper-auth</code>, or from network request headers on sleeper.com.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="eyJhbGci…"
                      value={jwtInput}
                      onChange={e => setJwtInput(e.target.value)}
                      className="font-mono text-xs flex-1"
                      onKeyDown={e => e.key === "Enter" && handleSaveJwt()}
                      data-testid="input-sleeper-jwt"
                    />
                    <Button size="sm" onClick={handleSaveJwt} disabled={!jwtInput.trim()} data-testid="button-save-jwt">Save</Button>
                  </div>
                  {sleeperJwt && (
                    <button onClick={handleClearJwt} className="text-[11px] text-red-500 hover:text-red-600 transition-colors" data-testid="button-clear-jwt">
                      Clear saved token
                    </button>
                  )}
                </div>
              )}

              {/* No token state */}
              {!sleeperJwt && !showJwtInput && (
                <p className="text-xs text-muted-foreground" data-testid="text-log-no-token">
                  Set your Sleeper auth token above to see real-time pick history, forced picks, and draft log.
                </p>
              )}

              {/* Error */}
              {messagesError && (
                <div className="flex items-center gap-2 text-xs text-red-500" data-testid="text-messages-error">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{messagesError}</span>
                </div>
              )}

              {/* Pick history */}
              {parsedPicks.length > 0 && (
                <div className="space-y-2" data-testid="section-pick-history">
                  {/* Recent picks header */}
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Recent Picks ({parsedPicks.length} total)
                    </p>
                    {parsedPicks.length > 5 && (
                      <button onClick={() => setShowFullLog(v => !v)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        data-testid="button-toggle-full-log">
                        {showFullLog ? <><ChevronUp className="w-3 h-3" />Less</> : <><ChevronDown className="w-3 h-3" />Full Log</>}
                      </button>
                    )}
                  </div>

                  {/* Pick rows — recent 5 descending, or full log ascending */}
                  <div className="space-y-1" data-testid="list-pick-rows">
                    {(showFullLog
                      ? [...parsedPicks]                              // ascending (already sorted)
                      : [...parsedPicks].reverse().slice(0, 5)        // most recent first
                    ).map(pick => {
                      const posColors: Record<string, string> = {
                        QB: "text-red-600 dark:text-red-400",
                        RB: "text-emerald-600 dark:text-emerald-400",
                        WR: "text-blue-600 dark:text-blue-400",
                        TE: "text-orange-500 dark:text-orange-400",
                      };
                      return (
                        <div key={pick.message_id}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
                            pick.forced
                              ? "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20"
                              : "border-border/30 bg-muted/20"
                          }`}
                          data-testid={`pick-row-${pick.message_id}`}>
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums flex-shrink-0 w-8">
                            {pick.round}.{String(pick.pickInRound).padStart(2, "0")}
                          </span>
                          <span className={`text-[10px] font-bold flex-shrink-0 w-6 ${posColors[pick.position] || "text-muted-foreground"}`}>
                            {pick.position}
                          </span>
                          <span className="font-semibold text-foreground truncate flex-1">{pick.playerName}</span>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">{pick.team}</span>
                          {pick.forced && (
                            <Badge variant="outline" className="text-[9px] px-1 h-4 border-amber-500/50 text-amber-600 dark:text-amber-400 flex-shrink-0">
                              Forced
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state when token is set but no picks yet */}
              {sleeperJwt && !messagesLoading && parsedPicks.length === 0 && !messagesError && (
                <p className="text-xs text-muted-foreground text-center py-3" data-testid="text-no-picks-yet">
                  {draftStarted ? "Draft has started — no picks logged yet." : "Waiting for draft picks…"}
                </p>
              )}

            </CardContent>
          </Card>

        </>
      )}
    </div>
  );
}
