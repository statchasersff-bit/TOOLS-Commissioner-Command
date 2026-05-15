import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import type { AssetPlayer, AssetPick } from "./TradeActionModal";

function posColor(pos: string): string {
  switch (pos) {
    case "QB": return "text-red-400";
    case "RB": return "text-emerald-400";
    case "WR": return "text-blue-400";
    case "TE": return "text-yellow-400";
    default:   return "text-white/40";
  }
}

export function PlayerAssetCard({
  player, onRemove,
}: { player: AssetPlayer; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 py-1 group">
      <PlayerAvatar
        id={player.playerId} name={player.name}
        pos={player.pos} team={player.team}
        size="sm" compact
      />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-white/90 leading-tight truncate">{player.name}</p>
        <p className="text-[10px] font-bold uppercase">
          <span className={posColor(player.pos)}>{player.pos}</span>
          <span className="text-white/40"> · {player.team}</span>
        </p>
      </div>
      {player.value > 0 && (
        <span className="text-[11px] text-white/30 tabular-nums flex-shrink-0">
          {player.value.toLocaleString()}
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all flex-shrink-0 ml-0.5"
          aria-label="Remove"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function PickAssetCard({
  pick, onRemove,
}: { pick: AssetPick; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 py-1 group">
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold",
        pick.isStartup ? "bg-violet-500/20 text-violet-400" : "bg-purple-500/20 text-purple-400",
      )}>
        {pick.isStartup ? "SU" : `R${pick.round}`}
      </div>
      <span className="text-[13px] text-white/85 flex-1 truncate">{pick.label}</span>
      {pick.value > 0 && (
        <span className="text-[11px] text-white/30 tabular-nums flex-shrink-0">
          {pick.value.toLocaleString()}
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all flex-shrink-0 ml-0.5"
          aria-label="Remove"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function FaabAssetDisplay({ amount }: { amount: number }) {
  if (!amount) return null;
  return (
    <div className="flex items-center gap-2.5 py-1">
      <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-emerald-400">
        $
      </div>
      <span className="text-[13px] text-white/85">${amount} FAAB</span>
    </div>
  );
}

// ─── Selectable player row for roster browser ──────────────────────────────────

export function RosterPlayerRow({
  player, selected, onToggle,
}: { player: AssetPlayer; selected: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors",
        selected
          ? "bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-red-500/10 hover:border-red-500/30"
          : "hover:bg-white/[0.05] border border-transparent",
      )}
    >
      <span className={cn("text-[9px] font-bold flex-shrink-0 w-6 text-center", posColor(player.pos))}>
        {player.pos}
      </span>
      <span className={cn("text-[12px] flex-1 truncate", selected ? "text-[#d4af37]/80 font-semibold" : "text-white/75")}>
        {player.name}
      </span>
      <span className="text-[10px] text-white/25 tabular-nums flex-shrink-0">
        {player.value > 0 ? player.value.toLocaleString() : "—"}
      </span>
      {selected && <X className="w-3 h-3 text-red-400/60 flex-shrink-0" />}
    </button>
  );
}

// ─── Selectable pick row ───────────────────────────────────────────────────────

export function PickSelectRow({
  pick, selected, onToggle,
}: { pick: AssetPick; selected: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors",
        selected
          ? "bg-[#d4af37]/10 border border-[#d4af37]/30 hover:bg-red-500/10 hover:border-red-500/30"
          : "hover:bg-white/[0.05] border border-transparent",
      )}
    >
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[8px] font-bold",
        pick.isStartup ? "bg-violet-500/20 text-violet-400" : "bg-purple-500/20 text-purple-400",
      )}>
        {pick.isStartup ? "SU" : `R${pick.round}`}
      </div>
      <span className={cn("text-[12px] flex-1 truncate", selected ? "text-[#d4af37]/80 font-semibold" : "text-white/75")}>
        {pick.label}
      </span>
      {pick.value > 0 && (
        <span className="text-[10px] text-white/25 tabular-nums flex-shrink-0">{pick.value.toLocaleString()}</span>
      )}
      {selected && <X className="w-3 h-3 text-red-400/60 flex-shrink-0" />}
    </button>
  );
}
