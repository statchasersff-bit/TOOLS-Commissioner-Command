/**
 * Chat helpers for the dispersal draft — insert/broadcast/serialize chat rows.
 */
import { db } from "../db";
import { dispersalChatMessages, type DispersalChatMessage } from "@shared/schema";
import { getIo } from "./socket";

function serialize(msg: DispersalChatMessage) {
  return {
    ...msg,
    createdAt: msg.createdAt.toISOString(),
    deletedAt: msg.deletedAt ? msg.deletedAt.toISOString() : null,
    reactions: msg.reactions ?? {},
  };
}

export async function postSystemMessage(roomId: number, shareCode: string, message: string) {
  const [msg] = await db
    .insert(dispersalChatMessages)
    .values({ roomId, type: "system", senderName: "System", message, reactions: {} })
    .returning();
  if (!msg) return;
  getIo()?.to(`room:${shareCode}`).emit("chat:message", serialize(msg));
  return msg;
}

export async function broadcastChatMessage(msg: DispersalChatMessage, shareCode: string) {
  getIo()?.to(`room:${shareCode}`).emit("chat:message", serialize(msg));
}

export function serializeChatMessage(msg: DispersalChatMessage) {
  return serialize(msg);
}
