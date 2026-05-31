import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValueFinderPlayer } from "@/lib/value-finder/types";
import { POSITION_COLORS } from "@/lib/value-finder/types";

export interface VFColumn {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Show on mobile card layout. */
  mobile?: boolean;
  /** Render the cell. */
  cell: (p: ValueFinderPlayer) => ReactNode;
  /** Optional numeric accessor enabling click-to-sort on this column. */
  sortValue?: (p: ValueFinderPlayer) => number;
}

export function PlayerNameCell({ p }: { p: ValueFinderPlayer }) {
  return (
    <div className="flex items-center gap-1.5 text-left">
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: POSITION_COLORS[p.position] }}
      />
      <span className="font-semibold text-foreground truncate max-w-[140px]">
        {p.playerName}
      </span>
    </div>
  );
}

export function ValueFinderTable({
  title,
  rows,
  columns,
  emptyText = "No players match these filters.",
  defaultSortKey,
  defaultSortDir = "desc",
  onRowClick,
  testId,
}: {
  title: string;
  rows: ValueFinderPlayer[];
  columns: VFColumn[];
  emptyText?: string;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  onRowClick?: (p: ValueFinderPlayer) => void;
  testId?: string;
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (col.sortValue!(a) - col.sortValue!(b)) * dir);
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (col: VFColumn) => {
    if (!col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  };

  const mobileCols = columns.filter((c) => c.mobile);

  return (
    <div
      className="rounded-xl border border-border bg-card/40 overflow-hidden"
      data-testid={testId}
    >
      <div className="px-3 py-2 border-b border-border/60">
        <h3 className="text-[12px] font-bold text-foreground">{title}</h3>
      </div>

      {sorted.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c)}
                      className={cn(
                        "px-3 py-1.5 font-semibold text-[10px] uppercase tracking-wider whitespace-nowrap",
                        c.align === "right" ? "text-right" : "text-left",
                        c.sortValue && "cursor-pointer hover:text-foreground select-none",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          c.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {c.header}
                        {c.sortValue && sortKey === c.key &&
                          (sortDir === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          ))}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr
                    key={p.playerId}
                    onClick={() => onRowClick?.(p)}
                    className={cn(
                      "border-b border-border/30 last:border-0",
                      onRowClick && "cursor-pointer hover:bg-muted/20",
                    )}
                    data-testid={`vf-row-${p.playerId}`}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-3 py-1.5 tabular-nums",
                          c.align === "right" ? "text-right" : "text-left",
                        )}
                      >
                        {c.cell(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card rows */}
          <div className="sm:hidden divide-y divide-border/30">
            {sorted.map((p) => (
              <button
                key={p.playerId}
                type="button"
                onClick={() => onRowClick?.(p)}
                className="w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-muted/20"
                data-testid={`vf-card-${p.playerId}`}
              >
                <div className="min-w-0">
                  <PlayerNameCell p={p} />
                  <div className="text-[10px] text-muted-foreground mt-0.5 pl-3">
                    {[p.position, p.team, p.age != null ? `${p.age}y` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 tabular-nums">
                  {mobileCols
                    .filter((c) => c.key !== "player")
                    .map((c) => (
                      <span key={c.key} className="text-right">
                        {c.cell(p)}
                      </span>
                    ))}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default ValueFinderTable;
