import { useState, type ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import type {
  ValueFinderFilters as Filters,
  Position,
  AgeRange,
} from "@/lib/value-finder/types";
import { POSITIONS, SEASONS, MIN_GAMES } from "@/lib/value-finder/types";

const fmtNum = (n: number) => Math.round(n).toLocaleString();

const chip = (active: boolean) =>
  cn(
    "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap",
    active
      ? "bg-[#d4af37]/15 border-[#d4af37]/40 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]"
      : "border-border text-muted-foreground hover:text-foreground",
  );

// Only the two supported market formats are selectable here; the data pipeline
// understands the wider FormatFilter union, but Superflex / 1QB are what the
// market + production feeds are keyed on.
const FORMAT_OPTIONS: Array<Filters["format"]> = ["Superflex", "1QB"];

const AGE_LABELS: Record<AgeRange, string> = {
  All: "All ages",
  "Under 23": "Under 23",
  "23-25": "23–25",
  "26-28": "26–28",
  "29+": "29+",
};
const AGE_OPTIONS: AgeRange[] = ["All", "Under 23", "23-25", "26-28", "29+"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-16">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The single Value Finder filter bar, shared across every sub-tab (production /
 * usage / trend + the market-driven Value vs Production / Age Curve views). The
 * Source control is wired up to the global value-model source (so the market
 * pipeline switches too) via `onSelectSource`.
 */
export function ValueFinderFilters({
  filters,
  setFilters,
  maxMarket,
  sources,
  sourceId,
  onSelectSource,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  maxMarket: number;
  sources: Array<{ id: string; label: string; active: boolean }>;
  sourceId: string;
  onSelectSource: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  return (
    <div className="rounded-xl border border-border bg-card/40 p-3 space-y-2.5" data-testid="vf-filters">
      {/* Search + mobile drawer toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <Input
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search player…"
            className="pl-8 h-8 text-[12px]"
            data-testid="vf-search"
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="sm:hidden inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground"
          data-testid="vf-filters-toggle"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
        </button>
      </div>

      {/* Collapsible on mobile; always shown on sm+ */}
      <div className={cn("flex-col gap-2.5", open ? "flex" : "hidden", "sm:flex")}>
        <Row label="Position">
          <button className={chip(filters.position === "All")} onClick={() => set({ position: "All" })}>
            All
          </button>
          {POSITIONS.map((pos: Position) => (
            <button key={pos} className={chip(filters.position === pos)} onClick={() => set({ position: pos })}>
              {pos}
            </button>
          ))}
        </Row>

        <Row label="Format">
          {FORMAT_OPTIONS.map((f) => (
            <button key={f} className={chip(filters.format === f)} onClick={() => set({ format: f })}>
              {f}
            </button>
          ))}
        </Row>

        <Row label="Season">
          {SEASONS.map((s) => (
            <button
              key={s}
              className={chip(filters.season === s)}
              onClick={() => set({ season: s })}
              data-testid={`vf-season-${s}`}
            >
              {s}
            </button>
          ))}
        </Row>

        <Row label="Age">
          {AGE_OPTIONS.map((a) => (
            <button key={a} className={chip(filters.ageRange === a)} onClick={() => set({ ageRange: a })}>
              {AGE_LABELS[a]}
            </button>
          ))}
        </Row>

        <Row label="Source">
          {sources
            .filter((s) => s.active)
            .map((s) => (
              <button key={s.id} className={chip(sourceId === s.id)} onClick={() => onSelectSource(s.id)}>
                {s.label}
              </button>
            ))}
        </Row>

        {/* Min market value */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-16">Min value</span>
          <Slider
            value={[filters.minMarketValue ?? 0]}
            onValueChange={([v]) => set({ minMarketValue: v })}
            min={0}
            max={Math.max(1000, Math.round(maxMarket))}
            step={100}
            className="flex-1 max-w-[280px]"
          />
          <span className="text-[11px] tabular-nums text-foreground w-14 text-right">
            {fmtNum(filters.minMarketValue ?? 0)}
          </span>
        </div>

        <Row label="Min GP">
          {MIN_GAMES.map((g) => (
            <button
              key={g}
              className={chip(filters.minGamesPlayed === g)}
              onClick={() => set({ minGamesPlayed: g })}
              data-testid={`vf-min-gp-${g}`}
            >
              {g === 0 ? "Any" : `${g}+`}
            </button>
          ))}
        </Row>
      </div>
    </div>
  );
}

export default ValueFinderFilters;
