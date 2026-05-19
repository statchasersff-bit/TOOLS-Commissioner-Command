import { useMemo, useState } from "react";
import { Users, AlertCircle, Sparkles } from "lucide-react";
import { PlayerCompareSearch } from "./PlayerCompareSearch";
import { StartSitPlayerCard } from "./StartSitPlayerCard";
import { PlayerWeeklyProfileDrawer } from "./PlayerWeeklyProfileDrawer";
import { useWeeklyPlayerProjections, type ScoringFormat } from "@/hooks/useWeeklyPlayerProjections";
import { derivePlayerComparison } from "@/lib/startSit";

const MAX_PLAYERS = 3;

interface Props {
  defaultWeek?: number;
}

export function StartSitCompareTab({ defaultWeek = 1 }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [week, setWeek] = useState<number>(defaultWeek);
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>("ppr");
  const [capWarning, setCapWarning] = useState<string | null>(null);
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);

  const { players } = useWeeklyPlayerProjections({
    playerIds: selectedIds,
    week,
    scoringFormat,
  });

  // Build averages for relative recommendation logic.
  const derived = useMemo(() => {
    const allAverages = players.map((p) => {
      const nums = p.projections
        .map((s) => s.projectedPoints)
        .filter((n): n is number => typeof n === "number");
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    });
    return players.map((p) => ({
      player: p,
      ...derivePlayerComparison(p, allAverages),
    }));
  }, [players]);

  // Best Start = highest average projection.
  const bestStartId = useMemo(() => {
    if (derived.length < 2) return null;
    let best: { id: string; avg: number } | null = null;
    for (const d of derived) {
      if (d.averageProjection == null) continue;
      if (!best || d.averageProjection > best.avg) {
        best = { id: d.player.playerId, avg: d.averageProjection };
      }
    }
    return best?.id ?? null;
  }, [derived]);

  function handleAdd(id: string) {
    if (selectedIds.length >= MAX_PLAYERS) {
      flashCapWarning();
      return;
    }
    if (selectedIds.includes(id)) return;
    setSelectedIds((prev) => [...prev, id]);
  }

  function flashCapWarning() {
    setCapWarning(`You can compare up to ${MAX_PLAYERS} players at once.`);
    window.setTimeout(() => setCapWarning(null), 3000);
  }

  function handleRemove(id: string) {
    setSelectedIds((prev) => prev.filter((p) => p !== id));
    if (openPlayerId === id) setOpenPlayerId(null);
  }

  function handleClear() {
    setSelectedIds([]);
    setOpenPlayerId(null);
  }

  const openDerived = openPlayerId
    ? derived.find((d) => d.player.playerId === openPlayerId) ?? null
    : null;

  return (
    <div className="space-y-4" data-testid="start-sit-compare-tab">
      <PlayerCompareSearch
        selectedPlayerIds={selectedIds}
        onAdd={handleAdd}
        onRemove={handleRemove}
        onClear={handleClear}
        week={week}
        onWeekChange={setWeek}
        scoringFormat={scoringFormat}
        onScoringFormatChange={setScoringFormat}
        maxPlayers={MAX_PLAYERS}
        onCapHit={flashCapWarning}
      />

      {capWarning && (
        <div
          className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/8 px-4 py-2.5 text-[12px] text-rose-200"
          role="status"
          data-testid="cap-warning"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{capWarning}</span>
        </div>
      )}

      {selectedIds.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Compare your toughest start/sit calls"
          body={`Search up to ${MAX_PLAYERS} players to compare weekly start/sit decisions.`}
        />
      ) : selectedIds.length === 1 ? (
        <>
          <ComparisonGrid
            derived={derived}
            bestStartId={bestStartId}
            onOpen={(id) => setOpenPlayerId(id)}
            onRemove={handleRemove}
          />
          <EmptyState
            icon={Sparkles}
            title="Add another player to compare"
            body="Use the search above to bring in a second or third player."
            subtle
          />
        </>
      ) : (
        <ComparisonGrid
          derived={derived}
          bestStartId={bestStartId}
          onOpen={(id) => setOpenPlayerId(id)}
          onRemove={handleRemove}
        />
      )}

      <PlayerWeeklyProfileDrawer
        open={openPlayerId != null && openDerived != null}
        onClose={() => setOpenPlayerId(null)}
        player={openDerived?.player ?? null}
        averageProjection={openDerived?.averageProjection ?? null}
        highProjection={openDerived?.highProjection ?? null}
        lowProjection={openDerived?.lowProjection ?? null}
        recommendation={openDerived?.recommendation ?? "Toss-Up"}
        confidence={openDerived?.confidence ?? 0}
        risk={openDerived?.risk ?? "medium"}
      />
    </div>
  );
}

function ComparisonGrid({
  derived,
  bestStartId,
  onOpen,
  onRemove,
}: {
  derived: Array<{
    player: import("@/data/mockStartSitProjections").MockPlayerWeekly;
    averageProjection: number | null;
    highProjection: number | null;
    lowProjection: number | null;
    projectionRange: number | null;
    recommendation: import("@/lib/startSit").StartSitRecommendation;
    confidence: number;
    risk: import("@/lib/startSit").RiskLevel;
  }>;
  bestStartId: string | null;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 overflow-x-auto snap-x snap-mandatory md:snap-none"
      data-testid="comparison-grid"
    >
      {derived.map((d) => (
        <div key={d.player.playerId} className="snap-center md:snap-align-none min-w-0">
          <StartSitPlayerCard
            player={d.player}
            averageProjection={d.averageProjection}
            highProjection={d.highProjection}
            lowProjection={d.lowProjection}
            projectionRange={d.projectionRange}
            recommendation={d.recommendation}
            confidence={d.confidence}
            bestStart={bestStartId === d.player.playerId}
            onOpen={() => onOpen(d.player.playerId)}
            onRemove={() => onRemove(d.player.playerId)}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  subtle,
}: {
  icon: typeof Users;
  title: string;
  body: string;
  subtle?: boolean;
}) {
  return (
    <div
      className={
        subtle
          ? "rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-4 py-6 flex items-center gap-3"
          : "rounded-2xl border border-white/8 bg-gradient-to-b from-[#0a1628] to-[#06101e] px-4 py-10 flex flex-col items-center text-center"
      }
      data-testid="empty-state"
    >
      <Icon
        className={
          subtle
            ? "w-5 h-5 text-white/35 flex-shrink-0"
            : "w-8 h-8 text-white/20 mb-3"
        }
      />
      <div className={subtle ? "flex-1 min-w-0" : ""}>
        <div className={subtle ? "text-[12px] font-semibold text-white/65" : "text-sm font-bold text-white/65"}>
          {title}
        </div>
        <div className={subtle ? "text-[11px] text-white/35 mt-0.5" : "text-xs text-white/40 mt-1 max-w-sm"}>
          {body}
        </div>
      </div>
    </div>
  );
}
