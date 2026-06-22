import { useMemo, useState } from "react";

/**
 * Shared client-side table sorting.
 *
 * Pass the row array and a map of column-key → accessor. `toggle(key)` cycles
 * desc → asc → desc and switches column. Nulls/undefined always sink to the
 * bottom regardless of direction; numbers compare numerically, everything else
 * via locale-aware string compare. Pair with <SortableTh> for the header UI.
 *
 *   const { sorted, sortKey, sortDir, toggle } = useSortableTable(rows, {
 *     name:  (r) => r.name,
 *     score: (r) => r.score,
 *   }, { defaultKey: "score", defaultDir: "desc" });
 */
export type SortDir = "asc" | "desc";

export type SortAccessor<T> = (row: T) => number | string | null | undefined;

export interface SortState {
  key: string | null;
  dir: SortDir;
}

export interface UseSortableTableResult<T> {
  sorted: T[];
  sort: SortState;
  sortKey: string | null;
  sortDir: SortDir;
  toggle: (key: string) => void;
  setSort: (next: SortState) => void;
}

export function useSortableTable<T>(
  data: T[],
  accessors: Record<string, SortAccessor<T>>,
  opts?: { defaultKey?: string; defaultDir?: SortDir },
): UseSortableTableResult<T> {
  const [sort, setSort] = useState<SortState>({
    key: opts?.defaultKey ?? null,
    dir: opts?.defaultDir ?? "desc",
  });

  const toggle = (key: string) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  };

  const sorted = useMemo(() => {
    if (!sort.key) return data;
    const acc = accessors[sort.key];
    if (!acc) return data;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      const na = va == null;
      const nb = vb == null;
      if (na && nb) return 0;
      if (na) return 1; // nulls to the bottom
      if (nb) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * factor;
    });
    // accessors is an inline literal in callers; sort + data drive recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort]);

  return { sorted, sort, sortKey: sort.key, sortDir: sort.dir, toggle, setSort };
}
