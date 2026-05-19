import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, Wrench, Clock } from "lucide-react";
import {
  CURRENT_UPDATE_VERSION,
  CURRENT_UPDATE_NOTES,
  SEEN_UPDATE_STORAGE_KEY,
  type UpdateSection,
} from "@/config/updates";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";

interface Props {
  isAuthenticated: boolean;
  onViewChangelog?: () => void;
}

function readSeenVersion(): string | null {
  try { return localStorage.getItem(SEEN_UPDATE_STORAGE_KEY); } catch { return null; }
}

function writeSeenVersion(version: string) {
  try { localStorage.setItem(SEEN_UPDATE_STORAGE_KEY, version); } catch { /* ignore */ }
}

const SECTION_ICON: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  "New Features": Sparkles,
  "Improvements": TrendingUp,
  "Fixes": Wrench,
  "Coming Soon": Clock,
};

export function WhatsNewModal({ isAuthenticated, onViewChangelog }: Props) {
  // Compute initial open synchronously from localStorage so we never flash the
  // modal then close it on the same frame.
  const [open, setOpen] = useState(() => {
    if (!isAuthenticated) return false;
    if (typeof window === "undefined") return false;
    return readSeenVersion() !== CURRENT_UPDATE_VERSION;
  });

  // If auth flips after first render (user signs in mid-session), re-check.
  // Only opens — never auto-closes while the user is reading.
  useEffect(() => {
    if (!isAuthenticated) { setOpen(false); return; }
    if (readSeenVersion() !== CURRENT_UPDATE_VERSION) setOpen(true);
  }, [isAuthenticated]);

  const handleDismiss = () => {
    writeSeenVersion(CURRENT_UPDATE_VERSION);
    setOpen(false);
  };

  const handleViewChangelog = () => {
    writeSeenVersion(CURRENT_UPDATE_VERSION);
    setOpen(false);
    onViewChangelog?.();
  };

  if (!isAuthenticated) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleDismiss()}>
      <DialogContent
        className="max-w-md w-[calc(100vw-2rem)] bg-[#0d1117] border border-white/10 text-white p-0 overflow-hidden"
        data-testid="whatsnew-modal"
      >
        <div className="p-5 sm:p-6 max-h-[75vh] overflow-y-auto">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-2.5">
              <img src={logoDark} alt="StatChasers" className="w-8 h-8 flex-shrink-0" />
              <div className="leading-none min-w-0 flex-1">
                <p className="text-[10px] font-semibold tracking-wide truncate" style={{ color: "#d4af37" }}>
                  STATCHASERS · DYNASTY COMMAND
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">{CURRENT_UPDATE_NOTES.date}</p>
              </div>
              {/* Small branded tag — keeps the briefing tone without leaning
                  on military copy elsewhere in the modal. */}
              <span
                className="text-[9px] font-bold uppercase tracking-[0.12em] px-2 py-1 rounded-full border whitespace-nowrap flex-shrink-0"
                style={{ color: "#d4af37", borderColor: "rgba(212,175,55,0.35)", background: "rgba(212,175,55,0.08)" }}
                data-testid="whatsnew-badge"
              >
                Update Briefing
              </span>
            </div>
            <DialogTitle className="text-2xl sm:text-[26px] font-bold text-white leading-tight">
              {CURRENT_UPDATE_NOTES.title}
            </DialogTitle>
            {/* Subtle gold rule under the title for the same visual signature
                used by section headers throughout the app. */}
            <span
              aria-hidden
              className="block h-[2.5px] w-10 rounded-full"
              style={{ background: "#d4af37" }}
            />
            {CURRENT_UPDATE_NOTES.subtitle && (
              <DialogDescription className="text-sm text-white/70 leading-relaxed">
                {CURRENT_UPDATE_NOTES.subtitle}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {CURRENT_UPDATE_NOTES.sections.map((section) => (
              <SectionBlock key={section.heading} section={section} />
            ))}
          </div>
        </div>

        {/* Default DialogFooter is flex-col-reverse on mobile → primary "Got it"
            renders on top for easier thumb reach. sm+ uses the row layout. */}
        <DialogFooter className="px-5 py-4 sm:px-6 border-t border-white/10 bg-[#0a1015] gap-2">
          {onViewChangelog && (
            <Button
              variant="outline"
              onClick={handleViewChangelog}
              className="w-full sm:w-auto border-white/20 bg-transparent text-white/70 hover:text-white hover:bg-white/5"
              data-testid="whatsnew-view-changelog"
            >
              View full changelog
            </Button>
          )}
          <Button
            onClick={handleDismiss}
            className="w-full sm:w-auto bg-[#d4af37] hover:bg-[#c49b2e] text-black font-semibold"
            data-testid="whatsnew-got-it"
          >
            Back to the War Room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionBlock({ section }: { section: UpdateSection }) {
  const Icon = SECTION_ICON[section.heading] ?? Sparkles;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5" style={{ color: "#d4af37" }} />
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/80">{section.heading}</h3>
      </div>
      <ul className="space-y-1.5 pl-1">
        {section.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-white/75 leading-snug">
            <span className="text-[#d4af37] mt-1 flex-shrink-0">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
