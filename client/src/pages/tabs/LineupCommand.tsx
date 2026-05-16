import { useState, useEffect, useMemo, useCallback } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSleeper } from "@/contexts/SleeperContext";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, TrendingUp, Zap, Users, CalendarX,
  ChevronDown, ChevronUp, RefreshCw, Lock, CheckCircle2,
  ArrowRight, Activity, ArrowUpDown, Trophy, Shield, Target, Swords,
} from "lucide-react";
import type { SleeperLeagueSummary } from "@/types";

const SLEEPER_API = "https://api.sleeper.app/v1";

// ─── Slot eligibility (mirrors FieldView) ────────────────────────────────────
const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB:         ["QB"],
  RB:         ["RB"],
  WR:         ["WR"],
  TE:         ["TE"],
  FLEX:       ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX:   ["WR", "TE"],
  WRRB_FLEX:  ["WR", "RB"],
  K:          ["K"],
  DEF:        ["DEF"],
};
const NON_STARTER = new Set(["BN", "TAXI", "IR"]);
const ACTIVE_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

// ─── Types ────────────────────────────────────────────────────────────────────
type IssueType = "out" | "ir" | "doubtful" | "questionable" | "bye";

interface LineupIssue {
  type: IssueType;
  playerName: string;
  pos: string;
}

interface SwapRec {
  inName: string;
  outName: string;
  inPos: string;
  projGain: number;
}

interface LeagueAnalysis {
  leagueId: string;
  leagueName: string;
  format: string;
  scoringFormat: string;
  avatar?: string | null;
  currentProj: number;
  optimalProj: number;
  gain: number;
  issues: LineupIssue[];
  swaps: SwapRec[];
  loading: boolean;
  error: boolean;
}

// ─── Types (matchup) ─────────────────────────────────────────────────────────
interface MatchupAnalysis {
  leagueId: string;
  leagueName: string;
  format: string;
  scoringFormat: string;
  avatar?: string | null;
  myRosterId: number;
  myRecord: { wins: number; losses: number; ties: number };
  myProj: number;
  opponentRosterId: number | null;
  opponentRecord: { wins: number; losses: number; ties: number };
  opponentProj: number;
  winPct: number;
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

function projKey(scoringFormat: string): "pts_ppr" | "pts_half_ppr" | "pts_std" {
  const f = scoringFormat.toLowerCase();
  if (f.includes("ppr") && !f.includes("half")) return "pts_ppr";
  if (f.includes("half"))                        return "pts_half_ppr";
  return "pts_std";
}

function lastName(playerDb: Record<string, any>, pid: string): string {
  const p = playerDb[pid];
  if (!p) return pid.slice(0, 8);
  return p.last_name || p.full_name?.split(" ").slice(1).join(" ") || p.full_name || pid;
}

function playerPos(playerDb: Record<string, any>, pid: string): string {
  const p = playerDb[pid];
  return p?.position || p?.fantasy_positions?.[0] || "";
}

function fmt1(n: number): string {
  return n.toFixed(1);
}

// ─── Core lineup analysis ─────────────────────────────────────────────────────
function analyzeLineup(
  allPlayerIds: string[],
  actualStarterIds: string[],
  rawProj: Record<string, Record<string, number>>,  // pid → {pts_ppr, pts_half_ppr, pts_std}
  playerDb: Record<string, any>,
  rosterPositions: string[],
  scoringFormat: string,
): Omit<LeagueAnalysis, "leagueId" | "leagueName" | "format" | "scoringFormat" | "loading" | "error"> {
  const field = projKey(scoringFormat);

  // Build projection map for this league's scoring
  const proj = (pid: string): number => (rawProj[pid]?.[field] ?? 0);

  // Player pool (exclude DEF/K if not in roster positions for simplicity)
  const players = allPlayerIds
    .filter(pid => pid && pid !== "0")
    .map(pid => ({
      id: pid,
      pos: playerPos(playerDb, pid),
      proj: proj(pid),
      injury: playerDb[pid]?.injury_status as string | undefined,
      team: playerDb[pid]?.team as string | undefined,
    }))
    .filter(p => ACTIVE_POS.has(p.pos));

  // Active starter slots
  const activeSlots = rosterPositions.filter(s => !NON_STARTER.has(s) && SLOT_ELIGIBILITY[s]);
  const positionalSlots = activeSlots.filter(s => (SLOT_ELIGIBILITY[s]?.length === 1) || ["K","DEF"].includes(s));
  const flexSlots = activeSlots.filter(s => !positionalSlots.includes(s));

  // Greedy optimal assignment (by projection descending)
  const sorted = [...players].sort((a, b) => b.proj - a.proj);
  const used = new Set<string>();
  const optimalIds: string[] = [];

  for (const slot of [...positionalSlots, ...flexSlots]) {
    const eligible = SLOT_ELIGIBILITY[slot] ?? [];
    const best = sorted.find(p => eligible.includes(p.pos) && !used.has(p.id));
    if (best) { used.add(best.id); optimalIds.push(best.id); }
  }

  const optimalSet = new Set(optimalIds);
  const actualSet  = new Set(
    actualStarterIds.filter(id => id && id !== "0" && ACTIVE_POS.has(playerPos(playerDb, id)))
  );

  const currentProj = [...actualSet].reduce((s, id) => s + proj(id), 0);
  const optimalProj = [...optimalSet].reduce((s, id) => s + proj(id), 0);

  // Swaps: players optimal wants to start that aren't currently starting
  const shouldStart = [...optimalSet].filter(id => !actualSet.has(id));
  const shouldBench = [...actualSet].filter(id => !optimalSet.has(id));

  const swaps: SwapRec[] = shouldStart.map((inId, i) => {
    const outId = shouldBench[i];
    return {
      inName:   lastName(playerDb, inId),
      outName:  outId ? lastName(playerDb, outId) : "—",
      inPos:    playerPos(playerDb, inId),
      projGain: (proj(inId)) - (outId ? proj(outId) : 0),
    };
  }).filter(s => s.projGain > 0.5);

  // Issues: injured/bye starters
  const issues: LineupIssue[] = [];
  for (const pid of actualSet) {
    const inj  = playerDb[pid]?.injury_status as string | undefined;
    const team = playerDb[pid]?.team as string | undefined;
    const name = lastName(playerDb, pid);
    const pos  = playerPos(playerDb, pid);
    if      (inj === "IR")           issues.push({ type: "ir",           playerName: name, pos });
    else if (inj === "Out")          issues.push({ type: "out",          playerName: name, pos });
    else if (inj === "Doubtful")     issues.push({ type: "doubtful",     playerName: name, pos });
    else if (inj === "Questionable") issues.push({ type: "questionable", playerName: name, pos });
    else if (proj(pid) < 0.5 && team && pos !== "DEF" && pos !== "K")
                                     issues.push({ type: "bye",          playerName: name, pos });
  }

  return { currentProj, optimalProj, gain: optimalProj - currentProj, issues, swaps };
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
  return (
    <div className="flex items-center gap-2 md:gap-3 px-3 md:px-5 py-3 border-b border-white/5 animate-pulse">
      <div className="flex-1 h-3.5 bg-white/8 rounded" />
      <div className="w-14 md:w-16 h-3.5 bg-white/8 rounded" />
      <div className="w-14 md:w-16 h-3.5 bg-white/8 rounded" />
      <div className="w-[72px] md:w-24 h-4 bg-white/8 rounded" />
      <div className="w-[64px] md:w-20 h-4 bg-white/8 rounded hidden sm:block" />
      <div className="w-[96px] md:w-[108px] h-7 bg-white/8 rounded-lg" />
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon, label, value, accent, sub,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: string | number;
  accent: "red" | "gold" | "blue" | "yellow" | "slate";
  sub?: string;
}) {
  const colors: Record<string, { text: string; bg: string; ring: string }> = {
    red:    { text: "text-red-400",     bg: "bg-red-500/10",    ring: "ring-red-500/20" },
    gold:   { text: "text-[#d4af37]",   bg: "bg-[#d4af37]/10", ring: "ring-[#d4af37]/25" },
    blue:   { text: "text-blue-400",    bg: "bg-blue-500/10",  ring: "ring-blue-500/20" },
    yellow: { text: "text-yellow-400",  bg: "bg-yellow-500/10",ring: "ring-yellow-500/20" },
    slate:  { text: "text-slate-400",   bg: "bg-slate-500/10", ring: "ring-slate-500/20" },
  };
  const c = colors[accent];
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 rounded-xl p-3 md:p-4 ring-1 border border-white/6", c.bg, c.ring)}>
      <Icon className={cn("w-4 h-4 md:w-5 md:h-5 flex-shrink-0", c.text)} />
      <span className={cn("text-xl md:text-2xl font-black tabular-nums leading-tight", c.text)}>{value}</span>
      <span className="text-[9px] md:text-[10px] font-semibold text-white/50 uppercase tracking-wide text-center leading-tight">{label}</span>
      {sub && <span className="text-[8px] text-white/30 text-center">{sub}</span>}
    </div>
  );
}

// ─── League row ───────────────────────────────────────────────────────────────
function LeagueRow({ analysis }: { analysis: LeagueAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  const { leagueName, format, scoringFormat, avatar, currentProj, gain, issues, swaps, loading, error } = analysis;

  const improvColor = gain >= 10 ? "text-emerald-400" : gain >= 3 ? "text-emerald-500/80" : gain > 0.5 ? "text-emerald-600" : "text-white/25";
  const hardIssues = issues.filter(i => i.type === "out" || i.type === "ir" || i.type === "bye");
  const softIssues = issues.filter(i => i.type === "questionable" || i.type === "doubtful");
  const isOptimized = !loading && !error && swaps.length === 0;

  return (
    <div className={cn(
      "border-b border-white/5 last:border-0 transition-colors",
      swaps.length > 0 ? "hover:bg-white/[0.02]" : "hover:bg-white/[0.01]"
    )}>
      {/* Main row */}
      <div
        className="flex items-center gap-2 md:gap-3 px-3 md:px-5 py-3 select-none"
        data-testid={`row-lineup-${analysis.leagueId}`}
      >
        {/* League avatar + name + format */}
        <div className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer" onClick={() => swaps.length > 0 && setExpanded(v => !v)}>
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="w-7 h-7 rounded-lg flex-shrink-0 object-cover bg-white/10"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-7 h-7 rounded-lg flex-shrink-0 bg-[#0b3a7a]/40 flex items-center justify-center">
              <Users className="w-3.5 h-3.5 text-blue-400/60" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[12px] md:text-sm font-bold text-white/90 truncate leading-tight">{leagueName}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[8px] md:text-[9px] text-white/30 font-medium">{format} · {scoringFormat}</span>
            </div>
          </div>
        </div>

        {/* Current proj */}
        <div className="text-right w-14 md:w-16 flex-shrink-0">
          {loading ? (
            <div className="h-3.5 bg-white/8 rounded animate-pulse" />
          ) : error ? (
            <span className="text-[10px] text-white/20">—</span>
          ) : (
            <p className="text-[12px] md:text-[13px] font-bold text-white/60 tabular-nums">{fmt1(currentProj)}</p>
          )}
        </div>

        {/* Improvement */}
        <div className="text-right w-24 md:w-28 flex-shrink-0">
          {loading ? (
            <div className="h-3.5 bg-white/8 rounded animate-pulse" />
          ) : error ? (
            <span className="text-[10px] text-white/20">—</span>
          ) : (
            <p className={cn("text-[12px] md:text-[13px] font-black tabular-nums", improvColor)}>
              {gain > 0.1 ? `+${fmt1(gain)}` : "—"}
            </p>
          )}
        </div>

        {/* OUT / IR / BYE */}
        <div className="w-[72px] md:w-24 flex-shrink-0 flex justify-center">
          {loading ? (
            <div className="h-4 w-6 bg-white/8 rounded animate-pulse" />
          ) : hardIssues.length === 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/60" />
          ) : (
            <span className="text-[13px] md:text-sm font-black tabular-nums text-red-400">
              {hardIssues.length}
            </span>
          )}
        </div>

        {/* QUES / DOUB */}
        <div className="w-[64px] md:w-20 flex-shrink-0 justify-center hidden sm:flex">
          {loading ? (
            <div className="h-4 w-6 bg-white/8 rounded animate-pulse" />
          ) : softIssues.length === 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/60" />
          ) : (
            <span className="text-[13px] md:text-sm font-black tabular-nums text-yellow-400">
              {softIssues.length}
            </span>
          )}
        </div>

        {/* Status */}
        <div className="w-[96px] md:w-[108px] flex-shrink-0 flex justify-end">
          {loading ? (
            <div className="h-7 w-20 bg-white/8 rounded-lg animate-pulse" />
          ) : error ? (
            <span className="text-[10px] text-white/20">—</span>
          ) : isOptimized ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1">
              <CheckCircle2 className="w-3 h-3" /> Optimized
            </span>
          ) : (
            <button
              className="inline-flex items-center gap-1 text-[10px] font-bold bg-[#d4af37]/15 hover:bg-[#d4af37]/25 border border-[#d4af37]/35 hover:border-[#d4af37]/55 text-[#d4af37] rounded-full px-2.5 py-1 transition-colors"
              onClick={() => setExpanded(v => !v)}
              data-testid={`button-optimize-${analysis.leagueId}`}
            >
              <Zap className="w-3 h-3" />
              Optimize
              {expanded ? <ChevronUp className="w-2.5 h-2.5 ml-0.5" /> : <ChevronDown className="w-2.5 h-2.5 ml-0.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-3 md:px-5 pb-4 space-y-3 border-t border-white/4 pt-3 bg-white/[0.015]">

          {/* Recommended swaps */}
          {swaps.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-2">
                Recommended Swaps
              </p>
              <div className="space-y-1.5">
                {swaps.map((swap, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2">
                    <TrendingUp className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    <span className="text-[10px] md:text-[11px] text-white/50">Start</span>
                    <span className="text-[11px] md:text-xs font-bold text-emerald-300">{swap.inName}</span>
                    <Badge variant="outline" className="text-[7px] px-1 py-0 h-3.5 border-emerald-500/30 text-emerald-400/70">{swap.inPos}</Badge>
                    <ArrowRight className="w-3 h-3 text-white/20 flex-shrink-0 mx-1" />
                    <span className="text-[10px] md:text-[11px] text-white/40">over</span>
                    <span className="text-[11px] md:text-xs font-semibold text-white/60">{swap.outName}</span>
                    {swap.projGain > 0 && (
                      <span className="ml-auto text-[10px] font-bold text-emerald-400 tabular-nums">+{fmt1(swap.projGain)} pts</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active issues */}
          {issues.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-2">
                Starter Alerts
              </p>
              <div className="flex flex-wrap gap-1.5">
                {issues.map((iss, i) => {
                  const typeLabel: Record<IssueType, string> = {
                    out: "Out", ir: "IR", doubtful: "Doubtful", questionable: "Questionable", bye: "Bye Week"
                  };
                  const typeCls: Record<IssueType, string> = {
                    out: "bg-red-500/10 border-red-500/30 text-red-400",
                    ir: "bg-red-500/10 border-red-500/30 text-red-400",
                    doubtful: "bg-orange-500/10 border-orange-500/30 text-orange-400",
                    questionable: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
                    bye: "bg-slate-500/10 border-slate-500/30 text-slate-400",
                  };
                  return (
                    <div key={i} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px]", typeCls[iss.type])}>
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      <span className="font-bold">{iss.playerName}</span>
                      <span className="text-white/40">({iss.pos})</span>
                      <span className="font-medium">— {typeLabel[iss.type]}</span>
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

// ─── Matchup skeleton row ─────────────────────────────────────────────────────
function MatchupSkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 md:px-5 py-3 border-b border-white/5 animate-pulse">
      <div className="flex-1 h-3.5 bg-white/8 rounded" />
      <div className="w-14 h-3.5 bg-white/8 rounded" />
      <div className="w-16 h-3.5 bg-white/8 rounded" />
      <div className="w-14 h-3.5 bg-white/8 rounded" />
      <div className="w-16 h-3.5 bg-white/8 rounded" />
      <div className="w-16 h-5 bg-white/8 rounded-full" />
    </div>
  );
}

// ─── Matchup row ──────────────────────────────────────────────────────────────
function MatchupRow({ m }: { m: MatchupAnalysis }) {
  const { leagueName, format, scoringFormat, avatar, myRecord, myProj, opponentRecord, opponentProj, winPct, loading, error } = m;

  const winColor =
    winPct >= 65 ? "text-emerald-400 bg-emerald-500/12 border-emerald-500/30" :
    winPct >= 50 ? "text-blue-400 bg-blue-500/12 border-blue-500/30" :
    winPct >= 35 ? "text-yellow-400 bg-yellow-500/12 border-yellow-500/30" :
                   "text-red-400 bg-red-500/12 border-red-500/30";

  const myProjColor   = myProj > opponentProj ? "text-emerald-400" : myProj < opponentProj ? "text-red-400/80" : "text-white/60";
  const oppProjColor  = opponentProj > myProj  ? "text-red-400/80"  : "text-white/40";

  return (
    <div
      className="flex items-center gap-3 px-3 md:px-5 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
      data-testid={`row-matchup-${m.leagueId}`}
    >
      {/* League */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {avatar ? (
          <img src={avatar} alt="" className="w-7 h-7 rounded-lg flex-shrink-0 object-cover bg-white/10"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-7 h-7 rounded-lg flex-shrink-0 bg-[#0b3a7a]/40 flex items-center justify-center">
            <Users className="w-3.5 h-3.5 text-blue-400/60" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[12px] md:text-sm font-bold text-white/90 truncate leading-tight">{leagueName}</p>
          <p className="text-[8px] md:text-[9px] text-white/30 font-medium">{format} · {scoringFormat}</p>
        </div>
      </div>

      {/* My Record */}
      <div className="w-14 text-right flex-shrink-0">
        {loading ? <div className="h-3.5 bg-white/8 rounded animate-pulse" /> :
         error   ? <span className="text-[10px] text-white/20">—</span> :
         <p className="text-[12px] font-bold text-white/70 tabular-nums">{fmtRecord(myRecord.wins, myRecord.losses, myRecord.ties)}</p>}
      </div>

      {/* My Projected Pts */}
      <div className="w-16 text-right flex-shrink-0">
        {loading ? <div className="h-3.5 bg-white/8 rounded animate-pulse" /> :
         error   ? <span className="text-[10px] text-white/20">—</span> :
         <p className={cn("text-[12px] font-black tabular-nums", myProjColor)}>{fmt1(myProj)}</p>}
      </div>

      {/* Opp Record */}
      <div className="w-14 text-right flex-shrink-0">
        {loading ? <div className="h-3.5 bg-white/8 rounded animate-pulse" /> :
         error   ? <span className="text-[10px] text-white/20">—</span> :
         m.opponentRosterId == null
           ? <span className="text-[10px] text-white/25">Bye</span>
           : <p className="text-[12px] font-bold text-white/50 tabular-nums">{fmtRecord(opponentRecord.wins, opponentRecord.losses, opponentRecord.ties)}</p>}
      </div>

      {/* Opp Projected Pts */}
      <div className="w-16 text-right flex-shrink-0">
        {loading ? <div className="h-3.5 bg-white/8 rounded animate-pulse" /> :
         error   ? <span className="text-[10px] text-white/20">—</span> :
         m.opponentRosterId == null
           ? <span className="text-[10px] text-white/25">—</span>
           : <p className={cn("text-[12px] font-bold tabular-nums", oppProjColor)}>{fmt1(opponentProj)}</p>}
      </div>

      {/* Win % */}
      <div className="w-[72px] flex-shrink-0 flex justify-end">
        {loading ? (
          <div className="h-5 w-14 bg-white/8 rounded-full animate-pulse" />
        ) : error || m.opponentRosterId == null ? (
          <span className="text-[10px] text-white/25">—</span>
        ) : (
          <span className={cn("inline-flex items-center justify-center text-[10px] font-bold rounded-full px-2.5 py-0.5 border tabular-nums", winColor)}>
            {Math.round(winPct)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function LineupCommand() {
  const { isConnected, user, leagues } = useSleeper();

  const [activeTab, setActiveTab] = useState<"lineup" | "matchups">("lineup");

  const [nflWeek, setNflWeek]     = useState<number | null>(null);
  const [season, setSeason]       = useState("2025");
  const [rawProj, setRawProj]     = useState<Record<string, Record<string, number>>>({});
  const [playerDb, setPlayerDb]   = useState<Record<string, any>>({});
  const [baseLoading, setBaseLoading] = useState(true);
  const [baseError, setBaseError]   = useState<string | null>(null);
  const [analyses, setAnalyses]   = useState<Record<string, LeagueAnalysis>>({});
  const [sortKey, setSortKey]     = useState<"league" | "current" | "improvement" | "hard" | "soft" | "status">("improvement");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("desc");

  const [matchups, setMatchups]   = useState<Record<string, MatchupAnalysis>>({});
  const [mSortKey, setMSortKey]   = useState<"league" | "record" | "myProj" | "oppRecord" | "oppProj" | "winPct">("winPct");
  const [mSortDir, setMSortDir]   = useState<"asc" | "desc">("desc");

  const activeLeagues = leagues.filter(l => l.status !== "archived");

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

        const [db, projRaw] = await Promise.all([
          getSleeperPlayers(),
          fetch(
            `${SLEEPER_API}/projections/nfl/${s}/${w}?season_type=regular` +
            `&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`
          ).then(r => r.ok ? r.json() : {}).catch(() => ({})),
        ]);
        if (cancelled) return;
        setPlayerDb(db);
        // normalise: projRaw[pid] might be {pts_ppr: N, ...} or the stats object directly
        setRawProj(projRaw as Record<string, Record<string, number>>);
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

    // Fetch all rosters in parallel
    activeLeagues.forEach(league => {
      fetch(`${SLEEPER_API}/league/${league.leagueId}/rosters`)
        .then(r => r.ok ? r.json() : null)
        .then((rosters: any[] | null) => {
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

          const allPlayerIds: string[] = myRoster.players || [];
          const actualStarterIds: string[] = (myRoster.starters || []).filter((id: string) => id && id !== "0");
          const rosterPositions: string[] = league.rosterPositions || [];

          const result = analyzeLineup(
            allPlayerIds,
            actualStarterIds,
            rawProj,
            playerDb,
            rosterPositions,
            league.scoringFormat,
          );

          setAnalyses(prev => ({
            ...prev,
            [league.leagueId]: {
              ...prev[league.leagueId],
              ...result,
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
  }, [nflWeek, user?.userId, activeLeagues.length, rawProj, playerDb]);

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
            myRecord: { wins: 0, losses: 0, ties: 0 },
            myProj: 0,
            opponentRosterId: null,
            opponentRecord: { wins: 0, losses: 0, ties: 0 },
            opponentProj: 0,
            winPct: 50,
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
      ]).then(([rosters, weekMatchups]: [any[] | null, any[] | null]) => {
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
          setMatchups(prev => ({
            ...prev,
            [league.leagueId]: { ...prev[league.leagueId], loading: false, error: false },
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

        const proj = (pid: string): number => (rawProj[pid]?.[field] ?? 0);
        const myProj = (myMatchup.starters || [])
          .filter((id: string) => id && id !== "0")
          .reduce((s: number, id: string) => s + proj(id), 0);
        const opponentProj = opponentMatchup
          ? (opponentMatchup.starters || [])
              .filter((id: string) => id && id !== "0")
              .reduce((s: number, id: string) => s + proj(id), 0)
          : 0;

        const total = myProj + opponentProj;
        const winPct = total > 0 ? (myProj / total) * 100 : 50;

        setMatchups(prev => ({
          ...prev,
          [league.leagueId]: {
            leagueId: league.leagueId,
            leagueName: league.name,
            format: league.format || "1QB",
            scoringFormat: league.scoringFormat,
            avatar: league.avatar ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}` : null,
            myRosterId: myRoster.roster_id,
            myRecord,
            myProj,
            opponentRosterId: opponentMatchup?.roster_id ?? null,
            opponentRecord,
            opponentProj,
            winPct,
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

  const refresh = useCallback(() => {
    setBaseLoading(true);
    setAnalyses({});
    setMatchups({});
    setNflWeek(null);
    setRawProj({});
    setPlayerDb({});
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
            <Lock className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400" />
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
      <SectionHeader title="Lineup Command" subtitle="Review starters, identify lineup issues, and optimize weekly decisions." />
      {/* ── Sub-tab switcher ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-end -mt-3">
      {(baseLoading || allLoading || mAllLoading) && (
        <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin mr-3" />
      )}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/6 w-fit">
        {(["lineup", "matchups"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            data-testid={`tab-${tab}`}
            className={cn(
              "relative px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200",
              activeTab === tab
                ? "bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25"
                : "text-white/35 hover:text-white/60"
            )}
          >
            {tab === "lineup" ? "Lineup Command" : "Matchups"}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-[2px] rounded-full bg-[#d4af37]" />
            )}
          </button>
        ))}
      </div>
      </div>

      {/* ══════════════════ LINEUP COMMAND TAB ══════════════════ */}
      {activeTab === "lineup" && (
        <>
          {/* ── Hero KPI bar ───────────────────────────────────────── */}
          <div
            className="rounded-2xl border border-[#d4af37]/15 p-4 md:p-5"
            style={{ background: "linear-gradient(135deg, rgba(4,13,26,0.95) 0%, rgba(11,58,122,0.08) 100%)" }}
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#d4af37]/60 mb-3 md:mb-4">
              Operations Overview
            </p>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2 md:gap-3">
              <KpiCard icon={AlertTriangle} label="Lineup Issues"  value={hasAnyData ? kpis.totalIssues : "—"} accent="red"    sub="Out · IR · Bye" />
              <KpiCard icon={TrendingUp}   label="Optimal Swaps"  value={hasAnyData ? kpis.totalSwaps : "—"}  accent="blue"   sub="Available" />
              <KpiCard icon={Zap}          label="Points Gain"    value={hasAnyData ? (kpis.totalGain > 0 ? `+${fmt1(kpis.totalGain)}` : "—") : "—"} accent="gold" sub="Projected" />
              <KpiCard icon={Activity}     label="Questionable"   value={hasAnyData ? kpis.questionable : "—"} accent="yellow" sub="Starters" />
              <KpiCard icon={CalendarX}    label="Bye Conflicts"  value={hasAnyData ? kpis.byeConflicts : "—"} accent="slate"  sub="Active starters" />
            </div>
          </div>

          {/* ── Lineup table ───────────────────────────────────────── */}
          <div
            className="rounded-2xl overflow-hidden border border-white/6"
            style={{ background: "linear-gradient(180deg, rgba(4,13,26,0.9) 0%, rgba(4,10,20,0.95) 100%)" }}
          >
            <div className="flex items-center gap-2 md:gap-3 px-3 md:px-5 py-2 border-b border-white/6 bg-white/[0.02]">
              {(() => {
                function SortBtn({ col, label, className }: { col: typeof sortKey; label: string; className?: string }) {
                  const active = sortKey === col;
                  return (
                    <button onClick={() => handleSort(col)} className={cn("flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors cursor-pointer select-none", active ? "text-[#d4af37]" : "text-white/30 hover:text-white/55", className)}>
                      {label}
                      {active ? (sortDir === "desc" ? <ChevronDown className="w-2.5 h-2.5 flex-shrink-0" /> : <ChevronUp className="w-2.5 h-2.5 flex-shrink-0" />) : <ArrowUpDown className="w-2.5 h-2.5 flex-shrink-0 opacity-40" />}
                    </button>
                  );
                }
                return (
                  <>
                    <SortBtn col="league"      label="League"      className="flex-1 min-w-0 justify-start" />
                    <SortBtn col="current"     label="Current"     className="w-14 md:w-16 justify-end" />
                    <SortBtn col="improvement" label="Improvement" className="w-24 md:w-28 justify-end" />
                    <SortBtn col="hard"        label="Out/IR/Bye"  className="w-[72px] md:w-24 justify-center" />
                    <SortBtn col="soft"        label="Ques/Doub"   className="w-[64px] md:w-20 justify-center hidden sm:flex" />
                    <SortBtn col="status"      label="Status"      className="w-[96px] md:w-[108px] justify-end" />
                  </>
                );
              })()}
            </div>
            {baseLoading && sortedAnalyses.length === 0 ? (
              [...Array(Math.min(activeLeagues.length || 4, 6))].map((_, i) => <SkeletonRow key={i} />)
            ) : sortedAnalyses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <Users className="w-8 h-8 text-white/15 mb-3" />
                <p className="text-sm font-semibold text-white/40">No leagues found</p>
                <p className="text-xs text-white/25 mt-1">Connect leagues in the Portfolio tab to get started.</p>
              </div>
            ) : (
              sortedAnalyses.map(a => <LeagueRow key={a.leagueId} analysis={a} />)
            )}
          </div>

          <p className="text-[9px] text-white/20 text-center px-4">
            Projections from Sleeper · Updated weekly · Optimal lineup uses projected points, not dynasty values
          </p>
        </>
      )}

      {/* ══════════════════ MATCHUPS TAB ══════════════════ */}
      {activeTab === "matchups" && (
        <>
          {/* ── Matchup KPI bar ────────────────────────────────────── */}
          <div
            className="rounded-2xl border border-[#d4af37]/15 p-4 md:p-5"
            style={{ background: "linear-gradient(135deg, rgba(4,13,26,0.95) 0%, rgba(11,58,122,0.08) 100%)" }}
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#d4af37]/60 mb-3 md:mb-4">
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

          {/* ── Matchup table ──────────────────────────────────────── */}
          <div
            className="rounded-2xl overflow-hidden border border-white/6"
            style={{ background: "linear-gradient(180deg, rgba(4,13,26,0.9) 0%, rgba(4,10,20,0.95) 100%)" }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-3 md:px-5 py-2 border-b border-white/6 bg-white/[0.02]">
              {(() => {
                function MSortBtn({ col, label, className }: { col: typeof mSortKey; label: string; className?: string }) {
                  const active = mSortKey === col;
                  return (
                    <button onClick={() => handleMSort(col)} className={cn("flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors cursor-pointer select-none", active ? "text-[#d4af37]" : "text-white/30 hover:text-white/55", className)}>
                      {label}
                      {active ? (mSortDir === "desc" ? <ChevronDown className="w-2.5 h-2.5 flex-shrink-0" /> : <ChevronUp className="w-2.5 h-2.5 flex-shrink-0" />) : <ArrowUpDown className="w-2.5 h-2.5 flex-shrink-0 opacity-40" />}
                    </button>
                  );
                }
                return (
                  <>
                    <MSortBtn col="league"    label="League"         className="flex-1 min-w-0 justify-start" />
                    <MSortBtn col="record"    label="Record"         className="w-14 justify-end" />
                    <MSortBtn col="myProj"    label="Proj Pts"       className="w-16 justify-end" />
                    <MSortBtn col="oppRecord" label="Opp Record"     className="w-14 justify-end" />
                    <MSortBtn col="oppProj"   label="Opp Pts"        className="w-16 justify-end" />
                    <MSortBtn col="winPct"    label="Win %"          className="w-[72px] justify-end" />
                  </>
                );
              })()}
            </div>

            {/* Rows */}
            {baseLoading && sortedMatchups.length === 0 ? (
              [...Array(Math.min(activeLeagues.length || 4, 6))].map((_, i) => <MatchupSkeletonRow key={i} />)
            ) : sortedMatchups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <Swords className="w-8 h-8 text-white/15 mb-3" />
                <p className="text-sm font-semibold text-white/40">No matchup data yet</p>
                <p className="text-xs text-white/25 mt-1">Matchup data loads once projections are available.</p>
              </div>
            ) : (
              sortedMatchups.map(m => <MatchupRow key={m.leagueId} m={m} />)
            )}
          </div>

          <p className="text-[9px] text-white/20 text-center px-4">
            Matchup projections from Sleeper starters · Win % = projected pts / combined projected pts · Records from current standings
          </p>
        </>
      )}
    </div>
  );
}
