import { cn } from "@/lib/utils";

const POS_COLORS: Record<string, string> = {
  QB: "text-rose-400",
  RB: "text-emerald-400",
  WR: "text-sky-400",
  TE: "text-yellow-400",
};

/**
 * Reusable player avatar with optional team-logo badge.
 *
 * size    — "xs" (w-7), "sm" (w-9, default), "md" (w-11)
 * compact — render only the circle + badge, no name / pos text
 * sub     — optional secondary line text (overrides team name in meta row)
 */
export function PlayerAvatar({
  id,
  name,
  pos,
  team = "",
  size = "sm",
  sub,
  compact = false,
}: {
  id: string;
  name: string;
  pos: string;
  team?: string;
  size?: "xs" | "sm" | "md";
  sub?: string;
  compact?: boolean;
}) {
  const posColor  = POS_COLORS[pos] ?? "text-muted-foreground";
  const avatarSize = size === "md" ? "w-11 h-11" : size === "xs" ? "w-7 h-7" : "w-9 h-9";
  const badgeSize  = size === "md" ? "w-[18px] h-[18px]" : size === "xs" ? "w-[12px] h-[12px]" : "w-[14px] h-[14px]";
  const nameSize   = size === "md" ? "text-[15px]" : size === "xs" ? "text-[12px]" : "text-[13px]";
  const metaSize   = size === "md" ? "text-[13px]" : size === "xs" ? "text-[10px]" : "text-[11px]";

  const circle = (
    <div className="relative flex-shrink-0">
      <div className={cn(avatarSize, "rounded-full overflow-hidden bg-[#0b3a7a]/40 ring-1 ring-white/10")}>
        <img
          src={`https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`}
          alt={name}
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              "https://sleepercdn.com/images/v2/icons/player_default.webp";
          }}
        />
      </div>
      {team && team !== "FA" && (
        <div
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full overflow-hidden ring-[1.5px] ring-background bg-[#0a1628] flex items-center justify-center",
            badgeSize
          )}
        >
          <img
            src={`https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`}
            alt={team}
            className="w-full h-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
    </div>
  );

  if (compact) return circle;

  return (
    <div className="flex items-center gap-2.5">
      {circle}
      <div className="min-w-0">
        <div className={cn("font-bold text-foreground leading-tight truncate", nameSize)}>
          {name}
        </div>
        <div className={cn("flex items-center gap-1.5 mt-0.5", metaSize)}>
          <span className={cn("font-bold", posColor)}>{pos}</span>
          {sub ? (
            <span className="text-muted-foreground">{sub}</span>
          ) : (
            team && <span className="text-muted-foreground font-medium">{team}</span>
          )}
        </div>
      </div>
    </div>
  );
}
