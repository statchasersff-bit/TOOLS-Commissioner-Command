/**
 * Bulk Trades — search one player you own, scan every connected Sleeper
 * league, find every league where the searched player is on your roster,
 * (optionally) pin a target player, build per-league trade offers and
 * submit them through the throttled Sleeper write queue.
 *
 * Modeled after WaiverCommand's bulk-claims flow:
 *   1. Search → 2. Review (per-row selection + add-ons) → 3. Confirm → 4. Submitting → 5. Done.
 *
 * Constraints we honor on purpose:
 *   - One player logo per row (no duplication between the chip and the avatar).
 *   - No custom DMs are sent from this page. The automatic post-trade
 *     StatChasers-link DM (firePostTradeLinkDm) does fire on success — that's
 *     the existing behavior we explicitly preserve.
 *   - Bulk submit goes through `sleeperWriteLimiter` + the same staged delay
 *     used by the waiver bulk submitter (8-15s → 20-45s → 60-180s, plus a
 *     5-10 min cooldown every 10th submission).
 *   - Sleeper auth token is read from local session and never logged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, ArrowLeft, ArrowRight, AlertCircle, CheckCircle2, RefreshCw, Minus, ChevronDown, ChevronUp, X, Plus, Send, ShieldAlert, Pencil } from "lucide-react";
import { SleeperUserAvatar } from "@/components/SleeperUserAvatar";
import { useSleeper } from "@/contexts/SleeperContext";
import { useValueModel, type RankedPlayer } from "@/contexts/ValueModelContext";
import { fetchSleeperLeagueFull } from "@/lib/sleeperApi";
import { proposeTrade, firePostTradeLinkDm } from "@/services/sleeperAuthedApi";
import { getSleeperSession, isSessionExpired } from "@/services/sleeperAuth";
import { sleeperWriteLimiter } from "@/services/sleeperWriteLimiter";
import { preflightBatch, isWriteEnabled } from "@/services/sleeperSafetyGate";
import { SafePacingNotice } from "@/components/SafePacingNotice";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { getPositionColor } from "@/data/mockData";
import type { Player, Pick, Team, League } from "@/types";

// ─── Types ───────────────────────────────────────────────────────────────────

type RowStatus =
  | "ready"               // Send + receive + manager all resolved — selectable.
  | "choose_target"       // Have my give-player + manager, no target asset selected yet.
  | "choose_manager"      // Have my give-player; user must pick a partner manager.
  | "choose_offer"        // Have target player + manager; user must pick what to send.
  | "target_not_found"    // Searched target isn't in this league's player pool.
  | "target_free_agent"   // Target is a real player but not on any roster here.
  | "target_on_my_roster" // I already own the target — nothing to trade for.
  | "same_manager"        // I own both — nothing to trade.
  | "invalid_offer";      // Pre-send validation rejected (see statusReason).

type SubmitStatus = "pending" | "delaying" | "submitting" | "success" | "error" | "skipped";

interface TargetManager {
  teamId: string;
  teamName: string;
  ownerName: string;
  rosterId: number;
  ownerId: string | null;
  avatar: string | null;
}

interface BulkTradeRow {
  leagueId: string;
  leagueName: string;
  /** Sleeper avatar hash for the league logo (no URL prefix). */
  leagueAvatar: string | null;
  format: string;
  scoringFormat: string;
  myRosterId: number;
  myTeamId: string;
  // The player the user is trading away. Null in Case B (only "Player I
  // want" was searched) — the user picks send assets via the editor.
  myPlayer: Player | null;
  // Every player on my roster, available for add-on / primary send picks.
  // When `myPlayer` is set we use this list to drive the add-on picker
  // (excluding myPlayer itself for that case).
  myAllPlayers: Player[];
  myAllPicks: Pick[];
  // Targeted partner (resolved from getPlayer when present, else manually chosen).
  partner: TargetManager | null;
  // The player they own that the user wants back. Null when no target was set
  // or when status requires user action.
  targetPlayer: Player | null;
  // For "choose_manager": list of all other teams in this league.
  availableManagers: TargetManager[];
  // Roster + picks for every other team in this league, keyed by team id.
  // We carry the full set so the add-on picker can resolve "Request from X"
  // for either auto-matched (getPlayer set) or manually-chosen partners.
  otherTeamsById: Record<string, { roster: Player[]; picks: Pick[] }>;
  status: RowStatus;
  // Pretty-printed status reason for disabled rows.
  statusReason?: string;
  error: string | null;
}

interface RowSel {
  selected: boolean;
  // Full set of assets I'm sending — includes the searched give-player by
  // default. The submit builder reads directly from these sets, so picks
  // and players are first-class regardless of how they were added.
  mySendPlayerIds: Set<string>;
  mySendPickKeys: Set<string>;
  // Full set of assets I'm receiving from the partner.
  theirReceivePlayerIds: Set<string>;
  theirReceivePickKeys: Set<string>;
  // Null = use the auto-resolved row.partner. Non-null overrides.
  manualPartnerTeamId: string | null;
  expanded: boolean;
}

interface SubmitState {
  status: SubmitStatus;
  message?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PICK_KEY = (year: number, round: number) => `${year}_${round}`;
const pickLabel = (p: Pick): string => {
  const r = p.round === 1 ? "1st" : p.round === 2 ? "2nd" : p.round === 3 ? "3rd" : `${p.round}th`;
  return `${p.year} ${r}`;
};

/** `fetchSleeperLeagueFull` returns team avatars as full sleepercdn URLs,
 *  but `SleeperUserAvatar` expects a bare hash and composes the URL itself.
 *  Strip the prefix when present so we don't end up with a double-prefixed
 *  src and an empty circle on the scan results / confirm screen. */
function avatarHashFromUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /\/avatars\/(?:thumbs\/)?([A-Za-z0-9]+)/.exec(v);
  return m ? m[1] : v;
}

/** Roster ID is encoded into Team.id as `roster_<n>` by fetchSleeperLeagueFull. */
function rosterIdFromTeamId(teamId: string): number {
  const m = /^roster_(\d+)$/.exec(teamId);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Bulk-submit delay schedule. Mirrors WaiverCommand:
 *   - Stages 1-3:  8-15  s   between sends
 *   - Stages 4-7:  20-45 s
 *   - Stages 8+:   60-180 s
 *   - Every 10th:  5-10  min "long pause"
 * Jitter is per-call randomized so even if Sleeper is fingerprinting cadence
 * we don't look like a metronome.
 */
function computeTradeDelayMs(completed: number): number {
  const r = Math.random();
  if (completed > 0 && completed % 10 === 0) {
    return Math.floor((5 + r * 5) * 60_000);
  }
  if (completed < 3)  return Math.floor((8  + r * 7)   * 1_000);
  if (completed < 7)  return Math.floor((20 + r * 25)  * 1_000);
  return                   Math.floor((60 + r * 120) * 1_000);
}

function expiresAtSeconds(option: string): number | null {
  const now = Math.floor(Date.now() / 1000);
  switch (option) {
    case "never": return null;
    case "1h":    return now + 3_600;
    case "24h":   return now + 86_400;
    case "2d":    return now + 172_800;
    case "1w":    return now + 604_800;
    default:      return now + 86_400;
  }
}

// ─── Player autocomplete (inline, matches WaiverCommand pattern) ────────────

function PlayerAutocomplete({
  label,
  placeholder,
  value,
  onSelect,
  onClear,
  disabled,
  testId,
}: {
  label: string;
  placeholder: string;
  value: RankedPlayer | null;
  onSelect: (p: RankedPlayer) => void;
  onClear: () => void;
  disabled?: boolean;
  testId: string;
}) {
  const { dynastyPlayerList } = useValueModel();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return dynastyPlayerList
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, dynastyPlayerList]);

  return (
    <div className="flex-1 min-w-[220px]">
      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </label>
      {value ? (
        <div
          className="flex items-center gap-3 h-12 px-3 rounded-md border border-border bg-card"
          data-testid={`${testId}-selected`}
        >
          {/* Compact avatar (just the circle + team-logo badge) — the text
              block below is the single source for name + pos · team · value.
              Using non-compact mode here was the cause of the duplicated
              "Amon-Ra St. Brown / DET / Amon-Ra St. Brown / WR / DET"
              rendering the user reported. */}
          <PlayerAvatar
            id={value.sleeperId}
            name={value.name}
            pos={value.pos}
            team={value.team}
            size="sm"
            compact
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{value.name}</div>
            <div className="text-[10px] text-muted-foreground">
              <span className={cn("font-bold mr-1", getPositionColor(value.pos))}>{value.pos}</span>
              · {value.team || "FA"} · <span className="text-[#d4af37] tabular-nums">{value.value.toLocaleString()}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`${testId}-clear`}
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="pl-9 h-10 text-sm"
            data-testid={testId}
          />
          {open && suggestions.length > 0 && (
            <div
              className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl overflow-hidden max-h-[360px] overflow-y-auto"
              data-testid={`${testId}-results`}
            >
              {suggestions.map((p) => (
                <button
                  key={p.sleeperId}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onSelect(p); setQuery(""); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/40 text-left transition-colors"
                  data-testid={`${testId}-option-${p.sleeperId}`}
                >
                  {/* Same compact format as the selected state — headshot +
                      NFL team-logo overlay + a single text block. */}
                  <PlayerAvatar
                    id={p.sleeperId}
                    name={p.name}
                    pos={p.pos}
                    team={p.team}
                    size="sm"
                    compact
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      <span className={cn("font-bold mr-1", getPositionColor(p.pos))}>{p.pos}</span>
                      · {p.team || "FA"}
                    </div>
                  </div>
                  <span className="text-[11px] text-[#d4af37] font-semibold tabular-nums shrink-0">
                    {p.value.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RowStatus, string> = {
  ready: "Ready to Offer",
  choose_target: "Choose Target",
  choose_manager: "Choose Manager",
  choose_offer: "Choose Offer",
  target_not_found: "Target Not Found",
  target_free_agent: "Target Is Free Agent",
  target_on_my_roster: "Already On My Roster",
  same_manager: "Same Manager Owns Both",
  invalid_offer: "Invalid Offer",
};

const STATUS_TONE: Record<RowStatus, string> = {
  ready: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  choose_target: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  choose_manager: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  choose_offer: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  target_not_found: "bg-muted text-muted-foreground border-border",
  target_free_agent: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  target_on_my_roster: "bg-muted text-muted-foreground border-border",
  same_manager: "bg-muted text-muted-foreground border-border",
  invalid_offer: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

function StatusBadge({ status }: { status: RowStatus }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] font-semibold whitespace-nowrap", STATUS_TONE[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function BulkTrades() {
  const { isConnected, leagues, user } = useSleeper();
  const [givePlayer, setGivePlayer] = useState<RankedPlayer | null>(null);
  const [getPlayer, setGetPlayer] = useState<RankedPlayer | null>(null);
  const [step, setStep] = useState<"search" | "review" | "confirm" | "submitting" | "done">("search");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkTradeRow[]>([]);
  const [selections, setSelections] = useState<Record<string, RowSel>>({});
  const [submitResults, setSubmitResults] = useState<Record<string, SubmitState>>({});
  const [expiresOption, setExpiresOption] = useState("24h");
  const cancelSubmitRef = useRef(false);

  // Live session — re-read on mount and after step transitions so we don't
  // start the queue with a stale token.
  const [session, setSession] = useState(() => getSleeperSession());
  useEffect(() => { setSession(getSleeperSession()); }, [step]);
  const token = session && !isSessionExpired(session) ? session.token : null;

  const reset = useCallback(() => {
    setGivePlayer(null);
    setGetPlayer(null);
    setRows([]);
    setSelections({});
    setSubmitResults({});
    setScanError(null);
    setStep("search");
    cancelSubmitRef.current = false;
  }, []);

  // ─── Scan ─────────────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    // At least one search box required (Case D guards against the empty case).
    if (!givePlayer && !getPlayer) return;
    if (!user?.userId) return;
    setScanLoading(true);
    setScanError(null);

    try {
      const results = await Promise.allSettled(
        leagues.map((lg) => fetchSleeperLeagueFull(lg.leagueId, user.userId)),
      );

      const next: BulkTradeRow[] = [];
      const nextSel: Record<string, RowSel> = {};

      results.forEach((res, idx) => {
        const lg = leagues[idx];
        if (res.status !== "fulfilled") return;
        const { league, userTeamId } = res.value as { league: League; userTeamId: string | null };
        if (!userTeamId) return;
        const myTeam = league.teams.find((t) => t.id === userTeamId);
        if (!myTeam) return;

        // Locate give + target relative to this league. Either or both can
        // be null depending on which search boxes the user filled in.
        const myPlayer = givePlayer
          ? myTeam.roster.find((p) => (p.sleeperId ?? p.id) === givePlayer.sleeperId) ?? null
          : null;
        const otherTeams: Team[] = league.teams.filter((t) => t.id !== myTeam.id);

        const targetOnMine = getPlayer
          ? myTeam.roster.find((p) => (p.sleeperId ?? p.id) === getPlayer.sleeperId) ?? null
          : null;
        const targetOwnerTeam = getPlayer && !targetOnMine
          ? otherTeams.find((t) =>
              t.roster.some((p) => (p.sleeperId ?? p.id) === getPlayer.sleeperId),
            ) ?? null
          : null;
        const targetPlayer: Player | null = targetOwnerTeam && getPlayer
          ? targetOwnerTeam.roster.find((p) => (p.sleeperId ?? p.id) === getPlayer.sleeperId) ?? null
          : null;

        // Case-by-case inclusion. The page should only surface leagues that
        // have *something* to do with the user's search; pure noise is filtered.
        //   Case A (give only):       must own give-player here.
        //   Case B (get only):        someone else must own get-player here.
        //   Case C (both):            must own give-player here (target may be missing).
        if (givePlayer && !myPlayer) return;
        if (!givePlayer && getPlayer && !targetOwnerTeam && !targetOnMine) return;

        const myRosterId = rosterIdFromTeamId(myTeam.id);
        const availableManagers: TargetManager[] = otherTeams.map((t) => ({
          teamId: t.id,
          teamName: t.name,
          ownerName: t.owner,
          rosterId: rosterIdFromTeamId(t.id),
          ownerId: t.ownerId ?? null,
          avatar: avatarHashFromUrl(t.avatar ?? null),
        }));

        // Auto-resolved partner = the team that owns the searched target
        // (only when there's no conflict like target_on_my_roster).
        let partner: TargetManager | null = null;
        if (targetOwnerTeam) {
          partner = {
            teamId: targetOwnerTeam.id,
            teamName: targetOwnerTeam.name,
            ownerName: targetOwnerTeam.owner,
            rosterId: rosterIdFromTeamId(targetOwnerTeam.id),
            ownerId: targetOwnerTeam.ownerId ?? null,
            avatar: avatarHashFromUrl(targetOwnerTeam.avatar ?? null),
          };
        }

        // Initial status — derived purely from search inputs + roster scan.
        // The dynamic status (post-user-edits) is recomputed in deriveStatus.
        let initialStatus: RowStatus;
        if (getPlayer && targetOnMine) {
          initialStatus = "target_on_my_roster";
        } else if (getPlayer && !targetOwnerTeam && !targetOnMine && givePlayer && myPlayer && /* searched player in MY league but target nowhere */ true) {
          initialStatus = "target_free_agent";
        } else if (givePlayer && getPlayer && myPlayer && partner) {
          initialStatus = "ready";
        } else if (givePlayer && myPlayer && !getPlayer) {
          initialStatus = "choose_target"; // Case A
        } else if (getPlayer && partner && !givePlayer) {
          initialStatus = "choose_offer"; // Case B
        } else {
          initialStatus = "choose_manager"; // catch-all
        }

        const otherTeamsById: Record<string, { roster: Player[]; picks: Pick[] }> = {};
        for (const t of otherTeams) {
          otherTeamsById[t.id] = { roster: t.roster, picks: t.picks };
        }

        next.push({
          leagueId: lg.leagueId,
          leagueName: lg.name,
          leagueAvatar: avatarHashFromUrl(lg.avatar ?? null),
          format: lg.format,
          scoringFormat: lg.scoringFormat,
          myRosterId,
          myTeamId: myTeam.id,
          myPlayer,
          myAllPlayers: myTeam.roster,
          myAllPicks: myTeam.picks,
          partner,
          targetPlayer,
          availableManagers,
          otherTeamsById,
          status: initialStatus,
          error: null,
        });

        // Default selection sets — pre-populate the searched primary on each
        // side. User can add or remove via the editor.
        const mySendPlayerIds = new Set<string>();
        if (myPlayer?.sleeperId) mySendPlayerIds.add(myPlayer.sleeperId);
        const theirReceivePlayerIds = new Set<string>();
        if (targetPlayer?.sleeperId) theirReceivePlayerIds.add(targetPlayer.sleeperId);

        nextSel[lg.leagueId] = {
          selected: initialStatus === "ready",
          mySendPlayerIds,
          mySendPickKeys: new Set(),
          theirReceivePlayerIds,
          theirReceivePickKeys: new Set(),
          manualPartnerTeamId: null,
          expanded: false,
        };
      });

      setRows(next);
      setSelections(nextSel);
      setStep("review");
    } catch (err: any) {
      console.warn("[BulkTrades] scan failed:", err?.message ?? err);
      setScanError("Failed to scan leagues. Please retry.");
    } finally {
      setScanLoading(false);
    }
  }, [givePlayer, getPlayer, leagues, user?.userId]);

  /** Derive the live status for a row from its current selection state.
   *  Static statuses from the scan (target_on_my_roster, target_free_agent,
   *  same_manager, target_not_found) take precedence and short-circuit. */
  const deriveStatus = useCallback((row: BulkTradeRow, sel: RowSel | undefined): RowStatus => {
    if (row.status === "target_on_my_roster" || row.status === "target_free_agent"
        || row.status === "same_manager" || row.status === "target_not_found") {
      return row.status;
    }
    const partner = row.partner || (sel?.manualPartnerTeamId
      ? row.availableManagers.find((m) => m.teamId === sel.manualPartnerTeamId) ?? null
      : null);
    const sendCount = (sel?.mySendPlayerIds.size ?? 0) + (sel?.mySendPickKeys.size ?? 0);
    const receiveCount = (sel?.theirReceivePlayerIds.size ?? 0) + (sel?.theirReceivePickKeys.size ?? 0);
    if (!partner) return "choose_manager";
    if (sendCount === 0) return "choose_offer";
    if (receiveCount === 0) return "choose_target";
    return "ready";
  }, []);

  // ─── Per-row helpers ──────────────────────────────────────────────────────

  /** Effective partner for a row — uses the manual selection in needs_target rows. */
  const effectivePartner = useCallback((row: BulkTradeRow, sel: RowSel | undefined): TargetManager | null => {
    if (row.partner) return row.partner;
    if (sel?.manualPartnerTeamId) {
      return row.availableManagers.find((m) => m.teamId === sel.manualPartnerTeamId) ?? null;
    }
    return null;
  }, []);

  /** Eligible = derived status === "ready" AND not statically blocked by a
   *  conflict (own both, target on my roster, etc.). The Send button gates
   *  on this; "Select All Eligible" only flips ready rows. */
  const isRowEligible = useCallback((row: BulkTradeRow, sel: RowSel | undefined): boolean => {
    return deriveStatus(row, sel) === "ready";
  }, [deriveStatus]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selections[r.leagueId]?.selected && isRowEligible(r, selections[r.leagueId])),
    [rows, selections, isRowEligible],
  );

  const eligibleRows = useMemo(
    () => rows.filter((r) => isRowEligible(r, selections[r.leagueId])),
    [rows, selections, isRowEligible],
  );

  const allEligibleSelected =
    eligibleRows.length > 0 && eligibleRows.every((r) => selections[r.leagueId]?.selected);

  const toggleSelection = (leagueId: string) => {
    setSelections((s) => ({
      ...s,
      [leagueId]: { ...s[leagueId], selected: !s[leagueId]?.selected },
    }));
  };
  const toggleAll = () => {
    const target = !allEligibleSelected;
    setSelections((s) => {
      const next = { ...s };
      for (const r of eligibleRows) {
        next[r.leagueId] = { ...next[r.leagueId], selected: target };
      }
      return next;
    });
  };
  const toggleExpanded = (leagueId: string) => {
    setSelections((s) => ({
      ...s,
      [leagueId]: { ...s[leagueId], expanded: !s[leagueId]?.expanded },
    }));
  };
  const setManualPartner = (leagueId: string, teamId: string | null) => {
    // Changing partner invalidates any "from them" picks selected against
    // the previous partner's roster. Clear them so we never send a request
    // for an asset the new partner doesn't own.
    setSelections((s) => ({
      ...s,
      [leagueId]: {
        ...s[leagueId],
        manualPartnerTeamId: teamId,
        theirReceivePlayerIds: new Set(),
        theirReceivePickKeys: new Set(),
      },
    }));
  };
  const toggleAsset = (leagueId: string, side: "send" | "receive", kind: "player" | "pick", id: string) => {
    setSelections((s) => {
      const sel = s[leagueId];
      const key = side === "send"
        ? (kind === "player" ? "mySendPlayerIds" : "mySendPickKeys")
        : (kind === "player" ? "theirReceivePlayerIds" : "theirReceivePickKeys");
      const next = new Set(sel[key]);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...s, [leagueId]: { ...sel, [key]: next } };
    });
  };

  // ─── Submit ───────────────────────────────────────────────────────────────

  const startConfirm = () => setStep("confirm");

  const handleSubmit = useCallback(async () => {
    cancelSubmitRef.current = false;
    if (!token) return;

    const targets = selectedRows.slice();
    if (targets.length === 0) return;

    // Safety preflight — soft cap + kill switch.
    const pre = preflightBatch({ action: "trade", batchSize: targets.length });
    if (!pre.ok) {
      setStep("done");
      return;
    }

    // Seed all targets as pending so the results UI renders immediately.
    setSubmitResults(() => {
      const init: Record<string, SubmitState> = {};
      for (const r of targets) init[r.leagueId] = { status: "pending" };
      return init;
    });
    setStep("submitting");

    let completed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (cancelSubmitRef.current) {
        // Mark remaining as skipped.
        setSubmitResults((s) => {
          const next = { ...s };
          for (let j = i; j < targets.length; j++) {
            next[targets[j].leagueId] = { status: "skipped", message: "Cancelled" };
          }
          return next;
        });
        break;
      }

      const row = targets[i];
      const sel = selections[row.leagueId];
      const partner = effectivePartner(row, sel);
      if (!partner) {
        setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "skipped", message: "No partner selected" } }));
        continue;
      }

      // Stage 1: optional delay before this submission.
      if (i > 0) {
        setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "delaying" } }));
        const delay = computeTradeDelayMs(completed);
        const STEP_MS = 250;
        let elapsed = 0;
        while (elapsed < delay) {
          if (cancelSubmitRef.current) break;
          await new Promise((r) => setTimeout(r, Math.min(STEP_MS, delay - elapsed)));
          elapsed += STEP_MS;
        }
        if (cancelSubmitRef.current) {
          setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "skipped", message: "Cancelled" } }));
          continue;
        }
      }

      // Stage 2: pre-send validation + payload assembly.
      setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "submitting" } }));
      const adds: Record<string, number> = {};
      const drops: Record<string, number> = {};
      const draftPicks: Array<{ season: string; round: number; roster_id: number; owner_id: number; previous_owner_id: number }> = [];

      // Resolve send (mine) by intersecting selected ids with my actual roster.
      // Anything selected that we can't verify on my roster gets dropped to
      // satisfy the "user owns all sent assets" pre-send rule.
      const myRosterById = new Map<string, Player>();
      for (const p of row.myAllPlayers) {
        const sid = p.sleeperId ?? p.id;
        if (sid) myRosterById.set(sid, p);
      }
      const myPicksByKey = new Map<string, Pick>();
      for (const pk of row.myAllPicks) {
        myPicksByKey.set(PICK_KEY(pk.year, pk.round), pk);
      }
      const partnerSnapshot = row.otherTeamsById[partner.teamId];
      const partnerById = new Map<string, Player>();
      if (partnerSnapshot) {
        for (const p of partnerSnapshot.roster) {
          const sid = p.sleeperId ?? p.id;
          if (sid) partnerById.set(sid, p);
        }
      }
      const partnerPicksByKey = new Map<string, Pick>();
      if (partnerSnapshot) {
        for (const pk of partnerSnapshot.picks) {
          partnerPicksByKey.set(PICK_KEY(pk.year, pk.round), pk);
        }
      }

      // Send-side players I actually own.
      const verifiedSendPlayers: string[] = Array.from(sel.mySendPlayerIds).filter((sid) => myRosterById.has(sid));
      // Send-side picks I actually own.
      const verifiedSendPicks: Pick[] = Array.from(sel.mySendPickKeys)
        .map((k) => myPicksByKey.get(k))
        .filter((pk): pk is Pick => !!pk);
      // Receive-side players partner actually owns.
      const verifiedReceivePlayers: string[] = Array.from(sel.theirReceivePlayerIds).filter((sid) => partnerById.has(sid));
      const verifiedReceivePicks: Pick[] = Array.from(sel.theirReceivePickKeys)
        .map((k) => partnerPicksByKey.get(k))
        .filter((pk): pk is Pick => !!pk);

      // Pre-send validation rules (per spec):
      //   - manager exists ✓ (checked above)
      //   - send count > 0
      //   - receive count > 0
      //   - user owns all sent (enforced via verifiedSend* filter)
      //   - manager owns all received (enforced via verifiedReceive* filter)
      //   - no duplicate ids (Set semantics already)
      //   - user not trading with themselves
      const sendTotal = verifiedSendPlayers.length + verifiedSendPicks.length;
      const receiveTotal = verifiedReceivePlayers.length + verifiedReceivePicks.length;
      if (partner.rosterId === row.myRosterId) {
        setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "skipped", message: "Cannot trade with yourself" } }));
        continue;
      }
      if (sendTotal === 0 || receiveTotal === 0) {
        setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "skipped", message: "Both sides must have at least one asset" } }));
        continue;
      }

      for (const sid of verifiedSendPlayers) {
        adds[sid] = partner.rosterId;
        drops[sid] = row.myRosterId;
      }
      for (const pk of verifiedSendPicks) {
        draftPicks.push({
          season: String(pk.year),
          round: pk.round,
          roster_id: pk.originalRosterId ?? row.myRosterId,
          owner_id: partner.rosterId,
          previous_owner_id: row.myRosterId,
        });
      }
      for (const sid of verifiedReceivePlayers) {
        adds[sid] = row.myRosterId;
        drops[sid] = partner.rosterId;
      }
      for (const pk of verifiedReceivePicks) {
        draftPicks.push({
          season: String(pk.year),
          round: pk.round,
          roster_id: pk.originalRosterId ?? partner.rosterId,
          owner_id: row.myRosterId,
          previous_owner_id: partner.rosterId,
        });
      }

      try {
        await sleeperWriteLimiter.waitTurn("trade");
        const result = await proposeTrade({
          leagueId: row.leagueId,
          adds, drops, draftPicks,
          expiresAt: expiresAtSeconds(expiresOption),
        });
        const ok = !!result?.transaction_id;
        if (ok) {
          setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "success" } }));
          // Fire-and-forget StatChasers link DM (existing behavior — kept
          // intentionally per spec). Never blocks the trade itself.
          if (partner.ownerId) {
            void firePostTradeLinkDm({
              recipientUserId: partner.ownerId,
              leagueId: row.leagueId,
              senderUserId: user?.userId ?? null,
              queueType: "bulk-trade",
            });
          }
          completed++;
        } else {
          setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "error", message: "Sleeper accepted the request but returned no transaction id." } }));
        }
      } catch (err: any) {
        const msg = err?.message ?? "Trade submission failed.";
        if (sleeperWriteLimiter.looksLikeRateLimit(err)) {
          // Mark this row failed AND stop the rest of the queue so we
          // don't burn through every league after a 429.
          setSubmitResults((s) => {
            const next = { ...s, [row.leagueId]: { status: "error" as SubmitStatus, message: "Sleeper is rate-limiting. Pausing the queue." } };
            for (let j = i + 1; j < targets.length; j++) {
              next[targets[j].leagueId] = { status: "skipped", message: "Auto-stopped after rate limit" };
            }
            return next;
          });
          break;
        }
        setSubmitResults((s) => ({ ...s, [row.leagueId]: { status: "error", message: msg } }));
      }
    }

    setStep("done");
  }, [selectedRows, selections, token, expiresOption, effectivePartner, user?.userId]);

  const cancelSubmit = () => { cancelSubmitRef.current = true; };

  // ─── Render ───────────────────────────────────────────────────────────────

  // Not connected to Sleeper at all.
  if (!isConnected) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <ShieldAlert className="w-10 h-10 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-bold">Connect Sleeper to use Bulk Trades</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            We need your Sleeper account to scan every league and find where your players are rostered.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Bulk Trades</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Search one player, scan every league, and build trade offers across your full dynasty portfolio.
        </p>
      </div>

      {/* ── Step: search ──────────────────────────────────────────────────── */}
      {step === "search" && (
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex flex-col md:flex-row gap-4">
              <PlayerAutocomplete
                label="Player I'm trading away"
                placeholder="Search a player on your roster…"
                value={givePlayer}
                onSelect={setGivePlayer}
                onClear={() => setGivePlayer(null)}
                testId="input-bulk-give"
              />
              <PlayerAutocomplete
                label="Player I want"
                placeholder="Search a player you want…"
                value={getPlayer}
                onSelect={setGetPlayer}
                onClear={() => setGetPlayer(null)}
                testId="input-bulk-get"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              At least one search box is required. Fill in <span className="font-semibold">both</span> for a
              targeted give/get scan, or just one to manually build the rest of each offer per league.
            </p>

            {!givePlayer && !getPlayer && (
              <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-search-required">
                Search for at least one player to build bulk trades.
              </p>
            )}

            {scanError && (
              <div className="flex items-center gap-2 text-sm text-rose-500">
                <AlertCircle className="w-4 h-4" /> {scanError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={handleScan}
                disabled={(!givePlayer && !getPlayer) || scanLoading}
                className="bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
                data-testid="button-scan-leagues"
              >
                {scanLoading ? (
                  <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Scanning…</>
                ) : (
                  <>Scan All Leagues <ArrowRight className="w-4 h-4 ml-1.5" /></>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step: review ──────────────────────────────────────────────────── */}
      {step === "review" && (
        <ReviewTable
          rows={rows}
          selections={selections}
          givePlayer={givePlayer}
          getPlayer={getPlayer}
          allEligibleSelected={allEligibleSelected}
          eligibleCount={eligibleRows.length}
          selectedCount={selectedRows.length}
          expiresOption={expiresOption}
          onExpiresChange={setExpiresOption}
          onToggleAll={toggleAll}
          onToggleRow={toggleSelection}
          onToggleExpand={toggleExpanded}
          onSetManualPartner={setManualPartner}
          onToggleAsset={toggleAsset}
          effectivePartner={effectivePartner}
          isRowEligible={isRowEligible}
          deriveStatus={deriveStatus}
          onBack={reset}
          onContinue={startConfirm}
          hasToken={!!token}
        />
      )}

      {/* ── Step: confirm ─────────────────────────────────────────────────── */}
      {step === "confirm" && (
        <ConfirmCard
          rows={selectedRows}
          selections={selections}
          expiresOption={expiresOption}
          effectivePartner={effectivePartner}
          onBack={() => setStep("review")}
          onConfirm={handleSubmit}
          hasToken={!!token}
        />
      )}

      {/* ── Step: submitting / done ───────────────────────────────────────── */}
      {(step === "submitting" || step === "done") && (
        <ProgressCard
          rows={selectedRows}
          submitResults={submitResults}
          selections={selections}
          effectivePartner={effectivePartner}
          submitting={step === "submitting"}
          onCancel={cancelSubmit}
          onReset={reset}
          onBackToReview={() => setStep("review")}
        />
      )}
    </div>
  );
}

// ─── Review table ────────────────────────────────────────────────────────────

interface ReviewTableProps {
  rows: BulkTradeRow[];
  selections: Record<string, RowSel>;
  givePlayer: RankedPlayer | null;
  getPlayer: RankedPlayer | null;
  allEligibleSelected: boolean;
  eligibleCount: number;
  selectedCount: number;
  expiresOption: string;
  onExpiresChange: (v: string) => void;
  onToggleAll: () => void;
  onToggleRow: (leagueId: string) => void;
  onToggleExpand: (leagueId: string) => void;
  onSetManualPartner: (leagueId: string, teamId: string | null) => void;
  onToggleAsset: (leagueId: string, side: "send" | "receive", kind: "player" | "pick", id: string) => void;
  effectivePartner: (row: BulkTradeRow, sel: RowSel | undefined) => TargetManager | null;
  isRowEligible: (row: BulkTradeRow, sel: RowSel | undefined) => boolean;
  deriveStatus: (row: BulkTradeRow, sel: RowSel | undefined) => RowStatus;
  onBack: () => void;
  onContinue: () => void;
  hasToken: boolean;
}

function ReviewTable(p: ReviewTableProps) {
  if (p.rows.length === 0) {
    const searchTerm = p.givePlayer?.name ?? p.getPlayer?.name ?? "the players you searched";
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-2">
          <p className="text-sm font-semibold">No leagues match.</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            No connected league matches your search for <span className="font-semibold">{searchTerm}</span>.
            Try a different player.
          </p>
          <Button variant="ghost" onClick={p.onBack} className="mt-2">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to search
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Sticky header */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border/40">
          <div className="text-sm">
            <span className="font-semibold">{p.rows.length}</span>{" "}
            <span className="text-muted-foreground">{p.rows.length === 1 ? "league" : "leagues"} · </span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{p.selectedCount}</span>{" "}
            <span className="text-muted-foreground">selected</span>
            {p.eligibleCount === 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">No eligible leagues yet — finish the offers below.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={p.onToggleAll}
              disabled={p.eligibleCount === 0}
              className="text-[11px] font-semibold text-[#d4af37] hover:underline disabled:opacity-40 disabled:no-underline"
              data-testid="button-toggle-all"
            >
              {p.allEligibleSelected ? "Deselect All" : "Select All Eligible"}
            </button>
            <Select value={p.expiresOption} onValueChange={p.onExpiresChange}>
              <SelectTrigger className="w-[130px] h-8 text-xs" data-testid="select-expires">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Expires 1h</SelectItem>
                <SelectItem value="24h">Expires 24h</SelectItem>
                <SelectItem value="2d">Expires 2d</SelectItem>
                <SelectItem value="1w">Expires 1w</SelectItem>
                <SelectItem value="never">No expiry</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-bulk-trades">
            <thead>
              <tr className="border-b bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3 py-2 w-10"></th>
                <th className="text-left px-3 py-2">League</th>
                <th className="text-left px-3 py-2">I Send</th>
                <th className="text-left px-3 py-2">I Receive</th>
                <th className="text-left px-3 py-2">Target Manager</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2 w-20">Add/Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {p.rows.map((row) => {
                const sel = p.selections[row.leagueId];
                const status = p.deriveStatus(row, sel);
                const eligible = p.isRowEligible(row, sel);
                const partner = p.effectivePartner(row, sel);

                return (
                  <RowView
                    key={row.leagueId}
                    row={row}
                    sel={sel}
                    partner={partner}
                    status={status}
                    eligible={eligible}
                    onToggleRow={p.onToggleRow}
                    onToggleExpand={p.onToggleExpand}
                    onSetManualPartner={p.onSetManualPartner}
                    onToggleAsset={p.onToggleAsset}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border/40">
          <Button variant="ghost" onClick={p.onBack} data-testid="button-back-to-search">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          {!p.hasToken && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> Reconnect Sleeper to submit trades.
            </div>
          )}
          <Button
            onClick={p.onContinue}
            disabled={p.selectedCount === 0 || !p.hasToken}
            className="bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
            data-testid="button-review-continue"
          >
            Continue · {p.selectedCount} {p.selectedCount === 1 ? "offer" : "offers"}{" "}
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Single row + expandable editor ─────────────────────────────────────────

function RowView({
  row, sel, partner, status, eligible,
  onToggleRow, onToggleExpand, onSetManualPartner, onToggleAsset,
}: {
  row: BulkTradeRow;
  sel: RowSel | undefined;
  partner: TargetManager | null;
  status: RowStatus;
  eligible: boolean;
  onToggleRow: (leagueId: string) => void;
  onToggleExpand: (leagueId: string) => void;
  onSetManualPartner: (leagueId: string, teamId: string | null) => void;
  onToggleAsset: (leagueId: string, side: "send" | "receive", kind: "player" | "pick", id: string) => void;
}) {
  // Resolve the live list of assets going each direction. The verified
  // intersection runs at submit time too — this is purely for display.
  const sendPlayers = useMemo(() => {
    if (!sel) return [] as Player[];
    return row.myAllPlayers.filter((p) => {
      const sid = p.sleeperId ?? p.id;
      return sid && sel.mySendPlayerIds.has(sid);
    });
  }, [row.myAllPlayers, sel]);
  const sendPicks = useMemo(() => {
    if (!sel) return [] as Pick[];
    return row.myAllPicks.filter((pk) => sel.mySendPickKeys.has(PICK_KEY(pk.year, pk.round)));
  }, [row.myAllPicks, sel]);
  const partnerSnap = partner ? row.otherTeamsById[partner.teamId] : null;
  const receivePlayers = useMemo(() => {
    if (!sel || !partnerSnap) return [] as Player[];
    return partnerSnap.roster.filter((p) => {
      const sid = p.sleeperId ?? p.id;
      return sid && sel.theirReceivePlayerIds.has(sid);
    });
  }, [partnerSnap, sel]);
  const receivePicks = useMemo(() => {
    if (!sel || !partnerSnap) return [] as Pick[];
    return partnerSnap.picks.filter((pk) => sel.theirReceivePickKeys.has(PICK_KEY(pk.year, pk.round)));
  }, [partnerSnap, sel]);

  const partnerPlayersForPicker = partnerSnap?.roster ?? [];
  const partnerPicksForPicker = partnerSnap?.picks ?? [];

  // Status-driven static-block check — disables the row's checkbox + dims
  // its appearance when the row is genuinely unusable (target on my roster,
  // free agent, etc.). Choose_target / choose_manager / choose_offer stay
  // visible and active so the user can complete the offer in the editor.
  const isStaticallyBlocked =
    status === "target_on_my_roster" ||
    status === "target_free_agent" ||
    status === "target_not_found" ||
    status === "same_manager";

  return (
    <>
      <tr
        className={cn(
          "transition-colors",
          sel?.selected && eligible && "bg-[#d4af37]/[0.03]",
          isStaticallyBlocked && "opacity-55",
          "hover:bg-muted/20",
        )}
        data-testid={`row-bulk-trade-${row.leagueId}`}
      >
        <td className="px-3 py-2 align-top">
          <Checkbox
            checked={!!sel?.selected && eligible}
            disabled={!eligible}
            onCheckedChange={() => onToggleRow(row.leagueId)}
            data-testid={`checkbox-row-${row.leagueId}`}
          />
        </td>
        <td className="px-3 py-2 align-top">
          <div className="text-sm font-semibold truncate max-w-[180px]">{row.leagueName}</div>
          <div className="text-[10px] text-muted-foreground">{row.scoringFormat} · {row.format}</div>
        </td>
        <td className="px-3 py-2 align-top">
          <AssetList
            players={sendPlayers}
            picks={sendPicks}
            testId={`send-${row.leagueId}`}
            emptyLabel="Choose what to send"
          />
        </td>
        <td className="px-3 py-2 align-top">
          <AssetList
            players={receivePlayers}
            picks={receivePicks}
            testId={`receive-${row.leagueId}`}
            emptyLabel="Choose what to receive"
          />
        </td>
        <td className="px-3 py-2 align-top">
          {partner ? (
            <div className="flex items-center gap-2 min-w-0">
              <SleeperUserAvatar
                username={partner.ownerName}
                avatar={partner.avatar}
                size="sm"
                compact
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate max-w-[140px]" data-testid={`manager-name-${row.leagueId}`}>
                  {partner.ownerName}
                </div>
                {partner.teamName && partner.teamName !== partner.ownerName && (
                  <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{partner.teamName}</div>
                )}
              </div>
            </div>
          ) : isStaticallyBlocked ? (
            <span className="text-[11px] text-muted-foreground italic">—</span>
          ) : (
            <Select
              value={sel?.manualPartnerTeamId ?? ""}
              onValueChange={(v) => onSetManualPartner(row.leagueId, v || null)}
            >
              <SelectTrigger className="h-8 text-xs w-[160px]" data-testid={`select-partner-${row.leagueId}`}>
                <SelectValue placeholder="Choose manager…" />
              </SelectTrigger>
              <SelectContent>
                {row.availableManagers.map((m) => (
                  <SelectItem key={m.teamId} value={m.teamId}>
                    {m.ownerName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </td>
        <td className="px-3 py-2 align-top">
          <StatusBadge status={status} />
        </td>
        <td className="px-3 py-2 align-top text-right">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onToggleExpand(row.leagueId)}
            disabled={isStaticallyBlocked}
            className="h-7 px-2 text-[11px]"
            data-testid={`button-expand-${row.leagueId}`}
          >
            <Pencil className="w-3 h-3 mr-1" />
            {sel?.expanded ? "Close" : "Edit"}
          </Button>
        </td>
      </tr>

      {sel?.expanded && !isStaticallyBlocked && (
        <tr className="bg-muted/10">
          <td colSpan={7} className="p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <AssetPicker
                title="Assets I send"
                emptyLabel="Pick at least one player or pick to send."
                leagueId={row.leagueId}
                side="send"
                players={row.myAllPlayers}
                picks={row.myAllPicks}
                selectedPlayerIds={sel.mySendPlayerIds}
                selectedPickKeys={sel.mySendPickKeys}
                onToggle={onToggleAsset}
              />
              <AssetPicker
                title={partner ? `Assets I receive from ${partner.ownerName}` : "Assets I receive"}
                emptyLabel={partner ? "Pick at least one player or pick to receive." : "Choose a target manager above first."}
                leagueId={row.leagueId}
                side="receive"
                players={partnerPlayersForPicker}
                picks={partnerPicksForPicker}
                selectedPlayerIds={sel.theirReceivePlayerIds}
                selectedPickKeys={sel.theirReceivePickKeys}
                onToggle={onToggleAsset}
                disabled={!partner}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Single compact player chip used in the I Send / I Receive columns.
 *
 * The previous AssetSummary rendered PlayerAvatar in non-compact mode AND
 * its own name/pos/team text, which stacked two copies of the same labels
 * (the report from the field: "De'Von Achane / MIA / De'Von Achane / RB /
 *  MIA / De'Von Achane / RBMIA"). PlayerAvatar in compact mode renders only
 * the headshot + team-logo badge, so the one text block here is the single
 * source for name + pos · team.
 */
function AssetCell({ player, testId }: { player: Player; testId?: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0" data-testid={testId}>
      <PlayerAvatar
        id={player.sleeperId ?? player.id}
        name={player.name}
        pos={player.pos}
        team={player.team}
        size="sm"
        compact
      />
      <div className="min-w-0">
        <div className="text-xs font-semibold truncate max-w-[160px]">{player.name}</div>
        <div className="text-[10px] text-muted-foreground">
          <span className={cn("font-bold mr-1", getPositionColor(player.pos))}>{player.pos}</span>
          · {player.team || "FA"}
        </div>
      </div>
    </div>
  );
}

/** Picks have no headshot; render a small "PICK" tile + label. */
function PickCell({ pick, testId }: { pick: Pick; testId?: string }) {
  const r = pick.round === 1 ? "1st" : pick.round === 2 ? "2nd" : pick.round === 3 ? "3rd" : `${pick.round}th`;
  return (
    <div className="flex items-center gap-2 min-w-0" data-testid={testId}>
      <span className="w-9 h-9 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[9px] font-extrabold ring-1 ring-blue-500/30 flex-shrink-0">
        PICK
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold truncate">{pick.year} {r}</div>
        <div className="text-[10px] text-muted-foreground">Draft pick</div>
      </div>
    </div>
  );
}

/** Compact list of one-or-more assets stacked vertically. Renders an empty
 *  placeholder when the list is empty so the row column doesn't collapse. */
function AssetList({ players, picks, testId, emptyLabel = "—" }: {
  players: Player[];
  picks: Pick[];
  testId?: string;
  emptyLabel?: string;
}) {
  if (players.length === 0 && picks.length === 0) {
    return <span className="text-[11px] text-muted-foreground italic" data-testid={`${testId}-empty`}>{emptyLabel}</span>;
  }
  return (
    <div className="space-y-1.5" data-testid={testId}>
      {players.map((p) => (
        <AssetCell key={p.sleeperId ?? p.id} player={p} />
      ))}
      {picks.map((pk) => (
        <PickCell key={`${pk.year}_${pk.round}_${pk.ownerTeamId}`} pick={pk} />
      ))}
    </div>
  );
}

function AssetPicker({
  title, emptyLabel, leagueId, side, players, picks,
  selectedPlayerIds, selectedPickKeys, onToggle, disabled = false,
}: {
  title: string;
  emptyLabel: string;
  leagueId: string;
  side: "send" | "receive";
  players: Player[];
  picks: Pick[];
  selectedPlayerIds: Set<string>;
  selectedPickKeys: Set<string>;
  onToggle: (leagueId: string, side: "send" | "receive", kind: "player" | "pick", id: string) => void;
  disabled?: boolean;
}) {
  // Sort by value desc so the most-likely asset surfaces first.
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 40),
    [players],
  );
  const sortedPicks = useMemo(
    () => [...picks].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [picks],
  );

  return (
    <div className={cn("rounded-md border border-border/50 bg-card/50 p-3", disabled && "opacity-60")}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
        {disabled ? (
          <div className="text-[11px] text-muted-foreground italic">{emptyLabel}</div>
        ) : sortedPlayers.length === 0 && sortedPicks.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">{emptyLabel}</div>
        ) : null}
        {!disabled && sortedPlayers.map((pl) => {
          const id = pl.sleeperId ?? pl.id;
          const checked = !!pl.sleeperId && selectedPlayerIds.has(pl.sleeperId);
          return (
            <button
              key={id}
              type="button"
              onClick={() => pl.sleeperId && onToggle(leagueId, side, "player", pl.sleeperId)}
              disabled={!pl.sleeperId}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors",
                checked ? "bg-[#d4af37]/15 ring-1 ring-[#d4af37]/40" : "hover:bg-muted/40",
                !pl.sleeperId && "opacity-40 cursor-not-allowed",
              )}
              data-testid={`asset-${side}-player-${id}`}
            >
              <Checkbox checked={checked} className="pointer-events-none" />
              <span className={cn("text-[10px] font-bold uppercase px-1 rounded", getPositionColor(pl.pos))}>{pl.pos}</span>
              <span className="text-xs font-medium truncate flex-1">{pl.name}</span>
              <span className="text-[10px] text-muted-foreground">{pl.team || "FA"}</span>
              {pl.value > 0 && (
                <span className="text-[10px] text-[#d4af37] tabular-nums">{pl.value.toLocaleString()}</span>
              )}
            </button>
          );
        })}
        {!disabled && sortedPicks.map((pk) => {
          const key = PICK_KEY(pk.year, pk.round);
          const checked = selectedPickKeys.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(leagueId, side, "pick", key)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors",
                checked ? "bg-[#d4af37]/15 ring-1 ring-[#d4af37]/40" : "hover:bg-muted/40",
              )}
              data-testid={`asset-${side}-pick-${key}`}
            >
              <Checkbox checked={checked} className="pointer-events-none" />
              <span className="text-[10px] font-bold uppercase px-1 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400">PICK</span>
              <span className="text-xs font-medium flex-1">{pickLabel(pk)}</span>
              {pk.value > 0 && (
                <span className="text-[10px] text-[#d4af37] tabular-nums">{pk.value.toLocaleString()}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Confirm card ────────────────────────────────────────────────────────────

function ConfirmCard({
  rows, selections, expiresOption, effectivePartner,
  onBack, onConfirm, hasToken,
}: {
  rows: BulkTradeRow[];
  selections: Record<string, RowSel>;
  expiresOption: string;
  effectivePartner: (row: BulkTradeRow, sel: RowSel | undefined) => TargetManager | null;
  onBack: () => void;
  onConfirm: () => void;
  hasToken: boolean;
}) {
  const expiresLabel: Record<string, string> = {
    "1h": "1 hour", "24h": "24 hours", "2d": "2 days", "1w": "1 week", never: "never",
  };
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold">Send {rows.length} trade {rows.length === 1 ? "offer" : "offers"}?</h2>
          <p className="text-sm text-muted-foreground">
            You are about to send <span className="font-semibold text-foreground">{rows.length}</span> trade{" "}
            {rows.length === 1 ? "offer" : "offers"} across <span className="font-semibold text-foreground">{rows.length}</span>{" "}
            {rows.length === 1 ? "league" : "leagues"}. Offers expire in{" "}
            <span className="font-semibold text-foreground">{expiresLabel[expiresOption] ?? "24 hours"}</span>.
          </p>
        </div>

        <div className="divide-y divide-border/30 border border-border/40 rounded-md max-h-[320px] overflow-y-auto">
          {rows.map((row) => {
            const sel = selections[row.leagueId];
            const partner = effectivePartner(row, sel);
            return (
              <div key={row.leagueId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                {/* Left: league avatar + name. SleeperUserAvatar accepts any
                    Sleeper avatar hash — the URL convention is the same for
                    leagues + users (`/avatars/thumbs/{hash}`) so we reuse it. */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <SleeperUserAvatar
                    username={row.leagueName}
                    avatar={row.leagueAvatar}
                    size="sm"
                    compact
                  />
                  <span className="font-semibold truncate" data-testid={`confirm-league-${row.leagueId}`}>
                    {row.leagueName}
                  </span>
                </div>
                {/* Right: "to" + partner avatar + ownerName. */}
                <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                  <span className="text-muted-foreground shrink-0">to</span>
                  {partner ? (
                    <>
                      <SleeperUserAvatar
                        username={partner.ownerName}
                        avatar={partner.avatar}
                        size="sm"
                        compact
                      />
                      <span className="font-medium truncate" data-testid={`confirm-partner-${row.leagueId}`}>
                        {partner.ownerName}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {isWriteEnabled() ? (
          <SafePacingNotice variant="idle" batchSize={rows.length} />
        ) : (
          <SafePacingNotice variant="kill" />
        )}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-confirm-back">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!hasToken || rows.length === 0 || !isWriteEnabled()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            data-testid="button-confirm-submit"
          >
            <Send className="w-4 h-4 mr-1.5" />
            Send {rows.length} {rows.length === 1 ? "Offer" : "Offers"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Progress card ───────────────────────────────────────────────────────────

const SUBMIT_LABEL: Record<SubmitStatus, string> = {
  pending: "Queued",
  delaying: "Pacing…",
  submitting: "Submitting…",
  success: "Sent",
  error: "Failed",
  skipped: "Cancelled",
};

function StatusIcon({ s }: { s: SubmitStatus }) {
  if (s === "success") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (s === "error")   return <AlertCircle className="w-4 h-4 text-rose-500" />;
  if (s === "skipped") return <Minus className="w-4 h-4 text-amber-500" />;
  return <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />;
}

function ProgressCard({
  rows, submitResults, selections, effectivePartner, submitting, onCancel, onReset, onBackToReview,
}: {
  rows: BulkTradeRow[];
  submitResults: Record<string, SubmitState>;
  selections: Record<string, RowSel>;
  effectivePartner: (row: BulkTradeRow, sel: RowSel | undefined) => TargetManager | null;
  submitting: boolean;
  onCancel: () => void;
  onReset: () => void;
  onBackToReview: () => void;
}) {
  const sent = rows.filter((r) => submitResults[r.leagueId]?.status === "success").length;
  const failed = rows.filter((r) => submitResults[r.leagueId]?.status === "error").length;
  const skipped = rows.filter((r) => submitResults[r.leagueId]?.status === "skipped").length;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">
              {submitting ? "Submitting trades…" : "Trade run complete"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{sent}</span> sent ·{" "}
              <span className="text-rose-600 dark:text-rose-400 font-semibold">{failed}</span> failed ·{" "}
              <span className="text-amber-600 dark:text-amber-400 font-semibold">{skipped}</span> cancelled
            </p>
          </div>
          {submitting ? (
            <Button variant="outline" onClick={onCancel} data-testid="button-cancel-submit">
              <X className="w-4 h-4 mr-1.5" /> Cancel remaining
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onBackToReview} data-testid="button-back-to-review">
                Back to review
              </Button>
              <Button onClick={onReset} className="bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold" data-testid="button-new-bulk-trade">
                <Plus className="w-4 h-4 mr-1.5" /> New bulk trade
              </Button>
            </div>
          )}
        </div>

        <div className="divide-y divide-border/30 border border-border/40 rounded-md">
          {rows.map((row) => {
            const sel = selections[row.leagueId];
            const partner = effectivePartner(row, sel);
            const result = submitResults[row.leagueId] ?? { status: "pending" as SubmitStatus };
            return (
              <div key={row.leagueId} className="flex items-center gap-3 px-3 py-2.5 text-xs">
                <StatusIcon s={result.status} />
                <SleeperUserAvatar
                  username={row.leagueName}
                  avatar={row.leagueAvatar}
                  size="sm"
                  compact
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{row.leagueName}</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
                    <span className="shrink-0">to</span>
                    {partner ? (
                      <>
                        <SleeperUserAvatar
                          username={partner.ownerName}
                          avatar={partner.avatar}
                          size="xs"
                          compact
                        />
                        <span className="truncate">{partner.ownerName}</span>
                      </>
                    ) : (
                      <span className="italic">—</span>
                    )}
                    {row.myPlayer && <span className="truncate">· {row.myPlayer.name}</span>}
                    {row.targetPlayer && <span className="truncate">↔ {row.targetPlayer.name}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide",
                    result.status === "success" && "text-emerald-600 dark:text-emerald-400",
                    result.status === "error" && "text-rose-600 dark:text-rose-400",
                    result.status === "skipped" && "text-amber-600 dark:text-amber-400",
                  )}>
                    {SUBMIT_LABEL[result.status]}
                  </div>
                  {result.message && (
                    <div className="text-[10px] text-muted-foreground max-w-[200px] truncate">{result.message}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default BulkTrades;
