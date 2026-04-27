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
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  LogOut,
} from "lucide-react";

interface PrizeSlot {
  place: number;
  amount: number;
}

interface LeagueFinanceData {
  leagueId: string;
  buyIn: number;
  prizes: PrizeSlot[];
  notes: string;
}

interface LeagueStanding {
  leagueId: string;
  rank: number;
  totalTeams: number;
  wins: number;
  losses: number;
  ties: number;
  ptsFor: number;
  playoffSpots: number;
  inPlayoffs: boolean;
  loading: boolean;
  error: boolean;
}

const SLEEPER_API = "https://api.sleeper.app/v1";

async function fetchLeagueStanding(leagueId: string, userId: string): Promise<Omit<LeagueStanding, "leagueId" | "loading" | "error">> {
  const [rostersRaw, leagueRaw] = await Promise.all([
    fetch(`${SLEEPER_API}/league/${leagueId}/rosters`).then(r => r.json()),
    fetch(`${SLEEPER_API}/league/${leagueId}`).then(r => r.json()),
  ]);
  const rosters: any[] = rostersRaw || [];
  const playoffTeams: number = leagueRaw?.settings?.playoff_teams ?? Math.floor((leagueRaw?.total_rosters ?? 12) / 3);
  const sorted = [...rosters].sort((a, b) => {
    const wA = a.settings?.wins ?? 0;
    const wB = b.settings?.wins ?? 0;
    if (wB !== wA) return wB - wA;
    const pfA = (a.settings?.fpts ?? 0) + (a.settings?.fpts_decimal ?? 0) / 100;
    const pfB = (b.settings?.fpts ?? 0) + (b.settings?.fpts_decimal ?? 0) / 100;
    return pfB - pfA;
  });
  const userRoster = rosters.find((r: any) => r.owner_id === userId);
  const rank = userRoster ? sorted.findIndex((r: any) => r.roster_id === userRoster.roster_id) + 1 : -1;
  return {
    rank,
    totalTeams: rosters.length,
    wins: userRoster?.settings?.wins ?? 0,
    losses: userRoster?.settings?.losses ?? 0,
    ties: userRoster?.settings?.ties ?? 0,
    ptsFor: (userRoster?.settings?.fpts ?? 0) + (userRoster?.settings?.fpts_decimal ?? 0) / 100,
    playoffSpots: playoffTeams,
    inPlayoffs: rank > 0 && rank <= playoffTeams,
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

function tokenKey(userId: string) {
  return `dc-finance-token-${userId}`;
}

// ─── Auth Gate ────────────────────────────────────────────────────────────────

type AuthMode = "checking" | "no-password" | "login" | "authed";

function PasswordGate({ userId, onAuth }: { userId: string; onAuth: (token: string) => void }) {
  const [mode, setMode] = useState<AuthMode>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/has-password/${userId}`)
      .then(r => r.json())
      .then(data => setMode(data.hasPassword ? "login" : "no-password"))
      .catch(() => setMode("login"));
  }, [userId]);

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleeperId: userId, password }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Failed to set password."); return; }
      localStorage.setItem(tokenKey(userId), data.token);
      onAuth(data.token);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleeperId: userId, password }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Incorrect password."); return; }
      localStorage.setItem(tokenKey(userId), data.token);
      onAuth(data.token);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }

  if (mode === "checking") {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <Card className="p-8 w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-[#0b3a7a]/10 dark:bg-blue-400/10 flex items-center justify-center mx-auto">
            {mode === "no-password" ? (
              <ShieldCheck className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400" />
            ) : (
              <Lock className="w-7 h-7 text-[#0b3a7a] dark:text-blue-400" />
            )}
          </div>
          <h3 className="text-lg font-bold">
            {mode === "no-password" ? "Secure Your Finances" : "Finance Login"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {mode === "no-password"
              ? "Create a password to protect your investment data. Only you can access it."
              : "Enter your password to view and edit your financial data."}
          </p>
        </div>

        <form onSubmit={mode === "no-password" ? handleSetPassword : handleLogin} className="space-y-3">
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              placeholder={mode === "no-password" ? "Create a password (min 6 chars)" : "Enter password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              className="pr-10"
              autoFocus
              data-testid="input-finance-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {mode === "no-password" && (
            <Input
              type={showPw ? "text" : "password"}
              placeholder="Confirm password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(""); }}
              data-testid="input-finance-confirm"
            />
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-500" data-testid="text-auth-error">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading} data-testid="button-finance-auth-submit">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "no-password" ? "Set Password & Continue" : "Unlock Finances"}
          </Button>
        </form>

        {mode === "no-password" && (
          <p className="text-[11px] text-muted-foreground text-center">
            Your password is stored securely (bcrypt hashed). It is not linked to Sleeper.
          </p>
        )}
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
  const [showChangePw, setShowChangePw] = useState(false);
  const [changePwFields, setChangePwFields] = useState({ current: "", next: "", confirm: "" });
  const [changePwError, setChangePwError] = useState("");
  const [changePwLoading, setChangePwLoading] = useState(false);
  const [changePwOk, setChangePwOk] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dynastyLeagues = leagues.filter(l => l.status !== "archived");

  // Check localStorage token on mount
  useEffect(() => {
    if (!user?.userId) return;
    const stored = localStorage.getItem(tokenKey(user.userId));
    setToken(stored);
    setAuthChecked(true);
  }, [user?.userId]);

  function handleAuth(t: string) {
    setToken(t);
    setAuthChecked(true);
  }

  function handleLock() {
    if (!user?.userId) return;
    localStorage.removeItem(tokenKey(user.userId));
    setToken(null);
    setFinances({});
  }

  // Auth headers helper
  const authHeaders = useCallback((): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  // Load saved finance data from backend (only when authed)
  useEffect(() => {
    if (!isConnected || !user?.userId || !token) return;
    setLoadingFinances(true);
    fetch(`${API_BASE}/api/finances/${user.userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (r.status === 401) { handleLock(); return []; }
        return r.json();
      })
      .then((rows: any[]) => {
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

  // Load standings for all leagues
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
            sleeperUserId: user.userId,
            leagueId,
            season: dynastyLeagues.find(l => l.leagueId === leagueId)?.season ?? "2026",
            buyIn: data.buyIn,
            prizes: data.prizes,
            notes: data.notes,
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

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setChangePwError("");
    if (changePwFields.next.length < 6) { setChangePwError("New password must be at least 6 characters."); return; }
    if (changePwFields.next !== changePwFields.confirm) { setChangePwError("Passwords don't match."); return; }
    setChangePwLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ sleeperId: user?.userId, currentPassword: changePwFields.current, newPassword: changePwFields.next }),
      });
      const data = await r.json();
      if (!r.ok) { setChangePwError(data.error || "Failed to change password."); return; }
      localStorage.setItem(tokenKey(user!.userId), data.token);
      setToken(data.token);
      setChangePwOk(true);
      setShowChangePw(false);
      setChangePwFields({ current: "", next: "", confirm: "" });
    } catch { setChangePwError("Network error. Please try again."); }
    finally { setChangePwLoading(false); }
  }

  const totals = dynastyLeagues.reduce((acc, league) => {
    const f = getFinance(league.leagueId);
    const calc = calcPL(league.leagueId);
    acc.invested += f.buyIn;
    if (calc) { acc.expectedReturn += calc.projectedPrize; acc.netPL += calc.pl; acc.leaguesWithData++; }
    return acc;
  }, { invested: 0, expectedReturn: 0, netPL: 0, leaguesWithData: 0 });

  // Not connected guard
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

  // Checking stored token
  if (!authChecked) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show password gate if no valid token
  if (!token) {
    return <PasswordGate userId={user.userId} onAuth={handleAuth} />;
  }

  if (loadingFinances) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const plSign = totals.netPL > 0 ? "+" : "";

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">

      {/* Header with lock button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span className="text-xs text-muted-foreground font-medium">Finance data is protected</span>
        </div>
        <div className="flex items-center gap-2">
          {changePwOk && (
            <span className="text-xs text-emerald-500 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Password updated
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1.5 text-muted-foreground"
            onClick={() => { setShowChangePw(v => !v); setChangePwError(""); setChangePwOk(false); }}
            data-testid="button-change-password"
          >
            <KeyRound className="w-3.5 h-3.5" /> Change Password
          </Button>
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
      </div>

      {/* Change password form */}
      {showChangePw && (
        <Card className="p-4">
          <form onSubmit={handleChangePassword} className="space-y-3">
            <p className="text-sm font-semibold mb-1">Change Finance Password</p>
            <Input
              type="password"
              placeholder="Current password"
              value={changePwFields.current}
              onChange={e => setChangePwFields(f => ({ ...f, current: e.target.value }))}
              data-testid="input-current-password"
            />
            <Input
              type="password"
              placeholder="New password (min 6 chars)"
              value={changePwFields.next}
              onChange={e => setChangePwFields(f => ({ ...f, next: e.target.value }))}
              data-testid="input-new-password"
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={changePwFields.confirm}
              onChange={e => setChangePwFields(f => ({ ...f, confirm: e.target.value }))}
              data-testid="input-confirm-new-password"
            />
            {changePwError && (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{changePwError}</span>
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={changePwLoading} data-testid="button-submit-change-password">
                {changePwLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update Password"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setShowChangePw(false); setChangePwError(""); }}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

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
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Standing</p>
                      <p className="text-base font-bold">#{s.rank}<span className="text-xs font-normal text-muted-foreground">/{s.totalTeams}</span></p>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Record</p>
                      <p className="text-base font-bold">{s.wins}-{s.losses}{s.ties > 0 ? `-${s.ties}` : ""}</p>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Pts For</p>
                      <p className="text-base font-bold">{s.ptsFor.toFixed(1)}</p>
                    </div>
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
                      type="number"
                      min="0"
                      className="pl-7"
                      value={f.buyIn || ""}
                      placeholder="0"
                      onChange={e => updateFinance(league.leagueId, { buyIn: parseFloat(e.target.value) || 0 })}
                      data-testid={`input-buyin-${league.leagueId}`}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-foreground">Prize Structure</label>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => addPrize(league.leagueId)}
                      data-testid={`button-add-prize-${league.leagueId}`}
                    >
                      <Plus className="w-3 h-3" /> Add Place
                    </Button>
                  </div>
                  {f.prizes.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No prizes configured. Add prize positions above.</p>
                  )}
                  <div className="space-y-2">
                    {f.prizes.sort((a, b) => a.place - b.place).map(prize => {
                      const placeLabel = prize.place === 1 ? "🥇 1st" : prize.place === 2 ? "🥈 2nd" : prize.place === 3 ? "🥉 3rd" : `${prize.place}th`;
                      const isUserPlace = s && !s.loading && s.rank === prize.place;
                      return (
                        <div key={prize.place} className={`flex items-center gap-3 p-2.5 rounded-lg border ${isUserPlace ? "border-[#d4af37]/40 bg-[#d4af37]/5" : "border-border/30 bg-muted/20"}`}
                          data-testid={`prize-row-${league.leagueId}-${prize.place}`}>
                          <span className="text-sm font-semibold w-16 flex-shrink-0">{placeLabel}</span>
                          {isUserPlace && (
                            <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-[#d4af37]/50 text-amber-600 dark:text-amber-400 flex-shrink-0">Your Rank</Badge>
                          )}
                          <div className="relative flex-1 max-w-[120px]">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                            <Input
                              type="number"
                              min="0"
                              className="pl-7 h-8 text-sm"
                              value={prize.amount || ""}
                              placeholder="0"
                              onChange={e => updatePrize(league.leagueId, prize.place, parseFloat(e.target.value) || 0)}
                              data-testid={`input-prize-${league.leagueId}-${prize.place}`}
                            />
                          </div>
                          <button
                            onClick={() => removePrize(league.leagueId, prize.place)}
                            className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                            data-testid={`button-remove-prize-${league.leagueId}-${prize.place}`}
                          >
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
                      <div className="space-y-1">
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
                      </div>
                      {calc && (
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground mb-0.5">Net P&L</p>
                          <p className={`text-2xl font-bold ${plColor(calc.pl)}`}>
                            {calc.pl >= 0 ? "+" : ""}{fmtDollar(calc.pl)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">based on current rank #{s?.rank}</p>
                        </div>
                      )}
                      {!calc && f.prizes.length > 0 && s && !s.loading && (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">No prize at rank #{s?.rank}</p>
                          <p className={`text-2xl font-bold ${plColor(-f.buyIn)}`}>{fmtDollar(-f.buyIn)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Notes</label>
                  <Input
                    placeholder="e.g. best ball rules, side bets..."
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
