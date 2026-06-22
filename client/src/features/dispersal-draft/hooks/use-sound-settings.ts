import { useState, useCallback } from "react";

export type SoundLevel = "all" | "important" | "off";

const KEY = "statchasers_sound";

function load(): SoundLevel {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "all" || v === "important" || v === "off") return v;
  } catch {}
  return "all";
}

export function useSoundSettings() {
  const [level, setLevel] = useState<SoundLevel>(load);

  const cycle = useCallback(() => {
    setLevel(prev => {
      const next: SoundLevel = prev === "all" ? "important" : prev === "important" ? "off" : "all";
      try { localStorage.setItem(KEY, next); } catch {}
      return next;
    });
  }, []);

  return { level, cycle };
}
