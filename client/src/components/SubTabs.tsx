import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { TabConfig } from "../types";

interface SubTabsProps {
  tabs: TabConfig[];
  activeTab: string;
  setActiveTab: (id: string) => void;
}

export function SubTabs({ tabs, activeTab, setActiveTab }: SubTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setShowLeftFade(el.scrollLeft > 4);
      setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [tabs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector('[aria-selected="true"]') as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [activeTab]);

  return (
    <div className="border-b border-border/40 bg-muted/15 dark:bg-muted/8 relative">
      {showLeftFade && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none md:hidden" />
      )}
      {showRightFade && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none md:hidden" />
      )}
      <div className="max-w-7xl mx-auto">
        <nav
          ref={scrollRef}
          className="flex gap-0.5 overflow-x-auto px-3 md:px-6 py-1.5 scrollbar-hide snap-x snap-mandatory scroll-smooth"
          role="tablist"
          data-testid="sub-tabs"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`subtab-${tab.id}`}
              className={cn(
                "relative px-3.5 md:px-4 py-2 text-xs font-semibold whitespace-nowrap rounded-full transition-all duration-200 snap-center",
                activeTab === tab.id
                  ? "text-white dark:text-white x-mode:text-white bg-[#0b3a7a] dark:bg-[#0b3a7a]/80 x-mode:bg-[#3d8fe0]"
                  : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/40",
                tab.id === "league-roast" && "hidden md:inline-flex"
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-[#d4af37] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
