/**
 * Server-side wrappers around `shared/appMode.ts` plus the entitlement
 * helpers that depend on the database (subscription lookup).
 *
 * These middlewares are the *authoritative* enforcement layer for Sleeper
 * write actions. Frontend hiding is for UX only; if a request reaches the
 * server, it has to pass these gates. Every block emits a structured log
 * line of the shape `[write-blocked] reason=<code> ...` so denials are
 * easy to grep and dashboard.
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { scUsers } from "@shared/schema";
import {
  getAppMode,
  isWriteAccessDomain,
  isReadOnlyDomain,
  isDevRuntime,
  isDevSubscriptionOverride,
  type AppMode,
  WRITE_ACCESS_REQUIRED_ERROR,
  SUBSCRIPTION_REQUIRED_ERROR,
} from "@shared/appMode";

// Shared, capped Postgres pool (see server/db.ts).

/**
 * Extract the canonical host for the inbound request. Trust order:
 *   1. X-Forwarded-Host (proxies / Cloudflare / Render)
 *   2. req.hostname (Express, respects `trust proxy` setting)
 *   3. Host header
 *
 * Express's `req.hostname` is preferred when `trust proxy` is set; the
 * fallbacks cover deployments where the proxy header is the only signal.
 */
export function getRequestHost(req: Request): string | null {
  const xfh = req.headers["x-forwarded-host"];
  if (typeof xfh === "string" && xfh.length > 0) {
    // Could be comma-separated for chained proxies; take the left-most
    // (origin client).
    return xfh.split(",")[0].trim();
  }
  if (req.hostname) return req.hostname;
  const hostHdr = req.headers.host;
  if (typeof hostHdr === "string") return hostHdr;
  return null;
}

// ── Spec-named helpers ─────────────────────────────────────────────────────
// `getRequestAppMode`, `isWriteAccessHost`, `isReadOnlyHost` are the names
// referenced in the architecture spec; the `*FromRequest` / `*Request`
// aliases below are kept for code already importing them.

export function getRequestAppMode(req: Request): AppMode {
  return getAppMode(getRequestHost(req));
}
export function isWriteAccessHost(req: Request): boolean {
  return getRequestAppMode(req) === "WRITE_ACCESS";
}
export function isReadOnlyHost(req: Request): boolean {
  return getRequestAppMode(req) === "READ_ONLY";
}

// Legacy aliases — keep until call sites migrate.
export const getAppModeFromRequest = getRequestAppMode;
export const isWriteAccessRequest = isWriteAccessHost;
export const isReadOnlyRequest = isReadOnlyHost;

/** Single structured log line for blocked writes. Fields are space-separated
 *  `key=value` so they're greppable + parsable by log dashboards. Never
 *  includes Sleeper tokens, passwords, or full payloads. */
export function logBlockedWrite(opts: {
  req: Request;
  reason:
    | "blocked_wrong_domain"
    | "blocked_no_auth"
    | "blocked_no_sleeper_token"
    | "blocked_no_subscription"
    | "blocked_rate_limited"
    | "blocked_internal_error";
  action?: string;
  detail?: string;
}): void {
  const { req, reason, action, detail } = opts;
  const userId = (req as any).dcUserId ?? "anonymous";
  const host = getRequestHost(req) ?? "unknown";
  const route = `${req.method} ${req.originalUrl.split("?")[0]}`;
  const parts = [
    "[write-blocked]",
    `reason=${reason}`,
    `user=${userId}`,
    `host=${host}`,
    `route="${route}"`,
  ];
  if (action) parts.push(`action=${action}`);
  if (detail) parts.push(`detail="${detail.replace(/"/g, "'")}"`);
  console.warn(parts.join(" "));
}

// ── Domain gate ────────────────────────────────────────────────────────────

/**
 * Hard gate — refuses any request that didn't arrive on a write-access
 * domain. Returns 403 with a clear error code so the frontend can surface
 * a "this feature isn't available on this domain" message.
 *
 * Apply to every server route that mutates Sleeper state.
 */
export function requireWriteAccessDomain(req: Request, res: Response, next: NextFunction): void {
  if (!isWriteAccessHost(req)) {
    logBlockedWrite({ req, reason: "blocked_wrong_domain" });
    res.status(403).json({
      error: WRITE_ACCESS_REQUIRED_ERROR.message,
      code: WRITE_ACCESS_REQUIRED_ERROR.code,
      host: getRequestHost(req),
    });
    return;
  }
  next();
}

// ── Subscription gate ──────────────────────────────────────────────────────

/**
 * Returns true when the given subscription state grants write entitlement.
 * Per current spec: only `status === "active"` (and `"trialing"` as a
 * convenience for paid trials) qualifies. `past_due` is intentionally
 * treated as inactive — the user can re-pay to restore writes.
 */
export function isSubscriptionActive(opts: {
  status: string | null | undefined;
  currentPeriodEnd: Date | null | undefined;
}): boolean {
  const status = (opts.status ?? "").toLowerCase();
  if (status !== "active" && status !== "trialing") return false;
  // If we have a current period end and it's already in the past, treat
  // as inactive. Belt-and-braces against a missed Stripe cancel webhook.
  if (opts.currentPeriodEnd && opts.currentPeriodEnd.getTime() < Date.now()) {
    return false;
  }
  return true;
}

/**
 * Hard gate — refuses the request unless the authenticated user has an
 * active subscription. Must be applied AFTER `requireAuth` so
 * `req.dcUserId` is populated.
 *
 * 401 if no DC user is attached (caller forgot the auth middleware).
 * 402 (Payment Required) if no active subscription.
 */
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  const dcUserId = (req as any).dcUserId as string | undefined;
  if (!dcUserId) {
    logBlockedWrite({ req, reason: "blocked_no_auth", detail: "requireActiveSubscription invoked without dcUserId" });
    res.status(401).json({
      error: "Login required. requireAuth must run before requireActiveSubscription.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  // Dev override — never honored in production. Lets a preview environment
  // exercise the full write flow without a real Stripe sub.
  if (isDevRuntime() && isDevSubscriptionOverride()) {
    console.info(`[dev-override] requireActiveSubscription bypassed for user=${dcUserId} via DEV_SUBSCRIPTION_OVERRIDE`);
    (req as any).subscriptionPlan = "dev_override";
    next();
    return;
  }

  try {
    const rows = await db
      .select({
        status: scUsers.subscriptionStatus,
        end: scUsers.subscriptionCurrentPeriodEnd,
        plan: scUsers.subscriptionPlan,
      })
      .from(scUsers)
      .where(eq(scUsers.id, dcUserId))
      .limit(1);
    const row = rows[0] ?? null;
    const active = isSubscriptionActive({
      status: row?.status ?? null,
      currentPeriodEnd: row?.end ?? null,
    });
    if (!active) {
      logBlockedWrite({ req, reason: "blocked_no_subscription", detail: `status=${row?.status ?? "none"}` });
      res.status(402).json({
        error: SUBSCRIPTION_REQUIRED_ERROR.message,
        code: SUBSCRIPTION_REQUIRED_ERROR.code,
        status: row?.status ?? "inactive",
      });
      return;
    }
    (req as any).subscriptionPlan = row?.plan ?? null;
    next();
  } catch (err: any) {
    logBlockedWrite({ req, reason: "blocked_internal_error", detail: err?.message ?? "subscription lookup failed" });
    console.error("[requireActiveSubscription] error:", err?.message);
    res.status(500).json({ error: "Subscription check failed." });
  }
}

/**
 * Subscription lookup helper — used by /me-style endpoints that need to
 * surface the user's entitlement to the client. Does NOT throw.
 */
export async function getSubscriptionStatusForUser(dcUserId: string): Promise<{
  status: string;
  plan: string | null;
  currentPeriodEnd: number | null;
  active: boolean;
}> {
  try {
    const rows = await db
      .select({
        status: scUsers.subscriptionStatus,
        end: scUsers.subscriptionCurrentPeriodEnd,
        plan: scUsers.subscriptionPlan,
      })
      .from(scUsers)
      .where(eq(scUsers.id, dcUserId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return { status: "inactive", plan: null, currentPeriodEnd: null, active: false };
    }
    return {
      status: row.status ?? "inactive",
      plan: row.plan ?? null,
      currentPeriodEnd: row.end ? row.end.getTime() : null,
      active: isSubscriptionActive({ status: row.status, currentPeriodEnd: row.end }),
    };
  } catch (err: any) {
    console.error("[getSubscriptionStatusForUser] error:", err?.message);
    return { status: "inactive", plan: null, currentPeriodEnd: null, active: false };
  }
}
