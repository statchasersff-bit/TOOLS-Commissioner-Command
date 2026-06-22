import { useCallback } from "react";

const STORAGE_KEY = "sc_recent_rooms";
const MAX_ROOMS = 8;

export interface RecentRoom {
  shareCode: string;
  leagueName: string;
  role: "commissioner" | "manager";
  lastVisited: number;
}

function readRooms(): RecentRoom[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as RecentRoom[];
  } catch {
    return [];
  }
}

function writeRooms(rooms: RecentRoom[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

export function useRecentRooms() {
  const saveRoom = useCallback((room: Omit<RecentRoom, "lastVisited">) => {
    const existing = readRooms().filter(r => r.shareCode !== room.shareCode);
    const updated: RecentRoom[] = [
      { ...room, lastVisited: Date.now() },
      ...existing,
    ].slice(0, MAX_ROOMS);
    writeRooms(updated);
  }, []);

  const getRecentRooms = useCallback((): RecentRoom[] => {
    return readRooms().sort((a, b) => b.lastVisited - a.lastVisited);
  }, []);

  const removeRoom = useCallback((shareCode: string) => {
    writeRooms(readRooms().filter(r => r.shareCode !== shareCode));
  }, []);

  return { saveRoom, getRecentRooms, removeRoom };
}
