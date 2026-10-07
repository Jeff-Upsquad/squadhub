import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { TaskTypeGroup, TaskType } from '@squadhub/shared';

export function useTaskTypeGroups() {
  return useQuery<TaskTypeGroup[]>({
    queryKey: ['pm-task-type-groups'],
    queryFn: async () => {
      const res = await api.get('/pm/task-type-groups');
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useEffectiveTaskTypeGroup(opts: {
  spaceId?: string;
  folderId?: string | null;
  listId?: string | null;
  enabled?: boolean;
}) {
  const { spaceId, folderId, listId, enabled = true } = opts;
  return useQuery<{
    group: TaskTypeGroup | null;
    assignment: {
      group_id: string;
      entity_type: string | null;
      entity_id: string | null;
      is_default_fallback: boolean;
    } | null;
    task_types: TaskType[];
  }>({
    queryKey: ['pm-effective-task-type-group', { spaceId, folderId, listId }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (spaceId) params.set('space_id', spaceId);
      if (folderId) params.set('folder_id', folderId);
      if (listId) params.set('list_id', listId);
      const res = await api.get(`/pm/task-type-groups/effective?${params.toString()}`);
      return res.data.data;
    },
    enabled: enabled && !!(spaceId || folderId || listId),
    staleTime: 5 * 60 * 1000,
  });
}
