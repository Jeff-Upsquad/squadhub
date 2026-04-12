import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { SharedWithMeItem } from '@squadhub/shared';

export function useSharedWithMe(workspaceId: string | undefined) {
  return useQuery<SharedWithMeItem[]>({
    queryKey: ['shared-with-me', workspaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/shared-with-me?workspace_id=${workspaceId}`);
      return res.data.data;
    },
    enabled: !!workspaceId,
  });
}
