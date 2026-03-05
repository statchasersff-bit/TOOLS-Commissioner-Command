import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/KpiCard";
import { SectionHeader } from "@/components/SectionHeader";
import { useSleeper } from "@/contexts/SleeperContext";
import { getPositionColor } from "@/data/mockData";
import {
  Link,
  CheckCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Search,
  Users,
  Trophy,
  Calendar,
  Shield,
  Check,
  TrendingUp,
  Target,
  AlertTriangle,
  Crown,
  BarChart3,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";

export function PortfolioConnect() {
  const { isConnected, user, isLoading, error, lastSyncTime, connect, disconnect, refresh } = useSleeper();
  const [username, setUsername] = useState("");

  const handleConnect = async () => {
    if (!username.trim()) return;
    await connect(username.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConnect();
  };

  const formatSyncTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  };

  if (isConnected && user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-8 max-w-md w-full" data-testid="portfolio-connected-card">
          <div className="flex flex-col items-center text-center space-y-5">
            <div className="p-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground" data-testid="text-connected-username">
                {user.displayName || user.username}
              </h3>
              <p className="text-sm text-muted-foreground mt-1" data-testid="text-connected-id">
                @{user.username}
              </p>
            </div>
            {lastSyncTime && (
              <p className="text-xs text-muted-foreground" data-testid="text-last-sync">
                Last synced: {formatSyncTime(lastSyncTime)}
              </p>
            )}
            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => refresh()}
                disabled={isLoading}
                data-testid="button-refresh"
              >
                {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Refresh
              </Button>
              <Button
                variant="outline"
                className="text-destructive border-destructive/30"
                onClick={disconnect}
                data-testid="button-disconnect"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="p-8 max-w-md w-full" data-testid="portfolio-connect-card">
        <div className="flex flex-col items-center text-center space-y-5">
          <div className="p-3.5 rounded-full bg-[#0b3a7a]/10 dark:bg-blue-400/10">
            <Link className="w-8 h-8 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">Connect Your Sleeper Account</h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              Enter your Sleeper username to unlock your dynasty command center
            </p>
          </div>

          <div className="w-full space-y-3">
            <Input
              placeholder="Enter Sleeper username..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              data-testid="input-sleeper-username"
            />
            <Button
              className="w-full bg-[#0b3a7a] hover:bg-[#0b3a7a] text-white border-[#0b3a7a]"
              onClick={handleConnect}
              disabled={isLoading || !username.trim()}
              data-testid="button-connect"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive" data-testid="text-connect-error">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="w-full pt-2 space-y-2.5 text-left">
            {[
              "Read-only access to your leagues",
              "No password required",
              "Disconnect anytime",
            ].map((text) => (
              <div key={text} className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <span className="text-xs text-muted-foreground">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

interface PortfolioMyLeaguesProps {
  onSelectLeague: (leagueId: string) => void;
  onNavigate: (mainTab: string, subTab: string) => void;
}

export function PortfolioMyLeagues({ onSelectLeague, onNavigate }: PortfolioMyLeaguesProps) {
  const { isConnected, leagues, activeLeagueId, setActiveLeague } = useSleeper();
  const [search, setSearch] = useState("");

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-8 max-w-sm w-full text-center" data-testid="leagues-not-connected">
          <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Connect your Sleeper account in the <strong>Connect</strong> tab to view your leagues.
          </p>
        </Card>
      </div>
    );
  }

  const filtered = leagues.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleLeagueClick = (leagueId: string) => {
    setActiveLeague(leagueId);
    onSelectLeague(leagueId);
    onNavigate("dashboard", "overview");
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="My Leagues" subtitle={`${leagues.length} league${leagues.length !== 1 ? "s" : ""} found`} />

      <Input
        placeholder="Search leagues..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
        data-testid="input-search-leagues"
      />

      {filtered.length === 0 ? (
        <Card className="p-8 text-center" data-testid="no-leagues-found">
          <Search className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No leagues match your search.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((league) => {
            const isActive = activeLeagueId === league.leagueId;
            return (
              <Card
                key={league.leagueId}
                className={`p-5 cursor-pointer hover-elevate transition-colors ${
                  isActive ? "ring-2 ring-[#d4af37]" : ""
                }`}
                onClick={() => handleLeagueClick(league.leagueId)}
                data-testid={`card-league-${league.leagueId}`}
              >
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-foreground text-sm truncate" data-testid={`text-league-name-${league.leagueId}`}>
                      {league.name}
                    </h4>
                    <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant={league.format === "SF" ? "default" : "secondary"} data-testid={`badge-format-${league.leagueId}`}>
                      {league.format}
                    </Badge>
                    <Badge variant="outline" data-testid={`badge-scoring-${league.leagueId}`}>
                      {league.scoringFormat}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {league.totalRosters} teams
                    </span>
                    <span>{league.season}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

type RecordSortKey = "leagueName" | "format" | "wins" | "standing" | "valueRank" | "maxPfRank" | "playoffOdds";

function PortfolioSortHeader({ label, sortKey, activeSortKey, sortDir, onSort }: {
  label: string; sortKey: RecordSortKey; activeSortKey: RecordSortKey; sortDir: "asc" | "desc";
  onSort: (key: RecordSortKey) => void;
}) {
  const isActive = activeSortKey === sortKey;
  return (
    <th
      className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(sortKey)}
      data-testid={`sort-record-${sortKey}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

function SortableLeagueRecords({ records }: { records: any[] }) {
  const [sortKey, setSortKey] = useState<RecordSortKey>("leagueName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showAll, setShowAll] = useState(false);

  function handleSort(key: RecordSortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "leagueName" || key === "format" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const accessor: Record<RecordSortKey, (r: any) => number | string> = {
      leagueName: r => r.leagueName.toLowerCase(),
      format: r => r.format,
      wins: r => r.wins - r.losses,
      standing: r => r.standing,
      valueRank: r => r.valueRank || 999,
      maxPfRank: r => r.maxPfRank || 999,
      playoffOdds: r => r.playoffOdds,
    };
    return [...records].sort((a, b) => {
      const va = accessor[sortKey](a);
      const vb = accessor[sortKey](b);
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [records, sortKey, sortDir]);

  return (
    <div className="overflow-x-auto rounded-md border border-border/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <PortfolioSortHeader label="League" sortKey="leagueName" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <PortfolioSortHeader label="Format" sortKey="format" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <PortfolioSortHeader label="Record" sortKey="wins" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <PortfolioSortHeader label="Standing" sortKey="standing" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <PortfolioSortHeader label="Value Rank" sortKey="valueRank" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <PortfolioSortHeader label="Max PF Rank" sortKey="maxPfRank" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <PortfolioSortHeader label="Playoff Odds" sortKey="playoffOdds" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          </tr>
        </thead>
        <tbody>
          {(showAll ? sorted : sorted.slice(0, 10)).map((rec: any, idx: number) => (
            <tr key={`${rec.leagueId}-${idx}`} className="border-b border-border/20 hover:bg-muted/10" data-testid={`league-record-${rec.leagueId}`}>
              <td className="px-4 py-2.5 font-medium">{rec.leagueName}</td>
              <td className="px-4 py-2.5">
                <Badge variant="outline" className="text-[10px]">{rec.format}</Badge>
              </td>
              <td className="px-4 py-2.5 font-semibold">{rec.wins}-{rec.losses}{rec.ties > 0 ? `-${rec.ties}` : ""}</td>
              <td className="px-4 py-2.5">
                <span className={`font-semibold ${rec.standing <= 3 ? "text-emerald-600 dark:text-emerald-400" : rec.standing <= Math.ceil(rec.totalRosters * 0.7) ? "text-foreground" : "text-red-500 dark:text-red-400"}`}>
                  #{rec.standing}
                </span>
                <span className="text-muted-foreground"> / {rec.totalRosters}</span>
              </td>
              <td className="px-4 py-2.5">
                {rec.valueRank > 0 ? (
                  <>
                    <span className={`font-semibold ${rec.valueRank <= 3 ? "text-emerald-600 dark:text-emerald-400" : rec.valueRank <= Math.ceil(rec.totalRosters * 0.7) ? "text-foreground" : "text-red-500 dark:text-red-400"}`}>
                      #{rec.valueRank}
                    </span>
                    <span className="text-muted-foreground"> / {rec.totalRosters}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground text-xs">N/A</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                {rec.maxPfRank > 0 ? (
                  <>
                    <span className={`font-semibold ${rec.maxPfRank <= 3 ? "text-emerald-600 dark:text-emerald-400" : rec.maxPfRank <= Math.ceil(rec.totalRosters * 0.7) ? "text-foreground" : "text-red-500 dark:text-red-400"}`}>
                      #{rec.maxPfRank}
                    </span>
                    <span className="text-muted-foreground"> / {rec.totalRosters}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground text-xs">N/A</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <span className={`font-semibold ${rec.playoffOdds >= 60 ? "text-emerald-600 dark:text-emerald-400" : rec.playoffOdds >= 30 ? "text-foreground" : "text-red-500 dark:text-red-400"}`}>
                  {rec.playoffOdds}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > 10 && (
        <button
          onClick={() => setShowAll(prev => !prev)}
          className="w-full py-2.5 text-xs font-semibold text-[#0b3a7a] dark:text-blue-400 hover:bg-muted/20 transition-colors border-t border-border/40"
          data-testid="button-toggle-leagues"
        >
          {showAll ? "Show Less" : `Show All ${sorted.length} Leagues`}
        </button>
      )}
    </div>
  );
}

export function PortfolioSummary() {
  const { isConnected, user, leagues } = useSleeper();

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ["/api/sleeper/user", user?.userId, "portfolio-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/sleeper/user/${user!.userId}/portfolio-summary`);
      if (!res.ok) throw new Error("Failed to fetch portfolio summary");
      return res.json();
    },
    enabled: isConnected && !!user?.userId && leagues.length > 0,
  });

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-8 max-w-sm w-full text-center" data-testid="summary-not-connected">
          <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Connect your Sleeper account in the <strong>Connect</strong> tab to view your portfolio summary.
          </p>
        </Card>
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-8 max-w-sm w-full text-center" data-testid="summary-no-leagues">
          <Search className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No leagues found for your account.</p>
        </Card>
      </div>
    );
  }

  const sfCount = leagues.filter((l) => l.format === "SF").length;
  const oneQbCount = leagues.filter((l) => l.format === "1QB").length;
  const seasons = Array.from(new Set(leagues.map((l) => l.season)));

  return (
    <div className="space-y-8">
      <SectionHeader title="Portfolio Summary" subtitle="Overview of your dynasty portfolio across all leagues" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Leagues" value={leagues.length} icon={Trophy} />
        <KpiCard label="SF Leagues" value={sfCount} icon={Shield} subtitle={`${oneQbCount} 1QB`} />
        <KpiCard
          label="Win Rate"
          value={summaryLoading ? "..." : summaryData ? `${summaryData.winRate}%` : "--"}
          icon={TrendingUp}
          subtitle={summaryData ? `${summaryData.totalWins}W - ${summaryData.totalLosses}L` : undefined}
          loading={summaryLoading}
        />
        <KpiCard
          label="Avg Rank"
          value={summaryLoading ? "..." : summaryData ? summaryData.avgRank : "--"}
          icon={BarChart3}
          subtitle={summaryData ? `${summaryData.playoffTeams} playoff teams` : undefined}
          loading={summaryLoading}
        />
      </div>

      {summaryLoading && (
        <Card className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#0b3a7a] mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Analyzing your portfolio across {leagues.length} leagues...</p>
        </Card>
      )}

      {summaryData && (
        <>
          <Card className="p-6" data-testid="portfolio-performance">
            <div className="mb-5">
              <h3 className="text-base font-bold text-foreground">Portfolio Performance</h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-3 rounded-lg bg-muted/30 border border-border/40">
                <p className="text-2xl font-bold text-foreground">{summaryData.totalWins}-{summaryData.totalLosses}{summaryData.totalTies > 0 ? `-${summaryData.totalTies}` : ""}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Total Record</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30 border border-border/40">
                <p className="text-2xl font-bold text-foreground">{summaryData.winRate}%</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Win Rate</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30 border border-border/40">
                <p className="text-2xl font-bold text-foreground">{summaryData.avgRank}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Avg League Rank</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30 border border-border/40">
                <p className="text-2xl font-bold text-foreground">{summaryData.playoffTeams} / {leagues.length}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Playoff Teams</p>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/50 dark:border-emerald-800/30">
                <Crown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Contenders (Top 3): {summaryData.contenderCount}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-800/30">
                <BarChart3 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Middle: {summaryData.middleCount}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/30">
                <Target className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                <span className="text-xs font-semibold text-red-700 dark:text-red-400">Rebuilding: {summaryData.rebuildCount}</span>
              </div>
            </div>

            {summaryData.leagueRecords.length > 0 && (
              <SortableLeagueRecords records={summaryData.leagueRecords} />
            )}
          </Card>

          <Card className="p-6" data-testid="player-exposure">
            <div className="mb-5">
              <h3 className="text-base font-bold text-foreground">Top Rostered Players</h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            </div>
            <p className="text-xs text-muted-foreground mb-4">Player exposure across your {leagues.length} dynasty leagues</p>

            {summaryData.playerExposure.length > 0 ? (
              <div className="space-y-2">
                {summaryData.playerExposure.slice(0, 15).map((player: any) => {
                  const isOverexposed = player.exposure >= 50;
                  return (
                    <div key={player.playerId} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0" data-testid={`exposure-${player.playerId}`}>
                      <div className="flex items-center gap-2.5">
                        <Badge variant="outline" className={`text-xs w-8 justify-center ${getPositionColor(player.pos)}`}>{player.pos}</Badge>
                        <div>
                          <span className="text-sm font-semibold">{player.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">{player.team}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isOverexposed ? "bg-amber-500" : "bg-[#0b3a7a] dark:bg-blue-500"}`}
                              style={{ width: `${player.exposure}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold w-10 text-right">{player.exposure}%</span>
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">{player.leagueCount} league{player.leagueCount !== 1 ? "s" : ""}</span>
                        {isOverexposed && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No player data available.</p>
            )}

            {summaryData.playerExposure.filter((p: any) => p.exposure >= 50).length > 0 && (
              <div className="mt-4 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">Overexposure Warning</span>
                </div>
                <div className="space-y-0.5">
                  {summaryData.playerExposure.filter((p: any) => p.exposure >= 50).map((p: any) => (
                    <p key={p.playerId} className="text-xs text-amber-700 dark:text-amber-400">
                      {p.name} — {p.exposure}% exposure across your portfolio
                    </p>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {summaryData.lineupAlerts.length > 0 && (
            <Card className="p-6 border-amber-200/50 dark:border-amber-800/30" data-testid="lineup-alerts">
              <div className="mb-5">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-foreground">Lineup Alerts</h3>
                  <Badge className="bg-amber-500 text-white text-[10px] px-1.5">
                    {summaryData.lineupAlerts.reduce((sum: number, la: any) => sum + la.issues.length, 0)} issues
                  </Badge>
                </div>
                <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                {summaryData.lineupAlerts.length} league{summaryData.lineupAlerts.length !== 1 ? "s" : ""} need attention
              </p>

              <div className="overflow-x-auto rounded-md border border-border/40">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">League</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Issue</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryData.lineupAlerts.flatMap((la: any) =>
                      la.issues.map((issue: any, i: number) => (
                        <tr key={`${la.leagueId}-${i}`} className="border-b border-border/20 hover:bg-muted/10">
                          <td className="px-4 py-2.5 font-medium">{i === 0 ? la.leagueName : ""}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant="outline" className={`text-[10px] ${
                              issue.reason === "OUT" || issue.reason === "IR" ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800" :
                              issue.reason === "Empty" ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800" :
                              "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800"
                            }`}>
                              {issue.slot}: {issue.reason}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{issue.playerName || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {!summaryData && !summaryLoading && (
        <Card className="p-6" data-testid="portfolio-overview-text">
          <div className="mb-4">
            <h3 className="text-base font-bold text-foreground">Portfolio Overview</h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You are managing <strong className="text-foreground">{leagues.length}</strong> dynasty league{leagues.length !== 1 ? "s" : ""} across{" "}
            {seasons.length} season{seasons.length !== 1 ? "s" : ""}. Your portfolio includes{" "}
            <strong className="text-foreground">{sfCount}</strong> Superflex and{" "}
            <strong className="text-foreground">{oneQbCount}</strong> 1QB format league{oneQbCount !== 1 ? "s" : ""}.
            Select a league from the <strong>My Leagues</strong> tab to dive into detailed analysis.
          </p>
        </Card>
      )}
    </div>
  );
}