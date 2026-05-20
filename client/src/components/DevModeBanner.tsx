/**
 * Visible banner shown only when at least one dev/preview override is
 * active. Never renders in production builds (gated on `isDevRuntime`).
 *
 * Reads `devOverrides` from AuthContext, which already mirrors what the
 * server reports via /me PLUS the client's local env reads — so the
 * banner accurately reflects every bypass currently in effect.
 */

import { useAuth } from "@/contexts/AuthContext";
import { isDevRuntime } from "@shared/appMode";
import { AlertTriangle } from "lucide-react";

export function DevModeBanner() {
  const { devOverrides, appMode } = useAuth();
  if (!isDevRuntime()) return null;
  if (!devOverrides?.active) return null;

  const flags: string[] = [];
  if (appMode === "WRITE_ACCESS") flags.push("Write Access");
  if (devOverrides.subscription) flags.push("Subscribed");
  if (devOverrides.sleeperConnected) flags.push("Sleeper Connected");

  return (
    <div
      className="w-full bg-amber-500/90 text-black text-[11px] font-semibold flex items-center justify-center gap-2 px-3 py-1.5 border-b border-amber-700/60"
      data-testid="banner-dev-mode"
      role="alert"
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>
        Dev Mode: Write Access Preview Enabled
        {flags.length > 0 && (
          <span className="ml-2 opacity-80 font-normal">— {flags.join(" · ")}</span>
        )}
      </span>
    </div>
  );
}
