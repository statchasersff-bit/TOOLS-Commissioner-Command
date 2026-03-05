import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useValueModel } from "@/contexts/ValueModelContext";
import { HelpCircle, Loader2 } from "lucide-react";
import type { ValueSourceId } from "@/types";

export function ValueSourceSelector() {
  const { sourceId, sources, setSourceId, isLoading } = useValueModel();
  const activeSource = sources.find((s) => s.id === sourceId);

  return (
    <div className="flex items-center gap-1">
      <Select value={sourceId} onValueChange={(v) => setSourceId(v as ValueSourceId)}>
        <SelectTrigger className="w-[180px] text-sm rounded-full border-[#0b3a7a]/20 dark:border-blue-400/20 hover:border-[#d4af37] transition-colors" data-testid="select-value-source">
          <div className="flex items-center gap-2">
            {isLoading && <Loader2 className="w-3 h-3 animate-spin text-[#d4af37]" />}
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
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">Soon</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {activeSource && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0" data-testid="tooltip-value-source">
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[260px]">
            <p className="text-xs leading-relaxed">{activeSource.description}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function ValueAttribution() {
  const { sourceId, isLoading, isSnapshot, unmatchedCount } = useValueModel();

  if (sourceId !== "fantasycalc") return null;

  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground" data-testid="text-value-attribution">
      {isLoading ? (
        <span className="flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin text-[#d4af37]" />
          Loading FantasyCalc values…
        </span>
      ) : (
        <>
          <span>
            Values provided by{" "}
            <a
              href="https://fantasycalc.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#d4af37] transition-colors"
              data-testid="link-fantasycalc-attribution"
            >
              FantasyCalc.com
            </a>
          </span>
          {isSnapshot && (
            <span className="bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded text-[9px] font-medium" data-testid="badge-snapshot-warning">
              Snapshot (dev)
            </span>
          )}
          {unmatchedCount > 0 && (
            <span className="bg-orange-500/15 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded text-[9px] font-medium" data-testid="badge-unmatched-warning">
              {unmatchedCount} unmapped
            </span>
          )}
        </>
      )}
    </div>
  );
}
