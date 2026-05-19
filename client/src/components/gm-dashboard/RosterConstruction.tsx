import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { Compass } from "lucide-react";
import type { League, Team } from "@/types";
import { classifyRosterConstruction } from "@/lib/gm-analytics";

interface Props { league: League; userTeam: Team; }

export function RosterConstruction({ league, userTeam }: Props) {
  const { getPlayerValue, getRedraftValue, getPickValue } = useValueModel();
  const result = useMemo(
    () => classifyRosterConstruction(userTeam, league, getPlayerValue, getRedraftValue, getPickValue),
    [league, userTeam, getPlayerValue, getRedraftValue, getPickValue],
  );

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-roster-construction">
      <div>
        <h3 className="text-base font-bold tracking-tight text-foreground">Roster Construction</h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-xs text-muted-foreground mt-2">How your roster is built, in plain English.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Primary archetype */}
        <div className="lg:col-span-1 rounded-lg border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/8 to-transparent p-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Primary archetype</span>
          <p className="text-xl font-bold text-foreground leading-tight" data-testid="gm-archetype-primary">
            {result.primary}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground italic">
            <Compass className="inline-block w-3 h-3 mr-1 align-[-1px]" />
            {result.comparable}
          </p>
        </div>

        {/* Secondary traits */}
        <div className="lg:col-span-1 rounded-lg border border-border/40 bg-muted/20 p-4 flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Secondary traits</span>
          {result.secondary.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No notable secondary tilts.</p>
          ) : (
            <ul className="text-xs space-y-1" data-testid="gm-archetype-secondary">
              {result.secondary.map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-[#0b3a7a] dark:bg-blue-400" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Explanation */}
        <div className="lg:col-span-1 rounded-lg border border-border/40 bg-muted/20 p-4 flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">GM read</span>
          <p className="text-xs leading-relaxed text-foreground/85" data-testid="gm-archetype-explanation">
            {result.explanation}
          </p>
        </div>
      </div>
    </Card>
  );
}
