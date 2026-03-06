import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      return saved ? saved === "dark" : true;
    }
    return true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <button
      onClick={() => setDark(!dark)}
      className="flex items-center justify-center w-8 h-8 rounded-lg bg-transparent hover:bg-muted/40 transition-colors opacity-60 hover:opacity-100"
      data-testid="button-theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="w-[18px] h-[18px] text-foreground" /> : <Moon className="w-[18px] h-[18px] text-foreground" />}
    </button>
  );
}
