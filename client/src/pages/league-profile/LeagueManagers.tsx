/**
 * Managers — a per-league manager table; clicking a manager opens an in-tab
 * profile (roster summary, activity, strikes/flags, trade history, notes, risk).
 * Reuses the existing activity, lineup-integrity, trade, and commissioner-log
 * APIs scoped to this league + roster.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Users, ArrowLeft, ShieldAlert, ArrowRightLeft } from "lucide-react";
import type { League, Team } from "@/types";
import { fetchManagers, type ManagerRow, riskLabel, activityLabelColor, ACTIVITY_LABEL_DISPLAY } from "@/lib/commissionerActivityApi";
import { fetchManagerHistory } from "@/lib/commissionerTradesApi";
import { lineupIntegrityApi } from "@/lib/lineupIntegrityApi";
import { commissionerLogApi } from "@/lib/leagueProfileApi";

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold", className)}>{children}</span>;
}

function teamForRoster(league: League, rosterId: number, teamName: string | null): Team | undefined {
  return league.teams.find(t => Number(t.id) === rosterId)
    ?? (teamName ? league.teams.find(t => t.name === teamName) : undefined);
}

export function LeagueManagers({ leagueId, league }: { leagueId: string; league: League }) {
  const [selected, setSelected] = useState<ManagerRow | null>(null);

  const q = useQuery({
    queryKey: ["commish-activity", "managers", leagueId],
    queryFn: () => fetchManagers(leagueId),
  });

  const managers = useMemo(
    () => [...(q.data?.managers ?? [])].sort((a, b) => b.inactivityRiskScore - a.inactivityRiskScore),
    [q.data],
  );

  if (selected) {
    return <ManagerProfile leagueId={leagueId} league={league} manager={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
        <h3 className="text-sm font-bold text-foreground">Managers</h3>
        <span className="text-xs text-muted-foreground">{managers.length} manager{managers.length === 1 ? "" : "s"}</span>
      </div>

      {q.isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading managers…</Card>
      ) : managers.length === 0 ? (
        <Card className="border-border/60">
          <div className="flex flex-col items-center justify-center text-center py-14 px-4">
            <Users className="w-8 h-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-semibold text-foreground">No manager data yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">Open the Operations tab to run the first activity scan for this league.</p>
          </div>
        </Card>
      ) : (
        <div className="rounded-2xl overflow-hidden bg-[var(--sc-card-bg)] border border-[var(--sc-border)] shadow-[var(--sc-shadow-card)] dark-any:border-white/6 dark-any:shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 640 }}>
              <thead>
                <tr className="bg-[var(--sc-blue)] dark-any:bg-white/[0.02] border-b border-[var(--sc-blue-2)] dark-any:border-white/6 text-[9px] uppercase tracking-widest text-white/70 dark-any:text-white/30">
                  <th className="text-left font-bold px-3 md:px-5 py-2.5 whitespace-nowrap">Manager</th>
                  <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Activity</th>
                  <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Risk</th>
                  <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Txns</th>
                  <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Trades</th>
                  <th className="text-center font-bold px-2 py-2.5 whitespace-nowrap">Empty</th>
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => {
                  const rl = riskLabel(m.inactivityRiskScore);
                  return (
                    <tr
                      key={m.rosterId}
                      className="border-b border-[#edf2f7] dark-any:border-white/5 last:border-0 hover:bg-[var(--sc-card-soft)] dark-any:hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setSelected(m)}
                      data-testid={`manager-row-${m.rosterId}`}
                    >
                      <td className="px-3 md:px-5 py-2.5">
                        <div className="font-bold text-[var(--sc-blue)] dark-any:text-white/90 truncate">{m.teamName ?? "—"}</div>
                        <div className="text-xs text-[var(--sc-text-muted)] dark-any:text-white/30 truncate">{m.managerName ?? ""}</div>
                      </td>
                      <td className="text-center px-2"><Pill className={activityLabelColor(m.activityLabel)}>{ACTIVITY_LABEL_DISPLAY[m.activityLabel] ?? m.activityLabel}</Pill></td>
                      <td className="text-center px-2"><Pill className={rl.color}>{rl.text}</Pill></td>
                      <td className="text-center px-2 tabular-nums text-[var(--sc-text)] dark-any:text-white/70">{m.transactionsCount}</td>
                      <td className="text-center px-2 tabular-nums text-[var(--sc-text-muted)] dark-any:text-white/40">{m.tradesCount}</td>
                      <td className="text-center px-2 tabular-nums">{m.emptyStarterSlots > 0 ? <span className="font-bold text-orange-600 dark-any:text-orange-400">{m.emptyStarterSlots}</span> : <span className="text-[var(--sc-text-muted)] dark-any:text-white/40">0</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ManagerProfile({ leagueId, league, manager, onBack }: {
  leagueId: string; league: League; manager: ManagerRow; onBack: () => void;
}) {
  const team = teamForRoster(league, manager.rosterId, manager.teamName);
  const rl = riskLabel(manager.inactivityRiskScore);

  const historyQ = useQuery({
    queryKey: ["commish-trades", "manager", leagueId, manager.rosterId],
    queryFn: () => fetchManagerHistory(manager.rosterId, leagueId),
  });
  const strikesQ = useQuery({ queryKey: ["li", leagueId, "strikes"], queryFn: () => lineupIntegrityApi.strikes(leagueId) });
  const logQ = useQuery({ queryKey: ["commish-log", leagueId], queryFn: () => commissionerLogApi.list({ leagueId }) });

  const myStrikes = (strikesQ.data?.strikes ?? []).filter(s => s.rosterId === manager.rosterId);
  const myLog = (logQ.data?.entries ?? []).filter(e => e.rosterId === manager.rosterId);

  const topPlayers = useMemo(
    () => [...(team?.roster ?? [])].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 8),
    [team],
  );

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="manager-profile-back">
        <ArrowLeft className="w-4 h-4" /> All managers
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-bold text-foreground">{manager.teamName ?? "Team"}</h3>
        <span className="text-sm text-muted-foreground">{manager.managerName ?? ""}</span>
        <Pill className={rl.color}>{rl.text} risk</Pill>
      </div>

      {/* Activity snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Activity Score", value: manager.activityScore },
          { label: "Transactions", value: manager.transactionsCount },
          { label: "Trades", value: manager.tradesCount },
          { label: "Empty Starters", value: manager.emptyStarterSlots },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-xl font-bold tabular-nums text-foreground">{s.value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Roster summary */}
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Roster — Top Assets</p>
          {topPlayers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Roster not loaded.</p>
          ) : (
            <ul className="space-y-1">
              {topPlayers.map((p, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate">{p.name} <span className="text-muted-foreground text-xs">{p.pos}</span></span>
                  <span className="tabular-nums text-muted-foreground text-xs">{Math.round(p.value ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Trade history */}
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5"><ArrowRightLeft className="w-3.5 h-3.5" /> Trade History</p>
          {historyQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (historyQ.data?.totalTrades ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded trades. Ingest trades in the Trades tab.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Total trades" value={historyQ.data!.totalTrades} />
              <Stat label="Net value" value={Math.round(historyQ.data!.netValue)} />
              <Stat label="Future picks sent" value={historyQ.data!.futurePicksTradedAway} />
              <Stat label="High-risk" value={historyQ.data!.highRiskTrades} />
            </div>
          )}
        </Card>
      </div>

      {/* Strikes & flags */}
      <Card className="p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Strikes & Flags</p>
        {myStrikes.length === 0 && myLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">No strikes or flags on record.</p>
        ) : (
          <ul className="space-y-1.5">
            {myStrikes.map((s) => (
              <li key={`s-${s.id}`} className="flex items-center justify-between text-sm border-b border-border/30 last:border-0 py-1">
                <span className="text-foreground">Strike — {s.reason}</span>
                <span className="text-xs text-muted-foreground">Wk {s.week} · {s.status}</span>
              </li>
            ))}
            {myLog.map((e) => (
              <li key={`l-${e.id}`} className="flex items-center justify-between text-sm border-b border-border/30 last:border-0 py-1">
                <span className="text-foreground">{e.category.replace(/_/g, " ")}{e.note ? ` — ${e.note}` : ""}</span>
                <span className="text-xs text-muted-foreground">{e.severity} · {e.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-bold tabular-nums text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
