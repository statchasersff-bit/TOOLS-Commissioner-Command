/**
 * CompositeScoreGrid — a row/grid of composite score tiles (0-100).
 * Reusable wherever a player's composite scores need to be shown.
 */
import type { ScoreCategoryMeta } from "@/lib/advancedStatsMeta";

export function CompositeScoreGrid({
  categories,
  scores,
}: {
  categories: ScoreCategoryMeta[];
  scores: Record<string, number> | null;
}) {
  if (!scores || categories.length === 0) return null;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
      {categories.map((c) => {
        const v = scores[c.key];
        return (
          <div
            key={c.key}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2.5 text-center"
            title={c.description}
          >
            <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 truncate">
              {c.label}
            </p>
            <p className="text-xl sm:text-2xl font-black tabular-nums text-[#d4af37] leading-none">
              {v != null ? v : "—"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
