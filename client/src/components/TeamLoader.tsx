import { Loader2 } from "lucide-react";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { getTeamSlogan } from "@/config/nflTeams";
import { cn } from "@/lib/utils";

interface Props {
  /** Visual size. */
  size?: "sm" | "md" | "lg";
  /** Override the text shown when no favorite team is set. */
  fallback?: string;
  /** Suffix appended to the slogan, e.g. "Loading dashboard". */
  context?: string;
  /** Hide the spinner glyph (text-only). */
  noSpinner?: boolean;
  className?: string;
}

/**
 * Replaces generic "Loading…" indicators with the user's favorite team's
 * slogan. Falls back to "Loading…" (or whatever `fallback` says) when no
 * favorite is set, so users without personalization still get a normal
 * loading affordance. The slogan is shown in the team's accent color via
 * the --favorite-team-primary CSS var so the spinner blends into the
 * personalized header palette automatically.
 *
 * Use `size="lg"` for full-page Suspense fallbacks (vertical stack, big
 * spinner). `size="md"` for in-card loaders. `size="sm"` for inline loaders
 * next to controls.
 */
export function TeamLoader({
  size = "md",
  fallback = "Loading…",
  context,
  noSpinner = false,
  className,
}: Props) {
  const { favoriteTeam } = useFavoriteTeam();
  const slogan = getTeamSlogan(favoriteTeam);
  const phrase = slogan ?? fallback;
  const subPhrase = slogan && context ? context : null;

  if (size === "lg") {
    return (
      <div
        className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}
        data-testid="team-loader"
        aria-busy
      >
        {!noSpinner && (
          <Loader2
            className="w-7 h-7 animate-spin"
            style={{ color: favoriteTeam ? "var(--favorite-team-primary)" : undefined }}
          />
        )}
        <div className="text-center max-w-xs">
          <p
            className="text-base sm:text-lg font-bold leading-tight"
            style={{ color: favoriteTeam ? "var(--favorite-team-primary)" : undefined }}
          >
            {phrase}
          </p>
          {subPhrase && (
            <p className="text-xs text-muted-foreground mt-1">{subPhrase}</p>
          )}
        </div>
      </div>
    );
  }

  if (size === "sm") {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
        data-testid="team-loader"
        aria-busy
      >
        {!noSpinner && (
          <Loader2
            className="w-3.5 h-3.5 animate-spin flex-shrink-0"
            style={{ color: favoriteTeam ? "var(--favorite-team-primary)" : undefined }}
          />
        )}
        <span
          className="font-medium"
          style={{ color: favoriteTeam ? "var(--favorite-team-primary)" : undefined }}
        >
          {phrase}
        </span>
        {subPhrase && <span className="text-muted-foreground/80">· {subPhrase}</span>}
      </span>
    );
  }

  // md (default) — card-sized loader, horizontal layout
  return (
    <div
      className={cn("flex items-center justify-center gap-2.5 py-6", className)}
      data-testid="team-loader"
      aria-busy
    >
      {!noSpinner && (
        <Loader2
          className="w-4 h-4 animate-spin"
          style={{ color: favoriteTeam ? "var(--favorite-team-primary)" : undefined }}
        />
      )}
      <span className="text-sm">
        <span
          className="font-semibold"
          style={{ color: favoriteTeam ? "var(--favorite-team-primary)" : undefined }}
        >
          {phrase}
        </span>
        {subPhrase && <span className="text-muted-foreground"> · {subPhrase}</span>}
      </span>
    </div>
  );
}
