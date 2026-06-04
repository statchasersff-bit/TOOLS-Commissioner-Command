/**
 * generateTradeFlags — turn a scored trade into a set of neutral, professional
 * review flags for the commissioner.
 *
 * Tone matters: these flags inform a human decision, they do NOT accuse anyone.
 * We deliberately use "Frequent Trade Partners" not "Collusion", "Potentially
 * Lopsided" not "Bad Trade". Severity escalates with the underlying signal.
 */
import type {
  ParsedTradeAsset,
  Severity,
  TradeFlag,
  TradeReviewSettings,
  TradeScore,
} from "./types";
import { detectFuturePicks, detectFirstRoundPicks, detectPremiumFuturePicks } from "./helpers";

export interface FlagContext {
  currentSeason: number;
  repeatPartnerCount: number;
  /** Roster ids that look like orphan-risk teams (optional, MVP usually empty). */
  orphanRiskRosterIds?: number[];
  /** Roster ids that are top-3 contenders (optional). */
  topContenderRosterIds?: number[];
  /** Roster ids of rebuilding / last-place teams (optional). */
  rebuildingRosterIds?: number[];
  settings: TradeReviewSettings;
}

function lopsidedSeverity(pct: number): Severity | null {
  if (pct >= 40) return "critical";
  if (pct >= 25) return "high";
  if (pct >= 15) return "medium";
  if (pct >= 10) return "low";
  return null;
}

export function generateTradeFlags(
  assets: ParsedTradeAsset[],
  score: TradeScore,
  ctx: FlagContext,
): TradeFlag[] {
  const flags: TradeFlag[] = [];
  const pct = score.valueDiffPct;

  // Flag 1: Lopsided trade.
  const sev = lopsidedSeverity(pct);
  if (sev) {
    flags.push({
      flagType: "lopsided",
      severity: sev,
      title: "Potentially Lopsided Trade",
      description: `One side received approximately ${Math.round(pct)}% more value based on current trade values.`,
    });
  }

  // Flag 2: Future pick involved.
  const futurePicks = detectFuturePicks(assets, ctx.currentSeason);
  if (futurePicks.length > 0) {
    const seasons = Array.from(new Set(futurePicks.map((p) => p.pickSeason))).sort();
    const example = futurePicks[0];
    flags.push({
      flagType: "future_pick",
      severity: "info",
      title: "Future Pick Included",
      description:
        `This trade includes a future ${example.pickSeason} ${ordinalRound(example.pickRound)}` +
        (seasons.length > 1 ? ` (and other future picks)` : "") +
        (ctx.settings.requireFutureDuesForFuturePickTrades
          ? `. Verify that the manager has paid future dues if required by league rules.`
          : `.`),
    });
  }

  // Flag 3: Premium pick moved (any 1st-round pick).
  const firstRoundPicks = detectFirstRoundPicks(assets);
  if (firstRoundPicks.length > 0) {
    const futureFirsts = detectPremiumFuturePicks(assets, ctx.currentSeason);
    let severity: Severity = "medium";
    if (futureFirsts.length > 1) severity = "critical";
    else if (futureFirsts.length === 1) severity = "high";
    flags.push({
      flagType: "premium_pick",
      severity,
      title: "Premium Future Asset Moved",
      description:
        futureFirsts.length > 1
          ? `Multiple future 1st-round picks changed hands. These are the highest-leverage dynasty assets.`
          : futureFirsts.length === 1
            ? `A future 1st-round pick (${futureFirsts[0].pickSeason}) changed hands.`
            : `A current-year 1st-round pick changed hands.`,
    });
  }

  // Flag 4: Repeat trade partner.
  if (ctx.repeatPartnerCount >= ctx.settings.repeatPartnerThreshold) {
    flags.push({
      flagType: "repeat_partner",
      severity: ctx.repeatPartnerCount >= 5 ? "high" : "medium",
      title: "Frequent Trade Partners",
      description: `These managers have completed ${ctx.repeatPartnerCount} trades with each other this season. This does not prove anything on its own, but it may warrant review.`,
    });
  }

  // Flag 5: Orphan risk — a flagged team trades away significant future value.
  const orphanIds = new Set(ctx.orphanRiskRosterIds ?? []);
  if (orphanIds.size > 0) {
    const futureFirsts = detectPremiumFuturePicks(assets, ctx.currentSeason);
    const movesAwayFutureValue = futureFirsts.some(
      (p) => p.fromRosterId != null && orphanIds.has(p.fromRosterId),
    );
    if (movesAwayFutureValue) {
      flags.push({
        flagType: "orphan_risk",
        severity: "high",
        title: "Orphan Risk Increased",
        description: `This trade moves significant future value away from a team that may become harder to replace if the manager leaves.`,
      });
    }
  }

  // Flag 6: Playoff / league balance impact — a top contender is the big winner.
  const contenderIds = new Set(ctx.topContenderRosterIds ?? []);
  if (contenderIds.size > 0) {
    const receiver = topValueReceiver(score.totalValueByRoster);
    if (receiver != null && contenderIds.has(receiver) && pct >= 10) {
      flags.push({
        flagType: "league_balance",
        severity: pct >= 25 ? "medium" : "info",
        title: "League Balance Impact",
        description: `A top-3 team received a major value boost. This may materially affect the title race.`,
      });
    }
  }

  // Flag 7: Rebuilder direction mismatch — a rebuilding team buys win-now veterans
  // with future picks. Soft, informational flag.
  const rebuildIds = new Set(ctx.rebuildingRosterIds ?? []);
  if (rebuildIds.size > 0) {
    const futurePicksSentByRebuilder = futurePicks.some(
      (p) => p.fromRosterId != null && rebuildIds.has(p.fromRosterId),
    );
    if (futurePicksSentByRebuilder) {
      flags.push({
        flagType: "direction_mismatch",
        severity: "info",
        title: "Team Direction Mismatch",
        description: `A rebuilding team appears to be trading future assets for short-term production.`,
      });
    }
  }

  return flags;
}

function ordinalRound(round?: number): string {
  const r = Number(round);
  if (r === 1) return "1st";
  if (r === 2) return "2nd";
  if (r === 3) return "3rd";
  return `${r}th`;
}

function topValueReceiver(byRoster: Record<string, number>): number | null {
  let best: number | null = null;
  let bestVal = -Infinity;
  for (const [rid, val] of Object.entries(byRoster)) {
    if (val > bestVal) {
      bestVal = val;
      best = Number(rid);
    }
  }
  return best;
}
