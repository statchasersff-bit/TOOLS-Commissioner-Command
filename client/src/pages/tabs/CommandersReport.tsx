import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";
import { CommandersReportView } from "@/components/CommandersReportView";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Link2,
} from "lucide-react";
import {
  fetchPeriods,
  fetchReport,
  generateReport,
  shareReport,
  shareUrl,
  type ToneId,
  type ReportResponse,
} from "@/lib/commandersReportApi";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function periodKey(year: number, month: number) {
  return `${year}-${month}`;
}

export function CommandersReport({ leagueId, leagueName }: { leagueId: string; leagueName?: string }) {
  const { toast } = useToast();
  const [periods, setPeriods] = useState<Array<{ year: number; month: number; activityCount: number }>>([]);
  const [selected, setSelected] = useState<{ year: number; month: number } | null>(null);
  // Full Chaos is the only tone the report ships now — the other tones were retired.
  const tone: ToneId = "full_chaos";
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the list of months with activity, then default to the most recent.
  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPeriods(leagueId)
      .then((p) => {
        if (cancelled) return;
        setPeriods(p.periods);
        setSelected(p.defaultPeriod);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "Failed to load report periods");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [leagueId]);

  // Load the report (deterministic recap; article if one was already generated).
  useEffect(() => {
    if (!leagueId || !selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReport(leagueId, selected.year, selected.month, tone)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "Failed to load report");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [leagueId, selected, tone]);

  const onGenerate = useCallback(async () => {
    if (!leagueId || !selected) return;
    setGenerating(true);
    try {
      const r = await generateReport(leagueId, selected.year, selected.month, tone);
      setReport(r);
      toast({ title: "Report generated", description: `${MONTHS[selected.month - 1]} ${selected.year} · ${tone.replace("_", " ")}` });
    } catch (e: any) {
      toast({ title: "Couldn't generate report", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }, [leagueId, selected, tone, toast]);

  // Copy a public, login-free link to this exact report (league + month + tone).
  const onCopyLink = useCallback(async () => {
    if (!leagueId || !selected) return;
    setSharing(true);
    try {
      const { path } = await shareReport(leagueId, selected.year, selected.month, tone);
      const url = shareUrl(path);
      // Lead with the article's share caption (when present) so the copied text
      // is ready to paste into a group chat, not just a bare link.
      const shareText = report?.article?.shareText;
      const clipboardText = shareText ? `${shareText}\n${url}` : url;
      try {
        await navigator.clipboard.writeText(clipboardText);
        toast({ title: "Public link copied", description: "Anyone with this link can view the report. No login needed." });
      } catch {
        // Clipboard blocked (insecure context / permissions): surface the URL so it can be copied manually.
        toast({ title: "Public link ready", description: url });
      }
    } catch (e: any) {
      toast({ title: "Couldn't create share link", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setSharing(false);
    }
  }, [leagueId, selected, tone, toast, report]);

  const recap = report?.recap ?? null;
  const article = report?.article ?? null;

  return (
    <div className="space-y-4 md:space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <SectionHeader
          title="Commander's Report"
          subtitle="Your monthly dynasty briefing: trades graded, picks judged, waivers analyzed, and managers respectfully roasted."
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* Month picker */}
          <select
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
            value={selected ? periodKey(selected.year, selected.month) : ""}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              setSelected({ year: y, month: m });
            }}
            disabled={periods.length === 0}
            data-testid="commanders-month-picker"
          >
            {periods.length === 0 && <option value="">No activity</option>}
            {periods.map((p) => (
              <option key={periodKey(p.year, p.month)} value={periodKey(p.year, p.month)}>
                {MONTHS[p.month - 1]} {p.year} ({p.activityCount})
              </option>
            ))}
          </select>
          <Button
            onClick={onGenerate}
            disabled={generating || loading || !recap}
            className="gap-1.5 h-9"
            data-testid="commanders-generate"
            title="Re-roll the write-up with fresh phrasing"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : article ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
            {article ? "Regenerate" : "Generate report"}
          </Button>
          <Button
            onClick={onCopyLink}
            disabled={sharing || loading || !recap}
            variant="outline"
            className="gap-1.5 h-9"
            data-testid="commanders-copy-link"
            title="Copy a public, login-free link to this report"
          >
            {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Copy link
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-4 border-destructive/40">
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </p>
        </Card>
      )}

      {loading && !recap && (
        <Card className="p-8"><p className="text-sm text-muted-foreground text-center">Building report…</p></Card>
      )}

      {recap && (
        <CommandersReportView
          recap={recap}
          article={article}
          generatedAt={report?.generatedAt}
          model={report?.model}
          tone={report?.tone}
          leagueName={leagueName}
        />
      )}
    </div>
  );
}
