import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { TaskAttachment } from '@squadhub/shared';

export function useTaskAttachments(taskId: string | null) {
  return useQuery<TaskAttachment[]>({
    queryKey: ['task-attachments', taskId],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/${taskId}/attachments`);
      return res.data.data;
    },
    enabled: !!taskId,
  });
}

export function useDeleteTaskAttachment(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/pm/task-attachments/${id}`);
      return res.data;
    },
    onSuccess: () => {
      if (taskId) qc.invalidateQueries({ queryKey: ['task-attachments', taskId] });
    },
  });
}
