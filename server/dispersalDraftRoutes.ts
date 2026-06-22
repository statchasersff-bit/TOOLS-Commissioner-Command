/**
 * Dispersal Draft API — ported from the standalone dispersal-draft app.
 *
 * Mounted under `/api/dispersal`. A commissioner creates a room (bound to their
 * StatChasers account), adds orphan-team assets, shares a private code, managers
 * join slots, and a live board updates in real time over Socket.io.
 *
 * Auth model (bridged): every commissioner action is authorized if EITHER the
 * request carries the room's `commissionerToken` (original share-link model) OR
 * the logged-in StatChasers user is the room's `creatorUserId`. Room creation
 * requires a logged-in account.
 */
import { Router, type Express, type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "./db";
import {
  dispersalRooms,
  dispersalParticipants,
  dispersalAssets,
  dispersalPicks,
  dispersalChatMessages,
  type DispersalRoom,
} from "@shared/schema";
import { requireAuth } from "./accessMiddleware";
import { getUserIdFromRequest } from "./scAuthRoutes";
import { getIo } from "./dispersalDraft/socket";
import { getOnTheClockId } from "./dispersalDraft/draftUtils";
import { computeEffectiveElapsedSeconds } from "./dispersalDraft/pauseWindow";
import { postSystemMessage, broadcastChatMessage, serializeChatMessage } from "./dispersalDraft/chatUtils";

const SHARE_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_MSG_LENGTH = 500;
const QUICK_REACTIONS = ["🔥", "👀", "💀", "😭", "🚨"];

// In-memory per-participant chat cooldown: participantId -> last sent ms.
const cooldowns = new Map<number, number>();

function randomSuffix(length: number): string {
  return Array.from({ length }, () => SHARE_CODE_CHARS[Math.floor(Math.random() * SHARE_CODE_CHARS.length)]).join("");
}

function generateShareCode(commissionerName: string): string {
  const namePart = commissionerName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const suffix = randomSuffix(5);
  return namePart ? `${namePart}-${suffix}` : suffix;
}

function generateToken(length = 32): string {
  return randomBytes(length).toString("hex").slice(0, length).toUpperCase();
}

function tokenFrom(req: Request): string | undefined {
  return (req.body?.commissionerToken ?? (req.query?.commissionerToken as string | undefined)) as string | undefined;
}

/** Commissioner authorization: room token OR logged-in creator account. */
function isCommissioner(req: Request, room: DispersalRoom): boolean {
  const token = tokenFrom(req);
  if (token && token === room.commissionerToken) return true;
  const uid = getUserIdFromRequest(req);
  if (uid && room.creatorUserId && uid === room.creatorUserId) return true;
  return false;
}

const idParam = (v: unknown) => parseInt(Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""), 10);

/** Wrap an async handler so rejected promises become 500s (defensive). */
function h(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error("[dispersal-draft] handler error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    });
  };
}

// Shared selection for picks enriched with participant/asset display fields.
const enrichedPickSelect = {
  id: dispersalPicks.id,
  draftRoomId: dispersalPicks.draftRoomId,
  participantId: dispersalPicks.participantId,
  assetId: dispersalPicks.assetId,
  pickNumber: dispersalPicks.pickNumber,
  round: dispersalPicks.round,
  pickedAt: dispersalPicks.pickedAt,
  participantUsername: dispersalParticipants.username,
  assetName: dispersalAssets.name,
  assetType: dispersalAssets.type,
};

async function loadRoomDetailByRoomId(roomId: number) {
  const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, roomId));
  if (!room) return null;
  const participants = await db
    .select().from(dispersalParticipants)
    .where(eq(dispersalParticipants.draftRoomId, roomId))
    .orderBy(dispersalParticipants.draftPosition, dispersalParticipants.joinedAt);
  const assets = await db
    .select().from(dispersalAssets)
    .where(eq(dispersalAssets.draftRoomId, roomId))
    .orderBy(dispersalAssets.createdAt);
  const picks = await db
    .select(enrichedPickSelect)
    .from(dispersalPicks)
    .innerJoin(dispersalParticipants, eq(dispersalPicks.participantId, dispersalParticipants.id))
    .innerJoin(dispersalAssets, eq(dispersalPicks.assetId, dispersalAssets.id))
    .where(eq(dispersalPicks.draftRoomId, roomId))
    .orderBy(dispersalPicks.pickNumber);

  let onTheClockParticipantId: number | null = null;
  if (room.status === "active") {
    onTheClockParticipantId = getOnTheClockId(participants, room.currentPickNumber + 1, room.draftFormat);
  }
  return {
    room,
    participants: participants.map((p) => ({ ...p, joinedAt: p.joinedAt.toISOString() })),
    assets: assets.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    picks: picks.map((p) => ({ ...p, pickedAt: p.pickedAt.toISOString() })),
    onTheClockParticipantId,
  };
}

export function registerDispersalDraftRoutes(app: Express): void {
  const router = Router();

  // ── Health ────────────────────────────────────────────────────────────────
  router.get("/healthz", (_req, res) => res.json({ status: "ok" }));

  // ── Rooms ───────────────────────────────────────────────────────────────────
  router.post("/draft-rooms", requireAuth, h(async (req, res) => {
    const { leagueName, numOrphanSlots, draftFormat, timeBankSeconds, commissionerName } = req.body ?? {};
    if (!leagueName || typeof leagueName !== "string") { res.status(400).json({ error: "leagueName required" }); return; }
    if (!Number.isInteger(numOrphanSlots) || numOrphanSlots < 1) { res.status(400).json({ error: "numOrphanSlots must be a positive integer" }); return; }
    if (!commissionerName || typeof commissionerName !== "string") { res.status(400).json({ error: "commissionerName required" }); return; }
    const format = ["snake", "linear", "3rr"].includes(draftFormat) ? draftFormat : "snake";

    let shareCode = generateShareCode(commissionerName);
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await db.select({ id: dispersalRooms.id }).from(dispersalRooms).where(eq(dispersalRooms.shareCode, shareCode));
      if (existing.length === 0) break;
      shareCode = generateShareCode(commissionerName);
    }

    const [room] = await db.insert(dispersalRooms).values({
      creatorUserId: (req as any).dcUserId ?? null,
      leagueName,
      shareCode,
      commissionerToken: generateToken(32),
      numOrphanSlots,
      draftFormat: format,
      timeBankSeconds: timeBankSeconds ?? null,
    }).returning();

    await db.insert(dispersalParticipants).values({
      draftRoomId: room.id,
      username: commissionerName,
      isCommissioner: true,
      draftPosition: null,
    });

    res.status(201).json(room);
  }));

  router.get("/draft-rooms/:code", h(async (req, res) => {
    const code = String(req.params.code ?? "").toUpperCase();
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.shareCode, code));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    const detail = await loadRoomDetailByRoomId(room.id);
    res.json(detail);
  }));

  router.patch("/draft-rooms/:id/share-code", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const newCode = req.body?.shareCode as string | undefined;
    if (!newCode || !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(newCode)) { res.status(400).json({ error: "Invalid share code format" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    if (room.status !== "setup") { res.status(400).json({ error: "Cannot change code after draft starts" }); return; }
    const [conflict] = await db.select({ id: dispersalRooms.id }).from(dispersalRooms).where(eq(dispersalRooms.shareCode, newCode));
    if (conflict && conflict.id !== id) { res.status(409).json({ error: "That code is already taken" }); return; }
    const [updated] = await db.update(dispersalRooms).set({ shareCode: newCode }).where(eq(dispersalRooms.id, id)).returning();
    res.json(updated);
  }));

  router.patch("/draft-rooms/:id/update", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }

    const u = req.body ?? {};
    const updateData: Partial<DispersalRoom> = {};
    if (u.leagueName !== undefined) updateData.leagueName = u.leagueName;
    if (u.numOrphanSlots !== undefined) updateData.numOrphanSlots = u.numOrphanSlots;
    if (u.draftFormat !== undefined) updateData.draftFormat = u.draftFormat;
    if ("timeBankSeconds" in u) updateData.timeBankSeconds = u.timeBankSeconds ?? null;
    if ("dailyPauseStart" in u) updateData.dailyPauseStart = u.dailyPauseStart ?? null;
    if ("dailyPauseEnd" in u) updateData.dailyPauseEnd = u.dailyPauseEnd ?? null;
    if ("pauseTimezone" in u) updateData.pauseTimezone = u.pauseTimezone ?? "America/New_York";
    if ("isLocked" in u) updateData.isLocked = u.isLocked ?? false;
    if ("sleeperLeagueId" in u) updateData.sleeperLeagueId = u.sleeperLeagueId ?? null;

    const [updated] = await db.update(dispersalRooms).set(updateData).where(eq(dispersalRooms.id, id)).returning();
    if (u.commissionerName) {
      await db.update(dispersalParticipants).set({ username: u.commissionerName })
        .where(sql`${dispersalParticipants.draftRoomId} = ${id} AND ${dispersalParticipants.isCommissioner} = true`);
    }
    res.json(updated);
  }));

  router.get("/draft-rooms/:id/summary", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    const assets = await db.select().from(dispersalAssets).where(eq(dispersalAssets.draftRoomId, id));
    const participants = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
    const picks = await db.select().from(dispersalPicks).where(eq(dispersalPicks.draftRoomId, id));

    const totalAssets = assets.length;
    const draftedAssets = assets.filter((a) => a.isDrafted).length;
    const roundMap = new Map<number, number>();
    for (const pick of picks) roundMap.set(pick.round, (roundMap.get(pick.round) ?? 0) + 1);
    const typeMap = new Map<string, { total: number; drafted: number }>();
    for (const a of assets) {
      if (!typeMap.has(a.type)) typeMap.set(a.type, { total: 0, drafted: 0 });
      const entry = typeMap.get(a.type)!;
      entry.total++;
      if (a.isDrafted) entry.drafted++;
    }
    res.json({
      totalAssets,
      draftedAssets,
      availableAssets: totalAssets - draftedAssets,
      totalParticipants: participants.filter((p) => !p.isCommissioner).length,
      picksPerRound: Array.from(roundMap.entries()).map(([round, picks]) => ({ round, picks })),
      assetsByType: Array.from(typeMap.entries()).map(([type, counts]) => ({ type, ...counts })),
    });
  }));

  router.get("/draft-rooms/:id/export", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    const picks = await db
      .select({
        pickNumber: dispersalPicks.pickNumber,
        round: dispersalPicks.round,
        participantUsername: dispersalParticipants.username,
        assetName: dispersalAssets.name,
        assetType: dispersalAssets.type,
        position: dispersalAssets.position,
        team: dispersalAssets.team,
        pickedAt: dispersalPicks.pickedAt,
      })
      .from(dispersalPicks)
      .innerJoin(dispersalParticipants, eq(dispersalPicks.participantId, dispersalParticipants.id))
      .innerJoin(dispersalAssets, eq(dispersalPicks.assetId, dispersalAssets.id))
      .where(eq(dispersalPicks.draftRoomId, id))
      .orderBy(dispersalPicks.pickNumber);
    const headers = ["Pick #", "Round", "Manager", "Asset Name", "Type", "Position", "Team", "Picked At"];
    const rows = picks.map((p) => [p.pickNumber, p.round, p.participantUsername, `"${p.assetName}"`, p.assetType, p.position ?? "", p.team ?? "", p.pickedAt.toISOString()]);
    res.setHeader("Content-Type", "text/plain");
    res.send([headers.join(","), ...rows.map((r) => r.join(","))].join("\n"));
  }));

  router.post("/draft-rooms/:id/delete", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    await db.delete(dispersalRooms).where(eq(dispersalRooms.id, id));
    res.status(204).send();
  }));

  // ── Participants ─────────────────────────────────────────────────────────────
  router.get("/draft-rooms/:id/participants", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const participants = await db.select().from(dispersalParticipants)
      .where(eq(dispersalParticipants.draftRoomId, id))
      .orderBy(dispersalParticipants.draftPosition, dispersalParticipants.joinedAt);
    res.json(participants.map((p) => ({ ...p, joinedAt: p.joinedAt.toISOString() })));
  }));

  router.post("/draft-rooms/:id/participants", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const username = req.body?.username as string | undefined;
    if (!username || typeof username !== "string") { res.status(400).json({ error: "username required" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (room.status !== "setup") { res.status(400).json({ error: "Cannot join after the draft has started" }); return; }
    if (room.isLocked) { res.status(403).json({ error: "This room is locked. The commissioner has closed it to new participants." }); return; }
    const existing = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
    if (existing.filter((p) => !p.isCommissioner).length >= room.numOrphanSlots) { res.status(400).json({ error: "All orphan slots are filled" }); return; }
    const [participant] = await db.insert(dispersalParticipants).values({
      draftRoomId: id, username, isCommissioner: false, draftPosition: null,
    }).returning();
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "participant_joined", roomCode: room.shareCode });
    await postSystemMessage(id, room.shareCode, `${username} joined the room.`);
    res.status(201).json({ ...participant, joinedAt: participant.joinedAt.toISOString() });
  }));

  router.post("/draft-rooms/:id/assign-teams", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid room id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    const allParticipants = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
    const managers = allParticipants.filter((p) => !p.isCommissioner);
    if (managers.length === 0) { res.status(400).json({ error: "No managers have joined" }); return; }
    const assets = await db.select().from(dispersalAssets).where(eq(dispersalAssets.draftRoomId, id));
    const teamNameSet = new Set<string>();
    for (const a of assets) {
      const m = a.notes?.match(/From:\s*(.+?)(?:\s*·|$)/);
      if (m?.[1]) teamNameSet.add(m[1].trim());
    }
    const teamNames = Array.from(teamNameSet);
    let idx = teamNames.length + 1;
    while (teamNames.length < managers.length) teamNames.push(`Team ${idx++}`);
    const shuffled = teamNames.slice(0, managers.length);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    for (let i = 0; i < managers.length; i++) {
      await db.update(dispersalParticipants).set({ orphanTeamName: shuffled[i] }).where(eq(dispersalParticipants.id, managers[i]!.id));
    }
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "teams_assigned", roomCode: room.shareCode });
    const updated = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
    res.json(updated.map((p) => ({ ...p, joinedAt: p.joinedAt.toISOString() })));
  }));

  router.patch("/draft-rooms/:id/participants/:participantId", h(async (req, res) => {
    const id = idParam(req.params.id);
    const participantId = idParam(req.params.participantId);
    if (isNaN(id) || isNaN(participantId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { draftPosition, orphanTeamName, sleeperAvatarId } = req.body ?? {};
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    if (draftPosition !== undefined && room.status !== "setup") { res.status(400).json({ error: "Cannot reassign participants after draft has started" }); return; }
    if (typeof draftPosition === "number") {
      const existing = await db.select().from(dispersalParticipants)
        .where(and(eq(dispersalParticipants.draftRoomId, id), eq(dispersalParticipants.draftPosition, draftPosition)));
      if (existing.length > 0 && existing[0]!.id !== participantId) { res.status(400).json({ error: "That draft slot is already taken" }); return; }
    }
    const updateData: { draftPosition?: number | null; orphanTeamName?: string | null; sleeperAvatarId?: string | null } = {};
    if (draftPosition !== undefined) updateData.draftPosition = draftPosition;
    if (orphanTeamName !== undefined) updateData.orphanTeamName = orphanTeamName;
    if (sleeperAvatarId !== undefined) updateData.sleeperAvatarId = sleeperAvatarId;
    const [updated] = await db.update(dispersalParticipants).set(updateData)
      .where(and(eq(dispersalParticipants.id, participantId), eq(dispersalParticipants.draftRoomId, id))).returning();
    if (!updated) { res.status(404).json({ error: "Participant not found" }); return; }
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "participant_assigned", roomCode: room.shareCode });
    res.json({ ...updated, joinedAt: updated.joinedAt.toISOString() });
  }));

  router.delete("/draft-rooms/:id/participants/:participantId", h(async (req, res) => {
    const id = idParam(req.params.id);
    const participantId = idParam(req.params.participantId);
    if (isNaN(id) || isNaN(participantId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    await db.delete(dispersalParticipants)
      .where(and(eq(dispersalParticipants.id, participantId), eq(dispersalParticipants.draftRoomId, id)));
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "participant_removed", roomCode: room.shareCode });
    res.sendStatus(204);
  }));

  // ── Assets ───────────────────────────────────────────────────────────────────
  router.get("/draft-rooms/:id/assets", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const assets = await db.select().from(dispersalAssets).where(eq(dispersalAssets.draftRoomId, id)).orderBy(dispersalAssets.createdAt);
    let filtered = assets;
    const typeQ = req.query.type as string | undefined;
    const draftedQ = req.query.drafted as string | undefined;
    if (typeQ) filtered = filtered.filter((a) => a.type === typeQ);
    if (draftedQ !== undefined) { const d = draftedQ === "true"; filtered = filtered.filter((a) => a.isDrafted === d); }
    res.json(filtered.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })));
  }));

  router.post("/draft-rooms/:id/assets", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { name, type, position, team, notes } = req.body ?? {};
    if (!name || !type) { res.status(400).json({ error: "name and type required" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    const [asset] = await db.insert(dispersalAssets).values({
      draftRoomId: id, name, type, position: position ?? null, team: team ?? null, notes: notes ?? null,
    }).returning();
    res.status(201).json({ ...asset, createdAt: asset.createdAt.toISOString() });
  }));

  router.patch("/draft-rooms/:id/assets/:assetId", h(async (req, res) => {
    const id = idParam(req.params.id);
    const assetId = idParam(req.params.assetId);
    if (isNaN(id) || isNaN(assetId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    const { name, type, position, team, notes } = req.body ?? {};
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (position !== undefined) updateData.position = position;
    if (team !== undefined) updateData.team = team;
    if (notes !== undefined) updateData.notes = notes;
    const [asset] = await db.update(dispersalAssets).set(updateData)
      .where(and(eq(dispersalAssets.id, assetId), eq(dispersalAssets.draftRoomId, id))).returning();
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }
    res.json({ ...asset, createdAt: asset.createdAt.toISOString() });
  }));

  router.delete("/draft-rooms/:id/assets/:assetId", h(async (req, res) => {
    const id = idParam(req.params.id);
    const assetId = idParam(req.params.assetId);
    if (isNaN(id) || isNaN(assetId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    await db.delete(dispersalAssets).where(and(eq(dispersalAssets.id, assetId), eq(dispersalAssets.draftRoomId, id)));
    res.sendStatus(204);
  }));

  router.delete("/draft-rooms/:id/assets", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid room id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    await db.delete(dispersalAssets).where(eq(dispersalAssets.draftRoomId, id));
    res.sendStatus(204);
  }));

  router.post("/draft-rooms/:id/assets/import-csv", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const csvContent = req.body?.csvContent as string | undefined;
    if (!csvContent || typeof csvContent !== "string") { res.status(400).json({ error: "csvContent required" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    const lines = csvContent.trim().split("\n");
    if (lines.length < 2) { res.status(400).json({ error: "CSV must have a header row and at least one data row" }); return; }
    const [headerLine, ...dataLines] = lines;
    const headers = headerLine.split(",").map((x) => x.trim().toLowerCase());
    const nameIdx = headers.indexOf("name");
    const typeIdx = headers.indexOf("type");
    const positionIdx = headers.indexOf("position");
    const teamIdx = headers.indexOf("team");
    const notesIdx = headers.indexOf("notes");
    if (nameIdx === -1 || typeIdx === -1) { res.status(400).json({ error: "CSV must have 'name' and 'type' columns" }); return; }
    const errors: string[] = [];
    let imported = 0;
    for (let i = 0; i < dataLines.length; i++) {
      const cols = dataLines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const name = cols[nameIdx];
      const type = cols[typeIdx];
      if (!name || !type) { errors.push(`Row ${i + 2}: Missing required name or type`); continue; }
      try {
        await db.insert(dispersalAssets).values({
          draftRoomId: id, name, type,
          position: positionIdx >= 0 ? cols[positionIdx] || null : null,
          team: teamIdx >= 0 ? cols[teamIdx] || null : null,
          notes: notesIdx >= 0 ? cols[notesIdx] || null : null,
        });
        imported++;
      } catch { errors.push(`Row ${i + 2}: Failed to insert`); }
    }
    res.json({ imported, errors });
  }));

  // ── Picks ────────────────────────────────────────────────────────────────────
  router.get("/draft-rooms/:id/picks", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const picks = await db.select(enrichedPickSelect).from(dispersalPicks)
      .innerJoin(dispersalParticipants, eq(dispersalPicks.participantId, dispersalParticipants.id))
      .innerJoin(dispersalAssets, eq(dispersalPicks.assetId, dispersalAssets.id))
      .where(eq(dispersalPicks.draftRoomId, id))
      .orderBy(dispersalPicks.pickNumber);
    res.json(picks.map((p) => ({ ...p, pickedAt: p.pickedAt.toISOString() })));
  }));

  router.post("/draft-rooms/:id/picks", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const participantId = Number(req.body?.participantId);
    const assetId = Number(req.body?.assetId);
    if (!participantId || !assetId) { res.status(400).json({ error: "participantId and assetId required" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (room.status !== "active") { res.status(400).json({ error: "Draft is not active" }); return; }
    const participants = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
    const nextPickNumber = room.currentPickNumber + 1;
    if (getOnTheClockId(participants, nextPickNumber, room.draftFormat) !== participantId) { res.status(403).json({ error: "It is not your turn to pick" }); return; }
    const [asset] = await db.select().from(dispersalAssets).where(eq(dispersalAssets.id, assetId));
    if (!asset || asset.draftRoomId !== id) { res.status(404).json({ error: "Asset not found in this draft room" }); return; }
    if (asset.isDrafted) { res.status(400).json({ error: "Asset has already been drafted" }); return; }
    const numManagers = participants.filter((p) => !p.isCommissioner && p.draftPosition !== null).length;
    const round = Math.ceil(nextPickNumber / numManagers);
    const [pick] = await db.insert(dispersalPicks).values({ draftRoomId: id, participantId, assetId, pickNumber: nextPickNumber, round }).returning();
    await db.update(dispersalAssets).set({ isDrafted: true, draftedByParticipantId: participantId }).where(eq(dispersalAssets.id, assetId));
    const remainingAssets = await db.select().from(dispersalAssets).where(eq(dispersalAssets.draftRoomId, id));
    const allDrafted = remainingAssets.every((a) => a.isDrafted || a.id === assetId);
    const newStatus = allDrafted ? "completed" : "active";
    if (room.timeBankSeconds && room.currentTurnStartedAt) {
      const elapsed = Math.round(computeEffectiveElapsedSeconds(room.currentTurnStartedAt.getTime(), Date.now(), room.dailyPauseStart, room.dailyPauseEnd, room.pauseTimezone));
      if (elapsed > 0) {
        const onClockP = participants.find((p) => p.id === participantId);
        if (onClockP?.timeBankRemainingSeconds != null) {
          await db.update(dispersalParticipants).set({ timeBankRemainingSeconds: Math.max(0, onClockP.timeBankRemainingSeconds - elapsed) }).where(eq(dispersalParticipants.id, participantId));
        }
      }
    }
    await db.update(dispersalRooms).set({
      currentPickNumber: nextPickNumber, currentRound: round, status: newStatus,
      currentTurnStartedAt: newStatus === "active" && room.timeBankSeconds ? new Date() : null,
    }).where(eq(dispersalRooms.id, id));
    const participant = participants.find((p) => p.id === participantId)!;
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "pick_made", roomCode: room.shareCode });
    const pickInRound = nextPickNumber - (round - 1) * numManagers;
    await postSystemMessage(id, room.shareCode, `Pick ${round}.${String(pickInRound).padStart(2, "0")} — ${participant.username} selected ${asset.name}.`);
    if (newStatus === "completed") await postSystemMessage(id, room.shareCode, "The dispersal draft is complete! 🎉 All assets have been claimed.");
    res.status(201).json({ ...pick, participantUsername: participant.username, assetName: asset.name, assetType: asset.type, pickedAt: pick.pickedAt.toISOString() });
  }));

  router.post("/draft-rooms/:id/picks/retract", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid room id" }); return; }
    const participantId = Number(req.body?.participantId);
    if (!participantId) { res.status(400).json({ error: "participantId required" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (room.status !== "active") { res.status(400).json({ error: "Draft is not active" }); return; }
    const [lastPick] = await db.select().from(dispersalPicks).where(eq(dispersalPicks.draftRoomId, id)).orderBy(desc(dispersalPicks.pickNumber)).limit(1);
    if (!lastPick) { res.status(400).json({ error: "No picks to retract" }); return; }
    if (lastPick.participantId !== participantId) { res.status(403).json({ error: "You can only change your pick before the next manager picks" }); return; }
    await db.delete(dispersalPicks).where(eq(dispersalPicks.id, lastPick.id));
    await db.update(dispersalAssets).set({ isDrafted: false, draftedByParticipantId: null }).where(eq(dispersalAssets.id, lastPick.assetId));
    const managers = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
    const numManagers = managers.filter((p) => !p.isCommissioner).length;
    const prevPickNumber = lastPick.pickNumber - 1;
    const prevRound = prevPickNumber > 0 ? Math.ceil(prevPickNumber / numManagers) : 1;
    await db.update(dispersalRooms).set({ currentPickNumber: prevPickNumber, currentRound: prevRound, currentTurnStartedAt: room.timeBankSeconds ? new Date() : null }).where(eq(dispersalRooms.id, id));
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "pick_retracted", roomCode: room.shareCode });
    res.json({ success: true });
  }));

  router.post("/draft-rooms/:id/picks/undo", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    const [lastPick] = await db.select().from(dispersalPicks).where(eq(dispersalPicks.draftRoomId, id)).orderBy(desc(dispersalPicks.pickNumber)).limit(1);
    if (!lastPick) { res.status(400).json({ error: "No picks to undo" }); return; }
    await db.delete(dispersalPicks).where(eq(dispersalPicks.id, lastPick.id));
    await db.update(dispersalAssets).set({ isDrafted: false, draftedByParticipantId: null }).where(eq(dispersalAssets.id, lastPick.assetId));
    const managers = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
    const numManagers = managers.filter((p) => !p.isCommissioner).length;
    const prevPickNumber = lastPick.pickNumber - 1;
    const prevRound = prevPickNumber > 0 ? Math.ceil(prevPickNumber / numManagers) : 1;
    await db.update(dispersalRooms).set({ currentPickNumber: prevPickNumber, currentRound: prevRound, status: "active", currentTurnStartedAt: room.timeBankSeconds ? new Date() : null }).where(eq(dispersalRooms.id, id));
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "pick_undone", roomCode: room.shareCode });
    const detail = await loadRoomDetailByRoomId(id);
    res.json(detail);
  }));

  router.post("/draft-rooms/:id/picks/manual", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const participantId = Number(req.body?.participantId);
    const assetId = Number(req.body?.assetId);
    if (!participantId || !assetId) { res.status(400).json({ error: "participantId and assetId required" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    if (room.status !== "active") { res.status(400).json({ error: "Draft is not active" }); return; }
    const [asset] = await db.select().from(dispersalAssets).where(eq(dispersalAssets.id, assetId));
    if (!asset || asset.draftRoomId !== id) { res.status(404).json({ error: "Asset not found" }); return; }
    if (asset.isDrafted) { res.status(400).json({ error: "Asset already drafted" }); return; }
    const [participant] = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.id, participantId));
    if (!participant || participant.draftRoomId !== id) { res.status(404).json({ error: "Participant not found" }); return; }
    const managers = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
    const numManagers = managers.filter((p) => !p.isCommissioner).length;
    const nextPickNumber = room.currentPickNumber + 1;
    const round = Math.ceil(nextPickNumber / numManagers);
    const [pick] = await db.insert(dispersalPicks).values({ draftRoomId: id, participantId, assetId, pickNumber: nextPickNumber, round }).returning();
    await db.update(dispersalAssets).set({ isDrafted: true, draftedByParticipantId: participantId }).where(eq(dispersalAssets.id, assetId));
    if (room.timeBankSeconds && room.currentTurnStartedAt) {
      const elapsed = Math.round(computeEffectiveElapsedSeconds(room.currentTurnStartedAt.getTime(), Date.now(), room.dailyPauseStart, room.dailyPauseEnd, room.pauseTimezone));
      if (elapsed > 0) {
        const onClockP = managers.find((p) => p.id === participantId);
        if (onClockP?.timeBankRemainingSeconds != null) {
          await db.update(dispersalParticipants).set({ timeBankRemainingSeconds: Math.max(0, onClockP.timeBankRemainingSeconds - elapsed) }).where(eq(dispersalParticipants.id, participantId));
        }
      }
    }
    await db.update(dispersalRooms).set({ currentPickNumber: nextPickNumber, currentRound: round, currentTurnStartedAt: room.timeBankSeconds ? new Date() : null }).where(eq(dispersalRooms.id, id));
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "pick_made", roomCode: room.shareCode });
    res.status(201).json({ ...pick, participantUsername: participant.username, assetName: asset.name, assetType: asset.type, pickedAt: pick.pickedAt.toISOString() });
  }));

  // ── Draft actions ────────────────────────────────────────────────────────────
  router.post("/draft-rooms/:id/start", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    if (room.status !== "setup") { res.status(400).json({ error: "Draft has already been started" }); return; }
    const participants = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id)).orderBy(dispersalParticipants.joinedAt);
    const managers = participants.filter((p) => !p.isCommissioner);
    if (managers.length < room.numOrphanSlots) { res.status(400).json({ error: `Not enough managers have joined (${managers.length}/${room.numOrphanSlots})` }); return; }
    const unassigned = managers.filter((m) => m.draftPosition === null);
    if (unassigned.length > 0) { res.status(400).json({ error: `${unassigned.length} manager(s) have not been assigned to a draft slot yet` }); return; }
    if (room.timeBankSeconds) {
      for (const manager of managers) {
        await db.update(dispersalParticipants).set({ timeBankRemainingSeconds: room.timeBankSeconds }).where(eq(dispersalParticipants.id, manager.id));
      }
    }
    const [updated] = await db.update(dispersalRooms).set({ status: "active", currentPickNumber: 0, currentRound: 1, currentTurnStartedAt: room.timeBankSeconds ? new Date() : null }).where(eq(dispersalRooms.id, id)).returning();
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "draft_started", roomCode: room.shareCode });
    await postSystemMessage(id, room.shareCode, "The dispersal draft has begun! 🏈");
    res.json(updated);
  }));

  router.post("/draft-rooms/:id/pause", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    if (room.timeBankSeconds && room.currentTurnStartedAt) {
      const participants = await db.select().from(dispersalParticipants).where(eq(dispersalParticipants.draftRoomId, id));
      const onTheClockId = getOnTheClockId(participants, room.currentPickNumber + 1, room.draftFormat);
      if (onTheClockId) {
        const elapsed = Math.round(computeEffectiveElapsedSeconds(room.currentTurnStartedAt.getTime(), Date.now(), room.dailyPauseStart, room.dailyPauseEnd, room.pauseTimezone));
        if (elapsed > 0) {
          const onClockP = participants.find((p) => p.id === onTheClockId);
          if (onClockP?.timeBankRemainingSeconds != null) {
            await db.update(dispersalParticipants).set({ timeBankRemainingSeconds: Math.max(0, onClockP.timeBankRemainingSeconds - elapsed) }).where(eq(dispersalParticipants.id, onTheClockId));
          }
        }
      }
    }
    const [updated] = await db.update(dispersalRooms).set({ status: "paused", currentTurnStartedAt: null }).where(eq(dispersalRooms.id, id)).returning();
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "draft_paused", roomCode: room.shareCode });
    await postSystemMessage(id, room.shareCode, "Draft paused by the commissioner.");
    res.json(updated);
  }));

  router.post("/draft-rooms/:id/resume", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Draft room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Invalid commissioner token" }); return; }
    const [updated] = await db.update(dispersalRooms).set({ status: "active", currentTurnStartedAt: room.timeBankSeconds ? new Date() : null }).where(eq(dispersalRooms.id, id)).returning();
    getIo()?.to(`room:${room.shareCode}`).emit("draft:update", { type: "draft_resumed", roomCode: room.shareCode });
    await postSystemMessage(id, room.shareCode, "Draft resumed. ⏱️");
    res.json(updated);
  }));

  // ── Chat ─────────────────────────────────────────────────────────────────────
  router.get("/draft-rooms/:id/chat", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const messages = await db.select().from(dispersalChatMessages).where(eq(dispersalChatMessages.roomId, id)).orderBy(dispersalChatMessages.createdAt).limit(300);
    res.json(messages.map(serializeChatMessage));
  }));

  router.post("/draft-rooms/:id/chat", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { participantId, message } = req.body ?? {};
    if (!message || typeof message !== "string") { res.status(400).json({ error: "message required" }); return; }
    const trimmed = message.trim().slice(0, MAX_MSG_LENGTH);
    if (!trimmed) { res.status(400).json({ error: "message empty" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    let senderName = "";
    let resolvedParticipantId: number | null = null;
    if (isCommissioner(req, room)) {
      const [commish] = await db.select().from(dispersalParticipants).where(and(eq(dispersalParticipants.draftRoomId, id), eq(dispersalParticipants.isCommissioner, true)));
      senderName = commish?.username ?? "Commissioner";
      resolvedParticipantId = commish?.id ?? null;
    } else if (participantId) {
      const lastSent = cooldowns.get(participantId) ?? 0;
      if (Date.now() - lastSent < 2500) { res.status(429).json({ error: "Slow down — wait a moment before sending another message" }); return; }
      cooldowns.set(participantId, Date.now());
      const [p] = await db.select().from(dispersalParticipants).where(and(eq(dispersalParticipants.id, participantId), eq(dispersalParticipants.draftRoomId, id)));
      if (!p || p.isCommissioner) { res.status(403).json({ error: "Not a valid participant" }); return; }
      senderName = p.username;
      resolvedParticipantId = p.id;
    } else {
      res.status(403).json({ error: "Must be a participant or commissioner to chat" });
      return;
    }
    const [msg] = await db.insert(dispersalChatMessages).values({ roomId: id, type: "user", participantId: resolvedParticipantId, senderName, message: trimmed, reactions: {} }).returning();
    if (msg) await broadcastChatMessage(msg, room.shareCode);
    res.status(201).json(msg ? serializeChatMessage(msg) : {});
  }));

  router.post("/draft-rooms/:id/chat/announce", h(async (req, res) => {
    const id = idParam(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const message = req.body?.message as string | undefined;
    if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [commish] = await db.select().from(dispersalParticipants).where(and(eq(dispersalParticipants.draftRoomId, id), eq(dispersalParticipants.isCommissioner, true)));
    const [msg] = await db.insert(dispersalChatMessages).values({ roomId: id, type: "announcement", participantId: commish?.id ?? null, senderName: commish?.username ?? "Commissioner", message: message.trim().slice(0, MAX_MSG_LENGTH), reactions: {} }).returning();
    if (msg) await broadcastChatMessage(msg, room.shareCode);
    res.status(201).json(msg ? serializeChatMessage(msg) : {});
  }));

  router.delete("/draft-rooms/:id/chat/:msgId", h(async (req, res) => {
    const id = idParam(req.params.id);
    const msgId = idParam(req.params.msgId);
    if (isNaN(id) || isNaN(msgId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [updated] = await db.update(dispersalChatMessages).set({ deletedAt: new Date() }).where(and(eq(dispersalChatMessages.id, msgId), eq(dispersalChatMessages.roomId, id))).returning();
    if (updated) getIo()?.to(`room:${room.shareCode}`).emit("chat:update", { id: msgId, deletedAt: updated.deletedAt?.toISOString() ?? null });
    res.json({ success: true });
  }));

  router.patch("/draft-rooms/:id/chat/:msgId/pin", h(async (req, res) => {
    const id = idParam(req.params.id);
    const msgId = idParam(req.params.msgId);
    if (isNaN(id) || isNaN(msgId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    if (!isCommissioner(req, room)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [updated] = await db.update(dispersalChatMessages).set({ pinned: !!req.body?.pinned }).where(and(eq(dispersalChatMessages.id, msgId), eq(dispersalChatMessages.roomId, id))).returning();
    if (updated) getIo()?.to(`room:${room.shareCode}`).emit("chat:update", { id: msgId, pinned: updated.pinned });
    res.json({ success: true });
  }));

  router.post("/draft-rooms/:id/chat/:msgId/react", h(async (req, res) => {
    const id = idParam(req.params.id);
    const msgId = idParam(req.params.msgId);
    if (isNaN(id) || isNaN(msgId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { participantId, emoji } = req.body ?? {};
    if (!emoji || !QUICK_REACTIONS.includes(emoji)) { res.status(400).json({ error: "Invalid reaction" }); return; }
    const [room] = await db.select().from(dispersalRooms).where(eq(dispersalRooms.id, id));
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    let reactorId: number | null = null;
    if (isCommissioner(req, room)) {
      const [c] = await db.select().from(dispersalParticipants).where(and(eq(dispersalParticipants.draftRoomId, id), eq(dispersalParticipants.isCommissioner, true)));
      reactorId = c?.id ?? null;
    } else if (participantId) {
      reactorId = participantId;
    }
    if (!reactorId) { res.status(403).json({ error: "Forbidden" }); return; }
    const [msg] = await db.select().from(dispersalChatMessages).where(and(eq(dispersalChatMessages.id, msgId), eq(dispersalChatMessages.roomId, id)));
    if (!msg) { res.status(404).json({ error: "Message not found" }); return; }
    const reactions = (msg.reactions ?? {}) as Record<string, number[]>;
    const current = reactions[emoji] ?? [];
    if (current.includes(reactorId)) {
      reactions[emoji] = current.filter((x) => x !== reactorId);
      if (reactions[emoji]!.length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...current, reactorId];
    }
    const [updated] = await db.update(dispersalChatMessages).set({ reactions }).where(eq(dispersalChatMessages.id, msgId)).returning();
    if (updated) getIo()?.to(`room:${room.shareCode}`).emit("chat:update", { id: msgId, reactions: updated.reactions ?? {} });
    res.json({ reactions: updated?.reactions ?? {} });
  }));

  // ── Players (Sleeper search proxy) ────────────────────────────────────────────
  router.get("/players/search", h(async (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (q.length < 2) { res.json([]); return; }
    try {
      const players = await getSleeperPlayers();
      const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K"]);
      const results: { id: string; name: string; position: string; team: string }[] = [];
      for (const [id, p] of Object.entries(players)) {
        if (!p.active) continue;
        if (!POSITIONS.has(p.position ?? "")) continue;
        const full = p.full_name ?? `${p.first_name} ${p.last_name}`;
        if (!full.toLowerCase().includes(q)) continue;
        results.push({ id, name: full, position: p.position ?? "", team: p.team ?? "" });
        if (results.length >= 12) break;
      }
      results.sort((a, b) => {
        const ai = a.name.toLowerCase().indexOf(q);
        const bi = b.name.toLowerCase().indexOf(q);
        return ai - bi || a.name.localeCompare(b.name);
      });
      res.json(results.slice(0, 10));
    } catch (err) {
      console.error("[dispersal-draft] player search failed:", err);
      res.status(500).json({ error: "Search unavailable" });
    }
  }));

  app.use("/api/dispersal", router);
}

// ── Sleeper player dictionary cache (for /players/search) ──────────────────────
interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  position?: string;
  team?: string;
  active?: boolean;
}
let playersCache: Record<string, SleeperPlayer> | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

async function getSleeperPlayers(): Promise<Record<string, SleeperPlayer>> {
  if (playersCache && Date.now() - cacheTime < CACHE_TTL_MS) return playersCache;
  const res = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!res.ok) throw new Error("Failed to fetch Sleeper players");
  playersCache = (await res.json()) as Record<string, SleeperPlayer>;
  cacheTime = Date.now();
  return playersCache;
}
