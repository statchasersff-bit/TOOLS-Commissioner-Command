import { useEffect, useMemo, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeader } from "@/components/SectionHeader";
import { DataTable } from "@/components/DataTable";
import { useSleeper } from "@/contexts/SleeperContext";
import { API_BASE } from "@/lib/apiBase";
import { cn } from "@/lib/utils";
import {
  RefreshCw, Loader2, AlertCircle, TrendingUp, TrendingDown,
  Trophy, Flame, Snowflake, Target, Clock,
} from "lucide-react";

interface PlayoffTeam {
  roster_id: number;
  owner_id: string;
  team_name: string;
  owner_name: string;
  avatar: string | null;
  current_wins: number;
  current_losses: number;
  current_ties: number;
  points_for: number;
  points_against: number;
  win_now_score: number;
  team_rating: number;
  remaining_opponents: number[];
  projected_record: string;
  projected_wins: number;
  projected_losses: number;
  remaining_sos: number;
  expected_wins_remaining: number;
  projected_points_for: number;
  make_playoffs_pct: number;
  first_round_bye_pct: number;
  semifinals_pct: number;
  finals_pct: number;
  championship_pct: number;
  change_since_last_run: number;
}

interface PlayoffResponse {
  league: { id: string; name: string; season: string; totalRosters: number };
  settings: {
    playoffTeams: number;
    byes: number;
    playoffWeekStart: number;
    championshipWeek: number;
    regularSeasonWeeks: number;
    currentWeek: number;
    remainingWeeks: number;
    format: "SF" | "1QB";
    scoringFormat: string;
    isBestBall: boolean;
  };
  simulationCount: number;
  lastUpdated: string;
  teams: PlayoffTeam[];
}

const SIM_OPTIONS = [
  { value: "1000",  label: "1,000 sims (fast)"  },
  { value: "5000",  label: "5,000 sims"         },
  { value: "10000", label: "10,000 sims (recommended)" },
];

function pctCell(pct: number): { className: string; label: string } {
  // Blue heatmap; brighter = higher
  const v = Math.max(0, Math.min(100, pct));
  if (v === 0) return { className: "text-muted-foreground/60", label: "0%" };
  if (v >= 99) return { className: "font-bold text-emerald-300 bg-emerald-500/40", label: ">99%" };
  if (v >= 75) return { className: "font-bold text-blue-50 bg-blue-500/70", label: `${v.toFixed(1)}%` };
  if (v >= 50) return { className: "font-semibold text-blue-50 bg-blue-500/50", label: `${v.toFixed(1)}%` };
  if (v >= 25) return { className: "font-medium text-blue-100 bg-blue-500/30", label: `${v.toFixed(1)}%` };
  if (v >= 10) return { className: "text-blue-200 bg-blue-500/15", label: `${v.toFixed(1)}%` };
  return { className: "text-blue-200/70 bg-blue-500/5", label: `${v.toFixed(1)}%` };
}

function changeCell(delta: number) {
  if (Math.abs(delta) < 0.1) {
    return <span className="text-muted-foreground text-xs">0%</span>;
  }
  const up = delta > 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
      up ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400",
    )}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? "+" : ""}{delta.toFixed(1)}%
    </span>
  );
}

function teamAvatar(t: PlayoffTeam, size = "w-8 h-8") {
  if (t.avatar) {
    return (
      <img
        src={t.avatar}
        alt={t.team_name}
        className={cn("rounded-full object-cover flex-shrink-0 ring-1 ring-border/40", size)}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        data-testid={`pc-avatar-${t.roster_id}`}
      />
    );
  }
  return (
    <div className={cn("rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-xs font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0 ring-1 ring-border/40", size)}>
      {(t.team_name || t.owner_name || "?").charAt(0).toUpperCase()}
    </div>
  );
}

const STORAGE_PREFIX = "sc-playoff-calc";

export function PlayoffCalculator() {
  const sleeper = useSleeper();
  const leagueId = sleeper.activeLeagueId;

  const [simCount, setSimCount] = useState<string>("10000");
  const [data, setData] = useState<PlayoffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reqNonce, setReqNonce] = useState(0);
  const [prevMap, setPrevMap] = useState<Record<number, number>>({});

  // Load prior run's make-playoffs map from localStorage for the Change column
  useEffect(() => {
    if (!leagueId) return;
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}:${leagueId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        const numMap: Record<number, number> = {};
        for (const [k, v] of Object.entries(parsed)) numMap[parseInt(k, 10)] = v;
        setPrevMap(numMap);
      } else {
        setPrevMap({});
      }
    } catch {
      setPrevMap({});
    }
  }, [leagueId]);

  // Fetch when league or sim count changes (and on manual refresh)
  useEffect(() => {
    if (!leagueId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/leagues/${leagueId}/playoff-calculator?simulations=${simCount}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${r.status})`);
        }
        return r.json() as Promise<PlayoffResponse>;
      })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[PlayoffCalculator]", err);
        setError(err.message || "Failed to load playoff odds");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [leagueId, simCount, reqNonce]);

  // After a successful fetch, persist current make-playoffs map so the
  // next run can diff against it. We do NOT overwrite the prevMap state we
  // already loaded — that is what the Change column displays.
  useEffect(() => {
    if (!data || !leagueId) return;
    const snapshot: Record<string, number> = {};
    for (const t of data.teams) snapshot[String(t.roster_id)] = t.make_playoffs_pct;
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:${leagueId}`, JSON.stringify(snapshot));
    } catch {
      /* quota / disabled — fine */
    }
  }, [data, leagueId]);

  const enrichedTeams = useMemo(() => {
    if (!data) return [] as (PlayoffTeam & { change: number })[];
    return data.teams.map((t) => ({
      ...t,
      change: t.roster_id in prevMap ? t.make_playoffs_pct - prevMap[t.roster_id] : 0,
    }));
  }, [data, prevMap]);

  const insights = useMemo(() => {
    if (enrichedTeams.length === 0) return null;
    const favorite = [...enrichedTeams].sort((a, b) => b.make_playoffs_pct - a.make_playoffs_pct)[0];
    const valueRiser = [...enrichedTeams].sort((a, b) => b.change - a.change)[0];
    const hardSos = [...enrichedTeams]
      .filter((t) => t.remaining_opponents.length > 0)
      .sort((a, b) => b.remaining_sos - a.remaining_sos)[0];
    const softSos = [...enrichedTeams]
      .filter((t) => t.remaining_opponents.length > 0)
      .sort((a, b) => a.remaining_sos - b.remaining_sos)[0];
    const bubble = [...enrichedTeams]
      .filter((t) => t.make_playoffs_pct > 5 && t.make_playoffs_pct < 95)
      .sort((a, b) => Math.abs(a.make_playoffs_pct - 50) - Math.abs(b.make_playoffs_pct - 50))[0];
    return { favorite, valueRiser, hardSos, softSos, bubble };
  }, [enrichedTeams]);

  const columns = useMemo(() => [
    {
      key: "team_rating",
      header: "Team Rating",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.team_rating,
      render: (r: PlayoffTeam & { change: number }) => (
        <span className="font-bold text-foreground tabular-nums">{r.team_rating}</span>
      ),
    },
    {
      key: "change",
      header: "Change",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.change,
      render: (r: PlayoffTeam & { change: number }) => changeCell(r.change),
    },
    {
      key: "team",
      header: "Team",
      sticky: true,
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.team_name.toLowerCase(),
      render: (r: PlayoffTeam & { change: number }) => (
        <div className="flex items-center gap-2 min-w-[180px]">
          {teamAvatar(r, "w-7 h-7")}
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold truncate max-w-[140px]" data-testid={`pc-team-${r.roster_id}`}>{r.team_name}</span>
            <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{r.owner_name}</span>
          </div>
        </div>
      ),
    },
    {
      key: "projected_record",
      header: "Projected Record",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.projected_wins,
      render: (r: PlayoffTeam & { change: number }) => (
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tabular-nums">{r.projected_record}</span>
          <span className="text-[10px] text-muted-foreground">Now {r.current_wins}-{r.current_losses}{r.current_ties > 0 ? `-${r.current_ties}` : ""}</span>
        </div>
      ),
    },
    {
      key: "make_playoffs_pct",
      header: "Make Playoffs",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.make_playoffs_pct,
      render: (r: PlayoffTeam & { change: number }) => {
        const c = pctCell(r.make_playoffs_pct);
        return <span className={cn("inline-block px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>{c.label}</span>;
      },
    },
    {
      key: "first_round_bye_pct",
      header: "1st-Round Bye",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.first_round_bye_pct,
      render: (r: PlayoffTeam & { change: number }) => {
        const c = pctCell(r.first_round_bye_pct);
        return <span className={cn("inline-block px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>{c.label}</span>;
      },
    },
    {
      key: "semifinals_pct",
      header: "Make Semi-Finals",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.semifinals_pct,
      render: (r: PlayoffTeam & { change: number }) => {
        const c = pctCell(r.semifinals_pct);
        return <span className={cn("inline-block px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>{c.label}</span>;
      },
    },
    {
      key: "finals_pct",
      header: "Make Finals",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.finals_pct,
      render: (r: PlayoffTeam & { change: number }) => {
        const c = pctCell(r.finals_pct);
        return <span className={cn("inline-block px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>{c.label}</span>;
      },
    },
    {
      key: "championship_pct",
      header: "Win Finals",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.championship_pct,
      render: (r: PlayoffTeam & { change: number }) => {
        const c = pctCell(r.championship_pct);
        return (
          <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>
            {r.championship_pct >= 25 && <Trophy className="w-3 h-3" />}{c.label}
          </span>
        );
      },
    },
    {
      key: "remaining_sos",
      header: "Rem SOS",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.remaining_sos,
      render: (r: PlayoffTeam & { change: number }) => (
        <span className="text-xs tabular-nums text-muted-foreground">{r.remaining_sos > 0 ? r.remaining_sos.toFixed(1) : "—"}</span>
      ),
    },
    {
      key: "expected_wins_remaining",
      header: "xW Rem",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.expected_wins_remaining,
      render: (r: PlayoffTeam & { change: number }) => (
        <span className="text-xs tabular-nums text-muted-foreground">{r.expected_wins_remaining.toFixed(1)}</span>
      ),
    },
    {
      key: "projected_points_for",
      header: "Proj PF",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number }) => r.projected_points_for,
      render: (r: PlayoffTeam & { change: number }) => (
        <span className="text-xs tabular-nums text-muted-foreground">{r.projected_points_for.toLocaleString()}</span>
      ),
    },
  ], []);

  const handleRefresh = useCallback(() => {
    setReqNonce((n) => n + 1);
  }, []);

  const lastUpdatedLabel = useMemo(() => {
    if (!data) return "—";
    const d = new Date(data.lastUpdated);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [data]);

  if (!leagueId) {
    return (
      <div className="space-y-8">
        <SectionHeader title="Playoff Calculator" subtitle="Monte Carlo playoff odds for your league" />
        <Card className="p-8 text-center text-muted-foreground" data-testid="pc-empty">
          Select a league to view playoff odds.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Playoff Calculator" subtitle="Monte Carlo playoff odds blending win-now value with your remaining schedule" />

      {/* Controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Sims</span>
            <Select value={simCount} onValueChange={setSimCount}>
              <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="pc-sim-count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIM_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
            data-testid="pc-refresh"
            className="h-8 gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>

          <div className="flex-1" />

          {data && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="pc-settings-pills">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40 border border-border/40">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="font-semibold">{data.settings.remainingWeeks}</span>
                <span className="text-muted-foreground">wks left</span>
              </span>
              <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/40">
                <span className="text-muted-foreground">Playoff teams:</span>{" "}
                <span className="font-semibold">{data.settings.playoffTeams}</span>
              </span>
              {data.settings.byes > 0 && (
                <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/40">
                  <span className="text-muted-foreground">Byes:</span>{" "}
                  <span className="font-semibold">{data.settings.byes}</span>
                </span>
              )}
              <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/40">
                <span className="text-muted-foreground">Updated:</span>{" "}
                <span className="font-semibold">{lastUpdatedLabel}</span>
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* Error */}
      {error && (
        <Card className="p-4 border-rose-500/40 bg-rose-500/5" data-testid="pc-error">
          <div className="flex items-center gap-2 text-rose-500 dark:text-rose-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        </Card>
      )}

      {/* Info cards */}
      {data && insights && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="pc-insights">
          <InfoCard
            icon={<Trophy className="w-4 h-4 text-[#d4af37]" />}
            label="Favorite"
            value={insights.favorite.team_name}
            sub={`${insights.favorite.make_playoffs_pct.toFixed(1)}% to make playoffs`}
            avatarTeam={insights.favorite}
          />
          <InfoCard
            icon={<TrendingUp className="w-4 h-4 text-emerald-500" />}
            label="Best Value Riser"
            value={insights.valueRiser.team_name}
            sub={insights.valueRiser.change > 0 ? `+${insights.valueRiser.change.toFixed(1)}% vs last run` : "no prior run"}
            avatarTeam={insights.valueRiser}
          />
          {insights.hardSos && (
            <InfoCard
              icon={<Flame className="w-4 h-4 text-rose-500" />}
              label="Toughest Schedule"
              value={insights.hardSos.team_name}
              sub={`Rem SOS ${insights.hardSos.remaining_sos.toFixed(1)}`}
              avatarTeam={insights.hardSos}
            />
          )}
          {insights.softSos && (
            <InfoCard
              icon={<Snowflake className="w-4 h-4 text-sky-400" />}
              label="Softest Schedule"
              value={insights.softSos.team_name}
              sub={`Rem SOS ${insights.softSos.remaining_sos.toFixed(1)}`}
              avatarTeam={insights.softSos}
            />
          )}
          {insights.bubble && (
            <InfoCard
              icon={<Target className="w-4 h-4 text-blue-400" />}
              label="Bubble Team"
              value={insights.bubble.team_name}
              sub={`${insights.bubble.make_playoffs_pct.toFixed(1)}% playoff odds`}
              avatarTeam={insights.bubble}
            />
          )}
        </div>
      )}

      {/* Table (desktop) */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={enrichedTeams}
          loading={loading && !data}
          defaultSortKey="make_playoffs_pct"
          defaultSortDir="desc"
        />
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2" data-testid="pc-mobile">
        {loading && !data && (
          <Card className="p-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Running simulations...
          </Card>
        )}
        {!loading && enrichedTeams.length === 0 && !error && (
          <Card className="p-4 text-center text-sm text-muted-foreground">No teams.</Card>
        )}
        {[...enrichedTeams]
          .sort((a, b) => b.make_playoffs_pct - a.make_playoffs_pct)
          .map((t) => (
            <Card key={t.roster_id} className="p-3" data-testid={`pc-mobile-${t.roster_id}`}>
              <div className="flex items-center gap-2 mb-2">
                {teamAvatar(t, "w-9 h-9")}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{t.team_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {t.owner_name} • Rating {t.team_rating} • {t.projected_record}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {changeCell(t.change)}
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1 text-[10px]">
                {[
                  { lbl: "Playoffs", v: t.make_playoffs_pct },
                  { lbl: "Bye",      v: t.first_round_bye_pct },
                  { lbl: "Semis",    v: t.semifinals_pct },
                  { lbl: "Finals",   v: t.finals_pct },
                  { lbl: "Champ",    v: t.championship_pct },
                ].map((c) => {
                  const cc = pctCell(c.v);
                  return (
                    <div key={c.lbl} className="flex flex-col items-center gap-0.5">
                      <span className="text-muted-foreground uppercase tracking-wider text-[9px]">{c.lbl}</span>
                      <span className={cn("w-full text-center rounded px-1 py-0.5 tabular-nums", cc.className)}>{cc.label}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
      </div>

      {/* Methodology footer */}
      {data && (
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          <p>
            <span className="font-semibold text-foreground">Methodology:</span>{" "}
            Each team's win-now score uses FantasyCalc redraft starter values for the optimal
            lineup under your league's roster slots. Ratings normalize 0–100. The remaining
            schedule is simulated {data.simulationCount.toLocaleString()} times with a per-team
            weekly std-dev tuned for your format. Tiebreakers: record → points for → rating.
            <span className="italic"> Not a substitute for trash talk.</span>
          </p>
        </div>
      )}
    </div>
  );
}

function InfoCard({
  icon, label, value, sub, avatarTeam,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  avatarTeam?: PlayoffTeam;
}) {
  return (
    <Card className="p-3 flex flex-col gap-2 min-h-[88px]">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon}{label}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        {avatarTeam && teamAvatar(avatarTeam, "w-7 h-7")}
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold truncate">{value}</span>
          <span className="text-[10px] text-muted-foreground truncate">{sub}</span>
        </div>
      </div>
    </Card>
  );
}
