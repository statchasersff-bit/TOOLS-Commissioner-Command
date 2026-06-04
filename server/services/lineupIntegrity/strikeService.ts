/**
 * Commissioner strikes — official, manually-issued warnings. The system never
 * auto-issues a strike unless a league explicitly opts in (autoCreateStrikes,
 * off by default). Issuing a strike also marks the related lineup check as
 * "strike_issued" for the review queue.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { commissionerLineupStrikes, commissionerLineupChecks } from "@shared/schema";

export interface IssueStrikeInput {
  leagueId: string;
  season: string;
  week: number;
  rosterId: number;
  ownerId?: string | null;
  managerName?: string | null;
  teamName?: string | null;
  strikeType: string;
  severity: string;
  reason: string;
  evidence?: Record<string, unknown>;
  commissionerUserId?: string | null;
  commissionerNotes?: string | null;
}

export async function issueStrike(input: IssueStrikeInput): Promise<{ id: number }> {
  const rows = await db
    .insert(commissionerLineupStrikes)
    .values({
      leagueId: input.leagueId,
      season: input.season,
      week: input.week,
      rosterId: input.rosterId,
      ownerId: input.ownerId ?? null,
      managerName: input.managerName ?? null,
      teamName: input.teamName ?? null,
      strikeType: input.strikeType,
      severity: input.severity,
      reason: input.reason,
      evidence: (input.evidence ?? {}) as unknown,
      commissionerUserId: input.commissionerUserId ?? null,
      commissionerNotes: input.commissionerNotes ?? null,
      status: "active",
    } as any)
    .returning({ id: commissionerLineupStrikes.id });

  await db
    .update(commissionerLineupChecks)
    .set({ reviewStatus: "strike_issued", updatedAt: new Date() })
    .where(
      and(
        eq(commissionerLineupChecks.leagueId, input.leagueId),
        eq(commissionerLineupChecks.season, input.season),
        eq(commissionerLineupChecks.week, input.week),
        eq(commissionerLineupChecks.rosterId, input.rosterId),
      ),
    );

  return { id: rows[0].id };
}

export async function updateStrike(
  strikeId: number,
  patch: { status?: string; commissionerNotes?: string },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.status) {
    set.status = patch.status;
    if (patch.status === "resolved" || patch.status === "overturned" || patch.status === "expired") {
      set.resolvedAt = new Date();
    }
  }
  if (patch.commissionerNotes != null) set.commissionerNotes = patch.commissionerNotes;
  if (!Object.keys(set).length) return;
  await db.update(commissionerLineupStrikes).set(set).where(eq(commissionerLineupStrikes.id, strikeId));
}

export interface StrikeRow {
  id: number;
  rosterId: number;
  managerName: string | null;
  teamName: string | null;
  strikeType: string;
  severity: string;
  reason: string;
  week: number;
  status: string;
  commissionerNotes: string | null;
  createdAt: Date | null;
}

export async function listStrikes(leagueId: string, season?: string): Promise<StrikeRow[]> {
  const where = season
    ? and(eq(commissionerLineupStrikes.leagueId, leagueId), eq(commissionerLineupStrikes.season, season))
    : eq(commissionerLineupStrikes.leagueId, leagueId);

  const rows = await db
    .select()
    .from(commissionerLineupStrikes)
    .where(where)
    .orderBy(desc(commissionerLineupStrikes.createdAt));

  return rows.map((r) => ({
    id: r.id,
    rosterId: r.rosterId,
    managerName: r.managerName,
    teamName: r.teamName,
    strikeType: r.strikeType,
    severity: r.severity,
    reason: r.reason,
    week: r.week,
    status: r.status ?? "active",
    commissionerNotes: r.commissionerNotes,
    createdAt: r.createdAt,
  }));
}
