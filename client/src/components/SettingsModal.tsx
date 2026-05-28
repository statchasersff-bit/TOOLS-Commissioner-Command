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
import { NFL_TEAMS } from "@/config/nflTeams";
import { cn } from "@/lib/utils";
import { Loader2, Star, Sun, Moon, Palette } from "lucide-react";

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
  const { favoriteAbbr, favoriteTeam, saving, setFavoriteTeam, clearFavoriteTeam } = useFavoriteTeam();
  const { themeMode, setThemeMode, needsTeamForMyTeamMode } = useTheme();

  // Draft state so the user can browse around before committing.
  const [draftAbbr, setDraftAbbr] = useState<string | null>(favoriteAbbr);

  // Re-sync the draft any time the modal opens or the persisted favorite
  // changes externally (e.g. another tab saved a different team).
  useEffect(() => {
    if (open) setDraftAbbr(favoriteAbbr);
  }, [open, favoriteAbbr]);

  const dirty = draftAbbr !== favoriteAbbr;

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
                label={favoriteAbbr ? `My Team · ${favoriteAbbr}` : "My Team · Select team"}
              />
            </div>

            {needsTeamForMyTeamMode && (
              <p className="text-[11px] text-amber-500 dark:text-amber-400" data-testid="my-team-mode-prompt">
                Pick your favorite NFL team below to unlock My Team Mode.
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

function favoriteTeamLabel(abbr: string | null): string {
  if (!abbr) return "";
  return NFL_TEAMS.find((t) => t.abbreviation === abbr)?.name ?? abbr;
}

function ThemeChoice({
  mode, current, onSelect, icon: Icon, label,
}: {
  mode: ThemeMode;
  current: ThemeMode;
  onSelect: (m: ThemeMode) => void;
  icon: typeof Sun;
  label: string;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      data-on={active}
      data-testid={`theme-choice-${mode}`}
      className={cn(
        "flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-semibold text-left transition-colors",
        active
          ? "bg-[#d4af37]/12 border-[#d4af37]/40 text-foreground"
          : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30",
      )}
    >
      <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", active ? "text-[#d4af37]" : "text-muted-foreground")} />
      <span className="truncate">{label}</span>
    </button>
  );
}
