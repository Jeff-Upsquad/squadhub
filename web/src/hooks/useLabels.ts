import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

// Inline-create a label (gated server-side by can_create).
export function useCreateLabel(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; group_id?: string }) =>
      (await api.post('/pm/labels', { ...vars, task_id: taskId })).data.data as TaskTag,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['label-picker', taskId] }),
  });
}

export function useAttachLabel(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) =>
      (await api.post(`/pm/tasks/${taskId}/labels`, { tag_id: tagId })).data.data as TaskTag,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['label-picker', taskId] });
    },
  });
}

export function useDetachLabel(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) => {
      await api.delete(`/pm/tasks/${taskId}/labels/${tagId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['label-picker', taskId] });
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
