// Client-side product analytics: page views + session duration.
//
// Sends lightweight pings to POST /api/analytics/collect. The server resolves
// the StatChasers account from the auth cookie; here we only manage:
//   • visitorId  — persistent per browser (localStorage), ties repeat visits.
//   • sessionId  — per tab/visit (sessionStorage), the unit of "a session".
//   • identity   — Sleeper user id/username once the app learns it.
//
// All sends are best-effort and never throw into app code. Duration is kept
// current by a heartbeat while the tab is visible plus a final sendBeacon on
// pagehide so we capture the tail of the visit.
import { API_BASE } from "@/lib/apiBase";

const VISITOR_KEY = "sc-analytics-visitor";
const SESSION_KEY = "sc-analytics-session";
const HEARTBEAT_MS = 30_000;

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getVisitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) { v = randomId(); localStorage.setItem(VISITOR_KEY, v); }
    return v;
  } catch { return randomId(); }
}

function getSessionId(): string {
  try {
    let s = sessionStorage.getItem(SESSION_KEY);
    if (!s) { s = randomId(); sessionStorage.setItem(SESSION_KEY, s); }
    return s;
  } catch { return randomId(); }
}

// Identity learned during the visit; merged into every ping so a session that
// starts anonymous gets attributed the moment a username resolves.
let identity: { sleeperUserId?: string; sleeperUsername?: string } = {};

export function identify(info: { sleeperUserId?: string; sleeperUsername?: string }): void {
  if (info.sleeperUserId) identity.sleeperUserId = info.sleeperUserId;
  if (info.sleeperUsername) identity.sleeperUsername = info.sleeperUsername;
}

function payload(extra: Record<string, unknown>) {
  return JSON.stringify({
    sessionId: getSessionId(),
    visitorId: getVisitorId(),
    sleeperUserId: identity.sleeperUserId,
    sleeperUsername: identity.sleeperUsername,
    ...extra,
  });
}

function send(extra: Record<string, unknown>, useBeacon = false): void {
  const url = `${API_BASE}/api/analytics/collect`;
  const body = payload(extra);
  try {
    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "include",
      keepalive: useBeacon,
    }).catch(() => { /* best-effort */ });
  } catch { /* never break the app over analytics */ }
}

let started = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let referrer: string | undefined;

export function trackPageView(path: string): void {
  send({ type: "pageview", path, referrer });
  referrer = undefined; // only send referrer on the first view of the session
}

// Wire up session-level listeners once (heartbeat + tail capture). Safe to call
// repeatedly; only the first call takes effect.
export function startAnalytics(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  referrer = document.referrer || undefined;

  const beat = () => {
    if (document.visibilityState === "visible") send({ type: "heartbeat" });
  };
  heartbeatTimer = setInterval(beat, HEARTBEAT_MS);

  // Capture the end of the visit. pagehide fires reliably on tab close /
  // navigation away on desktop and mobile; visibilitychange→hidden covers
  // backgrounding. Both use sendBeacon so the request survives unload.
  window.addEventListener("pagehide", () => send({ type: "heartbeat" }, true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") send({ type: "heartbeat" }, true);
  });
}

export function stopAnalytics(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  started = false;
}
