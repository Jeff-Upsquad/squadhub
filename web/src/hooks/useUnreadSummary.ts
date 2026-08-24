import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { connectSocket } from '../services/socket';

export interface UnreadSummary {
  channels: Record<string, number>;
  dms: Record<string, number>;
  total: number;
}

export const UNREAD_SUMMARY_QUERY_KEY = ['messages', 'unread-summary'] as const;

const EMPTY_SUMMARY: UnreadSummary = { channels: {}, dms: {}, total: 0 };

/**
 * Per-channel + per-DM unread counts, computed server-side from the same
 * read high-water mark (POST /messages/mark-read) the native apps badge from.
 */
export function useUnreadSummary() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: UNREAD_SUMMARY_QUERY_KEY,
    queryFn: async (): Promise<UnreadSummary> => {
      const res = await api.get('/messages/unread-summary');
      return res.data.data ?? EMPTY_SUMMARY;
    },
    // Read marks from other devices aren't broadcast over the socket, so a
    // poll keeps badges honest when reads happen elsewhere.
    refetchInterval: 30_000,
  });

  // A message landing in any conversation bumps its count immediately; the
  // open conversation clears again via ChatPanel's mark-read invalidation.
  useEffect(() => {
    const socket = connectSocket();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: UNREAD_SUMMARY_QUERY_KEY });
    };
    socket.on('new_message', invalidate);
    socket.on('thread_reply', invalidate);
    return () => {
      socket.off('new_message', invalidate);
      socket.off('thread_reply', invalidate);
    };
  }, [queryClient]);

  return query;
}
