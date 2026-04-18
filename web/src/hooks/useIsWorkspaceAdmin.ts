import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';

interface WorkspaceWithRole {
  id: string;
  my_role?: string;
}

export function useIsWorkspaceAdmin(): boolean {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const { data } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => r.data),
  });
  const workspaces: WorkspaceWithRole[] = data?.data || [];
  const current = workspaces.find((w) => w.id === currentWorkspaceId);
  return current?.my_role === 'admin' || current?.my_role === 'super_admin';
}
