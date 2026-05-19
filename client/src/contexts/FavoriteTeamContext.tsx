import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE } from "@/lib/apiBase";
import { getFavoriteTeamTheme, isValidNflTeamAbbr, type NflTeam } from "@/config/nflTeams";

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "dc_favorite_nfl_team";

function readCache(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && isValidNflTeamAbbr(v) ? v.toUpperCase() : null;
  } catch {
    return null;
  }
}

function writeCache(abbr: string | null) {
  try {
    if (abbr) localStorage.setItem(STORAGE_KEY, abbr.toUpperCase());
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode etc. — ignore */ }
}

// ─── CSS variable sync ────────────────────────────────────────────────────────
// We set/clear --favorite-team-* on <html> so any component (header, greeting,
// badges) can opt in via `var(--favorite-team-primary)`. Fallbacks are
// declared in index.css so removing the vars cleanly reverts to defaults.

function applyTeamCssVars(team: NflTeam | null) {
  const root = document.documentElement;
  if (!team) {
    root.style.removeProperty("--favorite-team-primary");
    root.style.removeProperty("--favorite-team-secondary");
    root.style.removeProperty("--favorite-team-accent");
    root.removeAttribute("data-favorite-team");
    return;
  }
  root.style.setProperty("--favorite-team-primary", team.primaryColor);
  root.style.setProperty("--favorite-team-secondary", team.secondaryColor);
  // Accent = primary with a subtle alpha shadow, suitable for borders.
  root.style.setProperty("--favorite-team-accent", `${team.primaryColor}55`);
  root.setAttribute("data-favorite-team", team.abbreviation);
}

// ─── Context shape ────────────────────────────────────────────────────────────

interface FavoriteTeamContextValue {
  /** Current favorite (full team config) or null if none picked. */
  favoriteTeam: NflTeam | null;
  /** Raw abbreviation, useful for badges. */
  favoriteAbbr: string | null;
  /** True while a server save is in-flight (so UI can show a spinner). */
  saving: boolean;
  /** Server save error from the most recent operation, if any. */
  error: string | null;
  /** Save a new favorite. Optimistic local update + best-effort server PUT. */
  setFavoriteTeam: (abbr: string) => Promise<void>;
  /** Clear the favorite. Same dual-write semantics. */
  clearFavoriteTeam: () => Promise<void>;
}

const FavoriteTeamContext = createContext<FavoriteTeamContextValue | null>(null);

export function useFavoriteTeam(): FavoriteTeamContextValue {
  const ctx = useContext(FavoriteTeamContext);
  if (!ctx) throw new Error("useFavoriteTeam must be used within FavoriteTeamProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function FavoriteTeamProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticatedUser } = useAuth();

  // Initialize synchronously from localStorage so the greeting doesn't flash
  // the default for a frame on every page load.
  const [favoriteAbbr, setFavoriteAbbrState] = useState<string | null>(() => readCache());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the authenticated user's record arrives via /me, prefer the server's
  // value and reconcile localStorage. This handles "I logged in on a new
  // device" without a separate fetch.
  useEffect(() => {
    if (!isAuthenticatedUser || !user) return;
    const serverFav = user.favoriteNflTeam && isValidNflTeamAbbr(user.favoriteNflTeam)
      ? user.favoriteNflTeam.toUpperCase()
      : null;
    if (serverFav !== favoriteAbbr) {
      setFavoriteAbbrState(serverFav);
      writeCache(serverFav);
    }
    // We intentionally don't depend on favoriteAbbr here — that would loop
    // when this effect writes back its own update. We only want to react to
    // the server-supplied value changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticatedUser, user?.favoriteNflTeam]);

  // Keep CSS vars synced. Single source of truth — only this provider writes.
  const favoriteTeam = useMemo(() => getFavoriteTeamTheme(favoriteAbbr), [favoriteAbbr]);
  useEffect(() => {
    applyTeamCssVars(favoriteTeam);
    return () => { applyTeamCssVars(null); };
  }, [favoriteTeam]);

  const persist = useCallback(async (next: string | null) => {
    // Local first — UI updates immediately.
    setFavoriteAbbrState(next);
    writeCache(next);
    if (!isAuthenticatedUser) return; // localStorage-only mode

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sc-auth/me/favorite-team`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favoriteNflTeam: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
    } catch (err: any) {
      console.error("[FavoriteTeam] persist failed:", err);
      setError(err?.message || "Failed to save favorite team.");
      // We don't roll back the local update — the user's UI keeps showing
      // their choice and we'll retry on the next save. This avoids the
      // "set it, see it flash back" jank if the network is flaky.
    } finally {
      setSaving(false);
    }
  }, [isAuthenticatedUser]);

  const setFavoriteTeam = useCallback(async (abbr: string) => {
    const normalized = abbr.toUpperCase();
    if (!isValidNflTeamAbbr(normalized)) {
      setError(`Unknown NFL team abbreviation: ${abbr}`);
      return;
    }
    await persist(normalized);
  }, [persist]);

  const clearFavoriteTeam = useCallback(async () => {
    await persist(null);
  }, [persist]);

  const value: FavoriteTeamContextValue = useMemo(
    () => ({ favoriteTeam, favoriteAbbr, saving, error, setFavoriteTeam, clearFavoriteTeam }),
    [favoriteTeam, favoriteAbbr, saving, error, setFavoriteTeam, clearFavoriteTeam],
  );

  return <FavoriteTeamContext.Provider value={value}>{children}</FavoriteTeamContext.Provider>;
}
