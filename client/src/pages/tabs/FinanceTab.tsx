import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { API_BASE } from "@/lib/apiBase";
import { getSleeperSession, isSessionExpired } from "@/services/sleeperAuth";
import { SleeperAuthCard } from "@/components/SleeperAuthCard";
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
  ptsFor: number; playoffSpots: number; inPlayoffs: boolean;
  valueRank: number;         // integer rank by roster redraft value (1=best)
  valueCenterRank: number;   // continuous rank (e.g. 1.7) — preserves value score gaps
  loading: boolean; error: boolean;
}

const SLEEPER_API = "https://api.sleeper.app/v1";

async function fetchLeagueStanding(
  leagueId: string,
  userId: string,
  redraftValues: Record<string, number> = {},
): Promise<Omit<LeagueStanding, "leagueId" | "loading" | "error">> {
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
  const hasRealTeam = userRoster !== undefined && userPlayers > 0;
  const rank = hasRealTeam ? sorted.findIndex((r: any) => r.roster_id === userRoster!.roster_id) + 1 : -1;

  // Value-based rank: use starters if populated, fall back to full roster.
  // Computes both an integer rank and a continuous rank that preserves score gaps
  // so each league gets a distinct probability (e.g. 1.7 vs 2.3 within "2nd place").
  let valueRank = 0;
  let valueCenterRank = 0;
  const hasValues = Object.keys(redraftValues).length > 0;
  if (hasRealTeam && hasValues) {
    const rosterValued = rosters.map((r: any) => {
      const starters: string[] = (r.starters || []).filter((p: string) => p && p !== "0");
      const players: string[] = starters.length > 0 ? starters : (r.players || []);
      const val = players.reduce((sum: number, pid: string) => sum + (redraftValues[pid] || 0), 0);
      return { rosterId: r.roster_id, val };
    });
    rosterValued.sort((a, b) => b.val - a.val);
    valueRank = rosterValued.findIndex((r) => r.rosterId === userRoster!.roster_id) + 1 || 0;

    // Continuous rank: map actual value score linearly into [1, totalTeams].
    // Best team → 1.0, worst team → n.0, everything else proportional.
    const userVal = rosterValued.find((r) => r.rosterId === userRoster!.roster_id)?.val ?? 0;
    const maxVal = rosterValued[0]?.val ?? 0;
    const minVal = rosterValued[rosterValued.length - 1]?.val ?? 0;
    valueCenterRank = maxVal > minVal
      ? 1 + ((maxVal - userVal) / (maxVal - minVal)) * (rosters.length - 1)
      : (rosters.length + 1) / 2;
  }

  return {
    rank, totalTeams: rosters.length,
    wins: userRoster?.settings?.wins ?? 0, losses: userRoster?.settings?.losses ?? 0, ties: userRoster?.settings?.ties ?? 0,
    ptsFor: (userRoster?.settings?.fpts ?? 0) + (userRoster?.settings?.fpts_decimal ?? 0) / 100,
    playoffSpots: playoffTeams, inPlayoffs: rank > 0 && rank <= playoffTeams,
    valueRank, valueCenterRank,
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
  const { playoffSpots, totalTeams } = s;
  const gamesPlayed = s.wins + s.losses + s.ties;
  // Pre-season: use value-based rank if available, otherwise unknown
  const effectiveRank = gamesPlayed === 0
    ? (s.valueRank > 0 ? s.valueRank : -1)
    : s.rank;
  if (effectiveRank < 1) return "unknown";
  const rankPct = effectiveRank / totalTeams;
  if (effectiveRank <= playoffSpots) {
    return rankPct <= 0.30 ? "elite" : "bubble";
  }
  return effectiveRank - playoffSpots <= 2 ? "bubble" : "rebuild";
}

// Blended standing+talent model — mirrors the Portfolio tab algorithm exactly.
// Early season (week 0): 85% talent-based. Late season (week 14+): 85% standing-based.
function approxPlayoffPct(s: LeagueStanding): number {
  if (s.rank <= 0 || s.totalTeams < 2) return 0;
  const { rank, playoffSpots, totalTeams, valueRank, valueCenterRank } = s;
  const gamesPlayed = s.wins + s.losses + s.ties;
  const regularSeasonGames = 14;
  const seasonProgress = Math.min(gamesPlayed / regularSeasonGames, 1);

  // Standing score (0.05–0.95 based on W/L rank vs playoff cutline)
  let standingScore: number;
  if (rank <= playoffSpots) {
    const comfort = playoffSpots > 1 ? (playoffSpots - rank) / (playoffSpots - 1) : 1;
    standingScore = 0.55 + comfort * 0.40;
  } else {
    const spotsBack = rank - playoffSpots;
    const maxSpotsBack = Math.max(1, totalTeams - playoffSpots);
    standingScore = 0.45 * (1 - spotsBack / maxSpotsBack);
  }

  // Talent score: uses continuous rank (1.7, 2.3…) so score gaps between teams
  // produce distinct probabilities even when integer rank is the same.
  let talentScore: number;
  const vRank = valueCenterRank > 0 ? valueCenterRank : (valueRank > 0 ? valueRank : 0);
  if (vRank === 0 || totalTeams <= 1) {
    talentScore = playoffSpots / totalTeams;
  } else if (vRank <= playoffSpots) {
    const comfort = playoffSpots > 1 ? (playoffSpots - vRank) / (playoffSpots - 1) : 1;
    talentScore = 0.55 + comfort * 0.40;
  } else {
    const spotsBack = vRank - playoffSpots;
    const maxSpotsBack = Math.max(1, totalTeams - playoffSpots);
    talentScore = 0.45 * (1 - spotsBack / maxSpotsBack);
  }

  // Blend: standingWeight 0.15 (week 0) → 0.85 (week 14+)
  const standingWeight = 0.15 + 0.70 * seasonProgress;
  const rawOdds = standingWeight * standingScore + (1 - standingWeight) * talentScore;
  return Math.min(99, Math.max(1, Math.round(rawOdds * 100)));
}

// Truncated-normal placement probability model.
// Models final finishing position as a Gaussian centered on current rank,
// with σ shrinking as the season progresses (more certain late in season).
// Pre-season: centers on valueRank when available (talent-based).
function placementProbs(s: LeagueStanding, maxPlace: number): Map<number, number> {
  const { rank, totalTeams, wins, losses, ties, valueRank, valueCenterRank } = s;
  const gamesPlayed = wins + losses + ties;
  const seasonProgress = Math.min(1, gamesPlayed / 14);
  // Pre-season: use continuous value rank so each league gets a distinct probability.
  // valueCenterRank is fractional (e.g. 1.7) based on actual score gaps, not integer rank.
  const centerRank = gamesPlayed === 0 && valueCenterRank > 0
    ? valueCenterRank
    : gamesPlayed === 0 && valueRank > 0 ? valueRank : rank;
  // σ: ~totalTeams/3 at week 0, shrinks to 0.5 at week 14
  const sigma = Math.max(0.5, (1 - seasonProgress) * totalTeams / 3);
  const raw: number[] = [];
  for (let k = 1; k <= totalTeams; k++) {
    const z = (k - centerRank) / sigma;
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
    desc: "Strong playoff position. Maximize focus here.",
    headerCls: "text-emerald-600 dark:text-emerald-400",
    bgCls: "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30",
    badgeCls: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  },
  bubble: {
    label: "At-Risk & Bubble",
    short: "Bubble",
    desc: "On the playoff edge. Needs your attention.",
    headerCls: "text-amber-600 dark:text-amber-400",
    bgCls: "bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30",
    badgeCls: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  },
  rebuild: {
    label: "Rebuilds / Longshots",
    short: "Rebuild",
    desc: "Low playoff odds. Buy-in likely sunk cost.",
    headerCls: "text-slate-500 dark:text-slate-400",
    bgCls: "bg-muted/30 border-border/40",
    badgeCls: "border-border/50 text-slate-500 dark:text-slate-400",
  },
};



// ─── Main Finance Tab ─────────────────────────────────────────────────────────

export function FinanceTab() {
  const { isConnected, user, leagues } = useSleeper();
  const { redraftValuesBySleeperId } = useValueModel();
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

  // Auto-exchange: if a valid Sleeper OTP session exists for this user, trade it for a finance JWT.
  useEffect(() => {
    if (!user?.userId) return;
    const sess = getSleeperSession();
    if (sess && !isSessionExpired(sess) && sess.userId === user.userId) {
      const cached = localStorage.getItem(tokenKey(user.userId));
      if (cached) { setToken(cached); setAuthChecked(true); return; }
      fetch(`${API_BASE}/api/auth/sleeper-exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleeperId: user.userId }),
      })
        .then(r => r.json())
        .then(d => { if (d.token) { localStorage.setItem(tokenKey(user.userId!), d.token); setToken(d.token); } })
        .catch(() => {})
        .finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }
  }, [user?.userId]);

  // Poll for a new Sleeper session while the gate is showing (e.g. user just connected via OTP).
  useEffect(() => {
    if (token || !user?.userId) return;
    const id = setInterval(() => {
      const sess = getSleeperSession();
      if (!sess || isSessionExpired(sess) || sess.userId !== user.userId) return;
      const cached = localStorage.getItem(tokenKey(user.userId!));
      if (cached) { setToken(cached); clearInterval(id); return; }
      fetch(`${API_BASE}/api/auth/sleeper-exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleeperId: user.userId }),
      })
        .then(r => r.json())
        .then(d => { if (d.token) { localStorage.setItem(tokenKey(user.userId!), d.token); setToken(d.token); clearInterval(id); } })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(id);
  }, [token, user?.userId]);

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

  const redraftValuesLoaded = Object.keys(redraftValuesBySleeperId).length > 0;

  useEffect(() => {
    if (!isConnected || !user?.userId || dynastyLeagues.length === 0) return;
    dynastyLeagues.forEach(league => {
      setStandings(prev => ({
        ...prev,
        [league.leagueId]: { leagueId: league.leagueId, rank: -1, totalTeams: 0, wins: 0, losses: 0, ties: 0, ptsFor: 0, playoffSpots: 0, inPlayoffs: false, valueRank: 0, valueCenterRank: 0, loading: true, error: false },
      }));
      fetchLeagueStanding(league.leagueId, user.userId, redraftValuesBySleeperId)
        .then(s => setStandings(prev => ({ ...prev, [league.leagueId]: { leagueId: league.leagueId, ...s, loading: false, error: false } })))
        .catch(() => setStandings(prev => ({ ...prev, [league.leagueId]: { ...prev[league.leagueId], loading: false, error: true } })));
    });
  }, [isConnected, user?.userId, dynastyLeagues.length, redraftValuesLoaded]);

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
    return (
      <div className="max-w-xl mx-auto px-4 py-12 space-y-6">
        <div className="text-center space-y-2 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-[#d4af37]/10 flex items-center justify-center mx-auto ring-1 ring-[#d4af37]/20">
            <DollarSign className="w-6 h-6 text-[#d4af37]" />
          </div>
          <h3 className="text-lg font-bold">Connect Sleeper to Access Finances</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Connect your Sleeper account via the form below to unlock the league finance tracker. Your session is saved automatically.
          </p>
        </div>
        <SleeperAuthCard />
      </div>
    );
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
          <span className="text-xs text-muted-foreground font-medium">Connected as @{user.username}</span>
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
              <span className="text-[10px] text-muted-foreground">which leagues to prioritize this season</span>
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
                const gamesPlayed = s ? s.wins + s.losses + s.ties : 0;
                // Show playoff odds when we have either W/L data OR value rank (pre-season talent model)
                const hasOddsData = s && !s.loading && !s.error && s.rank > 0 && (gamesPlayed > 0 || s.valueRank > 0);
                const playoffPct = hasOddsData ? approxPlayoffPct(s) : null;

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
                    {s && !s.loading && !s.error && s.rank > 0 && gamesPlayed > 0 && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${s.inPlayoffs ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {s.inPlayoffs ? "🏆 " : ""}#{s.rank} of {s.totalTeams}
                      </Badge>
                    )}
                    {tierCfg && playoffPct !== null && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${tierCfg.badgeCls}`}>
                        ~{playoffPct}% playoffs
                      </Badge>
                    )}
                    {hasOddsData && (() => {
                      const p1 = Math.round((placementProbs(s, 1).get(1) ?? 0) * 1000) / 10;
                      if (p1 <= 0) return null;
                      return (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-[#d4af37]/50 text-amber-600 dark:text-amber-400">
                          ~{p1}% 1st
                        </Badge>
                      );
                    })()}
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
                      { label: "Standing", value: gamesPlayed > 0 ? `#${s.rank}/${s.totalTeams}` : "N/A" },
                      { label: "Record", value: gamesPlayed > 0 ? `${s.wins}-${s.losses}${s.ties > 0 ? `-${s.ties}` : ""}` : "Pre-season" },
                      { label: "Pts For", value: gamesPlayed > 0 ? s.ptsFor.toFixed(1) : "N/A" },
                    ].map(item => (
                      <div key={item.label} className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-muted-foreground mb-0.5">{item.label}</p>
                        <p className="text-base font-bold">{item.value}</p>
                      </div>
                    ))}
                    <div className="rounded-lg p-3 text-center border bg-muted/30 border-border/30">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Playoff Odds</p>
                      {hasOddsData ? (
                        <>
                          <p className={`text-base font-bold ${approxPlayoffPct(s) >= 50 ? "text-emerald-600 dark:text-emerald-400" : approxPlayoffPct(s) <= 20 ? "text-red-500 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                            ~{approxPlayoffPct(s)}%
                          </p>
                          <p className="text-[10px] mt-0.5 text-muted-foreground">
                            {gamesPlayed > 0
                              ? (s.inPlayoffs ? "In ✓" : `${s.rank - s.playoffSpots} back`)
                              : "talent-based"}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-base font-bold text-muted-foreground">N/A</p>
                          <p className="text-[10px] mt-0.5 text-muted-foreground">loading…</p>
                        </>
                      )}
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
                          <p className="text-sm font-semibold">{calc ? fmtDollar(Math.round(calc.projectedPrize)) : "N/A"}</p>
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
