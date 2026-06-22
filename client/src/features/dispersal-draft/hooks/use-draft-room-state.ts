import { useState, useCallback } from "react";

interface DraftRoomState {
  commissionerToken: string | null;
  participantId: number | null;
}

export function useDraftRoomState(shareCode: string) {
  const getStorageKey = (type: "commish" | "participant") => `draft_${shareCode}_${type}`;

  const [commissionerToken, setCommishToken] = useState<string | null>(() => {
    return localStorage.getItem(getStorageKey("commish"));
  });

  const [participantId, setPartId] = useState<number | null>(() => {
    const stored = localStorage.getItem(getStorageKey("participant"));
    return stored ? parseInt(stored, 10) : null;
  });

  const setCommissionerToken = useCallback((token: string) => {
    localStorage.setItem(getStorageKey("commish"), token);
    setCommishToken(token);
  }, [shareCode]);

  const setParticipantId = useCallback((id: number) => {
    localStorage.setItem(getStorageKey("participant"), id.toString());
    setPartId(id);
  }, [shareCode]);

  const clearParticipantId = useCallback(() => {
    localStorage.removeItem(getStorageKey("participant"));
    setPartId(null);
  }, [shareCode]);

  return {
    commissionerToken,
    setCommissionerToken,
    participantId,
    setParticipantId,
    clearParticipantId
  };
}