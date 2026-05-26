import { useState } from "react";
import { cn } from "@/lib/utils";
import { ResponsivePlayerName } from "@/components/ResponsivePlayerName";

const POS_COLORS: Record<string, string> = {
  QB: "text-rose-400",
  RB: "text-emerald-400",
  WR: "text-sky-400",
  TE: "text-yellow-400",
};

const POS_BG: Record<string, string> = {
  QB: "bg-rose-500/20",
  RB: "bg-emerald-500/20",
  WR: "bg-sky-500/20",
  TE: "bg-yellow-500/20",
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
  const [imgErr, setImgErr] = useState(false);

  const posColor   = POS_COLORS[pos] ?? "text-muted-foreground";
  const posBg      = POS_BG[pos] ?? "bg-muted/40";
  const avatarSize = size === "md" ? "w-11 h-11" : size === "xs" ? "w-7 h-7" : "w-9 h-9";
  const badgeSize  = size === "md" ? "w-[18px] h-[18px]" : size === "xs" ? "w-[12px] h-[12px]" : "w-[14px] h-[14px]";
  const nameSize   = size === "md" ? "text-[15px]" : size === "xs" ? "text-[12px]" : "text-[13px]";
  const metaSize   = size === "md" ? "text-[13px]" : size === "xs" ? "text-[10px]" : "text-[11px]";
  const initSize   = size === "md" ? "text-[15px]" : size === "xs" ? "text-[11px]" : "text-[13px]";

  const isSyntheticId = !id || id.startsWith("rookie_") || id.startsWith("pick_") || id.startsWith("mock_");
  const showFallback  = imgErr || isSyntheticId;

  const initials = (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  const circle = (
    <div className="relative flex-shrink-0">
      <div className={cn(avatarSize, "rounded-full overflow-hidden ring-1 ring-white/10", showFallback ? posBg : "bg-[#0b3a7a]/40")}>
        {showFallback ? (
          <div className={cn("w-full h-full flex items-center justify-center font-bold", initSize, posColor)}>
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
      {team && team !== "FA" && (
        <div
          className={cn(
            // Bare team logo, no backdrop/ring. We still hide the ENTIRE
            // wrapper (not just the inner img) on image error so there's no
            // orphaned box when Sleeper's CDN 404s on a legacy abbreviation.
            "absolute -bottom-0.5 -right-0.5 flex items-center justify-center",
            badgeSize
          )}
        >
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
      )}
    </div>
  );

  if (compact) return circle;

  return (
    <div className="flex items-center gap-2.5">
      {circle}
      <div className="min-w-0">
        <ResponsivePlayerName name={name} className={cn("font-bold text-foreground leading-tight", nameSize)} />

        <div className={cn("flex items-center gap-1.5 mt-0.5", metaSize)}>
          <span className={cn("font-bold", posColor)}>{pos}</span>
          {team && team !== "FA" && <span className="text-muted-foreground font-medium">{team}</span>}
          {sub && <span className="text-muted-foreground">{sub}</span>}
        </div>
      </div>
    </div>
  );
}
