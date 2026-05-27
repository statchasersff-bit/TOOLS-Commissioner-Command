/**
 * Dependency-free unit tests for the Portfolio Timeline value math.
 * Run with: npx tsx server/portfolioValueService.test.ts
 *
 * Covers the deterministic, pure pieces (the bits most likely to silently
 * drift): value interpolation, the fallback ladder, confidence aggregation,
 * and proportional cost-basis allocation.
 */

import assert from "node:assert/strict";
import {
  interpolateValue,
  valueFromSeries,
  aggregateConfidence,
  allocateCostBasis,
  type ValuePoint,
} from "./portfolioValueService";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("interpolateValue");
test("midpoint between March 5000 and April 6000 ≈ 5452 on Mar 15", () => {
  const v = interpolateValue(5000, 6000, "2026-03-01", "2026-04-01", "2026-03-15");
  // (14/31)*1000 + 5000 ≈ 5451.6 → 5452
  assert.equal(v, 5452);
});
test("returns before value when dates collapse", () => {
  assert.equal(interpolateValue(5000, 6000, "2026-03-01", "2026-03-01", "2026-03-01"), 5000);
});

console.log("valueFromSeries (fallback ladder)");
const series: ValuePoint[] = [
  { date: "2026-02-01", value: 4000, pos: "WR" },
  { date: "2026-04-01", value: 5000, pos: "WR" },
];
test("exact match → exact", () => {
  const r = valueFromSeries(series, "2026-04-01");
  assert.equal(r.value, 5000);
  assert.equal(r.confidence, "exact");
});
test("between two snapshots → interpolated", () => {
  const r = valueFromSeries(series, "2026-03-01");
  assert.equal(r.confidence, "interpolated");
  assert.ok(r.value > 4000 && r.value < 5000);
});
test("just outside range but within window → nearest", () => {
  const r = valueFromSeries(series, "2026-04-20"); // 19d after last
  assert.equal(r.confidence, "nearest");
  assert.equal(r.value, 5000);
});
test("far outside window with no fallback → estimated (closest snapshot)", () => {
  const r = valueFromSeries(series, "2026-09-01");
  assert.equal(r.confidence, "estimated");
  assert.equal(r.value, 5000);
});
test("no series + fallbackCurrent → estimated uses current value", () => {
  const r = valueFromSeries(undefined, "2026-05-01", { fallbackCurrent: 3200 });
  assert.equal(r.confidence, "estimated");
  assert.equal(r.value, 3200);
});
test("no series + no fallback → replacement by position", () => {
  const r = valueFromSeries(undefined, "2026-05-01", { pos: "QB" });
  assert.equal(r.confidence, "replacement");
  assert.equal(r.value, 600); // REPLACEMENT_BY_POS.QB
});

console.log("aggregateConfidence");
test("all exact → high", () => {
  assert.equal(aggregateConfidence(["exact", "exact", "interpolated"]), "high");
});
test("mostly estimated → medium", () => {
  assert.equal(aggregateConfidence(["estimated", "estimated", "nearest"]), "medium");
});
test("mostly replacement → low", () => {
  assert.equal(aggregateConfidence(["replacement", "replacement", "estimated"]), "low");
});
test("empty → low", () => {
  assert.equal(aggregateConfidence([]), "low");
});

console.log("allocateCostBasis (proportional)");
test("splits sent value by received share", () => {
  // Sent 10,900; received London 7,200 + pick 4,800 (total 12,000).
  assert.equal(Math.round(allocateCostBasis(10900, 7200, 12000)), 6540);
  assert.equal(Math.round(allocateCostBasis(10900, 4800, 12000)), 4360);
});
test("allocations sum to value sent", () => {
  const a = allocateCostBasis(10900, 7200, 12000);
  const b = allocateCostBasis(10900, 4800, 12000);
  assert.ok(Math.abs(a + b - 10900) < 1e-6);
});
test("zero received total → 0 (no divide-by-zero)", () => {
  assert.equal(allocateCostBasis(5000, 100, 0), 0);
});

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}.`);
