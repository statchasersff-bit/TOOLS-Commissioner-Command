import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/KpiCard";
import { SectionHeader } from "@/components/SectionHeader";
import { useSleeper } from "@/contexts/SleeperContext";
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

export function PortfolioSummary() {
  const { isConnected, leagues } = useSleeper();

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
    <div className="space-y-6">
      <SectionHeader title="Portfolio Summary" subtitle="Overview of your dynasty portfolio across all leagues" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total Leagues"
          value={leagues.length}
          icon={Trophy}
          data-testid="kpi-total-leagues"
        />
        <KpiCard
          label="SF Leagues"
          value={sfCount}
          icon={Shield}
          subtitle={`${oneQbCount} 1QB`}
          data-testid="kpi-sf-leagues"
        />
        <KpiCard
          label="1QB Leagues"
          value={oneQbCount}
          icon={Users}
          subtitle={`${sfCount} SF`}
          data-testid="kpi-1qb-leagues"
        />
        <KpiCard
          label="Seasons"
          value={seasons.join(", ")}
          icon={Calendar}
          data-testid="kpi-seasons"
        />
      </div>

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
    </div>
  );
}