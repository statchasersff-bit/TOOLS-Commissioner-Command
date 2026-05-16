/**
 * SleeperAuthCard
 *
 * Token-based Sleeper authentication for write operations (separate from the
 * public-API username connection in SleeperContext).
 *
 * Flow A — OTP:
 *   identifier → Send Code → enter OTP → solve hCaptcha → Connect (loginWithCredentials)
 *
 * Flow B — Manual JWT paste:
 *   paste token → decoded client-side → stored locally
 *
 * Security: credentials, OTP codes, captcha tokens, and JWTs are never logged.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Shield,
  ShieldCheck,
  Loader2,
  LogOut,
  AlertCircle,
  KeyRound,
  Smartphone,
  User,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  getSleeperSession,
  requestSleeperCode,
  loginWithCredentials,
  loginWithToken,
  logoutSleeper,
  isSessionExpired,
  type SleeperSession,
} from "@/services/sleeperAuth";
import { SLEEPER_HCAPTCHA_SITE_KEY } from "@/config/sleeperAuthEndpoints";


// ─── Main component ───────────────────────────────────────────────────────────

type AuthStep = "idle" | "code-sent" | "manual-token" | "loading" | "error";

function formatExpiry(session: SleeperSession): string {
  if (!session.exp) return "";
  const d = new Date(session.exp * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function SleeperAuthCard() {
  const [session, setSession] = useState<SleeperSession | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AuthStep>("idle");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const hcaptchaRef = useRef<HCaptcha>(null);

  useEffect(() => {
    setSession(getSleeperSession());
  }, []);

  function reset() {
    setStep("idle");
    setIdentifier("");
    setCode("");
    setManualToken("");
    setCaptchaToken(null);
    setCaptchaError(false);
    setErrorMsg("");
  }

  function handleOpen() { reset(); setOpen(true); }
  function handleClose() { setOpen(false); reset(); }

  const handleCaptchaToken = useCallback((t: string) => {
    setCaptchaToken(t);
    setCaptchaError(false);
  }, []);
  const handleCaptchaExpire = useCallback(() => setCaptchaToken(null), []);
  const handleCaptchaError = useCallback(() => {
    setCaptchaToken(null);
    setCaptchaError(true);
  }, []);

  async function handleSendCode() {
    if (!identifier.trim() || !captchaToken) return;
    setStep("loading");
    setErrorMsg("");
    const tokenForSend = captchaToken;
    setCaptchaToken(null);
    hcaptchaRef.current?.resetCaptcha();
    try {
      await requestSleeperCode(identifier.trim(), tokenForSend);
      setStep("code-sent");
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to send verification code.");
      setStep("error");
    }
  }

  async function handleConnect() {
    if (!code.trim()) return;
    if (!captchaToken) {
      setCaptchaError(true);
      return;
    }
    setStep("loading");
    setErrorMsg("");
    try {
      const sess = await loginWithCredentials(
        identifier.trim(),
        code.trim(),
        captchaToken
      );
      setSession(sess);
      setOpen(false);
      reset();
    } catch (e: any) {
      setErrorMsg(e.message || "Authentication failed. Check your code and try again.");
      setStep("error");
      setCaptchaToken(null);
      hcaptchaRef.current?.resetCaptcha();
    }
  }

  async function handleManualToken() {
    if (!manualToken.trim()) return;
    setStep("loading");
    setErrorMsg("");
    try {
      const sess = await loginWithToken(manualToken.trim());
      setSession(sess);
      setOpen(false);
      reset();
    } catch (e: any) {
      setErrorMsg(e.message || "Invalid token. Could not parse.");
      setStep("error");
    }
  }

  async function handleDisconnect() {
    await logoutSleeper();
    setSession(null);
  }

  // ── Connected state ────────────────────────────────────────────────────────
  if (session) {
    const expired = isSessionExpired(session);
    return (
      <Card
        className={`p-4 md:p-5 ${expired
          ? "border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent dark:from-amber-500/10"
          : "border-[#d4af37]/30 bg-gradient-to-br from-[#0b3a7a]/5 to-transparent dark:from-[#0b3a7a]/20 dark:to-transparent"
        }`}
        data-testid="sleeper-auth-connected-card"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ${expired
              ? "bg-amber-500/10 ring-amber-500/20"
              : "bg-emerald-500/10 dark:bg-emerald-400/10 ring-emerald-500/20 dark:ring-emerald-400/20"
            }`}>
              {session.avatar ? (
                <img
                  src={`https://sleepercdn.com/avatars/thumbs/${session.avatar}`}
                  alt={session.display_name}
                  className="w-9 h-9 rounded-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : expired ? (
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-foreground truncate" data-testid="text-auth-username">
                  @{session.display_name}
                </span>
                {expired ? (
                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-semibold">
                    Session Expired
                  </Badge>
                ) : (
                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-semibold">
                    Authenticated
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {expired
                  ? "Token expired. Reconnect to restore write access."
                  : `Actions enabled${session.exp ? ` · Expires ${formatExpiry(session)}` : ""}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {expired && (
              <Button
                size="sm"
                className="h-8 text-xs bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white"
                onClick={handleOpen}
                data-testid="button-auth-reconnect"
              >
                Reconnect
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40"
              data-testid="button-auth-disconnect"
            >
              <LogOut className="w-3 h-3" />
              Disconnect
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // ── Disconnected state + modal ─────────────────────────────────────────────
  return (
    <>
      <Card
        className="p-4 md:p-5 border-dashed border-[#0b3a7a]/30 dark:border-[#1a3a6a]/60 bg-gradient-to-br from-[#0b3a7a]/3 to-transparent dark:from-[#0b3a7a]/10 dark:to-transparent"
        data-testid="sleeper-auth-disconnected-card"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center flex-shrink-0 ring-1 ring-[#0b3a7a]/15 dark:ring-blue-400/15">
              <Shield className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Connect Sleeper</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Connect your account to sync leagues and unlock Dynasty Command actions.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="flex-shrink-0 h-8 text-xs bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white shadow-sm"
            onClick={handleOpen}
            data-testid="button-auth-connect"
          >
            Connect Sleeper
          </Button>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent className="sm:max-w-[420px] bg-background border-border/60 dark:bg-[#0c1929] dark:border-[#1a2d4a]">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center">
                <Shield className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              </div>
              <DialogTitle className="text-base font-bold">Authentication Required</DialogTitle>
            </div>
            <DialogDescription className="text-[13px] leading-relaxed">
              To make changes on Sleeper, connect your account. Your credentials go directly to Sleeper. Auth tokens are stored only in your browser.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-4">

            {/* ── Error banner ── */}
            {(step === "error" || (step === "code-sent" && captchaError)) && (errorMsg || captchaError) && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/8 border border-destructive/20 text-[13px] text-destructive" data-testid="text-auth-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{captchaError && !errorMsg ? "Complete the security check before connecting." : errorMsg}</span>
              </div>
            )}

            {/* ── Step: idle / error — enter identifier ── */}
            {(step === "idle" || step === "error") && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
                    Sleeper username, email, or phone
                  </label>
                  <Input
                    placeholder="e.g. makitrain or user@email.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && captchaToken && handleSendCode()}
                    className="h-10 text-sm"
                    autoComplete="username"
                    data-testid="input-auth-identifier"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
                    Security check
                  </label>
                  <HCaptcha
                    ref={hcaptchaRef}
                    sitekey={SLEEPER_HCAPTCHA_SITE_KEY}
                    onVerify={handleCaptchaToken}
                    onExpire={handleCaptchaExpire}
                    onError={handleCaptchaError}
                    theme={document.documentElement.classList.contains("dark") ? "dark" : "light"}
                  />
                  {captchaToken && (
                    <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> Security check passed
                    </p>
                  )}
                  {captchaError && !captchaToken && (
                    <p className="flex items-center gap-1.5 text-[11px] text-destructive">
                      <AlertCircle className="w-3 h-3" /> Complete the security check to continue.
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    className="w-full h-10 text-sm bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white gap-2"
                    onClick={handleSendCode}
                    disabled={!identifier.trim() || !captchaToken}
                    data-testid="button-auth-send-code"
                  >
                    <Smartphone className="w-4 h-4" />
                    Send Verification Code
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-10 text-sm gap-2"
                    onClick={() => { setStep("manual-token"); setErrorMsg(""); }}
                    data-testid="button-auth-use-token"
                  >
                    <KeyRound className="w-4 h-4" />
                    Use token manually
                  </Button>
                </div>
                <Button variant="ghost" className="w-full h-9 text-sm text-muted-foreground" onClick={handleClose} data-testid="button-auth-cancel">
                  Cancel
                </Button>
              </div>
            )}

            {/* ── Step: code-sent — enter code + captcha ── */}
            {step === "code-sent" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-[13px] text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>Verification code sent to <strong>{identifier}</strong></span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
                    Verification code (password)
                  </label>
                  <Input
                    placeholder="Enter code or password"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && captchaToken && handleConnect()}
                    className="h-10 text-sm font-mono tracking-widest"
                    autoComplete="one-time-code"
                    data-testid="input-auth-code"
                  />
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Enter the code Sleeper sent, or your account password.
                  </p>
                </div>

                {/* hCaptcha widget */}
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
                    Security check
                  </label>
                  <>
                    <HCaptcha
                      ref={hcaptchaRef}
                      sitekey={SLEEPER_HCAPTCHA_SITE_KEY}
                      onVerify={handleCaptchaToken}
                      onExpire={handleCaptchaExpire}
                      onError={handleCaptchaError}
                      theme={document.documentElement.classList.contains("dark") ? "dark" : "light"}
                    />
                    {captchaToken && (
                      <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                        <CheckCircle2 className="w-3 h-3" /> Security check passed
                      </p>
                    )}
                    {captchaError && !captchaToken && (
                      <p className="flex items-center gap-1.5 text-[11px] text-destructive mt-1">
                        <AlertCircle className="w-3 h-3" /> Complete the security check to continue.
                      </p>
                    )}
                  </>
                </div>

                <Button
                  className="w-full h-10 text-sm bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white"
                  onClick={handleConnect}
                  disabled={!code.trim() || !captchaToken}
                  data-testid="button-auth-connect-verify"
                >
                  Connect
                </Button>
                <Button variant="ghost" className="w-full h-9 text-sm text-muted-foreground" onClick={() => { setStep("idle"); setErrorMsg(""); setCaptchaToken(null); }} data-testid="button-auth-back">
                  ← Back
                </Button>
              </div>
            )}

            {/* ── Step: manual-token — paste JWT ── */}
            {step === "manual-token" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">
                    Sleeper JWT token
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      type="password"
                      placeholder="Paste your Sleeper auth token"
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleManualToken()}
                      className="h-10 text-sm pl-8 font-mono"
                      autoComplete="off"
                      data-testid="input-auth-token"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Paste a JWT from Sleeper's app (Chrome DevTools → Network → Authorization header). Decoded locally. Never sent to our servers.
                  </p>
                </div>
                <Button
                  className="w-full h-10 text-sm bg-[#0b3a7a] hover:bg-[#0b3a7a]/90 text-white"
                  onClick={handleManualToken}
                  disabled={!manualToken.trim()}
                  data-testid="button-auth-connect-token"
                >
                  Connect
                </Button>
                <Button variant="ghost" className="w-full h-9 text-sm text-muted-foreground" onClick={() => { setStep("idle"); setErrorMsg(""); }} data-testid="button-auth-back-token">
                  ← Back
                </Button>
              </div>
            )}

            {/* ── Step: loading ── */}
            {step === "loading" && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400 animate-spin" />
                <p className="text-sm text-muted-foreground">Connecting to Sleeper…</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
