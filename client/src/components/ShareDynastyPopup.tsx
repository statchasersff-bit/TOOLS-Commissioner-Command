import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useSleeper } from "@/contexts/SleeperContext";
import { sendLeagueChatMessage } from "@/services/sleeperAuthedApi";
import {
  X, Share2, Loader2, CheckCircle2, AlertCircle,
  Pause, Play, XCircle, ChevronRight, ChevronLeft,
  ChevronDown, ChevronUp, RotateCcw, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────
const DISMISSED_KEY   = "sc-share-popup-dismissed";
const SHARED_KEY      = "sc-share-popup-shared";
const LEAGUE_SENT_KEY = "sc-share-popup-leagues";
const QUEUE_KEY       = "sc-share-queue";
const SESSION_KEY     = "sc-share-session"; // sessionStorage — cleared when browser tab closes

const ACTIVE_MS     = 10 * 60 * 1000;
const DISMISSED_TTL = 7  * 24 * 60 * 60 * 1000;
const SHARED_TTL    = 30 * 24 * 60 * 60 * 1000;
const LEAGUE_TTL    = 30 * 24 * 60 * 60 * 1000;
// Phase 1: first PHASE_SWITCH sends — fast (3–6 s)
const FAST_MIN      = 3_000;
const FAST_MAX      = 6_000;
// Phase 2: remaining sends — slow (2–4 min)
const SLOW_MIN      = 120_000;
const SLOW_MAX      = 240_000;
const PHASE_SWITCH  = 5;     // switch after 5th completed send
const RETRY_DELAY   = 5 * 60 * 1000; // 5 min before retry
const MAX_RETRIES   = 1;

const SHARE_MESSAGE =
  "I've been using Dynasty Command from StatChasers, it's a dynasty fantasy football tool for analyzing teams, finding trades, syncing offers, and managing leagues.\n\nTry it here:\nhttps://statchasers.com/dynasty-command-tool/";

// ── Dev logging (never logs JWTs or tokens) ───────────────────────────────
function log(...args: unknown[]) {
  console.log("[LeagueShareQueue]", ...args);
}

// ── Types ─────────────────────────────────────────────────────────────────
type ItemStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";
type PopupStep  = "hidden" | "prompt" | "select" | "confirm";

interface QueueItem {
  leagueId: string;
  name: string;
  status: ItemStatus;
  retries: number;
  sentAt?: number;
  failedAt?: number;
  nextAttemptAt?: number; // epoch ms — earliest time this item may be sent
}

interface ShareQueue {
  items: QueueItem[];
  paused: boolean;
  createdAt: number;
  rateLimited?: boolean; // true after any 429 — forces Phase 2 delays for all future sends
}

// ── localStorage / sessionStorage helpers ─────────────────────────────────
function loadQueue(): ShareQueue | null {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as ShareQueue) : null;
  } catch { return null; }
}

function saveQueue(q: ShareQueue | null) {
  if (q === null) localStorage.removeItem(QUEUE_KEY);
  else localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function getLeagueSentMap(): Record<string, number> {
  try {
    return (JSON.parse(localStorage.getItem(LEAGUE_SENT_KEY) ?? "{}") as Record<string, number>);
  } catch { return {}; }
}

function markLeagueSent(leagueId: string) {
  const map = getLeagueSentMap();
  map[leagueId] = Date.now();
  localStorage.setItem(LEAGUE_SENT_KEY, JSON.stringify(map));
}

function leagueCanReceive(leagueId: string): boolean {
  const ts = getLeagueSentMap()[leagueId];
  return !ts || Date.now() - ts > LEAGUE_TTL;
}

function hasActiveQueue(): boolean {
  const q = loadQueue();
  return q !== null && q.items.some(it => it.status === "pending" || it.status === "sending");
}

function shouldShowPopup(): boolean {
  try {
    const d = localStorage.getItem(DISMISSED_KEY);
    if (d && Date.now() - parseInt(d, 10) < DISMISSED_TTL) return false;
    const s = localStorage.getItem(SHARED_KEY);
    if (s && Date.now() - parseInt(s, 10) < SHARED_TTL) return false;
    if (hasActiveQueue()) return false;
  } catch { /* ignore */ }
  return true;
}

// ── Queue helpers ─────────────────────────────────────────────────────────
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min)) + min;
}

// completedCount = number of sends already finished (sent + failed, not cancelled).
// Determines which phase delay to apply before the next send.
function getNextDelay(completedCount: number, rateLimited?: boolean): number {
  if (rateLimited || completedCount >= PHASE_SWITCH) {
    return rand(SLOW_MIN, SLOW_MAX); // Phase 2
  }
  return rand(FAST_MIN, FAST_MAX); // Phase 1
}

function patchItem(q: ShareQueue, idx: number, patch: Partial<QueueItem>): ShareQueue {
  return { ...q, items: q.items.map((it, i) => i === idx ? { ...it, ...patch } : it) };
}

function completedCount(q: ShareQueue): number {
  return q.items.filter(it => it.status === "sent" || it.status === "failed").length;
}

function queueStats(q: ShareQueue | null) {
  if (!q) return { total: 0, sent: 0, failed: 0, pending: 0, active: false };
  const sent    = q.items.filter(it => it.status === "sent").length;
  const failed  = q.items.filter(it => it.status === "failed").length;
  const pending = q.items.filter(it => it.status === "pending" || it.status === "sending").length;
  return { total: q.items.length, sent, failed, pending, active: pending > 0 };
}

function isRateLimitErr(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("429") || m.includes("rate limit") || m.includes("too many");
}

function approxWait(ts: number): string {
  const s = Math.max(0, Math.ceil((ts - Date.now()) / 1000));
  if (s < 60) return `~${s}s`;
  return `~${Math.ceil(s / 60)}m`;
}

// ── Component ─────────────────────────────────────────────────────────────
interface Props { blocked?: boolean; forceOpen?: boolean; onForceOpenConsumed?: () => void; }

export function ShareDynastyPopup({ blocked = false, forceOpen = false, onForceOpenConsumed }: Props) {
  const { isConnected, leagues } = useSleeper();

  const [popupStep, setPopupStep]   = useState<PopupStep>("hidden");
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(false);
  const [queueState, setQueueState] = useState<ShareQueue | null>(() => {
    const q = loadQueue();
    if (!q) return null;
    // Reset stuck "sending" items (page closed mid-request)
    const hasStuck = q.items.some(it => it.status === "sending");
    if (!hasStuck) return q;
    const fixed = { ...q, items: q.items.map(it =>
      it.status === "sending" ? { ...it, status: "pending" as const } : it
    )};
    saveQueue(fixed);
    return fixed;
  });

  const timeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSendingRef  = useRef(false);
  const queueRef      = useRef(queueState);
  queueRef.current    = queueState; // always mirrors latest state — safe to read in .then()/.catch()

  // Ref to processQueue — re-assigned each render, called only via ref
  const processQueueRef = useRef<() => void>(() => {});

  // Stable setter: keeps ref, React state, and localStorage in sync atomically
  const setQueue = useCallback((q: ShareQueue | null) => {
    queueRef.current = q;
    setQueueState(q);
    saveQueue(q);
  }, []);

  // ── Queue processor ────────────────────────────────────────────────────
  // Re-assigned each render so .then()/.catch() callbacks see latest queueRef/isSendingRef.
  // Only ever called via processQueueRef.current() to guarantee freshness.
  processQueueRef.current = function processQueue() {
    const q = queueRef.current;
    if (!q || q.paused || isSendingRef.current) return;

    const now = Date.now();

    // Find the next item that is ready to send
    const idx = q.items.findIndex(
      it => it.status === "pending" && (!it.nextAttemptAt || it.nextAttemptAt <= now)
    );

    if (idx === -1) {
      // No item ready — schedule wakeup at the soonest pending nextAttemptAt
      const next = q.items
        .filter(it => it.status === "pending" && it.nextAttemptAt && it.nextAttemptAt > now)
        .sort((a, b) => (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0))[0];
      if (next?.nextAttemptAt) {
        const wait = Math.max(0, next.nextAttemptAt - Date.now());
        log(`Waiting ${Math.round(wait / 1000)}s before next send`);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => processQueueRef.current(), wait);
      }
      return;
    }

    const done    = completedCount(q);
    const sendNum = done + 1;
    log(`Sending ${sendNum}/${q.items.length} → ${q.items[idx].leagueId}`);

    isSendingRef.current = true;
    const snap = patchItem(q, idx, { status: "sending" });
    setQueue(snap);

    sendLeagueChatMessage(q.items[idx].leagueId, SHARE_MESSAGE)
      .then(() => {
        markLeagueSent(snap.items[idx].leagueId);

        // Re-read latest queue so pause/cancel operations during the async send are respected
        const cur       = queueRef.current ?? snap;
        const afterSent = patchItem(cur, idx, { status: "sent", sentAt: Date.now() });
        const doneNow   = completedCount(afterSent);

        // Find next pending item and schedule it
        const nextIdx = afterSent.items.findIndex((it, i) => i > idx && it.status === "pending");
        let final = afterSent;
        let delay: number | null = null;
        if (nextIdx !== -1) {
          delay = getNextDelay(doneNow, cur.rateLimited);
          log(`Waiting ${Math.round(delay / 1000)}s before next send`);
          final = patchItem(afterSent, nextIdx, { nextAttemptAt: Date.now() + delay });
        }

        setQueue(final);
        isSendingRef.current = false;
        if (delay !== null && !final.paused) {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => processQueueRef.current(), delay);
        }
      })
      .catch((err: unknown) => {
        const rateLimit = isRateLimitErr(err);
        if (rateLimit) log("Rate limit hit — backing off");

        const item = snap.items[idx];
        const cur  = queueRef.current ?? snap;

        if (item.retries < MAX_RETRIES) {
          log(`Retry ${item.retries + 1}/${MAX_RETRIES} → ${item.leagueId}`);
          const withRetry = patchItem(cur, idx, {
            status: "pending",
            retries: item.retries + 1,
            failedAt: Date.now(),
            nextAttemptAt: Date.now() + RETRY_DELAY,
          });
          // If rate-limited, force Phase 2 delays for all future sends
          const updated = rateLimit ? { ...withRetry, rateLimited: true } : withRetry;
          setQueue(updated);
          isSendingRef.current = false;
          // Immediately try the next (non-retry) pending item
          if (!updated.paused) processQueueRef.current();
        } else {
          log(`Permanently failed → ${item.leagueId}`);
          const failed  = patchItem(cur, idx, { status: "failed", failedAt: Date.now() });
          const doneNow = completedCount(failed);
          const nextIdx = failed.items.findIndex((it, i) => i > idx && it.status === "pending");
          let base  = rateLimit ? { ...failed, rateLimited: true } : failed;
          let delay: number | null = null;
          if (nextIdx !== -1) {
            delay = getNextDelay(doneNow, base.rateLimited);
            log(`Waiting ${Math.round(delay / 1000)}s before next send`);
            base = patchItem(base, nextIdx, { nextAttemptAt: Date.now() + delay });
          }
          setQueue(base);
          isSendingRef.current = false;
          if (delay !== null && !base.paused) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => processQueueRef.current(), delay);
          }
        }
      });
  };

  // ── Mount: session-aware resume ────────────────────────────────────────
  useEffect(() => {
    // sessionStorage survives page refreshes within the same tab
    // but is cleared when the browser tab is closed.
    const isSameSession = !!sessionStorage.getItem(SESSION_KEY);
    sessionStorage.setItem(SESSION_KEY, "1");

    const q = queueState;
    if (!q) return;

    const hasPending = q.items.some(it => it.status === "pending");
    if (!hasPending) return;

    if (isSameSession && !q.paused) {
      // Page refresh in same session → auto-resume
      processQueueRef.current();
    } else if (!isSameSession) {
      // New session (browser was closed) → pause until user resumes
      setQueue({ ...q, paused: true });
    }
    // If q.paused was already true (user explicitly paused) → stay paused
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── External trigger (e.g. "Share with My Leagues" button on About page) ─
  useEffect(() => {
    if (!forceOpen) return;
    setPopupStep("select");
    setSelected(new Set(eligibleLeagues.map(l => l.leagueId)));
    onForceOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);

  // ── 10-minute popup timer ──────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !shouldShowPopup()) return;
    const t = setTimeout(() => {
      if (shouldShowPopup() && !blocked) setPopupStep("prompt");
    }, ACTIVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // Cleanup timeouts on unmount
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  // ── Popup handlers ─────────────────────────────────────────────────────
  const eligibleLeagues = leagues.filter(l => leagueCanReceive(l.leagueId));
  const allSelected     = eligibleLeagues.length > 0 && eligibleLeagues.every(l => selected.has(l.leagueId));
  const selectedLeagues = eligibleLeagues.filter(l => selected.has(l.leagueId));

  function dismiss(permanent: boolean) {
    if (permanent) localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setPopupStep("hidden");
    setSelected(new Set());
  }

  function toggleLeague(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(eligibleLeagues.map(l => l.leagueId)));
  }

  // ── Queue handlers ─────────────────────────────────────────────────────
  function startQueue() {
    const toSend = eligibleLeagues.filter(l => selected.has(l.leagueId));
    if (toSend.length === 0) return;

    localStorage.setItem(SHARED_KEY, String(Date.now()));
    sessionStorage.setItem(SESSION_KEY, "1");

    const newQueue: ShareQueue = {
      items: toSend.map(l => ({ leagueId: l.leagueId, name: l.name, status: "pending", retries: 0 })),
      paused: false,
      createdAt: Date.now(),
    };
    setQueue(newQueue);
    setPopupStep("hidden");
    setSelected(new Set());
    setIsExpanded(false);
    processQueueRef.current();
  }

  function pauseQueue() {
    if (!queueRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setQueue({ ...queueRef.current, paused: true });
  }

  function resumeQueue() {
    if (!queueRef.current) return;
    const resumed = { ...queueRef.current, paused: false };
    setQueue(resumed);
    processQueueRef.current();
  }

  function cancelQueue() {
    if (!queueRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setQueue({
      ...queueRef.current,
      items: queueRef.current.items.map(it =>
        it.status === "pending" ? { ...it, status: "cancelled" as const } : it
      ),
    });
  }

  function retryItem(leagueId: string) {
    const q = queueRef.current;
    if (!q) return;
    const updated = {
      ...q,
      items: q.items.map(it =>
        it.leagueId === leagueId && it.status === "failed"
          ? { ...it, status: "pending" as const, retries: 0, failedAt: undefined, nextAttemptAt: undefined }
          : it
      ),
    };
    setQueue(updated);
    if (!updated.paused) processQueueRef.current();
  }

  // ── Derived stats ──────────────────────────────────────────────────────
  const stats        = queueStats(queueState);
  const queueVisible = queueState !== null && queueState.items.length > 0;
  const queueDone    = queueVisible && !stats.active;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Floating queue indicator ──────────────────────────────────── */}
      {queueVisible && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[199] flex flex-col items-center gap-2 animate-in slide-in-from-bottom-2 fade-in duration-300">

          {/* Expanded panel — shown above the pill */}
          {isExpanded && (
            <div className="w-[min(360px,calc(100vw-32px))] rounded-xl border border-[#d4af37]/30 bg-[#080f1d] shadow-[0_8px_32px_rgba(0,0,0,0.7)] overflow-hidden">
              {/* Panel header */}
              <div className="bg-gradient-to-r from-[#0b1e36] to-[#0c2444] px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Share2 className="w-3 h-3 text-[#d4af37]" />
                  <span className="text-[12px] font-bold text-white">League Share Queue</span>
                  {queueState?.rateLimited && (
                    <span className="text-[9px] text-amber-400/70 font-medium">rate-limited</span>
                  )}
                </div>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="text-muted-foreground hover:text-white transition-colors"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Item list */}
              <div className="max-h-[260px] overflow-y-auto divide-y divide-border/20">
                {queueState!.items.map((item) => (
                  <div
                    key={item.leagueId}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-2.5",
                      item.status === "cancelled" && "opacity-40",
                    )}
                  >
                    {/* Status icon */}
                    <div className="flex-shrink-0 w-4 flex items-center justify-center">
                      {item.status === "sent"      && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                      {item.status === "sending"   && <Loader2 className="w-3.5 h-3.5 text-[#d4af37] animate-spin" />}
                      {item.status === "failed"    && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                      {item.status === "cancelled" && <XCircle className="w-3.5 h-3.5 text-muted-foreground/40" />}
                      {item.status === "pending"   && <Clock className="w-3.5 h-3.5 text-muted-foreground/50" />}
                    </div>

                    {/* Name */}
                    <span className={cn(
                      "text-[12px] truncate flex-1",
                      item.status === "sent"    ? "text-white"                 :
                      item.status === "failed"  ? "text-red-300"               :
                      item.status === "sending" ? "text-[#d4af37]"             :
                                                  "text-muted-foreground"
                    )}>
                      {item.name}
                    </span>

                    {/* Right side: wait time or retry */}
                    {item.status === "pending" && item.nextAttemptAt && item.nextAttemptAt > Date.now() && (
                      <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
                        {approxWait(item.nextAttemptAt)}
                      </span>
                    )}
                    {item.status === "failed" && (
                      <button
                        onClick={() => retryItem(item.leagueId)}
                        className="flex items-center gap-1 text-[10px] text-[#d4af37] hover:text-[#e5c84a] transition-colors flex-shrink-0"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Retry
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Panel footer: pause / cancel */}
              {!queueDone && (
                <div className="px-4 py-2.5 border-t border-border/20 flex items-center gap-2 bg-white/[0.015]">
                  {queueState?.paused ? (
                    <Button size="sm" variant="ghost"
                      className="h-7 text-[11px] text-[#d4af37] hover:text-[#e5c84a] border border-[#d4af37]/20"
                      onClick={resumeQueue}>
                      <Play className="w-2.5 h-2.5 mr-1" /> Resume
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost"
                      className="h-7 text-[11px] text-muted-foreground hover:text-white border border-border/30"
                      onClick={pauseQueue}>
                      <Pause className="w-2.5 h-2.5 mr-1" /> Pause
                    </Button>
                  )}
                  <Button size="sm" variant="ghost"
                    className="h-7 text-[11px] text-muted-foreground hover:text-red-400 border border-border/30"
                    onClick={cancelQueue}>
                    <XCircle className="w-2.5 h-2.5 mr-1" /> Cancel Remaining
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Minimized pill */}
          <div className={cn(
            "flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 shadow-lg backdrop-blur-sm bg-[#080f1d]/95 text-[11px] select-none",
            queueDone              ? "border-emerald-500/30"  :
            queueState?.paused    ? "border-amber-500/30"     :
                                    "border-[#d4af37]/30",
          )}>
            {/* Status icon */}
            {queueDone             && <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
            {!queueDone && queueState?.paused && <Pause className="w-3 h-3 text-amber-400/70 flex-shrink-0" />}
            {!queueDone && !queueState?.paused && <Loader2 className="w-3 h-3 text-[#d4af37] animate-spin flex-shrink-0" />}

            {/* Label */}
            <span className="text-white font-medium whitespace-nowrap">
              {queueDone
                ? `Shared to ${stats.sent}/${stats.total} leagues${stats.failed > 0 ? ` · ${stats.failed} failed` : ""}`
                : queueState?.paused
                ? `Sharing paused · ${stats.sent}/${stats.total} sent`
                : `Sharing to league chats… ${stats.sent}/${stats.total} sent`
              }
            </span>

            {/* Expand / collapse */}
            <button
              onClick={() => setIsExpanded(e => !e)}
              className="text-muted-foreground hover:text-white transition-colors ml-0.5"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>

            {/* Inline controls (only when not expanded) */}
            {!isExpanded && !queueDone && (
              <>
                <span className="text-border/40">|</span>
                {queueState?.paused ? (
                  <button
                    onClick={resumeQueue}
                    className="flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    <span>Resume</span>
                  </button>
                ) : (
                  <button
                    onClick={pauseQueue}
                    className="flex items-center gap-1 text-muted-foreground hover:text-white transition-colors"
                  >
                    <Pause className="w-3 h-3" />
                    <span>Pause</span>
                  </button>
                )}
                <span className="text-border/40">|</span>
                <button
                  onClick={cancelQueue}
                  className="flex items-center gap-1 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <XCircle className="w-3 h-3" />
                  <span>Cancel</span>
                </button>
              </>
            )}

            {/* Dismiss when done */}
            {queueDone && (
              <button
                onClick={() => setQueue(null)}
                className="text-muted-foreground hover:text-white transition-colors ml-0.5"
                aria-label="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Popup card (3-step opt-in flow) ──────────────────────────── */}
      {popupStep !== "hidden" && (
        <div className="fixed bottom-4 right-4 z-[200] w-[min(360px,calc(100vw-32px))] animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="rounded-xl border border-[#d4af37]/30 bg-[#080f1d] shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden max-h-[88vh] flex flex-col">

            {/* Header */}
            <div className="bg-gradient-to-r from-[#0b1e36] to-[#0c2444] px-4 py-3 flex items-start justify-between gap-3 flex-shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <Share2 className="w-3.5 h-3.5 text-[#d4af37]" />
                  <span className="text-sm font-bold text-white">
                    {popupStep === "prompt"  ? "Enjoying Dynasty Command?"
                     : popupStep === "select" ? "Share Dynasty Command"
                     : "Confirm & Start Sharing"}
                  </span>
                </div>
                <span className="block h-[2px] w-8 bg-[#d4af37] rounded-full mt-1.5" />
              </div>
              <button
                onClick={() => dismiss(false)}
                className="text-muted-foreground hover:text-white transition-colors mt-0.5 flex-shrink-0"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">

              {/* Step 1: Prompt */}
              {popupStep === "prompt" && (
                <>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">
                    Help keep it free by sharing Dynasty Command with your dynasty leagues.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost"
                      className="flex-1 h-8 text-[12px] border border-border/40"
                      onClick={() => dismiss(true)}>
                      Maybe Later
                    </Button>
                    <Button size="sm"
                      className="flex-1 h-8 text-[12px] bg-gradient-to-r from-[#d4af37] to-[#b8962e] text-black font-bold hover:opacity-90"
                      onClick={() => setPopupStep("select")}>
                      <Share2 className="w-3 h-3 mr-1.5" />
                      Share to League Chat
                    </Button>
                  </div>
                </>
              )}

              {/* Step 2: Select leagues */}
              {popupStep === "select" && (
                <>
                  {eligibleLeagues.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground text-center py-4">
                      All your dynasty leagues have been shared to recently. Check back in 30 days.
                    </p>
                  ) : (
                    <>
                      <p className="text-[12px] text-muted-foreground leading-relaxed">
                        Select leagues to share to. The first 5 send quickly (3–6 seconds apart); additional leagues send every 2–4 minutes in the background.
                      </p>

                      {/* Select all */}
                      <div
                        className="flex items-center gap-2 cursor-pointer select-none"
                        onClick={toggleAll}
                      >
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleAll}
                          className="border-[#d4af37]/50 data-[state=checked]:bg-[#d4af37] data-[state=checked]:border-[#d4af37]"
                        />
                        <span className="text-[12px] font-semibold text-white">Select All Dynasty Leagues</span>
                        <span className="text-[10px] text-muted-foreground/60 ml-auto">{eligibleLeagues.length} available</span>
                      </div>

                      {/* League list */}
                      <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
                        {eligibleLeagues.map(league => {
                          const isChecked = selected.has(league.leagueId);
                          return (
                            <div
                              key={league.leagueId}
                              className={cn(
                                "flex items-center gap-2.5 rounded-lg px-3 py-2 border transition-colors cursor-pointer select-none",
                                isChecked
                                  ? "border-[#d4af37]/40 bg-[#d4af37]/5"
                                  : "border-border/30 bg-white/[0.02] hover:border-border/50",
                              )}
                              onClick={() => toggleLeague(league.leagueId)}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={() => toggleLeague(league.leagueId)}
                                className="border-[#d4af37]/50 data-[state=checked]:bg-[#d4af37] data-[state=checked]:border-[#d4af37]"
                              />
                              <span className="text-[12px] text-white truncate flex-1">{league.name}</span>
                              <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{league.totalRosters} teams</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="ghost"
                      className="h-8 text-[12px] border border-border/40"
                      onClick={() => setPopupStep("prompt")}>
                      <ChevronLeft className="w-3 h-3" /> Back
                    </Button>
                    <Button size="sm"
                      className="flex-1 h-8 text-[12px] bg-gradient-to-r from-[#d4af37] to-[#b8962e] text-black font-bold hover:opacity-90 disabled:opacity-40"
                      disabled={selected.size === 0}
                      onClick={() => setPopupStep("confirm")}>
                      Review & Confirm <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </>
              )}

              {/* Step 3: Confirm */}
              {popupStep === "confirm" && (
                <>
                  {/* League summary */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground/60 font-medium uppercase tracking-wider">
                      Sharing to {selectedLeagues.length} league{selectedLeagues.length !== 1 ? "s" : ""}
                    </p>
                    <div className="max-h-[110px] overflow-y-auto space-y-1 pr-1">
                      {selectedLeagues.map((l, i) => (
                        <div key={l.leagueId} className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-[#d4af37]/60 flex-shrink-0" />
                          <span className="text-[12px] text-white truncate">{l.name}</span>
                          {i < PHASE_SWITCH && (
                            <span className="text-[9px] text-emerald-400/60 ml-auto flex-shrink-0">fast</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Phase callout */}
                  {selectedLeagues.length > PHASE_SWITCH && (
                    <div className="rounded-lg border border-border/25 bg-white/[0.02] px-3 py-2">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        First {PHASE_SWITCH} leagues send quickly (3–6 s each). The remaining {selectedLeagues.length - PHASE_SWITCH} send every 2–4 minutes in the background.
                      </p>
                    </div>
                  )}

                  {/* Message preview */}
                  <div className="rounded-lg border border-border/30 bg-white/[0.02] px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground/60 mb-1.5 font-medium uppercase tracking-wider">
                      Message
                    </p>
                    <p className="text-[11px] text-muted-foreground whitespace-pre-line leading-relaxed">
                      {SHARE_MESSAGE}
                    </p>
                  </div>

                  <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                    You can pause or cancel from the progress indicator at any time. Dynasty Command remains fully usable while the queue runs.
                  </p>

                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="ghost"
                      className="h-8 text-[12px] border border-border/40"
                      onClick={() => setPopupStep("select")}>
                      <ChevronLeft className="w-3 h-3" /> Back
                    </Button>
                    <Button size="sm"
                      className="flex-1 h-8 text-[12px] bg-gradient-to-r from-[#d4af37] to-[#b8962e] text-black font-bold hover:opacity-90"
                      onClick={startQueue}>
                      <Share2 className="w-3 h-3 mr-1.5" />
                      Start Sharing
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
