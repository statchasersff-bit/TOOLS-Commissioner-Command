import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import type { Team } from "@/types";
import {
  calculateNflTeamExposure,
  HEAVY_EXPOSURE_PLAYER_COUNT,
  HEAVY_EXPOSURE_VALUE_PCT,
  type ExposureInsight,
} from "@/lib/nflTeamExposure";
import { getFavoriteTeamTheme } from "@/config/nflTeams";

interface Props { userTeam: Team; }

const TOP_N = 5;

export function NflTeamExposure({ userTeam }: Props) {
  const { getPlayerValue, getRedraftValue } = useValueModel();
  const { favoriteAbbr } = useFavoriteTeam();

  const exposure = useMemo(
    () => calculateNflTeamExposure(userTeam.roster, favoriteAbbr, getPlayerValue, getRedraftValue),
    [userTeam.roster, favoriteAbbr, getPlayerValue, getRedraftValue],
  );

  if (userTeam.roster.length === 0) {
    return (
      <Card className="p-5" data-testid="gm-nfl-exposure-empty">
        <SectionTitle />
        <p className="text-sm text-muted-foreground mt-3">No roster exposure available yet.</p>
      </Card>
    );
  }

  // Always show the favorite-team row even if it falls outside the top N —
  // it's the whole point of personalization. We splice it in if missing.
  const visible = (() => {
    const top = exposure.teams.slice(0, TOP_N);
    if (exposure.favoriteTeamExposure && !top.find((t) => t.teamAbbr === exposure.favoriteTeamExposure!.teamAbbr)) {
      top.push(exposure.favoriteTeamExposure);
    }
    return top;
  })();

  const maxValue = Math.max(1, ...visible.map((t) => t.dynastyValue));

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-nfl-exposure">
      <SectionTitle />

      <div className="space-y-1.5" data-testid="gm-nfl-exposure-rows">
        {visible.map((row) => {
          const theme = getFavoriteTeamTheme(row.teamAbbr);
          const barPct = Math.max(2, (row.dynastyValue / maxValue) * 100);
          return (
            <div
              key={row.teamAbbr}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 border",
                row.isFavoriteTeam
                  ? "border-[#d4af37]/50 bg-[#d4af37]/5"
                  : "border-border/40 bg-muted/20",
              )}
              data-testid={`gm-nfl-exposure-row-${row.teamAbbr}`}
            >
              {/* Logo / chip */}
              <span
                className="relative w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ring-1 ring-black/10"
                style={{ background: theme?.primaryColor ?? "rgba(148,163,184,0.4)" }}
              >
                {theme && (
                  <img
                    src={theme.logoUrl}
                    alt=""
                    className="absolute inset-1 w-6 h-6 object-contain"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <span
                  className="text-[9px] font-black tracking-tight"
                  style={{ color: theme?.secondaryColor ?? "#fff" }}
                >
                  {row.teamAbbr}
                </span>
              </span>

              {/* Name + counts */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate">
                    {theme?.shortName ?? row.teamAbbr}
                  </span>
                  {row.isFavoriteTeam && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-[#d4af37]/15 text-[#d4af37] ring-1 ring-[#d4af37]/40 flex-shrink-0">
                      Favorite Team
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight">
                  {row.playerCount} {row.playerCount === 1 ? "player" : "players"}
                  <span className="mx-1.5 text-border/60">·</span>
                  {formatK(row.dynastyValue)} dynasty
                  {row.dynastyValuePct > 0 && (
                    <>
                      <span className="mx-1.5 text-border/60">·</span>
                      {row.dynastyValuePct.toFixed(1)}% of roster
                    </>
                  )}
                </p>
              </div>

              {/* Bar */}
              <div className="w-20 sm:w-32 h-1.5 rounded-full bg-muted/40 overflow-hidden flex-shrink-0">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${barPct}%`,
                    background: row.isFavoriteTeam
                      ? "#d4af37"
                      : theme?.primaryColor ?? "rgba(148,163,184,0.7)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Insights */}
      {exposure.insights.length > 0 && (
        <div className="space-y-1.5" data-testid="gm-nfl-exposure-insights">
          {exposure.insights.map((ins, i) => (
            <InsightLine key={i} insight={ins} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SectionTitle() {
  return (
    <div>
      <h3 className="text-base font-bold tracking-tight text-foreground">NFL Team Exposure</h3>
      <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
      <p className="text-xs text-muted-foreground mt-2">
        Top {TOP_N} NFL teams you roster, by dynasty value.
      </p>
    </div>
  );
}

function InsightLine({ insight }: { insight: ExposureInsight }) {
  if (insight.kind === "favorite-present") {
    const theme = getFavoriteTeamTheme(insight.teamAbbr);
    return (
      <p className="text-xs text-foreground">
        You roster <span className="font-semibold">{insight.count}</span>{" "}
        {theme ? theme.shortName : insight.teamAbbr}{" "}
        {insight.count === 1 ? "player" : "players"} in this league.
      </p>
    );
  }
  if (insight.kind === "favorite-absent") {
    const theme = getFavoriteTeamTheme(insight.teamAbbr);
    return (
      <p className="text-xs text-muted-foreground italic">
        You do not currently roster any {theme ? theme.shortName : insight.teamAbbr} players in this league.
      </p>
    );
  }
  // heavy-concentration
  const theme = getFavoriteTeamTheme(insight.teamAbbr);
  const triggerWord = insight.count >= HEAVY_EXPOSURE_PLAYER_COUNT
    ? `${insight.count} players`
    : `${insight.valuePct.toFixed(1)}% of roster value`;
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs"
      data-testid="gm-nfl-exposure-heavy"
    >
      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="font-semibold text-amber-700 dark:text-amber-300">
          Heavy exposure to the {theme ? theme.shortName : insight.teamAbbr} offense
          <span className="font-normal text-amber-700/80 dark:text-amber-300/80"> ({triggerWord})</span>
        </p>
        <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 leading-snug">
          High exposure can increase weekly volatility if that offense struggles.
        </p>
      </div>
    </div>
  );
}

function formatK(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toString();
}
