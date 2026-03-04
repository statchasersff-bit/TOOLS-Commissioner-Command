import { cn } from "@/lib/utils";

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T, index: number) => React.ReactNode;
  className?: string;
  sticky?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  className?: string;
  highlightRow?: (row: T) => boolean;
  loading?: boolean;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  className,
  highlightRow,
  loading,
}: DataTableProps<T>) {
  if (loading) {
    return <DataTableSkeleton columns={columns.length} rows={6} />;
  }

  return (
    <div className={cn("overflow-x-auto rounded-md border border-border/60", className)} data-testid="data-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 dark:bg-muted/20">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-3.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap",
                  col.sticky && "sticky left-0 z-10 bg-muted/30 dark:bg-muted/20",
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const isEven = idx % 2 === 0;
            const rowBg = isEven ? "bg-background" : "bg-muted/10 dark:bg-muted/5";
            const isHighlighted = highlightRow?.(row);
            return (
              <tr
                key={idx}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "border-b border-border/20 transition-colors",
                  rowBg,
                  onRowClick && "cursor-pointer",
                  isHighlighted && "bg-[#d4af37]/5 dark:bg-[#d4af37]/8"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3.5 whitespace-nowrap",
                      col.sticky && "sticky left-0 z-10",
                      col.sticky && (isHighlighted ? "bg-[#d4af37]/5 dark:bg-[#d4af37]/8" : rowBg),
                      col.className
                    )}
                  >
                    {col.render ? col.render(row, idx) : String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataTableSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div className="rounded-md border border-border/60" data-testid="table-skeleton">
      <div className="border-b border-border bg-muted/30 dark:bg-muted/20 flex gap-4 px-4 py-3.5">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="h-3 rounded skeleton-pulse" style={{ width: `${60 + Math.random() * 60}px` }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className={cn("flex gap-4 px-4 py-3.5 border-b border-border/20", rowIdx % 2 === 0 ? "bg-background" : "bg-muted/10")}>
          {Array.from({ length: columns }).map((_, colIdx) => (
            <div key={colIdx} className="h-4 rounded skeleton-pulse" style={{ width: `${50 + Math.random() * 80}px` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
