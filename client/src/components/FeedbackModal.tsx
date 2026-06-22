import { useState, useRef, useCallback, type FormEvent, type ChangeEvent } from "react";
import { X, MessageSquare, Bug, Lightbulb, HelpCircle, ChevronDown, Image, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE } from "@/lib/apiBase";

const FEEDBACK_TYPES = [
  { value: "bug",     label: "Bug Report",      Icon: Bug,            color: "text-red-400" },
  { value: "feature", label: "Feature Request",  Icon: Lightbulb,      color: "text-yellow-400" },
  { value: "general", label: "General Feedback", Icon: MessageSquare,  color: "text-blue-400" },
  { value: "question","label": "Question",       Icon: HelpCircle,     color: "text-purple-400" },
] as const;
type FeedbackType = typeof FEEDBACK_TYPES[number]["value"];

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  currentTab?: string;
  currentSubTab?: string;
  leagueId?: string | null;
  currentRoute?: string;
}

function getTabLabel(tab: string, sub: string): string {
  const labels: Record<string, string> = {
    portfolio: "Command Center",
    "league-analyzer": "Activity",
    "trade-center": "Trades",
  };
  const subLabels: Record<string, string> = {
    "portfolio-summary": "My Leagues", "lineup-command": "Lineup Command",
    "power-rankings": "Rankings",
    "roster-comparison": "Compare", "transactions": "Transactions",
    "trade-calculator": "Calculator",
    "market-value": "Market Value", "compare-players": "Compare Players",
  };
  const tabName = labels[tab] ?? tab;
  const subName = subLabels[sub] ?? sub;
  return subName ? `${tabName} → ${subName}` : tabName;
}

function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const platform = mobile ? "Mobile" : "Desktop";
  const browser = /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : /Edge/i.test(ua) ? "Edge" : "Unknown";
  return `${browser} · ${platform}`;
}

export function FeedbackModal({ open, onClose, currentTab = "", currentSubTab = "", leagueId, currentRoute }: FeedbackModalProps) {
  const { user, sleeperInfo } = useAuth();

  const [type, setType] = useState<FeedbackType>("general");
  const [typeOpen, setTypeOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [screenshot, setScreenshot] = useState<{ name: string; dataUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedType = FEEDBACK_TYPES.find(t => t.value === type)!;

  const handleFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErrorMsg("Screenshot must be under 5 MB."); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      setScreenshot({ name: file.name, dataUrl: ev.target?.result as string });
      setErrorMsg("");
    };
    reader.readAsDataURL(file);
  }, []);

  const reset = useCallback(() => {
    setType("general");
    setMessage("");
    setEmail(user?.email ?? "");
    setScreenshot(null);
    setLoading(false);
    setStatus("idle");
    setErrorMsg("");
    if (fileRef.current) fileRef.current.value = "";
  }, [user]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) { setErrorMsg("Please enter a message."); return; }
    setLoading(true);
    setErrorMsg("");
    try {
      const payload = {
        type,
        message: message.trim(),
        email: email.trim() || null,
        screenshot: screenshot?.dataUrl ?? null,
        screenshotName: screenshot?.name ?? null,
        context: {
          tab: currentTab ? getTabLabel(currentTab, currentSubTab) : null,
          leagueId: leagueId ?? null,
          sleeperUsername: sleeperInfo?.username ?? null,
          sleeperUserId: sleeperInfo?.userId ?? null,
          scUserId: user?.id ?? null,
          browser: getBrowserInfo(),
          route: currentRoute ?? window.location.pathname + window.location.search,
          timestamp: new Date().toISOString(),
        },
      };
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed.");
      }
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to send feedback. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.60)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="relative w-full sm:max-w-[500px] sm:rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #0f2a47 0%, #0b1e3a 55%, #091629 100%)",
          border: "1px solid rgba(212,175,55,0.22)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(212,175,55,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
          maxHeight: "92dvh",
          borderRadius: "20px 20px 0 0",
        }}
      >
        {/* Drag pill (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-white/15" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-3 sm:pt-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.25)" }}>
              <MessageSquare className="w-4 h-4" style={{ color: "#d4af37" }} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-white leading-tight">Help Improve Dynasty Command</h2>
              <p className="text-[11px] text-white/35 mt-0.5">Your feedback goes directly to the team</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            data-testid="button-feedback-close"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto" style={{ maxHeight: "calc(92dvh - 64px)" }}>
          {status === "success" ? (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}>
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <div>
                <p className="text-[17px] font-bold text-white">Thanks. Feedback sent.</p>
                <p className="text-[13px] text-white/40 mt-1">We appreciate you helping make Dynasty Command better.</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="mt-2 px-6 py-2 rounded-xl text-sm font-semibold text-[#060d1a] transition-colors"
                style={{ background: "#d4af37" }}
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {/* Feedback type */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wide">Feedback Type</label>
                <div className="relative">
                  <button
                    type="button"
                    data-testid="button-feedback-type"
                    onClick={() => setTypeOpen(v => !v)}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-white text-left transition-colors"
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${typeOpen ? "rgba(212,175,55,0.40)" : "rgba(255,255,255,0.10)"}` }}
                  >
                    <selectedType.Icon className={cn("w-4 h-4 flex-shrink-0", selectedType.color)} />
                    <span className="flex-1 font-medium">{selectedType.label}</span>
                    <ChevronDown className={cn("w-4 h-4 text-white/30 transition-transform", typeOpen && "rotate-180")} />
                  </button>
                  {typeOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setTypeOpen(false)} />
                      <div
                        className="absolute left-0 top-full mt-1.5 w-full z-20 overflow-hidden py-1"
                        style={{ background: "rgba(8,18,35,0.98)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.50)" }}
                      >
                        {FEEDBACK_TYPES.map(t => (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => { setType(t.value); setTypeOpen(false); }}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-left transition-colors hover:bg-white/5"
                            style={{ background: type === t.value ? "rgba(212,175,55,0.07)" : "transparent" }}
                          >
                            <t.Icon className={cn("w-4 h-4 flex-shrink-0", t.color)} />
                            <span className={cn("font-medium", type === t.value ? "text-white" : "text-white/60")}>{t.label}</span>
                            {type === t.value && <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#d4af37" }} />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Message */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wide">Message <span className="text-[#d4af37]">*</span></label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  data-testid="textarea-feedback-message"
                  placeholder="Tell us what you're experiencing or what you'd like to see…"
                  rows={4}
                  required
                  className="w-full bg-[#0b1a2e] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-colors resize-none"
                />
              </div>

              {/* Optional email */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wide">Email <span className="text-white/25">(optional)</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  data-testid="input-feedback-email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full bg-[#0b1a2e] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/20 transition-colors"
                />
              </div>

              {/* Screenshot upload */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wide">Screenshot <span className="text-white/25">(optional)</span></label>
                {screenshot ? (
                  <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.20)" }}>
                    <Image className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span className="text-[13px] text-emerald-300 flex-1 truncate">{screenshot.name}</span>
                    <button
                      type="button"
                      onClick={() => { setScreenshot(null); if (fileRef.current) fileRef.current.value = ""; }}
                      className="text-white/30 hover:text-white/60 transition-colors"
                    ><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="button-feedback-screenshot"
                    onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm text-white/40 hover:text-white/60 transition-colors"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.12)" }}
                  >
                    <Image className="w-4 h-4" />
                    <span>Attach a screenshot</span>
                    <span className="ml-auto text-[11px] text-white/20">PNG, JPG &lt; 5 MB</span>
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleFile}
                  className="hidden"
                />
              </div>


              {/* Error */}
              {(errorMsg || status === "error") && (
                <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[13px] text-red-400">{errorMsg || "Failed to send. Please try again."}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                data-testid="button-feedback-submit"
                disabled={loading || !message.trim()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-[#060d1a] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #d4af37 0%, #c9a227 60%, #b8921f 100%)", boxShadow: "0 4px 20px rgba(212,175,55,0.28)" }}
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? "Sending…" : "Send Feedback"}
              </button>

              <p className="text-center text-[11px] text-white/20 pb-1">
                Feedback is anonymous unless you include your email.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
