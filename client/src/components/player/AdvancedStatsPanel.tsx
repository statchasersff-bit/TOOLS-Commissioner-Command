/**
 * AdvancedStatsPanel — a player's raw advanced stats, grouped by the same
 * section families (with accent bars) used across the Position Stats tab.
 */
import {
  type StatPosition,
  type ColDef,
  groupColumns,
  formatVal,
  SECTION_BAR_GRADIENT,
} from "@/lib/advancedStatsMeta";

export function AdvancedStatsPanel({
  position,
  columns,
  row,
}: {
  position: StatPosition;
  columns: ColDef[];
  row: Record<string, unknown>;
}) {
  // Composite grades aren't part of the raw pool columns, but guard anyway.
  const groups = groupColumns(position, columns).filter((g) => g.label !== "Composite Grades");

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.label} className="rounded-xl overflow-hidden border border-white/8">
          {/* Section header bar with coloured left accent */}
          <div
            className="flex items-center px-3 py-2"
            style={{ background: SECTION_BAR_GRADIENT, borderLeft: `3px solid ${g.accent}` }}
          >
            <span
              className="text-[10px] font-extrabold uppercase"
              style={{ color: g.accent, letterSpacing: "0.12em" }}
            >
              {g.label}
            </span>
          </div>
          {/* Stat rows */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 px-3 py-2.5 bg-white/[0.02]">
            {g.cols.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-2 text-xs min-w-0">
                <span className="text-muted-foreground truncate">{c.label}</span>
                <span className="font-mono font-semibold tabular-nums text-foreground/90 flex-shrink-0">
                  {formatVal(row[c.key], c.type)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
