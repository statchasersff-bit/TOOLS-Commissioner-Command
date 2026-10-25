/**
 * League Overview — the profile landing page. Answers "what is the current
 * state of this league?" with status cards + a Needs Attention panel + league
 * meta, aggregated from the existing commissioner APIs.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  HeartPulse, ShieldAlert, ArrowRightLeft, Coins, Flag, Activity,
  AlertTriangle, ChevronRight,
} from "lucide-react";
import type { League } from "@/types";
import type { ProfileTabId } from "../LeagueProfile";
import { fetchOverview } from "@/lib/commissionerActivityApi";
import { fetchAnalytics } from "@/lib/commissionerTradesApi";
import { commissionerLogApi } from "@/lib/leagueProfileApi";
import { lineupIntegrityApi } from "@/lib/lineupIntegrityApi";

function StatCard({ icon: Icon, label, value, accent, onClick, sub }: {
  icon: typeof Activity; label: string; value: React.ReactNode;
  accent: "gold" | "red" | "blue" | "emerald" | "yellow" | "slate";
  onClick?: () => void; sub?: string;
}) {
  const color: Record<string, string> = {
    gold:   "bg-[#d4af37]/10 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]",
    red:    "bg-red-500/10 text-red-600 dark-any:text-red-400",
    blue:   "bg-blue-500/10 text-blue-600 dark-any:text-blue-400",
    emerald:"bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
    yellow: "bg-yellow-500/10 text-yellow-700 dark-any:text-yellow-400",
    slate:  "bg-slate-500/10 text-slate-500 dark-any:text-slate-400",
  };
  return (
    <Card
      className={cn("p-4 flex items-start gap-3 min-w-0", onClick && "cursor-pointer hover:bg-[var(--sc-card-soft)] transition-colors")}
      onClick={onClick}
      data-testid={`overview-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", color[accent])}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold tabular-nums leading-tight text-foreground">{value}</p>
        <p className="text-[11px] font-medium leading-tight mt-0.5 text-muted-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{sub}</p>}
      </div>
    </Card>
  );
}

export function LeagueOverview({ leagueId, league, onOpenTab }: {
  leagueId: string; league: League | null; onOpenTab: (id: ProfileTabId) => void;
}) {
  const overviewQ = useQuery({ queryKey: ["commish-activity", "overview", leagueId], queryFn: () => fetchOverview(leagueId) });
  const analyticsQ = useQuery({ queryKey: ["commish-trades", "analytics", leagueId], queryFn: () => fetchAnalytics(leagueId) });
  const logQ = useQuery({ queryKey: ["commish-log", leagueId, "open"], queryFn: () => commissionerLogApi.list({ leagueId, status: "open" }) });
  const strikesQ = useQuery({ queryKey: ["li", leagueId, "strikes"], queryFn: () => lineupIntegrityApi.strikes(leagueId) });

  const snap = overviewQ.data?.snapshot ?? null;
  const openAlerts = overviewQ.data?.openAlertCount ?? 0;
  const unreviewedTrades = analyticsQ.data?.unreviewedCount ?? 0;
  const openFlags = logQ.data?.entries?.length ?? 0;
  const activeStrikes = (strikesQ.data?.strikes ?? []).filter(s => s.status === "active").length;
  const lineupIssues = snap?.totalEmptyStarterSlots ?? 0;
  const inactive = snap?.inactiveManagerCount ?? 0;

  const needsAttention = useMemo(() => {
    const items: { text: string; tab: ProfileTabId }[] = [];
    if (inactive > 0) items.push({ text: `${inactive} manager${inactive === 1 ? "" : "s"} flagged inactive`, tab: "managers" });
    if (openFlags + activeStrikes > 0) items.push({ text: `${openFlags + activeStrikes} open commissioner flag${openFlags + activeStrikes === 1 ? "" : "s"}`, tab: "log" });
    if (openAlerts > 0) items.push({ text: `${openAlerts} open activity alert${openAlerts === 1 ? "" : "s"}`, tab: "operations" });
    return items;
  }, [inactive, lineupIssues, unreviewedTrades, openFlags, activeStrikes, openAlerts]);

  const teamCount = league?.totalRosters ?? league?.teams?.length ?? null;
  const format = league ? `${league.scoringFormat}${league.format ? ` · ${league.format}` : ""}` : "—";

  const meta: { label: string; value: string }[] = [
    { label: "Platform", value: league?.platform ?? "Sleeper" },
    { label: "Format", value: format },
    { label: "Teams", value: teamCount != null ? String(teamCount) : "—" },
    { label: "Week", value: snap?.week != null ? `Week ${snap.week}` : "—" },
  ];

  return (
    <div className="space-y-5">
      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={HeartPulse} label="Health Score" value={snap?.leagueActivityScore != null ? `${snap.leagueActivityScore}` : "—"} sub={snap ? "/ 100" : "no scan yet"} accent="gold" onClick={() => onOpenTab("operations")} />
        <StatCard icon={ShieldAlert} label="Lineup Issues" value={lineupIssues} accent={lineupIssues ? "red" : "slate"} />
        <StatCard icon={ArrowRightLeft} label="Trades to Review" value={unreviewedTrades} accent={unreviewedTrades ? "yellow" : "slate"} />
        <StatCard icon={Coins} label="Finance" value="View" accent="emerald" onClick={() => onOpenTab("finance")} />
        <StatCard icon={Flag} label="Active Flags" value={openFlags + activeStrikes} accent={(openFlags + activeStrikes) ? "red" : "slate"} onClick={() => onOpenTab("log")} />
        <StatCard icon={Activity} label="Recent Activity" value={snap?.totalTransactions ?? "—"} sub="transactions" accent="blue" onClick={() => onOpenTab("operations")} />
      </div>

      {/* Needs Attention */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
          <h3 className="text-sm font-bold text-foreground">Needs Attention</h3>
        </div>
        <Card className="p-4">
          {needsAttention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs attention right now. {!snap && "Open the Operations tab to run the first scan."}</p>
          ) : (
            <ul className="space-y-1">
              {needsAttention.map((it, i) => (
                <li key={i}>
                  <button
                    onClick={() => onOpenTab(it.tab)}
                    className="w-full flex items-center gap-2 text-sm text-foreground/90 hover:text-foreground py-1.5 group"
                    data-testid={`needs-attention-${it.tab}`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-[#d4af37] flex-shrink-0" />
                    <span className="text-left">{it.text}</span>
                    <ChevronRight className="w-3.5 h-3.5 ml-auto text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* League meta */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
          <h3 className="text-sm font-bold text-foreground">League Details</h3>
        </div>
        <Card className="p-4">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {meta.map((m) => (
              <div key={m.label}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</dt>
                <dd className="text-sm font-bold text-foreground mt-0.5 truncate">{m.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
