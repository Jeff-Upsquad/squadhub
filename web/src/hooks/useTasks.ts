import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Task, SpaceStatus, TaskComment, TaskMetadata, TaskRecurrence, Space, List, TaskListPath } from '@squadhub/shared';
import { getTaskStatusCategory } from '@squadhub/shared';
import { showToastCard } from '../components/Toast';
import { usePMStore } from '../stores/pmStore';

// Invalidate every query key that contributes to a task-list UI so all views
// (List, Folder, Space, My Tasks, Emergency, Day Planner) refresh after a
// mutation without requiring the user to reload.
function invalidateTaskLists(qc: QueryClient, listId: string | null) {
  qc.invalidateQueries({ queryKey: ['tasks', listId] });
  qc.invalidateQueries({ queryKey: ['folder-tasks'] });
  qc.invalidateQueries({ queryKey: ['space-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks-summary'] });
  qc.invalidateQueries({ queryKey: ['emergency-tasks'] });
  // Day Planner candidate list depends on due_date / work_date / start_date /
  // focused_at — any task edit can flip membership, so re-evaluate on server.
  // Clearing a date or unfocusing here will drop the task from the list.
  qc.invalidateQueries({ queryKey: ['day-planner'] });
  // Day Planner calendar blocks pull a hydrated task summary (title/status) —
  // refresh those too so a "done" task greys out as soon as it's completed.
  qc.invalidateQueries({ queryKey: ['day-plans'] });
}

export function useTasks(listId: string | null, filters?: { status?: string; priority?: string; sort?: string; includeSubtasks?: boolean }) {
  return useQuery<Task[]>({
    queryKey: ['tasks', listId, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ list_id: listId! });
      if (filters?.status) params.set('status', filters.status);
      if (filters?.priority) params.set('priority', filters.priority);
      if (filters?.sort) params.set('sort', filters.sort);
      // Include subtasks as their own flat rows (each shows its parent) instead
      // of hiding them. Default endpoint behaviour still filters them out.
      if (filters?.includeSubtasks) params.set('include_subtasks', 'true');
      const res = await api.get(`/pm/tasks?${params}`);
      return res.data.data;
    },
    enabled: !!listId,
  });
}

export function useEmergencyTasks() {
  return useQuery<Task[]>({
    queryKey: ['emergency-tasks'],
    queryFn: async () => {
      const res = await api.get('/pm/tasks/emergency');
      return res.data.data;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export type MyTasksBuckets = {
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  upcoming: Task[];
  later: Task[];
  focused: Task[];
  // Tasks the caller has logged time on today (user tz), most-recent first.
  // Surfaced as the "In progress today" section above the Home focus list.
  in_progress_today: Task[];
};

export function useMyTasks() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useQuery<MyTasksBuckets>({
    queryKey: ['my-tasks', tz],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/my?${new URLSearchParams({ tz }).toString()}`);
      return res.data.data;
    },
    staleTime: 30_000,
  });
}

export type PersonalSpace = { space: Space; list: List };

/**
 * The caller's private personal space + its default list (get-or-create on the
 * server). Backs the "My Tasks" view and the desktop quick-add. Only the owner
 * can see it; it's hidden from the normal Spaces sidebar. Rarely changes, so a
 * long staleTime keeps it cached across navigation.
 */
export function usePersonalList() {
  return useQuery<PersonalSpace>({
    queryKey: ['personal-space'],
    queryFn: async () => {
      const res = await api.get('/pm/personal');
      return res.data.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useTask(taskId: string | null) {
  return useQuery<Task>({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/${taskId}`);
      return res.data.data;
    },
    enabled: !!taskId,
  });
}

export function useCreateTask(listId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      title: string;
      status?: string;
      priority?: string;
      description?: string;
      due_date?: string;
      work_date?: string;
      start_date?: string;
      assignee_ids?: string[];
      metadata?: TaskMetadata;
      list_id?: string;
      parent_task_id?: string | null;
      task_type_id?: string | null;
      recurrence?: TaskRecurrence | null;
    }) => {
      const targetListId = body.list_id || listId;
      const res = await api.post('/pm/tasks', { ...body, list_id: targetListId });
      return res.data.data;
    },
    onSuccess: (data, vars) => {
      const targetListId = vars.list_id || listId;
      invalidateTaskLists(qc, targetListId);
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      if (vars.parent_task_id) {
        qc.invalidateQueries({ queryKey: ['task', vars.parent_task_id] });
      }
      if (data?.id) {
        showToastCard({
          subtitle: vars.parent_task_id ? 'New subtask' : 'New task',
          title: data.title || vars.title || 'Untitled task',
          onClick: () => usePMStore.getState().setActiveTask(data.id),
        });
      }
    },
  });
}

export function useUpdateTask(listId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: {
      id: string;
      title?: string;
      status?: string;
      priority?: string;
      description?: string | null;
      due_date?: string | null;
      work_date?: string | null;
      start_date?: string | null;
      task_type_id?: string | null;
      time_estimate?: number | null;
      time_tracked?: number;
      assignee_ids?: string[];
      metadata?: TaskMetadata;
      list_id?: string;
      recurrence?: TaskRecurrence | null;
    }) => {
      const res = await api.put(`/pm/tasks/${id}`, body);
      return res.data.data;
    },
    // Optimistic update — patch cached task data immediately so the UI updates
    // without waiting for the server round-trip. Captures snapshots for rollback.
    onMutate: async (vars) => {
      const taskKey = ['task', vars.id];
      // Cancel in-flight refetches so they don't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: taskKey });

      const snapshots: Array<[readonly unknown[], unknown]> = [];
      const patch = (() => {
        const { id: _id, ...rest } = vars;
        return rest as Record<string, unknown>;
      })();

      // Patch single-task cache (open view)
      const prevTask = qc.getQueryData(taskKey);
      if (prevTask !== undefined) {
        snapshots.push([taskKey, prevTask]);
        qc.setQueryData(taskKey, (old: unknown) => (old && typeof old === 'object' ? { ...(old as object), ...patch } : old));
      }

      // Patch every list / folder / space task query that contains this task
      const patchInArray = (arr: unknown): unknown => {
        if (!Array.isArray(arr)) return arr;
        let changed = false;
        const next = arr.map((t) => {
          if (t && typeof t === 'object' && (t as { id?: string }).id === vars.id) {
            changed = true;
            return { ...(t as object), ...patch };
          }
          return t;
        });
        return changed ? next : arr;
      };

      for (const [key, data] of qc.getQueriesData({ queryKey: ['tasks'] })) {
        const next = patchInArray(data);
        if (next !== data) {
          snapshots.push([key, data]);
          qc.setQueryData(key, next);
        }
      }
      for (const queryKey of [['folder-tasks'], ['space-tasks']] as const) {
        for (const [key, data] of qc.getQueriesData({ queryKey: queryKey as readonly unknown[] })) {
          // folder-tasks / space-tasks shape: { listId, listName, tasks: Task[], ... }
          if (data && typeof data === 'object' && 'tasks' in data) {
            const tasks = (data as { tasks?: unknown }).tasks;
            const nextTasks = patchInArray(tasks);
            if (nextTasks !== tasks) {
              snapshots.push([key, data]);
              qc.setQueryData(key, { ...(data as object), tasks: nextTasks });
            }
          }
        }
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      const snapshots = (context as { snapshots?: Array<[readonly unknown[], unknown]> } | undefined)?.snapshots;
      if (snapshots) {
        for (const [key, data] of snapshots) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSuccess: (_data, vars) => {
      invalidateTaskLists(qc, listId);
      if (vars.list_id && vars.list_id !== listId) {
        invalidateTaskLists(qc, vars.list_id);
        qc.invalidateQueries({ queryKey: ['list', vars.list_id] });
      }
      qc.invalidateQueries({ queryKey: ['task', vars.id] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      // Keep My Home's "New Tasks" review queue in sync — completing/closing a task
      // (e.g. from the detail panel opened off a New Tasks row) should drop it from the list.
      qc.invalidateQueries({ queryKey: ['new-tasks'] });
    },
  });
}

// Manual edit of task.time_tracked. Requires can_edit_time_logs on primary role server-side.
export function useUpdateTaskTimeTracked(listId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, time_tracked }: { id: string; time_tracked: number }) => {
      const res = await api.patch(`/pm/tasks/${id}/time-tracked`, { time_tracked });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      invalidateTaskLists(qc, listId);
      qc.invalidateQueries({ queryKey: ['task', vars.id] });
      qc.invalidateQueries({ queryKey: ['task-time-entries'] });
      qc.invalidateQueries({ queryKey: ['folder-time-summary'] });
    },
  });
}

export function useDeleteTask(listId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      await api.delete(`/pm/tasks/${taskId}`);
      return taskId;
    },
    onSuccess: (taskId) => {
      invalidateTaskLists(qc, listId);
      qc.removeQueries({ queryKey: ['task', taskId] });
    },
  });
}

// Every list a task belongs to: primary (is_primary) + added links, each as a
// resolved space → folder → list path. Backs the secondary-list breadcrumbs and
// the remove (×) controls on the task detail panel.
export function useTaskLists(taskId: string | null) {
  return useQuery<TaskListPath[]>({
    queryKey: ['task-lists', taskId],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/${taskId}/lists`);
      return res.data.data;
    },
    enabled: !!taskId,
  });
}

// Add a task to one or more additional lists (multi-homing). Refreshes the
// task's list-path strip and every newly-targeted list view.
export function useAddTaskToLists(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listIds: string[]) => {
      const res = await api.post(`/pm/tasks/${taskId}/lists`, { list_ids: listIds });
      return res.data.data as { added: string[] };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['task-lists', taskId] });
      for (const lid of data?.added || []) invalidateTaskLists(qc, lid);
    },
  });
}

// Remove a task from one added list (its primary list can't be removed here).
export function useRemoveTaskFromList(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: string) => {
      await api.delete(`/pm/tasks/${taskId}/lists/${listId}`);
      return listId;
    },
    onSuccess: (listId) => {
      qc.invalidateQueries({ queryKey: ['task-lists', taskId] });
      invalidateTaskLists(qc, listId);
    },
  });
}

export function useTaskComments(taskId: string | null) {
  return useQuery<TaskComment[]>({
    queryKey: ['task-comments', taskId],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/${taskId}/comments`);
      return res.data.data;
    },
    enabled: !!taskId,
  });
}

export function useAddComment(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { content: string; mentions?: string[] }) => {
      const payload = typeof input === 'string' ? { content: input } : input;
      const res = await api.post(`/pm/tasks/${taskId}/comments`, payload);
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-comments', taskId] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });
}

// Helper: group tasks by status. For task_type='task' tasks, task.status holds
// a TASK_STATUS_CATALOG key — resolve it to the legacy 4-bucket category so the
// same board layout keeps working.
//
// `fadingMap` is REQUIRED (not optional) so callers can't silently re-open the
// task-completion-animation regression. For fading tasks we read the pre-fade
// status snapshot instead of `task.status` (which has already been flipped by
// the optimistic update in useUpdateTask.onMutate) so the row stays in its
// original status bucket while the CSS slide-out plays. Pass EMPTY_FADING_MAP
// only from genuine non-UI contexts.
export function groupTasksByStatus(
  tasks: Task[],
  statuses: SpaceStatus[],
  fadingMap: ReadonlyMap<string, string>,
) {
  const groups: { status: SpaceStatus; tasks: Task[] }[] = [];
  for (const status of statuses) {
    groups.push({
      status,
      tasks: tasks.filter((t) => {
        const snapshot = fadingMap.get(t.id);
        const raw = snapshot !== undefined
          ? snapshot
          : ((t as any).status as string | undefined);
        if (!raw) return false;
        if (raw === status.category) return true;
        const mapped = getTaskStatusCategory(raw);
        return mapped === status.category;
      }),
    });
  }
  return groups;
}
