import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, RefreshCw, Trophy, Target } from "lucide-react";
import { useValueModel } from "@/contexts/ValueModelContext";

interface DraftPick {
  round: number;
  pickNo: number;
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

interface DraftResponse {
  draft: DraftInfo | null;
  picks: DraftPick[];
  players: Record<string, { name: string; pos: string; team: string }>;
  error: string | null;
}

const POS_COLORS: Record<string, string> = {
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

  const { valuesBySleeperId, redraftValuesBySleeperId } = useValueModel();

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

  const boardPlayers = useMemo(() => {
    if (!draftData) return [];

    const allPlayers: { id: string; name: string; pos: string; team: string; value: number; picked: boolean; pickInfo?: DraftPick }[] = [];

    const pickMap = new Map<string, DraftPick>();
    for (const pick of draftData.picks) {
      if (pick.playerId) pickMap.set(pick.playerId, pick);
    }

    for (const [id, p] of Object.entries(draftData.players)) {
      const value = valuesBySleeperId[id] || redraftValuesBySleeperId[id] || 0;
      if (value <= 0 && !pickedPlayerIds.has(id)) continue;
      allPlayers.push({
        id,
        name: p.name,
        pos: p.pos,
        team: p.team,
        value,
        picked: pickedPlayerIds.has(id),
        pickInfo: pickMap.get(id),
      });
    }

    for (const pick of draftData.picks) {
      if (pick.playerId && !draftData.players[pick.playerId]) {
        allPlayers.push({
          id: pick.playerId,
          name: pick.playerName,
          pos: pick.pos,
          team: pick.team,
          value: valuesBySleeperId[pick.playerId] || redraftValuesBySleeperId[pick.playerId] || 0,
          picked: true,
          pickInfo: pick,
        });
      }
    }

    allPlayers.sort((a, b) => b.value - a.value);
    return allPlayers;
  }, [draftData, valuesBySleeperId, redraftValuesBySleeperId, pickedPlayerIds]);

  const filteredPlayers = useMemo(() => {
    if (posFilter === "ALL") return boardPlayers;
    return boardPlayers.filter(p => p.pos === posFilter);
  }, [boardPlayers, posFilter]);

  const stats = useMemo(() => {
    const total = boardPlayers.length;
    const picked = boardPlayers.filter(p => p.picked).length;
    return { total, picked, available: total - picked };
  }, [boardPlayers]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (leagueIdInput.trim()) {
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
          Enter a Sleeper league ID to load a draft board sorted by player value. Drafted players will appear faded.
        </p>
      </div>

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

          <div className="flex items-center gap-3 flex-wrap">
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
            <div className="flex items-center gap-4 text-xs text-muted-foreground ml-auto">
              <span data-testid="text-available-count"><span className="font-semibold text-emerald-600 dark:text-emerald-400">{stats.available}</span> available</span>
              <span data-testid="text-picked-count"><span className="font-semibold text-muted-foreground">{stats.picked}</span> drafted</span>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-draft-board">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30">
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-16" data-testid="th-rank">#</th>
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground" data-testid="th-player">Player</th>
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-16" data-testid="th-pos">Pos</th>
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-20" data-testid="th-team">Team</th>
                      <th className="px-4 py-3 text-right font-semibold text-muted-foreground w-24" data-testid="th-value">Value</th>
                      <th className="px-4 py-3 text-center font-semibold text-muted-foreground w-24" data-testid="th-status">Status</th>
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-20" data-testid="th-pick">Pick</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.map((player, idx) => (
                      <tr
                        key={player.id}
                        className={`border-b border-border/20 transition-colors ${
                          player.picked
                            ? "opacity-35"
                            : "hover:bg-muted/20"
                        }`}
                        data-testid={`row-player-${player.id}`}
                      >
                        <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs" data-testid={`text-rank-${player.id}`}>{idx + 1}</td>
                        <td className="px-4 py-2.5" data-testid={`text-name-${player.id}`}>
                          <span className={`font-medium ${player.picked ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {player.name}
                          </span>
                        </td>
                        <td className="px-4 py-2.5" data-testid={`text-pos-${player.id}`}>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${POS_COLORS[player.pos] || ""}`}>
                            {player.pos}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground" data-testid={`text-team-${player.id}`}>{player.team}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold" data-testid={`text-value-${player.id}`}>
                          {player.value.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-center" data-testid={`text-status-${player.id}`}>
                          {player.picked ? (
                            <Badge variant="secondary" className="text-[10px]">Drafted</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                              Available
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono" data-testid={`text-pick-${player.id}`}>
                          {player.pickInfo ? `${player.pickInfo.round}.${String(player.pickInfo.pickNo).padStart(2, "0")}` : "—"}
                        </td>
                      </tr>
                    ))}
                    {filteredPlayers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground" data-testid="text-empty-state">
                          <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />
                          <p>No players to display</p>
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
              Paste a Sleeper league ID above and the draft board will load, showing all players ranked by value.
              Players that have been drafted will be faded out.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}