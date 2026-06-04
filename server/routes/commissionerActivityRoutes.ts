/**
 * League Activity Monitoring HTTP routes (Commissioner Command).
 *
 * Mounted under /api/commissioner/activity. All endpoints are league-scoped via
 * a `leagueId` query/body param and operate on PUBLIC Sleeper data, mirroring the
 * read-only posture of the Trade Review Center — nothing here writes back to
 * Sleeper or messages managers. The refresh endpoint runs the ingest pipeline;
 * every other GET reads persisted rows so the dashboard renders instantly.
 *
 *   POST  /refresh                 — scan league for weeks (default prev+current)
 *   GET   /overview                — league health cards + top alerts + leaders
 *   GET   /managers                — per-manager rows (sorted by inactivity risk)
 *   GET   /feed                    — normalized activity events (filterable)
 *   GET   /alerts                  — commissioner alerts (filter by status)
 *   PATCH /alerts/:alertId         — acknowledge / resolve / dismiss / note
 *   GET   /report                  — copy-ready weekly commissioner report
 *   GET   /reminders               — copy-ready reminder templates
 *   GET   /settings                — effective league thresholds
 *   PATCH /settings                — update thresholds
 *   GET   /multi-overview          — aggregate latest snapshots across leagues
 */
import type { Express, Request, Response } from "express";
import { ingestLeagueActivityForLeague } from "../services/commissionerActivity/ingestLeagueActivity";
import {
  getSnapshot,
  getLatestSnapshot,
  getManagerRows,
  getEvents,
  getAlerts,
  updateAlertStatus,
  countOpenAlerts,
  type FeedFilters,
} from "../services/commissionerActivity/storage";
import {
  buildOverview,
  generateWeeklyActivityReport,
  reminderTemplate,
  type ReminderTone,
} from "../services/commissionerActivity/activitySummary";
import {
  getActivitySettings,
  updateActivitySettings,
} from "../services/commissionerActivity/activitySettings";
import { getNflState } from "../services/commissionerActivity/sleeperActivityApi";
import type { ActivitySettings } from "../services/commissionerActivity/types";
import type { CommissionerManagerActivity } from "@shared/schema";

const ALLOWED_STATUS = new Set(["open", "acknowledged", "resolved", "dismissed"]);

function parseIntOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function getLeagueId(req: Request): string | null {
  const v = (req.query.leagueId ?? req.body?.leagueId) as unknown;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function safeSeason(): Promise<string> {
  try {
    return String((await getNflState()).season ?? new Date().getFullYear());
  } catch {
    return String(new Date().getFullYear());
  }
}

/**
 * Resolve (season, week) for a read. If a week is supplied, pair it with the
 * supplied or current-NFL season. Otherwise fall back to the latest stored
 * snapshot, and finally to current NFL state.
 */
async function resolveSeasonWeek(
  leagueId: string,
  req: Request,
): Promise<{ season: string; week: number | null }> {
  const reqWeek = parseIntOrNull(req.query.week);
  const reqSeason = typeof req.query.season === "string" ? req.query.season : undefined;
  if (reqWeek != null) {
    const season = reqSeason ?? (await safeSeason());
    return { season, week: reqWeek };
  }
  const latest = await getLatestSnapshot(leagueId, reqSeason ?? (await safeSeason()));
  if (latest) return { season: latest.season, week: latest.week };
  return { season: reqSeason ?? (await safeSeason()), week: null };
}

/** Map rosterId → manager/team row for enriching alerts. */
function nameIndex(managers: CommissionerManagerActivity[]) {
  const byRoster = new Map<number, CommissionerManagerActivity>();
  for (const m of managers) byRoster.set(m.rosterId, m);
  return byRoster;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Whitelist + coerce the settings patch body to the known fields/types. */
function sanitizeSettingsPatch(body: Record<string, unknown>): Partial<ActivitySettings> {
  const out: Partial<ActivitySettings> = {};
  const numKeys: (keyof ActivitySettings)[] = [
    "inactiveTransactionWeeks",
    "inactiveLineupWeeks",
    "unchangedLineupWeeks",
    "lowActivityScoreThreshold",
    "inactiveManagerScoreThreshold",
  ];
  const boolKeys: (keyof ActivitySettings)[] = [
    "flagEmptyStarters",
    "flagNoTransactions",
    "flagUnchangedLineups",
    "flagLowLeagueActivity",
    "ignoreLineupChecksInOffseason",
    "ignoreLineupChecksForBestBall",
    "includeTradesInActivityScore",
    "includeWaiversInActivityScore",
    "includeFreeAgentMovesInActivityScore",
  ];
  for (const k of numKeys) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v)) (out as any)[k] = Math.round(v);
    else if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) (out as any)[k] = Math.round(Number(v));
  }
  for (const k of boolKeys) {
    const v = body[k];
    if (typeof v === "boolean") (out as any)[k] = v;
  }
  return out;
}

export function registerCommissionerActivityRoutes(app: Express): void {
  const BASE = "/api/commissioner/activity";

  // ── Refresh (run a scan) ──
  app.post(`${BASE}/refresh`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const weeks = Array.isArray(req.body?.weeks)
        ? req.body.weeks.map((w: unknown) => parseIntOrNull(w)).filter((w: number | null): w is number => w != null)
        : undefined;
      const mode = req.body?.mode === "season" ? "season" : "recent";
      const result = await ingestLeagueActivityForLeague({
        leagueId,
        season: typeof req.body?.season === "string" ? req.body.season : undefined,
        weeks: weeks && weeks.length ? weeks : undefined,
        mode,
        forceRefresh: Boolean(req.body?.forceRefresh),
      });
      res.json(result);
    } catch (err) {
      console.error("[CommissionerActivity] refresh failed:", err);
      res.status(502).json({ error: "Activity scan failed", detail: errMsg(err) });
    }
  });

  // ── Overview ──
  app.get(`${BASE}/overview`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const { season, week } = await resolveSeasonWeek(leagueId, req);
      const snapshot = week != null ? await getSnapshot(leagueId, season, week) : null;
      const managers = week != null ? await getManagerRows(leagueId, season, week) : [];
      const alerts = await getAlerts(leagueId, { season: season || undefined });
      res.json({ season, week, ...buildOverview(snapshot, managers, alerts) });
    } catch (err) {
      console.error("[CommissionerActivity] overview failed:", err);
      res.status(500).json({ error: "Failed to load overview", detail: errMsg(err) });
    }
  });

  // ── Manager activity ──
  app.get(`${BASE}/managers`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const { season, week } = await resolveSeasonWeek(leagueId, req);
      const managers = week != null ? await getManagerRows(leagueId, season, week) : [];
      res.json({ season, week, managers });
    } catch (err) {
      console.error("[CommissionerActivity] managers failed:", err);
      res.status(500).json({ error: "Failed to load managers", detail: errMsg(err) });
    }
  });

  // ── Activity feed ──
  app.get(`${BASE}/feed`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const { season, week } = await resolveSeasonWeek(leagueId, req);
      const filters: FeedFilters = {
        eventType: typeof req.query.eventType === "string" ? req.query.eventType : undefined,
        rosterId: parseIntOrNull(req.query.rosterId) ?? undefined,
        severity: typeof req.query.severity === "string" ? req.query.severity : undefined,
        fromTs: parseIntOrNull(req.query.fromDate) ?? undefined,
        toTs: parseIntOrNull(req.query.toDate) ?? undefined,
      };
      // Feed can span the whole season when no week is pinned via ?allWeeks=1.
      const wk = req.query.allWeeks === "1" ? null : week;
      const events = await getEvents(leagueId, season, wk, filters);
      res.json({ season, week: wk, events });
    } catch (err) {
      console.error("[CommissionerActivity] feed failed:", err);
      res.status(500).json({ error: "Failed to load feed", detail: errMsg(err) });
    }
  });

  // ── Alerts ──
  app.get(`${BASE}/alerts`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const alerts = await getAlerts(leagueId, { status });
      // Enrich with manager/team names from the latest stored week.
      const latest = await getLatestSnapshot(leagueId, await safeSeason());
      const managers =
        latest != null ? await getManagerRows(leagueId, latest.season, latest.week) : [];
      const idx = nameIndex(managers);
      const enriched = alerts.map((a) => ({
        ...a,
        managerName: a.rosterId != null ? idx.get(a.rosterId)?.managerName ?? null : null,
        teamName: a.rosterId != null ? idx.get(a.rosterId)?.teamName ?? null : null,
      }));
      res.json({ alerts: enriched });
    } catch (err) {
      console.error("[CommissionerActivity] alerts failed:", err);
      res.status(500).json({ error: "Failed to load alerts", detail: errMsg(err) });
    }
  });

  // ── Update an alert ──
  app.patch(`${BASE}/alerts/:alertId`, async (req: Request, res: Response) => {
    const alertId = parseIntOrNull(req.params.alertId);
    if (alertId == null) return res.status(400).json({ error: "Invalid alertId" });
    const status = typeof req.body?.status === "string" ? req.body.status : undefined;
    if (!status || !ALLOWED_STATUS.has(status)) {
      return res.status(400).json({ error: "status must be one of open|acknowledged|resolved|dismissed" });
    }
    try {
      const updated = await updateAlertStatus(
        alertId,
        status,
        typeof req.body?.notes === "string" ? req.body.notes : undefined,
      );
      if (!updated) return res.status(404).json({ error: "Alert not found" });
      res.json({ alert: updated });
    } catch (err) {
      console.error("[CommissionerActivity] update alert failed:", err);
      res.status(500).json({ error: "Failed to update alert", detail: errMsg(err) });
    }
  });

  // ── Weekly report ──
  app.get(`${BASE}/report`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const { season, week } = await resolveSeasonWeek(leagueId, req);
      const snapshot = week != null ? await getSnapshot(leagueId, season, week) : null;
      const managers = week != null ? await getManagerRows(leagueId, season, week) : [];
      const alerts = await getAlerts(leagueId, { season: season || undefined });
      const copyText = generateWeeklyActivityReport(snapshot, managers, alerts);
      res.json({ season, week, copyText });
    } catch (err) {
      console.error("[CommissionerActivity] report failed:", err);
      res.status(500).json({ error: "Failed to generate report", detail: errMsg(err) });
    }
  });

  // ── Reminder templates ──
  app.get(`${BASE}/reminders`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const rosterId = parseIntOrNull(req.query.rosterId);
      const { season, week } = await resolveSeasonWeek(leagueId, req);
      const managers = week != null ? await getManagerRows(leagueId, season, week) : [];
      const manager =
        rosterId != null ? managers.find((m) => m.rosterId === rosterId) ?? null : null;
      const managerName = manager?.managerName ?? "manager";
      const tones: ReminderTone[] = ["soft", "empty_starter", "inactivity", "stronger"];
      const templates = tones.map((tone) => ({
        tone,
        text: reminderTemplate(tone, { managerName, week }),
      }));
      res.json({ rosterId, managerName, week, templates });
    } catch (err) {
      console.error("[CommissionerActivity] reminders failed:", err);
      res.status(500).json({ error: "Failed to build reminders", detail: errMsg(err) });
    }
  });

  // ── Settings ──
  app.get(`${BASE}/settings`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const settings = await getActivitySettings(leagueId);
      res.json({ leagueId, settings });
    } catch (err) {
      console.error("[CommissionerActivity] get settings failed:", err);
      res.status(500).json({ error: "Failed to load settings", detail: errMsg(err) });
    }
  });

  app.patch(`${BASE}/settings`, async (req: Request, res: Response) => {
    const leagueId = getLeagueId(req);
    if (!leagueId) return res.status(400).json({ error: "leagueId is required" });
    try {
      const patch = sanitizeSettingsPatch(req.body ?? {});
      const settings = await updateActivitySettings(leagueId, patch);
      res.json({ leagueId, settings });
    } catch (err) {
      console.error("[CommissionerActivity] patch settings failed:", err);
      res.status(500).json({ error: "Failed to update settings", detail: errMsg(err) });
    }
  });

  // ── Multi-league aggregate ──
  app.get(`${BASE}/multi-overview`, async (req: Request, res: Response) => {
    const raw = typeof req.query.leagueIds === "string" ? req.query.leagueIds : "";
    const leagueIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!leagueIds.length) return res.status(400).json({ error: "leagueIds (comma-separated) is required" });
    try {
      const season = await safeSeason();
      const rows = await Promise.all(
        leagueIds.map(async (leagueId) => {
          const snapshot = await getLatestSnapshot(leagueId, season);
          const openAlerts = await countOpenAlerts(leagueId);
          return {
            leagueId,
            hasData: snapshot != null,
            week: snapshot?.week ?? null,
            leagueActivityScore: snapshot?.leagueActivityScore ?? null,
            leagueActivityLabel: snapshot?.leagueActivityLabel ?? "unknown",
            activeManagerCount: snapshot?.activeManagerCount ?? null,
            inactiveManagerCount: snapshot?.inactiveManagerCount ?? null,
            totalTransactions: snapshot?.totalTransactions ?? null,
            totalEmptyStarterSlots: snapshot?.totalEmptyStarterSlots ?? null,
            openAlerts,
            lastScan: snapshot?.updatedAt ?? null,
          };
        }),
      );
      res.json({ season, leagues: rows });
    } catch (err) {
      console.error("[CommissionerActivity] multi-overview failed:", err);
      res.status(500).json({ error: "Failed to load multi-league overview", detail: errMsg(err) });
    }
  });
}
