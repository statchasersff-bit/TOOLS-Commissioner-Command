import { cn } from "@/lib/utils";
import {
  PROJECTION_SOURCES,
  type ProjectionSource,
  type ProjectionSourceName,
} from "@/data/mockStartSitProjections";

interface Props {
  projections: ProjectionSource[];
  /** If provided, the projection >= bestValue is highlighted in gold. */
  bestValue?: number | null;
  className?: string;
}

const SOURCE_LABEL: Record<ProjectionSourceName, string> = {
  StatChasers: "StatChasers",
  Sleeper: "Sleeper",
  FanDuel: "FanDuel",
  DraftKings: "DraftKings",
  "CBS Sports": "CBS",
};

export function ProjectionSourceRows({ projections, bestValue, className }: Props) {
  // Ensure consistent order even if backend omits sources.
  const ordered: Array<{
    source: ProjectionSourceName;
    projectedPoints: number | null;
    rank?: number;
  }> = PROJECTION_SOURCES.map((src) => {
    const found = projections.find((p) => p.source === src);
    return {
      source: src,
      projectedPoints: found?.projectedPoints ?? null,
      rank: found?.rank,
    };
  });

  return (
    <div className={cn("divide-y divide-white/[0.04]", className)}>
      {ordered.map((row) => {
        const isBest =
          bestValue != null &&
          row.projectedPoints != null &&
          row.projectedPoints >= bestValue;
        return (
          <div
            key={row.source}
            className="flex items-center justify-between py-1.5 text-[11px]"
            data-testid={`projection-row-${row.source.toLowerCase().replace(/\s/g, "-")}`}
          >
            <span className="text-white/55 font-medium">{SOURCE_LABEL[row.source]}</span>
            <span
              className={cn(
                "font-bold tabular-nums",
                row.projectedPoints == null
                  ? "text-white/25"
                  : isBest
                    ? "text-[#d4af37]"
                    : "text-white",
              )}
              title={row.projectedPoints == null ? "Projection data coming soon for this source." : undefined}
            >
              {row.projectedPoints == null ? "—" : row.projectedPoints.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
