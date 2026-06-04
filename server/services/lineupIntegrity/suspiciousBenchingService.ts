/**
 * Detect starters who had a clearly better, ELIGIBLE, AVAILABLE bench option.
 *
 * A "suspicious benching" requires a meaningful gap (or an unavailable starter
 * with an available replacement) so routine start/sit judgment calls don't trip
 * the flag. Eligibility matters: a benched QB only counts against a QB or
 * SUPER_FLEX slot, never a WR slot.
 */
import type { PlayerCheck, SuspiciousBenching, LineupIntegritySettings } from "./types";
import { isEligibleForStarterSlot } from "./optimalLineupService";

export function detectSuspiciousBenchings(input: {
  starterChecks: PlayerCheck[];
  benchChecks: PlayerCheck[];
  settings: LineupIntegritySettings;
}): SuspiciousBenching[] {
  const results: SuspiciousBenching[] = [];
  const usedBench = new Set<string>();

  for (const starter of input.starterChecks) {
    const eligibleBench = input.benchChecks
      .filter((b) => !usedBench.has(b.playerId))
      .filter((b) => isEligibleForStarterSlot(b.position, starter.lineupSlot))
      .filter((b) => !b.isInactive && !b.isIr && !b.isOnBye)
      .sort((a, b) => b.projection - a.projection);

    const bestBench = eligibleBench[0];
    if (!bestBench) continue;

    const projectionGap = round1(bestBench.projection - starter.projection);
    const valueGap = Math.round(bestBench.playerValue - starter.playerValue);

    const starterUnavailable = starter.isInactive || starter.isIr || starter.isOnBye;

    const suspicious =
      starterUnavailable ||
      projectionGap >= input.settings.suspiciousBenchingProjectionGap ||
      valueGap >= input.settings.suspiciousBenchingValueGap;

    if (suspicious) {
      usedBench.add(bestBench.playerId);

      // Annotate the starter check so the player-level row carries the signal.
      starter.betterBenchOption = true;
      starter.betterBenchPlayerId = bestBench.playerId;
      starter.betterBenchPlayerName = bestBench.playerName;
      starter.valueGapVsBench = valueGap;
      starter.projectionGapVsBench = projectionGap;
      if (!starter.flags.includes("suspicious_benching")) {
        starter.flags.push("suspicious_benching");
      }

      results.push({
        starterPlayerId: starter.playerId,
        starterName: starter.playerName,
        benchPlayerId: bestBench.playerId,
        benchName: bestBench.playerName,
        lineupSlot: starter.lineupSlot,
        projectionGap,
        valueGap,
        reason: starterUnavailable
          ? "Unavailable starter has an eligible, active bench replacement"
          : "Eligible bench player projects significantly better",
      });
    }
  }

  return results;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
