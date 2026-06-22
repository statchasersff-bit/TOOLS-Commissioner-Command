/**
 * League Profile — the per-league commissioner hub.
 *
 * Opened at /league/:leagueId/:profileTab and rendered INSIDE the Dynasty
 * Command Center shell (header + mega-menu stay visible), mirroring the
 * embedded-page pattern used by ManagerPage / MatchupDetail. The active
 * internal tab is driven by the :profileTab URL segment and kept in sync via
 * wouter's setLocation, so deep links and browser back/forward work.
 *
 * Most tabs REUSE existing league-scoped surfaces (Lineups, Trades, Operations,
 * Finance). The net-new tabs (Overview, Rulebook, Managers, Draft Picks, Log)
 * are implemented alongside this shell.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useSleeper } from "@/contexts/SleeperContext";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { League, Team } from "@/types";
import {
  LayoutDashboard, Activity, BookOpen, Users, ShieldAlert,
  ArrowRightLeft, Layers, Coins, ClipboardList, ArrowLeft, Loader2,
} from "lucide-react";

// ── Reused league-scoped tab surfaces (already code-split elsewhere) ──────────
const Operations        = lazy(() => import("./tabs/CommissionerActivity"));
const LeagueLineupAudit  = lazy(() => import("./tabs/LeagueLineupAudit"));
const TradeReviewCenter  = lazy(() => import("./tabs/TradeReviewCenter").then(m => ({ default: m.TradeReviewCenter })));
const FinanceTab         = lazy(() => import("./tabs/FinanceTab").then(m => ({ default: m.FinanceTab })));

// ── Net-new tabs ──────────────────────────────────────────────────────────────
const LeagueOverview      = lazy(() => import("./league-profile/LeagueOverview").then(m => ({ default: m.LeagueOverview })));
const LeagueRulebook      = lazy(() => import("./league-profile/LeagueRulebook").then(m => ({ default: m.LeagueRulebook })));
const LeagueManagers      = lazy(() => import("./league-profile/LeagueManagers").then(m => ({ default: m.LeagueManagers })));
const LeagueDraftPicks    = lazy(() => import("./league-profile/LeagueDraftPicks").then(m => ({ default: m.LeagueDraftPicks })));
const LeagueCommissionerLog = lazy(() => import("./league-profile/LeagueCommissionerLog").then(m => ({ default: m.LeagueCommissionerLog })));

const GOLD = "#d4af37";

export type ProfileTabId =
  | "overview" | "operations" | "rulebook" | "managers"
  | "lineups" | "trades" | "draft-picks" | "finance" | "log";

const PROFILE_TABS: { id: ProfileTabId; label: string; icon: typeof Activity; needsLeague?: boolean }[] = [
  { id: "overview",    label: "Overview",    icon: LayoutDashboard },
  { id: "operations",  label: "Operations",  icon: Activity },
  { id: "rulebook",    label: "Rulebook",    icon: BookOpen },
  { id: "managers",    label: "Managers",    icon: Users, needsLeague: true },
  { id: "lineups",     label: "Lineups",     icon: ShieldAlert, needsLeague: true },
  { id: "trades",      label: "Trades",      icon: ArrowRightLeft, needsLeague: true },
  { id: "draft-picks", label: "Draft Picks", icon: Layers, needsLeague: true },
  { id: "finance",     label: "Finance",     icon: Coins },
  { id: "log",         label: "Log",         icon: ClipboardList },
];

const VALID_TABS = new Set(PROFILE_TABS.map(t => t.id));

interface LeagueProfileProps {
  leagueId: string;
  initialTab?: string;
  /** The hydrated active league from DCC (may lag the active-league switch). */
  league: League | null;
  userTeam: Team | null;
  /** DCC tab navigator, used by the back affordance. */
  onNavigate?: (mainTabId: string, subTabId: string) => void;
}

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-20 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  );
}

export function LeagueProfile({ leagueId, initialTab, league, userTeam, onNavigate }: LeagueProfileProps) {
  const sleeper = useSleeper();
  const [, setLocation] = useLocation();

  const seed = (initialTab && VALID_TABS.has(initialTab as ProfileTabId) ? initialTab : "overview") as ProfileTabId;
  const [activeTab, setActiveTab] = useState<ProfileTabId>(seed);

  // Ensure the global active league matches the profile being viewed, so the
  // reused surfaces that read sleeper.activeLeagueId (and DCC's league memo)
  // resolve THIS league.
  useEffect(() => {
    if (sleeper.activeLeagueId !== leagueId) sleeper.setActiveLeague(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Keep internal state in sync if the URL :profileTab changes (back/forward).
  useEffect(() => {
    if (initialTab && VALID_TABS.has(initialTab as ProfileTabId) && initialTab !== activeTab) {
      setActiveTab(initialTab as ProfileTabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const selectTab = (id: ProfileTabId) => {
    setActiveTab(id);
    setLocation(`/league/${leagueId}/${id}`, { replace: true });
  };

  const goBack = () => {
    onNavigate?.("portfolio", "portfolio-summary");
    setLocation("/portfolio/portfolio-summary");
  };

  // The hydrated League object trails the active-league switch by one fetch.
  const leagueReady = league?.id === leagueId;

  // Display name / avatar: prefer the hydrated league, fall back to the
  // lightweight summary from SleeperContext so the header shows immediately.
  const summary = sleeper.leagues.find(l => l.leagueId === leagueId) ?? null;
  const displayName = league?.name ?? summary?.name ?? "League";
  const avatar = (league?.avatar ?? (summary?.avatar ? `https://sleepercdn.com/avatars/thumbs/${summary.avatar}` : null)) || null;

  const renderTab = () => {
    switch (activeTab) {
      case "overview":
        return <LeagueOverview leagueId={leagueId} league={leagueReady ? league : null} onOpenTab={selectTab} />;
      case "operations":
        return <Operations leagueId={leagueId} />;
      case "rulebook":
        return <LeagueRulebook leagueId={leagueId} />;
      case "managers":
        return leagueReady
          ? <LeagueManagers leagueId={leagueId} league={league!} />
          : <NeedsLeague />;
      case "lineups":
        return leagueReady ? <LeagueLineupAudit league={league!} /> : <NeedsLeague />;
      case "trades":
        return leagueReady ? <TradeReviewCenter league={league!} /> : <NeedsLeague />;
      case "draft-picks":
        return leagueReady ? <LeagueDraftPicks leagueId={leagueId} league={league!} /> : <NeedsLeague />;
      case "finance":
        return <FinanceTab scopeLeagueId={leagueId} />;
      case "log":
        return <LeagueCommissionerLog leagueId={leagueId} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      {/* Profile header */}
      <div className="flex items-center gap-3">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          data-testid="button-league-profile-back"
        >
          <ArrowLeft className="w-4 h-4" /> Leagues
        </button>
        <div className="h-4 w-px bg-border" />
        {avatar ? (
          <img src={avatar} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-[var(--sc-blue-soft)] dark-any:bg-[#0b3a7a]/40 flex items-center justify-center flex-shrink-0">
            <Users className="w-4 h-4 text-[var(--sc-blue)] dark-any:text-blue-400/60" />
          </div>
        )}
        <h1 className="text-lg md:text-xl font-bold truncate text-foreground">{displayName}</h1>
      </div>

      {/* Internal tab bar — gold-underline pattern */}
      <div className="flex gap-1 overflow-x-auto border-b border-border/40 dark:border-white/[0.06] -mx-1 px-1">
        {PROFILE_TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              data-testid={`profile-tab-${t.id}`}
              className={cn(
                "relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
              {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ background: GOLD }} />}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<TabLoader />}>
        {renderTab()}
      </Suspense>
    </div>
  );
}

function NeedsLeague() {
  return (
    <Card className="p-8 flex flex-col items-center justify-center text-center gap-3 border-border/60">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading league data…</p>
    </Card>
  );
}

export default LeagueProfile;
