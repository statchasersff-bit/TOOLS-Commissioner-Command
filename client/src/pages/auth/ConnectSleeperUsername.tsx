import { useState, type FormEvent } from "react";
import { Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

/**
 * ConnectSleeperUsername — read-only Sleeper connection screen.
 *
 * No StatChasers account required, no OTP, no captcha. Just resolves the
 * username via the public Sleeper API (`/api/sleeper/user/:username`) and
 * persists `{username, userId}` in localStorage. After connecting, the
 * caller's AccessGate will unblock and render the requested module.
 *
 * This is intentionally lightweight and renders INSIDE the app shell — it's
 * not a full-page wall. It's used by AccessGate when a guest hits a
 * readonly-required module.
 */

export function ConnectSleeperUsername({
  title = "Connect your Sleeper username",
  subtitle = "No login required. We'll fetch your leagues using public Sleeper data. You can create a free StatChasers account later when you want trade, waiver, or lineup tools.",
  onConnected,
}: {
  title?: string;
  subtitle?: string;
  onConnected?: () => void;
}) {
  const { connectReadOnlySleeper } = useAuth();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      setError("Enter your Sleeper username.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await connectReadOnlySleeper(username.trim());
      onConnected?.();
    } catch (err: any) {
      setError(err?.message || "Could not find that Sleeper username.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[50vh] md:min-h-[60vh] px-4">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mb-4 ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
            <User className="w-6 h-6 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <h2 className="text-lg md:text-xl font-bold text-foreground mb-2" data-testid="text-connect-sleeper-title">{title}</h2>
          <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-semibold text-foreground/70 uppercase tracking-wide block">
              Sleeper username
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. makitrain"
                autoComplete="username"
                data-testid="input-readonly-sleeper-username"
                className={cn(
                  "w-full bg-background border border-border rounded-lg py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50",
                  "focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-colors",
                  "pl-9 pr-4",
                )}
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-[13px] text-red-400" data-testid="text-readonly-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim()}
            data-testid="button-connect-readonly-sleeper"
            className="w-full bg-[#d4af37] hover:bg-[#e0bf4a] disabled:opacity-50 disabled:cursor-not-allowed text-[#060d1a] font-bold text-sm py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Connect Sleeper Username
          </button>
        </form>

        <p className="text-[11px] text-muted-foreground/70 text-center mt-4">
          We only use your username to fetch your public Sleeper leagues, rosters, and matchups.
        </p>
      </div>
    </div>
  );
}
