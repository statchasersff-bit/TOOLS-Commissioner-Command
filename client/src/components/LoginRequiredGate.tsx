import { Lock, ArrowLeft } from "lucide-react";

/**
 * LoginRequiredGate — shown when a guest or readonly user hits a full-mode
 * module (lineup, waiver, trade inbox).
 *
 * Copy is customizable per module via the optional `title` / `description`
 * props so the gate can speak to the specific tab the user landed on (e.g.
 * "Login required to see trade inbox") instead of a generic blurb. The
 * defaults remain the original action-tools copy.
 *
 * Buttons:
 *   - Login          → triggers onLogin  (host opens UpgradeFlow at login)
 *   - Create Free Account → triggers onSignup (host opens UpgradeFlow at signup)
 *   - Back to Read-Only Tools (optional) → triggers onBack
 */

export function LoginRequiredGate({
  title = "Login required for action tools",
  description = "To manage lineups, submit waivers, send trades, or access Sleeper actions, create a free StatChasers account.",
  onLogin,
  onSignup,
  onBack,
}: {
  title?: string;
  description?: string;
  onLogin: () => void;
  /** When provided, renders a separate Create Free Account button. When
   *  omitted, the Login button doubles as Login / Create Account (legacy). */
  onSignup?: () => void;
  /** When provided, renders the Back to Read-Only Tools button. */
  onBack?: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[50vh] md:min-h-[60vh] px-4">
      <div className="p-6 md:p-10 text-center max-w-sm md:max-w-md w-full border border-border/60 dark:border-[#1a2d4a]/80 bg-gradient-to-b from-background to-muted/20 dark:from-[#0c1929] dark:to-[#0a1628] shadow-xl shadow-black/5 dark:shadow-black/30 rounded-xl"
           data-testid="login-required-gate">
        <div className="mx-auto w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-4 ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
          <Lock className="w-6 h-6 md:w-7 md:h-7 text-[#0b3a7a] dark:text-blue-400" />
        </div>
        <h3 className="text-lg md:text-xl font-bold mb-1.5">{title}</h3>
        <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed mb-5 max-w-[320px] mx-auto">
          {description}
        </p>

        <div className="flex flex-col gap-2 max-w-[260px] mx-auto">
          <button
            onClick={onLogin}
            data-testid="button-gate-login"
            className="w-full bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white h-11 text-sm font-semibold shadow-md shadow-[#0b3a7a]/20 hover:shadow-lg hover:shadow-[#0b3a7a]/30 transition-all rounded-md"
          >
            {onSignup ? "Login" : "Login / Create Account"}
          </button>
          {onSignup && (
            <button
              onClick={onSignup}
              data-testid="button-gate-signup"
              className="w-full h-11 text-sm font-semibold rounded-md border border-[#d4af37]/50 text-[#d4af37] hover:bg-[#d4af37]/10 transition-colors"
            >
              Create Free Account
            </button>
          )}
          {onBack && (
            <button
              onClick={onBack}
              data-testid="button-gate-back"
              className="w-full h-10 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md flex items-center justify-center gap-1.5 border border-border/60 hover:bg-muted/40"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Read-Only Tools
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
