import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/KpiCard";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { Trophy, Flame, DollarSign, Activity, TrendingDown, TrendingUp } from "lucide-react";
import type { RecapResult, Article, ToneId, Claim } from "@/lib/commandersReportApi";

const AWARD_ICONS: Record<string, typeof Trophy> = {
  biggest_reach: TrendingDown,
  best_value: TrendingUp,
  largest_faab_spend: DollarSign,
  best_trade: Trophy,
  most_active: Activity,
  most_chaotic: Flame,
};

/**
 * Presentational render of a Commander's Report — hero headline, award cards,
 * the narrated article (when present), and the expandable "Data Receipts".
 * Shared by the authenticated tab and the public read-only share page so the
 * two never drift. No data fetching or controls live here.
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
            <Badge variant="outline" className="text-[10px] whitespace-nowrap">
              <Flame className="w-3 h-3 mr-1" /> Chaos {recap.chaosScore.score} · {recap.chaosScore.tier}
            </Badge>
            {recap.meta.confidence !== "high" && (
              <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400">
                {recap.meta.confidence} confidence
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Award cards */}
      {recap.awards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {recap.awards.map((a) => (
            <KpiCard
              key={a.key}
              label={a.label}
              value={a.value}
              icon={AWARD_ICONS[a.key] ?? Trophy}
              subtitle={`${a.manager} · ${a.detail}`}
            />
          ))}
        </div>
      )}

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

      {/* Data Receipts */}
      {recap.claims.length > 0 && (
        <Card className="p-4 md:p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Data Receipts — every claim, with the numbers behind it
          </p>
          <Accordion type="multiple" className="w-full">
            {recap.claims.map((c) => (
              <ClaimRow key={c.id} claim={c} />
            ))}
          </Accordion>
        </Card>
      )}
    </div>
  );
}

const SEVERITY_STYLE: Record<Claim["severity"], string> = {
  spicy: "text-rose-500 bg-rose-500/10",
  notable: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  info: "text-muted-foreground bg-muted/40",
};

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <AccordionItem value={claim.id}>
      <AccordionTrigger className="text-left text-sm py-3">
        <span className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className={cn("text-[9px] uppercase shrink-0", SEVERITY_STYLE[claim.severity])}>
            {claim.claim_type.replace("_", " ")}
          </Badge>
          <span className="truncate">{claim.headline}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs pl-1 pb-2">
          {Object.entries(claim.evidence).map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{k}</span>
              <span className="text-foreground tabular-nums break-words">{v == null ? "—" : String(v)}</span>
            </div>
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
