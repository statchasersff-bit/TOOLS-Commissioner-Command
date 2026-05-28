import { useState, useMemo, useRef, useLayoutEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InsightCallout } from "@/components/InsightCallout";
import { SectionHeader } from "@/components/SectionHeader";
import { useValueModel } from "@/contexts/ValueModelContext";
import { usePlayerProfile } from "@/contexts/PlayerProfileContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { getPositionColor } from "@/data/mockData";
import { ROOKIE_BOARD_2026_SF } from "@/data/rookieBoard2026";
import type { League } from "@/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Search, Star } from "lucide-react";

interface MarketProps {
  league: League;
}

interface PlayerRow {
  name: string;
  pos: string;
  team: string;
  age: number | null;
  dynastyValue: number;
  redraftValue: number;
  sleeperId: string;
}

type SortKey = "name" | "pos" | "age" | "dynastyValue" | "redraftValue";
type SortDir = "asc" | "desc";

export function MarketValue({ league }: MarketProps) {
  const { sourceId, sources, valuesBySleeperId, redraftValuesBySleeperId, dynastyPlayerList, getPickValue } = useValueModel();
  const { openPlayerProfile } = usePlayerProfile();
  const { user } = useSleeper();
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("dynastyValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const scrollRef = useRef<HTMLDivElement>(null);
  // True when the value table is wider than its viewport (needs horizontal
  // scrolling). When set, the wide "On Your Team" pill collapses to a compact
  // gold star next to the team abbreviation so all columns stay reachable.
  const [tableOverflows, setTableOverflows] = useState(false);

  // Set of sleeperIds owned by the signed-in user in this league — used to
  // tag rows with the "On Your Team" pill. Matches by Sleeper user_id against
  // each team's ownerId (Sleeper roster owner).
  const myPlayerIds = useMemo(() => {
    if (!user?.userId) return new Set<string>();
    const myTeam = league.teams.find((t) => t.ownerId === user.userId);
    if (!myTeam) return new Set<string>();
    const ids = new Set<string>();
    for (const p of myTeam.roster) {
      if (p.sleeperId) ids.add(p.sleeperId);
      if (p.id) ids.add(p.id);
    }
    return ids;
  }, [league, user?.userId]);

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
          age: typeof p.age === "number" && p.age > 0 ? p.age : null,
          sleeperId: id,
          dynastyValue: valuesBySleeperId[id] ?? p.value ?? 0,
          redraftValue: redraftValuesBySleeperId[id] ?? valuesBySleeperId[id] ?? p.value ?? 0,
        });
      }
    }

    return rows;
  }, [league, valuesBySleeperId, redraftValuesBySleeperId]);

  const pickRows = useMemo<PlayerRow[]>(() => {
    const seen = new Set<string>();
    const rows: PlayerRow[] = [];
    const ordinal = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : "4th";
    for (const team of league.teams) {
      for (const pick of team.picks) {
        const key = `${pick.year}_${pick.round}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          name: `${pick.year} ${ordinal(pick.round)}`,
          pos: "PICK",
          team: "—",
          age: null,
          sleeperId: `FP_${pick.year}_${pick.round}`,
          dynastyValue: getPickValue({ ...pick, projectedRange: "Mid" }),
          redraftValue: 0,
        });
      }
    }
    return rows.sort((a, b) => b.dynastyValue - a.dynastyValue);
  }, [league, getPickValue]);

  const rookieRows = useMemo<PlayerRow[]>(() => {
    // Build a name|pos → RankedPlayer lookup from the live FantasyCalc data so we
    // can resolve real Sleeper IDs (for photos), real NFL teams, and redraft values.
    const nameMap = new Map<string, { sleeperId: string; team: string; age: number }>();
    for (const p of dynastyPlayerList) {
      nameMap.set(`${p.name.toLowerCase().trim()}|${p.pos}`, { sleeperId: p.sleeperId, team: p.team, age: p.age });
    }

    return ROOKIE_BOARD_2026_SF.map((r) => {
      const key = `${r.name.toLowerCase().trim()}|${r.pos}`;
      const matched = nameMap.get(key);
      const realId = matched?.sleeperId || r.sleeperId;
      const team = matched?.team || r.team || "FA";
      const age = matched?.age && matched.age > 0 ? matched.age : (r.age > 0 ? r.age : null);
      const redraftValue = matched ? (redraftValuesBySleeperId[matched.sleeperId] ?? 0) : 0;
      return {
        name: r.name,
        pos: r.pos,
        team,
        age,
        sleeperId: realId,
        dynastyValue: r.value,
        redraftValue,
      };
    });
  }, [dynastyPlayerList, redraftValuesBySleeperId]);

  const mergedAllRows = useMemo<PlayerRow[]>(() => {
    const seen = new Set(allPlayers.map((r) => r.sleeperId));
    const extra: PlayerRow[] = [];
    for (const r of rookieRows) {
      if (!seen.has(r.sleeperId)) { seen.add(r.sleeperId); extra.push(r); }
    }
    return [...allPlayers, ...extra, ...pickRows];
  }, [allPlayers, rookieRows, pickRows]);

  // Position rank lookup — `dynastyPlayerList` is already sorted by dynasty
  // value descending across all positions, so walking it once and counting
  // per-position gives us "RB1", "RB2", "WR3", etc. keyed by sleeperId.
  // Picks and any player not in the FantasyCalc dataset get no rank and
  // fall back to the raw position string in the table.
  const posRankBySleeperId = useMemo(() => {
    const map = new Map<string, string>();
    const counters: Record<string, number> = {};
    for (const p of dynastyPlayerList) {
      counters[p.pos] = (counters[p.pos] ?? 0) + 1;
      map.set(p.sleeperId, `${p.pos}${counters[p.pos]}`);
    }
    return map;
  }, [dynastyPlayerList]);

  const filtered = useMemo(() => {
    let rows = posFilter === "rookies" ? rookieRows : posFilter === "all" ? mergedAllRows : allPlayers;

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }

    if (posFilter !== "all" && posFilter !== "rookies") {
      rows = rows.filter((r) => r.pos === posFilter);
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "pos") cmp = a.pos.localeCompare(b.pos);
      else if (sortKey === "age") {
        // Picks / unknown ages sort to the bottom regardless of direction
        // so they don't pollute the meaningful end of the list.
        const av = a.age ?? Number.POSITIVE_INFINITY;
        const bv = b.age ?? Number.POSITIVE_INFINITY;
        cmp = av - bv;
      }
      else cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      return sortDir === "desc" ? -cmp : cmp;
    });

    return rows;
  }, [allPlayers, rookieRows, search, posFilter, sortKey, sortDir]);

  // Re-measure horizontal overflow on container resize (device/orientation) and
  // whenever the row set changes. Swapping the pill for a star only changes the
  // table's scrollWidth (not the container's width), so this never oscillates.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setTableOverflows(el.scrollWidth - el.clientWidth > 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [filtered]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // Age is more useful youngest-first; values are more useful highest-first.
      setSortDir(key === "age" || key === "name" || key === "pos" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ▼" : " ▲") : "";

  return (
    <div className="space-y-6">
      {/* Subtitle describes the underlying FantasyCalc value set
          (12-team, PPR, superflex) — not the user's league config — since
          the values shown are computed against those FantasyCalc params. */}
      <SectionHeader
        title="Market Value"
        subtitle="12-team · PPR · SF"
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
          <SelectTrigger className="w-[115px] h-9 text-xs" data-testid="select-market-pos">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pos</SelectItem>
            <SelectItem value="QB">QB</SelectItem>
            <SelectItem value="RB">RB</SelectItem>
            <SelectItem value="WR">WR</SelectItem>
            <SelectItem value="TE">TE</SelectItem>
            <SelectItem value="rookies">Rookies '26</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs" data-testid="badge-player-count">
          {filtered.length} players
        </Badge>
      </div>

      <Card className="overflow-hidden">
        <div ref={scrollRef} className="overflow-x-auto">
        <table className="w-full" data-testid="table-market-values">
          <thead>
            <tr className="border-b bg-muted/40">
              <th
                className="text-left px-2 md:px-4 py-2.5 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none"
                onClick={() => toggleSort("name")}
                data-testid="th-name"
              >
                Player{sortIndicator("name")}
              </th>
              <th
                className="text-left px-2 md:px-4 py-2.5 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none w-12 md:w-20"
                onClick={() => toggleSort("pos")}
                data-testid="th-pos"
              >
                Pos{sortIndicator("pos")}
              </th>
              <th
                className="text-right px-2 md:px-4 py-2.5 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none w-[60px] md:w-32"
                onClick={() => toggleSort("redraftValue")}
                data-testid="th-redraft"
              >
                Redraft{sortIndicator("redraftValue")}
              </th>
              <th
                className="text-right px-2 md:px-4 py-2.5 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none w-[60px] md:w-32"
                onClick={() => toggleSort("dynastyValue")}
                data-testid="th-dynasty"
              >
                Dynasty{sortIndicator("dynastyValue")}
              </th>
              <th
                className="text-right px-2 md:px-4 py-2.5 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:text-[#d4af37] select-none w-10 md:w-16"
                onClick={() => toggleSort("age")}
                data-testid="th-age"
              >
                Age{sortIndicator("age")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                  No players found
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const isPick = row.sleeperId.startsWith("FP_") || row.pos === "PICK";
              return (
              <tr
                key={row.sleeperId}
                onClick={isPick ? undefined : () => openPlayerProfile(row.sleeperId)}
                className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${isPick ? "" : "cursor-pointer"}`}
                data-testid={`row-player-${row.sleeperId}`}
              >
                <td className="px-2 md:px-4 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <PlayerAvatar
                      id={row.sleeperId}
                      name={row.name}
                      pos={row.pos}
                      team={row.team}
                      size="sm"
                      metaTrailing={myPlayerIds.has(row.sleeperId) && tableOverflows ? (
                        <span
                          className="inline-flex"
                          data-testid={`star-on-your-team-${row.sleeperId}`}
                          title="This player is on your roster in this league"
                        >
                          <Star className="w-3 h-3 fill-[#d4af37] text-[#d4af37]" />
                        </span>
                      ) : undefined}
                    />
                    {myPlayerIds.has(row.sleeperId) && !tableOverflows && (
                      <span
                        className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-wide bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/40 whitespace-nowrap"
                        data-testid={`pill-on-your-team-${row.sleeperId}`}
                        title="This player is on your roster in this league"
                      >
                        On Your Team
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 md:px-4 py-2">
                  <Badge variant="outline" className={`text-[9px] md:text-[10px] px-1 md:px-2 h-4 md:h-5 md:min-w-[36px] justify-center ${getPositionColor(row.pos)}`}>
                    {posRankBySleeperId.get(row.sleeperId) ?? row.pos}
                  </Badge>
                </td>
                <td className="px-2 md:px-4 py-2 text-right font-mono text-xs md:text-sm" data-testid={`text-redraft-${row.sleeperId}`}>
                  {row.redraftValue.toLocaleString()}
                </td>
                <td className="px-2 md:px-4 py-2 text-right font-mono text-xs md:text-sm font-semibold" data-testid={`text-dynasty-${row.sleeperId}`}>
                  {row.dynastyValue.toLocaleString()}
                </td>
                <td className="px-2 md:px-4 py-2 text-right font-mono text-xs md:text-sm tabular-nums text-muted-foreground" data-testid={`text-age-${row.sleeperId}`}>
                  {row.age != null ? row.age.toFixed(1) : "—"}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}
