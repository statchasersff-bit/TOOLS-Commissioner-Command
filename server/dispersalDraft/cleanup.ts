/**
 * Retention cleanup for dispersal draft rooms — deletes rooms (and cascaded
 * participants/assets/picks/chat) older than RETENTION_DAYS. Runs on boot and
 * once per day.
 */
import { lt } from "drizzle-orm";
import { db } from "../db";
import { dispersalRooms } from "@shared/schema";

const RETENTION_DAYS = 21;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(dispersalRooms)
    .where(lt(dispersalRooms.createdAt, cutoff))
    .returning({ id: dispersalRooms.id });
  if (deleted.length > 0) {
    console.log(`[dispersal-draft] auto-deleted ${deleted.length} expired room(s) older than ${cutoff.toISOString()}`);
  }
}

export function scheduleDispersalCleanup(): void {
  runCleanup().catch((err) => console.error("[dispersal-draft] initial cleanup failed:", err));
  setInterval(() => {
    runCleanup().catch((err) => console.error("[dispersal-draft] scheduled cleanup failed:", err));
  }, INTERVAL_MS);
}
