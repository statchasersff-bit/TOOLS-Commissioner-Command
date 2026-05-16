import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart2, LayoutDashboard, Users, Share2,
  Trophy, GitCompare, Coins, ArrowLeftRight, Database, Search,
  Calculator, Eye, LineChart, TrendingUp, Zap, ChevronDown,
  LucideIcon, Waves, Crosshair, LayoutGrid, Inbox, MessageCircle,
} from "lucide-react";
import type { MainTabConfig } from "../types";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";
import logoLight from "@assets/statchasers_logo_transparent_light_1772764844283.png";
import { Menu, X } from "lucide-react";

// ── Mega menu data ─────────────────────────────────────────────────────────────

interface MegaItem {
  subId: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface MegaSection {
  title: string;
  items: MegaItem[];
}

const MEGA_DATA: Record<string, MegaSection[]> = {
  portfolio: [
    {
      title: "Command Center",
      items: [
        { subId: "portfolio-summary", label: "My Portfolio",     description: "Cross-league exposure, finances & metrics",    icon: BarChart2  },
        { subId: "lineup-command",    label: "Lineup Command",   description: "Cross-league lineup war room & swap finder",   icon: Crosshair  },
        { subId: "waiver-command",    label: "Waiver Command",   description: "Cross-league waiver wire & FAAB dashboard",    icon: Waves      },
      ],
    },
  ],
  dashboard: [
    {
      title: "My Team",
      items: [
        { subId: "my-team",    label: "Overview",      description: "Team snapshot, KPIs & roster strength",          icon: Users          },
        { subId: "share-team", label: "Share My Team", description: "Export & share your roster report & field view",  icon: Share2         },
      ],
    },
  ],
  "league-analyzer": [
    {
      title: "League Analysis",
      items: [
        { subId: "power-rankings",    label: "Rankings",     description: "Power rankings, tiers & scouting reports",   icon: Trophy         },
        { subId: "roster-comparison", label: "Compare",      description: "Head-to-head roster comparison",             icon: GitCompare     },
        { subId: "transactions",      label: "Transactions", description: "Recent adds, drops & trades league-wide",    icon: ArrowLeftRight },
      ],
    },
  ],
  "trade-center": [
    {
      title: "Trade Tools",
      items: [
        { subId: "trade-sync",           label: "Trade Sync",    description: "Pending trade inbox across all your leagues",    icon: Inbox          },
        { subId: "trade-database",      label: "Database",      description: "Search real dynasty trades by player",           icon: Database       },
        { subId: "positional-analysis", label: "Finder",     description: "Find trade targets by position & value",      icon: Search     },
        { subId: "trade-calculator",    label: "Calculator", description: "Value-based trade evaluator",                 icon: Calculator },
        { subId: "trade-block",         label: "Intel",      description: "Trade block activity & hot markets",          icon: Eye        },
      ],
    },
  ],
  "league-market": [
    {
      title: "Research",
      items: [
        { subId: "analysis",        label: "Analysis",        description: "League trends & positional insights",           icon: LineChart  },
        { subId: "market-value",    label: "Market Value",    description: "Player market values across formats",           icon: TrendingUp },
        { subId: "compare-players", label: "Compare Players", description: "Side-by-side player card comparison by position", icon: LayoutGrid },
      ],
    },
  ],
  "live-draft": [
    {
      title: "Draft Tools",
      items: [
        { subId: "draft-board", label: "Draft Board", description: "Dynasty rankings board & live draft integration",  icon: Zap },
      ],
    },
  ],
};

// ── Hover intent hook ─────────────────────────────────────────────────────────

const HOVER_DELAY = 120;

function useHoverIntent(onEnter: () => void, onLeave: () => void) {
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    enterTimer.current = setTimeout(onEnter, HOVER_DELAY);
  }, [onEnter]);

  const handleMouseLeave = useCallback(() => {
    if (enterTimer.current) { clearTimeout(enterTimer.current); enterTimer.current = null; }
    leaveTimer.current = setTimeout(onLeave, HOVER_DELAY);
  }, [onLeave]);

  return { handleMouseEnter, handleMouseLeave };
}

// ── MegaMenuPanel ─────────────────────────────────────────────────────────────

interface MegaMenuPanelProps {
  tabId: string;
  label: string;
  isOpen: boolean;
  onNavigate: (tab: string, sub: string) => void;
  activeTab: string;
  activeSub: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function MegaMenuPanel({ tabId, isOpen, onNavigate, activeSub, onMouseEnter, onMouseLeave }: MegaMenuPanelProps) {
  const sections = MEGA_DATA[tabId];
  if (!sections) return null;

  const sections_data = sections;

  return (
    <div
      className={cn(
        "absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[200]",
        "transition-all duration-[180ms] ease-out",
        isOpen
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-2 pointer-events-none"
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="menu"
      aria-label={`${tabId} navigation`}
    >
      {/* Connector bridge — keeps hover alive between trigger and panel */}
      <div className="absolute -top-2 left-0 right-0 h-2" />

      <div
        className="rounded-[18px] border border-white/[0.07] shadow-2xl shadow-black/60 overflow-hidden"
        style={{
          background: "rgba(8,11,20,0.97)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          width: "280px",
        }}
      >
        {sections_data.map((section, sIdx) => (
          <div key={sIdx}>
            {sections_data.length > 1 && sIdx > 0 && (
              <div className="h-px bg-white/[0.05] mx-5" />
            )}
            <div className="px-3 pt-4 pb-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#d4af37]/70 px-2 mb-2">
                {section.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSub === item.subId;
                  return (
                    <button
                      key={item.subId}
                      role="menuitem"
                      onClick={() => onNavigate(tabId, item.subId)}
                      data-testid={`mega-item-${tabId}-${item.subId}`}
                      className={cn(
                        "group flex items-start gap-3 px-3 py-3 rounded-[10px] text-left",
                        "transition-all duration-[150ms] ease-out",
                        "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#d4af37]/60",
                        isActive
                          ? "bg-[#d4af37]/12 border border-[#d4af37]/20"
                          : "border border-transparent hover:bg-white/[0.05] hover:border-white/[0.06]"
                      )}
                    >
                      <div className={cn(
                        "w-9 h-9 rounded-[9px] flex items-center justify-center flex-shrink-0 mt-0.5",
                        "transition-all duration-[150ms]",
                        isActive
                          ? "bg-[#d4af37]/20 text-[#d4af37]"
                          : "bg-white/[0.06] text-white/50 group-hover:bg-[#d4af37]/10 group-hover:text-[#d4af37]/80"
                      )}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          "text-[13px] font-semibold leading-tight transition-colors duration-[150ms]",
                          isActive
                            ? "text-[#d4af37]"
                            : "text-white/85 group-hover:text-white"
                        )}>
                          {item.label}
                        </p>
                        <p className="text-[11px] text-white/35 leading-snug mt-0.5 group-hover:text-white/50 transition-colors duration-[150ms]">
                          {item.description}
                        </p>
                      </div>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] flex-shrink-0 mt-2 self-start" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="h-3" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NavItem (trigger) ─────────────────────────────────────────────────────────

interface NavItemProps {
  tab: MainTabConfig;
  isActive: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onClickTab: (id: string) => void;
  onNavigate: (tab: string, sub: string) => void;
  activeSub: string;
}

function NavItem({ tab, isActive, isOpen, onOpen, onClose, onClickTab, onNavigate, activeSub }: NavItemProps) {
  const hasMega = !!(MEGA_DATA[tab.id]?.flatMap(s => s.items).length ?? 0 > 1);

  const { handleMouseEnter, handleMouseLeave } = useHoverIntent(onOpen, onClose);

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        role="tab"
        aria-selected={isActive}
        aria-haspopup={hasMega ? "menu" : undefined}
        aria-expanded={hasMega ? isOpen : undefined}
        onClick={() => onClickTab(tab.id)}
        data-testid={`tab-${tab.id}`}
        className={cn(
          "relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold whitespace-nowrap rounded-full",
          "transition-all duration-[180ms]",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#d4af37]/50",
          isActive
            ? "text-[#0b3a7a] dark:text-blue-200 bg-[#0b3a7a]/8 dark:bg-blue-400/10"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
        )}
      >
        {tab.label}
        {hasMega && (
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 transition-transform duration-[180ms]",
              isOpen ? "rotate-180" : "rotate-0",
              isActive ? "text-[#d4af37]" : "text-muted-foreground/60"
            )}
          />
        )}
        {isActive && (
          <span className="absolute bottom-0 left-3 right-3 h-[2.5px] bg-[#d4af37] rounded-full" />
        )}
      </button>

      {hasMega && (
        <MegaMenuPanel
          tabId={tab.id}
          label={tab.label}
          isOpen={isOpen}
          activeTab={tab.id}
          activeSub={activeSub}
          onNavigate={onNavigate}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      )}
    </div>
  );
}

// ── MegaMenuNav (main export, replaces MainTabs on desktop) ───────────────────

interface MegaMenuNavProps {
  tabs: MainTabConfig[];
  activeTab: string;
  activeSub: string;
  setActiveTab: (id: string) => void;
  onNavigate: (tab: string, sub: string) => void;
}

export function MegaMenuNav({ tabs, activeTab, activeSub, setActiveTab, onNavigate }: MegaMenuNavProps) {
  const [openTab, setOpenTab] = useState<string | null>(null);

  const open = useCallback((id: string) => setOpenTab(id), []);
  const close = useCallback(() => setOpenTab(null), []);

  return (
    <div className="border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-[53px] z-40 hidden md:block">
      <div className="max-w-7xl mx-auto">
        <nav
          className="flex items-center gap-0.5 px-4 md:px-6 py-2"
          role="tablist"
          aria-label="Main navigation"
          data-testid="main-tabs"
        >
          {tabs.map((tab) => (
            <NavItem
              key={tab.id}
              tab={tab}
              isActive={activeTab === tab.id}
              isOpen={openTab === tab.id}
              activeSub={activeSub}
              onOpen={() => open(tab.id)}
              onClose={close}
              onClickTab={setActiveTab}
              onNavigate={(t, s) => { onNavigate(t, s); close(); }}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}

// ── Re-export MobileMenuButton unchanged ──────────────────────────────────────

const TAB_ICONS: Record<string, typeof BarChart2> = {
  portfolio: BarChart2,
  dashboard: LayoutDashboard,
  "league-analyzer": Trophy,
  "trade-center": ArrowLeftRight,
  "league-market": LineChart,
  "live-draft": Zap,
};

interface MobileMenuButtonProps {
  tabs: MainTabConfig[];
  activeTab: string;
  setActiveTab: (id: string) => void;
}

export function MobileMenuButton({ tabs, activeTab, setActiveTab }: MobileMenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback((id: string) => {
    setActiveTab(id);
    setIsOpen(false);
  }, [setActiveTab]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setIsOpen(false);
  }, []);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-[#0b3a7a] hover:bg-[#0d4a9a] transition-colors shadow-md shadow-[#0b3a7a]/25"
        data-testid="button-mobile-menu"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5 text-white" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] md:hidden"
          onClick={handleBackdropClick}
          data-testid="mobile-menu-overlay"
        >
          <div className="absolute inset-0 bg-[#050e1d]/70 backdrop-blur-md animate-in fade-in duration-200" aria-hidden />
          <div className="absolute inset-x-3 top-3 bottom-auto max-h-[calc(100vh-24px)] bg-[#0a1628] rounded-2xl border border-[#1a2d4a] shadow-2xl shadow-black/40 animate-in slide-in-from-top-2 fade-in duration-250 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <div className="flex items-center gap-3">
                <img src={logoDark} alt="StatChasers" className="w-9 h-9 hidden dark:block" />
                <img src={logoLight} alt="StatChasers" className="w-9 h-9 block dark:hidden" />
                <div>
                  <p className="text-[15px] font-bold text-white leading-tight tracking-tight">StatChasers</p>
                  <p className="text-[10px] text-[#d4af37] font-semibold tracking-widest uppercase">Dynasty Command</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
                data-testid="button-mobile-menu-close"
                aria-label="Close menu"
              >
                <X className="w-5 h-5 text-white/60" />
              </button>
            </div>
            <div className="px-4 pb-6 pt-3">
              <div className="grid grid-cols-2 gap-3">
                {tabs.map((tab) => {
                  const Icon = TAB_ICONS[tab.id] || BarChart2;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleSelect(tab.id)}
                      data-testid={`mobile-tab-${tab.id}`}
                      className={cn(
                        "relative flex flex-col items-center justify-center gap-3 py-5 px-3 rounded-2xl text-center transition-all duration-200 active:scale-[0.97]",
                        isActive
                          ? "bg-gradient-to-b from-[#d4af37]/20 to-[#d4af37]/5 border-2 border-[#d4af37]/50 shadow-lg shadow-[#d4af37]/10"
                          : "bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08]"
                      )}
                    >
                      <div className={cn(
                        "w-[52px] h-[52px] rounded-2xl flex items-center justify-center transition-all duration-200",
                        isActive ? "bg-[#d4af37] shadow-md shadow-[#d4af37]/30" : "bg-white/[0.06]"
                      )}>
                        <Icon className={cn("w-6 h-6", isActive ? "text-[#0a1628]" : "text-white/70")} />
                      </div>
                      <span className={cn(
                        "text-[13px] font-semibold leading-tight tracking-tight",
                        isActive ? "text-[#d4af37]" : "text-white/80"
                      )}>
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
