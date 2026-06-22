/**
 * Trade Review Center — Commissioner decision-support surface.
 *
 * Phase 1: automatically detect trades from the connected Sleeper league, store
 * them server-side, normalize the assets, score value + risk, raise neutral
 * review flags, and give the commissioner a clean review interface. This screen
 * NEVER approves, rejects, reverses, or sends trades — it surfaces evidence and
 * lets the commissioner record decisions + notes.
 *
 * Six sections (inner tabs):
 *   Trade Feed · Review Queue · Trade Details · Manager History · Analytics · Settings
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeader } from "@/components/SectionHeader";
import { useToast } from "@/hooks/use-toast";
import { useSleeper } from "@/contexts/SleeperContext";
import { cn } from "@/lib/utils";
import type { League } from "@/types";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  ArrowLeftRight,
  Copy,
  Check,
  Eye,
  ShieldAlert,
  ScrollText,
  Users,
  BarChart3,
  Settings as SettingsIcon,
  ClipboardList,
  Flag,
} from "lucide-react";
import {
  ingestTrades,
  fetchTradeFeed,
  fetchTrade,
  updateReview,
  fetchManagerHistory,
  fetchAnalytics,
  type TradeRow,
  type TradeAsset,
  type TradeFlag,
  type TradeReview,
  type ReviewStatus,
  type RiskLabel,
  type Severity,
  type ManagerHistory,
  type LeagueAnalytics,
} from "@/lib/commissionerTradesApi";

// ── Local commissioner settings (Phase 1: persisted client-side) ──────────────
interface TradeReviewSettings {
  lopsidedThresholdPct: number;
  highRiskThresholdPct: number;
  repeatPartnerThreshold: number;
  autoQueueFutureFirsts: boolean;
  requireFutureDuesForFuturePickTrades: boolean;
  showValueInPublicSummary: boolean;
  valueSource: string;
}
const DEFAULT_SETTINGS: TradeReviewSettings = {
  lopsidedThresholdPct: 15,
  highRiskThresholdPct: 25,
  repeatPartnerThreshold: 3,
  autoQueueFutureFirsts: true,
  requireFutureDuesForFuturePickTrades: true,
  showValueInPublicSummary: true,
  valueSource: "default",
};
function settingsKey(leagueId: string) {
  return `dc-trade-review-settings-${leagueId}`;
}
function loadSettings(leagueId: string): TradeReviewSettings {
  try {
    const raw = localStorage.getItem(settingsKey(leagueId));
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

type SectionId = "feed" | "queue" | "details" | "manager" | "analytics" | "settings";

const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof Eye }> = [
  { id: "feed", label: "Trade Feed", icon: ScrollText },
  { id: "queue", label: "Review Queue", icon: ClipboardList },
  { id: "details", label: "Trade Details", icon: Eye },
  { id: "manager", label: "Manager History", icon: Users },
  { id: "analytics", label: "League Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

// ── Shared formatting helpers ─────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString() : "—";
}
function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}
function ordinal(round?: number | null): string {
  const r = Number(round);
  if (r === 1) return "1st";
  if (r === 2) return "2nd";
  if (r === 3) return "3rd";
  return `${r}th`;
}
function assetLabel(a: TradeAsset): string {
  if (a.assetType === "player") return a.playerName || a.playerId || "Unknown player";
  if (a.assetType === "pick") return `${a.pickSeason} ${ordinal(a.pickRound)}`;
  return `$${a.faabAmount ?? 0} FAAB`;
}

const RISK_STYLES: Record<RiskLabel, string> = {
  low: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30",
  high: "bg-orange-500/15 text-orange-600 dark-any:text-orange-400 border-orange-500/30",
  critical: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30",
};
const SEVERITY_STYLES: Record<Severity, string> = {
  info: "bg-sky-500/15 text-sky-600 dark-any:text-sky-400 border-sky-500/30",
  low: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30",
  high: "bg-orange-500/15 text-orange-600 dark-any:text-orange-400 border-orange-500/30",
  critical: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30",
};
const REVIEW_LABELS: Record<ReviewStatus, string> = {
  unreviewed: "Needs Review",
  reviewed: "Reviewed",
  watchlist: "Watchlist",
  disputed: "Disputed",
  no_action: "No Action",
};
const REVIEW_STYLES: Record<ReviewStatus, string> = {
  unreviewed: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30",
  reviewed: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30",
  watchlist: "bg-sky-500/15 text-sky-600 dark-any:text-sky-400 border-sky-500/30",
  disputed: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30",
  no_action: "bg-muted text-muted-foreground border-border",
};

function RiskChip({ label, score }: { label: RiskLabel; score: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold capitalize", RISK_STYLES[label])}>
      {label} · {score}
    </span>
  );
}
function ReviewChip({ status }: { status: ReviewStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", REVIEW_STYLES[status])}>
      {REVIEW_LABELS[status]}
    </span>
  );
}

// ── Commissioner-facing trade status ──────────────────────────────────────────
// A single "what should I do?" verdict derived from review state + risk + flags.
// Fair → nothing to do; Review → worth a manual look; Flagged → potential
// integrity issue; Reviewed → commissioner already cleared it; Escalated →
// needs action/discussion.
type TradeStatus = "fair" | "review" | "flagged" | "reviewed" | "escalated";
const STATUS_META: Record<TradeStatus, { label: string; cls: string }> = {
  fair: { label: "Fair", cls: "bg-muted text-muted-foreground border-border" },
  review: { label: "Review", cls: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30" },
  flagged: { label: "Flagged", cls: "bg-orange-500/15 text-orange-600 dark-any:text-orange-400 border-orange-500/30" },
  reviewed: { label: "Reviewed", cls: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30" },
  escalated: { label: "Escalated", cls: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30" },
};
function tradeStatus(t: TradeRow): TradeStatus {
  if (t.reviewStatus === "disputed") return "escalated";
  if (t.reviewStatus === "reviewed" || t.reviewStatus === "no_action") return "reviewed";
  if (t.reviewStatus === "watchlist") return "flagged";
  // Unreviewed: lean on risk + flag severity to suggest the next action.
  if (t.flags.some((f) => f.severity === "high" || f.severity === "critical")) return "flagged";
  if (t.riskLabel === "high" || t.riskLabel === "critical" || t.flags.length > 0) return "review";
  return "fair";
}
function StatusChip({ status }: { status: TradeStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", m.cls)} data-testid={`chip-status-${status}`}>
      {m.label}
    </span>
  );
}

// Risk as a commissioner-readable label ("Low Risk") — no raw score in the feed.
function riskText(label: RiskLabel): string {
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} Risk`;
}

// Short, scannable flag labels for the collapsed "Flags:" row.
const FLAG_SHORT: Record<string, string> = {
  lopsided: "Lopsided",
  future_pick: "Future pick moved",
  premium_pick: "Premium future asset",
  repeat_partner: "Repeat partners",
  orphan_risk: "Orphan risk",
  league_balance: "League balance",
  direction_mismatch: "Direction mismatch",
};
function flagShort(f: TradeFlag): string {
  return FLAG_SHORT[f.flagType] ?? f.title;
}

// Left severity accent rail — only high-risk trades carry a strong color so the
// feed stays calm and the dangerous trades pop.
const RISK_BAR: Record<RiskLabel, string> = {
  low: "bg-emerald-500/40",
  medium: "bg-amber-500/70",
  high: "bg-orange-500",
  critical: "bg-red-500",
};
// Risk badge (leading visual signal): restrained tint, label like "Critical Risk".
function RiskBadge({ label }: { label: RiskLabel }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        RISK_STYLES[label],
      )}
      data-testid={`badge-risk-${label}`}
    >
      {riskText(label)}
    </span>
  );
}

// CTA copy follows the trade's status: act vs. just look back at the decision.
function ctaLabel(status: TradeStatus): string {
  if (status === "reviewed") return "View Review →";
  if (status === "flagged" || status === "escalated") return "Review Trade →";
  if (status === "review") return "Review →";
  return "View →";
}

// "Why flagged" chips — the meaningful (non-info) flags, restated as quiet,
// scannable signals. Muted by default so they inform without shouting.
function SignalChips({ flags }: { flags: TradeFlag[] }) {
  const meaningful = flags.filter((f) => f.severity !== "info");
  if (meaningful.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Flag className="h-3 w-3" /> Why flagged:
      </span>
      {meaningful.map((f, i) => (
        <span
          key={i}
          className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
          title={f.description}
        >
          {flagShort(f)}
        </span>
      ))}
    </div>
  );
}

// One "<Team> receives → assets" block. Both sides of a 2-team trade get one;
// multi-team trades stack one per roster.
function ReceivesBlock({
  name,
  assets,
}: {
  name: string;
  assets: TradeAsset[];
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {name} receives
      </div>
      <div className="mt-0.5 text-sm leading-snug text-foreground/90">
        {assets.length === 0 ? "—" : assets.map(assetLabel).join(" · ")}
      </div>
    </div>
  );
}

// Sort lenses — a commissioner shouldn't hunt through cleared low-risk trades.
type SortKey = "priority" | "risk" | "gap" | "recent";
const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "priority", label: "Needs attention first" },
  { value: "risk", label: "Highest risk" },
  { value: "gap", label: "Largest gap" },
  { value: "recent", label: "Most recent" },
];
const RISK_RANK: Record<RiskLabel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const STATUS_PRIORITY: Record<TradeStatus, number> = {
  escalated: 4,
  flagged: 3,
  review: 2,
  fair: 1,
  reviewed: 0,
};
function tradeTs(t: TradeRow): number {
  return t.statusUpdatedTs ?? t.createdTs ?? 0;
}
function sortTrades(list: TradeRow[], key: SortKey): TradeRow[] {
  const arr = [...list];
  switch (key) {
    case "risk":
      return arr.sort((a, b) => RISK_RANK[b.riskLabel] - RISK_RANK[a.riskLabel] || b.valueDiffPct - a.valueDiffPct);
    case "gap":
      return arr.sort((a, b) => b.valueDiffPct - a.valueDiffPct);
    case "recent":
      return arr.sort((a, b) => tradeTs(b) - tradeTs(a));
    case "priority":
    default:
      return arr.sort(
        (a, b) =>
          STATUS_PRIORITY[tradeStatus(b)] - STATUS_PRIORITY[tradeStatus(a)] ||
          RISK_RANK[b.riskLabel] - RISK_RANK[a.riskLabel] ||
          tradeTs(b) - tradeTs(a),
      );
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export function TradeReviewCenter({ league }: { league: League }) {
  const leagueId = league.id;
  const { toast } = useToast();
  const sleeper = useSleeper();

  // The Trade Feed aggregates every league the user commissions; the loaded
  // league is always included even if the context list hasn't resolved yet.
  const commishLeagueIds = useMemo(() => {
    const ids = new Set<string>([leagueId]);
    for (const lg of sleeper.leagues) ids.add(lg.leagueId);
    return Array.from(ids);
  }, [leagueId, sleeper.leagues]);
  const [section, setSection] = useState<SectionId>("feed");
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);
  const [selectedManagerRoster, setSelectedManagerRoster] = useState<number | null>(null);
  const [settings, setSettings] = useState<TradeReviewSettings>(() => loadSettings(leagueId));

  // Map roster id → team name from the loaded league (ids look like "roster_N").
  const rosterNames = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of league.teams) {
      const rid = Number(String(t.id).replace(/^roster_/, ""));
      if (Number.isFinite(rid)) m.set(rid, t.name || t.owner || `Team ${rid}`);
    }
    return m;
  }, [league.teams]);
  const teamName = useCallback((rid: number) => rosterNames.get(rid) ?? `Team ${rid}`, [rosterNames]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTradeFeed(commishLeagueIds);
      setTrades(data.trades);
    } catch (e: any) {
      setError(e?.message || "Failed to load trades");
    } finally {
      setLoading(false);
    }
  }, [commishLeagueIds]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Scan every commissioned league so the feed stays complete. Failures on
      // an individual league are tolerated — we still surface the rest.
      const results = await Promise.allSettled(
        commishLeagueIds.map((id) => ingestTrades(id, { forceRefresh: false })),
      );
      let newTrades = 0;
      let scanned = 0;
      let failures = 0;
      for (const r of results) {
        if (r.status === "fulfilled") {
          newTrades += r.value.newTrades;
          scanned += r.value.tradesFound;
        } else {
          failures++;
        }
      }
      toast({
        title: "Trade scan complete",
        description:
          `${newTrades} new ${newTrades === 1 ? "trade" : "trades"} found across ` +
          `${commishLeagueIds.length} ${commishLeagueIds.length === 1 ? "league" : "leagues"} (${scanned} scanned).` +
          (failures > 0 ? ` ${failures} league(s) could not be scanned.` : ""),
      });
      await loadFeed();
    } catch (e: any) {
      toast({ title: "Scan failed", description: e?.message || "Could not refresh trades", variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  }, [commishLeagueIds, loadFeed, toast]);

  const openTrade = useCallback((id: number) => {
    setSelectedTradeId(id);
    setSection("details");
  }, []);
  const openManager = useCallback((rid: number) => {
    setSelectedManagerRoster(rid);
    setSection("manager");
  }, []);

  const onReviewUpdated = useCallback((id: number, status: ReviewStatus) => {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, reviewStatus: status } : t)));
  }, []);

  const queueTrades = useMemo(
    () => trades.filter((t) => t.reviewStatus === "unreviewed" || t.reviewStatus === "watchlist" || t.reviewStatus === "disputed"),
    [trades],
  );

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <SectionHeader
          title="Trade Review Center"
          subtitle="Automatic trade tracking across every league you commission. Decision-support only — nothing here approves, rejects, or reverses trades."
        />
        <Button onClick={handleRefresh} disabled={refreshing} className="shrink-0" data-testid="button-refresh-trades">
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh Trades
        </Button>
      </div>

      {/* Section nav */}
      <div className="mt-2 mb-5 flex flex-wrap gap-2 border-b border-border pb-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const count = s.id === "queue" ? queueTrades.length : undefined;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              data-testid={`tab-trade-review-${s.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                section === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4" />
              {s.label}
              {count != null && count > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-600 dark-any:text-amber-400">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <Card className="mb-4 flex items-center gap-2 border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark-any:text-red-400">
          <AlertTriangle className="h-4 w-4" /> {error}
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading trades…
        </div>
      ) : (
        <>
          {section === "feed" && (
            <TradeFeed trades={trades} teamName={teamName} onOpen={openTrade} onRefresh={handleRefresh} refreshing={refreshing} />
          )}
          {section === "queue" && (
            <ReviewQueue
              trades={queueTrades}
              teamName={teamName}
              onOpen={openTrade}
              onReviewUpdated={onReviewUpdated}
            />
          )}
          {section === "details" && (
            <TradeDetails
              tradeId={selectedTradeId}
              teamName={teamName}
              showValue={settings.showValueInPublicSummary}
              onReviewUpdated={onReviewUpdated}
              onBack={() => setSection("feed")}
            />
          )}
          {section === "manager" && (
            <ManagerHistoryView
              leagueId={leagueId}
              rosterId={selectedManagerRoster}
              rosterNames={rosterNames}
              teamName={teamName}
              onPickRoster={setSelectedManagerRoster}
              onOpen={openTrade}
            />
          )}
          {section === "analytics" && (
            <AnalyticsView leagueId={leagueId} teamName={teamName} onOpenManager={openManager} />
          )}
          {section === "settings" && (
            <SettingsView
              settings={settings}
              onSave={(s) => {
                setSettings(s);
                try {
                  localStorage.setItem(settingsKey(leagueId), JSON.stringify(s));
                } catch {}
                toast({ title: "Settings saved", description: "Trade review thresholds updated for this league." });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Trade Feed ────────────────────────────────────────────────────────────────
// Prefer the trade's own roster→name map (resolved server-side, works across
// every league) and fall back to the loaded league's map for older rows.
function rosterLabel(t: TradeRow, rid: number, fallback: (r: number) => string): string {
  return t.rosterNames?.[rid] ?? fallback(rid);
}
function tradeTeams(t: TradeRow, fallback: (r: number) => string): string {
  return t.rosterIds.map((rid) => rosterLabel(t, rid, fallback)).join(" ↔ ");
}
function receivedBy(t: TradeRow, rosterId: number): TradeAsset[] {
  return t.assets.filter((a) => a.toRosterId === rosterId);
}

function TradeFeed({
  trades,
  teamName,
  onOpen,
  onRefresh,
  refreshing,
}: {
  trades: TradeRow[];
  teamName: (r: number) => string;
  onOpen: (id: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("priority");

  // Distinct leagues present in the feed, for the league filter dropdown.
  const leagueOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of trades) {
      if (!seen.has(t.leagueId)) seen.set(t.leagueId, t.leagueName || `League ${t.leagueId}`);
    }
    return [
      { value: "all", label: "All leagues" },
      ...Array.from(seen, ([value, label]) => ({ value, label })),
    ];
  }, [trades]);
  const multiLeague = leagueOptions.length > 2;

  const filtered = useMemo(
    () =>
      trades.filter(
        (t) =>
          matchesQuick(t, quickFilter) &&
          (statusFilter === "all" || t.reviewStatus === statusFilter) &&
          (riskFilter === "all" || t.riskLabel === riskFilter) &&
          (leagueFilter === "all" || t.leagueId === leagueFilter),
      ),
    [trades, quickFilter, statusFilter, riskFilter, leagueFilter],
  );
  const sorted = useMemo(() => sortTrades(filtered, sortKey), [filtered, sortKey]);

  if (trades.length === 0) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="No trades recorded yet"
        body="Click Refresh Trades to scan your commissioned leagues' Sleeper transactions for completed trades."
        action={
          <Button onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh Trades
          </Button>
        }
      />
    );
  }

  return (
    <div>
      {/* Quick filter pills — the fast "what needs me?" lens. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK_FILTERS.map((qf) => (
          <button
            key={qf.value}
            type="button"
            onClick={() => setQuickFilter(qf.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              quickFilter === qf.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-transparent text-muted-foreground hover:bg-muted/60",
            )}
            data-testid={`pill-quick-${qf.value}`}
          >
            {qf.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[
          { value: "all", label: "All statuses" },
          { value: "unreviewed", label: "Needs Review" },
          { value: "reviewed", label: "Reviewed" },
          { value: "watchlist", label: "Watchlist" },
          { value: "disputed", label: "Disputed" },
          { value: "no_action", label: "No Action" },
        ]} />
        <FilterSelect label="Risk Level" value={riskFilter} onChange={setRiskFilter} options={[
          { value: "all", label: "All risks" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "critical", label: "Critical" },
        ]} />
        {multiLeague && (
          <FilterSelect label="League" value={leagueFilter} onChange={setLeagueFilter} options={leagueOptions} />
        )}
        <div className="ml-auto">
          <FilterSelect label="Sort by" value={sortKey} onChange={(v) => setSortKey(v as SortKey)} options={SORT_OPTIONS} />
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No trades match the current filters.</p>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((t) => (
            <TradeCard
              key={t.id}
              trade={t}
              teamName={teamName}
              showLeague={multiLeague}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trade Card ────────────────────────────────────────────────────────────────
// Hybrid feed-card: a severity rail leads, parties + gap + status sit on the
// header line, each side's haul gets its own "receives" block, and the CTA
// adapts to whether the commissioner still needs to act. Scannable like a table
// row, readable like a card — and it stacks cleanly on mobile.
function TradeCard({
  trade: t,
  teamName,
  showLeague,
  onOpen,
}: {
  trade: TradeRow;
  teamName: (r: number) => string;
  showLeague: boolean;
  onOpen: (id: number) => void;
}) {
  const status = tradeStatus(t);
  const quietCta = status === "reviewed" || status === "fair";
  return (
    <Card
      className="group relative cursor-pointer overflow-hidden pl-3 transition-colors hover:bg-muted/30"
      onClick={() => onOpen(t.id)}
      data-testid={`card-trade-${t.id}`}
    >
      {/* Left severity accent rail */}
      <div className={cn("absolute inset-y-0 left-0 w-1", RISK_BAR[t.riskLabel])} aria-hidden />

      <div className="p-3 sm:p-4">
        {/* Header: risk badge + parties on the left; gap + status on the right. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <RiskBadge label={t.riskLabel} />
          <span className="min-w-0 truncate font-semibold">{tradeTeams(t, teamName)}</span>
          {t.isMultiTeam && <Badge variant="outline" className="text-[10px]">Multi</Badge>}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">
              Gap <span className="font-semibold tabular-nums text-foreground">{t.valueDiffPct}%</span>
            </span>
            <StatusChip status={status} />
          </span>
        </div>

        {/* Meta line */}
        <div className="mt-1 text-xs text-muted-foreground">
          {fmtDate(t.statusUpdatedTs ?? t.createdTs)}
          {t.week != null ? ` · Week ${t.week}` : ""}
          {showLeague && t.leagueName ? ` · ${t.leagueName}` : ""}
        </div>

        {/* Receives blocks — the core readability win. Two-up for 2-team trades. */}
        <div className={cn("mt-3 grid gap-2", t.rosterIds.length === 2 ? "sm:grid-cols-2" : "")}>
          {t.rosterIds.map((rid) => (
            <ReceivesBlock key={rid} name={rosterLabel(t, rid, teamName)} assets={receivedBy(t, rid)} />
          ))}
        </div>

        {/* Why-flagged signals + adaptive CTA */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <SignalChips flags={t.flags} />
          <Button
            size="sm"
            variant="ghost"
            className={cn("ml-auto h-7 px-2", quietCta ? "text-muted-foreground" : "text-primary")}
            onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
            data-testid={`button-review-trade-${t.id}`}
          >
            {ctaLabel(status)}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// Quick-filter pills: the fast "what needs me?" lens, ANDed with the dropdowns.
type QuickFilter = "all" | "needs-review" | "flagged" | "reviewed" | "high-risk" | "unreviewed";
const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs-review", label: "Needs Review" },
  { value: "flagged", label: "Flagged" },
  { value: "reviewed", label: "Reviewed" },
  { value: "high-risk", label: "High Risk" },
  { value: "unreviewed", label: "Unreviewed" },
];
function matchesQuick(t: TradeRow, q: QuickFilter): boolean {
  switch (q) {
    case "all": return true;
    case "needs-review": return tradeStatus(t) === "review";
    case "flagged": return tradeStatus(t) === "flagged" || tradeStatus(t) === "escalated";
    case "reviewed": return t.reviewStatus === "reviewed" || t.reviewStatus === "no_action";
    case "high-risk": return t.riskLabel === "high" || t.riskLabel === "critical";
    case "unreviewed": return t.reviewStatus === "unreviewed";
  }
}

// ── Review Queue ──────────────────────────────────────────────────────────────
function suggestedAction(t: TradeRow): string {
  if (t.flags.some((f) => f.flagType === "premium_pick" && f.severity === "critical")) {
    return "Review because this trade moves multiple future 1st-round picks.";
  }
  if (t.flags.some((f) => f.flagType === "future_pick")) {
    return "Verify future dues before documenting, if league rules require them.";
  }
  if (t.valueDiffPct >= 25) {
    return "Review the value gap and confirm both managers are directionally aligned.";
  }
  if (t.flags.some((f) => f.flagType === "repeat_partner")) {
    return "Note the frequent trade relationship for your records. Neutral context only.";
  }
  return "No action likely needed. Trade is within normal value range.";
}

function ReviewQueue({
  trades,
  teamName,
  onOpen,
  onReviewUpdated,
}: {
  trades: TradeRow[];
  teamName: (r: number) => string;
  onOpen: (id: number) => void;
  onReviewUpdated: (id: number, status: ReviewStatus) => void;
}) {
  if (trades.length === 0) {
    return <EmptyState icon={Check} title="Review queue is clear" body="No trades currently need attention. New high-risk trades will appear here automatically after a scan." />;
  }
  return (
    <div className="space-y-3">
      {trades.map((t) => (
        <Card key={t.id} className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{tradeTeams(t, teamName)}</span>
                {t.week != null && <span className="text-xs text-muted-foreground">Week {t.week}</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <RiskChip label={t.riskLabel} score={t.riskScore} />
                <span className="text-muted-foreground">Fairness {t.fairnessScore}/100</span>
                <span className="text-muted-foreground">· Gap {t.valueDiffPct}%</span>
              </div>
              {t.flags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.flags.map((f, i) => (
                    <span key={i} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs", SEVERITY_STYLES[f.severity])}>{f.title}</span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/50 p-2 text-sm">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span><span className="font-medium">Recommended:</span> {suggestedAction(t)}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <QuickReviewButtons tradeId={t.id} current={t.reviewStatus} onReviewUpdated={onReviewUpdated} />
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpen(t.id)}>Open details</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function QuickReviewButtons({
  tradeId,
  current,
  onReviewUpdated,
}: {
  tradeId: number;
  current: ReviewStatus;
  onReviewUpdated: (id: number, status: ReviewStatus) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<ReviewStatus | null>(null);
  const act = async (status: ReviewStatus) => {
    setBusy(status);
    try {
      await updateReview(tradeId, { reviewStatus: status });
      onReviewUpdated(tradeId, status);
      toast({ title: "Review updated", description: `Marked as ${REVIEW_LABELS[status]}.` });
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message || "Could not save review", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const btn = (status: ReviewStatus, label: string) => (
    <Button
      size="sm"
      variant={current === status ? "default" : "outline"}
      disabled={busy != null}
      onClick={() => act(status)}
      data-testid={`button-mark-${status}-${tradeId}`}
    >
      {busy === status ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : label}
    </Button>
  );
  return (
    <>
      {btn("reviewed", "Mark Reviewed")}
      {btn("watchlist", "Watchlist")}
      {btn("disputed", "Mark Disputed")}
      {btn("no_action", "No Action")}
    </>
  );
}

// ── Trade Details ─────────────────────────────────────────────────────────────
function TradeDetails({
  tradeId,
  teamName,
  showValue,
  onReviewUpdated,
  onBack,
}: {
  tradeId: number | null;
  teamName: (r: number) => string;
  showValue: boolean;
  onReviewUpdated: (id: number, status: ReviewStatus) => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<{ trade: TradeRow; reviews: TradeReview[]; generatedSummary: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (tradeId == null) return;
    setLoading(true);
    try {
      const d = await fetchTrade(tradeId);
      setData({ trade: d.trade, reviews: d.reviews, generatedSummary: d.generatedSummary });
      const lastNote = d.reviews.find((r) => r.notes)?.notes ?? "";
      setNotes(lastNote);
    } catch (e: any) {
      toast({ title: "Failed to load trade", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [tradeId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (tradeId == null) {
    return <EmptyState icon={Eye} title="No trade selected" body="Pick a trade from the Trade Feed or Review Queue to see the full breakdown." />;
  }
  if (loading || !data) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading trade…</div>;
  }

  const t = data.trade;
  const saveReview = async (status: ReviewStatus) => {
    setSaving(true);
    try {
      await updateReview(t.id, { reviewStatus: status, notes, decisionReason });
      onReviewUpdated(t.id, status);
      toast({ title: "Review saved", description: `Marked as ${REVIEW_LABELS[status]}.` });
      await load();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(data.generatedSummary || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Clipboard unavailable in this browser.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">← Back to feed</Button>

      {/* Header */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold">{tradeTeams(t, teamName)}</div>
            <div className="text-sm text-muted-foreground">
              {t.leagueName ? `${t.leagueName} · ` : ""}
              {t.week != null ? `Completed Week ${t.week}` : "Completed"} · {fmtDate(t.statusUpdatedTs ?? t.createdTs)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RiskChip label={t.riskLabel} score={t.riskScore} />
            <span className="text-sm text-muted-foreground">Fairness {t.fairnessScore}/100</span>
            <ReviewChip status={t.reviewStatus} />
          </div>
        </div>
      </Card>

      {/* Asset breakdown */}
      <div className="grid gap-3 md:grid-cols-2">
        {t.rosterIds.map((rid) => {
          const got = receivedBy(t, rid);
          const total = t.totalValueByRoster[String(rid)] ?? 0;
          return (
            <Card key={rid} className="p-4">
              <div className="mb-2 font-semibold">{rosterLabel(t, rid, teamName)} receives</div>
              <ul className="space-y-1 text-sm">
                {got.length === 0 && <li className="text-muted-foreground">—</li>}
                {got.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span>
                      {assetLabel(a)}
                      {a.assetType === "player" && (a.position || a.team) && (
                        <span className="text-muted-foreground"> · {[a.position, a.team].filter(Boolean).join(", ")}</span>
                      )}
                    </span>
                    {showValue && <span className="tabular-nums text-muted-foreground">{fmt(a.assetValue)}</span>}
                  </li>
                ))}
              </ul>
              {showValue && (
                <div className="mt-2 border-t border-border pt-2 text-sm font-medium">
                  Total: {fmt(total)}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Value summary */}
      {showValue && (
        <Card className="p-4">
          <div className="mb-1 font-semibold">Value Summary</div>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            {t.rosterIds.map((rid) => (
              <div key={rid} className="flex justify-between">
                <span className="text-muted-foreground">{rosterLabel(t, rid, teamName)} total</span>
                <span className="tabular-nums">{fmt(t.totalValueByRoster[String(rid)] ?? 0)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-border pt-2 text-sm">
            {t.isMultiTeam ? "Multi-team trade — spread vs group average: " : "Difference: "}
            <span className="font-semibold">{t.valueDiffPct}%</span>
          </div>
        </Card>
      )}

      {/* Flags */}
      <Card className="p-4">
        <div className="mb-2 font-semibold">Flags</div>
        {t.flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No flags raised. This trade looks routine.</p>
        ) : (
          <div className="space-y-2">
            {t.flags.map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={cn("mt-0.5 inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium capitalize", SEVERITY_STYLES[f.severity])}>{f.severity}</span>
                <div>
                  <div className="text-sm font-medium">{f.title}</div>
                  <div className="text-sm text-muted-foreground">{f.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Commissioner notes + decision */}
      <Card className="p-4">
        <div className="mb-2 font-semibold">Commissioner Notes</div>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Document your review reasoning (optional)…" data-testid="textarea-trade-notes" />
        <input
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={decisionReason}
          onChange={(e) => setDecisionReason(e.target.value)}
          placeholder="Decision reason (optional, e.g. 'Value gap acceptable')"
          data-testid="input-decision-reason"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={saving} onClick={() => saveReview("reviewed")}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark Reviewed"}</Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => saveReview("watchlist")}>Watchlist</Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => saveReview("disputed")}>Mark Disputed</Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => saveReview("no_action")}>No Action Needed</Button>
        </div>
      </Card>

      {/* Copy-ready summary */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold">Copy-Ready Summary</div>
          <Button size="sm" variant="outline" onClick={copySummary} data-testid="button-copy-summary">
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? "Copied" : "Copy Summary"}
          </Button>
        </div>
        <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{data.generatedSummary || "—"}</pre>
      </Card>

      {/* Review history */}
      {data.reviews.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 font-semibold">Review History</div>
          <ul className="space-y-2 text-sm">
            {data.reviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-2 last:border-0">
                <ReviewChip status={r.reviewStatus} />
                <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                {r.notes && <span className="w-full text-muted-foreground">“{r.notes}”</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Manager History ───────────────────────────────────────────────────────────
function ManagerHistoryView({
  leagueId,
  rosterId,
  rosterNames,
  teamName,
  onPickRoster,
  onOpen,
}: {
  leagueId: string;
  rosterId: number | null;
  rosterNames: Map<number, string>;
  teamName: (r: number) => string;
  onPickRoster: (r: number) => void;
  onOpen: (id: number) => void;
}) {
  const [data, setData] = useState<ManagerHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const rosters = useMemo(() => Array.from(rosterNames.keys()).sort((a, b) => a - b), [rosterNames]);

  useEffect(() => {
    if (rosterId == null) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchManagerHistory(rosterId, leagueId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [rosterId, leagueId]);

  return (
    <div>
      <div className="mb-4 max-w-xs">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Manager</label>
        <Select value={rosterId != null ? String(rosterId) : ""} onValueChange={(v) => onPickRoster(Number(v))}>
          <SelectTrigger data-testid="select-manager"><SelectValue placeholder="Select a manager…" /></SelectTrigger>
          <SelectContent>
            {rosters.map((r) => (
              <SelectItem key={r} value={String(r)}>{teamName(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rosterId == null ? (
        <EmptyState icon={Users} title="Pick a manager" body="Select a manager to see their full trade history and aggregate value flow." />
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>
      ) : !data ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No data for this manager.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total trades" value={String(data.totalTrades)} />
            <StatCard label="Value received" value={fmt(data.valueReceived)} />
            <StatCard label="Value sent" value={fmt(data.valueSent)} />
            <StatCard label="Net value" value={fmt(data.netValue)} tone={data.netValue >= 0 ? "pos" : "neg"} />
            <StatCard label="Future picks traded away" value={String(data.futurePicksTradedAway)} />
            <StatCard label="High-risk trades" value={String(data.highRiskTrades)} />
            <StatCard label="Disputed trades" value={String(data.disputedTrades)} />
          </div>
          <div className="space-y-2">
            {data.trades.map((t) => (
              <Card key={t.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{tradeTeams(t, teamName)}</div>
                  <div className="text-xs text-muted-foreground">{t.week != null ? `Week ${t.week} · ` : ""}{fmtDate(t.statusUpdatedTs ?? t.createdTs)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <RiskChip label={t.riskLabel} score={t.riskScore} />
                  <Button size="sm" variant="outline" onClick={() => onOpen(t.id)}>View</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── League Analytics ──────────────────────────────────────────────────────────
function AnalyticsView({
  leagueId,
  teamName,
  onOpenManager,
}: {
  leagueId: string;
  teamName: (r: number) => string;
  onOpenManager: (r: number) => void;
}) {
  const [data, setData] = useState<LeagueAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAnalytics(leagueId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (loading) return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading analytics…</div>;
  if (!data || data.totalTrades === 0) return <EmptyState icon={BarChart3} title="No analytics yet" body="Once trades are scanned, league-level analytics will appear here." />;

  const weeks = Object.entries(data.tradesByWeek).sort((a, b) => Number(a[0]) - Number(b[0]));
  const maxWeek = Math.max(1, ...weeks.map(([, c]) => c));
  const maxMgr = Math.max(1, ...data.mostActiveManagers.map((m) => m.count));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total trades" value={String(data.totalTrades)} />
        <StatCard label="Avg value gap" value={`${data.avgValueDiffPct}%`} />
        <StatCard label="High-risk trades" value={String(data.highRiskTrades)} tone={data.highRiskTrades > 0 ? "neg" : undefined} />
        <StatCard label="Future-pick trades" value={String(data.futurePickTrades)} />
        <StatCard label="Reviewed" value={String(data.reviewedCount)} tone="pos" />
        <StatCard label="Unreviewed" value={String(data.unreviewedCount)} tone={data.unreviewedCount > 0 ? "neg" : undefined} />
      </div>

      <Card className="p-4">
        <div className="mb-3 font-semibold">Trades by Week</div>
        <div className="space-y-1.5">
          {weeks.map(([wk, count]) => (
            <div key={wk} className="flex items-center gap-2 text-sm">
              <span className="w-16 shrink-0 text-muted-foreground">Week {wk}</span>
              <div className="h-4 flex-1 rounded bg-muted">
                <div className="h-4 rounded bg-primary" style={{ width: `${(count / maxWeek) * 100}%` }} />
              </div>
              <span className="w-6 shrink-0 text-right tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 font-semibold">Most Active Managers</div>
        <div className="space-y-1.5">
          {data.mostActiveManagers.map((m) => (
            <button key={m.rosterId} onClick={() => onOpenManager(m.rosterId)} className="flex w-full items-center gap-2 text-sm hover:opacity-80">
              <span className="w-32 shrink-0 truncate text-left text-muted-foreground">{teamName(m.rosterId)}</span>
              <div className="h-4 flex-1 rounded bg-muted">
                <div className="h-4 rounded bg-sky-500" style={{ width: `${(m.count / maxMgr) * 100}%` }} />
              </div>
              <span className="w-6 shrink-0 text-right tabular-nums">{m.count}</span>
            </button>
          ))}
        </div>
      </Card>

      {data.frequentTradePairs.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 font-semibold">Frequent Trade Partners</div>
          <ul className="space-y-1.5 text-sm">
            {data.frequentTradePairs.map((p, i) => (
              <li key={i} className="flex items-center justify-between">
                <span>{teamName(p.rosterIdA)} ↔ {teamName(p.rosterIdB)}</span>
                <span className="text-muted-foreground">{p.tradeCount} {p.tradeCount === 1 ? "trade" : "trades"} · {fmt(p.totalValueMoved)} value</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────
function SettingsView({
  settings,
  onSave,
}: {
  settings: TradeReviewSettings;
  onSave: (s: TradeReviewSettings) => void;
}) {
  const [draft, setDraft] = useState<TradeReviewSettings>(settings);
  const set = <K extends keyof TradeReviewSettings>(k: K, v: TradeReviewSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-4">
        <div className="space-y-5">
          <SliderRow
            label="Lopsided threshold"
            help="Value gap (%) above which a trade is flagged as potentially lopsided and queued for review."
            value={draft.lopsidedThresholdPct}
            min={5}
            max={50}
            suffix="%"
            onChange={(v) => set("lopsidedThresholdPct", v)}
          />
          <SliderRow
            label="High-risk threshold"
            help="Value gap (%) considered high-risk for emphasis in the queue."
            value={draft.highRiskThresholdPct}
            min={10}
            max={60}
            suffix="%"
            onChange={(v) => set("highRiskThresholdPct", v)}
          />
          <SliderRow
            label="Repeat trade partner threshold"
            help="Number of trades between the same two managers (this season) before the Frequent Trade Partners flag fires."
            value={draft.repeatPartnerThreshold}
            min={2}
            max={10}
            onChange={(v) => set("repeatPartnerThreshold", v)}
          />
          <ToggleRow label="Auto-queue future 1st-round picks" checked={draft.autoQueueFutureFirsts} onChange={(v) => set("autoQueueFutureFirsts", v)} />
          <ToggleRow label="Flag future-pick trades for dues confirmation" checked={draft.requireFutureDuesForFuturePickTrades} onChange={(v) => set("requireFutureDuesForFuturePickTrades", v)} />
          <ToggleRow label="Show values in copy-ready public summary" checked={draft.showValueInPublicSummary} onChange={(v) => set("showValueInPublicSummary", v)} />
          <div>
            <label className="mb-1 block text-sm font-medium">Value source</label>
            <Select value={draft.valueSource} onValueChange={(v) => set("valueSource", v)}>
              <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default (FantasyCalc dynasty)</SelectItem>
                <SelectItem value="custom">Custom (coming soon)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>
      <Button onClick={() => onSave(draft)} data-testid="button-save-trade-settings">Save settings</Button>
      <p className="text-xs text-muted-foreground">
        Settings are stored for this league in your browser and applied on the next trade scan.
      </p>
    </div>
  );
}

// ── Small shared UI bits ──────────────────────────────────────────────────────
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-bold tabular-nums", tone === "pos" && "text-emerald-600 dark-any:text-emerald-400", tone === "neg" && "text-red-600 dark-any:text-red-400")}>{value}</div>
    </Card>
  );
}

function SliderRow({
  label,
  help,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm tabular-nums text-muted-foreground">{value}{suffix ?? ""}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={1} onValueChange={(v) => onChange(v[0])} />
      <p className="mt-1 text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Eye;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/50" />
      <div>
        <div className="font-semibold">{title}</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
      {action}
    </Card>
  );
}

export default TradeReviewCenter;
