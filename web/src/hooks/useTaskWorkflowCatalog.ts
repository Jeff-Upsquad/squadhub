import { useQuery } from '@tanstack/react-query';
import {
  TASK_STATUS_CATALOG,
  registerTaskStatusDefs,
  statusGroupRowToTaskDef,
  type StatusGroupStatus,
  type TaskStatusDef,
} from '@squadhub/shared';
import api from '../services/api';

/**
 * Managed generic-task statuses (admin > Status Groups > Task Workflow).
 * Returns the managed rows mapped to the catalog shape, or the static
 * TASK_STATUS_CATALOG fallback when the group is missing/disabled/offline.
 * Managed rows are also published via registerTaskStatusDefs so every
 * getTaskStatusDef / getTaskStatusCategory call site (boards, calendars,
 * detail panels) resolves managed values automatically.
 * Cached aggressively — admin edits land on refetch/invalidation.
 */
export interface TaskWorkflowCatalogOptions {
  spaceId?: string | null;
  folderId?: string | null;
  listId?: string | null;
}

export function useTaskWorkflowCatalog(options?: TaskWorkflowCatalogOptions) {
  const spaceId = options?.spaceId || null;
  const folderId = options?.folderId || null;
  const listId = options?.listId || null;

  const { data, isLoading } = useQuery({
    queryKey: ['task-workflow-catalog', { spaceId, folderId, listId }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (spaceId) params.set('space_id', spaceId);
      if (folderId) params.set('folder_id', folderId);
      if (listId) params.set('list_id', listId);
      const qs = params.toString();
      return api.get(`/pm/status-groups/effective${qs ? `?${qs}` : ''}`).then((r) => r.data);
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  const group = data?.data?.group || null;
  const assignment = data?.data?.assignment || null;
  const rows: StatusGroupStatus[] | null = data?.data?.statuses || null;

  if (!rows || rows.length === 0) {
    return { defs: TASK_STATUS_CATALOG, group, assignment, managed: false, isLoading };
  }
  const seenKeys = new Set<string>();
  const seenLabels = new Set<string>();
  const defs: TaskStatusDef[] = [];
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    const def = statusGroupRowToTaskDef(row);
    if (!def.key) continue;
    const k = def.key.toLowerCase().trim();
    const l = (def.label || '').toLowerCase().trim();
    if ((k && seenKeys.has(k)) || (l && seenLabels.has(l))) continue;
    if (k) seenKeys.add(k);
    if (l) seenLabels.add(l);
    defs.push(def);
  }
  if (defs.length === 0) {
    return { defs: TASK_STATUS_CATALOG, group, assignment, managed: false, isLoading };
  }
  registerTaskStatusDefs(defs);
  return { defs, group, assignment, managed: true, isLoading };
}

/** Look up one status def from a (possibly managed) catalog list. */
export function findTaskStatusDef(defs: TaskStatusDef[], key: string | null | undefined): TaskStatusDef | null {
  if (!key) return null;
  return defs.find((d) => d.key === key) || null;
}
