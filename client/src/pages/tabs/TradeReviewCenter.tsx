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
 *   Trade Feed · Trade Details · Manager History · Analytics · Settings
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
  Loader2,
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Eye,
  ShieldAlert,
  ScrollText,
  Users,
  Settings as SettingsIcon,
  Flag,
  Layers,
  StickyNote,
  RotateCcw,
} from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import logoMark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";
import { useLeagueAvatars } from "@/hooks/useLeagueAvatars";
import {
  ingestTrades,
  fetchTradeFeed,
  fetchTrade,
  updateReview,
  fetchManagerHistory,
  type TradeRow,
  type TradeAsset,
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

type SectionId = "feed" | "manager" | "settings";

const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof Eye }> = [
  { id: "feed", label: "Trade Feed", icon: ScrollText },
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
function RiskChip({ label, score }: { label: RiskLabel; score: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold capitalize", RISK_STYLES[label])}>
      {label} · {score}
    </span>
  );
}

// ── Commissioner-facing trade status ──────────────────────────────────────────
// Pills reflect ONLY explicit commissioner action — nothing is auto-assigned.
// Approved → the commissioner hit Approve; Flagged → the commissioner flagged it;
// Needs Review → everything else (not yet acted on).
type TradeStatus = "needs-review" | "approved" | "flagged";
const STATUS_META: Record<TradeStatus, { label: string; cls: string }> = {
  "needs-review": { label: "Needs Review", cls: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30" },
  approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30" },
  flagged: { label: "Flagged", cls: "bg-orange-500/15 text-orange-600 dark-any:text-orange-400 border-orange-500/30" },
};
function tradeStatus(t: TradeRow): TradeStatus {
  if (t.reviewStatus === "reviewed") return "approved";
  if (t.reviewStatus === "watchlist") return "flagged";
  return "needs-review";
}
function StatusChip({ status }: { status: TradeStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", m.cls)} data-testid={`chip-status-${status}`}>
      {m.label}
    </span>
  );
}

// Sort lenses — a commissioner shouldn't hunt through cleared low-risk trades.
type SortKey = "priority" | "risk" | "gap" | "gapAbs" | "recent";
const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "gap", label: "% Gap" },
  { value: "gapAbs", label: "Gap" },
  { value: "recent", label: "Most recent" },
];
const RISK_RANK: Record<RiskLabel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const STATUS_PRIORITY: Record<TradeStatus, number> = {
  flagged: 2,
  "needs-review": 1,
  approved: 0,
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
    case "gapAbs":
      return arr.sort((a, b) => b.valueDiffAbs - a.valueDiffAbs);
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
  const [error, setError] = useState<string | null>(null);
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
    try {
      const data = await fetchTradeFeed(commishLeagueIds);
      // Startup-draft pick trades are excluded server-side (feed query).
      setTrades(data.trades);
    } catch (e: any) {
      setError(e?.message || "Failed to load trades");
    }
  }, [commishLeagueIds]);

  // Auto-refresh whenever the tab is opened: scan every commissioned league for
  // new trades, then load the feed. Scan failures on individual leagues are
  // tolerated quietly — we still surface whatever is already stored.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.allSettled(
          commishLeagueIds.map((id) => ingestTrades(id, { forceRefresh: false })),
        );
      } finally {
        if (!cancelled) {
          await loadFeed();
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commishLeagueIds, loadFeed]);

  const onReviewUpdated = useCallback((id: number, status: ReviewStatus) => {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, reviewStatus: status } : t)));
  }, []);

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <SectionHeader
          title="Trade Review Center"
          subtitle="Automatic trade tracking across every league you commission. Decision-support only — nothing here approves, rejects, or reverses trades."
        />
      </div>

      {/* Section nav */}
      <div className="mt-2 mb-5 flex flex-wrap gap-2 border-b border-border pb-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
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
            <TradeFeed trades={trades} teamName={teamName} leagueMeta={leagueMeta} onReviewUpdated={onReviewUpdated} />
          )}
          {section === "manager" && (
            <ManagerHistoryView
              leagueId={leagueId}
              rosterId={selectedManagerRoster}
              rosterNames={rosterNames}
              teamName={teamName}
              onPickRoster={setSelectedManagerRoster}
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
  onReviewUpdated,
}: {
  trades: TradeRow[];
  teamName: (r: number) => string;
  leagueMeta: (id: string) => LeagueMeta;
  onReviewUpdated: (id: number, status: ReviewStatus) => void;
}) {
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("gap");

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
          (leagueFilter === "all" || t.leagueId === leagueFilter),
      ),
    [trades, quickFilter, leagueFilter],
  );
  const sorted = useMemo(() => sortTrades(filtered, sortKey), [filtered, sortKey]);

  if (trades.length === 0) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="No trades recorded yet"
        body="No completed trades were found across your commissioned leagues' Sleeper transactions. This list refreshes automatically each time you open the tab."
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
              onReviewUpdated={onReviewUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trade Review Card (premium Dynasty-style trade comparison) ────────────────

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-border/60 bg-muted/40 dark-any:bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

// Draft-pick icon color by round: 1st = gold, 2nd = silver, 3rd = bronze, 4th+ = purple.
const PICK_ROUND_COLORS: Record<number, string> = {
  1: "#E6B800", // gold
  2: "#B8BCC2", // silver
  3: "#CD7F32", // bronze
  4: "#A855F7", // purple
};
function pickRoundColor(round?: number | null): string {
  if (round == null) return "#A855F7";
  return PICK_ROUND_COLORS[round] ?? "#A855F7";
}

// StatChasers logo silhouette, recolored to an arbitrary solid color via CSS mask.
// The PNG's alpha channel becomes the mask, so `color` fills the logo shape.
function PickLogoIcon({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="h-6 w-6 flex-shrink-0"
      style={{
        backgroundColor: color,
        WebkitMaskImage: `url(${logoMark})`,
        maskImage: `url(${logoMark})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
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
  const roundColor = pickRoundColor(a.pickRound);
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#0b3a7a]/15 ring-1 ring-border/40 dark-any:bg-white/5"
          style={isPick ? { boxShadow: `inset 0 0 0 1.5px ${roundColor}` } : undefined}
        >
          {isPick
            ? <PickLogoIcon color={roundColor} />
            : <Layers className="h-4 w-4 text-muted-foreground" />}
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
  onReviewUpdated,
}: {
  trade: TradeRow;
  teamName: (r: number) => string;
  meta: LeagueMeta;
  onReviewUpdated: (id: number, status: ReviewStatus) => void;
}) {
  const { toast } = useToast();
  const avatars = useLeagueAvatars(t.leagueId); // rosterId → owner avatar hash
  const status = tradeStatus(t);
  const isCritical = t.riskLabel === "critical";
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  // Reflects whether a commissioner note is attached. Seeded from the feed, then
  // kept in sync locally as the note is saved/cleared without a full reload.
  const [hasNote, setHasNote] = useState<boolean>(!!t.hasNote);

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

  const flag = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateReview(t.id, { reviewStatus: "watchlist" });
      onReviewUpdated(t.id, "watchlist");
      toast({ title: "Trade flagged", description: "Moved to Flagged." });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    }
  };

  const reset = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateReview(t.id, { reviewStatus: "unreviewed" });
      onReviewUpdated(t.id, "unreviewed");
      toast({ title: "Moved to Needs Review" });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    }
  };

  const approve = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateReview(t.id, { reviewStatus: "reviewed" });
      onReviewUpdated(t.id, "reviewed");
      toast({ title: "Trade approved", description: "Moved to Reviewed." });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    }
  };

  // Inline note editor — opens on the card, prefilled with the last saved note.
  const toggleNote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (noteOpen) {
      setNoteOpen(false);
      return;
    }
    setNoteOpen(true);
    setNoteLoading(true);
    try {
      const d = await fetchTrade(t.id);
      const existing = d.reviews.find((r) => r.notes)?.notes ?? "";
      setNoteText(existing);
      if (existing.trim()) setHasNote(true);
    } catch {
      // Non-fatal: start from an empty note if the prior note can't be loaded.
    } finally {
      setNoteLoading(false);
    }
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      await updateReview(t.id, { reviewStatus: t.reviewStatus, notes: noteText });
      setHasNote(noteText.trim().length > 0);
      toast({ title: noteText.trim() ? "Note saved" : "Note cleared" });
      setNoteOpen(false);
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div
      className={cn(
        "group rounded-2xl border p-4 transition-colors sm:p-5",
        "border-[var(--sc-border)] bg-[var(--sc-card-bg)]",
        "dark-any:border-white/8 dark-any:bg-[linear-gradient(180deg,rgba(8,17,30,0.92)_0%,rgba(6,12,22,0.96)_100%)]",
        isCritical && "ring-1 ring-red-500/30 dark-any:ring-red-500/25",
      )}
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
        {/* League settings pills — sit right next to the league name. */}
        {t.isMultiTeam && <MetaChip>Multi</MetaChip>}
        {meta.format && <MetaChip>{meta.format}</MetaChip>}
        {meta.teams != null && <MetaChip>{meta.teams} Teams</MetaChip>}
        {scoringLabel(meta.scoring) && <MetaChip>{scoringLabel(meta.scoring)}</MetaChip>}
        {meta.tep ? <MetaChip>TEP</MetaChip> : null}
        <div className="ml-auto flex flex-shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {hasNote && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark-any:text-sky-400"
              title="A commissioner note is attached to this trade"
              data-testid={`indicator-note-${t.id}`}
            >
              <StickyNote className="h-3 w-3" /> Note
            </span>
          )}
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

      {/* Recommended action — same commissioner guidance shown in the Review Queue */}
      <div className="mt-3 flex items-start gap-1.5 rounded-md bg-muted/50 p-2 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span><span className="font-medium">Recommended:</span> {suggestedAction(t)}</span>
      </div>

      {/* Commissioner action footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 dark-any:border-white/8">
        <div className="text-[11px] text-muted-foreground">
          {t.week != null && <><span className="font-medium text-foreground/80">Week {t.week}</span>{" · "}</>}
          {fmtDate(t.createdTs)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {t.reviewStatus === "unreviewed" && (
            <Button
              size="sm"
              className="h-8 bg-emerald-600 text-white hover:bg-emerald-600/90"
              onClick={approve}
              data-testid={`button-approve-trade-${t.id}`}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" /> Approve
            </Button>
          )}
          {t.reviewStatus === "unreviewed" && (
            <Button
              size="sm"
              className="h-8 bg-red-600 text-white hover:bg-red-600/90"
              onClick={flag}
              data-testid={`button-flag-trade-${t.id}`}
            >
              <Flag className="mr-1.5 h-3.5 w-3.5" /> Flag
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8" onClick={toggleNote} data-testid={`button-add-note-${t.id}`}>
            <StickyNote className="mr-1.5 h-3.5 w-3.5" /> {hasNote ? "Edit Note" : "Add Note"}
          </Button>
          {(t.reviewStatus === "reviewed" || t.reviewStatus === "watchlist") && (
            <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={reset} data-testid={`button-reset-review-${t.id}`}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Needs Review
            </Button>
          )}
        </div>
      </div>

      {/* Inline note editor — record commissioner notes without leaving the feed. */}
      {noteOpen && (
        <div className="mt-3 border-t border-border/50 pt-3 dark-any:border-white/8" onClick={(e) => e.stopPropagation()}>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            placeholder="Document your review reasoning (optional)…"
            disabled={noteLoading || savingNote}
            data-testid={`textarea-note-${t.id}`}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" disabled={noteLoading || savingNote} onClick={saveNote} data-testid={`button-save-note-${t.id}`}>
              {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Note"}
            </Button>
            <Button size="sm" variant="ghost" disabled={savingNote} onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            {noteLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
      )}
    </div>
  );
}

// Quick-filter pills: the fast "what needs me?" lens, ANDed with the dropdowns.
type QuickFilter = "all" | "needs-review" | "reviewed" | "flagged";
const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs-review", label: "Needs Review" },
  { value: "reviewed", label: "Approved" },
  { value: "flagged", label: "Flagged" },
];
function matchesQuick(t: TradeRow, q: QuickFilter): boolean {
  switch (q) {
    case "all": return true;
    case "needs-review": return t.reviewStatus === "unreviewed";
    case "reviewed": return t.reviewStatus === "reviewed";
    case "flagged": return t.reviewStatus === "watchlist";
  }
}

// ── Recommended commissioner action ──────────────────────────────────────────
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

// ── Manager History ───────────────────────────────────────────────────────────
function ManagerHistoryView({
  leagueId,
  rosterId,
  rosterNames,
  teamName,
  onPickRoster,
}: {
  leagueId: string;
  rosterId: number | null;
  rosterNames: Map<number, string>;
  teamName: (r: number) => string;
  onPickRoster: (r: number) => void;
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
