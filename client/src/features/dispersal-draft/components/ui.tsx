/**
 * Brand-aligned UI primitives for the Dispersal Draft feature.
 *
 * These mirror the "Commissioner Command" design language used by the other
 * tabs (gold #d4af37 accent, navy text, premium white cards in light mode and
 * a navy glass surface in dark/X mode). Use these instead of raw
 * `bg-card border rounded-sm` blocks so the feature matches the rest of the app.
 */
import { cn } from "@/lib/utils";
import type { ReactNode, HTMLAttributes } from "react";

/** StatChasers brand gold — accent rules, ticks, active highlights. */
export const DD_GOLD = "#d4af37";

/**
 * Premium content surface: white + soft slate border + soft shadow in light
 * mode, navy glass gradient in dark/X mode. Mirrors the table/card wrappers in
 * CommissionerActivity / All-League Scan.
 */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-[var(--sc-card-bg)] border-[var(--sc-border)] shadow-[var(--sc-shadow-card)]",
        "dark-any:border-white/6 dark-any:shadow-none dark-any:bg-[linear-gradient(180deg,rgba(4,13,26,0.9)_0%,rgba(4,10,20,0.95)_100%)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Title bar for the top of a Panel — gold tick + bold title + optional right slot. */
export function PanelHeader({
  title,
  right,
  className,
}: {
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 md:px-5 py-3.5 border-b border-[var(--sc-border)] dark-any:border-white/6",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-[3px] h-4 rounded-full bg-[#d4af37] shrink-0" />
        <h3 className="text-sm font-bold text-[var(--sc-text)] dark-any:text-white/90 truncate">{title}</h3>
      </div>
      {right}
    </div>
  );
}

/** Inline section title (gold tick + bold), no border. Use inside a Panel body. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 mb-3", className)}>
      <div className="w-[3px] h-4 rounded-full bg-[#d4af37] shrink-0" />
      <h3 className="text-sm font-bold text-foreground">{children}</h3>
    </div>
  );
}

/** Small uppercase eyebrow label (the brand's micro-label treatment). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", className)}>
      {children}
    </p>
  );
}

/** Pill chip used for statuses / roles / labels. Pass tone classes via className. */
export function Chip({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Fantasy position accent colors — readable on white (light) and navy (dark).
 * Shared so the player search, asset pool, and draft board all match.
 */
export const POS_COLOR: Record<string, string> = {
  QB: "text-red-600 dark-any:text-red-400",
  RB: "text-emerald-600 dark-any:text-emerald-400",
  WR: "text-blue-600 dark-any:text-blue-400",
  TE: "text-amber-600 dark-any:text-amber-400",
  K: "text-purple-600 dark-any:text-purple-400",
  DEF: "text-slate-600 dark-any:text-slate-300",
};

export function positionColor(pos?: string | null): string {
  return POS_COLOR[(pos ?? "").toUpperCase()] ?? "text-muted-foreground";
}

/** Named chip tones aligned to the brand accent palette. */
export const CHIP_TONE = {
  gold: "bg-[#d4af37]/10 text-[var(--sc-gold-deep)] border-[#d4af37]/30 dark-any:text-[#d4af37]",
  slate: "bg-slate-500/10 text-slate-600 border-slate-300/50 dark-any:text-slate-300 dark-any:border-white/10",
  emerald: "bg-emerald-500/10 text-emerald-600 border-emerald-300/50 dark-any:text-emerald-400 dark-any:border-emerald-400/20",
  red: "bg-red-500/10 text-red-600 border-red-300/50 dark-any:text-red-400 dark-any:border-red-400/20",
  blue: "bg-blue-500/10 text-blue-600 border-blue-300/50 dark-any:text-blue-400 dark-any:border-blue-400/20",
  amber: "bg-amber-500/10 text-amber-600 border-amber-300/50 dark-any:text-amber-400 dark-any:border-amber-400/20",
} as const;
