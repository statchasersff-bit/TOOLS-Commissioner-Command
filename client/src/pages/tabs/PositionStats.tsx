/**
 * PositionStats — Research tab backed by the StatChasers public-data repo.
 *
 * UI shape: pick a position + year, then pick up to three players. The
 * page loads ALL four categories (overview / usage / efficiency /
 * stat_explorer) in parallel and merges them per-player. Stats are then
 * rendered as a vertical list — each row is one stat, with the selected
 * players' values shown side-by-side. The best value in each row is
 * highlighted so quick scans surface the leader.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  Database,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trophy,
  X,
} from "lucide-react";
import {
  DATA_CATEGORIES,
  DATA_YEARS,
  POSITIONS,
  buildProxyPositionDataUrl,
  type DataCategory,
  type DataYear,
  type Position,
} from "@/lib/statChasersDataConfig";
import {
  clearStatChasersCache,
  fetchPositionData,
} from "@/lib/statChasersDataLoader";
import { extractRecords } from "@/lib/statChasersDataUtils";

type Record_ = Record<string, unknown>;

// Identity columns are unified across categories (first non-null wins).
const IDENTITY_KEYS = new Set([
  "player_id", "playerId", "sleeper_id", "sleeperId", "id",
  "player_name", "playerName", "name", "full_name", "fullName",
  "team", "nfl_team",
  "pos", "position",
  "age",
]);

// Stats we deliberately keep out of the comparison list — see history.
const HIDDEN_COLUMN_KEYS = new Set<string>([
  "playerid", "player_id", "sleeperid", "sleeper_id",
  "overview.season", "usage.season", "efficiency.season", "stat_explorer.season",
  "overview.careerarc", "overview.career_arc",
]);

function normalizeColKey(col: string): string {
  return col.toLowerCase().replace(/\s+/g, "").replace(/[-]/g, "_");
}

function isHiddenColumn(col: string): boolean {
  const norm = normalizeColKey(col);
  if (HIDDEN_COLUMN_KEYS.has(norm)) return true;
  const stripped = norm.replace(/_/g, "");
  return HIDDEN_COLUMN_KEYS.has(stripped);
}

function getPlayerKey(rec: Record_): string | null {
  for (const f of ["player_id", "playerId", "sleeper_id", "sleeperId", "id"] as const) {
    const v = rec[f];
    if (v != null) {
      const s = String(v).trim();
      if (s) return `id:${s}`;
    }
  }
  for (const f of ["player_name", "playerName", "name", "full_name", "fullName"] as const) {
    const v = rec[f];
    if (typeof v === "string" && v.trim()) return `name:${v.toLowerCase().trim()}`;
  }
  return null;
}

function getPlayerName(rec: Record_): string {
  for (const f of ["player_name", "playerName", "name", "full_name", "fullName"] as const) {
    const v = rec[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "—";
}

function getPlayerTeam(rec: Record_): string {
  for (const f of ["team", "nfl_team"] as const) {
    const v = rec[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function getPlayerPos(rec: Record_): string {
  for (const f of ["pos", "position"] as const) {
    const v = rec[f];
    if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
  }
  return "";
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (Number.isInteger(v)) return v.toLocaleString();
    return Math.abs(v) >= 1000 ? v.toLocaleString() : v.toFixed(2);
  }
  if (typeof v === "boolean") return v ? "✓" : "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Loose equality with float tolerance + string normalization.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    const diff = Math.abs(a - b);
    if (diff < 1e-9) return true;
    const mag = Math.max(Math.abs(a), Math.abs(b));
    return mag > 0 && diff / mag < 1e-6;
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function columnsLookDuplicate(records: Record_[], a: string, b: string): boolean {
  let overlap = 0;
  for (const r of records) {
    const va = r[a];
    const vb = r[b];
    if (va == null || vb == null) continue;
    overlap++;
    if (!valuesEqual(va, vb)) return false;
  }
  return overlap >= 3;
}

function findDuplicateColumns(records: Record_[], statColumns: string[]): Set<string> {
  if (records.length === 0 || statColumns.length < 2) return new Set();
  const order = statColumns.slice().sort((a, b) => {
    const dotA = a.indexOf(".");
    const dotB = b.indexOf(".");
    const ca = dotA === -1 ? "" : a.slice(0, dotA);
    const cb = dotB === -1 ? "" : b.slice(0, dotB);
    const ia = DATA_CATEGORIES.indexOf(ca as DataCategory);
    const ib = DATA_CATEGORIES.indexOf(cb as DataCategory);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
  const removed = new Set<string>();
  for (let i = 0; i < order.length; i++) {
    const a = order[i];
    if (removed.has(a)) continue;
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j];
      if (removed.has(b)) continue;
      if (columnsLookDuplicate(records, a, b)) {
        removed.add(b);
      }
    }
  }
  return removed;
}

// Discover the canonical stat-column order from the merged records. Drops
// hidden columns and same-suffix duplicates whose values agree.
function deriveStatColumns(records: Record_[]): string[] {
  if (records.length === 0) return [];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const r of records.slice(0, 10)) {
    for (const k of Object.keys(r)) {
      if (seen.has(k)) continue;
      if (IDENTITY_KEYS.has(k)) continue;
      if (isHiddenColumn(k)) continue;
      seen.add(k);
      order.push(k);
    }
  }
  // Group by canonical category order so dedup is deterministic.
  const grouped: string[] = [];
  for (const cat of DATA_CATEGORIES) {
    for (const k of order) {
      if (k.startsWith(`${cat}.`)) grouped.push(k);
    }
  }
  const known = new Set(grouped);
  const tail = order.filter((k) => !known.has(k));
  const full = [...grouped, ...tail];
  const dupes = findDuplicateColumns(records, full);
  return full.filter((k) => !dupes.has(k));
}

// Category prefix is stripped from the display label; the dedup pass
// already keeps things from colliding.
function statLabel(col: string): string {
  const dot = col.indexOf(".");
  const suffix = dot === -1 ? col : col.slice(dot + 1);
  return suffix.replace(/_/g, " ");
}

// Pretty-printed category badge shown beneath each stat label, e.g.
// `stat_explorer` → "Stat Explorer". Returns null when the column has no
// category prefix (rare — only identity-ish columns that bypassed the
// merge step).
function statSource(col: string): string | null {
  const dot = col.indexOf(".");
  if (dot === -1) return null;
  const cat = col.slice(0, dot);
  return cat
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Decide whether higher or lower is "better" for a given stat. The
// dataset's stat names are heterogeneous enough that this can't be
// perfect — a small allowlist of "lower is better" stat-name fragments
// covers the common cases (drops, turnovers, etc.). Everything else is
// treated as higher-is-better.
const LOWER_IS_BETTER_PATTERNS = [
  /drops?/i,
  /turnovers?/i,
  /fumbles?/i,
  /interception(s|_rate)?\b/i,
  /sack(s|_rate)?\b/i,
  /missed_tackles?/i,
  /penalty/i,
  /penalties/i,
  /negative/i,
];

function statHigherIsBetter(col: string): boolean | null {
  const label = statLabel(col).toLowerCase();
  if (LOWER_IS_BETTER_PATTERNS.some((re) => re.test(label))) return false;
  return true;
}

interface MergedResult {
  records: Record_[];
  errors: Partial<Record<DataCategory, string>>;
  loadedCategories: DataCategory[];
}

async function fetchMergedForPositionYear(
  position: Position,
  year: DataYear,
): Promise<MergedResult> {
  const settled = await Promise.allSettled(
    DATA_CATEGORIES.map(async (category) => {
      const json = await fetchPositionData(position, category, year);
      return { category, records: extractRecords<Record_>(json) };
    }),
  );

  const merged = new Map<string, Record_>();
  const errors: Partial<Record<DataCategory, string>> = {};
  const loaded: DataCategory[] = [];

  settled.forEach((s, i) => {
    const category = DATA_CATEGORIES[i];
    if (s.status === "rejected") {
      errors[category] = s.reason instanceof Error ? s.reason.message : String(s.reason);
      return;
    }
    loaded.push(category);
    for (const rec of s.value.records) {
      const key = getPlayerKey(rec);
      if (!key) continue;
      const target = merged.get(key) ?? {};
      for (const [k, v] of Object.entries(rec)) {
        if (IDENTITY_KEYS.has(k)) {
          if (target[k] == null && v != null) target[k] = v;
        } else {
          target[`${category}.${k}`] = v;
        }
      }
      merged.set(key, target);
    }
  });

  return { records: Array.from(merged.values()), errors, loadedCategories: loaded };
}

// ── Player slot (search-as-you-type combobox) ───────────────────────────
function PlayerSlot({
  slotIndex,
  selected,
  options,
  onSelect,
  onClear,
}: {
  slotIndex: number;
  selected: Record_ | null;
  options: { key: string; rec: Record_ }[];
  onSelect: (key: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = options;
    if (!q) return pool.slice(0, 20);
    return pool
      .filter((o) => getPlayerName(o.rec).toLowerCase().includes(q))
      .slice(0, 20);
  }, [options, query]);

  if (selected) {
    const name = getPlayerName(selected);
    const team = getPlayerTeam(selected);
    const pos = getPlayerPos(selected);
    return (
      <Card
        className="p-3 flex items-center justify-between gap-2 border-[#0b3a7a]/30 bg-[#0b3a7a]/[0.04] dark:border-blue-400/30 dark:bg-blue-400/[0.04]"
        data-testid={`player-slot-${slotIndex}-selected`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#0b3a7a]/15 dark:bg-blue-400/15 flex items-center justify-center shrink-0">
            <Trophy className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground truncate" data-testid={`player-slot-${slotIndex}-name`}>
              {name}
            </p>
            <p className="text-[10.5px] text-muted-foreground truncate">
              {[pos, team].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Clear player"
          data-testid={`player-slot-${slotIndex}-clear`}
        >
          <X className="w-4 h-4" />
        </button>
      </Card>
    );
  }

  return (
    <div ref={containerRef} className="relative" data-testid={`player-slot-${slotIndex}-empty`}>
      <Card
        className={cn(
          "p-3 border-dashed border-border/60 bg-muted/15 transition-colors",
          open && "border-[#0b3a7a]/40 dark:border-blue-400/40",
        )}
      >
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={`Player ${slotIndex + 1}…`}
            className="h-9 pl-7 text-xs"
            data-testid={`player-slot-${slotIndex}-input`}
          />
        </div>
        {options.length === 0 && (
          <p className="text-[10.5px] text-muted-foreground italic mt-1.5">
            No players available — load data first.
          </p>
        )}
      </Card>

      {open && options.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-border bg-background shadow-lg overflow-hidden max-h-72 overflow-y-auto"
          data-testid={`player-slot-${slotIndex}-options`}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground italic">No matches.</p>
          ) : (
            filtered.map((opt) => {
              const name = getPlayerName(opt.rec);
              const team = getPlayerTeam(opt.rec);
              const pos = getPlayerPos(opt.rec);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(opt.key);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left border-b border-border/30 last:border-0"
                  data-testid={`player-slot-${slotIndex}-option-${opt.key}`}
                >
                  <div className="w-7 h-7 rounded-md bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center shrink-0">
                    <Trophy className="w-3.5 h-3.5 text-[#0b3a7a] dark:text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {[pos, team].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────
export default function PositionStats() {
  const [position, setPosition] = useState<Position>("te");
  const [year, setYear] = useState<DataYear>(2024);
  const [loading, setLoading] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [records, setRecords] = useState<Record_[]>([]);
  const [categoryErrors, setCategoryErrors] = useState<Partial<Record<DataCategory, string>>>({});
  const [loadedCategories, setLoadedCategories] = useState<DataCategory[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<(string | null)[]>([null, null, null]);
  const [reloadTick, setReloadTick] = useState(0);

  // Source URLs displayed below the controls — one per category.
  const proxyUrls = useMemo(
    () => DATA_CATEGORIES.map((c) => ({
      category: c,
      url: buildProxyPositionDataUrl(position, c, year),
    })),
    [position, year],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFatalError(null);
    setRecords([]);
    setCategoryErrors({});
    setLoadedCategories([]);
    setSelectedKeys([null, null, null]);
    fetchMergedForPositionYear(position, year)
      .then((res) => {
        if (cancelled) return;
        setRecords(res.records);
        setCategoryErrors(res.errors);
        setLoadedCategories(res.loadedCategories);
        if (res.loadedCategories.length === 0) {
          const allMessages = (Object.entries(res.errors) as Array<[DataCategory, string]>)
            .map(([c, e]) => `${c}: ${e}`)
            .join(" · ");
          setFatalError(allMessages || "No categories loaded.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setFatalError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [position, year, reloadTick]);

  // Build the option list once per records refresh — keyed by player key.
  const playerOptions = useMemo(() => {
    const out: { key: string; rec: Record_ }[] = [];
    for (const rec of records) {
      const key = getPlayerKey(rec);
      if (!key) continue;
      out.push({ key, rec });
    }
    // Stable sort by name for the picker.
    out.sort((a, b) => getPlayerName(a.rec).localeCompare(getPlayerName(b.rec)));
    return out;
  }, [records]);

  const playerByKey = useMemo(() => {
    const map = new Map<string, Record_>();
    for (const o of playerOptions) map.set(o.key, o.rec);
    return map;
  }, [playerOptions]);

  const selectedPlayers = useMemo(
    () => selectedKeys.map((k) => (k ? playerByKey.get(k) ?? null : null)),
    [selectedKeys, playerByKey],
  );

  const setSlot = (idx: number, key: string | null) => {
    setSelectedKeys((prev) => {
      const next = [...prev];
      next[idx] = key;
      return next;
    });
  };

  const statColumns = useMemo(() => deriveStatColumns(records), [records]);

  // Only show rows where at least one of the selected players has a value
  // — otherwise the list balloons with all-empty rows for every selection.
  const visibleStatRows = useMemo(() => {
    if (selectedPlayers.every((p) => p == null)) return statColumns;
    return statColumns.filter((col) =>
      selectedPlayers.some((p) => p != null && p[col] != null),
    );
  }, [statColumns, selectedPlayers]);

  // For each visible stat, find which slot wins (only when ≥2 players are
  // selected and ≥2 of them have a numeric value for that stat).
  const winnerBySlot = useMemo(() => {
    const m = new Map<string, number>(); // stat col → winning slot index
    const filled = selectedPlayers.filter((p) => p != null).length;
    if (filled < 2) return m;
    for (const col of visibleStatRows) {
      const higherBetter = statHigherIsBetter(col);
      if (higherBetter == null) continue;
      let best: { idx: number; val: number } | null = null;
      let valueCount = 0;
      let allEqual = true;
      let prev: number | null = null;
      for (let i = 0; i < selectedPlayers.length; i++) {
        const p = selectedPlayers[i];
        if (p == null) continue;
        const v = p[col];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        valueCount++;
        if (prev != null && !valuesEqual(prev, v)) allEqual = false;
        prev = v;
        if (best == null) {
          best = { idx: i, val: v };
        } else if (higherBetter ? v > best.val : v < best.val) {
          best = { idx: i, val: v };
        }
      }
      if (best != null && valueCount >= 2 && !allEqual) m.set(col, best.idx);
    }
    return m;
  }, [visibleStatRows, selectedPlayers]);

  const onRefresh = () => {
    clearStatChasersCache();
    setReloadTick((t) => t + 1);
  };

  const filledSlots = selectedPlayers.filter((p) => p != null).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Position Stats"
        subtitle="Pick up to three players and compare them side-by-side across every metric."
      />

      {/* Controls */}
      <Card className="p-4 space-y-4" data-testid="position-stats-controls">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1 text-xs">
            <span className="block font-semibold text-muted-foreground uppercase tracking-wider">Position</span>
            <div className="flex gap-1">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPosition(p)}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                    position === p
                      ? "bg-[#0b3a7a] text-white border-[#0b3a7a] dark:bg-blue-500 dark:border-blue-500"
                      : "bg-transparent text-muted-foreground border-border hover:border-foreground/30",
                  )}
                  data-testid={`btn-position-${p}`}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-semibold text-muted-foreground uppercase tracking-wider">Year</span>
            <div className="flex gap-1">
              {DATA_YEARS.map((y) => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                    year === y
                      ? "bg-[#0b3a7a] text-white border-[#0b3a7a] dark:bg-blue-500 dark:border-blue-500"
                      : "bg-transparent text-muted-foreground border-border hover:border-foreground/30",
                  )}
                  data-testid={`btn-year-${y}`}
                >
                  {y}
                </button>
              ))}
            </div>
          </label>
        </div>

        {/* Player slots — up to 3 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Players ({filledSlots}/3)
            </span>
            {filledSlots > 0 && (
              <button
                type="button"
                onClick={() => setSelectedKeys([null, null, null])}
                className="text-[10.5px] text-muted-foreground hover:text-foreground transition-colors"
                data-testid="btn-clear-players"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <PlayerSlot
                key={i}
                slotIndex={i}
                selected={selectedPlayers[i]}
                options={playerOptions.filter((o) => !selectedKeys.includes(o.key) || selectedKeys[i] === o.key)}
                onSelect={(k) => setSlot(i, k)}
                onClear={() => setSlot(i, null)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={onRefresh}
            disabled={loading}
            size="sm"
            variant="outline"
            className="gap-1.5"
            data-testid="btn-refresh"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          <span className="text-[10.5px] text-muted-foreground">
            {records.length.toLocaleString()} players loaded
          </span>
        </div>

        <details className="text-[10.5px] text-muted-foreground" data-testid="source-urls">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            <span className="uppercase tracking-wider text-[9.5px] mr-1.5">Sources</span>
            {loadedCategories.length}/{DATA_CATEGORIES.length} categories loaded
          </summary>
          <ul className="mt-1.5 space-y-0.5 font-mono">
            {proxyUrls.map(({ category, url }) => (
              <li key={category} className="flex items-center gap-2 break-all">
                <span className={cn(
                  "uppercase text-[9px] font-bold w-3 shrink-0",
                  loadedCategories.includes(category)
                    ? "text-emerald-500"
                    : categoryErrors[category]
                      ? "text-red-500"
                      : "text-muted-foreground",
                )}>
                  {loadedCategories.includes(category) ? "✓" : categoryErrors[category] ? "✗" : "·"}
                </span>
                <span className="text-foreground/80">{url}</span>
              </li>
            ))}
          </ul>
        </details>
      </Card>

      {/* Partial-load warnings */}
      {!loading && !fatalError && Object.keys(categoryErrors).length > 0 && (
        <Card className="p-3 border-amber-500/40 bg-amber-500/5" data-testid="partial-warning">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                {Object.keys(categoryErrors).length} of {DATA_CATEGORIES.length} categories failed to load — comparison shows partial data.
              </p>
              <ul className="text-[10.5px] text-muted-foreground/85 mt-1 space-y-0.5">
                {(Object.entries(categoryErrors) as Array<[DataCategory, string]>).map(([c, err]) => (
                  <li key={c} className="break-all">
                    <span className="font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mr-1.5">{c}</span>
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {loading && (
        <Card className="p-8 text-center" data-testid="loading">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading all categories ({position.toUpperCase()}, {year})…</p>
        </Card>
      )}

      {!loading && fatalError && (
        <Card className="p-6 border-red-500/40 bg-red-500/5" data-testid="error">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-500 mb-0.5">Couldn't load any data for this selection.</p>
              <p className="text-xs text-muted-foreground break-all">{fatalError}</p>
            </div>
          </div>
        </Card>
      )}

      {!loading && !fatalError && records.length === 0 && (
        <Card className="p-8 text-center" data-testid="empty">
          <Database className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground mb-1">No data available.</p>
          <p className="text-xs text-muted-foreground">The files loaded but contained no records.</p>
        </Card>
      )}

      {/* Comparison list */}
      {!loading && !fatalError && records.length > 0 && (
        <Card className="overflow-hidden" data-testid="comparison-card">
          {filledSlots === 0 ? (
            <div className="p-10 text-center" data-testid="comparison-empty">
              <div className="w-12 h-12 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 mx-auto flex items-center justify-center mb-3">
                <Plus className="w-5 h-5 text-[#0b3a7a] dark:text-blue-400" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">Pick up to three players</p>
              <p className="text-xs text-muted-foreground max-w-[320px] mx-auto">
                Use the search boxes above to add players — their stats will appear here for side-by-side comparison.
              </p>
            </div>
          ) : (
            <>
              {/* Sticky player header row */}
              <div
                className="grid items-center gap-2 px-4 py-3 border-b border-border/40 bg-muted/20 sticky top-0 z-10"
                style={{ gridTemplateColumns: "minmax(0,1fr) repeat(3, minmax(0,1fr))" }}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stat</div>
                {[0, 1, 2].map((i) => {
                  const p = selectedPlayers[i];
                  if (!p) {
                    return (
                      <div key={i} className="text-[10.5px] text-muted-foreground/70 italic text-right">
                        Empty slot
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="text-right min-w-0">
                      <p className="text-[12px] font-bold text-foreground truncate" title={getPlayerName(p)}>
                        {getPlayerName(p)}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {[getPlayerPos(p), getPlayerTeam(p)].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Stat rows */}
              <div className="max-h-[640px] overflow-y-auto" data-testid="comparison-rows">
                {visibleStatRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-10">
                    No stats available for the selected players.
                  </p>
                ) : (
                  visibleStatRows.map((col, rowIdx) => {
                    const winningSlot = winnerBySlot.get(col);
                    return (
                      <div
                        key={col}
                        className={cn(
                          "grid items-center gap-2 px-4 py-2 border-b border-border/15 last:border-0",
                          rowIdx % 2 === 0 ? "bg-background" : "bg-muted/10 dark:bg-muted/5",
                        )}
                        style={{ gridTemplateColumns: "minmax(0,1fr) repeat(3, minmax(0,1fr))" }}
                        data-testid={`comparison-row-${col}`}
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] text-foreground/90 truncate leading-tight" title={col}>
                            {statLabel(col)}
                          </div>
                          {statSource(col) && (
                            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 leading-tight mt-0.5">
                              {statSource(col)}
                            </div>
                          )}
                        </div>
                        {[0, 1, 2].map((i) => {
                          const p = selectedPlayers[i];
                          const v = p ? p[col] : undefined;
                          const numeric = typeof v === "number" && Number.isFinite(v);
                          const isWinner = winningSlot === i;
                          return (
                            <div
                              key={i}
                              className={cn(
                                "text-right text-[12px] tabular-nums px-2 py-0.5 rounded",
                                p == null && "text-muted-foreground/40",
                                p != null && !numeric && "text-foreground/85",
                                p != null && numeric && (
                                  isWinner
                                    ? "text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/8"
                                    : "text-foreground font-semibold"
                                ),
                              )}
                              data-testid={`comparison-cell-${col}-${i}`}
                            >
                              {p ? formatCell(v) : "—"}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
