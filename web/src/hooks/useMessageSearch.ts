import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { ChatKind } from '../stores/workspaceStore';

// One row returned by GET /messages/search — a message that matched, plus the
// context the UI needs to render it and jump to it.
export interface MessageSearchResult {
  id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  parent_message_id: string | null;
  content: string;
  type: string;
  created_at: string;
  kind: ChatKind;
  /** Channel name, or the DM's other participants — for the "in …" hint. */
  conversation_label: string;
  sender: { id: string; display_name: string | null; avatar_url: string | null } | null;
}

// Scope: pass exactly one of channelId / dmId to search a single conversation,
// or workspaceId to search every conversation the user can read ("normal"
// global search). The most-specific scope present wins.
interface MessageSearchScope {
  channelId?: string;
  dmId?: string;
  workspaceId?: string;
  query: string;
  /** Skip the request even if a query is present (e.g. panel closed). */
  enabled?: boolean;
  limit?: number;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function useMessageSearch({
  channelId,
  dmId,
  workspaceId,
  query,
  enabled = true,
  limit = 20,
}: MessageSearchScope) {
  const q = query.trim();
  const debouncedQ = useDebounced(q, 200);

  const scopeKey = channelId
    ? `channel:${channelId}`
    : dmId
      ? `dm:${dmId}`
      : `ws:${workspaceId ?? ''}`;

  const { data, isFetching } = useQuery<MessageSearchResult[]>({
    queryKey: ['message-search', scopeKey, debouncedQ, limit],
    queryFn: async () => {
      const params: Record<string, string | number> = { q: debouncedQ, limit };
      if (channelId) params.channel_id = channelId;
      else if (dmId) params.dm_conversation_id = dmId;
      else if (workspaceId) params.workspace_id = workspaceId;
      const res = await api.get('/messages/search', { params });
      return (res.data?.data?.messages || []) as MessageSearchResult[];
    },
    enabled: enabled && debouncedQ.length > 0 && !!(channelId || dmId || workspaceId),
    staleTime: 30_000,
  });

  return {
    results: data ?? [],
    isSearching: isFetching,
    // Whether the debounce has caught up with the live input.
    isDebouncing: q !== debouncedQ,
  };
}
