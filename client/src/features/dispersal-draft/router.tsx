/**
 * Minimal wouter-compatible router scoped to the Dispersal Draft tab.
 *
 * The host app routes everything through `/:tab/:sub`, so the dispersal
 * feature's internal multi-"page" flow (home → create → :code/setup → :code)
 * can't use real nested URL routes. This shim drives that flow with internal
 * state, persisted to the page URL's `?dd=<path>` query param so refreshes and
 * shared deep links land back in the right place without leaving the tab.
 *
 * The ported pages import { useLocation, useParams, useSearch, Link } from
 * here instead of from "wouter".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface NavState {
  /** Internal path, e.g. "/", "/create", "/ABC-123/setup". */
  path: string;
  /** Search string without leading "?". */
  search: string;
  navigate: (to: string) => void;
}

const NavContext = createContext<NavState | null>(null);

const QUERY_KEY = "dd";

function readInitialPath(): string {
  if (typeof window === "undefined") return "/";
  const sp = new URLSearchParams(window.location.search);
  return sp.get(QUERY_KEY) || "/";
}

function splitPathSearch(to: string): { path: string; search: string } {
  const qIdx = to.indexOf("?");
  if (qIdx === -1) return { path: to || "/", search: "" };
  return { path: to.slice(0, qIdx) || "/", search: to.slice(qIdx + 1) };
}

/** Persist the dispersal path to the real URL's `?dd=` param (no reload). */
function syncUrl(path: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (path && path !== "/") url.searchParams.set(QUERY_KEY, path);
  else url.searchParams.delete(QUERY_KEY);
  window.history.replaceState(window.history.state, "", url.toString());
}

export function DispersalRouterProvider({ children }: { children: ReactNode }) {
  const initial = readInitialPath();
  const [{ path, search }, setState] = useState(() => splitPathSearch(initial));

  const navigate = useCallback((to: string) => {
    const next = splitPathSearch(to);
    setState(next);
    syncUrl(next.path);
  }, []);

  // Keep the URL in sync if we mounted with an internal path already set.
  useEffect(() => { syncUrl(path); /* eslint-disable-next-line */ }, []);

  const value = useMemo<NavState>(() => ({ path, search, navigate }), [path, search, navigate]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("Dispersal router used outside DispersalRouterProvider");
  return ctx;
}

/** wouter-compatible: returns [location, navigate]. */
export function useLocation(): [string, (to: string) => void] {
  const { path, navigate } = useNav();
  return [path, navigate];
}

/** wouter-compatible: the current search string (without "?"). */
export function useSearch(): string {
  return useNav().search;
}

/** wouter-compatible-ish: parse `:code` (first path segment) from the path. */
export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const { path } = useNav();
  const segments = path.split("/").filter(Boolean);
  const first = segments[0];
  const code = first && first !== "create" ? decodeURIComponent(first) : undefined;
  return { code } as unknown as T;
}

/** wouter-compatible Link — navigates internally instead of changing the route. */
export function Link({
  href,
  to,
  children,
  onClick,
  ...rest
}: {
  href?: string;
  to?: string;
  children?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const { navigate } = useNav();
  const target = href ?? to ?? "/";
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
        navigate(target);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/** Current dispersal "page" derived from the internal path. */
export type DispersalView =
  | { name: "home" }
  | { name: "create" }
  | { name: "setup"; code: string }
  | { name: "room"; code: string };

export function useDispersalView(): DispersalView {
  const { path } = useNav();
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { name: "home" };
  if (segments[0] === "create") return { name: "create" };
  const code = decodeURIComponent(segments[0]);
  if (segments[1] === "setup") return { name: "setup", code };
  return { name: "room", code };
}
