import { useState, useRef, useEffect } from "react";
import { useImportAssetsFromCsv, getListAssetsQueryKey, getGetDraftRoomQueryKey } from "@dispersal/api";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useSleeper } from "@/contexts/SleeperContext";

// ── Sleeper API Types ──────────────────────────────────────────────────────────

interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
  commissioner_id?: string;
  avatar?: string | null;
  orphanCount?: number;
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
}

interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  metadata: { team_name?: string };
}

interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

interface SleeperPlayer {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
}

interface OrphanTeam {
  rosterId: number;
  teamName: string;
  playerCount: number;
  players: string[];
  isDetectedOrphan: boolean;
  ownerUsername: string | null;
}

// ── Sleeper API Helpers ────────────────────────────────────────────────────────

const SLEEPER = "https://api.sleeper.app/v1";

async function sleeperGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER}${path}`);
  if (!res.ok) throw new Error(`Sleeper API error ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

// In-memory cache for the large players dictionary
let playersCache: Record<string, SleeperPlayer> | null = null;

async function fetchPlayers(): Promise<Record<string, SleeperPlayer>> {
  if (playersCache) return playersCache;
  const data = await sleeperGet<Record<string, SleeperPlayer>>("/players/nfl");
  playersCache = data;
  return data;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface SleeperImportProps {
  roomId: number;
  shareCode: string;
  commissionerToken: string;
  commissionerParticipantId?: number;
  onLeagueDetected?: (data: { leagueName: string; commissionerName: string; numOrphanSlots: number }) => void;
  onStepChange?: (step: string) => void;
  onImportComplete?: () => void;
}

type Step = "username" | "leagues" | "orphans" | "importing";

export default function SleeperImport({ roomId, shareCode, commissionerToken, commissionerParticipantId, onLeagueDetected, onStepChange, onImportComplete }: SleeperImportProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const importCsv = useImportAssetsFromCsv();

  // The commissioner is already connected to Sleeper in the main app, so reuse
  // that account: prefill the username and auto-run the lookup instead of making
  // them retype it. Falls back to manual entry if no one is connected.
  const { user: appSleeperUser } = useSleeper();
  const accountUsername = appSleeperUser?.username ?? "";
  const autoLookupTried = useRef(false);

  const [step, setStep] = useState<Step>("username");

  useEffect(() => {
    onStepChange?.(step);
  }, [step]);

  // Once the connected Sleeper account resolves, drop it into the field and run
  // the lookup automatically (one time, only while still on the username step).
  useEffect(() => {
    if (autoLookupTried.current) return;
    if (!accountUsername || step !== "username") return;
    autoLookupTried.current = true;
    setUsername(accountUsername);
    handleLookup(accountUsername);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountUsername, step]);

  const [username, setUsername] = useState(accountUsername);
  const season = (() => {
    const now = new Date();
    return now.getMonth() >= 2 ? String(now.getFullYear()) : String(now.getFullYear() - 1);
  })();
  const [sleeperUser, setSleeperUser] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [leagueSearch, setLeagueSearch] = useState("");
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [selectedLeagueName, setSelectedLeagueName] = useState("");
  const [orphanTeams, setOrphanTeams] = useState<OrphanTeam[]>([]);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<number>>(new Set());
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [scanningLeagues, setScanningLeagues] = useState(false);
  const [loadingOrphans, setLoadingOrphans] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [rosterToName, setRosterToName] = useState<Map<number, string>>(new Map());

  // ── Step 1: lookup user and their leagues ──────────────────────────────────

  const handleLookup = async (overrideUsername?: string) => {
    const lookupName = (typeof overrideUsername === "string" ? overrideUsername : username).trim();
    if (!lookupName) return;
    setLoadingLeagues(true);
    setScanningLeagues(false);
    try {
      const user = await sleeperGet<SleeperUser>(`/user/${lookupName.toLowerCase()}`);
      if (!user?.user_id) throw new Error("User not found");
      setSleeperUser(user);

      // Persist Sleeper avatar on the commissioner participant (fire-and-forget)
      if (commissionerParticipantId && user.avatar) {
        fetch(`/api/draft-rooms/${roomId}/participants/${commissionerParticipantId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commissionerToken, sleeperAvatarId: user.avatar }),
        }).catch(() => { /* non-critical */ });
      }

      // Rule 5: season fallback — if current season returns 0 leagues, try previous year
      let fetchSeason = season;
      let leagueList = await sleeperGet<SleeperLeague[]>(
        `/user/${user.user_id}/leagues/nfl/${fetchSeason}`
      );
      if (!leagueList || leagueList.length === 0) {
        fetchSeason = String(parseInt(season, 10) - 1);
        leagueList = await sleeperGet<SleeperLeague[]>(
          `/user/${user.user_id}/leagues/nfl/${fetchSeason}`
        );
      }

      setScanningLeagues(true);

      const results = await Promise.allSettled(
        (leagueList ?? []).map(async (l) => {
          const [rosters, users] = await Promise.all([
            sleeperGet<SleeperRoster[]>(`/league/${l.league_id}/rosters`),
            sleeperGet<SleeperLeagueUser[]>(`/league/${l.league_id}/users`),
          ]);

          // Rule 4: user must be commissioner OR own at least one roster in this league
          const isCommissioner = l.commissioner_id === user.user_id;
          const isOwner = rosters.some((r) => String(r.owner_id) === String(user.user_id));
          if (!isCommissioner && !isOwner) return null;

          const userMap = new Map(users.map((u) => [String(u.user_id), u]));

          // Rule 1: a roster counts as a stocked orphan only if owner is null AND ≥5 players
          const stockedNullOwners = rosters.filter(
            (r) => (!r.owner_id || !userMap.has(String(r.owner_id))) && (r.players?.length ?? 0) >= 5
          );

          // Rule 2: skip leagues where stocked orphan count exceeds active-member count
          // (catches externally-managed leagues with very few real Sleeper accounts)
          const realMemberOwned = rosters.filter(
            (r) => r.owner_id && userMap.has(String(r.owner_id))
          );
          if (stockedNullOwners.length > realMemberOwned.length) return null;

          const count = stockedNullOwners.length;
          if (count < 2) return null;

          return { league: l, orphanCount: count };
        })
      );

      type ScanResult = { league: SleeperLeague; orphanCount: number };
      const withOrphans = results
        .filter(
          (r): r is PromiseFulfilledResult<ScanResult> =>
            r.status === "fulfilled" && r.value !== null && (r.value as ScanResult).orphanCount > 0
        )
        .map((r) => ({ ...(r.value as ScanResult).league, orphanCount: (r.value as ScanResult).orphanCount }));

      setLeagues(withOrphans);
      setStep("leagues");
    } catch (err: unknown) {
      toast({
        title: "Sleeper Lookup Failed",
        description: err instanceof Error ? err.message : "Could not find that username",
        variant: "destructive",
      });
    } finally {
      setLoadingLeagues(false);
      setScanningLeagues(false);
    }
  };

  // ── Step 2: detect orphan teams in selected league ─────────────────────────

  const handleDetectOrphans = async (leagueId: string, leagueName: string) => {
    setSelectedLeagueId(leagueId);
    setSelectedLeagueName(leagueName);
    setLeagueSearch("");
    setLoadingOrphans(true);
    setOrphanTeams([]);
    try {
      const [rosters, users] = await Promise.all([
        sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
        sleeperGet<SleeperLeagueUser[]>(`/league/${leagueId}/users`),
      ]);

      const userMap = new Map(users.map((u) => [String(u.user_id), u]));

      // Build a full rosterId → Sleeper username map for all rosters (used for traded pick labels)
      const nameMap = new Map<number, string>();
      for (const r of rosters) {
        const owner = r.owner_id ? userMap.get(String(r.owner_id)) : undefined;
        const name = owner?.display_name ?? null;
        if (name) nameMap.set(r.roster_id, name);
      }
      setRosterToName(nameMap);

      // Only show rosters with no owner or whose owner is not in the league's active user list.
      const orphans: OrphanTeam[] = rosters
        .filter((r) => !r.owner_id || !userMap.has(String(r.owner_id)))
        .map((r) => {
          const teamName = `Orphan Team (Roster ${r.roster_id})`;
          return {
            rosterId: r.roster_id,
            teamName,
            playerCount: r.players?.length ?? 0,
            players: r.players ?? [],
            isDetectedOrphan: true,
            ownerUsername: null,
          };
        });

      setOrphanTeams(orphans);
      setSelectedRosterIds(new Set(orphans.map((t) => t.rosterId)));
      setStep("orphans");

      if (orphans.length > 0) {
        onLeagueDetected?.({
          leagueName,
          commissionerName: sleeperUser?.display_name ?? sleeperUser?.username ?? "",
          numOrphanSlots: orphans.length,
        });
      }
    } catch (err: unknown) {
      toast({
        title: "Failed to Detect Orphans",
        description: err instanceof Error ? err.message : "Could not fetch league data",
        variant: "destructive",
      });
    } finally {
      setLoadingOrphans(false);
    }
  };

  const toggleRoster = (rosterId: number) => {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(rosterId)) next.delete(rosterId);
      else next.add(rosterId);
      return next;
    });
  };

  // ── Step 3: import players + picks for selected orphan teams ───────────────

  const handleImport = async () => {
    if (selectedRosterIds.size === 0) {
      toast({ title: "No teams selected", variant: "destructive" });
      return;
    }

    setStep("importing");
    setImportProgress("Clearing existing assets...");

    try {
      // Always wipe the current asset pool first so re-imports don't stack duplicates
      const clearRes = await fetch(`/api/draft-rooms/${roomId}/assets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionerToken }),
      });
      if (!clearRes.ok) {
        throw new Error("Failed to clear existing assets before import");
      }

      setImportProgress("Fetching player database...");

      const [players, tradedPicks, leagueDetails] = await Promise.all([
        fetchPlayers(),
        sleeperGet<SleeperTradedPick[]>(`/league/${selectedLeagueId}/traded_picks`),
        sleeperGet<{ settings?: { draft_rounds?: number } }>(`/league/${selectedLeagueId}`),
      ]);

      // Use the league's actual draft rounds, not a hardcoded ceiling
      const maxRound = leagueDetails?.settings?.draft_rounds ?? 5;

      setImportProgress("Building asset list...");

      // Determine the years we care about for future picks.
      // Start from the CURRENT season (dynasty rookie drafts happen in June–Sept,
      // so current-year picks are still future picks even in May).
      // Cover 3 years total: current, current+1, current+2.
      const baseYear = parseInt(season, 10);
      const futureSeasons = new Set([baseYear, baseYear + 1, baseYear + 2].map(String));

      // For each selected orphan team, collect players + picks
      const csvRows: string[] = ["name,type,position,team,notes"];

      const selectedOrphans = orphanTeams.filter((t) => selectedRosterIds.has(t.rosterId));

      // Map every roster_id → display label (orphan name takes priority over Sleeper username)
      // Use Number() everywhere so string vs number IDs from Sleeper are always comparable.
      const allOrphanNames = new Map<number, string>(orphanTeams.map((o) => [Number(o.rosterId), o.teamName]));
      const getRosterLabel = (rosterId: number | string): string =>
        allOrphanNames.get(Number(rosterId)) ?? rosterToName.get(Number(rosterId)) ?? `Roster ${rosterId}`;

      for (const team of selectedOrphans) {
        const teamLabel = team.teamName;
        const teamRosterId = Number(team.rosterId);

        // Players — always tagged with the orphan team that owns them
        for (const playerId of team.players) {
          const p = players[playerId];
          if (!p) continue;
          const name = p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
          if (!name) continue;
          const pos = p.position ?? "";
          const nflTeam = p.team ?? "";
          const row = [
            `"${name}"`,
            "Player",
            pos,
            nflTeam,
            `"From: ${teamLabel} · slpid:${playerId}"`,
          ].join(",");
          csvRows.push(row);
        }

        // 1. Own picks still held by this roster (never traded away).
        // Use Number() coercion — Sleeper API sometimes returns roster IDs as strings.
        const tradedAwayByThisRoster = new Set(
          tradedPicks
            .filter((p) => Number(p.roster_id) === teamRosterId && Number(p.owner_id) !== teamRosterId)
            .map((p) => `${p.season}_${p.round}_${teamRosterId}`)
        );

        for (const yr of Array.from(futureSeasons)) {
          for (let round = 1; round <= maxRound; round++) {
            const key = `${yr}_${round}_${teamRosterId}`;
            if (!tradedAwayByThisRoster.has(key)) {
              const pickName = `${yr} Round ${round}`;
              // Group under this orphan team — it's their own pick
              csvRows.push(`"${pickName}","Rookie Pick","","","From: ${teamLabel}"`);
            }
          }
        }

        // 2. Picks traded TO this roster from another team.
        // Group under the ORIGINAL team (roster_id), not the current holder.
        const picksReceivedByThisRoster = tradedPicks.filter(
          (p) => Number(p.owner_id) === teamRosterId && Number(p.roster_id) !== teamRosterId
        );
        for (const pick of picksReceivedByThisRoster) {
          if (!futureSeasons.has(pick.season)) continue;
          const originLabel = getRosterLabel(pick.roster_id);
          const pickName = `${pick.season} Round ${pick.round}`;
          // Tag with origin team so it groups under that team in the asset pool
          csvRows.push(`"${pickName}","Rookie Pick","","","From: ${originLabel}"`);
        }
      }

      setImportProgress(`Importing ${csvRows.length - 1} assets...`);

      const csvContent = csvRows.join("\n");

      importCsv.mutate(
        { id: roomId, data: { commissionerToken, csvContent } },
        {
          onSuccess: (res) => {
            toast({
              title: "Sleeper Import Complete",
              description: `Imported ${res.imported} assets from ${selectedOrphans.length} orphan team(s).`,
            });
            if (res.errors.length > 0) {
              toast({
                title: `${res.errors.length} rows skipped`,
                description: res.errors.slice(0, 3).join("; "),
                variant: "destructive",
              });
            }
            queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(roomId, {}) });
            queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(shareCode) });
            onImportComplete?.();
            setStep("username");
            setUsername("");
            setSleeperUser(null);
            setLeagues([]);
            setLeagueSearch("");
            setSelectedLeagueId("");
            setSelectedLeagueName("");
            setOrphanTeams([]);
            setSelectedRosterIds(new Set());
          },
          onError: (err) => {
            toast({ title: "Import Failed", description: err.data?.error, variant: "destructive" });
            setStep("orphans");
          },
        }
      );
    } catch (err: unknown) {
      toast({
        title: "Import Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      setStep("orphans");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5" data-testid="sleeper-import">
      {/* Step 1 – Username + Season */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs uppercase font-bold text-muted-foreground">Sleeper Username</Label>
            <Input
              data-testid="input-sleeper-username"
              placeholder="yoursleeperusername"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              disabled={loadingLeagues || step === "importing"}
              className="bg-background border-[var(--sc-border)] dark-any:border-white/10"
            />
          </div>
        </div>
        <Button
          data-testid="button-sleeper-lookup"
          onClick={() => handleLookup()}
          disabled={!username.trim() || loadingLeagues || step === "importing"}
          variant="secondary"
          className="font-bold uppercase tracking-widest w-full"
        >
          {scanningLeagues ? "Scanning for Orphans..." : loadingLeagues ? "Fetching Leagues..." : "Lookup Leagues"}
        </Button>
      </div>

      {/* Sleeper user pill */}
      {sleeperUser && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg">
          {sleeperUser.avatar && (
            <img
              src={`https://sleepercdn.com/avatars/thumbs/${sleeperUser.avatar}`}
              alt=""
              className="w-7 h-7 rounded-full"
            />
          )}
          <span className="text-sm font-bold text-primary">{sleeperUser.display_name}</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {loadingLeagues ? "Scanning..." : `${leagues.length} league${leagues.length !== 1 ? "s" : ""} with at least 2 orphans`}
          </span>
        </div>
      )}

      {/* No leagues with orphans found */}
      {step === "leagues" && leagues.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-3 border border-[var(--sc-border)] dark-any:border-white/10 rounded-lg bg-muted/20">
          No leagues with orphan teams found for this account.
        </p>
      )}

      {/* Step 2 – League picker */}
      {(step === "leagues" || step === "orphans" || step === "importing") && leagues.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase font-bold text-muted-foreground">
              Select League
            </Label>
            <span className="text-[10px] text-muted-foreground font-mono">{leagues.length} with at least 2 orphans</span>
          </div>

          {/* Always-visible searchable list — selected league highlighted */}
          <div className="border border-[var(--sc-border)] dark-any:border-white/10 rounded-lg overflow-hidden">
            <div className="p-2 border-b border-[var(--sc-border)] dark-any:border-white/10 bg-background/60">
              <Input
                data-testid="input-league-search"
                placeholder="Search leagues..."
                value={leagueSearch}
                onChange={(e) => setLeagueSearch(e.target.value)}
                className="h-7 text-sm bg-background border-[var(--sc-border)] dark-any:border-white/10"
              />
            </div>
            <div className="max-h-52 overflow-y-auto">
              {leagues
                .filter((l) => l.name.toLowerCase().includes(leagueSearch.toLowerCase()))
                .map((l) => {
                  const isSelected = l.league_id === selectedLeagueId;
                  return (
                    <button
                      key={l.league_id}
                      data-testid={`league-option-${l.league_id}`}
                      disabled={loadingOrphans || step === "importing"}
                      onClick={() => {
                        if (isSelected) return;
                        setOrphanTeams([]);
                        setSelectedRosterIds(new Set());
                        handleDetectOrphans(l.league_id, l.name);
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm border-b border-border/20 last:border-0 transition-colors disabled:cursor-not-allowed flex items-center gap-2
                        ${isSelected
                          ? "bg-primary/15 text-primary font-bold cursor-default"
                          : "hover:bg-primary/10 hover:text-primary"
                        }`}
                    >
                      {l.avatar
                        ? <img src={`https://sleepercdn.com/avatars/thumbs/${l.avatar}`} alt="" className="w-6 h-6 rounded-lg object-cover flex-shrink-0 bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        : <div className="w-6 h-6 rounded-lg bg-muted flex-shrink-0" />
                      }
                      <span className="flex-1 truncate">{l.name}</span>
                      <span className="text-[10px] font-mono uppercase opacity-60 flex-shrink-0">{l.season}</span>
                      {l.orphanCount != null && !isSelected && (
                        <span className="text-[10px] font-bold text-amber-600 dark-any:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-1.5 py-0.5 flex-shrink-0">
                          {l.orphanCount} orphan{l.orphanCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {isSelected && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-primary flex-shrink-0 border border-primary/40 rounded-lg px-1">
                          Selected
                        </span>
                      )}
                    </button>
                  );
                })}
              {leagues.filter((l) => l.name.toLowerCase().includes(leagueSearch.toLowerCase())).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No leagues match</p>
              )}
            </div>
          </div>

          {loadingOrphans && (
            <p className="text-xs text-muted-foreground animate-pulse">Detecting orphan teams...</p>
          )}
        </div>
      )}

      {/* Step 3 – Orphan team checkboxes */}
      {step === "orphans" && orphanTeams.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase font-bold text-muted-foreground">
              Orphan Teams Detected ({orphanTeams.length})
            </Label>
            <button
              className="text-xs text-primary hover:underline font-medium"
              onClick={() => {
                if (selectedRosterIds.size === orphanTeams.length) {
                  setSelectedRosterIds(new Set());
                } else {
                  setSelectedRosterIds(new Set(orphanTeams.map((t) => t.rosterId)));
                }
              }}
            >
              {selectedRosterIds.size === orphanTeams.length ? "Deselect all" : "Select all"}
            </button>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {orphanTeams.map((team) => (
              <label
                key={team.rosterId}
                data-testid={`orphan-team-${team.rosterId}`}
                className="flex items-start gap-3 p-3 bg-background border border-[var(--sc-border)] dark-any:border-white/10 rounded-lg cursor-pointer hover:border-primary/40 transition-colors"
              >
                <Checkbox
                  checked={selectedRosterIds.has(team.rosterId)}
                  onCheckedChange={() => toggleRoster(team.rosterId)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{team.teamName}</div>
                  {team.playerCount === 0 ? (
                    <div className="text-[10px] uppercase tracking-wider text-amber-600 dark-any:text-amber-400 font-bold font-mono">
                      Pre-draft — no players yet
                    </div>
                  ) : (
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                      {team.playerCount} players on roster
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          <Button
            data-testid="button-sleeper-import"
            onClick={handleImport}
            disabled={selectedRosterIds.size === 0 || importCsv.isPending}
            className="w-full font-bold uppercase tracking-widest"
          >
            Import {selectedRosterIds.size} Team{selectedRosterIds.size !== 1 ? "s" : ""}
          </Button>
        </div>
      )}

      {orphanTeams.length === 0 && step === "orphans" && !loadingOrphans && (
        <p className="text-sm text-muted-foreground text-center py-4 border border-[var(--sc-border)] dark-any:border-white/10 rounded-lg">
          No orphan teams found in this league
        </p>
      )}

      {/* Step 4 – Import progress */}
      {step === "importing" && (
        <div className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/30 rounded-lg">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-sm font-medium text-primary">{importProgress}</span>
        </div>
      )}
    </div>
  );
}
