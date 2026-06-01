import { cn } from "@/lib/utils";

/**
 * Draft tendencies + positional bias for a manager, aggregated across every
 * visible dynasty draft (startup + each season's rookie draft). Rendered inside
 * a SectionCard on the League tab. Mirrors the server `DraftProfile` shape from
 * server/managerIntel.ts.
 */

type CorePos = "QB" | "RB" | "WR" | "TE";

export interface DraftProfile {
  available: boolean;
  draftsAnalyzed: number;
  totalPicksAnalyzed: number;
  truncated: boolean;
  heatmap: Array<{ round: number; QB: number; RB: number; WR: number; TE: number }>;
  positionalBias: Array<{ position: CorePos; userPct: number; leagueAvgPct: number; difference: number }>;
  tendencyAnalysis: string;
  biasAnalysis: string;
  note: string;
}

const POSITIONS: CorePos[] = ["QB", "RB", "WR", "TE"];

// RGB triples so we can scale alpha with the cell's percentage.
const POS_RGB: Record<CorePos, string> = {
  QB: "239, 68, 68", // red-500
  RB: "16, 185, 129", // emerald-500
  WR: "56, 130, 246", // blue-500
  TE: "245, 158, 11", // amber-500
};

function heatStyle(pct: number, pos: CorePos): React.CSSProperties {
  if (pct <= 0) return { backgroundColor: "rgba(255,255,255,0.02)" };
  const alpha = 0.14 + (pct / 100) * 0.62;
  return { backgroundColor: `rgba(${POS_RGB[pos]}, ${alpha.toFixed(3)})` };
}

function DraftHeatmap({ rows }: { rows: DraftProfile["heatmap"] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45 mb-2">
        Position by round
      </div>
      {/* Header */}
      <div className="grid grid-cols-[2.2rem_repeat(4,1fr)] gap-1 mb-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/35 flex items-end">Rd</div>
        {POSITIONS.map((p) => (
          <div key={p} className="text-[10px] font-bold uppercase tracking-wider text-center text-white/55">
            {p}
          </div>
        ))}
      </div>
      <div className="space-y-1">
        {rows.map((row) => {
          const max = Math.max(row.QB, row.RB, row.WR, row.TE);
          return (
            <div key={row.round} className="grid grid-cols-[2.2rem_repeat(4,1fr)] gap-1">
              <div className="text-[11px] font-bold text-white/45 flex items-center">{row.round}</div>
              {POSITIONS.map((p) => {
                const pct = row[p];
                const isMax = pct > 0 && pct === max;
                return (
                  <div
                    key={p}
                    style={heatStyle(pct, p)}
                    className={cn(
                      "h-7 rounded flex items-center justify-center text-[11px] font-semibold tabular-nums transition-colors",
                      pct >= 55 ? "text-white" : "text-white/70",
                      isMax && "ring-1 ring-inset ring-white/40",
                    )}
                    data-testid={`heat-r${row.round}-${p}`}
                  >
                    {pct > 0 ? `${pct}%` : "·"}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PositionalBias({ rows }: { rows: DraftProfile["positionalBias"] }) {
  if (rows.length === 0) return null;
  // Scale bar widths against the largest absolute gap so the comparison reads
  // clearly even when every lean is modest.
  const maxAbs = Math.max(4, ...rows.map((r) => Math.abs(r.difference)));
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-white/45 mb-2">
        Draft mix vs league average
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const over = r.difference >= 0;
          const widthPct = Math.min(100, (Math.abs(r.difference) / maxAbs) * 50);
          return (
            <div key={r.position} className="flex items-center gap-2" data-testid={`bias-${r.position}`}>
              <div className="w-7 text-[11px] font-bold text-white/70 flex-shrink-0">{r.position}</div>
              {/* Diverging bar: center line is the league average. */}
              <div className="relative flex-1 h-5 rounded bg-white/[0.04] overflow-hidden">
                <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
                <div
                  className={cn(
                    "absolute inset-y-0.5 rounded-sm",
                    over ? "bg-emerald-500/55" : "bg-rose-500/55",
                  )}
                  style={
                    over
                      ? { left: "50%", width: `${widthPct}%` }
                      : { right: "50%", width: `${widthPct}%` }
                  }
                />
              </div>
              <div
                className={cn(
                  "w-12 text-right text-[11px] font-bold tabular-nums flex-shrink-0",
                  Math.abs(r.difference) < 2 ? "text-white/45" : over ? "text-emerald-300" : "text-rose-300",
                )}
              >
                {over ? "+" : ""}
                {r.difference}
              </div>
              <div className="w-20 text-right text-[10px] text-white/40 tabular-nums flex-shrink-0 hidden sm:block">
                {r.userPct}% / {r.leagueAvgPct}%
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[9.5px] text-white/30 mt-1.5 text-right hidden sm:block">
        you% / league avg%
      </div>
    </div>
  );
}

export function DraftProfileContent({ profile }: { profile: DraftProfile }) {
  if (!profile.available) {
    return <p className="text-[12px] text-white/45 py-1">{profile.note}</p>;
  }
  return (
    <div className="space-y-4">
      {(profile.tendencyAnalysis || profile.biasAnalysis) && (
        <div className="space-y-1.5">
          {profile.tendencyAnalysis && (
            <p className="text-[13px] text-white/85 leading-relaxed">{profile.tendencyAnalysis}</p>
          )}
          {profile.biasAnalysis && (
            <p className="text-[12.5px] text-white/65 leading-relaxed">{profile.biasAnalysis}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DraftHeatmap rows={profile.heatmap} />
        <PositionalBias rows={profile.positionalBias} />
      </div>

      <p className="text-[10.5px] text-white/35 leading-snug">
        Based on {profile.totalPicksAnalyzed} pick{profile.totalPicksAnalyzed === 1 ? "" : "s"} across{" "}
        {profile.draftsAnalyzed} dynasty draft{profile.draftsAnalyzed === 1 ? "" : "s"}
        {profile.truncated ? " (most recent drafts)" : ""}. League average pools every drafter in those drafts.
      </p>
    </div>
  );
}
