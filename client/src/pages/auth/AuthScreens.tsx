import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, ArrowLeft, Mail, Lock, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";

// ── Shared helpers ────────────────────────────────────────────────────────────

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#060d1a] flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-8">
          <img src={logoDark} alt="StatChasers" className="h-20 mx-auto mb-3 object-contain" />
          <p className="text-[#d4af37] text-[13px] font-medium">Dynasty Command</p>
        </div>
        <div className="bg-[#0d1f35] rounded-2xl border border-white/8 p-8 shadow-2xl shadow-black/40">
          {children}
        </div>
      </div>
    </div>
  );
}

function GoldBar() {
  return <span className="block h-[2.5px] w-8 bg-[#d4af37] rounded-full mt-1.5 mb-5" />;
}

function AuthInput({
  label, type = "text", value, onChange, placeholder, autoComplete, required, icon: Icon,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoComplete?: string; required?: boolean;
  icon?: React.ElementType;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-white/70 uppercase tracking-wide">{label}</label>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />}
        <input
          type={isPassword ? (show ? "text" : "password") : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={cn(
            "w-full bg-[#0b1a2e] border border-white/10 rounded-lg py-2.5 text-sm text-white placeholder:text-white/25",
            "focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-colors",
            Icon ? "pl-9 pr-4" : "px-4",
            isPassword && "pr-10",
          )}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
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

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors mb-5">
      <ArrowLeft className="w-3.5 h-3.5" /> Back
    </button>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-white/70 uppercase tracking-wide">Verification Code</label>
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        className="w-full bg-[#0b1a2e] border border-white/10 rounded-lg py-3 px-4 text-xl font-mono text-white text-center tracking-[0.4em] placeholder:text-white/20 focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-colors"
      />
    </div>
  );
}

// ── Screens ───────────────────────────────────────────────────────────────────

export type AuthScreen =
  | "landing"
  | "login"
  | "signup-email"
  | "signup-code"
  | "signup-password"
  | "forgot-email"
  | "forgot-code"
  | "forgot-password"
  | "forgot-done";

interface ScreenProps {
  onNavigate: (screen: AuthScreen, state?: Partial<AuthState>) => void;
  state: AuthState;
  onLoginSuccess: () => void;
}

export interface AuthState {
  email: string;
  verifiedToken: string;
}

// Landing
export function LandingScreen({ onNavigate }: ScreenProps) {
  return (
    <AuthLayout>
      <h2 className="text-xl font-bold text-white">Welcome back</h2>
      <GoldBar />
      <p className="text-[13px] text-white/50 mb-6">Sign in to your StatChasers account to access Dynasty Command.</p>
      <div className="space-y-3">
        <GoldButton onClick={() => onNavigate("login")}>Log In</GoldButton>
        <button
          type="button"
          onClick={() => onNavigate("signup-email")}
          className="w-full border border-white/15 hover:border-white/30 text-white/80 hover:text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
        >
          Create Account
        </button>
      </div>
      <p className="text-center text-[11px] text-white/25 mt-6">
        Dynasty Command · StatChasers
      </p>
    </AuthLayout>
  );
}

// Login
export function LoginScreen({ onNavigate, onLoginSuccess }: ScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sc-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed."); return; }
      onLoginSuccess();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <BackButton onClick={() => onNavigate("landing")} />
      <h2 className="text-xl font-bold text-white">Log in</h2>
      <GoldBar />
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInput label="Email" type="email" value={email} onChange={setEmail}
          placeholder="you@example.com" autoComplete="email" icon={Mail} required />
        <AuthInput label="Password" type="password" value={password} onChange={setPassword}
          placeholder="••••••••" autoComplete="current-password" icon={Lock} required />
        <ErrorMsg msg={error} />
        <GoldButton type="submit" loading={loading}>Log In</GoldButton>
      </form>
      <div className="flex items-center justify-between mt-4">
        <button type="button" onClick={() => onNavigate("forgot-email")}
          className="text-[12px] text-[#d4af37]/70 hover:text-[#d4af37] transition-colors">
          Forgot password?
        </button>
        <button type="button" onClick={() => onNavigate("signup-email")}
          className="text-[12px] text-white/40 hover:text-white/70 transition-colors">
          Create account
        </button>
      </div>
    </AuthLayout>
  );
}

// Sign Up — Step 1: Email
export function SignupEmailScreen({ onNavigate, state }: ScreenProps) {
  const [email, setEmail] = useState(state.email || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sc-auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "signup" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to send code."); return; }
      onNavigate("signup-code", { email });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <BackButton onClick={() => onNavigate("landing")} />
      <h2 className="text-xl font-bold text-white">Create account</h2>
      <GoldBar />
      <p className="text-[13px] text-white/50 mb-5">We'll send a 6-digit verification code to your email.</p>
      <form onSubmit={handleSend} className="space-y-4">
        <AuthInput label="Email address" type="email" value={email} onChange={setEmail}
          placeholder="you@example.com" autoComplete="email" icon={Mail} required />
        <ErrorMsg msg={error} />
        <GoldButton type="submit" loading={loading}>Send Verification Code</GoldButton>
      </form>
      <p className="text-center text-[12px] text-white/40 mt-4">
        Already have an account?{" "}
        <button type="button" onClick={() => onNavigate("login")}
          className="text-[#d4af37]/80 hover:text-[#d4af37] transition-colors">Log in</button>
      </p>
    </AuthLayout>
  );
}

// Sign Up — Step 2: Verify Code
export function SignupCodeScreen({ onNavigate, state }: ScreenProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) { setError("Please enter the full 6-digit code."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sc-auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.email, code, purpose: "signup" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invalid code."); return; }
      onNavigate("signup-password", { email: state.email, verifiedToken: data.verifiedToken });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError("");
    try {
      await fetch("/api/sc-auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.email, purpose: "signup" }),
      });
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout>
      <BackButton onClick={() => onNavigate("signup-email", { email: state.email })} />
      <h2 className="text-xl font-bold text-white">Check your email</h2>
      <GoldBar />
      <div className="flex items-center gap-2 bg-[#0b3a7a]/20 border border-[#d4af37]/15 rounded-lg px-4 py-3 mb-5">
        <Mail className="w-4 h-4 text-[#d4af37] flex-shrink-0" />
        <p className="text-[13px] text-white/70">Code sent to <span className="text-white font-medium">{state.email}</span></p>
      </div>
      <form onSubmit={handleVerify} className="space-y-4">
        <CodeInput value={code} onChange={setCode} />
        <ErrorMsg msg={error} />
        <GoldButton type="submit" loading={loading} disabled={code.length !== 6}>Verify Code</GoldButton>
      </form>
      <div className="text-center mt-4">
        <button type="button" onClick={handleResend} disabled={resending}
          className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/60 transition-colors mx-auto disabled:opacity-40">
          <RefreshCw className={cn("w-3 h-3", resending && "animate-spin")} />
          {resending ? "Sending…" : "Resend code"}
        </button>
      </div>
    </AuthLayout>
  );
}

// Sign Up — Step 3: Create Password
export function SignupPasswordScreen({ onNavigate, state, onLoginSuccess }: ScreenProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sc-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: state.email,
          verifiedToken: state.verifiedToken,
          password,
          confirmPassword: confirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Registration failed."); return; }
      onLoginSuccess();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const strength = password.length === 0 ? 0 : password.length < 8 ? 1 : password.length < 12 ? 2 : 3;
  const strengthColor = ["", "bg-red-500", "bg-yellow-500", "bg-emerald-500"][strength];
  const strengthLabel = ["", "Too short", "Good", "Strong"][strength];

  return (
    <AuthLayout>
      <BackButton onClick={() => onNavigate("signup-code", { email: state.email })} />
      <h2 className="text-xl font-bold text-white">Create password</h2>
      <GoldBar />
      <p className="text-[13px] text-white/50 mb-5">Choose a secure password for <span className="text-white/70">{state.email}</span></p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <AuthInput label="Password" type="password" value={password} onChange={setPassword}
            placeholder="Minimum 8 characters" autoComplete="new-password" icon={Lock} />
          {password.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", strengthColor)}
                  style={{ width: `${(strength / 3) * 100}%` }} />
              </div>
              <span className="text-[11px] text-white/40">{strengthLabel}</span>
            </div>
          )}
        </div>
        <AuthInput label="Confirm password" type="password" value={confirm} onChange={setConfirm}
          placeholder="Re-enter password" autoComplete="new-password" icon={Lock} />
        <ErrorMsg msg={error} />
        <GoldButton type="submit" loading={loading} disabled={!password || !confirm}>Create Account</GoldButton>
      </form>
    </AuthLayout>
  );
}

// Forgot Password — Step 1: Email
export function ForgotEmailScreen({ onNavigate }: ScreenProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sc-auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "password_reset" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to send code."); return; }
      onNavigate("forgot-code", { email });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <BackButton onClick={() => onNavigate("login")} />
      <h2 className="text-xl font-bold text-white">Reset password</h2>
      <GoldBar />
      <p className="text-[13px] text-white/50 mb-5">Enter your account email and we'll send a reset code.</p>
      <form onSubmit={handleSend} className="space-y-4">
        <AuthInput label="Email address" type="email" value={email} onChange={setEmail}
          placeholder="you@example.com" autoComplete="email" icon={Mail} required />
        <ErrorMsg msg={error} />
        <GoldButton type="submit" loading={loading}>Send Reset Code</GoldButton>
      </form>
    </AuthLayout>
  );
}

// Forgot Password — Step 2: Verify Code
export function ForgotCodeScreen({ onNavigate, state }: ScreenProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) { setError("Please enter the full 6-digit code."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sc-auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.email, code, purpose: "password_reset" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invalid code."); return; }
      onNavigate("forgot-password", { email: state.email, verifiedToken: data.verifiedToken });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      await fetch("/api/sc-auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.email, purpose: "password_reset" }),
      });
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout>
      <BackButton onClick={() => onNavigate("forgot-email")} />
      <h2 className="text-xl font-bold text-white">Enter reset code</h2>
      <GoldBar />
      <div className="flex items-center gap-2 bg-[#0b3a7a]/20 border border-[#d4af37]/15 rounded-lg px-4 py-3 mb-5">
        <Mail className="w-4 h-4 text-[#d4af37] flex-shrink-0" />
        <p className="text-[13px] text-white/70">Code sent to <span className="text-white font-medium">{state.email}</span></p>
      </div>
      <form onSubmit={handleVerify} className="space-y-4">
        <CodeInput value={code} onChange={setCode} />
        <ErrorMsg msg={error} />
        <GoldButton type="submit" loading={loading} disabled={code.length !== 6}>Verify Code</GoldButton>
      </form>
      <div className="text-center mt-4">
        <button type="button" onClick={handleResend} disabled={resending}
          className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/60 transition-colors mx-auto disabled:opacity-40">
          <RefreshCw className={cn("w-3 h-3", resending && "animate-spin")} />
          {resending ? "Sending…" : "Resend code"}
        </button>
      </div>
    </AuthLayout>
  );
}

// Forgot Password — Step 3: New Password
export function ForgotPasswordScreen({ onNavigate, state }: ScreenProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sc-auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: state.email,
          verifiedToken: state.verifiedToken,
          newPassword: password,
          confirmPassword: confirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Password reset failed."); return; }
      onNavigate("forgot-done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h2 className="text-xl font-bold text-white">New password</h2>
      <GoldBar />
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInput label="New password" type="password" value={password} onChange={setPassword}
          placeholder="Minimum 8 characters" autoComplete="new-password" icon={Lock} />
        <AuthInput label="Confirm new password" type="password" value={confirm} onChange={setConfirm}
          placeholder="Re-enter password" autoComplete="new-password" icon={Lock} />
        <ErrorMsg msg={error} />
        <GoldButton type="submit" loading={loading} disabled={!password || !confirm}>Save New Password</GoldButton>
      </form>
    </AuthLayout>
  );
}

// Forgot — Done
export function ForgotDoneScreen({ onNavigate }: ScreenProps) {
  return (
    <AuthLayout>
      <div className="text-center py-4">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Password updated</h2>
        <p className="text-[13px] text-white/50 mb-6">Your password has been reset successfully.</p>
        <GoldButton onClick={() => onNavigate("login")}>Log In Now</GoldButton>
      </div>
    </AuthLayout>
  );
}
