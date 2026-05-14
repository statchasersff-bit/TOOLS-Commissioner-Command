import { useState, useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSleeper } from "@/contexts/SleeperContext";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, TrendingUp, Zap, Users, CalendarX,
  ChevronDown, ChevronUp, RefreshCw, Lock, CheckCircle2,
  ArrowRight, Activity,
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
  currentProj: number;
  optimalProj: number;
  gain: number;
  issues: LineupIssue[];
  swaps: SwapRec[];
  loading: boolean;
  error: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 animate-pulse">
      <div className="flex-1 h-3.5 bg-white/8 rounded" />
      <div className="w-14 h-3.5 bg-white/8 rounded" />
      <div className="w-14 h-3.5 bg-white/8 rounded" />
      <div className="w-10 h-3.5 bg-white/8 rounded" />
      <div className="w-24 h-3.5 bg-white/8 rounded" />
      <div className="flex-1 h-3.5 bg-white/8 rounded" />
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
  const { leagueName, format, scoringFormat, currentProj, optimalProj, gain, issues, swaps, loading, error } = analysis;

  const gainColor = gain >= 10 ? "text-emerald-400" : gain >= 3 ? "text-emerald-500/80" : gain > 0.5 ? "text-emerald-600" : "text-white/25";
  const criticalIssues = issues.filter(i => i.type === "out" || i.type === "ir" || i.type === "doubtful" || i.type === "bye");
  const topSwap = swaps[0];
  const hasAction = swaps.length > 0 || criticalIssues.length > 0;

  return (
    <div className={cn(
      "border-b border-white/5 last:border-0 transition-colors",
      hasAction ? "hover:bg-white/[0.02]" : "hover:bg-white/[0.01]"
    )}>
      {/* Main row */}
      <div
        className="flex items-center gap-2 md:gap-3 px-3 md:px-5 py-3 cursor-pointer select-none"
        onClick={() => (swaps.length > 0 || issues.length > 0) && setExpanded(v => !v)}
        data-testid={`row-lineup-${analysis.leagueId}`}
      >
        {/* League name + format */}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] md:text-sm font-bold text-white/90 truncate leading-tight">{leagueName}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[8px] md:text-[9px] text-white/30 font-medium">{format} · {scoringFormat}</span>
          </div>
        </div>

        {/* Current proj */}
        <div className="text-right w-14 md:w-16 flex-shrink-0">
          {loading ? (
            <div className="h-3.5 bg-white/8 rounded animate-pulse" />
          ) : error ? (
            <span className="text-[10px] text-white/20">—</span>
          ) : (
            <>
              <p className="text-[11px] md:text-xs font-bold text-white/55 tabular-nums">{fmt1(currentProj)}</p>
              <p className="text-[8px] text-white/25">current</p>
            </>
          )}
        </div>

        {/* Optimal proj */}
        <div className="text-right w-14 md:w-16 flex-shrink-0 hidden sm:block">
          {loading ? (
            <div className="h-3.5 bg-white/8 rounded animate-pulse" />
          ) : error ? (
            <span className="text-[10px] text-white/20">—</span>
          ) : (
            <>
              <p className="text-[11px] md:text-xs font-bold text-white/85 tabular-nums">{fmt1(optimalProj)}</p>
              <p className="text-[8px] text-white/25">optimal</p>
            </>
          )}
        </div>

        {/* Gain */}
        <div className="text-right w-12 md:w-14 flex-shrink-0">
          {loading ? (
            <div className="h-3.5 bg-white/8 rounded animate-pulse" />
          ) : error ? (
            <span className="text-[10px] text-white/20">—</span>
          ) : (
            <p className={cn("text-[12px] md:text-sm font-black tabular-nums", gainColor)}>
              {gain > 0.1 ? `+${fmt1(gain)}` : "—"}
            </p>
          )}
        </div>

        {/* Issues */}
        <div className="flex items-center gap-1 w-20 md:w-24 flex-shrink-0 justify-end">
          {loading ? (
            <div className="h-4 w-16 bg-white/8 rounded animate-pulse" />
          ) : (
            <>
              {issues.slice(0, 3).map((iss, i) => <IssueBadge key={i} type={iss.type} />)}
              {issues.length > 3 && (
                <span className="text-[8px] text-white/30">+{issues.length - 3}</span>
              )}
              {issues.length === 0 && !loading && !error && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/50" />
              )}
            </>
          )}
        </div>

        {/* Recommendation */}
        <div className="flex-1 min-w-0 hidden md:block">
          {loading ? (
            <div className="h-3.5 bg-white/8 rounded animate-pulse w-3/4" />
          ) : error ? (
            <span className="text-[10px] text-white/20">—</span>
          ) : topSwap ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-white/40">Start</span>
              <span className="text-[10px] font-bold text-emerald-400">{topSwap.inName}</span>
              <ArrowRight className="w-2.5 h-2.5 text-white/20 flex-shrink-0" />
              <span className="text-[10px] font-medium text-white/50">{topSwap.outName}</span>
              {topSwap.projGain > 0 && (
                <span className="text-[9px] text-emerald-500/70 ml-0.5">(+{fmt1(topSwap.projGain)})</span>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-emerald-500/50 font-medium">✓ Optimal</span>
          )}
        </div>

        {/* Expand toggle */}
        {(swaps.length > 0 || issues.length > 0) && !loading && !error && (
          <button
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-white/25 hover:text-white/60 transition-colors"
            onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
            data-testid={`button-expand-${analysis.leagueId}`}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
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

// ─── Main Component ───────────────────────────────────────────────────────────
export function LineupCommand() {
  const { isConnected, user, leagues } = useSleeper();

  const [nflWeek, setNflWeek]     = useState<number | null>(null);
  const [season, setSeason]       = useState("2025");
  const [rawProj, setRawProj]     = useState<Record<string, Record<string, number>>>({});
  const [playerDb, setPlayerDb]   = useState<Record<string, any>>({});
  const [baseLoading, setBaseLoading] = useState(true);
  const [baseError, setBaseError]   = useState<string | null>(null);
  const [analyses, setAnalyses]   = useState<Record<string, LeagueAnalysis>>({});

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
        const w: number = state.week ?? 1;
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

  const refresh = useCallback(() => {
    setBaseLoading(true);
    setAnalyses({});
    setNflWeek(null);
    setRawProj({});
    setPlayerDb({});
    setBaseLoading(false);
  }, []);

  // ── Aggregate KPIs ───────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const list = Object.values(analyses).filter(a => !a.loading && !a.error);
    const totalIssues     = list.reduce((s, a) => s + a.issues.filter(i => i.type !== "questionable").length, 0);
    const totalSwaps      = list.reduce((s, a) => s + a.swaps.length, 0);
    const totalGain       = list.reduce((s, a) => s + a.gain, 0);
    const questionable    = list.reduce((s, a) => s + a.issues.filter(i => i.type === "questionable").length, 0);
    const byeConflicts    = list.reduce((s, a) => s + a.issues.filter(i => i.type === "bye").length, 0);
    return { totalIssues, totalSwaps, totalGain, questionable, byeConflicts };
  }, [analyses]);

  // Sort analyses: most gain first, then most issues
  const sortedAnalyses = useMemo(() =>
    Object.values(analyses).sort((a, b) => {
      if (a.loading !== b.loading) return a.loading ? 1 : -1;
      const scoreA = a.gain * 2 + a.issues.length;
      const scoreB = b.gain * 2 + b.issues.length;
      return scoreB - scoreA;
    }),
  [analyses]);

  const allLoading = Object.values(analyses).every(a => a.loading);
  const hasAnyData = Object.values(analyses).some(a => !a.loading && !a.error);

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
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#d4af37]" />
            <h2 className="text-sm font-bold text-foreground">Lineup Command</h2>
            <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-[#d4af37]/30 text-[#d4af37]/70">
              Week {nflWeek ?? "—"} · Priority View
            </Badge>
            {(baseLoading || allLoading) && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cross-league lineup optimization · {activeLeagues.length} league{activeLeagues.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={baseLoading} data-testid="button-refresh-lineup">
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline ml-1.5">Refresh</span>
        </Button>
      </div>

      {/* ── Hero KPI bar ─────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl border border-[#d4af37]/15 p-4 md:p-5"
        style={{ background: "linear-gradient(135deg, rgba(4,13,26,0.95) 0%, rgba(11,58,122,0.08) 100%)" }}
      >
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#d4af37]/60 mb-3 md:mb-4">
          Operations Overview
        </p>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2 md:gap-3">
          <KpiCard
            icon={AlertTriangle}
            label="Lineup Issues"
            value={hasAnyData ? kpis.totalIssues : "—"}
            accent="red"
            sub="Out · IR · Bye"
          />
          <KpiCard
            icon={TrendingUp}
            label="Optimal Swaps"
            value={hasAnyData ? kpis.totalSwaps : "—"}
            accent="blue"
            sub="Available"
          />
          <KpiCard
            icon={Zap}
            label="Points Gain"
            value={hasAnyData ? (kpis.totalGain > 0 ? `+${fmt1(kpis.totalGain)}` : "—") : "—"}
            accent="gold"
            sub="Projected"
          />
          <KpiCard
            icon={Activity}
            label="Questionable"
            value={hasAnyData ? kpis.questionable : "—"}
            accent="yellow"
            sub="Starters"
          />
          <KpiCard
            icon={CalendarX}
            label="Bye Conflicts"
            value={hasAnyData ? kpis.byeConflicts : "—"}
            accent="slate"
            sub="Active starters"
          />
        </div>
      </div>

      {/* ── Main table ───────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden border border-white/6"
        style={{ background: "linear-gradient(180deg, rgba(4,13,26,0.9) 0%, rgba(4,10,20,0.95) 100%)" }}
      >
        {/* Table header */}
        <div className="flex items-center gap-2 md:gap-3 px-3 md:px-5 py-2.5 border-b border-white/6 bg-white/[0.02]">
          <div className="flex-1 min-w-0 text-[9px] font-bold uppercase tracking-widest text-white/30">League</div>
          <div className="w-14 md:w-16 text-right text-[9px] font-bold uppercase tracking-widest text-white/30 flex-shrink-0">Current</div>
          <div className="w-14 md:w-16 text-right text-[9px] font-bold uppercase tracking-widest text-white/30 flex-shrink-0 hidden sm:block">Optimal</div>
          <div className="w-12 md:w-14 text-right text-[9px] font-bold uppercase tracking-widest text-white/30 flex-shrink-0">Gain</div>
          <div className="w-20 md:w-24 text-right text-[9px] font-bold uppercase tracking-widest text-white/30 flex-shrink-0">Issues</div>
          <div className="flex-1 text-[9px] font-bold uppercase tracking-widest text-white/30 hidden md:block">Recommendation</div>
          <div className="w-6 flex-shrink-0" />
        </div>

        {/* Rows */}
        {baseLoading && sortedAnalyses.length === 0 ? (
          <>
            {[...Array(Math.min(activeLeagues.length || 4, 6))].map((_, i) => <SkeletonRow key={i} />)}
          </>
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

      {/* ── Footer note ──────────────────────────────────────────────────── */}
      <p className="text-[9px] text-white/20 text-center px-4">
        Projections from Sleeper · Updated weekly · Optimal lineup uses projected points, not dynasty values
      </p>
    </div>
  );
}
