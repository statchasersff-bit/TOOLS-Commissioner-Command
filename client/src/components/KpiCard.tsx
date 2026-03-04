import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function KpiCard({ label, value, icon: Icon, subtitle, trend, className }: KpiCardProps) {
  return (
    <Card className={cn("p-4 hover-elevate", className)} data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
            {label}
          </p>
          <p className="text-2xl font-bold mt-1 text-foreground">{value}</p>
          {subtitle && (
            <p className={cn(
              "text-xs mt-1",
              trend === "up" ? "text-emerald-600 dark:text-emerald-400" :
              trend === "down" ? "text-red-600 dark:text-red-400" :
              "text-muted-foreground"
            )}>
              {subtitle}
            </p>
          )}
        </div>
        {Icon && (
          <div className="p-2 rounded-md bg-[#0b3a7a]/10 dark:bg-blue-500/10 flex-shrink-0">
            <Icon className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
          </div>
        )}
      </div>
    </Card>
  );
}
