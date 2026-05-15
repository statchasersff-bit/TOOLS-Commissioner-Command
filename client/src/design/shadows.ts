// Maps directly to --shadow-* CSS variables defined in index.css.
// Dark mode values are heavier (more opacity) — handled automatically by the CSS vars.

export const shadows = {
  "2xs": "var(--shadow-2xs)",
  xs: "var(--shadow-xs)",
  sm: "var(--shadow-sm)",
  DEFAULT: "var(--shadow)",
  md: "var(--shadow-md)",
  lg: "var(--shadow-lg)",
  xl: "var(--shadow-xl)",
  "2xl": "var(--shadow-2xl)",
  none: "none",
} as const;

// Semantic aliases
export const elevation = {
  card: shadows.sm,
  modal: shadows.xl,
  popover: shadows.lg,
  dropdown: shadows.md,
  tooltip: shadows.sm,
} as const;
