// Base unit: 0.25rem (4px) — matches Tailwind's default spacing scale.
// Use these constants when spacing values are needed in JS/TS logic.
// In JSX, prefer Tailwind spacing classes (p-4, gap-2, etc.).

export const spacing = {
  0: "0px",
  px: "1px",
  0.5: "0.125rem",  // 2px
  1: "0.25rem",     // 4px
  1.5: "0.375rem",  // 6px
  2: "0.5rem",      // 8px
  2.5: "0.625rem",  // 10px
  3: "0.75rem",     // 12px
  3.5: "0.875rem",  // 14px
  4: "1rem",        // 16px
  5: "1.25rem",     // 20px
  6: "1.5rem",      // 24px
  8: "2rem",        // 32px
  10: "2.5rem",     // 40px
  12: "3rem",       // 48px
  16: "4rem",       // 64px
  20: "5rem",       // 80px
  24: "6rem",       // 96px
} as const;

// Named semantic aliases
export const layout = {
  pagePadding: spacing[6],        // outer page padding
  sectionGap: spacing[8],         // gap between major sections
  cardPadding: spacing[5],        // inside a card
  cardGap: spacing[4],            // gap between cards in a grid
  inlineGap: spacing[2],          // gap between inline elements (icon + label)
  inputPadding: `${spacing[2]} ${spacing[3]}`,
} as const;
