import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import type { ADPResult } from "@/types/draft";

// Movers are meant to surface meaningful draft-capital shifts, not deep-bench
// news, so we cap by overall rank. We also require a healthy draft presence so
// a thinly-drafted name can't post a phantom trend.
const MOVERS_DEPTH_ROUNDS = 12; // eligible if overall_rank ≤ teams × this (~top 12 rounds)
const MOVERS_MIN_PRESENCE = 0.25; // and drafted in ≥25% of the slice's drafts

function MoverRow({ r, i, dir }: { r: ADPResult; i: number; dir: "up" | "down" }) {
  const Arrow = dir === "up" ? TrendingUp : TrendingDown;
  const color = dir === "up" ? "text-emerald-600 dark-any:text-emerald-400" : "text-rose-600 dark-any:text-rose-400";
  const trend = r.trend_14d;
  // Show prior → recent so the full shift is visible at a glance.
  // "2.4 → 19.0" is immediately legible as "fell from 2.4 to 19.0" and
  // makes implausible data (e.g. prior ADP 2 for a backup QB) self-evident.
  // Fall back to avg_pick on older cached snapshots that lack these fields.
  const recentAdp = r.recent_14d_avg ?? r.avg_pick;
  const priorAdp = r.prior_14d_avg ?? null;
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
          metaTrailing={
            <span className="flex items-center gap-1.5 tabular-nums text-xs">
              {priorAdp != null ? (
                <span className="text-muted-foreground">
                  {priorAdp.toFixed(1)}
                  <span className="mx-0.5 opacity-50">→</span>
                  {recentAdp.toFixed(1)}
                </span>
              ) : (
                <span className="text-muted-foreground">ADP {recentAdp.toFixed(1)}</span>
              )}
              <span className={cn("font-bold flex items-center gap-0.5", color)}>
                <Arrow className="w-3 h-3" />{Math.abs(trend).toFixed(1)}
              </span>
            </span>
          }
        />
      </div>
    </div>
  );
}

/**
 * "Biggest 14-day ADP movers" panel — top risers and fallers by 14-day ADP
 * trend within the current slice. Styled to match the trade database's "Most
 * Traded Players" card. Shared by the Draft Availability Matrix and the ADP
 * Explorer (both startup and rookie drafts). Returns null when no eligible
 * movers exist.
 *
 * In rookie mode the slice is entirely rookies/rookie-pick placeholders, so we
 * keep placeholder rows (the startup view excludes them, since there they're
 * just stand-ins with no real startup ADP).
 *
 * Window: 14-day movement (last 14 days vs. the 30 days before it, computed
 * server-side as trend_14d).
 */
export function MoversPanel({ rows, teams, totalDrafts, mode = "startup" }: { rows: ADPResult[]; teams: number; totalDrafts: number | null; mode?: "startup" | "rookie" }) {
  const { risers, fallers } = useMemo(() => {
    const depthCap = teams * MOVERS_DEPTH_ROUNDS;
    const minPresence = totalDrafts ? totalDrafts * MOVERS_MIN_PRESENCE : 0;
    const eligible = (r: ADPResult) =>
      (mode === "rookie" || !r.is_rookie_placeholder) &&
      r.overall_rank <= depthCap &&
      r.draft_count >= minPresence;

    const moved = rows.filter((r) => eligible(r) && r.trend_14d !== 0);
    return {
      risers: [...moved].filter((r) => r.trend_14d < 0).sort((a, b) => a.trend_14d - b.trend_14d).slice(0, 5),
      fallers: [...moved].filter((r) => r.trend_14d > 0).sort((a, b) => b.trend_14d - a.trend_14d).slice(0, 5),
    };
  }, [rows, teams, totalDrafts, mode]);
  if (!risers.length && !fallers.length) return null;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3" data-testid="adp-movers">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-[#d4af37]" />
        <h3 className="text-sm font-semibold">Biggest ADP movers</h3>
        <span className="text-xs text-muted-foreground">· past 14 days</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark-any:text-emerald-400 mb-1">Risers</p>
          {risers.length ? risers.map((r, i) => <MoverRow key={r.player_id} r={r} i={i} dir="up" />) : <p className="text-[11px] text-muted-foreground py-1">No risers.</p>}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark-any:text-rose-400 mb-1">Fallers</p>
          {fallers.length ? fallers.map((r, i) => <MoverRow key={r.player_id} r={r} i={i} dir="down" />) : <p className="text-[11px] text-muted-foreground py-1">No fallers.</p>}
        </div>
      </div>
    </div>
  );
}
