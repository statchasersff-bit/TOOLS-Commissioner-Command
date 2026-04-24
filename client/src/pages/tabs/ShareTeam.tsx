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
  Copy, Download, Image, Share2, Eye, EyeOff, Loader2,
  Shield, Star, TrendingDown, Zap, Target, ChevronRight,
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

function formatRosterPositions(positions: string[]): string {
  return positions
    .filter((p) => p !== "BN")
    .join(" · ");
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
      const sorted = [...league.teams].sort(
        (a, b) => b.metrics[key] - a.metrics[key]
      );
      return sorted.findIndex((t) => t.id === userTeam.id) + 1;
    };

    const overallRank   = rankByMetric("overall");
    const qbRank        = rankByMetric("qb");
    const rbRank        = rankByMetric("rb");
    const wrRank        = rankByMetric("wr");
    const teRank        = rankByMetric("te");
    const picksRank     = rankByMetric("picks");

    const byDynValue = (team: Team) =>
      team.roster.reduce((s, p) => s + getPlayerValue(p), 0);
    const sortedByDyn = [...league.teams].sort(
      (a, b) => byDynValue(b) - byDynValue(a)
    );
    const dynastyRank =
      sortedByDyn.findIndex((t) => t.id === userTeam.id) + 1;

    // Competing rank = sum of redraft values for starters only
    const byCompetingValue = (team: Team) =>
      team.roster
        .filter((p) => p.starter)
        .reduce((s, p) => s + getRedraftValue(p), 0);
    const sortedByCompeting = [...league.teams].sort(
      (a, b) => byCompetingValue(b) - byCompetingValue(a)
    );
    const competingRank =
      sortedByCompeting.findIndex((t) => t.id === userTeam.id) + 1;

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
      if (rosterByPos[p.pos]) {
        rosterByPos[p.pos].push(p);
      }
    }
    for (const pos of Object.keys(rosterByPos)) {
      rosterByPos[pos].sort((a, b) => getPlayerValue(b) - getPlayerValue(a));
    }

    const picksByYearRound: Map<string, Pick[]> = new Map();
    for (const pk of userTeam.picks) {
      const key = `${pk.year}-${pk.round}`;
      if (!picksByYearRound.has(key)) picksByYearRound.set(key, []);
      picksByYearRound.get(key)!.push(pk);
    }
    const sortedPickGroups = [...picksByYearRound.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );

    const scoringParts = league.scoringFormat?.split(" ") ?? [];
    const scoring = scoringParts[0] === "Half" ? "Half-PPR" : scoringParts[0] ?? "PPR";
    const format  = league.format ?? (scoringParts[1] === "SF" ? "SF" : "1QB");

    return {
      total, overallRank, dynastyRank, competingRank,
      qbRank, rbRank, wrRank, teRank, picksRank,
      archetype, corePlayers, posStrengths,
      rosterByPos, sortedPickGroups,
      scoring, format,
    };
  }, [league, userTeam, getPlayerValue, getRedraftValue]);

  const displayName  = (hideManagerName || anonMode) ? "Anonymous Manager" : (userTeam.owner || "Your Team");
  const displayLeague = (hideLeagueName || anonMode)
    ? `${computed.total}-Team ${computed.format} Dynasty`
    : league.name;

  const copyLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("leagueId", league.id);
    url.searchParams.set("teamId", userTeam.id);
    navigator.clipboard.writeText(url.toString()).then(() => {
      toast({ title: "Share link copied!", description: "Send this link to anyone." });
    });
  }, [league.id, userTeam.id, toast]);

  const doExport = useCallback(
    async (anon: boolean) => {
      if (!cardRef.current) return;
      setIsExporting(true);
      if (anon) setAnonMode(true);
      await new Promise((r) => setTimeout(r, 80));
      try {
        const dataUrl = await toPng(cardRef.current, {
          cacheBust: true,
          backgroundColor: "#0a1628",
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
    },
    [toast]
  );

  const copyBlurb = useCallback(() => {
    const core = computed.corePlayers.slice(0, 4).map((p) => p.name).join(", ");
    const strengths = Object.entries(computed.posStrengths)
      .filter(([, v]) => v.label === "Elite" || v.label === "Strong")
      .map(([pos]) => pos);
    const needs = Object.entries(computed.posStrengths)
      .filter(([, v]) => v.label === "Weak")
      .map(([pos]) => pos);

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
    ]
      .filter(Boolean)
      .join(" ");

    navigator.clipboard.writeText(blurb).then(() => {
      toast({ title: "Blurb copied!", description: "Ready to paste in Discord, Sleeper, or Reddit." });
    });
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => doExport(false)}
          disabled={isExporting}
          data-testid="button-export-image"
        >
          {isExporting ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Image className="w-3.5 h-3.5 mr-1.5" />
          )}
          Export Image
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => doExport(true)}
          disabled={isExporting}
          data-testid="button-export-anonymous"
        >
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
          <ToggleSwitch id="hide-name"   label="Hide Name"         checked={hideManagerName} onCheckedChange={setHideManagerName} />
          <ToggleSwitch id="hide-league" label="Hide League Name"  checked={hideLeagueName}  onCheckedChange={setHideLeagueName} />
          <ToggleSwitch id="hide-values" label="Hide Values"       checked={hideValues}       onCheckedChange={setHideValues} />
          <ToggleSwitch id="show-ages"   label="Show Ages"         checked={showAges}         onCheckedChange={setShowAges} />
        </div>
      </Card>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">

        {/* ── LEFT: Share Card (exported) ── */}
        <div
          ref={cardRef}
          className="rounded-xl overflow-hidden border border-[#1a2d4a] bg-[#0a1628] space-y-0 min-w-0"
          style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
        >
          {/* Team header */}
          <div className="px-5 pt-5 pb-4 border-b border-[#1a2d4a]">
            <div className="flex items-start gap-3.5 mb-3.5">
              {userTeam.avatar && !anonMode ? (
                <img
                  src={`https://sleepercdn.com/avatars/thumbs/${userTeam.avatar}`}
                  alt={displayName}
                  className="w-12 h-12 rounded-full ring-2 ring-[#d4af37]/40 object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-[#0b3a7a]/40 ring-2 ring-[#1a2d4a] flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-blue-400" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Manager</div>
                <div className="text-base font-bold text-white truncate" data-testid="text-share-manager">{displayName}</div>
                <div className="text-sm text-[#94a3b8] truncate" data-testid="text-share-league">{displayLeague}</div>
              </div>
            </div>

            {/* Archetype + rank row */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div
                className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold", archBg, archColor)}
                data-testid="text-share-archetype"
              >
                <ArchIcon className="w-3 h-3" />
                {computed.archetype}
              </div>
              <div className="flex items-center gap-3">
                <RankPill label="Overall"   rank={computed.overallRank}   total={computed.total} />
                <RankPill label="Dynasty"   rank={computed.dynastyRank}   total={computed.total} />
                <RankPill label="Competing" rank={computed.competingRank} total={computed.total} />
              </div>
            </div>
          </div>

          {/* League settings mini-card */}
          <div className="px-5 py-3.5 border-b border-[#1a2d4a]">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">League Settings</div>
            <div className="flex items-center gap-3 flex-wrap">
              <SettingPill value={`${computed.total} Teams`} />
              <SettingPill value={computed.format} highlight />
              <SettingPill value={computed.scoring} />
              {league.rosterPositions && league.rosterPositions.length > 0 && (
                <div className="w-full mt-1">
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Lineup: {formatRosterPositions(league.rosterPositions.filter(p => p !== "BN"))}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Positional value */}
          <div className="px-5 py-3.5 border-b border-[#1a2d4a]">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Positional Strength</div>
            <div className="space-y-2">
              {Object.entries(computed.posStrengths).map(([pos, { rank, label }]) => {
                const fillPct = Math.max(8, ((computed.total - rank + 1) / computed.total) * 100);
                return (
                  <div key={pos} className="flex items-center gap-2.5" data-testid={`pos-strength-${pos}`}>
                    <span className="text-[11px] font-bold text-muted-foreground w-8 flex-shrink-0">{pos}</span>
                    <div className="flex-1 h-1.5 bg-[#1a2d4a] rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", strengthBar(label))}
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-10 text-right flex-shrink-0">
                      #{rank}/{computed.total}
                    </span>
                    <span className={cn("text-[10px] font-bold w-12 flex-shrink-0", strengthColor(label))}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Brand footer */}
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={logoDark} alt="StatChasers" className="w-5 h-5 opacity-90" />
              <span className="text-[10px] font-semibold text-[#d4af37] tracking-wide">StatChasers Dynasty Command</span>
            </div>
            <span className="text-[9px] text-muted-foreground">statchasers.com</span>
          </div>
        </div>

        {/* ── RIGHT: Roster Preview ── */}
        <div className="space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Roster Preview</h3>
            <Badge variant="outline" className="text-[10px]">
              {userTeam.roster.length} players · {userTeam.picks.length} picks
            </Badge>
          </div>

          {/* Players by position */}
          {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
            const players = computed.rosterByPos[pos];
            if (!players || players.length === 0) return null;
            return (
              <Card key={pos} className="border-border/40 bg-card/50 overflow-hidden">
                <div className="px-3 py-2 border-b border-border/20 flex items-center gap-2">
                  <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", getPositionColor(pos))}>
                    {pos}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{players.length} player{players.length !== 1 ? "s" : ""}</span>
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
          })}

          {/* Picks */}
          {computed.sortedPickGroups.length > 0 && (
            <Card className="border-border/40 bg-card/50 overflow-hidden">
              <div className="px-3 py-2 border-b border-border/20 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-[#d4af37]/40 text-[#d4af37]">
                  Picks
                </Badge>
                <span className="text-[11px] text-muted-foreground">{userTeam.picks.length} total</span>
              </div>
              <div className="px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {computed.sortedPickGroups.map(([key, picks]) => (
                  <div key={key} className="flex items-center gap-1.5" data-testid={`pick-group-${key}`}>
                    <ChevronRight className="w-3 h-3 text-[#d4af37] flex-shrink-0" />
                    <span className="text-xs text-foreground font-medium">
                      {pickLabel(picks[0])}{picks.length > 1 ? ` ×${picks.length}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Core players callout */}
          {computed.corePlayers.length > 0 && (
            <Card className="border-[#d4af37]/20 bg-[#d4af37]/5 p-3">
              <div className="text-[10px] font-semibold text-[#d4af37] uppercase tracking-wider mb-2">
                Core Players
              </div>
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
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function ToggleSwitch({
  id, label, checked, onCheckedChange,
}: {
  id: string; label: string; checked: boolean; onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="scale-75" data-testid={`toggle-${id}`} />
      <Label htmlFor={id} className="text-xs text-muted-foreground cursor-pointer">{label}</Label>
    </div>
  );
}

function RankPill({ label, rank, total }: { label: string; rank: number; total: number }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold text-white">#{rank}<span className="text-[10px] text-muted-foreground">/{total}</span></div>
    </div>
  );
}

function SettingPill({ value, highlight }: { value: string; highlight?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold",
        highlight
          ? "bg-[#0b3a7a]/30 border border-[#0b3a7a]/50 text-blue-300"
          : "bg-[#1a2d4a]/60 border border-[#1a2d4a] text-muted-foreground"
      )}
    >
      {value}
    </span>
  );
}

function PlayerRow({
  player, value, hideValues, showAge,
}: {
  player: Player; value: number; hideValues: boolean; showAge: boolean;
}) {
  const sleeperId = player.sleeperId ?? player.id;
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5" data-testid={`player-row-${player.id}`}>
      <div className="w-8 h-8 rounded-full bg-muted overflow-hidden ring-1 ring-border/30 flex-shrink-0">
        <img
          src={`https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`}
          alt={player.name}
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            const el = e.target as HTMLImageElement;
            el.style.display = "none";
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold truncate">{player.name}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{player.team || "—"}</span>
          {showAge && player.age > 0 && <span>· Age {player.age}</span>}
        </div>
      </div>
      {!hideValues && value > 0 && (
        <span className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 tabular-nums flex-shrink-0">
          {value.toLocaleString()}
        </span>
      )}
    </div>
  );
}
