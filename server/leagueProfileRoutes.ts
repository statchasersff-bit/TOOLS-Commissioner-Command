/**
 * League Profile HTTP routes — Rulebook/Bylaws, unified Commissioner Log, and
 * Draft-pick notes. Decision-support / documentation only; nothing here writes
 * back to Sleeper. All routes require an authenticated StatChasers user.
 *
 *   Rulebook
 *     GET   /api/commissioner/bylaws?leagueId=            → { leagueId, currentVersion, sections }
 *     PUT   /api/commissioner/bylaws                      → save sections, bump version
 *     GET   /api/commissioner/bylaws/history?leagueId=    → { versions: [...] }
 *     PATCH /api/commissioner/bylaws/section              → patch one section (pin/notes/title/body)
 *
 *   Commissioner Log
 *     GET   /api/commissioner/log?leagueId=&season=&status=&category=  → { entries: [...] }
 *     POST  /api/commissioner/log                         → create entry → { entry }
 *     PATCH /api/commissioner/log/:id                     → update status/severity/note/resolution
 *
 *   Draft pick notes
 *     GET   /api/commissioner/pick-notes?leagueId=        → { notes: [...] }
 *     PUT   /api/commissioner/pick-notes                  → upsert one note
 *     GET   /api/commissioner/pick-movement?leagueId=     → pick trades from commissionerTradeAssets
 */
import type { Express } from "express";
import { and, desc, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { db } from "./db";
import {
  leagueBylaws,
  commissionerLog,
  leaguePickNotes,
  commissionerTradeAssets,
} from "@shared/schema";

const LOG_CATEGORIES = new Set([
  "lineup_strike", "payment_issue", "inactivity_flag", "trade_concern",
  "tanking_concern", "behavior_issue", "rule_violation", "warning", "manual_note",
]);
const LOG_SEVERITIES = new Set(["info", "warning", "strike", "serious", "removal_risk"]);
const LOG_STATUSES = new Set(["open", "watching", "resolved", "escalated"]);

export function registerLeagueProfileRoutes(app: Express): void {
  const requireUser = (req: any, res: any): string | null => {
    const uid = getUserIdFromRequest(req);
    if (!uid) {
      res.status(401).json({ error: "Not authenticated" });
      return null;
    }
    return uid;
  };

  function handleErr(res: any, err: any, fallback: string) {
    res.status(500).json({ error: err?.message || fallback });
  }

  // ─── Rulebook / Bylaws ──────────────────────────────────────────────────────
  app.get("/api/commissioner/bylaws", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const rows = await db.select().from(leagueBylaws).where(eq(leagueBylaws.leagueId, leagueId)).limit(1);
      const row = rows[0];
      res.json({
        leagueId,
        currentVersion: row?.currentVersion ?? 0,
        sections: row?.sections ?? [],
      });
    } catch (err: any) {
      handleErr(res, err, "Failed to load bylaws");
    }
  });

  app.put("/api/commissioner/bylaws", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const { leagueId, sections, note } = req.body || {};
    if (!leagueId || typeof leagueId !== "string") return res.status(400).json({ error: "leagueId required" });
    if (!Array.isArray(sections)) return res.status(400).json({ error: "sections must be an array" });
    try {
      const existing = (await db.select().from(leagueBylaws).where(eq(leagueBylaws.leagueId, leagueId)).limit(1))[0];
      const nextVersion = (existing?.currentVersion ?? 0) + 1;
      const historyEntry = {
        version: nextVersion,
        sections,
        savedBy: uid,
        savedAt: new Date().toISOString(),
        note: typeof note === "string" ? note : undefined,
      };
      if (existing) {
        const history = Array.isArray(existing.versionHistory) ? existing.versionHistory : [];
        await db.update(leagueBylaws)
          .set({ sections, currentVersion: nextVersion, versionHistory: [...history, historyEntry], commissionerUserId: uid, updatedAt: new Date() })
          .where(eq(leagueBylaws.leagueId, leagueId));
      } else {
        await db.insert(leagueBylaws).values({
          leagueId, commissionerUserId: uid, currentVersion: 1, sections,
          versionHistory: [{ ...historyEntry, version: 1 }],
        });
      }
      res.json({ success: true, currentVersion: existing ? nextVersion : 1 });
    } catch (err: any) {
      handleErr(res, err, "Failed to save bylaws");
    }
  });

  app.get("/api/commissioner/bylaws/history", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const row = (await db.select().from(leagueBylaws).where(eq(leagueBylaws.leagueId, leagueId)).limit(1))[0];
      res.json({ versions: row?.versionHistory ?? [] });
    } catch (err: any) {
      handleErr(res, err, "Failed to load bylaw history");
    }
  });

  app.patch("/api/commissioner/bylaws/section", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const { leagueId, sectionId, patch } = req.body || {};
    if (!leagueId || !sectionId || !patch || typeof patch !== "object") {
      return res.status(400).json({ error: "leagueId, sectionId, patch required" });
    }
    try {
      const row = (await db.select().from(leagueBylaws).where(eq(leagueBylaws.leagueId, leagueId)).limit(1))[0];
      if (!row) return res.status(404).json({ error: "No bylaws yet" });
      const sections = (Array.isArray(row.sections) ? row.sections : []) as any[];
      const next = sections.map((s) => (s.sectionId === sectionId ? { ...s, ...patch } : s));
      await db.update(leagueBylaws).set({ sections: next, updatedAt: new Date() }).where(eq(leagueBylaws.leagueId, leagueId));
      res.json({ success: true });
    } catch (err: any) {
      handleErr(res, err, "Failed to update section");
    }
  });

  // ─── Commissioner Log ───────────────────────────────────────────────────────
  app.get("/api/commissioner/log", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const filters = [eq(commissionerLog.leagueId, leagueId)];
      if (req.query.season) filters.push(eq(commissionerLog.season, String(req.query.season)));
      if (req.query.status) filters.push(eq(commissionerLog.status, String(req.query.status)));
      if (req.query.category) filters.push(eq(commissionerLog.category, String(req.query.category)));
      const entries = await db.select().from(commissionerLog)
        .where(and(...filters))
        .orderBy(desc(commissionerLog.createdAt));
      res.json({ entries });
    } catch (err: any) {
      handleErr(res, err, "Failed to load log");
    }
  });

  app.post("/api/commissioner/log", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const b = req.body || {};
    if (!b.leagueId || !b.category) return res.status(400).json({ error: "leagueId and category required" });
    if (!LOG_CATEGORIES.has(b.category)) return res.status(400).json({ error: "invalid category" });
    if (b.severity && !LOG_SEVERITIES.has(b.severity)) return res.status(400).json({ error: "invalid severity" });
    if (b.status && !LOG_STATUSES.has(b.status)) return res.status(400).json({ error: "invalid status" });
    try {
      const [entry] = await db.insert(commissionerLog).values({
        leagueId: b.leagueId,
        season: b.season || "2026",
        rosterId: b.rosterId ?? null,
        ownerId: b.ownerId ?? null,
        managerName: b.managerName ?? null,
        teamName: b.teamName ?? null,
        category: b.category,
        severity: b.severity || "info",
        status: b.status || "open",
        linkedRuleSectionId: b.linkedRuleSectionId ?? null,
        note: b.note ?? null,
        resolution: b.resolution ?? null,
        evidenceUrl: b.evidenceUrl ?? null,
        activityRef: b.activityRef ?? null,
        commissionerUserId: uid,
      }).returning();
      res.json({ entry });
    } catch (err: any) {
      handleErr(res, err, "Failed to create log entry");
    }
  });

  app.patch("/api/commissioner/log/:id", async (req, res) => {
    if (!requireUser(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    const b = req.body || {};
    if (b.severity && !LOG_SEVERITIES.has(b.severity)) return res.status(400).json({ error: "invalid severity" });
    if (b.status && !LOG_STATUSES.has(b.status)) return res.status(400).json({ error: "invalid status" });
    try {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of ["status", "severity", "note", "resolution", "evidenceUrl", "linkedRuleSectionId"]) {
        if (k in b) patch[k] = b[k];
      }
      await db.update(commissionerLog).set(patch).where(eq(commissionerLog.id, id));
      res.json({ success: true });
    } catch (err: any) {
      handleErr(res, err, "Failed to update log entry");
    }
  });

  // ─── Draft pick notes / movement ────────────────────────────────────────────
  app.get("/api/commissioner/pick-notes", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const notes = await db.select().from(leaguePickNotes).where(eq(leaguePickNotes.leagueId, leagueId));
      res.json({ notes });
    } catch (err: any) {
      handleErr(res, err, "Failed to load pick notes");
    }
  });

  app.put("/api/commissioner/pick-notes", async (req, res) => {
    if (!requireUser(req, res)) return;
    const b = req.body || {};
    const round = parseInt(String(b.round), 10);
    const originalRosterId = parseInt(String(b.originalRosterId), 10);
    if (!b.leagueId || !b.pickSeason || !Number.isFinite(round) || !Number.isFinite(originalRosterId)) {
      return res.status(400).json({ error: "leagueId, pickSeason, round, originalRosterId required" });
    }
    try {
      await db.insert(leaguePickNotes).values({
        leagueId: b.leagueId, pickSeason: String(b.pickSeason), round, originalRosterId,
        note: b.note ?? null, protection: b.protection ?? null,
      }).onConflictDoUpdate({
        target: [leaguePickNotes.leagueId, leaguePickNotes.pickSeason, leaguePickNotes.round, leaguePickNotes.originalRosterId],
        set: { note: b.note ?? null, protection: b.protection ?? null, updatedAt: new Date() },
      });
      res.json({ success: true });
    } catch (err: any) {
      handleErr(res, err, "Failed to save pick note");
    }
  });

  app.get("/api/commissioner/pick-movement", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const movements = await db.select().from(commissionerTradeAssets)
        .where(and(eq(commissionerTradeAssets.leagueId, leagueId), eq(commissionerTradeAssets.assetType, "pick")));
      res.json({ movements });
    } catch (err: any) {
      handleErr(res, err, "Failed to load pick movement");
    }
  });
}
