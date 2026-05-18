import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export interface WorkspaceMember {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

export function useWorkspaceMembers(workspaceId: string | undefined | null) {
  return useQuery<WorkspaceMember[]>({
    queryKey: ['workspace-members', workspaceId],
    queryFn: async () => {
      const res = await api.get(`/workspaces/${workspaceId}/members`);
      const rows = (res.data?.data || []) as any[];
      return rows
        .filter((m) => m?.user?.id)
        .map((m) => ({
          id: m.user.id,
          display_name: m.user.display_name || m.user.email || 'Unknown',
          email: m.user.email,
          avatar_url: m.user.avatar_url ?? null,
        }));
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
