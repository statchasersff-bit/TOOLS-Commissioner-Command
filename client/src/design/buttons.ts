// Tailwind class strings for button variants and sizes.
// Matches the existing shadcn Button component variants — use these
// when building custom interactive elements that can't use the Button component.

export const button = {
  // Base — shared across all variants
  base: "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 select-none",

  // Variants
  variant: {
    primary: "bg-primary text-primary-foreground hover-elevate active-elevate",
    secondary: "bg-secondary text-secondary-foreground border border-secondary-border hover-elevate",
    outline: "border border-border bg-transparent text-foreground hover-elevate",
    ghost: "bg-transparent text-foreground hover-elevate",
    destructive: "bg-destructive text-destructive-foreground hover-elevate",
    gold: "bg-[hsl(var(--ring)/0.15)] text-[hsl(var(--ring))] border border-[hsl(var(--ring)/0.35)] hover-elevate",
    link: "bg-transparent text-primary underline-offset-4 hover:underline p-0 h-auto",
  },

  // Sizes
  size: {
    xs: "h-6 px-2 text-xs",
    sm: "h-8 px-3 text-sm",
    md: "h-9 px-4 text-sm",
    lg: "h-10 px-6 text-base",
    xl: "h-12 px-8 text-base",
    icon: "h-9 w-9",
    iconSm: "h-7 w-7",
  },
} as const;
