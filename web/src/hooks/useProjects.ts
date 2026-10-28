import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Project } from '@squadhub/shared';

// Workspace projects — the shared entity areas (spaces), spaces (folders),
// lists, and goals reference. Pickers read useProjects; edits come back
// through the pm container PUTs or these mutations.

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['projects', workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const res = await api.get('/pm/projects', { params: { workspace_id: workspaceId } });
      return (res.data.data || []) as Project[];
    },
  });
}

export function useCreateProject(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; color: string; description?: string }) => {
      const res = await api.post('/pm/projects', { ...body, workspace_id: workspaceId });
      return res.data.data as Project;
    },
    onSuccess: (project) => {
      if (!workspaceId || !project) return;
      qc.setQueryData<Project[]>(['projects', workspaceId], (prev) => [...(prev || []), project]);
    },
  });
}

export function useUpdateProject(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; name?: string; color?: string; status?: 'active' | 'inactive' }) => {
      const res = await api.patch(`/pm/projects/${id}`, patch);
      return res.data.data as Project;
    },
    onSuccess: (project) => {
      if (!workspaceId || !project) return;
      qc.setQueryData<Project[]>(['projects', workspaceId], (prev) =>
        (prev || []).map((p) => (p.id === project.id ? project : p)),
      );
      // Project renames show up in every hydrated task row.
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}

export function useDeleteProject(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pm/projects/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', workspaceId] });
      void qc.invalidateQueries({ queryKey: ['goals'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
