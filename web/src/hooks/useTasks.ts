import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Task, SpaceStatus, TaskComment, TaskMetadata } from '@squadhub/shared';
import { getTaskStatusCategory } from '@squadhub/shared';

// Invalidate every query key that contributes to a task-list UI so all views
// (List, Folder, Space, My Tasks, Emergency) refresh after a mutation without
// requiring the user to reload.
function invalidateTaskLists(qc: QueryClient, listId: string | null) {
  qc.invalidateQueries({ queryKey: ['tasks', listId] });
  qc.invalidateQueries({ queryKey: ['folder-tasks'] });
  qc.invalidateQueries({ queryKey: ['space-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks-summary'] });
  qc.invalidateQueries({ queryKey: ['emergency-tasks'] });
}

export function useTasks(listId: string | null, filters?: { status?: string; priority?: string; sort?: string }) {
  return useQuery<Task[]>({
    queryKey: ['tasks', listId, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ list_id: listId! });
      if (filters?.status) params.set('status', filters.status);
      if (filters?.priority) params.set('priority', filters.priority);
      if (filters?.sort) params.set('sort', filters.sort);
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
};

export function useMyTasks() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useQuery<MyTasksBuckets>({
    queryKey: ['my-tasks', tz],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/my?tz=${encodeURIComponent(tz)}`);
      return res.data.data;
    },
    staleTime: 30_000,
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
    }) => {
      const targetListId = body.list_id || listId;
      const res = await api.post('/pm/tasks', { ...body, list_id: targetListId });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      const targetListId = vars.list_id || listId;
      invalidateTaskLists(qc, targetListId);
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      if (vars.parent_task_id) {
        qc.invalidateQueries({ queryKey: ['task', vars.parent_task_id] });
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
    }) => {
      const res = await api.put(`/pm/tasks/${id}`, body);
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      invalidateTaskLists(qc, listId);
      qc.invalidateQueries({ queryKey: ['task', vars.id] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
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
export function groupTasksByStatus(tasks: Task[], statuses: SpaceStatus[]) {
  const groups: { status: SpaceStatus; tasks: Task[] }[] = [];
  for (const status of statuses) {
    groups.push({
      status,
      tasks: tasks.filter((t) => {
        const raw = (t as any).status as string | undefined;
        if (!raw) return false;
        if (raw === status.category) return true;
        const mapped = getTaskStatusCategory(raw);
        return mapped === status.category;
      }),
    });
  }
  return groups;
}
