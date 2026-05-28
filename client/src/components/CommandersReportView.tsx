import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RecapResult, Article, ToneId } from "@/lib/commandersReportApi";

/**
 * Presentational render of a Commander's Report — hero headline, award cards,
 * and the narrated article (when present). Shared by the authenticated tab and
 * the public read-only share page so the two never drift. No data fetching or
 * controls live here.
 */
export function CommandersReportView({
  recap,
  article,
  generatedAt,
  model,
  tone,
  leagueName,
}: {
  recap: RecapResult;
  article: Article | null;
  generatedAt?: string | null;
  model?: string | null;
  tone?: ToneId;
  leagueName?: string;
}) {
  return (
    <div className="space-y-4 md:space-y-5">
      {/* Hero */}
      <Card className="p-5 md:p-6 bg-gradient-to-br from-[#0b3a7a]/10 to-transparent">
        <div className="flex items-start justify-end gap-4">
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {recap.meta.confidence !== "high" && (
              <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400">
                {recap.meta.confidence} confidence
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Article */}
      {article ? (
        <Card className="p-5 md:p-6">
          <div className="space-y-5">
            {article.sections.map((s, i) => (
              <div key={i}>
                {s.title && <h3 className="text-base font-bold text-foreground mb-1.5">{s.title}</h3>}
                {s.body.split(/\n\n+/).map((para, j) => (
                  <p key={j} className="text-sm text-muted-foreground leading-relaxed mb-2">{para}</p>
                ))}
              </div>
            ))}
            {generatedAt && (
              <p className="text-[10px] text-muted-foreground/70 pt-2 border-t border-border/40">
                Generated {new Date(generatedAt).toLocaleString()}
                {model ? ` · ${model}` : ""}
                {tone ? ` · ${tone.replace("_", " ")}` : ""}
              </p>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground text-center">
            The data is ready. Hit “Generate report” to have Dynasty Command write it up.
          </p>
        </Card>
      )}
    </div>
  );
}
