import { isPlayerLocked, type GameSchedule } from './gameLocking';
import { canFillSlot, type Slot } from './slotRules';
import type { Projection } from './projections';

const EXCLUDE_FA_STATUSES = new Set(["O", "IR", "NA"]);
const MAX_FA_PER_POS = 10;

const WAIVER_BLOCKLIST = new Set([
  "Donnie Ernsberger",
  "Mark McNamee",
]);

export interface FACandidate {
  player_id: string;
  name: string;
  team?: string;
  pos: string;
  proj: number;
  eligible: Slot[];
  isFA: boolean;
  opp?: string;
  injury_status?: string;
}

export async function buildFACandidates(
  ownedPlayerIds: Set<string>,
  allPlayers: Record<string, any>,
  projMap: Record<string, Projection>,
  leagueScoring: any,
  schedule?: GameSchedule,
  playedPlayerIds?: Record<string, boolean>
): Promise<FACandidate[]> {
  const buckets: Record<string, FACandidate[]> = {
    QB: [], RB: [], WR: [], TE: [], K: [], DEF: [],
  };

  for (const key in projMap) {
    if (!/^\d+$/.test(key)) continue;
    const pid = key;
    if (ownedPlayerIds.has(pid)) continue;

    const p = allPlayers[pid];
    if (!p) continue;

    const proj = projMap[pid];
    if (!proj) continue;

    const playerName = p.full_name || p.first_name + " " + p.last_name || "";
    if (WAIVER_BLOCKLIST.has(playerName.trim())) continue;

    const pos = p.position;
    if (!buckets[pos]) continue;
    if (pos === "K") continue;

    if (proj.opp === "BYE") continue;
    const status = (p.injury_status || "").toUpperCase();
    if (EXCLUDE_FA_STATUSES.has(status)) continue;

    if (schedule && isPlayerLocked({ team: p.team, player_id: pid, name: playerName }, schedule, Date.now(), playedPlayerIds)) {
      continue;
    }

    const adjProj = proj.proj ?? 0;
    if (!(adjProj > 0)) continue;

    const eligible: Slot[] = (["QB", "RB", "WR", "TE", "K", "DEF", "FLEX", "SUPER_FLEX"] as Slot[])
      .filter((s) => canFillSlot(pos, s));

    buckets[pos].push({
      player_id: pid,
      name: p.full_name,
      team: p.team,
      pos,
      proj: adjProj,
      eligible,
      isFA: true,
      opp: proj.opp,
      injury_status: p.injury_status,
    });
  }

  const shortlist: FACandidate[] = [];
  for (const pos of Object.keys(buckets)) {
    const sorted = buckets[pos].sort((a, b) => {
      if (a.proj !== b.proj) return b.proj - a.proj;
      return a.player_id.localeCompare(b.player_id);
    });
    shortlist.push(...sorted.slice(0, MAX_FA_PER_POS));
  }
  return shortlist;
}
