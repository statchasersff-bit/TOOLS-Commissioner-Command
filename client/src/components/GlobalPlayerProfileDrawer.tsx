/**
 * Global Player Profile drawer — fantasy/player-analysis focused.
 *
 * Opened from anywhere in the app via `usePlayerProfile().openPlayerProfile(id)`.
 * The drawer is mounted once near the app root; consumers just trigger it.
 *
 * NOTE: distinct from the ADP-focused drawer in PlayerProfileDrawer.tsx —
 * that one is bound to ADP Explorer data shape. Do not merge.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleUserRound,
  FileText,
  Layers,
  Newspaper,
  Star,
  Trophy,
  User,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel } from "@/contexts/ValueModelContext";
import { usePlayerProfile } from "@/contexts/PlayerProfileContext";
import { getSleeperPlayers } from "@/lib/sleeperApi";
import { fetchSleeperLeagueFull } from "@/lib/sleeperApi";
import { getPlayerProfile, type PlayerProfile } from "@/lib/playerProfile";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import type { League } from "@/types";

const POS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  QB: { bg: "bg-rose-500/15", text: "text-rose-300", border: "border-rose-500/40" },
  RB: { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/40" },
  WR: { bg: "bg-sky-500/15", text: "text-sky-300", border: "border-sky-500/40" },
  TE: { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-500/40" },
  K: { bg: "bg-purple-500/15", text: "text-purple-300", border: "border-purple-500/40" },
  DEF: { bg: "bg-slate-500/15", text: "text-slate-300", border: "border-slate-500/40" },
};

export function GlobalPlayerProfileDrawer() {
  const isMobile = useIsMobile();
  const { selectedPlayerId, isOpen, closePlayerProfile } = usePlayerProfile();
  const [tab, setTab] = useState<string>("overview");

  const sleeper = useSleeper();
  const valueModel = useValueModel();

  // Lazy Sleeper player DB — cached across opens.
  const [playerDb, setPlayerDb] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    if (playerDb) return;
    let cancelled = false;
    getSleeperPlayers()
      .then((db) => {
        if (!cancelled) setPlayerDb(db);
      })
      .catch(() => {
        if (!cancelled) setPlayerDb({});
      });
    return () => { cancelled = true; };
  }, [isOpen, playerDb]);

  // Lazy active-league full hydration. The DCC already hydrates the active
  // league for its own rendering, but a click can fire from a screen where
  // the league wasn't loaded yet (e.g. Portfolio table). Fetch on demand.
  const [activeLeague, setActiveLeague] = useState<League | null>(null);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    if (!sleeper.activeLeagueId || !sleeper.user?.userId) {
      setActiveLeague(null);
      setUserTeamId(null);
      return;
    }
    let cancelled = false;
    (fetchSleeperLeagueFull(sleeper.activeLeagueId, sleeper.user.userId) as Promise<{ league: League; userTeamId: string | null }>)
      .then((data) => {
        if (cancelled) return;
        setActiveLeague(data.league);
        setUserTeamId(data.userTeamId);
      })
      .catch(() => {
        if (!cancelled) setActiveLeague(null);
      });
    return () => { cancelled = true; };
  }, [isOpen, sleeper.activeLeagueId, sleeper.user?.userId]);

  useEffect(() => {
    if (isOpen) setTab("overview");
  }, [isOpen, selectedPlayerId]);

  const profile: PlayerProfile | null = useMemo(() => {
    if (!selectedPlayerId) return null;
    return getPlayerProfile({
      playerId: selectedPlayerId,
      sleeperPlayerDb: playerDb,
      activeLeague,
      currentUserTeamId: userTeamId,
      getPlayerValue: valueModel.getPlayerValue,
      getRedraftValue: valueModel.getRedraftValue,
      dynastyPlayerList: valueModel.dynastyPlayerList,
      valuesBySleeperId: valueModel.valuesBySleeperId,
      redraftValuesBySleeperId: valueModel.redraftValuesBySleeperId,
    });
  }, [
    selectedPlayerId,
    playerDb,
    activeLeague,
    userTeamId,
    valueModel.getPlayerValue,
    valueModel.getRedraftValue,
    valueModel.dynastyPlayerList,
    valueModel.valuesBySleeperId,
    valueModel.redraftValuesBySleeperId,
  ]);

  return (
    <Sheet open={isOpen} onOpenChange={(o) => { if (!o) closePlayerProfile(); }}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "p-0 border-l border-white/10 bg-[#0a1628] text-foreground overflow-hidden flex flex-col",
          isMobile ? "h-[95vh] sm:max-w-full rounded-t-2xl" : "w-full sm:max-w-[520px]",
        )}
        data-testid="global-player-profile-drawer"
      >
        <SheetTitle className="sr-only">
          {profile ? `${profile.player.name} player profile` : "Player profile"}
        </SheetTitle>

        {profile ? (
          <>
            <ProfileHeader profile={profile} />

            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="mx-3 mt-2 grid grid-cols-4 h-9 bg-white/[0.04] flex-shrink-0">
                <TabsTrigger value="overview" className="text-[10px] flex items-center gap-1">
                  <User className="w-3 h-3" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="production" className="text-[10px] flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  Production
                </TabsTrigger>
                <TabsTrigger value="advanced" className="text-[10px] flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  Advanced
                </TabsTrigger>
                <TabsTrigger value="news" className="text-[10px] flex items-center gap-1">
                  <Newspaper className="w-3 h-3" />
                  News
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                <TabsContent value="overview"><OverviewTab profile={profile} /></TabsContent>
                <TabsContent value="production"><ProductionTab profile={profile} /></TabsContent>
                <TabsContent value="advanced"><AdvancedTab profile={profile} /></TabsContent>
                <TabsContent value="news"><NewsTab profile={profile} /></TabsContent>
              </div>
            </Tabs>
          </>
        ) : (
          <EmptyProfile loadingPlayerDb={isOpen && !playerDb} />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function ProfileHeader({ profile }: { profile: PlayerProfile }) {
  const tint = POS_COLORS[profile.player.pos] ?? POS_COLORS.WR;
  const dyn = profile.values.dynasty;
  return (
    <div className="px-4 pt-5 pb-3 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <PlayerAvatar
          id={profile.player.id}
          name={profile.player.name}
          pos={profile.player.pos}
          team={profile.player.team}
          size="md"
          compact
        />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold text-white truncate" data-testid="global-profile-name">
            {profile.player.name}
          </div>
          <div className="text-[11px] text-white/55 mt-0.5 flex items-center gap-1.5">
            <Badge variant="outline" className={cn("text-[9px] font-bold", tint.text, tint.border)}>
              {profile.player.pos}
              {profile.ranks.dynastyPositional ? profile.ranks.dynastyPositional : ""}
            </Badge>
            <span>{profile.player.team || "FA"}</span>
            {profile.player.age != null && (
              <>
                <span className="text-white/25">·</span>
                <span>{profile.player.age}y</span>
              </>
            )}
            {profile.player.injuryStatus && profile.player.injuryStatus !== "Healthy" && (
              <Badge variant="outline" className="text-[9px] text-rose-300 border-rose-500/40 ml-1">
                {profile.player.injuryStatus}
              </Badge>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[9px] uppercase tracking-wider text-white/35">Dynasty</div>
          <div className="text-xl font-black tabular-nums text-[#d4af37]">
            {dyn == null ? "—" : formatValue(dyn)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function OverviewTab({ profile }: { profile: PlayerProfile }) {
  const dyn = profile.values.dynasty;
  const red = profile.values.redraft;
  const ctx = profile.leagueContext;

  return (
    <div className="space-y-4 text-[12px]">
      {/* League context strip */}
      {ctx && <LeagueContextStrip ctx={ctx} />}

      {/* Value grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="Dynasty Value"
          value={dyn == null ? "—" : formatValue(dyn)}
          accent="gold"
          icon={Trophy}
        />
        <StatTile
          label="Redraft Value"
          value={red == null ? "—" : formatValue(red)}
          accent="blue"
          icon={Star}
        />
        <StatTile
          label={`Dynasty ${profile.player.pos} Rank`}
          value={profile.ranks.dynastyPositional ? `${profile.player.pos}${profile.ranks.dynastyPositional}` : "—"}
          icon={ChevronUp}
        />
        <StatTile
          label={`Redraft ${profile.player.pos} Rank`}
          value={profile.ranks.redraftPositional ? `${profile.player.pos}${profile.ranks.redraftPositional}` : "—"}
          icon={ChevronDown}
        />
      </div>

      {/* Bio strip */}
      <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5 grid grid-cols-3 gap-2 text-[11px]">
        <BioCell label="Age" value={profile.player.age != null ? `${profile.player.age}y` : "—"} />
        <BioCell label="Years exp" value={profile.player.yearsExp != null ? `${profile.player.yearsExp}` : "—"} />
        <BioCell label="Team" value={profile.player.team || "FA"} />
        {profile.player.height && <BioCell label="Height" value={profile.player.height} />}
        {profile.player.weight && <BioCell label="Weight" value={`${profile.player.weight} lbs`} />}
        {profile.player.injuryStatus && (
          <BioCell label="Status" value={profile.player.injuryStatus} />
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {profile.player.age != null && profile.player.age <= 25 && (
          <ChipBadge tone="emerald" text="Young Core" />
        )}
        {ctx?.rosterSlot === "starter" && <ChipBadge tone="blue" text="Starter" />}
        {dyn != null && dyn >= 8000 && <ChipBadge tone="gold" text="High Market Value" />}
        {ctx?.rosteredByUser && <ChipBadge tone="gold" text="On Your Roster" />}
      </div>
    </div>
  );
}

function LeagueContextStrip({ ctx }: { ctx: NonNullable<PlayerProfile["leagueContext"]> }) {
  let body = "";
  let tone: "emerald" | "blue" | "rose" | "slate" = "slate";
  if (ctx.rosteredByUser) {
    body = ctx.leagueName ? `Rostered by you in ${ctx.leagueName}` : "Rostered by you";
    tone = "emerald";
  } else if (ctx.rosteredByOther) {
    body = `Rostered by ${ctx.rosteredByOther}`;
    tone = "blue";
  } else if (ctx.rosterSlot === "fa") {
    body = ctx.leagueName ? `Available in ${ctx.leagueName}` : "Available";
    tone = "rose";
  }
  if (!body) return null;

  const slotLabel = ctx.rosterSlot === "taxi" ? "Taxi Squad"
    : ctx.rosterSlot === "ir" ? "IR"
    : ctx.rosterSlot === "starter" ? "Starting"
    : ctx.rosterSlot === "bench" ? "Bench"
    : null;

  const styles = {
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    blue:    "border-sky-500/40 bg-sky-500/10 text-sky-200",
    rose:    "border-rose-500/40 bg-rose-500/10 text-rose-200",
    slate:   "border-white/10 bg-white/[0.03] text-white/70",
  }[tone];

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 flex items-center gap-2 text-[11px]",
        styles,
      )}
      data-testid="league-context-strip"
    >
      <CircleUserRound className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">{body}</span>
      {slotLabel && (
        <span className="font-bold uppercase tracking-wider text-[9px] opacity-80">
          {slotLabel}
        </span>
      )}
    </div>
  );
}

function ProductionTab({ profile }: { profile: PlayerProfile }) {
  const rows = profile.fantasyProduction;
  if (!rows.length) {
    return (
      <ShellEmpty
        icon={BarChart3}
        message="Fantasy production history coming soon."
        sub="We're working on connecting per-season fantasy points and positional finishes."
      />
    );
  }
  const hasPpg = rows.some((r) => r.ppg != null);
  return (
    <div className="space-y-3">
      {hasPpg && <PpgSparkline rows={rows} />}
      <div className="rounded-md border border-white/10 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-white/[0.04] text-white/55">
            <tr>
              <th className="px-2 py-1.5 text-left">Season</th>
              <th className="px-2 py-1.5 text-left">Team</th>
              <th className="px-2 py-1.5 text-right">G</th>
              <th className="px-2 py-1.5 text-right">Pts</th>
              <th className="px-2 py-1.5 text-right">PPG</th>
              <th className="px-2 py-1.5 text-right">Finish</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.season} className="border-t border-white/5">
                <td className="px-2 py-1.5 text-white/85 font-medium">{r.season}</td>
                <td className="px-2 py-1.5 text-white/65">{r.team || "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/75">{r.games ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/85 font-semibold">{r.fantasyPoints ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[#d4af37]">{r.ppg != null ? r.ppg.toFixed(1) : "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/75">{r.positionRank != null ? `#${r.positionRank}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PpgSparkline({ rows }: { rows: PlayerProfile["fantasyProduction"] }) {
  const W = 320, H = 90, PAD = 10;
  const vals = rows.map((r) => r.ppg ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const points = rows.map((r, i) => {
    const x = PAD + (i / Math.max(1, rows.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (((r.ppg ?? min) - min) / span) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1.5">
        PPG over career
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[88px]" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="#d4af37" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function AdvancedTab({ profile }: { profile: PlayerProfile }) {
  const groups = profile.advancedStats;
  if (!groups.length) {
    return (
      <ShellEmpty
        icon={Layers}
        message="Advanced stat integration coming soon."
        sub="Position-specific metrics will land here as we wire data feeds."
      />
    );
  }
  const allEmpty = groups.every((g) => g.value == null);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {groups.map((g) => (
          <div
            key={g.label}
            className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <div className="text-[9px] uppercase tracking-wider text-white/40">{g.label}</div>
            <div className="text-[14px] font-bold tabular-nums text-white">
              {g.value == null ? "—" : g.value}
            </div>
          </div>
        ))}
      </div>
      {allEmpty && (
        <p className="text-[11px] text-white/35 italic">
          Advanced stat integration coming soon — values will populate as we wire data feeds.
        </p>
      )}
    </div>
  );
}

function NewsTab({ profile }: { profile: PlayerProfile }) {
  const news = profile.news;
  if (!news.length) {
    return (
      <ShellEmpty
        icon={Newspaper}
        message="Recent news integration coming soon."
        sub="Beat reports, injury news, and analyst takes will land here once the feed is connected."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {news.map((n, i) => (
        <li
          key={`${n.headline}-${i}`}
          className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              {n.source}
            </span>
            <span className="text-[10px] text-white/35 inline-flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              {formatDate(n.publishedAt)}
            </span>
          </div>
          <div className="text-[12px] font-semibold text-white/85">
            {n.url ? (
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:text-[#d4af37]">
                {n.headline}
              </a>
            ) : n.headline}
          </div>
          {n.summary && (
            <p className="text-[11px] text-white/55 mt-1 leading-relaxed">{n.summary}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Tiny building blocks ────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  accent?: "gold" | "blue";
  icon?: typeof Trophy;
}) {
  const accentText =
    accent === "gold" ? "text-[#d4af37]" : accent === "blue" ? "text-sky-300" : "text-white";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-white/40">
        {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}
        {label}
      </div>
      <div className={cn("text-[15px] font-black tabular-nums mt-0.5", accentText)}>
        {value}
      </div>
    </div>
  );
}

function BioCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-[12px] font-semibold text-white/85 tabular-nums">{value}</div>
    </div>
  );
}

function ChipBadge({ tone, text }: { tone: "emerald" | "blue" | "gold" | "rose"; text: string }) {
  const cls = {
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    blue:    "border-sky-500/40 bg-sky-500/10 text-sky-300",
    gold:    "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#fde68a]",
    rose:    "border-rose-500/40 bg-rose-500/10 text-rose-300",
  }[tone];
  return (
    <span className={cn("text-[9px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border", cls)}>
      {text}
    </span>
  );
}

function ShellEmpty({
  icon: Icon,
  message,
  sub,
}: {
  icon: typeof Activity;
  message: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-white/10 bg-white/[0.015] px-4 py-8 text-center">
      <Icon className="w-6 h-6 text-white/20 mx-auto mb-2" />
      <div className="text-[12px] font-semibold text-white/65">{message}</div>
      {sub && <div className="text-[11px] text-white/35 mt-1">{sub}</div>}
    </div>
  );
}

function EmptyProfile({ loadingPlayerDb }: { loadingPlayerDb: boolean }) {
  return (
    <div className="p-6 text-center">
      <FileText className="w-7 h-7 text-white/20 mx-auto mb-2" />
      <div className="text-sm font-semibold text-white/65">
        {loadingPlayerDb ? "Loading player profile…" : "Player profile unavailable."}
      </div>
      {!loadingPlayerDb && (
        <p className="text-[12px] text-white/35 mt-1">
          We couldn't find this player in the current data sources.
        </p>
      )}
    </div>
  );
}

// ── Formatters ──────────────────────────────────────────────────────────────

function formatValue(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
