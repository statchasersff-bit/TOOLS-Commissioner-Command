import { ExternalLink, TrendingUp, BookOpen, BarChart3 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";

const TOOLS = [
  {
    id: "rookie-hit-rates",
    label: "Rookie Hit Rates",
    description: "Analysis of NFL rookies from 2017–2025 — which draft slots actually produced dynasty-relevant players, broken down by position and round.",
    url: "https://statchasers.com/rookie-hit-rates/",
    icon: TrendingUp,
    accent: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40",
    iconColor: "text-emerald-500",
    tag: "Historical · 2017–2025",
  },
  {
    id: "rookie-guide",
    label: "2026 Rookie Draft Guide",
    description: "Comprehensive scouting guide for the 2026 rookie class — rankings, dynasty outlook, and value tiers for every key prospect entering the NFL.",
    url: "https://statchasers.com/rookie-guide/",
    icon: BookOpen,
    accent: "from-[#0b3a7a]/10 to-[#0b3a7a]/5 border-[#0b3a7a]/30 hover:border-[#d4af37]/40",
    iconColor: "text-[#d4af37]",
    tag: "2026 Class",
  },
  {
    id: "performance-analytics",
    label: "Advanced Player Stats",
    description: "Deep-dive performance analytics powered by advanced metrics — target share, air yards, opportunity rates, and efficiency scores across the league.",
    url: "https://statchasers.com/performance-analytics/",
    icon: BarChart3,
    accent: "from-purple-500/10 to-purple-500/5 border-purple-500/20 hover:border-purple-500/40",
    iconColor: "text-purple-400",
    tag: "Advanced Metrics",
  },
];

export default function Analysis() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Analysis Tools"
        subtitle="Deep research and advanced analytics from StatChasers"
      />

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <a
              key={tool.id}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`link-analysis-${tool.id}`}
              className={cn(
                "group relative flex flex-col rounded-xl border bg-gradient-to-br p-5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
                tool.accent
              )}
            >
              {/* Tag */}
              <span className="mb-3 inline-flex w-fit items-center rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/40">
                {tool.tag}
              </span>

              {/* Icon + title row */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className={cn("mt-0.5 rounded-lg bg-background/50 p-2 ring-1 ring-border/40", tool.iconColor)}>
                  <Icon className="w-5 h-5" />
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0 mt-1" />
              </div>

              <h3 className="text-sm font-bold text-foreground mb-1.5 leading-snug">{tool.label}</h3>
              <p className="text-[12px] text-muted-foreground leading-relaxed flex-1">{tool.description}</p>

              <div className="mt-4 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
                Open tool
                <ExternalLink className="w-3 h-3" />
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
