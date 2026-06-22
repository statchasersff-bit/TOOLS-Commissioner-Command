import { useEffect, useState } from "react";
import { CommandersReportView } from "@/components/CommandersReportView";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { fetchPublicReport, type PublicReportResponse } from "@/lib/commandersReportApi";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";
import logoLight from "@assets/statchasers_logo_transparent_light_1772764844283.png";

/**
 * Standalone, login-free view of a shared Commander's Report. Rendered outside
 * the authenticated app shell (see App.tsx) so anyone with the link can read it.
 * Fetches the report by its public share token and renders the same
 * presentational view the in-app tab uses.
 */
export function PublicReport({ token }: { token: string }) {
  const [data, setData] = useState<PublicReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPublicReport(token)
      .then((r) => { if (!cancelled) { setData(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e?.message || "Couldn't load this report"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [token]);

  const appUrl = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "/";

  return (
    <div className="min-h-screen sc-page-bg">
      {/* Branded header */}
      <header className="border-b border-[var(--sc-border)] dark:border-[rgba(212,175,55,0.16)] bg-[var(--sc-nav-bg-translucent)] dark:bg-[rgba(5,10,24,0.98)] backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a href={appUrl} className="flex items-center gap-2.5">
            <img src={logoDark} alt="StatChasers" className="w-8 h-8 hidden dark-any:block" />
            <img src={logoLight} alt="StatChasers" className="w-8 h-8 block dark-any:hidden" />
            <div className="leading-none text-left">
              <div className="text-sm font-bold text-foreground tracking-tight">StatChasers</div>
              <div className="text-[10px] text-[#d4af37] font-semibold tracking-wide mt-0.5">Commissioner Command</div>
            </div>
          </a>
          <Button asChild size="sm" className="gap-1.5 h-8">
            <a href={appUrl} data-testid="public-report-cta">
              Open Commissioner Command <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 md:py-6">
        {loading && (
          <Card className="p-10">
            <p className="text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading report…
            </p>
          </Card>
        )}

        {error && !loading && (
          <Card className="p-6 border-destructive/40">
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              The link may have been disabled by its owner, or it's incorrect.
            </p>
          </Card>
        )}

        {data && !loading && (
          <>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">
              Shared Commander's Report
            </p>
            <CommandersReportView
              recap={data.recap}
              article={data.article}
              generatedAt={data.generatedAt}
              model={data.model}
              tone={data.tone}
              leagueName={data.leagueName}
            />
            <div className="mt-6 text-center">
              <p className="text-xs text-muted-foreground mb-2">
                Want a report like this for your own dynasty league?
              </p>
              <Button asChild className="gap-1.5">
                <a href={appUrl}>Try Commissioner Command <ArrowRight className="w-4 h-4" /></a>
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
