import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { getGetDraftRoomQueryKey, getListParticipantsQueryKey, getListAssetsQueryKey, getListPicksQueryKey, getGetDraftRoomSummaryQueryKey } from "@dispersal/api";

export function useDraftSocket(roomId: number | undefined, shareCode: string | undefined) {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!roomId || !shareCode) return;

    const socket = io(window.location.origin, {
      path: "/api/ws"
    });

    socketRef.current = socket;

    const joinRoom = () => {
      socket.emit("join:room", shareCode);
    };

    socket.on("connect", joinRoom);

    // Re-join on reconnect in case the server restarted
    socket.on("reconnect", joinRoom);

    socket.on("draft:update", () => {
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomQueryKey(shareCode) });
      queryClient.invalidateQueries({ queryKey: getListParticipantsQueryKey(roomId) });
      queryClient.invalidateQueries({ queryKey: getListPicksQueryKey(roomId) });
      queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(roomId) });
      queryClient.invalidateQueries({ queryKey: getGetDraftRoomSummaryQueryKey(roomId) });
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId, shareCode, queryClient]);

  return socketRef.current;
}
