import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/DataTable";
import { API_BASE } from "@/lib/apiBase";
import { cn } from "@/lib/utils";
import {
  Loader2, AlertCircle, TrendingDown,
  Trophy, Flame, Snowflake, Target, Clock,
} from "lucide-react";
import { TeamLoader } from "@/components/TeamLoader";

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

interface PlayoffMeta {
  totalTeams: number;
  playoffTeams: number;
  byeTeams: number;
  currentWeek: number;
  regularSeasonEndWeek: number;
  remainingGames: number;
  simulations: number;
  scheduleSource: "sleeper" | "synthetic" | "none";
  playoffPctSum: number;
  byePctSum: number;
  championshipPctSum: number;
  warnings: string[];
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
  meta?: PlayoffMeta;
}

const DEFAULT_SIM_COUNT = 1000;

function pctLabel(pct: number): string {
  const v = Math.max(0, Math.min(100, pct));
  if (v >= 99.5) return ">99%";
  if (v > 0 && v < 0.5) return "<1%";
  if (v === 0) return "0%";
  return `${v.toFixed(1)}%`;
}

function pctCell(pct: number): { className: string; label: string } {
  const v = Math.max(0, Math.min(100, pct));
  const label = pctLabel(pct);
  if (v === 0) return { className: "text-muted-foreground/60", label };
  if (v >= 99) return { className: "font-bold text-emerald-300 bg-emerald-500/40", label };
  if (v >= 75) return { className: "font-bold text-blue-50 bg-blue-500/70", label };
  if (v >= 50) return { className: "font-semibold text-blue-50 bg-blue-500/50", label };
  if (v >= 25) return { className: "font-medium text-blue-100 bg-blue-500/30", label };
  if (v >= 10) return { className: "text-blue-200 bg-blue-500/15", label };
  return { className: "text-blue-200/70 bg-blue-500/5", label };
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

export function PlayoffOdds({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<PlayoffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevMap, setPrevMap] = useState<Record<number, number>>({});

  useEffect(() => {
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url = `${API_BASE}/api/leagues/${leagueId}/playoff-calculator?simulations=${DEFAULT_SIM_COUNT}`;
        const res = await fetch(url, { credentials: "include" });
        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) {
          const errorText = await res.text();
          let msg = `Playoff API failed (${res.status})`;
          try {
            const j = JSON.parse(errorText);
            if (j?.error) msg = `Playoff API failed (${res.status}): ${j.error}`;
          } catch {
            if (errorText.trim()) msg = `Playoff API failed (${res.status}): ${errorText.slice(0, 240)}`;
          }
          throw new Error(msg);
        }
        if (!contentType.includes("application/json")) {
          const text = await res.text();
          const looksLikeHtml = /^\s*<!doctype|^\s*<html/i.test(text);
          throw new Error(
            looksLikeHtml
              ? "API route returned app HTML. Check server route registration."
              : `Expected JSON but received ${contentType || "no content-type"}: ${text.slice(0, 240)}`
          );
        }
        const json = (await res.json()) as PlayoffResponse;
        if (cancelled) return;
        setData(json);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[PlayoffOdds]", err);
        setError(err?.message || "Failed to load playoff odds");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId]);

  useEffect(() => {
    if (!data) return;
    const snapshot: Record<string, number> = {};
    for (const t of data.teams) snapshot[String(t.roster_id)] = t.make_playoffs_pct;
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:${leagueId}`, JSON.stringify(snapshot));
    } catch { /* quota / disabled — fine */ }
  }, [data, leagueId]);

  const enrichedTeams = useMemo(() => {
    if (!data) return [] as (PlayoffTeam & { change: number | null })[];
    return data.teams.map((t) => ({
      ...t,
      change: t.roster_id in prevMap ? t.make_playoffs_pct - prevMap[t.roster_id] : null,
    }));
  }, [data, prevMap]);

  const insights = useMemo(() => {
    if (enrichedTeams.length === 0) return null;
    const favorite = [...enrichedTeams].sort((a, b) => b.make_playoffs_pct - a.make_playoffs_pct)[0];
    const longShot = [...enrichedTeams].sort((a, b) => a.make_playoffs_pct - b.make_playoffs_pct)[0];
    const hardSos = [...enrichedTeams]
      .filter((t) => t.remaining_opponents.length > 0)
      .sort((a, b) => b.remaining_sos - a.remaining_sos)[0];
    const softSos = [...enrichedTeams]
      .filter((t) => t.remaining_opponents.length > 0)
      .sort((a, b) => a.remaining_sos - b.remaining_sos)[0];
    const bubble = [...enrichedTeams]
      .filter((t) => t.make_playoffs_pct > 5 && t.make_playoffs_pct < 95)
      .sort((a, b) => Math.abs(a.make_playoffs_pct - 50) - Math.abs(b.make_playoffs_pct - 50))[0];
    return { favorite, longShot, hardSos, softSos, bubble };
  }, [enrichedTeams]);

  const columns = useMemo(() => [
    {
      key: "team_rating",
      header: "Team Rating",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.team_rating,
      render: (r: PlayoffTeam & { change: number | null }) => (
        <span className="font-bold text-foreground tabular-nums">{r.team_rating}</span>
      ),
    },
    {
      key: "team",
      header: "Team",
      sticky: true,
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.team_name.toLowerCase(),
      render: (r: PlayoffTeam & { change: number | null }) => (
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
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.projected_wins,
      render: (r: PlayoffTeam & { change: number | null }) => (
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tabular-nums">{r.projected_record}</span>
          <span className="text-[10px] text-muted-foreground">Now {r.current_wins}-{r.current_losses}{r.current_ties > 0 ? `-${r.current_ties}` : ""}</span>
        </div>
      ),
    },
    {
      key: "remaining_sos",
      header: "Rem SOS",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.remaining_sos,
      render: (r: PlayoffTeam & { change: number | null }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {r.remaining_sos > 0 ? r.remaining_sos.toFixed(1) : "—"}
        </span>
      ),
    },
    {
      key: "make_playoffs_pct",
      header: "Make Playoffs",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.make_playoffs_pct,
      render: (r: PlayoffTeam & { change: number | null }) => {
        const c = pctCell(r.make_playoffs_pct);
        return <span className={cn("inline-block px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>{c.label}</span>;
      },
    },
    {
      key: "first_round_bye_pct",
      header: "1st-Round Bye",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.first_round_bye_pct,
      render: (r: PlayoffTeam & { change: number | null }) => {
        const c = pctCell(r.first_round_bye_pct);
        return <span className={cn("inline-block px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>{c.label}</span>;
      },
    },
    {
      key: "semifinals_pct",
      header: "Make Semi-Finals",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.semifinals_pct,
      render: (r: PlayoffTeam & { change: number | null }) => {
        const c = pctCell(r.semifinals_pct);
        return <span className={cn("inline-block px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>{c.label}</span>;
      },
    },
    {
      key: "finals_pct",
      header: "Make Finals",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.finals_pct,
      render: (r: PlayoffTeam & { change: number | null }) => {
        const c = pctCell(r.finals_pct);
        return <span className={cn("inline-block px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>{c.label}</span>;
      },
    },
    {
      key: "championship_pct",
      header: "Win Finals",
      sortable: true,
      sortAccessor: (r: PlayoffTeam & { change: number | null }) => r.championship_pct,
      render: (r: PlayoffTeam & { change: number | null }) => {
        const c = pctCell(r.championship_pct);
        return (
          <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs tabular-nums", c.className)}>
            {r.championship_pct >= 25 && <Trophy className="w-3 h-3" />}{c.label}
          </span>
        );
      },
    },
  ], []);

  const lastUpdatedLabel = useMemo(() => {
    if (!data) return "—";
    const d = new Date(data.lastUpdated);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
          {loading && <TeamLoader size="sm" fallback="Running simulations…" context="Running simulations" />}

          {data && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="pc-settings-pills">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
                <Clock className="w-3 h-3" />
                {data.settings.remainingWeeks} wks left
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
                Playoff teams: {data.settings.playoffTeams}
              </span>
              {data.settings.byes > 0 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
                  Byes: {data.settings.byes}
                </span>
              )}
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
                Updated: {lastUpdatedLabel}
              </span>
            </div>
          )}
      </div>

      {error && (
        <Card className="p-4 border-rose-500/40 bg-rose-500/5" data-testid="pc-error">
          <div className="flex items-center gap-2 text-rose-500 dark:text-rose-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        </Card>
      )}

      {data?.meta?.warnings && data.meta.warnings.length > 0 && (
        <Card className="p-3 border-amber-500/40 bg-amber-500/5" data-testid="pc-warnings">
          <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <ul className="text-[12px] space-y-1">
              {data.meta.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}

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
            icon={<TrendingDown className="w-4 h-4 text-rose-500" />}
            label="Least Likely to Make Playoffs"
            value={insights.longShot.team_name}
            sub={`${insights.longShot.make_playoffs_pct.toFixed(1)}% to make playoffs`}
            avatarTeam={insights.longShot}
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

      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={enrichedTeams}
          loading={loading && !data}
          defaultSortKey="make_playoffs_pct"
          defaultSortDir="desc"
        />
      </div>

      <div className="md:hidden space-y-2" data-testid="pc-mobile">
        {loading && !data && (
          <Card className="p-4">
            <TeamLoader size="md" fallback="Running simulations…" context="Running simulations" />
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
                    {t.remaining_sos > 0 && <> • Rem SOS {t.remaining_sos.toFixed(1)}</>}
                  </p>
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
