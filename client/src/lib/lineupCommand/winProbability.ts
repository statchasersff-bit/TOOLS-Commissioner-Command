// Win-probability model for head-to-head matchups.
// Lifted from the StatChasers Lineup Checker integration guide (§7). Models each
// team's weekly score as a Normal distribution and returns P(my score > opp score).

// Abramowitz & Stegun erf approximation — used by the normal CDF below.
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/**
 * Models each team's score as Normal(μ, σ). Returns an integer 1–99 (%).
 *
 * @param pointDifferential myTotal - oppTotal
 * @param myStd  per-team weekly scoring standard deviation (default 25)
 * @param oppStd opponent weekly scoring standard deviation (default 25)
 * @param rho    correlation between the two teams' scores (default 0 = uncorrelated)
 */
export function calculateWinProbability(
  pointDifferential: number,
  myStd = 25, oppStd = 25, rho = 0
): number {
  const mu = pointDifferential;
  // σ = √(σ₁² + σ₂² − 2ρσ₁σ₂);  ρ=0 ⇒ √(σ₁²+σ₂²)
  const sigma = Math.sqrt(myStd * myStd + oppStd * oppStd - 2 * rho * myStd * oppStd);
  const z = mu / (sigma || 1e-6);
  const phi = 0.5 * (1 + erf(z / Math.SQRT2));   // standard normal CDF
  return Math.max(1, Math.min(99, Math.round(Math.max(0, Math.min(1, phi)) * 100)));
}
