/**
 * Collusion Risk Check — a commissioner decision-support tool.
 *
 * Enter two Sleeper usernames; the tool scans their shared leagues and trade
 * history and presents a "case file" of signals. It NEVER renders a verdict —
 * labels are neutral (Low Risk → High Concern) and the page leads with a
 * disclaimer that it identifies patterns that may warrant review, nothing more.
 */
import { useState, useMemo, useRef } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ShieldAlert,
  Loader2,
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  Flag,
  StickyNote,
  Download,
  ScrollText,
  Users,
  Info,
} from "lucide-react";
import {
  runCollusionRiskCheck,
  type CollusionResult,
  type CollusionTrade,
  type PatternFlag,
} from "@/lib/collusionRiskApi";

// ── Formatting + label helpers ────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
}

// Risk label → color treatment. Neutral, escalating — never an accusation.
const RISK_STYLES: Record<string, string> = {
  "Low Risk": "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30",
  Watchlist: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30",
  "Moderate Concern": "bg-orange-500/15 text-orange-600 dark-any:text-orange-400 border-orange-500/30",
  "High Concern": "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-sky-500/15 text-sky-600 dark-any:text-sky-400 border-sky-500/30",
  low: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30",
  high: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30",
  critical: "bg-red-500/15 text-red-600 dark-any:text-red-400 border-red-500/30",
};

const DISCLAIMER =
  "This tool does not determine intent or prove collusion. It identifies unusual trade and shared-league patterns that may warrant commissioner review.";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CollusionRiskCheck() {
  const { toast } = useToast();
  const [userA, setUserA] = useState("");
  const [userB, setUserB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CollusionResult | null>(null);
  const tradeHistoryRef = useRef<HTMLDivElement | null>(null);

  const canRun = userA.trim().length > 0 && userB.trim().length > 0 && !loading;

  const run = async () => {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await runCollusionRiskCheck(userA.trim(), userB.trim());
      setResult(res);
    } catch (e: any) {
      setError(e?.message || "Collusion risk check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Collusion Risk Check"
        subtitle="Scans shared leagues and trade history for unusual patterns that may warrant commissioner review."
      />

      {/* Always-visible disclaimer — the tool surfaces signals, not verdicts. */}
      <Card className="flex items-start gap-2 border-sky-500/30 bg-sky-500/5 p-4 text-sm text-sky-700 dark-any:text-sky-300">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>{DISCLAIMER}</span>
      </Card>

      {/* Input */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Username A" value={userA} onChange={setUserA} onEnter={run} placeholder="Sleeper username" testId="input-collusion-user-a" />
          <Field label="Username B" value={userB} onChange={setUserB} onEnter={run} placeholder="Sleeper username" testId="input-collusion-user-b" />
          <Button onClick={run} disabled={!canRun} className="h-10" data-testid="button-run-collusion-check">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
            Run Collusion Risk Check
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="flex items-center gap-2 border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark-any:text-red-400">
          <AlertTriangle className="h-4 w-4" /> {error}
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Scanning shared leagues &amp; trade history…
        </div>
      )}

      {result && !loading && (
        <Results result={result} tradeHistoryRef={tradeHistoryRef} toast={toast} />
      )}
    </div>
  );
}

function Field({
  label, value, onChange, onEnter, placeholder, testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter()}
        placeholder={placeholder}
        data-testid={testId}
      />
    </label>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────

function Results({
  result,
  tradeHistoryRef,
  toast,
}: {
  result: CollusionResult;
  tradeHistoryRef: React.MutableRefObject<HTMLDivElement | null>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const nameA = result.userA.displayName;
  const nameB = result.userB.displayName;

  const exportReport = () => {
    const blob = new Blob([buildReport(result, note)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collusion-risk_${result.userA.username}_${result.userB.username}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: "Report exported", description: "Saved a Markdown case file to your downloads." });
  };

  return (
    <div className="space-y-5">
      {/* 1. Top summary */}
      <SummaryCard result={result} />

      {/* Recommended actions buttons (top-level access) */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => tradeHistoryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          data-testid="button-open-trade-history"
        >
          <ScrollText className="mr-1.5 h-4 w-4" /> Open Trade History
        </Button>
        <Button variant="outline" size="sm" onClick={() => setNoteOpen((o) => !o)} data-testid="button-add-commissioner-note">
          <StickyNote className="mr-1.5 h-4 w-4" /> Add Commissioner Note
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => toast({ title: "Watchlist flag noted", description: `Documented a watchlist note for ${nameA} ↔ ${nameB}. Include it in your export.` })}
          data-testid="button-create-watchlist-flag"
        >
          <Flag className="mr-1.5 h-4 w-4" /> Create Watchlist Flag
        </Button>
        <Button variant="outline" size="sm" onClick={exportReport} data-testid="button-export-report">
          <Download className="mr-1.5 h-4 w-4" /> Export Report
        </Button>
      </div>

      {noteOpen && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">Commissioner Note</div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Document your review reasoning. This note is included in the exported report."
            data-testid="textarea-collusion-note"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Notes live with this report only — use Export Report to save them, or paste into your Commissioner Log.
          </p>
        </Card>
      )}

      {/* 2. Shared leagues */}
      <SharedLeaguesSection result={result} />

      {/* 3. Trade history */}
      <div ref={tradeHistoryRef}>
        <TradeHistorySection result={result} />
      </div>

      {/* 4. Value flow */}
      <ValueFlowSection result={result} />

      {/* 5. Pattern flags */}
      <PatternFlagsSection flags={result.patternFlags} />

      {/* Score breakdown (supports the headline number transparently) */}
      <ScoreBreakdownSection result={result} />

      {/* 6. Possible innocent explanations */}
      <InnocentExplanations />

      {/* 7. Recommended actions */}
      <RecommendedActions nameA={nameA} nameB={nameB} />
    </div>
  );
}

function SummaryCard({ result }: { result: CollusionResult }) {
  const nameA = result.userA.displayName;
  const nameB = result.userB.displayName;
  const flow = result.valueFlow;
  const flowSide = flow.netSide === "A" ? nameA : flow.netSide === "B" ? nameB : null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Collusion Risk Check</div>
          <div className="mt-0.5 text-xl font-bold text-foreground">
            {nameA} <span className="text-muted-foreground">↔</span> {nameB}
          </div>
          {result.scannedSeasons.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              Scanned seasons {result.scannedSeasons[result.scannedSeasons.length - 1]}–{result.scannedSeasons[0]} · dynasty, keeper &amp; redraft
            </div>
          )}
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold",
            RISK_STYLES[result.riskLabel] ?? RISK_STYLES["Low Risk"],
          )}
          data-testid="chip-risk-level"
        >
          Risk Level: {result.riskLabel}
        </span>
      </div>

      {/* Evidence strength bar */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Evidence Strength</span>
          <span className="font-semibold text-foreground">{result.evidenceStrength}/100</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              result.riskScore >= 75 ? "bg-red-500" : result.riskScore >= 50 ? "bg-orange-500" : result.riskScore >= 25 ? "bg-amber-500" : "bg-emerald-500",
            )}
            style={{ width: `${result.evidenceStrength}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Shared Leagues" value={String(result.sharedLeaguesCount)} />
        <Stat label="Trades Together" value={String(result.tradesTogether)} />
        <Stat label="Flagged Trades" value={String(result.flaggedTrades)} />
        <Stat
          label="One-Sided Value Trend"
          value={flowSide ? `${flowSide} ${signed(Math.abs(flow.net))}` : "Even"}
        />
        <Stat
          label="Last Trade"
          value={result.lastTrade ? `Week ${result.lastTrade.week}, ${result.lastTrade.season}` : "—"}
        />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon className="h-4 w-4 text-muted-foreground" /> {children}
    </div>
  );
}

function SharedLeaguesSection({ result }: { result: CollusionResult }) {
  const seasonsLabel = result.scannedSeasons.length
    ? `${result.scannedSeasons[result.scannedSeasons.length - 1]}–${result.scannedSeasons[0]}`
    : "";
  if (result.sharedLeagues.length === 0) {
    return (
      <Card className="p-4">
        <SectionTitle icon={Users}>Shared Leagues</SectionTitle>
        <p className="text-sm text-muted-foreground">
          These two users don&apos;t appear to share any leagues across the {seasonsLabel} seasons scanned.
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <SectionTitle icon={Users}>Shared Leagues</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">League</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Seasons</th>
              <th className="py-2 pr-3 font-medium">{result.userA.displayName} Team</th>
              <th className="py-2 pr-3 font-medium">{result.userB.displayName} Team</th>
              <th className="py-2 pr-3 text-right font-medium">Trades</th>
              <th className="py-2 pr-3 text-right font-medium">Flags</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.sharedLeagues.map((l) => (
              <tr key={l.leagueId} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-3 font-medium text-foreground">{l.leagueName}</td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {l.format} · <span className="capitalize">{l.leagueType.toLowerCase()}</span>
                </td>
                <td className="py-2 pr-3 tabular-nums text-muted-foreground">{l.seasonsScanned.join(", ")}</td>
                <td className="py-2 pr-3 text-muted-foreground">{l.userATeam}</td>
                <td className="py-2 pr-3 text-muted-foreground">{l.userBTeam}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.tradesBetween}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.flags}</td>
                <td className="py-2 capitalize text-muted-foreground">{l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Helps you see whether this is a one-league issue or a pattern across several leagues — including prior seasons
        of the same league. Includes dynasty, keeper, and redraft leagues.
      </p>
    </Card>
  );
}

function TradeHistorySection({ result }: { result: CollusionResult }) {
  return (
    <Card className="p-4">
      <SectionTitle icon={ArrowLeftRight}>Trade History Between Users</SectionTitle>
      {result.trades.length === 0 ? (
        <p className="text-sm text-muted-foreground">No trades between these two users were found in the scanned leagues.</p>
      ) : (
        <div className="space-y-2.5">
          {result.trades.map((t) => (
            <TradeCard key={`${t.leagueId}-${t.id}`} trade={t} result={result} />
          ))}
        </div>
      )}
    </Card>
  );
}

// Read-only premium trade card — mirrors the Review Center design without the
// commissioner review footer (these trades may live in leagues you don't run).
function TradeCard({ trade, result }: { trade: CollusionTrade; result: CollusionResult }) {
  const [open, setOpen] = useState(false);
  const nameA = result.userA.displayName;
  const nameB = result.userB.displayName;
  const winnerName = trade.winner === "A" ? nameA : trade.winner === "B" ? nameB : "Even";

  const aAssets = trade.assets.filter((x) => x.toRosterId === trade.rosterIdA);
  const bAssets = trade.assets.filter((x) => x.toRosterId === trade.rosterIdB);
  const meaningfulFlags = trade.flags.filter((f) => f.severity !== "info");

  return (
    <div className="rounded-xl border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 p-3 text-left"
        data-testid={`card-collusion-trade-${trade.id}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold text-foreground">{trade.leagueName}</span>
            <span className="text-muted-foreground">· Week {trade.week}, {trade.season}</span>
            {trade.timing && (
              <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize", SEVERITY_STYLES.medium)}>
                {trade.timing}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Gap <span className="font-semibold text-foreground">{trade.valueGapPct}%</span>
            {trade.winner !== "even" && <> · Winner <span className="font-semibold text-foreground">{winnerName}</span></>}
            {meaningfulFlags.length > 0 && <> · {meaningfulFlags.length} flag{meaningfulFlags.length === 1 ? "" : "s"}</>}
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-border/60 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TradeSide name={nameA} subtitle={trade.rosterNames[trade.rosterIdA]} total={trade.aReceivedValue} winner={trade.winner === "A"} assets={aAssets} />
            <TradeSide name={nameB} subtitle={trade.rosterNames[trade.rosterIdB]} total={trade.bReceivedValue} winner={trade.winner === "B"} assets={bAssets} />
          </div>

          {trade.isMultiTeam && (
            <p className="mt-2 text-xs text-muted-foreground">Multi-team trade — only the value between these two managers is compared.</p>
          )}

          {meaningfulFlags.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {meaningfulFlags.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={cn("mt-0.5 inline-flex items-center rounded border px-1.5 py-0.5 font-medium capitalize", SEVERITY_STYLES[f.severity])}>{f.severity}</span>
                  <div>
                    <span className="font-medium text-foreground">{f.title}</span>
                    <span className="text-muted-foreground"> — {f.description}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TradeSide({
  name, subtitle, total, winner, assets,
}: {
  name: string;
  subtitle?: string;
  total: number;
  winner: boolean;
  assets: Array<{ assetType: string; playerName?: string | null; position?: string | null; team?: string | null; pickSeason?: string | null; pickRound?: number | null; faabAmount?: number | null; assetValue: number }>;
}) {
  return (
    <div className={cn("rounded-lg border p-3", winner ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-background/40")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{name} receives</div>
          {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="text-right">
          <div className="text-sm font-bold tabular-nums text-foreground">{fmt(total)}</div>
          {winner && <div className="text-[10px] font-medium text-emerald-600 dark-any:text-emerald-400">Value edge</div>}
        </div>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {assets.length === 0 && <li className="text-muted-foreground">—</li>}
        {assets.map((a, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {assetLabel(a)}
              {a.assetType === "player" && (a.position || a.team) && (
                <span className="text-muted-foreground"> · {[a.position, a.team].filter(Boolean).join(", ")}</span>
              )}
            </span>
            <span className="flex-shrink-0 tabular-nums text-muted-foreground">{fmt(a.assetValue)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function assetLabel(a: { assetType: string; playerName?: string | null; pickSeason?: string | null; pickRound?: number | null; faabAmount?: number | null }): string {
  if (a.assetType === "player") return a.playerName || "Unknown player";
  if (a.assetType === "pick") return `${a.pickSeason ?? ""} ${ordinal(a.pickRound)}`.trim();
  return `$${a.faabAmount ?? 0} FAAB`;
}

function ordinal(round?: number | null): string {
  if (!round) return "Pick";
  if (round === 1) return "1st";
  if (round === 2) return "2nd";
  if (round === 3) return "3rd";
  return `${round}th`;
}

function ValueFlowSection({ result }: { result: CollusionResult }) {
  const { aGained, bGained, net, netSide } = result.valueFlow;
  const nameA = result.userA.displayName;
  const nameB = result.userB.displayName;
  const max = Math.max(aGained, bGained, 1);
  const flowName = netSide === "A" ? nameA : netSide === "B" ? nameB : null;

  return (
    <Card className="p-4">
      <SectionTitle icon={ArrowLeftRight}>Value Flow Summary</SectionTitle>
      {result.tradesTogether === 0 ? (
        <p className="text-sm text-muted-foreground">No trades to summarize.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Across {result.tradesTogether} trade{result.tradesTogether === 1 ? "" : "s"}, one lopsided deal can be normal — repeated
            one-direction value movement is more notable.
          </p>
          <FlowBar name={nameA} value={aGained} max={max} />
          <FlowBar name={nameB} value={bGained} max={max} />
          <div className="mt-3 border-t border-border pt-2 text-sm">
            Net flow:{" "}
            <span className="font-semibold text-foreground">
              {flowName ? `${flowName} ${signed(Math.abs(net))}` : "Even"}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function FlowBar({ name, value, max }: { name: string; value: number; max: number }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{name} gained</span>
        <span className="font-semibold tabular-nums text-foreground">{fmt(value)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${(value / max) * 100}%` }} />
      </div>
    </div>
  );
}

function PatternFlagsSection({ flags }: { flags: PatternFlag[] }) {
  return (
    <Card className="p-4">
      <SectionTitle icon={Flag}>Pattern Flags</SectionTitle>
      {flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notable patterns surfaced from the scanned data.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {flags.map((f) => (
            <div key={f.key} className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize", SEVERITY_STYLES[f.severity])}>{f.severity}</span>
                <span className="text-sm font-semibold text-foreground">{f.title}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ScoreBreakdownSection({ result }: { result: CollusionResult }) {
  return (
    <Card className="p-4">
      <SectionTitle icon={ShieldAlert}>How this score is built</SectionTitle>
      <div className="space-y-2">
        {result.scoreBreakdown.map((c) => (
          <div key={c.label} className="flex items-center gap-3">
            <div className="w-52 flex-shrink-0 text-xs text-muted-foreground">
              {c.label} <span className="text-foreground/60">({Math.round(c.weight * 100)}%)</span>
            </div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${c.score}%` }} />
            </div>
            <div className="w-10 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">{c.score}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Weighted components combine into the {result.evidenceStrength}/100 evidence-strength score. Weak signals (shared-league count,
        trade frequency) are weighted lightly so they support — but never drive — the result.
      </p>
    </Card>
  );
}

function InnocentExplanations() {
  return (
    <Card className="p-4">
      <SectionTitle icon={Info}>Possible non-collusion explanations</SectionTitle>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>One manager may be rebuilding while the other is contending.</li>
        <li>Dynasty trades can look lopsided depending on team direction.</li>
        <li>Some managers naturally trade more often with familiar leaguemates.</li>
        <li>Value models may disagree with human player preferences.</li>
      </ul>
    </Card>
  );
}

function RecommendedActions({ nameA, nameB }: { nameA: string; nameB: string }) {
  return (
    <Card className="p-4">
      <SectionTitle icon={ScrollText}>Recommended Commissioner Actions</SectionTitle>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Review the flagged trades manually.</li>
        <li>Compare each trade against league bylaws.</li>
        <li>Ask both managers for trade rationale.</li>
        <li>Document findings in the Commissioner Log.</li>
        <li>Add both managers to Watchlist if concerns remain.</li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        These are escalating review steps for {nameA} and {nameB} — not determinations. Use the buttons above to document and export.
      </p>
    </Card>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

function buildReport(r: CollusionResult, note: string): string {
  const nameA = r.userA.displayName;
  const nameB = r.userB.displayName;
  const flowName = r.valueFlow.netSide === "A" ? nameA : r.valueFlow.netSide === "B" ? nameB : "Even";
  const lines: string[] = [];
  lines.push(`# Collusion Risk Check — ${nameA} ↔ ${nameB}`);
  lines.push("");
  lines.push(`> ${DISCLAIMER}`);
  lines.push("");
  lines.push(`- Risk Level: ${r.riskLabel}`);
  lines.push(`- Evidence Strength: ${r.evidenceStrength}/100`);
  lines.push(`- Shared Leagues: ${r.sharedLeaguesCount}`);
  lines.push(`- Trades Together: ${r.tradesTogether}`);
  lines.push(`- Flagged Trades: ${r.flaggedTrades}`);
  lines.push(`- Net Value Flow: ${flowName} ${signed(Math.abs(r.valueFlow.net))}`);
  if (r.scannedSeasons.length) lines.push(`- Seasons Scanned: ${r.scannedSeasons.join(", ")} (dynasty, keeper & redraft)`);
  if (r.lastTrade) lines.push(`- Last Trade: Week ${r.lastTrade.week}, ${r.lastTrade.season}`);
  lines.push("");
  lines.push(`## Value Flow`);
  lines.push(`- ${nameA} gained: ${fmt(r.valueFlow.aGained)}`);
  lines.push(`- ${nameB} gained: ${fmt(r.valueFlow.bGained)}`);
  lines.push(`- Net: ${flowName} ${signed(Math.abs(r.valueFlow.net))}`);
  lines.push("");
  lines.push(`## Pattern Flags`);
  if (r.patternFlags.length === 0) lines.push("- None surfaced.");
  for (const f of r.patternFlags) lines.push(`- [${f.severity.toUpperCase()}] ${f.title}: ${f.description}`);
  lines.push("");
  lines.push(`## Shared Leagues`);
  for (const l of r.sharedLeagues) {
    lines.push(`- ${l.leagueName} (${l.format}) — ${nameA}: ${l.userATeam} / ${nameB}: ${l.userBTeam} — ${l.tradesBetween} trade(s), ${l.flags} flag(s)`);
  }
  lines.push("");
  lines.push(`## Trades Between Users`);
  for (const t of r.trades) {
    const w = t.winner === "A" ? nameA : t.winner === "B" ? nameB : "Even";
    lines.push(`- ${t.leagueName} · Wk ${t.week}, ${t.season} — gap ${t.valueGapPct}% — ${nameA} +${fmt(t.aReceivedValue)} / ${nameB} +${fmt(t.bReceivedValue)} — edge: ${w}`);
  }
  if (note.trim()) {
    lines.push("");
    lines.push(`## Commissioner Note`);
    lines.push(note.trim());
  }
  lines.push("");
  lines.push(`## Possible non-collusion explanations`);
  lines.push("- One manager may be rebuilding while the other is contending.");
  lines.push("- Dynasty trades can look lopsided depending on team direction.");
  lines.push("- Some managers naturally trade more often with familiar leaguemates.");
  lines.push("- Value models may disagree with human player preferences.");
  return lines.join("\n");
}
