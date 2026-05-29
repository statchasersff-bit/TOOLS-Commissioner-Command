import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/SectionHeader";
import { getLeagueTeamTiers, getTierColor, getTierEmoji, computeNowScore, computeFutureScore, getDynastyWindowLabel as getQuadrantLabel } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useIsMobile } from "@/hooks/use-mobile";
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
    <div className="bg-card border border-border dark-any:bg-[#0a1628] dark-any:border-[#1e3a5f] rounded-lg px-3 py-2 shadow-xl text-xs" data-testid="scatter-tooltip">
      <p className="font-bold text-foreground dark-any:text-white mb-1">{d.teamName}</p>
      <div className="space-y-0.5 text-muted-foreground dark-any:text-slate-300">
        <p>RED Rank: <span className="font-semibold text-foreground dark-any:text-white">{d.redRank}</span></p>
        <p>DYN Rank: <span className="font-semibold text-foreground dark-any:text-white">{d.dynRank}</span></p>
        <p>PCKS Rank: <span className="font-semibold text-foreground dark-any:text-white">{d.pcksRank}</span></p>
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-border dark-any:border-[#1e3a5f]">
        <p className="text-muted-foreground dark-any:text-slate-400">Tier: <span className="font-semibold text-foreground dark-any:text-white">{d.tier}</span></p>
        <p className="text-muted-foreground dark-any:text-slate-400">Quadrant: <span className="font-semibold text-foreground dark-any:text-white">{d.quadrant}</span></p>
      </div>
    </div>
  );
}

function EconomyOverview({ league }: { league: League }) {
  const { getPickValue } = useValueModel();
  const tierMap = useMemo(() => getLeagueTeamTiers(league.teams), [league.teams]);
  const isMobile = useIsMobile();

  // Recharts colors are SVG attributes, so they can't use `dark:`/`dark-any:`
  // Tailwind variants — derive the axis/grid palette from the active theme.
  // Only the true "light" theme is light; x-mode / dark / my_team are all dark.
  const { themeMode } = useTheme();
  const isLight = themeMode === "light";
  const chartPalette = isLight
    ? { grid: "#cbd5e1", axisTick: "#475569", axisLine: "#cbd5e1", label: "#475569" }
    : { grid: "#1e3a5f", axisTick: "#94a3b8", axisLine: "#334155", label: "#94a3b8" };

  // Mobile-specific chart geometry. The default recharts margins (especially
  // bottom: 36, left: 16) plus the 56px YAxis width steal ~90px from the plot
  // area on a 375px viewport. Tightening these on mobile lets the data points
  // use the card's full width while still leaving room for the axis labels.
  const chartMargin = isMobile
    ? { top: 8, right: 8, bottom: 22, left: 0 }
    : { top: 20, right: 20, bottom: 36, left: 16 };
  const yAxisWidth = isMobile ? 32 : 56;
  const axisFontSize = isMobile ? 10 : 11;
  const xLabelOffset = isMobile ? -8 : -18;
  const yLabelOffset = isMobile ? 4 : 10;
  const axisTickCount = isMobile ? 4 : 6;

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
      <Card className="p-3 md:p-6 rounded-2xl bg-card border-border dark-any:bg-[#0a1628] dark-any:border-[#1e3a5f]" data-testid="dynasty-window-chart">
        {/* Mobile bumps chart height from 300 → 380 so the plot fills the card
            rather than fighting with axis margins for visible space. */}
        <div className="h-[380px] md:h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} strokeOpacity={isMobile ? 0.35 : 0.5} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 100]}
              tickCount={axisTickCount}
              tick={{ fill: chartPalette.axisTick, fontSize: axisFontSize }}
              tickLine={{ stroke: chartPalette.axisLine }}
              axisLine={{ stroke: chartPalette.axisLine }}
            >
              <Label value="Current Power →" position="insideBottom" offset={xLabelOffset} style={{ fill: chartPalette.label, fontSize: axisFontSize, fontWeight: 600 }} />
            </XAxis>
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 100]}
              width={yAxisWidth}
              tickCount={axisTickCount}
              tick={{ fill: chartPalette.axisTick, fontSize: axisFontSize }}
              tickLine={{ stroke: chartPalette.axisLine }}
              axisLine={{ stroke: chartPalette.axisLine }}
            >
              <Label value="Future Strength →" angle={-90} position="insideLeft" offset={yLabelOffset} style={{ fill: chartPalette.label, fontSize: axisFontSize, fontWeight: 600, textAnchor: "middle" }} />
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
                    <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central" fill={isLight ? payload.fill : "#fff"} fontSize={10} fontWeight={700}>
                      {(payload.teamName || "?").slice(0, 2).toUpperCase()}
                    </text>
                  </g>
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
        </div>
        {/* Compact quadrant legend. Mobile uses smaller text + tighter padding
            so the pill row stops competing with the chart for vertical space.
            Long labels collapse to abbreviations on the narrowest viewports. */}
        <div className="grid grid-cols-2 gap-1.5 md:gap-2 mt-2 md:mt-3">
          <div className="text-center px-1.5 py-1 md:py-1.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20">
            <span className="text-[9px] md:text-[10px] text-emerald-600 dark-any:text-emerald-400 font-semibold whitespace-nowrap">↑ <span className="hidden min-[360px]:inline">Rebuild With </span>Ammo</span>
          </div>
          <div className="text-center px-1.5 py-1 md:py-1.5 rounded-lg bg-[#d4af37]/10 border border-[#d4af37]/20">
            <span className="text-[9px] md:text-[10px] text-[#b8881a] dark-any:text-[#d4af37] font-semibold whitespace-nowrap">↗ <span className="hidden min-[360px]:inline">Dynasty </span>Death Star</span>
          </div>
          <div className="text-center px-1.5 py-1 md:py-1.5 rounded-lg bg-[#64748b]/10 border border-[#64748b]/20">
            <span className="text-[9px] md:text-[10px] text-slate-600 dark-any:text-slate-400 font-semibold whitespace-nowrap">↙ Rebuild<span className="hidden min-[360px]:inline"> Hell</span></span>
          </div>
          <div className="text-center px-1.5 py-1 md:py-1.5 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20">
            <span className="text-[9px] md:text-[10px] text-red-600 dark-any:text-red-400 font-semibold whitespace-nowrap">→ Win-Now<span className="hidden min-[360px]:inline"> Kings</span></span>
          </div>
        </div>
      </Card>

    </div>
  );
}

export function LeagueEconomy({ league }: { league: League }) {
  return (
    <div className="space-y-8">
      <EconomyOverview league={league} />
    </div>
  );
}
