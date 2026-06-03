import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { SleeperUser, SleeperLeagueSummary } from "../types";
import { fetchSleeperUser, fetchSleeperLeagues } from "@/lib/sleeperApi";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/apiBase";
import { identify } from "@/lib/analytics";
import type { UserPreferences } from "@shared/schema";

const SC_TOKEN_KEY = "sc_auth_token";
/** Bearer header from the stored auth token (matches FavoriteTeamContext). */
function authBearerHeader(): Record<string, string> {
  try {
    const token = localStorage.getItem(SC_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

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
  const { sleeperInfo, readOnlySleeperUser, user: dcUser, isAuthenticatedUser } = useAuth();
  // Account-synced preferences live on the DC user. Held in refs so the
  // (deps: []) loaders/persisters can read the latest values without becoming
  // stale-closure traps or forcing re-creation. The account is the source of
  // truth when logged in — this is what survives a new deploy origin where the
  // per-origin localStorage is empty.
  const isAuthedRef = useRef(isAuthenticatedUser);
  isAuthedRef.current = isAuthenticatedUser;
  const accountPrefsRef = useRef<UserPreferences | undefined>(dcUser?.preferences);
  accountPrefsRef.current = dcUser?.preferences;

  // Best-effort merge-persist of preferences to the account (no-op for guests).
  const persistPrefs = useCallback((patch: Partial<UserPreferences>) => {
    if (!isAuthedRef.current) return;
    fetch(`${API_BASE}/api/sc-auth/me/preferences`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authBearerHeader() },
      body: JSON.stringify(patch),
    }).catch((err) => console.error("[sleeper] prefs persist failed:", err));
  }, []);

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

      // Attribute the current analytics session to this Sleeper user so the
      // usage log can tie page views / duration to a username (covers both the
      // read-only header connect and the authed connect flow).
      if (userData?.userId) {
        identify({ sleeperUserId: userData.userId, sleeperUsername: userData.username });
      }

      // Passive ADP enrichment removed — was saturating the DB connection pool.
      // ADP crawling is now manual-only via the admin panel.
      if (opts.triggerPassiveEnrich && userData?.userId) {
        toast({
          title: "Sleeper connected",
          description: `Loaded leagues for ${userData.username}.`,
        });
      }

      const leaguesData = await fetchSleeperLeagues(userData.userId, "2026");
      setAllLeagues(leaguesData);
      setLastSyncTime(new Date().toISOString());

      // Master-list preferences: the ACCOUNT wins when logged in (so they
      // survive a fresh deploy origin); otherwise fall back to localStorage.
      // On first login with no account value, seed the account from local.
      const authed = isAuthedRef.current;
      const acct = accountPrefsRef.current;
      let prefs: LeaguePrefs;
      if (authed && acct?.leaguePrefs) {
        prefs = {
          added: acct.leaguePrefs.added ?? [],
          removed: acct.leaguePrefs.removed ?? [],
        };
        writeLeaguePrefs(userData.userId, prefs); // mirror down for snappy reloads
      } else {
        prefs = readLeaguePrefs(userData.userId);
        if (authed) persistPrefs({ leaguePrefs: prefs }); // seed account from local
      }
      setLeaguePrefs(prefs);
      const included = leaguesData.filter((l) => isLeagueIncluded(l, prefs));

      // Restore the last-selected league: account value first (if still valid),
      // then the local per-user value, then a sensible default.
      const serverActive = authed ? acct?.activeLeagueId ?? null : null;
      const localActive = readPersistedLeague(userData.userId);
      let chosen: string | null = null;
      if (serverActive && included.some((l) => l.leagueId === serverActive)) {
        chosen = serverActive;
      } else if (localActive && included.some((l) => l.leagueId === localActive)) {
        chosen = localActive;
      } else if (included.length > 0) {
        chosen = included[0].leagueId; // avoid perma-empty league views on first load
      }
      setActiveLeagueId(chosen);
      writePersistedLeague(userData.userId, chosen);
      if (authed && chosen && chosen !== serverActive) persistPrefs({ activeLeagueId: chosen });
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
  }, [persistPrefs]);

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
      persistPrefs({ leaguePrefs: next }); // durable per-account save
      return next;
    });
  }, [allLeagues, user?.userId, persistPrefs]);

  const setActiveLeague = useCallback((leagueId: string) => {
    setActiveLeagueId(leagueId);
    if (user?.userId) writePersistedLeague(user.userId, leagueId);
    persistPrefs({ activeLeagueId: leagueId });
  }, [user?.userId, persistPrefs]);

  // Same as setActiveLeague but accepts null to clear (used by route handlers
  // that may not have a leagueId yet).
  const setActiveLeagueById = useCallback((leagueId: string | null) => {
    setActiveLeagueId(leagueId);
    if (user?.userId) writePersistedLeague(user.userId, leagueId);
    persistPrefs({ activeLeagueId: leagueId });
  }, [user?.userId, persistPrefs]);

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
    persistPrefs({ activeLeagueId: next });
  }, [leagues, activeLeagueId, allLeagues.length, user?.userId, persistPrefs]);

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
