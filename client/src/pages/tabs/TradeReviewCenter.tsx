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
  Settings as SettingsIcon,
  ClipboardList,
  Flag,
  Layers,
  StickyNote,
} from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import { useLeagueAvatars } from "@/hooks/useLeagueAvatars";
import {
  ingestTrades,
  fetchTradeFeed,
  fetchTrade,
  updateReview,
  fetchManagerHistory,
  type TradeRow,
  type TradeAsset,
  type TradeFlag,
  type TradeReview,
  type ReviewStatus,
  type RiskLabel,
  type Severity,
  type ManagerHistory,
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

type SectionId = "feed" | "queue" | "details" | "manager" | "settings";

const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof Eye }> = [
  { id: "feed", label: "Trade Feed", icon: ScrollText },
  { id: "queue", label: "Review Queue", icon: ClipboardList },
  { id: "details", label: "Trade Details", icon: Eye },
  { id: "manager", label: "Manager History", icon: Users },
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

// Short, scannable flag labels for the collapsed "Flags:" row.
const FLAG_SHORT: Record<string, string> = {
  lopsided: "Lopsided",
  future_pick: "Future pick risk",
  premium_pick: "Premium future asset",
  repeat_partner: "Repeat manager concern",
  orphan_risk: "Possible dump",
  league_balance: "League balance",
  direction_mismatch: "Contender/rebuilder mismatch",
};
function flagShort(f: TradeFlag): string {
  return FLAG_SHORT[f.flagType] ?? f.title;
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

  // Per-league format chips (SF/1QB, team count, scoring) resolved from the
  // connected Sleeper league summaries — the feed spans multiple leagues.
  const leagueMeta = useCallback((id: string): LeagueMeta => {
    const s = sleeper.leagues.find((l) => l.leagueId === id);
    return { format: s?.format, scoring: s?.scoringFormat, teams: s?.totalRosters, tep: s?.tePremium ?? 0, avatar: s?.avatar ?? null };
  }, [sleeper.leagues]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTradeFeed(commishLeagueIds);
      // Startup-draft pick trades are excluded server-side (feed query).
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
            <TradeFeed trades={trades} teamName={teamName} leagueMeta={leagueMeta} onOpen={openTrade} onReviewUpdated={onReviewUpdated} onRefresh={handleRefresh} refreshing={refreshing} />
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

interface LeagueMeta { format?: string; scoring?: string; teams?: number; tep?: number; avatar?: string | null }

// League-format scoring label: PPR / 0.5 PPR / Standard.
function scoringLabel(scoring?: string): string | null {
  if (!scoring) return null;
  if (scoring === "Half") return "0.5 PPR";
  return scoring; // "PPR" | "Standard"
}

function TradeFeed({
  trades,
  teamName,
  leagueMeta,
  onOpen,
  onReviewUpdated,
  onRefresh,
  refreshing,
}: {
  trades: TradeRow[];
  teamName: (r: number) => string;
  leagueMeta: (id: string) => LeagueMeta;
  onOpen: (id: number) => void;
  onReviewUpdated: (id: number, status: ReviewStatus) => void;
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
            <TradeReviewCard
              key={t.id}
              trade={t}
              teamName={teamName}
              meta={leagueMeta(t.leagueId)}
              onOpen={onOpen}
              onReviewUpdated={onReviewUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trade Review Card (premium Dynasty-style trade comparison) ────────────────

const GOLD = "#d4af37";

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 dark-any:bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

// One asset row — player headshot+meta or pick/FAAB icon, value aligned right.
function AssetRow({ a }: { a: TradeAsset }) {
  if (a.assetType === "player") {
    return (
      <div className="flex items-center justify-between gap-2 py-1.5">
        <PlayerAvatar id={a.playerId ?? ""} name={a.playerName ?? "Unknown player"} pos={a.position ?? ""} team={a.team ?? ""} size="sm" />
        <span className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground/90">{fmt(a.assetValue)}</span>
      </div>
    );
  }
  const isPick = a.assetType === "pick";
  const label = isPick ? `${a.pickSeason ?? ""} ${ordinal(a.pickRound)}`.trim() : `$${a.faabAmount ?? 0} FAAB`;
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#0b3a7a]/15 ring-1 ring-border/40 dark-any:bg-white/5">
          <Layers className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-foreground">{label || "Draft pick"}</div>
          <div className="text-[11px] text-muted-foreground">{isPick ? "Draft pick" : "Free-agent budget"}</div>
        </div>
      </div>
      <span className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground/90">{fmt(a.assetValue)}</span>
    </div>
  );
}

// One side of the comparison — label, manager name, total + advantage pill, assets.
function TradeSide({
  name, avatar, total, advantage, assets,
}: {
  name: string;
  avatar?: string | null;
  total: number;
  advantage: number;
  assets: TradeAsset[];
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 p-3 dark-any:border-white/8 dark-any:bg-white/[0.02]">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SleeperUserAvatar username={name} avatar={avatar ?? null} size="sm" compact />
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">{name}</span>
          <span className="flex-shrink-0 text-[11px] font-medium text-muted-foreground">receives</span>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-base font-bold tabular-nums text-foreground">{fmt(total)}</div>
          {advantage > 0 && (
            <span className="mt-0.5 inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark-any:text-emerald-400">
              +{fmt(advantage)} Value
            </span>
          )}
        </div>
      </div>
      <div className="divide-y divide-border/40">
        {assets.length === 0
          ? <div className="py-1.5 text-xs text-muted-foreground">—</div>
          : assets.map((a, i) => <AssetRow key={i} a={a} />)}
      </div>
    </div>
  );
}

// Premium trade-review card — mirrors the Dynasty Command trade-comparison card
// while keeping commissioner risk/flag/review context. Trade is the main content.
function TradeReviewCard({
  trade: t,
  teamName,
  meta,
  onOpen,
  onReviewUpdated,
}: {
  trade: TradeRow;
  teamName: (r: number) => string;
  meta: LeagueMeta;
  onOpen: (id: number) => void;
  onReviewUpdated: (id: number, status: ReviewStatus) => void;
}) {
  const { toast } = useToast();
  const avatars = useLeagueAvatars(t.leagueId); // rosterId → owner avatar hash
  const status = tradeStatus(t);
  const isCritical = t.riskLabel === "critical";

  // Build per-side data; mark the value-advantage side.
  const sides = t.rosterIds.map((rid) => ({
    rid,
    name: rosterLabel(t, rid, teamName),
    total: t.totalValueByRoster[String(rid)] ?? 0,
    assets: receivedBy(t, rid),
  }));
  const ranked = [...sides].sort((a, b) => b.total - a.total);
  const advantage = ranked.length >= 2 ? Math.round(ranked[0].total - ranked[1].total) : 0;
  const winnerRid = ranked[0]?.rid;

  const statusText = status === "review" ? "Review needed" : STATUS_META[status].label;

  const dismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateReview(t.id, { reviewStatus: "no_action" });
      onReviewUpdated(t.id, "no_action");
      toast({ title: "Flag dismissed", description: "Marked as No Action." });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    }
  };

  return (
    <div
      className={cn(
        "group cursor-pointer rounded-2xl border p-4 transition-colors sm:p-5",
        "border-[var(--sc-border)] bg-[var(--sc-card-bg)] hover:bg-[var(--sc-card-soft)]",
        "dark-any:border-white/8 dark-any:bg-[linear-gradient(180deg,rgba(8,17,30,0.92)_0%,rgba(6,12,22,0.96)_100%)] dark-any:hover:bg-white/[0.03]",
        isCritical && "ring-1 ring-red-500/30 dark-any:ring-red-500/25",
      )}
      onClick={() => onOpen(t.id)}
      data-testid={`card-trade-${t.id}`}
    >
      {/* Title row: league logo — league — gap — status */}
      <div className="flex items-center gap-2">
        {(meta.avatar || t.leagueName) && (
          <SleeperUserAvatar username={t.leagueName ?? "League"} avatar={meta.avatar ?? null} size="sm" compact />
        )}
        <div className="min-w-0 truncate text-base font-bold text-foreground">
          {t.leagueName ?? "Trade"}
        </div>
        {t.isMultiTeam && <MetaChip>Multi</MetaChip>}
        <div className="ml-auto flex flex-shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">
            Gap <span className="font-bold tabular-nums text-foreground">{t.valueDiffPct}%</span>
          </span>
          <StatusChip status={status} />
        </div>
      </div>

      {/* Trade comparison */}
      {sides.length === 2 ? (
        <div className="mt-3 grid grid-cols-1 items-stretch gap-2 md:grid-cols-[1fr_auto_1fr] md:gap-3">
          <TradeSide name={sides[0].name} avatar={avatars[sides[0].rid]?.avatar} total={sides[0].total} advantage={winnerRid === sides[0].rid ? advantage : 0} assets={sides[0].assets} />
          <div className="flex items-center justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b3a7a]/15 ring-1 ring-border/40 dark-any:bg-white/5">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <TradeSide name={sides[1].name} avatar={avatars[sides[1].rid]?.avatar} total={sides[1].total} advantage={winnerRid === sides[1].rid ? advantage : 0} assets={sides[1].assets} />
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {sides.map((s) => (
            <TradeSide key={s.rid} name={s.name} avatar={avatars[s.rid]?.avatar} total={s.total} advantage={winnerRid === s.rid ? advantage : 0} assets={s.assets} />
          ))}
        </div>
      )}

      {/* Why flagged + league settings (settings pills right-aligned) */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <SignalChips flags={t.flags} />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {meta.format && <MetaChip>{meta.format}</MetaChip>}
          {meta.teams != null && <MetaChip>{meta.teams} Teams</MetaChip>}
          {scoringLabel(meta.scoring) && <MetaChip>{scoringLabel(meta.scoring)}</MetaChip>}
          {meta.tep ? <MetaChip>TEP</MetaChip> : null}
        </div>
      </div>

      {/* Commissioner action footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 dark-any:border-white/8">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{statusText}</span>
          {" · "}Last updated {fmtDate(t.statusUpdatedTs ?? t.createdTs)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            className="h-8"
            style={{ background: GOLD, color: "#1a1206" }}
            onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
            data-testid={`button-review-trade-${t.id}`}
          >
            {ctaLabel(status)}
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }} data-testid={`button-add-note-${t.id}`}>
            <StickyNote className="mr-1.5 h-3.5 w-3.5" /> Add Note
          </Button>
          {t.reviewStatus !== "no_action" && (
            <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={dismiss} data-testid={`button-dismiss-flag-${t.id}`}>
              Dismiss Flag
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Quick-filter pills: the fast "what needs me?" lens, ANDed with the dropdowns.
type QuickFilter = "all" | "needs-review" | "flagged" | "reviewed" | "unreviewed";
const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs-review", label: "Needs Review" },
  { value: "flagged", label: "Flagged" },
  { value: "reviewed", label: "Reviewed" },
  { value: "unreviewed", label: "Unreviewed" },
];
function matchesQuick(t: TradeRow, q: QuickFilter): boolean {
  switch (q) {
    case "all": return true;
    case "needs-review": return tradeStatus(t) === "review";
    case "flagged": return tradeStatus(t) === "flagged" || tradeStatus(t) === "escalated";
    case "reviewed": return t.reviewStatus === "reviewed" || t.reviewStatus === "no_action";
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
