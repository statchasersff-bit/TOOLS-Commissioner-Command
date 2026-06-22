import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSortableTable, type SortAccessor } from "@/hooks/useSortableTable";
import { SortableTh } from "@/components/SortableTh";
import type { MarketPlayer } from "@/lib/market/marketModel";

export interface MarketColumn {
  key: string;
  header: string;
  /** Show on mobile too. Columns without this are hidden below `sm`. */
  mobile?: boolean;
  align?: "left" | "right" | "center";
  cell: (p: MarketPlayer) => ReactNode;
  /**
   * Comparable value used for client-side sorting. Provide this to make the
   * column's header clickable/sortable; columns without it stay plain (e.g.
   * avatar-only or action columns). `cell` returns a ReactNode that can't be
   * compared, so callers opt into sorting by giving a raw value here.
   */
  sortAccessor?: SortAccessor<MarketPlayer>;
}

/**
 * Compact, responsive table. Secondary columns collapse below `sm` so mobile
 * rows stay to the essentials (player / pos / age / gap / signal).
 */
export function MarketInefficiencyTable({
  title,
  rows,
  columns,
  emptyText = "No players match these filters.",
  testId,
}: {
  title: string;
  rows: MarketPlayer[];
  columns: MarketColumn[];
  emptyText?: string;
  testId?: string;
}) {
  const alignCls = (a?: MarketColumn["align"]) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  const accessors = Object.fromEntries(
    columns
      .filter((c) => c.sortAccessor)
      .map((c) => [c.key, c.sortAccessor!] as const),
  ) as Record<string, SortAccessor<MarketPlayer>>;

  const { sorted, sortKey, sortDir, toggle } = useSortableTable(rows, accessors);

  return (
    <div className="rounded-xl border border-border bg-card/40 overflow-hidden" data-testid={testId}>
      <div className="px-3 py-2 border-b border-border/60 bg-muted/20">
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-foreground">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground px-3 py-4">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                {columns.map((c) =>
                  c.sortAccessor ? (
                    <SortableTh
                      key={c.key}
                      sortKey={c.key}
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={toggle}
                      align={c.align}
                      className={cn(
                        "px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider text-muted-foreground",
                        alignCls(c.align),
                        !c.mobile && "hidden sm:table-cell",
                      )}
                    >
                      {c.header}
                    </SortableTh>
                  ) : (
                    <th
                      key={c.key}
                      className={cn(
                        "px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider text-muted-foreground",
                        alignCls(c.align),
                        !c.mobile && "hidden sm:table-cell",
                      )}
                    >
                      {c.header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.playerId} className="border-b border-border/20 last:border-0 hover:bg-muted/10">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-2.5 py-1.5 tabular-nums",
                        alignCls(c.align),
                        !c.mobile && "hidden sm:table-cell",
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
      )}
    </div>
  );
}
