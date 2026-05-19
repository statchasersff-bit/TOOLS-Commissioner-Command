import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { getAvailableMockPlayers } from "@/hooks/useWeeklyPlayerProjections";
import type { MockPlayerWeekly } from "@/data/mockStartSitProjections";
import type { ScoringFormat } from "@/hooks/useWeeklyPlayerProjections";

interface Props {
  selectedPlayerIds: string[];
  onAdd: (playerId: string) => void;
  onRemove: (playerId: string) => void;
  onClear: () => void;
  week: number;
  onWeekChange: (week: number) => void;
  scoringFormat: ScoringFormat;
  onScoringFormatChange: (f: ScoringFormat) => void;
  maxPlayers: number;
  /** Called when user tries to add beyond the cap. */
  onCapHit?: () => void;
}

const WEEKS = Array.from({ length: 17 }, (_, i) => i + 1);
const SCORING_OPTIONS: { value: ScoringFormat; label: string }[] = [
  { value: "ppr", label: "PPR" },
  { value: "half_ppr", label: "Half PPR" },
  { value: "std", label: "Standard" },
];

export function PlayerCompareSearch({
  selectedPlayerIds,
  onAdd,
  onRemove,
  onClear,
  week,
  onWeekChange,
  scoringFormat,
  onScoringFormatChange,
  maxPlayers,
  onCapHit,
}: Props) {
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside mousedown (more reliable than onBlur timeout —
  // clicking a result button used to race with blur fired by the input).
  useEffect(() => {
    if (!dropdownOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [dropdownOpen]);

  const allPlayers = useMemo(() => getAvailableMockPlayers(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const taken = new Set(selectedPlayerIds);
    if (!q) {
      return allPlayers.filter((p) => !taken.has(p.playerId)).slice(0, 8);
    }
    return allPlayers
      .filter((p) => !taken.has(p.playerId))
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.position.toLowerCase() === q ||
          p.team.toLowerCase() === q ||
          p.name.toLowerCase().split(" ").some((part) => part.startsWith(q)),
      )
      .slice(0, 10);
  }, [query, allPlayers, selectedPlayerIds]);

  const selectedPlayers: MockPlayerWeekly[] = useMemo(
    () =>
      selectedPlayerIds
        .map((id) => allPlayers.find((p) => p.playerId === id))
        .filter((p): p is MockPlayerWeekly => Boolean(p)),
    [selectedPlayerIds, allPlayers],
  );

  const atCap = selectedPlayerIds.length >= maxPlayers;

  function handleAdd(id: string) {
    if (atCap) {
      onCapHit?.();
      return;
    }
    onAdd(id);
    setQuery("");
  }

  return (
    <div
      className="rounded-2xl border border-white/8 bg-gradient-to-b from-[#0a1628] to-[#06101e] p-4 md:p-5"
      data-testid="player-compare-search"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-[14px] font-bold text-white">Compare Players</h3>
          <p className="text-[11px] text-white/40 mt-0.5">
            Search up to {maxPlayers} players to weigh start/sit decisions.
          </p>
        </div>
        {selectedPlayerIds.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white border border-white/10 hover:border-white/20 rounded-full px-3 py-1"
            data-testid="button-clear-all"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Controls row */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mb-3">
        <div className="relative flex-1" ref={wrapRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            placeholder={
              atCap
                ? `Max ${maxPlayers} players — remove one to add another`
                : "Search by name, position (WR), or team (BAL)"
            }
            disabled={atCap}
            className={cn(
              "pl-9 bg-white/[0.04] border-white/10 text-[12px]",
              atCap && "opacity-60 cursor-not-allowed",
            )}
            data-testid="input-player-search"
          />
          {dropdownOpen && filtered.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full mt-1 rounded-xl border border-white/10 bg-[#0a1628] shadow-lg z-30 max-h-[320px] overflow-y-auto"
              data-testid="search-results"
            >
              {filtered.map((p) => (
                <button
                  key={p.playerId}
                  type="button"
                  onClick={() => handleAdd(p.playerId)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-b-0 text-left"
                  data-testid={`search-result-${p.playerId}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PlayerAvatar
                      id={p.playerId}
                      name={p.name}
                      pos={p.position}
                      team={p.team}
                      size="xs"
                      compact
                    />
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-white truncate">{p.name}</div>
                      <div className="text-[10px] text-white/45">
                        {p.position} · {p.team} {p.matchup.opponent}
                      </div>
                    </div>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select value={String(week)} onValueChange={(v) => onWeekChange(Number(v))}>
            <SelectTrigger
              className="w-[110px] bg-white/[0.04] border-white/10 text-[12px]"
              data-testid="select-week"
            >
              <SelectValue placeholder="Week" />
            </SelectTrigger>
            <SelectContent>
              {WEEKS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  Week {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={scoringFormat} onValueChange={(v) => onScoringFormatChange(v as ScoringFormat)}>
            <SelectTrigger
              className="w-[130px] bg-white/[0.04] border-white/10 text-[12px]"
              data-testid="select-scoring"
            >
              <SelectValue placeholder="Scoring" />
            </SelectTrigger>
            <SelectContent>
              {SCORING_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Selected chips */}
      {selectedPlayers.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.04]" data-testid="selected-chips">
          {selectedPlayers.map((p) => (
            <div
              key={p.playerId}
              className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/30 bg-[#d4af37]/8 px-3 py-1 text-[11px] font-semibold text-white"
              data-testid={`chip-${p.playerId}`}
            >
              <span>{p.name}</span>
              <span className="text-white/45 text-[10px]">
                {p.position} {p.team}
              </span>
              <button
                type="button"
                onClick={() => onRemove(p.playerId)}
                className="text-white/40 hover:text-rose-300"
                aria-label={`Remove ${p.name}`}
                data-testid={`chip-remove-${p.playerId}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
