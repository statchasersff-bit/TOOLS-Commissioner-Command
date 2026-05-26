import { useState, useMemo, useEffect, useRef, useCallback, useLayoutEffect, type MouseEvent as ReactMouseEvent } from "react";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/apiBase";
import { usePlayerProfile } from "@/contexts/PlayerProfileContext";
import { ResponsivePlayerName } from "@/components/ResponsivePlayerName";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import type { ADPResult } from "@/types/draft";
import {
  buildAvailability, getAvailabilityBucket, BUCKET_CLASS,
  type DraftAvailabilityPlayer, type AvailabilityResult,
} from "@/lib/draftAvailability";
import { ChevronDown, TrendingUp, TrendingDown, LayoutGrid, Table2, Loader2, AlertTriangle, Trophy, Sparkles } from "lucide-react";

type Format = "SF" | "1QB";
export type AdpMode = "startup" | "rookie";
const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;
const TEAM_OPTS = [10, 12, 14] as const;
const BAND_OPTS = [1, 2, 3, 4] as const;
const BAND_LABEL: Record<number, string> = { 1: "Top 50", 2: "51–100", 3: "101–150", 4: "151–200" };

const PLAYER_COL_W = 190;
const PICK_COL_W = 40;
const ROW_H = 42;     // fallback row height; the real height is measured at runtime
const OVERSCAN = 6;   // rows rendered above/below the viewport

const POS_BADGE: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-500 dark-any:text-rose-300",
  RB: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-300",
  WR: "bg-sky-500/15 text-sky-500 dark-any:text-sky-300",
  TE: "bg-yellow-500/15 text-yellow-600 dark-any:text-yellow-300",
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// Mirror the ADP Explorer's dynasty slice so this view shows the same data,
// varying Format (SF/1QB), team count, and draft type (startup vs rookie).
// Rookie ADP accrues over the offseason, so it uses a wider date window.
function adpParams(format: Format, teams: number, mode: AdpMode): URLSearchParams {
  const p = new URLSearchParams();
  p.set("season", String(new Date().getFullYear()));
  p.set("startDate", isoDaysAgo(mode === "rookie" ? 180 : 30));
  p.set("endDate", isoDaysAgo(0));
  p.set("draftType", mode === "rookie" ? "rookie" : "startup");
  p.set("draftFormat", "snake");
  p.set("rookieMode", "direct");
  p.set("leagueMode", "dynasty");
  p.set("scoring", "ppr");
  p.set("superflex", format === "SF" ? "yes" : "no");
  p.set("bestBall", "no");
  p.set("teams", String(teams));
  return p;
}

function buildAdpUrl(format: Format, teams: number, mode: AdpMode): string {
  return `${API_BASE}/api/adp?${adpParams(format, teams, mode).toString()}`;
}

// Real per-pick availability for the displayed players, scoped to the SAME
// draft pool as the ADP fetch above.
function buildMatrixUrl(format: Format, teams: number, mode: AdpMode, playerIds: string[], rounds: number): string {
  const p = adpParams(format, teams, mode);
  p.set("rounds", String(rounds));
  p.set("playerIds", playerIds.join(","));
  return `${API_BASE}/api/adp/availability-matrix?${p.toString()}`;
}

// ── Segmented filter control ─────────────────────────────────────────────────
function Segmented<T extends string | number>({ label, options, value, onChange, fmt }: {
  label: string; options: readonly T[]; value: T; onChange: (v: T) => void; fmt?: (v: T) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="flex items-center gap-0.5 p-0.5 rounded-full border border-border bg-muted/30">
        {options.map((o) => (
          <button
            key={String(o)}
            onClick={() => onChange(o)}
            className={cn(
              "text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors whitespace-nowrap",
              value === o ? "bg-[var(--sc-blue)] text-white dark-any:bg-[#d4af37]/20 dark-any:text-[#d4af37]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {fmt ? fmt(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Biggest ADP movers (7-day) ───────────────────────────────────────────────
function MoversPanel({ rows }: { rows: ADPResult[] }) {
  const [open, setOpen] = useState(false);
  const { risers, fallers } = useMemo(() => {
    const moved = rows.filter((r) => !r.is_rookie_placeholder && r.trend_7d !== 0);
    const risers = [...moved].filter((r) => r.trend_7d < 0).sort((a, b) => a.trend_7d - b.trend_7d).slice(0, 5);
    const fallers = [...moved].filter((r) => r.trend_7d > 0).sort((a, b) => b.trend_7d - a.trend_7d).slice(0, 5);
    return { risers, fallers };
  }, [rows]);
  if (!risers.length && !fallers.length) return null;

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold hover:bg-muted/20 transition-colors">
        <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#d4af37]" /> Biggest 7-day ADP movers</span>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-4 pb-4 pt-1 border-t border-border/40">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark-any:text-emerald-400 mb-1.5">Risers</p>
            {risers.length ? risers.map((r) => (
              <div key={r.player_id} className="flex items-center justify-between text-[12px] py-0.5">
                <span className="truncate text-foreground">{r.player_name}</span>
                <span className="font-bold tabular-nums text-emerald-600 dark-any:text-emerald-400 flex items-center gap-0.5"><TrendingUp className="w-3 h-3" />{Math.abs(r.trend_7d).toFixed(1)}</span>
              </div>
            )) : <p className="text-[11px] text-muted-foreground">No risers.</p>}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark-any:text-rose-400 mb-1.5">Fallers</p>
            {fallers.length ? fallers.map((r) => (
              <div key={r.player_id} className="flex items-center justify-between text-[12px] py-0.5">
                <span className="truncate text-foreground">{r.player_name}</span>
                <span className="font-bold tabular-nums text-rose-600 dark-any:text-rose-400 flex items-center gap-0.5"><TrendingDown className="w-3 h-3" />{Math.abs(r.trend_7d).toFixed(1)}</span>
              </div>
            )) : <p className="text-[11px] text-muted-foreground">No fallers.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

function PosBadge({ pos }: { pos: string }) {
  return <span className={cn("inline-block text-[8px] font-black uppercase px-1 py-0.5 rounded", POS_BADGE[pos] ?? "bg-muted text-muted-foreground")}>{pos}</span>;
}

function MovementTag({ change }: { change: number }) {
  if (Math.abs(change) < 0.1) return null;
  const up = change > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[9px] font-bold tabular-nums", up ? "text-emerald-600 dark-any:text-emerald-400" : "text-rose-600 dark-any:text-rose-400")}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}{Math.abs(change).toFixed(1)}
    </span>
  );
}

// ── Matrix (sticky player column + sticky pick header, virtualized rows) ─────
function AvailabilityMatrix({ result, onPlayer }: { result: AvailabilityResult; onPlayer: (id: string) => void }) {
  const { players, rounds, teams } = result;
  const picks = players[0]?.availabilityByPick ?? [];
  const totalCols = picks.length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const roundRefs = useRef<Record<number, HTMLTableCellElement | null>>({});

  const [hoveredCol, setHoveredCol] = useState<number | null>(null); // 0-based column index
  const [range, setRange] = useState({ start: 0, end: Math.min(players.length, 40) });
  const lastColRef = useRef<number | null>(null);

  const scrollToRound = useCallback((round: number) => {
    const c = scrollRef.current; const el = roundRefs.current[round];
    if (c && el) c.scrollTo({ left: Math.max(0, el.offsetLeft - PLAYER_COL_W), behavior: "smooth" });
  }, []);

  // Virtualized row window. Row height is measured from the live DOM so cell
  // borders can't cause cumulative drift; falls back to ROW_H pre-measure.
  const recompute = useCallback(() => {
    const c = scrollRef.current; if (!c) return;
    const rowH = firstRowRef.current?.offsetHeight || ROW_H;
    const headH = theadRef.current?.offsetHeight ?? 44;
    const top = Math.max(0, c.scrollTop - headH);
    const end = Math.min(players.length, Math.ceil((top + c.clientHeight) / rowH) + OVERSCAN);
    const start = Math.min(Math.max(0, Math.floor(top / rowH) - OVERSCAN), Math.max(0, end - 1));
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [players.length]);

  // Reset to the top + recompute whenever the result changes, so a stale scroll
  // position can't leave the window pointing past the data.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    recompute();
  }, [result, recompute]);
  useEffect(() => {
    const c = scrollRef.current; if (!c) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    return () => ro.disconnect();
  }, [recompute]);

  // Column crosshair — derive the hovered column index from pointer X. Updates
  // a single number (guarded), so cells never re-render on mouse move.
  const onMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const t = tableRef.current; if (!t) return;
    const x = e.clientX - t.getBoundingClientRect().left - PLAYER_COL_W;
    let col: number | null = x < 0 ? null : Math.floor(x / PICK_COL_W);
    if (col != null && (col < 0 || col >= totalCols)) col = null;
    if (col !== lastColRef.current) { lastColRef.current = col; setHoveredCol(col); }
  };
  const onLeave = () => { lastColRef.current = null; setHoveredCol(null); };

  const rowH = firstRowRef.current?.offsetHeight || ROW_H;
  const visible = players.slice(range.start, range.end);
  const topPad = range.start * rowH;
  const bottomPad = Math.max(0, (players.length - range.end) * rowH);

  return (
    <div>
      {/* Jump-to-round */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">Jump to</span>
        {rounds.map((r) => (
          <button key={r} onClick={() => scrollToRound(r)} className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-[#d4af37]/40 transition-colors">
            R{r}
          </button>
        ))}
      </div>

      <div ref={scrollRef} onScroll={recompute} className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "70vh", WebkitOverflowScrolling: "touch" }}>
        <div className="relative" style={{ width: "max-content" }} onMouseMove={onMove} onMouseLeave={onLeave}>
          {/* Column crosshair overlay — paints above body cells, behind the
              sticky header (z-20) and player column (z-10). */}
          {hoveredCol != null && (
            <div
              className="pointer-events-none absolute top-0 bg-[#d4af37]/10 ring-1 ring-inset ring-[#d4af37]/30"
              style={{ left: PLAYER_COL_W + hoveredCol * PICK_COL_W, width: PICK_COL_W, height: "100%", zIndex: 5 }}
            />
          )}
          <table ref={tableRef} className="border-separate" style={{ borderSpacing: 0 }}>
            <thead ref={theadRef}>
              <tr>
                <th
                  className="sticky left-0 top-0 z-30 bg-[var(--sc-blue)] dark-any:bg-[#0a1628] text-left text-[10px] font-bold uppercase tracking-wider text-white/80 px-3 py-2 border-b border-r border-border"
                  style={{ width: PLAYER_COL_W, minWidth: PLAYER_COL_W }}
                  rowSpan={2}
                >
                  Player
                </th>
                {rounds.map((r) => (
                  <th
                    key={r}
                    ref={(el) => { roundRefs.current[r] = el; }}
                    colSpan={teams}
                    className="sticky top-0 z-20 bg-[var(--sc-blue)] dark-any:bg-[#0a1628] text-[10px] font-bold uppercase tracking-wider text-[#d4af37] px-1 py-1.5 border-b border-l border-border text-center"
                  >
                    Round {r}
                  </th>
                ))}
              </tr>
              <tr>
                {picks.map((cell, i) => {
                  const isRoundStart = (cell.pickNumber - 1) % teams === 0;
                  const isHot = i === hoveredCol;
                  return (
                    <th
                      key={cell.pickNumber}
                      className={cn(
                        "sticky z-20 text-[9px] font-semibold tabular-nums px-0 py-1 border-b border-border text-center transition-colors",
                        isHot ? "bg-[#d4af37]/25 text-[#d4af37]" : "bg-[var(--sc-blue)] dark-any:bg-[#0a1628] text-white/55",
                        isRoundStart && "border-l border-border",
                      )}
                      style={{ top: 28, width: PICK_COL_W, minWidth: PICK_COL_W }}
                    >
                      {cell.pickLabel}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {topPad > 0 && (
                <tr aria-hidden style={{ height: topPad }}><td colSpan={totalCols + 1} className="p-0 border-0" /></tr>
              )}
              {visible.map((p, vi) => (
                <tr key={p.playerId} ref={vi === 0 ? firstRowRef : undefined} className="group">
                  <th
                    scope="row"
                    onClick={() => onPlayer(p.playerId)}
                    className="sticky left-0 z-10 bg-card group-hover:bg-muted/40 text-left px-3 py-1 border-b border-r border-border cursor-pointer transition-colors overflow-hidden"
                    style={{ width: PLAYER_COL_W, minWidth: PLAYER_COL_W, height: ROW_H }}
                  >
                    <div className="flex items-center gap-2">
                      {/* Fixed compact size so the headshot never changes the row height. */}
                      <PlayerHeadshot id={p.playerId} name={p.name} team={p.team} className="w-8 h-8" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <PosBadge pos={p.position} />
                          <ResponsivePlayerName name={p.name} className="text-[12px] font-bold text-foreground flex-1" />
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          <span className="tabular-nums">ADP {p.adp.toFixed(1)}</span>
                          <MovementTag change={p.adpChange} />
                          {p.sampleSize > 0 && <span className="tabular-nums text-muted-foreground/70 truncate">{p.sampleSize.toLocaleString()} drafts</span>}
                        </div>
                      </div>
                    </div>
                  </th>
                  {p.availabilityByPick.map((cell) => {
                    const isRoundStart = (cell.pickNumber - 1) % teams === 0;
                    return (
                      <td
                        key={cell.pickNumber}
                        className={cn(
                          "text-center text-[10px] font-bold tabular-nums border-b border-border/40 group-hover:brightness-110",
                          BUCKET_CLASS[getAvailabilityBucket(cell.probability)],
                          isRoundStart && "border-l border-border",
                        )}
                        style={{ width: PICK_COL_W, minWidth: PICK_COL_W, height: ROW_H }}
                        title={`${p.name} — ${cell.probability}% available at ${cell.pickLabel}`}
                      >
                        {cell.probability === 0 ? "" : cell.probability}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {bottomPad > 0 && (
                <tr aria-hidden style={{ height: bottomPad }}><td colSpan={totalCols + 1} className="p-0 border-0" /></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Mobile card view ─────────────────────────────────────────────────────────
function AvailabilityCards({ players, onPlayer }: { players: DraftAvailabilityPlayer[]; onPlayer: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {players.map((p) => {
        // Compact strip: picks bracketing the player's ADP within the window.
        const first = p.availabilityByPick[0]?.pickNumber ?? 1;
        const centerIdx = Math.round(p.adp) - first;
        const start = Math.max(0, Math.min(centerIdx - 4, p.availabilityByPick.length - 9));
        const strip = p.availabilityByPick.slice(start, start + 9);
        return (
          <Card key={p.playerId} className="p-3" onClick={() => onPlayer(p.playerId)}>
            <div className="flex items-center gap-2">
              <PlayerHeadshot id={p.playerId} name={p.name} team={p.team} className="w-9 h-9" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <PosBadge pos={p.position} />
                  <span className="text-[13px] font-bold text-foreground flex-1 truncate">{p.name}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">ADP {p.adp.toFixed(1)}</span>
                  <MovementTag change={p.adpChange} />
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{p.team || "FA"} · Range {p.rangeLabel}{p.sampleSize > 0 ? ` · ${p.sampleSize.toLocaleString()} drafts` : ""}</div>
              </div>
            </div>
            <div className="flex gap-1 mt-2 overflow-x-auto scrollbar-hide">
              {strip.map((cell) => (
                <div key={cell.pickNumber} className="flex flex-col items-center flex-shrink-0">
                  <div className="text-[8px] text-muted-foreground tabular-nums mb-0.5">{cell.pickLabel}</div>
                  <div className={cn("w-9 h-9 rounded-md flex items-center justify-center text-[11px] font-bold tabular-nums", BUCKET_CLASS[getAvailabilityBucket(cell.probability)])} title={`${cell.probability}% available at ${cell.pickLabel}`}>
                    {cell.probability === 0 ? "—" : cell.probability}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Legend() {
  const items: { label: string; pct: number }[] = [
    { label: "85%+", pct: 90 }, { label: "60–84%", pct: 70 }, { label: "30–59%", pct: 45 },
    { label: "10–29%", pct: 20 }, { label: "1–9%", pct: 5 }, { label: "Gone", pct: 0 },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-muted-foreground">
      <span className="font-semibold">Chance still available:</span>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1">
          <span className={cn("w-3 h-3 rounded-sm", BUCKET_CLASS[getAvailabilityBucket(it.pct)])} />{it.label}
        </span>
      ))}
    </div>
  );
}

export function DraftAvailability() {
  const { openPlayerProfile } = usePlayerProfile();
  const [mode, setMode] = useState<AdpMode>("startup");
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("ALL");
  const [format, setFormat] = useState<Format>("SF");
  const [teams, setTeams] = useState<number>(12);
  const [band, setBand] = useState<number>(1);
  const [view, setView] = useState<"matrix" | "cards">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "matrix"));

  const [rows, setRows] = useState<ADPResult[]>([]);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refetch only when server-side filters (format/teams) change.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(buildAdpUrl(format, teams, mode), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setRows(Array.isArray(data?.items) ? data.items : []);
        setDraftCount(data?.meta?.draft_count ?? null);
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e?.message || "Failed to load ADP data."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [format, teams, mode]);

  const result = useMemo(
    // Rookie drafts are small enough to show in full (no rank bands).
    () => buildAvailability(rows, { teams, position, band: mode === "rookie" ? "all" : band }),
    [rows, teams, position, band, mode],
  );

  // Real per-pick availability for the displayed players — true frequencies from
  // actual draft results, scoped to the same pool. Overlays the ADP estimate.
  const endRound = result.rounds.length ? result.rounds[result.rounds.length - 1] : 0;
  const playerIdsKey = result.players.map((p) => p.playerId).join(",");
  const [real, setReal] = useState<{ cells: Record<string, number[]>; drafts: Record<string, number>; totalDrafts: number } | null>(null);
  const [realLoading, setRealLoading] = useState(false);

  useEffect(() => {
    if (!playerIdsKey || !endRound) { setReal(null); return; }
    const controller = new AbortController();
    setRealLoading(true);
    fetch(buildMatrixUrl(format, teams, mode, playerIdsKey.split(","), endRound), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (controller.signal.aborted) return;
        const cells: Record<string, number[]> = {};
        const drafts: Record<string, number> = {};
        const pl = data?.players ?? {};
        for (const pid of Object.keys(pl)) {
          cells[pid] = pl[pid]?.cells ?? [];
          drafts[pid] = pl[pid]?.draftsWithPlayer ?? 0;
        }
        setReal({ cells, drafts, totalDrafts: data?.totalDrafts ?? 0 });
      })
      .catch(() => { if (!controller.signal.aborted) setReal(null); })
      .finally(() => { if (!controller.signal.aborted) setRealLoading(false); });
    return () => controller.abort();
  }, [playerIdsKey, endRound, format, teams, mode]);

  const usingReal = !!real && real.totalDrafts > 0;
  const displayResult = useMemo<AvailabilityResult>(() => {
    if (!usingReal || !real) return result;
    return {
      ...result,
      players: result.players.map((p) => {
        const arr = real.cells[p.playerId];
        if (!arr || !arr.length) return p;
        return {
          ...p,
          sampleSize: real.drafts[p.playerId] ?? p.sampleSize, // drafts the % is computed over
          availabilityByPick: p.availabilityByPick.map((c) => {
            const v = arr[c.pickNumber - 1];
            return v == null ? c : { ...c, probability: Math.round(v) };
          }),
        };
      }),
    };
  }, [result, real, usingReal]);

  // Startup / Rookie sub-tab toggle (matches the Advanced Stats Data/Compare style).
  const renderModeToggle = () =>
    (["startup", "rookie"] as const).map((m) => {
      const isActive = mode === m;
      const Icon = m === "startup" ? Trophy : Sparkles;
      return (
        <button
          key={m}
          onClick={() => setMode(m)}
          data-testid={`avail-mode-${m}`}
          className="relative flex items-center justify-center gap-2 font-semibold transition-all duration-200"
          style={{
            borderRadius: 12, fontSize: 13, letterSpacing: "0.01em",
            background: isActive ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)" : "transparent",
            color: isActive ? "#fff" : "rgba(203,213,225,0.45)",
            border: isActive ? "1px solid rgba(212,175,55,0.30)" : "1px solid transparent",
            boxShadow: isActive ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)" : "none",
          }}
        >
          <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
          {m === "startup" ? "Startup" : "Rookie"}
          {isActive && <span className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full" style={{ width: 28, height: 2, background: "#d4af37", opacity: 0.85 }} />}
        </button>
      );
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeader
          title="Draft Availability Matrix"
          subtitle="See the probability that each player is still available at every pick, based on ADP and draft data."
        />
        <div
          className="grid flex-shrink-0 w-full sm:w-[220px]"
          style={{ gridTemplateColumns: "1fr 1fr", height: 44, borderRadius: 14, padding: 4, gap: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          {renderModeToggle()}
        </div>
      </div>

      {/* Filters */}
      <Card className="p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          {mode !== "rookie" && (
            <Segmented label="Players" options={BAND_OPTS} value={band} onChange={setBand} fmt={(v) => BAND_LABEL[v]} />
          )}
          <Segmented label="Position" options={POSITIONS} value={position} onChange={setPosition} fmt={(v) => (v === "ALL" ? "All" : String(v))} />
          <Segmented label="Format" options={["SF", "1QB"] as const} value={format} onChange={setFormat} />
          <Segmented label="Teams" options={TEAM_OPTS} value={teams} onChange={setTeams} />
          <div className="flex flex-col gap-1 ml-auto">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">View</span>
            <div className="flex items-center gap-0.5 p-0.5 rounded-full border border-border bg-muted/30">
              <button onClick={() => setView("matrix")} className={cn("flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors", view === "matrix" ? "bg-[var(--sc-blue)] text-white dark-any:bg-[#d4af37]/20 dark-any:text-[#d4af37]" : "text-muted-foreground hover:text-foreground")}><Table2 className="w-3 h-3" />Matrix</button>
              <button onClick={() => setView("cards")} className={cn("flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors", view === "cards" ? "bg-[var(--sc-blue)] text-white dark-any:bg-[#d4af37]/20 dark-any:text-[#d4af37]" : "text-muted-foreground hover:text-foreground")}><LayoutGrid className="w-3 h-3" />Cards</button>
            </div>
          </div>
        </div>
        {draftCount != null && (
          <p className="text-[10px] text-muted-foreground mt-2">
            {usingReal
              ? <>Real availability from {(real?.totalDrafts ?? 0).toLocaleString()} {format} {mode === "rookie" ? "rookie" : "startup"} drafts.</>
              : <>Estimated from {draftCount.toLocaleString()} recent {format} {mode === "rookie" ? "rookie" : "startup"} drafts · modeled from ADP spread{realLoading ? " · loading real results…" : ""}.</>}
          </p>
        )}
      </Card>

      <MoversPanel rows={rows} />

      {loading ? (
        <Card className="p-10 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading ADP data…</Card>
      ) : error ? (
        <Card className="p-8 text-center"><AlertTriangle className="w-7 h-7 text-yellow-500 mx-auto mb-2" /><p className="text-sm font-semibold">Couldn't load ADP data</p><p className="text-xs text-muted-foreground mt-1">{error}</p></Card>
      ) : !result.players.length ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No players in this range for these filters.</Card>
      ) : (
        <>
          {view === "matrix"
            ? <AvailabilityMatrix result={displayResult} onPlayer={openPlayerProfile} />
            : <AvailabilityCards players={displayResult.players} onPlayer={openPlayerProfile} />}
          <Legend />
          <p className="text-[10px] text-muted-foreground text-center">
            {usingReal
              ? "Availability reflects how often each player was still on the board at each pick across real drafts in this slice."
              : "Showing an ADP-based estimate. Real per-draft results load when available for this slice."}
          </p>
        </>
      )}
    </div>
  );
}
