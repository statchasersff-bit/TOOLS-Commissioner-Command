import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { League } from "../types";

interface LeagueSelectorProps {
  leagues: League[];
  selectedLeagueId: string | null;
  onSelect: (id: string) => void;
}

export function LeagueSelector({ leagues, selectedLeagueId, onSelect }: LeagueSelectorProps) {
  return (
    <Select value={selectedLeagueId || ""} onValueChange={onSelect}>
      <SelectTrigger className="w-[240px] h-9 text-sm rounded-full border-[#0b3a7a]/30 dark:border-blue-400/25 bg-background hover:border-[#d4af37] dark:hover:border-[#d4af37] focus:ring-[#d4af37]/30 transition-all duration-200" data-testid="select-league">
        <SelectValue placeholder="Select League" />
      </SelectTrigger>
      <SelectContent>
        {leagues.map((league) => (
          <SelectItem key={league.id} value={league.id} data-testid={`league-option-${league.id}`}>
            {league.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
