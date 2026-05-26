import { useRef, useState } from "react";
import { Loader2, HelpCircle } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { scAuthFetch } from "@/lib/scAuthFetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const STATCHASERS_DISCORD_INVITE = "https://discord.gg/yerHQKBrre";

// A single asset on one side of the trade. Players carry their Sleeper id so the
// server can render a headshot; picks are label-only.
export interface PollAsset {
  label: string;
  sleeperId?: string;
}
export interface PollSide {
  label: string;
  receives: PollAsset[];
}

/**
 * Shares a head-to-head trade to the Discord trade-poll channel (rendered image +
 * 🅰️/🅱️/⚖️ reaction voting).
 *
 * Self-gating: renders nothing for guests / Sleeper-only users (mirrors the
 * server's requireAuth), or when either side has no assets. It takes already
 * normalized sides, so it can be dropped onto any trade surface (My Trades, the
 * Trade Calculator, the Trade Finder) regardless of that surface's native data
 * shape — each caller maps its own trade into { label, receives:[{label,sleeperId?}] }.
 */
export function ShareTradeToDiscordButton({
  leagueName,
  leagueFormat,
  sideA,
  sideB,
  testId,
  className,
  label = "Click for Help",
}: {
  leagueName?: string;
  leagueFormat?: string;
  sideA: PollSide;
  sideB: PollSide;
  testId: string;
  /** Overrides the default pill styling (size/color/border) — used to match a
   *  surface's own button design. Structural classes are always applied. */
  className?: string;
  /** Idle button text (and tooltip). Defaults to "Click for Help". */
  label?: string;
}) {
  const { toast } = useToast();
  const { isAuthenticatedUser } = useAuth();
  const [sharing, setSharing] = useState(false);
  const [showShared, setShowShared] = useState(false);
  const inFlight = useRef(false);

  if (!isAuthenticatedUser) return null;
  if (!sideA.receives.length || !sideB.receives.length) return null;

  const onShare = async (e: React.MouseEvent) => {
    e.stopPropagation(); // trade rows are often clickable; don't trigger their onClick
    if (inFlight.current) return; // guard rapid double-clicks
    inFlight.current = true;
    setSharing(true);
    try {
      const res = await scAuthFetch("/api/discord/share-trade-poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueName: leagueName ?? "",
          leagueFormat: leagueFormat ?? "",
          sideA: { label: sideA.label || "Side A", receives: sideA.receives },
          sideB: { label: sideB.label || "Side B", receives: sideB.receives },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json().catch(() => ({} as any));
      setShowShared(true);
    } catch {
      toast({ title: "Could not share trade poll. Please try again.", variant: "destructive" });
    } finally {
      inFlight.current = false;
      setSharing(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onShare}
        disabled={sharing}
        data-testid={`share-discord-${testId}`}
        title={label}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed",
          className ?? "px-2 py-1 text-[10px] border border-[#5865F2]/40 text-[#5865F2] hover:bg-[#5865F2]/10",
        )}
      >
        {sharing ? <Loader2 className="w-3 h-3 animate-spin" /> : <HelpCircle className="w-3 h-3" />}
        {sharing ? "Sharing..." : label}
      </button>

      <Dialog open={showShared} onOpenChange={setShowShared}>
        <DialogContent className="max-w-sm" data-testid="dialog-trade-shared">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SiDiscord className="w-4 h-4 text-[#5865F2]" />
              Shared to Discord
            </DialogTitle>
            <DialogDescription>
              Your trade has been shared to the StatChasers Discord for community voting. Join the server to see the poll results.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <a
              href={STATCHASERS_DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setShowShared(false)}
              data-testid="btn-join-discord"
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold bg-[#5865F2] hover:bg-[#5865F2]/90 text-white transition-colors"
            >
              <SiDiscord className="w-4 h-4" />
              Join Discord Now
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
