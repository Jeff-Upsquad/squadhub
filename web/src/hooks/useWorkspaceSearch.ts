import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Channel, Folder, List, Space } from '@squadhub/shared';
import api from '../services/api';
import { useSpaces } from './useSpaces';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useWorkspaceMembers, type WorkspaceMember } from './useWorkspaceMembers';

const PER_CATEGORY_LIMIT = 8;

type SpaceWithChildren = Space & {
  folders?: (Folder & { lists?: List[] })[];
  lists?: List[];
};

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

  // Flatten folders + lists out of the spaces tree
  const { allFolders, allLists } = useMemo(() => {
    const f: SearchFolder[] = [];
    const l: SearchList[] = [];
    for (const space of (spaces as SpaceWithChildren[]) || []) {
      for (const folder of space.folders || []) {
        f.push({
          id: folder.id,
          name: folder.name,
          space_id: space.id,
          space_name: space.name,
        });
        for (const list of folder.lists || []) {
          l.push({
            id: list.id,
            name: list.name,
            folder_id: folder.id,
            folder_name: folder.name,
            space_id: space.id,
            space_name: space.name,
          });
        }
      }
      for (const list of space.lists || []) {
        l.push({
          id: list.id,
          name: list.name,
          folder_id: null,
          folder_name: null,
          space_id: space.id,
          space_name: space.name,
        });
      }
    }
    return { allFolders: f, allLists: l };
  }, [spaces]);

  const filteredSpaces: SearchSpace[] = useMemo(() => {
    if (!q) return [];
    return ((spaces as SpaceWithChildren[]) || [])
      .filter((s) => ciIncludes(s.name, lowerQ))
      .slice(0, PER_CATEGORY_LIMIT)
      .map((s) => ({ id: s.id, name: s.name }));
  }, [spaces, lowerQ, q]);

  const filteredFolders: SearchFolder[] = useMemo(() => {
    if (!q) return [];
    return allFolders
      .filter((f) => ciIncludes(f.name, lowerQ))
      .slice(0, PER_CATEGORY_LIMIT);
  }, [allFolders, lowerQ, q]);

  const filteredLists: SearchList[] = useMemo(() => {
    if (!q) return [];
    return allLists
      .filter((l) => ciIncludes(l.name, lowerQ))
      .slice(0, PER_CATEGORY_LIMIT);
  }, [allLists, lowerQ, q]);

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

  const tasksQuery = useQuery<SearchTask[]>({
    queryKey: ['pm-search', workspaceId, debouncedQ],
    queryFn: async () => {
      const res = await api.get('/pm/search', {
        params: { workspace_id: workspaceId, q: debouncedQ, limit: PER_CATEGORY_LIMIT },
      });
      return (res.data?.data?.tasks || []) as SearchTask[];
    },
    enabled: !!workspaceId && debouncedQ.length > 0,
    staleTime: 30_000,
  });

  return {
    spaces: filteredSpaces,
    folders: filteredFolders,
    lists: filteredLists,
    tasks: tasksQuery.data ?? [],
    channels: filteredChannels,
    members: filteredMembers,
    isLoading: tasksQuery.isFetching,
  };
}
