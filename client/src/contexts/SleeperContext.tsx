import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { SleeperUser, SleeperLeagueSummary } from "../types";
import { fetchSleeperUser, fetchSleeperLeagues } from "@/lib/sleeperApi";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/apiBase";

// IMPORTANT: there is intentionally no localStorage key for the Sleeper
// connection. The connection is derived from useAuth().sleeperInfo, which is
// itself driven by the server-canonical /api/sc-auth/me response. Auto-loading
// a username from localStorage caused a critical account-isolation bug where
// DC user B inherited DC user A's Sleeper @username.

// activeLeagueId IS persisted, but scoped to the sleeper userId so accounts
// can't inherit each other's selection. Key shape: sc-active-league:<userId>.
const ACTIVE_LEAGUE_KEY_PREFIX = "sc-active-league:";
function activeLeagueKey(userId: string) { return `${ACTIVE_LEAGUE_KEY_PREFIX}${userId}`; }
function readPersistedLeague(userId: string): string | null {
  try { return localStorage.getItem(activeLeagueKey(userId)); } catch { return null; }
}
function writePersistedLeague(userId: string, leagueId: string | null) {
  try {
    if (leagueId) localStorage.setItem(activeLeagueKey(userId), leagueId);
    else localStorage.removeItem(activeLeagueKey(userId));
  } catch { /* ignore */ }
}

// Master-list preferences: which leagues the user has manually opted into or
// out of, relative to the automatic filter. We persist a DELTA (not the full
// included set) so that newly-eligible leagues (e.g. a startup that just got
// drafted) auto-appear, while the user's explicit choices are preserved:
//   included(lg) = lg.eligibleByDefault ? !removed.has(id) : added.has(id)
// Scoped per-user, same as the active-league key, to avoid cross-account leak.
export interface LeaguePrefs { added: string[]; removed: string[] }
const EMPTY_LEAGUE_PREFS: LeaguePrefs = { added: [], removed: [] };
const LEAGUE_PREFS_KEY_PREFIX = "sc-league-prefs:";
function leaguePrefsKey(userId: string) { return `${LEAGUE_PREFS_KEY_PREFIX}${userId}`; }
function readLeaguePrefs(userId: string): LeaguePrefs {
  try {
    const raw = localStorage.getItem(leaguePrefsKey(userId));
    if (!raw) return EMPTY_LEAGUE_PREFS;
    const parsed = JSON.parse(raw);
    return {
      added: Array.isArray(parsed?.added) ? parsed.added.filter((x: unknown): x is string => typeof x === "string") : [],
      removed: Array.isArray(parsed?.removed) ? parsed.removed.filter((x: unknown): x is string => typeof x === "string") : [],
    };
  } catch { return EMPTY_LEAGUE_PREFS; }
}
function writeLeaguePrefs(userId: string, prefs: LeaguePrefs) {
  try { localStorage.setItem(leaguePrefsKey(userId), JSON.stringify(prefs)); } catch { /* ignore */ }
}
function isLeagueIncluded(lg: SleeperLeagueSummary, prefs: LeaguePrefs): boolean {
  return lg.eligibleByDefault
    ? !prefs.removed.includes(lg.leagueId)
    : prefs.added.includes(lg.leagueId);
}

interface SleeperState {
  isConnected: boolean;
  user: SleeperUser | null;
  /** The master list — leagues the user has included, consumed app-wide. */
  leagues: SleeperLeagueSummary[];
  /** Every dynasty league we found, including ones filtered out by default. */
  allLeagues: SleeperLeagueSummary[];
  /** IDs currently in the master list (derived from allLeagues + prefs). */
  includedLeagueIds: string[];
  activeLeagueId: string | null;
  activeLeague: SleeperLeagueSummary | null;
  isLoading: boolean;
  error: string | null;
  lastSyncTime: string | null;
  connect: (username: string) => Promise<void>;
  disconnect: () => void;
  setActiveLeague: (leagueId: string) => void;
  setActiveLeagueById: (leagueId: string | null) => void;
  /** Opt a league into / out of the master list (persisted per-user). */
  setLeagueIncluded: (leagueId: string, included: boolean) => void;
  refresh: () => Promise<void>;
}

const SleeperContext = createContext<SleeperState | null>(null);

export function SleeperProvider({ children }: { children: React.ReactNode }) {
  const { sleeperInfo, readOnlySleeperUser } = useAuth();
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [allLeagues, setAllLeagues] = useState<SleeperLeagueSummary[]>([]);
  const [leaguePrefs, setLeaguePrefs] = useState<LeaguePrefs>(EMPTY_LEAGUE_PREFS);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

  // The master list the rest of the app consumes — allLeagues minus the ones
  // filtered out by default, plus any the user manually opted in.
  const leagues = useMemo(
    () => allLeagues.filter((lg) => isLeagueIncluded(lg, leaguePrefs)),
    [allLeagues, leaguePrefs]
  );
  const includedLeagueIds = useMemo(() => leagues.map((l) => l.leagueId), [leagues]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  // Track which username we've already auto-loaded leagues for, scoped to the
  // current sleeperInfo identity. Reset whenever the linked Sleeper changes.
  const lastAutoLoadedUsernameRef = useRef<string | null>(null);

  const isConnected = user !== null;

  const fetchUserAndLeagues = useCallback(async (
    username: string,
    opts: { preserveStubOnError?: boolean; stub?: SleeperUser | null; triggerPassiveEnrich?: boolean } = {}
  ) => {
    setIsLoading(true);
    setError(null);
    // Show the stub immediately so UI flips to "connected" while the network call runs.
    if (opts.stub) setUser(opts.stub);

    try {
      const userData = await fetchSleeperUser(username);
      setUser(userData);

      // Fire the passive ADP enrichment POST on explicit read-only connects
      // (i.e. the user typed a username in the header). The auth-flow path
      // already kicks off enqueueSleeperUser server-side via
      // /api/sc-auth/connect-sleeper, so we skip on those (callers omit the
      // flag). Cooldown enforcement lives on the server, so repeat connects
      // within 7 days are a no-op there too — but we still surface the toast
      // so users get the same affordance every time.
      if (opts.triggerPassiveEnrich && userData?.userId) {
        void fetch(`${API_BASE}/api/adp/passive-enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sleeperUserId: userData.userId,
            sleeperUsername: userData.username,
          }),
        }).catch((err) => {
          // Never surface — enrichment is best-effort background work.
          console.warn("[sleeper] passive-enrich post failed:", err?.message);
        });
        toast({
          title: "Sleeper connected",
          description:
            "We'll scan eligible dynasty drafts in the background to improve ADP.",
        });
      }

      const leaguesData = await fetchSleeperLeagues(userData.userId, "2026");
      setAllLeagues(leaguesData);
      setLastSyncTime(new Date().toISOString());

      // Load the user's master-list preferences and compute the included set
      // (the leagues that actually surface across the app).
      const prefs = readLeaguePrefs(userData.userId);
      setLeaguePrefs(prefs);
      const included = leaguesData.filter((l) => isLeagueIncluded(l, prefs));

      // Restore the user's last-selected league (per-user, never cross-account).
      const persisted = readPersistedLeague(userData.userId);
      if (persisted && included.some((l) => l.leagueId === persisted)) {
        setActiveLeagueId(persisted);
      } else if (included.length > 0) {
        // Sensible default so league-specific views aren't perma-empty on first load.
        const fallback = included[0].leagueId;
        setActiveLeagueId(fallback);
        writePersistedLeague(userData.userId, fallback);
      } else {
        setActiveLeagueId(null);
      }
    } catch (err: any) {
      setError(err.message || "Connection failed");
      // When auth-derived, keep the stub user so the UI stays in "connected" state
      // and a transient network blip doesn't kick the user back to the connect form.
      if (!opts.preserveStubOnError) {
        setUser(null);
        setAllLeagues([]);
        setLeaguePrefs(EMPTY_LEAGUE_PREFS);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const connect = useCallback(async (username: string) => {
    await fetchUserAndLeagues(username, { triggerPassiveEnrich: true });
  }, [fetchUserAndLeagues]);

  const disconnect = useCallback(() => {
    setUser(null);
    setAllLeagues([]);
    setLeaguePrefs(EMPTY_LEAGUE_PREFS);
    setActiveLeagueId(null);
    setError(null);
    setLastSyncTime(null);
    lastAutoLoadedUsernameRef.current = null;
  }, []);

  // Opt a league into / out of the master list. Persists a delta from the
  // automatic filter (see LeaguePrefs) so newly-eligible leagues still appear.
  const setLeagueIncluded = useCallback((leagueId: string, included: boolean) => {
    const lg = allLeagues.find((l) => l.leagueId === leagueId);
    if (!lg) return;
    setLeaguePrefs((prev) => {
      const addId = (list: string[]) => (list.includes(leagueId) ? list : [...list, leagueId]);
      const dropId = (list: string[]) => list.filter((id) => id !== leagueId);
      let added = prev.added;
      let removed = prev.removed;
      if (included) {
        if (lg.eligibleByDefault) removed = dropId(removed);
        else added = addId(added);
      } else {
        if (lg.eligibleByDefault) removed = addId(removed);
        else added = dropId(added);
      }
      const next: LeaguePrefs = { added, removed };
      if (user?.userId) writeLeaguePrefs(user.userId, next);
      return next;
    });
  }, [allLeagues, user?.userId]);

  const setActiveLeague = useCallback((leagueId: string) => {
    setActiveLeagueId(leagueId);
    if (user?.userId) writePersistedLeague(user.userId, leagueId);
  }, [user?.userId]);

  // Same as setActiveLeague but accepts null to clear (used by route handlers
  // that may not have a leagueId yet).
  const setActiveLeagueById = useCallback((leagueId: string | null) => {
    setActiveLeagueId(leagueId);
    if (user?.userId) writePersistedLeague(user.userId, leagueId);
  }, [user?.userId]);

  const activeLeague = useMemo(
    () => leagues.find((l) => l.leagueId === activeLeagueId) ?? null,
    [leagues, activeLeagueId]
  );

  // Keep the active league valid as the master list changes — e.g. the user
  // unchecks the currently-active league in Settings → Leagues. Fall back to
  // the first included league, or null when none remain.
  useEffect(() => {
    if (allLeagues.length === 0) return; // not loaded yet — don't clobber
    const stillValid = activeLeagueId != null && leagues.some((l) => l.leagueId === activeLeagueId);
    if (stillValid) return;
    const next = leagues.length > 0 ? leagues[0].leagueId : null;
    if (next === activeLeagueId) return;
    setActiveLeagueId(next);
    if (user?.userId) writePersistedLeague(user.userId, next);
  }, [leagues, activeLeagueId, allLeagues.length, user?.userId]);

  const refresh = useCallback(async () => {
    if (!user) return;
    await fetchUserAndLeagues(user.username);
  }, [user, fetchUserAndLeagues]);

  // ── Connection source of truth ────────────────────────────────────────────
  // Prefer the DC-server-linked Sleeper (full mode), fall back to the
  // read-only Sleeper identity. Both paths use the same public read
  // endpoints to load leagues — the only difference is whether an auth
  // token is available for downstream action mutations.
  //
  // Account-isolation: when DC is logged in, sleeperInfo is canonical. When
  // not, readOnlySleeperUser is used. AuthContext is responsible for
  // reconciling the two on sign-in (read-only is cleared if it conflicts).
  useEffect(() => {
    const linkedUsername = sleeperInfo?.username ?? readOnlySleeperUser?.username ?? null;
    const linkedUserId = sleeperInfo?.userId ?? readOnlySleeperUser?.userId ?? null;
    if (!linkedUsername) {
      setUser(null);
      setAllLeagues([]);
      setLeaguePrefs(EMPTY_LEAGUE_PREFS);
      setActiveLeagueId(null);
      setError(null);
      setLastSyncTime(null);
      lastAutoLoadedUsernameRef.current = null;
      return;
    }
    if (lastAutoLoadedUsernameRef.current === linkedUsername) return;
    lastAutoLoadedUsernameRef.current = linkedUsername;
    // eslint-disable-next-line no-console
    console.info(
      "[sleeper] loading leagues for Sleeper user:",
      linkedUsername,
      "(sleeper_user_id:", linkedUserId ?? "(none)",
      "source:", sleeperInfo?.username ? "auth-context" : "read-only",
      ")"
    );
    fetchUserAndLeagues(linkedUsername);
  }, [sleeperInfo?.username, sleeperInfo?.userId, readOnlySleeperUser?.username, readOnlySleeperUser?.userId, fetchUserAndLeagues]);

  return (
    <SleeperContext.Provider
      value={{
        isConnected,
        user,
        leagues,
        allLeagues,
        includedLeagueIds,
        activeLeagueId,
        activeLeague,
        isLoading,
        error,
        lastSyncTime,
        connect,
        disconnect,
        setActiveLeague,
        setActiveLeagueById,
        setLeagueIncluded,
        refresh,
      }}
    >
      {children}
    </SleeperContext.Provider>
  );
}

export function useSleeper(): SleeperState {
  const ctx = useContext(SleeperContext);
  if (!ctx) throw new Error("useSleeper must be used within SleeperProvider");
  return ctx;
}
