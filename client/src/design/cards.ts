// Tailwind class strings for card variants.
// Use cx() or clsx() to compose with additional classes.

export const card = {
  // Base — all cards start here
  base: "rounded-lg border border-card-border bg-card text-card-foreground shadow-sm",

  // Variants
  default: "rounded-lg border border-card-border bg-card text-card-foreground shadow-sm",
  elevated: "rounded-lg border border-card-border bg-card text-card-foreground shadow-md",
  ghost: "rounded-lg border border-transparent bg-transparent",
  gold: "rounded-lg border border-[hsl(var(--ring)/0.35)] bg-card text-card-foreground shadow-sm",

  // Padding presets
  padding: {
    none: "",
    sm: "p-3",
    md: "p-5",
    lg: "p-6",
  },

  // Interactive state — append to base
  interactive: "hover-elevate cursor-pointer transition-shadow duration-200",

  // Header / footer strips inside a card
  header: "flex flex-col gap-1.5 p-5 pb-0",
  footer: "flex items-center p-5 pt-0",
} as const;
