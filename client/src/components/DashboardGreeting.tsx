import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { cn } from "@/lib/utils";

/**
 * Personalized greeting card. Renders at the top of the user's landing page.
 * If a favorite team is set we tint the border with `--favorite-team-primary`
 * (which the FavoriteTeamProvider injects on the document root), otherwise
 * we fall back to the StatChasers gold/navy palette so unauthenticated
 * users still get a branded experience.
 */
export function DashboardGreeting() {
  const { favoriteTeam } = useFavoriteTeam();
  const { user } = useAuth();
  const sleeper = useSleeper();

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

  return (
    <div
      className="rounded-2xl p-[1.5px]"
      style={borderStyle}
      data-testid="dashboard-greeting"
    >
      <Card className="rounded-[14px] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 bg-card">
        {/* Optional team chip — small, tasteful, only when a favorite is set */}
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
      </Card>
    </div>
  );
}
