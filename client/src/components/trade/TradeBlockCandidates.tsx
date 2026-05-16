import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getTierColor } from "@/data/mockData";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface TradeBlockCandidate {
  id: string;
  sleeperId?: string;
  name: string;
  pos: string;
  age: number;
  team?: string;
  ownerName: string;
  redraftVal: number;
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
  testId?: string;
}

export function TradeBlockCandidates({
  candidates,
  mode = "buildDynastyCandidates",
  title = "Trade Block Candidates",
  description = "Veteran players (27+) on rebuilding or dynasty-heavy teams with strong redraft value. Likely trade targets.",
  maxItems = 20,
  isLoading = false,
  noJwt = false,
  testId = "card-trade-block-candidates",
}: TradeBlockCandidatesProps) {
  const shown = candidates.slice(0, maxItems);
  const isActual = mode === "actualTradeBlock";

  const emptyText = isActual
    ? "No players are currently listed on the trade block in this league."
    : "No trade block candidates found";

  return (
    <Card className="p-6" data-testid={testId}>
      <div className="mb-5">
        <h3 className="text-base font-bold flex items-center gap-2">
          {title}
          {!isLoading && <Badge variant="secondary">{candidates.length}</Badge>}
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

      {!isLoading && noJwt && isActual && (
        <p className="text-xs text-muted-foreground">
          Connect your Sleeper account to see live trade block listings.
        </p>
      )}

      {!isLoading && !noJwt && (
        <div className="space-y-0">
          {candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">{emptyText}</p>
          )}
          {shown.map((p, i) => {
            const sleeperId = p.sleeperId ?? p.id;
            return (
              <div
                key={`${sleeperId}-${i}`}
                className="flex items-center gap-2 py-2.5 border-b border-border/20 last:border-0"
                data-testid={`trade-block-candidate-${sleeperId}`}
              >
                <span className="text-xs text-muted-foreground w-5 text-right flex-shrink-0">{i + 1}.</span>
                <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden bg-muted ring-1 ring-border/30">
                  <img
                    src={`https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`}
                    alt={p.name}
                    className="w-full h-full object-cover object-top"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold leading-tight">{p.name}</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1 py-0 h-4 flex-shrink-0",
                        p.pos === "QB" ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30" :
                        p.pos === "RB" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" :
                        p.pos === "WR" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" :
                        p.pos === "TE" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" :
                        "bg-muted text-muted-foreground"
                      )}
                    >
                      {p.pos}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {p.ownerName}{p.age > 0 ? ` · Age ${p.age}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {p.redraftVal > 0 && (
                    <span className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 tabular-nums">
                      {p.redraftVal.toLocaleString()}
                    </span>
                  )}
                  {isActual ? (
                    p.addedAt ? (
                      <span className="text-[9px] text-muted-foreground tabular-nums">
                        {new Date(p.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    ) : null
                  ) : (
                    p.reason && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1.5 py-0 h-4",
                          p.reason === "Rebuilder"
                            ? getTierColor("Future Powerhouse")
                            : "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                        )}
                        data-testid={`trade-block-reason-${sleeperId}`}
                      >
                        {p.reason}
                      </Badge>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
