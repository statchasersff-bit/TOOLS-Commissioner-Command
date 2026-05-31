import { useState, type ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type {
  ValueFinderFilters as Filters,
  Position,
  ValueSourceVF,
} from "@/lib/value-finder/types";
import {
  POSITIONS,
  VALUE_SOURCES,
  AGE_RANGES,
  SEASONS,
  FORMATS,
  MIN_GAMES,
  TREND_WINDOWS,
} from "@/lib/value-finder/types";

const chip = (active: boolean) =>
  cn(
    "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap",
    active
      ? "bg-[#d4af37]/15 border-[#d4af37]/40 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]"
      : "border-border text-muted-foreground hover:text-foreground",
  );

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

export function ValueFinderFilters({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
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

      {/* Always visible (mobile + desktop): Position, Value Source */}
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

      <Row label="Source">
        {VALUE_SOURCES.map((src: ValueSourceVF) => (
          <button key={src} className={chip(filters.valueSource === src)} onClick={() => set({ valueSource: src })}>
            {src}
          </button>
        ))}
      </Row>

      {/* Collapsible on mobile; always shown on sm+ */}
      <div className={cn("flex-col gap-2.5", open ? "flex" : "hidden", "sm:flex")}>
        <Row label="Format">
          {FORMATS.map((f) => (
            <button key={f} className={chip(filters.format === f)} onClick={() => set({ format: f })}>
              {f}
            </button>
          ))}
        </Row>
        <Row label="Season">
          {SEASONS.map((s) => (
            <button key={s} className={chip(filters.season === s)} onClick={() => set({ season: s })}>
              {s}
            </button>
          ))}
        </Row>
        <Row label="Age">
          {AGE_RANGES.map((a) => (
            <button key={a} className={chip(filters.ageRange === a)} onClick={() => set({ ageRange: a })}>
              {a}
            </button>
          ))}
        </Row>
        <Row label="Min GP">
          {MIN_GAMES.map((g) => (
            <button key={g} className={chip(filters.minGamesPlayed === g)} onClick={() => set({ minGamesPlayed: g })}>
              {g === 0 ? "Any" : `${g}+`}
            </button>
          ))}
        </Row>
        <Row label="Trend">
          {TREND_WINDOWS.map((t) => (
            <button
              key={t.value}
              className={chip(filters.trendWindow === t.value)}
              onClick={() => set({ trendWindow: t.value })}
            >
              {t.value}
            </button>
          ))}
        </Row>
      </div>
    </div>
  );
}

export default ValueFinderFilters;
