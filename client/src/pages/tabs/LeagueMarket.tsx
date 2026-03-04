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
    <div className="space-y-6">
      <SectionHeader title="Positional Surplus" subtitle="Who has too much -- and who needs help" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {posData.map(({ pos, avg, surplus, needy }) => (
          <Card key={pos} className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{pos}</h3>
              <span className="text-xs text-muted-foreground">Avg: {avg}</span>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">Surplus Teams</p>
                <div className="flex flex-wrap gap-1">
                  {surplus.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                  {surplus.map((t) => (
                    <Badge key={t.id} variant="secondary" className="text-xs">
                      {t.owner} ({t.metrics[pos.toLowerCase() as "qb" | "rb" | "wr" | "te"]})
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Needy Teams</p>
                <div className="flex flex-wrap gap-1">
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
    <div className="space-y-6">
      <SectionHeader title="Market Value" subtitle="Positional scarcity indicators across the league" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {scarcityData.map((d) => (
          <Card key={d.pos} className="p-4 hover-elevate text-center">
            <p className="text-xs font-semibold text-muted-foreground uppercase">{d.pos}</p>
            <p className="text-lg font-bold mt-1">{d.avg}</p>
            <Badge
              variant={d.scarcity === "High" ? "destructive" : d.scarcity === "Medium" ? "secondary" : "outline"}
              className="mt-2"
            >
              {d.scarcity} Scarcity
            </Badge>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          Market Insights
          <span className="block h-0.5 w-8 bg-[#d4af37] rounded-full" />
        </h3>
        <div className="space-y-3">
          {insights.map((text, i) => (
            <InsightCallout key={i} text={text} type={text.includes("high") || text.includes("High") ? "negative" : "neutral"} />
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Scarcity Breakdown</h3>
        <div className="space-y-3">
          {scarcityData.map((d) => (
            <div key={d.pos} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{d.pos}</span>
                <span className="text-muted-foreground">{d.belowAvg} teams below avg</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
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
