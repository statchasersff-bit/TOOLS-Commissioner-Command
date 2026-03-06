import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Menu, X, Briefcase, LayoutDashboard, BarChart3, ArrowLeftRight, Users, ClipboardList } from "lucide-react";
import type { MainTabConfig } from "../types";

const TAB_ICONS: Record<string, typeof Briefcase> = {
  portfolio: Briefcase,
  dashboard: LayoutDashboard,
  "league-analyzer": BarChart3,
  "trade-center": ArrowLeftRight,
  "league-market": Users,
  "live-draft": ClipboardList,
};

interface MainTabsProps {
  tabs: MainTabConfig[];
  activeTab: string;
  setActiveTab: (id: string) => void;
}

export function MainTabs({ tabs, activeTab, setActiveTab }: MainTabsProps) {
  return (
    <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-[57px] z-40 hidden md:block">
      <div className="max-w-7xl mx-auto">
        <nav
          className="flex gap-1.5 overflow-x-auto px-4 md:px-6 py-2 scrollbar-hide"
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
                  ? "text-[#0b3a7a] dark:text-blue-200 bg-[#0b3a7a]/8 dark:bg-blue-400/10"
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
        className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg border border-border/60 bg-background/80 hover:bg-muted/60 transition-colors"
        data-testid="button-mobile-menu"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5 text-foreground" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] md:hidden"
          onClick={handleBackdropClick}
          data-testid="mobile-menu-overlay"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
            aria-hidden
          />

          <div className="absolute inset-x-3 top-3 bottom-auto max-h-[calc(100vh-24px)] bg-background rounded-2xl border border-border/60 shadow-2xl animate-in slide-in-from-top-2 fade-in duration-250 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-[#0b3a7a] flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-xs">SC</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground leading-tight">StatChasers</p>
                  <p className="text-[10px] text-[#d4af37] font-semibold tracking-wide">Navigate</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted/60 transition-colors"
                data-testid="button-mobile-menu-close"
                aria-label="Close menu"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            <div className="px-4 pb-5 pt-1">
              <div className="grid grid-cols-2 gap-2.5">
                {tabs.map((tab) => {
                  const Icon = TAB_ICONS[tab.id] || LayoutDashboard;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleSelect(tab.id)}
                      data-testid={`mobile-tab-${tab.id}`}
                      className={cn(
                        "relative flex flex-col items-start gap-2 p-4 rounded-xl text-left transition-all duration-200 active:scale-[0.97]",
                        isActive
                          ? "bg-[#0b3a7a] text-white shadow-lg shadow-[#0b3a7a]/20"
                          : "bg-muted/40 dark:bg-muted/20 hover:bg-muted/70 dark:hover:bg-muted/30 text-foreground"
                      )}
                    >
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center",
                        isActive
                          ? "bg-white/15"
                          : "bg-[#0b3a7a]/8 dark:bg-blue-400/10"
                      )}>
                        <Icon className={cn(
                          "w-4.5 h-4.5",
                          isActive ? "text-white" : "text-[#0b3a7a] dark:text-blue-400"
                        )} />
                      </div>
                      <span className={cn(
                        "text-sm font-semibold leading-tight",
                        isActive ? "text-white" : "text-foreground"
                      )}>
                        {tab.label}
                      </span>
                      {isActive && (
                        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-[#d4af37]" />
                      )}
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
