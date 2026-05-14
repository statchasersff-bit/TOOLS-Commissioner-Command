import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useToast } from "@/hooks/use-toast";
import type { League, Team, Player } from "@/types";
import { cn } from "@/lib/utils";
import { Zap, RefreshCw, Users, AlertCircle, Download, Loader2 } from "lucide-react";
import { getLeagueTeamTiers, getTierEmoji, type Tier } from "@/data/mockData";
import { toPng } from "html-to-image";

// ─── Tier colour maps ─────────────────────────────────────────────────────────
const TIER_GLOW: Record<string, string> = {
  "Juggernaut":           "212,175,55",
  "Win-Now":              "96,165,250",
  "Future Powerhouse":    "52,211,153",
  "Pick Hoarder":         "192,132,252",
  "Taco":                 "248,113,113",
  "Contender":            "251,191,36",
  "Pretender":            "56,189,248",
  "Rebuilder":            "251,146,60",
  "Weak / Directionless": "251,113,133",
  "Balanced":             "148,163,184",
};
const TIER_BORDER: Record<string, string> = {
  "Juggernaut":           "#d4af37",
  "Win-Now":              "#60a5fa",
  "Future Powerhouse":    "#34d399",
  "Pick Hoarder":         "#c084fc",
  "Taco":                 "#f87171",
  "Contender":            "#fbbf24",
  "Pretender":            "#38bdf8",
  "Rebuilder":            "#fb923c",
  "Weak / Directionless": "#fb7185",
  "Balanced":             "#94a3b8",
};

const SLEEPER_API = "https://api.sleeper.app/v1";

// ─── Slot eligibility ─────────────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlotAssignment {
  slot: string;
  slotLabel: string;
  player: Player | null;
  projection?: number;
  injuryStatus?: string;
}
type PlayerState = "out" | "ir" | "doubtful" | "questionable" | "probable" | "upside" | "healthy";
interface BenchPlayer extends Player {
  projection?: number;
  injuryStatus?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function projField(scoringFormat: string): string {
  if (scoringFormat === "PPR")  return "pts_ppr";
  if (scoringFormat === "Half") return "pts_half_ppr";
  return "pts_std";
}
function getPlayerState(injuryStatus?: string, proj?: number): PlayerState {
  if (injuryStatus === "IR")           return "ir";
  if (injuryStatus === "Out")          return "out";
  if (injuryStatus === "Doubtful")     return "doubtful";
  if (injuryStatus === "Questionable") return "questionable";
  if (injuryStatus === "Probable")     return "probable";
  if (proj && proj >= 22)              return "upside";
  return "healthy";
}

const STATE_STYLES: Record<PlayerState, { ring: string; badge: string; glow: string; dot: string }> = {
  out:          { ring: "ring-red-500/50",      badge: "bg-red-500/20 text-red-400 border-red-500/40",           glow: "[box-shadow:0_0_14px_rgba(239,68,68,0.25)]",  dot: "bg-red-500" },
  ir:           { ring: "ring-red-500/50",      badge: "bg-red-500/20 text-red-400 border-red-500/40",           glow: "[box-shadow:0_0_14px_rgba(239,68,68,0.25)]",  dot: "bg-red-500" },
  doubtful:     { ring: "ring-red-400/40",      badge: "bg-red-400/15 text-red-400 border-red-400/40",           glow: "[box-shadow:0_0_12px_rgba(239,68,68,0.18)]",  dot: "bg-red-400" },
  questionable: { ring: "ring-yellow-400/50",   badge: "bg-yellow-400/15 text-yellow-400 border-yellow-400/40", glow: "[box-shadow:0_0_14px_rgba(234,179,8,0.22)]",  dot: "bg-yellow-400" },
  probable:     { ring: "ring-emerald-400/30",  badge: "bg-emerald-400/10 text-emerald-400 border-emerald-400/30", glow: "",                                           dot: "bg-emerald-400" },
  upside:       { ring: "ring-blue-400/50",     badge: "",                                                        glow: "[box-shadow:0_0_16px_rgba(96,165,250,0.28)]",dot: "bg-blue-400" },
  healthy:      { ring: "ring-white/8",         badge: "",                                                        glow: "",                                            dot: "" },
};

const SLOT_BADGE_COLORS: Record<string, string> = {
  QB:         "bg-rose-500/25 text-rose-300 border-rose-500/30",
  RB:         "bg-emerald-500/25 text-emerald-300 border-emerald-500/30",
  WR:         "bg-sky-500/25 text-sky-300 border-sky-500/30",
  TE:         "bg-yellow-500/25 text-yellow-300 border-yellow-500/30",
  FLEX:       "bg-purple-500/25 text-purple-300 border-purple-500/30",
  SUPER_FLEX: "bg-indigo-500/25 text-indigo-300 border-indigo-500/30",
  REC_FLEX:   "bg-teal-500/25 text-teal-300 border-teal-500/30",
  WRRB_FLEX:  "bg-cyan-500/25 text-cyan-300 border-cyan-500/30",
  K:          "bg-slate-500/25 text-slate-300 border-slate-500/30",
  DEF:        "bg-orange-500/25 text-orange-300 border-orange-500/30",
};

// ─── Desktop PlayerCard ───────────────────────────────────────────────────────
function PlayerCard({ assignment, compact = false }: { assignment: SlotAssignment; compact?: boolean }) {
  const { slot, slotLabel, player, projection, injuryStatus } = assignment;
  const state = getPlayerState(injuryStatus, projection);
  const { ring, badge, glow } = STATE_STYLES[state];
  const slotColor = SLOT_BADGE_COLORS[slot] ?? "bg-white/10 text-white/60 border-white/15";
  const lastName = player ? player.name.split(" ").slice(1).join(" ") || player.name : "";

  if (!player) {
    return (
      <div className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-white/8",
        "bg-black/20 backdrop-blur-sm p-2 md:p-2.5",
        compact ? "min-w-[80px] md:min-w-[90px]" : "min-w-[92px] md:min-w-[112px]"
      )}>
        <Badge variant="outline" className={cn("text-[8px] md:text-[9px] px-1.5 py-0 h-4", slotColor)}>{slotLabel}</Badge>
        <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white/5 border border-dashed border-white/10" />
        <span className="text-[9px] text-white/25">Empty</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-col items-center gap-1 rounded-xl border bg-[#040d1a]/70 backdrop-blur-md",
      "p-2 md:p-2.5 transition-all duration-300 cursor-default select-none ring-1",
      ring, glow,
      compact ? "min-w-[80px] md:min-w-[90px]" : "min-w-[92px] md:min-w-[112px]",
      state === "out" || state === "ir" ? "border-red-500/30" :
      state === "doubtful"              ? "border-red-400/25" :
      state === "questionable"          ? "border-yellow-400/30" :
      state === "upside"                ? "border-blue-400/30" : "border-white/8"
    )}>
      <Badge variant="outline" className={cn("text-[8px] md:text-[9px] px-1.5 py-0 h-4 mb-0.5", slotColor)}>{slotLabel}</Badge>
      <PlayerAvatar id={player.sleeperId ?? player.id} name={player.name} pos={player.pos} team={player.team ?? ""} size="sm" compact />
      <span className="text-[10px] md:text-[11px] font-bold text-white/90 text-center leading-tight line-clamp-1 mt-0.5 max-w-[80px] md:max-w-[100px]">
        {lastName || player.name}
      </span>
      <span className="text-[8px] md:text-[9px] text-white/40 -mt-0.5 font-medium">{player.team || "FA"}</span>
      {typeof projection === "number" && (
        <div className="flex items-center gap-0.5 mt-0.5">
          <Zap className="w-2.5 h-2.5 text-[#d4af37] flex-shrink-0" />
          <span className="text-[10px] md:text-[11px] font-bold text-[#d4af37] tabular-nums">{projection.toFixed(1)}</span>
        </div>
      )}
      {injuryStatus && badge && (
        <Badge variant="outline" className={cn("text-[7px] md:text-[8px] px-1 py-0 h-3.5 mt-0.5 uppercase tracking-wide", badge)}>
          {injuryStatus}
        </Badge>
      )}
    </div>
  );
}

// ─── Mobile PlayerCard ────────────────────────────────────────────────────────
function MobilePlayerCard({ assignment }: { assignment: SlotAssignment }) {
  const { slot, slotLabel, player, projection, injuryStatus } = assignment;
  const state  = getPlayerState(injuryStatus, projection);
  const { dot } = STATE_STYLES[state];
  const slotColor = SLOT_BADGE_COLORS[slot] ?? "bg-white/10 text-white/60 border-white/15";
  const lastName  = player ? player.name.split(" ").slice(1).join(" ") || player.name : "";
  const borderCol = state === "out" || state === "ir" ? "border-red-500/40"
                  : state === "questionable"           ? "border-yellow-400/35"
                  : state === "upside"                 ? "border-blue-400/30"
                  :                                      "border-white/10";

  if (!player) {
    return (
      <div className="flex flex-col items-center gap-1 w-[62px] flex-shrink-0">
        <span className={cn("text-[7px] font-bold px-1.5 py-0 rounded-full border", slotColor)}>{slotLabel}</span>
        <div className="w-8 h-8 rounded-full bg-white/5 border border-dashed border-white/15" />
        <span className="text-[8px] text-white/20">–</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-col items-center gap-0.5 w-[62px] flex-shrink-0 rounded-lg border bg-[#040d1a]/60 py-1.5 px-1",
      borderCol
    )}>
      {/* Slot pill */}
      <span className={cn("text-[7px] font-bold px-1.5 rounded-full border leading-snug", slotColor)}>{slotLabel}</span>

      {/* Avatar with status dot */}
      <div className="relative mt-0.5">
        <PlayerAvatar
          id={player.sleeperId ?? player.id}
          name={player.name}
          pos={player.pos}
          team={player.team ?? ""}
          size="xs"
          compact
        />
        {dot && (
          <span className={cn("absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#040d1a]", dot)} />
        )}
      </div>

      {/* Last name */}
      <span className="text-[8px] font-bold text-white/90 text-center leading-tight line-clamp-1 w-full px-0.5 mt-0.5">
        {lastName || player.name}
      </span>

      {/* Team */}
      <span className="text-[7px] text-white/35 font-medium">{player.team || "FA"}</span>

      {/* Projection */}
      {typeof projection === "number" && (
        <div className="flex items-center gap-0.5">
          <Zap className="w-1.5 h-1.5 text-[#d4af37]" />
          <span className="text-[7px] font-bold text-[#d4af37] tabular-nums">{projection.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Desktop BenchCard ────────────────────────────────────────────────────────
function BenchCard({ player }: { player: BenchPlayer }) {
  const state = getPlayerState(player.injuryStatus, player.projection);
  const { ring, badge, glow } = STATE_STYLES[state];
  const lastName = player.name.split(" ").slice(1).join(" ") || player.name;

  return (
    <div className={cn(
      "flex flex-col items-center gap-1 rounded-xl border bg-[#040d1a]/70 backdrop-blur-md",
      "p-2 md:p-2.5 min-w-[92px] md:min-w-[112px] flex-shrink-0 ring-1 transition-all duration-300 cursor-default select-none",
      ring, glow,
      state === "out" || state === "ir" ? "border-red-500/30" :
      state === "doubtful"              ? "border-red-400/25" :
      state === "questionable"          ? "border-yellow-400/30" :
      state === "upside"                ? "border-blue-400/30" : "border-white/8"
    )}>
      <Badge variant="outline" className={cn("text-[8px] md:text-[9px] px-1.5 py-0 h-4 mb-0.5", SLOT_BADGE_COLORS[player.pos] ?? "bg-white/10 text-white/60 border-white/15")}>
        {player.pos}
      </Badge>
      <PlayerAvatar id={player.sleeperId ?? player.id} name={player.name} pos={player.pos} team={player.team ?? ""} size="sm" compact />
      <span className="text-[10px] md:text-[11px] font-bold text-white/90 text-center leading-tight line-clamp-1 mt-0.5 max-w-[80px] md:max-w-[100px]">
        {lastName}
      </span>
      <span className="text-[8px] md:text-[9px] text-white/40 -mt-0.5 font-medium">{player.team || "FA"}</span>
      {typeof player.projection === "number" && (
        <div className="flex items-center gap-0.5 mt-0.5">
          <Zap className="w-2.5 h-2.5 text-[#d4af37] flex-shrink-0" />
          <span className="text-[10px] md:text-[11px] font-bold text-[#d4af37] tabular-nums">{player.projection.toFixed(1)}</span>
        </div>
      )}
      {player.injuryStatus && badge && (
        <Badge variant="outline" className={cn("text-[7px] md:text-[8px] px-1 py-0 h-3.5 mt-0.5 uppercase tracking-wide", badge)}>
          {player.injuryStatus}
        </Badge>
      )}
    </div>
  );
}

// ─── Mobile BenchCard ─────────────────────────────────────────────────────────
function MobileBenchCard({ player }: { player: BenchPlayer }) {
  const state = getPlayerState(player.injuryStatus, player.projection);
  const { dot } = STATE_STYLES[state];
  const lastName = player.name.split(" ").slice(1).join(" ") || player.name;
  const posColor = SLOT_BADGE_COLORS[player.pos] ?? "bg-white/10 text-white/60 border-white/15";
  const borderCol = state === "out" || state === "ir" ? "border-red-500/40"
                  : state === "questionable"           ? "border-yellow-400/35"
                  : state === "upside"                 ? "border-blue-400/30"
                  :                                      "border-white/10";

  return (
    <div className={cn(
      "flex flex-col items-center gap-0.5 w-[62px] flex-shrink-0 rounded-lg border bg-[#040d1a]/60 py-1.5 px-1",
      borderCol
    )}>
      <span className={cn("text-[7px] font-bold px-1.5 py-0 rounded-full border leading-snug", posColor)}>{player.pos}</span>
      <div className="relative mt-0.5">
        <PlayerAvatar id={player.sleeperId ?? player.id} name={player.name} pos={player.pos} team={player.team ?? ""} size="xs" compact />
        {dot && <span className={cn("absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#040d1a]", dot)} />}
      </div>
      <span className="text-[8px] font-bold text-white/90 text-center leading-tight line-clamp-1 w-full px-0.5 mt-0.5">
        {lastName}
      </span>
      <span className="text-[7px] text-white/35 font-medium">{player.team || "FA"}</span>
      {typeof player.projection === "number" && (
        <div className="flex items-center gap-0.5">
          <Zap className="w-1.5 h-1.5 text-[#d4af37]" />
          <span className="text-[7px] font-bold text-[#d4af37] tabular-nums">{player.projection.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Desktop FieldRow ─────────────────────────────────────────────────────────
function FieldRow({ slots, spread = false, label }: { slots: SlotAssignment[]; spread?: boolean; label?: string }) {
  if (slots.length === 0) return null;
  return (
    <div className="relative w-full">
      {label && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] font-bold text-white/15 tracking-[0.15em] uppercase hidden md:block">
          {label}
        </span>
      )}
      <div className={cn(
        "flex items-center gap-2 md:gap-3 flex-wrap",
        spread ? "justify-around px-0 md:px-4" : "justify-center",
      )}>
        {slots.map((s, i) => <PlayerCard key={`${s.slot}-${i}`} assignment={s} compact={slots.length >= 4} />)}
      </div>
    </div>
  );
}

// ─── Mobile FieldRow ──────────────────────────────────────────────────────────
function MobileFieldRow({ slots, label }: { slots: SlotAssignment[]; label?: string }) {
  if (slots.length === 0) return null;
  return (
    <div className="w-full">
      {label && (
        <div className="text-center mb-1">
          <span className="text-[7px] font-bold text-white/20 tracking-[0.2em] uppercase">{label}</span>
        </div>
      )}
      <div className="flex items-start justify-center gap-1 flex-wrap">
        {slots.map((s, i) => <MobilePlayerCard key={`${s.slot}-${i}`} assignment={s} />)}
      </div>
    </div>
  );
}

// ─── EndZone ──────────────────────────────────────────────────────────────────
function EndZone({ label, variant, mobile = false }: { label: string; variant: "top" | "bottom"; mobile?: boolean }) {
  return (
    <div className={cn(
      "relative flex items-center justify-center overflow-hidden",
      mobile ? "py-1.5" : "py-3",
      variant === "top"
        ? "bg-gradient-to-b from-[#0a1628] to-transparent border-b border-white/5"
        : "bg-gradient-to-t from-[#0b3a7a]/30 to-transparent border-t border-white/5"
    )}>
      <span className={cn(
        "relative font-bold tracking-[0.25em] uppercase text-white/20 text-center px-4 truncate max-w-full",
        mobile ? "text-[7px]" : "text-[9px] md:text-[10px]"
      )}>
        {label}
      </span>
      <div className="absolute left-3 right-3 bottom-0 h-px bg-white/6" />
    </div>
  );
}

// ─── FieldBackground ──────────────────────────────────────────────────────────
function FieldBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute inset-0" style={{
        background: "linear-gradient(180deg, #0a1c0f 0%, #0e2a14 12%, #102e17 25%, #0f2c15 50%, #0e2a14 75%, #0a1c0f 100%)"
      }} />
      {[...Array(6)].map((_, i) => (
        <div key={i} className="absolute left-0 right-0" style={{
          top: `${8 + i * 14}%`, height: "7%",
          background: i % 2 === 0 ? "rgba(255,255,255,0.018)" : "transparent",
        }} />
      ))}
      {[0, 20, 40, 60, 80, 100].map(pct => (
        <div key={pct} className="absolute left-0 right-0 h-px" style={{
          top: `${pct}%`,
          background: pct === 0 || pct === 100 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
        }} />
      ))}
      <div className="absolute left-0 right-0 h-px" style={{ top: "50%", background: "rgba(255,255,255,0.10)" }} />
      {[15, 25, 35, 45, 55, 65, 75, 85].map(pct => (
        <div key={pct}>
          <div className="absolute w-3 h-px" style={{ top: `${pct}%`, left: "20%", background: "rgba(255,255,255,0.08)" }} />
          <div className="absolute w-3 h-px" style={{ top: `${pct}%`, right: "20%", background: "rgba(255,255,255,0.08)" }} />
        </div>
      ))}
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse 80% 40% at 50% 50%, rgba(255,255,255,0.028) 0%, transparent 70%)"
      }} />
      <div className="absolute inset-0" style={{
        background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 18%, transparent 82%, rgba(0,0,0,0.35) 100%)"
      }} />
      <div className="absolute inset-0" style={{
        background: "linear-gradient(90deg, rgba(0,0,0,0.28) 0%, transparent 12%, transparent 88%, rgba(0,0,0,0.28) 100%)"
      }} />
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function FieldLegend() {
  return (
    <div className="flex items-center gap-3 flex-wrap text-[9px] text-white/40">
      <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400/60" /> Upside (≥22 pts)</div>
      <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400/60" /> Questionable</div>
      <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/60" /> Out / IR</div>
      <div className="flex items-center gap-1"><Zap className="w-2.5 h-2.5 text-[#d4af37]" /> Projected pts</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function FieldView({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue } = useValueModel();
  const { toast } = useToast();

  const [projections, setProjections] = useState<Record<string, number>>({});
  const [opponentName, setOpponentName] = useState<string | null>(null);
  const [week, setWeek]     = useState<number | null>(null);
  const [season, setSeason] = useState<string>("2025");
  const [isLoading, setIsLoading]   = useState(true);
  const [playersDb, setPlayersDb]   = useState<Record<string, any>>({});
  const [error, setError]           = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);

  const doExport = useCallback(async () => {
    if (!fieldRef.current) return;
    setIsExporting(true);
    await new Promise(r => setTimeout(r, 80));
    try {
      const dataUrl = await toPng(fieldRef.current, {
        cacheBust: true, backgroundColor: "#080f1e", pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `field-view-${userTeam.owner || "team"}.png`;
      link.href = dataUrl;
      link.click();
      toast({ title: "Field exported!", description: "Saved as PNG." });
    } catch {
      toast({ title: "Export failed", description: "Try again or check browser permissions.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [userTeam.owner, toast]);

  const rosterPositions = useMemo(() => league.rosterPositions ?? [], [league.rosterPositions]);
  const scoringFormat   = league.scoringFormat ?? "PPR";

  const userTier = useMemo<Tier | null>(() => {
    const tiers = getLeagueTeamTiers(league.teams);
    return tiers.get(userTeam.id)?.tier ?? null;
  }, [league.teams, userTeam.id]);

  const userRosterId = useMemo(() => {
    const m = userTeam.id.match(/^roster_(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }, [userTeam.id]);

  // ── Fetch external data ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    (async () => {
      try {
        const state = await fetch(`${SLEEPER_API}/state/nfl`).then(r => r.json());
        const w: number = state.week ?? 1;
        const s: string = state.season ?? "2025";
        if (cancelled) return;
        setWeek(w); setSeason(s);

        const db = await getSleeperPlayers();
        if (cancelled) return;
        setPlayersDb(db);

        try {
          const field = projField(scoringFormat);
          const raw = await fetch(
            `${SLEEPER_API}/projections/nfl/${s}/${w}?season_type=regular` +
            `&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`
          ).then(r => r.json());
          if (cancelled) return;
          const map: Record<string, number> = {};
          for (const [pid, stats] of Object.entries(raw as Record<string, any>)) {
            const v = (stats as any)?.[field];
            if (typeof v === "number" && v > 0) map[pid] = Math.round(v * 10) / 10;
          }
          setProjections(map);
        } catch { /* projections optional */ }

        if (userRosterId !== null) {
          try {
            const matchups = await fetch(`${SLEEPER_API}/league/${league.id}/matchups/${w}`).then(r => r.json());
            if (cancelled) return;
            const mine = (matchups as any[]).find(m => m.roster_id === userRosterId);
            if (mine) {
              const opp = (matchups as any[]).find(m => m.matchup_id === mine.matchup_id && m.roster_id !== userRosterId);
              if (opp) {
                const oppTeam = league.teams.find(t => t.id === `roster_${opp.roster_id}`);
                if (oppTeam) setOpponentName(oppTeam.owner);
              }
            }
          } catch { /* matchup optional */ }
        }
      } catch {
        if (!cancelled) setError("Could not load live data — showing dynasty values only.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [league.id, userRosterId, scoringFormat]);

  // ── Assign starters to slots ─────────────────────────────────────────────
  const { starterSlots, benchPlayers } = useMemo(() => {
    const starters = [...userTeam.roster]
      .filter(p => p.starter)
      .map(p => ({ ...p, _rv: getPlayerValue(p) }))
      .sort((a, b) => b._rv - a._rv);
    const nonStarters = userTeam.roster.filter(p => !p.starter);

    const used = new Set<string>();
    const assignments: SlotAssignment[] = [];
    const slotTypeCounts: Record<string, number> = {};
    for (const s of rosterPositions) {
      if (!NON_STARTER.has(s)) slotTypeCounts[s] = (slotTypeCounts[s] ?? 0) + 1;
    }
    const slotTypeIdx: Record<string, number> = {};
    const activeSlots = rosterPositions.filter(s => !NON_STARTER.has(s));
    const positional  = activeSlots.filter(s => SLOT_ELIGIBILITY[s]?.length === 1 || ["K","DEF"].includes(s));
    const flex        = activeSlots.filter(s => !positional.includes(s) && SLOT_ELIGIBILITY[s]);

    for (const slot of [...positional, ...flex]) {
      const eligible = SLOT_ELIGIBILITY[slot] ?? [];
      const best  = starters.find(p => eligible.includes(p.pos) && !used.has(p.id));
      const idx   = slotTypeIdx[slot] ?? 0;
      slotTypeIdx[slot] = idx + 1;
      const label = slotTypeCounts[slot] > 1 ? `${slot}${idx + 1}` : slot;

      if (best) {
        used.add(best.id);
        const sid = best.sleeperId ?? best.id;
        assignments.push({
          slot, slotLabel: label.replace("SUPER_FLEX","SFLX").replace("REC_FLEX","RFLX").replace("WRRB_FLEX","FLEX"),
          player: best, projection: projections[sid], injuryStatus: playersDb[sid]?.injury_status,
        });
      } else {
        assignments.push({ slot, slotLabel: label.replace("SUPER_FLEX","SFLX"), player: null });
      }
    }
    const bench: BenchPlayer[] = nonStarters.map(p => {
      const sid = p.sleeperId ?? p.id;
      return { ...p, projection: projections[sid], injuryStatus: playersDb[sid]?.injury_status };
    });
    return { starterSlots: assignments, benchPlayers: bench };
  }, [userTeam.roster, rosterPositions, projections, playersDb, getPlayerValue]);

  // ── Group rows ───────────────────────────────────────────────────────────
  const { qbRow, rbTeRow, wrRow, flexRow, specialRow } = useMemo(() => {
    const qbRow      = starterSlots.filter(s => s.slot === "QB" || (s.slot === "SUPER_FLEX" && s.player?.pos === "QB"));
    const rbTeRow    = starterSlots.filter(s => s.slot === "RB" || s.slot === "TE");
    const wrRow      = starterSlots.filter(s => s.slot === "WR");
    const flexRow    = starterSlots.filter(s =>
      ["FLEX","REC_FLEX","WRRB_FLEX"].includes(s.slot) || (s.slot === "SUPER_FLEX" && s.player?.pos !== "QB")
    );
    const specialRow = starterSlots.filter(s => ["K","DEF","IDP_FLEX"].includes(s.slot));
    return { qbRow, rbTeRow, wrRow, flexRow, specialRow };
  }, [starterSlots]);

  const projTotal      = useMemo(() => starterSlots.reduce((sum, s) => sum + (s.projection ?? 0), 0).toFixed(1), [starterSlots]);
  const hasProjections = Object.keys(projections).length > 0;

  // Tier colours for GM card
  const glowRgb   = userTier ? (TIER_GLOW[userTier]   ?? "212,175,55") : "212,175,55";
  const borderHex = userTier ? (TIER_BORDER[userTier] ?? "#d4af37")    : "#d4af37";
  const tierEmoji = userTier ? getTierEmoji(userTier) : null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">
              Field View <span className="font-normal text-muted-foreground">(Current Lineup)</span>
            </h2>
            {isLoading && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {week !== null ? `Week ${week} · ${season} Season` : "Calculating…"}
            {opponentName && <span className="text-[#d4af37] font-medium ml-1">· vs {opponentName}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasProjections && (
            <div className="flex items-center gap-1 bg-[#d4af37]/10 border border-[#d4af37]/25 rounded-lg px-2.5 py-1">
              <Zap className="w-3 h-3 text-[#d4af37]" />
              <span className="text-xs font-bold text-[#d4af37] tabular-nums">{projTotal} proj</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-1 text-[10px] text-yellow-400/70">
              <AlertCircle className="w-3 h-3" />
              <span className="hidden md:inline">{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile GM header strip (hidden on desktop) ────────────────── */}
      <div
        className="flex md:hidden items-center gap-3 rounded-xl px-3 py-2.5 border"
        style={{
          background: `linear-gradient(135deg, rgba(3,8,15,0.92) 0%, rgba(${glowRgb},0.06) 100%)`,
          borderColor: `${borderHex}44`,
          boxShadow: `0 0 12px rgba(${glowRgb},0.12)`,
        }}
      >
        {/* Avatar */}
        <div
          className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
          style={{ boxShadow: `0 0 0 2px ${borderHex}55, 0 0 10px rgba(${glowRgb},0.3)` }}
        >
          {userTeam.avatar ? (
            <img src={userTeam.avatar} alt={userTeam.owner} className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-base font-black bg-[#0b3a7a]/60" style={{ color: borderHex }}>
              {(userTeam.owner || "?").charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Name + tier */}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-white/90 leading-tight truncate">{userTeam.name || "My Team"}</p>
          <p className="text-[10px] text-white/40 truncate">by {userTeam.owner || "Manager"}</p>
        </div>

        {/* Right side: tier + record */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {userTier && (
            <span
              className="text-[8px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: `rgba(${glowRgb},0.18)`, color: borderHex, border: `1px solid ${borderHex}44` }}
            >
              {tierEmoji} {userTier}
            </span>
          )}
          {(userTeam.wins !== undefined || userTeam.losses !== undefined) && (
            <span className="text-[11px] font-black tabular-nums" style={{ color: borderHex }}>
              {userTeam.wins ?? 0}–{userTeam.losses ?? 0}{userTeam.ties ? `–${userTeam.ties}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Export capture wrapper (field + bench) ────────────────────── */}
      <div ref={fieldRef} className="space-y-3">

        {/* ══ DESKTOP field ══════════════════════════════════════════════ */}
        <div className="hidden md:block relative rounded-2xl overflow-hidden border border-white/6 shadow-2xl">
          <FieldBackground />

          {/* Desktop GM card — floating top-left */}
          <div
            className="absolute top-12 left-2 z-20 flex flex-col items-center gap-1.5 rounded-2xl bg-[#03080f]/80 backdrop-blur-xl p-3 transition-all duration-300 hover:scale-[1.03]"
            style={{
              minWidth: 112,
              border: `1.5px solid ${borderHex}55`,
              boxShadow: `0 0 18px rgba(${glowRgb},0.25), 0 0 6px rgba(${glowRgb},0.15), inset 0 1px 0 rgba(255,255,255,0.04)`,
            }}
          >
            <span className="text-[8px] font-black tracking-widest uppercase px-2 py-0.5 rounded-full"
              style={{ background: `rgba(${glowRgb},0.15)`, color: borderHex, border: `1px solid ${borderHex}55` }}>
              GM
            </span>
            <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0"
              style={{ boxShadow: `0 0 0 2px ${borderHex}66, 0 0 16px rgba(${glowRgb},0.4)` }}>
              {userTeam.avatar ? (
                <img src={userTeam.avatar} alt={userTeam.owner} className="w-full h-full object-cover"
                  onError={e => { (e.target as HTMLImageElement).src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl font-black bg-[#0b3a7a]/60" style={{ color: borderHex }}>
                  {(userTeam.owner || "?").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span className="text-[11px] font-bold text-white/90 text-center leading-tight line-clamp-2 max-w-[104px]">{userTeam.name || "My Team"}</span>
            <span className="text-[9px] text-white/40 text-center -mt-0.5 truncate max-w-[104px]">by {userTeam.owner || "Manager"}</span>
            {userTier && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 text-center leading-tight"
                style={{ background: `rgba(${glowRgb},0.18)`, color: borderHex, border: `1px solid ${borderHex}44` }}>
                {tierEmoji} {userTier}
              </span>
            )}
            {(userTeam.wins !== undefined || userTeam.losses !== undefined) && (
              <span className="text-[11px] font-black tabular-nums mt-0.5" style={{ color: borderHex }}>
                {userTeam.wins ?? 0}–{userTeam.losses ?? 0}{userTeam.ties ? `–${userTeam.ties}` : ""}
              </span>
            )}
          </div>

          <EndZone label={opponentName ? `${opponentName}'s End Zone` : "Opponent"} variant="top" />
          <div className="relative z-10 px-3 md:px-6 py-3 md:py-4 space-y-3 md:space-y-4">
            <FieldRow slots={qbRow}      label="QB"    />
            <FieldRow slots={rbTeRow}    label="RB·TE" />
            <FieldRow slots={wrRow}      label="WR"    spread />
            <FieldRow slots={flexRow}    label="FLEX"  />
            <FieldRow slots={specialRow} label="K/D"   />
          </div>
          <EndZone label={userTeam.name || "Your End Zone"} variant="bottom" />
        </div>

        {/* ══ MOBILE field ═══════════════════════════════════════════════ */}
        <div className="md:hidden relative rounded-xl overflow-hidden border border-white/8" style={{ background: "linear-gradient(180deg,#0a1c0f 0%,#0e2a14 40%,#0f2c15 60%,#0a1c0f 100%)" }}>
          {/* Simplified turf lines */}
          <div className="absolute inset-0 pointer-events-none">
            {[25, 50, 75].map(pct => (
              <div key={pct} className="absolute left-0 right-0 h-px" style={{ top: `${pct}%`, background: "rgba(255,255,255,0.05)" }} />
            ))}
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(255,255,255,0.02) 0%, transparent 70%)" }} />
          </div>

          <EndZone label={opponentName ? `${opponentName}'s End Zone` : "Opponent"} variant="top" mobile />

          {/* Mobile formation rows */}
          <div className="relative z-10 px-2 py-2 space-y-2">
            <MobileFieldRow slots={qbRow}      label="QB" />
            <MobileFieldRow slots={rbTeRow}    label="RB · TE" />
            <MobileFieldRow slots={wrRow}      label="WR" />
            <MobileFieldRow slots={flexRow}    label="FLEX" />
            <MobileFieldRow slots={specialRow} label="K / D" />
          </div>

          <EndZone label={userTeam.name || "Your End Zone"} variant="bottom" mobile />
        </div>

        {/* ── Bench ──────────────────────────────────────────────────── */}
        {benchPlayers.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2 px-0.5">
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-bold text-muted-foreground tracking-wide uppercase">Bench</span>
              <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{benchPlayers.length}</Badge>
            </div>

            {/* Desktop bench */}
            <div className="hidden md:block relative">
              <div className="flex gap-2 flex-wrap">
                {benchPlayers.map((p, i) => <BenchCard key={`bench-${p.id}-${i}`} player={p} />)}
              </div>
            </div>

            {/* Mobile bench — horizontal swipe carousel */}
            <div className="md:hidden relative">
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                {benchPlayers.map((p, i) => <MobileBenchCard key={`mobilebench-${p.id}-${i}`} player={p} />)}
              </div>
            </div>
          </div>
        )}
      </div>{/* end export capture wrapper */}

      {/* ── Legend ─────────────────────────────────────────────────────── */}
      <div className="pt-1 px-0.5">
        <FieldLegend />
      </div>
    </div>
  );
}
