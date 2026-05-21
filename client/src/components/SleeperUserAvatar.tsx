import { cn } from "@/lib/utils";

/**
 * SleeperUserAvatar — small round avatar + username, mirroring the design
 * used by League Analyzer ▸ Power Rankings (`row.avatar` + `row.owner`).
 *
 * Use this everywhere we render a Sleeper user identity (column headers,
 * on-the-clock panel, drafter labels, draft log rows). Centralizing the
 * fallback + size mapping here keeps that look consistent across the app.
 *
 * `avatar` is a Sleeper avatar HASH (e.g. "abc123…"), not a full URL.
 * The component composes `https://sleepercdn.com/avatars/thumbs/{hash}`
 * internally. Passing `null`/`""` renders the initials-circle fallback.
 */
export function SleeperUserAvatar({
  username,
  avatar,
  size = "sm",
  compact = false,
  className,
  onClick,
}: {
  /** Sleeper username (or display name). Required for the fallback initial. */
  username: string;
  /** Sleeper avatar HASH — not a full URL. */
  avatar?: string | null;
  /** xs (w-5), sm (w-6, default), md (w-8) */
  size?: "xs" | "sm" | "md";
  /** Render only the circle (no username text). Use inside dense layouts. */
  compact?: boolean;
  className?: string;
  /**
   * When provided, the whole avatar+name surface becomes an interactive
   * button — wired in Manager Intel call sites. Consumers opt in.
   */
  onClick?: (e: React.MouseEvent) => void;
}) {
  const dims = size === "md" ? "w-8 h-8" : size === "xs" ? "w-5 h-5" : "w-6 h-6";
  const nameSize = size === "md" ? "text-sm" : size === "xs" ? "text-[10px]" : "text-xs";
  const initialSize = size === "md" ? "text-xs" : size === "xs" ? "text-[8px]" : "text-[10px]";
  const initial = (username || "?").charAt(0).toUpperCase();

  const circle = avatar ? (
    <img
      src={`https://sleepercdn.com/avatars/thumbs/${avatar}`}
      alt={username}
      className={cn(dims, "rounded-full object-cover flex-shrink-0")}
      onError={(e) => {
        // Hide the broken img and let the initials fallback show through
        // by swapping siblings — simpler: replace with a styled span.
        const el = e.target as HTMLImageElement;
        const parent = el.parentElement;
        if (parent) {
          const span = document.createElement("span");
          span.className = `${dims} rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0 ${initialSize}`;
          span.textContent = initial;
          parent.replaceChild(span, el);
        }
      }}
      data-testid={`sleeper-user-avatar-${username}`}
    />
  ) : (
    <span
      className={cn(
        dims,
        "rounded-full bg-[#0b3a7a]/20 dark:bg-blue-400/20 flex items-center justify-center font-bold text-[#0b3a7a] dark:text-blue-400 flex-shrink-0",
        initialSize,
      )}
      data-testid={`sleeper-user-avatar-${username}`}
    >
      {initial}
    </span>
  );

  if (compact) {
    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "rounded-full hover:ring-2 hover:ring-[#d4af37]/40 transition-shadow focus:outline-none focus:ring-2 focus:ring-[#d4af37]/60",
            className,
          )}
          data-testid={`sleeper-user-avatar-button-${username}`}
        >
          {circle}
        </button>
      );
    }
    return circle;
  }

  const wrapperCls = cn(
    "flex items-center gap-2 min-w-0",
    onClick && "cursor-pointer rounded-md hover:bg-white/[0.05] -mx-1 px-1 py-0.5 transition-colors",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(wrapperCls, "text-left")}
        data-testid={`sleeper-user-avatar-button-${username}`}
      >
        {circle}
        <span className={cn("font-semibold truncate", nameSize)}>{username}</span>
      </button>
    );
  }

  return (
    <div className={wrapperCls}>
      {circle}
      <span className={cn("font-semibold truncate", nameSize)}>{username}</span>
    </div>
  );
}
