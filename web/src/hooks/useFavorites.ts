import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Favorite, FavoriteItemType } from '@squadhub/shared';

export function useFavorites(workspaceId: string | undefined) {
  return useQuery<Favorite[]>({
    queryKey: ['favorites', workspaceId],
    queryFn: async () => {
      const res = await api.get(`/favorites?workspace_id=${workspaceId}`);
      return res.data.data;
    },
    enabled: !!workspaceId,
  });
}

export function useAddFavorite(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { item_type: FavoriteItemType; item_id: string }) => {
      const res = await api.post('/favorites', { ...body, workspace_id: workspaceId });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['favorites', workspaceId] });
    },
  });
}

export function useRemoveFavorite(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (favoriteId: string) => {
      await api.delete(`/favorites/${favoriteId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['favorites', workspaceId] });
    },
  });
}
