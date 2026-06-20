import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import api from '../services/api';
import type { WhiteboardData } from '@squadhub/shared';

const EMPTY: WhiteboardData = { nodes: [], edges: [] };

// Load a list's whiteboard blob. staleTime: Infinity because the view owns local
// edits after the first load — we never want a background refetch to clobber
// in-progress canvas changes (saves flow one-way via the autosave PUT below).
export function useWhiteboard(listId: string | null) {
  return useQuery<WhiteboardData>({
    queryKey: ['whiteboard', listId],
    queryFn: async () => {
      const res = await api.get(`/pm/lists/${listId}/whiteboard`);
      return (res.data?.data as WhiteboardData) ?? EMPTY;
    },
    enabled: !!listId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

// Debounced autosave — mirrors viewPreferencesSync's debounce. Call `save(data)`
// on every canvas change (it coalesces), and `flush()` to persist immediately
// (also runs automatically on unmount so the last edit is never lost).
export function useWhiteboardAutosave(listId: string | null) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<WhiteboardData | null>(null);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const data = pending.current;
    if (data && listId) {
      pending.current = null;
      // Keep the query cache in step with what we're persisting. The whiteboard
      // view unmounts when you switch List/Board/Whiteboard tabs (or open another
      // list) and remounts seeded from this cache. Because the query is
      // staleTime/gcTime Infinity it never refetches, so without this the stale
      // first-load blob is restored on remount — your edits vanish and the next
      // autosave serializes that stale state right back over the server copy.
      qc.setQueryData(['whiteboard', listId], data);
      api.put(`/pm/lists/${listId}/whiteboard`, { data }).catch((err) => {
        console.error('Whiteboard autosave failed', err);
      });
    }
  }, [listId, qc]);

  const save = useCallback((data: WhiteboardData) => {
    pending.current = data;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1500);
  }, [flush]);

  // Flush any pending edit when the view unmounts (tab switch, navigation).
  useEffect(() => () => flush(), [flush]);

  return { save, flush };
}
