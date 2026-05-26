import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Square player headshot with the team logo faintly watermarked behind it,
 * matching the look used elsewhere in the tool. Falls back to the team-tinted
 * gradient + initials when the headshot (or a synthetic/rookie id) has no image.
 * Size is set by the caller via `className` (e.g. "w-8 h-8").
 */
export function PlayerHeadshot({ id, name, team, className }: {
  id: string;
  name: string;
  team?: string;
  className?: string;
}) {
  const [imgErr, setImgErr] = useState(false);
  const [logoErr, setLogoErr] = useState(false);
  const synthetic = !id || id.startsWith("rookie_") || id.startsWith("pick_") || id.startsWith("mock_");
  const initials = (name || "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("");
  const showLogo = !!team && team !== "FA" && !logoErr;

  return (
    <div className={cn("relative flex-shrink-0 overflow-hidden rounded-md ring-1 ring-border bg-gradient-to-br from-[#0b3a7a]/25 to-transparent", className)}>
      {showLogo && (
        <img
          src={`https://sleepercdn.com/images/team_logos/nfl/${team!.toLowerCase()}.png`}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 m-auto w-[85%] h-[85%] object-contain opacity-25 pointer-events-none select-none"
          onError={() => setLogoErr(true)}
        />
      )}
      {imgErr || synthetic ? (
        <div className="relative w-full h-full flex items-center justify-center text-[9px] font-black text-muted-foreground/60">{initials}</div>
      ) : (
        <img
          src={`https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`}
          alt={name}
          className="relative w-full h-full object-cover object-top"
          onError={() => setImgErr(true)}
        />
      )}
    </div>
  );
}
