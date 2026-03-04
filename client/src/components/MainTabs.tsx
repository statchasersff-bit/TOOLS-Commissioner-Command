import { cn } from "@/lib/utils";
import type { MainTabConfig } from "../types";

interface MainTabsProps {
  tabs: MainTabConfig[];
  activeTab: string;
  setActiveTab: (id: string) => void;
}

export function MainTabs({ tabs, activeTab, setActiveTab }: MainTabsProps) {
  return (
    <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-[57px] z-40">
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
