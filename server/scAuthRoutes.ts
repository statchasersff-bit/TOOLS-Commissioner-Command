import jwt from "jsonwebtoken";
import type { Express, Request, Response } from "express";
import {
  sendVerificationCode,
  verifyCode,
  parseVerifiedToken,
  registerUser,
  loginUser,
  resetPassword,
  getUser,
  getPreferences,
  getConnectedSleeper,
  connectSleeper,
  disconnectSleeper,
  decryptToken,
  updateFavoriteNflTeam,
  updatePreferences,
} from "./scAuth";
import type { UserPreferences } from "@shared/schema";
import { enqueueSleeperUser } from "./adpCrawler";
import { isAdminByEmail } from "@shared/admin";
import { getAppModeFromRequest, getSubscriptionStatusForUser } from "./appMode";
import {
  isDevRuntime,
  isDevSubscriptionOverride,
  isDevSleeperConnectedOverride,
  anyDevOverrideActive,
} from "@shared/appMode";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-dev-secret";
const JWT_EXPIRES = "30d";
const JWT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// httpOnly cookie that mirrors the JWT stored in the browser's localStorage.
// This is the key resilience layer: if JavaScript ever clears localStorage
// (our own clearToken(), browser data wipe, etc.) the cookie keeps the user
// logged in and /me will restore the localStorage token automatically.
const SC_JWT_COOKIE = "sc.jwt";

function signUserJwt(userId: string): string {
  return jwt.sign({ scUserId: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/** Set the JWT httpOnly cookie on a response. */
function setJwtCookie(res: Response, token: string): void {
  res.cookie(SC_JWT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: JWT_MAX_AGE_MS,
  });
}

/** Clear the JWT httpOnly cookie on a response. */
function clearJwtCookie(res: Response): void {
  res.clearCookie(SC_JWT_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
}

/**
 * Read the JWT from the raw Cookie header without needing cookie-parser.
 * Returns null if the cookie is absent or undecodable.
 */
function readJwtCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SC_JWT_COOKIE}=`)) {
      try {
        return decodeURIComponent(trimmed.slice(SC_JWT_COOKIE.length + 1));
      } catch { return null; }
    }
  }
  return null;
}

export function getUserIdFromRequest(req: Request): string | null {
  return getAuthResult(req).userId;
}

/**
 * Richer auth result used by /me so the client can distinguish "your JWT is
 * cryptographically bad (clear it)" from "no session found (keep the token,
 * the server may just be starting up)".
 *
 * Auth priority:
 *   1. Bearer header  — primary path (localStorage token sent as Authorization)
 *   2. sc.jwt cookie  — httpOnly backup (survives localStorage clears)
 *   3. Session cookie — legacy fallback
 *
 * `cookieToken` is set when auth succeeded via the cookie so /me can echo it
 * back to the client as `freshToken`, restoring localStorage automatically.
 */
export function getAuthResult(req: Request): {
  userId: string | null;
  jwtVerifyFailed: boolean;
  cookieToken: string | null;
} {
  // ── 1. Bearer header ──────────────────────────────────────────────────────
  const auth = req.headers.authorization;
  let jwtVerifyFailed = false;
  if (auth?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
      if (payload.scUserId) return { userId: payload.scUserId, jwtVerifyFailed: false, cookieToken: null };
    } catch (err: any) {
      console.warn("[sc-auth] Bearer token verify failed, trying cookie:", err?.message);
      jwtVerifyFailed = true;
    }
  }

  // ── 2. sc.jwt httpOnly cookie ─────────────────────────────────────────────
  const cookieJwt = readJwtCookie(req);
  if (cookieJwt) {
    try {
      const payload = jwt.verify(cookieJwt, JWT_SECRET) as any;
      if (payload.scUserId) {
        console.info("[sc-auth] authenticated via JWT cookie (localStorage was empty/cleared)");
        return { userId: payload.scUserId, jwtVerifyFailed: false, cookieToken: cookieJwt };
      }
    } catch (err: any) {
      console.warn("[sc-auth] JWT cookie verify failed:", err?.message);
      jwtVerifyFailed = true;
    }
  }

  // ── 3. Session cookie ─────────────────────────────────────────────────────
  const sessionUserId = (req.session as any).scUserId ?? null;
  return { userId: sessionUserId, jwtVerifyFailed, cookieToken: null };
}

function getIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerScAuthRoutes(app: Express): void {

  // POST /api/sc-auth/request-code
  app.post("/api/sc-auth/request-code", async (req, res) => {
    try {
      const { email, purpose } = req.body as { email?: string; purpose?: string };
      if (!email || !purpose) return res.status(400).json({ error: "email and purpose are required" });
      if (!["signup", "password_reset"].includes(purpose)) return res.status(400).json({ error: "Invalid purpose" });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
      const result = await sendVerificationCode(email, purpose as "signup" | "password_reset", getIp(req));
      if (!result.ok) return res.status(429).json({ error: result.error });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[sc-auth] request-code error:", err.message);
      res.status(500).json({ error: "Failed to send verification code. Please try again." });
    }
  });

  // POST /api/sc-auth/verify-code
  app.post("/api/sc-auth/verify-code", async (req, res) => {
    try {
      const { email, code, purpose } = req.body as { email?: string; code?: string; purpose?: string };
      if (!email || !code || !purpose) return res.status(400).json({ error: "email, code, and purpose are required" });
      const result = await verifyCode(email, String(code), purpose as "signup" | "password_reset", getIp(req));
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, verifiedToken: result.verifiedToken });
    } catch (err: any) {
      console.error("[sc-auth] verify-code error:", err.message);
      res.status(500).json({ error: "Verification failed. Please try again." });
    }
  });

  // POST /api/sc-auth/register
  app.post("/api/sc-auth/register", async (req, res) => {
    try {
      const { email, verifiedToken, password, confirmPassword } = req.body as {
        email?: string; verifiedToken?: string; password?: string; confirmPassword?: string;
      };
      if (!email || !verifiedToken || !password) return res.status(400).json({ error: "email, verifiedToken, and password are required" });
      if (password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match." });
      const verified = parseVerifiedToken(verifiedToken, "signup");
      if (!verified || verified.email !== email.toLowerCase()) {
        return res.status(401).json({ error: "Verification expired or invalid. Please start over." });
      }
      const result = await registerUser(email, password);
      if (!result.ok) return res.status(400).json({ error: result.error });
      (req.session as any).scUserId = result.userId;
      req.session.save(() => {});
      const token = signUserJwt(result.userId);
      setJwtCookie(res, token);
      res.json({ ok: true, token });
    } catch (err: any) {
      console.error("[sc-auth] register error:", err.message);
      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  });

  // POST /api/sc-auth/login
  app.post("/api/sc-auth/login", async (req, res) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !password) return res.status(400).json({ error: "email and password are required" });
      const result = await loginUser(email, password);
      if (!result.ok) return res.status(401).json({ error: result.error });
      (req.session as any).scUserId = result.userId;
      req.session.save(() => {});
      const token = signUserJwt(result.userId);
      setJwtCookie(res, token);
      res.json({ ok: true, token });
    } catch (err: any) {
      console.error("[sc-auth] login error:", err.message);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });

  // POST /api/sc-auth/logout
  app.post("/api/sc-auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("sc.sid");
      clearJwtCookie(res);
      res.json({ ok: true });
    });
  });

  // GET /api/sc-auth/me
  app.get("/api/sc-auth/me", async (req, res) => {
    try {
      const { userId, jwtVerifyFailed, cookieToken } = getAuthResult(req);
      if (!userId) {
        // jwtBad=true tells the client its stored token is cryptographically
        // invalid and should be cleared. Without this flag the client MUST
        // preserve the token — the server may simply be warming up.
        return res.status(401).json({ error: "Not authenticated", jwtBad: jwtVerifyFailed });
      }
      const user = await getUser(userId);
      if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: "Session expired. Please log in again." });
      }
      const sleeper = await getConnectedSleeper(userId);
      const sleeperInfo = sleeper
        ? {
            username: sleeper.sleeperUsername,
            userId: sleeper.sleeperUserId,
            token: sleeper.encryptedToken ? decryptToken(sleeper.encryptedToken) : null,
          }
        : null;
      // Surface app-mode and subscription so the client can hide write
      // controls preemptively. The backend still enforces these on every
      // mutating request — this is UX only.
      let subscription = await getSubscriptionStatusForUser(userId);
      const appMode = getAppModeFromRequest(req);

      // Dev-only overrides — never applied in production. Mirror the
      // server-side gate behavior into the /me payload so the UI sees
      // the same "subscribed / connected" state the backend will honor.
      const devActive = anyDevOverrideActive();
      if (isDevRuntime() && isDevSubscriptionOverride()) {
        subscription = { ...subscription, status: "active", plan: subscription.plan ?? "dev_override", active: true };
      }
      const devOverrides = isDevRuntime()
        ? {
            active: devActive,
            appMode: !!(process.env.DEV_APP_MODE),
            subscription: isDevSubscriptionOverride(),
            sleeperConnected: isDevSleeperConnectedOverride(),
          }
        : null;

      // Refresh the JWT cookie on every successful /me so the 30-day expiry
      // slides forward with each visit, not just from the original login.
      if (cookieToken) {
        setJwtCookie(res, cookieToken); // already have the raw token from cookie
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          favoriteNflTeam: user.favoriteNflTeam ?? null,
          // Defensive: returns {} if the preferences column isn't migrated yet,
          // so /me never fails (which would log the user out).
          preferences: await getPreferences(userId),
        },
        sleeper: sleeperInfo,
        isAdmin: isAdminByEmail(user.email),
        appMode,
        subscription,
        devOverrides,
        // Present when auth succeeded via the JWT cookie but localStorage was
        // empty. The client uses this to restore sc_auth_token so subsequent
        // requests use the Authorization header path again.
        freshToken: cookieToken ?? undefined,
      });
    } catch (err: any) {
      console.error("[sc-auth] me error:", err.message);
      res.status(500).json({ error: "Failed to load session." });
    }
  });

  // POST /api/sc-auth/reset-password
  app.post("/api/sc-auth/reset-password", async (req, res) => {
    try {
      const { email, verifiedToken, newPassword, confirmPassword } = req.body as {
        email?: string; verifiedToken?: string; newPassword?: string; confirmPassword?: string;
      };
      if (!email || !verifiedToken || !newPassword) return res.status(400).json({ error: "email, verifiedToken, and newPassword are required" });
      if (newPassword !== confirmPassword) return res.status(400).json({ error: "Passwords do not match." });
      const verified = parseVerifiedToken(verifiedToken, "password_reset");
      if (!verified || verified.email !== email.toLowerCase()) {
        return res.status(401).json({ error: "Verification expired or invalid. Please start over." });
      }
      const result = await resetPassword(email, newPassword);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[sc-auth] reset-password error:", err.message);
      res.status(500).json({ error: "Password reset failed. Please try again." });
    }
  });

  // POST /api/sc-auth/connect-sleeper
  app.post("/api/sc-auth/connect-sleeper", async (req, res) => {
    try {
      const userId = getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { sleeperUsername, sleeperUserId, token } = req.body as {
        sleeperUsername?: string; sleeperUserId?: string; token?: string;
      };
      if (!sleeperUsername || !sleeperUserId || !token) {
        return res.status(400).json({ error: "sleeperUsername, sleeperUserId, and token are required" });
      }
      await connectSleeper(userId, sleeperUsername, sleeperUserId, token);
      // Fire-and-forget: enqueue this Sleeper user_id for the ADP crawler so
      // their leagues' drafts feed into the dataset. enqueueSleeperUser owns
      // the 7-day/24-hour cooldown gate (see adp_user_crawl_events); the
      // connection request never blocks on this, and a "skipped" return is
      // expected on repeat logins inside the cooldown window.
      void enqueueSleeperUser(sleeperUserId, {
        sleeperUsername,
        source: "user_login_depth1",
      }).catch((err) =>
        console.warn("[sc-auth] adp enqueue failed:", err?.message)
      );
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[sc-auth] connect-sleeper error:", err.message);
      res.status(500).json({ error: "Failed to connect Sleeper account." });
    }
  });

  // DELETE /api/sc-auth/disconnect-sleeper
  app.delete("/api/sc-auth/disconnect-sleeper", async (req, res) => {
    try {
      const userId = getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await disconnectSleeper(userId);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[sc-auth] disconnect-sleeper error:", err.message);
      res.status(500).json({ error: "Failed to disconnect Sleeper account." });
    }
  });

  // PUT /api/sc-auth/me/favorite-team
  // Sets (abbr present) or clears (abbr null) the user's favorite NFL team.
  // We validate against the canonical 32-team list to keep junk out of the DB.
  app.put("/api/sc-auth/me/favorite-team", async (req, res) => {
    try {
      const userId = getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { favoriteNflTeam } = req.body as { favoriteNflTeam?: string | null };
      const next = favoriteNflTeam == null || favoriteNflTeam === ""
        ? null
        : String(favoriteNflTeam).toUpperCase();
      if (next !== null && !VALID_NFL_ABBRS.has(next)) {
        return res.status(400).json({ error: `Unknown NFL team abbreviation: ${next}` });
      }
      await updateFavoriteNflTeam(userId, next);
      res.json({ ok: true, favoriteNflTeam: next });
    } catch (err: any) {
      console.error("[sc-auth] favorite-team error:", err.message);
      res.status(500).json({ error: "Failed to update favorite team." });
    }
  });

  // PUT /api/sc-auth/me/preferences
  // Merge-updates per-account UI/session preferences (theme, active league,
  // league include/exclude filters) so they survive a new deploy origin where
  // per-origin localStorage is empty. Body is a partial UserPreferences; only
  // recognized, validated fields are applied.
  app.put("/api/sc-auth/me/preferences", async (req, res) => {
    try {
      const userId = getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const body = (req.body ?? {}) as Partial<UserPreferences>;
      const patch: Partial<UserPreferences> = {};

      if ("theme" in body) {
        if (body.theme === "light" || body.theme === "x-mode" || body.theme === "my_team") {
          patch.theme = body.theme;
        } else {
          return res.status(400).json({ error: `Invalid theme: ${String(body.theme)}` });
        }
      }
      if ("activeLeagueId" in body) {
        const id = body.activeLeagueId;
        if (id === null || typeof id === "string") patch.activeLeagueId = id;
        else return res.status(400).json({ error: "activeLeagueId must be a string or null" });
      }
      if ("leaguePrefs" in body) {
        const lp = body.leaguePrefs;
        const okList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
        if (lp && okList(lp.added) && okList(lp.removed)) {
          patch.leaguePrefs = { added: lp.added, removed: lp.removed };
        } else {
          return res.status(400).json({ error: "leaguePrefs must be { added: string[], removed: string[] }" });
        }
      }

      const preferences = await updatePreferences(userId, patch);
      res.json({ ok: true, preferences });
    } catch (err: any) {
      console.error("[sc-auth] preferences error:", err.message);
      res.status(500).json({ error: "Failed to update preferences." });
    }
  });
}

// Mirrors client/src/config/nflTeams.ts NFL_TEAMS. Hardcoded server-side
// because the client config is bundled-only — keep these in sync if either
// list changes (32 entries, stable since the Chargers re-relocation).
const VALID_NFL_ABBRS = new Set<string>([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB",  "HOU", "IND", "JAX", "KC",
  "LV",  "LAC", "LAR", "MIA", "MIN", "NE",  "NO",  "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF",  "TB",  "TEN", "WAS",
]);
