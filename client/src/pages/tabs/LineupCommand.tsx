import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSleeper } from "@/contexts/SleeperContext";
import { usePlayerProfile } from "@/contexts/PlayerProfileContext";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { cn } from "@/lib/utils";
import { getPositionColor } from "@/data/mockData";
import {
  AlertTriangle, TrendingUp, Zap, Users, CalendarX,
  ChevronDown, ChevronUp, RefreshCw, Lock, CheckCircle2,
  ArrowRight, Activity, ArrowUpDown, Trophy, Shield, Target, Swords,
  Loader2, Pause,
} from "lucide-react";
import { useOptimizeQueue } from "@/services/optimizeQueue";
import { OptimizeAllModal } from "@/components/OptimizeAllModal";
import { toast } from "@/hooks/use-toast";
import { StartSitCompareTab } from "@/components/start-sit/StartSitCompareTab";
import type { SleeperLeagueSummary } from "@/types";
// ── Lineup Command engine (framework-agnostic optimizer) ──────────────────────
import {
  buildSlotCounts, toPlayerLite, statusFlags, optimizeLineup, sumProj,
  buildBenchRecommendations,
} from "@/lib/lineupCommand/optimizer";
import type { EnrichedPlayer, RosterSlot } from "@/lib/lineupCommand/types";
import {
  getWeekSchedule, isPlayerLocked, isTeamOnBye, type GameSchedule,
} from "@/lib/lineupCommand/gameLocking";
import { getLeagueMatchupsForLocking } from "@/lib/lineupCommand/sleeper";
import { isBestBallLeague } from "@/lib/lineupCommand/isBestBall";
import { submitLineup } from "@/services/sleeperAuthedApi";
import { calculateWinProbability } from "@/lib/lineupCommand/winProbability";
import { scoreByLeague } from "@/lib/lineupCommand/scoring";
import { mapSleeperStatsToScoring } from "@/lib/lineupCommand/projectionProviders";

export const SLEEPER_API = "https://api.sleeper.app/v1";

// Slot eligibility now lives in the engine (lib/lineupCommand/slotRules).
const NON_STARTER = new Set(["BN", "TAXI", "IR"]);
const ACTIVE_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

// ─── Types ────────────────────────────────────────────────────────────────────
type IssueType = "out" | "ir" | "doubtful" | "questionable" | "bye";

interface LineupIssue {
  type: IssueType;
  pid: string;
  playerName: string;
  pos: string;
}

interface SwapRec {
  inName: string;
  outName: string;
  inPos: string;
  outPos: string;
  projGain: number;
}

// A roster-health problem that blocks Sleeper from accepting an optimized
// lineup until the user fixes it in Sleeper: players sitting in an IR slot who
// are no longer IR-eligible, and/or a roster carrying more players than the
// active roster allows (over-rostered). Surfaced as a pill next to the league.
interface RosterAlert {
  illegalIrNames: string[]; // reserve players whose status no longer qualifies for IR
  overBy: number;           // how many players over the active-roster limit (0 if none)
}

interface LeagueAnalysis {
  leagueId: string;
  leagueName: string;
  format: string;
  scoringFormat: string;
  avatar?: string | null;
  rosterId: number;
  optimalStarters: string[];
  currentProj: number;
  optimalProj: number;
  gain: number;
  issues: LineupIssue[];
  swaps: SwapRec[];
  rosterAlert?: RosterAlert | null;
  loading: boolean;
  error: boolean;
}

// ─── Types (matchup) ─────────────────────────────────────────────────────────
export interface StarterDetail {
  pid: string;
  name: string;
  pos: string;
  proj: number;
  injury?: string;
}

interface MatchupAnalysis {
  leagueId: string;
  leagueName: string;
  format: string;
  scoringFormat: string;
  avatar?: string | null;
  myRosterId: number;
  myTeamName: string;
  myUserAvatar?: string | null;
  myRecord: { wins: number; losses: number; ties: number };
  myProj: number;
  myStarters: StarterDetail[];
  opponentRosterId: number | null;
  opponentTeamName: string;
  opponentUserAvatar?: string | null;
  opponentRecord: { wins: number; losses: number; ties: number };
  opponentProj: number;
  opponentStarters: StarterDetail[];
  spread: number;
  winPct: number;
  // League hasn't drafted yet (Sleeper status "pre_draft"/"drafting"): there are
  // no real rosters or schedule, so it must read as "Pre-Draft", not "Bye Week".
  predraft: boolean;
  loading: boolean;
  error: boolean;
}

// ─── IR / Taxi types ──────────────────────────────────────────────────────────
interface IrTaxiPlayer {
  pid: string;
  name: string;
  pos: string;
  team: string;
  injury?: string;
}
interface IrTaxiAnalysis {
  leagueId: string;
  leagueName: string;
  avatar: string | null;
  irCapacity: number;                                  // # of IR slots the league offers
  taxiCapacity: number;                                // # of taxi slots the league offers
  taxiPlayers: IrTaxiPlayer[];                         // current taxi squad
  irPlayers: Array<IrTaxiPlayer & { ineligible: boolean }>; // current IR occupants (+ flag)
  irCandidates: IrTaxiPlayer[];                        // IR-eligible players sitting on the active roster
  loading: boolean;
  error: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
function recordWinPct(w: number, l: number, t: number): number {
  const total = w + l + t;
  return total > 0 ? ((w + t * 0.5) / total) * 100 : 0;
}

export function projKey(scoringFormat: string): "pts_ppr" | "pts_half_ppr" | "pts_std" {
  const f = scoringFormat.toLowerCase();
  if (f.includes("ppr") && !f.includes("half")) return "pts_ppr";
  if (f.includes("half"))                        return "pts_half_ppr";
  return "pts_std";
}

// Shared, memoized fetch of a league's scoring_settings so the Matchups and
// Lineups effects (and re-runs triggered by projection refreshes) issue a single
// /league/:id request per league. Returns null when unavailable so callers fall
// back to Sleeper's canned PPR/Half/Std totals. Cleared by the tab's refresh().
const leagueScoringCache = new Map<string, Promise<Record<string, number> | null>>();
export function getLeagueScoring(leagueId: string): Promise<Record<string, number> | null> {
  let cached = leagueScoringCache.get(leagueId);
  if (!cached) {
    cached = fetch(`${SLEEPER_API}/league/${leagueId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(obj => {
        const s = obj?.scoring_settings;
        return s && Object.keys(s).length > 0 ? (s as Record<string, number>) : null;
      })
      .catch(() => null);
    leagueScoringCache.set(leagueId, cached);
  }
  return cached;
}

function lastName(playerDb: Record<string, any>, pid: string): string {
  const p = playerDb[pid];
  if (!p) return pid.slice(0, 8);
  return p.last_name || p.full_name?.split(" ").slice(1).join(" ") || p.full_name || pid;
}

export function fullName(playerDb: Record<string, any>, pid: string): string {
  const p = playerDb[pid];
  if (!p) return "—";
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || pid;
}

export function playerPos(playerDb: Record<string, any>, pid: string): string {
  const p = playerDb[pid];
  return p?.position || p?.fantasy_positions?.[0] || "";
}

export function fmt1(n: number): string {
  return n.toFixed(1);
}

// A reserve (IR) slot can only hold a player with a qualifying injury
// designation. A player who is healthy/active again — null/empty status, or
// "Questionable"/"Active" (which mean they're playable) — is NOT IR-eligible in
// any Sleeper league, so leaving them in an IR slot makes the roster illegal
// and blocks lineup submission. We deliberately do NOT flag Out/Doubtful/PUP/
// Sus/COV/NA/DNR: those can be reserve-eligible depending on league settings,
// so flagging them would produce false positives.
function isReserveIneligible(status: string | null | undefined): boolean {
  if (!status) return true;
  const s = status.trim().toLowerCase();
  return s === "" || s === "active" || s === "questionable";
}

// Detect roster-health problems that block Sleeper from accepting an optimized
// lineup: (a) players in IR slots who are no longer IR-eligible, and
// (b) an over-rostered team (more active players than the roster allows — which
// an ineligible IR player can itself cause, since Sleeper counts them against
// the active roster). Returns null when the roster is clean.
//
// NOTE: only meaningful in-season. Sleeper clears injury_status in the
// offseason, which would make every reserve player look ineligible — callers
// must skip this off-season.
function computeRosterAlert(
  myRoster: any,
  rosterPositions: string[],
  playerDb: Record<string, any>,
): RosterAlert | null {
  const reserve: string[] = myRoster?.reserve || [];
  const taxi: string[] = myRoster?.taxi || [];
  const players: string[] = myRoster?.players || [];

  const illegalIrNames: string[] = [];
  const validReserve = new Set<string>();
  for (const pid of reserve) {
    if (isReserveIneligible(playerDb[pid]?.injury_status)) illegalIrNames.push(lastName(playerDb, pid));
    else validReserve.add(pid);
  }

  // Active-roster capacity = every slot that isn't IR or TAXI (starters + bench).
  // Players that count against it = everyone except taxi members and players
  // validly stashed on IR. An ineligible IR player therefore counts here.
  const activeCapacity = rosterPositions.filter((s) => s !== "IR" && s !== "TAXI").length;
  const taxiSet = new Set(taxi);
  const activeOccupants = players.filter((p) => !taxiSet.has(p) && !validReserve.has(p)).length;
  const overBy = Math.max(0, activeOccupants - activeCapacity);

  if (illegalIrNames.length === 0 && overBy === 0) return null;
  return { illegalIrNames, overBy };
}

// Human-readable explanation for the roster-alert pill's tooltip.
function rosterAlertText(a: RosterAlert): string {
  const parts: string[] = [];
  if (a.illegalIrNames.length > 0) {
    const n = a.illegalIrNames.length;
    parts.push(`${n} player${n > 1 ? "s" : ""} in an IR slot ${n > 1 ? "are" : "is"} no longer IR-eligible (${a.illegalIrNames.join(", ")}).`);
  }
  if (a.overBy > 0) {
    parts.push(`Roster is ${a.overBy} player${a.overBy > 1 ? "s" : ""} over the limit.`);
  }
  parts.push("Fix this in Sleeper to enable Optimize for this league.");
  return parts.join(" ");
}

// Build the IR / Taxi picture for a single league's roster: who's on taxi, who's
// in IR (and whether they still qualify), and which rostered players are
// IR-eligible and could be stashed to free an active-roster spot.
function buildIrTaxi(
  myRoster: any,
  rosterPositions: string[],
  playerDb: Record<string, any>,
  taxiSlots: number,
  reserveSlots: number,
): Pick<IrTaxiAnalysis, "irCapacity" | "taxiCapacity" | "taxiPlayers" | "irPlayers" | "irCandidates"> {
  const reserve: string[] = myRoster?.reserve || [];
  const taxi: string[] = myRoster?.taxi || [];
  const players: string[] = myRoster?.players || [];
  // IR/taxi capacity are league settings (settings.reserve_slots / taxi_slots).
  // Some older leagues instead list "IR" in roster_positions, so take the max.
  const irCapacity = Math.max(rosterPositions.filter((s) => s === "IR").length, Math.max(0, reserveSlots));
  const taxiCapacity = Math.max(0, taxiSlots);

  const toPlayer = (pid: string): IrTaxiPlayer => ({
    pid,
    name: fullName(playerDb, pid),
    pos: playerPos(playerDb, pid),
    team: (playerDb[pid]?.team as string) || "",
    injury: playerDb[pid]?.injury_status as string | undefined,
  });

  const taxiPlayers = taxi.map(toPlayer);
  const irPlayers = reserve.map((pid) => ({
    ...toPlayer(pid),
    // Already in an IR slot but no longer carries a qualifying injury → must be moved.
    ineligible: isReserveIneligible(playerDb[pid]?.injury_status),
  }));

  // Candidates = active-roster players (not already on IR or taxi) who DO carry a
  // qualifying injury and could therefore be moved to IR.
  const reserveSet = new Set(reserve);
  const taxiSet = new Set(taxi);
  const irCandidates = players
    .filter((pid) => pid && pid !== "0" && !reserveSet.has(pid) && !taxiSet.has(pid))
    .filter((pid) => !isReserveIneligible(playerDb[pid]?.injury_status))
    .map(toPlayer);

  return { irCapacity, taxiCapacity, taxiPlayers, irPlayers, irCandidates };
}

// ─── Core lineup analysis (powered by the Lineup Command engine) ───────────────
// The engine in client/src/lib/lineupCommand is framework-agnostic. We enrich
// each Sleeper player_id into the engine's EnrichedPlayer shape — scoring each
// player's projected stat line with the league's scoring_settings (falling back
// to Sleeper's canned PPR/Half/Std total), zeroing OUT players, and applying
// game-locking — then run the engine's slot-eligibility-aware optimizer and
// bench-recommendation logic.
export function analyzeLineup(
  allPlayerIds: string[],
  rawStarters: (string | null)[],                    // unfiltered: index aligns with starting slots
  rawProj: Record<string, Record<string, number>>,  // pid → {pts_ppr, pts_half_ppr, pts_std}
  playerDb: Record<string, any>,
  rosterPositions: string[],
  scoringFormat: string,
  season: string,
  week: string,
  schedule: GameSchedule,
  playedPlayerIds: Record<string, boolean>,
  actualPoints: Record<string, number>,
  scoring: Record<string, number> | null,
  lockingEnabled: boolean,
): Omit<LeagueAnalysis, "leagueId" | "leagueName" | "format" | "scoringFormat" | "loading" | "error" | "rosterId"> {
  const field = projKey(scoringFormat);
  const now = Date.now();

  // League-accurate projection: score the player's projected stat line with this
  // league's scoring_settings (falls back to Sleeper's canned PPR/Half/Std total
  // when settings are unavailable or there's no stat line; the engine also uses
  // the canned total for K/DEF by design).
  const projFor = (pid: string): number => {
    const rawStats = rawProj[pid];
    if (!rawStats) return 0;
    const fallback = rawStats[field] ?? 0;
    if (!scoring) return fallback;
    return scoreByLeague(playerPos(playerDb, pid), mapSleeperStatsToScoring(rawStats), scoring, fallback);
  };

  // pid → EnrichedPlayer (proj from Sleeper, OUT zeroed, lock-aware actuals).
  const enrich = (pid: string): EnrichedPlayer | null => {
    const lite = toPlayerLite(playerDb, pid);
    if (!lite) return null;
    let proj = projFor(pid);
    // Zero OUT players so they never read as "optimal".
    if (statusFlags({ ...lite, proj }).includes("OUT")) proj = 0;
    // In the offseason there is no live week to lock against; skip locking so the
    // optimizer can freely rank the full roster (otherwise every player reads as
    // locked and the optimal lineup is forced to equal the current one).
    const locked = lockingEnabled && isPlayerLocked(lite, schedule, now, playedPlayerIds, actualPoints);
    // Once a player's game has locked, prefer their actual scored points — but only
    // once they've genuinely played (playedPlayerIds is set only for non-zero
    // points, mirroring isPlayerLocked's own "0 before kickoff doesn't count"
    // rule). A recorded 0 must not overwrite the projection: that's what preseason
    // matchups report, and in the offseason the schedule resolves to a prior
    // season's finished games, so every starter would otherwise read as 0.
    if (locked && playedPlayerIds[pid] && actualPoints[pid] != null) proj = actualPoints[pid];
    const opp = isTeamOnBye(lite.team, schedule) ? "BYE" : undefined;
    // Kickoff time powers game-time-aware slotting (earlier games fill dedicated
    // slots, later games fill FLEX/SUPER_FLEX) and auto-sub timing.
    const gameStart = lite.team ? schedule[lite.team.toUpperCase()]?.start : undefined;
    return { ...lite, proj, opp, locked, gameStart };
  };

  // Slot labels for the starting lineup, in Sleeper's roster_positions order.
  const startingSlots = rosterPositions.filter(s => !NON_STARTER.has(s));
  const validStarters = rawStarters.filter((id): id is string => !!id && id !== "0");

  // Enrich the full roster pool (used as the optimizer's candidate set).
  const rosterPlayers = allPlayerIds
    .filter(pid => pid && pid !== "0")
    .map(enrich)
    .filter((p): p is EnrichedPlayer => !!p && ACTIVE_POS.has(p.pos));
  const enrichedById = new Map(rosterPlayers.map(p => [p.player_id, p]));

  // Tier 1 — current lineup, placed in its actual slots (for diff + currentProj).
  const currentSlots: RosterSlot[] = startingSlots.map((slot, i) => {
    const pid = rawStarters[i];
    const player = pid && pid !== "0" ? (enrichedById.get(pid) ?? enrich(pid) ?? undefined) : undefined;
    return player ? { slot, player } : { slot };
  });
  const currentProj = currentSlots.reduce((s, slot) => s + (slot.player?.proj ?? 0), 0);

  // Tier 2 — bench-optimal lineup (roster only), respecting locks.
  const slotCounts = buildSlotCounts(rosterPositions);
  const optimalSlots = optimizeLineup(slotCounts, rosterPlayers, season, week, rawStarters, true);
  const optimalProj = sumProj(optimalSlots);

  // Bench→starter recommendations (lock-aware, blocked moves removed).
  const { filteredRecommendations } = buildBenchRecommendations(
    currentSlots, optimalSlots, validStarters, rosterPlayers,
  );
  const swaps: SwapRec[] = filteredRecommendations
    .map(r => ({
      inName:   fullName(playerDb, r.in.player_id),
      outName:  r.out?.player_id ? fullName(playerDb, r.out.player_id) : "—",
      inPos:    r.in.pos || playerPos(playerDb, r.in.player_id),
      outPos:   r.out?.player_id ? (r.out.pos || playerPos(playerDb, r.out.player_id)) : "",
      projGain: r.delta,
    }))
    .filter(s => s.projGain > 0.5);

  // Issues: injured / bye starters (schedule-aware bye detection).
  const issues: LineupIssue[] = [];
  for (const pid of validStarters) {
    const inj  = playerDb[pid]?.injury_status as string | undefined;
    const team = playerDb[pid]?.team as string | undefined;
    const name = lastName(playerDb, pid);
    const pos  = playerPos(playerDb, pid);
    const onBye = isTeamOnBye(team, schedule) || projFor(pid) < 0.5;
    if      (inj === "IR")           issues.push({ type: "ir",           pid, playerName: name, pos });
    else if (inj === "Out")          issues.push({ type: "out",          pid, playerName: name, pos });
    else if (inj === "Doubtful")     issues.push({ type: "doubtful",     pid, playerName: name, pos });
    else if (inj === "Questionable") issues.push({ type: "questionable", pid, playerName: name, pos });
    else if (onBye && team && pos !== "DEF" && pos !== "K")
                                     issues.push({ type: "bye",          pid, playerName: name, pos });
  }

  const optimalStarters = optimalSlots
    .map(s => s.player?.player_id)
    .filter((id): id is string => !!id);

  return { currentProj, optimalProj, gain: optimalProj - currentProj, issues, swaps, optimalStarters };
}

// ─── Issue badge ─────────────────────────────────────────────────────────────
function IssueBadge({ type }: { type: IssueType }) {
  const config: Record<IssueType, { label: string; cls: string }> = {
    out:          { label: "OUT",  cls: "bg-red-500/20 text-red-400 border-red-500/40" },
    ir:           { label: "IR",   cls: "bg-red-500/20 text-red-400 border-red-500/40" },
    doubtful:     { label: "DBT",  cls: "bg-orange-500/20 text-orange-400 border-orange-500/40" },
    questionable: { label: "Q",    cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40" },
    bye:          { label: "BYE",  cls: "bg-slate-500/20 text-slate-400 border-slate-500/40" },
  };
  const { label, cls } = config[type];
  return (
    <Badge variant="outline" className={cn("text-[7px] md:text-[8px] px-1 py-0 h-4 font-bold tracking-wide", cls)}>
      {label}
    </Badge>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  // bar = light-mode placeholder bg; the dark-any: variant restores the original
  // glass placeholder so dark + x-mode are untouched.
  const bar = "bg-[var(--sc-border)]/70 dark-any:bg-white/8";
  return (
    <div className="flex items-center gap-1.5 md:gap-3 px-2 md:px-5 py-3 border-b border-[var(--sc-border)] dark-any:border-white/5 animate-pulse">
      <div className={cn("flex-1 min-w-[140px] h-3.5 rounded", bar)} />
      <div className={cn("w-10 md:w-16 flex-shrink-0 h-3.5 rounded", bar)} />
      <div className={cn("w-12 md:w-28 flex-shrink-0 h-3.5 rounded", bar)} />
      <div className={cn("w-8 md:w-24 flex-shrink-0 h-4 rounded", bar)} />
      <div className={cn("w-8 md:w-20 flex-shrink-0 h-4 rounded", bar)} />
      <div className={cn("w-[68px] md:w-[108px] flex-shrink-0 h-7 rounded-lg", bar)} />
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
// Mirrors the My Trades KPI cards: a colored rounded icon box on the left with
// the value + label (and optional sub) stacked beside it, wrapped in the shared
// Card surface. dark-any: keeps colors legible in both dark and x-mode.
function KpiCard({
  icon: Icon, label, value, accent, sub,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: string | number;
  accent: "red" | "gold" | "blue" | "yellow" | "slate" | "emerald";
  sub?: string;
}) {
  // Per-accent icon-box style: tinted background + icon color.
  const colorByAccent: Record<string, string> = {
    red:    "bg-red-500/10 text-red-600 dark-any:text-red-400",
    gold:   "bg-[#d4af37]/10 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]",
    blue:   "bg-blue-500/10 text-blue-600 dark-any:text-blue-400",
    emerald:"bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
    yellow: "bg-yellow-500/10 text-yellow-600 dark-any:text-yellow-400",
    slate:  "bg-slate-500/10 text-slate-500 dark-any:text-slate-400",
  };
  return (
    <Card className="p-4 flex items-start gap-3 min-w-0">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", colorByAccent[accent])}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold tabular-nums leading-tight text-foreground">{value}</p>
        <p className="text-[11px] font-medium leading-tight mt-0.5 text-muted-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{sub}</p>}
      </div>
    </Card>
  );
}

// ─── League row ───────────────────────────────────────────────────────────────
function LeagueRow({ analysis, preseason, onApplied }: { analysis: LeagueAnalysis; preseason?: boolean; onApplied: (leagueId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);
  const { openPlayerProfile } = usePlayerProfile();
  const { leagueName, format, scoringFormat, avatar, currentProj, gain, issues, swaps, rosterAlert, loading, error } = analysis;

  // Push the optimal lineup straight to Sleeper for this league. One click, no
  // confirm (by product choice): submitLineup still runs through the safety
  // kill-switch + write rate-limiter and throws a clear message if Sleeper
  // isn't connected or writes are paused.
  const apply = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const result = await submitLineup(analysis.leagueId, analysis.rosterId, analysis.optimalStarters);
      // Verify Sleeper actually applied our lineup. It can accept the call but
      // keep the old lineup when a target player can't be started (IR/taxi/locked),
      // so don't trust a non-null response alone — compare the returned starters.
      const norm = (a: string[]) => [...a].filter(x => x && x !== "0").sort().join(",");
      if (norm(result.starters ?? []) !== norm(analysis.optimalStarters)) {
        toast({
          title: "Lineup not changed",
          description: `${leagueName}: Sleeper kept your current lineup. The players needed may be on IR/taxi or already locked.`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Lineup updated on Sleeper",
        description: `${leagueName}: optimal lineup set${gain > 0.1 ? ` (+${fmt1(gain)} projected pts)` : ""}.`,
      });
      onApplied(analysis.leagueId);
      setExpanded(false);
    } catch (e: any) {
      toast({
        title: "Couldn't update lineup",
        description: e?.message ?? "Sleeper rejected the request. Please try again.",
        variant: "destructive",
      });
    } finally {
      setApplying(false);
    }
  };

  // Improvement (gain) color — emerald for real gains, muted for none. Light
  // mode uses a darker green so it stays readable on a white background.
  const improvColor =
    gain >= 10  ? "text-emerald-700 dark-any:text-emerald-400" :
    gain >= 3   ? "text-emerald-600 dark-any:text-emerald-500/80" :
    gain > 0.5  ? "text-emerald-600 dark-any:text-emerald-600" :
                  "text-[var(--sc-text-muted)]/60 dark-any:text-white/25";
  const hardIssues = issues.filter(i => i.type === "out" || i.type === "ir" || i.type === "bye");
  const softIssues = issues.filter(i => i.type === "questionable" || i.type === "doubtful");
  const isOptimized = !loading && !error && swaps.length === 0;

  const skeletonBar = "bg-[var(--sc-border)]/70 dark-any:bg-white/8";

  return (
    <div className={cn(
      "border-b last:border-0 transition-colors",
      // Light: slate border + soft hover; dark/x-mode: legacy translucent.
      "border-[#edf2f7] dark-any:border-white/5",
      swaps.length > 0
        ? "hover:bg-[var(--sc-card-soft)] dark-any:hover:bg-white/[0.02]"
        : "hover:bg-[var(--sc-card-soft)]/60 dark-any:hover:bg-white/[0.01]",
    )}>
      {/* Main row */}
      <div
        className="flex items-center gap-1.5 md:gap-3 px-2 md:px-5 py-3 select-none"
        data-testid={`row-lineup-${analysis.leagueId}`}
      >
        {/* League avatar + name + format */}
        <div className="flex-1 min-w-[140px] flex items-center gap-1.5 md:gap-2 cursor-pointer" onClick={() => swaps.length > 0 && setExpanded(v => !v)}>
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="w-6 h-6 md:w-7 md:h-7 rounded-lg flex-shrink-0 object-cover bg-[var(--sc-blue-soft)] dark-any:bg-white/10"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-6 h-6 md:w-7 md:h-7 rounded-lg flex-shrink-0 bg-[var(--sc-blue-soft)] dark-any:bg-[#0b3a7a]/40 flex items-center justify-center">
              <Users className="w-3 h-3 md:w-3.5 md:h-3.5 text-[var(--sc-blue)] dark-any:text-blue-400/60" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-[12px] md:text-sm font-bold truncate leading-tight text-[var(--sc-blue)] dark-any:text-white/90">{leagueName}</p>
              {rosterAlert && (
                <span
                  className="inline-flex items-center gap-0.5 text-[8px] md:text-[9px] font-bold rounded-full px-1 md:px-1.5 py-0.5 bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border border-amber-500/30 flex-shrink-0 cursor-help"
                  title={rosterAlertText(rosterAlert)}
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`roster-alert-${analysis.leagueId}`}
                >
                  <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
                  <span className="hidden md:inline">Fix in Sleeper</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[8px] md:text-[9px] font-medium truncate text-[var(--sc-text-muted)] dark-any:text-white/30">{format} · {scoringFormat}</span>
            </div>
          </div>
        </div>

        {/* Proj (Current) */}
        <div className="text-right w-10 md:w-16 flex-shrink-0">
          {loading ? (
            <div className={cn("h-3.5 rounded animate-pulse", skeletonBar)} />
          ) : preseason ? (
            <span className="text-[10px] font-medium text-[var(--sc-text-muted)] dark-any:text-white/25">N/A</span>
          ) : error ? (
            <span className="text-[10px] text-[var(--sc-text-muted)]/70 dark-any:text-white/20">—</span>
          ) : (
            <p className="text-[11px] md:text-[13px] font-bold tabular-nums text-[var(--sc-text)] dark-any:text-white/60">{fmt1(currentProj)}</p>
          )}
        </div>

        {/* +Pts (Improvement) */}
        <div className="text-right w-12 md:w-28 flex-shrink-0">
          {loading ? (
            <div className={cn("h-3.5 rounded animate-pulse", skeletonBar)} />
          ) : preseason ? (
            <span className="text-[10px] font-medium text-[var(--sc-text-muted)] dark-any:text-white/25">N/A</span>
          ) : error ? (
            <span className="text-[10px] text-[var(--sc-text-muted)]/70 dark-any:text-white/20">—</span>
          ) : (
            <p className={cn("text-[11px] md:text-[13px] font-black tabular-nums", improvColor)}>
              {gain > 0.1 ? `+${fmt1(gain)}` : "—"}
            </p>
          )}
        </div>

        {/* OUT / IR / BYE */}
        <div className="w-8 md:w-24 flex-shrink-0 flex justify-center">
          {loading ? (
            <div className={cn("h-4 w-4 rounded animate-pulse", skeletonBar)} />
          ) : preseason ? (
            <span className="text-[10px] font-medium text-[var(--sc-text-muted)] dark-any:text-white/25">N/A</span>
          ) : hardIssues.length === 0 ? (
            <CheckCircle2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-emerald-600 dark-any:text-emerald-500/60" />
          ) : (
            <span className="text-[12px] md:text-sm font-black tabular-nums text-[#dc2626] dark-any:text-red-400">
              {hardIssues.length}
            </span>
          )}
        </div>

        {/* QUES / DOUB */}
        <div className="w-8 md:w-20 flex-shrink-0 flex justify-center">
          {loading ? (
            <div className={cn("h-4 w-4 rounded animate-pulse", skeletonBar)} />
          ) : preseason ? (
            <span className="text-[10px] font-medium text-[var(--sc-text-muted)] dark-any:text-white/25">N/A</span>
          ) : softIssues.length === 0 ? (
            <CheckCircle2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-emerald-600 dark-any:text-emerald-500/60" />
          ) : (
            <span className="text-[12px] md:text-sm font-black tabular-nums text-[#d97706] dark-any:text-yellow-400">
              {softIssues.length}
            </span>
          )}
        </div>

        {/* Status */}
        <div className="w-[68px] md:w-[108px] flex-shrink-0 flex justify-end">
          {loading ? (
            <div className={cn("h-6 w-[56px] md:w-20 rounded-full animate-pulse", skeletonBar)} />
          ) : error ? (
            <span className="text-[10px] text-[var(--sc-text-muted)]/70 dark-any:text-white/20">—</span>
          ) : isOptimized ? (
            <span className="inline-flex items-center justify-center gap-1 text-[10px] font-bold rounded-full px-2 py-1 bg-[var(--sc-success-soft)] text-[var(--sc-success)] border border-[var(--sc-success-border)] dark-any:bg-emerald-500/10 dark-any:text-emerald-400 dark-any:border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              <span className="hidden md:inline">Optimized</span>
            </span>
          ) : (
            <button
              className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 md:px-2.5 py-1 transition-colors bg-[var(--sc-gold)] hover:bg-[var(--sc-gold-deep)] text-[var(--sc-blue)] hover:text-white border border-[var(--sc-gold-deep)] disabled:opacity-60 disabled:cursor-not-allowed dark-any:bg-[#d4af37]/15 dark-any:hover:bg-[#d4af37]/25 dark-any:border-[#d4af37]/35 dark-any:hover:border-[#d4af37]/55 dark-any:text-[#d4af37] dark-any:hover:text-[#d4af37]"
              // Temporarily disabled: surface a "feature disabled" notice instead
              // of applying the optimal lineup. Re-enable by restoring onClick={apply}.
              onClick={() => toast({
                title: "Feature currently disabled",
                description: "This feature is currently disabled and will be back up soon.",
              })}
              title="Optimize is temporarily disabled"
              data-testid={`button-optimize-${analysis.leagueId}`}
            >
              <Zap className="w-3 h-3 flex-shrink-0" />
              <span className="hidden md:inline">Optimize</span>
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-3 md:px-5 pb-4 space-y-3 border-t pt-3 border-[var(--sc-border)] bg-[var(--sc-card-soft)] dark-any:border-white/4 dark-any:bg-white/[0.015]">

          {/* Recommended swaps */}
          {swaps.length > 0 && (
            <div>
              <p className="sc-eyebrow mb-2 dark-any:text-white/30 dark-any:tracking-widest">
                Recommended Swaps
              </p>
              <div className="space-y-1.5">
                {swaps.map((swap, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2 border border-[var(--sc-border)] dark-any:border-white/10">
                    <TrendingUp className="w-3 h-3 text-[var(--sc-text-muted)] dark-any:text-white/40 flex-shrink-0" />
                    <span className="text-[10px] md:text-[11px] font-semibold text-[var(--sc-success)] dark-any:text-emerald-400">Start</span>
                    <span className="text-[11px] md:text-xs font-bold text-[var(--sc-text)] dark-any:text-white/90">{swap.inName}</span>
                    <Badge variant="outline" className={cn("text-[7px] px-1 py-0 h-3.5 border", getPositionColor(swap.inPos))}>{swap.inPos}</Badge>
                    <ArrowRight className="w-3 h-3 text-[var(--sc-text-muted)]/60 dark-any:text-white/20 flex-shrink-0 mx-1" />
                    <span className="text-[10px] md:text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/40">over</span>
                    <span className="text-[11px] md:text-xs font-semibold text-[var(--sc-text)] dark-any:text-white/60">{swap.outName}</span>
                    {swap.outPos && (
                      <Badge variant="outline" className={cn("text-[7px] px-1 py-0 h-3.5 border", getPositionColor(swap.outPos))}>{swap.outPos}</Badge>
                    )}
                    {swap.projGain > 0 && (
                      <span className="ml-auto text-[10px] font-bold tabular-nums text-[var(--sc-success)] dark-any:text-emerald-400">+{fmt1(swap.projGain)} pts</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active issues */}
          {issues.length > 0 && (
            <div>
              <p className="sc-eyebrow mb-2 dark-any:text-white/30 dark-any:tracking-widest">
                Starter Alerts
              </p>
              <div className="flex flex-wrap gap-1.5">
                {issues.map((iss, i) => {
                  const typeLabel: Record<IssueType, string> = {
                    out: "Out", ir: "IR", doubtful: "Doubtful", questionable: "Questionable", bye: "Bye Week"
                  };
                  // Light: pale-tinted pill with strong text. Dark: legacy translucent.
                  const typeCls: Record<IssueType, string> = {
                    out:          "bg-[var(--sc-danger-soft)] border-[#fecaca] text-[var(--sc-danger)] dark-any:bg-red-500/10 dark-any:border-red-500/30 dark-any:text-red-400",
                    ir:           "bg-[var(--sc-danger-soft)] border-[#fecaca] text-[var(--sc-danger)] dark-any:bg-red-500/10 dark-any:border-red-500/30 dark-any:text-red-400",
                    doubtful:     "bg-[#fff7ed] border-[#fed7aa] text-[#c2410c] dark-any:bg-orange-500/10 dark-any:border-orange-500/30 dark-any:text-orange-400",
                    questionable: "bg-[var(--sc-warning-soft)] border-[#fde68a] text-[var(--sc-warning)] dark-any:bg-yellow-500/10 dark-any:border-yellow-500/30 dark-any:text-yellow-400",
                    bye:          "bg-[var(--sc-blue-soft)] border-[var(--sc-border-strong)] text-[var(--sc-text)] dark-any:bg-slate-500/10 dark-any:border-slate-500/30 dark-any:text-slate-400",
                  };
                  return (
                    <div key={i} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px]", typeCls[iss.type])}>
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      <span className="font-bold">{iss.playerName}</span>
                      <span className="opacity-70">({iss.pos})</span>
                      <span className="font-medium">· {typeLabel[iss.type]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Matchup skeleton card ────────────────────────────────────────────────────
function MatchupSkeletonRow() {
  const bar = "bg-[var(--sc-border)]/70 dark-any:bg-white/8";
  return (
    <div className="px-3.5 md:px-5 py-3.5 border-b border-[var(--sc-border)] dark-any:border-white/5 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("w-5 h-5 rounded", bar)} />
        <div className={cn("h-2.5 w-28 rounded", bar)} />
        <div className={cn("ml-auto h-3 w-16 rounded-full", bar)} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 md:gap-4">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-10 h-10 md:w-11 md:h-11 rounded-full flex-shrink-0", bar)} />
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className={cn("h-3 w-24 rounded", bar)} />
            <div className={cn("h-2 w-10 rounded", bar)} />
            <div className={cn("h-5 w-14 rounded mt-1", bar)} />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 w-[68px] md:w-[88px]">
          <div className={cn("h-2 w-12 rounded", bar)} />
          <div className={cn("h-6 w-14 rounded", bar)} />
          <div className={cn("h-2 w-10 rounded", bar)} />
        </div>
        <div className="flex items-center justify-end gap-2.5">
          <div className="space-y-1.5 items-end flex flex-col min-w-0">
            <div className={cn("h-3 w-24 rounded", bar)} />
            <div className={cn("h-2 w-10 rounded", bar)} />
            <div className={cn("h-5 w-14 rounded mt-1", bar)} />
          </div>
          <div className={cn("w-10 h-10 md:w-11 md:h-11 rounded-full flex-shrink-0", bar)} />
        </div>
      </div>
      <div className={cn("mt-3.5 h-1.5 rounded-full", bar)} />
    </div>
  );
}

// ─── Matchup battle card ──────────────────────────────────────────────────────
function MatchupBattleCard({ m, preseason }: { m: MatchupAnalysis; preseason?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const { openPlayerProfile } = usePlayerProfile();

  // Starter name: clickable to the player profile when the id is a real Sleeper
  // player id (numeric). K/DEF and synthetic ids stay plain text. Click stops
  // propagation so it doesn't toggle the card's expand handler.
  const StarterName = ({ s, className }: { s: StarterDetail; className: string }) => {
    if (!/^\d+$/.test(s.pid)) {
      return <span className={className}>{s.name}</span>;
    }
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); openPlayerProfile(s.pid); }}
        className={cn(className, "text-left hover:text-[#d4af37] transition-colors cursor-pointer")}
        data-testid={`player-link-${s.pid}`}
        title={`View ${s.name}`}
      >
        {s.name}
      </button>
    );
  };

  const predraft  = m.predraft;
  // A predraft league has no opponent yet, but it's NOT a bye — treat it separately.
  const hasBye    = m.opponentRosterId === null && !predraft;
  const isFav     = m.spread > 0;
  const absSpread = Math.abs(m.spread);
  const isClose   = absSpread < 3;

  const theme =
    m.winPct >= 65 ? { bar: "#22c55e", txt: "text-emerald-400", soft: "text-emerald-400/70" } :
    m.winPct >= 50 ? { bar: "#60a5fa", txt: "text-blue-400",    soft: "text-blue-400/70"    } :
    m.winPct >= 35 ? { bar: "#facc15", txt: "text-yellow-400",  soft: "text-yellow-400/70"  } :
                     { bar: "#f87171", txt: "text-red-400",     soft: "text-red-400/70"     };

  const canExpand = !preseason && !hasBye && m.myStarters.length > 0;

  const injLabel = (inj?: string) => {
    if (!inj) return null;
    if (inj === "Out" || inj === "IR") return "OUT";
    if (inj === "Doubtful") return "DBT";
    if (inj === "Questionable") return "Q";
    return null;
  };

  const myInitial  = m.myTeamName.trim().charAt(0).toUpperCase() || "?";
  const oppInitial = (hasBye || predraft) ? "—" : (m.opponentTeamName.trim().charAt(0).toUpperCase() || "?");

  // Hard injury flags from my starters
  const myInjuryCount = useMemo(
    () => m.myStarters.filter(s => s.injury === "Out" || s.injury === "IR").length,
    [m.myStarters]
  );

  return (
    <div
      className={cn(
        "group/card border-b border-[var(--sc-border)] dark-any:border-white/[0.07] last:border-0 transition-colors duration-200",
        canExpand && "cursor-pointer hover:bg-black/[0.03] dark-any:hover:bg-white/[0.018]"
      )}
      data-testid={`card-matchup-${m.leagueId}`}
      onClick={() => canExpand && setExpanded(v => !v)}
    >
      {/* ─── League strip (injury flag only) ──────────────────────── */}
      {myInjuryCount > 0 && !preseason && (
        <div className="flex items-center gap-2 px-3.5 md:px-5 pt-2.5 pb-2 min-w-0">
          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 rounded-full px-1.5 py-0.5 flex-shrink-0">
            <AlertTriangle className="w-2.5 h-2.5" />
            {myInjuryCount}
          </span>
        </div>
      )}

      {/* ─── Body ─────────────────────────────────────────────────── */}
      <div className="px-3.5 md:px-5 pb-3.5 pt-3.5 md:pt-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 md:gap-4">

          {/* My team */}
          <div className="min-w-0 flex items-center gap-2 md:gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-[#0b3a7a]/65 ring-2 ring-[#d4af37]/35 flex items-center justify-center flex-shrink-0 shadow-md overflow-hidden">
              {m.myUserAvatar ? (
                <img
                  src={m.myUserAvatar}
                  alt={m.myTeamName}
                  className="w-full h-full object-cover"
                  onError={e => {
                    // Drop the broken <img> so the initial fallback (sibling) shows.
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
                    if (sib) sib.style.display = "";
                  }}
                />
              ) : null}
              <span
                className="text-base md:text-lg font-black text-[var(--sc-gold-deep)] dark-any:text-[#d4af37] leading-none select-none"
                style={{ display: m.myUserAvatar ? "none" : undefined }}
              >{myInitial}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] md:text-sm font-black text-[var(--sc-text)] dark-any:text-white/90 truncate leading-tight">{m.myTeamName}</p>
              <p className="text-[10px] md:text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/35 tabular-nums leading-tight mt-0.5">
                {fmtRecord(m.myRecord.wins, m.myRecord.losses, m.myRecord.ties)}
              </p>
              {!preseason && !predraft && (
                <p className={cn(
                  "text-[22px] md:text-[28px] font-black tabular-nums leading-none mt-1",
                  isFav && !isClose ? theme.txt : "text-[var(--sc-text-muted)] dark-any:text-white/75"
                )}>
                  {fmt1(m.myProj)}
                </p>
              )}
            </div>
          </div>

          {/* Center */}
          <div className="flex flex-col items-center justify-center flex-shrink-0 w-[80px] md:w-[108px]">
            {m.avatar ? (
              <img src={m.avatar} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0 ring-1 ring-black/5 dark-any:ring-white/10 mb-1"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-6 h-6 rounded flex-shrink-0 bg-[#0b3a7a]/40 ring-1 ring-black/5 dark-any:ring-white/10 mb-1" />
            )}
            <span className="text-[9px] md:text-[10px] font-bold text-[var(--sc-text-muted)] dark-any:text-white/55 uppercase tracking-wider text-center leading-tight mb-1.5 line-clamp-2">
              {m.leagueName}
            </span>
            {predraft ? (
              <div className="text-[10px] md:text-[12px] font-black text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]/70 tracking-[0.18em] text-center leading-tight">PRE-<br />DRAFT</div>
            ) : preseason ? (
              <div className="text-[11px] md:text-[12px] font-black text-[var(--sc-text-muted)] dark-any:text-white/22 tracking-[0.3em]">VS</div>
            ) : hasBye ? (
              <>
                <div className="text-[8px] md:text-[9px] font-bold text-[var(--sc-text-muted)] dark-any:text-white/25 tracking-[0.25em]">WEEK</div>
                <div className="text-[15px] md:text-[18px] font-black text-[var(--sc-text-muted)] dark-any:text-white/30 tracking-wider leading-none mt-1">BYE</div>
              </>
            ) : (
              <>
                <div className="text-[8px] md:text-[9px] font-bold text-[var(--sc-text-muted)] dark-any:text-white/30 tracking-[0.25em]">WIN&nbsp;%</div>
                <div className={cn("text-[24px] md:text-[30px] font-black tabular-nums leading-none mt-0.5", theme.txt)}>
                  {Math.round(m.winPct)}
                  <span className="text-[11px] md:text-[13px] ml-0.5 opacity-75">%</span>
                </div>
                <div className="text-[9px] md:text-[10px] text-[var(--sc-text-muted)] dark-any:text-white/40 tabular-nums font-bold mt-0.5">
                  {isClose ? "Pick 'em" : `${isFav ? "+" : "−"}${fmt1(absSpread)}`}
                </div>
              </>
            )}
          </div>

          {/* Opponent (mirrored) */}
          <div className="min-w-0 flex items-center justify-end gap-2 md:gap-3">
            <div className="min-w-0 text-right">
              <p className={cn(
                "text-[12px] md:text-sm font-black truncate leading-tight",
                (hasBye || predraft) ? "text-[var(--sc-text-muted)] dark-any:text-white/40" : "text-[var(--sc-text-muted)] dark-any:text-white/65"
              )}>
                {predraft ? "Not drafted yet" : hasBye ? "Bye Week" : m.opponentTeamName}
              </p>
              <p className="text-[10px] md:text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/25 tabular-nums leading-tight mt-0.5">
                {(hasBye || predraft) ? "" : fmtRecord(m.opponentRecord.wins, m.opponentRecord.losses, m.opponentRecord.ties)}
              </p>
              {!preseason && !hasBye && !predraft && (
                <p className={cn(
                  "text-[22px] md:text-[28px] font-black tabular-nums leading-none mt-1",
                  !isFav && !isClose ? theme.txt : "text-[var(--sc-text-muted)] dark-any:text-white/50"
                )}>
                  {fmt1(m.opponentProj)}
                </p>
              )}
            </div>
            <div className={cn(
              "w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center flex-shrink-0 ring-2 shadow-md overflow-hidden",
              (hasBye || predraft) ? "bg-black/[0.03] ring-black/5 dark-any:bg-white/5 dark-any:ring-white/10" : "bg-black/[0.03] ring-black/5 dark-any:bg-white/8 dark-any:ring-white/18"
            )}>
              {!hasBye && !predraft && m.opponentUserAvatar ? (
                <img
                  src={m.opponentUserAvatar}
                  alt={m.opponentTeamName}
                  className="w-full h-full object-cover"
                  onError={e => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
                    if (sib) sib.style.display = "";
                  }}
                />
              ) : null}
              <span
                className={cn("text-base md:text-lg font-black leading-none select-none", (hasBye || predraft) ? "text-[var(--sc-text-muted)] dark-any:text-white/25" : "text-[var(--sc-text-muted)] dark-any:text-white/55")}
                style={{ display: !hasBye && !predraft && m.opponentUserAvatar ? "none" : undefined }}
              >
                {oppInitial}
              </span>
            </div>
          </div>
        </div>

        {/* Preseason hint */}
        {preseason && (
          <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-black/[0.03] dark-any:bg-white/[0.025] border border-[var(--sc-border)] dark-any:border-white/6 py-2">
            <CalendarX className="w-3 h-3 text-yellow-400/45" />
            <span className="text-[10px] md:text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/40">Waiting for weekly projections…</span>
          </div>
        )}

        {/* Win-probability bar */}
        {!preseason && !hasBye && !predraft && (
          <div className="mt-3.5">
            <div className="relative h-2 rounded-full bg-black/[0.03] dark-any:bg-white/6 overflow-hidden ring-1 ring-black/5 dark-any:ring-white/5">
              <div
                className="absolute inset-y-0 left-0 transition-all duration-700"
                style={{ width: `${m.winPct}%`, backgroundColor: theme.bar, opacity: 0.92 }}
              />
            </div>
            <div className="flex justify-between mt-1 px-0.5">
              <span className={cn("text-[9px] md:text-[10px] tabular-nums font-bold", theme.txt)}>
                {Math.round(m.winPct)}%
              </span>
              <span className="text-[9px] md:text-[10px] text-[var(--sc-text-muted)] dark-any:text-white/35 tabular-nums font-bold">
                {Math.round(100 - m.winPct)}%
              </span>
            </div>
          </div>
        )}

        {/* Expand affordance */}
        {canExpand && (
          <div className="flex items-center justify-center mt-2 gap-1 text-[var(--sc-text-muted)] dark-any:text-white/22 group-hover/card:text-[var(--sc-text)] dark-any:group-hover/card:text-white/50 transition-colors">
            <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider">
              {expanded ? "Hide" : "Show"} lineup
            </span>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </div>
        )}
      </div>

      {/* ─── Expanded panel ───────────────────────────────────────── */}
      {expanded && !preseason && (
        <div
          className="px-3.5 md:px-5 pb-4 pt-3 border-t border-[var(--sc-border)] dark-any:border-white/4 bg-black/[0.03] dark-any:bg-white/[0.012] space-y-4"
          onClick={e => e.stopPropagation()}
        >
          {/* Starters side-by-side */}
          <div className="grid grid-cols-2 gap-4 md:gap-6">
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]/55 mb-2 truncate">{m.myTeamName}</p>
              <div className="space-y-1.5">
                {m.myStarters.filter(s => s.pos !== "K" && s.pos !== "DEF").map((s, i) => {
                  const inj = injLabel(s.injury);
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[8px] font-bold text-[var(--sc-text-muted)] dark-any:text-white/30 w-7 flex-shrink-0">{s.pos}</span>
                      <StarterName s={s} className="text-[11px] text-[var(--sc-text)] dark-any:text-white/80 flex-1 truncate" />
                      {inj && (
                        <span className={cn(
                          "text-[7px] font-bold flex-shrink-0 px-1 rounded",
                          inj === "OUT" ? "text-red-400 bg-red-500/10" : "text-yellow-400 bg-yellow-500/10"
                        )}>{inj}</span>
                      )}
                      <span className="text-[11px] font-bold text-[var(--sc-text-muted)] dark-any:text-white/55 tabular-nums flex-shrink-0 ml-1">{fmt1(s.proj)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--sc-text-muted)] dark-any:text-white/35 mb-2 truncate">{m.opponentTeamName}</p>
              <div className="space-y-1.5">
                {m.opponentStarters.filter(s => s.pos !== "K" && s.pos !== "DEF").map((s, i) => {
                  const inj = injLabel(s.injury);
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[8px] font-bold text-[var(--sc-text-muted)] dark-any:text-white/22 w-7 flex-shrink-0">{s.pos}</span>
                      <StarterName s={s} className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/50 flex-1 truncate" />
                      {inj && (
                        <span className={cn(
                          "text-[7px] font-bold flex-shrink-0 px-1 rounded",
                          inj === "OUT" ? "text-red-400/75 bg-red-500/8" : "text-yellow-400/75 bg-yellow-500/8"
                        )}>{inj}</span>
                      )}
                      <span className="text-[11px] font-bold text-[var(--sc-text-muted)] dark-any:text-white/35 tabular-nums flex-shrink-0 ml-1">{fmt1(s.proj)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Detailed matchup link — opens the full /matchup/:leagueId page. */}
          <button
            onClick={() => setLocation(`/matchup/${m.leagueId}`)}
            data-testid={`button-detailed-matchup-${m.leagueId}`}
            className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/[0.06] hover:bg-[#d4af37]/[0.12] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37] text-[11px] md:text-[12px] font-bold uppercase tracking-wider py-2 transition-colors"
          >
            <Swords className="w-3.5 h-3.5" />
            Show Detailed Matchup
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── IR / Taxi view ────────────────────────────────────────────────────────────
// One row of player chips, clickable into the player profile.
function IrTaxiPlayerChip({ p, tone }: { p: IrTaxiPlayer; tone?: "danger" | "good" | "muted" }) {
  const { openPlayerProfile } = usePlayerProfile();
  const inj = p.injury;
  const clickable = /^\d+$/.test(p.pid);
  const border =
    tone === "danger" ? "border-red-500/30 bg-red-500/[0.05]" :
    tone === "good" ? "border-emerald-500/25 bg-emerald-500/[0.05]" :
    "border-[var(--sc-border)] bg-black/[0.03] dark-any:border-white/8 dark-any:bg-white/[0.02]";
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5", border)}>
      <PlayerAvatar
        id={p.pid}
        name={p.name}
        pos={p.pos}
        team={p.team}
        size="sm"
        onClick={clickable ? () => openPlayerProfile(p.pid) : undefined}
        metaTrailing={inj ? (
          <span className={cn(
            "text-[8px] font-bold px-1 rounded",
            inj === "Out" || inj === "IR" ? "text-red-400 bg-red-500/10" : "text-yellow-400 bg-yellow-500/10",
          )}>{inj}</span>
        ) : undefined}
      />
    </div>
  );
}

// Placeholder for an unfilled taxi slot — mirrors the player chip's shape but is
// styled red to flag the open spot.
function IrTaxiEmptyChip() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.05] px-2.5 py-1.5">
      <div className="w-9 h-9 rounded-full border border-dashed border-red-500/40 flex items-center justify-center text-red-400/70 text-[15px] font-bold">
        +
      </div>
      <span className="text-[12px] font-semibold text-red-400/90 pr-1">Empty</span>
    </div>
  );
}

function IrTaxiLeagueCard({ a }: { a: IrTaxiAnalysis }) {
  const openIrSlots = Math.max(0, a.irCapacity - a.irPlayers.length);
  const ineligibleCount = a.irPlayers.filter(p => p.ineligible).length;
  const hasIr = a.irCapacity > 0;

  return (
    <div className="rounded-xl border border-border bg-card/40 p-3.5 md:p-4" data-testid={`irtaxi-league-${a.leagueId}`}>
      {/* League header */}
      <div className="flex items-center gap-2 mb-3">
        {a.avatar ? (
          <img src={a.avatar} alt="" className="w-6 h-6 rounded object-cover ring-1 ring-black/5 dark-any:ring-white/10"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-6 h-6 rounded bg-[#0b3a7a]/40 ring-1 ring-black/5 dark-any:ring-white/10" />
        )}
        <h3 className="text-sm font-semibold truncate flex-1 min-w-0">{a.leagueName}</h3>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasIr && (
            <span className={cn(
              "text-[9px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5",
              openIrSlots > 0 ? "text-emerald-600 dark-any:text-emerald-300 border-emerald-500/25 bg-emerald-500/10" : "text-[var(--sc-text-muted)] dark-any:text-white/45 border-[var(--sc-border)] dark-any:border-white/10 bg-black/[0.03] dark-any:bg-white/5",
            )}>IR {a.irPlayers.length}/{a.irCapacity}</span>
          )}
          {a.taxiPlayers.length > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-wider rounded-full border border-[var(--sc-border)] dark-any:border-white/10 bg-black/[0.03] dark-any:bg-white/5 text-[var(--sc-text-muted)] dark-any:text-white/55 px-2 py-0.5">
              Taxi {a.taxiPlayers.length}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Injured Reserve */}
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37] mb-2">Injured Reserve</p>
          {ineligibleCount > 0 && (
            <p className="text-[10px] mb-1 text-red-400/80">
              {ineligibleCount} player{ineligibleCount === 1 ? "" : "s"} no longer IR-eligible. Move off IR or it blocks your lineup.
            </p>
          )}
          {!hasIr ? (
            <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/30 py-1">No IR slots in this league.</p>
          ) : a.irPlayers.length ? (
            <div className="flex flex-wrap gap-1.5">
              {a.irPlayers.map(p => (
                <IrTaxiPlayerChip key={p.pid} p={p} tone={p.ineligible ? "danger" : "muted"} />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/30 py-1">IR is empty · {openIrSlots} open slot{openIrSlots === 1 ? "" : "s"}.</p>
          )}
        </div>

        {/* IR candidates */}
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37] mb-2">Can Move to IR</p>
          {!hasIr ? (
            <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/30 py-1">—</p>
          ) : a.irCandidates.length ? (
            <>
              <p className={cn("text-[10px] mb-1", (openIrSlots > 0 || ineligibleCount > 0) ? "text-emerald-700/80 dark-any:text-emerald-300/80" : "text-[var(--sc-text-muted)] dark-any:text-white/35")}>
                {openIrSlots > 0
                  ? `${openIrSlots} open IR slot${openIrSlots === 1 ? "" : "s"}. Stash one to free a roster spot.`
                  : ineligibleCount > 0
                    ? "IR is full, but freeing an ineligible player opens a slot."
                    : "IR is full. Clear a slot first."}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {a.irCandidates.map(p => (
                  <IrTaxiPlayerChip key={p.pid} p={p} tone={(openIrSlots > 0 || ineligibleCount > 0) ? "good" : "muted"} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/30 py-1">No IR-eligible players on your active roster.</p>
          )}
        </div>
        </div>

        {/* Taxi squad */}
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37] mb-2">Taxi Squad</p>
          {a.taxiCapacity > 0 || a.taxiPlayers.length ? (
            <div className="flex flex-wrap gap-1.5">
              {a.taxiPlayers.map(p => <IrTaxiPlayerChip key={p.pid} p={p} />)}
              {Array.from({ length: Math.max(0, a.taxiCapacity - a.taxiPlayers.length) }).map((_, i) => (
                <IrTaxiEmptyChip key={`taxi-empty-${i}`} />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/30 py-1">No taxi squad in this league.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function IrTaxiView({ items, loading }: { items: IrTaxiAnalysis[]; loading: boolean }) {
  // Only surface leagues that actually have an IR slot or a taxi squad — others
  // have nothing to manage here.
  const relevant = items.filter(a => a.irCapacity > 0 || a.taxiCapacity > 0 || a.taxiPlayers.length > 0 || a.irCandidates.length > 0);
  // Most-actionable first: ineligible IR occupants, then available stash slots.
  const sorted = [...relevant].sort((a, b) => {
    const score = (x: IrTaxiAnalysis) =>
      x.irPlayers.filter(p => p.ineligible).length * 100 +
      (Math.max(0, x.irCapacity - x.irPlayers.length) > 0 ? x.irCandidates.length : 0) * 10 +
      x.taxiPlayers.length;
    return score(b) - score(a);
  });

  const allLoading = items.length > 0 && items.every(a => a.loading);
  const totalIneligible = relevant.reduce((s, a) => s + a.irPlayers.filter(p => p.ineligible).length, 0);
  const totalStashable = relevant.reduce((s, a) => s + (Math.max(0, a.irCapacity - a.irPlayers.length) > 0 ? a.irCandidates.length : 0), 0);

  if ((loading || allLoading) && relevant.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 rounded-xl border border-border bg-card/40 animate-pulse" />)}
      </div>
    );
  }

  if (relevant.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/40 p-10 text-center">
        <Shield className="w-7 h-7 text-[var(--sc-text-muted)] dark-any:text-white/25 mx-auto mb-3" />
        <h3 className="text-sm font-bold text-[var(--sc-text)] dark-any:text-white/80">No IR or Taxi slots</h3>
        <p className="text-[12px] text-muted-foreground mt-1 max-w-sm mx-auto">None of your leagues offer Injured Reserve or Taxi spots, so there's nothing to manage here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(totalIneligible > 0 || totalStashable > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#d4af37]/20 bg-[#d4af37]/[0.05] px-3.5 py-2.5">
          <Shield className="w-4 h-4 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37] flex-shrink-0" />
          <span className="text-[12px] text-[var(--sc-text)] dark-any:text-white/80">
            {totalIneligible > 0 && <><span className="font-bold text-red-600 dark-any:text-red-300">{totalIneligible}</span> ineligible IR player{totalIneligible === 1 ? "" : "s"} to move. </>}
            {totalStashable > 0 && <><span className="font-bold text-emerald-600 dark-any:text-emerald-300">{totalStashable}</span> player{totalStashable === 1 ? "" : "s"} can be stashed on open IR slots.</>}
          </span>
        </div>
      )}
      {sorted.map(a => <IrTaxiLeagueCard key={a.leagueId} a={a} />)}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function LineupCommand() {
  const { isConnected, user, leagues } = useSleeper();

  const [activeTab, setActiveTab] = useState<"lineup" | "matchups" | "startsit" | "irtaxi">("lineup");

  const [nflWeek, setNflWeek]     = useState<number | null>(null);
  const [season, setSeason]       = useState("2025");
  const [rawProj, setRawProj]     = useState<Record<string, Record<string, number>>>({});
  const [playerDb, setPlayerDb]   = useState<Record<string, any>>({});
  const [schedule, setSchedule]   = useState<GameSchedule>({});
  // Offseason (Sleeper season_type "off"): there is no live week, so the week
  // schedule resolves to last season's finished games — which would lock every
  // player and freeze the optimizer. We disable game-locking in this state.
  const [isOffseason, setIsOffseason] = useState(false);
  const [baseLoading, setBaseLoading] = useState(true);
  const [baseError, setBaseError]   = useState<string | null>(null);
  const [analyses, setAnalyses]   = useState<Record<string, LeagueAnalysis>>({});
  const [sortKey, setSortKey]     = useState<"league" | "current" | "improvement" | "hard" | "soft" | "status">("improvement");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("desc");

  const [matchups, setMatchups]   = useState<Record<string, MatchupAnalysis>>({});
  const [mSortKey, setMSortKey]   = useState<"league" | "record" | "myProj" | "oppRecord" | "oppProj" | "winPct">("winPct");
  const [mSortDir, setMSortDir]   = useState<"asc" | "desc">("desc");

  const [irTaxi, setIrTaxi]       = useState<Record<string, IrTaxiAnalysis>>({});

  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false);
  const queue = useOptimizeQueue();

  // After a row pushes its optimal lineup to Sleeper, reflect it locally: no
  // remaining swaps, no gain, current = optimal. Flips the row to "Optimized"
  // without a full refetch.
  const handleApplied = useCallback((leagueId: string) => {
    setAnalyses(prev => {
      const a = prev[leagueId];
      if (!a) return prev;
      return { ...prev, [leagueId]: { ...a, swaps: [], gain: 0, currentProj: a.optimalProj } };
    });
  }, []);

  // Best-ball leagues auto-set lineups — there's nothing to optimize — so they're
  // excluded here. `isBestBall` comes from Sleeper's settings.best_ball; the helper
  // adds a name-tag fallback for leagues whose flag isn't set.
  const activeLeagues = leagues.filter(l => l.status !== "archived" && !l.isBestBall && !isBestBallLeague(l));

  // Preseason = projections finished loading but Sleeper returned no data
  const isPreseason = !baseLoading && Object.keys(rawProj).length === 0;

  // ── 1. Fetch NFL state + projections + player DB ─────────────────────────
  useEffect(() => {
    if (!isConnected || !user?.userId) return;
    let cancelled = false;
    setBaseLoading(true);
    setBaseError(null);

    (async () => {
      try {
        const state = await fetch(`${SLEEPER_API}/state/nfl`).then(r => r.json());
        const w: number = state.week || 1;
        const s: string = state.season ?? "2025";
        if (cancelled) return;
        setNflWeek(w);
        setSeason(s);
        setIsOffseason(state.season_type === "off");

        const [db, projRaw, sched] = await Promise.all([
          getSleeperPlayers(),
          // NOTE: weekly projections live on api.sleeper.com (NOT the /v1 host in
          // SLEEPER_API). Hitting /v1 with these query params returns a dict of
          // EMPTY objects, which silently zeroed every projection — making every
          // active starter look like a bye. The .com host returns an ARRAY of
          // { player_id, stats: { pts_ppr, ... } }.
          fetch(
            `https://api.sleeper.com/projections/nfl/${s}/${w}?season_type=regular` +
            `&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`
          ).then(r => r.ok ? r.json() : []).catch(() => []),
          // Week schedule (kickoff times + game state) powers player game-locking.
          // Degrades to {} on failure, which the engine treats as "no one locked".
          getWeekSchedule(s, String(w)).catch(() => ({} as GameSchedule)),
        ]);
        if (cancelled) return;
        setPlayerDb(db);
        setSchedule(sched);
        // Index the projection array by player_id → stats so proj(pid) lookups
        // resolve. An empty array (offseason / not-yet-published) yields an empty
        // map, which correctly puts the tab into preseason mode.
        const projMap: Record<string, Record<string, number>> = {};
        if (Array.isArray(projRaw)) {
          for (const entry of projRaw as any[]) {
            const pid = entry?.player_id != null ? String(entry.player_id) : null;
            if (pid && entry?.stats && typeof entry.stats === "object") {
              projMap[pid] = entry.stats as Record<string, number>;
            }
          }
        }
        setRawProj(projMap);
      } catch (e: any) {
        if (!cancelled) setBaseError("Could not load NFL data. Check your connection.");
      } finally {
        if (!cancelled) setBaseLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isConnected, user?.userId]);

  // ── 2. Per-league roster fetch + analysis ────────────────────────────────
  useEffect(() => {
    if (nflWeek == null || !user?.userId || activeLeagues.length === 0) return;

    // Initialise loading skeletons
    setAnalyses(prev => {
      const next = { ...prev };
      for (const l of activeLeagues) {
        if (!next[l.leagueId]) {
          next[l.leagueId] = {
            leagueId:     l.leagueId,
            leagueName:   l.name,
            format:       l.format || "1QB",
            scoringFormat: l.scoringFormat,
            avatar:       l.avatar ? `https://sleepercdn.com/avatars/thumbs/${l.avatar}` : null,
            rosterId:     0,
            optimalStarters: [],
            currentProj:  0,
            optimalProj:  0,
            gain:         0,
            issues:       [],
            swaps:        [],
            loading:      true,
            error:        false,
          };
        }
      }
      return next;
    });

    // Fetch rosters + lock data (played/actual points) per league in parallel.
    activeLeagues.forEach(league => {
      Promise.all([
        fetch(`${SLEEPER_API}/league/${league.leagueId}/rosters`).then(r => r.ok ? r.json() : null),
        getLeagueMatchupsForLocking([league.leagueId], String(nflWeek)).catch(
          () => ({ playedPlayerIds: {}, actualPoints: {} }),
        ),
        // Shared scoring_settings fetch — the optimizer scores projections with
        // this league's rules instead of Sleeper's canned totals. Degrades to
        // the canned total if it can't be loaded.
        getLeagueScoring(league.leagueId),
      ])
        .then(([rosters, lock, scoring]: [any[] | null, { playedPlayerIds: Record<string, boolean>; actualPoints: Record<string, number> }, Record<string, number> | null]) => {
          if (!rosters) throw new Error("no data");
          const myRoster = rosters.find((r: any) => r.owner_id === user.userId);
          if (!myRoster) {
            // Commissioner or ghost — no roster
            setAnalyses(prev => ({
              ...prev,
              [league.leagueId]: { ...prev[league.leagueId], loading: false, error: false, gain: 0, issues: [], swaps: [] },
            }));
            return;
          }

          // Sleeper's `players` array includes IR (reserve) and taxi players, who
          // can't be put in a starting slot. Exclude them from the optimizer's
          // candidate pool — otherwise (especially in the offseason, when
          // injury_status is stale/null and they aren't projection-zeroed) the
          // optimizer "starts" an IR/taxi player, producing a phantom improvement
          // that Sleeper silently refuses to apply.
          const ineligible = new Set<string>([...(myRoster.reserve || []), ...(myRoster.taxi || [])]);
          const allPlayerIds: string[] = (myRoster.players || []).filter((pid: string) => !ineligible.has(pid));
          const rawStarters: (string | null)[] = myRoster.starters || [];
          const rosterPositions: string[] = league.rosterPositions || [];

          const result = analyzeLineup(
            allPlayerIds,
            rawStarters,
            rawProj,
            playerDb,
            rosterPositions,
            league.scoringFormat,
            season,
            String(nflWeek),
            schedule,
            lock.playedPlayerIds,
            lock.actualPoints,
            scoring,
            !isOffseason,
          );

          // Roster-health check (in-season only — see computeRosterAlert note).
          const rosterAlert = isOffseason ? null : computeRosterAlert(myRoster, rosterPositions, playerDb);

          setAnalyses(prev => ({
            ...prev,
            [league.leagueId]: {
              ...prev[league.leagueId],
              ...result,
              rosterId: myRoster.roster_id,
              rosterAlert,
              loading: false,
              error:   false,
            },
          }));
        })
        .catch(() => {
          setAnalyses(prev => ({
            ...prev,
            [league.leagueId]: { ...prev[league.leagueId], loading: false, error: true },
          }));
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nflWeek, user?.userId, activeLeagues.length, rawProj, playerDb, schedule, season, isOffseason]);

  // ── 3. Per-league matchup fetch ───────────────────────────────────────────
  useEffect(() => {
    if (nflWeek == null || !user?.userId || activeLeagues.length === 0) return;

    // Init loading skeletons for matchups
    setMatchups(prev => {
      const next = { ...prev };
      for (const l of activeLeagues) {
        if (!next[l.leagueId]) {
          next[l.leagueId] = {
            leagueId: l.leagueId,
            leagueName: l.name,
            format: l.format || "1QB",
            scoringFormat: l.scoringFormat,
            avatar: l.avatar ? `https://sleepercdn.com/avatars/thumbs/${l.avatar}` : null,
            myRosterId: 0,
            myTeamName: "",
            myRecord: { wins: 0, losses: 0, ties: 0 },
            myProj: 0,
            myStarters: [],
            opponentRosterId: null,
            opponentTeamName: "",
            opponentRecord: { wins: 0, losses: 0, ties: 0 },
            opponentProj: 0,
            opponentStarters: [],
            spread: 0,
            winPct: 50,
            predraft: l.status === "pre_draft" || l.status === "drafting",
            loading: true,
            error: false,
          };
        }
      }
      return next;
    });

    activeLeagues.forEach(league => {
      const field = projKey(league.scoringFormat);
      Promise.all([
        fetch(`${SLEEPER_API}/league/${league.leagueId}/rosters`).then(r => r.ok ? r.json() : null),
        fetch(`${SLEEPER_API}/league/${league.leagueId}/matchups/${nflWeek}`).then(r => r.ok ? r.json() : null),
        // Shared scoring_settings fetch — lets us score each projected stat line
        // against THIS league's rules instead of Sleeper's canned PPR/Half/Std
        // totals. Degrades to the canned total if it can't be loaded.
        getLeagueScoring(league.leagueId),
        // League users — maps roster.owner_id → the Sleeper account, so we can
        // label each side with the real username + profile picture instead of a
        // generic "My Team"/"Opponent". Degrades gracefully if it can't load.
        fetch(`${SLEEPER_API}/league/${league.leagueId}/users`).then(r => r.ok ? r.json() : null),
      ]).then(([rosters, weekMatchups, scoring, users]: [any[] | null, any[] | null, Record<string, number> | null, any[] | null]) => {
        if (!rosters || !weekMatchups) throw new Error("no data");

        const myRoster = rosters.find((r: any) => r.owner_id === user.userId);
        if (!myRoster) {
          setMatchups(prev => ({
            ...prev,
            [league.leagueId]: { ...prev[league.leagueId], loading: false, error: false },
          }));
          return;
        }

        const myMatchup = weekMatchups.find((m: any) => m.roster_id === myRoster.roster_id);
        if (!myMatchup) {
          // No matchup row yet — typically a pre-draft league. Still surface the
          // user's own team name/avatar so the card reads as "Pre-Draft", not blank.
          const meUser = (users || []).find((u: any) => u.user_id === myRoster.owner_id);
          const myTeamName = myRoster.metadata?.team_name || myRoster.metadata?.team_abbrev || meUser?.display_name || "My Team";
          const myUserAvatar = meUser?.avatar ? `https://sleepercdn.com/avatars/thumbs/${meUser.avatar}` : null;
          setMatchups(prev => ({
            ...prev,
            [league.leagueId]: { ...prev[league.leagueId], myTeamName, myUserAvatar, loading: false, error: false },
          }));
          return;
        }

        const opponentMatchup = weekMatchups.find(
          (m: any) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id
        ) ?? null;

        const mySett = myRoster.settings || {};
        const myRecord = { wins: mySett.wins || 0, losses: mySett.losses || 0, ties: mySett.ties || 0 };

        let opponentRecord = { wins: 0, losses: 0, ties: 0 };
        if (opponentMatchup) {
          const oppRoster = rosters.find((r: any) => r.roster_id === opponentMatchup.roster_id);
          if (oppRoster) {
            const os = oppRoster.settings || {};
            opponentRecord = { wins: os.wins || 0, losses: os.losses || 0, ties: os.ties || 0 };
          }
        }

        // League-accurate projection: score each player's projected stat line
        // with this league's scoring_settings (handles 6pt pass TDs, TE premium,
        // custom DST, etc.). Falls back to Sleeper's canned PPR/Half/Std total
        // when the league settings are unavailable or the player has no stat line
        // (the engine also uses the canned total for K/DEF by design).
        const proj = (pid: string): number => {
          const rawStats = rawProj[pid];
          if (!rawStats) return 0;
          const fallback = rawStats[field] ?? 0;
          if (!scoring) return fallback;
          return scoreByLeague(playerPos(playerDb, pid), mapSleeperStatsToScoring(rawStats), scoring, fallback);
        };
        const myProj = (myMatchup.starters || [])
          .filter((id: string) => id && id !== "0")
          .reduce((s: number, id: string) => s + proj(id), 0);
        const opponentProj = opponentMatchup
          ? (opponentMatchup.starters || [])
              .filter((id: string) => id && id !== "0")
              .reduce((s: number, id: string) => s + proj(id), 0)
          : 0;

        const spread = myProj - opponentProj;
        // Win probability via the engine's normal-distribution model (each team's
        // weekly score ~ Normal), rather than a naïve proj-share split.
        const winPct = opponentMatchup ? calculateWinProbability(spread) : 50;

        // owner_id → Sleeper account, for username + profile picture.
        const userById = new Map<string, any>((users || []).map((u: any) => [u.user_id, u]));
        const usernameFor = (roster: any, fallback: string): string => {
          const u = roster ? userById.get(roster.owner_id) : null;
          // Prefer a custom team name, then the Sleeper username, then a generic.
          return roster?.metadata?.team_name || roster?.metadata?.team_abbrev || u?.display_name || fallback;
        };
        const avatarFor = (roster: any): string | null => {
          const u = roster ? userById.get(roster.owner_id) : null;
          return u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null;
        };

        const oppRoster = opponentMatchup ? rosters.find((r: any) => r.roster_id === opponentMatchup.roster_id) : null;
        const myTeamName = usernameFor(myRoster, "My Team");
        const opponentTeamName = usernameFor(oppRoster, "Opponent");
        const myUserAvatar = avatarFor(myRoster);
        const opponentUserAvatar = avatarFor(oppRoster);

        const toStarter = (pid: string): StarterDetail => ({
          pid,
          name: fullName(playerDb, pid),
          pos: playerPos(playerDb, pid),
          proj: proj(pid),
          injury: playerDb[pid]?.injury_status as string | undefined,
        });

        const myStarters = (myMatchup.starters || [])
          .filter((id: string) => id && id !== "0")
          .map(toStarter);
        const opponentStarters = opponentMatchup
          ? (opponentMatchup.starters || []).filter((id: string) => id && id !== "0").map(toStarter)
          : [];

        setMatchups(prev => ({
          ...prev,
          [league.leagueId]: {
            leagueId: league.leagueId,
            leagueName: league.name,
            format: league.format || "1QB",
            scoringFormat: league.scoringFormat,
            avatar: league.avatar ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}` : null,
            myRosterId: myRoster.roster_id,
            myTeamName,
            myUserAvatar,
            myRecord,
            myProj,
            myStarters,
            opponentRosterId: opponentMatchup?.roster_id ?? null,
            opponentTeamName,
            opponentUserAvatar,
            opponentRecord,
            opponentProj,
            opponentStarters,
            spread,
            winPct,
            predraft: league.status === "pre_draft" || league.status === "drafting",
            loading: false,
            error: false,
          },
        }));
      }).catch(() => {
        setMatchups(prev => ({
          ...prev,
          [league.leagueId]: { ...prev[league.leagueId], loading: false, error: true },
        }));
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nflWeek, user?.userId, activeLeagues.length, rawProj]);

  // ── 4. Per-league IR / Taxi scan ──────────────────────────────────────────
  // Independent of projections/scoring — only needs each roster + the player DB
  // (for injury_status) + the league's IR slot count. Runs once the player DB is
  // loaded so injury designations resolve.
  useEffect(() => {
    if (!isConnected || !user?.userId || activeLeagues.length === 0) return;
    if (Object.keys(playerDb).length === 0) return;
    let cancelled = false;

    setIrTaxi(prev => {
      const next = { ...prev };
      for (const l of activeLeagues) {
        if (!next[l.leagueId]) {
          next[l.leagueId] = {
            leagueId: l.leagueId, leagueName: l.name,
            avatar: l.avatar ? `https://sleepercdn.com/avatars/thumbs/${l.avatar}` : null,
            irCapacity: 0, taxiCapacity: 0, taxiPlayers: [], irPlayers: [], irCandidates: [],
            loading: true, error: false,
          };
        }
      }
      return next;
    });

    activeLeagues.forEach(league => {
      Promise.all([
        fetch(`${SLEEPER_API}/league/${league.leagueId}/rosters`).then(r => r.ok ? r.json() : null),
        fetch(`${SLEEPER_API}/league/${league.leagueId}`).then(r => r.ok ? r.json() : null),
      ])
        .then(([rosters, leagueRaw]: [any[] | null, any | null]) => {
          if (cancelled) return;
          if (!rosters) throw new Error("no data");
          const myRoster = rosters.find((r: any) => r.owner_id === user.userId);
          if (!myRoster) {
            setIrTaxi(prev => ({ ...prev, [league.leagueId]: { ...prev[league.leagueId], loading: false, error: false } }));
            return;
          }
          const taxiSlots = leagueRaw?.settings?.taxi_slots ?? 0;
          const reserveSlots = leagueRaw?.settings?.reserve_slots ?? 0;
          const built = buildIrTaxi(myRoster, league.rosterPositions || [], playerDb, taxiSlots, reserveSlots);
          setIrTaxi(prev => ({ ...prev, [league.leagueId]: { ...prev[league.leagueId], ...built, loading: false, error: false } }));
        })
        .catch(() => {
          if (!cancelled) setIrTaxi(prev => ({ ...prev, [league.leagueId]: { ...prev[league.leagueId], loading: false, error: true } }));
        });
    });

    return () => { cancelled = true; };
  }, [isConnected, user?.userId, activeLeagues.length, playerDb]);

  const refresh = useCallback(() => {
    setBaseLoading(true);
    setAnalyses({});
    setMatchups({});
    setIrTaxi({});
    setNflWeek(null);
    setRawProj({});
    setPlayerDb({});
    setSchedule({});
    leagueScoringCache.clear();
    setBaseLoading(false);
  }, []);

  // ── Lineup KPIs ───────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const list = Object.values(analyses).filter(a => !a.loading && !a.error);
    const totalIssues     = list.reduce((s, a) => s + a.issues.filter(i => i.type !== "questionable").length, 0);
    const totalSwaps      = list.reduce((s, a) => s + a.swaps.length, 0);
    const totalGain       = list.reduce((s, a) => s + a.gain, 0);
    const questionable    = list.reduce((s, a) => s + a.issues.filter(i => i.type === "questionable").length, 0);
    const byeConflicts    = list.reduce((s, a) => s + a.issues.filter(i => i.type === "bye").length, 0);
    return { totalIssues, totalSwaps, totalGain, questionable, byeConflicts };
  }, [analyses]);

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sortedAnalyses = useMemo(() => {
    const list = Object.values(analyses);
    const dir = sortDir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      if (a.loading !== b.loading) return a.loading ? 1 : -1;
      let cmp = 0;
      switch (sortKey) {
        case "league":      cmp = a.leagueName.localeCompare(b.leagueName); break;
        case "current":     cmp = a.currentProj - b.currentProj; break;
        case "improvement": cmp = a.gain - b.gain; break;
        case "hard":        cmp = (a.issues.filter(i => i.type === "out" || i.type === "ir" || i.type === "bye").length)
                                - (b.issues.filter(i => i.type === "out" || i.type === "ir" || i.type === "bye").length); break;
        case "soft":        cmp = (a.issues.filter(i => i.type === "questionable" || i.type === "doubtful").length)
                                - (b.issues.filter(i => i.type === "questionable" || i.type === "doubtful").length); break;
        case "status":      cmp = a.swaps.length - b.swaps.length; break;
      }
      return cmp * dir;
    });
  }, [analyses, sortKey, sortDir]);

  const allLoading = Object.values(analyses).every(a => a.loading);
  const hasAnyData = Object.values(analyses).some(a => !a.loading && !a.error);

  const leaguesToOptimize = useMemo(() =>
    sortedAnalyses
      .filter(a => !a.loading && !a.error && a.swaps.length > 0 && a.rosterId > 0)
      .map(a => ({
        leagueId:        a.leagueId,
        leagueName:      a.leagueName,
        avatar:          a.avatar,
        rosterId:        a.rosterId,
        optimalStarters: a.optimalStarters,
        swapCount:       a.swaps.length,
        projGain:        a.gain,
      })),
    [sortedAnalyses]
  );

  // ── Matchup KPIs ──────────────────────────────────────────────────────────
  const matchupKpis = useMemo(() => {
    const list = Object.values(matchups).filter(m => !m.loading && !m.error && m.opponentRosterId != null);
    const projWins   = list.filter(m => m.winPct >= 50).length;
    const projLosses = list.filter(m => m.winPct < 50).length;
    const bestPF     = list.reduce<MatchupAnalysis | null>((best, m) => (!best || m.myProj > best.myProj ? m : best), null);
    const avgOppWinPct = list.length > 0
      ? list.reduce((s, m) => s + recordWinPct(m.opponentRecord.wins, m.opponentRecord.losses, m.opponentRecord.ties), 0) / list.length
      : 0;
    const toughest = list.reduce<MatchupAnalysis | null>((worst, m) => {
      if (!worst) return m;
      return recordWinPct(m.opponentRecord.wins, m.opponentRecord.losses, m.opponentRecord.ties)
           > recordWinPct(worst.opponentRecord.wins, worst.opponentRecord.losses, worst.opponentRecord.ties)
        ? m : worst;
    }, null);
    return { projWins, projLosses, bestPF, avgOppWinPct, toughest };
  }, [matchups]);

  function handleMSort(key: typeof mSortKey) {
    if (mSortKey === key) setMSortDir(d => d === "asc" ? "desc" : "asc");
    else { setMSortKey(key); setMSortDir("desc"); }
  }

  const sortedMatchups = useMemo(() => {
    const list = Object.values(matchups);
    const dir = mSortDir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      if (a.loading !== b.loading) return a.loading ? 1 : -1;
      let cmp = 0;
      switch (mSortKey) {
        case "league":    cmp = a.leagueName.localeCompare(b.leagueName); break;
        case "record":    cmp = recordWinPct(a.myRecord.wins, a.myRecord.losses, a.myRecord.ties)
                              - recordWinPct(b.myRecord.wins, b.myRecord.losses, b.myRecord.ties); break;
        case "myProj":    cmp = a.myProj - b.myProj; break;
        case "oppRecord": cmp = recordWinPct(a.opponentRecord.wins, a.opponentRecord.losses, a.opponentRecord.ties)
                              - recordWinPct(b.opponentRecord.wins, b.opponentRecord.losses, b.opponentRecord.ties); break;
        case "oppProj":   cmp = a.opponentProj - b.opponentProj; break;
        case "winPct":    cmp = a.winPct - b.winPct; break;
      }
      return cmp * dir;
    });
  }, [matchups, mSortKey, mSortDir]);

  const mAllLoading = Object.values(matchups).every(m => m.loading);
  const mHasAnyData = Object.values(matchups).some(m => !m.loading && !m.error);

  // ── Not connected gate ───────────────────────────────────────────────────
  if (!isConnected || !user) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] px-4">
        <Card className="p-8 text-center max-w-sm w-full border-border/60">
          <div className="w-14 h-14 rounded-2xl bg-[#0b3a7a]/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7 text-[#0b3a7a] dark-any:text-blue-400" />
          </div>
          <h3 className="text-lg font-bold mb-2">Connect Sleeper First</h3>
          <p className="text-sm text-muted-foreground">Link your Sleeper account via the Portfolio tab to unlock the Lineup Command war room.</p>
        </Card>
      </div>
    );
  }

  if (baseError) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] px-4">
        <Card className="p-6 text-center max-w-sm w-full">
          <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-3" />
          <p className="text-sm font-semibold mb-1">Couldn't load NFL data</p>
          <p className="text-xs text-muted-foreground mb-4">{baseError}</p>
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title="Lineup Command" subtitle="Review starters, identify lineup issues, and optimize weekly decisions." />
        <div className="hidden md:flex items-center gap-2 flex-shrink-0 pt-1">
          {(baseLoading || allLoading || mAllLoading) && (
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
          )}
          <div
            className={cn(
              "grid flex-shrink-0 rounded-2xl p-1 gap-1 w-[510px] h-12",
              // Light: white inner with slate border.
              "bg-[var(--sc-card-bg)] border border-[var(--sc-border)]",
              // Dark: legacy translucent strip.
              "dark-any:bg-white/[0.04] dark-any:border-white/[0.07]",
            )}
            style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}
          >
            {(["lineup", "matchups", "startsit", "irtaxi"] as const).map(tab => {
              const isActive = activeTab === tab;
              const Icon = tab === "lineup" ? Zap : tab === "matchups" ? Swords : tab === "startsit" ? Users : Shield;
              const label = tab === "lineup" ? "Lineups" : tab === "matchups" ? "Matchups" : tab === "startsit" ? "Start/Sit" : "IR/Taxi";
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`tab-${tab}-desktop`}
                  className={cn(
                    "relative flex items-center justify-center gap-2 font-semibold transition-all duration-200 rounded-xl text-[13px] tracking-[0.01em]",
                    isActive
                      // Active: navy bg, white text, gold underline (added below).
                      ? "bg-[var(--sc-blue)] text-white shadow-[0_4px_12px_rgba(11,35,68,0.18)] dark-any:bg-[linear-gradient(135deg,rgba(11,58,122,0.85)_0%,rgba(11,58,122,0.65)_100%)] dark-any:shadow-[0_2px_12px_rgba(11,58,122,0.40),inset_0_1px_0_rgba(255,255,255,0.06)] dark-any:border dark-any:border-[#d4af37]/30"
                      // Inactive: muted navy text, transparent bg, gentle hover.
                      : "text-[var(--sc-text-muted)] hover:bg-[var(--sc-blue-soft)] hover:text-[var(--sc-blue)] dark-any:text-white/45 dark-any:hover:bg-transparent dark-any:hover:text-white/70",
                  )}
                >
                  <Icon className="w-[15px] h-[15px] flex-shrink-0" />
                  {label}
                  {isActive && (
                    <span
                      className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full w-7 h-0.5"
                      style={{ background: "#d6a21e", opacity: 0.95 }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* ── Preseason notice ─────────────────────────────────────────────── */}
      {isPreseason && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 border border-yellow-500/25 bg-yellow-500/8">
          <CalendarX className="w-4 h-4 text-yellow-400/80 flex-shrink-0" />
          <div>
            <span className="text-[12px] font-bold text-yellow-300/80">Preseason (live values unavailable)</span>
            <span className="text-[11px] text-yellow-400/50 ml-2">Projections, records, and lineup data will populate once the regular season begins.</span>
          </div>
        </div>
      )}

      {/* ── Sub-tab switcher (mobile only) ───────────────────────────────── */}
      <div className="md:hidden flex justify-center !mt-0">
        {(baseLoading || allLoading || mAllLoading) && (
          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin absolute right-4 top-4" />
        )}
        <div
          className={cn(
            "grid w-[90vw] h-12 rounded-2xl p-1 gap-1",
            "bg-[var(--sc-card-bg)] border border-[var(--sc-border)]",
            "dark-any:bg-white/[0.04] dark-any:border-white/[0.07]",
          )}
          style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}
        >
          {(["lineup", "matchups", "startsit", "irtaxi"] as const).map(tab => {
            const isActive = activeTab === tab;
            const Icon = tab === "lineup" ? Zap : tab === "matchups" ? Swords : tab === "startsit" ? Users : Shield;
            const label = tab === "lineup" ? "Lineups" : tab === "matchups" ? "Matchups" : tab === "startsit" ? "Start/Sit" : "IR/Taxi";
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                data-testid={`tab-${tab}`}
                className={cn(
                  "relative flex items-center justify-center gap-2 font-semibold transition-all duration-200 rounded-xl text-[13px] tracking-[0.01em]",
                  isActive
                    ? "bg-[var(--sc-blue)] text-white shadow-[0_4px_12px_rgba(11,35,68,0.18)] dark-any:bg-[linear-gradient(135deg,rgba(11,58,122,0.85)_0%,rgba(11,58,122,0.65)_100%)] dark-any:shadow-[0_2px_12px_rgba(11,58,122,0.40),inset_0_1px_0_rgba(255,255,255,0.06)] dark-any:border dark-any:border-[#d4af37]/30"
                    : "text-[var(--sc-text-muted)] hover:bg-[var(--sc-blue-soft)] hover:text-[var(--sc-blue)] dark-any:text-white/45 dark-any:hover:bg-transparent dark-any:hover:text-white/70",
                )}
              >
                <Icon className="w-[15px] h-[15px] flex-shrink-0" />
                {label}
                {isActive && (
                  <span
                    className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full w-7 h-0.5"
                    style={{ background: "#d6a21e", opacity: 0.95 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ══════════════════ LINEUP COMMAND TAB ══════════════════ */}
      {activeTab === "lineup" && (
        <>
          {/* ── Hero KPI bar — cards sit directly on the page (no wrapper) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard icon={AlertTriangle} label="Lineup Issues"  value={isPreseason ? "N/A" : hasAnyData ? kpis.totalIssues : "—"} accent="red"    sub="Out · IR · Bye" />
            <KpiCard icon={TrendingUp}   label="Optimal Swaps"  value={isPreseason ? "N/A" : hasAnyData ? kpis.totalSwaps : "—"}  accent="blue"   sub="Available" />
            <KpiCard icon={Zap}          label="Points Gain"    value={isPreseason ? "N/A" : hasAnyData ? (kpis.totalGain > 0 ? `+${fmt1(kpis.totalGain)}` : "—") : "—"} accent="emerald" sub="Projected" />
            <KpiCard icon={Activity}     label="Questionable"   value={isPreseason ? "N/A" : hasAnyData ? kpis.questionable : "—"} accent="yellow" sub="Starters" />
            <KpiCard icon={CalendarX}    label="Bye Conflicts"  value={isPreseason ? "N/A" : hasAnyData ? kpis.byeConflicts : "—"} accent="slate"  sub="Active starters" />
          </div>

          {/* ── Optimize All button ────────────────────────────────── */}
          {/* Temporarily disabled: the button stays clickable but only surfaces
              a "feature disabled" notice instead of running the optimizer. */}
          <div className="flex justify-end">
            <button
              onClick={() => toast({
                title: "Feature currently disabled",
                description: "This feature is currently disabled and will be back up soon.",
              })}
              data-testid="button-optimize-all"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-4 py-1.5 border transition-all bg-[#d4af37] hover:bg-[#c8a230] border-[#b8901f] text-[#0b3a7a] hover:text-[#0b3a7a] shadow-[0_2px_8px_rgba(212,175,55,0.3)]"
            >
              <Zap className="w-3 h-3" /> Optimize All
            </button>
          </div>

          {/* ── Lineup table ───────────────────────────────────────── */}
          {/* Swipe hint — mobile only */}
          <div className="flex items-center justify-end gap-1.5 md:hidden mb-1 px-1">
            <span className="text-[10px] text-[var(--sc-text-muted)] dark-any:text-white/25">Swipe to view</span>
            <ArrowRight className="w-3 h-3 text-[var(--sc-text-muted)]/70 dark-any:text-white/20" />
          </div>

          <div
            className={cn(
              "rounded-2xl overflow-hidden",
              // Light: clean white wrapper, slate border, premium shadow.
              "bg-[var(--sc-card-bg)] border border-[var(--sc-border)] shadow-[var(--sc-shadow-card)]",
              // Dark: legacy gradient.
              "dark-any:border-white/6 dark-any:shadow-none dark-any:bg-[linear-gradient(180deg,rgba(4,13,26,0.9)_0%,rgba(4,10,20,0.95)_100%)]",
            )}
          >
            {/* Scroll container */}
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <div style={{ minWidth: 500 }}>
                {/* Header — navy in light mode, glass strip in dark. */}
                <div className="flex items-center gap-1.5 md:gap-3 px-2 md:px-5 py-2.5 bg-[var(--sc-blue)] dark-any:bg-white/[0.02] border-b border-[var(--sc-blue-2)] dark-any:border-white/6">
                  {(() => {
                    function SortBtn({ col, label, className }: { col: typeof sortKey; label: React.ReactNode; className?: string }) {
                      const active = sortKey === col;
                      return (
                        <button
                          onClick={() => handleSort(col)}
                          className={cn(
                            "flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest whitespace-nowrap transition-colors cursor-pointer select-none",
                            // Navy header → gold for active, white for inactive (light mode).
                            // Dark mode keeps the legacy gold/white-translucent palette.
                            active
                              ? "text-[#d6a21e] dark-any:text-[#d4af37]"
                              : "text-white/70 hover:text-white dark-any:text-white/30 dark-any:hover:text-white/55",
                            className,
                          )}
                        >
                          {label}
                          {active ? (sortDir === "desc" ? <ChevronDown className="w-2.5 h-2.5 flex-shrink-0" /> : <ChevronUp className="w-2.5 h-2.5 flex-shrink-0" />) : <ArrowUpDown className="w-2.5 h-2.5 flex-shrink-0 opacity-40" />}
                        </button>
                      );
                    }
                    return (
                      <>
                        <SortBtn col="league"      label="League"      className="flex-1 min-w-[140px] justify-start" />
                        <SortBtn col="current"     label={<><span className="md:hidden">Proj</span><span className="hidden md:inline">Current</span></>}     className="w-10 md:w-16 flex-shrink-0 justify-end" />
                        <SortBtn col="improvement" label={<><span className="md:hidden">+Pts</span><span className="hidden md:inline">Improvement</span></>}  className="w-12 md:w-28 flex-shrink-0 justify-end" />
                        <SortBtn col="hard"        label={<><span className="md:hidden">OUT</span><span className="hidden md:inline">Out/IR/Bye</span></>}    className="w-8 md:w-24 flex-shrink-0 justify-center" />
                        <SortBtn col="soft"        label={<><span className="md:hidden">Q/D</span><span className="hidden md:inline">Ques/Doub</span></>}     className="w-8 md:w-20 flex-shrink-0 justify-center" />
                        <SortBtn col="status"      label="Status"      className="w-[68px] md:w-[108px] flex-shrink-0 justify-end" />
                      </>
                    );
                  })()}
                </div>
                {/* Rows */}
                {baseLoading && sortedAnalyses.length === 0 ? (
                  [...Array(Math.min(activeLeagues.length || 4, 6))].map((_, i) => <SkeletonRow key={i} />)
                ) : sortedAnalyses.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                    <Users className="w-8 h-8 text-[var(--sc-text-muted)]/40 dark-any:text-white/15 mb-3" />
                    <p className="text-sm font-semibold text-[var(--sc-text)] dark-any:text-white/40">No leagues found</p>
                    <p className="text-xs text-[var(--sc-text-muted)] dark-any:text-white/25 mt-1">Connect leagues in the Portfolio tab to get started.</p>
                  </div>
                ) : (
                  sortedAnalyses.map(a => <LeagueRow key={a.leagueId} analysis={a} preseason={isPreseason} onApplied={handleApplied} />)
                )}
              </div>
            </div>
          </div>

          <p className="text-[9px] text-center px-4 pb-20 md:pb-0 text-[var(--sc-text-muted)] dark-any:text-white/20">
            Projections from Sleeper · Updated weekly · Optimal lineup uses projected points, not dynasty values
          </p>
        </>
      )}

      {/* ── Optimize All Modal (rendered outside tab conditional) ── */}
      <OptimizeAllModal
        open={optimizeModalOpen}
        onClose={() => {
          if (queue.qStatus === "idle") setOptimizeModalOpen(false);
        }}
        leaguesToOptimize={leaguesToOptimize}
        nflWeek={nflWeek}
        qStatus={queue.qStatus}
        items={queue.items}
        processingId={queue.processingId}
        completedCount={queue.completedCount}
        totalCount={queue.totalCount}
        estimatedRemainingMs={queue.estimatedRemainingMs}
        summary={queue.summary}
        onConfirm={() => queue.start(leaguesToOptimize)}
        onPause={queue.pause}
        onResume={queue.resume}
        onCancel={queue.cancel}
        onDone={() => {
          queue.reset();
          setOptimizeModalOpen(false);
          refresh();
        }}
      />

      {/* ══════════════════ MATCHUPS TAB ══════════════════ */}
      {activeTab === "matchups" && (
        <>
          {/* ── Matchup KPI bar ────────────────────────────────────── */}
          {isPreseason ? (
            <div
              className={cn(
                "rounded-[18px] px-5 py-5 md:py-6",
                "bg-[var(--sc-card-bg)] border border-[var(--sc-border)] shadow-[var(--sc-shadow-card)]",
                "dark-any:rounded-2xl dark-any:border-white/8 dark-any:shadow-none dark-any:bg-[linear-gradient(135deg,rgba(4,13,26,0.95)_0%,rgba(11,58,122,0.08)_100%)]",
              )}
            >
              <div className="flex items-start md:items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-[var(--sc-warning-soft)] border border-[#fde68a] dark-any:bg-yellow-500/10 dark-any:ring-1 dark-any:ring-yellow-500/25 dark-any:border-transparent flex items-center justify-center flex-shrink-0">
                  <CalendarX className="w-5 h-5 text-[var(--sc-warning)] dark-any:text-yellow-400/80" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] md:text-[13px] font-bold text-[var(--sc-blue)] dark-any:text-white/80 leading-tight">
                    Matchup intel arrives at kickoff
                  </p>
                  <p className="text-[11px] md:text-[12px] text-[var(--sc-text-muted)] dark-any:text-white/40 mt-1 leading-snug max-w-2xl">
                    Win probabilities, projected scores, and live matchup stats will populate here once weekly projections begin.
                  </p>
                </div>
                <div className="hidden md:flex flex-col items-end gap-0.5 ml-auto flex-shrink-0 pl-3">
                  <span className="sc-eyebrow dark-any:text-white/30 dark-any:tracking-widest">Tracking</span>
                  <span className="text-[20px] font-black tabular-nums leading-none text-[var(--sc-blue)] dark-any:text-white/85">
                    {activeLeagues.length}
                  </span>
                  <span className="text-[10px] text-[var(--sc-text-muted)] dark-any:text-white/35">
                    {activeLeagues.length === 1 ? "league" : "leagues"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "rounded-[18px] p-4 md:p-5",
                "bg-[var(--sc-card-bg)] border border-[var(--sc-border)] shadow-[var(--sc-shadow-card)]",
                "dark-any:rounded-2xl dark-any:border-white/8 dark-any:shadow-none dark-any:bg-[linear-gradient(135deg,rgba(4,13,26,0.95)_0%,rgba(11,58,122,0.08)_100%)]",
              )}
            >
              <p className="sc-eyebrow mb-3 md:mb-4 dark-any:text-white/30 dark-any:tracking-[0.2em]">
                Matchup Overview
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                <KpiCard
                  icon={Trophy}
                  label="Projected Record"
                  value={mHasAnyData ? `${matchupKpis.projWins}-${matchupKpis.projLosses}` : "—"}
                  accent="gold"
                  sub="This week"
                />
                <KpiCard
                  icon={Zap}
                  label="Best Projected PF"
                  value={mHasAnyData && matchupKpis.bestPF ? fmt1(matchupKpis.bestPF.myProj) : "—"}
                  accent="blue"
                  sub={matchupKpis.bestPF?.leagueName ?? "Highest output"}
                />
                <KpiCard
                  icon={Users}
                  label="Avg Opp Record"
                  value={mHasAnyData ? `${Math.round(matchupKpis.avgOppWinPct)}%` : "—"}
                  accent="yellow"
                  sub="Opponent win rate"
                />
                <KpiCard
                  icon={Shield}
                  label="Toughest Opponent"
                  value={mHasAnyData && matchupKpis.toughest
                    ? `${Math.round(recordWinPct(matchupKpis.toughest.opponentRecord.wins, matchupKpis.toughest.opponentRecord.losses, matchupKpis.toughest.opponentRecord.ties))}%`
                    : "—"}
                  accent="red"
                  sub={matchupKpis.toughest?.leagueName ?? "Hardest matchup"}
                />
              </div>
            </div>
          )}

          {/* ── Matchup cards ──────────────────────────────────────── */}
          <div
            className={cn(
              "rounded-2xl overflow-hidden",
              "bg-[var(--sc-card-bg)] border border-[var(--sc-border)] shadow-[var(--sc-shadow-card)]",
              "dark-any:border-white/6 dark-any:shadow-none dark-any:bg-[linear-gradient(180deg,rgba(4,13,26,0.9)_0%,rgba(4,10,20,0.95)_100%)]",
            )}
          >
            {/* Sort header — segmented control */}
            <div className="flex items-center justify-between gap-3 px-3.5 md:px-5 py-2.5 bg-[var(--sc-blue)] dark-any:bg-white/[0.018] border-b border-[var(--sc-blue-2)] dark-any:border-white/5">
              <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-white/80 dark-any:text-white/40">
                {sortedMatchups.filter(m => !m.loading).length} {sortedMatchups.filter(m => !m.loading).length === 1 ? "Matchup" : "Matchups"}
              </span>
              <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-white/10 border border-white/15 shadow-inner dark-any:bg-white/[0.04] dark-any:border-white/8">
                {(["winPct", "myProj", "record"] as const).map(key => {
                  const active = mSortKey === key;
                  const label = key === "winPct" ? "Win %" : key === "myProj" ? "Proj" : "Record";
                  return (
                    <button
                      key={key}
                      onClick={() => handleMSort(key)}
                      data-testid={`sort-matchup-${key}`}
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-wider px-2.5 md:px-3 py-1 rounded-full transition-all duration-150 whitespace-nowrap",
                        active
                          ? "bg-[#0b3a7a] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
                          : "text-white/70 hover:text-white dark-any:text-white/35 dark-any:hover:text-white/65",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cards */}
            {baseLoading && sortedMatchups.length === 0 ? (
              [...Array(Math.min(activeLeagues.length || 3, 4))].map((_, i) => <MatchupSkeletonRow key={i} />)
            ) : sortedMatchups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <Swords className="w-8 h-8 text-[var(--sc-text-muted)]/40 dark-any:text-white/15 mb-3" />
                <p className="text-sm font-semibold text-[var(--sc-text)] dark-any:text-white/40">No matchup data yet</p>
                <p className="text-xs text-[var(--sc-text-muted)] dark-any:text-white/25 mt-1">Matchup data loads once projections are available.</p>
              </div>
            ) : (
              sortedMatchups.map(m => <MatchupBattleCard key={m.leagueId} m={m} preseason={isPreseason} />)
            )}
          </div>

          <p className="text-[9px] text-[var(--sc-text-muted)] dark-any:text-white/20 text-center px-4">
            Projections scored with your league's settings · Win % from the projected spread (normal model) · Records from current standings
          </p>
        </>
      )}

      {/* ══════════════════ START/SIT COMPARE TAB ══════════════════ */}
      {activeTab === "startsit" && (
        <StartSitCompareTab defaultWeek={nflWeek ?? 1} />
      )}

      {activeTab === "irtaxi" && (
        <IrTaxiView items={Object.values(irTaxi)} loading={baseLoading} />
      )}
    </div>
  );
}
