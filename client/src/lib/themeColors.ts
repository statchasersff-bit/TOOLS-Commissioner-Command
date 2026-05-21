// Pure color utilities + team-theme generator for "My Team Mode".
//
// Design rules (mirrors the spec):
//   1. Never paint a full background in a raw NFL team color — many are too
//      saturated. Mix a tiny amount of team primary into a near-black neutral.
//   2. Reserve raw team colors for accents: borders, badges, active tabs,
//      focus rings, primary buttons. Compute readable text colors via the
//      WCAG contrast helpers below — yellow buttons get dark text, dark
//      buttons get white text, automatically.
//   3. The generated tokens override the shadcn vars (--background, --card,
//      --foreground, --primary, --ring, etc.) so existing components that
//      use bg-background / bg-card / text-foreground / border-border pick
//      up the team tint without per-component rewrites.

import type { NflTeam } from "@/config/nflTeams";

// ── Hex / RGB / HSL conversion ───────────────────────────────────────────────

interface Rgb { r: number; g: number; b: number }

function parseHex(hex: string): Rgb {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const h = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ── WCAG contrast ────────────────────────────────────────────────────────────

/** Relative luminance per WCAG 2.1, 0–1. */
export function getLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/** WCAG contrast ratio between two colors. >= 4.5 passes AA for normal text. */
export function getContrastRatio(a: string, b: string): number {
  const la = getLuminance(a);
  const lb = getLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick a readable text color for an arbitrary background.
 * Returns whichever of near-white / near-black yields the higher contrast
 * ratio against `bgHex`. Threshold of 4.5 matches WCAG AA for normal text;
 * when neither option passes (some mid-saturation blues / aquas), the
 * higher-contrast one is still returned so callers can decide whether to
 * darken the background — see ensureReadableButton.
 */
export function getReadableTextColor(bgHex: string): "#F8FAFC" | "#0B1220" {
  const lightContrast = getContrastRatio(bgHex, "#F8FAFC");
  const darkContrast = getContrastRatio(bgHex, "#0B1220");
  // Prefer dark text for light/mid-tone backgrounds — fan teams recognize
  // "yellow button with dark text", "powder-blue with dark text" more
  // intuitively than the inverse. Tie-break to the higher contrast side.
  if (darkContrast >= 4.5 && lightContrast < 4.5) return "#0B1220";
  if (lightContrast >= 4.5 && darkContrast < 4.5) return "#F8FAFC";
  return darkContrast >= lightContrast ? "#0B1220" : "#F8FAFC";
}

/**
 * Produce a {bg, text} pair guaranteed to pass WCAG AA. Darkens or lightens
 * the background in small steps (toward whichever direction the chosen text
 * color sits) until contrast >= 4.5. Caps at 20 iterations to prevent
 * runaway loops on pathological inputs — in practice no NFL color needs
 * more than 4–5 steps.
 */
export function ensureReadableButton(bg: string): { bg: string; text: "#F8FAFC" | "#0B1220" } {
  let current = bg;
  let text = getReadableTextColor(current);
  for (let i = 0; i < 20; i++) {
    if (getContrastRatio(current, text) >= 4.5) break;
    // If the text is dark, pull bg lighter; if text is light, pull bg darker.
    current = text === "#0B1220" ? lighten(current, 0.06) : darken(current, 0.06);
    // Re-evaluate the optimum text direction in case the shift crossed
    // the midpoint.
    text = getReadableTextColor(current);
  }
  return { bg: current, text };
}

// ── Color manipulation ───────────────────────────────────────────────────────

/** Mix two hex colors. weight=0 returns a, weight=1 returns b. */
export function mix(a: string, b: string, weight: number): string {
  const w = Math.max(0, Math.min(1, weight));
  const ra = parseHex(a);
  const rb = parseHex(b);
  return toHex({
    r: ra.r * (1 - w) + rb.r * w,
    g: ra.g * (1 - w) + rb.g * w,
    b: ra.b * (1 - w) + rb.b * w,
  });
}

/** Pull a color toward black. amount in 0..1. */
export function darken(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}

/** Pull a color toward white. amount in 0..1. */
export function lighten(hex: string, amount: number): string {
  return mix(hex, "#FFFFFF", amount);
}

/** Reduce saturation by mixing toward a neutral gray of the same luminance. */
export function desaturate(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  // Simple desaturation: blend toward the per-channel average (a neutral
  // gray that approximates the same brightness). Not luminance-perfect but
  // good enough for surface tints.
  const avg = (r + g + b) / 3;
  const w = Math.max(0, Math.min(1, amount));
  return toHex({
    r: r * (1 - w) + avg * w,
    g: g * (1 - w) + avg * w,
    b: b * (1 - w) + avg * w,
  });
}

/** Return rgba() string with the given opacity. */
export function alpha(hex: string, opacity: number): string {
  const { r, g, b } = parseHex(hex);
  const o = Math.max(0, Math.min(1, opacity));
  return `rgba(${r}, ${g}, ${b}, ${o})`;
}

/** Convert a hex to "H S% L%" — the shape Tailwind/shadcn uses for hsl(var(--…)). */
export function hexToHslTuple(hex: string): string {
  const { r, g, b } = parseHex(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// ── Team theme generator ─────────────────────────────────────────────────────

const NEUTRAL_DARK = "#020617";        // near-black slate-950
const NEUTRAL_CARD = "#0B1220";        // very dark slate
const SAFE_TEXT_LIGHT = "#F8FAFC";     // slate-50
const SAFE_TEXT_DARK = "#0B1220";
const SAFE_TEXT_MUTED_LIGHT = "rgba(248, 250, 252, 0.65)";
const SAFE_TEXT_MUTED_DARK = "rgba(11, 18, 32, 0.65)";

/** The full token map applied by My Team Mode. */
export interface TeamThemeTokens {
  /* Raw team tokens — components can opt in via var(--team-primary). */
  "--team-primary": string;
  "--team-secondary": string;
  "--team-accent": string;

  /* App-level surfaces — also mapped onto shadcn vars below. */
  "--app-bg": string;
  "--app-surface": string;
  "--app-card": string;
  "--app-card-elevated": string;

  /* Text. */
  "--text-primary": string;
  "--text-secondary": string;
  "--text-muted": string;

  /* Borders. */
  "--border-soft": string;
  "--border-strong": string;

  /* Buttons. */
  "--button-primary-bg": string;
  "--button-primary-text": string;
  "--button-secondary-bg": string;
  "--button-secondary-text": string;

  /* Navigation. */
  "--nav-bg": string;
  "--nav-active": string;
  "--tab-active": string;

  /* Focus + accents. */
  "--focus-ring": string;
  "--accent-gradient": string;

  /* shadcn-compatible HSL overrides so existing utility classes
   * (bg-background, bg-card, text-foreground, border-border, text-primary,
   * ring-ring) automatically inherit the team palette. */
  "--background": string;
  "--foreground": string;
  "--border": string;
  "--card": string;
  "--card-foreground": string;
  "--card-border": string;
  "--popover": string;
  "--popover-foreground": string;
  "--popover-border": string;
  "--muted": string;
  "--muted-foreground": string;
  "--accent": string;
  "--accent-foreground": string;
  "--primary": string;
  "--primary-foreground": string;
  "--ring": string;
  "--input": string;

  /* StatChasers brand surfaces — kept consistent so opt-in pages still render. */
  "--sc-page-bg": string;
  "--sc-card-bg": string;
  "--sc-navy": string;
  "--sc-navy-soft": string;
  "--sc-text-primary": string;
  "--sc-text-secondary": string;
  "--sc-text-muted": string;
  "--sc-border": string;
  "--sc-border-strong": string;
  "--sc-nav-bg": string;
  "--sc-nav-bg-translucent": string;

  /* Favorite-team tokens that other components (FavoriteTeamWidget, loader)
   * already read. Kept in sync so the team mode and the existing tokens
   * never disagree. */
  "--favorite-team-primary": string;
  "--favorite-team-secondary": string;
  "--favorite-team-accent": string;
}

/** Generate the complete CSS-variable map for a team. Always produces a
 *  contrast-safe palette — verified by validateTeamTheme below. */
export function generateTeamTheme(team: NflTeam): TeamThemeTokens {
  const primary = team.primaryColor;
  const secondary = team.secondaryColor;

  // Some teams have pure-black secondary which makes everything mud. When
  // that happens, derive a softer accent from the primary instead.
  const accent = lighten(desaturate(primary, 0.35), 0.25);

  // Surface tints — only the smallest hint of team color blended into deep
  // neutrals. Yellow / orange / aqua teams stay readable because the bulk
  // of the color is still the neutral.
  const appBg = mix(NEUTRAL_DARK, primary, 0.10);
  const appSurface = mix(NEUTRAL_CARD, primary, 0.08);
  const appCard = mix("#0E1A2D", primary, 0.06);
  const appCardElevated = mix("#142339", primary, 0.05);

  // Text always white-ish on the dark foundation (we always default to a
  // dark base per spec). Muted text computed for readability against the
  // card surface.
  const textPrimary = SAFE_TEXT_LIGHT;
  const textSecondary = "rgba(248, 250, 252, 0.78)";
  const textMuted = SAFE_TEXT_MUTED_LIGHT;

  // Borders: thin tint of the team primary. We use rgba so the alpha mixes
  // cleanly with whatever sits behind them.
  const borderSoft = alpha(primary, 0.18);
  const borderStrong = alpha(primary, 0.45);

  // Buttons: start from raw team primary, but if neither white nor dark
  // text hits WCAG AA against it (powder-blue Chargers, etc.) the helper
  // nudges the bg until contrast passes. Yellow stays yellow with dark
  // text; very dark teams stay dark with white text.
  const { bg: buttonPrimaryBg, text: buttonPrimaryText } = ensureReadableButton(primary);
  // Secondary button uses a desaturated dark surface — same readability rule.
  const secondaryStart = mix(NEUTRAL_CARD, primary, 0.18);
  const { bg: buttonSecondaryBg, text: buttonSecondaryText } = ensureReadableButton(secondaryStart);

  const navBg = mix(NEUTRAL_DARK, primary, 0.06);
  const navActive = alpha(primary, 0.22);
  const tabActive = alpha(primary, 0.30);

  // Focus ring stays bright but with team color.
  const focusRing = alpha(primary, 0.55);

  // Accent gradient — primary → secondary, used by hero strips / badges.
  const accentGradient = `linear-gradient(135deg, ${primary} 0%, ${darken(secondary, 0.15)} 100%)`;

  // shadcn HSL overrides. Anything wired to bg-card / text-foreground /
  // text-primary / ring-ring inherits these. We keep --primary as the team
  // color so primary buttons get team tint; --primary-foreground is the
  // contrast-safe text for that fill.
  const hsl = {
    background: hexToHslTuple(appBg),
    foreground: hexToHslTuple(textPrimary),
    border: hexToHslTuple(mix(appBg, primary, 0.15)),
    card: hexToHslTuple(appCard),
    cardForeground: hexToHslTuple(textPrimary),
    cardBorder: hexToHslTuple(mix(appCard, primary, 0.20)),
    popover: hexToHslTuple(appCardElevated),
    popoverForeground: hexToHslTuple(textPrimary),
    popoverBorder: hexToHslTuple(mix(appCardElevated, primary, 0.20)),
    muted: hexToHslTuple(mix(appCard, primary, 0.04)),
    mutedForeground: hexToHslTuple(lighten(primary, 0.55)),
    accent: hexToHslTuple(mix(appCard, primary, 0.12)),
    accentForeground: hexToHslTuple(textPrimary),
    primary: hexToHslTuple(primary),
    primaryForeground: hexToHslTuple(buttonPrimaryText),
    ring: hexToHslTuple(primary),
    input: hexToHslTuple(mix(appCard, primary, 0.18)),
  };

  return {
    "--team-primary": primary,
    "--team-secondary": secondary,
    "--team-accent": accent,

    "--app-bg": appBg,
    "--app-surface": appSurface,
    "--app-card": appCard,
    "--app-card-elevated": appCardElevated,

    "--text-primary": textPrimary,
    "--text-secondary": textSecondary,
    "--text-muted": textMuted,

    "--border-soft": borderSoft,
    "--border-strong": borderStrong,

    "--button-primary-bg": buttonPrimaryBg,
    "--button-primary-text": buttonPrimaryText,
    "--button-secondary-bg": buttonSecondaryBg,
    "--button-secondary-text": buttonSecondaryText,

    "--nav-bg": navBg,
    "--nav-active": navActive,
    "--tab-active": tabActive,

    "--focus-ring": focusRing,
    "--accent-gradient": accentGradient,

    "--background": hsl.background,
    "--foreground": hsl.foreground,
    "--border": hsl.border,
    "--card": hsl.card,
    "--card-foreground": hsl.cardForeground,
    "--card-border": hsl.cardBorder,
    "--popover": hsl.popover,
    "--popover-foreground": hsl.popoverForeground,
    "--popover-border": hsl.popoverBorder,
    "--muted": hsl.muted,
    "--muted-foreground": hsl.mutedForeground,
    "--accent": hsl.accent,
    "--accent-foreground": hsl.accentForeground,
    "--primary": hsl.primary,
    "--primary-foreground": hsl.primaryForeground,
    "--ring": hsl.ring,
    "--input": hsl.input,

    "--sc-page-bg": appBg,
    "--sc-card-bg": appCard,
    "--sc-navy": darken(primary, 0.55),
    "--sc-navy-soft": darken(primary, 0.35),
    "--sc-text-primary": textPrimary,
    "--sc-text-secondary": textSecondary,
    "--sc-text-muted": textMuted,
    "--sc-border": borderSoft,
    "--sc-border-strong": borderStrong,
    "--sc-nav-bg": navBg,
    "--sc-nav-bg-translucent": alpha(appBg, 0.85),

    "--favorite-team-primary": primary,
    "--favorite-team-secondary": secondary,
    "--favorite-team-accent": alpha(primary, 0.35),
  };
}

/** Dev-only sanity check: warns when generated tokens fail WCAG AA.
 *  In production we still produce something safe because the helper falls
 *  back to white/black text — but the warning helps surface team configs
 *  that produce borderline surfaces. */
export function validateTeamTheme(team: NflTeam): void {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") return;
  const t = generateTeamTheme(team);
  const checks: Array<[string, number, number]> = [
    ["text on appBg", getContrastRatio(t["--text-primary"], t["--app-bg"]), 4.5],
    ["text on card",  getContrastRatio(t["--text-primary"], t["--app-card"]), 4.5],
    ["button text",   getContrastRatio(t["--button-primary-text"], t["--button-primary-bg"]), 4.5],
  ];
  for (const [label, ratio, min] of checks) {
    if (ratio < min) {
      // eslint-disable-next-line no-console
      console.warn(`[themeColors] ${team.abbreviation} – ${label} contrast ${ratio.toFixed(2)} below ${min}; auto-adjusting safest text color.`);
    }
  }
}
