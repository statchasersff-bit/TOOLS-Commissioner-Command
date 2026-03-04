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
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  className,
  highlightRow,
}: DataTableProps<T>) {
  return (
    <div className={cn("overflow-x-auto rounded-md border border-border/60", className)} data-testid="data-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {columns.map((col, i) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap",
                  col.sticky && "sticky left-0 z-10 bg-muted/40",
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={idx}
              onClick={() => onRowClick?.(row)}
              className={cn(
                "border-b border-border/30 transition-colors",
                idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                onRowClick && "cursor-pointer",
                highlightRow?.(row) && "bg-[#d4af37]/5 dark:bg-[#d4af37]/10"
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-4 py-3 whitespace-nowrap",
                    col.sticky && "sticky left-0 z-10",
                    col.sticky && (idx % 2 === 0 ? "bg-background" : "bg-muted/20"),
                    col.className
                  )}
                >
                  {col.render ? col.render(row, idx) : String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
