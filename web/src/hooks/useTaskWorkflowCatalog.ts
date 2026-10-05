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
export function useTaskWorkflowCatalog() {
  const { data } = useQuery({
    queryKey: ['task-workflow-catalog'],
    queryFn: () =>
      api.get('/pm/status-groups/by-key/task_workflow').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const rows: StatusGroupStatus[] | null = data?.data?.statuses || null;
  if (!rows || rows.length === 0) {
    // Clear any previously registered managed rows so every call site
    // falls back to the static catalog uniformly.
    registerTaskStatusDefs([]);
    return { defs: TASK_STATUS_CATALOG, managed: false };
  }
  const defs: TaskStatusDef[] = [...rows]
    .sort((a, b) => a.position - b.position)
    .map(statusGroupRowToTaskDef)
    .filter((d) => !!d.key);
  if (defs.length === 0) {
    return { defs: TASK_STATUS_CATALOG, managed: false };
  }
  registerTaskStatusDefs(defs);
  return { defs, managed: true };
}

/** Look up one status def from a (possibly managed) catalog list. */
export function findTaskStatusDef(defs: TaskStatusDef[], key: string | null | undefined): TaskStatusDef | null {
  if (!key) return null;
  return defs.find((d) => d.key === key) || null;
}
