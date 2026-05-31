import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MarketPlayer } from "@/lib/market/marketModel";

export interface MarketColumn {
  key: string;
  header: string;
  /** Show on mobile too. Columns without this are hidden below `sm`. */
  mobile?: boolean;
  align?: "left" | "right" | "center";
  cell: (p: MarketPlayer) => ReactNode;
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
                {columns.map((c) => (
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
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
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
