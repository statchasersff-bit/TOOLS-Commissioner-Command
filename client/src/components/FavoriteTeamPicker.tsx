import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { NFL_TEAMS, type NflTeam } from "@/config/nflTeams";

interface Props {
  selectedAbbr: string | null;
  onSelect: (abbr: string) => void;
}

/**
 * Searchable grid selector — 32 teams in a 2-column grid on small screens and
 * 4 columns on desktop. Each row shows the team's logo (Sleeper CDN, with a
 * graceful colored-chip fallback), name, and abbreviation. The whole thing is
 * a list of buttons so keyboard nav works.
 */
export function FavoriteTeamPicker({ selectedAbbr, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NFL_TEAMS;
    return NFL_TEAMS.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.shortName.toLowerCase().includes(q) ||
        t.abbreviation.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="space-y-3" data-testid="favorite-team-picker">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teams…"
          className="pl-8 h-9 text-sm"
          data-testid="favorite-team-picker-search"
        />
      </div>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 max-h-[420px] overflow-y-auto pr-1"
        role="listbox"
        aria-label="NFL teams"
      >
        {filtered.length === 0 ? (
          <p className="col-span-full text-center text-sm text-muted-foreground py-6">
            No teams match "{query}".
          </p>
        ) : (
          filtered.map((t) => (
            <TeamOption
              key={t.abbreviation}
              team={t}
              selected={selectedAbbr === t.abbreviation}
              onClick={() => onSelect(t.abbreviation)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TeamOption({
  team, selected, onClick,
}: { team: NflTeam; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="option"
      aria-selected={selected}
      data-testid={`favorite-team-option-${team.abbreviation}`}
      className={cn(
        "flex items-center gap-2.5 px-2.5 py-2 rounded-md border text-left transition-colors",
        selected
          ? "border-[#d4af37] bg-[#d4af37]/8"
          : "border-border/40 bg-muted/20 hover:bg-muted/40 hover:border-border/60",
      )}
    >
      {/* Colored chip behind the logo so a CDN miss still looks branded. */}
      <span
        className="relative w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ring-1 ring-black/10"
        style={{ background: team.primaryColor }}
      >
        <img
          src={team.logoUrl}
          alt=""
          className="absolute inset-0.5 w-6 h-6 object-contain"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <span className="text-[9px] font-black tracking-tight" style={{ color: team.secondaryColor }}>
          {team.abbreviation}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold truncate">{team.name}</span>
        <span className="block text-[10px] text-muted-foreground">{team.abbreviation}</span>
      </span>
    </button>
  );
}
