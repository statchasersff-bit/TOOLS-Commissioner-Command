import type { Request, Response, NextFunction } from "express";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { getConnectedSleeper } from "./scAuth";

/**
 * Access middleware — backend enforcement for tiered access.
 *
 * Frontend gating (see client/src/components/AccessGate.tsx) is necessary
 * for UX but not sufficient for security. These middlewares are the
 * server-side counterpart.
 *
 * Two tiers:
 *
 *   requireReadOnlySleeperContext
 *     Validates that the request identifies a Sleeper user. The existing
 *     read-only Sleeper proxy endpoints take :userId or :username in the
 *     URL; this middleware just makes that requirement explicit and gives
 *     us a single place to attach future rate-limits, abuse checks, etc.
 *     It does NOT require a StatChasers session.
 *
 *   requireFullAuth
 *     For server-mediated action endpoints (waiver submit, trade send,
 *     lineup update, etc.). Requires:
 *       1) a valid StatChasers session (DC JWT or session cookie)
 *       2) the DC user has a linked Sleeper account with a stored token
 *     Today no action endpoints live on this server — Sleeper mutations go
 *     client → sleeper.com/graphql directly. This middleware is the canonical
 *     hook to put on any future server-mediated action route.
 *
 * IMPORTANT: read-only mode must never expose action APIs. Any new endpoint
 * that mutates Sleeper state MUST be wrapped in `requireFullAuth`.
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
 * Hard gate for action endpoints. Apply to any route that performs a
 * Sleeper mutation on behalf of the user.
 *
 *   401 if no StatChasers session.
 *   403 if the DC user has no linked Sleeper token (they need to complete
 *       the Sleeper credentials flow).
 *
 * On success, attaches `req.dcUserId` and `req.sleeperUserId` for the
 * route handler to consume.
 */
export async function requireFullAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const dcUserId = getUserIdFromRequest(req);
  if (!dcUserId) {
    res.status(401).json({ error: "Login required for action tools. Sign in to your StatChasers account." });
    return;
  }
  try {
    const linked = await getConnectedSleeper(dcUserId);
    if (!linked?.encryptedToken) {
      res.status(403).json({
        error: "Sleeper authentication required. Connect your Sleeper account to use action tools.",
        code: "SLEEPER_TOKEN_MISSING",
      });
      return;
    }
    (req as any).dcUserId = dcUserId;
    (req as any).sleeperUserId = linked.sleeperUserId;
    next();
  } catch (err: any) {
    console.error("[requireFullAuth] error:", err?.message);
    res.status(500).json({ error: "Auth check failed." });
  }
}
