import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useValueModel } from "@/contexts/ValueModelContext";
import { HelpCircle } from "lucide-react";

export function ValueSourceSelector() {
  const { sourceId, sources, setSourceId } = useValueModel();
  const activeSource = sources.find((s) => s.id === sourceId);

  return (
    <div className="flex items-center gap-1">
      <Select value={sourceId} onValueChange={(v) => setSourceId(v as any)}>
        <SelectTrigger className="w-[180px] text-sm rounded-full border-[#0b3a7a]/20 dark:border-blue-400/20 hover:border-[#d4af37] transition-colors" data-testid="select-value-source">
          <SelectValue placeholder="Value Source" />
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
