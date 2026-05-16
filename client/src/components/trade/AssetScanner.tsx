/**
 * AssetScanner — Cross-league trade scan.
 *
 * Pick one asset you want to give and one asset you want back.
 * Scans ALL of your leagues in parallel: finds leagues where you own
 * the give asset, then surfaces every manager in those leagues who
 * owns the want asset.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { fetchSleeperLeagueFull } from "@/lib/sleeperApi";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { League, Team, Player } from "@/types";
import {
  Search, X, ArrowRight, Loader2, CheckCircle2,
  AlertTriangle, ScanLine, RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanMatch {
  partner: Team;
  partnerPlayer: Player;
  giveValue: number;
  wantValue: number;
  delta: number;
}

interface ScanLeagueResult {
  leagueId: string;
  leagueName: string;
  matches: ScanMatch[];
}

type ScanState = "idle" | "scanning" | "done";

// ─── PlayerSearchField ────────────────────────────────────────────────────────

function PlayerSearchField({
  label,
  accent,
  pool,
  selected,
  onChange,
  placeholder,
  getPlayerValue,
  getRedraftValue,
}: {
  label: string;
  accent: "give" | "want";
  pool: Player[];
  selected: Player | null;
  onChange: (p: Player | null) => void;
  placeholder?: string;
  getPlayerValue: (p: Player) => number;
  getRedraftValue: (p: Player) => number;
}) {
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync query when selected changes from outside
  useEffect(() => {
    if (!selected) setQuery("");
    else setQuery(selected.name);
  }, [selected]);

  // Close dropdown on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const filtered = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.toLowerCase();
    return pool
      .filter(p => p.name.toLowerCase().includes(q))
      .sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
      .slice(0, 8);
  }, [query, pool, getPlayerValue]);

  function handleSelect(p: Player) {
    onChange(p);
    setQuery(p.name);
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setQuery("");
    setOpen(false);
  }

  const accentColor = accent === "give" ? "text-amber-400" : "text-emerald-400";
  const accentDot   = accent === "give" ? "bg-amber-400"  : "bg-emerald-400";
  const accentBorder = accent === "give"
    ? "border-amber-400/40 bg-amber-400/5"
    : "border-emerald-400/40 bg-emerald-400/5";

  return (
    <div className="flex-1 min-w-0" ref={containerRef}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={cn("w-2 h-2 rounded-full flex-shrink-0", accentDot)} />
        <span className={cn("text-[11px] font-bold uppercase tracking-wide", accentColor)}>
          {label}
        </span>
      </div>

      {selected ? (
        // Selected state — show chip with clear button
        <div className={cn(
          "flex items-center gap-2.5 rounded-xl border px-3 py-2.5",
          accentBorder,
        )}>
          <PlayerAvatar
            id={selected.sleeperId ?? selected.id}
            name={selected.name}
            pos={selected.pos}
            team={selected.team ?? ""}
            size="sm"
            sub={`${getPlayerValue(selected).toLocaleString()} dyn`}
          />
          <button
            onClick={handleClear}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            data-testid={`btn-clear-${accent}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        // Search input + dropdown
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={placeholder ?? "Search players…"}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border/60 bg-muted/20 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-[#d4af37]/40 focus:ring-1 focus:ring-[#d4af37]/10 transition-colors"
              data-testid={`input-search-${accent}`}
            />
          </div>

          {open && filtered.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 z-30 rounded-xl border border-border bg-background shadow-xl overflow-hidden max-h-[240px] overflow-y-auto">
              {filtered.map(p => (
                <button
                  key={p.sleeperId ?? p.id}
                  onPointerDown={e => { e.preventDefault(); handleSelect(p); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                  data-testid={`opt-${accent}-${p.sleeperId ?? p.id}`}
                >
                  <PlayerAvatar
                    id={p.sleeperId ?? p.id}
                    name={p.name}
                    pos={p.pos}
                    team={p.team ?? ""}
                    size="sm"
                    sub={`${getPlayerValue(p).toLocaleString()} dyn · ${getRedraftValue(p).toLocaleString()} rd`}
                  />
                </button>
              ))}
            </div>
          )}

          {open && query.length >= 2 && filtered.length === 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 z-30 rounded-xl border border-border bg-background shadow-xl px-4 py-3">
              <p className="text-xs text-muted-foreground">No matches in your current league.</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                If you own them in another league, the scan will still find matches.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Value delta pill ─────────────────────────────────────────────────────────

function DeltaPill({ delta }: { delta: number }) {
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
  if (Math.abs(delta) < 50) {
    return <span className="text-[10px] font-semibold text-muted-foreground px-1.5 py-0.5 rounded bg-muted/40">≈ Even</span>;
  }
  return (
    <span className={cn(
      "text-[10px] font-bold px-1.5 py-0.5 rounded",
      delta > 0 ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10",
    )}>
      {delta > 0 ? `+${fmt(delta)}` : fmt(delta)} dyn
    </span>
  );
}

// ─── AssetScanner ─────────────────────────────────────────────────────────────

export function AssetScanner({ league, userTeam }: { league: League; userTeam: Team }) {
  const { getPlayerValue, getRedraftValue } = useValueModel();
  const sleeperCtx = useSleeper();

  const [givePlayer, setGivePlayer] = useState<Player | null>(null);
  const [wantPlayer, setWantPlayer] = useState<Player | null>(null);
  const [scanState, setScanState]   = useState<ScanState>("idle");
  const [progress, setProgress]     = useState(0);
  const [total, setTotal]           = useState(0);
  const [results, setResults]       = useState<ScanLeagueResult[]>([]);
  const [leaguesWithGive, setLeaguesWithGive] = useState(0);

  // Player pools
  const givePools = useMemo(() => {
    // Give pool: user's own roster only (they can only offer what they own)
    const seen = new Set<string>();
    return userTeam.roster.filter(p => {
      const key = p.sleeperId ?? p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [userTeam]);

  const wantPool = useMemo(() => {
    // Want pool: all players across the entire current league
    const seen = new Set<string>();
    return league.teams.flatMap(t => t.roster).filter(p => {
      const key = p.sleeperId ?? p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [league]);

  const isReady = !!givePlayer && !!wantPlayer;

  const handleScan = useCallback(async () => {
    if (!isReady || !sleeperCtx.user) return;

    const allLeagues: Array<{ leagueId: string; name: string }> =
      sleeperCtx.leagues ?? [];

    setScanState("scanning");
    setProgress(0);
    setTotal(allLeagues.length);
    setResults([]);
    setLeaguesWithGive(0);

    const giveSid = givePlayer!.sleeperId ?? givePlayer!.id;
    const wantSid = wantPlayer!.sleeperId ?? wantPlayer!.id;
    const giveName = givePlayer!.name.toLowerCase();
    const wantName = wantPlayer!.name.toLowerCase();

    function playerMatches(p: Player, sid: string, name: string): boolean {
      const pSid = p.sleeperId ?? p.id;
      return pSid === sid || p.name.toLowerCase() === name;
    }

    let foundGive = 0;

    await Promise.allSettled(
      allLeagues.map(async (summary) => {
        try {
          const data = await fetchSleeperLeagueFull(summary.leagueId, sleeperCtx.user!.userId);
          const { league: lg, userTeamId } = data;

          const ut = userTeamId ? lg.teams.find((t: Team) => t.id === userTeamId) : null;
          if (!ut) return;

          // Does user own the give player in this league?
          const userOwns = ut.roster.some((p: Player) => playerMatches(p, giveSid, giveName));
          if (!userOwns) return;

          foundGive++;
          setLeaguesWithGive(foundGive);

          // Find partners who own the want player
          const matches: ScanMatch[] = [];
          for (const team of lg.teams) {
            if (team.id === userTeamId) continue;
            const partnerPlayer = team.roster.find((p: Player) =>
              playerMatches(p, wantSid, wantName),
            );
            if (partnerPlayer) {
              const giveValue = getPlayerValue(givePlayer!);
              const wantValue = getPlayerValue(partnerPlayer);
              matches.push({
                partner: team,
                partnerPlayer,
                giveValue,
                wantValue,
                delta: wantValue - giveValue,
              });
            }
          }

          if (matches.length > 0) {
            setResults(prev => [
              ...prev,
              { leagueId: summary.leagueId, leagueName: summary.name, matches },
            ]);
          }
        } catch {
          // skip unreachable leagues silently
        } finally {
          setProgress(p => p + 1);
        }
      }),
    );

    setScanState("done");
  }, [isReady, givePlayer, wantPlayer, getPlayerValue, sleeperCtx]);

  const totalMatches = results.reduce((s, r) => s + r.matches.length, 0);
  const noConnection = !sleeperCtx.user;

  return (
    <div className="space-y-5" data-testid="asset-scanner">

      {/* Search inputs */}
      <div className="rounded-2xl border border-border/50 bg-muted/10 p-4 space-y-3">
        <div className="flex items-start gap-3">
          {/* Give */}
          <PlayerSearchField
            label="You Give"
            accent="give"
            pool={givePools}
            selected={givePlayer}
            onChange={setGivePlayer}
            placeholder="Search your roster…"
            getPlayerValue={getPlayerValue}
            getRedraftValue={getRedraftValue}
          />

          {/* Divider arrow */}
          <div className="flex-shrink-0 mt-8">
            <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
          </div>

          {/* Want */}
          <PlayerSearchField
            label="You Want"
            accent="want"
            pool={wantPool}
            selected={wantPlayer}
            onChange={setWantPlayer}
            placeholder="Search any player…"
            getPlayerValue={getPlayerValue}
            getRedraftValue={getRedraftValue}
          />
        </div>

        {/* Value comparison row */}
        {givePlayer && wantPlayer && (
          <div className="flex items-center gap-3 px-1 pt-1">
            <span className="text-[11px] text-muted-foreground">
              Value:
              <span className="text-foreground font-semibold ml-1">
                {getPlayerValue(givePlayer).toLocaleString()}
              </span>
              <span className="text-muted-foreground/40 mx-1.5">→</span>
              <span className="text-foreground font-semibold">
                {getPlayerValue(wantPlayer).toLocaleString()}
              </span>
            </span>
            <DeltaPill delta={getPlayerValue(wantPlayer) - getPlayerValue(givePlayer)} />
          </div>
        )}

        {/* Scan button */}
        <button
          onClick={handleScan}
          disabled={!isReady || scanState === "scanning" || noConnection}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all",
            isReady && scanState !== "scanning" && !noConnection
              ? "bg-[#0b3a7a] hover:bg-[#0b3a7a]/80 text-white"
              : "bg-muted/30 text-muted-foreground/40 cursor-not-allowed",
          )}
          data-testid="btn-scan-leagues"
        >
          {scanState === "scanning" ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Scanning {progress}/{total} leagues…</>
          ) : scanState === "done" ? (
            <><RefreshCw className="w-3.5 h-3.5" /> Scan Again</>
          ) : (
            <><ScanLine className="w-3.5 h-3.5" /> Scan {sleeperCtx.leagues?.length ?? "All"} Leagues</>
          )}
        </button>

        {noConnection && (
          <p className="text-[11px] text-muted-foreground/50 text-center">
            Connect your Sleeper account to scan leagues.
          </p>
        )}
      </div>

      {/* Progress bar during scan */}
      {scanState === "scanning" && total > 0 && (
        <div className="space-y-1.5">
          <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#d4af37]/60 transition-all duration-300"
              style={{ width: `${Math.round((progress / total) * 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground/60 text-center">
            Found {leaguesWithGive} league{leaguesWithGive !== 1 ? "s" : ""} where you own {givePlayer?.name}
            {results.length > 0 ? ` · ${totalMatches} trade partner${totalMatches !== 1 ? "s" : ""} so far` : ""}
          </p>
        </div>
      )}

      {/* Results */}
      {(scanState === "done" || (scanState === "scanning" && results.length > 0)) && (
        <div className="space-y-1">

          {/* Summary banner */}
          {scanState === "done" && (
            <div className={cn(
              "rounded-xl border px-4 py-2.5 flex items-center gap-2 mb-4",
              totalMatches > 0
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-border/40 bg-muted/10",
            )}>
              {totalMatches > 0 ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              )}
              <p className="text-xs font-medium">
                {totalMatches > 0
                  ? `${totalMatches} trade partner${totalMatches !== 1 ? "s" : ""} across ${results.length} league${results.length !== 1 ? "s" : ""} own ${wantPlayer?.name}`
                  : leaguesWithGive === 0
                    ? `You don't own ${givePlayer?.name} in any of your leagues`
                    : `No partners in your leagues own ${wantPlayer?.name}`
                }
              </p>
            </div>
          )}

          {/* Per-league groups */}
          {results.map(result => (
            <div key={result.leagueId} className="space-y-2">
              {/* League header */}
              <div className="flex items-center gap-2 px-1 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60">
                  {result.leagueName}
                </span>
                <span className="flex-1 h-px bg-border/30" />
                <span className="text-[10px] text-muted-foreground/40">
                  {result.matches.length} partner{result.matches.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Match rows */}
              {result.matches.map(match => (
                <div
                  key={`${result.leagueId}:${match.partner.id}`}
                  className="rounded-xl border border-border/50 p-3.5 flex items-center gap-3 hover:border-border transition-colors"
                  data-testid={`scan-match-${result.leagueId}-${match.partner.id}`}
                >
                  {/* Partner info */}
                  <img
                    src={match.partner.avatar || "https://sleepercdn.com/images/v2/icons/player_default.webp"}
                    alt={match.partner.owner}
                    className="w-8 h-8 rounded-full object-cover bg-muted flex-shrink-0"
                    onError={e => { e.currentTarget.src = "https://sleepercdn.com/images/v2/icons/player_default.webp"; }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{match.partner.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{match.partner.owner}</p>
                  </div>

                  {/* Asset swap visual */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* What you give */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[9px] font-bold text-amber-400/70 uppercase">Give</span>
                          <div className="flex items-center gap-1 bg-amber-400/8 border border-amber-400/20 rounded-lg px-2 py-1">
                            <span className="text-[11px] font-semibold text-amber-200">{givePlayer?.name.split(" ").pop()}</span>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="text-[11px]">
                        {givePlayer?.name} · {match.giveValue.toLocaleString()} dyn
                      </TooltipContent>
                    </Tooltip>

                    <ArrowRight className="w-3 h-3 text-muted-foreground/30" />

                    {/* What you get */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[9px] font-bold text-emerald-400/70 uppercase">Get</span>
                          <div className="flex items-center gap-1 bg-emerald-400/8 border border-emerald-400/20 rounded-lg px-2 py-1">
                            <span className="text-[11px] font-semibold text-emerald-200">{match.partnerPlayer.name.split(" ").pop()}</span>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="text-[11px]">
                        {match.partnerPlayer.name} · {match.wantValue.toLocaleString()} dyn
                      </TooltipContent>
                    </Tooltip>

                    {/* Delta */}
                    <DeltaPill delta={match.delta} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
