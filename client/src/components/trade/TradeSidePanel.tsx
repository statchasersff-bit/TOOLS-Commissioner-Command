import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Loader2, DollarSign } from "lucide-react";
import {
  RosterPlayerRow, PickSelectRow,
  PlayerAssetCard, PickAssetCard, FaabAssetDisplay,
} from "./TradeAssetCard";
import type { AssetPlayer, AssetPick } from "./TradeActionModal";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PanelAssets {
  players: AssetPlayer[];
  picks: AssetPick[];
  faab: number;
}

interface TradeSidePanelProps {
  label: string;
  assets: PanelAssets;
  rosterPlayers: AssetPlayer[];
  availablePicks: AssetPick[];
  rosterLoading: boolean;
  onTogglePlayer: (player: AssetPlayer) => void;
  onTogglePick: (pick: AssetPick, idx: number) => void;
  onFaabChange: (amount: number) => void;
  testIdPrefix: string;
}

const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

// ─── TradeSidePanel ────────────────────────────────────────────────────────────

export function TradeSidePanel({
  label, assets, rosterPlayers, availablePicks, rosterLoading,
  onTogglePlayer, onTogglePick, onFaabChange, testIdPrefix,
}: TradeSidePanelProps) {
  const [search, setSearch] = useState("");

  const selectedPlayerIds = useMemo(
    () => new Set(assets.players.map((p) => p.playerId)),
    [assets.players],
  );

  const selectedPickKeys = useMemo(
    () => new Set(availablePicks.filter((_, i) => assets.picks.some((sp) => pickKey(sp) === pickKey(availablePicks[i]))).map(pickKey)),
    [assets.picks, availablePicks],
  );

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q.length >= 1
      ? rosterPlayers.filter((p) => p.name.toLowerCase().includes(q))
      : rosterPlayers;
    return [...base].sort((a, b) => {
      const pi = POS_ORDER.indexOf(a.pos);
      const pj = POS_ORDER.indexOf(b.pos);
      if (pi !== pj) return (pi === -1 ? 99 : pi) - (pj === -1 ? 99 : pj);
      return b.value - a.value;
    });
  }, [rosterPlayers, search]);

  const hasSelectedAssets =
    assets.players.length > 0 ||
    assets.picks.length > 0 ||
    assets.faab > 0;

  return (
    <div className="bg-white/[0.025] border border-white/[0.08] rounded-xl flex flex-col">
      {/* ── Panel header ── */}
      <div className="px-4 pt-3.5 pb-2 border-b border-white/[0.06]">
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">
          {label}
        </p>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">

        {/* Selected assets */}
        {hasSelectedAssets && (
          <div className="mb-3 space-y-0.5">
            {assets.players.map((p) => (
              <PlayerAssetCard
                key={p.playerId}
                player={p}
                onRemove={() => onTogglePlayer(p)}
              />
            ))}
            {assets.picks.map((pk, i) => (
              <PickAssetCard
                key={`${pk.season}-${pk.round}-${pk.originalRosterId}-${i}`}
                pick={pk}
                onRemove={() => {
                  const avIdx = availablePicks.findIndex((ap) => pickKey(ap) === pickKey(pk));
                  onTogglePick(pk, avIdx);
                }}
              />
            ))}
            {assets.faab > 0 && <FaabAssetDisplay amount={assets.faab} />}
          </div>
        )}

        {!hasSelectedAssets && (
          <p className="text-[12px] text-white/20 italic py-1 px-1 mb-2">Nothing selected</p>
        )}

        <div className="border-t border-white/[0.05] pt-2 space-y-3">

          {/* ── Available picks ── */}
          {availablePicks.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-white/25 uppercase tracking-widest mb-1 px-1">
                Picks
              </p>
              <div className="space-y-0.5">
                {availablePicks.map((pk, i) => {
                  const isSelected = assets.picks.some((sp) => pickKey(sp) === pickKey(pk));
                  return (
                    <PickSelectRow
                      key={`${pickKey(pk)}-${i}`}
                      pick={pk}
                      selected={isSelected}
                      onToggle={() => onTogglePick(pk, i)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* ── FAAB ── */}
          <div>
            <p className="text-[9px] font-semibold text-white/25 uppercase tracking-widest mb-1 px-1">
              FAAB
            </p>
            <div className="flex items-center gap-2 px-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400/60 flex-shrink-0" />
              <input
                type="number"
                min={0}
                max={9999}
                step={1}
                value={assets.faab || ""}
                onChange={(e) => onFaabChange(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0"
                className="w-20 bg-white/[0.04] border border-white/[0.08] rounded-md px-2 py-1 text-[12px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
                data-testid={`${testIdPrefix}-faab`}
              />
              <span className="text-[11px] text-white/25">FAAB</span>
            </div>
          </div>

          {/* ── Roster browser ── */}
          <div>
            <p className="text-[9px] font-semibold text-white/25 uppercase tracking-widest mb-1.5 px-1">
              Roster
            </p>
            {rosterLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-white/30" />
              </div>
            ) : (
              <>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search players…"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-[12px] text-white/70 placeholder:text-white/25 focus:outline-none focus:border-white/20 transition-colors mb-1.5"
                  data-testid={`${testIdPrefix}-search`}
                />
                <div className="space-y-0.5 max-h-52 overflow-y-auto scrollbar-hide">
                  {filteredRoster.length === 0 ? (
                    <p className="text-[11px] text-white/20 italic px-2 py-2">No players found</p>
                  ) : (
                    filteredRoster.map((p) => (
                      <RosterPlayerRow
                        key={p.playerId}
                        player={p}
                        selected={selectedPlayerIds.has(p.playerId)}
                        onToggle={() => onTogglePlayer(p)}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function pickKey(p: AssetPick): string {
  return `${p.season}-${p.round}-${p.originalRosterId ?? ""}`;
}
