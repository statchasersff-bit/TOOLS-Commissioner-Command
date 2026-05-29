/**
 * Detailed single-matchup view, reached at /matchup/:leagueId from the
 * "Show Detailed Matchup" button on the Lineup Command → Matchups cards.
 *
 * Renders inside the Command Center shell when `embedded` (header/mega-menu stay
 * visible), or standalone (own back bar) otherwise. Re-fetches its own data by
 * leagueId + the current NFL week so the URL is shareable, reusing the same
 * scoring/optimizer helpers as the Matchups tab.
 *
 * Built as a responsive card experience (hero + intelligence strip + per-slot
 * comparison + alerts + bench impact), NOT a plain table — mirrored rows on
 * desktop, stacked comparison cards on mobile.
 */
import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Swords, TrendingUp, TrendingDown, Trophy, ArrowRight, Loader2,
  AlertTriangle, CalendarX, Zap, Info, Target, Activity, Ban,
} from "lucide-react";
import { useSleeper } from "@/contexts/SleeperContext";
import { usePlayerProfile } from "@/contexts/PlayerProfileContext";
import { ResponsivePlayerName } from "@/components/ResponsivePlayerName";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { getWeekSchedule, isTeamOnBye, type GameSchedule } from "@/lib/lineupCommand/gameLocking";
import { getLeagueMatchupsForLocking } from "@/lib/lineupCommand/sleeper";
import { calculateWinProbability } from "@/lib/lineupCommand/winProbability";
import { scoreByLeague } from "@/lib/lineupCommand/scoring";
import { mapSleeperStatsToScoring } from "@/lib/lineupCommand/projectionProviders";
import {
  SLEEPER_API, projKey, getLeagueScoring, fullName, playerPos, fmt1, analyzeLineup,
} from "@/pages/tabs/LineupCommand";

const NON_STARTER = new Set(["BN", "TAXI", "IR"]);
const SKILL_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const POS_GROUPS = ["QB", "RB", "WR", "TE"] as const;

// ─── Types ─────────────────────────────────────────────────────────────────
interface SlotPlayer {
  slot: string;
  pid: string;
  name: string;
  pos: string;
  team: string;
  proj: number;
  injury?: string;
  onBye: boolean;
}

interface Side {
  name: string;
  avatar: string | null;
  ownerId: string | null;
  record: { wins: number; losses: number; ties: number };
  proj: number;
  starters: SlotPlayer[];
  bench: SlotPlayer[];
  optimalStarters: SlotPlayer[];
  optimalProj: number;
}

interface Swap { inName: string; outName: string; inPos: string; outPos: string; projGain: number }

interface DetailData {
  leagueName: string;
  leagueAvatar: string | null;
  format: string;
  scoringFormat: string;
  week: number;
  hasBye: boolean;
  me: Side & { gain: number; swaps: Swap[] };
  opp: Side | null;
  spread: number;
  winPct: number;
  posAdvantages: Array<{ pos: string; edge: number }>;
}

// ─── Small helpers ───────────────────────────────────────────────────────────
function fmtRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${fmt1(Math.abs(n))}`;
}
function injLabel(inj?: string): string | null {
  if (!inj) return null;
  if (inj === "Out" || inj === "IR") return "OUT";
  if (inj === "Doubtful") return "DBT";
  if (inj === "Questionable") return "Q";
  return null;
}
function isClickablePid(pid: string, pos: string): boolean {
  // Sleeper offensive players have numeric ids; DEF ids are team codes (no profile).
  return pos !== "DEF" && /^\d+$/.test(pid);
}
function headshot(p: SlotPlayer): string {
  return p.pos === "DEF" && p.team
    ? `https://sleepercdn.com/images/team_logos/nfl/${p.team.toLowerCase()}.png`
    : `https://sleepercdn.com/content/nfl/players/thumb/${p.pid}.jpg`;
}

// ─── Page shell ──────────────────────────────────────────────────────────────
export default function MatchupDetail({ leagueId, embedded = false }: { leagueId: string; embedded?: boolean }) {
  const { user, leagues } = useSleeper();
  const [, setLocation] = useLocation();
  const league = useMemo(() => leagues.find(l => l.leagueId === leagueId), [leagues, leagueId]);

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.userId || !league) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const state = await fetch(`${SLEEPER_API}/state/nfl`).then(r => r.json());
        const week: number = state.week || 1;
        const season: string = state.season ?? "2025";
        const lockingEnabled = state.season_type !== "off";

        const [playerDb, projRaw, schedule, rosters, weekMatchups, users, scoring, lock] = await Promise.all([
          getSleeperPlayers(),
          fetch(
            `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular` +
            `&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`
          ).then(r => r.ok ? r.json() : []).catch(() => []),
          getWeekSchedule(season, String(week)).catch(() => ({} as GameSchedule)),
          fetch(`${SLEEPER_API}/league/${leagueId}/rosters`).then(r => r.ok ? r.json() : null),
          fetch(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`).then(r => r.ok ? r.json() : null),
          fetch(`${SLEEPER_API}/league/${leagueId}/users`).then(r => r.ok ? r.json() : null),
          getLeagueScoring(leagueId),
          getLeagueMatchupsForLocking([leagueId], String(week)).catch(
            () => ({ playedPlayerIds: {} as Record<string, boolean>, actualPoints: {} as Record<string, number> }),
          ),
        ]);
        if (cancelled) return;
        if (!rosters || !weekMatchups) throw new Error("PROJECTIONS");

        const rawProj: Record<string, Record<string, number>> = {};
        if (Array.isArray(projRaw)) {
          for (const entry of projRaw as any[]) {
            const pid = entry?.player_id != null ? String(entry.player_id) : null;
            if (pid && entry?.stats && typeof entry.stats === "object") rawProj[pid] = entry.stats;
          }
        }

        const field = projKey(league.scoringFormat);
        const proj = (pid: string): number => {
          const rawStats = rawProj[pid];
          if (!rawStats) return 0;
          const fallback = rawStats[field] ?? 0;
          if (!scoring) return fallback;
          return scoreByLeague(playerPos(playerDb, pid), mapSleeperStatsToScoring(rawStats), scoring, fallback);
        };
        const mk = (pid: string, slot: string): SlotPlayer => {
          const team = (playerDb[pid]?.team as string) || "";
          return {
            slot, pid,
            name: fullName(playerDb, pid),
            pos: playerPos(playerDb, pid),
            team,
            proj: proj(pid),
            injury: playerDb[pid]?.injury_status as string | undefined,
            onBye: isTeamOnBye(team, schedule),
          };
        };

        const myRoster = rosters.find((r: any) => r.owner_id === user.userId);
        if (!myRoster) throw new Error("You don't have a roster in this league.");
        const myMatchup = weekMatchups.find((m: any) => m.roster_id === myRoster.roster_id);
        if (!myMatchup) throw new Error("No matchup is scheduled for you this week.");
        const opponentMatchup = weekMatchups.find(
          (m: any) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id,
        ) ?? null;
        const oppRoster = opponentMatchup ? rosters.find((r: any) => r.roster_id === opponentMatchup.roster_id) : null;

        const userById = new Map<string, any>((users || []).map((u: any) => [u.user_id, u]));
        const nameFor = (roster: any, fallback: string): string => {
          const u = roster ? userById.get(roster.owner_id) : null;
          return roster?.metadata?.team_name || roster?.metadata?.team_abbrev || u?.display_name || fallback;
        };
        const avatarFor = (roster: any): string | null => {
          const u = roster ? userById.get(roster.owner_id) : null;
          return u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null;
        };
        const recordOf = (roster: any) => {
          const s = roster?.settings || {};
          return { wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0 };
        };

        const startingSlots = (league.rosterPositions || []).filter((s: string) => !NON_STARTER.has(s));
        const startersOf = (matchup: any): SlotPlayer[] =>
          (matchup?.starters || [])
            .map((pid: string, i: number) => ({ pid, slot: startingSlots[i] || "FLEX" }))
            .filter((x: any) => x.pid && x.pid !== "0")
            .map((x: any) => mk(x.pid, x.slot));
        const benchOf = (roster: any, matchup: any): SlotPlayer[] => {
          const starting = new Set<string>((matchup?.starters || []).filter((p: string) => p && p !== "0"));
          const ineligible = new Set<string>([...(roster?.reserve || []), ...(roster?.taxi || [])]);
          return (roster?.players || [])
            .filter((pid: string) => pid && pid !== "0" && !starting.has(pid) && !ineligible.has(pid))
            .map((pid: string) => mk(pid, "BN"))
            .filter((p: SlotPlayer) => SKILL_POS.includes(p.pos))
            .sort((a: SlotPlayer, b: SlotPlayer) => b.proj - a.proj);
        };

        const myStarters = startersOf(myMatchup);
        const oppStarters = opponentMatchup ? startersOf(opponentMatchup) : [];
        const myProj = myStarters.reduce((s, p) => s + p.proj, 0);
        const oppProj = oppStarters.reduce((s, p) => s + p.proj, 0);
        const spread = myProj - oppProj;
        const winPct = opponentMatchup ? calculateWinProbability(spread) : 50;

        // Optimizer for a roster (optimal lineup + bench → starter swaps).
        // Runs for both teams so each side gets its own Current/Optimal toggle.
        const optimize = (roster: any) => {
          const ineligible = new Set<string>([...(roster?.reserve || []), ...(roster?.taxi || [])]);
          const ids: string[] = (roster?.players || []).filter((pid: string) => !ineligible.has(pid));
          const a = analyzeLineup(
            ids, roster?.starters || [], rawProj, playerDb, league.rosterPositions || [],
            league.scoringFormat, season, String(week), schedule, lock.playedPlayerIds, lock.actualPoints, scoring, lockingEnabled,
          );
          return {
            optimalStarters: a.optimalStarters.map((pid, i) => mk(pid, startingSlots[i] || "FLEX")),
            optimalProj: a.optimalProj,
            gain: a.gain,
            swaps: a.swaps,
          };
        };
        const myOpt = optimize(myRoster);
        const oppOpt = oppRoster ? optimize(oppRoster) : null;

        // Positional advantage per group (my starters − opp starters).
        const posAdvantages = POS_GROUPS.map(g => {
          const mine = myStarters.filter(p => p.pos === g).reduce((s, p) => s + p.proj, 0);
          const opp = oppStarters.filter(p => p.pos === g).reduce((s, p) => s + p.proj, 0);
          return { pos: g, edge: mine - opp };
        }).filter(e => Math.abs(e.edge) > 0.01).sort((a, b) => b.edge - a.edge);

        setData({
          leagueName: league.name,
          leagueAvatar: league.avatar ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}` : null,
          format: league.format || "1QB",
          scoringFormat: league.scoringFormat,
          week,
          hasBye: !opponentMatchup,
          me: {
            name: nameFor(myRoster, "My Team"), avatar: avatarFor(myRoster), ownerId: myRoster.owner_id ?? null,
            record: recordOf(myRoster), proj: myProj, starters: myStarters, bench: benchOf(myRoster, myMatchup),
            optimalStarters: myOpt.optimalStarters, optimalProj: myOpt.optimalProj, gain: myOpt.gain, swaps: myOpt.swaps,
          },
          opp: opponentMatchup ? {
            name: nameFor(oppRoster, "Opponent"), avatar: avatarFor(oppRoster), ownerId: oppRoster?.owner_id ?? null,
            record: recordOf(oppRoster), proj: oppProj, starters: oppStarters, bench: benchOf(oppRoster, opponentMatchup),
            optimalStarters: oppOpt?.optimalStarters ?? [], optimalProj: oppOpt?.optimalProj ?? oppProj,
          } : null,
          spread, winPct, posAdvantages,
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not load this matchup.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.userId, league, leagueId]);

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation("/portfolio/lineup-command");
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn(!embedded && "min-h-screen bg-background", "text-foreground")}>
        <div className={cn(
          "flex items-center gap-2 py-3",
          !embedded && "sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-3.5 md:px-5",
        )}>
          <button
            onClick={goBack}
            data-testid="button-back-matchup"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Lineup Command
          </button>
        </div>

        {!league ? (
          <EmptyState title="League not found" body="This league may no longer be connected to your account." />
        ) : loading ? (
          <MatchupSkeleton />
        ) : error === "PROJECTIONS" ? (
          <EmptyState
            title="Projections unavailable"
            body="We couldn't load this week's projections from Sleeper. Try again in a moment."
            tone="error"
          />
        ) : error ? (
          <EmptyState title="Can't show this matchup" body={error} tone="error" />
        ) : data ? (
          <DetailBody data={data} />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

// ─── Body ──────────────────────────────────────────────────────────────────
function DetailBody({ data }: { data: DetailData }) {
  const { me, opp, hasBye } = data;
  // Each team has its own Current/Optimal toggle.
  const [myMode, setMyMode] = useState<"current" | "optimal">("current");
  const [oppMode, setOppMode] = useState<"current" | "optimal">("current");

  if (!me.starters.length) {
    return <EmptyState title="No lineup set" body="There are no starters set for your team this week." />;
  }

  return (
    <div className="pb-12 space-y-5">
      <HeroCard data={data} />
      <IntelStrip data={data} />

      {hasBye || !opp ? (
        <EmptyState title="Bye week" body="You don't have an opponent this week — enjoy the rest. Your optimal lineup is still below." inline />
      ) : null}

      {/* Starters comparison */}
      <section className="rounded-xl border border-border bg-card/40 p-3.5 md:p-4">
        <div className="flex items-center gap-2 mb-3.5">
          <Swords className="w-4 h-4 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" />
          <h2 className="text-sm font-semibold">Starters</h2>
        </div>
        <StartersComparison data={data} myMode={myMode} setMyMode={setMyMode} oppMode={oppMode} setOppMode={setOppMode} />
      </section>

      <BenchSection data={data} />
      <AlertsSection data={data} />
    </div>
  );
}

// ─── Hero card ───────────────────────────────────────────────────────────────
function HeroCard({ data }: { data: DetailData }) {
  const { me, opp, hasBye } = data;
  const isFav = data.spread >= 0;
  const myWin = Math.round(data.winPct);
  const oppWin = 100 - myWin;
  const t = winTheme(data.winPct);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[#d4af37]/20 bg-gradient-to-b from-[#0b3a7a]/[0.12] to-card/40 shadow-lg">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/50 to-transparent" />
      <div className="p-4 md:p-6">
        {/* League + week strip */}
        <div className="flex items-center justify-center gap-2 mb-4 text-center">
          {data.leagueAvatar ? (
            <img src={data.leagueAvatar} alt="" className="w-5 h-5 rounded object-cover ring-1 ring-black/5 dark-any:ring-white/10"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          ) : null}
          <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-[var(--sc-text-muted)] dark-any:text-white/55">{data.leagueName}</span>
          <span className="text-[10px] md:text-[11px] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37] font-bold">· Week {data.week}</span>
        </div>

        {/* Teams + scores */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 md:gap-6">
          <TeamIdentity side={me} align="left" highlight winPct={myWin} />

          <div className="flex flex-col items-center justify-center flex-shrink-0 gap-1">
            <div className="flex items-end gap-2 md:gap-4">
              <ScoreValue value={me.proj} lead={isFav && !hasBye} />
              <div className="flex flex-col items-center pb-2 md:pb-3">
                <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider text-[var(--sc-text-muted)] dark-any:text-white/30 rounded-full border border-[var(--sc-border)] dark-any:border-white/10 px-2 py-0.5">VS</span>
              </div>
              <ScoreValue value={hasBye ? null : (opp?.proj ?? 0)} lead={!isFav && !hasBye} />
            </div>
            <div className="flex items-center gap-6 md:gap-9">
              <span className="text-[9px] md:text-[10px] uppercase tracking-wider text-[var(--sc-text-muted)] dark-any:text-white/35 font-bold">Projected</span>
              <span className="text-[9px] md:text-[10px] uppercase tracking-wider text-[var(--sc-text-muted)] dark-any:text-white/35 font-bold">Projected</span>
            </div>
            {!hasBye && (
              <InfoLabel
                tip="Projected edge = your starters' total projection minus your opponent's, using this league's scoring settings."
                className={cn("mt-1.5 text-xs md:text-sm font-black tabular-nums", isFav ? "text-emerald-400" : "text-red-400")}
              >
                {signed(data.spread)} edge
              </InfoLabel>
            )}
          </div>

          {opp ? (
            <TeamIdentity side={opp} align="right" winPct={oppWin} />
          ) : (
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-black/[0.03] dark-any:bg-white/5 ring-2 ring-black/5 dark-any:ring-white/10 flex items-center justify-center">
                <CalendarX className="w-5 h-5 text-[var(--sc-text-muted)] dark-any:text-white/25" />
              </div>
              <span className="text-sm font-black text-[var(--sc-text-muted)] dark-any:text-white/40">Bye Week</span>
            </div>
          )}
        </div>

        {/* Win-probability bar */}
        {!hasBye && (
          <div className="mt-5">
            <div className="flex justify-between mb-1.5">
              <InfoLabel tip="Win probability from a normal-distribution model on the projected scoring margin." className={cn("text-[11px] md:text-xs font-black tabular-nums", t.txt)}>
                {myWin}% win
              </InfoLabel>
              <span className="text-[11px] md:text-xs font-bold tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{oppWin}%</span>
            </div>
            <div className="relative h-2.5 rounded-full bg-black/[0.03] dark-any:bg-white/6 overflow-hidden ring-1 ring-black/5 dark-any:ring-white/5">
              <div className="absolute inset-y-0 left-0 transition-all duration-700 rounded-full"
                style={{ width: `${myWin}%`, backgroundColor: t.bar, opacity: 0.95 }} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ScoreValue({ value, lead }: { value: number | null; lead?: boolean }) {
  return (
    <span className={cn(
      "text-4xl md:text-6xl font-black tabular-nums leading-none tracking-tight",
      value == null ? "text-[var(--sc-text-muted)] dark-any:text-white/25" : lead ? "text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" : "text-[var(--sc-text)] dark-any:text-white/90",
    )}>
      {value == null ? "—" : fmt1(value)}
    </span>
  );
}

function TeamIdentity({ side, align, highlight, winPct }: { side: Side; align: "left" | "right"; highlight?: boolean; winPct: number }) {
  const [, setLocation] = useLocation();
  const initial = side.name.trim().charAt(0).toUpperCase() || "?";
  const clickTeam = side.ownerId ? () => setLocation(`/managers/${side.ownerId}`) : undefined;
  return (
    <div className={cn("min-w-0 flex items-center gap-2.5 md:gap-3.5", align === "right" && "flex-row-reverse text-right")}>
      <div className={cn(
        "w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center flex-shrink-0 ring-2 shadow-md overflow-hidden",
        highlight ? "bg-[#0b3a7a]/65 ring-[#d4af37]/40" : "bg-black/[0.03] dark-any:bg-white/8 ring-black/5 dark-any:ring-white/18",
      )}>
        {side.avatar ? (
          <img src={side.avatar} alt={side.name} className="w-full h-full object-cover"
            onError={e => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (sib) sib.style.display = "";
            }} />
        ) : null}
        <span className={cn("text-lg md:text-2xl font-black leading-none select-none", highlight ? "text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" : "text-[var(--sc-text-muted)] dark-any:text-white/55")}
          style={{ display: side.avatar ? "none" : undefined }}>{initial}</span>
      </div>
      <div className={cn("min-w-0", align === "right" && "items-end")}>
        {clickTeam ? (
          <button onClick={clickTeam} className="text-sm md:text-base font-bold text-[var(--sc-text)] dark-any:text-white/90 hover:text-[var(--sc-gold-deep)] dark-any:hover:text-[#d4af37] transition-colors leading-tight block max-w-full truncate" title={side.name}>
            {side.name}
          </button>
        ) : (
          <p className="text-sm md:text-base font-bold text-[var(--sc-text)] dark-any:text-white/90 leading-tight truncate" title={side.name}>{side.name}</p>
        )}
        <p className="text-[10px] md:text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/40 tabular-nums leading-tight mt-0.5">
          {fmtRecord(side.record.wins, side.record.losses, side.record.ties)} · {winPct}% win
        </p>
      </div>
    </div>
  );
}

// ─── Intelligence strip ─────────────────────────────────────────────────────
function IntelStrip({ data }: { data: DetailData }) {
  const isFav = data.spread >= 0;
  const best = data.posAdvantages.find(p => p.edge > 0) ?? data.posAdvantages[0];
  const myWin = Math.round(data.winPct);
  const t = winTheme(data.winPct);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <IntelCard
        icon={isFav ? TrendingUp : TrendingDown}
        accent={data.hasBye ? "neutral" : isFav ? "gold" : "red"}
        label="Projected Edge"
        value={data.hasBye ? "—" : signed(data.spread)}
        helper={data.hasBye ? "Bye week" : isFav ? "You're favored" : "You're the underdog"}
        tip="Your starters' total projection minus your opponent's."
      />
      <IntelCard
        icon={Trophy}
        accent={data.hasBye ? "neutral" : t.accent}
        label="Win Probability"
        value={data.hasBye ? "—" : `${myWin}%`}
        helper={data.hasBye ? "No opponent" : "to win this week"}
        tip="Modeled from the projected scoring margin (normal distribution)."
      />
      <IntelCard
        icon={Target}
        accent={best && best.edge > 0 ? "green" : "neutral"}
        label="Best Position Edge"
        value={best ? `${best.pos} ${signed(best.edge)}` : "—"}
        helper={best ? (best.edge > 0 ? "Your strongest group" : "No group advantage") : "No data"}
        tip="The position group where your starters out-project (or trail) your opponent's by the most."
      />
      <IntelCard
        icon={Zap}
        accent={data.me.gain > 0.5 ? "green" : "neutral"}
        label="Optimal Lineup Gain"
        value={data.me.gain > 0.5 ? `+${fmt1(data.me.gain)}` : "0.0"}
        helper={data.me.gain > 0.5 ? "points left on bench" : "already optimal"}
        tip="Extra projected points if you started your highest-projected legal lineup."
      />
    </div>
  );
}

function IntelCard({ icon: Icon, label, value, helper, tip, accent }: {
  icon: typeof Zap; label: string; value: string; helper: string; tip: string;
  accent: "gold" | "green" | "red" | "neutral";
}) {
  const ring =
    accent === "gold" ? "before:bg-[#d4af37]" :
    accent === "green" ? "before:bg-emerald-400" :
    accent === "red" ? "before:bg-red-400" : "before:bg-black/[0.03] dark-any:before:bg-white/20";
  const iconCls =
    accent === "gold" ? "text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" :
    accent === "green" ? "text-emerald-400" :
    accent === "red" ? "text-red-400" : "text-[var(--sc-text-muted)] dark-any:text-white/40";
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border border-border bg-card/40 p-3 pl-3.5",
      "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:rounded-r", ring,
    )}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={cn("w-3.5 h-3.5", iconCls)} />
        <InfoLabel tip={tip} className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</InfoLabel>
      </div>
      <p className="text-xl md:text-2xl font-black tabular-nums leading-none">{value}</p>
      <p className="text-[10px] text-muted-foreground/70 mt-1 truncate">{helper}</p>
    </div>
  );
}

// ─── Segmented control ──────────────────────────────────────────────────────
function SegmentedControl({ value, onChange }: {
  value: "current" | "optimal"; onChange: (v: "current" | "optimal") => void;
}) {
  const opts: Array<{ id: "current" | "optimal"; label: string }> = [
    { id: "current", label: "Current" },
    { id: "optimal", label: "Optimal" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-[var(--sc-border)] dark-any:border-white/10 bg-black/[0.03] dark-any:bg-white/[0.03] p-0.5">
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          data-testid={`seg-${o.id}`}
          className={cn(
            "px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md transition-colors",
            value === o.id ? "bg-[#d4af37]/15 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" : "text-[var(--sc-text-muted)] hover:text-[var(--sc-text)] dark-any:text-white/45 dark-any:hover:text-white/75",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Starters comparison ────────────────────────────────────────────────────
function StartersComparison({ data, myMode, setMyMode, oppMode, setOppMode }: {
  data: DetailData;
  myMode: "current" | "optimal"; setMyMode: (v: "current" | "optimal") => void;
  oppMode: "current" | "optimal"; setOppMode: (v: "current" | "optimal") => void;
}) {
  const { me, opp, hasBye } = data;

  // Each team toggles its own Current/Optimal lineup independently.
  const left = myMode === "optimal" ? me.optimalStarters : me.starters;
  const right = oppMode === "optimal" ? (opp?.optimalStarters ?? []) : (opp?.starters ?? []);
  const leftLabel = me.name + (myMode === "optimal" ? " · Optimal" : "");
  const rightLabel = (opp?.name ?? "—") + (oppMode === "optimal" ? " · Optimal" : "");

  // Pair by slot index; pad to the longer side.
  const rows = useMemo(() => {
    const n = Math.max(left.length, right.length);
    return Array.from({ length: n }, (_, i) => ({
      slot: left[i]?.slot || right[i]?.slot || "FLEX",
      left: left[i] ?? null,
      right: right[i] ?? null,
    }));
  }, [left, right]);

  if (hasBye || !opp) {
    // No opponent — just show my lineup column with my toggle.
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]/60 truncate">{me.name}</span>
          <div className="ml-auto"><SegmentedControl value={myMode} onChange={setMyMode} /></div>
        </div>
        {left.map((p, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--sc-border)] dark-any:border-white/6 bg-black/[0.03] dark-any:bg-white/[0.02] px-2.5 py-1.5">
            <SlotBadge slot={p.slot} />
            <PlayerCell player={p} align="left" />
            <ProjValue value={p.proj} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Per-team toggles (each side controls its own lineup) */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex flex-col items-start gap-1.5 min-w-0">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]/60 truncate max-w-full">{leftLabel}</span>
          <SegmentedControl value={myMode} onChange={setMyMode} />
        </div>
        <div className="flex flex-col items-end gap-1.5 min-w-0">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--sc-text-muted)] dark-any:text-white/35 truncate max-w-full text-right">{rightLabel}</span>
          <SegmentedControl value={oppMode} onChange={setOppMode} />
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <ComparisonRow key={i} slot={row.slot} left={row.left} right={row.right} leftLabel={leftLabel} rightLabel={rightLabel} />
        ))}
      </div>
    </>
  );
}

function ComparisonRow({ slot, left, right, leftLabel, rightLabel }: {
  slot: string; left: SlotPlayer | null; right: SlotPlayer | null; leftLabel: string; rightLabel: string;
}) {
  const lp = left?.proj ?? 0;
  const rp = right?.proj ?? 0;
  const edge = lp - rp;
  const close = Math.abs(edge) < 1;
  const leftAdv = edge >= 1;
  const rightAdv = edge <= -1;

  const rowTint = leftAdv
    ? "border-emerald-500/25 bg-gradient-to-r from-emerald-500/[0.07] to-transparent"
    : rightAdv
      ? "border-red-500/25 bg-gradient-to-l from-red-500/[0.06] to-transparent"
      : "border-[var(--sc-border)] dark-any:border-white/8 bg-black/[0.03] dark-any:bg-white/[0.02]";

  return (
    <>
      {/* Desktop mirrored row */}
      <div className={cn(
        "hidden md:grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border px-3 py-2 transition-all",
        "hover:-translate-y-px hover:shadow-md hover:shadow-black/20", rowTint,
      )}>
        <div className="flex items-center gap-2.5 min-w-0">
          <PlayerCell player={left} align="left" />
          <ProjValue value={left?.proj ?? null} dim={!leftAdv} />
        </div>
        <div className="flex flex-col items-center justify-center w-16 flex-shrink-0 gap-1">
          <SlotBadge slot={slot} />
          <EdgePill edge={edge} close={close} />
        </div>
        <div className="flex items-center gap-2.5 min-w-0 flex-row-reverse">
          <PlayerCell player={right} align="right" />
          <ProjValue value={right?.proj ?? null} dim={!rightAdv} />
        </div>
      </div>

      {/* Mobile stacked card */}
      <div className={cn("md:hidden rounded-xl border p-2.5 space-y-2", rowTint)}>
        <div className="flex items-center justify-between">
          <SlotBadge slot={slot} />
          <EdgePill edge={edge} close={close} />
        </div>
        <MobilePlayerLine label={leftLabel} player={left} highlight={leftAdv} mine />
        <MobilePlayerLine label={rightLabel} player={right} highlight={rightAdv} />
        <p className="text-[10px] text-[var(--sc-text-muted)] dark-any:text-white/45 text-center pt-0.5">
          {close ? "Even matchup" : edge > 0
            ? <>Your edge: <span className="text-emerald-400 font-bold">{signed(edge)}</span></>
            : <>Opponent edge: <span className="text-red-400 font-bold">{signed(-edge)}</span></>}
        </p>
      </div>
    </>
  );
}

function MobilePlayerLine({ label, player, highlight, mine }: { label: string; player: SlotPlayer | null; highlight?: boolean; mine?: boolean }) {
  return (
    <div className={cn(
      "rounded-lg border px-2.5 py-1.5 flex items-center gap-2",
      highlight ? (mine ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-red-500/30 bg-red-500/[0.05]") : "border-[var(--sc-border)] dark-any:border-white/6 bg-black/[0.03] dark-any:bg-white/[0.015]",
    )}>
      <PlayerCell player={player} align="left" />
      <ProjValue value={player?.proj ?? null} />
    </div>
  );
}

// ─── Player cell ─────────────────────────────────────────────────────────────
function PlayerCell({ player, align }: { player: SlotPlayer | null; align: "left" | "right" }) {
  const { openPlayerProfile } = usePlayerProfile();
  if (!player) {
    return (
      <div className={cn("flex items-center gap-2 min-w-0 flex-1", align === "right" && "flex-row-reverse text-right")}>
        <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-black/[0.03] dark-any:bg-white/5 ring-1 ring-black/5 dark-any:ring-white/10 flex-shrink-0 flex items-center justify-center">
          <Ban className="w-3.5 h-3.5 text-[var(--sc-text-muted)] dark-any:text-white/20" />
        </div>
        <span className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/30 italic">Empty</span>
      </div>
    );
  }
  const clickable = isClickablePid(player.pid, player.pos);
  const inj = injLabel(player.injury);
  const meta = [player.pos, player.team || null, player.onBye ? "BYE" : null].filter(Boolean).join(" · ");

  return (
    <div className={cn("flex items-center gap-2 min-w-0 flex-1", align === "right" && "flex-row-reverse text-right")}>
      <Headshot player={player} />
      <div className="min-w-0">
        {clickable ? (
          <button
            onClick={() => openPlayerProfile(player.pid)}
            data-testid={`player-${player.pid}`}
            className={cn("block max-w-full text-[12px] md:text-[13px] font-semibold text-[var(--sc-text)] dark-any:text-white/90 hover:text-[var(--sc-gold-deep)] dark-any:hover:text-[#d4af37] transition-colors leading-tight", align === "right" && "ml-auto")}
          >
            <ResponsivePlayerName name={player.name} />
          </button>
        ) : (
          <span className="block text-[12px] md:text-[13px] font-semibold text-[var(--sc-text)] dark-any:text-white/85 leading-tight truncate" title={player.name}>{player.name}</span>
        )}
        <div className={cn("flex items-center gap-1 mt-0.5", align === "right" && "justify-end")}>
          <span className="text-[9px] md:text-[10px] text-[var(--sc-text-muted)] dark-any:text-white/40 truncate">{meta}</span>
          {inj && (
            <span className={cn(
              "text-[7px] font-bold px-1 rounded flex-shrink-0",
              inj === "OUT" ? "text-red-400 bg-red-500/10" : "text-yellow-400 bg-yellow-500/10",
            )}>{inj}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Headshot({ player }: { player: SlotPlayer }) {
  const [failed, setFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const posColor: Record<string, string> = {
    QB: "text-rose-400 bg-rose-500/15", RB: "text-emerald-400 bg-emerald-500/15",
    WR: "text-sky-400 bg-sky-500/15", TE: "text-yellow-400 bg-yellow-500/15",
    K: "text-purple-400 bg-purple-500/15", DEF: "text-slate-300 bg-slate-500/15",
  };
  // DEF already renders the team logo as its main image, so it needs no badge.
  const showLogo = player.pos !== "DEF" && !!player.team && !logoFailed;

  return (
    <div className="relative flex-shrink-0">
      {failed ? (
        <div className={cn("w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center text-[9px] font-black", posColor[player.pos] || "text-[var(--sc-text-muted)] dark-any:text-white/50 bg-black/[0.03] dark-any:bg-white/10")}>
          {player.pos || "?"}
        </div>
      ) : (
        <img
          src={headshot(player)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-8 h-8 md:w-9 md:h-9 rounded-full object-cover bg-black/[0.03] dark-any:bg-white/5 ring-1 ring-black/5 dark-any:ring-white/10"
        />
      )}
      {showLogo && (
        <img
          src={`https://sleepercdn.com/images/team_logos/nfl/${player.team.toLowerCase()}.png`}
          alt=""
          loading="lazy"
          onError={() => setLogoFailed(true)}
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full object-contain bg-[#0a1628] ring-1 ring-black/40 p-px"
        />
      )}
    </div>
  );
}

function SlotBadge({ slot }: { slot: string }) {
  const label = slot === "SUPER_FLEX" ? "SFLX" : slot === "REC_FLEX" ? "RFLX" : slot;
  return (
    <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider text-[var(--sc-text-muted)] dark-any:text-white/70 bg-black/[0.03] dark-any:bg-white/8 border border-[var(--sc-border)] dark-any:border-white/10 rounded px-1.5 py-0.5 whitespace-nowrap">
      {label}
    </span>
  );
}

function EdgePill({ edge, close }: { edge: number; close: boolean }) {
  const cls = close
    ? "text-[var(--sc-text-muted)] dark-any:text-white/40 bg-black/[0.03] dark-any:bg-white/8 border-[var(--sc-border)] dark-any:border-white/10"
    : edge > 0
      ? "text-emerald-600 dark-any:text-emerald-300 bg-emerald-500/12 border-emerald-500/25"
      : "text-red-600 dark-any:text-red-300 bg-red-500/12 border-red-500/25";
  return (
    <span className={cn("text-[8px] md:text-[9px] font-black tabular-nums border rounded-full px-1.5 py-0.5 whitespace-nowrap", cls)}>
      {close ? "EVEN" : `${signed(edge)}`}
    </span>
  );
}

function ProjValue({ value, dim }: { value: number | null; dim?: boolean }) {
  return (
    <span className={cn(
      "text-[13px] md:text-base font-black tabular-nums flex-shrink-0 w-11 md:w-12 text-center",
      value == null ? "text-[var(--sc-text-muted)]/60 dark-any:text-white/20" : value < 0.5 ? "text-red-500 dark-any:text-red-400/80" : dim ? "text-[var(--sc-text-muted)] dark-any:text-white/45" : "text-[var(--sc-text)] dark-any:text-white/85",
    )}>
      {value == null ? "—" : fmt1(value)}
    </span>
  );
}

// ─── Lineup alerts ───────────────────────────────────────────────────────────
function AlertsSection({ data }: { data: DetailData }) {
  const alerts = useMemo(() => buildAlerts(data), [data]);
  if (!alerts.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card/40 p-3.5 md:p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-semibold">Lineup Alerts</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {alerts.map((a, i) => (
          <div key={i} className={cn("flex items-start gap-2.5 rounded-lg border px-2.5 py-2", a.cls)}>
            <a.icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[12px] font-bold leading-tight">{a.title}</p>
              <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/50 leading-snug mt-0.5">{a.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface Alert { icon: typeof AlertTriangle; title: string; body: string; cls: string }
function buildAlerts(data: DetailData): Alert[] {
  const out: Alert[] = [];
  const { me, opp } = data;

  // Zero-projection starters.
  for (const p of me.starters.filter(s => s.proj < 0.5 && !s.onBye)) {
    out.push({ icon: Ban, title: `${p.name} projects 0.0`, body: `Your ${p.slot} has no projected points — check status before lock.`, cls: "border-red-500/25 bg-red-500/[0.05] text-red-600 dark-any:text-red-300" });
  }
  // Bye-week starters.
  for (const p of me.starters.filter(s => s.onBye)) {
    out.push({ icon: CalendarX, title: `${p.name} is on bye`, body: `Your ${p.slot} starter doesn't play this week.`, cls: "border-orange-500/25 bg-orange-500/[0.05] text-orange-600 dark-any:text-orange-300" });
  }
  // Injured / questionable starters.
  for (const p of me.starters) {
    const inj = injLabel(p.injury);
    if (inj && !p.onBye) {
      out.push({ icon: Activity, title: `${p.name} — ${p.injury}`, body: `Injury designation on your ${p.slot}. Have a backup ready.`, cls: inj === "OUT" ? "border-red-500/25 bg-red-500/[0.05] text-red-600 dark-any:text-red-300" : "border-yellow-500/25 bg-yellow-500/[0.05] text-yellow-600 dark-any:text-yellow-300" });
    }
  }
  // Optimal-lineup improvement.
  if (me.gain > 0.5) {
    out.push({ icon: Zap, title: `Optimize for +${fmt1(me.gain)} pts`, body: `Switching to your optimal lineup raises your projection to ${fmt1(me.optimalProj)}.`, cls: "border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-600 dark-any:text-emerald-300" });
  }
  // Largest advantage / disadvantage by slot (only when there's an opponent).
  if (opp) {
    const paired = me.starters.map((p, i) => ({ p, o: opp.starters[i], edge: p.proj - (opp.starters[i]?.proj ?? 0) }))
      .filter(x => x.o);
    if (paired.length) {
      const best = paired.reduce((a, b) => (b.edge > a.edge ? b : a));
      const worst = paired.reduce((a, b) => (b.edge < a.edge ? b : a));
      if (best.edge >= 1) out.push({ icon: TrendingUp, title: `Biggest edge: ${best.p.name}`, body: `Out-projects ${best.o!.name} by ${signed(best.edge)} at ${best.p.slot}.`, cls: "border-[#d4af37]/25 bg-[#d4af37]/[0.05] text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]" });
      if (worst.edge <= -1) out.push({ icon: TrendingDown, title: `Biggest gap: ${worst.o!.name}`, body: `Their ${worst.o!.slot} out-projects ${worst.p.name} by ${signed(-worst.edge)}.`, cls: "border-red-500/25 bg-red-500/[0.05] text-red-600 dark-any:text-red-300" });
    }
  }
  return out;
}

// ─── Bench impact ────────────────────────────────────────────────────────────
function BenchSection({ data }: { data: DetailData }) {
  const { me, opp } = data;
  const topSwap = me.swaps.length ? [...me.swaps].sort((a, b) => b.projGain - a.projGain)[0] : null;
  return (
    <section className="rounded-xl border border-border bg-card/40 p-3.5 md:p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-emerald-400" />
        <h2 className="text-sm font-semibold">Bench Impact</h2>
      </div>

      {/* Best available upgrade */}
      <div className={cn(
        "rounded-lg border px-3 py-2.5 mb-3",
        topSwap ? "border-emerald-500/25 bg-emerald-500/[0.05]" : "border-[var(--sc-border)] dark-any:border-white/8 bg-black/[0.03] dark-any:bg-white/[0.02]",
      )}>
        {topSwap ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Zap className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-[12px] text-[var(--sc-text)] dark-any:text-white/80">
              Best upgrade: start <span className="font-bold text-emerald-600 dark-any:text-emerald-300">{topSwap.inName}</span> over <span className="font-bold text-[var(--sc-text-muted)] dark-any:text-white/60">{topSwap.outName}</span>
            </span>
            <span className="ml-auto text-[12px] font-black text-emerald-400 tabular-nums">+{fmt1(topSwap.projGain)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-[12px] text-[var(--sc-text-muted)] dark-any:text-white/70">Your starters are already your best available lineup.</span>
          </div>
        )}
        {me.gain > 0.5 && (
          <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/45 mt-1.5">
            Full optimization adds <span className="font-bold text-emerald-400">+{fmt1(me.gain)}</span> projected points ({fmt1(me.proj)} → {fmt1(me.optimalProj)}).
          </p>
        )}
      </div>

      {/* Top 3 bench each */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BenchColumn title={`${me.name} — Bench`} players={me.bench.slice(0, 3)} mine />
        {opp ? <BenchColumn title={`${opp.name} — Bench`} players={opp.bench.slice(0, 3)} /> : null}
      </div>
    </section>
  );
}

function BenchColumn({ title, players, mine }: { title: string; players: SlotPlayer[]; mine?: boolean }) {
  return (
    <div>
      <p className={cn("text-[9px] font-bold uppercase tracking-[0.2em] mb-2 truncate", mine ? "text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]/60" : "text-[var(--sc-text-muted)] dark-any:text-white/35")}>{title}</p>
      {players.length ? (
        <div className="space-y-1.5">
          {players.map(p => (
            <div key={p.pid} className="flex items-center gap-2 rounded-lg border border-[var(--sc-border)] dark-any:border-white/6 bg-black/[0.03] dark-any:bg-white/[0.015] px-2.5 py-1.5">
              <PlayerCell player={p} align="left" />
              <ProjValue value={p.proj} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-[var(--sc-text-muted)] dark-any:text-white/35 py-1">No bench players.</p>
      )}
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────
function winTheme(winPct: number): { bar: string; txt: string; accent: "green" | "gold" | "red" | "neutral" } {
  if (winPct >= 65) return { bar: "#22c55e", txt: "text-emerald-400", accent: "green" };
  if (winPct >= 50) return { bar: "#60a5fa", txt: "text-blue-400", accent: "neutral" };
  if (winPct >= 35) return { bar: "#facc15", txt: "text-yellow-400", accent: "gold" };
  return { bar: "#f87171", txt: "text-red-400", accent: "red" };
}

function InfoLabel({ tip, children, className }: { tip: string; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1 cursor-help", className)}>
          {children}
          <Info className="w-2.5 h-2.5 opacity-50" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ title, body, tone, inline }: { title: string; body: string; tone?: "error"; inline?: boolean }) {
  return (
    <div className={cn(inline ? "rounded-xl border border-border bg-card/40 p-6" : "px-3.5 md:px-5 py-16", "text-center")}>
      <div className={cn("inline-flex items-center justify-center w-11 h-11 rounded-full mb-3", tone === "error" ? "bg-red-500/10" : "bg-black/[0.03] dark-any:bg-white/5")}>
        {tone === "error" ? <AlertTriangle className="w-5 h-5 text-red-400" /> : <CalendarX className="w-5 h-5 text-[var(--sc-text-muted)] dark-any:text-white/40" />}
      </div>
      <h3 className={cn("text-sm font-bold", tone === "error" ? "text-red-600 dark-any:text-red-300" : "text-[var(--sc-text)] dark-any:text-white/80")}>{title}</h3>
      <p className="text-[12px] text-muted-foreground mt-1 max-w-sm mx-auto">{body}</p>
    </div>
  );
}

// ─── Skeletons ───────────────────────────────────────────────────────────────
function MatchupSkeleton() {
  return (
    <div className="pb-12 space-y-5 animate-pulse">
      {/* Hero */}
      <div className="rounded-2xl border border-border bg-card/40 p-6">
        <div className="h-3 w-40 bg-black/[0.03] dark-any:bg-white/8 rounded mx-auto mb-5" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-black/[0.03] dark-any:bg-white/8" />
            <div className="space-y-2"><div className="h-3 w-24 bg-black/[0.03] dark-any:bg-white/8 rounded" /><div className="h-2 w-16 bg-black/[0.03] dark-any:bg-white/8 rounded" /></div>
          </div>
          <div className="h-12 w-32 bg-black/[0.03] dark-any:bg-white/8 rounded" />
          <div className="flex items-center gap-3 flex-row-reverse">
            <div className="w-14 h-14 rounded-full bg-black/[0.03] dark-any:bg-white/8" />
            <div className="space-y-2"><div className="h-3 w-24 bg-black/[0.03] dark-any:bg-white/8 rounded" /><div className="h-2 w-16 bg-black/[0.03] dark-any:bg-white/8 rounded" /></div>
          </div>
        </div>
        <div className="h-2.5 w-full bg-black/[0.03] dark-any:bg-white/8 rounded-full mt-6" />
      </div>
      {/* Intel strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-xl border border-border bg-card/40" />)}
      </div>
      {/* Rows */}
      <div className="rounded-xl border border-border bg-card/40 p-4 space-y-2">
        <div className="h-4 w-24 bg-black/[0.03] dark-any:bg-white/8 rounded mb-3" />
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-black/[0.03] dark-any:bg-white/[0.03]" />)}
      </div>
      {/* Bench */}
      <div className="rounded-xl border border-border bg-card/40 p-4 space-y-2">
        <div className="h-4 w-28 bg-black/[0.03] dark-any:bg-white/8 rounded mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-black/[0.03] dark-any:bg-white/[0.03]" />)}
        </div>
      </div>
    </div>
  );
}
