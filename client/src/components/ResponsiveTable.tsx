import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContainerWidth, useScrollEdges } from "@/hooks/useResponsive";
import { abbreviateLabel } from "@/lib/columnAbbreviations";

/**
 * Reusable, width-aware table for Dynasty Command.
 *
 * One column config drives three responsive behaviors so a table that's perfect
 * on desktop degrades gracefully instead of overflowing or crushing on phones:
 *
 *   mobileMode="scroll"   — horizontal scroll with a sticky first column + edge
 *                           fades. Best for dense analytics (many stat columns).
 *   mobileMode="priority" — hide low-priority columns below the breakpoint and
 *                           tuck them into a tap-to-expand detail row. Best for
 *                           compact rankings / leaderboards.
 *   mobileMode="cards"    — render each row as a stacked card. Best when every
 *                           row is a rich object (trades, league rows).
 *
 * Everything keys off the *container* width (ResizeObserver), not the viewport,
 * so a table inside a 340px sidebar adapts the same way it would on a phone.
 *
 * Labels abbreviate automatically: a column uses its own shortLabel/mobileLabel
 * when given, otherwise falls back to the shared abbreviation dictionary. The
 * full label is always preserved in the header `title` for hover/tap.
 */

export type ResponsiveTableColumn<T> = {
  /** Stable id; also used as the value accessor when `render` is omitted. */
  key: string;
  /** Full, canonical header label (used on desktop and as the tooltip). */
  label: string;
  /** Label at tablet / small-laptop widths. Falls back to the abbrev dict. */
  shortLabel?: string;
  /** Ultra-short label at small-mobile widths. Falls back to shortLabel/dict. */
  mobileLabel?: string;
  /** Lower = more important. Drives "priority" mode + scroll sticky pick. */
  priority?: number;
  /** Min column width hint (px). Applied as a CSS min-width on the cell. */
  minWidth?: number;
  /** Hide this column entirely when the container is narrower than this (px). */
  hideBelow?: number;
  /** Use the short label below this width (px). Default 1024. */
  abbreviateBelow?: number;
  align?: "left" | "center" | "right";
  /** Pin this column in scroll mode. Defaults to the first column. */
  sticky?: boolean;
  /** Custom cell renderer. Without it, `String(row[key])` is shown. */
  render?: (row: T) => ReactNode;
  /** Label shown for this field inside the expanded detail row (priority mode).
   *  Defaults to `shortLabel ?? label`. */
  detailLabel?: string;
  className?: string;
  headerClassName?: string;
};

export type ResponsiveTableMode = "scroll" | "priority" | "cards";

export interface ResponsiveTableProps<T> {
  columns: ResponsiveTableColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  /** Behavior applied below `mobileBreakpoint`. Default "scroll". */
  mobileMode?: ResponsiveTableMode;
  /** Width (px) under which `mobileMode` kicks in. Default 768. */
  mobileBreakpoint?: number;
  /** priority mode: render a tap-to-expand row with the hidden columns. */
  expandableRows?: boolean;
  /** Keep the header pinned while the body scrolls vertically. */
  stickyHeader?: boolean;
  /** Max height for the scroll body (enables vertical scroll + sticky header). */
  maxBodyHeight?: number | string;
  onRowClick?: (row: T) => void;
  /** Heading rendered at the top of each card in "cards" mode. */
  cardTitle?: (row: T) => ReactNode;
  emptyMessage?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

const ALIGN_CLS: Record<NonNullable<ResponsiveTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function cellValue<T>(col: ResponsiveTableColumn<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  const v = (row as Record<string, unknown>)[col.key];
  return v == null ? "—" : (v as ReactNode);
}

function headerLabel<T>(col: ResponsiveTableColumn<T>, width: number): string {
  if (width > 0 && width < 480) {
    return col.mobileLabel ?? col.shortLabel ?? abbreviateLabel(col.label, width);
  }
  const abbrevAt = col.abbreviateBelow ?? 1024;
  if (width > 0 && width < abbrevAt) {
    return col.shortLabel ?? abbreviateLabel(col.label, width);
  }
  return col.label;
}

/** priority mode keeps only the most important columns below the breakpoint. */
function priorityVisible<T>(columns: ResponsiveTableColumn<T>[], width: number) {
  const threshold = width > 0 && width < 480 ? 2 : 3;
  return columns.filter((c) => (c.priority ?? 99) <= threshold);
}

export function ResponsiveTable<T>({
  columns,
  data,
  rowKey,
  mobileMode = "scroll",
  mobileBreakpoint = 768,
  expandableRows = true,
  stickyHeader = false,
  maxBodyHeight,
  onRowClick,
  cardTitle,
  emptyMessage = "No data.",
  className,
  ...rest
}: ResponsiveTableProps<T>) {
  const { ref: measureRef, width } = useContainerWidth<HTMLDivElement>();
  const { ref: scrollRef, refresh: refreshEdges } = useScrollEdges<HTMLDivElement>();

  // Width === 0 means "not measured yet" — assume desktop so SSR/first paint
  // renders the full table rather than flashing the mobile layout.
  const isMobile = width > 0 && width < mobileBreakpoint;

  // Re-check scroll edges whenever the rendered layout could change.
  useEffect(() => {
    refreshEdges();
  }, [width, data, columns, refreshEdges]);

  const stickyKey = columns.find((c) => c.sticky)?.key ?? columns[0]?.key;

  if (data.length === 0) {
    return (
      <div ref={measureRef} className={cn("w-full", className)} {...rest}>
        <div className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      </div>
    );
  }

  // ── Cards mode (mobile) ───────────────────────────────────────────────────
  if (isMobile && mobileMode === "cards") {
    return (
      <div ref={measureRef} className={cn("w-full space-y-2.5", className)} {...rest}>
        {data.map((row, i) => (
          <button
            key={rowKey(row, i)}
            type="button"
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            disabled={!onRowClick}
            className={cn(
              "block w-full rounded-xl border border-border bg-card p-3 text-left",
              onRowClick && "hover-elevate active-elevate-2 cursor-pointer",
            )}
          >
            {cardTitle && <div className="mb-2 min-w-0">{cardTitle(row)}</div>}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {columns
                .filter((c) => c.key !== stickyKey || !cardTitle)
                .map((col) => (
                  <div key={col.key} className="flex flex-col min-w-0">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {col.shortLabel ?? abbreviateLabel(col.label, width)}
                    </dt>
                    <dd className="text-[13px] font-medium text-foreground min-w-0 truncate">
                      {cellValue(col, row)}
                    </dd>
                  </div>
                ))}
            </dl>
          </button>
        ))}
      </div>
    );
  }

  // ── Priority mode (mobile) ────────────────────────────────────────────────
  if (isMobile && mobileMode === "priority") {
    const visible = priorityVisible(columns, width);
    const hidden = columns.filter((c) => !visible.includes(c));
    return (
      <div ref={measureRef} className={cn("w-full", className)} {...rest}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border">
              {expandableRows && hidden.length > 0 && <th className="w-7" aria-hidden />}
              {visible.map((col) => (
                <th
                  key={col.key}
                  title={col.label}
                  className={cn(
                    "px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
                    ALIGN_CLS[col.align ?? "left"],
                    col.headerClassName,
                  )}
                >
                  {headerLabel(col, width)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <PriorityRow
                key={rowKey(row, i)}
                row={row}
                visible={visible}
                hidden={expandableRows ? hidden : []}
                width={width}
                stickyKey={stickyKey}
                onRowClick={onRowClick}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Scroll mode (default) + full desktop table ────────────────────────────
  const visible = columns.filter((c) => !(c.hideBelow && width > 0 && width < c.hideBelow));
  const enableSticky = isMobile || width === 0 ? true : false; // sticky col only when cramped
  return (
    <div ref={measureRef} className={cn("w-full", className)} {...rest}>
      <div
        ref={scrollRef}
        className={cn("dc-scroll-x", stickyHeader && "dc-sticky-head")}
        style={maxBodyHeight != null ? { maxHeight: maxBodyHeight } : undefined}
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border">
              {visible.map((col) => {
                const sticky = enableSticky && col.key === stickyKey;
                return (
                  <th
                    key={col.key}
                    title={col.label}
                    style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                    className={cn(
                      "px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap",
                      ALIGN_CLS[col.align ?? "left"],
                      sticky && "dc-sticky-col text-left",
                      col.headerClassName,
                    )}
                  >
                    {headerLabel(col, width)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border/60",
                  onRowClick && "cursor-pointer hover:bg-muted/40",
                )}
              >
                {visible.map((col) => {
                  const sticky = enableSticky && col.key === stickyKey;
                  return (
                    <td
                      key={col.key}
                      style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                      className={cn(
                        "px-3 py-2 align-middle",
                        ALIGN_CLS[col.align ?? "left"],
                        sticky && "dc-sticky-col",
                        col.className,
                      )}
                    >
                      {cellValue(col, row)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriorityRow<T>({
  row,
  visible,
  hidden,
  width,
  stickyKey,
  onRowClick,
}: {
  row: T;
  visible: ResponsiveTableColumn<T>[];
  hidden: ResponsiveTableColumn<T>[];
  width: number;
  stickyKey?: string;
  onRowClick?: (row: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const expandable = hidden.length > 0;

  return (
    <Fragment>
      <tr
        className={cn("border-b border-border/50", (onRowClick || expandable) && "cursor-pointer")}
        onClick={() => {
          if (expandable) setOpen((v) => !v);
          else onRowClick?.(row);
        }}
      >
        {expandable && (
          <td className="w-7 pl-2 align-middle text-muted-foreground">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </td>
        )}
        {visible.map((col) => (
          <td
            key={col.key}
            className={cn(
              "px-2.5 py-2 align-middle",
              ALIGN_CLS[col.align ?? "left"],
              col.key === stickyKey && "font-medium text-foreground",
              col.className,
            )}
          >
            {cellValue(col, row)}
          </td>
        ))}
      </tr>
      {expandable && open && (
        <tr className="bg-muted/20">
          <td colSpan={visible.length + 1} className="px-2.5 py-2">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {hidden.map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-2 min-w-0">
                  <dt className="text-[11px] text-muted-foreground truncate" title={col.label}>
                    {col.detailLabel ?? col.shortLabel ?? col.label}
                  </dt>
                  <dd className="text-[12.5px] font-medium text-foreground shrink-0">
                    {cellValue(col, row)}
                  </dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
