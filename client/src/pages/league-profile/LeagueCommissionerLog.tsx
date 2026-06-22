/**
 * Commissioner Log — the unified, documented decision trail for a league.
 * Lists manual log entries (commissionerLog) MERGED with system lineup strikes,
 * with create/update for manual entries. Filterable by status and category.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ClipboardList, Plus, X, ShieldAlert } from "lucide-react";
import {
  commissionerLogApi, mergeWithStrikes,
  type LogCategory, type LogSeverity, type LogStatus, type LogEntry,
} from "@/lib/leagueProfileApi";
import { lineupIntegrityApi } from "@/lib/lineupIntegrityApi";

const CATEGORIES: { id: LogCategory; label: string }[] = [
  { id: "manual_note", label: "Manual Note" },
  { id: "lineup_strike", label: "Lineup Strike" },
  { id: "payment_issue", label: "Payment Issue" },
  { id: "inactivity_flag", label: "Inactivity Flag" },
  { id: "trade_concern", label: "Trade Concern" },
  { id: "tanking_concern", label: "Tanking Concern" },
  { id: "behavior_issue", label: "Behavior Issue" },
  { id: "rule_violation", label: "Rule Violation" },
  { id: "warning", label: "Warning" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]));

const SEVERITIES: LogSeverity[] = ["info", "warning", "strike", "serious", "removal_risk"];
const STATUSES: LogStatus[] = ["open", "watching", "resolved", "escalated"];

const SEVERITY_CLS: Record<string, string> = {
  info:         "bg-slate-500/15 text-slate-600 dark-any:text-slate-300 border-slate-500/30",
  warning:      "bg-yellow-500/15 text-yellow-700 dark-any:text-yellow-400 border-yellow-500/30",
  strike:       "bg-orange-500/15 text-orange-700 dark-any:text-orange-400 border-orange-500/30",
  serious:      "bg-red-500/15 text-red-700 dark-any:text-red-400 border-red-500/30",
  removal_risk: "bg-red-600/20 text-red-700 dark-any:text-red-300 border-red-600/40",
};
const STATUS_CLS: Record<string, string> = {
  open:      "bg-blue-500/15 text-blue-700 dark-any:text-blue-400 border-blue-500/30",
  watching:  "bg-yellow-500/15 text-yellow-700 dark-any:text-yellow-400 border-yellow-500/30",
  resolved:  "bg-emerald-500/15 text-emerald-700 dark-any:text-emerald-400 border-emerald-500/30",
  escalated: "bg-red-500/15 text-red-700 dark-any:text-red-400 border-red-500/30",
};

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold", className)}>{children}</span>;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function LeagueCommissionerLog({ leagueId }: { leagueId: string }) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<LogStatus | "all">("all");
  const [showAdd, setShowAdd] = useState(false);

  const logQ = useQuery({
    queryKey: ["commish-log", leagueId],
    queryFn: () => commissionerLogApi.list({ leagueId }),
  });
  const strikesQ = useQuery({
    queryKey: ["li", leagueId, "strikes"],
    queryFn: () => lineupIntegrityApi.strikes(leagueId),
  });

  const merged: LogEntry[] = useMemo(
    () => mergeWithStrikes(logQ.data?.entries ?? [], strikesQ.data?.strikes ?? []),
    [logQ.data, strikesQ.data],
  );
  const filtered = statusFilter === "all" ? merged : merged.filter(e => e.status === statusFilter);

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: LogStatus }) => commissionerLogApi.update(id, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commish-log", leagueId] }); },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const loading = logQ.isLoading || strikesQ.isLoading;

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
          <h3 className="text-sm font-bold text-foreground">Commissioner Log</h3>
          <span className="text-xs text-muted-foreground">{merged.length} entr{merged.length === 1 ? "y" : "ies"}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40"
            data-testid="log-status-filter"
          >
            <option value="all">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          <Button size="sm" onClick={() => setShowAdd(v => !v)} style={{ background: "#d4af37", color: "#1a1206" }} data-testid="log-add-toggle">
            {showAdd ? <X className="w-4 h-4 mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
            {showAdd ? "Cancel" : "Add Entry"}
          </Button>
        </div>
      </div>

      {showAdd && <AddEntryForm leagueId={leagueId} onDone={() => setShowAdd(false)} />}

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading log…</Card>
      ) : filtered.length === 0 ? (
        <Card className="border-border/60">
          <div className="flex flex-col items-center justify-center text-center py-14 px-4">
            <ClipboardList className="w-8 h-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-semibold text-foreground">No log entries</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">Document strikes, payment issues, and decisions to keep a consistent, defensible record.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <Card key={e.id} className="p-3.5" data-testid={`log-entry-${e.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    {e.source === "strike" && <span title="System lineup strike" className="inline-flex"><ShieldAlert className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" /></span>}
                    <span className="text-sm font-bold text-foreground">{CATEGORY_LABEL[e.category] ?? e.category}</span>
                    <Pill className={SEVERITY_CLS[e.severity] ?? SEVERITY_CLS.info}>{e.severity.replace("_", " ")}</Pill>
                    <Pill className={STATUS_CLS[e.status] ?? STATUS_CLS.open}>{e.status}</Pill>
                    {e.week != null && <span className="text-[11px] text-muted-foreground">Week {e.week}</span>}
                  </div>
                  {(e.teamName || e.managerName) && (
                    <p className="text-xs text-muted-foreground">{e.teamName ?? ""}{e.teamName && e.managerName ? " · " : ""}{e.managerName ?? ""}</p>
                  )}
                  {e.note && <p className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap">{e.note}</p>}
                  {e.resolution && <p className="text-xs text-emerald-600 dark-any:text-emerald-400 mt-1">Resolution: {e.resolution}</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtDate(e.createdAt)}</span>
                  {e.source === "log" && e.status !== "resolved" && (
                    <button
                      className="text-[11px] font-semibold text-emerald-600 dark-any:text-emerald-400 hover:underline disabled:opacity-50"
                      disabled={updateMut.isPending}
                      onClick={() => updateMut.mutate({ id: Number(e.id.split(":")[1]), status: "resolved" })}
                      data-testid={`log-resolve-${e.id}`}
                    >
                      Mark resolved
                    </button>
                  )}
                  {e.source === "strike" && (
                    <span className="text-[10px] text-muted-foreground">via Lineups</span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AddEntryForm({ leagueId, onDone }: { leagueId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [category, setCategory] = useState<LogCategory>("manual_note");
  const [severity, setSeverity] = useState<LogSeverity>("info");
  const [status, setStatus] = useState<LogStatus>("open");
  const [teamName, setTeamName] = useState("");
  const [note, setNote] = useState("");

  const createMut = useMutation({
    mutationFn: () => commissionerLogApi.create({
      leagueId, category, severity, status,
      teamName: teamName.trim() || undefined,
      note: note.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commish-log", leagueId] });
      toast({ title: "Log entry added" });
      onDone();
    },
    onError: (e: any) => toast({ title: "Couldn’t add entry", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card className="p-4 space-y-3 border-[#d4af37]/30">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-muted-foreground space-y-1">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as LogCategory)} className="w-full rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-sm text-foreground" data-testid="log-category">
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-foreground space-y-1">
          <span>Severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as LogSeverity)} className="w-full rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-sm text-foreground" data-testid="log-severity">
            {SEVERITIES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-foreground space-y-1">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as LogStatus)} className="w-full rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-sm text-foreground" data-testid="log-status">
            {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
      </div>
      <Input placeholder="Team / manager (optional)" value={teamName} onChange={(e) => setTeamName(e.target.value)} data-testid="log-team" />
      <Textarea placeholder="What happened? Note the decision and reasoning…" value={note} onChange={(e) => setNote(e.target.value)} rows={3} data-testid="log-note" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button size="sm" disabled={createMut.isPending} onClick={() => createMut.mutate()} style={{ background: "#d4af37", color: "#1a1206" }} data-testid="log-save">
          {createMut.isPending ? "Saving…" : "Save Entry"}
        </Button>
      </div>
    </Card>
  );
}
