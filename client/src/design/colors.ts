// Maps to CSS custom properties defined in index.css.
// Use these when you need color values in JS/TS (e.g. chart configs, canvas).
// In JSX, prefer Tailwind classes that reference the same CSS vars.

export const colors = {
  // Backgrounds
  background: "hsl(var(--background))",
  card: "hsl(var(--card))",
  popover: "hsl(var(--popover))",
  sidebar: "hsl(var(--sidebar))",

  // Foregrounds
  foreground: "hsl(var(--foreground))",
  cardForeground: "hsl(var(--card-foreground))",
  mutedForeground: "hsl(var(--muted-foreground))",

  // Brand
  primary: "hsl(var(--primary))",
  primaryForeground: "hsl(var(--primary-foreground))",

  // Gold accent — StatChasers signature
  accent: "hsl(var(--accent))",
  accentForeground: "hsl(var(--accent-foreground))",
  ring: "hsl(var(--ring))", // gold ring / focus / highlight

  // Surfaces
  muted: "hsl(var(--muted))",
  secondary: "hsl(var(--secondary))",
  border: "hsl(var(--border))",
  input: "hsl(var(--input))",

  // Semantic
  destructive: "hsl(var(--destructive))",
  destructiveForeground: "hsl(var(--destructive-foreground))",

  // Status dots
  status: {
    online: "rgb(34 197 94)",
    away: "rgb(245 158 11)",
    busy: "rgb(239 68 68)",
    offline: "rgb(156 163 175)",
  },

  // Charts (ordered by usage priority)
  chart: {
    1: "hsl(var(--chart-1))", // blue
    2: "hsl(var(--chart-2))", // gold
    3: "hsl(var(--chart-3))", // teal
    4: "hsl(var(--chart-4))", // orange
    5: "hsl(var(--chart-5))", // purple
  },
} as const;
