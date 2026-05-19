import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ProjectionSourceRows } from "./ProjectionSourceRows";
import { StartSitRecommendationBadge } from "./StartSitRecommendationBadge";
import type { MockPlayerWeekly } from "@/data/mockStartSitProjections";
import type { StartSitRecommendation } from "@/lib/startSit";

interface Props {
  player: MockPlayerWeekly;
  averageProjection: number | null;
  highProjection: number | null;
  lowProjection: number | null;
  projectionRange: number | null;
  recommendation: StartSitRecommendation;
  confidence: number;
  bestStart?: boolean;
  onOpen: () => void;
  onRemove: () => void;
}

export function StartSitPlayerCard({
  player,
  averageProjection,
  highProjection,
  lowProjection,
  recommendation,
  confidence,
  bestStart = false,
  onOpen,
  onRemove,
}: Props) {
  const confidenceColor =
    confidence >= 70 ? "text-emerald-300" : confidence >= 45 ? "text-[#d4af37]" : "text-rose-300";

  return (
    <div
      className={cn(
        "relative rounded-2xl border p-4 md:p-5 cursor-pointer transition-all overflow-hidden",
        "bg-gradient-to-b from-[#0a1628] to-[#06101e] hover:from-[#0b1a30] hover:to-[#08121f]",
        bestStart
          ? "border-[#d4af37]/45 shadow-[0_0_24px_rgba(212,175,55,0.18)]"
          : "border-white/8 hover:border-white/15",
      )}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-testid={`start-sit-card-${player.playerId}`}
    >
      {/* Remove button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/[0.04] hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 flex items-center justify-center text-white/40 hover:text-rose-300 transition-colors z-10"
        aria-label={`Remove ${player.name}`}
        data-testid={`button-remove-${player.playerId}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 pr-8">
        <PlayerAvatar
          id={player.playerId}
          name={player.name}
          pos={player.position}
          team={player.team}
          size="md"
          compact
        />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-white truncate" data-testid={`player-name-${player.playerId}`}>
            {player.name}
          </div>
          <div className="text-[11px] text-white/55 mt-0.5">
            {player.position} · {player.team} {player.matchup.opponent}
          </div>
          <div className="text-[10px] text-white/35 mt-0.5">
            {player.matchup.gameTime ?? "Game time TBD"}
          </div>
        </div>
      </div>

      {/* Recommendation + confidence */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <StartSitRecommendationBadge
          recommendation={recommendation}
          size="md"
          bestStart={bestStart}
        />
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider text-white/35">Confidence</div>
          <div className={cn("text-[15px] font-black tabular-nums", confidenceColor)}>
            {confidence}%
          </div>
        </div>
      </div>

      {/* Average projection hero */}
      <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 flex items-end justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-white/35 mb-0.5">Average projection</div>
          <div className="text-[28px] font-black tabular-nums text-white leading-none">
            {averageProjection == null ? "—" : averageProjection.toFixed(1)}
          </div>
        </div>
        <div className="text-right text-[10px] text-white/50">
          <div>
            <span className="text-white/35">Low</span>{" "}
            <span className="tabular-nums">{lowProjection == null ? "—" : lowProjection.toFixed(1)}</span>
          </div>
          <div className="mt-0.5">
            <span className="text-white/35">High</span>{" "}
            <span className="tabular-nums">{highProjection == null ? "—" : highProjection.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* Source rows */}
      <div className="mt-3">
        <div className="text-[9px] uppercase tracking-wider text-white/30 mb-1">Sources</div>
        <ProjectionSourceRows
          projections={player.projections}
          bestValue={highProjection ?? undefined}
        />
      </div>
    </div>
  );
}
