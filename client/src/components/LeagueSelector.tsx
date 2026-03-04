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
      <SelectTrigger className="w-[180px] text-sm rounded-full border-[#0b3a7a]/20 dark:border-blue-400/20 hover:border-[#d4af37] transition-colors" data-testid="select-league">
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
