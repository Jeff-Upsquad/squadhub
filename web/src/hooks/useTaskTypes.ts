import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { TaskType } from '@squadhub/shared';

export interface UseTaskTypesOptions {
  spaceId?: string;
  folderId?: string | null;
  listId?: string | null;
  includeIds?: string[];
  enabled?: boolean;
}

export function useTaskTypes(options?: UseTaskTypesOptions) {
  const spaceId = options?.spaceId;
  const folderId = options?.folderId;
  const listId = options?.listId;
  const includeIds = options?.includeIds;
  const includeIdsKey = includeIds?.slice().sort().join(',');

  return useQuery<TaskType[]>({
    queryKey: ['task-types', { spaceId, folderId, listId, includeIdsKey }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (spaceId) params.set('space_id', spaceId);
      if (folderId) params.set('folder_id', folderId);
      if (listId) params.set('list_id', listId);
      if (includeIdsKey) params.set('include_ids', includeIdsKey);
      const queryStr = params.toString();
      const url = `/pm/task-types${queryStr ? `?${queryStr}` : ''}`;
      const res = await api.get(url);
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled !== false,
  });
}
