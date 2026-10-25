import { useState, useRef, useEffect, useCallback } from "react";
import { useChat } from "@dispersal/hooks/use-chat";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@dispersal/types/chat";
import { QUICK_REACTIONS } from "@dispersal/types/chat";

interface ChatPanelProps {
  roomId: number;
  shareCode: string;
  participantId: number | null;
  commissionerToken: string | null;
  isCommissioner: boolean;
  mobile?: boolean;
  className?: string;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface MessageRowProps {
  msg: ChatMessage;
  isCommissioner: boolean;
  participantId: number | null;
  commissionerToken: string | null;
  onDelete: (id: number) => void;
  onPin: (id: number, pinned: boolean) => void;
  onReact: (id: number, emoji: string) => void;
}

function MessageRow({ msg, isCommissioner, participantId, commissionerToken, onDelete, onPin, onReact }: MessageRowProps) {
  const [showReactions, setShowReactions] = useState(false);

  if (msg.type === "system") {
    return (
      <div className="flex items-center gap-2 py-1 px-3">
        <div className="flex-1 h-px bg-border/20" />
        <span className="text-[10px] text-muted-foreground/45 italic shrink-0 text-center">{msg.message}</span>
        <div className="flex-1 h-px bg-border/20" />
      </div>
    );
  }

  if (msg.type === "announcement") {
    return (
      <div className="mx-2 my-1.5 px-2.5 py-2 rounded-lg border border-primary/40 bg-primary/8">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-primary/70">📣 Announcement</span>
          <span className="text-[9px] text-muted-foreground/40 ml-auto">{formatTime(msg.createdAt)}</span>
        </div>
        <p className="text-xs font-semibold text-foreground/90 leading-relaxed">{msg.message}</p>
      </div>
    );
  }

  // User message
  const isDeleted = !!msg.deletedAt;
  const reactions = msg.reactions ?? {};
  const hasReactions = Object.keys(reactions).length > 0;
  const myId = participantId;
  const canReact = !isDeleted && (!!participantId || !!commissionerToken);

  return (
    <div
      className="group/msg relative flex flex-col px-3 py-1 hover:bg-muted/10 transition-colors"
      onMouseEnter={() => setShowReactions(true)}
      onMouseLeave={() => setShowReactions(false)}
    >
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-[11px] font-bold text-primary/80 shrink-0 truncate max-w-[120px]">{msg.senderName}</span>
        <span className="text-[9px] text-muted-foreground/35 shrink-0">{formatTime(msg.createdAt)}</span>

        {/* Commissioner hover controls */}
        {isCommissioner && !isDeleted && (
          <span className="ml-auto opacity-0 group-hover/msg:opacity-100 transition-opacity flex gap-1 shrink-0">
            {msg.pinned ? (
              <button
                onClick={() => onPin(msg.id, false)}
                className="text-[11px] text-primary/70 hover:text-primary transition-colors"
                title="Unpin message"
              >📌</button>
            ) : (
              <button
                onClick={() => onPin(msg.id, true)}
                className="text-[11px] text-muted-foreground/40 hover:text-primary/70 transition-colors"
                title="Pin message"
              >📌</button>
            )}
            <button
              onClick={() => onDelete(msg.id)}
              className="text-[11px] text-muted-foreground/40 hover:text-destructive transition-colors ml-0.5"
              title="Delete message"
            >✕</button>
          </span>
        )}
      </div>

      {isDeleted ? (
        <p className="text-[10px] italic text-muted-foreground/30 leading-relaxed">Message deleted</p>
      ) : (
        <p className="text-[11px] text-foreground/80 leading-relaxed break-words">{msg.message}</p>
      )}

      {/* Reactions row */}
      {!isDeleted && (hasReactions || (showReactions && canReact)) && (
        <div className="flex flex-wrap items-center gap-1 mt-1">
          {/* Existing reactions */}
          {Object.entries(reactions).map(([emoji, ids]) =>
            ids.length > 0 ? (
              <button
                key={emoji}
                onClick={() => onReact(msg.id, emoji)}
                className={cn(
                  "flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] border transition-colors",
                  myId && ids.includes(myId)
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "bg-muted/30 border-border/30 text-muted-foreground hover:border-primary/30"
                )}
              >
                <span>{emoji}</span>
                <span className="font-bold">{ids.length}</span>
              </button>
            ) : null
          )}
          {/* Quick add reactions - show on hover */}
          {showReactions && canReact && (
            <span className="flex gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
              {QUICK_REACTIONS.filter(e => !reactions[e]?.length).map(emoji => (
                <button
                  key={emoji}
                  onClick={() => onReact(msg.id, emoji)}
                  className="text-[11px] px-1 py-0.5 rounded-lg hover:bg-muted/40 text-muted-foreground/40 hover:text-foreground/70 transition-colors"
                  title={`React ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  roomId,
  shareCode,
  participantId,
  commissionerToken,
  isCommissioner,
  mobile = false,
  className,
}: ChatPanelProps) {
  const { messages, loading, sendMessage, postAnnouncement, deleteMessage, pinMessage, reactToMessage } = useChat(roomId, shareCode);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showAnnounce, setShowAnnounce] = useState(false);
  const [announceText, setAnnounceText] = useState("");
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const isOpenRef = useRef(open);
  isOpenRef.current = open;

  // Track unread
  useEffect(() => {
    const count = messages.length;
    if (count > prevCountRef.current) {
      const delta = count - prevCountRef.current;
      if (!isOpenRef.current && !mobile) setUnread(u => u + delta);
    }
    prevCountRef.current = count;
  }, [messages.length, mobile]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (open || mobile) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [messages.length, open, mobile]);

  const handleOpen = () => {
    setOpen(true);
    setUnread(0);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView());
  };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setIsSending(true);
    const ok = await sendMessage(text, participantId, commissionerToken);
    if (ok) setInput("");
    setIsSending(false);
  }, [input, isSending, sendMessage, participantId, commissionerToken]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleAnnounce = async () => {
    if (!announceText.trim() || !commissionerToken) return;
    await postAnnouncement(announceText.trim(), commissionerToken);
    setAnnounceText("");
    setShowAnnounce(false);
  };

  const pinnedMessages = messages.filter(m => m.pinned && !m.deletedAt);
  const canChat = !!participantId || !!commissionerToken;

  const chatContent = (
    <div className={cn("flex flex-col", mobile ? "flex-1 overflow-hidden" : "h-full overflow-hidden")}>
      {/* Pinned strip */}
      {pinnedMessages.length > 0 && (
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] text-primary/60">📌</span>
          <p className="text-[10px] text-foreground/75 truncate flex-1">{pinnedMessages[pinnedMessages.length - 1]!.message}</p>
        </div>
      )}

      {/* Commissioner announce bar */}
      {isCommissioner && showAnnounce && (
        <div className="shrink-0 flex gap-1.5 px-2 py-2 border-b border-border/40 bg-primary/5">
          <input
            className="flex-1 text-xs bg-background border border-primary/40 rounded-lg px-2 py-1 focus:outline-none focus:border-primary/70 text-foreground placeholder:text-muted-foreground/40"
            placeholder="Announcement text…"
            value={announceText}
            onChange={e => setAnnounceText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAnnounce()}
            autoFocus
            maxLength={500}
          />
          <button onClick={handleAnnounce} className="text-[10px] font-bold uppercase tracking-widest text-primary/80 hover:text-primary border border-primary/40 hover:border-primary/70 rounded-lg px-2 transition-colors">Post</button>
          <button onClick={() => setShowAnnounce(false)} className="text-[11px] text-muted-foreground/40 hover:text-foreground transition-colors">✕</button>
        </div>
      )}

      {/* Messages list */}
      <div ref={listRef} className="flex-1 overflow-y-auto py-1 min-h-0">
        {loading ? (
          <div className="text-center text-[10px] text-muted-foreground/40 py-8">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-[10px] text-muted-foreground/30 py-8 italic">No messages yet. Be the first to say something!</div>
        ) : (
          messages.map(msg => (
            <MessageRow
              key={msg.id}
              msg={msg}
              isCommissioner={isCommissioner}
              participantId={participantId}
              commissionerToken={commissionerToken}
              onDelete={id => commissionerToken && deleteMessage(id, commissionerToken)}
              onPin={(id, pinned) => commissionerToken && pinMessage(id, pinned, commissionerToken)}
              onReact={(id, emoji) => reactToMessage(id, emoji, participantId, commissionerToken)}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {canChat ? (
        <div className="shrink-0 flex gap-1.5 items-center px-2 py-2 border-t border-border/30 bg-card/60">
          {isCommissioner && (
            <button
              onClick={() => setShowAnnounce(v => !v)}
              title="Post announcement"
              className="text-[13px] text-primary/40 hover:text-primary/70 transition-colors shrink-0"
            >📣</button>
          )}
          <input
            className="flex-1 text-xs bg-background border border-border/40 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground/35 min-w-0"
            placeholder={isCommissioner ? "Message or 📣 for announcement…" : "Message…"}
            value={input}
            onChange={e => setInput(e.target.value.slice(0, 500))}
            onKeyDown={handleKeyDown}
            maxLength={500}
          />
          <button
            onClick={handleSend}
            disabled={isSending || !input.trim()}
            className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-primary/80 hover:text-primary disabled:text-muted-foreground/25 disabled:cursor-not-allowed border border-primary/30 hover:border-primary/60 disabled:border-border/20 rounded-lg px-2 py-1.5 transition-colors"
          >
            Send
          </button>
        </div>
      ) : (
        <div className="shrink-0 px-3 py-2 border-t border-border/30 text-center text-[9px] text-muted-foreground/30 italic">
          Join the draft to chat
        </div>
      )}
    </div>
  );

  if (mobile) {
    return (
      <div className={cn("flex flex-col flex-1 overflow-hidden bg-card/30", className)}>
        <div className="shrink-0 px-3 py-2 border-b border-border/40 bg-card/80">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Draft Chat</span>
        </div>
        {chatContent}
      </div>
    );
  }

  return (
    <div className={cn("shrink-0 border-t border-border/40 bg-card/50 flex flex-col transition-all duration-200", open ? "h-72" : "h-9", className)}>
      {/* Header / toggle */}
      <button
        onClick={open ? () => setOpen(false) : handleOpen}
        className="flex items-center gap-2 px-3 h-9 w-full text-left hover:bg-muted/20 transition-colors shrink-0"
      >
        <span className="text-sm">💬</span>
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex-1">Chat</span>
        {!open && unread > 0 && (
          <span className="text-[9px] font-black bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/40 ml-auto">{open ? "▼" : "▲"}</span>
      </button>

      {open && chatContent}
    </div>
  );
}
