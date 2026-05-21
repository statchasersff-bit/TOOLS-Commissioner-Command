import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE } from "@/lib/apiBase";
import { getFavoriteTeamTheme, isValidNflTeamAbbr, type NflTeam } from "@/config/nflTeams";

const SC_TOKEN_KEY = "sc_auth_token";

/** Mirror of AuthContext's bearer-header helper. We can't import from AuthContext
 *  here because it would create a circular dependency (AuthContext loads first),
 *  so we read the token directly from localStorage using the same key. */
function authBearerHeader(): Record<string, string> {
  try {
    const token = localStorage.getItem(SC_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

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

  // When the authenticated user's record arrives via /me, reconcile against
  // the cached local value:
  //
  //   - server has a value         → adopt it (handles "logged in on new device")
  //   - server null, local has one → push the local value up to the server
  //                                  (handles "guest picked a team, then made
  //                                  an account" — without this we'd overwrite
  //                                  their pick with null and they'd lose it)
  //   - both null                  → no-op
  useEffect(() => {
    if (!isAuthenticatedUser || !user) return;
    const serverFav = user.favoriteNflTeam && isValidNflTeamAbbr(user.favoriteNflTeam)
      ? user.favoriteNflTeam.toUpperCase()
      : null;
    if (serverFav) {
      if (serverFav !== favoriteAbbr) {
        setFavoriteAbbrState(serverFav);
        writeCache(serverFav);
      }
      return;
    }
    // Server has no favorite. If the user has one locally (e.g. they picked
    // it pre-login), persist that up rather than wiping the local cache.
    const localFav = readCache();
    if (localFav) {
      void persist(localFav);
    }
    // We intentionally don't depend on favoriteAbbr / persist here — they'd
    // loop when this effect writes back its own update. We only want to
    // react to the server-supplied value (or login state) changing.
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
        // The server accepts either a session cookie or a Bearer token.
        // /me sends both, but earlier versions of this call sent only
        // credentials — when the session cookie wasn't available (cross-
        // origin SameSite restrictions, etc.) the PUT 401'd silently, the
        // server never stored the favorite, and the next /me returned null
        // → the FavoriteTeam effect below then overwrote localStorage with
        // null, making it look like the favorite "forgot itself" between
        // visits. Sending the Bearer token matches every other authenticated
        // write in the app.
        headers: {
          "Content-Type": "application/json",
          ...authBearerHeader(),
        },
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
