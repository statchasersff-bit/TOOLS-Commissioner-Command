import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useValueModel } from "@/contexts/ValueModelContext";
import { HelpCircle, Loader2, BarChart3 } from "lucide-react";
import type { ValueSourceId } from "@/types";

export function ValueSourceSelector() {
  const { sourceId, sources, setSourceId, isLoading } = useValueModel();
  const activeSource = sources.find((s) => s.id === sourceId);

  return (
    <div className="flex items-center gap-1.5">
      {sourceId === "fantasycalc" && (
        <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#0b3a7a] dark:text-blue-300 bg-[#0b3a7a]/8 dark:bg-blue-400/12 px-2 py-1 rounded-full border border-[#0b3a7a]/10 dark:border-blue-400/15" data-testid="badge-fantasycalc">
          <BarChart3 className="w-2.5 h-2.5" />
          FC
        </span>
      )}
      <Select value={sourceId} onValueChange={(v) => setSourceId(v as ValueSourceId)}>
        <SelectTrigger className="w-[170px] h-9 text-sm rounded-full border-[#0b3a7a]/30 dark:border-blue-400/25 bg-background hover:border-[#d4af37] dark:hover:border-[#d4af37] focus:ring-[#d4af37]/30 transition-all duration-200" data-testid="select-value-source">
          <div className="flex items-center gap-2">
            {isLoading && <Loader2 className="w-3 h-3 animate-spin text-[#d4af37] flex-shrink-0" />}
            <SelectValue placeholder="Value Source" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {sources.map((source) => (
            <SelectItem
              key={source.id}
              value={source.id}
              disabled={!source.active}
              data-testid={`value-source-${source.id}`}
            >
              <span className="flex items-center gap-2">
                {source.label}
                {!source.active && (
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full font-medium">Soon</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {activeSource && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="text-muted-foreground/40 hover:text-[#d4af37] transition-colors flex-shrink-0 p-0.5" data-testid="tooltip-value-source">
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-[280px] p-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-[#0b3a7a] dark:text-blue-400" />
                <span className="text-xs font-semibold">{activeSource.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{activeSource.description}</p>
              {sourceId === "fantasycalc" && (
                <a
                  href="https://fantasycalc.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-[10px] font-medium text-[#0b3a7a] dark:text-blue-400 hover:text-[#d4af37] transition-colors"
                >
                  Visit FantasyCalc.com &rarr;
                </a>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function formatValuesDate(iso: string): string {
  if (!iso || iso === "snapshot" || iso === "fetch-failed") return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export function ValueAttribution() {
  const { sourceId, isLoading, unmatchedCount, diagnostics } = useValueModel();

  if (sourceId !== "fantasycalc") return null;

  const dateStr = formatValuesDate(diagnostics.updatedAt);

  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground" data-testid="text-value-attribution">
      {isLoading ? (
        <span className="flex items-center gap-1.5 text-muted-foreground/70">
          <Loader2 className="w-3 h-3 animate-spin text-[#d4af37]" />
          Loading values…
        </span>
      ) : (
        <>
          <span>
            Values sourced from{" "}
            <a
              href="https://fantasycalc.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-[#d4af37]/30 underline-offset-2 hover:text-[#d4af37] hover:decoration-[#d4af37] transition-colors"
              data-testid="link-fantasycalc-attribution"
            >
              FantasyCalc.com
            </a>
            {dateStr && <> · Updated {dateStr}</>}
          </span>
          {unmatchedCount > 0 && (
            <span className="bg-orange-500/12 text-orange-700 dark:text-orange-400 border border-orange-500/15 dark:border-orange-400/20 px-1.5 py-0.5 rounded-full text-[9px] font-semibold" data-testid="badge-unmatched-warning">
              {unmatchedCount} unmapped
            </span>
          )}
        </>
      )}
    </div>
  );
}
