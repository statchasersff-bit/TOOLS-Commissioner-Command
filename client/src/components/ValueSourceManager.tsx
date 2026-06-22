import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useValueModel } from "@/contexts/ValueModelContext";
import { useAuth } from "@/contexts/AuthContext";
import { scAuthFetch } from "@/lib/scAuthFetch";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableTh } from "@/components/SortableTh";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Download,
} from "lucide-react";

type ValueType = "dynasty" | "redraft";

interface PreviewSampleRow {
  rowIndex: number;
  playerName: string;
  position: string | null;
  team: string | null;
  value: number | null;
  matched: boolean;
  matchMethod: string | null;
  invalidReason: string | null;
}

interface PreviewResponse {
  token: string;
  valueType: ValueType;
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  invalidCount: number;
  duplicateCount: number;
  matchRate: number;
  sample: PreviewSampleRow[];
  unmatchedSample: PreviewSampleRow[];
  invalidSample: PreviewSampleRow[];
}

// ── Header dropdown ──────────────────────────────────────────────────────────
export function ValueSourceManager() {
  const { sourceId, sources, setSourceId, dynastySource, redraftSource, isLoading } =
    useValueModel();
  const { status } = useAuth();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const anyCustom = dynastySource === "custom" || redraftSource === "custom";
  const labelText = anyCustom ? "Custom" : sourceId === "ktc" ? "KTC" : "FC";
  // Live base sources, switchable straight from this menu.
  const baseSources = sources.filter((s) => s.id !== "custom" && s.active);

  // Open the value-source manager as a full page inside the app shell (mirrors
  // how player/manager profiles open) rather than a modal overlay.
  const openManager = (type?: ValueType) => {
    setMenuOpen(false);
    setLocation(type ? `/value-sources?type=${type}` : "/value-sources");
  };

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
          <button
            data-testid="header-value-source-trigger"
            className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold tracking-wide bg-[#0b3a7a]/6 dark:bg-[#0b3a7a]/25 border border-[#d4af37]/20 dark:border-[#d4af37]/20 text-[#d4af37]/85 hover:border-[#d4af37]/60 hover:text-[#d4af37] transition-colors cursor-pointer select-none"
            aria-label="Value source"
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <BarChart3 className="w-3 h-3" />
            )}
            <span>{labelText}</span>
            <ChevronDown className="w-3 h-3 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs">Value Source Manager</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {baseSources.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => setSourceId(s.id)}
              data-testid={`menu-source-${s.id}`}
              className="gap-2 text-xs"
            >
              <Check className={cn("w-3.5 h-3.5 shrink-0", s.id === sourceId ? "text-[#d4af37]" : "opacity-0")} />
              <span className="flex-1">{s.label}</span>
              {s.id === sourceId && <span className="text-[10px] font-semibold text-[#d4af37]">Active</span>}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openManager()} data-testid="menu-manage-values">
            <Upload className="w-3.5 h-3.5 mr-2" /> Upload Custom Values
          </DropdownMenuItem>
          {status !== "ready" && (
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
              Sign in to upload custom values.
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

// Base (online) value-source picker for the full /value-sources page. Lists every
// registered source (FantasyCalc, KeepTradeCut, plus "soon" placeholders). Custom
// uploads handled by UploadSection below override whichever base source is active.
function BaseSourceSection() {
  const { sourceId, sources, setSourceId, isLoading } = useValueModel();
  // Only live sources — "custom" is the dedicated upload section below, and
  // not-yet-available sources are hidden rather than shown as "coming soon".
  const baseSources = sources.filter((s) => s.id !== "custom" && s.active);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-[#d4af37]" />
        <h2 className="text-sm font-bold text-foreground">Base value source</h2>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#d4af37]" />}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Powers rankings, the trade calculator, and portfolio. Custom uploads below override these per player.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {baseSources.map((s) => {
          const selected = s.id === sourceId;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setSourceId(s.id)}
              data-testid={`base-source-${s.id}`}
              className={cn(
                "text-left rounded-lg border p-3 transition-colors",
                selected
                  ? "border-[#d4af37]/60 bg-[#d4af37]/10"
                  : "border-border hover:border-[#d4af37]/40 hover:bg-muted/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-foreground">{s.label}</span>
                {selected && (
                  <Badge className="text-[10px] bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30">Active</Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug mt-1">{s.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Full-page manager (rendered inside the app shell at /value-sources) ───────
export function ValueSourcePage({ embedded = false }: { embedded?: boolean }) {
  const [, setLocation] = useLocation();
  const { refreshCustomValues } = useValueModel();

  return (
    <div className={cn(!embedded && "min-h-screen bg-background", "text-foreground")}>
      {/* Back bar — non-sticky when embedded; the shell header is the sticky
          chrome there (mirrors the player/manager profile pages). */}
      <div
        className={cn(
          "h-12 flex items-center gap-3 px-4 border-b border-border/60",
          !embedded && "sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75",
        )}
      >
        <button
          onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation("/"); }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          data-testid="value-sources-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Title */}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Value Sources</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage the value sources used across Commissioner Command.
          </p>
        </div>

        <BaseSourceSection />

        <div className="border-t border-border/60" />

        <UploadSection valueType="dynasty" onChanged={refreshCustomValues} />
      </div>
    </div>
  );
}

function UploadSection({ valueType, onChanged }: { valueType: ValueType; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [name, setName] = useState<string>("");
  const [activeSets, setActiveSets] = useState<any[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const { sourceId, dynastyCustom, redraftCustom } = useValueModel();
  const currentCustom = valueType === "dynasty" ? dynastyCustom : redraftCustom;
  // The base source custom values fall back to when a player isn't in the upload.
  const baseLabel = sourceId === "ktc" ? "KeepTradeCut" : "FantasyCalc";

  // Sortable preview sample table. Keeps default (file) order until a header is clicked.
  const { sorted: sortedSample, sortKey, sortDir, toggle } = useSortableTable<PreviewSampleRow>(
    preview?.sample ?? [],
    {
      playerName: (r) => r.playerName,
      position: (r) => r.position,
      team: (r) => r.team,
      value: (r) => r.value,
      match: (r) => (r.matched ? r.matchMethod ?? "matched" : "unmatched"),
    },
  );

  const refreshSets = async () => {
    try {
      const r = await scAuthFetch("/api/values/custom/sets");
      if (r.ok) {
        const body = await r.json();
        setActiveSets(body.sets || []);
      }
    } catch {}
  };

  useEffect(() => { void refreshSets(); }, [valueType]);

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > 4 * 1024 * 1024) {
      setError("File too large (max 4MB).");
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".csv") && file.type !== "text/csv" && file.type !== "text/plain" && file.type !== "") {
      setError("Please upload a CSV file.");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const r = await scAuthFetch("/api/values/custom/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, valueType }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error || `Preview failed (${r.status})`);
      setPreview(body as PreviewResponse);
      setName((body.totalRows ? `Custom values (${new Date().toLocaleDateString()})` : ""));
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await scAuthFetch("/api/values/custom/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: preview.token,
          valueType,
          name: name || "Custom values",
          activate: true,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error || `Save failed (${r.status})`);
      setPreview(null);
      onChanged();
      await refreshSets();
    } catch (err: any) {
      setError(err.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await scAuthFetch("/api/values/custom/deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valueType }),
      });
      if (!r.ok) throw new Error("Failed to reset");
      onChanged();
      await refreshSets();
    } catch (err: any) {
      setError(err.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const csv = [
      "player_name,position,team,value,player_id",
      "Ja'Marr Chase,WR,CIN,9999,",
      "Bijan Robinson,RB,ATL,9650,",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "value-source-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadUnmatched = () => {
    if (!preview) return;
    const header = "player_name,position,team,value,reason\n";
    const lines = preview.unmatchedSample
      .map((r) =>
        [r.playerName, r.position ?? "", r.team ?? "", r.value ?? "", "unmatched"]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([header + lines], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "unmatched-players.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3 pt-2">
      {/* Current Source */}
      <Card className="p-4 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Current Source</span>
          {currentCustom.active && (
            <button
              onClick={handleReset}
              disabled={busy}
              className="text-[11px] text-muted-foreground underline hover:text-foreground disabled:opacity-50"
              data-testid={`btn-reset-${valueType}`}
            >
              Reset to {baseLabel}
            </button>
          )}
        </div>
        {currentCustom.active ? (
          <>
            <div className="text-sm font-bold text-foreground">{currentCustom.name || "Custom values"}</div>
            <div className="text-[11px] text-muted-foreground">
              {currentCustom.updatedAt ? `Uploaded ${formatDate(currentCustom.updatedAt)} · ` : ""}
              {currentCustom.matchedCount.toLocaleString()} players
              {currentCustom.unmatchedCount ? ` · ${currentCustom.unmatchedCount.toLocaleString()} unmatched` : ""}
            </div>
            <div className="text-[11px] text-muted-foreground">Missing players fall back to {baseLabel}.</div>
          </>
        ) : (
          <>
            <div className="text-sm font-bold text-foreground">{baseLabel} Default</div>
            <div className="text-[11px] text-muted-foreground">No custom value file is currently active.</div>
          </>
        )}
      </Card>

      {/* Upload custom values */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Upload Custom Values</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadTemplate}
            className="h-7 text-[11px]"
            data-testid={`btn-template-${valueType}`}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" /> Download CSV Template
          </Button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
          data-testid={`file-input-${valueType}`}
        />

        {/* Dropzone */}
        <div
          onClick={() => { if (!busy) fileRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) fileRef.current?.click(); }}
          data-testid={`dropzone-${valueType}`}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors",
            dragOver
              ? "border-[#d4af37]/60 bg-[#d4af37]/5"
              : "border-border/60 hover:border-border/80 bg-muted/10 hover:bg-muted/20",
          )}
        >
          {busy ? (
            <Loader2 className="w-6 h-6 text-[#d4af37] animate-spin" />
          ) : (
            <Upload className="w-6 h-6 text-muted-foreground" />
          )}
          <div className="text-sm font-semibold text-foreground">Drag and drop your CSV here</div>
          <div className="text-[11px] text-muted-foreground">or choose a file from your computer</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
            data-testid={`btn-choose-${valueType}`}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Choose CSV
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          CSV needs at least <code className="text-foreground">player_name</code> and{" "}
          <code className="text-foreground">value</code> columns. Optional:{" "}
          <code className="text-foreground">position</code>, <code className="text-foreground">team</code>,{" "}
          <code className="text-foreground">player_id</code>.
        </p>

        {preview && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreview(null)}
            data-testid={`btn-cancel-${valueType}`}
          >
            Cancel preview
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Preview block */}
      {preview && (
        <div className="space-y-2 rounded-md border border-border/50 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold">Preview</div>
            <div className="text-[11px] text-muted-foreground">
              {preview.totalRows} rows · {preview.matchRate}% match rate
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Stat label="Matched" value={preview.matchedCount} tone="good" />
            <Stat label="Unmatched" value={preview.unmatchedCount} tone="warn" />
            <Stat label="Invalid" value={preview.invalidCount} tone={preview.invalidCount > 0 ? "warn" : undefined} />
            <Stat label="Duplicates" value={preview.duplicateCount} />
          </div>

          {preview.unmatchedCount > 0 && (
            <button
              onClick={downloadUnmatched}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline hover:text-foreground"
              data-testid={`btn-download-unmatched-${valueType}`}
            >
              <Download className="w-3 h-3" /> Download unmatched list
            </button>
          )}

          <div className="text-[11px] font-semibold mt-1">First {preview.sample.length} rows</div>
          <div className="max-h-48 overflow-y-auto rounded border border-border/40">
            <table className="w-full text-[10px]">
              <thead className="text-muted-foreground/70 bg-white/[0.02] sticky top-0">
                <tr>
                  <SortableTh sortKey="playerName" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="text-left px-2 py-1">Player</SortableTh>
                  <SortableTh sortKey="position" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="text-left px-2 py-1">Pos</SortableTh>
                  <SortableTh sortKey="team" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="text-left px-2 py-1">Team</SortableTh>
                  <SortableTh sortKey="value" activeKey={sortKey} dir={sortDir} onSort={toggle} align="right" className="text-right px-2 py-1">Value</SortableTh>
                  <SortableTh sortKey="match" activeKey={sortKey} dir={sortDir} onSort={toggle} align="left" className="text-left px-2 py-1">Match</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedSample.map((r) => (
                  <tr key={r.rowIndex} className="border-t border-border/20">
                    <td className="px-2 py-1">{r.playerName}</td>
                    <td className="px-2 py-1">{r.position ?? "—"}</td>
                    <td className="px-2 py-1">{r.team ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.value ?? "—"}</td>
                    <td className="px-2 py-1">
                      {r.matched ? (
                        <span className="text-emerald-400">{r.matchMethod}</span>
                      ) : (
                        <span className="text-amber-400">unmatched</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Custom values"
              className="h-8 text-xs"
              data-testid={`input-name-${valueType}`}
            />
            <Button onClick={handleConfirm} disabled={busy} size="sm" data-testid={`btn-confirm-${valueType}`}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
              Save &amp; activate
            </Button>
          </div>
        </div>
      )}

      {/* Existing sets */}
      {activeSets.filter((s) => s.valueType === valueType).length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Saved value sets
          </div>
          <div className="space-y-1">
            {activeSets.filter((s: any) => s.valueType === valueType).map((s: any) => (
              <SetRow key={s.id} set={s} onChanged={async () => { await refreshSets(); onChanged(); }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : "text-foreground";
  return (
    <div className="rounded-md border border-border/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function SetRow({ set, onChanged }: { set: any; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const activate = async () => {
    setBusy(true);
    try {
      await scAuthFetch(`/api/values/custom/sets/${set.id}/activate`, { method: "POST" });
      await onChanged();
    } finally { setBusy(false); }
  };
  const del = async () => {
    if (!confirm(`Delete "${set.name}"?`)) return;
    setBusy(true);
    try {
      await scAuthFetch(`/api/values/custom/sets/${set.id}`, { method: "DELETE" });
      await onChanged();
    } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-2 py-1.5 text-[11px]">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{set.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {set.matchedRows} matched · {set.matchRate}% · {formatDate(set.updatedAt)}
        </div>
      </div>
      {set.isActive ? (
        <Badge className="text-[10px] bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30">Active</Badge>
      ) : (
        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={activate} disabled={busy}>
          Activate
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={del} disabled={busy} title="Delete">
        <Trash2 className="w-3 h-3 text-muted-foreground hover:text-red-400" />
      </Button>
    </div>
  );
}
