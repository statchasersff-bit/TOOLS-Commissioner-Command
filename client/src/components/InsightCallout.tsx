import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Info } from "lucide-react";
import type { InsightType } from "../types";

interface InsightCalloutProps {
  text: string;
  type: InsightType;
  className?: string;
}

export function InsightCallout({ text, type, className }: InsightCalloutProps) {
  const Icon = type === "positive" ? TrendingUp : type === "negative" ? TrendingDown : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-md border transition-colors",
        type === "positive" && "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30",
        type === "negative" && "bg-red-50/50 dark:bg-red-950/20 border-red-200/50 dark:border-red-800/30",
        type === "neutral" && "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/30",
        className
      )}
      data-testid="insight-callout"
    >
      <div className={cn(
        "mt-0.5 flex-shrink-0",
        type === "positive" && "text-emerald-600 dark:text-emerald-400",
        type === "negative" && "text-red-600 dark:text-red-400",
        type === "neutral" && "text-blue-600 dark:text-blue-400",
      )}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-sm text-foreground leading-relaxed">{text}</p>
    </div>
  );
}
