/**
 * ManagerNameButton — clickable wrapper for plain-text Sleeper manager names.
 *
 * Use this anywhere you render `team.owner` / `partner.ownerName` / etc. as
 * naked text. It navigates to the Manager Intel page (/managers/:userId)
 * pre-scoped to the current league. When `userId` is missing it falls back to
 * a plain span so the caller doesn't have to guard every render site.
 *
 * For avatar+name pairs, prefer adding the `onClick` prop directly to
 * `<SleeperUserAvatar>` — that styles the whole pill as the click target.
 * This helper is for label-only cells (table rows, breakdown lists, etc.).
 */

import { useManagerIntel } from "@/contexts/ManagerIntelContext";
import { cn } from "@/lib/utils";

export function ManagerNameButton({
  userId,
  username,
  avatar,
  leagueId,
  className,
  children,
  "data-testid": testId,
}: {
  userId?: string | null;
  username: string;
  avatar?: string | null;
  leagueId?: string | null;
  className?: string;
  /** Defaults to `username`. Override for cases like "X traded with Y". */
  children?: React.ReactNode;
  "data-testid"?: string;
}) {
  const { openManagerIntel } = useManagerIntel();
  const label = children ?? username;

  if (!userId) {
    return (
      <span className={className} data-testid={testId}>
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openManagerIntel({ userId, username, avatar, leagueId });
      }}
      className={cn(
        "inline-flex items-center gap-1 hover:text-[#d4af37] transition-colors cursor-pointer text-left",
        className,
      )}
      data-testid={testId}
    >
      {label}
    </button>
  );
}
