import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { useValueModel } from "@/contexts/ValueModelContext";
import { getPositionColor } from "@/data/mockData";
import type { League } from "@/types";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

interface MarketProps {
  league: League;
}

interface PlayerRow {
  name: string;
  pos: string;
  team: string;
  dynastyValue: number;
  redraftValue: number;
  sleeperId: string;
}

type SortKey = "name" | "pos" | "dynastyValue" | "redraftValue";
type SortDir = "asc" | "desc";

export function MarketValue({ league }: MarketProps) {
  const { sourceId, sources, valuesBySleeperId, redraftValuesBySleeperId } = useValueModel();
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("dynastyValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const activeSource = sources.find((s) => s.id === sourceId);

  const allPlayers = useMemo<PlayerRow[]>(() => {
    const seen = new Set<string>();
    const rows: PlayerRow[] = [];

    for (const team of league.teams) {
      for (const p of team.roster) {
        const id = p.sleeperId || p.id;
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({
          name: p.name,
          pos: p.pos,
          team: p.team,
          sleeperId: id,
          dynastyValue: valuesBySleeperId[id] ?? p.value ?? 0,
          redraftValue: redraftValuesBySleeperId[id] ?? valuesBySleeperId[id] ?? p.value ?? 0,
        });
      }
    }

    return rows;
  }, [league, valuesBySleeperId, redraftValuesBySleeperId]);

  const filtered = useMemo(() => {
    let rows = allPlayers;

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }

    if (posFilter !== "all") {
      rows = rows.filter((r) => r.pos === posFilter);
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "pos") cmp = a.pos.localeCompare(b.pos);
      else cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      return sortDir === "desc" ? -cmp : cmp;
    });

    return rows;
  }, [allPlayers, search, posFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ▼" : " ▲") : "";

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Market Value"
        subtitle={`Trade values from ${activeSource?.label || "selected source"}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search player..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
            data-testid="input-market-search"
          />
        </div>
        <Select value={posFilter} onValueChange={setPosFilter}>
          <SelectTrigger className="w-[100px] h-9 text-xs" data-testid="select-market-pos">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pos</SelectItem>
            <SelectItem value="QB">QB</SelectItem>
            <SelectItem value="RB">RB</SelectItem>
            <SelectItem value="WR">WR</SelectItem>
            <SelectItem value="TE">TE</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs" data-testid="badge-player-count">
          {filtered.length} players
        </Badge>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-market-values">
            <thead>
              <tr className="border-b bg-muted/40">
                <th
                  className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none"
                  onClick={() => toggleSort("name")}
                  data-testid="th-name"
                >
                  Player{sortIndicator("name")}
                </th>
                <th
                  className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none w-20"
                  onClick={() => toggleSort("pos")}
                  data-testid="th-pos"
                >
                  Pos{sortIndicator("pos")}
                </th>
                <th
                  className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none w-32"
                  onClick={() => toggleSort("redraftValue")}
                  data-testid="th-redraft"
                >
                  Redraft{sortIndicator("redraftValue")}
                </th>
                <th
                  className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none w-32"
                  onClick={() => toggleSort("dynastyValue")}
                  data-testid="th-dynasty"
                >
                  Dynasty{sortIndicator("dynastyValue")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                    No players found
                  </td>
                </tr>
              )}
              {filtered.map((row) => (
                <tr
                  key={row.sleeperId}
                  className="border-b border-border/30 hover:bg-muted/20 transition-colors"
                  data-testid={`row-player-${row.sleeperId}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden bg-muted ring-1 ring-border/40">
                        <img
                          src={`https://sleepercdn.com/content/nfl/players/thumb/${row.sleeperId}.jpg`}
                          alt={row.name}
                          className="w-full h-full object-cover object-top"
                          onError={(e) => {
                            const el = e.target as HTMLImageElement;
                            el.style.display = "none";
                            el.parentElement!.classList.add("flex", "items-center", "justify-center");
                            el.parentElement!.innerHTML = `<span class="text-[10px] font-bold text-muted-foreground">${row.pos}</span>`;
                          }}
                        />
                      </div>
                      <div>
                        <span className="font-medium block" data-testid={`text-player-name-${row.sleeperId}`}>{row.name}</span>
                        <span className="text-[11px] text-muted-foreground">{row.team}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className={`text-[10px] w-8 justify-center ${getPositionColor(row.pos)}`}>
                      {row.pos}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm" data-testid={`text-redraft-${row.sleeperId}`}>
                    {row.redraftValue.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold" data-testid={`text-dynasty-${row.sleeperId}`}>
                    {row.dynastyValue.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
