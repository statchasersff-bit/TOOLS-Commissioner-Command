import { interchangeable, canFillSlot, isFlexSlot } from './slotRules';

export type LineupDiff = {
  ins: { player_id: string; name: string; pos: string; proj: number }[];
  outs: { player_id: string; name: string; pos: string; proj: number }[];
  moves: { slot: string; in_pid: string; in_name: string; out_pid?: string; out_name?: string; gain: number; fromIR?: boolean }[];
  delta: number;
  enrichedMoves?: EnrichedRecommendation[];
};

/**
 * Enhanced recommendation format per user specification.
 */
export type EnrichedRecommendation = {
  title: string;
  slot: string;
  netDelta: number;
  inPlayer: { player_id: string; name: string; pos: string; proj: number };
  displaced: { name: string; pos: string } | null;
  isFillingEmpty: boolean;
  cascadeMoves: Array<{ player_id: string; name: string; from: string; to: string }>;
  source: 'FA' | 'BENCH' | 'IR';
  fromIR?: boolean;
  respectsLocks?: boolean;
};

export interface LeagueSummary {
  roster_positions: string[];
  starters: string[];
  optimalSlots: Array<{ slot: string; player: any }>;
  autoSubConfig?: any;
  [key: string]: any;
}

export function buildLineupDiff(lg: LeagueSummary, allEligible?: any[], irList?: string[]): LineupDiff {
  const fixedSlots = lg.roster_positions;

  const currentStarters: (string | null)[] = lg.starters.map(pid =>
    (pid && pid !== "0") ? pid : null
  );

  const curIds = currentStarters.filter((x): x is string => x !== null);
  const curSet = new Set(curIds);

  const optPlayers = lg.optimalSlots.map(s => s.player).filter(Boolean) as any[];
  const optIds = optPlayers.map(p => p.player_id);
  const optSet = new Set(optIds);

  const ins = optPlayers
    .filter(p => !curSet.has(p.player_id))
    .map(p => ({ player_id: p.player_id, name: p.name, pos: p.pos, proj: p.proj ?? 0 }));

  const outs = curIds
    .filter(pid => !optSet.has(pid))
    .map(pid => {
      const hit = optPlayers.find(p => p.player_id === pid) || allEligible?.find(p => p.player_id === pid);
      return { player_id: pid, name: hit?.name ?? `player_id ${pid}`, pos: hit?.pos ?? "", proj: hit?.proj ?? 0 };
    });

  const moves: LineupDiff["moves"] = [];
  const usedIn = new Set<string>();
  const usedOut = new Set<string>();

  const starterObjs = (lg as any).starterObjs || [];

  lg.optimalSlots.forEach((s, i) => {
    const inP = s.player;
    const slot = s.slot;
    if (!inP) return;

    const curPidAtSlot = currentStarters[i];
    const same = curPidAtSlot === inP.player_id;

    if (!same && !usedIn.has(inP.player_id)) {
      const currentIsOptimalSomewhere = curPidAtSlot && optSet.has(curPidAtSlot);
      const inPlayerIsCurrentlyStarting = curSet.has(inP.player_id);
      const outPlayerIsCurrentlyStarting = curPidAtSlot && curSet.has(curPidAtSlot);

      if (inPlayerIsCurrentlyStarting && outPlayerIsCurrentlyStarting) return;

      let outName: string | undefined;
      let outProj = 0;
      let actualOutPid: string | undefined;

      if (curPidAtSlot) {
        const outPlayer = optPlayers.find(p => p.player_id === curPidAtSlot)
          || allEligible?.find(p => p.player_id === curPidAtSlot)
          || starterObjs.find((p: any) => p.player_id === curPidAtSlot);

        outName = outPlayer?.name ?? `player_id ${curPidAtSlot}`;
        outProj = outPlayer?.proj ?? 0;
        actualOutPid = curPidAtSlot;
      }

      const gain = (inP.proj ?? 0) - outProj;
      const fromIR = irList ? irList.includes(inP.player_id) : false;

      moves.push({ slot, in_pid: inP.player_id, in_name: inP.name, out_pid: actualOutPid, out_name: outName, gain, fromIR });
      usedIn.add(inP.player_id);
      if (curPidAtSlot && !currentIsOptimalSomewhere) usedOut.add(curPidAtSlot);
    }
  });

  // Generate enriched recommendations
  const enrichedMoves: EnrichedRecommendation[] = [];

  const allBenchedPlayers = curIds
    .filter(pid => !optSet.has(pid))
    .map(pid => {
      const player = starterObjs.find((p: any) => p.player_id === pid)
        || optPlayers.find(p => p.player_id === pid)
        || allEligible?.find(p => p.player_id === pid);
      return player ? { player_id: pid, name: player.name, pos: player.pos, proj: player.proj ?? 0 } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const consumedBenchIds = new Set<string>();

  const allCascadeMoves: { player_id: string; name: string; from: string; to: string }[] = [];
  currentStarters.forEach((curPid, idx) => {
    if (curPid && optSet.has(curPid)) {
      const optIdx = optIds.indexOf(curPid);
      if (optIdx !== -1 && optIdx !== idx) {
        const player = optPlayers.find(p => p.player_id === curPid);
        if (player) {
          allCascadeMoves.push({
            player_id: curPid,
            name: player.name,
            from: fixedSlots[idx] || 'unknown',
            to: fixedSlots[optIdx] || 'unknown'
          });
        }
      }
    }
  });

  const newPlayerIds = optIds.filter(pid => !curSet.has(pid));
  const sortedNewPlayers = newPlayerIds
    .map(pid => ({ pid, proj: optPlayers.find(x => x.player_id === pid)?.proj ?? 0 }))
    .sort((a, b) => b.proj - a.proj)
    .map(x => x.pid);

  for (const inPid of sortedNewPlayers) {
    const inPlayer = optPlayers.find(p => p.player_id === inPid);
    if (!inPlayer) continue;

    const slotIdx = optIds.indexOf(inPid);
    const slot = fixedSlots[slotIdx];
    if (!slot) continue;

    const currentSlotPlayerId = currentStarters[slotIdx];
    const slotIsTrulyEmpty = !currentSlotPlayerId;

    let displaced: { name: string; pos: string } | null = null;
    let displacedId: string | null = null;

    if (!slotIsTrulyEmpty) {
      const availableBenched = allBenchedPlayers.filter(p => !consumedBenchIds.has(p.player_id));

      if (availableBenched.length > 0) {
        const inPos = inPlayer.pos?.toUpperCase() || '';
        const slotUpper = slot.toUpperCase();

        let chosenPlayer = availableBenched.find(p => p.pos?.toUpperCase() === inPos);

        if (!chosenPlayer) {
          chosenPlayer = availableBenched.find(p => {
            const pPos = p.pos?.toUpperCase() || '';
            if (slotUpper === 'FLEX') return ['RB', 'WR', 'TE'].includes(pPos);
            if (['SUPER_FLEX', 'SUPERFLEX'].includes(slotUpper)) return ['QB', 'RB', 'WR', 'TE'].includes(pPos);
            return pPos === slotUpper;
          });
        }

        if (!chosenPlayer) {
          chosenPlayer = [...availableBenched].sort((a, b) => a.proj - b.proj)[0];
        }

        if (chosenPlayer) {
          displaced = { name: chosenPlayer.name, pos: chosenPlayer.pos };
          displacedId = chosenPlayer.player_id;
          consumedBenchIds.add(displacedId);
        }
      }
    }

    const isFromIR = irList ? irList.includes(inPid) : false;
    const isFA = allEligible?.find(p => p.player_id === inPid)?.isFA || false;
    const source: 'FA' | 'BENCH' | 'IR' = isFromIR ? 'IR' : (isFA ? 'FA' : 'BENCH');

    const outProj = displaced && allBenchedPlayers.find(p => p.player_id === displacedId)?.proj || 0;
    const netDelta = (inPlayer.proj ?? 0) - outProj;

    enrichedMoves.push({
      title: `Start ${inPlayer.name}`,
      slot,
      netDelta,
      inPlayer: { player_id: inPlayer.player_id, name: inPlayer.name, pos: inPlayer.pos, proj: inPlayer.proj ?? 0 },
      displaced,
      isFillingEmpty: slotIsTrulyEmpty,
      cascadeMoves: allCascadeMoves,
      source,
      fromIR: isFromIR,
      respectsLocks: false
    });
  }

  const delta = ins.reduce((s, p) => s + p.proj, 0) - outs.reduce((s, p) => s + p.proj, 0);

  return { ins, outs, moves, delta, enrichedMoves };
}
