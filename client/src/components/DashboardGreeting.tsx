import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Calendar, Users, CheckCircle2, Star } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { calculateNflTeamExposure } from "@/lib/nflTeamExposure";
import { cn } from "@/lib/utils";
import type { Player } from "@/types";

/**
 * Combined Welcome + Team Hub card. Renders at the top of the user's landing
 * page. One shared gradient border, one team logo (in the welcome row only),
 * a divider, then the Team Hub section below.
 *
 * Optional `players` / `scopeHint` plug in the roster-exposure copy when a
 * page has a hydrated league available (e.g. MyTeam Overview). Portfolio
 * renders without them and shows the friendly fallback for exposure.
 */
interface Props {
  players?: Player[] | null;
  scopeHint?: string;
}

export function DashboardGreeting({ players, scopeHint }: Props = {}) {
  const { favoriteTeam, favoriteAbbr } = useFavoriteTeam();
  const { user } = useAuth();
  const sleeper = useSleeper();
  const { getPlayerValue, getRedraftValue } = useValueModel();

  // Pick the most "you-feeling" available identity for the small line above
  // the title. Sleeper username > DC email > anonymous.
  const handle = sleeper.user?.displayName || sleeper.user?.username || user?.email?.split("@")[0] || null;

  const subtitle = favoriteTeam
    ? favoriteTeam.greeting
    : "Your command center is online. Let's manage the dynasty.";

  // Gradient border — gold by default; gold-→-team-primary when a favorite is
  // set. Done via background + padding trick so we don't need pseudo-elements.
  const borderStyle: React.CSSProperties = favoriteTeam
    ? {
        background: `linear-gradient(135deg, ${favoriteTeam.primaryColor} 0%, #d4af37 100%)`,
      }
    : { background: "linear-gradient(135deg, rgba(212,175,55,0.55) 0%, rgba(11,58,122,0.35) 100%)" };

  // Roster exposure (only meaningful when a favorite team is set AND a
  // hydrated roster was passed in).
  const exposure = useMemo(() => {
    if (!favoriteTeam || !players || players.length === 0) return null;
    return calculateNflTeamExposure(players, favoriteAbbr, getPlayerValue, getRedraftValue);
  }, [favoriteTeam, players, favoriteAbbr, getPlayerValue, getRedraftValue]);

  const fav = exposure?.favoriteTeamExposure ?? null;
  const exposureLine = favoriteTeam
    ? buildExposureLine({ favoriteTeam, players, fav, scopeHint })
    : null;

  return (
    <div
      className="rounded-2xl p-[1.5px]"
      style={borderStyle}
      data-testid="dashboard-greeting"
    >
      <Card className="rounded-[14px] bg-card p-4 sm:p-5">
        {/* ── Welcome row ───────────────────────────────────────────────────
            Single team logo lives here; do NOT repeat it in the Team Hub
            section below. Mobile: stacks logo + text vertically and the
            favorite-team pill drops below the title. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {favoriteTeam && (
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
              <span
                className="text-[11px] font-black tracking-tight"
                style={{ color: favoriteTeam.secondaryColor }}
              >
                {favoriteTeam.abbreviation}
              </span>
            </span>
          )}

          <div className="min-w-0 flex-1">
            {handle && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                @{handle}
              </p>
            )}
            <h2 className="text-xl sm:text-2xl font-bold leading-tight">
              Welcome Back, Commander <span aria-label="salute">🫡</span>
            </h2>
            <p className={cn("mt-1 text-sm text-muted-foreground leading-snug")}>{subtitle}</p>
          </div>

          {favoriteTeam && (
            <span
              className="self-start sm:self-center text-[10px] font-bold uppercase tracking-[0.12em] px-2 py-1 rounded-full border whitespace-nowrap flex-shrink-0"
              style={{
                color: favoriteTeam.primaryColor,
                borderColor: `${favoriteTeam.primaryColor}55`,
                background: `${favoriteTeam.primaryColor}10`,
              }}
              data-testid="dashboard-greeting-badge"
            >
              {favoriteTeam.abbreviation} · Favorite Team
            </span>
          )}
        </div>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="my-4 h-px bg-border/60" aria-hidden />

        {/* ── Team Hub section ──────────────────────────────────────────────
            No second logo here — the welcome row already shows it. */}
        {favoriteTeam ? (
          <div className="space-y-3" data-testid="team-hub-section">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Your Team Hub
              </p>
              <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold leading-tight truncate">{favoriteTeam.name}</h3>
                <span
                  className="inline-flex items-center text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border whitespace-nowrap"
                  style={{
                    color: favoriteTeam.primaryColor,
                    borderColor: `${favoriteTeam.primaryColor}55`,
                    background: `${favoriteTeam.primaryColor}10`,
                  }}
                >
                  {favoriteTeam.abbreviation}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <Row icon={<Calendar className="w-3.5 h-3.5 text-muted-foreground" />} label="Next Game">
                <span className="text-muted-foreground italic">Schedule data coming soon</span>
              </Row>
              <Row icon={<Users className="w-3.5 h-3.5 text-muted-foreground" />} label="Your Exposure">
                <span className="block font-medium leading-snug">{exposureLine!.primary}</span>
                {exposureLine!.sub && (
                  <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">{exposureLine!.sub}</span>
                )}
              </Row>
              <Row icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />} label="Status">
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Team personalization active</span>
              </Row>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3" data-testid="team-hub-section-empty">
            <div className="w-9 h-9 rounded-xl bg-[#d4af37]/10 ring-1 ring-[#d4af37]/30 flex items-center justify-center flex-shrink-0">
              <Star className="w-4 h-4 text-[#d4af37]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Your Team Hub</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose your favorite NFL team in Settings to personalize your command center.
              </p>
            </div>
          </div>
        )}
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

function buildExposureLine(opts: {
  favoriteTeam: NonNullable<ReturnType<typeof useFavoriteTeam>["favoriteTeam"]>;
  players: Player[] | null | undefined;
  fav: { playerCount: number; dynastyValue: number } | null;
  scopeHint?: string;
}): { primary: string; sub?: string } {
  const { favoriteTeam, players, fav, scopeHint } = opts;
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
}

function formatK(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toString();
}
