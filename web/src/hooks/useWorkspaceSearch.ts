import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Channel, Space } from '@squadhub/shared';
import api from '../services/api';
import { useSpaces } from './useSpaces';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useWorkspaceMembers, type WorkspaceMember } from './useWorkspaceMembers';
import type { MessageSearchResult } from './useMessageSearch';

const PER_CATEGORY_LIMIT = 8;

export type SearchSpace = { id: string; name: string };
export type SearchFolder = { id: string; name: string; space_id: string; space_name: string | null };
export type SearchList = {
  id: string;
  name: string;
  folder_id: string | null;
  folder_name: string | null;
  space_id: string;
  space_name: string | null;
};
export type SearchTask = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  // space_status category for the task's status ('todo' | 'active' | 'done' |
  // 'closed'), resolved server-side by joining space_statuses. Null when the
  // status has no matching space_status row (e.g. catalog 'task' types whose
  // status is already a plain 'done'/'closed' string). Prefer this over `status`
  // for completion checks — a renamed done-category status (name !== 'done')
  // only reads as completed via its category.
  category: string | null;
  priority: string | null;
  due_date: string | null;
  display_number: number | null;
  list_id: string;
  list_name: string | null;
  folder_id: string | null;
  folder_name: string | null;
  space_id: string | null;
  space_name: string | null;
};
export type SearchChannel = { id: string; name: string };
export type SearchMember = WorkspaceMember;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function ciIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

export function useWorkspaceSearch(workspaceId: string | undefined, query: string) {
  const q = query.trim();
  const debouncedQ = useDebounced(q, 150);
  const lowerQ = q.toLowerCase();

  const { data: spaces = [] } = useSpaces(workspaceId);
  const channelsRaw = useWorkspaceStore((s) => s.channels);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);

  // Spaces are matched client-side for instant results while typing (the
  // /pm/spaces cache is already loaded for the sidebar) and merged with the
  // server-side matches below, so nothing the sidebar list filters out is
  // missed. Folders and lists have no client-side cache — the sidebar loads
  // them per space via /pm/spaces/:id — so they come from the server search.
  const clientSpaces: SearchSpace[] = useMemo(() => {
    if (!q) return [];
    return ((spaces as Space[]) || [])
      .filter((s) => ciIncludes(s.name, lowerQ))
      .map((s) => ({ id: s.id, name: s.name }));
  }, [spaces, lowerQ, q]);

  const filteredChannels: SearchChannel[] = useMemo(() => {
    if (!q) return [];
    return ((channelsRaw as Channel[]) || [])
      .filter((c) => ciIncludes(c.name, lowerQ))
      .slice(0, PER_CATEGORY_LIMIT)
      .map((c) => ({ id: c.id, name: c.name }));
  }, [channelsRaw, lowerQ, q]);

  const filteredMembers: SearchMember[] = useMemo(() => {
    if (!q) return [];
    return (members || [])
      .filter(
        (m) =>
          ciIncludes(m.display_name, lowerQ) || ciIncludes(m.email, lowerQ),
      )
      .slice(0, PER_CATEGORY_LIMIT);
  }, [members, lowerQ, q]);

  const pmSearchQuery = useQuery<{ tasks: SearchTask[]; descriptions: SearchTask[]; spaces?: SearchSpace[]; folders?: SearchFolder[]; lists?: SearchList[] }>({
    queryKey: ['pm-search', workspaceId, debouncedQ, 'descriptions'],
    queryFn: async () => {
      const res = await api.get('/pm/search', {
        params: { workspace_id: workspaceId, q: debouncedQ, limit: PER_CATEGORY_LIMIT, include_descriptions: true },
      });
      return {
        tasks: (res.data?.data?.tasks || []) as SearchTask[],
        descriptions: (res.data?.data?.descriptions || []) as SearchTask[],
        spaces: (res.data?.data?.spaces || []) as SearchSpace[],
        folders: (res.data?.data?.folders || []) as SearchFolder[],
        lists: (res.data?.data?.lists || []) as SearchList[],
      };
    },
    enabled: !!workspaceId && debouncedQ.length > 0,
    staleTime: 30_000,
  });

  // Chat message content, across every channel + DM the user can read in this
  // workspace. Channel *names* are matched client-side above (filteredChannels);
  // this searches the message bodies themselves.
  const messagesQuery = useQuery<MessageSearchResult[]>({
    queryKey: ['message-search', `ws:${workspaceId ?? ''}`, debouncedQ, PER_CATEGORY_LIMIT],
    queryFn: async () => {
      const res = await api.get('/messages/search', {
        params: { workspace_id: workspaceId, q: debouncedQ, limit: PER_CATEGORY_LIMIT },
      });
      return (res.data?.data?.messages || []) as MessageSearchResult[];
    },
    enabled: !!workspaceId && debouncedQ.length > 0,
    staleTime: 30_000,
  });

  // Instant client matches first, then server matches fill any gaps (deduped
  // by id) — the server covers spaces the sidebar list itself filters out.
  const mergedSpaces: SearchSpace[] = useMemo(() => {
    if (!q) return [];
    const seen = new Set<string>();
    const merged: SearchSpace[] = [];
    for (const s of [...clientSpaces, ...(pmSearchQuery.data?.spaces ?? [])]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      merged.push(s);
      if (merged.length >= PER_CATEGORY_LIMIT) break;
    }
    return merged;
  }, [clientSpaces, pmSearchQuery.data, q]);

  return {
    spaces: mergedSpaces,
    folders: pmSearchQuery.data?.folders ?? [],
    lists: pmSearchQuery.data?.lists ?? [],
    tasks: pmSearchQuery.data?.tasks ?? [],
    descriptions: pmSearchQuery.data?.descriptions ?? [],
    channels: filteredChannels,
    members: filteredMembers,
    messages: messagesQuery.data ?? [],
    isLoading: pmSearchQuery.isFetching || messagesQuery.isFetching,
  };
}
