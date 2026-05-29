import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useResponsive } from "@/hooks/useResponsive";

/**
 * Responsive filter toolbar.
 *
 *   Desktop / tablet  → search + every secondary filter inline (wrapping grid).
 *   Mobile (< 768px)  → search stays visible; secondary filters collapse behind
 *                       a "Filters" button that opens a bottom sheet/drawer, so
 *                       dropdowns never run off-screen.
 *
 * Pass the search control as `search` (always rendered) and the secondary
 * filters as `children`. `activeCount` shows a badge on the mobile trigger and
 * `onReset` adds a "Reset" action inside the drawer.
 *
 *   <ResponsiveFilterBar
 *     search={<SearchInput … />}
 *     activeCount={activeFilterCount}
 *     onReset={resetFilters}
 *   >
 *     <PositionSelect … />
 *     <TeamSelect … />
 *     <SortSelect … />
 *   </ResponsiveFilterBar>
 */
export interface ResponsiveFilterBarProps {
  search?: ReactNode;
  children: ReactNode;
  /** Number of non-default filters active — shown as a badge on the trigger. */
  activeCount?: number;
  onReset?: () => void;
  /** Width (px) under which filters move into the drawer. Default 768. */
  breakpoint?: number;
  className?: string;
  drawerTitle?: string;
}

export function ResponsiveFilterBar({
  search,
  children,
  activeCount = 0,
  onReset,
  breakpoint = 768,
  className,
  drawerTitle = "Filters",
}: ResponsiveFilterBarProps) {
  const { width } = useResponsive();
  const [open, setOpen] = useState(false);
  const isMobile = width > 0 && width < breakpoint;

  if (!isMobile) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {search && <div className="min-w-0 flex-1 sm:flex-initial">{search}</div>}
        {children}
        {onReset && (
          <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
            Reset
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {search && <div className="min-w-0 flex-1">{search}</div>}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="dc-touch relative shrink-0 gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Filters</span>
            {activeCount > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--sc-gold)] px-1 text-[10px] font-bold text-black">
                {activeCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{drawerTitle}</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-1 gap-3 py-4 [&_button]:w-full [&_[role=combobox]]:w-full">
            {children}
          </div>
          <SheetFooter className="flex-row gap-2">
            {onReset && (
              <Button
                variant="outline"
                className="dc-touch flex-1"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                Reset
              </Button>
            )}
            <SheetClose asChild>
              <Button className="dc-touch flex-1">Apply</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
