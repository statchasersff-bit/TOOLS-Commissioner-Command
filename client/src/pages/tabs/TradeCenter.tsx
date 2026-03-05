import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable } from "@/components/DataTable";
import { SectionHeader } from "@/components/SectionHeader";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { getTeamTier, getTierColor, getTierBg, getPositionColor } from "@/data/mockData";
import { getStaticPickValue } from "@/data/pickValues";
import { apiRequest } from "@/lib/queryClient";
import type { League, Team, Tier, Player, Pick, TradeRecord, TradeSide, CrawlStatus } from "@/types";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, TrendingUp, TrendingDown, Target, X, Plus, Search, Info, Scale, RotateCcw, Database, Play, Pause, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

interface TradeProps {
  league: League;
  userTeam: Team;
}

export function TradeFinder({ league, userTeam }: TradeProps) {
  const partners = league.teams
    .filter((t) => t.id !== userTeam.id)
    .map((t) => {
      const reasons: string[] = [];
      const tier = getTeamTier(t.metrics.overall);
      if (t.metrics.rb > 70 && userTeam.metrics.rb < 50) reasons.push("RB surplus");
      if (t.metrics.wr > 70 && userTeam.metrics.wr < 50) reasons.push("WR surplus");
      if (tier === "Rebuild") reasons.push("Rebuilding - selling vets");
      if (tier === "Contender" && t.metrics.te < 40) reasons.push("Needs TE");
      if (tier === "Contender" && t.metrics.qb < 50) reasons.push("Needs QB");
      if (t.picks.filter((p) => p.round === 1).length >= 3) reasons.push("Pick rich");
      if (reasons.length === 0) reasons.push("Balanced roster");
      return { ...t, reasons, tier };
    })
    .sort((a, b) => b.reasons.length - a.reasons.length);

  const columns = [
    { key: "name", header: "Team", sticky: true, sortable: true, sortAccessor: (row: any) => row.name, render: (row: any) => (
      <div>
        <span className="font-semibold">{row.name}</span>
        <span className="text-xs text-muted-foreground ml-2">({row.owner})</span>
      </div>
    )},
    { key: "tier", header: "Tier", sortable: true, sortAccessor: (row: any) => row.metrics.overall, render: (row: any) => <Badge variant="outline" className={getTierColor(row.tier)}>{row.tier}</Badge> },
    { key: "overall", header: "Score", sortable: true, sortAccessor: (row: any) => row.metrics.overall, render: (row: any) => <span className="font-bold text-lg">{row.metrics.overall}</span> },
    { key: "reasons", header: "Trade Reasons", sortable: true, sortAccessor: (row: any) => row.reasons.length, render: (row: any) => (
      <div className="flex flex-wrap gap-1">
        {row.reasons.map((r: string, i: number) => (
          <Badge key={i} variant="secondary" className="text-xs">{r}</Badge>
        ))}
      </div>
    )},
    { key: "target", header: "", render: (row: any) => (
      <Button variant="ghost" size="sm" data-testid={`button-explore-${row.id}`}>
        <ArrowRightLeft className="w-3 h-3 mr-1" /> Explore
      </Button>
    )},
  ];

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Finder" subtitle="Best trade partners based on roster needs" />
      <DataTable columns={columns} data={partners} />
    </div>
  );
}

export function TradeTargets({ league, userTeam }: TradeProps) {
  const rebuildTeams = league.teams.filter((t) => getTeamTier(t.metrics.overall) === "Rebuild" && t.id !== userTeam.id);
  const contenderTeams = league.teams.filter((t) => ["Elite", "Contender"].includes(getTeamTier(t.metrics.overall)) && t.id !== userTeam.id);

  const buyLow = rebuildTeams.flatMap((t) =>
    t.roster.filter((p) => p.starter && p.value >= 30).map((p) => ({ ...p, ownerName: t.owner, reason: "Rebuilder selling vets" }))
  ).slice(0, 5);

  const contenderPush = contenderTeams.flatMap((t) =>
    t.roster.filter((p) => p.starter && p.value >= 50).map((p) => ({ ...p, ownerName: t.owner, reason: "Contender depth piece" }))
  ).slice(0, 5);

  const youthUpside = league.teams
    .filter((t) => t.id !== userTeam.id)
    .flatMap((t) =>
      t.roster.filter((p) => p.age <= 24 && p.value >= 20).map((p) => ({ ...p, ownerName: t.owner, reason: "Young upside" }))
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const renderGroup = (title: string, icon: any, players: any[]) => (
    <Card className="p-6">
      <div className="mb-5">
        <h3 className="text-base font-bold flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
      </div>
      <div className="space-y-1">
        {players.length === 0 && <p className="text-xs text-muted-foreground">No targets found</p>}
        {players.map((p, i) => (
          <div key={i} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`text-xs w-8 justify-center ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
              <div>
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">From {p.ownerName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Age {p.age}</span>
              <Badge variant="secondary">{p.value} pts</Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Targets" subtitle="Recommended acquisition targets by strategy" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {renderGroup("Buy Low", <TrendingDown className="w-4 h-4 text-emerald-500" />, buyLow)}
        {renderGroup("Contender Push", <Target className="w-4 h-4 text-blue-500" />, contenderPush)}
        {renderGroup("Youth Upside", <TrendingUp className="w-4 h-4 text-amber-500" />, youthUpside)}
      </div>
    </div>
  );
}

export function TradeBlockScanner({ league }: { league: League }) {
  const sellers = league.teams.filter((t) => getTeamTier(t.metrics.overall) === "Rebuild");
  const buyers = league.teams.filter((t) => ["Elite", "Contender"].includes(getTeamTier(t.metrics.overall)));

  const tradeBlockCandidates = sellers.flatMap((t) =>
    t.roster.filter((p) => p.starter && p.age >= 27).map((p) => ({ ...p, teamName: t.name, ownerName: t.owner }))
  );

  return (
    <div className="space-y-8">
      <SectionHeader title="Trade Block Scanner" subtitle="Identify likely sellers and buyers in your league" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Likely Sellers
            </h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <div className="space-y-2.5">
            {sellers.map((t) => (
              <div key={t.id} className={cn("p-3.5 rounded-md", getTierBg("Rebuild"))}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.owner}</p>
                  </div>
                  <Badge variant="outline" className={getTierColor("Rebuild")}>Rebuild</Badge>
                </div>
              </div>
            ))}
            {sellers.length === 0 && <p className="text-xs text-muted-foreground">No clear sellers identified</p>}
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              Likely Buyers
            </h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>
          <div className="space-y-2.5">
            {buyers.map((t) => {
              const tier = getTeamTier(t.metrics.overall);
              return (
                <div key={t.id} className={cn("p-3.5 rounded-md", getTierBg(tier))}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.owner}</p>
                    </div>
                    <Badge variant="outline" className={getTierColor(tier)}>{tier}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            Trade Block Candidates
            <Badge variant="secondary">{tradeBlockCandidates.length}</Badge>
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>
        <div className="space-y-1">
          {tradeBlockCandidates.map((p, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`text-xs w-8 justify-center ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                <div>
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.teamName} ({p.ownerName})</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Age {p.age}</span>
                <Badge variant="secondary">{p.value} pts</Badge>
              </div>
            </div>
          ))}
          {tradeBlockCandidates.length === 0 && <p className="text-xs text-muted-foreground">No trade block candidates found</p>}
        </div>
      </Card>
    </div>
  );
}

const DIMINISHING_WEIGHTS = [1.00, 0.85, 0.72, 0.60, 0.50, 0.42, 0.36, 0.31];

interface TradeAsset {
  id: string;
  type: "player" | "pick";
  player?: Player;
  pickYear?: number;
  pickRound?: number;
  pickRange?: "Early" | "Mid" | "Late";
  value: number;
  label: string;
  pos?: string;
}

function getWeight(index: number): number {
  return index < DIMINISHING_WEIGHTS.length ? DIMINISHING_WEIGHTS[index] : 0.31;
}

function calculateAdjustedTotal(assets: TradeAsset[]): number {
  const sorted = [...assets].sort((a, b) => b.value - a.value);
  return sorted.reduce((sum, asset, i) => sum + asset.value * getWeight(i), 0);
}

function calculateRawTotal(assets: TradeAsset[]): number {
  return assets.reduce((sum, a) => sum + a.value, 0);
}

interface PlayerSearchProps {
  allPlayers: Player[];
  onAdd: (player: Player) => void;
  side: "a" | "b";
  getPlayerValue: (player: Player) => number;
}

function PlayerSearchInput({ allPlayers, onAdd, side, getPlayerValue }: PlayerSearchProps) {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (query.length < 2) return [];
    const q = query.toLowerCase();
    return allPlayers
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
      .slice(0, 10);
  }, [query, allPlayers, getPlayerValue]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search players..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          className="pl-8"
          data-testid={`input-player-search-${side}`}
        />
      </div>
      {showResults && results.length > 0 && (
        <div className="absolute z-20 top-full mt-1 w-full bg-background border border-border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {results.map((p) => {
            const val = getPlayerValue(p);
            return (
              <button
                key={p.id}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover-elevate"
                onClick={() => {
                  onAdd(p);
                  setQuery("");
                  setShowResults(false);
                }}
                data-testid={`button-add-player-${side}-${p.id}`}
              >
                <Badge variant="outline" className={`text-[10px] w-7 justify-center ${getPositionColor(p.pos)}`}>{p.pos}</Badge>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.team} | Age {p.age}</span>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">{val.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface PickAdderProps {
  onAdd: (year: number, round: number, range: "Early" | "Mid" | "Late") => void;
  side: "a" | "b";
}

function PickAdder({ onAdd, side }: PickAdderProps) {
  const [show, setShow] = useState(false);
  const [year, setYear] = useState("2025");
  const [round, setRound] = useState("1");
  const [range, setRange] = useState<"Early" | "Mid" | "Late">("Mid");

  if (!show) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShow(true)}
        data-testid={`button-show-pick-adder-${side}`}
      >
        <Plus className="w-3 h-3 mr-1" /> Add Pick
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={year} onValueChange={setYear}>
        <SelectTrigger className="w-20" data-testid={`select-pick-year-${side}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="2025">2025</SelectItem>
          <SelectItem value="2026">2026</SelectItem>
          <SelectItem value="2027">2027</SelectItem>
          <SelectItem value="2028">2028</SelectItem>
        </SelectContent>
      </Select>
      <Select value={round} onValueChange={setRound}>
        <SelectTrigger className="w-20" data-testid={`select-pick-round-${side}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Rd 1</SelectItem>
          <SelectItem value="2">Rd 2</SelectItem>
          <SelectItem value="3">Rd 3</SelectItem>
          <SelectItem value="4">Rd 4</SelectItem>
        </SelectContent>
      </Select>
      <Select value={range} onValueChange={(v) => setRange(v as "Early" | "Mid" | "Late")}>
        <SelectTrigger className="w-20" data-testid={`select-pick-range-${side}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Early">Early</SelectItem>
          <SelectItem value="Mid">Mid</SelectItem>
          <SelectItem value="Late">Late</SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="sm"
        onClick={() => {
          onAdd(parseInt(year), parseInt(round), range);
          setShow(false);
        }}
        data-testid={`button-confirm-pick-${side}`}
      >
        Add
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShow(false)}
        data-testid={`button-cancel-pick-${side}`}
      >
        Cancel
      </Button>
    </div>
  );
}

interface TradeCalculatorProps {
  league: League;
  userTeam: Team;
}

export function TradeCalculator({ league, userTeam }: TradeCalculatorProps) {
  const { getPlayerValue, valuesBySleeperId } = useValueModel();
  const [sideA, setSideA] = useState<TradeAsset[]>([]);
  const [sideB, setSideB] = useState<TradeAsset[]>([]);
  const [valueAdjustment, setValueAdjustment] = useState(true);
  const [overpayTax, setOverpayTax] = useState(false);
  const [tradePartnerId, setTradePartnerId] = useState<string>("");
  const [sideARosterId, setSideARosterId] = useState<string>(userTeam.id);
  const [sideBRosterId, setSideBRosterId] = useState<string>("");

  const leagueFormat = useMemo(() => {
    const sf = league.scoringFormat?.toLowerCase() || "";
    return sf.includes("sf") || sf.includes("superflex") ? "SF" : "1QB";
  }, [league]);

  const playerToTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of league.teams) {
      for (const p of team.roster) {
        map.set(p.sleeperId || p.id, team.id);
      }
    }
    return map;
  }, [league]);

  const sideATeam = useMemo(() => league.teams.find((t) => t.id === sideARosterId), [league, sideARosterId]);
  const sideBTeam = useMemo(() => league.teams.find((t) => t.id === sideBRosterId), [league, sideBRosterId]);

  const sideAPlayers = useMemo(() => sideATeam?.roster || [], [sideATeam]);
  const sideBPlayers = useMemo(() => sideBTeam?.roster || [], [sideBTeam]);

  const handleTradePartnerChange = useCallback((teamId: string) => {
    setTradePartnerId(teamId);
    setSideBRosterId(teamId);
    setSideB([]);
  }, []);

  const addPlayer = useCallback((side: "a" | "b", player: Player) => {
    const setter = side === "a" ? setSideA : setSideB;
    const val = getPlayerValue(player);
    const asset: TradeAsset = {
      id: `player-${player.sleeperId || player.id}-${Date.now()}`,
      type: "player",
      player,
      value: val,
      label: player.name,
      pos: player.pos,
    };
    setter((prev) => [...prev, asset]);

    const playerId = player.sleeperId || player.id;
    const ownerTeamId = playerToTeamMap.get(playerId);
    if (ownerTeamId) {
      if (side === "a" && !sideARosterId) {
        setSideARosterId(ownerTeamId);
      } else if (side === "b" && !sideBRosterId) {
        setSideBRosterId(ownerTeamId);
        setTradePartnerId(ownerTeamId);
      }
    }
  }, [getPlayerValue, playerToTeamMap, sideARosterId, sideBRosterId]);

  const addPick = useCallback((side: "a" | "b", year: number, round: number, range: "Early" | "Mid" | "Late") => {
    const setter = side === "a" ? setSideA : setSideB;
    const rangeKey = range.toLowerCase() as "early" | "mid" | "late";
    const val = getStaticPickValue(year, round, rangeKey);
    const asset: TradeAsset = {
      id: `pick-${year}-${round}-${range}-${Date.now()}`,
      type: "pick",
      pickYear: year,
      pickRound: round,
      pickRange: range,
      value: val,
      label: `${year} ${range} ${round}${round === 1 ? "st" : round === 2 ? "nd" : round === 3 ? "rd" : "th"}`,
    };
    setter((prev) => [...prev, asset]);
  }, []);

  const removeAsset = useCallback((side: "a" | "b", assetId: string) => {
    const setter = side === "a" ? setSideA : setSideB;
    setter((prev) => prev.filter((a) => a.id !== assetId));
  }, []);

  const clearAll = useCallback(() => {
    setSideA([]);
    setSideB([]);
    setTradePartnerId("");
    setSideARosterId(userTeam.id);
    setSideBRosterId("");
  }, [userTeam.id]);

  const rawA = calculateRawTotal(sideA);
  const rawB = calculateRawTotal(sideB);
  const adjA = calculateAdjustedTotal(sideA);
  const adjB = calculateAdjustedTotal(sideB);

  const applyOverpayPenalty = useCallback((assets: TradeAsset[], adjustedTotal: number, rawTotal: number): number => {
    if (!overpayTax || assets.length === 0) return adjustedTotal;
    const topAsset = Math.max(...assets.map((a) => a.value));
    if (topAsset > rawTotal * 0.35) {
      return adjustedTotal * 0.97;
    }
    return adjustedTotal;
  }, [overpayTax]);

  const finalA = valueAdjustment ? applyOverpayPenalty(sideA, adjA, rawA) : rawA;
  const finalB = valueAdjustment ? applyOverpayPenalty(sideB, adjB, rawB) : rawB;

  const diff = Math.abs(finalA - finalB);
  const maxVal = Math.max(finalA, finalB, 1);
  const diffPct = (diff / maxVal) * 100;

  const fairnessLabel = diffPct <= 5 ? "Fair" : diffPct <= 12 ? "Slight Overpay" : "Overpay";
  const fairnessColor = diffPct <= 5
    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
    : diffPct <= 12
      ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
      : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400";

  const winnerSide = finalA >= finalB ? "A" : "B";
  const loserSide = finalA >= finalB ? "B" : "A";

  const positionImpact = useMemo(() => {
    if (!league || !userTeam) return null;
    const positions: ("QB" | "RB" | "WR" | "TE")[] = ["QB", "RB", "WR", "TE"];
    const starters = userTeam.roster.filter((p) => p.starter);

    const addedA = sideA.filter((a) => a.type === "player" && a.player).map((a) => a.player!);
    const removedA = sideB.filter((a) => a.type === "player" && a.player).map((a) => a.player!);

    return positions.map((pos) => {
      const currentStarters = starters.filter((p) => p.pos === pos);
      const currentVal = currentStarters.reduce((s, p) => s + getPlayerValue(p), 0);

      const added = addedA.filter((p) => p.pos === pos);
      const removed = removedA.filter((p) => p.pos === pos);
      const addedVal = added.reduce((s, p) => s + getPlayerValue(p), 0);
      const removedVal = removed.reduce((s, p) => s + getPlayerValue(p), 0);

      const afterVal = currentVal + addedVal - removedVal;
      const change = afterVal - currentVal;

      return { pos, before: currentVal, after: afterVal, change };
    });
  }, [league, userTeam, sideA, sideB, getPlayerValue]);

  const allPlayers = useMemo(() => {
    const seen = new Set<string>();
    const players: Player[] = [];
    for (const team of league.teams) {
      for (const p of team.roster) {
        const key = p.sleeperId || p.id;
        if (!seen.has(key)) {
          seen.add(key);
          players.push(p);
        }
      }
    }
    return players;
  }, [league]);

  const renderSide = (side: "a" | "b", assets: TradeAsset[], rawTotal: number) => {
    const sideLabel = side === "a" ? "A" : "B";
    const rosterTeam = side === "a" ? sideATeam : sideBTeam;
    const rosterPlayers = side === "a" ? sideAPlayers : sideBPlayers;
    const addedPlayerIds = new Set(assets.filter((a) => a.type === "player" && a.player).map((a) => a.player!.sleeperId || a.player!.id));

    return (
      <Card className="p-5 flex-1">
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2" data-testid={`text-side-${side}-header`}>
              <Scale className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              Side {sideLabel} Gets...
            </h3>
            {rosterTeam && (
              <Badge variant="secondary" className="text-[10px]" data-testid={`badge-side-${side}-team`}>
                {rosterTeam.owner || rosterTeam.name}
              </Badge>
            )}
          </div>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="space-y-3">
          <PlayerSearchInput
            allPlayers={rosterPlayers.length > 0 ? rosterPlayers : allPlayers}
            onAdd={(p) => addPlayer(side, p)}
            side={side}
            getPlayerValue={getPlayerValue}
          />

          <PickAdder onAdd={(y, r, rng) => addPick(side, y, r, rng)} side={side} />

          <div className="space-y-1 min-h-[80px]">
            {assets.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center" data-testid={`text-empty-side-${side}`}>
                Add players or picks to this side
              </p>
            )}
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center justify-between py-2 px-2.5 rounded-md bg-muted/20 dark:bg-muted/10"
                data-testid={`asset-${side}-${asset.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {asset.type === "player" && asset.pos && (
                    <Badge variant="outline" className={`text-[10px] w-7 justify-center flex-shrink-0 ${getPositionColor(asset.pos)}`}>
                      {asset.pos}
                    </Badge>
                  )}
                  {asset.type === "pick" && (
                    <Badge variant="outline" className="text-[10px] w-7 justify-center flex-shrink-0 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800">
                      PK
                    </Badge>
                  )}
                  <span className="text-sm font-medium truncate">{asset.label}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-semibold text-muted-foreground">{asset.value.toLocaleString()}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAsset(side, asset.id)}
                    data-testid={`button-remove-${side}-${asset.id}`}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            <span className="text-xs text-muted-foreground">{assets.length} piece{assets.length !== 1 ? "s" : ""}</span>
            <span className="text-sm font-bold" data-testid={`text-raw-total-${side}`}>
              {rawTotal.toLocaleString()}
            </span>
          </div>

          {rosterTeam && rosterPlayers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {rosterTeam.owner || rosterTeam.name}'s Roster
              </p>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {[...rosterPlayers]
                  .sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
                  .map((p) => {
                    const pid = p.sleeperId || p.id;
                    const isAdded = addedPlayerIds.has(pid);
                    const val = getPlayerValue(p);
                    return (
                      <button
                        key={pid}
                        className={cn(
                          "w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-xs transition-colors",
                          isAdded
                            ? "bg-[#d4af37]/10 opacity-50 cursor-default"
                            : "hover:bg-muted/40 cursor-pointer"
                        )}
                        onClick={() => !isAdded && addPlayer(side, p)}
                        disabled={isAdded}
                        data-testid={`button-roster-player-${side}-${pid}`}
                      >
                        <Badge variant="outline" className={`text-[9px] w-6 justify-center flex-shrink-0 ${getPositionColor(p.pos)}`}>
                          {p.pos}
                        </Badge>
                        <span className={cn("flex-1 truncate", isAdded && "line-through")}>{p.name}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{val > 0 ? val.toLocaleString() : "-"}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Trade Calculator" subtitle="Evaluate trades with dynasty values and diminishing returns" />

      <Card className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant="outline" className="text-xs" data-testid="badge-format">
            {leagueFormat}
          </Badge>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Trade with:</span>
            <Select value={tradePartnerId || "none"} onValueChange={(v) => handleTradePartnerChange(v === "none" ? "" : v)}>
              <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-trade-partner">
                <SelectValue placeholder="Select team..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select team...</SelectItem>
                {league.teams
                  .filter((t) => t.id !== userTeam.id)
                  .sort((a, b) => (a.owner || a.name).localeCompare(b.owner || b.name))
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.owner || t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={valueAdjustment}
              onCheckedChange={setValueAdjustment}
              data-testid="switch-value-adjustment"
            />
            <span className="text-sm font-medium">Value Adjustment</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" data-testid="icon-info-value-adjustment" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">Diminishing returns on extra pieces; emphasizes the key asset in the deal. Assets are sorted by value and weighted: 100%, 85%, 72%, 60%, 50%, 42%, 36%, 31%.</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={overpayTax}
              onCheckedChange={setOverpayTax}
              data-testid="switch-overpay-tax"
            />
            <span className="text-sm font-medium">Overpay Tax</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" data-testid="icon-info-overpay-tax" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">Penalizes consolidation deals. If the top asset is more than 35% of that side's raw total, a 3% penalty is applied to the adjusted total.</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              data-testid="button-clear-trade"
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Clear
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {renderSide("a", sideA, rawA)}
        {renderSide("b", sideB, rawB)}
      </div>

      {(sideA.length > 0 || sideB.length > 0) && (
        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              Trade Analysis
            </h3>
            <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Raw Total</p>
              <div className="flex items-center justify-between">
                <div className="text-center flex-1">
                  <p className="text-xs text-muted-foreground">Side A</p>
                  <p className="text-lg font-bold" data-testid="text-analysis-raw-a">{rawA.toLocaleString()}</p>
                </div>
                <span className="text-muted-foreground text-xs">vs</span>
                <div className="text-center flex-1">
                  <p className="text-xs text-muted-foreground">Side B</p>
                  <p className="text-lg font-bold" data-testid="text-analysis-raw-b">{rawB.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {valueAdjustment && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Adjusted Total</p>
                <div className="flex items-center justify-between">
                  <div className="text-center flex-1">
                    <p className="text-xs text-muted-foreground">Side A</p>
                    <p className="text-lg font-bold" data-testid="text-analysis-adj-a">{Math.round(finalA).toLocaleString()}</p>
                  </div>
                  <span className="text-muted-foreground text-xs">vs</span>
                  <div className="text-center flex-1">
                    <p className="text-xs text-muted-foreground">Side B</p>
                    <p className="text-lg font-bold" data-testid="text-analysis-adj-b">{Math.round(finalB).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Verdict</p>
              <div className="flex flex-col items-center gap-2">
                <Badge className={fairnessColor} data-testid="badge-fairness">
                  {fairnessLabel}
                </Badge>
                {diff > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="text-diff">
                    {Math.round(diff).toLocaleString()} ({diffPct.toFixed(1)}%) in favor of Side {winnerSide}
                  </p>
                )}
              </div>
              {diffPct > 12 && (
                <p className="text-xs text-muted-foreground mt-2" data-testid="text-counter-suggestion">
                  Add ~{Math.round(diff).toLocaleString()} value to Side {loserSide} to balance
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-4">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Target className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
            Position Impact
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        {!league || !userTeam ? (
          <p className="text-xs text-muted-foreground py-4 text-center" data-testid="text-no-league-impact">
            Load a league to see position impact analysis
          </p>
        ) : positionImpact && (sideA.length > 0 || sideB.length > 0) ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-position-impact">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Position</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Before</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">After</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Change</th>
                </tr>
              </thead>
              <tbody>
                {positionImpact.map((row) => (
                  <tr key={row.pos} className="border-b border-border/20">
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] w-7 justify-center ${getPositionColor(row.pos)}`}>{row.pos}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">{row.before.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{row.after.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={cn(
                        "font-semibold",
                        row.change > 0 && "text-emerald-600 dark:text-emerald-400",
                        row.change < 0 && "text-red-600 dark:text-red-400",
                        row.change === 0 && "text-muted-foreground"
                      )}>
                        {row.change > 0 ? "+" : ""}{row.change.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-4 text-center" data-testid="text-empty-impact">
            Add assets to both sides to see position impact on your team
          </p>
        )}
      </Card>
    </div>
  );
}

export function TradeDatabase({ league }: { league: League }) {
  const { valuesBySleeperId } = useValueModel();
  const sleeper = useSleeper();
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState("all");
  const [scoringFilter, setScoringFilter] = useState("all");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const crawlStatus = useQuery<CrawlStatus>({
    queryKey: ["/api/crawler/status"],
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "running" ? 5000 : 30000;
    },
  });

  const tradeStats = useQuery<{
    totalTrades: number;
    totalLeagues: number;
    formatBreakdown: Array<{ format: string; count: number }>;
    scoringBreakdown: Array<{ scoring: string; count: number }>;
    seasonBreakdown: Array<{ season: string; count: number }>;
  }>({
    queryKey: ["/api/trades/stats"],
    refetchInterval: crawlStatus.data?.status === "running" ? 10000 : 60000,
  });

  const tradesQuery = useQuery<{
    trades: TradeRecord[];
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ["/api/trades/search", searchQuery, formatFilter, scoringFilter, seasonFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("q", searchQuery);
      if (formatFilter !== "all") params.set("format", formatFilter);
      if (scoringFilter !== "all") params.set("scoring", scoringFilter);
      if (seasonFilter !== "all") params.set("season", seasonFilter);
      params.set("page", String(page));
      params.set("limit", String(LIMIT));
      const res = await fetch(`/api/trades/search?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch trades");
      return res.json();
    },
    refetchInterval: crawlStatus.data?.status === "running" ? 15000 : false,
  });

  const startMutation = useMutation({
    mutationFn: async (username: string) => {
      const res = await apiRequest("POST", "/api/crawler/start", { username });
      return res.json();
    },
    onSuccess: () => {
      crawlStatus.refetch();
      tradeStats.refetch();
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/crawler/pause");
      return res.json();
    },
    onSuccess: () => crawlStatus.refetch(),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/crawler/resume");
      return res.json();
    },
    onSuccess: () => crawlStatus.refetch(),
  });

  const status = crawlStatus.data;
  const stats = tradeStats.data;
  const totalPages = tradesQuery.data ? Math.ceil(tradesQuery.data.total / LIMIT) : 0;

  const seedUsername = sleeper.user?.username || "Makitrain";

  const getPlayerValueById = (sleeperId: string) => {
    return valuesBySleeperId[sleeperId] || 0;
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    setPage(1);
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Trade Database"
        subtitle="Real dynasty trades crawled from the Sleeper network"
      />

      <Card className="p-5" data-testid="crawler-status-card">
        <div className="mb-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Database className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
            Network Crawler
          </h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Status:</span>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                status?.status === "running" && "border-emerald-500 text-emerald-600",
                status?.status === "paused" && "border-amber-500 text-amber-600",
                status?.status === "completed" && "border-blue-500 text-blue-600",
                status?.status === "idle" && "border-muted-foreground"
              )}
              data-testid="badge-crawler-status"
            >
              {status?.status === "running" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              {(status?.status || "idle").charAt(0).toUpperCase() + (status?.status || "idle").slice(1)}
            </Badge>
          </div>

          {status?.status === "idle" && (
            <Button
              size="sm"
              className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white"
              onClick={() => startMutation.mutate(seedUsername)}
              disabled={startMutation.isPending}
              data-testid="button-start-crawler"
            >
              {startMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
              Start Crawling from {seedUsername}
            </Button>
          )}

          {status?.status === "running" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
              data-testid="button-pause-crawler"
            >
              <Pause className="w-3 h-3 mr-1" /> Pause
            </Button>
          )}

          {status?.status === "paused" && (
            <Button
              size="sm"
              className="bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
              data-testid="button-resume-crawler"
            >
              <Play className="w-3 h-3 mr-1" /> Resume
            </Button>
          )}
        </div>

        {status && status.status !== "idle" && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Trades", value: status.tradesCollected.toLocaleString(), testId: "stat-trades" },
              { label: "Leagues Crawled", value: `${status.leaguesCrawled} / ${status.leaguesDiscovered}`, testId: "stat-leagues" },
              { label: "Users Found", value: status.usersDiscovered.toLocaleString(), testId: "stat-users" },
              { label: "Current Degree", value: status.currentDegree, testId: "stat-degree" },
              { label: "Max Degree", value: status.maxDegree, testId: "stat-max-degree" },
            ].map((s) => (
              <div key={s.label} className="text-center p-2 bg-muted/30 rounded-md" data-testid={s.testId}>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {status?.status === "running" && status.leaguesDiscovered > 0 && (
          <div className="mt-3">
            <div className="w-full bg-muted/50 rounded-full h-2">
              <div
                className="bg-[#0b3a7a] h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (status.leaguesCrawled / status.leaguesDiscovered) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {Math.round((status.leaguesCrawled / status.leaguesDiscovered) * 100)}% of discovered leagues crawled
            </p>
          </div>
        )}
      </Card>

      {stats && stats.totalTrades > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4 text-center" data-testid="stat-total-trades">
            <p className="text-2xl font-bold text-foreground">{stats.totalTrades.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Total Trades</p>
          </Card>
          <Card className="p-4 text-center" data-testid="stat-total-leagues">
            <p className="text-2xl font-bold text-foreground">{stats.totalLeagues.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Leagues Crawled</p>
          </Card>
          <Card className="p-4" data-testid="stat-format-breakdown">
            <p className="text-xs text-muted-foreground mb-1">By Format</p>
            <div className="flex flex-wrap gap-1">
              {stats.formatBreakdown.map((f) => (
                <Badge key={f.format} variant="secondary" className="text-xs">
                  {f.format || "?"}: {f.count}
                </Badge>
              ))}
            </div>
          </Card>
          <Card className="p-4" data-testid="stat-scoring-breakdown">
            <p className="text-xs text-muted-foreground mb-1">By Scoring</p>
            <div className="flex flex-wrap gap-1">
              {stats.scoringBreakdown.map((s) => (
                <Badge key={s.scoring} variant="secondary" className="text-xs">
                  {s.scoring || "?"}: {s.count}
                </Badge>
              ))}
            </div>
          </Card>
        </div>
      )}

      <Card className="p-5">
        <div className="mb-4">
          <h3 className="text-base font-bold">Browse Trades</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
        </div>

        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search player, team, or owner..."
              className="pl-8 h-8 text-sm"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              data-testid="input-trade-search"
            />
          </div>

          <Select value={formatFilter} onValueChange={(v) => { setFormatFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[100px] h-8 text-xs" data-testid="select-format-filter">
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Formats</SelectItem>
              <SelectItem value="SF">Superflex</SelectItem>
              <SelectItem value="1QB">1QB</SelectItem>
            </SelectContent>
          </Select>

          <Select value={scoringFilter} onValueChange={(v) => { setScoringFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[110px] h-8 text-xs" data-testid="select-scoring-filter">
              <SelectValue placeholder="Scoring" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Scoring</SelectItem>
              <SelectItem value="PPR">PPR</SelectItem>
              <SelectItem value="Half">Half PPR</SelectItem>
              <SelectItem value="Standard">Standard</SelectItem>
            </SelectContent>
          </Select>

          {stats?.seasonBreakdown && stats.seasonBreakdown.length > 1 && (
            <Select value={seasonFilter} onValueChange={(v) => { setSeasonFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[110px] h-8 text-xs" data-testid="select-season-filter">
                <SelectValue placeholder="Season" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Seasons</SelectItem>
                {stats.seasonBreakdown.map((s) => (
                  <SelectItem key={s.season} value={s.season}>{s.season}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {tradesQuery.isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse bg-muted/30 rounded-lg h-32" />
            ))}
          </div>
        )}

        {!tradesQuery.isLoading && (!tradesQuery.data || tradesQuery.data.trades.length === 0) && (
          <div className="text-center py-12">
            <ArrowRightLeft className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {stats?.totalTrades === 0
                ? "No trades collected yet. Start the crawler to begin collecting trades from the Sleeper network."
                : "No trades match your filters."}
            </p>
          </div>
        )}

        {tradesQuery.data && tradesQuery.data.trades.length > 0 && (
          <div className="space-y-3">
            {tradesQuery.data.trades.map((trade) => (
              <TradeCard
                key={trade.tradeId}
                trade={trade}
                getPlayerValue={getPlayerValueById}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/30">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="w-3 h-3 mr-1" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground" data-testid="text-page-info">
              Page {page} of {totalPages} ({tradesQuery.data?.total.toLocaleString()} trades)
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              data-testid="button-next-page"
            >
              Next <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function TradeCard({
  trade,
  getPlayerValue,
  formatDate,
}: {
  trade: TradeRecord;
  getPlayerValue: (sleeperId: string) => number;
  formatDate: (ts: number) => string;
}) {
  const sideValues = trade.sides.map((side) => {
    const playerValue = side.playersReceived.reduce((sum, p) => sum + getPlayerValue(p.sleeperId), 0);
    const pickValue = side.picksReceived.reduce((sum, p) => {
      return sum + getStaticPickValue(parseInt(p.season) || 2026, p.round, "mid");
    }, 0);
    return playerValue + pickValue;
  });

  const maxValue = sideValues.length > 0 ? Math.max(...sideValues) : 0;

  return (
    <Card className="p-4 hover:border-[#d4af37]/30 transition-colors" data-testid={`trade-card-${trade.tradeId}`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Badge variant="outline" className="text-[10px]">{trade.leagueFormat}</Badge>
        <Badge variant="outline" className="text-[10px]">{trade.leagueScoringFormat}</Badge>
        <Badge variant="outline" className="text-[10px]">{trade.leagueTotalRosters}-team</Badge>
        <Badge variant="secondary" className="text-[10px]">{trade.season} Wk {trade.week}</Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">{formatDate(trade.timestamp)}</span>
      </div>

      <div className={cn(
        "grid gap-4",
        trade.sides.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
      )}>
        {trade.sides.map((side, idx) => {
          const sideTotal = sideValues[idx];
          const isWinner = sideValues.length > 1 && sideTotal === maxValue && sideValues.filter(v => v === maxValue).length === 1;

          return (
            <div
              key={side.rosterId}
              className={cn(
                "p-3 rounded-lg border",
                isWinner ? "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10" : "border-border/30 bg-muted/10"
              )}
              data-testid={`trade-side-${side.rosterId}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold" data-testid={`text-team-name-${side.rosterId}`}>{side.teamName}</p>
                  <p className="text-[10px] text-muted-foreground">{side.ownerName} receives:</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold" data-testid={`text-side-total-${side.rosterId}`}>{sideTotal.toLocaleString()}</p>
                  {isWinner && (
                    <Badge variant="outline" className="text-[9px] border-emerald-500 text-emerald-600">Value Winner</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                {side.playersReceived.map((p, pi) => {
                  const val = getPlayerValue(p.sleeperId);
                  return (
                    <div key={pi} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] w-7 justify-center ${getPositionColor(p.pos)}`}>
                          {p.pos}
                        </Badge>
                        <span className="text-xs font-medium" data-testid={`text-player-name-${p.sleeperId}`}>{p.name}</span>
                        {p.team && <span className="text-[10px] text-muted-foreground">{p.team}</span>}
                      </div>
                      {val > 0 && <span className="text-[10px] text-muted-foreground" data-testid={`text-player-value-${p.sleeperId}`}>{val.toLocaleString()}</span>}
                    </div>
                  );
                })}

                {side.picksReceived.map((p, pi) => {
                  const val = getStaticPickValue(parseInt(p.season) || 2026, p.round, "mid");
                  return (
                    <div key={`pick-${pi}`} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] w-7 justify-center bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400">
                          PK
                        </Badge>
                        <span className="text-xs font-medium">
                          {p.season} Round {p.round}
                        </span>
                        {p.originalOwnerName && p.originalOwnerName !== "Unknown" && (
                          <span className="text-[10px] text-muted-foreground">({p.originalOwnerName}'s)</span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{val.toLocaleString()}</span>
                    </div>
                  );
                })}

                {side.playersReceived.length === 0 && side.picksReceived.length === 0 && (
                  <p className="text-[10px] text-muted-foreground italic">No assets recorded</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {trade.leagueName && (
        <p className="text-[10px] text-muted-foreground mt-2 truncate" data-testid={`trade-league-name-${trade.tradeId}`}>
          {trade.leagueName}
        </p>
      )}
    </Card>
  );
}
