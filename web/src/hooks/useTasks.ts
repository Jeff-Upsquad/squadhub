import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Task, SpaceStatus, TaskComment, TaskMetadata } from '@squadhub/shared';

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
      assignee_ids?: string[];
      metadata?: TaskMetadata;
      list_id?: string;
    }) => {
      const targetListId = body.list_id || listId;
      const res = await api.post('/pm/tasks', { ...body, list_id: targetListId });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      const targetListId = vars.list_id || listId;
      qc.invalidateQueries({ queryKey: ['tasks', targetListId] });
      qc.invalidateQueries({ queryKey: ['folder-tasks'] });
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
      metadata?: TaskMetadata;
    }) => {
      const res = await api.put(`/pm/tasks/${id}`, body);
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks', listId] });
      qc.invalidateQueries({ queryKey: ['task', vars.id] });
    },
  });
}

export function useDeleteTask(listId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      await api.delete(`/pm/tasks/${taskId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', listId] });
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
    mutationFn: async (content: string) => {
      const res = await api.post(`/pm/tasks/${taskId}/comments`, { content });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-comments', taskId] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });
}

// Helper: group tasks by status — matches task.status (text) to spaceStatus.category
export function groupTasksByStatus(tasks: Task[], statuses: SpaceStatus[]) {
  const groups: { status: SpaceStatus; tasks: Task[] }[] = [];
  for (const status of statuses) {
    groups.push({
      status,
      tasks: tasks.filter((t) => (t as any).status === status.category),
    });
  }
  return groups;
}
