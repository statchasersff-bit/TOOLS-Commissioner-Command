import { cn } from "@/lib/utils";
import type { TabConfig } from "../types";

interface SubTabsProps {
  tabs: TabConfig[];
  activeTab: string;
  setActiveTab: (id: string) => void;
}

export function SubTabs({ tabs, activeTab, setActiveTab }: SubTabsProps) {
  return (
    <div className="border-b border-border/60 bg-muted/30">
      <div className="max-w-7xl mx-auto">
        <nav
          className="flex gap-1 overflow-x-auto px-4 py-1 scrollbar-hide"
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
                "relative px-3 py-2 text-xs font-medium whitespace-nowrap rounded-md transition-colors",
                activeTab === tab.id
                  ? "text-[#0b3a7a] dark:text-blue-300 bg-blue-50/40 dark:bg-blue-950/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#d4af37] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
