import jwt from "jsonwebtoken";
import type { Express, Request } from "express";
import {
  sendVerificationCode,
  verifyCode,
  parseVerifiedToken,
  registerUser,
  loginUser,
  resetPassword,
  getUser,
  getConnectedSleeper,
  connectSleeper,
  disconnectSleeper,
  decryptToken,
  updateFavoriteNflTeam,
} from "./scAuth";
import { enqueueSleeperUser } from "./adpCrawler";
import { isAdminByEmail } from "@shared/admin";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-dev-secret";
const JWT_EXPIRES = "30d";

function signUserJwt(userId: string): string {
  return jwt.sign({ scUserId: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function getUserIdFromRequest(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
      return payload.scUserId ?? null;
    } catch {
      return null;
    }
  }
  return (req.session as any).scUserId ?? null;
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
      res.json({ ok: true, token: signUserJwt(result.userId) });
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
      res.json({ ok: true, token: signUserJwt(result.userId) });
    } catch (err: any) {
      console.error("[sc-auth] login error:", err.message);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });

  // POST /api/sc-auth/logout
  app.post("/api/sc-auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("sc.sid");
      res.json({ ok: true });
    });
  });

  // GET /api/sc-auth/me
  app.get("/api/sc-auth/me", async (req, res) => {
    try {
      const userId = getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
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
      res.json({
        user: {
          id: user.id,
          email: user.email,
          favoriteNflTeam: user.favoriteNflTeam ?? null,
        },
        sleeper: sleeperInfo,
        isAdmin: isAdminByEmail(user.email),
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
      // their leagues' drafts feed into the dataset. We never block the
      // connection request on this.
      void enqueueSleeperUser(sleeperUserId).catch((err) =>
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
