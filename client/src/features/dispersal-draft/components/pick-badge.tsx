import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ParsedPick {
  year: number;
  round: number;
  via: string | null;
  label: string;
}

export function parsePick(name: string): ParsedPick | null {
  const m = name.match(/^(\d{4})\s+Round\s+(\d+)(?:\s+\(via\s+(.+?)\))?/i);
  if (!m) return null;
  const year = parseInt(m[1]);
  const round = parseInt(m[2]);
  const via = m[3] ?? null;
  const label = `'${String(year).slice(2)} R${round}`;
  return { year, round, via, label };
}

const ROUND_STYLES: Record<number, string> = {
  1: "bg-yellow-500 text-yellow-950 border-yellow-400 shadow-yellow-500/30",
  2: "bg-slate-400 text-slate-900 border-slate-300 shadow-slate-400/30",
  3: "bg-amber-700 text-amber-50 border-amber-600 shadow-amber-700/30",
};
const FALLBACK_STYLE = "bg-slate-600 text-slate-200 border-slate-500 shadow-slate-600/20";

interface PickBadgeProps {
  name: string;
  team?: string | null;
  className?: string;
  onClick?: () => void;
  onDelete?: () => void;
  onReassign?: (newOwner: string) => void;
  rosterNames?: string[];
  actionLabel?: string;
}

export function PickBadge({ name, team, className, onClick, onDelete, onReassign, rosterNames, actionLabel }: PickBadgeProps) {
  const [showMenu, setShowMenu] = useState(false);
  const pick = parsePick(name);

  if (!pick) {
    return (
      <span className={cn("inline-flex items-center px-2 py-1 rounded text-xs font-bold border bg-muted text-muted-foreground border-border", className)}>
        {name}
      </span>
    );
  }

  const colorCls = ROUND_STYLES[pick.round] ?? FALLBACK_STYLE;

  return (
    <span
      title={pick.via ? `Traded pick (originally from ${pick.via})` : name}
      className={cn(
        "group/pick relative inline-flex flex-col items-center gap-0 px-2.5 py-1 rounded text-xs font-black border shadow-sm select-none leading-none",
        colorCls,
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-1">
        {pick.via && (
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 flex-shrink-0" />
        )}
        {pick.label}
      </span>
      {(onReassign || onDelete) && (
        <span className="flex items-center justify-center gap-2 mt-1">
          {onReassign && rosterNames && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowMenu(true); }}
              className="opacity-60 md:opacity-0 md:group-hover/pick:opacity-100 transition-opacity flex items-center justify-center min-w-[22px] min-h-[22px] text-[11px] font-bold rounded hover:opacity-100 hover:bg-black/10 touch-manipulation"
              aria-label="Move pick"
              title="Move to another roster"
            >
              ↔
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="opacity-60 md:opacity-0 md:group-hover/pick:opacity-100 transition-opacity flex items-center justify-center min-w-[22px] min-h-[22px] text-[13px] font-bold rounded hover:opacity-100 hover:bg-black/10 touch-manipulation"
              aria-label="Remove pick"
            >
              ×
            </button>
          )}
        </span>
      )}
      {team && (
        <span className="text-[8px] font-bold opacity-60 tracking-wide mt-0.5 max-w-[6rem] truncate">{team}</span>
      )}

      {showMenu && rosterNames && onReassign && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}
          />
          <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border/60 rounded shadow-lg min-w-36 py-1 text-xs font-normal text-foreground">
            <div className="px-2 pb-1 pt-0.5 text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border/40 mb-1">Move to roster</div>
            {rosterNames.map(n => (
              <button
                key={n}
                type="button"
                className="w-full text-left px-2 py-1 hover:bg-primary/10 hover:text-primary transition-colors truncate"
                onClick={(e) => { e.stopPropagation(); onReassign(n); setShowMenu(false); }}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

interface PickBadgeGroupProps {
  assets: Array<{ id: number; name: string; type: string; team?: string | null }>;
  onDelete?: (id: number) => void;
  onPick?: (id: number) => void;
  onReassign?: (id: number, newOwner: string) => void;
  rosterNames?: string[];
  actionLabel?: string;
  className?: string;
}

export function PickBadgeGroup({ assets, onDelete, onPick, onReassign, rosterNames, actionLabel, className }: PickBadgeGroupProps) {
  const picks = assets.filter(a => a.type === "Rookie Pick" || a.type === "Future Pick");
  if (!picks.length) return null;

  const sorted = [...picks].sort((a, b) => {
    const pa = parsePick(a.name);
    const pb = parsePick(b.name);
    if (!pa || !pb) return 0;
    if (pa.round !== pb.round) return pa.round - pb.round;
    return pa.year - pb.year;
  });

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {sorted.map(a => (
        <PickBadge
          key={a.id}
          name={a.name}
          team={a.team}
          onClick={onPick ? () => onPick(a.id) : undefined}
          onDelete={onDelete ? () => onDelete(a.id) : undefined}
          onReassign={onReassign ? (owner) => onReassign(a.id, owner) : undefined}
          rosterNames={rosterNames}
          actionLabel={actionLabel}
        />
      ))}
    </div>
  );
}
