/**
 * PositionStats — Advanced player stats leaderboard.
 *
 * Backed by 16 bundled JSON files in client/src/data/advanced_stats/ (one per
 * position × season combo). Each file is loaded lazily on demand so the initial
 * bundle isn't bloated. The column definitions inside each file drive the table
 * structure — labels, types, and default visibility are all data-driven.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/SectionHeader";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  GitCompare,
  Loader2,
  Search,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";
import { computeQbCompositeScores, QB_SCORE_CATEGORIES } from "@/lib/qbCompositeScores";
import { computeRbCompositeScores, RB_SCORE_CATEGORIES } from "@/lib/rbCompositeScores";
import {
  computeWrCompositeScores,
  computeTeCompositeScores,
  WR_SCORE_CATEGORIES,
  TE_SCORE_CATEGORIES,
} from "@/lib/receivingComposites";

// ── Types ─────────────────────────────────────────────────────────────────────
type Position = "qb" | "rb" | "wr" | "te";
type SeasonKey = "all" | "2023" | "2024" | "2025";
type SortDir = "asc" | "desc";
// One cell of the table's section super-header row.
interface SuperHeaderSeg { label: string; span: number; sticky?: boolean; showLabel: boolean; divider: boolean }

interface ColDef {
  key: string;
  label: string;
  type: "number" | "decimal" | "string";
  defaultVisible: boolean;
}

interface AdvancedStatsData {
  updated_at: string;
  season: string | number;
  week: number | null;
  table: string;
  columns: ColDef[];
  rows: Record<string, unknown>[];
}

// ── Static import map (Vite requires string literals for code-splitting) ──────
type DataLoader = () => Promise<{ default: AdvancedStatsData }>;

const DATA_LOADERS: Record<string, DataLoader> = {
  qb_all:  () => import("@/data/advanced_stats/qb_advanced_stats_all.json"),
  qb_2023: () => import("@/data/advanced_stats/qb_advanced_stats_2023.json"),
  qb_2024: () => import("@/data/advanced_stats/qb_advanced_stats_2024.json"),
  qb_2025: () => import("@/data/advanced_stats/qb_advanced_stats_2025.json"),
  rb_all:  () => import("@/data/advanced_stats/rb_advanced_stats_all.json"),
  rb_2023: () => import("@/data/advanced_stats/rb_advanced_stats_2023.json"),
  rb_2024: () => import("@/data/advanced_stats/rb_advanced_stats_2024.json"),
  rb_2025: () => import("@/data/advanced_stats/rb_advanced_stats_2025.json"),
  wr_all:  () => import("@/data/advanced_stats/wr_advanced_stats_all.json"),
  wr_2023: () => import("@/data/advanced_stats/wr_advanced_stats_2023.json"),
  wr_2024: () => import("@/data/advanced_stats/wr_advanced_stats_2024.json"),
  wr_2025: () => import("@/data/advanced_stats/wr_advanced_stats_2025.json"),
  te_all:  () => import("@/data/advanced_stats/te_advanced_stats_all.json"),
  te_2023: () => import("@/data/advanced_stats/te_advanced_stats_2023.json"),
  te_2024: () => import("@/data/advanced_stats/te_advanced_stats_2024.json"),
  te_2025: () => import("@/data/advanced_stats/te_advanced_stats_2025.json"),
};

// ── UI constants ──────────────────────────────────────────────────────────────
const POSITIONS: { key: Position; label: string }[] = [
  { key: "qb", label: "QB" },
  { key: "rb", label: "RB" },
  { key: "wr", label: "WR" },
  { key: "te", label: "TE" },
];

const SEASONS: { key: SeasonKey; label: string }[] = [
  { key: "2025", label: "2025" },
  { key: "2024", label: "2024" },
  { key: "2023", label: "2023" },
  { key: "all",  label: "All" },
];

// Columns that are always pinned left and not in the toggleable list.
const PINNED_KEYS = new Set(["rank", "playerName", "player_name", "name", "team", "nfl_team"]);
// Columns that are never shown in the table (redundant or non-useful in this context).
const ALWAYS_HIDDEN = new Set([
  "playerId", "player_id", "sleeper_id", "sleeperId",
  "season",
  // WR/TE columns with no underlying data yet.
  "contestedCatchRate", "yardsAfterContactPerReception",
]);

// Super-headers: map each column key to the group label shown in the extra
// header row above the column names. Keys are grouped contiguously so the
// colspans line up with the rendered column order.
const QB_COLUMN_GROUPS: Record<string, string> = {
  overallQBGrade: "Composite Grades", volumeScore: "Composite Grades",
  accuracyScore: "Composite Grades", explosivenessScore: "Composite Grades",
  mobilityScore: "Composite Grades", efficiencyScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  attempts: "Volume / Usage", completions: "Volume / Usage", passingYards: "Volume / Usage",
  airYards: "Volume / Usage", completedAirYards: "Volume / Usage", redZoneAttempts: "Volume / Usage",
  passingTouchdowns: "Volume / Usage", rushAttempts: "Volume / Usage", rushYards: "Volume / Usage",
  rushTouchdowns: "Volume / Usage",
  airYardsPerAttempt: "Aggressiveness",
  completedAirYardsPerCompletion: "Aggressiveness",
  yardsPerCatch: "Aggressiveness",
  completionPct: "Efficiency", onTargetPct: "Efficiency", poorThrows: "Efficiency",
  badThrowPct: "Efficiency", interceptions: "Efficiency", epaPerPlay: "Efficiency",
  successRate: "Efficiency", cpoe: "Efficiency",
  passes10Plus: "Explosiveness", passes20Plus: "Explosiveness", passes30Plus: "Explosiveness",
  passes40Plus: "Explosiveness", passes50Plus: "Explosiveness", longestPass: "Explosiveness",
  deepAttemptPct: "Explosiveness",
  pocketTime: "Pressure & Pocket", timeToThrow: "Pressure & Pocket", throwaways: "Pressure & Pocket",
  battedPasses: "Pressure & Pocket", scrambleRate: "Pressure & Pocket", yardsPerScramble: "Pressure & Pocket",
  hurries: "Pressure & Pocket", blitzes: "Pressure & Pocket", knockdowns: "Pressure & Pocket",
  sacks: "Pressure & Pocket", sackYardsLost: "Pressure & Pocket", fumbles: "Pressure & Pocket",
  pressurePct: "Pressure & Pocket",
};

const RB_COLUMN_GROUPS: Record<string, string> = {
  overallRBGrade: "Composite Grades", volumeScore: "Composite Grades",
  efficiencyScore: "Composite Grades", explosivenessScore: "Composite Grades",
  receivingScore: "Composite Grades", elusivenessScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  snapPct: "Usage / Workload", routes: "Usage / Workload", rushAttempts: "Usage / Workload",
  redZoneOpportunities: "Usage / Workload", goalLineCarries: "Usage / Workload",
  targets: "Usage / Workload", targetSharePct: "Usage / Workload", receptions: "Usage / Workload",
  redZoneTargets: "Usage / Workload", endZoneTargets: "Usage / Workload",
  rushYards: "Production", yardsPerCarry: "Production", rushTouchdowns: "Production",
  receivingYards: "Production", yardsPerReception: "Production", receivingYardsAfterCatch: "Production",
  yardsPerRouteRun: "Production", receivingTouchdowns: "Production", epaPerPlay: "Production",
  rushes10Plus: "Explosive Play Ability", rushes20Plus: "Explosive Play Ability",
  rushes30Plus: "Explosive Play Ability", rushes40Plus: "Explosive Play Ability",
  rushes50Plus: "Explosive Play Ability", explosiveRunPct: "Explosive Play Ability",
  breakawayRunPct: "Explosive Play Ability", longestRush: "Explosive Play Ability",
  longestRushTouchdown: "Explosive Play Ability",
  brokenTackles: "Contact & Tackle Breaking", rushAttemptsPerBrokenTackle: "Contact & Tackle Breaking",
  yardsBeforeContactPerAttempt: "Contact & Tackle Breaking",
  yardsAfterContactPerAttempt: "Contact & Tackle Breaking", tackleEludedRate: "Contact & Tackle Breaking",
  fumbles: "Ball Security / Negative Plays", tacklesForLoss: "Ball Security / Negative Plays",
  tacklesForLossYards: "Ball Security / Negative Plays", rushAttForNegativeYards: "Ball Security / Negative Plays",
};

// WR and TE share the same columns, so they share one group map.
const WR_TE_COLUMN_GROUPS: Record<string, string> = {
  overallWRGrade: "Composite Grades", overallTEGrade: "Composite Grades",
  volumeScore: "Composite Grades", efficiencyScore: "Composite Grades",
  explosivenessScore: "Composite Grades", handsScore: "Composite Grades",
  elusivenessScore: "Composite Grades",
  rank: "Player Info", playerName: "Player Info", team: "Player Info",
  position: "Player Info", age: "Player Info", games: "Player Info", fantasyPoints: "Player Info",
  snapPct: "Usage/Role", routes: "Usage/Role", routePct: "Usage/Role", targets: "Usage/Role",
  targetsPerRouteRun: "Usage/Role", targetSharePct: "Usage/Role", airYardsPerTarget: "Usage/Role",
  airYardsPerReception: "Usage/Role", airYardsSharePct: "Usage/Role", wopr: "Usage/Role",
  redZoneTargets: "Usage/Role", endZoneTargets: "Usage/Role",
  receptions: "Production", receivingYards: "Production",
  yardsBeforeCatchPerReception: "Production", yardsAfterCatchPerReception: "Production",
  yardsPerReception: "Production", yardsPerRouteRun: "Production", receivingTouchdowns: "Production",
  epaPerPlay: "Production", successRate: "Production",
  catchPct: "Hands", contestedCatchRate: "Hands", catchableTargets: "Hands", drops: "Hands",
  dropPct: "Hands", interceptionsWhenTargeted: "Hands", fumbles: "Hands",
  avoidedTackleRate: "Elusiveness", brokenTackles: "Elusiveness",
  yardsAfterContactPerReception: "Elusiveness",
  receptions10Plus: "Explosiveness", receptions20Plus: "Explosiveness",
  receptions30Plus: "Explosiveness", receptions40Plus: "Explosiveness",
  receptions50Plus: "Explosiveness", longestReception: "Explosiveness",
};

// Super-header group maps keyed by position (omit a position to show no groups).
const COLUMN_GROUPS_BY_POSITION: Record<string, Record<string, string>> = {
  qb: QB_COLUMN_GROUPS,
  rb: RB_COLUMN_GROUPS,
  wr: WR_TE_COLUMN_GROUPS,
  te: WR_TE_COLUMN_GROUPS,
};

// Per-section accent colour — drives the left accent bar + header text so each
// stat family is instantly scannable (and consistent across positions).
const SECTION_ACCENTS: Record<string, string> = {
  "Composite Grades":             "#d4af37", // gold
  "Player Info":                  "#94a3b8", // slate
  "Volume / Usage":               "#f59e0b", // amber
  "Usage / Workload":             "#f59e0b",
  "Usage/Role":                   "#f59e0b",
  "Aggressiveness":  "#fb923c", // orange
  "Efficiency":                   "#60a5fa", // blue
  "Production":                   "#34d399", // emerald
  "Explosiveness":                "#c084fc", // purple
  "Explosive Play Ability":       "#c084fc",
  "Pressure & Pocket":            "#22d3ee", // cyan
  "Hands":                        "#2dd4bf", // teal
  "Elusiveness":                  "#fb7185", // rose
  "Contact & Tackle Breaking":    "#22d3ee",
  "Ball Security / Negative Plays":"#f87171", // red
};
const sectionAccent = (label: string): string => SECTION_ACCENTS[label] ?? "#94a3b8";
// Shared header bar gradient (left → right). The trailing solid colour matches
// the gradient's end so a sticky label cell + filler cell stay seamless.
const SECTION_BAR_GRADIENT = "linear-gradient(90deg, rgba(20,35,60,0.97) 0%, rgba(12,22,40,0.97) 100%)";
const SECTION_BAR_END = "rgba(12,22,40,0.97)";

// Hover-over explanation for each stat column (keyed by column key). Shown as a
// tooltip on the column header (Data) and the stat-row label (Compare), the same
// way composite-grade descriptions are surfaced.
const STAT_DESCRIPTIONS: Record<string, string> = {
  // Player info
  position: "Position",
  age: "Player age (years)",
  games: "Games played",
  fantasyPoints: "Total fantasy points scored",

  // QB — volume / usage
  attempts: "Pass attempts",
  completions: "Completed passes",
  passingYards: "Total passing yards",
  airYards: "Air yards — total distance the ball traveled in the air on all attempts",
  completedAirYards: "Completed air yards — air yards on completed passes only",
  redZoneAttempts: "Pass attempts inside the opponent's 20-yard line",
  passingTouchdowns: "Passing touchdowns",
  rushAttempts: "Rushing attempts",
  rushYards: "Rushing yards",
  rushTouchdowns: "Rushing touchdowns",

  // QB — aggressiveness / play style
  completedAirYardsPerCompletion: "Completed air yards per completion — average depth of completed passes",
  yardsPerCatch: "Passing yards per completion",

  // QB — accuracy / efficiency
  completionPct: "Completion percentage",
  onTargetPct: "Share of throws placed on target (catchable)",
  poorThrows: "Number of poorly thrown, uncatchable passes",
  badThrowPct: "Share of attempts that were bad throws (lower is better)",
  interceptions: "Interceptions thrown",
  epaPerPlay: "Expected points added per play — efficiency vs. expectation",
  successRate: "Share of plays that were 'successful' by EPA",
  cpoe: "Completion % over expected — accuracy above league baseline",

  // QB — explosiveness
  passes10Plus: "Completions gaining 10+ yards",
  passes20Plus: "Completions gaining 20+ yards",
  passes30Plus: "Completions gaining 30+ yards",
  passes40Plus: "Completions gaining 40+ yards",
  passes50Plus: "Completions gaining 50+ yards",
  longestPass: "Longest completion (yards)",
  deepAttemptPct: "Share of attempts thrown deep (20+ air yards)",

  // QB — pressure & pocket
  pocketTime: "Average time in the pocket per dropback (seconds)",
  timeToThrow: "Average time from snap to throw (seconds)",
  throwaways: "Intentional throwaways",
  battedPasses: "Passes batted down at the line",
  scrambleRate: "Share of dropbacks that became scrambles",
  yardsPerScramble: "Rushing yards per scramble",
  hurries: "Times hurried by the pass rush",
  blitzes: "Times blitzed",
  knockdowns: "Times knocked down after throwing",
  sacks: "Times sacked",
  sackYardsLost: "Yards lost on sacks",
  fumbles: "Fumbles",
  pressurePct: "Share of dropbacks under pressure",
  passesDropped: "Catchable passes dropped by receivers",

  // RB — usage / workload
  snapPct: "Share of team offensive snaps played",
  routes: "Routes run",
  redZoneOpportunities: "Carries + targets inside the opponent's 20",
  goalLineCarries: "Carries inside the opponent's 5-yard line",
  targets: "Targets",
  targetSharePct: "Share of team targets",
  receptions: "Receptions",
  redZoneTargets: "Targets inside the opponent's 20",
  endZoneTargets: "Targets thrown into the end zone",

  // RB — production
  yardsPerCarry: "Rushing yards per carry",
  receivingYards: "Receiving yards",
  yardsPerReception: "Yards per reception",
  receivingYardsAfterCatch: "Receiving yards gained after the catch",
  yardsPerRouteRun: "Receiving yards per route run",
  receivingTouchdowns: "Receiving touchdowns",

  // RB — explosive play ability
  rushes10Plus: "Rushes gaining 10+ yards",
  rushes20Plus: "Rushes gaining 20+ yards",
  rushes30Plus: "Rushes gaining 30+ yards",
  rushes40Plus: "Rushes gaining 40+ yards",
  rushes50Plus: "Rushes gaining 50+ yards",
  explosiveRunPct: "Share of carries gaining 10+ yards",
  breakawayRunPct: "Share of rushing yards from runs of 15+ yards",
  longestRush: "Longest rush (yards)",
  longestRushTouchdown: "Longest rushing touchdown (yards)",

  // RB — contact & tackle breaking
  brokenTackles: "Broken/missed tackles forced",
  rushAttemptsPerBrokenTackle: "Carries per broken tackle (lower = breaks tackles more often)",
  yardsBeforeContactPerAttempt: "Rushing yards before contact per attempt",
  yardsAfterContactPerAttempt: "Rushing yards after contact per attempt",
  tackleEludedRate: "Share of tackles eluded",

  // RB — ball security / negative plays
  tacklesForLoss: "Times tackled for a loss",
  tacklesForLossYards: "Yards lost on tackles for loss",
  rushAttForNegativeYards: "Carries that lost yardage",

  // WR / TE — usage / role
  targetsPerRouteRun: "Targets per route run",
  airYardsPerTarget: "Air yards per target — average depth of target",
  airYardsSharePct: "Share of team air yards",
  wopr: "Weighted Opportunity Rating — blends target share and air-yards share",
  routePct: "Share of team pass plays on which the player ran a route",
  airYardsPerReception: "Air yards per reception",

  // WR / TE — production
  yardsBeforeCatchPerReception: "Yards before the catch per reception (depth of catch)",
  yardsAfterCatchPerReception: "Yards after the catch per reception",
  totalYards: "Total yards (receiving + rushing)",

  // WR / TE — hands
  catchPct: "Catch rate — receptions per target",
  contestedCatchRate: "Contested-catch rate",
  catchableTargets: "Catchable targets",
  drops: "Dropped passes (lower is better)",
  dropPct: "Drop rate — drops per catchable target (lower is better)",
  interceptionsWhenTargeted: "Interceptions on throws to this player (lower is better)",

  // WR / TE — elusiveness
  avoidedTackleRate: "Share of receptions on which a tackle was avoided",
  receptionsPerBrokenTackle: "Receptions per broken tackle",

  // WR / TE — explosiveness
  receptions10Plus: "Receptions gaining 10+ yards",
  receptions20Plus: "Receptions gaining 20+ yards",
  receptions30Plus: "Receptions gaining 30+ yards",
  receptions40Plus: "Receptions gaining 40+ yards",
  receptions50Plus: "Receptions gaining 50+ yards",
  longestReception: "Longest reception (yards)",
};

// ── Composite scores ───────────────────────────────────────────────────────────
// Per-position grade engine: a function that scores the full pool of rows and
// the ordered category metadata (Overall first) that becomes the grade columns.
interface ScoreCategoryMeta { key: string; label: string; shortLabel: string; description: string }
interface ScoreEngine {
  compute: (rows: Record<string, unknown>[]) => Array<Record<string, number>>;
  categories: ScoreCategoryMeta[];
}
const SCORE_ENGINES: Record<Position, ScoreEngine> = {
  // QB/RB engines return nominal interfaces (all-number fields); cast to the
  // shared index-signature shape the table consumes.
  qb: { compute: computeQbCompositeScores as unknown as ScoreEngine["compute"], categories: QB_SCORE_CATEGORIES },
  rb: { compute: computeRbCompositeScores as unknown as ScoreEngine["compute"], categories: RB_SCORE_CATEGORIES },
  wr: { compute: computeWrCompositeScores, categories: WR_SCORE_CATEGORIES },
  te: { compute: computeTeCompositeScores, categories: TE_SCORE_CATEGORIES },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatVal(v: unknown, type: ColDef["type"]): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (type === "decimal") return v.toFixed(2);
    if (Number.isInteger(v)) return v.toLocaleString();
    return Math.abs(v) >= 1000 ? v.toLocaleString() : v.toFixed(2);
  }
  if (typeof v === "string") return v || "—";
  if (typeof v === "boolean") return v ? "✓" : "—";
  return String(v);
}

function numVal(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return -Infinity;
}

// Maximum players that can be compared side-by-side at once.
const MAX_COMPARE = 5;

// Stable identity + display helpers tolerant of the varying key names across
// the bundled JSON files.
function getPlayerKey(row: Record<string, unknown>): string {
  return String(
    row.playerId ?? row.player_id ?? row.sleeper_id ?? row.sleeperId ??
    row.playerName ?? row.player_name ?? row.name ?? "",
  );
}
function getPlayerName(row: Record<string, unknown>): string {
  return String(row.playerName ?? row.player_name ?? row.name ?? "—");
}
// "F. Last" — first initial + last name, to save space on non-desktop views.
function getShortPlayerName(row: Record<string, unknown>): string {
  const name = getPlayerName(row);
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
}
function getPlayerTeam(row: Record<string, unknown>): string {
  return String(row.team ?? row.nfl_team ?? "—");
}

// ── Sort icon ─────────────────────────────────────────────────────────────────
function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 opacity-35 shrink-0" />;
  return sortDir === "asc"
    ? <ChevronUp   className="w-3 h-3 text-[#d4af37] shrink-0" />
    : <ChevronDown className="w-3 h-3 text-[#d4af37] shrink-0" />;
}

// ── Compare player selector ───────────────────────────────────────────────────
// A search combobox (mirrors the Compare Players tab) bound to one comparison
// slot. Picking a player fills the slot; the X clears it.
function ComparePlayerSelector({
  label, players, excludeKeys, value, onChange,
}: {
  label: string;
  players: Record<string, unknown>[];
  excludeKeys: Set<string>;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = value ? players.find((p) => getPlayerKey(p) === value) ?? null : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => {
        if (excludeKeys.has(getPlayerKey(p))) return false; // chosen in another slot
        if (!q) return true;
        return (
          getPlayerName(p).toLowerCase().includes(q) ||
          getPlayerTeam(p).toLowerCase().includes(q)
        );
      })
      .slice(0, 60);
  }, [players, excludeKeys, query]);

  return (
    <div ref={ref} className="relative w-full" data-testid={`compare-selector-${label}`}>
      <div
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-2.5 h-9 cursor-pointer transition-colors",
          open ? "border-[#d4af37]/60 bg-[#0b3a7a]/10" : "border-border bg-transparent hover:border-foreground/30",
        )}
      >
        <Search className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
        {open ? (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Search player…"
            className="flex-1 min-w-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        ) : (
          <span className={cn("flex-1 min-w-0 text-xs truncate", selected ? "text-foreground font-semibold" : "text-muted-foreground")}>
            {selected ? getPlayerName(selected) : label}
          </span>
        )}
        {selected && !open ? (
          <button
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="text-muted-foreground hover:text-foreground shrink-0"
            data-testid={`compare-selector-clear-${label}`}
            aria-label={`Clear ${label}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/70 shrink-0 transition-transform", open && "rotate-180")} />
        )}
      </div>

      {open && (
        <div className="absolute z-40 top-full mt-1 w-full rounded-lg border border-border bg-[hsl(var(--card))] shadow-xl max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground italic">No players found.</div>
          ) : (
            filtered.map((p) => {
              const key = getPlayerKey(p);
              return (
                <button
                  key={key}
                  onClick={() => { onChange(key); setOpen(false); setQuery(""); }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[#0b3a7a]/15 transition-colors",
                    key === value && "bg-[#0b3a7a]/20",
                  )}
                  data-testid={`compare-selector-option-${key}`}
                >
                  <span className="font-medium text-foreground truncate flex-1">{getPlayerName(p)}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{getPlayerTeam(p)}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Section super-header row ──────────────────────────────────────────────────
// Renders one gradient section-header row from a set of segments. Used for both
// the desktop (Team column included) and mobile (Team omitted) variants.
function SuperHeaderRow({ segments, className }: { segments: SuperHeaderSeg[]; className: string }) {
  return (
    <tr className={className}>
      {segments.map((seg, i) => {
        const accent = sectionAccent(seg.label);
        return (
          <th
            key={`grp-${i}`}
            colSpan={seg.span}
            className={cn(
              "px-3 py-2 text-center font-extrabold uppercase text-[10px]",
              seg.sticky && "sticky left-0 z-30",
            )}
            style={{
              background: SECTION_BAR_GRADIENT,
              color: seg.showLabel ? accent : undefined,
              letterSpacing: "0.12em",
              // Coloured left accent only at the start of a new section
              borderLeft: seg.divider ? `3px solid ${accent}` : undefined,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {seg.showLabel ? seg.label : null}
          </th>
        );
      })}
    </tr>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PositionStats() {
  const [subTab, setSubTab]         = useState<"data" | "compare">("data");
  const [position, setPosition]     = useState<Position>("qb");
  const [season, setSeason]         = useState<SeasonKey>("2025");
  const [data, setData]             = useState<AdvancedStatsData | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [sortKey, setSortKey]       = useState("rank");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set());
  const [showColPanel, setShowColPanel] = useState(false);
  // Compare sub-tab: a fixed set of MAX_COMPARE slots, each holding a player key
  // (or null when empty).
  const [compareSlots, setCompareSlots] = useState<(string | null)[]>(() =>
    Array(MAX_COMPARE).fill(null),
  );
  // Non-desktop is capped to 3 players to fit; desktop allows the full MAX_COMPARE.
  const isMobile = useIsMobile();
  const maxCompare = isMobile ? 3 : MAX_COMPARE;

  // Load the JSON file whenever position or season changes
  useEffect(() => {
    const loaderKey = `${position}_${season}`;
    const loader = DATA_LOADERS[loaderKey];
    if (!loader) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setSortKey("rank");
    setSortDir("asc");
    setSearch("");
    setShowColPanel(false);
    setCompareSlots(Array(MAX_COMPARE).fill(null));

    loader()
      .then((mod) => {
        if (cancelled) return;
        setData(mod.default as AdvancedStatsData);
        // Default visible columns are derived from `scoredData` (which adds the
        // grade columns) in the effect below, so they're not set here.
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [position, season]);

  // ── Composite scores ────────────────────────────────────────────────────────
  // Grade columns + descriptions for the active position (Overall first).
  const scoreCategories = SCORE_ENGINES[position].categories;
  const scoreKeySet = useMemo(
    () => new Set(scoreCategories.map((c) => c.key)),
    [scoreCategories],
  );
  const scoreDescByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of scoreCategories) m[c.key] = c.description;
    return m;
  }, [scoreCategories]);

  // The loaded data augmented with composite grade columns. Scores are computed
  // against the FULL pool (every row, unfiltered/unsorted) so percentiles aren't
  // distorted by the current search/sort, then merged onto each row by index.
  // Grade columns are appended so they render at the end of the table and trail
  // the Columns panel.
  const scoredData = useMemo<AdvancedStatsData | null>(() => {
    if (!data) return null;
    const { compute, categories } = SCORE_ENGINES[position];
    const scores = compute(data.rows);
    const scoreCols: ColDef[] = categories.map((c) => ({
      key: c.key,
      label: c.shortLabel,
      type: "number",
      defaultVisible: true,
    }));
    const rows = data.rows.map((r, i) => ({ ...r, ...scores[i] }));
    return { ...data, columns: [...data.columns, ...scoreCols], rows };
  }, [data, position]);

  // Reset visible columns to defaults (including grades) whenever a new dataset
  // loads.
  useEffect(() => {
    if (!scoredData) return;
    setVisibleCols(
      new Set(
        scoredData.columns
          .filter((c) => c.defaultVisible && !PINNED_KEYS.has(c.key) && !ALWAYS_HIDDEN.has(c.key))
          .map((c) => c.key),
      ),
    );
  }, [scoredData]);

  // All toggleable stat columns (grades first, then the JSON columns in order)
  const allStatCols = useMemo<ColDef[]>(() => {
    if (!scoredData) return [];
    return scoredData.columns.filter(
      (c) => !PINNED_KEYS.has(c.key) && !ALWAYS_HIDDEN.has(c.key),
    );
  }, [scoredData]);

  // Only the currently-visible stat columns
  const activeCols = useMemo(
    () => allStatCols.filter((c) => visibleCols.has(c.key)),
    [allStatCols, visibleCols],
  );

  // Super-header segments: contiguous column groups → colspans. The first two
  // rendered columns (# and Player) are frozen, so they get their own sticky cell.
  // Super-header section bars. Desktop includes the Team column; mobile omits it
  // (Team is shown inline next to the player name there), so colspans stay aligned
  // with the columns actually rendered at each breakpoint.
  const { groupSegments, groupSegmentsMobile } = useMemo(() => {
    const groupMap = COLUMN_GROUPS_BY_POSITION[position];
    if (!groupMap) return { groupSegments: [] as SuperHeaderSeg[], groupSegmentsMobile: [] as SuperHeaderSeg[] };
    const build = (includeTeam: boolean): SuperHeaderSeg[] => {
      const seq = includeTeam
        ? ["rank", "playerName", "team", ...activeCols.map((c) => c.key)]
        : ["rank", "playerName", ...activeCols.map((c) => c.key)];
      // Merge contiguous columns that share a group label.
      const groups: { label: string; span: number }[] = [];
      for (const key of seq) {
        const label = groupMap[key] ?? "";
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.span += 1;
        else groups.push({ label, span: 1 });
      }
      // The first two columns (#, Player) are frozen, so split them into a sticky
      // cell. The group's label sits on the wider non-sticky portion so the whole
      // group (Team, POS, Age, G, FPTS, …) reads under one header. `divider` marks
      // the start of a *new* group (the coloured left accent bar).
      const segs: SuperHeaderSeg[] = [];
      groups.forEach((g, gi) => {
        if (gi === 0 && g.span >= 2) {
          const rest = g.span - 2;
          segs.push({ label: g.label, span: 2, sticky: true, showLabel: rest === 0, divider: false });
          if (rest > 0) segs.push({ label: g.label, span: rest, showLabel: true, divider: false });
        } else {
          segs.push({ label: g.label, span: g.span, showLabel: true, divider: gi > 0 });
        }
      });
      return segs;
    };
    return { groupSegments: build(true), groupSegmentsMobile: build(false) };
  }, [position, activeCols]);

  // Keys of the stat columns that begin a new group — used to draw a vertical
  // divider down the table at each group boundary.
  const groupBoundaryKeys = useMemo(() => {
    const set = new Set<string>();
    const groupMap = COLUMN_GROUPS_BY_POSITION[position];
    if (!groupMap) return set;
    let prevLabel = groupMap["team"] ?? "";
    for (const c of activeCols) {
      const label = groupMap[c.key] ?? "";
      if (label !== prevLabel) set.add(c.key);
      prevLabel = label;
    }
    return set;
  }, [position, activeCols]);

  const colByKey = useMemo<Record<string, ColDef>>(() => {
    const m: Record<string, ColDef> = {};
    for (const c of scoredData?.columns ?? []) m[c.key] = c;
    return m;
  }, [scoredData]);

  // Filter by search, then sort
  const rows = useMemo(() => {
    if (!scoredData) return [];
    let r = scoredData.rows;
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((row) => {
        const name = String(row.playerName ?? row.player_name ?? row.name ?? "").toLowerCase();
        const team = String(row.team ?? row.nfl_team ?? "").toLowerCase();
        return name.includes(q) || team.includes(q);
      });
    }
    if (sortKey) {
      const colDef = colByKey[sortKey];
      const numeric = !colDef || colDef.type === "number" || colDef.type === "decimal";
      r = [...r].sort((a, b) => {
        let cmp: number;
        if (numeric) {
          const av = numVal(a[sortKey]);
          const bv = numVal(b[sortKey]);
          // Push missing values to the end regardless of sort direction
          if (av === -Infinity && bv !== -Infinity) return 1;
          if (bv === -Infinity && av !== -Infinity) return -1;
          cmp = av - bv;
        } else {
          cmp = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return r;
  }, [scoredData, search, sortKey, sortDir, colByKey]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" || key === "playerName" || key === "team" ? "asc" : "desc");
    }
  };

  // ── Compare sub-tab derived data ────────────────────────────────────────────
  // The selected players, resolved to their rows in current display order.
  const compareRows = useMemo(() => {
    if (!scoredData) return [];
    const byKey = new Map(scoredData.rows.map((r) => [getPlayerKey(r), r]));
    return compareSlots
      .slice(0, maxCompare)
      .filter((id): id is string => id != null)
      .map((id) => byKey.get(id))
      .filter((r): r is Record<string, unknown> => r != null);
  }, [scoredData, compareSlots, maxCompare]);

  // Visible stat columns bucketed by super-header group (the compare table's rows).
  const compareGroups = useMemo(() => {
    const groupMap = COLUMN_GROUPS_BY_POSITION[position];
    const order: string[] = [];
    const byLabel = new Map<string, ColDef[]>();
    for (const c of activeCols) {
      const label = groupMap?.[c.key] ?? "Other";
      if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label); }
      byLabel.get(label)!.push(c);
    }
    return order.map((label) => ({ label, cols: byLabel.get(label)! }));
  }, [activeCols, position]);

  // Set (or clear) the player in a given comparison slot.
  const setSlot = (index: number, id: string | null) =>
    setCompareSlots((prev) => prev.map((s, i) => (i === index ? id : s)));
  // Clear whichever slot currently holds this player (used by the table's
  // column-header remove button).
  const removeById = (id: string) =>
    setCompareSlots((prev) => prev.map((s) => (s === id ? null : s)));

  // Toggleable stat columns bucketed by their super-header group, in order.
  // The Columns panel toggles whole groups rather than individual columns.
  const statColGroups = useMemo(() => {
    const groupMap = COLUMN_GROUPS_BY_POSITION[position];
    const order: string[] = [];
    const byLabel = new Map<string, string[]>();
    for (const c of allStatCols) {
      const label = groupMap?.[c.key] ?? "Other";
      if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label); }
      byLabel.get(label)!.push(c.key);
    }
    return order.map((label) => ({ label, keys: byLabel.get(label)! }));
  }, [allStatCols, position]);

  // Show every column in the group if any are hidden; otherwise hide them all.
  const toggleGroup = (keys: string[]) =>
    setVisibleCols((prev) => {
      const next = new Set(prev);
      const allVisible = keys.every((k) => next.has(k));
      keys.forEach((k) => (allVisible ? next.delete(k) : next.add(k)));
      return next;
    });

  const updatedAt = data?.updated_at
    ? new Date(data.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  // Pill-style sub-tab toggle (matches the My Portfolio Overview/Finances tabs)
  const renderSubTabToggle = (testidPrefix: string) =>
    (["data", "compare"] as const).map((tab) => {
      const isActive = subTab === tab;
      const Icon = tab === "data" ? Table2 : GitCompare;
      const label = tab === "data" ? "Data" : "Compare";
      return (
        <button
          key={tab}
          onClick={() => setSubTab(tab)}
          data-testid={`${testidPrefix}-${tab}`}
          className="relative flex items-center justify-center gap-2 font-semibold transition-all duration-200"
          style={{
            borderRadius: 12, fontSize: 13, letterSpacing: "0.01em",
            background: isActive ? "linear-gradient(135deg, rgba(11,58,122,0.85) 0%, rgba(11,58,122,0.65) 100%)" : "transparent",
            color: isActive ? "#fff" : "rgba(203,213,225,0.45)",
            border: isActive ? "1px solid rgba(212,175,55,0.30)" : "1px solid transparent",
            boxShadow: isActive ? "0 2px 12px rgba(11,58,122,0.40), inset 0 1px 0 rgba(255,255,255,0.06)" : "none",
          }}
        >
          <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
          {label}
          {isActive && <span className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full" style={{ width: 28, height: 2, background: "#d4af37", opacity: 0.85 }} />}
        </button>
      );
    });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Advanced Stats"
          subtitle="Advanced stats leaderboard — sortable, searchable, with customizable columns."
        />
        <div
          className="hidden md:grid flex-shrink-0"
          style={{ gridTemplateColumns: "1fr 1fr", height: 48, borderRadius: 16, padding: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", gap: 4, width: 240 }}
        >
          {renderSubTabToggle("stats-subtab")}
        </div>
      </div>

      {/* Mobile sub-tab toggle */}
      <div className="md:hidden flex justify-center">
        <div
          className="grid w-[90vw]"
          style={{ gridTemplateColumns: "1fr 1fr", height: 48, borderRadius: 16, padding: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", gap: 4 }}
        >
          {renderSubTabToggle("stats-subtab-mobile")}
        </div>
      </div>

      {/* ── Shared controls card (both Data and Compare sub-tabs) ────────── */}
      <Card className="p-4 space-y-3" data-testid="position-stats-controls">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Position selector */}
          <div className="space-y-1.5 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Position
            </span>
            <div className="flex gap-1">
              {POSITIONS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPosition(p.key)}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                    position === p.key
                      ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                      : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground",
                  )}
                  data-testid={`btn-position-${p.key}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Season selector */}
          <div className="space-y-1.5 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Season
            </span>
            <div className="flex gap-1">
              {SEASONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSeason(s.key)}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                    season === s.key
                      ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                      : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground",
                  )}
                  data-testid={`btn-season-${s.key}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search + column toggle row. The free-text search filters the Data
            table; Compare selects players via the 5 slot pickers instead. */}
        <div className="flex gap-2">
          {subTab !== "compare" && (
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search player or team…"
                className="pl-8 h-8 text-xs"
                data-testid="input-player-search"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="btn-clear-search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => setShowColPanel((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold border transition-colors shrink-0",
              subTab === "compare" && "ml-auto",
              showColPanel
                ? "bg-[#0b3a7a] text-white border-[#0b3a7a]"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
            )}
            data-testid="btn-toggle-col-panel"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Columns
          </button>
        </div>

        {/* Column visibility panel */}
        {showColPanel && allStatCols.length > 0 && (
          <div className="border border-border/50 rounded-lg p-3 bg-muted/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {visibleCols.size} of {allStatCols.length} columns visible
              </span>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <button
                  onClick={() => setVisibleCols(new Set(allStatCols.map((c) => c.key)))}
                  className="hover:text-foreground transition-colors"
                  data-testid="btn-show-all-cols"
                >
                  Show all
                </button>
                <span className="opacity-40">·</span>
                <button
                  onClick={() =>
                    setVisibleCols(
                      new Set(allStatCols.filter((c) => c.defaultVisible).map((c) => c.key)),
                    )
                  }
                  className="hover:text-foreground transition-colors"
                  data-testid="btn-reset-cols"
                >
                  Reset defaults
                </button>
                <span className="opacity-40">·</span>
                <button
                  onClick={() => setVisibleCols(new Set())}
                  className="hover:text-foreground transition-colors"
                  data-testid="btn-hide-all-cols"
                >
                  Hide all
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statColGroups.map((g) => {
                const allVisible = g.keys.every((k) => visibleCols.has(k));
                const someVisible = g.keys.some((k) => visibleCols.has(k));
                return (
                  <button
                    key={g.label}
                    onClick={() => toggleGroup(g.keys)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors",
                      allVisible
                        ? "bg-[#d4af37]/15 text-[#d4af37] border-[#d4af37]/40"
                        : someVisible
                          ? "bg-[#d4af37]/[0.06] text-[#d4af37]/80 border-[#d4af37]/25 border-dashed"
                          : "bg-transparent text-muted-foreground/50 border-border/50 hover:border-foreground/20 hover:text-muted-foreground",
                    )}
                    data-testid={`btn-col-group-${g.label}`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Meta row */}
        {!loading && data && (
          <p className="text-[10px] text-muted-foreground/55 leading-none">
            {position.toUpperCase()} · {season === "all" ? "All Seasons" : `${season} Season`}
            {subTab === "compare"
              ? ` · comparing ${compareRows.length} of ${maxCompare} players`
              : ` · ${rows.length} of ${data.rows.length} players`}
            {updatedAt && ` · Updated ${updatedAt}`}
          </p>
        )}
      </Card>

      {/* ── Loading (shared) ─────────────────────────────────────────────── */}
      {loading && (
        <Card className="p-8 text-center" data-testid="loading-state">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Loading {position.toUpperCase()} · {season === "all" ? "All Seasons" : season}…
          </p>
        </Card>
      )}

      {/* ── Error (shared) ───────────────────────────────────────────────── */}
      {!loading && error && (
        <Card className="p-6 border-red-500/40 bg-red-500/5" data-testid="error-state">
          <p className="text-sm font-semibold text-red-500 mb-1">Failed to load data</p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
        </Card>
      )}

      {/* ── Compare sub-tab — selectors + transposed table ──────────────── */}
      {!loading && !error && data && subTab === "compare" && (
        <div className="space-y-5">

          {/* Player selectors — one search combobox per slot (Compare Players style). */}
          <Card className="p-4" data-testid="compare-slots">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Players · {compareRows.length} of {maxCompare}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {compareSlots.slice(0, maxCompare).map((slotId, i) => (
                <ComparePlayerSelector
                  key={i}
                  label={`Player ${i + 1}`}
                  players={scoredData?.rows ?? []}
                  excludeKeys={new Set(compareSlots.slice(0, maxCompare).filter((id, j): id is string => id != null && j !== i))}
                  value={slotId}
                  onChange={(id) => setSlot(i, id)}
                />
              ))}
            </div>
          </Card>

          {/* Comparison table: stat rows are preloaded on the left; player
              columns appear as selections are made. */}
          {activeCols.length === 0 ? (
            <Card className="p-10 text-center" data-testid="compare-no-cols">
              <p className="text-xs text-amber-500/80 italic">
                No stat columns visible — open Columns to add some.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0" data-testid="compare-table-card">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse" data-testid="compare-table">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/25">
                    <th className="sticky left-0 z-20 bg-[hsl(var(--card))] px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground border-r border-border/25 min-w-[150px]">
                      Stat
                    </th>
                    {compareRows.length === 0 ? (
                      <th
                        className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/45 italic min-w-[220px] border-l border-border/25"
                        data-testid="compare-empty-hint"
                      >
                        Select players above to compare →
                      </th>
                    ) : compareRows.map((r) => {
                      const id = getPlayerKey(r);
                      return (
                        <th
                          key={id}
                          className="px-3 py-2.5 text-right font-bold text-muted-foreground whitespace-nowrap min-w-[120px] border-l border-border/25"
                          data-testid={`compare-col-${id}`}
                        >
                          <div className="flex items-start justify-end gap-1.5">
                            <span className="flex flex-col items-end">
                              <span className="text-foreground font-semibold normal-case text-xs">
                                <span className="hidden md:inline">{getPlayerName(r)}</span>
                                <span className="md:hidden">{getShortPlayerName(r)}</span>
                              </span>
                              <span className="text-[10px] font-normal text-muted-foreground">
                                {getPlayerTeam(r)}
                              </span>
                            </span>
                            <button
                              onClick={() => removeById(id)}
                              className="text-muted-foreground/60 hover:text-foreground mt-0.5"
                              data-testid={`compare-remove-${id}`}
                              aria-label={`Remove ${getPlayerName(r)}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {compareGroups.map((g, gi) => {
                    const accent = sectionAccent(g.label);
                    return (
                    <Fragment key={g.label}>
                      {/* Vertical separation before each section (not the first) */}
                      {gi > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={1 + Math.max(compareRows.length, 1)} className="p-0">
                            <div className="h-4" />
                          </td>
                        </tr>
                      )}
                      {g.label && (
                        <tr data-testid={`compare-section-${g.label}`}>
                          {/* Sticky label cell: gradient bar + coloured left accent */}
                          <td
                            className="sticky left-0 z-10 px-3 py-2.5 whitespace-nowrap"
                            style={{
                              background: SECTION_BAR_GRADIENT,
                              borderLeft: `3px solid ${accent}`,
                              borderTop: "1px solid rgba(255,255,255,0.08)",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <span
                              className="text-[10px] font-extrabold uppercase"
                              style={{ color: accent, letterSpacing: "0.12em" }}
                            >
                              {g.label}
                            </span>
                          </td>
                          {/* Filler cell continues the bar across the player columns */}
                          <td
                            colSpan={Math.max(compareRows.length, 1)}
                            style={{
                              background: SECTION_BAR_END,
                              borderTop: "1px solid rgba(255,255,255,0.08)",
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                            }}
                          />
                        </tr>
                      )}
                      {g.cols.map((col, ci) => {
                        // Highlight the highest numeric value across the compared
                        // players (string columns get no highlight).
                        let max = -Infinity;
                        if (col.type !== "string") {
                          for (const r of compareRows) {
                            const v = numVal(r[col.key]);
                            if (v > max) max = v;
                          }
                        }
                        const hasLeader = max !== -Infinity && compareRows.length > 1;
                        const isScore = scoreKeySet.has(col.key);
                        const stickyBg = ci % 2 === 1
                          ? "linear-gradient(hsl(var(--muted) / 0.7), hsl(var(--muted) / 0.7)), hsl(var(--card))"
                          : "hsl(var(--card))";
                        return (
                          <tr
                            key={col.key}
                            className={cn(
                              "border-b border-border/15 hover:bg-[#0b3a7a]/5 transition-colors",
                              ci % 2 === 1 && "bg-muted/40",
                            )}
                            data-testid={`compare-row-${col.key}`}
                          >
                            <td
                              style={{ background: stickyBg }}
                              title={isScore ? scoreDescByKey[col.key] : STAT_DESCRIPTIONS[col.key]}
                              className={cn(
                                "sticky left-0 z-10 px-3 py-2 whitespace-nowrap border-r border-border/25",
                                isScore ? "font-semibold text-foreground/90" : "font-medium text-muted-foreground",
                                (isScore ? scoreDescByKey[col.key] : STAT_DESCRIPTIONS[col.key]) && "cursor-help",
                              )}
                            >
                              {col.label}
                            </td>
                            {compareRows.length === 0 ? (
                              <td className="px-3 py-2 text-right text-muted-foreground/25 border-l border-border/25">—</td>
                            ) : compareRows.map((r) => {
                              const raw = r[col.key];
                              const isEmpty = raw == null;
                              const isLeader = hasLeader && !isEmpty && numVal(raw) === max;
                              return (
                                <td
                                  key={getPlayerKey(r)}
                                  className={cn(
                                    "px-3 py-2 text-right tabular-nums whitespace-nowrap border-l border-border/25",
                                    isLeader
                                      ? "bg-[#d4af37]/[0.08] text-[#d4af37] font-semibold"
                                      : isEmpty
                                        ? "text-muted-foreground/30"
                                        : "text-foreground/90",
                                  )}
                                  data-testid={`compare-cell-${col.key}-${getPlayerKey(r)}`}
                                >
                                  {formatVal(raw, col.type)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-border/25 bg-muted/10">
              <p className="text-[10px] text-muted-foreground/60">
                {compareRows.length === 0
                  ? `Select up to ${maxCompare} players to compare`
                  : `Comparing ${compareRows.length} of ${maxCompare} player${compareRows.length !== 1 ? "s" : ""}${compareRows.length > 1 ? " · highest value in each stat highlighted" : ""}`}
              </p>
            </div>
          </Card>
          )}
        </div>
      )}

      {/* ── Data sub-tab ─────────────────────────────────────────────────── */}
      {!loading && !error && data && subTab === "data" && (
        <Card className="overflow-hidden p-0" data-testid="stats-table-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="stats-table">
              <thead>
                {/* Section super-headers — desktop includes Team, mobile omits it */}
                {groupSegments.length > 0 && (
                  <SuperHeaderRow segments={groupSegments} className="hidden md:table-row" />
                )}
                {groupSegmentsMobile.length > 0 && (
                  <SuperHeaderRow segments={groupSegmentsMobile} className="md:hidden" />
                )}
                <tr className="border-b border-border/50 bg-muted/25">
                  {/* # (rank) */}
                  <th
                    onClick={() => handleSort("rank")}
                    className="sticky left-0 z-20 bg-[hsl(var(--card))] px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap border-r border-border/25 w-10 min-w-[40px]"
                    data-testid="th-rank"
                  >
                    <span className="flex items-center gap-0.5">
                      # <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  {/* Player */}
                  <th
                    onClick={() => handleSort("playerName")}
                    className="sticky left-10 z-20 bg-[hsl(var(--card))] px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap border-r border-border/25 min-w-[148px]"
                    data-testid="th-player"
                  >
                    <span className="flex items-center gap-0.5">
                      Player <SortIcon col="playerName" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  {/* Team (hidden on mobile — shown inline next to player name instead) */}
                  <th
                    onClick={() => handleSort("team")}
                    className="hidden md:table-cell px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors whitespace-nowrap border-r border-border/25"
                    data-testid="th-team"
                  >
                    <span className="flex items-center gap-0.5">
                      Team <SortIcon col="team" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  {/* Stat columns */}
                  {activeCols.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      title={scoreKeySet.has(col.key) ? scoreDescByKey[col.key] : STAT_DESCRIPTIONS[col.key]}
                      className={cn(
                        "px-3 py-2.5 text-right font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-foreground transition-colors whitespace-nowrap",
                        sortKey === col.key
                          ? "text-[#d4af37]"
                          : "text-muted-foreground",
                        groupBoundaryKeys.has(col.key) && "border-l-2 border-border/70",
                      )}
                      data-testid={`th-${col.key}`}
                    >
                      <span className="flex items-center justify-end gap-0.5">
                        {col.label}
                        <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3 + activeCols.length}
                      className="px-4 py-10 text-center text-muted-foreground text-xs italic"
                      data-testid="no-results"
                    >
                      No players match your search.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => {
                    const rank = row.rank as number | undefined;
                    const name = String(row.playerName ?? row.player_name ?? row.name ?? "—");
                    const team = String(row.team ?? row.nfl_team ?? "—");
                    // Non-desktop shows "F. Last" (first initial + last name) to save
                    // space; falls back to the raw name when it isn't a simple
                    // two-part name.
                    const nameParts = name.trim().split(/\s+/);
                    const shortName = nameParts.length >= 2
                      ? `${nameParts[0][0]}. ${nameParts.slice(1).join(" ")}`
                      : name;
                    // Opaque background for the sticky (frozen) cells so scrolled
                    // columns never show through behind the rank/player text.
                    const stickyBg = idx % 2 === 1
                      ? "linear-gradient(hsl(var(--muted) / 0.7), hsl(var(--muted) / 0.7)), hsl(var(--card))"
                      : "hsl(var(--card))";
                    return (
                      <tr
                        key={`${rank ?? idx}-${name}`}
                        className={cn(
                          "border-b border-border/15 hover:bg-[#0b3a7a]/5 transition-colors",
                          idx % 2 === 1 && "bg-muted/70",
                        )}
                        data-testid={`row-player-${idx}`}
                      >
                        {/* Rank */}
                        <td
                          style={{ background: stickyBg }}
                          className="sticky left-0 z-10 px-3 py-2 text-right font-mono text-[11px] text-muted-foreground/60 border-r border-border/25 w-10 min-w-[40px]"
                        >
                          {rank ?? idx + 1}
                        </td>
                        {/* Player name */}
                        <td
                          style={{ background: stickyBg }}
                          className="sticky left-10 z-10 px-3 py-2 font-semibold text-foreground whitespace-nowrap border-r border-border/25 min-w-[148px]"
                        >
                          {/* Desktop: full name. Non-desktop: "F. Last" + faint team. */}
                          <span className="hidden md:inline">{name}</span>
                          <span className="md:hidden">
                            {shortName}
                            <span className="ml-1.5 font-normal text-muted-foreground/60">{team}</span>
                          </span>
                        </td>
                        {/* Team badge (hidden on mobile — shown inline next to name) */}
                        <td className="hidden md:table-cell px-3 py-2 whitespace-nowrap border-r border-border/25">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-[#0b3a7a]/12 text-white dark:bg-blue-400/15 dark:text-white">
                            {team}
                          </span>
                        </td>
                        {/* Stat cells */}
                        {activeCols.map((col) => {
                          const raw = row[col.key];
                          const isEmpty = raw == null;
                          const isSorted = sortKey === col.key;
                          // Grade cells are bolded so they read as the headline
                          // numbers, but otherwise styled like any stat cell.
                          const isScore = scoreKeySet.has(col.key);
                          return (
                            <td
                              key={col.key}
                              className={cn(
                                "px-3 py-2 text-right tabular-nums whitespace-nowrap",
                                isSorted && "bg-[#d4af37]/[0.04]",
                                isScore && "font-semibold",
                                isEmpty
                                  ? "text-muted-foreground/30"
                                  : "text-foreground/90",
                                groupBoundaryKeys.has(col.key) && "border-l-2 border-border/70",
                              )}
                              data-testid={`cell-${col.key}-${idx}`}
                            >
                              {formatVal(raw, col.type)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          {rows.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border/25 bg-muted/10 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground/60">
                Showing {rows.length} player{rows.length !== 1 ? "s" : ""}
                {search ? ` matching "${search}"` : ""}
              </p>
              {activeCols.length === 0 && (
                <p className="text-[10px] text-amber-500/80 italic">
                  No stat columns visible — open Columns to add some.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
