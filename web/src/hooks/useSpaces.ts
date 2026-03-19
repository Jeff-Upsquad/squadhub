import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Space } from '@squadhub/shared';

export function useSpaces(workspaceId: string | undefined) {
  return useQuery<Space[]>({
    queryKey: ['spaces', workspaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/spaces?workspace_id=${workspaceId}`);
      return res.data.data;
    },
    enabled: !!workspaceId,
  });
}

export function useSpace(spaceId: string | null) {
  return useQuery<Space>({
    queryKey: ['space', spaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/spaces/${spaceId}`);
      return res.data.data;
    },
    enabled: !!spaceId,
  });
}

export function useCreateSpace(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; color?: string; icon?: string; description?: string }) => {
      const res = await api.post('/pm/spaces', { ...body, workspace_id: workspaceId });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spaces', workspaceId] });
    },
  });
}

export function useCreateFolder(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string }) => {
      const res = await api.post('/pm/folders', { ...body, space_id: spaceId });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
}

export function useCreateList(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; folder_id?: string }) => {
      const res = await api.post('/pm/lists', { ...body, space_id: spaceId });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
}
