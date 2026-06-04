/**
 * Lineup integrity score (0–100, higher = cleaner) and its display label.
 * Pure functions — no I/O.
 */
import type { IntegrityLabel } from "./types";

export function scoreLineupIntegrity(input: {
  emptyStarterSlots: number;
  byeStarters: number;
  inactiveStarters: number;
  irStarters: number;
  doubtfulStarters: number;
  suspiciousBenchings: number;
  optimalityGap: number;
}): number {
  let score = 100;

  score -= input.emptyStarterSlots * 35;
  score -= input.byeStarters * 25;
  score -= input.inactiveStarters * 30;
  score -= input.irStarters * 35;
  score -= input.doubtfulStarters * 10;
  score -= input.suspiciousBenchings * 15;

  if (input.optimalityGap >= 12) score -= 10;
  if (input.optimalityGap >= 25) score -= 20;
  if (input.optimalityGap >= 40) score -= 35;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function getLineupIntegrityLabel(score: number): IntegrityLabel {
  if (score >= 90) return "clean";
  if (score >= 75) return "minor_issue";
  if (score >= 50) return "needs_review";
  if (score >= 25) return "serious_issue";
  return "critical";
}

/** Human-facing label text. */
export function integrityLabelDisplay(label: IntegrityLabel): string {
  switch (label) {
    case "clean": return "Clean";
    case "minor_issue": return "Minor Issue";
    case "needs_review": return "Needs Review";
    case "serious_issue": return "Serious Issue";
    case "critical": return "Critical";
  }
}
