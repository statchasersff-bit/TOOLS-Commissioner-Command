import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus, Loader2, AlertCircle } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { API_BASE } from "@/lib/apiBase";
import type { League, Team } from "@/types";
import { buildSnapshotPayload } from "@/lib/gm-analytics";

interface Props {
  league: League;
  userTeam: Team;
  /**
   * Sleeper roster_id for the user's team. Required for snapshot storage.
   * The Team type doesn't currently carry roster_id, so the parent passes it
   * down separately.
   */
  rosterId?: number;
}

interface SnapshotRow {
  snapshotDate: string;
  dynastyValue: number;
  winNowValue: number;
  pickValue: number;
  starterStrength: number;
  avgAge: number;
}

interface SnapshotsResponse {
  leagueId: string;
  rosterId: number;
  snapshots: SnapshotRow[];
}

function todayIso(): string {
  // Local YYYY-MM-DD — matches what the DB column expects.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shortLabel(iso: string): string {
  // "2026-05-19" → "May 19"
  const [, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[(m ?? 1) - 1]} ${d}`;
}

function trendBadge(delta: number, isPct = false): { Icon: typeof ArrowUpRight; cls: string; label: string } {
  if (Math.abs(delta) < (isPct ? 0.5 : 1)) {
    return { Icon: Minus, cls: "text-muted-foreground bg-muted/30", label: "Holding" };
  }
  if (delta > 0) return { Icon: ArrowUpRight, cls: "text-emerald-500 bg-emerald-500/10", label: "Ascending" };
  return { Icon: ArrowDownRight, cls: "text-rose-500 bg-rose-500/10", label: "Declining" };
}

export function TeamTrajectory({ league, userTeam, rosterId }: Props) {
  const { getPlayerValue, getRedraftValue, getPickValue } = useValueModel();

  const currentSnapshot = useMemo(
    () => buildSnapshotPayload(userTeam, getPlayerValue, getRedraftValue, getPickValue, league.isBestBall ?? false),
    [userTeam, getPlayerValue, getRedraftValue, getPickValue, league.isBestBall],
  );

  const [history, setHistory] = useState<SnapshotRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Record one snapshot per (league, rosterId) per day. The server upserts on
  // (leagueId, rosterId, snapshotDate) so we can fire-and-forget here.
  useEffect(() => {
    if (!league.id || rosterId == null) return;
    let cancelled = false;
    (async () => {
      try {
        await fetch(`${API_BASE}/api/teams/snapshots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leagueId: league.id,
            rosterId,
            snapshotDate: todayIso(),
            ...currentSnapshot,
          }),
        });
        if (cancelled) return;
        // Re-fetch the history so today's snapshot shows up immediately.
        await fetchHistory();
      } catch (err: any) {
        if (!cancelled) console.warn("[TeamTrajectory] snapshot upsert failed", err);
      }
    })();
    return () => { cancelled = true; };
    // currentSnapshot is intentionally not a dependency — we don't want to
    // re-write the snapshot every time a value-source flips. Once per mount
    // per (league, roster) is enough; the parent will remount on tab change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.id, rosterId]);

  const fetchHistory = async () => {
    if (!league.id || rosterId == null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/leagues/${league.id}/rosters/${rosterId}/snapshots`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Snapshots API failed (${res.status})`);
      const json = (await res.json()) as SnapshotsResponse;
      setHistory(json.snapshots ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load trajectory");
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.id, rosterId]);

  // Combine fetched history with today's live snapshot so the chart always
  // reflects the latest value even before the API roundtrip completes.
  const chartData = useMemo(() => {
    const hist = history ?? [];
    const today = todayIso();
    const withoutToday = hist.filter((s) => s.snapshotDate !== today);
    const combined = [
      ...withoutToday,
      { snapshotDate: today, ...currentSnapshot },
    ];
    return combined
      .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
      .map((s) => ({
        date: shortLabel(s.snapshotDate),
        Dynasty: s.dynastyValue,
        "Win-Now": s.winNowValue,
        Picks: s.pickValue,
      }));
  }, [history, currentSnapshot]);

  // Trajectory score: dynasty delta over last 30 days as a % of starting value.
  const trajectoryScore = useMemo(() => {
    if (chartData.length < 2) return null;
    const last = chartData[chartData.length - 1].Dynasty;
    const thirtyDaysAgoIdx = Math.max(0, chartData.length - 1 - 4); // 4 weekly snapshots ≈ 30 days
    const ref = chartData[thirtyDaysAgoIdx].Dynasty;
    if (ref <= 0) return null;
    return Math.round(((last - ref) / ref) * 1000) / 10;
  }, [chartData]);

  const trend = trajectoryScore !== null ? trendBadge(trajectoryScore, true) : null;
  const TrendIcon = trend?.Icon;

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="gm-trajectory">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground">Team Trajectory</h3>
          <span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" />
          <p className="text-xs text-muted-foreground mt-2">Dynasty, win-now, and pick value over time.</p>
        </div>
        {trend && TrendIcon && (
          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold flex-shrink-0 mt-0.5", trend.cls)}>
            <TrendIcon className="w-3 h-3" />
            {trend.label}
            {trajectoryScore !== null && (
              <span className="ml-1 tabular-nums">
                {trajectoryScore > 0 ? "+" : ""}{trajectoryScore.toFixed(1)}%
              </span>
            )}
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-500" data-testid="gm-trajectory-error">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      {loading && !history ? (
        <div className="flex items-center justify-center gap-2 h-[200px] text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading trajectory…
        </div>
      ) : chartData.length < 2 ? (
        <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 p-6 text-center space-y-1.5" data-testid="gm-trajectory-collecting">
          <p className="text-sm font-medium">Collecting trajectory data…</p>
          <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
            We capture one snapshot per day per roster. Once we have two or more snapshots, your Dynasty,
            Win-Now, and Pick trajectories will graph here.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Current: Dynasty <span className="font-semibold text-foreground">{currentSnapshot.dynastyValue.toLocaleString()}</span>{" "}
            · Win-Now <span className="font-semibold text-foreground">{currentSnapshot.winNowValue.toLocaleString()}</span>{" "}
            · Picks <span className="font-semibold text-foreground">{currentSnapshot.pickValue.toLocaleString()}</span>
          </p>
        </div>
      ) : (
        <div className="w-full h-[260px]" data-testid="gm-trajectory-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={50} />
              <RechartsTooltip
                contentStyle={{
                  background: "rgba(8,16,32,0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelStyle={{ color: "#aaa" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
              <Line type="monotone" dataKey="Dynasty"   stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="Win-Now"   stroke="#d4af37" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="Picks"     stroke="#a855f7" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
