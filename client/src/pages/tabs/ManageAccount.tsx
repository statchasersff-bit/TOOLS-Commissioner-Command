import { useState } from "react";
import { User, Link2, MessageSquare, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";

type AccountTab = "profile" | "connections" | "feedback";

const TABS: Array<{ id: AccountTab; label: string; Icon: LucideIcon }> = [
  { id: "profile", label: "Profile", Icon: User },
  { id: "connections", label: "Connections", Icon: Link2 },
  { id: "feedback", label: "Feedback", Icon: MessageSquare },
];

const PILL_BASE =
  "relative flex items-center justify-center gap-2 font-semibold transition-all duration-200 rounded-xl text-[13px] tracking-[0.01em]";
const PILL_ACTIVE =
  "bg-[var(--sc-blue)] text-white shadow-[0_4px_12px_rgba(11,35,68,0.18)] dark-any:bg-[linear-gradient(135deg,rgba(11,58,122,0.85)_0%,rgba(11,58,122,0.65)_100%)] dark-any:shadow-[0_2px_12px_rgba(11,58,122,0.40),inset_0_1px_0_rgba(255,255,255,0.06)] dark-any:border dark-any:border-[#d4af37]/30";
const PILL_INACTIVE =
  "text-[var(--sc-text-muted)] hover:bg-[var(--sc-blue-soft)] hover:text-[var(--sc-blue)] dark-any:text-white/45 dark-any:hover:bg-transparent dark-any:hover:text-white/70";

export function ManageAccount() {
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");

  return (
    <div className="space-y-5">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Manage Account"
          subtitle="Update your profile, manage connections, and share feedback."
        />

        {/* Desktop sub-tab switcher */}
        <div className="hidden md:flex items-center gap-2 flex-shrink-0 pt-1">
          <div
            className={cn(
              "grid flex-shrink-0 rounded-2xl p-1 gap-1 w-[390px] h-12",
              "bg-[var(--sc-card-bg)] border border-[var(--sc-border)]",
              "dark-any:bg-white/[0.04] dark-any:border-white/[0.07]",
            )}
            style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
          >
            {TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  data-testid={`account-tab-${id}-desktop`}
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
          style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
        >
          {TABS.map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                data-testid={`account-tab-${id}`}
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

      {/* ── Sub-tab content (placeholders — built out separately) ────────── */}
      {activeTab === "profile" && <TabPlaceholder title="Profile" />}
      {activeTab === "connections" && <TabPlaceholder title="Connections" />}
      {activeTab === "feedback" && <TabPlaceholder title="Feedback" />}
    </div>
  );
}

function TabPlaceholder({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 px-6 py-16 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">Coming soon.</p>
    </div>
  );
}
