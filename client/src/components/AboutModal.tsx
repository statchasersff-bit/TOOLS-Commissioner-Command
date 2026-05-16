import { useState } from "react";
import { Crosshair, Waves, Users, Share2, Trophy, ArrowLeftRight, Search, Inbox, Calculator, Database, Zap, MessageSquare, Lock, ChevronRight, Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface FeatureDef {
  id: string;
  category: string;
  title: string;
  icon: React.ElementType;
  description: string;
  bullets: string[];
  tab?: string;
  sub?: string;
  comingSoon?: boolean;
}

const FEATURES: FeatureDef[] = [
  {
    id: "command-center",
    category: "Portfolio",
    title: "Command Center",
    icon: Package,
    description: "Your hub for managing teams, lineups, waivers, and priority actions across all your dynasty leagues in one place.",
    bullets: [
      "Cross-league portfolio summary with exposure metrics",
      "Roster health alerts and priority action items",
      "Quick-access to all tools from a single dashboard",
    ],
    tab: "portfolio",
    sub: "portfolio-summary",
  },
  {
    id: "lineup-command",
    category: "Portfolio",
    title: "Lineup Command",
    icon: Crosshair,
    description: "Review lineup issues across every league, optimize your starters, and submit lineup changes without leaving Dynasty Command.",
    bullets: [
      "Cross-league lineup war room in a single table",
      "Bench vs. starter value comparisons",
      "Projected score and injury/status alerts",
      "Submit lineup changes directly through Sleeper",
    ],
    tab: "portfolio",
    sub: "lineup-command",
  },
  {
    id: "waiver-command",
    category: "Portfolio",
    title: "Waiver Command",
    icon: Waves,
    description: "Find the best available players across all your leagues, compare waiver targets, and submit claims through Sleeper.",
    bullets: [
      "Cross-league waiver wire and FAAB dashboard",
      "Available player rankings by dynasty and redraft value",
      "One-click waiver claim submission via Sleeper",
    ],
    tab: "portfolio",
    sub: "waiver-command",
  },
  {
    id: "my-team",
    category: "My Team",
    title: "My Team",
    icon: Users,
    description: "A full overview of your roster — team value, positional strengths, picks, age curve, and dynasty outlook.",
    bullets: [
      "Roster value breakdown by position and tier",
      "Pick capital valuation and draft asset overview",
      "Age curve analysis and dynasty window projection",
      "Team tier classification (Juggernaut, Rebuilder, etc.)",
    ],
    tab: "dashboard",
    sub: "my-team",
  },
  {
    id: "share-team",
    category: "My Team",
    title: "Share My Team",
    icon: Share2,
    description: "Generate a clean, shareable snapshot of your roster, picks, team value, and dynasty profile.",
    bullets: [
      "Export a visual team card with roster and value summary",
      "Share your dynasty profile with commissioners or trade partners",
      "Includes team tier, record, and key metrics",
    ],
    tab: "dashboard",
    sub: "share-team",
  },
  {
    id: "league-analyzer",
    category: "League",
    title: "League Analyzer",
    icon: Trophy,
    description: "Understand where every team stands in your league — power rankings, roster tiers, and league-wide intelligence.",
    bullets: [
      "Power rankings based on dynasty and redraft value",
      "Team tier classification for every roster in the league",
      "Head-to-head roster comparison tool",
      "Recent transactions: adds, drops, and trades",
    ],
    tab: "league-analyzer",
    sub: "power-rankings",
  },
  {
    id: "trade-center",
    category: "Trade",
    title: "Trade Center",
    icon: ArrowLeftRight,
    description: "The complete trade toolkit — analyze deals, find opportunities, sync active offers, and send proposals through Sleeper.",
    bullets: [
      "Trade calculator with dynasty and redraft value models",
      "Positional trade finder based on roster needs",
      "Live trade offer inbox synced with Sleeper",
      "Real trade database for market comparison",
    ],
    tab: "trade-center",
    sub: "trade-calculator",
  },
  {
    id: "trade-finder",
    category: "Trade",
    title: "Trade Finder",
    icon: Search,
    description: "Generates trade ideas based on your team direction, roster needs, dynasty value, redraft value, age curve, and pick capital.",
    bullets: [
      "Filter trade targets by position, value tier, and team need",
      "Weighted scoring by dynasty vs. redraft value",
      "Sorts results by most impactful acquisition for your roster",
    ],
    tab: "trade-center",
    sub: "positional-analysis",
  },
  {
    id: "trade-sync",
    category: "Trade",
    title: "Trade Sync",
    icon: Inbox,
    description: "View all your Sleeper trade offers across every league — incoming, outgoing, completed, rejected, and cancelled.",
    bullets: [
      "Accept, reject, or withdraw active trade offers",
      "Counter, edit, and resend proposals",
      "Message trade partners directly from the offer view",
      "Full trade history with outcome tracking",
    ],
    tab: "trade-center",
    sub: "trade-sync",
  },
  {
    id: "trade-calculator",
    category: "Trade",
    title: "Trade Calculator",
    icon: Calculator,
    description: "Build trades manually, compare both sides by dynasty or redraft value, include picks and FAAB, and send offers through Sleeper.",
    bullets: [
      "Add any player, pick, or FAAB amount to either side",
      "Live value delta with win-now vs. future weighting",
      "Send the trade directly to a Sleeper league partner",
    ],
    tab: "trade-center",
    sub: "trade-calculator",
  },
  {
    id: "trade-database",
    category: "Trade",
    title: "Trade Database",
    icon: Database,
    description: "Search and compare real trade examples from active dynasty leagues to understand the going market rate for any player.",
    bullets: [
      "Filter by format (SF/1QB), scoring, and league size",
      "Player name search across thousands of real trades",
      "Anonymized data — no team names or manager identities stored",
    ],
    tab: "trade-center",
    sub: "trade-database",
  },
  {
    id: "bulk-trade",
    category: "Trade",
    title: "Bulk Trade",
    icon: Package,
    description: "Build similar trade offers across multiple leagues and send them safely through a delayed queue.",
    bullets: [
      "Replicate a trade template across all your leagues at once",
      "Delayed send queue with review before submission",
      "Reduces repetitive manual offer entry across leagues",
    ],
    comingSoon: true,
  },
  {
    id: "live-draft",
    category: "Draft",
    title: "Live Draft",
    icon: Zap,
    description: "View draft boards, pick history, draft queues, and recent selections with live draft state tracking.",
    bullets: [
      "Live dynasty rankings board synced to your draft",
      "Draft queue management and pick history",
      "Recent picks feed with value tracking",
      "Make picks directly through Sleeper integration",
    ],
    tab: "live-draft",
    sub: "draft-board",
  },
  {
    id: "feedback",
    category: "Other",
    title: "Feedback & Bug Reports",
    icon: MessageSquare,
    description: "Send bug reports, feature requests, and UI feedback directly to the StatChasers team.",
    bullets: [
      "Bug reports, feature requests, and general feedback",
      "Optional screenshot attachment",
      "Goes directly to the StatChasers build team",
    ],
  },
];

const CATEGORIES = ["All", "Portfolio", "My Team", "League", "Trade", "Draft", "Other"] as const;
type Category = typeof CATEGORIES[number];

interface AboutPageProps {
  onNavigate: (tab: string, sub: string) => void;
  onOpenFeedback: () => void;
  onOpenCookies: () => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}

export function AboutPage({ onNavigate, onOpenFeedback, onOpenCookies, onOpenTerms, onOpenPrivacy }: AboutPageProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("All");

  const filtered = activeCategory === "All" ? FEATURES : FEATURES.filter(f => f.category === activeCategory);

  function handleGoTo(feature: FeatureDef) {
    if (feature.id === "feedback") {
      onOpenFeedback();
      return;
    }
    if (feature.tab && feature.sub) {
      onNavigate(feature.tab, feature.sub);
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-[3px] h-5 rounded-full flex-shrink-0" style={{ background: "#d4af37" }} />
          <h2 className="text-lg font-bold text-foreground">About Dynasty Command</h2>
        </div>
        <p className="text-sm text-muted-foreground ml-[11px]">
          Learn how each feature works and how Dynasty Command helps manage your dynasty leagues.
        </p>
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1 mb-5">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            data-testid={`button-about-cat-${cat.toLowerCase()}`}
            className={cn(
              "flex-shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all duration-150 border",
              activeCategory === cat
                ? "text-[#0b3a7a] border-[#d4af37]"
                : "text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground/70"
            )}
            style={activeCategory === cat ? { background: "#d4af37" } : {}}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Feature cards */}
      <div className="space-y-3">
        {filtered.map(feature => {
          const Icon = feature.icon;
          const canNavigate = (feature.tab && feature.sub) || feature.id === "feedback";
          return (
            <div
              key={feature.id}
              data-testid={`card-about-${feature.id}`}
              className="rounded-2xl p-5 bg-card border border-border/60"
            >
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(212,175,55,0.10)", border: "1px solid rgba(212,175,55,0.18)" }}
                >
                  <Icon className="w-4 h-4" style={{ color: "#d4af37" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-[14px] font-bold text-foreground leading-tight">{feature.title}</h3>
                    {feature.comingSoon && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: "rgba(212,175,55,0.12)", color: "#d4af37", border: "1px solid rgba(212,175,55,0.25)" }}>
                        Coming Soon
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-snug mt-1">{feature.description}</p>
                </div>
              </div>

              <ul className="space-y-1.5 mb-3 pl-1">
                {feature.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-1 h-1 rounded-full mt-[7px]" style={{ background: "#d4af37" }} />
                    <span className="text-[12px] text-muted-foreground leading-snug">{b}</span>
                  </li>
                ))}
              </ul>

              {canNavigate && !feature.comingSoon && (
                <button
                  onClick={() => handleGoTo(feature)}
                  data-testid={`button-about-goto-${feature.id}`}
                  className="flex items-center gap-1.5 text-[12px] font-semibold transition-colors hover:opacity-80"
                  style={{ color: "#d4af37" }}
                >
                  {feature.id === "feedback" ? "Open Feedback" : "Go to page"}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}

        {/* Sleeper / Privacy section */}
        {(activeCategory === "All" || activeCategory === "Other") && (
          <div className="rounded-2xl p-5 border border-indigo-500/20 bg-indigo-500/5">
            <div className="flex items-center gap-2.5 mb-3">
              <Lock className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <h3 className="text-[14px] font-bold text-foreground">Sleeper Login &amp; Privacy</h3>
            </div>
            <ul className="space-y-2">
              {[
                "Your Sleeper credentials go directly to Sleeper — never through StatChasers servers.",
                "Dynasty Command uses Sleeper auth tokens only when you choose to perform an action.",
                "Tokens stay in your browser unless you explicitly log out or clear your session.",
                "StatChasers never logs JWTs, private DMs, or personally identifiable Sleeper data.",
                "Trade Database stores only anonymized player and pick asset data — no team names, owner names, or league names.",
              ].map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-1 h-1 rounded-full mt-[7px] bg-indigo-400" />
                  <span className="text-[12px] text-muted-foreground leading-snug">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        {(activeCategory === "All" || activeCategory === "Other") && (
          <div className="pt-2 pb-4 flex flex-col items-center gap-3">
            <p className="text-center text-[12px] text-muted-foreground/50">
              Dynasty Command is built by <span className="font-semibold" style={{ color: "#d4af37" }}>StatChasers</span> for serious dynasty fantasy football managers.
            </p>
            <div className="flex items-center gap-1 flex-wrap justify-center">
              {[
                { label: "Terms of Service", action: onOpenTerms,   testId: "button-about-terms" },
                { label: "Privacy Policy",   action: onOpenPrivacy, testId: "button-about-privacy" },
                { label: "Cookies",          action: onOpenCookies, testId: "button-about-cookies" },
              ].map(({ label, action, testId }, i, arr) => (
                <span key={label} className="flex items-center gap-1">
                  <button
                    onClick={action}
                    data-testid={testId}
                    className="text-[11px] text-muted-foreground/40 hover:text-[#d4af37]/70 transition-colors underline underline-offset-2"
                  >
                    {label}
                  </button>
                  {i < arr.length - 1 && (
                    <span className="text-[11px] text-muted-foreground/20 select-none">·</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
