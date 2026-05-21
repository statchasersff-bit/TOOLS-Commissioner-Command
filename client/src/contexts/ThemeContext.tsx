/**
 * ThemeContext — owns the active theme mode and applies it to <html>.
 *
 * Four modes:
 *   - "light"    → no class on <html>            (StatChasers light palette)
 *   - "dark"     → .dark class                   (existing dark palette)
 *   - "x-mode"   → .x-mode class                 (existing tactical theme)
 *   - "my_team"  → .dark + .my-team-mode class + per-team CSS variables
 *
 * "My Team Mode" sits on top of the dark base — most NFL color combinations
 * read more safely on a dark foundation, per the spec. When the user has no
 * favorite team selected the mode falls back to plain dark; a separate
 * `needsTeamForMyTeamMode` flag tells the UI to prompt for a team pick.
 *
 * Token application lives here (not in FavoriteTeamContext) so the theme
 * mode is the only writer of the shadcn `--background / --card / --foreground`
 * tokens — FavoriteTeamContext continues to manage the narrower
 * `--favorite-team-*` vars used by FavoriteTeamWidget / TeamLoader.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { useFavoriteTeam } from "./FavoriteTeamContext";
import { generateTeamTheme, validateTeamTheme } from "@/lib/themeColors";

export type ThemeMode = "light" | "dark" | "x-mode" | "my_team";

const THEME_KEY = "theme";
const VALID_MODES = new Set<ThemeMode>(["light", "dark", "x-mode", "my_team"]);

function readInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "x-mode";
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && VALID_MODES.has(saved as ThemeMode)) return saved as ThemeMode;
  } catch { /* localStorage unavailable — fall through */ }
  return "x-mode";
}

interface ThemeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  /** True when the user has picked "my_team" but no favorite team is set,
   *  so the UI can prompt them to pick one. */
  needsTeamForMyTeamMode: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

const ALL_TEAM_KEYS = [
  "--team-primary", "--team-secondary", "--team-accent",
  "--app-bg", "--app-surface", "--app-card", "--app-card-elevated",
  "--text-primary", "--text-secondary", "--text-muted",
  "--border-soft", "--border-strong",
  "--button-primary-bg", "--button-primary-text",
  "--button-secondary-bg", "--button-secondary-text",
  "--nav-bg", "--nav-active", "--tab-active",
  "--focus-ring", "--accent-gradient",
  "--background", "--foreground", "--border",
  "--card", "--card-foreground", "--card-border",
  "--popover", "--popover-foreground", "--popover-border",
  "--muted", "--muted-foreground",
  "--accent", "--accent-foreground",
  "--primary", "--primary-foreground",
  "--ring", "--input",
  "--sc-page-bg", "--sc-card-bg", "--sc-navy", "--sc-navy-soft",
  "--sc-text-primary", "--sc-text-secondary", "--sc-text-muted",
  "--sc-border", "--sc-border-strong",
  "--sc-nav-bg", "--sc-nav-bg-translucent",
  // --favorite-team-* tokens are owned by FavoriteTeamContext, not us.
];

function clearTeamTokens(root: HTMLElement) {
  for (const key of ALL_TEAM_KEYS) root.style.removeProperty(key);
}

function applyTeamTokens(root: HTMLElement, tokens: Record<string, string>) {
  for (const [key, value] of Object.entries(tokens)) {
    if (key.startsWith("--favorite-team-")) continue; // see ALL_TEAM_KEYS note
    root.style.setProperty(key, value);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readInitialMode);
  const { favoriteTeam } = useFavoriteTeam();

  // Track the last team we validated so we don't spam the console on every
  // render — only when the (mode, team) tuple actually changes.
  const lastValidatedRef = useRef<string | null>(null);

  // Apply mode classes + team tokens whenever mode or favorite team changes.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const isMyTeam = themeMode === "my_team";
    const teamReady = isMyTeam && favoriteTeam != null;

    // Class toggles — my_team rides on the dark base because most NFL
    // palettes read safer there (spec: "My Team Mode = dark team-tinted base").
    root.classList.toggle("dark", themeMode === "dark" || teamReady);
    root.classList.toggle("x-mode", themeMode === "x-mode");
    root.classList.toggle("my-team-mode", teamReady);
    root.setAttribute("data-theme", teamReady ? "my_team" : themeMode);

    // CSS variable application.
    if (teamReady && favoriteTeam) {
      const tokens = generateTeamTheme(favoriteTeam);
      applyTeamTokens(root, tokens as unknown as Record<string, string>);
      const key = `${themeMode}:${favoriteTeam.abbreviation}`;
      if (lastValidatedRef.current !== key) {
        validateTeamTheme(favoriteTeam);
        lastValidatedRef.current = key;
      }
    } else {
      clearTeamTokens(root);
      lastValidatedRef.current = null;
    }

    try { localStorage.setItem(THEME_KEY, themeMode); } catch { /* ignore */ }

    return () => {
      // No teardown — next effect run replaces classes / vars. The cleanup
      // would only run on unmount, where the document is going away anyway.
    };
  }, [themeMode, favoriteTeam]);

  const setThemeMode = useCallback((m: ThemeMode) => {
    if (!VALID_MODES.has(m)) return;
    setThemeModeState(m);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      setThemeMode,
      needsTeamForMyTeamMode: themeMode === "my_team" && favoriteTeam == null,
    }),
    [themeMode, setThemeMode, favoriteTeam],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
