import { Sun, Moon, Star } from "lucide-react";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { cn } from "@/lib/utils";

// "x-mode" is the internal id for the app's Dark Mode (kept for back-compat with
// saved prefs); it is presented to users everywhere as "Dark Mode".
const ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  "x-mode": Moon,
  my_team: Star,
};

const MODE_NAME: Record<ThemeMode, string> = {
  light: "light",
  "x-mode": "Dark",
  my_team: "My Team",
};

/**
 * Cycles through the three supported themes. The icon represents the
 * *current* theme so the user can read state at a glance; the tooltip /
 * aria-label describes what the next click will do.
 */
export function ThemeToggle() {
  const { themeMode, setThemeMode, needsTeamForMyTeamMode, myTeamReady } = useTheme();
  const { favoriteAbbr } = useFavoriteTeam();

  // My Team is temporarily limited to ready teams (Arizona); skip it in the
  // cycle when unavailable so the toggle only offers Light ↔ Dark.
  const modes: ThemeMode[] = myTeamReady ? ["light", "x-mode", "my_team"] : ["light", "x-mode"];
  const idx = modes.indexOf(themeMode);
  const nextMode = modes[idx === -1 ? 0 : (idx + 1) % modes.length];

  const cycle = () => setThemeMode(nextMode);

  const Icon = ICONS[themeMode] ?? Moon;
  const label = `Switch to ${MODE_NAME[nextMode]} mode`;

  // When My Team Mode is the *current* mode, show a tiny "ATL Mode" / etc.
  // pill next to the icon so users know personalization is active. If they
  // selected My Team but haven't picked a favorite, surface the prompt instead.
  const showBadge = themeMode === "my_team";
  const badgeText = needsTeamForMyTeamMode ? "Pick team" : favoriteAbbr ? `${favoriteAbbr} Mode` : "My Team";

  return (
    <div className="flex items-center gap-1.5" data-testid="theme-toggle-wrapper">
      <button
        onClick={cycle}
        className="flex items-center justify-center w-8 h-8 rounded-lg bg-transparent hover:bg-muted/40 transition-colors opacity-60 hover:opacity-100"
        data-testid="button-theme-toggle"
        aria-label={label}
        title={label}
      >
        <Icon className={cn(
          "w-[18px] h-[18px]",
          themeMode === "my_team" ? "text-[var(--team-primary,#d4af37)]" : "text-foreground",
        )} />
      </button>
      {showBadge && (
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
            needsTeamForMyTeamMode
              ? "border-amber-500/40 text-amber-300 bg-amber-500/10"
              : "border-[var(--team-primary,#d4af37)]/50 text-[var(--team-primary,#d4af37)] bg-[var(--team-primary,#d4af37)]/10",
          )}
          data-testid="theme-team-badge"
        >
          {badgeText}
        </span>
      )}
    </div>
  );
}
