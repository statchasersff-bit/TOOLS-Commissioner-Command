/**
 * Player availability — normalize Sleeper player metadata into the booleans the
 * lineup checker needs (IR / OUT / doubtful / inactive / on-bye).
 *
 * Sleeper metadata can be imperfect or delayed, so the UI must caveat that
 * availability data may lag official team reports. Bye detection is skipped
 * entirely when we have no verified bye data for the season (see nflByeWeeks).
 */
import { getByeWeeks } from "./nflByeWeeks";

export interface SleeperPlayerMeta {
  player_id?: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  team?: string | null;
  injury_status?: string | null;
  status?: string | null;
  fantasy_positions?: string[] | null;
}

export interface PlayerAvailability {
  injuryStatus: string | null;
  activeStatus: string | null;
  team: string | null;
  isIr: boolean;
  isOut: boolean;
  isDoubtful: boolean;
  isInactive: boolean;
  isOnBye: boolean;
}

export function getPlayerAvailability(input: {
  playerId: string;
  player: SleeperPlayerMeta | undefined;
  season: string | number;
  nflWeek: number;
}): PlayerAvailability {
  const player = input.player;
  const injuryStatus = player?.injury_status ?? null;
  const activeStatus = player?.status ?? null;
  const team = player?.team ?? null;

  const isIr =
    activeStatus === "Injured Reserve" ||
    activeStatus === "IR" ||
    injuryStatus === "IR";

  const isOut =
    injuryStatus === "Out" ||
    injuryStatus === "O" ||
    injuryStatus === "OUT";

  const isDoubtful =
    injuryStatus === "Doubtful" ||
    injuryStatus === "D";

  const isInactive =
    isOut ||
    isIr ||
    activeStatus === "Inactive" ||
    activeStatus === "Reserve" ||
    activeStatus === "Non Football Injury" ||
    activeStatus === "Practice Squad";

  // Bye detection only fires when we have verified schedule data — otherwise we
  // must NOT guess (avoid false "started a bye player" alerts).
  const byeMap = getByeWeeks(input.season);
  const isOnBye = !!(byeMap && team && byeMap[team] === input.nflWeek);

  return {
    injuryStatus,
    activeStatus,
    team,
    isIr,
    isOut,
    isDoubtful,
    isInactive,
    isOnBye,
  };
}
