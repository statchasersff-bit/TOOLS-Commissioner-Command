/**
 * Commander's Report HTTP routes.
 *
 *   GET  /api/commanders-report/periods?leagueId=         → months with activity + default
 *   GET  /api/commanders-report?leagueId=&year=&month=&tone= → cached recap (+ article if generated)
 *   POST /api/commanders-report/generate                  → narrate via Claude, cache, return
 *
 * The GET path computes the deterministic recap synchronously (no LLM) and
 * caches it, so the data report always renders instantly. The article (Claude
 * prose) is only produced on the explicit POST /generate call. All routes are
 * gated behind an authenticated StatChasers user.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { db } from "./db";
import { and, eq } from "drizzle-orm";
import { commandersReports } from "@shared/schema";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { buildRecap, listActivePeriods, isTone, type ToneId, type RecapResult } from "./commandersReport";
import { narrateReportTemplate, TEMPLATE_NARRATOR_ID } from "./templateNarrator";
import { narrateReportClaude, isClaudeNarrationAvailable, CLAUDE_NARRATOR_ID } from "./claudeNarrator";

/**
 * Produce the narrated article from a recap. Prefers the Claude narrator (the
 * ranked-storyline roast essay) when ANTHROPIC_API_KEY is set; falls back to the
 * deterministic template narrator on no key OR any Claude error, so /generate
 * always returns prose rather than 503-ing.
 */
async function generateArticle(
  recap: RecapResult,
  seed: string,
): Promise<{ article: unknown; model: string }> {
  if (isClaudeNarrationAvailable()) {
    try {
      const article = await narrateReportClaude(recap, seed);
      return { article, model: CLAUDE_NARRATOR_ID };
    } catch (err) {
      console.warn("[CommandersReport] Claude narration failed, falling back to template:", err);
    }
  }
  return { article: narrateReportTemplate(recap, seed), model: TEMPLATE_NARRATOR_ID };
}

// Shared, capped Postgres pool (see server/db.ts).

const DEFAULT_TONE: ToneId = "full_chaos";

function parseIntStrict(v: unknown): number | null {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** URL-safe ~22-char token (16 random bytes, base64url). */
function mintShareToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Find the cached row for a (league, season, month, tone). */
async function findCached(leagueId: string, season: string, month: number, tone: ToneId) {
  const rows = await db
    .select()
    .from(commandersReports)
    .where(
      and(
        eq(commandersReports.leagueId, leagueId),
        eq(commandersReports.season, season),
        eq(commandersReports.month, month),
        eq(commandersReports.tone, tone),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Stable seed → reproducible phrasing for a given (league, period, tone). */
function stableSeed(leagueId: string, season: string, month: number, tone: ToneId): string {
  return `${leagueId}-${season}-${month}-${tone}`;
}

/**
 * Ensure a recap row exists for (league, year, month, tone), computing the
 * deterministic recap and its template-narrated article if missing. Because the
 * narrator is free + synchronous (no LLM), every row always carries an article.
 */
async function ensureRecap(
  leagueId: string,
  year: number,
  month: number,
  tone: ToneId,
): Promise<{ recap: RecapResult; rowId: number; article: unknown; generatedAt: Date | null; model: string | null }> {
  const season = String(year);
  const existing = await findCached(leagueId, season, month, tone);
  if (existing) {
    const recap = existing.recap as RecapResult;
    if (existing.article) {
      return { recap, rowId: existing.id, article: existing.article, generatedAt: existing.generatedAt, model: existing.model };
    }
    // Backfill prose for rows cached before the template narrator existed.
    const article = narrateReportTemplate(recap, stableSeed(leagueId, season, month, tone));
    const now = new Date();
    await db
      .update(commandersReports)
      .set({ article: article as unknown as object, model: TEMPLATE_NARRATOR_ID, generatedAt: now })
      .where(eq(commandersReports.id, existing.id));
    return { recap, rowId: existing.id, article, generatedAt: now, model: TEMPLATE_NARRATOR_ID };
  }
  const recap = await buildRecap(leagueId, year, month);
  const article = narrateReportTemplate(recap, stableSeed(leagueId, season, month, tone));
  const now = new Date();
  const [inserted] = await db
    .insert(commandersReports)
    .values({
      leagueId,
      season,
      month,
      tone,
      recap: recap as unknown as object,
      article: article as unknown as object,
      model: TEMPLATE_NARRATOR_ID,
      generatedAt: now,
    })
    .returning();
  return { recap, rowId: inserted.id, article, generatedAt: now, model: TEMPLATE_NARRATOR_ID };
}

export function registerCommandersReportRoutes(app: Express): void {
  const requireUser = (req: any, res: any): string | null => {
    const uid = getUserIdFromRequest(req);
    if (!uid) {
      res.status(401).json({ error: "Not authenticated" });
      return null;
    }
    return uid;
  };

  // ── Available periods + default ──────────────────────────────────────────
  app.get("/api/commanders-report/periods", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const result = await listActivePeriods(leagueId);
      res.json(result);
    } catch (err: any) {
      const status = /sleeper|fetch/i.test(err?.message || "") ? 502 : 500;
      res.status(status).json({ error: err?.message || "Failed to load periods" });
    }
  });

  // ── Get report (deterministic recap, article if already generated) ────────
  app.get("/api/commanders-report", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    const year = parseIntStrict(req.query.year);
    const month = parseIntStrict(req.query.month);
    const tone = isTone(req.query.tone) ? req.query.tone : DEFAULT_TONE;
    if (!leagueId || year == null || month == null || month < 1 || month > 12) {
      return res.status(400).json({ error: "leagueId, year, and month (1-12) required" });
    }
    try {
      const { recap, article, generatedAt, model } = await ensureRecap(leagueId, year, month, tone);
      res.json({
        recap,
        article: article ?? null,
        generatedAt: generatedAt ?? null,
        model: model ?? null,
        tone,
        narrationAvailable: isClaudeNarrationAvailable(),
        cached: article != null,
      });
    } catch (err: any) {
      const status = /sleeper|fetch/i.test(err?.message || "") ? 502 : 500;
      res.status(status).json({ error: err?.message || "Failed to build report" });
    }
  });

  // ── Regenerate (fresh narration) ──────────────────────────────────────────
  // Prefers the Claude narrator (ranked-storyline roast essay) when a key is
  // configured; otherwise re-runs the template narrator with a randomized seed so
  // the prose still varies on each click. Either way the result is re-cached.
  app.post("/api/commanders-report/generate", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const { leagueId, year, month, tone: rawTone } = req.body || {};
    const yr = parseIntStrict(year);
    const mo = parseIntStrict(month);
    const tone = isTone(rawTone) ? rawTone : DEFAULT_TONE;
    if (!leagueId || yr == null || mo == null || mo < 1 || mo > 12) {
      return res.status(400).json({ error: "leagueId, year, and month (1-12) required" });
    }
    try {
      const { recap, rowId } = await ensureRecap(String(leagueId), yr, mo, tone);
      const seed = `${leagueId}-${yr}-${mo}-${tone}-${Date.now()}-${Math.random()}`;
      const { article, model } = await generateArticle(recap, seed);
      const now = new Date();
      await db
        .update(commandersReports)
        .set({ article: article as unknown as object, model, generatedBy: uid, generatedAt: now })
        .where(eq(commandersReports.id, rowId));
      res.json({ recap, article, generatedAt: now, model, tone, narrationAvailable: isClaudeNarrationAvailable(), cached: false });
    } catch (err: any) {
      const status = /sleeper|fetch/i.test(err?.message || "") ? 502 : 500;
      res.status(status).json({ error: err?.message || "Failed to generate report" });
    }
  });

  // ── Enable public sharing (mint a token, or return the existing one) ───────
  app.post("/api/commanders-report/share", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const { leagueId, year, month, tone: rawTone } = req.body || {};
    const yr = parseIntStrict(year);
    const mo = parseIntStrict(month);
    const tone = isTone(rawTone) ? rawTone : DEFAULT_TONE;
    if (!leagueId || yr == null || mo == null || mo < 1 || mo > 12) {
      return res.status(400).json({ error: "leagueId, year, and month (1-12) required" });
    }
    try {
      // Ensure a row exists (computes the deterministic recap if needed).
      const { rowId } = await ensureRecap(String(leagueId), yr, mo, tone);
      const existing = await findCached(String(leagueId), String(yr), mo, tone);
      let token = existing?.shareToken ?? null;
      if (!token) {
        token = mintShareToken();
        await db
          .update(commandersReports)
          .set({ shareToken: token, sharedAt: new Date() })
          .where(eq(commandersReports.id, rowId));
      }
      res.json({ token, path: `/share/report/${token}` });
    } catch (err: any) {
      const status = /sleeper|fetch/i.test(err?.message || "") ? 502 : 500;
      res.status(status).json({ error: err?.message || "Failed to enable sharing" });
    }
  });

  // ── Revoke public sharing ──────────────────────────────────────────────────
  app.delete("/api/commanders-report/share", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const { leagueId, year, month, tone: rawTone } = req.body || {};
    const yr = parseIntStrict(year);
    const mo = parseIntStrict(month);
    const tone = isTone(rawTone) ? rawTone : DEFAULT_TONE;
    if (!leagueId || yr == null || mo == null) {
      return res.status(400).json({ error: "leagueId, year, and month required" });
    }
    try {
      await db
        .update(commandersReports)
        .set({ shareToken: null, sharedAt: null })
        .where(
          and(
            eq(commandersReports.leagueId, String(leagueId)),
            eq(commandersReports.season, String(yr)),
            eq(commandersReports.month, mo),
            eq(commandersReports.tone, tone),
          ),
        );
      res.json({ revoked: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to revoke sharing" });
    }
  });

  // ── Public read-only view (NO auth) ────────────────────────────────────────
  // Returns only what a shared report needs to render: the deterministic recap,
  // the narrated article (if generated), and presentation metadata. Never any
  // user/account data.
  app.get("/api/commanders-report/public/:token", async (req, res) => {
    const token = String(req.params.token || "");
    if (!token) return res.status(400).json({ error: "Missing token" });
    try {
      const rows = await db
        .select()
        .from(commandersReports)
        .where(eq(commandersReports.shareToken, token))
        .limit(1);
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Report not found or sharing was disabled" });
      const recap = row.recap as RecapResult;
      res.json({
        recap,
        article: row.article ?? null,
        generatedAt: row.generatedAt ?? null,
        model: row.model ?? null,
        tone: row.tone,
        leagueName: recap?.meta?.leagueName ?? "Dynasty League",
        period: recap?.period ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load shared report" });
    }
  });
}
