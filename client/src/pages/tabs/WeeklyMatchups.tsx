import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type SortKey = "schedule" | "edge" | "closest" | "combined";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "schedule", label: "Sleeper schedule order" },
  { value: "edge", label: "Highest win-prob edge" },
  { value: "closest", label: "Closest matchups" },
  { value: "combined", label: "Strongest combined teams" },
];

function formatWinNow(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toString();
}

function difficultyBadge(winProb: number): { label: string; className: string } {
  if (winProb >= 55) return { label: "Favorite", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30" };
  if (winProb > 45) return { label: "Toss-Up", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30" };
  return { label: "Underdog", className: "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/30" };
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
  const [sortBy, setSortBy] = useState<SortKey>("schedule");

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

  const sortedMatchups = useMemo(() => {
    if (!data) return [] as WMCard[];
    const list = [...data.matchups];
    switch (sortBy) {
      case "edge":
        list.sort((a, b) => b.edgePct - a.edgePct);
        break;
      case "closest":
        // Bye rows have edgePct = 0 — push them last so they don't claim the
        // "closest" slots when a real head-to-head matchup is genuinely tighter.
        list.sort((a, b) => {
          if (a.isBye && !b.isBye) return 1;
          if (b.isBye && !a.isBye) return -1;
          return a.edgePct - b.edgePct;
        });
        break;
      case "combined":
        list.sort((a, b) => b.combinedWinNowScore - a.combinedWinNowScore);
        break;
      default:
        // schedule order — keep server-provided order (matchup_id ascending)
        break;
    }
    return list;
  }, [data, sortBy]);

  const teamNameFor = (rosterId: number): string | null => {
    if (!data) return null;
    for (const m of data.matchups) {
      if (m.teamA.rosterId === rosterId) return m.teamA.teamName;
      if (m.teamB?.rosterId === rosterId) return m.teamB.teamName;
    }
    return null;
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

      <SummaryCards summary={data.summary} teamNameFor={teamNameFor} />

      <div className="flex flex-wrap items-center justify-between gap-3" data-testid="wm-controls">
        <div className="text-sm text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{data.matchups.length}</span>{" "}
          matchup{data.matchups.length === 1 ? "" : "s"} for{" "}
          <span className="font-semibold text-foreground">Week {data.week}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Sort</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
            <SelectTrigger className="w-[220px] h-8 text-xs" data-testid="wm-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sortedMatchups.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground" data-testid="wm-empty">
          No matchups found for Week {data.week}.
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="wm-grid">
          {sortedMatchups.map((m, i) => (
            <MatchupCard key={`${m.matchupId ?? "synth"}-${i}`} matchup={m} leagueId={leagueId} />
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
  summary, teamNameFor,
}: {
  summary: WMSummary;
  teamNameFor: (rosterId: number) => string | null;
}) {
  const items: { icon: JSX.Element; label: string; value: string; sub: string }[] = [];

  if (summary.biggestFavorite) {
    const name = teamNameFor(summary.biggestFavorite.rosterId) || `Team ${summary.biggestFavorite.rosterId}`;
    items.push({
      icon: <Trophy className="w-4 h-4 text-[#d4af37]" />,
      label: "Biggest Favorite",
      value: name,
      sub: `${summary.biggestFavorite.winProbability.toFixed(1)}% win prob`,
    });
  }
  if (summary.closestMatchup) {
    items.push({
      icon: <Scale className="w-4 h-4 text-blue-400" />,
      label: "Closest Matchup",
      value: `${summary.closestMatchup.edgePct.toFixed(1)}pp edge`,
      sub: "Tightest projected gap",
    });
  }
  if (summary.highestCombinedScore) {
    items.push({
      icon: <Flame className="w-4 h-4 text-rose-500" />,
      label: "Highest Combined Win-Now",
      value: formatWinNow(summary.highestCombinedScore.combinedWinNowScore),
      sub: "Strongest teams on the field",
    });
  }
  if (summary.upsetWatch) {
    const name = teamNameFor(summary.upsetWatch.underdogRosterId) || `Team ${summary.upsetWatch.underdogRosterId}`;
    items.push({
      icon: <Swords className="w-4 h-4 text-amber-500" />,
      label: "Upset Watch",
      value: name,
      sub: `${summary.upsetWatch.underdogWinProbability.toFixed(1)}% underdog chance`,
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
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold truncate">{it.value}</span>
            <span className="text-[10px] text-muted-foreground truncate">{it.sub}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

function MatchupCard({ matchup, leagueId }: { matchup: WMCard; leagueId: string }) {
  if (matchup.isBye) {
    const t = matchup.teamA;
    return (
      <Card className="p-3 border-dashed" data-testid={`wm-card-bye-${t.rosterId}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Bye Week</span>
        </div>
        <div className="flex items-center gap-2">
          {avatar(t)}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">{t.teamName}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              <ManagerNameButton
                userId={t.ownerId}
                username={t.ownerName}
                avatar={t.avatar}
                leagueId={leagueId}
              >
                {t.ownerName}
              </ManagerNameButton>
              {" • "}{t.record} • Win-Now {formatWinNow(t.winNowScore)}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const { teamA, teamB } = matchup;
  if (!teamB) return null;

  const aBadge = difficultyBadge(teamA.winProbability);
  const bBadge = difficultyBadge(teamB.winProbability);
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

      <TeamRow team={teamA} badge={aBadge} highlight={matchup.favoriteRosterId === teamA.rosterId} leagueId={leagueId} />

      {/* probability bar */}
      <div className="my-2 px-1">
        <div className="h-2 rounded-full bg-rose-500/20 overflow-hidden relative" data-testid="wm-prob-bar">
          <div
            className="h-full bg-emerald-500/70 transition-all"
            style={{ width: `${aBarPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
          <span>{teamA.winProbability.toFixed(1)}%</span>
          <span className="uppercase tracking-wider">vs</span>
          <span>{teamB.winProbability.toFixed(1)}%</span>
        </div>
      </div>

      <TeamRow team={teamB} badge={bBadge} highlight={matchup.favoriteRosterId === teamB.rosterId} leagueId={leagueId} />
    </Card>
  );
}

function TeamRow({
  team, badge, highlight, leagueId,
}: {
  team: WMTeam;
  badge: { label: string; className: string };
  highlight: boolean;
  leagueId: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 py-1", highlight && "")}>
      {avatar(team)}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold truncate">{team.teamName}</span>
          <span className={cn("inline-flex flex-shrink-0 px-1.5 py-0.5 rounded ring-1 text-[9px] font-bold uppercase tracking-wider", badge.className)}>
            {badge.label}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate tabular-nums">
          <ManagerNameButton
            userId={team.ownerId}
            username={team.ownerName}
            avatar={team.avatar}
            leagueId={leagueId}
          >
            {team.ownerName}
          </ManagerNameButton>
          {" • "}{team.record} • Win-Now {formatWinNow(team.winNowScore)}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <span className={cn("text-base font-bold tabular-nums", highlight ? "text-emerald-500 dark:text-emerald-400" : "text-muted-foreground")}>
          {team.winProbability.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
