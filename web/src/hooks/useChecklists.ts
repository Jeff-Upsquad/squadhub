import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { TaskChecklist, TaskChecklistItem } from '@squadhub/shared';

// Tracks in-flight checklist creations by their temporary ID so any items created
// immediately before the checklist ID arrives can resolve to the real checklist ID.
const pendingChecklistCreations = new Map<string, Promise<string>>();

export type CreateChecklistPayload = string | { title?: string; id?: string };

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
    mutationFn: async (payload?: CreateChecklistPayload) => {
      const title = typeof payload === 'string' ? payload : payload?.title;
      const tempId = typeof payload === 'object' ? payload?.id : undefined;

      const postPromise = (async () => {
        const res = await api.post(`/pm/tasks/${taskId}/checklists`, { title });
        return res.data.data as TaskChecklist;
      })();

      if (tempId) {
        pendingChecklistCreations.set(tempId, postPromise.then((data) => data.id));
      }

      try {
        const data = await postPromise;
        return data;
      } finally {
        if (tempId) pendingChecklistCreations.delete(tempId);
      }
    },
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ['checklists', taskId] });
      const previous = qc.getQueryData<TaskChecklist[]>(['checklists', taskId]);
      const tempId = typeof payload === 'object' && payload?.id ? payload.id : `temp-cl-${Date.now()}`;
      const title = typeof payload === 'string' ? payload : payload?.title;

      const optimisticChecklist: TaskChecklist = {
        id: tempId,
        task_id: taskId || '',
        title: title || 'Checklist',
        position: previous?.length ?? 0,
        created_by: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        items: [],
      };

      qc.setQueryData<TaskChecklist[]>(['checklists', taskId], (old = []) => [...(old || []), optimisticChecklist]);
      return { previous, tempId };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['checklists', taskId], context.previous);
      }
    },
    onSuccess: (created, _vars, context) => {
      if (context?.tempId && created?.id) {
        qc.setQueryData<TaskChecklist[]>(['checklists', taskId], (old = []) =>
          (old || []).map((c) => (c.id === context.tempId ? { ...c, ...created, items: c.items || [] } : c))
        );
      }
      qc.invalidateQueries({ queryKey: ['checklists', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
    },
  });
}

export function useUpdateChecklist(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; title?: string }) => {
      await api.put(`/pm/checklists/${id}`, body);
    },
    onMutate: async ({ id, ...body }) => {
      await qc.cancelQueries({ queryKey: ['checklists', taskId] });
      const previous = qc.getQueryData<TaskChecklist[]>(['checklists', taskId]);
      qc.setQueryData<TaskChecklist[]>(['checklists', taskId], (old = []) =>
        (old || []).map((c) => (c.id === id ? { ...c, ...body } : c))
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['checklists', taskId], context.previous);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklists', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
    },
  });
}

export function useDeleteChecklist(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pm/checklists/${id}`);
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['checklists', taskId] });
      const previous = qc.getQueryData<TaskChecklist[]>(['checklists', taskId]);
      qc.setQueryData<TaskChecklist[]>(['checklists', taskId], (old = []) =>
        (old || []).filter((c) => c.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(['checklists', taskId], context.previous);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklists', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
    },
  });
}

export function useCreateChecklistItem(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ checklistId, content }: { checklistId: string; content: string }) => {
      let targetChecklistId = checklistId;
      if (pendingChecklistCreations.has(checklistId)) {
        try {
          const realId = await pendingChecklistCreations.get(checklistId);
          if (realId) targetChecklistId = realId;
        } catch {
          // If creation fails, proceed and let the request report error
        }
      }
      const res = await api.post(`/pm/checklists/${targetChecklistId}/items`, { content });
      return res.data.data as TaskChecklistItem;
    },
    onMutate: async ({ checklistId, content }) => {
      await qc.cancelQueries({ queryKey: ['checklists', taskId] });
      const previous = qc.getQueryData<TaskChecklist[]>(['checklists', taskId]);
      const tempId = `temp-cli-${Date.now()}`;
      qc.setQueryData<TaskChecklist[]>(['checklists', taskId], (old = []) =>
        (old || []).map((c) => {
          if (c.id !== checklistId) return c;
          const items = c.items || [];
          const optimisticItem: TaskChecklistItem = {
            id: tempId,
            checklist_id: checklistId,
            content,
            is_done: false,
            position: items.length,
            assigned_to: null,
            due_date: null,
            completed_at: null,
            completed_by: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          return {
            ...c,
            items: [...items, optimisticItem],
          };
        })
      );
      return { previous, tempId, checklistId };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['checklists', taskId], context.previous);
      }
    },
    onSuccess: (created, vars, context) => {
      if (context?.tempId && created?.id) {
        qc.setQueryData<TaskChecklist[]>(['checklists', taskId], (old = []) =>
          (old || []).map((c) => {
            if (c.id !== vars.checklistId && c.id !== created.checklist_id) return c;
            return {
              ...c,
              items: (c.items || []).map((item) =>
                item.id === context.tempId ? created : item
              ),
            };
          })
        );
      }
      qc.invalidateQueries({ queryKey: ['checklists', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
    },
  });
}

export function useUpdateChecklistItem(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; content?: string; is_done?: boolean }) => {
      await api.put(`/pm/checklist-items/${id}`, body);
    },
    onMutate: async ({ id, ...body }) => {
      await qc.cancelQueries({ queryKey: ['checklists', taskId] });
      const previous = qc.getQueryData<TaskChecklist[]>(['checklists', taskId]);
      qc.setQueryData<TaskChecklist[]>(['checklists', taskId], (old = []) =>
        (old || []).map((c) => ({
          ...c,
          items: (c.items || []).map((item) =>
            item.id === id ? { ...item, ...body } : item
          ),
        }))
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['checklists', taskId], context.previous);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklists', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
    },
  });
}

export function useDeleteChecklistItem(taskId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pm/checklist-items/${id}`);
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['checklists', taskId] });
      const previous = qc.getQueryData<TaskChecklist[]>(['checklists', taskId]);
      qc.setQueryData<TaskChecklist[]>(['checklists', taskId], (old = []) =>
        (old || []).map((c) => ({
          ...c,
          items: (c.items || []).filter((item) => item.id !== id),
        }))
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(['checklists', taskId], context.previous);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklists', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
    },
  });
}
