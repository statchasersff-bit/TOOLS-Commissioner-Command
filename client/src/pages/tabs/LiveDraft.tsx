import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Trophy, Target, Radio, Zap, MessageSquare, Key, AlertTriangle, ChevronDown, ChevronUp, ArrowUp, ArrowDown, ArrowUpDown, X, Plus, Calendar, Clock, UserCircle, Search, Users, Check, Wifi, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { useAuth } from "@/contexts/AuthContext";
import { maskToken, DEV_JWT_KEY } from "@/lib/sleeperAuthToken";
import { detectLiveDrafts as detectLiveDraftsApi, fetchDraftBoard as fetchDraftBoardApi, fetchDraftState, getDraftQueue, getDraftAutopickers, updateDraftQueue as updateDraftQueueApi, fetchSleeperLeagueFull } from "@/lib/sleeperApi";
import { DraftPickConfirmModal, type DraftPickTarget } from "@/components/DraftPickConfirmModal";
import { useToast } from "@/hooks/use-toast";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import { useManagerIntel } from "@/contexts/ManagerIntelContext";
import type { DraftState, DraftUser, DraftPickNormalized, DraftAutopickerStatus } from "@/lib/sleeperApi";
import { ROOKIE_BOARD_2026_SF, ROOKIE_BOARD_2026_1QB } from "@/data/rookieBoard2026";
import { buildOptimalStarterIds } from "@/lib/lineupUtils";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableTh } from "@/components/SortableTh";
import type { Player as RosterPlayer } from "@/types";

// ── Normalized draft model — abstracted from raw Sleeper format ───────────────
// UI components consume DraftSummary only; never reference raw Sleeper shapes directly.
interface DraftSummary {
  id: string;
  leagueId: string;
  leagueName: string;
  leagueAvatar: string | null;
  status: "pre_draft" | "drafting" | "paused" | "complete";
  type: "snake" | "linear" | "auction";
  category: "rookie" | "startup" | "supplemental" | "unknown";
  season: string;
  rounds: number;
  teams: number;
  picksMade: number;
  totalPicks: number;
  /** 1-indexed current pick slot (= picksMade + 1 when live) */
  currentPickNumber: number;
  /** Picks until user's next turn — null when unknown or not live */
  picksAway: number | null;
  /** User's draft slot (1-indexed) — null if unknown */
  mySlot: number | null;
  /** Unix ms scheduled start — null for active or no schedule */
  startTime: number | null;
  /** Seconds per pick timer — null if untimed */
  timerSeconds: number | null;
  /** True when the upcoming draft has its slot order assigned */
  draftOrderSet: boolean;
  isMyTurn: boolean;
  isLive: boolean;
  isUpcoming: boolean;
  isCompleted: boolean;
  isPaused: boolean;
}

// ── Draft classification helpers ─────────────────────────────────────────────
// Single source of truth for "is this draft live / upcoming / done". UI uses
// these instead of inspecting status strings inline. Keep them lenient — Sleeper
// returns the same status field in slightly different shapes across endpoints.

export function isLiveDraft(d: {
  status: string;
  picksMade?: number;
  totalPicks?: number;
}): boolean {
  const s = (d.status ?? "").toLowerCase();
  if (s === "drafting" || s === "paused") return true;
  // Treat "has picks but not complete" as live too — covers edge cases where
  // Sleeper's status field lags behind the first pick.
  if (s !== "complete" && (d.picksMade ?? 0) > 0 && (d.totalPicks ?? 0) > 0) {
    return d.picksMade! < d.totalPicks!;
  }
  return false;
}

export function isUpcomingDraft(d: {
  status: string;
  picksMade?: number;
  startTime?: number | null;
}): boolean {
  const s = (d.status ?? "").toLowerCase();
  if (s === "complete") return false;
  if (s === "drafting" || s === "paused") return false;
  if ((d.picksMade ?? 0) > 0) return false;
  if (s === "pre_draft") return true;
  // Treat a scheduled-future-but-no-picks draft as upcoming, even if the
  // status field is missing.
  if (d.startTime && d.startTime > Date.now()) return true;
  return false;
}

export function isCompletedDraft(d: {
  status: string;
  picksMade?: number;
  totalPicks?: number;
}): boolean {
  const s = (d.status ?? "").toLowerCase();
  if (s === "complete") return true;
  if ((d.totalPicks ?? 0) > 0 && (d.picksMade ?? 0) >= (d.totalPicks ?? 0)) {
    return true;
  }
  return false;
}

export interface DraftProgress {
  currentPick: number;
  totalPicks: number;
  currentRound: number;
  currentPickInRound: number;
  progressPct: number;
}

export function getDraftProgress(d: {
  picksMade: number;
  totalPicks: number;
  teams: number;
}): DraftProgress {
  const teams = Math.max(d.teams, 1);
  const currentPick = Math.min(d.picksMade + 1, Math.max(d.totalPicks, 1));
  const currentRound = Math.ceil(currentPick / teams);
  const currentPickInRound = ((currentPick - 1) % teams) + 1;
  const progressPct =
    d.totalPicks > 0 ? Math.min(100, Math.round((d.picksMade / d.totalPicks) * 100)) : 0;
  return { currentPick, totalPicks: d.totalPicks, currentRound, currentPickInRound, progressPct };
}

function getCategoryLabel(cat: DraftSummary["category"]): string {
  switch (cat) {
    case "rookie": return "Rookie";
    case "startup": return "Startup";
    case "supplemental": return "Supplemental";
    default: return "Draft";
  }
}

// Small uppercase pill shown next to the status badge so the lobby surfaces
// whether each card is a rookie / startup / supplemental / unknown draft at
// a glance.
function getCategoryBadge(cat: DraftSummary["category"]): { label: string; className: string } {
  switch (cat) {
    case "rookie":
      return { label: "ROOKIE", className: "bg-purple-500/15 text-purple-300 border border-purple-500/30" };
    case "startup":
      return { label: "STARTUP", className: "bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30" };
    case "supplemental":
      return { label: "SUPPL.", className: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30" };
    default:
      return { label: "UNKNOWN", className: "bg-muted/50 text-muted-foreground border border-border" };
  }
}
function getTypeLabel(type: DraftSummary["type"]): string {
  return type === "snake" ? "Snake" : type === "linear" ? "Linear" : "Auction";
}

function formatStartTime(ts: number): string {
  const diff = ts - Date.now();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Starting soon";
  if (mins < 60) return `Starts in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `Starts in ${hours}h ${remMins}m` : `Starts in ${hours}h`;
  return `Starts ${new Date(ts).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
}

/** Long-form date+time used in upcoming cards, e.g. "May 25, 2026 · 8:00 PM". */
function formatScheduledDateTime(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

// Normalizer: LiveDraftInfo → DraftSummary (populated after real scan)
function normalizeFromDetect(ld: LiveDraftInfo): DraftSummary {
  const status: DraftSummary["status"] =
    ld.status === "drafting" ? "drafting"
    : ld.status === "paused" ? "paused"
    : ld.status === "complete" ? "complete"
    : "pre_draft";
  const isLive = isLiveDraft({ status: ld.status, picksMade: ld.picksMade, totalPicks: ld.totalPicks });
  const isUpcoming = isUpcomingDraft({ status: ld.status, picksMade: ld.picksMade, startTime: ld.startTime });
  const isCompleted = isCompletedDraft({ status: ld.status, picksMade: ld.picksMade, totalPicks: ld.totalPicks });
  const category: DraftSummary["category"] =
    ld.draftCategory === "rookie" ? "rookie"
    : ld.draftCategory === "startup" ? "startup"
    : ld.draftCategory === "supplemental" ? "supplemental"
    : "unknown";
  return {
    id: ld.draftId,
    leagueId: ld.leagueId,
    leagueName: ld.leagueName,
    leagueAvatar: ld.leagueAvatar ?? null,
    status,
    type: (["snake", "linear", "auction"].includes(ld.type) ? ld.type : "snake") as DraftSummary["type"],
    category,
    season: ld.season,
    rounds: ld.rounds,
    teams: ld.teams,
    picksMade: ld.picksMade,
    totalPicks: ld.totalPicks,
    currentPickNumber: ld.picksMade + 1,
    picksAway: typeof ld.picksAway === "number" ? ld.picksAway : null,
    mySlot: typeof ld.mySlot === "number" ? ld.mySlot : null,
    startTime: ld.startTime ?? null,
    timerSeconds: null,
    draftOrderSet: ld.draftOrderSet ?? false,
    isMyTurn: isLive && ld.picksAway === 0,
    isLive,
    isUpcoming,
    isCompleted,
    isPaused: ld.status === "paused",
  };
}

// Mock drafts — placeholder until final Sleeper draft GraphQL endpoints are confirmed
function getMockDraftSummaries(): DraftSummary[] {
  const now = Date.now();
  return [
    {
      id: "mock-active-1", leagueId: "mock-lg-1", leagueName: "Apex Dynasty 2026",
      leagueAvatar: null, status: "drafting", type: "snake", category: "rookie",
      season: "2026", rounds: 5, teams: 12, picksMade: 23, totalPicks: 60,
      currentPickNumber: 24, picksAway: 0, mySlot: 12, startTime: null,
      timerSeconds: 90, draftOrderSet: true, isMyTurn: true, isLive: true,
      isUpcoming: false, isCompleted: false, isPaused: false,
    },
    {
      id: "mock-active-2", leagueId: "mock-lg-2", leagueName: "StatChasers Main",
      leagueAvatar: null, status: "drafting", type: "snake", category: "startup",
      season: "2026", rounds: 24, teams: 10, picksMade: 143, totalPicks: 240,
      currentPickNumber: 144, picksAway: 3, mySlot: 5, startTime: null,
      timerSeconds: 120, draftOrderSet: true, isMyTurn: false, isLive: true,
      isUpcoming: false, isCompleted: false, isPaused: false,
    },
    {
      id: "mock-upcoming-1", leagueId: "mock-lg-3", leagueName: "Winners Only Dynasty",
      leagueAvatar: null, status: "pre_draft", type: "snake", category: "rookie",
      season: "2026", rounds: 5, teams: 12, picksMade: 0, totalPicks: 60,
      currentPickNumber: 0, picksAway: null, mySlot: 7,
      startTime: now + 2.5 * 3600 * 1000, timerSeconds: 60, draftOrderSet: true,
      isMyTurn: false, isLive: false, isUpcoming: true, isCompleted: false, isPaused: false,
    },
    {
      id: "mock-upcoming-2", leagueId: "mock-lg-4", leagueName: "The Dynasty Files",
      leagueAvatar: null, status: "pre_draft", type: "linear", category: "startup",
      season: "2026", rounds: 24, teams: 14, picksMade: 0, totalPicks: 336,
      currentPickNumber: 0, picksAway: null, mySlot: 3,
      startTime: now + 27 * 3600 * 1000, timerSeconds: null, draftOrderSet: false,
      isMyTurn: false, isLive: false, isUpcoming: true, isCompleted: false, isPaused: false,
    },
  ];
}

interface DraftPick {
  round: number;
  pickNo: number;
  draftSlot: number;
  rosterId: number;
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
  pickedAt: number | null;
  isAutoPick: boolean;
}

interface DraftInfo {
  draftId: string;
  status: string;
  type: string;
  draftCategory: string;
  rounds: number;
  teams: number;
  season: string;
  leagueName: string;
  startTime: number | null;
  pickTimer: number;          // Seconds — 0 means no timer (slow draft).
  lastPicked: number | null;  // Unix ms — null until the first pick lands.
}

interface DraftSlot {
  slot: number;
  rosterId: number;
  displayName: string;
  /** Sleeper avatar HASH (not a URL). Null when the slot's owner can't
   *  be resolved or doesn't have a configured avatar. */
  avatar: string | null;
}

interface DraftPickOwner {
  round: number;
  slot: number;
  originalRosterId: number;
  currentRosterId: number;
  isTraded: boolean;
  currentUserId: string | null;
  currentDisplayName: string;
  currentAvatar: string | null;
  originalDisplayName: string;
  originalAvatar: string | null;
}

interface DraftResponse {
  draft: DraftInfo | null;
  picks: DraftPick[];
  players: Record<string, { name: string; pos: string; team: string }>;
  draftSlots: DraftSlot[];
  /** Per-(round, slot) current owner with traded-pick awareness. Empty array
   *  while loading or when the league has no traded picks for this season. */
  pickOwners: DraftPickOwner[];
  error: string | null;
}

interface LiveDraftInfo {
  leagueId: string;
  leagueName: string;
  leagueAvatar?: string | null;
  draftId: string;
  status: string;
  type: string;
  draftCategory: string;
  season: string;
  rounds: number;
  teams: number;
  picksMade: number;
  totalPicks: number;
  startTime?: number | null;
  draftOrderSet?: boolean;
  /** Whether the draft's league is a Sleeper dynasty league (settings.type=2).
   *  Used by Live Draft to surface fresh startup leagues whose roster has no
   *  players yet — those don't make it into the global dynasty league list. */
  isDynasty?: boolean;
  /** User's 1-indexed slot in this draft, or null when not yet set. */
  mySlot?: number | null;
  /** Picks remaining until the user is on the clock. 0 = on the clock,
   *  null = unknown / not applicable (auction, slot unknown). */
  picksAway?: number | null;
}

interface DraftMessage {
  message_id: string;
  author_is_bot: boolean;
  created: number;
  text: string;
}

interface ParsedPick {
  message_id: string;
  round: number;
  pickInRound: number;
  displayPick: string;
  playerName: string;
  position: string;
  team: string;
  forced: boolean;
  created: number;
}

// DEV_JWT_KEY imported from @/lib/sleeperAuthToken — used only as dev fallback.

// Flexible pick regex — handles all known Sleeper bot message formats:
//   "Pick 1.2 - Pick: Carnell Tate (WR - TEN)"
//   "Pick 1.02 - Pick: Carnell Tate (WR - TEN)"
//   "Pick 1.2: Carnell Tate (WR - TEN)"
//   "Pick 1.2 - Pick: Carnell Tate"        ← no position/team suffix
//   "Pick 1.02 - Pick: Carnell Tate"
const PICK_RE = /^Pick\s+(\d+)\.(\d+)\s*(?:-\s*Pick:|:)\s+(.*?)(?:\s*\((\w+)\s*-\s*(\w+)\))?$/i;
const FORCED_RE = /^Pick\s+(\d+)\.(\d+)\s*-\s*(?:Commish\s+)?forced\s+pick:\s+(.*?)(?:\s*\((\w+)\s*-\s*(\w+)\))?$/i;

function parsePickMessage(msg: DraftMessage): ParsedPick | null {
  const forced = FORCED_RE.exec(msg.text);
  if (forced) {
    const round = Number(forced[1]);
    const pickInRound = Number(forced[2]);
    return {
      message_id: msg.message_id, round, pickInRound,
      displayPick: `${round}.${String(pickInRound).padStart(2, "0")}`,
      playerName: forced[3]?.trim() ?? "", position: forced[4] ?? "", team: forced[5] ?? "",
      forced: true, created: msg.created,
    };
  }
  const normal = PICK_RE.exec(msg.text);
  if (normal) {
    const round = Number(normal[1]);
    const pickInRound = Number(normal[2]);
    return {
      message_id: msg.message_id, round, pickInRound,
      displayPick: `${round}.${String(pickInRound).padStart(2, "0")}`,
      playerName: normal[3]?.trim() ?? "", position: normal[4] ?? "", team: normal[5] ?? "",
      forced: false, created: msg.created,
    };
  }
  return null;
}

async function fetchDraftMessages(draftId: string, jwt?: string | null): Promise<DraftMessage[]> {
  const headers: Record<string, string> = {
    "x-sleeper-graphql-op": "messages",
    "content-type": "application/json",
  };
  if (jwt) headers["authorization"] = jwt;
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `query messages { messages(parent_id: "${draftId}") { message_id author_is_bot created text } }`,
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = await res.json();
  return (json?.data?.messages as DraftMessage[]) || [];
}

// Delegates to the exported getDraftQueue (sleeperGraphql helper, proper $draft_id variable)
async function fetchDraftQueue(draftId: string, jwt: string): Promise<string[]> {
  return getDraftQueue(jwt, draftId);
}

// Delegates to exported updateDraftQueue (sleeperGraphql helper, proper variables).
// Sleeper replaces the ENTIRE queue — always send the full desired player_ids array.
async function updateDraftQueue(draftId: string, playerIds: string[], jwt: string): Promise<string[]> {
  return updateDraftQueueApi(jwt, draftId, playerIds);
}

const POS_CELL_BG: Record<string, string> = {
  QB: "bg-red-500/25 dark-any:bg-red-500/30 border-red-500/40 text-red-900 dark-any:text-red-200",
  RB: "bg-emerald-500/25 dark-any:bg-emerald-500/30 border-emerald-500/40 text-emerald-900 dark-any:text-emerald-200",
  WR: "bg-blue-500/25 dark-any:bg-blue-500/30 border-blue-500/40 text-blue-900 dark-any:text-blue-200",
  TE: "bg-orange-500/25 dark-any:bg-orange-500/30 border-orange-500/40 text-orange-900 dark-any:text-orange-200",
  K: "bg-purple-500/20 dark-any:bg-purple-500/25 border-purple-500/30 text-purple-900 dark-any:text-purple-200",
  DEF: "bg-slate-500/20 dark-any:bg-slate-500/25 border-slate-500/30 text-slate-900 dark-any:text-slate-200",
};

const POS_CELL_PROJECTION: Record<string, string> = {
  QB: "bg-red-500/8 dark-any:bg-red-500/10 border-red-500/15 text-red-800/60 dark-any:text-red-300/50",
  RB: "bg-emerald-500/8 dark-any:bg-emerald-500/10 border-emerald-500/15 text-emerald-800/60 dark-any:text-emerald-300/50",
  WR: "bg-blue-500/8 dark-any:bg-blue-500/10 border-blue-500/15 text-blue-800/60 dark-any:text-blue-300/50",
  TE: "bg-orange-500/8 dark-any:bg-orange-500/10 border-orange-500/15 text-orange-800/60 dark-any:text-orange-300/50",
  K: "bg-purple-500/5 dark-any:bg-purple-500/8 border-purple-500/10 text-purple-800/50 dark-any:text-purple-300/40",
  DEF: "bg-slate-500/5 dark-any:bg-slate-500/8 border-slate-500/10 text-slate-800/50 dark-any:text-slate-300/40",
};

const POS_BADGE_SM: Record<string, string> = {
  QB: "text-red-600 dark:text-red-400",
  RB: "text-emerald-600 dark:text-emerald-400",
  WR: "text-blue-600 dark:text-blue-400",
  TE: "text-orange-600 dark:text-orange-400",
};

// Compact "Time Left" stat block — used by both header variants. Colour
// scales with urgency: muted gray when no timer, foreground default,
// amber under 60s, red under 30s. Hidden when the draft has no timer
// configured AND we shouldn't even reserve space — caller decides.
function TimerStatBlock({ timer, testid = "stat-time-left" }: { timer: TimerInfo; testid?: string }) {
  const urgent = timer.available && !timer.expired && timer.remainingMs < 30_000;
  const warning = timer.available && !timer.expired && timer.remainingMs < 60_000 && timer.remainingMs >= 30_000;
  const valueClass = !timer.available
    ? "text-muted-foreground"
    : timer.expired
      ? "text-red-500"
      : urgent
        ? "text-red-500"
        : warning
          ? "text-amber-500 dark:text-amber-400"
          : "text-foreground";
  return (
    <div className="text-center shrink-0 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30 min-w-[84px]" data-testid={testid}>
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Time Left</p>
      <p
        className={cn(
          "text-xl font-bold tabular-nums leading-tight",
          valueClass,
          urgent && "animate-pulse",
        )}
        data-testid={`${testid}-value`}
      >
        {timer.label}
      </p>
    </div>
  );
}

// CurrentPickInfo — computed from DraftState for "on the clock" display
interface CurrentPickInfo {
  nextPickNo: number;
  currentRound: number;
  pickInRound: number;
  currentUserId: string | null;
  currentUser: DraftUser | null;
  picksAway: number;
  totalPicks: number;
  picksRemaining: number;
  isMyTurn: boolean;
}

// TimerInfo — derived in LiveDraft (ticks every second), passed into headers
// so the live MM:SS countdown can render with the proper urgency styling.
interface TimerInfo {
  /** false when the draft has no `pick_timer` set, or we can't anchor a base time. */
  available: boolean;
  /** "MM:SS" when available; "Expired" when expired; "No timer" / "Timer unavailable" otherwise. */
  label: string;
  remainingMs: number;
  expired: boolean;
}

// ── DraftCard ─────────────────────────────────────────────────────────────────
function DraftCard({ draft, onTrack }: { draft: DraftSummary; onTrack?: () => void }) {
  const progress = getDraftProgress({ picksMade: draft.picksMade, totalPicks: draft.totalPicks, teams: draft.teams });
  const pct = progress.progressPct;
  const meta = [
    getCategoryLabel(draft.category),
    getTypeLabel(draft.type),
    `${draft.teams}T`,
    `${draft.rounds}R`,
  ].join(" · ");

  // Determine status badge — LIVE / PAUSED / UPCOMING.
  // When the draft is live AND the user is on the clock (0) or within
  // 4 picks of it, replace the generic "LIVE" pill with an urgency-tinted
  // "YOUR PICK" / "N PICKS AWAY" pill so the dashboard surfaces actionable
  // drafts at a glance.
  const picksAwayNear =
    draft.isLive &&
    !draft.isPaused &&
    typeof draft.picksAway === "number" &&
    draft.picksAway >= 1 &&
    draft.picksAway <= 4;
  const isOnClock = draft.isLive && !draft.isPaused && draft.picksAway === 0;
  const statusBadge = draft.isPaused
    ? { label: "PAUSED", className: "bg-amber-500 text-black" }
    : isOnClock
      ? { label: "YOUR PICK", className: "bg-[#d4af37] text-[#0b3a7a]" }
      : picksAwayNear
        ? {
            label: `${draft.picksAway} ${draft.picksAway === 1 ? "PICK" : "PICKS"} AWAY`,
            className: "bg-amber-500 text-black",
          }
        : draft.isLive
          ? { label: "LIVE", className: "bg-emerald-500 text-white" }
          : draft.isUpcoming
            ? { label: "UPCOMING", className: "bg-blue-500 text-white" }
            : { label: "COMPLETE", className: "bg-muted text-muted-foreground" };

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all hover:border-[#d4af37]/30 hover:shadow-sm",
        // Live drafts get a subtle green accent so users can pick them out
        // of a mixed live/upcoming list at a glance. On-the-clock cards
        // override this with the gold "my turn" treatment.
        draft.isLive && !draft.isPaused && !draft.isMyTurn &&
          "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.08)] hover:border-emerald-500/60",
        draft.isMyTurn && "border-[#d4af37]/60 shadow-[0_0_0_1px_rgba(212,175,55,0.1)]"
      )}
      data-testid={`draft-card-${draft.id}`}
    >
      {draft.isMyTurn && (
        <div className="h-0.5 w-full bg-gradient-to-r from-[#d4af37]/30 via-[#d4af37] to-[#d4af37]/30" />
      )}
      <div className="p-4 space-y-3">
        {/* Identity + status badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center shrink-0 border border-[#0b3a7a]/15 dark:border-blue-400/15">
              {draft.leagueAvatar ? (
                <img src={`https://sleepercdn.com/avatars/thumbs/${draft.leagueAvatar}`} className="w-full h-full rounded-lg object-cover" alt="" />
              ) : (
                <Trophy className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate" data-testid={`text-draft-name-${draft.id}`}>{draft.leagueName}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{meta}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {(() => {
              const cat = getCategoryBadge(draft.category);
              return (
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider",
                    cat.className,
                  )}
                  data-testid={`badge-category-${draft.id}`}
                >
                  {cat.label}
                </span>
              );
            })()}
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold",
                statusBadge.className,
              )}
              data-testid={`badge-status-${draft.id}`}
            >
              {/* Pulse dot is only meaningful on the generic green LIVE pill;
                  the YOUR PICK / N PICKS AWAY variants are already attention-
                  grabbing on their own. */}
              {draft.isLive && !draft.isPaused && !isOnClock && !picksAwayNear && (
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              )}
              {statusBadge.label}
            </span>
            {/* Secondary "N away" chip — only when the main pill doesn't
                already convey it (i.e. picksAway > 4). */}
            {draft.isLive && typeof draft.picksAway === "number" && draft.picksAway > 4 && (
              <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] border border-amber-500/40 text-amber-600 dark:text-amber-400" data-testid={`badge-picks-away-${draft.id}`}>
                {draft.picksAway} away
              </span>
            )}
          </div>
        </div>

        {/* Progress bar — live */}
        {draft.isLive && (
          <div className="space-y-1">
            <div className="w-full h-1.5 bg-muted/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#0b3a7a] to-[#d4af37] rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span data-testid={`text-pick-progress-${draft.id}`}>Pick {progress.currentPick} of {progress.totalPicks}</span>
              <span>Round {progress.currentRound} · Pick {progress.currentPickInRound}</span>
            </div>
            {draft.timerSeconds != null && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" />{draft.timerSeconds}s/pick
              </div>
            )}
          </div>
        )}

        {/* Scheduled start time — upcoming */}
        {draft.isUpcoming && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-foreground">
              <Calendar className="w-3.5 h-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
              {draft.startTime != null ? (
                <span className="font-medium" data-testid={`text-start-time-${draft.id}`}>
                  Starts {formatScheduledDateTime(draft.startTime)}
                </span>
              ) : (
                <span className="italic text-muted-foreground" data-testid={`text-no-start-time-${draft.id}`}>
                  Start time not set
                </span>
              )}
            </div>
            {draft.startTime != null && draft.startTime > Date.now() && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground pl-5">
                <Clock className="w-3 h-3" />
                <span data-testid={`text-countdown-${draft.id}`}>{formatStartTime(draft.startTime)}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pl-5">
              <span
                className={cn(
                  "inline-block w-1.5 h-1.5 rounded-full",
                  draft.draftOrderSet ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <span data-testid={`text-order-${draft.id}`}>
                {draft.draftOrderSet ? "Draft order set" : "Draft order not set"}
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-0.5">
          {draft.mySlot != null ? (
            <span className="text-[11px] text-muted-foreground">Slot {draft.mySlot}</span>
          ) : <span />}
          <Button
            size="sm"
            className={cn(
              "h-7 text-xs gap-1.5",
              draft.isMyTurn
                ? "bg-[#d4af37] hover:bg-[#d4af37]/90 text-[#0b3a7a] font-bold"
                : draft.isLive
                  ? "bg-[#0b3a7a] hover:bg-[#0b3a7a]/80 text-white"
                  : "bg-blue-600 hover:bg-blue-600/80 text-white"
            )}
            onClick={onTrack}
            data-testid={`button-track-${draft.id}`}
          >
            <Target className="w-3.5 h-3.5" />
            {draft.isMyTurn ? "Pick Now" : draft.isLive ? "Track" : "Preview"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── DraftsDashboard ────────────────────────────────────────────────────────────
function DraftsDashboard({
  mockDrafts, realDrafts, isLoading, hasScanned, scanError, onRefresh, onTrack, isConnected,
}: {
  mockDrafts: DraftSummary[];
  realDrafts: DraftSummary[];
  isLoading: boolean;
  hasScanned: boolean;
  scanError: string | null;
  onRefresh?: () => void;
  onTrack: (d: DraftSummary) => void;
  isConnected: boolean;
}) {
  const isMock = realDrafts.length === 0;
  const displayDrafts = isMock ? mockDrafts : realDrafts;
  // Use classification helpers — single source of truth for which bucket
  // each draft falls into.
  const active = displayDrafts.filter(d =>
    isLiveDraft({ status: d.status, picksMade: d.picksMade, totalPicks: d.totalPicks })
  );
  const upcoming = displayDrafts.filter(d =>
    isUpcomingDraft({ status: d.status, picksMade: d.picksMade, startTime: d.startTime })
  );
  // Sort upcoming by scheduled start time (no-start-time items last)
  const upcomingSorted = [...upcoming].sort((a, b) => {
    const aT = a.startTime ?? Number.MAX_SAFE_INTEGER;
    const bT = b.startTime ?? Number.MAX_SAFE_INTEGER;
    return aT - bT;
  });

  // Next-draft hint — earliest upcoming with a real start time
  const nextDraftTs = upcomingSorted.find(d => d.startTime != null)?.startTime ?? null;

  return (
    <div className="space-y-5" data-testid="drafts-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h3 className="text-base font-bold text-foreground">Your Drafts</h3>
          {active.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25" data-testid="badge-active-count">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {active.length} Live
            </span>
          )}
          {isMock && (
            <span className="text-[10px] text-muted-foreground/50 italic" data-testid="text-mock-indicator">
              {isConnected ? "Scanning…" : "Demo · connect Sleeper to see real drafts"}
            </span>
          )}
        </div>
        {onRefresh && (
          <Button variant="outline" size="sm" className="h-8 px-2.5 shrink-0" onClick={onRefresh} disabled={isLoading} data-testid="button-refresh-drafts">
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>

      {scanError && <p className="text-xs text-red-500" data-testid="text-scan-error">{scanError}</p>}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" data-testid="grid-summary-cards">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3" data-testid="summary-live">
          <div className="flex items-center gap-1.5">
            <Radio className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Live</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5" data-testid="text-summary-live-count">{active.length}</p>
        </div>
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3" data-testid="summary-upcoming">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3 text-blue-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">Upcoming</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5" data-testid="text-summary-upcoming-count">{upcoming.length}</p>
        </div>
        <div className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-3" data-testid="summary-next">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-[#d4af37]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">Next Draft</span>
          </div>
          <p className="text-xs font-semibold text-foreground mt-1 leading-tight" data-testid="text-summary-next">
            {nextDraftTs ? formatStartTime(nextDraftTs) : "—"}
          </p>
        </div>
      </div>

      {/* Live Now */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Live Now</span>
          <span className="text-[10px] text-muted-foreground">({active.length})</span>
          <span className="flex-1 h-px bg-border/40" />
        </div>
        {active.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="grid-active-drafts">
            {active.map(d => <DraftCard key={d.id} draft={d} onTrack={() => onTrack(d)} />)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/40 px-4 py-6 text-center" data-testid="empty-live-drafts">
            <p className="text-xs text-muted-foreground">No drafts are currently live.</p>
          </div>
        )}
      </div>

      {/* Upcoming */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">Upcoming</span>
          <span className="text-[10px] text-muted-foreground">({upcoming.length})</span>
          <span className="flex-1 h-px bg-border/40" />
        </div>
        {upcomingSorted.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="grid-upcoming-drafts">
            {upcomingSorted.map(d => <DraftCard key={d.id} draft={d} onTrack={() => onTrack(d)} />)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/40 px-4 py-6 text-center" data-testid="empty-upcoming-drafts">
            <p className="text-xs text-muted-foreground">No upcoming drafts found.</p>
          </div>
        )}
      </div>

      {/* Full-empty state — only when real data has been scanned and is genuinely empty */}
      {active.length === 0 && upcoming.length === 0 && !isLoading && hasScanned && !isMock && (
        <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="drafts-empty">
          <Trophy className="w-8 h-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No active or upcoming Sleeper drafts found for this account.</p>
        </div>
      )}
    </div>
  );
}

// REST-only header used when the GraphQL draftState isn't available (e.g.
// the user is connected to Sleeper but hasn't pasted a JWT). Mirrors the
// shape of DraftStateHeader but reads only from the public draft endpoint.
function RestDraftHeader({ draft, picksMade, currentPickInfo, timerInfo }: {
  draft: DraftInfo;
  picksMade: number;
  currentPickInfo: CurrentPickInfo | null;
  timerInfo: TimerInfo;
}) {
  const totalPicks = draft.teams * draft.rounds;
  const pct = totalPicks > 0 ? Math.min(100, Math.round((picksMade / totalPicks) * 100)) : 0;
  const isLive = draft.status === "drafting";
  const isComplete = draft.status === "complete" || picksMade >= totalPicks;
  const typeLabel = draft.type === "linear" ? "Linear" : draft.type === "snake" ? "Snake" : draft.type;
  const isMyTurn = !!currentPickInfo?.isMyTurn;
  const pickLabel = currentPickInfo
    ? `${currentPickInfo.currentRound}.${String(currentPickInfo.pickInRound).padStart(2, "0")}`
    : "—";

  return (
    <Card
      className={cn(
        "overflow-hidden border-2",
        isMyTurn
          ? "border-[#d4af37]/70 shadow-[0_0_0_2px_rgba(212,175,55,0.15)]"
          : isLive
            ? "border-emerald-500/30"
            : "border-border/40",
      )}
      data-testid="rest-draft-header"
    >
      {isMyTurn && (
        <div className="h-1 w-full bg-gradient-to-r from-[#d4af37]/30 via-[#d4af37] to-[#d4af37]/30" />
      )}
      <CardContent className="pt-3 pb-3 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {isLive && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-white shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />LIVE
                </span>
              )}
              {isComplete && (
                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0">
                  Complete
                </span>
              )}
              <h3 className="text-base font-bold text-foreground truncate">
                {draft.leagueName || "Live Draft"}
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {draft.season} · {typeLabel} · {draft.teams}T · {draft.rounds}R
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pick</span>
              <span className="text-2xl sm:text-3xl font-extrabold text-foreground tabular-nums leading-none">{pickLabel}</span>
              <span className="text-[11px] text-muted-foreground">· {picksMade}/{totalPicks}</span>
              {currentPickInfo && typeof currentPickInfo.picksAway === "number" && (
                isMyTurn ? (
                  <span className="text-[11px] font-bold text-[#d4af37]" data-testid="text-pickline-your-pick">· YOUR PICK</span>
                ) : (
                  <span className="text-[11px] text-foreground tabular-nums" data-testid="text-pickline-picks-away">
                    · {currentPickInfo.picksAway} {currentPickInfo.picksAway === 1 ? "pick" : "picks"} away
                  </span>
                )
              )}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {pct}% · {currentPickInfo ? `${currentPickInfo.picksRemaining} left` : ""}
            </div>
          </div>
          {/* Your-pick countdown — surfaces picksAway directly under the
              progress bar so the user always knows how far away they are.
              Hidden when we couldn't resolve the user's slot in this draft. */}
          {currentPickInfo && typeof currentPickInfo.picksAway === "number" && (
            <div className="text-[11px] font-semibold" data-testid="text-picks-away">
              {isMyTurn ? (
                <span className="text-[#d4af37]">You're on the clock</span>
              ) : (
                <span className="text-muted-foreground">
                  Your next pick is{" "}
                  <span className="text-foreground tabular-nums">{currentPickInfo.picksAway}</span>{" "}
                  {currentPickInfo.picksAway === 1 ? "pick" : "picks"} away
                </span>
              )}
            </div>
          )}
          <div className="w-full h-2 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#0b3a7a] to-[#d4af37] rounded-full transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* On the clock + Time Left — matches DraftStateHeader so the JWT
            and REST paths render the same bottom row. Stacks on mobile via
            flex-wrap; right-aligned blocks on desktop. */}
        {isLive && currentPickInfo && (
          <div className="flex items-center gap-4 flex-wrap border-t border-border/30 pt-3">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <SleeperUserAvatar
                username={currentPickInfo.currentUser?.displayName || "—"}
                avatar={currentPickInfo.currentUser?.avatar ?? null}
                size="md"
                compact
              />
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">On the Clock</p>
                <p className="text-sm font-bold text-foreground truncate" data-testid="text-on-clock-rest">
                  {currentPickInfo.currentUser?.displayName || "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Pick {currentPickInfo.nextPickNo} · Rd {currentPickInfo.currentRound}
                </p>
              </div>
            </div>
            <TimerStatBlock timer={timerInfo} testid="stat-time-left-rest" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── DraftStateHeader ─────────────────────────────────────────────────────────
// OTC-style draft room header. Heavy emphasis on the current pick + on-the-
// clock identity. This is the top of the 3-section draft room layout.
function DraftStateHeader({ ds, currentPickInfo, draftStateLoading, myUserId, leagueId, timerInfo }: {
  ds: DraftState;
  currentPickInfo: CurrentPickInfo | null;
  draftStateLoading: boolean;
  myUserId: string | null;
  leagueId: string | null;
  timerInfo: TimerInfo;
}) {
  const { openManagerIntel } = useManagerIntel();
  const totalPicks = ds.teams * ds.rounds;
  const pct = totalPicks > 0 ? Math.min(100, Math.round((ds.picks.length / totalPicks) * 100)) : 0;
  const isLive = ds.status === "drafting";
  const isComplete = ds.status === "complete" || ds.picks.length >= totalPicks;
  const typeLabel = ds.type === "linear" ? "Linear" : ds.type === "snake" ? "Snake" : ds.type;
  const isMyTurn = !!currentPickInfo?.isMyTurn;

  // Format the current pick label as `R.PP` — the draft-room convention.
  const pickLabel = currentPickInfo
    ? `${currentPickInfo.currentRound}.${String(currentPickInfo.pickInRound).padStart(2, "0")}`
    : "—";

  return (
    <Card
      className={cn(
        "overflow-hidden border-2",
        isMyTurn
          ? "border-[#d4af37]/70 shadow-[0_0_0_2px_rgba(212,175,55,0.15),0_8px_24px_-12px_rgba(212,175,55,0.3)] animate-pulse-subtle"
          : isLive
            ? "border-emerald-500/30"
            : "border-border/40",
      )}
      data-testid="draft-state-header"
    >
      {isMyTurn && (
        <div className="h-1 w-full bg-gradient-to-r from-[#d4af37]/30 via-[#d4af37] to-[#d4af37]/30" />
      )}
      <CardContent className="pt-3 pb-3 space-y-2.5">
        {/* Identity row — name + status badges + board overlay dropdown */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {isLive && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-white shrink-0" data-testid="badge-state-live">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />LIVE
                </span>
              )}
              {isComplete && (
                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0" data-testid="badge-state-complete">
                  Complete
                </span>
              )}
              <h3 className="text-base font-bold text-foreground truncate" data-testid="text-draft-state-name">{ds.name}</h3>
              {draftStateLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {ds.season} · {typeLabel} · {ds.teams}T · {ds.rounds}R
            </p>
          </div>

        </div>

        {/* Pick + progress bar — bigger, more prominent */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pick</span>
              <span className="text-2xl sm:text-3xl font-extrabold text-foreground tabular-nums leading-none" data-testid="text-current-pick-label">{pickLabel}</span>
              <span className="text-[11px] text-muted-foreground">
                · {ds.picks.length}/{totalPicks}
              </span>
              {currentPickInfo && typeof currentPickInfo.picksAway === "number" && (
                isMyTurn ? (
                  <span className="text-[11px] font-bold text-[#d4af37]" data-testid="text-pickline-your-pick">· YOUR PICK</span>
                ) : (
                  <span className="text-[11px] text-foreground tabular-nums" data-testid="text-pickline-picks-away">
                    · {currentPickInfo.picksAway} {currentPickInfo.picksAway === 1 ? "pick" : "picks"} away
                  </span>
                )
              )}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {pct}% · {currentPickInfo ? `${currentPickInfo.picksRemaining} left` : ""}
            </div>
          </div>
          <div className="w-full h-2 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#0b3a7a] to-[#d4af37] rounded-full transition-all duration-700"
              style={{ width: `${pct}%` }}
              data-testid="text-state-picks-progress"
            />
          </div>
        </div>

        {/* On the clock + picks away + timer — live only */}
        {isLive && currentPickInfo && (
          <div className="flex items-center gap-4 flex-wrap border-t border-border/30 pt-3">
            {/* On the clock */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <SleeperUserAvatar
                username={currentPickInfo.currentUser?.displayName || "—"}
                avatar={currentPickInfo.currentUser?.avatar ?? null}
                size="md"
                compact
                onClick={
                  currentPickInfo.currentUser && !currentPickInfo.currentUser.isBot && leagueId
                    ? () => openManagerIntel({
                        userId: currentPickInfo.currentUser!.userId,
                        username: currentPickInfo.currentUser!.displayName,
                        avatar: currentPickInfo.currentUser!.avatar,
                        leagueId,
                      })
                    : undefined
                }
              />
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">On the Clock</p>
                {currentPickInfo.currentUser && !currentPickInfo.currentUser.isBot && leagueId ? (
                  <button
                    type="button"
                    onClick={() => openManagerIntel({
                      userId: currentPickInfo.currentUser!.userId,
                      username: currentPickInfo.currentUser!.displayName,
                      avatar: currentPickInfo.currentUser!.avatar,
                      leagueId,
                    })}
                    className="text-sm font-bold text-foreground truncate hover:text-[#d4af37] transition-colors block text-left"
                    data-testid="text-on-clock"
                  >
                    {currentPickInfo.currentUser.displayName}
                  </button>
                ) : (
                  <p className="text-sm font-bold text-foreground truncate" data-testid="text-on-clock">
                    {currentPickInfo.currentUser?.displayName || "—"}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">Pick {currentPickInfo.nextPickNo} · Rd {currentPickInfo.currentRound}</p>
              </div>
            </div>

            {/* Picks away */}
            {myUserId && (
              <div className="text-center shrink-0 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Picks Away</p>
                {currentPickInfo.isMyTurn ? (
                  <p className="text-sm font-bold text-[#d4af37]" data-testid="text-your-pick-now">YOUR PICK</p>
                ) : (
                  <p className="text-xl font-bold text-foreground tabular-nums" data-testid="text-picks-away-count">{currentPickInfo.picksAway}</p>
                )}
              </div>
            )}

            {/* Time Left — live MM:SS countdown. Ticks once per second from
                the parent's wall-clock interval; no per-second API refetch. */}
            <TimerStatBlock timer={timerInfo} testid="stat-time-left" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── DraftOrderDebugPanel ──────────────────────────────────────────────────────
// Dev-only diagnostic surface for the normalized Sleeper draft order. Renders
// the raw inputs (draft_order, slot_to_roster_id) side-by-side with the
// resolved view (slotToUserId, slotToUsername, currentPickNo/Slot/UserId/Username)
// so on-the-clock mismatches can be diagnosed in the browser without dropping
// into the network tab. Hidden in production via `import.meta.env.DEV`.
function DraftOrderDebugPanel({
  state,
  currentPickInfo,
}: {
  state: DraftState;
  currentPickInfo: CurrentPickInfo | null;
}) {
  const [open, setOpen] = useState(false);
  const n = state.normalizedOrder;
  const renderJson = (label: string, value: unknown) => (
    <div className="space-y-1">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <pre className="text-[10px] leading-tight font-mono bg-muted/20 border border-border/30 rounded p-2 overflow-x-auto max-h-40">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
  return (
    <Card data-testid="debug-draft-order" className="border-amber-500/30 bg-amber-500/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-amber-500/5"
        data-testid="button-toggle-debug-draft-order"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          Debug · Draft Order ({n.draftType}{n.isThirdRoundReversal ? " · 3RR" : ""})
        </span>
        <span className="text-[10px] text-muted-foreground">
          teams {n.teams} · pick {n.currentPickNo} · slot {n.currentSlot} · {n.currentUsername}
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <CardContent className="pt-2 pb-3 grid gap-3 md:grid-cols-2">
          {renderJson("raw draft.draft_order", state.draftOrderByUserId)}
          {renderJson("raw draft.slot_to_roster_id", state.slotToRosterIdRaw)}
          {renderJson("normalized slotToUserId", n.slotToUserId)}
          {renderJson("normalized slotToUsername", n.slotToUsername)}
          {renderJson("normalized slotToRosterId", n.slotToRosterId)}
          {renderJson("current pick", {
            currentPickNo: n.currentPickNo,
            currentSlot: n.currentSlot,
            currentUserId: n.currentUserId,
            currentUsername: n.currentUsername,
            currentPickInfo,
          })}
        </CardContent>
      )}
    </Card>
  );
}

// ── RecentPicksRail ───────────────────────────────────────────────────────────
function RecentPicksRail({ picks, usersById, teams }: {
  picks: DraftPickNormalized[];
  usersById: Record<string, DraftUser>;
  teams: number;
}) {
  const recent = [...picks].reverse().slice(0, 8);
  if (recent.length === 0) return null;

  const posStyle: Record<string, string> = {
    QB: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300",
    RB: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    WR: "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300",
    TE: "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300",
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }} data-testid="recent-picks-rail">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">Recent</span>
      {recent.map((pick) => {
        const pickUser = usersById[pick.pickedBy];
        const round = Math.ceil(pick.pickNo / teams);
        const pickInRound = ((pick.pickNo - 1) % teams) + 1;
        const lastName = pick.playerName.split(" ").slice(1).join(" ") || pick.playerName;
        const pStyle = posStyle[pick.position] || "bg-muted/20 border-border/30 text-muted-foreground";
        return (
          <div key={pick.pickNo} className={cn("shrink-0 flex flex-col gap-0.5 px-2 py-1.5 rounded-lg border min-w-[68px]", pStyle)} data-testid={`recent-pick-${pick.pickNo}`}>
            <span className="text-[8px] font-mono opacity-60">{round}.{String(pickInRound).padStart(2, "0")}</span>
            <span className="text-[10px] font-bold leading-tight truncate">{lastName}</span>
            <span className="text-[9px] opacity-70 leading-none">{pick.position}{pick.teamAbbr ? ` · ${pick.teamAbbr}` : ""}</span>
            {pickUser && (
              <span className="flex items-center gap-1 mt-0.5 min-w-0" title={pickUser.displayName}>
                <SleeperUserAvatar
                  username={pickUser.displayName}
                  avatar={pickUser.avatar}
                  size="xs"
                  compact
                />
                <span className="text-[8px] opacity-60 leading-none truncate">{pickUser.displayName}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── ManagerTimingsSection ─────────────────────────────────────────────────────
// Per-manager pick-timing breakdown. Each row collapses to a summary
// (rank · avatar+name · relative-time bar · total · picks · avg · longest) and
// expands to a per-pick table (Pick#, Rd.Pk, Player, Pos, Team, Time Used,
// Cumulative, Timestamp).
//
// Source data: the same `mergedPickHistory` the Draft Log uses. Per-pick
// `timeMs` comes from the JWT-backed draft-room message timeline; if not
// available, the row still appears but the time columns show "—".

type ManagerTimingEntry = {
  pickNo: number;
  round: number;
  pickInRound: number;
  playerName: string;
  position: string;
  teamAbbr: string;
  timeMs: number | null;
  cumulativeMs: number;
  timestamp: number | null;
};

type ManagerTimingStats = {
  userId: string;
  displayName: string;
  avatar: string | null;
  totalMs: number;
  picksCount: number;
  timedPicksCount: number;
  avgMs: number;
  longestMs: number;
  /** Shortest known on-the-clock interval (ms). `Infinity` until a timed
   *  pick is observed; consumers fall back to `null` when no timed picks
   *  exist for the manager. */
  shortestMs: number;
  picks: ManagerTimingEntry[];
};

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatPickTimestamp(ms: number | null | undefined): string {
  if (ms == null) return "Unavailable";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "Unavailable";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

type ManagerTimingSortKey = "avg" | "picks" | "total" | "longest";

const MANAGER_TIMING_SORT_LABEL: Record<ManagerTimingSortKey, string> = {
  avg: "Avg Time",
  picks: "Picks Made",
  total: "Total Time",
  longest: "Longest",
};

// Per-manager expanded pick timeline. Extracted into its own component so the
// sortable-table hook can run at the top level of each rendered instance
// (hooks can't be called inside the parent's managers.map callback). Defaults
// to pick-number ascending, matching the chronological order the picks are
// pre-sorted into by ManagerTimingsSection.
function ManagerPickTimeline({ userId, picks }: { userId: string; picks: ManagerTimingEntry[] }) {
  const { sorted, sortKey, sortDir, toggle } = useSortableTable(
    picks,
    {
      pickNo: (p) => p.pickNo,
      rdpk: (p) => p.pickNo,
      player: (p) => p.playerName,
      pos: (p) => p.position,
      team: (p) => p.teamAbbr,
      timeUsed: (p) => p.timeMs,
      cumulative: (p) => p.cumulativeMs,
      timestamp: (p) => p.timestamp,
    },
    { defaultKey: "pickNo", defaultDir: "asc" },
  );
  return (
    <table className="w-full text-[11px] min-w-[560px]">
      <thead>
        <tr className="text-left text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          <SortableTh sortKey="pickNo" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2 py-1.5 font-bold">Pick #</SortableTh>
          <SortableTh sortKey="rdpk" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2 py-1.5 font-bold">Rd.Pk</SortableTh>
          <SortableTh sortKey="player" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2 py-1.5 font-bold">Player</SortableTh>
          <SortableTh sortKey="pos" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2 py-1.5 font-bold">Pos</SortableTh>
          <SortableTh sortKey="team" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2 py-1.5 font-bold">Team</SortableTh>
          <SortableTh sortKey="timeUsed" activeKey={sortKey} dir={sortDir} onSort={toggle} align="right" className="px-2 py-1.5 font-bold text-right">Time Used</SortableTh>
          <SortableTh sortKey="cumulative" activeKey={sortKey} dir={sortDir} onSort={toggle} align="right" className="px-2 py-1.5 font-bold text-right">Cumulative</SortableTh>
          <SortableTh sortKey="timestamp" activeKey={sortKey} dir={sortDir} onSort={toggle} className="px-2 py-1.5 font-bold">Timestamp</SortableTh>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr
            key={`${userId}-${p.pickNo}`}
            className="border-t border-border/15 hover:bg-muted/20"
            data-testid={`manager-timing-pick-${userId}-${p.pickNo}`}
          >
            <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{p.pickNo || "—"}</td>
            <td className="px-2 py-1.5 tabular-nums text-foreground/80">
              {p.pickNo > 0 ? `${p.round}.${String(p.pickInRound).padStart(2, "0")}` : "—"}
            </td>
            <td className="px-2 py-1.5 font-medium text-foreground truncate max-w-[160px]">
              {p.playerName}
            </td>
            <td className="px-2 py-1.5 text-foreground/80">{p.position || "—"}</td>
            <td className="px-2 py-1.5 text-foreground/80">{p.teamAbbr || "—"}</td>
            <td className="px-2 py-1.5 tabular-nums text-right text-foreground/90">
              {formatDurationMs(p.timeMs)}
            </td>
            <td className="px-2 py-1.5 tabular-nums text-right text-muted-foreground">
              {p.timeMs == null ? "—" : formatDurationMs(p.cumulativeMs)}
            </td>
            <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
              {formatPickTimestamp(p.timestamp)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ManagerTimingsSection({ history, teams, livePickUserId, liveElapsedMs, hasToken, messagesError, onConnectSleeper }: {
  history: Array<{
    pick: DraftPickNormalized | null;
    timing: { timeMs: number; timeLabel: string } | null;
    user: DraftUser | null;
    isForced: boolean;
    timestamp: number | null;
  }>;
  teams: number;
  /** userId of the manager currently on the clock (from currentPickInfo). */
  livePickUserId?: string | null;
  /** Milliseconds elapsed for the current pick so far (updates every second). */
  liveElapsedMs?: number | null;
  /** Whether the auth-provided Sleeper token is available for timing data. */
  hasToken?: boolean;
  /** Non-null when draft messages failed to load (even with a token). */
  messagesError?: string | null;
  /** Triggers the app-level Sleeper connect / reconnect flow. */
  onConnectSleeper?: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sectionCollapsed, setSectionCollapsed] = useState(true);
  // Default = avg desc so the slowest managers (the ones holding up the
  // room) appear first. Spec: "Sort default by average pick time
  // descending so slowest managers are easy to identify."
  const [sortKey, setSortKey] = useState<ManagerTimingSortKey>("avg");

  const managers = useMemo<ManagerTimingStats[]>(() => {
    const byUser = new Map<string, ManagerTimingStats>();

    for (const entry of history) {
      const userId = entry.user?.userId ?? "_unknown";
      const displayName = entry.user?.displayName ?? "Unknown";
      const avatar = entry.user?.avatar ?? null;
      const pick = entry.pick;
      const pickNo = pick?.pickNo ?? 0;
      const round = pickNo > 0 ? Math.ceil(pickNo / Math.max(teams, 1)) : 0;
      const pickInRound = pickNo > 0 ? ((pickNo - 1) % Math.max(teams, 1)) + 1 : 0;
      const timeMs = entry.timing?.timeMs ?? null;

      let stats = byUser.get(userId);
      if (!stats) {
        stats = {
          userId,
          displayName,
          avatar,
          totalMs: 0,
          picksCount: 0,
          timedPicksCount: 0,
          avgMs: 0,
          longestMs: 0,
          shortestMs: Infinity,
          picks: [],
        };
        byUser.set(userId, stats);
      }

      const cumulativeMs = stats.totalMs + (timeMs ?? 0);
      stats.picks.push({
        pickNo,
        round,
        pickInRound,
        playerName: pick?.playerName ?? "—",
        position: pick?.position ?? "",
        teamAbbr: pick?.teamAbbr ?? "",
        timeMs,
        cumulativeMs,
        timestamp: entry.timestamp,
      });
      stats.picksCount += 1;
      if (timeMs != null) {
        stats.totalMs += timeMs;
        stats.timedPicksCount += 1;
        if (timeMs > stats.longestMs) stats.longestMs = timeMs;
        if (timeMs < stats.shortestMs) stats.shortestMs = timeMs;
      }
    }

    const list = Array.from(byUser.values());
    for (const stats of list) {
      stats.avgMs = stats.timedPicksCount > 0 ? stats.totalMs / stats.timedPicksCount : 0;
      stats.picks.sort((a, b) => a.pickNo - b.pickNo);
    }

    // Build the comparator from the active sort key. All sorts are
    // descending so the "most" of whatever the user is sorting by lands
    // at the top. Ties fall back to picksCount to keep the order stable
    // when a column has lots of zeros (no timing data yet).
    const compare = (a: ManagerTimingStats, b: ManagerTimingStats): number => {
      const primary = sortKey === "avg"     ? b.avgMs - a.avgMs
                    : sortKey === "picks"   ? b.picksCount - a.picksCount
                    : sortKey === "total"   ? b.totalMs - a.totalMs
                    : /* "longest" */         b.longestMs - a.longestMs;
      if (primary !== 0) return primary;
      return b.picksCount - a.picksCount;
    };
    return list.sort(compare);
  }, [history, teams, sortKey]);

  const maxTotal = managers.reduce((m, s) => {
    const t = s.userId === livePickUserId ? s.totalMs + (liveElapsedMs ?? 0) : s.totalMs;
    return Math.max(m, t);
  }, 0);
  const totalDraftMs = managers.reduce((sum, s) => sum + s.totalMs, 0) + (liveElapsedMs ?? 0);
  const hasAnyTiming = managers.some((m) => m.timedPicksCount > 0);
  const totalPicks = history.length;
  const timedPicks = history.reduce((n, e) => n + (e.timing?.timeMs != null ? 1 : 0), 0);
  // Why we might not have timings:
  //   - Sleeper's /draft/{id}/picks doesn't include picked_at for this draft
  //     (some draft types / older drafts / very fresh drafts).
  //   - Only one pick has been made and draft.start_time is 0 so the seed
  //     for 1.01 isn't available — at least one delta requires either a
  //     preceding pick or a non-zero draft start_time.
  //   - The user hasn't connected a Sleeper JWT, so the GraphQL message
  //     history (which carries the most reliable timing) isn't available.
  //
  // Four empty-state cases (per spec):
  //   A — no picks made yet
  //   B — picks made, no Sleeper auth token
  //   C — has token but messages errored
  //   D — timing loaded (not an empty state)
  const emptyStateLabel: string =
    totalPicks === 0
      ? "Timing will appear once the draft starts."  // Case A
      : !hasToken
        ? "Connect Sleeper to unlock pick timing."  // Case B
        : messagesError
          ? "Couldn't load draft timing."           // Case C
          : "Not enough timing data yet.";           // timing exists but no deltas yet

  if (managers.length === 0) return null;

  return (
    <Card data-testid="card-manager-timings" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setSectionCollapsed((c) => !c)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
        data-testid="button-toggle-manager-timings"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-4 h-4 text-[#d4af37] shrink-0" />
          <span className="text-sm font-semibold text-foreground">Time On The Clock</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">{managers.length}</Badge>
          {totalDraftMs > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              ({formatDurationMs(totalDraftMs)} total)
            </span>
          )}
          {!hasAnyTiming && (
            <span className="text-[10px] text-muted-foreground/70 truncate" data-testid="text-manager-time-empty">
              {emptyStateLabel}
            </span>
          )}
        </div>
        {sectionCollapsed
          ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {!sectionCollapsed && (
        <div className="border-t border-border/30">
          {/* Case A: no picks yet — quiet hint */}
          {totalPicks === 0 && (
            <div className="px-3 py-2.5 border-b border-border/20 text-[11px] text-muted-foreground/60" data-testid="notice-timing-no-picks">
              Timing will appear once the draft starts.
            </div>
          )}
          {/* Case B: picks made but no Sleeper token — CTA */}
          {totalPicks > 0 && !hasToken && (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-[#d4af37]/5 border-b border-[#d4af37]/20" data-testid="notice-timing-no-auth">
              <div className="flex items-start gap-2 min-w-0">
                <Key className="w-3.5 h-3.5 text-[#d4af37] shrink-0 mt-px" />
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Connect Sleeper to unlock pick timing from the draft log.
                </p>
              </div>
              {onConnectSleeper && (
                <button
                  onClick={onConnectSleeper}
                  className="shrink-0 h-6 px-2.5 text-[10px] font-semibold rounded-md bg-[#d4af37]/90 hover:bg-[#d4af37] text-[#0b3a7a] transition-colors whitespace-nowrap"
                  data-testid="button-timing-connect-sleeper"
                >
                  Connect Sleeper
                </button>
              )}
            </div>
          )}
          {/* Case C: has token but messages errored — reconnect CTA */}
          {totalPicks > 0 && hasToken && messagesError && (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-red-500/5 border-b border-red-500/20" data-testid="notice-timing-auth-error">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-px" />
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Couldn't load draft timing. Try reconnecting Sleeper.
                </p>
              </div>
              {onConnectSleeper && (
                <button
                  onClick={onConnectSleeper}
                  className="shrink-0 h-6 px-2.5 text-[10px] font-semibold rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap"
                  data-testid="button-timing-reconnect-sleeper"
                >
                  Reconnect Sleeper
                </button>
              )}
            </div>
          )}
          {/* Sort selector — small pill row above the table. All sorts run
              descending; picking a column moves it to the top. */}
          <div
            className="flex items-center gap-1.5 px-3 py-2 text-[10px] border-b border-border/20 bg-muted/10 overflow-x-auto scrollbar-hide"
            data-testid="manager-timings-sort"
          >
            <span className="font-bold uppercase tracking-wider text-muted-foreground shrink-0">Sort by</span>
            {(["avg", "picks", "total", "longest"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSortKey(k)}
                data-on={sortKey === k}
                data-testid={`button-sort-${k}`}
                className={cn(
                  "px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors",
                  sortKey === k
                    ? "bg-[#d4af37]/15 border-[#d4af37]/40 text-[#d4af37] font-semibold"
                    : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30",
                )}
              >
                {MANAGER_TIMING_SORT_LABEL[k]}
              </button>
            ))}
          </div>

          {/* Column header — desktop only */}
          <div
            className="hidden md:grid items-center gap-3 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/20 bg-muted/15 dark-any:bg-muted/8"
            style={{ gridTemplateColumns: "28px 1.4fr 1.2fr 70px 50px 70px 70px 70px 18px" }}
            data-testid="header-manager-timings"
          >
            <span>#</span>
            <span>Manager</span>
            <span>Total Time</span>
            <span className={cn("text-right", sortKey === "total"   && "text-[#d4af37]")}>Total</span>
            <span className={cn("text-right", sortKey === "picks"   && "text-[#d4af37]")}>Picks</span>
            <span className={cn("text-right", sortKey === "avg"     && "text-[#d4af37]")}>Avg</span>
            <span className={cn("text-right", sortKey === "longest" && "text-[#d4af37]")}>Longest</span>
            <span className="text-right">Shortest</span>
            <span />
          </div>

          <div className="divide-y divide-border/15">
            {managers.map((mgr, idx) => {
              const isExpanded = expandedId === mgr.userId;
              const displayMs = mgr.userId === livePickUserId ? mgr.totalMs + (liveElapsedMs ?? 0) : mgr.totalMs;
              const pct = maxTotal > 0 ? Math.max(2, Math.round((displayMs / maxTotal) * 100)) : 0;
              const isOnClock = !!livePickUserId && mgr.userId === livePickUserId && (liveElapsedMs ?? 0) > 0;
              return (
                <div key={mgr.userId} data-testid={`manager-timing-row-${mgr.userId}`}>
                  {/* Collapsed row */}
                  <button
                    type="button"
                    onClick={() => setExpandedId((cur) => (cur === mgr.userId ? null : mgr.userId))}
                    aria-expanded={isExpanded}
                    className={cn(
                      "w-full text-left hover:bg-muted/30 transition-colors",
                      isExpanded && "bg-muted/25",
                    )}
                    data-testid={`button-manager-timing-${mgr.userId}`}
                  >
                    {/* Desktop layout */}
                    <div
                      className="hidden md:grid items-center gap-3 px-3 py-2"
                      style={{ gridTemplateColumns: "28px 1.4fr 1.2fr 70px 50px 70px 70px 70px 18px" }}
                    >
                      <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{idx + 1}</span>
                      <span className="flex items-center gap-2 min-w-0">
                        <SleeperUserAvatar
                          username={mgr.displayName}
                          avatar={mgr.avatar}
                          size="sm"
                          compact
                        />
                        <span className="text-xs font-semibold text-foreground truncate">{mgr.displayName}</span>
                      </span>
                      <span className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <span
                          className="block h-full rounded-full bg-[#d4af37]/80"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className={cn("text-[11px] font-semibold tabular-nums text-right flex items-center justify-end gap-0.5", isOnClock ? "text-[#d4af37]" : "text-foreground")}>
                        {(mgr.timedPicksCount > 0 || isOnClock) ? formatDurationMs(displayMs) : "—"}
                        {isOnClock && <span className="text-[9px] font-bold animate-pulse">▶</span>}
                      </span>
                      <span className="text-[11px] tabular-nums text-foreground/80 text-right">
                        {mgr.picksCount}
                      </span>
                      <span className="text-[11px] tabular-nums text-foreground/80 text-right">
                        {formatDurationMs(mgr.timedPicksCount > 0 ? mgr.avgMs : null)}
                      </span>
                      <span className="text-[11px] tabular-nums text-foreground/80 text-right">
                        {formatDurationMs(mgr.timedPicksCount > 0 ? mgr.longestMs : null)}
                      </span>
                      <span className="text-[11px] tabular-nums text-foreground/80 text-right">
                        {mgr.timedPicksCount > 0 && mgr.shortestMs !== Infinity ? formatDurationMs(mgr.shortestMs) : "—"}
                      </span>
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 text-muted-foreground transition-transform",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </div>

                    {/* Mobile layout — two rows, compact */}
                    <div className="md:hidden px-3 py-2 space-y-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-bold tabular-nums text-muted-foreground w-5 shrink-0">
                          {idx + 1}
                        </span>
                        <SleeperUserAvatar
                          username={mgr.displayName}
                          avatar={mgr.avatar}
                          size="sm"
                          compact
                        />
                        <span className="text-xs font-semibold text-foreground truncate flex-1 min-w-0">
                          {mgr.displayName}
                        </span>
                        <ChevronDown
                          className={cn(
                            "w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                          <span
                            className="block h-full rounded-full bg-[#d4af37]/80"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className={cn("text-[10px] font-semibold tabular-nums flex items-center gap-0.5", isOnClock ? "text-[#d4af37]" : "text-foreground")}>
                          {(mgr.timedPicksCount > 0 || isOnClock) ? formatDurationMs(displayMs) : "—"}
                          {isOnClock && <span className="text-[9px] font-bold animate-pulse">▶</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums flex-wrap">
                        <span>Picks <span className="text-foreground/80 font-semibold">{mgr.picksCount}</span></span>
                        <span>Avg <span className="text-foreground/80 font-semibold">{formatDurationMs(mgr.timedPicksCount > 0 ? mgr.avgMs : null)}</span></span>
                        <span>Long <span className="text-foreground/80 font-semibold">{formatDurationMs(mgr.timedPicksCount > 0 ? mgr.longestMs : null)}</span></span>
                        <span>Short <span className="text-foreground/80 font-semibold">{mgr.timedPicksCount > 0 && mgr.shortestMs !== Infinity ? formatDurationMs(mgr.shortestMs) : "—"}</span></span>
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div
                      className="border-t border-border/20 bg-muted/10 px-2 py-2"
                      data-testid={`manager-timing-detail-${mgr.userId}`}
                    >
                      <div className="overflow-x-auto">
                        <ManagerPickTimeline userId={mgr.userId} picks={mgr.picks} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Manager time isn't returned as a first-class field by Sleeper —
              we derive it from consecutive pick timestamps (and the draft
              `start_time` for 1.01 when present). Make that transparent. */}
          <p
            className="px-3 py-2 text-[10px] text-muted-foreground/80 border-t border-border/20 bg-muted/10 leading-snug"
            data-testid="manager-timings-note"
          >
            Timing is based on Sleeper pick timestamps and may include paused time.
          </p>
        </div>
      )}
    </Card>
  );
}

// ── PlayersPanel ──────────────────────────────────────────────────────────────
// Expandable panel beneath the Manager Time card. Two tabs:
//   1) Available Players — searchable/filterable pool drawn from `fullBoard`
//      with a dedicated Dynasty Value column.
//   2) My Team — the user's current league roster (loaded from
//      fetchSleeperLeagueFull), independent of picks made in this draft.

type AvailablePoolPlayer = {
  sleeperId: string;
  name: string;
  pos: string;
  team: string;
  age?: number;
  value?: number;
};

type DraftPlayersIndex = Record<string, { name: string; pos: string; team: string }>;

const POS_CHIP_CLASS: Record<string, string> = {
  QB: "data-[on=true]:bg-red-500/20 data-[on=true]:text-red-600 dark-any:data-[on=true]:text-red-300 data-[on=true]:border-red-500/40",
  RB: "data-[on=true]:bg-emerald-500/20 data-[on=true]:text-emerald-600 dark-any:data-[on=true]:text-emerald-300 data-[on=true]:border-emerald-500/40",
  WR: "data-[on=true]:bg-blue-500/20 data-[on=true]:text-blue-600 dark-any:data-[on=true]:text-blue-300 data-[on=true]:border-blue-500/40",
  TE: "data-[on=true]:bg-orange-500/20 data-[on=true]:text-orange-600 dark-any:data-[on=true]:text-orange-300 data-[on=true]:border-orange-500/40",
  K: "data-[on=true]:bg-purple-500/20 data-[on=true]:text-purple-600 dark-any:data-[on=true]:text-purple-300 data-[on=true]:border-purple-500/40",
  DEF: "data-[on=true]:bg-slate-500/20 data-[on=true]:text-slate-600 dark-any:data-[on=true]:text-slate-300 data-[on=true]:border-slate-500/40",
};

const POS_TEXT_CLASS: Record<string, string> = {
  QB: "text-red-600 dark-any:text-red-400",
  RB: "text-emerald-600 dark-any:text-emerald-400",
  WR: "text-blue-600 dark-any:text-blue-400",
  TE: "text-orange-500 dark-any:text-orange-400",
  K: "text-purple-600 dark-any:text-purple-400",
  DEF: "text-slate-600 dark-any:text-slate-400",
};

function PosChip({
  label, active, onClick, pos,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Use the position colour palette when active. */
  pos?: string;
}) {
  const posClass = pos ? POS_CHIP_CLASS[pos] ?? "" : "";
  return (
    <button
      type="button"
      onClick={onClick}
      data-on={active}
      data-testid={`chip-pos-${label.toLowerCase()}`}
      className={cn(
        "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap",
        "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30",
        // Default-on style (used when no pos-specific class wins): teal accent.
        active && !posClass && "bg-[#3d8fe0]/15 text-[#3d8fe0] border-[#3d8fe0]/40 dark-any:bg-[#3d8fe0]/20",
        posClass,
      )}
    >
      {label}
    </button>
  );
}

type PlayersSortKey = "name" | "age" | "value" | "redraftValue";
type PlayersSortState = { key: PlayersSortKey; dir: "asc" | "desc" };

function comparePlayers(
  a: { name: string; age?: number; value?: number; redraftValue?: number },
  b: { name: string; age?: number; value?: number; redraftValue?: number },
  sort: PlayersSortState,
): number {
  const { key, dir } = sort;
  if (key === "name") {
    const cmp = (a.name || "").localeCompare(b.name || "");
    return dir === "asc" ? cmp : -cmp;
  }
  // Numeric: missing / non-positive values always sink to the bottom,
  // regardless of sort direction, so a partial dataset doesn't pile
  // empties at the top when ascending.
  const va = typeof a[key] === "number" && (a[key] as number) > 0 ? (a[key] as number) : null;
  const vb = typeof b[key] === "number" && (b[key] as number) > 0 ? (b[key] as number) : null;
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  return dir === "asc" ? va - vb : vb - va;
}

function PlayersSortHeader({
  label,
  sortKey,
  current,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: PlayersSortKey;
  current: PlayersSortState;
  onClick: (key: PlayersSortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = current.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      data-testid={`players-sort-${sortKey}`}
      className={cn(
        "flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider transition-colors hover:text-foreground",
        isActive ? "text-foreground" : "text-muted-foreground",
        align === "right" ? "justify-end ml-auto" : "justify-start",
      )}
    >
      {label}
      {isActive ? (
        current.dir === "asc"
          ? <ArrowUp className="w-2.5 h-2.5" />
          : <ArrowDown className="w-2.5 h-2.5" />
      ) : (
        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
      )}
    </button>
  );
}

function PlayersPanel({
  fullBoard,
  pickedPlayerIds,
  pickedPlayerNames,
  realIdResolver,
  realTeamResolver,
  myRoster,
  myRosterLoading,
  myRosterError,
  hasActiveLeague,
  isConnected,
  defaultOpen,
  rosterSlots,
  isStartupDraft,
  redraftValueBySleeperId,
}: {
  fullBoard: AvailablePoolPlayer[];
  pickedPlayerIds: Set<string>;
  pickedPlayerNames: Set<string>;
  /** Resolves a synthetic rookie_N id to a real Sleeper id when one exists,
   *  so PlayerAvatar can render real headshots in rookie drafts. */
  realIdResolver: (id: string, name: string, pos: string) => string;
  /** Resolves the rookie's NFL team from dynastyPlayerList when the board
   *  ships team="" (rookie board snapshot pre-dates the NFL draft). */
  realTeamResolver: (id: string, name: string, pos: string, fallbackTeam: string) => string;
  myRoster: RosterPlayer[] | null;
  myRosterLoading: boolean;
  myRosterError: string | null;
  hasActiveLeague: boolean;
  isConnected: boolean;
  defaultOpen: boolean;
  /** League roster_positions (starter slots only — bench/taxi/IR stripped).
   *  When provided alongside isStartupDraft, the My Team tab slots picks
   *  into the league's actual starting-lineup structure. */
  rosterSlots: string[] | null;
  /** When true, the My Team tab renders drafted picks slotted into the
   *  league lineup instead of the league roster (which is empty for a
   *  startup draft until it completes). */
  isStartupDraft: boolean;
  /** Lookup of redraft (in-season) values by Sleeper player ID. When
   *  provided (only for startup drafts), the Players section adds a
   *  Redraft column next to Dynasty, and My Team shows starter-redraft
   *  + dynasty totals at the top. Pass null to hide the column. */
  redraftValueBySleeperId: Record<string, number> | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<"available" | "my-team">("available");
  const [search, setSearch] = useState("");
  const [availFilter, setAvailFilter] = useState<"ALL" | "QB" | "RB" | "WR" | "TE" | "K" | "Rookies">("ALL");
  const [teamFilter, setTeamFilter] = useState<"ALL" | "QB" | "RB" | "WR" | "TE" | "K" | "DEF">("ALL");
  const [availSort, setAvailSort] = useState<PlayersSortState>({ key: "value", dir: "desc" });
  const [teamSort, setTeamSort] = useState<PlayersSortState>({ key: "value", dir: "desc" });

  const cycleSort = (current: PlayersSortState, key: PlayersSortKey): PlayersSortState => {
    if (current.key === key) {
      return { key, dir: current.dir === "asc" ? "desc" : "asc" };
    }
    return { key, dir: key === "name" ? "asc" : "desc" };
  };

  // Should the Redraft Value column appear? Only when we're in a startup
  // draft AND we actually have a redraft lookup with data in it.
  const showRedraftColumn =
    isStartupDraft &&
    !!redraftValueBySleeperId &&
    Object.keys(redraftValueBySleeperId).length > 0;

  // Attach redraft value to each row so the existing sort/render path
  // works uniformly without scattering lookups.
  const attachRedraft = useCallback(
    <T extends { sleeperId?: string; id?: string }>(p: T): T & { redraftValue?: number } => {
      const id = p.sleeperId ?? p.id ?? "";
      const r = id && redraftValueBySleeperId ? redraftValueBySleeperId[id] : undefined;
      return { ...p, redraftValue: typeof r === "number" && r > 0 ? r : undefined };
    },
    [redraftValueBySleeperId],
  );

  const availablePool = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = fullBoard.filter((p) => {
      if (pickedPlayerIds.has(p.sleeperId)) return false;
      if (pickedPlayerNames.has((p.name || "").toLowerCase().trim())) return false;
      if (availFilter === "Rookies") {
        const isRookieId = p.sleeperId.startsWith("rookie_");
        const isYoung = typeof p.age === "number" && p.age > 0 && p.age <= 22;
        if (!isRookieId && !isYoung) return false;
      } else if (availFilter !== "ALL") {
        if (p.pos !== availFilter) return false;
      }
      if (term && !p.name.toLowerCase().includes(term)) return false;
      return true;
    });
    const augmented = showRedraftColumn ? filtered.map(attachRedraft) : filtered;
    return [...augmented].sort((a, b) => comparePlayers(a, b, availSort));
  }, [fullBoard, pickedPlayerIds, pickedPlayerNames, availFilter, search, availSort, showRedraftColumn, attachRedraft]);

  const filteredRoster = useMemo(() => {
    if (!myRoster) return [] as RosterPlayer[];
    const base = teamFilter === "ALL" ? myRoster : myRoster.filter((p) => p.pos === teamFilter);
    const augmented = showRedraftColumn ? base.map(attachRedraft) : base;
    return [...augmented].sort((a, b) => comparePlayers(a, b, teamSort));
  }, [myRoster, teamFilter, teamSort, showRedraftColumn, attachRedraft]);

  // For startup drafts, split the drafted players into starters + bench
  // using the league's roster_positions so the My Team tab mirrors the
  // lineup structure the league will use post-draft. The same filter +
  // sort applied above is preserved for the bench section so user
  // interactions still work consistently.
  const startersBenchSplit = useMemo<{ starters: RosterPlayer[]; bench: RosterPlayer[] } | null>(() => {
    if (!isStartupDraft || !myRoster || !rosterSlots || rosterSlots.length === 0) return null;
    const starterIds = buildOptimalStarterIds(
      myRoster.map((p) => p.sleeperId ?? p.id),
      (id) => {
        const m = myRoster.find((p) => (p.sleeperId ?? p.id) === id);
        return m ? m.pos : null;
      },
      (id) => {
        const m = myRoster.find((p) => (p.sleeperId ?? p.id) === id);
        return m?.value ?? 0;
      },
      rosterSlots,
    );
    const starters = myRoster.filter((p) => starterIds.has(p.sleeperId ?? p.id));
    const bench = myRoster.filter((p) => !starterIds.has(p.sleeperId ?? p.id));
    return { starters, bench };
  }, [isStartupDraft, myRoster, rosterSlots]);

  // Starter totals for the My Team header: redraft (in-season starter
  // points) + dynasty (long-term asset value). When the roster split
  // isn't available we fall back to summing the whole roster — better
  // than showing zeros while the league shape loads.
  const myTeamTotals = useMemo<{ dynasty: number; redraft: number } | null>(() => {
    if (!isStartupDraft) return null;
    const source = startersBenchSplit?.starters ?? myRoster ?? [];
    if (source.length === 0) return { dynasty: 0, redraft: 0 };
    let dynasty = 0;
    let redraft = 0;
    for (const p of source) {
      if (typeof p.value === "number" && p.value > 0) dynasty += p.value;
      const id = p.sleeperId ?? p.id;
      const r = id && redraftValueBySleeperId ? redraftValueBySleeperId[id] : 0;
      if (typeof r === "number" && r > 0) redraft += r;
    }
    return { dynasty, redraft };
  }, [isStartupDraft, startersBenchSplit, myRoster, redraftValueBySleeperId]);

  const tabs: Array<{ id: "available" | "my-team"; label: string; count?: number }> = [
    { id: "available", label: "Available Players", count: availablePool.length },
    { id: "my-team", label: "My Team", count: myRoster?.length },
  ];

  return (
    <Card data-testid="card-players-panel" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
        data-testid="button-toggle-players-panel"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 text-[#d4af37] shrink-0" />
          <span className="text-sm font-semibold text-foreground">Players</span>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border/30">
          {/* Tabs */}
          <div className="flex items-center gap-1 px-2 pt-2 pb-1 overflow-x-auto scrollbar-hide" role="tablist">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  data-testid={`players-tab-${t.id}`}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors border",
                    active
                      ? "bg-[#3d8fe0] text-white border-[#3d8fe0] dark-any:bg-[#3d8fe0] dark-any:text-white dark-any:border-[#3d8fe0]"
                      : "bg-transparent text-muted-foreground border-border/30 hover:text-foreground hover:bg-muted/30",
                  )}
                >
                  {t.label}
                  {typeof t.count === "number" && (
                    <span
                      className={cn(
                        "text-[10px] tabular-nums rounded px-1",
                        active ? "bg-white/15" : "bg-muted/40 text-muted-foreground",
                      )}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="px-3 pb-3 pt-2">
            {tab === "available" && (
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search players…"
                    className="h-8 pl-7 text-xs"
                    data-testid="input-players-search"
                  />
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
                  {(["ALL", "QB", "RB", "WR", "TE", "K", "Rookies"] as const).map((f) => (
                    <PosChip
                      key={f}
                      label={f}
                      active={availFilter === f}
                      onClick={() => setAvailFilter(f)}
                      pos={f === "ALL" || f === "Rookies" ? undefined : f}
                    />
                  ))}
                </div>

                {/* Column header — desktop only. Columns are sortable; click
                    a header to cycle sort direction (asc ⇄ desc). When the
                    Redraft column is shown (startup drafts), the grid uses
                    a 4-column template instead of 3. */}
                {(() => {
                  const gridCols = showRedraftColumn
                    ? "minmax(0,1fr) 50px 78px 78px"
                    : "minmax(0,1fr) 50px 90px";
                  return (
                    <div
                      className="hidden md:grid items-center gap-2 px-2 py-1 border-b border-border/20"
                      style={{ gridTemplateColumns: gridCols }}
                    >
                      <PlayersSortHeader
                        label="Player"
                        sortKey="name"
                        current={availSort}
                        onClick={(k) => setAvailSort((s) => cycleSort(s, k))}
                        align="left"
                      />
                      <PlayersSortHeader
                        label="Age"
                        sortKey="age"
                        current={availSort}
                        onClick={(k) => setAvailSort((s) => cycleSort(s, k))}
                        align="right"
                      />
                      <PlayersSortHeader
                        label={showRedraftColumn ? "Dynasty" : "Dynasty Value"}
                        sortKey="value"
                        current={availSort}
                        onClick={(k) => setAvailSort((s) => cycleSort(s, k))}
                        align="right"
                      />
                      {showRedraftColumn && (
                        <PlayersSortHeader
                          label="Redraft"
                          sortKey="redraftValue"
                          current={availSort}
                          onClick={(k) => setAvailSort((s) => cycleSort(s, k))}
                          align="right"
                        />
                      )}
                    </div>
                  );
                })()}

                <div className="max-h-[480px] overflow-y-auto -mx-1 px-1" data-testid="list-players-available">
                  {availablePool.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      No players match the current filters.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {availablePool.slice(0, 200).map((p) => {
                        const gridCols = showRedraftColumn
                          ? "minmax(0,1fr) 50px 78px 78px"
                          : "minmax(0,1fr) 50px 90px";
                        return (
                          <li
                            key={p.sleeperId}
                            className="md:grid md:gap-2 md:items-center flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border/30 bg-muted/15 hover:bg-muted/30 transition-colors"
                            style={{ gridTemplateColumns: gridCols }}
                            data-testid={`player-row-${p.sleeperId}`}
                          >
                            <div className="min-w-0 flex-1 md:flex-initial">
                              <PlayerAvatar
                                id={realIdResolver(p.sleeperId, p.name, p.pos)}
                                name={p.name}
                                pos={p.pos}
                                team={realTeamResolver(p.sleeperId, p.name, p.pos, p.team)}
                                size="sm"
                              />
                            </div>
                            <span
                              className="hidden md:inline text-[11px] text-right text-muted-foreground tabular-nums shrink-0"
                              data-testid={`text-age-${p.sleeperId}`}
                            >
                              {typeof p.age === "number" && p.age > 0 ? p.age.toFixed(1) : "—"}
                            </span>
                            <span
                              className="text-[12px] md:text-[13px] text-right tabular-nums font-semibold text-[#d4af37] shrink-0"
                              data-testid={`text-dynasty-value-${p.sleeperId}`}
                            >
                              {typeof p.value === "number" && p.value > 0 ? p.value.toLocaleString() : "—"}
                            </span>
                            {showRedraftColumn && (
                              <span
                                className="text-[12px] md:text-[13px] text-right tabular-nums font-semibold text-cyan-500 dark:text-cyan-300 shrink-0"
                                data-testid={`text-redraft-value-${p.sleeperId}`}
                              >
                                {typeof (p as any).redraftValue === "number" && (p as any).redraftValue > 0
                                  ? ((p as any).redraftValue as number).toLocaleString()
                                  : "—"}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {tab === "my-team" && (
              <div className="space-y-2.5">
                {!isConnected || !hasActiveLeague ? (
                  <div className="text-center py-8 space-y-1" data-testid="empty-my-team-disconnected">
                    <p className="text-sm font-medium text-foreground">Roster unavailable.</p>
                    <p className="text-xs text-muted-foreground">Connect Sleeper or select your team to view your current roster.</p>
                  </div>
                ) : myRosterLoading ? (
                  <div className="text-center py-8 flex flex-col items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Loading roster…</p>
                  </div>
                ) : myRosterError ? (
                  <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-500">
                    {myRosterError}
                  </div>
                ) : (!myRoster || myRoster.length === 0) && !isStartupDraft ? (
                  <div className="text-center py-8 space-y-1" data-testid="empty-my-team">
                    <p className="text-sm font-medium text-foreground">Roster unavailable.</p>
                    <p className="text-xs text-muted-foreground">Connect Sleeper or select your team to view your current roster.</p>
                  </div>
                ) : (
                  <>
                    {/* Startup-only totals strip — surfaces in-season starter
                        points (redraft) AND long-term dynasty asset value so
                        the user can see both lenses at a glance. */}
                    {isStartupDraft && myTeamTotals && (
                      <div
                        className="grid grid-cols-2 gap-2"
                        data-testid="my-team-totals"
                      >
                        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.06] px-3 py-2">
                          <p className="text-[9.5px] uppercase tracking-wider text-cyan-600 dark:text-cyan-300/80 font-semibold">
                            Starter Redraft
                          </p>
                          <p
                            className="text-[15px] font-bold tabular-nums text-cyan-600 dark:text-cyan-300 leading-tight"
                            data-testid="text-my-team-total-redraft"
                          >
                            {myTeamTotals.redraft > 0 ? myTeamTotals.redraft.toLocaleString() : "—"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/[0.06] px-3 py-2">
                          <p className="text-[9.5px] uppercase tracking-wider text-[#d4af37]/85 font-semibold">
                            Total Dynasty
                          </p>
                          <p
                            className="text-[15px] font-bold tabular-nums text-[#d4af37] leading-tight"
                            data-testid="text-my-team-total-dynasty"
                          >
                            {myTeamTotals.dynasty > 0 ? myTeamTotals.dynasty.toLocaleString() : "—"}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
                      {(["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const).map((f) => (
                        <PosChip
                          key={f}
                          label={f}
                          active={teamFilter === f}
                          onClick={() => setTeamFilter(f)}
                          pos={f === "ALL" ? undefined : f}
                        />
                      ))}
                    </div>
                    {/* Column header — desktop only. Sortable: click a header
                        to cycle sort direction (asc ⇄ desc). When the
                        Redraft column is shown (startup drafts), the grid
                        uses a 4-column template instead of 3. */}
                    {(() => {
                      const gridCols = showRedraftColumn
                        ? "minmax(0,1fr) 50px 78px 78px"
                        : "minmax(0,1fr) 50px 90px";
                      return (
                        <div
                          className="hidden md:grid items-center gap-2 px-2 py-1 border-b border-border/20"
                          style={{ gridTemplateColumns: gridCols }}
                        >
                          <PlayersSortHeader
                            label="Player"
                            sortKey="name"
                            current={teamSort}
                            onClick={(k) => setTeamSort((s) => cycleSort(s, k))}
                            align="left"
                          />
                          <PlayersSortHeader
                            label="Age"
                            sortKey="age"
                            current={teamSort}
                            onClick={(k) => setTeamSort((s) => cycleSort(s, k))}
                            align="right"
                          />
                          <PlayersSortHeader
                            label={showRedraftColumn ? "Dynasty" : "Dynasty Value"}
                            sortKey="value"
                            current={teamSort}
                            onClick={(k) => setTeamSort((s) => cycleSort(s, k))}
                            align="right"
                          />
                          {showRedraftColumn && (
                            <PlayersSortHeader
                              label="Redraft"
                              sortKey="redraftValue"
                              current={teamSort}
                              onClick={(k) => setTeamSort((s) => cycleSort(s, k))}
                              align="right"
                            />
                          )}
                        </div>
                      );
                    })()}
                    <div className="max-h-[480px] overflow-y-auto -mx-1 px-1" data-testid="list-my-team">
                      {(() => {
                        const rowGridCols = showRedraftColumn
                          ? "minmax(0,1fr) 50px 78px 78px"
                          : "minmax(0,1fr) 50px 90px";
                        const renderRow = (p: RosterPlayer) => {
                          const id = p.sleeperId ?? p.id;
                          const r = id && redraftValueBySleeperId ? redraftValueBySleeperId[id] : 0;
                          return (
                            <li
                              key={p.id || p.sleeperId}
                              className="md:grid md:gap-2 md:items-center flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border/30 bg-muted/15 hover:bg-muted/30 transition-colors"
                              style={{ gridTemplateColumns: rowGridCols }}
                              data-testid={`my-team-row-${p.sleeperId ?? p.id}`}
                            >
                              <div className="min-w-0 flex-1 md:flex-initial">
                                <PlayerAvatar
                                  id={p.sleeperId ?? p.id}
                                  name={p.name}
                                  pos={p.pos}
                                  team={p.team}
                                  size="sm"
                                />
                              </div>
                              <span className="text-[11px] text-right text-muted-foreground tabular-nums shrink-0">
                                {typeof p.age === "number" && p.age > 0 ? `${p.age.toFixed(1)}` : "—"}
                              </span>
                              <span
                                className="text-[12px] md:text-[13px] text-right tabular-nums font-semibold text-[#d4af37] shrink-0"
                                data-testid={`text-my-team-value-${p.sleeperId ?? p.id}`}
                              >
                                {typeof p.value === "number" && p.value > 0 ? p.value.toLocaleString() : "—"}
                              </span>
                              {showRedraftColumn && (
                                <span
                                  className="text-[12px] md:text-[13px] text-right tabular-nums font-semibold text-cyan-500 dark:text-cyan-300 shrink-0"
                                  data-testid={`text-my-team-redraft-${p.sleeperId ?? p.id}`}
                                >
                                  {typeof r === "number" && r > 0 ? r.toLocaleString() : "—"}
                                </span>
                              )}
                            </li>
                          );
                        };
                        const applyFilterSort = (list: RosterPlayer[]) => {
                          const filtered = teamFilter === "ALL" ? list : list.filter((p) => p.pos === teamFilter);
                          const augmented = showRedraftColumn ? filtered.map(attachRedraft) : filtered;
                          return [...augmented].sort((a, b) => comparePlayers(a, b, teamSort));
                        };

                        if (startersBenchSplit) {
                          const starters = applyFilterSort(startersBenchSplit.starters);
                          const bench = applyFilterSort(startersBenchSplit.bench);
                          const empty = starters.length === 0 && bench.length === 0;
                          if (empty) {
                            return (
                              <p className="text-xs text-muted-foreground text-center py-6">
                                {myRoster && myRoster.length === 0
                                  ? "No picks yet, your drafted players will appear here."
                                  : `No ${teamFilter} players on your roster.`}
                              </p>
                            );
                          }
                          return (
                            <div className="space-y-3">
                              <div>
                                <div className="flex items-center justify-between px-1 mb-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#d4af37]">Starters</span>
                                  <span className="text-[10px] text-muted-foreground tabular-nums">
                                    {starters.length}/{(rosterSlots ?? []).length}
                                  </span>
                                </div>
                                {starters.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-3">
                                    No starters yet, draft a {teamFilter === "ALL" ? "player" : teamFilter} to fill this group.
                                  </p>
                                ) : (
                                  <ul className="space-y-1.5">{starters.map(renderRow)}</ul>
                                )}
                              </div>
                              <div>
                                <div className="flex items-center justify-between px-1 mb-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bench</span>
                                  <span className="text-[10px] text-muted-foreground tabular-nums">{bench.length}</span>
                                </div>
                                {bench.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-3">
                                    No bench depth yet.
                                  </p>
                                ) : (
                                  <ul className="space-y-1.5">{bench.map(renderRow)}</ul>
                                )}
                              </div>
                            </div>
                          );
                        }

                        if (filteredRoster.length === 0) {
                          return (
                            <p className="text-xs text-muted-foreground text-center py-6">
                              {isStartupDraft && (!myRoster || myRoster.length === 0)
                                ? "No picks yet, your drafted players will appear here."
                                : `No ${teamFilter} players on your roster.`}
                            </p>
                          );
                        }
                        return <ul className="space-y-1.5">{filteredRoster.map(renderRow)}</ul>;
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── MyPicksPanel ──────────────────────────────────────────────────────────────
function MyPicksPanel({ myPicks, myUserId, usersById, teams }: {
  myPicks: DraftPickNormalized[];
  myUserId: string | null;
  usersById: Record<string, DraftUser>;
  teams: number;
}) {
  const myUser = myUserId ? usersById[myUserId] : null;

  return (
    <Card data-testid="my-picks-panel">
      <CardContent className="pt-4 pb-4 space-y-2.5">
        <div className="flex items-center gap-2">
          <SleeperUserAvatar
            username={myUser?.displayName ?? "You"}
            avatar={myUser?.avatar ?? null}
            size="xs"
            compact
          />
          <span className="text-sm font-semibold">My Picks</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">{myPicks.length}</Badge>
        </div>
        {myPicks.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">No picks yet</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {myPicks.map((pick) => {
              const round = Math.ceil(pick.pickNo / teams);
              const pickInRound = ((pick.pickNo - 1) % teams) + 1;
              return (
                <div
                  key={pick.pickNo}
                  className="flex items-center gap-2 py-1.5 border-b border-border/15 last:border-0"
                  data-testid={`my-pick-${pick.pickNo}`}
                >
                  <span className="text-[10px] font-mono text-muted-foreground w-8 shrink-0 tabular-nums">
                    {round}.{String(pickInRound).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <PlayerAvatar
                      id={pick.playerId ?? ""}
                      name={pick.playerName ?? "—"}
                      pos={pick.position}
                      team={pick.teamAbbr ?? ""}
                      size="xs"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LiveDraft({ onConnectSleeper }: { onConnectSleeper?: () => void } = {}) {
  const { openManagerIntel } = useManagerIntel();
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [draftData, setDraftData] = useState<DraftResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [teamCount, setTeamCount] = useState(12);

  const [liveDrafts, setLiveDrafts] = useState<LiveDraftInfo[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // Explicit draft ID from the card the user clicked — bypasses the
  // "first draft for this league" fallback in fetchDraftBoard so we
  // always load the exact draft the user selected.
  const [activeDraftIdOverride, setActiveDraftIdOverride] = useState<string | null>(null);
  const { dynastyPlayerList, redraftValuesBySleeperId } = useValueModel();
  const { isConnected, user, leagues } = useSleeper();
  const mockDrafts = useMemo(() => getMockDraftSummaries(), []);

  // ── Sleeper auth — provides JWT automatically for timing data ─────────────
  const { sleeperInfo, hasSleeperToken, accessLevel } = useAuth();
  // Primary JWT source: auth-linked token from the Sleeper connect flow.
  // DEV fallback: check the legacy manual-paste key so internal testing still
  // works without going through the full connect flow.
  const sleeperJwt = useMemo(() => {
    if (sleeperInfo?.token) {
      if (import.meta.env.DEV) console.debug("[timing] JWT source: authenticated Sleeper", maskToken(sleeperInfo.token));
      return sleeperInfo.token;
    }
    if (import.meta.env.DEV) {
      try {
        const dev = localStorage.getItem(DEV_JWT_KEY);
        if (dev) { console.debug("[timing] JWT source: dev manual paste", maskToken(dev)); return dev; }
      } catch { /* ignore */ }
      console.debug("[timing] JWT source: unavailable");
    }
    return null;
  }, [sleeperInfo?.token]);

  // DEV-only manual paste state — hidden behind a toggle, never shown in prod.
  const [devJwtInput, setDevJwtInput] = useState("");
  const [devJwtSaved, setDevJwtSaved] = useState(false);
  const [showDevJwtInput, setShowDevJwtInput] = useState(false);

  // ── Draft log / message history ──────────────────────────────────────────
  const [draftMessages, setDraftMessages] = useState<DraftMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draftStarted, setDraftStarted] = useState(false);
  const [showFullLog, setShowFullLog] = useState(false);
  const [draftQueue, setDraftQueue] = useState<string[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isUpdatingQueue, setIsUpdatingQueue] = useState(false);

  // ── DraftState — live data from confirmed get_draft GraphQL endpoint ─────────
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [draftStateLoading, setDraftStateLoading] = useState(false);
  const [draftStateError, setDraftStateError] = useState<string | null>(null);
  const draftStateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Draft-room UI controls ────────────────────────────────────────────
  // Board overlay picker — controls the visual treatment applied to the
  // live draft board (Value / ADP / Positional / Tier / Exposure). Wired
  // through DraftStateHeader; downstream board renderer can opt-in.
  // ── My Team roster (current league roster, not picks in this draft) ───
  // Loaded once per (league, user) and shared with the PlayersPanel "My Team"
  // tab. Independent of the draft picks tracked elsewhere.
  const [myTeamRoster, setMyTeamRoster] = useState<RosterPlayer[] | null>(null);
  const [myTeamRosterLoading, setMyTeamRosterLoading] = useState(false);
  const [myTeamRosterError, setMyTeamRosterError] = useState<string | null>(null);
  // League roster shape (starter slot list + bench count) so the My Team tab
  // can group startup-draft picks into Starters / Bench the same way the
  // league itself will after the draft is final.
  const [myTeamLeagueSlots, setMyTeamLeagueSlots] = useState<{
    starterPositions: string[];
    benchSlots: number;
  } | null>(null);

  // ── Draft-pick (server-mediated) ──────────────────────────────────────
  // Holds the player + pick the user is about to submit. `null` when the
  // confirm modal isn't open. Resets after success or cancel.
  const [draftPickTarget, setDraftPickTarget] = useState<DraftPickTarget | null>(null);
  const { toast } = useToast();

  // ── Autopickers ───────────────────────────────────────────────────────────────
  const [draftAutopickers, setDraftAutopickers] = useState<DraftAutopickerStatus[]>([]);
  const [draftAutopickersLoading, setDraftAutopickersLoading] = useState(false);
  const [draftAutopickersError, setDraftAutopickersError] = useState<string | null>(null);

  // sleeperJwt is now derived from useAuth() — no localStorage seed needed.

  // Load the user's current league roster for the "My Team" tab. Runs once
  // per (league, user) pair; the heavy fetchSleeperLeagueFull call only fires
  // when the active league or signed-in user changes.
  useEffect(() => {
    if (!activeLeagueId || !user?.userId) {
      setMyTeamRoster(null);
      setMyTeamRosterError(null);
      setMyTeamRosterLoading(false);
      setMyTeamLeagueSlots(null);
      return;
    }
    let cancelled = false;
    setMyTeamRosterLoading(true);
    setMyTeamRosterError(null);
    fetchSleeperLeagueFull(activeLeagueId, user.userId)
      .then((data) => {
        if (cancelled) return;
        const team = data.userTeamId
          ? data.league.teams.find((t) => t.id === data.userTeamId)
          : null;
        const cleanRoster: RosterPlayer[] = (team?.roster ?? []).filter((p) => p !== null) as RosterPlayer[];
        setMyTeamRoster(cleanRoster);
        setMyTeamLeagueSlots({
          starterPositions: data.league.rosterPositions ?? [],
          benchSlots: data.league.benchSlots ?? 0,
        });
        setMyTeamRosterLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setMyTeamRosterError(err?.message || "Failed to load roster");
        setMyTeamRosterLoading(false);
        setMyTeamLeagueSlots(null);
      });
    return () => { cancelled = true; };
  }, [activeLeagueId, user?.userId]);

  // Enrich roster players with dynasty values from the shared ranking list.
  // fetchSleeperLeagueFull hardcodes `value: 0` (it's used elsewhere where
  // values aren't relevant) so the My Team tab would render "—" for every
  // row without this join. Lookup is by sleeperId first, then by name+pos.
  const enrichedMyTeamRoster = useMemo<RosterPlayer[] | null>(() => {
    if (!myTeamRoster) return null;
    if (myTeamRoster.length === 0) return myTeamRoster;
    const byId = new Map<string, number>();
    const byNameKey = new Map<string, number>();
    for (const dp of dynastyPlayerList) {
      if (typeof dp.value !== "number" || dp.value <= 0) continue;
      if (dp.sleeperId) byId.set(dp.sleeperId, dp.value);
      byNameKey.set(`${(dp.name || "").toLowerCase().trim()}|${dp.pos}`, dp.value);
    }
    return myTeamRoster.map((p) => {
      if (typeof p.value === "number" && p.value > 0) return p;
      const id = p.sleeperId ?? p.id;
      const fromId = id ? byId.get(id) : undefined;
      const fromName = byNameKey.get(`${(p.name || "").toLowerCase().trim()}|${p.pos}`);
      const value = fromId ?? fromName ?? 0;
      return value > 0 ? { ...p, value } : p;
    });
  }, [myTeamRoster, dynastyPlayerList]);

  const activeDraftId = draftData?.draft?.draftId ?? null;

  const refreshMessages = useCallback(async (draftId: string, jwt?: string | null) => {
    setMessagesLoading(true);
    setMessagesError(null);
    // eslint-disable-next-line no-console
    console.info(`[messages] fetching draftId=${draftId} hasJwt=${!!jwt}${jwt ? ` jwt=${maskToken(jwt)}` : ""}`);
    try {
      const msgs = await fetchDraftMessages(draftId, jwt);
      const sorted = [...msgs].sort((a, b) => a.created - b.created);
      const botMsgs = sorted.filter(m => m.author_is_bot);
      const hasBegan = sorted.some(m => m.author_is_bot && m.text === "This draft has begun!");
      const pickMsgCount = sorted.filter(m => m.author_is_bot && m.text.includes("Pick ")).length;
      // eslint-disable-next-line no-console
      console.info(`[messages] loaded ${sorted.length} messages for draftId=${draftId} (bot=${botMsgs.length} pickMsgs=${pickMsgCount} hasBegan=${hasBegan})`);
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[OTC messages raw]", sorted.slice(0, 20).map(m => ({ message_id: m.message_id, created: m.created, author_is_bot: m.author_is_bot, text: m.text })));
        const parsedMessagePicks = sorted.map(parsePickMessage).filter(Boolean);
        // eslint-disable-next-line no-console
        console.log("[OTC parsed message picks]", parsedMessagePicks);
        if (botMsgs.length > 0 && !hasBegan) {
          // eslint-disable-next-line no-console
          console.info("[messages] sample bot texts (no 'begun' found):", botMsgs.slice(0, 3).map(m => m.text));
        }
      }
      setDraftMessages(sorted);
      setDraftStarted(sorted.some(m => m.text === "This draft has begun!"));
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn(`[messages] failed draftId=${draftId}`, e);
      setMessagesError(e.message || "Failed to load draft log");
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // DEV-only: save a manually-pasted JWT into the legacy key so it feeds
  // back into the sleeperJwt memo on the next render.
  const saveDevJwt = useCallback(() => {
    if (!import.meta.env.DEV) return;
    const val = devJwtInput.trim();
    if (!val) return;
    try { localStorage.setItem(DEV_JWT_KEY, val); } catch { /* ignore */ }
    setDevJwtInput("");
    setDevJwtSaved(true);
    setTimeout(() => setDevJwtSaved(false), 2500);
    if (activeDraftId) refreshMessages(activeDraftId, val);
  }, [devJwtInput, activeDraftId, refreshMessages]);

  const clearDevJwt = useCallback(() => {
    if (!import.meta.env.DEV) return;
    try { localStorage.removeItem(DEV_JWT_KEY); } catch { /* ignore */ }
    setDevJwtInput("");
    setDraftMessages([]);
  }, []);

  const refreshQueue = useCallback(async (draftId: string, jwt: string) => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const ids = await fetchDraftQueue(draftId, jwt);
      setDraftQueue(ids);
    } catch (e: any) {
      setQueueError(e.message || "Failed to load queue");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const queueMutate = useCallback(async (newIds: string[]) => {
    if (!sleeperJwt || !activeDraftId) return;
    const prev = draftQueue;
    setDraftQueue(newIds);
    setIsUpdatingQueue(true);
    setQueueError(null);
    try {
      const result = await updateDraftQueue(activeDraftId, newIds, sleeperJwt);
      setDraftQueue(result);
    } catch (e: any) {
      setDraftQueue(prev);
      setQueueError(e.message || "Failed to update queue");
    } finally {
      setIsUpdatingQueue(false);
    }
  }, [sleeperJwt, activeDraftId, draftQueue]);

  const loadDraftState = useCallback(async (draftId: string, jwt: string) => {
    setDraftStateLoading(true);
    setDraftStateError(null);
    try {
      const state = await fetchDraftState(draftId, jwt);
      setDraftState(state);
    } catch (e: any) {
      setDraftStateError(e.message || "Failed to load draft state");
    } finally {
      setDraftStateLoading(false);
    }
  }, []);

  const loadAutopickers = useCallback(async (draftId: string, jwt: string) => {
    setDraftAutopickersLoading(true);
    setDraftAutopickersError(null);
    try {
      const result = await getDraftAutopickers(jwt, draftId);
      setDraftAutopickers(result);
    } catch (e: any) {
      setDraftAutopickersError(e.message || "Failed to load autopick status");
    } finally {
      setDraftAutopickersLoading(false);
    }
  }, []);

  // Load messages whenever activeDraftId changes — JWT is optional (Sleeper
  // may serve public draft messages without auth; if it requires auth the
  // call gracefully fails and we fall back to REST timing).
  useEffect(() => {
    if (!activeDraftId) return;
    setDraftMessages([]);
    refreshMessages(activeDraftId, sleeperJwt);
  }, [activeDraftId, sleeperJwt, refreshMessages]);

  // JWT-only data: queue, draftState, autopickers
  useEffect(() => {
    if (activeDraftId && sleeperJwt) {
      setDraftQueue([]);
      refreshQueue(activeDraftId, sleeperJwt);
      loadDraftState(activeDraftId, sleeperJwt);
      loadAutopickers(activeDraftId, sleeperJwt);
    }
  }, [activeDraftId, sleeperJwt, refreshQueue, loadDraftState, loadAutopickers]);

  // Poll draftState + autopickers every 12s while JWT is set and draft is active
  useEffect(() => {
    if (!activeDraftId || !sleeperJwt) return;
    if (draftStateIntervalRef.current) clearInterval(draftStateIntervalRef.current);
    draftStateIntervalRef.current = setInterval(() => {
      loadDraftState(activeDraftId, sleeperJwt);
      loadAutopickers(activeDraftId, sleeperJwt);
    }, 12000);
    return () => {
      if (draftStateIntervalRef.current) clearInterval(draftStateIntervalRef.current);
    };
  }, [activeDraftId, sleeperJwt, loadDraftState, loadAutopickers]);

  // Clear all draft data when active league changes
  useEffect(() => {
    setDraftMessages([]);
    setDraftStarted(false);
    setMessagesError(null);
    setDraftQueue([]);
    setQueueError(null);
    setDraftState(null);
    setDraftStateError(null);
    setDraftAutopickers([]);
    setDraftAutopickersError(null);
  }, [activeLeagueId]);

  const scanForLiveDrafts = useCallback(async () => {
    if (!user?.userId) return;
    setIsDetecting(true);
    setScanError(null);
    try {
      const data: LiveDraftInfo[] = await detectLiveDraftsApi(user.userId);
      setLiveDrafts(data);
    } catch {
      setScanError("Network error while scanning for live drafts");
    }
    setIsDetecting(false);
    setHasScanned(true);
  }, [user?.userId]);

  useEffect(() => {
    if (isConnected && user?.userId && !hasScanned) {
      scanForLiveDrafts();
    }
  }, [isConnected, user?.userId, hasScanned, scanForLiveDrafts]);

  const handleJoinLiveDraft = (draftId: string, leagueId: string, teams: number) => {
    setDraftData(null);
    setApiError(null);
    setActiveDraftIdOverride(draftId);
    setActiveLeagueId(leagueId);
    setTeamCount(teams);
    setAutoRefresh(false);
  };

  const fetchDraft = useCallback(async (id?: string) => {
    const targetId = id || activeLeagueId;
    if (!targetId) return;
    setIsLoading(true);
    setApiError(null);
    try {
      const data: DraftResponse = await fetchDraftBoardApi(targetId, activeDraftIdOverride ?? undefined);
      if (data.error) {
        setApiError(data.error);
        return;
      }

      setDraftData(data);
      if (data.draft?.teams) setTeamCount(data.draft.teams);
    } catch (err: any) {
      setApiError(err.message || "Network error");
    } finally {
      setIsLoading(false);
    }
  }, [activeLeagueId, activeDraftIdOverride]);

  useEffect(() => {
    if (activeLeagueId) fetchDraft(activeLeagueId);
  }, [activeLeagueId]);

  useEffect(() => {
    if (autoRefresh && activeLeagueId) {
      intervalRef.current = setInterval(() => {
        fetchDraft();
        if (activeDraftId) {
          refreshMessages(activeDraftId, sleeperJwt);
        }
        if (activeDraftId && sleeperJwt) {
          refreshQueue(activeDraftId, sleeperJwt);
        }
      }, 45000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, activeLeagueId, activeDraftId, sleeperJwt, fetchDraft, refreshMessages, refreshQueue]);

  // Map of "name|pos" → real Sleeper id, sourced from dynastyPlayerList.
  // Used to translate the synthetic rookie_N ids in the rookie board into
  // real ids so PlayerAvatar can fetch real headshots (the avatar component
  // treats anything starting with "rookie_" as synthetic and falls back to
  // initials). When no match exists (true draft-eligible rookie not yet in
  // Sleeper's player DB), we fall through to the synthetic id and the
  // initials fallback continues to work.
  const realPlayerByNameKey = useMemo(() => {
    const m = new Map<string, { sleeperId: string; team: string }>();
    for (const p of dynastyPlayerList) {
      if (!p.sleeperId || p.sleeperId.startsWith("rookie_")) continue;
      m.set(`${p.name.toLowerCase().trim()}|${p.pos}`, { sleeperId: p.sleeperId, team: p.team || "" });
    }
    return m;
  }, [dynastyPlayerList]);
  const resolveRealSleeperId = useCallback(
    (id: string, name: string, pos: string): string => {
      if (id && !id.startsWith("rookie_") && !id.startsWith("pick_") && !id.startsWith("mock_")) {
        return id;
      }
      const key = `${(name || "").toLowerCase().trim()}|${pos}`;
      return realPlayerByNameKey.get(key)?.sleeperId ?? id;
    },
    [realPlayerByNameKey],
  );
  // Rookie board entries ship with team="" (they haven't been drafted to an
  // NFL team yet at compile time). Once a rookie matches a real Sleeper id
  // we can pull their current NFL team from dynastyPlayerList so the team
  // logo badge renders alongside their headshot in the Players list.
  const resolveRealTeam = useCallback(
    (id: string, name: string, pos: string, fallbackTeam: string): string => {
      if (fallbackTeam && fallbackTeam !== "FA") return fallbackTeam;
      const key = `${(name || "").toLowerCase().trim()}|${pos}`;
      return realPlayerByNameKey.get(key)?.team || fallbackTeam;
    },
    [realPlayerByNameKey],
  );

  // Reference rankings for the "Best Available" rail. Auto-detects rookie
  // drafts (≤6 rounds OR draftCategory === "rookie") and uses the
  // appropriate FantasyCalc board; otherwise falls back to the dynasty
  // ranking. SF vs 1QB is derived from the league's roster positions.
  // This is a *reference overlay only* — it never populates the live board.
  const fullBoard = useMemo(() => {
    const isRookie =
      draftData?.draft?.draftCategory === "rookie" ||
      (!!draftData?.draft && draftData.draft.draftCategory !== "startup" && draftData.draft.rounds <= 6);
    if (isRookie) {
      const league = activeLeagueId ? leagues.find((l) => l.leagueId === activeLeagueId) : null;
      const isSF = league?.rosterPositions.includes("SUPER_FLEX") ?? false;
      return isSF ? ROOKIE_BOARD_2026_SF : ROOKIE_BOARD_2026_1QB;
    }
    return dynastyPlayerList.slice(0, 300);
  }, [draftData, activeLeagueId, leagues, dynastyPlayerList]);

  const pickedPlayerIds = useMemo(() => {
    if (!draftData) return new Set<string>();
    return new Set(draftData.picks.map(p => p.playerId).filter(Boolean));
  }, [draftData]);

  // Normalized name set of already-drafted players — used by the Best
  // Available rail so it can correctly hide rookies even though the rookie
  // board uses synthetic `rookie_N` IDs that never match Sleeper's real
  // player_ids. Sleeper picks include the player name in metadata, so a
  // lowercased name set is a reliable secondary key.
  const pickedPlayerNames = useMemo(() => {
    if (!draftData) return new Set<string>();
    const s = new Set<string>();
    for (const p of draftData.picks) {
      if (p.playerName) s.add(p.playerName.toLowerCase().trim());
    }
    return s;
  }, [draftData]);

  // ── Live timer countdown ─────────────────────────────────────────────────
  // Sleeper exposes `settings.pick_timer` (seconds per pick) and
  // `draft.last_picked` (ms epoch). We derive a deadline = lastPicked +
  // pickTimer*1000, then tick a 1-second wall-clock so the panel renders a
  // real MM:SS countdown rather than a static config value.
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!activeLeagueId) return;
    const iv = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [activeLeagueId]);

  const timerInfo = useMemo<TimerInfo>(() => {
    const pickTimer = draftData?.draft?.pickTimer ?? draftState?.pickTimer ?? 0;
    if (!pickTimer || pickTimer <= 0) {
      return { available: false, label: "No timer", remainingMs: 0, expired: false };
    }
    // Anchor: most recent pick's timestamp; else draft start time. The
    // first pick is timed from when the draft actually started.
    const lastPicked = draftData?.draft?.lastPicked ?? null;
    const startTime = draftData?.draft?.startTime ?? null;
    const baseTime = lastPicked ?? startTime ?? null;
    if (!baseTime) {
      return { available: false, label: "No timer", remainingMs: 0, expired: false };
    }
    const deadline = baseTime + pickTimer * 1000;
    const remainingMs = Math.max(0, deadline - nowTs);
    const expired = remainingMs <= 0;
    const totalSecs = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const label = expired ? "00:00" : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return { available: true, label, remainingMs, expired };
  }, [draftData, draftState, nowTs]);

  // Picks-first board grid. Every cell represents an actual draft slot —
  // drafted cells render the real Sleeper player; empty cells render the
  // pick number + manager who owns that slot. We deliberately do NOT
  // populate undrafted slots with FantasyCalc/Dynasty ranking predictions —
  // this is a live draft tracker, not a static rookie board.
  const boardGrid = useMemo(() => {
    const rounds = draftData?.draft?.rounds || draftState?.rounds || 0;
    type Cell = {
      pickNo: number;
      round: number;
      slot: number;
      pick: DraftPick | null;
      isDrafted: boolean;
      isCurrent: boolean;
      /** True when the CURRENT owner of this (round, slot) is the user. */
      isMine: boolean;
      /** Display name for the CURRENT owner — post-trade if traded. */
      ownerName: string;
      ownerAvatar: string | null;
      /** Original slot owner's display name. Only meaningful when isTraded. */
      originalOwnerName: string | null;
      isTraded: boolean;
    };
    if (!rounds || !teamCount) return [] as Array<Array<Cell>>;

    // Index actual picks by `round-slot`. Sleeper stamps `roster_id` /
    // `picked_by` on the pick when it's made, so for drafted cells those
    // are the source of truth — they already reflect any trade.
    const pickMap = new Map<string, DraftPick>();
    if (draftData) {
      for (const p of draftData.picks) {
        pickMap.set(`${p.round}-${p.draftSlot}`, p);
      }
    }

    // Per-(round, slot) ownership from the REST helper. Falls back to
    // the slot's original owner when no traded_picks entry exists.
    const ownerByCell = new Map<string, DraftPickOwner>();
    if (draftData?.pickOwners) {
      for (const po of draftData.pickOwners) {
        ownerByCell.set(`${po.round}-${po.slot}`, po);
      }
    }

    // GraphQL fallback for current-owner display (when draftData hasn't
    // loaded yet but draftState is present, e.g. in JWT-only edge cases).
    // No traded-pick data is available here — we treat every slot as
    // owned by its original draftOrder slot.
    //
    // Use the normalizer's resolved slot→user mapping, which falls back
    // through slot_to_roster_id → roster.owner_id so a pre-draft startup
    // with an empty draft_order still renders correct headers/cells.
    const slotToUserId: Record<number, string | undefined> = {};
    if (draftState?.normalizedOrder.slotToUserId) {
      for (const [slot, uid] of Object.entries(draftState.normalizedOrder.slotToUserId)) {
        if (uid) slotToUserId[Number(slot)] = uid;
      }
    }
    // Roster-centric board: each column i always represents the same team
    // (slot i+1) across every round. The picks in pickMap are keyed by
    // (round, draftSlot) where draftSlot is the team's assigned position —
    // so we look up slot = i+1 directly without any snake/linear reversal.
    //
    // Bug history: the previous code used getSlotForPick(pickNo) — a
    // snake-visual formula that reverses even rounds — causing picks to
    // appear in the wrong columns. E.g. in R2 of a 12-team snake draft,
    // column 0 (header = slot 1's team) would show slot 12's pick.
    const currentPickNoGrid = (draftState?.picks.length ?? draftData?.picks.filter((p) => p.playerId).length ?? 0) + 1;
    const currentRoundGrid = teamCount > 0 ? Math.ceil(currentPickNoGrid / teamCount) : 0;
    // Current slot: prefer normalizer (handles snake/linear/3RR correctly).
    // Fall back to a basic snake formula when draftState isn't available.
    const currentSlotGrid = draftState
      ? draftState.normalizedOrder.currentSlot
      : (() => {
          const isSnakeLocal = (draftData?.draft?.type ?? "") === "snake";
          const inRound = ((currentPickNoGrid - 1) % Math.max(teamCount, 1)) + 1;
          return isSnakeLocal && currentRoundGrid % 2 === 0
            ? teamCount - inRound + 1
            : inRound;
        })();
    const myUserId = user?.userId ?? null;

    const grid: Array<Array<Cell>> = [];

    for (let r = 0; r < rounds; r++) {
      const row: Array<Cell> = [];
      for (let i = 0; i < teamCount; i++) {
        const round = r + 1;
        const slot = i + 1; // roster-centric: column i always = slot i+1
        const pickNo = r * teamCount + i + 1; // grid index (for display label only)
        const draftPick = pickMap.get(`${round}-${slot}`);
        const ownerInfo = ownerByCell.get(`${round}-${slot}`);

        let ownerName: string;
        let ownerAvatar: string | null;
        let originalOwnerName: string | null = null;
        let isTraded = false;
        let isMine = false;

        if (draftPick?.playerId && draftPick.rosterId != null) {
          // Drafted cell: the pick record's roster_id IS the picker
          // post-trade. Use ownerInfo (if present) to render the picker's
          // name + flag the cell as traded relative to the original slot.
          const pickerRoster = draftPick.rosterId;
          if (ownerInfo && ownerInfo.currentRosterId === pickerRoster) {
            ownerName = ownerInfo.currentDisplayName;
            ownerAvatar = ownerInfo.currentAvatar;
            isTraded = ownerInfo.isTraded;
            originalOwnerName = isTraded ? ownerInfo.originalDisplayName : null;
            isMine = !!myUserId && ownerInfo.currentUserId === myUserId;
          } else {
            // Fall back to the draftSlots lookup against the picker's roster.
            const fromRest = draftData?.draftSlots?.find((d) => d.rosterId === pickerRoster);
            ownerName = fromRest?.displayName ?? `Roster ${pickerRoster}`;
            ownerAvatar = fromRest?.avatar ?? null;
            isTraded = ownerInfo ? ownerInfo.isTraded : false;
            originalOwnerName = isTraded && ownerInfo ? ownerInfo.originalDisplayName : null;
            isMine = false;
          }
        } else if (ownerInfo) {
          // Undrafted cell with REST data → use the resolved current owner.
          ownerName = ownerInfo.currentDisplayName;
          ownerAvatar = ownerInfo.currentAvatar;
          isTraded = ownerInfo.isTraded;
          originalOwnerName = isTraded ? ownerInfo.originalDisplayName : null;
          isMine = !!myUserId && ownerInfo.currentUserId === myUserId;
        } else {
          // No REST data yet — fall back to draftState's slot mapping
          // (no traded-pick awareness, but better than "Slot N").
          const uid = slotToUserId[slot];
          const u = uid ? draftState?.usersById[uid] : null;
          ownerName = u?.displayName ?? `Slot ${slot}`;
          ownerAvatar = u?.avatar ?? null;
          isMine = !!myUserId && uid === myUserId;
        }

        row.push({
          pickNo,
          round,
          slot,
          pick: draftPick ?? null,
          isDrafted: !!draftPick?.playerId,
          isCurrent: round === currentRoundGrid && slot === currentSlotGrid,
          isMine,
          ownerName,
          ownerAvatar,
          originalOwnerName,
          isTraded,
        });
      }
      grid.push(row);
    }
    return grid;
  }, [teamCount, draftData, draftState, user?.userId]);

  // REST-only slot headers (displayName + avatar hash). The GraphQL path
  // enriches further in `enhancedSlotHeaders` below.
  //
  // Header semantics: each column header shows the ORIGINAL owner of that
  // draft slot — i.e. who was assigned pick slot N before any trades. This
  // makes the column a permanent "team identity" regardless of whether they
  // traded picks away or acquired others. Traded-pick awareness belongs in
  // the cells (the "Traded" badge), not in the column header.
  //
  // Source priority:
  //   1. draftSlots — built directly from draft_order + slot_to_roster_id;
  //      always represents original slot assignments.
  //   2. pickOwners[round=1].originalDisplayName — same semantic, used when
  //      draftSlots is unavailable (race condition during loading).
  const slotHeaders = useMemo<Array<{ displayName: string; avatar: string | null; userId: string | null }>>(() => {
    // Prefer draftSlots — it is the canonical original slot assignment source.
    if (draftData?.draftSlots && draftData.draftSlots.length > 0) {
      return [...draftData.draftSlots]
        .sort((a, b) => a.slot - b.slot)
        .map((s) => ({ displayName: s.displayName, avatar: s.avatar ?? null, userId: (s as any).userId ?? null }));
    }
    // Fallback: use the ORIGINAL owner from pickOwners (not current/post-trade).
    if (draftData?.pickOwners && draftData.pickOwners.length > 0) {
      const round1 = new Map<number, { displayName: string; avatar: string | null; userId: string | null }>();
      for (const po of draftData.pickOwners) {
        if (po.round !== 1) continue;
        round1.set(po.slot, {
          displayName: po.originalDisplayName,
          avatar: po.originalAvatar ?? null,
          userId: null, // originalUserId not available; manager-intel click uses enhancedSlotHeaders
        });
      }
      if (round1.size > 0) {
        return Array.from({ length: teamCount }, (_, i) => {
          const s = i + 1;
          return round1.get(s) ?? { displayName: `Pick ${s}`, avatar: null, userId: null };
        });
      }
    }
    return Array.from({ length: teamCount }, (_, i) => ({
      displayName: `Pick ${i + 1}`,
      avatar: null,
      userId: null,
    }));
  }, [draftData, teamCount]);

  const stats = useMemo(() => {
    const totalDrafted = draftData?.picks.filter(p => p.playerId).length || 0;
    const totalPicks = (draftData?.draft?.rounds || 0) * teamCount;
    return { drafted: totalDrafted, total: totalPicks };
  }, [draftData, teamCount]);

  const parsedPicks = useMemo<ParsedPick[]>(() => {
    return draftMessages.map(parsePickMessage).filter((p): p is ParsedPick => p !== null);
  }, [draftMessages]);

  // Timestamp of the last completed pick — this is the start of the current
  // manager's on-the-clock window, used for the live elapsed timer.
  // Falls back to the "This draft has begun!" message when no picks yet.
  const lastPickTimestamp = useMemo<number | null>(() => {
    if (parsedPicks.length > 0) {
      return parsedPicks.reduce((max, p) => Math.max(max, p.created), 0);
    }
    const startMsg = draftMessages.find(m => m.author_is_bot && m.text === "This draft has begun!");
    return startMsg?.created ?? null;
  }, [parsedPicks, draftMessages]);

  // message_id → { timeMs, timeLabel } — duration since previous relevant bot message.
  // Seed priority:
  //   1. "This draft has begun!" bot message (most accurate)
  //   2. draftData.draft.startTime (REST field, always present for completed drafts)
  //   3. First pick message's own timestamp — no timing emitted for that first pick
  //      but all subsequent picks correctly measure time since the prior pick.
  // This handles the common case where Sleeper returns only recent messages and
  // the "begun" message falls outside the returned window.
  const pickTimings = useMemo<Map<string, { timeMs: number; timeLabel: string }>>(() => {
    const map = new Map<string, { timeMs: number; timeLabel: string }>();
    const relevant = draftMessages
      .filter(m => m.author_is_bot && (m.text.includes("This draft has begun!") || m.text.includes("Pick ")))
      .sort((a, b) => a.created - b.created);
    if (relevant.length === 0) return map;

    // Check whether a "begun" message is present in the returned window.
    const begunMsg = relevant.find(m => m.text.includes("This draft has begun!"));

    // Seed prevCreated: begun-msg > REST startTime > null (first pick seeds itself).
    const restStart = draftData?.draft?.startTime;
    let prevCreated: number | null =
      begunMsg?.created ??
      (restStart && restStart > 1_000_000_000_000 ? restStart :
       restStart && restStart > 1_000_000_000 ? restStart * 1000 : null);

    for (const msg of relevant) {
      if (msg.text.includes("This draft has begun!")) {
        prevCreated = msg.created;
        continue;
      }
      if (prevCreated === null) {
        // No seed available yet — use this pick's timestamp as seed for the next
        // pick without emitting a timing entry for the current one.
        prevCreated = msg.created;
        continue;
      }
      const timeMs = msg.created - prevCreated;
      const totalSecs = Math.floor(timeMs / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const timeLabel = mins > 0 ? `${mins}m ${secs}s` : `${totalSecs}s`;
      map.set(msg.message_id, { timeMs, timeLabel });
      prevCreated = msg.created;
    }
    return map;
  }, [draftMessages, draftData?.draft?.startTime]);

  // currentPickInfo — derived from draftState when available (rich, JWT-only)
  // and falls back to draftData (public REST) so the room renders without a
  // GraphQL token. When pickOwners (traded-pick aware) data is present we
  // prefer that for "who is on the clock" and "is my turn / picks away"
  // so traded picks are correctly attributed to the current owner.
  const currentPickInfo = useMemo((): CurrentPickInfo | null => {
    const myUserId = user?.userId ?? null;
    // Snake helper.
    const slotForPick = (pickNoOneBased: number, teams: number, type: string | undefined): { round: number; pickInRound: number; slot: number } => {
      const round = Math.ceil(pickNoOneBased / teams);
      const pickInRound = ((pickNoOneBased - 1) % teams) + 1;
      const slot = type === "snake" && round % 2 === 0 ? teams - pickInRound + 1 : pickInRound;
      return { round, pickInRound, slot };
    };

    // Index of pickOwners keyed by `${round}-${slot}`. Empty when REST data
    // hasn't loaded yet — consumers fall back to the slot-based mapping.
    const ownerByCell = new Map<string, DraftPickOwner>();
    if (draftData?.pickOwners) {
      for (const po of draftData.pickOwners) ownerByCell.set(`${po.round}-${po.slot}`, po);
    }

    if (draftState) {
      const { teams, rounds, picks, usersById, normalizedOrder } = draftState;
      const totalPicks = teams * rounds;
      if (picks.length >= totalPicks) return null;
      const nextPickNo = picks.length + 1;
      const currentRound = Math.ceil(nextPickNo / teams);
      const pickInRound = ((nextPickNo - 1) % teams) + 1;
      // Snake/linear/3RR all resolved by the normalizer — single source of
      // truth so the on-the-clock identity can't drift from the board cells.
      const draftSlot = normalizedOrder.getSlotForPick(nextPickNo);

      // Prefer pickOwners for the on-the-clock identity (trade-aware).
      // When pickOwners hasn't loaded yet, fall through to the normalizer —
      // which itself folds draft_order + slot_to_roster_id + roster owners.
      const ownerInfo = ownerByCell.get(`${currentRound}-${draftSlot}`);
      let currentUserId: string | null = null;
      let currentUser: DraftUser | null = null;
      if (ownerInfo?.currentUserId) {
        currentUserId = ownerInfo.currentUserId;
        currentUser = usersById[currentUserId] ?? {
          userId: currentUserId,
          displayName: ownerInfo.currentDisplayName,
          avatar: ownerInfo.currentAvatar,
          isBot: false,
        } as DraftUser;
      } else {
        const slotUid = normalizedOrder.slotToUserId[draftSlot] ?? null;
        currentUserId = slotUid;
        if (slotUid && usersById[slotUid]) {
          currentUser = usersById[slotUid];
        } else if (slotUid) {
          currentUser = {
            userId: slotUid,
            displayName: normalizedOrder.slotToUsername[draftSlot] ?? `Team ${draftSlot}`,
            avatar: null,
            isBot: false,
          };
        }
      }

      // Picks-away: walk forward through future cells. Traded picks I own
      // count as mine; trades that gave my original slot away don't.
      let picksAway = 0;
      let isMyTurn = false;
      if (myUserId) {
        for (let p = nextPickNo; p <= totalPicks; p++) {
          const ss = normalizedOrder.getSlotForPick(p);
          const rr = Math.ceil(p / teams);
          const oi = ownerByCell.get(`${rr}-${ss}`);
          const cellUid = oi?.currentUserId ?? normalizedOrder.slotToUserId[ss] ?? null;
          if (cellUid === myUserId) {
            picksAway = p - nextPickNo;
            isMyTurn = picksAway === 0;
            break;
          }
        }
      }

      return { nextPickNo, currentRound, pickInRound, currentUserId, currentUser, picksAway, totalPicks, picksRemaining: totalPicks - picks.length, isMyTurn };
    }

    // REST-only fallback — no GraphQL token required.
    if (draftData?.draft) {
      const teams = draftData.draft.teams || teamCount;
      const rounds = draftData.draft.rounds;
      const type = draftData.draft.type;
      const totalPicks = teams * rounds;
      const picksMade = draftData.picks.filter((p) => p.playerId).length;
      if (picksMade >= totalPicks) return null;
      const nextPickNo = picksMade + 1;
      const { round: currentRound, pickInRound, slot: draftSlot } = slotForPick(nextPickNo, teams, type);

      // Prefer pickOwners; fall back to draftSlots (original-only) so the
      // header still renders before traded_picks resolves.
      const ownerInfo = ownerByCell.get(`${currentRound}-${draftSlot}`);
      const slotMeta = draftData.draftSlots.find((s) => s.slot === draftSlot) ?? null;
      const currentUser: DraftUser | null = ownerInfo
        ? {
            userId: ownerInfo.currentUserId ?? String(ownerInfo.currentRosterId),
            displayName: ownerInfo.currentDisplayName,
            avatar: ownerInfo.currentAvatar,
            isBot: false,
          } as DraftUser
        : slotMeta
          ? { userId: String(slotMeta.rosterId), displayName: slotMeta.displayName, avatar: slotMeta.avatar ?? null, isBot: false } as DraftUser
          : null;

      // Match username → user id for picks-away. Sleeper hands us the
      // current user's user id directly on the connected session.
      let picksAway = 0;
      let isMyTurn = false;
      if (myUserId) {
        for (let p = nextPickNo; p <= totalPicks; p++) {
          const { round: rr, slot: ss } = slotForPick(p, teams, type);
          const oi = ownerByCell.get(`${rr}-${ss}`);
          if (oi?.currentUserId === myUserId) {
            picksAway = p - nextPickNo;
            isMyTurn = picksAway === 0;
            break;
          }
        }
      }
      // Username-derived fallback when we don't have pickOwners yet AND the
      // session userId isn't set — match by displayName on the original slot.
      if (!ownerByCell.size) {
        const myHandle = (user?.username ?? user?.displayName ?? "").toLowerCase();
        if (myHandle) {
          const match = draftData.draftSlots.find((s) => s.displayName.toLowerCase() === myHandle);
          if (match) {
            const mySlot = match.slot;
            isMyTurn = mySlot === draftSlot;
            picksAway = isMyTurn
              ? 0
              : mySlot > draftSlot
                ? mySlot - draftSlot
                : teams - draftSlot + mySlot;
          }
        }
      }

      return {
        nextPickNo,
        currentRound,
        pickInRound,
        currentUserId: ownerInfo?.currentUserId ?? (slotMeta ? String(slotMeta.rosterId) : null),
        currentUser,
        picksAway,
        totalPicks,
        picksRemaining: totalPicks - picksMade,
        isMyTurn,
      };
    }

    return null;
  }, [draftState, draftData, user?.userId, user?.username, user?.displayName, teamCount]);

  // My own picks — prefer draftState; fall back to matching draftData picks
  // by slot ownership using the user's Sleeper username.
  const myPicks = useMemo(() => {
    // GraphQL path: pick.pickedBy is the actual user_id who clicked draft —
    // already trade-aware because Sleeper sets it when the pick is made.
    if (draftState && user?.userId) {
      return draftState.picks.filter((p) => p.pickedBy === user.userId);
    }

    // REST path: every made pick carries `rosterId` (the actual picker's
    // roster_id). For traded picks this is the NEW owner, not the slot's
    // original owner — so filtering by my-rosterId is the correct
    // trade-aware lookup.
    //
    // Previous implementation walked the original draft slot for every
    // round; that included picks the user had traded away (false positive)
    // AND missed picks the user had traded for (false negative).
    if (draftData && draftData.picks) {
      // Determine my rosterId. Prefer the pickOwners map (resolved from
      // /league/{id}/users by fetchDraftBoard); fall back to draftSlots'
      // displayName match for legacy callers.
      let myRosterId: number | null = null;
      if (draftData.pickOwners && user?.userId) {
        const mine = draftData.pickOwners.find((po) => po.currentUserId === user.userId);
        if (mine) myRosterId = mine.currentRosterId;
      }
      if (myRosterId == null && draftData.draftSlots) {
        const myHandle = (user?.username ?? user?.displayName ?? "").toLowerCase();
        if (myHandle) {
          const match = draftData.draftSlots.find((s) => s.displayName.toLowerCase() === myHandle);
          if (match) myRosterId = match.rosterId;
        }
      }
      if (myRosterId == null) return [] as DraftPickNormalized[];

      return draftData.picks
        .filter((p) => p.playerId && p.rosterId === myRosterId)
        .map((p) => ({
          pickNo: p.pickNo,
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.pos,
          teamAbbr: p.team,
          pickedBy: user?.userId ?? "",
          isKeeper: false,
          reactions: [],
        } as unknown as DraftPickNormalized));
    }
    return [] as DraftPickNormalized[];
  }, [draftState, draftData, user?.userId, user?.username, user?.displayName, teamCount]);

  // For startup drafts, the league roster is empty until the draft completes,
  // so the My Team tab would render "Roster unavailable" the entire time. Map
  // the user's current draft picks into a synthetic RosterPlayer[] (enriched
  // with dynasty values) and use that in place of the league roster. Rookie
  // drafts keep the existing league-roster behavior.
  const isStartupDraft =
    (draftData?.draft?.draftCategory ?? "").toLowerCase() === "startup";

  const startupDraftedRoster = useMemo<RosterPlayer[] | null>(() => {
    if (!isStartupDraft) return null;
    const byId = new Map<string, number>();
    const byNameKey = new Map<string, number>();
    for (const dp of dynastyPlayerList) {
      if (typeof dp.value !== "number" || dp.value <= 0) continue;
      if (dp.sleeperId) byId.set(dp.sleeperId, dp.value);
      byNameKey.set(`${(dp.name || "").toLowerCase().trim()}|${dp.pos}`, dp.value);
    }
    const allowedPos = new Set(["QB", "RB", "WR", "TE"]);
    return myPicks
      .filter((p) => !!p.playerId && allowedPos.has((p.position || "").toUpperCase()))
      .map((p) => {
        const pos = (p.position || "").toUpperCase() as RosterPlayer["pos"];
        const valueById = p.playerId ? byId.get(p.playerId) : undefined;
        const valueByName = byNameKey.get(`${(p.playerName || "").toLowerCase().trim()}|${pos}`);
        const value = valueById ?? valueByName ?? 0;
        return {
          id: p.playerId,
          sleeperId: p.playerId,
          name: p.playerName,
          pos,
          age: 0,
          value,
          team: p.teamAbbr ?? "",
          starter: false,
          onTaxi: false,
          onReserve: false,
        } as RosterPlayer;
      });
  }, [isStartupDraft, myPicks, dynastyPlayerList]);

  // What actually feeds the My Team tab: startup → drafted picks, otherwise
  // the existing enriched league roster.
  const effectiveMyTeamRoster = isStartupDraft ? startupDraftedRoster : enrichedMyTeamRoster;

  // Slot headers — username + avatar per slot, AFTER applying traded_picks
  // for round 1 (so the visible order reflects who will actually pick first
  // in each column, not who originally owned the slot).
  //
  // Source priority:
  //   1) draftData.pickOwners (REST + traded_picks → current owner)
  //   2) draftState.draftOrderByUserId (GraphQL, original owner only)
  //   3) draftData.draftSlots (REST fallback, original owner only)
  // The pickOwners path is preferred even when GraphQL data is loaded
  // because GraphQL doesn't expose traded_picks; without this guard the
  // headers would silently revert to original owners on JWT-authenticated
  // sessions.
  const enhancedSlotHeaders = useMemo<Array<{ displayName: string; avatar: string | null; userId: string | null }>>(() => {
    if (draftData?.pickOwners && draftData.pickOwners.length > 0) {
      // `slotHeaders` already folds in pickOwners[round=1]; re-use it so
      // the two header arrays stay in lockstep.
      return slotHeaders;
    }
    if (draftState) {
      // Use the normalizer's slotToUserId / slotToUsername — these chain
      // through draft_order → slot_to_roster_id → roster.owner_id so the
      // column header is never a "Slot N" placeholder when any of those
      // mappings carries the slot.
      const { normalizedOrder, usersById, teams } = draftState;
      const headers = Array.from({ length: teams }, (_, i) => {
        const slot = i + 1;
        const userId = normalizedOrder.slotToUserId[slot] ?? null;
        const user = userId ? usersById[userId] ?? null : null;
        return {
          displayName: user?.displayName || normalizedOrder.slotToUsername[slot] || `Pick ${slot}`,
          avatar: user?.avatar ?? null,
          userId: user && !user.isBot ? user.userId : userId,
        };
      });
      if (headers.some((h) => h.userId)) return headers;
    }
    return slotHeaders;
  }, [draftState, slotHeaders, draftData]);

  // Merged pick history: draftState.picks (primary) joined with message timing data
  // Pick history is built from three layered sources so the Draft Log
  // works without a Sleeper JWT:
  //   1) draftState.picks (best — has user attribution + reactions)
  //   2) draftData.picks  (public REST — always available)
  //   3) parsed draft-room messages (only when JWT is set; provides timing)
  // Without a token the user still sees a full pick history; with a token
  // they get drafter attribution and per-pick clock-time.
  type MergedPickEntry = {
    pick: DraftPickNormalized | null;
    timing: { timeMs: number; timeLabel: string } | null;
    user: DraftUser | null;
    isForced: boolean;
    timestamp: number | null;
    _parsed?: ParsedPick;
  };
  const mergedPickHistory = useMemo<MergedPickEntry[]>(() => {
    // Look up the drafting user for a given slot — falls back to the REST
    // slot displayName when draftState isn't available.
    const slotToUser = (slot: number): DraftUser | null => {
      if (draftState) {
        const uid = draftState.normalizedOrder.slotToUserId[slot];
        if (uid) {
          return (
            draftState.usersById[uid] ?? {
              userId: uid,
              displayName: draftState.normalizedOrder.slotToUsername[slot] ?? `Team ${slot}`,
              avatar: null,
              isBot: false,
            }
          );
        }
      }
      const fromRest = draftData?.draftSlots?.find((d) => d.slot === slot);
      if (fromRest) {
        return {
          userId: String(fromRest.rosterId),
          displayName: fromRest.displayName,
          // DraftSlot carries the Sleeper avatar hash even on the REST path —
          // pass it through so manager rows show profile images without JWT.
          avatar: fromRest.avatar ?? null,
          isBot: false,
        } as DraftUser;
      }
      return null;
    };

    // Trade-aware lookup: every made pick carries the actual picker's
    // `roster_id`. Mapping pick.rosterId → manager (via draftSlots, which
    // is keyed by rosterId regardless of which slot the manager originally
    // owned) credits the right manager when a slot was traded mid-draft.
    const rosterIdToUser = (rosterId: number): DraftUser | null => {
      // draftState carries roster_id → user_id only indirectly via
      // draftOrderByUserId (which is slot-based, not roster-based). The
      // REST draftSlots list is the cleanest source: each entry is one
      // (slot, rosterId, displayName, avatar) tuple, and rosterId is
      // unique per league.
      const fromRest = draftData?.draftSlots?.find((d) => d.rosterId === rosterId);
      if (fromRest) {
        return {
          userId: String(fromRest.rosterId),
          displayName: fromRest.displayName,
          avatar: fromRest.avatar ?? null,
          isBot: false,
        } as DraftUser;
      }
      return null;
    };

    // REST-derived timing/timestamp tables. Sleeper's public draft endpoint
    // returns `picked_at` per pick (extracted via getPickTimestamp). Use it
    // as a JWT-free fallback so Manager Time + per-pick timing work even
    // when the message-history GraphQL token isn't pasted in.
    const restPickedAtByNo = new Map<number, number>();
    if (draftData) {
      for (const dp of draftData.picks) {
        if (typeof dp.pickedAt === "number" && dp.pickedAt > 0) {
          restPickedAtByNo.set(dp.pickNo, dp.pickedAt);
        }
      }
    }
    const draftStartMs = draftData?.draft?.startTime ?? null;
    const restTimingByNo = new Map<number, { timeMs: number; timeLabel: string }>();
    {
      const sorted = Array.from(restPickedAtByNo.entries()).sort((a, b) => a[0] - b[0]);
      let prev: number | null = draftStartMs && draftStartMs > 0 ? draftStartMs : null;
      for (const [pickNo, ts] of sorted) {
        if (prev != null && ts > prev) {
          const timeMs = ts - prev;
          const totalSecs = Math.floor(timeMs / 1000);
          const mins = Math.floor(totalSecs / 60);
          const secs = totalSecs % 60;
          const timeLabel = mins > 0 ? `${mins}m ${secs}s` : `${totalSecs}s`;
          restTimingByNo.set(pickNo, { timeMs, timeLabel });
        }
        prev = ts;
      }
    }

    // Build multi-key timing maps from parsed pick messages so timing can be
    // found by pick_no, displayPick ("1.02"), or round.slot — whichever key
    // the REST pick rows expose. The message_id-keyed pickTimings map already
    // holds the computed durations; we just re-index it here.
    const teamsForTiming = draftState?.teams ?? draftData?.draft?.teams ?? teamCount;
    const timingByPickNo    = new Map<string, { timeMs: number; timeLabel: string }>();
    const timingByDisplayPick = new Map<string, { timeMs: number; timeLabel: string }>();
    const timingByRoundPick   = new Map<string, { timeMs: number; timeLabel: string }>();
    for (const p of parsedPicks) {
      const t = pickTimings.get(p.message_id);
      if (!t) continue;
      const pickNo = (p.round - 1) * teamsForTiming + p.pickInRound;
      timingByPickNo.set(String(pickNo), t);
      timingByDisplayPick.set(p.displayPick, t);                         // "1.02"
      timingByRoundPick.set(`${p.round}.${p.pickInRound}`, t);           // "1.2"
    }

    if (import.meta.env.DEV) {
      const restPicks = draftData?.picks ?? [];
      console.log("[OTC timing diagnostics]", {
        messagesReturned: draftMessages.length,
        parsedPickMessages: parsedPicks.length,
        pickTimingsSize: pickTimings.size,
        timingByPickNoKeys: [...timingByPickNo.keys()].slice(0, 20),
        restPicksCount: restPicks.length,
        sampleRestPicks: restPicks.slice(0, 10).map(p => ({
          pick_no: p.pickNo, round: p.round, draft_slot: p.draftSlot, player_id: p.playerId,
        })),
        sampleMatches: restPicks.slice(0, 10).map(p => ({
          pick_no: p.pickNo,
          displayPick: `${p.round}.${String(p.draftSlot).padStart(2, "0")}`,
          hasTimingByPickNo: timingByPickNo.has(String(p.pickNo)),
          hasTimingByDisplayPick: timingByDisplayPick.has(`${p.round}.${String(p.draftSlot).padStart(2, "0")}`),
        })),
      });
    }

    if (draftState && draftState.picks.length > 0) {
      const teams = draftState.teams;
      // Key by "round-pickInRound" for robust matching — positional-index
      // lookup breaks when message count differs from pick count (e.g. extra
      // bot messages, offline/queued picks without a chat announcement).
      const parsedByRoundPick = new Map<string, ParsedPick>();
      for (const p of parsedPicks) parsedByRoundPick.set(`${p.round}-${p.pickInRound}`, p);

      if (import.meta.env.DEV) {
        const startMsg = draftMessages.find(m => m.author_is_bot && m.text === "This draft has begun!");
        const hasRestTiming = restTimingByNo.size > 0;
        console.log(`[OTC] draftId=${activeDraftId} totalMessages=${draftMessages.length} pickMessages=${parsedPicks.length} draftStatePicks=${draftState.picks.length} draftStartTs=${startMsg?.created ?? "none"} pickTimings=${pickTimings.size} timingByPickNo=${timingByPickNo.size} restTiming=${hasRestTiming}(${restPickedAtByNo.size}picks)`);
        const unmatched = parsedPicks.filter(p => !draftState.picks.some(pk => {
          const r = Math.ceil(pk.pickNo / teams);
          const pi = ((pk.pickNo - 1) % teams) + 1;
          return r === p.round && pi === p.pickInRound;
        }));
        if (unmatched.length) console.log(`[OTC] unmatchedPickMessages=${JSON.stringify(unmatched.map(p => `${p.round}.${p.pickInRound}`))}`);
        const missingRosterId = draftState.picks.filter(pk => pk.playerId && !pk.pickedBy);
        if (missingRosterId.length) console.log(`[OTC] picksMissingPickedBy count=${missingRosterId.length}`, missingRosterId.map(pk => pk.pickNo));
      }

      return draftState.picks.map<MergedPickEntry>((pick) => {
        const round = Math.ceil(pick.pickNo / teams);
        const pickInRound = ((pick.pickNo - 1) % teams) + 1;
        const parsed = parsedByRoundPick.get(`${round}-${pickInRound}`) ?? null;
        const messageTiming = parsed ? (pickTimings.get(parsed.message_id) ?? null) : null;
        // Multi-key fallback: message_id → pick_no → displayPick → REST timestamp chain
        const displayPick = `${round}.${String(pickInRound).padStart(2, "0")}`;
        const timing =
          messageTiming ??
          timingByPickNo.get(String(pick.pickNo)) ??
          timingByDisplayPick.get(displayPick) ??
          restTimingByNo.get(pick.pickNo) ??
          null;
        const pickUser = draftState.usersById[pick.pickedBy] ?? null;
        if (import.meta.env.DEV && pick.pickedBy && !pickUser) {
          console.log(`[OTC] pick ${round}.${pickInRound} missing user for pickedBy=${pick.pickedBy} (source: draftState — not in usersById)`);
        }
        return {
          pick,
          timing,
          user: pickUser,
          isForced: parsed?.forced ?? false,
          timestamp: parsed?.created ?? restPickedAtByNo.get(pick.pickNo) ?? null,
        };
      });
    }

    // No draftState (read-only / no JWT) — synthesize from draftData.picks.
    if (draftData && draftData.picks.length > 0) {
      const teamsCount = draftData.draft?.teams ?? teamCount;
      return [...draftData.picks]
        .filter((p) => p.playerId)
        .sort((a, b) => a.pickNo - b.pickNo)
        .map((p) => {
          const synth: DraftPickNormalized = {
            pickNo: p.pickNo,
            playerId: p.playerId,
            playerName: p.playerName,
            position: p.pos,
            teamAbbr: p.team,
            pickedBy: "",
            isKeeper: false,
            reactions: [],
          } as unknown as DraftPickNormalized;
          // Trade-aware attribution: the pick's roster_id reflects the
          // actual picker (Sleeper stamps it when the pick is made, so a
          // traded pick records the NEW owner). Fall back to slot-based
          // lookup only when the pick record is missing its rosterId.
          const slot = p.draftSlot || ((p.pickNo - 1) % Math.max(teamsCount, 1)) + 1;
          const user = (p.rosterId != null && rosterIdToUser(p.rosterId)) || slotToUser(slot);
          // Multi-key timing lookup: REST timestamp map first, then message-derived maps
          const dpKey = `${p.round}.${String(p.draftSlot).padStart(2, "0")}`;
          const timing =
            restTimingByNo.get(p.pickNo) ??
            timingByPickNo.get(String(p.pickNo)) ??
            timingByDisplayPick.get(dpKey) ??
            timingByRoundPick.get(`${p.round}.${p.draftSlot}`) ??
            null;
          const entry: MergedPickEntry = {
            pick: synth,
            timing,
            user,
            isForced: false,
            timestamp: restPickedAtByNo.get(p.pickNo) ?? p.pickedAt ?? null,
          };
          return entry;
        });
    }

    // Final fallback: message-based picks (JWT set but draftState missing).
    return parsedPicks.map<MergedPickEntry>((p) => ({
      pick: null,
      timing: pickTimings.get(p.message_id) ?? null,
      user: null,
      isForced: p.forced,
      timestamp: p.created,
      _parsed: p,
    }));
  }, [draftState, draftData, parsedPicks, pickTimings, teamCount]);

  // Sleeper's /user/:id/leagues endpoint includes leagues from its public
  // League Browser / marketplace where the user expressed interest and
  // got assigned a placeholder roster slot but isn't actually drafting.
  // Those leak through detectLiveDrafts' roster-ownership check (Sleeper
  // marks them owner_id=userId). To suppress them without hiding legit
  // fresh startups:
  //   - leagues already in useSleeper().leagues (rostered + players) → any
  //     active status passes — covers established leagues with rookie
  //     drafts about to start.
  //   - leagues NOT in useSleeper().leagues → only drafting/paused passes —
  //     blocks marketplace pre_draft noise. Real fresh startups still
  //     surface here as soon as they enter drafting state.
  const portfolioFilteredDrafts = useMemo(() => {
    const rostered = new Set(leagues.map((l) => l.leagueId));
    return liveDrafts
      .filter((ld) => {
        if (rostered.has(ld.leagueId)) return true;
        const isLiveNow = ld.status === "drafting" || ld.status === "paused";
        if (!isLiveNow) {
          // eslint-disable-next-line no-console
          console.log("[LIVE DRAFT DISCOVERY] hidden — non-rostered + not live", {
            league_id: ld.leagueId,
            draft_id: ld.draftId,
            status: ld.status,
          });
          return false;
        }
        return true;
      })
      .map(normalizeFromDetect);
  }, [liveDrafts, leagues]);

  // As soon as the user clicks a draft card, switch to draft-room mode
  // immediately — hide the lobby and show the room shell + loading spinner.
  // Previously used `!!activeLeagueId && !isLoading` which kept the lobby
  // visible during the load, creating an ugly overlap.
  const isDraftRoomActive = !!activeLeagueId;
  return (
    <div className={cn(isDraftRoomActive ? "space-y-3" : "space-y-6")}>
      {!isDraftRoomActive && (
        <div className="hidden md:block">
          <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="live-draft-title">
            Live Draft Board
          </h2>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-sm text-muted-foreground mt-2" data-testid="text-draft-description">
            Track your dynasty drafts in real-time with a visual board layout.
          </p>
        </div>
      )}

      {/* Dashboard + manual-load only appear in lobby mode. Once a draft is
          opened we hide them so the draft room takes the whole canvas — OTC
          and Sleeper draft rooms don't surface the lobby underneath. */}
      {!isDraftRoomActive && (
        <DraftsDashboard
          mockDrafts={mockDrafts}
          realDrafts={portfolioFilteredDrafts}
          isLoading={isDetecting}
          hasScanned={hasScanned}
          scanError={scanError}
          onRefresh={isConnected ? scanForLiveDrafts : undefined}
          onTrack={(d) => handleJoinLiveDraft(d.id, d.leagueId, d.teams)}
          isConnected={isConnected}
        />
      )}

      {isDraftRoomActive && (
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => { setActiveLeagueId(null); setDraftData(null); setActiveDraftIdOverride(null); }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-back-to-drafts"
          >
            <ChevronUp className="w-3.5 h-3.5 rotate-[-90deg]" />
            Back to drafts
          </button>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">Draft Room</span>
        </div>
      )}

      {apiError && (
        <Card className="border-red-500/30">
          <CardContent className="pt-6">
            <p className="text-red-500 text-sm" data-testid="text-error">{apiError}</p>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
            <p className="text-sm text-muted-foreground" data-testid="text-loading-draft">Loading draft data...</p>
          </CardContent>
        </Card>
      )}

      {/* Auth gate — only when the user has NOT connected a Sleeper account
          via the Connect tab. If they're already connected (isConnected),
          we enter the draft room directly; advanced power-user features
          (queue mutations, GraphQL draft state) prompt for their JWT
          *inline* inside the room, not as a hard wall. */}
      {activeLeagueId && !isLoading && !isConnected && (
        <Card className="border-[#d4af37]/40" data-testid="card-auth-gate">
          <CardContent className="py-12 px-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-[#d4af37]/10 mx-auto flex items-center justify-center border border-[#d4af37]/30">
              <Key className="w-7 h-7 text-[#d4af37]" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-foreground" data-testid="text-auth-gate-title">
                Connect Sleeper to track live picks
              </h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                To view real-time draft picks, draft history, and live board updates, connect your Sleeper account from the Connect tab.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
              <Button
                variant="outline"
                onClick={() => { setActiveLeagueId(null); setDraftData(null); setActiveDraftIdOverride(null); }}
                data-testid="button-gate-back"
              >
                Back to Draft List
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeLeagueId && !isLoading && isConnected && (
        <>
          {draftData?.draft?.status === "pre_draft" && (
            <Card className="border-blue-500/30 bg-blue-500/5" data-testid="card-pre-draft-notice">
              <CardContent className="py-4 flex items-center gap-3">
                <Calendar className="w-5 h-5 text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">This draft has not started yet.</p>
                  {draftData.draft.startTime && draftData.draft.startTime > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Scheduled to start {formatScheduledDateTime(draftData.draft.startTime)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {/* Header — prefer the rich GraphQL-backed DraftStateHeader; fall
              back to a REST-only header so the user still sees pick X.YY +
              progress bar without a JWT. */}
          {draftState ? (
            <DraftStateHeader
              ds={draftState}
              currentPickInfo={currentPickInfo}
              draftStateLoading={draftStateLoading}
              myUserId={user?.userId ?? null}
              leagueId={activeLeagueId}
              timerInfo={timerInfo}
            />
          ) : draftData?.draft && (
            <RestDraftHeader
              draft={draftData.draft}
              picksMade={draftData.picks.filter((p) => p.playerId).length}
              currentPickInfo={currentPickInfo}
              timerInfo={timerInfo}
            />
          )}
          {/* Dev-only debug panel — exposes the raw + normalized draft order
              so on-the-clock / header mismatches can be diagnosed without
              opening the GraphQL response by hand. */}
          {import.meta.env.DEV && draftState && (
            <DraftOrderDebugPanel state={draftState} currentPickInfo={currentPickInfo} />
          )}
          {mergedPickHistory.length > 0 && (
            <ManagerTimingsSection
              history={mergedPickHistory}
              teams={draftState?.teams ?? teamCount}
              livePickUserId={currentPickInfo?.currentUserId ?? null}
              liveElapsedMs={
                currentPickInfo && lastPickTimestamp
                  ? Math.max(0, nowTs - lastPickTimestamp)
                  : null
              }
              hasToken={!!sleeperJwt}
              messagesError={messagesError}
              onConnectSleeper={onConnectSleeper}
            />
          )}

          <PlayersPanel
            fullBoard={fullBoard}
            pickedPlayerIds={pickedPlayerIds}
            pickedPlayerNames={pickedPlayerNames}
            realIdResolver={resolveRealSleeperId}
            realTeamResolver={resolveRealTeam}
            myRoster={effectiveMyTeamRoster}
            myRosterLoading={myTeamRosterLoading && !isStartupDraft}
            myRosterError={isStartupDraft ? null : myTeamRosterError}
            hasActiveLeague={!!activeLeagueId}
            isConnected={isConnected}
            defaultOpen={false}
            rosterSlots={myTeamLeagueSlots?.starterPositions ?? null}
            isStartupDraft={isStartupDraft}
            redraftValueBySleeperId={isStartupDraft ? redraftValuesBySleeperId : null}
          />

          {/* Server-mediated draft pick — confirm + submit. On success we
              refetch picks so the board advances immediately. */}
          <DraftPickConfirmModal
            target={draftPickTarget}
            open={draftPickTarget !== null}
            onClose={() => setDraftPickTarget(null)}
            onSuccess={() => {
              setDraftPickTarget(null);
              toast({ title: "Pick submitted.", description: `${draftPickTarget?.player.name ?? ""} drafted.` });
              // Refresh both data sources so the new pick appears and
              // "Best Available" + the board update without polling lag.
              if (activeLeagueId) fetchDraft(activeLeagueId);
              if (activeDraftId && sleeperJwt) loadDraftState(activeDraftId, sleeperJwt);
            }}
          />
          {/* Silently degrade when draftState GraphQL fails — the REST
              fallback above keeps the room useful, so don't show an alarm
              banner for a power-user-only feature. */}

          {/* ── Autopick status bar ─────────────────────────────────────── */}
          {sleeperJwt && activeDraftId && (
            <div className="flex items-center gap-2 px-1" data-testid="section-autopick-status">
              {draftAutopickersLoading && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />Checking autopick…
                </span>
              )}
              {!draftAutopickersLoading && !draftAutopickersError && draftAutopickers.length === 0 && (
                <span className="text-[10px] text-muted-foreground" data-testid="text-no-autopickers">
                  No autopickers detected
                </span>
              )}
              {!draftAutopickersLoading && !draftAutopickersError && draftAutopickers.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap" data-testid="text-autopick-active">
                  <span className="text-[10px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-wide">
                    Autopick Active: {draftAutopickers.length} manager{draftAutopickers.length !== 1 ? "s" : ""}
                  </span>
                  {draftAutopickers.map((ap, idx) => {
                    const label = ap.userId
                      ? (draftState?.usersById[ap.userId]?.displayName ?? `User ${ap.userId}`)
                      : ap.rosterId ? `Roster ${ap.rosterId}`
                      : ap.draftSlot ? `Slot ${ap.draftSlot}`
                      : "Unknown";
                    return (
                      <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium border border-amber-500/30">
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
              {!draftAutopickersLoading && draftAutopickersError && (
                <span className="text-[10px] text-muted-foreground/50" data-testid="text-autopick-error">
                  Autopick status unavailable
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Trophy className="w-4 h-4 text-[#d4af37]" />
              <span className="font-semibold text-foreground" data-testid="text-rankings-title">
                Draft Board
              </span>
              {draftData?.draft && (
                <Badge variant="outline" className="text-xs" data-testid="text-draft-status">
                  {draftData.draft.status === "drafting" ? "LIVE" : draftData.draft.status}
                </Badge>
              )}
              {draftData?.draft?.draftCategory && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    draftData.draft.draftCategory === "rookie"
                      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                      : "border-amber-500/40 text-amber-600 dark:text-amber-400",
                  )}
                  data-testid="text-draft-category"
                >
                  {draftData.draft.draftCategory === "rookie" ? "Rookie Draft" : draftData.draft.draftCategory === "startup" ? "Startup Draft" : draftData.draft.draftCategory}
                </Badge>
              )}
              {teamCount && (
                <span className="text-xs text-muted-foreground" data-testid="text-team-count">
                  · {teamCount} teams
                </span>
              )}
              {draftData && stats.drafted > 0 && (
                <span className="text-xs text-muted-foreground" data-testid="text-board-progress">
                  · {stats.drafted} / {stats.total} picks made
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {draftData?.draft && (
                <>
                  <Button
                    variant={autoRefresh ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    data-testid="button-auto-refresh"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${autoRefresh ? "animate-spin" : ""}`} />
                    {autoRefresh ? "Auto-refresh On" : "Auto-refresh"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fetchDraft()} disabled={isLoading} data-testid="button-refresh">
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Refresh
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30 border border-red-500/40" />QB</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/40" />RB</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500/30 border border-blue-500/40" />WR</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500/30 border border-orange-500/40" />TE</span>
            </div>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded border-2 border-dashed border-border/60" />
              Empty pick
            </span>
            {draftData && (
              <span className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border/40">
                <span className="w-3 h-3 rounded bg-muted/30 border border-border/30 opacity-50" />
                Already drafted
              </span>
            )}
          </div>

          {draftState && draftState.picks.length > 0 && (
            <RecentPicksRail picks={draftState.picks} usersById={draftState.usersById} teams={draftState.teams} />
          )}

          {!draftData && !draftState ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
                <p className="text-sm text-muted-foreground" data-testid="text-loading">Loading draft data…</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-2xl overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <div className="min-w-[700px]" data-testid="draft-board-grid">
                    <div className="grid gap-px bg-border/30" style={{ gridTemplateColumns: `48px repeat(${teamCount}, 1fr)` }}>
                      <div className="bg-muted/50 dark:bg-muted/20 p-1.5 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase">Rd</span>
                      </div>
                      {enhancedSlotHeaders.map((header, i) => {
                        const slot1Based = i + 1;
                        // Autopick can be reported by slot, userId, or rosterId.
                        // Resolve all three against the normalized order.
                        const slotUserId = draftState?.normalizedOrder.slotToUserId[slot1Based] ?? null;
                        const slotRosterId = draftState?.normalizedOrder.slotToRosterId[slot1Based] ?? null;
                        const isAuto = draftAutopickers.some((ap) =>
                          ap.draftSlot === slot1Based ||
                          (ap.userId && slotUserId === ap.userId) ||
                          (ap.rosterId != null && slotRosterId === ap.rosterId)
                        );
                        const displayName = header.displayName.length > 10
                          ? header.displayName.slice(0, 9) + "…"
                          : header.displayName;
                        return (
                          <div
                            key={i}
                            className="bg-muted/50 dark:bg-muted/20 p-1.5 flex flex-col items-center gap-0.5"
                            data-testid={`col-header-${i}`}
                            title={header.displayName}
                          >
                            <SleeperUserAvatar
                              username={header.displayName}
                              avatar={header.avatar}
                              size="xs"
                              compact
                              onClick={
                                header.userId && activeLeagueId
                                  ? () => openManagerIntel({
                                      userId: header.userId!,
                                      username: header.displayName,
                                      avatar: header.avatar,
                                      leagueId: activeLeagueId,
                                    })
                                  : undefined
                              }
                            />
                            <span className="text-[10px] font-semibold text-foreground truncate block leading-tight max-w-full">
                              {displayName}
                            </span>
                            {isAuto && (
                              <span className="inline-block text-[8px] font-bold px-1 py-px rounded bg-[#0b3a7a]/80 text-[#d4af37] border border-[#d4af37]/30 leading-tight" data-testid={`badge-auto-${i}`}>
                                AUTO
                              </span>
                            )}
                          </div>
                        );
                      })}

                      {boardGrid.map((row, roundIdx) => (
                        <Fragment key={`round-${roundIdx}`}>
                          <div className="bg-muted/30 dark:bg-muted/10 p-1.5 flex items-center justify-center border-t border-border/20">
                            <span className="text-xs font-bold text-[#0b3a7a] dark:text-[#d4af37]">{roundIdx + 1}</span>
                          </div>
                          {row.map((cell) => {
                            const hasPick = !!cell.pick && !!cell.pick.playerId;
                            const pos = cell.pick?.pos || "";
                            const pickLabel = `${cell.round}.${String(cell.slot).padStart(2, "0")}`;
                            const fullName = cell.pick?.playerName || "";
                            const nameParts = fullName.split(" ");
                            const firstName = nameParts[0] || "";
                            const lastName = nameParts.slice(1).join(" ") || firstName;
                            const sid = cell.pick?.playerId || "";
                            const hasRealImage = !!sid && !sid.startsWith("rookie_");

                            const posTextColor: Record<string, string> = {
                              QB: "text-red-900 dark-any:text-red-100",
                              RB: "text-emerald-900 dark-any:text-emerald-100",
                              WR: "text-blue-900 dark-any:text-blue-100",
                              TE: "text-orange-900 dark-any:text-orange-100",
                              K:  "text-purple-900 dark-any:text-purple-100",
                            };
                            const posBorderColor: Record<string, string> = {
                              QB: "border-red-500/50",
                              RB: "border-emerald-500/50",
                              WR: "border-blue-500/50",
                              TE: "border-orange-500/50",
                              K:  "border-purple-500/50",
                            };
                            const posGradient: Record<string, string> = {
                              QB: "from-red-200 dark-any:from-red-950",
                              RB: "from-emerald-200 dark-any:from-emerald-950",
                              WR: "from-blue-200 dark-any:from-blue-950",
                              TE: "from-orange-200 dark-any:from-orange-950",
                              K:  "from-purple-200 dark-any:from-purple-950",
                            };

                            // Active-pick + my-pick styling — make these
                            // impossible to miss in the live room.
                            const currentRingClass = cell.isCurrent
                              ? "ring-2 ring-emerald-400 shadow-[0_0_10px_-2px_rgba(52,211,153,0.6)] animate-pulse"
                              : "";
                            const mineAccentClass = cell.isMine && !cell.isCurrent
                              ? "ring-1 ring-[#d4af37]/60"
                              : "";

                            return (
                              <div
                                key={`${cell.round}-${cell.slot}`}
                                className={cn(
                                  "relative overflow-hidden rounded-sm border transition-all min-h-[76px] group/cell",
                                  hasPick
                                    ? cn(POS_CELL_BG[pos] || "bg-muted/20 border-border/30", posBorderColor[pos] || "")
                                    : "bg-background/40 border-dashed border-border/30",
                                  currentRingClass,
                                  mineAccentClass,
                                )}
                                data-testid={`cell-${cell.round}-${cell.slot}`}
                                title={
                                  (hasPick
                                    ? `${pickLabel} · ${fullName} (${pos}) · ${cell.ownerName}`
                                    : `${pickLabel} · ${cell.ownerName}${cell.isCurrent ? " · On the clock" : ""}`)
                                  + (cell.isTraded ? " · Traded pick" : "")
                                }
                              >
                                {cell.isTraded && (
                                  <div
                                    className={cn(
                                      "absolute left-1/2 bottom-[6px] z-30 -translate-x-1/2",
                                      "inline-flex flex-col items-center justify-center gap-px",
                                      "min-w-[52px] max-w-[64px] md:min-w-[58px] md:max-w-[72px]",
                                      "px-[5px] py-[2px] md:px-1.5 md:py-[3px]",
                                      "rounded-md",
                                      "border border-[#ffd75a]/45 text-[#111827]",
                                      "leading-none overflow-hidden",
                                      "pointer-events-none",
                                      "shadow-[0_1px_3px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.1)]",
                                    )}
                                    style={{ background: "linear-gradient(180deg, #d7b83f 0%, #b88f16 100%)" }}
                                    data-testid={`cell-traded-${cell.round}-${cell.slot}`}
                                    title={cell.ownerName ? `Traded pick · ${cell.ownerName}` : "Traded pick"}
                                  >
                                    {cell.isMine ? (
                                      <span className="text-[8px] font-black tracking-wide leading-none">MINE</span>
                                    ) : (
                                      <>
                                        <span className="text-[6px] md:text-[7px] font-black tracking-[0.04em] leading-none opacity-90">
                                          TRADED
                                        </span>
                                        {cell.ownerName && (
                                          <span className="text-[8px] md:text-[9px] font-extrabold leading-none max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                                            {cell.ownerName}
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                                {hasPick ? (
                                  <>
                                    {/* Right-side player image area. Layered:
                                          1) initials fallback (always rendered behind)
                                          2) player headshot (covers initials when it loads;
                                             onError hides it so initials show through)
                                          3) gradient fade into the left text area */}
                                    <div className="absolute right-0 top-0 bottom-0 w-[52%] overflow-hidden pointer-events-none">
                                      <div className={cn(
                                        "absolute inset-0 flex items-center justify-center font-extrabold text-2xl tracking-tight",
                                        posTextColor[pos] || "text-foreground",
                                      )}>
                                        <span className="opacity-30">
                                          {(firstName?.[0] ?? "") + (lastName?.[0] ?? "")}
                                        </span>
                                      </div>
                                      {hasRealImage && (
                                        <img
                                          src={`https://sleepercdn.com/content/nfl/players/${sid}.jpg`}
                                          alt={fullName}
                                          className="absolute inset-0 h-full w-full object-cover object-top"
                                          onError={(e) => {
                                            const img = e.target as HTMLImageElement;
                                            // Try the thumb path; if that also fails, hide
                                            // so the initials underneath show through.
                                            if (!img.dataset.triedThumb) {
                                              img.dataset.triedThumb = "1";
                                              img.src = `https://sleepercdn.com/content/nfl/players/thumb/${sid}.jpg`;
                                            } else {
                                              img.style.display = "none";
                                            }
                                          }}
                                        />
                                      )}
                                      <div className={cn("absolute inset-0 bg-gradient-to-r via-transparent to-transparent", posGradient[pos] || "from-muted")} />
                                    </div>
                                    {/* NFL team logo badge — top-right corner */}
                                    {cell.pick?.team && cell.pick.team !== "FA" && (
                                      <img
                                        src={`https://sleepercdn.com/images/team_logos/nfl/${cell.pick.team.toLowerCase()}.png`}
                                        alt={cell.pick.team}
                                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full ring-1 ring-background/40 bg-[#0a1628] z-20 pointer-events-none"
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                      />
                                    )}
                                    <div className={cn(
                                      "relative z-10 p-1 flex flex-col justify-between min-h-[76px] w-[54%]",
                                      posTextColor[pos] || "text-foreground",
                                    )}>
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-[8.5px] font-extrabold leading-none opacity-90 tabular-nums">
                                          {pickLabel} {pos}
                                        </span>
                                        {cell.pick?.isAutoPick && (
                                          <span className="text-[7px] font-bold px-1 py-px rounded bg-[#0b3a7a]/80 text-[#d4af37] border border-[#d4af37]/30 leading-tight">AUTO</span>
                                        )}
                                      </div>
                                      <div>
                                        <div className="text-[8px] leading-none opacity-75 truncate">{firstName}</div>
                                        <div className="text-[11px] font-bold leading-tight truncate">{lastName}</div>
                                        <div className={cn(
                                          "text-[8px] opacity-70 font-medium mt-0.5 truncate",
                                          cell.isTraded && "invisible",
                                        )}>
                                          {cell.pick?.team || "FA"}
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <div className="relative z-10 flex flex-col justify-between min-h-[76px] p-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-[8.5px] font-extrabold leading-none tabular-nums text-muted-foreground/70">
                                        {pickLabel}
                                      </span>
                                      {cell.isCurrent && (
                                        <span className="text-[7px] font-bold px-1 py-px rounded bg-emerald-500 text-white leading-tight animate-pulse">ON CLOCK</span>
                                      )}
                                      {!cell.isCurrent && cell.isMine && !cell.isTraded && (
                                        <span className="text-[7px] font-bold px-1 py-px rounded bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40 leading-tight">MINE</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {myPicks.length > 0 && (
            <MyPicksPanel
              myPicks={myPicks}
              myUserId={user?.userId ?? null}
              usersById={draftState?.usersById ?? {}}
              teams={draftState?.teams ?? teamCount}
            />
          )}

          {/* ── My Queue ─────────────────────────────────────────────────── */}
          {sleeperJwt && (
            <Card data-testid="card-my-queue">
              <CardContent className="pt-5 pb-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                    <span className="text-sm font-semibold">My Queue</span>
                    {draftQueue.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">{draftQueue.length}</Badge>
                    )}
                    {queueLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  {activeDraftId && (
                    <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs"
                      onClick={() => refreshQueue(activeDraftId, sleeperJwt!)}
                      disabled={queueLoading} data-testid="button-refresh-queue">
                      <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                    </Button>
                  )}
                </div>

                {queueError && (
                  <p className="text-xs text-red-500" data-testid="text-queue-error">{queueError}</p>
                )}

                {!queueLoading && draftQueue.length === 0 && !queueError && (
                  <p className="text-xs text-muted-foreground text-center py-3" data-testid="text-queue-empty">
                    No queued players yet
                  </p>
                )}

                {draftQueue.length > 0 && (
                  <div className="space-y-1" data-testid="list-queue-players">
                    {draftQueue.map((playerId, idx) => {
                      const p = draftData?.players?.[playerId];
                      const name = p?.name ?? playerId;
                      const pos = p?.pos ?? "";
                      const team = p?.team ?? "";
                      const rankIdx = fullBoard.findIndex((bp) => bp.sleeperId === playerId);
                      const rank = rankIdx >= 0 ? rankIdx + 1 : undefined;
                      const isDrafted = pickedPlayerIds.has(playerId);
                      const posColors: Record<string, string> = {
                        QB: "text-red-600 dark:text-red-400",
                        RB: "text-emerald-600 dark:text-emerald-400",
                        WR: "text-blue-600 dark:text-blue-400",
                        TE: "text-orange-500 dark:text-orange-400",
                      };
                      const posBorderColors: Record<string, string> = {
                        QB: "border-red-500/30",
                        RB: "border-emerald-500/30",
                        WR: "border-blue-500/30",
                        TE: "border-orange-500/30",
                      };
                      const moveUp = () => {
                        if (idx === 0) return;
                        const next = [...draftQueue];
                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                        queueMutate(next);
                      };
                      const moveDown = () => {
                        if (idx === draftQueue.length - 1) return;
                        const next = [...draftQueue];
                        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                        queueMutate(next);
                      };
                      const remove = () => queueMutate(draftQueue.filter(id => id !== playerId));
                      return (
                        <div key={playerId}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs transition-colors group ${
                            isDrafted
                              ? "opacity-40 border-border/20 bg-muted/10"
                              : `border-border/30 bg-muted/20 ${pos ? posBorderColors[pos] || "" : ""}`
                          }`}
                          data-testid={`queue-player-${playerId}`}>
                          {/* Reorder buttons */}
                          {!isDrafted && (
                            <div className="flex flex-col gap-0 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={moveUp} disabled={idx === 0 || isUpdatingQueue}
                                className="p-0.5 rounded hover:bg-muted/60 disabled:opacity-30 transition-colors"
                                data-testid={`button-queue-up-${playerId}`}>
                                <ArrowUp className="w-2.5 h-2.5 text-muted-foreground" />
                              </button>
                              <button onClick={moveDown} disabled={idx === draftQueue.length - 1 || isUpdatingQueue}
                                className="p-0.5 rounded hover:bg-muted/60 disabled:opacity-30 transition-colors"
                                data-testid={`button-queue-down-${playerId}`}>
                                <ArrowDown className="w-2.5 h-2.5 text-muted-foreground" />
                              </button>
                            </div>
                          )}
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-4 flex-shrink-0 text-right">
                            {idx + 1}
                          </span>
                          {pos && (
                            <span className={`text-[10px] font-bold flex-shrink-0 w-6 ${posColors[pos] || "text-muted-foreground"}`}>
                              {pos}
                            </span>
                          )}
                          <span className={`font-semibold truncate flex-1 ${isDrafted ? "text-muted-foreground line-through" : "text-foreground"}`}>
                            {name}
                          </span>
                          {team && <span className="text-[10px] text-muted-foreground flex-shrink-0">{team}</span>}
                          {rank && !isDrafted && (
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">#{rank}</span>
                          )}
                          {isDrafted ? (
                            <Badge variant="outline" className="text-[9px] px-1 h-4 border-border/40 text-muted-foreground flex-shrink-0">
                              Drafted
                            </Badge>
                          ) : (
                            <button onClick={remove} disabled={isUpdatingQueue}
                              className="flex-shrink-0 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30"
                              data-testid={`button-queue-remove-${playerId}`}>
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Draft Log ─────────────────────────────────────────────────── */}
          <Card data-testid="card-draft-log">
            <CardContent className="pt-5 pb-4 space-y-4">

              {/* Header row */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                  <span className="text-sm font-semibold">Draft Log</span>
                  {draftStarted && (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                      Draft Started
                    </Badge>
                  )}
                  {parsedPicks.some(p => p.forced) && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Forced Pick
                    </Badge>
                  )}
                  {messagesLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-2">
                  {sleeperJwt && activeDraftId && (
                    <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs"
                      onClick={() => refreshMessages(activeDraftId, sleeperJwt)}
                      disabled={messagesLoading} data-testid="button-refresh-messages">
                      <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                    </Button>
                  )}
                </div>
              </div>

              {/* Sleeper auth status — shows connection state; no manual input needed */}
              <div className="flex items-center gap-2 text-xs" data-testid="section-sleeper-auth-status">
                {sleeperJwt ? (
                  <>
                    <Key className="w-3.5 h-3.5 text-[#d4af37] shrink-0" />
                    <span className="text-muted-foreground">Sleeper connected, timing active</span>
                  </>
                ) : (
                  <>
                    {accessLevel === "guest" || accessLevel === "readonly" ? (
                      <Wifi className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-muted-foreground/70">Sleeper not connected</span>
                    {onConnectSleeper && (
                      <button
                        onClick={onConnectSleeper}
                        className="ml-auto h-6 px-2.5 text-[10px] font-semibold rounded-md bg-[#d4af37]/90 hover:bg-[#d4af37] text-[#0b3a7a] transition-colors"
                        data-testid="button-draft-log-connect-sleeper"
                      >
                        Connect Sleeper
                      </button>
                    )}
                  </>
                )}
              </div>
              {/* Advanced: dev-only manual JWT paste (hidden by default) */}
              {import.meta.env.DEV && (
                <div data-testid="section-dev-jwt">
                  <button
                    onClick={() => setShowDevJwtInput((v) => !v)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    data-testid="button-toggle-dev-jwt"
                  >
                    <ChevronDown className={cn("w-3 h-3 transition-transform", showDevJwtInput && "rotate-180")} />
                    Advanced: Paste Sleeper JWT
                  </button>
                  {showDevJwtInput && (
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <input
                        type="password"
                        className="flex-1 min-w-0 h-7 px-2.5 text-xs rounded-md border border-border/60 bg-muted/30 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50"
                        placeholder="Dev only: paste Sleeper JWT…"
                        value={devJwtInput}
                        onChange={(e) => setDevJwtInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveDevJwt()}
                        data-testid="input-dev-sleeper-jwt"
                      />
                      <button
                        onClick={saveDevJwt}
                        disabled={!devJwtInput.trim()}
                        className="h-7 px-3 text-xs rounded-md bg-[#d4af37]/90 hover:bg-[#d4af37] text-[#0b3a7a] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                        data-testid="button-save-dev-jwt"
                      >
                        {devJwtSaved ? <><Check className="w-3 h-3 inline mr-1" />Saved</> : "Save"}
                      </button>
                      {sleeperJwt && (
                        <button
                          onClick={clearDevJwt}
                          className="h-7 px-2 text-xs rounded border border-border/40 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          data-testid="button-clear-dev-jwt"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {messagesError && (
                <div className="flex items-center gap-2 text-xs text-red-500" data-testid="text-messages-error">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{messagesError}</span>
                </div>
              )}

              {/* Pick history — uses draftState.picks (primary) + message timing (secondary) */}
              {mergedPickHistory.length > 0 && (
                <div className="space-y-2" data-testid="section-pick-history">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Pick History ({mergedPickHistory.length} total)
                    </p>
                    {mergedPickHistory.length > 5 && (
                      <button onClick={() => setShowFullLog(v => !v)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        data-testid="button-toggle-full-log">
                        {showFullLog ? <><ChevronUp className="w-3 h-3" />Less</> : <><ChevronDown className="w-3 h-3" />Full Log</>}
                      </button>
                    )}
                  </div>

                  {/* Pick rows */}
                  <div className="space-y-1" data-testid="list-pick-rows">
                    {(showFullLog
                      ? mergedPickHistory
                      : [...mergedPickHistory].reverse().slice(0, 5)
                    ).map((entry, idx) => {
                      const p = entry.pick;
                      const teams2 = draftState?.teams ?? teamCount;
                      const round = p ? Math.ceil(p.pickNo / teams2) : ((entry as any)._parsed?.round ?? 0);
                      const pickInRound = p ? ((p.pickNo - 1) % teams2) + 1 : ((entry as any)._parsed?.pickInRound ?? 0);
                      const playerName = p ? p.playerName : ((entry as any)._parsed?.playerName ?? "");
                      const position = p ? p.position : ((entry as any)._parsed?.position ?? "");
                      const teamAbbr = p ? p.teamAbbr : ((entry as any)._parsed?.team ?? "");
                      const ownerName = entry.user?.displayName || "";
                      const ownerAvatar = entry.user?.avatar ?? null;
                      const playerId = p?.playerId ?? "";
                      return (
                        <div key={p ? p.pickNo : idx}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                            entry.isForced
                              ? "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20"
                              : "border-border/30 bg-muted/20"
                          }`}
                          data-testid={`pick-row-${p ? p.pickNo : idx}`}>
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums flex-shrink-0 w-8">
                            {round}.{String(pickInRound).padStart(2, "0")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <PlayerAvatar
                              id={playerId}
                              name={playerName || "—"}
                              pos={position}
                              team={teamAbbr}
                              size="xs"
                            />
                          </div>
                          {ownerName && (
                            <>
                              {/* Mobile: avatar circle only — saves space */}
                              <div className="sm:hidden flex-shrink-0" title={ownerName}>
                                <SleeperUserAvatar
                                  username={ownerName}
                                  avatar={ownerAvatar}
                                  size="xs"
                                  compact
                                />
                              </div>
                              {/* Desktop: avatar + name */}
                              <div className="hidden sm:flex flex-shrink-0 max-w-[140px]" title={ownerName}>
                                <SleeperUserAvatar
                                  username={ownerName}
                                  avatar={ownerAvatar}
                                  size="xs"
                                />
                              </div>
                            </>
                          )}
                          {/* Approx. time used — from draft room messages */}
                          {entry.timing ? (
                            <span className={`text-[10px] tabular-nums flex-shrink-0 font-mono ${
                              entry.timing.timeMs > 5 * 60 * 1000
                                ? "text-red-500 dark:text-red-400"
                                : entry.timing.timeMs > 2 * 60 * 1000
                                  ? "text-amber-500 dark:text-amber-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                            }`} data-testid={`pick-time-${p ? p.pickNo : idx}`}>
                              {entry.timing.timeLabel}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/30 flex-shrink-0 font-mono tabular-nums">—</span>
                          )}
                          {entry.isForced && (
                            <span className="text-[10px] text-amber-500 dark:text-amber-400 flex-shrink-0 font-medium">Forced</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state — applies regardless of token status; the pick
                  history now falls back to public Sleeper picks when no JWT
                  is set, so an empty log just means no picks yet. */}
              {!messagesLoading && mergedPickHistory.length === 0 && !messagesError && (
                <p className="text-xs text-muted-foreground text-center py-3" data-testid="text-no-picks-yet">
                  {draftStarted ? "Draft has started. No picks logged yet." : "Waiting for draft picks…"}
                </p>
              )}

            </CardContent>
          </Card>

        </>
      )}
    </div>
  );
}
