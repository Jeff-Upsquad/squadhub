import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Space } from '@squadhub/shared';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { showToast } from '../components/Toast';

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

export function useWorkspaces(workspaceId: string | undefined) {
  return useQuery<Space[]>({
    queryKey: ['workspaces', workspaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/workspaces?workspace_id=${workspaceId}`);
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
    mutationFn: async (body: { name: string; profile_id?: string; client_space_template_id?: string; skip_template_lists?: boolean; parent_folder_id?: string; folder_type?: string }) => {
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
    mutationFn: async (body: { name: string; folder_id?: string; profile_id?: string }) => {
      const res = await api.post('/pm/lists', { ...body, space_id: spaceId });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useMutation({
    mutationFn: async (spaceId: string) => {
      await api.delete(`/pm/spaces/${spaceId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spaces', workspaceId] });
    },
  });
}

export function useDeleteFolder(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderId: string) => {
      await api.delete(`/pm/folders/${folderId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
}

export function useDeleteList(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: string) => {
      await api.delete(`/pm/lists/${listId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
}

export function useMoveList(currentSpaceId: string) {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useMutation({
    mutationFn: async (vars: { listId: string; space_id: string; folder_id: string | null }) => {
      const res = await api.put(`/pm/lists/${vars.listId}`, {
        space_id: vars.space_id,
        folder_id: vars.folder_id,
      });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['space', currentSpaceId] });
      if (vars.space_id !== currentSpaceId) {
        qc.invalidateQueries({ queryKey: ['space', vars.space_id] });
      }
      qc.invalidateQueries({ queryKey: ['spaces', workspaceId] });
    },
  });
}

export function useMoveFolder(currentSpaceId: string) {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useMutation({
    mutationFn: async (vars: { folderId: string; space_id: string }) => {
      const res = await api.put(`/pm/folders/${vars.folderId}`, { space_id: vars.space_id });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['space', currentSpaceId] });
      if (vars.space_id !== currentSpaceId) {
        qc.invalidateQueries({ queryKey: ['space', vars.space_id] });
      }
      qc.invalidateQueries({ queryKey: ['spaces', workspaceId] });
    },
  });
}

// Persist a new sibling order for lists inside one container (a folder, or the
// space's root). ordered_ids must cover every list in that container.
export function useReorderLists() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { space_id: string; folder_id?: string | null; ordered_ids: string[] }) => {
      await api.post('/pm/lists/reorder', vars);
    },
    onSuccess: () => {
      // Prefix matches: every open space payload, the sidebar trees, and any
      // open folder pages all render list order from these caches.
      qc.invalidateQueries({ queryKey: ['spaces'] });
      qc.invalidateQueries({ queryKey: ['space'] });
      qc.invalidateQueries({ queryKey: ['folder'] });
    },
    onError: (err: any) => {
      // Reordering silently failing looks like "drag does nothing" — always
      // surface it so the failure is debuggable from the UI.
      console.error('Reorder lists failed:', err?.response?.data?.error || err);
      showToast(err?.response?.data?.error || 'Could not save the new order', 'error');
    },
  });
}
