import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeader } from "@/components/SectionHeader";
import { useToast } from "@/hooks/use-toast";
import { useSleeper } from "@/contexts/SleeperContext";
import { cn } from "@/lib/utils";
import {
  fetchPickTrackerData,
  getPickTier,
  type PickTrackerData,
  type RookiePickLedgerEntry,
} from "@/lib/pickTracker";
import {
  fetchSleeperUser,
  fetchSleeperLeagues,
  type SleeperLeagueSummary,
} from "@/lib/sleeperApi";
import {
  Users, ListOrdered, Radio, RefreshCw, Share2,
  Trophy, Clock, AlertTriangle, Loader2, X,
} from "lucide-react";

const SEASON = "2026";
const POLL_MS = 3_000;
const LAST_LEAGUE_KEY = "lastLeagueId";

type ViewMode = "team" | "pick";

function teamInitials(name: string): string {
  return (name || "??").slice(0, 2).toUpperCase();
}

function formatEST(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusMeta(status: string): { label: string; dot: string } {
  if (status === "complete") return { label: "Complete", dot: "bg-emerald-500" };
  if (status === "drafting") return { label: "In Progress", dot: "bg-amber-500" };
  return { label: "Not Started", dot: "bg-slate-400" };
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function readUrl(): { league: string | null; view: ViewMode } {
  const p = new URLSearchParams(window.location.search);
  const league = p.get("league") || p.get("league_id");
  const view = p.get("view") === "pick" ? "pick" : "team";
  return { league, view };
}

function writeUrl(league: string | null, view: ViewMode) {
  const p = new URLSearchParams(window.location.search);
  if (league) p.set("league", league);
  else p.delete("league");
  p.delete("league_id");
  p.set("view", view);
  const next = `${window.location.pathname}?${p.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

export function PickTracker() {
  const { toast } = useToast();
  const { activeLeagueId, user, isConnected } = useSleeper();

  const [username, setUsername] = useState("");
  const [leagues, setLeagues] = useState<SleeperLeagueSummary[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>("");
  const [loadingLeagues, setLoadingLeagues] = useState(false);

  const [data, setData] = useState<PickTrackerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackedLeagueId, setTrackedLeagueId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const [view, setView] = useState<ViewMode>("team");
  const [teamFilter, setTeamFilter] = useState<number | null>(null);
  const [highlightPick, setHighlightPick] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevKickerCount = useRef(0);
  const [pulsePick, setPulsePick] = useState<string | null>(null);

  // One-time init guards so the connected-user prefill and a shared deep link
  // don't fight each other or re-run on every render.
  const didInitFromUrl = useRef(false);
  const didPrefillUser = useRef(false);

  const lastLeagueId = useMemo(() => {
    try { return localStorage.getItem(LAST_LEAGUE_KEY); } catch { return null; }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const refresh = useCallback(async (leagueId: string, isPoll: boolean) => {
    try {
      const next = await fetchPickTrackerData(leagueId);
      setData((prev) => {
        // Pulse the newest ledger row when the ledger grows during a poll.
        if (isPoll && prev && next.kickersDrafted > prevKickerCount.current) {
          const newest = next.rookiePickLedger[next.rookiePickLedger.length - 1];
          if (newest) {
            setPulsePick(newest.rookiePick);
            setTimeout(() => setPulsePick((p) => (p === newest.rookiePick ? null : p)), 3_000);
          }
        }
        prevKickerCount.current = next.kickersDrafted;
        return next;
      });
      setConnected(true);
      setError(null);
      if (next.draftStatus === "complete") stopPolling();
    } catch (e: any) {
      setConnected(false);
      if (!isPoll) setError(e?.message || "Failed to load pick tracker data");
    }
  }, [stopPolling]);

  const trackPicks = useCallback(async (leagueId: string) => {
    if (!leagueId) return;
    stopPolling();
    setLoading(true);
    setError(null);
    setData(null);
    prevKickerCount.current = 0;
    setTrackedLeagueId(leagueId);
    try { localStorage.setItem(LAST_LEAGUE_KEY, leagueId); } catch {}
    writeUrl(leagueId, view);

    try {
      const first = await fetchPickTrackerData(leagueId);
      prevKickerCount.current = first.kickersDrafted;
      setData(first);
      setConnected(true);
      if (first.draftStatus !== "complete") {
        pollRef.current = setInterval(() => { void refresh(leagueId, true); }, POLL_MS);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load pick tracker data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [refresh, stopPolling, view]);

  // Auto-track from the URL (a shared deep link) on mount. A connected user's
  // own leagues are prefilled separately (below) so the username box is
  // populated for them rather than being bypassed.
  useEffect(() => {
    const { league, view: urlView } = readUrl();
    setView(urlView);
    if (league) {
      didInitFromUrl.current = true;
      void trackPicks(league);
    }
    return () => stopPolling();
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the viewer is connected/logged into Commissioner Command, auto-fill
  // their Sleeper username and load their leagues — they shouldn't have to type
  // it. If a league is already active it's preselected and tracked. Guests (not
  // connected) keep the empty box for manual entry, and a shared deep link
  // (handled above) always wins.
  useEffect(() => {
    if (didPrefillUser.current || didInitFromUrl.current) return;
    if (!isConnected || !user?.username) return;
    didPrefillUser.current = true;
    setUsername(user.username);
    void loadLeaguesFor(user.username, { silent: true, autoTrack: activeLeagueId ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, user, activeLeagueId]);

  // Keep the URL's view param in sync.
  useEffect(() => {
    if (trackedLeagueId) writeUrl(trackedLeagueId, view);
  }, [view, trackedLeagueId]);

  // Look up a Sleeper user's leagues for the season. `silent` suppresses toasts
  // for the auto-prefill path (a connected user who never clicked anything);
  // `autoTrack` immediately tracks a known league id (e.g. the commissioner's
  // active league) and preselects it in the dropdown.
  const loadLeaguesFor = useCallback(async (
    name: string,
    opts: { silent?: boolean; autoTrack?: string | null } = {},
  ) => {
    const trimmed = name.trim();
    if (!trimmed) {
      if (!opts.silent) toast({ title: "Enter a Sleeper username", variant: "destructive" });
      return;
    }
    setLoadingLeagues(true);
    setLeagues([]);
    setSelectedLeague("");
    try {
      const sleeperUser = await fetchSleeperUser(trimmed);
      const lgs = await fetchSleeperLeagues(sleeperUser.userId, SEASON);
      if (!lgs.length && !opts.silent) {
        toast({ title: "No leagues found", description: `No ${SEASON} leagues for ${trimmed}.` });
      }
      setLeagues(lgs);
      const preselect =
        opts.autoTrack && lgs.some((l) => l.leagueId === opts.autoTrack)
          ? opts.autoTrack
          : lgs[0]?.leagueId ?? "";
      if (preselect) setSelectedLeague(preselect);
      if (opts.autoTrack) void trackPicks(opts.autoTrack);
    } catch (e: any) {
      if (!opts.silent) {
        toast({ title: "Couldn't load leagues", description: e?.message || "User not found", variant: "destructive" });
      }
    } finally {
      setLoadingLeagues(false);
    }
  }, [toast, trackPicks]);

  const loadLeagues = useCallback(() => loadLeaguesFor(username), [loadLeaguesFor, username]);

  const onShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Link copied", description: "Share URL copied to clipboard." });
    } catch {
      toast({ title: "Couldn't copy link", variant: "destructive" });
    }
  }, [toast]);

  const jumpToPick = useCallback((rookiePick: string) => {
    setView("pick");
    setHighlightPick(rookiePick);
    setTimeout(() => {
      const el = document.getElementById(`pick-${rookiePick.replace(".", "-")}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setTimeout(() => setHighlightPick((p) => (p === rookiePick ? null : p)), 3_000);
  }, []);

  const isComplete = data?.draftStatus === "complete";
  const isDrafting = data?.draftStatus === "drafting";

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Pick Tracker"
        subtitle="Rookie picks derived from kicker order in your league's startup draft. Updates live during an in-progress draft."
      />

      {/* ── Search controls ─────────────────────────────────────────────── */}
      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Sleeper username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void loadLeagues(); }}
              className="sm:max-w-xs"
              data-testid="picktracker-username-input"
            />
            <Button onClick={() => void loadLeagues()} disabled={loadingLeagues} data-testid="picktracker-load-leagues">
              {loadingLeagues ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Load Leagues
            </Button>
            {leagues.length > 0 && (
              <>
                <Select value={selectedLeague} onValueChange={setSelectedLeague}>
                  <SelectTrigger className="sm:max-w-xs" data-testid="picktracker-league-select">
                    <SelectValue placeholder="Choose a league" />
                  </SelectTrigger>
                  <SelectContent>
                    {leagues.map((lg) => (
                      <SelectItem key={lg.leagueId} value={lg.leagueId}>{lg.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => selectedLeague && void trackPicks(selectedLeague)}
                  disabled={!selectedLeague}
                  data-testid="picktracker-track-username"
                >
                  Track Picks
                </Button>
              </>
            )}
          </div>
          {isConnected && user?.username && username.trim().toLowerCase() === user.username.toLowerCase() && (
            <p className="text-xs text-muted-foreground" data-testid="picktracker-connected-hint">
              Auto-filled from your connected Sleeper account. Edit the username to look up a different manager.
            </p>
          )}
        </div>

        {!data && !loading && lastLeagueId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void trackPicks(lastLeagueId)}
            data-testid="picktracker-resume"
          >
            <RefreshCw className="h-4 w-4 mr-1.5" /> Resume last league ({lastLeagueId})
          </Button>
        )}
      </Card>

      {error && (
        <Card className="p-4 border-destructive/40">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        </Card>
      )}

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        </div>
      )}

      {data && !loading && (
        <>
          {/* ── Header / stats card ───────────────────────────────────── */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", statusMeta(data.draftStatus).dot)} />
                  <h3 className="text-lg font-semibold">{data.leagueName}</h3>
                  {isDrafting && connected && (
                    <Badge className="bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-300 gap-1">
                      <Radio className="h-3 w-3 animate-pulse" /> Live
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ID {data.leagueId} · {statusMeta(data.draftStatus).label}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isDrafting && connected && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark-any:text-emerald-300">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    Live Sync Active
                  </span>
                )}
                <Button variant="outline" size="sm" onClick={onShare} data-testid="picktracker-share">
                  <Share2 className="h-4 w-4 mr-1.5" /> Share
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <Stat label="Kickers Drafted" value={String(data.kickersDrafted)} />
              <Stat label="Teams" value={String(data.teams.length)} />
              {data.nextPick ? (
                <Stat
                  label="Next Pick"
                  value={data.nextPick.rookiePick}
                  hint={data.nextPick.onTheClockOwner ? `OTC: ${data.nextPick.onTheClockOwner}` : undefined}
                />
              ) : (
                <Stat label="Next Pick" value="—" />
              )}
              <Stat label="Last Updated (EST)" value={formatEST(data.lastUpdated)} />
            </div>
          </Card>

          {/* ── Status banners ────────────────────────────────────────── */}
          {data.kickersDrafted === 0 && !isComplete && (
            <Card className="p-4 border-amber-500/40">
              <div className="flex items-center gap-2 text-sm text-amber-600 dark-any:text-amber-300">
                <Clock className="h-4 w-4" /> Waiting for first kicker to be drafted…
              </div>
            </Card>
          )}
          {isComplete && (
            <Card className="p-4 border-emerald-500/40">
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark-any:text-emerald-300">
                <Trophy className="h-4 w-4" /> Draft complete — all rookie picks assigned.
              </div>
            </Card>
          )}

          {/* ── View toggle ───────────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border p-0.5">
              <Button
                variant={view === "team" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("team")}
                data-testid="picktracker-view-team"
              >
                <Users className="h-4 w-4 mr-1.5" /> By Team
              </Button>
              <Button
                variant={view === "pick" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("pick")}
                data-testid="picktracker-view-pick"
              >
                <ListOrdered className="h-4 w-4 mr-1.5" /> Pick Ledger
              </Button>
            </div>
            {teamFilter !== null && (
              <Badge variant="secondary" className="gap-1">
                Filtering: {data.teams.find((t) => t.rosterId === teamFilter)?.teamName ?? teamFilter}
                <button onClick={() => setTeamFilter(null)} data-testid="picktracker-clear-filter">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>

          {view === "team" ? (
            <TeamView data={data} teamFilter={teamFilter} setTeamFilter={setTeamFilter} onPickClick={jumpToPick} />
          ) : (
            <LedgerView data={data} highlightPick={highlightPick} pulsePick={pulsePick} />
          )}
        </>
      )}

    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5 truncate">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}

function PickBadge({ pick, round, onClick }: { pick: string; round: number; onClick?: () => void }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs font-mono",
        getPickTier(round),
        onClick && "cursor-pointer hover:brightness-110",
      )}
      onClick={onClick}
      data-testid={`picktracker-badge-${pick}`}
    >
      {pick}
    </span>
  );
}

function TeamAvatar({ avatar, name }: { avatar?: string | null; name: string }) {
  if (avatar) {
    return <img src={avatar} alt={name} className="h-9 w-9 rounded-full object-cover" loading="lazy" />;
  }
  return (
    <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold">
      {teamInitials(name)}
    </div>
  );
}

function TeamView({
  data, teamFilter, setTeamFilter, onPickClick,
}: {
  data: PickTrackerData;
  teamFilter: number | null;
  setTeamFilter: (id: number | null) => void;
  onPickClick: (pick: string) => void;
}) {
  const teams = teamFilter !== null ? data.teams.filter((t) => t.rosterId === teamFilter) : data.teams;
  const roundOf = (pick: string) => parseInt(pick.split(".")[0], 10) || 1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {teams.map((team, idx) => {
        const rank = data.teams.indexOf(team) + 1;
        return (
          <Card key={team.rosterId} className="p-4 hover-elevate" data-testid={`picktracker-team-${team.rosterId}`}>
            <div className="flex items-center gap-3">
              <span className="h-6 w-6 shrink-0 rounded-full bg-muted text-xs font-semibold flex items-center justify-center">
                {rank}
              </span>
              <TeamAvatar avatar={team.avatar} name={team.teamName} />
              <button
                className="text-left min-w-0 flex-1"
                onClick={() => setTeamFilter(teamFilter === team.rosterId ? null : team.rosterId)}
              >
                <div className="font-semibold truncate">{team.teamName}</div>
                <div className="text-xs text-muted-foreground truncate">{team.ownerName}</div>
              </button>
              <Badge variant="secondary">{team.rookiePicks.length}</Badge>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {team.rookiePicks.length === 0 ? (
                <span className="text-xs text-muted-foreground">No rookie picks yet</span>
              ) : (
                team.rookiePicks.map((p) => (
                  <PickBadge key={p} pick={p} round={roundOf(p)} onClick={() => onPickClick(p)} />
                ))
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function LedgerView({
  data, highlightPick, pulsePick,
}: {
  data: PickTrackerData;
  highlightPick: string | null;
  pulsePick: string | null;
}) {
  const grouped = useMemo(() => {
    const map = new Map<number, RookiePickLedgerEntry[]>();
    for (const e of data.rookiePickLedger) {
      const arr = map.get(e.rookieRound) ?? [];
      arr.push(e);
      map.set(e.rookieRound, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [data.rookiePickLedger]);

  if (data.rookiePickLedger.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No kickers drafted yet. Rookie picks appear here as kickers come off the board.
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="max-h-[70vh] overflow-y-auto dc-scroll-x">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
              <th className="px-3 py-2">Pick</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Startup</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([round, entries]) => (
              <RoundGroup key={round} round={round} entries={entries} highlightPick={highlightPick} pulsePick={pulsePick} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RoundGroup({
  round, entries, highlightPick, pulsePick,
}: {
  round: number;
  entries: RookiePickLedgerEntry[];
  highlightPick: string | null;
  pulsePick: string | null;
}) {
  return (
    <>
      <tr className="bg-muted/40">
        <td colSpan={3} className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
          Round {round}
        </td>
      </tr>
      {entries.map((e) => (
        <tr
          key={e.rookiePick}
          id={`pick-${e.rookiePick.replace(".", "-")}`}
          className={cn(
            "border-b border-border/60 transition-colors",
            highlightPick === e.rookiePick && "bg-primary/10 ring-1 ring-primary/40",
            pulsePick === e.rookiePick && "animate-pulse",
          )}
          data-testid={`picktracker-ledger-${e.rookiePick}`}
        >
          <td className="px-3 py-2">
            <PickBadge pick={e.rookiePick} round={e.rookieRound} />
          </td>
          <td className="px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <TeamAvatar avatar={e.avatar} name={e.teamName} />
              <div className="min-w-0">
                <div className="font-medium truncate">{e.teamName}</div>
                <div className="text-xs text-muted-foreground truncate">{e.ownerName}</div>
              </div>
            </div>
          </td>
          <td className="px-3 py-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{e.startupRoundPick}</Badge>
              <span className="text-xs text-muted-foreground truncate">
                {e.playerName}{e.playerTeam ? ` · ${e.playerTeam}` : ""}
              </span>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
