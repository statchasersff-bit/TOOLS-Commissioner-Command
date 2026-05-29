/**
 * ThemeContext — owns the active theme mode and applies it to <html>.
 *
 * Three modes:
 *   - "light"    → no class on <html>            (StatChasers light palette)
 *   - "x-mode"   → .x-mode class                 (existing tactical theme)
 *   - "my_team"  → per-team theme. Dark-based teams (the default) apply
 *                  .dark + .my-team-mode + tinted CSS vars; light-based teams
 *                  (see getTeamThemeBase) render as standard light mode until
 *                  per-team accents are layered on. Arizona is light-based today.
 *
 * (The standalone deep-navy "dark" mode was removed; dark-based My Team modes
 * still ride on the .dark base palette for their team-tinted canvas.)
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
import { useAuthOptional } from "./AuthContext";
import { generateTeamTheme, validateTeamTheme, getTeamThemeBase } from "@/lib/themeColors";
import { API_BASE } from "@/lib/apiBase";

export type ThemeMode = "light" | "x-mode" | "my_team";

const THEME_KEY = "theme";
const SC_TOKEN_KEY = "sc_auth_token";
const VALID_MODES = new Set<ThemeMode>(["light", "x-mode", "my_team"]);

/** Bearer header from the stored auth token (matches FavoriteTeamContext). */
function authBearerHeader(): Record<string, string> {
  try {
    const token = localStorage.getItem(SC_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// Teams whose My Team theme is production-ready. The rest are temporarily gated
// off until their palettes are finished — only these abbreviations can use the
// "my_team" mode.
const MY_TEAM_READY_ABBRS = new Set<string>(["ARI"]);

export function isMyTeamThemeReady(abbr?: string | null): boolean {
  return !!abbr && MY_TEAM_READY_ABBRS.has(abbr);
}

function readInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "x-mode";
  try {
    const saved = localStorage.getItem(THEME_KEY);
    // The retired "dark" mode (and any other unknown value) falls through to
    // the x-mode default, migrating existing dark-mode users automatically.
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
  /** True when the current favorite team's My Team theme is ready to use
   *  (temporarily limited to Arizona). The UI gates the option on this. */
  myTeamReady: boolean;
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
  const myTeamReady = isMyTeamThemeReady(favoriteTeam?.abbreviation);

  // Account sync (optional — ThemeProvider also wraps the auth-less public
  // report view, so useAuthOptional may return null).
  const auth = useAuthOptional();
  const isAuthed = auth?.isAuthenticatedUser ?? false;
  const serverTheme = auth?.user?.preferences?.theme;
  // Keep the latest mode in a ref so the reconcile effect can seed the server
  // without taking themeMode as a dependency (which would re-run on every change).
  const themeModeRef = useRef(themeMode);
  themeModeRef.current = themeMode;

  // Best-effort persist of the theme to the account (no-op for guests).
  const persistTheme = useCallback((mode: ThemeMode) => {
    if (!isAuthed) return;
    fetch(`${API_BASE}/api/sc-auth/me/preferences`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authBearerHeader() },
      body: JSON.stringify({ theme: mode }),
    }).catch((err) => console.error("[Theme] persist failed:", err));
  }, [isAuthed]);

  // Reconcile with the account when /me arrives: a saved theme wins (this is
  // what survives a new deploy origin where localStorage is empty); if the
  // account has none yet, seed it from the current local mode.
  useEffect(() => {
    if (!isAuthed) return;
    if (serverTheme && VALID_MODES.has(serverTheme)) {
      setThemeModeState((cur) => (cur !== serverTheme ? serverTheme : cur));
    } else {
      persistTheme(themeModeRef.current);
    }
  }, [isAuthed, serverTheme, persistTheme]);

  // Track the last team we validated so we don't spam the console on every
  // render — only when the (mode, team) tuple actually changes.
  const lastValidatedRef = useRef<string | null>(null);

  // Apply mode classes + team tokens whenever mode or favorite team changes.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const isMyTeam = themeMode === "my_team";
    const teamReady = isMyTeam && favoriteTeam != null;
    // A team can build on the LIGHT base instead of the dark team-tinted one.
    // A light-based team renders exactly like standard light mode (until per-team
    // accents are added): we apply the light setup and skip the dark classes and
    // team tokens entirely. Dark-based teams keep the existing behavior.
    const lightTeam = teamReady && getTeamThemeBase(favoriteTeam?.abbreviation ?? "") === "light";
    const darkTeam = teamReady && !lightTeam;

    // Class toggles — dark-based my_team rides on the .dark base because most NFL
    // palettes read safer there (spec: "My Team Mode = dark team-tinted base").
    root.classList.toggle("dark", darkTeam);
    root.classList.toggle("x-mode", themeMode === "x-mode");
    root.classList.toggle("my-team-mode", darkTeam);
    root.setAttribute("data-theme", lightTeam ? "light" : darkTeam ? "my_team" : themeMode);

    // Light-based teams render on the light base but carry a data-team-theme hook
    // so per-team accents (e.g. Arizona's cardinal red) can override the brand
    // navy WITHOUT affecting plain light mode, which never has this attribute.
    if (lightTeam && favoriteTeam) root.setAttribute("data-team-theme", favoriteTeam.abbreviation);
    else root.removeAttribute("data-team-theme");

    // CSS variable application — only dark-based teams get tinted tokens. A
    // light-based team clears tokens so it's byte-for-byte standard light mode.
    if (darkTeam && favoriteTeam) {
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
    // Temporarily gate "My Team" to teams whose palette is ready (Arizona only).
    if (m === "my_team" && !isMyTeamThemeReady(favoriteTeam?.abbreviation)) return;
    setThemeModeState(m);
    persistTheme(m); // durable per-account save (localStorage is updated by the effect)
  }, [favoriteTeam, persistTheme]);

  // If the active mode is My Team but the favorite team isn't ready yet, fall
  // back to Dark so users never sit on an unfinished team theme.
  useEffect(() => {
    if (themeMode === "my_team" && !myTeamReady) setThemeModeState("x-mode");
  }, [themeMode, myTeamReady]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      setThemeMode,
      needsTeamForMyTeamMode: themeMode === "my_team" && favoriteTeam == null,
      myTeamReady,
    }),
    [themeMode, setThemeMode, favoriteTeam, myTeamReady],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
