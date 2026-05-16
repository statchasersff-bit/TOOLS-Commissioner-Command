import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PlayerAvatar } from "@/components/PlayerAvatar";
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
            const subLine = [
              p.ownerName,
              p.age > 0 ? `Age ${p.age}` : null,
              isActual && p.addedAt
                ? new Date(p.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : null,
            ].filter(Boolean).join(" · ");

            return (
              <div
                key={`${sleeperId}-${i}`}
                className="flex items-center gap-2.5 py-2.5 border-b border-border/20 last:border-0"
                data-testid={`trade-block-candidate-${sleeperId}`}
              >
                <span className="text-xs text-muted-foreground w-5 text-right flex-shrink-0">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <PlayerAvatar
                    id={sleeperId}
                    name={p.name}
                    pos={p.pos}
                    team={p.team ?? ""}
                    size="sm"
                    sub={subLine}
                  />
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {p.redraftVal > 0 && (
                    <span className="text-xs font-bold text-[#0b3a7a] dark:text-blue-400 tabular-nums">
                      {p.redraftVal.toLocaleString()}
                    </span>
                  )}
                  {!isActual && p.reason && (
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
