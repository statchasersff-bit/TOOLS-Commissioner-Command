import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useSleeper } from "@/contexts/SleeperContext";
import { API_BASE } from "@/lib/apiBase";
import { SleeperAuthCard } from "@/components/SleeperAuthCard";
import { SectionHeader } from "@/components/SectionHeader";
import { TeamLoader } from "@/components/TeamLoader";
import {
  DollarSign,
  Plus,
  Trash2,
  Trophy,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  EyeOff,
  Eye,
  Tag,
  ExternalLink,
  Wallet,
  Receipt,
  Trophy as TrophyIcon,
  Banknote,
  Link2,
  Scale,
  ArrowRight,
  Search,
  Users,
  StickyNote,
  SlidersHorizontal,
} from "lucide-react";

// ─── Data model ───────────────────────────────────────────────────────────────
// All persisted through the existing finance storage layer. `prizes` and
// `payments` are schemaless jsonb on the server, so the richer commissioner
// shapes below load alongside legacy rows (old prizes were { place, amount }
// only; old rows have no payments — both fall back cleanly).

interface PrizeSlot {
  place: number;        // ordering key + default label source
  amount: number;
  label?: string;       // e.g. "1st", "Regular Season Points", "Side Pot"
  paid?: boolean;
  paidDate?: string;    // optional ISO date
  notes?: string;       // optional
}

type ManagerPaymentStatus = "paid" | "partial" | "unpaid" | "waived";

interface ManagerPayment {
  rosterId: string;     // stable Sleeper roster id (string)
  paid: number;         // amount collected from this manager
  status: ManagerPaymentStatus;
  paidDate?: string;
  notes?: string;
}

interface LeagueFinanceData {
  leagueId: string;
  buyIn: number;
  prizes: PrizeSlot[];
  payments: ManagerPayment[];
  notes: string;
  isFree: boolean;
  ignored: boolean;
  leagueSafeUrl: string;
}

const DEFAULT_FINANCE: LeagueFinanceData = {
  leagueId: "", buyIn: 0, prizes: [], payments: [], notes: "", isFree: false, ignored: false, leagueSafeUrl: "",
};

// Manager roster info, fetched lazily from Sleeper when a league is expanded so
// the commissioner can track dues per real manager / team name.
interface ManagerInfo { rosterId: string; managerName: string; teamName: string; avatarUrl?: string; }

const SLEEPER_API = "https://api.sleeper.app/v1";

// Resolve a Sleeper avatar to a thumbnail URL. Team avatars (metadata.avatar)
// can already be a full URL; user avatars are bare ids served from the CDN.
function sleeperAvatarUrl(u: any): string | undefined {
  const teamAvatar: string | undefined = u?.metadata?.avatar;
  if (teamAvatar) return teamAvatar.startsWith("http") ? teamAvatar : `https://sleepercdn.com/avatars/thumbs/${teamAvatar}`;
  if (u?.avatar) return `https://sleepercdn.com/avatars/thumbs/${u.avatar}`;
  return undefined;
}

async function fetchLeagueManagers(leagueId: string): Promise<ManagerInfo[]> {
  const [rostersRaw, usersRaw] = await Promise.all([
    fetch(`${SLEEPER_API}/league/${leagueId}/rosters`).then(r => r.json()),
    fetch(`${SLEEPER_API}/league/${leagueId}/users`).then(r => r.json()),
  ]);
  const rosters: any[] = rostersRaw || [];
  const users: any[] = usersRaw || [];
  const userMap = new Map<string, any>(users.map((u: any) => [u.user_id, u]));
  return rosters
    .map((r: any) => {
      const u = r.owner_id ? userMap.get(r.owner_id) : undefined;
      const teamName = u?.metadata?.team_name?.trim();
      const displayName = u?.display_name?.trim();
      return {
        rosterId: String(r.roster_id),
        managerName: displayName || teamName || "Unclaimed",
        teamName: teamName || displayName || `Team ${r.roster_id}`,
        avatarUrl: u ? sleeperAvatarUrl(u) : undefined,
      };
    })
    .sort((a, b) => Number(a.rosterId) - Number(b.rosterId));
}

// ─── Money + label helpers ─────────────────────────────────────────────────────

function fmtDollar(n: number) {
  if (!n) return "$0";
  return `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

function ordinal(place: number) {
  if (place === 1) return "1st";
  if (place === 2) return "2nd";
  if (place === 3) return "3rd";
  return `${place}th`;
}

function prizeLabel(p: PrizeSlot) {
  return p.label?.trim() || ordinal(p.place);
}

// ─── Per-league derived finance metrics ────────────────────────────────────────

interface LeagueMetrics {
  teams: number;
  waivedCount: number;
  /** Expected dues after waivers (buyIn × non-waived teams). */
  dues: number;
  collected: number;
  outstanding: number;
  /** Managers marked paid or waived (settled), out of `teams`. */
  paidCount: number;
  prizePool: number;
  payoutsPending: number;   // dollar total of prize rows not yet paid out
  hasUnpaidPayouts: boolean;
  // Issue flags
  missingBuyIn: boolean;
  missingPrizes: boolean;
  missingLeagueSafe: boolean;
  hasMissingPayments: boolean;
  reconIssue: boolean;
  hasIssue: boolean;
}

function computeMetrics(f: LeagueFinanceData, teams: number): LeagueMetrics {
  const payments = f.payments || [];
  const prizes = f.prizes || [];
  const waivedCount = payments.filter(p => p.status === "waived").length;
  const effectiveTeams = Math.max(0, teams - waivedCount);
  const dues = f.isFree ? 0 : f.buyIn * effectiveTeams;
  const collected = payments.reduce((s, p) => s + (p.status === "waived" ? 0 : (p.paid || 0)), 0);
  const outstanding = Math.max(0, dues - collected);
  const paidCount = payments.filter(p => p.status === "paid" || p.status === "waived").length;
  const prizePool = prizes.reduce((s, p) => s + (p.amount || 0), 0);
  const payoutsPending = prizes.filter(p => !p.paid).reduce((s, p) => s + (p.amount || 0), 0);
  const hasUnpaidPayouts = prizes.length > 0 && prizes.some(p => !p.paid);

  const missingBuyIn = !f.isFree && f.buyIn <= 0;
  const missingPrizes = !f.isFree && prizes.length === 0;
  const missingLeagueSafe = !f.isFree && !f.leagueSafeUrl?.trim();
  const hasMissingPayments = !f.isFree && dues > 0 && collected < dues;
  // Reconciliation: prizes over-allocated vs available pool, or more collected
  // than expected (data entry drift).
  const reconIssue = (prizePool > 0 && dues > 0 && prizePool > dues) || (dues > 0 && collected > dues);

  const hasIssue = !f.isFree && (missingBuyIn || missingPrizes || missingLeagueSafe || hasMissingPayments || reconIssue);

  return {
    teams, waivedCount, dues, collected, outstanding, paidCount,
    prizePool, payoutsPending, hasUnpaidPayouts,
    missingBuyIn, missingPrizes, missingLeagueSafe, hasMissingPayments, reconIssue, hasIssue,
  };
}

// ─── Status pills ───────────────────────────────────────────────────────────────

type StatusKey =
  | "ready" | "missing-payments" | "prize-setup" | "leaguesafe-missing"
  | "payout-pending" | "free" | "hidden";

// Color signals STATE, not category: green = settled/ready, amber = needs action
// (payments, setup, payouts), muted = low-priority/neutral. The label carries the
// specific meaning so we don't need a distinct hue per status.
const STATUS_CONFIG: Record<StatusKey, { label: string; cls: string; dot: string }> = {
  ready:               { label: "Ready",            cls: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5", dot: "bg-emerald-500" },
  "missing-payments":  { label: "Missing Payments", cls: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5",        dot: "bg-amber-500" },
  "prize-setup":       { label: "Prize Setup Needed", cls: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5",      dot: "bg-amber-500" },
  "leaguesafe-missing":{ label: "LeagueSafe Missing", cls: "border-border/50 text-muted-foreground bg-muted/20",                          dot: "bg-muted-foreground/40" },
  "payout-pending":    { label: "Payout Pending",   cls: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5",        dot: "bg-amber-500" },
  free:                { label: "Free League",      cls: "border-slate-500/30 text-slate-500 dark:text-slate-400 bg-slate-500/5",        dot: "bg-slate-500" },
  hidden:              { label: "Hidden",           cls: "border-border/50 text-muted-foreground",                                        dot: "bg-muted-foreground/40" },
};

// Single most-blocking status for a league row. Order = what the commissioner
// should fix first (setup → payments → payouts → ready).
function leagueStatus(f: LeagueFinanceData, m: LeagueMetrics): StatusKey {
  if (f.isFree) return "free";
  if (m.missingBuyIn || m.missingPrizes) return "prize-setup";
  if (m.missingLeagueSafe) return "leaguesafe-missing";
  if (m.hasMissingPayments || m.reconIssue) return "missing-payments";
  if (m.hasUnpaidPayouts) return "payout-pending";
  return "ready";
}

function StatusPill({ status, className = "" }: { status: StatusKey; className?: string }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${cfg.cls} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function tokenKey(userId: string) { return `dc-finance-token-${userId}`; }

// ─── Expanded-row editor (module scope) ───────────────────────────────────────
// IMPORTANT: this component MUST live at module scope so its identity is stable
// across parent re-renders — otherwise the text inputs lose focus on each
// keystroke (React unmounts/remounts a fresh component type every render).

interface FinanceLeagueEditorProps {
  leagueId: string;
  finance: LeagueFinanceData;
  metrics: LeagueMetrics;
  managers: ManagerInfo[] | undefined;
  managersLoading: boolean;
  onUpdate: (leagueId: string, patch: Partial<LeagueFinanceData>) => void;
  onAddPrize: (leagueId: string) => void;
  onRemovePrize: (leagueId: string, place: number) => void;
  onUpdatePrize: (leagueId: string, place: number, patch: Partial<PrizeSlot>) => void;
  onUpdatePayment: (leagueId: string, rosterId: string, patch: Partial<ManagerPayment>) => void;
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      <div className="flex-1 h-px bg-border/30" />
      {action}
    </div>
  );
}

function Stat({ label, value, valueCls = "" }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${valueCls}`}>{value}</span>
    </div>
  );
}

// Compact status dropdown for a manager's payment state, color-tinted to match
// the soft STATUS_CHIP palette.
function PaymentStatusSelect({
  value, onChange, testId,
}: { value: ManagerPaymentStatus; onChange: (v: ManagerPaymentStatus) => void; testId?: string }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as ManagerPaymentStatus)}>
      <SelectTrigger
        className={`h-7 w-[108px] px-2 text-[11px] font-semibold rounded-md border ${STATUS_CHIP[value]}`}
        data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAYMENT_STATUS_OPTIONS.map(opt => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const PAYMENT_STATUS_OPTIONS: { value: ManagerPaymentStatus; label: string }[] = [
  { value: "paid",    label: "Paid" },
  { value: "partial", label: "Partial" },
  { value: "unpaid",  label: "Unpaid" },
  { value: "waived",  label: "Waived" },
];

// Soft status chips — strong color reserved for true alerts (outstanding dues,
// setup needed), so the manager list reads calmly even when nobody has paid yet.
const STATUS_CHIP: Record<ManagerPaymentStatus, string> = {
  paid:    "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  partial: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
  unpaid:  "text-red-600/90 dark:text-red-400/90 bg-red-500/[0.06] border-red-500/20",
  waived:  "text-slate-500 dark:text-slate-400 bg-slate-500/10 border-slate-500/25",
};

function FinanceLeagueEditor({
  leagueId, finance, metrics, managers, managersLoading,
  onUpdate, onAddPrize, onRemovePrize, onUpdatePrize, onUpdatePayment,
}: FinanceLeagueEditorProps) {
  // Local drafts for free-text fields → debounced upstream so the table reflects
  // changes without thrashing the save endpoint or risking input focus.
  const [urlDraft, setUrlDraft] = useState(finance.leagueSafeUrl);
  const [notesDraft, setNotesDraft] = useState(finance.notes);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    if (notesTimer.current) clearTimeout(notesTimer.current);
  }, []);

  const flushUrl = useCallback((v: string) => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => onUpdate(leagueId, { leagueSafeUrl: v }), 600);
  }, [leagueId, onUpdate]);

  const flushNotes = useCallback((v: string) => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => onUpdate(leagueId, { notes: v }), 600);
  }, [leagueId, onUpdate]);

  const f = finance;

  // Manager-payment search + bulk actions.
  const [search, setSearch] = useState("");
  const owed = f.buyIn;

  const filteredManagers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !managers) return managers ?? [];
    return managers.filter(m =>
      m.managerName.toLowerCase().includes(q) || m.teamName.toLowerCase().includes(q));
  }, [managers, search]);

  const paidStatusCount = useMemo(() => {
    if (!managers) return { settled: 0, total: 0 };
    const settled = managers.filter(m => {
      const s = f.payments.find(p => p.rosterId === m.rosterId)?.status ?? "unpaid";
      return s === "paid" || s === "waived";
    }).length;
    return { settled, total: managers.length };
  }, [managers, f.payments]);

  // Build the full payments array in one update so a bulk action isn't lost to
  // stale per-roster closures.
  const markAll = useCallback((status: ManagerPaymentStatus) => {
    if (!managers) return;
    const next: ManagerPayment[] = managers.map(m => {
      const existing = f.payments.find(p => p.rosterId === m.rosterId);
      return {
        rosterId: m.rosterId,
        paid: status === "paid" ? owed : 0,
        status,
        ...(existing?.paidDate ? { paidDate: existing.paidDate } : {}),
        ...(existing?.notes ? { notes: existing.notes } : {}),
      };
    });
    onUpdate(leagueId, { payments: next });
  }, [managers, f.payments, owed, leagueId, onUpdate]);

  return (
    <div className="border-t border-border/30 bg-muted/10 p-4 md:p-5 space-y-5">
      {/* Tight summary strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-xs">
        <Stat label="Expected" value={f.isFree ? "Free" : fmtDollar(metrics.dues)} />
        <Stat label="Collected" value={fmtDollar(metrics.collected)} valueCls="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Outstanding" value={f.isFree ? "—" : fmtDollar(metrics.outstanding)}
          valueCls={metrics.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"} />
        <Stat label="Paid" value={f.isFree ? "—" : `${metrics.paidCount} / ${metrics.teams}`} />
      </div>

      {/* Setup: two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
        {/* Financial Setup */}
        <div className="space-y-3">
          <SectionLabel>Financial Setup</SectionLabel>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Entry Fee</label>
              <div className="relative sm:w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input type="number" min="0" className="pl-6 h-9 text-sm" value={f.buyIn || ""} placeholder="0"
                  onChange={e => onUpdate(leagueId, { buyIn: parseFloat(e.target.value) || 0 })}
                  data-testid={`input-buyin-${leagueId}`} />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">LeagueSafe Link</label>
              <div className="relative">
                <Input type="url" placeholder="https://leaguesafe.com/league/…"
                  value={urlDraft}
                  onChange={e => { setUrlDraft(e.target.value); flushUrl(e.target.value); }}
                  onBlur={() => {
                    if (urlTimer.current) { clearTimeout(urlTimer.current); urlTimer.current = null; }
                    if (urlDraft !== finance.leagueSafeUrl) onUpdate(leagueId, { leagueSafeUrl: urlDraft });
                  }}
                  className={`h-9 text-sm ${urlDraft ? "pr-9" : ""}`}
                  data-testid={`input-leaguesafe-${leagueId}`} />
                {urlDraft && (
                  <a href={urlDraft} target="_blank" rel="noopener noreferrer"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#d4af37] hover:opacity-70 transition-opacity"
                    data-testid={`link-leaguesafe-${leagueId}`} onClick={e => e.stopPropagation()}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <StickyNote className="w-3 h-3" /> Notes
              </label>
              <Textarea placeholder="Payout method, side pots, dues deadline…"
                value={notesDraft}
                onChange={e => { setNotesDraft(e.target.value); flushNotes(e.target.value); }}
                onBlur={() => {
                  if (notesTimer.current) { clearTimeout(notesTimer.current); notesTimer.current = null; }
                  if (notesDraft !== finance.notes) onUpdate(leagueId, { notes: notesDraft });
                }}
                className="text-sm min-h-[60px] resize-y" data-testid={`input-notes-${leagueId}`} />
            </div>
          </div>
        </div>

        {/* Prize Setup */}
        <div className="space-y-3">
          <SectionLabel action={
            <button
              onClick={() => onAddPrize(leagueId)}
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#d4af37] hover:opacity-80 transition-opacity"
              data-testid={`button-add-prize-${leagueId}`}>
              <Plus className="w-3 h-3" /> Add Place
            </button>
          }>Prize Setup</SectionLabel>
          {f.prizes.length === 0 ? (
            <button onClick={() => onAddPrize(leagueId)}
              className="w-full text-left text-xs text-muted-foreground italic leading-relaxed rounded-lg border border-dashed border-border/50 px-3 py-4 hover:border-border hover:text-foreground transition-colors"
              data-testid={`prize-empty-${leagueId}`}>
              No prize structure set. <span className="text-[#d4af37] not-italic font-semibold">+ Add a payout place</span> to track expected payouts and reconciliation.
            </button>
          ) : (
            <div className="space-y-1.5">
              {[...f.prizes].sort((a, b) => a.place - b.place).map(prize => (
                <div key={prize.place}
                  className={`flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-md border ${prize.paid ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/30 bg-muted/20"}`}
                  data-testid={`prize-row-${leagueId}-${prize.place}`}>
                  <Input
                    className="h-8 text-sm w-24 flex-shrink-0"
                    value={prize.label ?? ordinal(prize.place)}
                    placeholder="Place / label"
                    onChange={e => onUpdatePrize(leagueId, prize.place, { label: e.target.value })}
                    data-testid={`input-prize-label-${leagueId}-${prize.place}`} />
                  <div className="relative w-24 flex-shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                    <Input type="number" min="0" className="pl-6 h-8 text-sm" value={prize.amount || ""} placeholder="0"
                      onChange={e => onUpdatePrize(leagueId, prize.place, { amount: parseFloat(e.target.value) || 0 })}
                      data-testid={`input-prize-${leagueId}-${prize.place}`} />
                  </div>
                  <button
                    onClick={() => onUpdatePrize(leagueId, prize.place, { paid: !prize.paid })}
                    className={`flex items-center gap-1 px-2 h-8 rounded-md text-[11px] font-medium border transition-colors flex-shrink-0 ${prize.paid ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : "border-border/40 text-muted-foreground hover:text-foreground"}`}
                    data-testid={`button-prize-paid-${leagueId}-${prize.place}`}>
                    <CheckCircle2 className="w-3 h-3" />{prize.paid ? "Paid out" : "Mark paid"}
                  </button>
                  <button onClick={() => onRemovePrize(leagueId, prize.place)}
                    className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0 p-1 ml-auto"
                    data-testid={`button-remove-prize-${leagueId}-${prize.place}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {/* Prize pool vs collected reconciliation hint */}
              <div className={`mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg border text-xs ${metrics.reconIssue ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/20 border-border/30"}`}>
                <Stat label="Pool" value={fmtDollar(metrics.prizePool)} />
                <span className="text-border/60">|</span>
                <Stat label="Collected" value={fmtDollar(metrics.collected)} />
                {metrics.reconIssue && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Pool exceeds collected dues
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Manager Payments — full width */}
      {!f.isFree && (
        <div>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Manager Payments</span>
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{paidStatusCount.settled} paid</span>
              {" / "}
              <span className="font-semibold">{Math.max(0, paidStatusCount.total - paidStatusCount.settled)} unpaid</span>
            </span>
            <div className="flex-1" />
            {managers && managers.length > 0 && (
              <>
                <div className="relative w-full sm:w-44">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search manager…" className="pl-8 h-8 text-xs"
                    data-testid={`input-payment-search-${leagueId}`} />
                </div>
                <button onClick={() => markAll("paid")}
                  className="flex items-center gap-1 px-2.5 h-8 rounded-md border border-border/50 text-[11px] font-semibold text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-500/40 transition-colors"
                  data-testid={`button-mark-all-paid-${leagueId}`}>
                  <CheckCircle2 className="w-3 h-3" /> Mark all paid
                </button>
                <button onClick={() => markAll("unpaid")}
                  className="flex items-center gap-1 px-2.5 h-8 rounded-md border border-border/50 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`button-mark-all-unpaid-${leagueId}`}>
                  <SlidersHorizontal className="w-3 h-3" /> Mark all unpaid
                </button>
              </>
            )}
          </div>

          {managersLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading managers…
            </div>
          ) : managers && managers.length > 0 ? (
            filteredManagers.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-1 py-2">No managers match "{search}".</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {filteredManagers.map(m => {
                  const pay = f.payments.find(p => p.rosterId === m.rosterId);
                  const status: ManagerPaymentStatus = pay?.status ?? "unpaid";
                  return (
                    <div key={m.rosterId}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border/30 bg-muted/20 hover:bg-muted/30 transition-colors"
                      data-testid={`payment-row-${leagueId}-${m.rosterId}`}>
                      <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center relative">
                        <Users className="w-3.5 h-3.5 text-[#0b3a7a]/60 dark:text-blue-400/60" />
                        {m.avatarUrl && (
                          <img src={m.avatarUrl} alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            data-testid={`img-manager-avatar-${leagueId}-${m.rosterId}`} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate leading-tight">{m.managerName}</p>
                        <p className="text-[10px] text-muted-foreground truncate leading-tight">
                          {m.teamName} <span className="text-muted-foreground/70">· {fmtDollar(owed)}</span>
                        </p>
                      </div>
                      {status === "partial" && (
                        <div className="relative w-16 flex-shrink-0">
                          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">$</span>
                          <Input type="number" min="0" className="pl-4 h-7 text-xs" value={pay?.paid || ""} placeholder="0"
                            onChange={e => onUpdatePayment(leagueId, m.rosterId, { paid: parseFloat(e.target.value) || 0 })}
                            data-testid={`payment-amount-${leagueId}-${m.rosterId}`} />
                        </div>
                      )}
                      <PaymentStatusSelect
                        value={status}
                        onChange={v => onUpdatePayment(leagueId, m.rosterId, {
                          status: v,
                          paid: v === "paid" ? owed : v === "unpaid" || v === "waived" ? 0 : (pay?.paid || 0),
                        })}
                        testId={`payment-status-${leagueId}-${m.rosterId}`} />
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground italic">Could not load this league's managers from Sleeper.</p>
          )}
        </div>
      )}

      {/* Secondary actions */}
      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          onClick={() => onUpdate(leagueId, { isFree: !f.isFree, buyIn: !f.isFree ? 0 : f.buyIn, prizes: !f.isFree ? [] : f.prizes, payments: !f.isFree ? [] : f.payments })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${f.isFree ? "bg-slate-500/10 text-slate-500 dark:text-slate-400 hover:bg-slate-500/15" : "text-muted-foreground hover:bg-muted/50 hover:text-slate-500 dark:hover:text-slate-400"}`}
          data-testid={`button-toggle-free-${leagueId}`}>
          <Tag className="w-3 h-3" />{f.isFree ? "Free League ✓" : "Mark as Free League"}
        </button>
        <button
          onClick={() => onUpdate(leagueId, { ignored: !f.ignored })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${f.ignored ? "bg-muted text-muted-foreground hover:bg-muted/70" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
          data-testid={`button-toggle-ignore-${leagueId}`}>
          {f.ignored ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {f.ignored ? "Unhide from Summary" : "Hide from Summary"}
        </button>
      </div>
    </div>
  );
}

// ─── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, sub, accent, testId }: {
  icon: typeof Wallet; label: string; value: string; sub?: string; accent?: string; testId?: string;
}) {
  return (
    <Card className="p-3 md:p-4" data-testid={testId}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${accent ?? "text-muted-foreground"}`} />
        <p className="text-[10px] md:text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-lg md:text-xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

// ─── Action Required bucket ──────────────────────────────────────────────────────

interface ActionBucket {
  key: string;
  title: string;
  cta: string;
  icon: typeof Wallet;
  accent: string;       // severity text color — used only for the icon + count badge
  leagues: { leagueId: string; name: string }[];
}

// Shared neutral league chip for every action bucket — color lives in the icon
// and count badge, so the repeated chips stay calm and scannable.
const ACTION_CHIP =
  "max-w-full truncate px-2 py-0.5 rounded-md border border-border/50 bg-muted/30 text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors";

// ─── Main League Treasury Tab ────────────────────────────────────────────────────

export function FinanceTab({ scopeLeagueId }: { scopeLeagueId?: string } = {}) {
  const { isConnected, user, leagues } = useSleeper();
  const [token, setToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [finances, setFinances] = useState<Record<string, LeagueFinanceData>>({});
  // When embedded in a single league's profile, default that league open.
  const [expanded, setExpanded] = useState<string | null>(scopeLeagueId ?? null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loadingFinances, setLoadingFinances] = useState(false);
  const [managers, setManagers] = useState<Record<string, ManagerInfo[]>>({});
  const [managersLoading, setManagersLoading] = useState<Record<string, boolean>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Every league this commissioner manages (Commissioner Command leagues).
  // Scoped to a single league when embedded in that league's profile.
  const managedLeagues = leagues
    .filter(l => l.status !== "archived")
    .filter(l => !scopeLeagueId || l.leagueId === scopeLeagueId);

  useEffect(() => {
    if (!user?.userId) return;
    const cached = localStorage.getItem(tokenKey(user.userId));
    if (cached) { setToken(cached); setAuthChecked(true); return; }
    fetch(`${API_BASE}/api/auth/sleeper-exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sleeperId: user.userId }),
    })
      .then(r => r.json())
      .then(d => { if (d.token) { localStorage.setItem(tokenKey(user.userId!), d.token); setToken(d.token); } })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, [user?.userId]);

  function handleLock() {
    if (!user?.userId) return;
    localStorage.removeItem(tokenKey(user.userId));
    setToken(null);
    setFinances({});
  }

  const authHeaders = useCallback((): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  // Load persisted finance rows. Migration/fallback: legacy rows have no
  // `payments` and prizes with only { place, amount } — both default safely.
  useEffect(() => {
    if (!isConnected || !user?.userId || !token) return;
    setLoadingFinances(true);
    fetch(`${API_BASE}/api/finances/${user.userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { handleLock(); return null; } return r.json(); })
      .then((rows: any[] | null) => {
        if (!rows) return;
        const map: Record<string, LeagueFinanceData> = {};
        for (const row of rows) {
          map[row.leagueId] = {
            leagueId: row.leagueId,
            buyIn: row.buyIn ?? 0,
            prizes: Array.isArray(row.prizes) ? row.prizes as PrizeSlot[] : [],
            payments: Array.isArray(row.payments) ? row.payments as ManagerPayment[] : [],
            notes: row.notes ?? "",
            isFree: row.isFree ?? false,
            ignored: row.ignored ?? false,
            leagueSafeUrl: row.leagueSafeUrl ?? "",
          };
        }
        setFinances(map);
      })
      .catch(() => {})
      .finally(() => setLoadingFinances(false));
  }, [isConnected, user?.userId, token]);

  const getFinance = useCallback((leagueId: string): LeagueFinanceData =>
    finances[leagueId] ?? { ...DEFAULT_FINANCE, leagueId }, [finances]);

  const saveFinance = useCallback((leagueId: string, data: LeagueFinanceData) => {
    if (!user?.userId || !token) return;
    clearTimeout(saveTimers.current[leagueId]);
    setSaved(prev => ({ ...prev, [leagueId]: false }));
    saveTimers.current[leagueId] = setTimeout(async () => {
      setSaving(prev => ({ ...prev, [leagueId]: true }));
      try {
        const r = await fetch(`${API_BASE}/api/finances`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            sleeperUserId: user.userId, leagueId,
            season: managedLeagues.find(l => l.leagueId === leagueId)?.season ?? "2026",
            buyIn: data.buyIn, prizes: data.prizes, payments: data.payments, notes: data.notes,
            isFree: data.isFree, ignored: data.ignored, leagueSafeUrl: data.leagueSafeUrl || null,
          }),
        });
        if (r.status === 401) { handleLock(); return; }
        setSaved(prev => ({ ...prev, [leagueId]: true }));
        setTimeout(() => setSaved(prev => ({ ...prev, [leagueId]: false })), 2000);
      } catch {}
      setSaving(prev => ({ ...prev, [leagueId]: false }));
    }, 800);
  }, [user?.userId, token, managedLeagues, authHeaders]);

  const updateFinance = useCallback((leagueId: string, patch: Partial<LeagueFinanceData>) => {
    setFinances(prev => {
      const current = prev[leagueId] ?? { ...DEFAULT_FINANCE, leagueId };
      const updated = { ...current, ...patch };
      saveFinance(leagueId, updated);
      return { ...prev, [leagueId]: updated };
    });
  }, [saveFinance]);

  const addPrize = useCallback((leagueId: string) => {
    const f = getFinance(leagueId);
    const nextPlace = (f.prizes.length > 0 ? Math.max(...f.prizes.map(p => p.place)) : 0) + 1;
    updateFinance(leagueId, { prizes: [...f.prizes, { place: nextPlace, amount: 0, label: ordinal(nextPlace), paid: false }] });
  }, [getFinance, updateFinance]);

  const removePrize = useCallback((leagueId: string, place: number) => {
    const f = getFinance(leagueId);
    updateFinance(leagueId, { prizes: f.prizes.filter(p => p.place !== place) });
  }, [getFinance, updateFinance]);

  const updatePrize = useCallback((leagueId: string, place: number, patch: Partial<PrizeSlot>) => {
    const f = getFinance(leagueId);
    updateFinance(leagueId, { prizes: f.prizes.map(p => p.place === place ? { ...p, ...patch } : p) });
  }, [getFinance, updateFinance]);

  const updatePayment = useCallback((leagueId: string, rosterId: string, patch: Partial<ManagerPayment>) => {
    const f = getFinance(leagueId);
    const existing = f.payments.find(p => p.rosterId === rosterId);
    let next: ManagerPayment[];
    if (existing) {
      next = f.payments.map(p => p.rosterId === rosterId ? { ...p, ...patch } : p);
    } else {
      next = [...f.payments, { rosterId, paid: 0, status: "unpaid", ...patch }];
    }
    updateFinance(leagueId, { payments: next });
  }, [getFinance, updateFinance]);

  // Lazily fetch managers when a league is first expanded.
  const ensureManagers = useCallback((leagueId: string) => {
    if (managers[leagueId] || managersLoading[leagueId]) return;
    setManagersLoading(prev => ({ ...prev, [leagueId]: true }));
    fetchLeagueManagers(leagueId)
      .then(list => setManagers(prev => ({ ...prev, [leagueId]: list })))
      .catch(() => setManagers(prev => ({ ...prev, [leagueId]: [] })))
      .finally(() => setManagersLoading(prev => ({ ...prev, [leagueId]: false })));
  }, [managers, managersLoading]);

  const toggleExpand = useCallback((leagueId: string) => {
    setExpanded(prev => {
      const next = prev === leagueId ? null : leagueId;
      if (next) ensureManagers(next);
      return next;
    });
  }, [ensureManagers]);

  // Jump to + open a league from an Action Required CTA.
  const openLeague = useCallback((leagueId: string) => {
    setExpanded(leagueId);
    ensureManagers(leagueId);
    requestAnimationFrame(() => {
      rowRefs.current[leagueId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [ensureManagers]);

  const teamsOf = useCallback((leagueId: string) =>
    managedLeagues.find(l => l.leagueId === leagueId)?.totalRosters ?? 0, [managedLeagues]);

  // ── Gating states ──────────────────────────────────────────────────────────
  if (!isConnected || !user) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] px-4">
        <Card className="p-8 text-center max-w-sm w-full">
          <div className="w-14 h-14 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mx-auto mb-4">
            <DollarSign className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-bold mb-2">Connect Sleeper First</h3>
          <p className="text-sm text-muted-foreground">Connect your Sleeper account to manage dues, prize pools, and payouts across your leagues.</p>
        </Card>
      </div>
    );
  }

  if (!authChecked) {
    return <div className="min-h-[40vh] flex items-center justify-center"><TeamLoader size="lg" context="Checking your session" /></div>;
  }

  if (!token) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 space-y-6">
        <div className="text-center space-y-2 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-[#d4af37]/10 flex items-center justify-center mx-auto ring-1 ring-[#d4af37]/20">
            <Wallet className="w-6 h-6 text-[#d4af37]" />
          </div>
          <h3 className="text-lg font-bold">Connect Sleeper to Access League Treasury</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Connect your Sleeper account via the form below to track dues, prize pools, and payouts. Your session is saved automatically.
          </p>
        </div>
        <SleeperAuthCard />
      </div>
    );
  }

  if (loadingFinances) {
    return <div className="min-h-[40vh] flex items-center justify-center"><TeamLoader size="lg" context="Loading league treasury" /></div>;
  }

  // ── Derived state across visible leagues ─────────────────────────────────────
  const visibleLeagues = managedLeagues.filter(l => !getFinance(l.leagueId).ignored);
  const hiddenLeagues = managedLeagues.filter(l => getFinance(l.leagueId).ignored);

  const metricsByLeague: Record<string, LeagueMetrics> = {};
  managedLeagues.forEach(l => { metricsByLeague[l.leagueId] = computeMetrics(getFinance(l.leagueId), teamsOf(l.leagueId)); });

  // Summary totals (visible, non-free count toward dues math).
  const totals = visibleLeagues.reduce((acc, l) => {
    const f = getFinance(l.leagueId);
    const m = metricsByLeague[l.leagueId];
    acc.dues += m.dues;
    acc.collected += m.collected;
    acc.prizePool += m.prizePool;
    acc.payoutsPending += m.payoutsPending;
    if (m.hasUnpaidPayouts) acc.payoutLeagues++;
    if (!f.isFree && m.hasIssue) acc.issueLeagues++;
    return acc;
  }, { dues: 0, collected: 0, prizePool: 0, payoutsPending: 0, payoutLeagues: 0, issueLeagues: 0 });
  const outstanding = Math.max(0, totals.dues - totals.collected);

  // Action Required buckets.
  const inBucket = (pred: (m: LeagueMetrics, f: LeagueFinanceData) => boolean) =>
    visibleLeagues
      .filter(l => { const f = getFinance(l.leagueId); return !f.isFree && pred(metricsByLeague[l.leagueId], f); })
      .map(l => ({ leagueId: l.leagueId, name: l.name }));

  const AMBER = "text-amber-600 dark:text-amber-400";
  const buckets: ActionBucket[] = [
    { key: "missing-payments", title: "Missing Payments", cta: "Review dues", icon: Wallet,
      accent: AMBER, leagues: inBucket(m => m.hasMissingPayments) },
    { key: "prize-setup", title: "Prize Setup Needed", cta: "Configure prizes", icon: TrophyIcon,
      accent: AMBER, leagues: inBucket(m => m.missingPrizes || m.missingBuyIn) },
    { key: "leaguesafe-missing", title: "LeagueSafe Missing", cta: "Add LeagueSafe link", icon: Link2,
      accent: "text-muted-foreground", leagues: inBucket(m => m.missingLeagueSafe) },
    { key: "payout-pending", title: "Payouts Pending", cta: "Mark payouts", icon: Banknote,
      accent: AMBER, leagues: inBucket(m => m.hasUnpaidPayouts) },
    { key: "recon", title: "Reconciliation Issues", cta: "Reconcile", icon: Scale,
      accent: "text-red-600 dark:text-red-400", leagues: inBucket(m => m.reconIssue) },
  ];
  const activeBuckets = buckets.filter(b => b.leagues.length > 0);

  const stillLoadingTeams = managedLeagues.some(l => teamsOf(l.leagueId) === 0);

  // Desktop grid: League | Format | Teams | Buy-In | Paid | Outstanding | Prize Pool | LeagueSafe | Status | Actions
  const COL = "grid-cols-[minmax(160px,1.4fr)_minmax(120px,1fr)_52px_64px_60px_84px_84px_72px_140px_84px]";

  function renderLeagueRow(league: typeof managedLeagues[number]) {
    const f = getFinance(league.leagueId);
    const m = metricsByLeague[league.leagueId];
    const status = leagueStatus(f, m);
    const isExpanded = expanded === league.leagueId;
    const hasSafe = !!f.leagueSafeUrl?.trim();

    return (
      <div key={league.leagueId}
        ref={el => { rowRefs.current[league.leagueId] = el; }}
        className={`border-b border-border/20 last:border-b-0 scroll-mt-24 ${isExpanded ? "bg-muted/10" : ""}`}
        data-testid={`finance-card-${league.leagueId}`}>

        {/* ── Mobile card ── */}
        <div className="md:hidden p-3 cursor-pointer" data-testid={`finance-mobile-${league.leagueId}`}
          role="button" tabIndex={0}
          aria-expanded={isExpanded}
          onClick={() => toggleExpand(league.leagueId)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(league.leagueId); } }}>
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center relative mt-0.5">
              <Trophy className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              {league.avatar && (
                <img src={`https://sleepercdn.com/avatars/thumbs/${league.avatar}`} alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[13px] leading-tight truncate">{league.name}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">
                {league.totalRosters}T · {league.scoringFormat} · {league.format} · {league.season}
              </p>
              {!f.isFree && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[11px]">
                  <span className="text-muted-foreground">Paid <span className="font-semibold text-foreground">{m.paidCount}/{m.teams}</span></span>
                  <span className="text-muted-foreground">Out <span className={`font-semibold ${m.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>{fmtDollar(m.outstanding)}</span></span>
                  <span className="text-muted-foreground">Pool <span className="font-semibold text-foreground">{fmtDollar(m.prizePool)}</span></span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 mt-2">
                <StatusPill status={status} />
                <button
                  onClick={e => { e.stopPropagation(); toggleExpand(league.leagueId); }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-border/50 text-[11px] font-semibold hover:bg-muted/50 transition-colors"
                  data-testid={`button-manage-mobile-${league.leagueId}`}>
                  Manage {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Desktop row ── */}
        <div className={`hidden md:grid w-full ${COL} gap-x-2 px-4 py-2.5 items-center cursor-pointer ${isExpanded ? "" : "hover:bg-muted/30"} transition-colors`}
          role="button" tabIndex={0}
          aria-expanded={isExpanded}
          onClick={() => toggleExpand(league.leagueId)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(league.leagueId); } }}
          data-testid={`finance-row-${league.leagueId}`}>
          {/* League */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center relative">
              <Trophy className="w-3.5 h-3.5 text-[#0b3a7a] dark:text-blue-400" />
              {league.avatar && (
                <img src={`https://sleepercdn.com/avatars/thumbs/${league.avatar}`} alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  data-testid={`img-league-avatar-${league.leagueId}`} />
              )}
            </div>
            <p className="font-semibold text-xs truncate leading-tight">{league.name}</p>
          </div>
          {/* Format */}
          <span className="text-[11px] text-muted-foreground truncate">{league.scoringFormat} · {league.format} · {league.season}</span>
          {/* Teams */}
          <span className="text-xs font-medium text-center">{league.totalRosters}</span>
          {/* Buy-In */}
          <div className="text-right">
            {f.isFree ? <span className="text-[10px] text-slate-500 font-semibold">Free</span>
              : f.buyIn > 0 ? <span className="text-xs font-medium">{fmtDollar(f.buyIn)}</span>
              : <span className="text-[10px] text-muted-foreground">—</span>}
          </div>
          {/* Paid */}
          <span className="text-xs font-medium text-center tabular-nums">{f.isFree ? "—" : `${m.paidCount}/${m.teams}`}</span>
          {/* Outstanding */}
          <div className="text-right">
            {f.isFree ? <span className="text-[10px] text-muted-foreground">—</span>
              : <span className={`text-xs font-semibold ${m.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{fmtDollar(m.outstanding)}</span>}
          </div>
          {/* Prize Pool */}
          <div className="text-right">
            {m.prizePool > 0 ? <span className="text-xs font-medium">{fmtDollar(m.prizePool)}</span> : <span className="text-[10px] text-muted-foreground">—</span>}
          </div>
          {/* LeagueSafe */}
          <div className="flex justify-center">
            {f.isFree ? <span className="text-[10px] text-muted-foreground">—</span>
              : hasSafe ? (
                <a href={f.leagueSafeUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#d4af37] hover:underline"
                  onClick={e => e.stopPropagation()}
                  data-testid={`row-leaguesafe-${league.leagueId}`}>
                  Added <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ) : <span className="text-[10px] font-semibold text-muted-foreground">Missing</span>}
          </div>
          {/* Status */}
          <div className="flex items-center gap-1.5">
            <StatusPill status={status} />
            {saving[league.leagueId] && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {saved[league.leagueId] && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
          </div>
          {/* Actions */}
          <div className="flex justify-end">
            <button
              onClick={e => { e.stopPropagation(); toggleExpand(league.leagueId); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-border/50 text-[11px] font-semibold hover:bg-muted/50 transition-colors"
              data-testid={`button-manage-${league.leagueId}`}>
              Manage {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {isExpanded && (
          <FinanceLeagueEditor
            leagueId={league.leagueId}
            finance={f}
            metrics={m}
            managers={managers[league.leagueId]}
            managersLoading={!!managersLoading[league.leagueId]}
            onUpdate={updateFinance}
            onAddPrize={addPrize}
            onRemovePrize={removePrize}
            onUpdatePrize={updatePrize}
            onUpdatePayment={updatePayment}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title="League Treasury" subtitle="Track dues, prize pools, LeagueSafe links, and payout readiness across your leagues." />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 md:gap-3">
        <SummaryCard icon={Wallet}   label="Total League Dues" value={fmtDollar(totals.dues)} testId="card-total-dues" />
        <SummaryCard icon={Receipt}  label="Collected"   value={fmtDollar(totals.collected)} accent="text-emerald-600 dark:text-emerald-400" testId="card-collected" />
        <SummaryCard icon={Receipt}  label="Outstanding" value={fmtDollar(outstanding)} accent={outstanding > 0 ? "text-amber-600 dark:text-amber-400" : undefined} testId="card-outstanding" />
        <SummaryCard icon={TrophyIcon} label="Prize Pool" value={fmtDollar(totals.prizePool)} testId="card-prize-pool" />
        <SummaryCard icon={Banknote} label="Payouts Pending" value={fmtDollar(totals.payoutsPending)} sub={totals.payoutLeagues > 0 ? `${totals.payoutLeagues} league${totals.payoutLeagues > 1 ? "s" : ""}` : undefined} accent={totals.payoutsPending > 0 ? "text-amber-600 dark:text-amber-400" : undefined} testId="card-payouts-pending" />
        <SummaryCard icon={AlertCircle} label="Issues" value={String(totals.issueLeagues)} sub={totals.issueLeagues === 1 ? "league" : "leagues"} accent={totals.issueLeagues > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"} testId="card-issues" />
      </div>

      {visibleLeagues.length === 0 && !stillLoadingTeams && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground text-sm">No leagues found for your account.</p>
        </Card>
      )}

      {/* Action Required */}
      {visibleLeagues.length > 0 && (
        <Card className="p-4 md:p-5 space-y-3 border border-border/50" data-testid="card-action-required">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center ring-1 ring-[#0b3a7a]/20 dark:ring-blue-400/20">
              <AlertCircle className="w-3.5 h-3.5 text-[#0b3a7a] dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Action Required</h3>
              <p className="text-[10.5px] text-muted-foreground/85 leading-tight">Quickly find leagues with missing payments, incomplete prize setup, or payout issues.</p>
            </div>
          </div>

          {activeBuckets.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-4 rounded-lg border border-dashed border-emerald-500/30 bg-emerald-500/5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">All leagues are squared away — dues collected, prizes configured, and LeagueSafe links in place.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {activeBuckets.map(bucket => {
                const Icon = bucket.icon;
                return (
                  <div key={bucket.key} className="rounded-xl border border-border/50 bg-muted/10 overflow-hidden flex flex-col" data-testid={`bucket-${bucket.key}`}>
                    <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-2">
                      <Icon className={`w-3.5 h-3.5 ${bucket.accent}`} />
                      <h4 className="text-[12px] font-bold flex-1 min-w-0 truncate">{bucket.title}</h4>
                      <span className={`shrink-0 inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full text-[11px] font-bold tabular-nums ${bucket.accent} bg-foreground/[0.04] border border-border/40`} data-testid={`bucket-count-${bucket.key}`}>
                        {bucket.leagues.length}
                      </span>
                    </div>
                    <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                      {bucket.leagues.slice(0, 6).map(lg => (
                        <button key={lg.leagueId}
                          onClick={() => openLeague(lg.leagueId)}
                          className={ACTION_CHIP}
                          data-testid={`bucket-league-${bucket.key}-${lg.leagueId}`}>
                          {lg.name}
                        </button>
                      ))}
                      {bucket.leagues.length > 6 && (
                        <span className="px-2 py-0.5 text-[10.5px] text-muted-foreground">+{bucket.leagues.length - 6} more</span>
                      )}
                    </div>
                    <button
                      onClick={() => openLeague(bucket.leagues[0].leagueId)}
                      className="mt-auto px-3 py-1.5 border-t border-border/40 flex items-center justify-between gap-2 text-[11px] font-semibold text-[#d4af37] hover:bg-muted/40 transition-colors"
                      data-testid={`bucket-cta-${bucket.key}`}>
                      {bucket.cta}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* League table */}
      {visibleLeagues.length > 0 && (
        <Card className="overflow-hidden">
          <div className="md:overflow-x-auto">
            <div className="md:min-w-[920px]">
              {/* Desktop header */}
              <div className={`hidden md:grid ${COL} gap-x-2 px-4 py-2.5 border-b border-border/50 bg-muted/30 items-center`}>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">League</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Format</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-center">Teams</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-right">Buy-In</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-center">Paid</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-right">Outstanding</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-right">Prize Pool</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-center">LeagueSafe</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Status</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-right">Actions</span>
              </div>
              {visibleLeagues.map(renderLeagueRow)}
            </div>
          </div>
        </Card>
      )}

      {/* Hidden leagues */}
      {hiddenLeagues.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2 text-muted-foreground/60">
            <EyeOff className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Hidden from Summary ({hiddenLeagues.length})</span>
            <div className="flex-1 h-px bg-border/30" />
          </div>
          {hiddenLeagues.map(league => {
            const isExpanded = expanded === league.leagueId;
            return (
              <Card key={league.leagueId} className="overflow-hidden opacity-60 hover:opacity-90 transition-opacity" data-testid={`finance-card-hidden-${league.leagueId}`}>
                <button className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors text-left" onClick={() => toggleExpand(league.leagueId)}>
                  <div className="flex items-center gap-2 min-w-0">
                    <EyeOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-muted-foreground truncate">{league.name}</span>
                    <StatusPill status="hidden" />
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>
                {isExpanded && (
                  <div className="border-t border-border/30 px-4 py-3">
                    <button onClick={() => updateFinance(league.leagueId, { ignored: false })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                      data-testid={`button-unhide-${league.leagueId}`}>
                      <Eye className="w-3 h-3" /> Unhide from Summary
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
