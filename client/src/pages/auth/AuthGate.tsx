import { Loader2 } from "lucide-react";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { getTeamSlogan } from "@/config/nflTeams";
import { useAuth } from "@/contexts/AuthContext";

/**
 * AuthGate — initial bootstrap screen only.
 *
 * Previously this blocked the entire app behind StatChasers login and a
 * Sleeper credentials flow. With tiered access (see
 * client/src/config/moduleAccess.ts and client/src/components/AccessGate.tsx)
 * the app is now accessible to guests; gating happens per-module.
 *
 * This component only shows a loading splash while AuthContext is doing its
 * first /api/sc-auth/me round-trip. After that it renders children
 * regardless of access level — modules wrap themselves with AccessGate.
 *
 * Public auth screens (login, signup, password reset) are now triggered by
 * user action via UpgradeFlow rather than being a mandatory wall.
 */

function LoadingScreen() {
  // Slogan flashes in below the spinner when the user has set a favorite
  // team — FavoriteTeamProvider initializes from localStorage synchronously
  // so we can show it on the very first paint without a flicker.
  const { favoriteTeam } = useFavoriteTeam();
  const slogan = getTeamSlogan(favoriteTeam);

  return (
    <div className="min-h-screen bg-[#060d1a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-[#0b3a7a]/40 border border-[#d4af37]/30 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-6 h-6">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#d4af37" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: favoriteTeam ? "var(--favorite-team-primary)" : "rgba(212,175,55,0.6)" }}
        />
        {slogan && (
          <p
            className="text-sm font-semibold tracking-tight"
            style={{ color: "var(--favorite-team-primary)" }}
          >
            {slogan}
          </p>
        )}
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <LoadingScreen />;
  return <>{children}</>;
}
