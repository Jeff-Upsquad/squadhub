import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { TaskChecklist, TaskChecklistItem } from '@squadhub/shared';

export function useChecklists(taskId: string | null) {
  return useQuery<TaskChecklist[]>({
    queryKey: ['checklists', taskId],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/${taskId}/checklists`);
      return res.data.data;
    },
    enabled: !!taskId,
  });
}

export function useCreateChecklist(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (title?: string) => {
      const res = await api.post(`/pm/tasks/${taskId}/checklists`, { title });
      return res.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklists', taskId] }),
  });
}

export function useUpdateChecklist(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; title?: string }) => {
      await api.put(`/pm/checklists/${id}`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklists', taskId] }),
  });
}

export function useDeleteChecklist(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pm/checklists/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklists', taskId] }),
  });
}

export function useCreateChecklistItem(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ checklistId, content }: { checklistId: string; content: string }) => {
      const res = await api.post(`/pm/checklists/${checklistId}/items`, { content });
      return res.data.data as TaskChecklistItem;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklists', taskId] }),
  });
}

export function useUpdateChecklistItem(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; content?: string; is_done?: boolean }) => {
      await api.put(`/pm/checklist-items/${id}`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklists', taskId] }),
  });
}

export function useDeleteChecklistItem(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pm/checklist-items/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklists', taskId] }),
  });
}
