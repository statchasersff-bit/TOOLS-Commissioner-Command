// Core buy/sell signal logic. Implementations follow the product spec verbatim.

import type { ValueSignal, SignalTone } from "./types";

export interface SignalResult {
  gap: number;
  gapPercent: number;
  signal: ValueSignal;
  tone: SignalTone;
}

export function getValueSignal({
  marketValue,
  comparisonValue,
}: {
  marketValue?: number;
  comparisonValue?: number;
}): SignalResult {
  if (!marketValue || !comparisonValue || marketValue <= 0) {
    return {
      gap: 0,
      gapPercent: 0,
      signal: "Insufficient Data" as const,
      tone: "neutral" as const,
    };
  }

  const gap = comparisonValue - marketValue;
  const gapPercent = (gap / marketValue) * 100;

  if (gapPercent >= 25) {
    return {
      gap,
      gapPercent,
      signal: "Strong Buy" as const,
      tone: "buyStrong" as const,
    };
  }

  if (gapPercent >= 10) {
    return {
      gap,
      gapPercent,
      signal: "Buy" as const,
      tone: "buy" as const,
    };
  }

  if (gapPercent <= -25) {
    return {
      gap,
      gapPercent,
      signal: "Strong Sell" as const,
      tone: "sellStrong" as const,
    };
  }

  if (gapPercent <= -10) {
    return {
      gap,
      gapPercent,
      signal: "Sell" as const,
      tone: "sell" as const,
    };
  }

  return {
    gap,
    gapPercent,
    signal: "Fair Value" as const,
    tone: "neutral" as const,
  };
}

export function getValueFinderScore(gapPercent?: number) {
  if (gapPercent == null) return 0;
  return Math.abs(gapPercent);
}

export function getBuyScore(gapPercent?: number) {
  if (gapPercent == null) return 0;
  return Math.max(0, gapPercent);
}

export function getSellScore(gapPercent?: number) {
  if (gapPercent == null) return 0;
  return Math.max(0, gapPercent * -1);
}
