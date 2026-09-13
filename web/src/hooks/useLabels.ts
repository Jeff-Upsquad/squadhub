import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { LabelPickerData, TaskTag } from '@squadhub/shared';

// Groups + labels visible to the current user for a task, plus a can_create flag.
export function useLabelPicker(taskId: string | null, enabled: boolean) {
  return useQuery<LabelPickerData>({
    queryKey: ['label-picker', taskId],
    queryFn: async () => (await api.get('/pm/labels', { params: { task_id: taskId } })).data.data,
    enabled: !!taskId && enabled,
  });
}

// Same picker data scoped by list — for a task that doesn't exist yet (the
// create panel picks labels before the row exists, then attaches them).
export function useListLabelPicker(listId: string | null, enabled: boolean) {
  return useQuery<LabelPickerData>({
    queryKey: ['label-picker', 'list', listId],
    queryFn: async () => (await api.get('/pm/labels', { params: { list_id: listId } })).data.data,
    enabled: !!listId && enabled,
  });
}

// Every query key that can render a task's tag pills. Mirrors
// invalidateTaskLists in useTasks — attach/detach must refresh all of them or
// the tag only appears after a manual refresh when returning to that view.
function invalidateAllTagViews(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['tasks'] });
  qc.invalidateQueries({ queryKey: ['folder-tasks'] });
  qc.invalidateQueries({ queryKey: ['space-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks-summary'] });
  qc.invalidateQueries({ queryKey: ['day-planner'] });
  qc.invalidateQueries({ queryKey: ['day-plans'] });
  qc.invalidateQueries({ queryKey: ['new-tasks'] });
  qc.invalidateQueries({ queryKey: ['emergency-tasks'] });
}

type Snapshot = [readonly unknown[], unknown];

// Patch the `tags` array of every cached copy of a task (single-task cache,
// flat list arrays, folder/space { tasks } wrappers, my-tasks buckets, and
// parent-detail `subtasks` rows) so the tag pill updates instantly without
// waiting for the refetch. Returns snapshots for rollback.
function patchTagsEverywhere(
  qc: QueryClient,
  taskId: string,
  patch: (tags: TaskTag[]) => TaskTag[],
): Snapshot[] {
  const snapshots: Snapshot[] = [];

  const patchOne = (t: unknown): unknown => {
    if (!t || typeof t !== 'object') return t;
    const task = t as { id?: string; tags?: TaskTag[]; subtasks?: unknown };
    if (task.id === taskId) {
      return { ...task, tags: patch(Array.isArray(task.tags) ? task.tags : []) };
    }
    // Parent detail embeds shallow subtask rows — patch those too.
    if (Array.isArray(task.subtasks)) {
      let changed = false;
      const nextSubs = (task.subtasks as unknown[]).map((s) => {
        const p = patchOne(s);
        if (p !== s) changed = true;
        return p;
      });
      if (changed) return { ...task, subtasks: nextSubs };
    }
    return t;
  };

  const patchArray = (arr: unknown): unknown => {
    if (!Array.isArray(arr)) return arr;
    let changed = false;
    const next = arr.map((t) => {
      const p = patchOne(t);
      if (p !== t) changed = true;
      return p;
    });
    return changed ? next : arr;
  };

  // Single-task cache.
  const taskKey = ['task', taskId] as const;
  const prevTask = qc.getQueryData(taskKey);
  if (prevTask !== undefined) {
    const next = patchOne(prevTask);
    if (next !== prevTask) {
      snapshots.push([taskKey, prevTask]);
      qc.setQueryData(taskKey, next);
    }
  }

  // Flat list queries (useTasks: ['tasks', listId, filters]).
  for (const [key, data] of qc.getQueriesData({ queryKey: ['tasks'] })) {
    const next = patchArray(data);
    if (next !== data) {
      snapshots.push([key, data]);
      qc.setQueryData(key, next);
    }
  }

  // folder-tasks / space-tasks wrappers: { tasks: Task[] }.
  for (const qk of [['folder-tasks'], ['space-tasks']] as const) {
    for (const [key, data] of qc.getQueriesData({ queryKey: qk as readonly unknown[] })) {
      if (data && typeof data === 'object' && 'tasks' in data) {
        const tasks = (data as { tasks?: unknown }).tasks;
        const nextTasks = patchArray(tasks);
        if (nextTasks !== tasks) {
          snapshots.push([key, data]);
          qc.setQueryData(key, { ...(data as object), tasks: nextTasks });
        }
      }
    }
  }

  // my-tasks buckets: { overdue: Task[], today: Task[], ... }.
  for (const [key, data] of qc.getQueriesData({ queryKey: ['my-tasks'] })) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      let changed = false;
      const nextObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        const nv = Array.isArray(v) ? patchArray(v) : v;
        nextObj[k] = nv;
        if (nv !== v) changed = true;
      }
      if (changed) {
        snapshots.push([key, data]);
        qc.setQueryData(key, nextObj);
      }
    }
  }

  // Any other parent detail whose `subtasks` embed this task.
  for (const [key, data] of qc.getQueriesData({ queryKey: ['task'] })) {
    if (key.length === 2 && key[1] === taskId) continue; // already patched above
    const next = patchOne(data);
    if (next !== data) {
      snapshots.push([key, data]);
      qc.setQueryData(key, next);
    }
  }

  return snapshots;
}

function rollback(qc: QueryClient, snapshots: Snapshot[]) {
  for (const [key, data] of snapshots) qc.setQueryData(key, data);
}

// Look up a full TaskTag from the picker cache so attach can optimistically
// render the real pill (name + color) before the server round-trips.
function findCachedTag(qc: QueryClient, taskId: string, tagId: string): TaskTag | null {
  const picker = qc.getQueryData<LabelPickerData>(['label-picker', taskId]);
  for (const g of picker?.groups || []) {
    const found = g.labels.find((l) => l.id === tagId);
    if (found) return found;
  }
  return null;
}

// Inline-create a label (gated server-side by can_create).
export function useCreateLabel(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; group_id?: string; color?: string }) =>
      (await api.post('/pm/labels', { ...vars, task_id: taskId })).data.data as TaskTag,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['label-picker', taskId] }),
  });
}

// Recolor / rename a label inline (gated server-side by can_create).
export function useUpdateLabel(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; name?: string; color?: string }) =>
      (await api.put(`/pm/labels/${vars.id}`, { ...vars, task_id: taskId })).data.data as TaskTag,
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['label-picker', taskId] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      // Rename/recolor must propagate to every cached row rendering that tag.
      if (updated?.id) {
        const applyRename = (tags: TaskTag[]) =>
          tags.map((t) => (t.id === updated.id ? { ...t, ...updated } : t));
        for (const [key, data] of qc.getQueriesData({ queryKey: ['tasks'] })) {
          if (!Array.isArray(data)) continue;
          let changed = false;
          const next = (data as { id: string; tags?: TaskTag[] }[]).map((task) => {
            if (!Array.isArray(task.tags) || !task.tags.some((t) => t.id === updated.id)) return task;
            changed = true;
            return { ...task, tags: applyRename(task.tags) };
          });
          if (changed) qc.setQueryData(key, next);
        }
        for (const qk of [['folder-tasks'], ['space-tasks']] as const) {
          for (const [key, data] of qc.getQueriesData({ queryKey: qk as readonly unknown[] })) {
            if (!data || typeof data !== 'object' || !('tasks' in data)) continue;
            const tasks = (data as { tasks?: { id: string; tags?: TaskTag[] }[] }).tasks;
            if (!Array.isArray(tasks)) continue;
            let changed = false;
            const nextTasks = tasks.map((task) => {
              if (!Array.isArray(task.tags) || !task.tags.some((t) => t.id === updated.id)) return task;
              changed = true;
              return { ...task, tags: applyRename(task.tags) };
            });
            if (changed) qc.setQueryData(key, { ...(data as object), tasks: nextTasks });
          }
        }
      }
      invalidateAllTagViews(qc);
    },
  });
}

export function useAttachLabel(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) =>
      (await api.post(`/pm/tasks/${taskId}/labels`, { tag_id: tagId })).data.data as TaskTag,
    onMutate: async (tagId) => {
      await qc.cancelQueries({ queryKey: ['task', taskId] });
      const optimisticTag = findCachedTag(qc, taskId, tagId);
      // Without the picker cache we can't render the real pill yet — skip the
      // optimistic patch and rely on the onSuccess patch + refetch instead.
      if (!optimisticTag) return { snapshots: [] as Snapshot[] };
      const snapshots = patchTagsEverywhere(qc, taskId, (tags) =>
        tags.some((t) => t.id === tagId) ? tags : [...tags, optimisticTag],
      );
      return { snapshots };
    },
    onError: (_err, _tagId, context) => {
      if (context?.snapshots) rollback(qc, context.snapshots);
    },
    onSuccess: (attached) => {
      // Authoritative patch with the server-returned tag (covers the case
      // where the optimistic patch was skipped), then refetch every view.
      if (attached?.id) {
        patchTagsEverywhere(qc, taskId, (tags) =>
          tags.some((t) => t.id === attached.id) ? tags : [...tags, attached],
        );
      }
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['label-picker', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
      // List rows now render tag pills — refresh them so attach shows instantly.
      invalidateAllTagViews(qc);
    },
  });
}

export function useDetachLabel(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) => {
      await api.delete(`/pm/tasks/${taskId}/labels/${tagId}`);
      return tagId;
    },
    onMutate: async (tagId) => {
      await qc.cancelQueries({ queryKey: ['task', taskId] });
      const snapshots = patchTagsEverywhere(qc, taskId, (tags) =>
        tags.filter((t) => t.id !== tagId),
      );
      return { snapshots };
    },
    onError: (_err, _tagId, context) => {
      if (context?.snapshots) rollback(qc, context.snapshots);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['label-picker', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
      invalidateAllTagViews(qc);
    },
  });
}

// Request a label that doesn't exist yet (lands in the admin inbox).
export function useRequestLabel(taskId: string) {
  return useMutation({
    mutationFn: async (vars: { name: string; note?: string }) =>
      (await api.post('/pm/label-requests', { ...vars, task_id: taskId })).data.data,
  });
}
