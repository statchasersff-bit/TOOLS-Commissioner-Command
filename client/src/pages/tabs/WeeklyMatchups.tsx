import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { API_BASE } from "@/lib/apiBase";
import { cn } from "@/lib/utils";
import { ManagerNameButton } from "@/components/ManagerNameButton";
import {
  Loader2, AlertCircle, Trophy, Flame, Scale, Swords,
  CheckCircle2, Radio, Clock,
} from "lucide-react";

// ── Types matching the server response ──────────────────────────────────────
interface WMTeam {
  rosterId: number;
  ownerId: string | null;
  ownerName: string;
  teamName: string;
  avatar: string | null;
  record: string;
  pointsFor: number;
  winNowScore: number;
  winProbability: number;
}

type WMStatus = "upcoming" | "live" | "final";

interface WMCard {
  matchupId: number | null;
  status: WMStatus;
  isBye: boolean;
  teamA: WMTeam;
  teamB: WMTeam | null;
  favoriteRosterId: number | null;
  edgePct: number;
  combinedWinNowScore: number;
  scoreA: number;
  scoreB: number;
}

interface WMSummary {
  biggestFavorite: { matchupId: number | null; rosterId: number; winProbability: number } | null;
  closestMatchup: { matchupId: number | null; edgePct: number } | null;
  highestCombinedScore: { matchupId: number | null; combinedWinNowScore: number } | null;
  upsetWatch: { matchupId: number | null; underdogRosterId: number; underdogWinProbability: number } | null;
}

interface WMResponse {
  leagueId: string;
  week: number;
  currentWeek: number;
  regularSeasonWeeks: number;
  scheduleSource: "sleeper" | "synthetic" | "none";
  matchups: WMCard[];
  summary: WMSummary;
  warnings: string[];
}

function formatWinNow(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toString();
}

function statusBadge(status: WMStatus) {
  switch (status) {
    case "final":
      return { Icon: CheckCircle2, label: "Final", className: "bg-muted text-muted-foreground" };
    case "live":
      return { Icon: Radio, label: "Live", className: "bg-rose-500/15 text-rose-600 dark:text-rose-400" };
    default:
      return { Icon: Clock, label: "Upcoming", className: "bg-blue-500/10 text-blue-500 dark:text-blue-400" };
  }
}

function avatar(team: { avatar: string | null; teamName: string; ownerName: string; rosterId: number }, size = "w-9 h-9") {
  if (team.avatar) {
    return (
      <img
        src={team.avatar}
        alt={team.teamName}
        className={cn("rounded-full object-cover flex-shrink-0 ring-1 ring-border/40", size)}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        data-testid={`wm-avatar-${team.rosterId}`}
      />
    );
  }
  return (
    <div className={cn("rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-xs font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0 ring-1 ring-border/40", size)}>
      {(team.teamName || team.ownerName || "?").charAt(0).toUpperCase()}
    </div>
  );
}

export function WeeklyMatchups({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<WMResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `null` means "let the server pick the default week"; otherwise this is the
  // user's explicit selection, which we send to the server every fetch.
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  // Reset the selected-week override whenever the league changes — otherwise
  // a user who picked Week 8 in League A would carry that into League B.
  useEffect(() => {
    setSelectedWeek(null);
    setData(null);
  }, [leagueId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const qs = selectedWeek != null ? `?week=${selectedWeek}` : "";
        const url = `${API_BASE}/api/leagues/${leagueId}/playoff-calculator/matchups${qs}`;
        const res = await fetch(url, { credentials: "include" });
        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) {
          const errorText = await res.text();
          let msg = `Matchups API failed (${res.status})`;
          try {
            const j = JSON.parse(errorText);
            if (j?.error) msg = `Matchups API failed (${res.status}): ${j.error}`;
          } catch {
            if (errorText.trim()) msg = `Matchups API failed (${res.status}): ${errorText.slice(0, 240)}`;
          }
          throw new Error(msg);
        }
        if (!contentType.includes("application/json")) {
          throw new Error("Expected JSON response.");
        }
        const json = (await res.json()) as WMResponse;
        if (cancelled) return;
        setData(json);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[WeeklyMatchups]", err);
        setError(err?.message || "Failed to load weekly matchups");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId, selectedWeek]);

  // Schedule order — keep server-provided order (matchup_id ascending).
  const sortedMatchups = useMemo(() => {
    if (!data) return [] as WMCard[];
    return [...data.matchups];
  }, [data]);

  // League-wide points-for rank (1 = most points), shared across all cards.
  const pfRankByRoster = useMemo(() => {
    const map = new Map<number, number>();
    if (!data) return map;
    const teams: WMTeam[] = [];
    for (const m of data.matchups) {
      teams.push(m.teamA);
      if (m.teamB) teams.push(m.teamB);
    }
    teams
      .sort((a, b) => b.pointsFor - a.pointsFor)
      .forEach((t, i) => map.set(t.rosterId, i + 1));
    return map;
  }, [data]);

  const teamFor = (rosterId: number): WMTeam | null => {
    if (!data) return null;
    for (const m of data.matchups) {
      if (m.teamA.rosterId === rosterId) return m.teamA;
      if (m.teamB?.rosterId === rosterId) return m.teamB;
    }
    return null;
  };

  const teamNameFor = (rosterId: number): string | null => teamFor(rosterId)?.teamName ?? null;

  const matchupTeamsFor = (matchupId: number | null): WMTeam[] => {
    if (!data || matchupId == null) return [];
    const m = data.matchups.find((x) => x.matchupId === matchupId);
    if (!m) return [];
    return m.teamB ? [m.teamA, m.teamB] : [m.teamA];
  };

  if (!data && loading) {
    return (
      <Card className="p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="wm-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading matchups…
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 border-rose-500/40 bg-rose-500/5" data-testid="wm-error">
        <div className="flex items-center gap-2 text-rose-500 dark:text-rose-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <WeekSelector
        weeks={data.regularSeasonWeeks}
        currentWeek={data.currentWeek}
        selectedWeek={data.week}
        onSelect={setSelectedWeek}
        loading={loading}
      />

      {data.warnings.length > 0 && (
        <Card className="p-3 border-amber-500/40 bg-amber-500/5" data-testid="wm-warnings">
          <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <ul className="text-[12px] space-y-1">
              {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </Card>
      )}

      <SummaryCards
        summary={data.summary}
        teamNameFor={teamNameFor}
        teamFor={teamFor}
        matchupTeamsFor={matchupTeamsFor}
      />

      <div className="flex flex-wrap items-center justify-between gap-3" data-testid="wm-controls">
        <div className="text-sm text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{data.matchups.length}</span>{" "}
          matchup{data.matchups.length === 1 ? "" : "s"} for{" "}
          <span className="font-semibold text-foreground">Week {data.week}</span>
        </div>
      </div>

      {sortedMatchups.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground" data-testid="wm-empty">
          No matchups found for Week {data.week}.
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="wm-grid">
          {sortedMatchups.map((m, i) => (
            <MatchupCard key={`${m.matchupId ?? "synth"}-${i}`} matchup={m} leagueId={leagueId} pfRankByRoster={pfRankByRoster} />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekSelector({
  weeks, currentWeek, selectedWeek, onSelect, loading,
}: {
  weeks: number;
  currentWeek: number;
  selectedWeek: number;
  onSelect: (w: number) => void;
  loading: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const list = useMemo(() => Array.from({ length: weeks }, (_, i) => i + 1), [weeks]);

  // Center the selected week button on first paint and whenever it changes.
  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLButtonElement>(`[data-week="${selectedWeek}"]`);
    if (el && containerRef.current) {
      const container = containerRef.current;
      const left = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;
      container.scrollTo({ left, behavior: "smooth" });
    }
  }, [selectedWeek]);

  return (
    <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border/40">
      <div
        ref={containerRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide"
        data-testid="wm-week-selector"
      >
        {list.map((w) => {
          const isSelected = w === selectedWeek;
          const isCurrent = w === currentWeek;
          return (
            <button
              key={w}
              data-week={w}
              onClick={() => onSelect(w)}
              disabled={loading}
              data-testid={`wm-week-${w}`}
              className={cn(
                "flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors border",
                isSelected
                  ? "bg-[#0b3a7a] text-white border-[#0b3a7a] dark:bg-blue-500 dark:border-blue-500"
                  : isCurrent
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40"
                    : "bg-muted/30 text-foreground border-border hover:bg-muted/60",
                loading && !isSelected && "opacity-60 cursor-not-allowed",
              )}
            >
              Week {w}
              {isCurrent && !isSelected && <span className="ml-1 text-[9px] font-normal opacity-70">(now)</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCards({
  summary, teamNameFor, teamFor, matchupTeamsFor,
}: {
  summary: WMSummary;
  teamNameFor: (rosterId: number) => string | null;
  teamFor: (rosterId: number) => WMTeam | null;
  matchupTeamsFor: (matchupId: number | null) => WMTeam[];
}) {
  const items: { icon: JSX.Element; label: string; value: string; sub: string; teams: WMTeam[] }[] = [];

  if (summary.biggestFavorite) {
    const team = teamFor(summary.biggestFavorite.rosterId);
    const name = team?.teamName || teamNameFor(summary.biggestFavorite.rosterId) || `Team ${summary.biggestFavorite.rosterId}`;
    items.push({
      icon: <Trophy className="w-4 h-4 text-[#d4af37]" />,
      label: "Biggest Favorite",
      value: name,
      sub: `${summary.biggestFavorite.winProbability.toFixed(1)}% win prob`,
      teams: team ? [team] : [],
    });
  }
  if (summary.closestMatchup) {
    items.push({
      icon: <Scale className="w-4 h-4 text-blue-400" />,
      label: "Closest Matchup",
      value: `${summary.closestMatchup.edgePct.toFixed(1)}pp edge`,
      sub: "Tightest projected gap",
      teams: matchupTeamsFor(summary.closestMatchup.matchupId),
    });
  }
  if (summary.highestCombinedScore) {
    items.push({
      icon: <Flame className="w-4 h-4 text-rose-500" />,
      label: "Highest Combined Win-Now",
      value: formatWinNow(summary.highestCombinedScore.combinedWinNowScore),
      sub: "Strongest teams on the field",
      teams: matchupTeamsFor(summary.highestCombinedScore.matchupId),
    });
  }
  if (summary.upsetWatch) {
    const team = teamFor(summary.upsetWatch.underdogRosterId);
    const name = team?.teamName || teamNameFor(summary.upsetWatch.underdogRosterId) || `Team ${summary.upsetWatch.underdogRosterId}`;
    items.push({
      icon: <Swords className="w-4 h-4 text-amber-500" />,
      label: "Upset Watch",
      value: name,
      sub: `${summary.upsetWatch.underdogWinProbability.toFixed(1)}% underdog chance`,
      teams: team ? [team] : [],
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="wm-summary">
      {items.map((it, i) => (
        <Card key={i} className="p-3 flex flex-col gap-2 min-h-[80px]">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {it.icon}{it.label}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            {it.teams.length > 0 && (
              <div className="flex -space-x-2 flex-shrink-0">
                {it.teams.map((t) => (
                  <span key={t.rosterId} className="inline-flex">{avatar(t, "w-7 h-7")}</span>
                ))}
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold truncate">{it.value}</span>
              <span className="text-[10px] text-muted-foreground truncate">{it.sub}</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function MatchupCard({ matchup, leagueId, pfRankByRoster }: { matchup: WMCard; leagueId: string; pfRankByRoster: Map<number, number> }) {
  if (matchup.isBye) {
    const t = matchup.teamA;
    const pfRank = pfRankByRoster.get(t.rosterId);
    return (
      <Card className="p-3 border-dashed" data-testid={`wm-card-bye-${t.rosterId}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Bye Week</span>
        </div>
        <div className="flex items-center gap-2">
          {avatar(t)}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">
              <ManagerNameButton
                userId={t.ownerId}
                username={t.ownerName}
                avatar={t.avatar}
                leagueId={leagueId}
              >
                {t.ownerName}
              </ManagerNameButton>
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {t.record}{pfRank ? ` • PF #${pfRank}` : ""}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const { teamA, teamB } = matchup;
  if (!teamB) return null;

  const status = statusBadge(matchup.status);
  const StatusIcon = status.Icon;

  // Width clamps so the probability bar is still visible at extremes.
  const aBarPct = Math.max(2, Math.min(98, teamA.winProbability));

  return (
    <Card className="p-3" data-testid={`wm-card-${matchup.matchupId ?? `synth-${teamA.rosterId}`}`}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold", status.className)}>
          <StatusIcon className="w-3 h-3" /> {status.label}
        </span>
        {matchup.status !== "upcoming" && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {teamA.pointsFor.toFixed(1)} – {teamB.pointsFor.toFixed(1)}
          </span>
        )}
      </div>

      {/* Head-to-head: both teams in line with each other */}
      <div className="flex items-start gap-2">
        <TeamRow team={teamA} highlight={matchup.favoriteRosterId === teamA.rosterId} leagueId={leagueId} side="left" pfRank={pfRankByRoster.get(teamA.rosterId)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold self-center flex-shrink-0 pt-1">vs</span>
        <TeamRow team={teamB} highlight={matchup.favoriteRosterId === teamB.rosterId} leagueId={leagueId} side="right" pfRank={pfRankByRoster.get(teamB.rosterId)} />
      </div>

      {/* probability bar */}
      <div className="mt-2 px-1">
        <div className="h-2 rounded-full bg-rose-500/20 overflow-hidden relative" data-testid="wm-prob-bar">
          <div
            className="h-full bg-emerald-500/70 transition-all"
            style={{ width: `${aBarPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
          <span>{teamA.winProbability.toFixed(1)}%</span>
          <span>{teamB.winProbability.toFixed(1)}%</span>
        </div>
      </div>
    </Card>
  );
}

function TeamRow({
  team, highlight, leagueId, side, pfRank,
}: {
  team: WMTeam;
  highlight: boolean;
  leagueId: string;
  side: "left" | "right";
  pfRank?: number;
}) {
  const isRight = side === "right";
  return (
    <div className={cn("flex items-center gap-2 py-1 flex-1 min-w-0", isRight && "flex-row-reverse text-right")}>
      {avatar(team)}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate">
          <ManagerNameButton
            userId={team.ownerId}
            username={team.ownerName}
            avatar={team.avatar}
            leagueId={leagueId}
          >
            {team.ownerName}
          </ManagerNameButton>
        </div>
        <p className="text-[11px] text-muted-foreground truncate tabular-nums">
          {team.record}{pfRank ? ` • PF #${pfRank}` : ""}
        </p>
        <span className={cn("text-base font-bold tabular-nums", highlight ? "text-emerald-500 dark:text-emerald-400" : "text-muted-foreground")}>
          {team.winProbability.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
