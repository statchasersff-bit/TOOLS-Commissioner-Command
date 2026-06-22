/**
 * Rulebook / Bylaws — a searchable, versioned league rulebook with template
 * support so commissioners don't type every section from scratch.
 *
 * Sections seed from a default set, can be filled from full rulebook templates
 * or per-section snippets, support {{placeholder}} substitution from league
 * data, and never overwrite manual text unless the user picks "Replace all".
 * Each save bumps the version; history is viewable.
 */
import { useMemo, useState } from "react";
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
import { BookOpen, Search, Pin, History, Save, Plus, FileText, Sparkles, Upload, Bookmark, Eye, Check } from "lucide-react";
import { rulebookApi, type BylawSection } from "@/lib/leagueProfileApi";
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

export function LeagueRulebook({ leagueId, league }: { leagueId: string; league?: League | null }) {
  const { toast } = useToast();
  const sleeper = useSleeper();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<BylawSection[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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

  const sections: BylawSection[] = draft ?? (q.data?.sections?.length ? q.data.sections : seedSections());

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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = [...sections].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
    if (!term) return list;
    return list.filter((s) => s.title.toLowerCase().includes(term) || (s.body ?? "").toLowerCase().includes(term));
  }, [sections, search]);

  // Completion summary (over the standard rulebook sections present).
  const completeCount = sections.filter((s) => sectionStatus(s.body) === "complete").length;
  const emptySections = sections.filter((s) => sectionStatus(s.body) === "empty");

  if (q.isLoading) return <Card className="p-8 text-center text-sm text-muted-foreground">Loading rulebook…</Card>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-[3px] h-4 rounded-full bg-[#d4af37]" />
          <h3 className="text-sm font-bold text-foreground">Rulebook</h3>
          {q.data?.currentVersion ? <span className="text-xs text-muted-foreground">v{q.data.currentVersion}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules…" className="pl-8 h-9 w-44" data-testid="rulebook-search" />
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowHistory((v) => !v)} data-testid="rulebook-history-toggle">
            <History className="w-4 h-4 mr-1.5" /> History
          </Button>
          <Button size="sm" disabled={!dirty || saveMut.isPending} onClick={() => saveMut.mutate()} style={{ background: GOLD, color: "#1a1206" }} data-testid="rulebook-save">
            <Save className="w-4 h-4 mr-1.5" /> {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Template action bar */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Completion summary */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <span className="text-xs font-semibold text-foreground">
              {completeCount} of {sections.length} sections complete
            </span>
            {emptySections.length > 0 && (
              <span className="text-[11px] text-muted-foreground truncate">
                Missing: {emptySections.map((s) => s.title).join(", ")}
              </span>
            )}
          </div>
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => setTemplateModal({ mode: "choose" })} style={{ background: GOLD, color: "#1a1206" }} data-testid="rulebook-use-template">
              <FileText className="w-3.5 h-3.5 mr-1.5" /> Use Template
            </Button>
            <Button size="sm" variant="outline" onClick={fillMissing} data-testid="rulebook-fill-missing">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Fill Missing Sections
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportModal(true)} data-testid="rulebook-import">
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Import Existing Bylaws
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSaveTplModal(true)} data-testid="rulebook-save-template">
              <Bookmark className="w-3.5 h-3.5 mr-1.5" /> Save as Template
            </Button>
          </div>
        </div>
      </Card>

      {showHistory && <HistoryPanel leagueId={leagueId} />}

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
                  onChange={(e) => update(s.sectionId, { title: e.target.value })}
                  className="flex-1 min-w-0 bg-transparent text-sm font-bold text-foreground focus:outline-none border-b border-transparent focus:border-[#d4af37]/40"
                  data-testid={`rule-title-${s.key}`}
                />
                <StatusPill status={status} />
                {snippets && snippets.length > 0 && (
                  <button
                    onClick={() => setSnippetFor(s)}
                    title="Insert a template snippet"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-[#d4af37] hover:bg-[#d4af37]/10 transition-colors"
                    data-testid={`rule-template-${s.key}`}
                  >
                    <FileText className="w-3.5 h-3.5" /> Template
                  </button>
                )}
                <button
                  onClick={() => update(s.sectionId, { pinned: !s.pinned })}
                  title={s.pinned ? "Unpin" : "Pin"}
                  className={cn("p-1 rounded-md transition-colors", s.pinned ? "text-[#d4af37] bg-[#d4af37]/10" : "text-muted-foreground hover:text-foreground")}
                  data-testid={`rule-pin-${s.key}`}
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
              </div>
              <Textarea
                value={s.body}
                onChange={(e) => update(s.sectionId, { body: e.target.value })}
                placeholder={`Document the ${s.title.toLowerCase()} rules…`}
                rows={3}
                data-testid={`rule-body-${s.key}`}
              />
            </Card>
          );
        })}
      </div>

      <Button variant="outline" size="sm" onClick={addSection} data-testid="rulebook-add-section">
        <Plus className="w-4 h-4 mr-1.5" /> Add Section
      </Button>

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

function HistoryPanel({ leagueId }: { leagueId: string }) {
  const q = useQuery({ queryKey: ["bylaws-history", leagueId], queryFn: () => rulebookApi.history(leagueId) });
  const versions = [...(q.data?.versions ?? [])].reverse();
  return (
    <Card className="p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Version History</p>
      {q.isLoading ? (
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
