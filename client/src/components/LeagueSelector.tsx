import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { League } from "../types";

interface LeagueSelectorProps {
  leagues: League[];
  selectedLeagueId: string | null;
  onSelect: (id: string) => void;
}

function LeagueAvatar({ avatar, name, size = 5 }: { avatar?: string | null; name: string; size?: number }) {
  const sizeClass = `w-${size} h-${size}`;
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0 ring-1 ring-border/40`}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className={`${sizeClass} rounded-full flex-shrink-0 bg-[#0b3a7a]/20 dark:bg-blue-900/30 flex items-center justify-center ring-1 ring-border/40`}>
      <span className="text-[8px] font-bold text-[#0b3a7a] dark:text-blue-300">{initials}</span>
    </div>
  );
}

export function LeagueSelector({ leagues, selectedLeagueId, onSelect }: LeagueSelectorProps) {
  const selected = leagues.find(l => l.id === selectedLeagueId);

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <Select value={selectedLeagueId || ""} onValueChange={onSelect}>
        <SelectTrigger className="w-full max-w-[260px] h-9 text-sm rounded-full border-[#0b3a7a]/30 dark:border-blue-400/25 bg-background hover:border-[#d4af37] dark:hover:border-[#d4af37] focus:ring-[#d4af37]/30 transition-all duration-200 [&>span]:flex-1 [&>span]:flex [&>span]:items-center [&>span]:justify-center" data-testid="select-league">
          <SelectValue placeholder="Select League" />
        </SelectTrigger>
        <SelectContent>
          {leagues.map((league) => (
            <SelectItem key={league.id} value={league.id} data-testid={`league-option-${league.id}`}>
              <div className="flex items-center gap-2">
                <LeagueAvatar avatar={league.avatar} name={league.name} size={5} />
                <span className="truncate">{league.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
