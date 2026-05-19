import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import { Star, Calendar, Users, CheckCircle2 } from "lucide-react";
import type { Player } from "@/types";
import { calculateNflTeamExposure } from "@/lib/nflTeamExposure";

interface Props {
  /**
   * The user's roster in the current context. Pass when available (e.g.
   * MyTeam Overview where league + userTeam are hydrated). Omit on the
   * Portfolio home page — the widget will show a friendly fallback for the
   * exposure row instead of fabricating a number.
   */
  players?: Player[] | null;
  /** Free-text scope hint shown in the exposure line, e.g. "in your active league". */
  scopeHint?: string;
  /**
   * Opens the favorite-team selector. The host page wires this to its
   * SettingsModal — we don't import the modal directly so the widget stays
   * decoupled from the auth/header surface.
   */
  onChangeTeam?: () => void;
}

export function FavoriteTeamWidget({ players, scopeHint, onChangeTeam }: Props) {
  const { favoriteTeam, favoriteAbbr } = useFavoriteTeam();
  const { getPlayerValue, getRedraftValue } = useValueModel();

  // ── Empty state ────────────────────────────────────────────────────────
  if (!favoriteTeam) {
    return (
      <Card className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="favorite-team-widget-empty">
        <div className="w-12 h-12 rounded-xl bg-[#d4af37]/10 ring-1 ring-[#d4af37]/30 flex items-center justify-center flex-shrink-0">
          <Star className="w-5 h-5 text-[#d4af37]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-foreground">Your Team Hub</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose your favorite NFL team to personalize your command center.
          </p>
        </div>
        {onChangeTeam && (
          <Button
            onClick={onChangeTeam}
            className="bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
            size="sm"
            data-testid="favorite-team-widget-set"
          >
            Set Favorite Team
          </Button>
        )}
      </Card>
    );
  }

  // ── Populated state ────────────────────────────────────────────────────
  const exposure = useMemo(() => {
    if (!players || players.length === 0) return null;
    return calculateNflTeamExposure(players, favoriteAbbr, getPlayerValue, getRedraftValue);
  }, [players, favoriteAbbr, getPlayerValue, getRedraftValue]);

  const fav = exposure?.favoriteTeamExposure ?? null;
  const exposureLine: { primary: string; sub?: string } = (() => {
    if (!players) {
      return {
        primary: "Open My Team to see your roster exposure.",
        sub: "Select a league to view live counts.",
      };
    }
    if (!fav || fav.playerCount === 0) {
      return {
        primary: `No ${favoriteTeam.shortName} players on your active roster.`,
        sub: scopeHint,
      };
    }
    const word = fav.playerCount === 1 ? "player" : "players";
    return {
      primary: `${fav.playerCount} ${favoriteTeam.shortName} ${word} on your roster.`,
      sub: scopeHint
        ? `${scopeHint} · ${formatK(fav.dynastyValue)} dynasty value`
        : `${formatK(fav.dynastyValue)} dynasty value`,
    };
  })();

  return (
    <div
      className="rounded-2xl p-[1.5px]"
      style={{ background: `linear-gradient(135deg, ${favoriteTeam.primaryColor} 0%, #d4af37 100%)` }}
      data-testid="favorite-team-widget"
    >
      <Card className="rounded-[14px] p-4 sm:p-5 space-y-3 bg-card">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span
            className="relative w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-black/10"
            style={{ background: favoriteTeam.primaryColor }}
            aria-hidden
          >
            <img
              src={favoriteTeam.logoUrl}
              alt=""
              className="absolute inset-1 w-10 h-10 object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            <span className="text-[11px] font-black tracking-tight" style={{ color: favoriteTeam.secondaryColor }}>
              {favoriteTeam.abbreviation}
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Your Team Hub</p>
            <h3 className="text-lg font-bold leading-tight truncate">{favoriteTeam.name}</h3>
            <span
              className="inline-flex items-center mt-1 text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border whitespace-nowrap"
              style={{
                color: favoriteTeam.primaryColor,
                borderColor: `${favoriteTeam.primaryColor}55`,
                background: `${favoriteTeam.primaryColor}10`,
              }}
            >
              {favoriteTeam.abbreviation}
            </span>
          </div>
          {onChangeTeam && (
            <button
              onClick={onChangeTeam}
              className="text-[10px] text-[#d4af37] hover:underline flex-shrink-0"
              data-testid="favorite-team-widget-change"
            >
              Change
            </button>
          )}
        </div>

        {/* Content rows */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <Row icon={<Calendar className="w-3.5 h-3.5 text-muted-foreground" />} label="Next Game">
            <span className="text-muted-foreground italic">Schedule data coming soon</span>
          </Row>
          <Row icon={<Users className="w-3.5 h-3.5 text-muted-foreground" />} label="Your Exposure">
            <span className="block font-medium leading-snug">{exposureLine.primary}</span>
            {exposureLine.sub && (
              <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">{exposureLine.sub}</span>
            )}
          </Row>
          <Row icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />} label="Status">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">Team personalization active</span>
          </Row>
        </div>
      </Card>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className={cn("text-xs leading-tight")}>{children}</div>
    </div>
  );
}

function formatK(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toString();
}
