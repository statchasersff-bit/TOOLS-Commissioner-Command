import { useState, useEffect, useMemo, useRef } from "react";
import { useValueModel } from "@/contexts/ValueModelContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search, Trophy, Zap, Target, TrendingUp, Star, ChevronDown } from "lucide-react";

const RB_DATA_URL =
  "https://cdn.jsdelivr.net/gh/statchasersff-bit/statchasers-data@master/statchasers-data/output/rb_player_overview.json";

const normalizeName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");

const formatNum = (value: unknown, digits = 1): string => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
};

interface RBRaw {
  player: string;
  team: string;
  age: number;
  games: number;
  rush_att_per_gm: number;
  targets_per_gm: number;
  yards_per_touch: number;
  explosive_run_pct: number;
  rz_rush_att: number;
  rb_tier: string;
  overall_score?: number;
}

interface ResolvedRB extends RBRaw {
  dynVal: number;
  rdVal: number;
  sleeperId: string | null;
}

const getRbStats = (p: RBRaw) => ({
  "Rush Att/G":  { raw: p.rush_att_per_gm,   display: formatNum(p.rush_att_per_gm) },
  "Targets/G":   { raw: p.targets_per_gm,    display: formatNum(p.targets_per_gm) },
  "Yds/Touch":   { raw: p.yards_per_touch,   display: formatNum(p.yards_per_touch) },
  "Explosive %": { raw: p.explosive_run_pct, display: `${formatNum(p.explosive_run_pct)}%` },
  "RZ Att/G":    { raw: p.games ? p.rz_rush_att / p.games : null, display: p.games ? formatNum(p.rz_rush_att / p.games) : "—" },
});

const TIER_COLORS: Record<string, string> = {
  "Elite":     "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  "RB1":       "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40",
  "RB2":       "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "RB3":       "bg-slate-500/15 text-slate-400 border-slate-500/30",
  "RB4":       "bg-slate-500/10 text-slate-500 border-slate-500/20",
  "Fringe":    "bg-slate-600/10 text-slate-500 border-slate-600/20",
  "Handcuff":  "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

function getTierColor(tier: string): string {
  if (!tier) return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  const key = Object.keys(TIER_COLORS).find(k => tier.toLowerCase().includes(k.toLowerCase()));
  return key ? TIER_COLORS[key] : "bg-slate-500/15 text-slate-400 border-slate-500/30";
}

const EDGES = [
  {
    id: "best-role",
    label: "Best Role Player",
    Icon: Star,
    color: "text-[#d4af37]",
    bgColor: "bg-[#d4af37]/10 border-[#d4af37]/30",
    compute: (p: ResolvedRB) => (p.rush_att_per_gm ?? 0) + (p.targets_per_gm ?? 0),
  },
  {
    id: "best-efficiency",
    label: "Best Efficiency",
    Icon: Zap,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/30",
    compute: (p: ResolvedRB) => (p.yards_per_touch ?? 0) + (p.explosive_run_pct ?? 0),
  },
  {
    id: "best-td",
    label: "Best TD Opportunity",
    Icon: Target,
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/30",
    compute: (p: ResolvedRB) => p.games ? p.rz_rush_att / p.games : 0,
  },
  {
    id: "best-dynasty",
    label: "Best Dynasty Asset",
    Icon: TrendingUp,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/30",
    compute: (p: ResolvedRB) => p.dynVal,
  },
  {
    id: "best-winnow",
    label: "Best Win-Now Asset",
    Icon: Trophy,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/30",
    compute: (p: ResolvedRB) => p.rdVal,
  },
] as const;

// ── Player selector combobox ───────────────────────────────────────
function PlayerSelector({
  label,
  players,
  value,
  onChange,
}: {
  label: string;
  players: RBRaw[];
  value: string | null;
  onChange: (name: string | null) => void;
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
            placeholder="Search RBs..."
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
            filtered.map(p => (
              <button
                key={p.player}
                className={cn(
                  "w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-[#0b3a7a]/30 transition-colors",
                  p.player === value && "bg-[#0b3a7a]/20 text-[#d4af37]"
                )}
                onClick={() => handleSelect(p.player)}
                data-testid={`option-${p.player}`}
              >
                <Badge variant="outline" className={cn("text-[9px] px-1 py-0 flex-shrink-0", getTierColor(p.rb_tier))}>
                  {p.rb_tier || "—"}
                </Badge>
                <span className="font-medium truncate">{p.player}</span>
                <span className="text-muted-foreground ml-auto flex-shrink-0">{p.team}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Player card ────────────────────────────────────────────────────
function PlayerCard({
  player,
  bestStats,
  slot,
}: {
  player: ResolvedRB;
  bestStats: Record<string, number>;
  slot: number;
}) {
  const stats = getRbStats(player);

  return (
    <div
      className="group rounded-2xl overflow-hidden border border-[#d4af37]/25 shadow-[0_0_28px_rgba(212,175,55,0.1)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_36px_rgba(212,175,55,0.18)] hover:border-[#d4af37]/50 bg-[#080e1c]"
      data-testid={`player-card-${slot}`}
    >
      {/* Player image */}
      <div className="relative aspect-square w-full overflow-hidden bg-[#0b1628]">
        {player.sleeperId ? (
          <img
            src={`https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg`}
            alt={player.player}
            className="w-full h-full object-cover object-top"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl font-black text-[#d4af37]/20">{player.player.charAt(0)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#080e1c] via-transparent to-transparent" />
        <div className="absolute bottom-2 left-3">
          <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 font-bold backdrop-blur-sm", getTierColor(player.rb_tier))}>
            {player.rb_tier || "—"}
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
        {(Object.entries(stats) as [string, { raw: number | null; display: string }][]).map(([label, { raw, display }]) => {
          const isBest = raw !== null && raw !== undefined && bestStats[label] !== undefined && raw === bestStats[label];
          return (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{label}</span>
              <span className={cn(
                "text-[11px] font-mono font-semibold tabular-nums",
                isBest ? "text-emerald-400" : "text-foreground/80"
              )}>
                {isBest && <span className="mr-0.5 text-emerald-500">▲</span>}
                {display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Edge summary row ───────────────────────────────────────────────
function EdgeLabels({ players }: { players: (ResolvedRB | null)[] }) {
  const active = players.filter(Boolean) as ResolvedRB[];
  if (active.length < 2) return null;

  return (
    <Card className="mt-2 bg-[#080e1c] border-[#d4af37]/15" data-testid="edge-labels">
      <CardContent className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Comparison Edge</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {EDGES.map(({ id, label, Icon, color, bgColor, compute }) => {
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

// ── Main export ────────────────────────────────────────────────────
export function CompareRBs() {
  const { dynastyPlayerList, redraftValuesBySleeperId } = useValueModel();
  const [rbData, setRbData] = useState<RBRaw[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<[string | null, string | null, string | null]>([null, null, null]);

  useEffect(() => {
    fetch(RB_DATA_URL)
      .then(r => { if (!r.ok) throw new Error("Network error"); return r.json(); })
      .then((data: RBRaw[]) => { setRbData(data); setLoading(false); })
      .catch(() => { setFetchError("Failed to load player data."); setLoading(false); });
  }, []);

  // Build name → dynasty/redraft/sleeperId lookup
  const nameMap = useMemo(() => {
    const m = new Map<string, { dynVal: number; rdVal: number; sleeperId: string }>();
    for (const p of dynastyPlayerList) {
      if (p.pos !== "RB") continue;
      m.set(normalizeName(p.name), {
        dynVal: p.value,
        rdVal: redraftValuesBySleeperId[p.sleeperId] ?? 0,
        sleeperId: p.sleeperId,
      });
    }
    return m;
  }, [dynastyPlayerList, redraftValuesBySleeperId]);

  const resolved = useMemo<(ResolvedRB | null)[]>(() => {
    return selected.map(name => {
      if (!name) return null;
      const rb = rbData.find(p => p.player === name);
      if (!rb) return null;
      const matched = nameMap.get(normalizeName(name));
      // fallback: try first-last name partial match
      let fallback = matched;
      if (!fallback) {
        const nameParts = normalizeName(name).slice(0, 5);
        if (nameParts.length >= 4) {
          const entry = Array.from(nameMap.entries()).find(([key]) => key.includes(nameParts));
          if (entry) fallback = entry[1];
        }
      }
      return {
        ...rb,
        dynVal: fallback?.dynVal ?? 0,
        rdVal: fallback?.rdVal ?? 0,
        sleeperId: fallback?.sleeperId ?? null,
      };
    });
  }, [selected, rbData, nameMap]);

  // Compute per-stat best values across selected players (for green highlight)
  const bestStats = useMemo(() => {
    const activeResolved = resolved.filter(Boolean) as ResolvedRB[];
    if (activeResolved.length < 2) return {} as Record<string, number>;
    const result: Record<string, number> = {};
    const statSets = activeResolved.map(p => getRbStats(p));
    const keys = Object.keys(statSets[0]) as (keyof ReturnType<typeof getRbStats>)[];
    for (const key of keys) {
      const raws = statSets.map(s => s[key].raw).filter(v => v !== null) as number[];
      if (raws.length > 0) result[key] = Math.max(...raws);
    }
    return result;
  }, [resolved]);

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
        <h3 className="text-base font-bold">Compare RBs</h3>
        <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1" />
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Select up to 3 running backs for a side-by-side breakdown of stats, dynasty value, and competitive edge.
        </p>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {([0, 1, 2] as const).map(slot => (
          <PlayerSelector
            key={slot}
            label={loading ? "Loading..." : SLOT_LABELS[slot]}
            players={rbData}
            value={selected[slot]}
            onChange={name => setSlot(slot, name)}
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

          <EdgeLabels players={resolved} />
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
