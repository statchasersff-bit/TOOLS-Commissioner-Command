import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { getTierColor } from "@/data/mockData";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle, RefreshCw } from "lucide-react";

export interface TradeBlockCandidate {
  id: string;
  sleeperId?: string;
  name: string;
  pos: string;
  age: number;
  team?: string;
  ownerName: string;
  /** Long-term dynasty asset value. */
  dynastyVal?: number;
  /** In-season redraft / starter-points value. */
  redraftVal?: number;
  reason?: "Rebuilder" | "Dynasty-heavy";
  addedAt?: number;
}

interface TradeBlockCandidatesProps {
  candidates: TradeBlockCandidate[];
  mode?: "buildDynastyCandidates" | "actualTradeBlock";
  title?: string;
  description?: string;
  maxItems?: number;
  isLoading?: boolean;
  noJwt?: boolean;
  /** Non-null when the live trade-block fetch failed; renders an error card. */
  error?: string | null;
  /** Called when the user clicks Retry in the error state. */
  onRetry?: () => void;
  testId?: string;
}

type SortKey = "name" | "pos" | "age" | "dynasty" | "redraft" | "addedAt" | "owner";
type SortDir = "asc" | "desc";

export function TradeBlockCandidates({
  candidates,
  mode = "buildDynastyCandidates",
  title = "Trade Block Candidates",
  description = "Veteran players (27+) on rebuilding or dynasty-heavy teams with strong redraft value. Likely trade targets.",
  maxItems = 20,
  isLoading = false,
  noJwt = false,
  error = null,
  onRetry,
  testId = "card-trade-block-candidates",
}: TradeBlockCandidatesProps) {
  const isActual = mode === "actualTradeBlock";
  const isMobile = useIsMobile();

  // Default sort: actual-block view leads with most-recently added; otherwise
  // lead with highest dynasty value.
  const [sortKey, setSortKey] = useState<SortKey>(isActual ? "addedAt" : "dynasty");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" || k === "pos" || k === "owner" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...candidates];
    const num = (v: number | undefined) => (typeof v === "number" && v > 0 ? v : null);
    arr.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "name") return dir * (a.name || "").localeCompare(b.name || "");
      if (sortKey === "pos") return dir * (a.pos || "").localeCompare(b.pos || "");
      if (sortKey === "owner") return dir * (a.ownerName || "").localeCompare(b.ownerName || "");
      // Numeric keys — missing / non-positive values sink to the bottom
      // regardless of sort direction so a partial dataset doesn't pile
      // empties at the top in asc order.
      const pickValue = (c: TradeBlockCandidate): number | null => {
        if (sortKey === "age") return num(c.age);
        if (sortKey === "dynasty") return num(c.dynastyVal);
        if (sortKey === "redraft") return num(c.redraftVal);
        return num(c.addedAt);
      };
      const va = pickValue(a);
      const vb = pickValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return dir === 1 ? va - vb : vb - va;
    });
    return arr;
  }, [candidates, sortKey, sortDir]);

  const shown = sorted.slice(0, maxItems);

  const emptyText = isActual
    ? "No players are currently listed on the trade block in this league."
    : "No trade block candidates found";

  const SortHeader = ({
    label,
    sortKey: k,
    align = "left",
    className,
  }: {
    label: string;
    sortKey: SortKey;
    align?: "left" | "right";
    className?: string;
  }) => {
    const active = sortKey === k;
    return (
      <button
        type="button"
        onClick={() => onSort(k)}
        data-testid={`sort-trade-block-${k}`}
        className={cn(
          "flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors select-none",
          // Active sort column uses the same cyan as the Redraft value
          // column so the user's eye can trace from the header to the
          // sorted values in one glance.
          active
            ? "text-cyan-500 dark:text-cyan-300 hover:text-cyan-400 dark:hover:text-cyan-200"
            : "text-muted-foreground hover:text-foreground",
          align === "right" ? "justify-end ml-auto" : "justify-start",
          className,
        )}
      >
        {label}
        {active ? (
          sortDir === "asc"
            ? <ArrowUp className="w-2.5 h-2.5" />
            : <ArrowDown className="w-2.5 h-2.5" />
        ) : (
          <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
        )}
      </button>
    );
  };

  // Desktop grid template — Player | Owner | Age | Dynasty | Redraft | Reason/Date
  const gridCols = "minmax(0,1fr) minmax(0,120px) 50px 78px 78px 86px";

  return (
    <Card className="p-6" data-testid={testId}>
      <div className="mb-5">
        <h3 className="text-base font-bold flex items-center gap-2">
          {title}
          {!isLoading && !error && <Badge variant="secondary">{candidates.length}</Badge>}
        </h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        {!isActual && description && (
          <p className="text-[10px] text-muted-foreground mt-2">{description}</p>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading trade block…
        </div>
      )}

      {/* Error state — a failed fetch gets a clear, retryable card instead of
          being silently shown as an empty trade block. */}
      {!isLoading && error && (
        <div
          className="flex flex-col items-center gap-3 py-6 text-center"
          data-testid="trade-block-error"
        >
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Couldn’t load the trade block</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
              The live trade-block data failed to load. Your other tools still work — try again.
            </p>
          </div>
          {onRetry && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              data-testid="button-retry-trade-block"
              className="gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </Button>
          )}
        </div>
      )}

      {!isLoading && !error && noJwt && isActual && (
        <p className="text-xs text-muted-foreground">
          Connect your Sleeper account to see live trade block listings.
        </p>
      )}

      {!isLoading && !error && !noJwt && (
        <>
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyText}</p>
          ) : (
            <>
              {/* Sortable column header — desktop only. Mobile rows preserve
                  the compact two-value stack. */}
              <div
                className="hidden md:grid items-center gap-2 px-2 pb-1.5 border-b border-border/30"
                style={{ gridTemplateColumns: gridCols }}
              >
                <SortHeader label="Player" sortKey="name" align="left" />
                <SortHeader label="Owner" sortKey="owner" align="left" />
                <SortHeader label="Age" sortKey="age" align="right" />
                <SortHeader label="Dynasty" sortKey="dynasty" align="right" />
                <SortHeader label="Win-Now" sortKey="redraft" align="right" />
                <SortHeader
                  label={isActual ? "Added" : "Reason"}
                  sortKey={isActual ? "addedAt" : "pos"}
                  align="right"
                />
              </div>

              <div className="space-y-0">
                {shown.map((p, i) => {
                  const sleeperId = p.sleeperId ?? p.id;
                  const dynVal = typeof p.dynastyVal === "number" && p.dynastyVal > 0 ? p.dynastyVal : null;
                  const rdVal = typeof p.redraftVal === "number" && p.redraftVal > 0 ? p.redraftVal : null;
                  // Mobile-only sub-line below the avatar — keeps the dense
                  // owner/date pairing visible on small screens where the
                  // dedicated Owner column is hidden. Desktop uses the
                  // separate Owner column instead.
                  const mobileSubLine = [
                    p.ownerName,
                    isActual && p.addedAt
                      ? new Date(p.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : null,
                  ].filter(Boolean).join(" · ");

                  return (
                    <div
                      key={`${sleeperId}-${i}`}
                      className="md:grid md:gap-2 md:items-center flex items-center gap-2.5 py-2.5 px-2 border-b border-border/20 last:border-0"
                      style={{ gridTemplateColumns: gridCols }}
                      data-testid={`trade-block-candidate-${sleeperId}`}
                    >
                      <div className="min-w-0 flex-1 md:flex-initial">
                        <PlayerAvatar
                          id={sleeperId}
                          name={p.name}
                          pos={p.pos}
                          team={p.team ?? ""}
                          size="sm"
                          sub={isMobile ? mobileSubLine : ""}
                        />
                      </div>
                      <span
                        className="hidden md:inline text-[11.5px] text-foreground/85 truncate"
                        title={p.ownerName}
                        data-testid={`text-owner-${sleeperId}`}
                      >
                        {p.ownerName || "—"}
                      </span>
                      <span className="hidden md:inline text-[11px] text-right text-muted-foreground tabular-nums">
                        {p.age > 0 ? p.age : "—"}
                      </span>
                      <div className="flex flex-col items-end leading-none">
                        <span className="md:hidden text-[8px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-0.5">Dynasty</span>
                        <span
                          className="text-[12px] md:text-[13px] tabular-nums font-semibold text-foreground"
                          data-testid={`text-dynasty-value-${sleeperId}`}
                        >
                          {dynVal != null ? dynVal.toLocaleString() : "—"}
                        </span>
                      </div>
                      <div className="flex flex-col items-end leading-none">
                        <span className="md:hidden text-[8px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-0.5">Win-Now</span>
                        <span
                          className={cn(
                            "text-[12px] md:text-[13px] tabular-nums font-semibold",
                            // Highlight redraft values in cyan only when
                            // redraft is the active sort column — same idea
                            // as the sortable header highlighting itself.
                            sortKey === "redraft"
                              ? "text-cyan-500 dark:text-cyan-300"
                              : "text-foreground",
                          )}
                          data-testid={`text-redraft-value-${sleeperId}`}
                        >
                          {rdVal != null ? rdVal.toLocaleString() : "—"}
                        </span>
                      </div>
                      <div className="hidden md:flex justify-end">
                        {isActual ? (
                          <span className="text-[10.5px] text-muted-foreground tabular-nums">
                            {p.addedAt
                              ? new Date(p.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                              : "—"}
                          </span>
                        ) : p.reason ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px] px-1.5 py-0 h-4",
                              p.reason === "Rebuilder"
                                ? getTierColor("Future Powerhouse")
                                : "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700",
                            )}
                            data-testid={`trade-block-reason-${sleeperId}`}
                          >
                            {p.reason}
                          </Badge>
                        ) : (
                          <span className="text-[10.5px] text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}
