import { useState, useMemo, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/KpiCard";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { getPositionColor } from "@/data/mockData";
import { useValueModel } from "@/contexts/ValueModelContext";
import type { League, Team, Player } from "@/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Search, Loader2, PackageOpen } from "lucide-react";
import {
  fetchRosterDraftPicks,
  normalizeRosterDraftPicks,
  type NormalizedDraftPick,
} from "@/lib/sleeperApi";
import { updateTaxi } from "@/lib/sleeper/graphql/mutations/updateTaxi";
import { updateReserve } from "@/lib/sleeper/graphql/mutations/updateReserve";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const SLEEPER_JWT_KEY = "dc-sleeper-draft-jwt";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

interface TeamProps {
  league: League;
  userTeam: Team;
}

export function RosterBreakdown({ league, userTeam }: TeamProps) {
  const [search, setSearch] = useState("");
  const { getRedraftValue, getPlayerValue, optimizeLineup } = useValueModel();

  // ── Future draft picks ────────────────────────────────────────────────────
  const [sleeperJwt, setSleeperJwt] = useState<string | null>(
    () => localStorage.getItem(SLEEPER_JWT_KEY)
  );
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SLEEPER_JWT_KEY) setSleeperJwt(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const [picks, setPicks] = useState<NormalizedDraftPick[]>([]);
  const [picksLoading, setPicksLoading] = useState(false);
  const [picksError, setPicksError] = useState<string | null>(null);

  useEffect(() => {
    if (!sleeperJwt || !league.id) { setPicks([]); return; }
    setPicksLoading(true);
    setPicksError(null);
    fetchRosterDraftPicks(league.id, sleeperJwt)
      .then((raw) => setPicks(normalizeRosterDraftPicks(league.id, raw)))
      .catch(() => setPicksError("Unable to load future draft picks."))
      .finally(() => setPicksLoading(false));
  }, [sleeperJwt, league.id]);

  // Only this roster's picks, grouped by season then sorted by round
  const myPicks = useMemo(() => {
    const myRosterId = parseInt(userTeam.id, 10);
    const mine = picks.filter((p) => p.currentRosterId === myRosterId);
    const bySeason = new Map<string, NormalizedDraftPick[]>();
    for (const p of mine) {
      if (!bySeason.has(p.season)) bySeason.set(p.season, []);
      bySeason.get(p.season)!.push(p);
    }
    return new Map(
      [...bySeason.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([season, ps]) => [season, ps.sort((a, b) => a.round - b.round)])
    );
  }, [picks, userTeam.id]);

  // ── Taxi squad ─────────────────────────────────────────────────────────────
  const taxiSlots = league.taxiSlots ?? 0;
  const userRosterId = useMemo(() => {
    const m = userTeam.id.match(/^roster_(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }, [userTeam.id]);

  const [localTaxiIds, setLocalTaxiIds] = useState<Set<string>>(
    () => new Set(userTeam.roster.filter((p) => p.onTaxi).map((p) => p.id))
  );
  const [taxiMutating, setTaxiMutating] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    setLocalTaxiIds(new Set(userTeam.roster.filter((p) => p.onTaxi).map((p) => p.id)));
  }, [userTeam.id]);

  const handleTaxi = useCallback(async (player: Player, toTaxi: boolean) => {
    if (!sleeperJwt || userRosterId === null || !league.id) return;
    const nextTaxi = toTaxi
      ? [...localTaxiIds, player.id].filter((id, i, a) => a.indexOf(id) === i)
      : [...localTaxiIds].filter((id) => id !== player.id);
    setTaxiMutating(player.id);
    setLocalTaxiIds(new Set(nextTaxi));
    try {
      const result = await updateTaxi(sleeperJwt, league.id, userRosterId, nextTaxi);
      setLocalTaxiIds(new Set(result.taxi ?? []));
      toast({ title: toTaxi ? "Moved to Taxi" : "Removed from Taxi", description: player.name });
    } catch (err: any) {
      setLocalTaxiIds(new Set(
        toTaxi
          ? nextTaxi.filter((id) => id !== player.id)
          : [...nextTaxi, player.id]
      ));
      toast({ title: "Action failed", description: err?.message || "Could not update taxi squad.", variant: "destructive" });
    } finally {
      setTaxiMutating(null);
    }
  }, [sleeperJwt, userRosterId, league.id, localTaxiIds, toast]);

  // ── IR / Reserve ───────────────────────────────────────────────────────────
  const irSlots = league.irSlots ?? 0;
  const [localReserveIds, setLocalReserveIds] = useState<Set<string>>(
    () => new Set(userTeam.roster.filter((p) => p.onReserve).map((p) => p.id))
  );
  const [reserveMutating, setReserveMutating] = useState<string | null>(null);

  useEffect(() => {
    setLocalReserveIds(new Set(userTeam.roster.filter((p) => p.onReserve).map((p) => p.id)));
  }, [userTeam.id]);

  const handleReserve = useCallback(async (player: Player, toReserve: boolean) => {
    if (!sleeperJwt || userRosterId === null || !league.id) return;
    const nextReserve = toReserve
      ? [...localReserveIds, player.id].filter((id, i, a) => a.indexOf(id) === i)
      : [...localReserveIds].filter((id) => id !== player.id);
    setReserveMutating(player.id);
    setLocalReserveIds(new Set(nextReserve));
    try {
      const data = await updateReserve(sleeperJwt, league.id, userRosterId, nextReserve);
      setLocalReserveIds(new Set(data.roster_update_reserve?.reserve ?? []));
      toast({ title: toReserve ? "Moved to IR" : "Removed from IR", description: player.name });
    } catch (err: any) {
      setLocalReserveIds(new Set(
        toReserve
          ? nextReserve.filter((id) => id !== player.id)
          : [...nextReserve, player.id]
      ));
      toast({ title: "Action failed", description: err?.message || "Could not update IR/reserve. Sleeper may not allow this move.", variant: "destructive" });
    } finally {
      setReserveMutating(null);
    }
  }, [sleeperJwt, userRosterId, league.id, localReserveIds, toast]);

  const posRanks = useMemo(() => {
    const positions = ["QB", "RB", "WR", "TE"] as const;
    const total = league.teams.length;
    const rosterPositions = league.rosterPositions || [];

    const redraftRanks: Record<string, Record<string, number>> = {};
    const dynastyRanks: Record<string, Record<string, number>> = {};

    positions.forEach(pos => {
      const redraftTotals = league.teams.map(t => {
        const roster = rosterPositions.length > 0 ? optimizeLineup(t.roster, rosterPositions) : t.roster;
        const starters = roster.filter(p => p.starter && p.pos === pos);
        return { id: t.id, total: starters.reduce((s, p) => s + getRedraftValue(p), 0) };
      });
      redraftTotals.sort((a, b) => b.total - a.total);
      redraftTotals.forEach((entry, i) => {
        if (!redraftRanks[entry.id]) redraftRanks[entry.id] = {};
        redraftRanks[entry.id][pos] = i + 1;
      });

      const dynastyTotals = league.teams.map(t => {
        const allAtPos = t.roster.filter(p => p.pos === pos);
        return { id: t.id, total: allAtPos.reduce((s, p) => s + getPlayerValue(p), 0) };
      });
      dynastyTotals.sort((a, b) => b.total - a.total);
      dynastyTotals.forEach((entry, i) => {
        if (!dynastyRanks[entry.id]) dynastyRanks[entry.id] = {};
        dynastyRanks[entry.id][pos] = i + 1;
      });
    });

    return { redraftRanks, dynastyRanks, total };
  }, [league, getRedraftValue, getPlayerValue, optimizeLineup]);

  const positions: Array<{ pos: string; redraftRank: number; dynastyRank: number; total: number }> = [
    { pos: "QB", redraftRank: posRanks.redraftRanks[userTeam.id]?.QB || posRanks.total, dynastyRank: posRanks.dynastyRanks[userTeam.id]?.QB || posRanks.total, total: posRanks.total },
    { pos: "RB", redraftRank: posRanks.redraftRanks[userTeam.id]?.RB || posRanks.total, dynastyRank: posRanks.dynastyRanks[userTeam.id]?.RB || posRanks.total, total: posRanks.total },
    { pos: "WR", redraftRank: posRanks.redraftRanks[userTeam.id]?.WR || posRanks.total, dynastyRank: posRanks.dynastyRanks[userTeam.id]?.WR || posRanks.total, total: posRanks.total },
    { pos: "TE", redraftRank: posRanks.redraftRanks[userTeam.id]?.TE || posRanks.total, dynastyRank: posRanks.dynastyRanks[userTeam.id]?.TE || posRanks.total, total: posRanks.total },
  ];

  const weakest = [...positions].sort((a, b) => a.dynastyRank - b.dynastyRank).reverse()[0];

  const starters = [...userTeam.roster.filter((p) => p.starter)].sort((a, b) => b.value - a.value);
  const bench = [...userTeam.roster.filter((p) => !p.starter)].sort((a, b) => b.value - a.value);

  const buckets = { "21-24": 0, "25-28": 0, "29+": 0 };
  userTeam.roster.forEach((p) => {
    if (p.age <= 24) buckets["21-24"]++;
    else if (p.age <= 28) buckets["25-28"]++;
    else buckets["29+"]++;
  });
  const maxBucket = Math.max(...Object.values(buckets));

  const depthPositions = ["QB", "RB", "WR", "TE"] as const;
  const filtered = useMemo(() => {
    if (!search) return userTeam.roster;
    return userTeam.roster.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  }, [search, userTeam.roster]);

  return (
    <div className="space-y-10">
      <SectionHeader title="My Team" subtitle="View your roster, team value, positional strengths, and dynasty outlook." />

      <div>
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Roster Strength</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {positions.map((p) => {
            const rankColor = (rank: number, total: number) => {
              const topThird = Math.ceil(total / 3);
              const bottomThird = total - topThird;
              if (rank <= topThird) return "text-emerald-600 dark:text-emerald-400";
              if (rank <= bottomThird) return "text-foreground";
              return "text-red-500 dark:text-red-400";
            };
            return (
              <Card key={p.pos} className="p-5 hover-elevate" data-testid={`strength-${p.pos.toLowerCase()}`}>
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{p.pos}</p>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">Redraft</span>
                    <span className={cn("text-lg font-bold", rankColor(p.redraftRank, p.total))} data-testid={`text-redraft-rank-${p.pos.toLowerCase()}`}>
                      #{p.redraftRank}<span className="text-xs text-muted-foreground font-normal"> / {p.total}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">Dynasty</span>
                    <span className={cn("text-lg font-bold", rankColor(p.dynastyRank, p.total))} data-testid={`text-dynasty-rank-${p.pos.toLowerCase()}`}>
                      #{p.dynastyRank}<span className="text-xs text-muted-foreground font-normal"> / {p.total}</span>
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {weakest.dynastyRank > Math.ceil(weakest.total * 0.66) && (
          <div className="mt-4">
            <InsightCallout
              text={`${weakest.pos} ranks near the bottom of the league (#${weakest.dynastyRank} / ${weakest.total} dynasty). Consider targeting ${weakest.pos} in trades.`}
              type="negative"
            />
          </div>
        )}

        <div className="relative max-w-sm mt-5 mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-depth"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {depthPositions.map((pos) => {
            const players = filtered.filter((p) => p.pos === pos);
            if (players.length === 0 && search) return null;
            return (
              <Card key={pos} className="p-6" data-testid={`depth-${pos.toLowerCase()}`}>
                <div className="mb-4">
                  <h3 className="text-base font-bold flex items-center gap-2">
                    {pos}
                    <Badge variant="secondary">{players.length}</Badge>
                  </h3>
                  <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
                </div>
                <div className="space-y-1">
                  {[...players].sort((a, b) => {
                    const score = (p: Player) =>
                      p.starter ? 3 : localReserveIds.has(p.id) ? 0 : localTaxiIds.has(p.id) ? 1 : 2;
                    return score(b) - score(a) || b.value - a.value;
                  }).map((p) => {
                    const isOnTaxi    = localTaxiIds.has(p.id);
                    const isOnIR      = localReserveIds.has(p.id);
                    const isMutating  = taxiMutating === p.id || reserveMutating === p.id;
                    return (
                      <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0" data-testid={`depth-player-${p.id}`}>
                        <div className="flex items-center gap-2">
                          <PlayerAvatar
                            id={p.sleeperId ?? p.id}
                            name={p.name}
                            pos={p.pos}
                            team={p.team ?? ""}
                            size="xs"
                            compact
                          />
                          <Badge
                            variant={p.starter ? "default" : "outline"}
                            className={cn(
                              "text-xs",
                              isOnTaxi && "border-amber-500/40 text-amber-400 bg-amber-500/10",
                              isOnIR   && "border-red-500/40 text-red-400 bg-red-500/10"
                            )}
                          >
                            {p.starter ? "Starter" : isOnTaxi ? "Taxi" : isOnIR ? "IR" : "Bench"}
                          </Badge>
                          <span className={cn("text-sm", p.starter ? "font-semibold" : "")}>{p.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{p.team}</span>
                          <span className="text-xs text-muted-foreground">Age {p.age}</span>

                          {/* Taxi actions — hidden while player is on IR */}
                          {sleeperJwt && taxiSlots > 0 && !p.starter && !isOnIR && (
                            isOnTaxi ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 px-1.5 text-[10px] font-medium"
                                onClick={() => handleTaxi(p, false)}
                                disabled={isMutating}
                                data-testid={`btn-remove-taxi-${p.id}`}
                                title="Remove from Taxi"
                              >
                                {taxiMutating === p.id
                                  ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  : "← Active"}
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 px-1.5 text-[10px] font-medium hover:text-amber-400 hover:border-amber-500/40"
                                onClick={() => handleTaxi(p, true)}
                                disabled={isMutating || localTaxiIds.size >= taxiSlots}
                                data-testid={`btn-move-taxi-${p.id}`}
                                title="Move to Taxi"
                              >
                                {taxiMutating === p.id
                                  ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  : "Taxi →"}
                              </Button>
                            )
                          )}

                          {/* IR actions — hidden while player is on Taxi */}
                          {sleeperJwt && irSlots > 0 && !p.starter && !isOnTaxi && (
                            isOnIR ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 px-1.5 text-[10px] font-medium"
                                onClick={() => handleReserve(p, false)}
                                disabled={isMutating}
                                data-testid={`btn-remove-ir-${p.id}`}
                                title="Remove from IR"
                              >
                                {reserveMutating === p.id
                                  ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  : "← Bench"}
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 px-1.5 text-[10px] font-medium hover:text-red-400 hover:border-red-500/40"
                                onClick={() => handleReserve(p, true)}
                                disabled={isMutating || localReserveIds.size >= irSlots}
                                data-testid={`btn-move-ir-${p.id}`}
                                title="Move to IR"
                              >
                                {reserveMutating === p.id
                                  ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  : "→ IR"}
                              </Button>
                            )
                          )}

                          <span className="text-xs font-bold w-6 text-right">{p.value}</span>
                        </div>
                      </div>
                    );
                  })}
                  {players.length === 0 && <p className="text-xs text-muted-foreground">No players found</p>}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Age Curve</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <Card className="p-6">
          <div className="grid grid-cols-3 gap-6">
            {Object.entries(buckets).map(([range, count]) => (
              <div key={range} className="text-center" data-testid={`age-bucket-${range}`}>
                <div className="mx-auto w-full max-w-[90px]">
                  <div className="h-36 bg-muted rounded-md relative overflow-hidden flex items-end">
                    <div
                      className={cn(
                        "w-full rounded-md transition-all",
                        range === "21-24" ? "bg-emerald-500" :
                        range === "25-28" ? "bg-[#0b3a7a] dark:bg-blue-500" :
                        "bg-amber-500"
                      )}
                      style={{ height: `${(count / maxBucket) * 100}%` }}
                    />
                  </div>
                </div>
                <p className="text-xl font-bold mt-3">{count}</p>
                <p className="text-xs text-muted-foreground font-medium">{range}</p>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          <KpiCard
            label="Contender Window"
            value={userTeam.metrics.windowStartOffset > 0
              ? `~${new Date().getFullYear() + userTeam.metrics.windowStartOffset}`
              : `${userTeam.metrics.contenderWindowYears} Yrs`}
            subtitle={userTeam.metrics.windowStartOffset > 0
              ? `Opens in ~${userTeam.metrics.windowStartOffset} yr${userTeam.metrics.windowStartOffset !== 1 ? "s" : ""} · ${userTeam.metrics.contenderWindowYears} yr window`
              : "Based on roster age and value"}
          />
          <KpiCard label="Youth Score" value={userTeam.metrics.youth} subtitle={userTeam.metrics.youth >= 60 ? "Above average" : "Below average"} trend={userTeam.metrics.youth >= 60 ? "up" : "down"} />
        </div>

        <Card className="p-6 mt-5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your roster skews {buckets["21-24"] > buckets["29+"] ? "younger" : "older"} with {buckets["21-24"]} players under 25.
            {userTeam.metrics.windowStartOffset > 1
              ? ` Your contender window is projected to open around ${new Date().getFullYear() + userTeam.metrics.windowStartOffset}. Focus on accumulating youth and draft capital now.`
              : userTeam.metrics.contenderWindowYears >= 3
                ? " You have a strong multi-year window to compete. Consider making a push for championship-caliber talent."
                : " Your window may be closing. Consider selling aging assets for younger players and draft picks."
            }
          </p>
        </Card>
      </div>

      {/* ── Future Draft Picks ─────────────────────────────────────────── */}
      <div data-testid="section-future-picks">
        <div className="mb-5">
          <h3 className="text-base font-bold text-foreground">Future Draft Picks</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        {/* No JWT */}
        {!sleeperJwt && (
          <Card className="p-6 flex items-center gap-3 text-muted-foreground" data-testid="picks-no-auth">
            <PackageOpen className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">Connect Sleeper (via Live Draft tab) to view future draft picks.</p>
          </Card>
        )}

        {/* Loading */}
        {sleeperJwt && picksLoading && (
          <Card className="p-6 flex items-center gap-3 text-muted-foreground" data-testid="picks-loading">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <p className="text-sm">Loading future picks…</p>
          </Card>
        )}

        {/* Error */}
        {sleeperJwt && !picksLoading && picksError && (
          <Card className="p-6 border-red-500/30" data-testid="picks-error">
            <p className="text-sm text-red-500 dark:text-red-400">{picksError}</p>
          </Card>
        )}

        {/* Picks grouped by season */}
        {sleeperJwt && !picksLoading && !picksError && myPicks.size > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4" data-testid="picks-grid">
            {[...myPicks.entries()].map(([season, seasonPicks]) => (
              <Card key={season} className="p-5" data-testid={`picks-season-${season}`}>
                <p className="text-xs font-bold uppercase tracking-wider text-[#d4af37] mb-3">{season}</p>
                <div className="space-y-2">
                  {seasonPicks.map((p) => {
                    const isOwn = p.currentRosterId === p.originalRosterId;
                    const roundLabel = ordinal(p.round);
                    const origTeam = league.teams.find((t) => t.id === String(p.originalRosterId));
                    const fromLabel = origTeam?.owner || origTeam?.name || `Roster ${p.originalRosterId}`;
                    return (
                      <div
                        key={`${p.season}-${p.round}-${p.originalRosterId}`}
                        className="flex items-center gap-2"
                        data-testid={`pick-${season}-r${p.round}-from${p.originalRosterId}`}
                      >
                        <span className={cn(
                          "inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold flex-shrink-0",
                          p.round === 1
                            ? "bg-[#d4af37]/20 text-[#d4af37]"
                            : p.round === 2
                              ? "bg-blue-500/15 text-blue-400"
                              : "bg-muted text-muted-foreground"
                        )}>
                          {p.round}
                        </span>
                        <span className="text-sm">
                          {isOwn
                            ? <span className="font-medium text-foreground">Own {roundLabel}</span>
                            : <><span className="text-muted-foreground">{fromLabel}'s</span>{" "}<span className="font-medium text-foreground">{roundLabel}</span></>
                          }
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Empty — connected but no picks */}
        {sleeperJwt && !picksLoading && !picksError && myPicks.size === 0 && picks.length > 0 && (
          <Card className="p-6 text-center" data-testid="picks-empty">
            <p className="text-sm text-muted-foreground">No future picks currently assigned to this roster.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
