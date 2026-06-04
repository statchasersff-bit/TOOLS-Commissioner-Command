/**
 * Lineup Integrity & Anti-Tanking (Commissioner Command).
 *
 * A decision-support surface: scan weekly Sleeper lineups, surface empty / bye /
 * inactive / IR starters, suspicious benchings, large optimality gaps, and
 * potential tanking SIGNALS, then let a commissioner review, note, and issue
 * strikes. Neutral language throughout — signals, never accusations.
 *
 * Sub-tabs: Overview · Lineup Checks · Anti-Tanking Review · Strike Tracker ·
 * Manager History · Weekly Report · Settings (+ an all-leagues view).
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useSleeper } from "@/contexts/SleeperContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert, RefreshCw, Layers, ArrowLeft, Copy, AlertTriangle, ListChecks,
  FileText, Settings as SettingsIcon, Scale, History, Gavel, CheckCircle2,
} from "lucide-react";
import {
  lineupIntegrityApi as api,
  type LineupCheck,
  type LineupAlert,
  type ManagerHistoryRow,
  type StrikeRow,
  type LineupIntegritySettings,
} from "@/lib/lineupIntegrityApi";

const GOLD = "#d4af37";

type SubTab =
  | "overview" | "checks" | "tanking" | "strikes" | "history" | "report" | "settings";

const SUB_TABS: { id: SubTab; label: string; icon: typeof ShieldAlert }[] = [
  { id: "overview", label: "Overview", icon: ShieldAlert },
  { id: "checks", label: "Lineup Checks", icon: ListChecks },
  { id: "tanking", label: "Anti-Tanking Review", icon: AlertTriangle },
  { id: "strikes", label: "Strike Tracker", icon: Gavel },
  { id: "history", label: "Manager History", icon: History },
  { id: "report", label: "Weekly Report", icon: FileText },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

// ── small display helpers ────────────────────────────────────────────────────

function integrityColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#84cc16";
  if (score >= 50) return "#eab308";
  if (score >= 25) return "#f97316";
  return "#ef4444";
}
function integrityLabel(score: number): string {
  if (score >= 90) return "Clean";
  if (score >= 75) return "Minor Issue";
  if (score >= 50) return "Needs Review";
  if (score >= 25) return "Serious Issue";
  return "Critical";
}
function tankingColor(label: string): string {
  switch (label) {
    case "critical": return "#ef4444";
    case "high": return "#f97316";
    case "medium": return "#eab308";
    default: return "#64748b";
  }
}
function severityColor(sev: string): string {
  switch (sev) {
    case "critical": return "#ef4444";
    case "high": return "#f97316";
    case "medium": return "#eab308";
    case "low": return "#84cc16";
    default: return "#64748b";
  }
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { toast } = useToast();
  return (
    <Button
      size="sm" variant="outline"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => toast({ title: "Copied to clipboard" }),
          () => toast({ title: "Copy failed", variant: "destructive" }),
        );
      }}
    >
      <Copy className="w-3.5 h-3.5 mr-1.5" /> {label}
    </Button>
  );
}

function teamLabel(c: { teamName: string | null; managerName: string | null; rosterId: number }): string {
  return c.teamName || c.managerName || `Roster ${c.rosterId}`;
}

// ── main page ────────────────────────────────────────────────────────────────

export default function CommissionerLineupIntegrity({ onBack }: { onBack?: () => void }) {
  const sleeper = useSleeper();
  const leagues = sleeper.leagues;
  const { toast } = useToast();

  const [view, setView] = useState<"league" | "multi">("league");
  const [sub, setSub] = useState<SubTab>("overview");
  const [leagueId, setLeagueId] = useState<string>(sleeper.activeLeagueId ?? leagues[0]?.leagueId ?? "");

  const refreshMut = useMutation({
    mutationFn: () => api.refresh(leagueId),
    onSuccess: (r) => {
      if (r.skipped) {
        toast({ title: "Scan skipped", description: r.reason });
        return;
      }
      const issues = r.alertsCreated;
      toast({
        title: `Checked ${r.lineupsChecked} lineup${r.lineupsChecked === 1 ? "" : "s"}`,
        description: issues > 0 ? `${issues} issue${issues === 1 ? "" : "s"} flagged (${r.criticalAlerts} critical).` : "No issues flagged.",
      });
      queryClient.invalidateQueries({ queryKey: ["li", leagueId] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e?.message, variant: "destructive" }),
  });

  if (leagues.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 text-muted-foreground">
        <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="font-semibold text-foreground">No leagues connected</p>
        <p className="text-sm mt-1">Connect a Sleeper account with a league to run lineup integrity checks.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.25)" }}>
          <ShieldAlert className="w-5 h-5" style={{ color: GOLD }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black tracking-tight text-foreground leading-none">Lineup Integrity</h1>
          <p className="text-xs text-muted-foreground mt-1">Catch lineup issues before they become league drama. Signals, not accusations.</p>
        </div>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
        )}
      </div>

      {/* View switch + league picker + scan */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="inline-flex rounded-xl border border-border/60 p-0.5 bg-card/40">
          <button
            onClick={() => setView("league")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === "league" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Single League
          </button>
          <button
            onClick={() => setView("multi")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${view === "multi" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Layers className="w-3.5 h-3.5" /> All Leagues ({leagues.length})
          </button>
        </div>

        {view === "league" && (
          <>
            <select
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
              className="rounded-xl border border-border/60 bg-card/40 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40"
            >
              {leagues.map((l) => (
                <option key={l.leagueId} value={l.leagueId}>{l.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                size="sm"
                disabled={refreshMut.isPending || !leagueId}
                onClick={() => refreshMut.mutate()}
                style={{ background: GOLD, color: "#1a1206" }}
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshMut.isPending ? "animate-spin" : ""}`} />
                {refreshMut.isPending ? "Scanning…" : "Run Lineup Check"}
              </Button>
            </div>
          </>
        )}
      </div>

      {view === "multi" ? (
        <MultiLeagueDashboard
          leagueIds={leagues.map((l) => l.leagueId)}
          nameById={Object.fromEntries(leagues.map((l) => [l.leagueId, l.name]))}
          onOpenLeague={(id) => { setLeagueId(id); setView("league"); setSub("overview"); }}
        />
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-border/60 mb-5 -mx-1 px-1">
            {SUB_TABS.map((t) => {
              const Icon = t.icon;
              const active = sub === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSub(t.id)}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ background: GOLD }} />}
                </button>
              );
            })}
          </div>

          {leagueId && (
            <div key={leagueId}>
              {sub === "overview" && <OverviewTab leagueId={leagueId} onScan={() => refreshMut.mutate()} scanning={refreshMut.isPending} />}
              {sub === "checks" && <ChecksTab leagueId={leagueId} />}
              {sub === "tanking" && <AntiTankingTab leagueId={leagueId} />}
              {sub === "strikes" && <StrikeTrackerTab leagueId={leagueId} />}
              {sub === "history" && <ManagerHistoryTab leagueId={leagueId} />}
              {sub === "report" && <WeeklyReportTab leagueId={leagueId} />}
              {sub === "settings" && <SettingsTab leagueId={leagueId} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-2xl font-black mt-1" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  );
}

function Loading() {
  return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
}
function EmptyHint({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-muted-foreground">{text}</div>;
}

function OverviewTab({ leagueId, onScan, scanning }: { leagueId: string; onScan: () => void; scanning: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "overview"],
    queryFn: () => api.overview(leagueId),
  });

  if (isLoading) return <Loading />;
  const s = data?.summary;
  if (!s || s.totalTeamsChecked === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground mb-4">No lineup checks yet for this week.</p>
        <Button onClick={onScan} disabled={scanning} style={{ background: GOLD, color: "#1a1206" }}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${scanning ? "animate-spin" : ""}`} /> Run Lineup Check
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Avg Integrity" value={`${s.averageIntegrityScore}/100`} accent={integrityColor(s.averageIntegrityScore)} />
        <KpiCard label="Clean Lineups" value={`${s.cleanLineups}/${s.totalTeamsChecked}`} />
        <KpiCard label="Needs Review" value={s.needsReview} accent={s.needsReview ? "#eab308" : undefined} />
        <KpiCard label="Empty Slots" value={s.emptyStarterSlots} accent={s.emptyStarterSlots ? "#ef4444" : undefined} />
        <KpiCard label="Inactive Starters" value={s.inactiveStarters} accent={s.inactiveStarters ? "#f97316" : undefined} />
        <KpiCard label="Suspicious Benchings" value={s.suspiciousBenchings} />
        <KpiCard label="High Tanking Risk" value={s.highTankingRiskTeams} accent={s.highTankingRiskTeams ? "#f97316" : undefined} />
        <KpiCard label="Open Alerts" value={s.openAlerts} />
      </div>

      {data!.highestRiskTeams.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-2">Highest-Risk Teams</h3>
          <div className="space-y-2">
            {data!.highestRiskTeams.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
                <span className="font-semibold text-sm flex-1 min-w-0 truncate">{teamLabel(c)}</span>
                <Badge text={integrityLabel(c.lineupIntegrityScore)} color={integrityColor(c.lineupIntegrityScore)} />
                {c.tankingRiskScore >= 25 && <Badge text={`Tanking ${c.riskLabel}`} color={tankingColor(c.riskLabel)} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {data!.topAlerts.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-2">Top Alerts</h3>
          <div className="space-y-2">
            {data!.topAlerts.map((a) => <AlertCard key={a.id} alert={a} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color, background: `${color}1a`, border: `1px solid ${color}55` }}>
      {text}
    </span>
  );
}

function AlertCard({ alert }: { alert: LineupAlert }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Badge text={alert.severity} color={severityColor(alert.severity)} />
        <span className="font-semibold text-sm">{alert.title}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
      {alert.suggestedAction && <p className="text-[11px] text-muted-foreground/80 mt-1 italic">{alert.suggestedAction}</p>}
    </div>
  );
}

// ── Lineup Checks ────────────────────────────────────────────────────────────

const CHECK_FILTERS: { id: string; label: string; flag?: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs Review" },
  { id: "empty_starter", label: "Empty Starter", flag: "empty_starter" },
  { id: "bye_starter", label: "Bye Starter", flag: "bye_starter" },
  { id: "inactive_starter", label: "Inactive Starter", flag: "inactive_starter" },
  { id: "suspicious_benching", label: "Suspicious Benching", flag: "suspicious_benching" },
  { id: "potential_tanking", label: "Potential Tanking", flag: "potential_tanking" },
];

function ChecksTab({ leagueId }: { leagueId: string }) {
  const [filter, setFilter] = useState("all");
  const f = CHECK_FILTERS.find((x) => x.id === filter);
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "checks"],
    queryFn: () => api.checks(leagueId),
  });

  const checks = useMemo(() => {
    let rows = data?.checks ?? [];
    if (filter === "needs_review") rows = rows.filter((c) => c.reviewStatus === "needs_review");
    else if (f?.flag) rows = rows.filter((c) => c.flags.includes(f.flag!));
    return rows;
  }, [data, filter, f]);

  if (isLoading) return <Loading />;
  if (!data?.checks.length) return <EmptyHint text="No lineup checks yet — run a check from the header." />;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CHECK_FILTERS.map((x) => (
          <button
            key={x.id}
            onClick={() => setFilter(x.id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${filter === x.id ? "border-[#d4af37]/50 bg-[#d4af37]/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-center px-2 py-2">Integrity</th>
              <th className="text-center px-2 py-2">Tanking</th>
              <th className="text-center px-2 py-2">Empty</th>
              <th className="text-center px-2 py-2">Bye</th>
              <th className="text-center px-2 py-2">Inact.</th>
              <th className="text-center px-2 py-2">Susp.</th>
              <th className="text-center px-2 py-2">Gap</th>
              <th className="text-left px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2 font-semibold">{teamLabel(c)}</td>
                <td className="px-2 py-2 text-center">
                  <span className="font-bold" style={{ color: integrityColor(c.lineupIntegrityScore) }}>{c.lineupIntegrityScore}</span>
                </td>
                <td className="px-2 py-2 text-center">
                  {c.tankingRiskScore >= 25 ? <Badge text={c.riskLabel} color={tankingColor(c.riskLabel)} /> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-2 text-center">{c.emptyStarterSlots || "—"}</td>
                <td className="px-2 py-2 text-center">{c.byeStarters || "—"}</td>
                <td className="px-2 py-2 text-center">{c.inactiveStarters + c.irStarters || "—"}</td>
                <td className="px-2 py-2 text-center">{c.suspiciousBenchings || "—"}</td>
                <td className="px-2 py-2 text-center">{c.optimalityGap > 0 ? c.optimalityGap.toFixed(1) : "—"}</td>
                <td className="px-2 py-2 text-muted-foreground capitalize">{c.reviewStatus.replace(/_/g, " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Anti-Tanking Review ──────────────────────────────────────────────────────

function AntiTankingTab({ leagueId }: { leagueId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "checks"],
    queryFn: () => api.checks(leagueId),
  });
  const week = data?.week ?? 0;
  const teams = (data?.checks ?? []).filter((c) => c.tankingRiskScore >= 25)
    .sort((a, b) => b.tankingRiskScore - a.tankingRiskScore);

  if (isLoading) return <Loading />;
  if (!teams.length) return <EmptyHint text="No teams currently show a tanking risk signal. This is good news." />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        These are <strong>signals for review</strong>, not determinations. Review context and follow league bylaws before any action.
      </p>
      {teams.map((c) => <TankingCard key={c.id} check={c} leagueId={leagueId} week={week} />)}
    </div>
  );
}

function buildSignals(c: LineupCheck): string[] {
  const out: string[] = [];
  if (c.optimalityGap > 0) out.push(`Projected lineup was ${c.optimalityGap.toFixed(1)} points below the estimated optimal lineup`);
  if (c.suspiciousBenchings > 0) out.push(`Benched ${c.suspiciousBenchings} higher-projected eligible player${c.suspiciousBenchings === 1 ? "" : "s"}`);
  if (c.emptyStarterSlots > 0) out.push(`Left ${c.emptyStarterSlots} starter slot${c.emptyStarterSlots === 1 ? "" : "s"} empty`);
  if (c.inactiveStarters + c.irStarters > 0) out.push(`Started ${c.inactiveStarters + c.irStarters} inactive/IR player${c.inactiveStarters + c.irStarters === 1 ? "" : "s"}`);
  if (c.flags.includes("repeat_lineup_issue")) out.push("Similar issues occurred in recent weeks");
  if (c.flags.includes("playoff_integrity")) out.push("Occurred in a matchup that may affect playoff seeding");
  return out;
}

function TankingCard({ check, leagueId, week }: { check: LineupCheck; leagueId: string; week: number }) {
  const { toast } = useToast();
  const [showStrike, setShowStrike] = useState(false);
  const signals = buildSignals(check);
  const msg =
    `Hey ${check.managerName ?? "Manager"}, your Week ${week} lineup was flagged for multiple integrity issues. ` +
    `Please update your lineup and confirm you are setting a competitive roster. ` +
    `Continued issues may result in commissioner action under league rules.`;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold">{teamLabel(check)}</span>
        <span className="text-xs text-muted-foreground">Manager: {check.managerName}</span>
        <Badge text={`Tanking Risk: ${check.riskLabel} · ${check.tankingRiskScore}/100`} color={tankingColor(check.riskLabel)} />
      </div>

      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Signals</p>
        <ul className="text-sm space-y-1">
          {signals.map((sig, i) => (
            <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span>{sig}</li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-muted-foreground/80 italic mt-3">
        Suggested action: Review context and follow league bylaws before issuing a warning.
      </p>

      <div className="flex flex-wrap gap-2 mt-3">
        <CopyButton text={msg} label="Copy Message" />
        <Button size="sm" variant="outline" onClick={() => setShowStrike((v) => !v)}>
          <Gavel className="w-3.5 h-3.5 mr-1.5" /> Issue Strike
        </Button>
      </div>

      {showStrike && (
        <div className="mt-3">
          <IssueStrikeForm
            leagueId={leagueId}
            week={week}
            check={check}
            defaultType="tanking_review"
            onDone={() => { setShowStrike(false); toast({ title: "Strike issued" }); }}
          />
        </div>
      )}
    </div>
  );
}

// ── Strike Tracker ───────────────────────────────────────────────────────────

const STRIKE_TYPES = ["empty_lineup", "invalid_starter", "repeat_issue", "tanking_review", "manual"];
const SEVERITIES = ["low", "medium", "high", "critical"];

function IssueStrikeForm({
  leagueId, week, check, defaultType, onDone,
}: {
  leagueId: string;
  week: number;
  check: { rosterId: number; ownerId: string | null; managerName: string | null; teamName: string | null };
  defaultType: string;
  onDone: () => void;
}) {
  const [strikeType, setStrikeType] = useState(defaultType);
  const [severity, setSeverity] = useState("medium");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const mut = useMutation({
    mutationFn: () => api.issueStrike({
      leagueId, week, rosterId: check.rosterId, ownerId: check.ownerId,
      managerName: check.managerName, teamName: check.teamName,
      strikeType, severity, reason, commissionerNotes: notes,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["li", leagueId] });
      onDone();
    },
    onError: (e: any) => toast({ title: "Failed to issue strike", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={strikeType} onChange={(e) => setStrikeType(e.target.value)} className="rounded-lg border border-border/60 bg-card/40 px-2 py-1 text-xs">
          {STRIKE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-lg border border-border/60 bg-card/40 px-2 py-1 text-xs">
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <textarea
        value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (documented with the strike)…"
        className="w-full rounded-lg border border-border/60 bg-card/40 px-2 py-1.5 text-sm min-h-[52px]"
      />
      <textarea
        value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Commissioner notes (optional)…"
        className="w-full rounded-lg border border-border/60 bg-card/40 px-2 py-1.5 text-sm min-h-[40px]"
      />
      <Button size="sm" disabled={!reason.trim() || mut.isPending} onClick={() => mut.mutate()} style={{ background: GOLD, color: "#1a1206" }}>
        {mut.isPending ? "Saving…" : "Document Strike"}
      </Button>
    </div>
  );
}

function StrikeTrackerTab({ leagueId }: { leagueId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "strikes"],
    queryFn: () => api.strikes(leagueId),
  });
  const { toast } = useToast();
  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.updateStrike(id, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["li", leagueId, "strikes"] }); toast({ title: "Strike updated" }); },
  });

  if (isLoading) return <Loading />;
  const strikes = data?.strikes ?? [];
  if (!strikes.length) return <EmptyHint text="No strikes issued. Strikes are recorded manually from the Anti-Tanking Review tab." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
            <th className="text-left px-3 py-2">Team</th>
            <th className="text-left px-2 py-2">Type</th>
            <th className="text-center px-2 py-2">Severity</th>
            <th className="text-center px-2 py-2">Week</th>
            <th className="text-left px-2 py-2">Reason</th>
            <th className="text-center px-2 py-2">Status</th>
            <th className="text-right px-2 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {strikes.map((s: StrikeRow) => (
            <tr key={s.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2 font-semibold">{s.teamName || s.managerName || `Roster ${s.rosterId}`}</td>
              <td className="px-2 py-2 capitalize">{s.strikeType.replace(/_/g, " ")}</td>
              <td className="px-2 py-2 text-center"><Badge text={s.severity} color={severityColor(s.severity)} /></td>
              <td className="px-2 py-2 text-center">{s.week || "—"}</td>
              <td className="px-2 py-2 text-muted-foreground max-w-[260px] truncate" title={s.reason}>{s.reason}</td>
              <td className="px-2 py-2 text-center capitalize">{s.status}</td>
              <td className="px-2 py-2 text-right whitespace-nowrap">
                {s.status === "active" && (
                  <>
                    <button className="text-xs text-muted-foreground hover:text-foreground mr-2" onClick={() => updateMut.mutate({ id: s.id, status: "overturned" })}>Overturn</button>
                    <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => updateMut.mutate({ id: s.id, status: "resolved" })}>Resolve</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Manager History ──────────────────────────────────────────────────────────

function ManagerHistoryTab({ leagueId }: { leagueId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "history"],
    queryFn: () => api.managerHistory(leagueId),
  });
  if (isLoading) return <Loading />;
  const managers = data?.managers ?? [];
  if (!managers.length) return <EmptyHint text="No history yet — run lineup checks across a few weeks to build manager patterns." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
            <th className="text-left px-3 py-2">Manager</th>
            <th className="text-center px-2 py-2">Checks</th>
            <th className="text-center px-2 py-2">Avg Integrity</th>
            <th className="text-center px-2 py-2">Empty</th>
            <th className="text-center px-2 py-2">Bye</th>
            <th className="text-center px-2 py-2">Inactive</th>
            <th className="text-center px-2 py-2">Susp.</th>
            <th className="text-center px-2 py-2">Strikes</th>
            <th className="text-center px-2 py-2">Worst Wk</th>
          </tr>
        </thead>
        <tbody>
          {managers.map((m: ManagerHistoryRow) => (
            <tr key={m.rosterId} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2 font-semibold">{m.teamName || m.managerName}</td>
              <td className="px-2 py-2 text-center">{m.totalChecks}</td>
              <td className="px-2 py-2 text-center"><span className="font-bold" style={{ color: integrityColor(m.averageIntegrityScore) }}>{m.averageIntegrityScore}</span></td>
              <td className="px-2 py-2 text-center">{m.emptyStarterCount || "—"}</td>
              <td className="px-2 py-2 text-center">{m.byeStarterCount || "—"}</td>
              <td className="px-2 py-2 text-center">{m.inactiveStarterCount || "—"}</td>
              <td className="px-2 py-2 text-center">{m.suspiciousBenchingCount || "—"}</td>
              <td className="px-2 py-2 text-center">{m.strikes || "—"}</td>
              <td className="px-2 py-2 text-center text-muted-foreground">{m.worstWeek ? `W${m.worstWeek.week} (${m.worstWeek.integrityScore})` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Weekly Report ────────────────────────────────────────────────────────────

function WeeklyReportTab({ leagueId }: { leagueId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "report"],
    queryFn: () => api.report(leagueId),
  });
  if (isLoading) return <Loading />;
  const text = data?.copyText ?? "";
  if (!text) return <EmptyHint text="No report yet — run a lineup check first." />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><CopyButton text={text} label="Copy Weekly Report" /></div>
      <pre className="whitespace-pre-wrap text-sm rounded-xl border border-border/60 bg-card/40 p-4 font-mono leading-relaxed">{text}</pre>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

const TOGGLES: { key: keyof LineupIntegritySettings; label: string }[] = [
  { key: "enableEmptySlotChecks", label: "Empty starter checks" },
  { key: "enableByeStarterChecks", label: "Bye-week starter checks" },
  { key: "enableInactiveStarterChecks", label: "Inactive / IR starter checks" },
  { key: "enableSuspiciousBenchingChecks", label: "Suspicious benching checks" },
  { key: "enableTankingRiskChecks", label: "Tanking risk checks" },
  { key: "ignoreLineupChecksInOffseason", label: "Skip checks in offseason" },
  { key: "ignoreLineupChecksForBestBall", label: "Skip checks for best ball" },
  { key: "autoCreateAlerts", label: "Auto-create alerts" },
  { key: "autoCreateStrikes", label: "Auto-create strikes (off by default)" },
];

const NUMBERS: { key: keyof LineupIntegritySettings; label: string }[] = [
  { key: "suspiciousBenchingValueGap", label: "Suspicious benching value gap" },
  { key: "suspiciousBenchingProjectionGap", label: "Suspicious benching projection gap" },
  { key: "optimalityGapWarning", label: "Optimality gap warning" },
  { key: "optimalityGapCritical", label: "Optimality gap critical" },
  { key: "repeatIssueWeeks", label: "Repeat issue lookback (weeks)" },
  { key: "strikeAfterRepeatIssues", label: "Strike after N repeat issues" },
  { key: "playoffIntegrityStartWeek", label: "Playoff integrity start week" },
];

function SettingsTab({ leagueId }: { leagueId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", leagueId, "settings"],
    queryFn: () => api.settings(leagueId),
  });
  const { toast } = useToast();
  const [draft, setDraft] = useState<LineupIntegritySettings | null>(null);
  const settings = draft ?? data?.settings ?? null;

  const saveMut = useMutation({
    mutationFn: (patch: Partial<LineupIntegritySettings>) => api.updateSettings(leagueId, patch),
    onSuccess: (r) => { setDraft(r.settings); queryClient.invalidateQueries({ queryKey: ["li", leagueId] }); toast({ title: "Settings saved" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  if (isLoading || !settings) return <Loading />;

  const set = (patch: Partial<LineupIntegritySettings>) => setDraft({ ...settings, ...patch });

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="space-y-2">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-3 py-2 cursor-pointer">
            <span className="text-sm">{t.label}</span>
            <input
              type="checkbox"
              checked={Boolean(settings[t.key])}
              onChange={(e) => set({ [t.key]: e.target.checked } as Partial<LineupIntegritySettings>)}
              className="h-4 w-4 accent-[#d4af37]"
            />
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {NUMBERS.map((nb) => (
          <label key={nb.key} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
            <span className="text-sm">{nb.label}</span>
            <input
              type="number"
              value={Number(settings[nb.key])}
              onChange={(e) => set({ [nb.key]: Number(e.target.value) } as Partial<LineupIntegritySettings>)}
              className="w-24 rounded-lg border border-border/60 bg-background/40 px-2 py-1 text-sm text-right"
            />
          </label>
        ))}
      </div>

      <Button onClick={() => saveMut.mutate(settings)} disabled={saveMut.isPending} style={{ background: GOLD, color: "#1a1206" }}>
        {saveMut.isPending ? "Saving…" : "Save Settings"}
      </Button>

      {data?.policyText && (
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Scale className="w-4 h-4" /> Recommended Policy Text</h3>
            <CopyButton text={data.policyText} />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.policyText}</p>
        </div>
      )}
    </div>
  );
}

// ── Multi-league dashboard ───────────────────────────────────────────────────

function MultiLeagueDashboard({
  leagueIds, nameById, onOpenLeague,
}: {
  leagueIds: string[];
  nameById: Record<string, string>;
  onOpenLeague: (id: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["li", "multi", leagueIds.join(",")],
    queryFn: () => api.multiLeague(leagueIds),
  });
  if (isLoading) return <Loading />;
  const rows = data?.leagues ?? [];
  const scanned = rows.filter((r) => r.week != null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Leagues" value={leagueIds.length} />
        <KpiCard label="Scanned" value={scanned.length} />
        <KpiCard label="Needing Review" value={rows.reduce((s, r) => s + r.needsReview, 0)} />
        <KpiCard label="Open Alerts" value={rows.reduce((s, r) => s + r.openAlerts, 0)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
              <th className="text-left px-3 py-2">League</th>
              <th className="text-center px-2 py-2">Week</th>
              <th className="text-center px-2 py-2">Avg Integrity</th>
              <th className="text-center px-2 py-2">Needs Review</th>
              <th className="text-center px-2 py-2">Critical</th>
              <th className="text-center px-2 py-2">Tanking</th>
              <th className="text-center px-2 py-2">Alerts</th>
              <th className="text-right px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {leagueIds.map((id) => {
              const r = rows.find((x) => x.leagueId === id);
              return (
                <tr key={id} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-semibold">{nameById[id] ?? id}</td>
                  <td className="px-2 py-2 text-center">{r?.week ?? "—"}</td>
                  <td className="px-2 py-2 text-center">
                    {r?.averageIntegrity != null ? <span className="font-bold" style={{ color: integrityColor(r.averageIntegrity) }}>{r.averageIntegrity}</span> : "—"}
                  </td>
                  <td className="px-2 py-2 text-center">{r?.needsReview ?? "—"}</td>
                  <td className="px-2 py-2 text-center">{r?.criticalIssues ?? "—"}</td>
                  <td className="px-2 py-2 text-center">{r?.tankingSignals ?? "—"}</td>
                  <td className="px-2 py-2 text-center">{r?.openAlerts ?? "—"}</td>
                  <td className="px-2 py-2 text-right">
                    <button className="text-xs text-[#d4af37] hover:underline inline-flex items-center gap-1" onClick={() => onOpenLeague(id)}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
