import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { HelpCircle } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  className?: string;
  loading?: boolean;
  tooltip?: string;
}

export function KpiCard({ label, value, icon: Icon, subtitle, trend, className, loading, tooltip }: KpiCardProps) {
  if (loading) {
    return <KpiCardSkeleton />;
  }

  return (
    <Card className={cn("p-3 sm:p-5 hover-elevate", className)} data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
              {label}
            </p>
            {tooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0" data-testid={`tooltip-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <HelpCircle className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                  <p className="text-xs leading-relaxed">{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="text-2xl font-bold mt-1.5 text-foreground leading-none">{value}</p>
          {subtitle && (
            <p className={cn(
              "text-[10px] sm:text-xs mt-1.5 break-words",
              trend === "up" ? "text-emerald-600 dark:text-emerald-400" :
              trend === "down" ? "text-red-600 dark:text-red-400" :
              "text-muted-foreground"
            )}>
              {subtitle}
            </p>
          )}
        </div>
        {Icon && (
          <div className="p-2.5 rounded-md bg-[#0b3a7a]/8 dark:bg-blue-400/10 flex-shrink-0">
            <Icon className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
          </div>
        )}
      </div>
    </Card>
  );
}

export function KpiCardSkeleton() {
  return (
    <Card className="p-5" data-testid="kpi-skeleton">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-3">
          <div className="h-3 w-20 rounded skeleton-pulse" />
          <div className="h-7 w-16 rounded skeleton-pulse" />
          <div className="h-3 w-24 rounded skeleton-pulse" />
        </div>
        <div className="h-9 w-9 rounded-md skeleton-pulse" />
      </div>
    </Card>
  );
}
