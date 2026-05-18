import type { Request, Response, NextFunction } from "express";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { getUser } from "./scAuth";
import { isAdminByEmail } from "@shared/admin";

/**
 * Admin authorization for /api/admin/* routes.
 *
 * Two equally trusted paths:
 *
 *   1. `x-admin-secret` header matches `process.env.ADMIN_SECRET`.
 *      Use for curl/scripts/CI — bypasses DC session.
 *
 *   2. An authenticated DC user whose email is in the admin allowlist
 *      (see shared/admin.ts). Use from the browser — the existing DC
 *      session JWT is the credential; no secret typed into the UI.
 *
 * Either path → next(). Both fail → 403.
 *
 * Sleeper-username allowlisting is INTENTIONALLY not honored here.
 * Read-only Sleeper connections are unauthenticated; anyone can claim a
 * username on the frontend, so trusting it server-side would be unsafe.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Path 1: shared secret header.
  const secret = process.env.ADMIN_SECRET;
  const provided = req.headers["x-admin-secret"];
  if (secret && typeof provided === "string" && provided === secret) {
    return next();
  }

  // Path 2: authenticated DC user with admin email.
  try {
    const userId = getUserIdFromRequest(req);
    if (userId) {
      const user = await getUser(userId);
      if (user && isAdminByEmail(user.email)) {
        // Attach for downstream handlers that want to know who's calling.
        (req as any).adminUserId = userId;
        (req as any).adminEmail = user.email;
        return next();
      }
    }
  } catch (err: any) {
    console.error("[requireAdmin] auth check threw:", err?.message);
  }

  res.status(403).json({ error: "Forbidden" });
}
