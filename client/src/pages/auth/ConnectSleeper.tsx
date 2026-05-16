import { useState, useRef, type FormEvent } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { ArrowLeft, Loader2, Mail, RefreshCw, Shield, User, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";
import {
  requestSleeperCode,
  loginWithCredentials,
  getLoginContext,
} from "@/services/sleeperAuth";
import { SLEEPER_HCAPTCHA_SITE_KEY } from "@/config/sleeperAuthEndpoints";
import { useAuth } from "@/contexts/AuthContext";

type Step = "identifier" | "code" | "done";

function AuthInput({
  label, type = "text", value, onChange, placeholder, autoComplete, icon: Icon,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoComplete?: string; icon?: React.ElementType;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-white/70 uppercase tracking-wide">{label}</label>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={cn(
            "w-full bg-[#0b1a2e] border border-white/10 rounded-lg py-2.5 text-sm text-white placeholder:text-white/25",
            "focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-colors",
            Icon ? "pl-9 pr-4" : "px-4",
          )}
        />
      </div>
    </div>
  );
}

function GoldButton({ children, loading, disabled, type = "button", onClick }: {
  children: React.ReactNode; loading?: boolean; disabled?: boolean;
  type?: "button" | "submit"; onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className="w-full bg-[#d4af37] hover:bg-[#e0bf4a] disabled:opacity-50 disabled:cursor-not-allowed text-[#060d1a] font-bold text-sm py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-[13px] text-red-400">
      {msg}
    </div>
  );
}

export function ConnectSleeperScreen() {
  const { logout, onSleeperConnected } = useAuth();
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const hcaptchaRef = useRef<HCaptcha>(null);

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    if (!captchaToken) { setError("Please complete the security check."); return; }
    setLoading(true);
    setError("");
    try {
      await requestSleeperCode(identifier.trim(), captchaToken);
      setStep("code");
    } catch (err: any) {
      setError(err.message || "Failed to send code.");
      hcaptchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!captchaToken) { setError("Please complete the security check."); return; }
    setLoading(true);
    setError("");
    try {
      const session = await loginWithCredentials(identifier.trim(), code.trim(), captchaToken);
      await onSleeperConnected(
        session.display_name || identifier.trim(),
        session.user_id,
        session.token,
      );
    } catch (err: any) {
      setError(err.message || "Authentication failed. Please try again.");
      hcaptchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!captchaToken) { setError("Complete the security check first."); return; }
    setResending(true);
    setError("");
    try {
      await requestSleeperCode(identifier.trim(), captchaToken);
      hcaptchaRef.current?.resetCaptcha();
      setCaptchaToken(null);
    } catch (err: any) {
      setError(err.message || "Failed to resend.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#060d1a] flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-8">
          <img src={logoDark} alt="StatChasers" className="h-20 mx-auto mb-1.5 object-contain" />
          <p className="text-[#d4af37] text-[13px] font-medium">Connect Sleeper (one last step)</p>
        </div>

        <div className="bg-[#0d1f35] rounded-2xl border border-white/8 p-8 shadow-2xl shadow-black/40">
          {step === "identifier" && (
            <>
              <h2 className="text-lg font-bold text-white mb-1">Link your Sleeper account</h2>
              <span className="block h-[2.5px] w-8 bg-[#d4af37] rounded-full mb-4" />
              <p className="text-[13px] text-white/50 mb-5">
                Dynasty Command needs your Sleeper account to load your leagues and rosters.
              </p>
              <form onSubmit={handleSendCode} className="space-y-4">
                <AuthInput
                  label="Sleeper username, email, or phone"
                  value={identifier}
                  onChange={setIdentifier}
                  placeholder="e.g. makitrain"
                  icon={User}
                />
                <div>
                  <p className="text-[12px] font-semibold text-white/70 uppercase tracking-wide mb-2">Security Check</p>
                  <HCaptcha
                    ref={hcaptchaRef}
                    sitekey={SLEEPER_HCAPTCHA_SITE_KEY}
                    theme="dark"
                    onVerify={t => setCaptchaToken(t)}
                    onExpire={() => setCaptchaToken(null)}
                    onError={() => setCaptchaToken(null)}
                  />
                </div>
                <ErrorMsg msg={error} />
                <GoldButton type="submit" loading={loading} disabled={!identifier.trim() || !captchaToken}>
                  Send Verification Code
                </GoldButton>
              </form>
            </>
          )}

          {step === "code" && (
            <>
              <button type="button" onClick={() => { setStep("identifier"); setCode(""); setError(""); }}
                className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors mb-5">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <h2 className="text-lg font-bold text-white mb-1">Enter your code</h2>
              <span className="block h-[2.5px] w-8 bg-[#d4af37] rounded-full mb-4" />
              <div className="flex items-center gap-2 bg-[#0b3a7a]/20 border border-[#d4af37]/15 rounded-lg px-4 py-3 mb-5">
                <Mail className="w-4 h-4 text-[#d4af37] flex-shrink-0" />
                <p className="text-[13px] text-white/70">Code sent to <span className="text-white font-medium">{identifier}</span></p>
              </div>
              <form onSubmit={handleConnect} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-semibold text-white/70 uppercase tracking-wide">Sleeper code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    placeholder="Enter code from Sleeper"
                    className="w-full bg-[#0b1a2e] border border-white/10 rounded-lg py-2.5 px-4 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-colors"
                  />
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-white/70 uppercase tracking-wide mb-2">Security Check</p>
                  <HCaptcha
                    ref={hcaptchaRef}
                    sitekey={SLEEPER_HCAPTCHA_SITE_KEY}
                    theme="dark"
                    onVerify={t => setCaptchaToken(t)}
                    onExpire={() => setCaptchaToken(null)}
                    onError={() => setCaptchaToken(null)}
                  />
                </div>
                <ErrorMsg msg={error} />
                <GoldButton type="submit" loading={loading} disabled={!code.trim() || !captchaToken}>
                  Connect Sleeper
                </GoldButton>
              </form>
              <div className="text-center mt-4">
                <button type="button" onClick={handleResend} disabled={resending}
                  className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/60 transition-colors mx-auto disabled:opacity-40">
                  <RefreshCw className={cn("w-3 h-3", resending && "animate-spin")} />
                  {resending ? "Sending…" : "Resend code"}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="text-center mt-4">
          <button type="button" onClick={logout}
            className="flex items-center gap-1.5 text-[12px] text-white/25 hover:text-white/50 transition-colors mx-auto">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
