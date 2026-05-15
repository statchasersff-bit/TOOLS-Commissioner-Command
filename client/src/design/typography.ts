// Font families map to CSS vars set in index.css.
// Scale follows Tailwind's default type scale.

export const fontFamily = {
  sans: "var(--font-sans)",   // Inter — primary UI font
  serif: "var(--font-serif)", // Georgia — editorial / callout use
  mono: "var(--font-mono)",   // Menlo — code / data
} as const;

export const fontSize = {
  xs: "0.75rem",    // 12px — labels, badges, meta
  sm: "0.875rem",   // 14px — secondary text, table cells
  base: "1rem",     // 16px — body
  lg: "1.125rem",   // 18px — subheadings
  xl: "1.25rem",    // 20px — card titles
  "2xl": "1.5rem",  // 24px — section headings
  "3xl": "1.875rem",// 30px — page headings
  "4xl": "2.25rem", // 36px — hero / KPI numbers
} as const;

export const fontWeight = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const lineHeight = {
  tight: "1.25",
  snug: "1.375",
  normal: "1.5",
  relaxed: "1.625",
} as const;

export const letterSpacing = {
  tight: "-0.02em",
  normal: "var(--tracking-normal)", // 0em
  wide: "0.025em",
  wider: "0.05em",
  widest: "0.1em",  // ALL CAPS labels
} as const;

// Semantic text roles
export const textRole = {
  pageTitle: { size: fontSize["3xl"], weight: fontWeight.bold, tracking: letterSpacing.tight },
  sectionTitle: { size: fontSize["2xl"], weight: fontWeight.semibold, tracking: letterSpacing.tight },
  cardTitle: { size: fontSize.xl, weight: fontWeight.semibold },
  body: { size: fontSize.base, weight: fontWeight.normal, lineHeight: lineHeight.normal },
  bodySmall: { size: fontSize.sm, weight: fontWeight.normal },
  label: { size: fontSize.xs, weight: fontWeight.medium, tracking: letterSpacing.wider },
  kpi: { size: fontSize["4xl"], weight: fontWeight.bold, tracking: letterSpacing.tight },
} as const;
