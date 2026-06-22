import type { SoundLevel } from "@dispersal/hooks/use-sound-settings";

interface Props {
  level: SoundLevel;
  onCycle: () => void;
}

const ICONS: Record<SoundLevel, string> = {
  all:       "🔊",
  important: "🔔",
  off:       "🔇",
};

const LABELS: Record<SoundLevel, string> = {
  all:       "All sounds on",
  important: "Important sounds only",
  off:       "Sounds off",
};

const NEXT: Record<SoundLevel, string> = {
  all:       "Switch to important only",
  important: "Switch to sounds off",
  off:       "Switch to all sounds",
};

export function SoundToggle({ level, onCycle }: Props) {
  return (
    <button
      onClick={onCycle}
      title={`${LABELS[level]} — click to ${NEXT[level]}`}
      className="p-1.5 rounded text-base leading-none text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0 select-none"
      aria-label={LABELS[level]}
    >
      {ICONS[level]}
    </button>
  );
}
