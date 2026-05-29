/**
 * FeaturedGradeCards — a row of "category leader" cards for the Advanced Stats
 * tab. For the active position it surfaces the top scorer in each composite
 * grade EXCEPT Overall (Volume, Accuracy, Explosiveness, …), with a player
 * headshot, a superlative title, and a short plain-English tagline.
 *
 * The winner of each category is the qualified player with the highest score
 * for that grade key — `qualify` keeps low-sample backups from topping a card
 * on a tiny-sample fluke. Scores are read off the already-graded rows passed in
 * (the same rows the table renders), so no recomputation happens here.
 */
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ScoreCategoryMeta, StatPosition } from "@/lib/advancedStatsMeta";

/**
 * Square player headshot sized to ~30% of the card width. Bespoke to these
 * featured cards (the shared PlayerAvatar is a circle); reuses the same Sleeper
 * CDN image, initials fallback, and corner team logo.
 */
function SquareHeadshot({ id, name, team }: { id: string; name: string; team: string }) {
  const [imgErr, setImgErr] = useState(false);
  const isSynthetic = !id || id.startsWith("rookie_") || id.startsWith("pick_") || id.startsWith("mock_");
  const showFallback = imgErr || isSynthetic;
  const initials = (name || "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("");

  const teamLogo = team && team !== "FA" ? `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png` : null;

  return (
    <div className="relative w-[30%] self-stretch flex-shrink-0">
      {/* Team-logo watermark, scaled up to halo behind the player image. */}
      {teamLogo && (
        <img
          src={teamLogo}
          alt=""
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 w-[150%] h-[150%] -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.12] dark:opacity-[0.18]"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className={cn("relative z-10 w-full h-full overflow-hidden", showFallback ? "bg-muted/40" : "bg-[#0b3a7a]/40")}>
        {showFallback ? (
          <div className="w-full h-full flex items-center justify-center font-black text-xl text-muted-foreground">
            {initials}
          </div>
        ) : (
          <img
            src={`https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`}
            alt={name}
            className="w-full h-full object-cover object-top"
            onError={() => setImgErr(true)}
          />
        )}
      </div>
    </div>
  );
}

// Crisp team logo for the top-right corner of the card.
function CardTeamLogo({ team }: { team: string }) {
  if (!team || team === "FA") return null;
  return (
    <div className="absolute z-20 top-1.5 right-1.5 w-[18px] h-[18px] flex items-center justify-center">
      <img
        src={`https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`}
        alt={team}
        className="w-full h-full object-contain"
        onError={(e) => {
          const img = e.target as HTMLImageElement;
          const parent = img.parentElement;
          if (parent) parent.style.display = "none";
        }}
      />
    </div>
  );
}

// Per-position, per-grade superlative copy. The grade keys mirror the composite
// engines (qbCompositeScores / rbCompositeScores / receivingComposites).
type Superlative = { title: string; tagline: string };

const SUPERLATIVES: Record<StatPosition, Record<string, Superlative>> = {
  qb: {
    volumeScore:       { title: "Highest Volume", tagline: "Biggest workload & opportunity" },
    accuracyScore:     { title: "Most Accurate",  tagline: "Best ball placement" },
    explosivenessScore:{ title: "Most Explosive", tagline: "Top deep-ball upside" },
    mobilityScore:     { title: "Most Mobile",    tagline: "Top rushing & scramble threat" },
    efficiencyScore:   { title: "Most Efficient", tagline: "Best play-to-play value" },
  },
  rb: {
    volumeScore:       { title: "Highest Volume", tagline: "Biggest workload & opportunity" },
    efficiencyScore:   { title: "Most Efficient", tagline: "Best per-touch value" },
    explosivenessScore:{ title: "Most Explosive", tagline: "Top home-run hitter" },
    receivingScore:    { title: "Best Receiver",  tagline: "Top pass-game value" },
    elusivenessScore:  { title: "Most Elusive",   tagline: "Top tackle-breaker" },
  },
  wr: {
    volumeScore:       { title: "Highest Volume", tagline: "Top target earner" },
    efficiencyScore:   { title: "Most Efficient", tagline: "Best per-route value" },
    explosivenessScore:{ title: "Most Explosive", tagline: "Top deep threat" },
    handsScore:        { title: "Best Hands",     tagline: "Most reliable catcher" },
    elusivenessScore:  { title: "Most Elusive",   tagline: "Top YAC creator" },
  },
  te: {
    volumeScore:       { title: "Highest Volume", tagline: "Top target earner" },
    efficiencyScore:   { title: "Most Efficient", tagline: "Best per-route value" },
    explosivenessScore:{ title: "Most Explosive", tagline: "Top deep threat" },
    handsScore:        { title: "Best Hands",     tagline: "Most reliable catcher" },
    elusivenessScore:  { title: "Most Elusive",   tagline: "Top YAC creator" },
  },
};

type Row = Record<string, unknown>;

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = parseFloat(v); if (Number.isFinite(n)) return n; }
  return -Infinity;
}
const getId   = (r: Row) => String(r.playerId ?? r.player_id ?? r.sleeper_id ?? r.sleeperId ?? "");
const getName = (r: Row) => String(r.playerName ?? r.player_name ?? r.name ?? "—");
const getTeam = (r: Row) => String(r.team ?? r.nfl_team ?? "");

interface FeaturedCard {
  key: string;
  title: string;
  tagline: string;
  row: Row;
  score: number;
}

export function FeaturedGradeCards({
  position,
  rows,
  categories,
  qualify,
  onPlayerClick,
}: {
  position: StatPosition;
  /** Already-graded rows (the same rows the table renders). */
  rows: Row[];
  /** Grade metadata for the position (Overall first); Overall is skipped. */
  categories: ScoreCategoryMeta[];
  /** Percentile-baseline qualifier — excludes low-sample players from winning a card. */
  qualify?: (row: Row) => boolean;
  /** Optional: open the player's profile when a card is clicked. */
  onPlayerClick?: (row: Row) => void;
}) {
  const cards = useMemo<FeaturedCard[]>(() => {
    if (!rows.length) return [];
    // Restrict to qualified players so a one-throw backup can't top a card.
    const qualified = qualify ? rows.filter(qualify) : rows;
    const pool = qualified.length ? qualified : rows;
    const copy = SUPERLATIVES[position] ?? {};

    return categories
      // Overall is excluded — these are the "besides overall" category leaders.
      .filter((c) => !c.key.toLowerCase().startsWith("overall"))
      .map((c) => {
        let best: Row | null = null;
        let bestVal = -Infinity;
        for (const r of pool) {
          const v = num(r[c.key]);
          if (v > bestVal) { bestVal = v; best = r; }
        }
        if (!best || bestVal === -Infinity) return null;
        const s = copy[c.key];
        return {
          key: c.key,
          title: s?.title ?? `Best ${c.label}`,
          tagline: s?.tagline ?? c.label,
          row: best,
          score: bestVal,
        } as FeaturedCard;
      })
      .filter((c): c is FeaturedCard => c != null);
  }, [position, rows, categories, qualify]);

  if (cards.length === 0) return null;

  return (
    <div data-testid="featured-grade-cards" className="space-y-2">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Category Leaders
      </span>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {cards.map((c) => {
          const id = getId(c.row);
          const name = getName(c.row);
          const team = getTeam(c.row);
          const clickable = !!onPlayerClick && !!id;
          return (
            <Card
              key={c.key}
              data-testid={`featured-card-${c.key}`}
              onClick={clickable ? () => onPlayerClick!(c.row) : undefined}
              className={
                "relative overflow-hidden flex items-stretch transition-colors" +
                (clickable ? " cursor-pointer hover:border-[#d4af37]/40" : "")
              }
            >
              <SquareHeadshot id={id} name={name} team={team} />
              <CardTeamLogo team={team} />
              <div className="relative z-10 min-w-0 flex-1 p-3 flex flex-col justify-center">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#d4af37] truncate pr-4">
                  {c.title}
                </p>
                <p className="text-sm font-bold text-foreground leading-tight truncate">
                  {name}
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight truncate">
                  {c.tagline}
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
