import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/SectionHeader";
import { getLeagueTeamTiers, getTierColor, getTierEmoji, computeNowScore, computeFutureScore, getDynastyWindowLabel as getQuadrantLabel } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import type { League, Team, Tier } from "@/types";
import { formatPickLabel } from "@/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Label
} from "recharts";


interface QuadrantTeam {
  team: Team;
  now: number;
  future: number;
  tier: Tier;
  redRank: number;
  dynRank: number;
  pcksRank: number;
}

function getQuadrantColor(now: number, future: number, avgNow: number, avgFuture: number): string {
  if (now >= avgNow && future >= avgFuture) return "#d4af37";
  if (now >= avgNow && future < avgFuture) return "#ef4444";
  if (now < avgNow && future >= avgFuture) return "#10b981";
  return "#64748b";
}

function DynastyWindowTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#0a1628] border border-[#1e3a5f] rounded-lg px-3 py-2 shadow-xl text-xs" data-testid="scatter-tooltip">
      <p className="font-bold text-white mb-1">{d.teamName}</p>
      <div className="space-y-0.5 text-slate-300">
        <p>RED Rank: <span className="font-semibold text-white">{d.redRank}</span></p>
        <p>DYN Rank: <span className="font-semibold text-white">{d.dynRank}</span></p>
        <p>PCKS Rank: <span className="font-semibold text-white">{d.pcksRank}</span></p>
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-[#1e3a5f]">
        <p className="text-slate-400">Tier: <span className="font-semibold text-white">{d.tier}</span></p>
        <p className="text-slate-400">Quadrant: <span className="font-semibold text-white">{d.quadrant}</span></p>
      </div>
    </div>
  );
}

function EconomyOverview({ league }: { league: League }) {
  const { getPickValue } = useValueModel();
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);

  const quadrantTeams: QuadrantTeam[] = useMemo(() => {
    const byRedraft = [...league.teams].sort((a, b) => (b.metrics?.starters ?? 0) - (a.metrics?.starters ?? 0));
    const byDynasty = [...league.teams].sort((a, b) => (b.metrics?.depth ?? 0) - (a.metrics?.depth ?? 0));
    const byDraft = [...league.teams].sort((a, b) => (b.metrics?.picks ?? 0) - (a.metrics?.picks ?? 0));
    return league.teams.map(team => ({
      team,
      now: computeNowScore(league.teams, team),
      future: computeFutureScore(league.teams, team),
      tier: tierMap.get(team.id)?.tier ?? "Balanced",
      redRank: byRedraft.findIndex(t => t.id === team.id) + 1,
      dynRank: byDynasty.findIndex(t => t.id === team.id) + 1,
      pcksRank: byDraft.findIndex(t => t.id === team.id) + 1,
    }));
  }, [league.teams, tierMap]);


  const avgNow = useMemo(() => {
    const sum = quadrantTeams.reduce((s, t) => s + t.now, 0);
    return quadrantTeams.length > 0 ? sum / quadrantTeams.length : 50;
  }, [quadrantTeams]);

  const avgFuture = useMemo(() => {
    const sum = quadrantTeams.reduce((s, t) => s + t.future, 0);
    return quadrantTeams.length > 0 ? sum / quadrantTeams.length : 50;
  }, [quadrantTeams]);

  const scatterData = useMemo(() =>
    quadrantTeams.map(qt => ({
      x: qt.now,
      y: qt.future,
      teamName: qt.team.owner,
      avatar: qt.team.avatar || null,
      tier: qt.tier,
      redRank: qt.redRank,
      dynRank: qt.dynRank,
      pcksRank: qt.pcksRank,
      quadrant: getQuadrantLabel(qt.now, qt.future, avgNow, avgFuture),
      fill: getQuadrantColor(qt.now, qt.future, avgNow, avgFuture),
    })),
    [quadrantTeams, avgNow, avgFuture]
  );

  const pickData = useMemo(() => {
    const data = league.teams.map(team => {
      const firstRounds = team.picks.filter(p => p.round === 1);
      const totalValue = team.picks.reduce((sum, p) => sum + (getPickValue(p) || p.value), 0);
      const bestPick = [...team.picks].sort((a, b) => (getPickValue(b) || b.value) - (getPickValue(a) || a.value))[0];
      return { team, firstCount: firstRounds.length, totalValue, bestPick, pickCount: team.picks.length };
    });
    const leagueTotal = data.reduce((s, d) => s + d.totalValue, 0);
    const sorted = [...data].sort((a, b) => b.totalValue - a.totalValue);
    const q75 = sorted[Math.floor(sorted.length * 0.25)]?.totalValue ?? 0;
    const q25 = sorted[Math.floor(sorted.length * 0.75)]?.totalValue ?? 0;
    return sorted.map(d => ({
      ...d,
      leaguePct: leagueTotal > 0 ? Math.round((d.totalValue / leagueTotal) * 100) : 0,
      ammo: d.totalValue >= q75 ? "Loaded" as const : d.totalValue <= q25 ? "Dry" as const : "Average" as const,
    }));
  }, [league.teams, getPickValue]);

  const ammoColor = (ammo: "Loaded" | "Average" | "Dry") => {
    switch (ammo) {
      case "Loaded": return "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700";
      case "Average": return "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700";
      case "Dry": return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-foreground">Dynasty Window</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Where each team sits in the win-now vs future value spectrum</p>
      </div>

      <Card className="p-4 md:p-6 rounded-2xl bg-[#0a1628] border-[#1e3a5f]" data-testid="dynasty-window-chart">
        <div className="h-[300px] md:h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 36, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" strokeOpacity={0.5} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 100]}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              tickLine={{ stroke: "#334155" }}
              axisLine={{ stroke: "#334155" }}
            >
              <Label value="Current Power →" position="insideBottom" offset={-18} style={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} />
            </XAxis>
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 100]}
              width={56}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              tickLine={{ stroke: "#334155" }}
              axisLine={{ stroke: "#334155" }}
            >
              <Label value="Future Strength →" angle={-90} position="insideLeft" offset={10} style={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600, textAnchor: "middle" }} />
            </YAxis>
            <ReferenceArea x1={avgNow} x2={100} y1={avgFuture} y2={100} fill="#d4af37" fillOpacity={0.07} />
            <ReferenceArea x1={avgNow} x2={100} y1={0} y2={avgFuture} fill="#ef4444" fillOpacity={0.06} />
            <ReferenceArea x1={0} x2={avgNow} y1={avgFuture} y2={100} fill="#10b981" fillOpacity={0.06} />
            <ReferenceArea x1={0} x2={avgNow} y1={0} y2={avgFuture} fill="#64748b" fillOpacity={0.05} />
            <ReferenceLine x={avgNow} stroke="#d4af37" strokeOpacity={0.35} strokeDasharray="6 4" />
            <ReferenceLine y={avgFuture} stroke="#d4af37" strokeOpacity={0.35} strokeDasharray="6 4" />
            <RechartsTooltip content={<DynastyWindowTooltip />} cursor={false} />
            <Scatter
              data={scatterData}
              nameKey="teamName"
              shape={(props: any) => {
                const { cx, cy, payload } = props;
                const r = 16;
                const clipId = `avatar-clip-${cx}-${cy}`;
                if (payload.avatar) {
                  return (
                    <g style={{ cursor: "pointer" }}>
                      <defs>
                        <clipPath id={clipId}>
                          <circle cx={cx} cy={cy} r={r - 1.5} />
                        </clipPath>
                      </defs>
                      <circle cx={cx} cy={cy} r={r} fill={payload.fill} stroke={payload.fill} strokeWidth={2.5} />
                      <image
                        href={payload.avatar}
                        x={cx - r + 1.5}
                        y={cy - r + 1.5}
                        width={(r - 1.5) * 2}
                        height={(r - 1.5) * 2}
                        clipPath={`url(#${clipId})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </g>
                  );
                }
                return (
                  <g style={{ cursor: "pointer" }}>
                    <circle cx={cx} cy={cy} r={r} fill={payload.fill} stroke={payload.fill} strokeWidth={2.5} fillOpacity={0.25} />
                    <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={10} fontWeight={700}>
                      {(payload.teamName || "?").slice(0, 2).toUpperCase()}
                    </text>
                  </g>
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="text-center py-1.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20">
            <span className="text-[10px] text-emerald-400 font-semibold">↑ Rebuild With Ammo</span>
          </div>
          <div className="text-center py-1.5 rounded-lg bg-[#d4af37]/10 border border-[#d4af37]/20">
            <span className="text-[10px] text-[#d4af37] font-semibold">↗ Dynasty Death Star</span>
          </div>
          <div className="text-center py-1.5 rounded-lg bg-[#64748b]/10 border border-[#64748b]/20">
            <span className="text-[10px] text-slate-400 font-semibold">↙ Rebuild Hell</span>
          </div>
          <div className="text-center py-1.5 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20">
            <span className="text-[10px] text-red-400 font-semibold">→ Win-Now Kings</span>
          </div>
        </div>
      </Card>

      <div>
        <h3 className="text-base font-bold text-foreground">Pick Inventory</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">Draft capital distribution across the league</p>
      </div>

      <Card className="rounded-2xl overflow-hidden" data-testid="pick-concentration-table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Team</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">1sts (3yr)</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Total Picks</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Pick Value</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">% of League</th>
                <th className="text-left p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Best Pick</th>
                <th className="text-center p-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Ammo</th>
              </tr>
            </thead>
            <tbody>
              {pickData.map((d, i) => (
                <tr key={d.team.id} className={`border-b border-border/50 ${i % 2 === 0 ? "" : "bg-muted/10"}`} data-testid={`pick-row-${d.team.id}`}>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {d.team.avatar ? (
                        <img
                          src={d.team.avatar}
                          alt={d.team.owner}
                          className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                          data-testid={`img-avatar-pick-${d.team.id}`}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center text-[10px] font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0"
                          data-testid={`img-avatar-pick-${d.team.id}`}
                        >
                          {(d.team.owner || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-bold text-sm leading-tight">{d.team.name}</div>
                        <div className="text-[11px] text-muted-foreground leading-tight">{d.team.owner}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-center font-bold">{d.firstCount}</td>
                  <td className="p-3 text-center">{d.pickCount}</td>
                  <td className="p-3 text-center font-mono text-xs">{d.totalValue.toLocaleString()}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-[#d4af37] rounded-full" style={{ width: `${d.leaguePct * 3}%` }} />
                      </div>
                      <span className="text-xs font-bold text-[#d4af37] w-7 text-right">{d.leaguePct}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-xs">
                    {d.bestPick ? formatPickLabel(d.bestPick) : "N/A"}
                  </td>
                  <td className="p-3 text-center">
                    <Badge variant="outline" className={`text-[10px] ${ammoColor(d.ammo)}`}>{d.ammo}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function LeagueEconomy({ league }: { league: League }) {
  return (
    <div className="space-y-8">
      <SectionHeader title="League Economy" subtitle="League-wide economic dynamics: power distribution, draft capital, and trade market health" />
      <EconomyOverview league={league} />
    </div>
  );
}
