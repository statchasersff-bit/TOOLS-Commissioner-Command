/**
 * PlayerProfileDrawer — reusable side-drawer / bottom-sheet that shows
 * a player's ADP overview, fantasy production (mock), advanced stats (shell),
 * ADP history graph, pick availability grid, and news (shell).
 *
 * Designed to be opened from the ADP Explorer Hex / List / Box views, but
 * intentionally has no dependency on those views — the consumer passes in
 * the ADP row it already has, and the drawer fetches the rest.
 */

import { useEffect, useState, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/apiBase";
import { cn } from "@/lib/utils";
import type { ADPResult, Position } from "@/types/draft";
import {
  Loader2, AlertCircle, TrendingUp, TrendingDown, BarChart3,
  Activity, History, Layers, Newspaper,
} from "lucide-react";

interface AdpHistoryPoint {
  window: "7d" | "30d" | "90d";
  draftCount: number;
  avgPick: number | null;
  minPick: number | null;
  maxPick: number | null;
  asOf: string;
}

interface AdpHistoryResponse {
  playerId: string;
  buckets: AdpHistoryPoint[];
  daily: Array<{ date: string; avgPick: number; count: number }>;
}

interface AvailabilityCell {
  pickNo: number;
  round: number;
  pickInRound: number;
  availabilityPct: number;
}

interface AvailabilityResponse {
  playerId: string;
  teams: number;
  rounds: number;
  totalDrafts: number;
  draftsWithPlayer: number;
  expectedPick: number | null;
  cells: AvailabilityCell[];
}

const POS_TINT: Record<Position, { bg: string; ring: string; text: string }> = {
  QB:   { bg: "bg-red-500/15",     ring: "ring-red-500/40",     text: "text-red-300" },
  RB:   { bg: "bg-emerald-500/15", ring: "ring-emerald-500/40", text: "text-emerald-300" },
  WR:   { bg: "bg-blue-500/15",    ring: "ring-blue-500/40",    text: "text-blue-300" },
  TE:   { bg: "bg-amber-500/15",   ring: "ring-amber-500/40",   text: "text-amber-300" },
  K:    { bg: "bg-purple-500/15",  ring: "ring-purple-500/40",  text: "text-purple-300" },
  PICK: { bg: "bg-[#d4af37]/15",   ring: "ring-[#d4af37]/40",   text: "text-[#fde68a]" },
};

interface PlayerProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  adp: ADPResult | null;
  /** Number of teams in the user's currently-selected draft size, used to
   *  build the Pick Availability grid. Defaults to 12. */
  teams?: number;
  rounds?: number;
}

export function PlayerProfileDrawer({ open, onClose, adp, teams = 12, rounds = 5 }: PlayerProfileDrawerProps) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("overview");

  // Reset to overview every time a new player is opened.
  useEffect(() => { if (open) setTab("overview"); }, [open, adp?.player_id]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "p-0 border-l border-border/60 bg-[#0a1628] text-foreground overflow-hidden flex flex-col",
          isMobile
            ? "h-[92vh] sm:max-w-full rounded-t-2xl"
            : "w-full sm:max-w-[520px]",
        )}
        data-testid="player-profile-drawer"
      >
        {/* Hidden title for a11y; the visual header lives in <ProfileHeader>. */}
        <SheetTitle className="sr-only">
          {adp ? `${adp.player_name} profile` : "Player profile"}
        </SheetTitle>

        {adp ? (
          <>
            <ProfileHeader adp={adp} />
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="mx-3 mt-2 grid grid-cols-6 h-9 bg-white/[0.04]">
                <TabsTrigger value="overview"     className="text-[10px] flex items-center gap-1"><BarChart3 className="w-3 h-3"/>Overview</TabsTrigger>
                <TabsTrigger value="production"   className="text-[10px] flex items-center gap-1"><Activity className="w-3 h-3"/>Production</TabsTrigger>
                <TabsTrigger value="advanced"     className="text-[10px] flex items-center gap-1"><Layers className="w-3 h-3"/>Advanced</TabsTrigger>
                <TabsTrigger value="history"      className="text-[10px] flex items-center gap-1"><History className="w-3 h-3"/>ADP</TabsTrigger>
                <TabsTrigger value="availability" className="text-[10px] flex items-center gap-1">Avail.</TabsTrigger>
                <TabsTrigger value="news"         className="text-[10px] flex items-center gap-1"><Newspaper className="w-3 h-3"/>News</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                <TabsContent value="overview"><OverviewTab adp={adp} /></TabsContent>
                <TabsContent value="production"><ProductionTab adp={adp} /></TabsContent>
                <TabsContent value="advanced"><AdvancedShell /></TabsContent>
                <TabsContent value="history"><AdpHistoryTab playerId={adp.player_id} active={tab === "history"} /></TabsContent>
                <TabsContent value="availability">
                  <AvailabilityTab
                    playerId={adp.player_id}
                    teams={teams}
                    rounds={rounds}
                    expectedAdp={adp.avg_pick}
                    active={tab === "availability"}
                  />
                </TabsContent>
                <TabsContent value="news"><NewsShell /></TabsContent>
              </div>
            </Tabs>
          </>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">No player selected.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function ProfileHeader({ adp }: { adp: ADPResult }) {
  const tint = POS_TINT[adp.position] ?? POS_TINT.WR;
  const looksLikeSleeperId = /^\d+$/.test(adp.player_id);
  const rising = adp.trend_30d < -2;
  const falling = adp.trend_30d > 2;
  return (
    <div className="px-4 pt-5 pb-3 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent">
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-16 h-16 rounded-lg overflow-hidden flex items-center justify-center ring-2 flex-shrink-0",
          tint.bg, tint.ring,
        )}>
          {looksLikeSleeperId ? (
            <img
              src={`https://sleepercdn.com/content/nfl/players/thumb/${adp.player_id}.jpg`}
              alt={adp.player_name}
              className="w-full h-full object-cover object-top"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <span className={cn("font-bold text-base", tint.text)}>
              {adp.player_name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-base font-bold truncate" data-testid="profile-name">{adp.player_name}</h2>
            {rising && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
            {falling && <TrendingDown className="w-3.5 h-3.5 text-rose-400" />}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[9px]", tint.text)}>
              {adp.position}{adp.positional_rank}
            </Badge>
            <span>{adp.team || (adp.is_rookie_placeholder ? "Rookie Pick" : "FA")}</span>
            <span>·</span>
            <span>Overall #{adp.overall_rank}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ADP</div>
          <div className="text-xl font-black tabular-nums text-[#d4af37]">{adp.avg_pick.toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ adp }: { adp: ADPResult }) {
  const range = adp.max_pick - adp.min_pick;
  return (
    <div className="space-y-4 text-[12px]">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Min Pick" value={adp.min_pick} />
        <Stat label="Median" value={adp.median_pick} />
        <Stat label="Max Pick" value={adp.max_pick} />
        <Stat label="Drafts" value={adp.draft_count} />
        <Stat label="7D Trend" value={trendLabel(adp.trend_7d)} accent={adp.trend_7d < 0 ? "emerald" : adp.trend_7d > 0 ? "rose" : undefined} />
        <Stat label="30D Trend" value={trendLabel(adp.trend_30d)} accent={adp.trend_30d < 0 ? "emerald" : adp.trend_30d > 0 ? "rose" : undefined} />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">ADP Range</div>
        <div className="relative h-3 rounded-full bg-white/5 overflow-hidden border border-white/5">
          <div className="absolute inset-y-0 bg-blue-500/40" style={{ left: 0, right: 0 }} />
          {range > 0 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2 h-4 rounded-sm bg-[#d4af37] shadow-[0_0_6px_rgba(212,175,55,0.9)]"
              style={{ left: `calc(${((adp.median_pick - adp.min_pick) / range) * 100}% - 4px)` }}
            />
          )}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
          <span>{adp.min_pick}</span>
          <span className="text-[#d4af37] font-semibold">ADP {adp.avg_pick.toFixed(1)}</span>
          <span>{adp.max_pick}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {adp.sample_size_warning && (
          <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/40">
            Small sample
          </Badge>
        )}
        {adp.trend_30d < -3 && (
          <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/40">
            Rising
          </Badge>
        )}
        {adp.trend_30d > 3 && (
          <Badge variant="outline" className="text-[9px] text-rose-400 border-rose-500/40">
            Falling
          </Badge>
        )}
        {adp.overall_rank <= 12 && (
          <Badge variant="outline" className="text-[9px] text-[#d4af37] border-[#d4af37]/40">
            Elite (Top 12)
          </Badge>
        )}
      </div>
    </div>
  );
}

function trendLabel(n: number): string {
  if (n === 0) return "—";
  const sign = n > 0 ? "↓" : "↑";
  return `${sign} ${Math.abs(n).toFixed(1)}`;
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: "emerald" | "rose" }) {
  const accentClass = accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-foreground";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("font-bold tabular-nums text-sm", accentClass)}>{value}</div>
    </div>
  );
}

// ── Production (mock structure) ─────────────────────────────────────────────

function ProductionTab({ adp }: { adp: ADPResult }) {
  // Mock structure — real per-season fantasy production lands once the
  // backend production endpoint is wired. Columns reflect the spec.
  const rows = [
    { season: "2024", team: adp.team || "—", games: "—", points: "—", ppg: "—", finish: "—" },
    { season: "2023", team: "—", games: "—", points: "—", ppg: "—", finish: "—" },
    { season: "2022", team: "—", games: "—", points: "—", ppg: "—", finish: "—" },
  ];
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        Fantasy production history. Per-season stats will populate when the production feed is connected.
      </div>
      <div className="rounded-md border border-white/10 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-white/[0.04] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Season</th>
              <th className="px-2 py-1.5 text-left">Team</th>
              <th className="px-2 py-1.5 text-right">G</th>
              <th className="px-2 py-1.5 text-right">Pts</th>
              <th className="px-2 py-1.5 text-right">PPG</th>
              <th className="px-2 py-1.5 text-right">Finish</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.season} className="border-t border-white/5">
                <td className="px-2 py-1.5">{r.season}</td>
                <td className="px-2 py-1.5">{r.team}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.games}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.points}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.ppg}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.finish}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Advanced shell ──────────────────────────────────────────────────────────

function AdvancedShell() {
  return (
    <div className="text-[12px] text-muted-foreground space-y-2">
      <p>Advanced stats — coming soon.</p>
      <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
        <li>Targets, target share, air yards</li>
        <li>Yards per route run, route participation</li>
        <li>Red zone usage, snap share</li>
        <li>Carries, efficiency metrics</li>
      </ul>
    </div>
  );
}

// ── ADP History ─────────────────────────────────────────────────────────────

function AdpHistoryTab({ playerId, active }: { playerId: string; active: boolean }) {
  const [data, setData] = useState<AdpHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/adp/player/${encodeURIComponent(playerId)}/history`, { credentials: "include" })
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.includes("application/json")) {
          throw new Error(`History request failed (${r.status})`);
        }
        return r.json() as Promise<AdpHistoryResponse>;
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load ADP history"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [playerId, active]);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Loading ADP history…</div>;
  if (error)   return <div className="flex items-center gap-2 text-rose-400 text-sm"><AlertCircle className="w-4 h-4"/>{error}</div>;
  if (!data)   return <div className="text-sm text-muted-foreground">No history yet.</div>;

  const hasDaily = data.daily.length >= 2;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {data.buckets.map((b) => (
          <div key={b.window} className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{b.window.toUpperCase()} ADP</div>
            <div className="text-base font-bold tabular-nums text-[#d4af37]">
              {b.avgPick != null ? b.avgPick.toFixed(1) : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {b.draftCount} drafts · {b.minPick ?? "—"}–{b.maxPick ?? "—"}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">ADP over time (lower = higher value)</div>
        {hasDaily ? <DailyAdpLine series={data.daily} /> : (
          <div className="text-[11px] text-muted-foreground italic">Not enough data points to render a trend yet.</div>
        )}
      </div>
    </div>
  );
}

function DailyAdpLine({ series }: { series: Array<{ date: string; avgPick: number; count: number }> }) {
  const W = 480, H = 140, PAD = 18;
  const xs = series.map((_, i) => i);
  const ys = series.map((s) => s.avgPick);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const ySpan = Math.max(1, maxY - minY);
  const xSpan = Math.max(1, xs[xs.length - 1] - xs[0]);
  const points = series.map((s, i) => {
    const x = PAD + ((i - xs[0]) / xSpan) * (W - PAD * 2);
    // Inverted Y axis — lower ADP number = higher value, paint it higher.
    const y = PAD + ((s.avgPick - minY) / ySpan) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="relative overflow-x-auto border border-white/10 rounded-md bg-white/[0.02] p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="#d4af37" strokeWidth={1.5} strokeLinejoin="round" />
        {series.map((s, i) => {
          const x = PAD + ((i - xs[0]) / xSpan) * (W - PAD * 2);
          const y = PAD + ((s.avgPick - minY) / ySpan) * (H - PAD * 2);
          return <circle key={s.date} cx={x} cy={y} r={1.6} fill="#d4af37" />;
        })}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      </svg>
      <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums mt-1">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ── Availability ────────────────────────────────────────────────────────────

function AvailabilityTab({
  playerId, teams, rounds, expectedAdp, active,
}: {
  playerId: string;
  teams: number;
  rounds: number;
  expectedAdp: number;
  active: boolean;
}) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `${API_BASE}/api/adp/player/${encodeURIComponent(playerId)}/availability?teams=${teams}&rounds=${rounds}`,
      { credentials: "include" },
    )
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.includes("application/json")) {
          throw new Error(`Availability request failed (${r.status})`);
        }
        return r.json() as Promise<AvailabilityResponse>;
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load availability"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [playerId, teams, rounds, active]);

  const expectedSlot = useMemo(() => {
    const pickNo = Math.round(expectedAdp);
    const round = Math.ceil(pickNo / teams);
    const pickInRound = ((pickNo - 1) % teams) + 1;
    return { pickNo, round, pickInRound, label: `${round}.${String(pickInRound).padStart(2, "0")}` };
  }, [expectedAdp, teams]);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Loading availability…</div>;
  if (error)   return <div className="flex items-center gap-2 text-rose-400 text-sm"><AlertCircle className="w-4 h-4"/>{error}</div>;
  if (!data || data.totalDrafts === 0) {
    return <div className="text-sm text-muted-foreground">No startup draft data yet for this team size.</div>;
  }

  const expectedCell = data.cells.find((c) => c.pickNo === expectedSlot.pickNo);
  const cellsByRound = new Map<number, AvailabilityCell[]>();
  for (const c of data.cells) {
    if (!cellsByRound.has(c.round)) cellsByRound.set(c.round, []);
    cellsByRound.get(c.round)!.push(c);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Expected pick</div>
          <div className="text-base font-bold tabular-nums text-[#d4af37]">{expectedSlot.label}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">Overall #{expectedSlot.pickNo}</div>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Available @ Expected</div>
          <div className="text-base font-bold tabular-nums text-blue-300">
            {expectedCell ? `${expectedCell.availabilityPct.toFixed(0)}%` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {data.draftsWithPlayer}/{data.totalDrafts} drafts had player
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-white/10 bg-white/[0.02] p-2">
        <table className="text-[10px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-1 py-1 text-left font-semibold">Rd</th>
              {Array.from({ length: teams }, (_, i) => (
                <th key={i} className="px-1 py-1 text-center font-semibold w-7">{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rounds }, (_, rIdx) => {
              const round = rIdx + 1;
              const row = cellsByRound.get(round) ?? [];
              return (
                <tr key={round}>
                  <td className="px-1 py-0.5 font-semibold text-muted-foreground">Rd {round}</td>
                  {Array.from({ length: teams }, (_, i) => {
                    const cell = row.find((c) => c.pickInRound === i + 1);
                    if (!cell) return <td key={i} className="px-0.5 py-0.5" />;
                    return (
                      <td key={i} className="px-0.5 py-0.5">
                        <div
                          className={cn(
                            "rounded-sm h-6 flex items-center justify-center text-[9px] font-bold tabular-nums border",
                            availabilityClass(cell.availabilityPct),
                            cell.pickNo === expectedSlot.pickNo && "ring-2 ring-[#d4af37]",
                          )}
                          title={`${cell.round}.${String(cell.pickInRound).padStart(2, "0")} · ${cell.availabilityPct.toFixed(1)}%`}
                        >
                          {Math.round(cell.availabilityPct)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground">
        <span>Color scale:</span>
        <LegendDot className="bg-rose-500/40 border-rose-500/60" label="<10%" />
        <LegendDot className="bg-orange-500/40 border-orange-500/60" label="10–30%" />
        <LegendDot className="bg-[#d4af37]/40 border-[#d4af37]/60" label="30–70%" />
        <LegendDot className="bg-teal-500/40 border-teal-500/60" label="70–90%" />
        <LegendDot className="bg-emerald-500/50 border-emerald-500/70" label=">90%" />
      </div>
    </div>
  );
}

function availabilityClass(pct: number): string {
  if (pct < 10) return "bg-rose-500/40 border-rose-500/60 text-rose-100";
  if (pct < 30) return "bg-orange-500/35 border-orange-500/55 text-orange-100";
  if (pct < 70) return "bg-[#d4af37]/30 border-[#d4af37]/55 text-[#fde68a]";
  if (pct < 90) return "bg-teal-500/35 border-teal-500/55 text-teal-100";
  return "bg-emerald-500/40 border-emerald-500/60 text-emerald-100";
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block w-3 h-3 rounded-sm border", className)} />
      <span>{label}</span>
    </span>
  );
}

// ── News shell ──────────────────────────────────────────────────────────────

function NewsShell() {
  return (
    <div className="text-[12px] text-muted-foreground">
      News integration coming soon.
    </div>
  );
}
