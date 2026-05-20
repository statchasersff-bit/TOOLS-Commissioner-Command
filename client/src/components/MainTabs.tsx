import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Menu, X, BarChart2, Shield, SearchCheck, ArrowLeftRight, UserRound, Zap, ClipboardList, Skull, DollarSign } from "lucide-react";
import type { MainTabConfig } from "../types";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";
import logoLight from "@assets/statchasers_logo_transparent_light_1772764844283.png";

const TAB_ICONS: Record<string, typeof BarChart2> = {
  portfolio: BarChart2,
  finance: DollarSign,
  dashboard: Shield,
  "league-analyzer": SearchCheck,
  "trade-center": ArrowLeftRight,
  "league-market": UserRound,
  draft: ClipboardList,
  "dont-click": Skull,
};

interface MainTabsProps {
  tabs: MainTabConfig[];
  activeTab: string;
  setActiveTab: (id: string) => void;
}

export function MainTabs({ tabs, activeTab, setActiveTab }: MainTabsProps) {
  return (
    <div className="border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-[53px] z-40 hidden md:block">
      <div className="max-w-7xl mx-auto">
        <nav
          className="flex items-center gap-1.5 overflow-x-auto px-4 md:px-6 py-2 scrollbar-hide"
          role="tablist"
          data-testid="main-tabs"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-${tab.id}`}
              className={cn(
                "relative px-5 py-2.5 text-sm font-semibold whitespace-nowrap rounded-full transition-all duration-200",
                activeTab === tab.id
                  ? "text-[#0b3a7a] dark:text-blue-200 x-mode:text-[#3d8fe0] bg-[#0b3a7a]/8 dark:bg-blue-400/10 x-mode:bg-[#3d8fe0]/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-3 right-3 h-[2.5px] bg-[#d4af37] rounded-full" />
              )}
            </button>
          ))}

        </nav>
      </div>
    </div>
  );
}

interface MobileMenuButtonProps {
  tabs: MainTabConfig[];
  activeTab: string;
  setActiveTab: (id: string) => void;
}

export function MobileMenuButton({ tabs, activeTab, setActiveTab }: MobileMenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

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
          <div
            className="absolute inset-0 bg-[#050e1d]/70 backdrop-blur-md animate-in fade-in duration-200"
            aria-hidden
          />

          <div className="absolute inset-x-3 top-3 bottom-auto max-h-[calc(100vh-24px)] bg-[#0a1628] rounded-2xl border border-[#1a2d4a] shadow-2xl shadow-black/40 animate-in slide-in-from-top-2 fade-in duration-250 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <div className="flex items-center gap-3">
                <img src={logoDark} alt="StatChasers" className="w-9 h-9 hidden dark-any:block" />
                <img src={logoLight} alt="StatChasers" className="w-9 h-9 block dark-any:hidden" />
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
                        isActive
                          ? "bg-[#d4af37] shadow-md shadow-[#d4af37]/30"
                          : "bg-white/[0.06]"
                      )}>
                        <Icon className={cn(
                          "w-6 h-6",
                          isActive ? "text-[#0a1628]" : "text-white/70"
                        )} />
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
