// Longevity-aware recommendation engine.
//
// Turns the per-purpose values (dynasty / contender / rebuilder / production /
// usage) plus the raw sub-scores into a human-readable recommendation:
//   - Buy Signals  (why you'd want him)
//   - Risk Signals (what could go wrong)
//   - Best Fit     (which roster archetype he helps)
//   - Final Label  (the single headline recommendation)
//
// The Final Label is decided by an explicit, ordered first-match rule list so
// the output is deterministic and easy to reason about.

import type { ValueFinderPlayer, ValueLabel, BestFit } from "./types";
import { getAgeCurveScore } from "./ageCurveUtils";

export interface Classification {
  buySignals: string[];
  riskSignals: string[];
  bestFit: BestFit;
  finalLabel: ValueLabel;
}

const BUY = 10; // gap% threshold for "underpriced"
const SELL = -10; // gap% threshold for "overpriced"

/** Percent gap of a comparison value vs market value (positive = underpriced). */
function gapPct(market?: number, value?: number): number {
  if (!market || market <= 0 || value == null) return 0;
  return ((value - market) / market) * 100;
}

export function classify(p: ValueFinderPlayer): Classification {
  const market = p.marketValue;
  if (!market || market <= 0 || p.dynastyValue == null) {
    return {
      buySignals: [],
      riskSignals: [],
      bestFit: "Team-Fit Dependent",
      finalLabel: "Insufficient Data",
    };
  }

  // Per-purpose gaps.
  const dynGap = gapPct(market, p.dynastyValue);
  const conGap = gapPct(market, p.contenderValue);
  const rebGap = gapPct(market, p.rebuilderValue);
  const prodGap = gapPct(market, p.productionValue);
  const usgGap = gapPct(market, p.usageValue);

  // Raw inputs.
  const prod = p.productionScore ?? 0;
  const usage = p.usageScore ?? 0;
  const longevity = p.longevityScore ?? 0;
  const ageCurve = getAgeCurveScore(p);
  const roleTrend = p.roleTrend ?? p.usageTrend ?? 0;
  const usageTrend = p.usageTrend ?? 0;
  const marketTrend = p.marketValueChange30d ?? p.marketValueChange90d ?? 0;
  const startRate = p.startRate ?? 0;

  // Age cliff: deep into the position's decline band (RB ~26+, WR 31+, QB 38+).
  const ageRisk = ageCurve <= 0.5;
  const ageDiscount = !ageRisk && ageCurve <= 0.65;
  const young = ageCurve >= 0.85;
  // Producing well above what his role would predict — fragile / TD-dependent.
  const overperforming = prod - usage >= 0.25;
  // Market climbing while role isn't — value running ahead of substance.
  const hyped = marketTrend > 3 && usageTrend <= 0;

  // ── Signals ──────────────────────────────────────────────────────────────
  const buySignals: string[] = [];
  if (prod >= 0.7) buySignals.push("Strong production");
  if (usage >= 0.7) buySignals.push("Strong usage / role");
  if (startRate >= 80) buySignals.push("High start rate");
  if (dynGap >= BUY || conGap >= BUY || rebGap >= BUY)
    buySignals.push("Priced below value");
  if (roleTrend > 1) buySignals.push("Rising role");
  if (longevity >= 0.7) buySignals.push("Strong longevity");
  if (young && (usageTrend > 0 || prod >= 0.5))
    buySignals.push("Young & ascending");

  const riskSignals: string[] = [];
  if (ageRisk) riskSignals.push("Age-cliff risk");
  else if (ageDiscount) riskSignals.push("Age discount");
  if (p.position === "RB" && (p.age ?? 0) >= 26)
    riskSignals.push("Short shelf life");
  if (roleTrend < -1) riskSignals.push("Declining role");
  if (overperforming) riskSignals.push("Production over-performer");
  if (hyped) riskSignals.push("Hype (market ahead of role)");
  if (rebGap <= SELL) riskSignals.push("Low rebuild appeal");
  if (usage > 0 && usage < 0.35) riskSignals.push("Thin usage");

  // ── Best Fit ───────────────────────────────────────────────────────────
  const bestFit: BestFit =
    conGap >= BUY && rebGap >= BUY
      ? "Universal"
      : conGap >= BUY && rebGap < BUY
        ? "Win-Now"
        : rebGap >= BUY && conGap < BUY
          ? "Rebuild"
          : conGap <= SELL && rebGap <= SELL
            ? "Avoid"
            : "Team-Fit Dependent";

  // ── Final Label (ordered first-match) ────────────────────────────────────
  const isBuy = dynGap >= BUY || conGap >= BUY || rebGap >= BUY;
  const isSell =
    dynGap <= SELL || (conGap <= SELL && rebGap <= SELL);

  let finalLabel: ValueLabel;

  if (isBuy && dynGap > -25) {
    // Buy tree — most specific first.
    if (conGap >= BUY && rebGap >= BUY) {
      finalLabel = "Universal Buy";
    } else if (ageRisk && conGap >= BUY) {
      // Productive but aging & cheap — useful now, not a long-term hold.
      finalLabel = "Win-Now Rental";
    } else if (rebGap >= BUY && rebGap > conGap) {
      if (prod < 0.5 && (roleTrend > 0 || usageTrend > 0))
        finalLabel = "Hidden Riser"; // role rising before production
      else if (young && usage < 0.5)
        finalLabel = "Future Stash"; // young, role not yet earned
      else finalLabel = "Rebuilder Buy";
    } else if (conGap >= BUY) {
      finalLabel = "Contender Buy";
    } else if (prodGap >= BUY && usage >= 0.5) {
      finalLabel = "Production Discount";
    } else if (usgGap >= BUY) {
      finalLabel = "Usage Buy"; // role outruns price before production catches up
    } else {
      finalLabel = rebGap >= conGap ? "Rebuilder Buy" : "Contender Buy";
    }
  } else if (isSell) {
    // Sell tree — most specific first.
    if (conGap <= SELL && rebGap <= SELL && dynGap <= -25) {
      finalLabel = "Universal Sell";
    } else if (ageRisk) {
      finalLabel = "Age Cliff Risk";
    } else if (hyped) {
      finalLabel = "Hype Sell";
    } else if (overperforming) {
      finalLabel = "Production Overperformer";
    } else if (usage < 0.3 && prod < 0.4) {
      finalLabel = "Roster Clogger";
    } else if (usage > 0 && usage < 0.4) {
      finalLabel = "Weak Usage Sell";
    } else if (rebGap <= SELL && conGap > SELL) {
      finalLabel = "Rebuild Sell"; // fine for win-now, bad long-term hold
    } else if (conGap <= SELL && rebGap > SELL) {
      finalLabel = "Contender Sell"; // fine long-term, overpriced for win-now
    } else {
      // Overpriced on the dynasty lens but neutral on win-now / rebuild — a soft,
      // generic sell rather than a "universal" one (which needs both lenses red).
      finalLabel = "Contender Sell";
    }
  } else {
    // Neutral tree.
    if (bestFit === "Team-Fit Dependent" && (Math.abs(conGap) >= 5 || Math.abs(rebGap) >= 5))
      finalLabel = "Team-Fit Dependent";
    else if (roleTrend > 0 || usageTrend > 0 || young) finalLabel = "Watchlist";
    else finalLabel = "Fair Value";
  }

  return { buySignals, riskSignals, bestFit, finalLabel };
}
