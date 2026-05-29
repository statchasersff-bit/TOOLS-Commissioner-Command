import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { usePlayerProfile } from "@/contexts/PlayerProfileContext";
import type { ADPResult } from "@/types/draft";

// Movers are meant to surface meaningful draft-capital shifts, not deep-bench
// news, so we cap by overall rank. We also require a healthy draft presence so
// a thinly-drafted name can't post a phantom trend.
const MOVERS_DEPTH_ROUNDS = 12; // eligible if overall_rank ≤ teams × this (~top 12 rounds)
const MOVERS_MIN_PRESENCE = 0.25; // and drafted in ≥25% of the slice's drafts

function MoverRow({ r, i, dir, windowDays }: { r: ADPResult; i: number; dir: "up" | "down"; windowDays: 7 | 30 }) {
  const { openPlayerProfile } = usePlayerProfile();
  const Arrow = dir === "up" ? TrendingUp : TrendingDown;
  const color = dir === "up" ? "text-emerald-600 dark-any:text-emerald-400" : "text-rose-600 dark-any:text-rose-400";
  const trend = windowDays === 7 ? r.trend_7d : r.trend_30d;
  return (
    <div className="flex items-center gap-2.5 py-1" data-testid={`adp-mover-${dir}-${i}`}>
      <span className="text-xs font-bold text-muted-foreground w-5 flex-shrink-0 text-right">{i + 1}</span>
      <div className="flex-1 min-w-0">
        <PlayerAvatar
          id={r.player_id}
          name={r.player_name}
          pos={r.position}
          team={r.team ?? ""}
          size="sm"
          // Placeholder rookie picks have no profile to open (mirrors the
          // list/board views, which also leave them non-clickable).
          onClick={r.is_rookie_placeholder ? undefined : () => openPlayerProfile(r.player_id)}
          metaTrailing={
            <span className="flex items-center gap-1.5 tabular-nums">
              <span className="text-muted-foreground">ADP {r.avg_pick.toFixed(1)}</span>
              <span className={cn("font-bold flex items-center gap-0.5", color)}><Arrow className="w-3 h-3" />{Math.abs(trend).toFixed(1)}</span>
            </span>
          }
        />
      </div>
    </div>
  );
}

/**
 * "Biggest 7-day ADP movers" panel — top risers and fallers by 7-day ADP trend
 * within the current slice. Styled to match the trade database's "Most Traded
 * Players" card. Shared by the Draft Availability Matrix and the ADP Explorer
 * (both startup and rookie drafts). Returns null when no eligible movers exist.
 *
 * In rookie mode the slice is entirely rookies/rookie-pick placeholders, so we
 * keep placeholder rows (the startup view excludes them, since there they're
 * just stand-ins with no real startup ADP).
 *
 * Window: prefers 7-day movement, but falls back to the 30-day window when the
 * 7-day window surfaces nothing. Rookie drafts cluster seasonally rather than
 * running daily like startups, so a rolling 7-day trend is frequently empty for
 * them — the 30-day fallback keeps this section populated on the Rookie Drafts
 * tab. (Startups always have 7-day movers, so their window is unchanged.)
 */
export function MoversPanel({ rows, teams, totalDrafts, mode = "startup" }: { rows: ADPResult[]; teams: number; totalDrafts: number | null; mode?: "startup" | "rookie" }) {
  const { risers, fallers, windowDays } = useMemo(() => {
    const depthCap = teams * MOVERS_DEPTH_ROUNDS;
    const minPresence = totalDrafts ? totalDrafts * MOVERS_MIN_PRESENCE : 0;
    const eligible = (r: ADPResult) =>
      (mode === "rookie" || !r.is_rookie_placeholder) &&
      r.overall_rank <= depthCap &&
      r.draft_count >= minPresence;

    const pickMovers = (trendOf: (r: ADPResult) => number) => {
      const moved = rows.filter((r) => eligible(r) && trendOf(r) !== 0);
      return {
        risers: [...moved].filter((r) => trendOf(r) < 0).sort((a, b) => trendOf(a) - trendOf(b)).slice(0, 5),
        fallers: [...moved].filter((r) => trendOf(r) > 0).sort((a, b) => trendOf(b) - trendOf(a)).slice(0, 5),
      };
    };

    const sevenDay = pickMovers((r) => r.trend_7d);
    if (sevenDay.risers.length || sevenDay.fallers.length) {
      return { ...sevenDay, windowDays: 7 as const };
    }
    // Nothing moved in the last 7 days — widen to 30 (mainly the rookie case).
    return { ...pickMovers((r) => r.trend_30d), windowDays: 30 as const };
  }, [rows, teams, totalDrafts, mode]);
  if (!risers.length && !fallers.length) return null;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3" data-testid="adp-movers">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-[#d4af37]" />
        <h3 className="text-sm font-semibold">Biggest ADP movers</h3>
        <span className="text-xs text-muted-foreground">· past {windowDays} days</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark-any:text-emerald-400 mb-1">Risers</p>
          {risers.length ? risers.map((r, i) => <MoverRow key={r.player_id} r={r} i={i} dir="up" windowDays={windowDays} />) : <p className="text-[11px] text-muted-foreground py-1">No risers.</p>}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark-any:text-rose-400 mb-1">Fallers</p>
          {fallers.length ? fallers.map((r, i) => <MoverRow key={r.player_id} r={r} i={i} dir="down" windowDays={windowDays} />) : <p className="text-[11px] text-muted-foreground py-1">No fallers.</p>}
        </div>
      </div>
    </div>
  );
}
