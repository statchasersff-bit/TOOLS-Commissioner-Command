// Position-aware age curve scoring. Implementations follow the product spec verbatim.

import type { ValueFinderPlayer } from "./types";

export function getAgeCurveScore(player: ValueFinderPlayer) {
  const age = player.age;
  const pos = player.position;

  if (!age) return 0.5;

  // RB: punished earliest. 21-23 premium, 24-25 prime, 26-27 short-term, 28+ risk.
  if (pos === "RB") {
    if (age <= 23) return 1.0;
    if (age <= 25) return 0.85;
    if (age <= 27) return 0.5;
    return 0.2;
  }

  // WR: holds longer than RB. 21-23 youth, 24-27 prime, 28-30 vet discount, 31+ risk.
  if (pos === "WR") {
    if (age <= 23) return 0.9;
    if (age <= 27) return 1.0;
    if (age <= 30) return 0.65;
    return 0.35;
  }

  // TE: develops late, lasts long. 21-24 dev, 25-29 prime, 30-32 vet, 33+ risk.
  if (pos === "TE") {
    if (age <= 24) return 0.7;
    if (age <= 29) return 1.0;
    if (age <= 32) return 0.7;
    return 0.35;
  }

  // QB: stays strong longest. 22-26 upside, 27-33 prime, 34-37 vet, 38+ risk.
  if (pos === "QB") {
    if (age <= 26) return 0.85;
    if (age <= 33) return 1.0;
    if (age <= 37) return 0.65;
    return 0.3;
  }

  return 0.5;
}

// Contender age adjustment — does not punish productive veterans harshly.
// QB 26-36 strong, RB 24-27 useful (28+ reduced not zero), WR 25-30 strong, TE 25-31 strong.
export function getContenderAgeScore(player: ValueFinderPlayer) {
  const age = player.age;
  const pos = player.position;

  if (!age) return 0.6;

  if (pos === "RB") {
    if (age <= 23) return 0.85;
    if (age <= 27) return 1.0;
    if (age <= 29) return 0.7;
    return 0.45;
  }

  if (pos === "WR") {
    if (age <= 24) return 0.85;
    if (age <= 30) return 1.0;
    if (age <= 32) return 0.7;
    return 0.45;
  }

  if (pos === "TE") {
    if (age <= 24) return 0.8;
    if (age <= 31) return 1.0;
    if (age <= 33) return 0.7;
    return 0.45;
  }

  if (pos === "QB") {
    if (age <= 25) return 0.85;
    if (age <= 36) return 1.0;
    if (age <= 38) return 0.7;
    return 0.45;
  }

  return 0.6;
}
