/**
 * Tanking RISK score (0–100, higher = more concerning) + label.
 *
 * This is a SIGNAL, never a verdict. The UI must say "Potential Tanking Signal",
 * never "tanking confirmed". Combines lineup-issue severity with team context
 * (eliminated, owns own first, playoff-impact matchup, repeat issues, activity).
 *
 * Also exposes the draft-pick-incentive helper (ownsOwnFutureFirst) and a
 * simple playoff-race helper.
 */
import type { TankingRiskLabel } from "./types";

export interface SleeperTradedPickLite {
  season: string | number;
  round: number | string;
  roster_id: number | string;
  owner_id: number | string;
  previous_owner_id?: number | string;
}

export function calculateTankingRisk(input: {
  lineupIntegrityScore: number;
  suspiciousBenchings: number;
  optimalityGap: number;
  repeatIssueCount: number;
  emptyStarterSlots: number;
  inactiveStarters: number;
  isEliminated: boolean;
  ownsOwnFirst: boolean;
  playoffImpactMatchup: boolean;
  recentActivityScore?: number;
}): number {
  let risk = 0;

  if (input.lineupIntegrityScore < 75) risk += 10;
  if (input.lineupIntegrityScore < 50) risk += 20;
  if (input.lineupIntegrityScore < 25) risk += 35;

  risk += input.suspiciousBenchings * 15;

  if (input.optimalityGap >= 12) risk += 10;
  if (input.optimalityGap >= 25) risk += 20;
  if (input.optimalityGap >= 40) risk += 35;

  if (input.repeatIssueCount >= 2) risk += 20;
  if (input.repeatIssueCount >= 3) risk += 35;

  if (input.emptyStarterSlots > 0) risk += 20;
  if (input.inactiveStarters > 0) risk += 20;

  if (input.isEliminated) risk += 10;
  if (input.ownsOwnFirst) risk += 15;
  if (input.isEliminated && input.ownsOwnFirst) risk += 15;

  if (input.playoffImpactMatchup) risk += 10;

  if (input.recentActivityScore != null && input.recentActivityScore < 30) {
    risk += 10;
  }

  return Math.max(0, Math.min(100, Math.round(risk)));
}

export function getTankingRiskLabel(score: number): TankingRiskLabel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function tankingRiskLabelDisplay(label: TankingRiskLabel): string {
  switch (label) {
    case "critical": return "Critical";
    case "high": return "High";
    case "medium": return "Medium";
    case "low": return "Low";
  }
}

/**
 * Does this roster still own its own NEXT-season first-round rookie pick?
 * If there's no traded-pick record for (nextSeason, round 1, original roster),
 * the pick was never moved → still owned. Otherwise it's owned only if the
 * current owner_id is still this roster.
 */
export function ownsOwnFutureFirst(input: {
  rosterId: number;
  season: string;
  tradedPicks: SleeperTradedPickLite[];
}): boolean {
  const nextSeason = String(Number(input.season) + 1);

  const record = (input.tradedPicks ?? []).find((pick) => {
    return (
      String(pick.season) === nextSeason &&
      Number(pick.round) === 1 &&
      Number(pick.roster_id) === input.rosterId
    );
  });

  if (!record) return true;
  return Number(record.owner_id) === input.rosterId;
}

/** Approximate "in or near the playoff race": rank within (playoffTeams + 2). */
export function isInPlayoffRace(rank: number, playoffTeams: number): boolean {
  return rank > 0 && rank <= playoffTeams + 2;
}
