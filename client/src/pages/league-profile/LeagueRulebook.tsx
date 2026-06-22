/**
 * Rulebook / Bylaws — a searchable, versioned league rulebook. Sections are
 * seeded from a sensible default set on first use, edited inline, pinned, and
 * saved as a new version (full snapshot stored server-side). Each save bumps the
 * version; history is viewable.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BookOpen, Search, Pin, History, Save, Plus } from "lucide-react";
import { rulebookApi, type BylawSection } from "@/lib/leagueProfileApi";

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

export function LeagueRulebook({ leagueId }: { leagueId: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<BylawSection[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const q = useQuery({
    queryKey: ["bylaws", leagueId],
    queryFn: () => rulebookApi.get(leagueId),
  });

  const sections: BylawSection[] = draft ?? (q.data?.sections?.length ? q.data.sections : seedSections());

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
    setDraft(sections.map(s => (s.sectionId === id ? { ...s, ...patch } : s)));
    setDirty(true);
  };

  const addSection = () => {
    const id = `custom-${Date.now()}`;
    setDraft([...sections, { sectionId: id, key: id, title: "New Section", body: "", pinned: false, order: sections.length, notes: [] }]);
    setDirty(true);
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = [...sections].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
    if (!term) return list;
    return list.filter(s => s.title.toLowerCase().includes(term) || (s.body ?? "").toLowerCase().includes(term));
  }, [sections, search]);

  if (q.isLoading) return <Card className="p-8 text-center text-sm text-muted-foreground">Loading rulebook…</Card>;

  return (
    <div className="space-y-4">
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
          <Button size="sm" variant="outline" onClick={() => setShowHistory(v => !v)} data-testid="rulebook-history-toggle">
            <History className="w-4 h-4 mr-1.5" /> History
          </Button>
          <Button size="sm" disabled={!dirty || saveMut.isPending} onClick={() => saveMut.mutate()} style={{ background: "#d4af37", color: "#1a1206" }} data-testid="rulebook-save">
            <Save className="w-4 h-4 mr-1.5" /> {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {showHistory && <HistoryPanel leagueId={leagueId} />}

      <div className="space-y-3">
        {visible.map((s) => (
          <Card key={s.sectionId} className="p-4" data-testid={`rule-section-${s.key}`}>
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <input
                value={s.title}
                onChange={(e) => update(s.sectionId, { title: e.target.value })}
                className="flex-1 bg-transparent text-sm font-bold text-foreground focus:outline-none border-b border-transparent focus:border-[#d4af37]/40"
                data-testid={`rule-title-${s.key}`}
              />
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
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addSection} data-testid="rulebook-add-section">
        <Plus className="w-4 h-4 mr-1.5" /> Add Section
      </Button>
    </div>
  );
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
