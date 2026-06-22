import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import type { SortDir } from "@/hooks/useSortableTable";

/**
 * Drop-in sortable replacement for a `<th>`. Renders the header label plus a
 * sort caret (active column shows up/down, others show a faint two-way chevron)
 * and calls `onSort(sortKey)` on click. Forwards `className`/`colSpan`/etc. so
 * existing header styling carries over unchanged.
 *
 *   <SortableTh sortKey="score" activeKey={sortKey} dir={sortDir} onSort={toggle}
 *               align="center" className="px-2 py-2.5">Score</SortableTh>
 */
interface SortableThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortKey: string;
  activeKey: string | null;
  dir: SortDir;
  onSort: (key: string) => void;
  align?: "left" | "center" | "right";
}

export function SortableTh({
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
  className,
  children,
  ...rest
}: SortableThProps) {
  const active = activeKey === sortKey;
  const justify = align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
  return (
    <th
      {...rest}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("cursor-pointer select-none group", className)}
    >
      <span className={cn("inline-flex items-center gap-1 align-middle", justify)}>
        {children}
        {active ? (
          dir === "asc"
            ? <ArrowUp className="w-3 h-3 flex-shrink-0" />
            : <ArrowDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 flex-shrink-0 opacity-30 group-hover:opacity-60 transition-opacity" />
        )}
      </span>
    </th>
  );
}
