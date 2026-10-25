/**
 * Rulebook / Bylaws — a searchable, versioned league rulebook with template
 * support so commissioners don't type every section from scratch.
 *
 * Sections seed from a default set, can be filled from full rulebook templates
 * or per-section snippets, support {{placeholder}} substitution from league
 * data, and never overwrite manual text unless the user picks "Replace all".
 * Each save bumps the version; history is viewable.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSleeper } from "@/contexts/SleeperContext";
import type { League } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  BookOpen, Search, Pin, History, Save, Plus, FileText, Sparkles, Upload, Bookmark, Eye, Check,
  Pencil, Download, Link2, ChevronDown, Check as CheckIcon, ArrowRight,
} from "lucide-react";
import { rulebookApi, type BylawSection, type BylawVersion } from "@/lib/leagueProfileApi";
import {
  RULEBOOK_TEMPLATES, SECTION_TEMPLATES, applyPlaceholders, hasUnresolvedPlaceholders,
  getCustomTemplates, saveCustomTemplate,
  type RulebookTemplate, type RulebookSectionKey, type LeaguePlaceholderData, type SectionSnippet,
} from "@/lib/rulebookTemplates";

const GOLD = "#d4af37";

const DEFAULT_SECTIONS: { key: string; title: string }[] = [
  { key: "league-setup", title: "League Setup" },
  { key: "scoring", title: "Scoring" },
  { key: "rosters", title: "Rosters" },
  { key: "lineups", title: "Lineups" },
  { key: "trades", title: "Trades" },
  { key: "waivers", title: "Waivers" },
  { key: "tanking", title: "Tanking" },
  { key: "playoffs", title: "Playoffs" },
  { key: "draft-picks", title: "Draft Picks" },
  { key: "payments", title: "Payments" },
  { key: "payouts", title: "Payouts" },
  { key: "orphans", title: "Orphans" },
  { key: "commissioner-powers", title: "Commissioner Powers" },
];

function seedSections(): BylawSection[] {
  return DEFAULT_SECTIONS.map((s, i) => ({
    sectionId: s.key, key: s.key, title: s.title, body: "", pinned: false, order: i, notes: [],
  }));
}

type SectionStatus = "empty" | "drafted" | "complete";
function sectionStatus(body: string): SectionStatus {
  const t = (body ?? "").trim();
  if (!t) return "empty";
  if (hasUnresolvedPlaceholders(t)) return "drafted";
  return "complete";
}

const STATUS_PILL: Record<SectionStatus, string> = {
  empty: "bg-slate-500/15 text-slate-500 dark-any:text-slate-400 border-slate-500/30",
  drafted: "bg-amber-500/15 text-amber-600 dark-any:text-amber-400 border-amber-500/30",
  complete: "bg-emerald-500/15 text-emerald-600 dark-any:text-emerald-400 border-emerald-500/30",
};
const STATUS_LABEL: Record<SectionStatus, string> = { empty: "Empty", drafted: "Drafted", complete: "Complete" };

function StatusPill({ status }: { status: SectionStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS_PILL[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// Quick-jump chips for the lookups commissioners reach for most.
const QUICK_JUMPS: { key: string; label: string }[] = [
  { key: "trades", label: "Trades" },
  { key: "tanking", label: "Tanking" },
  { key: "draft-picks", label: "Future Picks" },
  { key: "payments", label: "Payments" },
  { key: "orphans", label: "Orphans" },
  { key: "playoffs", label: "Playoffs" },
  { key: "commissioner-powers", label: "Commissioner Powers" },
];

/** Split body text into paragraphs / bullet lines for comfortable reading, with
 *  the search term highlighted. Returns React nodes — no dangerouslySetInnerHTML. */
function highlight(text: string, term: string): React.ReactNode {
  if (!term) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  let i = 0, k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(t, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={k++} className="rounded bg-[#d4af37]/30 text-foreground px-0.5">
        {text.slice(idx, idx + term.length)}
      </mark>,
    );
    i = idx + term.length;
  }
  return parts;
}

/** Render rule body as readable paragraphs + bullet lists. */
function RuleBody({ body, term }: { body: string; term: string }) {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 1 && lines.every((l) => /^([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi} className="list-disc pl-5 space-y-1 text-[13px] leading-relaxed text-foreground/90">
              {lines.map((l, li) => (
                <li key={li}>{highlight(l.replace(/^([-*•]|\d+[.)])\s+/, ""), term)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {highlight(block, term)}
          </p>
        );
      })}
    </div>
  );
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function LeagueRulebook({ leagueId, league }: { leagueId: string; league?: League | null }) {
  const { toast } = useToast();
  const sleeper = useSleeper();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<BylawSection[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // View = readable document; Edit = textarea/template workflow. Once content
  // exists we open in View; an empty rulebook opens straight into Edit.
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [modeTouched, setModeTouched] = useState(false);
  // Set when entering Edit by clicking a section's pencil — focuses that body.
  const [focusSection, setFocusSection] = useState<string | null>(null);

  // Modals
  const [templateModal, setTemplateModal] = useState<null | { mode: "choose" | "fill" }>(null);
  const [importModal, setImportModal] = useState(false);
  const [saveTplModal, setSaveTplModal] = useState(false);
  const [snippetFor, setSnippetFor] = useState<BylawSection | null>(null);

  const [customTemplates, setCustomTemplates] = useState<RulebookTemplate[]>(() => getCustomTemplates());

  const q = useQuery({
    queryKey: ["bylaws", leagueId],
    queryFn: () => rulebookApi.get(leagueId),
  });
  const historyQ = useQuery({
    queryKey: ["bylaws-history", leagueId],
    queryFn: () => rulebookApi.history(leagueId),
  });

  const sections: BylawSection[] = draft ?? (q.data?.sections?.length ? q.data.sections : seedSections());

  const hasContent = sections.some((s) => (s.body ?? "").trim());
  // Default the mode from content the first time data settles, then respect the
  // commissioner's explicit toggle.
  useEffect(() => {
    if (!modeTouched && !q.isLoading) setMode(hasContent ? "view" : "edit");
  }, [q.isLoading, hasContent, modeTouched]);

  const switchMode = (m: "view" | "edit") => { setMode(m); setModeTouched(true); };

  // Placeholder data resolved from league metadata. Tokens without data are left
  // intact for the commissioner to fill in.
  const summary = sleeper.leagues.find((l) => l.leagueId === leagueId) ?? null;
  const leagueData: LeaguePlaceholderData = useMemo(() => ({
    league_name: league?.name ?? summary?.name,
    platform: league?.platform ?? "Sleeper",
    team_count: league?.totalRosters ?? summary?.totalRosters,
    playoff_teams: league?.playoffTeams,
  }), [league, summary]);

  const allTemplates = useMemo(() => [...RULEBOOK_TEMPLATES, ...customTemplates], [customTemplates]);

  const recommendedTemplateId =
    (league?.isBestBall || summary?.isBestBall) ? "best-ball"
    : summary?.leagueType === "keeper" ? "keeper"
    : summary?.leagueType === "redraft" ? "redraft"
    : "dynasty";

  const saveMut = useMutation({
    mutationFn: () => rulebookApi.save(leagueId, sections),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bylaws", leagueId] });
      setDirty(false); setDraft(null);
      toast({ title: "Rulebook saved", description: "A new version was recorded." });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  const update = (id: string, patch: Partial<BylawSection>) => {
    setDraft(sections.map((s) => (s.sectionId === id ? { ...s, ...patch } : s)));
    setDirty(true);
  };

  const addSection = () => {
    const id = `custom-${Date.now()}`;
    setDraft([...sections, { sectionId: id, key: id, title: "New Section", body: "", pinned: false, order: sections.length, notes: [] }]);
    setDirty(true);
  };

  // Apply a full template. "fill" never overwrites non-empty sections; "replace"
  // overwrites every section the template provides.
  const applyTemplate = (template: RulebookTemplate, mode: "fill" | "replace") => {
    let touched = 0;
    setDraft(sections.map((s) => {
      const body = template.sections[s.key as RulebookSectionKey];
      if (body == null) return s;
      if (mode === "fill" && s.body.trim()) return s;
      touched++;
      return { ...s, body: applyPlaceholders(body, leagueData) };
    }));
    setDirty(true);
    setTemplateModal(null);
    toast({
      title: mode === "replace" ? "Template applied" : "Empty sections filled",
      description: `${touched} section${touched === 1 ? "" : "s"} ${mode === "replace" ? "replaced" : "filled"} from ${template.name}.`,
    });
  };

  const fillMissing = () => {
    const t = allTemplates.find((x) => x.id === recommendedTemplateId) ?? RULEBOOK_TEMPLATES[0];
    applyTemplate(t, "fill");
  };

  const applySnippet = (sectionId: string, snippet: SectionSnippet) => {
    update(sectionId, { body: applyPlaceholders(snippet.body, leagueData) });
    setSnippetFor(null);
    toast({ title: "Snippet applied" });
  };

  // Import pasted bylaws — naive heading detection assigns text to sections.
  const importBylaws = (text: string, mode: "fill" | "replace") => {
    const parsed = parseBylaws(text);
    let touched = 0;
    setDraft(sections.map((s) => {
      const body = parsed[s.key as RulebookSectionKey];
      if (!body) return s;
      if (mode === "fill" && s.body.trim()) return s;
      touched++;
      return { ...s, body };
    }));
    setDirty(true);
    setImportModal(false);
    toast({
      title: "Bylaws imported",
      description: touched > 0 ? `Matched ${touched} section${touched === 1 ? "" : "s"}.` : "No sections matched — try adding section headings.",
      variant: touched > 0 ? undefined : "destructive",
    });
  };

  const doSaveAsTemplate = (name: string, description: string) => {
    const id = `custom-${Date.now()}`;
    const tplSections: Partial<Record<RulebookSectionKey, string>> = {};
    for (const s of sections) {
      if (s.body.trim()) tplSections[s.key as RulebookSectionKey] = s.body;
    }
    const next = saveCustomTemplate({ id, name: name.trim() || "My Template", description: description.trim(), format: "Custom", sections: tplSections, custom: true });
    setCustomTemplates(next);
    setSaveTplModal(false);
    toast({ title: "Template saved", description: "Reuse it from Use Template in any of your leagues." });
  };

  // Sorted full list (pinned first). View/Edit handle search themselves.
  const ordered = useMemo(
    () => [...sections].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order),
    [sections],
  );

  // Completion summary (over the standard rulebook sections present).
  const completeCount = sections.filter((s) => sectionStatus(s.body) === "complete").length;
  const draftedCount = sections.filter((s) => sectionStatus(s.body) === "drafted").length;
  const emptySections = sections.filter((s) => sectionStatus(s.body) === "empty");

  const leagueName = league?.name ?? summary?.name ?? "League";
  const formatTags = useMemo(() => {
    const tags: string[] = [];
    if (league?.isBestBall || summary?.isBestBall) tags.push("Best Ball");
    const type = summary?.leagueType;
    if (type) tags.push(type.charAt(0).toUpperCase() + type.slice(1));
    const teams = league?.totalRosters ?? summary?.totalRosters;
    if (teams) tags.push(`${teams}-Team`);
    const fmt = league?.format ?? summary?.format;
    if (fmt) tags.push(fmt);
    const scoring = league?.scoringFormat ?? summary?.scoringFormat;
    if (scoring) tags.push(scoring);
    return tags;
  }, [league, summary]);

  const lastUpdated = useMemo(() => {
    const versions = historyQ.data?.versions ?? [];
    const latest = versions[versions.length - 1];
    return latest?.savedAt ? new Date(latest.savedAt) : null;
  }, [historyQ.data]);

  const editSection = (sectionId: string) => { setFocusSection(sectionId); switchMode("edit"); };

  const exportPdf = () => {
    const w = window.open("", "_blank");
    if (!w) { toast({ title: "Pop-up blocked", description: "Allow pop-ups to export the rulebook.", variant: "destructive" }); return; }
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const bodyHtml = ordered
      .filter((s) => s.body.trim())
      .map((s) => `<h2>${esc(s.title)}</h2><div>${esc(s.body).replace(/\n/g, "<br/>")}</div>`)
      .join("");
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(leagueName)} — Rulebook</title>` +
      `<style>body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.65}` +
      `h1{font-size:24px;margin-bottom:4px}.meta{color:#666;font-size:13px;margin-bottom:24px}` +
      `h2{font-size:17px;margin-top:28px;border-bottom:1px solid #e5e5e5;padding-bottom:5px}div{font-size:14px}</style></head>` +
      `<body><h1>${esc(leagueName)} — Rulebook</h1><div class="meta">${esc(formatTags.join(" · "))}${lastUpdated ? " · Last updated " + esc(fmtDate(lastUpdated)) : ""}</div>` +
      `${bodyHtml || "<p>No rules documented yet.</p>"}` +
      `<script>window.onload=function(){window.print()}</script></body></html>`,
    );
    w.document.close();
  };

  const copyLink = () => {
    const url = window.location.href;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => toast({ title: "Link copied", description: "Rulebook page link copied to your clipboard." }),
        () => toast({ title: "Couldn't copy link", variant: "destructive" }),
      );
    } else {
      toast({ title: "Couldn't copy link", variant: "destructive" });
    }
  };

  // Open a section's template helper: prefer the per-section snippet picker; fall
  // back to the full-template modal when a section has no snippets.
  const openSectionTemplate = (s: BylawSection) => {
    const snippets = SECTION_TEMPLATES[s.key as RulebookSectionKey];
    if (snippets && snippets.length) setSnippetFor(s);
    else setTemplateModal({ mode: "choose" });
  };

  if (q.isLoading) return <Card className="p-8 text-center text-sm text-muted-foreground">Loading rulebook…</Card>;

  return (
    <div className="space-y-4">
      {mode === "view" ? (
        <RulebookViewMode
          sections={ordered}
          search={search}
          setSearch={setSearch}
          leagueName={leagueName}
          version={q.data?.currentVersion}
          formatTags={formatTags}
          lastUpdated={lastUpdated}
          completeCount={completeCount}
          draftedCount={draftedCount}
          total={sections.length}
          missingTitles={emptySections.map((s) => s.title)}
          onEditAll={() => switchMode("edit")}
          onEditSection={editSection}
          onSectionTemplate={openSectionTemplate}
          onExportPdf={exportPdf}
          onCopyLink={copyLink}
          onToggleHistory={() => setShowHistory((v) => !v)}
        />
      ) : (
        <RulebookEditMode
          sections={ordered}
          search={search}
          setSearch={setSearch}
          version={q.data?.currentVersion}
          completeCount={completeCount}
          total={sections.length}
          missingTitles={emptySections.map((s) => s.title)}
          dirty={dirty}
          saving={saveMut.isPending}
          focusSection={focusSection}
          onFocused={() => setFocusSection(null)}
          hasContent={hasContent}
          onView={() => switchMode("view")}
          onSave={() => saveMut.mutate()}
          onUpdate={update}
          onAddSection={addSection}
          onSnippet={setSnippetFor}
          onUseTemplate={() => setTemplateModal({ mode: "choose" })}
          onFillMissing={fillMissing}
          onImport={() => setImportModal(true)}
          onSaveTemplate={() => setSaveTplModal(true)}
          onToggleHistory={() => setShowHistory((v) => !v)}
        />
      )}

      {showHistory && <HistoryPanel versions={historyQ.data?.versions ?? []} loading={historyQ.isLoading} />}

      {/* ── Modals ── */}
      {templateModal && (
        <UseTemplateModal
          templates={allTemplates}
          recommendedId={recommendedTemplateId}
          leagueData={leagueData}
          onApply={applyTemplate}
          onClose={() => setTemplateModal(null)}
        />
      )}
      {snippetFor && (
        <SectionSnippetModal
          section={snippetFor}
          snippets={SECTION_TEMPLATES[snippetFor.key as RulebookSectionKey] ?? []}
          leagueData={leagueData}
          onApply={(snip) => applySnippet(snippetFor.sectionId, snip)}
          onClose={() => setSnippetFor(null)}
        />
      )}
      {importModal && <ImportBylawsModal onImport={importBylaws} onClose={() => setImportModal(false)} />}
      {saveTplModal && <SaveTemplateModal onSave={doSaveAsTemplate} onClose={() => setSaveTplModal(false)} />}
    </div>
  );
}

// ── View / Edit toggle ───────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: "view" | "edit"; onChange: (m: "view" | "edit") => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5" data-testid="rulebook-mode-toggle">
      {(["view", "edit"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
            mode === m ? "bg-[#d4af37] text-[#1a1206] shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid={`rulebook-mode-${m}`}
        >
          {m === "view" ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
          {m}
        </button>
      ))}
    </div>
  );
}

function FormatTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-[#d4af37]/30 bg-[#d4af37]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#b8941f] dark-any:text-[#d4af37]">
      {label}
    </span>
  );
}

// Small status glyph for the table-of-contents rows.
function TocStatusDot({ status }: { status: SectionStatus }) {
  if (status === "complete") return <CheckIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />;
  if (status === "drafted") return <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />;
  return <span className="w-2 h-2 rounded-full border border-slate-400/60 flex-shrink-0" />;
}

// ── View Mode — premium readable rulebook viewer ─────────────────────────────

function RulebookViewMode({
  sections, search, setSearch, leagueName, version, formatTags, lastUpdated,
  completeCount, draftedCount, total, missingTitles,
  onEditAll, onEditSection, onSectionTemplate, onExportPdf, onCopyLink,
  onToggleHistory,
}: {
  sections: BylawSection[];
  search: string; setSearch: (v: string) => void;
  leagueName: string; version?: number;
  formatTags: string[]; lastUpdated: Date | null;
  completeCount: number; draftedCount: number; total: number; missingTitles: string[];
  onEditAll: () => void;
  onEditSection: (id: string) => void;
  onSectionTemplate: (s: BylawSection) => void;
  onExportPdf: () => void;
  onCopyLink: () => void;
  onToggleHistory: () => void;
}) {
  const term = search.trim().toLowerCase();
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeId, setActiveId] = useState<string>(sections[0]?.sectionId ?? "");

  // Sections shown in the main column — filtered while searching.
  const visible = useMemo(() => {
    if (!term) return sections;
    return sections.filter((s) => s.title.toLowerCase().includes(term) || (s.body ?? "").toLowerCase().includes(term));
  }, [sections, term]);

  // Search results — matched sections with the first matching line as a snippet.
  const results = useMemo(() => {
    if (!term) return [];
    return visible.map((s) => {
      const line = (s.body ?? "").split(/\n/).find((l) => l.toLowerCase().includes(term))?.trim();
      return { section: s, snippet: line || s.title };
    });
  }, [visible, term]);

  const jumpTo = (id: string) => {
    refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  };

  // Scroll-spy: highlight the section nearest the top of the viewport.
  useEffect(() => {
    if (term) return; // skip while filtering
    const observer = new IntersectionObserver(
      (entries) => {
        const onscreen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = (onscreen[0]?.target as HTMLElement | undefined)?.dataset.id;
        if (id) setActiveId(id);
      },
      { rootMargin: "-15% 0px -75% 0px", threshold: 0 },
    );
    Object.values(refs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [visible, term]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Rulebook</h3>
              {version ? <span className="text-xs text-muted-foreground">v{version}</span> : null}
            </div>
            <h2 className="mt-1.5 text-xl font-bold text-foreground truncate">{leagueName}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {formatTags.map((t) => <FormatTag key={t} label={t} />)}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{completeCount} of {total}</span> sections complete
              {draftedCount > 0 && <> · {draftedCount} drafted</>}
              {lastUpdated && <> · Last updated {fmtDate(lastUpdated)}</>}
            </p>
            {missingTitles.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Missing: {missingTitles.join(", ")}
              </p>
            )}
          </div>
          <ModeToggle mode="view" onChange={(m) => m === "edit" && onEditAll()} />
        </div>

        {/* Search + actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules…" className="pl-8 h-9 w-full" data-testid="rulebook-search" />
          </div>
          <Button size="sm" onClick={onEditAll} style={{ background: GOLD, color: "#1a1206" }} data-testid="rulebook-edit">
            <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit Rulebook
          </Button>
          <Button size="sm" variant="outline" onClick={onExportPdf} data-testid="rulebook-export">
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export PDF
          </Button>
          <Button size="sm" variant="outline" onClick={onCopyLink} data-testid="rulebook-copy-link">
            <Link2 className="w-3.5 h-3.5 mr-1.5" /> Copy Link
          </Button>
          <Button size="sm" variant="outline" onClick={onToggleHistory} data-testid="rulebook-history-toggle">
            <History className="w-3.5 h-3.5 mr-1.5" /> History
          </Button>
        </div>

        {/* Quick jumps */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground mr-0.5">Quick jumps:</span>
          {QUICK_JUMPS.filter((qj) => sections.some((s) => s.key === qj.key)).map((qj) => {
            const sec = sections.find((s) => s.key === qj.key)!;
            return (
              <button
                key={qj.key}
                onClick={() => jumpTo(sec.sectionId)}
                className="inline-flex items-center rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-[#d4af37]/50 hover:text-[#d4af37] hover:bg-[#d4af37]/5 transition-colors"
                data-testid={`rulebook-chip-${qj.key}`}
              >
                {qj.label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Search results summary */}
      {term && (
        <Card className="p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
            {results.length} {results.length === 1 ? "result" : "results"} for “{search.trim()}”
          </p>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sections match your search.</p>
          ) : (
            <ul className="space-y-1.5">
              {results.map(({ section, snippet }) => (
                <li key={section.sectionId}>
                  <button
                    onClick={() => jumpTo(section.sectionId)}
                    className="w-full text-left rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
                    data-testid={`rulebook-result-${section.key}`}
                  >
                    <span className="text-[13px] font-semibold text-foreground">{section.title}</span>
                    <span className="mx-1.5 text-muted-foreground/40">—</span>
                    <span className="text-xs text-muted-foreground">{highlight(snippet, search.trim())}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Mobile: jump-to dropdown */}
      <div className="lg:hidden">
        <div className="relative">
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <select
            value={activeId}
            onChange={(e) => jumpTo(e.target.value)}
            className="w-full appearance-none rounded-lg border border-border/60 bg-background px-3 py-2 pr-9 text-sm font-medium text-foreground"
            data-testid="rulebook-jump-select"
          >
            {sections.map((s) => (
              <option key={s.sectionId} value={s.sectionId}>{s.title}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Body: sticky TOC + section cards */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 items-start">
        {/* Table of contents (sticky, desktop only) */}
        <nav className="hidden lg:block sticky top-4 self-start">
          <Card className="p-2">
            <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Sections</p>
            <ul className="space-y-0.5">
              {sections.map((s) => {
                const status = sectionStatus(s.body);
                const active = activeId === s.sectionId;
                return (
                  <li key={s.sectionId}>
                    <button
                      onClick={() => jumpTo(s.sectionId)}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                        active
                          ? "bg-[#d4af37]/10 text-[#b8941f] dark-any:text-[#d4af37] font-semibold"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      )}
                      data-testid={`rulebook-toc-${s.key}`}
                    >
                      <TocStatusDot status={status} />
                      <span className="truncate">{s.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </nav>

        {/* Section cards */}
        <div className="space-y-3 min-w-0">
          {visible.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">No sections match your search.</Card>
          ) : (
            visible.map((s) => {
              const status = sectionStatus(s.body);
              const empty = status === "empty";
              return (
                <Card
                  key={s.sectionId}
                  ref={(el: HTMLDivElement | null) => { refs.current[s.sectionId] = el; }}
                  data-id={s.sectionId}
                  className="p-4 sm:p-5 scroll-mt-4"
                  data-testid={`rule-view-${s.key}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="text-base font-bold text-foreground truncate">{s.title}</h3>
                      <StatusPill status={status} />
                    </div>
                    <button
                      onClick={() => onEditSection(s.sectionId)}
                      title="Edit this section"
                      className="flex-shrink-0 inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-[#d4af37] hover:bg-[#d4af37]/10 transition-colors"
                      data-testid={`rule-edit-${s.key}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {empty ? (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
                      <p className="text-sm text-muted-foreground">No {s.title.toLowerCase()} rules added yet.</p>
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => onSectionTemplate(s)} data-testid={`rule-empty-template-${s.key}`}>
                          <FileText className="w-3.5 h-3.5 mr-1.5" /> Use Template
                        </Button>
                        <Button size="sm" onClick={() => onEditSection(s.sectionId)} style={{ background: GOLD, color: "#1a1206" }} data-testid={`rule-empty-add-${s.key}`}>
                          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Rule
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <RuleBody body={s.body} term={search.trim()} />
                      {lastUpdated && (
                        <p className="mt-3 pt-2.5 border-t border-border/40 text-[11px] text-muted-foreground">
                          Last updated {fmtDate(lastUpdated)}
                        </p>
                      )}
                    </>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edit Mode — textarea + template workflow ─────────────────────────────────

function RulebookEditMode({
  sections, search, setSearch, version,
  completeCount, total, missingTitles,
  dirty, saving, focusSection, onFocused, hasContent,
  onView, onSave, onUpdate, onAddSection, onSnippet,
  onUseTemplate, onFillMissing, onImport, onSaveTemplate, onToggleHistory,
}: {
  sections: BylawSection[];
  search: string; setSearch: (v: string) => void;
  version?: number;
  completeCount: number; total: number; missingTitles: string[];
  dirty: boolean; saving: boolean;
  focusSection: string | null; onFocused: () => void; hasContent: boolean;
  onView: () => void;
  onSave: () => void;
  onUpdate: (id: string, patch: Partial<BylawSection>) => void;
  onAddSection: () => void;
  onSnippet: (s: BylawSection) => void;
  onUseTemplate: () => void;
  onFillMissing: () => void;
  onImport: () => void;
  onSaveTemplate: () => void;
  onToggleHistory: () => void;
}) {
  const bodyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sections;
    return sections.filter((s) => s.title.toLowerCase().includes(term) || (s.body ?? "").toLowerCase().includes(term));
  }, [sections, search]);

  // Focus + scroll to a section when arriving from a View-mode pencil click.
  useEffect(() => {
    if (!focusSection) return;
    const el = bodyRefs.current[focusSection];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    }
    onFocused();
  }, [focusSection]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
          <h3 className="text-sm font-bold text-foreground">Edit Rulebook</h3>
          {version ? <span className="text-xs text-muted-foreground">v{version}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules…" className="pl-8 h-9 w-44" data-testid="rulebook-search" />
          </div>
          <ModeToggle mode="edit" onChange={(m) => m === "view" && onView()} />
          <Button size="sm" variant="outline" onClick={onToggleHistory} data-testid="rulebook-history-toggle">
            <History className="w-4 h-4 mr-1.5" /> History
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={onSave} style={{ background: GOLD, color: "#1a1206" }} data-testid="rulebook-save">
            <Save className="w-4 h-4 mr-1.5" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Template action bar */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <span className="text-xs font-semibold text-foreground">
              {completeCount} of {total} sections complete
            </span>
            {missingTitles.length > 0 && (
              <span className="text-[11px] text-muted-foreground truncate">
                Missing: {missingTitles.join(", ")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={onUseTemplate} style={{ background: GOLD, color: "#1a1206" }} data-testid="rulebook-use-template">
              <FileText className="w-3.5 h-3.5 mr-1.5" /> Use Template
            </Button>
            <Button size="sm" variant="outline" onClick={onFillMissing} data-testid="rulebook-fill-missing">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Fill Missing Sections
            </Button>
            <Button size="sm" variant="outline" onClick={onImport} data-testid="rulebook-import">
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Import Existing Bylaws
            </Button>
            <Button size="sm" variant="outline" onClick={onSaveTemplate} data-testid="rulebook-save-template">
              <Bookmark className="w-3.5 h-3.5 mr-1.5" /> Save as Template
            </Button>
          </div>
        </div>
      </Card>

      {hasContent && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="text-xs" onClick={onView} data-testid="rulebook-done-editing">
            <Eye className="w-3.5 h-3.5 mr-1.5" /> Done — View Rulebook <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-3">
        {visible.map((s) => {
          const status = sectionStatus(s.body);
          const snippets = SECTION_TEMPLATES[s.key as RulebookSectionKey];
          return (
            <Card key={s.sectionId} className="p-4" data-testid={`rule-section-${s.key}`}>
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <input
                  value={s.title}
                  onChange={(e) => onUpdate(s.sectionId, { title: e.target.value })}
                  className="flex-1 min-w-0 bg-transparent text-sm font-bold text-foreground focus:outline-none border-b border-transparent focus:border-[#d4af37]/40"
                  data-testid={`rule-title-${s.key}`}
                />
                <StatusPill status={status} />
                {snippets && snippets.length > 0 && (
                  <button
                    onClick={() => onSnippet(s)}
                    title="Insert a template snippet"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-[#d4af37] hover:bg-[#d4af37]/10 transition-colors"
                    data-testid={`rule-template-${s.key}`}
                  >
                    <FileText className="w-3.5 h-3.5" /> Template
                  </button>
                )}
                <button
                  onClick={() => onUpdate(s.sectionId, { pinned: !s.pinned })}
                  title={s.pinned ? "Unpin" : "Pin"}
                  className={cn("p-1 rounded-md transition-colors", s.pinned ? "text-[#d4af37] bg-[#d4af37]/10" : "text-muted-foreground hover:text-foreground")}
                  data-testid={`rule-pin-${s.key}`}
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
              </div>
              <Textarea
                ref={(el: HTMLTextAreaElement | null) => { bodyRefs.current[s.sectionId] = el; }}
                value={s.body}
                onChange={(e) => onUpdate(s.sectionId, { body: e.target.value })}
                placeholder={`Document the ${s.title.toLowerCase()} rules…`}
                rows={3}
                data-testid={`rule-body-${s.key}`}
              />
            </Card>
          );
        })}
      </div>

      <Button variant="outline" size="sm" onClick={onAddSection} data-testid="rulebook-add-section">
        <Plus className="w-4 h-4 mr-1.5" /> Add Section
      </Button>
    </div>
  );
}

// ── Use Template modal ───────────────────────────────────────────────────────

function UseTemplateModal({
  templates, recommendedId, leagueData, onApply, onClose,
}: {
  templates: RulebookTemplate[];
  recommendedId: string;
  leagueData: LeaguePlaceholderData;
  onApply: (t: RulebookTemplate, mode: "fill" | "replace") => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(recommendedId);
  const [mode, setMode] = useState<"fill" | "replace">("fill");
  const [preview, setPreview] = useState(false);
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Use a Rulebook Template</DialogTitle>
          <DialogDescription>Pick a starting point. Placeholders like {"{{league_name}}"} are filled from your league where available.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-4 max-h-[55vh]">
          {/* Template list */}
          <div className="space-y-1.5 overflow-y-auto pr-1">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => { setSelectedId(t.id); setPreview(false); }}
                className={cn(
                  "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                  selectedId === t.id ? "border-[#d4af37]/50 bg-[#d4af37]/10" : "border-border/60 hover:bg-muted/40",
                )}
                data-testid={`template-option-${t.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground truncate">{t.name}</span>
                  {t.id === recommendedId && <span className="text-[9px] font-bold uppercase tracking-wide text-[#d4af37]">Suggested</span>}
                  {t.custom && <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Mine</span>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
              </button>
            ))}
          </div>

          {/* Detail / preview */}
          <div className="min-w-0 overflow-y-auto">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-bold text-foreground">{selected?.name}</h4>
              <button
                onClick={() => setPreview((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-[#d4af37]"
                data-testid="template-preview-toggle"
              >
                <Eye className="w-3.5 h-3.5" /> {preview ? "Hide preview" : "Preview"}
              </button>
            </div>
            {preview ? (
              <div className="space-y-2">
                {Object.entries(selected?.sections ?? {}).map(([key, body]) => (
                  <div key={key} className="rounded-md border border-border/50 p-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-0.5">{key.replace(/-/g, " ")}</p>
                    <p className="text-xs text-foreground/90 whitespace-pre-wrap">{applyPlaceholders(body, leagueData)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{selected?.description}</p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Apply mode */}
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={mode === "fill"} onChange={() => setMode("fill")} className="accent-[#d4af37]" data-testid="template-mode-fill" />
              Fill only empty sections
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-[#d4af37]" data-testid="template-mode-replace" />
              <span className={mode === "replace" ? "text-red-500 font-medium" : ""}>Replace all sections</span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!selected} onClick={() => selected && onApply(selected, mode)} style={{ background: GOLD, color: "#1a1206" }} data-testid="template-apply">
              <Check className="w-4 h-4 mr-1.5" /> Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Per-section snippet modal ────────────────────────────────────────────────

function SectionSnippetModal({
  section, snippets, leagueData, onApply, onClose,
}: {
  section: BylawSection;
  snippets: SectionSnippet[];
  leagueData: LeaguePlaceholderData;
  onApply: (s: SectionSnippet) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{section.title} — Templates</DialogTitle>
          <DialogDescription>Insert a ready-made snippet for this section. It replaces this section's text only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {snippets.map((snip) => (
            <button
              key={snip.id}
              onClick={() => onApply(snip)}
              className="w-full text-left rounded-lg border border-border/60 p-3 hover:border-[#d4af37]/50 hover:bg-[#d4af37]/5 transition-colors"
              data-testid={`snippet-${snip.id}`}
            >
              <p className="text-[13px] font-semibold text-foreground mb-0.5">{snip.label}</p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{applyPlaceholders(snip.body, leagueData)}</p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Import existing bylaws modal ─────────────────────────────────────────────

function ImportBylawsModal({
  onImport, onClose,
}: { onImport: (text: string, mode: "fill" | "replace") => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"fill" | "replace">("fill");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Existing Bylaws</DialogTitle>
          <DialogDescription>
            Paste your current rulebook. Lines that match a section name (e.g. "Scoring", "Trades", "Playoffs") become headings and the text below them is assigned to that section.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Scoring\nFull PPR...\n\nTrades\nTrades close week 12...\n\nPlayoffs\nTop 6 teams..."}
          rows={12}
          data-testid="import-bylaws-text"
        />
        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={mode === "fill"} onChange={() => setMode("fill")} className="accent-[#d4af37]" />
              Fill only empty sections
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-[#d4af37]" />
              <span className={mode === "replace" ? "text-red-500 font-medium" : ""}>Replace matched sections</span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!text.trim()} onClick={() => onImport(text, mode)} style={{ background: GOLD, color: "#1a1206" }} data-testid="import-bylaws-apply">
              <Upload className="w-4 h-4 mr-1.5" /> Import
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Save-as-template modal ───────────────────────────────────────────────────

function SaveTemplateModal({
  onSave, onClose,
}: { onSave: (name: string, description: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
          <DialogDescription>Save this rulebook as a reusable template you can apply to your other leagues.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Template name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Dynasty Standard" className="mt-1" data-testid="save-template-name" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Description (optional)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short note about this template" className="mt-1" data-testid="save-template-desc" />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!name.trim()} onClick={() => onSave(name, description)} style={{ background: GOLD, color: "#1a1206" }} data-testid="save-template-confirm">
            <Bookmark className="w-4 h-4 mr-1.5" /> Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bylaws parser (heading detection) ────────────────────────────────────────

const HEADING_SYNONYMS: { key: RulebookSectionKey; words: string[] }[] = [
  { key: "league-setup", words: ["league setup", "setup", "general", "overview", "league info", "about"] },
  { key: "scoring", words: ["scoring", "points", "scoring settings"] },
  { key: "rosters", words: ["rosters", "roster", "roster settings"] },
  { key: "lineups", words: ["lineups", "lineup", "starting lineup"] },
  { key: "trades", words: ["trades", "trade", "trading", "trade rules"] },
  { key: "waivers", words: ["waivers", "waiver", "free agency", "faab", "free agents"] },
  { key: "tanking", words: ["tanking", "anti-tanking", "anti tanking", "integrity"] },
  { key: "playoffs", words: ["playoffs", "playoff", "postseason"] },
  { key: "draft-picks", words: ["draft picks", "draft", "draft order", "rookie draft", "picks"] },
  { key: "payments", words: ["payments", "payment", "dues", "buy-in", "buy in", "fees"] },
  { key: "payouts", words: ["payouts", "payout", "prizes", "winnings"] },
  { key: "orphans", words: ["orphans", "orphan", "abandoned teams", "new managers"] },
  { key: "commissioner-powers", words: ["commissioner powers", "commissioner", "commish", "powers", "governance"] },
];

function detectHeading(line: string): RulebookSectionKey | null {
  const norm = line.trim().toLowerCase().replace(/^[#*\d.\-)\s]+/, "").replace(/[:\-–—\s]+$/, "").trim();
  if (!norm || norm.length > 40) return null;
  for (const { key, words } of HEADING_SYNONYMS) {
    if (words.some((w) => norm === w)) return key;
  }
  // Looser: heading-ish short line that starts with a known word.
  for (const { key, words } of HEADING_SYNONYMS) {
    if (words.some((w) => norm.startsWith(w))) return key;
  }
  return null;
}

function parseBylaws(text: string): Partial<Record<RulebookSectionKey, string>> {
  const out: Partial<Record<RulebookSectionKey, string>> = {};
  let current: RulebookSectionKey | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const heading = detectHeading(rawLine);
    if (heading) { current = heading; if (out[current] == null) out[current] = ""; continue; }
    if (current) {
      out[current] = (out[current] ? out[current] + "\n" : "") + rawLine;
    }
  }
  // Trim each captured section.
  for (const k of Object.keys(out) as RulebookSectionKey[]) {
    out[k] = (out[k] ?? "").trim();
    if (!out[k]) delete out[k];
  }
  return out;
}

function HistoryPanel({ versions: raw, loading }: { versions: BylawVersion[]; loading: boolean }) {
  const versions = [...raw].reverse();
  return (
    <Card className="p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Version History</p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No versions saved yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li key={v.version} className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">v{v.version}</span>
              <span className="text-muted-foreground">{v.savedAt ? new Date(v.savedAt).toLocaleString() : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
