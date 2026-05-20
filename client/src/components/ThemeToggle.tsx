import { useState, useEffect } from "react";
import { Moon, Sun, Zap } from "lucide-react";

type Theme = "light" | "dark" | "x-mode";

const THEMES: Theme[] = ["light", "dark", "x-mode"];

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark" || saved === "x-mode") return saved;
  return "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("x-mode", theme === "x-mode");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const cycle = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(next);
  };

  // Icon represents the CURRENT theme.
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Zap;
  const label =
    theme === "light"
      ? "Switch to dark mode"
      : theme === "dark"
        ? "Switch to X-Mode"
        : "Switch to light mode";

  return (
    <button
      onClick={cycle}
      className="flex items-center justify-center w-8 h-8 rounded-lg bg-transparent hover:bg-muted/40 transition-colors opacity-60 hover:opacity-100"
      data-testid="button-theme-toggle"
      aria-label={label}
      title={label}
    >
      <Icon className="w-[18px] h-[18px] text-foreground" />
    </button>
  );
}
