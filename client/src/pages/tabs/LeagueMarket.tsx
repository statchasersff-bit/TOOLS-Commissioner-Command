import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import type { League } from "@/types";
import { cn } from "@/lib/utils";

interface MarketProps {
  league: League;
}

export function PositionalSurplus({ league }: MarketProps) {
  const positions = ["QB", "RB", "WR", "TE"] as const;

  const posData = positions.map((pos) => {
    const metricKey = pos.toLowerCase() as "qb" | "rb" | "wr" | "te";
    const avg = Math.round(league.teams.reduce((s, t) => s + t.metrics[metricKey], 0) / league.teams.length);
    const surplus = league.teams
      .filter((t) => t.metrics[metricKey] > avg + 10)
      .sort((a, b) => b.metrics[metricKey] - a.metrics[metricKey]);
    const needy = league.teams
      .filter((t) => t.metrics[metricKey] < avg - 10)
      .sort((a, b) => a.metrics[metricKey] - b.metrics[metricKey]);
    return { pos, avg, surplus, needy };
  });

  return (
    <div className="space-y-8">
      <SectionHeader title="Positional Surplus" subtitle="Who has too much -- and who needs help" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {posData.map(({ pos, avg, surplus, needy }) => (
          <Card key={pos} className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">{pos}</h3>
              <span className="text-xs text-muted-foreground font-medium">Avg: {avg}</span>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2">Surplus Teams</p>
                <div className="flex flex-wrap gap-1.5">
                  {surplus.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                  {surplus.map((t) => (
                    <Badge key={t.id} variant="secondary" className="text-xs">
                      {t.owner} ({t.metrics[pos.toLowerCase() as "qb" | "rb" | "wr" | "te"]})
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">Needy Teams</p>
                <div className="flex flex-wrap gap-1.5">
                  {needy.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                  {needy.map((t) => (
                    <Badge key={t.id} variant="outline" className="text-xs">
                      {t.owner} ({t.metrics[pos.toLowerCase() as "qb" | "rb" | "wr" | "te"]})
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function MarketValue({ league }: MarketProps) {
  const positions = ["QB", "RB", "WR", "TE"] as const;

  const scarcityData = positions.map((pos) => {
    const metricKey = pos.toLowerCase() as "qb" | "rb" | "wr" | "te";
    const scores = league.teams.map((t) => t.metrics[metricKey]);
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
    const stdDev = Math.sqrt(scores.reduce((s, v) => s + (v - avg) ** 2, 0) / scores.length);
    const belowAvg = scores.filter((s) => s < avg - 5).length;
    const scarcity: "High" | "Medium" | "Low" = belowAvg >= 5 ? "High" : belowAvg >= 3 ? "Medium" : "Low";
    return { pos, avg, stdDev: Math.round(stdDev), scarcity, belowAvg };
  });

  const insights = scarcityData
    .filter((d) => d.scarcity === "High")
    .map((d) => `${d.pos} scarcity is high with ${d.belowAvg} teams below average -- expect higher trade costs for ${d.pos}.`);

  if (insights.length === 0) {
    insights.push("No positions show extreme scarcity -- the market is relatively balanced.");
  }

  return (
    <div className="space-y-8">
      <SectionHeader title="Market Value" subtitle="Positional scarcity indicators across the league" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {scarcityData.map((d) => (
          <Card key={d.pos} className="p-5 hover-elevate text-center">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{d.pos}</p>
            <p className="text-2xl font-bold mt-1.5">{d.avg}</p>
            <Badge
              variant={d.scarcity === "High" ? "destructive" : d.scarcity === "Medium" ? "secondary" : "outline"}
              className="mt-2.5"
            >
              {d.scarcity} Scarcity
            </Badge>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h3 className="text-base font-bold mb-4 flex items-center gap-2">
          Market Insights
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full" />
        </h3>
        <div className="space-y-3">
          {insights.map((text, i) => (
            <InsightCallout key={i} text={text} type={text.includes("high") || text.includes("High") ? "negative" : "neutral"} />
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-base font-bold mb-4">Scarcity Breakdown</h3>
        <div className="space-y-4">
          {scarcityData.map((d) => (
            <div key={d.pos} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">{d.pos}</span>
                <span className="text-muted-foreground">{d.belowAvg} teams below avg</span>
              </div>
              <div className="h-3.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    d.scarcity === "High" ? "bg-red-500" :
                    d.scarcity === "Medium" ? "bg-amber-500" :
                    "bg-emerald-500"
                  )}
                  style={{ width: `${(d.belowAvg / league.teams.length) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
