import { isPlayerLocked, type GameSchedule } from './gameLocking';

/**
 * Players that should never appear in waiver recommendations
 */
const WAIVER_BLOCKLIST = new Set([
  "Donnie Ernsberger",
  "Mark McNamee",
]);

export function getOwnedPlayerIds(allRosters: any[]): Set<string> {
  const owned = new Set<string>();
  for (const r of allRosters) {
    for (const id of (r.players || [])) if (id) owned.add(id);
    for (const id of (r.reserve || [])) if (id) owned.add(id);
    for (const id of (r.taxi || [])) if (id) owned.add(id);
    for (const id of (r.starters || [])) if (id) owned.add(id);
  }
  return owned;
}

function normalizePos(p?: string) {
  if (!p) return "";
  const up = p.toUpperCase();
  if (["DST","D/ST","DEF","D"].includes(up)) return "DEF";
  return up;
}

/**
 * From projections + players index, create a lightweight pool of FAs.
 */
export function buildFreeAgentPool(opts: {
  playersIndex: Record<string, any>;
  owned: Set<string>;
  projIdx: Record<string, any>;
  schedule?: GameSchedule;
  playedPlayerIds?: Record<string, boolean>;
}) {
  const { playersIndex, owned, projIdx, schedule, playedPlayerIds } = opts;
  const perPosCap = 125;

  const byPos: Record<
    string,
    { player_id: string; name: string; team?: string; pos: string; proj: number; opp?: string }[]
  > = {};

  for (const key in projIdx) {
    if (!/^\d+$/.test(key)) continue;
    const pid = key;
    if (owned.has(pid)) continue;
    const p = playersIndex[pid];
    if (!p) continue;
    const pos = normalizePos(p.position || p.fantasy_positions?.[0] || "");
    if (!pos) continue;
    const pr = projIdx[pid];
    if (!pr) continue;

    const playerName = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || String(pid);
    if (WAIVER_BLOCKLIST.has(playerName)) continue;
    if (schedule && isPlayerLocked({ team: p.team, player_id: pid, name: playerName }, schedule, Date.now(), playedPlayerIds)) continue;

    (byPos[pos] ||= []).push({
      player_id: pid,
      name: playerName,
      team: p.team,
      pos,
      proj: pr.proj,
      opp: pr.opp,
    });
  }

  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
    byPos[pos] = byPos[pos].slice(0, perPosCap);
  }
  return byPos;
}
