import { Compass, TrendingUp, TrendingDown, Trophy, Hammer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValueFinderPlayer, ValueFinderSummary } from "@/lib/value-finder/types";
import { getValueSignal } from "@/lib/value-finder/valueFinderScoring";
import { fmtSignedPct, fmtPlayerMeta } from "@/lib/value-finder/format";
import { ValueSignalBadge } from "./ValueSignalBadge";

function SummaryCard({
  icon: Icon,
  label,
  player,
  comparison,
  accent,
  testId,
}: {
  icon: typeof TrendingUp;
  label: string;
  player: ValueFinderPlayer | null;
  /** Which comparison value drives this card's gap %. */
  comparison?: (p: ValueFinderPlayer) => number | undefined;
  accent: string;
  testId: string;
}) {
  const sig = player
    ? getValueSignal({
        marketValue: player.marketValue,
        comparisonValue: comparison ? comparison(player) : player.modelValue,
      })
    : null;

  return (
    <div
      className="rounded-xl border border-border bg-card/40 px-3 py-2.5"
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn("w-3.5 h-3.5", accent)} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {player && sig ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-bold text-foreground truncate">
              {player.playerName}
            </span>
            <span className={cn("text-[13px] font-black tabular-nums", accent)}>
              {fmtSignedPct(sig.gapPercent)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground truncate">
              {fmtPlayerMeta(player.position, player.team, player.age)}
            </span>
            <ValueSignalBadge signal={sig.signal} />
          </div>
        </>
      ) : (
        <span className="text-[12px] text-muted-foreground">Not enough data</span>
      )}
    </div>
  );
}

export function ValueFinderHeader({ summary }: { summary: ValueFinderSummary }) {
  return (
    <div className="rounded-2xl border border-[#d4af37]/20 bg-gradient-to-b from-[#0b3a7a]/[0.1] to-card/40 p-4 md:p-5">
      <div className="flex items-center gap-2">
        <Compass className="w-4 h-4 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" />
        <h1 className="text-base md:text-lg font-black text-foreground">Value Finder</h1>
      </div>
      <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5 mb-2" />
      <p className="text-[12px] md:text-[13px] text-muted-foreground max-w-2xl leading-snug">
        Find buy-low and sell-high dynasty assets by comparing market value against
        production, usage, age, trends, and roster-building fit.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
        <SummaryCard
          icon={TrendingUp}
          label="Best Buy"
          player={summary.bestBuy}
          comparison={(p) => p.modelValue}
          accent="text-emerald-600 dark-any:text-emerald-400"
          testId="vf-summary-best-buy"
        />
        <SummaryCard
          icon={TrendingDown}
          label="Biggest Sell"
          player={summary.biggestSell}
          comparison={(p) => p.modelValue}
          accent="text-red-600 dark-any:text-red-400"
          testId="vf-summary-biggest-sell"
        />
        <SummaryCard
          icon={Trophy}
          label="Best Win-Now Discount"
          player={summary.bestWinNowDiscount}
          comparison={(p) => p.contenderValue}
          accent="text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]"
          testId="vf-summary-win-now"
        />
        <SummaryCard
          icon={Hammer}
          label="Best Rebuild Target"
          player={summary.bestRebuildTarget}
          comparison={(p) => p.rebuilderValue}
          accent="text-sky-600 dark-any:text-sky-400"
          testId="vf-summary-rebuild"
        />
      </div>
    </div>
  );
}

export default ValueFinderHeader;
