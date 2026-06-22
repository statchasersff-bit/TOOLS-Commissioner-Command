import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionHeader } from "@/components/SectionHeader";
import { useToast } from "@/hooks/use-toast";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { FavoriteTeamPicker } from "@/components/FavoriteTeamPicker";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, isMyTeamThemeReady, type ThemeMode } from "@/contexts/ThemeContext";
import { useSleeper } from "@/contexts/SleeperContext";
import type { SleeperLeagueSummary } from "@/types";
import { NFL_TEAMS } from "@/config/nflTeams";
import { cn } from "@/lib/utils";
import { Loader2, Star, Sun, Moon, Palette, ListChecks, SlidersHorizontal, type LucideIcon } from "lucide-react";

type SettingsTab = "general" | "leagues";

const TABS: Array<{ id: SettingsTab; label: string; Icon: LucideIcon }> = [
  { id: "general", label: "General", Icon: SlidersHorizontal },
  { id: "leagues", label: "Leagues", Icon: ListChecks },
];

const PILL_BASE =
  "relative flex items-center justify-center gap-2 font-semibold transition-all duration-200 rounded-xl text-[13px] tracking-[0.01em]";
const PILL_ACTIVE =
  "bg-[var(--sc-blue)] text-white shadow-[0_4px_12px_rgba(11,35,68,0.18)] dark-any:bg-[linear-gradient(135deg,rgba(11,58,122,0.85)_0%,rgba(11,58,122,0.65)_100%)] dark-any:shadow-[0_2px_12px_rgba(11,58,122,0.40),inset_0_1px_0_rgba(255,255,255,0.06)] dark-any:border dark-any:border-[#d4af37]/30";
const PILL_INACTIVE =
  "text-[var(--sc-text-muted)] hover:bg-[var(--sc-blue-soft)] hover:text-[var(--sc-blue)] dark-any:text-white/45 dark-any:hover:bg-transparent dark-any:hover:text-white/70";

/**
 * Full-page Settings — Theme, Personalization, and Leagues. Lives in the
 * navigation system as the top-level "settings" tab (no sub-tabs), mirroring
 * the Manage Account page. Theme and league selections persist immediately;
 * the favorite-team picker uses a draft + Save so users can browse first.
 */
export function SettingsPage({ initialTab = "general" }: { initialTab?: SettingsTab } = {}) {
  const { toast } = useToast();
  const { isAuthenticatedUser } = useAuth();
  const { favoriteAbbr, saving, setFavoriteTeam, clearFavoriteTeam } = useFavoriteTeam();
  const { themeMode, setThemeMode, myTeamReady } = useTheme();
  const { isConnected, allLeagues, includedLeagueIds, setLeagueIncluded } = useSleeper();

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const includedSet = new Set(includedLeagueIds);
  const selectedLeagues = allLeagues.filter((l) => includedSet.has(l.leagueId));
  const filteredOutLeagues = allLeagues.filter((l) => !includedSet.has(l.leagueId));

  // Group filtered-out leagues by WHY they were filtered, so we show one
  // category sub-heading per reason instead of repeating a pill on every row.
  // Eligible leagues the user manually hid have no reason → "Hidden by you".
  const filteredOutGroups = groupByFilterReason(filteredOutLeagues);

  // Draft the favorite team so the user can browse around before committing.
  const [draftAbbr, setDraftAbbr] = useState<string | null>(favoriteAbbr);
  const dirty = draftAbbr !== favoriteAbbr;

  // The Theme section's "My Team" option mirrors the team currently picked in
  // Personalization (the draft), so it updates the moment a team is selected.
  const draftTeam = draftAbbr ? NFL_TEAMS.find((t) => t.abbreviation === draftAbbr) ?? null : null;

  // "My Team" theme is gated on the *drafted* pick, not just the saved favorite,
  // so selecting a supported team (Arizona today) unlocks the tile immediately —
  // the user shouldn't have to Save first and then come back for the theme.
  const draftMyTeamReady = isMyTeamThemeReady(draftAbbr);

  // Applying "My Team" needs the favorite saved (the theme reads the saved
  // favorite). When the user picks the tile with an unsaved-but-supported team,
  // we save it, then apply the theme once `myTeamReady` flips true.
  const [pendingMyTeam, setPendingMyTeam] = useState(false);
  useEffect(() => {
    if (pendingMyTeam && myTeamReady) {
      setThemeMode("my_team");
      setPendingMyTeam(false);
    }
  }, [pendingMyTeam, myTeamReady, setThemeMode]);

  const handleSelectTheme = (mode: ThemeMode) => {
    if (mode !== "my_team") { setThemeMode(mode); return; }
    if (!draftMyTeamReady || !draftAbbr) return; // tile is disabled in this case
    if (draftAbbr !== favoriteAbbr) {
      // Commit the drafted team so the theme has a saved favorite to read.
      void setFavoriteTeam(draftAbbr);
      toast({ title: "Favorite team set.", description: favoriteTeamLabel(draftAbbr) });
      setPendingMyTeam(true);
    } else {
      setThemeMode("my_team");
    }
  };

  const handleSave = async () => {
    if (!dirty || !draftAbbr) return;
    await setFavoriteTeam(draftAbbr);
    toast({ title: "Favorite team saved.", description: favoriteTeamLabel(draftAbbr) });
  };

  const handleClear = async () => {
    await clearFavoriteTeam();
    setDraftAbbr(null);
    toast({ title: "Favorite team removed." });
  };

  return (
    <div className="space-y-5">
      {/* ── Page header + sub-tab switcher (desktop) ─────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Settings"
          subtitle="Customize your Commissioner Command experience."
        />

        <div className="hidden md:flex items-center gap-2 flex-shrink-0 pt-1">
          <div
            className={cn(
              "grid flex-shrink-0 rounded-2xl p-1 gap-1 w-[260px] h-12",
              "bg-[var(--sc-card-bg)] border border-[var(--sc-border)]",
              "dark-any:bg-white/[0.04] dark-any:border-white/[0.07]",
            )}
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            {TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  data-testid={`settings-tab-${id}-desktop`}
                  className={cn(PILL_BASE, isActive ? PILL_ACTIVE : PILL_INACTIVE)}
                >
                  <Icon className="w-[15px] h-[15px] flex-shrink-0" />
                  {label}
                  {isActive && (
                    <span
                      className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full w-7 h-0.5"
                      style={{ background: "#d6a21e", opacity: 0.95 }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Sub-tab switcher (mobile only) ───────────────────────────────── */}
      <div className="md:hidden flex justify-center !mt-0">
        <div
          className={cn(
            "grid w-[90vw] h-12 rounded-2xl p-1 gap-1",
            "bg-[var(--sc-card-bg)] border border-[var(--sc-border)]",
            "dark-any:bg-white/[0.04] dark-any:border-white/[0.07]",
          )}
          style={{ gridTemplateColumns: "1fr 1fr" }}
        >
          {TABS.map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                data-testid={`settings-tab-${id}`}
                className={cn(PILL_BASE, isActive ? PILL_ACTIVE : PILL_INACTIVE)}
              >
                <Icon className="w-[15px] h-[15px] flex-shrink-0" />
                {label}
                {isActive && (
                  <span
                    className="sc-subtab-underline absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full w-7 h-0.5"
                    style={{ background: "#d6a21e", opacity: 0.95 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "general" && (<>
      {/* ── Theme ─────────────────────────────────────────────────────── */}
      <Card className="p-5 sm:p-6 space-y-3" data-testid="settings-theme">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-[#d4af37]" />
          <h3 className="text-sm font-bold uppercase tracking-wider">Theme</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Pick how Commissioner Command looks. <span className="font-semibold text-foreground">My Team</span> tints
          the app with your favorite NFL team's colors while preserving readable contrast.
        </p>

        <div className="grid grid-cols-3 gap-2" data-testid="theme-mode-picker">
          <ThemeChoice mode="light"   current={themeMode} onSelect={handleSelectTheme} icon={Sun}  label="Light" />
          <ThemeChoice mode="x-mode"  current={themeMode} onSelect={handleSelectTheme} icon={Moon} label="Dark" />
          <ThemeChoice
            mode="my_team"
            current={themeMode}
            onSelect={handleSelectTheme}
            icon={Star}
            logoUrl={draftTeam?.logoUrl}
            label={draftAbbr ? `My Team · ${draftAbbr}` : "My Team · Select team"}
            disabled={!draftMyTeamReady}
          />
        </div>

        {!draftMyTeamReady && (
          <p className="text-[11px] text-amber-500 dark:text-amber-400" data-testid="my-team-mode-gated">
            My Team theme is available for the Arizona Cardinals only right now. Pick them as your
            favorite team below to use it. More teams coming soon.
          </p>
        )}
      </Card>

      {/* ── Personalization ───────────────────────────────────────────── */}
      <Card className="p-5 sm:p-6 space-y-3" data-testid="settings-personalization">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-[#d4af37]" />
          <h3 className="text-sm font-bold uppercase tracking-wider">Personalization</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose your favorite NFL team to personalize your Commissioner Command experience.
        </p>

        {!isAuthenticatedUser && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            You're not logged into a StatChasers account, your favorite team will be saved to this browser only.
          </p>
        )}

        <FavoriteTeamPicker selectedAbbr={draftAbbr} onSelect={setDraftAbbr} />

        {favoriteAbbr && (
          <p className="text-[11px] text-muted-foreground">
            Currently set: <span className="font-semibold text-foreground">{favoriteTeamLabel(favoriteAbbr)}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            onClick={handleSave}
            disabled={saving || !draftAbbr || !dirty}
            className="bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
            data-testid="settings-save-team"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Save favorite team
          </Button>
          {favoriteAbbr && (
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={saving}
              data-testid="settings-clear-team"
            >
              Clear favorite team
            </Button>
          )}
        </div>
      </Card>
      </>)}

      {activeTab === "leagues" && (
      /* ── Leagues ───────────────────────────────────────────────────── */
      <Card className="p-5 sm:p-6 space-y-3" data-testid="settings-leagues">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-[#d4af37]" />
          <h3 className="text-sm font-bold uppercase tracking-wider">Leagues</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose which dynasty leagues appear across Commissioner Command. We pre-select your
          active, drafted leagues. Check any we filtered out to add them to your list, or
          uncheck ones you'd rather hide. Changes save automatically.
        </p>

        {!isConnected ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="leagues-not-connected">
            Connect a Sleeper account to manage your leagues.
          </p>
        ) : allLeagues.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No dynasty leagues found for this account.</p>
        ) : (
          <div className="space-y-4">
            <LeagueGroup
              label={`Selected (${selectedLeagues.length})`}
              leagues={selectedLeagues}
              includedSet={includedSet}
              onToggle={setLeagueIncluded}
              emptyText="No leagues selected. Pick at least one below."
            />
            {filteredOutLeagues.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Filtered out ({filteredOutLeagues.length})
                </p>
                <div className="space-y-3 border-l-2 border-border/40 pl-3">
                  {filteredOutGroups.map((g) => (
                    <LeagueGroup
                      key={g.label}
                      label={`${g.label} · ${g.leagues.length}`}
                      leagues={g.leagues}
                      includedSet={includedSet}
                      onToggle={setLeagueIncluded}
                      showReason={false}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
      )}
    </div>
  );
}

// Leagues the user manually hid (eligible by default, opted out) have no
// filterReason — bucket them here.
const HIDDEN_BY_USER = "Hidden by you";
// Preferred display order for the reason categories; anything not listed
// (defensive — should match fetchSleeperLeagues' reasons) sorts after these.
const FILTER_REASON_ORDER = [
  "Not drafted yet",
  "Draft not scheduled",
  "Inactive",
  "No team in this league",
  HIDDEN_BY_USER,
];

function groupByFilterReason(
  leagues: SleeperLeagueSummary[],
): Array<{ label: string; leagues: SleeperLeagueSummary[] }> {
  const byReason = new Map<string, SleeperLeagueSummary[]>();
  for (const lg of leagues) {
    const key = lg.filterReason ?? HIDDEN_BY_USER;
    const bucket = byReason.get(key);
    if (bucket) bucket.push(lg);
    else byReason.set(key, [lg]);
  }
  const rank = (k: string) => {
    const i = FILTER_REASON_ORDER.indexOf(k);
    return i === -1 ? FILTER_REASON_ORDER.length : i;
  };
  return Array.from(byReason.keys())
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((label) => ({ label, leagues: byReason.get(label)! }));
}

function LeagueGroup({
  label, leagues, includedSet, onToggle, emptyText, showReason = true,
}: {
  label: string;
  leagues: SleeperLeagueSummary[];
  includedSet: Set<string>;
  onToggle: (leagueId: string, included: boolean) => void;
  emptyText?: string;
  showReason?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {leagues.length === 0 ? (
        emptyText ? <p className="text-[11px] text-muted-foreground italic">{emptyText}</p> : null
      ) : (
        <ul className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {leagues.map((lg) => (
            <LeagueRow
              key={lg.leagueId}
              league={lg}
              checked={includedSet.has(lg.leagueId)}
              onToggle={onToggle}
              showReason={showReason}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LeagueRow({
  league, checked, onToggle, showReason = true,
}: {
  league: SleeperLeagueSummary;
  checked: boolean;
  onToggle: (leagueId: string, included: boolean) => void;
  showReason?: boolean;
}) {
  const avatarUrl = league.avatar ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}` : null;
  const initials = league.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <li>
      <label
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border/40 hover:bg-muted/30 cursor-pointer transition-colors"
        data-testid={`league-toggle-${league.leagueId}`}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onToggle(league.leagueId, v === true)}
          className="data-[state=checked]:bg-[#d4af37] data-[state=checked]:border-[#d4af37] data-[state=checked]:text-black"
        />
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0 ring-1 ring-border/40"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-6 h-6 rounded-full flex-shrink-0 bg-[#0b3a7a]/20 dark:bg-blue-900/30 flex items-center justify-center ring-1 ring-border/40">
            <span className="text-[9px] font-bold text-[#0b3a7a] dark:text-blue-300">{initials}</span>
          </div>
        )}
        <span className="flex-1 min-w-0">
          <span className="block truncate text-xs font-medium text-foreground">{league.name}</span>
          <span className="block text-[10px] text-muted-foreground">
            {league.scoringFormat} {league.format} · {league.totalRosters}-team
          </span>
        </span>
        {showReason && league.filterReason && (
          <span className="text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex-shrink-0">
            {league.filterReason}
          </span>
        )}
      </label>
    </li>
  );
}

function favoriteTeamLabel(abbr: string | null): string {
  if (!abbr) return "";
  return NFL_TEAMS.find((t) => t.abbreviation === abbr)?.name ?? abbr;
}

function ThemeChoice({
  mode, current, onSelect, icon: Icon, label, logoUrl, disabled = false,
}: {
  mode: ThemeMode;
  current: ThemeMode;
  onSelect: (m: ThemeMode) => void;
  icon: typeof Sun;
  label: string;
  logoUrl?: string | null;
  disabled?: boolean;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      disabled={disabled}
      data-on={active}
      data-testid={`theme-choice-${mode}`}
      className={cn(
        "flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-semibold text-left transition-colors",
        disabled
          ? "border-border/40 text-muted-foreground/50 opacity-50 cursor-not-allowed"
          : active
          ? "bg-[#d4af37]/12 border-[#d4af37]/40 text-foreground"
          : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30",
      )}
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" className="w-4 h-4 flex-shrink-0 object-contain" />
      ) : (
        <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", active ? "text-[#d4af37]" : "text-muted-foreground")} />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
