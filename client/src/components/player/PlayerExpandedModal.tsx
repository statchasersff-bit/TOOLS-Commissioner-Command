/**
 * PlayerExpandedModal — animated, accessible player detail modal.
 *
 * Opened from a player card; renders the player's image, identity, overall
 * grade, composite scores, and grouped advanced stats. Animates in/out with
 * Framer Motion (wrap the render site in <AnimatePresence>). Closes on the X
 * button, Escape, or a click outside the panel.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { type StatPosition, type ColDef, SCORE_ENGINES } from "@/lib/advancedStatsMeta";
import { CompositeScoreGrid } from "./CompositeScoreGrid";
import { AdvancedStatsPanel } from "./AdvancedStatsPanel";

export interface ExpandedPlayer {
  name: string;
  team: string;
  posLabel: string;                       // display position (QB/RB/WR/TE/K/DEF)
  age: number;
  sleeperId: string | null;
  dynVal: number;
  rdVal: number;
  statPos: StatPosition | null;           // null = no advanced stats (e.g. K/DEF)
  scores: Record<string, number> | null;
  row: Record<string, unknown> | null;
  columns: ColDef[] | null;
}

// Position-coloured border accents.
const POS_ACCENT: Record<string, string> = {
  QB: "#f87171", RB: "#34d399", WR: "#38bdf8", TE: "#fbbf24", K: "#94a3b8", DEF: "#fb923c",
};

export function PlayerExpandedModal({ player, onClose }: { player: ExpandedPlayer; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Escape to close, body scroll lock, focus management + a basic focus trap.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && contentRef.current) {
        const focusable = contentRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [onClose]);

  const accent = POS_ACCENT[player.posLabel] ?? "#d4af37";
  const categories = player.statPos ? SCORE_ENGINES[player.statPos].categories : [];
  const overallCat = categories[0];
  const subCats = categories.slice(1);
  const overall = player.scores && overallCat ? player.scores[overallCat.key] : null;
  const id = player.sleeperId;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${player.name} details`}
    >
      <motion.div
        ref={contentRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[1000px] max-h-[90vh] overflow-y-auto rounded-[20px] bg-[#080f1e]"
        style={{
          border: `1px solid ${accent}55`,
          boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 40px ${accent}22`,
        }}
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
      >
        {/* Close */}
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Close player details"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center bg-black/40 border border-white/10 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* ── Top section ── */}
        <div
          className="flex flex-col sm:flex-row gap-4 p-4 sm:p-6 border-b border-white/8"
          style={{ background: "linear-gradient(135deg, rgba(11,58,122,0.25), transparent)" }}
        >
          {/* Image */}
          <div className="relative w-28 h-28 sm:w-36 sm:h-36 mx-auto sm:mx-0 flex-shrink-0 rounded-2xl overflow-hidden bg-[#0b1628]">
            {player.team && (
              <img
                src={`https://sleepercdn.com/images/team_logos/nfl/${player.team.toLowerCase()}.png`}
                alt="" aria-hidden="true"
                className="absolute inset-0 w-full h-full object-contain p-4 opacity-20 scale-110 pointer-events-none"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            {id ? (
              <img
                src={`https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`}
                alt={player.name}
                className="relative w-full h-full object-cover object-top"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl font-black text-[#d4af37]/30">
                {player.name.charAt(0)}
              </div>
            )}
          </div>

          {/* Identity + value pills */}
          <div className="flex-1 min-w-0 flex flex-col justify-center text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded border"
                style={{ color: accent, borderColor: `${accent}66`, background: `${accent}1a` }}
              >
                {player.posLabel}
              </span>
              <span className="text-[11px] text-[#d4af37] font-semibold">{player.team || "FA"}</span>
              {player.age > 0 && <span className="text-[11px] text-muted-foreground">Age {player.age}</span>}
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white leading-tight truncate">{player.name}</h2>
            <div className="flex items-center justify-center sm:justify-start gap-2 mt-2">
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1">
                <span className="text-[9px] uppercase tracking-wider text-emerald-500/70 font-semibold">Dynasty </span>
                <span className="text-sm font-bold text-emerald-400 tabular-nums">
                  {player.dynVal > 0 ? Math.round(player.dynVal).toLocaleString() : "—"}
                </span>
              </div>
              <div className="rounded-lg bg-[#0b3a7a]/25 border border-[#0b3a7a]/40 px-3 py-1">
                <span className="text-[9px] uppercase tracking-wider text-blue-400/70 font-semibold">Win-Now </span>
                <span className="text-sm font-bold text-blue-400 tabular-nums">
                  {player.rdVal > 0 ? Math.round(player.rdVal).toLocaleString() : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Overall grade */}
          {overall != null && (
            <div className="flex flex-col items-center justify-center px-2 flex-shrink-0">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Overall</span>
              <span className="text-5xl font-black tabular-nums text-[#d4af37] leading-none">{overall}</span>
              <span className="text-[9px] text-muted-foreground mt-0.5">/ 100</span>
            </div>
          )}
        </div>

        {/* ── Composite scores ── */}
        {player.statPos && player.scores && subCats.length > 0 && (
          <div className="p-4 sm:p-6 border-b border-white/8">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3">Composite Scores</p>
            <CompositeScoreGrid categories={subCats} scores={player.scores} />
          </div>
        )}

        {/* ── Advanced stats ── */}
        {player.statPos && player.row && player.columns ? (
          <div className="p-4 sm:p-6">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3">Advanced Stats</p>
            <AdvancedStatsPanel position={player.statPos} columns={player.columns} row={player.row} />
          </div>
        ) : (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No advanced stats available for this position.
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
