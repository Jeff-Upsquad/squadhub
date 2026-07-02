import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { ListViewRow, ListViewConfig, ListView } from '@squadhub/shared';

// The named views (List/Board/Whiteboard tabs) for a list. Returns the shared
// views plus the caller's own private views, ordered by position.
export function useListViews(listId: string | null) {
  return useQuery<ListViewRow[]>({
    queryKey: ['list-views', listId],
    queryFn: async () => (await api.get(`/pm/lists/${listId}/views`)).data.data as ListViewRow[],
    enabled: !!listId,
    staleTime: 30_000,
  });
}

export function useCreateView(listId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { view_type: ListView; name: string; is_private?: boolean; config?: ListViewConfig }) =>
      (await api.post(`/pm/lists/${listId}/views`, vars)).data.data as ListViewRow,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['list-views', listId] }),
  });
}

export function useUpdateView(listId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      name?: string;
      is_private?: boolean;
      is_default?: boolean;
      position?: number;
      config?: ListViewConfig;
    }) => {
      const { id, ...body } = vars;
      return (await api.put(`/pm/views/${id}`, body)).data.data as ListViewRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['list-views', listId] }),
  });
}

export function useDeleteView(listId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (viewId: string) => {
      await api.delete(`/pm/views/${viewId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['list-views', listId] }),
  });
}
