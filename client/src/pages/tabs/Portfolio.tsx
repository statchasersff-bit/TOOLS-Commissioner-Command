import { useState, useMemo, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/KpiCard";
import { SectionHeader } from "@/components/SectionHeader";
import { useSleeper } from "@/contexts/SleeperContext";
import { cn } from "@/lib/utils";
import { SleeperAuthCard } from "@/components/SleeperAuthCard";
import type { MultiLeagueRow } from "@/lib/commissionerActivityApi";
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
  Layers,
  Activity,
  ShieldAlert,
  Inbox,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ArrowRightLeft,
  Info,
  type LucideIcon,
} from "lucide-react";

export function PortfolioConnect({ onNavigate }: { onNavigate?: (mainTab: string, subTab: string) => void }) {
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
        <div className="max-w-md w-full space-y-4">
          <Card className="p-8" data-testid="portfolio-connected-card">
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
              {onNavigate && (
                <div className="w-full grid grid-cols-2 gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex flex-col items-center gap-2 border-[#0b3a7a]/30 dark:border-blue-400/30 hover:bg-[#0b3a7a]/5 dark:hover:bg-blue-400/10"
                    onClick={() => onNavigate("league-analyzer", "power-rankings")}
                    data-testid="button-go-power-rankings"
                  >
                    <Trophy className="w-5 h-5 text-[#0b3a7a] dark:text-blue-400" />
                    <span className="text-xs font-bold">Power Rankings</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex flex-col items-center gap-2 border-[#d4af37]/40 hover:bg-[#d4af37]/5"
                    onClick={() => onNavigate("trade-center", "trade-calculator")}
                    data-testid="button-go-trade-center"
                  >
                    <ArrowRightLeft className="w-5 h-5 text-[#d4af37]" />
                    <span className="text-xs font-bold">Trade Center</span>
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => refresh()}
                  disabled={isLoading}
                  data-testid="button-refresh"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Sync My Leagues
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

          {/* Sleeper Auth — token-based connection for write operations */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-0.5">
              Sleeper Actions (write access)
            </p>
            <SleeperAuthCard />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md w-full space-y-4">
        <Card className="p-8" data-testid="portfolio-connect-card">
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

        {/* Sleeper Auth — also available before public API connection */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-0.5">
            Sleeper Actions (write access)
          </p>
          <SleeperAuthCard />
        </div>
      </div>
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
  const [sortMode, setSortMode] = useState<"sleeper" | "az">("sleeper");

  const filtered = useMemo(() => {
    const base = leagues
      .map((l, i) => ({ ...l, _sleeperIdx: i }))
      .filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));
    if (sortMode === "az") {
      return [...base].sort((a, b) => a.name.localeCompare(b.name));
    }
    return base;
  }, [leagues, search, sortMode]);

  const handleLeagueClick = (leagueId: string) => {
    setActiveLeague(leagueId);
    onSelectLeague(leagueId);
    onNavigate("league-analyzer", "power-rankings");
  };

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

  return (
    <div className="space-y-4">
      <SectionHeader title="My Leagues" subtitle={`${leagues.length} league${leagues.length !== 1 ? "s" : ""} found`} />

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search leagues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
          data-testid="input-search-leagues"
        />
        <div className="flex items-center border border-border rounded-md overflow-hidden shrink-0" data-testid="toggle-league-sort">
          <button
            className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              sortMode === "sleeper" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"
            }`}
            onClick={() => setSortMode("sleeper")}
            data-testid="button-sort-sleeper"
          >
            Sleeper Order
          </button>
          <button
            className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              sortMode === "az" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"
            }`}
            onClick={() => setSortMode("az")}
            data-testid="button-sort-az"
          >
            A → Z
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center" data-testid="no-leagues-found">
          <Search className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No leagues match your search.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map((league) => {
            const isActive = activeLeagueId === league.leagueId;
            return (
              <Card
                key={league.leagueId}
                className={`px-4 py-3 cursor-pointer hover-elevate transition-colors ${
                  isActive ? "ring-2 ring-[#d4af37]" : ""
                }`}
                onClick={() => handleLeagueClick(league.leagueId)}
                data-testid={`card-league-${league.leagueId}`}
              >
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-foreground text-sm truncate leading-tight" data-testid={`text-league-name-${league.leagueId}`}>
                      {league.name}
                    </h4>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <Badge variant={league.format === "SF" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 h-4" data-testid={`badge-format-${league.leagueId}`}>
                        {league.format}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4" data-testid={`badge-scoring-${league.leagueId}`}>
                        {league.scoringFormat}
                      </Badge>
                      {league.isBestBall && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 border-sky-300 dark:border-sky-700" data-testid={`badge-bestball-${league.leagueId}`}>
                          Best Ball
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {league.totalRosters}t · {league.season}
                      </span>
                    </div>
                  </div>
                  {isActive && (
                    <Check className="w-4 h-4 text-[#d4af37] shrink-0" data-testid={`icon-active-${league.leagueId}`} />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

type RecordSortKey = "leagueName" | "totalRosters" | "activityScore" | "rosterHealth" | "pendingTrades" | "alerts";

const LEAGUE_TYPE_LABEL: Record<string, string> = {
  dynasty: "Dynasty",
  keeper: "Keeper",
  redraft: "Redraft",
};

function PortfolioSortHeader({ label, sortKey, activeSortKey, sortDir, onSort, align = "center" }: {
  label: string; sortKey: RecordSortKey; activeSortKey: RecordSortKey; sortDir: "asc" | "desc";
  onSort: (key: RecordSortKey) => void; align?: "left" | "center";
}) {
  const isActive = activeSortKey === sortKey;
  return (
    <th
      className={`px-2 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap ${align === "center" ? "text-center" : "text-left"}`}
      onClick={() => onSort(sortKey)}
      data-testid={`sort-record-${sortKey}`}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "center" ? "justify-center" : ""}`}>
        {label}
        {isActive ? (
          sortDir === "asc" ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />
        ) : (
          <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />
        )}
      </span>
    </th>
  );
}

interface LeagueBreakdownData {
  /** Incoming trades awaiting the user's response, keyed by leagueId. */
  pendingTradesByLeague: Record<string, number>;
  pendingTradesLoading: boolean;
  /** League Activity Score (0–100) per league; null = scanned, no data. */
  activityByLeague: Record<string, number | null>;
  activityLoading: boolean;
  /** Total transactions per league; null = scanned, no data. */
  txnsByLeague: Record<string, number | null>;
  /** Per-league commissioner-activity rows (empty slots, alerts, etc.). */
  leagueRowsById: Record<string, MultiLeagueRow>;
  /** Open a league — sets it active and navigates to its detail view. */
  onViewLeague: (leagueId: string) => void;
}

function SortableLeagueRecords({
  records,
  pendingTradesByLeague,
  pendingTradesLoading,
  activityByLeague,
  activityLoading,
  leagueRowsById,
  onViewLeague,
}: { records: any[] } & LeagueBreakdownData) {
  const [sortKey, setSortKey] = useState<RecordSortKey>("activityScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showAll, setShowAll] = useState(false);

  function handleSort(key: RecordSortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "leagueName" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const accessor: Record<RecordSortKey, (r: any) => number | string> = {
      leagueName: r => (r.leagueName || "").toLowerCase(),
      totalRosters: r => r.totalRosters || 0,
      pendingTrades: r => pendingTradesByLeague[r.leagueId] ?? -1,
      // Unscored leagues sort below scored ones in both directions.
      activityScore: r => activityByLeague[r.leagueId] ?? -1,
      rosterHealth: r => leagueRowsById[r.leagueId]?.totalEmptyStarterSlots ?? -1,
      alerts: r => leagueRowsById[r.leagueId]?.openAlerts ?? -1,
    };
    return [...records].sort((a, b) => {
      const va = accessor[sortKey](a);
      const vb = accessor[sortKey](b);
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [records, sortKey, sortDir, pendingTradesByLeague, activityByLeague, leagueRowsById]);

  const visible = showAll ? sorted : sorted.slice(0, 10);

  // Pending trades → "Trade Queue" label: "Clear" when none, "N pending" otherwise.
  const pendingCell = (leagueId: string) => {
    const count = pendingTradesByLeague[leagueId];
    if (count == null) {
      return pendingTradesLoading
        ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground inline" />
        : <span className="text-muted-foreground text-[11px]">—</span>;
    }
    if (count === 0) return <span className="text-muted-foreground">Clear</span>;
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
        {count} pending
      </span>
    );
  };

  const typeBadge = (rec: any) => (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground whitespace-nowrap">
      {LEAGUE_TYPE_LABEL[rec.leagueType] ?? "—"}
    </span>
  );

  // Activity score → "High / Moderate / Low" label.
  const activityCell = (leagueId: string) => {
    const score = activityByLeague[leagueId];
    if (score == null && activityLoading) return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground inline" />;
    const l = activityLabel(score);
    return <span className={`font-semibold ${l.cls}`}>{l.text}</span>;
  };

  // Empty starter slots → "Healthy / N open" roster-health label.
  const rosterHealthCell = (leagueId: string) => {
    const slots = leagueRowsById[leagueId]?.totalEmptyStarterSlots;
    if (slots == null && activityLoading) return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground inline" />;
    const l = rosterHealthLabel(slots);
    return <span className={`font-semibold ${l.cls}`}>{l.text}</span>;
  };

  // Open alerts → "None / N" label.
  const alertsCell = (leagueId: string) => {
    const open = leagueRowsById[leagueId]?.openAlerts;
    if (open == null && activityLoading) return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground inline" />;
    const l = alertsLabel(open);
    return <span className={l.cls}>{l.text}</span>;
  };

  const viewButton = (leagueId: string) => (
    <button
      onClick={() => onViewLeague(leagueId)}
      className="text-xs font-semibold text-[#d4af37] hover:underline whitespace-nowrap"
      data-testid={`button-view-league-${leagueId}`}
    >
      View →
    </button>
  );

  return (
    <div className="rounded-md border border-border/40 overflow-hidden">
      {/* ── Mobile list (cards, no horizontal scroll) ── */}
      <div className="md:hidden divide-y divide-border/20">
        {visible.map((rec: any, idx: number) => (
          <MobileLeagueRow
            key={`m-${rec.leagueId}-${idx}`}
            rec={rec}
            pendingCell={pendingCell}
            typeBadge={typeBadge}
            activityCell={activityCell}
            rosterHealthCell={rosterHealthCell}
            alertsCell={alertsCell}
            viewButton={viewButton}
          />
        ))}
      </div>

      {/* ── Desktop table (md+) ── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <PortfolioSortHeader label="League" sortKey="leagueName" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
              <PortfolioSortHeader label="Teams" sortKey="totalRosters" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <PortfolioSortHeader label="Activity" sortKey="activityScore" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <PortfolioSortHeader label="Roster Health" sortKey="rosterHealth" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <PortfolioSortHeader label="Trade Queue" sortKey="pendingTrades" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <PortfolioSortHeader label="Alerts" sortKey="alerts" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((rec: any, idx: number) => (
              <tr key={`${rec.leagueId}-${idx}`} className="border-b border-border/20 hover:bg-muted/10" data-testid={`league-record-${rec.leagueId}`}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {rec.avatar ? (
                      <img src={rec.avatar} alt="" className="w-9 h-9 rounded-full flex-shrink-0 object-cover bg-muted ring-1 ring-border/40" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex-shrink-0 bg-[#0b3a7a]/20 dark:bg-blue-900/40 flex items-center justify-center ring-1 ring-border/40">
                        <span className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 uppercase">{rec.leagueName?.[0] ?? "?"}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-foreground break-words line-clamp-2" title={rec.leagueName}>{rec.leagueName}</div>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground">{rec.scoringFormat === "Half" ? "Half-PPR" : rec.scoringFormat}</span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground">{rec.format}</span>
                        {rec.isBestBall && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400">Best Ball</span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-center font-semibold tabular-nums" data-testid={`text-teams-${rec.leagueId}`}>{rec.totalRosters}</td>
                <td className="px-2 py-2 text-center" data-testid={`text-activity-${rec.leagueId}`}>{activityCell(rec.leagueId)}</td>
                <td className="px-2 py-2 text-center" data-testid={`text-roster-health-${rec.leagueId}`}>{rosterHealthCell(rec.leagueId)}</td>
                <td className="px-2 py-2 text-center" data-testid={`text-pending-trades-${rec.leagueId}`}>{pendingCell(rec.leagueId)}</td>
                <td className="px-2 py-2 text-center" data-testid={`text-alerts-${rec.leagueId}`}>{alertsCell(rec.leagueId)}</td>
                <td className="px-3 py-2 text-right">{viewButton(rec.leagueId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Shared "Show all" toggle — drives both mobile list and desktop table. */}
      {sorted.length > 10 && (
        <button
          onClick={() => setShowAll(prev => !prev)}
          className="w-full py-2.5 text-xs font-semibold text-[#0b3a7a] dark-any:text-white hover:bg-muted/20 transition-colors border-t border-border/40"
          data-testid="button-toggle-leagues"
        >
          {showAll ? "Show Less" : `Show All ${sorted.length} Leagues`}
        </button>
      )}
    </div>
  );
}

// ── Mobile league-record card ────────────────────────────────────────────────
//   [Avatar] League Name (≤2 lines)
//            Dynasty · 12 Teams
//            Activity High · Roster Healthy · Trades Clear · Alerts None
function MobileLeagueRow({ rec, pendingCell, typeBadge, activityCell, rosterHealthCell, alertsCell, viewButton }: {
  rec: any;
  pendingCell: (leagueId: string) => JSX.Element;
  typeBadge: (rec: any) => JSX.Element;
  activityCell: (leagueId: string) => JSX.Element;
  rosterHealthCell: (leagueId: string) => JSX.Element;
  alertsCell: (leagueId: string) => JSX.Element;
  viewButton: (leagueId: string) => JSX.Element;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-3 hover:bg-muted/10 transition-colors" data-testid={`league-record-mobile-${rec.leagueId}`}>
      {rec.avatar ? (
        <img src={rec.avatar} alt="" className="w-9 h-9 rounded-full flex-shrink-0 object-cover bg-muted ring-1 ring-border/40 mt-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div className="w-9 h-9 rounded-full flex-shrink-0 bg-[#0b3a7a]/20 dark:bg-blue-900/40 flex items-center justify-center ring-1 ring-border/40 mt-0.5">
          <span className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 uppercase">{rec.leagueName?.[0] ?? "?"}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[13px] leading-tight line-clamp-2 break-words text-foreground" title={rec.leagueName}>
          {rec.leagueName}
        </div>
        <div className="flex items-center gap-1.5 mt-1 min-w-0">
          {typeBadge(rec)}
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{rec.totalRosters} Teams</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Activity</span>
            {activityCell(rec.leagueId)}
          </span>
          <span className="text-border/60">·</span>
          <span className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Roster</span>
            {rosterHealthCell(rec.leagueId)}
          </span>
          <span className="text-border/60">·</span>
          <span className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Trades</span>
            {pendingCell(rec.leagueId)}
          </span>
          <span className="text-border/60">·</span>
          <span className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Alerts</span>
            {alertsCell(rec.leagueId)}
          </span>
        </div>
      </div>
      <div className="flex-shrink-0 self-center pl-1">{viewButton(rec.leagueId)}</div>
    </div>
  );
}

// ── Commissioner Action Center tile ──────────────────────────────────────────
// An actionable status card: a count + a CTA that deep-links to the tool that
// resolves it. Highlights amber when the count is non-zero (something to do).
function ActionTile({ icon: Icon, label, count, cta, onClick, loading }: {
  icon: LucideIcon;
  label: string;
  count: number | null;
  cta: string;
  onClick?: () => void;
  loading?: boolean;
}) {
  const active = (count ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "group text-left rounded-lg border p-3.5 transition-colors w-full",
        active
          ? "border-amber-500/40 bg-amber-500/[0.06] hover:bg-amber-500/10"
          : "border-border/50 bg-card/40 hover:bg-muted/20",
        !onClick && "cursor-default",
      )}
      data-testid={`action-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-2">
        <div className={cn(
          "w-7 h-7 rounded-md flex items-center justify-center ring-1 flex-shrink-0",
          active ? "bg-amber-500/15 ring-amber-500/30" : "bg-muted/50 ring-border/40",
        )}>
          <Icon className={cn("w-3.5 h-3.5", active ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{label}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className={cn(
          "text-2xl font-bold leading-none tabular-nums",
          active ? "text-amber-600 dark:text-amber-400" : "text-foreground",
        )}>
          {loading ? "…" : count ?? "—"}
        </span>
        {onClick && (
          <span className="text-[11px] font-semibold text-[#d4af37] group-hover:underline whitespace-nowrap">{cta} →</span>
        )}
      </div>
    </button>
  );
}

// ── Label helpers for the League Command Center table ────────────────────────
// Convert raw commissioner-activity numbers into plain-language labels so the
// table reads as status, not unexplained scores.
function activityLabel(score: number | null | undefined): { text: string; cls: string } {
  if (score == null) return { text: "—", cls: "text-muted-foreground" };
  if (score >= 70) return { text: "High", cls: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 40) return { text: "Moderate", cls: "text-foreground" };
  return { text: "Low", cls: "text-red-500 dark:text-red-400" };
}

function rosterHealthLabel(emptySlots: number | null | undefined): { text: string; cls: string } {
  if (emptySlots == null) return { text: "—", cls: "text-muted-foreground" };
  if (emptySlots === 0) return { text: "Healthy", cls: "text-emerald-600 dark:text-emerald-400" };
  return { text: `${emptySlots} open`, cls: "text-amber-600 dark:text-amber-400" };
}

function alertsLabel(openAlerts: number | null | undefined): { text: string; cls: string } {
  if (openAlerts == null) return { text: "—", cls: "text-muted-foreground" };
  if (openAlerts === 0) return { text: "None", cls: "text-muted-foreground" };
  return { text: String(openAlerts), cls: "text-red-500 dark:text-red-400 font-semibold" };
}

export function PortfolioSummary({ onNavigate, onOpenLeagueProfile }: { onNavigate?: (mainTab: string, subTab: string) => void; onOpenLeagueProfile?: (leagueId: string) => void } = {}) {
  const { isConnected, user, leagues, setActiveLeague } = useSleeper();

  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [pendingTradeCount, setPendingTradeCount] = useState<number | null>(null);
  const [pendingTradeLoading, setPendingTradeLoading] = useState(false);
  // Per-league breakdown data for the League Breakdown table.
  const [pendingTradesByLeague, setPendingTradesByLeague] = useState<Record<string, number>>({});
  const [activityByLeague, setActivityByLeague] = useState<Record<string, number | null>>({});
  const [txnsByLeague, setTxnsByLeague] = useState<Record<string, number | null>>({});
  const [activityLoading, setActivityLoading] = useState(false);
  // Aggregate commissioner-activity KPIs across the leagues the user commissions
  // (moved here from the All Leagues tab). Null until the first scan resolves.
  const [activityKpis, setActivityKpis] = useState<{
    leagues: number; scanned: number; healthy: number;
    lowActivity: number; atRiskManagers: number; openAlerts: number; emptySlots: number;
  } | null>(null);
  // Per-league commissioner-activity rows, keyed by leagueId — powers the
  // labeled League Command Center table and the "needs attention" rollup.
  const [leagueRowsById, setLeagueRowsById] = useState<Record<string, MultiLeagueRow>>({});

  // Open a league from the League Breakdown table — set it active, then open its
  // League Profile (falls back to League Activity if no profile handler given).
  const handleViewLeague = useCallback((leagueId: string) => {
    setActiveLeague(leagueId);
    if (onOpenLeagueProfile) onOpenLeagueProfile(leagueId);
    else onNavigate?.("league-analyzer", "league-activity");
  }, [setActiveLeague, onNavigate, onOpenLeagueProfile]);
  // Live startup drafts the user is in. Fresh startup leagues don't make it
  // into useSleeper().leagues (their roster has no players yet, so
  // fetchSleeperLeagues filters them out) — but the user still wants them
  // visible in Portfolio so the live startup draft is one click away.
  const [liveStartupDrafts, setLiveStartupDrafts] = useState<Array<{
    leagueId: string;
    leagueName: string;
    leagueAvatar: string | null;
    draftId: string;
    status: string;
    season: string;
    rounds: number;
    teams: number;
    picksMade: number;
    totalPicks: number;
    startTime: number | null;
    mySlot: number | null;
    picksAway: number | null;
  }>>([]);
  const [liveStartupDraftsLoading, setLiveStartupDraftsLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !user?.userId) {
      setLiveStartupDrafts([]);
      return;
    }
    let cancelled = false;
    setLiveStartupDraftsLoading(true);
    import("@/lib/sleeperApi").then(({ detectLiveDrafts }) => detectLiveDrafts(user.userId))
      .then((all) => {
        if (cancelled) return;
        // Restrict to actually-in-progress startups (drafting / paused).
        // Sleeper's /user/:id/leagues endpoint also surfaces pre_draft
        // leagues from its public league browser / marketplace that the
        // user merely showed interest in — those have a roster slot but
        // the user isn't truly drafting, so they'd appear here as noise.
        // Once a draft enters "drafting" only real participants remain.
        const startups = (all || []).filter((d: any) =>
          d.draftCategory === "startup" &&
          (d.status === "drafting" || d.status === "paused")
        );
        setLiveStartupDrafts(startups);
        setLiveStartupDraftsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLiveStartupDraftsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isConnected, user?.userId]);

  useEffect(() => {
    if (!isConnected || !user?.userId || leagues.length === 0) return;
    let cancelled = false;
    setSummaryLoading(true);
    import("@/lib/sleeperApi").then(({ fetchPortfolioSummary }) =>
      fetchPortfolioSummary(user!.userId, leagues)
    ).then((data) => {
      if (!cancelled) {
        setSummaryData(data);
        setSummaryLoading(false);
      }
    }).catch((err) => {
      console.error("Portfolio summary error:", err);
      if (!cancelled) setSummaryLoading(false);
    });
    return () => { cancelled = true; };
  }, [isConnected, user?.userId, leagues]);

  useEffect(() => {
    if (!isConnected || !user?.userId || leagues.length === 0) return;
    let cancelled = false;
    setPendingTradeLoading(true);
    const userId = user.userId;
    const eligible = leagues;

    import("@/services/sleeperAuthedApi").then(({ fetchLeagueTransactionsFiltered }) =>
      Promise.allSettled(
        eligible.map(async (l) => {
          // Fetch rosters and transactions in parallel per league
          const [rosters, txns] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${l.leagueId}/rosters`).then(r => r.json()),
            fetchLeagueTransactionsFiltered(l.leagueId, ["trade"], [], []),
          ]);
          const userRoster = (rosters as any[]).find((r: any) => r.owner_id === userId);
          if (!userRoster) return { leagueId: l.leagueId, count: 0 };
          const userRosterId: number = userRoster.roster_id;
          // Mirror TradeSync's "incoming" definition exactly:
          // proposed + user is a party + user didn't create it + user hasn't consented yet
          const count = (txns as any[]).filter((t: any) =>
            t.status === "proposed" &&
            Array.isArray(t.roster_ids) && t.roster_ids.includes(userRosterId) &&
            t.creator !== userId &&
            !(t.consenter_ids ?? []).includes(userRosterId)
          ).length;
          return { leagueId: l.leagueId, count };
        })
      )
    ).then((results) => {
      if (cancelled) return;
      let total = 0;
      const byLeague: Record<string, number> = {};
      for (const r of results) {
        if (r.status === "fulfilled") {
          byLeague[r.value.leagueId] = r.value.count;
          total += r.value.count;
        }
      }
      setPendingTradesByLeague(byLeague);
      setPendingTradeCount(total);
      setPendingTradeLoading(false);
    }).catch(() => {
      if (!cancelled) { setPendingTradeCount(null); setPendingTradesByLeague({}); setPendingTradeLoading(false); }
    });
    return () => { cancelled = true; };
  }, [isConnected, user?.userId, leagues]);

  // League Activity Score per league. Scores live in the Commissioner Activity
  // backend and only exist once a league has been scanned. We only scan leagues
  // the user actually COMMISSIONS — Sleeper's /league/:id/users marks the
  // commissioner with is_owner — then read the scores back via multi-overview.
  // Leagues the user doesn't commission stay null and render as "—".
  useEffect(() => {
    if (!isConnected || !user?.userId || leagues.length === 0) {
      setActivityByLeague({});
      setTxnsByLeague({});
      setActivityKpis(null);
      setLeagueRowsById({});
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    const userId = user.userId;

    (async () => {
      // Determine which leagues the user commissions (is_owner === true).
      const ownership = await Promise.allSettled(
        leagues.map(async (l) => {
          const users = await fetch(
            `https://api.sleeper.app/v1/league/${l.leagueId}/users`
          ).then((r) => r.json());
          const me = (users as any[]).find((u: any) => u.user_id === userId);
          return { leagueId: l.leagueId, isCommissioner: me?.is_owner === true };
        })
      );
      if (cancelled) return;

      const commissionerLeagueIds: string[] = [];
      const byLeague: Record<string, number | null> = {};
      const txnsMap: Record<string, number | null> = {};
      for (const r of ownership) {
        if (r.status !== "fulfilled") continue;
        byLeague[r.value.leagueId] = null; // default: not scored
        txnsMap[r.value.leagueId] = null;  // default: no data
        if (r.value.isCommissioner) commissionerLeagueIds.push(r.value.leagueId);
      }

      if (commissionerLeagueIds.length === 0) {
        setActivityByLeague(byLeague);
        setTxnsByLeague(txnsMap);
        setActivityKpis(null);
        setLeagueRowsById({});
        setActivityLoading(false);
        return;
      }

      const { refreshActivity, fetchMultiOverview } = await import("@/lib/commissionerActivityApi");
      // Best-effort scan of the commissioned leagues; tolerate failures.
      await Promise.allSettled(
        commissionerLeagueIds.map((leagueId) => refreshActivity({ leagueId, mode: "recent" }))
      );
      if (cancelled) return;
      const { leagues: rows } = await fetchMultiOverview(commissionerLeagueIds);
      if (cancelled) return;
      const rowsById: Record<string, MultiLeagueRow> = {};
      for (const row of rows) {
        byLeague[row.leagueId] = row.hasData ? row.leagueActivityScore : null;
        txnsMap[row.leagueId] = row.hasData ? row.totalTransactions : null;
        rowsById[row.leagueId] = row;
      }
      setLeagueRowsById(rowsById);
      // Roll the per-league rows up into the activity KPI tiles (mirrors the
      // aggregates the All Leagues tab used to show).
      const monitored = rows.filter((r) => r.hasData);
      setActivityKpis({
        leagues: commissionerLeagueIds.length,
        scanned: monitored.length,
        healthy: monitored.filter((r) => (r.leagueActivityScore ?? 0) >= 70).length,
        lowActivity: monitored.filter((r) => (r.leagueActivityScore ?? 0) < 50).length,
        atRiskManagers: monitored.reduce((s, r) => s + (r.inactiveManagerCount ?? 0), 0),
        openAlerts: rows.reduce((s, r) => s + r.openAlerts, 0),
        emptySlots: monitored.reduce((s, r) => s + (r.totalEmptyStarterSlots ?? 0), 0),
      });
      setActivityByLeague(byLeague);
      setTxnsByLeague(txnsMap);
      setActivityLoading(false);
    })().catch(() => {
      if (!cancelled) { setActivityByLeague({}); setTxnsByLeague({}); setActivityKpis(null); setLeagueRowsById({}); setActivityLoading(false); }
    });
    return () => { cancelled = true; };
  }, [isConnected, user?.userId, leagues]);

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

  const bestBallCount = leagues.filter((l) => l.isBestBall).length;
  const seasons = Array.from(new Set(leagues.map((l) => l.season)));

  // "Needs attention" = any league with a commissioner-actionable issue: a
  // pending trade awaiting response, an open alert, an empty starter slot, an
  // at-risk (inactive) manager, or a low activity score. Counted per-league so
  // a league with several issues still counts once.
  const attentionLeagueIds = new Set<string>();
  for (const [id, count] of Object.entries(pendingTradesByLeague)) {
    if (count > 0) attentionLeagueIds.add(id);
  }
  for (const [id, row] of Object.entries(leagueRowsById)) {
    const flagged =
      row.openAlerts > 0 ||
      (row.totalEmptyStarterSlots ?? 0) > 0 ||
      (row.inactiveManagerCount ?? 0) > 0 ||
      (row.hasData && (row.leagueActivityScore ?? 100) < 50);
    if (flagged) attentionLeagueIds.add(id);
  }
  const needsAttentionCount = attentionLeagueIds.size;
  const attentionReady = activityKpis != null || pendingTradeCount != null;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title="My Leagues" subtitle="Monitor league health, pending trades, open teams, manager activity, and setup issues across every league you commission." />
      </div>

      {/* Main summary — the four things a commissioner acts on first. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Leagues" value={leagues.length} icon={Trophy} subtitle="Commissioned" />
        <KpiCard
          label="Needs Attention"
          value={attentionReady ? needsAttentionCount : "—"}
          icon={AlertTriangle}
          subtitle={attentionReady ? `${needsAttentionCount === 1 ? "league" : "leagues"} flagged` : undefined}
          loading={activityLoading && !attentionReady}
        />
        <KpiCard
          label="Open Teams"
          value={activityKpis ? activityKpis.emptySlots : "—"}
          icon={Users}
          subtitle="Empty starter slots"
          loading={activityLoading && !activityKpis}
        />
      </div>

      {/* Secondary health row — league-level status at a glance. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Healthy Leagues" icon={CheckCircle}
          value={activityKpis ? activityKpis.healthy : "—"}
          loading={activityLoading && !activityKpis}
        />
        <KpiCard
          label="Low Activity" icon={Activity}
          value={activityKpis ? activityKpis.lowActivity : "—"}
          loading={activityLoading && !activityKpis}
        />
        <KpiCard
          label="At-Risk Managers" icon={ShieldAlert}
          value={activityKpis ? activityKpis.atRiskManagers : "—"}
          loading={activityLoading && !activityKpis}
        />
        <KpiCard
          label="Open Alerts" icon={Inbox}
          value={activityKpis ? activityKpis.openAlerts : "—"}
          loading={activityLoading && !activityKpis}
        />
      </div>

      {/* Commissioner Action Center — action-first deep links to resolve the
          flagged items above. Only surfaces actions backed by real data. */}
      <Card className="p-4 md:p-5" data-testid="commissioner-action-center">
        <div className="mb-4">
          <h3 className="text-base font-bold text-foreground">Commissioner Action Center</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <ActionTile
            icon={ArrowRightLeft} label="Pending Trades" cta="Review trades"
            count={pendingTradeCount} loading={pendingTradeLoading}
            onClick={onNavigate ? () => onNavigate("trade-center", "trade-review") : undefined}
          />
          <ActionTile
            icon={Users} label="Open Teams" cta="Manage rosters"
            count={activityKpis ? activityKpis.emptySlots : null} loading={activityLoading && !activityKpis}
            onClick={onNavigate ? () => onNavigate("league-analyzer", "league-activity") : undefined}
          />
          <ActionTile
            icon={ShieldAlert} label="At-Risk Managers" cta="Review managers"
            count={activityKpis ? activityKpis.atRiskManagers : null} loading={activityLoading && !activityKpis}
            onClick={onNavigate ? () => onNavigate("league-analyzer", "league-activity") : undefined}
          />
          <ActionTile
            icon={Inbox} label="Open Alerts" cta="View alerts"
            count={activityKpis ? activityKpis.openAlerts : null} loading={activityLoading && !activityKpis}
            onClick={onNavigate ? () => onNavigate("league-analyzer", "league-activity") : undefined}
          />
        </div>
      </Card>

      {/* Live Startup Drafts — surfaces fresh-startup leagues that aren't
          in the user's main league list yet (no roster players → filtered
          out of useSleeper().leagues). One row per draft + a CTA that
          jumps straight to the Live Draft module. */}
      {liveStartupDrafts.length > 0 && (
        <Card className="p-4 md:p-5 border border-emerald-500/30 bg-[linear-gradient(180deg,rgba(16,185,129,0.08),rgba(16,185,129,0.015))]" data-testid="live-startup-drafts">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center ring-1 ring-emerald-500/30">
                <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-tight">Live Startup Drafts</h3>
                <p className="text-[10.5px] text-muted-foreground leading-tight">
                  {liveStartupDrafts.length} startup draft{liveStartupDrafts.length === 1 ? "" : "s"} in progress.
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {liveStartupDrafts.map((d) => {
              const isLive = d.status === "drafting" || d.status === "paused";
              const isPaused = d.status === "paused";
              const isOnClock = isLive && d.picksAway === 0;
              const startsSoon = d.status === "pre_draft" && d.startTime && d.startTime > Date.now();
              const statusPill = isPaused
                ? { label: "PAUSED", cls: "bg-amber-500 text-black" }
                : isOnClock
                  ? { label: "YOUR PICK", cls: "bg-[#d4af37] text-[#0b3a7a]" }
                  : isLive
                    ? { label: "LIVE", cls: "bg-emerald-500 text-white" }
                    : { label: "UPCOMING", cls: "bg-blue-500 text-white" };
              return (
                <div
                  key={d.draftId}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-border/40 bg-card/40 hover:border-emerald-500/40 transition-colors"
                  data-testid={`live-startup-row-${d.draftId}`}
                >
                  <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center relative">
                    <Trophy className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                    {d.leagueAvatar && (
                      <img
                        src={`https://sleepercdn.com/avatars/thumbs/${d.leagueAvatar}`}
                        alt={d.leagueName}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground truncate" data-testid={`text-live-startup-name-${d.draftId}`}>{d.leagueName}</p>
                    <p className="text-[10.5px] text-muted-foreground tabular-nums">
                      {isLive ? `Pick ${Math.min(d.picksMade + 1, d.totalPicks)} of ${d.totalPicks}` : startsSoon ? `Starts ${new Date(d.startTime!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Start time not set"}
                      {typeof d.picksAway === "number" && isLive && d.picksAway > 0 && (
                        <span className="ml-1.5">· {d.picksAway} {d.picksAway === 1 ? "pick" : "picks"} away</span>
                      )}
                      {d.mySlot != null && (
                        <span className="ml-1.5 text-muted-foreground/70">· Slot {d.mySlot}</span>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap", statusPill.cls)}
                    data-testid={`badge-live-startup-status-${d.draftId}`}
                  >
                    {isLive && !isPaused && !isOnClock && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    )}
                    {statusPill.label}
                  </span>
                  <Button
                    size="sm"
                    className="h-7 text-[11px] gap-1 bg-[#0b3a7a] hover:bg-[#0b3a7a]/80 text-white"
                    onClick={() => onNavigate?.("draft", "draft-board")}
                    data-testid={`button-track-live-startup-${d.draftId}`}
                  >
                    <Target className="w-3 h-3" />
                    Track
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {liveStartupDraftsLoading && liveStartupDrafts.length === 0 && (
        <p className="text-[10.5px] text-muted-foreground text-center -mt-2">Scanning for live startup drafts…</p>
      )}

      {summaryLoading && (
        <Card className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#0b3a7a] mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Analyzing your portfolio across {leagues.length} leagues...</p>
        </Card>
      )}

      {summaryData && (
        <>
          <Card className="p-6" data-testid="portfolio-performance">
            <div className="mb-4">
              <h3 className="text-base font-bold text-foreground">League Command Center</h3>
              <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
            </div>

            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground mb-4">
              <Info className="w-3.5 h-3.5 mt-px flex-shrink-0 text-muted-foreground/60" />
              <span>
                Showing leagues you actively manage. Use filters to include
                inactive, draft-only, redraft, best ball, keeper, or orphan leagues.
                {onNavigate && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => onNavigate("settings", "leagues")}
                      className="font-semibold text-[#d4af37] hover:underline"
                      data-testid="link-manage-leagues"
                    >
                      Manage leagues
                    </button>{" "}
                    to show one that isn&apos;t here.
                  </>
                )}
              </span>
            </p>

            {summaryData.leagueRecords.length > 0 && (() => {
              return (
                <SortableLeagueRecords
                  records={summaryData.leagueRecords}
                  pendingTradesByLeague={pendingTradesByLeague}
                  pendingTradesLoading={pendingTradeLoading}
                  activityByLeague={activityByLeague}
                  activityLoading={activityLoading}
                  txnsByLeague={txnsByLeague}
                  leagueRowsById={leagueRowsById}
                  onViewLeague={handleViewLeague}
                />
              );
            })()}
          </Card>

        </>
      )}

      {!summaryData && !summaryLoading && (
        <Card className="p-6" data-testid="portfolio-overview-text">
          <div className="mb-4">
            <h3 className="text-base font-bold text-foreground">Portfolio Overview</h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You commission <strong className="text-foreground">{leagues.length}</strong> league{leagues.length !== 1 ? "s" : ""} across{" "}
            {seasons.length} season{seasons.length !== 1 ? "s" : ""}. Your portfolio includes{" "}
            <strong className="text-foreground">{bestBallCount}</strong> Best Ball and{" "}
            <strong className="text-foreground">{leagues.length - bestBallCount}</strong> standard league{leagues.length - bestBallCount !== 1 ? "s" : ""}.
            Connect your Sleeper account in the <strong>Connect</strong> tab to dive into detailed analysis.
          </p>
        </Card>
      )}
    </div>
  );
}