/**
 * Commissioner Command shell — switches between the commissioner
 * decision-support surfaces:
 *   • Lineup Integrity  — lineup checks + anti-tanking review (signals only)
 *   • Activity Monitor  — disengaged-manager / league-health monitoring
 *   • Trade Review      — auto-tracked trades, risk flags, review decisions
 *
 * Activity Monitor and Trade Review are lazy-loaded behind error boundaries so
 * this shell still renders Lineup Integrity even if a module isn't present.
 *
 * Trade Review needs a fully-loaded League object (rosters + teams). Activity
 * Monitor and Lineup Integrity self-resolve the league from SleeperContext, so
 * they render regardless. When no league is loaded yet, Trade Review shows a
 * hint (it remains independently reachable from Trade Center → Review Center).
 */
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { ArrowLeft, Activity, ShieldAlert, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { League } from "@/types";
import CommissionerLineupIntegrity from "./CommissionerLineupIntegrity";

const CommissionerActivity = lazy(() => import("./CommissionerActivity"));
const TradeReviewCenter = lazy(() => import("./TradeReviewCenter"));

const GOLD = "#d4af37";
type Section = "integrity" | "activity" | "trades";

const SECTIONS: { id: Section; label: string; icon: typeof Activity }[] = [
  { id: "integrity", label: "Lineup Integrity", icon: ShieldAlert },
  { id: "activity", label: "Activity Monitor", icon: Activity },
  { id: "trades", label: "Trade Review", icon: ArrowLeftRight },
];

class SectionBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Loading() {
  return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
}

export default function CommissionerCommand({ league = null, onBack }: { league?: League | null; onBack?: () => void }) {
  const [section, setSection] = useState<Section>("integrity");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-commissioner-back">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
        )}
        <div className="inline-flex rounded-xl border border-border/60 p-0.5 bg-card/40">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                data-testid={`commissioner-section-${s.id}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                style={active ? { boxShadow: `inset 0 -2px 0 ${GOLD}` } : undefined}
              >
                <Icon className="w-3.5 h-3.5" /> {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === "integrity" && <CommissionerLineupIntegrity />}

      {section === "activity" && (
        <SectionBoundary fallback={<div className="py-12 text-center text-sm text-muted-foreground">Activity Monitor is unavailable.</div>}>
          <Suspense fallback={<Loading />}>
            <CommissionerActivity />
          </Suspense>
        </SectionBoundary>
      )}

      {section === "trades" && (
        <SectionBoundary fallback={<div className="py-12 text-center text-sm text-muted-foreground">Trade Review is unavailable.</div>}>
          <Suspense fallback={<Loading />}>
            {league ? (
              <TradeReviewCenter league={league} />
            ) : (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Load a league to use Trade Review. You can also open it from{" "}
                <span className="font-semibold text-foreground">Trade Center → Review Center</span>.
              </div>
            )}
          </Suspense>
        </SectionBoundary>
      )}
    </div>
  );
}
