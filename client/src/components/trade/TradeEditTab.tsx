import { useState, useEffect } from "react";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { TradeSidePanel, type PanelAssets } from "./TradeSidePanel";
import type { NormalizedTrade, AssetPlayer, AssetPick } from "./TradeActionModal";

const SLEEPER_API = "https://api.sleeper.app/v1";

async function jsonFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Extended assets (players + picks + FAAB) ─────────────────────────────────

export interface EditAssetsWithFaab {
  players: AssetPlayer[];
  picks: AssetPick[];
  faab: number;
}

interface TradeEditTabProps {
  trade: NormalizedTrade;
  myUserId: string;
  valuesBySleeperId: Record<string, number>;
  onAssetsChange: (myReceive: EditAssetsWithFaab, myGive: EditAssetsWithFaab) => void;
  initialMyReceive?: EditAssetsWithFaab;
  initialMyGive?: EditAssetsWithFaab;
}

// ─── TradeEditTab ─────────────────────────────────────────────────────────────

export function TradeEditTab({
  trade, myUserId, valuesBySleeperId,
  onAssetsChange,
  initialMyReceive,
  initialMyGive,
}: TradeEditTabProps) {
  // Hydrate from initial (pre-selected from existing trade)
  const [myReceive, setMyReceive] = useState<EditAssetsWithFaab>(() =>
    initialMyReceive ?? {
      players: [...trade.iGet.players],
      picks: [...trade.iGet.picks],
      faab: trade.iGet.faab,
    }
  );
  const [myGive, setMyGive] = useState<EditAssetsWithFaab>(() =>
    initialMyGive ?? {
      players: [...trade.iGive.players],
      picks: [...trade.iGive.picks],
      faab: trade.iGive.faab,
    }
  );

  // Roster data fetched from Sleeper
  const [myRoster, setMyRoster] = useState<AssetPlayer[]>([]);
  const [partnerRoster, setPartnerRoster] = useState<AssetPlayer[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);

  // Picks from the original trade (available to select/deselect)
  // These come from trade.iGet.picks and trade.iGive.picks
  const [availableReceivePicks] = useState<AssetPick[]>(() => [...trade.iGet.picks]);
  const [availableGivePicks] = useState<AssetPick[]>(() => [...trade.iGive.picks]);

  // Report initial assets to parent immediately
  useEffect(() => {
    onAssetsChange(
      initialMyReceive ?? { players: [...trade.iGet.players], picks: [...trade.iGet.picks], faab: trade.iGet.faab },
      initialMyGive ?? { players: [...trade.iGive.players], picks: [...trade.iGive.picks], faab: trade.iGive.faab },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch rosters + player DB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rostersRaw, playersDb] = await Promise.all([
          jsonFetch<any[]>(`${SLEEPER_API}/league/${trade.leagueId}/rosters`),
          getSleeperPlayers(),
        ]);
        if (cancelled) return;

        const enrich = (ids: string[]): AssetPlayer[] =>
          ids
            .map((pid) => {
              const info = playersDb[pid];
              if (!info) return null;
              const name =
                info.full_name ||
                `${info.first_name || ""} ${info.last_name || ""}`.trim();
              if (!name) return null;
              return {
                playerId: pid,
                name,
                pos: info.position || "?",
                team: info.team || "FA",
                value: valuesBySleeperId[pid] || 0,
              } as AssetPlayer;
            })
            .filter(Boolean) as AssetPlayer[];

        for (const r of rostersRaw) {
          const ids: string[] = r.players || [];
          if (r.owner_id === myUserId) {
            setMyRoster(enrich(ids).sort((a, b) => b.value - a.value));
          }
          if (r.roster_id === trade.partnerRosterId) {
            setPartnerRoster(enrich(ids).sort((a, b) => b.value - a.value));
          }
        }
      } catch { /* roster load failures are non-fatal */ }
      if (!cancelled) setRosterLoading(false);
    })();
    return () => { cancelled = true; };
  }, [trade.leagueId, trade.partnerRosterId, myUserId, valuesBySleeperId]);

  // ── Updaters ──────────────────────────────────────────────────────────────

  const updateReceive = (next: EditAssetsWithFaab) => {
    setMyReceive(next);
    onAssetsChange(next, myGive);
  };

  const updateGive = (next: EditAssetsWithFaab) => {
    setMyGive(next);
    onAssetsChange(myReceive, next);
  };

  // ── Receive side handlers ─────────────────────────────────────────────────

  const handleReceiveTogglePlayer = (player: AssetPlayer) => {
    const already = myReceive.players.some((p) => p.playerId === player.playerId);
    updateReceive({
      ...myReceive,
      players: already
        ? myReceive.players.filter((p) => p.playerId !== player.playerId)
        : [...myReceive.players, player],
    });
  };

  const handleReceiveTogglePick = (pick: AssetPick) => {
    const key = pickKey(pick);
    const already = myReceive.picks.some((p) => pickKey(p) === key);
    updateReceive({
      ...myReceive,
      picks: already
        ? myReceive.picks.filter((p) => pickKey(p) !== key)
        : [...myReceive.picks, pick],
    });
  };

  // ── Give side handlers ────────────────────────────────────────────────────

  const handleGiveTogglePlayer = (player: AssetPlayer) => {
    const already = myGive.players.some((p) => p.playerId === player.playerId);
    updateGive({
      ...myGive,
      players: already
        ? myGive.players.filter((p) => p.playerId !== player.playerId)
        : [...myGive.players, player],
    });
  };

  const handleGiveTogglePick = (pick: AssetPick) => {
    const key = pickKey(pick);
    const already = myGive.picks.some((p) => pickKey(p) === key);
    updateGive({
      ...myGive,
      picks: already
        ? myGive.picks.filter((p) => pickKey(p) !== key)
        : [...myGive.picks, pick],
    });
  };

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 sm:px-6 py-3 sm:py-4 overflow-y-auto flex-1 min-h-0">
      {/* You Receive — browse partner's roster */}
      <TradeSidePanel
        label="You Receive"
        assets={myReceive}
        rosterPlayers={partnerRoster}
        availablePicks={availableReceivePicks}
        rosterLoading={rosterLoading}
        onTogglePlayer={handleReceiveTogglePlayer}
        onTogglePick={(pk) => handleReceiveTogglePick(pk)}
        onFaabChange={(faab) => updateReceive({ ...myReceive, faab })}
        testIdPrefix="trade-edit-receive"
      />

      {/* You Give — browse your own roster */}
      <TradeSidePanel
        label="You Give"
        assets={myGive}
        rosterPlayers={myRoster}
        availablePicks={availableGivePicks}
        rosterLoading={rosterLoading}
        onTogglePlayer={handleGiveTogglePlayer}
        onTogglePick={(pk) => handleGiveTogglePick(pk)}
        onFaabChange={(faab) => updateGive({ ...myGive, faab })}
        testIdPrefix="trade-edit-give"
      />
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function pickKey(p: AssetPick): string {
  return `${p.season}-${p.round}-${p.originalRosterId ?? ""}`;
}
