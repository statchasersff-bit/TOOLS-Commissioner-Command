import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import type { ChatMessage } from "@dispersal/types/chat";

const COOLDOWN_MS = 2500;

export function useChat(
  roomId: number | undefined,
  shareCode: string | undefined
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!roomId) return;
    setLoading(true);
    fetch(`/api/draft-rooms/${roomId}/chat`)
      .then(r => r.json())
      .then((data: ChatMessage[]) => { setMessages(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [roomId]);

  useEffect(() => {
    if (!shareCode) return;
    const socket = io(window.location.origin, { path: "/api/ws" });
    socket.on("connect", () => socket.emit("join:room", shareCode));
    socket.on("chat:message", (msg: ChatMessage) => {
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
    });
    socket.on("chat:update", (patch: Partial<ChatMessage> & { id: number }) => {
      setMessages(prev => prev.map(m => m.id === patch.id ? { ...m, ...patch } : m));
    });
    return () => { socket.disconnect(); };
  }, [shareCode]);

  const sendMessage = useCallback(async (
    text: string,
    participantId: number | null,
    commissionerToken: string | null
  ): Promise<boolean> => {
    if (!roomId || (!participantId && !commissionerToken)) return false;
    const now = Date.now();
    if (!commissionerToken && now - lastSentRef.current < COOLDOWN_MS) return false;
    if (!commissionerToken) lastSentRef.current = now;
    const res = await fetch(`/api/draft-rooms/${roomId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        ...(participantId ? { participantId } : {}),
        ...(commissionerToken ? { commissionerToken } : {}),
      }),
    });
    return res.ok;
  }, [roomId]);

  const postAnnouncement = useCallback(async (text: string, commissionerToken: string) => {
    if (!roomId) return;
    await fetch(`/api/draft-rooms/${roomId}/chat/announce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionerToken, message: text }),
    });
  }, [roomId]);

  const deleteMessage = useCallback(async (msgId: number, commissionerToken: string) => {
    if (!roomId) return;
    await fetch(`/api/draft-rooms/${roomId}/chat/${msgId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionerToken }),
    });
  }, [roomId]);

  const pinMessage = useCallback(async (msgId: number, pinned: boolean, commissionerToken: string) => {
    if (!roomId) return;
    await fetch(`/api/draft-rooms/${roomId}/chat/${msgId}/pin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionerToken, pinned }),
    });
  }, [roomId]);

  const reactToMessage = useCallback(async (
    msgId: number,
    emoji: string,
    participantId: number | null,
    commissionerToken: string | null
  ) => {
    if (!roomId) return;
    await fetch(`/api/draft-rooms/${roomId}/chat/${msgId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emoji,
        ...(participantId ? { participantId } : {}),
        ...(commissionerToken ? { commissionerToken } : {}),
      }),
    });
  }, [roomId]);

  return { messages, loading, sendMessage, postAnnouncement, deleteMessage, pinMessage, reactToMessage };
}
