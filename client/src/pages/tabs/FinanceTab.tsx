import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  SmartphoneNfc,
  ChevronRight,
} from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

interface PrizeSlot { place: number; amount: number; }
interface LeagueFinanceData { leagueId: string; buyIn: number; prizes: PrizeSlot[]; notes: string; }
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
  const rank = userRoster ? sorted.findIndex((r: any) => r.roster_id === userRoster.roster_id) + 1 : -1;
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

const DEFAULT_FINANCE: LeagueFinanceData = { leagueId: "", buyIn: 0, prizes: [], notes: "" };
function tokenKey(userId: string) { return `dc-finance-token-${userId}`; }

// ─── Sleeper Login Gate ────────────────────────────────────────────────────────

type GateMethod = "otp" | "challenge";
type OtpStep = "send" | "enter";

function SleeperVerifyGate({ userId, username, onAuth }: { userId: string; username: string; onAuth: (token: string) => void }) {
  const [method, setMethod] = useState<GateMethod>("otp");
  const [otpStep, setOtpStep] = useState<OtpStep>("send");
  const [login, setLogin] = useState(username);
  const [otp, setOtp] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  // ── Challenge fallback state ──
  const [challengeCode, setChallengeCode] = useState<string | null>(null);
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSendCode() {
    setSendingCode(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/auth/sleeper-send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Could not send code. Check your username/email."); return; }
      setOtpStep("enter");
    } catch { setError("Network error. Please try again."); }
    finally { setSendingCode(false); }
  }

  async function handleVerifyOtp() {
    if (otp.length < 6) { setError("Please enter the full 6-digit code."); return; }
    setVerifying(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/auth/sleeper-verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), code: otp, expectedSleeperId: userId }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Incorrect code. Please try again."); return; }
      localStorage.setItem(tokenKey(userId), data.token);
      onAuth(data.token);
    } catch { setError("Network error. Please try again."); }
    finally { setVerifying(false); }
  }

  async function loadChallenge() {
    setLoadingChallenge(true);
    setError("");
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
    finally { setLoadingChallenge(false); }
  }

  async function handleVerifyChallenge() {
    setVerifying(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleeperId: userId }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Verification failed."); return; }
      localStorage.setItem(tokenKey(userId), data.token);
      onAuth(data.token);
    } catch { setError("Network error. Please try again."); }
    finally { setVerifying(false); }
  }

  function switchMethod(m: GateMethod) {
    setMethod(m);
    setError("");
    setOtp("");
    setOtpStep("send");
    if (m === "challenge" && !challengeCode) loadChallenge();
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <Card className="p-8 w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-bold">Verify Your Identity</h3>
          <p className="text-sm text-muted-foreground">
            Finances are protected. Verify your Sleeper account to continue as <span className="font-semibold text-foreground">@{username}</span>.
          </p>
        </div>

        {/* Method toggle */}
        <div className="flex rounded-xl border border-border/60 overflow-hidden text-sm font-medium">
          <button
            onClick={() => switchMethod("otp")}
            className={`flex-1 py-2.5 transition-colors ${method === "otp" ? "bg-[#0b3a7a] dark:bg-blue-700 text-white" : "text-muted-foreground hover:bg-muted/40"}`}
            data-testid="tab-otp"
          >
            SMS / Email Code
          </button>
          <button
            onClick={() => switchMethod("challenge")}
            className={`flex-1 py-2.5 transition-colors ${method === "challenge" ? "bg-[#0b3a7a] dark:bg-blue-700 text-white" : "text-muted-foreground hover:bg-muted/40"}`}
            data-testid="tab-challenge"
          >
            Display Name
          </button>
        </div>

        {/* ── OTP method ── */}
        {method === "otp" && (
          <div className="space-y-4">
            {otpStep === "send" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Sleeper Username, Email, or Phone</label>
                  <Input
                    value={login}
                    onChange={e => { setLogin(e.target.value); setError(""); }}
                    placeholder="username, email@example.com, or +1..."
                    data-testid="input-sleeper-login"
                  />
                  <p className="text-[11px] text-muted-foreground">Sleeper will send a 6-digit code to your registered phone or email.</p>
                </div>

                {error && (
                  <div className="flex items-start gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 rounded-lg px-3 py-2.5" data-testid="text-otp-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button className="w-full" onClick={handleSendCode} disabled={sendingCode || !login.trim()} data-testid="button-send-code">
                  {sendingCode ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Sending…</> : "Send Verification Code"}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2 text-center">
                  <p className="text-sm text-muted-foreground">Enter the 6-digit code sent to your Sleeper-registered phone or email.</p>
                  <div className="flex justify-center pt-1">
                    <InputOTP
                      maxLength={6}
                      value={otp}
                      onChange={v => { setOtp(v); setError(""); }}
                      data-testid="input-otp-code"
                    >
                      <InputOTPGroup>
                        {[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 rounded-lg px-3 py-2.5" data-testid="text-otp-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button className="w-full" onClick={handleVerifyOtp} disabled={verifying || otp.length < 6} data-testid="button-verify-otp">
                  {verifying ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Verifying…</> : "Verify & Unlock Finances"}
                </Button>

                <button onClick={() => { setOtpStep("send"); setOtp(""); setError(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors" data-testid="button-back-to-send">
                  ← Didn't receive a code? Try again
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Display name challenge method ── */}
        {method === "challenge" && (
          <div className="space-y-4">
            {loadingChallenge ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : challengeCode ? (
              <>
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground text-center font-medium uppercase tracking-wide">Your verification code</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted/50 rounded-xl border border-border/60 px-4 py-3 text-center">
                      <span className="text-2xl font-mono font-bold tracking-widest text-[#0b3a7a] dark:text-blue-300" data-testid="text-challenge-code">{challengeCode}</span>
                    </div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(challengeCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                      className="p-3 rounded-xl border border-border/60 hover:bg-muted/50 transition-colors text-muted-foreground"
                      data-testid="button-copy-code"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button onClick={() => { setChallengeCode(null); loadChallenge(); }} className="p-3 rounded-xl border border-border/60 hover:bg-muted/50 transition-colors text-muted-foreground" data-testid="button-refresh-code">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <ol className="space-y-2 text-sm">
                  {[
                    <>Open Sleeper → tap your avatar → <strong>Edit Profile</strong></>,
                    <>Set your <strong>Display Name</strong> to: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{challengeCode}</code></>,
                    <>Click <strong>Verify</strong> below, then change your name back</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-5 h-5 rounded-full bg-[#0b3a7a]/10 dark:bg-blue-400/10 text-[#0b3a7a] dark:text-blue-400 flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                      <span className="text-muted-foreground leading-snug">{step}</span>
                    </li>
                  ))}
                </ol>

                {error && (
                  <div className="flex items-start gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 rounded-lg px-3 py-2.5" data-testid="text-challenge-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button className="w-full" onClick={handleVerifyChallenge} disabled={verifying} data-testid="button-verify-challenge">
                  {verifying ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Checking…</> : "Verify & Unlock Finances"}
                </Button>
              </>
            ) : (
              <Button variant="outline" className="w-full" onClick={loadChallenge}>Generate Code</Button>
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
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dynastyLeagues = leagues.filter(l => l.status !== "archived");

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
          map[row.leagueId] = { leagueId: row.leagueId, buyIn: row.buyIn ?? 0, prizes: (row.prizes as PrizeSlot[]) ?? [], notes: row.notes ?? "" };
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
    const matchingPrize = f.prizes.find(p => p.place === s.rank);
    const projectedPrize = matchingPrize?.amount ?? 0;
    return { projectedPrize, pl: projectedPrize - f.buyIn };
  }

  const totals = dynastyLeagues.reduce((acc, league) => {
    const f = getFinance(league.leagueId);
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
          {totals.leaguesWithData < dynastyLeagues.length && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{totals.leaguesWithData} of {dynastyLeagues.length} leagues</p>
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

      {dynastyLeagues.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground text-sm">No dynasty leagues found for your account.</p>
        </Card>
      )}

      {/* Per-League Cards */}
      {dynastyLeagues.map(league => {
        const f = getFinance(league.leagueId);
        const s = standings[league.leagueId];
        const calc = calcPL(league.leagueId);
        const isExpanded = expanded === league.leagueId;

        return (
          <Card key={league.leagueId} className="overflow-hidden" data-testid={`finance-card-${league.leagueId}`}>
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors text-left"
              onClick={() => setExpanded(isExpanded ? null : league.leagueId)}
              data-testid={`toggle-finance-${league.leagueId}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center flex-shrink-0">
                  <Trophy className="w-4 h-4 text-[#0b3a7a] dark:text-blue-400" />
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
                      <p className="text-[10px] text-muted-foreground mb-0.5">Playoffs</p>
                      <p className={`text-base font-bold ${s.inPlayoffs ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                        {s.inPlayoffs ? "In ✓" : "Out"}
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
                      const isUserPlace = s && !s.loading && s.rank === prize.place;
                      return (
                        <div key={prize.place} className={`flex items-center gap-3 p-2.5 rounded-lg border ${isUserPlace ? "border-[#d4af37]/40 bg-[#d4af37]/5" : "border-border/30 bg-muted/20"}`}
                          data-testid={`prize-row-${league.leagueId}-${prize.place}`}>
                          <span className="text-sm font-semibold w-16 flex-shrink-0">{placeLabel}</span>
                          {isUserPlace && <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-[#d4af37]/50 text-amber-600 dark:text-amber-400 flex-shrink-0">Your Rank</Badge>}
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-6">
                        <div>
                          <p className="text-[10px] text-muted-foreground">Buy-in</p>
                          <p className="text-sm font-semibold">{fmtDollar(f.buyIn)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Projected Prize</p>
                          <p className="text-sm font-semibold">{calc ? fmtDollar(calc.projectedPrize) : "—"}</p>
                        </div>
                      </div>
                      {calc ? (
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground mb-0.5">Net P&L</p>
                          <p className={`text-2xl font-bold ${plColor(calc.pl)}`}>{calc.pl >= 0 ? "+" : ""}{fmtDollar(calc.pl)}</p>
                          <p className="text-[10px] text-muted-foreground">current rank #{s?.rank}</p>
                        </div>
                      ) : f.prizes.length > 0 && s && !s.loading ? (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">No prize at rank #{s?.rank}</p>
                          <p className={`text-2xl font-bold ${plColor(-f.buyIn)}`}>{fmtDollar(-f.buyIn)}</p>
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
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
