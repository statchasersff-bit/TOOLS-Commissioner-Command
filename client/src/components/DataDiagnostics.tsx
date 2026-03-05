import { useState } from "react";
import { Card } from "@/components/ui/card";
import { useValueModel } from "@/contexts/ValueModelContext";
import { Bug, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Clock, Database } from "lucide-react";

export function DataDiagnostics() {
  const [isOpen, setIsOpen] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const { diagnostics, sourceId, isLoading, isSnapshot } = useValueModel();

  if (import.meta.env.PROD) return null;

  const formatDate = (iso: string) => {
    if (!iso || iso === "snapshot") return "Snapshot (local file)";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50" data-testid="data-diagnostics">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-[#0b3a7a] text-white hover:bg-[#0b3a7a]/90 dark:bg-blue-600 dark:hover:bg-blue-500 shadow-lg transition-all"
        data-testid="button-toggle-diagnostics"
      >
        <Bug className="w-3 h-3" />
        Diagnostics
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
      </button>

      {isOpen && (
        <Card className="absolute bottom-10 right-0 w-80 p-0 shadow-xl border-[#0b3a7a]/20 dark:border-blue-400/20 overflow-hidden" data-testid="panel-diagnostics">
          <div className="px-4 py-3 bg-[#0b3a7a]/5 dark:bg-blue-400/8 border-b border-[#0b3a7a]/10 dark:border-blue-400/10">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-[#0b3a7a] dark:text-blue-400" />
              <span className="text-xs font-bold text-foreground">Data Diagnostics</span>
              {isLoading && (
                <span className="text-[9px] bg-[#d4af37]/15 text-[#d4af37] px-1.5 py-0.5 rounded-full font-semibold">Loading</span>
              )}
            </div>
          </div>

          <div className="p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium">Source</span>
              <span className="font-semibold text-foreground capitalize">{sourceId}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium flex items-center gap-1">
                <Clock className="w-3 h-3" /> API Updated At
              </span>
              <span className="font-mono text-[10px] text-foreground">{formatDate(diagnostics.updatedAt)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium flex items-center gap-1">
                <Clock className="w-3 h-3" /> Last Fetched
              </span>
              <span className="font-mono text-[10px] text-foreground">{diagnostics.fetchedAt ? formatDate(diagnostics.fetchedAt) : "—"}</span>
            </div>

            <div className="h-px bg-border/60" />

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Mapped Players
              </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-mapped-count">{diagnostics.mappedCount.toLocaleString()}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-orange-500" /> Unmatched Rows
              </span>
              <span className={`font-bold ${diagnostics.unmatchedCount > 0 ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400"}`} data-testid="text-unmatched-count">
                {diagnostics.unmatchedCount}
              </span>
            </div>

            {isSnapshot && (
              <div className="flex items-center gap-1.5 bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/15 dark:border-amber-400/15 rounded-md px-2.5 py-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">Using snapshot values (dev mode)</span>
              </div>
            )}

            {diagnostics.unmatchedCount > 0 && (
              <div>
                <button
                  onClick={() => setShowUnmatched(!showUnmatched)}
                  className="flex items-center gap-1 text-[10px] font-semibold text-[#0b3a7a] dark:text-blue-400 hover:text-[#d4af37] transition-colors"
                  data-testid="button-toggle-unmatched"
                >
                  {showUnmatched ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showUnmatched ? "Hide" : "Show"} unmatched rows
                </button>

                {showUnmatched && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border/50 bg-muted/20">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="border-b border-border/30 text-left">
                          <th className="px-2 py-1.5 font-semibold text-muted-foreground">Name</th>
                          <th className="px-2 py-1.5 font-semibold text-muted-foreground">Pos</th>
                          <th className="px-2 py-1.5 font-semibold text-muted-foreground">Team</th>
                          <th className="px-2 py-1.5 font-semibold text-muted-foreground text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnostics.unmatchedRows.map((row, i) => (
                          <tr key={i} className="border-b border-border/10">
                            <td className="px-2 py-1 text-foreground">{row.name}</td>
                            <td className="px-2 py-1 text-muted-foreground">{row.pos}</td>
                            <td className="px-2 py-1 text-muted-foreground">{row.team}</td>
                            <td className="px-2 py-1 text-right font-mono text-foreground">{row.value.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
