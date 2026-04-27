import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSleeper } from "@/contexts/SleeperContext";
import { API_BASE } from "@/lib/apiBase";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  Trophy,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  LogOut,
  ShieldCheck,
  RefreshCw,
  Copy,
  Check,
  ChevronRight,
  Flame,
  Target,
  Wrench,
  EyeOff,
  Eye,
  Tag,
} from "lucide-react";

interface PrizeSlot { place: number; amount: number; }
interface LeagueFinanceData { leagueId: string; buyIn: number; prizes: PrizeSlot[]; notes: string; isFree: boolean; ignored: boolean; }

type PaymentStatus = "complete" | "partial" | "empty" | "free";
function paymentStatus(f: LeagueFinanceData): PaymentStatus {
  if (f.isFree) return "free";
  const hasBuyIn = f.buyIn > 0;
  const hasPrizes = f.prizes.length > 0;
  if (hasBuyIn && hasPrizes) return "complete";
  if (hasBuyIn || hasPrizes) return "partial";
  return "empty";
}
const PAYMENT_STATUS_CONFIG: Record<PaymentStatus, { label: string; cls: string; dot: string }> = {
  complete: { label: "Set up", cls: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  partial:  { label: "Partial", cls: "border-amber-500/40 text-amber-600 dark:text-amber-400",   dot: "bg-amber-500"   },
  empty:    { label: "Not set", cls: "border-border/50 text-muted-foreground",                     dot: "bg-muted-foreground/40" },
  free:     { label: "Free",    cls: "border-sky-500/40 text-sky-600 dark:text-sky-400",           dot: "bg-sky-500"    },
};
interface LeagueStanding {
  leagueId: string; rank: number; totalTeams: number; wins: number; losses: number; ties: number;
  ptsFor: number; playoffSpots: number; inPlayoffs: boolean; loading: boolean; error: boolean;
}

const SLEEPER_API = "https://api.sleeper.app/v1";

async function fetchLeagueStanding(leagueId: string, userId: string): Promise<Omit<LeagueStanding, "leagueId" | "loading" | "error">> {
  const [rostersRaw, leagueRaw] = await Promise.all([
    fetch(`${SLEEPER_API}/league/${leagueId}/rosters`).then(r => r.json()),
    fetch(`${SLEEPER_API}/league/${leagueId}`).then(r => r.json()),
  ]);
  const rosters: any[] = rostersRaw || [];
  const playoffTeams = leagueRaw?.settings?.playoff_teams ?? Math.floor((leagueRaw?.total_rosters ?? 12) / 3);
  const sorted = [...rosters].sort((a, b) => {
    const wDiff = (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0);
    if (wDiff !== 0) return wDiff;
    const pfA = (a.settings?.fpts ?? 0) + (a.settings?.fpts_decimal ?? 0) / 100;
    const pfB = (b.settings?.fpts ?? 0) + (b.settings?.fpts_decimal ?? 0) / 100;
    return pfB - pfA;
  });
  const userRoster = rosters.find((r: any) => r.owner_id === userId);
  const userPlayers = userRoster?.players?.length ?? 0;
  // Only treat this as a real team if the user has players on their roster.
  // No players = no drafted team (pre-draft, orphan placeholder, etc.) → hide.
  const hasRealTeam = userRoster !== undefined && userPlayers > 0;
  const rank = hasRealTeam ? sorted.findIndex((r: any) => r.roster_id === userRoster!.roster_id) + 1 : -1;
  return {
    rank, totalTeams: rosters.length,
    wins: userRoster?.settings?.wins ?? 0, losses: userRoster?.settings?.losses ?? 0, ties: userRoster?.settings?.ties ?? 0,
    ptsFor: (userRoster?.settings?.fpts ?? 0) + (userRoster?.settings?.fpts_decimal ?? 0) / 100,
    playoffSpots: playoffTeams, inPlayoffs: rank > 0 && rank <= playoffTeams,
  };
}

function fmtDollar(n: number) {
  if (n === 0) return "$0";
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
}
function plColor(pl: number) {
  if (pl > 0) return "text-emerald-600 dark:text-emerald-400";
  if (pl < 0) return "text-red-500 dark:text-red-400";
  return "text-muted-foreground";
}
function plBg(pl: number) {
  if (pl > 0) return "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/50 dark:border-emerald-800/30";
  if (pl < 0) return "bg-red-50 dark:bg-red-950/30 border-red-200/50 dark:border-red-800/30";
  return "bg-muted/30 border-border/40";
}

const DEFAULT_FINANCE: LeagueFinanceData = { leagueId: "", buyIn: 0, prizes: [], notes: "", isFree: false, ignored: false };
function tokenKey(userId: string) { return `dc-finance-token-${userId}`; }

type Tier = "elite" | "bubble" | "rebuild";

function classifyTeam(s: LeagueStanding | undefined): Tier | "unknown" {
  if (!s || s.loading || s.error || s.rank < 1 || s.totalTeams < 2) return "unknown";
  const { rank, playoffSpots, totalTeams } = s;
  const rankPct = rank / totalTeams;
  if (rank <= playoffSpots) {
    return rankPct <= 0.30 ? "elite" : "bubble";
  }
  return rank - playoffSpots <= 2 ? "bubble" : "rebuild";
}

function approxPlayoffPct(s: LeagueStanding): number {
  if (s.rank <= 0 || s.totalTeams < 2) return 0;
  const { rank, playoffSpots, totalTeams } = s;
  if (rank <= playoffSpots) {
    const posInPlayoffs = (rank - 1) / Math.max(playoffSpots - 1, 1);
    return Math.round(95 - posInPlayoffs * 35);
  }
  const spotsOut = rank - playoffSpots;
  const maxOut = Math.max(totalTeams - playoffSpots, 1);
  return Math.max(3, Math.round(35 - (spotsOut / maxOut) * 32));
}

// Truncated-normal placement probability model.
// Models final finishing position as a Gaussian centered on current rank,
// with σ shrinking as the season progresses (more certain late in season).
function placementProbs(s: LeagueStanding, maxPlace: number): Map<number, number> {
  const { rank, totalTeams, wins, losses, ties } = s;
  const gamesPlayed = wins + losses + ties;
  const seasonProgress = Math.min(1, gamesPlayed / 14);
  // σ: ~totalTeams/3 at week 0, shrinks to 0.5 at week 14
  const sigma = Math.max(0.5, (1 - seasonProgress) * totalTeams / 3);
  const raw: number[] = [];
  for (let k = 1; k <= totalTeams; k++) {
    const z = (k - rank) / sigma;
    raw.push(Math.exp(-0.5 * z * z));
  }
  const total = raw.reduce((a, b) => a + b, 0);
  const probs = new Map<number, number>();
  for (let k = 1; k <= Math.min(maxPlace, totalTeams); k++) {
    probs.set(k, raw[k - 1] / total);
  }
  return probs;
}

const TIER_CONFIG: Record<Tier, {
  label: string; short: string; desc: string;
  headerCls: string; bgCls: string; badgeCls: string;
}> = {
  elite: {
    label: "Elite Contenders",
    short: "Elite",
    desc: "Strong playoff position — maximize focus here",
    headerCls: "text-emerald-600 dark:text-emerald-400",
    bgCls: "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30",
    badgeCls: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  },
  bubble: {
    label: "At-Risk & Bubble",
    short: "Bubble",
    desc: "On the playoff edge — needs your attention",
    headerCls: "text-amber-600 dark:text-amber-400",
    bgCls: "bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30",
    badgeCls: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  },
  rebuild: {
    label: "Rebuilds / Longshots",
    short: "Rebuild",
    desc: "Low playoff odds — buy-in likely sunk cost",
    headerCls: "text-slate-500 dark:text-slate-400",
    bgCls: "bg-muted/30 border-border/40",
    badgeCls: "border-border/50 text-slate-500 dark:text-slate-400",
  },
};

// ─── Sleeper Login Gate ────────────────────────────────────────────────────────

type GateMode = "checking" | "login" | "register" | "reset";

const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
const VERIFY_DELAY_MS = 2 * 60 * 1000; // 2 minutes

// Module-level: persists while the page is open, survives tab navigation
let _pending: { sleeperId: string; password: string; leagueId: string; endTime: number } | null = null;

function SleeperVerifyGate({ userId, username, onAuth }: { userId: string; username: string; onAuth: (token: string) => void }) {
  const [mode, setMode] = useState<GateMode>("checking");
  const [challengeCode, setChallengeCode] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [verifyFailed, setVerifyFailed] = useState(false);
  const [leagues, setLeagues] = useState<{ league_id: string; name: string }[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>("");

  async function loadChallenge() {
    try {
      const r = await fetch(`${API_BASE}/api/auth/challenge-current/${userId}`);
      if (!r.ok) {
        const r2 = await fetch(`${API_BASE}/api/auth/challenge/${userId}`);
        const d = await r2.json();
        setChallengeCode(d.code);
      } else {
        const d = await r.json();
        setChallengeCode(d.code);
      }
    } catch { setError("Could not reach server."); }
  }

  async function loadLeagues() {
    try {
      const season = new Date().getFullYear().toString();
      const r = await fetch(`${SLEEPER_API_BASE}/user/${userId}/leagues/nfl/${season}`);
      if (r.ok) {
        const data = await r.json();
        setLeagues((data as any[]).map(l => ({ league_id: l.league_id, name: l.name })));
      }
    } catch {}
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/auth/finance-has-password/${userId}`);
        const d = await r.json();
        if (d.hasPassword) {
          setMode("login");
        } else {
          await Promise.all([loadChallenge(), loadLeagues()]);
          setMode("register");
        }
      } catch { setError("Could not reach server."); }
    })();
  }, [userId]);

  async function handleLogin() {
    if (!password) { setError("Please enter your password."); return; }
    setSubmitting(true); setError("");
    try {
      const r = await fetch(`${API_BASE}/api/auth/finance-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleeperId: userId, password }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Login failed."); return; }
      localStorage.setItem(tokenKey(userId), data.token);
      onAuth(data.token);
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  }

  async function doVerify(pwd: string, leagueId: string) {
    setSubmitting(true); setCountdown(0); setError(""); setVerifyFailed(false);
    try {
      const r = await fetch(`${API_BASE}/api/auth/finance-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleeperId: userId, password: pwd, leagueId }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Verification failed. Make sure your Sleeper team name is saved correctly.");
        setVerifyFailed(true);
        return;
      }
      _pending = null;
      localStorage.setItem(tokenKey(userId), data.token);
      onAuth(data.token);
    } catch {
      setError("Network error. Please try again.");
      setVerifyFailed(true);
    }
    finally { setSubmitting(false); }
  }

  function runCountdown(endTime: number, onDone: () => void) {
    const tick = () => {
      const rem = Math.ceil((endTime - Date.now()) / 1000);
      if (rem <= 0) { setCountdown(0); onDone(); }
      else { setCountdown(rem); setTimeout(tick, 1000); }
    };
    tick();
  }

  // Resume pending countdown when returning to this tab
  useEffect(() => {
    if (_pending && _pending.sleeperId === userId) {
      const rem = _pending.endTime - Date.now();
      if (rem <= 0) {
        const { password: pwd, leagueId } = _pending;
        doVerify(pwd, leagueId);
      } else {
        setSubmitting(true);
        setCountdown(Math.ceil(rem / 1000));
        runCountdown(_pending.endTime, () => {
          if (_pending) doVerify(_pending.password, _pending.leagueId);
        });
      }
    }
  }, []);

  async function handleRegister() {
    if (!selectedLeagueId) { setError("Please select which league you changed your team name in."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    setError(""); setVerifyFailed(false);

    const endTime = Date.now() + VERIFY_DELAY_MS;
    _pending = { sleeperId: userId, password, leagueId: selectedLeagueId, endTime };
    setSubmitting(true);
    runCountdown(endTime, () => {
      if (_pending) doVerify(_pending.password, _pending.leagueId);
    });
  }

  function startReset() {
    setMode("reset");
    setPassword(""); setConfirmPassword(""); setError(""); setSelectedLeagueId("");
    if (!challengeCode) loadChallenge();
    if (leagues.length === 0) loadLeagues();
  }

  const isRegisterMode = mode === "register" || mode === "reset";

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <Card className="p-8 w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          {mode === "checking" && <><h3 className="text-lg font-bold">Finance Account</h3><p className="text-sm text-muted-foreground">Loading…</p></>}
          {mode === "login" && <><h3 className="text-lg font-bold">Sign In</h3><p className="text-sm text-muted-foreground">Welcome back, <span className="font-semibold text-foreground">@{username}</span></p></>}
          {mode === "register" && <><h3 className="text-lg font-bold">Create Finance Password</h3><p className="text-sm text-muted-foreground">Set a password to protect your finances. First, verify you own <span className="font-semibold text-foreground">@{username}</span>.</p></>}
          {mode === "reset" && <><h3 className="text-lg font-bold">Reset Password</h3><p className="text-sm text-muted-foreground">Verify your Sleeper identity to set a new password for <span className="font-semibold text-foreground">@{username}</span>.</p></>}
        </div>

        {/* Loading spinner */}
        {mode === "checking" && (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        )}

        {/* Login form */}
        {mode === "login" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                placeholder="Enter your Finance password"
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                data-testid="input-finance-password"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 rounded-lg px-3 py-2.5" data-testid="text-login-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
            <Button className="w-full" onClick={handleLogin} disabled={submitting || !password} data-testid="button-finance-login">
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Signing in…</> : "Sign In"}
            </Button>
            <button onClick={startReset} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors" data-testid="button-forgot-password">
              Forgot password? Reset via Sleeper verification
            </button>
          </div>
        )}

        {/* Register / Reset form */}
        {isRegisterMode && (
          <div className="space-y-4">

            {/* ── Waiting state (countdown or verifying) ── */}
            {submitting ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-5 text-center space-y-3">
                  {countdown > 0 ? (
                    <>
                      <Loader2 className="w-7 h-7 animate-spin text-[#0b3a7a] dark:text-blue-400 mx-auto" />
                      <p className="text-sm font-semibold text-foreground">Giving Sleeper's API time to update…</p>
                      <p className="text-3xl font-mono font-bold text-[#0b3a7a] dark:text-blue-300" data-testid="text-countdown">
                        {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
                      </p>
                      <p className="text-xs text-muted-foreground">Feel free to browse other tabs — we'll check automatically when the timer ends.</p>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-7 h-7 animate-spin text-[#0b3a7a] dark:text-blue-400 mx-auto" />
                      <p className="text-sm font-semibold text-foreground">Checking Sleeper now…</p>
                    </>
                  )}
                </div>
                {challengeCode && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    Your code: <span className="font-mono font-bold text-foreground">{challengeCode}</span>
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* ── Full form ── */}

                {/* Challenge code */}
                {challengeCode ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground text-center font-medium uppercase tracking-wide">Step 1 — Verify your Sleeper account</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-muted/50 rounded-xl border border-border/60 px-4 py-3 text-center">
                          <span className="text-2xl font-mono font-bold tracking-widest text-[#0b3a7a] dark:text-blue-300" data-testid="text-challenge-code">{challengeCode}</span>
                        </div>
                        <button onClick={() => { navigator.clipboard.writeText(challengeCode!); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="p-3 rounded-xl border border-border/60 hover:bg-muted/50 transition-colors text-muted-foreground" data-testid="button-copy-code">
                          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button onClick={() => { setChallengeCode(null); loadChallenge(); }} className="p-3 rounded-xl border border-border/60 hover:bg-muted/50 transition-colors text-muted-foreground" data-testid="button-refresh-code">
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <ol className="space-y-1.5 text-sm">
                      {[
                        <>Open Sleeper → go to any of your leagues → tap <strong>Team Settings</strong></>,
                        <>Set your <strong>Team Name</strong> to: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{challengeCode}</code></>,
                        <>Hit <strong>Save</strong>. Sleeper's API may take <strong>1–2 minutes</strong> to update — if verify fails, wait and try again. You can rename back after.</>,
                      ].map((step, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="w-5 h-5 rounded-full bg-[#0b3a7a]/10 dark:bg-blue-400/10 text-[#0b3a7a] dark:text-blue-400 flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                          <span className="text-muted-foreground leading-snug">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                )}

                {/* League picker */}
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Step 2 — Select the league you changed</p>
                  {leagues.length > 0 ? (
                    <Select value={selectedLeagueId} onValueChange={v => { setSelectedLeagueId(v); setError(""); }} data-testid="select-league">
                      <SelectTrigger className="w-full" data-testid="trigger-league-picker">
                        <SelectValue placeholder="Choose a league…" />
                      </SelectTrigger>
                      <SelectContent>
                        {leagues.map(l => (
                          <SelectItem key={l.league_id} value={l.league_id} data-testid={`option-league-${l.league_id}`}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Loading your leagues…</span>
                    </div>
                  )}
                </div>

                {/* Password fields */}
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Step 3 — {mode === "reset" ? "Set new password" : "Create a password"}</p>
                  <Input
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    placeholder="New password (min. 6 characters)"
                    data-testid="input-new-password"
                  />
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
                    placeholder="Confirm password"
                    data-testid="input-confirm-password"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 rounded-lg px-3 py-2.5" data-testid="text-register-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
                  </div>
                )}

                {verifyFailed ? (
                  <Button className="w-full" onClick={handleRegister} data-testid="button-finance-retry">
                    Try Again
                  </Button>
                ) : (
                  <Button className="w-full" onClick={handleRegister} disabled={!password || !confirmPassword || !challengeCode || !selectedLeagueId} data-testid="button-finance-register">
                    {mode === "reset" ? "Verify & Reset Password" : "Verify & Create Password"}
                  </Button>
                )}

                {mode === "reset" && (
                  <button onClick={() => { setMode("login"); setError(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors" data-testid="button-back-to-login">
                    ← Back to Sign In
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground text-center">Your session stays unlocked for 90 days</p>
      </Card>
    </div>
  );
}

// ─── Main Finance Tab ─────────────────────────────────────────────────────────

export function FinanceTab() {
  const { isConnected, user, leagues } = useSleeper();
  const [token, setToken] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [finances, setFinances] = useState<Record<string, LeagueFinanceData>>({});
  const [standings, setStandings] = useState<Record<string, LeagueStanding>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loadingFinances, setLoadingFinances] = useState(false);
  const [collapsedTiers, setCollapsedTiers] = useState<Set<string>>(() => new Set(["elite", "bubble", "rebuild"]));
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({}); 

  const dynastyLeagues = leagues.filter(l => l.status !== "archived");

  // Only show leagues where the user actually has a roster.
  // fetchLeagueStanding returns rank === -1 when no roster found (commissioner / co-owner roles, etc.)
  const visibleLeagues = dynastyLeagues.filter(l => {
    const s = standings[l.leagueId];
    if (s && !s.loading && !s.error && s.rank === -1) return false;
    return true;
  });

  useEffect(() => {
    if (!user?.userId) return;
    const stored = localStorage.getItem(tokenKey(user.userId));
    setToken(stored);
    setAuthChecked(true);
  }, [user?.userId]);

  function handleAuth(t: string) { setToken(t); setAuthChecked(true); }

  function handleLock() {
    if (!user?.userId) return;
    localStorage.removeItem(tokenKey(user.userId));
    setToken(null);
    setFinances({});
  }

  const authHeaders = useCallback((): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  useEffect(() => {
    if (!isConnected || !user?.userId || !token) return;
    setLoadingFinances(true);
    fetch(`${API_BASE}/api/finances/${user.userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { handleLock(); return null; } return r.json(); })
      .then((rows: any[] | null) => {
        if (!rows) return;
        const map: Record<string, LeagueFinanceData> = {};
        for (const row of rows) {
          map[row.leagueId] = { leagueId: row.leagueId, buyIn: row.buyIn ?? 0, prizes: (row.prizes as PrizeSlot[]) ?? [], notes: row.notes ?? "", isFree: row.isFree ?? false, ignored: row.ignored ?? false };
        }
        setFinances(map);
      })
      .catch(() => {})
      .finally(() => setLoadingFinances(false));
  }, [isConnected, user?.userId, token]);

  useEffect(() => {
    if (!isConnected || !user?.userId || dynastyLeagues.length === 0) return;
    dynastyLeagues.forEach(league => {
      setStandings(prev => ({
        ...prev,
        [league.leagueId]: { leagueId: league.leagueId, rank: -1, totalTeams: 0, wins: 0, losses: 0, ties: 0, ptsFor: 0, playoffSpots: 0, inPlayoffs: false, loading: true, error: false },
      }));
      fetchLeagueStanding(league.leagueId, user.userId)
        .then(s => setStandings(prev => ({ ...prev, [league.leagueId]: { leagueId: league.leagueId, ...s, loading: false, error: false } })))
        .catch(() => setStandings(prev => ({ ...prev, [league.leagueId]: { ...prev[league.leagueId], loading: false, error: true } })));
    });
  }, [isConnected, user?.userId, dynastyLeagues.length]);

  const getFinance = useCallback((leagueId: string): LeagueFinanceData =>
    finances[leagueId] ?? { ...DEFAULT_FINANCE, leagueId }, [finances]);

  const saveFinance = useCallback((leagueId: string, data: LeagueFinanceData) => {
    if (!user?.userId || !token) return;
    clearTimeout(saveTimers.current[leagueId]);
    setSaved(prev => ({ ...prev, [leagueId]: false }));
    saveTimers.current[leagueId] = setTimeout(async () => {
      setSaving(prev => ({ ...prev, [leagueId]: true }));
      try {
        const r = await fetch(`${API_BASE}/api/finances`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            sleeperUserId: user.userId, leagueId,
            season: dynastyLeagues.find(l => l.leagueId === leagueId)?.season ?? "2026",
            buyIn: data.buyIn, prizes: data.prizes, notes: data.notes,
            isFree: data.isFree, ignored: data.ignored,
          }),
        });
        if (r.status === 401) { handleLock(); return; }
        setSaved(prev => ({ ...prev, [leagueId]: true }));
        setTimeout(() => setSaved(prev => ({ ...prev, [leagueId]: false })), 2000);
      } catch {}
      setSaving(prev => ({ ...prev, [leagueId]: false }));
    }, 800);
  }, [user?.userId, token, dynastyLeagues, authHeaders]);

  const updateFinance = useCallback((leagueId: string, patch: Partial<LeagueFinanceData>) => {
    setFinances(prev => {
      const current = prev[leagueId] ?? { ...DEFAULT_FINANCE, leagueId };
      const updated = { ...current, ...patch };
      saveFinance(leagueId, updated);
      return { ...prev, [leagueId]: updated };
    });
  }, [saveFinance]);

  const addPrize = useCallback((leagueId: string) => {
    const f = getFinance(leagueId);
    const nextPlace = (f.prizes.length > 0 ? Math.max(...f.prizes.map(p => p.place)) : 0) + 1;
    updateFinance(leagueId, { prizes: [...f.prizes, { place: nextPlace, amount: 0 }] });
  }, [getFinance, updateFinance]);

  const removePrize = useCallback((leagueId: string, place: number) => {
    const f = getFinance(leagueId);
    updateFinance(leagueId, { prizes: f.prizes.filter(p => p.place !== place) });
  }, [getFinance, updateFinance]);

  const updatePrize = useCallback((leagueId: string, place: number, amount: number) => {
    const f = getFinance(leagueId);
    updateFinance(leagueId, { prizes: f.prizes.map(p => p.place === place ? { ...p, amount } : p) });
  }, [getFinance, updateFinance]);

  function calcPL(leagueId: string) {
    const f = getFinance(leagueId);
    const s = standings[leagueId];
    if (!s || s.loading || s.error || s.rank < 1 || f.prizes.length === 0) return null;
    const prizes = [...f.prizes].sort((a, b) => a.place - b.place);
    const maxPrizePlace = Math.max(...prizes.map(p => p.place));
    const probs = placementProbs(s, maxPrizePlace);
    let projectedPrize = 0;
    const breakdown = prizes.map(prize => {
      const prob = probs.get(prize.place) ?? 0;
      projectedPrize += prob * prize.amount;
      return { place: prize.place, amount: prize.amount, probability: prob };
    });
    return { projectedPrize, pl: projectedPrize - f.buyIn, breakdown };
  }

  const totals = visibleLeagues.reduce((acc, league) => {
    const f = getFinance(league.leagueId);
    if (f.ignored || f.isFree) return acc;
    const calc = calcPL(league.leagueId);
    acc.invested += f.buyIn;
    if (calc) { acc.expectedReturn += calc.projectedPrize; acc.netPL += calc.pl; acc.leaguesWithData++; }
    return acc;
  }, { invested: 0, expectedReturn: 0, netPL: 0, leaguesWithData: 0 });

  if (!isConnected || !user) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] px-4">
        <Card className="p-8 text-center max-w-sm w-full">
          <div className="w-14 h-14 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mx-auto mb-4">
            <DollarSign className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-bold mb-2">Connect Sleeper First</h3>
          <p className="text-sm text-muted-foreground">Link your Sleeper account in the Portfolio tab to track your league finances.</p>
        </Card>
      </div>
    );
  }

  if (!authChecked) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!token) {
    return <SleeperVerifyGate userId={user.userId} username={user.username} onAuth={handleAuth} />;
  }

  if (loadingFinances) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const plSign = totals.netPL > 0 ? "+" : "";

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span className="text-xs text-muted-foreground font-medium">Verified as @{user.username}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1.5 text-muted-foreground"
          onClick={handleLock}
          data-testid="button-lock-finances"
        >
          <LogOut className="w-3.5 h-3.5" /> Lock
        </Button>
      </div>

      {/* Summary Header */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 text-center">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Total Invested</p>
          <p className="text-xl font-bold text-foreground" data-testid="text-total-invested">{fmtDollar(totals.invested)}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Expected Return</p>
          <p className="text-xl font-bold text-foreground" data-testid="text-expected-return">{fmtDollar(totals.expectedReturn)}</p>
          {totals.leaguesWithData < visibleLeagues.length && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{totals.leaguesWithData} of {visibleLeagues.length} leagues</p>
          )}
        </Card>
        <Card className={`p-4 text-center border ${plBg(totals.netPL)}`}>
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Net P&L</p>
          <p className={`text-xl font-bold flex items-center justify-center gap-1 ${plColor(totals.netPL)}`} data-testid="text-net-pl">
            {totals.netPL > 0 ? <TrendingUp className="w-4 h-4" /> : totals.netPL < 0 ? <TrendingDown className="w-4 h-4" /> : null}
            {plSign}{fmtDollar(totals.netPL)}
          </p>
        </Card>
      </div>

      {visibleLeagues.length === 0 && !dynastyLeagues.some(l => { const s = standings[l.leagueId]; return !s || s.loading; }) && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground text-sm">No dynasty leagues found where you have an active team.</p>
        </Card>
      )}

      {/* Focus Zones Summary */}
      {visibleLeagues.length > 1 && (() => {
        const ORDER: (Tier | "unknown")[] = ["elite", "bubble", "rebuild", "unknown"];
        const groups: Record<Tier | "unknown", string[]> = { elite: [], bubble: [], rebuild: [], unknown: [] };
        visibleLeagues.forEach(l => groups[classifyTeam(standings[l.leagueId])].push(l.name));
        const readyCount = visibleLeagues.length - groups.unknown.length;
        if (readyCount === 0) return null;

        return (
          <Card className="p-4 space-y-3" data-testid="card-focus-zones">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
              <h3 className="text-xs font-bold uppercase tracking-wide">Focus Zones</h3>
              <span className="text-[10px] text-muted-foreground">— which leagues to prioritize this season</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["elite", "bubble", "rebuild"] as Tier[]).map(tier => {
                const cfg = TIER_CONFIG[tier];
                const names = groups[tier];
                const Icon = tier === "elite" ? Flame : tier === "bubble" ? Target : Wrench;
                return (
                  <div key={tier} className={`rounded-xl border p-3 space-y-2 ${cfg.bgCls}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Icon className={`w-3 h-3 ${cfg.headerCls}`} />
                        <span className={`text-[11px] font-bold uppercase tracking-wide ${cfg.headerCls}`}>{cfg.short}</span>
                      </div>
                      <span className={`text-xl font-bold leading-none ${cfg.headerCls}`}>{names.length}</span>
                    </div>
                    <p className={`text-[10px] leading-snug ${cfg.headerCls} opacity-75`}>{cfg.desc}</p>
                    {names.length > 0 && (
                      <div className="border-t border-current/10 pt-1.5 space-y-0.5">
                        {names.map(n => (
                          <p key={n} className={`text-[10px] truncate ${cfg.headerCls} opacity-65`}>· {n}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {groups.unknown.length > 0 && (
              <p className="text-[10px] text-muted-foreground text-center">
                {groups.unknown.length} league{groups.unknown.length > 1 ? "s" : ""} still loading standings…
              </p>
            )}
          </Card>
        );
      })()}

      {/* Per-League Cards (grouped by tier) */}
      {visibleLeagues.length > 0 && (() => {
        const ORDER: (Tier | "unknown")[] = ["elite", "bubble", "rebuild", "unknown"];
        const groups = new Map<Tier | "unknown", typeof visibleLeagues>();
        ORDER.forEach(t => groups.set(t, []));
        const ignoredLeagues: typeof visibleLeagues = [];
        visibleLeagues.forEach(l => {
          const f = getFinance(l.leagueId);
          if (f.ignored) { ignoredLeagues.push(l); return; }
          groups.get(classifyTeam(standings[l.leagueId]))!.push(l);
        });
        const activeTiers = ORDER.filter(t => t !== "unknown" && (groups.get(t)?.length ?? 0) > 0) as Tier[];
        const showHeaders = visibleLeagues.length > 1 && activeTiers.length > 1;

        const mainGroups = ORDER.filter(t => (groups.get(t)?.length ?? 0) > 0).map(tier => {
          const cfg = tier !== "unknown" ? TIER_CONFIG[tier] : null;
          const Icon = tier === "elite" ? Flame : tier === "bubble" ? Target : Wrench;
          const isCollapsed = showHeaders && tier !== "unknown" && collapsedTiers.has(tier);
          const toggleTier = () => setCollapsedTiers(prev => {
            const next = new Set(prev);
            next.has(tier) ? next.delete(tier) : next.add(tier);
            return next;
          });
          return (
            <div key={`group-${tier}`} className="space-y-3">
              {showHeaders && tier !== "unknown" && cfg && (
                <button
                  onClick={toggleTier}
                  className={`w-full flex items-center gap-2 pt-1 ${cfg.headerCls} hover:opacity-80 transition-opacity`}
                  data-testid={`tier-header-${tier}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold uppercase tracking-wide">{cfg.label}</span>
                  <span className="text-[10px] opacity-60">({groups.get(tier)!.length})</span>
                  <div className="flex-1 h-px bg-current opacity-20" />
                  {isCollapsed
                    ? <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                    : <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
                </button>
              )}
              {!isCollapsed && groups.get(tier)!.map(league => {
                const f = getFinance(league.leagueId);
                const s = standings[league.leagueId];
                const calc = calcPL(league.leagueId);
                const isExpanded = expanded === league.leagueId;
                const leagueTier = tier !== "unknown" ? tier : undefined;
                const tierCfg = leagueTier ? TIER_CONFIG[leagueTier] : null;
                const playoffPct = s && !s.loading && !s.error && s.rank > 0 ? approxPlayoffPct(s) : null;

        return (
          <Card key={league.leagueId} className="overflow-hidden" data-testid={`finance-card-${league.leagueId}`}>
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors text-left"
              onClick={() => setExpanded(isExpanded ? null : league.leagueId)}
              data-testid={`toggle-finance-${league.leagueId}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center relative">
                  <Trophy className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
                  {league.avatar && (
                    <img
                      src={`https://sleepercdn.com/avatars/thumbs/${league.avatar}`}
                      alt={league.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      data-testid={`img-league-avatar-${league.leagueId}`}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{league.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">{league.totalRosters} teams · {league.scoringFormat} {league.format} · {league.season}</span>
                    {s && !s.loading && !s.error && s.rank > 0 && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${s.inPlayoffs ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {s.inPlayoffs ? "🏆 " : ""}#{s.rank} of {s.totalTeams}
                      </Badge>
                    )}
                    {tierCfg && playoffPct !== null && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${tierCfg.badgeCls}`}>
                        ~{playoffPct}% playoffs
                      </Badge>
                    )}
                    {(() => {
                      const ps = paymentStatus(f);
                      const psc = PAYMENT_STATUS_CONFIG[ps];
                      return (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 flex items-center gap-1 ${psc.cls}`} data-testid={`badge-payment-status-${league.leagueId}`}>
                          <span className={`w-1.5 h-1.5 rounded-full inline-block ${psc.dot}`} />
                          {psc.label}
                        </Badge>
                      );
                    })()}
                    {s?.loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                {saving[league.leagueId] && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                {saved[league.leagueId] && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                <div className="hidden sm:flex items-center gap-3 text-right">
                  {f.buyIn > 0 && (
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Buy-in</p>
                      <p className="text-xs font-semibold">{fmtDollar(f.buyIn)}</p>
                    </div>
                  )}
                  {calc && (
                    <div className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${plBg(calc.pl)} ${plColor(calc.pl)}`} data-testid={`pl-${league.leagueId}`}>
                      {calc.pl >= 0 ? "+" : ""}{fmtDollar(calc.pl)}
                    </div>
                  )}
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-border/40 p-4 space-y-5">
                {s && !s.loading && !s.error && s.rank > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Standing", value: `#${s.rank}/${s.totalTeams}` },
                      { label: "Record", value: `${s.wins}-${s.losses}${s.ties > 0 ? `-${s.ties}` : ""}` },
                      { label: "Pts For", value: s.ptsFor.toFixed(1) },
                    ].map(item => (
                      <div key={item.label} className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground mb-0.5">{item.label}</p>
                        <p className="text-base font-bold">{item.value}</p>
                      </div>
                    ))}
                    <div className={`rounded-lg p-3 text-center border ${s.inPlayoffs ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30" : "bg-muted/30 border-border/30"}`}>
                      <p className="text-[10px] text-muted-foreground mb-0.5">Playoff Odds</p>
                      <p className={`text-base font-bold ${s.inPlayoffs ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                        ~{approxPlayoffPct(s)}%
                      </p>
                      <p className={`text-[10px] mt-0.5 ${s.inPlayoffs ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {s.inPlayoffs ? "In ✓" : `${s.rank - s.playoffSpots} back`}
                      </p>
                    </div>
                  </div>
                )}
                {s?.error && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Could not load standings for this league.</span>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Buy-in Amount</label>
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number" min="0" className="pl-7"
                      value={f.buyIn || ""} placeholder="0"
                      onChange={e => updateFinance(league.leagueId, { buyIn: parseFloat(e.target.value) || 0 })}
                      data-testid={`input-buyin-${league.leagueId}`}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-foreground">Prize Structure</label>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => addPrize(league.leagueId)} data-testid={`button-add-prize-${league.leagueId}`}>
                      <Plus className="w-3 h-3" /> Add Place
                    </Button>
                  </div>
                  {f.prizes.length === 0 && <p className="text-xs text-muted-foreground italic">No prizes configured. Add prize positions above.</p>}
                  <div className="space-y-2">
                    {f.prizes.sort((a, b) => a.place - b.place).map(prize => {
                      const placeLabel = prize.place === 1 ? "🥇 1st" : prize.place === 2 ? "🥈 2nd" : prize.place === 3 ? "🥉 3rd" : `${prize.place}th`;
                      const isCurrentRank = s && !s.loading && s.rank === prize.place;
                      const prob = calc?.breakdown.find(b => b.place === prize.place)?.probability ?? 0;
                      const probPct = Math.round(prob * 1000) / 10;
                      const probBadgeCls = probPct >= 30
                        ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                        : probPct >= 10
                        ? "border-[#d4af37]/50 text-amber-600 dark:text-amber-400"
                        : "border-border/40 text-muted-foreground";
                      return (
                        <div key={prize.place} className={`flex items-center gap-3 p-2.5 rounded-lg border ${isCurrentRank ? "border-[#d4af37]/40 bg-[#d4af37]/5" : "border-border/30 bg-muted/20"}`}
                          data-testid={`prize-row-${league.leagueId}-${prize.place}`}>
                          <span className="text-sm font-semibold w-16 flex-shrink-0">{placeLabel}</span>
                          {probPct > 0 ? (
                            <Badge variant="outline" className={`text-[10px] px-1.5 h-4 flex-shrink-0 ${probBadgeCls}`}
                              data-testid={`badge-prob-${league.leagueId}-${prize.place}`}>
                              ~{probPct}%
                            </Badge>
                          ) : isCurrentRank ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-[#d4af37]/50 text-amber-600 dark:text-amber-400 flex-shrink-0">Now</Badge>
                          ) : null}
                          <div className="relative flex-1 max-w-[120px]">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                            <Input
                              type="number" min="0" className="pl-7 h-8 text-sm"
                              value={prize.amount || ""} placeholder="0"
                              onChange={e => updatePrize(league.leagueId, prize.place, parseFloat(e.target.value) || 0)}
                              data-testid={`input-prize-${league.leagueId}-${prize.place}`}
                            />
                          </div>
                          <button onClick={() => removePrize(league.leagueId, prize.place)} className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0" data-testid={`button-remove-prize-${league.leagueId}-${prize.place}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(f.buyIn > 0 || f.prizes.length > 0) && (
                  <div className={`rounded-xl p-4 border ${calc ? plBg(calc.pl) : "bg-muted/20 border-border/30"}`}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-6 min-w-0">
                        <div className="flex-shrink-0">
                          <p className="text-[10px] text-muted-foreground">Buy-in</p>
                          <p className="text-sm font-semibold">{fmtDollar(f.buyIn)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] text-muted-foreground">Expected Prize</p>
                          <p className="text-sm font-semibold">{calc ? fmtDollar(Math.round(calc.projectedPrize)) : "—"}</p>
                          {calc && (
                            <p className="text-[10px] text-muted-foreground truncate max-w-[160px]" title="Probability-weighted across all prize positions">
                              {calc.breakdown.filter(b => b.probability >= 0.01).map(b => {
                                const ord = b.place === 1 ? "1st" : b.place === 2 ? "2nd" : b.place === 3 ? "3rd" : `${b.place}th`;
                                return `${ord} ~${Math.round(b.probability * 1000) / 10}%`;
                              }).join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>
                      {calc ? (
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] text-muted-foreground mb-0.5">Expected P&L</p>
                          <p className={`text-2xl font-bold ${plColor(calc.pl)}`}>{calc.pl >= 0 ? "+" : ""}{fmtDollar(Math.round(calc.pl))}</p>
                          <p className="text-[10px] text-muted-foreground">rank #{s?.rank} · prob-weighted</p>
                        </div>
                      ) : f.prizes.length > 0 && s && !s.loading ? (
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] text-muted-foreground mb-0.5">Expected P&L</p>
                          <p className={`text-2xl font-bold ${plColor(-f.buyIn)}`}>{fmtDollar(-f.buyIn)}</p>
                          <p className="text-[10px] text-muted-foreground">standings loading…</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Notes</label>
                  <Input
                    placeholder="e.g. best ball rules, side bets…"
                    value={f.notes}
                    onChange={e => updateFinance(league.leagueId, { notes: e.target.value })}
                    className="text-sm"
                    data-testid={`input-notes-${league.leagueId}`}
                  />
                </div>

                {/* League flags */}
                <div className="flex flex-wrap gap-2 pt-1 border-t border-border/30">
                  <button
                    onClick={() => updateFinance(league.leagueId, { isFree: !f.isFree, buyIn: !f.isFree ? 0 : f.buyIn, prizes: !f.isFree ? [] : f.prizes })}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      f.isFree
                        ? "bg-sky-50 dark:bg-sky-950/30 border-sky-400/50 text-sky-600 dark:text-sky-400"
                        : "border-border/50 text-muted-foreground hover:border-sky-400/50 hover:text-sky-600 dark:hover:text-sky-400"
                    }`}
                    data-testid={`button-toggle-free-${league.leagueId}`}
                  >
                    <Tag className="w-3 h-3" />
                    {f.isFree ? "Free League ✓" : "Mark as Free League"}
                  </button>
                  <button
                    onClick={() => updateFinance(league.leagueId, { ignored: !f.ignored })}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      f.ignored
                        ? "bg-muted border-border text-muted-foreground"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                    data-testid={`button-toggle-ignore-${league.leagueId}`}
                  >
                    {f.ignored ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {f.ignored ? "Unhide League" : "Hide from Summary"}
                  </button>
                </div>
              </div>
            )}
          </Card>
                );
              })}
            </div>
          );
        });

        return (
          <>
            {mainGroups}
            {ignoredLeagues.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2 text-muted-foreground/60">
                  <EyeOff className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">Hidden Leagues ({ignoredLeagues.length})</span>
                  <div className="flex-1 h-px bg-border/30" />
                </div>
                {ignoredLeagues.map(league => {
                  const f = getFinance(league.leagueId);
                  const isExpanded = expanded === league.leagueId;
                  return (
                    <Card key={league.leagueId} className="overflow-hidden opacity-50 hover:opacity-80 transition-opacity" data-testid={`finance-card-hidden-${league.leagueId}`}>
                      <button
                        className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors text-left"
                        onClick={() => setExpanded(isExpanded ? null : league.leagueId)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <EyeOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm text-muted-foreground truncate">{league.name}</span>
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </button>
                      {isExpanded && (
                        <div className="border-t border-border/30 px-4 py-3">
                          <button
                            onClick={() => updateFinance(league.leagueId, { ignored: false })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                            data-testid={`button-unhide-${league.leagueId}`}
                          >
                            <Eye className="w-3 h-3" /> Unhide League
                          </button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

    </div>
  );
}
