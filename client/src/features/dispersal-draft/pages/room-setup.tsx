import { useState, useCallback, useEffect } from "react";
import { useParams, useSearch, useLocation, Link } from "@dispersal/router";
import { Home, Lock, Unlock, ArrowRight, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useGetDraftRoom, getGetDraftRoomQueryKey,
  useCreateAsset, useImportAssetsFromCsv, useListAssets, getListAssetsQueryKey,
  useStartDraft, useUpdateDraftRoom, useDeleteDraftRoom
} from "@dispersal/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useDraftRoomState } from "@dispersal/hooks/use-draft-room-state";
import { useDraftSocket } from "@dispersal/hooks/use-draft-socket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import SleeperImport from "@dispersal/components/sleeper-import";
import { sleeperThumb, sleeperTeamLogo, positionColor } from "@dispersal/lib/sleeper";
import { PickBadgeGroup } from "@dispersal/components/pick-badge";
import { PlayerSearchInput } from "@dispersal/components/player-search-input";

type WizardMode = "choice" | "sleeper" | "manual";
type ManualStep = "settings" | "assets" | "managers" | "review";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
];

function PauseWindowFields({ form }: { form: ReturnType<typeof import("react-hook-form").useForm<z.infer<typeof settingsSchema>>> }) {
  const enabled = form.watch("dailyPauseEnabled");
  return (
    <div className="border border-border/40 rounded-sm p-3 space-y-3 bg-background/50">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="accent-primary w-3.5 h-3.5"
          checked={enabled}
          onChange={e => form.setValue("dailyPauseEnabled", e.target.checked)}
        />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">🌙 Overnight Quiet Hours</span>
      </label>
      {enabled && (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The pick clock won't run during these hours. Great for multi-day drafts.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FormField control={form.control} name="dailyPauseStart" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Pause At</FormLabel>
                <FormControl>
                  <Input type="time" className="bg-background border-border/50" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="dailyPauseEnd" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Resume At</FormLabel>
                <FormControl>
                  <Input type="time" className="bg-background border-border/50" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
          <FormField control={form.control} name="pauseTimezone" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Timezone</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="bg-background border-border/50"><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TIMEZONES.map(tz => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>
      )}
    </div>
  );
}

const createAssetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["Player", "Rookie Pick", "Future Pick", "FAAB"]),
  position: z.string().optional(),
  team: z.string().optional(),
  notes: z.string().optional()
});

const settingsSchema = z.object({
  leagueName: z.string().min(1, "League name is required"),
  numOrphanSlots: z.number().int().min(2).max(32),
  draftFormat: z.enum(["snake", "linear", "3rr"]),
  timeBankMinutes: z.number().int().min(0).max(300),
  dailyPauseEnabled: z.boolean(),
  dailyPauseStart: z.string(),
  dailyPauseEnd: z.string(),
  pauseTimezone: z.string(),
  commissionerName: z.string().min(1, "Commissioner name is required")
});

const SLEEPER_STEPS = ["Connect Sleeper", "Select League", "Select Orphans", "Review & Share"];
const MANUAL_STEPS = ["Room Settings", "Assets", "Managers", "Review"];

function sleeperStepToIndex(stepName: string, phase: "import" | "review"): number {
  if (phase === "review") return 3;
  const map: Record<string, number> = { username: 0, leagues: 1, orphans: 2, importing: 2 };
  return map[stepName] ?? 0;
}
function manualStepToIndex(step: ManualStep): number {
  return (["settings", "assets", "managers", "review"] as ManualStep[]).indexOf(step);
}

function ProgressBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center mb-8">
      {steps.map((label, i) => (
        <span key={label} className="contents">
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border-2 flex-shrink-0 transition-all ${
              i < current
                ? "bg-primary border-primary text-background"
                : i === current
                ? "border-primary text-primary bg-primary/10"
                : "border-border/40 text-muted-foreground"
            }`}>
              {i < current ? "✓" : i + 1}
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-wider mt-1 whitespace-nowrap hidden sm:block transition-colors ${
              i <= current ? "text-primary" : "text-muted-foreground/60"
            }`}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mx-2 mb-3 transition-colors ${i < current ? "bg-primary" : "bg-border/40"}`} />
          )}
        </span>
      ))}
    </div>
  );
}

export default function RoomSetup() {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { commissionerToken } = useDraftRoomState(code);

  const { data: detail, isLoading } = useGetDraftRoom(code, {
    query: { enabled: !!code, queryKey: getGetDraftRoomQueryKey(code) }
  });
  const { data: assets } = useListAssets(detail?.room?.id || 0, {}, {
    query: { enabled: !!detail?.room?.id, queryKey: getListAssetsQueryKey(detail?.room?.id || 0, {}) }
  });

  useDraftSocket(detail?.room?.id, code);

  const createAsset = useCreateAsset();
  const importCsv = useImportAssetsFromCsv();
  const startDraft = useStartDraft();
  const updateRoom = useUpdateDraftRoom();
  const deleteRoom = useDeleteDraftRoom();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [removingParticipantId, setRemovingParticipantId] = useState<number | null>(null);

  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const stepParam = searchParams.get("step") as ManualStep | "review" | null;

  const [wizard, setWizard] = useState<WizardMode>(
    stepParam === "review" ? "sleeper" : stepParam ? "manual" : "choice"
  );
  const [manualStep, setManualStep] = useState<ManualStep>(
    (stepParam && stepParam !== "review") ? (stepParam as ManualStep) : "settings"
  );
  const [sleeperPhase, setSleeperPhase] = useState<"import" | "review">(
    stepParam === "review" ? "review" : "import"
  );
  const [sleeperStepName, setSleeperStepName] = useState("username");

  const [csvContent, setCsvContent] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [clearPicksConfirm, setClearPicksConfirm] = useState(false);
  const [clearingPicks, setClearingPicks] = useState(false);
  const [randomizing, setRandomizing] = useState(false);
  const [reassigningAssetId, setReassigningAssetId] = useState<number | null>(null);
  const [codeSuffix, setCodeSuffix] = useState<string>(() => {
    const parts = (code || "").split("-");
    return parts.length >= 2 ? (parts[parts.length - 1] ?? "").slice(0, 5) : "";
  });
  const [savingCode, setSavingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSaved, setCodeSaved] = useState<boolean>(() => {
    return localStorage.getItem(`draft_${code}_codeLocked`) === "1";
  });

  const onClearAllAssets = useCallback(async () => {
    const roomId = detail?.room?.id;
    if (!roomId) return;
    if (!clearConfirm) { setClearConfirm(true); return; }
    setClearingAll(true);
    setClearConfirm(false);
    try {
      const res = await fetch(`/api/draft-rooms/${roomId}/assets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionerToken }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "All assets cleared" });
      queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(roomId, {}) });
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
    } catch {
      toast({ title: "Error clearing assets", variant: "destructive" });
    } finally {
      setClearingAll(false);
    }
  }, [clearConfirm, commissionerToken, detail?.room?.id, code, queryClient, toast]);

  const onClearAllPicks = useCallback(async () => {
    const roomId = detail?.room?.id;
    if (!roomId) return;
    if (!clearPicksConfirm) { setClearPicksConfirm(true); return; }
    setClearingPicks(true);
    setClearPicksConfirm(false);
    try {
      const pickIds = (assets || []).filter(a => a.type === "Rookie Pick" || a.type === "Future Pick").map(a => a.id);
      await Promise.all(pickIds.map(id =>
        fetch(`/api/draft-rooms/${roomId}/assets/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commissionerToken }),
        })
      ));
      toast({ title: "All picks cleared" });
      queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(roomId, {}) });
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
    } catch {
      toast({ title: "Error clearing picks", variant: "destructive" });
    } finally {
      setClearingPicks(false);
    }
  }, [clearPicksConfirm, commissionerToken, detail?.room?.id, assets, code, queryClient, toast]);

  const assetForm = useForm<z.infer<typeof createAssetSchema>>({
    resolver: zodResolver(createAssetSchema),
    defaultValues: { name: "", type: "Player", position: "", team: "", notes: "" }
  });

  const settingsForm = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { leagueName: "", numOrphanSlots: 2, draftFormat: "snake", timeBankMinutes: 0, dailyPauseEnabled: false, dailyPauseStart: "23:00", dailyPauseEnd: "08:00", pauseTimezone: "America/New_York", commissionerName: "" }
  });

  useEffect(() => {
    if (!detail) return;
    const commish = detail.participants?.find(
      (p: { isCommissioner: boolean; username: string }) => p.isCommissioner
    );
    settingsForm.reset({
      leagueName: detail.room.leagueName,
      numOrphanSlots: detail.room.numOrphanSlots,
      draftFormat: detail.room.draftFormat as "snake" | "linear" | "3rr",
      timeBankMinutes: Math.round((detail.room.timeBankSeconds ?? 0) / 60),
      dailyPauseEnabled: !!(detail.room.dailyPauseStart && detail.room.dailyPauseEnd),
      dailyPauseStart: detail.room.dailyPauseStart ?? "23:00",
      dailyPauseEnd: detail.room.dailyPauseEnd ?? "08:00",
      pauseTimezone: detail.room.pauseTimezone ?? "America/New_York",
      commissionerName: commish?.username ?? ""
    });
  }, [detail]);

  const saveShareCode = useCallback(async () => {
    const roomId = detail?.room?.id;
    if (!roomId || !commissionerToken) return;
    const commishName = settingsForm.getValues("commissionerName") ||
      detail?.participants?.find((p: { isCommissioner: boolean }) => p.isCommissioner)?.username || "";
    const prefix = commishName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const suffix = codeSuffix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (!prefix) { setCodeError("Save your commissioner name first"); return; }
    if (suffix.length !== 5) { setCodeError("Enter exactly 5 characters"); return; }
    const newCode = `${prefix}-${suffix}`;
    setSavingCode(true);
    setCodeError(null);
    try {
      const res = await fetch(`/api/draft-rooms/${roomId}/share-code`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionerToken, shareCode: newCode }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setCodeError(data.error || "Failed to save"); return; }
      const oldKey = `draft_${code}_commish`;
      const newKey = `draft_${newCode}_commish`;
      const token = localStorage.getItem(oldKey);
      if (token) { localStorage.setItem(newKey, token); localStorage.removeItem(oldKey); }
      localStorage.removeItem(`draft_${code}_codeLocked`);
      localStorage.setItem(`draft_${newCode}_codeLocked`, "1");
      setCodeSaved(true);
      toast({ title: "Code saved!", description: `Your room code is now ${newCode}` });
      setLocation(`/${newCode}/setup?step=${sleeperPhase === "review" ? "review" : manualStep}`);
    } catch {
      setCodeError("Network error, please try again");
    } finally {
      setSavingCode(false);
    }
  }, [detail, commissionerToken, codeSuffix, code, settingsForm, toast, setLocation, sleeperPhase, manualStep]);

  if (isLoading) return <div className="p-8 text-primary font-bold">Loading...</div>;
  if (!detail) return <div className="p-8 text-destructive font-bold">Room not found</div>;
  if (!commissionerToken || detail.room.commissionerToken !== commissionerToken) {
    return <div className="flex h-screen items-center justify-center text-destructive font-bold uppercase tracking-widest bg-background">Unauthorized. Commissioner access required.</div>;
  }

  const { room } = detail;

  const commishName = settingsForm.watch("commissionerName") ||
    detail.participants?.find((p: { isCommissioner: boolean }) => p.isCommissioner)?.username || "";
  const codePrefix = commishName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const previewSuffix = codeSuffix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const previewCode = codePrefix ? `${codePrefix}-${previewSuffix || "XXXXX"}` : (previewSuffix || code);
  const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}${previewCode}`;

  const shareCodePanel = (
    <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none bg-primary/5 opacity-50" />
      <h3 className="text-sm font-bold uppercase tracking-widest mb-1 text-primary relative z-10">Share Room</h3>
      <p className="text-xs text-muted-foreground mb-4 relative z-10">Customize your 5-character code, then share the code and website link with managers.</p>
      <div className="relative z-10 space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">Your Room Code</div>
          {codeSaved ? (
            <div className="flex items-center gap-2">
              <div className="px-3 py-2 bg-background border border-green-500/40 rounded-sm font-mono text-sm font-bold text-primary select-all tracking-widest">
                {code}
              </div>
              <span className="text-xs text-green-400 font-bold uppercase tracking-wider whitespace-nowrap">✓ Locked</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="px-3 py-2 bg-background border border-border/50 rounded-sm font-mono text-sm font-bold text-primary select-all">
                  {codePrefix || "…"}-
                </div>
                <Input
                  value={codeSuffix}
                  onChange={e => {
                    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
                    setCodeSuffix(v);
                    setCodeError(null);
                  }}
                  className="bg-background border-border/50 font-mono text-sm font-bold uppercase w-24 tracking-widest"
                  placeholder="XXXXX"
                  maxLength={5}
                />
                <Button
                  size="sm"
                  onClick={saveShareCode}
                  disabled={savingCode || previewSuffix.length !== 5}
                  className="font-bold uppercase tracking-wider shrink-0"
                >
                  {savingCode ? "Saving…" : "Save Code"}
                </Button>
              </div>
              {codeError && <p className="text-xs text-destructive mt-1.5">{codeError}</p>}
              {!codeError && previewSuffix.length < 5 && previewSuffix.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">{previewSuffix.length}/5 characters</p>
              )}
            </>
          )}
        </div>
        <Button
          type="button"
          disabled={!codeSaved}
          className="w-full font-black uppercase tracking-widest text-xs h-10 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => {
            const msg = `You're invited to my dispersal draft on StatChasers!\n\n🌐 Website: www.statchasers.com/dispersal-draft-tool\n🔑 Room Code: ${code}\n\nGo to the website, click "Join Draft", enter the room code, and claim your orphan slot.`;
            navigator.clipboard.writeText(msg);
            toast({ title: "Invite copied!", description: "Paste it anywhere to share with your managers." });
          }}
        >
          {codeSaved ? "Copy Invite" : "Save code first to copy invite"}
        </Button>
      </div>
    </div>
  );

  const onAddAsset = (values: z.infer<typeof createAssetSchema>) => {
    createAsset.mutate({ id: room.id, data: { ...values, commissionerToken } }, {
      onSuccess: () => {
        toast({ title: "Asset added" });
        assetForm.reset();
        queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(room.id, {}) });
        queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
      },
      onError: (err) => toast({ title: "Error", description: err.data?.error, variant: "destructive" })
    });
  };

  const onImportCsv = () => {
    if (!csvContent.trim()) return;
    importCsv.mutate({ id: room.id, data: { commissionerToken, csvContent } }, {
      onSuccess: (res) => {
        toast({ title: "Import successful", description: `Imported ${res.imported} assets.` });
        setCsvContent("");
        queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(room.id, {}) });
        queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
        if (res.errors.length > 0) toast({ title: "Some lines failed", description: res.errors.join(", "), variant: "destructive" });
      },
      onError: (err) => toast({ title: "Import Error", description: err.data?.error, variant: "destructive" })
    });
  };

  const onDeleteAsset = async (assetId: number) => {
    const res = await fetch(`/api/draft-rooms/${room.id}/assets/${assetId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionerToken }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(room.id, {}) });
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
    } else {
      toast({ title: "Could not delete asset", variant: "destructive" });
    }
  };

  const onReassignAsset = async (assetId: number, newOwner: string) => {
    const asset = allAssets.find(a => a.id === assetId);
    if (!asset) return;
    const current = asset.notes ?? "";
    const newNotes = /From:/.test(current)
      ? current.replace(/From:\s*[^·\n]+/, `From: ${newOwner}`)
      : `From: ${newOwner}`;
    const res = await fetch(`/api/draft-rooms/${room.id}/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionerToken, notes: newNotes }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(room.id, {}) });
    } else {
      toast({ title: "Could not reassign asset", variant: "destructive" });
    }
  };

  const onToggleLock = () => {
    updateRoom.mutate({
      id: room.id,
      data: { commissionerToken, isLocked: !room.isLocked }
    }, {
      onSuccess: () => {
        toast({ title: room.isLocked ? "Room unlocked" : "Room locked", description: room.isLocked ? "Managers can now join again." : "No new managers can join." });
        queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
      },
      onError: (err) => toast({ title: "Error", description: err.data?.error, variant: "destructive" })
    });
  };

  const onRemoveParticipant = async (participantId: number) => {
    if (!commissionerToken) return;
    setRemovingParticipantId(participantId);
    try {
      await fetch(`/api/draft-rooms/${room.id}/participants/${participantId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionerToken }),
      });
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
    } catch {
      toast({ title: "Error", description: "Could not remove participant", variant: "destructive" });
    } finally {
      setRemovingParticipantId(null);
    }
  };

  const onDeleteRoom = () => {
    if (!commissionerToken) return;
    deleteRoom.mutate({ id: room.id, data: { commissionerToken } }, {
      onSuccess: () => {
        Object.keys(localStorage).filter(k => k.startsWith(`draft_${code}`)).forEach(k => localStorage.removeItem(k));
        setLocation("/");
      },
      onError: (err) => toast({ title: "Error", description: err.data?.error, variant: "destructive" })
    });
  };

  const onStartDraft = () => {
    startDraft.mutate({ id: room.id, data: { commissionerToken } }, {
      onSuccess: () => {
        toast({ title: "Draft Started!" });
        queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
      },
      onError: (err) => toast({ title: "Error", description: err.data?.error, variant: "destructive" })
    });
  };

  const onUpdateSettings = (values: z.infer<typeof settingsSchema>, then?: () => void) => {
    updateRoom.mutate({
      id: room.id,
      data: { commissionerToken, leagueName: values.leagueName, numOrphanSlots: values.numOrphanSlots, draftFormat: values.draftFormat, timeBankSeconds: values.timeBankMinutes ? values.timeBankMinutes * 60 : null, dailyPauseStart: values.dailyPauseEnabled ? values.dailyPauseStart : null, dailyPauseEnd: values.dailyPauseEnabled ? values.dailyPauseEnd : null, pauseTimezone: values.pauseTimezone, commissionerName: values.commissionerName }
    }, {
      onSuccess: () => {
        toast({ title: "Settings saved" });
        queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
        then?.();
      },
      onError: (err) => toast({ title: "Error", description: err.data?.error, variant: "destructive" })
    });
  };

  const allAssets = assets ?? [];
  const picks = allAssets.filter(a => a.type === "Rookie Pick" || a.type === "Future Pick");
  const nonPicks = allAssets.filter(a => a.type !== "Rookie Pick" && a.type !== "Future Pick");
  const managersJoined = detail.participants.filter(p => !p.isCommissioner).length;

  const getAssetOwner = (a: { notes?: string | null; team?: string | null }) => {
    const m = a.notes?.match(/From:\s*(.+?)(?:\s*·|$)/);
    return m?.[1]?.trim() || "Unassigned";
  };
  const allRosterNames = Array.from(new Set(allAssets.map(a => getAssetOwner(a))))
    .sort((a, b) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b));

  const formatLabel = (f: string) => f === "snake" ? "Snake" : f === "linear" ? "Linear" : "3RR";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-5 py-10">

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-5">
            <Link
              href="/"
              className="text-muted-foreground hover:text-primary transition-colors"
              title="Home"
            >
              <Home size={18} />
            </Link>
            {wizard !== "choice" && (
              <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/${code}`} className="flex-shrink-0 px-4 py-2 bg-secondary text-secondary-foreground rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-secondary/80 transition-colors">
                Go to Draft Room
              </a>
            )}
          </div>
          <h1 className="text-2xl font-black text-primary uppercase tracking-tight leading-tight">
            {wizard === "choice" ? "Create a Dispersal Draft" : (room.leagueName || "Draft Room Setup")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {wizard === "choice"
              ? "Import a Sleeper league automatically or build a custom draft room manually."
              : wizard === "sleeper"
              ? "Import from Sleeper"
              : "Manual Setup"}
          </p>
        </div>

        {/* ── CHOICE SCREEN ─────────────────────────────────────────────────── */}
        {wizard === "choice" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sleeper card */}
            <div className="bg-card border-2 border-primary/60 rounded-sm p-7 flex flex-col shadow-lg shadow-primary/5 hover:border-primary transition-colors">
              <div className="flex items-center gap-2.5 mb-3">
                <h2 className="text-lg font-black text-white uppercase tracking-tight">Import From Sleeper</h2>
                <span className="px-2 py-0.5 bg-primary text-background text-[9px] font-black uppercase tracking-widest rounded-sm flex-shrink-0">Recommended</span>
              </div>
              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                Connect your Sleeper league to automatically import teams, players, draft picks, and league settings.
              </p>
              <ul className="space-y-2.5 mb-7 flex-1">
                {["Auto-load league name & settings", "Select which orphan teams to include", "Import all players and picks", "Fastest setup, done in minutes"].map(b => (
                  <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-primary font-black mt-0.5 flex-shrink-0">✓</span> {b}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full font-black uppercase tracking-widest h-11 text-sm"
                onClick={() => { setWizard("sleeper"); setSleeperPhase("import"); setSleeperStepName("username"); }}
              >
                Import From Sleeper →
              </Button>
            </div>

            {/* Manual card */}
            <div className="bg-card border border-border/50 rounded-sm p-7 flex flex-col shadow-sm hover:border-border/80 transition-colors">
              <h2 className="text-lg font-black text-white uppercase tracking-tight mb-3">Manual / CSV Setup</h2>
              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                Build a custom dispersal draft room for non-Sleeper leagues or offline setups.
              </p>
              <ul className="space-y-2.5 mb-7 flex-1">
                {["Create orphan slots manually", "Upload assets via CSV", "Add players and picks one by one", "Full custom control"].map(b => (
                  <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-primary font-black mt-0.5 flex-shrink-0">✓</span> {b}
                  </li>
                ))}
              </ul>
              <Button
                variant="secondary"
                className="w-full font-black uppercase tracking-widest h-11 text-sm"
                onClick={() => { setWizard("manual"); setManualStep("settings"); }}
              >
                Manual Setup →
              </Button>
            </div>
          </div>
        )}

        {/* ── SLEEPER FLOW ──────────────────────────────────────────────────── */}
        {wizard === "sleeper" && (
          <div>

            <ProgressBar steps={SLEEPER_STEPS} current={sleeperStepToIndex(sleeperStepName, sleeperPhase)} />

            {/* Import phase */}
            {sleeperPhase === "import" && (
              <div className="bg-card border border-primary/30 rounded-sm p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-bold uppercase tracking-widest text-primary">Import From Sleeper</h2>
                </div>
                <p className="text-xs text-muted-foreground mb-5">
                  Enter your Sleeper username to pull orphan teams directly from your league, players and picks included.
                </p>
                <SleeperImport
                  roomId={room.id}
                  shareCode={code}
                  commissionerToken={commissionerToken}
                  commissionerParticipantId={detail.participants?.find((p: { isCommissioner: boolean }) => p.isCommissioner)?.id}
                  onLeagueDetected={({ leagueName, commissionerName, numOrphanSlots }) => {
                    settingsForm.setValue("leagueName", leagueName, { shouldDirty: true });
                    settingsForm.setValue("commissionerName", commissionerName, { shouldDirty: true });
                    settingsForm.setValue("numOrphanSlots", numOrphanSlots, { shouldDirty: true });
                  }}
                  onStepChange={setSleeperStepName}
                  onImportComplete={() => {
                    onUpdateSettings(settingsForm.getValues(), () => setSleeperPhase("review"));
                  }}
                />
              </div>
            )}

            {/* Review phase */}
            {sleeperPhase === "review" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-5">
                  {/* Settings */}
                  <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                    <h3 className="text-base font-bold uppercase tracking-widest mb-4 pb-2 border-b border-border/40 text-primary">Room Settings</h3>
                    <Form {...settingsForm}>
                      <form onSubmit={settingsForm.handleSubmit((v) => onUpdateSettings(v))} className="space-y-4">
                        <FormField control={settingsForm.control} name="leagueName" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs uppercase font-bold text-muted-foreground">League Name</FormLabel>
                            <FormControl><Input className="bg-background border-border/50" placeholder="My League" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={settingsForm.control} name="commissionerName" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Commissioner Name</FormLabel>
                            <FormControl><Input className="bg-background border-border/50" placeholder="Commissioner" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-3">
                          <FormField control={settingsForm.control} name="numOrphanSlots" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Orphan Teams</FormLabel>
                              <FormControl>
                                <Input type="number" min={2} max={32} className="bg-background border-border/50" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={settingsForm.control} name="timeBankMinutes" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Time Bank (min)</FormLabel>
                              <FormControl>
                                <Input type="number" min={0} max={300} className="bg-background border-border/50" placeholder="0 = none" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <FormField control={settingsForm.control} name="draftFormat" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Draft Format</FormLabel>
                            <div className="flex items-center gap-2">
                              <Select onValueChange={field.onChange} value={field.value === "3rr" ? "snake" : field.value} disabled={field.value === "3rr"}>
                                <FormControl>
                                  <SelectTrigger className="bg-background border-border/50 flex-1"><SelectValue /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="snake">Snake</SelectItem>
                                  <SelectItem value="linear">Linear</SelectItem>
                                </SelectContent>
                              </Select>
                              <label className="flex items-center gap-1.5 cursor-pointer shrink-0 select-none border border-border/50 rounded px-2.5 py-2 bg-background hover:bg-secondary/50 transition-colors">
                                <input type="checkbox" className="accent-primary w-3.5 h-3.5" checked={field.value === "3rr"} onChange={e => field.onChange(e.target.checked ? "3rr" : "snake")} />
                                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">3RR</span>
                              </label>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <PauseWindowFields form={settingsForm} />
                        <Button type="submit" variant="secondary" className="w-full font-bold uppercase tracking-widest" disabled={updateRoom.isPending}>
                          {updateRoom.isPending ? "Saving..." : "Save Settings"}
                        </Button>
                      </form>
                    </Form>
                  </div>

                  {/* Asset pool */}
                  <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-border/40">
                      <h3 className="text-base font-bold uppercase tracking-widest text-primary">Asset Pool ({allAssets.length})</h3>
                      {allAssets.length > 0 && (
                        <Button variant="ghost" size="sm"
                          className={`h-7 px-3 text-xs font-bold uppercase tracking-wider transition-colors ${clearConfirm ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                          onClick={onClearAllAssets} disabled={clearingAll} onBlur={() => setClearConfirm(false)}>
                          {clearingAll ? "Clearing..." : clearConfirm ? "Confirm Clear All?" : "Clear All"}
                        </Button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto space-y-2">
                      {picks.length > 0 && (
                        <div className="p-3 bg-background border border-border/50 rounded-sm">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Draft Picks ({picks.length})</div>
                            <Button variant="ghost" size="sm"
                              className={`h-6 px-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${clearPicksConfirm ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                              onClick={onClearAllPicks} disabled={clearingPicks} onBlur={() => setClearPicksConfirm(false)}>
                              {clearingPicks ? "Clearing…" : clearPicksConfirm ? "Confirm?" : "Clear Picks"}
                            </Button>
                          </div>
                          {(() => {
                            const groups = picks.reduce<Record<string, typeof picks>>((acc, p) => {
                              const key = getAssetOwner(p);
                              (acc[key] ??= []).push(p);
                              return acc;
                            }, {});
                            const keys = Object.keys(groups).sort((a, b) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b));
                            return (
                              <div className="space-y-2 mt-1">
                                {keys.map(team => (
                                  <div key={team}>
                                    <div className="text-[9px] uppercase tracking-widest font-bold text-primary/70 mb-1 border-b border-border/30 pb-1">{team}</div>
                                    <PickBadgeGroup assets={groups[team]} onDelete={onDeleteAsset} onReassign={onReassignAsset} rosterNames={allRosterNames} />
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {nonPicks.map(a => {
                        const isPlayer = a.type === "Player";
                        const thumb = isPlayer ? sleeperThumb(a.notes ?? null) : null;
                        const teamLogo = isPlayer ? sleeperTeamLogo(a.team ?? null) : null;
                        return (
                          <div key={a.id} className="relative flex items-center px-3 py-2.5 bg-background border border-border/50 rounded-sm gap-3">
                            <div className="relative flex-shrink-0">
                              {thumb ? <img src={thumb} alt="" className="w-10 h-10 rounded-full object-cover bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} /> : <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">{isPlayer ? (a.position || "?") : "$"}</div>}
                              {teamLogo && <img src={teamLogo} alt="" className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background bg-muted object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-sm leading-tight truncate">{a.name}</div>
                              {isPlayer ? (
                                <div className="flex items-center gap-1 mt-0.5">
                                  {a.position && <><span className={`text-[8px] ${positionColor(a.position)}`}>●</span><span className={`text-[11px] font-bold ${positionColor(a.position)}`}>{a.position}</span></>}
                                  <span className="text-muted-foreground text-[8px]">●</span><span className="text-[11px] font-bold text-muted-foreground">{a.team || "FA"}</span>
                                </div>
                              ) : <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{a.type}</div>}
                              <div className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{getAssetOwner(a)}</div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <div className="relative">
                                <Button variant="ghost" size="sm" className="h-7 px-1.5 sm:px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                  onClick={() => setReassigningAssetId(reassigningAssetId === a.id ? null : a.id)}>
                                  <ArrowRight className="w-3.5 h-3.5 sm:hidden" />
                                  <span className="hidden sm:inline">Move →</span>
                                </Button>
                                {reassigningAssetId === a.id && (
                                  <>
                                    <div className="fixed inset-0 z-40" onClick={() => setReassigningAssetId(null)} />
                                    <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border/60 rounded shadow-lg min-w-40 py-1 text-xs text-foreground">
                                      <div className="px-2 pb-1 pt-0.5 text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border/40 mb-1">Move to roster</div>
                                      {allRosterNames.map(n => (
                                        <button key={n} type="button"
                                          className="w-full text-left px-2 py-1.5 hover:bg-primary/10 hover:text-primary transition-colors truncate"
                                          onClick={() => { onReassignAsset(a.id, n); setReassigningAssetId(null); }}>
                                          {n}
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                              <Button variant="ghost" size="sm" className="h-7 px-1.5 sm:px-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onDeleteAsset(a.id)}>
                                <Trash2 className="w-3.5 h-3.5 sm:hidden" />
                                <span className="hidden sm:inline">Delete</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      {allAssets.length === 0 && <div className="text-center py-6 text-muted-foreground text-sm">No assets imported yet</div>}
                    </div>
                  </div>

                  {/* Manual add */}
                  <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                    <h3 className="text-base font-bold uppercase tracking-widest mb-4 pb-2 border-b border-border/40 text-primary">Add Asset Manually</h3>
                    <Form {...assetForm}>
                      <form onSubmit={assetForm.handleSubmit(onAddAsset)} className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <FormField control={assetForm.control} name="name" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Name</FormLabel>
                              <FormControl>
                                {assetForm.watch("type") === "Player" ? (
                                  <PlayerSearchInput
                                    value={field.value}
                                    onChange={field.onChange}
                                    onPlayerSelect={({ name, position, team }) => {
                                      assetForm.setValue("name", name);
                                      assetForm.setValue("position", position);
                                      assetForm.setValue("team", team);
                                    }}
                                    placeholder="Bijan Robinson"
                                  />
                                ) : (
                                  <Input className="bg-background border-border/50" placeholder="2026 Round 1" {...field} />
                                )}
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={assetForm.control} name="type" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Type</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger className="bg-background border-border/50"><SelectValue /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Player">Player</SelectItem>
                                  <SelectItem value="Rookie Pick">Rookie Pick</SelectItem>
                                  <SelectItem value="FAAB">FAAB</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <Button type="submit" size="sm" className="font-bold uppercase tracking-widest" disabled={createAsset.isPending}>
                          {createAsset.isPending ? "Adding..." : "Add Asset"}
                        </Button>
                      </form>
                    </Form>
                  </div>
                </div>

                {/* Right column */}
                <div className="space-y-4">
                  {/* Share */}
                  {shareCodePanel}

                  <a
                    href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/${code}`}
                    className="flex items-center justify-center w-full py-3 bg-primary text-background font-black uppercase tracking-widest rounded-sm hover:bg-primary/90 transition-colors text-sm"
                  >
                    Go to Draft Room →
                  </a>

                  <button
                    onClick={() => { setSleeperPhase("import"); setSleeperStepName("username"); }}
                    className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors font-medium underline underline-offset-2"
                  >
                    Re-import from Sleeper
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MANUAL FLOW ───────────────────────────────────────────────────── */}
        {wizard === "manual" && (
          <div>
            <div className="flex items-center justify-end mb-6">
              <button
                onClick={() => { setWizard("sleeper"); setSleeperPhase("import"); setSleeperStepName("username"); }}
                className="text-xs text-muted-foreground hover:text-primary transition-colors font-medium underline underline-offset-2"
              >
                Switch to Sleeper Import
              </button>
            </div>

            <ProgressBar steps={MANUAL_STEPS} current={manualStepToIndex(manualStep)} />

            {/* Step 1: Settings */}
            {manualStep === "settings" && (
              <div className="max-w-lg space-y-4">
                <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                  <h3 className="text-base font-bold uppercase tracking-widest mb-4 pb-2 border-b border-border/40 text-primary">Room Settings</h3>
                  <Form {...settingsForm}>
                    <form id="settings-form" onSubmit={settingsForm.handleSubmit((v) => onUpdateSettings(v, () => setManualStep("assets")))} className="space-y-4">
                      <FormField control={settingsForm.control} name="leagueName" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs uppercase font-bold text-muted-foreground">League Name</FormLabel>
                          <FormControl><Input className="bg-background border-border/50" placeholder="My League" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={settingsForm.control} name="commissionerName" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Your Name (Commissioner)</FormLabel>
                          <FormControl><Input className="bg-background border-border/50" placeholder="Commissioner" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={settingsForm.control} name="numOrphanSlots" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Orphan Teams</FormLabel>
                            <FormControl>
                              <Input type="number" min={2} max={32} className="bg-background border-border/50" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={settingsForm.control} name="timeBankMinutes" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Time Bank (min)</FormLabel>
                            <FormControl>
                              <Input type="number" min={0} max={300} className="bg-background border-border/50" placeholder="0 = none" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <FormField control={settingsForm.control} name="draftFormat" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Draft Format</FormLabel>
                          <div className="flex items-center gap-2">
                            <Select onValueChange={field.onChange} value={field.value === "3rr" ? "snake" : field.value} disabled={field.value === "3rr"}>
                              <FormControl>
                                <SelectTrigger className="bg-background border-border/50 flex-1"><SelectValue /></SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="snake">Snake</SelectItem>
                                <SelectItem value="linear">Linear</SelectItem>
                              </SelectContent>
                            </Select>
                            <label className="flex items-center gap-1.5 cursor-pointer shrink-0 select-none border border-border/50 rounded px-2.5 py-2 bg-background hover:bg-secondary/50 transition-colors">
                              <input type="checkbox" className="accent-primary w-3.5 h-3.5" checked={field.value === "3rr"} onChange={e => field.onChange(e.target.checked ? "3rr" : "snake")} />
                              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">3RR</span>
                            </label>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <PauseWindowFields form={settingsForm} />
                    </form>
                  </Form>
                </div>
                <div className="flex justify-end">
                  <Button form="settings-form" type="submit" className="font-bold uppercase tracking-widest" disabled={updateRoom.isPending}>
                    {updateRoom.isPending ? "Saving..." : "Next: Add Assets →"}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Assets */}
            {manualStep === "assets" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Manual entry */}
                  <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                    <h3 className="text-base font-bold uppercase tracking-widest mb-4 pb-2 border-b border-border/40 text-primary">Add Asset Manually</h3>
                    <Form {...assetForm}>
                      <form onSubmit={assetForm.handleSubmit(onAddAsset)} className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <FormField control={assetForm.control} name="name" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Name</FormLabel>
                              <FormControl>
                                {assetForm.watch("type") === "Player" ? (
                                  <PlayerSearchInput
                                    value={field.value}
                                    onChange={field.onChange}
                                    onPlayerSelect={({ name, position, team }) => {
                                      assetForm.setValue("name", name);
                                      assetForm.setValue("position", position);
                                      assetForm.setValue("team", team);
                                    }}
                                    placeholder="Bijan Robinson"
                                  />
                                ) : (
                                  <Input className="bg-background border-border/50" placeholder="Round 1.01" {...field} />
                                )}
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={assetForm.control} name="type" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs uppercase font-bold text-muted-foreground">Type</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="bg-background border-border/50"><SelectValue /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Player">Player</SelectItem>
                                  <SelectItem value="Rookie Pick">Rookie Pick</SelectItem>
                                  <SelectItem value="FAAB">FAAB</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <Button type="submit" size="sm" className="font-bold uppercase tracking-widest" disabled={createAsset.isPending}>Add Asset</Button>
                      </form>
                    </Form>
                  </div>

                  {/* CSV */}
                  <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                    <h3 className="text-base font-bold uppercase tracking-widest mb-4 pb-2 border-b border-border/40 text-primary">Bulk Import (CSV)</h3>
                    <p className="text-xs text-muted-foreground mb-3">Paste CSV data. Columns: Name, Type, Position, Team, Notes.</p>
                    <Textarea
                      value={csvContent}
                      onChange={e => setCsvContent(e.target.value)}
                      className="font-mono text-xs bg-background border-border/50 h-28 mb-3"
                      placeholder={"Bijan Robinson,Player,RB,ATL,\n1.01,Rookie Pick,,,\n$100,FAAB,,,"}
                    />
                    <Button onClick={onImportCsv} variant="secondary" size="sm" className="font-bold uppercase tracking-widest" disabled={importCsv.isPending}>
                      {importCsv.isPending ? "Importing..." : "Import CSV"}
                    </Button>
                  </div>
                </div>

                {/* Asset pool */}
                <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-border/40">
                    <h3 className="text-base font-bold uppercase tracking-widest text-primary">Asset Pool ({allAssets.length})</h3>
                    {allAssets.length > 0 && (
                      <Button variant="ghost" size="sm"
                        className={`h-7 px-3 text-xs font-bold uppercase tracking-wider transition-colors ${clearConfirm ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                        onClick={onClearAllAssets} disabled={clearingAll} onBlur={() => setClearConfirm(false)}>
                        {clearingAll ? "Clearing..." : clearConfirm ? "Confirm Clear All?" : "Clear All"}
                      </Button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-2">
                    {picks.length > 0 && (
                      <div className="p-3 bg-background border border-border/50 rounded-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Draft Picks ({picks.length})</div>
                          <Button variant="ghost" size="sm"
                            className={`h-6 px-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${clearPicksConfirm ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                            onClick={onClearAllPicks} disabled={clearingPicks} onBlur={() => setClearPicksConfirm(false)}>
                            {clearingPicks ? "Clearing…" : clearPicksConfirm ? "Confirm?" : "Clear Picks"}
                          </Button>
                        </div>
                        {(() => {
                          const groups = picks.reduce<Record<string, typeof picks>>((acc, p) => {
                            const key = getAssetOwner(p);
                            (acc[key] ??= []).push(p);
                            return acc;
                          }, {});
                          const keys = Object.keys(groups).sort((a, b) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b));
                          return (
                            <div className="space-y-2 mt-1">
                              {keys.map(team => (
                                <div key={team}>
                                  <div className="text-[9px] uppercase tracking-widest font-bold text-primary/70 mb-1 border-b border-border/30 pb-1">{team}</div>
                                  <PickBadgeGroup assets={groups[team]} onDelete={onDeleteAsset} onReassign={onReassignAsset} rosterNames={allRosterNames} />
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {nonPicks.map(a => {
                      const isPlayer = a.type === "Player";
                      const thumb = isPlayer ? sleeperThumb(a.notes ?? null) : null;
                      const teamLogo = isPlayer ? sleeperTeamLogo(a.team ?? null) : null;
                      return (
                        <div key={a.id} className="relative flex items-center px-3 py-2.5 bg-background border border-border/50 rounded-sm gap-3">
                          <div className="relative flex-shrink-0">
                            {thumb ? <img src={thumb} alt="" className="w-10 h-10 rounded-full object-cover bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} /> : <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">{isPlayer ? (a.position || "?") : "$"}</div>}
                            {teamLogo && <img src={teamLogo} alt="" className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background bg-muted object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm leading-tight truncate">{a.name}</div>
                            {isPlayer ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                {a.position && <><span className={`text-[8px] ${positionColor(a.position)}`}>●</span><span className={`text-[11px] font-bold ${positionColor(a.position)}`}>{a.position}</span></>}
                                <span className="text-muted-foreground text-[8px]">●</span><span className="text-[11px] font-bold text-muted-foreground">{a.team || "FA"}</span>
                              </div>
                            ) : <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{a.type}</div>}
                            <div className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{getAssetOwner(a)}</div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <div className="relative">
                              <Button variant="ghost" size="sm" className="h-7 px-1.5 sm:px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                onClick={() => setReassigningAssetId(reassigningAssetId === a.id ? null : a.id)}>
                                <ArrowRight className="w-3.5 h-3.5 sm:hidden" />
                                <span className="hidden sm:inline">Move →</span>
                              </Button>
                              {reassigningAssetId === a.id && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setReassigningAssetId(null)} />
                                  <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border/60 rounded shadow-lg min-w-40 py-1 text-xs text-foreground">
                                    <div className="px-2 pb-1 pt-0.5 text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border/40 mb-1">Move to roster</div>
                                    {allRosterNames.map(n => (
                                      <button key={n} type="button"
                                        className="w-full text-left px-2 py-1.5 hover:bg-primary/10 hover:text-primary transition-colors truncate"
                                        onClick={() => { onReassignAsset(a.id, n); setReassigningAssetId(null); }}>
                                        {n}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                            <Button variant="ghost" size="sm" className="h-7 px-1.5 sm:px-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onDeleteAsset(a.id)}>
                              <Trash2 className="w-3.5 h-3.5 sm:hidden" />
                              <span className="hidden sm:inline">Delete</span>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {allAssets.length === 0 && <div className="text-center py-6 text-muted-foreground text-sm">No assets added yet</div>}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button className="font-bold uppercase tracking-widest" onClick={() => setManualStep("managers")}>
                    Next: Invite Managers →
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Managers */}
            {manualStep === "managers" && (
              <div className="max-w-xl space-y-5">
                {shareCodePanel}

                <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-bold uppercase tracking-widest text-primary">Managers Joined</h3>
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        variant={room.isLocked ? "secondary" : "outline"}
                        className={`h-7 px-3 text-xs font-bold uppercase tracking-wider gap-1.5 ${room.isLocked ? "text-yellow-400 border-yellow-500/50 bg-yellow-500/10 hover:bg-yellow-500/20" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={onToggleLock}
                        disabled={updateRoom.isPending}
                        title={room.isLocked ? "Click to allow new managers to join" : "Click to prevent new managers from joining"}
                      >
                        {room.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        {room.isLocked ? "Locked" : "Lock Room"}
                      </Button>
                      <span className="font-bold font-mono text-sm">{managersJoined} / {room.numOrphanSlots}</span>
                    </div>
                  </div>
                  {managersJoined === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border border-border/40 rounded-sm bg-muted/10">
                      No managers have joined yet. Share the link above.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detail.participants.filter(p => !p.isCommissioner).map(p => (
                        <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-background border border-border/40 rounded-sm gap-2">
                          <span className="font-bold text-sm truncate">{p.username}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {p.orphanTeamName ? (
                              <span className="text-xs font-bold text-primary bg-primary/10 border border-primary/30 rounded px-2 py-0.5">{p.orphanTeamName}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground font-mono italic">Unassigned</span>
                            )}
                            <button
                              onClick={() => onRemoveParticipant(p.id)}
                              disabled={removingParticipantId === p.id}
                              className="text-muted-foreground/40 hover:text-destructive transition-colors text-base leading-none disabled:opacity-30"
                              title={`Remove ${p.username} from room`}
                            >×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {managersJoined === room.numOrphanSlots && (
                    <div className="mt-4 pt-3 border-t border-border/40">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="font-bold uppercase tracking-wider w-full"
                        disabled={randomizing}
                        onClick={async () => {
                          setRandomizing(true);
                          try {
                            await fetch(`/api/draft-rooms/${room.id}/assign-teams`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ commissionerToken }),
                            });
                            queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(code) });
                          } finally {
                            setRandomizing(false);
                          }
                        }}
                      >
                        {randomizing ? "Randomizing..." : detail.participants.filter(p => !p.isCommissioner && p.orphanTeamName).length === room.numOrphanSlots ? "Re-Randomize Teams" : "Randomize Team Assignments"}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button className="font-bold uppercase tracking-widest" onClick={() => setManualStep("review")}>
                    Next: Review & Start →
                  </Button>
                </div>
              </div>
            )}

            {/* Step 4: Review */}
            {manualStep === "review" && (
              <div className="max-w-xl space-y-5">
                <div className="bg-card border border-border/50 rounded-sm p-5 shadow-sm">
                  <h3 className="text-base font-bold uppercase tracking-widest mb-4 pb-2 border-b border-border/40 text-primary">Draft Summary</h3>
                  <div className="space-y-3">
                    {([
                      ["League", room.leagueName],
                      ["Format", formatLabel(room.draftFormat)],
                      ["Orphan Slots", `${room.numOrphanSlots}`],
                      ["Managers Joined", `${managersJoined} / ${room.numOrphanSlots}`],
                      ["Total Assets", `${allAssets.length}`],
                      ["Time Bank", room.timeBankSeconds ? `${Math.round(room.timeBankSeconds / 60)} min per manager` : "No time bank"],
                    ] as [string, string][]).map(([label, value]) => (
                      <div key={label} className="flex justify-between items-center text-sm border-b border-border/20 pb-2 last:border-0 last:pb-0">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-bold">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {shareCodePanel}

                {room.status === "setup" ? (
                  <Button
                    onClick={onStartDraft}
                    className="w-full font-black uppercase tracking-widest h-12"
                    disabled={startDraft.isPending || managersJoined < room.numOrphanSlots || !allAssets.length}
                  >
                    {startDraft.isPending ? "Starting Draft..." : managersJoined < room.numOrphanSlots ? `Waiting for managers (${managersJoined}/${room.numOrphanSlots})` : !allAssets.length ? "Add assets first" : "Start Draft →"}
                  </Button>
                ) : (
                  <div className="text-center text-sm font-bold text-primary bg-primary/10 p-3 rounded-sm border border-primary/20">
                    Draft has started.{" "}
                    <Link href={`/${code}`} className="underline hover:text-primary/80">Go to draft room</Link>
                  </div>
                )}

                <div className="mt-6 pt-4 border-t border-border/40">
                  <button
                    className="text-xs text-destructive/50 hover:text-destructive underline underline-offset-2 transition-colors"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete this draft room
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Draft Room?</DialogTitle>
            <DialogDescription>
              This will permanently delete <span className="font-bold text-foreground">{room.leagueName}</span> and all its participants, assets, and picks. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleteRoom.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDeleteRoom} disabled={deleteRoom.isPending}>
              {deleteRoom.isPending ? "Deleting…" : "Delete Forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
