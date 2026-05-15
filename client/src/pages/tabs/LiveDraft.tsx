import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, RefreshCw, Trophy, Target, Radio, Zap, MessageSquare, Key, AlertTriangle, ChevronDown, ChevronUp, ArrowUp, ArrowDown, X, Plus, Calendar, Clock, UserCircle, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { detectLiveDrafts as detectLiveDraftsApi, fetchDraftBoard as fetchDraftBoardApi, fetchDraftState, getDraftQueue, getDraftAutopickers, updateDraftQueue as updateDraftQueueApi } from "@/lib/sleeperApi";
import type { DraftState, DraftUser, DraftPickNormalized, DraftAutopickerStatus } from "@/lib/sleeperApi";
import { ROOKIE_BOARD_2026_SF, ROOKIE_BOARD_2026_1QB } from "@/data/rookieBoard2026";

// ── Normalized draft model — abstracted from raw Sleeper format ───────────────
// UI components consume DraftSummary only; never reference raw Sleeper shapes directly.
interface DraftSummary {
  id: string;
  leagueId: string;
  leagueName: string;
  leagueAvatar: string | null;
  status: "pre_draft" | "drafting" | "complete";
  type: "snake" | "linear" | "auction";
  category: "rookie" | "startup" | "redraft";
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
  isMyTurn: boolean;
  isLive: boolean;
}

function getCategoryLabel(cat: DraftSummary["category"]): string {
  return cat === "rookie" ? "Rookie" : cat === "startup" ? "Startup" : "Redraft";
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

// Normalizer: LiveDraftInfo → DraftSummary (populated after real scan)
function normalizeFromDetect(ld: LiveDraftInfo): DraftSummary {
  return {
    id: ld.draftId,
    leagueId: ld.leagueId,
    leagueName: ld.leagueName,
    leagueAvatar: null,
    status: ld.status === "drafting" ? "drafting" : ld.status === "complete" ? "complete" : "pre_draft",
    type: (["snake", "linear", "auction"].includes(ld.type) ? ld.type : "snake") as DraftSummary["type"],
    category: (ld.draftCategory === "rookie" ? "rookie" : ld.draftCategory === "startup" ? "startup" : "redraft") as DraftSummary["category"],
    season: ld.season,
    rounds: ld.rounds,
    teams: ld.teams,
    picksMade: ld.picksMade,
    totalPicks: ld.totalPicks,
    currentPickNumber: ld.picksMade + 1,
    picksAway: null,
    mySlot: null,
    startTime: null,
    timerSeconds: null,
    isMyTurn: false,
    isLive: ld.status === "drafting",
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
      timerSeconds: 90, isMyTurn: true, isLive: true,
    },
    {
      id: "mock-active-2", leagueId: "mock-lg-2", leagueName: "StatChasers Main",
      leagueAvatar: null, status: "drafting", type: "snake", category: "startup",
      season: "2026", rounds: 24, teams: 10, picksMade: 143, totalPicks: 240,
      currentPickNumber: 144, picksAway: 3, mySlot: 5, startTime: null,
      timerSeconds: 120, isMyTurn: false, isLive: true,
    },
    {
      id: "mock-upcoming-1", leagueId: "mock-lg-3", leagueName: "Winners Only Dynasty",
      leagueAvatar: null, status: "pre_draft", type: "snake", category: "rookie",
      season: "2026", rounds: 5, teams: 12, picksMade: 0, totalPicks: 60,
      currentPickNumber: 0, picksAway: null, mySlot: 7,
      startTime: now + 2.5 * 3600 * 1000, timerSeconds: 60, isMyTurn: false, isLive: false,
    },
    {
      id: "mock-upcoming-2", leagueId: "mock-lg-4", leagueName: "The Dynasty Files",
      leagueAvatar: null, status: "pre_draft", type: "linear", category: "startup",
      season: "2026", rounds: 24, teams: 14, picksMade: 0, totalPicks: 336,
      currentPickNumber: 0, picksAway: null, mySlot: 3,
      startTime: now + 27 * 3600 * 1000, timerSeconds: null, isMyTurn: false, isLive: false,
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
}

interface DraftSlot {
  slot: number;
  rosterId: number;
  displayName: string;
}

interface DraftResponse {
  draft: DraftInfo | null;
  picks: DraftPick[];
  players: Record<string, { name: string; pos: string; team: string }>;
  draftSlots: DraftSlot[];
  error: string | null;
}

interface LiveDraftInfo {
  leagueId: string;
  leagueName: string;
  draftId: string;
  status: string;
  type: string;
  draftCategory: string;
  season: string;
  rounds: number;
  teams: number;
  picksMade: number;
  totalPicks: number;
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
  playerName: string;
  position: string;
  team: string;
  forced: boolean;
  created: number;
}

const SLEEPER_JWT_KEY = "dc-sleeper-draft-jwt";

const PICK_RE = /^Pick (\d+)\.(\d+) - Pick: (.+?) \((\w+) - (\w+)\)$/;
const FORCED_RE = /^Pick (\d+)\.(\d+) - Commish forced pick: (.+?) \((\w+) - (\w+)\)$/;

function parsePickMessage(msg: DraftMessage): ParsedPick | null {
  const forced = FORCED_RE.exec(msg.text);
  if (forced) {
    return { message_id: msg.message_id, round: +forced[1], pickInRound: +forced[2], playerName: forced[3], position: forced[4], team: forced[5], forced: true, created: msg.created };
  }
  const normal = PICK_RE.exec(msg.text);
  if (normal) {
    return { message_id: msg.message_id, round: +normal[1], pickInRound: +normal[2], playerName: normal[3], position: normal[4], team: normal[5], forced: false, created: msg.created };
  }
  return null;
}

async function fetchDraftMessages(draftId: string, jwt: string): Promise<DraftMessage[]> {
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: {
      "authorization": jwt,
      "x-sleeper-graphql-op": "messages",
      "content-type": "application/json",
    },
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
  QB: "bg-red-500/25 dark:bg-red-500/30 border-red-500/40 text-red-900 dark:text-red-200",
  RB: "bg-emerald-500/25 dark:bg-emerald-500/30 border-emerald-500/40 text-emerald-900 dark:text-emerald-200",
  WR: "bg-blue-500/25 dark:bg-blue-500/30 border-blue-500/40 text-blue-900 dark:text-blue-200",
  TE: "bg-orange-500/25 dark:bg-orange-500/30 border-orange-500/40 text-orange-900 dark:text-orange-200",
  K: "bg-purple-500/20 dark:bg-purple-500/25 border-purple-500/30 text-purple-900 dark:text-purple-200",
  DEF: "bg-slate-500/20 dark:bg-slate-500/25 border-slate-500/30 text-slate-900 dark:text-slate-200",
};

const POS_CELL_PROJECTION: Record<string, string> = {
  QB: "bg-red-500/8 dark:bg-red-500/10 border-red-500/15 text-red-800/60 dark:text-red-300/50",
  RB: "bg-emerald-500/8 dark:bg-emerald-500/10 border-emerald-500/15 text-emerald-800/60 dark:text-emerald-300/50",
  WR: "bg-blue-500/8 dark:bg-blue-500/10 border-blue-500/15 text-blue-800/60 dark:text-blue-300/50",
  TE: "bg-orange-500/8 dark:bg-orange-500/10 border-orange-500/15 text-orange-800/60 dark:text-orange-300/50",
  K: "bg-purple-500/5 dark:bg-purple-500/8 border-purple-500/10 text-purple-800/50 dark:text-purple-300/40",
  DEF: "bg-slate-500/5 dark:bg-slate-500/8 border-slate-500/10 text-slate-800/50 dark:text-slate-300/40",
};

const POS_BADGE_SM: Record<string, string> = {
  QB: "text-red-600 dark:text-red-400",
  RB: "text-emerald-600 dark:text-emerald-400",
  WR: "text-blue-600 dark:text-blue-400",
  TE: "text-orange-600 dark:text-orange-400",
};

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

// ── DraftCard ─────────────────────────────────────────────────────────────────
function DraftCard({ draft, onTrack }: { draft: DraftSummary; onTrack?: () => void }) {
  const pct = draft.totalPicks > 0 ? Math.round((draft.picksMade / draft.totalPicks) * 100) : 0;
  const meta = [
    getCategoryLabel(draft.category),
    getTypeLabel(draft.type),
    `${draft.teams}T`,
    `${draft.rounds}R`,
  ].join(" · ");

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all hover:border-[#d4af37]/30 hover:shadow-sm",
        draft.isMyTurn && "border-[#d4af37]/60 shadow-[0_0_0_1px_rgba(212,175,55,0.1)]"
      )}
      data-testid={`draft-card-${draft.id}`}
    >
      {draft.isMyTurn && (
        <div className="h-0.5 w-full bg-gradient-to-r from-[#d4af37]/30 via-[#d4af37] to-[#d4af37]/30" />
      )}
      <div className="p-4 space-y-3">
        {/* Identity + badges */}
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
            {draft.isLive && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500 text-white" data-testid={`badge-live-${draft.id}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                LIVE
              </span>
            )}
            {draft.isLive && draft.picksAway !== null && (
              draft.picksAway === 0 ? (
                <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#d4af37] text-[#0b3a7a]" data-testid={`badge-your-pick-${draft.id}`}>
                  YOUR PICK
                </span>
              ) : (
                <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] border border-amber-500/40 text-amber-600 dark:text-amber-400" data-testid={`badge-picks-away-${draft.id}`}>
                  {draft.picksAway} away
                </span>
              )
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
              <span>Pick {draft.currentPickNumber} of {draft.totalPicks}</span>
              {draft.timerSeconds != null && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />{draft.timerSeconds}s/pick
                </span>
              )}
            </div>
          </div>
        )}

        {/* Start time — upcoming */}
        {!draft.isLive && draft.startTime != null && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>{formatStartTime(draft.startTime)}</span>
            {draft.mySlot != null && (
              <><span className="text-border/50">·</span><span>Slot {draft.mySlot}</span></>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-0.5">
          {draft.isLive && draft.mySlot != null ? (
            <span className="text-[11px] text-muted-foreground">Slot {draft.mySlot}</span>
          ) : <span />}
          <Button
            size="sm"
            className={cn(
              "h-7 text-xs gap-1.5",
              draft.isMyTurn
                ? "bg-[#d4af37] hover:bg-[#d4af37]/90 text-[#0b3a7a] font-bold"
                : "bg-[#0b3a7a] hover:bg-[#0b3a7a]/80 text-white"
            )}
            onClick={onTrack}
            data-testid={`button-track-${draft.id}`}
          >
            <Target className="w-3.5 h-3.5" />
            {draft.isMyTurn ? "Pick Now" : draft.isLive ? "Track" : "View"}
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
  const active = displayDrafts.filter(d => d.isLive);
  const upcoming = displayDrafts.filter(d => !d.isLive && d.status !== "complete");

  return (
    <div className="space-y-5" data-testid="drafts-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h3 className="text-base font-bold text-foreground">Your Drafts</h3>
          {active.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-500 border border-red-500/25" data-testid="badge-active-count">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
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

      {/* Active Drafts */}
      {active.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active Drafts</span>
            <span className="flex-1 h-px bg-border/40" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="grid-active-drafts">
            {active.map(d => <DraftCard key={d.id} draft={d} onTrack={() => onTrack(d)} />)}
          </div>
        </div>
      )}

      {/* Upcoming Drafts */}
      {upcoming.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Upcoming Drafts</span>
            <span className="flex-1 h-px bg-border/40" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="grid-upcoming-drafts">
            {upcoming.map(d => <DraftCard key={d.id} draft={d} onTrack={() => onTrack(d)} />)}
          </div>
        </div>
      )}

      {/* Empty state — only when real data has been scanned and is genuinely empty */}
      {active.length === 0 && upcoming.length === 0 && !isLoading && hasScanned && !isMock && (
        <div className="flex flex-col items-center justify-center py-10 text-center" data-testid="drafts-empty">
          <Trophy className="w-8 h-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No drafts found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Active and upcoming drafts will appear here automatically</p>
        </div>
      )}
    </div>
  );
}

// ── DraftStateHeader ─────────────────────────────────────────────────────────
function DraftStateHeader({ ds, currentPickInfo, draftStateLoading, myUserId }: {
  ds: DraftState;
  currentPickInfo: CurrentPickInfo | null;
  draftStateLoading: boolean;
  myUserId: string | null;
}) {
  const totalPicks = ds.teams * ds.rounds;
  const pct = totalPicks > 0 ? Math.min(100, Math.round((ds.picks.length / totalPicks) * 100)) : 0;
  const isLive = ds.status === "drafting";
  const isComplete = ds.status === "complete" || ds.picks.length >= totalPicks;
  const typeLabel = ds.type === "linear" ? "Linear" : ds.type === "snake" ? "Snake" : ds.type;

  return (
    <Card
      className={cn("overflow-hidden", currentPickInfo?.isMyTurn && "border-[#d4af37]/60 shadow-[0_0_0_1px_rgba(212,175,55,0.1)]")}
      data-testid="draft-state-header"
    >
      {currentPickInfo?.isMyTurn && (
        <div className="h-0.5 w-full bg-gradient-to-r from-[#d4af37]/30 via-[#d4af37] to-[#d4af37]/30" />
      )}
      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Name + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-foreground truncate" data-testid="text-draft-state-name">{ds.name}</h3>
              {isLive && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500 text-white shrink-0" data-testid="badge-state-live">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />LIVE
                </span>
              )}
              {isComplete && (
                <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0" data-testid="badge-state-complete">
                  Complete
                </span>
              )}
              {draftStateLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {ds.season} · {typeLabel} · {ds.teams} teams · {ds.rounds} rounds
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="w-full h-1.5 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#0b3a7a] to-[#d4af37] rounded-full transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span data-testid="text-state-picks-progress">{ds.picks.length} of {totalPicks} picks · {pct}% complete</span>
            {currentPickInfo && <span>{currentPickInfo.picksRemaining} remaining</span>}
          </div>
        </div>

        {/* On the clock + picks away + timer — live only */}
        {isLive && currentPickInfo && (
          <div className="flex items-center gap-4 flex-wrap border-t border-border/30 pt-3">
            {/* On the clock */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="shrink-0">
                {currentPickInfo.currentUser?.avatar ? (
                  <img
                    src={`https://sleepercdn.com/avatars/thumbs/${currentPickInfo.currentUser.avatar}`}
                    className="w-8 h-8 rounded-full border border-border/50"
                    alt=""
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#0b3a7a]/10 border border-border/40 flex items-center justify-center">
                    <UserCircle className="w-5 h-5 text-[#0b3a7a] dark:text-blue-400" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">On the Clock</p>
                <p className="text-sm font-bold text-foreground truncate" data-testid="text-on-clock">
                  {currentPickInfo.currentUser?.displayName || "—"}
                </p>
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

            {/* Timer */}
            <div className="text-center shrink-0 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Timer</p>
              {ds.pickTimer > 0 ? (
                <p className="text-sm font-semibold text-foreground" data-testid="text-pick-timer">{ds.pickTimer}s</p>
              ) : (
                <p className="text-xs font-medium text-muted-foreground" data-testid="text-no-timer">None</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
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
            {pickUser && <span className="text-[8px] opacity-50 leading-none truncate">{pickUser.displayName}</span>}
          </div>
        );
      })}
    </div>
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
  const posColors: Record<string, string> = {
    QB: "text-red-600 dark:text-red-400",
    RB: "text-emerald-600 dark:text-emerald-400",
    WR: "text-blue-600 dark:text-blue-400",
    TE: "text-orange-500 dark:text-orange-400",
  };

  return (
    <Card data-testid="my-picks-panel">
      <CardContent className="pt-4 pb-4 space-y-2.5">
        <div className="flex items-center gap-2">
          {myUser?.avatar ? (
            <img src={`https://sleepercdn.com/avatars/thumbs/${myUser.avatar}`} className="w-5 h-5 rounded-full border border-border/40" alt="" />
          ) : (
            <UserCircle className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm font-semibold">My Picks</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">{myPicks.length}</Badge>
        </div>
        {myPicks.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">No picks yet</p>
        ) : (
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {myPicks.map(pick => {
              const round = Math.ceil(pick.pickNo / teams);
              const pickInRound = ((pick.pickNo - 1) % teams) + 1;
              return (
                <div key={pick.pickNo} className="flex items-center gap-2 text-xs py-1 border-b border-border/15 last:border-0" data-testid={`my-pick-${pick.pickNo}`}>
                  <span className="text-[10px] font-mono text-muted-foreground w-8 shrink-0 tabular-nums">
                    {round}.{String(pickInRound).padStart(2, "0")}
                  </span>
                  <span className={cn("text-[10px] font-bold w-6 shrink-0", posColors[pick.position] || "text-muted-foreground")}>
                    {pick.position}
                  </span>
                  <span className="font-semibold text-foreground truncate flex-1">{pick.playerName}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{pick.teamAbbr}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LiveDraft() {
  const [leagueIdInput, setLeagueIdInput] = useState("");
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
  const { dynastyPlayerList, redraftValuesBySleeperId } = useValueModel();
  const [rankMode, setRankMode] = useState<"dynasty" | "redraft">("dynasty");
  const [rookieFormat, setRookieFormat] = useState<"SF" | "1QB">("1QB");
  const [manualRookieMode, setManualRookieMode] = useState(false);
  const { isConnected, user, leagues } = useSleeper();
  const mockDrafts = useMemo(() => getMockDraftSummaries(), []);

  // ── Draft log / message history ──────────────────────────────────────────
  const [sleeperJwt, setSleeperJwt] = useState<string | null>(null);
  const [jwtInput, setJwtInput] = useState("");
  const [showJwtInput, setShowJwtInput] = useState(false);
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

  // ── Autopickers ───────────────────────────────────────────────────────────────
  const [draftAutopickers, setDraftAutopickers] = useState<DraftAutopickerStatus[]>([]);
  const [draftAutopickersLoading, setDraftAutopickersLoading] = useState(false);
  const [draftAutopickersError, setDraftAutopickersError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(SLEEPER_JWT_KEY);
    if (saved) setSleeperJwt(saved);
  }, []);

  const activeDraftId = draftData?.draft?.draftId ?? null;

  const refreshMessages = useCallback(async (draftId: string, jwt: string) => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const msgs = await fetchDraftMessages(draftId, jwt);
      const sorted = [...msgs].sort((a, b) => a.created - b.created);
      setDraftMessages(sorted);
      setDraftStarted(sorted.some(m => m.text === "This draft has begun!"));
    } catch (e: any) {
      setMessagesError(e.message || "Failed to load draft log");
    } finally {
      setMessagesLoading(false);
    }
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
    if (!sleeperJwt) { setShowJwtInput(true); return; }
    if (!activeDraftId) return;
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

  // Fetch all live data whenever activeDraftId + JWT are both available
  useEffect(() => {
    if (activeDraftId && sleeperJwt) {
      setDraftMessages([]);
      setDraftQueue([]);
      refreshMessages(activeDraftId, sleeperJwt);
      refreshQueue(activeDraftId, sleeperJwt);
      loadDraftState(activeDraftId, sleeperJwt);
      loadAutopickers(activeDraftId, sleeperJwt);
    }
  }, [activeDraftId, sleeperJwt, refreshMessages, refreshQueue, loadDraftState, loadAutopickers]);

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

  const handleJoinLiveDraft = (leagueId: string, teams: number) => {
    setLeagueIdInput(leagueId);
    setDraftData(null);
    setApiError(null);
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
      const data: DraftResponse = await fetchDraftBoardApi(targetId);
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
  }, [activeLeagueId]);

  useEffect(() => {
    if (activeLeagueId) fetchDraft(activeLeagueId);
  }, [activeLeagueId]);

  useEffect(() => {
    if (autoRefresh && activeLeagueId) {
      intervalRef.current = setInterval(() => {
        fetchDraft();
        if (activeDraftId && sleeperJwt) {
          refreshMessages(activeDraftId, sleeperJwt);
          refreshQueue(activeDraftId, sleeperJwt);
        }
      }, 45000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, activeLeagueId, activeDraftId, sleeperJwt, fetchDraft, refreshMessages, refreshQueue]);

  const redraftPlayerList = useMemo(() => {
    if (!redraftValuesBySleeperId || Object.keys(redraftValuesBySleeperId).length === 0) return dynastyPlayerList;
    return [...dynastyPlayerList]
      .map(p => ({ ...p, redraftValue: redraftValuesBySleeperId[p.sleeperId] ?? 0 }))
      .sort((a, b) => b.redraftValue - a.redraftValue);
  }, [dynastyPlayerList, redraftValuesBySleeperId]);

  // Rounds ≤ 6 = rookie; > 6 = startup. Also honour explicit draftCategory.
  const isRookieDraft =
    draftData?.draft?.draftCategory === "rookie" ||
    (!!draftData?.draft && draftData.draft.draftCategory !== "startup" && draftData.draft.rounds <= 6);
  const effectiveRookieMode = isRookieDraft || manualRookieMode;

  // Auto-detect SF vs 1QB from the connected user's league list
  useEffect(() => {
    if (!effectiveRookieMode || !activeLeagueId) return;
    const league = leagues.find(l => l.leagueId === activeLeagueId);
    if (league) {
      const isSF = league.rosterPositions.includes("SUPER_FLEX");
      setRookieFormat(isSF ? "SF" : "1QB");
    }
  }, [effectiveRookieMode, activeLeagueId, leagues]);

  // Sync manualRookieMode with auto-detected isRookieDraft when draft loads
  useEffect(() => {
    if (isRookieDraft) setManualRookieMode(true);
  }, [isRookieDraft]);

  const fullBoard = useMemo(() => {
    if (effectiveRookieMode) {
      return rookieFormat === "SF" ? ROOKIE_BOARD_2026_SF : ROOKIE_BOARD_2026_1QB;
    }
    const list = rankMode === "redraft" ? redraftPlayerList : dynastyPlayerList;
    return list.slice(0, 300);
  }, [effectiveRookieMode, rookieFormat, rankMode, dynastyPlayerList, redraftPlayerList]);

  const globalRankMap = useMemo(() => {
    const map = new Map<string, number>();
    fullBoard.forEach((p, i) => map.set(p.sleeperId, i + 1));
    return map;
  }, [fullBoard]);

  const posRankMap = useMemo(() => {
    const map = new Map<string, number>();
    const counters: Record<string, number> = {};
    for (const p of fullBoard) {
      counters[p.pos] = (counters[p.pos] || 0) + 1;
      map.set(p.sleeperId, counters[p.pos]);
    }
    return map;
  }, [fullBoard]);

  const pickedPlayerIds = useMemo(() => {
    if (!draftData) return new Set<string>();
    return new Set(draftData.picks.map(p => p.playerId).filter(Boolean));
  }, [draftData]);

  const boardGrid = useMemo(() => {
    const rounds = draftData?.draft?.rounds || Math.ceil(fullBoard.length / teamCount);
    const effectiveRounds = Math.min(rounds, Math.ceil(fullBoard.length / teamCount));
    const grid: Array<Array<{ rank: number; player: typeof fullBoard[0] | null; pick: DraftPick | null; isSnake: boolean; isDrafted: boolean }>> = [];

    const pickMap = new Map<string, DraftPick>();
    if (draftData) {
      for (const p of draftData.picks) {
        const key = `${p.round}-${p.draftSlot}`;
        pickMap.set(key, p);
      }
    }

    for (let r = 0; r < effectiveRounds; r++) {
      const row: typeof grid[0] = [];
      const isSnakeRound = r % 2 === 1;

      for (let slot = 0; slot < teamCount; slot++) {
        const actualSlot = isSnakeRound ? (teamCount - 1 - slot) : slot;
        const overallPick = r * teamCount + slot;
        const player = overallPick < fullBoard.length ? fullBoard[overallPick] : null;

        const draftPick = pickMap.get(`${r + 1}-${actualSlot + 1}`);

        row.push({
          rank: overallPick + 1,
          player,  // Always the board-ranked player — never replaced
          pick: draftPick || null,
          isSnake: isSnakeRound,
          isDrafted: !!(draftPick?.playerId),  // slot has been filled in Sleeper
        });
      }
      grid.push(row);
    }
    return grid;
  }, [fullBoard, teamCount, draftData]);

  const slotHeaders = useMemo(() => {
    if (draftData?.draftSlots && draftData.draftSlots.length > 0) {
      return draftData.draftSlots
        .sort((a, b) => a.slot - b.slot)
        .map(s => s.displayName);
    }
    return Array.from({ length: teamCount }, (_, i) => `Pick ${i + 1}`);
  }, [draftData, teamCount]);

  const stats = useMemo(() => {
    const totalDrafted = draftData?.picks.filter(p => p.playerId).length || 0;
    const totalPicks = (draftData?.draft?.rounds || 0) * teamCount;
    return { drafted: totalDrafted, total: totalPicks };
  }, [draftData, teamCount]);

  const parsedPicks = useMemo<ParsedPick[]>(() => {
    return draftMessages.map(parsePickMessage).filter((p): p is ParsedPick => p !== null);
  }, [draftMessages]);

  // message_id → { timeMs, timeLabel } — duration since previous relevant bot message
  const pickTimings = useMemo<Map<string, { timeMs: number; timeLabel: string }>>(() => {
    const map = new Map<string, { timeMs: number; timeLabel: string }>();
    const relevant = draftMessages
      .filter(m => m.author_is_bot && (m.text.includes("This draft has begun!") || m.text.includes("Pick ")))
      .sort((a, b) => a.created - b.created);
    let prevCreated: number | null = null;
    for (const msg of relevant) {
      if (msg.text.includes("This draft has begun!")) {
        prevCreated = msg.created;
        continue;
      }
      if (prevCreated === null) continue;
      const timeMs = msg.created - prevCreated;
      const totalSecs = Math.floor(timeMs / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const timeLabel = mins > 0 ? `${mins}m ${secs}s` : `${totalSecs}s`;
      map.set(msg.message_id, { timeMs, timeLabel });
      prevCreated = msg.created;
    }
    return map;
  }, [draftMessages]);

  // playerName → fantasy team display name (from draftData picks + slots)
  const pickOwnerMap = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (!draftData?.picks || !draftData?.draftSlots) return map;
    const slotMap = new Map(draftData.draftSlots.map(s => [s.rosterId, s.displayName]));
    for (const p of draftData.picks) {
      if (p.playerName && p.rosterId) {
        map.set(p.playerName, slotMap.get(p.rosterId) ?? "");
      }
    }
    return map;
  }, [draftData]);

  // currentPickInfo — on-clock / picks-away computed from draftState
  const currentPickInfo = useMemo((): CurrentPickInfo | null => {
    if (!draftState) return null;
    const { teams, rounds, picks, draftOrderByUserId, usersById, type } = draftState;
    const totalPicks = teams * rounds;
    if (picks.length >= totalPicks) return null;
    const nextPickNo = picks.length + 1;
    const currentRound = Math.ceil(nextPickNo / teams);
    const pickInRound = ((nextPickNo - 1) % teams) + 1;
    // For linear drafts slot = pickInRound each round; snake support can be added later
    const draftSlot = type === "snake" ? pickInRound : pickInRound;
    const currentUserId = Object.entries(draftOrderByUserId).find(([, slot]) => slot === draftSlot)?.[0] ?? null;
    const currentUser = currentUserId ? (usersById[currentUserId] ?? null) : null;
    const myUserId = user?.userId ?? null;
    let picksAway = 0;
    let isMyTurn = false;
    if (myUserId) {
      const mySlot = draftOrderByUserId[myUserId];
      if (mySlot !== undefined) {
        isMyTurn = mySlot === draftSlot;
        if (isMyTurn) {
          picksAway = 0;
        } else if (mySlot > draftSlot) {
          picksAway = mySlot - draftSlot;
        } else {
          picksAway = teams - draftSlot + mySlot;
        }
      }
    }
    return { nextPickNo, currentRound, pickInRound, currentUserId, currentUser, picksAway, totalPicks, picksRemaining: totalPicks - picks.length, isMyTurn };
  }, [draftState, user?.userId]);

  // My own picks from draftState
  const myPicks = useMemo(() => {
    if (!draftState || !user?.userId) return [];
    return draftState.picks.filter(p => p.pickedBy === user.userId);
  }, [draftState, user?.userId]);

  // Slot headers: prefer real display names from draftState over REST draftData
  const enhancedSlotHeaders = useMemo(() => {
    if (draftState && Object.keys(draftState.draftOrderByUserId).length > 0) {
      const slotToUser: Record<number, DraftUser> = {};
      for (const [userId, slot] of Object.entries(draftState.draftOrderByUserId)) {
        slotToUser[slot] = draftState.usersById[userId] ?? { userId, displayName: `Slot ${slot}`, avatar: null, isBot: false };
      }
      return Array.from({ length: draftState.teams }, (_, i) => slotToUser[i + 1]?.displayName || `Pick ${i + 1}`);
    }
    return slotHeaders;
  }, [draftState, slotHeaders]);

  // Merged pick history: draftState.picks (primary) joined with message timing data
  const mergedPickHistory = useMemo(() => {
    if (draftState && draftState.picks.length > 0) {
      return draftState.picks.map((pick, idx) => {
        const parsed = parsedPicks[idx] ?? null;
        const timing = parsed ? pickTimings.get(parsed.message_id) : null;
        const pickUser = draftState.usersById[pick.pickedBy] ?? null;
        return { pick, timing, user: pickUser, isForced: parsed?.forced ?? false };
      });
    }
    // Fallback: message-based picks only (when draftState not yet loaded)
    return parsedPicks.map(p => ({
      pick: null as DraftPickNormalized | null,
      timing: pickTimings.get(p.message_id) ?? null,
      user: null as DraftUser | null,
      isForced: p.forced,
      _parsed: p,
    }));
  }, [draftState, parsedPicks, pickTimings]);

  const handleSaveJwt = () => {
    const val = jwtInput.trim();
    if (!val) return;
    localStorage.setItem(SLEEPER_JWT_KEY, val);
    setSleeperJwt(val);
    window.dispatchEvent(new CustomEvent("sleeper-jwt-changed", { detail: val }));
    setJwtInput("");
    setShowJwtInput(false);
    if (activeDraftId) {
      refreshMessages(activeDraftId, val);
      refreshQueue(activeDraftId, val);
      loadDraftState(activeDraftId, val);
    }
  };

  const handleClearJwt = () => {
    localStorage.removeItem(SLEEPER_JWT_KEY);
    setSleeperJwt(null);
    window.dispatchEvent(new CustomEvent("sleeper-jwt-changed", { detail: null }));
    setDraftMessages([]);
    setDraftStarted(false);
    setDraftQueue([]);
    setDraftState(null);
    setDraftStateError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (leagueIdInput.trim()) {
      setDraftData(null);
      setApiError(null);
      setActiveLeagueId(leagueIdInput.trim());
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="live-draft-title">
          Live Draft Board
        </h2>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        <p className="text-sm text-muted-foreground mt-2" data-testid="text-draft-description">
          Track your dynasty drafts in real-time with a visual board layout.
        </p>
      </div>

      <DraftsDashboard
        mockDrafts={mockDrafts}
        realDrafts={liveDrafts.map(normalizeFromDetect)}
        isLoading={isDetecting}
        hasScanned={hasScanned}
        scanError={scanError}
        onRefresh={isConnected ? scanForLiveDrafts : undefined}
        onTrack={(d) => handleJoinLiveDraft(d.leagueId, d.teams)}
        isConnected={isConnected}
      />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex gap-3 items-end" data-testid="draft-form">
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1.5 block" data-testid="label-league-id">Sleeper League ID (optional, to track drafted players)</label>
              <Input
                data-testid="input-league-id"
                placeholder="e.g. 1170877498498940928"
                value={leagueIdInput}
                onChange={e => setLeagueIdInput(e.target.value)}
                className="font-mono"
              />
            </div>
            <Button type="submit" disabled={isLoading || !leagueIdInput.trim()} data-testid="button-load-draft">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Load Draft
            </Button>
          </form>
        </CardContent>
      </Card>

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

      {!activeLeagueId && !isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="draft-empty-state">
          <div className="w-16 h-16 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-6">
            <Trophy className="w-8 h-8 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">Select a Draft to Begin</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            {isConnected
              ? "Pick a live draft above or enter a league ID to load the draft board."
              : "Connect your Sleeper account to auto-detect live drafts, or enter a league ID manually above."}
          </p>
        </div>
      )}

      {activeLeagueId && !isLoading && (
        <>
          {draftState && (
            <DraftStateHeader
              ds={draftState}
              currentPickInfo={currentPickInfo}
              draftStateLoading={draftStateLoading}
              myUserId={user?.userId ?? null}
            />
          )}
          {draftStateError && !draftState && (
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 px-1" data-testid="text-draft-state-error">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Live draft state unavailable: {draftStateError}</span>
            </div>
          )}

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
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
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
                    className={`text-xs ${draftData.draft.draftCategory === "rookie" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-amber-500/40 text-amber-600 dark:text-amber-400"}`}
                    data-testid="text-draft-category"
                  >
                    {draftData.draft.draftCategory === "rookie" ? "Rookie Draft" : draftData.draft.draftCategory === "startup" ? "Startup Draft" : draftData.draft.draftCategory}
                  </Badge>
                )}
                {draftData && stats.drafted > 0 && (
                  <span className="text-xs text-muted-foreground" data-testid="text-board-progress">
                    {stats.drafted} / {stats.total} picks made
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {teamCount && (
                  <span className="text-xs text-muted-foreground" data-testid="text-team-count">
                    {teamCount} teams
                  </span>
                )}
                {draftData && (
                  <div className="flex items-center border border-border rounded-md overflow-hidden" data-testid="toggle-rookie-mode">
                    <button
                      className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${effectiveRookieMode ? "bg-emerald-600 text-white" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                      onClick={() => setManualRookieMode(!effectiveRookieMode)}
                      data-testid="button-rookie-mode"
                    >
                      Rookie Board
                    </button>
                  </div>
                )}
                {effectiveRookieMode ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5" data-testid="badge-rookie-rankings">
                      FantasyCalc 2026 (PPR)
                    </Badge>
                    <div className="flex items-center border border-border rounded-md overflow-hidden" data-testid="toggle-rookie-format">
                      <button
                        className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${rookieFormat === "1QB" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                        onClick={() => setRookieFormat("1QB")}
                        data-testid="button-rookie-1qb"
                      >
                        1QB
                      </button>
                      <button
                        className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${rookieFormat === "SF" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"}`}
                        onClick={() => setRookieFormat("SF")}
                        data-testid="button-rookie-sf"
                      >
                        SF
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center border border-border rounded-md overflow-hidden" data-testid="toggle-rank-mode">
                    <button
                      className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        rankMode === "dynasty" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"
                      }`}
                      onClick={() => setRankMode("dynasty")}
                      data-testid="button-rank-dynasty"
                    >
                      Dynasty
                    </button>
                    <button
                      className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        rankMode === "redraft" ? "bg-[#0b3a7a] text-white" : "bg-background text-muted-foreground hover:bg-muted/50"
                      }`}
                      onClick={() => setRankMode("redraft")}
                      data-testid="button-rank-redraft"
                    >
                      Redraft
                    </button>
                  </div>
                )}
              </div>
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

          {!isRookieDraft && dynastyPlayerList.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-[#0b3a7a]" />
                <p className="text-sm text-muted-foreground" data-testid="text-loading">Loading dynasty rankings...</p>
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
                        const isAuto = draftAutopickers.some((ap) =>
                          ap.draftSlot === slot1Based ||
                          (ap.userId && draftState?.draftOrderByUserId[ap.userId] === slot1Based) ||
                          (ap.rosterId && (() => {
                            const userId = Object.entries(draftState?.draftOrderByUserId ?? {}).find(([, s]) => s === slot1Based)?.[0];
                            return userId ? ap.rosterId === parseInt(userId) : false;
                          })())
                        );
                        return (
                          <div key={i} className="bg-muted/50 dark:bg-muted/20 p-1.5 text-center" data-testid={`col-header-${i}`}>
                            <span className="text-[10px] font-bold text-muted-foreground uppercase truncate block leading-tight">
                              {header.length > 8 ? header.slice(0, 7) + "…" : header}
                            </span>
                            {isAuto && (
                              <span className="inline-block text-[8px] font-bold px-1 py-px rounded bg-[#0b3a7a]/80 text-[#d4af37] border border-[#d4af37]/30 leading-tight mt-0.5" data-testid={`badge-auto-${i}`}>
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
                          {row.map((cell, slotIdx) => {
                            const hasPlayer = !!cell.player;
                            const pos = cell.player?.pos || "";
                            const wasDrafted = cell.isDrafted && !!draftData;
                            const pickLabel = `${roundIdx + 1}.${String(slotIdx + 1).padStart(2, "0")}`;
                            const posRank = cell.player ? posRankMap.get(cell.player.sleeperId) : undefined;
                            const posLabel = pos && posRank ? `${pos}${posRank}` : pos;
                            const fullName = cell.player?.name || "";
                            const nameParts = fullName.split(" ");
                            const firstName = nameParts[0] || "";
                            const lastName = nameParts.slice(1).join(" ") || firstName;
                            const sid = cell.player?.sleeperId || "";
                            const hasRealImage = sid && !sid.startsWith("rookie_");

                            const posTextColor: Record<string, string> = {
                              QB: "text-red-900 dark:text-red-100",
                              RB: "text-emerald-900 dark:text-emerald-100",
                              WR: "text-blue-900 dark:text-blue-100",
                              TE: "text-orange-900 dark:text-orange-100",
                            };
                            const posBorderColor: Record<string, string> = {
                              QB: "border-red-500/50",
                              RB: "border-emerald-500/50",
                              WR: "border-blue-500/50",
                              TE: "border-orange-500/50",
                            };
                            const posGradient: Record<string, string> = {
                              QB: "from-red-200 dark:from-red-950",
                              RB: "from-emerald-200 dark:from-emerald-950",
                              WR: "from-blue-200 dark:from-blue-950",
                              TE: "from-orange-200 dark:from-orange-950",
                            };

                            const inQueue = !!sid && draftQueue.includes(sid);
                            const canQueue = !!sleeperJwt && !!sid && !wasDrafted && hasPlayer;

                            return (
                              <div
                                key={`${roundIdx}-${slotIdx}`}
                                className={`relative overflow-hidden rounded-sm border transition-all min-h-[76px] group/cell ${
                                  hasPlayer
                                    ? `${POS_CELL_BG[pos] || "bg-muted/20 border-border/30"} ${posBorderColor[pos] || ""}`
                                    : "bg-background border-dashed border-border/30"
                                } ${wasDrafted ? "opacity-30" : ""}`}
                                data-testid={`cell-${roundIdx + 1}-${slotIdx + 1}`}
                              >
                                {hasPlayer ? (
                                  <>
                                    {/* Player headshot — full height right side */}
                                    {hasRealImage && (
                                      <div className="absolute right-0 top-0 bottom-0 w-[52%] overflow-hidden pointer-events-none">
                                        <img
                                          src={`https://sleepercdn.com/content/nfl/players/${sid}.jpg`}
                                          alt={fullName}
                                          className="h-full w-full object-cover object-top"
                                          onError={(e) => {
                                            const img = e.target as HTMLImageElement;
                                            img.src = `https://sleepercdn.com/content/nfl/players/thumb/${sid}.jpg`;
                                            img.onerror = () => { img.style.display = "none"; };
                                          }}
                                        />
                                        {/* gradient from bg colour → transparent so text is readable */}
                                        <div className={`absolute inset-0 bg-gradient-to-r ${posGradient[pos] || "from-muted"} via-transparent to-transparent`} />
                                      </div>
                                    )}
                                    {/* Left content */}
                                    <div className={`relative z-10 p-1 flex flex-col justify-between min-h-[76px] ${hasRealImage ? "w-[54%]" : "w-full"} ${posTextColor[pos] || "text-foreground"}`}>
                                      <span className="text-[8.5px] font-extrabold leading-none opacity-90 tabular-nums">
                                        {pickLabel} {posLabel}
                                      </span>
                                      <div>
                                        <div className="text-[8px] leading-none opacity-75 truncate">{firstName}</div>
                                        <div className="text-[11px] font-bold leading-tight truncate">{lastName}</div>
                                        <div className="text-[8px] opacity-70 font-medium mt-0.5">
                                          ({(cell.player!.value || 0).toLocaleString()})
                                        </div>
                                      </div>
                                    </div>
                                    {/* Queue toggle button — appears on hover when JWT is set */}
                                    {canQueue && (
                                      <button
                                        onClick={() => inQueue
                                          ? queueMutate(draftQueue.filter(id => id !== sid))
                                          : queueMutate([...draftQueue, sid])
                                        }
                                        disabled={isUpdatingQueue}
                                        className={`absolute top-1 right-1 z-20 rounded-full w-5 h-5 flex items-center justify-center transition-all disabled:opacity-40
                                          ${inQueue
                                            ? "bg-[#d4af37] text-black opacity-100"
                                            : "bg-black/40 text-white opacity-0 group-hover/cell:opacity-100"
                                          }`}
                                        data-testid={`button-cell-queue-${sid}`}
                                        title={inQueue ? "Remove from queue" : "Add to queue"}
                                      >
                                        {inQueue
                                          ? <X className="w-2.5 h-2.5" />
                                          : <Plus className="w-2.5 h-2.5" />
                                        }
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <div className="flex items-center justify-center min-h-[76px]">
                                    <span className="text-[10px] text-muted-foreground/40 font-mono">{pickLabel}</span>
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

          {draftState && myPicks.length > 0 && (
            <MyPicksPanel
              myPicks={myPicks}
              myUserId={user?.userId ?? null}
              usersById={draftState.usersById}
              teams={draftState.teams}
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
                      const rank = globalRankMap.get(playerId);
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
                  <Button variant="outline" size="sm" className={`h-7 px-2.5 text-xs gap-1.5 ${sleeperJwt ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : ""}`}
                    onClick={() => setShowJwtInput(v => !v)} data-testid="button-jwt-toggle">
                    <Key className="w-3 h-3" />
                    {sleeperJwt ? "Token Set" : "Set Token"}
                  </Button>
                </div>
              </div>

              {/* JWT input panel */}
              {showJwtInput && (
                <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3" data-testid="panel-jwt-input">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-foreground">Sleeper Auth Token</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Paste your Sleeper JWT to enable draft message history. Find it in browser DevTools → Application → Local Storage → <code className="font-mono bg-muted px-1 rounded text-[10px]">sleeper-auth</code>, or from network request headers on sleeper.com.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="eyJhbGci…"
                      value={jwtInput}
                      onChange={e => setJwtInput(e.target.value)}
                      className="font-mono text-xs flex-1"
                      onKeyDown={e => e.key === "Enter" && handleSaveJwt()}
                      data-testid="input-sleeper-jwt"
                    />
                    <Button size="sm" onClick={handleSaveJwt} disabled={!jwtInput.trim()} data-testid="button-save-jwt">Save</Button>
                  </div>
                  {sleeperJwt && (
                    <button onClick={handleClearJwt} className="text-[11px] text-red-500 hover:text-red-600 transition-colors" data-testid="button-clear-jwt">
                      Clear saved token
                    </button>
                  )}
                </div>
              )}

              {/* No token state */}
              {!sleeperJwt && !showJwtInput && (
                <p className="text-xs text-muted-foreground" data-testid="text-log-no-token">
                  Set your Sleeper auth token above to see real-time pick history, forced picks, and draft log.
                </p>
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
                      const ownerName = entry.user?.displayName || pickOwnerMap.get(playerName) || "";
                      const posColors: Record<string, string> = {
                        QB: "text-red-600 dark:text-red-400",
                        RB: "text-emerald-600 dark:text-emerald-400",
                        WR: "text-blue-600 dark:text-blue-400",
                        TE: "text-orange-500 dark:text-orange-400",
                      };
                      return (
                        <div key={p ? p.pickNo : idx}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                            entry.isForced
                              ? "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20"
                              : "border-border/30 bg-muted/20"
                          }`}
                          data-testid={`pick-row-${p ? p.pickNo : idx}`}>
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums flex-shrink-0 w-8">
                            {round}.{String(pickInRound).padStart(2, "0")}
                          </span>
                          <span className={`text-[10px] font-bold flex-shrink-0 w-6 ${posColors[position] || "text-muted-foreground"}`}>
                            {position}
                          </span>
                          <span className="font-semibold text-foreground truncate flex-1 min-w-0">{playerName}</span>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0 hidden sm:inline">{teamAbbr}</span>
                          {ownerName && (
                            <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 truncate max-w-[80px]" title={ownerName}>
                              {ownerName}
                            </span>
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

              {/* Empty state */}
              {sleeperJwt && !messagesLoading && mergedPickHistory.length === 0 && !messagesError && (
                <p className="text-xs text-muted-foreground text-center py-3" data-testid="text-no-picks-yet">
                  {draftStarted ? "Draft has started — no picks logged yet." : "Waiting for draft picks…"}
                </p>
              )}

            </CardContent>
          </Card>

        </>
      )}
    </div>
  );
}
