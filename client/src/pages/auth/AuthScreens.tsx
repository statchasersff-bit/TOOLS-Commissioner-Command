import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, ArrowLeft, Mail, Lock, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";

// ── Shared helpers ────────────────────────────────────────────────────────────

function AuthLayout({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-[#060d1a]">
      <FakeAppBackground />
      <div className="absolute inset-0 bg-[#060d1a]/45" />
      <div className="relative z-10 w-full max-w-[460px]">
        <div
          className="rounded-2xl p-8 shadow-2xl"
          style={{
            background: "linear-gradient(160deg, #0f2a47 0%, #0b1e3a 55%, #091629 100%)",
            border: "1px solid rgba(212,175,55,0.22)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(212,175,55,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          {onBack && (
            <button type="button" onClick={onBack}
              className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors mb-4">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <div className="flex flex-col items-center mb-7">
            <img src={logoDark} alt="StatChasers" className="h-20 mx-auto mb-1.5 object-contain" />
            <div className="flex items-center gap-3 w-full">
              <span className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(212,175,55,0.35))" }} />
              <span className="text-[#d4af37] text-[11px] font-bold tracking-[0.18em] uppercase whitespace-nowrap">Dynasty Command</span>
              <span className="flex-1 h-px" style={{ background: "linear-gradient(to left, transparent, rgba(212,175,55,0.35))" }} />
            </div>
          </div>
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

// ── Landing decorative background ────────────────────────────────────────────

function FakeAppBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ filter: "blur(7px)", transform: "scale(1.06)" }}>
      {/* Blueprint grid */}
      <div className="absolute inset-0 bg-[#060d1a]"
        style={{
          backgroundImage: "linear-gradient(rgba(100,160,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(100,160,255,0.05) 1px,transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Glow orbs */}
      <div className="absolute top-[-10%] left-[10%] w-[500px] h-[400px] rounded-full opacity-25"
        style={{ background: "radial-gradient(ellipse, #0b3a7a 0%, transparent 70%)" }} />
      <div className="absolute bottom-[-5%] right-[5%] w-[420px] h-[360px] rounded-full opacity-20"
        style={{ background: "radial-gradient(ellipse, #0b3a7a 0%, transparent 70%)" }} />
      <div className="absolute top-[40%] right-[25%] w-[300px] h-[260px] rounded-full opacity-15"
        style={{ background: "radial-gradient(ellipse, #d4af37 0%, transparent 65%)" }} />

      {/* Fake tab bar */}
      <div className="absolute top-4 left-0 right-0 flex items-center gap-2 px-6">
        {["Dashboard","My Team","Trade Center","Players","Transactions"].map((t,i) => (
          <div key={i} className={cn(
            "px-4 py-1.5 rounded-full text-[11px] font-semibold",
            i === 0 ? "bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/30" : "text-white/30 border border-white/8"
          )}>{t}</div>
        ))}
      </div>

      {/* Fake KPI cards row */}
      <div className="absolute top-16 left-4 right-4 grid grid-cols-4 gap-3">
        {[
          { label: "Roster Value", val: "94,280", delta: "+2.4%", color: "emerald" },
          { label: "Power Rank", val: "#2", delta: "↑3", color: "gold" },
          { label: "Avg Age", val: "26.4", delta: "−0.2", color: "blue" },
          { label: "Pick Capital", val: "Top 18%", delta: "→", color: "purple" },
        ].map((c, i) => (
          <div key={i} className="bg-[#0d1f35]/80 border border-white/8 rounded-xl p-3">
            <p className="text-[10px] text-white/40 mb-1">{c.label}</p>
            <p className="text-lg font-bold text-white">{c.val}</p>
            <p className={cn("text-[11px] font-medium", c.color === "gold" ? "text-[#d4af37]" : "text-emerald-400")}>{c.delta}</p>
          </div>
        ))}
      </div>

      {/* Fake power rankings table */}
      <div className="absolute top-52 left-4 w-[340px] bg-[#0d1f35]/80 border border-white/8 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2">
          <div className="w-1 h-4 bg-[#d4af37] rounded-full" />
          <p className="text-[11px] font-bold text-white tracking-wide uppercase">Power Rankings</p>
        </div>
        {[
          { rank: 1, team: "Gridiron Gods", tier: "Juggernaut", val: "94.2", badge: "bg-yellow-500/20 text-yellow-400" },
          { rank: 2, team: "Dynasty Kings", tier: "Win-Now", val: "91.8", badge: "bg-blue-500/20 text-blue-400" },
          { rank: 3, team: "The Machine", tier: "Contender", val: "89.3", badge: "bg-emerald-500/20 text-emerald-400" },
          { rank: 4, team: "Stacked Squad", tier: "Win-Now", val: "87.1", badge: "bg-blue-500/20 text-blue-400" },
          { rank: 5, team: "Future Stars", tier: "Future Powerhouse", val: "85.6", badge: "bg-purple-500/20 text-purple-400" },
          { rank: 6, team: "Rebuilding Now", tier: "Rebuilder", val: "78.2", badge: "bg-orange-500/20 text-orange-400" },
        ].map((r, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-white/5 last:border-0">
            <span className="text-[11px] font-bold text-white/40 w-4 text-center">{r.rank}</span>
            <div className="flex-1">
              <p className="text-[12px] font-semibold text-white/80">{r.team}</p>
              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", r.badge)}>{r.tier}</span>
            </div>
            <span className="text-[12px] font-bold text-[#d4af37]">{r.val}</span>
          </div>
        ))}
      </div>

      {/* Fake player market value chart */}
      <div className="absolute top-52 right-4 w-[calc(100%-380px)] bg-[#0d1f35]/80 border border-white/8 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2">
          <div className="w-1 h-4 bg-[#d4af37] rounded-full" />
          <p className="text-[11px] font-bold text-white tracking-wide uppercase">Roster Breakdown</p>
        </div>
        <div className="p-4 flex flex-col gap-2">
          {[
            { pos: "QB", pct: 82, color: "bg-blue-500" },
            { pos: "RB", pct: 68, color: "bg-emerald-500" },
            { pos: "WR", pct: 91, color: "bg-purple-500" },
            { pos: "TE", pct: 74, color: "bg-amber-500" },
            { pos: "PICKS", pct: 55, color: "bg-[#d4af37]" },
          ].map((r, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-white/50 w-8">{r.pos}</span>
              <div className="flex-1 h-2 bg-white/8 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", r.color)} style={{ width: `${r.pct}%` }} />
              </div>
              <span className="text-[11px] font-semibold text-white/60 w-8 text-right">{r.pct}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Fake trade card row */}
      <div className="absolute bottom-8 left-4 right-4 grid grid-cols-3 gap-3">
        {[
          { label: "Recent Trade", from: "WR Davante Adams", for: "RB1 + 2026 1st" },
          { label: "Trade Alert", from: "Travis Kelce + 2nd", for: "WR + 2025 1st" },
          { label: "Waiver Wire", from: "Pickup: RB Jaleel", for: "Dropped: WR Bench" },
        ].map((c, i) => (
          <div key={i} className="bg-[#0d1f35]/80 border border-white/8 rounded-xl p-3">
            <p className="text-[10px] text-white/40 mb-2 uppercase tracking-wide">{c.label}</p>
            <p className="text-[11px] text-emerald-400 font-medium">↑ {c.from}</p>
            <p className="text-[11px] text-red-400 font-medium mt-0.5">↓ {c.for}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Landing
export function LandingScreen({ onNavigate }: ScreenProps) {
  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-[#060d1a]">
      {/* Blurred app preview */}
      <FakeAppBackground />

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-[#060d1a]/45" />

      {/* Card */}
      <div className="relative z-10 w-full max-w-[460px]">
        <div
          className="rounded-2xl p-8 shadow-2xl"
          style={{
            background: "linear-gradient(160deg, #0f2a47 0%, #0b1e3a 55%, #091629 100%)",
            border: "1px solid rgba(212,175,55,0.22)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(212,175,55,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          {/* Brand header */}
          <div className="flex flex-col items-center mb-7">
            <img src={logoDark} alt="StatChasers" className="h-20 object-contain mb-2" />
            <div className="flex items-center gap-3 w-full">
              <span className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(212,175,55,0.35))" }} />
              <span className="text-[#d4af37] text-[11px] font-bold tracking-[0.18em] uppercase whitespace-nowrap">Dynasty Command</span>
              <span className="flex-1 h-px" style={{ background: "linear-gradient(to left, transparent, rgba(212,175,55,0.35))" }} />
            </div>
          </div>

          {/* Welcome copy */}
          <div className="mb-6 text-center">
            <h2 className="text-[22px] font-bold text-white mb-1.5">Welcome back</h2>
            <p className="text-[13px] text-white/50 leading-relaxed">
              Sign in to your StatChasers account to access Dynasty Command.
            </p>
          </div>

          {/* Buttons */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => onNavigate("login")}
              className="w-full font-bold text-sm py-3 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, #d4af37 0%, #c9a227 60%, #b8921f 100%)",
                color: "#07111f",
                boxShadow: "0 4px 20px rgba(212,175,55,0.28), 0 1px 0 rgba(255,255,255,0.15) inset",
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 6px 28px rgba(212,175,55,0.42), 0 1px 0 rgba(255,255,255,0.15) inset")}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 4px 20px rgba(212,175,55,0.28), 0 1px 0 rgba(255,255,255,0.15) inset")}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => onNavigate("signup-email")}
              className="w-full font-semibold text-sm py-3 rounded-xl transition-all text-white/80 hover:text-white active:scale-[0.98]"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.13)",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.22)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.13)"; }}
            >
              Create Account
            </button>
          </div>

          {/* Footer */}
          <p className="text-center text-[11px] text-white/20 mt-6">
            Dynasty Command · StatChasers
          </p>
        </div>
      </div>
    </div>
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
    <AuthLayout onBack={() => onNavigate("landing")}>
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
    <AuthLayout onBack={() => onNavigate("landing")}>
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
    <AuthLayout onBack={() => onNavigate("signup-email", { email: state.email })}>
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
    <AuthLayout onBack={() => onNavigate("signup-code", { email: state.email })}>
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
    <AuthLayout onBack={() => onNavigate("login")}>
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
    <AuthLayout onBack={() => onNavigate("forgot-email")}>
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
