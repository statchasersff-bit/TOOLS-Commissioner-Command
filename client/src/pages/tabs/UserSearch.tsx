import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2, AlertCircle, ChevronRight } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import { useManagerIntel } from "@/contexts/ManagerIntelContext";
import { fetchSleeperUser, type SleeperUser } from "@/lib/sleeperApi";
import { cn } from "@/lib/utils";

/**
 * User Search (Research ▸ User Search).
 *
 * Sleeper's public API only resolves a username by EXACT match
 * (`GET /user/{username}`), so this is a precise lookup rather than a fuzzy
 * search: the user types a Sleeper username, we resolve it, and surface a
 * selectable result card. Selecting a result opens that manager's profile
 * page via the global Manager Intel navigator (→ /managers/:userId).
 *
 * Self-contained — no league or login required, so it renders for guests too.
 */
export default function UserSearch() {
  const { openManagerIntel } = useManagerIntel();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SleeperUser | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const reqId = useRef(0);

  const lookup = useCallback(async (raw: string) => {
    const username = raw.trim();
    if (!username) {
      setResult(null);
      setStatus("idle");
      return;
    }
    const id = ++reqId.current;
    setStatus("loading");
    try {
      const user = await fetchSleeperUser(username);
      // Ignore stale responses if the query changed while we were fetching.
      if (id !== reqId.current) return;
      setResult(user);
      setStatus("idle");
    } catch {
      if (id !== reqId.current) return;
      setResult(null);
      setStatus("error");
    }
  }, []);

  // Debounce the lookup as the user types.
  useEffect(() => {
    const handle = setTimeout(() => lookup(query), 350);
    return () => clearTimeout(handle);
  }, [query, lookup]);

  const select = (user: SleeperUser) => {
    openManagerIntel({
      userId: user.userId,
      username: user.username,
      avatar: user.avatar,
    });
  };

  const trimmed = query.trim();

  return (
    <div className="space-y-6">
      <SectionHeader
        title="User Search"
        subtitle="Look up any Sleeper username and open their profile"
      />

      <div className="max-w-xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && result) select(result);
            }}
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Enter a Sleeper username…"
            data-testid="input-user-search"
            className={cn(
              "w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-10",
              "text-sm outline-none transition-colors placeholder:text-muted-foreground",
              "focus:border-[#d4af37]/40 focus:bg-white/[0.06]",
            )}
          />
          {status === "loading" && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
          )}
        </div>

        <div className="mt-4">
          {result && (
            <button
              type="button"
              onClick={() => select(result)}
              data-testid={`user-search-result-${result.username}`}
              className={cn(
                "group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left",
                "transition-all duration-150 hover:border-[#d4af37]/40 hover:bg-white/[0.06]",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#d4af37]/60",
              )}
            >
              <SleeperUserAvatar username={result.displayName} avatar={result.avatar} size="md" compact />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{result.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">@{result.username}</p>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          )}

          {status === "error" && trimmed && (
            <div
              className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300"
              data-testid="user-search-not-found"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>
                No Sleeper user found for <span className="font-semibold">"{trimmed}"</span>. Usernames must match exactly.
              </span>
            </div>
          )}

          {status === "idle" && !result && !trimmed && (
            <p className="text-xs text-muted-foreground">
              Sleeper usernames are matched exactly — type the full username to find a manager.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
