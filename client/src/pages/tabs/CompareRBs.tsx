import { useState, useEffect, useMemo, useRef } from "react";
import { useValueModel } from "@/contexts/ValueModelContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search, Trophy, Zap, Target, TrendingUp, Star, ChevronDown, ArrowUpRight } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────
type Position = "RB" | "WR" | "TE" | "QB";

interface PlayerRaw {
  player: string;
  team: string;
  age: number;
  games: number;
  [key: string]: unknown;
}

interface ResolvedPlayer extends PlayerRaw {
  dynVal: number;
  rdVal: number;
  sleeperId: string | null;
}

type StatDef = {
  label: string;
  compute: (p: PlayerRaw) => number | null;
  display: (v: number) => string;
};

type EdgeDef = {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  compute: (p: ResolvedPlayer) => number;
};

// ── Helpers ─────────────────────────────────────────────────────────
const normalizeName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
const fmtNum = (v: number | null | undefined, d = 1): string =>
  v == null || isNaN(v as number) ? "—" : (v as number).toFixed(d);
const fmtPct = (v: number | null | undefined): string =>
  v == null || isNaN(v as number) ? "—" : `${(v as number).toFixed(1)}%`;

function getField(p: PlayerRaw, field: string): number | null {
  const v = p[field];
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function getTierColor(tier: string): string {
  if (!tier) return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  const t = tier.toLowerCase();
  if (t.includes("elite"))                              return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
  if (/[a-z]1$/.test(t))                               return "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40";
  if (/[a-z]2$/.test(t))                               return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  if (/[a-z]3$/.test(t))                               return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  if (/[a-z]4$/.test(t))                               return "bg-slate-500/10 text-slate-500 border-slate-500/20";
  if (t.includes("fringe"))                             return "bg-slate-600/10 text-slate-500 border-slate-600/20";
  if (t.includes("handcuff") || t.includes("backup"))  return "bg-purple-500/15 text-purple-400 border-purple-500/30";
  // Experience tiers (WR overview_2025)
  if (t.includes("year 1") || t.includes("year 2"))    return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
  if (t.includes("year 3") || t.includes("year 4"))    return "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40";
  if (t.includes("year 5") || t.includes("year 6"))    return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  if (t.includes("veteran") || t.includes("year 7"))   return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return "bg-slate-500/15 text-slate-400 border-slate-500/30";
}

// ── Position config ─────────────────────────────────────────────────
const POS_DATA_URLS: Record<Position, string> = {
  RB: "https://cdn.jsdelivr.net/gh/statchasersff-bit/statchasers-data@master/statchasers-data/output/rb_player_overview.json",
  WR: "https://cdn.jsdelivr.net/gh/statchasersff-bit/statchasers-data@master/statchasers-data/output/wr_player_overview_2025.json",
  TE: "https://cdn.jsdelivr.net/gh/statchasersff-bit/statchasers-data@master/statchasers-data/output/te_player_overview_2025.json",
  QB: "https://cdn.jsdelivr.net/gh/statchasersff-bit/statchasers-data@master/statchasers-data/output/qb_player_overview.json",
};

// Secondary data URLs (fetched and merged into primary rows by normalized player name)
const POS_SECONDARY_URL: Partial<Record<Position, string>> = {
  WR: "https://raw.githubusercontent.com/statchasersff-bit/statchasers-data/refs/heads/master/statchasers-data/output/wr_advanced_stats_2025.json",
  TE: "https://cdn.jsdelivr.net/gh/statchasersff-bit/statchasers-data@master/statchasers-data/output/te_advanced_stats_2025.json",
};

const POS_TIER_FIELD: Record<Position, string> = {
  RB: "rb_tier", WR: "exp_tier", TE: "exp_tier", QB: "qb_tier",
};

const POS_LABELS: Record<Position, string> = {
  RB: "Running Backs", WR: "Wide Receivers", TE: "Tight Ends", QB: "Quarterbacks",
};

const POS_DESC: Record<Position, string> = {
  RB: "Compare up to 3 running backs for a side-by-side breakdown of stats, dynasty value, and competitive edge.",
  WR: "Compare up to 3 wide receivers for a side-by-side breakdown of stats, dynasty value, and competitive edge.",
  TE: "Compare up to 3 tight ends for a side-by-side breakdown of stats, dynasty value, and competitive edge.",
  QB: "Compare up to 3 quarterbacks for a side-by-side breakdown of stats, dynasty value, and competitive edge.",
};

const DYNASTY_EDGE: EdgeDef = {
  id: "best-dynasty", label: "Best Dynasty Asset", Icon: TrendingUp,
  color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30",
  compute: p => p.dynVal,
};
const WINNOW_EDGE: EdgeDef = {
  id: "best-winnow", label: "Best Win-Now", Icon: Trophy,
  color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/30",
  compute: p => p.rdVal,
};

// WR-specific named dynasty/win-now edges
const WR_DYNASTY_EDGE: EdgeDef = {
  id: "dynasty-edge", label: "Dynasty Edge", Icon: TrendingUp,
  color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30",
  compute: p => p.dynVal,
};
const WR_WINNOW_EDGE: EdgeDef = {
  id: "winnow-edge", label: "Win-Now Edge", Icon: Trophy,
  color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/30",
  compute: p => p.rdVal,
};

const POS_STATS: Record<Position, StatDef[]> = {
  RB: [
    { label: "Rush Att/G",  compute: p => getField(p, "rush_att_per_gm"),   display: v => fmtNum(v) },
    { label: "Targets/G",   compute: p => getField(p, "targets_per_gm"),    display: v => fmtNum(v) },
    { label: "Yds/Touch",   compute: p => getField(p, "yards_per_touch"),   display: v => fmtNum(v) },
    { label: "Explosive %", compute: p => getField(p, "explosive_run_pct"), display: v => fmtPct(v) },
    { label: "RZ Att/G",    compute: p => { const rz = getField(p, "rz_rush_att"); const g = getField(p, "games"); return rz !== null && g ? rz / g : null; }, display: v => fmtNum(v) },
  ],
  WR: [
    { label: "Tgt/Gm",       compute: p => getField(p, "targets_per_gm"),    display: v => fmtNum(v) },
    { label: "Rec/Gm",       compute: p => getField(p, "receptions_per_gm"), display: v => fmtNum(v) },
    { label: "Air Yards/Gm", compute: p => getField(p, "air_yards_per_gm"),  display: v => fmtNum(v) },
    { label: "Yards/Tgt",    compute: p => getField(p, "yards_per_target"),  display: v => fmtNum(v) },
    { label: "RZ Tgt/Gm",   compute: p => getField(p, "rz_tgt_per_game"),   display: v => fmtNum(v) },
  ],
  TE: [
    { label: "Tgt/Gm",       compute: p => getField(p, "targets_per_gm"),    display: v => fmtNum(v) },
    { label: "Rec/Gm",       compute: p => getField(p, "receptions_per_gm"), display: v => fmtNum(v) },
    { label: "Air Yds/Gm",   compute: p => getField(p, "air_yards_per_gm"),  display: v => fmtNum(v) },
    { label: "Yds/Tgt",      compute: p => getField(p, "yards_per_target"),  display: v => fmtNum(v) },
    { label: "RZ Tgt/Gm",    compute: p => getField(p, "rz_tgt_per_game"),   display: v => fmtNum(v) },
  ],
  QB: [
    { label: "Pass Att/G",  compute: p => getField(p, "pass_att_per_gm"),   display: v => fmtNum(v) },
    { label: "Comp %",      compute: p => getField(p, "completion_pct") ?? getField(p, "comp_pct"), display: v => fmtPct(v) },
    { label: "Pass Yds/G",  compute: p => getField(p, "pass_yards_per_gm"), display: v => fmtNum(v, 0) },
    { label: "TD/G",        compute: p => getField(p, "td_per_gm"),          display: v => fmtNum(v, 2) },
    { label: "Rush Yds/G",  compute: p => getField(p, "rush_yards_per_gm"), display: v => fmtNum(v, 0) },
  ],
};

const POS_EDGES: Record<Position, EdgeDef[]> = {
  RB: [
    { id: "best-role",     label: "Best Role Player",    Icon: Star,   color: "text-[#d4af37]",  bgColor: "bg-[#d4af37]/10 border-[#d4af37]/30",  compute: p => (getField(p, "rush_att_per_gm") ?? 0) + (getField(p, "targets_per_gm") ?? 0) },
    { id: "best-eff",      label: "Best Efficiency",     Icon: Zap,    color: "text-blue-400",   bgColor: "bg-blue-500/10 border-blue-500/30",     compute: p => (getField(p, "yards_per_touch") ?? 0) + (getField(p, "explosive_run_pct") ?? 0) },
    { id: "best-td",       label: "Best TD Opportunity", Icon: Target, color: "text-red-400",    bgColor: "bg-red-500/10 border-red-500/30",       compute: p => { const rz = getField(p, "rz_rush_att"); const g = getField(p, "games"); return rz !== null && g ? rz / g : 0; } },
    DYNASTY_EDGE, WINNOW_EDGE,
  ],
  WR: [
    { id: "volume",      label: "Volume Edge",        Icon: Star,        color: "text-[#d4af37]",   bgColor: "bg-[#d4af37]/10 border-[#d4af37]/30",    compute: p => (getField(p, "targets_per_gm") ?? 0) + (getField(p, "receptions_per_gm") ?? 0) },
    { id: "downfield",   label: "Downfield Edge",     Icon: ArrowUpRight,color: "text-blue-400",    bgColor: "bg-blue-500/10 border-blue-500/30",      compute: p => getField(p, "air_yards_per_gm") ?? 0 },
    { id: "efficiency",  label: "Efficiency Edge",    Icon: Zap,         color: "text-purple-400",  bgColor: "bg-purple-500/10 border-purple-500/30",  compute: p => getField(p, "yards_per_target") ?? 0 },
    { id: "td-opp",      label: "TD Opportunity",     Icon: Target,      color: "text-red-400",     bgColor: "bg-red-500/10 border-red-500/30",        compute: p => getField(p, "rz_tgt_per_game") ?? 0 },
    WR_DYNASTY_EDGE, WR_WINNOW_EDGE,
  ],
  TE: [
    { id: "volume",      label: "Volume Edge",        Icon: Star,        color: "text-[#d4af37]",   bgColor: "bg-[#d4af37]/10 border-[#d4af37]/30",    compute: p => (getField(p, "targets_per_gm") ?? 0) + (getField(p, "receptions_per_gm") ?? 0) },
    { id: "downfield",   label: "Downfield Edge",     Icon: ArrowUpRight,color: "text-blue-400",    bgColor: "bg-blue-500/10 border-blue-500/30",      compute: p => getField(p, "air_yards_per_gm") ?? 0 },
    { id: "efficiency",  label: "Efficiency Edge",    Icon: Zap,         color: "text-purple-400",  bgColor: "bg-purple-500/10 border-purple-500/30",  compute: p => getField(p, "yards_per_target") ?? 0 },
    { id: "td-opp",      label: "TD Opportunity",     Icon: Target,      color: "text-red-400",     bgColor: "bg-red-500/10 border-red-500/30",        compute: p => getField(p, "rz_tgt_per_game") ?? 0 },
    WR_DYNASTY_EDGE, WR_WINNOW_EDGE,
  ],
  QB: [
    { id: "best-passer",   label: "Best Passer",         Icon: Star,   color: "text-[#d4af37]",  bgColor: "bg-[#d4af37]/10 border-[#d4af37]/30",  compute: p => getField(p, "pass_yards_per_gm") ?? 0 },
    { id: "best-accuracy", label: "Best Accuracy",       Icon: Zap,    color: "text-blue-400",   bgColor: "bg-blue-500/10 border-blue-500/30",     compute: p => (getField(p, "completion_pct") ?? getField(p, "comp_pct")) ?? 0 },
    { id: "best-dual",     label: "Best Dual-Threat",    Icon: Target, color: "text-red-400",    bgColor: "bg-red-500/10 border-red-500/30",       compute: p => getField(p, "rush_yards_per_gm") ?? 0 },
    DYNASTY_EDGE, WINNOW_EDGE,
  ],
};

// ── Parse helpers ────────────────────────────────────────────────────
// Handles multiple envelope shapes: bare array, { rows }, { players }, { data }
function extractRows(raw: unknown): PlayerRaw[] {
  if (Array.isArray(raw)) return raw as PlayerRaw[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["rows", "players", "data", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as PlayerRaw[];
    }
  }
  return [];
}

// ── Player selector combobox ────────────────────────────────────────
function PlayerSelector({
  label,
  players,
  value,
  onChange,
  tierField,
}: {
  label: string;
  players: PlayerRaw[];
  value: string | null;
  onChange: (name: string | null) => void;
  tierField: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return players.slice(0, 40);
    const q = query.toLowerCase();
    return players.filter(p => p.player.toLowerCase().includes(q)).slice(0, 40);
  }, [players, query]);

  const selected = players.find(p => p.player === value);

  function handleSelect(name: string) {
    onChange(name);
    setQuery("");
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative w-full" data-testid={`selector-${label}`}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2.5 cursor-pointer transition-all",
          open ? "border-[#d4af37]/60 bg-[#0b1628]" : "border-border/40 bg-[#0a1220] hover:border-border/70"
        )}
        onClick={() => setOpen(o => !o)}
      >
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        {open ? (
          <input
            autoFocus
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={`Search ${label.replace(/Player \d/, "players")}...`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className={cn("flex-1 text-xs truncate", selected ? "text-foreground font-medium" : "text-muted-foreground")}>
            {selected ? selected.player : label}
          </span>
        )}
        {selected && !open ? (
          <button onClick={handleClear} className="text-muted-foreground hover:text-foreground text-xs leading-none">✕</button>
        ) : (
          <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform flex-shrink-0", open && "rotate-180")} />
        )}
      </div>

      {open && (
        <div
          className="absolute z-50 top-full mt-1 w-full rounded-xl border border-border/50 bg-[#0a1220] shadow-2xl max-h-64 overflow-y-auto"
          onMouseDown={e => e.preventDefault()}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">No players found</div>
          ) : (
            filtered.map(p => {
              const tier = String(p[tierField] ?? "");
              return (
                <button
                  key={p.player}
                  className={cn(
                    "w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-[#0b3a7a]/30 transition-colors",
                    p.player === value && "bg-[#0b3a7a]/20 text-[#d4af37]"
                  )}
                  onClick={() => handleSelect(p.player)}
                  data-testid={`option-${p.player}`}
                >
                  <Badge variant="outline" className={cn("text-[9px] px-1 py-0 flex-shrink-0", getTierColor(tier))}>
                    {tier || "—"}
                  </Badge>
                  <span className="font-medium truncate">{p.player}</span>
                  <span className="text-muted-foreground ml-auto flex-shrink-0">{p.team}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Player card ─────────────────────────────────────────────────────
function PlayerCard({
  player,
  bestStats,
  slot,
  stats,
  tierField,
}: {
  player: ResolvedPlayer;
  bestStats: Record<string, number>;
  slot: number;
  stats: StatDef[];
  tierField: string;
}) {
  const tier = String(player[tierField] ?? "");

  return (
    <div
      className="group rounded-2xl overflow-hidden border border-[#d4af37]/25 shadow-[0_0_28px_rgba(212,175,55,0.1)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_36px_rgba(212,175,55,0.18)] hover:border-[#d4af37]/50 bg-[#080e1c]"
      data-testid={`player-card-${slot}`}
    >
      {/* Player image */}
      <div className="relative aspect-square w-full overflow-hidden bg-[#0b1628]">
        {/* Team logo watermark */}
        {player.team && (
          <img
            src={`https://sleepercdn.com/images/team_logos/nfl/${player.team.toLowerCase()}.png`}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-contain p-4 opacity-[0.18] scale-110 pointer-events-none"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        {player.sleeperId ? (
          <img
            src={`https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg`}
            alt={player.player}
            className="relative w-full h-full object-cover object-top"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="relative w-full h-full flex items-center justify-center">
            <span className="text-5xl font-black text-[#d4af37]/20">{player.player.charAt(0)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#080e1c] via-transparent to-transparent" />
        <div className="absolute bottom-2 left-3">
          <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 font-bold backdrop-blur-sm", getTierColor(tier))}>
            {tier || "—"}
          </Badge>
        </div>
      </div>

      {/* Identity */}
      <div className="px-4 pt-3 pb-1">
        <h3 className="text-base font-bold text-white leading-tight truncate">{player.player}</h3>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-[#d4af37] font-semibold">{player.team}</span>
          <span className="text-[10px] text-muted-foreground">Age {player.age}</span>
          <span className="text-[10px] text-muted-foreground">{player.games}G</span>
        </div>
      </div>

      {/* Dynasty / Redraft value pills */}
      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-center">
          <p className="text-[9px] uppercase tracking-wider text-emerald-500/70 font-semibold mb-0.5">Dynasty</p>
          <p className="text-base font-bold text-emerald-400">{player.dynVal > 0 ? player.dynVal.toLocaleString() : "—"}</p>
        </div>
        <div className="rounded-xl bg-[#0b3a7a]/20 border border-[#0b3a7a]/40 px-3 py-2 text-center">
          <p className="text-[9px] uppercase tracking-wider text-blue-400/70 font-semibold mb-0.5">Win-Now</p>
          <p className="text-base font-bold text-blue-400">{player.rdVal > 0 ? player.rdVal.toLocaleString() : "—"}</p>
        </div>
      </div>

      {/* Stat grid */}
      <div className="px-4 pb-4 space-y-1.5">
        <div className="h-px bg-[#d4af37]/10 mb-2" />
        {stats.map(({ label, compute, display }) => {
          const raw = compute(player);
          const isBest = raw !== null && bestStats[label] !== undefined && raw === bestStats[label];
          return (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{label}</span>
              <span className={cn(
                "text-[11px] font-mono font-semibold tabular-nums",
                isBest ? "text-emerald-400" : "text-foreground/80"
              )}>
                {isBest && <span className="mr-0.5 text-emerald-500">▲</span>}
                {raw !== null ? display(raw) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Edge summary row ────────────────────────────────────────────────
function EdgeLabels({ players, edges }: { players: (ResolvedPlayer | null)[]; edges: EdgeDef[] }) {
  const active = players.filter(Boolean) as ResolvedPlayer[];
  if (active.length < 2) return null;

  const gridClass = edges.length >= 6
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
    : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";

  return (
    <Card className="mt-2 bg-[#080e1c] border-[#d4af37]/15" data-testid="edge-labels">
      <CardContent className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Comparison Edge</p>
        <div className={cn("grid gap-2", gridClass)}>
          {edges.map(({ id, label, Icon, color, bgColor, compute }) => {
            const scores = active.map(p => ({ name: p.player, score: compute(p) }));
            const best = scores.reduce((a, b) => b.score > a.score ? b : a, scores[0]);
            const isTie = scores.filter(s => s.score === best.score).length > 1;

            return (
              <div key={id} className={cn("rounded-xl border px-3 py-2.5 text-center", bgColor)} data-testid={`edge-${id}`}>
                <Icon className={cn("w-3.5 h-3.5 mx-auto mb-1", color)} />
                <p className="text-[9px] text-muted-foreground leading-tight mb-1">{label}</p>
                <p className={cn("text-[11px] font-bold truncate leading-tight", color)}>
                  {isTie ? "Tied" : best.name.split(" ").slice(-1)[0]}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main export ─────────────────────────────────────────────────────
export function CompareRBs() {
  const { dynastyPlayerList, redraftValuesBySleeperId } = useValueModel();
  const [pos, setPos] = useState<Position>("RB");
  const [playerData, setPlayerData] = useState<PlayerRaw[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<[string | null, string | null, string | null]>([null, null, null]);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    setPlayerData([]);
    setSelected([null, null, null]);

    const primaryUrl = POS_DATA_URLS[pos];
    const secondaryUrl = POS_SECONDARY_URL[pos] ?? null;

    const primaryFetch = fetch(primaryUrl)
      .then(r => { if (!r.ok) throw new Error("Network error"); return r.json(); })
      .then(extractRows);

    const secondaryFetch = secondaryUrl
      ? fetch(secondaryUrl)
          .then(r => r.ok ? r.json() : null)
          .then(d => d ? extractRows(d) : [])
          .catch(() => [] as PlayerRaw[])
      : Promise.resolve([] as PlayerRaw[]);

    Promise.all([primaryFetch, secondaryFetch])
      .then(([primary, secondary]) => {
        if (!secondary.length) {
          setPlayerData(primary);
        } else {
          // Build lookup: normalized name → secondary row
          const secMap = new Map<string, PlayerRaw>();
          for (const row of secondary) {
            secMap.set(normalizeName(row.player), row);
          }
          // Merge: compute derived fields (rz_tgt_per_game for WR)
          const merged = primary.map(p => {
            const sec = secMap.get(normalizeName(p.player));
            if (!sec) return p;
            // rz_tgt_per_game = rz_tgt / g (from advanced stats)
            const rz = Number(sec["rz_tgt"]);
            const g  = Number(sec["g"]);
            const rzPerGame = !isNaN(rz) && g > 0 ? rz / g : null;
            return {
              ...p,
              ...(rzPerGame !== null ? { rz_tgt_per_game: rzPerGame } : {}),
            };
          });
          setPlayerData(merged);
        }
        setLoading(false);
      })
      .catch(() => { setFetchError("Failed to load player data."); setLoading(false); });
  }, [pos]);

  const tierField = POS_TIER_FIELD[pos];
  const stats     = POS_STATS[pos];
  const edges     = POS_EDGES[pos];

  const nameMap = useMemo(() => {
    const m = new Map<string, { dynVal: number; rdVal: number; sleeperId: string }>();
    for (const p of dynastyPlayerList) {
      if (p.pos !== pos) continue;
      m.set(normalizeName(p.name), {
        dynVal: p.value,
        rdVal: redraftValuesBySleeperId[p.sleeperId] ?? 0,
        sleeperId: p.sleeperId,
      });
    }
    return m;
  }, [dynastyPlayerList, redraftValuesBySleeperId, pos]);

  const resolved = useMemo<(ResolvedPlayer | null)[]>(() => {
    return selected.map(name => {
      if (!name) return null;
      const raw = playerData.find(p => p.player === name);
      if (!raw) return null;
      const matched = nameMap.get(normalizeName(name));
      let fallback = matched;
      if (!fallback) {
        const nameParts = normalizeName(name).slice(0, 5);
        if (nameParts.length >= 4) {
          const entry = Array.from(nameMap.entries()).find(([key]) => key.includes(nameParts));
          if (entry) fallback = entry[1];
        }
      }
      return {
        ...raw,
        dynVal: fallback?.dynVal ?? 0,
        rdVal:  fallback?.rdVal  ?? 0,
        sleeperId: fallback?.sleeperId ?? null,
      };
    });
  }, [selected, playerData, nameMap]);

  const bestStats = useMemo(() => {
    const active = resolved.filter(Boolean) as ResolvedPlayer[];
    if (active.length < 2) return {} as Record<string, number>;
    const result: Record<string, number> = {};
    for (const { label, compute } of stats) {
      const vals = active.map(compute).filter(v => v !== null) as number[];
      if (vals.length > 0) result[label] = Math.max(...vals);
    }
    return result;
  }, [resolved, stats]);

  const setSlot = (slot: 0 | 1 | 2, name: string | null) => {
    setSelected(prev => {
      const next = [...prev] as [string | null, string | null, string | null];
      next[slot] = name;
      return next;
    });
  };

  const SLOT_LABELS = ["Player 1", "Player 2", "Player 3"] as const;

  return (
    <div className="space-y-5" data-testid="compare-rbs">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-bold">Compare {POS_LABELS[pos]}</h3>
            <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
            <p className="text-[11px] text-muted-foreground mt-1.5">{POS_DESC[pos]}</p>
          </div>

          {/* Position switcher */}
          <div className="flex items-center gap-1 bg-[#0a1220] rounded-full p-1 flex-shrink-0 border border-border/30">
            {(["RB", "WR", "TE", "QB"] as Position[]).map(p => (
              <button
                key={p}
                onClick={() => setPos(p)}
                data-testid={`pos-tab-${p}`}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-bold transition-all",
                  pos === p
                    ? "bg-[#0b3a7a] text-white shadow-sm"
                    : "text-muted-foreground hover:text-white"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {([0, 1, 2] as const).map(slot => (
          <PlayerSelector
            key={slot}
            label={loading ? "Loading..." : SLOT_LABELS[slot]}
            players={playerData}
            value={selected[slot]}
            onChange={name => setSlot(slot, name)}
            tierField={tierField}
          />
        ))}
      </div>

      {/* Error state */}
      {fetchError && (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-red-400">{fetchError}</p>
          </CardContent>
        </Card>
      )}

      {/* Cards grid */}
      {!fetchError && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {([0, 1, 2] as const).map(slot => (
              resolved[slot] ? (
                <PlayerCard
                  key={resolved[slot]!.player}
                  player={resolved[slot]!}
                  bestStats={bestStats}
                  slot={slot}
                  stats={stats}
                  tierField={tierField}
                />
              ) : (
                <div
                  key={slot}
                  className="rounded-2xl border-2 border-dashed border-border/20 flex flex-col items-center justify-center aspect-[3/4] text-muted-foreground/30"
                  data-testid={`empty-slot-${slot}`}
                >
                  <span className="text-4xl font-black mb-2">{slot + 1}</span>
                  <span className="text-xs">{SLOT_LABELS[slot]}</span>
                </div>
              )
            ))}
          </div>

          <EdgeLabels players={resolved} edges={edges} />
        </>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-2xl bg-[#080e1c] border border-border/20 aspect-[3/4] animate-pulse" />
          ))}
        </div>
      )}
    </div>
  );
}
