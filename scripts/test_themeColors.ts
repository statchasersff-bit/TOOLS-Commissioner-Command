// Unit tests for the contrast + team-theme helpers. Run with:
//   npx tsx scripts/test_themeColors.ts

import assert from "node:assert/strict";
import {
  getLuminance, getContrastRatio, getReadableTextColor,
  mix, darken, lighten, alpha, hexToHslTuple, generateTeamTheme,
} from "../client/src/lib/themeColors";
import { NFL_TEAMS } from "../client/src/config/nflTeams";

function pass(name: string) { console.log(`  ✓ ${name}`); }
function group(name: string, fn: () => void) { console.log(name); fn(); }

group("luminance + contrast", () => {
  // Pure white luminance = 1, pure black = 0.
  assert.ok(Math.abs(getLuminance("#FFFFFF") - 1) < 0.001, "white luminance ~1");
  assert.ok(getLuminance("#000000") < 0.001, "black luminance ~0");
  assert.ok(getContrastRatio("#FFFFFF", "#000000") > 20, "white/black contrast > 20");
  assert.ok(getContrastRatio("#0B1220", "#F8FAFC") >= 15, "safe text colors are high contrast");
  pass("luminance + contrast ratios within WCAG expectations");
});

group("getReadableTextColor picks the right text per background", () => {
  // Yellow background → dark text.
  assert.equal(getReadableTextColor("#FFB612"), "#0B1220", "yellow bg → dark text");
  // Pure red → white text.
  assert.equal(getReadableTextColor("#A71930"), "#F8FAFC", "deep red bg → white text");
  // Pure black → white text.
  assert.equal(getReadableTextColor("#000000"), "#F8FAFC", "black bg → white text");
  // Pure white → dark text.
  assert.equal(getReadableTextColor("#FFFFFF"), "#0B1220", "white bg → dark text");
  pass("text colors flip correctly at WCAG threshold");
});

group("mix / darken / lighten round-trip sanity", () => {
  assert.equal(mix("#000000", "#FFFFFF", 0), "#000000");
  assert.equal(mix("#000000", "#FFFFFF", 1), "#ffffff");
  assert.equal(mix("#000000", "#FFFFFF", 0.5), "#808080");
  assert.equal(darken("#FFFFFF", 1), "#000000", "darken 100% → black");
  assert.equal(lighten("#000000", 1), "#ffffff", "lighten 100% → white");
  pass("color manipulation helpers behave");
});

group("alpha returns valid rgba()", () => {
  assert.equal(alpha("#FF0000", 0.5), "rgba(255, 0, 0, 0.5)");
  assert.equal(alpha("#0F2447", 0.18), "rgba(15, 36, 71, 0.18)");
  pass("alpha output is parsable CSS");
});

group("hexToHslTuple", () => {
  // Pure red.
  assert.equal(hexToHslTuple("#FF0000"), "0 100% 50%");
  // Pure black.
  assert.equal(hexToHslTuple("#000000"), "0 0% 0%");
  // Pure white.
  assert.equal(hexToHslTuple("#FFFFFF"), "0 0% 100%");
  pass("hex → HSL conversion matches CSS expectations");
});

group("generateTeamTheme produces contrast-safe button text for every team", () => {
  for (const team of NFL_TEAMS) {
    const t = generateTeamTheme(team);
    const buttonRatio = getContrastRatio(t["--button-primary-text"], t["--button-primary-bg"]);
    assert.ok(
      buttonRatio >= 4.5,
      `${team.abbreviation} button contrast ${buttonRatio.toFixed(2)} below 4.5 ` +
      `(bg=${t["--button-primary-bg"]} text=${t["--button-primary-text"]})`,
    );
    const textRatio = getContrastRatio(t["--text-primary"], t["--app-card"]);
    assert.ok(
      textRatio >= 4.5,
      `${team.abbreviation} body text contrast ${textRatio.toFixed(2)} below 4.5 ` +
      `(bg=${t["--app-card"]} text=${t["--text-primary"]})`,
    );
  }
  pass(`all ${NFL_TEAMS.length} teams produce WCAG AA-passing buttons + body text`);
});

group("yellow / bright teams specifically get dark button text", () => {
  const steelers = NFL_TEAMS.find((t) => t.abbreviation === "PIT")!;
  const tk = generateTeamTheme(steelers);
  assert.equal(tk["--button-primary-bg"], "#FFB612", "Steelers button bg is the team yellow");
  assert.equal(tk["--button-primary-text"], "#0B1220", "Steelers button text is dark");

  const falcons = NFL_TEAMS.find((t) => t.abbreviation === "ATL")!;
  const tf = generateTeamTheme(falcons);
  assert.equal(tf["--button-primary-bg"], "#A71930");
  assert.equal(tf["--button-primary-text"], "#F8FAFC", "Falcons deep-red button gets white text");
  pass("yellow → dark text, deep red → light text");
});

console.log("\nAll theme color tests passed.");
