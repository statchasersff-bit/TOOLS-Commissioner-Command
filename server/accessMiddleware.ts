import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { getConnectedSleeper } from "./scAuth";
import {
  requireWriteAccessDomain,
  requireActiveSubscription,
  logBlockedWrite,
} from "./appMode";
import { isDevRuntime, isDevSleeperConnectedOverride } from "@shared/appMode";

/**
 * Access middleware — backend enforcement for tiered access.
 *
 * Frontend gating (see client/src/components/AccessGate.tsx) is necessary
 * for UX but not sufficient for security. These middlewares are the
 * server-side counterpart.
 *
 * Composable gates:
 *
 *   requireReadOnlySleeperContext
 *     Soft gate — validates a Sleeper user-id is identifiable. No StatChasers
 *     session required.
 *
 *   requireAuth
 *     Hard gate — requires a valid StatChasers session. Populates
 *     `req.dcUserId`.
 *
 *   requireSleeperToken
 *     Hard gate — requires the DC user to have a linked Sleeper token.
 *     Populates `req.sleeperUserId`. Must run AFTER requireAuth.
 *
 *   requireActiveSubscription  (./appMode)
 *     Hard gate — requires user.subscription_status to be active/trialing.
 *
 *   requireWriteAccessDomain  (./appMode)
 *     Hard gate — refuses any request not on a write-access host.
 *
 * Composite:
 *
 *   requireWriteCapability = the canonical chain for any route that mutates
 *   Sleeper state. Domain → auth → sleeper token → subscription. Apply via
 *   `...requireWriteCapability` in the route definition. Queue/rate-limit
 *   is enforced inside handlers (see server/sleeperWriteQueue.ts).
 *
 * IMPORTANT: read-only mode must never expose action APIs. Any new endpoint
 * that mutates Sleeper state MUST be wrapped in `requireWriteCapability`.
 */

/**
 * Soft gate for read-only Sleeper proxy endpoints.
 *
 * Recognized identifiers (any one is enough):
 *   - URL param `:userId`
 *   - URL param `:username`
 *   - header `x-sleeper-user-id`
 *   - body field `userId` (POST endpoints)
 *
 * Returns 400 if none are present. No-op otherwise.
 */
export function requireReadOnlySleeperContext(req: Request, res: Response, next: NextFunction): void {
  const hasUserId   = !!req.params?.userId;
  const hasUsername = !!req.params?.username;
  const hasHeader   = !!req.headers["x-sleeper-user-id"];
  const hasBody     = !!(req.body && typeof req.body === "object" && req.body.userId);

  if (!hasUserId && !hasUsername && !hasHeader && !hasBody) {
    res.status(400).json({ error: "Sleeper user context required." });
    return;
  }
  next();
}

/**
 * Auth-only gate. Verifies the request carries a valid StatChasers session
 * and populates `req.dcUserId`. Does NOT require a linked Sleeper token —
 * use `requireSleeperToken` for that.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const dcUserId = getUserIdFromRequest(req);
  if (!dcUserId) {
    logBlockedWrite({ req, reason: "blocked_no_auth" });
    res.status(401).json({
      error: "Login required. Sign in to your StatChasers account.",
      code: "AUTH_REQUIRED",
    });
    return;
  }
  (req as any).dcUserId = dcUserId;
  next();
}

/**
 * Sleeper-token gate. Confirms the authenticated DC user has a linked
 * Sleeper account with a stored token. Populates `req.sleeperUserId`.
 *
 * Must run after `requireAuth` so `req.dcUserId` is set.
 */
export async function requireSleeperToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const dcUserId = (req as any).dcUserId as string | undefined;
  if (!dcUserId) {
    logBlockedWrite({ req, reason: "blocked_no_auth", detail: "requireSleeperToken invoked without dcUserId" });
    res.status(401).json({
      error: "Login required. requireAuth must run before requireSleeperToken.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  // Dev override — never honored in production. Treats the test user as
  // Sleeper-connected so the queue/write path can be exercised without a
  // real Sleeper JWT in localStorage.
  if (isDevRuntime() && isDevSleeperConnectedOverride()) {
    console.info(`[dev-override] requireSleeperToken bypassed for user=${dcUserId} via DEV_SLEEPER_CONNECTED_OVERRIDE`);
    (req as any).sleeperUserId = "dev-override";
    next();
    return;
  }

  try {
    const linked = await getConnectedSleeper(dcUserId);
    if (!linked?.encryptedToken) {
      logBlockedWrite({ req, reason: "blocked_no_sleeper_token" });
      res.status(403).json({
        error: "Sleeper authentication required. Connect your Sleeper account to use action tools.",
        code: "SLEEPER_TOKEN_MISSING",
      });
      return;
    }
    (req as any).sleeperUserId = linked.sleeperUserId;
    next();
  } catch (err: any) {
    logBlockedWrite({ req, reason: "blocked_internal_error", detail: err?.message ?? "sleeper lookup failed" });
    console.error("[requireSleeperToken] error:", err?.message);
    res.status(500).json({ error: "Auth check failed." });
  }
}

/**
 * Legacy composite — auth + sleeper-token in one. New code should compose
 * `requireAuth` + `requireSleeperToken` (or use `requireWriteCapability`
 * for full write gating). Retained until existing call sites migrate.
 */
export const requireFullAuth: RequestHandler[] = [requireAuth, requireSleeperToken];

/**
 * Composite gate for Sleeper write actions — the single middleware list to
 * put on any route that mutates Sleeper state. Enforces, in order:
 *
 *   1. Domain — write-access host only (cheapest check, no DB).
 *   2. Auth — valid StatChasers session.
 *   3. Sleeper token — linked Sleeper account with stored token.
 *   4. Subscription — active or trialing.
 *
 * Use via:
 *
 *   app.post("/api/sleeper/write/lineup",
 *     ...requireWriteCapability,
 *     handler,
 *   );
 *
 * Queue/rate-limit enforcement happens INSIDE the handler via
 * `enqueueSleeperAction` — it shapes traffic but isn't an access boundary.
 */
export const requireWriteCapability: RequestHandler[] = [
  requireWriteAccessDomain,
  requireAuth,
  requireSleeperToken,
  requireActiveSubscription,
];
