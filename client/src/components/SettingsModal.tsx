import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useFavoriteTeam } from "@/contexts/FavoriteTeamContext";
import { FavoriteTeamPicker } from "@/components/FavoriteTeamPicker";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";
import { useSleeper } from "@/contexts/SleeperContext";
import { Checkbox } from "@/components/ui/checkbox";
import type { SleeperLeagueSummary } from "@/types";
import { NFL_TEAMS } from "@/config/nflTeams";
import { cn } from "@/lib/utils";
import { Loader2, Star, Sun, Moon, Palette, ListChecks } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Phase 1 settings modal — just the Personalization section. Future settings
 * can drop in below as new `<section>` blocks without touching the shell.
 */
export function SettingsModal({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { isAuthenticatedUser } = useAuth();
  const { favoriteAbbr, saving, setFavoriteTeam, clearFavoriteTeam } = useFavoriteTeam();
  const { themeMode, setThemeMode, myTeamReady } = useTheme();
  const { isConnected, allLeagues, includedLeagueIds, setLeagueIncluded } = useSleeper();

  const includedSet = new Set(includedLeagueIds);
  const selectedLeagues = allLeagues.filter((l) => includedSet.has(l.leagueId));
  const filteredOutLeagues = allLeagues.filter((l) => !includedSet.has(l.leagueId));

  // Draft state so the user can browse around before committing.
  const [draftAbbr, setDraftAbbr] = useState<string | null>(favoriteAbbr);

  // Re-sync the draft any time the modal opens or the persisted favorite
  // changes externally (e.g. another tab saved a different team).
  useEffect(() => {
    if (open) setDraftAbbr(favoriteAbbr);
  }, [open, favoriteAbbr]);

  const dirty = draftAbbr !== favoriteAbbr;

  // The Theme section's "My Team" option mirrors the team currently picked in
  // Personalization (the draft), so it updates the moment a team is selected —
  // before the user commits with Save.
  const draftTeam = draftAbbr ? NFL_TEAMS.find((t) => t.abbreviation === draftAbbr) ?? null : null;

  const handleSave = async () => {
    if (!dirty || !draftAbbr) {
      onOpenChange(false);
      return;
    }
    await setFavoriteTeam(draftAbbr);
    toast({ title: "Favorite team saved.", description: favoriteTeamLabel(draftAbbr) });
    onOpenChange(false);
  };

  const handleClear = async () => {
    await clearFavoriteTeam();
    setDraftAbbr(null);
    toast({ title: "Favorite team removed." });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl w-[calc(100vw-2rem)] p-0 overflow-hidden"
        data-testid="settings-modal"
      >
        <div className="p-5 sm:p-6 max-h-[80vh] overflow-y-auto">
          <DialogHeader className="text-left space-y-2">
            <DialogTitle className="text-xl font-bold tracking-tight">Settings</DialogTitle>
            <span aria-hidden className="block h-[2.5px] w-10 rounded-full" style={{ background: "#d4af37" }} />
            <DialogDescription className="text-sm text-muted-foreground">
              Customize your Dynasty Command experience.
            </DialogDescription>
          </DialogHeader>

          {/* ── Theme ─────────────────────────────────────────────────── */}
          <section className="mt-6 space-y-3" data-testid="settings-theme">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-[#d4af37]" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Theme</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Pick how Dynasty Command looks. <span className="font-semibold text-foreground">My Team</span> tints
              the app with your favorite NFL team's colors while preserving readable contrast.
            </p>

            <div className="grid grid-cols-3 gap-2" data-testid="theme-mode-picker">
              <ThemeChoice mode="light"   current={themeMode} onSelect={setThemeMode} icon={Sun}  label="Light" />
              <ThemeChoice mode="x-mode"  current={themeMode} onSelect={setThemeMode} icon={Moon}  label="Dark" />
              <ThemeChoice
                mode="my_team"
                current={themeMode}
                onSelect={setThemeMode}
                icon={Star}
                logoUrl={draftTeam?.logoUrl}
                label={draftAbbr ? `My Team · ${draftAbbr}` : "My Team · Select team"}
                disabled={!myTeamReady}
              />
            </div>

            {!myTeamReady && (
              <p className="text-[11px] text-amber-500 dark:text-amber-400" data-testid="my-team-mode-gated">
                My Team theme is available for the Arizona Cardinals only right now — more teams coming soon.
              </p>
            )}
          </section>

          {/* ── Personalization ────────────────────────────────────────── */}
          <section className="mt-6 space-y-3" data-testid="settings-personalization">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-[#d4af37]" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Personalization</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose your favorite NFL team to personalize your Dynasty Command experience.
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
          </section>

          {/* ── Leagues ─────────────────────────────────────────────────── */}
          <section className="mt-6 space-y-3" data-testid="settings-leagues">
            <div className="flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-[#d4af37]" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Leagues</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose which dynasty leagues appear across Dynasty Command. We pre-select your
              active, drafted leagues — check any we filtered out to add them to your list, or
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
                  emptyText="No leagues selected — pick at least one below."
                />
                {filteredOutLeagues.length > 0 && (
                  <LeagueGroup
                    label={`Filtered out (${filteredOutLeagues.length})`}
                    leagues={filteredOutLeagues}
                    includedSet={includedSet}
                    onToggle={setLeagueIncluded}
                  />
                )}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="px-5 py-4 sm:px-6 border-t border-border/40 bg-muted/20 gap-2">
          {favoriteAbbr && (
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={saving}
              className="w-full sm:w-auto"
              data-testid="settings-clear-team"
            >
              Clear favorite team
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={saving || !draftAbbr || !dirty}
            className="w-full sm:w-auto bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
            data-testid="settings-save-team"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeagueGroup({
  label, leagues, includedSet, onToggle, emptyText,
}: {
  label: string;
  leagues: SleeperLeagueSummary[];
  includedSet: Set<string>;
  onToggle: (leagueId: string, included: boolean) => void;
  emptyText?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {leagues.length === 0 ? (
        emptyText ? <p className="text-[11px] text-muted-foreground italic">{emptyText}</p> : null
      ) : (
        <ul className="space-y-1">
          {leagues.map((lg) => (
            <LeagueRow
              key={lg.leagueId}
              league={lg}
              checked={includedSet.has(lg.leagueId)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LeagueRow({
  league, checked, onToggle,
}: {
  league: SleeperLeagueSummary;
  checked: boolean;
  onToggle: (leagueId: string, included: boolean) => void;
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
        {league.filterReason && (
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
