/**
 * Lineup Integrity & Anti-Tanking HTTP routes (Commissioner decision-support).
 *
 *   POST  /api/commissioner/lineup-integrity/refresh            → scan Sleeper, store checks + alerts
 *   GET   /api/commissioner/lineup-integrity/overview           → week summary + top alerts + risk teams
 *   GET   /api/commissioner/lineup-integrity/checks             → per-roster checks (filterable)
 *   GET   /api/commissioner/lineup-integrity/checks/:checkId    → one check detail (+ copy messages)
 *   GET   /api/commissioner/lineup-integrity/alerts             → alerts feed
 *   PATCH /api/commissioner/lineup-integrity/alerts/:alertId    → acknowledge/resolve/dismiss + notes
 *   POST  /api/commissioner/lineup-integrity/strikes            → issue a strike
 *   GET   /api/commissioner/lineup-integrity/strikes            → strike tracker
 *   PATCH /api/commissioner/lineup-integrity/strikes/:strikeId  → overturn/resolve a strike
 *   GET   /api/commissioner/lineup-integrity/manager-history    → per-manager season history
 *   GET   /api/commissioner/lineup-integrity/report             → copy-ready weekly report
 *   GET   /api/commissioner/lineup-integrity/multi-league       → aggregate across leagues
 *   GET   /api/commissioner/lineup-integrity/settings           → effective settings + policy text
 *   PATCH /api/commissioner/lineup-integrity/settings           → update settings
 *
 * Decision-support only — no route writes back to Sleeper, messages managers,
 * or changes standings. All routes require an authenticated StatChasers user.
 */
import type { Express } from "express";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { getNflState, getLeague } from "./services/commissionerActivity/sleeperActivityApi";
import {
  ingestLineupIntegrityForLeague,
  getLineupIntegritySettings,
  upsertLineupIntegritySettings,
  getOverview,
  listChecks,
  getCheckDetail,
  listAlerts,
  updateAlert,
  getManagerHistory,
  getWeeklyReport,
  getMultiLeagueSummary,
  getLatestWeek,
  issueStrike,
  updateStrike,
  listStrikes,
  getLeagueWeekAudit,
  appendAuditEntry,
  listAuditLog,
} from "./services/lineupIntegrity";
import { buildCopyMessages, RECOMMENDED_POLICY_TEXT } from "./services/lineupIntegrity/lineupIntegritySummary";

function parseIntOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

export function registerLineupIntegrityRoutes(app: Express): void {
  const requireUser = (req: any, res: any): string | null => {
    const uid = getUserIdFromRequest(req);
    if (!uid) {
      res.status(401).json({ error: "Not authenticated" });
      return null;
    }
    return uid;
  };

  async function resolveSeason(explicit?: unknown): Promise<string> {
    if (explicit && typeof explicit === "string") return explicit;
    const state = await getNflState().catch(() => null);
    return String(state?.season ?? new Date().getFullYear());
  }

  function handleErr(res: any, err: any, fallback: string) {
    const status = /sleeper|fetch/i.test(err?.message || "") ? 502 : 500;
    res.status(status).json({ error: err?.message || fallback });
  }

  app.post("/api/commissioner/lineup-integrity/refresh", async (req, res) => {
    if (!requireUser(req, res)) return;
    const { leagueId, weeks, forceRefresh, season } = req.body || {};
    if (!leagueId || typeof leagueId !== "string") {
      return res.status(400).json({ error: "leagueId required" });
    }
    const weekList = Array.isArray(weeks)
      ? weeks.map((w) => parseInt(String(w), 10)).filter((w) => Number.isFinite(w))
      : undefined;
    try {
      const result = await ingestLineupIntegrityForLeague(leagueId, {
        weeks: weekList,
        forceRefresh: Boolean(forceRefresh),
        season: typeof season === "string" ? season : undefined,
      });
      res.json(result);
    } catch (err: any) {
      handleErr(res, err, "Lineup integrity refresh failed");
    }
  });

  app.get("/api/commissioner/lineup-integrity/overview", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const season = await resolveSeason(req.query.season);
      const week = parseIntOrNull(req.query.week) ?? (await getLatestWeek(leagueId, season)) ?? 0;
      const overview = await getOverview(leagueId, season, week);
      res.json({ leagueId, season, ...overview });
    } catch (err: any) {
      handleErr(res, err, "Failed to load overview");
    }
  });

  app.get("/api/commissioner/lineup-integrity/checks", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const season = await resolveSeason(req.query.season);
      const week = parseIntOrNull(req.query.week) ?? (await getLatestWeek(leagueId, season)) ?? 0;
      const checks = await listChecks(leagueId, season, week, {
        riskLabel: req.query.riskLabel ? String(req.query.riskLabel) : undefined,
        reviewStatus: req.query.reviewStatus ? String(req.query.reviewStatus) : undefined,
        rosterId: parseIntOrNull(req.query.rosterId) ?? undefined,
        flag: req.query.flag ? String(req.query.flag) : undefined,
        hasAlerts: req.query.hasAlerts === "true" ? true : undefined,
      });
      res.json({ leagueId, season, week, checks });
    } catch (err: any) {
      handleErr(res, err, "Failed to load checks");
    }
  });

  app.get("/api/commissioner/lineup-integrity/checks/:checkId", async (req, res) => {
    if (!requireUser(req, res)) return;
    const checkId = parseIntOrNull(req.params.checkId);
    if (checkId == null) return res.status(400).json({ error: "invalid checkId" });
    try {
      const detail = await getCheckDetail(checkId);
      if (!detail) return res.status(404).json({ error: "check not found" });
      const copyMessages = buildCopyMessages(
        {
          week: detail.check.week,
          suspiciousBenchingDetails: detail.suspiciousBenchings.map((s) => ({
            benchName: s.betterBenchPlayerName ?? "[Bench Player]",
            starterName: s.playerName ?? "[Started Player]",
          })),
        },
        {
          managerName: detail.check.managerName ?? "",
          teamName: detail.check.teamName ?? "",
        },
      );
      res.json({ ...detail, copyMessages });
    } catch (err: any) {
      handleErr(res, err, "Failed to load check detail");
    }
  });

  // ── League-specific weekly audit (Matchup Integrity Board + issue feed) ──────
  app.get("/api/commissioner/lineup-integrity/league-week-audit", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const season = await resolveSeason(req.query.season);
      const week = parseIntOrNull(req.query.week) ?? (await getLatestWeek(leagueId, season)) ?? 0;
      const audit = await getLeagueWeekAudit(leagueId, season, week);
      res.json(audit);
    } catch (err: any) {
      handleErr(res, err, "Failed to load league audit");
    }
  });

  // ── Per-issue audit log (commissioner action trail / dispute protection) ─────
  app.get("/api/commissioner/lineup-integrity/audit-log", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const season = await resolveSeason(req.query.season);
      const entries = await listAuditLog({
        leagueId,
        season,
        week: parseIntOrNull(req.query.week) ?? undefined,
        lineupCheckId: parseIntOrNull(req.query.lineupCheckId) ?? undefined,
        issueKey: req.query.issueKey ? String(req.query.issueKey) : undefined,
      });
      res.json({ leagueId, season, entries });
    } catch (err: any) {
      handleErr(res, err, "Failed to load audit log");
    }
  });

  app.post("/api/commissioner/lineup-integrity/audit-log", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const b = req.body || {};
    if (!b.leagueId || !b.action || b.week == null) {
      return res.status(400).json({ error: "leagueId, week, action required" });
    }
    try {
      const season = await resolveSeason(b.season);
      const entry = await appendAuditEntry({
        leagueId: String(b.leagueId),
        season,
        week: parseInt(String(b.week), 10) || 0,
        rosterId: b.rosterId != null ? parseInt(String(b.rosterId), 10) : null,
        lineupCheckId: b.lineupCheckId != null ? parseInt(String(b.lineupCheckId), 10) : null,
        issueKey: b.issueKey ?? null,
        action: String(b.action),
        actor: b.actor ? String(b.actor) : "Commissioner",
        actorUserId: uid,
        note: b.note ?? null,
      });
      res.json({ success: true, entry });
    } catch (err: any) {
      handleErr(res, err, "Failed to record audit entry");
    }
  });

  app.get("/api/commissioner/lineup-integrity/alerts", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const season = req.query.season ? String(req.query.season) : await resolveSeason();
      const alerts = await listAlerts(leagueId, season, {
        status: req.query.status ? String(req.query.status) : undefined,
        week: parseIntOrNull(req.query.week) ?? undefined,
        alertType: req.query.alertType ? String(req.query.alertType) : undefined,
      });
      res.json({ leagueId, season, alerts });
    } catch (err: any) {
      handleErr(res, err, "Failed to load alerts");
    }
  });

  app.patch("/api/commissioner/lineup-integrity/alerts/:alertId", async (req, res) => {
    if (!requireUser(req, res)) return;
    const alertId = parseIntOrNull(req.params.alertId);
    if (alertId == null) return res.status(400).json({ error: "invalid alertId" });
    const { status, notes } = req.body || {};
    const allowed = ["open", "acknowledged", "resolved", "dismissed"];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ error: "invalid status" });
    }
    try {
      await updateAlert(alertId, { status, notes });
      res.json({ success: true, alertId, status });
    } catch (err: any) {
      handleErr(res, err, "Failed to update alert");
    }
  });

  app.post("/api/commissioner/lineup-integrity/strikes", async (req, res) => {
    const uid = requireUser(req, res);
    if (!uid) return;
    const b = req.body || {};
    if (!b.leagueId || b.rosterId == null || !b.strikeType || !b.reason) {
      return res.status(400).json({ error: "leagueId, rosterId, strikeType, reason required" });
    }
    try {
      const season = await resolveSeason(b.season);
      const result = await issueStrike({
        leagueId: String(b.leagueId),
        season,
        week: parseInt(String(b.week ?? 0), 10) || 0,
        rosterId: parseInt(String(b.rosterId), 10),
        ownerId: b.ownerId ?? null,
        managerName: b.managerName ?? null,
        teamName: b.teamName ?? null,
        strikeType: String(b.strikeType),
        severity: String(b.severity ?? "medium"),
        reason: String(b.reason),
        evidence: b.evidence ?? {},
        commissionerUserId: uid,
        commissionerNotes: b.commissionerNotes ?? null,
      });
      res.json({ success: true, strikeId: result.id });
    } catch (err: any) {
      handleErr(res, err, "Failed to issue strike");
    }
  });

  app.get("/api/commissioner/lineup-integrity/strikes", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const season = req.query.season ? String(req.query.season) : await resolveSeason();
      const strikes = await listStrikes(leagueId, season);
      res.json({ leagueId, season, strikes });
    } catch (err: any) {
      handleErr(res, err, "Failed to load strikes");
    }
  });

  app.patch("/api/commissioner/lineup-integrity/strikes/:strikeId", async (req, res) => {
    if (!requireUser(req, res)) return;
    const strikeId = parseIntOrNull(req.params.strikeId);
    if (strikeId == null) return res.status(400).json({ error: "invalid strikeId" });
    const { status, commissionerNotes } = req.body || {};
    const allowed = ["active", "overturned", "resolved", "expired"];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: "invalid status" });
    try {
      await updateStrike(strikeId, { status, commissionerNotes });
      res.json({ success: true, strikeId, status });
    } catch (err: any) {
      handleErr(res, err, "Failed to update strike");
    }
  });

  app.get("/api/commissioner/lineup-integrity/manager-history", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const season = await resolveSeason(req.query.season);
      const managers = await getManagerHistory(leagueId, season);
      res.json({ leagueId, season, managers });
    } catch (err: any) {
      handleErr(res, err, "Failed to load manager history");
    }
  });

  app.get("/api/commissioner/lineup-integrity/report", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const season = await resolveSeason(req.query.season);
      const week = parseIntOrNull(req.query.week) ?? (await getLatestWeek(leagueId, season)) ?? 0;
      const league = await getLeague(leagueId).catch(() => null);
      const leagueName = (league?.name as string) ?? "League";
      const copyText = await getWeeklyReport(leagueId, season, week, leagueName);
      res.json({ leagueId, season, week, copyText });
    } catch (err: any) {
      handleErr(res, err, "Failed to build report");
    }
  });

  app.get("/api/commissioner/lineup-integrity/multi-league", async (req, res) => {
    if (!requireUser(req, res)) return;
    const raw = String(req.query.leagueIds || "");
    const leagueIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!leagueIds.length) return res.status(400).json({ error: "leagueIds required (comma-separated)" });
    try {
      const season = await resolveSeason(req.query.season);
      const week = parseIntOrNull(req.query.week);
      const allOpen = req.query.allOpen === "true" || req.query.allOpen === "1";
      const live = req.query.live === "true" || req.query.live === "1";
      const result = await getMultiLeagueSummary(leagueIds, season, { week, allOpen, live });
      res.json({ season, ...result });
    } catch (err: any) {
      handleErr(res, err, "Failed to load multi-league summary");
    }
  });

  app.get("/api/commissioner/lineup-integrity/settings", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    try {
      const settings = await getLineupIntegritySettings(leagueId);
      res.json({ leagueId, settings, policyText: RECOMMENDED_POLICY_TEXT });
    } catch (err: any) {
      handleErr(res, err, "Failed to load settings");
    }
  });

  app.patch("/api/commissioner/lineup-integrity/settings", async (req, res) => {
    if (!requireUser(req, res)) return;
    const leagueId = String(req.query.leagueId || req.body?.leagueId || "");
    if (!leagueId) return res.status(400).json({ error: "leagueId required" });
    const allowedKeys = new Set([
      "enableEmptySlotChecks", "enableByeStarterChecks", "enableInactiveStarterChecks",
      "enableOutStarterChecks", "enableIrStarterChecks", "enableDoubtfulStarterChecks",
      "enableQuestionableStarterChecks",
      "enableUnchangedLineupChecks",
      "enableSuspiciousBenchingChecks", "enableTankingRiskChecks",
      "suspiciousBenchingValueGap", "suspiciousBenchingProjectionGap",
      "optimalityGapWarning", "optimalityGapCritical",
      "repeatIssueWeeks", "strikeAfterRepeatIssues", "playoffIntegrityStartWeek",
      "ignoreLineupChecksInOffseason", "ignoreLineupChecksForBestBall", "ignoreEliminatedTeams",
      "autoCreateAlerts", "autoCreateStrikes",
    ]);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (allowedKeys.has(k)) patch[k] = v;
    }
    try {
      const settings = await upsertLineupIntegritySettings(leagueId, patch as any);
      res.json({ success: true, leagueId, settings });
    } catch (err: any) {
      handleErr(res, err, "Failed to update settings");
    }
  });
}
