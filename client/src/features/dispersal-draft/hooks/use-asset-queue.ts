import { useState, useEffect, useCallback } from "react";

export function useAssetQueue(roomId: number) {
  const key = `queue-${roomId}`;

  const [queue, setQueue] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]") as number[]; }
    catch { return []; }
  });

  useEffect(() => {
    if (roomId) localStorage.setItem(key, JSON.stringify(queue));
  }, [queue, key, roomId]);

  const toggleQueue = useCallback((id: number) => {
    setQueue(q => q.includes(id) ? q.filter(x => x !== id) : [...q, id]);
  }, []);

  const removeFromQueue = useCallback((id: number) => {
    setQueue(q => q.filter(x => x !== id));
  }, []);

  const clearQueue = useCallback(() => setQueue([]), []);

  const moveQueueUp = useCallback((id: number) => {
    setQueue(q => {
      const i = q.indexOf(id);
      if (i <= 0) return q;
      const next = [...q];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  }, []);

  const moveQueueDown = useCallback((id: number) => {
    setQueue(q => {
      const i = q.indexOf(id);
      if (i === -1 || i === q.length - 1) return q;
      const next = [...q];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
  }, []);

  return { queue, toggleQueue, removeFromQueue, clearQueue, moveQueueUp, moveQueueDown };
}
