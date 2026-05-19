import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  CloudSun,
  FileText,
  Layers,
  Newspaper,
  Shield,
  Sparkles,
  Swords,
  TrendingUp,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ProjectionSourceRows } from "./ProjectionSourceRows";
import { StartSitRecommendationBadge } from "./StartSitRecommendationBadge";
import type { MockPlayerWeekly } from "@/data/mockStartSitProjections";
import type { StartSitRecommendation, RiskLevel } from "@/lib/startSit";

interface Props {
  open: boolean;
  onClose: () => void;
  player: MockPlayerWeekly | null;
  averageProjection: number | null;
  highProjection: number | null;
  lowProjection: number | null;
  recommendation: StartSitRecommendation;
  confidence: number;
  risk: RiskLevel;
}

export function PlayerWeeklyProfileDrawer({
  open,
  onClose,
  player,
  averageProjection,
  highProjection,
  lowProjection,
  recommendation,
  confidence,
  risk,
}: Props) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("outlook");

  useEffect(() => {
    if (open) setTab("outlook");
  }, [open, player?.playerId]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "p-0 border-l border-white/10 bg-[#0a1628] text-foreground overflow-hidden flex flex-col",
          isMobile ? "h-[92vh] sm:max-w-full rounded-t-2xl" : "w-full sm:max-w-[540px]",
        )}
        data-testid="player-weekly-profile-drawer"
      >
        <SheetTitle className="sr-only">
          {player ? `${player.name} weekly profile` : "Player weekly profile"}
        </SheetTitle>

        {player ? (
          <>
            <Header
              player={player}
              averageProjection={averageProjection}
              recommendation={recommendation}
              confidence={confidence}
              risk={risk}
            />
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="mx-3 mt-2 grid grid-cols-5 h-9 bg-white/[0.04]">
                <TabsTrigger value="outlook" className="text-[10px] flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Outlook
                </TabsTrigger>
                <TabsTrigger value="projections" className="text-[10px] flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  Projections
                </TabsTrigger>
                <TabsTrigger value="matchup" className="text-[10px] flex items-center gap-1">
                  <Swords className="w-3 h-3" />
                  Matchup
                </TabsTrigger>
                <TabsTrigger value="trends" className="text-[10px] flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Trends
                </TabsTrigger>
                <TabsTrigger value="notes" className="text-[10px] flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  Notes
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                <TabsContent value="outlook">
                  <OutlookTab
                    player={player}
                    averageProjection={averageProjection}
                    highProjection={highProjection}
                    lowProjection={lowProjection}
                    recommendation={recommendation}
                    confidence={confidence}
                    risk={risk}
                  />
                </TabsContent>
                <TabsContent value="projections">
                  <ProjectionsTab player={player} highProjection={highProjection} />
                </TabsContent>
                <TabsContent value="matchup">
                  <MatchupTab player={player} />
                </TabsContent>
                <TabsContent value="trends">
                  <TrendsTab player={player} />
                </TabsContent>
                <TabsContent value="notes">
                  <NotesTab />
                </TabsContent>
              </div>
            </Tabs>
          </>
        ) : (
          <div className="p-6 text-sm text-white/50">No player selected.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Header({
  player,
  averageProjection,
  recommendation,
}: {
  player: MockPlayerWeekly;
  averageProjection: number | null;
  recommendation: StartSitRecommendation;
  confidence: number;
  risk: RiskLevel;
}) {
  return (
    <div className="px-4 pt-5 pb-3 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent">
      <div className="flex items-center gap-3">
        <PlayerAvatar
          id={player.playerId}
          name={player.name}
          pos={player.position}
          team={player.team}
          size="md"
          compact
        />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold text-white truncate" data-testid="drawer-player-name">
            {player.name}
          </div>
          <div className="text-[11px] text-white/55 mt-0.5">
            {player.position} · {player.team} {player.matchup.opponent}
          </div>
          <div className="mt-1.5">
            <StartSitRecommendationBadge recommendation={recommendation} />
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[9px] uppercase tracking-wider text-white/35">Avg proj</div>
          <div className="text-xl font-black tabular-nums text-[#d4af37]">
            {averageProjection == null ? "—" : averageProjection.toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutlookTab({
  player,
  averageProjection,
  highProjection,
  lowProjection,
  recommendation,
  confidence,
  risk,
}: {
  player: MockPlayerWeekly;
  averageProjection: number | null;
  highProjection: number | null;
  lowProjection: number | null;
  recommendation: StartSitRecommendation;
  confidence: number;
  risk: RiskLevel;
}) {
  const riskColor =
    risk === "low" ? "text-emerald-300" : risk === "medium" ? "text-[#d4af37]" : "text-rose-300";
  const riskLabel =
    risk === "low" ? "Low risk" : risk === "medium" ? "Medium risk" : "High risk";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Avg Proj" value={averageProjection == null ? "—" : averageProjection.toFixed(1)} accent="gold" />
        <Stat label="High" value={highProjection == null ? "—" : highProjection.toFixed(1)} />
        <Stat label="Low" value={lowProjection == null ? "—" : lowProjection.toFixed(1)} />
        <Stat label="Recommendation" value={recommendation} fullWidth />
        <Stat label="Confidence" value={`${confidence}%`} accent="emerald" />
        <Stat label="Risk" value={riskLabel} className={riskColor} />
      </div>

      <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
        <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Game info</div>
        <div className="text-[12px] text-white/80 leading-relaxed">
          {player.team} {player.matchup.opponent} · {player.matchup.gameTime ?? "TBD"}
          {player.matchup.gameEnvironment && (
            <span className="text-white/40"> · {player.matchup.gameEnvironment}</span>
          )}
        </div>
        <div className="text-[11px] text-white/45 mt-1">
          Injury: {player.matchup.injuryStatus ?? "—"}
        </div>
      </div>
    </div>
  );
}

function ProjectionsTab({ player, highProjection }: { player: MockPlayerWeekly; highProjection: number | null }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-white/45">
        Weekly projection breakdown across all connected sources.
      </div>
      <div className="rounded-md border border-white/10 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-white/[0.04] text-white/55">
            <tr>
              <th className="px-2 py-1.5 text-left">Source</th>
              <th className="px-2 py-1.5 text-right">Projection</th>
              <th className="px-2 py-1.5 text-right">Rank</th>
              <th className="px-2 py-1.5 text-right">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {player.projections.map((p) => {
              const isBest =
                highProjection != null &&
                p.projectedPoints != null &&
                p.projectedPoints >= highProjection;
              return (
                <tr key={p.source} className="border-t border-white/5">
                  <td className="px-2 py-1.5 text-white/85">{p.source}</td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right tabular-nums font-bold",
                      p.projectedPoints == null ? "text-white/30" : isBest ? "text-[#d4af37]" : "text-white",
                    )}
                  >
                    {p.projectedPoints == null ? "—" : p.projectedPoints.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-white/55">
                    {p.rank ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right text-white/35 text-[10px]">
                    {p.lastUpdated ? formatTimestamp(p.lastUpdated) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-white/30 italic">
        Missing sources show “—”. Projection data coming soon for unmapped feeds.
      </p>
    </div>
  );
}

function MatchupTab({ player }: { player: MockPlayerWeekly }) {
  const m = player.matchup;
  return (
    <div className="grid grid-cols-2 gap-2">
      <InfoCard
        icon={Shield}
        label={`Opp D rank vs ${player.position}`}
        value={m.opponentRankVsPos == null ? "—" : `#${m.opponentRankVsPos}`}
      />
      <InfoCard
        icon={Layers}
        label="Implied team total"
        value={m.impliedTeamTotal == null ? "—" : m.impliedTeamTotal.toFixed(1)}
      />
      <InfoCard
        icon={Swords}
        label="Game environment"
        value={m.gameEnvironment ?? "—"}
      />
      <InfoCard icon={CloudSun} label="Weather" value={m.weather ?? "—"} />
      <InfoCard
        icon={Activity}
        label="Injury status"
        value={m.injuryStatus ?? "—"}
      />
      <InfoCard
        icon={Newspaper}
        label="Game time"
        value={m.gameTime ?? "—"}
      />
    </div>
  );
}

function TrendsTab({ player }: { player: MockPlayerWeekly }) {
  const t = player.trends;
  return (
    <div className="space-y-3">
      <TrendRow label="Last 3 games" values={t.last3Games} />
      <TrendRow label="Last 5 games" values={t.last5Games} />
      <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-1.5 text-[11px]">
        <KV label="Usage" value={t.usageTrend ?? "—"} />
        <KV label="Snap share" value={t.snapShareTrend ?? "—"} />
        <KV label="Targets / carries" value={t.touchesTrend ?? "—"} />
      </div>
    </div>
  );
}

function NotesTab() {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-4 text-[12px] text-white/55 italic">
      Projection notes and analyst context coming soon.
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  className,
  fullWidth,
}: {
  label: string;
  value: string | number;
  accent?: "gold" | "emerald";
  className?: string;
  fullWidth?: boolean;
}) {
  const accentClass =
    accent === "gold"
      ? "text-[#d4af37]"
      : accent === "emerald"
        ? "text-emerald-300"
        : "text-white";
  return (
    <div
      className={cn(
        "rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5",
        fullWidth && "col-span-3",
      )}
    >
      <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
      <div className={cn("font-bold tabular-nums text-[13px]", accentClass, className)}>
        {value}
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-white/40 mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-[12px] font-semibold text-white/85">{value}</div>
    </div>
  );
}

function TrendRow({ label, values }: { label: string; values: (number | null)[] }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1.5">{label}</div>
      <div className="flex items-end gap-1.5">
        {values.map((v, i) => {
          const max = Math.max(...values.filter((x): x is number => typeof x === "number"), 1);
          const h = v == null ? 4 : Math.max(4, (v / max) * 36);
          return (
            <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <div
                className="w-full rounded-sm bg-[#d4af37]/35 border-t border-[#d4af37]/60"
                style={{ height: h }}
              />
              <div className="text-[9px] tabular-nums text-white/55">
                {v == null ? "—" : v.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/45">{label}</span>
      <span className="text-white/85 font-medium">{value}</span>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
