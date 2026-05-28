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
import {
  ArrowLeft,
  BarChart3,
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
  const { dynastySource, redraftSource, dynastyCustom, redraftCustom, isLoading } =
    useValueModel();
  const { status } = useAuth();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const anyCustom = dynastySource === "custom" || redraftSource === "custom";
  const labelText = anyCustom ? "Custom" : "FC";

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

          <SourceRow
            title="Dynasty"
            source={dynastySource}
            custom={dynastyCustom}
            onUpload={() => openManager("dynasty")}
          />
          <DropdownMenuSeparator />
          <SourceRow
            title="Redraft"
            source={redraftSource}
            custom={redraftCustom}
            onUpload={() => openManager("redraft")}
          />

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openManager()} data-testid="menu-manage-values">
            <Upload className="w-3.5 h-3.5 mr-2" /> Change value sources
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

function SourceRow({
  title,
  source,
  custom,
  onUpload,
}: {
  title: string;
  source: "custom" | "fantasycalc";
  custom: ReturnType<typeof useValueModel>["dynastyCustom"];
  onUpload: () => void;
}) {
  return (
    <div className="px-2 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title} value source
        </span>
        <Badge
          className={
            source === "custom"
              ? "text-[10px] bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30"
              : "text-[10px] bg-[#0b3a7a]/10 text-blue-300 border border-blue-500/20"
          }
        >
          {source === "custom" ? "Custom" : "FantasyCalc"}
        </Badge>
      </div>
      {source === "custom" && custom.name && (
        <div className="text-[10px] text-muted-foreground leading-tight">
          <div className="text-foreground/80 font-medium truncate">{custom.name}</div>
          <div>
            {custom.matchedCount} matched · {custom.unmatchedCount} unmatched
            {custom.updatedAt && ` · ${formatDate(custom.updatedAt)}`}
          </div>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-full h-7 text-[10px]"
        onClick={onUpload}
        data-testid={`btn-manage-${title.toLowerCase()}`}
      >
        <Upload className="w-3 h-3 mr-1.5" /> Upload {title.toLowerCase()} CSV
      </Button>
    </div>
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

// ── Full-page manager (rendered inside the app shell at /value-sources) ───────
export function ValueSourcePage({ embedded = false }: { embedded?: boolean }) {
  const [, setLocation] = useLocation();
  const { refreshCustomValues } = useValueModel();
  const [tab, setTab] = useState<ValueType>(() => {
    try {
      return new URLSearchParams(window.location.search).get("type") === "redraft"
        ? "redraft"
        : "dynasty";
    } catch {
      return "dynasty";
    }
  });

  return (
    <div className={cn(!embedded && "min-h-screen bg-background", "text-foreground")}>
      {/* Breadcrumb/back bar — non-sticky when embedded; the shell header is the
          sticky chrome there (mirrors the player/manager profile pages). */}
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
        <span className="text-xs font-semibold text-foreground/80 truncate">Value Sources</span>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-[#d4af37]">
          Value Source Manager
        </span>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Upload your own dynasty or redraft values. Custom values override FantasyCalc anywhere
          player values are used. Missing players fall back to FantasyCalc.
        </p>

        {/* Tab bar */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.03] border border-white/6 w-fit">
          {(["dynasty", "redraft"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all " +
                (tab === t
                  ? "bg-[#0b3a7a]/60 text-white border border-[#d4af37]/25"
                  : "text-white/40 hover:text-white/70")
              }
              data-testid={`vs-tab-${t}`}
            >
              {t === "dynasty" ? "Dynasty Values" : "Redraft Values"}
            </button>
          ))}
        </div>

        <UploadSection valueType={tab} onChanged={refreshCustomValues} />
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
  const { dynastyCustom, redraftCustom } = useValueModel();
  const currentCustom = valueType === "dynasty" ? dynastyCustom : redraftCustom;

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
      setName((body.totalRows ? `Custom ${valueType} (${new Date().toLocaleDateString()})` : ""));
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
          name: name || `Custom ${valueType} values`,
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
    a.download = `${valueType}-unmatched.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3 pt-2">
      {/* Current status */}
      <Card className="p-3 text-xs space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Currently using</span>
          <Badge
            className={
              currentCustom.active
                ? "text-[10px] bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30"
                : "text-[10px] bg-[#0b3a7a]/10 text-blue-300 border border-blue-500/20"
            }
          >
            {currentCustom.active ? "Custom" : "FantasyCalc Default"}
          </Badge>
        </div>
        {currentCustom.active && (
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <div>{currentCustom.name}</div>
            <div>
              {currentCustom.matchedCount} players matched · {currentCustom.unmatchedCount} unmatched ·{" "}
              {currentCustom.updatedAt ? formatDate(currentCustom.updatedAt) : ""}
            </div>
            <button
              onClick={handleReset}
              className="text-[11px] text-muted-foreground underline hover:text-foreground"
              disabled={busy}
              data-testid={`btn-reset-${valueType}`}
            >
              Reset to FantasyCalc
            </button>
          </div>
        )}
      </Card>

      {/* CSV format help */}
      <div className="text-[11px] text-muted-foreground leading-relaxed">
        Upload a CSV with at least <code className="text-foreground">player_name</code> and{" "}
        <code className="text-foreground">value</code> columns. Optional columns:{" "}
        <code className="text-foreground">position</code>,<code className="text-foreground">team</code>,{" "}
        <code className="text-foreground">player_id</code>.
      </div>

      {/* File picker */}
      <div className="flex items-center gap-2">
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
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          variant="outline"
          size="sm"
          data-testid={`btn-choose-${valueType}`}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
          Choose CSV
        </Button>
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
                  <th className="text-left px-2 py-1">Player</th>
                  <th className="text-left px-2 py-1">Pos</th>
                  <th className="text-left px-2 py-1">Team</th>
                  <th className="text-right px-2 py-1">Value</th>
                  <th className="text-left px-2 py-1">Match</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r) => (
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
              placeholder={`Custom ${valueType} values`}
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
            Your {valueType} sets
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
