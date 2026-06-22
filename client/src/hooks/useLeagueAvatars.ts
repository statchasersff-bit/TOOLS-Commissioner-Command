import { useQuery } from "@tanstack/react-query";
import { fetchLeagueRosterIdentities, type RosterIdentity } from "@/lib/sleeperApi";

/**
 * Owner avatar map for a league (rosterId → avatar hash + name), pulled straight
 * from Sleeper's users + rosters endpoints. Cached for 5 minutes so multiple
 * sub-tabs of the same league view share a single fetch. Returns an empty map
 * until loaded (or when no league is selected), so callers can render the
 * initials-circle fallback meanwhile.
 *
 * The avatar value is a Sleeper avatar HASH — pass it straight to
 * SleeperUserAvatar, which composes the thumbnail URL.
 */
export function useLeagueAvatars(leagueId: string): Record<number, RosterIdentity> {
  const { data } = useQuery({
    queryKey: ["league-roster-identities", leagueId],
    queryFn: () => fetchLeagueRosterIdentities(leagueId),
    enabled: !!leagueId,
    staleTime: 5 * 60 * 1000,
  });
  return data ?? {};
}
