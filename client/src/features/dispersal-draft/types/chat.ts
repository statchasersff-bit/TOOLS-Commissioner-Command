export type ChatMessageType = "user" | "system" | "announcement";

export interface ChatMessage {
  id: number;
  roomId: number;
  type: ChatMessageType;
  participantId: number | null;
  senderName: string;
  message: string;
  pinned: boolean;
  deletedAt: string | null;
  reactions: Record<string, number[]>;
  createdAt: string;
}

export const QUICK_REACTIONS = ["🔥", "👀", "💀", "😭", "🚨"] as const;
