import { useState, useMemo, useRef, useCallback } from "react";
import { toPng } from "html-to-image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getPositionColor } from "@/data/mockData";
import type { League, Team, Player, Pick } from "@/types";
import { cn } from "@/lib/utils";
import {
  Copy, Image, Share2, EyeOff, Loader2,
  Shield, Star, TrendingDown, Zap, Target, ChevronRight,
  Users, TrendingUp, Trophy,
} from "lucide-react";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";

interface Props {
  league: League;
  userTeam: Team;
}

type StrengthLabel = "Elite" | "Strong" | "Average" | "Weak";
type Archetype =
  | "Elite Contender"
  | "Contender"
  | "Fringe"
  | "Rebuild"
  | "Orphan Target";

function strengthLabel(rank: number, total: number): StrengthLabel {
  const pct = rank / total;
  if (rank <= 2 || pct <= 0.2) return "Elite";
  if (pct <= 0.5) return "Strong";
  if (pct <= 0.75) return "Average";
  return "Weak";
}

function strengthColor(label: StrengthLabel): string {
  switch (label) {
    case "Elite":   return "text-emerald-400";
    case "Strong":  return "text-blue-400";
    case "Average": return "text-amber-400";
    case "Weak":    return "text-red-400";
  }
}

function strengthBar(label: StrengthLabel): string {
  switch (label) {
    case "Elite":   return "bg-emerald-500";
    case "Strong":  return "bg-blue-500";
    case "Average": return "bg-amber-500";
    case "Weak":    return "bg-red-500";
  }
}

function archetypeConfig(a: Archetype) {
  switch (a) {
    case "Elite Contender": return { icon: Star,         color: "text-[#d4af37]",    bg: "bg-[#d4af37]/15 border-[#d4af37]/30" };
    case "Contender":       return { icon: Zap,          color: "text-emerald-400",  bg: "bg-emerald-400/10 border-emerald-400/25" };
    case "Fringe":          return { icon: Target,       color: "text-amber-400",    bg: "bg-amber-400/10 border-amber-400/25" };
    case "Rebuild":         return { icon: TrendingDown, color: "text-blue-400",     bg: "bg-blue-400/10 border-blue-400/25" };
    case "Orphan Target":   return { icon: Shield,       color: "text-purple-400",   bg: "bg-purple-400/10 border-purple-400/25" };
  }
}

function pickLabel(p: Pick): string {
  const round = p.round === 1 ? "1st" : p.round === 2 ? "2nd" : p.round === 3 ? "3rd" : `${p.round}th`;
  const range = p.projectedRange ? ` (${p.projectedRange})` : "";
  return `${p.year} ${round}${range}`;
}

export function ShareTeam({ league, userTeam }: Props) {
  const { toast } = useToast();
  const { getPlayerValue, getRedraftValue } = useValueModel();
  const cardRef = useRef<HTMLDivElement>(null);

  const [hideManagerName, setHideManagerName] = useState(false);
  const [hideLeagueName, setHideLeagueName] = useState(false);
  const [hideValues, setHideValues] = useState(false);
  const [showAges, setShowAges] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [anonMode, setAnonMode] = useState(false);

  const computed = useMemo(() => {
    const total = league.teams.length;

    const rankByMetric = (key: keyof typeof userTeam.metrics) => {
      const sorted = [...league.teams].sort((a, b) => b.metrics[key] - a.metrics[key]);
      return sorted.findIndex((t) => t.id === userTeam.id) + 1;
    };

    const overallRank = rankByMetric("overall");
    const qbRank      = rankByMetric("qb");
    const rbRank      = rankByMetric("rb");
    const wrRank      = rankByMetric("wr");
    const teRank      = rankByMetric("te");
    const picksRank   = rankByMetric("picks");

    const byDynValue = (t: Team) => t.roster.reduce((s, p) => s + getPlayerValue(p), 0);
    const dynastyRank = [...league.teams]
      .sort((a, b) => byDynValue(b) - byDynValue(a))
      .findIndex((t) => t.id === userTeam.id) + 1;

    const byCompetingValue = (t: Team) =>
      t.roster.filter((p) => p.starter).reduce((s, p) => s + getRedraftValue(p), 0);
    const competingRank = [...league.teams]
      .sort((a, b) => byCompetingValue(b) - byCompetingValue(a))
      .findIndex((t) => t.id === userTeam.id) + 1;

    const overallStrength = strengthLabel(overallRank, total);

    const overallPct = overallRank / total;
    let archetype: Archetype;
    if (overallRank <= 2 || overallPct <= 0.15) archetype = "Elite Contender";
    else if (overallPct <= 0.4) archetype = "Contender";
    else if (overallPct <= 0.65) archetype = "Fringe";
    else if (userTeam.metrics.picks > 58) archetype = "Rebuild";
    else archetype = "Orphan Target";

    const corePlayers = [...userTeam.roster]
      .sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
      .slice(0, 6);

    const posStrengths: Record<string, { rank: number; label: StrengthLabel }> = {
      QB:    { rank: qbRank,    label: strengthLabel(qbRank,    total) },
      RB:    { rank: rbRank,    label: strengthLabel(rbRank,    total) },
      WR:    { rank: wrRank,    label: strengthLabel(wrRank,    total) },
      TE:    { rank: teRank,    label: strengthLabel(teRank,    total) },
      Picks: { rank: picksRank, label: strengthLabel(picksRank, total) },
    };

    const rosterByPos: Record<string, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
    for (const p of userTeam.roster) {
      if (rosterByPos[p.pos]) rosterByPos[p.pos].push(p);
    }
    for (const pos of Object.keys(rosterByPos)) {
      rosterByPos[pos].sort((a, b) => getPlayerValue(b) - getPlayerValue(a));
    }

    const picksByYearRound = new Map<string, Pick[]>();
    for (const pk of userTeam.picks) {
      const key = `${pk.year}-${pk.round}`;
      if (!picksByYearRound.has(key)) picksByYearRound.set(key, []);
      picksByYearRound.get(key)!.push(pk);
    }
    const sortedPickGroups = [...picksByYearRound.entries()].sort(([a], [b]) => a.localeCompare(b));

    // Group picks by year for compact display
    const picksByYear = new Map<number, { round: number; count: number; range?: string }[]>();
    for (const [, picks] of sortedPickGroups) {
      const year = picks[0].year;
      if (!picksByYear.has(year)) picksByYear.set(year, []);
      picksByYear.get(year)!.push({ round: picks[0].round, count: picks.length, range: picks[0].projectedRange });
    }
    const sortedPickYears = [...picksByYear.entries()].sort(([a], [b]) => a - b);

    const scoringParts = league.scoringFormat?.split(" ") ?? [];
    const scoring = scoringParts[0] === "Half" ? "Half-PPR" : scoringParts[0] ?? "PPR";
    const format  = league.format ?? (scoringParts[1] === "SF" ? "SF" : "1QB");

    // Team Snapshot stats
    const playersWithAge = userTeam.roster.filter((p) => p.age > 0);
    const avgAge = playersWithAge.length
      ? (playersWithAge.reduce((s, p) => s + p.age, 0) / playersWithAge.length).toFixed(1)
      : "—";
    const totalValue = Math.round(byDynValue(userTeam));
    const startersValue = Math.round(
      userTeam.roster.filter((p) => p.starter).reduce((s, p) => s + getPlayerValue(p), 0)
    );
    const future1sts = userTeam.picks.filter((p) => p.round === 1).length;

    return {
      total, overallRank, dynastyRank, competingRank, overallStrength,
      qbRank, rbRank, wrRank, teRank, picksRank,
      archetype, corePlayers, posStrengths,
      rosterByPos, sortedPickGroups, sortedPickYears,
      scoring, format,
      avgAge, totalValue, startersValue, future1sts,
    };
  }, [league, userTeam, getPlayerValue, getRedraftValue]);

  const displayName   = (hideManagerName || anonMode) ? "Anonymous Manager" : (userTeam.owner || "Your Team");
  const displayLeague = (hideLeagueName  || anonMode) ? `${computed.total}-Team ${computed.format} Dynasty` : league.name;

  const copyLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("leagueId", league.id);
    url.searchParams.set("teamId", userTeam.id);
    navigator.clipboard.writeText(url.toString()).then(() =>
      toast({ title: "Share link copied!", description: "Send this link to anyone." })
    );
  }, [league.id, userTeam.id, toast]);

  const doExport = useCallback(async (anon: boolean) => {
    if (!cardRef.current) return;
    setIsExporting(true);
    if (anon) setAnonMode(true);
    await new Promise((r) => setTimeout(r, 120));
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        backgroundColor: "#080f1e",
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = anon ? "dynasty-team-anonymous.png" : "dynasty-team-share.png";
      link.href = dataUrl;
      link.click();
      toast({ title: "Image exported!", description: "Your share card was saved as a PNG." });
    } catch {
      toast({ title: "Export failed", description: "Try again or check browser permissions.", variant: "destructive" });
    } finally {
      setIsExporting(false);
      if (anon) setAnonMode(false);
    }
  }, [toast]);

  const copyBlurb = useCallback(() => {
    const core = computed.corePlayers.slice(0, 4).map((p) => p.name).join(", ");
    const strengths = Object.entries(computed.posStrengths)
      .filter(([, v]) => v.label === "Elite" || v.label === "Strong").map(([pos]) => pos);
    const needs = Object.entries(computed.posStrengths)
      .filter(([, v]) => v.label === "Weak").map(([pos]) => pos);
    const leagueStr = hideLeagueName ? `${computed.total}-Team ${computed.format} ${computed.scoring}` : league.name;
    const url = new URL(window.location.href);
    url.searchParams.set("leagueId", league.id);
    url.searchParams.set("teamId", userTeam.id);
    const blurb = [
      `${computed.total}-Team Dynasty ${computed.format} ${computed.scoring} team in ${leagueStr}.`,
      `Ranked #${computed.overallRank} of ${computed.total} — ${computed.archetype}.`,
      core ? `Core players: ${core}.` : "",
      strengths.length ? `Strengths: ${strengths.join(", ")}.` : "",
      needs.length ? `Needs: ${needs.join(", ")}.` : "",
      `View full team: ${url.toString()}`,
    ].filter(Boolean).join(" ");
    navigator.clipboard.writeText(blurb).then(() =>
      toast({ title: "Blurb copied!", description: "Ready to paste in Discord, Sleeper, or Reddit." })
    );
  }, [computed, league, userTeam, hideLeagueName, toast]);

  const { icon: ArchIcon, color: archColor, bg: archBg } = archetypeConfig(computed.archetype);

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-bold text-foreground">Share My Team</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Create a clean, shareable snapshot of your dynasty roster.
        </p>
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={copyLink} data-testid="button-copy-link">
          <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Link
        </Button>
        <Button size="sm" variant="outline" onClick={() => doExport(false)} disabled={isExporting} data-testid="button-export-image">
          {isExporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Image className="w-3.5 h-3.5 mr-1.5" />}
          Export Image
        </Button>
        <Button size="sm" variant="outline" onClick={() => doExport(true)} disabled={isExporting} data-testid="button-export-anonymous">
          <EyeOff className="w-3.5 h-3.5 mr-1.5" /> Export Anonymous
        </Button>
        <Button size="sm" variant="outline" onClick={copyBlurb} data-testid="button-copy-blurb">
          <Share2 className="w-3.5 h-3.5 mr-1.5" /> Copy Blurb
        </Button>
      </div>

      {/* Privacy toggles */}
      <Card className="p-3 border-border/40 bg-card/50">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Privacy</span>
          <ToggleSwitch id="hide-name"   label="Hide Name"        checked={hideManagerName} onCheckedChange={setHideManagerName} />
          <ToggleSwitch id="hide-league" label="Hide League Name" checked={hideLeagueName}  onCheckedChange={setHideLeagueName} />
          <ToggleSwitch id="hide-values" label="Hide Values"      checked={hideValues}      onCheckedChange={setHideValues} />
          <ToggleSwitch id="show-ages"   label="Show Ages"        checked={showAges}        onCheckedChange={setShowAges} />
        </div>
      </Card>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[38%_62%] gap-6">

        {/* ── LEFT: Share Card (exported as PNG) ── */}
        <div
          ref={cardRef}
          className="rounded-xl overflow-hidden min-w-0"
          style={{
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "linear-gradient(160deg, #0d1b2e 0%, #080f1e 100%)",
            border: "1px solid #1e3050",
            boxShadow: "0 0 0 1px rgba(212,175,55,0.12), 0 0 32px rgba(11,58,122,0.3)",
          }}
        >
          {/* Gold top accent bar */}
          <div style={{ height: 3, background: "linear-gradient(90deg, #d4af37, #0b3a7a, transparent)" }} />

          {/* ── Header: Manager + League ── */}
          <div className="px-5 pt-4 pb-4" style={{ borderBottom: "1px solid rgba(212,175,55,0.12)" }}>
            <div className="flex items-center gap-3.5 mb-3">
              {userTeam.avatar && !anonMode ? (
                <img
                  src={userTeam.avatar!}
                  alt={displayName}
                  className="w-14 h-14 rounded-full object-cover flex-shrink-0"
                  style={{ boxShadow: "0 0 0 2px #d4af37, 0 0 12px rgba(212,175,55,0.25)" }}
                />
              ) : (
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(11,58,122,0.35)", boxShadow: "0 0 0 2px #1e3050" }}
                >
                  <Shield className="w-6 h-6 text-blue-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: "#d4af37", opacity: 0.8 }}>Dynasty Manager</div>
                <div className="text-xl font-extrabold text-white leading-tight truncate" data-testid="text-share-manager">
                  {displayName}
                </div>
                <div className="text-[11px] mt-0.5 truncate" style={{ color: "#7a9bbf" }} data-testid="text-share-league">
                  {displayLeague}
                </div>
              </div>
            </div>

            {/* Archetype badge + league format pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <div
                className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold", archBg, archColor)}
                data-testid="text-share-archetype"
              >
                <ArchIcon className="w-3 h-3" />
                {computed.archetype}
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(30,48,80,0.8)", color: "#7a9bbf", border: "1px solid #1e3050" }}>
                {computed.total}T {computed.format}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(30,48,80,0.8)", color: "#7a9bbf", border: "1px solid #1e3050" }}>
                {computed.scoring}
              </span>
            </div>
          </div>

          {/* ── Semantic rank row: Strength / Value Rank / Win Outlook ── */}
          <div className="grid grid-cols-3" style={{ borderBottom: "1px solid rgba(212,175,55,0.12)" }}>
            <SemanticStat
              label="Strength"
              value={computed.overallStrength}
              valueClass={strengthColor(computed.overallStrength)}
              sublabel={`#${computed.overallRank} of ${computed.total}`}
              noBorder
            />
            <SemanticStat
              label="Value Rank"
              value={`#${computed.dynastyRank}`}
              sublabel={`of ${computed.total} teams`}
            />
            <SemanticStat
              label="Win Outlook"
              value={`#${computed.competingRank}`}
              sublabel={`of ${computed.total} teams`}
            />
          </div>

          {/* ── Team Snapshot ── */}
          <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(212,175,55,0.12)" }}>
            <div className="text-[10px] font-bold uppercase tracking-widest mb-2.5" style={{ color: "#d4af37", opacity: 0.75 }}>
              Team Snapshot
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              <SnapshotRow icon={Users}       label="Avg Age"       value={`${computed.avgAge} yrs`} />
              {!hideValues && (
                <>
                  <SnapshotRow icon={TrendingUp}  label="Total Value"    value={computed.totalValue > 0 ? computed.totalValue.toLocaleString() : "—"} />
                  <SnapshotRow icon={Trophy}      label="Starters Value" value={computed.startersValue > 0 ? computed.startersValue.toLocaleString() : "—"} />
                </>
              )}
              <SnapshotRow icon={Star}        label="Future 1sts"   value={`${computed.future1sts} pick${computed.future1sts !== 1 ? "s" : ""}`} gold />
            </div>
          </div>

          {/* ── League settings mini-card ── */}
          <div className="px-5 py-3" style={{ borderBottom: "1px solid rgba(212,175,55,0.12)" }}>
            <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#d4af37", opacity: 0.75 }}>
              League Settings
            </div>
            {league.rosterPositions && league.rosterPositions.length > 0 && (
              <div className="text-[10px] leading-relaxed" style={{ color: "#7a9bbf" }}>
                Lineup: {league.rosterPositions.filter(p => p !== "BN").join(" · ")}
              </div>
            )}
          </div>

          {/* ── Positional Strength ── */}
          <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(212,175,55,0.12)" }}>
            <div className="text-[10px] font-bold uppercase tracking-widest mb-2.5" style={{ color: "#d4af37", opacity: 0.75 }}>
              Positional Strength
            </div>
            <div className="space-y-2">
              {Object.entries(computed.posStrengths).map(([pos, { rank, label }]) => {
                const fillPct = Math.max(8, ((computed.total - rank + 1) / computed.total) * 100);
                return (
                  <div key={pos} className="flex items-center gap-2.5" data-testid={`pos-strength-${pos}`}>
                    <span className="text-[11px] font-bold w-8 flex-shrink-0" style={{ color: "#7a9bbf" }}>{pos}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#1a2d4a" }}>
                      <div className={cn("h-full rounded-full", strengthBar(label))} style={{ width: `${fillPct}%` }} />
                    </div>
                    <span className="text-[10px] w-10 text-right flex-shrink-0" style={{ color: "#4a6280" }}>#{rank}/{computed.total}</span>
                    <span className={cn("text-[10px] font-bold w-12 flex-shrink-0", strengthColor(label))}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Brand footer ── */}
          <div className="px-5 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={logoDark} alt="StatChasers" className="w-5 h-5 opacity-90" />
              <span className="text-[10px] font-bold tracking-wide" style={{ color: "#d4af37" }}>StatChasers Dynasty Command</span>
            </div>
            <span className="text-[9px]" style={{ color: "#2a4060" }}>statchasers.com</span>
          </div>
        </div>

        {/* ── RIGHT: Roster Preview ── */}
        <div className="space-y-3 min-w-0">

          {/* Roster summary bar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold text-foreground">Roster Preview</h3>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
              <span className="font-semibold text-foreground">{userTeam.roster.length} players</span>
              <span>·</span>
              <span>{userTeam.picks.length} picks</span>
              <span>·</span>
              <span>Avg Age <span className="font-semibold text-foreground">{computed.avgAge}</span></span>
              {!hideValues && computed.totalValue > 0 && (
                <>
                  <span>·</span>
                  <span>Value <span className="font-semibold text-foreground">{computed.totalValue.toLocaleString()}</span></span>
                </>
              )}
            </div>
          </div>

          {/* Core players — pinned at top */}
          {computed.corePlayers.length > 0 && (
            <Card className="border-[#d4af37]/25 bg-[#d4af37]/5 px-3 py-2.5">
              <div className="text-[10px] font-bold text-[#d4af37] uppercase tracking-wider mb-1.5">Core Players</div>
              <div className="flex flex-wrap gap-1.5">
                {computed.corePlayers.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-1 bg-background/60 border border-border/30 rounded px-1.5 py-0.5"
                    data-testid={`core-player-${p.id}`}
                  >
                    <Badge variant="outline" className={cn("text-[9px] px-1 py-0 h-3.5 border-0", getPositionColor(p.pos))}>
                      {p.pos}
                    </Badge>
                    <span className="text-[11px] font-semibold">{p.name}</span>
                    {!hideValues && getPlayerValue(p) > 0 && (
                      <span className="text-[10px] text-muted-foreground">{getPlayerValue(p).toLocaleString()}</span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 2-column position grid: QB+RB | WR+TE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Left col: QB + RB */}
            <div className="space-y-3">
              {(["QB", "RB"] as const).map((pos) => {
                const players = computed.rosterByPos[pos];
                if (!players || players.length === 0) return null;
                return (
                  <PosGroup
                    key={pos}
                    pos={pos}
                    players={players}
                    getPlayerValue={getPlayerValue}
                    hideValues={hideValues}
                    showAges={showAges}
                  />
                );
              })}
            </div>
            {/* Right col: WR + TE */}
            <div className="space-y-3">
              {(["WR", "TE"] as const).map((pos) => {
                const players = computed.rosterByPos[pos];
                if (!players || players.length === 0) return null;
                return (
                  <PosGroup
                    key={pos}
                    pos={pos}
                    players={players}
                    getPlayerValue={getPlayerValue}
                    hideValues={hideValues}
                    showAges={showAges}
                  />
                );
              })}
            </div>
          </div>

          {/* Picks — full width, grouped by year */}
          {computed.sortedPickYears.length > 0 && (
            <Card className="border-border/40 bg-card/50 overflow-hidden">
              <div className="px-3 py-2 border-b border-border/20 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-[#d4af37]/40 text-[#d4af37]">
                  Picks
                </Badge>
                <span className="text-xs font-semibold text-muted-foreground">({userTeam.picks.length} total)</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {computed.sortedPickYears.map(([year, rounds]) => {
                  const rdLabel = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`;
                  return (
                    <div key={year} className="flex items-center gap-2" data-testid={`pick-year-${year}`}>
                      <span className="text-[11px] font-bold text-[#d4af37] w-9 flex-shrink-0">{year}</span>
                      <div className="flex items-center gap-1 flex-wrap">
                        {rounds.map((r, i) => (
                          <span key={r.round} className="flex items-center gap-1">
                            {i > 0 && <span className="text-muted-foreground/40">·</span>}
                            <span className="text-xs text-foreground font-medium">
                              {rdLabel(r.round)}{r.count > 1 ? ` ×${r.count}` : ""}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function ToggleSwitch({ id, label, checked, onCheckedChange }: {
  id: string; label: string; checked: boolean; onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="scale-75" data-testid={`toggle-${id}`} />
      <Label htmlFor={id} className="text-xs text-muted-foreground cursor-pointer">{label}</Label>
    </div>
  );
}

function SemanticStat({ label, value, valueClass, sublabel, noBorder }: {
  label: string; value: string; valueClass?: string; sublabel: string; noBorder?: boolean;
}) {
  return (
    <div
      className="px-4 py-3 text-center"
      style={noBorder ? {} : { borderLeft: "1px solid rgba(212,175,55,0.1)" }}
    >
      <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: "#4a6280" }}>{label}</div>
      <div className={cn("text-sm font-extrabold text-white", valueClass)}>{value}</div>
      <div className="text-[9px] mt-0.5" style={{ color: "#4a6280" }}>{sublabel}</div>
    </div>
  );
}

function SnapshotRow({ icon: Icon, label, value, gold }: {
  icon: React.ElementType; label: string; value: string; gold?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("w-3 h-3 flex-shrink-0", gold ? "text-[#d4af37]" : "text-blue-400/60")} />
      <span className="text-[10px] flex-1" style={{ color: "#4a6280" }}>{label}</span>
      <span className={cn("text-[11px] font-bold", gold ? "text-[#d4af37]" : "text-white")}>{value}</span>
    </div>
  );
}

function PosGroup({ pos, players, getPlayerValue, hideValues, showAges }: {
  pos: string;
  players: Player[];
  getPlayerValue: (p: Player) => number;
  hideValues: boolean;
  showAges: boolean;
}) {
  return (
    <Card className="border-border/40 bg-card/50 overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-border/20 flex items-center gap-1.5 bg-card/95">
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", getPositionColor(pos))}>
          {pos}
        </Badge>
        <span className="text-[11px] font-semibold text-muted-foreground">({players.length})</span>
      </div>
      <div className="divide-y divide-border/10">
        {players.map((player) => (
          <PlayerRow
            key={player.id}
            player={player}
            value={getPlayerValue(player)}
            hideValues={hideValues}
            showAge={showAges}
          />
        ))}
      </div>
    </Card>
  );
}

function PlayerRow({ player, value, hideValues, showAge }: {
  player: Player; value: number; hideValues: boolean; showAge: boolean;
}) {
  const sleeperId = player.sleeperId ?? player.id;
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-muted/30 group"
      data-testid={`player-row-${player.id}`}
    >
      <div className="w-7 h-7 rounded-full bg-muted overflow-hidden ring-1 ring-border/30 flex-shrink-0">
        <img
          src={`https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`}
          alt={player.name}
          className="w-full h-full object-cover object-top"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs font-semibold truncate">{player.name}</span>
          {player.starter ? (
            <span className="text-[9px] font-bold px-1 py-0 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 flex-shrink-0">START</span>
          ) : (
            <span className="text-[9px] font-bold px-1 py-0 rounded bg-muted/60 text-muted-foreground border border-border/30 flex-shrink-0">BN</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>{player.team || "FA"}</span>
          {showAge && player.age > 0 && <span>· {player.age}y</span>}
        </div>
      </div>
      {!hideValues && value > 0 && (
        <span className="text-[11px] font-bold text-[#0b3a7a] dark:text-blue-400 tabular-nums flex-shrink-0">
          {value.toLocaleString()}
        </span>
      )}
    </div>
  );
}
