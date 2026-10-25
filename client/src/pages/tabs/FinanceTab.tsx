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
import { fetchTradeFeed, type TradeRow } from "@/lib/commissionerTradesApi";
import { fetchPriorLeagueSeasons } from "@/lib/sleeperApi";
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
  Check,
  X,
  EyeOff,
  Eye,
  Tag,
  ExternalLink,
  Wallet,
  Receipt,
  Trophy as TrophyIcon,
  Banknote,
  Search,
  Users,
  StickyNote,
  SlidersHorizontal,
  CalendarClock,
  History,
  Copy,
  ShieldAlert,
  Layers,
} from "lucide-react";

// ─── Data model ───────────────────────────────────────────────────────────────
// Finance is tracked PER SEASON. Dynasty/keeper leagues need prior-year
// LeagueSafe records, the current year's dues, and future-year obligations
// side by side, so each (league, season) pair is its own persisted row. All
// fields are schemaless/nullable on the server, so legacy single-season rows
// (which only ever had season "2026") load alongside the richer shapes below.

interface PrizeSlot {
  place: number;        // ordering key + default label source
  amount: number;
  label?: string;       // e.g. "1st", "Regular Season Points", "Empire Pool"
  paid?: boolean;
  paidDate?: string;    // optional ISO date
  notes?: string;       // optional — e.g. "Rolls over"
}

// Dynasty leagues need far more than paid/unpaid: prepaid (paid a future year
// early after trading that pick), comped/discounted (orphan incentives),
// transferred (replacement owner inherited the obligation), etc.
type ManagerPaymentStatus =
  | "unpaid" | "partial" | "paid" | "prepaid"
  | "comped" | "discounted" | "waived" | "refunded" | "transferred";

type PaymentReason =
  | "entry_fee" | "future_pick_prepay" | "orphan_discount" | "empire_pool" | "side_pot";

interface ManagerPayment {
  rosterId: string;     // stable Sleeper roster id (string)
  paid: number;         // amount collected from this manager
  status: ManagerPaymentStatus;
  paidDate?: string;
  notes?: string;
  reason?: PaymentReason;
  leagueSafeTransactionId?: string;
}

type LeagueSafeStatus = "not_created" | "active" | "closed";

interface LeagueFinanceData {
  leagueId: string;
  season: string;
  buyIn: number;
  prizes: PrizeSlot[];
  payments: ManagerPayment[];
  notes: string;
  isFree: boolean;
  ignored: boolean;
  leagueSafeUrl: string;
  leagueSafeStatus: LeagueSafeStatus;
  dueDate: string;       // free text / ISO date
  paymentRule: string;   // e.g. "Pay any future year you trade a pick in"
}

function defaultFinance(leagueId: string, season: string): LeagueFinanceData {
  return {
    leagueId, season, buyIn: 0, prizes: [], payments: [], notes: "",
    isFree: false, ignored: false, leagueSafeUrl: "",
    leagueSafeStatus: "not_created", dueDate: "", paymentRule: "",
  };
}

// Settled = no money is owed for the season (covers comp/waive/transfer cases).
const SETTLED_STATUSES = new Set<ManagerPaymentStatus>([
  "paid", "prepaid", "comped", "discounted", "waived", "transferred", "refunded",
]);
function isSettled(s: ManagerPaymentStatus) { return SETTLED_STATUSES.has(s); }
// Statuses that mean "this manager owes nothing toward expected dues".
const NO_DUE_STATUSES = new Set<ManagerPaymentStatus>(["comped", "waived"]);

// Manager roster info, fetched lazily from Sleeper when a league is expanded so
// the commissioner can track dues per real manager / team name. Dynasty rosters
// persist year to year, so the current league's managers seed every season.
interface ManagerInfo { rosterId: string; managerName: string; teamName: string; avatarUrl?: string; }

const SLEEPER_API = "https://api.sleeper.app/v1";

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

// ─── Season helpers ─────────────────────────────────────────────────────────────
// A league anchors on its Sleeper `season`. Prior years are NOT assumed — we only
// expose the seasons that actually existed for this league (detected by walking
// Sleeper's `previous_league_id` chain). Around the current season we still expose
// two future years (dues a manager may have to prepay because they traded a future
// pick). Future Sleeper leagues don't exist yet, so future-season finance is
// commissioner-projected.

function financeKey(leagueId: string, season: string) { return `${leagueId}::${season}`; }

// `priorSeasons` are the detected real prior seasons of this league (any order).
// When empty (not yet detected, or a brand-new league) only the current + future
// seasons are offered — we don't invent prior years that never happened.
function seasonsFor(currentSeason: string, priorSeasons: string[] = []): string[] {
  const cur = parseInt(currentSeason, 10) || new Date().getFullYear();
  const past = Array.from(
    new Set(priorSeasons.map(s => parseInt(s, 10)).filter(y => y && y < cur)),
  ).sort((a, b) => a - b);
  return [...past, cur, cur + 1, cur + 2].map(String);
}

type SeasonKind = "past" | "current" | "future";
function seasonKind(season: string, current: string): SeasonKind {
  const s = parseInt(season, 10), c = parseInt(current, 10);
  return s < c ? "past" : s > c ? "future" : "current";
}
function seasonSuffix(kind: SeasonKind) {
  return kind === "current" ? "Current" : kind === "future" ? "Future" : "";
}

// ─── Per-league/season derived finance metrics ──────────────────────────────────

interface LeagueMetrics {
  teams: number;
  waivedCount: number;
  dues: number;
  collected: number;
  outstanding: number;
  paidCount: number;
  prizePool: number;
  payoutsPending: number;
  hasUnpaidPayouts: boolean;
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
  const waivedCount = payments.filter(p => NO_DUE_STATUSES.has(p.status)).length;
  const effectiveTeams = Math.max(0, teams - waivedCount);
  const dues = f.isFree ? 0 : f.buyIn * effectiveTeams;
  const collected = payments.reduce((s, p) => s + (NO_DUE_STATUSES.has(p.status) ? 0 : (p.paid || 0)), 0);
  const outstanding = Math.max(0, dues - collected);
  const paidCount = payments.filter(p => isSettled(p.status)).length;
  const prizePool = prizes.reduce((s, p) => s + (p.amount || 0), 0);
  const payoutsPending = prizes.filter(p => !p.paid).reduce((s, p) => s + (p.amount || 0), 0);
  const hasUnpaidPayouts = prizes.length > 0 && prizes.some(p => !p.paid);

  const missingBuyIn = !f.isFree && f.buyIn <= 0;
  const missingPrizes = !f.isFree && prizes.length === 0;
  const missingLeagueSafe = !f.isFree && !f.leagueSafeUrl?.trim();
  const hasMissingPayments = !f.isFree && dues > 0 && collected < dues;
  const reconIssue = (prizePool > 0 && dues > 0 && prizePool > dues) || (dues > 0 && collected > dues);

  const hasIssue = !f.isFree && (missingBuyIn || missingPrizes || missingLeagueSafe || hasMissingPayments || reconIssue);

  return {
    teams, waivedCount, dues, collected, outstanding, paidCount,
    prizePool, payoutsPending, hasUnpaidPayouts,
    missingBuyIn, missingPrizes, missingLeagueSafe, hasMissingPayments, reconIssue, hasIssue,
  };
}

// ─── Future pick payment risk ────────────────────────────────────────────────────
// Bylaw pattern: "you must pay for any future year in which you trade a future
// pick." We read the league's trade feed and, for every future-dated pick a
// roster traded AWAY, flag the season they now owe. Severity escalates to a
// warning once that season's dues are still unsettled.

interface PickRiskEntry { season: string; picks: string[] }
// rosterId(string) → season → ["2027 1st", …]
type PickRiskMap = Map<string, Map<string, string[]>>;

function buildPickRisk(trades: TradeRow[], currentSeason: string): PickRiskMap {
  const cur = parseInt(currentSeason, 10);
  const map: PickRiskMap = new Map();
  for (const t of trades) {
    for (const a of t.assets || []) {
      if (a.assetType !== "pick" || !a.pickSeason || a.fromRosterId == null) continue;
      const ps = parseInt(a.pickSeason, 10);
      if (!Number.isFinite(ps) || ps < cur) continue;      // only current/future obligations
      const roster = String(a.fromRosterId);
      const label = `${a.pickSeason} ${a.pickRound ? ordinal(a.pickRound) : "pick"}`;
      const bySeason = map.get(roster) ?? new Map<string, string[]>();
      const list = bySeason.get(a.pickSeason) ?? [];
      if (!list.includes(label)) list.push(label);
      bySeason.set(a.pickSeason, list);
      map.set(roster, bySeason);
    }
  }
  return map;
}

function pickRiskFor(map: PickRiskMap, rosterId: string): PickRiskEntry[] {
  const bySeason = map.get(rosterId);
  if (!bySeason) return [];
  return Array.from(bySeason.entries())
    .map(([season, picks]) => ({ season, picks }))
    .sort((a, b) => a.season.localeCompare(b.season));
}

// ─── League-level status pills (collapsed table) ────────────────────────────────

type StatusKey =
  | "ready" | "missing-payments" | "prize-setup" | "leaguesafe-missing"
  | "payout-pending" | "free" | "hidden";

const STATUS_CONFIG: Record<StatusKey, { label: string; cls: string; dot: string }> = {
  ready:               { label: "Ready",            cls: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5", dot: "bg-emerald-500" },
  "missing-payments":  { label: "Missing Payments", cls: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5",        dot: "bg-amber-500" },
  "prize-setup":       { label: "Prize Setup Needed", cls: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5",      dot: "bg-amber-500" },
  "leaguesafe-missing":{ label: "LeagueSafe Missing", cls: "border-border/50 text-muted-foreground bg-muted/20",                          dot: "bg-muted-foreground/40" },
  "payout-pending":    { label: "Payout Pending",   cls: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5",        dot: "bg-amber-500" },
  free:                { label: "Free League",      cls: "border-slate-500/30 text-slate-500 dark:text-slate-400 bg-slate-500/5",        dot: "bg-slate-500" },
  hidden:              { label: "Hidden",           cls: "border-border/50 text-muted-foreground",                                        dot: "bg-muted-foreground/40" },
};

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

// ─── Payment status select + chips (9 dynasty statuses) ─────────────────────────

const PAYMENT_STATUS_OPTIONS: { value: ManagerPaymentStatus; label: string }[] = [
  { value: "unpaid",      label: "Unpaid" },
  { value: "partial",     label: "Partial" },
  { value: "paid",        label: "Paid" },
  { value: "prepaid",     label: "Prepaid" },
  { value: "comped",      label: "Comped" },
  { value: "discounted",  label: "Discounted" },
  { value: "waived",      label: "Waived" },
  { value: "refunded",    label: "Refunded" },
  { value: "transferred", label: "Transferred" },
];

const STATUS_CHIP: Record<ManagerPaymentStatus, string> = {
  paid:        "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  prepaid:     "text-teal-600 dark:text-teal-400 bg-teal-500/10 border-teal-500/30",
  partial:     "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
  unpaid:      "text-red-600/90 dark:text-red-400/90 bg-red-500/[0.06] border-red-500/20",
  comped:      "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/30",
  discounted:  "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30",
  waived:      "text-slate-500 dark:text-slate-400 bg-slate-500/10 border-slate-500/25",
  refunded:    "text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30",
  transferred: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
};

// Compute the `paid` amount implied by a status change, given the season buy-in.
function paidForStatus(status: ManagerPaymentStatus, owed: number, prevPaid: number) {
  if (status === "paid" || status === "prepaid") return owed;
  if (status === "partial" || status === "discounted") return prevPaid;   // commissioner enters the amount
  return 0;                                                                // unpaid / comped / waived / refunded / transferred
}

function PaymentStatusSelect({
  value, onChange, testId, className = "",
}: { value: ManagerPaymentStatus; onChange: (v: ManagerPaymentStatus) => void; testId?: string; className?: string }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as ManagerPaymentStatus)}>
      <SelectTrigger
        className={`h-7 px-2 text-[11px] font-semibold rounded-md border ${STATUS_CHIP[value]} ${className || "w-[118px]"}`}
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

// ─── Debounced free-text fields ─────────────────────────────────────────────────
// Hold their own draft + debounce so typing never thrashes the save endpoint and
// inputs never lose focus on parent re-render. Give them a `key` that changes
// with (league, season, field) so switching season remounts with fresh values.

function DebouncedInput({
  value, onCommit, delay = 600, className = "", ...rest
}: { value: string; onCommit: (v: string) => void; delay?: number } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(v), delay);
  };
  return (
    <Input
      {...rest}
      className={className}
      value={draft}
      onChange={e => { setDraft(e.target.value); flush(e.target.value); }}
      onBlur={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } if (draft !== value) onCommit(draft); }}
    />
  );
}

function DebouncedTextarea({
  value, onCommit, delay = 600, className = "", ...rest
}: { value: string; onCommit: (v: string) => void; delay?: number } & Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(v), delay);
  };
  return (
    <Textarea
      {...rest}
      className={className}
      value={draft}
      onChange={e => { setDraft(e.target.value); flush(e.target.value); }}
      onBlur={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } if (draft !== value) onCommit(draft); }}
    />
  );
}

// ─── Small shared bits ───────────────────────────────────────────────────────────

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      <div className="flex-1 h-px bg-border/30" />
      {action}
    </div>
  );
}

function NotConfigured({ testId }: { testId?: string }) {
  return <X className="w-3.5 h-3.5 text-red-500" aria-label="Not configured" data-testid={testId} />;
}

function Stat({ label, value, valueCls = "" }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${valueCls}`}>{value}</span>
    </div>
  );
}

function ManagerAvatar({ url }: { url?: string }) {
  return (
    <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center relative">
      <Users className="w-3.5 h-3.5 text-[#0b3a7a]/60 dark:text-blue-400/60" />
      {url && (
        <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      )}
    </div>
  );
}

const LEAGUE_SAFE_STATUS_OPTIONS: { value: LeagueSafeStatus; label: string }[] = [
  { value: "not_created", label: "Not Created" },
  { value: "active",      label: "Active" },
  { value: "closed",      label: "Closed" },
];
const LEAGUE_SAFE_STATUS_CHIP: Record<LeagueSafeStatus, string> = {
  not_created: "text-slate-500 dark:text-slate-400 bg-slate-500/10 border-slate-500/25",
  active:      "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  closed:      "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30",
};

// ════════════════════════════════════════════════════════════════════════════════
//  Sub-views
// ════════════════════════════════════════════════════════════════════════════════

type SubviewKey = "current" | "future" | "ledger" | "leaguesafe" | "payouts";

interface SubviewCommon {
  leagueId: string;
  currentSeason: string;
  /** Detected real prior seasons of this league (newest/oldest order agnostic). */
  priorSeasons: string[];
  managers: ManagerInfo[] | undefined;
  managersLoading: boolean;
  getFinance: (season: string) => LeagueFinanceData;
  update: (season: string, patch: Partial<LeagueFinanceData>) => void;
  pickRisk: PickRiskMap;
}

// ─── Multi-year summary bar ──────────────────────────────────────────────────────

function MultiYearSummaryBar({
  currentSeason, priorSeasons, getFinance, managers, pickRisk,
}: Pick<SubviewCommon, "currentSeason" | "priorSeasons" | "getFinance" | "managers" | "pickRisk">) {
  const seasons = seasonsFor(currentSeason, priorSeasons);
  const teams = managers?.length ?? 0;
  const cur = getFinance(currentSeason);
  const curM = computeMetrics(cur, teams);

  const futureSeasons = seasons.filter(s => seasonKind(s, currentSeason) === "future");
  const pastSeasons = seasons.filter(s => seasonKind(s, currentSeason) === "past");

  const prepaidCounts = futureSeasons.map(s => {
    const f = getFinance(s);
    const n = f.payments.filter(p => isSettled(p.status)).length;
    return { season: s, n };
  });

  // A risk is "open" when a roster traded a future pick and that season is unsettled.
  let openRisks = 0;
  if (managers) {
    for (const m of managers) {
      for (const entry of pickRiskFor(pickRisk, m.rosterId)) {
        const status = getFinance(entry.season).payments.find(p => p.rosterId === m.rosterId)?.status ?? "unpaid";
        if (!isSettled(status)) openRisks++;
      }
    }
  }

  const closedHistory = pastSeasons.filter(s => getFinance(s).leagueSafeStatus === "closed");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      {/* Current */}
      <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1.5">{currentSeason} Current</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Stat label="Expected" value={cur.isFree ? "Free" : fmtDollar(curM.dues)} />
          <Stat label="Collected" value={fmtDollar(curM.collected)} valueCls="text-emerald-600 dark:text-emerald-400" />
          <Stat label="Out" value={cur.isFree ? "—" : fmtDollar(curM.outstanding)} valueCls={curM.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"} />
          <Stat label="Paid" value={cur.isFree ? "—" : `${curM.paidCount}/${teams || curM.teams}`} />
        </div>
      </div>
      {/* Future dues */}
      <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-1.5">Future Dues</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {prepaidCounts.map(({ season, n }) => (
            <Stat key={season} label={`${season} prepaid`} value={`${n}/${teams}`} />
          ))}
          <Stat label="Pick risks" value={String(openRisks)}
            valueCls={openRisks > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"} />
        </div>
      </div>
      {/* History */}
      <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">History</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {closedHistory.length > 0 ? closedHistory.map(s => (
            <span key={s} className="inline-flex items-center gap-1 text-muted-foreground">
              <Check className="w-3 h-3 text-blue-500" />{s} closed
            </span>
          )) : <span className="text-xs text-muted-foreground italic">No closed prior seasons recorded.</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Manager payment card (used in Current Season) ──────────────────────────────

function ManagerPaymentCard({
  m, leagueId, season, owed, payment, onUpdate, risk,
}: {
  m: ManagerInfo; leagueId: string; season: string; owed: number;
  payment: ManagerPayment | undefined;
  onUpdate: (rosterId: string, patch: Partial<ManagerPayment>) => void;
  risk?: PickRiskEntry[];
}) {
  const status: ManagerPaymentStatus = payment?.status ?? "unpaid";
  const openRisk = (risk ?? []).some(r => r.season === season && !isSettled(status));
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border/30 bg-muted/20 hover:bg-muted/30 transition-colors"
      data-testid={`payment-row-${leagueId}-${season}-${m.rosterId}`}>
      <ManagerAvatar url={m.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate leading-tight flex items-center gap-1">
          {m.managerName}
          {openRisk && <ShieldAlert className="w-3 h-3 text-amber-500 flex-shrink-0" aria-label="Future pick payment risk" />}
        </p>
        <p className="text-[10px] text-muted-foreground truncate leading-tight">
          {m.teamName} <span className="text-muted-foreground/70">· {fmtDollar(owed)}</span>
        </p>
      </div>
      {(status === "partial" || status === "discounted") && (
        <div className="relative w-16 flex-shrink-0">
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">$</span>
          <Input type="number" min="0" className="pl-4 h-7 text-xs" value={payment?.paid || ""} placeholder="0"
            onChange={e => onUpdate(m.rosterId, { paid: parseFloat(e.target.value) || 0 })}
            data-testid={`payment-amount-${leagueId}-${season}-${m.rosterId}`} />
        </div>
      )}
      <PaymentStatusSelect
        value={status}
        onChange={v => onUpdate(m.rosterId, { status: v, paid: paidForStatus(v, owed, payment?.paid || 0) })}
        testId={`payment-status-${leagueId}-${season}-${m.rosterId}`} />
    </div>
  );
}

// ─── Current Season view ─────────────────────────────────────────────────────────

function CurrentSeasonView({
  leagueId, season, currentSeason, managers, managersLoading, getFinance, update, pickRisk, allowClone,
}: SubviewCommon & { season: string; allowClone: boolean }) {
  const f = getFinance(season);
  const teams = managers?.length ?? 0;
  const metrics = computeMetrics(f, teams);
  const owed = f.buyIn;
  const [search, setSearch] = useState("");
  const kind = seasonKind(season, currentSeason);
  const prevSeason = String(parseInt(season, 10) - 1);

  const updatePayment = useCallback((rosterId: string, patch: Partial<ManagerPayment>) => {
    const cur = getFinance(season);
    const existing = cur.payments.find(p => p.rosterId === rosterId);
    const next = existing
      ? cur.payments.map(p => p.rosterId === rosterId ? { ...p, ...patch } : p)
      : [...cur.payments, { rosterId, paid: 0, status: "unpaid" as ManagerPaymentStatus, ...patch }];
    update(season, { payments: next });
  }, [getFinance, season, update]);

  const markAll = useCallback((status: ManagerPaymentStatus) => {
    if (!managers) return;
    const cur = getFinance(season);
    const next: ManagerPayment[] = managers.map(m => {
      const existing = cur.payments.find(p => p.rosterId === m.rosterId);
      return {
        rosterId: m.rosterId,
        paid: paidForStatus(status, owed, existing?.paid || 0),
        status,
        ...(existing?.paidDate ? { paidDate: existing.paidDate } : {}),
        ...(existing?.notes ? { notes: existing.notes } : {}),
        ...(existing?.reason ? { reason: existing.reason } : {}),
      };
    });
    update(season, { payments: next });
  }, [managers, getFinance, season, owed, update]);

  const cloneFromPrev = useCallback(() => {
    const prev = getFinance(prevSeason);
    update(season, {
      buyIn: prev.buyIn,
      prizes: prev.prizes.map(p => ({ ...p, paid: false, paidDate: undefined })),
      paymentRule: prev.paymentRule,
      notes: prev.notes,
      payments: (managers ?? []).map(m => ({ rosterId: m.rosterId, paid: 0, status: "unpaid" as ManagerPaymentStatus })),
      leagueSafeStatus: kind === "future" ? "not_created" : prev.leagueSafeStatus,
    });
  }, [getFinance, prevSeason, season, update, managers, kind]);

  const settled = managers
    ? managers.filter(m => isSettled(f.payments.find(p => p.rosterId === m.rosterId)?.status ?? "unpaid")).length
    : 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !managers) return managers ?? [];
    return managers.filter(m => m.managerName.toLowerCase().includes(q) || m.teamName.toLowerCase().includes(q));
  }, [managers, search]);

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-xs">
        <Stat label="Expected" value={f.isFree ? "Free" : fmtDollar(metrics.dues)} />
        <Stat label="Collected" value={fmtDollar(metrics.collected)} valueCls="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Outstanding" value={f.isFree ? "—" : fmtDollar(metrics.outstanding)}
          valueCls={metrics.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"} />
        <Stat label="Paid" value={f.isFree ? "—" : `${metrics.paidCount} / ${teams || metrics.teams}`} />
      </div>

      {/* Financial setup */}
      <div>
        <SectionLabel action={allowClone ? (
          <button onClick={cloneFromPrev}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#d4af37] hover:opacity-80 transition-opacity"
            data-testid={`button-clone-${leagueId}-${season}`}>
            <Copy className="w-3 h-3" /> Clone from {prevSeason}
          </button>
        ) : undefined}>{season} Financial Setup{seasonSuffix(kind) ? ` · ${seasonSuffix(kind)}` : ""}</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Entry Fee</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
              <Input type="number" min="0" className="pl-6 h-9 text-sm" value={f.buyIn || ""} placeholder="0"
                onChange={e => update(season, { buyIn: parseFloat(e.target.value) || 0 })}
                data-testid={`input-buyin-${leagueId}-${season}`} />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Due Date</label>
            <DebouncedInput key={`due-${leagueId}-${season}`} type="text" placeholder="Sep 1, 2026"
              className="h-9 text-sm" value={f.dueDate} onCommit={v => update(season, { dueDate: v })}
              data-testid={`input-duedate-${leagueId}-${season}`} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">LeagueSafe Link</label>
            <div className="relative">
              <DebouncedInput key={`safe-${leagueId}-${season}`} type="url" placeholder="https://leaguesafe.com/league/…"
                className={`h-9 text-sm ${f.leagueSafeUrl ? "pr-9" : ""}`} value={f.leagueSafeUrl}
                onCommit={v => update(season, { leagueSafeUrl: v, leagueSafeStatus: v && f.leagueSafeStatus === "not_created" ? "active" : f.leagueSafeStatus })}
                data-testid={`input-leaguesafe-${leagueId}-${season}`} />
              {f.leagueSafeUrl && (
                <a href={f.leagueSafeUrl} target="_blank" rel="noopener noreferrer"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#d4af37] hover:opacity-70 transition-opacity"
                  onClick={e => e.stopPropagation()}>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Payment Rule</label>
            <DebouncedInput key={`rule-${leagueId}-${season}`} type="text" placeholder="Pay future years if you trade a pick"
              className="h-9 text-sm" value={f.paymentRule} onCommit={v => update(season, { paymentRule: v })}
              data-testid={`input-paymentrule-${leagueId}-${season}`} />
          </div>
          <div className="sm:col-span-3">
            <label className="text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <StickyNote className="w-3 h-3" /> Notes
            </label>
            <DebouncedTextarea key={`notes-${leagueId}-${season}`} placeholder="Payout method, side pots, dues deadline…"
              className="text-sm min-h-[40px] resize-y" value={f.notes} onCommit={v => update(season, { notes: v })}
              data-testid={`input-notes-${leagueId}-${season}`} />
          </div>
        </div>
      </div>

      {/* Manager payments */}
      {!f.isFree && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Manager Payments</span>
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{settled} settled</span>
              {" / "}
              <span className="font-semibold">{Math.max(0, teams - settled)} open</span>
            </span>
            <div className="flex-1" />
            {managers && managers.length > 0 && (
              <>
                <div className="relative w-full sm:w-44">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search manager…" className="pl-8 h-8 text-xs"
                    data-testid={`input-payment-search-${leagueId}-${season}`} />
                </div>
                <button onClick={() => markAll("paid")}
                  className="flex items-center gap-1 px-2.5 h-8 rounded-md border border-border/50 text-[11px] font-semibold text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-500/40 transition-colors"
                  data-testid={`button-mark-all-paid-${leagueId}-${season}`}>
                  <CheckCircle2 className="w-3 h-3" /> Mark all paid
                </button>
                <button onClick={() => markAll("unpaid")}
                  className="flex items-center gap-1 px-2.5 h-8 rounded-md border border-border/50 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`button-mark-all-unpaid-${leagueId}-${season}`}>
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
            filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-1 py-2">No managers match "{search}".</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {filtered.map(m => (
                  <ManagerPaymentCard key={m.rosterId} m={m} leagueId={leagueId} season={season} owed={owed}
                    payment={f.payments.find(p => p.rosterId === m.rosterId)}
                    risk={pickRiskFor(pickRisk, m.rosterId)}
                    onUpdate={updatePayment} />
                ))}
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground italic">Could not load this league's managers from Sleeper.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Future Dues view ────────────────────────────────────────────────────────────

function FutureDuesView({
  leagueId, currentSeason, managers, managersLoading, getFinance, update, pickRisk,
}: SubviewCommon) {
  const seasons = seasonsFor(currentSeason).filter(s => seasonKind(s, currentSeason) !== "past");

  const setStatus = useCallback((season: string, rosterId: string, status: ManagerPaymentStatus, reason?: PaymentReason) => {
    const cur = getFinance(season);
    const owed = cur.buyIn;
    const existing = cur.payments.find(p => p.rosterId === rosterId);
    const patch: Partial<ManagerPayment> = { status, paid: paidForStatus(status, owed, existing?.paid || 0), ...(reason ? { reason } : {}) };
    const next = existing
      ? cur.payments.map(p => p.rosterId === rosterId ? { ...p, ...patch } : p)
      : [...cur.payments, { rosterId, paid: 0, status: "unpaid" as ManagerPaymentStatus, ...patch }];
    update(season, { payments: next });
  }, [getFinance, update]);

  if (managersLoading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading managers…</div>;
  }
  if (!managers || managers.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Could not load this league's managers from Sleeper.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Who owes for upcoming seasons. Managers who traded a future pick should be paid for that year —
        <span className="text-amber-600 dark:text-amber-400 font-medium"> ⚠ flags an unsettled obligation</span>.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0 min-w-[640px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left font-bold px-2 py-2 sticky left-0 bg-background">Manager</th>
              {seasons.map(s => (
                <th key={s} className="text-center font-bold px-2 py-2 whitespace-nowrap">
                  {s}{seasonKind(s, currentSeason) === "current" ? " ·now" : ""}
                </th>
              ))}
              <th className="text-left font-bold px-2 py-2">Future Pick Risk</th>
            </tr>
          </thead>
          <tbody>
            {managers.map(m => {
              const risks = pickRiskFor(pickRisk, m.rosterId);
              const openRisks = risks.filter(r =>
                seasons.includes(r.season) &&
                !isSettled(getFinance(r.season).payments.find(p => p.rosterId === m.rosterId)?.status ?? "unpaid"));
              return (
                <tr key={m.rosterId} className="border-b border-border/20" data-testid={`future-row-${leagueId}-${m.rosterId}`}>
                  <td className="px-2 py-1.5 sticky left-0 bg-background">
                    <div className="flex items-center gap-2 min-w-0">
                      <ManagerAvatar url={m.avatarUrl} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate leading-tight">{m.managerName}</p>
                        <p className="text-[10px] text-muted-foreground truncate leading-tight">{m.teamName}</p>
                      </div>
                    </div>
                  </td>
                  {seasons.map(s => {
                    const status = getFinance(s).payments.find(p => p.rosterId === m.rosterId)?.status ?? "unpaid";
                    return (
                      <td key={s} className="px-2 py-1.5 text-center">
                        <PaymentStatusSelect value={status} className="w-[110px] mx-auto"
                          onChange={v => setStatus(s, m.rosterId, v)}
                          testId={`future-status-${leagueId}-${s}-${m.rosterId}`} />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5">
                    {risks.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">Clear</span>
                    ) : (
                      <div className="space-y-1">
                        {risks.map(r => {
                          const status = getFinance(r.season).payments.find(p => p.rosterId === m.rosterId)?.status ?? "unpaid";
                          const open = !isSettled(status);
                          return (
                            <div key={r.season} className="flex items-center gap-1.5 flex-wrap">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${open ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                                {open && <ShieldAlert className="w-3 h-3" />}
                                Traded {r.picks.join(", ")}
                              </span>
                              {open && (
                                <button
                                  onClick={() => setStatus(r.season, m.rosterId, "prepaid", "future_pick_prepay")}
                                  className="px-1.5 py-0.5 rounded border border-teal-500/40 text-teal-600 dark:text-teal-400 text-[10px] font-semibold hover:bg-teal-500/10 transition-colors"
                                  data-testid={`button-mark-prepaid-${leagueId}-${r.season}-${m.rosterId}`}>
                                  Mark {r.season} prepaid
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
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

// ─── Manager Ledger view ─────────────────────────────────────────────────────────

const PAYMENT_REASON_OPTIONS: { value: PaymentReason; label: string }[] = [
  { value: "entry_fee", label: "Entry fee" },
  { value: "future_pick_prepay", label: "Future pick prepay" },
  { value: "orphan_discount", label: "Orphan discount" },
  { value: "empire_pool", label: "Empire pool" },
  { value: "side_pot", label: "Side pot" },
];

function ManagerLedgerView({
  leagueId, currentSeason, priorSeasons, managers, managersLoading, getFinance, update,
}: SubviewCommon) {
  const [selected, setSelected] = useState<string | null>(null);
  const seasons = seasonsFor(currentSeason, priorSeasons);

  const updatePayment = useCallback((season: string, rosterId: string, patch: Partial<ManagerPayment>) => {
    const cur = getFinance(season);
    const existing = cur.payments.find(p => p.rosterId === rosterId);
    const next = existing
      ? cur.payments.map(p => p.rosterId === rosterId ? { ...p, ...patch } : p)
      : [...cur.payments, { rosterId, paid: 0, status: "unpaid" as ManagerPaymentStatus, ...patch }];
    update(season, { payments: next });
  }, [getFinance, update]);

  if (managersLoading) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading managers…</div>;
  }
  if (!managers || managers.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Could not load this league's managers from Sleeper.</p>;
  }

  const sel = selected ?? managers[0]?.rosterId ?? null;
  const selManager = managers.find(m => m.rosterId === sel);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
      {/* Manager list */}
      <div className="space-y-1 md:max-h-[420px] md:overflow-y-auto pr-1">
        {managers.map(m => {
          const active = m.rosterId === sel;
          const settledCount = seasons.filter(s => isSettled(getFinance(s).payments.find(p => p.rosterId === m.rosterId)?.status ?? "unpaid")).length;
          return (
            <button key={m.rosterId} onClick={() => setSelected(m.rosterId)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md border text-left transition-colors ${active ? "border-[#d4af37]/40 bg-[#d4af37]/5" : "border-border/30 bg-muted/10 hover:bg-muted/30"}`}
              data-testid={`ledger-manager-${leagueId}-${m.rosterId}`}>
              <ManagerAvatar url={m.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate leading-tight">{m.managerName}</p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">{settledCount}/{seasons.length} seasons settled</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected manager's multi-year ledger */}
      <div className="space-y-2">
        {selManager && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <ManagerAvatar url={selManager.avatarUrl} />
              <div>
                <p className="text-sm font-bold leading-tight">{selManager.managerName}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{selManager.teamName}</p>
              </div>
            </div>
            {seasons.map(s => {
              const f = getFinance(s);
              const pay = f.payments.find(p => p.rosterId === sel);
              const status = pay?.status ?? "unpaid";
              const kind = seasonKind(s, currentSeason);
              return (
                <div key={s} className="rounded-lg border border-border/30 bg-muted/15 px-3 py-2 space-y-2" data-testid={`ledger-season-${leagueId}-${s}-${sel}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold tabular-nums w-12">{s}</span>
                    {seasonSuffix(kind) && <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{seasonSuffix(kind)}</span>}
                    <PaymentStatusSelect value={status}
                      onChange={v => updatePayment(s, sel!, { status: v, paid: paidForStatus(v, f.buyIn, pay?.paid || 0) })}
                      testId={`ledger-status-${leagueId}-${s}-${sel}`} />
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {isSettled(status) || status === "partial" ? fmtDollar(pay?.paid || 0) : "—"}
                      <span className="text-muted-foreground/60"> / {fmtDollar(f.buyIn)}</span>
                    </span>
                    {f.leagueSafeStatus && f.leagueSafeStatus !== "not_created" && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${LEAGUE_SAFE_STATUS_CHIP[f.leagueSafeStatus]}`}>
                        LeagueSafe {f.leagueSafeStatus}
                      </span>
                    )}
                    <div className="flex-1" />
                    <Select value={pay?.reason ?? "entry_fee"}
                      onValueChange={v => updatePayment(s, sel!, { reason: v as PaymentReason })}>
                      <SelectTrigger className="h-7 w-[150px] text-[11px]" data-testid={`ledger-reason-${leagueId}-${s}-${sel}`}>
                        <SelectValue placeholder="Reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_REASON_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <DebouncedInput key={`ledger-note-${leagueId}-${s}-${sel}`} type="text"
                    placeholder="Credits, orphan discount, refund, prepay note…"
                    className="h-8 text-xs" value={pay?.notes ?? ""}
                    onCommit={v => updatePayment(s, sel!, { notes: v })}
                    data-testid={`ledger-note-${leagueId}-${s}-${sel}`} />
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ─── LeagueSafe History view ─────────────────────────────────────────────────────

function LeagueSafeHistoryView({
  leagueId, currentSeason, priorSeasons, managers, getFinance, update,
}: SubviewCommon) {
  const seasons = seasonsFor(currentSeason, priorSeasons);
  const teams = managers?.length ?? 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Year-based LeagueSafe records. Future years can be tracked manually before a LeagueSafe link exists.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/40">
              <th className="text-left font-bold px-2 py-2">Season</th>
              <th className="text-left font-bold px-2 py-2">LeagueSafe Link</th>
              <th className="text-center font-bold px-2 py-2">Status</th>
              <th className="text-right font-bold px-2 py-2">Expected</th>
              <th className="text-right font-bold px-2 py-2">Collected</th>
              <th className="text-center font-bold px-2 py-2">Paid</th>
              <th className="text-left font-bold px-2 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map(s => {
              const f = getFinance(s);
              const m = computeMetrics(f, teams);
              const kind = seasonKind(s, currentSeason);
              return (
                <tr key={s} className="border-b border-border/20" data-testid={`leaguesafe-row-${leagueId}-${s}`}>
                  <td className="px-2 py-2 align-top">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold tabular-nums">{s}</span>
                      {seasonSuffix(kind) && <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{seasonSuffix(kind)}</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div className="relative">
                      <DebouncedInput key={`safe-link-${leagueId}-${s}`} type="url" placeholder="https://leaguesafe.com/…"
                        className={`h-8 text-xs ${f.leagueSafeUrl ? "pr-8" : ""}`} value={f.leagueSafeUrl}
                        onCommit={v => update(s, { leagueSafeUrl: v, leagueSafeStatus: v && f.leagueSafeStatus === "not_created" ? "active" : f.leagueSafeStatus })}
                        data-testid={`leaguesafe-link-${leagueId}-${s}`} />
                      {f.leagueSafeUrl && (
                        <a href={f.leagueSafeUrl} target="_blank" rel="noopener noreferrer"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#d4af37] hover:opacity-70">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top text-center">
                    <Select value={f.leagueSafeStatus} onValueChange={v => update(s, { leagueSafeStatus: v as LeagueSafeStatus })}>
                      <SelectTrigger className={`h-7 w-[112px] mx-auto text-[11px] font-semibold border ${LEAGUE_SAFE_STATUS_CHIP[f.leagueSafeStatus]}`}
                        data-testid={`leaguesafe-status-${leagueId}-${s}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAGUE_SAFE_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-2 align-top text-right text-xs tabular-nums">{f.isFree ? "Free" : fmtDollar(m.dues)}</td>
                  <td className="px-2 py-2 align-top text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">{fmtDollar(m.collected)}</td>
                  <td className="px-2 py-2 align-top text-center text-xs tabular-nums">{f.isFree ? "—" : `${m.paidCount}/${teams || m.teams}`}</td>
                  <td className="px-2 py-2 align-top">
                    <DebouncedInput key={`safe-note-${leagueId}-${s}`} type="text" placeholder="Paid out, rollover…"
                      className="h-8 text-xs" value={f.notes} onCommit={v => update(s, { notes: v })}
                      data-testid={`leaguesafe-note-${leagueId}-${s}`} />
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

// ─── Payouts view (season-scoped) ────────────────────────────────────────────────

function PayoutsView({
  leagueId, season, currentSeason, managers, getFinance, update,
}: SubviewCommon & { season: string }) {
  const f = getFinance(season);
  const teams = managers?.length ?? 0;
  const metrics = computeMetrics(f, teams);
  const kind = seasonKind(season, currentSeason);

  const addPrize = useCallback(() => {
    const cur = getFinance(season);
    const nextPlace = (cur.prizes.length > 0 ? Math.max(...cur.prizes.map(p => p.place)) : 0) + 1;
    update(season, { prizes: [...cur.prizes, { place: nextPlace, amount: 0, label: ordinal(nextPlace), paid: false }] });
  }, [getFinance, season, update]);

  const updatePrize = useCallback((place: number, patch: Partial<PrizeSlot>) => {
    const cur = getFinance(season);
    update(season, { prizes: cur.prizes.map(p => p.place === place ? { ...p, ...patch } : p) });
  }, [getFinance, season, update]);

  const removePrize = useCallback((place: number) => {
    const cur = getFinance(season);
    update(season, { prizes: cur.prizes.filter(p => p.place !== place) });
  }, [getFinance, season, update]);

  return (
    <div className="space-y-3">
      <SectionLabel action={
        <button onClick={addPrize}
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#d4af37] hover:opacity-80 transition-opacity"
          data-testid={`button-add-prize-${leagueId}-${season}`}>
          <Plus className="w-3 h-3" /> Add Place
        </button>
      }>Payouts for {season}{seasonSuffix(kind) ? ` · ${seasonSuffix(kind)}` : ""}</SectionLabel>

      {f.prizes.length === 0 ? (
        <button onClick={addPrize}
          className="w-full text-left text-xs text-muted-foreground italic leading-relaxed rounded-lg border border-dashed border-border/50 px-3 py-4 hover:border-border hover:text-foreground transition-colors"
          data-testid={`prize-empty-${leagueId}-${season}`}>
          No payout structure for {season}. <span className="text-[#d4af37] not-italic font-semibold">+ Add a place</span>,
          side pot, or empire/rollover pool.
        </button>
      ) : (
        <div className="space-y-1.5">
          {[...f.prizes].sort((a, b) => a.place - b.place).map(prize => (
            <div key={prize.place}
              className={`flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-md border ${prize.paid ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/30 bg-muted/20"}`}
              data-testid={`prize-row-${leagueId}-${season}-${prize.place}`}>
              <Input className="h-8 text-sm w-28 flex-shrink-0" value={prize.label ?? ordinal(prize.place)} placeholder="Place / label"
                onChange={e => updatePrize(prize.place, { label: e.target.value })}
                data-testid={`input-prize-label-${leagueId}-${season}-${prize.place}`} />
              <div className="relative w-24 flex-shrink-0">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input type="number" min="0" className="pl-6 h-8 text-sm" value={prize.amount || ""} placeholder="0"
                  onChange={e => updatePrize(prize.place, { amount: parseFloat(e.target.value) || 0 })}
                  data-testid={`input-prize-${leagueId}-${season}-${prize.place}`} />
              </div>
              <DebouncedInput key={`prize-note-${leagueId}-${season}-${prize.place}`} type="text" placeholder="Rolls over / side pot note"
                className="h-8 text-xs flex-1 min-w-[120px]" value={prize.notes ?? ""}
                onCommit={v => updatePrize(prize.place, { notes: v })}
                data-testid={`input-prize-note-${leagueId}-${season}-${prize.place}`} />
              <button onClick={() => updatePrize(prize.place, { paid: !prize.paid })}
                className={`flex items-center gap-1 px-2 h-8 rounded-md text-[11px] font-medium border transition-colors flex-shrink-0 ${prize.paid ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : "border-border/40 text-muted-foreground hover:text-foreground"}`}
                data-testid={`button-prize-paid-${leagueId}-${season}-${prize.place}`}>
                <CheckCircle2 className="w-3 h-3" />{prize.paid ? "Paid out" : "Mark paid"}
              </button>
              <button onClick={() => removePrize(prize.place)}
                className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0 p-1"
                data-testid={`button-remove-prize-${leagueId}-${season}-${prize.place}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className={`mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg border text-xs ${metrics.reconIssue ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/20 border-border/30"}`}>
            <Stat label="Pool" value={fmtDollar(metrics.prizePool)} />
            <span className="text-border/60">|</span>
            <Stat label="Collected" value={fmtDollar(metrics.collected)} />
            <span className="text-border/60">|</span>
            <Stat label="Pending payout" value={fmtDollar(metrics.payoutsPending)}
              valueCls={metrics.payoutsPending > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"} />
            {metrics.reconIssue && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Pool exceeds collected dues
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Expanded-row editor ─────────────────────────────────────────────────────────

interface FinanceLeagueEditorProps {
  leagueId: string;
  currentSeason: string;
  /** Detected real prior seasons of this league. */
  priorSeasons: string[];
  isDynasty: boolean;
  finance: LeagueFinanceData;          // current-season finance (for free/hide toggles)
  managers: ManagerInfo[] | undefined;
  managersLoading: boolean;
  getFinance: (season: string) => LeagueFinanceData;
  update: (season: string, patch: Partial<LeagueFinanceData>) => void;
  pickRisk: PickRiskMap;
}

const SUBVIEWS: { key: SubviewKey; label: string; icon: typeof Wallet; dynastyOnly?: boolean }[] = [
  { key: "current",    label: "Current Season",    icon: Wallet },
  { key: "future",     label: "Future Dues",       icon: CalendarClock, dynastyOnly: true },
  { key: "ledger",     label: "Manager Ledger",    icon: Users,        dynastyOnly: true },
  { key: "leaguesafe", label: "LeagueSafe History", icon: History,     dynastyOnly: true },
  { key: "payouts",    label: "Payouts",           icon: TrophyIcon },
];

function FinanceLeagueEditor({
  leagueId, currentSeason, priorSeasons, isDynasty, finance, managers, managersLoading, getFinance, update, pickRisk,
}: FinanceLeagueEditorProps) {
  const [subview, setSubview] = useState<SubviewKey>("current");
  const [selectedSeason, setSelectedSeason] = useState(currentSeason);
  const seasons = seasonsFor(currentSeason, priorSeasons);
  const f = finance;

  // Season selector applies to the season-scoped views (Current Season, Payouts).
  const seasonScoped = subview === "current" || subview === "payouts";
  const subviews = SUBVIEWS.filter(s => isDynasty || !s.dynastyOnly);

  const common: SubviewCommon = {
    leagueId, currentSeason, priorSeasons, managers, managersLoading, getFinance, update, pickRisk,
  };

  return (
    <div className="border-t border-border/30 bg-muted/10 p-4 md:p-5 space-y-4">
      {isDynasty && <MultiYearSummaryBar currentSeason={currentSeason} priorSeasons={priorSeasons} getFinance={getFinance} managers={managers} pickRisk={pickRisk} />}

      {/* Subview pills + season selector */}
      {isDynasty && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 p-0.5 rounded-lg bg-muted/40 border border-border/30">
            {subviews.map(sv => {
              const active = subview === sv.key;
              const Icon = sv.icon;
              return (
                <button key={sv.key} onClick={() => setSubview(sv.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={`subview-${leagueId}-${sv.key}`}>
                  <Icon className="w-3 h-3" />{sv.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          {seasonScoped && (
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
              <div className="flex flex-wrap gap-1">
                {seasons.map(s => {
                  const kind = seasonKind(s, currentSeason);
                  const active = selectedSeason === s;
                  return (
                    <button key={s} onClick={() => setSelectedSeason(s)}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold tabular-nums border transition-colors ${active
                        ? "border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37]"
                        : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"}`}
                      data-testid={`season-pill-${leagueId}-${s}`}>
                      {s}{kind === "current" ? " ·now" : kind === "future" ? " ·fut" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subview content */}
      {subview === "current" && <CurrentSeasonView {...common} season={isDynasty ? selectedSeason : currentSeason} allowClone={isDynasty} />}
      {subview === "future" && <FutureDuesView {...common} />}
      {subview === "ledger" && <ManagerLedgerView {...common} />}
      {subview === "leaguesafe" && <LeagueSafeHistoryView {...common} />}
      {subview === "payouts" && <PayoutsView {...common} season={isDynasty ? selectedSeason : currentSeason} />}

      {/* Secondary actions — operate on the current season row */}
      <div className="flex flex-wrap justify-end gap-1.5 pt-1 border-t border-border/20">
        <button
          onClick={() => update(currentSeason, { isFree: !f.isFree, buyIn: !f.isFree ? 0 : f.buyIn, prizes: !f.isFree ? [] : f.prizes, payments: !f.isFree ? [] : f.payments })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${f.isFree ? "bg-slate-500/10 text-slate-500 dark:text-slate-400 hover:bg-slate-500/15" : "text-muted-foreground hover:bg-muted/50 hover:text-slate-500 dark:hover:text-slate-400"}`}
          data-testid={`button-toggle-free-${leagueId}`}>
          <Tag className="w-3 h-3" />{f.isFree ? "Free League ✓" : "Mark as Free League"}
        </button>
        <button
          onClick={() => update(currentSeason, { ignored: !f.ignored })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${f.ignored ? "bg-muted text-muted-foreground hover:bg-muted/70" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
          data-testid={`button-toggle-ignore-${leagueId}`}>
          {f.ignored ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {f.ignored ? "Unhide from Summary" : "Hide from Summary"}
        </button>
      </div>
    </div>
  );
}

// ─── Global summary card ─────────────────────────────────────────────────────────

const LEAGUE_TYPE_LABEL: Record<string, string> = {
  dynasty: "Dynasty",
  keeper: "Keeper",
  redraft: "Redraft",
};

const SUMMARY_ACCENT: Record<string, string> = {
  slate:   "bg-slate-500/10 text-slate-500 dark-any:text-slate-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark-any:text-emerald-400",
  amber:   "bg-amber-500/10 text-amber-600 dark-any:text-amber-400",
  red:     "bg-red-500/10 text-red-600 dark-any:text-red-400",
  blue:    "bg-blue-500/10 text-blue-600 dark-any:text-blue-400",
  gold:    "bg-[#d4af37]/10 text-[var(--sc-gold-deep)] dark-any:text-[#d4af37]",
};

function SummaryCard({ icon: Icon, label, value, sub, accent = "slate", testId }: {
  icon: typeof Wallet; label: string; value: string; sub?: string;
  accent?: keyof typeof SUMMARY_ACCENT; testId?: string;
}) {
  return (
    <Card className="p-4 flex items-start gap-3 min-w-0" data-testid={testId}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${SUMMARY_ACCENT[accent]}`}>
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

// ─── Main League Treasury Tab ────────────────────────────────────────────────────

export function FinanceTab({ scopeLeagueId }: { scopeLeagueId?: string } = {}) {
  const { isConnected, user, leagues } = useSleeper();
  const [token, setToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [finances, setFinances] = useState<Record<string, LeagueFinanceData>>({});  // keyed by financeKey(leagueId, season)
  const [expanded, setExpanded] = useState<string | null>(scopeLeagueId ?? null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loadingFinances, setLoadingFinances] = useState(false);
  const [managers, setManagers] = useState<Record<string, ManagerInfo[]>>({});
  const [managersLoading, setManagersLoading] = useState<Record<string, boolean>>({});
  const [tradesByLeague, setTradesByLeague] = useState<Record<string, TradeRow[]>>({});
  // Detected real prior seasons per league (from Sleeper's previous_league_id chain).
  const [priorSeasonsByLeague, setPriorSeasonsByLeague] = useState<Record<string, string[]>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const managedLeagues = leagues
    .filter(l => l.status !== "archived")
    .filter(l => !scopeLeagueId || l.leagueId === scopeLeagueId);

  const currentSeasonOf = useCallback((leagueId: string) =>
    managedLeagues.find(l => l.leagueId === leagueId)?.season ?? String(new Date().getFullYear()),
    [managedLeagues]);

  const isDynastyLeague = useCallback((leagueId: string) => {
    const t = managedLeagues.find(l => l.leagueId === leagueId)?.leagueType;
    return t === "dynasty" || t === "keeper";
  }, [managedLeagues]);

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

  // Load persisted finance rows (all seasons). Legacy rows lack the dynasty
  // columns and default cleanly.
  useEffect(() => {
    if (!isConnected || !user?.userId || !token) return;
    setLoadingFinances(true);
    fetch(`${API_BASE}/api/finances/${user.userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { handleLock(); return null; } return r.json(); })
      .then((rows: any[] | null) => {
        if (!rows) return;
        const map: Record<string, LeagueFinanceData> = {};
        for (const row of rows) {
          const season = row.season ?? "2026";
          map[financeKey(row.leagueId, season)] = {
            leagueId: row.leagueId,
            season,
            buyIn: row.buyIn ?? 0,
            prizes: Array.isArray(row.prizes) ? row.prizes as PrizeSlot[] : [],
            payments: Array.isArray(row.payments) ? row.payments as ManagerPayment[] : [],
            notes: row.notes ?? "",
            isFree: row.isFree ?? false,
            ignored: row.ignored ?? false,
            leagueSafeUrl: row.leagueSafeUrl ?? "",
            leagueSafeStatus: (row.leagueSafeStatus as LeagueSafeStatus) ?? (row.leagueSafeUrl ? "active" : "not_created"),
            dueDate: row.dueDate ?? "",
            paymentRule: row.paymentRule ?? "",
          };
        }
        setFinances(map);
      })
      .catch(() => {})
      .finally(() => setLoadingFinances(false));
  }, [isConnected, user?.userId, token]);

  const getFinance = useCallback((leagueId: string, season: string): LeagueFinanceData =>
    finances[financeKey(leagueId, season)] ?? defaultFinance(leagueId, season), [finances]);

  const saveFinance = useCallback((leagueId: string, season: string, data: LeagueFinanceData) => {
    if (!user?.userId || !token) return;
    const key = financeKey(leagueId, season);
    clearTimeout(saveTimers.current[key]);
    setSaved(prev => ({ ...prev, [leagueId]: false }));
    saveTimers.current[key] = setTimeout(async () => {
      setSaving(prev => ({ ...prev, [leagueId]: true }));
      try {
        const r = await fetch(`${API_BASE}/api/finances`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            sleeperUserId: user.userId, leagueId, season,
            buyIn: data.buyIn, prizes: data.prizes, payments: data.payments, notes: data.notes,
            isFree: data.isFree, ignored: data.ignored, leagueSafeUrl: data.leagueSafeUrl || null,
            leagueSafeStatus: data.leagueSafeStatus, dueDate: data.dueDate || null, paymentRule: data.paymentRule || null,
          }),
        });
        if (r.status === 401) { handleLock(); return; }
        setSaved(prev => ({ ...prev, [leagueId]: true }));
        setTimeout(() => setSaved(prev => ({ ...prev, [leagueId]: false })), 2000);
      } catch {}
      setSaving(prev => ({ ...prev, [leagueId]: false }));
    }, 800);
  }, [user?.userId, token, authHeaders]);

  const updateFinance = useCallback((leagueId: string, season: string, patch: Partial<LeagueFinanceData>) => {
    setFinances(prev => {
      const key = financeKey(leagueId, season);
      const current = prev[key] ?? defaultFinance(leagueId, season);
      const updated = { ...current, ...patch };
      saveFinance(leagueId, season, updated);
      return { ...prev, [key]: updated };
    });
  }, [saveFinance]);

  // Lazily fetch managers when a league is first expanded.
  const ensureManagers = useCallback((leagueId: string) => {
    if (managers[leagueId] || managersLoading[leagueId]) return;
    setManagersLoading(prev => ({ ...prev, [leagueId]: true }));
    fetchLeagueManagers(leagueId)
      .then(list => setManagers(prev => ({ ...prev, [leagueId]: list })))
      .catch(() => setManagers(prev => ({ ...prev, [leagueId]: [] })))
      .finally(() => setManagersLoading(prev => ({ ...prev, [leagueId]: false })));
  }, [managers, managersLoading]);

  // Lazily fetch the trade feed (dynasty/keeper only) to detect future-pick risk.
  const ensureTrades = useCallback((leagueId: string) => {
    if (tradesByLeague[leagueId] || !isDynastyLeague(leagueId)) return;
    fetchTradeFeed(leagueId)
      .then(res => setTradesByLeague(prev => ({ ...prev, [leagueId]: res.trades ?? [] })))
      .catch(() => setTradesByLeague(prev => ({ ...prev, [leagueId]: [] })));
  }, [tradesByLeague, isDynastyLeague]);

  // Detect the league's real prior seasons by walking Sleeper's previous_league_id
  // chain, so only seasons that actually existed are offered to fill in.
  const ensurePriorSeasons = useCallback((leagueId: string) => {
    if (priorSeasonsByLeague[leagueId]) return;
    fetchPriorLeagueSeasons(leagueId)
      .then(refs => setPriorSeasonsByLeague(prev => ({ ...prev, [leagueId]: refs.map(r => r.season) })))
      .catch(() => setPriorSeasonsByLeague(prev => ({ ...prev, [leagueId]: [] })));
  }, [priorSeasonsByLeague]);

  const toggleExpand = useCallback((leagueId: string) => {
    setExpanded(prev => {
      const next = prev === leagueId ? null : leagueId;
      if (next) { ensureManagers(next); ensureTrades(next); ensurePriorSeasons(next); }
      return next;
    });
  }, [ensureManagers, ensureTrades, ensurePriorSeasons]);

  // Load lazy data for whichever league is expanded — covers the initially-
  // expanded league when scoped to one (e.g. League Profile), where toggleExpand
  // never fires. The ensure* helpers are idempotent.
  useEffect(() => {
    if (!expanded) return;
    ensureManagers(expanded);
    ensureTrades(expanded);
    ensurePriorSeasons(expanded);
  }, [expanded, ensureManagers, ensureTrades, ensurePriorSeasons]);

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

  // ── Derived state across visible leagues (current season) ────────────────────
  const curFinance = (l: typeof managedLeagues[number]) => getFinance(l.leagueId, currentSeasonOf(l.leagueId));
  const visibleLeagues = managedLeagues.filter(l => !curFinance(l).ignored);
  const hiddenLeagues = managedLeagues.filter(l => curFinance(l).ignored);

  const metricsByLeague: Record<string, LeagueMetrics> = {};
  managedLeagues.forEach(l => { metricsByLeague[l.leagueId] = computeMetrics(curFinance(l), teamsOf(l.leagueId)); });

  const totals = visibleLeagues.reduce((acc, l) => {
    const f = curFinance(l);
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

  const stillLoadingTeams = managedLeagues.some(l => teamsOf(l.leagueId) === 0);

  const COL = "grid-cols-[minmax(200px,1.8fr)_64px_60px_84px_72px_100px]";

  function renderLeagueRow(league: typeof managedLeagues[number]) {
    const cs = currentSeasonOf(league.leagueId);
    const f = getFinance(league.leagueId, cs);
    const m = metricsByLeague[league.leagueId];
    const status = leagueStatus(f, m);
    const isExpanded = expanded === league.leagueId;
    const hasSafe = !!f.leagueSafeUrl?.trim();
    const dynasty = isDynastyLeague(league.leagueId);

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
                  <span className="text-muted-foreground">Pool <span className="font-semibold text-foreground">{fmtDollar(m.prizePool)}</span></span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 mt-2">
                <div className="flex items-center gap-1.5">
                  <StatusPill status={status} />
                  {dynasty && <span className="text-[9px] font-bold uppercase tracking-wide text-[#d4af37]">Multi-year</span>}
                </div>
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
            <div className="min-w-0">
              <p className="font-semibold text-xs truncate leading-tight">{league.name}</p>
              <p className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                {league.totalRosters}-team{league.leagueType ? ` · ${LEAGUE_TYPE_LABEL[league.leagueType]}` : ""}
              </p>
            </div>
          </div>
          {/* Buy-In */}
          <div className="flex justify-end">
            {f.isFree ? <span className="text-[10px] text-slate-500 font-semibold">Free</span>
              : f.buyIn > 0 ? <span className="text-xs font-medium">{fmtDollar(f.buyIn)}</span>
              : <NotConfigured testId={`row-buyin-missing-${league.leagueId}`} />}
          </div>
          {/* Paid */}
          <span className="text-xs font-medium text-center tabular-nums">{f.isFree ? "—" : `${m.paidCount}/${m.teams}`}</span>
          {/* Prize Pool */}
          <div className="flex justify-end">
            {m.prizePool > 0 ? <span className="text-xs font-medium">{fmtDollar(m.prizePool)}</span>
              : f.isFree ? <span className="text-[10px] text-muted-foreground">—</span>
              : <NotConfigured testId={`row-prizepool-missing-${league.leagueId}`} />}
          </div>
          {/* LeagueSafe */}
          <div className="flex justify-center">
            {f.isFree ? <span className="text-[10px] text-muted-foreground">—</span>
              : hasSafe ? (
                <a href={f.leagueSafeUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-emerald-500 hover:opacity-70 transition-opacity"
                  onClick={e => e.stopPropagation()}
                  title="LeagueSafe configured — open link"
                  data-testid={`row-leaguesafe-${league.leagueId}`}>
                  <Check className="w-3.5 h-3.5" />
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ) : <NotConfigured testId={`row-leaguesafe-missing-${league.leagueId}`} />}
          </div>
          {/* Actions */}
          <div className="flex justify-end items-center gap-1.5">
            {saving[league.leagueId] && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {saved[league.leagueId] && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
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
            currentSeason={cs}
            priorSeasons={priorSeasonsByLeague[league.leagueId] ?? []}
            isDynasty={dynasty}
            finance={f}
            managers={managers[league.leagueId]}
            managersLoading={!!managersLoading[league.leagueId]}
            getFinance={(season) => getFinance(league.leagueId, season)}
            update={(season, patch) => updateFinance(league.leagueId, season, patch)}
            pickRisk={buildPickRisk(tradesByLeague[league.leagueId] ?? [], cs)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title="League Treasury" subtitle="Track dues, prize pools, LeagueSafe links, and payout readiness across your leagues. Dynasty leagues get multi-year dues, future-pick risk, and LeagueSafe history." />

      {/* Summary cards (current season) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 md:gap-3">
        <SummaryCard icon={Wallet}   label="Total League Dues" value={fmtDollar(totals.dues)} accent="blue" testId="card-total-dues" />
        <SummaryCard icon={Receipt}  label="Collected"   value={fmtDollar(totals.collected)} accent="emerald" testId="card-collected" />
        <SummaryCard icon={Receipt}  label="Outstanding" value={fmtDollar(outstanding)} accent={outstanding > 0 ? "amber" : "slate"} testId="card-outstanding" />
        <SummaryCard icon={TrophyIcon} label="Prize Pool" value={fmtDollar(totals.prizePool)} accent="gold" testId="card-prize-pool" />
        <SummaryCard icon={Banknote} label="Payouts Pending" value={fmtDollar(totals.payoutsPending)} sub={totals.payoutLeagues > 0 ? `${totals.payoutLeagues} league${totals.payoutLeagues > 1 ? "s" : ""}` : undefined} accent={totals.payoutsPending > 0 ? "amber" : "slate"} testId="card-payouts-pending" />
        <SummaryCard icon={AlertCircle} label="Issues" value={String(totals.issueLeagues)} sub={totals.issueLeagues === 1 ? "league" : "leagues"} accent={totals.issueLeagues > 0 ? "red" : "emerald"} testId="card-issues" />
      </div>

      {visibleLeagues.length === 0 && !stillLoadingTeams && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground text-sm">No leagues found for your account.</p>
        </Card>
      )}

      {/* League table */}
      {visibleLeagues.length > 0 && (
        <Card className="overflow-hidden">
          <div className="md:overflow-x-auto">
            <div className="md:min-w-[920px]">
              <div className={`hidden md:grid ${COL} gap-x-2 px-4 py-2.5 border-b border-border/50 bg-muted/30 items-center`}>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">League</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-right">Buy-In</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-center">Paid</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-right">Prize Pool</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-center">LeagueSafe</span>
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
            const cs = currentSeasonOf(league.leagueId);
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
                    <button onClick={() => updateFinance(league.leagueId, cs, { ignored: false })}
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
